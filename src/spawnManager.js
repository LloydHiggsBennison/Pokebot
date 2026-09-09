const { EmbedBuilder } = require('discord.js');
const { getRandomPokemon } = require('./pokemonService');
const { getGuildSettings } = require('./database');

// Estado en memoria por servidor (no necesita persistir en DB)
// state.get(guildId) = { messageCount, threshold, activeSpawn, timeTimer }
const state = new Map();

function getState(guildId) {
  if (!state.has(guildId)) {
    state.set(guildId, {
      messageCount: 0,
      threshold: null,
      activeSpawn: null,
      timeTimer: null,
    });
  }
  return state.get(guildId);
}

function randomThreshold(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

async function spawnPokemon(client, guildId, channelId) {
  const st = getState(guildId);
  if (st.activeSpawn) return; // ya hay uno activo, no duplicar

  try {
    const pokemon = await getRandomPokemon();
    st.activeSpawn = pokemon;

    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (!channel) {
      st.activeSpawn = null;
      return;
    }

    const embed = new EmbedBuilder()
      .setTitle('¡Un Pokémon salvaje ha aparecido!')
      .setImage(pokemon.image)
      .setColor(0xffcb05)
      .setFooter({ text: 'Escribe el comando de captura seguido del nombre para atraparlo.' });

    await channel.send({ embeds: [embed] });
  } catch (err) {
    console.error('Error al spawnear pokemon:', err.message);
    st.activeSpawn = null;
  }
}

async function handleMessage(client, message) {
  if (message.author.bot || !message.guild) return;

  const settings = await getGuildSettings(message.guild.id);
  if (!settings.enabled || !settings.spawn_channel_id) return;
  if (settings.mode !== 'messages' && settings.mode !== 'both') return;

  const st = getState(message.guild.id);
  if (st.threshold === null) {
    st.threshold = randomThreshold(settings.msg_min, settings.msg_max);
  }

  st.messageCount += 1;

  if (st.messageCount >= st.threshold && !st.activeSpawn) {
    st.messageCount = 0;
    st.threshold = randomThreshold(settings.msg_min, settings.msg_max);
    spawnPokemon(client, message.guild.id, settings.spawn_channel_id);
  }
}

function tryCatch(guildId, guessName) {
  const st = getState(guildId);
  if (!st.activeSpawn) return null;
  if (st.activeSpawn.name.toLowerCase() === guessName.trim().toLowerCase()) {
    const caught = st.activeSpawn;
    st.activeSpawn = null;
    return caught;
  }
  return null;
}

async function startTimeSpawner(client, guildId) {
  const st = getState(guildId);
  if (st.timeTimer) {
    clearInterval(st.timeTimer);
    st.timeTimer = null;
  }

  const settings = await getGuildSettings(guildId);
  if ((settings.mode !== 'time' && settings.mode !== 'both') || !settings.spawn_channel_id) {
    return;
  }

  st.timeTimer = setInterval(async () => {
    const fresh = await getGuildSettings(guildId);
    if ((fresh.mode === 'time' || fresh.mode === 'both') && fresh.enabled && fresh.spawn_channel_id) {
      spawnPokemon(client, guildId, fresh.spawn_channel_id);
    }
  }, settings.time_interval_seconds * 1000);
}

// Llamar esto cada vez que se cambie modo/intervalo/canal desde la config
function restartTimeSpawner(client, guildId) {
  startTimeSpawner(client, guildId);
}

module.exports = { handleMessage, tryCatch, startTimeSpawner, restartTimeSpawner, getState };
