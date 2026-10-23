# Etapa 13 — Lanzamiento controlado

## Estado

La implementación técnica y operativa está lista para piloto. El cierre comercial permanece condicionado a ejecutar el período real con un restaurante, responsables de guardia y credenciales externas. No se marca esa evidencia como cumplida desde el entorno local.

## Alcance implementado

- Altas controladas con `PILOT_SIGNUP_MODE=open|allowlist|closed` y allowlist normalizada por email.
- Gate ejecutable que valida TLS remoto, versión, web, API, PostgreSQL, Redis, worker y autenticación de métricas.
- Alertas Prometheus versionadas para disponibilidad, errores, latencia, dependencias, colas y jobs.
- SLO, presupuesto de error, RPO/RTO y criterio objetivo para ampliar el piloto.
- Simulacro automatizado de backup y restauración con evidencia JSON, hash SHA-256 y duración.
- Procedimiento de incidentes, contención, rollback y conciliación.
- Manual operativo para cliente, mozo, cocina/barra, caja, administrador y superadmin.

## Gate de salida

Para staging local:

```powershell
pnpm staging:up
pnpm pilot:check
```

Para un entorno remoto:

```powershell
$env:PILOT_API_URL='https://api.tudominio.com'
$env:PILOT_WEB_URL='https://app.tudominio.com'
$env:PILOT_METRICS_TOKEN='<secret>'
$env:PILOT_EXPECTED_VERSION='<sha desplegado>'
pnpm pilot:check
```

El gate rechaza HTTP fuera de localhost, redirects inesperados, versión incorrecta, dependencias degradadas, métricas públicas o incompletas y una web sin la marca esperada.

## Recuperación

```powershell
$env:DATABASE_URL='postgresql://...'
pnpm pilot:recovery -- -UseDocker
```

El comando crea un dump lógico, calcula su hash, restaura en un PostgreSQL temporal, verifica las migraciones y guarda la evidencia bajo `backups/pilot-drills/`. El directorio está ignorado por Git porque puede contener datos sensibles.

## Despliegue gradual

1. **Prepiloto:** una cuenta allowlisted, una sucursal y datos de prueba; gate, E2E y restore drill verdes.
2. **Semana 1:** operación acompañada, sin alta pública, revisión diaria de caja, pagos, pedidos, reservas y colas.
3. **Semana 2:** operación normal con soporte de guardia y revisión del presupuesto de error.
4. **Ampliación:** solamente con dos revisiones semanales consecutivas aprobadas y sin SEV-1 abierto.

Para congelar incorporaciones sin interrumpir a usuarios existentes se configura `PILOT_SIGNUP_MODE=closed`. No se apaga el login ni el acceso operativo.

## Revisión semanal

Registrar fuera del repositorio, sin datos personales ni secretos:

- rango de fechas, versión y sucursales activas;
- disponibilidad, errores, latencia y presupuesto consumido;
- pedidos, cobros, devoluciones, diferencias de caja y conciliación;
- tiempos KDS, ocupación, no-shows y profundidad máxima de colas;
- incidentes por severidad, causa y acción preventiva;
- feedback clasificado por rol;
- decisión: continuar, congelar, revertir o ampliar, con responsable y fecha.

## Mapa de cambios

- `apps/api/src/config.ts`: modos y allowlist del piloto.
- `apps/api/src/modules/auth/routes.ts`: bloqueo de altas fuera del piloto.
- `scripts/pilot-readiness.mjs`: gate pre y post despliegue.
- `scripts/pilot-recovery-drill.ps1`: backup, restauración y evidencia.
- `deploy/monitoring/`: scrape y alertas Prometheus.
- `docs/PILOT_SLO.md`: objetivos, presupuesto de error y recuperación.
- `docs/INCIDENT_RESPONSE.md`: incidentes y rollback.
- `docs/ROLE_MANUALS.md`: operación diaria por rol.

## Evidencia local del 23 de octubre de 2026

- `pnpm check`: typecheck, lint, build y 121 tests aprobados (112 API, 6 base de datos y 3 web).
- `pnpm test:e2e`: flujo QR, KDS, POS, caja y reservas aprobado.
- `pnpm test:scale`: 2 pruebas de réplicas, reconexión y lock distribuido aprobadas.
- `pnpm pilot:check`: `PILOT_READY` sobre `stage-13`, con base, Redis, worker, métricas y web saludables.
- carga: 17.388 solicitudes en 15 segundos, 0 errores y p95 de 35,19 ms con concurrencia 20.
- restore drill: backup y restauración aprobados en 12,82 segundos; evidencia y dump quedaron bajo `backups/pilot-drills/` fuera de Git.
- `promtool`: configuración válida y 9 reglas de alerta aprobadas.

## Pendientes externos para cerrar el piloto real

- Asignar nombres y canales de guardia.
- Configurar probes y alertas en el proveedor elegido.
- Activar backups/PITR y storage externo en las cuentas productivas.
- Validar Resend, Cloudinary, Mercado Pago y proveedor fiscal con credenciales reales.
- Completar dos revisiones semanales con el restaurante piloto.
