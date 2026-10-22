import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import request from "supertest";

import { app } from "../src/app.js";
import { database } from "../src/database.js";

const agent = request.agent(app);
const tenantSlug = "reservations-stage-ten";
const branchSlug = "principal";
const ownerEmail = "reservations-stage-ten@example.test";
const customerEmail = "guest-stage-ten@example.test";
const password = "ClaveSegura123!";
let tenantId = "";
let branchId = "";
let date = "";
let exceptionDate = "";

async function cleanup() {
  const tenant = await database.tenant.findUnique({ where: { slug: tenantSlug }, select: { id: true } });
  if (tenant) await database.tenant.delete({ where: { id: tenant.id } });
  await database.user.deleteMany({ where: { email: ownerEmail } });
}

function holdPayload(clientRequestId: string, time: string, name = "Cliente Stage Ten") {
  return { clientRequestId, date, time, partySize: 2, durationMinutes: 90, customerName: name, customerPhone: "+5491112345678", customerEmail };
}

before(async () => {
  await cleanup();
  const registration = await agent.post("/api/auth/register").send({ email: ownerEmail, password, firstName: "Etapa", lastName: "Diez", storeName: "Bistró Fidelización", storeSlug: tenantSlug });
  assert.equal(registration.status, 201);
  assert.equal((await agent.post("/api/admin/dining/tables").send({ code: "L1", name: "Mesa loyalty", maxCapacity: 4 })).status, 201);
  const tenant = await database.tenant.findUniqueOrThrow({ where: { slug: tenantSlug }, include: { branches: true } });
  tenantId = tenant.id;
  branchId = tenant.branches[0]!.id;
  date = new Date(Date.now() + 12 * 86_400_000).toISOString().slice(0, 10);
  exceptionDate = new Date(Date.now() + 11 * 86_400_000).toISOString().slice(0, 10);
});

after(async () => {
  await cleanup();
  await database.$disconnect();
});

test("política y excepciones gobiernan la disponibilidad", async () => {
  const policy = await agent.put("/api/admin/reservations/policy").send({ reminderHours: 24, cancellationCutoffHours: 2, depositRequired: true, depositType: "PER_PERSON", depositAmountInCents: 1000 });
  assert.equal(policy.status, 200);
  const exception = await agent.put("/api/admin/reservations/exceptions").send({ date: exceptionDate, closed: true, reason: "Feriado" });
  assert.equal(exception.status, 200);

  const closed = await request(app).get(`/api/reservations/${tenantSlug}/${branchSlug}/availability`).query({ date: exceptionDate, partySize: 2, durationMinutes: 90 });
  assert.equal(closed.status, 200);
  assert.equal(closed.body.slots.length, 0);
  assert.equal(closed.body.policy.depositRequired, true);

  assert.equal((await agent.delete(`/api/admin/reservations/exceptions/${exception.body.exception.id}`)).status, 204);
  const reopened = await request(app).get(`/api/reservations/${tenantSlug}/${branchSlug}/availability`).query({ date: exceptionDate, partySize: 2, durationMinutes: 90 });
  assert.ok(reopened.body.slots.length > 0);
});

