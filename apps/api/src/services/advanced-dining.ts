import { Prisma, type OrderAdjustmentType, type PrintJobStatus } from "@infinityshop/database";

import { database } from "../database.js";
import { HttpError } from "../errors.js";
import { posOrderSnapshot } from "./pos.js";

type Transaction = Prisma.TransactionClient;

export async function configureModifiers(input: {
  tenantId: string;
  branchId: string;
  productId: string;
  groups: Array<{
    name: string;
    minChoices: number;
    maxChoices: number;
    sortOrder: number;
    active: boolean;
    options: Array<{ name: string; priceInCents: number; sortOrder: number; active: boolean }>;
  }>;
}) {
  return database.$transaction(async (transaction) => {
    const menuItem = await transaction.branchMenuItem.findUnique({
      where: { tenantId_branchId_productId: { tenantId: input.tenantId, branchId: input.branchId, productId: input.productId } },
      select: { productId: true },
    });
    if (!menuItem) throw new HttpError(404, "Plato no encontrado en la carta de esta sucursal");
    await transaction.menuModifierGroup.deleteMany({
      where: { tenantId: input.tenantId, branchId: input.branchId, productId: input.productId },
    });
    for (const group of input.groups) {
      const createdGroup = await transaction.menuModifierGroup.create({
        data: {
          tenantId: input.tenantId,
          branchId: input.branchId,
          productId: input.productId,
          name: group.name,
          minChoices: group.minChoices,
          maxChoices: group.maxChoices,
          sortOrder: group.sortOrder,
          active: group.active,
        },
      });
      await transaction.menuModifierOption.createMany({
        data: group.options.map((option) => ({
          tenantId: input.tenantId,
          branchId: input.branchId,
          groupId: createdGroup.id,
          ...option,
        })),
      });
    }
    return transaction.menuModifierGroup.findMany({
      where: { tenantId: input.tenantId, branchId: input.branchId, productId: input.productId },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      include: { options: { orderBy: [{ sortOrder: "asc" }, { name: "asc" }] } },
    });
  });
}

export async function createTableGroup(input: {
  tenantId: string;
  branchId: string;
  userId: string;
  primaryTableId: string;
  tableIds: string[];
  label?: string | null;
}) {
  try {
    return await database.$transaction(async (transaction) => {
      await transaction.$queryRaw`SELECT "id" FROM "RestaurantTable" WHERE "tenantId" = ${input.tenantId} AND "branchId" = ${input.branchId} AND "id" IN (${Prisma.join(input.tableIds)}) FOR UPDATE`;
      const tables = await transaction.restaurantTable.findMany({
        where: { tenantId: input.tenantId, branchId: input.branchId, id: { in: input.tableIds }, status: "AVAILABLE" },
      });
      if (tables.length !== input.tableIds.length) throw new HttpError(409, "Una o más mesas no están disponibles en esta sucursal");
      const group = await transaction.diningTableGroup.create({
        data: {
          tenantId: input.tenantId,
          branchId: input.branchId,
          primaryTableId: input.primaryTableId,
          label: input.label || null,
          createdByUserId: input.userId,
        },
      });
      await transaction.diningTableGroupMember.createMany({
        data: input.tableIds.map((tableId) => ({
          tenantId: input.tenantId,
          branchId: input.branchId,
          groupId: group.id,
          tableId,
          activeKey: `${input.tenantId}:${input.branchId}:${tableId}`,
        })),
      });
      return transaction.diningTableGroup.findUniqueOrThrow({
        where: { id: group.id },
        include: { primaryTable: true, members: { include: { table: true } } },
      });
    }, { isolationLevel: "Serializable" });
  } catch (error) {
    if ((error as { code?: string }).code === "P2002") throw new HttpError(409, "Una de las mesas ya pertenece a otra unión activa");
    throw error;
  }
}

export async function closeTableGroup(input: { tenantId: string; branchId: string; groupId: string }) {
  return database.$transaction(async (transaction) => {
    const group = await transaction.diningTableGroup.findFirst({
      where: { id: input.groupId, tenantId: input.tenantId, branchId: input.branchId, closedAt: null },
    });
    if (!group) throw new HttpError(404, "Unión de mesas no encontrada");
    const now = new Date();
    await transaction.diningTableGroupMember.updateMany({
      where: { tenantId: input.tenantId, branchId: input.branchId, groupId: group.id, leftAt: null },
      data: { activeKey: null, leftAt: now },
    });
    return transaction.diningTableGroup.update({ where: { id: group.id }, data: { closedAt: now } });
  });
}

