"use client";

import { AlertCircle, Check, CheckCircle2, CreditCard, ExternalLink, Landmark, Mail, MessageCircle, Paintbrush, RefreshCw, Save, Store as StoreIcon } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { StoreAssetPicker } from "@/components/store-asset-picker";
import { ApiError, apiRequest } from "@/lib/api";
import { confirmAction } from "@/lib/confirm-action";
import { GuideLink } from "./guided-panel";
import type { Role, Store } from "./types";

type MercadoPagoIntegration = {
  configured: boolean;
  connection: { mercadoPagoUserId: string; liveMode: boolean; connectedAt: string; updatedAt: string } | null;
};
export type StoreSection = "identity" | "appearance" | "payments";
type Section = StoreSection;
type Draft = {
  name: string; description: string; contactEmail: string; emailFromName: string; whatsapp: string; currency: string;
  instagramUrl: string; facebookUrl: string; tiktokUrl: string; xUrl: string; youtubeUrl: string;
  logoUrl: string; bannerUrl: string; primaryColor: string; secondaryColor: string; fontFamily: string; borderRadius: string; announcement: string;
  bankTransferEnabled: boolean; bankName: string; bankAlias: string; bankHolder: string; bankCvu: string; bankCuit: string; bankReservationHours: string;
};
type UpdateDraft = <Key extends keyof Draft>(key: Key, value: Draft[Key]) => void;

const sections: Array<{ id: Section; label: string; description: string; icon: typeof StoreIcon }> = [
  { id: "identity", label: "Información", description: "Nombre, contacto y datos visibles", icon: StoreIcon },
  { id: "appearance", label: "Apariencia", description: "Logo, portada, colores y estilo", icon: Paintbrush },
  { id: "payments", label: "Cobros", description: "Mercado Pago y transferencias", icon: CreditCard },
];
const colors = ["#A56ABD", "#6E3482", "#49225B", "#315C72", "#2F6655"];

