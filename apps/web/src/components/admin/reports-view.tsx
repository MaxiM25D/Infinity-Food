"use client";

import { Clock3, RefreshCw, ShieldCheck, Users } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { apiRequest } from "@/lib/api";

type Metric = { key: string; label: string; netInCents: number; grossInCents: number; refundsInCents: number; payments: number };
type Report = {
  range: { from: string; to: string };
  total: { netInCents: number; grossInCents: number; refundsInCents: number; payments: number; orders: number };
  sales: { byBranch: Metric[]; byChannel: Metric[]; byPaymentMethod: Metric[]; byHourBand: Metric[] };
  kitchen: { stations: Array<{ branchName: string; stationName: string; tickets: number; averageQueueMinutes: number | null; averagePreparationMinutes: number | null; p90PreparationMinutes: number | null; averageHandoffMinutes: number | null; averageTotalMinutes: number | null }> };
  tableRotation: Array<{ branchName: string; services: number; averageMinutes: number | null; p90Minutes: number | null }>;
  occupancy: Array<{ branchName: string; occupancyRate: number; noShows: number; completedOrSeated: number; noShowRate: number }>;
  reconciliation: { reconciled: number; differences: number; sessions: Array<{ id: string; branchName: string; closedAt: string | null; storedSalesInCents: number | null; calculatedSalesInCents: number; movementsInCents: number; expectedMovementInCents: number; reconciled: boolean }> };
};
type Branches = { branches: Array<{ id: string; name: string; isPrimary: boolean }> };

const money = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 });
const labels: Record<string, string> = { POS: "POS", QR: "QR", WAITER: "Mozo", CASH: "Efectivo", CARD_EXTERNAL: "Tarjeta externa", MERCADO_PAGO: "Mercado Pago" };
function daysAgo(days: number) { return new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10); }
function errorText(error: unknown) { return error instanceof Error ? error.message : "No pudimos generar el reporte"; }

function MetricTable({ title, items }: { title: string; items: Metric[] }) {
  const maximum = Math.max(1, ...items.map(({ netInCents }) => Math.abs(netInCents)));
  return <section className="rounded-3xl border border-[#e6dfe8] bg-white p-6"><h3 className="font-semibold">{title}</h3><div className="mt-5 space-y-4">{items.length ? items.map((item) => <div key={item.key}><div className="mb-1.5 flex justify-between gap-3 text-sm"><span>{labels[item.key] ?? item.label}</span><strong>{money.format(item.netInCents / 100)}</strong></div><div className="h-2 overflow-hidden rounded-full bg-stone-100"><div className="h-full rounded-full bg-[#6E3482]" style={{ width: `${Math.max(2, Math.abs(item.netInCents) / maximum * 100)}%` }}/></div><p className="mt-1 text-[10px] text-stone-400">Bruto {money.format(item.grossInCents / 100)} · Devoluciones {money.format(item.refundsInCents / 100)} · {item.payments} movimientos</p></div>) : <p className="text-sm text-stone-400">Sin movimientos en el período.</p>}</div></section>;
}

