import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import request from "supertest";

import { app } from "../src/app.js";
import { database } from "../src/database.js";

const agent = request.agent(app);
const tenantSlug = "pos-stage-four";
const email = "pos-stage-four@example.test";
const password = "ClaveSegura123!";
let tenantId = "";
let branchId = "";
let tableId = "";
let productId = "";
let sessionId = "";
let orderId = "";
let cashPaymentId = "";
let cardPaymentId = "";
let subscriptionBefore: { status: string; planId: string; updatedAt: Date };
let invoicesBefore = 0;

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
  const registration = await agent.post("/api/auth/register").send({ email, password, firstName: "Etapa", lastName: "Cuatro", storeName: "Bistró POS", storeSlug: tenantSlug });
  assert.equal(registration.status, 201);
  const category = await agent.post("/api/admin/categories").send({ name: "Carta", slug: "carta" });
  const product = await agent.post("/api/admin/products").send({
    sku: "POS-FOOD", slug: "menu-pos", name: "Menú POS", priceInCents: 1000, categoryId: category.body.category.id,
    stock: 100, images: [], active: true, tags: [], allergens: [], dietaryTags: [], featured: false, featuredOrder: 0, preparationTimeMinutes: 10,
  });
  productId = product.body.product.id;
  const table = await agent.post("/api/admin/dining/tables").send({ code: "P1", name: "Mesa POS", maxCapacity: 4 });
  tableId = table.body.table.id;
  const tenant = await database.tenant.findUniqueOrThrow({ where: { slug: tenantSlug }, include: { branches: true, subscription: true } });
  tenantId = tenant.id; branchId = tenant.branches[0]!.id;
  subscriptionBefore = { status: tenant.subscription!.status, planId: tenant.subscription!.planId, updatedAt: tenant.subscription!.updatedAt };
  invoicesBefore = await database.billingInvoice.count({ where: { tenantId } });
});

after(async () => {
  await cleanup();
  await database.$disconnect();
});

test("POS abre caja y crea pedidos de mostrador y mesa", async () => {
  const opened = await agent.post("/api/admin/pos/cash-sessions/open").send({ openingCashInCents: 10_000, note: "Fondo inicial" });
  assert.equal(opened.status, 201);
  sessionId = opened.body.session.id;
  assert.equal(opened.body.session.movements.length, 1);
  assert.equal(opened.body.session.movements[0].type, "OPENING");

  const counter = await agent.post("/api/admin/pos/orders").send({
    clientRequestId: "40000000-0000-4000-8000-000000000001", serviceMode: "COUNTER", customerName: "Mostrador",
    items: [{ productId, quantity: 2 }],
  });
  assert.equal(counter.status, 201);
  orderId = counter.body.order.id;
  assert.equal(counter.body.order.restaurantTable, null);
  assert.equal(counter.body.order.totalInCents, 2000);

  const table = await agent.post("/api/admin/pos/orders").send({
    clientRequestId: "40000000-0000-4000-8000-000000000002", serviceMode: "TABLE", tableId, customerName: "Mesa POS",
    items: [{ productId, quantity: 1 }],
  });
  assert.equal(table.status, 201);
  assert.equal(table.body.order.restaurantTable.id, tableId);
});

test("un cobro parcial en efectivo es idempotente y genera un único movimiento", async () => {
  const body = { clientRequestId: "40000000-0000-4000-8000-000000000003", method: "CASH", amountInCents: 700 };
  const first = await agent.post(`/api/admin/pos/orders/${orderId}/payments`).send(body);
  assert.equal(first.status, 201);
  cashPaymentId = first.body.payment.id;
  assert.equal(first.body.order.paymentStatus, "PARTIALLY_PAID");
  assert.equal(first.body.order.balanceInCents, 1300);
  const repeated = await agent.post(`/api/admin/pos/orders/${orderId}/payments`).send(body);
  assert.equal(repeated.status, 200);
  assert.equal(repeated.body.payment.id, cashPaymentId);
  assert.equal(await database.orderPayment.count({ where: { id: cashPaymentId } }), 1);
  assert.equal(await database.cashMovement.count({ where: { orderPaymentId: cashPaymentId } }), 1);
});

