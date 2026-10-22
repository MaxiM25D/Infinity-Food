import { Router } from "express";

import { database } from "../../database.js";
import { HttpError } from "../../errors.js";
import { createDiningOrder } from "../../services/dining-orders.js";
import { emitDiningUpdate } from "../../services/realtime.js";
import {
  addCashMovement, closeCashRegister, currentCashSession, openCashRegister,
  posOrderSnapshot, refundOrderPayment, registerOrderPayment,
} from "../../services/pos.js";
import { getAuthContext, requireBranchRoles, requireSession } from "../auth/session.js";
import { requireWritableSubscription } from "../saas/limits.js";
import {
  cashMovementSchema, closeCashSessionSchema, idSchema, openCashSessionSchema,
  paymentSchema, posOrderSchema, refundSchema,
} from "./schemas.js";

export const posRouter = Router();
posRouter.use(requireSession);
posRouter.use(requireBranchRoles("MANAGER", "WAITER", "CASHIER"));
posRouter.use((request, response, next) => {
  if (["POST", "PUT", "PATCH", "DELETE"].includes(request.method)) {
    void requireWritableSubscription(request, response, next);
    return;
  }
  next();
});

posRouter.get("/overview", async (request, response) => {
  const auth = getAuthContext(request);
  const [session, orders, tables, menu, recentSessions] = await Promise.all([
    currentCashSession(auth.tenant.id, auth.branch.id),
    database.order.findMany({
      where: { tenantId: auth.tenant.id, branchId: auth.branch.id, diningStatus: { notIn: ["CANCELLED"] } },
      orderBy: { createdAt: "desc" }, take: 100,
      include: {
        restaurantTable: { select: { id: true, code: true, name: true } },
        items: { orderBy: { createdAt: "asc" }, include: { modifiers: true, paymentAllocations: true } },
        adjustments: { orderBy: { createdAt: "asc" } },
        operationalPayments: { orderBy: { createdAt: "asc" }, include: { allocations: true } },
      },
    }),
    database.restaurantTable.findMany({ where: { tenantId: auth.tenant.id, branchId: auth.branch.id, status: "AVAILABLE" }, orderBy: { name: "asc" } }),
    database.branchMenuItem.findMany({
      where: { tenantId: auth.tenant.id, branchId: auth.branch.id, availability: "AVAILABLE", product: { active: true } },
      orderBy: [{ sortOrder: "asc" }, { product: { name: "asc" } }],
      include: { product: { select: { id: true, name: true, priceInCents: true, category: { select: { name: true } } } } },
    }),
    database.cashRegisterSession.findMany({
      where: { tenantId: auth.tenant.id, branchId: auth.branch.id, closedAt: { not: null } },
      orderBy: { closedAt: "desc" }, take: 10, include: { cashRegister: true },
    }),
  ]);
  const orderViews = orders.map((order) => {
    const grossPaidInCents = order.operationalPayments.filter(({ kind }) => kind === "PAYMENT").reduce((sum, payment) => sum + payment.amountInCents, 0);
    const refundedInCents = order.operationalPayments.filter(({ kind }) => kind === "REFUND").reduce((sum, payment) => sum + payment.amountInCents, 0);
    const paidInCents = grossPaidInCents - refundedInCents;
    return { ...order, grossPaidInCents, refundedInCents, paidInCents, balanceInCents: Math.max(0, order.totalInCents - paidInCents) };
  });
  response.setHeader("Cache-Control", "no-store");
  response.json({ session, orders: orderViews, tables, menu, recentSessions });
});

posRouter.post("/cash-sessions/open", requireBranchRoles("MANAGER", "CASHIER"), async (request, response) => {
  const auth = getAuthContext(request);
  const input = openCashSessionSchema.parse(request.body);
  const session = await openCashRegister({ tenantId: auth.tenant.id, branchId: auth.branch.id, userId: auth.user.id, ...input });
  response.status(201).json({ session: await currentCashSession(auth.tenant.id, auth.branch.id) ?? session });
});

posRouter.post("/cash-sessions/:sessionId/movements", requireBranchRoles("MANAGER", "CASHIER"), async (request, response) => {
  const auth = getAuthContext(request);
  const input = cashMovementSchema.parse(request.body);
  const movement = await addCashMovement({ tenantId: auth.tenant.id, branchId: auth.branch.id, sessionId: idSchema.parse(request.params.sessionId), userId: auth.user.id, ...input });
  response.status(201).json({ movement });
});

posRouter.post("/cash-sessions/:sessionId/close", requireBranchRoles("MANAGER", "CASHIER"), async (request, response) => {
  const auth = getAuthContext(request);
  const input = closeCashSessionSchema.parse(request.body);
  const session = await closeCashRegister({ tenantId: auth.tenant.id, branchId: auth.branch.id, sessionId: idSchema.parse(request.params.sessionId), userId: auth.user.id, ...input });
  response.json({ session });
});

posRouter.post("/orders", async (request, response) => {
  const auth = getAuthContext(request);
  const input = posOrderSchema.parse(request.body);
  const result = await createDiningOrder({
    tenantId: auth.tenant.id, branchId: auth.branch.id, userId: auth.user.id, source: "POS",
    tableId: input.serviceMode === "TABLE" ? input.tableId! : undefined,
    clientRequestId: input.clientRequestId, customerName: input.customerName,
    customerPhone: input.customerPhone, notes: input.notes, items: input.items,
  });
  if (!result.order) throw new HttpError(500, "No pudimos recuperar el pedido creado");
  const stationIds = result.order.rounds.flatMap((round) => round.tickets.map((ticket) => ticket.stationId));
  emitDiningUpdate({ tenantId: auth.tenant.id, branchId: auth.branch.id, stationIds, event: "dining:order-updated", payload: { orderId: result.order.id } });
  response.status(result.created ? 201 : 200).json({ order: await posOrderSnapshot(auth.tenant.id, auth.branch.id, result.order.id), created: result.created });
});

posRouter.get("/orders/:orderId", async (request, response) => {
  const auth = getAuthContext(request);
  const order = await posOrderSnapshot(auth.tenant.id, auth.branch.id, idSchema.parse(request.params.orderId));
  if (!order) throw new HttpError(404, "Pedido no encontrado");
  response.json({ order });
});

posRouter.post("/orders/:orderId/payments", requireBranchRoles("MANAGER", "CASHIER"), async (request, response) => {
  const auth = getAuthContext(request);
  const input = paymentSchema.parse(request.body);
  const result = await registerOrderPayment({ tenantId: auth.tenant.id, branchId: auth.branch.id, orderId: idSchema.parse(request.params.orderId), userId: auth.user.id, ...input });
  emitDiningUpdate({ tenantId: auth.tenant.id, branchId: auth.branch.id, event: "dining:order-updated", payload: { orderId: result.payment.orderId, payment: true } });
  response.status(result.created ? 201 : 200).json(result);
});

posRouter.post("/payments/:paymentId/refunds", requireBranchRoles("MANAGER", "CASHIER"), async (request, response) => {
  const auth = getAuthContext(request);
  const input = refundSchema.parse(request.body);
  const result = await refundOrderPayment({ tenantId: auth.tenant.id, branchId: auth.branch.id, paymentId: idSchema.parse(request.params.paymentId), userId: auth.user.id, ...input });
  emitDiningUpdate({ tenantId: auth.tenant.id, branchId: auth.branch.id, event: "dining:order-updated", payload: { orderId: result.refund.orderId, refund: true } });
  response.status(result.created ? 201 : 200).json(result);
});
