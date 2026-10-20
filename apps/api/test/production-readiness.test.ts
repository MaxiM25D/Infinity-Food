import assert from "node:assert/strict";
import { after, test } from "node:test";

import request from "supertest";

import { app } from "../src/app.js";
import { database } from "../src/database.js";
import { environment } from "../src/config.js";

after(async () => { await database.$disconnect(); });

test("health y readiness exponen estado operativo y request id", async () => {
  const health = await request(app).get("/api/health").set("x-request-id", "health-check-123");
  assert.equal(health.status, 200);
  assert.equal(health.headers["x-request-id"], "health-check-123");
  assert.equal(health.body.service, "infinityfood-api");
  assert.equal(typeof health.body.uptimeSeconds, "number");
  assert.equal(typeof health.body.instanceId, "string");

  const ready = await request(app).get("/api/ready");
  assert.equal(ready.status, 200);
  assert.equal(ready.body.status, "ready");
  assert.equal(ready.body.database, "ok");
  assert.equal(typeof ready.body.databaseLatencyMs, "number");
  assert.match(ready.headers["x-request-id"] ?? "", /^[0-9a-f-]{36}$/);
});

test("métricas requieren credencial y exponen formato Prometheus", async () => {
  const unauthorized = await request(app).get("/api/internal/metrics");
  assert.equal(unauthorized.status, 401);
  const metrics = await request(app).get("/api/internal/metrics").set("authorization", `Bearer ${environment.METRICS_TOKEN}`);
  assert.equal(metrics.status, 200);
  assert.match(metrics.text, /infinityfood_http_requests_total/);
  assert.match(metrics.text, /infinityfood_process_resident_memory_bytes/);
});

test("rechaza mutaciones originadas fuera de la web configurada", async () => {
  const response = await request(app)
    .post("/api/auth/register")
    .set("origin", "https://sitio-malicioso.example")
    .send({});
  assert.equal(response.status, 403);
  assert.equal(response.body.message, "Origen no permitido");
});
