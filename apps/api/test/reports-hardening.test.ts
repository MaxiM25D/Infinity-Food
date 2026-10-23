import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import request from "supertest";

import { app } from "../src/app.js";
import { database } from "../src/database.js";
import { processReportAggregates } from "../src/services/report-aggregates.js";

const agent = request.agent(app);
const tenantSlug = "reports-stage-six";
const email = "reports-stage-six@example.test";
const password = "ClaveSegura123!";
let tenantId = "";
let branchId = "";
let orderId = "";
let cashSessionId = "";
let tableId = "";

async function cleanup() {
  const tenant = await database.tenant.findUnique({
    where: { slug: tenantSlug },
    select: { id: true },
  });
  if (tenant) {
    await database.orderItem.deleteMany({ where: { tenantId: tenant.id } });
    await database.tenant.delete({ where: { id: tenant.id } });
  }
  await database.user.deleteMany({ where: { email } });
}

before(async () => {
  await cleanup();
  assert.equal(
    (
      await agent
        .post("/api/auth/register")
        .send({
          email,
          password,
          firstName: "Etapa",
          lastName: "Seis",
          storeName: "Reportes",
          storeSlug: tenantSlug,
        })
    ).status,
    201,
  );
  const category = await agent
    .post("/api/admin/categories")
    .send({ name: "Carta", slug: "carta" });
  const product = await agent
    .post("/api/admin/products")
    .send({
      sku: "REPORT-1",
      slug: "reporte",
      name: "Plato reporte",
      priceInCents: 1000,
      categoryId: category.body.category.id,
      stock: 100,
      images: [],
      active: true,
      tags: [],
      allergens: [],
      dietaryTags: [],
      featured: false,
      featuredOrder: 0,
      preparationTimeMinutes: 10,
    });
  const table = await agent
    .post("/api/admin/dining/tables")
    .send({ code: "REP1", name: "Mesa reporte", maxCapacity: 4 });
  tableId = table.body.table.id;
  const tenant = await database.tenant.findUniqueOrThrow({
    where: { slug: tenantSlug },
    include: { branches: true },
  });
  tenantId = tenant.id;
  branchId = tenant.branches[0]!.id;
  const opened = await agent
    .post("/api/admin/pos/cash-sessions/open")
    .send({ openingCashInCents: 1000, note: "Fondo reportes" });
  cashSessionId = opened.body.session.id;
  const order = await agent
    .post("/api/admin/pos/orders")
    .send({
      clientRequestId: "60000000-0000-4000-8000-000000000001",
      serviceMode: "TABLE",
      tableId: table.body.table.id,
      customerName: "Mesa reporte",
      items: [{ productId: product.body.product.id, quantity: 1 }],
    });
  orderId = order.body.order.id;
  assert.equal(
    (
      await agent
        .post(`/api/admin/pos/orders/${orderId}/payments`)
        .send({
          clientRequestId: "60000000-0000-4000-8000-000000000002",
          method: "CASH",
          amountInCents: 700,
        })
    ).status,
    201,
  );
  assert.equal(
    (
      await agent
        .post(`/api/admin/pos/orders/${orderId}/payments`)
        .send({
          clientRequestId: "60000000-0000-4000-8000-000000000003",
          method: "CARD_EXTERNAL",
          amountInCents: 300,
        })
    ).status,
    201,
  );
  assert.equal(
    (
      await agent
        .post(`/api/admin/pos/cash-sessions/${cashSessionId}/close`)
        .send({ declaredCashInCents: 1700, note: "Cierre reportes" })
    ).status,
    200,
  );
  const now = new Date();
  await database.kitchenTicket.updateMany({
    where: { tenantId, branchId },
    data: {
      createdAt: new Date(now.getTime() - 20 * 60_000),
      startedAt: new Date(now.getTime() - 15 * 60_000),
      readyAt: new Date(now.getTime() - 5 * 60_000),
      servedAt: now,
      status: "SERVED",
    },
  });
  await database.reservation.createMany({
    data: [
      {
        tenantId,
        branchId,
        tableId,
        status: "COMPLETED",
        partySize: 2,
        customerName: "Completada",
        customerPhone: "+5491111111111",
        startsAt: new Date(now.getTime() - 180 * 60_000),
        endsAt: new Date(now.getTime() - 90 * 60_000),
        seatedAt: new Date(now.getTime() - 180 * 60_000),
        completedAt: new Date(now.getTime() - 90 * 60_000),
        clientRequestId: "60000000-0000-4000-8000-000000000010",
        manageTokenHash: "a".repeat(64),
      },
      {
        tenantId,
        branchId,
        tableId,
        status: "NO_SHOW",
        partySize: 2,
        customerName: "No show",
        customerPhone: "+5491122222222",
        startsAt: new Date(now.getTime() - 120 * 60_000),
        endsAt: new Date(now.getTime() - 30 * 60_000),
        noShowAt: now,
        clientRequestId: "60000000-0000-4000-8000-000000000011",
        manageTokenHash: "b".repeat(64),
      },
    ],
  });
});

after(async () => {
  await cleanup();
  await database.$disconnect();
});

