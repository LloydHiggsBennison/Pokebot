# Pokebot

Bot de Discord con tiradas personales `$p` y capturas de Pokémon salvajes. Node.js 22.

`$p` conserva el grid de emojis independientes: cinco filas de tres Pokémon,
con 🔔 o ❌ al final de cada fila. El resultado se envía debajo, con el mismo badge
NEW y sin mención en el texto del resultado. Las probabilidades de 0, 1, 2 y 3 premios
siguen siendo 10%, 65%, 20% y 5%.

## Instalación

```sh
npm ci
cp .env.example .env
```

En Windows puedes usar `Copy-Item .env.example .env`. Completa `DISCORD_TOKEN`,
`CLIENT_ID` y las credenciales de Supabase. Activa **Message Content Intent** en el
portal de Discord. `GUILD_ID` es opcional para registrar comandos en un servidor de prueba.

Con Supabase utiliza las tablas de `supabase_schema.sql`. Si ya tienes las tablas,
no necesitas recrearlas: aplica solamente este índice para acelerar la consulta del badge:

```sql
CREATE INDEX IF NOT EXISTS captures_owner_pokemon_idx
  ON public.captures (guild_id, user_id, pokemon_name);
```

Para habilitar `$pokefuse` en una instalación existente, ejecuta una vez
`supabase_migration_pokefuse.sql` en el SQL Editor de Supabase. Añade la marca shiny,
un índice para localizar cinco copias y una función transaccional que conserva una
captura, consume cuatro y crea la shiny sin permitir doble consumo concurrente.

El código sigue siendo compatible con las tablas existentes aunque el índice aún no
esté aplicado. En una tabla muy grande, el administrador puede crear el índice con
`CONCURRENTLY`, fuera de una transacción. Para desarrollo local sin Supabase se usa
`better-sqlite3`; debe haberse compilado correctamente durante `npm ci`.
`SQLITE_PATH` permite elegir un archivo de pruebas separado.

## Preparar los emojis una vez

```sh
npm run setup:emojis
```

Este comando prepara los **1025 Pokémon y el badge** como emojis de la aplicación.
Usa REST, sin iniciar otra sesión del bot en el Gateway. Debe ejecutarse con el token
de la misma aplicación que enviará los mensajes. Los nombres `pkv2_<id>` y `pk_new`
se reservan para estos recursos.

- Conserva exactamente el procesamiento de los sprites: trim, PNG transparente 128×128.
- Reutiliza lo existente y sube solo lo que falta. No borra emojis del servidor ni de la aplicación.
- La primera carga requiere red y puede tardar varios minutos según Discord/CDN.
- Se reanuda al ejecutar nuevamente el comando tras un fallo. Los emojis ya subidos
  permanecen en Discord aunque Render pierda el disco local.
- Ejecuta un único proceso de preparación por aplicación; no lo solapes con el primer
  arranque de la nueva versión. Puedes prepararlos antes de sustituir la versión anterior.
- Si no ejecutas este comando, el bot hace la misma preparación al arrancar.
  Durante ese primer arranque `$p` responde con el progreso, sin encolar tiradas ni consumir cooldown.
- Si faltan espacios o falla la preparación, revisa el error de consola y reinicia tras
  corregirlo. No se recorta el catálogo ni se reemplazan Pokémon por interrogaciones.

