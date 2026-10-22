import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import request from "supertest";

import { app } from "../src/app.js";
import { environment } from "../src/config.js";
import { database } from "../src/database.js";
import { processMercadoPagoWebhook } from "../src/services/mercado-pago.js";
import { encryptSecret } from "../src/services/secret-vault.js";

const agent = request.agent(app);
const tenantSlug = "payments-stage-eleven";
const ownerEmail = "payments-stage-eleven@example.test";
const password = "ClaveSegura123!";
const originalFetch = globalThis.fetch;
let tenantId = "";
let branchId = "";
let productId = "";
let orderId = "";
let sessionId = "";
let attemptId = "";
let paymentId = "";
let fiscalSequence = 100;

async function cleanup() {
  const tenant = await database.tenant.findUnique({ where: { slug: tenantSlug }, select: { id: true } });
  if (tenant) {
    await database.orderItem.deleteMany({ where: { tenantId: tenant.id } });
    await database.tenant.delete({ where: { id: tenant.id } });
  }
  await database.user.deleteMany({ where: { email: ownerEmail } });
}

before(async () => {
  await cleanup();
  const registration = await agent.post("/api/auth/register").send({ email: ownerEmail, password, firstName: "Etapa", lastName: "Once", storeName: "Bistró Fiscal", storeSlug: tenantSlug });
  assert.equal(registration.status, 201);
  const category = await agent.post("/api/admin/categories").send({ name: "Carta", slug: "carta" });
  const product = await agent.post("/api/admin/products").send({ sku: "FISCAL-1", slug: "menu-fiscal", name: "Menú fiscal", priceInCents: 5000, categoryId: category.body.category.id, stock: 100, images: [], active: true, tags: [], allergens: [], dietaryTags: [], featured: false, featuredOrder: 0, preparationTimeMinutes: 10 });
  productId = product.body.product.id;
  const tenant = await database.tenant.findUniqueOrThrow({ where: { slug: tenantSlug }, include: { branches: true } });
  tenantId = tenant.id; branchId = tenant.branches[0]!.id;
  await database.mercadoPagoConnection.create({ data: { tenantId, mercadoPagoUserId: "778899", accessTokenEncrypted: encryptSecret("TEST-token"), refreshTokenEncrypted: encryptSecret("refresh"), liveMode: false, webhookKey: "stage-eleven-webhook-key" } });
  const opened = await agent.post("/api/admin/pos/cash-sessions/open").send({ openingCashInCents: 0 });
  sessionId = opened.body.session.id;
  const order = await agent.post("/api/admin/pos/orders").send({ clientRequestId: "b0000000-0000-4000-8000-000000000001", serviceMode: "COUNTER", customerName: "Cliente fiscal", items: [{ productId, quantity: 1 }] });
  orderId = order.body.order.id;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.includes("/checkout/preferences")) return Response.json({ id: "pref-pos-11", init_point: "https://mp.test/checkout", sandbox_init_point: "https://sandbox.mp.test/checkout" });
    if (url.includes("/v1/payments/") && url.endsWith("/refunds")) return Response.json({ id: "refund-9911", status: "approved" });
    if (url.includes("/v1/payments/")) return Response.json({ id: 9911, collector_id: 778899, status: "approved", external_reference: attemptId, transaction_amount: 50, currency_id: "ARS", fee_details: [{ amount: 2.5 }], money_release_date: new Date(Date.now() - 60_000).toISOString() });
    if (url.includes("fiscal.test/documents")) return Response.json({ id: `fiscal-${fiscalSequence}`, number: fiscalSequence++, authorizationCode: "CAE123456789", authorizationExpiresAt: new Date(Date.now() + 10 * 86_400_000).toISOString() });
    throw new Error(`Fetch inesperado: ${url}`);
  };
  environment.FISCAL_PROVIDER_URL = "https://fiscal.test";
  environment.FISCAL_PROVIDER_TOKEN = "fiscal-test-token";
});

after(async () => {
  globalThis.fetch = originalFetch;
  await cleanup();
  await database.$disconnect();
});

test("checkout POS reserva saldo y bloquea el cierre hasta recibir webhook", async () => {
  const body = { clientRequestId: "b0000000-0000-4000-8000-000000000002", amountInCents: 5000 };
  const checkout = await agent.post(`/api/admin/pos/orders/${orderId}/mercadopago-checkout`).send(body);
  assert.equal(checkout.status, 201);
  assert.equal(checkout.body.checkoutUrl, "https://mp.test/checkout");
  attemptId = checkout.body.attempt.id;
  const repeated = await agent.post(`/api/admin/pos/orders/${orderId}/mercadopago-checkout`).send(body);
  assert.equal(repeated.status, 200);
  assert.equal(repeated.body.attempt.id, attemptId);

  const manual = await agent.post(`/api/admin/pos/orders/${orderId}/payments`).send({ clientRequestId: "b0000000-0000-4000-8000-000000000003", method: "CASH", amountInCents: 1 });
  assert.equal(manual.status, 409);
  assert.equal((await agent.post(`/api/admin/pos/cash-sessions/${sessionId}/close`).send({ declaredCashInCents: 0 })).status, 409);
});

