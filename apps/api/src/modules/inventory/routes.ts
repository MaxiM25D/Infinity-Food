import { Router } from "express";

import { database } from "../../database.js";
import { HttpError } from "../../errors.js";
import { getAuthContext, requireBranchRoles, requireSession } from "../auth/session.js";
import { requireWritableSubscription } from "../saas/limits.js";
import { ensureDefaultInventoryLocation } from "../../services/inventory.js";
import { idSchema, ingredientSchema, locationSchema, purchaseOrderSchema, receiptSchema, recipeSchema, stockSchema, supplierSchema, transferSchema, wasteSchema } from "./schemas.js";

export const inventoryRouter = Router();
inventoryRouter.use(requireSession, requireBranchRoles("MANAGER"));
inventoryRouter.use((request, response, next) => {
  if (["POST", "PUT", "PATCH", "DELETE"].includes(request.method)) return void requireWritableSubscription(request, response, next);
  next();
});

inventoryRouter.get("/overview", async (request, response) => {
  const auth = getAuthContext(request);
  await database.$transaction((transaction) => ensureDefaultInventoryLocation(transaction, auth.tenant.id, auth.branch.id));
  const [locations, ingredients, products, suppliers, purchaseOrders, movements] = await Promise.all([
    database.inventoryLocation.findMany({ where: { tenantId: auth.tenant.id, branchId: auth.branch.id, active: true }, orderBy: [{ isDefault: "desc" }, { name: "asc" }] }),
    database.ingredient.findMany({ where: { tenantId: auth.tenant.id, active: true }, orderBy: { name: "asc" }, include: { stocks: { where: { branchId: auth.branch.id }, include: { location: { select: { name: true } } } } } }),
    database.product.findMany({ where: { tenantId: auth.tenant.id, active: true }, orderBy: { name: "asc" }, select: { id: true, name: true, sku: true, priceInCents: true, recipeIngredients: { include: { ingredient: { select: { name: true, unit: true, stocks: { where: { branchId: auth.branch.id } } } } } } } }),
    database.supplier.findMany({ where: { tenantId: auth.tenant.id, active: true }, orderBy: { name: "asc" } }),
    database.purchaseOrder.findMany({ where: { tenantId: auth.tenant.id, branchId: auth.branch.id }, orderBy: { createdAt: "desc" }, take: 30, include: { supplier: { select: { name: true } }, location: { select: { name: true } }, items: { include: { ingredient: { select: { name: true, unit: true } } } } } }),
    database.ingredientMovement.findMany({ where: { tenantId: auth.tenant.id, branchId: auth.branch.id }, orderBy: { createdAt: "desc" }, take: 50, include: { ingredient: { select: { name: true, unit: true } }, location: { select: { name: true } } } }),
  ]);
  const productsWithCosts = products.map((product) => {
    const costInCents = product.recipeIngredients.reduce((sum, recipe) => {
      const stock = recipe.ingredient.stocks.find((entry) => locations.some((location) => location.id === entry.locationId && location.isDefault));
      return sum + Math.round(recipe.quantity * (stock?.averageCostPerThousandCents ?? 0) / 1000);
    }, 0);
    return { ...product, costInCents, marginInCents: product.priceInCents - costInCents, marginPercentage: product.priceInCents ? Math.round(((product.priceInCents - costInCents) / product.priceInCents) * 10_000) / 100 : 0 };
  });
  response.json({ locations, ingredients, products: productsWithCosts, suppliers, purchaseOrders, movements });
});

inventoryRouter.post("/locations", async (request, response) => {
  const auth = getAuthContext(request); const input = locationSchema.parse(request.body);
  const location = await database.$transaction(async (transaction) => {
    if (input.isDefault) await transaction.inventoryLocation.updateMany({ where: { tenantId: auth.tenant.id, branchId: auth.branch.id, isDefault: true }, data: { isDefault: false } });
    return transaction.inventoryLocation.create({ data: { tenantId: auth.tenant.id, branchId: auth.branch.id, ...input, code: input.code.toUpperCase() } });
  });
  response.status(201).json({ location });
});

inventoryRouter.post("/ingredients", async (request, response) => {
  const auth = getAuthContext(request); const input = ingredientSchema.parse(request.body);
  const ingredient = await database.ingredient.create({ data: { tenantId: auth.tenant.id, ...input, code: input.code.toUpperCase() } });
  response.status(201).json({ ingredient });
});

