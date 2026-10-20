import {
  Router,
  type NextFunction,
  type Request,
  type Response,
} from "express";

import { database } from "../../database.js";
import { HttpError } from "../../errors.js";
import { updateProviderSubscription } from "../../services/saas-billing-provider.js";
import { getAuthContext, requireSession, resolveBranchContext } from "../auth/session.js";
import {
  planCodeSchema,
  startSupportAccessSchema,
  tenantIdSchema,
  updateCommercialPlanSchema,
  updateSubscriptionSchema,
  updateTenantSchema,
} from "./schemas.js";

export const platformRouter = Router();

function requirePlatformAdmin(
  request: Request,
  _response: Response,
  next: NextFunction,
): void {
  try {
    if (getAuthContext(request).user.platformRole !== "SUPERADMIN") {
      throw new HttpError(
        403,
        "Esta sección es exclusiva del equipo de InfinityFood",
      );
    }
    next();
  } catch (error) {
    next(error);
  }
}

platformRouter.use(requireSession, requirePlatformAdmin);

platformRouter.get("/overview", async (_request, response) => {
  const now = new Date();
  const inSevenDays = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const [
    tenants,
    activeTenants,
    users,
    subscriptions,
    billableSubscriptions,
    orders,
    approvedGmv,
    storefrontViews,
    abandonedCarts,
    notifications,
    invoices,
    domains,
    trialsEndingSoon,
    newTenantsLast30Days,
  ] = await Promise.all([
    database.tenant.count(),
    database.tenant.count({ where: { status: "ACTIVE" } }),
    database.user.count(),
    database.subscription.groupBy({ by: ["status"], _count: true }),
    database.subscription.findMany({
      where: { status: { in: ["ACTIVE", "TRIALING"] } },
      select: { plan: { select: { priceInCents: true } } },
    }),
    database.order.count(),
    database.order.aggregate({
      where: { paymentStatus: "APPROVED" },
      _sum: { totalInCents: true },
    }),
    database.analyticsEvent.count({ where: { type: "STOREFRONT_VIEW" } }),
    database.cart.count({ where: { status: "ABANDONED" } }),
    database.notificationLog.groupBy({ by: ["status"], _count: true }),
    database.billingInvoice.groupBy({ by: ["status"], _count: true }),
    database.customDomain.groupBy({ by: ["status"], _count: true }),
    database.subscription.count({ where: { status: "TRIALING", trialEndsAt: { gte: now, lte: inSevenDays } } }),
    database.tenant.count({ where: { createdAt: { gte: thirtyDaysAgo } } }),
  ]);
  const estimatedMonthlyRevenueInCents = billableSubscriptions.reduce(
    (total, subscription) => total + subscription.plan.priceInCents,
    0,
  );
  response.json({
    tenants,
    activeTenants,
    users,
    subscriptions,
    estimatedMonthlyRevenueInCents,
    orders,
    approvedGmvInCents: approvedGmv._sum.totalInCents ?? 0,
    storefrontViews,
    abandonedCarts,
    notifications,
    invoices,
    domains,
    trialsEndingSoon,
    newTenantsLast30Days,
  });
});

platformRouter.get("/plans", async (_request, response) => {
  const plans = await database.plan.findMany({
    orderBy: { code: "asc" },
    include: { _count: { select: { subscriptions: true } } },
  });
  response.json({ plans });
});

platformRouter.patch("/plans/:code", async (request, response) => {
  const code = planCodeSchema.parse(request.params.code);
  const input = updateCommercialPlanSchema.parse(request.body);
  const current = await database.plan.findUnique({ where: { code } });
  if (!current?.active) throw new HttpError(404, "Plan comercial no encontrado");

  const plan = await database.plan.update({
    where: { code },
    data: {
      ...(input.priceInCents !== undefined ? { priceInCents: input.priceInCents } : {}),
      ...(input.trialDays !== undefined ? { trialDays: input.trialDays } : {}),
    },
    include: { _count: { select: { subscriptions: true } } },
  });

  const synchronization = {
    requested: input.syncExistingSubscriptions,
    eligible: 0,
    updated: 0,
    failed: [] as Array<{ tenantId: string; tenantName: string; message: string }>,
  };

  if (input.syncExistingSubscriptions) {
    const subscriptions = await database.subscription.findMany({
      where: {
        providerSubscriptionId: { not: null },
        OR: [{ planId: plan.id }, { pendingPlanId: plan.id }],
      },
      select: {
        tenantId: true,
        providerSubscriptionId: true,
        providerStatus: true,
        status: true,
        tenant: { select: { name: true } },
      },
      orderBy: { createdAt: "asc" },
    });
    const eligibleSubscriptions = subscriptions.filter(
      (subscription) =>
        subscription.status !== "CANCELED" &&
        subscription.providerStatus?.toLowerCase() !== "canceled",
    );
    synchronization.eligible = eligibleSubscriptions.length;
    for (const subscription of eligibleSubscriptions) {
      try {
        await updateProviderSubscription(subscription.providerSubscriptionId!, {
          planName: plan.name,
          tenantName: subscription.tenant.name,
          priceInCents: plan.priceInCents,
          currency: plan.currency,
        });
        synchronization.updated += 1;
      } catch (error) {
        synchronization.failed.push({
          tenantId: subscription.tenantId,
          tenantName: subscription.tenant.name,
          message: error instanceof Error ? error.message : "No se pudo sincronizar con Mercado Pago",
        });
      }
    }
  }

  response.json({ plan, synchronization });
});

