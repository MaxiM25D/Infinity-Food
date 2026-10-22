import {
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";

import { database } from "../database.js";
import { environment } from "../config.js";
import { HttpError } from "../errors.js";
import {
  decryptSecret,
  encryptSecret,
  hashOpaqueToken,
} from "./secret-vault.js";
import { releaseReservedOrder } from "./orders.js";
import { dispatchTenantNotification } from "./notifications.js";
import { assertPaymentRecipient } from "./payment-validation.js";

const authorizationEndpoint = "https://auth.mercadopago.com/authorization";
const apiEndpoint = "https://api.mercadopago.com";

type OAuthTokenResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  user_id: number;
  public_key?: string;
};

type MercadoPagoPayment = {
  id: number;
  collector_id: number;
  status: string;
  status_detail?: string;
  external_reference?: string;
  transaction_amount: number;
  currency_id: string;
  fee_details?: Array<{ amount: number; type?: string }>;
  money_release_date?: string;
  date_approved?: string;
};

function providerFinancials(payment: MercadoPagoPayment) {
  const grossInCents = Math.round(payment.transaction_amount * 100);
  const feeInCents = Math.round((payment.fee_details ?? []).reduce((sum, fee) => sum + fee.amount, 0) * 100);
  const releaseCandidate = payment.money_release_date ? new Date(payment.money_release_date) : null;
  const releasedAt = releaseCandidate && !Number.isNaN(releaseCandidate.getTime()) ? releaseCandidate : null;
  return {
    grossInCents,
    feeInCents,
    netInCents: grossInCents - feeInCents,
    releasedAt,
    reconciliationStatus: payment.status === "refunded" || payment.status === "charged_back" ? "REFUNDED" as const
      : payment.status === "approved" && releasedAt && releasedAt <= new Date() ? "RECONCILED" as const
        : "PENDING" as const,
  };
}

function oauthConfiguration() {
  if (!environment.MP_CLIENT_ID || !environment.MP_CLIENT_SECRET) {
    throw new HttpError(
      503,
      "Configurá MP_CLIENT_ID y MP_CLIENT_SECRET para conectar Mercado Pago",
    );
  }
  return {
    clientId: environment.MP_CLIENT_ID,
    clientSecret: environment.MP_CLIENT_SECRET,
    redirectUri: `${environment.API_PUBLIC_URL.replace(/\/$/, "")}/api/integrations/mercadopago/callback`,
  };
}

