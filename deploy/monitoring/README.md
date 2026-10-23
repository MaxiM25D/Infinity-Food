# Monitoreo de InfinityFood

`prometheus.example.yml` muestra el scrape autenticado y `alert-rules.yml` contiene las alertas mínimas del piloto. El token se monta como secreto; nunca se escribe dentro del YAML ni del repositorio.

Además de estas métricas internas, configurar dos probes externos desde otra región:

- `GET /api/ready`, cada minuto.
- `GET /`, cada minuto, verificando HTTP 200 y TLS válido.

Las alertas `critical` deben notificar al responsable de guardia inmediatamente. Las `warning` generan una tarea operativa y se revisan durante el mismo día. Antes de activar reglas en un proveedor administrado, adaptar únicamente nombres de job, rutas de secretos y canal de notificación; no modificar los umbrales sin registrar la decisión en la revisión semanal.

Las métricas en memoria se reinician al desplegar. Prometheus conserva las series históricas; la disponibilidad oficial se calcula con el probe externo, no con el uptime del proceso.
