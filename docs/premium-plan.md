# Comercio y premium

Requiere PostgreSQL/Supabase. El bot anterior mantiene su soporte SQLite si
COMMERCE_ENABLED no está activado. Los pagos reales aún no están verificados.

## Activación

1. Ejecutar supabase/migrations/20261014235948_premium_commerce.sql después
   de las migraciones de capturas, transferencias y batallas. Es repetible y
   no reinicia saldos ni colecciones.
2. Desplegar y registrar /paypalsetup, /pokeshop y /pokekey.
3. Configurar PAYPAL_ENV=sandbox, PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET,
   PUBLIC_URL=https://pokebot-i345.onrender.com y BOT_OWNER_ID=468832874066608135.
4. El propietario ejecuta /paypalsetup. Crea producto, planes y webhook en
   /paypal/webhook; guarda sus IDs en commerce_config. Reintentar si falla.
   No hace falta copiar el ID del webhook a Render.
5. Activar COMMERCE_ENABLED=true en Render y esperar el despliegue.
6. Probar /pokeshop usando una cuenta compradora Sandbox diferente de la
   cuenta vendedora. Verificar el pago y consultar $pokewallet. Repetir la
   entrega del webhook y comprobar que no se duplica el premio. El botón
   Verificar pago queda deshabilitado tras el primer clic, incluso ante un error.
   Los pagos pendientes se confirman automáticamente por webhook. Canjear tickets,
   probar una suscripción y cancelar su renovación desde PayPal.

Sandbox solo permite compras al propietario. Sus premios se guardan realmente
en la cartera y colección del servidor utilizado: usar un servidor de pruebas.
Live necesita sus propias credenciales y ejecutar /paypalsetup nuevamente.
No pasar a Live hasta completar las pruebas de extremo a extremo.

## Comandos

- /pokeshop: enlaces de compra privados y botón Verificar pago.
- /paypalsetup: configuración reservada al propietario.
- /pokekey crear: claves de un uso para suscripciones o paquetes, solo propietario.
  Canjear dentro de 30 días. Duración premium elegida de 1 a 366 días.
  El campo días no afecta a los paquetes de créditos.
- /pokekey canjear: canje privado. Se guarda un hash, no la clave.
- $pokewallet, $poketickets y $pokemarket: cartera, compras y canjes.
- $plvl: selector privado paginado; un caramelo por uso, +1000 EXP, máximo
  nivel 100, sin evolución ni cambios de IV. No permite copias en batalla.
- $pw nombre: galería de imágenes y GIF, también admite shiny.

## Reglas

- Ventanas fijas de 10 minutos: 1 tirada base, +2 del servidor y +2 personal.
  Ambas suscripciones suman 5. $p N consume N. Premios y cupo se guardan juntos.
- Premium personal habilita fusión e intercambio. Ambos participantes del
  intercambio necesitan premium; recibir un regalo no lo requiere.
- Regalos completados: 1 diario sin premium, 5 con premium. Cupo por donante
  entre todos los servidores. Cancelados y fallidos no consumen cupo.
- Batallas: 50% de EXP sin premium, 100% con premium. Se conservan fracciones
  (25 pasa a 12,5) y las protecciones antiabuso existentes.
- Mercado: 7 compras diarias por usuario y servidor, precios 100, 200, 400,
  600, 800, 1000 y 2000. Elegir Pokécoins o créditos al comprar.
- Reinicio diario a medianoche America/Santiago, respetando horario de verano.
  El inventario acumulado no se borra.
- Tirada especial: un Pokémon garantizado. Pesos relativos existentes:
  raro 25/30, legendario 4/30 y mítico 1/30. Shiny independiente de 5%.
- Capacidad de tiradas especiales: 10 sin premium, 50 con premium. Al vencer
  premium no se borran; no se puede comprar hasta bajar del nuevo límite.
- Cada captura salvaje añade un caramelo EXP. Compra de caramelos: 100 créditos
  por 1000 EXP (precio inicial de implementación).
- Personal US$5/mes, servidor US$10/mes, con renovación automática. Cancelar
  desde PayPal detiene renovaciones y conserva el período ya pagado.
- Paquetes: US$1=300 créditos, US$5=700, US$10=1300, US$20=2100,
  US$50=10000 + 5 tickets legendarios shiny + 1 ticket mítico normal.
  Especies aleatorias, pueden repetirse. Los seis tickets del paquete son
  independientes del inventario de tiradas especiales y su tope 10/50.
- Pokécoins y créditos son saldos separados con valor de compra 1:1.
  Saldos e inventario pertenecen al usuario y servidor de compra. Premium
  personal se aplica al usuario en todos los servidores.

## Integridad y operación

La vuelta del navegador no entrega premios. El backend comprueba identidad,
importe USD, producto y estado del pago con PayPal. Verifica las firmas de los
webhooks. Recibos transaccionales impiden duplicar créditos, tickets y canjes.
Renovaciones requieren último pago comprobado y próxima fecha de facturación.
Los webhooks de pago completado se reintentan si PayPal aún no sincronizó el estado.

Reembolsos/reversiones bloquean la cartera para revisión y revocan el acceso
vinculado al pago. Un operador debe revisar premios consumidos antes de resolver
el bloqueo. Los eventos sin compra identificable requieren conciliación y no se
ignoran como éxito. Conservar logs de errores de PayPal y monitorizar webhooks.

Las tablas tienen RLS y acceso exclusivo service_role. Las funciones anteriores
permanecen para compatibilidad con el modo desactivado, solo para el backend.
No configurar COMMERCE_ENABLED hasta haber instalado el SQL.

Documentación oficial:
https://developer.paypal.com/api/subscriptions/v1
https://developer.paypal.com/api/orders/v2
https://developer.paypal.com/api/webhooks/v1/verify-webhook-signature-post
