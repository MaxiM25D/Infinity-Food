import { Router } from "express";
import { z } from "zod";

import { database } from "../../database.js";
import { HttpError } from "../../errors.js";
import { getAuthContext, requireRoles, requireSession } from "../auth/session.js";
import { requireWritableSubscription } from "../saas/limits.js";

const idSchema = z.string().trim().min(1).max(100);
const saleSchema = z.object({
  operationId: z.string().uuid().optional(),
  items: z.array(z.object({
    productId: idSchema,
    variantId: idSchema.nullish(),
    quantity: z.coerce.number().int().min(1).max(10_000),
  })).min(1).max(100),
  discount: z.object({
    type: z.enum(["NONE", "PERCENTAGE", "FIXED"]),
    value: z.coerce.number().int().min(0).default(0),
  }).default({ type: "NONE", value: 0 }),
  paymentMethod: z.enum(["CASH", "CARD_EXTERNAL", "BANK_TRANSFER", "MERCADO_PAGO_EXTERNAL", "OTHER"]),
  customer: z.object({
    name: z.string().trim().max(120).optional().default(""),
    email: z.string().trim().email().max(180).or(z.literal("")).optional().default(""),
    phone: z.string().trim().max(40).optional().default(""),
  }).optional(),
  notes: z.string().trim().max(500).optional().default(""),
});

const adjustmentSchema = z.object({
  productId: idSchema,
  variantId: idSchema.nullish(),
  newStock: z.coerce.number().int().min(0).max(2_000_000_000),
  note: z.string().trim().min(3, "Indicá el motivo del ajuste").max(240),
});

const dateRangeSchema = z.object({
  from: z.coerce.date(),
  to: z.coerce.date(),
});

const canManageInventory = requireRoles("OWNER", "ADMIN");

export const managementRouter = Router();
managementRouter.use(requireSession);
managementRouter.use((request, response, next) => {
  if (["POST", "PATCH", "DELETE"].includes(request.method)) {
    void requireWritableSubscription(request, response, next);
    return;
  }
  next();
});

managementRouter.get("/catalog", async (request, response) => {
  const { tenant } = getAuthContext(request);
  const search = z.string().trim().max(80).catch("").parse(request.query.search);
  const products = await database.product.findMany({
    where: {
      tenantId: tenant.id,
      active: true,
      ...(search ? { OR: [
        { name: { contains: search, mode: "insensitive" } },
        { sku: { contains: search, mode: "insensitive" } },
      ] } : {}),
    },
    orderBy: [{ name: "asc" }],
    take: 40,
    select: {
      id: true, name: true, sku: true, priceInCents: true, stock: true, images: true,
      variants: {
        where: { active: true },
        orderBy: { name: "asc" },
        select: { id: true, name: true, sku: true, priceInCents: true, stock: true },
      },
    },
  });
  response.json({ products });
});

managementRouter.get("/overview", async (request, response) => {
  const { tenant, branch } = getAuthContext(request);
  const now = new Date();
  const fallbackFrom = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const fallbackTo = new Date(fallbackFrom.getTime() + 24 * 60 * 60 * 1000);
  const range = dateRangeSchema.safeParse(request.query);
  const from = range.success ? range.data.from : fallbackFrom;
  const to = range.success ? range.data.to : fallbackTo;
  if (from >= to) throw new HttpError(400, "El rango de fechas no es válido");

  const saleWhere = {
    tenantId: tenant.id,
    branchId: branch.id,
    channel: "LOCAL" as const,
    status: { not: "CANCELLED" as const },
    paymentStatus: "APPROVED" as const,
    createdAt: { gte: from, lt: to },
  };
  const [summary, paymentBreakdown, recentSales, recentMovements, lowStock, settings] = await Promise.all([
    database.order.aggregate({ where: saleWhere, _count: true, _sum: { totalInCents: true } }),
    database.order.groupBy({ by: ["paymentMethod"], where: saleWhere, _count: true, _sum: { totalInCents: true } }),
    database.order.findMany({
      where: { tenantId: tenant.id, branchId: branch.id, channel: "LOCAL" }, orderBy: { createdAt: "desc" }, take: 12,
      select: { id: true, number: true, customerName: true, totalInCents: true, paymentMethod: true, status: true, createdAt: true, _count: { select: { items: true } } },
    }),
    database.stockMovement.findMany({
      where: { tenantId: tenant.id }, orderBy: { createdAt: "desc" }, take: 15,
      include: { product: { select: { name: true, sku: true } }, variant: { select: { name: true, sku: true } }, changedBy: { select: { firstName: true, lastName: true } } },
    }),
    database.product.findMany({ where: { tenantId: tenant.id, active: true, variants: { none: {} }, stock: { lte: 5 } }, orderBy: { stock: "asc" }, take: 8, select: { id: true, name: true, sku: true, stock: true } }),
    database.storeSettings.findUnique({ where: { tenantId: tenant.id }, select: { currency: true, logoUrl: true } }),
  ]);

  response.json({
    store: { name: tenant.name, currency: settings?.currency ?? "ARS", logoUrl: settings?.logoUrl ?? null },
    today: { sales: summary._count, revenueInCents: summary._sum.totalInCents ?? 0, paymentBreakdown },
    recentSales,
    recentMovements,
    lowStock,
  });
});

