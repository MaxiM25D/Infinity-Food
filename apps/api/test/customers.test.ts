import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import request from "supertest";

import { app } from "../src/app.js";
import { database } from "../src/database.js";

const alphaEmail = "owner@customers-alpha.local";
const betaEmail = "owner@customers-beta.local";
const alphaSlug = "customers-alpha";
const betaSlug = "customers-beta";
const password = "StrongPass123!";
const alphaAgent = request.agent(app);
let alphaCustomerId = "";
let betaCustomerId = "";

async function cleanup(): Promise<void> {
  await database.tenant.deleteMany({ where: { slug: { in: [alphaSlug, betaSlug] } } });
  await database.user.deleteMany({ where: { email: { in: [alphaEmail, betaEmail] } } });
}

before(async () => {
  await cleanup();
  const alphaRegistration = await alphaAgent.post("/api/auth/register").send({
    email: alphaEmail,
    password,
    firstName: "Owner",
    lastName: "Alpha",
    storeName: "Customers Alpha",
    storeSlug: alphaSlug,
  });
  assert.equal(alphaRegistration.status, 201);

  const betaRegistration = await request(app).post("/api/auth/register").send({
    email: betaEmail,
    password,
    firstName: "Owner",
    lastName: "Beta",
    storeName: "Customers Beta",
    storeSlug: betaSlug,
  });
  assert.equal(betaRegistration.status, 201);

  const alpha = await database.tenant.findUniqueOrThrow({ where: { slug: alphaSlug } });
  const beta = await database.tenant.findUniqueOrThrow({ where: { slug: betaSlug } });
  const alphaCustomer = await database.customer.create({
    data: { tenantId: alpha.id, email: "ana@example.com", firstName: "Ana", lastName: "Pérez", phone: "+5491112345678" },
  });
  const betaCustomer = await database.customer.create({
    data: { tenantId: beta.id, email: "ana@other.example.com", firstName: "Ana", lastName: "Externa" },
  });
  alphaCustomerId = alphaCustomer.id;
  betaCustomerId = betaCustomer.id;
  const [alphaBranch, betaBranch] = await Promise.all([
    database.branch.findFirstOrThrow({ where: { tenantId: alpha.id, isPrimary: true } }),
    database.branch.findFirstOrThrow({ where: { tenantId: beta.id, isPrimary: true } }),
  ]);

  await database.order.createMany({
    data: [
      { tenantId: alpha.id, branchId: alphaBranch.id, customerId: alphaCustomer.id, number: 1, customerEmail: alphaCustomer.email, customerName: "Ana Pérez", currency: "ARS", subtotalInCents: 12500, totalInCents: 12500, paymentStatus: "APPROVED" },
      { tenantId: alpha.id, branchId: alphaBranch.id, customerId: alphaCustomer.id, number: 2, customerEmail: alphaCustomer.email, customerName: "Ana Pérez", currency: "ARS", subtotalInCents: 8000, totalInCents: 8000, paymentStatus: "PENDING" },
      { tenantId: beta.id, branchId: betaBranch.id, customerId: betaCustomer.id, number: 1, customerEmail: betaCustomer.email, customerName: "Ana Externa", currency: "ARS", subtotalInCents: 99900, totalInCents: 99900, paymentStatus: "APPROVED" },
    ],
  });
});

after(async () => {
  await cleanup();
  await database.$disconnect();
});

test("lista y busca clientes únicamente dentro de la tienda activa", async () => {
  const response = await alphaAgent.get(`/api/admin/customers?search=ana&page=1&pageSize=10&tenantId=otro`);
  assert.equal(response.status, 200);
  assert.equal(response.body.pagination.total, 1);
  assert.equal(response.body.customers[0].id, alphaCustomerId);
  assert.equal(response.body.customers[0]._count.orders, 2);
  assert.equal(response.body.customers[0].approvedSpentInCents, 12500);
});

test("detalle devuelve estadísticas e historial sin permitir acceso cruzado", async () => {
  const detail = await alphaAgent.get(`/api/admin/customers/${alphaCustomerId}`);
  assert.equal(detail.status, 200);
  assert.equal(detail.body.customer.stats.orders, 2);
  assert.equal(detail.body.customer.stats.approvedOrders, 1);
  assert.equal(detail.body.customer.stats.approvedSpentInCents, 12500);
  assert.deepEqual(detail.body.customer.orders.map(({ number }: { number: number }) => number), [2, 1]);

  const crossTenant = await alphaAgent.get(`/api/admin/customers/${betaCustomerId}`);
  assert.equal(crossTenant.status, 404);
});
