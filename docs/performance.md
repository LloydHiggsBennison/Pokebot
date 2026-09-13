# Revisión y mejora de `$p`

Base revisada: `a43dd79` de `LloydHiggsBennison/Pokebot` (rama `main`).
Se revisaron todos los módulos de `src`, eventos, comandos, scripts, configuración de
Render, dependencias, esquema SQL, catálogo y la simulación existente.

## Diagnóstico

El mayor cuello de botella está en `emojiManager.js`, llamado por `puzzleManager.js`
antes de responder al mensaje. Cada tirada puede necesitar 15 emojis distintos de un
catálogo de 1025. El código anterior solo reserva 48 espacios de servidor y crea los
faltantes en serie. Después de **cada** creación espera 600 ms: una tirada sin premios
con 15 emojis nuevos ya acumula **9 segundos de pausas**, sin contar red ni rate limits.

Al agotarse esos espacios, también borra emojis y vuelve a subir otros. Precalentar 45
en segundo plano no evita el problema: consume los mismos límites y no hay exclusión
mutua global entre el precalentamiento y las tiradas. La secuencialidad existe solo
dentro de cada llamada. La documentación de Discord advierte que las operaciones de
emojis de servidor tienen límites especiales por servidor, y las cuotas informadas
pueden ser imprecisas. Esto explica un mecanismo compatible con las esperas reportadas
cercanas a 30 minutos; **no se midió esa espera contra el bot real ni se obtuvieron sus logs**.

Otros hallazgos:

- La caché original usa solo el ID del Pokémon y el badge tiene una única variable
  global: podía devolver emojis pertenecientes a otro servidor.
- La limpieza acepta el prefijo `pk_`, que también coincide con `pk_new`: podía borrar
  el badge y mantener su referencia en caché.
- Borrar emojis de rotación también perjudica los grids ya publicados que los referencian.
- `pokemonPool` decía cargar solo disco, pero su fallback podía descargar hasta 1025
  sprites durante la primera tirada. No había timeout ni garantía de catálogo completo.
- Mensajes normales y tiradas repetían consultas de configuración. Incluso con cooldown
  desactivado se consultaba `user_rolls`.
- Hasta tres premios generaban tres inserciones separadas. Los errores de Supabase se
  registraban o ignoraban y podían terminar anunciando premios no guardados.
- No había protección contra dos tiradas simultáneas del mismo usuario.
- La consulta para NEW no tenía índice por servidor, usuario y Pokémon.
- Los spawns recibían `spriteUrl`, pero el embed y la captura esperaban `image`.
- Los errores de listeners async y del timer podían quedar sin gestionar.
- El README describía SQLite/PokeAPI y un registro de comandos que ya no coincidían con el código.

