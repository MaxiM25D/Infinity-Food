import { AdminPanel, type AdminTab } from "@/components/admin/admin-panel";

const tabs = new Set<AdminTab>([
  "dashboard",
  "categories",
  "products",
  "menu",
  "dining",
  "pos",
  "reservations",
  "reports",
  "advanced",
  "orders",
  "customers",
  "management",
  "growth",
  "team",
  "plan",
  "store",
  "account",
]);

export default async function AdminPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = await searchParams;
  const requestedTab = typeof query.tab === "string" && tabs.has(query.tab as AdminTab)
    ? query.tab as AdminTab
    : undefined;
  const requestedSection = typeof query.section === "string" && ["identity", "appearance", "payments"].includes(query.section) ? query.section as "identity" | "appearance" | "payments" : undefined;
  return <AdminPanel initialStoreSection={requestedSection} initialTab={requestedTab} mercadoPagoMessage={typeof query.message === "string" ? query.message : undefined} mercadoPagoResult={typeof query.mercadopago === "string" ? query.mercadopago : undefined} openStore={query.tab === "store" || Boolean(query.mercadopago)} />;
}
