"use client";

import { BarChart3, ExternalLink, Globe, Layers, Mail, MapPin, ShoppingCart, Store, TicketPercent, Truck } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { ApiError, apiRequest } from "@/lib/api";
import type { Role } from "./types";
import { EmptyState, Field, GuideLink, Tip, panelStyles as styles } from "./guided-panel";

const sections = [
  { id: "analytics", label: "Resultados", description: "Entendé tus métricas", icon: BarChart3, help: "Revisá la actividad registrada en tu tienda y los productos más vendidos." },
  { id: "coupons", label: "Cupones", description: "Descuentos para tus clientes", icon: TicketPercent, help: "Creá un código que tus clientes puedan aplicar al comprar. Elegí cuánto descontar y sus condiciones." },
  { id: "variants", label: "Variantes", description: "Talles, colores y opciones", icon: Layers, help: "Agregá opciones a un producto, cada una con su propio código, precio y stock." },
  { id: "shipping", label: "Envíos", description: "Zonas, costos y plazos", icon: Truck, help: "Primero creá una zona de cobertura. Después agregale al menos un método con su costo y plazo." },
  { id: "domains", label: "Dominio", description: "Tu propia dirección web", icon: Globe, help: "Vinculá un dominio que ya sea tuyo. No se compra ni se registra desde este formulario." },
  { id: "notifications", label: "Emails automáticos", description: "Mensajes en cada etapa", icon: Mail, help: "Personalizá el asunto y el mensaje de los correos que acompañan a tus clientes." },
  { id: "carts", label: "Carritos", description: "Recuperá compras pendientes", icon: ShoppingCart, help: "Contactá a quienes dejaron productos en el carrito y todavía no terminaron su compra." },
] as const;

const notificationCopy: Record<string, { title: string; help: string; subject: string; message: string }> = {
  ORDER_CREATED: { title: "Pedido recibido", help: "Se envía cuando se crea un pedido. No significa que el pago esté aprobado.", subject: "Recibimos tu pedido", message: "¡Gracias por elegirnos! Ya recibimos tu compra." },
  ORDER_PAID: { title: "Pago aprobado", help: "Se envía al confirmar el pago de una compra.", subject: "Tu pago fue aprobado", message: "Ya confirmamos tu pago. Vamos a preparar tu pedido." },
  ORDER_SHIPPED: { title: "Pedido enviado", help: "Avisa al cliente cuando su pedido fue despachado.", subject: "Tu pedido está en camino", message: "Despachamos tu compra. Podés consultar el seguimiento de tu pedido." },
  ORDER_READY_FOR_PICKUP: { title: "Listo para retirar", help: "Avisa cuando un pedido ya puede buscarse en el local.", subject: "Tu pedido está listo para retirar", message: "Tu compra ya está preparada. Revisá la dirección, los horarios y las indicaciones antes de acercarte." },
  CART_ABANDONED: { title: "Recordatorio de carrito", help: "Es el mensaje usado para recuperar una compra pendiente.", subject: "Tus productos te están esperando", message: "Guardamos tu carrito para que puedas continuar tu compra." },
};

const carriers = [
  { code: "CORREO_ARGENTINO", name: "Correo Argentino", trackingUrlTemplate: "https://www.correoargentino.com.ar/seguimiento" },
  { code: "ANDREANI", name: "Andreani", trackingUrlTemplate: "https://www.andreani.com/" },
  { code: "OCA", name: "OCA", trackingUrlTemplate: "https://www.oca.com.ar/Seguimiento/Paquetes/" },
  { code: "VIA_CARGO", name: "Vía Cargo", trackingUrlTemplate: "https://viacargo.com.ar/" },
] as const;

type GrowthData = {
  features: string[];
  products: Array<{ id: string; name: string }>;
  domains: Array<{
    id: string;
    hostname: string;
    status: string;
    verificationToken: string;
    failureReason: string | null;
  }>;
  coupons: Array<{
    id: string;
    code: string;
    name: string;
    type: string;
    value: number;
    usedCount: number;
    active: boolean;
  }>;
  variants: Array<{
    id: string;
    sku: string;
    name: string;
    priceInCents: number;
    stock: number;
    product: { name: string };
  }>;
  shippingZones: Array<{
    id: string;
    name: string;
    postalPrefixes: string[];
    active: boolean;
    methods: Array<{
      id: string;
      name: string;
      priceInCents: number;
      estimatedDays: number | null;
      estimatedDaysMin: number | null;
      estimatedDaysMax: number | null;
      freeShippingThresholdInCents: number | null;
      carrierCode: string | null;
      carrierName: string | null;
      trackingUrlTemplate: string | null;
      active: boolean;
    }>;
  }>;
  deliveryPolicies?: { shippingPolicy: string | null; returnPolicy: string | null };
  pickupLocations?: Array<{
    id: string; name: string; address: string; city: string; province: string; postalCode: string | null;
    mapsUrl: string | null; phone: string | null; openingHours: string | null; instructions: string | null;
    preparationMinutes: number; active: boolean;
  }>;
  notificationRules: Array<{
    event: string;
    active: boolean;
    subject: string;
    message: string;
  }>;
  abandonedCarts: Array<{
    id: string;
    recoveryEmail: string | null;
    updatedAt: string;
    items: Array<{ quantity: number; product: { name: string } }>;
  }>;
  analytics: {
    periodDays: number;
    events: Record<string, number>;
    orders: number;
    revenueInCents: number;
    topProducts: Array<{
      productName: string;
      _sum: { quantity: number | null; subtotalInCents: number | null };
    }>;
  };
};

const money = (value: number) =>
  new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    maximumFractionDigits: 0,
  }).format(value / 100);

