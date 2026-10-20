import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import bcrypt from "bcryptjs";
import request from "supertest";

import { app } from "../src/app.js";
import { database } from "../src/database.js";

const ownerEmail = "owner@admin-panel-test.local";
const otherEmail = "other@admin-panel-test.local";
const staffEmail = "staff@admin-panel-test.local";
const ownerSlug = "admin-panel-alpha";
const otherSlug = "admin-panel-beta";
const password = "StrongPass123!";

const ownerAgent = request.agent(app);
const otherAgent = request.agent(app);
const staffAgent = request.agent(app);
let ownerCategoryId = "";
let otherCategoryId = "";
let ownerProductId = "";
let otherProductId = "";

async function cleanup(): Promise<void> {
  await database.order.deleteMany({ where: { tenant: { slug: { in: [ownerSlug, otherSlug] } } } });
  await database.tenant.deleteMany({ where: { slug: { in: [ownerSlug, otherSlug] } } });
  await database.user.deleteMany({
    where: { email: { in: [ownerEmail, otherEmail, staffEmail] } },
  });
}

before(async () => {
  await cleanup();

  for (const [agent, email, slug, name] of [
    [ownerAgent, ownerEmail, ownerSlug, "Tienda Alpha"],
    [otherAgent, otherEmail, otherSlug, "Tienda Beta"],
  ] as const) {
    const response = await agent.post("/api/auth/register").send({
      email,
      password,
      firstName: "Admin",
      lastName: "Test",
      storeName: name,
      storeSlug: slug,
    });
    assert.equal(response.status, 201);
  }
});

after(async () => {
  await cleanup();
  await database.$disconnect();
});

test("cada tienda crea y lista únicamente sus categorías", async () => {
  const rejectedTenantId = await ownerAgent.post("/api/admin/categories").send({
    name: "Manipulada",
    slug: "manipulada",
    tenantId: "otro-tenant",
  });
  assert.equal(rejectedTenantId.status, 400);

  const ownerCategory = await ownerAgent
    .post("/api/admin/categories")
    .send({ name: "Ropa", slug: "ropa" });
  const otherCategory = await otherAgent
    .post("/api/admin/categories")
    .send({ name: "Hogar", slug: "hogar" });

  assert.equal(ownerCategory.status, 201);
  assert.equal(otherCategory.status, 201);
  ownerCategoryId = ownerCategory.body.category.id;
  otherCategoryId = otherCategory.body.category.id;

  const ownerList = await ownerAgent.get("/api/admin/categories");
  assert.equal(ownerList.status, 200);
  assert.deepEqual(ownerList.body.categories.map(({ slug }: { slug: string }) => slug), ["ropa"]);
});

test("productos controlan precio, stock, imágenes, categoría y estado", async () => {
  const crossTenantCategory = await ownerAgent.post("/api/admin/products").send({
    categoryId: otherCategoryId,
    sku: "ALPHA-INVALID",
    slug: "producto-invalido",
    name: "Producto inválido",
    priceInCents: 1000,
    stock: 1,
    images: [],
    active: true,
  });
  assert.equal(crossTenantCategory.status, 400);

  const ownerProduct = await ownerAgent.post("/api/admin/products").send({
    categoryId: ownerCategoryId,
    sku: "ALPHA-001",
    slug: "campera-alpha",
    name: "Campera Alpha",
    description: "Producto de prueba",
    priceInCents: 125000,
    stock: 9,
    images: ["https://images.example.com/campera-alpha.jpg"],
    active: true,
  });
  const otherProduct = await otherAgent.post("/api/admin/products").send({
    categoryId: otherCategoryId,
    sku: "BETA-001",
    slug: "lampara-beta",
    name: "Lámpara Beta",
    priceInCents: 89000,
    stock: 4,
    images: [],
    active: true,
  });

  assert.equal(ownerProduct.status, 201);
  assert.equal(otherProduct.status, 201);
  ownerProductId = ownerProduct.body.product.id;
  otherProductId = otherProduct.body.product.id;

  const update = await ownerAgent.patch(`/api/admin/products/${ownerProductId}`).send({
    priceInCents: 135000,
    stock: 7,
    active: false,
    images: [
      "https://images.example.com/campera-alpha.jpg",
      "https://images.example.com/campera-alpha-2.jpg",
    ],
  });
  assert.equal(update.status, 200);
  assert.equal(update.body.product.priceInCents, 135000);
  assert.equal(update.body.product.stock, 7);
  assert.equal(update.body.product.active, false);
  assert.equal(update.body.product.images.length, 2);

  const ownerList = await ownerAgent.get("/api/admin/products");
  assert.equal(ownerList.body.products.length, 1);
  assert.equal(ownerList.body.products[0].sku, "ALPHA-001");

  const crossTenantUpdate = await ownerAgent
    .patch(`/api/admin/products/${otherProductId}`)
    .send({ stock: 999 });
  assert.equal(crossTenantUpdate.status, 404);
});

