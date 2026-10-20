import Link from "next/link";
import { Check } from "lucide-react";

import { loadMarketingPlans } from "@/lib/plan-catalog-server";
import { BrandLogo } from "@/components/brand-logo";
import styles from "./home.module.css";

const benefits = [
  [
    "01",
    "Todo en un solo lugar",
    "Carta, salón, cocina, caja y reservas trabajando juntos.",
  ],
  [
    "02",
    "Tu marca primero",
    "Una carta QR personalizable y una experiencia ágil para cada mesa.",
  ],
  [
    "03",
    "Crece sin fricción",
    "Sucursales, roles y reportes preparados para acompañar tu crecimiento.",
  ],
];

const activity = [
  ["#1048", "Mesa 8", "$ 89.900", "Pagado"],
  ["#1047", "Mostrador", "$ 42.500", "Preparando"],
  ["#1046", "Mesa 3", "$ 115.000", "Nuevo"],
];

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const marketingPlans = await loadMarketingPlans();
  const activePlan = marketingPlans[0];
  return (
    <main className={styles.page}>
      <div className={`${styles.grid} pointer-events-none absolute inset-0`} />
      <div
        className={`${styles.glow} pointer-events-none absolute -right-40 top-28 h-[32rem] w-[32rem] rounded-full bg-fuchsia-600/20 blur-[100px]`}
      />

      <nav className="relative z-20 mx-auto flex max-w-7xl items-center justify-between px-5 py-5 sm:px-8 lg:px-10">
        <BrandLogo priority />

        <div className="hidden items-center gap-8 text-sm text-white/60 md:flex">
          <a className="transition hover:text-white" href="#plataforma">
            Plataforma
          </a>
          <a className="transition hover:text-white" href="#beneficios">
            Beneficios
          </a>
          <a className="transition hover:text-white" href="#planes">
            Planes
          </a>
        </div>

        <Link
          className="rounded-full border border-white/15 bg-white/5 px-5 py-2.5 text-sm font-semibold backdrop-blur transition hover:border-fuchsia-400/50 hover:bg-white/10"
          href="/login"
        >
          Ingresar
        </Link>
      </nav>

      <section className="relative z-10 mx-auto grid min-h-[calc(100vh-86px)] max-w-7xl items-center gap-16 px-5 pb-20 pt-12 sm:px-8 lg:grid-cols-[.88fr_1.12fr] lg:px-10 lg:pb-28 lg:pt-16">
        <div>
          <div className="mb-7 inline-flex items-center gap-2 rounded-full border border-fuchsia-400/20 bg-fuchsia-400/10 px-3.5 py-2 text-xs font-semibold text-fuchsia-100 backdrop-blur">
            <span
              className={`${styles.pulseDot} h-2 w-2 rounded-full bg-emerald-400`}
            />
            Tu restaurante conectado de punta a punta
          </div>
          <h1 className="max-w-3xl text-5xl font-semibold leading-[.98] tracking-[-0.055em] sm:text-6xl lg:text-[5rem]">
            Atendé mejor.
            <br />
            <span className="bg-gradient-to-r from-[#bf6bff] via-[#a94be2] to-[#46a5f7] bg-clip-text text-transparent">
              Gestioná todo.
            </span>
          </h1>
          <p className="mt-7 max-w-xl text-base leading-7 text-indigo-100/60 sm:text-lg sm:leading-8">
            Unificá carta QR, pedidos, comandas, cocina, caja, reservas y
            reportes en una plataforma diseñada para tu operación diaria.
          </p>
          <div className="mt-9 flex flex-col gap-3 sm:flex-row">
            <Link
              className="group inline-flex items-center justify-center gap-3 rounded-2xl bg-gradient-to-r from-[#a334d2] to-[#397eea] px-6 py-4 text-sm font-bold text-white shadow-[0_16px_50px_rgba(121,54,210,.3)] transition hover:-translate-y-0.5 hover:shadow-[0_20px_60px_rgba(121,54,210,.45)]"
              href="/login?mode=register"
            >
              Crear mi restaurante{" "}
              <span className="transition group-hover:translate-x-1">→</span>
            </Link>
            <Link
              className="inline-flex items-center justify-center rounded-2xl border border-white/15 bg-white/5 px-6 py-4 text-sm font-bold text-white backdrop-blur transition hover:bg-white/10"
              href="/tienda/infinityshop-demo"
            >
              Ver demo
            </Link>
          </div>
          <div className="mt-6 flex flex-wrap gap-x-5 gap-y-2 text-xs text-white/40">
            {activePlan.trialDays > 0 && <span>✓ {activePlan.trialDays} días gratis</span>}
            <span>✓ Sin tarjeta para crear tu restaurante</span>
            <span>✓ Sin costo de instalación</span>
            <span>✓ Cancelá cuando quieras</span>
          </div>
        </div>

        <DashboardPreview />
      </section>

      <section
        className="relative z-10 border-y border-white/[.07] bg-white/[.025] py-5"
        aria-label="Funciones principales"
      >
        <div className="overflow-hidden">
          <div
            className={`${styles.ticker} flex w-max gap-12 pr-12 text-xs font-semibold uppercase tracking-[.22em] text-white/35`}
          >
            {[...Array(2)]
              .flatMap(() => [
                "Mercado Pago",
                "Transferencias",
                "Carta QR",
                "Pedidos por mesa",
                "Comandas",
                "KDS",
                "Caja y reservas",
                "Reportes",
              ])
              .map((item, index) => (
                <span key={`${item}-${index}`}>{item}</span>
              ))}
          </div>
        </div>
      </section>

      <section
        className="relative z-10 mx-auto max-w-7xl px-5 py-24 sm:px-8 lg:px-10"
        id="beneficios"
      >
        <div className="max-w-2xl">
          <p className="text-xs font-bold uppercase tracking-[.22em] text-fuchsia-300">
            La base de tu operación gastronómica
          </p>
          <h2 className="mt-4 text-3xl font-semibold tracking-tight sm:text-5xl">
            Menos pantallas aisladas.
            <br />
            Más tiempo para atender.
          </h2>
        </div>
        <div className="mt-12 grid gap-4 md:grid-cols-3">
          {benefits.map(([number, title, description]) => (
            <article
              className="rounded-3xl border border-white/10 bg-white/[.035] p-7 transition hover:-translate-y-1 hover:border-fuchsia-400/30 hover:bg-white/[.055]"
              key={number}
            >
              <span className="text-xs font-bold text-blue-300">{number}</span>
              <h3 className="mt-12 text-xl font-semibold">{title}</h3>
              <p className="mt-3 text-sm leading-6 text-white/45">
                {description}
              </p>
            </article>
          ))}
        </div>
      </section>

      <section
        className="relative z-10 mx-auto max-w-7xl px-5 pb-24 sm:px-8 lg:px-10"
        id="planes"
      >
        <div className="mb-12 text-center">
          <p className="text-xs font-bold uppercase tracking-[.22em] text-blue-300">
            Un plan simple y transparente
          </p>
          <h2 className="mx-auto mt-4 max-w-2xl text-3xl font-semibold tracking-tight sm:text-5xl">
            Todo InfinityFood, sin funciones escondidas.
          </h2>
          <p className="mx-auto mt-5 max-w-xl text-sm leading-6 text-white/50 sm:text-base">
            {activePlan.trialDays > 0 ? `Creá tu restaurante sin tarjeta. Tenés ${activePlan.trialDays} días gratis y, si decidís continuar, vinculás Mercado Pago para pagar ${activePlan.price} ${activePlan.currency} por mes.` : `Creá tu restaurante sin tarjeta y, si decidís continuar, vinculás Mercado Pago para pagar ${activePlan.price} ${activePlan.currency} por mes.`} Cancelá cuando quieras.
          </p>
        </div>
        <div className="mx-auto grid max-w-3xl gap-5">
          {marketingPlans.map((plan) => (
            <article
              className={`relative rounded-[2rem] border p-7 sm:p-9 ${plan.featured ? "border-fuchsia-400/40 bg-gradient-to-br from-fuchsia-500/15 to-blue-500/[.06] shadow-[0_25px_80px_rgba(100,35,170,.15)]" : "border-white/10 bg-white/[.035]"}`}
              key={plan.code}
            >
              {plan.featured && (
                <span className="absolute right-6 top-6 rounded-full bg-fuchsia-400/15 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-fuchsia-200">
                  Precio de lanzamiento
                </span>
              )}
              <h3 className="text-2xl font-semibold">{plan.name}</h3>
              <p className="mt-2 text-sm text-white/45">{plan.description}</p>
              <p className="mt-7 text-4xl font-bold tracking-tight">
                {plan.price}
                <span className="ml-2 text-sm font-normal text-white/35">
                  ARS / mes
                </span>
              </p>
              <p className="mt-3 text-xs font-semibold text-blue-200/65">
                {plan.capacity}
              </p>
              <ul className="mt-7 grid gap-3 sm:grid-cols-2">
                {plan.features.map((feature) => (
                  <li
                    className="flex gap-2.5 text-sm text-white/55"
                    key={feature}
                  >
                    <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-emerald-400/10">
                      <Check className="h-3 w-3 text-emerald-300" />
                    </span>
                    {feature}
                  </li>
                ))}
              </ul>
              <Link
                className={`mt-9 flex w-full items-center justify-center rounded-xl px-6 py-4 text-sm font-bold transition hover:-translate-y-0.5 ${plan.featured ? "bg-gradient-to-r from-[#a334d2] to-[#397eea] text-white" : "bg-white text-[#080a2d]"}`}
                href={`/login?mode=register&plan=${plan.code}`}
              >
                Activar InfinityFood Pro →
              </Link>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}

function DashboardPreview() {
  return (
    <div className="relative mx-auto w-full max-w-2xl py-10" id="plataforma">
      <div className="absolute left-1/2 top-1/2 h-[80%] w-[88%] -translate-x-1/2 -translate-y-1/2 rounded-full bg-gradient-to-r from-fuchsia-500/30 to-blue-500/20 blur-[80px]" />
      <div
        className={`${styles.dashboard} relative rounded-[1.8rem] bg-white/10 p-px shadow-[0_38px_110px_rgba(0,0,0,.5)]`}
      >
        <div className="overflow-hidden rounded-[calc(1.8rem-1px)] bg-[#0b0d28]/95 backdrop-blur-xl">
          <div className="flex items-center justify-between border-b border-white/10 px-5 py-4 sm:px-7">
            <div className="flex items-center gap-3">
              <BrandLogo compact size="sm" />
              <span className="text-sm font-semibold">Panel de control</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-white/20" />
              <span className="h-2 w-2 rounded-full bg-white/20" />
              <span className="h-8 w-8 rounded-full bg-gradient-to-br from-fuchsia-500 to-blue-400" />
            </div>
          </div>
          <div className="grid gap-3 p-4 sm:grid-cols-3 sm:p-6">
            <Metric
              label="Ventas del mes"
              value="$ 2.840.500"
              change="+24,8%"
            />
            <Metric label="Pedidos" value="184" change="+18 hoy" />
            <Metric label="Ocupación" value="68%" change="+7%" />
          </div>
          <div className="grid gap-4 px-4 pb-5 sm:grid-cols-[1.15fr_.85fr] sm:px-6 sm:pb-6">
            <div className="rounded-2xl border border-white/10 bg-white/[.035] p-5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-white/40">Rendimiento</p>
                  <p className="mt-1 font-semibold">Servicios de la semana</p>
                </div>
                <span className="rounded-lg bg-emerald-400/10 px-2.5 py-1 text-[10px] font-bold text-emerald-300">
                  EN VIVO
                </span>
              </div>
              <div className={`${styles.bars} mt-8 flex h-32 items-end gap-3`}>
                {[42, 66, 51, 82, 68, 94, 77].map((height, index) => (
                  <span
                    className="rounded-t-md bg-gradient-to-t from-[#7730bd] to-[#55adff]"
                    key={height}
                    style={{
                      height: `${height}%`,
                      opacity: index === 5 ? 1 : 0.62,
                    }}
                  />
                ))}
              </div>
              <div className="mt-3 flex justify-between text-[9px] uppercase tracking-wider text-white/30">
                <span>Lun</span>
                <span>Mar</span>
                <span>Mié</span>
                <span>Jue</span>
                <span>Vie</span>
                <span>Sáb</span>
                <span>Dom</span>
              </div>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/[.035] p-5">
              <p className="text-xs text-white/40">Últimos pedidos</p>
              <div className="mt-4 space-y-3">
                {activity.map(([number, customer, total, status]) => (
                  <div className="flex items-center gap-3" key={number}>
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-white/[.06] text-[10px] text-white/50">
                      {number.slice(-2)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <strong className="block truncate text-xs">
                        {customer}
                      </strong>
                      <span className="text-[10px] text-white/35">
                        {status}
                      </span>
                    </span>
                    <strong className="text-xs">{total}</strong>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
      <div className="absolute -left-2 top-1/4 hidden rounded-2xl border border-white/10 bg-[#111536]/90 p-3.5 shadow-2xl backdrop-blur sm:block lg:-left-8">
        <div className="flex items-center gap-3">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-emerald-400/15 text-emerald-300">
            ✓
          </span>
          <span>
            <strong className="block text-xs">Pago aprobado</strong>
            <span className="text-[10px] text-white/40">
              Hace unos segundos
            </span>
          </span>
        </div>
      </div>
      <div className="absolute -bottom-1 right-2 rounded-2xl border border-white/10 bg-[#111536]/90 px-4 py-3 shadow-2xl backdrop-blur sm:right-8">
        <p className="text-[10px] text-white/40">Stock sincronizado</p>
        <p className="mt-1 text-sm font-semibold text-blue-300">Carta disponible</p>
      </div>
    </div>
  );
}

function Metric({
  label,
  value,
  change,
}: {
  label: string;
  value: string;
  change: string;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[.035] p-4">
      <p className="text-[10px] uppercase tracking-wider text-white/35">
        {label}
      </p>
      <div className="mt-3 flex items-end justify-between gap-2">
        <strong className="text-lg sm:text-xl">{value}</strong>
        <span className="text-[10px] font-semibold text-emerald-300">
          {change}
        </span>
      </div>
    </div>
  );
}
