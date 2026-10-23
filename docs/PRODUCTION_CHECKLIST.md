# Checklist de producción de InfinityFood

No pegues secretos en el repositorio. Cargalos en Railway y mantené los archivos `.env` solamente para desarrollo local.

## 1. Servicios y dominios

- Web publicada con `NEXT_PUBLIC_SITE_URL=https://infinityfood.com.ar`.
- Web conectada a la API con `NEXT_PUBLIC_API_URL` y `API_INTERNAL_URL`.
- `PLATFORM_HOSTS=infinityfood.com.ar,www.infinityfood.com.ar`.
- API publicada con `API_PUBLIC_URL`, `WEB_URL` y `TRUST_PROXY_HOPS=1`.
- Cloudflare en modo Full (strict), DNS correcto y redirección de `www` definida.

## 2. Datos y archivos

- Ejecutar `pnpm db:deploy` antes de habilitar tráfico.
- Usar PostgreSQL con backups automáticos.
- Usar `STORAGE_PROVIDER=cloudinary`; el disco local de Railway no debe guardar comprobantes o imágenes definitivas.
- Confirmar que los comprobantes privados no tengan una URL pública permanente.

## 3. Comunicaciones y cobros

- Resend configurado con `EMAIL_PROVIDER=resend`, `EMAIL_FROM` y `RESEND_API_KEY`.
- Probar registro, recuperación, invitación, pedido y cambio de estado.
- OAuth de Mercado Pago por tienda probado con un comprador distinto al vendedor.
- Facturación SaaS probada con credenciales de producción y webhook firmado.
- Nunca reutilizar el token SaaS para cobrar ventas de las tiendas.

## 4. Verificación técnica

- `GET /api/health` responde `ok` y `GET /api/ready` confirma la base de datos.
- `GET /api/internal/metrics` exige el bearer token y el monitor puede recolectarlo.
- `pnpm check` termina sin errores.
- `npm audit --omit=dev` informa cero vulnerabilidades conocidas.
- Probar el plan PRO y verificar que STARTER continúe archivado para datos históricos.
- Probar checkout con pago exitoso, rechazado y correo temporalmente fallido.
- Verificar en móvil: home, login, onboarding, catálogo, producto, carrito, checkout y panel.

## 5. Operación inicial

- Configurar `PILOT_SIGNUP_MODE=allowlist` y cargar únicamente los owners aprobados.
- Ejecutar `pnpm pilot:check` contra las URLs y el SHA desplegados antes de dirigir tráfico.
- Activar alertas de errores y disponibilidad para web, API y base de datos.
- Revisar logs de API, cola de emails y webhooks diariamente durante los primeros clientes.
- Definir responsable y procedimiento para restaurar un backup.
- Ejecutar `restore-drill.ps1` y registrar fecha, hash, duración y resultado.
- Redis debe estar disponible, el worker debe publicar heartbeat y `pnpm test:scale` debe pasar antes de aumentar réplicas.
- Ejecutar una auditoría de Core Web Vitals sobre la URL pública después del despliegue.
- Registrar responsables de guardia, reemplazo y canal de incidentes; no guardar teléfonos en Git.
- Revisar [PILOT_SLO.md](PILOT_SLO.md), [INCIDENT_RESPONSE.md](INCIDENT_RESPONSE.md) y [ROLE_MANUALS.md](ROLE_MANUALS.md) con el restaurante piloto.
