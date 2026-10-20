"use client";

import Link from "next/link";
import {
  ArrowRight,
  Check,
  ShoppingBag,
  Sparkles,
} from "lucide-react";
import { useEffect, useState } from "react";

import { ApiError, apiRequest } from "@/lib/api";
import { BrandLogo } from "@/components/brand-logo";
import { useCart } from "./cart-context";
import { formatMoney, ProductImage, StorefrontShell } from "./storefront-shell";
import type { PublicStore, StorefrontProduct } from "./types";

const emptyProducts: StorefrontProduct[] = [];

export function CatalogPage({ slug }: { slug: string }) {
  const [store, setStore] = useState<PublicStore | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    apiRequest<{ store: PublicStore }>(`/storefront/${slug}`)
      .then(({ store }) => {
        if (active) setStore(store);
      })
      .catch((caught) => {
        if (active)
          setError(
            caught instanceof ApiError
              ? caught.message
              : "No pudimos abrir esta tienda",
          );
      });
    return () => {
      active = false;
    };
  }, [slug]);

  if (error) return <StorefrontError message={error} />;
  if (!store) return <StorefrontLoading />;

  return (
    <StorefrontShell store={store}>
      <Catalog store={store} />
    </StorefrontShell>
  );
}

function Catalog({ store }: { store: PublicStore }) {
  const products = store.products ?? emptyProducts;
  const primaryColor = store.settings?.primaryColor ?? "#9A6B43";
  const featuredProducts = products.filter((product) => product.featured).slice(0, 4);
  const recentProducts = products.filter((product) => !product.featured).slice(0, 8);
  const homeProducts = recentProducts.length > 0 ? recentProducts : products.slice(0, 8);

  return (
    <main>
      <section className="relative overflow-hidden bg-[#171417] text-white">
        {store.settings?.bannerUrl && (
          <div
            className="absolute inset-0 bg-cover bg-center opacity-45"
            style={{ backgroundImage: `url(${store.settings.bannerUrl})` }}
          />
        )}
        <div className="absolute inset-0 bg-gradient-to-r from-black/90 via-black/60 to-black/15" />
        <div className="relative mx-auto flex min-h-[34rem] max-w-7xl items-end px-5 py-16 sm:px-6 sm:py-20 lg:px-8">
          <div className="max-w-2xl">
          <p className="mb-5 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3.5 py-2 text-[10px] font-bold uppercase tracking-[0.2em] text-white/75 backdrop-blur">
            <Sparkles size={13} /> Tienda oficial
          </p>
          <h1 className="text-4xl font-semibold tracking-[-0.05em] sm:text-6xl lg:text-7xl">
            Encontrá eso que estabas buscando.
          </h1>
          <p className="mt-6 max-w-xl text-base leading-7 text-white/70 sm:text-lg">
            {store.settings?.description ||
              `Descubrí la selección de ${store.name} y comprá de forma simple y segura.`}
          </p>
          <a
            className="mt-9 inline-flex items-center gap-2 rounded-full px-6 py-3.5 text-sm font-bold text-white transition hover:-translate-y-0.5 hover:brightness-110"
            href={`/tienda/${store.slug}/productos`}
            style={{ backgroundColor: primaryColor }}
          >
            Ver productos <ArrowRight size={16} />
          </a>
          </div>
        </div>
      </section>

      <section className="border-b border-stone-200 bg-white">
        <div className="mx-auto grid max-w-7xl divide-y divide-stone-100 px-5 sm:grid-cols-3 sm:divide-x sm:divide-y-0 sm:px-6 lg:px-8">
          {["Compra simple y segura", "Stock actualizado", "Atención directa de la tienda"].map((benefit) => (
            <div className="flex items-center justify-center gap-2.5 py-4 text-xs font-semibold text-stone-600 sm:py-5" key={benefit}>
              <Check size={15} style={{ color: primaryColor }} /> {benefit}
            </div>
          ))}
        </div>
      </section>

      {featuredProducts.length > 0 && (
        <section className="mx-auto max-w-7xl px-5 pt-14 sm:px-6 sm:pt-20 lg:px-8">
          <p className="text-xs font-bold uppercase tracking-[0.2em]" style={{ color: primaryColor }}>Selección especial</p>
          <div className="mt-3 flex items-end justify-between gap-4">
            <h2 className="text-3xl font-semibold tracking-[-0.035em] sm:text-4xl">Favoritos de la tienda</h2>
            <Link className="hidden items-center gap-1.5 text-sm font-semibold sm:flex" href={`/tienda/${store.slug}/productos`}>Ver todo <ArrowRight size={15} /></Link>
          </div>
          <div className="mt-7 grid grid-cols-2 gap-4 lg:grid-cols-4">
            {featuredProducts.map((product) => (
              <ProductCard currency={store.settings?.currency ?? "ARS"} key={product.id} primaryColor={primaryColor} product={product} storeSlug={store.slug} />
            ))}
          </div>
        </section>
      )}

      {(store.categories ?? []).length > 0 && (
        <section className="mx-auto max-w-7xl px-5 pt-14 sm:px-6 sm:pt-20 lg:px-8">
          <p className="text-xs font-bold uppercase tracking-[0.2em]" style={{ color: primaryColor }}>Explorá por categoría</p>
          <h2 className="mt-3 text-3xl font-semibold tracking-[-0.035em] sm:text-4xl">Encontrá más rápido</h2>
          <div className="mt-7 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {(store.categories ?? []).slice(0, 6).map((item, index) => (
              <Link
                className="group flex min-h-28 items-end justify-between rounded-[var(--store-radius)] border border-stone-200 bg-white p-5 transition hover:-translate-y-0.5 hover:shadow-lg"
                href={`/tienda/${store.slug}/categoria/${item.slug}`}
                key={item.id}
              >
                <span><span className="block text-[10px] font-bold uppercase tracking-[0.16em] text-stone-400">0{index + 1}</span><strong className="mt-2 block text-lg">{item.name}</strong><span className="mt-1 block text-xs text-stone-400">{item._count.products} productos</span></span>
                <span className="grid h-9 w-9 place-items-center rounded-full bg-stone-100 transition group-hover:text-white" style={{ color: primaryColor }}><ArrowRight size={16} /></span>
              </Link>
            ))}
          </div>
        </section>
      )}

      <section className="mx-auto max-w-7xl px-5 py-14 sm:px-6 sm:py-20 lg:px-8">
        <div className="flex items-end justify-between gap-5">
          <div>
            <p
              className="text-xs font-bold uppercase tracking-[0.22em]"
              style={{ color: primaryColor }}
            >
              Recién llegados
            </p>
            <h2 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">
              Lo nuevo en {store.name}
            </h2>
          </div>
          <Link className="hidden items-center gap-2 rounded-full border border-stone-200 bg-white px-5 py-3 text-sm font-semibold transition hover:border-stone-400 sm:flex" href={`/tienda/${store.slug}/productos`}>Catálogo completo <ArrowRight size={15} /></Link>
        </div>

        {homeProducts.length === 0 ? (
          <div className="mt-8 rounded-3xl border border-dashed border-stone-300 py-24 text-center">
            <p className="text-lg font-semibold">No encontramos productos</p>
            <p className="mt-2 text-sm text-stone-400">
              Probá otra categoría o búsqueda.
            </p>
          </div>
        ) : (
          <div className="mt-8 grid grid-cols-2 gap-x-3 gap-y-8 sm:gap-x-5 lg:grid-cols-3 xl:grid-cols-4">
            {homeProducts.map((product) => (
              <ProductCard
                currency={store.settings?.currency ?? "ARS"}
                key={product.id}
                primaryColor={primaryColor}
                product={product}
                storeSlug={store.slug}
              />
            ))}
          </div>
        )}
        <Link className="mt-8 flex w-full items-center justify-center gap-2 rounded-full border border-stone-300 bg-white px-5 py-3.5 text-sm font-bold sm:hidden" href={`/tienda/${store.slug}/productos`}>Ver catálogo completo <ArrowRight size={16} /></Link>
      </section>
    </main>
  );
}

