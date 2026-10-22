# Etapa 11 — Pagos y fiscalidad

## Alcance implementado

- Checkout de Mercado Pago generado desde el POS con la cuenta OAuth del restaurante.
- Reserva del saldo mientras el checkout está pendiente para impedir cobros concurrentes por encima del total.
- Acreditación exclusivamente desde el webhook firmado, luego de consultar a Mercado Pago y validar receptor, importe y moneda.
- Alta idempotente de `OrderPayment` y auditoría gastronómica ante webhooks repetidos.
- Bloqueo del cierre de caja mientras existan cobros del turno pendientes de resolución.
- Cancelación explícita de checkouts abandonados para liberar el saldo y el cierre.
- Devolución automática contra Mercado Pago antes de reflejar el reintegro local.
- Conciliación por cobro de importe bruto, comisión, neto, estado y fecha de liberación.
- Perfil fiscal por sucursal y adaptador HTTP para un proveedor homologado.
- Facturas, notas de crédito parciales/totales, autorización fiscal e historial exportable en CSV.
- Separación estricta entre cobros operativos, comprobantes fiscales y facturación de la suscripción SaaS.

## Mapa de cambios

### Base de datos

- `packages/database/prisma/schema.prisma`: flujo y contexto POS en `PaymentAttempt`; datos de proveedor y conciliación en `OrderPayment`; modelos `FiscalProfile` y `FiscalDocument`.
- `packages/database/prisma/migrations/20261022234500_add_payments_fiscality/migration.sql`: enums, columnas, índices y relaciones de la etapa.

### Backend

- `apps/api/src/services/mercado-pago.ts`: checkout POS, procesamiento idempotente del webhook, conciliación y devolución real.
- `apps/api/src/services/pos.ts`: saldo reservado por intentos pendientes y bloqueo seguro del cierre.
- `apps/api/src/services/fiscal.ts`: adaptador fiscal, emisión idempotente, notas de crédito y exportación.
- `apps/api/src/modules/pos/routes.ts`: endpoints administrativos de pagos, conciliación y fiscalidad.
- `apps/api/src/modules/pos/schemas.ts`: contratos Zod.
- `apps/api/src/config.ts` y `.env.example`: configuración independiente del proveedor fiscal.

### Web

- `apps/web/src/components/admin/pos-view.tsx`: checkout automático, estado de conexión, conciliación, perfil fiscal, emisión e historial.

### Pruebas

- `apps/api/test/payments-fiscality.test.ts`: saldo reservado, cierre bloqueado, webhook duplicado, comisión/neto, factura, nota de crédito, CSV, devolución y aislamiento de billing SaaS.
- `apps/api/test/pos-cash.test.ts`: Mercado Pago ingresado manualmente se identifica como `MERCADO_PAGO_EXTERNAL`.
- `e2e/critical-flow.spec.ts`: presencia del módulo de conciliación y fiscalidad en el flujo crítico.

## Rutas principales

- `POST /api/admin/pos/orders/:orderId/mercadopago-checkout`
- `POST /api/admin/pos/mercadopago-attempts/:attemptId/cancel`
- `POST /api/payments/mercadopago/webhook/:webhookKey`
- `POST /api/admin/pos/payments/:paymentId/reconcile`
- `GET /api/admin/pos/reconciliation`
- `POST /api/admin/pos/payments/:paymentId/refunds`
- `PUT /api/admin/pos/fiscal/profile`
- `POST /api/admin/pos/orders/:orderId/fiscal-documents`
- `GET /api/admin/pos/fiscal/export.csv`

## Seguridad y consistencia

El checkout usa el access token cifrado del tenant y una clave idempotente por intento. El webhook público exige firma válida, resuelve la conexión mediante una clave aleatoria por tenant y luego consulta el recurso directamente al proveedor. El receptor debe coincidir con el vendedor OAuth conectado. El webhook nunca consulta ni modifica `Subscription`, `BillingInvoice` o credenciales de facturación de InfinityFood.

El POS descuenta del saldo disponible tanto pagos acreditados como intentos pendientes. La caja no cierra con intentos pendientes. Una devolución automática se solicita primero al proveedor con la misma clave idempotente y recién después crea el `OrderPayment` de tipo `REFUND`.

## Proveedor fiscal

InfinityFood no guarda certificados ni claves fiscales de ARCA. Se integra con un proveedor homologado mediante:

```env
FISCAL_PROVIDER_URL="https://proveedor.example/api"
FISCAL_PROVIDER_TOKEN="secreto"
```

El contrato esperado es `POST /documents`, con `X-Idempotency-Key`, y una respuesta con `id`, `number`, `authorizationCode` y opcionalmente `authorizationExpiresAt`. Esto permite cambiar de proveedor sin mezclar reglas fiscales específicas con pedidos, caja o suscripciones.

## Cómo verlo

1. Ejecutar `pnpm dev`.
2. Conectar la cuenta del restaurante en `http://localhost:3000/admin?tab=store&section=payments`.
3. Abrir `http://localhost:3000/admin?tab=pos`.
4. Crear un pedido y elegir Mercado Pago para generar el checkout.
5. Revisar conciliación y configurar el perfil fiscal en la misma pantalla.

## Validación reproducible

```powershell
pnpm db:generate
pnpm db:deploy
pnpm --filter @infinityshop/api exec tsx --test --test-concurrency=1 test/payments-fiscality.test.ts
pnpm check
pnpm test:e2e
```

## Límite de certificación externa

La implementación prueba el contrato completo con proveedores simulados. La certificación final exige una cuenta Mercado Pago sandbox y credenciales de un proveedor fiscal homologado reales. Esas pruebas se ejecutan en staging porque no deben incluir secretos ni certificados en el repositorio.