inventoryRouter.put("/ingredients/:ingredientId/stocks/:locationId", async (request, response) => {
  const auth = getAuthContext(request); const ingredientId = idSchema.parse(request.params.ingredientId); const locationId = idSchema.parse(request.params.locationId); const input = stockSchema.parse(request.body);
  const movement = await database.$transaction(async (transaction) => {
    const [ingredient, location] = await Promise.all([
      transaction.ingredient.findFirst({ where: { id: ingredientId, tenantId: auth.tenant.id, active: true } }),
      transaction.inventoryLocation.findFirst({ where: { id: locationId, tenantId: auth.tenant.id, branchId: auth.branch.id, active: true } }),
    ]);
    if (!ingredient || !location) throw new HttpError(404, "Ingrediente o depósito no encontrado");
    await transaction.$queryRaw`SELECT "ingredientId" FROM "IngredientStock" WHERE "tenantId" = ${auth.tenant.id} AND "branchId" = ${auth.branch.id} AND "locationId" = ${locationId} AND "ingredientId" = ${ingredientId} FOR UPDATE`;
    const previous = await transaction.ingredientStock.findUnique({ where: { tenantId_branchId_locationId_ingredientId: { tenantId: auth.tenant.id, branchId: auth.branch.id, locationId, ingredientId } } });
    const stock = await transaction.ingredientStock.upsert({
      where: { tenantId_branchId_locationId_ingredientId: { tenantId: auth.tenant.id, branchId: auth.branch.id, locationId, ingredientId } },
      update: { quantity: input.quantity, reorderPoint: input.reorderPoint, averageCostPerThousandCents: input.averageCostPerThousandCents },
      create: { tenantId: auth.tenant.id, branchId: auth.branch.id, locationId, ingredientId, quantity: input.quantity, reorderPoint: input.reorderPoint, averageCostPerThousandCents: input.averageCostPerThousandCents },
    });
    return transaction.ingredientMovement.create({ data: { tenantId: auth.tenant.id, branchId: auth.branch.id, locationId, ingredientId, changedByUserId: auth.user.id, type: "MANUAL_ADJUSTMENT", quantityDelta: input.quantity - (previous?.quantity ?? 0), quantityAfter: stock.quantity, note: input.note } });
  });
  response.json({ movement });
});

inventoryRouter.post("/ingredients/:ingredientId/waste", async (request, response) => {
  const auth = getAuthContext(request); const ingredientId = idSchema.parse(request.params.ingredientId); const input = wasteSchema.parse(request.body);
  const movement = await database.$transaction(async (transaction) => {
    const existing = await transaction.ingredientMovement.findUnique({ where: { tenantId_clientRequestId: { tenantId: auth.tenant.id, clientRequestId: input.clientRequestId } } });
    if (existing) return existing;
    await transaction.$queryRaw`SELECT "ingredientId" FROM "IngredientStock" WHERE "tenantId" = ${auth.tenant.id} AND "branchId" = ${auth.branch.id} AND "locationId" = ${input.locationId} AND "ingredientId" = ${ingredientId} FOR UPDATE`;
    const stock = await transaction.ingredientStock.findUnique({ where: { tenantId_branchId_locationId_ingredientId: { tenantId: auth.tenant.id, branchId: auth.branch.id, locationId: input.locationId, ingredientId } } });
    if (!stock || stock.quantity < input.quantity) throw new HttpError(409, "Stock insuficiente para registrar la merma");
    const quantityAfter = stock.quantity - input.quantity;
    await transaction.ingredientStock.update({ where: { tenantId_branchId_locationId_ingredientId: { tenantId: auth.tenant.id, branchId: auth.branch.id, locationId: input.locationId, ingredientId } }, data: { quantity: quantityAfter } });
    return transaction.ingredientMovement.create({ data: { tenantId: auth.tenant.id, branchId: auth.branch.id, locationId: input.locationId, ingredientId, changedByUserId: auth.user.id, type: "WASTE", quantityDelta: -input.quantity, quantityAfter, costTotalInCents: Math.round(input.quantity * stock.averageCostPerThousandCents / 1000), clientRequestId: input.clientRequestId, note: input.note } });
  }, { isolationLevel: "Serializable" });
  response.status(201).json({ movement });
});

