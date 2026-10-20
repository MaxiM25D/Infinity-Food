import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { TableOrder, type TableMenu } from "@/components/dining/table-order";

const apiUrl = (process.env.API_INTERNAL_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api").replace(/\/$/, "");

async function loadMenu(restaurantSlug: string, branchSlug: string, tableCode: string): Promise<TableMenu | null> {
  const response = await fetch(`${apiUrl}/dining/${encodeURIComponent(restaurantSlug)}/${encodeURIComponent(branchSlug)}/tables/${encodeURIComponent(tableCode)}`, { cache: "no-store" });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error("No pudimos cargar la carta de esta mesa");
  return response.json() as Promise<TableMenu>;
}

export async function generateMetadata({ params }: PageProps<"/mesa/[restaurantSlug]/[branchSlug]/[tableCode]">): Promise<Metadata> {
  const { restaurantSlug, branchSlug, tableCode } = await params;
  const menu = await loadMenu(restaurantSlug, branchSlug, tableCode);
  return menu ? { title: `${menu.table.name} · ${menu.restaurant.name}`, description: `Pedí desde ${menu.table.name} en ${menu.restaurant.name}` } : { title: "Mesa no encontrada" };
}

export default async function TablePage({ params }: PageProps<"/mesa/[restaurantSlug]/[branchSlug]/[tableCode]">) {
  const { restaurantSlug, branchSlug, tableCode } = await params;
  const menu = await loadMenu(restaurantSlug, branchSlug, tableCode);
  if (!menu) notFound();
  return <TableOrder menu={menu} />;
}
