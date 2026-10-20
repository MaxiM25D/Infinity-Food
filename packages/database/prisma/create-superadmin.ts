import bcrypt from "bcryptjs";

import { createDatabaseClient } from "../src/client.js";
import { syncDemoStore } from "./demo-store.js";

const database = createDatabaseClient();

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} no está configurada en .env`);
  return value;
}

async function createSuperAdmin(): Promise<void> {
  const email = requiredEnvironment("SUPERADMIN_EMAIL").toLowerCase();
  const password = requiredEnvironment("SUPERADMIN_PASSWORD");
  const storeSlug = requiredEnvironment("SUPERADMIN_STORE_SLUG").toLowerCase();

  if (password.length < 10) throw new Error("SUPERADMIN_PASSWORD debe tener al menos 10 caracteres");

  const passwordHash = await bcrypt.hash(password, 12);

  const result = await database.$transaction(async (transaction) => {
    const user = await transaction.user.upsert({
      where: { email },
      update: { passwordHash, firstName: "Super", lastName: "Admin", platformRole: "SUPERADMIN", emailVerifiedAt: new Date() },
      create: { email, passwordHash, firstName: "Super", lastName: "Admin", platformRole: "SUPERADMIN", emailVerifiedAt: new Date() },
    });
    const tenant = await transaction.tenant.upsert({
      where: { slug: storeSlug },
      update: { status: "ACTIVE" },
      create: { name: "Nébula Living", slug: storeSlug, branches: { create: { slug: "principal", name: "Casa central", isPrimary: true } } },
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
    await transaction.authSession.deleteMany({ where: { userId: user.id } });

    return { email: user.email, storeSlug: tenant.slug };
  });

  console.log(`Superadmin creado: ${result.email} / tienda demo: ${result.storeSlug} / plataforma: SUPERADMIN / tienda: OWNER`);
}

try {
  await createSuperAdmin();
} finally {
  await database.$disconnect();
}
