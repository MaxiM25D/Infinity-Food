import { Router } from "express";
import QRCode from "qrcode";

import { environment } from "../../config.js";
import { database } from "../../database.js";
import { HttpError } from "../../errors.js";
import { appendDiningRound, createDiningOrder, diningOrderSnapshot, diningOrderTokenMatches } from "../../services/dining-orders.js";
import { emitDiningUpdate } from "../../services/realtime.js";
import { getAuthContext, requireBranchRoles, requireSession } from "../auth/session.js";
import { requireWritableSubscription } from "../saas/limits.js";
import {
  diningOrderStatusSchema, diningRoundSchema, idSchema, publicDiningOrderSchema, restaurantTableSchema,
  slugSchema, stationAssignmentSchema, stationSchema, ticketStatusSchema, waiterDiningOrderSchema,
} from "./schemas.js";

export const publicDiningRouter = Router();
export const adminDiningRouter = Router();

function publicOrderView(order: NonNullable<Awaited<ReturnType<typeof diningOrderSnapshot>>>) {
  return {
    id: order.id, number: order.number, customerName: order.customerName, diningStatus: order.diningStatus,
    subtotalInCents: order.subtotalInCents, totalInCents: order.totalInCents, currency: order.currency,
    createdAt: order.createdAt, table: order.restaurantTable,
    rounds: order.rounds.map((round) => ({
      id: round.id, number: round.number, status: round.status, createdAt: round.createdAt,
      items: round.items.map((item) => ({ id: item.id, productName: item.productName, quantity: item.quantity, unitPriceInCents: item.unitPriceInCents, subtotalInCents: item.subtotalInCents, notes: item.notes })),
      tickets: round.tickets.map((ticket) => ({ id: ticket.id, status: ticket.status, station: { name: ticket.station.name, type: ticket.station.type }, startedAt: ticket.startedAt, readyAt: ticket.readyAt, servedAt: ticket.servedAt })),
    })),
  };
}

async function publicTableContext(tenantSlug: string, branchSlug: string, tableCode: string) {
  const table = await database.restaurantTable.findFirst({
    where: { code: tableCode, status: "AVAILABLE", branch: { slug: branchSlug, status: "ACTIVE", tenant: { slug: tenantSlug, status: "ACTIVE" } } },
    select: {
      id: true, code: true, name: true,
      branch: {
        select: {
          id: true, name: true, slug: true,
          tenant: { select: { id: true, name: true, slug: true, settings: { select: { currency: true, logoUrl: true, primaryColor: true } } } },
          menuItems: {
            where: { availability: "AVAILABLE", product: { active: true, category: { is: { active: true } } } },
            orderBy: [{ sortOrder: "asc" }, { product: { name: "asc" } }],
            select: { priceOverrideInCents: true, product: { select: { id: true, name: true, description: true, images: true, priceInCents: true, preparationTimeMinutes: true, allergens: true, dietaryTags: true, category: { select: { id: true, name: true, displayOrder: true } } } } },
          },
        },
      },
    },
  });
  if (!table) throw new HttpError(404, "Mesa no encontrada");
  return table;
}

publicDiningRouter.get("/:tenantSlug/:branchSlug/tables/:tableCode", async (request, response) => {
  const tenantSlug = slugSchema.parse(request.params.tenantSlug);
  const branchSlug = slugSchema.parse(request.params.branchSlug);
  const tableCode = idSchema.parse(request.params.tableCode);
  const table = await publicTableContext(tenantSlug, branchSlug, tableCode);
  const categories = new Map<string, { id: string; name: string; displayOrder: number; items: unknown[] }>();
  for (const link of table.branch.menuItems) {
    const category = link.product.category;
    if (!category) continue;
    const group = categories.get(category.id) ?? { ...category, items: [] };
    group.items.push({
      id: link.product.id, name: link.product.name, description: link.product.description,
      image: link.product.images[0] ?? null, priceInCents: link.priceOverrideInCents ?? link.product.priceInCents,
      preparationTimeMinutes: link.product.preparationTimeMinutes, allergens: link.product.allergens, dietaryTags: link.product.dietaryTags,
    });
    categories.set(category.id, group);
  }
  response.setHeader("Cache-Control", "no-store");
  response.json({
    restaurant: { name: table.branch.tenant.name, slug: table.branch.tenant.slug, settings: table.branch.tenant.settings },
    branch: { name: table.branch.name, slug: table.branch.slug },
    table: { id: table.id, code: table.code, name: table.name },
    categories: [...categories.values()].sort((a, b) => a.displayOrder - b.displayOrder || a.name.localeCompare(b.name)),
  });
});

