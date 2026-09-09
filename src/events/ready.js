const { Events } = require('discord.js');
const { startTimeSpawner } = require('../spawnManager');
const { startPool } = require('../pokemonPool');

module.exports = {
  name: Events.ClientReady,
  once: true,
  async execute(client) {
    console.log(`✅ Bot conectado como ${client.user.tag}`);

    // Hidratar el caché de emojis de cada servidor ANTES de arrancar el pool.
    // Así getOrCreateEmoji encontrará los pkv2_ existentes y no intentará recriarlos.
    for (const guild of client.guilds.cache.values()) {
      startTimeSpawner(client, guild.id);
      try {
        await guild.emojis.fetch();
        const pkCount = guild.emojis.cache.filter(e => e.name.startsWith('pkv2_')).size;
        console.log(`[Emojis] ${guild.name}: ${pkCount} emojis pk cargados en caché`);
      } catch (e) {
        console.warn(`[Emojis] No se pudo cargar emojis de ${guild.name}:`, e.message);
      }
    }

    const firstGuild = client.guilds.cache.first();
    startPool(firstGuild);
  },
};