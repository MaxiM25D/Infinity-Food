"use client";

import {
  Banknote,
  CircleDollarSign,
  Plus,
  ReceiptText,
  RefreshCw,
  RotateCcw,
  ShoppingBasket,
  WalletCards,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { apiAbsoluteUrl, apiRequest } from "@/lib/api";
import type { Role } from "./types";

type BranchRole = "MANAGER" | "WAITER" | "KITCHEN" | "CASHIER" | "STAFF" | null;
type Payment = {
  id: string;
  kind: "PAYMENT" | "REFUND";
  method: string;
  amountInCents: number;
  reference: string | null;
  refundOfId: string | null;
  providerFeeInCents?: number | null;
  providerNetInCents?: number | null;
  reconciliationStatus?: string;
  createdAt: string;
};
type Order = {
  id: string;
  number: number;
  customerName: string;
  diningSource: string;
  diningStatus: string;
  paymentStatus: string;
  totalInCents: number;
  paidInCents: number;
  refundedInCents: number;
  balanceInCents: number;
  createdAt: string;
  restaurantTable: { id: string; code: string; name: string } | null;
  items: Array<{
    id: string;
    productName: string;
    quantity: number;
    subtotalInCents: number;
  }>;
  operationalPayments: Payment[];
  paymentAttempts: Array<{
    id: string;
    amountInCents: number;
    checkoutUrl: string | null;
    sandboxCheckoutUrl: string | null;
  }>;
};
type CashMovement = {
  id: string;
  type: string;
  amountInCents: number;
  note: string | null;
  createdAt: string;
  orderPayment: { orderId: string; method: string; kind: string } | null;
};
type CashSession = {
  id: string;
  openingCashInCents: number;
  openedAt: string;
  cashRegister: { name: string };
  openedBy: { firstName: string; lastName: string };
  movements: CashMovement[];
  payments: Payment[];
};
type ClosedSession = {
  id: string;
  openedAt: string;
  closedAt: string;
  expectedClosingCashInCents: number;
  declaredClosingCashInCents: number;
  differenceInCents: number;
  salesTotalInCents: number;
  cashSalesInCents: number;
  cardSalesInCents: number;
  mercadoPagoSalesInCents: number;
  cashRegister: { name: string };
};
type Table = { id: string; code: string; name: string };
type MenuItem = {
  productId: string;
  priceOverrideInCents: number | null;
  product: {
    id: string;
    name: string;
    priceInCents: number;
    category: { name: string } | null;
  };
};
type FiscalProfile = {
  enabled: boolean;
  provider: "DISABLED" | "EXTERNAL";
  taxId: string;
  legalName: string;
  taxCondition: string;
  pointOfSale: number;
};
type FiscalDocument = {
  id: string;
  orderId: string;
  type: "INVOICE" | "CREDIT_NOTE";
  status: string;
  documentNumber: number | null;
  totalInCents: number;
  authorizationCode: string | null;
  order: { number: number };
};
type Overview = {
  session: CashSession | null;
  orders: Order[];
  tables: Table[];
  menu: MenuItem[];
  recentSessions: ClosedSession[];
  mercadoPago: { mercadoPagoUserId: string; liveMode: boolean } | null;
  fiscalProfile: FiscalProfile | null;
  fiscalDocuments: FiscalDocument[];
};

const money = new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: "ARS",
});
const paymentLabels: Record<string, string> = {
  CASH: "Efectivo",
  CARD_EXTERNAL: "Tarjeta externa",
  MERCADO_PAGO: "Mercado Pago automático",
  MERCADO_PAGO_EXTERNAL: "Mercado Pago externo",
};
const movementLabels: Record<string, string> = {
  OPENING: "Fondo inicial",
  CASH_SALE: "Cobro en efectivo",
  CASH_REFUND: "Devolución en efectivo",
  INCOME: "Ingreso",
  EXPENSE: "Egreso",
  ADJUSTMENT: "Ajuste",
};

function cents(value: string): number {
  return Math.round((Number(value.replace(",", ".")) || 0) * 100);
}
function errorText(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "No pudimos completar la operación";
}

