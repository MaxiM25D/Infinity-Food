# InfinityFood

SaaS gastronómico multi-tenant en evolución incremental desde el core de InfinityShop. El núcleo de autenticación, aislamiento, suscripciones y pagos se conserva mientras los módulos comerciales migran al dominio de restaurantes.

## Seguimiento

El avance, los entregables pendientes y los criterios de cierre de cada etapa se mantienen en [docs/ROADMAP.md](docs/ROADMAP.md). Las etapas 0 a 11 están completas; la siguiente etapa planificada es escala horizontal.

## Estructura

- `apps/web`: frontend con Next.js, React, TypeScript y Tailwind CSS.
- `apps/api`: API con Express y TypeScript.
- `packages/database`: esquema multi-tenant de PostgreSQL con Prisma.
- `packages/contracts`: contratos mínimos compartidos entre web y API.
- `turbo.json`: pipeline reproducible de build, tipos, lint y tests.
- `legacy/lunek-app`: ecommerce original, conservado como referencia local y excluido del Git del monorepo.

## Requisitos

- Node.js 22 LTS o superior.
- pnpm 10.34.7 mediante Corepack.
- PostgreSQL (el puerto se configura con `POSTGRES_PORT`).

## Inicio local

1. Ejecutar `corepack enable` y `pnpm install` en la raíz.
2. Copiar `.env.example` como `.env` y configurar `DATABASE_URL`.
3. Ejecutar `pnpm db:up` para iniciar PostgreSQL con Docker.
4. Ejecutar `pnpm db:generate`.
5. Ejecutar `pnpm db:migrate -- --name nombre_de_la_migracion`.
6. Ejecutar `pnpm db:seed` para cargar los datos de demostración.
7. Ejecutar `pnpm db:test:isolation` para verificar el aislamiento multi-tenant.
8. Ejecutar `pnpm dev`; Turborepo inicia web y API en paralelo.

Web: `http://localhost:3000`. API: `http://localhost:4000/api/health`.

## Staging local reproducible

Ejecutá `pnpm staging:up` y luego `pnpm staging:smoke`. La web queda en `http://localhost:3100`, la API en `http://localhost:4100` y Mailpit en `http://localhost:8025`. El procedimiento de backup, restauración, rollback e integraciones externas está en [docs/STAGING_RUNBOOK.md](docs/STAGING_RUNBOOK.md).

## Usuario administrador local

Configurá `SUPERADMIN_EMAIL`, `SUPERADMIN_PASSWORD` y `SUPERADMIN_STORE_SLUG` en `.env` y ejecutá `pnpm db:superadmin`. El comando crea o actualiza una cuenta `SUPERADMIN` de plataforma, le asigna un restaurante de prueba como `OWNER` y activa el plan Pro. La contraseña local nunca debe subirse a Git.

## Aislamiento multi-tenant

Las entidades comerciales incluyen `tenantId`, las restricciones únicas se componen con ese identificador y las relaciones entre productos, clientes, carritos y pedidos usan claves foráneas compuestas. La aplicación accede a los datos mediante repositorios ligados a un tenant. Las pruebas comprueban tanto el filtrado de consultas como el rechazo de relaciones cruzadas en PostgreSQL.

## Autenticación y onboarding

- `POST /api/auth/register`: crea usuario, tienda, membresía `OWNER` y sesión.
- `POST /api/auth/login`: inicia sesión y permite seleccionar una membresía mediante `tenantSlug`.
- `POST /api/auth/logout`: invalida la sesión actual.
- `GET /api/auth/me`: devuelve el usuario y la tienda activos.
- `POST /api/auth/select-tenant`: cambia de tienda usando un slug y verificando la membresía.
- `POST /api/auth/select-branch`: cambia la sucursal operativa y valida el acceso del usuario.
- `GET|POST /api/auth/tenants`: lista las tiendas accesibles o crea una nueva con el usuario como `OWNER`.
- `POST /api/auth/email-verification` y `POST /api/auth/verify-email`: generan y consumen enlaces de verificación.
- `POST /api/auth/forgot-password` y `POST /api/auth/reset-password`: recuperan la contraseña y revocan las sesiones anteriores.
- `GET /api/auth/invitations/:token` y `POST /api/auth/invitations/accept`: validan y aceptan invitaciones al equipo.
- `GET /api/tenants/resolve/:slug`: resuelve públicamente una tienda activa.
- `GET /api/tenants/context`: devuelve el tenant guardado en la sesión.

