"use client";

import {
  ArrowLeft,
  Check,
  ChevronDown,
  ExternalLink,
  LoaderCircle,
  LockKeyhole,
  Plus,
  Search,
  Store,
  X,
} from "lucide-react";
import { type FormEvent, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";

import { ApiError, apiRequest } from "@/lib/api";
import { type MarketingPlanCode } from "@/lib/plan-catalog";
import { useMarketingPlans } from "@/lib/use-marketing-plans";
import type { Role } from "./types";

type TenantAccess = {
  name: string;
  slug: string;
  status: "ACTIVE" | "SUSPENDED";
  role: Role;
  joinedAt: string;
  current: boolean;
};

type Selection = {
  tenant: { name: string; slug: string };
  role: Role;
};

export function TenantSwitcher({
  current,
  emailVerified,
  onSelected,
}: {
  current: { name: string; slug: string };
  emailVerified: boolean;
  onSelected: (selection: Selection) => void;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [tenants, setTenants] = useState<TenantAccess[]>([]);
  const [busySlug, setBusySlug] = useState("");
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [storeName, setStoreName] = useState("");
  const [storeSlug, setStoreSlug] = useState("");
  const [customSlug, setCustomSlug] = useState(false);
  const [planCode, setPlanCode] = useState<MarketingPlanCode>("PRO");

  useEffect(() => {
    void apiRequest<{ tenants: TenantAccess[] }>("/auth/tenants")
      .then(({ tenants: values }) => setTenants(values))
      .catch((caught) =>
        setError(
          caught instanceof ApiError
            ? caught.message
            : "No se pudieron cargar tus tiendas",
        ),
      );
  }, []);

  useEffect(() => {
    if (!open) return;
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [open]);

  const filteredTenants = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return tenants;
    return tenants.filter(
      ({ name, slug }) =>
        name.toLowerCase().includes(query) || slug.includes(query),
    );
  }, [search, tenants]);

  async function select(slug: string) {
    if (slug === current.slug) {
      setOpen(false);
      return;
    }
    setBusySlug(slug);
    setError("");
    try {
      const selection = await apiRequest<Selection>("/auth/select-tenant", {
        method: "POST",
        body: JSON.stringify({ tenantSlug: slug }),
      });
      onSelected(selection);
      setOpen(false);
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? caught.message
          : "No se pudo cambiar de tienda",
      );
    } finally {
      setBusySlug("");
    }
  }

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusySlug("new");
    setError("");
    try {
      const selection = await apiRequest<Selection>("/auth/tenants", {
        method: "POST",
        body: JSON.stringify({ name: storeName, slug: storeSlug, planCode }),
      });
      onSelected(selection);
      setOpen(false);
      resetCreation();
      router.push("/onboarding");
      router.refresh();
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? caught.message
          : "No se pudo crear la tienda",
      );
    } finally {
      setBusySlug("");
    }
  }

  function resetCreation() {
    setCreating(false);
    setStoreName("");
    setStoreSlug("");
    setCustomSlug(false);
    setPlanCode("PRO");
    setError("");
  }

  function showSelector() {
    setOpen(true);
    resetCreation();
    setSearch("");
  }

  return (
    <div className="my-7">
      <button
        aria-expanded={open}
        className="group flex w-full items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.055] p-3 text-left transition hover:border-[#A56ABD]/40 hover:bg-white/[0.085]"
        onClick={showSelector}
        type="button"
      >
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#6E3482]/30 text-[#d9b8e5]">
          <Store className="h-4 w-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold text-white">
            {current.name}
          </span>
          <span className="mt-0.5 block truncate text-[11px] text-white/40">
            /{current.slug}
          </span>
        </span>
        <ChevronDown className="h-4 w-4 text-white/35 transition group-hover:text-white/70" />
      </button>

      {open && typeof document !== "undefined" &&
        createPortal(
          <div
            className="fixed inset-0 z-[100] grid place-items-center bg-[#130d17]/55 p-4 backdrop-blur-sm"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) setOpen(false);
            }}
          >
            <section
              aria-label="Selector de tiendas"
              aria-modal="true"
              className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-[1.75rem] border border-[#e4dce7] bg-[#fbfafc] shadow-[0_35px_100px_rgba(32,18,38,.28)]"
              role="dialog"
            >
              <header className="sticky top-0 z-10 flex items-start justify-between gap-5 border-b border-[#ebe5ed] bg-[#fbfafc]/95 px-5 py-5 backdrop-blur sm:px-7">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#6E3482]">
                    {creating ? "Nueva tienda" : "Tus tiendas"}
                  </p>
                  <h2 className="mt-1 text-xl font-semibold tracking-tight text-[#2c2130]">
                    {creating
                      ? "Creá otro espacio de venta"
                      : "Elegí dónde querés trabajar"}
                  </h2>
                </div>
                <button
                  aria-label="Cerrar selector"
                  className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-[#e5dee7] bg-white text-[#796d7d] transition hover:text-[#49225B]"
                  onClick={() => setOpen(false)}
                  type="button"
                >
                  <X className="h-4 w-4" />
                </button>
              </header>

              {creating ? (
                <CreateStoreForm
                  busy={busySlug === "new"}
                  customSlug={customSlug}
                  error={error}
                  planCode={planCode}
                  storeName={storeName}
                  storeSlug={storeSlug}
                  onBack={resetCreation}
                  onNameChange={(value) => {
                    setStoreName(value);
                    if (!customSlug) setStoreSlug(createSlug(value));
                  }}
                  onPlanChange={setPlanCode}
                  onSlugChange={(value) => {
                    setCustomSlug(true);
                    setStoreSlug(createSlug(value));
                  }}
                  onSubmit={create}
                />
              ) : (
                <div className="p-5 sm:p-7">
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-4 top-3.5 h-4 w-4 text-[#9b8f9e]" />
                    <input
                      aria-label="Buscar tienda"
                      className="w-full rounded-xl border border-[#dfd7e2] bg-white py-3 pl-11 pr-4 text-sm text-[#342837] outline-none transition placeholder:text-[#aaa0ac] focus:border-[#A56ABD] focus:ring-4 focus:ring-[#A56ABD]/10"
                      onChange={(event) => setSearch(event.target.value)}
                      placeholder="Buscar por nombre o dirección"
                      value={search}
                    />
                  </div>

                  <div className="mt-5 grid gap-3 sm:grid-cols-2">
                    {filteredTenants.map((tenant) => (
                      <TenantCard
                        busy={busySlug === tenant.slug}
                        disabled={tenant.status !== "ACTIVE" || Boolean(busySlug)}
                        key={tenant.slug}
                        tenant={tenant}
                        onSelect={() => void select(tenant.slug)}
                      />
                    ))}
                  </div>

                  {filteredTenants.length === 0 && (
                    <div className="py-12 text-center">
                      <Search className="mx-auto h-6 w-6 text-[#b3a8b6]" />
                      <p className="mt-3 text-sm font-medium text-[#756879]">
                        No encontramos tiendas con esa búsqueda.
                      </p>
                    </div>
                  )}

                  <div className="mt-7 border-t border-[#ebe5ed] pt-6">
                    {emailVerified ? (
                      <button
                        className="flex w-full items-center justify-between gap-4 rounded-2xl border border-dashed border-[#cdbbd3] bg-[#f6f0f8] p-4 text-left transition hover:border-[#A56ABD] hover:bg-[#f1e8f4]"
                        onClick={() => {
                          setCreating(true);
                          setError("");
                        }}
                        type="button"
                      >
                        <span className="flex items-center gap-3">
                          <span className="grid h-10 w-10 place-items-center rounded-xl bg-white text-[#6E3482] shadow-sm">
                            <Plus className="h-4 w-4" />
                          </span>
                          <span>
                            <span className="block text-sm font-semibold text-[#49225B]">
                              Crear otra tienda
                            </span>
                            <span className="mt-1 block text-xs text-[#8d7e91]">
                              Cada tienda mantiene sus datos, plan y cobros separados.
                            </span>
                          </span>
                        </span>
                      </button>
                    ) : (
                      <div className="flex gap-3 rounded-2xl bg-amber-50 p-4 text-amber-900">
                        <LockKeyhole className="mt-0.5 h-4 w-4 shrink-0" />
                        <p className="text-xs leading-5">
                          Verificá tu email desde “Mi cuenta” antes de crear otra tienda.
                        </p>
                      </div>
                    )}
                  </div>
                  {error && (
                    <p className="mt-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">
                      {error}
                    </p>
                  )}
                </div>
              )}
            </section>
          </div>,
          document.body,
        )}
    </div>
  );
}

