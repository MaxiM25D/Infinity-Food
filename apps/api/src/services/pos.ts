import type { PaymentMethod, Prisma } from "@infinityshop/database";

import { database } from "../database.js";
import { HttpError } from "../errors.js";

type Transaction = Prisma.TransactionClient;
type OperationalMethod = Extract<PaymentMethod, "CASH" | "CARD_EXTERNAL" | "MERCADO_PAGO">;

function isTransactionConflict(error: unknown): boolean {
  const candidate = error as { code?: string; message?: string; meta?: { code?: string; message?: string } };
  const details = `${candidate.message ?? ""} ${candidate.meta?.message ?? ""}`.toLowerCase();

  return candidate.code === "P2034"
    || candidate.meta?.code === "40001"
    || details.includes("40001")
    || details.includes("transactionwriteconflict")
    || details.includes("write conflict")
    || details.includes("could not serialize")
    || details.includes("concurrent update");
}

async function serializableTransaction<T>(operation: (transaction: Transaction) => Promise<T>): Promise<T> {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await database.$transaction(operation, { isolationLevel: "Serializable" });
    } catch (error) {
      if (attempt === 3 || !isTransactionConflict(error)) throw error;
      await new Promise((resolve) => setTimeout(resolve, attempt * 10));
    }
  }
  throw new Error("No se pudo completar la transacción");
}

function openKey(tenantId: string, branchId: string): string {
  return `${tenantId}:${branchId}`;
}

function paidTotals(payments: Array<{ kind: "PAYMENT" | "REFUND"; amountInCents: number }>) {
  const grossPaidInCents = payments.filter(({ kind }) => kind === "PAYMENT").reduce((sum, payment) => sum + payment.amountInCents, 0);
  const refundedInCents = payments.filter(({ kind }) => kind === "REFUND").reduce((sum, payment) => sum + payment.amountInCents, 0);
  return { grossPaidInCents, refundedInCents, paidInCents: grossPaidInCents - refundedInCents };
}

function paymentStatus(totalInCents: number, grossPaidInCents: number, paidInCents: number) {
  if (paidInCents === 0) return grossPaidInCents > 0 ? "REFUNDED" as const : "PENDING" as const;
  if (paidInCents < totalInCents) return "PARTIALLY_PAID" as const;
  return "APPROVED" as const;
}

export async function posOrderSnapshot(tenantId: string, branchId: string, orderId: string) {
  const order = await database.order.findFirst({
    where: { id: orderId, tenantId, branchId, diningStatus: { not: null } },
    include: {
      restaurantTable: { select: { id: true, code: true, name: true } },
      items: { orderBy: { createdAt: "asc" } },
      operationalPayments: {
        orderBy: { createdAt: "asc" },
        include: { createdBy: { select: { firstName: true, lastName: true } } },
      },
    },
  });
  if (!order) return null;
  const totals = paidTotals(order.operationalPayments);
  return { ...order, ...totals, balanceInCents: Math.max(0, order.totalInCents - totals.paidInCents) };
}

export async function currentCashSession(tenantId: string, branchId: string) {
  return database.cashRegisterSession.findUnique({
    where: { openKey: openKey(tenantId, branchId) },
    include: {
      cashRegister: true,
      openedBy: { select: { firstName: true, lastName: true } },
      movements: { orderBy: { createdAt: "desc" }, include: { orderPayment: { select: { orderId: true, method: true, kind: true } } } },
      payments: { orderBy: { createdAt: "desc" } },
    },
  });
}

export async function openCashRegister(input: {
  tenantId: string; branchId: string; userId: string; openingCashInCents: number; note?: string | null;
}) {
  try {
    return await serializableTransaction(async (transaction) => {
      await transaction.$queryRaw`SELECT "id" FROM "Branch" WHERE "tenantId" = ${input.tenantId} AND "id" = ${input.branchId} FOR UPDATE`;
      const existing = await transaction.cashRegisterSession.findUnique({ where: { openKey: openKey(input.tenantId, input.branchId) } });
      if (existing) throw new HttpError(409, "Ya hay una caja abierta en esta sucursal");
      const register = await transaction.cashRegister.upsert({
        where: { tenantId_branchId_name: { tenantId: input.tenantId, branchId: input.branchId, name: "Caja principal" } },
        update: { active: true },
        create: { tenantId: input.tenantId, branchId: input.branchId, name: "Caja principal" },
      });
      const session = await transaction.cashRegisterSession.create({
        data: {
          tenantId: input.tenantId, branchId: input.branchId, cashRegisterId: register.id,
          openKey: openKey(input.tenantId, input.branchId), openingCashInCents: input.openingCashInCents,
          openingNote: input.note || null, openedByUserId: input.userId,
        },
      });
      if (input.openingCashInCents > 0) {
        await transaction.cashMovement.create({
          data: {
            tenantId: input.tenantId, branchId: input.branchId, cashSessionId: session.id,
            type: "OPENING", amountInCents: input.openingCashInCents,
            note: input.note || "Fondo inicial", createdByUserId: input.userId,
          },
        });
      }
      return session;
    });
  } catch (error) {
    if ((error as { code?: string }).code === "P2002") throw new HttpError(409, "Ya hay una caja abierta en esta sucursal");
    throw error;
  }
}