La cookie de sesión es `httpOnly`, el token se almacena hasheado en PostgreSQL y el `tenantId` activo nunca se toma del body, query string o parámetros enviados por el frontend.

El panel incluye un selector multi-tienda. La última selección queda asociada al usuario y se recupera en el próximo login; si esa tienda es suspendida o la membresía desaparece, la sesión cambia automáticamente a otra tienda activa disponible.

Los tokens de verificación, recuperación e invitación también se guardan únicamente como hashes SHA-256, vencen y son de un solo uso. En desarrollo, si el correo no está configurado, la interfaz muestra un enlace local para probar el flujo. Esos enlaces no se incluyen en respuestas de producción. Mientras el email no esté verificado, el OWNER puede preparar la tienda, pero los cobros, la facturación SaaS y las invitaciones permanecen bloqueados.

## Panel administrativo

El panel web está disponible en `http://localhost:3000/admin` y consume rutas protegidas bajo `/api/admin`:

- `GET /dashboard`: métricas y pedidos recientes.
- `GET|POST /categories` y `PATCH|DELETE /categories/:id`: CRUD de categorías.
- `GET|POST /products` y `PATCH|DELETE /products/:id`: CRUD de productos, precio, stock, imágenes y estado.
- `GET /customers` y `GET /customers/:id`: búsqueda paginada, datos de contacto, estadísticas e historial de compras.
- `GET|PATCH /store`: identidad, contacto, moneda y configuración visual de la tienda.

Los roles `OWNER` y `ADMIN` pueden modificar datos. `STAFF` tiene acceso de solo lectura. El propietario invita colaboradores por email, puede cancelar invitaciones pendientes y el límite del plan contempla tanto miembros como invitaciones activas. Todas las consultas y mutaciones toman el tenant desde la sesión del servidor.

## Sucursales y acceso operativo

Cada restaurante tiene una sucursal principal. `OWNER` y `ADMIN` acceden globalmente; el personal recibe asignaciones explícitas por sucursal con roles `MANAGER`, `WAITER`, `KITCHEN`, `CASHIER` o `STAFF`. El panel incorpora un selector de sucursal y el contexto autenticado se actualiza en el servidor. El único identificador de sucursal aceptado desde el cliente corresponde a ese selector explícito y se valida contra el tenant, el estado y las asignaciones del usuario. La API está disponible en `/api/admin/branches`.

## Carta gastronómica y QR

Las categorías existentes funcionan como secciones y los productos como platos o bebidas. Cada sucursal define disponibilidad, precio opcional, destaque y orden mediante `BranchMenuItem`, sin duplicar el catálogo del restaurante. Los platos incluyen preparación estimada, alérgenos y etiquetas alimentarias.

La administración está disponible en **Carta** dentro del panel. La ruta pública `/carta/:restaurantSlug/:branchSlug` muestra únicamente secciones, platos y sucursales activas. Desde el panel se puede previsualizar la carta y descargar un QR SVG propio de la sucursal.

## Pedidos gastronómicos, comandas y KDS

El panel **Salón** administra mesas, QR, estaciones y asignaciones de platos. El cliente pide desde `/mesa/:restaurantSlug/:branchSlug/:tableCode`; el mozo abre pedidos o agrega rondas desde la misma aplicación. Cada ronda se divide atómicamente en un ticket por estación y los reintentos usan UUID idempotentes para evitar duplicados.

El KDS está disponible en `/kds`. Socket.IO notifica cambios, pero cada conexión y reconexión reconstruye el tablero desde PostgreSQL. El rol `KITCHEN` queda limitado a la sucursal y estación asignadas; responsables y administradores pueden supervisar toda la operación. Los detalles están en [docs/STAGE_3.md](docs/STAGE_3.md).

## POS, pagos operativos y caja

