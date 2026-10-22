"use client";

import { CalendarDays, CheckCircle2, Clock3, Users } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

import { apiRequest } from "@/lib/api";

type Deposit = { amountInCents: number; status: "PENDING" | "PAID" | "REFUNDED" | "FORFEITED" };
type Policy = { cancellationCutoffHours: number; depositRequired: boolean; depositAmountInCents: number; depositType: "FIXED" | "PER_PERSON" };
type Availability = { branch: { name: string; timezone: string }; policy: Policy; slots: Array<{ time: string; availableTableCount: number }> };
type Reservation = { id: string; status: string; startsAt: string; holdExpiresAt: string; partySize: number; table: { name: string }; deposits: Deposit[] };
type Held = { reservation: Reservation; manageToken: string };

function errorText(error: unknown) { return error instanceof Error ? error.message : "No pudimos completar la reserva"; }
function money(cents: number) { return new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 }).format(cents / 100); }

export function ReservationBooking({ restaurantSlug, branchSlug }: { restaurantSlug: string; branchSlug: string }) {
  const [date, setDate] = useState(() => new Date(Date.now() + 86_400_000).toISOString().slice(0, 10));
  const [partySize, setPartySize] = useState(2);
  const [availability, setAvailability] = useState<Availability | null>(null);
  const [time, setTime] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [held, setHeld] = useState<Held | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [waitlisted, setWaitlisted] = useState(false);
  const [cancelled, setCancelled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const reservationId = params.get("reservation");
    const manageToken = params.get("token");
    if (!reservationId || !manageToken) return;
    void apiRequest<{ reservation: Reservation }>(`/reservations/${restaurantSlug}/${branchSlug}/${reservationId}`, { headers: { "x-reservation-token": manageToken } })
      .then(({ reservation }) => {
        setHeld({ reservation, manageToken });
        setConfirmed(reservation.status === "CONFIRMED");
        setCancelled(reservation.status === "CANCELLED");
      })
      .catch((caught) => setError(errorText(caught)));
  }, [branchSlug, restaurantSlug]);

  useEffect(() => {
    let active = true;
    void apiRequest<Availability>(`/reservations/${restaurantSlug}/${branchSlug}/availability?date=${date}&partySize=${partySize}&durationMinutes=90`).then((result) => {
      if (!active) return;
      setAvailability(result);
      setTime(result.slots[0]?.time ?? "");
    }).catch((caught) => { if (active) setError(errorText(caught)); });
    return () => { active = false; };
  }, [branchSlug, date, partySize, restaurantSlug]);

  async function hold() {
    setBusy(true); setError("");
    try {
      const result = await apiRequest<Held>(`/reservations/${restaurantSlug}/${branchSlug}/holds`, { method: "POST", body: JSON.stringify({ clientRequestId: crypto.randomUUID(), date, time, partySize, durationMinutes: 90, customerName: name, customerPhone: phone, customerEmail: email || undefined }) });
      setHeld(result);
      window.history.replaceState(null, "", `?reservation=${result.reservation.id}&token=${result.manageToken}`);
    } catch (caught) { setError(errorText(caught)); } finally { setBusy(false); }
  }

  async function confirm() {
    if (!held) return;
    setBusy(true); setError("");
    try {
      const result = await apiRequest<{ reservation: Reservation }>(`/reservations/${restaurantSlug}/${branchSlug}/${held.reservation.id}/confirm`, { method: "POST", body: JSON.stringify({ manageToken: held.manageToken }) });
      setHeld({ ...held, reservation: result.reservation }); setConfirmed(true);
    } catch (caught) { setError(errorText(caught)); } finally { setBusy(false); }
  }

  async function cancel() {
    if (!held) return;
    setBusy(true); setError("");
    try {
      await apiRequest(`/reservations/${restaurantSlug}/${branchSlug}/${held.reservation.id}/cancel`, { method: "POST", body: JSON.stringify({ manageToken: held.manageToken, reason: "Cancelada por el cliente" }) });
      setConfirmed(false); setCancelled(true);
    } catch (caught) { setError(errorText(caught)); } finally { setBusy(false); }
  }

  async function joinWaitlist() {
    setBusy(true); setError("");
    try {
      await apiRequest(`/reservations/${restaurantSlug}/${branchSlug}/waitlist`, { method: "POST", body: JSON.stringify({ clientRequestId: crypto.randomUUID(), date, preferredTime: time || undefined, partySize, durationMinutes: 90, customerName: name, customerPhone: phone, customerEmail: email || undefined }) });
      setWaitlisted(true);
    } catch (caught) { setError(errorText(caught)); } finally { setBusy(false); }
  }

  const pendingDeposit = held?.reservation.deposits?.find((deposit) => deposit.status === "PENDING");

  return (
    <main className="min-h-screen bg-[#f7f3ec] px-5 py-10 text-[#261c18]">
      <div className="mx-auto max-w-xl">
        <div className="text-center"><span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-[#6E3482] text-white"><CalendarDays /></span><p className="mt-5 text-xs font-bold uppercase tracking-[.2em] text-[#8f7c94]">InfinityFood</p><h1 className="mt-2 text-3xl font-semibold">Reservá tu mesa</h1><p className="mt-2 text-sm text-stone-500">{availability?.branch.name ?? "Consultando sucursal…"}</p></div>
        {error && <p className="mt-6 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
        {cancelled ? <Message title="Reserva cancelada">La mesa quedó liberada. Si corresponde, la seña será reintegrada según la política de cancelación.</Message> : waitlisted ? <Message title="Estás en lista de espera">Te avisaremos por email cuando podamos ofrecerte una mesa. La oferta tendrá un tiempo limitado.</Message> : confirmed ? (
          <section className="mt-8 rounded-3xl bg-white p-8 text-center shadow-sm"><CheckCircle2 className="mx-auto text-emerald-600" size={46} /><h2 className="mt-4 text-2xl font-semibold">Reserva confirmada</h2><p className="mt-2 text-sm text-stone-500">Te esperamos en {held?.reservation.table.name}.</p><button className="mt-5 text-sm font-semibold text-red-700 disabled:opacity-50" disabled={busy} onClick={() => void cancel()} type="button">Cancelar reserva</button></section>
        ) : held ? (
          <section className="mt-8 rounded-3xl bg-white p-7 shadow-sm"><h2 className="text-xl font-semibold">Tu mesa está retenida</h2><p className="mt-2 text-sm text-stone-500">Confirmala antes de {new Date(held.reservation.holdExpiresAt).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })}.</p><div className="mt-5 rounded-2xl bg-stone-50 p-4 text-sm"><p className="flex items-center gap-2"><Clock3 size={15} />{new Date(held.reservation.startsAt).toLocaleString("es-AR")}</p><p className="mt-2 flex items-center gap-2"><Users size={15} />{held.reservation.partySize} personas · {held.reservation.table.name}</p></div>{pendingDeposit && <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">Se requiere una seña de <strong>{money(pendingDeposit.amountInCents)}</strong>. El local confirmará la reserva al registrarla.</p>}<button className="mt-5 w-full rounded-xl bg-[#6E3482] px-5 py-3 font-semibold text-white disabled:opacity-50" disabled={busy || Boolean(pendingDeposit)} onClick={() => void confirm()} type="button">{busy ? "Confirmando…" : pendingDeposit ? "Seña pendiente" : "Confirmar reserva"}</button></section>
        ) : (
          <section className="mt-8 rounded-3xl bg-white p-7 shadow-sm"><div className="grid gap-4 sm:grid-cols-2"><label className="text-xs font-semibold text-stone-500">Fecha<input className="mt-1 w-full rounded-xl border px-3 py-3 text-sm" min={new Date().toISOString().slice(0, 10)} onChange={(event) => setDate(event.target.value)} type="date" value={date} /></label><label className="text-xs font-semibold text-stone-500">Personas<input className="mt-1 w-full rounded-xl border px-3 py-3 text-sm" max={50} min={1} onChange={(event) => setPartySize(Number(event.target.value))} type="number" value={partySize} /></label></div><label className="mt-4 block text-xs font-semibold text-stone-500">Horario<select className="mt-1 w-full rounded-xl border px-3 py-3 text-sm" onChange={(event) => setTime(event.target.value)} value={time}><option value="">No hay horarios disponibles</option>{availability?.slots.map((slot) => <option key={slot.time} value={slot.time}>{slot.time} · {slot.availableTableCount} mesa(s)</option>)}</select></label><div className="mt-4 space-y-3"><input className="w-full rounded-xl border px-3 py-3 text-sm" onChange={(event) => setName(event.target.value)} placeholder="Nombre y apellido" value={name} /><input className="w-full rounded-xl border px-3 py-3 text-sm" onChange={(event) => setPhone(event.target.value)} placeholder="Teléfono" value={phone} /><input className="w-full rounded-xl border px-3 py-3 text-sm" onChange={(event) => setEmail(event.target.value)} placeholder="Email opcional" type="email" value={email} /></div><button className="mt-5 w-full rounded-xl bg-[#6E3482] px-5 py-3 font-semibold text-white disabled:opacity-40" disabled={busy || !time || name.length < 2 || phone.length < 6} onClick={() => void hold()} type="button">{busy ? "Reteniendo mesa…" : "Continuar"}</button>{!time && <button className="mt-3 w-full rounded-xl border border-[#6E3482] px-5 py-3 font-semibold text-[#6E3482] disabled:opacity-40" disabled={busy || name.length < 2 || phone.length < 6} onClick={() => void joinWaitlist()} type="button">Sumarme a lista de espera</button>}<p className="mt-3 text-center text-xs text-stone-400">La mesa se retiene durante 10 minutos. Cancelación sin cargo hasta {availability?.policy.cancellationCutoffHours ?? 2} h antes.</p></section>
        )}
      </div>
    </main>
  );
}

function Message({ title, children }: { title: string; children: ReactNode }) {
  return <section className="mt-8 rounded-3xl bg-white p-8 text-center shadow-sm"><CheckCircle2 className="mx-auto text-emerald-600" size={46} /><h2 className="mt-4 text-2xl font-semibold">{title}</h2><p className="mt-2 text-sm text-stone-500">{children}</p></section>;
}