export async function addCashMovement(input: {
  tenantId: string; branchId: string; sessionId: string; userId: string;
  type: "INCOME" | "EXPENSE"; amountInCents: number; note: string;
}) {
  return serializableTransaction(async (transaction) => {
    await transaction.$queryRaw`SELECT "id" FROM "CashRegisterSession" WHERE "tenantId" = ${input.tenantId} AND "branchId" = ${input.branchId} AND "id" = ${input.sessionId} FOR UPDATE`;
    const session = await transaction.cashRegisterSession.findFirst({
      where: { id: input.sessionId, tenantId: input.tenantId, branchId: input.branchId, closedAt: null },
    });
    if (!session) throw new HttpError(409, "La caja no está abierta");
    return transaction.cashMovement.create({
      data: {
        tenantId: input.tenantId, branchId: input.branchId, cashSessionId: session.id,
        type: input.type, amountInCents: input.type === "EXPENSE" ? -input.amountInCents : input.amountInCents,
        note: input.note, createdByUserId: input.userId,
      },
    });
  });
}

async function openSessionOrThrow(transaction: Transaction, tenantId: string, branchId: string) {
  const session = await transaction.cashRegisterSession.findUnique({ where: { openKey: openKey(tenantId, branchId) } });
  if (!session || session.closedAt) throw new HttpError(409, "Abrí la caja antes de registrar cobros");
  return session;
}

export async function registerOrderPayment(input: {
  tenantId: string; branchId: string; orderId: string; userId: string; clientRequestId: string;
  method: OperationalMethod; amountInCents: number; reference?: string | null;
}) {
  const duplicate = await database.orderPayment.findUnique({
    where: { tenantId_clientRequestId: { tenantId: input.tenantId, clientRequestId: input.clientRequestId } },
  });
  if (duplicate) {
    if (duplicate.orderId !== input.orderId || duplicate.kind !== "PAYMENT" || duplicate.amountInCents !== input.amountInCents || duplicate.method !== input.method) {
      throw new HttpError(409, "El identificador del cobro ya fue utilizado");
    }
    return { payment: duplicate, order: await posOrderSnapshot(input.tenantId, input.branchId, input.orderId), created: false };
  }

  try {
    const payment = await serializableTransaction(async (transaction) => {
      await transaction.$queryRaw`SELECT "id" FROM "Order" WHERE "tenantId" = ${input.tenantId} AND "branchId" = ${input.branchId} AND "id" = ${input.orderId} FOR UPDATE`;
      const order = await transaction.order.findFirst({
        where: { id: input.orderId, tenantId: input.tenantId, branchId: input.branchId, diningStatus: { notIn: ["CANCELLED"] } },
        include: { operationalPayments: { select: { kind: true, amountInCents: true } } },
      });
      if (!order) throw new HttpError(404, "Pedido no encontrado");
      const totals = paidTotals(order.operationalPayments);
      const balanceInCents = order.totalInCents - totals.paidInCents;
      if (input.amountInCents > balanceInCents) throw new HttpError(409, `El cobro supera el saldo pendiente de ${balanceInCents} centavos`);
      const session = await openSessionOrThrow(transaction, input.tenantId, input.branchId);
      const created = await transaction.orderPayment.create({
        data: {
          tenantId: input.tenantId, branchId: input.branchId, orderId: order.id, cashSessionId: session.id,
          method: input.method, amountInCents: input.amountInCents, clientRequestId: input.clientRequestId,
          reference: input.reference || null, createdByUserId: input.userId,
        },
      });
      if (input.method === "CASH") {
        await transaction.cashMovement.create({
          data: {
            tenantId: input.tenantId, branchId: input.branchId, cashSessionId: session.id,
            orderPaymentId: created.id, type: "CASH_SALE", amountInCents: created.amountInCents,
            note: `Cobro en efectivo del pedido #${order.number}`, createdByUserId: input.userId,
          },
        });
      }
      const nextPaid = totals.paidInCents + created.amountInCents;
      await transaction.order.update({
        where: { id: order.id },
        data: { paymentStatus: paymentStatus(order.totalInCents, totals.grossPaidInCents + created.amountInCents, nextPaid), paymentMethod: input.method },
      });
      await transaction.diningOrderAudit.create({
        data: {
          eventId: input.clientRequestId, tenantId: input.tenantId, branchId: input.branchId, orderId: order.id,
          actorUserId: input.userId, action: "PAYMENT_REGISTERED", entityType: "OrderPayment", entityId: created.id,
          payload: { method: input.method, amountInCents: created.amountInCents, cashSessionId: session.id },
        },
      });
      return created;
    });
    return { payment, order: await posOrderSnapshot(input.tenantId, input.branchId, input.orderId), created: true };
  } catch (error) {
    if ((error as { code?: string }).code !== "P2002") throw error;
    const existing = await database.orderPayment.findUnique({ where: { tenantId_clientRequestId: { tenantId: input.tenantId, clientRequestId: input.clientRequestId } } });
    if (!existing || existing.orderId !== input.orderId) throw new HttpError(409, "El identificador del cobro ya fue utilizado");
    return { payment: existing, order: await posOrderSnapshot(input.tenantId, input.branchId, input.orderId), created: false };
  }
}

