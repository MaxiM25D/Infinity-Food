import { existsSync } from "node:fs";
import { dirname, join, parse, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { config } from "dotenv";

function findEnvironmentFile(startDirectory: string): string | undefined {
  let directory = resolve(startDirectory);
  const root = parse(directory).root;

  while (directory !== root) {
    const candidate = join(directory, ".env");
    if (existsSync(candidate)) return candidate;
    directory = dirname(directory);
  }

  return undefined;
}

const environmentFile =
  findEnvironmentFile(process.cwd()) ??
  findEnvironmentFile(dirname(fileURLToPath(import.meta.url)));

if (environmentFile) config({ path: environmentFile });

export function getDatabaseUrl(): string {
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    throw new Error("DATABASE_URL no está configurada");
  }

  return databaseUrl;
}

function boundedInteger(
  name: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} debe ser un entero entre ${minimum} y ${maximum}`);
  }
  return value;
}

export function getDatabasePoolConfig() {
  return {
    max: boundedInteger("DATABASE_POOL_MAX", 10, 1, 100),
    idleTimeoutMillis: boundedInteger(
      "DATABASE_POOL_IDLE_TIMEOUT_MS",
      30_000,
      1_000,
      300_000,
    ),
    connectionTimeoutMillis: boundedInteger(
      "DATABASE_POOL_CONNECTION_TIMEOUT_MS",
      5_000,
      1_000,
      60_000,
    ),
  };
}