test("ventas se reconcilian contra pagos y cierre de caja", async () => {
  const date = new Date().toISOString().slice(0, 10);
  const response = await agent
    .get("/api/admin/reports/operations")
    .query({ from: date, to: date, branchId });
  assert.equal(response.status, 200);
  const databaseNet = await database.orderPayment
    .findMany({ where: { tenantId, branchId } })
    .then((payments) =>
      payments.reduce(
        (sum, payment) =>
          sum +
          (payment.kind === "REFUND"
            ? -payment.amountInCents
            : payment.amountInCents),
        0,
      ),
    );
  assert.equal(response.body.total.netInCents, databaseNet);
  assert.equal(response.body.total.netInCents, 1000);
  assert.equal(
    response.body.sales.byChannel.find(
      ({ key }: { key: string }) => key === "POS",
    ).netInCents,
    1000,
  );
  assert.equal(
    response.body.sales.byPaymentMethod.find(
      ({ key }: { key: string }) => key === "CASH",
    ).netInCents,
    700,
  );
  assert.equal(
    response.body.sales.byPaymentMethod.find(
      ({ key }: { key: string }) => key === "CARD_EXTERNAL",
    ).netInCents,
    300,
  );
  assert.equal(response.body.reconciliation.differences, 0);
  assert.equal(
    response.body.reconciliation.sessions[0].storedSalesInCents,
    1000,
  );
  assert.equal(
    response.body.reconciliation.sessions[0].calculatedSalesInCents,
    1000,
  );
  assert.equal(response.body.reconciliation.sessions[0].movementsInCents, 1700);
});

test("tiempos de cocina se derivan de tickets persistidos", async () => {
  const date = new Date().toISOString().slice(0, 10);
  const report = (
    await agent
      .get("/api/admin/reports/operations")
      .query({ from: date, to: date })
  ).body;
  assert.equal(report.kitchen.stations.length, 1);
  assert.equal(report.kitchen.stations[0].averageQueueMinutes, 5);
  assert.equal(report.kitchen.stations[0].averagePreparationMinutes, 10);
  assert.equal(report.kitchen.stations[0].averageHandoffMinutes, 5);
  assert.equal(report.kitchen.stations[0].averageTotalMinutes, 20);
});

test("rotación, ocupación y no-shows se derivan de reservas", async () => {
  const date = new Date().toISOString().slice(0, 10);
  const report = (
    await agent
      .get("/api/admin/reports/operations")
      .query({ from: date, to: date })
  ).body;
  assert.equal(report.tableRotation[0].services, 1);
  assert.equal(report.tableRotation[0].averageMinutes, 90);
  assert.equal(report.occupancy[0].noShows, 1);
  assert.equal(report.occupancy[0].completedOrSeated, 1);
  assert.equal(report.occupancy[0].noShowRate, 50);
  assert.ok(report.occupancy[0].occupancyRate > 0);
});

test("reportes no permiten consultar otra sucursal por identificador ajeno", async () => {
  const date = new Date().toISOString().slice(0, 10);
  const otherTenant = await database.tenant.create({
    data: {
      slug: "reports-outsider",
      name: "Ajeno",
      branches: {
        create: { slug: "principal", name: "Ajena", isPrimary: true },
      },
    },
    include: { branches: true },
  });
  const response = await agent
    .get("/api/admin/reports/operations")
    .query({ from: date, to: date, branchId: otherTenant.branches[0]!.id });
  assert.equal(response.status, 404);
  await database.tenant.delete({ where: { id: otherTenant.id } });
});

test("los agregados incrementales son idempotentes y reconcilian con pagos", async () => {
  const first = await processReportAggregates(250, tenantId);
  const second = await processReportAggregates(250, tenantId);
  assert.ok(first.processed + second.processed <= 2);
  assert.equal(second.processed, 0);
  assert.equal(first.remaining, 0);
  assert.equal(second.remaining, 0);
  const aggregatesBeforeRetry = await database.reportSalesAggregate.findMany({
    where: { tenantId },
    orderBy: [
      { branchId: "asc" },
      { localDate: "asc" },
      { dimension: "asc" },
      { dimensionKey: "asc" },
    ],
  });
  const retry = await processReportAggregates(250, tenantId);
  const aggregatesAfterRetry = await database.reportSalesAggregate.findMany({
    where: { tenantId },
    orderBy: [
      { branchId: "asc" },
      { localDate: "asc" },
      { dimension: "asc" },
      { dimensionKey: "asc" },
    ],
  });
  assert.equal(retry.processed, 0);
  assert.deepEqual(aggregatesAfterRetry, aggregatesBeforeRetry);
  const date = new Date().toISOString().slice(0, 10);
  const response = await agent
    .get("/api/admin/reports/sales-aggregates")
    .query({ from: date, to: date, branchId });
  assert.equal(response.status, 200);
  assert.equal(response.body.processedPayments, 2);
  assert.equal(response.body.sales.byBranch[0].netInCents, 1000);
  assert.equal(
    response.body.sales.byPaymentMethod.find(
      ({ key }: { key: string }) => key === "CASH",
    ).netInCents,
    700,
  );
  assert.equal(
    response.body.sales.byPaymentMethod.find(
      ({ key }: { key: string }) => key === "CARD_EXTERNAL",
    ).netInCents,
    300,
  );
});