test("el total cobrado nunca supera el saldo pendiente", async () => {
  const rejected = await agent.post(`/api/admin/pos/orders/${orderId}/payments`).send({
    clientRequestId: "40000000-0000-4000-8000-000000000004", method: "CARD_EXTERNAL", amountInCents: 1301,
  });
  assert.equal(rejected.status, 409);
  assert.equal(await database.orderPayment.count({ where: { tenantId, clientRequestId: "40000000-0000-4000-8000-000000000004" } }), 0);

  const competing = await Promise.all([
    agent.post(`/api/admin/pos/orders/${orderId}/payments`).send({ clientRequestId: "40000000-0000-4000-8000-000000000005", method: "CARD_EXTERNAL", amountInCents: 800, reference: "Lote 10" }),
    agent.post(`/api/admin/pos/orders/${orderId}/payments`).send({ clientRequestId: "40000000-0000-4000-8000-000000000009", method: "CARD_EXTERNAL", amountInCents: 800, reference: "Lote duplicado" }),
  ]);
  assert.deepEqual(competing.map(({ status }) => status).sort(), [201, 409]);
  cardPaymentId = competing.find(({ status }) => status === 201)!.body.payment.id;
  const mercadoPago = await agent.post(`/api/admin/pos/orders/${orderId}/payments`).send({
    clientRequestId: "40000000-0000-4000-8000-000000000006", method: "MERCADO_PAGO", amountInCents: 500, reference: "MP-123",
  });
  assert.equal(mercadoPago.status, 201);
  assert.equal(mercadoPago.body.order.balanceInCents, 0);
  assert.equal(mercadoPago.body.order.paymentStatus, "APPROVED");
});

test("una devolución explícita vuelve a abrir saldo y permite cobrarlo", async () => {
  const refund = await agent.post(`/api/admin/pos/payments/${cardPaymentId}/refunds`).send({
    clientRequestId: "40000000-0000-4000-8000-000000000007", amountInCents: 200, note: "Ajuste solicitado por cliente",
  });
  assert.equal(refund.status, 201);
  assert.equal(refund.body.order.balanceInCents, 200);
  assert.equal(refund.body.order.paymentStatus, "PARTIALLY_PAID");
  assert.equal(await database.cashMovement.count({ where: { orderPaymentId: refund.body.refund.id } }), 0);
  const repeatedRefund = await agent.post(`/api/admin/pos/payments/${cardPaymentId}/refunds`).send({
    clientRequestId: "40000000-0000-4000-8000-000000000007", amountInCents: 200, note: "Ajuste solicitado por cliente",
  });
  assert.equal(repeatedRefund.status, 200);
  assert.equal(repeatedRefund.body.refund.id, refund.body.refund.id);

  const finalPayment = await agent.post(`/api/admin/pos/orders/${orderId}/payments`).send({
    clientRequestId: "40000000-0000-4000-8000-000000000008", method: "CASH", amountInCents: 200,
  });
  assert.equal(finalPayment.status, 201);
  assert.equal(finalPayment.body.order.balanceInCents, 0);
  assert.equal(finalPayment.body.order.paymentStatus, "APPROVED");
  assert.equal(await database.cashMovement.count({ where: { orderPaymentId: finalPayment.body.payment.id } }), 1);
});

test("el cierre reconcilia ventas, medios y movimientos de efectivo", async () => {
  const expense = await agent.post(`/api/admin/pos/cash-sessions/${sessionId}/movements`).send({ type: "EXPENSE", amountInCents: 100, note: "Compra de hielo" });
  assert.equal(expense.status, 201);
  assert.equal(expense.body.movement.amountInCents, -100);

  const closed = await agent.post(`/api/admin/pos/cash-sessions/${sessionId}/close`).send({ declaredCashInCents: 10_800, note: "Cierre sin diferencia" });
  assert.equal(closed.status, 200);
  assert.equal(closed.body.session.expectedClosingCashInCents, 10_800);
  assert.equal(closed.body.session.declaredClosingCashInCents, 10_800);
  assert.equal(closed.body.session.differenceInCents, 0);
  assert.equal(closed.body.session.salesTotalInCents, 2000);
  assert.equal(closed.body.session.cashSalesInCents, 900);
  assert.equal(closed.body.session.cardSalesInCents, 600);
  assert.equal(closed.body.session.mercadoPagoSalesInCents, 500);
  assert.equal(closed.body.session.manualMovementsInCents, -100);
  assert.equal((await agent.get("/api/admin/pos/overview")).body.session, null);
});

test("los cobros operativos no modifican la suscripción SaaS", async () => {
  const subscriptionAfter = await database.subscription.findUniqueOrThrow({ where: { tenantId } });
  assert.equal(subscriptionAfter.status, subscriptionBefore.status);
  assert.equal(subscriptionAfter.planId, subscriptionBefore.planId);
  assert.equal(subscriptionAfter.updatedAt.toISOString(), subscriptionBefore.updatedAt.toISOString());
  assert.equal(await database.billingInvoice.count({ where: { tenantId } }), invoicesBefore);
  assert.ok(await database.orderPayment.count({ where: { tenantId } }) > 0);
});

test("caja y pedidos quedan aislados por sucursal", async () => {
  const other = await agent.post("/api/admin/branches").send({ slug: "segunda", name: "Segunda", timezone: "America/Argentina/Buenos_Aires" });
  assert.equal(other.status, 201);
  await agent.post("/api/auth/select-branch").send({ branchId: other.body.branch.id });
  const overview = await agent.get("/api/admin/pos/overview");
  assert.equal(overview.status, 200);
  assert.equal(overview.body.session, null);
  assert.equal(overview.body.orders.length, 0);
  await agent.post("/api/auth/select-branch").send({ branchId });
});