export async function refundOrderPayment(input: {
  tenantId: string; branchId: string; paymentId: string; userId: string;
  clientRequestId: string; amountInCents: number; note: string;
}) {
  const duplicate = await database.orderPayment.findUnique({
    where: { tenantId_clientRequestId: { tenantId: input.tenantId, clientRequestId: input.clientRequestId } },
  });
  if (duplicate) {
    if (duplicate.kind !== "REFUND" || duplicate.refundOfId !== input.paymentId || duplicate.amountInCents !== input.amountInCents) {
      throw new HttpError(409, "El identificador de la devolución ya fue utilizado");
    }
    return { refund: duplicate, order: await posOrderSnapshot(input.tenantId, input.branchId, duplicate.orderId), created: false };
  }

  let refund: Prisma.OrderPaymentGetPayload<Record<string, never>>;
  try {
    refund = await serializableTransaction(async (transaction) => {
    await transaction.$queryRaw`SELECT "id" FROM "OrderPayment" WHERE "tenantId" = ${input.tenantId} AND "branchId" = ${input.branchId} AND "id" = ${input.paymentId} FOR UPDATE`;
    const original = await transaction.orderPayment.findFirst({
      where: { id: input.paymentId, tenantId: input.tenantId, branchId: input.branchId, kind: "PAYMENT" },
      include: { refunds: { select: { amountInCents: true } }, order: { include: { operationalPayments: { select: { kind: true, amountInCents: true } } } } },
    });
    if (!original) throw new HttpError(404, "Cobro no encontrado");
    const alreadyRefunded = original.refunds.reduce((sum, item) => sum + item.amountInCents, 0);
    if (input.amountInCents > original.amountInCents - alreadyRefunded) throw new HttpError(409, "La devolución supera el importe reintegrable del cobro");
    const session = await openSessionOrThrow(transaction, input.tenantId, input.branchId);
    const created = await transaction.orderPayment.create({
      data: {
        tenantId: input.tenantId, branchId: input.branchId, orderId: original.orderId, cashSessionId: session.id,
        kind: "REFUND", method: original.method, amountInCents: input.amountInCents,
        clientRequestId: input.clientRequestId, reference: input.note, refundOfId: original.id, createdByUserId: input.userId,
      },
    });
    if (original.method === "CASH") {
      await transaction.cashMovement.create({
        data: {
          tenantId: input.tenantId, branchId: input.branchId, cashSessionId: session.id,
          orderPaymentId: created.id, type: "CASH_REFUND", amountInCents: -created.amountInCents,
          note: input.note, createdByUserId: input.userId,
        },
      });
    }
    const totals = paidTotals([...original.order.operationalPayments, { kind: "REFUND" as const, amountInCents: created.amountInCents }]);
    await transaction.order.update({
      where: { id: original.orderId },
      data: { paymentStatus: paymentStatus(original.order.totalInCents, totals.grossPaidInCents, totals.paidInCents) },
    });
    await transaction.diningOrderAudit.create({
      data: {
        eventId: input.clientRequestId, tenantId: input.tenantId, branchId: input.branchId, orderId: original.orderId,
        actorUserId: input.userId, action: "PAYMENT_REFUNDED", entityType: "OrderPayment", entityId: created.id,
        payload: { originalPaymentId: original.id, method: original.method, amountInCents: created.amountInCents, cashSessionId: session.id },
      },
    });
    return created;
    });
  } catch (error) {
    if ((error as { code?: string }).code !== "P2002") throw error;
    const existing = await database.orderPayment.findUnique({ where: { tenantId_clientRequestId: { tenantId: input.tenantId, clientRequestId: input.clientRequestId } } });
    if (!existing || existing.kind !== "REFUND" || existing.refundOfId !== input.paymentId || existing.amountInCents !== input.amountInCents) {
      throw new HttpError(409, "El identificador de la devolución ya fue utilizado");
    }
    return { refund: existing, order: await posOrderSnapshot(input.tenantId, input.branchId, existing.orderId), created: false };
  }
  return { refund, order: await posOrderSnapshot(input.tenantId, input.branchId, refund.orderId), created: true };
}

