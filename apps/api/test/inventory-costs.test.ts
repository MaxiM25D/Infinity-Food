import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import request from "supertest";

import { app } from "../src/app.js";
import { database } from "../src/database.js";

const agent = request.agent(app);
const tenantSlug = "inventory-stage-nine";
const email = "inventory-stage-nine@example.test";
const password = "ClaveSegura123!";
let tenantId = ""; let branchId = ""; let locationId = ""; let productId = ""; let flourId = ""; let cheeseId = "";

async function cleanup() {
  const tenant = await database.tenant.findUnique({ where: { slug: tenantSlug }, select: { id: true } });
  if (tenant) { await database.orderItem.deleteMany({ where: { tenantId: tenant.id } }); await database.tenant.delete({ where: { id: tenant.id } }); }
  await database.user.deleteMany({ where: { email } });
}

before(async () => {
  await cleanup();
  const registration = await agent.post("/api/auth/register").send({ email, password, firstName: "Etapa", lastName: "Nueve", storeName: "Cocina Controlada", storeSlug: tenantSlug });
  assert.equal(registration.status, 201);
  const tenant = await database.tenant.findUniqueOrThrow({ where: { slug: tenantSlug }, include: { branches: { include: { inventoryLocations: true } } } });
  tenantId = tenant.id; branchId = tenant.branches[0]!.id; locationId = tenant.branches[0]!.inventoryLocations[0]!.id;
  const category = await agent.post("/api/admin/categories").send({ name: "Comidas", slug: "comidas" });
  const product = await agent.post("/api/admin/products").send({ sku: "PIZZA-01", slug: "pizza", name: "Pizza", priceInCents: 8000, categoryId: category.body.category.id, stock: 100, images: [], active: true, tags: [], allergens: [], dietaryTags: [], featured: false, featuredOrder: 0, preparationTimeMinutes: 15 });
  productId = product.body.product.id;
  flourId = (await agent.post("/api/admin/inventory/ingredients").send({ code: "HARINA", name: "Harina", unit: "GRAM" })).body.ingredient.id;
  cheeseId = (await agent.post("/api/admin/inventory/ingredients").send({ code: "QUESO", name: "Queso", unit: "GRAM" })).body.ingredient.id;
});

after(async () => { await cleanup(); await database.$disconnect(); });

test("la recepción parcial es idempotente y recalcula costo promedio", async () => {
  const supplier = await agent.post("/api/admin/inventory/suppliers").send({ name: "Molino Central", phone: "123" });
  assert.equal(supplier.status, 201);
  const purchase = await agent.post("/api/admin/inventory/purchase-orders").send({ supplierId: supplier.body.supplier.id, locationId, items: [{ ingredientId: flourId, orderedQuantity: 10_000, unitCostPerThousandInCents: 120_000 }, { ingredientId: cheeseId, orderedQuantity: 5_000, unitCostPerThousandInCents: 700_000 }] });
  assert.equal(purchase.status, 201);
  const flourItem = purchase.body.purchaseOrder.items.find((item: { ingredientId: string }) => item.ingredientId === flourId);
  const requestId = "90000000-0000-4000-8000-000000000001";
  const first = await agent.post(`/api/admin/inventory/purchase-orders/${purchase.body.purchaseOrder.id}/receipts`).send({ clientRequestId: requestId, items: [{ purchaseOrderItemId: flourItem.id, quantity: 4_000 }] });
  const duplicate = await agent.post(`/api/admin/inventory/purchase-orders/${purchase.body.purchaseOrder.id}/receipts`).send({ clientRequestId: requestId, items: [{ purchaseOrderItemId: flourItem.id, quantity: 4_000 }] });
  assert.equal(first.status, 201); assert.equal(duplicate.status, 201); assert.equal(first.body.receipt.id, duplicate.body.receipt.id);
  const stock = await database.ingredientStock.findUniqueOrThrow({ where: { tenantId_branchId_locationId_ingredientId: { tenantId, branchId, locationId, ingredientId: flourId } } });
  assert.equal(stock.quantity, 4_000); assert.equal(stock.averageCostPerThousandCents, 120_000);
  assert.equal(await database.ingredientMovement.count({ where: { tenantId, purchaseReceiptId: first.body.receipt.id } }), 1);
  const cheeseItem = purchase.body.purchaseOrder.items.find((item: { ingredientId: string }) => item.ingredientId === cheeseId);
  const completed = await agent.post(`/api/admin/inventory/purchase-orders/${purchase.body.purchaseOrder.id}/receipts`).send({ clientRequestId: "90000000-0000-4000-8000-000000000007", items: [{ purchaseOrderItemId: flourItem.id, quantity: 6_000 }, { purchaseOrderItemId: cheeseItem.id, quantity: 5_000 }] });
  assert.equal(completed.status, 201);
  assert.equal((await database.purchaseOrder.findUniqueOrThrow({ where: { id: purchase.body.purchaseOrder.id } })).status, "RECEIVED");
});

