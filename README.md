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
| `<comando> <nombre>` | Atrapar el Pokémon salvaje activo |
| `/pokeconfig canal` | Canal para apariciones salvajes |
| `/pokeconfig modo` | `messages`, `time`, `both` |
| `/pokeconfig umbral_mensajes` | Rango de mensajes para cada aparición |
| `/pokeconfig intervalo` | Segundos entre apariciones |
| `/pokeconfig comando_captura` | Alias de `$p` y comando para capturas |
| `/pokeconfig cooldown` | Segundos entre tiradas personales; 0 desactiva |
| `/pokeconfig activar` | Activa/pausa apariciones salvajes |
| `/pokeconfig ver` | Consulta configuración |

La configuración se guarda en Supabase/SQLite y se cachea hasta 30 segundos. Los cambios
por `/pokeconfig` invalidan inmediatamente la caché; cambios directos en la base pueden
necesitar hasta 30 segundos. El cooldown se consulta cuando está habilitado y se persiste
en cada tirada. Los premios se guardan antes de anunciar el resultado.

Proyecto de fans, no afiliado con Nintendo, Game Freak ni The Pokémon Company.
