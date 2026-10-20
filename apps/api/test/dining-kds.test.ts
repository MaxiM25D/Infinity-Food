import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import request from "supertest";
import bcrypt from "bcryptjs";

import { app } from "../src/app.js";
import { database } from "../src/database.js";

const agent = request.agent(app);
const kitchenAgent = request.agent(app);
const tenantSlug = "dining-stage-three";
const email = "dining-stage-three@example.test";
const kitchenEmail = "dining-kitchen@example.test";
const password = "ClaveSegura123!";
let kitchenId = "";
let barId = "";
let tableId = "";
let foodId = "";
let drinkId = "";
let orderId = "";
let ticketId = "";
const requestId = "11111111-1111-4111-8111-111111111111";

async function cleanup(): Promise<void> {
  const tenant = await database.tenant.findUnique({ where: { slug: tenantSlug }, select: { id: true } });
  if (tenant) {
    await database.orderItem.deleteMany({ where: { tenantId: tenant.id } });
    await database.tenant.delete({ where: { id: tenant.id } });
  }
  await database.user.deleteMany({ where: { email: { in: [email, kitchenEmail] } } });
}

before(async () => {
  await cleanup();
  const registration = await agent.post("/api/auth/register").send({ email, password, firstName: "Etapa", lastName: "Tres", storeName: "Bistró KDS", storeSlug: tenantSlug });
  assert.equal(registration.status, 201);
  const category = await agent.post("/api/admin/categories").send({ name: "Carta", slug: "carta" });
  for (const data of [
    { sku: "KDS-FOOD", slug: "milanesa", name: "Milanesa", priceInCents: 1000 },
    { sku: "KDS-DRINK", slug: "limonada", name: "Limonada", priceInCents: 500 },
  ]) {
    const result = await agent.post("/api/admin/products").send({ ...data, categoryId: category.body.category.id, stock: 100, images: [], active: true, tags: [], allergens: [], dietaryTags: [], featured: false, featuredOrder: 0, preparationTimeMinutes: 10 });
    assert.equal(result.status, 201);
    if (data.sku === "KDS-FOOD") foodId = result.body.product.id;
    else drinkId = result.body.product.id;
  }
  const stations = await agent.get("/api/admin/dining/stations");
  kitchenId = stations.body.stations[0].id;
  const bar = await agent.post("/api/admin/dining/stations").send({ name: "Barra", type: "BAR", displayOrder: 1 });
  assert.equal(bar.status, 201);
  barId = bar.body.station.id;
  assert.equal((await agent.put(`/api/admin/dining/menu-items/${drinkId}/station`).send({ stationId: barId })).status, 200);
  const table = await agent.post("/api/admin/dining/tables").send({ code: "M1", name: "Mesa 1", maxCapacity: 4 });
  assert.equal(table.status, 201);
  tableId = table.body.table.id;
  const tenant = await database.tenant.findUniqueOrThrow({ where: { slug: tenantSlug }, include: { branches: true } });
  const kitchenUser = await database.user.create({ data: { email: kitchenEmail, passwordHash: await bcrypt.hash(password, 12), firstName: "Cocina", lastName: "Uno", emailVerifiedAt: new Date() } });
  await database.membership.create({ data: { tenantId: tenant.id, userId: kitchenUser.id, role: "STAFF" } });
  await database.membershipBranch.create({ data: { tenantId: tenant.id, branchId: tenant.branches.find((branch) => branch.slug === "principal")!.id, userId: kitchenUser.id, role: "KITCHEN", stationId: kitchenId } });
  assert.equal((await kitchenAgent.post("/api/auth/login").send({ email: kitchenEmail, password, tenantSlug })).status, 200);
});

after(async () => {
  await cleanup();
  await database.$disconnect();
});