platformRouter.get("/tenants", async (_request, response) => {
  const tenants = await database.tenant.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      subscription: { include: { plan: true } },
      _count: { select: { memberships: true, products: true, orders: true } },
    },
  });
  response.json({ tenants });
});

platformRouter.get("/support-access-logs", async (_request, response) => {
  const logs = await database.supportAccessLog.findMany({
    orderBy: { startedAt: "desc" },
    take: 500,
    select: {
      id: true,
      reason: true,
      startedAt: true,
      endedAt: true,
      user: {
        select: { id: true, firstName: true, lastName: true, email: true },
      },
      tenant: { select: { id: true, name: true, slug: true } },
    },
  });
  response.json({ logs });
});

platformRouter.post("/tenants/:id/support-access", async (request, response) => {
  const auth = getAuthContext(request);
  const tenantId = tenantIdSchema.parse(request.params.id);
  const input = startSupportAccessSchema.parse(request.body);
  if (auth.supportAccess) {
    throw new HttpError(409, "Primero salí de la sesión de soporte actual");
  }
  if (tenantId === auth.tenant.id) {
    throw new HttpError(409, "Ya estás administrando esta tienda");
  }

  const tenant = await database.tenant.findUnique({ where: { id: tenantId } });
  if (!tenant) throw new HttpError(404, "Tienda no encontrada");
  if (tenant.status !== "ACTIVE") {
    throw new HttpError(409, "Reactivá la tienda antes de ingresar como soporte");
  }
  const branch = await resolveBranchContext(tenant.id, auth.user.id, "ADMIN");

  const startedAt = new Date();
  await database.$transaction([
    database.authSession.update({
      where: { id: auth.sessionId },
      data: {
        activeTenantId: tenant.id,
        activeBranchId: branch.id,
        supportOriginTenantId: auth.tenant.id,
        supportStartedAt: startedAt,
      },
    }),
    database.supportAccessLog.create({
      data: {
        userId: auth.user.id,
        tenantId: tenant.id,
        sessionId: auth.sessionId,
        reason: input.reason,
        startedAt,
      },
    }),
  ]);

  response.json({
    tenant: { id: tenant.id, name: tenant.name, slug: tenant.slug },
    supportAccess: { startedAt: startedAt.toISOString() },
  });
});

platformRouter.post("/support-access/end", async (request, response) => {
  const auth = getAuthContext(request);
  if (!auth.supportAccess) {
    throw new HttpError(409, "No hay una sesión de soporte activa");
  }

  const origin = await database.membership.findFirst({
    where: {
      userId: auth.user.id,
      tenantId: auth.supportAccess.originTenantId,
      tenant: { status: "ACTIVE" },
    },
    include: { tenant: true },
  });
  if (!origin) {
    throw new HttpError(409, "La tienda de origen ya no está disponible");
  }
  const branch = await resolveBranchContext(origin.tenantId, auth.user.id, origin.role);

  const endedAt = new Date();
  await database.$transaction([
    database.authSession.update({
      where: { id: auth.sessionId },
      data: {
        activeTenantId: origin.tenantId,
        activeBranchId: branch.id,
        supportOriginTenantId: null,
        supportStartedAt: null,
      },
    }),
    database.supportAccessLog.updateMany({
      where: { sessionId: auth.sessionId, endedAt: null },
      data: { endedAt },
    }),
    database.user.update({
      where: { id: auth.user.id },
      data: { lastTenantId: origin.tenantId },
    }),
  ]);

  response.json({
    tenant: { id: origin.tenant.id, name: origin.tenant.name, slug: origin.tenant.slug },
  });
});

platformRouter.patch("/tenants/:id", async (request, response) => {
  const auth = getAuthContext(request);
  const id = tenantIdSchema.parse(request.params.id);
  const input = updateTenantSchema.parse(request.body);
  if (id === auth.tenant.id && input.status === "SUSPENDED") {
    throw new HttpError(
      409,
      "No podés suspender la tienda usada por tu sesión actual",
    );
  }
  const existing = await database.tenant.findUnique({ where: { id } });
  if (!existing) throw new HttpError(404, "Tenant no encontrado");
  const tenant = await database.tenant.update({ where: { id }, data: input });
  response.json({ tenant });
});

platformRouter.patch("/tenants/:id/subscription", async (request, response) => {
  const tenantId = tenantIdSchema.parse(request.params.id);
  const input = updateSubscriptionSchema.parse(request.body);
  const tenant = await database.tenant.findUnique({ where: { id: tenantId } });
  if (!tenant) throw new HttpError(404, "Tenant no encontrado");

  const plan = input.planCode
    ? await database.plan.findUnique({ where: { code: input.planCode } })
    : null;
  if (input.planCode && (!plan || !plan.active))
    throw new HttpError(404, "Plan no disponible");

  const subscription = await database.subscription.upsert({
    where: { tenantId },
    update: {
      ...(plan ? { planId: plan.id } : {}),
      ...(input.status ? { status: input.status } : {}),
      ...(input.cancelAtPeriodEnd !== undefined
        ? { cancelAtPeriodEnd: input.cancelAtPeriodEnd }
        : {}),
    },
    create: {
      tenantId,
      planId: plan?.id ?? "plan_pro",
      status: input.status ?? "ACTIVE",
      cancelAtPeriodEnd: input.cancelAtPeriodEnd ?? false,
      currentPeriodFrom: new Date(),
    },
    include: { plan: true },
  });
  response.json({ subscription });
});
