import { createServer } from "node:http";

import { app } from "./app.js";
import { configurationWarnings, environment } from "./config.js";
import { database } from "./database.js";
import { log } from "./services/logger.js";
import { attachRealtimeServer, disconnectRealtimeRedis } from "./realtime.js";
import { closeRedis } from "./services/redis.js";

const port = environment.PORT ?? environment.API_PORT;
const server = createServer(app);
const realtime = await attachRealtimeServer(server);
server.listen(port, "0.0.0.0", () => {
  log("info", "server_started", { port, environment: environment.NODE_ENV });
  for (const warning of configurationWarnings())
    log("warn", "configuration_warning", { warning });
});

let shuttingDown = false;
async function shutdown(signal: string, exitCode = 0): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  log("info", "server_stopping", { signal });
  const forceTimer = setTimeout(() => {
    log("error", "server_shutdown_timeout", { signal });
    process.exit(1);
  }, 10_000);
  forceTimer.unref();
  realtime.close(async () => {
    await disconnectRealtimeRedis(realtime).catch((redisError) =>
      log("error", "socket_redis_disconnect_failed", { error: redisError }),
    );
    await closeRedis().catch((redisError) =>
      log("error", "redis_disconnect_failed", { error: redisError }),
    );
    await database
      .$disconnect()
      .catch((databaseError) =>
        log("error", "database_disconnect_failed", { error: databaseError }),
      );
    clearTimeout(forceTimer);
    process.exit(exitCode);
  });
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
