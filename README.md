# PokeBot 🎮

Bot de Discord estilo **Mudae**, pero para capturar Pokémon. Los Pokémon aparecen
solos en un canal configurado y los usuarios los atrapan escribiendo un comando
seguido del nombre (por defecto `$p <nombre>`).

Lo distinto de Mudae: **el "spam" de spawns es 100% configurable por servidor**,
tanto por cantidad de mensajes como por tiempo, o ambos a la vez.

## Requisitos

- Node.js 18 o superior
- Una aplicación de Discord creada en https://discord.com/developers/applications

## Instalación

```bash
npm install
cp .env.example .env
```

Completa el archivo `.env`:

```
DISCORD_TOKEN=el_token_de_tu_bot
CLIENT_ID=el_application_id_de_tu_bot
GUILD_ID=el_id_de_tu_servidor_de_pruebas
```

**Importante:** en el portal de desarrolladores de Discord, dentro de tu
aplicación → Bot, activa el intent **"MESSAGE CONTENT INTENT"**. Sin esto el
bot no puede leer el contenido de los mensajes ni contar el spam para los
spawns.

## Registrar los comandos slash

```bash
npm run deploy
```

Esto registra `/pokeconfig` solo en el servidor indicado en `GUILD_ID`
(aparece al instante). Si luego quieres que funcione en todos los servidores
donde esté el bot, cambia esa línea en `src/deploy-commands.js` a
`Routes.applicationCommands(process.env.CLIENT_ID)` (tarda ~1 hora en
propagarse globalmente).

## Iniciar el bot

```bash
npm start
```

## Configuración (comandos slash, requieren permiso "Administrar servidor")

| Comando | Qué hace |
|---|---|
| `/pokeconfig canal` | Define el canal donde aparecen los Pokémon |
| `/pokeconfig modo` | `messages`, `time` o `both` |
| `/pokeconfig umbral_mensajes min max` | Rango de mensajes para el spawn (modo `messages`/`both`) |
| `/pokeconfig intervalo segundos` | Cada cuántos segundos aparece un Pokémon (modo `time`/`both`) |
| `/pokeconfig comando_captura` | Cambia el comando de captura (por defecto `$p`) |
| `/pokeconfig activar true/false` | Activa o pausa los spawns |
| `/pokeconfig ver` | Muestra la configuración actual del servidor |

Por defecto, cada servidor arranca en modo `messages`, con un umbral aleatorio
entre 15 y 40 mensajes (igual que el comportamiento típico de Mudae), sin
canal configurado (hay que fijarlo primero con `/pokeconfig canal`).

## Cómo funciona por dentro

- **`src/database.js`** — guarda la configuración de cada servidor y el
  historial de capturas en SQLite (`pokebot.sqlite`, se crea solo).
- **`src/spawnManager.js`** — lleva el contador de mensajes por servidor, el
  timer de tiempo, y decide cuándo aparece un Pokémon nuevo.
- **`src/pokemonService.js`** — pide un Pokémon aleatorio a
  [PokeAPI](https://pokeapi.co) (nombre + imagen oficial).
- **`src/events/messageCreate.js`** — detecta el comando de captura e
  incrementa el contador de mensajes.
- **`src/commands/config.js`** — comando slash `/pokeconfig`.

## Escalar a futuro

SQLite funciona perfecto para un bot en pocos servidores. Si tu bot termina
en cientos/miles de servidores, lo único que tendrías que cambiar es
`src/database.js` para usar PostgreSQL (por ejemplo con `pg` o un ORM como
Prisma) — el resto del código no necesita tocarse porque solo importa esas
funciones (`getGuildSettings`, `updateGuildSettings`, etc.).

## Nota

Este es un proyecto de fans, no afiliado con Nintendo, Game Freak ni The
Pokémon Company. Usa PokeAPI (no oficial) solo para las imágenes/nombres.
Pensado para uso personal/educativo en tus propios servidores.
