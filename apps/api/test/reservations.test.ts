import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import request from "supertest";

import { app } from "../src/app.js";
import { database } from "../src/database.js";
import { createReservationHold } from "../src/services/reservations.js";

const agent = request.agent(app);
const tenantSlug = "reservations-stage-five";
const branchSlug = "principal";
const email = "reservations-stage-five@example.test";
const password = "ClaveSegura123!";
let tenantId = "";
let branchId = "";
let tableId = "";
let date = "";

async function cleanup() {
  const tenant = await database.tenant.findUnique({ where: { slug: tenantSlug }, select: { id: true } });
  if (tenant) await database.tenant.delete({ where: { id: tenant.id } });
  await database.user.deleteMany({ where: { email } });
}

before(async () => {
  await cleanup();
  const registration = await agent.post("/api/auth/register").send({ email, password, firstName: "Etapa", lastName: "Cinco", storeName: "Bistró Reservas", storeSlug: tenantSlug });
  assert.equal(registration.status, 201);
  const table = await agent.post("/api/admin/dining/tables").send({ code: "R1", name: "Mesa reserva", maxCapacity: 4 });
  assert.equal(table.status, 201);
  tableId = table.body.table.id;
  const tenant = await database.tenant.findUniqueOrThrow({ where: { slug: tenantSlug }, include: { branches: true } });
  tenantId = tenant.id;
  branchId = tenant.branches[0]!.id;
  date = new Date(Date.now() + 4 * 86_400_000).toISOString().slice(0, 10);
});

after(async () => {
  await cleanup();
  await database.$disconnect();
});

test("la disponibilidad respeta horario y capacidad", async () => {
  const response = await request(app).get(`/api/reservations/${tenantSlug}/${branchSlug}/availability`).query({ date, partySize: 4, durationMinutes: 90 });
  assert.equal(response.status, 200);
  assert.equal(response.body.timezone, "America/Argentina/Buenos_Aires");
  assert.ok(response.body.slots.some((slot: { time: string }) => slot.time === "12:00"));
  assert.equal(response.body.slots[0].tables[0].id, tableId);

  const tooLarge = await request(app).get(`/api/reservations/${tenantSlug}/${branchSlug}/availability`).query({ date, partySize: 5, durationMinutes: 90 });
  assert.equal(tooLarge.status, 200);
  assert.equal(tooLarge.body.slots.length, 0);
});

test("dos solicitudes concurrentes no reservan la misma mesa y rango", async () => {
  const payload = (id: string, name: string) => ({ clientRequestId: id, date, time: "20:00", partySize: 4, durationMinutes: 90, customerName: name, customerPhone: "+5491112345678" });
  const competing = await Promise.all([
    request(app).post(`/api/reservations/${tenantSlug}/${branchSlug}/holds`).send(payload("50000000-0000-4000-8000-000000000001", "Cliente uno")),
    request(app).post(`/api/reservations/${tenantSlug}/${branchSlug}/holds`).send(payload("50000000-0000-4000-8000-000000000002", "Cliente dos")),
  ]);
  assert.deepEqual(competing.map(({ status }) => status).sort(), [201, 409]);
  assert.equal(await database.reservation.count({ where: { tenantId, tableId, startsAt: competing.find(({ status }) => status === 201)!.body.reservation.startsAt, status: "HOLD" } }), 1);

  const winner = competing.find(({ status }) => status === 201)!;
  const confirmed = await request(app).post(`/api/reservations/${tenantSlug}/${branchSlug}/${winner.body.reservation.id}/confirm`).send({ manageToken: winner.body.manageToken });
  assert.equal(confirmed.status, 200);
  assert.equal(confirmed.body.reservation.status, "CONFIRMED");
});