Fuentes: [emojis de Discord](https://docs.discord.com/developers/resources/emoji),
[rate limits](https://docs.discord.com/developers/topics/rate-limits),
[SDK de emojis de aplicación](https://discord.js.org/docs/packages/discord.js/main/ApplicationEmojiManager%3AClass).
También se comprobó la implementación de `ApplicationEmojiManager` de discord.js
14.27.0, fijada por el lockfile del repositorio.

## Solución implementada

Se utiliza un catálogo persistente de **emojis de aplicación**. Discord admite 2000:
caben los 1025 Pokémon y el badge sin reutilizar espacios. Se crean una sola vez,
y se consultan al arrancar. Los emojis antiguos de los servidores no se borran.

`$p` se limita a escoger IDs/nombres del JSON local, buscar los emojis en memoria,
verificar/guardar premios y enviar los dos mensajes. No descarga, no procesa imágenes,
no sube emojis, no borra emojis y no tiene pausas artificiales. Se conservan los 1025
Pokémon; no se restringe el sorteo a un subconjunto de emojis disponibles.

La primera preparación puede tardar varios minutos. El comando `npm run setup:emojis`
permite completarla antes de cambiar el bot activo; los reinicios reutilizan el catálogo
persistido en Discord. Si se interrumpe, al reintentarlo solo se preparan los pendientes.
Durante la preparación `$p` informa inmediatamente del progreso, sin consumir una tirada.
El bot no declara el catálogo listo si faltan Pokémon, el badge o espacios.

Cambios complementarios:

- Caché de configuración de 30 segundos, con consultas concurrentes compartidas,
  límite de memoria e invalidación al cambiar `/pokeconfig`.
- Reutilización de configuración entre handlers; se omite la lectura de cooldown si vale 0.
- Una inserción por lote para los premios, con transacción local en SQLite.
- Errores de base de datos propagados antes de anunciar éxito; HTTP abortado a 5 s por
  petición de Supabase, sin los reintentos automáticos de lectura que prolongaban fallos.
- Una tirada en curso por usuario y servidor. Se espera la finalización de ambas escrituras
  incluso si una falla, antes de liberar el bloqueo.
- Índice compuesto de capturas, automático en SQLite y incluido en el esquema de Supabase.
- Fisher–Yates para barajar el catálogo sin el sesgo de `sort(Math.random)`.
- Lectura/escritura asíncrona de sprites solo durante preparación, timeout, deduplicación
  de peticiones y guardado mediante archivo temporal. La descarga opcional avisa y falla
  si queda incompleta.
- Corrección de `image` para spawns, propagación del reinicio de timer y manejo de errores async.
- Build de Render con `npm ci`, sin descargar todo el catálogo en cada deploy.
- Logs de duración de tiradas y límites REST; `/ready` distingue proceso activo de bot listo.
- Pruebas automáticas y workflow de GitHub Actions.

Se verificaron las opciones del cliente contra supabase-js 2.115.0 instalado y su
[changelog](https://supabase.com/changelog). El SDK real se utiliza en pruebas con
respuestas HTTP simuladas; no se accedió a un proyecto Supabase de producción.

## Conservación del grid

El mensaje sigue siendo texto de emojis independientes, sin imagen adjunta ni embed:
cinco filas, tres Pokémon por fila, separados por un espacio, y 🔔/❌ al final.
Se mantiene el mensaje de resultado debajo, capitalización, badge condicional y texto
sin mención del usuario. Los ganadores conservan sus probabilidades 10/65/20/5%.

El procesamiento sigue siendo `trim()` → `resize(128, 128, contain, transparente)` → PNG.
`assets/new_badge.webp`, `data/pokemon.json` y `src/imageGrid.js` se conservan sin cambios.
Cambian los IDs de Discord al pasar de emojis del servidor a emojis de la aplicación;
no cambian los sprites ni la composición. Las imágenes que entregue Discord y su tamaño
final siguen dependiendo del cliente de Discord.

Las pruebas comparan literalmente grid y resultado con el código original archivado en
`test/fixtures`, para 0/1/2/3 premios y Pokémon nuevos/repetidos. Otra prueba compara
los bytes de salida de Sharp usando una imagen con transparencia. No se hizo una
inspección visual en una sesión real de Discord.

## Medición local reproducible

Comando: `npm run benchmark`. Node v22.20.0, Windows x64. APIs de Discord y base de datos
simuladas con respuesta inmediata. Las pausas originales de 600 ms y el procesamiento
Sharp sí se ejecutan realmente.

| Medición | Resultado |
|---|---:|
| Antes: 15 emojis no cacheados | 9235.606 ms |
| Antes: mismos 15 emojis ya cacheados | 0.067 ms |
| Ahora: búsqueda de 15 emojis preparados | 0.072 ms |
| Antes: creaciones en la tirada fría | 15 |
| Ahora: creaciones durante las tiradas | 0 |
| 1000 tiradas completas simuladas, mediana | 0.035 ms |
| 1000 tiradas completas simuladas, p95 | 0.093 ms |
| 1000 tiradas completas simuladas, máximo | 0.995 ms |

La mejora consiste en eliminar el camino de creación/borrado repetido: una búsqueda
que ya estaba cacheada antes también era rápida. Estos números **no son tiempos de
respuesta de Discord**, ni prueban que en producción se pase de 30 minutos a 0.093 ms.
Con el catálogo listo, el tiempo real queda dominado por Supabase y el envío de mensajes.
Para validarlo se añadieron los logs `roll_timing` y `discord_rate_limit`.

## Comprobaciones

- `npm test`: **27 pruebas aprobadas, 0 fallos**. Sintaxis JavaScript y `git diff --check` correctos.
- `npm ci`: dependencias necesarias para Supabase/Discord/Sharp instaladas.
- Pruebas de compatibilidad del grid y resultado, bytes del sprite, concurrencia,
  cooldown, fallos de guardado, catálogo incompleto, límite de capacidad, reintentos de
  preparación, aislamiento entre aplicaciones y reutilización tras reinicio.
- 100 tiradas simultáneas sin API de emojis ni lecturas de sprites en ejecución.
- Pruebas usando el SDK real de Supabase con HTTP simulado: caché, inserción por lote,
  filtrado de propietario, cooldown y propagación de errores sin reintentos.
- Consultas SQLite ejecutadas en una base real en memoria mediante `node:sqlite` y
  adaptador de pruebas. `EXPLAIN QUERY PLAN` confirma uso del índice de capturas.
  No se validó el binario de `better-sqlite3`: su compilación opcional fue omitida por
  restricciones del entorno Windows. Esto no afecta al camino de producción con Supabase.
- Timeout verificado con un servidor HTTP local real que deja el cuerpo sin terminar.
- Preparación REST probada con las clases reales de discord.js y transporte simulado.
- No se modificaron tablas remotas, no se conectó a Discord ni se desplegó en Render.

## Aplicación y validación en producción

1. Instalar esta versión con Node 22 y `npm ci`, conservando las variables existentes.
2. Aplicar el índice de `README.md` a Supabase. No es necesario recrear tablas.
3. Con el token de la aplicación, ejecutar `npm run setup:emojis` una sola vez. No
   ejecutar en paralelo con el primer arranque de esta versión.
4. Sustituir la versión anterior, usar build `npm ci` e inicio `npm start` y esperar
   `[Emojis] Listos: 1026` / `/ready` HTTP 200.
5. Probar varias tiradas: mismo grid, resultado debajo, badge solo cuando corresponde,
   cooldown activo y premios persistidos. Revisar `totalMs` y `gridSendMs`.
6. Si sigue existiendo demora, correlacionar con `discord_rate_limit`, tiempos de base
   de datos, desconexiones de Gateway y suspensiones de Render. Los logs anteriores
   `inició una tirada` / `completada` no permitían separar esos componentes.

`render.yaml` usa Render Free. Ese plan puede suspender procesos por inactividad; el
arranque posterior requiere tiempo. Para mantener disponibilidad continua hace falta
un proceso que permanezca activo; no se cambió el plan ni se contrató infraestructura.
[Documentación de Render](https://render.com/docs/free#spinning-down-on-idle).

Se conserva la arquitectura de persistencia existente: cooldown y lote de capturas
son dos operaciones distintas en Supabase. Un fallo parcial puede guardar una sin la
otra; ahora se detecta y no se anuncia éxito, pero esto no equivale a una transacción
atómica entre ambas tablas. El bloqueo es por proceso; no ejecutar varias réplicas del
mismo bot. Tampoco se implementa reenvío durable si Discord falla después del guardado.
Estos límites deben considerarse al escalar o al exigir entrega exactamente una vez.
