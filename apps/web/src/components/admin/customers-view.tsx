"use client";

import { CircleDollarSign, Search, ShoppingBag, UserRound, X } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";

import { ApiError, apiRequest } from "@/lib/api";
import type { CustomerDetail, CustomerSummary } from "./types";
import { EmptyState, Tip, panelStyles as styles } from "./guided-panel";

type Pagination = {
  page: number;
  pageSize: number;
  total: number;
  pages: number;
};

const money = (amount: number, currency = "ARS") => new Intl.NumberFormat("es-AR", { style: "currency", currency }).format(amount / 100);

const orderStatus: Record<string, string> = {
  PENDING: "Pendiente",
  CONFIRMED: "Confirmado",
  PREPARING: "Preparando",
  SHIPPED: "Enviado",
  DELIVERED: "Entregado",
  READY_FOR_PICKUP: "Listo para retirar",
  PICKED_UP: "Retirado",
  CANCELLED: "Cancelado",
};

export function CustomersView() {
  const [customers, setCustomers] = useState<CustomerSummary[]>([]);
  const [pagination, setPagination] = useState<Pagination>({
    page: 1,
    pageSize: 20,
    total: 0,
    pages: 1,
  });
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<CustomerDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function load(page = 1, term = search) {
    setLoading(true);
    setError("");
    try {
      const query = new URLSearchParams({ page: String(page), pageSize: "20" });
      if (term.trim()) query.set("search", term.trim());
      const response = await apiRequest<{
        customers: CustomerSummary[];
        pagination: Pagination;
      }>(`/admin/customers?${query}`);
      setCustomers(response.customers);
      setPagination(response.pagination);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "No se pudieron cargar los clientes");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const query = new URLSearchParams({ page: "1", pageSize: "20" });
    void apiRequest<{ customers: CustomerSummary[]; pagination: Pagination }>(`/admin/customers?${query}`)
      .then((response) => {
        setCustomers(response.customers);
        setPagination(response.pagination);
      })
      .catch((caught) => setError(caught instanceof ApiError ? caught.message : "No se pudieron cargar los clientes"))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => {
    if (!selected) return;
    const previous = document.body.style.overflow;
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") setSelected(null); };
    document.body.style.overflow = "hidden"; document.addEventListener("keydown", close);
    return () => { document.body.style.overflow = previous; document.removeEventListener("keydown", close); };
  }, [selected]);

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void load(1);
  }

  async function open(customerId: string) {
    setError("");
    try {
      const response = await apiRequest<{ customer: CustomerDetail }>(`/admin/customers/${customerId}`);
      setSelected(response.customer);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "No se pudo abrir el cliente");
    }
  }

  return (
    <div className={`${styles.surface} mx-auto max-w-7xl`}>
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#6E3482]">Clientes</p>
          <h2 className="mt-2 text-2xl font-semibold tracking-tight">Conocé a quienes te compran</h2>
          <p className="mt-2 text-sm text-[#807384]">Encontrá sus datos, pedidos y compras aprobadas sin editar información sensible.</p>
        </div>
        <form className="flex w-full max-w-lg gap-2" onSubmit={submitSearch}>
          <label className="relative min-w-0 flex-1"><span className="sr-only">Buscar clientes</span><Search className="absolute left-3.5 top-3.5 h-4 w-4 text-[#918495]" /><input className="control pl-10!" onChange={(event) => setSearch(event.target.value)} placeholder="Nombre, email o teléfono" value={search} /></label>
          <button className={styles.button} type="submit">
            Buscar
          </button>
        </form>
      </div>

      {error && <p role="alert" className="mb-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
      <div className="mb-5 grid gap-3 sm:grid-cols-3"><CustomerSummaryCard icon={UserRound} label="Clientes registrados" value={String(pagination.total)} help="Coinciden con la búsqueda actual." /><CustomerSummaryCard icon={ShoppingBag} label="Pedidos en esta página" value={String(customers.reduce((total, customer) => total + customer._count.orders, 0))} help="Cantidad de compras de los clientes visibles." /><CustomerSummaryCard icon={CircleDollarSign} label="Compras aprobadas" value={money(customers.reduce((total, customer) => total + customer.approvedSpentInCents, 0))} help="Total aprobado de los clientes visibles." /></div>
      <Tip title="Cómo se crea un cliente">InfinityFood registra al comprador cuando completa un checkout. Si luego crea una cuenta con el mismo email, podrá consultar sus pedidos desde Mi cuenta.</Tip>
      {loading ? (
        <div role="status" className="mt-5 h-56 animate-pulse rounded-2xl bg-[#eee9ef]" />
      ) : customers.length === 0 ? (
        <div className="mt-5"><EmptyState title="No encontramos clientes">Si buscaste algo, probá con otro nombre, email o teléfono. Los nuevos compradores aparecen después del checkout.</EmptyState></div>
      ) : (
        <div className="mt-5 overflow-hidden rounded-2xl border border-[#e6dfe8] bg-white">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[48rem] text-left text-sm">
              <thead className="border-b bg-stone-50 text-xs uppercase tracking-wider text-stone-400">
                <tr>
                  <th className="px-5 py-3">Cliente</th>
                  <th className="px-5 py-3">Contacto</th>
                  <th className="px-5 py-3">Actividad</th>
                  <th className="px-5 py-3 text-right">Compras aprobadas</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {customers.map((customer) => (
                  <tr className="hover:bg-[#fdfafe]" key={customer.id}>
                    <td className="px-5 py-4">
                      <strong>
                        {customer.firstName} {customer.lastName}
                      </strong>
                      <p className="mt-1 text-xs font-semibold text-[#6E3482]">{segmentLabel[customer.segment]}</p>
                      <p className="text-xs text-stone-400">Desde {new Date(customer.createdAt).toLocaleDateString("es-AR")}</p>
                    </td>
                    <td className="px-5 py-4">
                      {customer.email}
                      <p className="text-xs text-stone-400">{customer.phone ?? "Sin teléfono"}</p>
                    </td>
                    <td className="px-5 py-4">{customer._count.orders} pedidos<p className="text-xs text-stone-400">{customer._count.reservations} reservas · {customer.noShows} no-show</p></td>
                    <td className="px-5 py-4 text-right"><strong>{money(customer.approvedSpentInCents)}</strong><button className="ml-4 rounded-lg border border-[#e6dfe8] px-3 py-2 text-xs font-semibold text-[#6E3482]" onClick={() => void open(customer.id)} type="button">Ver cliente</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {pagination.total > 0 && (
        <div className="mt-4 flex items-center justify-between text-sm text-stone-500">
          <span>
            {pagination.total} cliente{pagination.total === 1 ? "" : "s"}
          </span>
          <div className="flex items-center gap-2">
            <button className="rounded-xl border border-stone-200 bg-white px-4 py-2 disabled:opacity-40" disabled={pagination.page <= 1 || loading} onClick={() => void load(pagination.page - 1)} type="button">
              Anterior
            </button>
            <span>
              Página {pagination.page} de {pagination.pages}
            </span>
            <button className="rounded-xl border border-stone-200 bg-white px-4 py-2 disabled:opacity-40" disabled={pagination.page >= pagination.pages || loading} onClick={() => void load(pagination.page + 1)} type="button">
              Siguiente
            </button>
          </div>
        </div>
      )}

      {selected && <CustomerDrawer customer={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}

function CustomerDrawer({ customer, onClose }: { customer: CustomerDetail; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/35">
      <button aria-label="Cerrar detalle" className="absolute inset-0" onClick={onClose} type="button" />
      <aside aria-label={`Detalle de ${customer.firstName} ${customer.lastName}`} aria-modal="true" role="dialog" className="relative h-full w-full max-w-2xl overflow-y-auto bg-[#fbfafc] p-6 shadow-2xl sm:p-8">
        <header className="flex items-start justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#6E3482]">Ficha del cliente</p>
            <h2 className="mt-1 text-3xl font-semibold">
              {customer.firstName} {customer.lastName}
            </h2>
          </div>
          <button aria-label="Cerrar detalle" className="grid h-10 w-10 place-items-center rounded-xl bg-[#f5eff8] text-[#6E3482]" onClick={onClose} type="button">
            <X size={19} />
          </button>
        </header>

        <section className="mt-6 grid gap-3 sm:grid-cols-4">
          <Stat label="Pedidos" value={String(customer.stats.orders)} />
          <Stat label="Pagados" value={String(customer.stats.approvedOrders)} />
          <Stat label="Reservas / no-show" value={`${customer.stats.reservations} / ${customer.stats.noShows}`} />
          <Stat label="Total aprobado" value={money(customer.stats.approvedSpentInCents)} />
        </section>

        <section className="mt-6 rounded-2xl border border-[#e6dfe8] bg-white p-5">
          <h3 className="mb-4 font-semibold">Historial de reservas · {segmentLabel[customer.segment]}</h3>
          {customer.reservations.length === 0 ? <p className="text-sm text-stone-400">Todavía no tiene reservas vinculadas.</p> : <div className="divide-y divide-stone-200">{customer.reservations.map((reservation) => <div className="flex items-center justify-between gap-4 py-4" key={reservation.id}><div><strong className="text-sm">{reservation.branch.name} · {reservation.table.name}</strong><p className="text-xs text-stone-400">{new Date(reservation.startsAt).toLocaleString("es-AR")} · {reservation.partySize} personas</p></div><span className="text-xs font-semibold text-[#6E3482]">{reservation.status}</span></div>)}</div>}
        </section>

        <section className="mt-6 rounded-2xl border border-[#e6dfe8] bg-white p-5">
          <h3 className="mb-4 font-semibold">Datos de contacto</h3>
          <dl className="grid gap-4 text-sm sm:grid-cols-2">
            <Detail label="Email" value={customer.email} />
            <Detail label="Teléfono" value={customer.phone ?? "—"} />
            <Detail label="Primer registro" value={new Date(customer.createdAt).toLocaleString("es-AR")} />
            <Detail label="Última actualización" value={new Date(customer.updatedAt).toLocaleString("es-AR")} />
          </dl>
        </section>

        <section className="mt-6 rounded-2xl border border-[#e6dfe8] bg-white p-5">
          <h3 className="mb-4 font-semibold">Historial de pedidos</h3>
          {customer.orders.length === 0 ? (
            <p className="text-sm text-stone-400">Todavía no tiene pedidos.</p>
          ) : (
            <div className="divide-y divide-stone-200">
              {customer.orders.map((order) => (
                <div className="flex items-center justify-between gap-4 py-4" key={order.id}>
                  <div>
                    <strong className="text-sm">Pedido #{order.number}</strong>
                    <p className="text-xs text-stone-400">
                      {new Date(order.createdAt).toLocaleDateString("es-AR")} · {order._count.items} productos · {orderStatus[order.status] ?? order.status}
                    </p>
                  </div>
                  <div className="text-right">
                    <strong className="text-sm">{money(order.totalInCents, order.currency)}</strong>
                    <p className={`text-xs ${order.paymentStatus === "APPROVED" ? "text-emerald-700" : "text-stone-400"}`}>{order.paymentStatus === "APPROVED" ? "Pago aprobado" : order.paymentStatus === "PENDING" && order.paymentReceipt ? "Pago en revisión" : "Pago pendiente"}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </aside>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-[#e6dfe8] bg-white p-4">
      <p className="text-xs text-[#807384]">{label}</p>
      <p className="mt-2 text-lg font-semibold">{value}</p>
    </div>
  );
}

function CustomerSummaryCard({ icon: Icon, label, value, help }: { icon: typeof UserRound; label: string; value: string; help: string }) {
  return <article className={styles.card}><div className="flex items-start justify-between gap-3"><div><p className="text-xs text-[#807384]">{label}</p><p className="mt-2 text-2xl font-semibold">{value}</p><p className="mt-2 text-xs leading-5 text-[#918495]">{help}</p></div><span className="rounded-lg bg-[#f5eff8] p-2 text-[#6E3482]"><Icon size={17} /></span></div></article>;
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-stone-400">{label}</dt>
      <dd className="mt-1 font-medium text-stone-700">{value}</dd>
    </div>
  );
}

const segmentLabel: Record<CustomerSummary["segment"], string> = {
  NEW: "Nuevo",
  REGULAR: "Frecuente",
  VIP: "VIP",
  AT_RISK: "Riesgo por no-show",
};
