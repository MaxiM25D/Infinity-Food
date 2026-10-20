import { Router } from "express";

import { database } from "../../database.js";
import { HttpError } from "../../errors.js";
import { getAuthContext, requireRoles, requireSession } from "../auth/session.js";
import { requireWritableSubscription } from "../saas/limits.js";
import {
  assignBranchMemberSchema,
  branchIdSchema,
  createBranchSchema,
  updateBranchSchema,
} from "./schemas.js";

export const branchRouter = Router();

branchRouter.use(requireSession);

branchRouter.get("/", async (request, response) => {
  const auth = getAuthContext(request);
  const branches = await database.branch.findMany({
    where: {
      tenantId: auth.tenant.id,
      ...(auth.role === "STAFF" ? { memberships: { some: { userId: auth.user.id } } } : {}),
    },
    orderBy: [{ isPrimary: "desc" }, { name: "asc" }],
    include: { _count: { select: { memberships: true, sectors: true, tables: true, orders: true } } },
  });
  response.json({ branches, activeBranchId: auth.branch.id });
});

branchRouter.post("/", requireRoles("OWNER", "ADMIN"), requireWritableSubscription, async (request, response) => {
  const auth = getAuthContext(request);
  const input = createBranchSchema.parse(request.body);
  try {
    const branch = await database.$transaction(async (transaction) => {
      const created = await transaction.branch.create({ data: { tenantId: auth.tenant.id, ...input } });
      const station = await transaction.kitchenStation.create({ data: { tenantId: auth.tenant.id, branchId: created.id, name: "Cocina", type: "KITCHEN" } });
      const products = await transaction.product.findMany({
        where: { tenantId: auth.tenant.id },
        select: { id: true, featured: true, featuredOrder: true },
      });
      if (products.length) {
        await transaction.branchMenuItem.createMany({
          data: products.map((product) => ({
            tenantId: auth.tenant.id,
            branchId: created.id,
            productId: product.id,
            featured: product.featured,
            sortOrder: product.featuredOrder,
          })),
        });
        await transaction.kitchenStationMenuItem.createMany({ data: products.map((product) => ({ tenantId: auth.tenant.id, branchId: created.id, stationId: station.id, productId: product.id })) });
      }
      return created;
    });
    response.status(201).json({ branch });
  } catch (error) {
    if ((error as { code?: string }).code === "P2002") {
      throw new HttpError(409, "Ya existe una sucursal con ese slug");
    }
    throw error;
  }
});

branchRouter.patch("/:id", requireRoles("OWNER", "ADMIN"), requireWritableSubscription, async (request, response) => {
  const auth = getAuthContext(request);
  const id = branchIdSchema.parse(request.params.id);
  const input = updateBranchSchema.parse(request.body);
  const existing = await database.branch.findFirst({ where: { id, tenantId: auth.tenant.id } });
  if (!existing) throw new HttpError(404, "Sucursal no encontrada");
  if (existing.isPrimary && input.status === "INACTIVE") {
    throw new HttpError(409, "La sucursal principal no puede desactivarse");
  }
  try {
    const branch = await database.branch.update({ where: { id }, data: input });
    response.json({ branch });
  } catch (error) {
    if ((error as { code?: string }).code === "P2002") {
      throw new HttpError(409, "Ya existe una sucursal con ese slug");
    }
    throw error;
  }
});

branchRouter.get("/:id/members", requireRoles("OWNER", "ADMIN"), async (request, response) => {
  const auth = getAuthContext(request);
  const branchId = branchIdSchema.parse(request.params.id);
  const branch = await database.branch.findFirst({ where: { id: branchId, tenantId: auth.tenant.id }, select: { id: true } });
  if (!branch) throw new HttpError(404, "Sucursal no encontrada");
  const members = await database.membershipBranch.findMany({
    where: { tenantId: auth.tenant.id, branchId },
    orderBy: { createdAt: "asc" },
    include: { user: { select: { id: true, email: true, firstName: true, lastName: true } } },
  });
  response.json({ members });
});

branchRouter.put("/:branchId/members/:userId", requireRoles("OWNER", "ADMIN"), requireWritableSubscription, async (request, response) => {
  const auth = getAuthContext(request);
  const branchId = branchIdSchema.parse(request.params.branchId);
  const userId = branchIdSchema.parse(request.params.userId);
  const input = assignBranchMemberSchema.parse(request.body);
  const [branch, membership] = await Promise.all([
    database.branch.findFirst({ where: { id: branchId, tenantId: auth.tenant.id }, select: { id: true } }),
    database.membership.findUnique({ where: { tenantId_userId: { tenantId: auth.tenant.id, userId } } }),
  ]);
  if (!branch) throw new HttpError(404, "Sucursal no encontrada");
  if (!membership) throw new HttpError(404, "Miembro no encontrado");
  if (membership.role !== "STAFF") throw new HttpError(409, "OWNER y ADMIN ya tienen acceso a todas las sucursales");
  if (input.stationId) {
    const station = await database.kitchenStation.findFirst({ where: { id: input.stationId, tenantId: auth.tenant.id, branchId, active: true }, select: { id: true } });
    if (!station) throw new HttpError(404, "Estación no encontrada");
  }
  const access = await database.membershipBranch.upsert({
    where: { tenantId_branchId_userId: { tenantId: auth.tenant.id, branchId, userId } },
    update: { role: input.role, stationId: input.role === "KITCHEN" ? input.stationId : null },
    create: { tenantId: auth.tenant.id, branchId, userId, role: input.role, stationId: input.role === "KITCHEN" ? input.stationId : null },
  });
  response.json({ access });
});

branchRouter.delete("/:branchId/members/:userId", requireRoles("OWNER", "ADMIN"), requireWritableSubscription, async (request, response) => {
  const auth = getAuthContext(request);
  const branchId = branchIdSchema.parse(request.params.branchId);
  const userId = branchIdSchema.parse(request.params.userId);
  const access = await database.membershipBranch.findUnique({
    where: { tenantId_branchId_userId: { tenantId: auth.tenant.id, branchId, userId } },
  });
  if (!access) throw new HttpError(404, "Acceso de sucursal no encontrado");
  const accessCount = await database.membershipBranch.count({ where: { tenantId: auth.tenant.id, userId } });
  if (accessCount <= 1) throw new HttpError(409, "El miembro debe conservar acceso al menos a una sucursal");
  await database.membershipBranch.delete({
    where: { tenantId_branchId_userId: { tenantId: auth.tenant.id, branchId, userId } },
  });
  response.status(204).send();
});
