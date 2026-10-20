"use client";

import { CircleDollarSign, ClipboardList, Search, Truck, X } from "lucide-react";
import { type FormEvent, useEffect, useMemo, useState } from "react";

import { ApiError, apiAbsoluteUrl, apiRequest } from "@/lib/api";
import type { OrderDetail, OrderSummary, Role } from "./types";
import { EmptyState, Field, Tip, panelStyles as styles } from "./guided-panel";

const statusLabels: Record<string, string> = {
  PENDING: "Pendiente",
  CONFIRMED: "Confirmado",
  PREPARING: "Preparando",
  SHIPPED: "Enviado",
  DELIVERED: "Entregado",
  READY_FOR_PICKUP: "Listo para retirar",
  PICKED_UP: "Retirado",
  CANCELLED: "Cancelado",
};
const paymentLabels: Record<string, string> = {
  PARTIALLY_PAID: "Pago parcial",
  APPROVED: "Pago aprobado",
  REJECTED: "Pago rechazado",
  CANCELLED: "Pago cancelado",
  REFUNDED: "Reembolsado",
};
function paymentLabel(status: string, hasReceipt: boolean) {
  if (status === "PENDING") {
    return hasReceipt ? "Pago en revisión" : "Pago pendiente";
  }
  return paymentLabels[status] ?? status;
}
function notificationStatusLabel(status: string) {
  return ({
    PENDING: "Pendiente de envío",
    SENDING: "Enviando",
    SENT: "Enviado",
    FAILED: "No se pudo enviar",
  } as Record<string, string>)[status] ?? status;
}
const nextStatus: Record<string, { status: string; label: string } | undefined> = {
  CONFIRMED: { status: "PREPARING", label: "Empezar preparación" },
  SHIPPED: { status: "DELIVERED", label: "Marcar como entregado" },
  READY_FOR_PICKUP: { status: "PICKED_UP", label: "Confirmar que fue retirado" },
};
const money = (amount: number, currency: string) => new Intl.NumberFormat("es-AR", { style: "currency", currency }).format(amount / 100);

