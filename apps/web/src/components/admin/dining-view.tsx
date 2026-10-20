"use client";

import { ChefHat, ExternalLink, Plus, QrCode, RefreshCw, Send, Table2 } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { apiRequest } from "@/lib/api";

type Table = { id: string; code: string; name: string; maxCapacity: number };
type Station = { id: string; name: string; type: string; _count: { menuItems: number } };
type MenuItem = { productId: string; product: { id: string; name: string; priceInCents: number; category: { name: string } | null } };
type DiningOrder = { id: string; number: number; customerName: string; diningSource: string; diningStatus: string; restaurantTable: Table | null; rounds: Array<{ id: string; number: number; items: Array<{ id: string; productName: string; quantity: number }>; tickets: Array<{ id: string; status: string; station: { name: string } }> }> };

async function fetchDiningData() {
  return Promise.all([
    apiRequest<{ tables: Table[] }>("/admin/dining/tables"), apiRequest<{ stations: Station[] }>("/admin/dining/stations"),
    apiRequest<{ items: MenuItem[] }>("/admin/menu"), apiRequest<{ orders: DiningOrder[] }>("/admin/dining/orders"),
  ]);
}

export function DiningView() {
  const [tables, setTables] = useState<Table[]>([]);
  const [stations, setStations] = useState<Station[]>([]);
  const [menu, setMenu] = useState<MenuItem[]>([]);
  const [orders, setOrders] = useState<DiningOrder[]>([]);
  const [selectedTable, setSelectedTable] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [targetOrderId, setTargetOrderId] = useState("");
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [tableDraft, setTableDraft] = useState({ code: "", name: "", maxCapacity: 4 });
  const [stationName, setStationName] = useState("");

  const load = useCallback(async () => {
    const [tableData, stationData, menuData, orderData] = await fetchDiningData();
    setTables(tableData.tables); setStations(stationData.stations); setMenu(menuData.items); setOrders(orderData.orders);
    setSelectedTable((current) => current || tableData.tables[0]?.id || "");
  }, []);
  useEffect(() => {
    let active = true;
    void fetchDiningData().then(([tableData, stationData, menuData, orderData]) => {
      if (!active) return;
      setTables(tableData.tables); setStations(stationData.stations); setMenu(menuData.items); setOrders(orderData.orders);
      setSelectedTable(tableData.tables[0]?.id || "");
    }).catch((caught) => { if (active) setError(caught instanceof Error ? caught.message : "No pudimos cargar el salón"); });
    return () => { active = false; };
  }, []);
  const selectedCount = useMemo(() => Object.values(quantities).reduce((sum, value) => sum + value, 0), [quantities]);

  async function createTable() {
    setBusy(true); setError("");
    try { await apiRequest("/admin/dining/tables", { method: "POST", body: JSON.stringify(tableDraft) }); setTableDraft({ code: "", name: "", maxCapacity: 4 }); await load(); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "No pudimos crear la mesa"); } finally { setBusy(false); }
  }
  async function createStation() {
    setBusy(true); setError("");
    try { await apiRequest("/admin/dining/stations", { method: "POST", body: JSON.stringify({ name: stationName, type: "OTHER", displayOrder: stations.length }) }); setStationName(""); await load(); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "No pudimos crear la estación"); } finally { setBusy(false); }
  }
  async function assign(productId: string, stationId: string) {
    await apiRequest(`/admin/dining/menu-items/${productId}/station`, { method: "PUT", body: JSON.stringify({ stationId }) });
    await load();
  }
  async function sendOrder() {
    setBusy(true); setError("");
    try {
      const items = menu.filter((item) => quantities[item.productId]).map((item) => ({ productId: item.productId, quantity: quantities[item.productId] }));
      await apiRequest(targetOrderId ? `/admin/dining/orders/${targetOrderId}/rounds` : "/admin/dining/orders", { method: "POST", body: JSON.stringify(targetOrderId ? { clientRequestId: crypto.randomUUID(), items } : { tableId: selectedTable, customerName: customerName || "Mesa", clientRequestId: crypto.randomUUID(), items }) });
      setQuantities({}); setCustomerName(""); await load();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "No pudimos enviar el pedido"); } finally { setBusy(false); }
  }

  return <div className="space-y-8">
    <div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-xs font-bold uppercase tracking-[.18em] text-[#8f7c94]">Operación gastronómica</p><h2 className="mt-2 text-2xl font-semibold">Salón, comandas y estaciones</h2><p className="mt-2 text-sm text-stone-500">La sucursal activa define todas las mesas, pedidos y tickets visibles.</p></div><div className="flex gap-2"><button className="rounded-xl border bg-white p-3" onClick={() => void load()} title="Actualizar" type="button"><RefreshCw size={17} /></button><Link className="inline-flex items-center gap-2 rounded-xl bg-[#211b23] px-4 py-3 text-sm font-semibold text-white" href="/kds" target="_blank"><ChefHat size={17} /> Abrir KDS <ExternalLink size={13} /></Link></div></div>
    {error && <p className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    <div className="grid gap-6 xl:grid-cols-2">
      <section className="rounded-3xl border border-[#e6dfe8] bg-white p-6"><h3 className="flex items-center gap-2 font-semibold"><Table2 size={18} /> Mesas y QR</h3><div className="mt-4 grid grid-cols-[1fr_1.5fr_6rem_auto] gap-2"><input className="rounded-xl border px-3 py-2 text-sm" onChange={(event) => setTableDraft({ ...tableDraft, code: event.target.value })} placeholder="M1" value={tableDraft.code} /><input className="rounded-xl border px-3 py-2 text-sm" onChange={(event) => setTableDraft({ ...tableDraft, name: event.target.value })} placeholder="Mesa 1" value={tableDraft.name} /><input className="rounded-xl border px-3 py-2 text-sm" min={1} onChange={(event) => setTableDraft({ ...tableDraft, maxCapacity: Number(event.target.value) })} type="number" value={tableDraft.maxCapacity} /><button className="rounded-xl bg-[#6E3482] px-3 text-white disabled:opacity-40" disabled={busy || !tableDraft.code || !tableDraft.name} onClick={() => void createTable()} type="button"><Plus size={17} /></button></div><div className="mt-4 space-y-2">{tables.map((table) => <div className="flex items-center justify-between rounded-xl bg-stone-50 px-4 py-3" key={table.id}><div><p className="text-sm font-semibold">{table.name}</p><p className="text-xs text-stone-400">{table.code} · {table.maxCapacity} personas</p></div><a className="inline-flex items-center gap-2 text-xs font-semibold text-[#6E3482]" href={`/api/admin/dining/tables/${table.id}/qr.svg`} target="_blank"><QrCode size={15} /> QR</a></div>)}</div></section>
      <section className="rounded-3xl border border-[#e6dfe8] bg-white p-6"><h3 className="flex items-center gap-2 font-semibold"><ChefHat size={18} /> Estaciones</h3><div className="mt-4 flex gap-2"><input className="min-w-0 flex-1 rounded-xl border px-3 py-2 text-sm" onChange={(event) => setStationName(event.target.value)} placeholder="Ej. Barra" value={stationName} /><button className="rounded-xl bg-[#6E3482] px-4 text-white disabled:opacity-40" disabled={busy || stationName.length < 2} onClick={() => void createStation()} type="button"><Plus size={17} /></button></div><div className="mt-4 space-y-2">{stations.map((station) => <div className="rounded-xl bg-stone-50 px-4 py-3" key={station.id}><p className="text-sm font-semibold">{station.name}</p><p className="text-xs text-stone-400">{station.type} · {station._count.menuItems} platos</p></div>)}</div></section>
    </div>
    <section className="rounded-3xl border border-[#e6dfe8] bg-white p-6"><h3 className="font-semibold">Asignación de platos</h3><div className="mt-4 grid gap-2 md:grid-cols-2">{menu.map((item) => <label className="flex items-center justify-between gap-3 rounded-xl bg-stone-50 px-4 py-3 text-sm" key={item.productId}><span>{item.product.name}<small className="block text-stone-400">{item.product.category?.name}</small></span><select className="rounded-lg border bg-white px-2 py-2 text-xs" defaultValue="" onChange={(event) => void assign(item.productId, event.target.value)}><option disabled value="">Cambiar estación</option>{stations.map((station) => <option key={station.id} value={station.id}>{station.name}</option>)}</select></label>)}</div></section>
    <section className="rounded-3xl border border-[#e6dfe8] bg-white p-6"><h3 className="font-semibold">Pedido por mozo</h3><div className="mt-4 grid gap-3 sm:grid-cols-3"><select className="rounded-xl border px-3 py-3 text-sm" onChange={(event) => setTargetOrderId(event.target.value)} value={targetOrderId}><option value="">Abrir pedido nuevo</option>{orders.filter((order) => !["CLOSED", "CANCELLED"].includes(order.diningStatus)).map((order) => <option key={order.id} value={order.id}>Agregar ronda a #{order.number} · {order.restaurantTable?.name}</option>)}</select><select className="rounded-xl border px-3 py-3 text-sm disabled:bg-stone-100" disabled={Boolean(targetOrderId)} onChange={(event) => setSelectedTable(event.target.value)} value={selectedTable}>{tables.map((table) => <option key={table.id} value={table.id}>{table.name}</option>)}</select><input className="rounded-xl border px-3 py-3 text-sm disabled:bg-stone-100" disabled={Boolean(targetOrderId)} onChange={(event) => setCustomerName(event.target.value)} placeholder="Nombre o referencia" value={customerName} /></div><div className="mt-4 grid gap-2 sm:grid-cols-2">{menu.map((item) => <div className="flex items-center justify-between rounded-xl bg-stone-50 px-4 py-3" key={item.productId}><span className="text-sm font-medium">{item.product.name}</span><input className="w-20 rounded-lg border px-2 py-1.5 text-center" min={0} onChange={(event) => setQuantities({ ...quantities, [item.productId]: Number(event.target.value) })} type="number" value={quantities[item.productId] ?? 0} /></div>)}</div><button className="mt-4 inline-flex items-center gap-2 rounded-xl bg-[#6E3482] px-5 py-3 text-sm font-semibold text-white disabled:opacity-40" disabled={busy || (!targetOrderId && !selectedTable) || selectedCount === 0} onClick={() => void sendOrder()} type="button"><Send size={16} /> {targetOrderId ? "Enviar nueva ronda" : "Abrir y enviar comanda"} ({selectedCount})</button></section>
    <section className="rounded-3xl border border-[#e6dfe8] bg-white p-6"><h3 className="font-semibold">Pedidos activos</h3><div className="mt-4 grid gap-3 lg:grid-cols-2">{orders.map((order) => <article className="rounded-2xl border p-4" key={order.id}><div className="flex justify-between"><div><p className="font-semibold">#{order.number} · {order.restaurantTable?.name}</p><p className="text-xs text-stone-400">{order.customerName} · {order.diningSource}</p></div><span className="h-fit rounded-full bg-amber-50 px-3 py-1 text-[10px] font-bold text-amber-700">{order.diningStatus}</span></div><div className="mt-3 space-y-2">{order.rounds.map((round) => <div className="rounded-xl bg-stone-50 p-3 text-xs" key={round.id}><p className="font-semibold">Ronda {round.number}</p><p className="mt-1 text-stone-500">{round.items.map((item) => `${item.quantity}× ${item.productName}`).join(" · ")}</p><p className="mt-1 text-stone-400">{round.tickets.map((ticket) => `${ticket.station.name}: ${ticket.status}`).join(" · ")}</p></div>)}</div></article>)}</div></section>
  </div>;
}
