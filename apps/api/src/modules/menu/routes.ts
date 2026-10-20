import { Router } from "express";
import QRCode from "qrcode";

import { environment } from "../../config.js";
import { database } from "../../database.js";
import { HttpError } from "../../errors.js";
import { getAuthContext, requireBranchRoles, requireSession } from "../auth/session.js";
import { requireWritableSubscription } from "../saas/limits.js";
import { menuProductIdSchema, publicSlugSchema, updateBranchMenuItemSchema } from "./schemas.js";

export const publicMenuRouter = Router();
export const adminMenuRouter = Router();

publicMenuRouter.get("/:tenantSlug/:branchSlug", async (request, response) => {
  const tenantSlug = publicSlugSchema.parse(request.params.tenantSlug);
  const branchSlug = publicSlugSchema.parse(request.params.branchSlug);
  const branch = await database.branch.findFirst({
    where: { slug: branchSlug, status: "ACTIVE", tenant: { slug: tenantSlug, status: "ACTIVE" } },
    select: {
      id: true, name: true, slug: true, address: true, city: true, phone: true,
      tenant: { select: { name: true, slug: true, settings: { select: { description: true, logoUrl: true, bannerUrl: true, primaryColor: true, secondaryColor: true, currency: true, whatsapp: true } } } },
      menuItems: {
        where: { availability: { not: "HIDDEN" }, product: { active: true, category: { is: { active: true } } } },
        orderBy: [{ featured: "desc" }, { sortOrder: "asc" }, { product: { name: "asc" } }],
        select: {
          availability: true, priceOverrideInCents: true, featured: true,
          product: { select: {
            id: true, slug: true, name: true, description: true, images: true, priceInCents: true,
            preparationTimeMinutes: true, allergens: true, dietaryTags: true,
            category: { select: { id: true, name: true, slug: true, description: true, displayOrder: true } },
          } },
        },
      },
    },
  });
  if (!branch) throw new HttpError(404, "Carta no encontrada");

  const grouped = new Map<string, { id: string; name: string; slug: string; description: string | null; displayOrder: number; items: Array<Record<string, unknown>> }>();
  for (const menuItem of branch.menuItems) {
    const category = menuItem.product.category;
    if (!category) continue;
    const current = grouped.get(category.id) ?? { ...category, items: [] };
    current.items.push({
      id: menuItem.product.id, slug: menuItem.product.slug, name: menuItem.product.name,
      description: menuItem.product.description, image: menuItem.product.images[0] ?? null,
      priceInCents: menuItem.priceOverrideInCents ?? menuItem.product.priceInCents,
      preparationTimeMinutes: menuItem.product.preparationTimeMinutes,
      allergens: menuItem.product.allergens, dietaryTags: menuItem.product.dietaryTags,
      availability: menuItem.availability, featured: menuItem.featured,
    });
    grouped.set(category.id, current);
  }

  const { tenant, menuItems: _menuItems, ...publicBranch } = branch;
  response.setHeader("Cache-Control", "public, max-age=30, stale-while-revalidate=120");
  response.json({
    restaurant: tenant,
    branch: publicBranch,
    categories: [...grouped.values()].sort((left, right) => left.displayOrder - right.displayOrder || left.name.localeCompare(right.name)),
  });
});

adminMenuRouter.use(requireSession);

adminMenuRouter.get("/", async (request, response) => {
  const auth = getAuthContext(request);
  const items = await database.branchMenuItem.findMany({
    where: { tenantId: auth.tenant.id, branchId: auth.branch.id },
    orderBy: [{ product: { category: { displayOrder: "asc" } } }, { sortOrder: "asc" }, { product: { name: "asc" } }],
    include: { product: { include: { category: { select: { id: true, name: true } } } } },
  });
  response.json({ branch: auth.branch, menuPath: `/carta/${auth.tenant.slug}/${auth.branch.slug}`, items });
});

adminMenuRouter.get("/qr.svg", async (request, response) => {
  const auth = getAuthContext(request);
  const url = `${environment.WEB_URL.replace(/\/$/, "")}/carta/${encodeURIComponent(auth.tenant.slug)}/${encodeURIComponent(auth.branch.slug)}`;
  const svg = await QRCode.toString(url, { type: "svg", errorCorrectionLevel: "M", margin: 2, width: 640 });
  response.type("image/svg+xml");
  response.setHeader("Content-Disposition", `inline; filename="carta-${auth.tenant.slug}-${auth.branch.slug}.svg"`);
  response.send(svg);
});

adminMenuRouter.put("/items/:productId", requireBranchRoles("MANAGER"), requireWritableSubscription, async (request, response) => {
  const auth = getAuthContext(request);
  const productId = menuProductIdSchema.parse(request.params.productId);
  const input = updateBranchMenuItemSchema.parse(request.body);
  const product = await database.product.findFirst({ where: { id: productId, tenantId: auth.tenant.id }, select: { id: true } });
  if (!product) throw new HttpError(404, "Plato no encontrado");
  const item = await database.branchMenuItem.upsert({
    where: { tenantId_branchId_productId: { tenantId: auth.tenant.id, branchId: auth.branch.id, productId } },
    update: input,
    create: { tenantId: auth.tenant.id, branchId: auth.branch.id, productId, ...input },
    include: { product: { include: { category: { select: { id: true, name: true } } } } },
  });
  response.json({ item });
});
