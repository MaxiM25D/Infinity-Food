import type { Metadata } from "next";
import { OperationGuard } from "@/components/operation-guard";
import { Geist, Geist_Mono } from "next/font/google";
import "sweetalert2/dist/sweetalert2.min.css";
import "./globals.css";

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://infinityfood.com.ar";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: { default: "InfinityFood", template: "%s | InfinityFood" },
  description: "SaaS gastronómico multi-tenant para restaurantes, bares y cafeterías.",
  applicationName: "InfinityFood",
  openGraph: {
    type: "website",
    locale: "es_AR",
    siteName: "InfinityFood",
    title: "InfinityFood — Tu operación gastronómica en un solo lugar",
    description: "Carta QR, salón, comandas, cocina, caja, reservas y reportes para cada sucursal.",
    images: [{ url: "/infinityfood-logo.png", alt: "InfinityFood" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "InfinityFood — Tu operación gastronómica en un solo lugar",
    description: "Carta QR, salón, comandas, cocina, caja, reservas y reportes para cada sucursal.",
    images: ["/infinityfood-logo.png"],
  },
  icons: {
    icon: "/infinityfood-mark.png",
    shortcut: "/infinityfood-mark.png",
    apple: "/infinityfood-mark.png",
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="es"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col"><OperationGuard>{children}</OperationGuard></body>
    </html>
  );
}
