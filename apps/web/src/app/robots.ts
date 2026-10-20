import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://infinityfood.com.ar";
  return {
    rules: [{
      userAgent: "*",
      allow: "/",
      disallow: ["/admin", "/platform", "/login", "/onboarding", "/recuperar-clave", "/restablecer-clave", "/verificar-email", "/invitacion", "/tienda/*/checkout", "/tienda/*/mis-pedidos", "/tienda/*/pedido/"],
    }],
    sitemap: `${siteUrl.replace(/\/$/, "")}/sitemap.xml`,
  };
}
