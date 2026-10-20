import { readSheet, type CellValue } from "read-excel-file/node";

import { database } from "../database.js";
import { HttpError } from "../errors.js";
import { createProductSchema } from "../modules/admin/schemas.js";

export type ProductImportMode = "CREATE_ONLY" | "UPSERT";

type Cell = CellValue<number> | null;

type ParsedProduct = {
  row: number;
  categoryName: string | null;
  data: {
    sku: string;
    slug: string;
    name: string;
    description: string | null;
    priceInCents: number;
    stock: number;
    images: string[];
    active: boolean;
    brand: string | null;
    tags: string[];
    featured: boolean;
    featuredOrder: number;
  };
};

export type ProductImportIssue = { row: number; field: string; message: string };

export type ProductImportPreview = {
  valid: boolean;
  totalRows: number;
  validRows: number;
  creates: number;
  updates: number;
  categoriesToCreate: string[];
  availableSlots: number;
  errors: ProductImportIssue[];
  sample: Array<{ row: number; sku: string; name: string; priceInCents: number; stock: number; action: "CREATE" | "UPDATE" }>;
};

const maximumRows = 1_000;
const requiredColumns = ["sku", "name", "price", "stock"] as const;
const headerAliases: Record<string, string> = {
  sku: "sku", codigo: "sku", codigo_interno: "sku",
  nombre: "name", name: "name", producto: "name",
  slug: "slug", url: "slug",
  descripcion: "description", description: "description",
  precio: "price", price: "price",
  stock: "stock", inventario: "stock",
  categoria: "category", category: "category",
  marca: "brand", brand: "brand",
  etiquetas: "tags", tags: "tags",
  imagenes: "images", images: "images", urls_imagenes: "images",
  activo: "active", active: "active",
  destacado: "featured", featured: "featured",
  orden_destacado: "featuredOrder", featured_order: "featuredOrder",
};

function text(value: Cell | undefined): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString();
  return String(value).trim();
}