export function OrdersView({ role }: { role: Role }) {
  const canManage = role !== "STAFF";
  const [orders, setOrders] = useState<OrderSummary[]>([]);
  const [selected, setSelected] = useState<OrderDetail | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [paymentFilter, setPaymentFilter] = useState("ALL");

  async function load() {
    const response = await apiRequest<{ orders: OrderSummary[] }>("/admin/orders");
    setOrders(response.orders);
  }
  useEffect(() => {
    let active = true;
    void apiRequest<{ orders: OrderSummary[] }>("/admin/orders").then(({ orders }) => { if (active) setOrders(orders); }).catch((caught) => { if (active) setError(caught instanceof ApiError ? caught.message : "No se pudieron cargar los pedidos"); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    if (!selected) return;
    const previous = document.body.style.overflow;
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") setSelected(null); };
    document.body.style.overflow = "hidden"; document.addEventListener("keydown", close);
    return () => { document.body.style.overflow = previous; document.removeEventListener("keydown", close); };
  }, [selected]);
  async function open(orderId: string) {
    setError("");
    setNotice("");
    try { const response = await apiRequest<{ order: OrderDetail }>(`/admin/orders/${orderId}`); setSelected(response.order); }
    catch (caught) { setError(caught instanceof ApiError ? caught.message : "No se pudo abrir el pedido"); }
  }

  async function updateContactAndResend(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    setBusy(true);
    setError("");
    setNotice("");
    const form = new FormData(event.currentTarget);
    try {
      const response = await apiRequest<{
        customerEmail: string;
        notification: OrderDetail["notificationLogs"][number] | null;
      }>(`/admin/orders/${selected.id}/contact-and-resend`, {
        method: "PATCH",
        body: JSON.stringify({ email: form.get("email") }),
      });
      setSelected({
        ...selected,
        customerEmail: response.customerEmail,
        notificationLogs: response.notification
          ? [response.notification, ...(selected.notificationLogs ?? [])]
          : selected.notificationLogs ?? [],
      });
      setNotice("Email guardado. La confirmación quedó lista para enviarse.");
      await load();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "No se pudo guardar y reenviar la confirmación");
    } finally {
      setBusy(false);
    }
  }

  async function update(body: { status?: string; paymentStatus?: string }) {
    if (!selected) return;
    setBusy(true);
    setError("");
    try {
      const response = await apiRequest<{ order: OrderDetail }>(`/admin/orders/${selected.id}`, { method: "PATCH", body: JSON.stringify(body) });
      setSelected({ ...response.order, notificationLogs: response.order.notificationLogs ?? selected.notificationLogs });
      await load();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "No se pudo actualizar el pedido");
    } finally {
      setBusy(false);
    }
  }

  async function dispatch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    setBusy(true);
    setError("");
    const form = new FormData(event.currentTarget);
    try {
      const response = await apiRequest<{
        order: OrderDetail;
        notification: { sent: boolean; error: string | null };
      }>(`/admin/orders/${selected.id}/dispatch`, {
        method: "POST",
        body: JSON.stringify({
          carrier: form.get("carrier"),
          trackingCode: form.get("trackingCode") || null,
          trackingUrl: form.get("trackingUrl") || null,
          estimatedDelivery: form.get("estimatedDelivery") || null,
        }),
      });
      setSelected({ ...response.order, notificationLogs: response.order.notificationLogs ?? selected.notificationLogs });
      if (!response.notification.sent) setError("El pedido fue despachado, pero el correo no pudo enviarse. Podés reintentarlo.");
      await load();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "No se pudo despachar el pedido");
    } finally {
      setBusy(false);
    }
  }

  async function retryEmail() {
    if (!selected) return;
    setBusy(true);
    setError("");
    try {
      const response = await apiRequest<{
        notification: { sent: boolean; error: string | null };
        shipment: OrderDetail["shipment"];
      }>(`/admin/orders/${selected.id}/shipment-email`, { method: "POST" });
      setSelected({ ...selected, shipment: response.shipment });
      if (!response.notification.sent) setError(response.notification.error ?? "El correo volvió a fallar");
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "No se pudo reenviar el correo");
    } finally {
      setBusy(false);
    }
  }

  const filteredOrders = useMemo(() => {
    const term = search.trim().toLocaleLowerCase("es");
    return orders.filter((order) => {
      const matchesTerm = !term || [`#${order.number}`, String(order.number), order.customerName, order.customerEmail].some((value) => value.toLocaleLowerCase("es").includes(term));
      const matchesStatus = statusFilter === "ALL" || order.status === statusFilter;
      const paymentGroup = order.paymentStatus === "PENDING" && order.paymentReceipt ? "REVIEW" : order.paymentStatus;
      return matchesTerm && matchesStatus && (paymentFilter === "ALL" || paymentGroup === paymentFilter);
    });
  }, [orders, search, statusFilter, paymentFilter]);
  const awaitingReview = orders.filter((order) => order.paymentStatus === "PENDING" && order.paymentReceipt).length;
  const preparing = orders.filter((order) => ["CONFIRMED", "PREPARING"].includes(order.status)).length;

  return (
    <div className={`${styles.surface} mx-auto max-w-7xl`}>
      <div className="mb-6">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#6E3482]">Pedidos</p>
        <h2 className="mt-2 text-2xl font-semibold tracking-tight">Del pago a la entrega</h2>
        <p className="mt-2 text-sm text-[#807384]">Revisá cada compra y avanzala siguiendo las acciones sugeridas.</p>
      </div>
      {error && !selected && <p role="alert" className="mb-4 rounded-xl bg-red-50 p-4 text-sm text-red-700">{error}</p>}
      <div className="mb-5 grid gap-3 sm:grid-cols-3"><OrderSummaryCard icon={ClipboardList} label="Pedidos totales" value={orders.length} help="Todas las compras creadas." /><OrderSummaryCard icon={CircleDollarSign} label="Pagos para revisar" value={awaitingReview} help="Tienen comprobante adjunto." attention={awaitingReview > 0} /><OrderSummaryCard icon={Truck} label="En preparación" value={preparing} help="Confirmados o preparando." /></div>
      <Tip title="Flujo recomendado">1. Revisá el pago. 2. Confirmá y prepará el pedido. 3. Cargá los datos de envío. 4. Marcá la entrega. El cliente recibe las actualizaciones correspondientes.</Tip>
      <section className="my-5 rounded-2xl border border-[#e6dfe8] bg-white p-4">
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_13rem_13rem]">
          <label className="relative"><span className="sr-only">Buscar pedido</span><Search className="absolute left-3.5 top-3.5 h-4 w-4 text-[#918495]" /><input className="control pl-10!" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Número, cliente o email" /></label>
          <select aria-label="Filtrar por estado del pedido" className="control" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="ALL">Todos los estados</option>{Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
          <select aria-label="Filtrar por estado del pago" className="control" value={paymentFilter} onChange={(event) => setPaymentFilter(event.target.value)}><option value="ALL">Todos los pagos</option><option value="PENDING">Pago pendiente</option><option value="REVIEW">Pago en revisión</option><option value="PARTIALLY_PAID">Pago parcial</option><option value="APPROVED">Pago aprobado</option><option value="REJECTED">Pago rechazado</option><option value="REFUNDED">Reembolsado</option></select>
        </div><p className="mt-3 text-xs text-[#918495]">Mostrando {filteredOrders.length} de {orders.length} pedidos.</p>
      </section>
      {loading ? <div className="h-56 animate-pulse rounded-2xl bg-[#eee9ef]" /> : orders.length === 0 ? <Empty /> : filteredOrders.length === 0 ? <EmptyState title="No encontramos pedidos con esos filtros">Probá otro número, nombre o estado.</EmptyState> : <OrderTable orders={filteredOrders} onOpen={(id) => void open(id)} />}
      {selected && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/35">
          <button aria-label="Cerrar detalle" className="absolute inset-0" onClick={() => setSelected(null)} type="button" />
          <aside aria-label={`Detalle del pedido ${selected.number}`} className="relative h-full w-full max-w-2xl overflow-y-auto bg-[#fbfafc] p-6 shadow-2xl sm:p-8" role="dialog" aria-modal="true">
            <header className="flex items-start justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#6E3482]">Detalle del pedido</p>
                <h2 className="mt-1 text-3xl font-semibold">#{selected.number}</h2>
              </div>
              <button aria-label="Cerrar detalle" className="grid h-10 w-10 place-items-center rounded-xl bg-[#f5eff8] text-[#6E3482]" onClick={() => setSelected(null)} type="button">
                <X size={19} />
              </button>
            </header>
            <div className="mt-6 flex flex-wrap gap-2">
              <Badge label={statusLabels[selected.status] ?? selected.status} />
              <Badge label={paymentLabel(selected.paymentStatus, Boolean(selected.paymentReceipt))} />
            </div>
            <Section title={selected.fulfillmentType === "PICKUP" ? "Cliente y retiro" : "Cliente y entrega"}>
              <dl className="grid gap-4 text-sm sm:grid-cols-2">
                <Detail label="Cliente" value={selected.customerName} />
                <Detail label="Email" value={selected.customerEmail} />
                <Detail label="Teléfono" value={selected.customerPhone ?? "—"} />
                {selected.fulfillmentType === "DELIVERY" ? <><Detail label="Dirección" value={selected.shippingAddress ?? "—"} /><Detail label="Código postal" value={selected.shippingPostalCode ?? "—"} /><Detail label="Zona" value={selected.shippingZoneName ?? "—"} /><Detail label="Método" value={selected.shippingMethod ?? "—"} /><Detail label="Plazo prometido" value={formatDeliveryRange(selected.shippingEstimatedDaysMin, selected.shippingEstimatedDaysMax)} /><Detail label="Costo cobrado" value={selected.shippingInCents > 0 ? money(selected.shippingInCents, selected.currency) : "Gratis"} /></> : <>
                  <Detail label="Punto de retiro" value={selected.pickupLocationName ?? "—"} />
                  <Detail label="Dirección del local" value={selected.pickupAddress ?? "—"} />
                  <Detail label="Horarios" value={selected.pickupOpeningHours ?? "Consultar con el local"} />
                  <Detail label="Teléfono del local" value={selected.pickupPhone ?? "—"} />
                </>}
              </dl>
              {canManage && (
                <details className="mt-5 rounded-xl border border-[#e6dfe8] bg-white p-4">
                  <summary className="cursor-pointer text-sm font-semibold text-[#6E3482]">Corregir email y reenviar confirmación</summary>
                  <form className="mt-4 flex flex-col gap-3 sm:flex-row" onSubmit={updateContactAndResend}>
                    <label className="min-w-0 flex-1 text-xs font-semibold text-[#66586a]">Email del pedido<input className="control mt-1.5" defaultValue={selected.customerEmail} name="email" required type="email" /></label>
                    <button className="self-end rounded-xl bg-[#49225B] px-4 py-3 text-xs font-bold text-white disabled:opacity-50" disabled={busy} type="submit">{busy ? "Guardando…" : "Guardar y reenviar"}</button>
                  </form>
                  <p className="mt-2 text-xs leading-5 text-[#918495]">El cambio se aplica a este pedido y genera un nuevo enlace seguro de seguimiento.</p>
                </details>
              )}
              {selected.notificationLogs?.length > 0 && (
                <div className="mt-4 rounded-xl bg-[#fbf8fc] px-4 py-3 text-xs text-[#66586a]">
                  <strong className="text-[#382d3b]">Último email de confirmación</strong>
                  <p className="mt-1">{notificationStatusLabel(selected.notificationLogs[0]!.status)} · {selected.notificationLogs[0]!.recipient}</p>
                  {selected.notificationLogs[0]!.error && <p className="mt-1 text-red-700">{selected.notificationLogs[0]!.error}</p>}
                </div>
              )}
              {selected.fulfillmentType === "PICKUP" && selected.pickupInstructions && <p className="mt-4 rounded-xl bg-[#fbf8fc] px-4 py-3 text-xs leading-5 text-[#66586a]"><strong>Indicaciones:</strong> {selected.pickupInstructions}</p>}
              {selected.fulfillmentType === "PICKUP" && selected.pickupMapsUrl && <a className="mt-4 inline-flex items-center gap-1 text-xs font-semibold text-[#6E3482] underline" href={selected.pickupMapsUrl} target="_blank" rel="noreferrer">Abrir ubicación en Google Maps ↗</a>}
              {selected.fulfillmentType === "DELIVERY" && (selected.shippingPolicySnapshot || selected.returnPolicySnapshot) && <div className="mt-4 space-y-3 rounded-xl bg-[#fbf8fc] px-4 py-3 text-xs leading-5 text-[#66586a]">{selected.shippingPolicySnapshot && <p><strong>Política de entrega:</strong> {selected.shippingPolicySnapshot}</p>}{selected.returnPolicySnapshot && <p><strong>Cambios y devoluciones:</strong> {selected.returnPolicySnapshot}</p>}</div>}
            </Section>
            <Section title="Productos">
              <div className="divide-y divide-stone-100">
                {selected.items.map((item) => (
                  <div className="flex justify-between gap-4 py-3" key={item.id}>
                    <div>
                      <p className="text-sm font-semibold">{item.productName}</p>
                      <p className="text-xs text-stone-400">
                        {item.quantity} × {money(item.unitPriceInCents, selected.currency)}
                      </p>
                    </div>
                    <strong className="text-sm">{money(item.subtotalInCents, selected.currency)}</strong>
                  </div>
                ))}
              </div>
            </Section>
            {selected.paymentReceipt && (
              <Section title="Comprobante de transferencia">
                <p className="text-sm text-stone-500">{selected.paymentReceipt.originalName}</p>
                <button className="mt-4 rounded-xl border border-stone-200 px-4 py-2.5 text-sm font-semibold" onClick={() => window.open(apiAbsoluteUrl(`/admin/orders/${selected.id}/receipt`), "_blank", "noopener,noreferrer")} type="button">
                  Ver comprobante ↗
                </button>
              </Section>
            )}
            {selected.shipment && (
              <Section title="Envío">
                <dl className="grid gap-3 text-sm">
                  <Detail label="Transportista" value={selected.shipment.carrier} />
                  <Detail label="Seguimiento" value={selected.shipment.trackingCode ?? "—"} />
                  <Detail label="Email" value={selected.shipment.notificationStatus} />
                </dl>
                {selected.shipment.notificationStatus === "FAILED" && canManage && <Action disabled={busy} label="Reintentar correo" onClick={() => void retryEmail()} />}
              </Section>
            )}
            <Section title="Historial">
              <ol className="space-y-3">
                {selected.statusHistory.map((entry) => (
                  <li className="flex gap-3 text-sm" key={entry.id}>
                    <span className="mt-1.5 h-2 w-2 rounded-full bg-amber-700" />
                    <div>
                      <strong>{statusLabels[entry.status] ?? entry.status}</strong>
                      <p className="text-xs text-stone-400">
                        {new Date(entry.createdAt).toLocaleString("es-AR")}
                        {entry.note ? ` · ${entry.note}` : ""}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
            </Section>
            {notice && <p className="mt-5 rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{notice}</p>}
            {error && <p className="mt-5 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
            {canManage && (
              <section className="mt-8 space-y-3 border-t border-stone-200 pt-6">
                <h3 className="font-semibold">Siguiente paso</h3>
                <p className="text-xs leading-5 text-[#807384]">InfinityFood muestra solo las acciones que corresponden al estado actual.</p>
                {selected.paymentMethod === "BANK_TRANSFER" && selected.paymentStatus === "PENDING" && (
                  <><Tip title={selected.paymentReceipt ? "Comprobante recibido" : "Esperando comprobante"}>{selected.paymentReceipt ? "Abrilo y compará importe, titular y referencia antes de aprobar. Al aprobar, el stock queda confirmado." : "Todavía no podés aprobar la transferencia. El cliente debe adjuntar primero su comprobante."}</Tip><div className="grid gap-2 sm:grid-cols-2">
                    <Action disabled={busy || !selected.paymentReceipt} label="Aprobar transferencia" onClick={() => void update({ paymentStatus: "APPROVED" })} primary />
                    <Action disabled={busy} label="Rechazar comprobante" onClick={() => void update({ paymentStatus: "REJECTED" })} />
                  </div></>
                )}
                {nextStatus[selected.status] && (
                  <Action
                    disabled={busy}
                    label={nextStatus[selected.status]!.label}
                    onClick={() =>
                      void update({
                        status: nextStatus[selected.status]!.status,
                      })
                    }
                    primary
                  />
                )}
                {selected.status === "PREPARING" && selected.fulfillmentType === "DELIVERY" && <DispatchForm busy={busy} onSubmit={dispatch} order={selected} />}
                {selected.status === "PREPARING" && selected.fulfillmentType === "PICKUP" && <Action disabled={busy || selected.paymentStatus !== "APPROVED"} label="Marcar listo para retirar y avisar" onClick={() => void update({ status: "READY_FOR_PICKUP" })} primary />}
                {["PENDING", "CONFIRMED", "PREPARING"].includes(selected.status) && <Action danger disabled={busy} label="Cancelar pedido y reponer stock" onClick={() => void update({ status: "CANCELLED" })} />}
              </section>
            )}
          </aside>
        </div>
      )}
    </div>
  );
}

function OrderTable({ orders, onOpen }: { orders: OrderSummary[]; onOpen: (id: string) => void }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-sm">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[52rem] text-left text-sm">
          <thead className="border-b bg-stone-50 text-xs uppercase tracking-wider text-stone-400">
            <tr>
              <th className="px-5 py-3">Pedido</th>
              <th className="px-5 py-3">Cliente</th>
              <th className="px-5 py-3">Estado</th>
              <th className="px-5 py-3">Pago</th>
              <th className="px-5 py-3 text-right">Total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {orders.map((order) => (
              <tr className="cursor-pointer hover:bg-stone-50" key={order.id} onClick={() => onOpen(order.id)}>
                <td className="px-5 py-4">
                  <strong>#{order.number}</strong>
                  <p className="text-xs text-stone-400">{new Date(order.createdAt).toLocaleDateString("es-AR")}</p>
                </td>
                <td className="px-5 py-4">
                  {order.customerName}
                  <p className="text-xs text-stone-400">{order._count.items} productos</p>
                </td>
                <td className="px-5 py-4">
                  <Badge label={statusLabels[order.status] ?? order.status} />
                </td>
                <td className="px-5 py-4">
                  <Badge label={paymentLabel(order.paymentStatus, Boolean(order.paymentReceipt))} />
                  {order.paymentReceipt && <p className="mt-1 text-xs text-emerald-700">Comprobante adjunto</p>}
                </td>
                <td className="px-5 py-4 text-right font-semibold">{money(order.totalInCents, order.currency)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
function DispatchForm({ busy, onSubmit, order }: { busy: boolean; onSubmit: (event: FormEvent<HTMLFormElement>) => void; order: OrderDetail }) {
  return (
    <form className="mt-4 space-y-5 rounded-2xl border border-[#e6dfe8] bg-white p-5" onSubmit={onSubmit}>
      <div><h4 className="text-sm font-semibold">Datos del envío</h4><p className="mt-1 text-xs leading-5 text-[#807384]">Se guardan en el seguimiento del cliente. El transportista es obligatorio; el resto puede completarse si está disponible.</p></div>
      <Field label="Transportista" help="Se completa con la empresa configurada en el método, pero podés cambiarla." example="Ejemplo: Correo Argentino"><input defaultValue={order.shippingCarrierName ?? ""} name="carrier" placeholder="Correo Argentino" required /></Field>
      <Field label="Código de seguimiento (opcional)" help="Identificador entregado por el transportista." example="Ejemplo: CP123456789AR"><input name="trackingCode" placeholder="CP123456789AR" /></Field>
      <Field label="Enlace de seguimiento (opcional)" help={order.shippingTrackingUrlTemplate ? "Si lo dejás vacío, InfinityFood generará el enlace configurado para este transportista." : "URL completa donde el cliente puede consultar su envío."} example="Ejemplo: https://correo.com/seguimiento"><input name="trackingUrl" placeholder="Se genera automáticamente cuando está configurado" type="url" /></Field>
      <Field label="Entrega estimada (opcional)" help="La calculamos usando el plazo máximo prometido; podés corregirla."><input defaultValue={estimatedBusinessDate(order.shippingEstimatedDaysMax)} name="estimatedDelivery" type="date" /></Field>
      <button className={`${styles.button} w-full`} disabled={busy} type="submit">
        Despachar y notificar
      </button>
    </form>
  );
}
function formatDeliveryRange(minimum: number | null, maximum: number | null) {
  if (minimum && maximum && minimum !== maximum) return `${minimum} a ${maximum} días hábiles`;
  if (minimum || maximum) return `${minimum ?? maximum} días hábiles`;
  return "A coordinar";
}
function estimatedBusinessDate(days: number | null) {
  if (!days) return undefined;
  const date = new Date();
  let remaining = days;
  while (remaining > 0) {
    date.setDate(date.getDate() + 1);
    if (date.getDay() !== 0 && date.getDay() !== 6) remaining -= 1;
  }
  return date.toISOString().slice(0, 10);
}
function Empty() {
  return (
    <EmptyState title="Todavía no hay pedidos">Cuando un cliente finalice el checkout, su compra aparecerá acá para que puedas revisarla.</EmptyState>
  );
}
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-6 rounded-2xl border border-[#e6dfe8] bg-white p-5">
      <h3 className="mb-4 font-semibold text-[#4b3a50]">{title}</h3>
      {children}
    </section>
  );
}
function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-stone-400">{label}</dt>
      <dd className="mt-1 font-medium text-stone-700">{value}</dd>
    </div>
  );
}
function Badge({ label }: { label: string }) {
  const approved = label === "Pago aprobado" || label === "Entregado";
  const review = label === "Pago en revisión" || label === "Pendiente";
  return <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${approved ? "bg-emerald-50 text-emerald-700" : review ? "bg-amber-50 text-amber-800" : "bg-[#f4eff7] text-[#6E3482]"}`}>{label}</span>;
}
function Action({ label, onClick, disabled, primary, danger }: { label: string; onClick: () => void; disabled: boolean; primary?: boolean; danger?: boolean }) {
  return (
    <button className={`mt-2 w-full rounded-xl px-4 py-3 text-sm font-semibold disabled:opacity-40 ${danger ? "bg-red-50 text-red-700" : primary ? "bg-[#49225B] text-white" : "border border-[#e6dfe8] bg-white text-[#4b3a50]"}`} disabled={disabled} onClick={onClick} type="button">
      {label}
    </button>
  );
}

function OrderSummaryCard({ icon: Icon, label, value, help, attention = false }: { icon: typeof ClipboardList; label: string; value: number; help: string; attention?: boolean }) {
  return <article className={styles.card}><div className="flex items-start justify-between gap-3"><div><p className="text-xs text-[#807384]">{label}</p><p className="mt-2 text-2xl font-semibold">{value}</p><p className="mt-2 text-xs leading-5 text-[#918495]">{help}</p></div><span className={`rounded-lg p-2 ${attention ? "bg-amber-50 text-amber-700" : "bg-[#f5eff8] text-[#6E3482]"}`}><Icon size={17} /></span></div></article>;
}
