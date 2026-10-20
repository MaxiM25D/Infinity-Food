# Etapa 3 — Pedidos, comandas y KDS

## Alcance implementado

- Pedido público desde el QR único de cada mesa en `/mesa/:restaurantSlug/:branchSlug/:tableCode`.
- Apertura de pedidos y envío de nuevas rondas por personal con rol `WAITER` o `MANAGER`.
- Rondas inmutables con `clientRequestId` idempotente por tenant.
- Una comanda genera un ticket por cada estación distinta involucrada, no uno por plato.
- Estaciones configurables (`KITCHEN`, `BAR`, `DESSERT`, `OTHER`) y asignación de cada plato por sucursal.
- KDS separado en `/kds`, con estados `PENDING`, `PREPARING`, `READY`, `SERVED` y `CANCELLED`.
- Tiempos de inicio, listo y entrega persistidos en PostgreSQL.
- Auditoría de apertura, rondas, creación de tickets y transiciones, con eventos idempotentes.
- Actualizaciones en tiempo real mediante Socket.IO y recuperación completa desde PostgreSQL al conectar o reconectar.

## Consistencia e idempotencia

La creación del pedido y de su primera ronda ocurre en una única transacción serializable. Cada ronda tiene una restricción única `(tenantId, clientRequestId)` y cada ticket otra `(tenantId, roundId, stationId)`. Un reintento con el mismo UUID devuelve el pedido existente y no crea filas adicionales.

El número de pedido se asigna bajo un advisory lock transaccional por tenant. Los productos, precios, disponibilidad y estación se vuelven a resolver dentro de la transacción; el navegador nunca decide el precio ni el destino del ticket.

## Seguridad

- El pedido QR resuelve restaurante, sucursal y mesa activos por slugs/código; no acepta `tenantId` ni `branchId`.
- El token del pedido se deriva del UUID secreto generado en el navegador y solo su hash se guarda en PostgreSQL.
- Los pedidos de mozo siempre utilizan la sucursal activa de la sesión.
- `OWNER`, `ADMIN` y `MANAGER` pueden supervisar todas las estaciones de la sucursal.
- El personal `KITCHEN` debe tener una `stationId` explícita y solo puede consultar, actualizar o suscribirse por Socket.IO a esa estación.
- Las relaciones compuestas impiden mezclar tenant, sucursal, mesa, estación, ronda, ticket y plato.

## Tiempo real y reconexión

Socket.IO transporta únicamente avisos de cambio. PostgreSQL es la fuente de verdad: después de conectar, reconectar o recibir un evento, el KDS consulta nuevamente `GET /api/admin/dining/kds/:stationId/tickets`. Un corte o un evento perdido no deja el tablero inconsistente.

Esta etapa no requiere Redis mientras exista una sola instancia de API. Para escalar horizontalmente se debe incorporar el adapter Redis de Socket.IO; Redis no reemplaza la persistencia de tickets ni la auditoría.

## Límites deliberados

- El inventario continúa siendo global al restaurante.
- Propinas, división por comensal y reservas quedan fuera de esta etapa. Caja y cobros se incorporan en la Etapa 4.
- La operación multi-instancia de Socket.IO requiere Redis antes de escalar la API a más de una réplica.

## Criterios de validación

1. Una ronda con platos de Cocina y Barra crea exactamente dos tickets.
2. Repetir el mismo `clientRequestId` conserva una ronda y dos tickets.
3. Un usuario `KITCHEN` solo lista y opera su sucursal y estación asignadas.
4. El snapshot REST reconstruye los tickets activos sin depender de memoria del WebSocket.
5. Repetir un `eventId` no duplica la auditoría.
6. Las migraciones y el seed se ejecutan desde una base vacía.
7. Typecheck, lint, build, tests e imágenes Docker finalizan correctamente.