publicDiningRouter.post("/:tenantSlug/:branchSlug/tables/:tableCode/orders", async (request, response) => {
  const tenantSlug = slugSchema.parse(request.params.tenantSlug);
  const branchSlug = slugSchema.parse(request.params.branchSlug);
  const tableCode = idSchema.parse(request.params.tableCode);
  const input = publicDiningOrderSchema.parse(request.body);
  const table = await publicTableContext(tenantSlug, branchSlug, tableCode);
  const result = await createDiningOrder({
    tenantId: table.branch.tenant.id, branchId: table.branch.id, tableId: table.id, source: "QR", ...input,
  });
  const stationIds = result.order?.rounds.flatMap((round) => round.tickets.map((ticket) => ticket.stationId)) ?? [];
  emitDiningUpdate({ tenantId: table.branch.tenant.id, branchId: table.branch.id, stationIds, event: "dining:order-updated", payload: { orderId: result.order?.id } });
  if (!result.order) throw new HttpError(500, "No pudimos recuperar el pedido creado");
  response.status(result.created ? 201 : 200).json({ order: publicOrderView(result.order), orderToken: result.orderToken, created: result.created });
});

publicDiningRouter.get("/:tenantSlug/:branchSlug/orders/:orderId", async (request, response) => {
  const tenantSlug = slugSchema.parse(request.params.tenantSlug);
  const branchSlug = slugSchema.parse(request.params.branchSlug);
  const orderId = idSchema.parse(request.params.orderId);
  const token = request.get("x-order-token") ?? "";
  const branch = await database.branch.findFirst({ where: { slug: branchSlug, tenant: { slug: tenantSlug, status: "ACTIVE" } }, select: { id: true, tenantId: true } });
  if (!branch) throw new HttpError(404, "Pedido no encontrado");
  const secured = await database.order.findFirst({ where: { id: orderId, tenantId: branch.tenantId, branchId: branch.id }, select: { publicTokenHash: true } });
  if (!secured || !diningOrderTokenMatches(branch.tenantId, token, secured.publicTokenHash)) throw new HttpError(404, "Pedido no encontrado");
  const order = await diningOrderSnapshot(branch.tenantId, branch.id, orderId);
  if (!order) throw new HttpError(404, "Pedido no encontrado");
  response.json({ order: publicOrderView(order) });
});

publicDiningRouter.post("/:tenantSlug/:branchSlug/orders/:orderId/rounds", async (request, response) => {
  const tenantSlug = slugSchema.parse(request.params.tenantSlug);
  const branchSlug = slugSchema.parse(request.params.branchSlug);
  const orderId = idSchema.parse(request.params.orderId);
  const input = diningRoundSchema.parse(request.body);
  if (!input.orderToken) throw new HttpError(404, "Pedido no encontrado");
  const branch = await database.branch.findFirst({ where: { slug: branchSlug, tenant: { slug: tenantSlug, status: "ACTIVE" } }, select: { id: true, tenantId: true } });
  const secured = branch && await database.order.findFirst({ where: { id: orderId, tenantId: branch.tenantId, branchId: branch.id }, select: { publicTokenHash: true } });
  if (!branch || !secured || !diningOrderTokenMatches(branch.tenantId, input.orderToken, secured.publicTokenHash)) throw new HttpError(404, "Pedido no encontrado");
  const order = await appendDiningRound({ tenantId: branch.tenantId, branchId: branch.id, orderId, clientRequestId: input.clientRequestId, items: input.items });
  const stationIds = order?.rounds.flatMap((round) => round.tickets.map((ticket) => ticket.stationId)) ?? [];
  emitDiningUpdate({ tenantId: branch.tenantId, branchId: branch.id, stationIds, event: "dining:order-updated", payload: { orderId } });
  if (!order) throw new HttpError(404, "Pedido no encontrado");
  response.status(201).json({ order: publicOrderView(order) });
});

adminDiningRouter.use(requireSession);

adminDiningRouter.get("/tables", async (request, response) => {
  const auth = getAuthContext(request);
  const tables = await database.restaurantTable.findMany({ where: { tenantId: auth.tenant.id, branchId: auth.branch.id }, orderBy: { name: "asc" }, include: { sector: true } });
  response.json({ tables });
});

