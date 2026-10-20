import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import request from "supertest";

import { app } from "../src/app.js";
import { database } from "../src/database.js";

const alphaSlug = "storefront-alpha";
const betaSlug = "storefront-beta";
const suspendedSlug = "storefront-suspended";

async function cleanup(): Promise<void> {
  await database.tenant.deleteMany({
    where: { slug: { in: [alphaSlug, betaSlug, suspendedSlug] } },
  });
}

before(async () => {
  await cleanup();

  const alpha = await database.tenant.create({
    data: {
      name: "Tienda pública Alpha",
      slug: alphaSlug,
      settings: { create: { description: "Catálogo Alpha", currency: "ARS" } },
      categories: { create: { name: "Ropa", slug: "ropa" } },
      branches: { create: { slug: "principal", name: "Casa central", isPrimary: true } },
    },
    include: { categories: true, branches: true },
  });
  const beta = await database.tenant.create({
    data: {
      name: "Tienda pública Beta",
      slug: betaSlug,
      categories: { create: { name: "Hogar", slug: "hogar" } },
      branches: { create: { slug: "principal", name: "Casa central", isPrimary: true } },
    },
    include: { categories: true, branches: true },
  });

  await database.tenant.create({
    data: { name: "Tienda suspendida", slug: suspendedSlug, status: "SUSPENDED" },
  });
  await database.product.createMany({
    data: [
      {
        tenantId: alpha.id,
        categoryId: alpha.categories[0]!.id,
        sku: "ALPHA-PUBLIC",
        slug: "campera-publica",
        name: "Campera pública",
        priceInCents: 125000,
        stock: 4,
        brand: "Norte",
        tags: ["invierno"],
        active: true,
      },
      {
        tenantId: alpha.id,
        categoryId: alpha.categories[0]!.id,
        sku: "ALPHA-PUBLIC-2",
        slug: "remera-publica",
        name: "Remera pública",
        priceInCents: 65000,
        stock: 8,
        brand: "Sur",
        tags: ["verano"],
        active: true,
      },
      {
        tenantId: alpha.id,
        categoryId: alpha.categories[0]!.id,
        sku: "ALPHA-HIDDEN",
        slug: "campera-oculta",
        name: "Campera oculta",
        priceInCents: 90000,
        stock: 2,
        active: false,
      },
      {
        tenantId: beta.id,
        categoryId: beta.categories[0]!.id,
        sku: "BETA-PUBLIC",
        slug: "lampara-publica",
        name: "Lámpara pública",
        priceInCents: 45000,
        stock: 3,
        active: true,
      },
    ],
  });
  const customer = await database.customer.create({
    data: {
      tenantId: alpha.id,
      email: "comprador@alpha.test",
      firstName: "Ana",
      lastName: "Compradora",
    },
  });
  await database.order.create({
    data: {
      tenantId: alpha.id,
      branchId: alpha.branches[0]!.id,
      customerId: customer.id,
      number: 1,
      customerEmail: customer.email,
      customerName: `${customer.firstName} ${customer.lastName}`,
      subtotalInCents: 125000,
      totalInCents: 125000,
    },
  });
});

after(async () => {
  await cleanup();
  await database.$disconnect();
});

test("el catálogo público solo expone productos activos de su tienda", async () => {
  const response = await request(app).get(`/api/storefront/${alphaSlug}`);

  assert.equal(response.status, 200);
  assert.equal(response.body.store.slug, alphaSlug);
  assert.deepEqual(
    response.body.store.products
      .map(({ slug }: { slug: string }) => slug)
      .sort(),
    ["campera-publica", "remera-publica"],
  );
  assert.equal(response.body.store.categories[0]._count.products, 2);
});

test("el catálogo completo pagina y filtra los productos desde el servidor", async () => {
  const firstPage = await request(app).get(
    `/api/storefront/${alphaSlug}/products?category=ropa&tag=invierno&limit=1&page=1`,
  );

  assert.equal(firstPage.status, 200);
  assert.equal(firstPage.body.pagination.total, 1);
  assert.equal(firstPage.body.pagination.totalPages, 1);
  assert.equal(firstPage.body.products[0].slug, "campera-publica");
  assert.deepEqual(firstPage.body.facets.brands, ["Norte", "Sur"]);

  const search = await request(app).get(
    `/api/storefront/${alphaSlug}/products?search=remera`,
  );
  assert.equal(search.status, 200);
  assert.deepEqual(
    search.body.products.map(({ slug }: { slug: string }) => slug),
    ["remera-publica"],
  );
});

test("el detalle no permite consultar productos ocultos ni de otra tienda", async () => {
  assert.equal(
    (await request(app).get(`/api/storefront/${alphaSlug}/products/campera-publica`)).status,
    200,
  );
  assert.equal(
    (await request(app).get(`/api/storefront/${alphaSlug}/products/campera-oculta`)).status,
    404,
  );
  assert.equal(
    (await request(app).get(`/api/storefront/${alphaSlug}/products/lampara-publica`)).status,
    404,
  );
});

test("el comprador inicia sesión y solo ve pedidos de esa tienda", async () => {
  const registered = await request(app)
    .post(`/api/storefront/${alphaSlug}/customer-auth/register`)
    .send({
      email: "comprador@alpha.test",
      password: "clave-segura-123",
      firstName: "Ana",
      lastName: "Compradora",
    });
  assert.equal(registered.status, 201);
  assert.ok(registered.body.sessionToken);

  const activeSession = await request(app)
    .get(`/api/storefront/${alphaSlug}/customer-auth/session`)
    .set("x-customer-session", registered.body.sessionToken);
  assert.equal(activeSession.status, 200);
  assert.equal(activeSession.body.customer.email, "comprador@alpha.test");

  const orders = await request(app)
    .get(`/api/storefront/${alphaSlug}/customer/orders`)
    .set("x-customer-session", registered.body.sessionToken);
  assert.equal(orders.status, 200);
  assert.equal(orders.body.customer.email, "comprador@alpha.test");
  assert.equal(orders.body.orders.length, 1);
  assert.equal(orders.body.orders[0].number, 1);
  assert.equal(
    (
      await request(app)
        .get(
          `/api/storefront/${alphaSlug}/orders/${orders.body.orders[0].id}`,
        )
        .set("x-customer-session", registered.body.sessionToken)
    ).status,
    200,
  );

  assert.equal(
    (
      await request(app)
        .get(`/api/storefront/${betaSlug}/customer/orders`)
        .set("x-customer-session", registered.body.sessionToken)
    ).status,
    401,
  );
  const loggedIn = await request(app)
    .post(`/api/storefront/${alphaSlug}/customer-auth/login`)
    .send({ email: "comprador@alpha.test", password: "clave-segura-123" });
  assert.equal(loggedIn.status, 200);
  assert.ok(loggedIn.body.sessionToken);
});

test("las tiendas suspendidas no tienen storefront público", async () => {
  assert.equal((await request(app).get(`/api/storefront/${suspendedSlug}`)).status, 404);
});
