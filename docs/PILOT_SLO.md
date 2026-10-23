# SLO y recuperación del piloto

## Objetivos iniciales

| Indicador | Objetivo | Ventana | Fuente |
| --- | ---: | --- | --- |
| Disponibilidad de web y `/api/ready` | 99,5% | 30 días, horario operativo | Probe externo |
| Respuestas 5xx de API | < 1% | 15 minutos | Prometheus |
| Latencia promedio de API | < 1,5 s | 10 minutos | Prometheus |
| Heartbeat del worker | sin ausencias > 2 min | continua | Redis/Prometheus |
| Cola de notificaciones | < 100 pendientes | 10 minutos | PostgreSQL/Prometheus |
| Agregados pendientes | < 250 pendientes | 15 minutos | PostgreSQL/Prometheus |

El 99,5% permite aproximadamente 3 h 36 min de indisponibilidad en una ventana de 30 días. Durante el piloto se pausa la incorporación de nuevos restaurantes al consumir 50% de ese presupuesto y se congela todo cambio no correctivo al consumir 100%.

La exactitud de pedidos, pagos, caja e inventario es un invariante, no un porcentaje tolerable. Una duplicación, pérdida o cruce de tenant es un incidente crítico aunque la disponibilidad siga dentro del SLO.

## RPO y RTO

- Objetivo de piloto: RPO máximo de 24 horas mediante dump lógico externo verificado.
- Objetivo recomendado al habilitar PITR administrado: RPO de 5 minutos.
- RTO de piloto: 60 minutos para restaurar en una base nueva, validar migraciones y redirigir la API.
- Los archivos privados usan almacenamiento externo versionado; el backup PostgreSQL no los incluye.

Estos valores no se consideran vigentes hasta configurar backups automáticos en el proveedor y registrar un `pilot:recovery` exitoso con fecha, SHA y duración. Nunca se restaura sobre producción durante un simulacro.

## Criterio de ampliación

Se agrega otra sucursal o restaurante solamente después de dos revisiones semanales consecutivas sin incidentes críticos abiertos, conciliación correcta de pagos/caja, restore drill vigente por menos de 30 días y presupuesto de error consumido menor al 50%.