El panel **POS y caja** permite abrir un turno por sucursal, generar pedidos de mostrador o mesa, registrar cobros parciales en efectivo, tarjeta externa o Mercado Pago y realizar devoluciones explícitas. Cada cobro usa un UUID idempotente y el servidor bloquea el pedido antes de validar el saldo, por lo que los reintentos y cobros concurrentes no pueden exceder el total.

Mercado Pago automático crea un checkout desde el POS y acredita el cobro únicamente mediante un webhook firmado que vuelve a consultar el pago y valida receptor, importe y moneda. El panel concilia bruto, comisión, neto y liberación; las devoluciones automáticas se envían al proveedor antes de registrarse localmente. La capa fiscal emite facturas y notas de crédito mediante un adaptador HTTP para proveedor homologado y permite exportar el libro en CSV. Ver [docs/STAGE_11.md](docs/STAGE_11.md).

## Operación gastronómica avanzada

La **Carta** permite configurar extras y modificadores por sucursal. El pedido QR valida las selecciones obligatorias, suma sus precios y conserva snapshots históricos; notas, extras y punto de cocción llegan al KDS. El panel **Operación avanzada** incorpora unión/separación y transferencia de mesas, propinas, descuentos, cortesías, división de cuenta por importe, ítem o comensal y una cola persistente de impresión para cocina y caja. Ver [docs/STAGE_8.md](docs/STAGE_8.md).

El panel **Inventario** administra ingredientes, recetas, depósitos, mermas, proveedores, órdenes de compra y recepciones. Los pedidos QR, de mozo y POS descuentan las recetas en la misma transacción y exponen costos, márgenes, alertas y trazabilidad por sucursal. Ver [docs/STAGE_9.md](docs/STAGE_9.md).

## Reservas

El panel **Reservas** administra horarios, excepciones, señas, lista de espera, reasignaciones, confirmaciones, recordatorios, cancelaciones y no-show por sucursal. PostgreSQL impide solapamientos activos para una misma mesa incluso con solicitudes concurrentes. La experiencia pública en `/reservas/:restaurantSlug/:branchSlug` permite reservar, retomar desde un enlace seguro, cancelar y anotarse en espera. El historial se integra en **Clientes** con segmentación básica. Ver [docs/STAGE_5.md](docs/STAGE_5.md) y [docs/STAGE_10.md](docs/STAGE_10.md).

## Reportes y operación

El panel **Reportes** presenta ventas por sucursal, canal, medio y franja; tiempos de cocina; rotación; ocupación; no-shows y reconciliación de caja. `/api/internal/metrics` ofrece métricas Prometheus protegidas. La carga, reconexión, E2E y restauración se validan con scripts reproducibles documentados en [docs/STAGE_6.md](docs/STAGE_6.md).

Los cobros en efectivo crean exactamente un movimiento ligado al pago. El cierre persiste ventas netas por medio, efectivo esperado, efectivo declarado y diferencia. `OrderPayment`, `CashRegisterSession` y `CashMovement` pertenecen al dominio operativo del restaurante; `Subscription` y `BillingInvoice` continúan aislados para la facturación del SaaS. Los detalles están en [docs/STAGE_4.md](docs/STAGE_4.md).

## Tienda pública

Cada comercio activo tiene un storefront responsive en `/tienda/:slug`, con categorías, buscador, catálogo, detalle en `/tienda/:slug/producto/:productSlug` y carrito persistente por tienda. La API pública bajo `/api/storefront/:slug` expone únicamente productos activos y resuelve internamente el tenant mediante el slug.

## Pedidos y checkout

El checkout público está disponible en `/tienda/:slug/checkout` y permite transferencia bancaria o Mercado Pago según la configuración del tenant. El servidor vuelve a consultar precios y stock, reserva existencias de forma atómica y guarda una copia del nombre, SKU y precio de cada producto. Las reservas vencidas se liberan automáticamente.

Las transferencias admiten comprobantes privados PDF o imagen. El panel permite revisarlos, confirmar el pago, preparar el pedido, cargar seguimiento, marcar la entrega y reintentar correos fallidos. El cliente consulta su pedido mediante un token secreto guardado únicamente en su navegador.

## Mercado Pago por tienda

