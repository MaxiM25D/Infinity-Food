import { randomUUID } from "node:crypto";

import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import helmet from "helmet";

import { environment } from "./config.js";
import { errorHandler, HttpError } from "./errors.js";
import { adminRouter } from "./modules/admin/routes.js";
import { managementRouter } from "./modules/management/routes.js";
import { authRouter } from "./modules/auth/routes.js";
import { storefrontRouter } from "./modules/storefront/routes.js";
import { platformRouter } from "./modules/platform/routes.js";
import { tenantRouter } from "./modules/tenants/routes.js";
import { adminIntegrationRouter, integrationRouter } from "./modules/integrations/routes.js";
import { paymentRouter } from "./modules/payments/routes.js";
import { billingRouter } from "./modules/billing/routes.js";
import { growthRouter } from "./modules/growth/routes.js";
import { branchRouter } from "./modules/branches/routes.js";
import { adminMenuRouter, publicMenuRouter } from "./modules/menu/routes.js";
import { adminDiningRouter, publicDiningRouter } from "./modules/dining/routes.js";
import { posRouter } from "./modules/pos/routes.js";
import { adminReservationRouter, publicReservationRouter } from "./modules/reservations/routes.js";
import { reportsRouter } from "./modules/reports/routes.js";
import { advancedDiningRouter } from "./modules/advanced/routes.js";
import { publicRoot } from "./services/storage.js";
import { database } from "./database.js";
import { log } from "./services/logger.js";
import { prometheusMetrics, recordHttpRequest } from "./services/observability.js";

export const app = express();

app.disable("x-powered-by");
app.set("trust proxy", environment.TRUST_PROXY_HOPS);
app.use((request, response, next) => {
  const suppliedId = request.get("x-request-id");
  request.requestId = suppliedId && /^[a-zA-Z0-9._-]{1,100}$/.test(suppliedId) ? suppliedId : randomUUID();
  response.setHeader("x-request-id", request.requestId);
  const startedAt = performance.now();
  response.on("finish", () => {
    const durationMs = performance.now() - startedAt;
    recordHttpRequest(request.method, response.statusCode, durationMs);
    log(response.statusCode >= 500 ? "error" : response.statusCode >= 400 ? "warn" : "info", "http_request", {
      requestId: request.requestId,
      method: request.method,
      path: request.path,
      status: response.statusCode,
      durationMs: Math.round(durationMs * 100) / 100,
      tenantId: request.auth?.tenant.id,
      userId: request.auth?.user.id,
    });
  });
  next();
});
app.use(helmet());
async function isVerifiedStoreOrigin(origin: string): Promise<boolean> {
  try {
    const hostname = new URL(origin).hostname.toLowerCase();
    return Boolean(await database.customDomain.findFirst({ where: { hostname, status: "VERIFIED", tenant: { status: "ACTIVE" } }, select: { id: true } }));
  } catch { return false; }
}

app.use(cors((request, callback) => {
  const origin = request.get("origin");
  if (!origin || origin === new URL(environment.WEB_URL).origin) return callback(null, { origin: origin ?? false, credentials: true });
  if (!request.path.startsWith("/api/storefront/")) return callback(null, { origin: false });
  void isVerifiedStoreOrigin(origin).then((allowed) => callback(null, { origin: allowed ? origin : false, credentials: false })).catch(() => callback(null, { origin: false }));
}));
app.use(async (request, _response, next) => {
  if (["POST", "PUT", "PATCH", "DELETE"].includes(request.method)) {
    const origin = request.get("origin");
    const customStoreOrigin = origin && request.path.startsWith("/api/storefront/") ? await isVerifiedStoreOrigin(origin) : false;
    if (origin && origin !== new URL(environment.WEB_URL).origin && !customStoreOrigin) {
      next(new HttpError(403, "Origen no permitido"));
      return;
    }
  }
  next();
});
app.use(express.json({ limit: "100kb" }));
app.use(cookieParser());
app.use("/uploads", express.static(publicRoot, { maxAge: "1d" }));

app.get("/api/health", (_request, response) => {
  response.json({ status: "ok", service: "infinityfood-api", version: environment.APP_VERSION, instanceId: process.env.RAILWAY_REPLICA_ID ?? process.env.HOSTNAME ?? "local", uptimeSeconds: Math.round(process.uptime()) });
});

app.get("/api/ready", async (_request, response) => {
  try {
    const startedAt = performance.now();
    await database.$queryRaw`SELECT 1`;
    response.json({ status: "ready", database: "ok", databaseLatencyMs: Math.round((performance.now() - startedAt) * 100) / 100, version: environment.APP_VERSION });
  } catch (error) {
    log("error", "readiness_failed", { error });
    response.status(503).json({ status: "unavailable", database: "error" });
  }
});

app.get("/api/internal/metrics", (request, response) => {
  if (!environment.METRICS_TOKEN) { response.status(404).json({ error: "NOT_FOUND", message: "Ruta no encontrada" }); return; }
  if (request.get("authorization") !== `Bearer ${environment.METRICS_TOKEN}`) { response.status(401).json({ error: "UNAUTHORIZED", message: "Credencial de métricas inválida" }); return; }
  response.type("text/plain; version=0.0.4").send(prometheusMetrics());
});

app.use("/api/auth", authRouter);
app.use("/api/tenants", tenantRouter);
app.use("/api/storefront", storefrontRouter);
app.use("/api/menu", publicMenuRouter);
app.use("/api/dining", publicDiningRouter);
app.use("/api/reservations", publicReservationRouter);
app.use("/api/admin/management", managementRouter);
app.use("/api/admin/branches", branchRouter);
app.use("/api/admin/menu", adminMenuRouter);
app.use("/api/admin/dining", adminDiningRouter);
app.use("/api/admin/pos", posRouter);
app.use("/api/admin/reservations", adminReservationRouter);
app.use("/api/admin/reports", reportsRouter);
app.use("/api/admin/advanced", advancedDiningRouter);
app.use("/api/admin", adminRouter);
app.use("/api/admin/integrations", adminIntegrationRouter);
app.use("/api/integrations", integrationRouter);
app.use("/api/payments", paymentRouter);
app.use("/api/billing", billingRouter);
app.use("/api/admin/growth", growthRouter);
app.use("/api/platform", platformRouter);

app.use((_request, response) => {
  response.status(404).json({ error: "NOT_FOUND", message: "Ruta no encontrada" });
});
app.use(errorHandler);