async function mercadoPagoRequest<T>(
  path: string,
  accessToken: string,
  init: RequestInit = {},
): Promise<T> {
  const response = await fetch(`${apiEndpoint}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      ...init.headers,
    },
  });
  const body = (await response.json().catch(() => null)) as
    (T & { message?: string }) | null;
  if (!response.ok || !body) {
    throw new HttpError(
      502,
      body?.message ?? "Mercado Pago no pudo procesar la solicitud",
    );
  }
  return body;
}

async function exchangeToken(
  body: Record<string, string>,
): Promise<OAuthTokenResponse> {
  const response = await fetch(`${apiEndpoint}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const result = (await response.json().catch(() => null)) as
    (OAuthTokenResponse & { message?: string }) | null;
  if (!response.ok || !result?.access_token) {
    throw new HttpError(
      502,
      result?.message ?? "No se pudo autorizar la cuenta de Mercado Pago",
    );
  }
  return result;
}

export async function createMercadoPagoAuthorization(
  tenantId: string,
  userId: string,
): Promise<string> {
  const { clientId, redirectUri } = oauthConfiguration();
  const state = randomBytes(32).toString("base64url");
  const verifier = randomBytes(48).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");

  await database.mercadoPagoOAuthState.deleteMany({
    where: { expiresAt: { lte: new Date() } },
  });
  await database.mercadoPagoOAuthState.create({
    data: {
      tenantId,
      userId,
      stateHash: hashOpaqueToken(state),
      codeVerifierEncrypted: encryptSecret(verifier),
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    },
  });

  const url = new URL(authorizationEndpoint);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

export async function completeMercadoPagoAuthorization(
  code: string,
  state: string,
): Promise<string> {
  const { clientId, clientSecret, redirectUri } = oauthConfiguration();
  const oauthState = await database.mercadoPagoOAuthState.findUnique({
    where: { stateHash: hashOpaqueToken(state) },
    include: { tenant: { select: { slug: true } } },
  });
  if (!oauthState || oauthState.expiresAt <= new Date()) {
    throw new HttpError(400, "La autorización venció o no es válida");
  }
  await database.mercadoPagoOAuthState.delete({ where: { id: oauthState.id } });

  const token = await exchangeToken({
    grant_type: "authorization_code",
    client_id: clientId,
    client_secret: clientSecret,
    code,
    redirect_uri: redirectUri,
    code_verifier: decryptSecret(oauthState.codeVerifierEncrypted),
  });
  if (!token.refresh_token)
    throw new HttpError(502, "Mercado Pago no devolvió un refresh token");

  await database.mercadoPagoConnection.upsert({
    where: { tenantId: oauthState.tenantId },
    update: {
      mercadoPagoUserId: String(token.user_id),
      accessTokenEncrypted: encryptSecret(token.access_token),
      refreshTokenEncrypted: encryptSecret(token.refresh_token),
      accessTokenExpiresAt: token.expires_in
        ? new Date(Date.now() + token.expires_in * 1000)
        : null,
      publicKey: token.public_key ?? null,
      liveMode: token.access_token.startsWith("APP_USR"),
      connectedAt: new Date(),
    },
    create: {
      tenantId: oauthState.tenantId,
      mercadoPagoUserId: String(token.user_id),
      accessTokenEncrypted: encryptSecret(token.access_token),
      refreshTokenEncrypted: encryptSecret(token.refresh_token),
      accessTokenExpiresAt: token.expires_in
        ? new Date(Date.now() + token.expires_in * 1000)
        : null,
      publicKey: token.public_key ?? null,
      liveMode: token.access_token.startsWith("APP_USR"),
      webhookKey: randomBytes(24).toString("base64url"),
    },
  });
  return oauthState.tenant.slug;
}

async function getAccessToken(
  tenantId: string,
): Promise<{ accessToken: string; webhookKey: string }> {
  const connection = await database.mercadoPagoConnection.findUnique({
    where: { tenantId },
  });
  if (!connection)
    throw new HttpError(409, "La tienda todavía no conectó Mercado Pago");
  if (
    !connection.accessTokenExpiresAt ||
    connection.accessTokenExpiresAt.getTime() > Date.now() + 5 * 60 * 1000
  ) {
    return {
      accessToken: decryptSecret(connection.accessTokenEncrypted),
      webhookKey: connection.webhookKey,
    };
  }

  const { clientId, clientSecret } = oauthConfiguration();
  const token = await exchangeToken({
    grant_type: "refresh_token",
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: decryptSecret(connection.refreshTokenEncrypted),
  });
  const updated = await database.mercadoPagoConnection.update({
    where: { tenantId },
    data: {
      accessTokenEncrypted: encryptSecret(token.access_token),
      ...(token.refresh_token
        ? { refreshTokenEncrypted: encryptSecret(token.refresh_token) }
        : {}),
      accessTokenExpiresAt: token.expires_in
        ? new Date(Date.now() + token.expires_in * 1000)
        : null,
    },
  });
  return { accessToken: token.access_token, webhookKey: updated.webhookKey };
}

export async function createCheckoutPreference(
  orderId: string,
  tenantId: string,
): Promise<{
  preferenceId: string;
  checkoutUrl: string;
}> {
  const order = await database.order.findFirst({
    where: {
      id: orderId,
      tenantId,
      paymentMethod: "MERCADO_PAGO",
      stockStatus: "RESERVED",
    },
    include: { items: true, tenant: { select: { slug: true } } },
  });
  if (!order) throw new HttpError(404, "Pedido pendiente no encontrado");
  if (order.stockExpiresAt && order.stockExpiresAt <= new Date()) {
    await releaseReservedOrder(
      tenantId,
      orderId,
      "Reserva de Mercado Pago vencida",
    );
    throw new HttpError(409, "La reserva de stock venció");
  }

  const existing = await database.paymentAttempt.findFirst({
    where: { tenantId, orderId, provider: "MERCADO_PAGO" },
  });
  if (existing?.preferenceId && existing.checkoutUrl) {
    return {
      preferenceId: existing.preferenceId,
      checkoutUrl: existing.checkoutUrl,
    };
  }
  const attempt =
    existing ??
    (await database.paymentAttempt.create({
      data: {
        tenantId,
        orderId,
        provider: "MERCADO_PAGO",
        idempotencyKey: randomUUID(),
        amountInCents: order.totalInCents,
        currency: order.currency,
      },
    }));
  const { accessToken, webhookKey } = await getAccessToken(tenantId);
  const frontendUrl = environment.WEB_URL.replace(/\/$/, "");
  const isLocal = ["localhost", "127.0.0.1", "::1"].includes(
    new URL(frontendUrl).hostname,
  );
  const body: Record<string, unknown> = {
    items: order.items.map((item) => ({
      id: item.productId ?? item.sku,
      title: item.productName,
      quantity: item.quantity,
      currency_id: order.currency,
      unit_price: item.unitPriceInCents / 100,
    })),
    payer: { email: order.customerEmail },
    external_reference: attempt.id,
    metadata: { payment_attempt_id: attempt.id },
    notification_url: `${environment.API_PUBLIC_URL.replace(/\/$/, "")}/api/payments/mercadopago/webhook/${webhookKey}?source_news=webhooks`,
  };
  if (order.stockExpiresAt) {
    body.expires = true;
    body.expiration_date_to = order.stockExpiresAt.toISOString();
  }
  if (!isLocal) {
    const returnUrl = `${frontendUrl}/tienda/${encodeURIComponent(order.tenant.slug)}/pedido/${encodeURIComponent(order.id)}`;
    body.back_urls = {
      success: `${returnUrl}?payment=success`,
      pending: `${returnUrl}?payment=pending`,
      failure: `${returnUrl}?payment=failure`,
    };
    body.auto_return = "approved";
  }

  const preference = await mercadoPagoRequest<{
    id: string;
    init_point: string;
    sandbox_init_point?: string;
  }>("/checkout/preferences", accessToken, {
    method: "POST",
    headers: { "X-Idempotency-Key": attempt.idempotencyKey },
    body: JSON.stringify(body),
  });
  await database.paymentAttempt.update({
    where: { id: attempt.id },
    data: {
      preferenceId: preference.id,
      checkoutUrl: preference.init_point,
      sandboxCheckoutUrl: preference.sandbox_init_point ?? null,
    },
  });
  return { preferenceId: preference.id, checkoutUrl: preference.init_point };
}

export async function createPosMercadoPagoCheckout(input: {
  tenantId: string; branchId: string; orderId: string; userId: string;
  clientRequestId: string; amountInCents: number;
}) {
  const duplicate = await database.paymentAttempt.findUnique({ where: { idempotencyKey: input.clientRequestId } });
  if (duplicate) {
    if (duplicate.tenantId !== input.tenantId || duplicate.branchId !== input.branchId || duplicate.orderId !== input.orderId || duplicate.amountInCents !== input.amountInCents || duplicate.flow !== "POS") throw new HttpError(409, "El identificador del cobro ya fue utilizado");
    if (duplicate.checkoutUrl) return { attempt: duplicate, checkoutUrl: duplicate.checkoutUrl, sandboxCheckoutUrl: duplicate.sandboxCheckoutUrl, created: false };
  }
  const attempt = duplicate ?? await database.$transaction(async (transaction) => {
    await transaction.$queryRaw`SELECT "id" FROM "Order" WHERE "tenantId" = ${input.tenantId} AND "branchId" = ${input.branchId} AND "id" = ${input.orderId} FOR UPDATE`;
    const order = await transaction.order.findFirst({
      where: { id: input.orderId, tenantId: input.tenantId, branchId: input.branchId, diningStatus: { notIn: ["CANCELLED"] } },
      include: { operationalPayments: { select: { kind: true, amountInCents: true } }, paymentAttempts: { where: { flow: "POS", status: "PENDING" }, select: { amountInCents: true } } },
    });
    if (!order) throw new HttpError(404, "Pedido no encontrado");
    const paid = order.operationalPayments.reduce((sum, payment) => sum + (payment.kind === "REFUND" ? -payment.amountInCents : payment.amountInCents), 0);
    const pending = order.paymentAttempts.reduce((sum, item) => sum + item.amountInCents, 0);
    const available = order.totalInCents - paid - pending;
    if (input.amountInCents > available) throw new HttpError(409, `El cobro supera el saldo disponible de ${available} centavos`);
    const cashSession = await transaction.cashRegisterSession.findUnique({ where: { openKey: `${input.tenantId}:${input.branchId}` } });
    if (!cashSession) throw new HttpError(409, "Abrí la caja antes de iniciar el cobro");
    return transaction.paymentAttempt.create({ data: {
      tenantId: input.tenantId, branchId: input.branchId, orderId: input.orderId, cashSessionId: cashSession.id,
      createdByUserId: input.userId, flow: "POS", provider: "MERCADO_PAGO", idempotencyKey: input.clientRequestId,
      amountInCents: input.amountInCents, currency: order.currency,
    } });
  }, { isolationLevel: "Serializable" });
  const { accessToken, webhookKey } = await getAccessToken(input.tenantId);
  try {
    const preference = await mercadoPagoRequest<{ id: string; init_point: string; sandbox_init_point?: string }>("/checkout/preferences", accessToken, {
      method: "POST", headers: { "X-Idempotency-Key": attempt.idempotencyKey }, body: JSON.stringify({
        items: [{ id: input.orderId, title: `Pedido POS #${input.orderId.slice(-6)}`, quantity: 1, currency_id: attempt.currency, unit_price: attempt.amountInCents / 100 }],
        external_reference: attempt.id, metadata: { payment_attempt_id: attempt.id, flow: "pos" },
        notification_url: `${environment.API_PUBLIC_URL.replace(/\/$/, "")}/api/payments/mercadopago/webhook/${webhookKey}?source_news=webhooks`,
      }),
    });
    const updated = await database.paymentAttempt.update({ where: { id: attempt.id }, data: { status: "PENDING", statusDetail: null, preferenceId: preference.id, checkoutUrl: preference.init_point, sandboxCheckoutUrl: preference.sandbox_init_point ?? null } });
    return { attempt: updated, checkoutUrl: updated.checkoutUrl, sandboxCheckoutUrl: updated.sandboxCheckoutUrl, created: true };
  } catch (error) {
    await database.paymentAttempt.update({ where: { id: attempt.id }, data: { status: "REJECTED", statusDetail: error instanceof Error ? error.message.slice(0, 300) : "provider_error" } });
    throw error;
  }
}

export function validateMercadoPagoSignature(input: {
  dataId: string;
  xRequestId: string | undefined;
  xSignature: string | undefined;
  secret: string;
}): boolean {
  if (!input.xRequestId || !input.xSignature) return false;
  const entries = Object.fromEntries(
    input.xSignature.split(",").map((part) => part.trim().split("=", 2)),
  );
  const timestamp = entries.ts;
  const signature = entries.v1;
  if (!timestamp || !signature) return false;
  const manifest = `id:${input.dataId};request-id:${input.xRequestId};ts:${timestamp};`;
  const expected = createHmac("sha256", input.secret)
    .update(manifest)
    .digest("hex");
  const expectedBuffer = Buffer.from(expected, "hex");
  const receivedBuffer = Buffer.from(signature, "hex");
  return (
    expectedBuffer.length === receivedBuffer.length &&
    timingSafeEqual(expectedBuffer, receivedBuffer)
  );
}

function normalizePaymentStatus(
  status: string,
): "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED" | "REFUNDED" {
  if (status === "approved") return "APPROVED";
  if (status === "rejected") return "REJECTED";
  if (status === "cancelled" || status === "canceled") return "CANCELLED";
  if (status === "refunded" || status === "charged_back") return "REFUNDED";
  return "PENDING";
}

export async function processMercadoPagoWebhook(
  webhookKey: string,
  paymentId: string,
): Promise<void> {
  const connection = await database.mercadoPagoConnection.findUnique({
    where: { webhookKey },
  });
  if (!connection)
    throw new HttpError(404, "Conexión de Mercado Pago no encontrada");
  const { accessToken } = await getAccessToken(connection.tenantId);
  const payment = await mercadoPagoRequest<MercadoPagoPayment>(
    `/v1/payments/${encodeURIComponent(paymentId)}`,
    accessToken,
  );
  if (!payment.external_reference)
    throw new HttpError(400, "El pago no tiene una referencia válida");

  assertPaymentRecipient(payment.collector_id, connection.mercadoPagoUserId);

  const attempt = await database.paymentAttempt.findFirst({
    where: { id: payment.external_reference, tenantId: connection.tenantId },
    include: {
      order: {
        include: {
          items: { select: { productId: true, quantity: true } },
          tenant: { select: { slug: true } },
        },
      },
    },
  });
  if (!attempt) throw new HttpError(404, "Intento de pago no encontrado");
  if (
    Math.round(payment.transaction_amount * 100) !== attempt.amountInCents ||
    payment.currency_id !== attempt.currency
  ) {
    throw new HttpError(
      409,
      "El importe o la moneda no coincide con el pedido",
    );
  }
  const status = normalizePaymentStatus(payment.status);
  const financials = providerFinancials(payment);

  await database.$transaction(async (transaction) => {
    await transaction.$queryRaw`SELECT id FROM "Order" WHERE id = ${attempt.orderId} AND "tenantId" = ${attempt.tenantId} FOR UPDATE`;
    const current = await transaction.order.findFirst({
      where: { id: attempt.orderId, tenantId: attempt.tenantId },
      include: { items: { select: { productId: true, quantity: true } }, operationalPayments: { include: { refunds: { select: { amountInCents: true } } } } },
    });
    if (!current) throw new HttpError(404, "Pedido no encontrado");
    await transaction.paymentAttempt.update({
      where: { id: attempt.id },
      data: {
        externalPaymentId: String(payment.id),
        externalStatus: payment.status,
        statusDetail: payment.status_detail ?? null,
        status,
      },
    });

    if (attempt.flow === "POS") {
      if (!attempt.branchId || !attempt.cashSessionId || !attempt.createdByUserId) throw new HttpError(409, "El intento POS no tiene contexto operativo completo");
      const existingPayment = await transaction.orderPayment.findUnique({ where: { paymentAttemptId: attempt.id } });
      if (status === "APPROVED" && !existingPayment) {
        const netPaid = current.operationalPayments.reduce((sum, item) => sum + (item.kind === "REFUND" ? -item.amountInCents : item.amountInCents), 0);
        if (attempt.amountInCents > current.totalInCents - netPaid) {
          await transaction.paymentAttempt.update({ where: { id: attempt.id }, data: { statusDetail: "approved_amount_exceeds_open_balance" } });
          return;
        }
        const created = await transaction.orderPayment.create({ data: {
          tenantId: attempt.tenantId, branchId: attempt.branchId, orderId: attempt.orderId, cashSessionId: attempt.cashSessionId,
          kind: "PAYMENT", method: "MERCADO_PAGO", amountInCents: attempt.amountInCents, clientRequestId: `mp:${attempt.id}`,
          reference: String(payment.id), createdByUserId: attempt.createdByUserId, paymentAttemptId: attempt.id,
          providerPaymentId: String(payment.id), providerStatus: payment.status, providerFeeInCents: financials.feeInCents,
          providerNetInCents: financials.netInCents, providerReleasedAt: financials.releasedAt,
          reconciliationStatus: financials.reconciliationStatus,
        } });
        const nextPaid = netPaid + created.amountInCents;
        await transaction.order.update({ where: { id: current.id }, data: { paymentMethod: "MERCADO_PAGO", paymentStatus: nextPaid >= current.totalInCents ? "APPROVED" : "PARTIALLY_PAID" } });
        await transaction.diningOrderAudit.create({ data: { eventId: `mp:${attempt.id}`, tenantId: attempt.tenantId, branchId: attempt.branchId, orderId: current.id, actorUserId: attempt.createdByUserId, action: "PAYMENT_REGISTERED", entityType: "OrderPayment", entityId: created.id, payload: { provider: "MERCADO_PAGO", providerPaymentId: String(payment.id), feeInCents: financials.feeInCents, netInCents: financials.netInCents } } });
      } else if (existingPayment) {
        await transaction.orderPayment.update({ where: { id: existingPayment.id }, data: { providerStatus: payment.status, providerFeeInCents: financials.feeInCents, providerNetInCents: financials.netInCents, providerReleasedAt: financials.releasedAt, reconciliationStatus: financials.reconciliationStatus } });
      }
      if (status === "REFUNDED" && existingPayment) {
        const original = current.operationalPayments.find(({ id }) => id === existingPayment.id);
        const alreadyRefunded = original?.refunds.reduce((sum, item) => sum + item.amountInCents, 0) ?? 0;
        const refundable = existingPayment.amountInCents - alreadyRefunded;
        if (refundable > 0) {
          await transaction.orderPayment.create({ data: { tenantId: attempt.tenantId, branchId: attempt.branchId, orderId: attempt.orderId, cashSessionId: attempt.cashSessionId, kind: "REFUND", method: "MERCADO_PAGO", amountInCents: refundable, clientRequestId: `mp-refund:${payment.id}`, reference: "Devolución confirmada por Mercado Pago", refundOfId: existingPayment.id, createdByUserId: attempt.createdByUserId, providerPaymentId: `refund:${payment.id}`, providerStatus: payment.status, reconciliationStatus: "REFUNDED" } });
          const paidAfterRefund = current.operationalPayments.reduce((sum, item) => sum + (item.kind === "REFUND" ? -item.amountInCents : item.amountInCents), 0) - refundable;
          await transaction.order.update({ where: { id: current.id }, data: { paymentStatus: paidAfterRefund <= 0 ? "REFUNDED" : paidAfterRefund < current.totalInCents ? "PARTIALLY_PAID" : "APPROVED" } });
        }
      }
      return;
    }

    if (status === "APPROVED") {
      const statusChanged = current.status === "PENDING";
      await transaction.order.update({
        where: { id: current.id },
        data: {
          paymentStatus: "APPROVED",
          stockStatus: "COMMITTED",
          stockExpiresAt: null,
          ...(statusChanged ? { status: "CONFIRMED" } : {}),
        },
      });
      if (statusChanged)
        await transaction.orderStatusHistory.create({
          data: {
            tenantId: current.tenantId,
            orderId: current.id,
            status: "CONFIRMED",
            note: "Pago aprobado por Mercado Pago",
          },
        });
      return;
    }

    await transaction.order.update({
      where: { id: current.id },
      data: { paymentStatus: status },
    });
  });

  if (status === "APPROVED" && attempt.flow === "STOREFRONT") {
    await dispatchTenantNotification({
      tenantId: attempt.tenantId,
      event: "ORDER_PAID",
      recipient: attempt.order.customerEmail,
      actionUrl: `/tienda/${attempt.order.tenant.slug}/pedido/${attempt.orderId}`,
      orderId: attempt.orderId,
    });
  }

  if (attempt.flow === "STOREFRONT" && ["CANCELLED", "REFUNDED"].includes(status)) {
    await releaseReservedOrder(
      attempt.tenantId,
      attempt.orderId,
      `Pago ${payment.status} en Mercado Pago`,
      true,
    );
  }
}

export async function syncOperationalMercadoPagoPayment(input: { tenantId: string; branchId: string; paymentId: string }) {
  const operational = await database.orderPayment.findFirst({ where: { id: input.paymentId, tenantId: input.tenantId, branchId: input.branchId, kind: "PAYMENT", method: "MERCADO_PAGO", providerPaymentId: { not: null } }, include: { paymentAttempt: { select: { currency: true } } } });
  if (!operational?.providerPaymentId) throw new HttpError(404, "Cobro automático de Mercado Pago no encontrado");
  const connection = await database.mercadoPagoConnection.findUnique({ where: { tenantId: input.tenantId } });
  if (!connection) throw new HttpError(409, "La tienda todavía no conectó Mercado Pago");
  const { accessToken } = await getAccessToken(input.tenantId);
  const payment = await mercadoPagoRequest<MercadoPagoPayment>(`/v1/payments/${encodeURIComponent(operational.providerPaymentId)}`, accessToken);
  assertPaymentRecipient(payment.collector_id, connection.mercadoPagoUserId);
  const financials = providerFinancials(payment);
  const amountMatches = financials.grossInCents === operational.amountInCents && payment.currency_id === (operational.paymentAttempt?.currency ?? "ARS");
  return database.orderPayment.update({ where: { id: operational.id }, data: {
    providerStatus: payment.status, providerFeeInCents: financials.feeInCents, providerNetInCents: financials.netInCents,
    providerReleasedAt: financials.releasedAt,
    reconciliationStatus: amountMatches ? financials.reconciliationStatus : "MISMATCH",
  } });
}

export async function refundOperationalMercadoPagoPayment(input: { tenantId: string; branchId: string; paymentId: string; amountInCents: number; clientRequestId: string }) {
  const operational = await database.orderPayment.findFirst({ where: { id: input.paymentId, tenantId: input.tenantId, branchId: input.branchId, kind: "PAYMENT", method: "MERCADO_PAGO", providerPaymentId: { not: null } }, include: { refunds: { select: { amountInCents: true } } } });
  if (!operational?.providerPaymentId) throw new HttpError(404, "Cobro automático de Mercado Pago no encontrado");
  const refunded = operational.refunds.reduce((sum, item) => sum + item.amountInCents, 0);
  if (input.amountInCents > operational.amountInCents - refunded) throw new HttpError(409, "La devolución supera el importe reintegrable");
  const { accessToken } = await getAccessToken(input.tenantId);
  await mercadoPagoRequest(`/v1/payments/${encodeURIComponent(operational.providerPaymentId)}/refunds`, accessToken, { method: "POST", headers: { "X-Idempotency-Key": input.clientRequestId }, body: JSON.stringify({ amount: input.amountInCents / 100 }) });
}