Cada tenant conecta su propia cuenta mediante OAuth Authorization Code con PKCE. Los access y refresh tokens se cifran con AES-256-GCM y nunca se envían al frontend.

1. Crear una aplicación de Marketplace en Mercado Pago.
2. Configurar como callback `http://localhost:4000/api/integrations/mercadopago/callback` en desarrollo.
3. Configurar el webhook de pagos apuntando a la URL pública del backend y copiar su firma secreta.
4. Completar en `.env`: `API_PUBLIC_URL`, `MP_CLIENT_ID`, `MP_CLIENT_SECRET`, `MP_WEBHOOK_SECRET` y una `MP_TOKEN_ENCRYPTION_KEY` aleatoria de al menos 32 caracteres.
5. Reiniciar la API e ingresar a **Mi tienda → Mercado Pago → Conectar Mercado Pago**.

Mercado Pago se ofrece solamente cuando la tienda opera en ARS. Para recibir webhooks reales, `API_PUBLIC_URL` debe ser HTTPS y accesible desde Internet; Mercado Pago no acepta `localhost` como URL de notificación o retorno.

## Archivos y correos

En desarrollo, las imágenes se guardan en `storage/public` y los comprobantes en `storage/private`. Para producción se puede configurar Cloudinary con `CLOUDINARY_NAME`, `CLOUDINARY_KEY` y `CLOUDINARY_SECRET`; los comprobantes se almacenan como recursos autenticados.

En Railway se recomienda `EMAIL_PROVIDER=resend`, `EMAIL_FROM` y `RESEND_API_KEY`, porque el plan Hobby restringe SMTP saliente. SMTP continúa disponible como alternativa mediante las variables `SMTP_*`. Los avisos se registran en PostgreSQL para que una falla del proveedor no revierta ni bloquee una operación comercial.

## Funciones SaaS

Cada tenant nuevo utiliza el plan comercial `PRO`; `STARTER` se conserva archivado únicamente para compatibilidad histórica. Los límites se verifican dentro de transacciones del servidor. Pedidos, checkout, pagos, seguridad y aislamiento no tienen límites por volumen del plan.

El onboarding inicia una prueba PRO de siete días. El OWNER consulta uso, sincroniza el estado, programa la cancelación y revisa facturas desde **Plan y uso**. La facturación recurrente usa credenciales propias del SaaS, completamente separadas del OAuth de Mercado Pago que cada tenant utiliza para cobrar sus pedidos. `SUPERADMIN` conserva `/platform` para soporte operativo.

## Preparación para producción

- `GET /api/health` comprueba el proceso y `GET /api/ready` verifica además PostgreSQL.
- `pnpm check` ejecuta tipos, lint, builds y todas las pruebas mediante Turborepo.
- `Dockerfile.api` y `apps/web/Dockerfile` generan imágenes de producción con usuarios sin privilegios.
- `railway.json` despliega migraciones antes de iniciar la API y configura el health check.
- `scripts/backup-postgres.ps1` crea backups verificables con `pg_dump`.

## Crecimiento posterior al piloto

El panel **Crecimiento** reúne analytics por tienda, cupones, variantes, zonas y métodos de envío, dominios personalizados, reglas de notificación y recuperación de carritos. Los cupones, precios de variantes, stock y costos de envío se validan nuevamente en la transacción del checkout. Las funciones PRO se autorizan en la API usando las features del plan.

Para un dominio personalizado, el OWNER registra el hostname y publica el TXT indicado en `_infinityshop.<dominio>`. Después de verificarlo, el proxy de Next.js resuelve el tenant sin aceptar un `tenantId` del navegador. En producción configurá `PLATFORM_HOSTS` con los dominios propios de InfinityFood y `API_INTERNAL_URL` con la URL alcanzable de la API desde el servidor web. El proveedor de hosting también debe tener el dominio y su certificado TLS asociados.

Las automatizaciones guardan un historial de entrega y usan el proveedor configurado. Los envíos pendientes se procesan en segundo plano con reintentos; una falla queda diagnosticada sin impedir que se cree o cobre un pedido.

La guía completa, variables y checklist están en [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md). Ningún secreto real debe guardarse en Git.
