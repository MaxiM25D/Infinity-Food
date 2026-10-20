import type { Prisma } from "../src/generated/client/client.js";

const DEMO_STORE = {
  name: "Nébula Living",
  description:
    "Objetos de diseño para transformar lo cotidiano. Una selección contemporánea para tu casa, tu ritmo y tus escapadas.",
  bannerUrl: "/demo-store/coleccion-nebula.webp",
  primaryColor: "#6E3482",
  secondaryColor: "#24152B",
  announcement: "ENVÍO GRATIS DESDE $120.000 · 3 CUOTAS SIN INTERÉS",
} as const;

const DEMO_CATEGORIES = [
  { slug: "iluminacion", name: "Iluminación" },
  { slug: "lifestyle", name: "Lifestyle" },
  { slug: "viaje", name: "Viaje" },
  { slug: "bienestar", name: "Bienestar" },
] as const;

const DEMO_PRODUCTS = [
  {
    categorySlug: "iluminacion",
    sku: "NEB-AUR-001",
    slug: "lampara-aurora",
    name: "Lámpara Aurora",
    description:
      "Luz ambiental regulable y una silueta escultórica que cambia por completo cualquier rincón. Ideal para mesas de noche, escritorios y espacios de lectura.",
    images: ["/demo-store/lampara-aurora.webp"],
    priceInCents: 8_990_000,
    stock: 8,
    tags: ["diseño", "luz cálida", "hogar", "regulable"],
    featured: true,
    featuredOrder: 1,
  },
  {
    categorySlug: "viaje",
    sku: "NEB-MET-001",
    slug: "mochila-metro",
    name: "Mochila Metro",
    description:
      "Diseño urbano, liviano y resistente al agua. Incluye compartimento acolchado para notebook y bolsillos internos para mantener todo en orden.",
    images: ["/demo-store/mochila-metro.webp"],
    priceInCents: 7_990_000,
    stock: 12,
    tags: ["urbano", "notebook", "viaje", "resistente al agua"],
    featured: true,
    featuredOrder: 2,
  },
  {
    categorySlug: "bienestar",
    sku: "NEB-NUB-001",
    slug: "difusor-nube",
    name: "Difusor Nube",
    description:
      "Aromatizá tus espacios con una niebla ultrasónica silenciosa y luz ambiental suave. Su acabado mate suma calma sin ocupar de más.",
    images: ["/demo-store/difusor-nube.webp"],
    priceInCents: 6_490_000,
    stock: 16,
    tags: ["aromas", "bienestar", "silencioso", "luz ambiental"],
    featured: true,
    featuredOrder: 3,
  },
  {
    categorySlug: "lifestyle",
    sku: "NEB-ORB-001",
    slug: "botella-termica-orbit",
    name: "Botella térmica Orbit",
    description:
      "Acero inoxidable de doble pared para mantener tus bebidas frías o calientes durante horas. Cómoda, hermética y lista para acompañarte todos los días.",
    images: ["/demo-store/botella-orbit.webp"],
    priceInCents: 3_490_000,
    stock: 24,
    tags: ["térmica", "acero inoxidable", "reutilizable", "lifestyle"],
    featured: false,
    featuredOrder: 4,
  },
] as const;

