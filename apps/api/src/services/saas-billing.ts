import { database } from "../database.js";
import { HttpError } from "../errors.js";
import { billingPaymentStatus } from "./payment-validation.js";
import {
  billingProviderConfigured,
  cancelProviderSubscription,
  createProviderSubscription,
  getProviderInvoice,
  getProviderSubscription,
  type ProviderSubscription,
  updateProviderSubscription,
} from "./saas-billing-provider.js";

export async function getBillingOverview(tenantId: string) {
  const [subscription, plans, products, members, monthlyOrders, invoices] = await Promise.all([
    database.subscription.findUnique({
      where: { tenantId },
      include: { plan: true, pendingPlan: true },
    }),
    database.plan.findMany({ where: { active: true }, orderBy: { priceInCents: "asc" } }),
    database.product.count({ where: { tenantId } }),
    database.membership.count({ where: { tenantId } }),
    database.order.count({ where: { tenantId, createdAt: { gte: new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1)) } } }),
    database.billingInvoice.findMany({ where: { tenantId }, orderBy: { createdAt: "desc" }, take: 24 }),
  ]);
  if (!subscription) throw new HttpError(409, "La tienda todavía no tiene un plan asignado");
  return { subscription, plans, usage: { products, members, monthlyOrders }, invoices, billingConfigured: billingProviderConfigured() };
}

export async function getBillingPaymentProfile(tenantId: string) {
  const subscription = await database.subscription.findUnique({ where: { tenantId } });
  if (!subscription) throw new HttpError(404, "Suscripción no encontrada");
  if (!subscription.providerSubscriptionId) {
    return {
      linked: false,
      provider: subscription.billingProvider,
      status: subscription.providerStatus,
      payerEmail: subscription.payerEmail,
      payerId: null,
      paymentMethodId: null,
      nextPaymentDate: null,
      collectorId: null,
    };
  }

  const provider = await getProviderSubscription(subscription.providerSubscriptionId);
  if (provider.external_reference && provider.external_reference !== tenantId) {
    throw new HttpError(409, "La referencia del proveedor no coincide con la tienda");
  }
  return {
    linked: true,
    provider: "MERCADO_PAGO" as const,
    status: provider.status,
    payerEmail: provider.payer_email ?? subscription.payerEmail,
    payerId: provider.payer_id ? String(provider.payer_id) : null,
    paymentMethodId: provider.payment_method_id ?? null,
    nextPaymentDate: provider.next_payment_date ?? null,
    collectorId: provider.collector_id ? String(provider.collector_id) : null,
  };
}

async function requireAvailablePlan(planCode: "PRO") {
  const plan = await database.plan.findUnique({ where: { code: planCode } });
  if (!plan?.active) throw new HttpError(404, "Plan no disponible");
  return plan;
}

async function assertPlanCapacity(tenantId: string, maxProducts: number, maxMembers: number): Promise<void> {
  const [products, members, invitations] = await Promise.all([
    database.product.count({ where: { tenantId } }),
    database.membership.count({ where: { tenantId } }),
    database.teamInvitation.count({ where: { tenantId, acceptedAt: null, expiresAt: { gt: new Date() } } }),
  ]);
  if (products > maxProducts) throw new HttpError(409, `La tienda tiene ${products} productos y el plan admite ${maxProducts}`);
  if (members + invitations > maxMembers) throw new HttpError(409, `La tienda tiene ${members + invitations} miembros o invitaciones y el plan admite ${maxMembers}`);
}