export async function transferDiningOrder(input: {
  tenantId: string;
  branchId: string;
  orderId: string;
  targetTableId: string;
  userId: string;
  eventId: string;
}) {
  const repeated = await database.diningOrderAudit.findUnique({ where: { eventId: input.eventId } });
  if (repeated) return { order: await posOrderSnapshot(input.tenantId, input.branchId, input.orderId), idempotent: true };
  try {
    const order = await database.$transaction(async (transaction) => {
      await transaction.$queryRaw`SELECT "id" FROM "Order" WHERE "tenantId" = ${input.tenantId} AND "branchId" = ${input.branchId} AND "id" = ${input.orderId} FOR UPDATE`;
      const [current, target] = await Promise.all([
        transaction.order.findFirst({ where: { id: input.orderId, tenantId: input.tenantId, branchId: input.branchId, diningStatus: { in: ["OPEN", "IN_PREPARATION", "READY", "SERVED"] } } }),
        transaction.restaurantTable.findFirst({ where: { id: input.targetTableId, tenantId: input.tenantId, branchId: input.branchId, status: "AVAILABLE" } }),
      ]);
      if (!current) throw new HttpError(409, "El pedido ya no puede transferirse");
      if (!target) throw new HttpError(404, "Mesa destino no encontrada o no disponible");
      const updated = await transaction.order.update({ where: { id: current.id }, data: { restaurantTableId: target.id } });
      await transaction.diningOrderAudit.create({
        data: {
          eventId: input.eventId, tenantId: input.tenantId, branchId: input.branchId, orderId: current.id,
          actorUserId: input.userId, action: "TABLE_TRANSFERRED", entityType: "RestaurantTable", entityId: target.id,
          payload: { fromTableId: current.restaurantTableId, toTableId: target.id },
        },
      });
      return updated;
    });
    return { order: await posOrderSnapshot(input.tenantId, input.branchId, order.id), idempotent: false };
  } catch (error) {
    const event = await database.diningOrderAudit.findUnique({ where: { eventId: input.eventId } });
    if (event?.orderId === input.orderId) return { order: await posOrderSnapshot(input.tenantId, input.branchId, input.orderId), idempotent: true };
    throw error;
  }
}

export async function addOrderAdjustment(input: {
  tenantId: string;
  branchId: string;
  orderId: string;
  userId: string;
  clientRequestId: string;
  type: OrderAdjustmentType;
  label: string;
  reason: string;
  amountInCents: number;
  orderItemId?: string | null;
}) {
  const existing = await database.orderAdjustment.findUnique({
    where: { tenantId_clientRequestId: { tenantId: input.tenantId, clientRequestId: input.clientRequestId } },
  });
  if (existing) return { adjustment: existing, order: await posOrderSnapshot(input.tenantId, input.branchId, input.orderId), created: false };
  try {
    const adjustment = await database.$transaction(async (transaction) => {
    await transaction.$queryRaw`SELECT "id" FROM "Order" WHERE "tenantId" = ${input.tenantId} AND "branchId" = ${input.branchId} AND "id" = ${input.orderId} FOR UPDATE`;
    const order = await transaction.order.findFirst({
      where: { id: input.orderId, tenantId: input.tenantId, branchId: input.branchId, diningStatus: { notIn: ["CANCELLED", "CLOSED"] } },
      include: { operationalPayments: { select: { kind: true, amountInCents: true } } },
    });
    if (!order) throw new HttpError(404, "Pedido no encontrado o cerrado");
    if (input.orderItemId) {
      const item = await transaction.orderItem.findFirst({ where: { id: input.orderItemId, tenantId: input.tenantId, orderId: order.id } });
      if (!item) throw new HttpError(404, "Ítem del pedido no encontrado");
      if (input.type === "COMPLIMENT" && input.amountInCents > item.subtotalInCents) throw new HttpError(409, "La cortesía supera el subtotal del ítem");
    }
    const paid = order.operationalPayments.reduce((sum, payment) => sum + (payment.kind === "REFUND" ? -payment.amountInCents : payment.amountInCents), 0);
    const delta = input.type === "TIP" ? input.amountInCents : -input.amountInCents;
    const nextTotal = order.totalInCents + delta;
    if (nextTotal < 0 || nextTotal < paid) throw new HttpError(409, "El ajuste dejaría el total por debajo de lo ya cobrado");
    const created = await transaction.orderAdjustment.create({
      data: {
        tenantId: input.tenantId,
        branchId: input.branchId,
        orderId: input.orderId,
        orderItemId: input.orderItemId || null,
        clientRequestId: input.clientRequestId,
        type: input.type,
        label: input.label,
        reason: input.reason,
        amountInCents: input.amountInCents,
        createdByUserId: input.userId,
      },
    });
    await transaction.order.update({
      where: { id: order.id },
      data: {
        totalInCents: nextTotal,
        discountInCents: input.type === "TIP" ? undefined : { increment: input.amountInCents },
      },
    });
    await transaction.diningOrderAudit.create({
      data: {
        eventId: input.clientRequestId, tenantId: input.tenantId, branchId: input.branchId, orderId: order.id,
        actorUserId: input.userId, action: "ORDER_ADJUSTED", entityType: "OrderAdjustment", entityId: created.id,
        payload: { type: input.type, amountInCents: input.amountInCents, reason: input.reason, orderItemId: input.orderItemId ?? null },
      },
    });
    return created;
    }, { isolationLevel: "Serializable" });
    return { adjustment, order: await posOrderSnapshot(input.tenantId, input.branchId, input.orderId), created: true };
  } catch (error) {
    const repeated = await database.orderAdjustment.findUnique({ where: { tenantId_clientRequestId: { tenantId: input.tenantId, clientRequestId: input.clientRequestId } } });
    if (repeated?.orderId === input.orderId) return { adjustment: repeated, order: await posOrderSnapshot(input.tenantId, input.branchId, input.orderId), created: false };
    throw error;
  }
}

