"use client";

import { Activity, ArrowLeft, Boxes, Building2, CircleDollarSign, CreditCard, ExternalLink, Globe2, History, LogIn, MailCheck, RefreshCw, Search, ShieldCheck, ShoppingBag, Store, TriangleAlert, UsersRound } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { BrandLogo } from "@/components/brand-logo";
import { EmptyState, Tip, panelStyles as styles } from "@/components/admin/guided-panel";
import { ApiError, apiRequest } from "@/lib/api";
import { confirmAction } from "@/lib/confirm-action";

type Overview = {
  tenants: number; activeTenants: number; users: number;
  subscriptions: Array<{ status: string; _count: number }>;
  estimatedMonthlyRevenueInCents: number; orders: number; approvedGmvInCents: number;
  storefrontViews: number; abandonedCarts: number;
  notifications: Array<{ status: string; _count: number }>;
  invoices: Array<{ status: string; _count: number }>;
  domains: Array<{ status: string; _count: number }>;
  trialsEndingSoon: number; newTenantsLast30Days: number;
};
type Plan = {
  id: string; code: string; name: string; priceInCents: number; currency: string;
  maxProducts: number; maxMembers: number; maxOrdersPerMonth: number | null; trialDays: number;
  active: boolean; _count: { subscriptions: number };
};
type PlanUpdateResult = {
  plan: Plan;
  synchronization: { requested: boolean; eligible: number; updated: number; failed: Array<{ tenantName: string; message: string }> };
};
type Tenant = {
  id: string; name: string; slug: string; status: "ACTIVE" | "SUSPENDED"; createdAt: string;
  subscription: { status: string; cancelAtPeriodEnd: boolean; plan: Plan } | null;
  _count: { memberships: number; products: number; orders: number };
};
type SupportAccessLog = {
  id: string; reason: string; startedAt: string; endedAt: string | null;
  user: { id: string; firstName: string; lastName: string; email: string };
  tenant: { id: string; name: string; slug: string };
};
type Section = "overview" | "stores" | "plans" | "operations" | "support";

