import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import request from "supertest";

import { app } from "../src/app.js";
import { database } from "../src/database.js";

const agent = request.agent(app);
const tenantSlug = "menu-stage-two";
const email = "menu-stage-two@example.test";
const password = "ClaveSegura123!";
let productId = "";
let secondBranchId = "";

before(async () => {
  await database.tenant.deleteMany({ where: { slug: tenantSlug } });
  await database.user.deleteMany({ where: { email } });
  const registration = await agent.post("/api/auth/register").send({
    email, password, firstName: "Carta", lastName: "Prueba", storeName: "Bistró Etapa Dos", storeSlug: tenantSlug,
  });
  assert.equal(registration.status, 201);
  const category = await agent.post("/api/admin/categories").send({ name: "Principales", slug: "principales", description: "Platos de la casa", displayOrder: 10, active: true });
  assert.equal(category.status, 201);
  const product = await agent.post("/api/admin/products").send({
    categoryId: category.body.category.id, sku: "MENU-001", slug: "hamburguesa-casa", name: "Hamburguesa de la casa",
    description: "Pan de masa madre y carne", priceInCents: 1200000, stock: 100, images: [], active: true,
    brand: null, tags: [], featured: true, featuredOrder: 1, preparationTimeMinutes: 18,
    allergens: ["gluten"], dietaryTags: [],
  });
  assert.equal(product.status, 201);
  productId = product.body.product.id as string;
  const branch = await agent.post("/api/admin/branches").send({ slug: "costanera", name: "Costanera", timezone: "America/Argentina/Buenos_Aires" });
  assert.equal(branch.status, 201);
  secondBranchId = branch.body.branch.id as string;
});

after(async () => {
  await database.tenant.deleteMany({ where: { slug: tenantSlug } });
  await database.user.deleteMany({ where: { email } });
  await database.$disconnect();
});

test("cada producto nuevo se incorpora a las cartas de todas las sucursales", async () => {
  const tenant = await database.tenant.findUniqueOrThrow({ where: { slug: tenantSlug }, include: { branches: true } });
  const links = await database.branchMenuItem.findMany({ where: { tenantId: tenant.id, productId } });
  assert.equal(links.length, tenant.branches.length);
});

test("la carta pública expone datos gastronómicos sin identificadores de tenant", async () => {
  const response = await request(app).get(`/api/menu/${tenantSlug}/principal`);
  assert.equal(response.status, 200);
  assert.equal(response.body.restaurant.name, "Bistró Etapa Dos");
  assert.equal(response.body.categories[0].items[0].preparationTimeMinutes, 18);
  assert.deepEqual(response.body.categories[0].items[0].allergens, ["gluten"]);
  assert.equal(response.body.tenantId, undefined);
});

test("precio y disponibilidad se configuran de forma independiente por sucursal", async () => {
  const selected = await agent.post("/api/auth/select-branch").send({ branchId: secondBranchId });
  assert.equal(selected.status, 200);
  const update = await agent.put(`/api/admin/menu/items/${productId}`).send({ availability: "SOLD_OUT", priceOverrideInCents: 1350000, sortOrder: 5, featured: false });
  assert.equal(update.status, 200);
  const secondMenu = await request(app).get(`/api/menu/${tenantSlug}/costanera`);
  assert.equal(secondMenu.body.categories[0].items[0].availability, "SOLD_OUT");
  assert.equal(secondMenu.body.categories[0].items[0].priceInCents, 1350000);
  const primaryMenu = await request(app).get(`/api/menu/${tenantSlug}/principal`);
  assert.equal(primaryMenu.body.categories[0].items[0].availability, "AVAILABLE");
  assert.equal(primaryMenu.body.categories[0].items[0].priceInCents, 1200000);
});

test("la carta QR devuelve SVG para la sucursal activa", async () => {
  const response = await agent.get("/api/admin/menu/qr.svg");
  assert.equal(response.status, 200);
  assert.match(response.headers["content-type"], /image\/svg\+xml/);
  assert.match(response.headers["content-disposition"], /carta-menu-stage-two-costanera\.svg/);
});