export function ReportsView() {
  const [from, setFrom] = useState(() => daysAgo(29));
  const [to, setTo] = useState(() => daysAgo(0));
  const [branchId, setBranchId] = useState("");
  const [branches, setBranches] = useState<Branches["branches"]>([]);
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const query = new URLSearchParams({ from, to });
      if (branchId) query.set("branchId", branchId);
      setReport(await apiRequest<Report>(`/admin/reports/operations?${query}`));
    } catch (caught) { setError(errorText(caught)); } finally { setLoading(false); }
  }, [branchId, from, to]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void apiRequest<Branches>("/admin/branches").then(({ branches: result }) => setBranches(result)).catch(() => undefined);
      void load();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const reconciled = useMemo(() => report ? report.reconciliation.differences === 0 : false, [report]);
  return <div className="space-y-7"><div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-xs font-bold uppercase tracking-[.18em] text-[#8f7c94]">Etapa 6</p><h2 className="mt-2 text-2xl font-semibold">Reportes operativos</h2><p className="mt-2 text-sm text-stone-500">Ventas, cocina, mesas, ocupación y reconciliación desde datos persistidos.</p></div><button className="rounded-xl border bg-white p-3" disabled={loading} onClick={() => void load()} title="Actualizar" type="button"><RefreshCw className={loading ? "animate-spin" : ""} size={17}/></button></div>
    <section className="flex flex-wrap items-end gap-3 rounded-3xl border border-[#e6dfe8] bg-white p-5"><label className="text-xs font-semibold text-stone-500">Desde<input className="mt-1 block rounded-xl border px-3 py-2.5 text-sm" onChange={(event) => setFrom(event.target.value)} type="date" value={from}/></label><label className="text-xs font-semibold text-stone-500">Hasta<input className="mt-1 block rounded-xl border px-3 py-2.5 text-sm" onChange={(event) => setTo(event.target.value)} type="date" value={to}/></label><label className="min-w-52 text-xs font-semibold text-stone-500">Sucursal<select className="mt-1 block w-full rounded-xl border px-3 py-2.5 text-sm" onChange={(event) => setBranchId(event.target.value)} value={branchId}><option value="">Todas las accesibles</option>{branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label><button className="rounded-xl bg-[#211b23] px-5 py-3 text-sm font-semibold text-white disabled:opacity-50" disabled={loading || from > to} onClick={() => void load()} type="button">Aplicar</button></section>
    {error && <p className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    {report && <><div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5"><div className="rounded-2xl bg-[#211b23] p-5 text-white"><p className="text-xs text-white/50">Venta neta</p><strong className="mt-2 block text-2xl">{money.format(report.total.netInCents / 100)}</strong></div><div className="rounded-2xl border bg-white p-5"><p className="text-xs text-stone-400">Órdenes cobradas</p><strong className="mt-2 block text-2xl">{report.total.orders}</strong></div><div className="rounded-2xl border bg-white p-5"><p className="text-xs text-stone-400">Movimientos de pago</p><strong className="mt-2 block text-2xl">{report.total.payments}</strong></div><div className="rounded-2xl border bg-white p-5"><p className="text-xs text-stone-400">Devoluciones</p><strong className="mt-2 block text-2xl">{money.format(report.total.refundsInCents / 100)}</strong></div><div className={`rounded-2xl border p-5 ${reconciled ? "border-emerald-200 bg-emerald-50" : "border-red-200 bg-red-50"}`}><p className="flex items-center gap-2 text-xs"><ShieldCheck size={14}/>Reconciliación</p><strong className="mt-2 block text-2xl">{reconciled ? "Correcta" : `${report.reconciliation.differences} diferencias`}</strong></div></div>
      <div className="grid gap-6 xl:grid-cols-2"><MetricTable items={report.sales.byBranch} title="Ventas por sucursal"/><MetricTable items={report.sales.byChannel} title="Ventas por canal"/><MetricTable items={report.sales.byPaymentMethod} title="Ventas por medio de pago"/><MetricTable items={report.sales.byHourBand} title="Ventas por franja horaria"/></div>
      <div className="grid gap-6 xl:grid-cols-2"><section className="rounded-3xl border border-[#e6dfe8] bg-white p-6"><h3 className="flex items-center gap-2 font-semibold"><Clock3 size={18}/>Tiempos de cocina</h3><div className="mt-4 overflow-x-auto"><table className="w-full min-w-[38rem] text-left text-sm"><thead className="text-xs text-stone-400"><tr><th className="pb-3">Estación</th><th>Tickets</th><th>Cola</th><th>Preparación</th><th>P90</th><th>Total</th></tr></thead><tbody>{report.kitchen.stations.map((station) => <tr className="border-t" key={`${station.branchName}:${station.stationName}`}><td className="py-3 font-medium">{station.branchName} · {station.stationName}</td><td>{station.tickets}</td><td>{station.averageQueueMinutes ?? "—"} min</td><td>{station.averagePreparationMinutes ?? "—"} min</td><td>{station.p90PreparationMinutes ?? "—"} min</td><td>{station.averageTotalMinutes ?? "—"} min</td></tr>)}</tbody></table></div></section><section className="rounded-3xl border border-[#e6dfe8] bg-white p-6"><h3 className="flex items-center gap-2 font-semibold"><Users size={18}/>Ocupación y rotación</h3><div className="mt-4 space-y-4">{report.occupancy.map((item) => { const rotation = report.tableRotation.find(({ branchName }) => branchName === item.branchName); return <div className="rounded-2xl bg-stone-50 p-4" key={item.branchName}><div className="flex justify-between"><strong>{item.branchName}</strong><span className="text-sm text-[#6E3482]">{item.occupancyRate}% ocupación</span></div><div className="mt-3 grid grid-cols-2 gap-2 text-xs text-stone-500"><p>Rotación promedio: {rotation?.averageMinutes ?? "—"} min</p><p>P90: {rotation?.p90Minutes ?? "—"} min</p><p>No-shows: {item.noShows}</p><p>Tasa no-show: {item.noShowRate}%</p></div></div>; })}</div></section></div>
      <section className="rounded-3xl border border-[#e6dfe8] bg-white p-6"><h3 className="font-semibold">Detalle de caja</h3><div className="mt-4 overflow-x-auto"><table className="w-full min-w-[44rem] text-left text-sm"><thead className="text-xs text-stone-400"><tr><th className="pb-3">Sucursal</th><th>Estado</th><th>Venta guardada</th><th>Venta calculada</th><th>Movimientos</th><th>Esperado</th></tr></thead><tbody>{report.reconciliation.sessions.map((session) => <tr className="border-t" key={session.id}><td className="py-3 font-medium">{session.branchName}</td><td className={session.reconciled ? "text-emerald-700" : "text-red-700"}>{session.reconciled ? "Reconciliada" : "Diferencia"}</td><td>{session.storedSalesInCents === null ? "Caja abierta" : money.format(session.storedSalesInCents / 100)}</td><td>{money.format(session.calculatedSalesInCents / 100)}</td><td>{money.format(session.movementsInCents / 100)}</td><td>{money.format(session.expectedMovementInCents / 100)}</td></tr>)}</tbody></table></div></section>
    </>}
  </div>;
}