export function PosView({
  role,
  branchRole,
}: {
  role: Role;
  branchRole: BranchRole;
}) {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [selectedOrderId, setSelectedOrderId] = useState("");
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [serviceMode, setServiceMode] = useState<"COUNTER" | "TABLE">(
    "COUNTER",
  );
  const [tableId, setTableId] = useState("");
  const [customerName, setCustomerName] = useState("Mostrador");
  const [openingCash, setOpeningCash] = useState("0");
  const [declaredCash, setDeclaredCash] = useState("");
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("CASH");
  const [paymentReference, setPaymentReference] = useState("");
  const [checkoutUrl, setCheckoutUrl] = useState("");
  const [fiscalProfile, setFiscalProfile] = useState<FiscalProfile>({
    enabled: false,
    provider: "DISABLED",
    taxId: "",
    legalName: "",
    taxCondition: "Responsable Inscripto",
    pointOfSale: 1,
  });
  const [movementType, setMovementType] = useState<"INCOME" | "EXPENSE">(
    "INCOME",
  );
  const [movementAmount, setMovementAmount] = useState("");
  const [movementNote, setMovementNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const canOperateCash =
    role !== "STAFF" || branchRole === "MANAGER" || branchRole === "CASHIER";
  const load = useCallback(async () => {
    const data = await apiRequest<Overview>("/admin/pos/overview");
    setOverview(data);
    if (data.fiscalProfile) setFiscalProfile(data.fiscalProfile);
    setTableId((current) => current || data.tables[0]?.id || "");
    setSelectedOrderId((current) =>
      data.orders.some(({ id }) => id === current)
        ? current
        : (data.orders.find(({ balanceInCents }) => balanceInCents > 0)?.id ??
          data.orders[0]?.id ??
          ""),
    );
  }, []);

  useEffect(() => {
    let active = true;
    void apiRequest<Overview>("/admin/pos/overview")
      .then((data) => {
        if (!active) return;
        setOverview(data);
        setTableId(data.tables[0]?.id ?? "");
        if (data.fiscalProfile) setFiscalProfile(data.fiscalProfile);
        setSelectedOrderId(
          data.orders.find(({ balanceInCents }) => balanceInCents > 0)?.id ??
            data.orders[0]?.id ??
            "",
        );
      })
      .catch((caught) => {
        if (active) setError(errorText(caught));
      });
    return () => {
      active = false;
    };
  }, []);

  const selectedOrder =
    overview?.orders.find(({ id }) => id === selectedOrderId) ?? null;
  const selectedItems = useMemo(
    () => Object.entries(quantities).filter(([, quantity]) => quantity > 0),
    [quantities],
  );
  const expectedCash = useMemo(
    () =>
      overview?.session?.movements.reduce(
        (sum, movement) => sum + movement.amountInCents,
        0,
      ) ?? 0,
    [overview],
  );

  async function action(work: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await work();
      await load();
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setBusy(false);
    }
  }
  function openCash() {
    void action(async () => {
      await apiRequest("/admin/pos/cash-sessions/open", {
        method: "POST",
        body: JSON.stringify({
          openingCashInCents: cents(openingCash),
          note: "Apertura de caja",
        }),
      });
    });
  }
  function closeCash() {
    if (!overview?.session) return;
    void action(async () => {
      await apiRequest(
        `/admin/pos/cash-sessions/${overview.session!.id}/close`,
        {
          method: "POST",
          body: JSON.stringify({
            declaredCashInCents: cents(declaredCash),
            note: "Cierre de caja",
          }),
        },
      );
      setDeclaredCash("");
    });
  }
  function addMovement() {
    if (!overview?.session) return;
    void action(async () => {
      await apiRequest(
        `/admin/pos/cash-sessions/${overview.session!.id}/movements`,
        {
          method: "POST",
          body: JSON.stringify({
            type: movementType,
            amountInCents: cents(movementAmount),
            note: movementNote,
          }),
        },
      );
      setMovementAmount("");
      setMovementNote("");
    });
  }
  function createOrder() {
    if (!selectedItems.length) return;
    void action(async () => {
      const result = await apiRequest<{ order: Order }>("/admin/pos/orders", {
        method: "POST",
        body: JSON.stringify({
          clientRequestId: crypto.randomUUID(),
          serviceMode,
          tableId: serviceMode === "TABLE" ? tableId : undefined,
          customerName:
            customerName || (serviceMode === "TABLE" ? "Mesa" : "Mostrador"),
          items: selectedItems.map(([productId, quantity]) => ({
            productId,
            quantity,
          })),
        }),
      });
      setQuantities({});
      setSelectedOrderId(result.order.id);
    });
  }
  function pay() {
    if (!selectedOrder) return;
    void action(async () => {
      if (paymentMethod === "MERCADO_PAGO") {
        const result = await apiRequest<{
          checkoutUrl: string | null;
          sandboxCheckoutUrl?: string | null;
        }>(`/admin/pos/orders/${selectedOrder.id}/mercadopago-checkout`, {
          method: "POST",
          body: JSON.stringify({
            clientRequestId: crypto.randomUUID(),
            amountInCents: cents(paymentAmount),
          }),
        });
        setCheckoutUrl(result.sandboxCheckoutUrl ?? result.checkoutUrl ?? "");
      } else
        await apiRequest(`/admin/pos/orders/${selectedOrder.id}/payments`, {
          method: "POST",
          body: JSON.stringify({
            clientRequestId: crypto.randomUUID(),
            method: paymentMethod,
            amountInCents: cents(paymentAmount),
            reference: paymentReference || undefined,
          }),
        });
      setPaymentAmount("");
      setPaymentReference("");
    });
  }
  function saveFiscalProfile() {
    void action(async () => {
      await apiRequest("/admin/pos/fiscal/profile", {
        method: "PUT",
        body: JSON.stringify(fiscalProfile),
      });
    });
  }
  function issueInvoice() {
    if (!selectedOrder) return;
    void action(async () => {
      await apiRequest(
        `/admin/pos/orders/${selectedOrder.id}/fiscal-documents`,
        {
          method: "POST",
          body: JSON.stringify({
            clientRequestId: crypto.randomUUID(),
            type: "INVOICE",
            recipientName: selectedOrder.customerName,
          }),
        },
      );
    });
  }
  function issueCreditNote(document: FiscalDocument) {
    const rawAmount = window.prompt(
      "Importe de la nota de crédito en pesos",
      (document.totalInCents / 100).toFixed(2),
    );
    if (!rawAmount) return;
    void action(async () => {
      await apiRequest(
        `/admin/pos/orders/${document.orderId}/fiscal-documents`,
        {
          method: "POST",
          body: JSON.stringify({
            clientRequestId: crypto.randomUUID(),
            type: "CREDIT_NOTE",
            relatedDocumentId: document.id,
            amountInCents: cents(rawAmount),
          }),
        },
      );
    });
  }
  function reconcile(payment: Payment) {
    void action(async () => {
      await apiRequest(`/admin/pos/payments/${payment.id}/reconcile`, {
        method: "POST",
      });
    });
  }
  function cancelAttempt(id: string) {
    void action(async () => {
      await apiRequest(`/admin/pos/mercadopago-attempts/${id}/cancel`, {
        method: "POST",
      });
      setCheckoutUrl("");
    });
  }
  function refund(payment: Payment) {
    const rawAmount = window.prompt(
      "Importe a devolver en pesos",
      (payment.amountInCents / 100).toFixed(2),
    );
    if (!rawAmount) return;
    const note = window.prompt(
      "Motivo de la devolución",
      "Devolución al cliente",
    );
    if (!note) return;
    void action(async () => {
      await apiRequest(`/admin/pos/payments/${payment.id}/refunds`, {
        method: "POST",
        body: JSON.stringify({
          clientRequestId: crypto.randomUUID(),
          amountInCents: cents(rawAmount),
          note,
        }),
      });
    });
  }

  return (
    <div className="space-y-7">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-[.18em] text-[#8f7c94]">
            Etapas 4 y 11
          </p>
          <h2 className="mt-2 text-2xl font-semibold">
            POS, pagos y fiscalidad
          </h2>
          <p className="mt-2 text-sm text-stone-500">
            Caja, cobros automáticos, conciliación y comprobantes fiscales por
            sucursal.
          </p>
        </div>
        <button
          className="rounded-xl border bg-white p-3"
          onClick={() => void load()}
          title="Actualizar"
          type="button"
        >
          <RefreshCw size={17} />
        </button>
      </div>
      {error && (
        <p className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </p>
      )}
      <section className="rounded-3xl border border-[#e6dfe8] bg-white p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h3 className="flex items-center gap-2 font-semibold">
              <WalletCards size={18} /> Caja
            </h3>
            {overview?.session ? (
              <p className="mt-1 text-xs text-emerald-700">
                Abierta desde{" "}
                {new Date(overview.session.openedAt).toLocaleString("es-AR")} ·{" "}
                {overview.session.openedBy.firstName}{" "}
                {overview.session.openedBy.lastName}
              </p>
            ) : (
              <p className="mt-1 text-xs text-amber-700">
                No hay una caja abierta.
              </p>
            )}
          </div>
          {overview?.session && (
            <div className="text-right">
              <p className="text-xs text-stone-400">Efectivo esperado</p>
              <strong className="text-xl">
                {money.format(expectedCash / 100)}
              </strong>
            </div>
          )}
        </div>
        {!overview?.session ? (
          <div className="mt-5 flex flex-wrap gap-3">
            <label className="text-xs font-semibold">
              Fondo inicial
              <input
                className="mt-2 block rounded-xl border px-3 py-2.5 text-sm"
                min="0"
                onChange={(event) => setOpeningCash(event.target.value)}
                step="0.01"
                type="number"
                value={openingCash}
              />
            </label>
            <button
              className="self-end rounded-xl bg-[#6E3482] px-5 py-3 text-sm font-semibold text-white disabled:opacity-40"
              disabled={busy || !canOperateCash}
              onClick={openCash}
              type="button"
            >
              Abrir caja
            </button>
          </div>
        ) : (
          <div className="mt-5 grid gap-5 lg:grid-cols-2">
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-stone-400">
                Movimiento manual
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                <select
                  className="rounded-xl border px-3 py-2.5 text-sm"
                  onChange={(event) =>
                    setMovementType(event.target.value as "INCOME" | "EXPENSE")
                  }
                  value={movementType}
                >
                  <option value="INCOME">Ingreso</option>
                  <option value="EXPENSE">Egreso</option>
                </select>
                <input
                  className="w-32 rounded-xl border px-3 py-2.5 text-sm"
                  min="0.01"
                  onChange={(event) => setMovementAmount(event.target.value)}
                  placeholder="$"
                  step="0.01"
                  type="number"
                  value={movementAmount}
                />
                <input
                  className="min-w-48 flex-1 rounded-xl border px-3 py-2.5 text-sm"
                  onChange={(event) => setMovementNote(event.target.value)}
                  placeholder="Motivo"
                  value={movementNote}
                />
                <button
                  className="rounded-xl border px-4 text-sm font-semibold disabled:opacity-40"
                  disabled={
                    busy ||
                    !canOperateCash ||
                    cents(movementAmount) < 1 ||
                    movementNote.length < 3
                  }
                  onClick={addMovement}
                  type="button"
                >
                  <Plus size={16} />
                </button>
              </div>
            </div>
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-stone-400">
                Cerrar turno
              </p>
              <div className="mt-2 flex gap-2">
                <input
                  className="min-w-0 flex-1 rounded-xl border px-3 py-2.5 text-sm"
                  min="0"
                  onChange={(event) => setDeclaredCash(event.target.value)}
                  placeholder="Efectivo contado"
                  step="0.01"
                  type="number"
                  value={declaredCash}
                />
                <button
                  className="rounded-xl bg-[#211b23] px-5 text-sm font-semibold text-white disabled:opacity-40"
                  disabled={busy || !canOperateCash || declaredCash === ""}
                  onClick={closeCash}
                  type="button"
                >
                  Cerrar y reconciliar
                </button>
              </div>
            </div>
          </div>
        )}
      </section>
      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1.15fr)_minmax(22rem,.85fr)]">
        <section className="rounded-3xl border border-[#e6dfe8] bg-white p-6">
          <h3 className="flex items-center gap-2 font-semibold">
            <ShoppingBasket size={18} /> Nuevo pedido
          </h3>
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <select
              className="rounded-xl border px-3 py-3 text-sm"
              onChange={(event) =>
                setServiceMode(event.target.value as "COUNTER" | "TABLE")
              }
              value={serviceMode}
            >
              <option value="COUNTER">Mostrador</option>
              <option value="TABLE">Mesa</option>
            </select>
            <select
              className="rounded-xl border px-3 py-3 text-sm disabled:bg-stone-100"
              disabled={serviceMode === "COUNTER"}
              onChange={(event) => setTableId(event.target.value)}
              value={tableId}
            >
              {overview?.tables.map((table) => (
                <option key={table.id} value={table.id}>
                  {table.name}
                </option>
              ))}
            </select>
            <input
              className="rounded-xl border px-3 py-3 text-sm"
              onChange={(event) => setCustomerName(event.target.value)}
              placeholder="Cliente o referencia"
              value={customerName}
            />
          </div>
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            {overview?.menu.map((item) => {
              const price =
                item.priceOverrideInCents ?? item.product.priceInCents;
              return (
                <div
                  className="flex items-center justify-between rounded-xl bg-stone-50 px-4 py-3"
                  key={item.productId}
                >
                  <div>
                    <p className="text-sm font-medium">{item.product.name}</p>
                    <p className="text-xs text-stone-400">
                      {item.product.category?.name} ·{" "}
                      {money.format(price / 100)}
                    </p>
                  </div>
                  <input
                    className="w-20 rounded-lg border px-2 py-1.5 text-center"
                    min={0}
                    onChange={(event) =>
                      setQuantities({
                        ...quantities,
                        [item.productId]: Number(event.target.value),
                      })
                    }
                    type="number"
                    value={quantities[item.productId] ?? 0}
                  />
                </div>
              );
            })}
          </div>
          <button
            className="mt-4 inline-flex items-center gap-2 rounded-xl bg-[#6E3482] px-5 py-3 text-sm font-semibold text-white disabled:opacity-40"
            disabled={
              busy ||
              !selectedItems.length ||
              (serviceMode === "TABLE" && !tableId)
            }
            onClick={createOrder}
            type="button"
          >
            <ReceiptText size={16} /> Abrir pedido (
            {selectedItems.reduce((sum, [, quantity]) => sum + quantity, 0)})
          </button>
        </section>
        <section className="rounded-3xl border border-[#e6dfe8] bg-white p-6">
          <h3 className="flex items-center gap-2 font-semibold">
            <CircleDollarSign size={18} /> Cobrar pedido
          </h3>
          <select
            className="mt-4 w-full rounded-xl border px-3 py-3 text-sm"
            onChange={(event) => {
              setSelectedOrderId(event.target.value);
              setPaymentAmount("");
            }}
            value={selectedOrderId}
          >
            <option value="">Seleccionar pedido</option>
            {overview?.orders.map((order) => (
              <option key={order.id} value={order.id}>
                #{order.number} · {order.restaurantTable?.name ?? "Mostrador"} ·
                saldo {money.format(order.balanceInCents / 100)}
              </option>
            ))}
          </select>
          {selectedOrder && (
            <div className="mt-4">
              <div className="rounded-2xl bg-stone-50 p-4">
                <div className="flex justify-between gap-3">
                  <div>
                    <strong>
                      #{selectedOrder.number} ·{" "}
                      {selectedOrder.restaurantTable?.name ?? "Mostrador"}
                    </strong>
                    <p className="mt-1 text-xs text-stone-500">
                      {selectedOrder.items
                        .map((item) => `${item.quantity}× ${item.productName}`)
                        .join(" · ")}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-stone-400">Total</p>
                    <strong>
                      {money.format(selectedOrder.totalInCents / 100)}
                    </strong>
                  </div>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                  <p>
                    Pagado:{" "}
                    <strong className="text-emerald-700">
                      {money.format(selectedOrder.paidInCents / 100)}
                    </strong>
                  </p>
                  <p className="text-right">
                    Saldo:{" "}
                    <strong className="text-amber-700">
                      {money.format(selectedOrder.balanceInCents / 100)}
                    </strong>
                  </p>
                </div>
              </div>
              <div className="mt-3 grid gap-2">
                <select
                  className="rounded-xl border px-3 py-2.5 text-sm"
                  onChange={(event) => setPaymentMethod(event.target.value)}
                  value={paymentMethod}
                >
                  <option value="CASH">Efectivo</option>
                  <option value="CARD_EXTERNAL">Tarjeta externa</option>
                  <option
                    disabled={!overview?.mercadoPago}
                    value="MERCADO_PAGO"
                  >
                    Mercado Pago automático
                  </option>
                  <option value="MERCADO_PAGO_EXTERNAL">
                    Mercado Pago externo/manual
                  </option>
                </select>
                <input
                  className="rounded-xl border px-3 py-2.5 text-sm"
                  max={selectedOrder.balanceInCents / 100}
                  min="0.01"
                  onChange={(event) => setPaymentAmount(event.target.value)}
                  placeholder={`Máximo ${money.format(selectedOrder.balanceInCents / 100)}`}
                  step="0.01"
                  type="number"
                  value={paymentAmount}
                />
                <input
                  className="rounded-xl border px-3 py-2.5 text-sm"
                  onChange={(event) => setPaymentReference(event.target.value)}
                  placeholder="Referencia opcional"
                  value={paymentReference}
                />
                <button
                  className="rounded-xl bg-[#211b23] px-5 py-3 text-sm font-semibold text-white disabled:opacity-40"
                  disabled={
                    busy ||
                    !overview?.session ||
                    !canOperateCash ||
                    cents(paymentAmount) < 1 ||
                    cents(paymentAmount) > selectedOrder.balanceInCents
                  }
                  onClick={pay}
                  type="button"
                >
                  <Banknote className="mr-2 inline" size={16} />
                  Registrar cobro parcial
                </button>
              </div>
              <div className="mt-5 space-y-2">
                {selectedOrder.operationalPayments.map((payment) => (
                  <div
                    className="flex items-center justify-between gap-3 rounded-xl border px-3 py-2.5 text-xs"
                    key={payment.id}
                  >
                    <div>
                      <strong>
                        {payment.kind === "REFUND"
                          ? "Devolución"
                          : (paymentLabels[payment.method] ?? payment.method)}
                      </strong>
                      <p className="text-stone-400">
                        {new Date(payment.createdAt).toLocaleString("es-AR")}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <strong
                        className={
                          payment.kind === "REFUND"
                            ? "text-red-600"
                            : "text-emerald-700"
                        }
                      >
                        {payment.kind === "REFUND" ? "−" : "+"}
                        {money.format(payment.amountInCents / 100)}
                      </strong>
                      {payment.kind === "PAYMENT" && canOperateCash && (
                        <button
                          className="rounded-lg border border-red-200 p-2 text-red-600"
                          onClick={() => refund(payment)}
                          title="Registrar devolución"
                          type="button"
                        >
                          <RotateCcw size={14} />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-3xl border border-[#e6dfe8] bg-white p-6">
          <h3 className="font-semibold">Movimientos de la caja abierta</h3>
          <div className="mt-4 space-y-2">
            {overview?.session?.movements.length ? (
              overview.session.movements.map((movement) => (
                <div
                  className="flex justify-between gap-3 rounded-xl bg-stone-50 px-4 py-3 text-sm"
                  key={movement.id}
                >
                  <div>
                    <strong>
                      {movementLabels[movement.type] ?? movement.type}
                    </strong>
                    <p className="text-xs text-stone-400">{movement.note}</p>
                  </div>
                  <strong
                    className={
                      movement.amountInCents < 0
                        ? "text-red-600"
                        : "text-emerald-700"
                    }
                  >
                    {movement.amountInCents > 0 ? "+" : ""}
                    {money.format(movement.amountInCents / 100)}
                  </strong>
                </div>
              ))
            ) : (
              <p className="text-sm text-stone-400">
                Sin movimientos en el turno actual.
              </p>
            )}
          </div>
        </section>
        <section className="rounded-3xl border border-[#e6dfe8] bg-white p-6">
          <h3 className="font-semibold">Últimos cierres</h3>
          <div className="mt-4 space-y-3">
            {overview?.recentSessions.map((session) => (
              <article
                className="rounded-xl border p-4 text-sm"
                key={session.id}
              >
                <div className="flex justify-between">
                  <strong>
                    {new Date(session.closedAt).toLocaleString("es-AR")}
                  </strong>
                  <span
                    className={
                      session.differenceInCents === 0
                        ? "text-emerald-700"
                        : "text-amber-700"
                    }
                  >
                    Diferencia {money.format(session.differenceInCents / 100)}
                  </span>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-stone-500">
                  <p>Ventas: {money.format(session.salesTotalInCents / 100)}</p>
                  <p>
                    Efectivo esperado:{" "}
                    {money.format(session.expectedClosingCashInCents / 100)}
                  </p>
                  <p>Tarjeta: {money.format(session.cardSalesInCents / 100)}</p>
                  <p>
                    Mercado Pago:{" "}
                    {money.format(session.mercadoPagoSalesInCents / 100)}
                  </p>
                </div>
              </article>
            ))}
          </div>
        </section>
      </div>
      {(checkoutUrl || selectedOrder?.paymentAttempts.length) && (
        <section className="rounded-3xl border border-sky-200 bg-sky-50 p-5">
          <h3 className="font-semibold text-sky-900">
            Cobro de Mercado Pago pendiente
          </h3>
          <p className="mt-1 text-sm text-sky-700">
            El importe ya está reservado y se acredita únicamente después del
            webhook firmado.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {checkoutUrl && (
              <a
                className="rounded-xl bg-[#009ee3] px-4 py-2.5 text-sm font-bold text-white"
                href={checkoutUrl}
                rel="noreferrer"
                target="_blank"
              >
                Abrir checkout
              </a>
            )}
            {selectedOrder?.paymentAttempts.map((attempt) => (
              <button
                className="rounded-xl border border-sky-300 px-4 py-2.5 text-sm font-semibold text-sky-900"
                key={attempt.id}
                onClick={() => cancelAttempt(attempt.id)}
                type="button"
              >
                Cancelar intento {money.format(attempt.amountInCents / 100)}
              </button>
            ))}
          </div>
        </section>
      )}
      <section className="grid gap-6 xl:grid-cols-2">
        <div className="rounded-3xl border bg-white p-6">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-semibold">Conciliación Mercado Pago</h3>
              <p className="mt-1 text-xs text-stone-400">
                Bruto, comisión y neto informados por el proveedor.
              </p>
            </div>
            <span
              className={`rounded-full px-3 py-1 text-xs font-semibold ${overview?.mercadoPago ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}
            >
              {overview?.mercadoPago ? "Cuenta conectada" : "Sin conexión"}
            </span>
          </div>
          <div className="mt-4 space-y-2">
            {overview?.orders.flatMap((order) =>
              order.operationalPayments
                .filter((payment) => payment.method === "MERCADO_PAGO")
                .map((payment) => (
                  <div
                    className="flex items-center justify-between rounded-xl bg-stone-50 p-3 text-xs"
                    key={payment.id}
                  >
                    <span>
                      <strong>Pedido #{order.number}</strong>
                      <br />
                      Bruto {money.format(payment.amountInCents / 100)} ·
                      Comisión{" "}
                      {money.format((payment.providerFeeInCents ?? 0) / 100)} ·
                      Neto{" "}
                      {money.format((payment.providerNetInCents ?? 0) / 100)}
                    </span>
                    <button
                      className="rounded-lg border px-3 py-2 font-semibold"
                      disabled={busy}
                      onClick={() => reconcile(payment)}
                      type="button"
                    >
                      {payment.reconciliationStatus ?? "PENDING"}
                    </button>
                  </div>
                )),
            )}
            {!overview?.orders.some((order) =>
              order.operationalPayments.some(
                (payment) => payment.method === "MERCADO_PAGO",
              ),
            ) && (
              <p className="py-5 text-center text-sm text-stone-400">
                Todavía no hay cobros automáticos.
              </p>
            )}
          </div>
        </div>
        <div className="rounded-3xl border bg-white p-6">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-semibold">Facturación fiscal</h3>
              <p className="mt-1 text-xs text-stone-400">
                Proveedor homologado, facturas y notas de crédito.
              </p>
            </div>
            <a
              className="text-xs font-semibold text-[#6E3482]"
              href={apiAbsoluteUrl("/admin/pos/fiscal/export.csv")}
            >
              Exportar CSV
            </a>
          </div>
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            <input
              className="control"
              onChange={(event) =>
                setFiscalProfile({
                  ...fiscalProfile,
                  taxId: event.target.value,
                })
              }
              placeholder="CUIT"
              value={fiscalProfile.taxId}
            />
            <input
              className="control"
              onChange={(event) =>
                setFiscalProfile({
                  ...fiscalProfile,
                  legalName: event.target.value,
                })
              }
              placeholder="Razón social"
              value={fiscalProfile.legalName}
            />
            <input
              className="control"
              onChange={(event) =>
                setFiscalProfile({
                  ...fiscalProfile,
                  taxCondition: event.target.value,
                })
              }
              placeholder="Condición IVA"
              value={fiscalProfile.taxCondition}
            />
            <input
              className="control"
              min="1"
              onChange={(event) =>
                setFiscalProfile({
                  ...fiscalProfile,
                  pointOfSale: Number(event.target.value),
                })
              }
              type="number"
              value={fiscalProfile.pointOfSale}
            />
            <label className="flex items-center gap-2 text-sm">
              <input
                checked={fiscalProfile.enabled}
                onChange={(event) =>
                  setFiscalProfile({
                    ...fiscalProfile,
                    enabled: event.target.checked,
                    provider: event.target.checked ? "EXTERNAL" : "DISABLED",
                  })
                }
                type="checkbox"
              />
              Habilitar emisión
            </label>
            <button
              className="rounded-xl border px-3 py-2 text-sm font-semibold"
              disabled={busy || (role === "STAFF" && branchRole !== "MANAGER")}
              onClick={saveFiscalProfile}
              type="button"
            >
              Guardar perfil
            </button>
          </div>
          <button
            className="mt-3 w-full rounded-xl bg-[#211b23] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-40"
            disabled={busy || !selectedOrder || !fiscalProfile.enabled}
            onClick={issueInvoice}
            type="button"
          >
            Emitir factura del pedido seleccionado
          </button>
          <div className="mt-4 space-y-2">
            {overview?.fiscalDocuments.slice(0, 5).map((document) => (
              <div
                className="flex justify-between rounded-xl bg-stone-50 p-3 text-xs"
                key={document.id}
              >
                <span>
                  {document.type === "INVOICE" ? "Factura" : "Nota de crédito"}{" "}
                  · Pedido #{document.order.number}
                </span>
                <div className="flex items-center gap-2">
                  <strong>
                    {document.status} ·{" "}
                    {money.format(document.totalInCents / 100)}
                  </strong>
                  {document.type === "INVOICE" &&
                  document.status === "ISSUED" ? (
                    <button
                      className="rounded-lg border bg-white px-2 py-1 font-semibold disabled:opacity-40"
                      disabled={busy}
                      onClick={() => issueCreditNote(document)}
                      type="button"
                    >
                      Nota de crédito
                    </button>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
