"use client";

import { ChevronLeft, ChevronRight, Download, Eye, EyeOff, FileSpreadsheet, PackagePlus, Search, SlidersHorizontal, TriangleAlert, Upload, X } from "lucide-react";
import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";

import { FilePicker } from "@/components/file-picker";
import { ApiError, apiRequest } from "@/lib/api";
import { confirmAction } from "@/lib/confirm-action";
import type { Category, Product, Role } from "./types";
import { EmptyState, Field as GuidedField, GuideLink, Tip, panelStyles as styles } from "./guided-panel";

const money = new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: "ARS",
});

type ProductListResponse = {
  products: Product[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
  summary: { total: number; active: number; lowStock: number; limit: number };
};
type ImportMode = "CREATE_ONLY" | "UPSERT";
type ImportPreview = {
  valid: boolean; totalRows: number; validRows: number; creates: number; updates: number; availableSlots: number;
  categoriesToCreate: string[];
  errors: Array<{ row: number; field: string; message: string }>;
  sample: Array<{ row: number; sku: string; name: string; priceInCents: number; stock: number; action: "CREATE" | "UPDATE" }>;
};

export function ProductsView({ onOpenCategories, role }: { onOpenCategories: () => void; role: Role }) {
  const canManage = role !== "STAFF";
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [pagination, setPagination] = useState({ page: 1, pageSize: 25, total: 0, totalPages: 1 });
  const [summary, setSummary] = useState({ total: 0, active: 0, lowStock: 0, limit: 0 });
  const [editing, setEditing] = useState<Product | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [serverSearch, setServerSearch] = useState("");
  const [page, setPage] = useState(1);
  const [categoryFilter, setCategoryFilter] = useState("ALL");
  const [visibilityFilter, setVisibilityFilter] = useState("ALL");
  const [imagePreviews, setImagePreviews] = useState<string[]>([]);
  const [imageFileNames, setImageFileNames] = useState<string[]>([]);
  const [showImport, setShowImport] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importMode, setImportMode] = useState<ImportMode>("CREATE_ONLY");
  const [importPreview, setImportPreview] = useState<ImportPreview | null>(null);
  const [importBusy, setImportBusy] = useState(false);
  const [importError, setImportError] = useState("");
  const [notice, setNotice] = useState("");
  const requestSequence = useRef(0);

  const loadProducts = useCallback(async () => {
    const sequence = ++requestSequence.current;
    setLoading(true);
    setError("");
    const query = new URLSearchParams({ search: serverSearch, category: categoryFilter, visibility: visibilityFilter, page: String(page), pageSize: "25" });
    try {
      const response = await apiRequest<ProductListResponse>(`/admin/products?${query}`);
      if (sequence !== requestSequence.current) return;
      setProducts(response.products); setPagination(response.pagination); setSummary(response.summary);
    } catch (caught) {
      if (sequence === requestSequence.current) setError(caught instanceof ApiError ? caught.message : "No se pudo cargar el catálogo");
    } finally {
      if (sequence === requestSequence.current) setLoading(false);
    }
  }, [serverSearch, categoryFilter, visibilityFilter, page]);

  useEffect(() => {
    let active = true;
    void apiRequest<{ categories: Category[] }>("/admin/categories").then((response) => { if (active) setCategories(response.categories); }).catch((caught) => { if (active) setError(caught instanceof ApiError ? caught.message : "No se pudieron cargar las categorías"); });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    const timeout = window.setTimeout(() => { setPage(1); setServerSearch(search.trim()); }, 300);
    return () => window.clearTimeout(timeout);
  }, [search]);
  useEffect(() => {
    const timeout = window.setTimeout(() => { void loadProducts(); }, 0);
    return () => window.clearTimeout(timeout);
  }, [loadProducts]);
  useEffect(() => {
    if (!showForm) return;
    const previous = document.body.style.overflow;
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") setShowForm(false); };
    document.body.style.overflow = "hidden"; document.addEventListener("keydown", close);
    return () => { document.body.style.overflow = previous; document.removeEventListener("keydown", close); };
  }, [showForm]);

  function openForm(product: Product | null) {
    setEditing(product);
    setError("");
    setShowForm(true);
    setImagePreviews([]);
    setImageFileNames([]);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const form = new FormData(event.currentTarget);
    try {
      const images = String(form.get("images") ?? "")
        .split("\n")
        .map((url) => url.trim())
        .filter(Boolean);
      const selectedFiles = form.getAll("imageFiles").filter((entry): entry is File => entry instanceof File && entry.size > 0);
      let uploadedImages: string[] = [];
      if (selectedFiles.length) {
        const upload = new FormData();
        selectedFiles.forEach((file) => upload.append("images", file));
        const uploadResult = await apiRequest<{ images: string[] }>("/admin/uploads/products", { method: "POST", body: upload });
        uploadedImages = uploadResult.images;
      }
      const name = String(form.get("name") ?? "");
      const rawSlug = String(form.get("slug") ?? "").trim();
      const body = {
        categoryId: form.get("categoryId") || null,
        sku: form.get("sku"),
        slug: rawSlug || createSlug(name),
        name,
        description: form.get("description") || null,
        priceInCents: Math.round(Number(form.get("price")) * 100),
        stock: Number(form.get("stock")),
        images: [...images, ...uploadedImages].slice(0, 8),
        active: form.get("active") === "on",
        brand: form.get("brand") || null,
        tags: String(form.get("tags") ?? "")
          .split(",")
          .map((tag) => tag.trim())
          .filter(Boolean),
        featured: form.get("featured") === "on",
        featuredOrder: Number(form.get("featuredOrder") || 0),
        preparationTimeMinutes: Number(form.get("preparationTimeMinutes") || 0),
        allergens: String(form.get("allergens") ?? "").split(",").map((value) => value.trim()).filter(Boolean),
        dietaryTags: String(form.get("dietaryTags") ?? "").split(",").map((value) => value.trim()).filter(Boolean),
      };

      await apiRequest(editing ? `/admin/products/${editing.id}` : "/admin/products", {
        method: editing ? "PATCH" : "POST",
        body: JSON.stringify(body),
      });
      setShowForm(false);
      setEditing(null);
      setImagePreviews([]);
      setImageFileNames([]);
      await loadProducts();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "No se pudo guardar el producto");
    } finally {
      setBusy(false);
    }
  }

  async function remove(product: Product) {
    if (!(await confirmAction({ title: `¿Eliminar “${product.name}”?`, description: "El producto desaparecerá del catálogo y esta acción no se puede deshacer.", confirmLabel: "Eliminar producto", tone: "danger" }))) return;
    try {
      await apiRequest(`/admin/products/${product.id}`, { method: "DELETE" });
      if (products.length === 1 && page > 1) setPage(page - 1);
      else await loadProducts();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "No se pudo eliminar el producto");
    }
  }

  function openImport() {
    setImportFile(null); setImportPreview(null); setImportMode("CREATE_ONLY"); setImportError(""); setShowImport(true);
  }
  async function previewImport() {
    if (!importFile) { setImportError("Seleccioná un archivo CSV o XLSX."); return; }
    setImportBusy(true); setImportError(""); setImportPreview(null);
    const body = new FormData(); body.append("file", importFile); body.append("mode", importMode);
    try { setImportPreview(await apiRequest<ImportPreview>("/admin/products/import/preview", { method: "POST", body })); }
    catch (caught) { setImportError(caught instanceof ApiError ? caught.message : "No se pudo validar el archivo"); }
    finally { setImportBusy(false); }
  }
  async function confirmImport() {
    if (!importFile || !importPreview?.valid) return;
    setImportBusy(true); setImportError("");
    const body = new FormData(); body.append("file", importFile); body.append("mode", importMode);
    try {
      const result = await apiRequest<{ created: number; updated: number; categoriesCreated: number }>("/admin/products/import", { method: "POST", body });
      setShowImport(false); setNotice(`Importación completada: ${result.created} creados y ${result.updated} actualizados.`);
      if (page === 1) await loadProducts();
      else setPage(1);
      const categoryResponse = await apiRequest<{ categories: Category[] }>("/admin/categories"); setCategories(categoryResponse.categories);
    } catch (caught) { setImportError(caught instanceof ApiError ? caught.message : "No se pudo importar el catálogo"); }
    finally { setImportBusy(false); }
  }
  function downloadTemplate() {
    const csv = "SKU;Nombre;Precio;Stock;Slug;Descripción;Categoría;Marca;Etiquetas;Imágenes;Activo;Destacado;Orden destacado\r\nREM-001;Remera clásica;25000;20;remera-clasica;Algodón peinado;Remeras;Mi marca;algodón|unisex;https://ejemplo.com/remera.jpg;Sí;No;0\r\n";
    const url = URL.createObjectURL(new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = "plantilla-productos-infinityshop.csv"; anchor.click(); URL.revokeObjectURL(url);
  }

  return (
    <div className={`${styles.surface} mx-auto max-w-7xl`}>
      <div className="mb-6 flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#6E3482]">Productos</p>
          <h2 className="mt-2 text-2xl font-semibold tracking-tight">Tu catálogo, fácil de mantener</h2>
          <p className="mt-2 text-sm text-[#807384]">Buscá, filtrá y actualizá precio, stock, imágenes y visibilidad.</p>
        </div>
        {canManage && <div className="flex flex-wrap gap-2"><button className="inline-flex items-center justify-center gap-2 rounded-xl border border-[#d9cfe0] bg-white px-4 py-3 text-sm font-semibold text-[#6E3482]" onClick={openImport} type="button"><FileSpreadsheet size={17} /> Importar archivo</button><button className={styles.button} onClick={() => openForm(null)} type="button"><PackagePlus size={17} /> Nuevo producto</button></div>}
      </div>

      {error && !showForm && <p role="alert" className="mb-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
      {notice && <p role="status" className="mb-4 rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{notice}</p>}

      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <Summary label="Productos cargados" value={summary.total} help={`Usaste ${summary.total} de ${summary.limit || 1_000} lugares.`} />
        <Summary label="Visibles en la tienda" value={summary.active} help="Son los que pueden comprar tus clientes." />
        <Summary label="Stock bajo" value={summary.lowStock} help="Productos con menos de 5 unidades." alert={summary.lowStock > 0} />
      </div>

      <section className="mb-5 rounded-2xl border border-[#e6dfe8] bg-white p-4">
        <div className="mb-3 flex items-center gap-2 text-sm font-semibold"><SlidersHorizontal size={16} className="text-[#6E3482]" /> Encontrá un producto</div>
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_15rem_13rem]">
          <label className="relative"><span className="sr-only">Buscar producto</span><Search className="absolute left-3.5 top-3.5 h-4 w-4 text-[#918495]" /><input className="control pl-10!" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Nombre, SKU o marca" /></label>
          <label><span className="sr-only">Filtrar por categoría</span><select className="control" value={categoryFilter} onChange={(event) => { setCategoryFilter(event.target.value); setPage(1); }}><option value="ALL">Todas las categorías</option><option value="NONE">Sin categoría</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>
          <label><span className="sr-only">Filtrar por visibilidad</span><select className="control" value={visibilityFilter} onChange={(event) => { setVisibilityFilter(event.target.value); setPage(1); }}><option value="ALL">Visibles y ocultos</option><option value="ACTIVE">Solo visibles</option><option value="HIDDEN">Solo ocultos</option></select></label>
        </div>
        <p className="mt-3 text-xs text-[#918495]">Mostrando {products.length} de {pagination.total} resultados. Los filtros se procesan en el servidor.</p>
      </section>

      {loading ? <div className="h-56 animate-pulse rounded-2xl bg-[#eee9ef]" /> : summary.total === 0 ? (
        <div className="rounded-2xl border border-dashed border-stone-300 bg-white px-6 py-24 text-center">
          <p className="text-lg font-semibold">Tu catálogo está vacío</p>
          <p className="mt-2 text-sm text-stone-400">Primero <GuideLink onClick={onOpenCategories}>creá una categoría</GuideLink> y después agregá tu primer producto.</p>
        </div>
      ) : products.length === 0 ? <EmptyState title="No encontramos coincidencias">Probá otra búsqueda o limpiá los filtros de categoría y visibilidad.</EmptyState> : (
        <div>
        <div className="overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[58rem] text-left text-sm">
              <thead className="border-b border-stone-100 bg-stone-50 text-xs uppercase tracking-wider text-stone-400">
                <tr>
                  <th className="px-5 py-3">Producto</th>
                  <th className="px-5 py-3">Categoría</th>
                  <th className="px-5 py-3">Precio</th>
                  <th className="px-5 py-3">Stock</th>
                  <th className="px-5 py-3">Estado</th>
                  <th className="px-5 py-3 text-right">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {products.map((product) => (
                  <tr className="hover:bg-stone-50/60" key={product.id}>
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-3">
                        <div className="h-12 w-12 shrink-0 rounded-xl bg-stone-100 bg-cover bg-center" style={product.images[0] ? { backgroundImage: `url(${product.images[0]})` } : undefined}>
                          {!product.images[0] && <span className="grid h-full place-items-center font-serif text-stone-400">{product.name[0]}</span>}
                        </div>
                        <div className="min-w-0">
                          <p className="truncate font-semibold">{product.name}</p>
                          <p className="mt-0.5 text-xs text-stone-400">{product.sku}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-4 text-stone-500">{product.category?.name ?? "Sin categoría"}</td>
                    <td className="px-5 py-4 font-semibold">{money.format(product.priceInCents / 100)}</td>
                    <td className="px-5 py-4">
                      <span className={product.stock < 5 ? "font-semibold text-red-600" : "text-stone-600"}>{product.stock}</span>
                    </td>
                    <td className="px-5 py-4">
                      <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${product.active ? "bg-emerald-50 text-emerald-700" : "bg-stone-100 text-stone-500"}`}>{product.active ? "Activo" : "Oculto"}</span>
                    </td>
                    <td className="px-5 py-4 text-right">
                      {canManage ? (
                        <div className="flex justify-end gap-2">
                          <button className="rounded-lg border border-stone-200 px-3 py-2 text-xs font-semibold hover:bg-stone-50" onClick={() => openForm(product)} type="button">
                            Editar
                          </button>
                          <button className="rounded-lg px-3 py-2 text-xs font-semibold text-red-600 hover:bg-red-50" onClick={() => remove(product)} type="button">
                            Eliminar
                          </button>
                        </div>
                      ) : (
                        <span className="text-xs text-stone-400">Solo lectura</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <Pagination page={pagination.page} totalPages={pagination.totalPages} onChange={setPage} />
        </div>
      )}

      {showForm && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/35" role="dialog" aria-modal="true">
          <button aria-label="Cerrar formulario" className="absolute inset-0" onClick={() => setShowForm(false)} type="button" />
          <aside className="relative h-full w-full max-w-xl overflow-y-auto bg-white p-6 shadow-2xl sm:p-8">
            <div className="mb-7 flex items-start justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#6E3482]">Catálogo</p>
                <h2 className="mt-1 text-2xl font-semibold">{editing ? "Editar producto" : "Nuevo producto"}</h2>
              </div>
              <button aria-label="Cerrar" className="grid h-10 w-10 place-items-center rounded-xl bg-[#f5eff8] text-[#6E3482]" onClick={() => setShowForm(false)} type="button">
                <X size={19} />
              </button>
            </div>
            <ProductForm
              categories={categories}
              editing={editing}
              error={error}
              busy={busy}
              imageFileNames={imageFileNames}
              imagePreviews={imagePreviews}
              onImagesChange={(files) => {
                imagePreviews.forEach((url) => URL.revokeObjectURL(url));
                setImageFileNames(files.map((file) => file.name));
                setImagePreviews(files.map((file) => URL.createObjectURL(file)));
              }}
              onSubmit={submit}
            />
          </aside>
        </div>
      )}

      {showImport && (
        <div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-black/40 p-4" role="dialog" aria-modal="true" aria-labelledby="import-title">
          <button aria-label="Cerrar importación" className="absolute inset-0" onClick={() => !importBusy && setShowImport(false)} type="button" />
          <section className="relative my-6 w-full max-w-3xl rounded-[1.75rem] bg-white p-6 shadow-2xl sm:p-8">
            <div className="flex items-start justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#6E3482]">Importación masiva</p><h2 className="mt-1 text-2xl font-semibold" id="import-title">Importar productos</h2><p className="mt-2 text-sm text-[#807384]">Validamos el archivo antes de modificar el catálogo. Máximo 1.000 filas por importación.</p></div><button aria-label="Cerrar" className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#f5eff8] text-[#6E3482]" disabled={importBusy} onClick={() => setShowImport(false)} type="button"><X size={19} /></button></div>

            <div className="mt-6 grid gap-4 sm:grid-cols-2">
              <button className="flex items-center justify-center gap-2 rounded-xl border border-[#d9cfe0] px-4 py-3 text-sm font-semibold text-[#6E3482]" onClick={downloadTemplate} type="button"><Download size={16} /> Descargar plantilla CSV</button>
              <label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-[#bca9c5] bg-[#fbf8fc] px-4 py-3 text-sm font-semibold text-[#4b3a50]"><Upload size={16} /><span>{importFile?.name ?? "Elegir CSV o XLSX"}</span><input accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="sr-only" disabled={importBusy} onChange={(event) => { setImportFile(event.target.files?.[0] ?? null); setImportPreview(null); setImportError(""); }} type="file" /></label>
            </div>

            <fieldset className="mt-5"><legend className="text-sm font-semibold">Qué hacer con SKU existentes</legend><div className="mt-2 grid gap-3 sm:grid-cols-2"><label className={`rounded-xl border p-4 text-sm ${importMode === "CREATE_ONLY" ? "border-[#8f45a8] bg-[#fbf6fd]" : "border-[#e6dfe8]"}`}><input checked={importMode === "CREATE_ONLY"} className="mr-2 accent-[#6E3482]" name="importMode" onChange={() => { setImportMode("CREATE_ONLY"); setImportPreview(null); }} type="radio" />Solo crear nuevos<span className="mt-1 block pl-6 text-xs text-[#807384]">Los SKU existentes se informan como error.</span></label><label className={`rounded-xl border p-4 text-sm ${importMode === "UPSERT" ? "border-[#8f45a8] bg-[#fbf6fd]" : "border-[#e6dfe8]"}`}><input checked={importMode === "UPSERT"} className="mr-2 accent-[#6E3482]" name="importMode" onChange={() => { setImportMode("UPSERT"); setImportPreview(null); }} type="radio" />Crear y actualizar<span className="mt-1 block pl-6 text-xs text-[#807384]">Actualiza productos comparando el SKU.</span></label></div></fieldset>

            <Tip title="Columnas y formato">Obligatorias: SKU, Nombre, Precio y Stock. Podés agregar categoría, marca, etiquetas, URLs de imágenes, visibilidad y destacados. Separá varias etiquetas o imágenes con |. Las categorías nuevas se crean al importar.</Tip>
            {importError && <p role="alert" className="mt-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{importError}</p>}

            {importPreview && <ImportPreviewPanel preview={importPreview} />}

            <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end"><button className="rounded-xl border border-[#d9cfe0] px-5 py-3 text-sm font-semibold" disabled={importBusy} onClick={() => setShowImport(false)} type="button">Cancelar</button>{importPreview?.valid ? <button className={styles.button} disabled={importBusy} onClick={() => void confirmImport()} type="button">{importBusy ? "Importando…" : `Importar ${importPreview.validRows} productos`}</button> : <button className={styles.button} disabled={importBusy || !importFile} onClick={() => void previewImport()} type="button">{importBusy ? "Validando…" : "Validar archivo"}</button>}</div>
          </section>
        </div>
      )}
    </div>
  );
}

function ProductForm({ categories, editing, error, busy, imageFileNames, imagePreviews, onImagesChange, onSubmit }: { categories: Category[]; editing: Product | null; error: string; busy: boolean; imageFileNames: string[]; imagePreviews: string[]; onImagesChange: (files: File[]) => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void }) {
  return (
    <form className="space-y-7" key={editing?.id ?? "new"} onSubmit={onSubmit}>
      <FormSection title="1. Información básica" help="Estos datos identifican el producto en el panel y en tu tienda.">
      <div className="grid gap-5 sm:grid-cols-2">
        <ProductField defaultValue={editing?.name} label="Nombre del producto" help="Es el título principal que verá tu cliente." example="Ejemplo: Cinturón Toro" name="name" placeholder="Cinturón Toro" />
        <ProductField defaultValue={editing?.sku} label="Código interno (SKU)" help="Debe ser único. Te sirve para identificarlo en pedidos y stock." example="Ejemplo: CIN-TOR-001" name="sku" placeholder="CIN-TOR-001" />
      </div>
      <ProductField defaultValue={editing?.slug} label="Dirección del producto (opcional)" help="Es la parte final de la URL. Si la dejás vacía, se genera desde el nombre." example="Ejemplo: /producto/cinturon-toro" name="slug" placeholder="cinturon-toro" required={false} />
      <GuidedField label="Categoría" help="Ayuda a tus clientes a navegar y filtrar el catálogo." example="Ejemplo: Cinturones"><select defaultValue={editing?.categoryId ?? ""} name="categoryId">
          <option value="">Sin categoría</option>
          {categories.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
        </select></GuidedField>
      <GuidedField label="Descripción" help="Contá ingredientes, tamaño de la porción o características del plato." example="Ejemplo: Pan de masa madre, carne, cheddar y cebolla caramelizada."><textarea defaultValue={editing?.description ?? ""} name="description" placeholder="Describí el plato con información útil" /></GuidedField>
      <div className="grid gap-5 sm:grid-cols-2">
        <ProductField defaultValue={String(editing?.preparationTimeMinutes ?? 15)} label="Preparación estimada" help="Minutos habituales que necesita cocina." example="Ejemplo: 15" min="0" name="preparationTimeMinutes" placeholder="15" step="1" type="number" />
        <ProductField defaultValue={editing?.dietaryTags.join(", ") ?? ""} label="Preferencias alimentarias" help="Separalas con comas." example="Ejemplo: vegetariano, sin TACC" name="dietaryTags" placeholder="vegetariano, vegano" required={false} />
      </div>
      <ProductField defaultValue={editing?.allergens.join(", ") ?? ""} label="Alérgenos" help="Separalos con comas para mostrarlos claramente en la carta." example="Ejemplo: gluten, lácteos, maní" name="allergens" placeholder="gluten, lácteos" required={false} />
      </FormSection>

      <FormSection title="2. Precio e inventario" help="Indicá cuánto cuesta y cuántas unidades hay disponibles.">
      <div className="grid gap-5 sm:grid-cols-2">
        <ProductField defaultValue={editing ? String(editing.priceInCents / 100) : undefined} label="Precio en pesos" help="Ingresá el precio final que verá el cliente, sin puntos de miles." example="Ejemplo: 45000" min="0" name="price" placeholder="45000" step="0.01" type="number" />
        <ProductField defaultValue={editing ? String(editing.stock) : undefined} label="Unidades disponibles" help="El sistema descuenta stock cuando se reserva o confirma una compra." example="Ejemplo: 10" min="0" name="stock" placeholder="10" step="1" type="number" />
      </div>
      <div className="grid gap-5 sm:grid-cols-2">
        <ProductField defaultValue={editing?.brand ?? ""} label="Marca (opcional)" help="Permite identificar el fabricante o la línea del producto." example="Ejemplo: InfinityDev" name="brand" placeholder="InfinityDev" required={false} />
        <ProductField defaultValue={editing?.tags.join(", ") ?? ""} label="Etiquetas (opcional)" help="Separalas con comas. Sirven para destacar características." example="Ejemplo: cuero, negro, artesanal" name="tags" placeholder="cuero, negro, artesanal" required={false} />
      </div>
      </FormSection>

      <FormSection title="3. Imágenes" help="La primera imagen se usa como portada del producto. Podés cargar hasta 8.">
      <Tip title="Forma recomendada">Usá el botón para subir imágenes desde tu equipo. El campo de URL queda como alternativa si una imagen ya está publicada en Internet.</Tip>
      <div>
        <span className="mb-1.5 block text-sm font-semibold text-[#4b3a50]">1. Subir imágenes desde tu equipo</span>
        <p className="mb-3 text-xs leading-5 text-[#807384]">Formatos JPG, PNG, WEBP o AVIF. Máximo 5 MB por imagen.</p>
        <FilePicker accept="image/jpeg,image/png,image/webp,image/avif" buttonLabel="Elegir imágenes" description="Hasta 8 archivos, máximo 5 MB cada uno" id={`product-images-${editing?.id ?? "new"}`} multiple name="imageFiles" onChange={onImagesChange} selectedNames={imageFileNames} tone="violet" />
      </div>
      {imagePreviews.length > 0 && (
        <div className="grid grid-cols-3 gap-3">
          {imagePreviews.map((url) => (
            <Image alt="Vista previa" className="aspect-square rounded-xl object-cover" height={160} key={url} src={url} unoptimized width={160} />
          ))}
        </div>
      )}
      <div className="border-t border-[#eee9ef] pt-5"><GuidedField label="2. URLs de imágenes (opcional)" help="Alternativa para imágenes que ya están publicadas. Pegá una URL completa por línea." example="Ejemplo: https://misitio.com/cinturon.jpg"><textarea defaultValue={editing?.images.join("\n")} name="images" placeholder="https://.../producto.jpg" /></GuidedField></div>
      </FormSection>

      <FormSection title="4. Publicación" help="Elegí si ya puede verse y si querés mostrarlo en lugares destacados.">
      <div className="grid gap-4 sm:grid-cols-2">
        <ProductField defaultValue={String(editing?.featuredOrder ?? 0)} label="Orden entre destacados" help="Los números menores aparecen primero. 0 es la primera posición." example="Ejemplo: 0" min="0" name="featuredOrder" placeholder="0" type="number" />
        <label className="flex items-center justify-between rounded-xl border border-[#e6dfe8] bg-[#fdfcfe] px-4 py-3">
          <span><span className="text-sm font-semibold">Producto destacado</span><span className="mt-1 block text-xs text-[#807384]">Mostralo con mayor visibilidad.</span></span>
          <input className="accent-[#6E3482]" defaultChecked={editing?.featured ?? false} name="featured" type="checkbox" />
        </label>
      </div>
      <label className="flex items-center justify-between rounded-xl border border-[#e6dfe8] bg-[#fdfcfe] px-4 py-3">
        <span>
          <span className="block text-sm font-semibold">Producto activo</span>
          <span className="text-xs text-[#807384]">Si lo desactivás, queda guardado pero tus clientes no pueden verlo.</span>
        </span>
        <input className="h-5 w-5 accent-[#6E3482]" defaultChecked={editing?.active ?? true} name="active" type="checkbox" />
      </label>
      </FormSection>
      {error && <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
      <button className={`${styles.button} w-full`} disabled={busy} type="submit">
        {busy ? "Guardando…" : "Guardar producto"}
      </button>
    </form>
  );
}

function ProductField({ label, help, example, name, placeholder, defaultValue, type = "text", min, step, required = true }: { label: string; help: string; example: string; name: string; placeholder: string; defaultValue?: string; type?: string; min?: string; step?: string; required?: boolean }) {
  return (
    <GuidedField label={label} help={help} example={example}><input defaultValue={defaultValue} min={min} name={name} placeholder={placeholder} required={required} step={step} type={type} /></GuidedField>
  );
}

function FormSection({ title, help, children }: { title: string; help: string; children: React.ReactNode }) {
  return <section className="space-y-5 rounded-2xl border border-[#e6dfe8] bg-white p-5"><div><h3 className="text-sm font-semibold text-[#4b3a50]">{title}</h3><p className="mt-1 text-xs leading-5 text-[#807384]">{help}</p></div>{children}</section>;
}

function Summary({ label, value, help, alert = false }: { label: string; value: number; help: string; alert?: boolean }) {
  const Icon = alert ? TriangleAlert : value ? Eye : EyeOff;
  return <article className={styles.card}><div className="flex items-start justify-between gap-3"><div><p className="text-xs text-[#807384]">{label}</p><p className="mt-2 text-2xl font-semibold">{value}</p><p className="mt-2 text-xs leading-5 text-[#918495]">{help}</p></div><span className={`rounded-lg p-2 ${alert ? "bg-amber-50 text-amber-700" : "bg-[#f5eff8] text-[#6E3482]"}`}><Icon size={17} /></span></div></article>;
}

function Pagination({ page, totalPages, onChange }: { page: number; totalPages: number; onChange: (page: number) => void }) {
  if (totalPages <= 1) return null;
  const pages = Array.from(new Set([1, page - 1, page, page + 1, totalPages].filter((value) => value >= 1 && value <= totalPages))).sort((a, b) => a - b);
  return <nav aria-label="Paginación de productos" className="mt-4 flex flex-wrap items-center justify-between gap-3"><p className="text-xs text-[#807384]">Página {page} de {totalPages}</p><div className="flex items-center gap-1"><button aria-label="Página anterior" className="grid h-9 w-9 place-items-center rounded-lg border border-[#e6dfe8] disabled:opacity-40" disabled={page <= 1} onClick={() => onChange(page - 1)} type="button"><ChevronLeft size={16} /></button>{pages.map((value, index) => <span className="flex items-center" key={value}>{index > 0 && value - pages[index - 1] > 1 && <span className="px-1 text-[#918495]">…</span>}<button aria-current={value === page ? "page" : undefined} className={`h-9 min-w-9 rounded-lg px-2 text-sm font-semibold ${value === page ? "bg-[#6E3482] text-white" : "border border-[#e6dfe8]"}`} onClick={() => onChange(value)} type="button">{value}</button></span>)}<button aria-label="Página siguiente" className="grid h-9 w-9 place-items-center rounded-lg border border-[#e6dfe8] disabled:opacity-40" disabled={page >= totalPages} onClick={() => onChange(page + 1)} type="button"><ChevronRight size={16} /></button></div></nav>;
}

function ImportPreviewPanel({ preview }: { preview: ImportPreview }) {
  return <div className="mt-5 space-y-4"><div className="grid grid-cols-2 gap-3 sm:grid-cols-4"><ImportMetric label="Filas" value={preview.totalRows} /><ImportMetric label="Nuevos" value={preview.creates} /><ImportMetric label="Actualizaciones" value={preview.updates} /><ImportMetric label="Lugares disponibles" value={preview.availableSlots} /></div>{preview.categoriesToCreate.length > 0 && <p className="rounded-xl bg-blue-50 px-4 py-3 text-xs leading-5 text-blue-800"><strong>Categorías nuevas:</strong> {preview.categoriesToCreate.join(", ")}.</p>}{preview.errors.length > 0 ? <div className="max-h-48 overflow-y-auto rounded-xl border border-red-200 bg-red-50 p-4"><p className="text-sm font-semibold text-red-800">Corregí {preview.errors.length} error{preview.errors.length === 1 ? "" : "es"}</p><ul className="mt-2 space-y-1 text-xs text-red-700">{preview.errors.map((issue, index) => <li key={`${issue.row}-${issue.field}-${index}`}>{issue.row ? `Fila ${issue.row}` : "Archivo"} · {issue.field}: {issue.message}</li>)}</ul></div> : <div className="rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-800"><strong>Archivo listo para importar.</strong> Ningún producto se guardó todavía.</div>}{preview.sample.length > 0 && <div className="overflow-x-auto rounded-xl border border-[#e6dfe8]"><table className="w-full min-w-[36rem] text-left text-xs"><thead className="bg-[#fbfafc] text-[#807384]"><tr><th className="px-3 py-2">Fila</th><th className="px-3 py-2">SKU</th><th className="px-3 py-2">Producto</th><th className="px-3 py-2">Precio</th><th className="px-3 py-2">Stock</th><th className="px-3 py-2">Acción</th></tr></thead><tbody className="divide-y divide-[#eee9ef]">{preview.sample.map((row) => <tr key={row.row}><td className="px-3 py-2">{row.row}</td><td className="px-3 py-2 font-medium">{row.sku}</td><td className="px-3 py-2">{row.name}</td><td className="px-3 py-2">{money.format(row.priceInCents / 100)}</td><td className="px-3 py-2">{row.stock}</td><td className="px-3 py-2">{row.action === "CREATE" ? "Crear" : "Actualizar"}</td></tr>)}</tbody></table></div>}</div>;
}

function ImportMetric({ label, value }: { label: string; value: number }) {
  return <div className="rounded-xl bg-[#fbfafc] p-3"><p className="text-xs text-[#918495]">{label}</p><p className="mt-1 text-xl font-semibold">{value}</p></div>;
}

function createSlug(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
