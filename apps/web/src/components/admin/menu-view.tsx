"use client";

import Image from "next/image";
import Link from "next/link";
import { ExternalLink, Plus, QrCode, Save, Trash2, UtensilsCrossed } from "lucide-react";
import { useEffect, useState } from "react";

import type { BranchRole, TenantRole } from "@infinityfood/contracts";
import { ApiError, apiRequest } from "@/lib/api";

type MenuItem = {
  availability: "AVAILABLE" | "SOLD_OUT" | "HIDDEN";
  priceOverrideInCents: number | null;
  sortOrder: number;
  featured: boolean;
  product: {
    id: string; name: string; priceInCents: number; preparationTimeMinutes: number;
    category: { id: string; name: string } | null;
    modifierGroups: Array<{ id: string; name: string; minChoices: number; maxChoices: number; sortOrder: number; active: boolean; options: Array<{ id: string; name: string; priceInCents: number; sortOrder: number; active: boolean }> }>;
  };
};

type MenuResponse = { branch: { name: string }; menuPath: string; items: MenuItem[] };

type ModifierDraft = { name: string; minChoices: number; maxChoices: number; sortOrder: number; active: boolean; options: Array<{ name: string; priceInCents: number; sortOrder: number; active: boolean }> };

function ModifierEditor({ productId, initial, disabled }: { productId: string; initial: MenuItem["product"]["modifierGroups"]; disabled: boolean }) {
  const [open, setOpen] = useState(false);
  const [groups, setGroups] = useState<ModifierDraft[]>(() => initial.map((group) => ({ ...group, options: group.options.map((option) => ({ ...option })) })));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  function changeGroup(index: number, change: Partial<ModifierDraft>) { setGroups((current) => current.map((group, groupIndex) => groupIndex === index ? { ...group, ...change } : group)); }
  function changeOption(groupIndex: number, optionIndex: number, change: Partial<ModifierDraft["options"][number]>) {
    setGroups((current) => current.map((group, currentGroup) => currentGroup === groupIndex ? { ...group, options: group.options.map((option, currentOption) => currentOption === optionIndex ? { ...option, ...change } : option) } : group));
  }
  async function save() {
    setBusy(true); setMessage("");
    try {
      await apiRequest(`/admin/advanced/menu-items/${productId}/modifiers`, { method: "PUT", body: JSON.stringify({ groups }) });
      setMessage("Modificadores guardados");
    } catch (caught) { setMessage(caught instanceof Error ? caught.message : "No se pudieron guardar los modificadores"); }
    finally { setBusy(false); }
  }
  return <div className="md:col-span-full">
    <button className="text-xs font-semibold text-[#6E3482]" onClick={() => setOpen((current) => !current)} type="button">{open ? "Ocultar" : "Configurar"} modificadores ({groups.length})</button>
    {open && <div className="mt-3 space-y-3 rounded-2xl bg-stone-50 p-4">{groups.map((group, groupIndex) => <div className="rounded-xl border bg-white p-3" key={`${groupIndex}:${group.name}`}>
      <div className="grid gap-2 sm:grid-cols-[1fr_6rem_6rem_auto]"><input className="control" disabled={disabled} onChange={(event) => changeGroup(groupIndex, { name: event.target.value })} placeholder="Ej. Guarnición" value={group.name}/><input className="control" disabled={disabled} min="0" onChange={(event) => changeGroup(groupIndex, { minChoices: Number(event.target.value) })} title="Mínimo" type="number" value={group.minChoices}/><input className="control" disabled={disabled} min="1" onChange={(event) => changeGroup(groupIndex, { maxChoices: Number(event.target.value) })} title="Máximo" type="number" value={group.maxChoices}/><button className="rounded-lg border p-2 text-red-600" disabled={disabled} onClick={() => setGroups((current) => current.filter((_, index) => index !== groupIndex))} type="button"><Trash2 className="mx-auto" size={15}/></button></div>
      <div className="mt-2 space-y-2">{group.options.map((option, optionIndex) => <div className="grid grid-cols-[1fr_8rem_auto] gap-2" key={`${optionIndex}:${option.name}`}><input className="control" disabled={disabled} onChange={(event) => changeOption(groupIndex, optionIndex, { name: event.target.value })} placeholder="Opción" value={option.name}/><input className="control" disabled={disabled} min="0" onChange={(event) => changeOption(groupIndex, optionIndex, { priceInCents: Math.round(Number(event.target.value) * 100) })} placeholder="Precio extra" type="number" value={option.priceInCents / 100}/><button className="rounded-lg border p-2 text-red-600" disabled={disabled || group.options.length === 1} onClick={() => changeGroup(groupIndex, { options: group.options.filter((_, index) => index !== optionIndex) })} type="button"><Trash2 size={14}/></button></div>)}</div>
      <button className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-[#6E3482]" disabled={disabled} onClick={() => changeGroup(groupIndex, { options: [...group.options, { name: "", priceInCents: 0, sortOrder: group.options.length, active: true }] })} type="button"><Plus size={13}/> Opción</button>
    </div>)}
      {!disabled && <div className="flex flex-wrap items-center gap-2"><button className="inline-flex items-center gap-1 rounded-xl border px-3 py-2 text-xs font-semibold" onClick={() => setGroups((current) => [...current, { name: "", minChoices: 0, maxChoices: 1, sortOrder: current.length, active: true, options: [{ name: "", priceInCents: 0, sortOrder: 0, active: true }] }])} type="button"><Plus size={14}/> Grupo</button><button className="rounded-xl bg-[#6E3482] px-4 py-2 text-xs font-semibold text-white disabled:opacity-50" disabled={busy} onClick={() => void save()} type="button">{busy ? "Guardando…" : "Guardar modificadores"}</button>{message && <span className="text-xs text-stone-500">{message}</span>}</div>}
    </div>}
  </div>;
}

export function MenuView({ role, branchRole }: { role: TenantRole; branchRole: BranchRole | null }) {
  const canManage = role !== "STAFF" || branchRole === "MANAGER";
  const [data, setData] = useState<MenuResponse | null>(null);
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    void apiRequest<MenuResponse>("/admin/menu")
      .then((response) => { if (active) setData(response); })
      .catch((caught) => { if (active) setError(caught instanceof ApiError ? caught.message : "No se pudo cargar la carta"); });
    return () => { active = false; };
  }, []);

  function update(productId: string, change: Partial<MenuItem>) {
    setData((current) => current ? { ...current, items: current.items.map((item) => item.product.id === productId ? { ...item, ...change } : item) } : current);
  }

  async function save(item: MenuItem) {
    setBusyId(item.product.id); setError("");
    try {
      await apiRequest(`/admin/menu/items/${item.product.id}`, {
        method: "PUT",
        body: JSON.stringify({ availability: item.availability, priceOverrideInCents: item.priceOverrideInCents, sortOrder: item.sortOrder, featured: item.featured }),
      });
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "No se pudo actualizar el plato");
    } finally { setBusyId(""); }
  }

  if (!data) return <div className="h-72 animate-pulse rounded-3xl bg-white" />;
  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <header className="flex flex-col justify-between gap-5 rounded-3xl bg-[#211b23] p-6 text-white sm:flex-row sm:items-center">
        <div><p className="text-xs font-bold uppercase tracking-[0.18em] text-[#d9b8e5]">Carta por sucursal</p><h2 className="mt-2 text-2xl font-semibold">{data.branch.name}</h2><p className="mt-2 max-w-2xl text-sm text-white/55">Definí disponibilidad, precio especial y orden sin duplicar los productos del restaurante.</p></div>
        <div className="flex gap-2">
          <Link className="inline-flex items-center gap-2 rounded-xl bg-white px-4 py-3 text-sm font-semibold text-[#49225B]" href={data.menuPath} target="_blank">Ver carta <ExternalLink size={15} /></Link>
          <a className="inline-flex items-center gap-2 rounded-xl border border-white/20 px-4 py-3 text-sm font-semibold" download href="/api/admin/menu/qr.svg"><QrCode size={16} /> QR</a>
        </div>
      </header>
      <section className="grid gap-6 lg:grid-cols-[1fr_15rem]">
        <div className="overflow-hidden rounded-2xl border border-[#e6dfe8] bg-white">
          {data.items.length === 0 ? <p className="p-10 text-center text-sm text-stone-500">Creá platos desde Productos para incorporarlos a la carta.</p> : <div className="divide-y divide-stone-100">{data.items.map((item) => (
            <article className="grid gap-4 p-5 md:grid-cols-[minmax(12rem,1fr)_9rem_10rem_5rem_auto] md:items-end" key={item.product.id}>
              <div><p className="text-xs text-[#8f7c94]">{item.product.category?.name ?? "Sin sección"}</p><h3 className="mt-1 font-semibold">{item.product.name}</h3><p className="mt-1 text-xs text-stone-400">Base ${(item.product.priceInCents / 100).toLocaleString("es-AR")} · {item.product.preparationTimeMinutes} min</p></div>
              <label className="text-xs font-semibold text-stone-500">Estado<select className="control mt-1" disabled={!canManage} onChange={(event) => update(item.product.id, { availability: event.target.value as MenuItem["availability"] })} value={item.availability}><option value="AVAILABLE">Disponible</option><option value="SOLD_OUT">Agotado</option><option value="HIDDEN">Oculto</option></select></label>
              <label className="text-xs font-semibold text-stone-500">Precio especial<input className="control mt-1" disabled={!canManage} min="0" onChange={(event) => update(item.product.id, { priceOverrideInCents: event.target.value ? Math.round(Number(event.target.value) * 100) : null })} placeholder="Usar precio base" type="number" value={item.priceOverrideInCents === null ? "" : item.priceOverrideInCents / 100} /></label>
              <label className="text-xs font-semibold text-stone-500">Orden<input className="control mt-1" disabled={!canManage} min="0" onChange={(event) => update(item.product.id, { sortOrder: Number(event.target.value) })} type="number" value={item.sortOrder} /></label>
              {canManage && <button className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-[#6E3482] px-4 text-sm font-semibold text-white disabled:opacity-50" disabled={busyId === item.product.id} onClick={() => void save(item)} type="button"><Save size={15} /> Guardar</button>}
              <ModifierEditor disabled={!canManage} initial={item.product.modifierGroups} productId={item.product.id}/>
            </article>
          ))}</div>}
        </div>
        <aside className="h-fit rounded-2xl border border-[#e6dfe8] bg-white p-5 text-center"><Image alt="Código QR de la carta" className="mx-auto h-auto w-full" height={220} src="/api/admin/menu/qr.svg" unoptimized width={220} /><p className="mt-3 text-xs leading-5 text-stone-500">Descargalo e imprimilo para las mesas de esta sucursal.</p><UtensilsCrossed className="mx-auto mt-4 text-[#6E3482]" size={20} /></aside>
      </section>
      {error && <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
    </div>
  );
}