adminDiningRouter.post("/tables", requireBranchRoles("MANAGER"), requireWritableSubscription, async (request, response) => {
  const auth = getAuthContext(request);
  const input = restaurantTableSchema.parse(request.body);
  if (input.sectorId) {
    const sector = await database.sector.findFirst({ where: { id: input.sectorId, tenantId: auth.tenant.id, branchId: auth.branch.id } });
    if (!sector) throw new HttpError(404, "Sector no encontrado");
  }
  const table = await database.restaurantTable.create({ data: { tenantId: auth.tenant.id, branchId: auth.branch.id, ...input } });
  response.status(201).json({ table });
});

adminDiningRouter.get("/tables/:tableId/qr.svg", async (request, response) => {
  const auth = getAuthContext(request);
  const tableId = idSchema.parse(request.params.tableId);
  const table = await database.restaurantTable.findFirst({ where: { id: tableId, tenantId: auth.tenant.id, branchId: auth.branch.id } });
  if (!table) throw new HttpError(404, "Mesa no encontrada");
  const url = `${environment.WEB_URL.replace(/\/$/, "")}/mesa/${encodeURIComponent(auth.tenant.slug)}/${encodeURIComponent(auth.branch.slug)}/${encodeURIComponent(table.code)}`;
  response.type("image/svg+xml").setHeader("Content-Disposition", `inline; filename="mesa-${table.code}.svg"`);
  response.send(await QRCode.toString(url, { type: "svg", errorCorrectionLevel: "M", margin: 2, width: 640 }));
});

adminDiningRouter.get("/orders", async (request, response) => {
  const auth = getAuthContext(request);
  const orders = await database.order.findMany({
    where: { tenantId: auth.tenant.id, branchId: auth.branch.id, diningStatus: { not: null } },
    orderBy: { createdAt: "desc" }, take: 100,
    include: { restaurantTable: true, rounds: { include: { items: true, tickets: { include: { station: true } } }, orderBy: { number: "asc" } } },
  });
  response.json({ orders });
});

adminDiningRouter.post("/orders", requireBranchRoles("MANAGER", "WAITER"), requireWritableSubscription, async (request, response) => {
  const auth = getAuthContext(request);
  const input = waiterDiningOrderSchema.parse(request.body);
  const result = await createDiningOrder({ tenantId: auth.tenant.id, branchId: auth.branch.id, source: "WAITER", userId: auth.user.id, ...input });
  const stationIds = result.order?.rounds.flatMap((round) => round.tickets.map((ticket) => ticket.stationId)) ?? [];
  emitDiningUpdate({ tenantId: auth.tenant.id, branchId: auth.branch.id, stationIds, event: "dining:order-updated", payload: { orderId: result.order?.id } });
  response.status(result.created ? 201 : 200).json(result);
});

adminDiningRouter.post("/orders/:orderId/rounds", requireBranchRoles("MANAGER", "WAITER"), requireWritableSubscription, async (request, response) => {
  const auth = getAuthContext(request);
  const orderId = idSchema.parse(request.params.orderId);
  const input = diningRoundSchema.omit({ orderToken: true }).parse(request.body);
  const order = await appendDiningRound({ tenantId: auth.tenant.id, branchId: auth.branch.id, orderId, clientRequestId: input.clientRequestId, items: input.items, userId: auth.user.id });
  if (!order) throw new HttpError(404, "Pedido no encontrado");
  const stationIds = order.rounds.flatMap((round) => round.tickets.map((ticket) => ticket.stationId));
  emitDiningUpdate({ tenantId: auth.tenant.id, branchId: auth.branch.id, stationIds, event: "dining:order-updated", payload: { orderId } });
  response.status(201).json({ order });
});

