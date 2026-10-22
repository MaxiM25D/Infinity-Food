# Roadmap de InfinityFood

Este documento es la fuente de seguimiento del producto. Una etapa solo cambia a `COMPLETADA` cuando se cumplen sus criterios de validación y existe evidencia reproducible.

Desde la Etapa 8, cada cierre incluye en `docs/STAGE_N.md` un mapa de archivos, rutas, migraciones, pantallas y pruebas para facilitar el seguimiento técnico.

| Etapa | Estado | Objetivo |
| --- | --- | --- |
| 0 — Auditoría | COMPLETADA | Inventariar InfinityShop y definir la transformación a InfinityFood. |
| 1 — Base multi-sucursal | COMPLETADA | Turborepo, pnpm, contexto de tenant/sucursal y roles operativos. |
| 2 — Carta gastronómica | COMPLETADA | Carta por sucursal, disponibilidad, precios y QR. |
| 3 — Pedidos y KDS | COMPLETADA | Pedidos QR/mozo, rondas, tickets por estación y tiempo real. |
| 4 — POS y caja | COMPLETADA | Mesa/mostrador, pagos parciales, devoluciones y arqueo. |
| 5 — Reservas | COMPLETADA | Disponibilidad, holds, concurrencia, estados y zona horaria. |
| 6 — Reportes y endurecimiento | COMPLETADA | Métricas reconciliables, E2E, carga, observabilidad y recuperación. |
| 7 — Estabilización y piloto | COMPLETADA | Seguridad, baseline versionable, branding, E2E operativo y staging reproducible. |
| 8 — Operación gastronómica avanzada | COMPLETADA | Modificadores, propinas, división de cuenta, mesas e impresión. |
| 9 — Inventario y costos | COMPLETADA | Stock por sucursal, recetas, ingredientes, compras y proveedores. |
| 10 — Reservas y fidelización | PENDIENTE | Recordatorios, señas, lista de espera, CRM y comunicación. |
| 11 — Pagos y fiscalidad | PENDIENTE | Mercado Pago POS automático, conciliación externa y ARCA/facturación. |
| 12 — Escala horizontal | PENDIENTE | Redis, workers, multirréplica, agregados y observabilidad centralizada. |
| 13 — Lanzamiento controlado | PENDIENTE | Piloto real, soporte, SLO, runbooks y salida comercial gradual. |

## Etapa 7 — Estabilización y piloto

- [x] Auditar dependencias productivas.
- [x] Eliminar vulnerabilidades críticas y altas conocidas.
- [x] Ejecutar typecheck, lint, build, tests, E2E y build de imágenes desde el lockfile actualizado.
- [x] Consolidar las siete etapas en una rama, commit y tag revisables.
- [x] Completar el branding visible de InfinityFood sin romper identificadores históricos.
- [x] Cubrir con E2E pedido QR, KDS, caja y reserva.
- [x] Preparar staging reproducible con correo capturable, storage persistente, métricas y backups.
- [x] Ejecutar smoke test y restauración sobre staging.

La activación con credenciales reales de Resend, Cloudinary y Mercado Pago sandbox requiere dominios y cuentas externas. Su checklist quedó preparado en el runbook y se valida en el entorno remoto antes del piloto de la Etapa 13; no se simula como completada localmente.

## Etapa 8 — Operación gastronómica avanzada

- [x] Modificadores y extras con precio y reglas por sucursal.
- [x] Notas y punto de cocción por ítem.
- [x] Unión, separación y transferencia de mesas.
- [x] División de cuenta por importe, ítem o comensal.
- [x] Propinas, descuentos y cortesías auditadas.
- [x] Cola y protocolo de agente de impresión para cocina y caja.

La integración ESC/POS concreta se configura por modelo de impresora en cada instalación. La implementación y evidencia están en [STAGE_8.md](STAGE_8.md).

## Etapa 9 — Inventario y costos

- [x] Ingredientes, unidades y recetas.
- [x] Stock y movimientos por sucursal/depósito.
- [x] Consumo automático por venta y merma.
- [x] Costos, margen y alertas de reposición.
- [x] Proveedores, órdenes de compra y recepción.

La implementación, las rutas y la evidencia reproducible están en [STAGE_9.md](STAGE_9.md).

## Etapa 10 — Reservas y fidelización

- Recordatorios y confirmaciones automáticas.
- Señas y políticas de cancelación.
- Lista de espera y reasignación de mesas.
- Excepciones de agenda y feriados.
- Historial unificado del cliente y segmentación básica.

## Etapa 11 — Pagos y fiscalidad

- Cobro real de Mercado Pago desde POS, separado de la suscripción SaaS.
- Webhooks e idempotencia de cobros operativos.
- Conciliación con liquidaciones del proveedor.
- Facturación fiscal mediante proveedor homologado o integración ARCA.
- Notas de crédito y cierres exportables para contabilidad.

## Etapa 12 — Escala horizontal

- Redis adapter para Socket.IO.
- Cola y workers separados de la API.
- Locks distribuidos para tareas programadas.
- Agregados incrementales para reportes.
- Pooling y presupuesto de conexiones PostgreSQL.
- Pruebas de múltiples réplicas, failover y reconexión.

## Etapa 13 — Lanzamiento controlado

- Piloto con una sucursal y una réplica de API.
- Monitoreo, alertas y guardias definidas.
- RPO/RTO, backups automáticos y simulacro periódico.
- Capacitación operativa y manuales por rol.
- Revisión semanal de métricas, incidentes y feedback antes de ampliar clientes.
