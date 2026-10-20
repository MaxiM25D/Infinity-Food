import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { PublicMenu, type PublicMenuData } from "@/components/menu/public-menu";

const apiUrl = process.env.API_INTERNAL_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api";

async function getMenu(restaurantSlug: string, branchSlug: string): Promise<PublicMenuData | null> {
  try {
    const response = await fetch(`${apiUrl}/menu/${encodeURIComponent(restaurantSlug)}/${encodeURIComponent(branchSlug)}`, { next: { revalidate: 30 } });
    return response.ok ? response.json() as Promise<PublicMenuData> : null;
  } catch { return null; }
}

type Props = { params: Promise<{ restaurantSlug: string; branchSlug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { restaurantSlug, branchSlug } = await params;
  const menu = await getMenu(restaurantSlug, branchSlug);
  if (!menu) return { title: "Carta no encontrada", robots: { index: false, follow: false } };
  return { title: `${menu.restaurant.name} · ${menu.branch.name}`, description: menu.restaurant.settings?.description ?? `Carta de ${menu.restaurant.name}`, alternates: { canonical: `/carta/${restaurantSlug}/${branchSlug}` } };
}

export default async function MenuPage({ params }: Props) {
  const { restaurantSlug, branchSlug } = await params;
  const menu = await getMenu(restaurantSlug, branchSlug);
  if (!menu) notFound();
  return <PublicMenu menu={menu} />;
}