Discord admite hasta 2000 emojis de aplicación. No consumen espacios del servidor ni
requieren `USE_EXTERNAL_EMOJIS`: [documentación de Discord](https://docs.discord.com/developers/resources/emoji).

## Ejecutar y verificar

```sh
npm test
npm start
```

La consola debe mostrar `[Emojis] Listos: 1026`. En reinicios posteriores se consulta
el catálogo existente una sola vez; `$p` no descarga sprites ni crea/elimina emojis.
Prueba `$p` y verifica el grid de cinco filas seguido del resultado.

Cada tirada completada registra `roll_timing`: `settingsMs`, `prepareAndSaveMs`,
`gridSendMs`, `totalMs`. Los límites de Discord se registran como `discord_rate_limit`.
El endpoint `/` informa el estado del proceso, conexión y catálogo; `/ready` devuelve
200 solo si el Gateway está conectado y el catálogo completo, o 503 si no está listo.

```sh
npm run benchmark
```

La comparación es local, con Discord y base de datos simulados. Conserva las pausas
reales del código anterior. Sus milisegundos **no** representan la latencia en Discord.
Consulta [el informe de rendimiento](docs/performance.md).

## Render

El build ahora es `npm ci` y el inicio `npm start`. No se descargan los 1025 sprites
en cada deploy. `npm run sprites` queda como descarga opcional para la preparación inicial.
Si configuraste el build manualmente en el panel de Render, actualízalo allí también.

`render.yaml` conserva el plan Free existente. Para respuesta continua, el proceso debe
estar activo: Render Free puede suspender un servicio por inactividad y necesita volver
a arrancarlo. Una optimización de código no elimina esa suspensión.
[Limitaciones oficiales de Render](https://render.com/docs/free#spinning-down-on-idle).

Usa Supabase para persistencia en Render: su disco local efímero no conserva SQLite entre reinicios.
Ejecuta una sola instancia del bot por aplicación: la protección de tiradas simultáneas
es local al proceso, no un bloqueo distribuido entre réplicas.

## Comandos

`npm run deploy` registra `/pokeconfig` globalmente y también en `GUILD_ID` si está configurado.

| Comando | Uso |
|---|---|
| `$p` | Tirada personal |
| `$pokedex` | Colección personal paginada, con cantidades de Pokémon repetidos |
| `$pokefuse` | Fusión personal: cinco copias normales iguales → conserva una y crea una shiny |
| `<comando> <nombre>` | Atrapar el Pokémon salvaje activo |
| `/pokeconfig canal` | Canal para apariciones salvajes |
| `/pokeconfig modo` | `messages`, `time`, `both` |
| `/pokeconfig umbral_mensajes` | Rango de mensajes para cada aparición |
| `/pokeconfig intervalo` | Segundos entre apariciones |
| `/pokeconfig comando_captura` | Alias de `$p` y comando para capturas |
| `/pokeconfig cooldown` | Segundos entre tiradas personales; 0 desactiva |
| `/pokeconfig activar` | Activa/pausa apariciones salvajes |
| `/pokeconfig ver` | Consulta configuración |

La configuración se guarda en Supabase/SQLite. La caché es fresca durante 30 segundos;
después se actualiza en segundo plano al usarla, sin bloquear la tirada. Si esa consulta
falla, se conserva la última configuración conocida durante un máximo de cinco minutos,
con diez segundos entre reintentos. Después se exige una lectura correcta. Los cambios
por `/pokeconfig` invalidan inmediatamente la caché y una respuesta antigua no puede
sobrescribirlos. Cambios directos en la base se ven al completar la actualización.
`SUPABASE_TIMEOUT_MS` permite ajustar el límite por petición: 15000 ms por defecto,
acotado entre 1000 y 60000. No se reintentan automáticamente escrituras de premios.
El cooldown se consulta cuando está habilitado y se persiste
en cada tirada. Los premios se guardan antes de anunciar el resultado.

Proyecto de fans, no afiliado con Nintendo, Game Freak ni The Pokémon Company.

## Pokédex personal

`$pokedex` muestra únicamente las capturas de quien escribe el comando en ese servidor.
No acepta menciones ni IDs para consultar la colección de otra persona. El mensaje lleva
su nombre y avatar, una Pokédex roja, diez especies por página y cantidades como `x2`.
El contador indica especies diferentes obtenidas sobre 1025; las copias no aumentan
ese contador. El orden es el de primera captura.

Los botones 👈/👉 recorren las páginas y vuelven al principio/final. Solo el autor puede
usarlos; otros usuarios reciben un aviso privado para abrir su propia Pokédex. La lista
es visible en el canal como en un embed normal de Discord. La navegación dura diez minutos
(o hasta reiniciar el bot) y luego se puede abrir otra con `$pokedex`. Cada apertura
obtiene una nueva instantánea; capturas posteriores aparecen al ejecutar el comando de nuevo.

Las páginas se mantienen en memoria para navegar sin consultas adicionales. Las lecturas
filtran servidor y usuario en la base de datos y recorren todo el historial por ID, incluso
si Supabase limita la cantidad de filas devueltas. No requiere migraciones ni registrar
nuevos comandos slash. El bot necesita `Embed Links` y `Attach Files` en el canal, además
de los permisos de mensajes existentes.

## Fusión shiny

`$pokefuse` muestra un selector para el autor con cada especie que tiene al menos cinco
copias normales. Al confirmar, la base de datos conserva la captura normal más antigua,
consume exactamente cuatro y registra una captura shiny. Las shiny no cuentan como
ingredientes para otra fusión. El selector expira en cinco minutos y rechaza clics de
otros usuarios, servidores o mensajes.

Cada fusión confirmada muestra un GIF de 480×320 con 60 fotogramas: el original
permanece a un lado, las otras cuatro copias se convierten en energía y aparece
el sprite shiny de la misma especie entre destellos y estrellas. Dura unos siete
segundos, se reproduce una vez y termina mostrando el shiny. Respeta español/inglés.
La reproducción automática depende de los ajustes de imágenes de Discord.

El GIF se genera después del guardado en un worker, con una caché de hasta 24 MB.
Solo se renderiza una animación a la vez para limitar memoria/CPU. Si el renderer
está ocupado, falla la descarga del sprite o se supera el tiempo de preparación,
se muestra el sprite shiny estático y se confirma igualmente la fusión guardada.
Un error de imagen nunca vuelve a consumir Pokémon ni anuncia que falló el guardado.
Esta presentación no requiere migraciones adicionales.

## Capturas salvajes, Pokécoins e idiomas

Antes de desplegar esta versión, ejecuta `supabase_migration_wild_rewards.sql` en
el SQL Editor, también si estás creando una instalación nueva con el esquema base.
Requiere la clave **service_role** en el servidor del bot para las nuevas tablas
protegidas por RLS; no se concede acceso público a saldos ni preferencias.
SQLite añade las columnas/tablas automáticamente. Las capturas anteriores se conservan.

Captura con **@Pokebot catch absol** (mención real al bot y nombre del Pokémon).
El alias configurado, por ejemplo `$p absol`, también funciona. Solo se acepta en
el canal donde apareció el Pokémon. Un ejemplo de respuesta es:

> ¡Felicidades **@Sekai**! ¡Atrapaste un Absol de nivel 10 (65.59%)! Añadido a tu Pokédex. ¡Recibiste 35 Pokécoins!

Cada aparición genera un nivel entre 1 y 100 y seis IV entre 0 y 31.
El porcentaje es la suma de IV dividida entre 186, redondeada a dos decimales.
Estos valores se guardan con la captura; no son estadísticas inventadas al responder.

| Categoría | Pokécoins |
|---|---:|
| Común | 10 |
| Poco común | 20 |
| Raro (incluye Absol) | 35 |
| Legendario | 150 |
| Mítico | 300 |

Las categorías son reglas del bot: primero se comprueban los indicadores mítico y
legendario; para el resto, tasa de captura ≤45 es raro, ≤120 es poco común y >120
es común. No cambia la distribución de apariciones existente. Los metadatos de las
1025 especies se guardan en `data/species-rarity.json`, derivados del
[CSV de especies de PokéAPI](https://github.com/PokeAPI/pokeapi/blob/master/data/v2/csv/pokemon_species.csv)
(2026-09-13). No se consulta PokéAPI durante una captura.

`$pokecoins` (también `$saldo` / `$balance`) consulta tu saldo en ese servidor.
La captura, el registro del premio y el incremento del saldo se guardan juntos.
El identificador único de aparición impide duplicados al repetir un intento cuyo
resultado fue incierto. Tras un error de base, el primer usuario puede repetir su
comando; la aparición queda reservada hasta confirmar el resultado.
Ejecuta una sola instancia del bot, pues el estado de las apariciones reside en memoria.

`$idioma` o `$language` abre el selector **Español / English**. La preferencia personal
se guarda y se aplica a tiradas, Pokédex, fusiones, capturas, saldos y respuestas de
configuración. No requiere consultas de idioma en cada comando: se cargan al arrancar.
`$idioma servidor` / `$language server` requiere **Administrar servidor** y cambia el
idioma de anuncios públicos y el predeterminado para quienes aún no eligieron uno.
Español es el valor inicial. Reinicia el bot después de aplicar la migración o de
editar idiomas directamente en la base.

Los nombres y descripciones del menú slash se traducen según el idioma de Discord,
mediante sus localizaciones nativas; `npm run deploy` actualiza ese menú.