export function StoreView({ role, onOpenPlan, onStoreUpdated, onSectionChange, initialSection = "identity", mercadoPagoResult, mercadoPagoMessage }: { role: Role; onOpenPlan: () => void; onStoreUpdated: (name: string) => void; onSectionChange?: (section: StoreSection) => void; initialSection?: StoreSection; mercadoPagoResult?: string; mercadoPagoMessage?: string }) {
  const canManage = role !== "STAFF";
  const section = initialSection;
  const [store, setStore] = useState<Store | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [features, setFeatures] = useState<string[]>([]);
  const [mercadoPago, setMercadoPago] = useState<MercadoPagoIntegration | null>(null);
  const [error, setError] = useState(mercadoPagoResult === "error" ? (mercadoPagoMessage ?? "No se pudo conectar Mercado Pago") : "");
  const [errorDetails, setErrorDetails] = useState<Array<{ field: string; message: string }>>([]);
  const [success, setSuccess] = useState(mercadoPagoResult === "connected");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [saveStage, setSaveStage] = useState<"idle" | "uploading" | "saving">("idle");
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [bannerFile, setBannerFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState("");
  const [bannerPreview, setBannerPreview] = useState("");
  const canAdvanced = canManage && features.includes("ADVANCED_STORE_CUSTOMIZATION");

  function selectSection(next: Section) { setError(""); setSuccess(false); onSectionChange?.(next); }

  useEffect(() => {
    let active = true;
    void Promise.all([
      apiRequest<{ store: Store; features: string[] }>("/admin/store"),
      apiRequest<MercadoPagoIntegration>("/admin/integrations/mercadopago"),
    ]).then(([storeResponse, integration]) => {
      if (!active) return;
      setStore(storeResponse.store); setFeatures(storeResponse.features); setMercadoPago(integration); setDraft(createDraft(storeResponse.store));
      setError(mercadoPagoResult === "error" ? (mercadoPagoMessage ?? "No se pudo conectar Mercado Pago") : "");
    }).catch((caught) => {
      if (active) setError(caught instanceof ApiError ? caught.message : "No pudimos cargar la configuración de tu tienda.");
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [loadAttempt, mercadoPagoMessage, mercadoPagoResult]);

  function update<Key extends keyof Draft>(key: Key, value: Draft[Key]) {
    setDraft((current) => current ? { ...current, [key]: value } : current); setSuccess(false); setError(""); setErrorDetails([]);
  }
  function chooseLogo(file: File | null) {
    setError(""); setErrorDetails([]); if (logoPreview) URL.revokeObjectURL(logoPreview); setLogoFile(file); setLogoPreview(file ? URL.createObjectURL(file) : ""); if (!file) update("logoUrl", "");
  }
  function chooseBanner(file: File | null) {
    setError(""); setErrorDetails([]); if (bannerPreview) URL.revokeObjectURL(bannerPreview); setBannerFile(file); setBannerPreview(file ? URL.createObjectURL(file) : ""); if (!file) update("bannerUrl", "");
  }

  async function save() {
    if (!draft || !store || !canManage) return;
    setBusy(true); setError(""); setErrorDetails([]); setSuccess(false);
    try {
      let body: Record<string, string | number | boolean | null>;
      if (section === "identity") {
        body = {
          name: draft.name,
          description: draft.description || null,
          contactEmail: draft.contactEmail || null,
          emailFromName: draft.emailFromName || null,
          whatsapp: draft.whatsapp || null,
          instagramUrl: draft.instagramUrl || null,
          facebookUrl: draft.facebookUrl || null,
          tiktokUrl: draft.tiktokUrl || null,
          xUrl: draft.xUrl || null,
          youtubeUrl: draft.youtubeUrl || null,
          currency: draft.currency,
        };
      } else if (section === "appearance") {
        let logoUrl = draft.logoUrl || null; let bannerUrl = draft.bannerUrl || null;
        if (logoFile || bannerFile) {
          setSaveStage("uploading");
          const upload = new FormData(); if (logoFile) upload.append("logo", logoFile); if (bannerFile) upload.append("banner", bannerFile);
          const uploaded = await apiRequest<{ logoUrl?: string; bannerUrl?: string }>("/admin/uploads/store-assets", { method: "POST", body: upload });
          logoUrl = uploaded.logoUrl ?? logoUrl; bannerUrl = uploaded.bannerUrl ?? bannerUrl;
        }
        body = { logoUrl, bannerUrl, primaryColor: draft.primaryColor };
        if (canAdvanced) body = { ...body, secondaryColor: draft.secondaryColor, fontFamily: draft.fontFamily, borderRadius: draft.borderRadius, announcement: draft.announcement || null };
      } else {
        body = { bankTransferEnabled: draft.bankTransferEnabled, bankName: draft.bankName || null, bankAlias: draft.bankAlias || null, bankHolder: draft.bankHolder || null, bankCvu: draft.bankCvu || null, bankCuit: draft.bankCuit || null, bankReservationHours: Number(draft.bankReservationHours) };
      }
      setSaveStage("saving");
      const response = await apiRequest<{ store: Store; features: string[] }>("/admin/store", { method: "PATCH", body: JSON.stringify(body) });
      setStore(response.store); setDraft(createDraft(response.store)); setFeatures(response.features); onStoreUpdated(response.store.name);
      setLogoFile(null); setBannerFile(null); if (logoPreview) URL.revokeObjectURL(logoPreview); if (bannerPreview) URL.revokeObjectURL(bannerPreview); setLogoPreview(""); setBannerPreview(""); setSuccess(true);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "No se pudo guardar la configuración");
      setErrorDetails(caught instanceof ApiError ? caught.details : []);
    } finally { setBusy(false); setSaveStage("idle"); }
  }

  async function connectMercadoPago() {
    setBusy(true); setError("");
    try {
      const { authorizationUrl } = await apiRequest<{ authorizationUrl: string }>("/admin/integrations/mercadopago/authorize", { method: "POST" }); window.location.assign(authorizationUrl);
    } catch (caught) { setError(caught instanceof ApiError ? caught.message : "No se pudo iniciar la conexión"); setBusy(false); }
  }
  async function disconnectMercadoPago() {
    if (!(await confirmAction({ title: "¿Desconectar Mercado Pago?", description: "La tienda dejará de recibir pagos por este medio hasta que vuelvas a conectarlo.", confirmLabel: "Desconectar", tone: "danger" }))) return;
    setBusy(true); setError("");
    try { await apiRequest("/admin/integrations/mercadopago", { method: "DELETE" }); setMercadoPago(await apiRequest<MercadoPagoIntegration>("/admin/integrations/mercadopago")); }
    catch (caught) { setError(caught instanceof ApiError ? caught.message : "No se pudo desconectar Mercado Pago"); }
    finally { setBusy(false); }
  }

  if (loading) return <div aria-label="Cargando configuración" className="h-[36rem] animate-pulse rounded-[1.75rem] bg-[#eee9ef]" />;
  if (!store || !draft || !mercadoPago) return <div className="mx-auto max-w-2xl rounded-3xl border border-red-200 bg-white p-8 text-center shadow-sm" role="alert"><span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-red-50 text-red-700"><AlertCircle className="h-6 w-6" /></span><h2 className="mt-4 text-lg font-semibold text-[#382d3b]">No pudimos cargar la configuración</h2><p className="mt-2 text-sm leading-6 text-[#807384]">{error || "Ocurrió un inconveniente temporal. Tus datos siguen guardados."}</p><button className="mx-auto mt-5 inline-flex items-center gap-2 rounded-xl bg-[#49225B] px-5 py-3 text-sm font-semibold text-white" onClick={() => { setError(""); setLoading(true); setLoadAttempt((value) => value + 1); }} type="button"><RefreshCw className="h-4 w-4" /> Volver a intentar</button></div>;
  const displayedLogo = logoPreview || draft.logoUrl; const displayedBanner = bannerPreview || draft.bannerUrl;
  const configurationStatus: Array<{ id: Section; label: string; complete: boolean; detail: string; icon: typeof StoreIcon }> = [
    { id: "identity", label: "Información", complete: Boolean(draft.name && draft.description && draft.contactEmail), detail: "Nombre, descripción y contacto", icon: StoreIcon },
    { id: "appearance", label: "Identidad visual", complete: Boolean(displayedLogo && displayedBanner), detail: "Logo y portada de la tienda", icon: Paintbrush },
    { id: "payments", label: "Formas de cobro", complete: Boolean(mercadoPago.configured || draft.bankTransferEnabled), detail: "Mercado Pago o transferencia", icon: CreditCard },
  ];

  return (
    <div className="mx-auto max-w-7xl">
      <div className="mb-7 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div><p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#6E3482]">Mi tienda</p><h2 className="mt-2 text-2xl font-semibold tracking-[-0.025em] text-[#2b202e]">Configuración simple, paso a paso</h2><p className="mt-2 text-sm text-[#807384]">Cada campo incluye una explicación. Guardá una sección antes de pasar a otra.</p></div>
        <Link className="inline-flex items-center gap-2 text-sm font-semibold text-[#6E3482]" href={`/tienda/${store.slug}`} target="_blank">Ver cambios en la tienda <ExternalLink className="h-4 w-4" /></Link>
      </div>
      <section aria-label="Estado de la configuración" className="mb-6 grid gap-3 sm:grid-cols-3">
        {configurationStatus.map((item) => { const Icon = item.icon; return <button className="flex items-center gap-3 rounded-2xl border border-[#e6dfe8] bg-white p-4 text-left transition hover:border-[#cdb4d8] hover:bg-[#fdfafe]" key={item.id} onClick={() => selectSection(item.id)} type="button"><span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${item.complete ? "bg-emerald-50 text-emerald-700" : "bg-[#f5eff8] text-[#6E3482]"}`}>{item.complete ? <CheckCircle2 className="h-5 w-5" /> : <Icon className="h-5 w-5" />}</span><span className="min-w-0"><span className="flex items-center gap-2 text-sm font-semibold text-[#4b3a50]">{item.label}<span className={`text-[10px] ${item.complete ? "text-emerald-700" : "text-[#918495]"}`}>{item.complete ? "Completo" : "Por completar"}</span></span><span className="mt-1 block text-xs leading-5 text-[#807384]">{item.detail}</span></span></button>; })}
      </section>
      <div className="overflow-hidden rounded-[1.75rem] border border-[#e6dfe8] bg-white shadow-[0_24px_70px_rgba(52,31,59,.07)] lg:grid lg:grid-cols-[17rem_minmax(0,1fr)_19rem]">
        <aside className="border-b border-[#eee9ef] bg-[#fbfafc] p-4 lg:border-b-0 lg:border-r lg:p-5">
          <nav className="grid gap-2 sm:grid-cols-3 lg:grid-cols-1">
            {sections.map((item) => { const Icon = item.icon; const active = item.id === section; return (
              <button className={`flex items-center gap-3 rounded-xl p-3 text-left transition ${active ? "bg-[#f0e7f3] text-[#49225B]" : "text-[#7f7283] hover:bg-[#f7f3f8]"}`} key={item.id} onClick={() => selectSection(item.id)} type="button">
                <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg border ${active ? "border-[#d8c3df] bg-white" : "border-[#ebe5ed] bg-[#fdfcfd]"}`}><Icon className="h-4 w-4" /></span>
                <span className="hidden min-w-0 sm:block"><span className="block text-sm font-semibold">{item.label}</span><span className="mt-0.5 hidden text-[11px] font-normal leading-4 text-[#9a8e9d] lg:block">{item.description}</span></span>
              </button>); })}
          </nav>
          <div className="mt-6 hidden rounded-xl border border-[#e8e1ea] bg-white p-4 lg:block"><p className="text-xs font-semibold text-[#4b3a50]">Dirección permanente</p><p className="mt-2 break-all text-xs leading-5 text-[#918495]">/tienda/{store.slug}</p><p className="mt-2 text-[10px] leading-4 text-[#aaa0ac]">Identifica tu tienda y no se puede cambiar.</p></div>
        </aside>
        <section className="min-w-0 p-5 sm:p-7 lg:p-8">
          {section === "identity" && <IdentitySection draft={draft} onUpdate={update} />}
          {section === "appearance" && <AppearanceSection canAdvanced={canAdvanced} draft={draft} bannerPreview={displayedBanner} logoPreview={displayedLogo} onBannerChange={chooseBanner} onLogoChange={chooseLogo} onOpenPlan={onOpenPlan} onUpdate={update} />}
          {section === "payments" && <PaymentsSection busy={busy} canManage={canManage} draft={draft} mercadoPago={mercadoPago} onConnect={() => void connectMercadoPago()} onDisconnect={() => void disconnectMercadoPago()} onUpdate={update} />}
          {error && <div className="mt-6 rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700" role="alert"><p className="flex items-start gap-2 font-medium"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />{error}</p>{errorDetails.length > 1 && <ul className="mt-2 list-disc space-y-1 pl-10 text-xs">{errorDetails.slice(1).map((detail) => <li key={`${detail.field}-${detail.message}`}>{detail.message}</li>)}</ul>}<p className="mt-2 pl-6 text-xs text-red-600/80">Corregí el dato indicado y volvé a guardar. Lo que completaste no se perdió.</p></div>}
          {success && <p className="mt-6 flex items-center gap-2 rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-700"><CheckCircle2 className="h-4 w-4" /> Cambios guardados correctamente.</p>}
          {canManage && <div className="mt-8 flex justify-end border-t border-[#eee9ef] pt-6"><button className="inline-flex items-center gap-2 rounded-xl bg-[#49225B] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[#6E3482] disabled:opacity-50" disabled={busy} onClick={() => void save()} type="button"><Save className="h-4 w-4" /> {saveStage === "uploading" ? "Subiendo imágenes…" : saveStage === "saving" ? "Guardando cambios…" : `Guardar ${sections.find(({ id }) => id === section)?.label.toLowerCase()}`}</button></div>}
        </section>
        <StorePreview bannerUrl={displayedBanner} description={draft.description} logoUrl={displayedLogo} name={draft.name} primaryColor={draft.primaryColor} slug={store.slug} />
      </div>
    </div>
  );
}

function IdentitySection({ draft, onUpdate }: { draft: Draft; onUpdate: UpdateDraft }) {
  return <div><SectionHeader title="Información de la tienda" description="Datos que tus clientes verán en la tienda y en las comunicaciones." /><div className="mt-7 grid gap-5 sm:grid-cols-2">
    <Field label="Nombre de la tienda" help="Se muestra en la cabecera, los pedidos y los emails." example="Ejemplo: Fumiland Shop"><input required value={draft.name} onChange={(event) => onUpdate("name", event.target.value)} /></Field>
    <Field label="Moneda" help="Es la moneda usada para mostrar todos los precios." example="Para Argentina normalmente se utiliza ARS."><select value={draft.currency} onChange={(event) => onUpdate("currency", event.target.value)}><option value="ARS">ARS — Peso argentino</option><option value="USD">USD — Dólar estadounidense</option></select></Field>
    <Field className="sm:col-span-2" label="Descripción" help="Contá brevemente qué vendés. Aparece en la portada." example="Ejemplo: Accesorios seleccionados para disfrutar cada momento."><textarea className="min-h-28 resize-y" maxLength={2000} value={draft.description} onChange={(event) => onUpdate("description", event.target.value)} /></Field>
    <Field label="Email de contacto" help="Tus clientes pueden usarlo para consultas sobre compras." example="Ejemplo: ventas@mitienda.com"><span className="relative block"><Mail className="pointer-events-none absolute left-3.5 top-3.5 h-4 w-4 text-[#a093a3]" /><input className="pl-10!" type="email" value={draft.contactEmail} onChange={(event) => onUpdate("contactEmail", event.target.value)} /></span></Field>
    <Field label="WhatsApp" help="Usá código de país y área, sin espacios ni símbolos." example="Ejemplo: 5491112345678"><span className="relative block"><MessageCircle className="pointer-events-none absolute left-3.5 top-3.5 h-4 w-4 text-[#a093a3]" /><input className="pl-10!" inputMode="tel" value={draft.whatsapp} onChange={(event) => onUpdate("whatsapp", event.target.value)} /></span></Field>
    <Field className="sm:col-span-2" label="Nombre del remitente en emails" help="Es el nombre que verá el cliente cuando reciba confirmaciones. No es una dirección de correo." example="Ejemplo: Fumiland Shop, en lugar de InfinityFood"><input placeholder={draft.name || "Nombre de tu tienda"} value={draft.emailFromName} onChange={(event) => onUpdate("emailFromName", event.target.value)} /></Field>
    <div className="sm:col-span-2 mt-2 border-t border-[#eee9ef] pt-6"><h4 className="text-sm font-semibold text-[#382d3b]">Redes sociales</h4><p className="mt-1 text-xs leading-5 text-[#918495]">Pegá los enlaces completos. Solo las redes configuradas aparecerán en el pie de la tienda.</p></div>
    <Field label="Instagram (opcional)" help="Perfil público de la marca." example="https://instagram.com/mitienda"><input type="url" value={draft.instagramUrl} onChange={(event) => onUpdate("instagramUrl", event.target.value)} /></Field>
    <Field label="Facebook (opcional)" help="Página oficial del negocio." example="https://facebook.com/mitienda"><input type="url" value={draft.facebookUrl} onChange={(event) => onUpdate("facebookUrl", event.target.value)} /></Field>
    <Field label="TikTok (opcional)" help="Perfil público de TikTok." example="https://tiktok.com/@mitienda"><input type="url" value={draft.tiktokUrl} onChange={(event) => onUpdate("tiktokUrl", event.target.value)} /></Field>
    <Field label="X / Twitter (opcional)" help="Perfil público en X." example="https://x.com/mitienda"><input type="url" value={draft.xUrl} onChange={(event) => onUpdate("xUrl", event.target.value)} /></Field>
    <Field className="sm:col-span-2" label="YouTube (opcional)" help="Canal oficial de la tienda." example="https://youtube.com/@mitienda"><input type="url" value={draft.youtubeUrl} onChange={(event) => onUpdate("youtubeUrl", event.target.value)} /></Field>
  </div></div>;
}

function AppearanceSection({ canAdvanced, draft, logoPreview, bannerPreview, onLogoChange, onBannerChange, onOpenPlan, onUpdate }: { canAdvanced: boolean; draft: Draft; logoPreview: string; bannerPreview: string; onLogoChange: (file: File | null) => void; onBannerChange: (file: File | null) => void; onOpenPlan: () => void; onUpdate: UpdateDraft }) {
  return <div><SectionHeader title="Apariencia de la tienda" description="Subí tus imágenes y elegí una identidad coherente con tu marca." />
    <div className="mt-7 grid gap-5 sm:grid-cols-2"><StoreAssetPicker description="Ideal: imagen cuadrada, PNG o WEBP · hasta 5 MB" id="store-logo" label="Logo" onChange={onLogoChange} preview={logoPreview} ratio="square" /><StoreAssetPicker description="Ideal: 1600 × 600 px, JPG o WEBP · hasta 5 MB" id="store-banner" label="Portada" onChange={onBannerChange} preview={bannerPreview} ratio="wide" /></div>
    <div className="mt-8"><p className="text-sm font-medium text-[#3c303f]">Color principal</p><p className="mt-1 text-xs leading-5 text-[#918495]">Se usa en botones, enlaces y detalles destacados.</p><div className="mt-3 flex flex-wrap gap-3">{colors.map((color) => <button aria-label={`Elegir ${color}`} className={`grid h-11 w-11 place-items-center rounded-xl border-2 transition ${draft.primaryColor.toLowerCase() === color.toLowerCase() ? "border-[#241a28]" : "border-transparent hover:scale-105"}`} key={color} onClick={() => onUpdate("primaryColor", color)} style={{ backgroundColor: color }} type="button">{draft.primaryColor.toLowerCase() === color.toLowerCase() && <Check className="h-5 w-5 text-white" />}</button>)}<label className="grid h-11 w-11 cursor-pointer place-items-center rounded-xl border border-[#ded5e1] text-[#6E3482]"><Paintbrush className="h-4 w-4" /><input aria-label="Elegir otro color" className="sr-only" type="color" value={draft.primaryColor} onChange={(event) => onUpdate("primaryColor", event.target.value)} /></label></div></div>
    <div className="mt-8 rounded-2xl border border-[#e7ddec] bg-[#fbf8fc] p-5"><div className="flex items-center justify-between gap-4"><div><p className="text-sm font-semibold text-[#4a3550]">Personalización avanzada</p><p className="mt-1 text-xs leading-5 text-[#8f8093]">Color secundario, tipografía, bordes y anuncio superior.</p>{!canAdvanced && <p className="mt-2 text-xs text-[#8f8093]">Disponible con <GuideLink onClick={onOpenPlan}>Plan Pro</GuideLink>.</p>}</div>{!canAdvanced && <span className="rounded-full bg-[#eee4f1] px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-[#6E3482]">Plan Pro</span>}</div>
      <div className={`mt-5 grid gap-5 sm:grid-cols-2 ${!canAdvanced ? "opacity-45" : ""}`}>
        <Field label="Color secundario" help="Acompaña al principal en fondos y detalles." example="Elegí un tono con buen contraste."><input className="h-12! p-1!" disabled={!canAdvanced} type="color" value={draft.secondaryColor} onChange={(event) => onUpdate("secondaryColor", event.target.value)} /></Field>
        <Field label="Tipografía" help="Cambia el estilo general de los textos." example="Sistema es la opción más limpia y rápida."><select disabled={!canAdvanced} value={draft.fontFamily} onChange={(event) => onUpdate("fontFamily", event.target.value)}><option value="SYSTEM">Sistema</option><option value="SERIF">Editorial</option><option value="MODERN">Moderna</option></select></Field>
        <Field label="Estilo de bordes" help="Define qué tan redondeadas se ven tarjetas y botones." example="Suaves da una apariencia más amigable."><select disabled={!canAdvanced} value={draft.borderRadius} onChange={(event) => onUpdate("borderRadius", event.target.value)}><option value="SQUARE">Rectos</option><option value="MEDIUM">Medios</option><option value="SOFT">Suaves</option></select></Field>
        <Field label="Anuncio superior" help="Mensaje corto arriba del catálogo." example="Ejemplo: Envíos gratis desde $80.000"><input disabled={!canAdvanced} maxLength={180} value={draft.announcement} onChange={(event) => onUpdate("announcement", event.target.value)} /></Field>
      </div>
    </div>
  </div>;
}

function PaymentsSection({ busy, canManage, draft, mercadoPago, onConnect, onDisconnect, onUpdate }: { busy: boolean; canManage: boolean; draft: Draft; mercadoPago: MercadoPagoIntegration; onConnect: () => void; onDisconnect: () => void; onUpdate: UpdateDraft }) {
  return <div><SectionHeader title="Métodos de cobro" description="Activá solamente las opciones que quieras ofrecer en el checkout." />
    <div className="mt-7 rounded-2xl border border-[#e5dfe7] p-5"><div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-center"><div className="flex gap-3"><span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-[#e5f6fc] text-[#087da8]"><CreditCard className="h-5 w-5" /></span><div><p className="text-sm font-semibold text-[#302433]">Mercado Pago</p><p className="mt-1 max-w-md text-xs leading-5 text-[#8c7f90]">El comprador paga con Checkout Pro y el dinero ingresa directamente en la cuenta conectada de esta tienda.</p></div></div>{mercadoPago.connection ? <button className="shrink-0 rounded-xl border border-red-200 px-4 py-2.5 text-xs font-semibold text-red-700" disabled={busy || !canManage} onClick={onDisconnect} type="button">Desconectar</button> : <button className="shrink-0 rounded-xl bg-[#009ee3] px-4 py-2.5 text-xs font-bold text-white disabled:opacity-40" disabled={busy || !canManage || !mercadoPago.configured} onClick={onConnect} type="button">Conectar cuenta</button>}</div><div className="mt-4 border-t border-[#eee9ef] pt-4 text-xs">{mercadoPago.connection ? <p className="flex items-center gap-2 font-medium text-emerald-700"><CheckCircle2 className="h-4 w-4" /> Cuenta conectada · Usuario {mercadoPago.connection.mercadoPagoUserId} · {mercadoPago.connection.liveMode ? "Producción" : "Prueba"}</p> : <p className="text-[#918495]">Todavía no hay una cuenta conectada.</p>}</div></div>
    <div className="mt-5 rounded-2xl border border-[#e5dfe7] p-5"><div className="flex items-start gap-3"><span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-[#f1e9f4] text-[#6E3482]"><Landmark className="h-5 w-5" /></span><div className="flex-1"><p className="text-sm font-semibold text-[#302433]">Transferencia bancaria</p><p className="mt-1 text-xs leading-5 text-[#8c7f90]">El cliente verá estos datos al confirmar el pedido y podrá adjuntar el comprobante.</p></div><button aria-pressed={draft.bankTransferEnabled} className={`relative h-6 w-11 shrink-0 rounded-full transition ${draft.bankTransferEnabled ? "bg-[#6E3482]" : "bg-[#d8d0da]"}`} onClick={() => onUpdate("bankTransferEnabled", !draft.bankTransferEnabled)} type="button"><span className={`absolute top-1 h-4 w-4 rounded-full bg-white shadow-sm transition ${draft.bankTransferEnabled ? "left-6" : "left-1"}`} /></button></div>
      {draft.bankTransferEnabled && <div className="mt-6 grid gap-5 border-t border-[#eee9ef] pt-6 sm:grid-cols-2">
        <Field label="Banco" help="Entidad donde recibirás el dinero." example="Ejemplo: Banco Nación"><input value={draft.bankName} onChange={(event) => onUpdate("bankName", event.target.value)} /></Field>
        <Field label="Alias" help="El dato más sencillo para hacer la transferencia." example="Ejemplo: FUMILAND.PAGOS"><input required value={draft.bankAlias} onChange={(event) => onUpdate("bankAlias", event.target.value)} /></Field>
        <Field label="Titular" help="Propietario de la cuenta bancaria." example="Ejemplo: Juan Pérez"><input required value={draft.bankHolder} onChange={(event) => onUpdate("bankHolder", event.target.value)} /></Field>
        <Field label="CVU o CBU" help="Número completo de la cuenta; es opcional si usás alias." example="Ejemplo: 0000003100012345678901"><input inputMode="numeric" value={draft.bankCvu} onChange={(event) => onUpdate("bankCvu", event.target.value)} /></Field>
        <Field label="CUIT" help="Identificación fiscal del titular." example="Ejemplo: 20-12345678-9"><input value={draft.bankCuit} onChange={(event) => onUpdate("bankCuit", event.target.value)} /></Field>
        <Field label="Tiempo para pagar" help="Horas durante las que se reserva el stock." example="Recomendado: 24 horas"><input min="1" max="168" type="number" value={draft.bankReservationHours} onChange={(event) => onUpdate("bankReservationHours", event.target.value)} /></Field>
      </div>}
    </div>
  </div>;
}

function StorePreview({ name, slug, description, logoUrl, bannerUrl, primaryColor }: { name: string; slug: string; description: string; logoUrl: string; bannerUrl: string; primaryColor: string }) {
  return <aside className="border-t border-[#eee9ef] bg-[#fbfafc] p-5 lg:border-l lg:border-t-0"><div className="sticky top-24"><div className="mb-3 flex items-center justify-between"><p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#8e8192]">Vista previa</p><span className="h-2 w-2 rounded-full bg-emerald-500" /></div><div className="overflow-hidden rounded-2xl border border-[#dfd7e2] bg-white shadow-sm"><div className="h-28 bg-cover bg-center" style={bannerUrl ? { backgroundImage: `url(${bannerUrl})` } : { background: `linear-gradient(135deg, ${primaryColor}, #eee6f1)` }} /><div className="relative p-5 pt-10"><span className="absolute -top-7 grid h-14 w-14 place-items-center rounded-xl border-[3px] border-white bg-cover bg-center text-lg font-semibold text-white shadow-sm" style={logoUrl ? { backgroundImage: `url(${logoUrl})` } : { backgroundColor: primaryColor }}>{!logoUrl && name.slice(0, 1).toUpperCase()}</span><p className="truncate text-sm font-semibold text-[#2f2432]">{name || "Nombre de la tienda"}</p><p className="mt-1 truncate text-[10px] text-[#9b8f9e]">/{slug}</p><p className="mt-4 line-clamp-3 text-xs leading-5 text-[#7f7283]">{description || "La descripción de tu tienda aparecerá acá."}</p><div className="mt-5 h-9 rounded-lg" style={{ backgroundColor: primaryColor }} /></div></div><p className="mt-3 text-[11px] leading-5 text-[#9a8e9d]">La vista previa cambia mientras completás los campos. Guardá para publicarlos.</p></div></aside>;
}

function SectionHeader({ title, description }: { title: string; description: string }) { return <header><h3 className="text-xl font-semibold tracking-[-0.02em] text-[#2b202e]">{title}</h3><p className="mt-2 text-sm leading-6 text-[#817484]">{description}</p></header>; }
function Field({ label, help, example, className = "", children }: { label: string; help: string; example: string; className?: string; children: React.ReactNode }) {
  return <label className={`block ${className}`}><span className="mb-2 block text-sm font-medium text-[#3c303f]">{label}</span><span className="[&_input]:w-full [&_input]:rounded-xl [&_input]:border [&_input]:border-[#ded6e1] [&_input]:bg-white [&_input]:px-4 [&_input]:py-3 [&_input]:text-sm [&_input]:outline-none [&_input]:transition [&_input]:focus:border-[#A56ABD] [&_input]:focus:ring-4 [&_input]:focus:ring-[#A56ABD]/10 [&_input]:disabled:bg-[#f4f1f5] [&_select]:w-full [&_select]:rounded-xl [&_select]:border [&_select]:border-[#ded6e1] [&_select]:bg-white [&_select]:px-4 [&_select]:py-3 [&_select]:text-sm [&_select]:outline-none [&_textarea]:w-full [&_textarea]:rounded-xl [&_textarea]:border [&_textarea]:border-[#ded6e1] [&_textarea]:bg-white [&_textarea]:px-4 [&_textarea]:py-3 [&_textarea]:text-sm [&_textarea]:outline-none [&_textarea]:transition [&_textarea]:focus:border-[#A56ABD] [&_textarea]:focus:ring-4 [&_textarea]:focus:ring-[#A56ABD]/10">{children}</span><span className="mt-2 block text-xs leading-5 text-[#887b8c]">{help}</span><span className="mt-0.5 block text-[11px] leading-4 text-[#aaa0ac]">{example}</span></label>;
}
function createDraft(store: Store): Draft {
  const settings = store.settings;
  return { name: store.name, description: settings?.description ?? "", contactEmail: settings?.contactEmail ?? "", emailFromName: settings?.emailFromName ?? "", whatsapp: settings?.whatsapp ?? "", instagramUrl: settings?.instagramUrl ?? "", facebookUrl: settings?.facebookUrl ?? "", tiktokUrl: settings?.tiktokUrl ?? "", xUrl: settings?.xUrl ?? "", youtubeUrl: settings?.youtubeUrl ?? "", currency: settings?.currency ?? "ARS", logoUrl: settings?.logoUrl ?? "", bannerUrl: settings?.bannerUrl ?? "", primaryColor: settings?.primaryColor ?? "#6E3482", secondaryColor: settings?.secondaryColor ?? "#49225B", fontFamily: settings?.fontFamily ?? "SYSTEM", borderRadius: settings?.borderRadius ?? "MEDIUM", announcement: settings?.announcement ?? "", bankTransferEnabled: settings?.bankTransferEnabled ?? false, bankName: settings?.bankName ?? "", bankAlias: settings?.bankAlias ?? "", bankHolder: settings?.bankHolder ?? "", bankCvu: settings?.bankCvu ?? "", bankCuit: settings?.bankCuit ?? "", bankReservationHours: String(settings?.bankReservationHours ?? 24) };
}
