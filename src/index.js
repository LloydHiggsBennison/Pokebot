require('dotenv').config();
const { startHealthServer } = require('./healthServer');
const fs = require('fs');
const path = require('path');
const { withLanguage, languageFor, initializeLanguages } = require('./i18n');
const { Client, GatewayIntentBits, Collection } = require('discord.js');

const client = new Client({
  rest: { timeout: 10000, retries: 1 },
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});
const { getEmojiStatus } = require('./emojiManager');
client.once('ready',()=>require('./battleManager').startBattleSweeper(client));
startHealthServer(() => ({ connected: client.isReady(), emojis: getEmojiStatus(client) }));
client.rest.on('rateLimited', info => {
  console.warn(JSON.stringify({ event: 'discord_rate_limit', route: info.route,
    retryAfterMs: info.retryAfter, global: info.global }));
});

// Cargar comandos slash
client.commands = new Collection();
const commandsPath = path.join(__dirname, 'commands');
for (const file of fs.readdirSync(commandsPath).filter((f) => f.endsWith('.js'))) {
  const command = require(path.join(commandsPath, file));
  client.commands.set(command.data.name, command);
}

// Cargar eventos
const eventsPath = path.join(__dirname, 'events');
for (const file of fs.readdirSync(eventsPath).filter((f) => f.endsWith('.js'))) {
  const event = require(path.join(eventsPath, file));
  const listener = (...args) => Promise.resolve()
    .then(() => withLanguage(languageFor(args[0]?.author?.id || args[0]?.user?.id, args[0]?.guildId || args[0]?.guild?.id), () => event.execute(...args, client)))
    .catch(error => console.error(`[Evento ${event.name}]`, error));
  if (event.once) {
    client.once(event.name, listener);
  } else {
    client.on(event.name, listener);
  }
}

initializeLanguages().catch(error => console.error('[Idiomas]',error.message))
  .then(() => client.login(process.env.DISCORD_TOKEN)).catch(error => {
  console.error('[Login]', error.message);
  process.exit(1);
});