function TenantCard({
  tenant,
  busy,
  disabled,
  onSelect,
}: {
  tenant: TenantAccess;
  busy: boolean;
  disabled: boolean;
  onSelect: () => void;
}) {
  return (
    <article
      className={`rounded-2xl border p-4 transition ${
        tenant.current
          ? "border-[#A56ABD] bg-[#f5eef7] shadow-[0_8px_28px_rgba(73,34,91,.08)]"
          : tenant.status === "ACTIVE"
            ? "border-[#e4dde6] bg-white hover:border-[#cdb8d4]"
            : "border-[#ece8ed] bg-[#f5f3f5] opacity-65"
      }`}
    >
      <button
        className="w-full text-left"
        disabled={disabled}
        onClick={onSelect}
        type="button"
      >
        <span className="flex items-start gap-3">
          <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl ${tenant.current ? "bg-[#6E3482] text-white" : "bg-[#eee7f0] text-[#6E3482]"}`}>
            {busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Store className="h-4 w-4" />}
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-2">
              <span className="truncate text-sm font-semibold text-[#302433]">{tenant.name}</span>
              {tenant.current && <span className="rounded-full bg-white px-2 py-0.5 text-[9px] font-bold uppercase text-[#6E3482]">Actual</span>}
            </span>
            <span className="mt-1 block truncate text-xs text-[#928597]">/{tenant.slug}</span>
          </span>
          {tenant.current && <Check className="mt-1 h-4 w-4 text-[#6E3482]" />}
        </span>
      </button>
      <div className="mt-4 flex items-center justify-between border-t border-[#eee8f0] pt-3">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-[#8f8193]">{tenant.role}</span>
        {tenant.status === "ACTIVE" ? (
          <a className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#6E3482]" href={`/tienda/${tenant.slug}`} rel="noreferrer" target="_blank">Ver tienda <ExternalLink className="h-3 w-3" /></a>
        ) : (
          <span className="text-[10px] font-semibold uppercase text-red-600">Suspendida</span>
        )}
      </div>
    </article>
  );
}

function CreateStoreForm({
  busy,
  customSlug,
  error,
  planCode,
  storeName,
  storeSlug,
  onBack,
  onNameChange,
  onPlanChange,
  onSlugChange,
  onSubmit,
}: {
  busy: boolean;
  customSlug: boolean;
  error: string;
  planCode: MarketingPlanCode;
  storeName: string;
  storeSlug: string;
  onBack: () => void;
  onNameChange: (value: string) => void;
  onPlanChange: (value: MarketingPlanCode) => void;
  onSlugChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const marketingPlans = useMarketingPlans();
  const selectedMarketingPlan = marketingPlans.find((plan) => plan.code === planCode) ?? marketingPlans[0];
  return (
    <form className="p-5 sm:p-7" onSubmit={onSubmit}>
      <button className="inline-flex items-center gap-2 text-sm font-medium text-[#796d7d]" onClick={onBack} type="button">
        <ArrowLeft className="h-4 w-4" /> Volver a mis tiendas
      </button>
      <div className="mt-6 grid gap-5 sm:grid-cols-2">
        <FormField label="Nombre de la tienda" help="Es el nombre que verán tus compradores.">
          <input autoFocus maxLength={100} onChange={(event) => onNameChange(event.target.value)} placeholder="Ej. Fumiland Shop" required value={storeName} />
        </FormField>
        <FormField label="Dirección de la tienda" help={customSlug ? "Personalizaste la dirección." : "La generamos automáticamente; podés editarla."}>
          <div className="flex items-center rounded-xl border border-[#ded6e1] bg-white focus-within:border-[#A56ABD] focus-within:ring-4 focus-within:ring-[#A56ABD]/10">
            <span className="pl-4 text-xs text-[#a094a3]">/tienda/</span>
            <input className="min-w-0 border-0! pl-1! focus:ring-0!" maxLength={48} minLength={3} onChange={(event) => onSlugChange(event.target.value)} pattern="[a-z0-9]+(?:-[a-z0-9]+)*" required value={storeSlug} />
          </div>
        </FormField>
      </div>

      <div className="mt-8">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div><p className="text-sm font-semibold text-[#3b2d3e]">InfinityFood Pro</p><p className="mt-1 text-xs text-[#918495]">Cada tienda tiene su propia suscripción{selectedMarketingPlan && selectedMarketingPlan.trialDays > 0 ? ` y comienza con ${selectedMarketingPlan.trialDays} días gratis` : ""}.</p></div>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {marketingPlans.map((plan) => {
            const selected = planCode === plan.code;
            return (
              <button className={`rounded-2xl border p-4 text-left transition ${selected ? "border-[#6E3482] bg-[#f4edf6] ring-2 ring-[#A56ABD]/15" : "border-[#e4dde6] bg-white hover:border-[#cdb8d4]"}`} key={plan.code} onClick={() => onPlanChange(plan.code)} type="button">
                <span className="flex items-start justify-between gap-3"><span><span className="block text-sm font-semibold text-[#302433]">{plan.name}</span><span className="mt-1 block text-xl font-semibold text-[#49225B]">{plan.price}<span className="text-xs font-normal text-[#968999]"> / mes</span></span></span><span className={`grid h-6 w-6 place-items-center rounded-full border ${selected ? "border-[#6E3482] bg-[#6E3482] text-white" : "border-[#d9d1dc]"}`}>{selected && <Check className="h-3.5 w-3.5" />}</span></span>
                <span className="mt-3 block text-xs text-[#7f7183]">{plan.capacity}</span>
                <span className="mt-3 block text-[11px] leading-5 text-[#968999]">{plan.features.slice(0, 3).join(" · ")}</span>
              </button>
            );
          })}
        </div>
      </div>

      {error && <p className="mt-5 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
      <div className="mt-7 flex justify-end border-t border-[#ebe5ed] pt-6">
        <button className="inline-flex items-center gap-2 rounded-xl bg-[#49225B] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[#6E3482] disabled:opacity-50" disabled={busy} type="submit">
          {busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          {busy ? "Creando tienda…" : "Crear y empezar a configurar"}
        </button>
      </div>
    </form>
  );
}

function FormField({ label, help, children }: { label: string; help: string; children: React.ReactNode }) {
  return (
    <label className="block text-sm font-medium text-[#3b2d3e]">
      <span className="mb-2 block">{label}</span>
      <span className="[&_input]:w-full [&_input]:rounded-xl [&_input]:border [&_input]:border-[#ded6e1] [&_input]:bg-white [&_input]:px-4 [&_input]:py-3 [&_input]:text-sm [&_input]:outline-none [&_input]:transition [&_input]:focus:border-[#A56ABD] [&_input]:focus:ring-4 [&_input]:focus:ring-[#A56ABD]/10">{children}</span>
      <span className="mt-2 block text-xs font-normal leading-5 text-[#958899]">{help}</span>
    </label>
  );
}

function createSlug(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}
