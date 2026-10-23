# Roadmap de InfinityFood

Este documento es la fuente de seguimiento del producto. Una etapa solo cambia a `COMPLETADA` cuando se cumplen sus criterios de validación y existe evidencia reproducible.

Desde la Etapa 8, cada cierre incluye en `docs/STAGE_N.md` un mapa de archivos, rutas, migraciones, pantallas y pruebas para facilitar el seguimiento técnico.

| Etapa                               | Estado     | Objetivo                                                                         |
| ----------------------------------- | ---------- | -------------------------------------------------------------------------------- |
| 0 — Auditoría                       | COMPLETADA | Inventariar InfinityShop y definir la transformación a InfinityFood.             |
| 1 — Base multi-sucursal             | COMPLETADA | Turborepo, pnpm, contexto de tenant/sucursal y roles operativos.                 |
| 2 — Carta gastronómica              | COMPLETADA | Carta por sucursal, disponibilidad, precios y QR.                                |
| 3 — Pedidos y KDS                   | COMPLETADA | Pedidos QR/mozo, rondas, tickets por estación y tiempo real.                     |
| 4 — POS y caja                      | COMPLETADA | Mesa/mostrador, pagos parciales, devoluciones y arqueo.                          |
| 5 — Reservas                        | COMPLETADA | Disponibilidad, holds, concurrencia, estados y zona horaria.                     |
| 6 — Reportes y endurecimiento       | COMPLETADA | Métricas reconciliables, E2E, carga, observabilidad y recuperación.              |
| 7 — Estabilización y piloto         | COMPLETADA | Seguridad, baseline versionable, branding, E2E operativo y staging reproducible. |
| 8 — Operación gastronómica avanzada | COMPLETADA | Modificadores, propinas, división de cuenta, mesas e impresión.                  |
| 9 — Inventario y costos             | COMPLETADA | Stock por sucursal, recetas, ingredientes, compras y proveedores.                |
| 10 — Reservas y fidelización        | COMPLETADA | Recordatorios, señas, lista de espera, CRM y comunicación.                       |
| 11 — Pagos y fiscalidad             | COMPLETADA | Mercado Pago POS automático, conciliación externa y ARCA/facturación.            |
| 12 — Escala horizontal              | COMPLETADA | Redis, workers, multirréplica, agregados y observabilidad centralizada.          |
| 13 — Lanzamiento controlado         | LISTA PARA PILOTO | Gate, soporte, SLO, recuperación y salida comercial gradual.              |

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

- [x] Recordatorios y confirmaciones automáticas persistidas e idempotentes.
- [x] Señas por importe fijo o persona y políticas de cancelación.
- [x] Lista de espera, ofertas con vencimiento y reasignación de mesas.
- [x] Excepciones de agenda, horarios especiales y feriados.
- [x] Historial unificado del cliente y segmentación básica.

La implementación, rutas, decisiones y validación reproducible están en [STAGE_10.md](STAGE_10.md).

## Etapa 11 — Pagos y fiscalidad

- [x] Cobro real de Mercado Pago desde POS, separado de la suscripción SaaS.
- [x] Webhooks firmados e idempotencia de cobros operativos.
- [x] Conciliación de bruto, comisiones, neto y liberación con el proveedor.
- [x] Facturación fiscal mediante adaptador para proveedor homologado.
- [x] Notas de crédito y comprobantes exportables para contabilidad.

La implementación y sus límites de certificación externa están documentados en [STAGE_11.md](STAGE_11.md).

## Etapa 12 — Escala horizontal

- [x] Redis adapter para Socket.IO.
- [x] Cola persistente y worker separado de la API.
- [x] Locks distribuidos para tareas programadas.
- [x] Agregados incrementales e idempotentes para reportes.
- [x] Pooling y presupuesto de conexiones PostgreSQL.
- [x] Pruebas de múltiples réplicas, failover y reconexión.

La topología, operación y evidencia reproducible están documentadas en [STAGE_12.md](STAGE_12.md).

## Etapa 13 — Lanzamiento controlado

- [x] Altas limitables por allowlist o cierre total sin afectar usuarios existentes.
- [x] Gate automatizado de salud, versión, dependencias, métricas y web.
- [x] SLO, alertas, presupuesto de error y runbook de incidentes definidos.
- [x] Backup y restauración automatizados con evidencia verificable.
- [x] Manuales y contingencias documentados para todos los roles.
- [ ] Asignar guardias y canales reales fuera del repositorio.
- [ ] Completar dos semanas y dos revisiones con un restaurante piloto.

La implementación y los criterios de promoción están en [STAGE_13.md](STAGE_13.md). La etapa queda `LISTA PARA PILOTO`, no `COMPLETADA`, hasta obtener evidencia de operación real.
