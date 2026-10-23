# Etapa 12 — Escala horizontal

## Alcance implementado

- Adapter Redis para propagar eventos Socket.IO entre réplicas de API.
- API HTTP separada del proceso worker: la API no ejecuta barridos ni envíos en segundo plano.
- Worker para notificaciones, vencimiento de reservas/holds, cancelaciones de suscripción y agregados de reportes.
- Locks Redis con token, TTL y liberación atómica para impedir ejecuciones duplicadas.
- Cola de emails persistente en PostgreSQL, con claim, reintentos y recuperación de trabajos interrumpidos.
- Agregados diarios incrementales por sucursal, canal, medio de pago y franja horaria.
- Marca de pago procesado que vuelve idempotente cada incremento aun con workers concurrentes.
- Pool PostgreSQL configurable y presupuesto explícito por proceso.
- Métricas Prometheus con identidad de réplica, salud Redis/worker y profundidad de colas.
- Staging con dos APIs, worker, Redis persistente y Nginx con afinidad y WebSocket.

## Topología

```text
Web / KDS / POS
       |
    Nginx
    /   \
 API-A API-B  <---- Redis Pub/Sub ----> Socket.IO rooms
    \   /
 PostgreSQL   <---- Worker único lógico (locks Redis)
                    |-- notificaciones
                    |-- reservas y suscripciones
                    `-- agregados de reportes
```

PostgreSQL sigue siendo la fuente de verdad. Redis coordina y distribuye eventos; perder un evento no pierde el estado porque los clientes recargan su snapshot desde la base al conectar o reconectar.

## Mapa de cambios

- `apps/api/src/realtime.ts`: adapter Redis y cierre ordenado de clientes pub/sub.
- `apps/api/src/server.ts`: proceso API sin tareas programadas.
- `apps/api/src/worker.ts`: ejecución independiente de jobs y heartbeat.
- `apps/api/src/services/redis.ts`: conexión compartida, locks y métricas distribuidas.
- `apps/api/src/services/report-aggregates.ts`: procesamiento incremental exactamente una vez por pago.
- `apps/api/src/services/observability.ts`: métricas por réplica, dependencias y profundidad de cola.
- `packages/database/src/client.ts`: límites configurables del pool PostgreSQL.
- `packages/database/prisma/schema.prisma`: hechos procesados y agregados diarios.
- `packages/database/prisma/migrations/20261023013000_add_horizontal_scaling/migration.sql`: migración de agregados.
- `compose.staging.yaml` y `deploy/nginx.scale.conf`: topología completa de staging.
- `scripts/test-horizontal-scale.ps1`: validación reproducible con dos instancias Socket.IO.

## Agregados

Cada `OrderPayment` pendiente de agregar se reclama creando `ReportPaymentFact`. Esa clave primaria impide contabilizarlo dos veces. En la misma transacción se incrementan cuatro dimensiones de `ReportSalesAggregate`: sucursal, canal, medio y franja local. Si dos workers compiten, uno confirma el hecho y el otro recibe la colisión única sin modificar agregados.

La consulta escalable está en:

```text
GET /api/admin/reports/sales-aggregates?from=YYYY-MM-DD&to=YYYY-MM-DD&branchId=...
```

El reporte operativo detallado continúa leyendo las entidades fuente para auditoría y reconciliación.

## Presupuesto PostgreSQL

Variables por proceso:

```env
DATABASE_POOL_MAX=8
DATABASE_POOL_IDLE_TIMEOUT_MS=30000
DATABASE_POOL_CONNECTION_TIMEOUT_MS=5000
```

Con dos APIs de 8 conexiones, un worker de 5 y margen para migraciones/administración, staging consume como máximo 25 conexiones planificadas. El límite debe revisarse contra `max_connections` o el pooler administrado antes de agregar réplicas.

## Desarrollo

`pnpm dev` inicia PostgreSQL, Redis, API, worker y web. La configuración local usa Redis en `localhost:56379`; staging publica su Redis en `localhost:56380`, por lo que ambos entornos pueden convivir.

## Validación reproducible

```powershell
pnpm db:generate
pnpm db:deploy
pnpm test:scale
pnpm check
pnpm test:e2e
docker compose -f compose.staging.yaml config
```

`pnpm test:scale` prueba entrega de eventos entre dos servidores, caída de una réplica, reconstrucción desde PostgreSQL y exclusión mutua del lock distribuido.

Resultado del cierre local de la etapa:

- 119 tests unitarios y de integración aprobados.
- 2 tests específicos de escala aprobados.
- 1 E2E crítico completo aprobado.
- smoke test de staging aprobado con dos APIs, worker, Redis, gateway y web saludables.
- failover manual aprobado: al detener `api-b`, el gateway mantuvo `/api/ready` en 200 mediante `api-a`; luego la réplica se reincorporó saludable.
- 37 migraciones aplicadas y ninguna pendiente.

## Operación

- `/api/health` identifica la réplica.
- `/api/ready` verifica PostgreSQL y Redis e informa el heartbeat del worker.
- `/api/internal/metrics` expone `build_info`, salud de dependencias, resultados distribuidos de jobs y profundidad de las colas.
- Si Redis cae, readiness responde 503 para retirar la réplica del balanceador.
- Si el worker está `stale`, la API puede seguir atendiendo lecturas y cobros; debe alertarse porque emails, vencimientos y agregados quedan demorados.