export async function startBillingCheckout(input: {
  tenantId: string;
  tenantName: string;
  payerEmail: string;
  planCode: "PRO";
}) {
  const [plan, subscription] = await Promise.all([
    requireAvailablePlan(input.planCode),
    database.subscription.findUnique({ where: { tenantId: input.tenantId }, include: { plan: true } }),
  ]);
  if (!subscription) throw new HttpError(409, "La tienda no tiene una suscripción");
  await assertPlanCapacity(input.tenantId, plan.maxProducts, plan.maxMembers);

  if (subscription.providerSubscriptionId && subscription.providerStatus !== "canceled" && subscription.status !== "CANCELED") {
    const provider = await updateProviderSubscription(subscription.providerSubscriptionId, {
      planName: plan.name,
      tenantName: input.tenantName,
      priceInCents: plan.priceInCents,
      currency: plan.currency,
    });
    const authorized = provider.status === "authorized";
    const updated = await database.subscription.update({
      where: { tenantId: input.tenantId },
      data: authorized
        ? { planId: plan.id, pendingPlanId: null, providerStatus: provider.status, providerCheckoutUrl: provider.init_point ?? subscription.providerCheckoutUrl }
        : { pendingPlanId: plan.id, providerStatus: provider.status, providerCheckoutUrl: provider.init_point ?? subscription.providerCheckoutUrl },
      include: { plan: true, pendingPlan: true },
    });
    return { subscription: updated, checkoutUrl: provider.init_point ?? subscription.providerCheckoutUrl, requiresCheckout: !authorized };
  }

  const provider = await createProviderSubscription({
    tenantId: input.tenantId,
    tenantName: input.tenantName,
    payerEmail: input.payerEmail,
    planName: plan.name,
    priceInCents: plan.priceInCents,
    currency: plan.currency,
    trialEndsAt: subscription.trialEndsAt,
  });
  const updated = await database.subscription.update({
    where: { tenantId: input.tenantId },
    data: {
      pendingPlanId: plan.id,
      billingProvider: "MERCADO_PAGO",
      providerSubscriptionId: provider.id,
      providerStatus: provider.status,
      providerCheckoutUrl: provider.init_point ?? null,
      payerEmail: input.payerEmail,
    },
    include: { plan: true, pendingPlan: true },
  });
  if (!provider.init_point) throw new HttpError(502, "Mercado Pago no devolvió el enlace de suscripción");
  return { subscription: updated, checkoutUrl: provider.init_point, requiresCheckout: true };
}

export async function syncProviderSubscription(provider: ProviderSubscription) {
  const subscription = await database.subscription.findUnique({
    where: { providerSubscriptionId: provider.id },
    include: { plan: true, pendingPlan: true },
  });
  if (!subscription) throw new HttpError(404, "Suscripción de InfinityFood no encontrada");
  if (provider.external_reference && provider.external_reference !== subscription.tenantId) throw new HttpError(409, "La referencia del proveedor no coincide con la tienda");

  const trialActive = Boolean(subscription.trialEndsAt && subscription.trialEndsAt > new Date());
  const status = provider.status === "authorized" ? (trialActive ? "TRIALING" : "ACTIVE")
    : provider.status === "canceled" ? "CANCELED"
      : provider.status === "paused" ? "PAST_DUE"
        : trialActive ? "TRIALING" : "PAST_DUE";
  return database.subscription.update({
    where: { tenantId: subscription.tenantId },
    data: {
      status,
      providerStatus: provider.status,
      providerCheckoutUrl: provider.init_point ?? subscription.providerCheckoutUrl,
      ...(provider.status === "authorized" && subscription.pendingPlanId ? { planId: subscription.pendingPlanId, pendingPlanId: null } : {}),
      ...(provider.status === "canceled" ? { cancelAtPeriodEnd: false } : {}),
    },
    include: { plan: true, pendingPlan: true },
  });
}

export async function syncBillingSubscription(tenantId: string) {
  const subscription = await database.subscription.findUnique({ where: { tenantId } });
  if (!subscription?.providerSubscriptionId) throw new HttpError(409, "La tienda todavía no vinculó una suscripción automática");
  return syncProviderSubscription(await getProviderSubscription(subscription.providerSubscriptionId));
}

