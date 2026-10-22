import type { Prisma } from "@infinityshop/database";

import { HttpError } from "../errors.js";

type Transaction = Prisma.TransactionClient;
type OrderItemInput = { id: string; productId: string | null; quantity: number };

export async function ensureDefaultInventoryLocation(transaction: Transaction, tenantId: string, branchId: string) {
  const existing = await transaction.inventoryLocation.findFirst({
    where: { tenantId, branchId, isDefault: true, active: true },
    orderBy: { createdAt: "asc" },
  });
  if (existing) return existing;
  return transaction.inventoryLocation.create({
    data: { tenantId, branchId, code: "MAIN", name: "Depósito principal", isDefault: true },
  });
}

async function lockedStock(transaction: Transaction, tenantId: string, branchId: string, locationId: string, ingredientId: string) {
  await transaction.$queryRaw`SELECT "ingredientId" FROM "IngredientStock" WHERE "tenantId" = ${tenantId} AND "branchId" = ${branchId} AND "locationId" = ${locationId} AND "ingredientId" = ${ingredientId} FOR UPDATE`;
  return transaction.ingredientStock.findUnique({
    where: { tenantId_branchId_locationId_ingredientId: { tenantId, branchId, locationId, ingredientId } },
    include: { ingredient: { select: { name: true } } },
  });
}

export async function consumeRecipeForOrderItems(transaction: Transaction, input: {
  tenantId: string; branchId: string; orderId: string; userId?: string; items: OrderItemInput[];
}) {
  const productIds = [...new Set(input.items.flatMap((item) => item.productId ? [item.productId] : []))];
  if (!productIds.length) return [];
  const recipes = await transaction.recipeIngredient.findMany({
    where: { tenantId: input.tenantId, productId: { in: productIds } },
    include: { ingredient: { select: { name: true } } },
    orderBy: { ingredientId: "asc" },
  });
  if (!recipes.length) return [];
  const location = await ensureDefaultInventoryLocation(transaction, input.tenantId, input.branchId);
  const requirements = new Map<string, number>();
  for (const item of input.items) {
    for (const recipe of recipes.filter((entry) => entry.productId === item.productId)) {
      requirements.set(recipe.ingredientId, (requirements.get(recipe.ingredientId) ?? 0) + recipe.quantity * item.quantity);
    }
  }
  const stocks = new Map<string, Awaited<ReturnType<typeof lockedStock>>>();
  for (const ingredientId of [...requirements.keys()].sort()) {
    const stock = await lockedStock(transaction, input.tenantId, input.branchId, location.id, ingredientId);
    const required = requirements.get(ingredientId)!;
    if (!stock || stock.quantity < required) {
      const name = stock?.ingredient.name ?? recipes.find((entry) => entry.ingredientId === ingredientId)?.ingredient.name ?? "ingrediente";
      throw new HttpError(409, `Stock insuficiente de ${name}. Necesario: ${required}; disponible: ${stock?.quantity ?? 0}`);
    }
    stocks.set(ingredientId, stock);
  }
  const movements = [];
  for (const item of input.items) {
    for (const recipe of recipes.filter((entry) => entry.productId === item.productId)) {
      const stock = stocks.get(recipe.ingredientId)!;
      const delta = -(recipe.quantity * item.quantity);
      stock.quantity += delta;
      await transaction.ingredientStock.update({
        where: { tenantId_branchId_locationId_ingredientId: { tenantId: input.tenantId, branchId: input.branchId, locationId: location.id, ingredientId: recipe.ingredientId } },
        data: { quantity: stock.quantity },
      });
      movements.push(await transaction.ingredientMovement.create({
        data: {
          tenantId: input.tenantId, branchId: input.branchId, locationId: location.id, ingredientId: recipe.ingredientId,
          orderId: input.orderId, orderItemId: item.id, changedByUserId: input.userId, type: "SALE_CONSUMPTION",
          quantityDelta: delta, quantityAfter: stock.quantity,
          costTotalInCents: Math.round((-delta * stock.averageCostPerThousandCents) / 1000),
          clientRequestId: `consume:${item.id}:${recipe.ingredientId}`, note: "Consumo automático por venta",
        },
      }));
    }
  }
  return movements;
}

export async function reverseOrderIngredientConsumption(transaction: Transaction, input: {
  tenantId: string; branchId: string; orderId: string; userId?: string;
}) {
  const originals = await transaction.ingredientMovement.findMany({
    where: { tenantId: input.tenantId, branchId: input.branchId, orderId: input.orderId, type: "SALE_CONSUMPTION" },
    orderBy: [{ ingredientId: "asc" }, { createdAt: "asc" }],
  });
  for (const original of originals) {
    const clientRequestId = `reverse:${original.id}`;
    if (await transaction.ingredientMovement.findUnique({ where: { tenantId_clientRequestId: { tenantId: input.tenantId, clientRequestId } } })) continue;
    const stock = await lockedStock(transaction, input.tenantId, input.branchId, original.locationId, original.ingredientId);
    if (!stock) throw new HttpError(409, "No se pudo restaurar el stock de ingredientes");
    const quantity = stock.quantity - original.quantityDelta;
    await transaction.ingredientStock.update({
      where: { tenantId_branchId_locationId_ingredientId: { tenantId: input.tenantId, branchId: input.branchId, locationId: original.locationId, ingredientId: original.ingredientId } },
      data: { quantity },
    });
    await transaction.ingredientMovement.create({ data: {
      tenantId: input.tenantId, branchId: input.branchId, locationId: original.locationId, ingredientId: original.ingredientId,
      orderId: input.orderId, orderItemId: original.orderItemId, changedByUserId: input.userId, type: "SALE_REVERSAL",
      quantityDelta: -original.quantityDelta, quantityAfter: quantity, costTotalInCents: original.costTotalInCents,
      clientRequestId, note: "Reversión automática por anulación",
    } });
  }
}