adminDiningRouter.patch("/orders/:orderId/status", requireBranchRoles("MANAGER", "WAITER", "CASHIER"), async (request, response) => {
  const auth = getAuthContext(request);
  const orderId = idSchema.parse(request.params.orderId);
  const input = diningOrderStatusSchema.parse(request.body);
  const prior = await database.diningOrderAudit.findUnique({ where: { eventId: input.eventId } });
  if (prior) {
    if (prior.orderId !== orderId) throw new HttpError(409, "El evento ya fue utilizado");
    response.json({ order: await diningOrderSnapshot(auth.tenant.id, auth.branch.id, orderId), idempotent: true });
    return;
  }
  const order = await database.$transaction(async (transaction) => {
    const current = await transaction.order.findFirst({ where: { id: orderId, tenantId: auth.tenant.id, branchId: auth.branch.id, diningStatus: { not: null } } });
    if (!current) throw new HttpError(404, "Pedido no encontrado");
    const allowed: Record<string, string[]> = { OPEN: ["CANCELLED"], IN_PREPARATION: ["CANCELLED"], READY: ["SERVED", "CANCELLED"], SERVED: ["CLOSED"], CLOSED: [], CANCELLED: [] };
    if (current.diningStatus !== input.status && !allowed[current.diningStatus!]?.includes(input.status)) throw new HttpError(409, "Transición de pedido no permitida");
    const updated = await transaction.order.update({ where: { id: current.id }, data: { diningStatus: input.status, status: input.status === "CANCELLED" ? "CANCELLED" : input.status === "CLOSED" ? "DELIVERED" : current.status, diningClosedAt: ["CLOSED", "CANCELLED"].includes(input.status) ? new Date() : undefined } });
    await transaction.diningOrderAudit.create({ data: { eventId: input.eventId, tenantId: auth.tenant.id, branchId: auth.branch.id, orderId, actorUserId: auth.user.id, action: "ORDER_STATUS_CHANGED", entityType: "Order", entityId: orderId, payload: { from: current.diningStatus, to: input.status } } });
    return updated;
  });
  emitDiningUpdate({ tenantId: auth.tenant.id, branchId: auth.branch.id, event: "dining:order-updated", payload: { orderId, status: order.diningStatus } });
  response.json({ order, idempotent: false });
});

adminDiningRouter.get("/stations", async (request, response) => {
  const auth = getAuthContext(request);
  const stations = await database.kitchenStation.findMany({ where: { tenantId: auth.tenant.id, branchId: auth.branch.id, ...(auth.role === "STAFF" && auth.branch.role === "KITCHEN" ? { id: auth.branch.stationId ?? "" } : {}) }, orderBy: [{ displayOrder: "asc" }, { name: "asc" }], include: { _count: { select: { menuItems: true } } } });
  response.json({ stations });
});

adminDiningRouter.post("/stations", requireBranchRoles("MANAGER"), requireWritableSubscription, async (request, response) => {
  const auth = getAuthContext(request);
  const input = stationSchema.parse(request.body);
  const station = await database.kitchenStation.create({ data: { tenantId: auth.tenant.id, branchId: auth.branch.id, ...input } });
  response.status(201).json({ station });
});

adminDiningRouter.put("/menu-items/:productId/station", requireBranchRoles("MANAGER"), requireWritableSubscription, async (request, response) => {
  const auth = getAuthContext(request);
  const productId = idSchema.parse(request.params.productId);
  const input = stationAssignmentSchema.parse(request.body);
  const [product, station] = await Promise.all([
    database.branchMenuItem.findUnique({ where: { tenantId_branchId_productId: { tenantId: auth.tenant.id, branchId: auth.branch.id, productId } } }),
    database.kitchenStation.findFirst({ where: { id: input.stationId, tenantId: auth.tenant.id, branchId: auth.branch.id, active: true } }),
  ]);
  if (!product || !station) throw new HttpError(404, "Plato o estación no encontrados");
  const assignment = await database.kitchenStationMenuItem.upsert({
    where: { tenantId_branchId_productId: { tenantId: auth.tenant.id, branchId: auth.branch.id, productId } },
    update: { stationId: station.id }, create: { tenantId: auth.tenant.id, branchId: auth.branch.id, productId, stationId: station.id },
  });
  response.json({ assignment });
});

adminDiningRouter.get("/kds/:stationId/tickets", requireBranchRoles("MANAGER", "KITCHEN"), async (request, response) => {
  const auth = getAuthContext(request);
  const stationId = idSchema.parse(request.params.stationId);
  if (auth.role === "STAFF" && auth.branch.role === "KITCHEN" && auth.branch.stationId !== stationId) throw new HttpError(404, "Estación no encontrada");
  const station = await database.kitchenStation.findFirst({ where: { id: stationId, tenantId: auth.tenant.id, branchId: auth.branch.id, active: true } });
  if (!station) throw new HttpError(404, "Estación no encontrada");
  const tickets = await database.kitchenTicket.findMany({
    where: { tenantId: auth.tenant.id, branchId: auth.branch.id, stationId, status: { in: ["PENDING", "PREPARING", "READY"] } },
    orderBy: { createdAt: "asc" },
    include: { station: true, items: { include: { orderItem: true } }, round: { include: { order: { include: { restaurantTable: true } } } } },
  });
  response.setHeader("Cache-Control", "no-store");
  response.json({ station, tickets, snapshotAt: new Date().toISOString() });
});

