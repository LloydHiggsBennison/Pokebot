const { Events } = require('discord.js');
const { startTimeSpawner } = require('../spawnManager');
const { startPool } = require('../pokemonPool');

module.exports = {
  name: Events.ClientReady,
  once: true,
  async execute(client) {
    console.log(`✅ Bot conectado como ${client.user.tag}`);

    client.guilds.cache.forEach((guild) => {
      startTimeSpawner(client, guild.id);
    });

    startPool();
  },
};