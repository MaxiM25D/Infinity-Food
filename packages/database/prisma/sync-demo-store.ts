import { createDatabaseClient } from "../src/client.js";
import { syncDemoStore } from "./demo-store.js";

const database = createDatabaseClient();

async function run(): Promise<void> {
  const storeSlug = process.env.DEMO_STORE_SLUG?.trim().toLowerCase() || "infinityshop-demo";

  await database.$transaction(async (transaction) => {
    const tenant = await transaction.tenant.upsert({
      where: { slug: storeSlug },
      update: { status: "ACTIVE" },
      create: { slug: storeSlug, name: "Nébula Living", status: "ACTIVE", branches: { create: { slug: "principal", name: "Casa central", isPrimary: true } } },
    });
    await transaction.branch.upsert({
      where: { tenantId_slug: { tenantId: tenant.id, slug: "principal" } },
      update: { status: "ACTIVE", isPrimary: true },
      create: { tenantId: tenant.id, slug: "principal", name: "Casa central", isPrimary: true },
    });

    const proPlan = await transaction.plan.findUnique({ where: { id: "plan_pro" } });
    if (proPlan) {
      await transaction.subscription.upsert({
        where: { tenantId: tenant.id },
        update: { planId: proPlan.id, status: "ACTIVE" },
        create: { tenantId: tenant.id, planId: proPlan.id, status: "ACTIVE", currentPeriodFrom: new Date() },
      });
    }

    const ownerEmails = new Set(["infinity.dev.2026@gmail.com"]);
    const configuredOwnerEmail = process.env.SUPERADMIN_EMAIL?.trim().toLowerCase();
    if (configuredOwnerEmail) ownerEmails.add(configuredOwnerEmail);
    const owners = await transaction.user.findMany({
      where: { email: { in: [...ownerEmails] } },
    });
    for (const owner of owners) {
        await transaction.user.update({
          where: { id: owner.id },
          data: { platformRole: "SUPERADMIN", emailVerifiedAt: owner.emailVerifiedAt ?? new Date() },
        });
        await transaction.membership.upsert({
          where: { tenantId_userId: { tenantId: tenant.id, userId: owner.id } },
          update: { role: "OWNER" },
          create: { tenantId: tenant.id, userId: owner.id, role: "OWNER" },
        });
    }

    await syncDemoStore(transaction, tenant.id);
  });
  console.log(`Tienda demo actualizada: ${storeSlug} / Nébula Living / 4 productos`);
}

try {
  await run();
} finally {
  await database.$disconnect();
}
