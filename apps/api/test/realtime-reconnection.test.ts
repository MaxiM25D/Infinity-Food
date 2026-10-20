import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { AddressInfo } from "node:net";

import request from "supertest";
import { io as socketClient, type Socket } from "socket.io-client";

import { app } from "../src/app.js";
import { database } from "../src/database.js";
import { attachRealtimeServer } from "../src/realtime.js";
import { emitReservationUpdate } from "../src/services/realtime.js";

const tenantSlug = "reconnection-stage-six";
const email = "reconnection-stage-six@example.test";
const password = "ClaveSegura123!";
let baseUrl = "";
let cookie = "";
let tenantId = "";
let branchId = "";
let reservationId = "";
let httpServer: ReturnType<typeof app.listen>;
let realtime: ReturnType<typeof attachRealtimeServer>;
let socket: Socket | null = null;

function connected(client: Socket) { return new Promise<void>((resolve, reject) => { const timer = setTimeout(() => reject(new Error("Socket timeout")), 5000); client.once("connect", () => { clearTimeout(timer); resolve(); }); client.once("connect_error", reject); }); }

before(async () => {
  const existing = await database.tenant.findUnique({ where: { slug: tenantSlug }, select: { id: true } });
  if (existing) await database.tenant.delete({ where: { id: existing.id } });
  await database.user.deleteMany({ where: { email } });
  httpServer = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => httpServer.once("listening", resolve));
  realtime = attachRealtimeServer(httpServer);
  baseUrl = `http://127.0.0.1:${(httpServer.address() as AddressInfo).port}`;
  const registration = await request(baseUrl).post("/api/auth/register").send({ email, password, firstName: "Socket", lastName: "Reconnect", storeName: "Reconnect", storeSlug: tenantSlug });
  assert.equal(registration.status, 201);
  cookie = registration.headers["set-cookie"]![0]!.split(";")[0]!;
  const tenant = await database.tenant.findUniqueOrThrow({ where: { slug: tenantSlug }, include: { branches: true } });
  tenantId = tenant.id; branchId = tenant.branches[0]!.id;
  const table = await request(baseUrl).post("/api/admin/dining/tables").set("Cookie", cookie).send({ code: "REC1", name: "Mesa reconnect", maxCapacity: 4 });
  assert.equal(table.status, 201);
  const date = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
  const held = await request(baseUrl).post("/api/admin/reservations/holds").set("Cookie", cookie).send({ clientRequestId: "60000000-0000-4000-8000-000000000099", date, time: "20:00", partySize: 2, durationMinutes: 90, customerName: "Reconnect", customerPhone: "+5491100000000" });
  assert.equal(held.status, 201);
  reservationId = held.body.reservation.id;
});

after(async () => {
  socket?.disconnect();
  realtime.close();
  await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  const tenant = await database.tenant.findUnique({ where: { slug: tenantSlug }, select: { id: true } });
  if (tenant) await database.tenant.delete({ where: { id: tenant.id } });
  await database.user.deleteMany({ where: { email } });
  await database.$disconnect();
});

test("Socket.IO reconecta, recibe eventos y reconstruye reservas desde DB", async () => {
  socket = socketClient(baseUrl, { extraHeaders: { Cookie: cookie }, transports: ["websocket"], forceNew: true, reconnection: false });
  await connected(socket);
  socket.disconnect();
  socket = socketClient(baseUrl, { extraHeaders: { Cookie: cookie }, transports: ["websocket"], forceNew: true, reconnection: false });
  await connected(socket);
  const event = new Promise<{ reservationId: string }>((resolve, reject) => { const timer = setTimeout(() => reject(new Error("Event timeout")), 5000); socket!.once("reservation:updated", (payload) => { clearTimeout(timer); resolve(payload); }); });
  emitReservationUpdate({ tenantId, branchId, reservationId });
  assert.equal((await event).reservationId, reservationId);
  const date = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
  const overview = await request(baseUrl).get("/api/admin/reservations/overview").query({ date }).set("Cookie", cookie);
  assert.equal(overview.status, 200);
  assert.ok(overview.body.reservations.some(({ id }: { id: string }) => id === reservationId));
});