test("el catálogo pagina, busca y filtra los productos en el servidor", async () => {
  const response = await ownerAgent
    .get("/api/admin/products")
    .query({ search: "campera", visibility: "HIDDEN", page: 1, pageSize: 1 });

  assert.equal(response.status, 200);
  assert.equal(response.body.products.length, 1);
  assert.equal(response.body.products[0].sku, "ALPHA-001");
  assert.deepEqual(response.body.pagination, { page: 1, pageSize: 1, total: 1, totalPages: 1 });
  assert.equal(response.body.summary.total, 1);
  assert.equal(response.body.summary.active, 0);
  assert.equal(typeof response.body.summary.limit, "number");
});

test("la importación CSV valida primero y luego crea productos y categorías", async () => {
  const csv = [
    "SKU;Nombre;Precio;Stock;Categoría;Marca;Etiquetas;Activo",
    "ALPHA-CSV;Producto desde Excel;25.500,50;12;Importados;InfinityDev;hogar|nuevo;Sí",
  ].join("\r\n");

  const preview = await ownerAgent
    .post("/api/admin/products/import/preview")
    .field("mode", "CREATE_ONLY")
    .attach("file", Buffer.from(csv, "utf8"), { filename: "productos.csv", contentType: "text/csv" });

  assert.equal(preview.status, 200);
  assert.equal(preview.body.valid, true);
  assert.equal(preview.body.creates, 1);
  assert.equal(preview.body.updates, 0);
  assert.deepEqual(preview.body.categoriesToCreate, ["Importados"]);
  assert.equal(preview.body.sample[0].priceInCents, 2550050);

  const imported = await ownerAgent
    .post("/api/admin/products/import")
    .field("mode", "CREATE_ONLY")
    .attach("file", Buffer.from(csv, "utf8"), { filename: "productos.csv", contentType: "text/csv" });

  assert.equal(imported.status, 201);
  assert.deepEqual(imported.body, { created: 1, updated: 0, categoriesCreated: 1, total: 1 });

  const product = await database.product.findFirstOrThrow({ where: { sku: "ALPHA-CSV" }, include: { category: true } });
  assert.equal(product.tenantId, (await database.tenant.findUniqueOrThrow({ where: { slug: ownerSlug } })).id);
  assert.equal(product.priceInCents, 2550050);
  assert.equal(product.category?.name, "Importados");
  await database.product.delete({ where: { id: product.id } });
  await database.category.delete({ where: { id: product.categoryId! } });
});

test("configuración y dashboard pertenecen a la tienda de la sesión", async () => {
  const settings = await ownerAgent.patch("/api/admin/store").send({
    name: "Alpha renovada",
    description: "Tienda de indumentaria",
    logoUrl: "https://images.example.com/alpha-logo.png",
    bannerUrl: "/demo-store/coleccion-nebula.webp",
    primaryColor: "#B89B72",
    contactEmail: "ventas@alpha.test",
    whatsapp: "+5491100000000",
    instagramUrl: "https://instagram.com/alpha",
    facebookUrl: "https://facebook.com/alpha",
    tiktokUrl: "https://tiktok.com/@alpha",
    xUrl: "https://x.com/alpha",
    youtubeUrl: "https://youtube.com/@alpha",
    currency: "ars",
  });
  assert.equal(settings.status, 200);
  assert.equal(settings.body.store.name, "Alpha renovada");
  assert.equal(settings.body.store.settings.currency, "ARS");
  assert.equal(settings.body.store.settings.instagramUrl, "https://instagram.com/alpha");
  assert.equal(settings.body.store.settings.bannerUrl, "/demo-store/coleccion-nebula.webp");

  const publicStore = await request(app).get(`/api/storefront/${ownerSlug}`);
  assert.equal(publicStore.status, 200);
  assert.equal(publicStore.body.store.settings.youtubeUrl, "https://youtube.com/@alpha");
  assert.equal(
    (await ownerAgent.patch("/api/admin/store").send({ instagramUrl: "https://example.com/no-es-instagram" })).status,
    400,
  );

  const dashboard = await ownerAgent.get("/api/admin/dashboard");
  assert.equal(dashboard.status, 200);
  assert.equal(dashboard.body.metrics.categories, 1);
  assert.equal(dashboard.body.metrics.products, 1);
  assert.equal(dashboard.body.metrics.activeProducts, 0);
});