const money = (amount: number) => new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 }).format(amount / 100);
const dateTime = (value: string) => new Intl.DateTimeFormat("es-AR", { dateStyle: "short", timeStyle: "short" }).format(new Date(value));
const accessDuration = (startedAt: string, endedAt: string | null) => {
  if (!endedAt) return "En curso";
  const minutes = Math.max(1, Math.round((new Date(endedAt).getTime() - new Date(startedAt).getTime()) / 60_000));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours} h${remainingMinutes ? ` ${remainingMinutes} min` : ""}`;
};
const subscriptionLabels: Record<string, string> = { TRIALING: "Prueba", ACTIVE: "Activa", PAST_DUE: "Pago pendiente", CANCELED: "Cancelada" };

export function PlatformPanel({ initialSection = "overview" }: { initialSection?: Section }) {
  const router = useRouter();
  const [overview, setOverview] = useState<Overview | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [supportLogs, setSupportLogs] = useState<SupportAccessLog[]>([]);
  const [section, setSection] = useState<Section>(initialSection);
  const [search, setSearch] = useState("");
  const [tenantFilter, setTenantFilter] = useState("ALL");
  const [subscriptionFilter, setSubscriptionFilter] = useState("ALL");
  const [supportTenantFilter, setSupportTenantFilter] = useState("ALL");
  const [supportUserFilter, setSupportUserFilter] = useState("ALL");
  const [supportFrom, setSupportFrom] = useState("");
  const [supportTo, setSupportTo] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    const [overviewData, plansData, tenantsData, supportData] = await Promise.all([
      apiRequest<Overview>("/platform/overview"),
      apiRequest<{ plans: Plan[] }>("/platform/plans"),
      apiRequest<{ tenants: Tenant[] }>("/platform/tenants"),
      apiRequest<{ logs: SupportAccessLog[] }>("/platform/support-access-logs"),
    ]);
    setOverview(overviewData); setPlans(plansData.plans); setTenants(tenantsData.tenants); setSupportLogs(supportData.logs);
  }

  useEffect(() => {
    apiRequest<{ user: { platformRole: string } }>("/auth/me")
      .then(({ user }) => { if (user.platformRole !== "SUPERADMIN") router.replace("/admin"); else void load().catch(handleError); })
      .catch(() => router.replace("/login"));
  }, [router]);

  function handleError(caught: unknown) { setError(caught instanceof ApiError ? caught.message : "No se pudo completar la operación"); }

  function selectSection(nextSection: Section) {
    setSection(nextSection);
    router.replace(`/platform?section=${nextSection}`, { scroll: false });
  }

  async function refresh() {
    setBusy(true); setError(""); setNotice("");
    try { await load(); setNotice("Datos globales actualizados."); }
    catch (caught) { handleError(caught); }
    finally { setBusy(false); }
  }

  async function updateTenant(tenant: Tenant) {
    const nextStatus = tenant.status === "ACTIVE" ? "SUSPENDED" : "ACTIVE";
    const suspending = nextStatus === "SUSPENDED";
    if (!(await confirmAction({
      title: suspending ? `¿Suspender ${tenant.name}?` : `¿Reactivar ${tenant.name}?`,
      description: suspending ? "Sus clientes no podrán comprar y su equipo perderá el acceso hasta reactivarla." : "La tienda y su panel volverán a estar disponibles.",
      confirmLabel: suspending ? "Suspender tienda" : "Reactivar tienda",
      tone: suspending ? "danger" : "primary",
    }))) return;
    setBusy(true); setError(""); setNotice("");
    try { await apiRequest(`/platform/tenants/${tenant.id}`, { method: "PATCH", body: JSON.stringify({ status: nextStatus }) }); await load(); setNotice(nextStatus === "ACTIVE" ? "Tienda reactivada." : "Tienda suspendida."); }
    catch (caught) { handleError(caught); }
    finally { setBusy(false); }
  }

  async function startSupportAccess(tenant: Tenant) {
    if (!(await confirmAction({
      title: `¿Administrar ${tenant.name} como soporte?`,
      description: "Vas a ingresar temporalmente con permisos de administrador. Los cambios serán reales y el acceso quedará registrado. La facturación, Mercado Pago y el equipo permanecen protegidos.",
      confirmLabel: "Ingresar como soporte",
    }))) return;
    setBusy(true); setError(""); setNotice("");
    try {
      await apiRequest(`/platform/tenants/${tenant.id}/support-access`, {
        method: "POST",
        body: JSON.stringify({ reason: "Configuración asistida desde el Panel SaaS" }),
      });
      router.push("/admin");
      router.refresh();
    } catch (caught) {
      handleError(caught);
      setBusy(false);
    }
  }

  async function updateSubscription(tenant: Tenant, body: { planCode?: string; status?: string }) {
    const description = body.planCode
      ? `cambiar el plan de ${tenant.name} a ${plans.find((plan) => plan.code === body.planCode)?.name ?? body.planCode}`
      : `cambiar la suscripción de ${tenant.name} a ${subscriptionLabels[body.status ?? ""] ?? body.status}`;
    if (!(await confirmAction({ title: `¿Confirmás ${description}?`, description: "Este cambio administrativo se aplica directamente y no inicia un cobro en Mercado Pago.", confirmLabel: "Aplicar cambio" }))) return;
    setBusy(true); setError(""); setNotice("");
    try { await apiRequest(`/platform/tenants/${tenant.id}/subscription`, { method: "PATCH", body: JSON.stringify(body) }); await load(); setNotice("Suscripción actualizada."); }
    catch (caught) { handleError(caught); }
    finally { setBusy(false); }
  }

  async function updateCommercialPlan(plan: Plan, priceInCents: number, trialDays: number) {
    if (!(await confirmAction({
      title: "¿Aplicar la nueva configuración comercial?",
      description: `Las nuevas tiendas tendrán ${trialDays} día${trialDays === 1 ? "" : "s"} de prueba. El precio mensual será ${money(priceInCents)} y se sincronizará con las suscripciones vigentes de Mercado Pago. Las facturas anteriores no cambian.`,
      confirmLabel: "Guardar y sincronizar",
    }))) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const result = await apiRequest<PlanUpdateResult>(`/platform/plans/${plan.code}`, {
        method: "PATCH",
        body: JSON.stringify({ priceInCents, trialDays, syncExistingSubscriptions: true }),
      });
      await load();
      if (result.synchronization.failed.length > 0) {
        const names = result.synchronization.failed.map(({ tenantName }) => tenantName).join(", ");
        setError(`La configuración quedó guardada, pero Mercado Pago no pudo actualizar ${result.synchronization.failed.length} suscripción(es): ${names}. Volvé a guardar para reintentar.`);
      } else {
        setNotice(`Plan actualizado. ${result.synchronization.updated} suscripción(es) sincronizada(s) con Mercado Pago.`);
      }
    } catch (caught) { handleError(caught); }
    finally { setBusy(false); }
  }

  const filteredTenants = useMemo(() => {
    const term = search.trim().toLocaleLowerCase("es");
    return tenants.filter((tenant) => {
      const matchesTerm = !term || [tenant.name, tenant.slug].some((value) => value.toLocaleLowerCase("es").includes(term));
      return matchesTerm && (tenantFilter === "ALL" || tenant.status === tenantFilter) && (subscriptionFilter === "ALL" || tenant.subscription?.status === subscriptionFilter);
    });
  }, [tenants, search, tenantFilter, subscriptionFilter]);

  const filteredSupportLogs = useMemo(() => supportLogs.filter((log) => {
    const startedAt = new Date(log.startedAt);
    const from = supportFrom ? new Date(`${supportFrom}T00:00:00`) : null;
    const to = supportTo ? new Date(`${supportTo}T23:59:59.999`) : null;
    return (supportTenantFilter === "ALL" || log.tenant.id === supportTenantFilter)
      && (supportUserFilter === "ALL" || log.user.id === supportUserFilter)
      && (!from || startedAt >= from)
      && (!to || startedAt <= to);
  }), [supportLogs, supportTenantFilter, supportUserFilter, supportFrom, supportTo]);

  const supportTenants = useMemo(
    () => Array.from(new Map(supportLogs.map((log) => [log.tenant.id, log.tenant])).values()),
    [supportLogs],
  );
  const supportUsers = useMemo(
    () => Array.from(new Map(supportLogs.map((log) => [log.user.id, log.user])).values()),
    [supportLogs],
  );

  if (!overview) return <main className="grid min-h-screen place-items-center bg-[#17131a] text-white"><div className="flex items-center gap-3 text-sm"><span className="h-3 w-3 animate-pulse rounded-full bg-[#a56abd]" /> Cargando plataforma…</div></main>;

  const activeSubscriptions = overview.subscriptions.filter(({ status }) => ["ACTIVE", "TRIALING"].includes(status)).reduce((total, item) => total + item._count, 0);
  const pastDue = overview.subscriptions.find(({ status }) => status === "PAST_DUE")?._count ?? 0;
  const notificationCount = (status: string) => overview.notifications.find((item) => item.status === status)?._count ?? 0;
  const invoiceCount = (status: string) => overview.invoices.find((item) => item.status === status)?._count ?? 0;
  const domainCount = (status: string) => overview.domains.find((item) => item.status === status)?._count ?? 0;
  const metrics = [
    { label: "Tiendas activas", value: `${overview.activeTenants} / ${overview.tenants}`, help: "Tiendas disponibles sobre el total registrado.", icon: Store },
    { label: "Usuarios", value: overview.users, help: "Cuentas únicas con acceso a una o más tiendas.", icon: UsersRound },
    { label: "Suscripciones vigentes", value: activeSubscriptions, help: "Incluye planes activos y períodos de prueba.", icon: CreditCard },
    { label: "MRR estimado", value: money(overview.estimatedMonthlyRevenueInCents), help: "Ingreso mensual estimado según planes vigentes; no reemplaza cobros reales.", icon: CircleDollarSign },
    { label: "Pedidos procesados", value: overview.orders, help: "Pedidos creados entre todas las tiendas.", icon: ShoppingBag },
    { label: "GMV aprobado", value: money(overview.approvedGmvInCents), help: "Volumen vendido con pago aprobado; no es ingreso de InfinityFood.", icon: Activity },
    { label: "Visitas a tiendas", value: overview.storefrontViews, help: "Aperturas registradas de tiendas públicas.", icon: Building2 },
    { label: "Carritos abandonados", value: overview.abandonedCarts, help: "Carritos marcados como abandonados en toda la plataforma.", icon: Boxes },
  ];

  const nav: Array<{ id: Section; label: string; help: string }> = [
    { id: "overview", label: "Vista general", help: "Métricas globales" },
    { id: "stores", label: "Tiendas", help: "Acceso y suscripciones" },
    { id: "plans", label: "Planes", help: "Precios y capacidad" },
    { id: "operations", label: "Operación", help: "Emails, cobros y dominios" },
    { id: "support", label: "Historial de soporte", help: "Accesos administrativos" },
  ];

  return <div className="min-h-screen bg-[#f8f7f9] text-[#211b23]">
    <header className="border-b border-white/[0.07] bg-[#17131a] text-white"><div className="mx-auto flex max-w-[94rem] items-center justify-between px-5 py-5 sm:px-8"><BrandLogo subtitle="Administración interna" /><Link className="inline-flex items-center gap-2 rounded-full border border-white/15 px-4 py-2 text-xs font-semibold text-white/70 transition hover:bg-white/[0.07] hover:text-white" href="/admin"><ArrowLeft size={14} /> Volver a mi tienda</Link></div></header>
    <main className={`${styles.surface} mx-auto max-w-[94rem] px-5 py-8 sm:px-8 sm:py-10`}>
      <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div><p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#6E3482]">Panel SaaS</p><h1 className="mt-2 text-3xl font-semibold tracking-tight">Control de InfinityFood</h1><p className="mt-2 max-w-3xl text-sm leading-6 text-[#807384]">Supervisá la plataforma completa. Las ventas de las tiendas y los ingresos por suscripciones se muestran por separado.</p></div><button className="inline-flex items-center justify-center gap-2 rounded-xl border border-[#e6dfe8] bg-white px-4 py-2.5 text-xs font-semibold text-[#6E3482] transition hover:bg-[#fdfafe] disabled:opacity-50" disabled={busy} onClick={() => void refresh()} type="button"><RefreshCw className={busy ? "animate-spin" : ""} size={14} /> Actualizar datos</button></header>
      <nav aria-label="Secciones del Panel SaaS" className="my-7 grid gap-2 rounded-2xl border border-[#e6dfe8] bg-white p-2 sm:grid-cols-2 lg:grid-cols-5">{nav.map((item) => <button aria-current={section === item.id ? "page" : undefined} className={`rounded-xl px-4 py-3 text-left transition ${section === item.id ? "bg-[#f0e7f3] text-[#49225B]" : "text-[#807384] hover:bg-[#fbf8fc]"}`} key={item.id} onClick={() => selectSection(item.id)} type="button"><span className="block text-sm font-semibold">{item.label}</span><span className="mt-1 block text-xs opacity-70">{item.help}</span></button>)}</nav>
      {error && <p role="alert" className="mb-5 rounded-xl bg-red-50 p-4 text-sm text-red-700">{error}</p>}
      {notice && <p role="status" className="mb-5 rounded-xl bg-emerald-50 p-4 text-sm text-emerald-700">{notice}</p>}

      {section === "overview" && <div className="space-y-7">
        {pastDue > 0 && <div className="flex gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900"><TriangleAlert className="shrink-0" size={18} /><div><p className="font-semibold">{pastDue} suscripción{pastDue === 1 ? "" : "es"} con pago pendiente</p><p className="mt-1 text-xs leading-5">Revisalas en Tiendas antes de suspender el acceso. Un pago pendiente no confirma por sí solo una deuda real.</p></div></div>}
        <section aria-label="Métricas globales" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{metrics.map((metric) => <Metric key={metric.label} {...metric} />)}</section>
        <div className="grid gap-5 lg:grid-cols-2">
          <section className={styles.card}><h2 className="font-semibold">Estado de suscripciones</h2><p className="mt-1 text-xs leading-5 text-[#807384]">Cantidad de tiendas en cada estado administrativo.</p><div className="mt-5 grid grid-cols-2 gap-3">{overview.subscriptions.map((item) => <div className="rounded-xl bg-[#fbfafc] p-4" key={item.status}><p className="text-xs text-[#807384]">{subscriptionLabels[item.status] ?? "En revisión"}</p><p className="mt-2 text-2xl font-semibold">{item._count}</p></div>)}</div></section>
          <section className={styles.card}><h2 className="font-semibold">Acciones rápidas</h2><p className="mt-1 text-xs leading-5 text-[#807384]">Entrá a una sección antes de realizar cambios globales.</p><div className="mt-5 space-y-2"><button className="flex w-full items-center justify-between rounded-xl border border-[#e6dfe8] px-4 py-3 text-left text-sm font-semibold text-[#6E3482] hover:bg-[#fdfafe]" onClick={() => selectSection("stores")} type="button">Revisar tiendas <span>→</span></button><button className="flex w-full items-center justify-between rounded-xl border border-[#e6dfe8] px-4 py-3 text-left text-sm font-semibold text-[#6E3482] hover:bg-[#fdfafe]" onClick={() => selectSection("operations")} type="button">Revisar operación <span>→</span></button></div><Tip title="Cuidado con los cambios manuales">Cambiar un plan o estado desde este panel no cobra, devuelve dinero ni sincroniza automáticamente una suscripción de Mercado Pago.</Tip></section>
        </div>
      </div>}

      {section === "stores" && <section>
        <div><h2 className="text-xl font-semibold">Tiendas y suscripciones</h2><p className="mt-1 text-sm text-[#807384]">Buscá una tienda y revisá su uso antes de modificar el acceso o el plan.</p></div>
        <div className="mt-5 rounded-2xl border border-[#e6dfe8] bg-white p-4"><div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_13rem_13rem]"><label className="relative"><span className="sr-only">Buscar tienda</span><Search className="absolute left-3.5 top-3.5 h-4 w-4 text-[#918495]" /><input className="control pl-10!" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Nombre o dirección" /></label><select aria-label="Filtrar acceso de tienda" className="control" value={tenantFilter} onChange={(event) => setTenantFilter(event.target.value)}><option value="ALL">Todos los accesos</option><option value="ACTIVE">Activas</option><option value="SUSPENDED">Suspendidas</option></select><select aria-label="Filtrar suscripción" className="control" value={subscriptionFilter} onChange={(event) => setSubscriptionFilter(event.target.value)}><option value="ALL">Todas las suscripciones</option><option value="TRIALING">Prueba</option><option value="ACTIVE">Activas</option><option value="PAST_DUE">Pago pendiente</option><option value="CANCELED">Canceladas</option></select></div><p className="mt-3 text-xs text-[#918495]">Mostrando {filteredTenants.length} de {tenants.length} tiendas.</p></div>
        {filteredTenants.length === 0 ? <div className="mt-5"><EmptyState title="No encontramos tiendas">Probá otra búsqueda o limpiá los filtros.</EmptyState></div> : <div className="mt-5 overflow-hidden rounded-2xl border border-[#e6dfe8] bg-white"><div className="overflow-x-auto"><table className="w-full min-w-[74rem] text-left text-sm"><caption className="sr-only">Tiendas, uso, plan, suscripción y acceso</caption><thead className="bg-[#fbfafc] text-xs uppercase tracking-wider text-[#918495]"><tr><th scope="col" className="px-5 py-3">Tienda</th><th scope="col" className="px-5 py-3">Uso</th><th scope="col" className="px-5 py-3">Plan</th><th scope="col" className="px-5 py-3">Suscripción</th><th scope="col" className="px-5 py-3">Acceso</th><th scope="col" className="px-5 py-3 text-right">Acciones</th></tr></thead><tbody className="divide-y divide-[#eee9ef]">{filteredTenants.map((tenant) => <tr key={tenant.id}><td className="px-5 py-4"><Link className="inline-flex items-center gap-1.5 font-semibold text-[#49225B] hover:underline" href={`/tienda/${tenant.slug}`} target="_blank">{tenant.name}<ExternalLink size={12} /></Link><p className="mt-1 text-xs text-[#807384]">/{tenant.slug} · desde {new Date(tenant.createdAt).toLocaleDateString("es-AR")}</p></td><td className="px-5 py-4 text-xs leading-5 text-[#807384]">{tenant._count.products} productos<br />{tenant._count.memberships} miembros · {tenant._count.orders} pedidos</td><td className="px-5 py-4"><select aria-label={`Plan de ${tenant.name}`} className="rounded-xl border border-[#e6dfe8] bg-white px-3 py-2 text-xs" disabled={busy} onChange={(event) => void updateSubscription(tenant, { planCode: event.target.value })} value={tenant.subscription?.plan.code ?? "PRO"}>{plans.filter((plan) => plan.active).map((plan) => <option key={plan.code} value={plan.code}>{plan.name}</option>)}</select></td><td className="px-5 py-4"><select aria-label={`Estado de suscripción de ${tenant.name}`} className="rounded-xl border border-[#e6dfe8] bg-white px-3 py-2 text-xs" disabled={busy} onChange={(event) => void updateSubscription(tenant, { status: event.target.value })} value={tenant.subscription?.status ?? "ACTIVE"}><option value="TRIALING">Prueba</option><option value="ACTIVE">Activa</option><option value="PAST_DUE">Pago pendiente</option><option value="CANCELED">Cancelada</option></select>{tenant.subscription?.cancelAtPeriodEnd && <p className="mt-1 text-[10px] text-amber-700">Cancela al final del período</p>}</td><td className="px-5 py-4"><span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${tenant.status === "ACTIVE" ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`}>{tenant.status === "ACTIVE" ? "Activa" : "Suspendida"}</span></td><td className="px-5 py-4"><div className="flex items-center justify-end gap-1"><button className="inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold text-[#6E3482] hover:bg-[#f5eff8] disabled:opacity-50" disabled={busy || tenant.status !== "ACTIVE"} onClick={() => void startSupportAccess(tenant)} type="button"><LogIn size={13} /> Administrar</button><button className={`rounded-xl px-3 py-2 text-xs font-semibold ${tenant.status === "ACTIVE" ? "text-red-600 hover:bg-red-50" : "text-emerald-700 hover:bg-emerald-50"}`} disabled={busy} onClick={() => void updateTenant(tenant)} type="button">{tenant.status === "ACTIVE" ? "Suspender" : "Reactivar"}</button></div></td></tr>)}</tbody></table></div></div>}
      </section>}

      {section === "plans" && <section><div><h2 className="text-xl font-semibold">Plan comercial de InfinityFood</h2><p className="mt-1 text-sm text-[#807384]">Controlá desde acá el precio público y la duración de la prueba. Starter se conserva únicamente para el historial.</p></div><div className="mt-5 grid gap-5 lg:grid-cols-2">{plans.map((plan) => plan.active ? <PlanEditor busy={busy} key={`${plan.id}-${plan.priceInCents}-${plan.trialDays}`} onSave={updateCommercialPlan} plan={plan} /> : <article className={`${styles.card} opacity-70`} key={plan.id}><div className="flex items-start justify-between gap-4"><div><h3 className="text-xl font-semibold">{plan.name}</h3><p className="mt-1 text-xs text-[#807384]">Archivado · solo historial</p></div><span className="rounded-full bg-[#f4eff7] px-2.5 py-1 text-xs font-semibold text-[#6E3482]">{plan._count.subscriptions} tienda{plan._count.subscriptions === 1 ? "" : "s"}</span></div><p className="mt-5 text-3xl font-semibold">{money(plan.priceInCents)}<span className="text-sm font-normal text-[#918495]"> / mes</span></p></article>)}</div><Tip title="Qué cambia al guardar">El precio se publica en registro, landing y Plan y uso, y se envía a las suscripciones vigentes de Mercado Pago. Los días de prueba se aplican a tiendas creadas después del cambio; no se acortan ni extienden pruebas ya iniciadas. Las facturas emitidas conservan su importe histórico.</Tip></section>}

      {section === "support" && <SupportHistory filters={{ tenant: supportTenantFilter, user: supportUserFilter, from: supportFrom, to: supportTo }} logs={filteredSupportLogs} onFilter={{ tenant: setSupportTenantFilter, user: setSupportUserFilter, from: setSupportFrom, to: setSupportTo }} tenants={supportTenants} total={supportLogs.length} users={supportUsers} />}

      {section === "operations" && <section className="space-y-6"><div><h2 className="text-xl font-semibold">Salud operativa</h2><p className="mt-1 text-sm text-[#807384]">Detectá rápidamente tareas que necesitan revisión antes de afectar a una tienda.</p></div><div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"><OperationalCard icon={MailCheck} label="Emails en cola" value={notificationCount("PENDING") + notificationCount("SENDING")} help="Pendientes o en proceso de envío." alert={notificationCount("FAILED")} alertLabel={`${notificationCount("FAILED")} fallidos`} /><OperationalCard icon={CreditCard} label="Cobros a revisar" value={invoiceCount("PENDING") + invoiceCount("FAILED")} help="Facturas SaaS pendientes o fallidas." alert={invoiceCount("FAILED")} alertLabel={`${invoiceCount("FAILED")} fallidos`} /><OperationalCard icon={Globe2} label="Dominios pendientes" value={domainCount("PENDING")} help="Esperando verificación DNS." alert={domainCount("FAILED")} alertLabel={`${domainCount("FAILED")} fallidos`} /><OperationalCard icon={ShieldCheck} label="Pruebas por vencer" value={overview.trialsEndingSoon} help="Finalizan dentro de los próximos 7 días." /></div><div className="grid gap-5 lg:grid-cols-2"><section className={styles.card}><h3 className="font-semibold">Crecimiento reciente</h3><p className="mt-1 text-xs leading-5 text-[#807384]">Altas creadas durante los últimos 30 días.</p><p className="mt-5 text-4xl font-semibold text-[#49225B]">{overview.newTenantsLast30Days}</p><p className="mt-2 text-xs text-[#918495]">tienda{overview.newTenantsLast30Days === 1 ? "" : "s"} nueva{overview.newTenantsLast30Days === 1 ? "" : "s"}</p></section><section className={styles.card}><h3 className="font-semibold">Cómo actuar</h3><div className="mt-4 space-y-3 text-xs leading-5 text-[#807384]"><p><strong className="text-[#4b3a50]">Emails:</strong> los reintentos son automáticos; revisá Resend si aumentan los fallidos.</p><p><strong className="text-[#4b3a50]">Cobros:</strong> confirmá el estado en Mercado Pago antes de modificar una suscripción manualmente.</p><p><strong className="text-[#4b3a50]">Dominios:</strong> pedile al owner que revise los registros DNS indicados en Crecimiento.</p></div><button className="mt-5 inline-flex items-center gap-2 text-xs font-semibold text-[#6E3482]" onClick={() => selectSection("stores")} type="button">Ir a tiendas <span>→</span></button></section></div><Tip title="Lectura operativa">Estos indicadores muestran el estado registrado por InfinityFood. Para investigar un proveedor externo, compará también sus logs y paneles oficiales.</Tip></section>}
    </main>
  </div>;
}

function SupportHistory({ logs, total, tenants, users, filters, onFilter }: {
  logs: SupportAccessLog[];
  total: number;
  tenants: SupportAccessLog["tenant"][];
  users: SupportAccessLog["user"][];
  filters: { tenant: string; user: string; from: string; to: string };
  onFilter: { tenant: (value: string) => void; user: (value: string) => void; from: (value: string) => void; to: (value: string) => void };
}) {
  const clearFilters = () => {
    onFilter.tenant("ALL"); onFilter.user("ALL"); onFilter.from(""); onFilter.to("");
  };
  return <section>
    <div className="flex items-start gap-3"><span className="rounded-xl bg-[#f0e7f3] p-2.5 text-[#6E3482]"><History size={19} /></span><div><h2 className="text-xl font-semibold">Historial de soporte</h2><p className="mt-1 text-sm text-[#807384]">Consultá quién ingresó a una tienda, cuándo lo hizo, durante cuánto tiempo y con qué motivo.</p></div></div>
    <div className="mt-5 rounded-2xl border border-[#e6dfe8] bg-white p-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-[1fr_1fr_11rem_11rem_auto]">
        <label><span className="mb-1.5 block text-xs font-semibold text-[#66596a]">Tienda</span><select className="control" onChange={(event) => onFilter.tenant(event.target.value)} value={filters.tenant}><option value="ALL">Todas las tiendas</option>{tenants.map((tenant) => <option key={tenant.id} value={tenant.id}>{tenant.name}</option>)}</select></label>
        <label><span className="mb-1.5 block text-xs font-semibold text-[#66596a]">Administrador</span><select className="control" onChange={(event) => onFilter.user(event.target.value)} value={filters.user}><option value="ALL">Todos los administradores</option>{users.map((user) => <option key={user.id} value={user.id}>{user.firstName} {user.lastName}</option>)}</select></label>
        <label><span className="mb-1.5 block text-xs font-semibold text-[#66596a]">Desde</span><input className="control" onChange={(event) => onFilter.from(event.target.value)} type="date" value={filters.from} /></label>
        <label><span className="mb-1.5 block text-xs font-semibold text-[#66596a]">Hasta</span><input className="control" min={filters.from || undefined} onChange={(event) => onFilter.to(event.target.value)} type="date" value={filters.to} /></label>
        <button className="self-end rounded-xl border border-[#e6dfe8] px-4 py-3 text-xs font-semibold text-[#6E3482] hover:bg-[#fdfafe]" onClick={clearFilters} type="button">Limpiar</button>
      </div>
      <p className="mt-3 text-xs text-[#918495]">Mostrando {logs.length} de {total} accesos recientes.</p>
    </div>
    {logs.length === 0 ? <div className="mt-5"><EmptyState title="No hay accesos para estos filtros">Cuando un Superadmin utilice el modo soporte, el registro aparecerá acá.</EmptyState></div> : <div className="mt-5 overflow-hidden rounded-2xl border border-[#e6dfe8] bg-white"><div className="overflow-x-auto"><table className="w-full min-w-[62rem] text-left text-sm"><caption className="sr-only">Registro de accesos de soporte</caption><thead className="bg-[#fbfafc] text-xs uppercase tracking-wider text-[#918495]"><tr><th className="px-5 py-3" scope="col">Tienda</th><th className="px-5 py-3" scope="col">Administrador</th><th className="px-5 py-3" scope="col">Ingreso</th><th className="px-5 py-3" scope="col">Salida</th><th className="px-5 py-3" scope="col">Duración</th><th className="px-5 py-3" scope="col">Motivo</th></tr></thead><tbody className="divide-y divide-[#eee9ef]">{logs.map((log) => <tr key={log.id}><td className="px-5 py-4"><p className="font-semibold text-[#49225B]">{log.tenant.name}</p><p className="mt-1 text-xs text-[#918495]">/{log.tenant.slug}</p></td><td className="px-5 py-4"><p className="font-medium">{log.user.firstName} {log.user.lastName}</p><p className="mt-1 text-xs text-[#918495]">{log.user.email}</p></td><td className="px-5 py-4 text-xs text-[#66596a]">{dateTime(log.startedAt)}</td><td className="px-5 py-4 text-xs text-[#66596a]">{log.endedAt ? dateTime(log.endedAt) : <span className="rounded-full bg-amber-50 px-2.5 py-1 font-semibold text-amber-700">Sesión activa</span>}</td><td className="px-5 py-4 text-xs font-semibold text-[#66596a]">{accessDuration(log.startedAt, log.endedAt)}</td><td className="max-w-xs px-5 py-4 text-xs leading-5 text-[#66596a]">{log.reason}</td></tr>)}</tbody></table></div></div>}
    <Tip title="Alcance de la auditoría">Este historial registra el acceso de soporte. Los cambios de inventario, ventas y estados de pedidos conservan además sus propios movimientos; la edición detallada de cada campo de configuración no forma parte de este registro.</Tip>
  </section>;
}

function OperationalCard({ label, value, help, icon: Icon, alert = 0, alertLabel }: { label: string; value: number; help: string; icon: typeof Store; alert?: number; alertLabel?: string }) {
  return <article className={styles.card}><div className="flex items-start justify-between gap-3"><div><p className="text-xs text-[#807384]">{label}</p><p className="mt-3 text-3xl font-semibold">{value}</p><p className="mt-2 text-xs leading-5 text-[#918495]">{help}</p>{alert > 0 && <p className="mt-3 inline-flex rounded-full bg-red-50 px-2.5 py-1 text-[11px] font-semibold text-red-700">{alertLabel}</p>}</div><span className={`rounded-lg p-2 ${alert > 0 ? "bg-red-50 text-red-700" : "bg-[#f5eff8] text-[#6E3482]"}`}><Icon size={18} /></span></div></article>;
}

function Metric({ label, value, help, icon: Icon }: { label: string; value: string | number; help: string; icon: typeof Store }) {
  return <article className={styles.card}><div className="flex items-start justify-between gap-3"><div><p className="text-xs text-[#807384]">{label}</p><p className="mt-3 text-3xl font-semibold tracking-tight">{value}</p><p className="mt-3 text-xs leading-5 text-[#918495]">{help}</p></div><span className="rounded-lg bg-[#f5eff8] p-2 text-[#6E3482]"><Icon size={18} /></span></div></article>;
}

function PlanEditor({ plan, busy, onSave }: { plan: Plan; busy: boolean; onSave: (plan: Plan, priceInCents: number, trialDays: number) => Promise<void> }) {
  const [price, setPrice] = useState(String(plan.priceInCents / 100));
  const [trialDays, setTrialDays] = useState(String(plan.trialDays));
  const parsedPrice = Math.round(Number(price) * 100);
  const parsedDays = Number(trialDays);
  const valid = Number.isInteger(parsedPrice) && parsedPrice >= 100 && Number.isInteger(parsedDays) && parsedDays >= 0 && parsedDays <= 365;
  return <article className={`${styles.card} border-[#a56abd]`}>
    <div className="flex items-start justify-between gap-4"><div><h3 className="text-xl font-semibold">{plan.name}</h3><p className="mt-1 text-xs text-[#807384]">Oferta comercial activa</p></div><span className="rounded-full bg-[#f4eff7] px-2.5 py-1 text-xs font-semibold text-[#6E3482]">{plan._count.subscriptions} tienda{plan._count.subscriptions === 1 ? "" : "s"}</span></div>
    <div className="mt-6 grid gap-4 sm:grid-cols-2">
      <label><span className="text-sm font-semibold">Precio mensual</span><span className="mt-1 block text-xs leading-5 text-[#918495]">Ingresá pesos argentinos, sin separador de miles.</span><div className="relative mt-2"><span className="absolute left-3 top-3 text-sm text-[#807384]">$</span><input className="control pl-7!" min="1" onChange={(event) => setPrice(event.target.value)} step="0.01" type="number" value={price} /></div></label>
      <label><span className="text-sm font-semibold">Días de prueba gratuita</span><span className="mt-1 block text-xs leading-5 text-[#918495]">Usá 0 si querés desactivar la prueba para nuevas tiendas.</span><input className="control mt-2" max="365" min="0" onChange={(event) => setTrialDays(event.target.value)} step="1" type="number" value={trialDays} /></label>
    </div>
    <div className="mt-5 grid grid-cols-2 gap-3 rounded-xl bg-[#fbfafc] p-4 text-sm"><div><p className="text-xs text-[#918495]">Productos</p><p className="mt-1 font-semibold">Hasta {plan.maxProducts}</p></div><div><p className="text-xs text-[#918495]">Equipo</p><p className="mt-1 font-semibold">{Math.max(0, plan.maxMembers - 1)} colaboradores</p></div></div>
    <button className={`${styles.button} mt-5 w-full`} disabled={busy || !valid} onClick={() => void onSave(plan, parsedPrice, parsedDays)} type="button">{busy ? "Guardando y sincronizando…" : "Guardar configuración comercial"}</button>
    {!valid && <p className="mt-2 text-xs text-red-600">Revisá el precio y usá entre 0 y 365 días de prueba.</p>}
  </article>;
}
