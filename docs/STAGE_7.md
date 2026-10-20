# Etapa 7 — Estabilización y piloto productivo

## Objetivo

Convertir las seis etapas funcionales en una línea base segura, versionable y desplegable en un entorno de staging de una sola réplica. Esta etapa prioriza estabilidad sobre nuevas funciones.

## Entregables

### 7.1 Seguridad y baseline

- Dependencias productivas sin vulnerabilidades críticas ni altas conocidas.
- Lockfile de pnpm actualizado y reproducible.
- Suite completa y contenedores validados después de cada actualización sensible.
- Cambios de las etapas 1 a 7 organizados en una rama revisable y un tag de baseline.

### 7.2 Branding

- InfinityFood en textos públicos, metadata, emails y documentación operativa.
- Identificadores internos históricos conservados cuando renombrarlos implique riesgo de sesión, integración o migración.
- Funciones ecommerce clasificadas como canal de delivery, ocultas por feature flag o archivadas.

### 7.3 Cobertura operativa

- E2E de pedido QR hasta KDS.
- E2E de pedido POS, pago parcial y cierre de caja.
- E2E de reserva y actualización operativa.
- Matriz de roles para owner, manager, waiter, kitchen y cashier.

### 7.4 Staging reproducible

- Web, API y PostgreSQL desplegados con una sola réplica de API.
- Correo SMTP capturable, storage persistente y contratos de proveedores externos preparados.
- Métricas protegidas y healthchecks activos.
- Backup automático y restauración ensayada.
- Runbook de despliegue, rollback e incidente.

La certificación de Resend, Cloudinary y Mercado Pago sandbox exige credenciales y dominios externos que no están presentes en el repositorio. El procedimiento quedó documentado para el staging remoto y no se reemplaza por falsos positivos locales.

## Criterios de validación

1. `pnpm audit --prod` no informa vulnerabilidades críticas ni altas.
2. `pnpm check` y `pnpm test:e2e` finalizan correctamente desde una instalación limpia.
3. Las imágenes Docker se construyen usando `pnpm-lock.yaml` sin modificaciones.
4. No quedan referencias visibles a InfinityShop en los recorridos de InfinityFood definidos para el piloto.
5. Los flujos QR, KDS, caja y reservas cuentan con E2E reproducibles.
6. El staging reproducible supera health, readiness, smoke test y restauración de backup.
7. La API permanece en una réplica hasta completar la Etapa 12.

## Avance

- [x] Auditoría inicial de dependencias.
- [x] Actualización de Next.js 16.3.8, Nodemailer 10.1.7 y Prisma 7.10.1.
- [x] Audit productivo limpio de vulnerabilidades conocidas.
- [x] Validación integral posterior a la actualización.
- [x] Baseline Git revisable.
- [x] Branding visible.
- [x] E2E operativos adicionales.
- [x] Staging y runbooks.

## Evidencia de 7.1

- `pnpm audit --prod`: sin vulnerabilidades conocidas.
- `pnpm check`: typecheck, lint, build y 98/98 pruebas aprobadas.
- `pnpm test:e2e`: 1/1 flujo crítico aprobado en Chromium.
- Imágenes `infinityfood-api:stage7` e `infinityfood-web:stage7`: construidas desde `pnpm-lock.yaml` con `--frozen-lockfile`.

## Evidencia de cierre

- Instalación reproducible con `pnpm install --frozen-lockfile`.
- `pnpm audit --prod`: sin vulnerabilidades conocidas.
- `pnpm check`: typecheck, lint, build y 98/98 pruebas aprobadas.
- `pnpm test:e2e`: alta de tenant, carta, mesa QR, idempotencia, KDS, POS, pagos parciales, cierre de caja y reserva confirmada.
- `pnpm staging:up`: PostgreSQL 17, migraciones, API única, web, Mailpit y volúmenes persistentes saludables.
- `pnpm staging:smoke`: health, readiness, métricas protegidas, web y correo aprobados.
- Backup lógico creado y restaurado con `pg_restore --exit-on-error`; Prisma confirmó 31/31 migraciones.
- Rebranding visible aplicado a UI, metadata, emails, dominios de ejemplo y activos; se conservaron scopes, cookies y claves históricas internas para evitar regresiones.
