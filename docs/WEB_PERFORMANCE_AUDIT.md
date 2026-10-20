# Auditoría web de InfinityFood

Fecha: 7 de septiembre de 2026.

## Entorno medido

- Build local de producción de Next.js.
- Vista móvil: 390 × 844, DPR 3.
- CPU: desaceleración 4×.
- Red: Fast 4G.
- Página: home de InfinityFood.

## Resultados

| Métrica | Resultado | Evaluación |
| --- | ---: | --- |
| LCP | 545 ms | Bueno |
| CLS | 0.00 | Bueno |
| INP | Sin dato | Requiere interacción y medición en producción |
| Lighthouse: accesibilidad | 100/100 | Correcto |
| Lighthouse: buenas prácticas | 100/100 | Correcto |
| Lighthouse: SEO | 100/100 | Correcto |
| Lighthouse: navegación asistida | 100/100 | Correcto |

No hay información CrUX porque la medición se realizó en localhost.

## Correcciones aplicadas durante la auditoría

- El enlace del logo compacto ahora tiene un nombre accesible.
- Solo el logo visible inicialmente se precarga; el logo del footer se carga normalmente.
- Las imágenes de marca declaran dimensiones y relación de aspecto.
- La numeración del checkout es consecutiva aunque una tienda no tenga métodos de envío.

## Smoke test

Respondieron correctamente: home, login, tienda demo, catálogo, producto, carrito, checkout, robots, sitemap, health, readiness y storefront API. El navegador terminó sin mensajes de consola.

## Pendiente después del deploy

Repetir la auditoría sobre `https://infinityfood.com.ar` para incorporar la latencia real de Railway, Cloudflare, API, Cloudinary y datos CrUX cuando estén disponibles.
