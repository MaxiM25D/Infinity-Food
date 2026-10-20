"use client";

import { CheckCircle2, Minus, Plus, Send, ShoppingBasket, UtensilsCrossed } from "lucide-react";
import { useMemo, useState } from "react";

import { apiRequest } from "@/lib/api";

export type TableMenu = {
  restaurant: { name: string; slug: string; settings: { currency: string; logoUrl: string | null; primaryColor: string } | null };
  branch: { name: string; slug: string };
  table: { id: string; code: string; name: string };
  categories: Array<{ id: string; name: string; items: Array<{ id: string; name: string; description: string | null; image: string | null; priceInCents: number; preparationTimeMinutes: number; allergens: string[]; dietaryTags: string[] }> }>;
};

export function TableOrder({ menu }: { menu: TableMenu }) {
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [customerName, setCustomerName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirmation, setConfirmation] = useState<{ number: number; orderId: string } | null>(null);
  const products = useMemo(() => menu.categories.flatMap((category) => category.items), [menu]);
  const count = Object.values(quantities).reduce((sum, quantity) => sum + quantity, 0);
  const total = products.reduce((sum, product) => sum + product.priceInCents * (quantities[product.id] ?? 0), 0);
  const money = new Intl.NumberFormat("es-AR", { style: "currency", currency: menu.restaurant.settings?.currency ?? "ARS", maximumFractionDigits: 0 });
  const primary = menu.restaurant.settings?.primaryColor ?? "#7c3f2c";

  function change(productId: string, delta: number) {
    setQuantities((current) => ({ ...current, [productId]: Math.max(0, (current[productId] ?? 0) + delta) }));
  }

  async function submit() {
    if (!customerName.trim() || count === 0) return;
    setBusy(true); setError("");
    try {
      const clientRequestId = crypto.randomUUID();
      const body = {
        clientRequestId, customerName: customerName.trim(),
        items: products.filter((product) => quantities[product.id]).map((product) => ({ productId: product.id, quantity: quantities[product.id], notes: notes[product.id] || null })),
      };
      const stored = localStorage.getItem(`infinityfood:${menu.restaurant.slug}:${menu.branch.slug}:${menu.table.code}`);
      const previous = stored ? JSON.parse(stored) as { orderId: string; orderToken: string } : null;
      const result = previous
        ? await apiRequest<{ order: { id: string; number: number } }>(`/dining/${menu.restaurant.slug}/${menu.branch.slug}/orders/${previous.orderId}/rounds`, { method: "POST", body: JSON.stringify({ ...body, orderToken: previous.orderToken }) })
        : await apiRequest<{ order: { id: string; number: number }; orderToken: string }>(`/dining/${menu.restaurant.slug}/${menu.branch.slug}/tables/${menu.table.code}/orders`, { method: "POST", body: JSON.stringify(body) });
      const orderToken = "orderToken" in result ? result.orderToken : previous!.orderToken;
      localStorage.setItem(`infinityfood:${menu.restaurant.slug}:${menu.branch.slug}:${menu.table.code}`, JSON.stringify({ orderId: result.order.id, orderToken }));
      setConfirmation({ number: result.order.number, orderId: result.order.id });
      setQuantities({}); setNotes({});
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "No pudimos enviar la comanda");
    } finally { setBusy(false); }
  }

  return <main className="min-h-screen bg-[#f8f4ee] pb-36 text-[#281e19]">
    <header className="bg-[#211917] px-5 py-8 text-white"><div className="mx-auto max-w-4xl"><p className="text-xs font-bold uppercase tracking-[.2em] text-white/50">Pedido desde la mesa</p><div className="mt-3 flex items-center gap-3"><span className="grid h-12 w-12 place-items-center rounded-2xl bg-white/10"><UtensilsCrossed /></span><div><h1 className="text-2xl font-semibold">{menu.restaurant.name}</h1><p className="text-sm text-white/60">{menu.branch.name} · {menu.table.name}</p></div></div></div></header>
    <div className="mx-auto max-w-4xl space-y-10 px-4 py-8">
      {confirmation && <section className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5 text-emerald-900"><p className="flex items-center gap-2 font-semibold"><CheckCircle2 size={18} /> Comanda #{confirmation.number} enviada</p><p className="mt-1 text-sm">Podés seguir agregando rondas desde esta misma pantalla.</p></section>}
      {menu.categories.map((category) => <section key={category.id}><h2 className="mb-4 text-xl font-semibold">{category.name}</h2><div className="grid gap-3 sm:grid-cols-2">{category.items.map((item) => <article className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm" key={item.id}><div className="flex justify-between gap-3"><div><h3 className="font-semibold">{item.name}</h3>{item.description && <p className="mt-1 text-sm text-stone-500">{item.description}</p>}<p className="mt-2 text-xs text-stone-400">{item.preparationTimeMinutes} min</p></div><p className="shrink-0 font-bold" style={{ color: primary }}>{money.format(item.priceInCents / 100)}</p></div><div className="mt-4 flex items-center justify-between"><input aria-label={`Notas para ${item.name}`} className="min-w-0 flex-1 rounded-xl border border-stone-200 px-3 py-2 text-xs" onChange={(event) => setNotes((current) => ({ ...current, [item.id]: event.target.value }))} placeholder="Aclaración" value={notes[item.id] ?? ""} /><div className="ml-3 flex items-center gap-2"><button aria-label={`Quitar ${item.name}`} className="grid h-8 w-8 place-items-center rounded-full border" onClick={() => change(item.id, -1)} type="button"><Minus size={14} /></button><span className="w-5 text-center text-sm font-bold">{quantities[item.id] ?? 0}</span><button aria-label={`Agregar ${item.name}`} className="grid h-8 w-8 place-items-center rounded-full text-white" onClick={() => change(item.id, 1)} style={{ backgroundColor: primary }} type="button"><Plus size={14} /></button></div></div></article>)}</div></section>)}
    </div>
    <aside className="fixed inset-x-0 bottom-0 border-t border-stone-200 bg-white/95 p-4 backdrop-blur"><div className="mx-auto flex max-w-4xl flex-col gap-3 sm:flex-row sm:items-center"><input className="min-w-0 flex-1 rounded-xl border border-stone-300 px-4 py-3 text-sm" onChange={(event) => setCustomerName(event.target.value)} placeholder="Tu nombre" value={customerName} /><div className="flex items-center justify-between gap-4"><span className="flex items-center gap-2 text-sm"><ShoppingBasket size={17} /> {count} · <strong>{money.format(total / 100)}</strong></span><button className="inline-flex items-center gap-2 rounded-xl px-5 py-3 text-sm font-bold text-white disabled:opacity-40" disabled={busy || count === 0 || !customerName.trim()} onClick={() => void submit()} style={{ backgroundColor: primary }} type="button"><Send size={16} /> {busy ? "Enviando…" : confirmation ? "Enviar ronda" : "Pedir"}</button></div>{error && <p className="text-xs text-red-600">{error}</p>}</div></aside>
  </main>;
}