test("la receta calcula margen y el pedido descuenta exactamente una vez", async () => {
  await agent.put(`/api/admin/inventory/ingredients/${cheeseId}/stocks/${locationId}`).send({ quantity: 7_000, reorderPoint: 200, averageCostPerThousandCents: 700_000, note: "Recuento físico" });
  assert.equal((await agent.put(`/api/admin/inventory/recipes/${productId}`).send({ ingredients: [{ ingredientId: flourId, quantity: 300 }, { ingredientId: cheeseId, quantity: 150 }] })).status, 200);
  const overview = await agent.get("/api/admin/inventory/overview");
  const product = overview.body.products.find((item: { id: string }) => item.id === productId);
  assert.equal(product.costInCents, 141_000); // $360 harina + $1.050 queso
  assert.equal(product.marginInCents, -133_000);
  await agent.post("/api/admin/dining/tables").send({ code: "N9", name: "Mesa N9", maxCapacity: 4 });
  const body = { clientRequestId: "90000000-0000-4000-8000-000000000002", customerName: "Cliente", items: [{ productId, quantity: 2 }] };
  const first = await request(app).post(`/api/dining/${tenantSlug}/principal/tables/N9/orders`).send(body);
  const duplicate = await request(app).post(`/api/dining/${tenantSlug}/principal/tables/N9/orders`).send(body);
  assert.equal(first.status, 201); assert.equal(duplicate.status, 200);
  const flour = await database.ingredientStock.findUniqueOrThrow({ where: { tenantId_branchId_locationId_ingredientId: { tenantId, branchId, locationId, ingredientId: flourId } } });
  const cheese = await database.ingredientStock.findUniqueOrThrow({ where: { tenantId_branchId_locationId_ingredientId: { tenantId, branchId, locationId, ingredientId: cheeseId } } });
  assert.equal(flour.quantity, 9_400); assert.equal(cheese.quantity, 6_700);
  assert.equal(await database.ingredientMovement.count({ where: { tenantId, orderId: first.body.order.id, type: "SALE_CONSUMPTION" } }), 2);
});

test("anular una venta local repone la receta exactamente una vez", async () => {
  const sale = await agent.post("/api/admin/management/sales").send({ operationId: "90000000-0000-4000-8000-000000000008", items: [{ productId, quantity: 1 }], discount: { type: "NONE", value: 0 }, paymentMethod: "CASH" });
  assert.equal(sale.status, 201);
  assert.equal((await agent.post(`/api/admin/management/sales/${sale.body.sale.id}/cancel`)).status, 200);
  const flour = await database.ingredientStock.findUniqueOrThrow({ where: { tenantId_branchId_locationId_ingredientId: { tenantId, branchId, locationId, ingredientId: flourId } } });
  assert.equal(flour.quantity, 9_400);
  assert.equal(await database.ingredientMovement.count({ where: { tenantId, orderId: sale.body.sale.id, type: "SALE_CONSUMPTION" } }), 2);
  assert.equal(await database.ingredientMovement.count({ where: { tenantId, orderId: sale.body.sale.id, type: "SALE_REVERSAL" } }), 2);
});

test("stock insuficiente revierte pedido, tickets y movimientos", async () => {
  const before = await database.order.count({ where: { tenantId } });
  const movementsBefore = await database.ingredientMovement.count({ where: { tenantId, type: "SALE_CONSUMPTION" } });
  const failed = await agent.post("/api/admin/pos/orders").send({ clientRequestId: "90000000-0000-4000-8000-000000000003", serviceMode: "COUNTER", customerName: "Sin stock", items: [{ productId, quantity: 50 }] });
  assert.equal(failed.status, 409);
  assert.equal(await database.order.count({ where: { tenantId } }), before);
  assert.equal(await database.ingredientMovement.count({ where: { tenantId, type: "SALE_CONSUMPTION" } }), movementsBefore);
});

test("mermas y transferencias conservan trazabilidad e idempotencia", async () => {
  const location = await agent.post("/api/admin/inventory/locations").send({ code: "BAR", name: "Depósito barra" });
  assert.equal(location.status, 201);
  const wasteBody = { locationId, quantity: 100, note: "Prueba de merma", clientRequestId: "90000000-0000-4000-8000-000000000004" };
  assert.equal((await agent.post(`/api/admin/inventory/ingredients/${flourId}/waste`).send(wasteBody)).status, 201);
  assert.equal((await agent.post(`/api/admin/inventory/ingredients/${flourId}/waste`).send(wasteBody)).status, 201);
  const transferBody = { ingredientId: flourId, fromLocationId: locationId, toLocationId: location.body.location.id, quantity: 500, note: "Reposición barra", clientRequestId: "90000000-0000-4000-8000-000000000005" };
  assert.equal((await agent.post("/api/admin/inventory/transfers").send(transferBody)).status, 201);
  assert.equal((await agent.post("/api/admin/inventory/transfers").send(transferBody)).body.duplicate, true);
  const total = await database.ingredientStock.aggregate({ where: { tenantId, branchId, ingredientId: flourId }, _sum: { quantity: true } });
  assert.equal(total._sum.quantity, 9_300);
  assert.equal(await database.ingredientMovement.count({ where: { tenantId, clientRequestId: { in: [`${transferBody.clientRequestId}:out`, `${transferBody.clientRequestId}:in`] } } }), 2);
});

test("el inventario queda aislado por sucursal", async () => {
  const other = await agent.post("/api/admin/branches").send({ slug: "secundaria", name: "Secundaria", timezone: "America/Argentina/Buenos_Aires" });
  assert.equal(other.status, 201);
  await agent.post("/api/auth/select-branch").send({ branchId: other.body.branch.id });
  const overview = await agent.get("/api/admin/inventory/overview");
  assert.equal(overview.status, 200); assert.equal(overview.body.movements.length, 0); assert.equal(overview.body.purchaseOrders.length, 0);
  assert.ok(overview.body.ingredients.every((ingredient: Ingredient) => ingredient.stocks.length === 0));
  const foreignWaste = await agent.post(`/api/admin/inventory/ingredients/${flourId}/waste`).send({ locationId, quantity: 1, note: "No permitido", clientRequestId: "90000000-0000-4000-8000-000000000006" });
  assert.equal(foreignWaste.status, 409);
});

type Ingredient = { stocks: unknown[] };