export function GrowthView({ onNavigate, role }: { onNavigate: (tab: "plan" | "products") => void; role: Role }) {
  const [data, setData] = useState<GrowthData | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [section, setSection] = useState<(typeof sections)[number]["id"]>("analytics");
  const [couponType, setCouponType] = useState("PERCENTAGE");
  const [shippingTestPostalCode, setShippingTestPostalCode] = useState("");
  const [busy, setBusy] = useState(false);
  const mutationLock = useRef(false);
  const canManage = role !== "STAFF";

  async function load() {
    setData(await apiRequest<GrowthData>("/admin/growth/overview"));
  }
  useEffect(() => {
    apiRequest<GrowthData>("/admin/growth/overview")
      .then(setData)
      .catch((caught) =>
        setError(
          caught instanceof ApiError
            ? caught.message
            : "No se pudo cargar la sección",
        ),
      );
  }, []);
  function handleError(caught: unknown) {
    setError(
      caught instanceof ApiError
        ? caught.message
        : "No se pudo completar la operación",
    );
  }
  async function mutate(path: string, options: RequestInit) {
    if (mutationLock.current) return false;
    mutationLock.current = true;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await apiRequest(path, options);
      try {
        await load();
        setMessage("Cambios guardados.");
      } catch {
        setMessage("Los cambios se guardaron, pero no pudimos actualizar la lista. Recargá el panel para verlos; no hace falta volver a enviarlos.");
      }
      return true;
    } catch (caught) {
      handleError(caught);
      return false;
    } finally {
      mutationLock.current = false;
      setBusy(false);
    }
  }

  if (!data)
    return (
      <div className={styles.card} role={error ? "alert" : "status"}>
        <p>{error || "Cargando herramientas de crecimiento…"}</p>
        {error && <button className={`${styles.button} mt-4`} onClick={() => { setError(""); void load().catch(handleError); }} type="button">Reintentar</button>}
      </div>
    );
  const pro = (feature: string) => data.features.includes(feature);
  const pickupLocations = data.pickupLocations ?? [];
  const shippingPreviewZones = selectShippingZones(data.shippingZones, shippingTestPostalCode);
  const suggestedOriginPostalCode = pickupLocations.find(({ active, postalCode }) => active && postalCode)?.postalCode ?? "";
  const hasAssistedShippingZones = data.shippingZones.some(({ name }) => name === "Entrega local" || name === "Resto del país");

  return (
    <div className={`${styles.surface} mx-auto max-w-7xl space-y-6`}>
      <header>
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#6E3482]">
          Crecimiento
        </p>
        <h2 className="mt-2 text-2xl font-semibold tracking-tight">
          Hacé crecer tu tienda, paso a paso
        </h2>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-stone-500">
          Elegí una herramienta. Te explicamos para qué sirve y cómo configurarla, con ejemplos en cada campo.
        </p>
      </header>
      {error && (
        <p role="alert" className="rounded-xl bg-red-50 p-4 text-sm text-red-700">{error}</p>
      )}
      {message && (
        <p role="status" className="rounded-xl bg-emerald-50 p-4 text-sm text-emerald-700">
          {message}
        </p>
      )}

      <div className={styles.shell}>
        <aside className={styles.navigation}>
          <nav aria-label="Herramientas de crecimiento" className={styles.navItems}>
            {sections.map((item) => <button key={item.id} type="button" className={styles.navButton} aria-current={section === item.id ? "true" : undefined} aria-controls={`growth-${item.id}`} onClick={() => { setSection(item.id); setMessage(""); setError(""); }}>
              <span className={styles.navIcon}><item.icon size={17} aria-hidden="true" /></span>
              <span><span className="block text-xs font-semibold sm:text-sm">{item.label}</span><span className="mt-1 hidden text-[11px] leading-4 text-[#9a8e9d] sm:block">{item.description}</span></span>
            </button>)}
          </nav>
          <div className="hidden xl:block"><Tip title="A tu ritmo">No necesitás configurar todo hoy. Cada formulario se guarda por separado; completá solo lo que necesite tu tienda.</Tip></div>
        </aside>
        <div className={styles.content}>
          {!canManage && <Tip title="Acceso de consulta">Podés ver estas herramientas. Para guardar cambios necesitás permisos de OWNER o ADMIN.</Tip>}
          <fieldset disabled={busy || !canManage} className="min-w-0" aria-busy={busy}>
      <section id="growth-analytics" hidden={section !== "analytics"}>
        <Title
          title={`Resultados de los últimos ${data.analytics.periodDays} días`}
        />
        <p className="mt-2 text-sm leading-6 text-[#807384]">{sections[0].help}</p>
        {!pro("ADVANCED_ANALYTICS") && <Tip title="Más detalle con Pro">El ranking de productos más vendidos está disponible en el plan Pro. Revisá las opciones en <GuideLink onClick={() => onNavigate("plan")}>Plan y uso</GuideLink>.</Tip>}
        <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Metric
            label="Visitas"
            help="Aperturas registradas de la tienda; una persona puede sumar varias."
            value={data.analytics.events.STOREFRONT_VIEW ?? 0}
          />
          <Metric
            label="Vistas de productos"
            help="Veces que se abrió el detalle de un producto."
            value={data.analytics.events.PRODUCT_VIEW ?? 0}
          />
          <Metric label="Pedidos" value={data.analytics.orders} help="Compras creadas en este período, aunque todavía no estén pagadas." />
          <Metric
            label="Ventas aprobadas"
            help="Importe de los pedidos con pago aprobado."
            value={money(data.analytics.revenueInCents)}
          />
        </div>
        {pro("ADVANCED_ANALYTICS") && (
          <div className="mt-4 rounded-2xl border border-stone-200 bg-white p-5">
            <p className="font-semibold">Productos con más ventas</p>
            <div className="mt-3 space-y-2 text-sm">
              {data.analytics.topProducts.length === 0 && <EmptyState title="Todavía no hay productos en el ranking">Cuando haya ventas registradas en este período, aparecerán acá.</EmptyState>}
              {data.analytics.topProducts.map((item) => (
                <div className="flex justify-between" key={item.productName}>
                  <span>{item.productName}</span>
                  <span>
                    {item._sum.quantity ?? 0} uds. ·{" "}
                    {money(item._sum.subtotalInCents ?? 0)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
        <Tip title="Un pedido no siempre es una venta cobrada">Por ejemplo: una compra de $17.000 pendiente de pago suma un pedido, pero no aumenta las ventas aprobadas hasta confirmar el pago.</Tip>
      </section>

      <section id="growth-coupons" hidden={section !== "coupons"}>
        <Title onOpenPlan={() => onNavigate("plan")} title="Cupones y promociones" pro={!pro("COUPONS_PROMOTIONS")} />
        <p className="mt-2 text-sm leading-6 text-[#807384]">{sections[1].help}</p>
        {pro("COUPONS_PROMOTIONS") && (
          <>
            <form
              className={styles.form}
              onSubmit={async (event) => {
                event.preventDefault();
                const element = event.currentTarget;
                const form = new FormData(element);
                const saved = await mutate("/admin/growth/coupons", {
                  method: "POST",
                  body: JSON.stringify({
                    code: form.get("code"),
                    name: form.get("name"),
                    type: form.get("type"),
                    value: form.get("type") === "FIXED" ? Math.round(Number(form.get("value")) * 100) : Number(form.get("value")),
                    minimumInCents: Math.round(Number(form.get("minimum")) * 100),
                    maximumUses: form.get("maximumUses")
                      ? Number(form.get("maximumUses"))
                      : null,
                    active: true,
                  }),
                });
                if (saved) { element.reset(); setCouponType("PERCENTAGE"); }
              }}
            >
              <Input name="code" label="Código del cupón" help="Es lo que escribe tu cliente al comprar." placeholder="VERANO20" />
              <Input name="name" label="Nombre de la promoción" help="Te ayuda a identificar esta campaña en el panel." placeholder="Promo verano" />
              <Field label="Tipo de descuento" help="Elegí entre un porcentaje o una suma fija en pesos." example="20% de descuento o $2.000 menos."><select name="type" value={couponType} onChange={(event) => setCouponType(event.target.value)}>
                <option value="PERCENTAGE">Porcentaje</option>
                <option value="FIXED">Monto fijo en pesos</option>
              </select></Field>
              <Input name="value" label={couponType === "FIXED" ? "Descuento en pesos" : "Porcentaje de descuento"} help={couponType === "FIXED" ? "Ingresá pesos, no centavos." : "Ingresá un valor entre 1 y 100."} placeholder={couponType === "FIXED" ? "2000" : "20"} type="number" min={couponType === "FIXED" ? 0.01 : 1} max={couponType === "PERCENTAGE" ? 100 : undefined} step={couponType === "FIXED" ? "0.01" : "1"} />
              <Input
                name="minimum"
                label="Compra mínima en pesos (opcional)" help="Es el subtotal necesario para usar el cupón. Vacío o 0: sin mínimo." placeholder="10000" required={false} step="0.01"
                type="number"
              />
              <Input name="maximumUses" label="Cantidad máxima de usos (opcional)" help="Límite total para esta promoción. Dejalo vacío para no limitar los usos." placeholder="50" type="number" min={1} required={false} />
              <div className={styles.footer}><Button disabled={!canManage}>Crear cupón</Button></div>
            </form>
            <Tip title="Ejemplo de promoción">VERANO20 con 20% de descuento y compra mínima de $10.000 permite descontar $2.000 sobre un subtotal de $10.000.</Tip>
            <Cards>
              {data.coupons.length === 0 && <EmptyState title="Todavía no creaste cupones">Completá el formulario para crear tu primera promoción.</EmptyState>}
              {data.coupons.map((coupon) => (
                <Card
                  key={coupon.id}
                  title={`${coupon.code} · ${coupon.name}`}
                  text={`${coupon.type === "PERCENTAGE" ? `${coupon.value}%` : money(coupon.value)} · ${coupon.usedCount} usos`}
                  onDelete={
                    canManage
                      ? () =>
                          void mutate(`/admin/growth/coupons/${coupon.id}`, {
                            method: "DELETE",
                          })
                      : undefined
                  }
                />
              ))}
            </Cards>
          </>
        )}
      </section>

      <section id="growth-variants" hidden={section !== "variants"}>
        <Title onOpenPlan={() => onNavigate("plan")} title="Variantes de productos" pro={!pro("PRODUCT_VARIANTS")} />
        <p className="mt-2 text-sm leading-6 text-[#807384]">{sections[2].help}</p>
        {pro("PRODUCT_VARIANTS") && (
          <>
            <form
              className={styles.form}
              onSubmit={async (event) => {
                event.preventDefault();
                const element = event.currentTarget;
                const form = new FormData(element);
                const saved = await mutate("/admin/growth/variants", {
                  method: "POST",
                  body: JSON.stringify({
                    productId: form.get("productId"),
                    sku: form.get("sku"),
                    name: form.get("name"),
                    options: { opción: form.get("name") },
                    priceInCents: Math.round(Number(form.get("price")) * 100),
                    stock: Number(form.get("stock")),
                    active: true,
                  }),
                });
                if (saved) element.reset();
              }}
            >
              <Field label="Producto" help="Elegí el producto al que pertenece esta opción." example="Ejemplo: Remera básica."><select name="productId" required>
                <option value="">Seleccioná un producto</option>
                {data.products.map((product) => (
                  <option key={product.id} value={product.id}>
                    {product.name}
                  </option>
                ))}
              </select></Field>
              <Input name="sku" label="Código interno (SKU)" help="Identificador único para distinguir esta variante en tu inventario." placeholder="REM-NEG-M" />
              <Input name="name" label="Nombre de la variante" help="La opción que verá el cliente al elegir el producto." placeholder="Negro / M" />
              <Input name="price" label="Precio en pesos" help="Precio completo de esta variante, no un recargo." placeholder="15000" type="number" step="0.01" />
              <Input name="stock" label="Unidades disponibles" help="Cantidad que tenés de esta opción. Usá 0 si no hay stock." placeholder="12" type="number" />
              <div className={styles.footer}><Button disabled={!canManage || !data.products.length}>Crear variante</Button></div>
            </form>
            {!data.products.length && <Tip title="Primero necesitás un producto">Crealo en <GuideLink onClick={() => onNavigate("products")}>Productos</GuideLink> y después agregale acá sus opciones de talle, color o presentación.</Tip>}
            <Cards>
              {data.variants.length === 0 && <EmptyState title="Sin variantes todavía">Ejemplo: para una remera podés crear Negro / M y Negro / L, cada una con su stock.</EmptyState>}
              {data.variants.map((variant) => (
                <Card
                  key={variant.id}
                  title={`${variant.product.name} · ${variant.name}`}
                  text={`${variant.sku} · ${money(variant.priceInCents)} · ${variant.stock} uds.`}
                  onDelete={
                    canManage
                      ? () =>
                          void mutate(`/admin/growth/variants/${variant.id}`, {
                            method: "DELETE",
                          })
                      : undefined
                  }
                />
              ))}
            </Cards>
          </>
        )}
      </section>

      <section id="growth-shipping" hidden={section !== "shipping"}>
        <Title title="Entregas y puntos de retiro" />
        <p className="mt-2 text-sm leading-6 text-[#807384]">{sections[3].help}</p>
        <div className="mt-6 rounded-2xl border border-[#ddcfe3] bg-[#fbf8fc] p-5">
          <div className="flex items-start gap-3"><span className="rounded-xl bg-white p-2.5 text-[#6E3482] shadow-sm"><Store size={18} /></span><div><h3 className="font-semibold">Retiro en local</h3><p className="mt-1 text-xs leading-5 text-[#807384]">Cargá cada sucursal una sola vez. La dirección y el enlace de Maps se mostrarán en el checkout y en el seguimiento.</p></div></div>
          <form className={`${styles.form} mt-5`} onSubmit={async (event) => {
            event.preventDefault();
            const element = event.currentTarget;
            const form = new FormData(element);
            const saved = await mutate("/admin/growth/pickup-locations", { method: "POST", body: JSON.stringify({
              name: form.get("pickupName"), address: form.get("pickupAddress"), city: form.get("pickupCity"), province: form.get("pickupProvince"),
              postalCode: form.get("pickupPostalCode") || null, mapsUrl: form.get("pickupMapsUrl") || null, phone: form.get("pickupPhone") || null,
              openingHours: form.get("pickupHours") || null, instructions: form.get("pickupInstructions") || null,
              preparationMinutes: Math.max(0, Math.round(Number(form.get("pickupPreparationHours") || 2) * 60)), active: true,
            }) });
            if (saved) element.reset();
          }}>
            <div className="grid gap-4 sm:grid-cols-2"><Input name="pickupName" label="Nombre del punto" placeholder="Local Palermo" /><Input name="pickupPhone" label="Teléfono (opcional)" placeholder="11 5555 5555" required={false} /></div>
            <Input name="pickupAddress" label="Dirección" placeholder="Av. Santa Fe 3200, local 4" />
            <div className="grid gap-4 sm:grid-cols-3"><Input name="pickupCity" label="Ciudad" placeholder="CABA" /><Input name="pickupProvince" label="Provincia" placeholder="Buenos Aires" /><Input name="pickupPostalCode" label="Código postal" placeholder="C1425" required={false} /></div>
            <Input name="pickupMapsUrl" label="Enlace de Google Maps (opcional)" help="Pegá el enlace para que el comprador pueda abrir la ubicación exacta." placeholder="https://maps.google.com/..." type="url" required={false} />
            <div className="grid gap-4 sm:grid-cols-2"><Input name="pickupHours" label="Horarios (opcional)" placeholder="Lun a vie de 9 a 18 h" required={false} /><Input name="pickupPreparationHours" label="Preparación estimada (horas)" placeholder="2" type="number" min={0} required={false} /></div>
            <Input name="pickupInstructions" label="Indicaciones (opcional)" placeholder="Presentate en recepción con el número de pedido." required={false} />
            <div className={styles.footer}><Button disabled={!canManage}>Agregar punto de retiro</Button></div>
          </form>
          <div className="mt-5 grid gap-3">
            {pickupLocations.length === 0 && <EmptyState title="Todavía no hay puntos de retiro">Agregá tu local para ofrecer retiro gratuito en el checkout.</EmptyState>}
            {pickupLocations.map((location) => <article className="rounded-xl border border-[#e6dfe8] bg-white p-4" key={location.id}>
              <div className="flex items-start justify-between gap-4"><div><div className="flex flex-wrap items-center gap-2"><MapPin size={15} className="text-[#6E3482]" /><p className="font-semibold">{location.name}</p><span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${location.active ? "bg-emerald-50 text-emerald-700" : "bg-stone-100 text-stone-500"}`}>{location.active ? "Activo" : "Pausado"}</span></div><p className="mt-2 text-xs text-[#807384]">{location.address}, {location.city}, {location.province}</p>{location.openingHours && <p className="mt-1 text-xs text-[#918495]">{location.openingHours}</p>}</div><div className="flex shrink-0 gap-3">{location.mapsUrl && <a className="text-[#6E3482]" href={location.mapsUrl} target="_blank" rel="noreferrer" aria-label={`Abrir ${location.name} en Maps`}><ExternalLink size={16} /></a>}{canManage && <><button className="text-xs font-semibold text-[#6E3482]" type="button" onClick={() => void mutate(`/admin/growth/pickup-locations/${location.id}`, { method: "PATCH", body: JSON.stringify({ active: !location.active }) })}>{location.active ? "Pausar" : "Activar"}</button><button className="text-xs font-semibold text-red-600" type="button" onClick={() => void mutate(`/admin/growth/pickup-locations/${location.id}`, { method: "DELETE" })}>Eliminar</button></>}</div></div>
              {canManage && <details className="mt-4 border-t border-[#eee8f0] pt-3">
                <summary className="cursor-pointer text-xs font-semibold text-[#6E3482]">Editar datos y ubicación</summary>
                <form className={`${styles.form} mt-4`} onSubmit={async (event) => {
                  event.preventDefault();
                  const form = new FormData(event.currentTarget);
                  await mutate(`/admin/growth/pickup-locations/${location.id}`, { method: "PATCH", body: JSON.stringify({
                    name: form.get("editPickupName"), address: form.get("editPickupAddress"), city: form.get("editPickupCity"), province: form.get("editPickupProvince"),
                    postalCode: form.get("editPickupPostalCode") || null, mapsUrl: form.get("editPickupMapsUrl") || null, phone: form.get("editPickupPhone") || null,
                    openingHours: form.get("editPickupHours") || null, instructions: form.get("editPickupInstructions") || null,
                    preparationMinutes: Math.max(0, Math.round(Number(form.get("editPickupPreparationHours") || 0) * 60)),
                  }) });
                }}>
                  <div className="grid gap-4 sm:grid-cols-2"><Input name="editPickupName" label="Nombre del punto" placeholder="Local Palermo" defaultValue={location.name} /><Input name="editPickupPhone" label="Teléfono (opcional)" placeholder="11 5555 5555" defaultValue={location.phone ?? undefined} required={false} /></div>
                  <Input name="editPickupAddress" label="Dirección" placeholder="Av. Santa Fe 3200, local 4" defaultValue={location.address} />
                  <div className="grid gap-4 sm:grid-cols-3"><Input name="editPickupCity" label="Ciudad" placeholder="CABA" defaultValue={location.city} /><Input name="editPickupProvince" label="Provincia" placeholder="Buenos Aires" defaultValue={location.province} /><Input name="editPickupPostalCode" label="Código postal" placeholder="C1425" defaultValue={location.postalCode ?? undefined} required={false} /></div>
                  <Input name="editPickupMapsUrl" label="Enlace de Google Maps (opcional)" help="Se reutiliza en el checkout, la confirmación y el seguimiento del pedido." placeholder="https://maps.app.goo.gl/..." type="url" defaultValue={location.mapsUrl ?? undefined} required={false} />
                  <div className="grid gap-4 sm:grid-cols-2"><Input name="editPickupHours" label="Horarios (opcional)" placeholder="Lun a vie de 9 a 18 h" defaultValue={location.openingHours ?? undefined} required={false} /><Input name="editPickupPreparationHours" label="Preparación estimada (horas)" placeholder="2" type="number" min={0} step="0.5" defaultValue={String(location.preparationMinutes / 60)} required={false} /></div>
                  <Input name="editPickupInstructions" label="Indicaciones (opcional)" placeholder="Presentate en recepción con el número de pedido." defaultValue={location.instructions ?? undefined} required={false} />
                  <div className={styles.footer}><Button>Guardar punto de retiro</Button></div>
                </form>
              </details>}
            </article>)}
          </div>
        </div>
        <div className="mt-8"><h3 className="font-semibold">Envíos a domicilio</h3><p className="mt-1 text-xs leading-5 text-[#807384]">Configurá zonas por código postal y las alternativas disponibles para cada una.</p></div>
        <div className="mt-5 rounded-2xl border border-sky-200 bg-sky-50 p-5 text-sm text-sky-950">
          <h4 className="font-semibold">Cómo se calcula el envío</h4>
          <ol className="mt-3 grid gap-3 leading-6 sm:grid-cols-2">
            <li><strong>1. Creá una zona.</strong> Agrupá destinos con costo y plazo parecidos, por ejemplo “La Rioja capital” o “Resto del país”.</li>
            <li><strong>2. Indicá sus códigos postales.</strong> Un prefijo como <strong>53</strong> cubre todos los códigos que empiezan con 53; <strong>5300</strong> es más específico.</li>
            <li><strong>3. Calculá el precio final.</strong> Consultá la tarifa del transportista y, si corresponde, sumá embalaje y un margen operativo fijo.</li>
            <li><strong>4. InfinityFood elige la mejor coincidencia.</strong> El checkout usa la zona más específica para el código postal del comprador.</li>
          </ol>
          <p className="mt-3 rounded-xl bg-white/80 p-3 text-xs leading-5"><strong>Importante:</strong> una zona sin códigos postales funciona como respaldo para “Resto del país”. Solo se usa cuando no existe una zona más específica. La tarifa es manual y fija para cada zona: InfinityFood no consulta todavía precios en vivo. Revisala periódicamente y creá zonas diferentes cuando el costo cambie según la distancia.</p>
        </div>
        <div className="mt-5 rounded-2xl border border-[#ddcfe3] bg-[#fbf8fc] p-5">
          <div className="flex items-start gap-3"><span className="rounded-xl bg-white p-2.5 text-[#6E3482] shadow-sm"><Truck size={18} /></span><div><h4 className="font-semibold">Configuración rápida recomendada</h4><p className="mt-1 text-xs leading-5 text-[#807384]">Tomamos el código postal del local cuando está disponible y preparamos una tarifa local más otra para el resto del país.</p></div></div>
          {hasAssistedShippingZones ? <p className="mt-4 rounded-xl bg-emerald-50 p-4 text-sm text-emerald-800">El asistente ya creó “Entrega local” o “Resto del país”. Revisá esas zonas debajo y tocá <strong>Publicar</strong> cuando estén listas.</p> : <form className={`${styles.form} mt-5`} onSubmit={async (event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            await mutate("/admin/growth/shipping-setup/assisted", { method: "POST", body: JSON.stringify({
              originPostalCode: form.get("setupOriginPostalCode"),
              localPriceInCents: Math.round(Number(form.get("setupLocalPrice")) * 100),
              nationwidePriceInCents: Math.round(Number(form.get("setupNationwidePrice")) * 100),
              localDaysMin: Number(form.get("setupLocalDaysMin")),
              localDaysMax: Number(form.get("setupLocalDaysMax")),
              nationwideDaysMin: Number(form.get("setupNationwideDaysMin")),
              nationwideDaysMax: Number(form.get("setupNationwideDaysMax")),
            }) });
          }}>
            <div className="sm:col-span-2"><Input name="setupOriginPostalCode" label="Código postal desde donde despachás" help={suggestedOriginPostalCode ? "Lo obtuvimos de tu punto de retiro. Podés corregirlo para este cálculo." : "No encontramos un código postal en tus puntos de retiro. Ingresalo manualmente."} placeholder="5300 o F5300ABC" defaultValue={suggestedOriginPostalCode} /></div>
            <div className="grid gap-4 sm:col-span-2 sm:grid-cols-3"><Input name="setupLocalPrice" label="Precio final de envío local" help="Tarifa del transportista más embalaje o margen, si decidís incluirlos." placeholder="3500" type="number" step="0.01" /><Input name="setupLocalDaysMin" label="Plazo local mínimo" placeholder="1" type="number" min={1} defaultValue="1" /><Input name="setupLocalDaysMax" label="Plazo local máximo" placeholder="3" type="number" min={1} defaultValue="3" /></div>
            <div className="grid gap-4 sm:col-span-2 sm:grid-cols-3"><Input name="setupNationwidePrice" label="Precio final para el resto del país" help="Usá una tarifa promedio de respaldo. Después podés dividirla en más zonas." placeholder="12000" type="number" step="0.01" /><Input name="setupNationwideDaysMin" label="Plazo nacional mínimo" placeholder="4" type="number" min={1} defaultValue="4" /><Input name="setupNationwideDaysMax" label="Plazo nacional máximo" placeholder="10" type="number" min={1} defaultValue="10" /></div>
            <label className="sm:col-span-2 flex cursor-pointer items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs leading-5 text-amber-950"><input className="mt-0.5 h-4 w-4 accent-[#6E3482]" required type="checkbox" /><span>Confirmo que revisé estas tarifas y plazos. Se crearán como <strong>borradores no publicados</strong> para poder revisar transportistas y seguimiento antes de activarlos.</span></label>
            <div className={styles.footer}><Button disabled={!canManage}>Crear zonas como borrador</Button></div>
          </form>}
        </div>
        <form className={`${styles.form} mt-5`} onSubmit={async (event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          await mutate("/admin/growth/delivery-policies", { method: "PATCH", body: JSON.stringify({
            shippingPolicy: form.get("shippingPolicy") || null,
            returnPolicy: form.get("returnPolicy") || null,
          }) });
        }}>
          <p className="sm:col-span-2 rounded-xl bg-stone-50 p-3 text-xs leading-5 text-[#807384]"><strong className="text-[#382d3b]">Estas políticas son textos informativos:</strong> se muestran antes del pago y se copian al pedido para conservar las condiciones aceptadas. No modifican el precio ni calculan el envío.</p>
          <Field label="Política de entrega (opcional)" help="Se muestra antes de pagar y queda guardada en cada pedido." example="Ejemplo: Entregamos de lunes a viernes. Se realizan hasta dos visitas."><textarea defaultValue={data.deliveryPolicies?.shippingPolicy ?? ""} name="shippingPolicy" maxLength={3000} placeholder="Días de entrega, intentos de visita y condiciones del servicio." /></Field>
          <Field label="Política de cambios y devoluciones (opcional)" help="Ayuda a reducir dudas y genera confianza antes del pago." example="Ejemplo: Podés solicitar un cambio dentro de los 10 días de recibir tu compra."><textarea defaultValue={data.deliveryPolicies?.returnPolicy ?? ""} name="returnPolicy" maxLength={3000} placeholder="Plazos, condiciones y canal para solicitar un cambio o devolución." /></Field>
          <div className={styles.footer}><Button disabled={!canManage}>Guardar políticas</Button></div>
        </form>
        <form
          className={styles.form}
          onSubmit={async (event) => {
            event.preventDefault();
            const element = event.currentTarget;
            const form = new FormData(element);
            const saved = await mutate("/admin/growth/shipping-zones", {
              method: "POST",
              body: JSON.stringify({
                name: form.get("name"),
                postalPrefixes: String(form.get("prefixes") ?? "")
                  .split(",")
                  .map((value) => value.trim())
                  .filter(Boolean),
                active: true,
              }),
            });
            if (saved) element.reset();
          }}
        >
          <Input name="name" label="1. Nombre interno de la zona" help="Usá un nombre que te permita reconocer el alcance, por ejemplo Entrega local, Zona cercana o Resto del país." placeholder="La Rioja capital" />
          <Input name="prefixes" label="2. Códigos postales o prefijos cubiertos" help="Separalos con comas. 5300 cubre códigos que empiezan con 5300; 53 abarca una región más amplia. Dejalo vacío únicamente para crear el respaldo Resto del país." placeholder="5300, 5301, 5302" required={false} />
          <div className={styles.footer}><Button disabled={!canManage}>Crear zona</Button></div>
        </form>
        <Tip title="3. Agregá una forma de entrega">Crear una zona no alcanza: agregale abajo un método como Correo estándar o Moto mensajería, con la tarifa y el plazo que correspondan a esa zona.</Tip>
        <div className="mt-5 rounded-2xl border border-[#ddcfe3] bg-[#fbf8fc] p-5">
          <h4 className="font-semibold">Probá un código postal</h4>
          <p className="mt-1 text-xs leading-5 text-[#807384]">Ingresá un CP como lo haría un comprador. Verás exactamente qué zona, precios y plazos aparecerán en el checkout.</p>
          <div className="mt-4 max-w-sm"><Input name="shippingTestPostalCode" label="Código postal de prueba" placeholder="5300 o F5300ABC" value={shippingTestPostalCode} onChange={setShippingTestPostalCode} required={false} /></div>
          {shippingTestPostalCode.trim() && shippingPreviewZones.length === 0 && <p className="mt-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">No hay una zona activa que cubra este código postal. Creá una zona específica o una zona sin prefijos para “Resto del país”.</p>}
          {shippingTestPostalCode.trim() && shippingPreviewZones.length > 0 && <div className="mt-3 grid gap-3">{shippingPreviewZones.map((zone) => <div className="rounded-xl border border-[#e6dfe8] bg-white p-4" key={zone.id}><p className="text-sm font-semibold">Zona aplicada: {zone.name}</p>{zone.methods.filter(({ active }) => active).length ? <div className="mt-2 grid gap-1">{zone.methods.filter(({ active }) => active).map((method) => <p className="text-xs text-[#807384]" key={method.id}>{method.name}: <strong>{money(method.priceInCents)}</strong> · {formatDeliveryRange(method.estimatedDaysMin ?? method.estimatedDays, method.estimatedDaysMax ?? method.estimatedDays)}</p>)}</div> : <p className="mt-2 text-xs text-amber-700">La zona coincide, pero no tiene métodos activos.</p>}</div>)}</div>}
        </div>
        <div className="mt-5 grid gap-4">
          {data.shippingZones.length === 0 && <EmptyState title="Todavía no hay zonas">Creá una zona y después agregá sus métodos de entrega.</EmptyState>}
          {data.shippingZones.map((zone) => (
            <article
              className="rounded-2xl border border-stone-200 bg-white p-5"
              key={zone.id}
            >
              <div className="flex flex-wrap justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2"><p className="font-semibold">{zone.name}</p><span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${zone.active ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>{zone.active ? "Publicada" : "No publicada"}</span></div>
                  <p className="text-xs text-stone-400">
                    {zone.postalPrefixes.join(", ") || "Todo el país"}
                  </p>
                </div>
                {canManage && (
                  <div className="flex gap-3"><button className="text-xs font-semibold text-[#6E3482]" type="button" onClick={() => void mutate(`/admin/growth/shipping-zones/${zone.id}`, { method: "PATCH", body: JSON.stringify({ active: !zone.active }) })}>{zone.active ? "Pausar" : "Publicar"}</button><button className="text-xs font-semibold text-red-600" type="button" onClick={() => void mutate(`/admin/growth/shipping-zones/${zone.id}`, { method: "DELETE" })}>Eliminar</button></div>
                )}
              </div>
              {canManage && <details className="mt-4 border-t border-stone-100 pt-3"><summary className="cursor-pointer text-xs font-semibold text-[#6E3482]">Editar zona</summary><form className={`${styles.form} mt-3`} onSubmit={async (event) => { event.preventDefault(); const form = new FormData(event.currentTarget); await mutate(`/admin/growth/shipping-zones/${zone.id}`, { method: "PATCH", body: JSON.stringify({ name: form.get("zoneName"), postalPrefixes: String(form.get("zonePrefixes") ?? "").split(",").map((value) => value.trim()).filter(Boolean) }) }); }}><Input name="zoneName" label="Nombre interno" placeholder="La Rioja capital" defaultValue={zone.name} /><Input name="zonePrefixes" label="Códigos postales o prefijos" help="Separalos con comas. Vacío significa Resto del país." placeholder="5300, 5301" defaultValue={zone.postalPrefixes.join(", ")} required={false} /><div className={styles.footer}><Button>Guardar zona</Button></div></form></details>}
              <div className="mt-4 grid gap-3">
                {zone.methods.map((method) => (
                  <article className="rounded-xl border border-stone-100 bg-stone-50 p-4" key={method.id}>
                    <div className="flex flex-wrap items-start justify-between gap-3"><div><div className="flex flex-wrap items-center gap-2"><p className="text-sm font-semibold">{method.name}</p><span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${method.active ? "bg-emerald-50 text-emerald-700" : "bg-white text-stone-500"}`}>{method.active ? "Activo" : "Pausado"}</span></div><p className="mt-1 text-xs text-[#807384]">Precio final: <strong>{money(method.priceInCents)}</strong> · {formatDeliveryRange(method.estimatedDaysMin ?? method.estimatedDays, method.estimatedDaysMax ?? method.estimatedDays)}{method.freeShippingThresholdInCents ? ` · Gratis desde ${money(method.freeShippingThresholdInCents)}` : ""}</p>{method.carrierName && <p className="mt-1 text-xs text-[#918495]">Transportista: {method.carrierName}</p>}</div>{canManage && <div className="flex gap-3"><button className="text-xs font-semibold text-[#6E3482]" type="button" onClick={() => void mutate(`/admin/growth/shipping-methods/${method.id}`, { method: "PATCH", body: JSON.stringify({ active: !method.active }) })}>{method.active ? "Pausar" : "Activar"}</button><button className="text-xs font-semibold text-red-600" type="button" onClick={() => void mutate(`/admin/growth/shipping-methods/${method.id}`, { method: "DELETE" })}>Eliminar</button></div>}</div>
                    {canManage && <details className="mt-3 border-t border-stone-200 pt-3"><summary className="cursor-pointer text-xs font-semibold text-[#6E3482]">Editar método</summary><ShippingMethodForm buttonLabel="Guardar método" defaults={method} onSubmit={(payload) => mutate(`/admin/growth/shipping-methods/${method.id}`, { method: "PATCH", body: JSON.stringify(payload) })} /></details>}
                  </article>
                ))}
              </div>
              <details className="mt-5"><summary className="cursor-pointer text-sm font-semibold text-[#6E3482]">+ Agregar método de envío</summary><ShippingMethodForm buttonLabel="Agregar método" disabled={!canManage} onSubmit={(payload) => mutate(`/admin/growth/shipping-zones/${zone.id}/methods`, { method: "POST", body: JSON.stringify({ ...payload, active: true }) })} /></details>
            </article>
          ))}
        </div>
      </section>

      <section id="growth-domains" hidden={section !== "domains"}>
        <Title onOpenPlan={() => onNavigate("plan")} title="Dominios personalizados" pro={!pro("CUSTOM_DOMAIN")} />
        <p className="mt-2 text-sm leading-6 text-[#807384]">{sections[4].help}</p>
        {pro("CUSTOM_DOMAIN") && (
          <>
            <form
              className={styles.form}
              onSubmit={async (event) => {
                event.preventDefault();
                const element = event.currentTarget;
                const form = new FormData(element);
                const saved = await mutate("/admin/growth/domains", {
                  method: "POST",
                  body: JSON.stringify({ hostname: form.get("hostname") }),
                });
                if (saved) element.reset();
              }}
            >
              <Input name="hostname" label="Tu dominio" help="Ingresá solo el dominio, sin https:// ni rutas al final." placeholder="tienda.mimarca.com.ar" />
              <div className={styles.footer}><Button disabled={!canManage}>Agregar dominio</Button></div>
            </form>
            <Tip title="Después de agregarlo">Creá en tu proveedor DNS el registro TXT que aparece debajo, copiando exactamente su nombre y valor. Luego tocá Verificar DNS. Esto comprueba la propiedad; no reemplaza la configuración de dirección web y HTTPS.</Tip>
            <Cards>
              {data.domains.length === 0 && <EmptyState title="Todavía no vinculaste un dominio">Tu dirección habitual de InfinityFood sigue funcionando.</EmptyState>}
              {data.domains.map((domain) => (
                <Card
                  key={domain.id}
                  title={`${domain.hostname} · ${{ VERIFIED: "Verificado", PENDING: "Pendiente", FAILED: "No verificado" }[domain.status] ?? "En revisión"}`}
                  text={`TXT _infinityshop.${domain.hostname} = ${domain.verificationToken}${domain.failureReason ? ` · ${domain.failureReason}` : ""}`}
                  action={
                    canManage && domain.status !== "VERIFIED" ? (
                      <button
                        className="text-xs font-semibold text-[#6E3482]"
                        onClick={() =>
                          void mutate(
                            `/admin/growth/domains/${domain.id}/verify`,
                            { method: "POST" },
                          )
                        }
                      >
                        Verificar DNS
                      </button>
                    ) : undefined
                  }
                  onDelete={
                    canManage
                      ? () =>
                          void mutate(`/admin/growth/domains/${domain.id}`, {
                            method: "DELETE",
                          })
                      : undefined
                  }
                />
              ))}
            </Cards>
          </>
        )}
      </section>

      <section id="growth-notifications" hidden={section !== "notifications"}>
        <Title onOpenPlan={() => onNavigate("plan")} title="Notificaciones automáticas" pro={!pro("AUTOMATIONS")} />
        <p className="mt-2 text-sm leading-6 text-[#807384]">{sections[5].help}</p>
        {pro("AUTOMATIONS") && (
          <div className="mt-6 grid gap-5">
            {[
              "ORDER_CREATED",
              "ORDER_PAID",
              "ORDER_SHIPPED",
              "ORDER_READY_FOR_PICKUP",
              "CART_ABANDONED",
            ].map((eventName) => {
              const rule = data.notificationRules.find(
                ({ event }) => event === eventName,
              );
              const copy = notificationCopy[eventName];
              return (
                <form
                  className={styles.card}
                  key={eventName}
                  onSubmit={(event) => {
                    event.preventDefault();
                    const form = new FormData(event.currentTarget);
                    void mutate(
                      `/admin/growth/notification-rules/${eventName}`,
                      {
                        method: "PUT",
                        body: JSON.stringify({
                          active: form.get("active") === "on",
                          subject: form.get("subject"),
                          message: form.get("message"),
                        }),
                      },
                    );
                  }}
                >
                  <p className="font-semibold">{copy.title}</p>
                  <p className="mt-1 text-xs leading-6 text-[#807384]">{copy.help}</p>
                  <div className="mt-5 space-y-5"><Input
                    defaultValue={rule?.subject}
                    name="subject"
                    label="Asunto del correo" help="Es el título que aparece en la bandeja de entrada."
                    placeholder={copy.subject}
                  />
                  <Field label="Mensaje" help="Escribí el texto que querés que reciba tu cliente." example={`Ejemplo: ${copy.message}`}><textarea
                    defaultValue={rule?.message}
                    name="message"
                    placeholder={copy.message}
                    required
                  /></Field></div>
                  <label className="my-5 flex items-start gap-3 rounded-xl bg-[#faf7fc] p-4 text-sm">
                    <input
                      className="mt-1 accent-[#6E3482]"
                      defaultChecked={rule?.active ?? true}
                      name="active"
                      type="checkbox"
                    />{" "}
                    <span><span className="block font-medium">Enviar este correo automáticamente</span><span className="mt-1 block text-xs leading-5 text-[#807384]">Si lo desmarcás y guardás, se dejan de generar nuevos correos de este tipo. Los que ya estén en cola no se cancelan.</span></span>
                  </label>
                  <div className={styles.footer}><Button disabled={!canManage}>Guardar mensaje</Button></div>
                </form>
              );
            })}
          </div>
        )}
      </section>

      <section id="growth-carts" hidden={section !== "carts"}>
        <Title
          onOpenPlan={() => onNavigate("plan")}
          title="Recuperación de carritos"
          pro={!pro("ABANDONED_CART_RECOVERY")}
        />
        <p className="mt-2 text-sm leading-6 text-[#807384]">{sections[6].help}</p>
        {pro("ABANDONED_CART_RECOVERY") && (
          <Cards>
            {data.abandonedCarts.length === 0 && <EmptyState title="No hay carritos para recuperar">Cuando se registren compras abandonadas aparecerán acá. Solo podés enviar un recordatorio si el cliente dejó su email.</EmptyState>}
            {data.abandonedCarts.map((cart) => (
              <Card
                key={cart.id}
                title={cart.recoveryEmail ?? "Sin email"}
                text={`${cart.items.map((item) => `${item.product.name} × ${item.quantity}`).join(", ")} · ${new Date(cart.updatedAt).toLocaleString("es-AR")}`}
                action={
                  canManage && cart.recoveryEmail ? (
                    <button
                      className="text-xs font-semibold text-[#6E3482]"
                      onClick={() =>
                        void mutate(
                          `/admin/growth/abandoned-carts/${cart.id}/recover`,
                          { method: "POST" },
                        )
                      }
                    >
                      Enviar recuperación
                    </button>
                  ) : undefined
                }
              />
            ))}
          </Cards>
        )}
      </section>
          </fieldset>
          {busy && <p role="status" className="mt-4 text-sm text-[#6E3482]">Guardando cambios…</p>}
        </div>
      </div>
    </div>
  );
}

