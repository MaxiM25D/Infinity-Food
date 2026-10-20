"use client";

import { FolderOpen, Pencil, Plus, Trash2 } from "lucide-react";
import { FormEvent, useEffect, useState } from "react";

import { ApiError, apiRequest } from "@/lib/api";
import { confirmAction } from "@/lib/confirm-action";
import type { Category, Role } from "./types";
import { EmptyState, Field, GuideLink, Tip, panelStyles as styles } from "./guided-panel";

export function CategoriesView({ onOpenProducts, role }: { onOpenProducts: () => void; role: Role }) {
  const canManage = role !== "STAFF";
  const [categories, setCategories] = useState<Category[]>([]);
  const [editing, setEditing] = useState<Category | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    const response = await apiRequest<{ categories: Category[] }>("/admin/categories");
    setCategories(response.categories);
  }

  useEffect(() => {
    let active = true;
    void apiRequest<{ categories: Category[] }>("/admin/categories").then((response) => {
      if (active) setCategories(response.categories);
    });
    return () => {
      active = false;
    };
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    setBusy(true);
    setError("");
    const form = new FormData(formElement);

    try {
      const name = String(form.get("name") ?? "").trim();
      const slug = String(form.get("slug") ?? "").trim() || createSlug(name);
      await apiRequest(editing ? `/admin/categories/${editing.id}` : "/admin/categories", {
        method: editing ? "PATCH" : "POST",
        body: JSON.stringify({
          name,
          slug,
          description: form.get("description") || null,
          displayOrder: Number(form.get("displayOrder") || 0),
          active: form.get("active") === "on",
        }),
      });
      formElement.reset();
      setEditing(null);
      await load();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "No se pudo guardar la categoría");
    } finally {
      setBusy(false);
    }
  }

  async function remove(category: Category) {
    if (!(await confirmAction({ title: `¿Eliminar “${category.name}”?`, description: "Los productos conservarán sus datos, pero esta categoría dejará de estar disponible.", confirmLabel: "Eliminar categoría", tone: "danger" }))) return;
    setError("");
    try {
      await apiRequest(`/admin/categories/${category.id}`, { method: "DELETE" });
      await load();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "No se pudo eliminar");
    }
  }

  return (
    <div className={`${styles.surface} mx-auto max-w-7xl`}>
      <header className="mb-6"><p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#6E3482]">Secciones</p><h2 className="mt-2 text-2xl font-semibold tracking-tight">Ordená tu carta</h2><p className="mt-2 text-sm text-[#807384]">Agrupá platos y bebidas para que tus clientes recorran la carta rápidamente.</p></header>
      <Tip title="Ejemplo simple">Podés crear Entradas, Principales, Postres y Bebidas. Cada plato pertenece a una sección.</Tip>
      <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_24rem]">
      <section className="overflow-hidden rounded-[1.5rem] border border-[#e6dfe8] bg-white">
        <div className="flex items-center justify-between gap-4 border-b border-[#eee9ef] px-6 py-5">
          <div><h3 className="font-semibold">Categorías creadas</h3><p className="mt-1 text-xs text-[#807384]">{categories.length} categoría{categories.length === 1 ? "" : "s"} · {categories.reduce((total, category) => total + (category._count?.products ?? 0), 0)} productos organizados</p></div>
          <span className="rounded-xl bg-[#f5eff8] p-2.5 text-[#6E3482]"><FolderOpen size={19} /></span>
        </div>
        {categories.length === 0 ? (
          <div className="p-6"><EmptyState title="Todavía no hay categorías">Creá la primera desde el formulario. Después asignala desde <GuideLink onClick={onOpenProducts}>Productos</GuideLink>.</EmptyState></div>
        ) : (
          <div className="divide-y divide-stone-100">
            {categories.map((category) => (
              <article className="flex flex-col justify-between gap-4 px-6 py-4 sm:flex-row sm:items-center" key={category.id}>
                <div className="flex min-w-0 items-center gap-4">
                  <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-[#f5eff8] font-semibold text-[#6E3482]">{category.name[0]}</span>
                  <div className="min-w-0">
                    <p className="truncate font-semibold">{category.name}</p>
                    <p className="mt-0.5 text-xs text-[#807384]">/categoria/{category.slug} · {category._count?.products ?? 0} producto{(category._count?.products ?? 0) === 1 ? "" : "s"}</p>
                  </div>
                </div>
                {canManage && (
                  <div className="flex gap-2">
                    <button className="inline-flex items-center gap-1.5 rounded-lg border border-[#e6dfe8] px-3 py-2 text-xs font-semibold text-[#6E3482] hover:bg-[#fdfafe]" onClick={() => { setEditing(category); setError(""); }} type="button"><Pencil size={13} /> Editar</button>
                    <button className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold text-red-600 hover:bg-red-50" onClick={() => remove(category)} type="button"><Trash2 size={13} /> Eliminar</button>
                  </div>
                )}
              </article>
            ))}
          </div>
        )}
      </section>

      <aside className="h-fit rounded-[1.5rem] border border-[#e6dfe8] bg-white p-6 shadow-[0_20px_50px_rgba(52,31,59,.05)]">
        <div className="flex items-start justify-between gap-3"><div><h3 className="font-semibold">{editing ? "Editar categoría" : "Nueva categoría"}</h3><p className="mt-1 text-xs leading-5 text-[#807384]">{canManage ? "Completá el nombre. La dirección web puede generarse sola." : "Tu rol permite consultar, no editar."}</p></div><span className="rounded-lg bg-[#f5eff8] p-2 text-[#6E3482]"><Plus size={17} /></span></div>
        {canManage && (
          <form className="mt-6 space-y-5" key={editing?.id ?? "new"} onSubmit={submit}>
            <Field label="Nombre de la categoría" help="Es el nombre que verá el cliente en el menú y los filtros." example="Ejemplo: Cinturones"><input defaultValue={editing?.name} name="name" placeholder="Cinturones" required /></Field>
            <Field label="Dirección web (opcional)" help="Es la parte final de la URL. Dejala vacía para generarla desde el nombre." example="Ejemplo: /categoria/cinturones"><input defaultValue={editing?.slug} name="slug" placeholder="cinturones" /></Field>
            <Field label="Descripción (opcional)" help="Una breve introducción para esta sección de la carta." example="Ejemplo: Para compartir antes del plato principal."><textarea defaultValue={editing?.description ?? ""} name="description" /></Field>
            <Field label="Orden" help="Los números menores aparecen primero." example="Ejemplo: 10"><input defaultValue={editing?.displayOrder ?? 0} min="0" name="displayOrder" type="number" /></Field>
            <label className="flex items-center justify-between rounded-xl border border-[#e6dfe8] px-4 py-3 text-sm font-semibold">Visible en la carta<input defaultChecked={editing?.active ?? true} name="active" type="checkbox" /></label>
            {error && <p className="rounded-xl bg-red-50 px-3 py-2.5 text-xs text-red-700">{error}</p>}
            <div className="flex gap-2">
              <button className={`${styles.button} flex-1`} disabled={busy} type="submit">{busy ? "Guardando…" : editing ? "Guardar cambios" : "Crear categoría"}</button>
              {editing && <button className="rounded-xl border border-[#e6dfe8] px-4 text-sm text-[#6E3482]" onClick={() => { setEditing(null); setError(""); }} type="button">Cancelar</button>}
            </div>
          </form>
        )}
      </aside>
      </div>
    </div>
  );
}

function createSlug(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}