managementRouter.post("/sales", async (request, response) => {
  const auth = getAuthContext(request);
  const input = saleSchema.parse(request.body);
  const merged = new Map<string, { productId: string; variantId: string | null; quantity: number }>();
  for (const item of input.items) {
    const key = `${item.productId}:${item.variantId ?? ""}`;
    const existing = merged.get(key);
    if (existing) existing.quantity += item.quantity;
    else merged.set(key, { productId: item.productId, variantId: item.variantId ?? null, quantity: item.quantity });
  }

  const order = await database.$transaction(async (transaction) => {
    await transaction.$queryRaw`SELECT "id" FROM "Tenant" WHERE "id" = ${auth.tenant.id} FOR UPDATE`;
    if (input.operationId) {
      const existing = await transaction.order.findFirst({ where: { tenantId: auth.tenant.id, channel: "LOCAL", localSaleKey: input.operationId }, select: { id: true } });
      if (existing) return existing;
    }
    const lines = [];
    for (const requested of merged.values()) {
      const product = await transaction.product.findFirst({
        where: { id: requested.productId, tenantId: auth.tenant.id, active: true },
        include: { variants: requested.variantId ? { where: { id: requested.variantId, active: true } } : false },
      });
      if (!product) throw new HttpError(404, "Uno de los productos ya no está disponible");
      const variant = requested.variantId ? product.variants[0] : null;
      if (requested.variantId && !variant) throw new HttpError(404, `La variante de ${product.name} ya no está disponible`);
      const currentStock = variant?.stock ?? product.stock;
      if (currentStock < requested.quantity) throw new HttpError(409, `Stock insuficiente para ${product.name}${variant ? ` · ${variant.name}` : ""}. Disponible: ${currentStock}`);
      lines.push({ product, variant, quantity: requested.quantity, unitPriceInCents: variant?.priceInCents ?? product.priceInCents });
    }

    const subtotalInCents = lines.reduce((sum, line) => sum + line.quantity * line.unitPriceInCents, 0);
    const discountInCents = input.discount.type === "PERCENTAGE"
      ? Math.round(subtotalInCents * Math.min(input.discount.value, 100) / 100)
      : input.discount.type === "FIXED" ? Math.min(input.discount.value, subtotalInCents) : 0;
    const last = await transaction.order.findFirst({ where: { tenantId: auth.tenant.id }, orderBy: { number: "desc" }, select: { number: true } });
    const settings = await transaction.storeSettings.findUnique({ where: { tenantId: auth.tenant.id }, select: { currency: true } });
    const customerName = input.customer?.name || "Consumidor final";
    let customerId: string | null = null;
    if (input.customer?.email) {
      const parts = customerName === "Consumidor final" ? ["Cliente"] : customerName.split(/\s+/);
      const customer = await transaction.customer.upsert({
        where: { tenantId_email: { tenantId: auth.tenant.id, email: input.customer.email.toLowerCase() } },
        update: { phone: input.customer.phone || undefined },
        create: { tenantId: auth.tenant.id, email: input.customer.email.toLowerCase(), firstName: parts[0] ?? "Cliente", lastName: parts.slice(1).join(" ") || "Local", phone: input.customer.phone || null },
      });
      customerId = customer.id;
    }

    const created = await transaction.order.create({
      data: {
        tenantId: auth.tenant.id, branchId: auth.branch.id, customerId, number: (last?.number ?? 0) + 1, channel: "LOCAL", soldByUserId: auth.user.id, localSaleKey: input.operationId ?? null,
        status: "DELIVERED", paymentStatus: "APPROVED", paymentMethod: input.paymentMethod, stockStatus: "COMMITTED",
        customerName, customerEmail: input.customer?.email?.toLowerCase() ?? "", customerPhone: input.customer?.phone || null,
        notes: input.notes || null, currency: settings?.currency ?? "ARS", subtotalInCents, discountInCents, totalInCents: subtotalInCents - discountInCents,
        fulfillmentType: "PICKUP",
      },
    });
    await transaction.orderItem.createMany({ data: lines.map(({ product, variant, quantity, unitPriceInCents }) => ({
      tenantId: auth.tenant.id, orderId: created.id, productId: product.id, variantId: variant?.id ?? null, sku: variant?.sku ?? product.sku,
      productName: product.name, variantName: variant?.name ?? null, quantity, unitPriceInCents, subtotalInCents: quantity * unitPriceInCents,
    })) });
    await transaction.orderStatusHistory.create({ data: { tenantId: auth.tenant.id, orderId: created.id, status: "DELIVERED", changedByUserId: auth.user.id, note: "Venta registrada en el local" } });

    for (const line of lines) {
      const updated = line.variant
        ? await transaction.productVariant.updateMany({ where: { tenantId: auth.tenant.id, id: line.variant.id, stock: { gte: line.quantity } }, data: { stock: { decrement: line.quantity } } })
        : await transaction.product.updateMany({ where: { tenantId: auth.tenant.id, id: line.product.id, stock: { gte: line.quantity } }, data: { stock: { decrement: line.quantity } } });
      if (updated.count !== 1) throw new HttpError(409, `El stock de ${line.product.name} cambió mientras registrabas la venta. Revisalo e intentá nuevamente.`);
      const changed = line.variant
        ? await transaction.productVariant.findUniqueOrThrow({ where: { tenantId_id: { tenantId: auth.tenant.id, id: line.variant.id } }, select: { stock: true } })
        : await transaction.product.findUniqueOrThrow({ where: { tenantId_id: { tenantId: auth.tenant.id, id: line.product.id } }, select: { stock: true } });
      await transaction.stockMovement.create({ data: {
        tenantId: auth.tenant.id, productId: line.product.id, variantId: line.variant?.id ?? null, orderId: created.id,
        changedByUserId: auth.user.id, type: "LOCAL_SALE", quantityDelta: -line.quantity, stockAfter: changed.stock,
        note: `Venta local #${created.number}`,
      } });
    }
    return created;
  });

  response.status(201).json(await saleReceipt(auth.tenant.id, auth.branch.id, order.id));
});

