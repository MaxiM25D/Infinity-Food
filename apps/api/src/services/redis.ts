import { randomUUID } from "node:crypto";

import { createClient } from "redis";

import { environment } from "../config.js";
import { log } from "./logger.js";

function newRedisClient() {
  return createClient({ url: environment.REDIS_URL! });
}

export type InfinityRedisClient = ReturnType<typeof newRedisClient>;

let sharedClient: InfinityRedisClient | null = null;
let sharedConnection: Promise<InfinityRedisClient | null> | null = null;

export function redisKey(suffix: string): string {
  return `${environment.REDIS_KEY_PREFIX}:${suffix}`;
}

export function createRedisConnection(): InfinityRedisClient | null {
  if (!environment.REDIS_URL) return null;
  const client = newRedisClient();
  client.on("error", (error) => log("error", "redis_error", { error }));
  return client;
}

export async function getRedis(): Promise<InfinityRedisClient | null> {
  if (!environment.REDIS_URL) return null;
  if (sharedClient?.isReady) return sharedClient;
  if (!sharedConnection) {
    sharedConnection = (async () => {
      const client = createRedisConnection()!;
      await client.connect();
      sharedClient = client;
      log("info", "redis_connected", {
        instanceId: environment.INSTANCE_ID ?? process.env.HOSTNAME ?? "local",
      });
      return client;
    })().catch((error) => {
      sharedConnection = null;
      throw error;
    });
  }
  return sharedConnection;
}

export async function redisHealth(): Promise<"ok" | "disabled" | "error"> {
  if (!environment.REDIS_URL) return "disabled";
  try {
    const client = await getRedis();
    return client && (await client.ping()) === "PONG" ? "ok" : "error";
  } catch {
    return "error";
  }
}

export async function workerHeartbeat(): Promise<
  "ok" | "stale" | "disabled" | "error"
> {
  if (!environment.REDIS_URL) return "disabled";
  try {
    const client = await getRedis();
    return (await client!.exists(redisKey("worker:heartbeat")))
      ? "ok"
      : "stale";
  } catch {
    return "error";
  }
}

export async function refreshWorkerHeartbeat(
  instanceId: string,
): Promise<void> {
  const client = await getRedis();
  if (!client) return;
  await client.set(
    redisKey("worker:heartbeat"),
    JSON.stringify({ instanceId, at: new Date().toISOString() }),
    { EX: environment.WORKER_HEARTBEAT_TTL_SECONDS },
  );
}

export async function recordDistributedJob(
  name: string,
  result: "success" | "failure" | "skipped",
): Promise<void> {
  const client = await getRedis();
  if (!client) return;
  await client.hIncrBy(redisKey("metrics:jobs"), `${name}:${result}`, 1);
}

export async function distributedJobMetrics(): Promise<Record<string, string>> {
  const client = await getRedis();
  return client ? client.hGetAll(redisKey("metrics:jobs")) : {};
}

export async function withDistributedLock<T>(
  name: string,
  ttlMs: number,
  task: () => Promise<T>,
): Promise<{ acquired: boolean; result?: T }> {
  const client = await getRedis();
  if (!client) return { acquired: true, result: await task() };
  const key = redisKey(`lock:${name}`);
  const token = randomUUID();
  const acquired = await client.set(key, token, { NX: true, PX: ttlMs });
  if (!acquired) return { acquired: false };
  try {
    return { acquired: true, result: await task() };
  } finally {
    await client
      .eval(
        "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
        { keys: [key], arguments: [token] },
      )
      .catch((error) =>
        log("warn", "redis_lock_release_failed", { name, error }),
      );
  }
}

export async function closeRedis(): Promise<void> {
  const client = sharedClient;
  sharedClient = null;
  sharedConnection = null;
  if (client?.isOpen) await client.quit();
}