export async function syncProviderInvoice(providerInvoiceId: string) {
  const invoice = await getProviderInvoice(providerInvoiceId);
  if (!invoice.preapproval_id) throw new HttpError(400, "La factura no informa su suscripción");
  const subscription = await database.subscription.findUnique({
    where: { providerSubscriptionId: invoice.preapproval_id },
    include: { plan: true, pendingPlan: true },
  });
  if (!subscription) throw new HttpError(404, "Suscripción de la factura no encontrada");
  const plan = subscription.pendingPlan ?? subscription.plan;
  const rawStatus = invoice.payment?.status ?? invoice.status ?? "pending";
  const status = billingPaymentStatus(invoice.payment?.status);
  const periodFrom = invoice.debit_date ? new Date(invoice.debit_date) : invoice.date_created ? new Date(invoice.date_created) : new Date();
  const periodTo = new Date(periodFrom);
  periodTo.setUTCMonth(periodTo.getUTCMonth() + 1);
  const amountInCents = Math.round((invoice.transaction_amount ?? plan.priceInCents / 100) * 100);

  const saved = await database.billingInvoice.upsert({
    where: { provider_providerInvoiceId: { provider: "MERCADO_PAGO", providerInvoiceId: String(invoice.id) } },
    update: {
      providerPaymentId: invoice.payment?.id ? String(invoice.payment.id) : null,
      status,
      amountInCents,
      rawStatus,
      failureReason: status === "FAILED" ? invoice.payment?.status_detail ?? "Pago rechazado" : null,
      paidAt: status === "PAID" ? new Date() : null,
    },
    create: {
      tenantId: subscription.tenantId,
      provider: "MERCADO_PAGO",
      providerInvoiceId: String(invoice.id),
      providerPaymentId: invoice.payment?.id ? String(invoice.payment.id) : null,
      status,
      planCode: plan.code,
      planName: plan.name,
      amountInCents,
      currency: invoice.currency_id ?? plan.currency,
      periodFrom,
      periodTo,
      paidAt: status === "PAID" ? new Date() : null,
      failureReason: status === "FAILED" ? invoice.payment?.status_detail ?? "Pago rechazado" : null,
      rawStatus,
    },
  });

  if (status === "PAID") {
    await database.subscription.update({
      where: { tenantId: subscription.tenantId },
      data: { status: "ACTIVE", planId: plan.id, pendingPlanId: null, currentPeriodFrom: periodFrom, currentPeriodTo: periodTo, lastPaymentAt: new Date(), lastPaymentFailedAt: null },
    });
  } else if (status === "FAILED") {
    await database.subscription.update({ where: { tenantId: subscription.tenantId }, data: { status: "PAST_DUE", lastPaymentFailedAt: new Date() } });
  }
  return saved;
}

export async function cancelBillingSubscription(tenantId: string, immediately: boolean) {
  const subscription = await database.subscription.findUnique({ where: { tenantId }, include: { plan: true } });
  if (!subscription) throw new HttpError(404, "Suscripción no encontrada");
  if (!immediately) {
    return database.subscription.update({ where: { tenantId }, data: { cancelAtPeriodEnd: true }, include: { plan: true } });
  }
  if (subscription.providerSubscriptionId) await cancelProviderSubscription(subscription.providerSubscriptionId);
  return database.subscription.update({
    where: { tenantId },
    data: { status: "CANCELED", cancelAtPeriodEnd: false, providerStatus: subscription.providerSubscriptionId ? "canceled" : subscription.providerStatus },
    include: { plan: true },
  });
}

export async function processDueBillingCancellations(): Promise<number> {
  const due = await database.subscription.findMany({ where: { cancelAtPeriodEnd: true, currentPeriodTo: { lte: new Date() } } });
  let processed = 0;
  for (const subscription of due) {
    try {
      if (subscription.providerSubscriptionId) await cancelProviderSubscription(subscription.providerSubscriptionId);
      await database.subscription.update({ where: { tenantId: subscription.tenantId }, data: { status: "CANCELED", cancelAtPeriodEnd: false, providerStatus: subscription.providerSubscriptionId ? "canceled" : subscription.providerStatus } });
      processed += 1;
    } catch {
      // The next sweep retries provider or database failures.
    }
  }
  return processed;
}

export async function processExpiredTrials(): Promise<number> {
  const expired = await database.subscription.updateMany({
    where: { status: "TRIALING", trialEndsAt: { lte: new Date() } },
    data: { status: "PAST_DUE", lastPaymentFailedAt: new Date() },
  });
  return expired.count;
}