managementRouter.get("/sales/:id", async (request, response) => {
  const { tenant, branch } = getAuthContext(request);
  response.json(await saleReceipt(tenant.id, branch.id, idSchema.parse(request.params.id)));
});

managementRouter.post("/sales/:id/cancel", canManageInventory, async (request, response) => {
  const auth = getAuthContext(request);
  const id = idSchema.parse(request.params.id);
  await database.$transaction(async (transaction) => {
    await transaction.$queryRaw`SELECT "id" FROM "Order" WHERE "tenantId" = ${auth.tenant.id} AND "branchId" = ${auth.branch.id} AND "id" = ${id} FOR UPDATE`;
    const sale = await transaction.order.findFirst({ where: { id, tenantId: auth.tenant.id, branchId: auth.branch.id, channel: "LOCAL" }, include: { items: true } });
    if (!sale) throw new HttpError(404, "No encontramos la venta local");
    if (sale.status === "CANCELLED") throw new HttpError(409, "La venta ya fue anulada");
    for (const item of sale.items) {
      if (!item.productId) continue;
      const changed = item.variantId
        ? await transaction.productVariant.update({ where: { tenantId_id: { tenantId: auth.tenant.id, id: item.variantId } }, data: { stock: { increment: item.quantity } }, select: { stock: true } })
        : await transaction.product.update({ where: { tenantId_id: { tenantId: auth.tenant.id, id: item.productId } }, data: { stock: { increment: item.quantity } }, select: { stock: true } });
      await transaction.stockMovement.create({ data: { tenantId: auth.tenant.id, productId: item.productId, variantId: item.variantId, orderId: sale.id, changedByUserId: auth.user.id, type: "LOCAL_SALE_CANCELLED", quantityDelta: item.quantity, stockAfter: changed.stock, note: `Anulación de venta local #${sale.number}` } });
    }
    await transaction.order.update({ where: { tenantId_id: { tenantId: auth.tenant.id, id } }, data: { status: "CANCELLED", paymentStatus: "REFUNDED", stockStatus: "RELEASED" } });
    await transaction.orderStatusHistory.create({ data: { tenantId: auth.tenant.id, orderId: id, status: "CANCELLED", changedByUserId: auth.user.id, note: "Venta local anulada; el reintegro de dinero se gestiona por fuera de InfinityFood" } });
  });
  response.json(await saleReceipt(auth.tenant.id, auth.branch.id, id));
});

