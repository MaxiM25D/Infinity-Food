export type MarketingPlanCode = "PRO";

export type MarketingPlan = {
  code: MarketingPlanCode;
  name: string;
  description: string;
  price: string;
  priceInCents: number;
  currency: string;
  trialDays: number;
  capacity: string;
  featured: boolean;
  features: string[];
};

export type PublicPlan = {
  code: MarketingPlanCode;
  name: string;
  description: string | null;
  priceInCents: number;
  currency: string;
  maxProducts: number;
  maxMembers: number;
  trialDays: number;
  features: string[];
};

const featureLabels: Record<string, string> = {
  CORE_CATALOG: "Carta QR y pedidos por mesa",
  TENANT_MP_OAUTH: "Mercado Pago directo a tu cuenta",
  BANK_TRANSFER: "Transferencias y comprobantes",
  STOCK_MANAGEMENT: "Pedidos, POS y caja",
  ADVANCED_ANALYTICS: "Reportes operativos avanzados",
  COUPONS_PROMOTIONS: "Promociones y descuentos",
  PRODUCT_VARIANTS: "Variantes de platos y bebidas",
  ABANDONED_CART_RECOVERY: "Recuperación de pedidos online",
  CUSTOM_DOMAIN: "Dominio personalizado",
  ADVANCED_STORE_CUSTOMIZATION: "Personalización avanzada",
  AUTOMATIONS: "Automatizaciones",
  PRIORITY_SUPPORT: "Soporte prioritario",
};

export function publicPlanToMarketingPlan(plan: PublicPlan): MarketingPlan {
  const price = new Intl.NumberFormat("es-AR", { style: "currency", currency: plan.currency, maximumFractionDigits: 0 }).format(plan.priceInCents / 100);
  const features = plan.features.map((feature) => featureLabels[feature]).filter((feature): feature is string => Boolean(feature));
  return {
    code: plan.code,
    name: plan.name,
    description: plan.description ?? "Todo lo que necesitás para operar y hacer crecer tu restaurante.",
    price,
    priceInCents: plan.priceInCents,
    currency: plan.currency,
    trialDays: plan.trialDays,
    capacity: `Hasta ${new Intl.NumberFormat("es-AR").format(plan.maxProducts)} productos · ${Math.max(0, plan.maxMembers - 1)} colaboradores`,
    featured: true,
    features: features.length > 0 ? [...features, "Sin comisión de InfinityFood por venta"] : marketingPlans[0].features,
  };
}

export const marketingPlans: MarketingPlan[] = [
  {
    code: "PRO",
    name: "InfinityFood Pro",
    description: "Todo lo que necesitás para operar y hacer crecer tu restaurante.",
    price: "$50.000",
    priceInCents: 5_000_000,
    currency: "ARS",
    trialDays: 7,
    capacity: "Hasta 1.000 productos · 5 colaboradores",
    featured: true,
    features: [
      "Carta QR y pedidos por mesa",
      "Mercado Pago directo a tu cuenta",
      "Pedidos, comandas, KDS, POS y caja",
      "Reservas y reportes operativos",
      "Promociones y variantes",
      "Canal de pedidos online",
      "Dominio y personalización avanzada",
      "Automatizaciones y soporte prioritario",
      "Sin comisión de InfinityFood por venta",
    ],
  },
];
