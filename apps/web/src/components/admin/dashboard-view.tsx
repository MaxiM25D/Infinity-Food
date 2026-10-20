"use client";

import { ArrowRight, Banknote, Boxes, LayoutGrid, Package, ShoppingBag, Users } from "lucide-react";
import { useEffect, useState } from "react";

import { ApiError, apiRequest } from "@/lib/api";
import { EmptyState, GuideLink, Tip, panelStyles as styles } from "./guided-panel";
import type { Dashboard } from "./types";

const money = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 });
type Destination = "orders" | "products" | "categories" | "customers" | "store" | "growth";
const orderLabels: Record<string, string> = { PENDING: "Pendiente", CONFIRMED: "Confirmado", PREPARING: "En preparación", SHIPPED: "Enviado", DELIVERED: "Entregado", READY_FOR_PICKUP: "Listo para retirar", PICKED_UP: "Retirado", CANCELLED: "Cancelado" };
const paymentLabels: Record<string, string> = { PENDING: "Pendiente", PARTIALLY_PAID: "Parcial", APPROVED: "Aprobado", REJECTED: "Rechazado", CANCELLED: "Cancelado", REFUNDED: "Reembolsado" };

export function DashboardView({ onNavigate }: { onNavigate: (tab: Destination) => void }) {
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    apiRequest<Dashboard>("/admin/dashboard").then((response) => {
      if (active) setData(response);
    }).catch((caught) => {
      if (active) setError(caught instanceof ApiError ? caught.message : "No pudimos cargar el resumen de tu tienda.");
    });
    return () => { active = false; };
  }, [attempt]);

  if (error) return <div role="alert" className={styles.card}><p className="text-sm text-red-700">{error}</p><button className={`${styles.button} mt-4`} onClick={() => { setError(""); setAttempt((value) => value + 1); }} type="button">Volver a intentar</button></div>;
  if (!data) return <div role="status" aria-label="Cargando resumen" className="grid animate-pulse gap-4 sm:grid-cols-2 xl:grid-cols-4">{[1, 2, 3, 4].map((item) => <div className="h-48 rounded-2xl bg-[#eee9ef]" key={item} />)}</div>;

  const metrics = [
    { label: "Ventas aprobadas", value: money.format(data.metrics.approvedRevenueInCents / 100), note: `${data.metrics.orders} pedidos creados en total`, help: "Suma de pedidos cuyo pago está aprobado. No incluye pagos pendientes.", icon: Banknote, tab: "orders" as const },
    { label: "Productos", value: data.metrics.products, note: `${data.metrics.activeProducts} activos`, help: "Total de productos cargados, incluidos los que están inactivos.", icon: Package, tab: "products" as const },
    { label: "Clientes", value: data.metrics.customers, note: "Contactos de esta tienda", help: "Registros de clientes; también puede haber compradores invitados sin cuenta.", icon: Users, tab: "customers" as const },
    { label: "Categorías", value: data.metrics.categories, note: "Grupos en tu catálogo", help: "Agrupan tus productos para que sea más fácil encontrarlos.", icon: LayoutGrid, tab: "categories" as const },
  ];
  const actions = [
    { title: "Gestionar pedidos", help: "Revisá pagos, comprobantes y entregas.", icon: ShoppingBag, tab: "orders" as const },
    { title: "Organizar el catálogo", help: "Agregá productos y actualizá precios o stock.", icon: Boxes, tab: "products" as const },
    { title: "Configurar mi tienda", help: "Logo, contacto y medios de cobro, paso a paso.", icon: LayoutGrid, tab: "store" as const },
  ];

  return <div className={`${styles.surface} mx-auto max-w-7xl space-y-6`}>
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div><p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#6E3482]">Resumen</p><h2 className="mt-2 text-2xl font-semibold tracking-tight">Tu tienda, de un vistazo</h2><p className="mt-2 text-sm text-[#807384]">Qué está pasando y por dónde seguir. Cada dato tiene su explicación.</p></div>
      <span className="rounded-full border border-[#e6dfe8] bg-white px-3 py-1.5 text-xs text-[#807384]">Totales históricos</span>
    </header>
    <section aria-label="Métricas de la tienda" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {metrics.map((metric) => <article key={metric.label} className={`${styles.card} flex flex-col`}>
        <div className="flex items-center justify-between gap-2"><h3 className="text-sm font-medium text-[#807384]">{metric.label}</h3><span className="rounded-lg bg-[#f5eff8] p-2 text-[#6E3482]"><metric.icon size={17} aria-hidden="true" /></span></div>
        <p className="mt-4 text-3xl font-semibold tracking-tight">{metric.value}</p><p className="mt-1 text-xs text-[#807384]">{metric.note}</p>
        <p className="mb-5 mt-4 text-xs leading-5 text-[#807384]">{metric.help}</p>
        <button type="button" onClick={() => onNavigate(metric.tab)} className="mt-auto flex items-center justify-between border-t border-[#eee9ef] pt-3 text-xs font-semibold text-[#6E3482]">Ver {metric.tab === "orders" ? "pedidos" : metric.label.toLowerCase()}<ArrowRight size={14} aria-hidden="true" /></button>
      </article>)}
    </section>
    <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_18rem]">
      <section className="min-w-0 overflow-hidden rounded-[1.5rem] border border-[#e6dfe8] bg-white">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#eee9ef] px-6 py-5"><div><h3 className="font-semibold">Pedidos recientes</h3><p className="mt-1 text-xs leading-5 text-[#807384]">Los últimos cinco pedidos. El estado del pedido y el pago se muestran por separado.</p></div><button type="button" onClick={() => onNavigate("orders")} className="inline-flex items-center gap-2 text-xs font-semibold text-[#6E3482]">Ver todos <ArrowRight size={14} /></button></div>
        {data.recentOrders.length === 0 ? <div className="p-6"><EmptyState title="Tu primer pedido aparecerá acá">Mientras tanto, cargá <GuideLink onClick={() => onNavigate("products")}>Productos</GuideLink> y revisá los medios de cobro en <GuideLink onClick={() => onNavigate("store")}>Mi tienda</GuideLink>.</EmptyState></div> :
          <div className="overflow-x-auto"><table className="w-full min-w-[40rem] text-left text-sm">
            <caption className="sr-only">Últimos cinco pedidos de la tienda, estado del pedido, pago e importe</caption>
            <thead className="bg-[#fbfafc] text-[10px] uppercase tracking-wider text-[#918495]"><tr><th scope="col" className="px-5 py-3">Pedido / cliente</th><th scope="col" className="px-5 py-3">Pedido</th><th scope="col" className="px-5 py-3">Pago</th><th scope="col" className="px-5 py-3 text-right">Total</th></tr></thead>
            <tbody className="divide-y divide-[#eee9ef]">{data.recentOrders.map((order) => <tr key={order.id}>
              <td className="px-5 py-4"><p className="font-semibold">#{order.number} <span className="font-normal text-[#807384]">· {order.customerName}</span></p><p className="mt-1 text-[11px] text-[#918495]">{new Date(order.createdAt).toLocaleDateString("es-AR")}</p></td>
              <td className="px-5 py-4"><span className="whitespace-nowrap rounded-full bg-[#f4eff7] px-2.5 py-1 text-xs text-[#6E3482]">{orderLabels[order.status] ?? "En revisión"}</span></td>
              <td className="px-5 py-4"><span className={`whitespace-nowrap rounded-full px-2.5 py-1 text-xs ${order.paymentStatus === "APPROVED" ? "bg-emerald-50 text-emerald-700" : order.paymentStatus === "PENDING" ? "bg-amber-50 text-amber-800" : "bg-stone-100 text-stone-600"}`}>{paymentLabels[order.paymentStatus] ?? "En revisión"}</span></td>
              <td className="whitespace-nowrap px-5 py-4 text-right font-semibold">{money.format(order.totalInCents / 100)}</td>
            </tr>)}</tbody>
          </table></div>}
      </section>
      <aside className={styles.card}><h3 className="text-sm font-semibold">¿Cómo leer el resumen?</h3><Tip title="Pedido y pago son distintos">Por ejemplo: si alguien compra $17.000 por transferencia, el pedido puede estar pendiente y las ventas seguir en $0 hasta que apruebes el pago.</Tip><p className="mt-4 text-xs leading-6 text-[#807384]">Este resumen reúne todo el historial. Para consultar la actividad de los últimos 30 días, abrí Resultados en Crecimiento.</p><button type="button" onClick={() => onNavigate("growth")} className="mt-4 inline-flex items-center gap-2 text-xs font-semibold text-[#6E3482]">Ver resultados <ArrowRight size={14} /></button></aside>
    </div>
    <section aria-labelledby="dashboard-next-steps"><h3 id="dashboard-next-steps" className="mb-4 text-sm font-semibold">¿Qué querés hacer ahora?</h3><div className="grid gap-4 md:grid-cols-3">{actions.map((action) => <button type="button" key={action.tab} onClick={() => onNavigate(action.tab)} className={`${styles.card} flex items-start gap-3 text-left transition hover:border-[#cdb4d8] hover:bg-[#fdfafe]`}><span className="rounded-lg bg-[#f5eff8] p-2 text-[#6E3482]"><action.icon size={18} /></span><span className="flex-1"><span className="block text-sm font-semibold">{action.title}</span><span className="mt-1 block text-xs leading-5 text-[#807384]">{action.help}</span></span><ArrowRight className="mt-2 shrink-0 text-[#a56abd]" size={15} /></button>)}</div></section>
  </div>;
}
