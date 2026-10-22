import { Router } from "express";

import { database } from "../../database.js";
import { HttpError } from "../../errors.js";
import { createDiningOrder } from "../../services/dining-orders.js";
import { emitDiningUpdate } from "../../services/realtime.js";
import { fiscalCsv, issueFiscalDocument } from "../../services/fiscal.js";
import {
  createPosMercadoPagoCheckout,
  refundOperationalMercadoPagoPayment,
  syncOperationalMercadoPagoPayment,
} from "../../services/mercado-pago.js";
import {
  addCashMovement,
  closeCashRegister,
  currentCashSession,
  openCashRegister,
  posOrderSnapshot,
  refundOrderPayment,
  registerOrderPayment,
} from "../../services/pos.js";
import {
  getAuthContext,
  requireBranchRoles,
  requireSession,
} from "../auth/session.js";
import { requireWritableSubscription } from "../saas/limits.js";
import {
  cashMovementSchema,
  closeCashSessionSchema,
  idSchema,
  openCashSessionSchema,
  fiscalDocumentSchema,
  fiscalProfileSchema,
  mercadoPagoCheckoutSchema,
  paymentSchema,
  posOrderSchema,
  refundSchema,
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
  const [
    session,
    orders,
    tables,
    menu,
    recentSessions,
    mercadoPago,
    fiscalProfile,
    fiscalDocuments,
  ] = await Promise.all([
    currentCashSession(auth.tenant.id, auth.branch.id),
    database.order.findMany({
      where: {
        tenantId: auth.tenant.id,
        branchId: auth.branch.id,
        diningStatus: { notIn: ["CANCELLED"] },
      },
      orderBy: { createdAt: "desc" },
      take: 100,
      include: {
        restaurantTable: { select: { id: true, code: true, name: true } },
        items: {
          orderBy: { createdAt: "asc" },
          include: { modifiers: true, paymentAllocations: true },
        },
        adjustments: { orderBy: { createdAt: "asc" } },
        operationalPayments: {
          orderBy: { createdAt: "asc" },
          include: { allocations: true },
        },
        paymentAttempts: {
          where: { flow: "POS", status: "PENDING" },
          orderBy: { createdAt: "asc" },
        },
      },
    }),
    database.restaurantTable.findMany({
      where: {
        tenantId: auth.tenant.id,
        branchId: auth.branch.id,
        status: "AVAILABLE",
      },
      orderBy: { name: "asc" },
    }),
    database.branchMenuItem.findMany({
      where: {
        tenantId: auth.tenant.id,
        branchId: auth.branch.id,
        availability: "AVAILABLE",
        product: { active: true },
      },
      orderBy: [{ sortOrder: "asc" }, { product: { name: "asc" } }],
      include: {
        product: {
          select: {
            id: true,
            name: true,
            priceInCents: true,
            category: { select: { name: true } },
          },
        },
      },
    }),
    database.cashRegisterSession.findMany({
      where: {
        tenantId: auth.tenant.id,
        branchId: auth.branch.id,
        closedAt: { not: null },
      },
      orderBy: { closedAt: "desc" },
      take: 10,
      include: { cashRegister: true },
    }),
    database.mercadoPagoConnection.findUnique({
      where: { tenantId: auth.tenant.id },
      select: { mercadoPagoUserId: true, liveMode: true, connectedAt: true },
    }),
    database.fiscalProfile.findUnique({
      where: {
        tenantId_branchId: {
          tenantId: auth.tenant.id,
          branchId: auth.branch.id,
        },
      },
    }),
    database.fiscalDocument.findMany({
      where: { tenantId: auth.tenant.id, branchId: auth.branch.id },
      orderBy: { createdAt: "desc" },
      take: 50,
      include: { order: { select: { number: true } } },
    }),
  ]);
  const orderViews = orders.map((order) => {
    const grossPaidInCents = order.operationalPayments
      .filter(({ kind }) => kind === "PAYMENT")
      .reduce((sum, payment) => sum + payment.amountInCents, 0);
    const refundedInCents = order.operationalPayments
      .filter(({ kind }) => kind === "REFUND")
      .reduce((sum, payment) => sum + payment.amountInCents, 0);
    const paidInCents = grossPaidInCents - refundedInCents;
    const pendingProviderInCents = order.paymentAttempts.reduce(
      (sum, attempt) => sum + attempt.amountInCents,
      0,
    );
    return {
      ...order,
      grossPaidInCents,
      refundedInCents,
      paidInCents,
      pendingProviderInCents,
      balanceInCents: Math.max(
        0,
        order.totalInCents - paidInCents - pendingProviderInCents,
      ),
    };
  });
  response.setHeader("Cache-Control", "no-store");
  response.json({
    session,
    orders: orderViews,
    tables,
    menu,
    recentSessions,
    mercadoPago,
    fiscalProfile,
    fiscalDocuments,
  });
});