type ShippingMethodDefaults = GrowthData["shippingZones"][number]["methods"][number];

function ShippingMethodForm({
  buttonLabel,
  defaults,
  disabled,
  onSubmit,
}: {
  buttonLabel: string;
  defaults?: ShippingMethodDefaults;
  disabled?: boolean;
  onSubmit: (payload: Record<string, unknown>) => Promise<boolean>;
}) {
  const [offersFreeShipping, setOffersFreeShipping] = useState(
    Boolean(defaults?.freeShippingThresholdInCents),
  );
  const [carrierRate, setCarrierRate] = useState(
    defaults ? String(defaults.priceInCents / 100) : "",
  );
  const [packagingCost, setPackagingCost] = useState("");
  const [operatingMargin, setOperatingMargin] = useState("");
  const carrierRateValue = parseShippingAmount(carrierRate);
  const packagingCostValue = parseShippingAmount(packagingCost);
  const operatingMarginValue = parseShippingAmount(operatingMargin);
  const finalShippingPrice = carrierRateValue + packagingCostValue + operatingMarginValue;

  return <form className={`${styles.form} mt-4`} onSubmit={async (event) => {
    event.preventDefault();
    const element = event.currentTarget;
    const form = new FormData(element);
    const carrierCode = String(form.get("carrierCode") || "CUSTOM");
    const preset = carriers.find(({ code }) => code === carrierCode);
    const customTrackingUrl = String(form.get("trackingUrlTemplate") || "").trim();
    const saved = await onSubmit({
      name: form.get("methodName"),
      priceInCents: Math.round(finalShippingPrice * 100),
      estimatedDaysMin: Number(form.get("estimatedDaysMin")),
      estimatedDaysMax: Number(form.get("estimatedDaysMax")),
      freeShippingThresholdInCents: offersFreeShipping && form.get("freeShippingThreshold")
        ? Math.round(Number(form.get("freeShippingThreshold")) * 100)
        : null,
      carrierCode,
      carrierName: String(form.get("carrierName") || "").trim() || preset?.name || "Otro transportista",
      trackingUrlTemplate: customTrackingUrl || preset?.trackingUrlTemplate || null,
    });
    if (saved && !defaults) {
      element.reset();
      setCarrierRate("");
      setPackagingCost("");
      setOperatingMargin("");
      setOffersFreeShipping(false);
    }
  }}>
    <Input name="methodName" label="Nombre del método" help="Es la opción que verá el comprador dentro de esta zona." placeholder="Envío estándar" defaultValue={defaults?.name} />
    <Field label="Transportista" help="Estas opciones solo completan el nombre y su página de seguimiento; no cotizan el precio. Elegí Otro para agregar cualquier empresa o mensajería propia." example="Ejemplo: Correo Argentino"><select defaultValue={defaults?.carrierCode ?? "CORREO_ARGENTINO"} name="carrierCode"><option value="CORREO_ARGENTINO">Correo Argentino</option><option value="ANDREANI">Andreani</option><option value="OCA">OCA</option><option value="VIA_CARGO">Vía Cargo</option><option value="CUSTOM">Otro / mensajería propia</option></select></Field>
    <Input name="carrierName" label="Nombre personalizado del transportista (opcional)" help="Completalo solo si elegiste Otro o querés cambiar el nombre visible." placeholder="Moto Express" defaultValue={defaults?.carrierName ?? undefined} required={false} />
    <Input name="trackingUrlTemplate" label="URL de seguimiento personalizada (opcional)" help="Usá {code} donde debe insertarse el código. Si elegís una empresa conocida podés dejarla vacía." placeholder="https://envios.ejemplo.com/seguimiento/{code}" defaultValue={defaults?.trackingUrlTemplate ?? undefined} required={false} />
    <div className="sm:col-span-2 rounded-2xl border border-[#ddcfe3] bg-[#fbf8fc] p-5">
      <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-start"><div><h5 className="text-sm font-semibold text-[#382d3b]">Calculadora del precio de envío</h5><p className="mt-1 max-w-2xl text-xs leading-5 text-[#807384]">Consultá una tarifa representativa para esta zona y sumá únicamente los costos que quieras trasladar al comprador.</p></div><span className="shrink-0 rounded-full bg-white px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-[#6E3482] shadow-sm">Tarifa manual</span></div>
      {defaults && <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-950"><strong>Al editar:</strong> cargamos el precio final actual como tarifa base porque el desglose anterior no se guardaba. Corregilo antes de sumar embalaje o margen.</p>}
      <div className="mt-5 grid gap-4 sm:grid-cols-3">
        <Input name="carrierRate" label="1. Tarifa del transportista" help="Precio consultado para esta zona o un promedio representativo." placeholder="3500" type="number" step="0.01" value={carrierRate} onChange={setCarrierRate} />
        <Input name="packagingCost" label="2. Embalaje (opcional)" help="Caja, bolsa, protección o preparación del paquete." placeholder="500" type="number" step="0.01" value={packagingCost} onChange={setPackagingCost} required={false} />
        <Input name="operatingMargin" label="3. Gestión o margen (opcional)" help="Importe fijo para cubrir gestión o variaciones de tarifa." placeholder="300" type="number" step="0.01" value={operatingMargin} onChange={setOperatingMargin} required={false} />
      </div>
      <div className="mt-5 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-emerald-950" aria-live="polite">
        <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-center"><div><p className="text-xs font-medium">Precio final que verá el comprador</p><p className="mt-1 text-2xl font-semibold tracking-tight">{formatShippingPesos(finalShippingPrice)}</p></div><p className="text-xs leading-5 text-emerald-800">{formatShippingPesos(carrierRateValue)} tarifa + {formatShippingPesos(packagingCostValue)} embalaje + {formatShippingPesos(operatingMarginValue)} gestión</p></div>
      </div>
      <p className="mt-3 text-[11px] leading-5 text-[#918495]">El comprador verá un único precio de envío. Por ahora InfinityFood guarda el total final, no el desglose, y lo suma automáticamente al pedido.</p>
    </div>
    <div className="grid gap-4 sm:grid-cols-2"><Input name="estimatedDaysMin" label="Plazo mínimo (días hábiles)" placeholder="2" type="number" min={1} defaultValue={defaults ? String(defaults.estimatedDaysMin ?? defaults.estimatedDays ?? 1) : undefined} /><Input name="estimatedDaysMax" label="Plazo máximo (días hábiles)" placeholder="4" type="number" min={1} defaultValue={defaults ? String(defaults.estimatedDaysMax ?? defaults.estimatedDays ?? 1) : undefined} /></div>
    <label className="flex cursor-pointer items-center justify-between gap-4 rounded-2xl border border-[#e6dfe8] bg-[#fbf8fc] p-4">
      <span><strong className="block text-sm text-[#382d3b]">Ofrecer envío gratis</strong><span className="mt-1 block text-xs leading-5 text-[#807384]">Activá esta opción para bonificar el precio final cuando la compra alcance un monto mínimo.</span></span>
      <input aria-label="Ofrecer envío gratis" checked={offersFreeShipping} className="h-5 w-5 accent-[#6E3482]" onChange={(event) => setOffersFreeShipping(event.target.checked)} type="checkbox" />
    </label>
    {offersFreeShipping && <Input name="freeShippingThreshold" label="Compra mínima para envío gratis" help="Se calcula sobre los productos después de aplicar descuentos." placeholder="50000" type="number" min={1} step="0.01" defaultValue={defaults?.freeShippingThresholdInCents ? String(defaults.freeShippingThresholdInCents / 100) : undefined} />}
    <div className={styles.footer}><Button disabled={disabled}>{buttonLabel}</Button></div>
  </form>;
}

function parseShippingAmount(value: string) {
  const amount = Number(value);
  return Number.isFinite(amount) && amount > 0 ? amount : 0;
}

function formatShippingPesos(value: number) {
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(value);
}

function formatDeliveryRange(minimum: number | null, maximum: number | null) {
  if (minimum && maximum && minimum !== maximum) return `${minimum} a ${maximum} días hábiles`;
  if (minimum || maximum) return `${minimum ?? maximum} días hábiles`;
  return "Plazo a coordinar";
}

function normalizePostalCode(value: string) {
  return value.replace(/\s+/g, "").toUpperCase();
}

function shippingZoneSpecificity(postalCode: string, prefixes: string[]) {
  const normalized = normalizePostalCode(postalCode);
  const candidates = normalized.match(/^[A-Z]\d/) ? [normalized, normalized.slice(1)] : [normalized];
  return prefixes.reduce((best, prefix) => {
    const normalizedPrefix = normalizePostalCode(prefix);
    return normalizedPrefix && candidates.some((candidate) => candidate.startsWith(normalizedPrefix))
      ? Math.max(best, normalizedPrefix.length)
      : best;
  }, 0);
}

function selectShippingZones(zones: GrowthData["shippingZones"], postalCode: string) {
  if (!postalCode.trim()) return [];
  const activeZones = zones.filter((zone) => zone.active && zone.methods.some((method) => method.active));
  const withSpecificity = activeZones.map((zone) => ({
    zone,
    specificity: shippingZoneSpecificity(postalCode, zone.postalPrefixes),
  }));
  const bestSpecificity = Math.max(0, ...withSpecificity.map(({ specificity }) => specificity));
  return withSpecificity
    .filter(({ zone, specificity }) => bestSpecificity > 0
      ? specificity === bestSpecificity
      : zone.postalPrefixes.length === 0)
    .map(({ zone }) => zone);
}

function Title({ title, pro, onOpenPlan }: { title: string; pro?: boolean; onOpenPlan?: () => void }) {
  return (
    <div>
      <h3 className="text-xl font-semibold tracking-tight text-[#2b202e]">{title}</h3>
      {pro && (
        <Tip title="Disponible con Pro">Esta herramienta requiere el plan Pro. Podés consultar las opciones en {onOpenPlan ? <GuideLink onClick={onOpenPlan}>Plan y uso</GuideLink> : "Plan y uso"}.</Tip>
      )}
    </div>
  );
}
function Metric({ label, value, help }: { label: string; value: string | number; help: string }) {
  return (
    <article className={styles.card}>
      <p className="text-xs text-[#807384]">{label}</p>
      <p className="mt-2 text-2xl font-semibold">{value}</p>
      <p className="mt-3 text-xs leading-5 text-[#918495]">{help}</p>
    </article>
  );
}
function Cards({ children }: { children: React.ReactNode }) {
  return <div className="mt-4 grid gap-3 lg:grid-cols-2">{children}</div>;
}
function Card({
  title,
  text,
  action,
  onDelete,
}: {
  title: string;
  text: string;
  action?: React.ReactNode;
  onDelete?: () => void;
}) {
  return (
    <article className={styles.card}>
      <div className="flex flex-wrap justify-between gap-4">
        <div className="min-w-0 flex-1">
          <p className="font-semibold">{title}</p>
          <p className="mt-1 break-words text-xs leading-5 text-[#807384] [overflow-wrap:anywhere]">
            {text}
          </p>
        </div>
        <div className="flex shrink-0 flex-col gap-2">
          {action}
          {onDelete && (
            <button
              className="text-xs font-semibold text-red-600"
              onClick={onDelete}
            >
              Eliminar
            </button>
          )}
        </div>
      </div>
    </article>
  );
}
function Input({
  name,
  label,
  help = "",
  placeholder,
  type = "text",
  defaultValue,
  required = true,
  min = 0,
  max,
  step = "1",
  value,
  onChange,
}: {
  name: string;
  label: string;
  help?: string;
  placeholder: string;
  type?: string;
  defaultValue?: string;
  required?: boolean;
  min?: number;
  max?: number;
  step?: string;
  value?: string;
  onChange?: (value: string) => void;
}) {
  return (
    <Field label={label} help={help} example={`Ejemplo: ${placeholder}`}><input
      defaultValue={value === undefined ? defaultValue : undefined}
      value={value}
      onChange={onChange ? (event) => onChange(event.target.value) : undefined}
      min={type === "number" ? min : undefined}
      max={max}
      step={type === "number" ? step : undefined}
      name={name}
      placeholder={placeholder}
      required={required}
      type={type}
    /></Field>
  );
}
function Button({
  children,
  disabled,
}: {
  children: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <button
      className={styles.button}
      disabled={disabled}
      type="submit"
    >
      {children}
    </button>
  );
}
