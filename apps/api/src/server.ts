import { app } from "./app.js";
import { configurationWarnings, environment } from "./config.js";
import { database } from "./database.js";
import { releaseExpiredReservations } from "./services/orders.js";
import { log } from "./services/logger.js";
import { processPendingNotifications } from "./services/notifications.js";
import { processDueBillingCancellations, processExpiredTrials } from "./services/saas-billing.js";
import { attachRealtimeServer } from "./realtime.js";
import { expireReservationHolds } from "./services/reservations.js";
import { recordBackgroundJob } from "./services/observability.js";

const port = environment.PORT ?? environment.API_PORT;
const server = app.listen(port, "0.0.0.0", () => {
  log("info", "server_started", { port, environment: environment.NODE_ENV });
  for (const warning of configurationWarnings()) log("warn", "configuration_warning", { warning });
});
const realtime = attachRealtimeServer(server);

let reservationSweepRunning = false;
async function sweepReservations(): Promise<void> {
  if (reservationSweepRunning) return;
  reservationSweepRunning = true;
  try {
    const released = await releaseExpiredReservations();
    if (released > 0) log("info", "reservations_released", { released });
    const expiredHolds = await expireReservationHolds();
    if (expiredHolds > 0) log("info", "reservation_holds_expired", { expiredHolds });
    const canceledSubscriptions = await processDueBillingCancellations();
    if (canceledSubscriptions > 0) log("info", "subscriptions_canceled", { canceledSubscriptions });
    const expiredTrials = await processExpiredTrials();
    if (expiredTrials > 0) log("info", "subscription_trials_expired", { expiredTrials });
    recordBackgroundJob("maintenance", true);
  } catch (error) {
    recordBackgroundJob("maintenance", false);
    log("error", "reservation_sweep_failed", { error });
  } finally {
    reservationSweepRunning = false;
  }
}

const reservationTimer = setInterval(() => {
  void sweepReservations();
}, environment.RESERVATION_SWEEP_INTERVAL_MS);
reservationTimer.unref();
void sweepReservations();

let notificationSweepRunning = false;
async function sweepNotifications(): Promise<void> {
  if (notificationSweepRunning) return;
  notificationSweepRunning = true;
  try {
    const result = await processPendingNotifications();
    if (result.sent > 0 || result.failed > 0) log("info", "notification_queue_processed", result);
    recordBackgroundJob("notifications", true);
  } catch (error) {
    recordBackgroundJob("notifications", false);
    log("error", "notification_queue_failed", { error });
  } finally {
    notificationSweepRunning = false;
  }
}
const notificationTimer = setInterval(() => void sweepNotifications(), environment.EMAIL_QUEUE_INTERVAL_MS);
notificationTimer.unref();
void sweepNotifications();

let shuttingDown = false;
async function shutdown(signal: string, exitCode = 0): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  log("info", "server_stopping", { signal });
  clearInterval(reservationTimer);
  clearInterval(notificationTimer);
  const forceTimer = setTimeout(() => {
    log("error", "server_shutdown_timeout", { signal });
    process.exit(1);
  }, 10_000);
  forceTimer.unref();
  realtime.close();
  server.close(async (error) => {
    if (error) log("error", "server_close_failed", { error });
    await database.$disconnect().catch((databaseError) => log("error", "database_disconnect_failed", { error: databaseError }));
    clearTimeout(forceTimer);
    process.exit(error ? 1 : exitCode);
  });
}

process.once("SIGTERM", () => void shutdown("SIGTERM"));
process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("uncaughtException", (error) => { log("error", "uncaught_exception", { error }); void shutdown("uncaughtException", 1); });
process.once("unhandledRejection", (error) => { log("error", "unhandled_rejection", { error }); void shutdown("unhandledRejection", 1); });
