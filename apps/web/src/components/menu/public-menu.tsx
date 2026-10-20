import { CalendarDays, Clock3, MapPin, Phone, Sparkles, UtensilsCrossed } from "lucide-react";
import Link from "next/link";
import type { CSSProperties } from "react";

export type PublicMenuData = {
  restaurant: { name: string; slug: string; settings: { description: string | null; logoUrl: string | null; bannerUrl: string | null; primaryColor: string; secondaryColor: string; currency: string; whatsapp: string | null } | null };
  branch: { id: string; name: string; slug: string; address: string | null; city: string | null; phone: string | null };
  categories: Array<{ id: string; name: string; slug: string; description: string | null; items: Array<{ id: string; name: string; description: string | null; image: string | null; priceInCents: number; preparationTimeMinutes: number; allergens: string[]; dietaryTags: string[]; availability: "AVAILABLE" | "SOLD_OUT"; featured: boolean }> }>;
};

export function PublicMenu({ menu }: { menu: PublicMenuData }) {
  const settings = menu.restaurant.settings;
  const primary = settings?.primaryColor ?? "#7c3f2c";
  const currency = settings?.currency ?? "ARS";
  const money = new Intl.NumberFormat("es-AR", { style: "currency", currency, maximumFractionDigits: 0 });
  return (
    <main className="min-h-screen bg-[#f7f3ec] text-[#261c18]" style={{ "--menu-primary": primary } as CSSProperties}>
      <header className="relative overflow-hidden bg-[#241916] px-5 py-12 text-white sm:py-16">
        {settings?.bannerUrl && <div className="absolute inset-0 bg-cover bg-center opacity-25" style={{ backgroundImage: `url(${settings.bannerUrl})` }} />}
        <div className="relative mx-auto max-w-5xl">
          <div className="flex items-center gap-4">{settings?.logoUrl ? <div className="h-16 w-16 rounded-2xl bg-cover bg-center ring-1 ring-white/20" style={{ backgroundImage: `url(${settings.logoUrl})` }} /> : <span className="grid h-16 w-16 place-items-center rounded-2xl bg-white/10"><UtensilsCrossed /></span>}<div><p className="text-xs font-bold uppercase tracking-[0.22em] text-white/50">Carta digital</p><h1 className="mt-1 text-3xl font-semibold tracking-tight sm:text-4xl">{menu.restaurant.name}</h1></div></div>
          <h2 className="mt-8 text-lg font-medium text-white/90">{menu.branch.name}</h2>
          <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-sm text-white/55">{(menu.branch.address || menu.branch.city) && <span className="flex items-center gap-2"><MapPin size={14} /> {[menu.branch.address, menu.branch.city].filter(Boolean).join(", ")}</span>}{menu.branch.phone && <span className="flex items-center gap-2"><Phone size={14} /> {menu.branch.phone}</span>}</div>
          <Link className="mt-6 inline-flex items-center gap-2 rounded-full bg-white px-5 py-3 text-sm font-semibold text-[#241916]" href={`/reservas/${menu.restaurant.slug}/${menu.branch.slug}`}><CalendarDays size={16}/>Reservar mesa</Link>
        </div>
      </header>
      <div className="sticky top-0 z-10 overflow-x-auto border-b border-black/5 bg-[#f7f3ec]/95 px-4 py-3 backdrop-blur"><nav className="mx-auto flex w-max max-w-5xl gap-2">{menu.categories.map((category) => <a className="rounded-full bg-white px-4 py-2 text-xs font-semibold shadow-sm" href={`#${category.slug}`} key={category.id}>{category.name}</a>)}</nav></div>
      <div className="mx-auto max-w-5xl space-y-12 px-5 py-10 sm:py-14">
        {menu.categories.length === 0 && <section className="rounded-3xl border border-dashed border-stone-300 bg-white p-12 text-center"><UtensilsCrossed className="mx-auto text-stone-300" /><h2 className="mt-4 text-xl font-semibold">La carta se está preparando</h2><p className="mt-2 text-sm text-stone-500">Consultá al personal por las opciones disponibles.</p></section>}
        {menu.categories.map((category) => <section className="scroll-mt-20" id={category.slug} key={category.id}><div className="mb-5"><h2 className="text-2xl font-semibold tracking-tight">{category.name}</h2>{category.description && <p className="mt-1 text-sm text-stone-500">{category.description}</p>}</div><div className="grid gap-4 md:grid-cols-2">{category.items.map((item) => <article className={`overflow-hidden rounded-2xl border border-black/5 bg-white shadow-[0_12px_35px_rgba(65,44,31,.06)] ${item.availability === "SOLD_OUT" ? "opacity-65" : ""}`} key={item.id}><div className="flex min-h-36"><div className="min-w-0 flex-1 p-5">{item.featured && <p className="mb-2 flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider" style={{ color: primary }}><Sparkles size={12} /> Recomendado</p>}<div className="flex items-start justify-between gap-4"><h3 className="font-semibold">{item.name}</h3><p className="shrink-0 font-semibold" style={{ color: primary }}>{money.format(item.priceInCents / 100)}</p></div>{item.description && <p className="mt-2 line-clamp-3 text-sm leading-5 text-stone-500">{item.description}</p>}<div className="mt-4 flex flex-wrap gap-2 text-[10px] font-semibold uppercase tracking-wide text-stone-400"><span className="flex items-center gap-1"><Clock3 size={12} /> {item.preparationTimeMinutes} min</span>{item.dietaryTags.map((tag) => <span className="rounded-full bg-emerald-50 px-2 py-1 text-emerald-700" key={tag}>{tag}</span>)}{item.availability === "SOLD_OUT" && <span className="rounded-full bg-red-50 px-2 py-1 text-red-700">Agotado</span>}</div>{item.allergens.length > 0 && <p className="mt-3 text-[10px] text-stone-400">Alérgenos: {item.allergens.join(", ")}</p>}</div>{item.image && <div className="w-32 shrink-0 bg-cover bg-center sm:w-40" style={{ backgroundImage: `url(${item.image})` }} />}</div></article>)}</div></section>)}
      </div>
      <footer className="border-t border-black/5 px-5 py-8 text-center text-xs text-stone-400">Carta de {menu.restaurant.name} · {menu.branch.name}</footer>
    </main>
  );
}