posRouter.post(
  "/cash-sessions/open",
  requireBranchRoles("MANAGER", "CASHIER"),
  async (request, response) => {
    const auth = getAuthContext(request);
    const input = openCashSessionSchema.parse(request.body);
    const session = await openCashRegister({
      tenantId: auth.tenant.id,
      branchId: auth.branch.id,
      userId: auth.user.id,
      ...input,
    });
    response
      .status(201)
      .json({
        session:
          (await currentCashSession(auth.tenant.id, auth.branch.id)) ?? session,
      });
  },
);

posRouter.post(
  "/cash-sessions/:sessionId/movements",
  requireBranchRoles("MANAGER", "CASHIER"),
  async (request, response) => {
    const auth = getAuthContext(request);
    const input = cashMovementSchema.parse(request.body);
    const movement = await addCashMovement({
      tenantId: auth.tenant.id,
      branchId: auth.branch.id,
      sessionId: idSchema.parse(request.params.sessionId),
      userId: auth.user.id,
      ...input,
    });
    response.status(201).json({ movement });
  },
);

posRouter.post(
  "/cash-sessions/:sessionId/close",
  requireBranchRoles("MANAGER", "CASHIER"),
  async (request, response) => {
    const auth = getAuthContext(request);
    const input = closeCashSessionSchema.parse(request.body);
    const session = await closeCashRegister({
      tenantId: auth.tenant.id,
      branchId: auth.branch.id,
      sessionId: idSchema.parse(request.params.sessionId),
      userId: auth.user.id,
      ...input,
    });
    response.json({ session });
  },
);

posRouter.post("/orders", async (request, response) => {
  const auth = getAuthContext(request);
  const input = posOrderSchema.parse(request.body);
  const result = await createDiningOrder({
    tenantId: auth.tenant.id,
    branchId: auth.branch.id,
    userId: auth.user.id,
    source: "POS",
    tableId: input.serviceMode === "TABLE" ? input.tableId! : undefined,
    clientRequestId: input.clientRequestId,
    customerName: input.customerName,
    customerPhone: input.customerPhone,
    notes: input.notes,
    items: input.items,
  });
  if (!result.order)
    throw new HttpError(500, "No pudimos recuperar el pedido creado");
  const stationIds = result.order.rounds.flatMap((round) =>
    round.tickets.map((ticket) => ticket.stationId),
  );
  emitDiningUpdate({
    tenantId: auth.tenant.id,
    branchId: auth.branch.id,
    stationIds,
    event: "dining:order-updated",
    payload: { orderId: result.order.id },
  });
  response
    .status(result.created ? 201 : 200)
    .json({
      order: await posOrderSnapshot(
        auth.tenant.id,
        auth.branch.id,
        result.order.id,
      ),
      created: result.created,
    });
});

posRouter.get("/orders/:orderId", async (request, response) => {
  const auth = getAuthContext(request);
  const order = await posOrderSnapshot(
    auth.tenant.id,
    auth.branch.id,
    idSchema.parse(request.params.orderId),
  );
  if (!order) throw new HttpError(404, "Pedido no encontrado");
  response.json({ order });
});

posRouter.post(
  "/orders/:orderId/payments",
  requireBranchRoles("MANAGER", "CASHIER"),
  async (request, response) => {
    const auth = getAuthContext(request);
    const input = paymentSchema.parse(request.body);
    const result = await registerOrderPayment({
      tenantId: auth.tenant.id,
      branchId: auth.branch.id,
      orderId: idSchema.parse(request.params.orderId),
      userId: auth.user.id,
      ...input,
    });
    emitDiningUpdate({
      tenantId: auth.tenant.id,
      branchId: auth.branch.id,
      event: "dining:order-updated",
      payload: { orderId: result.payment.orderId, payment: true },
    });
    response.status(result.created ? 201 : 200).json(result);
  },
);

posRouter.post(
  "/orders/:orderId/mercadopago-checkout",
  requireBranchRoles("MANAGER", "CASHIER"),
  async (request, response) => {
    const auth = getAuthContext(request);
    const input = mercadoPagoCheckoutSchema.parse(request.body);
    const result = await createPosMercadoPagoCheckout({
      tenantId: auth.tenant.id,
      branchId: auth.branch.id,
      orderId: idSchema.parse(request.params.orderId),
      userId: auth.user.id,
      ...input,
    });
    response.status(result.created ? 201 : 200).json(result);
  },
);

posRouter.post(
  "/mercadopago-attempts/:attemptId/cancel",
  requireBranchRoles("MANAGER", "CASHIER"),
  async (request, response) => {
    const auth = getAuthContext(request);
    const id = idSchema.parse(request.params.attemptId);
    const cancelled = await database.paymentAttempt.updateMany({
      where: {
        id,
        tenantId: auth.tenant.id,
        branchId: auth.branch.id,
        flow: "POS",
        status: "PENDING",
        externalPaymentId: null,
      },
      data: { status: "CANCELLED", statusDetail: "cancelled_by_operator" },
    });
    if (!cancelled.count)
      throw new HttpError(
        409,
        "El checkout ya fue procesado o no pertenece a la sucursal",
      );
    response.json({ cancelled: true });
  },
);