export function ProductCard({
  currency,
  product,
  primaryColor,
  storeSlug,
}: {
  currency: string;
  product: StorefrontProduct;
  primaryColor: string;
  storeSlug: string;
}) {
  const { addItem } = useCart();
  return (
    <article className="group min-w-0 rounded-[var(--store-radius)] border border-stone-200/80 bg-white p-2.5 shadow-[0_10px_35px_rgba(28,20,28,0.04)] transition duration-300 hover:-translate-y-1 hover:shadow-[0_18px_45px_rgba(28,20,28,0.10)] sm:p-3">
      <Link
        className="block"
        href={`/tienda/${storeSlug}/producto/${product.slug}`}
      >
        <div className="relative overflow-hidden rounded-[calc(var(--store-radius)*.8)]">
          <ProductImage
            className="aspect-[4/5] w-full transition duration-500 group-hover:scale-[1.025]"
            image={product.images[0]}
            name={product.name}
          />
          {product.stock === 0 && (
            <span className="absolute left-3 top-3 rounded-full bg-white px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider">
              Sin stock
            </span>
          )}
          {product.featured && product.stock > 0 && (
            <span className="absolute left-3 top-3 rounded-full bg-stone-950 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-white">
              Destacado
            </span>
          )}
        </div>
        <p className="mt-4 truncate px-1 text-sm font-semibold sm:text-base">
          {product.name}
        </p>
        <p className="mt-1 px-1 text-sm font-bold" style={{ color: primaryColor }}>
          {formatMoney(product.priceInCents, currency)}
        </p>
      </Link>
      {product.variants.length > 0 ? (
        <Link
          className="mt-3 block w-full rounded-full border border-stone-300 px-3 py-2.5 text-center text-xs font-bold transition hover:bg-stone-50"
          href={`/tienda/${storeSlug}/producto/${product.slug}`}
        >
          Elegir variante
        </Link>
      ) : (
        <button
          className="mt-3 flex w-full items-center justify-center gap-2 rounded-full border px-3 py-2.5 text-xs font-bold transition hover:text-white disabled:cursor-not-allowed disabled:border-stone-200 disabled:bg-stone-100 disabled:text-stone-400"
          disabled={product.stock === 0}
          onClick={() => addItem(product)}
          onMouseEnter={(event) => {
            if (product.stock > 0) {
              event.currentTarget.style.backgroundColor = primaryColor;
              event.currentTarget.style.color = "white";
            }
          }}
          onMouseLeave={(event) => {
            event.currentTarget.style.backgroundColor = "transparent";
            event.currentTarget.style.color = primaryColor;
          }}
          style={{ borderColor: product.stock > 0 ? primaryColor : undefined, color: product.stock > 0 ? primaryColor : undefined }}
          type="button"
        >
          {product.stock > 0 ? <><ShoppingBag size={14} /> Agregar</> : "No disponible"}
        </button>
      )}
    </article>
  );
}

