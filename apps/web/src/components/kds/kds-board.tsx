"use client";

import { ChefHat, Clock3, LogOut, RefreshCw, Wifi, WifiOff } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { io, type Socket } from "socket.io-client";

import { ApiError, apiRequest } from "@/lib/api";

type Station = { id: string; name: string; type: string };
type Ticket = { id: string; status: "PENDING" | "PREPARING" | "READY"; createdAt: string; startedAt: string | null; station: Station; items: Array<{ orderItem: { id: string; productName: string; quantity: number; notes: string | null } }>; round: { number: number; order: { number: number; customerName: string; restaurantTable: { name: string } | null } } };
const socketUrl = (process.env.NEXT_PUBLIC_SOCKET_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api").replace(/\/api\/?$/, "");

export function KdsBoard() {
  const router = useRouter();
  const [stations, setStations] = useState<Station[]>([]);
  const [stationId, setStationId] = useState("");
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState("");
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async (selected = stationId) => {
    try {
      const stationData = await apiRequest<{ stations: Station[] }>("/admin/dining/stations");
      setStations(stationData.stations);
      const next = selected || stationData.stations[0]?.id || "";
      if (!selected && next) setStationId(next);
      if (next) setTickets((await apiRequest<{ tickets: Ticket[] }>(`/admin/dining/kds/${next}/tickets`)).tickets);
      setError("");
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) { router.replace("/login"); return; }
      setError(caught instanceof Error ? caught.message : "No pudimos recuperar el tablero");
    }
  }, [router, stationId]);

  useEffect(() => {
    let active = true;
    void apiRequest<{ stations: Station[] }>("/admin/dining/stations").then(async (stationData) => {
      if (!active) return;
      setStations(stationData.stations);
      const first = stationData.stations[0]?.id ?? "";
      setStationId(first);
      if (first) {
        const snapshot = await apiRequest<{ tickets: Ticket[] }>(`/admin/dining/kds/${first}/tickets`);
        if (active) setTickets(snapshot.tickets);
      }
    }).catch((caught) => {
      if (!active) return;
      if (caught instanceof ApiError && caught.status === 401) router.replace("/login");
      else setError(caught instanceof Error ? caught.message : "No pudimos recuperar el tablero");
    });
    return () => { active = false; };
  }, [router]);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(timer); }, []);
  useEffect(() => {
    if (!stationId) return;
    const socket: Socket = io(socketUrl, { withCredentials: true, transports: ["websocket", "polling"] });
    socket.on("connect", () => { setConnected(true); socket.emit("kds:join", { stationId }); void load(stationId); });
    socket.on("disconnect", () => setConnected(false));
    socket.on("connect_error", () => setConnected(false));
    socket.on("kds:ticket-updated", () => void load(stationId));
    socket.on("dining:order-updated", () => void load(stationId));
    return () => { socket.disconnect(); };
  }, [load, stationId]);

  async function update(ticket: Ticket, status: "PREPARING" | "READY" | "SERVED") {
    try { await apiRequest(`/admin/dining/kds/tickets/${ticket.id}/status`, { method: "PATCH", body: JSON.stringify({ status, eventId: crypto.randomUUID() }) }); await load(stationId); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "No pudimos actualizar el ticket"); }
  }
  async function logout() { await apiRequest("/auth/logout", { method: "POST" }); router.replace("/login"); }
  function elapsed(ticket: Ticket) { return Math.max(0, Math.floor((now - new Date(ticket.createdAt).getTime()) / 60_000)); }

  return <main className="min-h-screen bg-[#111014] text-white"><header className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-4 border-b border-white/10 bg-[#18151b]/95 px-5 py-4 backdrop-blur"><div className="flex items-center gap-3"><span className="grid h-11 w-11 place-items-center rounded-xl bg-orange-500 text-white"><ChefHat /></span><div><h1 className="font-semibold">InfinityFood KDS</h1><p className={`flex items-center gap-1 text-xs ${connected ? "text-emerald-400" : "text-amber-400"}`}>{connected ? <Wifi size={12} /> : <WifiOff size={12} />} {connected ? "Tiempo real conectado" : "Reconectando · estado guardado en DB"}</p></div></div><div className="flex items-center gap-2"><select className="rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm" onChange={(event) => { setStationId(event.target.value); void load(event.target.value); }} value={stationId}>{stations.map((station) => <option className="bg-[#18151b]" key={station.id} value={station.id}>{station.name}</option>)}</select><button className="rounded-xl border border-white/10 p-3 text-white/60" onClick={() => void load(stationId)} title="Recargar" type="button"><RefreshCw size={16} /></button><button className="rounded-xl border border-white/10 p-3 text-white/60" onClick={() => void logout()} title="Salir" type="button"><LogOut size={16} /></button></div></header>{error && <p className="m-5 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">{error}</p>}<div className="grid gap-4 p-5 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">{tickets.map((ticket) => <article className={`overflow-hidden rounded-2xl border ${ticket.status === "READY" ? "border-emerald-400/40 bg-emerald-950/30" : ticket.status === "PREPARING" ? "border-orange-400/40 bg-orange-950/20" : "border-white/10 bg-white/[.04]"}`} key={ticket.id}><header className="flex items-center justify-between border-b border-white/10 px-5 py-4"><div><p className="text-lg font-bold">#{ticket.round.order.number} · {ticket.round.order.restaurantTable?.name ?? "Sin mesa"}</p><p className="text-xs text-white/45">Ronda {ticket.round.number} · {ticket.round.order.customerName}</p></div><span className="flex items-center gap-1 rounded-full bg-black/20 px-3 py-1 text-xs font-bold"><Clock3 size={13} /> {elapsed(ticket)} min</span></header><div className="space-y-3 p-5">{ticket.items.map(({ orderItem }) => <div key={orderItem.id}><p className="text-lg font-semibold"><span className="text-orange-400">{orderItem.quantity}×</span> {orderItem.productName}</p>{orderItem.notes && <p className="mt-1 rounded-lg bg-yellow-400/10 px-3 py-2 text-sm text-yellow-200">{orderItem.notes}</p>}</div>)}</div><footer className="border-t border-white/10 p-4">{ticket.status === "PENDING" && <button className="w-full rounded-xl bg-orange-500 py-3 text-sm font-bold" onClick={() => void update(ticket, "PREPARING")} type="button">Empezar</button>}{ticket.status === "PREPARING" && <button className="w-full rounded-xl bg-emerald-600 py-3 text-sm font-bold" onClick={() => void update(ticket, "READY")} type="button">Marcar listo</button>}{ticket.status === "READY" && <button className="w-full rounded-xl bg-white py-3 text-sm font-bold text-[#18151b]" onClick={() => void update(ticket, "SERVED")} type="button">Entregado</button>}</footer></article>)}{tickets.length === 0 && <div className="col-span-full grid min-h-72 place-items-center rounded-3xl border border-dashed border-white/10 text-center text-white/35"><div><ChefHat className="mx-auto mb-3" size={38} /><p className="font-semibold">Sin tickets pendientes</p><p className="mt-1 text-sm">Los nuevos pedidos aparecerán automáticamente.</p></div></div>}</div></main>;
}