test("los holds vencen automáticamente sin una solicitud posterior", async () => {
  const result = await createReservationHold({
    tenantId, branchId, timezone: "America/Argentina/Buenos_Aires", date, time: "18:00", partySize: 2, durationMinutes: 90,
    holdMinutes: 0.001, customerName: "Hold corto", customerPhone: "+5491100000000", clientRequestId: "50000000-0000-4000-8000-000000000003",
  });
  assert.equal(result.reservation.status, "HOLD");
  await new Promise((resolve) => setTimeout(resolve, 180));
  const expired = await database.reservation.findUniqueOrThrow({ where: { id: result.reservation.id }, include: { audits: true } });
  assert.equal(expired.status, "EXPIRED");
  assert.ok(expired.audits.some(({ toStatus }) => toStatus === "EXPIRED"));
});

test("confirmaciones, cancelaciones y no-show quedan auditados", async () => {
  const held = await agent.post("/api/admin/reservations/holds").send({
    clientRequestId: "50000000-0000-4000-8000-000000000004", date, time: "16:00", partySize: 2, durationMinutes: 90,
    customerName: "Cliente auditado", customerPhone: "+5491199999999",
  });
  assert.equal(held.status, 201);
  const id = held.body.reservation.id;
  assert.equal((await agent.patch(`/api/admin/reservations/${id}/status`).send({ status: "CONFIRMED" })).status, 200);
  const noShow = await agent.patch(`/api/admin/reservations/${id}/status`).send({ status: "NO_SHOW", reason: "No llegó" });
  assert.equal(noShow.status, 200);
  assert.equal(noShow.body.reservation.status, "NO_SHOW");
  assert.deepEqual(noShow.body.reservation.audits.map(({ toStatus }: { toStatus: string }) => toStatus), ["HOLD", "CONFIRMED", "NO_SHOW"]);

  const cancelHold = await agent.post("/api/admin/reservations/holds").send({
    clientRequestId: "50000000-0000-4000-8000-000000000005", date, time: "14:00", partySize: 2, durationMinutes: 90,
    customerName: "Cliente cancelado", customerPhone: "+5491188888888",
  });
  const cancelled = await agent.patch(`/api/admin/reservations/${cancelHold.body.reservation.id}/status`).send({ status: "CANCELLED", reason: "Avisó el cliente" });
  assert.equal(cancelled.status, 200);
  assert.equal(cancelled.body.reservation.status, "CANCELLED");
});

test("zona horaria y cambio de día UTC conservan el día local correcto", async () => {
  await database.branch.update({ where: { id: branchId }, data: { timezone: "America/Los_Angeles" } });
  const day = new Date(Date.now() + 6 * 86_400_000).toISOString().slice(0, 10);
  const weekday = new Date(`${day}T12:00:00Z`).getUTCDay();
  await database.reservationSchedule.upsert({
    where: { tenantId_branchId_weekday: { tenantId, branchId, weekday } },
    update: { opensAtMinutes: 22 * 60, closesAtMinutes: 24 * 60, active: true },
    create: { tenantId, branchId, weekday, opensAtMinutes: 22 * 60, closesAtMinutes: 24 * 60, active: true },
  });
  const availability = await request(app).get(`/api/reservations/${tenantSlug}/${branchSlug}/availability`).query({ date: day, partySize: 2, durationMinutes: 30 });
  assert.equal(availability.status, 200);
  const slot = availability.body.slots.find(({ time }: { time: string }) => time === "22:30");
  assert.ok(slot);
  assert.notEqual(slot.startsAt.slice(0, 10), day);
  const local = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(slot.startsAt));
  assert.match(local, new RegExp(`${day}.*22:30`));
});

test("las reservas permanecen aisladas por sucursal", async () => {
  const other = await agent.post("/api/admin/branches").send({ slug: "reservas-dos", name: "Reservas dos", timezone: "America/Argentina/Buenos_Aires" });
  assert.equal(other.status, 201);
  await agent.post("/api/auth/select-branch").send({ branchId: other.body.branch.id });
  const overview = await agent.get("/api/admin/reservations/overview").query({ date });
  assert.equal(overview.status, 200);
  assert.equal(overview.body.reservations.length, 0);
  await agent.post("/api/auth/select-branch").send({ branchId });
});
