"use client";

import {
  BarChart3,
  Boxes,
  Calculator,
  ChartNoAxesCombined,
  CircleUserRound,
  CircleDollarSign,
  CalendarDays,
  CreditCard,
  ExternalLink,
  LogOut,
  Menu,
  PackageSearch,
  Warehouse,
  ShieldCheck,
  ShoppingBag,
  Store,
  Tags,
  Users,
  UtensilsCrossed,
  ConciergeBell,
  Combine,
  X,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

import { ApiError, apiRequest } from "@/lib/api";
import { BrandLogo } from "@/components/brand-logo";
import { CategoriesView } from "./categories-view";
import { AccountView } from "./account-view";
import { CustomersView } from "./customers-view";
import { DashboardView } from "./dashboard-view";
import { ProductsView } from "./products-view";
import { OrdersView } from "./orders-view";
import { PlanView } from "./plan-view";
import { StoreView } from "./store-view";
import { TeamView } from "./team-view";
import { GrowthView } from "./growth-view";
import { ManagementView } from "./management-view";
import { TenantSwitcher } from "./tenant-switcher";
import { BranchSwitcher } from "./branch-switcher";
import { MenuView } from "./menu-view";
import { DiningView } from "./dining-view";
import { PosView } from "./pos-view";
import { ReservationsView } from "./reservations-view";
import { ReportsView } from "./reports-view";
import { AdvancedView } from "./advanced-view";
import { InventoryView } from "./inventory-view";
import type { Role } from "./types";
import type { BranchContext } from "@infinityfood/contracts";

export type AdminTab =
  | "dashboard"
  | "categories"
  | "products"
  | "menu"
  | "dining"
  | "pos"
  | "reservations"
  | "reports"
  | "advanced"
  | "orders"
  | "customers"
  | "management"
  | "inventory"
  | "growth"
  | "team"
  | "plan"
  | "store"
  | "account";
type Session = {
  user: {
    firstName: string;
    lastName: string;
    email: string;
    platformRole: "USER" | "SUPERADMIN";
    emailVerified: boolean;
  };
  tenant: { name: string; slug: string };
  branch: BranchContext;
  role: Role;
  supportAccess: {
    originTenantId: string;
    startedAt: string;
  } | null;
};

type NavigationItem = {
  id: AdminTab;
  label: string;
  description: string;
  icon: LucideIcon;
};

const navigationGroups: Array<{ label: string; items: NavigationItem[] }> = [
  {
    label: "General",
    items: [
      { id: "dashboard", label: "Resumen", description: "Estado general de tu tienda", icon: BarChart3 },
      { id: "growth", label: "Crecimiento", description: "Promociones, analytics y automatizaciones", icon: ChartNoAxesCombined },
    ],
  },
  {
    label: "Operación",
    items: [
      { id: "management", label: "Gestión", description: "Ventas del local y stock", icon: Calculator },
      { id: "inventory", label: "Inventario", description: "Ingredientes, recetas y compras", icon: Warehouse },
      { id: "pos", label: "POS y caja", description: "Cobros, turnos y movimientos", icon: CircleDollarSign },
      { id: "reservations", label: "Reservas", description: "Agenda, señas y lista de espera", icon: CalendarDays },
      { id: "reports", label: "Reportes", description: "Ventas, tiempos y ocupación", icon: BarChart3 },
      { id: "menu", label: "Carta", description: "Platos, disponibilidad y QR", icon: UtensilsCrossed },
      { id: "dining", label: "Salón", description: "Mesas, comandas y KDS", icon: ConciergeBell },
      { id: "advanced", label: "Operación avanzada", description: "Mesas unidas, cuentas e impresión", icon: Combine },
      { id: "orders", label: "Pedidos", description: "Ventas, pagos y entregas", icon: ShoppingBag },
      { id: "products", label: "Productos", description: "Catálogo, stock y variantes", icon: Boxes },
      { id: "categories", label: "Categorías", description: "Organización del catálogo", icon: Tags },
      { id: "customers", label: "Clientes", description: "Compradores e historial", icon: PackageSearch },
    ],
  },
  {
    label: "Configuración",
    items: [
      { id: "store", label: "Mi tienda", description: "Identidad, pagos y contacto", icon: Store },
      { id: "team", label: "Equipo", description: "Miembros y permisos", icon: Users },
      { id: "plan", label: "Plan y uso", description: "Suscripción y límites", icon: CreditCard },
      { id: "account", label: "Mi cuenta", description: "Perfil y seguridad", icon: CircleUserRound },
    ],
  },
];

const navigation = navigationGroups.flatMap(({ items }) => items);

export function AdminPanel({
  openStore = false,
  initialTab,
  initialStoreSection,
  mercadoPagoResult,
  mercadoPagoMessage,
}: {
  openStore?: boolean;
  initialTab?: AdminTab;
  initialStoreSection?: "identity" | "appearance" | "payments";
  mercadoPagoResult?: string;
  mercadoPagoMessage?: string;
}) {
  const router = useRouter();
  const [session, setSession] = useState<Session | null>(null);
  const [tab, setTab] = useState<AdminTab>(
    openStore ? "store" : (initialTab ?? "dashboard"),
  );
  const [loading, setLoading] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);
  const [supportEnding, setSupportEnding] = useState(false);
  const [storeSection, setStoreSection] = useState<"identity" | "appearance" | "payments">(initialStoreSection ?? "identity");

  useEffect(() => {
    apiRequest<Session>("/auth/me")
      .then(setSession)
      .catch((error) => {
        if (error instanceof ApiError && error.status === 401)
          router.replace("/login");
      })
      .finally(() => setLoading(false));
  }, [router]);

  useEffect(() => {
    if (!menuOpen) return;
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setMenuOpen(false);
    }
    document.addEventListener("keydown", closeOnEscape);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", closeOnEscape);
      document.body.style.overflow = "";
    };
  }, [menuOpen]);

  function selectTab(nextTab: AdminTab) {
    setTab(nextTab);
    setMenuOpen(false);
    router.replace(`/admin?tab=${nextTab}`, { scroll: false });
  }

  function openStoreSection(section: "identity" | "appearance" | "payments") {
    setStoreSection(section); setTab("store"); setMenuOpen(false);
    router.replace(`/admin?tab=store&section=${section}`, { scroll: false });
  }

  async function logout() {
    await apiRequest("/auth/logout", { method: "POST" });
    router.replace("/login");
  }

  async function endSupportAccess() {
    setSupportEnding(true);
    try {
      await apiRequest("/platform/support-access/end", { method: "POST" });
      router.push("/platform?section=stores");
      router.refresh();
    } catch {
      setSupportEnding(false);
    }
  }

  if (loading) {
    return (
      <main className="grid min-h-screen place-items-center bg-[#f8f7f9]">
        <div className="flex items-center gap-3 text-sm font-semibold text-stone-600">
          <span className="h-3 w-3 animate-pulse rounded-full bg-[#6E3482]" />{" "}
          Cargando tu tienda…
        </div>
      </main>
    );
  }

  if (!session) return null;

  const content = {
    dashboard: <DashboardView onNavigate={selectTab} />,
    categories: <CategoriesView onOpenProducts={() => selectTab("products")} role={session.role} />,
    products: <ProductsView onOpenCategories={() => selectTab("categories")} role={session.role} />,
    menu: <MenuView branchRole={session.branch.role} key={session.branch.id} role={session.role} />,
    dining: <DiningView />,
    pos: <PosView branchRole={session.branch.role} role={session.role} />,
    reservations: <ReservationsView />,
    reports: <ReportsView />,
    advanced: <AdvancedView />,
    orders: <OrdersView role={session.role} />,
    customers: <CustomersView />,
    management: <ManagementView role={session.role} />,
    inventory: <InventoryView />,
    growth: <GrowthView onNavigate={selectTab} role={session.role} />,
    team: <TeamView onOpenPlan={() => selectTab("plan")} role={session.role} />,
    plan: <PlanView onOpenStore={openStoreSection} role={session.role} />,
    store: (
      <StoreView
        initialSection={storeSection}
        mercadoPagoMessage={mercadoPagoMessage}
        mercadoPagoResult={mercadoPagoResult}
        onOpenPlan={() => selectTab("plan")}
        role={session.role}
        onStoreUpdated={(name) =>
          setSession({ ...session, tenant: { ...session.tenant, name } })
        }
        onSectionChange={openStoreSection}
      />
    ),
    account: <AccountView onOpenStore={() => openStoreSection("identity")} user={session.user} onUserUpdated={(user) => setSession({ ...session, user: { ...session.user, ...user } })} />,
  }[tab];
  const activeNavigation = navigation.find(({ id }) => id === tab)!;

  return (
    <div className="min-h-screen bg-[#f8f7f9] text-[#211b23] lg:grid lg:grid-cols-[17.5rem_1fr]">
      <aside
        aria-label="Navegación administrativa"
        className={`${menuOpen ? "translate-x-0" : "-translate-x-full"} fixed inset-y-0 left-0 z-40 flex w-[17.5rem] flex-col border-r border-white/[0.07] bg-[#17131a] p-4 text-white shadow-2xl transition-transform duration-300 lg:sticky lg:top-0 lg:h-screen lg:translate-x-0 lg:shadow-none`}
      >
        <div className="flex items-center justify-between px-2 py-3.5">
          <BrandLogo subtitle="Commerce OS" />
          <button
            aria-label="Cerrar menú"
            className="grid h-9 w-9 place-items-center rounded-xl border border-white/10 text-white/50 transition hover:bg-white/[0.06] hover:text-white lg:hidden"
            onClick={() => setMenuOpen(false)}
            type="button"
          >
            <X size={17} />
          </button>
        </div>

        {session.supportAccess ? (
          <div className="mb-5 rounded-xl border border-[#a56abd]/40 bg-[#6E3482]/20 px-3 py-3">
            <p className="text-[9px] font-bold uppercase tracking-[0.18em] text-[#debfea]">Sesión de soporte</p>
            <p className="mt-1 truncate text-sm font-semibold text-white">{session.tenant.name}</p>
          </div>
        ) : (
          <TenantSwitcher
            current={session.tenant}
            emailVerified={session.user.emailVerified}
            key={session.tenant.slug}
            onSelected={() => {
              void apiRequest<Session>("/auth/me").then((nextSession) => {
                setSession(nextSession);
                selectTab("dashboard");
              });
            }}
          />
        )}

        {!session.supportAccess && <BranchSwitcher current={session.branch} onSelected={(branch) => { setSession({ ...session, branch }); selectTab("menu"); }} />}

        <nav className="min-h-0 flex-1 space-y-5 overflow-y-auto pr-1 [scrollbar-width:thin] [scrollbar-color:#4b3b50_transparent]">
          {navigationGroups.map((group) => (
            <div key={group.label}>
              <p className="mb-2 px-3 text-[9px] font-bold uppercase tracking-[0.2em] text-white/25">
                {group.label}
              </p>
              <div className="space-y-1">
                {group.items.map((item) => {
                  const Icon = item.icon;
                  const active = tab === item.id;
                  return (
                    <button
                      aria-current={active ? "page" : undefined}
                      className={`group flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-medium transition ${
                        active
                          ? "bg-[#6E3482] text-white shadow-[0_8px_25px_rgba(110,52,130,0.28)]"
                          : "text-white/50 hover:bg-white/[0.055] hover:text-white"
                      }`}
                      key={item.id}
                      onClick={() => selectTab(item.id)}
                      type="button"
                    >
                      <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg transition ${active ? "bg-white/10" : "bg-white/[0.035] group-hover:bg-white/[0.07]"}`}>
                        <Icon size={16} strokeWidth={1.8} />
                      </span>
                      <span className="truncate">{item.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        <div className="mt-4 shrink-0 border-t border-white/10 pt-4">
          {session.supportAccess ? (
            <button className="mb-4 w-full rounded-xl bg-[#6E3482] px-4 py-2.5 text-center text-sm font-semibold text-white transition hover:bg-[#7d3d93] disabled:opacity-60" disabled={supportEnding} onClick={() => void endSupportAccess()} type="button">
              {supportEnding ? "Saliendo…" : "Salir del soporte"}
            </button>
          ) : session.user.platformRole === "SUPERADMIN" && (
            <Link
              className="mb-4 block w-full rounded-xl bg-[#6E3482] px-4 py-2.5 text-center text-sm font-semibold text-white transition hover:bg-[#7d3d93]"
              href="/platform"
            >
              Panel SaaS
            </Link>
          )}
          <div className="mb-4 flex items-center gap-3 px-2">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-[#A56ABD]/20 text-xs font-bold text-[#debfea]">
              {session.user.firstName[0]}
              {session.user.lastName[0]}
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">
                {session.user.firstName} {session.user.lastName}
              </p>
              <p className="text-[10px] uppercase tracking-wider text-white/30">
                {session.user.platformRole === "SUPERADMIN" ? `SUPERADMIN · ${session.role}` : session.role}
              </p>
            </div>
          </div>
          <button
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-white/10 px-4 py-2.5 text-sm text-white/45 transition hover:bg-white/[0.06] hover:text-white"
            onClick={logout}
            type="button"
          >
            <LogOut size={15} /> Cerrar sesión
          </button>
        </div>
      </aside>

      {menuOpen && (
        <button
          aria-label="Cerrar menú"
          className="fixed inset-0 z-30 bg-black/30 lg:hidden"
          onClick={() => setMenuOpen(false)}
          type="button"
        />
      )}

      <main className="min-w-0 bg-[#f8f7f9]">
        {session.supportAccess && (
          <div className="sticky top-0 z-30 flex flex-wrap items-center justify-between gap-3 border-b border-violet-300 bg-violet-100 px-4 py-3 text-sm text-violet-950 sm:px-8 lg:px-10">
            <p className="flex items-center gap-2"><ShieldCheck size={17} /><span><strong>Modo soporte:</strong> estás configurando {session.tenant.name}. Todos los cambios son reales y quedan asociados a tu usuario.</span></p>
            <button className="rounded-lg bg-violet-800 px-3 py-2 text-xs font-semibold text-white disabled:opacity-60" disabled={supportEnding} onClick={() => void endSupportAccess()} type="button">{supportEnding ? "Saliendo…" : "Volver al Panel SaaS"}</button>
          </div>
        )}
        <header className={`${session.supportAccess ? "" : "sticky top-0"} z-20 flex min-h-20 items-center justify-between gap-4 border-b border-[#e8e3ea] bg-white/90 px-4 py-3 backdrop-blur-xl sm:px-8 lg:px-10`}>
          <div className="flex items-center gap-3">
            <button
              aria-label="Abrir menú"
              aria-expanded={menuOpen}
              className="grid h-10 w-10 place-items-center rounded-xl border border-[#e3dce5] bg-white text-[#6E3482] lg:hidden"
              onClick={() => setMenuOpen(true)}
              type="button"
            >
              <Menu size={18} />
            </button>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#8f7c94]">
                {session.tenant.name} · Panel administrativo
              </p>
              <h1 className="mt-0.5 text-lg font-semibold tracking-[-0.025em]">
                {activeNavigation.label}
              </h1>
              <p className="hidden text-xs text-stone-400 sm:block">
                {activeNavigation.description}
              </p>
            </div>
          </div>
          <Link
            className="inline-flex shrink-0 items-center gap-2 rounded-full bg-[#211b23] px-4 py-2.5 text-xs font-semibold text-white transition hover:-translate-y-0.5 hover:bg-[#49225B] hover:shadow-lg"
            href={`/tienda/${session.tenant.slug}`}
            rel="noreferrer"
            target="_blank"
          >
            <span className="hidden sm:inline">Ver tienda</span>
            <ExternalLink size={14} />
          </Link>
        </header>
        {!session.user.emailVerified && (
          <div className="border-b border-amber-200 bg-amber-50 px-5 py-3 text-sm text-amber-900 sm:px-8 lg:px-10">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p><strong>Email pendiente.</strong> Podés preparar la tienda, pero los cobros, suscripciones e invitaciones se habilitan después de verificarlo.</p>
              <button className="font-semibold underline" onClick={() => selectTab("account")} type="button">Verificar ahora</button>
            </div>
          </div>
        )}
        <div className="p-4 sm:p-7 lg:p-10" key={`${session.tenant.slug}:${session.branch.id}`}>
          {content}
        </div>
      </main>
    </div>
  );
}
