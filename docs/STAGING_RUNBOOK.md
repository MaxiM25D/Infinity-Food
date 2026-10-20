# Runbook de staging — InfinityFood

## Alcance

Este entorno reproduce el piloto con imágenes de producción, PostgreSQL 17, una única réplica de API, almacenamiento persistente local y un SMTP capturable con Mailpit. No utiliza credenciales ni datos de producción.

Cloudinary, Resend y Mercado Pago sandbox se habilitan únicamente en el staging remoto mediante secretos del proveedor. Los cobros de restaurantes y la facturación SaaS deben usar aplicaciones y credenciales distintas.

## Inicio y validación

Requisitos: Docker Desktop, Node.js 22 y pnpm 10.

```powershell
pnpm staging:up
pnpm staging:smoke
```

Servicios:

- Web: `http://localhost:3100`
- API: `http://localhost:4100/api/ready`
- Mailpit: `http://localhost:8025`
- PostgreSQL: `localhost:55439`

El servicio `migrate` aplica exclusivamente las migraciones versionadas antes de habilitar la API; los planes base ya forman parte de esas migraciones. `docker compose ... up --wait` falla si web, API, PostgreSQL o correo no alcanzan estado saludable.

## Datos, archivos y recuperación

Los volúmenes `staging_postgres_data` y `staging_uploads` sobreviven reinicios. Para ensayar backup y restauración sin tocar la base original:

```powershell
$env:DATABASE_URL='postgresql://infinityfood:infinityfood-staging-local@localhost:55439/infinityfood_staging?schema=public'
pnpm db:backup -- -UseDocker
$dump = Get-ChildItem .\backups\*.dump | Sort-Object LastWriteTime -Descending | Select-Object -First 1
pnpm db:restore:drill -- -BackupPath $dump.FullName -SkipIsolationTests
```

El flag evita ejecutar fixtures que esperan los dos tenants del seed de desarrollo. El drill igualmente restaura con `pg_restore --exit-on-error` y verifica las 31 migraciones con Prisma; la suite normal conserva las pruebas de aislamiento multi-tenant.

Eliminar volúmenes reinicia todos los datos y es destructivo; el comando normal `pnpm staging:down` no los elimina.

## Integraciones remotas

En un staging accesible por HTTPS:

1. Configurar Resend con un subdominio de prueba y verificar registro, invitación y recuperación.
2. Configurar Cloudinary en una carpeta/cuenta de staging y probar carga pública y comprobante privado.
3. Configurar Mercado Pago con usuarios de prueba distintos para vendedor y comprador.
4. Mantener `SAAS_MP_ACCESS_TOKEN` separado de los tokens OAuth de restaurantes.
5. Confirmar firmas inválidas y eventos repetidos en ambos webhooks.

Nunca copiar el `.env` local al proveedor. Usar [production.env.example](../deploy/production.env.example) como contrato de variables.

## Despliegue y rollback

1. Desplegar el commit exacto del baseline y fijar `APP_VERSION` con su SHA.
2. Ejecutar `prisma migrate deploy` como pre-deploy.
3. Esperar `/api/ready`, ejecutar el smoke y recién después dirigir tráfico.
4. Si falla, retirar tráfico y volver a la imagen anterior. No revertir migraciones destructivamente.
5. Para una migración incompatible, restaurar en una base nueva desde el último backup verificado y apuntar la imagen anterior a esa base.

## Incidente

1. Registrar hora, versión, tenant/sucursal afectados y `requestId` de los logs.
2. Preservar logs y evitar reintentos manuales de pagos o webhooks sin revisar idempotencia.
3. Si PostgreSQL no está listo, detener escrituras y mantener fuera de rotación la API.
4. Si falla un proveedor, conservar el evento en cola y restablecer el servicio antes de reintentar.
5. Verificar conciliación de órdenes, pagos y caja antes de cerrar el incidente.

La API debe permanecer en una réplica hasta implementar y validar Redis para Socket.IO y coordinación de jobs en la Etapa 12.