test("un pedido QR genera exactamente un ticket por estación", async () => {
  const response = await request(app).post(`/api/dining/${tenantSlug}/principal/tables/M1/orders`).send({
    clientRequestId: requestId, customerName: "Mesa Uno",
    items: [{ productId: foodId, quantity: 2 }, { productId: drinkId, quantity: 1, notes: "Sin hielo" }],
  });
  assert.equal(response.status, 201);
  orderId = response.body.order.id;
  const tickets = await database.kitchenTicket.findMany({ where: { round: { orderId } }, include: { items: true } });
  assert.equal(tickets.length, 2);
  assert.deepEqual(new Set(tickets.map((ticket) => ticket.stationId)), new Set([kitchenId, barId]));
  assert.equal(tickets.reduce((total, ticket) => total + ticket.items.length, 0), 2);
  assert.equal(response.body.order.tenantId, undefined);
  assert.equal(response.body.order.publicTokenHash, undefined);
});

test("repetir el mismo evento no duplica rondas ni tickets", async () => {
  const repeated = await request(app).post(`/api/dining/${tenantSlug}/principal/tables/M1/orders`).send({
    clientRequestId: requestId, customerName: "Mesa Uno",
    items: [{ productId: foodId, quantity: 2 }, { productId: drinkId, quantity: 1 }],
  });
  assert.equal(repeated.status, 200);
  assert.equal(repeated.body.order.id, orderId);
  const [rounds, tickets] = await Promise.all([
    database.orderRound.count({ where: { orderId } }),
    database.kitchenTicket.count({ where: { round: { orderId } } }),
  ]);
  assert.equal(rounds, 1);
  assert.equal(tickets, 2);
});

test("KDS filtra por sucursal y estación y reconstruye el estado desde DB", async () => {
  const kitchen = await agent.get(`/api/admin/dining/kds/${kitchenId}/tickets`);
  assert.equal(kitchen.status, 200);
  assert.equal(kitchen.body.tickets.length, 1);
  assert.equal(kitchen.body.tickets[0].items[0].orderItem.productId, foodId);
  ticketId = kitchen.body.tickets[0].id;
  const otherBranch = await agent.post("/api/admin/branches").send({ slug: "otra", name: "Otra sucursal", timezone: "America/Argentina/Buenos_Aires" });
  await agent.post("/api/auth/select-branch").send({ branchId: otherBranch.body.branch.id });
  const forbidden = await agent.get(`/api/admin/dining/kds/${kitchenId}/tickets`);
  assert.equal(forbidden.status, 404);
  const originalTenant = await database.tenant.findUniqueOrThrow({ where: { slug: tenantSlug }, include: { branches: true } });
  await agent.post("/api/auth/select-branch").send({ branchId: originalTenant.branches.find((branch) => branch.slug === "principal")!.id });
  const recovered = await agent.get(`/api/admin/dining/kds/${kitchenId}/tickets`);
  assert.equal(recovered.body.tickets[0].id, ticketId);
});

test("personal KDS solo puede ver la estación asignada", async () => {
  const stations = await kitchenAgent.get("/api/admin/dining/stations");
  assert.deepEqual(stations.body.stations.map((station: { id: string }) => station.id), [kitchenId]);
  assert.equal((await kitchenAgent.get(`/api/admin/dining/kds/${kitchenId}/tickets`)).status, 200);
  assert.equal((await kitchenAgent.get(`/api/admin/dining/kds/${barId}/tickets`)).status, 404);
});

test("actualizar un ticket es idempotente y deja auditoría con tiempos", async () => {
  const eventId = "22222222-2222-4222-8222-222222222222";
  const first = await agent.patch(`/api/admin/dining/kds/tickets/${ticketId}/status`).send({ status: "PREPARING", eventId });
  assert.equal(first.status, 200);
  assert.ok(first.body.ticket.startedAt);
  const repeated = await agent.patch(`/api/admin/dining/kds/tickets/${ticketId}/status`).send({ status: "PREPARING", eventId });
  assert.equal(repeated.status, 200);
  assert.equal(repeated.body.idempotent, true);
  assert.equal(await database.diningOrderAudit.count({ where: { eventId } }), 1);
});

test("un mozo puede abrir un pedido en su sucursal", async () => {
  const result = await agent.post("/api/admin/dining/orders").send({
    tableId, clientRequestId: "33333333-3333-4333-8333-333333333333", customerName: "Pedido mozo", items: [{ productId: foodId, quantity: 1 }],
  });
  assert.equal(result.status, 201);
  assert.equal(result.body.order.diningSource, "WAITER");
});