test("la seña es idempotente, confirma y agenda un solo recordatorio", async () => {
  const held = await request(app).post(`/api/reservations/${tenantSlug}/${branchSlug}/holds`).send(holdPayload("a0000000-0000-4000-8000-000000000001", "13:00"));
  assert.equal(held.status, 201);
  assert.equal(held.body.reservation.deposits[0].amountInCents, 2000);
  const id = held.body.reservation.id;

  const blocked = await request(app).post(`/api/reservations/${tenantSlug}/${branchSlug}/${id}/confirm`).send({ manageToken: held.body.manageToken });
  assert.equal(blocked.status, 409);

  const payload = { clientRequestId: "a0000000-0000-4000-8000-000000000002", method: "CASH", amountInCents: 2000 };
  const paid = await agent.post(`/api/admin/reservations/${id}/deposits`).send(payload);
  assert.equal(paid.status, 201);
  assert.equal(paid.body.reservation.status, "CONFIRMED");
  const repeated = await agent.post(`/api/admin/reservations/${id}/deposits`).send(payload);
  assert.equal(repeated.status, 200);
  assert.equal(repeated.body.changed, false);
  assert.equal(repeated.body.reservation.status, "CONFIRMED");

  const reservation = await database.reservation.findUniqueOrThrow({ where: { id }, include: { customer: true, deposits: true } });
  assert.equal(reservation.customer?.email, customerEmail);
  assert.equal(reservation.deposits.filter(({ status }) => status === "PAID").length, 1);
  assert.equal(await database.notificationLog.count({ where: { reservationId: id, event: { in: ["RESERVATION_CONFIRMED", "RESERVATION_REMINDER"] } } }), 2);

  const cancelled = await request(app).post(`/api/reservations/${tenantSlug}/${branchSlug}/${id}/cancel`).send({ manageToken: held.body.manageToken, reason: "Cambio de planes" });
  assert.equal(cancelled.status, 200);
  assert.equal((await database.reservationDeposit.findFirstOrThrow({ where: { reservationId: id } })).status, "REFUNDED");
});

test("lista de espera ofrece una mesa y queda vinculada al cliente", async () => {
  const waitlistPayload = { clientRequestId: "a0000000-0000-4000-8000-000000000003", date, preferredTime: "19:00", partySize: 2, durationMinutes: 90, customerName: "Cliente Stage Ten", customerPhone: "+5491112345678", customerEmail };
  const joined = await request(app).post(`/api/reservations/${tenantSlug}/${branchSlug}/waitlist`).send(waitlistPayload);
  assert.equal(joined.status, 201);
  const duplicate = await request(app).post(`/api/reservations/${tenantSlug}/${branchSlug}/waitlist`).send(waitlistPayload);
  assert.equal(duplicate.status, 200);
  assert.equal(duplicate.body.created, false);

  const offered = await agent.post(`/api/admin/reservations/waitlist/${joined.body.entry.id}/offer`).send({ time: "19:00", holdMinutes: 30 });
  assert.equal(offered.status, 201);
  assert.equal(offered.body.entry.status, "OFFERED");
  const deposit = offered.body.reservation.deposits[0];
  const paid = await agent.post(`/api/admin/reservations/${offered.body.reservation.id}/deposits`).send({ clientRequestId: "a0000000-0000-4000-8000-000000000004", method: "CARD_EXTERNAL", amountInCents: deposit.amountInCents });
  assert.equal(paid.status, 201);
  assert.equal((await database.reservationWaitlistEntry.findUniqueOrThrow({ where: { id: joined.body.entry.id } })).status, "BOOKED");

  const customers = await agent.get("/api/admin/customers").query({ search: customerEmail, page: 1, pageSize: 10 });
  assert.equal(customers.status, 200);
  assert.equal(customers.body.customers[0]._count.reservations, 2);
  assert.equal(customers.body.customers[0].segment, "NEW");
  const detail = await agent.get(`/api/admin/customers/${customers.body.customers[0].id}`);
  assert.equal(detail.body.customer.reservations.length, 2);
});

test("la reasignación valida capacidad y sucursal", async () => {
  const tooSmall = await agent.post("/api/admin/dining/tables").send({ code: "L2", name: "Mesa chica", maxCapacity: 1 });
  const suitable = await agent.post("/api/admin/dining/tables").send({ code: "L3", name: "Mesa alternativa", maxCapacity: 4 });
  const reservation = await database.reservation.findFirstOrThrow({ where: { tenantId, branchId, status: "CONFIRMED" } });
  assert.equal((await agent.patch(`/api/admin/reservations/${reservation.id}/table`).send({ tableId: tooSmall.body.table.id })).status, 409);
  const moved = await agent.patch(`/api/admin/reservations/${reservation.id}/table`).send({ tableId: suitable.body.table.id });
  assert.equal(moved.status, 200);
  assert.equal(moved.body.reservation.table.id, suitable.body.table.id);
});
