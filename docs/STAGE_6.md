# Etapa 6 — Reportes y endurecimiento

## Reportes operativos

El panel `/admin?tab=reports` calcula métricas directamente desde las fuentes transaccionales, sin tablas agregadas que puedan quedar desactualizadas:

- `OrderPayment`: venta bruta, devoluciones y venta neta por sucursal, canal, medio y franja horaria local.
- `CashRegisterSession` y `CashMovement`: reconciliación entre importes guardados al cierre, pagos calculados y efectivo físico esperado.
- `KitchenTicket`: cola, preparación, entrega, tiempo total y percentiles P50/P90 por estación.
- `Order` y `Reservation`: rotación de mesas.
- `Reservation`, capacidad de mesas y horarios semanales: ocupación y tasa de no-show.

Los pagos de suscripciones SaaS no forman parte de estas consultas. El endpoint es `GET /api/admin/reports/operations`, acepta hasta 366 días y restringe sucursales según la sesión.

## Reconciliación

Cada turno informa tanto el valor persistido al cierre como el recalculado desde pagos y movimientos. Se considera reconciliado cuando:

1. venta neta guardada = pagos menos devoluciones;
2. efectivo guardado = pagos y devoluciones en efectivo;
3. suma de movimientos = fondo inicial + efectivo neto + movimientos manuales.

Las pruebas comparan además el total del reporte contra una reducción independiente de `OrderPayment`.

## Observabilidad

- `/api/health`: proceso, versión, réplica y uptime.
- `/api/ready`: PostgreSQL y latencia de la consulta de readiness.
- `/api/internal/metrics`: formato Prometheus protegido por `METRICS_TOKEN`.
- Métricas: requests por método/estado, duración acumulada, memoria, conexiones WebSocket y resultado de jobs de fondo.
- Logs JSON: `requestId`, duración, estado, tenant, usuario, versión y eventos de apagado seguro.

Nunca exponer el token de métricas en la web ni incluirlo en variables `NEXT_PUBLIC_*`.

## Carga y Redis

Ensayo local del 19 de octubre de 2026:

| Escenario | Concurrencia | Requests/s | Error | P95 |
| --- | ---: | ---: | ---: | ---: |
| Health + readiness | 30 | 5420,4 | 0% | 10,82 ms |
| Disponibilidad real con PostgreSQL | 20 | 74,3 | 0% | 363,91 ms |

Para el piloto de una réplica estos resultados no justifican Redis. PostgreSQL continúa siendo la fuente de verdad y la carga pública más costosa queda dentro del umbral de 750 ms.

No se habilita multirréplica en esta etapa: Socket.IO usa rooms en memoria. Antes de aumentar réplicas se debe incorporar Redis adapter, validar propagación cruzada de eventos y coordinar jobs periódicos con lock distribuido. Ejecutar varias réplicas sin ese trabajo provocaría actualizaciones en tiempo real incompletas. Esta es una restricción explícita, no una capacidad asumida.

El ensayo reproducible está en `scripts/load-test.mjs` y falla si supera el error o P95 configurados.

## Reconexión y E2E

- La prueba Socket.IO fuerza desconexión, crea otra conexión autenticada, recibe un evento nuevo y reconstruye la reserva desde PostgreSQL.
- Playwright registra un tenant a través del proxy web, abre el reporte autenticado y valida la reserva pública.
- CI instala Chromium y ejecuta el flujo crítico después de typecheck, lint, build y pruebas de API.

## Backup y recuperación

`scripts/backup-postgres.ps1` usa `pg_dump` local o una imagen oficial PostgreSQL 17. `scripts/restore-drill.ps1`:

1. valida el archivo `.dump`;
2. levanta un PostgreSQL temporal con credenciales aleatorias;
3. restaura con `--exit-on-error`;
4. confirma las 31 migraciones;
5. ejecuta las pruebas de aislamiento multi-tenant;
6. destruye únicamente el contenedor temporal creado por el ensayo.

Ensayo realizado sobre `infinityfood-20261019-190624.dump`, SHA-256 `5C4AA21C4A37C8E9A42D523AC22A22D91AAF721BFD225F523518027468A079EC`: restauración correcta y 6/6 pruebas de aislamiento aprobadas. El dump permanece fuera de Git bajo `backups/`.

## Validación final

- Suite automatizada: 98/98 pruebas aprobadas (89 API, 6 base de datos y 3 web).
- E2E crítico: 1/1 flujo Playwright aprobado en Chromium.
- Typecheck, lint, build local y `git diff --check`: aprobados.
- Imágenes de producción `infinityfood-api:stage6` e `infinityfood-web:stage6`: construidas correctamente desde Dockerfiles.
- Esquema local: 31 migraciones aplicadas y sin pendientes.

Comandos:

```powershell
pnpm db:backup
pnpm db:restore:drill -- -BackupPath .\backups\infinityfood-AAAAmmdd-HHmmss.dump
pnpm test:load
pnpm test:e2e
```