inventoryRouter.post("/transfers", async (request, response) => {
  const auth = getAuthContext(request); const input = transferSchema.parse(request.body);
  const result = await database.$transaction(async (transaction) => {
    const duplicate = await transaction.ingredientMovement.findUnique({ where: { tenantId_clientRequestId: { tenantId: auth.tenant.id, clientRequestId: `${input.clientRequestId}:out` } } });
    if (duplicate) return { transferred: true, duplicate: true };
    const locations = await transaction.inventoryLocation.count({ where: { id: { in: [input.fromLocationId, input.toLocationId] }, tenantId: auth.tenant.id, branchId: auth.branch.id, active: true } });
    if (locations !== 2) throw new HttpError(404, "Depósito no encontrado");
    for (const locationId of [input.fromLocationId, input.toLocationId].sort()) await transaction.$queryRaw`SELECT "ingredientId" FROM "IngredientStock" WHERE "tenantId" = ${auth.tenant.id} AND "branchId" = ${auth.branch.id} AND "locationId" = ${locationId} AND "ingredientId" = ${input.ingredientId} FOR UPDATE`;
    const source = await transaction.ingredientStock.findUnique({ where: { tenantId_branchId_locationId_ingredientId: { tenantId: auth.tenant.id, branchId: auth.branch.id, locationId: input.fromLocationId, ingredientId: input.ingredientId } } });
    if (!source || source.quantity < input.quantity) throw new HttpError(409, "Stock insuficiente para transferir");
    const sourceAfter = source.quantity - input.quantity;
    const previousTarget = await transaction.ingredientStock.findUnique({ where: { tenantId_branchId_locationId_ingredientId: { tenantId: auth.tenant.id, branchId: auth.branch.id, locationId: input.toLocationId, ingredientId: input.ingredientId } } });
    const targetQuantity = (previousTarget?.quantity ?? 0) + input.quantity;
    const targetAverage = Math.round((((previousTarget?.quantity ?? 0) * (previousTarget?.averageCostPerThousandCents ?? 0)) + (input.quantity * source.averageCostPerThousandCents)) / targetQuantity);
    const target = await transaction.ingredientStock.upsert({ where: { tenantId_branchId_locationId_ingredientId: { tenantId: auth.tenant.id, branchId: auth.branch.id, locationId: input.toLocationId, ingredientId: input.ingredientId } }, update: { quantity: targetQuantity, averageCostPerThousandCents: targetAverage }, create: { tenantId: auth.tenant.id, branchId: auth.branch.id, locationId: input.toLocationId, ingredientId: input.ingredientId, quantity: targetQuantity, averageCostPerThousandCents: targetAverage } });
    await transaction.ingredientStock.update({ where: { tenantId_branchId_locationId_ingredientId: { tenantId: auth.tenant.id, branchId: auth.branch.id, locationId: input.fromLocationId, ingredientId: input.ingredientId } }, data: { quantity: sourceAfter } });
    await transaction.ingredientMovement.createMany({ data: [
      { tenantId: auth.tenant.id, branchId: auth.branch.id, locationId: input.fromLocationId, ingredientId: input.ingredientId, changedByUserId: auth.user.id, type: "TRANSFER_OUT", quantityDelta: -input.quantity, quantityAfter: sourceAfter, clientRequestId: `${input.clientRequestId}:out`, note: input.note },
      { tenantId: auth.tenant.id, branchId: auth.branch.id, locationId: input.toLocationId, ingredientId: input.ingredientId, changedByUserId: auth.user.id, type: "TRANSFER_IN", quantityDelta: input.quantity, quantityAfter: target.quantity, clientRequestId: `${input.clientRequestId}:in`, note: input.note },
    ] });
    return { transferred: true, duplicate: false };
  }, { isolationLevel: "Serializable" });
  response.status(201).json(result);
});

