import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { createDatabaseClient } from "../src/client.js";
import { createTenantRepository } from "../src/tenant-repository.js";

const database = createDatabaseClient();

before(async () => {
  const tenantCount = await database.tenant.count({
    where: { slug: { in: ["infinityshop-seed", "norte-demo"] } },
  });

  assert.equal(tenantCount, 2, "Ejecutá pnpm db:seed antes de esta prueba");
});

after(async () => {
  await database.$disconnect();
});

test("cada repositorio solo devuelve datos de su tenant", async () => {
  const [infinityShop, norte] = await Promise.all([
    database.tenant.findUniqueOrThrow({ where: { slug: "infinityshop-seed" } }),
    database.tenant.findUniqueOrThrow({ where: { slug: "norte-demo" } }),
  ]);
  const infinityShopRepository = createTenantRepository(database, infinityShop.id);
  const norteRepository = createTenantRepository(database, norte.id);

  const [infinityShopProducts, norteProducts, infinityShopCustomers, norteCustomers] = await Promise.all([
    infinityShopRepository.products.list(),
    norteRepository.products.list(),
    infinityShopRepository.customers.list(),
    norteRepository.customers.list(),
  ]);

  assert.ok(infinityShopProducts.length > 0);
  assert.ok(norteProducts.length > 0);
  assert.ok(infinityShopProducts.every(({ tenantId }) => tenantId === infinityShop.id));
  assert.ok(norteProducts.every(({ tenantId }) => tenantId === norte.id));
  assert.ok(infinityShopCustomers.every(({ tenantId }) => tenantId === infinityShop.id));
  assert.ok(norteCustomers.every(({ tenantId }) => tenantId === norte.id));

  assert.equal(await infinityShopRepository.products.findById(norteProducts[0]!.id), null);
  assert.equal(await norteRepository.products.findById(infinityShopProducts[0]!.id), null);
  assert.equal(await infinityShopRepository.customers.findById(norteCustomers[0]!.id), null);
  assert.equal(await norteRepository.customers.findById(infinityShopCustomers[0]!.id), null);
});

test("PostgreSQL rechaza relaciones que mezclan tenants", async () => {
  const [infinityShop, norteProduct, infinityShopCart] = await Promise.all([
    database.tenant.findUniqueOrThrow({ where: { slug: "infinityshop-seed" } }),
    database.product.findFirstOrThrow({ where: { tenant: { slug: "norte-demo" } } }),
    database.cart.findFirstOrThrow({ where: { tenant: { slug: "infinityshop-seed" } } }),
  ]);

  await assert.rejects(
    database.cartItem.create({
      data: {
        tenantId: infinityShop.id,
        cartId: infinityShopCart.id,
        productId: norteProduct.id,
        quantity: 1,
        unitPriceInCents: norteProduct.priceInCents,
      },
    }),
  );
});

test("PostgreSQL rechaza mover un pedido a una sucursal de otro tenant", async () => {
  const [order, foreignBranch] = await Promise.all([
    database.order.findFirstOrThrow({ where: { tenant: { slug: "infinityshop-seed" } } }),
    database.branch.findFirstOrThrow({ where: { tenant: { slug: "norte-demo" } } }),
  ]);

  await assert.rejects(
    database.order.update({
      where: { id: order.id },
      data: { branchId: foreignBranch.id },
    }),
  );
});

test("PostgreSQL rechaza platos vinculados a una sucursal de otro tenant", async () => {
  const [tenant, product, foreignBranch] = await Promise.all([
    database.tenant.findUniqueOrThrow({ where: { slug: "infinityshop-seed" } }),
    database.product.findFirstOrThrow({ where: { tenant: { slug: "infinityshop-seed" } } }),
    database.branch.findFirstOrThrow({ where: { tenant: { slug: "norte-demo" } } }),
  ]);

  await assert.rejects(
    database.branchMenuItem.create({
      data: { tenantId: tenant.id, branchId: foreignBranch.id, productId: product.id },
    }),
  );
});

test("PostgreSQL rechaza asignar una estación de otro tenant", async () => {
  const [assignment, foreignStation] = await Promise.all([
    database.kitchenStationMenuItem.findFirstOrThrow({ where: { product: { tenant: { slug: "infinityshop-seed" } } } }),
    database.kitchenStation.findFirstOrThrow({ where: { tenant: { slug: "norte-demo" } } }),
  ]);
  await assert.rejects(database.kitchenStationMenuItem.update({
    where: { tenantId_branchId_productId: { tenantId: assignment.tenantId, branchId: assignment.branchId, productId: assignment.productId } },
    data: { stationId: foreignStation.id },
  }));
});

test("email de cliente y número de pedido pueden repetirse en tiendas distintas", async () => {
  const [customers, orders] = await Promise.all([
    database.customer.findMany({
      where: { email: "cliente@example.com", tenant: { slug: { in: ["infinityshop-seed", "norte-demo"] } } },
    }),
    database.order.findMany({
      where: { number: 1, tenant: { slug: { in: ["infinityshop-seed", "norte-demo"] } } },
    }),
  ]);

  assert.equal(customers.length, 2);
  assert.equal(new Set(customers.map(({ tenantId }) => tenantId)).size, 2);
  assert.equal(orders.length, 2);
  assert.equal(new Set(orders.map(({ tenantId }) => tenantId)).size, 2);
});
