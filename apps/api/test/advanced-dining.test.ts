import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import request from "supertest";

import { app } from "../src/app.js";
import { database } from "../src/database.js";

const agent = request.agent(app);
const tenantSlug = "advanced-stage-eight";
const email = "advanced-stage-eight@example.test";
const password = "ClaveSegura123!";
let tenantId = "";
let branchId = "";
let productId = "";
let tableOneId = "";
let tableTwoId = "";
let orderId = "";
let orderItemId = "";
let optionId = "";

async function cleanup(): Promise<void> {
  const tenant = await database.tenant.findUnique({ where: { slug: tenantSlug }, select: { id: true } });
  if (tenant) {
    await database.orderItem.deleteMany({ where: { tenantId: tenant.id } });
    await database.tenant.delete({ where: { id: tenant.id } });
  }
  await database.user.deleteMany({ where: { email } });
}

before(async () => {
  await cleanup();
  const registration = await agent.post("/api/auth/register").send({ email, password, firstName: "Etapa", lastName: "Ocho", storeName: "Bistró Avanzado", storeSlug: tenantSlug });
  assert.equal(registration.status, 201);
  const category = await agent.post("/api/admin/categories").send({ name: "Principales", slug: "principales" });
  const product = await agent.post("/api/admin/products").send({
    sku: "ADV-FOOD", slug: "hamburguesa", name: "Hamburguesa", priceInCents: 1000, categoryId: category.body.category.id,
    stock: 100, images: [], active: true, tags: [], allergens: [], dietaryTags: [], featured: false, featuredOrder: 0, preparationTimeMinutes: 12,
  });
  productId = product.body.product.id;
  const tableOne = await agent.post("/api/admin/dining/tables").send({ code: "A1", name: "Mesa A1", maxCapacity: 4 });
  const tableTwo = await agent.post("/api/admin/dining/tables").send({ code: "A2", name: "Mesa A2", maxCapacity: 4 });
  tableOneId = tableOne.body.table.id; tableTwoId = tableTwo.body.table.id;
  const tenant = await database.tenant.findUniqueOrThrow({ where: { slug: tenantSlug }, include: { branches: true } });
  tenantId = tenant.id; branchId = tenant.branches[0]!.id;
});

after(async () => { await cleanup(); await database.$disconnect(); });

test("los modificadores se validan y conservan snapshots de precio", async () => {
  const configured = await agent.put(`/api/admin/advanced/menu-items/${productId}/modifiers`).send({
    groups: [{ name: "Punto y extra", minChoices: 1, maxChoices: 1, sortOrder: 0, active: true, options: [{ name: "Con cheddar", priceInCents: 200, sortOrder: 0, active: true }] }],
  });
  assert.equal(configured.status, 200);
  optionId = configured.body.groups[0].options[0].id;
  const missing = await request(app).post(`/api/dining/${tenantSlug}/principal/tables/A1/orders`).send({
    clientRequestId: "80000000-0000-4000-8000-000000000001", customerName: "Sin extra", items: [{ productId, quantity: 1 }],
  });
  assert.equal(missing.status, 409);
  const created = await request(app).post(`/api/dining/${tenantSlug}/principal/tables/A1/orders`).send({
    clientRequestId: "80000000-0000-4000-8000-000000000002", customerName: "Con extra",
    items: [{ productId, quantity: 1, modifierOptionIds: [optionId], preparationPoint: "A punto", notes: "Sin cebolla" }],
  });
  assert.equal(created.status, 201);
  orderId = created.body.order.id;
  assert.equal(created.body.order.totalInCents, 1200);
  const item = await database.orderItem.findFirstOrThrow({ where: { orderId }, include: { modifiers: true } });
  orderItemId = item.id;
  assert.equal(item.preparationPoint, "A punto");
  assert.equal(item.modifiers[0]?.optionName, "Con cheddar");
  assert.equal(item.modifiers[0]?.unitPriceInCents, 200);
  assert.equal(await database.printJob.count({ where: { tenantId, orderId, type: "KITCHEN" } }), 1);
});