test("webhooks repetidos acreditan exactamente un cobro y concilian comisión y neto", async () => {
  await processMercadoPagoWebhook("stage-eleven-webhook-key", "9911");
  await processMercadoPagoWebhook("stage-eleven-webhook-key", "9911");
  const payments = await database.orderPayment.findMany({ where: { tenantId, orderId, method: "MERCADO_PAGO", kind: "PAYMENT" } });
  assert.equal(payments.length, 1);
  paymentId = payments[0]!.id;
  assert.equal(payments[0]!.providerFeeInCents, 250);
  assert.equal(payments[0]!.providerNetInCents, 4750);
  assert.equal(payments[0]!.reconciliationStatus, "RECONCILED");
  assert.equal((await database.order.findUniqueOrThrow({ where: { id: orderId } })).paymentStatus, "APPROVED");
  const reconciliation = await agent.get("/api/admin/pos/reconciliation");
  assert.equal(reconciliation.status, 200);
  assert.deepEqual(reconciliation.body.summary, { grossInCents: 5000, feesInCents: 250, netInCents: 4750, pending: 0, mismatches: 0 });
});

test("factura y nota de crédito son idempotentes y exportables", async () => {
  const profile = await agent.put("/api/admin/pos/fiscal/profile").send({ enabled: true, provider: "EXTERNAL", taxId: "30712345678", legalName: "Bistró Fiscal SA", taxCondition: "Responsable Inscripto", pointOfSale: 12 });
  assert.equal(profile.status, 200);
  const invoiceBody = { clientRequestId: "b0000000-0000-4000-8000-000000000004", type: "INVOICE", recipientTaxId: "20123456789", recipientName: "Cliente fiscal" };
  const invoice = await agent.post(`/api/admin/pos/orders/${orderId}/fiscal-documents`).send(invoiceBody);
  assert.equal(invoice.status, 201);
  assert.equal(invoice.body.document.status, "ISSUED");
  const repeated = await agent.post(`/api/admin/pos/orders/${orderId}/fiscal-documents`).send(invoiceBody);
  assert.equal(repeated.status, 200);
  assert.equal(repeated.body.document.id, invoice.body.document.id);

  const credit = await agent.post(`/api/admin/pos/orders/${orderId}/fiscal-documents`).send({ clientRequestId: "b0000000-0000-4000-8000-000000000005", type: "CREDIT_NOTE", relatedDocumentId: invoice.body.document.id, amountInCents: 1000 });
  assert.equal(credit.status, 201);
  assert.equal(credit.body.document.totalInCents, 1000);
  const excessive = await agent.post(`/api/admin/pos/orders/${orderId}/fiscal-documents`).send({ clientRequestId: "b0000000-0000-4000-8000-000000000006", type: "CREDIT_NOTE", relatedDocumentId: invoice.body.document.id, amountInCents: 4500 });
  assert.equal(excessive.status, 409);
  const csv = await agent.get("/api/admin/pos/fiscal/export.csv");
  assert.equal(csv.status, 200);
  assert.match(csv.text, /INVOICE/);
  assert.match(csv.text, /CREDIT_NOTE/);
});

test("la devolución automática llama al proveedor y no toca facturación SaaS", async () => {
  const invoicesBefore = await database.billingInvoice.count({ where: { tenantId } });
  const refund = await agent.post(`/api/admin/pos/payments/${paymentId}/refunds`).send({ clientRequestId: "b0000000-0000-4000-8000-000000000007", amountInCents: 1000, note: "Devolución fiscal" });
  assert.equal(refund.status, 201);
  assert.equal(refund.body.refund.method, "MERCADO_PAGO");
  assert.equal(await database.billingInvoice.count({ where: { tenantId } }), invoicesBefore);
  assert.equal((await database.subscription.findUniqueOrThrow({ where: { tenantId } })).status, "TRIALING");
});

test("el operador cancela un checkout abandonado y libera el cierre", async () => {
  const user = await database.user.findUniqueOrThrow({ where: { email: ownerEmail } });
  const attempt = await database.paymentAttempt.create({ data: { tenantId, branchId, orderId, cashSessionId: sessionId, createdByUserId: user.id, flow: "POS", provider: "MERCADO_PAGO", idempotencyKey: "b0000000-0000-4000-8000-000000000008", amountInCents: 1, currency: "ARS" } });
  const cancelled = await agent.post(`/api/admin/pos/mercadopago-attempts/${attempt.id}/cancel`);
  assert.equal(cancelled.status, 200);
  assert.equal((await database.paymentAttempt.findUniqueOrThrow({ where: { id: attempt.id } })).status, "CANCELLED");
  assert.equal((await agent.post(`/api/admin/pos/cash-sessions/${sessionId}/close`).send({ declaredCashInCents: 0 })).status, 200);
});