function normalizeHeader(value: Cell | undefined): string {
  return text(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function slugify(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
}

function parseCsv(input: Buffer): Cell[][] {
  const source = input.toString("utf8").replace(/^\uFEFF/, "");
  const firstLine = source.split(/\r?\n/, 1)[0] ?? "";
  const delimiter = [";", ",", "\t"].map((candidate) => ({ candidate, count: firstLine.split(candidate).length - 1 })).sort((a, b) => b.count - a.count)[0]?.candidate ?? ";";
  const rows: Cell[][] = [];
  let row: Cell[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (character === '"') {
      if (quoted && source[index + 1] === '"') { cell += '"'; index += 1; }
      else quoted = !quoted;
    } else if (character === delimiter && !quoted) {
      row.push(cell); cell = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && source[index + 1] === "\n") index += 1;
      row.push(cell); cell = "";
      if (row.some((value) => text(value) !== "")) rows.push(row);
      row = [];
      if (rows.length > maximumRows + 1) throw new HttpError(400, `El archivo supera el máximo de ${maximumRows} filas`);
    } else cell += character;
  }
  if (quoted) throw new HttpError(400, "El CSV contiene una celda entre comillas sin cerrar");
  row.push(cell);
  if (row.some((value) => text(value) !== "")) rows.push(row);
  return rows;
}

async function rowsFromFile(file: Express.Multer.File): Promise<Cell[][]> {
  const lowerName = file.originalname.toLowerCase();
  if (lowerName.endsWith(".xlsx")) {
    try {
      const rows = await readSheet(file.buffer, 1);
      if (rows.length > maximumRows + 1) throw new HttpError(400, `El archivo supera el máximo de ${maximumRows} filas`);
      return rows;
    } catch (error) {
      if (error instanceof HttpError) throw error;
      throw new HttpError(400, "No pudimos leer el archivo XLSX. Revisá que sea un Excel válido");
    }
  }
  if (lowerName.endsWith(".csv")) return parseCsv(file.buffer);
  throw new HttpError(400, "Usá un archivo CSV o XLSX");
}

function parseDecimal(value: Cell | undefined): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  let raw = text(value).replace(/[$\s]/g, "");
  if (!raw) return null;
  const comma = raw.lastIndexOf(",");
  const dot = raw.lastIndexOf(".");
  if (comma >= 0 && dot >= 0) {
    const decimal = comma > dot ? "," : ".";
    raw = raw.replace(decimal === "," ? /\./g : /,/g, "").replace(decimal, ".");
  } else if (comma >= 0) {
    const decimals = raw.length - comma - 1;
    raw = decimals <= 2 ? raw.replace(/\./g, "").replace(",", ".") : raw.replace(/,/g, "");
  } else if (dot >= 0) {
    const decimals = raw.length - dot - 1;
    raw = decimals === 3 ? raw.replace(/\./g, "") : raw.replace(/,/g, "");
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseBoolean(value: Cell | undefined, fallback: boolean): boolean | null {
  const raw = text(value).toLocaleLowerCase("es");
  if (!raw) return fallback;
  if (["si", "sí", "true", "1", "activo", "visible"].includes(raw)) return true;
  if (["no", "false", "0", "inactivo", "oculto"].includes(raw)) return false;
  return null;
}

function splitList(value: Cell | undefined): string[] {
  return text(value).split(/[|\n]/).map((item) => item.trim()).filter(Boolean);
}

async function parseProducts(file: Express.Multer.File): Promise<{ products: ParsedProduct[]; errors: ProductImportIssue[]; totalRows: number }> {
  const rows = await rowsFromFile(file);
  if (rows.length < 2) throw new HttpError(400, "El archivo no contiene productos");
  const headerRow = rows[0];
  if (!headerRow) throw new HttpError(400, "El archivo no contiene encabezados");
  const mappedHeaders = headerRow.map((value) => headerAliases[normalizeHeader(value)] ?? null);
  const errors: ProductImportIssue[] = [];
  for (const required of requiredColumns) {
    if (!mappedHeaders.includes(required)) errors.push({ row: 1, field: required, message: `Falta la columna obligatoria ${required}` });
  }
  const duplicates = mappedHeaders.filter((header, index) => header && mappedHeaders.indexOf(header) !== index);
  for (const duplicate of new Set(duplicates)) errors.push({ row: 1, field: duplicate!, message: "La columna está repetida" });
  if (errors.length) return { products: [], errors, totalRows: rows.length - 1 };

  const products: ParsedProduct[] = [];
  const seenSkus = new Set<string>();
  const seenSlugs = new Set<string>();
  for (let index = 1; index < rows.length; index += 1) {
    const source = Object.fromEntries(mappedHeaders.map((header, column) => header ? [header, rows[index]?.[column]] : null).filter(Boolean) as Array<[string, Cell]>);
    const rowNumber = index + 1;
    const sku = text(source.sku).toUpperCase();
    const name = text(source.name);
    const slug = slugify(text(source.slug) || name);
    const price = parseDecimal(source.price);
    const stock = parseDecimal(source.stock);
    const active = parseBoolean(source.active, true);
    const featured = parseBoolean(source.featured, false);
    const images = splitList(source.images);
    const tags = splitList(source.tags);
    const featuredOrder = parseDecimal(source.featuredOrder) ?? 0;
    const candidate = {
      sku, slug, name,
      description: text(source.description) || null,
      priceInCents: price === null ? -1 : Math.round(price * 100),
      stock: stock === null ? -1 : stock,
      images, active: active ?? true,
      brand: text(source.brand) || null,
      tags, featured: featured ?? false,
      featuredOrder,
    };
    const result = createProductSchema.safeParse(candidate);
    if (!result.success) {
      for (const issue of result.error.issues) errors.push({ row: rowNumber, field: issue.path.join(".") || "fila", message: issue.message });
    }
    if (active === null) errors.push({ row: rowNumber, field: "activo", message: "Usá Sí/No, True/False o 1/0" });
    if (featured === null) errors.push({ row: rowNumber, field: "destacado", message: "Usá Sí/No, True/False o 1/0" });
    if (stock !== null && !Number.isInteger(stock)) errors.push({ row: rowNumber, field: "stock", message: "El stock debe ser un número entero" });
    if (!Number.isInteger(featuredOrder)) errors.push({ row: rowNumber, field: "orden_destacado", message: "El orden debe ser un número entero" });
    if (seenSkus.has(sku)) errors.push({ row: rowNumber, field: "sku", message: "El SKU está repetido dentro del archivo" });
    if (seenSlugs.has(slug)) errors.push({ row: rowNumber, field: "slug", message: "La dirección está repetida dentro del archivo" });
    seenSkus.add(sku); seenSlugs.add(slug);
    const categoryName = text(source.category).slice(0, 80) || null;
    if (categoryName && categoryName.length < 2) errors.push({ row: rowNumber, field: "categoria", message: "La categoría debe tener al menos 2 caracteres" });
    if (result.success) products.push({
      row: rowNumber,
      categoryName,
      data: {
        sku: result.data.sku,
        slug: result.data.slug,
        name: result.data.name,
        description: result.data.description ?? null,
        priceInCents: result.data.priceInCents,
        stock: result.data.stock,
        images: result.data.images,
        active: result.data.active,
        brand: result.data.brand ?? null,
        tags: result.data.tags,
        featured: result.data.featured,
        featuredOrder: result.data.featuredOrder,
      },
    });
  }
  return { products, errors, totalRows: rows.length - 1 };
}

async function analyze(tenantId: string, file: Express.Multer.File, mode: ProductImportMode) {
  const parsed = await parseProducts(file);
  const [subscription, currentCount, existingProducts, existingCategories] = await Promise.all([
    database.subscription.findUnique({ where: { tenantId }, include: { plan: true } }),
    database.product.count({ where: { tenantId } }),
    database.product.findMany({ where: { tenantId, OR: [
      { sku: { in: parsed.products.map((product) => product.data.sku) } },
      { slug: { in: parsed.products.map((product) => product.data.slug) } },
    ] }, select: { id: true, sku: true, slug: true } }),
    database.category.findMany({ where: { tenantId }, select: { name: true } }),
  ]);
  if (!subscription) throw new HttpError(409, "La tienda no tiene un plan asignado");
  const bySku = new Map(existingProducts.map((product) => [product.sku, product]));
  const bySlug = new Map(existingProducts.map((product) => [product.slug, product]));
  const actions = new Map<number, "CREATE" | "UPDATE">();
  for (const product of parsed.products) {
    const existingBySku = bySku.get(product.data.sku);
    const existingBySlug = bySlug.get(product.data.slug);
    if (existingBySlug && existingBySlug.sku !== product.data.sku) parsed.errors.push({ row: product.row, field: "slug", message: "La dirección ya pertenece a otro producto" });
    if (existingBySku && mode === "CREATE_ONLY") parsed.errors.push({ row: product.row, field: "sku", message: "El SKU ya existe. Elegí actualizar por SKU para modificarlo" });
    actions.set(product.row, existingBySku ? "UPDATE" : "CREATE");
  }
  const creates = [...actions.values()].filter((action) => action === "CREATE").length;
  const updates = [...actions.values()].filter((action) => action === "UPDATE").length;
  const availableSlots = Math.max(0, subscription.plan.maxProducts - currentCount);
  if (creates > availableSlots) parsed.errors.push({ row: 0, field: "limite", message: `El archivo crearía ${creates} productos y solo quedan ${availableSlots} lugares en el plan` });
  const existingCategoryNames = new Set(existingCategories.map((category) => category.name.toLocaleLowerCase("es")));
  const categoriesToCreate = [...new Set(parsed.products.map((product) => product.categoryName).filter((name): name is string => Boolean(name)).filter((name) => !existingCategoryNames.has(name.toLocaleLowerCase("es"))))];
  return { parsed, actions, creates, updates, availableSlots, categoriesToCreate };
}

export async function previewProductImport(tenantId: string, file: Express.Multer.File, mode: ProductImportMode): Promise<ProductImportPreview> {
  const result = await analyze(tenantId, file, mode);
  return {
    valid: result.parsed.errors.length === 0,
    totalRows: result.parsed.totalRows,
    validRows: result.parsed.products.length,
    creates: result.creates,
    updates: result.updates,
    categoriesToCreate: result.categoriesToCreate,
    availableSlots: result.availableSlots,
    errors: result.parsed.errors.slice(0, 100),
    sample: result.parsed.products.slice(0, 10).map((product) => ({ row: product.row, sku: product.data.sku, name: product.data.name, priceInCents: product.data.priceInCents, stock: product.data.stock, action: result.actions.get(product.row) ?? "CREATE" })),
  };
}

export async function importProducts(tenantId: string, file: Express.Multer.File, mode: ProductImportMode) {
  const analysis = await analyze(tenantId, file, mode);
  if (analysis.parsed.errors.length) throw new HttpError(409, analysis.parsed.errors[0]?.message ?? "El archivo contiene errores");
  try {
    return await database.$transaction(async (transaction) => {
      await transaction.$queryRaw`SELECT id FROM "Tenant" WHERE id = ${tenantId} FOR UPDATE`;
      const subscription = await transaction.subscription.findUnique({ where: { tenantId }, include: { plan: true } });
      if (!subscription) throw new HttpError(409, "La tienda no tiene un plan asignado");
      const currentCount = await transaction.product.count({ where: { tenantId } });
      const existing = await transaction.product.findMany({ where: { tenantId, sku: { in: analysis.parsed.products.map((product) => product.data.sku) } }, select: { id: true, sku: true } });
      const existingBySku = new Map(existing.map((product) => [product.sku, product.id]));
      const creates = analysis.parsed.products.filter((product) => !existingBySku.has(product.data.sku));
      const updates = analysis.parsed.products.filter((product) => existingBySku.has(product.data.sku));
      if (mode === "CREATE_ONLY" && updates.length) throw new HttpError(409, "El catálogo cambió: uno de los SKU del archivo ya existe. Volvé a validar el archivo");
      if (currentCount + creates.length > subscription.plan.maxProducts) throw new HttpError(409, "El catálogo cambió y ya no quedan lugares suficientes. Volvé a validar el archivo");

      const categories = await transaction.category.findMany({ where: { tenantId }, select: { id: true, name: true, slug: true } });
      const categoryByName = new Map(categories.map((category) => [category.name.toLocaleLowerCase("es"), category]));
      const usedCategorySlugs = new Set(categories.map((category) => category.slug));
      let categoriesCreated = 0;
      for (const name of analysis.categoriesToCreate) {
        if (categoryByName.has(name.toLocaleLowerCase("es"))) continue;
        let slug = slugify(name) || "categoria";
        const base = slug;
        let suffix = 2;
        while (usedCategorySlugs.has(slug)) { slug = `${base.slice(0, 74)}-${suffix}`; suffix += 1; }
        const category = await transaction.category.create({ data: { tenantId, name, slug }, select: { id: true, name: true, slug: true } });
        categoryByName.set(name.toLocaleLowerCase("es"), category); usedCategorySlugs.add(slug);
        categoriesCreated += 1;
      }

      if (creates.length) await transaction.product.createMany({ data: creates.map((product) => ({ ...product.data, tenantId, categoryId: product.categoryName ? categoryByName.get(product.categoryName.toLocaleLowerCase("es"))?.id ?? null : null })) });
      for (let index = 0; index < updates.length; index += 25) {
        await Promise.all(updates.slice(index, index + 25).map((product) => transaction.product.update({ where: { id: existingBySku.get(product.data.sku)! }, data: { ...product.data, categoryId: product.categoryName ? categoryByName.get(product.categoryName.toLocaleLowerCase("es"))?.id ?? null : null } })));
      }
      if (creates.length) {
        const [createdProducts, branches] = await Promise.all([
          transaction.product.findMany({ where: { tenantId, sku: { in: creates.map((product) => product.data.sku) } }, select: { id: true, featured: true, featuredOrder: true } }),
          transaction.branch.findMany({ where: { tenantId }, select: { id: true } }),
        ]);
        await transaction.branchMenuItem.createMany({
          data: createdProducts.flatMap((product) => branches.map((branch) => ({ tenantId, branchId: branch.id, productId: product.id, featured: product.featured, sortOrder: product.featuredOrder }))),
          skipDuplicates: true,
        });
        const stations = await transaction.kitchenStation.findMany({ where: { tenantId, branchId: { in: branches.map((branch) => branch.id) }, active: true }, orderBy: [{ displayOrder: "asc" }, { createdAt: "asc" }] });
        const defaultByBranch = new Map(stations.map((station) => [station.branchId, station.id]));
        await transaction.kitchenStationMenuItem.createMany({
          data: createdProducts.flatMap((product) => branches.flatMap((branch) => defaultByBranch.has(branch.id) ? [{ tenantId, branchId: branch.id, stationId: defaultByBranch.get(branch.id)!, productId: product.id }] : [])),
          skipDuplicates: true,
        });
      }
      return { created: creates.length, updated: updates.length, categoriesCreated, total: creates.length + updates.length };
    }, { timeout: 60_000 });
  } catch (error) {
    if (error instanceof HttpError) throw error;
    if (typeof error === "object" && error !== null && "code" in error && error.code === "P2002") {
      throw new HttpError(409, "El catálogo cambió durante la importación. Volvé a validar el archivo");
    }
    throw error;
  }
}
