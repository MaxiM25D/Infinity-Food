import { createHash } from "node:crypto";

import type { Prisma } from "@infinityshop/database";

import { database } from "../database.js";
import { HttpError } from "../errors.js";

type DiningItemInput = { productId: string; quantity: number; notes?: string | null };
type Transaction = Prisma.TransactionClient;

function accessHash(tenantId: string, token: string): string {
  return createHash("sha256").update(`${tenantId}:${token}`).digest("hex");
}

export function diningOrderTokenMatches(tenantId: string, token: string, expected: string | null): boolean {
  return Boolean(expected && accessHash(tenantId, token) === expected);
}

export async function diningOrderSnapshot(tenantId: string, branchId: string, orderId: string) {
  return database.order.findFirst({
    where: { id: orderId, tenantId, branchId, diningStatus: { not: null } },
    include: {
      restaurantTable: { select: { id: true, code: true, name: true } },
      rounds: {
        orderBy: { number: "asc" },
        include: {
          items: { orderBy: { createdAt: "asc" } },
          tickets: {
            orderBy: { createdAt: "asc" },
            include: { station: true, items: { include: { orderItem: true } } },
          },
        },
      },
      diningAudits: { orderBy: { createdAt: "asc" } },
    },
  });
}

async function createRound(
  transaction: Transaction,
  input: { tenantId: string; branchId: string; orderId: string; clientRequestId: string; items: DiningItemInput[]; userId?: string },
) {
  const existing = await transaction.orderRound.findUnique({
    where: { tenantId_clientRequestId: { tenantId: input.tenantId, clientRequestId: input.clientRequestId } },
    select: { id: true, orderId: true },
  });
  if (existing) {
    if (existing.orderId !== input.orderId) throw new HttpError(409, "El identificador de envío ya fue utilizado");
    return { roundId: existing.id, created: false };
  }

  await transaction.$queryRaw`SELECT id FROM "Order" WHERE id = ${input.orderId} AND "tenantId" = ${input.tenantId} FOR UPDATE`;
  const order = await transaction.order.findFirst({
    where: { id: input.orderId, tenantId: input.tenantId, branchId: input.branchId, diningStatus: { in: ["OPEN", "IN_PREPARATION", "READY", "SERVED"] } },
    select: { id: true },
  });
  if (!order) throw new HttpError(409, "El pedido ya no acepta nuevas rondas");

  const productIds = [...new Set(input.items.map(({ productId }) => productId))];
  const menuItems = await transaction.branchMenuItem.findMany({
    where: {
      tenantId: input.tenantId,
      branchId: input.branchId,
      productId: { in: productIds },
      availability: "AVAILABLE",
      product: { active: true },
    },
    include: {
      product: { include: { stationAssignments: { where: { branchId: input.branchId }, include: { station: true } } } },
    },
  });
  if (menuItems.length !== productIds.length) throw new HttpError(409, "Uno o más platos ya no están disponibles");
  const defaultStation = await transaction.kitchenStation.findFirst({
    where: { tenantId: input.tenantId, branchId: input.branchId, active: true },
    orderBy: [{ displayOrder: "asc" }, { createdAt: "asc" }],
  });
  if (!defaultStation) throw new HttpError(409, "Configurá al menos una estación de preparación");

  const previousRound = await transaction.orderRound.findFirst({
    where: { tenantId: input.tenantId, orderId: input.orderId },
    orderBy: { number: "desc" },
    select: { number: true },
  });
  const round = await transaction.orderRound.create({
    data: {
      tenantId: input.tenantId,
      branchId: input.branchId,
      orderId: input.orderId,
      number: (previousRound?.number ?? 0) + 1,
      clientRequestId: input.clientRequestId,
      submittedByUserId: input.userId,
    },
  });

  const menuByProduct = new Map(menuItems.map((item) => [item.productId, item]));
  const ticketItems = new Map<string, string[]>();
  let subtotal = 0;
  for (const requested of input.items) {
    const menuItem = menuByProduct.get(requested.productId)!;
    const unitPriceInCents = menuItem.priceOverrideInCents ?? menuItem.product.priceInCents;
    const item = await transaction.orderItem.create({
      data: {
        tenantId: input.tenantId,
        orderId: input.orderId,
        roundId: round.id,
        productId: menuItem.productId,
        sku: menuItem.product.sku,
        productName: menuItem.product.name,
        quantity: requested.quantity,
        unitPriceInCents,
        subtotalInCents: unitPriceInCents * requested.quantity,
        notes: requested.notes || null,
      },
    });
    subtotal += item.subtotalInCents;
    const assignment = menuItem.product.stationAssignments[0];
    const station = assignment?.station.active ? assignment.station : defaultStation;
    ticketItems.set(station.id, [...(ticketItems.get(station.id) ?? []), item.id]);
  }

  for (const [stationId, itemIds] of ticketItems) {
    const ticket = await transaction.kitchenTicket.create({
      data: { tenantId: input.tenantId, branchId: input.branchId, roundId: round.id, stationId },
    });
    await transaction.kitchenTicketItem.createMany({
      data: itemIds.map((orderItemId) => ({ tenantId: input.tenantId, ticketId: ticket.id, orderItemId })),
    });
    await transaction.diningOrderAudit.create({
      data: {
        tenantId: input.tenantId, branchId: input.branchId, orderId: input.orderId, actorUserId: input.userId,
        action: "TICKET_CREATED", entityType: "KitchenTicket", entityId: ticket.id,
        payload: { stationId, roundId: round.id, itemCount: itemIds.length },
      },
    });
  }

  await transaction.order.update({
    where: { id: input.orderId },
    data: {
      subtotalInCents: { increment: subtotal }, totalInCents: { increment: subtotal },
      diningStatus: "IN_PREPARATION", status: "PREPARING",
    },
  });
  await transaction.diningOrderAudit.create({
    data: {
      tenantId: input.tenantId, branchId: input.branchId, orderId: input.orderId, actorUserId: input.userId,
      action: "ROUND_SUBMITTED", entityType: "OrderRound", entityId: round.id,
      payload: { number: round.number, ticketCount: ticketItems.size, itemCount: input.items.length },
    },
  });
  return { roundId: round.id, created: true };
}

