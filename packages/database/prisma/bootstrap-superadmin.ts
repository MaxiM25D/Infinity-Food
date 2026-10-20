import bcrypt from "bcryptjs";

import { createDatabaseClient } from "../src/client.js";
import { syncDemoStore } from "./demo-store.js";

const database = createDatabaseClient();

function bootstrapConfiguration(): { email: string; password: string; storeSlug: string } | undefined {
  const email = process.env.SUPERADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.SUPERADMIN_PASSWORD?.trim();
  const storeSlug = process.env.SUPERADMIN_STORE_SLUG?.trim().toLowerCase();
  const configuredValues = [email, password, storeSlug].filter(Boolean).length;

  if (configuredValues === 0) return undefined;
  if (configuredValues !== 3) {
    throw new Error("SUPERADMIN_EMAIL, SUPERADMIN_PASSWORD y SUPERADMIN_STORE_SLUG deben configurarse juntas");
  }
  if (password!.length < 10) throw new Error("SUPERADMIN_PASSWORD debe tener al menos 10 caracteres");

  return { email: email!, password: password!, storeSlug: storeSlug! };
}

async function bootstrapSuperAdmin(): Promise<void> {
  const configuration = bootstrapConfiguration();
  if (!configuration) {
    console.log("Bootstrap de superadmin omitido: no hay credenciales configuradas.");
    return;
  }

  const existingUser = await database.user.findUnique({
    where: { email: configuration.email },
    select: { id: true },
  });
  // Prisma valida ambas ramas del upsert aunque la de creación no vaya a ejecutarse.
  // El hash solo se usa al crear; la rama update nunca modifica la contraseña existente.
  const passwordHash = await bcrypt.hash(configuration.password, 12);

  const result = await database.$transaction(async (transaction) => {
    const user = await transaction.user.upsert({
      where: { email: configuration.email },
      update: { platformRole: "SUPERADMIN", emailVerifiedAt: new Date() },
      create: {
        email: configuration.email,
        passwordHash,
        firstName: "Super",
        lastName: "Admin",
        platformRole: "SUPERADMIN",
        emailVerifiedAt: new Date(),
      },
    });
    const tenant = await transaction.tenant.upsert({
      where: { slug: configuration.storeSlug },
      update: { status: "ACTIVE" },
      create: {
        name: "InfinityFood Demo",
        slug: configuration.storeSlug,
        status: "ACTIVE",
        branches: { create: { slug: "principal", name: "Casa central", isPrimary: true } },
      },
    });
    await transaction.branch.upsert({
      where: { tenantId_slug: { tenantId: tenant.id, slug: "principal" } },
      update: { status: "ACTIVE", isPrimary: true },
      create: { tenantId: tenant.id, slug: "principal", name: "Casa central", isPrimary: true },
    });
    await transaction.membership.upsert({
      where: { tenantId_userId: { tenantId: tenant.id, userId: user.id } },
      update: { role: "OWNER" },
      create: { tenantId: tenant.id, userId: user.id, role: "OWNER" },
    });
    await transaction.subscription.upsert({
      where: { tenantId: tenant.id },
      update: { planId: "plan_pro", status: "ACTIVE" },
      create: { tenantId: tenant.id, planId: "plan_pro", status: "ACTIVE", currentPeriodFrom: new Date() },
    });

    await syncDemoStore(transaction, tenant.id);
    return { email: user.email, storeSlug: tenant.slug };
  });

  console.log(`Superadmin ${existingUser ? "verificado" : "creado"}: ${result.email} / restaurante: ${result.storeSlug}`);
}

try {
  await bootstrapSuperAdmin();
} finally {
  await database.$disconnect();
}
