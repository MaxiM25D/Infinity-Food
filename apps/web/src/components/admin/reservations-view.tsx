"use client";

import { CalendarDays, Check, Clock3, RefreshCw, Save, UserRound, Users, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { io, type Socket } from "socket.io-client";

import { apiRequest } from "@/lib/api";

type Reservation = {
  id: string; status: string; partySize: number; customerName: string; customerPhone: string; customerEmail: string | null;
  notes: string | null; startsAt: string; endsAt: string; holdExpiresAt: string | null;
  table: { id: string; code: string; name: string; maxCapacity: number };
};
type Schedule = { weekday: number; opensAtMinutes: number; closesAtMinutes: number; active: boolean };
type Overview = { date: string; timezone: string; reservations: Reservation[]; schedules: Schedule[]; defaults: { durationMinutes: number; holdMinutes: number; slotMinutes: number } };
type Availability = { slots: Array<{ time: string; startsAt: string; availableTableCount: number; availableCapacity: number }> };

const weekdays = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
const statusLabels: Record<string, string> = { HOLD: "Hold", CONFIRMED: "Confirmada", CANCELLED: "Cancelada", NO_SHOW: "No-show", SEATED: "En mesa", COMPLETED: "Finalizada", EXPIRED: "Vencida" };
const statusColors: Record<string, string> = { HOLD: "bg-amber-50 text-amber-700", CONFIRMED: "bg-emerald-50 text-emerald-700", CANCELLED: "bg-stone-100 text-stone-500", NO_SHOW: "bg-red-50 text-red-700", SEATED: "bg-blue-50 text-blue-700", COMPLETED: "bg-violet-50 text-violet-700", EXPIRED: "bg-stone-100 text-stone-500" };
const socketUrl = (process.env.NEXT_PUBLIC_SOCKET_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api").replace(/\/api\/?$/, "");

function minutesToTime(minutes: number) { return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`; }
function timeToMinutes(value: string) { const [hours, minutes] = value.split(":").map(Number); return (hours ?? 0) * 60 + (minutes ?? 0); }
function errorText(error: unknown) { return error instanceof Error ? error.message : "No pudimos completar la operación"; }

export function ReservationsView() {
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [overview, setOverview] = useState<Overview | null>(null);
  const [slots, setSlots] = useState<Availability["slots"]>([]);
  const [time, setTime] = useState("");
  const [partySize, setPartySize] = useState(2);
  const [durationMinutes, setDurationMinutes] = useState(90);
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [busy, setBusy] = useState(false);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const data = await apiRequest<Overview>(`/admin/reservations/overview?date=${encodeURIComponent(date)}`);
    setOverview(data);
    setSchedules(data.schedules.length === 7 ? data.schedules : weekdays.map((_, weekday) => ({ weekday, opensAtMinutes: 720, closesAtMinutes: 1380, active: true })));
  }, [date]);

  const checkAvailability = useCallback(async () => {
    const result = await apiRequest<Availability>(`/admin/reservations/availability?date=${encodeURIComponent(date)}&partySize=${partySize}&durationMinutes=${durationMinutes}`);
    setSlots(result.slots);
    setTime((current) => result.slots.some((slot) => slot.time === current) ? current : (result.slots[0]?.time ?? ""));
  }, [date, durationMinutes, partySize]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load().catch((caught) => setError(errorText(caught))); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);
  useEffect(() => {
    const timer = window.setTimeout(() => { void checkAvailability().catch((caught) => setError(errorText(caught))); }, 0);
    return () => window.clearTimeout(timer);
  }, [checkAvailability]);
  useEffect(() => {
    const socket: Socket = io(socketUrl, { withCredentials: true, transports: ["websocket", "polling"] });
    socket.on("connect", () => setConnected(true));
    socket.on("disconnect", () => setConnected(false));
    socket.on("connect_error", () => setConnected(false));
    socket.on("reservation:updated", () => { void load(); void checkAvailability(); });
    return () => { socket.disconnect(); };
  }, [checkAvailability, load]);

  async function action(work: () => Promise<void>) {
    setBusy(true); setError("");
    try { await work(); await Promise.all([load(), checkAvailability()]); } catch (caught) { setError(errorText(caught)); } finally { setBusy(false); }
  }
  function createHold() {
    if (!time) return;
    void action(async () => {
      await apiRequest("/admin/reservations/holds", { method: "POST", body: JSON.stringify({ clientRequestId: crypto.randomUUID(), date, time, partySize, durationMinutes, customerName, customerPhone, customerEmail: customerEmail || undefined }) });
      setCustomerName(""); setCustomerPhone(""); setCustomerEmail("");
    });
  }
  function transition(id: string, status: string) {
    void action(async () => { await apiRequest(`/admin/reservations/${id}/status`, { method: "PATCH", body: JSON.stringify({ status }) }); });
  }
  function saveSchedules() {
    void action(async () => { await apiRequest("/admin/reservations/schedules", { method: "PUT", body: JSON.stringify({ schedules }) }); });
  }
  const activeCount = useMemo(() => overview?.reservations.filter(({ status }) => ["HOLD", "CONFIRMED", "SEATED"].includes(status)).length ?? 0, [overview]);

  return <div className="space-y-7">
    <div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-xs font-bold uppercase tracking-[.18em] text-[#8f7c94]">Etapa 5</p><h2 className="mt-2 text-2xl font-semibold">Reservas</h2><p className="mt-2 text-sm text-stone-500">Disponibilidad, holds y estados en la zona horaria de la sucursal.</p></div><div className="flex items-center gap-2"><span className={`rounded-full px-3 py-2 text-xs font-semibold ${connected ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>{connected ? "Tiempo real conectado" : "Reconectando…"}</span><button className="rounded-xl border bg-white p-3" onClick={() => void load()} title="Actualizar" type="button"><RefreshCw size={17}/></button></div></div>
    {error && <p className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    <div className="grid gap-6 xl:grid-cols-[minmax(20rem,.75fr)_minmax(0,1.25fr)]">
      <section className="rounded-3xl border border-[#e6dfe8] bg-white p-6"><h3 className="flex items-center gap-2 font-semibold"><CalendarDays size={18}/> Nueva reserva</h3><div className="mt-5 grid gap-3 sm:grid-cols-2"><label className="text-xs font-semibold text-stone-500">Fecha<input className="mt-1 w-full rounded-xl border px-3 py-2.5 text-sm" min={new Date().toISOString().slice(0, 10)} onChange={(event) => setDate(event.target.value)} type="date" value={date}/></label><label className="text-xs font-semibold text-stone-500">Personas<input className="mt-1 w-full rounded-xl border px-3 py-2.5 text-sm" max={50} min={1} onChange={(event) => setPartySize(Number(event.target.value))} type="number" value={partySize}/></label><label className="text-xs font-semibold text-stone-500">Duración<select className="mt-1 w-full rounded-xl border px-3 py-2.5 text-sm" onChange={(event) => setDurationMinutes(Number(event.target.value))} value={durationMinutes}><option value={60}>60 minutos</option><option value={90}>90 minutos</option><option value={120}>120 minutos</option></select></label><label className="text-xs font-semibold text-stone-500">Horario<select className="mt-1 w-full rounded-xl border px-3 py-2.5 text-sm" onChange={(event) => setTime(event.target.value)} value={time}><option value="">Sin disponibilidad</option>{slots.map((slot) => <option key={slot.time} value={slot.time}>{slot.time} · {slot.availableTableCount} mesa(s)</option>)}</select></label></div><div className="mt-4 space-y-3"><input className="w-full rounded-xl border px-3 py-2.5 text-sm" onChange={(event) => setCustomerName(event.target.value)} placeholder="Nombre del cliente" value={customerName}/><input className="w-full rounded-xl border px-3 py-2.5 text-sm" onChange={(event) => setCustomerPhone(event.target.value)} placeholder="Teléfono" value={customerPhone}/><input className="w-full rounded-xl border px-3 py-2.5 text-sm" onChange={(event) => setCustomerEmail(event.target.value)} placeholder="Email opcional" type="email" value={customerEmail}/><button className="w-full rounded-xl bg-[#6E3482] px-5 py-3 text-sm font-semibold text-white disabled:opacity-40" disabled={busy || !time || customerName.length < 2 || customerPhone.length < 6} onClick={createHold} type="button">Crear hold por {overview?.defaults.holdMinutes ?? 10} minutos</button></div></section>
      <section className="rounded-3xl border border-[#e6dfe8] bg-white p-6"><div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="font-semibold">Agenda del día</h3><p className="mt-1 text-xs text-stone-400">{overview?.timezone} · {activeCount} activas</p></div><input className="rounded-xl border px-3 py-2 text-sm" onChange={(event) => setDate(event.target.value)} type="date" value={date}/></div><div className="mt-5 space-y-3">{overview?.reservations.length ? overview.reservations.map((reservation) => <article className="rounded-2xl border p-4" key={reservation.id}><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="flex items-center gap-2 font-semibold"><Clock3 size={15}/>{new Date(reservation.startsAt).toLocaleTimeString("es-AR", { timeZone: overview.timezone, hour: "2-digit", minute: "2-digit" })} · {reservation.table.name}</p><p className="mt-2 flex items-center gap-2 text-sm text-stone-600"><UserRound size={14}/>{reservation.customerName} · <Users size={14}/>{reservation.partySize}</p><p className="mt-1 text-xs text-stone-400">{reservation.customerPhone}{reservation.customerEmail ? ` · ${reservation.customerEmail}` : ""}</p></div><span className={`rounded-full px-3 py-1 text-xs font-semibold ${statusColors[reservation.status] ?? "bg-stone-100"}`}>{statusLabels[reservation.status] ?? reservation.status}</span></div><div className="mt-4 flex flex-wrap gap-2">{reservation.status === "HOLD" && <><button className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white" onClick={() => transition(reservation.id, "CONFIRMED")} type="button"><Check className="mr-1 inline" size={13}/>Confirmar</button><button className="rounded-lg border border-red-200 px-3 py-2 text-xs font-semibold text-red-600" onClick={() => transition(reservation.id, "CANCELLED")} type="button"><X className="mr-1 inline" size={13}/>Cancelar</button></>}{reservation.status === "CONFIRMED" && <><button className="rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white" onClick={() => transition(reservation.id, "SEATED")} type="button">Sentar</button><button className="rounded-lg border border-amber-200 px-3 py-2 text-xs font-semibold text-amber-700" onClick={() => transition(reservation.id, "NO_SHOW")} type="button">No-show</button><button className="rounded-lg border border-red-200 px-3 py-2 text-xs font-semibold text-red-600" onClick={() => transition(reservation.id, "CANCELLED")} type="button">Cancelar</button></>}{reservation.status === "SEATED" && <button className="rounded-lg bg-[#211b23] px-3 py-2 text-xs font-semibold text-white" onClick={() => transition(reservation.id, "COMPLETED")} type="button">Finalizar</button>}</div></article>) : <div className="rounded-2xl border border-dashed p-10 text-center text-sm text-stone-400">No hay reservas para esta fecha.</div>}</div></section>
    </div>
    <section className="rounded-3xl border border-[#e6dfe8] bg-white p-6"><div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="font-semibold">Horarios de reservas</h3><p className="mt-1 text-xs text-stone-400">Intervalos de 30 minutos. Se aplican en {overview?.timezone}.</p></div><button className="inline-flex items-center gap-2 rounded-xl bg-[#211b23] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-40" disabled={busy || schedules.length !== 7} onClick={saveSchedules} type="button"><Save size={15}/>Guardar horarios</button></div><div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">{schedules.map((schedule, index) => <div className="rounded-2xl bg-stone-50 p-4" key={schedule.weekday}><label className="flex items-center justify-between text-sm font-semibold">{weekdays[schedule.weekday]}<input checked={schedule.active} onChange={(event) => setSchedules(schedules.map((item, itemIndex) => itemIndex === index ? { ...item, active: event.target.checked } : item))} type="checkbox"/></label><div className="mt-3 flex gap-2"><input className="min-w-0 flex-1 rounded-lg border px-2 py-2 text-xs" disabled={!schedule.active} onChange={(event) => setSchedules(schedules.map((item, itemIndex) => itemIndex === index ? { ...item, opensAtMinutes: timeToMinutes(event.target.value) } : item))} step={1800} type="time" value={minutesToTime(schedule.opensAtMinutes)}/><input className="min-w-0 flex-1 rounded-lg border px-2 py-2 text-xs" disabled={!schedule.active} onChange={(event) => setSchedules(schedules.map((item, itemIndex) => itemIndex === index ? { ...item, closesAtMinutes: timeToMinutes(event.target.value) } : item))} step={1800} type="time" value={minutesToTime(schedule.closesAtMinutes)}/></div></div>)}</div></section>
  </div>;
}
