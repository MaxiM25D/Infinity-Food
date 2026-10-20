"use client";

import {
  ArrowLeft,
  ArrowRight,
  Check,
  CircleCheck,
  ExternalLink,
  Mail,
  Palette,
  PackagePlus,
  Settings2,
  ShoppingBag,
  Store,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useState } from "react";

import styles from "@/app/onboarding/onboarding.module.css";
import { ApiError, apiRequest } from "@/lib/api";
import { BrandLogo } from "./brand-logo";
import type { Dashboard, Role, Store as StoreType } from "./admin/types";
import { StoreAssetPicker } from "./store-asset-picker";

type Session = {
  user: { firstName: string; email: string; emailVerified: boolean };
  tenant: { name: string; slug: string };
  role: Role;
};

type Draft = {
  name: string;
  description: string;
  contactEmail: string;
  whatsapp: string;
  primaryColor: string;
  currency: string;
  logoUrl: string;
  bannerUrl: string;
};

const palette = ["#A56ABD", "#6E3482", "#49225B", "#315C72", "#2F6655"];
const steps = [
  { label: "Identidad", icon: Store },
  { label: "Apariencia", icon: Palette },
  { label: "Primeros pasos", icon: CircleCheck },
];

export function OnboardingFlow() {
  const router = useRouter();
  const [session, setSession] = useState<Session | null>(null);
  const [store, setStore] = useState<StoreType | null>(null);
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [bannerFile, setBannerFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState("");
  const [bannerPreview, setBannerPreview] = useState("");

  useEffect(() => {
    void Promise.all([
      apiRequest<Session>("/auth/me"),
      apiRequest<{ store: StoreType }>("/admin/store"),
      apiRequest<Dashboard>("/admin/dashboard"),
    ])
      .then(([currentSession, storeResponse, metrics]) => {
        const currentStore = storeResponse.store;
        setSession(currentSession);
        setStore(currentStore);
        setDashboard(metrics);
        setDraft({
          name: currentStore.name,
          description: currentStore.settings?.description ?? "",
          contactEmail:
            currentStore.settings?.contactEmail ?? currentSession.user.email,
          whatsapp: currentStore.settings?.whatsapp ?? "",
          primaryColor: currentStore.settings?.primaryColor ?? "#6E3482",
          currency: currentStore.settings?.currency ?? "ARS",
          logoUrl: currentStore.settings?.logoUrl ?? "",
          bannerUrl: currentStore.settings?.bannerUrl ?? "",
        });
      })
      .catch((caught) => {
        if (caught instanceof ApiError && caught.status === 401) {
          router.replace("/login");
          return;
        }
        setError(
          caught instanceof ApiError
            ? caught.message
            : "No pudimos cargar la configuración inicial",
        );
      });
  }, [router]);

  function update<Key extends keyof Draft>(key: Key, value: Draft[Key]) {
    setDraft((current) => (current ? { ...current, [key]: value } : current));
  }

  async function saveCurrent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft || !session) return;
    setBusy(true);
    setError("");
    try {
      let body: Record<string, string | null>;
      if (step === 0) {
        body = {
              name: draft.name,
              description: draft.description || null,
              contactEmail: draft.contactEmail || null,
              whatsapp: draft.whatsapp || null,
            };
      } else {
        let logoUrl = draft.logoUrl || null;
        let bannerUrl = draft.bannerUrl || null;
        if (logoFile || bannerFile) {
          const upload = new FormData();
          if (logoFile) upload.append("logo", logoFile);
          if (bannerFile) upload.append("banner", bannerFile);
          const uploaded = await apiRequest<{
            logoUrl?: string;
            bannerUrl?: string;
          }>("/admin/uploads/store-assets", { method: "POST", body: upload });
          logoUrl = uploaded.logoUrl ?? logoUrl;
          bannerUrl = uploaded.bannerUrl ?? bannerUrl;
        }
        body = {
          primaryColor: draft.primaryColor,
          currency: draft.currency,
          logoUrl,
          bannerUrl,
        };
      }
      const response = await apiRequest<{ store: StoreType }>("/admin/store", {
        method: "PATCH",
        body: JSON.stringify(body),
      });
      setStore(response.store);
      setDraft((current) => current ? {
        ...current,
        logoUrl: response.store.settings?.logoUrl ?? "",
        bannerUrl: response.store.settings?.bannerUrl ?? "",
      } : current);
      setLogoFile(null);
      setBannerFile(null);
      if (logoPreview) URL.revokeObjectURL(logoPreview);
      if (bannerPreview) URL.revokeObjectURL(bannerPreview);
      setLogoPreview("");
      setBannerPreview("");
      setStep((current) => Math.min(current + 1, 2));
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? caught.message
          : "No pudimos guardar los cambios",
      );
    } finally {
      setBusy(false);
    }
  }

  if (!session || !store || !draft || !dashboard) {
    return (
      <main className={`${styles.page} grid place-items-center px-6`}>
        <div className="flex items-center gap-3 text-sm font-medium text-[#6e6072]">
          <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-[#6E3482]" />
          Preparando tu espacio…
        </div>
      </main>
    );
  }

  const canEdit = session.role !== "STAFF";

  return (
    <main className={styles.page}>
      <header className="mx-auto flex max-w-7xl items-center justify-between px-5 py-6 sm:px-8">
        <BrandLogo tone="light" />
        <Link
          className="text-sm font-medium text-[#756879] transition hover:text-[#49225B]"
          href="/admin"
        >
          Salir al panel
        </Link>
      </header>

      <div className="mx-auto max-w-7xl px-5 pb-12 pt-3 sm:px-8 lg:pt-8">
        <div className="mb-8 max-w-2xl">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#6E3482]">
            Configuración inicial
          </p>
          <h1 className="mt-3 text-3xl font-semibold tracking-[-0.035em] text-[#241a28] sm:text-4xl">
            Prepará tu tienda para empezar a vender.
          </h1>
          <p className="mt-3 text-sm leading-6 text-[#756879] sm:text-base">
            Solo lo esencial. Después vas a poder ajustar cada detalle desde el panel.
          </p>
        </div>

        <section
          className={`${styles.shell} overflow-hidden rounded-[1.75rem] border border-[#e7e0e9] bg-white lg:grid lg:grid-cols-[17rem_1fr]`}
        >
          <aside className="border-b border-[#eee9ef] bg-[#fbfafc] p-5 lg:border-b-0 lg:border-r lg:p-7">
            <p className="mb-5 text-xs font-medium text-[#8b7d8f]">
              Paso {step + 1} de {steps.length}
            </p>
            <nav aria-label="Pasos del onboarding" className="grid grid-cols-3 gap-2 lg:grid-cols-1">
              {steps.map((item, index) => {
                const Icon = item.icon;
                const active = index === step;
                const done = index < step;
                return (
                  <button
                    className={`flex min-w-0 items-center gap-3 rounded-xl px-3 py-3 text-left text-sm transition ${
                      active
                        ? "bg-[#f1e9f4] font-semibold text-[#49225B]"
                        : done
                          ? "text-[#6E3482] hover:bg-[#f6f1f7]"
                          : "text-[#978b9a]"
                    }`}
                    key={item.label}
                    onClick={() => done && setStep(index)}
                    type="button"
                  >
                    <span
                      className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg border ${
                        active || done
                          ? "border-[#d8c5df] bg-white"
                          : "border-[#ece7ed] bg-[#fdfcfd]"
                      }`}
                    >
                      {done ? <Check className="h-4 w-4" /> : <Icon className="h-4 w-4" />}
                    </span>
                    <span className="hidden truncate lg:block">{item.label}</span>
                  </button>
                );
              })}
            </nav>
            <div className="mt-8 hidden rounded-xl border border-[#e9e2eb] bg-white p-4 lg:block">
              <p className="text-xs font-semibold text-[#49225B]">Tu dirección</p>
              <p className="mt-2 break-all text-xs leading-5 text-[#8a7c8e]">
                infinityfood.com.ar/tienda/{store.slug}
              </p>
            </div>
          </aside>

          <div className="min-w-0 p-5 sm:p-8 lg:p-10">
            {!canEdit ? (
              <Notice text="Tu rol STAFF no permite modificar la configuración de la tienda." />
            ) : step === 0 ? (
              <IdentityStep
                busy={busy}
                draft={draft}
                error={error}
                onSubmit={saveCurrent}
                onUpdate={update}
                slug={store.slug}
              />
            ) : step === 1 ? (
              <AppearanceStep
                busy={busy}
                draft={draft}
                error={error}
                onBack={() => setStep(0)}
                onSubmit={saveCurrent}
                onUpdate={update}
                logoPreview={logoPreview || draft.logoUrl}
                bannerPreview={bannerPreview || draft.bannerUrl}
                onLogoChange={(file) => {
                  if (logoPreview) URL.revokeObjectURL(logoPreview);
                  setLogoFile(file);
                  setLogoPreview(file ? URL.createObjectURL(file) : "");
                  if (!file) update("logoUrl", "");
                }}
                onBannerChange={(file) => {
                  if (bannerPreview) URL.revokeObjectURL(bannerPreview);
                  setBannerFile(file);
                  setBannerPreview(file ? URL.createObjectURL(file) : "");
                  if (!file) update("bannerUrl", "");
                }}
                storeName={draft.name}
              />
            ) : (
              <ReadyStep dashboard={dashboard} emailVerified={session.user.emailVerified} slug={store.slug} />
            )}
          </div>
        </section>
      </div>
    </main>
  );
}

function IdentityStep({
  busy,
  draft,
  error,
  slug,
  onSubmit,
  onUpdate,
}: {
  busy: boolean;
  draft: Draft;
  error: string;
  slug: string;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onUpdate: <Key extends keyof Draft>(key: Key, value: Draft[Key]) => void;
}) {
  return (
    <form onSubmit={onSubmit}>
      <StepHeader
        description="Estos datos ayudan a que tus clientes reconozcan y contacten tu negocio."
        eyebrow="Identidad"
        title="Contanos lo básico de tu tienda"
      />
      <div className="mt-8 grid gap-5 sm:grid-cols-2">
        <Field label="Nombre de la tienda">
          <input required value={draft.name} onChange={(event) => onUpdate("name", event.target.value)} />
        </Field>
        <Field hint="La dirección no cambia después de crearla." label="Dirección permanente">
          <div className="flex min-h-12 items-center rounded-xl border border-[#e7e0e9] bg-[#f8f6f9] px-4 text-sm text-[#8b7d8f]">
            /tienda/{slug}
          </div>
        </Field>
        <Field className="sm:col-span-2" label="Descripción breve">
          <textarea
            className="min-h-28 resize-y"
            maxLength={240}
            placeholder="Qué vendés y qué hace especial a tu negocio"
            value={draft.description}
            onChange={(event) => onUpdate("description", event.target.value)}
          />
        </Field>
        <Field label="Email de contacto">
          <input
            type="email"
            value={draft.contactEmail}
            onChange={(event) => onUpdate("contactEmail", event.target.value)}
          />
        </Field>
        <Field label="WhatsApp">
          <input
            inputMode="tel"
            placeholder="Ej. 5491112345678"
            value={draft.whatsapp}
            onChange={(event) => onUpdate("whatsapp", event.target.value)}
          />
        </Field>
      </div>
      <FormFooter busy={busy} error={error} label="Guardar y continuar" />
    </form>
  );
}

function AppearanceStep({
  busy,
  draft,
  error,
  logoPreview,
  bannerPreview,
  storeName,
  onBack,
  onLogoChange,
  onBannerChange,
  onSubmit,
  onUpdate,
}: {
  busy: boolean;
  draft: Draft;
  error: string;
  logoPreview: string;
  bannerPreview: string;
  storeName: string;
  onBack: () => void;
  onLogoChange: (file: File | null) => void;
  onBannerChange: (file: File | null) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onUpdate: <Key extends keyof Draft>(key: Key, value: Draft[Key]) => void;
}) {
  return (
    <form onSubmit={onSubmit}>
      <StepHeader
        description="Elegí el color y, si querés, sumá ahora el logo y la portada de tu negocio."
        eyebrow="Apariencia"
        title="Dale una identidad visual"
      />
      <div className="mt-8 grid gap-8 xl:grid-cols-[1fr_18rem]">
        <div>
          <p className="text-sm font-medium text-[#3c303f]">Color principal</p>
          <div className="mt-3 flex flex-wrap gap-3">
            {palette.map((color) => (
              <button
                aria-label={`Elegir color ${color}`}
                className={`grid h-12 w-12 place-items-center rounded-xl border-2 transition ${
                  draft.primaryColor.toLowerCase() === color.toLowerCase()
                    ? "border-[#241a28]"
                    : "border-transparent hover:scale-105"
                }`}
                key={color}
                onClick={() => onUpdate("primaryColor", color)}
                style={{ backgroundColor: color }}
                type="button"
              >
                {draft.primaryColor.toLowerCase() === color.toLowerCase() && (
                  <Check className="h-5 w-5 text-white" />
                )}
              </button>
            ))}
            <label className="grid h-12 w-12 cursor-pointer place-items-center rounded-xl border border-[#ded5e1] bg-white text-[#6E3482]">
              <Palette className="h-5 w-5" />
              <input
                aria-label="Elegir otro color"
                className="sr-only"
                type="color"
                value={draft.primaryColor}
                onChange={(event) => onUpdate("primaryColor", event.target.value)}
              />
            </label>
          </div>
          <Field className="mt-7 max-w-xs" label="Moneda de la tienda">
            <select value={draft.currency} onChange={(event) => onUpdate("currency", event.target.value)}>
              <option value="ARS">ARS — Peso argentino</option>
              <option value="USD">USD — Dólar estadounidense</option>
            </select>
          </Field>
          <div className="mt-8 grid gap-4 sm:grid-cols-2">
            <StoreAssetPicker
              description="PNG, JPG, WEBP o AVIF · hasta 5 MB"
              id="onboarding-logo"
              label="Logo"
              onChange={onLogoChange}
              preview={logoPreview}
              ratio="square"
            />
            <StoreAssetPicker
              description="Recomendado 1600 × 600 px · hasta 5 MB"
              id="onboarding-banner"
              label="Portada"
              onChange={onBannerChange}
              preview={bannerPreview}
              ratio="wide"
            />
          </div>
        </div>
        <div
          className={`${styles.preview} overflow-hidden rounded-2xl border border-[#e5dee7] p-5`}
          style={{
            "--preview-color": draft.primaryColor,
            ...(bannerPreview
              ? {
                  backgroundImage: `linear-gradient(rgba(255,255,255,.82), rgba(255,255,255,.94)), url(${bannerPreview})`,
                  backgroundSize: "cover",
                  backgroundPosition: "center",
                }
              : {}),
          } as React.CSSProperties}
        >
          <div className="flex items-center justify-between">
            <span
              className="grid h-10 w-10 place-items-center rounded-xl bg-cover bg-center text-sm font-semibold text-white"
              style={logoPreview ? { backgroundImage: `url(${logoPreview})` } : { backgroundColor: draft.primaryColor }}
            >
              {!logoPreview && storeName.slice(0, 1).toUpperCase()}
            </span>
            <ShoppingBag className="h-4 w-4 text-[#887b8c]" />
          </div>
          <p className="mt-10 text-xs font-medium uppercase tracking-[0.16em] text-[#9a8d9d]">Vista previa</p>
          <p className="mt-2 truncate text-xl font-semibold tracking-tight text-[#2a202d]">{storeName}</p>
          <div className="mt-5 h-2 w-2/3 rounded-full bg-[#e9e3eb]" />
          <div className="mt-2 h-2 w-1/2 rounded-full bg-[#f0ecf1]" />
          <div className="mt-7 h-10 rounded-xl" style={{ backgroundColor: draft.primaryColor }} />
        </div>
      </div>
      <FormFooter busy={busy} error={error} label="Guardar apariencia" onBack={onBack} />
    </form>
  );
}

function ReadyStep({ dashboard, emailVerified, slug }: { dashboard: Dashboard; emailVerified: boolean; slug: string }) {
  const actions = [
    {
      done: emailVerified,
      href: "/admin?tab=account",
      icon: Mail,
      title: "Verificar el email",
      text: emailVerified ? "Tu cuenta ya está protegida." : "Necesario para cobros e invitaciones.",
    },
    {
      done: dashboard.metrics.categories > 0,
      href: "/admin?tab=categories",
      icon: Settings2,
      title: "Crear una categoría",
      text: "Ordená el catálogo para que sea fácil de explorar.",
    },
    {
      done: dashboard.metrics.products > 0,
      href: "/admin?tab=products",
      icon: PackagePlus,
      title: "Cargar el primer producto",
      text: "Agregá precio, stock e imágenes.",
    },
  ];
  return (
    <div>
      <StepHeader
        description="La base está lista. Podés completar estas tareas ahora o volver cuando quieras."
        eyebrow="Primeros pasos"
        title="Tu tienda ya tiene identidad"
      />
      <div className="mt-8 grid gap-3">
        {actions.map((action) => {
          const Icon = action.icon;
          return (
            <Link
              className="group flex items-center gap-4 rounded-2xl border border-[#e9e3eb] p-4 transition hover:border-[#cdb7d5] hover:bg-[#fbf8fc]"
              href={action.href}
              key={action.title}
            >
              <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl ${action.done ? "bg-[#edf7f2] text-[#39745d]" : "bg-[#f3edf5] text-[#6E3482]"}`}>
                {action.done ? <Check className="h-5 w-5" /> : <Icon className="h-5 w-5" />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-[#302433]">{action.title}</span>
                <span className="mt-1 block text-xs leading-5 text-[#8a7d8e]">{action.text}</span>
              </span>
              <ArrowRight className="h-4 w-4 text-[#a99ead] transition group-hover:translate-x-0.5 group-hover:text-[#6E3482]" />
            </Link>
          );
        })}
      </div>
      <div className="mt-8 flex flex-col gap-3 border-t border-[#eee9ef] pt-6 sm:flex-row sm:items-center sm:justify-between">
        <Link className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#49225B] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[#6E3482]" href="/admin">
          Ir al panel <ArrowRight className="h-4 w-4" />
        </Link>
        <Link className="inline-flex items-center justify-center gap-2 px-3 py-2 text-sm font-medium text-[#6E3482]" href={`/tienda/${slug}`} target="_blank">
          Ver tienda <ExternalLink className="h-4 w-4" />
        </Link>
      </div>
    </div>
  );
}

function StepHeader({ eyebrow, title, description }: { eyebrow: string; title: string; description: string }) {
  return (
    <header>
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#6E3482]">{eyebrow}</p>
      <h2 className="mt-2 text-2xl font-semibold tracking-[-0.025em] text-[#2b202e]">{title}</h2>
      <p className="mt-2 max-w-2xl text-sm leading-6 text-[#807384]">{description}</p>
    </header>
  );
}

function Field({ label, hint, className = "", children }: { label: string; hint?: string; className?: string; children: React.ReactNode }) {
  return (
    <label className={`block text-sm font-medium text-[#3c303f] ${className}`}>
      <span className="mb-2 block">{label}</span>
      <span className="[&_input]:w-full [&_input]:rounded-xl [&_input]:border [&_input]:border-[#ded6e1] [&_input]:bg-white [&_input]:px-4 [&_input]:py-3 [&_input]:text-sm [&_input]:outline-none [&_input]:transition [&_input]:focus:border-[#A56ABD] [&_input]:focus:ring-4 [&_input]:focus:ring-[#A56ABD]/10 [&_select]:w-full [&_select]:rounded-xl [&_select]:border [&_select]:border-[#ded6e1] [&_select]:bg-white [&_select]:px-4 [&_select]:py-3 [&_select]:text-sm [&_select]:outline-none [&_textarea]:w-full [&_textarea]:rounded-xl [&_textarea]:border [&_textarea]:border-[#ded6e1] [&_textarea]:bg-white [&_textarea]:px-4 [&_textarea]:py-3 [&_textarea]:text-sm [&_textarea]:outline-none [&_textarea]:transition [&_textarea]:focus:border-[#A56ABD] [&_textarea]:focus:ring-4 [&_textarea]:focus:ring-[#A56ABD]/10">
        {children}
      </span>
      {hint && <span className="mt-1.5 block text-xs font-normal text-[#9b8f9e]">{hint}</span>}
    </label>
  );
}

function FormFooter({ busy, error, label, onBack }: { busy: boolean; error: string; label: string; onBack?: () => void }) {
  return (
    <div className="mt-8 border-t border-[#eee9ef] pt-6">
      {error && <Notice text={error} tone="error" />}
      <div className="mt-4 flex items-center justify-between gap-3">
        {onBack ? (
          <button className="inline-flex items-center gap-2 px-2 py-3 text-sm font-medium text-[#756879]" onClick={onBack} type="button">
            <ArrowLeft className="h-4 w-4" /> Volver
          </button>
        ) : <span />}
        <button className="inline-flex items-center gap-2 rounded-xl bg-[#49225B] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[#6E3482] disabled:opacity-50" disabled={busy} type="submit">
          {busy ? "Guardando…" : label} {!busy && <ArrowRight className="h-4 w-4" />}
        </button>
      </div>
    </div>
  );
}

function Notice({ text, tone = "neutral" }: { text: string; tone?: "neutral" | "error" }) {
  return <p className={`rounded-xl px-4 py-3 text-sm ${tone === "error" ? "bg-red-50 text-red-700" : "bg-[#f4eff6] text-[#5f376d]"}`}>{text}</p>;
}