inventoryRouter.put("/recipes/:productId", async (request, response) => {
  const auth = getAuthContext(request); const productId = idSchema.parse(request.params.productId); const input = recipeSchema.parse(request.body);
  if (new Set(input.ingredients.map((item) => item.ingredientId)).size !== input.ingredients.length) throw new HttpError(400, "No repitas ingredientes en la receta");
  await database.$transaction(async (transaction) => {
    const [product, count] = await Promise.all([transaction.product.findFirst({ where: { id: productId, tenantId: auth.tenant.id } }), transaction.ingredient.count({ where: { tenantId: auth.tenant.id, id: { in: input.ingredients.map((item) => item.ingredientId) }, active: true } })]);
    if (!product) throw new HttpError(404, "Producto no encontrado");
    if (count !== input.ingredients.length) throw new HttpError(404, "Uno o más ingredientes no existe");
    await transaction.recipeIngredient.deleteMany({ where: { tenantId: auth.tenant.id, productId } });
    if (input.ingredients.length) await transaction.recipeIngredient.createMany({ data: input.ingredients.map((item) => ({ tenantId: auth.tenant.id, productId, ...item })) });
  });
  response.json({ updated: true });
});

inventoryRouter.post("/suppliers", async (request, response) => {
  const auth = getAuthContext(request); const input = supplierSchema.parse(request.body);
  const supplier = await database.supplier.create({ data: { tenantId: auth.tenant.id, ...input } });
  response.status(201).json({ supplier });
});

inventoryRouter.post("/purchase-orders", async (request, response) => {
  const auth = getAuthContext(request); const input = purchaseOrderSchema.parse(request.body);
  if (new Set(input.items.map((item) => item.ingredientId)).size !== input.items.length) throw new HttpError(400, "No repitas ingredientes en la compra");
  const purchaseOrder = await database.$transaction(async (transaction) => {
    await transaction.$queryRaw`SELECT "id" FROM "Branch" WHERE "tenantId" = ${auth.tenant.id} AND "id" = ${auth.branch.id} FOR UPDATE`;
    const [supplier, location, ingredientCount, latest] = await Promise.all([
      transaction.supplier.findFirst({ where: { id: input.supplierId, tenantId: auth.tenant.id, active: true } }),
      transaction.inventoryLocation.findFirst({ where: { id: input.locationId, tenantId: auth.tenant.id, branchId: auth.branch.id, active: true } }),
      transaction.ingredient.count({ where: { tenantId: auth.tenant.id, id: { in: input.items.map((item) => item.ingredientId) }, active: true } }),
      transaction.purchaseOrder.findFirst({ where: { tenantId: auth.tenant.id, branchId: auth.branch.id }, orderBy: { number: "desc" }, select: { number: true } }),
    ]);
    if (!supplier || !location || ingredientCount !== input.items.length) throw new HttpError(404, "Proveedor, depósito o ingrediente no encontrado");
    const created = await transaction.purchaseOrder.create({ data: { tenantId: auth.tenant.id, branchId: auth.branch.id, locationId: input.locationId, supplierId: input.supplierId, number: (latest?.number ?? 0) + 1, status: "ORDERED", expectedAt: input.expectedAt, notes: input.notes, createdByUserId: auth.user.id } });
    await transaction.purchaseOrderItem.createMany({ data: input.items.map((item) => ({ tenantId: auth.tenant.id, purchaseOrderId: created.id, ...item })) });
    return transaction.purchaseOrder.findUniqueOrThrow({ where: { tenantId_id: { tenantId: auth.tenant.id, id: created.id } }, include: { items: true } });
  }, { isolationLevel: "Serializable" });
  response.status(201).json({ purchaseOrder });
});