test("unión, separación y transferencia de mesas son consistentes e idempotentes", async () => {
  const joined = await agent.post("/api/admin/advanced/table-groups").send({ primaryTableId: tableOneId, tableIds: [tableOneId, tableTwoId], label: "Cumpleaños" });
  assert.equal(joined.status, 201);
  assert.equal(joined.body.group.members.length, 2);
  const duplicate = await agent.post("/api/admin/advanced/table-groups").send({ primaryTableId: tableOneId, tableIds: [tableOneId, tableTwoId] });
  assert.equal(duplicate.status, 409);
  assert.equal((await agent.delete(`/api/admin/advanced/table-groups/${joined.body.group.id}`)).status, 200);

  const eventId = "80000000-0000-4000-8000-000000000003";
  const transfers = await Promise.all([
    agent.patch(`/api/admin/advanced/orders/${orderId}/table`).send({ targetTableId: tableTwoId, eventId }),
    agent.patch(`/api/admin/advanced/orders/${orderId}/table`).send({ targetTableId: tableTwoId, eventId }),
  ]);
  assert.deepEqual(transfers.map(({ status }) => status), [200, 200]);
  assert.ok(transfers.some(({ body }) => body.idempotent === true));
  assert.ok(transfers.every(({ body }) => body.order.restaurantTable.id === tableTwoId));
  assert.equal(await database.diningOrderAudit.count({ where: { eventId } }), 1);
});

test("ajustes y división de cuenta quedan auditados sin cobrar sobre el saldo", async () => {
  assert.equal((await agent.post("/api/admin/pos/cash-sessions/open").send({ openingCashInCents: 5000, note: "Turno etapa 8" })).status, 201);
  const adjustmentBody = { clientRequestId: "80000000-0000-4000-8000-000000000004", type: "TIP", label: "Propina", reason: "Servicio", amountInCents: 100 };
  const tips = await Promise.all([
    agent.post(`/api/admin/advanced/orders/${orderId}/adjustments`).send(adjustmentBody),
    agent.post(`/api/admin/advanced/orders/${orderId}/adjustments`).send(adjustmentBody),
  ]);
  assert.deepEqual(tips.map(({ status }) => status).sort(), [200, 201]);
  assert.ok(tips.every(({ body }) => body.order.totalInCents === 1300));
  const payment = await agent.post(`/api/admin/pos/orders/${orderId}/payments`).send({
    clientRequestId: "80000000-0000-4000-8000-000000000005", method: "CASH", amountInCents: 300,
    allocations: [{ amountInCents: 300, guestLabel: "Ana" }],
  });
  assert.equal(payment.status, 201);
  assert.equal(payment.body.payment.allocations[0].guestLabel, "Ana");
  const invalidAllocation = await agent.post(`/api/admin/pos/orders/${orderId}/payments`).send({
    clientRequestId: "80000000-0000-4000-8000-000000000006", method: "CARD_EXTERNAL", amountInCents: 200,
    allocations: [{ amountInCents: 199, orderItemId }],
  });
  assert.equal(invalidAllocation.status, 400);
  const excessiveDiscount = await agent.post(`/api/admin/advanced/orders/${orderId}/adjustments`).send({ clientRequestId: "80000000-0000-4000-8000-000000000007", type: "DISCOUNT", label: "Descuento", reason: "Prueba límite", amountInCents: 1100 });
  assert.equal(excessiveDiscount.status, 409);
  assert.equal(await database.orderAdjustment.count({ where: { orderId } }), 1);
});

test("la cola de impresión es idempotente y solo el reclamante la completa", async () => {
  const body = { clientRequestId: "80000000-0000-4000-8000-000000000008" };
  const requests = await Promise.all([
    agent.post(`/api/admin/advanced/orders/${orderId}/print`).send(body),
    agent.post(`/api/admin/advanced/orders/${orderId}/print`).send(body),
  ]);
  const first = requests.find(({ status }) => status === 201)!;
  const repeated = requests.find(({ status }) => status === 200)!;
  assert.ok(first); assert.ok(repeated);
  assert.equal(first.body.job.id, repeated.body.job.id);
  assert.equal(await database.printJob.count({ where: { tenantId, clientRequestId: body.clientRequestId } }), 1);
  assert.equal((await agent.post(`/api/admin/advanced/print-jobs/${first.body.job.id}/claim`)).status, 200);
  assert.equal((await agent.post(`/api/admin/advanced/print-jobs/${first.body.job.id}/claim`)).status, 409);
  const completed = await agent.post(`/api/admin/advanced/print-jobs/${first.body.job.id}/complete`).send({ status: "PRINTED" });
  assert.equal(completed.status, 200); assert.equal(completed.body.job.status, "PRINTED");
});

test("la vista avanzada permanece aislada por sucursal", async () => {
  const other = await agent.post("/api/admin/branches").send({ slug: "otra", name: "Otra sucursal", timezone: "America/Argentina/Buenos_Aires" });
  await agent.post("/api/auth/select-branch").send({ branchId: other.body.branch.id });
  const overview = await agent.get("/api/admin/advanced/overview");
  assert.equal(overview.status, 200);
  assert.equal(overview.body.tableGroups.length, 0);
  assert.equal(overview.body.printJobs.length, 0);
  await agent.post("/api/auth/select-branch").send({ branchId });
});
