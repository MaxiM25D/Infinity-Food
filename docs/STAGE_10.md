# Etapa 10 — Reservas y fidelización

## Alcance implementado

- Política de reservas por sucursal: anticipación del recordatorio, límite de cancelación y seña fija o por persona.
- Confirmación y recordatorio persistidos en la cola de notificaciones, con unicidad por reserva y evento.
- Excepciones de agenda para cierres, feriados y horarios especiales.
- Lista de espera pública idempotente y ofertas de mesa con hold limitado.
- Registro idempotente de señas manuales y confirmación automática de la reserva.
- Resolución de señas como reintegradas o retenidas según la política al cancelar.
- Reasignación de mesa con control de capacidad, sucursal y exclusión de solapamientos en PostgreSQL.
- Autogestión pública mediante token secreto para retomar, confirmar o cancelar.
- Cliente unificado por email, historial de pedidos y reservas, visitas, no-shows y segmento básico.

## Mapa de cambios

### Base de datos

- `packages/database/prisma/schema.prisma`: `ReservationPolicy`, `ReservationScheduleException`, `ReservationDeposit`, `ReservationWaitlistEntry`, estados de seña/lista de espera, vínculo `Reservation.customerId` y notificaciones de reserva.
- `packages/database/prisma/migrations/20261022223000_add_reservation_loyalty/migration.sql`: creación de tablas, índices, restricciones únicas y claves foráneas.

### Backend

- `apps/api/src/modules/reservations/schemas.ts`: validación de políticas, excepciones, señas, lista de espera, ofertas y reasignaciones.
- `apps/api/src/modules/reservations/routes.ts`: API pública y administrativa de la etapa.
- `apps/api/src/services/reservations.ts`: disponibilidad con excepciones, cliente unificado, señas, política de cancelación, recordatorios y cambios de estado.
- `apps/api/src/services/notifications.ts`: eventos de confirmación, recordatorio y oferta con deduplicación.
- `apps/api/src/modules/admin/routes.ts`: historial unificado y segmentación `NEW`, `REGULAR`, `VIP` o `AT_RISK`.

### Web

- `apps/web/src/components/admin/reservations-view.tsx`: política, feriados, lista de espera, señas y reasignación.
- `apps/web/src/components/reservations/reservation-booking.tsx`: reserva pública, recuperación por token, seña pendiente, cancelación y lista de espera.
- `apps/web/src/components/admin/customers-view.tsx`: actividad, segmento e historial de reservas.
- `apps/web/src/components/admin/types.ts`: contratos del historial unificado.

### Pruebas y seguimiento

- `apps/api/test/reservations-loyalty.test.ts`: política, excepción, seña, idempotencia, recordatorios, lista de espera, cliente y reasignación.
- `e2e/critical-flow.spec.ts`: presencia del módulo en el recorrido operativo crítico.
- `docs/ROADMAP.md`, `docs/STAGE_10.md` y `README.md`: cierre y guía de uso.

## Rutas principales

- `GET /api/reservations/:tenantSlug/:branchSlug/availability`
- `POST /api/reservations/:tenantSlug/:branchSlug/holds`
- `POST /api/reservations/:tenantSlug/:branchSlug/waitlist`
- `GET /api/reservations/:tenantSlug/:branchSlug/:reservationId`
- `POST /api/reservations/:tenantSlug/:branchSlug/:reservationId/confirm`
- `POST /api/reservations/:tenantSlug/:branchSlug/:reservationId/cancel`
- `GET /api/admin/reservations/overview`
- `PUT /api/admin/reservations/policy`
- `PUT|DELETE /api/admin/reservations/exceptions[/id]`
- `POST /api/admin/reservations/:reservationId/deposits`
- `PATCH /api/admin/reservations/:reservationId/table`
- `POST /api/admin/reservations/waitlist/:id/offer`

## Consistencia y seguridad

El tenant y la sucursal se obtienen de la sesión administrativa o de slugs públicos validados. Las mutaciones administrativas respetan roles y suscripción escribible. Los tokens públicos solo se guardan hasheados. Señas y altas en espera usan UUID de idempotencia; las notificaciones tienen unicidad por reserva/evento. La exclusión de rangos activa de PostgreSQL sigue siendo la autoridad contra reservas simultáneas. Los pagos de señas pertenecen a reservas y permanecen separados tanto de `OrderPayment` como de la facturación SaaS.

## Cómo verlo

1. Ejecutar `pnpm dev`.
2. Abrir `http://localhost:3000/admin?tab=reservations` para configurar política, cierres, lista de espera y señas.
3. Abrir `http://localhost:3000/reservas/{restaurantSlug}/{branchSlug}` para probar la reserva pública.
4. Abrir `http://localhost:3000/admin?tab=customers` para ver segmento e historial unificado.

## Validación reproducible

```powershell
pnpm db:generate
pnpm db:deploy
pnpm --filter @infinityshop/api exec tsx --test --test-concurrency=1 test/reservations-loyalty.test.ts
pnpm check
pnpm test:e2e
```

## Límites deliberados

Las señas de esta etapa se registran desde administración; el cobro automático con Mercado Pago y sus webhooks pertenece a la Etapa 11. La segmentación usa reglas transparentes y no un motor de campañas. Los recordatorios reutilizan la cola persistente actual; su extracción a workers y coordinación con Redis queda para la Etapa 12 si la carga lo justifica.
