const { Events } = require('discord.js');
const { startTimeSpawner } = require('../spawnManager');
const { startPool } = require('../pokemonPool');
const { initializeEmojis } = require('../emojiManager');

module.exports = {
  name: Events.ClientReady,
  once: true,
  async execute(client) {
    console.log(`✅ Bot conectado como ${client.user.tag}`);
    startPool();
    // A slow guild's database cannot delay the emoji catalog.
    for (const guild of client.guilds.cache.values()) {
      startTimeSpawner(client, guild.id).catch(error => console.error('[Spawner]', error.message));
    }
    try {
      await initializeEmojis(client);
    } catch (error) {
      console.error('[Emojis] Preparación incompleta. Corrige el error y reinicia:', error.message);
    }
  },
};