export function StorefrontLoading() {
  return (
    <main className="min-h-screen bg-[#fbfaf7]">
      <div className="h-18 border-b border-stone-200 bg-white" />
      <div className="h-[28rem] animate-pulse bg-stone-900" />
      <div className="mx-auto grid max-w-7xl grid-cols-2 gap-5 px-5 py-16 lg:grid-cols-4">
        {[1, 2, 3, 4].map((item) => (
          <div
            className="aspect-[4/5] animate-pulse rounded-3xl bg-stone-200"
            key={item}
          />
        ))}
      </div>
    </main>
  );
}

export function StorefrontError({ message }: { message: string }) {
  return (
    <main className="grid min-h-screen place-items-center bg-[#fbfaf7] px-6 text-center">
      <div>
        <div className="flex justify-center"><BrandLogo tone="light" /></div>
        <h1 className="mt-6 text-3xl font-semibold">
          No pudimos cargar esta página
        </h1>
        <p className="mt-3 text-stone-500">{message}</p>
        <button type="button" className="mt-5 block w-full text-sm font-semibold underline" onClick={() => window.location.reload()}>Volver a intentar</button>
        <Link
          className="mt-7 inline-block rounded-full bg-stone-950 px-6 py-3 text-sm font-semibold text-white"
          href="/"
        >
          Volver a InfinityFood
        </Link>
      </div>
    </main>
  );
}
