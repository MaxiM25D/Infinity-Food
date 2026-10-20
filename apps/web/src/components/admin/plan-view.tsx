"use client";

import { ArrowRight, Boxes, Check, CircleDollarSign, CreditCard, RefreshCw, UsersRound } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { ApiError, apiRequest } from "@/lib/api";
import { confirmAction } from "@/lib/confirm-action";
import { EmptyState, Tip, panelStyles as styles } from "./guided-panel";
import type { Role } from "./types";

type Plan = {
  id: string; code: "STARTER" | "PRO"; name: string; description: string | null;
  priceInCents: number; currency: string; maxProducts: number; maxMembers: number; trialDays: number; features: string[];
};
type Invoice = {
  id: string; status: string; planName: string; amountInCents: number; currency: string;
  periodFrom: string | null; paidAt: string | null; failureReason: string | null; createdAt: string;
};
type Data = {
  subscription: {
    status: string; cancelAtPeriodEnd: boolean; trialEndsAt: string | null; currentPeriodFrom: string | null; currentPeriodTo: string | null;
    billingProvider: string | null; providerSubscriptionId: string | null; payerEmail: string | null;
    providerStatus: string | null; providerCheckoutUrl: string | null; lastPaymentAt: string | null; plan: Plan; pendingPlan: Plan | null;
  };
  usage: { products: number; members: number; monthlyOrders: number };
  plans: Plan[];
  invoices: Invoice[];
  billingConfigured: boolean;
};
type PaymentProfile = {
  linked: boolean; provider: string | null; status: string | null; payerEmail: string | null;
  payerId: string | null; paymentMethodId: string | null; nextPaymentDate: string | null; collectorId: string | null;
};

const featureLabels: Record<string, string> = {
  CORE_CATALOG: "Catálogo, carrito y checkout", TENANT_MP_OAUTH: "Mercado Pago por tienda",
  BANK_TRANSFER: "Transferencias y comprobantes", STOCK_MANAGEMENT: "Stock y pedidos",
  BASIC_CUSTOMERS: "Gestión básica de clientes", FEATURED_PRODUCTS: "Destacados, marcas y etiquetas",
  BASIC_TRANSACTIONAL_EMAILS: "Emails transaccionales", BASIC_STORE_CUSTOMIZATION: "Personalización básica",
  STANDARD_DOMAIN: "URL estándar InfinityFood", ADVANCED_ANALYTICS: "Analytics avanzados",
  COUPONS_PROMOTIONS: "Cupones y promociones", PRODUCT_VARIANTS: "Variantes de productos",
  ABANDONED_CART_RECOVERY: "Carritos abandonados", AUTOMATIONS: "Automatizaciones",
  CUSTOM_EMAILS: "Emails personalizados", CUSTOM_DOMAIN: "Dominio personalizado",
  ADVANCED_STORE_CUSTOMIZATION: "Personalización avanzada", PRIORITY_SUPPORT: "Soporte prioritario",
};
const visibleFeatures = (features: string[]) => features.filter((feature) => featureLabels[feature]);
const money = (amount: number, currency: string) => new Intl.NumberFormat("es-AR", { style: "currency", currency, maximumFractionDigits: 0 }).format(amount / 100);
const date = (value: string | null) => value ? new Date(value).toLocaleDateString("es-AR") : "—";
const statusLabels: Record<string, string> = { TRIALING: "Prueba gratuita", ACTIVE: "Activa", PAST_DUE: "Pago pendiente", CANCELED: "Cancelada" };
const invoiceLabels: Record<string, string> = { PAID: "Pagada", FAILED: "Fallida", PENDING: "Pendiente", OPEN: "Pendiente", REFUNDED: "Reembolsada" };
const providerStatusLabels: Record<string, string> = { authorized: "Activa", pending: "Pendiente de completar", paused: "Pausada", canceled: "Cancelada" };
const paymentMethodLabels: Record<string, string> = { account_money: "Dinero disponible en Mercado Pago", master: "Mastercard", visa: "Visa", amex: "American Express", debmaster: "Mastercard débito", debvisa: "Visa débito" };