export async function createReceiptPrintJob(input: {
  tenantId: string;
  branchId: string;
  orderId: string;
  clientRequestId: string;
}) {
  const existing = await database.printJob.findUnique({ where: { tenantId_clientRequestId: { tenantId: input.tenantId, clientRequestId: input.clientRequestId } } });
  if (existing) return { job: existing, created: false };
  const order = await database.order.findFirst({
    where: { id: input.orderId, tenantId: input.tenantId, branchId: input.branchId },
    include: {
      restaurantTable: true,
      items: { include: { modifiers: true } },
      adjustments: true,
      operationalPayments: true,
    },
  });
  if (!order) throw new HttpError(404, "Pedido no encontrado");
  try {
    const job = await database.printJob.create({
      data: {
        tenantId: input.tenantId, branchId: input.branchId, orderId: order.id,
        clientRequestId: input.clientRequestId, type: "RECEIPT",
        payload: {
          orderNumber: order.number, table: order.restaurantTable?.name ?? "Mostrador", customerName: order.customerName,
          items: order.items.map((item) => ({ name: item.productName, quantity: item.quantity, subtotalInCents: item.subtotalInCents, modifiers: item.modifiers.map((modifier) => modifier.optionName) })),
          adjustments: order.adjustments.map((adjustment) => ({ type: adjustment.type, label: adjustment.label, amountInCents: adjustment.amountInCents })),
          totalInCents: order.totalInCents,
        },
      },
    });
    return { job, created: true };
  } catch (error) {
    const repeated = await database.printJob.findUnique({ where: { tenantId_clientRequestId: { tenantId: input.tenantId, clientRequestId: input.clientRequestId } } });
    if (repeated?.orderId === input.orderId && repeated.type === "RECEIPT") return { job: repeated, created: false };
    throw error;
  }
}

export async function claimPrintJob(input: { tenantId: string; branchId: string; jobId: string; userId: string }) {
  const claimed = await database.printJob.updateMany({
    where: { id: input.jobId, tenantId: input.tenantId, branchId: input.branchId, status: "PENDING" },
    data: { status: "CLAIMED", claimedByUserId: input.userId, claimedAt: new Date(), attempts: { increment: 1 }, error: null },
  });
  if (!claimed.count) throw new HttpError(409, "El trabajo ya fue tomado o no existe");
  return database.printJob.findUniqueOrThrow({ where: { id: input.jobId } });
}

export async function completePrintJob(input: {
  tenantId: string;
  branchId: string;
  jobId: string;
  userId: string;
  status: Extract<PrintJobStatus, "PRINTED" | "FAILED">;
  error?: string | null;
}) {
  const updated = await database.printJob.updateMany({
    where: { id: input.jobId, tenantId: input.tenantId, branchId: input.branchId, status: "CLAIMED", claimedByUserId: input.userId },
    data: { status: input.status, error: input.error || null, completedAt: new Date() },
  });
  if (!updated.count) throw new HttpError(409, "El trabajo no está tomado por este usuario");
  return database.printJob.findUniqueOrThrow({ where: { id: input.jobId } });
}
