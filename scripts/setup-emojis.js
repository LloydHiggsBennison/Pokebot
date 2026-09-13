require('dotenv').config();
const { Client, ClientApplication, Routes } = require('discord.js');
const { initializeEmojis } = require('../src/emojiManager');

// REST only: prepare the application catalog before switching the running bot.
// Run a single setup process per application (do not overlap with first startup).
async function setupApplicationEmojis(client) {
  const application = await client.rest.get(Routes.currentApplication());
  client.application = new ClientApplication(client, application);
  await initializeEmojis(client);
}

async function main() {
  if (!process.env.DISCORD_TOKEN) throw new Error('Falta DISCORD_TOKEN.');
  const client = new Client({ intents: [], rest: { timeout: 10000, retries: 1 } });
  try {
    client.rest.setToken(process.env.DISCORD_TOKEN);
    await setupApplicationEmojis(client);
  } finally {
    await client.destroy();
  }
}

if (require.main === module) {
  main().catch(error => { console.error('[Setup emojis]', error.message); process.exitCode = 1; });
}
module.exports = { setupApplicationEmojis };