function reconciliation(payments: Array<{ kind: "PAYMENT" | "REFUND"; method: PaymentMethod; amountInCents: number }>, movements: Array<{ type: string; amountInCents: number; orderPaymentId: string | null }>, openingCashInCents: number) {
  const netFor = (...methods: PaymentMethod[]) => payments.filter(({ method }) => methods.includes(method)).reduce((sum, payment) => sum + (payment.kind === "REFUND" ? -payment.amountInCents : payment.amountInCents), 0);
  const salesTotalInCents = payments.reduce((sum, payment) => sum + (payment.kind === "REFUND" ? -payment.amountInCents : payment.amountInCents), 0);
  const cashSalesInCents = netFor("CASH");
  const cardSalesInCents = netFor("CARD_EXTERNAL");
  const mercadoPagoSalesInCents = netFor("MERCADO_PAGO", "MERCADO_PAGO_EXTERNAL");
  const manualMovementsInCents = movements.filter(({ type }) => ["INCOME", "EXPENSE", "ADJUSTMENT"].includes(type)).reduce((sum, movement) => sum + movement.amountInCents, 0);
  const expectedClosingCashInCents = openingCashInCents + cashSalesInCents + manualMovementsInCents;
  const movementCashInCents = movements.reduce((sum, movement) => sum + movement.amountInCents, 0);
  return { salesTotalInCents, cashSalesInCents, cardSalesInCents, mercadoPagoSalesInCents, manualMovementsInCents, expectedClosingCashInCents, movementCashInCents };
}

export async function closeCashRegister(input: {
  tenantId: string; branchId: string; sessionId: string; userId: string; declaredCashInCents: number; note?: string | null;
}) {
  return serializableTransaction(async (transaction) => {
    await transaction.$queryRaw`SELECT "id" FROM "CashRegisterSession" WHERE "tenantId" = ${input.tenantId} AND "branchId" = ${input.branchId} AND "id" = ${input.sessionId} FOR UPDATE`;
    const session = await transaction.cashRegisterSession.findFirst({
      where: { id: input.sessionId, tenantId: input.tenantId, branchId: input.branchId, closedAt: null },
      include: { payments: true, movements: true, cashRegister: true },
    });
    if (!session) throw new HttpError(409, "La caja ya está cerrada o no existe");
    const cashPayments = session.payments.filter(({ method }) => method === "CASH");
    for (const payment of cashPayments) {
      const matches = session.movements.filter(({ orderPaymentId }) => orderPaymentId === payment.id);
      const expectedAmount = payment.kind === "REFUND" ? -payment.amountInCents : payment.amountInCents;
      if (matches.length !== 1 || matches[0]!.amountInCents !== expectedAmount) {
        throw new HttpError(409, "Los movimientos de efectivo no coinciden con los cobros registrados");
      }
    }
    const summary = reconciliation(session.payments, session.movements, session.openingCashInCents);
    if (summary.movementCashInCents !== summary.expectedClosingCashInCents) {
      throw new HttpError(409, "La caja no puede cerrarse porque los movimientos no reconcilian");
    }
    return transaction.cashRegisterSession.update({
      where: { id: session.id },
      data: {
        openKey: null, closedAt: new Date(), closedByUserId: input.userId, closingNote: input.note || null,
        expectedClosingCashInCents: summary.expectedClosingCashInCents,
        declaredClosingCashInCents: input.declaredCashInCents,
        differenceInCents: input.declaredCashInCents - summary.expectedClosingCashInCents,
        salesTotalInCents: summary.salesTotalInCents, cashSalesInCents: summary.cashSalesInCents,
        cardSalesInCents: summary.cardSalesInCents, mercadoPagoSalesInCents: summary.mercadoPagoSalesInCents,
        manualMovementsInCents: summary.manualMovementsInCents,
      },
      include: { cashRegister: true, payments: true, movements: true },
    });
  });
}
