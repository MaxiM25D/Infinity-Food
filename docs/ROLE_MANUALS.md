# Guía operativa por rol

## Antes de abrir el turno

El administrador confirma sucursal activa, horarios, carta y precios; el cajero abre caja con el efectivo contado; el responsable de cocina abre KDS y filtra su estación; cada mozo verifica sucursal y mesas asignadas. Se realiza un pedido de prueba sin cobro real y se anula dejando auditoría.

## Cliente

Escanea el QR de la mesa o abre la carta pública, elige productos y modificadores, revisa cantidades y envía el pedido. Para reservas usa el horario local del restaurante y conserva la confirmación. Ante una demora no debe reenviar repetidamente el pedido: el personal consulta el estado persistido.

## Mozo

Trabaja siempre en la sucursal indicada en el encabezado. Abre o selecciona mesa, agrega una ronda y confirma una sola vez. Las correcciones posteriores usan ajustes, cortesías o anulaciones auditadas; no se reemplaza un pedido histórico. Antes de liberar una mesa comprueba saldo cero o devolución registrada.

## Cocina y barra

Cada estación visualiza sólo sus tickets. Cambia estados en orden: pendiente, preparación, listo y entregado. Una reconexión recarga desde base; no se recrean tickets manualmente. Si una impresión falla, se reintenta el trabajo existente mediante su clave idempotente.

## Caja

Abre una única caja por turno y registra cada entrada o salida con motivo. Los pagos parciales se cargan por su medio real. Mercado Pago sólo se acredita después de la confirmación del proveedor. El cierre requiere reconciliar ventas, devoluciones, efectivo esperado y contado; una diferencia se documenta, no se corrige borrando movimientos.

## Administrador del restaurante

Gestiona carta, disponibilidad, mesas, estaciones, usuarios, inventario y reportes dentro de su tenant. Asigna sólo las sucursales necesarias. Revisa diariamente pagos pendientes, cola de notificaciones, stock negativo, reservas no-show y cierre de caja. No comparte cuentas entre operadores.

## Superadmin y soporte

El acceso global se usa sólo para tareas de plataforma. El modo soporte es temporal, queda auditado y no habilita acciones sensibles. Nunca solicita contraseñas ni tokens del restaurante. Para investigar, registra tenant, sucursal, versión y `requestId`; sale del modo soporte al finalizar.

## Operación degradada

Si no hay red, no prometer que una acción llegó al servidor. Anotar pedidos y cobros en una planilla numerada de contingencia, sin intentar cobros repetidos. Al volver el servicio, una sola persona carga y reconcilia lo pendiente bajo supervisión del administrador.
