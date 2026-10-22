# Etapa 8 — Operación gastronómica avanzada

## Alcance implementado

- Modificadores y extras configurables por plato y sucursal, con mínimo, máximo, orden, disponibilidad y precio adicional.
- Snapshot de nombre y precio del modificador en cada ítem para conservar el historial aunque la carta cambie.
- Notas y punto de cocción por ítem, visibles en el KDS.
- Unión y separación de mesas con exclusión de una mesa en más de una unión activa.
- Transferencia idempotente de pedidos entre mesas de la misma sucursal.
- Propinas, descuentos y cortesías con motivo, autor, UUID idempotente y auditoría.
- División y asignación de cobros por importe, ítem o comensal.
- Cola persistente de impresión para comandas de cocina y tickets de caja, con toma atómica, intentos y resultado.

## Interfaces

- **Carta:** configuración de grupos y opciones desde cada plato.
- **Pedido QR:** selección de extras, validación de reglas, notas y punto de cocción.
- **KDS:** muestra modificadores y punto junto al ítem.
- **Operación avanzada:** unión/separación, transferencia, ajustes, cuenta dividida y cola de impresión.

## Mapa de cambios

### Base de datos

- `packages/database/prisma/schema.prisma`: enums, relaciones y modelos de operación avanzada.
- `packages/database/prisma/migrations/20261020220000_add_advanced_dining_operations/migration.sql`: creación de tablas, índices y claves foráneas.
- `packages/database/prisma/migrations/20261020221000_allow_modifier_history_cleanup/migration.sql`: conserva snapshots al reemplazar opciones de la carta.

### Backend

- `apps/api/src/services/advanced-dining.ts`: modificadores, grupos de mesas, transferencias, ajustes e impresión.
- `apps/api/src/modules/advanced/routes.ts`: endpoints protegidos bajo `/api/admin/advanced`.
- `apps/api/src/modules/advanced/schemas.ts`: validación estricta de entradas.
- `apps/api/src/services/dining-orders.ts`: validación de extras, cálculo de precios, snapshots, punto de cocción y trabajos de cocina.
- `apps/api/src/services/pos.ts`: asignaciones de pagos por ítem o comensal.
- `apps/api/src/modules/dining/*`, `menu/routes.ts` y `pos/*`: exposición controlada de los datos nuevos.
- `apps/api/src/app.ts`: montaje del módulo avanzado.

### Web

- `apps/web/src/components/dining/table-order.tsx`: extras, reglas, notas y punto de cocción en el pedido QR.
- `apps/web/src/components/kds/kds-board.tsx`: detalles de preparación y modificadores en cocina/barra.
- `apps/web/src/components/admin/menu-view.tsx`: editor de grupos y opciones por plato.
- `apps/web/src/components/admin/advanced-view.tsx`: mesas, transferencias, ajustes, división de cuenta e impresión.
- `apps/web/src/components/admin/admin-panel.tsx` y `apps/web/src/app/admin/page.tsx`: acceso a la nueva sección del panel.

### Pruebas y seguimiento

- `apps/api/test/advanced-dining.test.ts`: pruebas funcionales y de aislamiento de la etapa.
- `apps/api/package.json`: inclusión de la suite en la regresión completa.
- `docs/ROADMAP.md`, `docs/STAGE_8.md` y `README.md`: estado, alcance y guía de uso.

### Rutas principales

- `PUT /api/admin/advanced/menu-items/:productId/modifiers`
- `POST|DELETE /api/admin/advanced/table-groups[/:groupId]`
- `PATCH /api/admin/advanced/orders/:orderId/table`
- `POST /api/admin/advanced/orders/:orderId/adjustments`
- `POST /api/admin/advanced/orders/:orderId/print`
- `GET /api/admin/advanced/print-jobs`
- `POST /api/admin/advanced/print-jobs/:jobId/claim`
- `POST /api/admin/advanced/print-jobs/:jobId/complete`

## Seguridad y consistencia

Todas las consultas operativas se filtran con el `tenantId` y `branchId` de la sesión. Los identificadores enviados por el navegador se vuelven a validar contra ese contexto. Las transferencias, ajustes, cobros e impresiones usan claves idempotentes; los cambios de saldo y la toma de trabajos se realizan de forma atómica.

La suscripción del restaurante al SaaS continúa en `Subscription`/`BillingInvoice`. Los cobros de los comensales permanecen en `OrderPayment`/`CashRegisterSession`; esta etapa no mezcla ambos circuitos.

## Modelo agregado

- `MenuModifierGroup` y `MenuModifierOption` definen la carta por sucursal.
- `OrderItemModifier` conserva el snapshot vendido.
- `OrderAdjustment` registra propina, descuento o cortesía.
- `OrderPaymentAllocation` asigna cada parte cobrada.
- `DiningTableGroup` y `DiningTableGroupMember` representan uniones temporales.
- `PrintJob` persiste la cola de cocina y caja.

## Validación reproducible

```powershell
pnpm db:generate
pnpm db:deploy
pnpm --filter @infinityshop/database build
node --import tsx --test --test-concurrency=1 test/advanced-dining.test.ts
```

El último comando se ejecuta desde `apps/api`. Cubre reglas y snapshots de modificadores, unión/separación, transferencia idempotente, ajustes, asignaciones de pago, límites de saldo, impresión idempotente y aislamiento entre sucursales.

## Límite deliberado

La cola y el protocolo de agente están completos, pero la conexión con un modelo físico específico de impresora queda desacoplada. Un agente local puede consultar la cola, tomar un trabajo y confirmar `PRINTED` o `FAILED`; la traducción a ESC/POS depende del hardware y sistema operativo del restaurante.