test("STAFF puede consultar pero no modificar el catálogo", async () => {
  const tenant = await database.tenant.findUniqueOrThrow({ where: { slug: ownerSlug } });
  const staff = await database.user.create({
    data: {
      email: staffEmail,
      passwordHash: await bcrypt.hash(password, 12),
      firstName: "Staff",
      lastName: "Test",
      memberships: { create: { tenantId: tenant.id, role: "STAFF" } },
    },
  });
  assert.ok(staff.id);
  const primaryBranch = await database.branch.findFirstOrThrow({
    where: { tenantId: tenant.id, isPrimary: true },
  });
  await database.membershipBranch.create({
    data: { tenantId: tenant.id, branchId: primaryBranch.id, userId: staff.id, role: "STAFF" },
  });

  const login = await staffAgent
    .post("/api/auth/login")
    .send({ email: staffEmail, password, tenantSlug: ownerSlug });
  assert.equal(login.status, 200);
  assert.equal((await staffAgent.get("/api/admin/products")).status, 200);
  assert.equal(
    (
      await staffAgent
        .post("/api/admin/categories")
        .send({ name: "Sin permiso", slug: "sin-permiso" })
    ).status,
    403,
  );
});

test("gestión registra una venta local, descuenta stock y lo repone al anular", async () => {
  const tenant = await database.tenant.findUniqueOrThrow({ where: { slug: ownerSlug } });
  const product = await database.product.create({ data: {
    tenantId: tenant.id, sku: "LOCAL-001", slug: "producto-local", name: "Producto del local",
    priceInCents: 100_000, stock: 8, active: true,
  } });

  const created = await staffAgent.post("/api/admin/management/sales").send({
    operationId: "9df5926f-8793-42e3-869c-1c369c42c1ed",
    items: [{ productId: product.id, quantity: 2 }],
    discount: { type: "PERCENTAGE", value: 10 },
    paymentMethod: "CASH",
    customer: { name: "Cliente mostrador", email: "", phone: "" },
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.sale.channel, "LOCAL");
  assert.equal(created.body.sale.totalInCents, 180_000);
  assert.equal((await database.product.findUniqueOrThrow({ where: { id: product.id } })).stock, 6);
  assert.equal(await database.stockMovement.count({ where: { orderId: created.body.sale.id, type: "LOCAL_SALE" } }), 1);

  const retried = await staffAgent.post("/api/admin/management/sales").send({
    operationId: "9df5926f-8793-42e3-869c-1c369c42c1ed",
    items: [{ productId: product.id, quantity: 2 }],
    discount: { type: "PERCENTAGE", value: 10 },
    paymentMethod: "CASH",
  });
  assert.equal(retried.status, 201);
  assert.equal(retried.body.sale.id, created.body.sale.id);
  assert.equal((await database.product.findUniqueOrThrow({ where: { id: product.id } })).stock, 6);

  const cancelled = await ownerAgent.post(`/api/admin/management/sales/${created.body.sale.id}/cancel`);
  assert.equal(cancelled.status, 200);
  assert.equal(cancelled.body.sale.status, "CANCELLED");
  assert.equal((await database.product.findUniqueOrThrow({ where: { id: product.id } })).stock, 8);

  const adjusted = await ownerAgent.post("/api/admin/management/stock-adjustments").send({
    productId: product.id, newStock: 11, note: "Recuento físico",
  });
  assert.equal(adjusted.status, 201);
  assert.equal(adjusted.body.movement.quantityDelta, 3);
  assert.equal(adjusted.body.movement.stockAfter, 11);
});

test("el CRUD elimina recursos propios en orden seguro", async () => {
  const categoryInUse = await ownerAgent.delete(`/api/admin/categories/${ownerCategoryId}`);
  assert.equal(categoryInUse.status, 409);

  assert.equal((await ownerAgent.delete(`/api/admin/products/${ownerProductId}`)).status, 204);
  assert.equal((await ownerAgent.delete(`/api/admin/categories/${ownerCategoryId}`)).status, 204);
  assert.equal((await ownerAgent.delete(`/api/admin/products/${otherProductId}`)).status, 404);
});