export function PlanView({ role, onOpenStore }: { role: Role; onOpenStore: (section: "identity" | "payments") => void }) {
  const [data, setData] = useState<Data | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [paymentProfile, setPaymentProfile] = useState<PaymentProfile | null>(null);
  const [paymentProfileError, setPaymentProfileError] = useState(false);
  const load = useCallback(async () => setData(await apiRequest<Data>("/billing/overview")), []);

  useEffect(() => {
    let active = true;
    void apiRequest<Data>("/billing/overview")
      .then((value) => { if (active) setData(value); })
      .catch((caught) => { if (active) setError(caught instanceof Error ? caught.message : "No se pudo cargar la facturación"); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    const timeout = window.setTimeout(() => {
      if (!data?.subscription.providerSubscriptionId) {
        setPaymentProfile(null);
        return;
      }
      setPaymentProfileError(false);
      void apiRequest<PaymentProfile>("/billing/payment-profile")
        .then((value) => { if (active) setPaymentProfile(value); })
        .catch(() => { if (active) setPaymentProfileError(true); });
    }, 0);
    return () => { active = false; window.clearTimeout(timeout); };
  }, [data?.subscription.providerSubscriptionId, data?.subscription.providerStatus]);

  async function action(path: string, body?: object, success = "Suscripción actualizada.") {
    setBusy(true); setError(""); setNotice("");
    try { await apiRequest(path, { method: "POST", body: body ? JSON.stringify(body) : undefined }); await load(); setNotice(success); }
    catch (caught) { setError(caught instanceof ApiError ? caught.message : "No se pudo completar la operación"); }
    finally { setBusy(false); }
  }
  async function choosePlan(planCode: Plan["code"]) {
    setBusy(true); setError(""); setNotice("");
    try {
      const result = await apiRequest<{ checkoutUrl: string | null; requiresCheckout: boolean }>("/billing/checkout", { method: "POST", body: JSON.stringify({ planCode }) });
      if (result.requiresCheckout && result.checkoutUrl) { window.location.assign(result.checkoutUrl); return; }
      await load(); setNotice("Plan actualizado.");
    } catch (caught) { setError(caught instanceof ApiError ? caught.message : "No se pudo cambiar el plan"); }
    finally { setBusy(false); }
  }

  if (!data && !error) return <div role="status" className="h-80 animate-pulse rounded-2xl bg-[#eee9ef]" />;
  if (!data) return <div role="alert" className={styles.card}><p className="text-sm text-red-700">{error}</p><button className={`${styles.button} mt-4`} onClick={() => { setError(""); void load().catch((caught) => setError(caught instanceof Error ? caught.message : "No se pudo cargar la facturación")); }} type="button">Volver a intentar</button></div>;

  const { subscription, usage } = data;
  const canManage = role === "OWNER";
  const renewalDate = subscription.status === "TRIALING" ? subscription.trialEndsAt : subscription.currentPeriodTo;
  const hasProviderSubscription = Boolean(subscription.providerSubscriptionId);
  const payerEmail = paymentProfile?.payerEmail ?? subscription.payerEmail;
  const providerStatus = paymentProfile?.status ?? subscription.providerStatus;
  const automaticBillingActive = providerStatus === "authorized";
  const trialIsActive = subscription.status === "TRIALING" && Boolean(subscription.trialEndsAt);
  const trialDurationDays = subscription.trialEndsAt && subscription.currentPeriodFrom
    ? Math.max(0, Math.round((new Date(subscription.trialEndsAt).getTime() - new Date(subscription.currentPeriodFrom).getTime()) / 86_400_000))
    : subscription.plan.trialDays;
  const expectedFirstCharge = paymentProfile?.nextPaymentDate
    ?? (trialIsActive ? subscription.trialEndsAt : subscription.currentPeriodTo);
  const paymentMethod = paymentProfile?.paymentMethodId
    ? (paymentMethodLabels[paymentProfile.paymentMethodId] ?? paymentProfile.paymentMethodId)
    : !hasProviderSubscription || providerStatus === "pending" ? "Se elige al completar la suscripción" : "No informado por Mercado Pago";

  return <div className={`${styles.surface} mx-auto max-w-7xl space-y-7`}>
    <header><p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#6E3482]">Plan y uso</p><h2 className="mt-2 text-2xl font-semibold tracking-tight">Tu suscripción, explicada con claridad</h2><p className="mt-2 text-sm text-[#807384]">Un único plan con todas las herramientas, límites claros y facturación transparente.</p></header>

    <section className="overflow-hidden rounded-[1.75rem] bg-[#241329] text-white shadow-[0_24px_70px_rgba(52,31,59,.16)]">
      <div className="grid gap-7 p-6 sm:p-8 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
        <div><div className="flex flex-wrap items-center gap-2"><span className="rounded-full bg-white/10 px-3 py-1 text-xs font-semibold">{statusLabels[subscription.status] ?? "En revisión"}</span>{subscription.status === "TRIALING" && <span className="rounded-full bg-[#a56abd]/25 px-3 py-1 text-xs font-semibold">{trialDurationDays} días de prueba total</span>}</div><h3 className="mt-4 text-3xl font-semibold">Plan {subscription.plan.name}</h3><p className="mt-2 max-w-2xl text-sm leading-6 text-white/65">{subscription.status === "TRIALING" ? `Tu prueba finaliza el ${date(renewalDate)}. Después necesitás una suscripción activa para seguir operando.` : `El período actual termina el ${date(renewalDate)}.`}</p>{subscription.pendingPlan && <p className="mt-3 text-sm text-[#e2bdf0]">Cambio pendiente a {subscription.pendingPlan.name}.</p>}</div>
        <div className="lg:text-right"><p className="text-3xl font-semibold">{money(subscription.plan.priceInCents, subscription.plan.currency)}</p><p className="mt-1 text-xs text-white/55">por mes</p></div>
      </div>
      {subscription.cancelAtPeriodEnd && <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/10 bg-amber-400/10 px-6 py-4 text-sm text-amber-100 sm:px-8"><span>La suscripción terminará al finalizar el período actual. Hasta entonces podés seguir usando el plan.</span>{canManage && <button disabled={busy} onClick={() => void action("/billing/resume", undefined, "La suscripción continuará activa.")} className="font-semibold underline" type="button">Mantener suscripción</button>}</div>}
    </section>

    <section className="rounded-[1.5rem] border border-[#e6dfe8] bg-white p-6">
      <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-semibold">Facturación de tu plan</h3><p className="mt-1 text-xs leading-5 text-[#807384]">Este cobro es independiente de las ventas realizadas en tu tienda.</p></div><span className={`rounded-full px-3 py-1 text-xs font-semibold ${automaticBillingActive ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-800"}`}>{automaticBillingActive ? "Suscripción automática activa" : hasProviderSubscription ? "Suscripción pendiente" : "Sin suscripción automática"}</span></div>
      <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <BillingDatum label="Proveedor" value={hasProviderSubscription ? "Mercado Pago" : "Todavía no vinculado"} detail={providerStatus ? `Estado: ${providerStatusLabels[providerStatus] ?? providerStatus}` : undefined} />
        <BillingDatum label="Cuenta pagadora" value={payerEmail ?? "Se confirmará al contratar"} detail={paymentProfile?.payerId ? `Usuario MP ${paymentProfile.payerId}` : undefined} />
        <BillingDatum label="Medio de pago" value={paymentMethod} />
        <BillingDatum label={automaticBillingActive ? "Próximo cobro" : "Primer cobro estimado"} value={expectedFirstCharge ? date(expectedFirstCharge) : "Al confirmar en Mercado Pago"} detail={!automaticBillingActive ? "Se confirma al autorizar el medio de pago" : undefined} />
      </div>
      <div className="mt-4 rounded-xl bg-[#fbfafc] px-4 py-3 text-xs leading-5 text-[#66586a]"><strong>Cuenta receptora:</strong> InfinityFood by InfinityDev{paymentProfile?.collectorId ? ` · Usuario MP ${paymentProfile.collectorId}` : ""}. {paymentProfileError && "Mercado Pago no respondió al consultar el detalle; podés volver a intentar con Actualizar estado."}</div>
      {!automaticBillingActive && <div className="mt-4 rounded-xl bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-900"><strong>Tu plan está habilitado, pero el cobro recurrente no está activo.</strong> {trialIsActive ? `Si lo vinculás ahora, hoy pagás $0 y el primer cobro será el ${date(subscription.trialEndsAt)}.` : "La prueba ya terminó; Mercado Pago puede realizar el primer cobro cuando confirmes."} Antes de aceptar vas a ver la cuenta y el medio de pago elegidos.</div>}
    </section>

    {!automaticBillingActive && <section className="rounded-[1.5rem] border border-[#dfd2e4] bg-[#fbf7fc] p-6">
      <div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#6E3482]">Activación transparente</p><h3 className="mt-2 text-lg font-semibold">Probá primero. Pagá recién cuando corresponda.</h3><p className="mt-2 max-w-2xl text-sm leading-6 text-[#66586a]">Autorizar Mercado Pago no significa que ya ingresó dinero. El alta confirma quién paga y con qué medio; el cobro real recién queda acreditado cuando aparece una factura pagada.</p></div><span className="rounded-full bg-white px-3 py-1.5 text-xs font-semibold text-[#6E3482] shadow-sm">Sin comisión por venta</span></div>
      <ol className="mt-5 grid gap-3 md:grid-cols-3">
        <ActivationStep number="1" title="Hoy" detail={trialIsActive ? "Vinculás Mercado Pago y pagás $0." : "Elegís tu cuenta y medio de pago."} />
        <ActivationStep number="2" title={expectedFirstCharge ? date(expectedFirstCharge) : "Al confirmar"} detail={`Mercado Pago intenta el primer cobro de ${money(subscription.plan.priceInCents, subscription.plan.currency)}.`} />
        <ActivationStep number="3" title="Acreditación" detail="La factura pagada confirma que InfinityFood recibió el dinero." />
      </ol>
    </section>}

    {error && <p role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
    {notice && <p role="status" className="rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{notice}</p>}
    {!canManage && <Tip title="Acceso de consulta">Solo el Propietario puede cambiar o cancelar el plan. Tu rol puede consultar el uso y las facturas.</Tip>}

    <section><div><h3 className="text-lg font-semibold">Uso del plan actual</h3><p className="mt-1 text-sm text-[#807384]">Los límites se aplican a productos y personas del equipo. Los pedidos no tienen límite mensual.</p></div><div className="mt-4 grid gap-4 md:grid-cols-3"><Usage icon={Boxes} label="Productos" value={usage.products} limit={subscription.plan.maxProducts} help="Productos cargados, visibles u ocultos." /><Usage icon={UsersRound} label="Miembros" value={usage.members} limit={subscription.plan.maxMembers} help="Incluye al Propietario. Las invitaciones pendientes también reservan lugar." /><article className={styles.card}><div className="flex items-start justify-between"><div><p className="text-sm font-medium text-[#807384]">Pedidos este mes</p><p className="mt-3 text-3xl font-semibold">{usage.monthlyOrders}</p><p className="mt-2 text-xs leading-5 text-emerald-700">Sin límite por plan.</p></div><span className="rounded-lg bg-[#f5eff8] p-2 text-[#6E3482]"><CircleDollarSign size={18} /></span></div></article></div></section>

    <section><div><h3 className="text-lg font-semibold">InfinityFood Pro</h3><p className="mt-1 text-sm text-[#807384]">Todas las funciones están incluidas por {money(subscription.plan.priceInCents, subscription.plan.currency)} mensuales, sin comisión de InfinityFood por venta.</p></div>
      <div className="mt-5 grid gap-5">{data.plans.map((plan) => {
        const current = plan.id === subscription.plan.id;
        return <article className={`flex flex-col rounded-[1.5rem] border bg-white p-6 ${current ? "border-[#a56abd] ring-2 ring-[#eaddef]" : "border-[#e6dfe8]"}`} key={plan.id}>
          <div className="flex justify-between gap-4"><div><h4 className="text-xl font-semibold">{plan.name}</h4><p className="mt-2 text-sm leading-6 text-[#807384]">{plan.description}</p></div><span className="h-fit rounded-full bg-[#f4eff7] px-2.5 py-1 text-xs font-semibold text-[#6E3482]">{current ? "Plan habilitado" : "Precio de lanzamiento"}</span></div>
          <p className="mt-5 text-3xl font-semibold">{money(plan.priceInCents, plan.currency)}<span className="text-sm font-normal text-[#918495]"> / mes</span></p>
          <div className="mt-4 grid grid-cols-2 gap-3 rounded-xl bg-[#fbfafc] p-4 text-sm"><div><p className="text-xs text-[#918495]">Productos</p><p className="mt-1 font-semibold">Hasta {plan.maxProducts}</p></div><div><p className="text-xs text-[#918495]">Colaboradores</p><p className="mt-1 font-semibold">{Math.max(0, plan.maxMembers - 1)} + propietario</p></div></div>
          <p className="mt-5 text-xs font-semibold uppercase tracking-[0.14em] text-[#6E3482]">Incluye</p><ul className="mt-3 grid gap-2 text-sm text-[#66586a] sm:grid-cols-2">{visibleFeatures(plan.features).map((feature) => <li className="flex gap-2" key={feature}><Check className="mt-0.5 shrink-0 text-[#6E3482]" size={15} /><span>{featureLabels[feature]}</span></li>)}</ul>
          {canManage && (!current || !automaticBillingActive) && <div className="mt-auto pt-6"><button className={`${styles.button} w-full`} disabled={busy || !data.billingConfigured} onClick={async () => { const planPrice = money(plan.priceInCents, plan.currency); const confirmed = await confirmAction({ title: "¿Vincular Mercado Pago?", description: trialIsActive ? `Hoy pagás $0. Vas a elegir la cuenta y el medio de pago para autorizar el cobro mensual de ${planPrice} desde el ${date(subscription.trialEndsAt)}. Podés cancelar antes de esa fecha.` : `La prueba gratuita ya terminó. Vas a elegir la cuenta y el medio de pago; Mercado Pago puede cobrar ${planPrice} al confirmar y luego cada mes.`, confirmLabel: "Continuar de forma segura" }); if (confirmed) void choosePlan(plan.code); }} type="button">Vincular Mercado Pago <ArrowRight size={15} /></button><p className="mt-3 text-center text-xs leading-5 text-[#807384]">{trialIsActive ? `Hoy $0 · primer cobro el ${date(subscription.trialEndsAt)}` : `${money(plan.priceInCents, plan.currency)} por mes · cancelá cuando quieras`}</p></div>}
        </article>;
      })}</div>
      {!data.billingConfigured && <Tip title="Cobro automático pendiente">Los planes se pueden consultar, pero InfinityFood todavía no tiene configuradas sus credenciales de cobro SaaS en Mercado Pago. Por eso el cambio de plan está deshabilitado.</Tip>}
    </section>

    <section className="overflow-hidden rounded-[1.5rem] border border-[#e6dfe8] bg-white">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-[#eee9ef] px-6 py-5"><div><h3 className="font-semibold">Facturas de InfinityFood</h3><p className="mt-1 text-xs leading-5 text-[#807384]">Son los cobros de tu plan SaaS; no son ventas realizadas en tu tienda.</p></div><div className="flex items-center gap-3">{canManage && subscription.providerStatus && <button className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#6E3482]" disabled={busy} onClick={() => void action("/billing/sync", undefined, "Estado sincronizado con Mercado Pago.")} type="button"><RefreshCw size={14} /> Actualizar estado</button>}{canManage && hasProviderSubscription && !subscription.cancelAtPeriodEnd && subscription.status !== "CANCELED" && <button className="text-xs font-semibold text-red-600 disabled:opacity-50" disabled={busy} onClick={async () => { const confirmed = await confirmAction({ title: "¿Cancelar la suscripción?", description: "Podrás usar el plan hasta que termine el período actual.", confirmLabel: "Programar cancelación", tone: "danger" }); if (confirmed) void action("/billing/cancel", { immediately: false }, "La cancelación quedó programada."); }} type="button">Cancelar suscripción</button>}</div></div>
      {data.invoices.length === 0 ? <div className="p-6"><EmptyState title="Todavía no hay facturas">Cuando se procese un cobro de InfinityFood, aparecerá acá con su fecha, estado e importe.</EmptyState></div> : <div className="overflow-x-auto"><table className="w-full min-w-[42rem] text-left text-sm"><caption className="sr-only">Historial de facturas de InfinityFood</caption><thead className="bg-[#fbfafc] text-xs uppercase tracking-wider text-[#918495]"><tr><th scope="col" className="px-5 py-3">Fecha</th><th scope="col" className="px-5 py-3">Plan</th><th scope="col" className="px-5 py-3">Estado</th><th scope="col" className="px-5 py-3 text-right">Importe</th></tr></thead><tbody className="divide-y divide-[#eee9ef]">{data.invoices.map((invoice) => <tr key={invoice.id}><td className="px-5 py-4">{date(invoice.periodFrom ?? invoice.createdAt)}</td><td className="px-5 py-4">{invoice.planName}</td><td className="px-5 py-4"><span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${invoice.status === "PAID" ? "bg-emerald-50 text-emerald-700" : invoice.status === "FAILED" ? "bg-red-50 text-red-700" : "bg-amber-50 text-amber-800"}`}>{invoiceLabels[invoice.status] ?? "En revisión"}</span>{invoice.failureReason && <p className="mt-1 max-w-md text-xs text-red-600">{invoice.failureReason}</p>}</td><td className="px-5 py-4 text-right font-semibold">{money(invoice.amountInCents, invoice.currency)}</td></tr>)}</tbody></table></div>}
    </section>
    <Tip title="Configuración de cobros de tu tienda"><CreditCard className="mr-1 inline h-4 w-4" /> Mercado Pago y las transferencias de tus clientes se configuran en <button className="font-semibold underline" onClick={() => onOpenStore("identity")} type="button">Mi tienda</button>, dentro de <button className="font-semibold underline" onClick={() => onOpenStore("payments")} type="button">Cobros</button>. Esta sección administra únicamente el plan de InfinityFood.</Tip>
  </div>;
}

function Usage({ icon: Icon, label, value, limit, help }: { icon: typeof Boxes; label: string; value: number; limit: number; help: string }) {
  const percentage = limit > 0 ? Math.min(100, Math.round((value / limit) * 100)) : 100;
  return <article className={styles.card}><div className="flex items-start justify-between gap-3"><div className="flex-1"><div className="flex justify-between gap-3"><p className="text-sm font-medium text-[#807384]">{label}</p><p className="text-sm font-semibold">{value} / {limit}</p></div><div className="mt-4 h-2 overflow-hidden rounded-full bg-[#eee9ef]"><div className={`h-full rounded-full ${percentage >= 90 ? "bg-red-500" : "bg-[#6E3482]"}`} style={{ width: `${percentage}%` }} /></div><p className="mt-2 text-xs text-[#918495]">{percentage}% utilizado · {help}</p></div><span className="rounded-lg bg-[#f5eff8] p-2 text-[#6E3482]"><Icon size={17} /></span></div></article>;
}

function BillingDatum({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return <div className="rounded-xl border border-[#eee9ef] p-4"><p className="text-xs text-[#918495]">{label}</p><p className="mt-1 break-words text-sm font-semibold text-[#302433]">{value}</p>{detail && <p className="mt-1 text-xs text-[#918495]">{detail}</p>}</div>;
}

function ActivationStep({ number, title, detail }: { number: string; title: string; detail: string }) {
  return <li className="flex gap-3 rounded-xl bg-white p-4 shadow-[0_8px_24px_rgba(73,34,91,.06)]"><span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#6E3482] text-xs font-bold text-white">{number}</span><div><p className="text-sm font-semibold text-[#302433]">{title}</p><p className="mt-1 text-xs leading-5 text-[#807384]">{detail}</p></div></li>;
}