managementRouter.post("/stock-adjustments", canManageInventory, async (request, response) => {
  const auth = getAuthContext(request);
  const input = adjustmentSchema.parse(request.body);
  const movement = await database.$transaction(async (transaction) => {
    if (input.variantId) {
      await transaction.$queryRaw`SELECT "id" FROM "ProductVariant" WHERE "tenantId" = ${auth.tenant.id} AND "id" = ${input.variantId} FOR UPDATE`;
    } else {
      await transaction.$queryRaw`SELECT "id" FROM "Product" WHERE "tenantId" = ${auth.tenant.id} AND "id" = ${input.productId} FOR UPDATE`;
    }
    const product = await transaction.product.findFirst({ where: { tenantId: auth.tenant.id, id: input.productId }, include: { variants: input.variantId ? { where: { id: input.variantId } } : false } });
    if (!product) throw new HttpError(404, "No encontramos el producto");
    const variant = input.variantId ? product.variants[0] : null;
    if (input.variantId && !variant) throw new HttpError(404, "No encontramos la variante");
    const previous = variant?.stock ?? product.stock;
    if (previous === input.newStock) throw new HttpError(409, "El stock nuevo es igual al actual");
    if (variant) await transaction.productVariant.update({ where: { tenantId_id: { tenantId: auth.tenant.id, id: variant.id } }, data: { stock: input.newStock } });
    else await transaction.product.update({ where: { tenantId_id: { tenantId: auth.tenant.id, id: product.id } }, data: { stock: input.newStock } });
    return transaction.stockMovement.create({ data: { tenantId: auth.tenant.id, productId: product.id, variantId: variant?.id ?? null, changedByUserId: auth.user.id, type: "MANUAL_ADJUSTMENT", quantityDelta: input.newStock - previous, stockAfter: input.newStock, note: input.note } });
  });
  response.status(201).json({ movement });
});

async function saleReceipt(tenantId: string, branchId: string, orderId: string) {
  const [sale, tenant] = await Promise.all([
    database.order.findFirst({
      where: { id: orderId, tenantId, branchId, channel: "LOCAL" },
      include: { items: true, soldBy: { select: { firstName: true, lastName: true } } },
    }),
    database.tenant.findUnique({ where: { id: tenantId }, include: { settings: { select: { logoUrl: true, contactEmail: true, whatsapp: true } } } }),
  ]);
  if (!sale || !tenant) throw new HttpError(404, "No encontramos la venta local");
  return { sale, store: { name: tenant.name, ...tenant.settings } };
}
