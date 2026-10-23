import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "./generated/client/client.js";
import { getDatabasePoolConfig, getDatabaseUrl } from "./environment.js";

export function createDatabaseClient(
  databaseUrl = getDatabaseUrl(),
): PrismaClient {
  const adapter = new PrismaPg({
    connectionString: databaseUrl,
    ...getDatabasePoolConfig(),
    application_name:
      process.env.INSTANCE_ID ??
      process.env.RAILWAY_REPLICA_ID ??
      "infinityfood",
  });

  return new PrismaClient({ adapter });
}

export type DatabaseClient = ReturnType<typeof createDatabaseClient>;
