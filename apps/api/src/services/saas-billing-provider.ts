import { environment } from "../config.js";
import { HttpError } from "../errors.js";

const mercadoPagoApi = "https://api.mercadopago.com";

export type ProviderSubscription = {
  id: string;
  status: string;
  reason?: string;
  application_id?: number;
  collector_id?: number;
  external_reference?: string;
  init_point?: string;
  payer_id?: number;
  payer_email?: string;
  card_id?: number | string;
  payment_method_id?: string;
  next_payment_date?: string;
  auto_recurring?: { transaction_amount?: number; currency_id?: string; start_date?: string };
};

export type ProviderInvoice = {
  id: number | string;
  preapproval_id?: string;
  status?: string;
  transaction_amount?: number;
  currency_id?: string;
  debit_date?: string;
  date_created?: string;
  payment?: { id?: number | string; status?: string; status_detail?: string };
};

function accessToken(): string {
  if (environment.SAAS_BILLING_PROVIDER !== "mercado_pago" || !environment.SAAS_MP_ACCESS_TOKEN) {
    throw new HttpError(503, "La facturación automática de InfinityFood todavía no está configurada");
  }
  return environment.SAAS_MP_ACCESS_TOKEN;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${mercadoPagoApi}${path}`, {
    ...init,
    signal: AbortSignal.timeout(15_000),
    headers: {
      Authorization: `Bearer ${accessToken()}`,
      "Content-Type": "application/json",
      ...init.headers,
    },
  });
  const body = await response.json().catch(() => null) as (T & { message?: string }) | null;
  if (!response.ok || !body) throw new HttpError(502, body?.message ?? "Mercado Pago no pudo procesar la facturación de InfinityFood");
  return body;
}

export function billingProviderConfigured(): boolean {
  return environment.SAAS_BILLING_PROVIDER === "mercado_pago" && Boolean(environment.SAAS_MP_ACCESS_TOKEN);
}

export async function createProviderSubscription(input: {
  tenantId: string;
  tenantName: string;
  payerEmail: string;
  planName: string;
  priceInCents: number;
  currency: string;
  trialEndsAt: Date | null;
}): Promise<ProviderSubscription> {
  const body: Record<string, unknown> = {
    reason: `InfinityFood ${input.planName} - ${input.tenantName}`,
    external_reference: input.tenantId,
    payer_email: input.payerEmail,
    back_url: `${environment.WEB_URL.replace(/\/$/, "")}/admin?section=plan&billing=return`,
    notification_url: `${environment.API_PUBLIC_URL.replace(/\/$/, "")}/api/billing/mercadopago/webhook?source_news=webhooks`,
    status: "pending",
    auto_recurring: {
      frequency: 1,
      frequency_type: "months",
      transaction_amount: input.priceInCents / 100,
      currency_id: input.currency,
      ...(input.trialEndsAt && input.trialEndsAt > new Date() ? { start_date: input.trialEndsAt.toISOString() } : {}),
    },
  };
  return request<ProviderSubscription>("/preapproval", { method: "POST", body: JSON.stringify(body) });
}

export async function updateProviderSubscription(providerId: string, input: {
  planName: string;
  tenantName: string;
  priceInCents: number;
  currency: string;
}): Promise<ProviderSubscription> {
  return request<ProviderSubscription>(`/preapproval/${encodeURIComponent(providerId)}`, {
    method: "PUT",
    body: JSON.stringify({
      reason: `InfinityFood ${input.planName} - ${input.tenantName}`,
      auto_recurring: { transaction_amount: input.priceInCents / 100, currency_id: input.currency },
    }),
  });
}

export async function cancelProviderSubscription(providerId: string): Promise<ProviderSubscription> {
  return request<ProviderSubscription>(`/preapproval/${encodeURIComponent(providerId)}`, {
    method: "PUT",
    body: JSON.stringify({ status: "canceled" }),
  });
}

export function getProviderSubscription(providerId: string): Promise<ProviderSubscription> {
  return request<ProviderSubscription>(`/preapproval/${encodeURIComponent(providerId)}`);
}

export function getProviderInvoice(providerInvoiceId: string): Promise<ProviderInvoice> {
  return request<ProviderInvoice>(`/authorized_payments/${encodeURIComponent(providerInvoiceId)}`);
}