export async function syncDemoStore(transaction: Prisma.TransactionClient, tenantId: string): Promise<void> {
  await transaction.tenant.update({
    where: { id: tenantId },
    data: { name: DEMO_STORE.name, status: "ACTIVE" },
  });

  const currentSettings = await transaction.storeSettings.findUnique({ where: { tenantId } });
  await transaction.storeSettings.upsert({
    where: { tenantId },
    update: {
      description: DEMO_STORE.description,
      bannerUrl: DEMO_STORE.bannerUrl,
      logoUrl: null,
      primaryColor: DEMO_STORE.primaryColor,
      secondaryColor: DEMO_STORE.secondaryColor,
      fontFamily: "MODERN",
      borderRadius: "SOFT",
      announcement: DEMO_STORE.announcement,
      showPoweredBy: true,
      contactEmail: currentSettings?.contactEmail ?? "hola@infinityshop.com.ar",
      emailFromName: DEMO_STORE.name,
      currency: "ARS",
      bankTransferEnabled: true,
      bankName: currentSettings?.bankName || "Banco Demo",
      bankAlias: currentSettings?.bankAlias || "NEBULA.LIVING",
      bankHolder: currentSettings?.bankHolder || DEMO_STORE.name,
    },
    create: {
      tenantId,
      description: DEMO_STORE.description,
      bannerUrl: DEMO_STORE.bannerUrl,
      primaryColor: DEMO_STORE.primaryColor,
      secondaryColor: DEMO_STORE.secondaryColor,
      fontFamily: "MODERN",
      borderRadius: "SOFT",
      announcement: DEMO_STORE.announcement,
      showPoweredBy: true,
      contactEmail: "hola@infinityshop.com.ar",
      emailFromName: DEMO_STORE.name,
      currency: "ARS",
      bankTransferEnabled: true,
      bankName: "Banco Demo",
      bankAlias: "NEBULA.LIVING",
      bankHolder: DEMO_STORE.name,
    },
  });

  const shippingZone = await transaction.shippingZone.upsert({
    where: { tenantId_name: { tenantId, name: "Argentina" } },
    update: { active: true },
    create: { tenantId, name: "Argentina", postalPrefixes: [], active: true },
  });
  const demoShippingMethods = [
    {
      name: "Envío estándar",
      priceInCents: 650_000,
      estimatedDaysMin: 3,
      estimatedDaysMax: 6,
      freeShippingThresholdInCents: 12_000_000,
      carrierCode: "CORREO_ARGENTINO",
      carrierName: "Correo Argentino",
      trackingUrlTemplate: "https://www.correoargentino.com.ar/seguimiento",
    },
    {
      name: "Envío prioritario",
      priceInCents: 1_050_000,
      estimatedDaysMin: 1,
      estimatedDaysMax: 3,
      freeShippingThresholdInCents: null,
      carrierCode: "ANDREANI",
      carrierName: "Andreani",
      trackingUrlTemplate: "https://www.andreani.com/",
    },
  ] as const;
  for (const method of demoShippingMethods) {
    const existing = await transaction.shippingMethod.findFirst({
      where: { tenantId, shippingZoneId: shippingZone.id, name: method.name },
      select: { id: true },
    });
    if (existing) {
      await transaction.shippingMethod.update({ where: { id: existing.id }, data: { ...method, active: true } });
    } else {
      await transaction.shippingMethod.create({ data: { tenantId, shippingZoneId: shippingZone.id, ...method, active: true } });
    }
  }

  const categories = new Map<string, string>();
  for (const category of DEMO_CATEGORIES) {
    const savedCategory = await transaction.category.upsert({
      where: { tenantId_slug: { tenantId, slug: category.slug } },
      update: { name: category.name },
      create: { tenantId, ...category },
    });
    categories.set(category.slug, savedCategory.id);
  }

  await transaction.product.updateMany({
    where: { tenantId, slug: "producto-infinity" },
    data: { active: false, featured: false },
  });

  for (const product of DEMO_PRODUCTS) {
    const { categorySlug, ...catalogData } = product;
    const categoryId = categories.get(categorySlug);
    if (!categoryId) throw new Error(`No se pudo crear la categoría ${categorySlug}`);

    const data = {
      ...catalogData,
      tenantId,
      categoryId,
      brand: "Nébula",
      active: true,
      images: [...catalogData.images],
      tags: [...catalogData.tags],
    };

    await transaction.product.upsert({
      where: { tenantId_slug: { tenantId, slug: product.slug } },
      update: data,
      create: data,
    });
  }

  const [branches, products] = await Promise.all([
    transaction.branch.findMany({ where: { tenantId }, select: { id: true } }),
    transaction.product.findMany({ where: { tenantId }, select: { id: true, featured: true, featuredOrder: true } }),
  ]);
  await transaction.branchMenuItem.createMany({
    data: products.flatMap((product) => branches.map((branch) => ({ tenantId, branchId: branch.id, productId: product.id, featured: product.featured, sortOrder: product.featuredOrder }))),
    skipDuplicates: true,
  });
  for (const branch of branches) {
    const station = await transaction.kitchenStation.upsert({
      where: { tenantId_branchId_name: { tenantId, branchId: branch.id, name: "Cocina" } },
      update: { active: true },
      create: { tenantId, branchId: branch.id, name: "Cocina", type: "KITCHEN" },
    });
    await transaction.kitchenStationMenuItem.createMany({
      data: products.map((product) => ({ tenantId, branchId: branch.id, stationId: station.id, productId: product.id })),
      skipDuplicates: true,
    });
  }
}
