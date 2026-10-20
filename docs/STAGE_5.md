# Etapa 5 — Reservas

## Alcance implementado

- Agenda semanal por sucursal, con apertura, cierre y días deshabilitados.
- Disponibilidad calculada por horario, duración, capacidad de mesa y zona horaria IANA de la sucursal.
- Flujo público de hold, confirmación y cancelación mediante token secreto.
- Flujo operativo de confirmación, cancelación, no-show, ingreso a mesa y finalización.
- Vencimiento automático de holds mediante temporizador inmediato y barrido periódico de recuperación.
- Actualización del panel en tiempo real con Socket.IO y reconstrucción del estado desde PostgreSQL.
- Historial auditable de todos los cambios de estado.

## Prevención de reservas duplicadas

La garantía final vive en PostgreSQL. La restricción de exclusión `Reservation_no_overlapping_active_ranges` impide que una misma mesa tenga rangos solapados en estado `HOLD`, `CONFIRMED` o `SEATED`. La API puede recibir solicitudes concurrentes desde procesos distintos: una obtiene la mesa y la otra prueba otra mesa compatible o responde `409`.

Los rangos usan semántica `[inicio, fin)`, por lo que una reserva puede comenzar exactamente cuando termina la anterior. Los holds vencidos pasan a `EXPIRED`, liberando la restricción sin borrar historial.

## Zona horaria

El cliente envía fecha y hora locales, nunca un offset supuesto. El servidor las transforma a UTC usando `Branch.timezone`, valida horarios inexistentes por cambios DST y devuelve instantes ISO. La agenda diaria vuelve a convertirlos usando la zona de la sucursal. Los límites de día también se calculan en esa zona y no con medianoche UTC.

## API pública

- `GET /api/reservations/:tenantSlug/:branchSlug/availability`
- `POST /api/reservations/:tenantSlug/:branchSlug/holds`
- `GET /api/reservations/:tenantSlug/:branchSlug/:reservationId`
- `POST /api/reservations/:tenantSlug/:branchSlug/:reservationId/confirm`
- `POST /api/reservations/:tenantSlug/:branchSlug/:reservationId/cancel`

## API operativa

- `GET /api/admin/reservations/overview`
- `GET /api/admin/reservations/availability`
- `POST /api/admin/reservations/holds`
- `PATCH /api/admin/reservations/:reservationId/status`
- `PUT /api/admin/reservations/schedules`

## Interfaces

- Agenda: `/admin?tab=reservations`.
- Reserva pública: `/reservas/:restaurantSlug/:branchSlug`.
- La carta digital enlaza directamente al formulario público de su sucursal.

## Validación automatizada

1. Dos requests concurrentes para una única mesa/rango producen un `201` y un `409`.
2. Un hold de prueba vence por temporizador sin que otra petición dispare la limpieza.
3. Horarios y capacidad filtran correctamente las mesas.
4. Confirmaciones, cancelaciones y no-show quedan auditados.
5. Una hora local que cae en el día UTC siguiente conserva la fecha y hora local correctas.
6. La agenda permanece aislada por tenant y sucursal.