posRouter.post(
  "/payments/:paymentId/reconcile",
  requireBranchRoles("MANAGER", "CASHIER"),
  async (request, response) => {
    const auth = getAuthContext(request);
    const payment = await syncOperationalMercadoPagoPayment({
      tenantId: auth.tenant.id,
      branchId: auth.branch.id,
      paymentId: idSchema.parse(request.params.paymentId),
    });
    response.json({ payment });
  },
);

posRouter.get(
  "/reconciliation",
  requireBranchRoles("MANAGER", "CASHIER"),
  async (request, response) => {
    const auth = getAuthContext(request);
    const [payments, orphanApprovedAttempts] = await Promise.all([
      database.orderPayment.findMany({
        where: {
          tenantId: auth.tenant.id,
          branchId: auth.branch.id,
          method: "MERCADO_PAGO",
          kind: "PAYMENT",
        },
        orderBy: { createdAt: "desc" },
        take: 250,
        include: { order: { select: { number: true } } },
      }),
      database.paymentAttempt.findMany({
        where: {
          tenantId: auth.tenant.id,
          branchId: auth.branch.id,
          flow: "POS",
          status: "APPROVED",
          operationalPayment: { is: null },
        },
        orderBy: { createdAt: "desc" },
        take: 250,
        select: {
          id: true,
          orderId: true,
          amountInCents: true,
          externalPaymentId: true,
          statusDetail: true,
          createdAt: true,
        },
      }),
    ]);
    response.json({
      payments,
      anomalies: orphanApprovedAttempts,
      summary: {
        grossInCents: payments.reduce(
          (sum, item) => sum + item.amountInCents,
          0,
        ),
        feesInCents: payments.reduce(
          (sum, item) => sum + (item.providerFeeInCents ?? 0),
          0,
        ),
        netInCents: payments.reduce(
          (sum, item) => sum + (item.providerNetInCents ?? 0),
          0,
        ),
        pending: payments.filter(
          ({ reconciliationStatus }) => reconciliationStatus === "PENDING",
        ).length,
        mismatches:
          payments.filter(
            ({ reconciliationStatus }) => reconciliationStatus === "MISMATCH",
          ).length + orphanApprovedAttempts.length,
      },
    });
  },
);

posRouter.put(
  "/fiscal/profile",
  requireBranchRoles("MANAGER"),
  async (request, response) => {
    const auth = getAuthContext(request);
    const input = fiscalProfileSchema.parse(request.body);
    const profile = await database.fiscalProfile.upsert({
      where: {
        tenantId_branchId: {
          tenantId: auth.tenant.id,
          branchId: auth.branch.id,
        },
      },
      update: input,
      create: { tenantId: auth.tenant.id, branchId: auth.branch.id, ...input },
    });
    response.json({ profile });
  },
);

posRouter.post(
  "/orders/:orderId/fiscal-documents",
  requireBranchRoles("MANAGER", "CASHIER"),
  async (request, response) => {
    const auth = getAuthContext(request);
    const input = fiscalDocumentSchema.parse(request.body);
    const result = await issueFiscalDocument({
      tenantId: auth.tenant.id,
      branchId: auth.branch.id,
      orderId: idSchema.parse(request.params.orderId),
      ...input,
    });
    response.status(result.created ? 201 : 200).json(result);
  },
);

posRouter.get(
  "/fiscal/export.csv",
  requireBranchRoles("MANAGER", "CASHIER"),
  async (request, response) => {
    const auth = getAuthContext(request);
    const documents = await database.fiscalDocument.findMany({
      where: { tenantId: auth.tenant.id, branchId: auth.branch.id },
      orderBy: { createdAt: "asc" },
      include: { order: { select: { number: true } } },
    });
    response
      .type("text/csv")
      .attachment(`comprobantes-${auth.branch.slug}.csv`)
      .send(fiscalCsv(documents));
  },
);

posRouter.post(
  "/payments/:paymentId/refunds",
  requireBranchRoles("MANAGER", "CASHIER"),
  async (request, response) => {
    const auth = getAuthContext(request);
    const input = refundSchema.parse(request.body);
    const original = await database.orderPayment.findFirst({
      where: {
        id: idSchema.parse(request.params.paymentId),
        tenantId: auth.tenant.id,
        branchId: auth.branch.id,
      },
      select: { method: true },
    });
    if (original?.method === "MERCADO_PAGO")
      await refundOperationalMercadoPagoPayment({
        tenantId: auth.tenant.id,
        branchId: auth.branch.id,
        paymentId: idSchema.parse(request.params.paymentId),
        amountInCents: input.amountInCents,
        clientRequestId: input.clientRequestId,
      });
    const result = await refundOrderPayment({
      tenantId: auth.tenant.id,
      branchId: auth.branch.id,
      paymentId: idSchema.parse(request.params.paymentId),
      userId: auth.user.id,
      ...input,
    });
    emitDiningUpdate({
      tenantId: auth.tenant.id,
      branchId: auth.branch.id,
      event: "dining:order-updated",
      payload: { orderId: result.refund.orderId, refund: true },
    });
    response.status(result.created ? 201 : 200).json(result);
  },
);
