"use client";

import { Combine, Printer, RefreshCw, Split, Tag, Undo2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { apiRequest } from "@/lib/api";

type Table = { id: string; name: string; code: string };
type OrderItem = { id: string; productName: string; quantity: number; subtotalInCents: number };
type Order = { id: string; number: number; customerName: string; totalInCents: number; balanceInCents: number; restaurantTable: Table | null; items: OrderItem[] };
type TableGroup = { id: string; label: string | null; primaryTable: Table; members: Array<{ id: string; table: Table }> };
type PrintJob = { id: string; type: "KITCHEN" | "RECEIPT"; status: string; attempts: number; error: string | null; payload: unknown; createdAt: string; claimedByUserId: string | null };
type AdvancedOverview = { tableGroups: TableGroup[]; printJobs: PrintJob[] };
type PosOverview = { orders: Order[]; tables: Table[] };

const money = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS" });
const cents = (value: string) => Math.round((Number(value.replace(",", ".")) || 0) * 100);

export function AdvancedView() {
  const [advanced, setAdvanced] = useState<AdvancedOverview>({ tableGroups: [], printJobs: [] });
  const [orders, setOrders] = useState<Order[]>([]);
  const [tables, setTables] = useState<Table[]>([]);
  const [selectedTables, setSelectedTables] = useState<string[]>([]);
  const [orderId, setOrderId] = useState("");
  const [targetTableId, setTargetTableId] = useState("");
  const [adjustmentType, setAdjustmentType] = useState<"DISCOUNT" | "TIP" | "COMPLIMENT">("DISCOUNT");
  const [adjustmentAmount, setAdjustmentAmount] = useState("");
  const [adjustmentReason, setAdjustmentReason] = useState("");
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("CASH");
  const [splitMode, setSplitMode] = useState<"AMOUNT" | "ITEM" | "GUEST">("AMOUNT");
  const [splitItemId, setSplitItemId] = useState("");
  const [guestLabel, setGuestLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const selectedOrder = useMemo(() => orders.find((order) => order.id === orderId) ?? null, [orderId, orders]);

  const load = useCallback(async () => {
    const [advancedData, posData] = await Promise.all([
      apiRequest<AdvancedOverview>("/admin/advanced/overview"),
      apiRequest<PosOverview>("/admin/pos/overview"),
    ]);
    setAdvanced(advancedData); setOrders(posData.orders); setTables(posData.tables);
    setOrderId((current) => posData.orders.some((order) => order.id === current) ? current : (posData.orders[0]?.id ?? ""));
    setTargetTableId((current) => current || posData.tables[0]?.id || "");
  }, []);
  useEffect(() => {
    let active = true;
    const refresh = () => { void load().catch((caught) => { if (active) setError(caught instanceof Error ? caught.message : "No se pudo cargar la operación"); }); };
    const initial = window.setTimeout(refresh, 0);
    const timer = window.setInterval(refresh, 10_000);
    return () => { active = false; window.clearTimeout(initial); window.clearInterval(timer); };
  }, [load]);

  async function action(work: () => Promise<void>) {
    setBusy(true); setError("");
    try { await work(); await load(); } catch (caught) { setError(caught instanceof Error ? caught.message : "No se pudo completar la operación"); }
    finally { setBusy(false); }
  }
  function createGroup() { if (selectedTables.length < 2) return; void action(async () => { await apiRequest("/admin/advanced/table-groups", { method: "POST", body: JSON.stringify({ primaryTableId: selectedTables[0], tableIds: selectedTables, label: `Unión ${new Date().toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })}` }) }); setSelectedTables([]); }); }
  function closeGroup(groupId: string) { void action(async () => { await apiRequest(`/admin/advanced/table-groups/${groupId}`, { method: "DELETE" }); }); }
  function transfer() { if (!selectedOrder || !targetTableId) return; void action(async () => { await apiRequest(`/admin/advanced/orders/${selectedOrder.id}/table`, { method: "PATCH", body: JSON.stringify({ targetTableId, eventId: crypto.randomUUID() }) }); }); }
  function adjust() { if (!selectedOrder) return; void action(async () => { await apiRequest(`/admin/advanced/orders/${selectedOrder.id}/adjustments`, { method: "POST", body: JSON.stringify({ clientRequestId: crypto.randomUUID(), type: adjustmentType, label: adjustmentType === "TIP" ? "Propina" : adjustmentType === "COMPLIMENT" ? "Cortesía" : "Descuento", reason: adjustmentReason, amountInCents: cents(adjustmentAmount), orderItemId: adjustmentType === "COMPLIMENT" && splitItemId ? splitItemId : undefined }) }); setAdjustmentAmount(""); setAdjustmentReason(""); }); }
  function paySplit() { if (!selectedOrder) return; const amountInCents = cents(paymentAmount); const allocation = splitMode === "ITEM" ? { amountInCents, orderItemId: splitItemId } : splitMode === "GUEST" ? { amountInCents, guestLabel } : null; void action(async () => { await apiRequest(`/admin/pos/orders/${selectedOrder.id}/payments`, { method: "POST", body: JSON.stringify({ clientRequestId: crypto.randomUUID(), method: paymentMethod, amountInCents, allocations: allocation ? [allocation] : undefined }) }); setPaymentAmount(""); }); }
  function requestReceipt() { if (!selectedOrder) return; void action(async () => { await apiRequest(`/admin/advanced/orders/${selectedOrder.id}/print`, { method: "POST", body: JSON.stringify({ clientRequestId: crypto.randomUUID() }) }); }); }
  function claim(jobId: string) { void action(async () => { await apiRequest(`/admin/advanced/print-jobs/${jobId}/claim`, { method: "POST" }); }); }
  function complete(jobId: string, status: "PRINTED" | "FAILED") { void action(async () => { await apiRequest(`/admin/advanced/print-jobs/${jobId}/complete`, { method: "POST", body: JSON.stringify(status === "PRINTED" ? { status } : { status, error: "Impresión informada como fallida por el operador" }) }); }); }

  return <div className="space-y-7">
    <header className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-xs font-bold uppercase tracking-[.18em] text-[#8f7c94]">Etapa 8</p><h2 className="mt-2 text-2xl font-semibold">Operación gastronómica avanzada</h2><p className="mt-2 text-sm text-stone-500">Unión y transferencia de mesas, ajustes auditados, cuenta dividida e impresión.</p></div><button className="rounded-xl border bg-white p-3" onClick={() => void load()} title="Actualizar" type="button"><RefreshCw size={17}/></button></header>
    {error && <p className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    <section className="grid gap-6 lg:grid-cols-2"><div className="rounded-3xl border bg-white p-6"><h3 className="flex items-center gap-2 font-semibold"><Combine size={18}/> Unir mesas</h3><div className="mt-4 grid grid-cols-2 gap-2">{tables.map((table) => <label className={`rounded-xl border p-3 text-sm ${selectedTables.includes(table.id) ? "border-[#6E3482] bg-purple-50" : ""}`} key={table.id}><input checked={selectedTables.includes(table.id)} className="mr-2" onChange={() => setSelectedTables((current) => current.includes(table.id) ? current.filter((id) => id !== table.id) : [...current, table.id])} type="checkbox"/>{table.name}</label>)}</div><button className="mt-4 rounded-xl bg-[#6E3482] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-40" disabled={busy || selectedTables.length < 2} onClick={createGroup} type="button">Unir {selectedTables.length} mesas</button><div className="mt-4 space-y-2">{advanced.tableGroups.map((group) => <div className="flex items-center justify-between rounded-xl bg-stone-50 p-3 text-sm" key={group.id}><span><strong>{group.label ?? group.primaryTable.name}</strong><br/><small>{group.members.map((member) => member.table.name).join(" + ")}</small></span><button className="rounded-lg border p-2 text-red-600" onClick={() => closeGroup(group.id)} title="Separar" type="button"><Undo2 size={15}/></button></div>)}</div></div>
      <div className="rounded-3xl border bg-white p-6"><h3 className="font-semibold">Transferir pedido</h3><select className="control mt-4" onChange={(event) => setOrderId(event.target.value)} value={orderId}>{orders.map((order) => <option key={order.id} value={order.id}>#{order.number} · {order.restaurantTable?.name ?? "Mostrador"} · {order.customerName}</option>)}</select><select className="control mt-2" onChange={(event) => setTargetTableId(event.target.value)} value={targetTableId}>{tables.map((table) => <option key={table.id} value={table.id}>{table.name}</option>)}</select><button className="mt-3 rounded-xl bg-[#211b23] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-40" disabled={busy || !selectedOrder || !targetTableId || selectedOrder.restaurantTable?.id === targetTableId} onClick={transfer} type="button">Transferir a la mesa</button></div></section>
    <section className="grid gap-6 xl:grid-cols-2"><div className="rounded-3xl border bg-white p-6"><h3 className="flex items-center gap-2 font-semibold"><Tag size={18}/> Propina, descuento o cortesía</h3><div className="mt-4 grid gap-2 sm:grid-cols-2"><select className="control" onChange={(event) => setAdjustmentType(event.target.value as typeof adjustmentType)} value={adjustmentType}><option value="DISCOUNT">Descuento</option><option value="TIP">Propina</option><option value="COMPLIMENT">Cortesía</option></select><input className="control" min="0.01" onChange={(event) => setAdjustmentAmount(event.target.value)} placeholder="Importe" step="0.01" type="number" value={adjustmentAmount}/>{adjustmentType === "COMPLIMENT" && <select className="control sm:col-span-2" onChange={(event) => setSplitItemId(event.target.value)} value={splitItemId}><option value="">Pedido completo</option>{selectedOrder?.items.map((item) => <option key={item.id} value={item.id}>{item.quantity}× {item.productName}</option>)}</select>}<input className="control sm:col-span-2" onChange={(event) => setAdjustmentReason(event.target.value)} placeholder="Motivo obligatorio" value={adjustmentReason}/></div><button className="mt-3 rounded-xl bg-[#6E3482] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-40" disabled={busy || cents(adjustmentAmount) < 1 || adjustmentReason.trim().length < 3} onClick={adjust} type="button">Aplicar ajuste auditado</button></div>
      <div className="rounded-3xl border bg-white p-6"><h3 className="flex items-center gap-2 font-semibold"><Split size={18}/> Dividir y cobrar</h3>{selectedOrder && <p className="mt-2 text-sm text-stone-500">Saldo de #{selectedOrder.number}: <strong>{money.format(selectedOrder.balanceInCents / 100)}</strong></p>}<div className="mt-4 grid gap-2 sm:grid-cols-2"><select className="control" onChange={(event) => setSplitMode(event.target.value as typeof splitMode)} value={splitMode}><option value="AMOUNT">Por importe</option><option value="ITEM">Por ítem</option><option value="GUEST">Por comensal</option></select><select className="control" onChange={(event) => setPaymentMethod(event.target.value)} value={paymentMethod}><option value="CASH">Efectivo</option><option value="CARD_EXTERNAL">Tarjeta</option><option value="MERCADO_PAGO">Mercado Pago</option></select>{splitMode === "ITEM" && <select className="control sm:col-span-2" onChange={(event) => { const item = selectedOrder?.items.find(({ id }) => id === event.target.value); setSplitItemId(event.target.value); if (item) setPaymentAmount(String(item.subtotalInCents / 100)); }} value={splitItemId}><option value="">Seleccionar ítem</option>{selectedOrder?.items.map((item) => <option key={item.id} value={item.id}>{item.quantity}× {item.productName} · {money.format(item.subtotalInCents / 100)}</option>)}</select>}{splitMode === "GUEST" && <input className="control sm:col-span-2" onChange={(event) => setGuestLabel(event.target.value)} placeholder="Comensal (ej. Ana)" value={guestLabel}/>}<input className="control sm:col-span-2" max={(selectedOrder?.balanceInCents ?? 0) / 100} min="0.01" onChange={(event) => setPaymentAmount(event.target.value)} placeholder="Importe a cobrar" step="0.01" type="number" value={paymentAmount}/></div><button className="mt-3 rounded-xl bg-[#211b23] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-40" disabled={busy || !selectedOrder || cents(paymentAmount) < 1 || cents(paymentAmount) > selectedOrder.balanceInCents || (splitMode === "ITEM" && !splitItemId) || (splitMode === "GUEST" && !guestLabel.trim())} onClick={paySplit} type="button">Registrar parte</button></div></section>
    <section className="rounded-3xl border bg-white p-6"><div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="flex items-center gap-2 font-semibold"><Printer size={18}/> Cola de impresión térmica</h3><p className="mt-1 text-xs text-stone-500">La cola persiste en base de datos y evita duplicados por solicitud.</p></div><button className="rounded-xl border px-4 py-2 text-sm font-semibold disabled:opacity-40" disabled={!selectedOrder || busy} onClick={requestReceipt} type="button">Encolar ticket de caja</button></div><div className="mt-4 space-y-2">{advanced.printJobs.map((job) => <div className="grid gap-2 rounded-xl bg-stone-50 p-3 text-sm sm:grid-cols-[1fr_auto] sm:items-center" key={job.id}><div><strong>{job.type === "KITCHEN" ? "Comanda" : "Ticket"} · {job.status}</strong><p className="text-xs text-stone-400">{new Date(job.createdAt).toLocaleString("es-AR")} · intento {job.attempts}</p>{job.error && <p className="text-xs text-red-600">{job.error}</p>}</div><div className="flex gap-2">{job.status === "PENDING" && <button className="rounded-lg border px-3 py-2 text-xs font-semibold" onClick={() => claim(job.id)} type="button">Tomar</button>}{job.status === "CLAIMED" && <><button className="rounded-lg bg-emerald-700 px-3 py-2 text-xs font-semibold text-white" onClick={() => complete(job.id, "PRINTED")} type="button">Impreso</button><button className="rounded-lg border border-red-200 px-3 py-2 text-xs font-semibold text-red-600" onClick={() => complete(job.id, "FAILED")} type="button">Falló</button></>}</div></div>)}{advanced.printJobs.length === 0 && <p className="py-6 text-center text-sm text-stone-400">No hay trabajos pendientes.</p>}</div></section>
  </div>;
}
