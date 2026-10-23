import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { AddressInfo } from "node:net";

import request from "supertest";
import { io as socketClient, type Socket } from "socket.io-client";

import { app } from "../src/app.js";
import { database } from "../src/database.js";
import {
  attachRealtimeServer,
  disconnectRealtimeRedis,
} from "../src/realtime.js";
import { closeRedis, withDistributedLock } from "../src/services/redis.js";

const slug = "horizontal-scale-stage-twelve";
const email = "horizontal-scale@example.test";
const password = "ClaveSegura123!";
let serverA: ReturnType<typeof app.listen>;
let serverB: ReturnType<typeof app.listen>;
let realtimeA: Awaited<ReturnType<typeof attachRealtimeServer>>;
let realtimeB: Awaited<ReturnType<typeof attachRealtimeServer>>;
let urlA = "";
let urlB = "";
let cookie = "";
let socket: Socket | null = null;
let replicaBStopped = false;

function listen(server: ReturnType<typeof app.listen>) {
  return new Promise<void>((resolve) => server.once("listening", resolve));
}

function connected(client: Socket) {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Socket timeout")), 5_000);
    client.once("connect", () => {
      clearTimeout(timer);
      resolve();
    });
    client.once("connect_error", reject);
  });
}

async function closeSocketServer(
  server: Awaited<ReturnType<typeof attachRealtimeServer>>,
) {
  await Promise.race([
    new Promise<void>((resolve) => server.close(() => resolve())),
    new Promise<void>((resolve) => setTimeout(resolve, 1_000)),
  ]);
  await disconnectRealtimeRedis(server);
}

before(async () => {
  assert.ok(process.env.REDIS_URL, "REDIS_URL es obligatorio para esta prueba");
  const existing = await database.tenant.findUnique({
    where: { slug },
    select: { id: true },
  });
  if (existing) await database.tenant.delete({ where: { id: existing.id } });
  await database.user.deleteMany({ where: { email } });
  serverA = app.listen(0, "127.0.0.1");
  serverB = app.listen(0, "127.0.0.1");
  await Promise.all([listen(serverA), listen(serverB)]);
  [realtimeA, realtimeB] = await Promise.all([
    attachRealtimeServer(serverA),
    attachRealtimeServer(serverB),
  ]);
  urlA = `http://127.0.0.1:${(serverA.address() as AddressInfo).port}`;
  urlB = `http://127.0.0.1:${(serverB.address() as AddressInfo).port}`;
  const registration = await request(urlA).post("/api/auth/register").send({
    email,
    password,
    firstName: "Escala",
    lastName: "Horizontal",
    storeName: "Escala",
    storeSlug: slug,
  });
  assert.equal(registration.status, 201);
  cookie = registration.headers["set-cookie"]![0]!.split(";")[0]!;
});

after(async () => {
  socket?.disconnect();
  await Promise.all([
    closeSocketServer(realtimeA),
    ...(replicaBStopped ? [] : [closeSocketServer(realtimeB)]),
  ]);
  for (const server of [serverA, serverB]) {
    server.closeAllConnections();
    if (server.listening) server.close();
  }
  const tenant = await database.tenant.findUnique({
    where: { slug },
    select: { id: true },
  });
  if (tenant) await database.tenant.delete({ where: { id: tenant.id } });
  await database.user.deleteMany({ where: { email } });
  await closeRedis();
  await database.$disconnect();
});

test("Redis entrega eventos entre réplicas y la sobreviviente reconstruye desde DB", async () => {
  socket = socketClient(urlA, {
    extraHeaders: { Cookie: cookie },
    transports: ["websocket"],
    forceNew: true,
    reconnection: false,
  });
  await connected(socket);
  const event = new Promise<{ reservationId: string }>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("No llegó el evento entre réplicas")),
      5_000,
    );
    socket!.once("reservation:updated", (payload) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
  const table = await request(urlB)
    .post("/api/admin/dining/tables")
    .set("Cookie", cookie)
    .send({ code: "SCALE1", name: "Mesa escala", maxCapacity: 4 });
  assert.equal(table.status, 201);
  const date = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
  const held = await request(urlB)
    .post("/api/admin/reservations/holds")
    .set("Cookie", cookie)
    .send({
      clientRequestId: "12000000-0000-4000-8000-000000000001",
      date,
      time: "20:00",
      partySize: 2,
      durationMinutes: 90,
      customerName: "Dos réplicas",
      customerPhone: "+5491100000012",
    });
  assert.equal(held.status, 201);
  assert.equal((await event).reservationId, held.body.reservation.id);

  await closeSocketServer(realtimeB);
  replicaBStopped = true;
  socket.disconnect();
  socket = socketClient(urlA, {
    extraHeaders: { Cookie: cookie },
    transports: ["websocket"],
    forceNew: true,
    reconnection: false,
  });
  await connected(socket);
  const overview = await request(urlA)
    .get("/api/admin/reservations/overview")
    .query({ date })
    .set("Cookie", cookie);
  assert.equal(overview.status, 200);
  assert.ok(
    overview.body.reservations.some(
      ({ id }: { id: string }) => id === held.body.reservation.id,
    ),
  );
});

test("el lock distribuido permite un único ejecutor", async () => {
  let executions = 0;
  const task = () =>
    withDistributedLock("scale-test", 5_000, async () => {
      executions += 1;
      await new Promise((resolve) => setTimeout(resolve, 150));
    });
  const results = await Promise.all([task(), task()]);
  assert.equal(executions, 1);
  assert.equal(results.filter(({ acquired }) => acquired).length, 1);
});
