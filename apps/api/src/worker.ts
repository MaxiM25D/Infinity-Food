import { configurationWarnings, environment } from "./config.js";
import { database } from "./database.js";
import { releaseExpiredReservations } from "./services/orders.js";
import { log } from "./services/logger.js";
import { processPendingNotifications } from "./services/notifications.js";
import { processReportAggregates } from "./services/report-aggregates.js";
import {
  closeRedis,
  recordDistributedJob,
  refreshWorkerHeartbeat,
  withDistributedLock,
} from "./services/redis.js";
import { expireReservationHolds } from "./services/reservations.js";
import {
  processDueBillingCancellations,
  processExpiredTrials,
} from "./services/saas-billing.js";

const instanceId =
  environment.INSTANCE_ID ??
  process.env.RAILWAY_REPLICA_ID ??
  process.env.HOSTNAME ??
  `worker-${process.pid}`;
const timers: NodeJS.Timeout[] = [];

async function runLocked(
  name: string,
  ttlMs: number,
  task: () => Promise<unknown>,
): Promise<void> {
  try {
    const execution = await withDistributedLock(name, ttlMs, task);
    await recordDistributedJob(
      name,
      execution.acquired ? "success" : "skipped",
    );
  } catch (error) {
    await recordDistributedJob(name, "failure").catch(() => undefined);
    log("error", "worker_job_failed", { name, error });
  }
}

export async function runMaintenanceJob(): Promise<void> {
  await runLocked(
    "maintenance",
    Math.max(environment.RESERVATION_SWEEP_INTERVAL_MS - 1_000, 10_000),
    async () => {
      const released = await releaseExpiredReservations();
      const expiredHolds = await expireReservationHolds();
      const canceledSubscriptions = await processDueBillingCancellations();
      const expiredTrials = await processExpiredTrials();
      if (released || expiredHolds || canceledSubscriptions || expiredTrials) {
        log("info", "maintenance_processed", {
          released,
          expiredHolds,
          canceledSubscriptions,
          expiredTrials,
        });
      }
    },
  );
}

export async function runNotificationJob(): Promise<void> {
  await runLocked(
    "notifications",
    Math.max(environment.EMAIL_QUEUE_INTERVAL_MS - 250, 1_000),
    async () => {
      const result = await processPendingNotifications();
      if (result.sent || result.failed)
        log("info", "notification_queue_processed", result);
    },
  );
}

export async function runReportAggregateJob(): Promise<void> {
  await runLocked(
    "report-aggregates",
    Math.max(environment.REPORT_AGGREGATE_INTERVAL_MS - 250, 1_000),
    async () => {
      const result = await processReportAggregates();
      if (result.processed) log("info", "report_aggregates_processed", result);
    },
  );
}

function schedule(intervalMs: number, task: () => Promise<void>): void {
  const timer = setInterval(() => void task(), intervalMs);
  timer.unref();
  timers.push(timer);
  void task();
}

log("info", "worker_started", { instanceId });
for (const warning of configurationWarnings())
  log("warn", "configuration_warning", { warning });
await refreshWorkerHeartbeat(instanceId);
schedule(
  Math.max(5_000, Math.floor(environment.WORKER_HEARTBEAT_TTL_SECONDS * 500)),
  () => refreshWorkerHeartbeat(instanceId),
);
schedule(environment.RESERVATION_SWEEP_INTERVAL_MS, runMaintenanceJob);
schedule(environment.EMAIL_QUEUE_INTERVAL_MS, runNotificationJob);
schedule(environment.REPORT_AGGREGATE_INTERVAL_MS, runReportAggregateJob);

let shuttingDown = false;
async function shutdown(signal: string, exitCode = 0): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  log("info", "worker_stopping", { signal, instanceId });
  for (const timer of timers) clearInterval(timer);
  await closeRedis().catch((error) =>
    log("error", "redis_disconnect_failed", { error }),
  );
  await database
    .$disconnect()
    .catch((error) => log("error", "database_disconnect_failed", { error }));
  process.exit(exitCode);
}

process.once("SIGTERM", () => void shutdown("SIGTERM"));
process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("uncaughtException", (error) => {
  log("error", "uncaught_exception", { error });
  void shutdown("uncaughtException", 1);
});
process.once("unhandledRejection", (error) => {
  log("error", "unhandled_rejection", { error });
  void shutdown("unhandledRejection", 1);
});
