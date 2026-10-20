# Etapa 1 — Base del monorepo y contexto gastronómico

## Alcance implementado

- Monorepo administrado con pnpm Workspaces y Turborepo.
- Aplicaciones existentes conservadas en `apps/web` y `apps/api`.
- Prisma y PostgreSQL conservados en `packages/database`.
- Contratos mínimos de roles y contexto en `packages/contracts`.
- Entidades iniciales `Branch`, `MembershipBranch`, `Sector` y `RestaurantTable`.
- Todos los pedidos quedan asociados obligatoriamente a una sucursal.
- Cada tenant existente o nuevo dispone de una sucursal principal.
- La sesión guarda `activeTenantId` y `activeBranchId`; ambos forman una referencia válida a `Branch`.
- Roles globales `OWNER`, `ADMIN` y `STAFF`, más roles operativos por sucursal.
- API de administración de sucursales y asignaciones de personal.
- Selector de sucursal autenticado con autorización del lado servidor.
- Pedidos visibles por `STAFF` y ventas locales filtrados por la sucursal activa.
- CI, imágenes Docker y comandos de Railway migrados a pnpm.

## Compatibilidad deliberada

Los scopes internos `@infinityshop/*`, el nombre histórico de la cookie y algunos identificadores operativos se mantienen en esta etapa. Renombrarlos no aporta aislamiento ni dominio gastronómico y podría invalidar sesiones, cachés o integraciones. El paquete nuevo de contratos usa el scope `@infinityfood/contracts` y permite una migración gradual.

## Límites de esta etapa

- El catálogo y el inventario todavía son compartidos por restaurante.
- La sucursal pública inicial es la principal; la carta QR por sucursal se implementará después.
- No se incorporaron aún comandas, KDS, reservas, caja ni tiempo real.
- La selección de sucursal está disponible en la API; su selector visual pertenece a la siguiente evolución de interfaz.

## Validación

La etapa se considera válida cuando:

1. Las migraciones se aplican sobre una base vacía y sobre el esquema anterior.
2. `pnpm typecheck`, `pnpm lint`, `pnpm build` y `pnpm test` finalizan correctamente.
3. PostgreSQL rechaza pedidos vinculados a sucursales de otro tenant.
4. Un `STAFF` no puede seleccionar ni consultar pedidos de una sucursal no asignada.
5. Las imágenes Docker de API y web se construyen desde el lockfile de pnpm.