inventoryRouter.post("/purchase-orders/:id/receipts", async (request, response) => {
  const auth = getAuthContext(request); const id = idSchema.parse(request.params.id); const input = receiptSchema.parse(request.body);
  const receipt = await database.$transaction(async (transaction) => {
    const duplicate = await transaction.purchaseReceipt.findUnique({ where: { tenantId_clientRequestId: { tenantId: auth.tenant.id, clientRequestId: input.clientRequestId } }, include: { items: true } });
    if (duplicate) return duplicate;
    await transaction.$queryRaw`SELECT "id" FROM "PurchaseOrder" WHERE "tenantId" = ${auth.tenant.id} AND "branchId" = ${auth.branch.id} AND "id" = ${id} FOR UPDATE`;
    const order = await transaction.purchaseOrder.findFirst({ where: { id, tenantId: auth.tenant.id, branchId: auth.branch.id, status: { in: ["ORDERED", "PARTIALLY_RECEIVED"] } }, include: { items: true } });
    if (!order) throw new HttpError(409, "La orden de compra no acepta recepciones");
    const requested = new Map(input.items.map((item) => [item.purchaseOrderItemId, item.quantity]));
    if (requested.size !== input.items.length) throw new HttpError(400, "No repitas ítems de compra");
    for (const [itemId, quantity] of requested) {
      const item = order.items.find((entry) => entry.id === itemId);
      if (!item) throw new HttpError(404, "Ítem de compra no encontrado");
      if (item.receivedQuantity + quantity > item.orderedQuantity) throw new HttpError(409, "La recepción supera la cantidad pendiente");
    }
    const created = await transaction.purchaseReceipt.create({ data: { tenantId: auth.tenant.id, branchId: auth.branch.id, locationId: order.locationId, purchaseOrderId: order.id, clientRequestId: input.clientRequestId, receivedByUserId: auth.user.id, note: input.note } });
    for (const [itemId, quantity] of requested) {
      const item = order.items.find((entry) => entry.id === itemId)!;
      await transaction.$queryRaw`SELECT "ingredientId" FROM "IngredientStock" WHERE "tenantId" = ${auth.tenant.id} AND "branchId" = ${auth.branch.id} AND "locationId" = ${order.locationId} AND "ingredientId" = ${item.ingredientId} FOR UPDATE`;
      const old = await transaction.ingredientStock.findUnique({ where: { tenantId_branchId_locationId_ingredientId: { tenantId: auth.tenant.id, branchId: auth.branch.id, locationId: order.locationId, ingredientId: item.ingredientId } } });
      const oldValue = Math.round((old?.quantity ?? 0) * (old?.averageCostPerThousandCents ?? 0) / 1000);
      const receivedValue = Math.round(quantity * item.unitCostPerThousandInCents / 1000);
      const quantityAfter = (old?.quantity ?? 0) + quantity;
      const averageCostPerThousandCents = quantityAfter ? Math.round((oldValue + receivedValue) * 1000 / quantityAfter) : 0;
      await transaction.ingredientStock.upsert({ where: { tenantId_branchId_locationId_ingredientId: { tenantId: auth.tenant.id, branchId: auth.branch.id, locationId: order.locationId, ingredientId: item.ingredientId } }, update: { quantity: quantityAfter, averageCostPerThousandCents }, create: { tenantId: auth.tenant.id, branchId: auth.branch.id, locationId: order.locationId, ingredientId: item.ingredientId, quantity: quantityAfter, averageCostPerThousandCents } });
      await transaction.purchaseReceiptItem.create({ data: { tenantId: auth.tenant.id, receiptId: created.id, purchaseOrderItemId: item.id, ingredientId: item.ingredientId, quantity, costInCents: receivedValue } });
      await transaction.purchaseOrderItem.update({ where: { tenantId_id: { tenantId: auth.tenant.id, id: item.id } }, data: { receivedQuantity: { increment: quantity } } });
      await transaction.ingredientMovement.create({ data: { tenantId: auth.tenant.id, branchId: auth.branch.id, locationId: order.locationId, ingredientId: item.ingredientId, purchaseReceiptId: created.id, changedByUserId: auth.user.id, type: "PURCHASE_RECEIPT", quantityDelta: quantity, quantityAfter, costTotalInCents: receivedValue, clientRequestId: `receipt:${created.id}:${item.id}`, note: `Recepción OC #${order.number}` } });
    }
    const refreshed = await transaction.purchaseOrderItem.findMany({ where: { tenantId: auth.tenant.id, purchaseOrderId: order.id } });
    const complete = refreshed.every((item) => item.receivedQuantity >= item.orderedQuantity);
    await transaction.purchaseOrder.update({ where: { tenantId_id: { tenantId: auth.tenant.id, id: order.id } }, data: { status: complete ? "RECEIVED" : "PARTIALLY_RECEIVED" } });
    return transaction.purchaseReceipt.findUniqueOrThrow({ where: { tenantId_id: { tenantId: auth.tenant.id, id: created.id } }, include: { items: true } });
  }, { isolationLevel: "Serializable" });
  response.status(201).json({ receipt });
});