export async function createDiningOrder(input: {
  tenantId: string; branchId: string; tableId?: string; source: "QR" | "WAITER" | "POS"; clientRequestId: string;
  customerName: string; customerPhone?: string | null; notes?: string | null; items: DiningItemInput[]; userId?: string;
}) {
  const existingRound = await database.orderRound.findUnique({
    where: { tenantId_clientRequestId: { tenantId: input.tenantId, clientRequestId: input.clientRequestId } },
    select: { orderId: true },
  });
  if (existingRound) {
    const order = await diningOrderSnapshot(input.tenantId, input.branchId, existingRound.orderId);
    if (!order) throw new HttpError(409, "El identificador de envío pertenece a otro pedido");
    return { order, orderToken: input.clientRequestId, created: false };
  }

  let orderId = "";
  try {
    await database.$transaction(async (transaction) => {
      await transaction.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtext(${input.tenantId}))`;
      const table = input.tableId ? await transaction.restaurantTable.findFirst({
        where: { id: input.tableId, tenantId: input.tenantId, branchId: input.branchId, status: "AVAILABLE" },
      }) : null;
      if (input.tableId && !table) throw new HttpError(404, "Mesa no encontrada o no disponible");
      if (!input.tableId && input.source !== "POS") throw new HttpError(400, "Seleccioná una mesa para abrir el pedido");
      const latest = await transaction.order.findFirst({ where: { tenantId: input.tenantId }, orderBy: { number: "desc" }, select: { number: true } });
      const created = await transaction.order.create({
        data: {
          tenantId: input.tenantId, branchId: input.branchId, restaurantTableId: table?.id ?? null,
          number: (latest?.number ?? 0) + 1, channel: "LOCAL", status: "CONFIRMED",
          paymentStatus: "PENDING", paymentMethod: "CASH", stockStatus: "COMMITTED",
          publicTokenHash: accessHash(input.tenantId, input.clientRequestId),
          customerEmail: `mesa-${accessHash(input.tenantId, input.clientRequestId).slice(0, 16)}@invalid.local`,
          customerName: input.customerName, customerPhone: input.customerPhone, notes: input.notes,
          currency: "ARS", subtotalInCents: 0, totalInCents: 0, fulfillmentType: "PICKUP",
          diningSource: input.source, diningStatus: "OPEN", openedByUserId: input.userId, diningOpenedAt: new Date(),
        },
      });
      orderId = created.id;
      await transaction.diningOrderAudit.create({
        data: { tenantId: input.tenantId, branchId: input.branchId, orderId, actorUserId: input.userId, action: "ORDER_OPENED", entityType: "Order", entityId: orderId, payload: { source: input.source, tableId: table?.id ?? null } },
      });
      await createRound(transaction, { ...input, orderId });
    }, { isolationLevel: "Serializable" });
  } catch (error) {
    const duplicate = await database.orderRound.findUnique({
      where: { tenantId_clientRequestId: { tenantId: input.tenantId, clientRequestId: input.clientRequestId } },
      select: { orderId: true },
    });
    if (!duplicate) throw error;
    orderId = duplicate.orderId;
  }
  const order = await diningOrderSnapshot(input.tenantId, input.branchId, orderId);
  return { order, orderToken: input.clientRequestId, created: true };
}

export async function appendDiningRound(input: {
  tenantId: string; branchId: string; orderId: string; clientRequestId: string; items: DiningItemInput[]; userId?: string;
}) {
  try {
    await database.$transaction((transaction) => createRound(transaction, input), { isolationLevel: "Serializable" });
  } catch (error) {
    const duplicate = await database.orderRound.findUnique({ where: { tenantId_clientRequestId: { tenantId: input.tenantId, clientRequestId: input.clientRequestId } } });
    if (!duplicate || duplicate.orderId !== input.orderId) throw error;
  }
  return diningOrderSnapshot(input.tenantId, input.branchId, input.orderId);
}
