# Etapa 4 — POS, pagos y caja

## Alcance implementado

- POS gastronómico dentro del panel administrativo, filtrado por la sucursal activa.
- Pedidos de mostrador y mesa que reutilizan rondas, tickets por estación y KDS.
- Cobros parciales en efectivo, tarjeta externa y Mercado Pago.
- Devoluciones explícitas ligadas al cobro original.
- Apertura y cierre de caja, fondo inicial, ingresos y egresos manuales.
- Reconciliación persistida de ventas netas, medios de pago, efectivo esperado, declarado y diferencia.
- Historial de pagos y movimientos con usuario y marca de tiempo.

## Modelo y separación de pagos

`OrderPayment` representa exclusivamente dinero cobrado o devuelto por un restaurante. Cada registro pertenece a un tenant, sucursal, pedido y turno de caja. `CashMovement` registra el efecto físico sobre el efectivo y mantiene una relación uno a uno opcional con el pago que lo originó.

La facturación de InfinityFood permanece en `Subscription`, `BillingInvoice` y `BillingWebhookEvent`. El POS no consulta ni modifica esas tablas. El método `MERCADO_PAGO` de un cobro operativo identifica dinero del cliente destinado al restaurante; nunca se interpreta como pago del plan SaaS.

## Invariantes transaccionales

1. El pedido se bloquea con `FOR UPDATE` antes de calcular su saldo.
2. La suma de pagos menos devoluciones nunca puede superar `Order.totalInCents`.
3. Cada operación usa `(tenantId, clientRequestId)` como clave idempotente.
4. Un cobro o devolución en efectivo crea exactamente un `CashMovement`, protegido por una restricción única ligada a `OrderPayment`.
5. Una devolución referencia un pago original y no puede superar su importe todavía reintegrable.
6. Solo existe una sesión abierta por sucursal mediante `CashRegisterSession.openKey` único.
7. El cierre verifica que cada pago en efectivo tenga exactamente su movimiento y que la suma de movimientos coincida con el efectivo esperado.

## Flujo operativo

1. `MANAGER`, `CASHIER`, `OWNER` o `ADMIN` abre la caja con el fondo inicial.
2. El personal crea un pedido de mostrador o selecciona una mesa. La comanda sigue el flujo de Cocina/Barra de la Etapa 3.
3. Caja registra uno o más cobros hasta completar el saldo.
4. Si corresponde, registra una devolución explícita sobre el cobro original.
5. Los ingresos y egresos físicos se anotan como movimientos manuales.
6. Al cerrar, se informa el efectivo contado y el sistema guarda el arqueo y la diferencia.

## API

- `GET /api/admin/pos/overview`
- `POST /api/admin/pos/orders`
- `GET /api/admin/pos/orders/:orderId`
- `POST /api/admin/pos/orders/:orderId/payments`
- `POST /api/admin/pos/payments/:paymentId/refunds`
- `POST /api/admin/pos/cash-sessions/open`
- `POST /api/admin/pos/cash-sessions/:sessionId/movements`
- `POST /api/admin/pos/cash-sessions/:sessionId/close`

## Permisos y aislamiento

- `WAITER` puede consultar el POS y abrir pedidos, pero no operar dinero.
- `CASHIER` y `MANAGER` pueden abrir/cerrar caja, cobrar, devolver y registrar movimientos.
- `OWNER` y `ADMIN` conservan acceso global dentro del tenant.
- `KITCHEN` no accede al POS.
- Todas las consultas y relaciones incluyen tenant y sucursal; ningún endpoint acepta esos identificadores desde el navegador.

## Criterios de validación

1. Un intento de cobro superior al saldo responde `409` y no crea registros.
2. Repetir un `clientRequestId` devuelve el mismo cobro sin duplicar pagos ni movimientos.
3. Un cobro en efectivo produce exactamente un movimiento de caja.
4. Una devolución explícita vuelve a abrir saldo y queda ligada al pago original.
5. El cierre reconcilia ventas netas por medio y movimientos físicos de efectivo.
6. Cambiar de sucursal oculta pedidos, turnos y movimientos de la anterior.
7. La suscripción y las facturas SaaS permanecen sin cambios durante toda la operación.
