# Etapa 9 — Inventario y costos

## Alcance implementado

- Ingredientes en unidades base (`GRAM`, `MILLILITER`, `UNIT`) y recetas por producto.
- Depósitos y existencias separados por tenant, sucursal y ubicación.
- Consumo automático y atómico al generar pedidos QR, por mozo o POS.
- Reversión idempotente de ingredientes al anular una venta local.
- Ajustes, mermas y transferencias con trazabilidad e idempotencia.
- Costo promedio ponderado, costo de receta, margen estimado y alertas de reposición.
- Proveedores, órdenes de compra y recepciones parciales o completas.
- Pantalla administrativa única para stock, recetas, costos, compras y movimientos.

Las cantidades se guardan como enteros en unidad base para evitar errores de coma flotante. Los costos usan centavos por cada 1.000 unidades base, lo que permite costear fracciones de gramos o mililitros sin usar redondeos monetarios prematuros.

## Mapa de cambios

### Base de datos

- `packages/database/prisma/schema.prisma`: modelos `InventoryLocation`, `Ingredient`, `IngredientStock`, `RecipeIngredient`, `IngredientMovement`, `Supplier`, `PurchaseOrder`, `PurchaseOrderItem`, `PurchaseReceipt` y `PurchaseReceiptItem`; enums y relaciones.
- `packages/database/prisma/migrations/20261022205831_add_inventory_costs/migration.sql`: tablas, índices, claves foráneas, depósito principal para sucursales existentes y unicidad del depósito predeterminado.

### Backend

- `apps/api/src/services/inventory.ts`: depósito predeterminado, consumo de recetas y reversión por anulación.
- `apps/api/src/modules/inventory/schemas.ts`: contratos Zod para ingredientes, stock, recetas, compras, mermas y transferencias.
- `apps/api/src/modules/inventory/routes.ts`: API administrativa bajo `/api/admin/inventory`.
- `apps/api/src/services/dining-orders.ts`: consumo de receta dentro de la transacción que crea ronda, ítems y tickets.
- `apps/api/src/modules/management/routes.ts`: consumo en venta local y reposición al anular.
- `apps/api/src/modules/auth/routes.ts` y `apps/api/src/modules/branches/routes.ts`: creación del depósito principal para restaurantes y sucursales nuevas.
- `apps/api/src/app.ts`: montaje del router de inventario.

### Web

- `apps/web/src/components/admin/inventory-view.tsx`: existencias, alertas, ajustes, mermas, recetas, márgenes, proveedores, compras, recepciones y trazabilidad.
- `apps/web/src/components/admin/admin-panel.tsx`: opción **Inventario** en Operación.
- `apps/web/src/app/admin/page.tsx`: soporte de `?tab=inventory`.

### Pruebas y seguimiento

- `apps/api/test/inventory-costs.test.ts`: recepción e idempotencia, costos, consumo por pedido, rollback por faltante, merma, transferencias y aislamiento.
- `apps/api/package.json`: inclusión de la suite en la regresión completa.
- `docs/ROADMAP.md`, `docs/STAGE_9.md` y `README.md`: estado y guía de uso.

### Rutas principales

- `GET /api/admin/inventory/overview`
- `POST /api/admin/inventory/locations`
- `POST /api/admin/inventory/ingredients`
- `PUT /api/admin/inventory/ingredients/:ingredientId/stocks/:locationId`
- `POST /api/admin/inventory/ingredients/:ingredientId/waste`
- `POST /api/admin/inventory/transfers`
- `PUT /api/admin/inventory/recipes/:productId`
- `POST /api/admin/inventory/suppliers`
- `POST /api/admin/inventory/purchase-orders`
- `POST /api/admin/inventory/purchase-orders/:id/receipts`

## Seguridad y consistencia

El tenant y la sucursal siempre provienen de la sesión, no del cuerpo de la solicitud. La API requiere propietario, administrador o rol de sucursal `MANAGER`, y bloquea mutaciones cuando la suscripción no admite escritura. Las existencias se bloquean dentro de transacciones serializables; consumo, pedido, tickets y auditoría se confirman o revierten juntos.

Las mermas, transferencias, recepciones y consumos automáticos poseen claves idempotentes. Una repetición no genera movimientos ni cantidades dobles. Los pagos de comensales y las suscripciones SaaS no fueron modificados.

## Cómo verlo

1. Ejecutar `pnpm dev`.
2. Ingresar a `http://localhost:3000/admin?tab=inventory`.
3. Crear ingredientes y cargar existencias/costos.
4. Elegir un producto y guardar su receta.
5. Emitir una orden de compra o generar un pedido desde QR/POS.
6. Actualizar la pantalla y revisar existencias, costo, margen y trazabilidad.

## Validación reproducible

```powershell
pnpm db:generate
pnpm db:deploy
pnpm --filter @infinityshop/api exec tsx --test --test-concurrency=1 test/inventory-costs.test.ts
pnpm check
pnpm test:e2e
```

## Límite deliberado

No se implementa valuación contable/fiscal (FIFO, cierre contable ni impuestos) ni pronóstico automático de compras. El costo promedio es operativo y se calcula con recepciones confirmadas. Lotes, vencimientos y producción previa pueden incorporarse en una etapa posterior si el piloto demuestra que aportan valor.