adminDiningRouter.patch("/kds/tickets/:ticketId/status", requireBranchRoles("MANAGER", "KITCHEN"), async (request, response) => {
  const auth = getAuthContext(request);
  const ticketId = idSchema.parse(request.params.ticketId);
  const input = ticketStatusSchema.parse(request.body);
  if (auth.role === "STAFF" && auth.branch.role === "KITCHEN") {
    const assigned = await database.kitchenTicket.findFirst({ where: { id: ticketId, tenantId: auth.tenant.id, branchId: auth.branch.id, stationId: auth.branch.stationId ?? "" }, select: { id: true } });
    if (!assigned) throw new HttpError(404, "Ticket no encontrado");
  }
  const existingEvent = await database.diningOrderAudit.findUnique({ where: { eventId: input.eventId } });
  if (existingEvent) {
    const current = await database.kitchenTicket.findFirst({ where: { id: ticketId, tenantId: auth.tenant.id, branchId: auth.branch.id }, include: { station: true, items: { include: { orderItem: true } } } });
    if (!current || existingEvent.entityId !== ticketId) throw new HttpError(409, "El evento ya fue utilizado");
    response.json({ ticket: current, idempotent: true });
    return;
  }
  const ticket = await database.$transaction(async (transaction) => {
    await transaction.$queryRaw`SELECT id FROM "KitchenTicket" WHERE id = ${ticketId} AND "tenantId" = ${auth.tenant.id} FOR UPDATE`;
    const current = await transaction.kitchenTicket.findFirst({ where: { id: ticketId, tenantId: auth.tenant.id, branchId: auth.branch.id }, include: { round: true } });
    if (!current) throw new HttpError(404, "Ticket no encontrado");
    const allowed: Record<string, string[]> = { PENDING: ["PREPARING", "CANCELLED"], PREPARING: ["READY", "CANCELLED"], READY: ["SERVED"], SERVED: [], CANCELLED: [] };
    if (current.status !== input.status && !allowed[current.status]?.includes(input.status)) throw new HttpError(409, "Transición de ticket no permitida");
    const now = new Date();
    const updated = await transaction.kitchenTicket.update({
      where: { id: current.id },
      data: {
        status: input.status, claimedByUserId: input.status === "PREPARING" ? auth.user.id : current.claimedByUserId,
        startedAt: input.status === "PREPARING" ? (current.startedAt ?? now) : undefined,
        readyAt: input.status === "READY" ? (current.readyAt ?? now) : undefined,
        servedAt: input.status === "SERVED" ? (current.servedAt ?? now) : undefined,
      },
      include: { station: true, items: { include: { orderItem: true } } },
    });
    await transaction.diningOrderAudit.create({ data: { eventId: input.eventId, tenantId: auth.tenant.id, branchId: auth.branch.id, orderId: current.round.orderId, actorUserId: auth.user.id, action: "TICKET_STATUS_CHANGED", entityType: "KitchenTicket", entityId: current.id, payload: { from: current.status, to: input.status } } });
    const remaining = await transaction.kitchenTicket.count({
      where: {
        tenantId: auth.tenant.id,
        round: { orderId: current.round.orderId },
        status: { notIn: input.status === "SERVED" ? ["SERVED", "CANCELLED"] : ["READY", "SERVED", "CANCELLED"] },
      },
    });
    if (remaining === 0) await transaction.order.update({ where: { id: current.round.orderId }, data: input.status === "SERVED" ? { diningStatus: "SERVED" } : { diningStatus: "READY", status: "READY_FOR_PICKUP" } });
    return updated;
  }, { isolationLevel: "Serializable" });
  emitDiningUpdate({ tenantId: auth.tenant.id, branchId: auth.branch.id, stationIds: [ticket.stationId], event: "kds:ticket-updated", payload: { ticketId: ticket.id, status: ticket.status } });
  response.json({ ticket, idempotent: false });
});
