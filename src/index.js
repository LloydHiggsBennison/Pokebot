require('dotenv').config();
const { startHealthServer } = require('./healthServer');
startHealthServer(); // Render necesita un puerto activo
const fs = require('fs');
const path = require('path');
const { Client, GatewayIntentBits, Collection } = require('discord.js');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
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
  const listener = (...args) => event.execute(...args, client);
  if (event.once) {
    client.once(event.name, listener);
  } else {
    client.on(event.name, listener);
  }
}

client.login(process.env.DISCORD_TOKEN);
