# Respuesta a incidentes

## Severidades

- **SEV-1:** servicio caído, pérdida/corrupción de datos, cruce de tenants, pagos duplicados o exposición de secretos. Acuse objetivo: 10 minutos.
- **SEV-2:** función operativa principal degradada sin pérdida de datos, como KDS, POS, reservas o worker detenido. Acuse objetivo: 30 minutos.
- **SEV-3:** defecto con alternativa operativa y bajo impacto. Se prioriza en la siguiente revisión.

Antes de abrir el piloto deben registrarse fuera del repositorio el responsable primario, reemplazo, teléfonos y canal de incidentes. Sin guardia asignada, el gate organizacional permanece pendiente.

## Procedimiento común

1. Abrir un registro con hora de Buenos Aires, versión, tenant, sucursal, alcance y `requestId`.
2. Nombrar una persona a cargo y evitar cambios simultáneos sin coordinación.
3. Preservar logs, métricas y eventos del proveedor. No reenviar manualmente webhooks ni cobros.
4. Contener: cerrar altas con `PILOT_SIGNUP_MODE=closed`, retirar la versión afectada o deshabilitar la integración puntual.
5. Recuperar con rollback de imagen. Las migraciones no se revierten destructivamente.
6. Reconciliar pedidos, pagos, caja, inventario y notificaciones antes de declarar resuelto.
7. Documentar causa, impacto, línea temporal y acciones preventivas dentro de las siguientes 48 horas.

## API o base de datos no disponible

Retirar la réplica con readiness fallido. Si PostgreSQL no responde, detener escrituras. Para recuperación de datos, restaurar el último backup verificado en una base nueva, ejecutar `prisma migrate status`, probar aislamiento y recién entonces cambiar `DATABASE_URL`.

## Redis o worker no disponible

La base sigue siendo la fuente de verdad. No borrar colas. Restaurar Redis/worker, comprobar heartbeat y observar que notificaciones y agregados reduzcan su profundidad. Los clientes reconstruyen pedidos, KDS y reservas desde PostgreSQL al reconectar.

## Pagos o fiscalidad

No inferir un cobro por la respuesta del checkout: confirmar contra el proveedor y el webhook persistido. No acreditar ni devolver dos veces. Mantener separados los tokens OAuth de restaurantes y las credenciales de facturación SaaS. Una caída fiscal no autoriza a inventar CAE ni numeración.

## Rollback

1. Poner `PILOT_SIGNUP_MODE=closed`.
2. Retirar tráfico de la imagen nueva.
3. Desplegar la última imagen aprobada por SHA.
4. Si la migración es incompatible, restaurar a una base nueva; nunca ejecutar SQL destructivo improvisado.
5. Ejecutar `pnpm pilot:check` y una operación controlada antes de reabrir.
