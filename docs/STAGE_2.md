# Etapa 2 — Carta gastronómica por sucursal

## Alcance implementado

- Reutilización de `Category` como sección de carta y `Product` como plato o bebida.
- Secciones con descripción, visibilidad y orden de presentación.
- Platos con tiempo estimado de preparación, alérgenos y preferencias alimentarias.
- Configuración independiente por sucursal mediante `BranchMenuItem`.
- Disponibilidad `AVAILABLE`, `SOLD_OUT` o `HIDDEN` por sucursal.
- Precio opcional, orden y destaque específicos de cada sucursal.
- Alta automática de platos en todas las sucursales existentes.
- Alta automática del catálogo al crear una nueva sucursal.
- Sincronización equivalente para importaciones y tienda demo.
- Selector visual de sucursal en el panel administrativo.
- Pantalla de edición de carta para la sucursal activa.
- Carta pública responsive en `/carta/:restaurantSlug/:branchSlug`.
- Código QR SVG descargable para cada carta.
- Metadata dinámica y caché pública breve para la carta.

## Decisión de compatibilidad

No se renombraron las tablas `Product` y `Category`. Funcionan como catálogo canónico y evitan una migración destructiva del ecommerce existente. `BranchMenuItem` contiene únicamente las diferencias operativas por sucursal. El checkout y los pedidos históricos continúan referenciando el mismo producto.

## Seguridad y aislamiento

- La API administrativa obtiene tenant y sucursal desde la sesión.
- Un `STAFF` solo puede seleccionar sucursales asignadas.
- `OWNER` y `ADMIN` pueden editar cualquier sucursal del restaurante.
- El rol de sucursal `MANAGER` puede administrar su propia carta.
- La carta pública se resuelve exclusivamente mediante slugs de restaurante y sucursal activos.
- Las relaciones compuestas impiden asociar un plato con una sucursal de otro tenant.

## Límites de esta etapa

- La carta es informativa; la toma de pedidos por mesa se implementará con comandas.
- Los modificadores gastronómicos todavía reutilizan variantes y se formalizarán junto con pedidos.
- No se incorporaron KDS, reservas, caja ni WebSocket.
- El inventario continúa siendo global al restaurante.

## Criterios de validación

1. Las 28 migraciones se aplican sobre una base vacía.
2. El seed crea cartas utilizables para sus sucursales principales.
3. Precio y disponibilidad pueden diferir entre dos sucursales.
4. Los productos nuevos e importados quedan vinculados a las sucursales correspondientes.
5. El QR apunta a la URL pública de la sucursal activa.
6. Typecheck, lint, build, tests e imágenes Docker finalizan correctamente.
