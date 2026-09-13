const { EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, MessageFlags } = require('discord.js');
const { randomBytes } = require('node:crypto');
const { getFuseCandidates, fusePokemon } = require('./database');
const { getPreparedEmoji } = require('./emojiManager');

const SESSION_MS = 5 * 60 * 1000;
const sessions = new Map();
const running = new Set();

function cleanup() {
  for (const [token, session] of sessions) if (session.expires <= Date.now()) sessions.delete(token);
}
setInterval(cleanup, 60000).unref();

function displayName(name) { return name.charAt(0).toUpperCase() + name.slice(1); }

function payload(session, token) {
  const options = session.candidates.slice(0, 25).map(candidate => ({
    label: displayName(candidate.name).slice(0, 100),
    value: String(candidate.id),
    description: `${candidate.count} normales → consume 4 y conserva 1 + shiny`,
    emoji: '✨',
  }));
  const embed = new EmbedBuilder().setColor(0xffcb05)
    .setTitle('✨ Fusión Pokémon')
    .setDescription('Elige un Pokémon con **x5 o más** normales. Se consumirán 4, conservarás 1 normal y recibirás 1 shiny.')
    .addFields({ name: 'Disponibles', value: session.candidates.map(p => `${p.emoji} **${displayName(p.name)}** x${p.count}`).join('\n').slice(0, 1024) })
    .setFooter({ text: 'Solo tú puedes usar este selector · Expira en 5 minutos' });
  const select = new StringSelectMenuBuilder().setCustomId(`pokefuse:${token}`).setPlaceholder('Selecciona un Pokémon para fusionar…').addOptions(options);
  return { embeds: [embed], components: [new ActionRowBuilder().addComponents(select)], allowedMentions: { parse: [] } };
}

async function showFuse(message) {
  cleanup();
  const key = `${message.guild.id}:${message.author.id}`;
  if (running.has(key)) { await message.reply('⏳ Ya tienes una fusión en curso.'); return; }
  running.add(key);
  try {
    const candidates = await getFuseCandidates(message.guild.id, message.author.id);
    if (!candidates.length) {
      await message.reply('✨ Aún no tienes Pokémon normales con **x5**. Necesitas cinco copias iguales para fusionar.');
      return;
    }
    const token = randomBytes(12).toString('hex');
    for (const candidate of candidates) {
      try { candidate.emoji = getPreparedEmoji(message.guild.client, `pkv2_${candidate.id}`); } catch { candidate.emoji = '🔹'; }
    }
    sessions.set(token, { ownerId: message.author.id, guildId: message.guild.id, messageId: null, candidates, expires: Date.now() + SESSION_MS });
    const sent = await message.reply(payload(sessions.get(token), token));
    sessions.get(token).messageId = sent.id;
  } finally { running.delete(key); }
}

async function handleFuseSelect(interaction) {
  const [, token] = interaction.customId.split(':');
  const session = sessions.get(token);
  if (!session || session.expires <= Date.now()) {
    sessions.delete(token);
    await interaction.reply({ content: 'Este selector expiró. Escribe `$pokefuse` de nuevo.', flags: MessageFlags.Ephemeral });
    return;
  }
  if (interaction.user.id !== session.ownerId || interaction.guildId !== session.guildId || interaction.message.id !== session.messageId) {
    await interaction.reply({ content: 'Este selector pertenece a otra persona. Usa `$pokefuse` para abrir el tuyo.', flags: MessageFlags.Ephemeral });
    return;
  }
  const candidate = session.candidates.find(p => String(p.id) === interaction.values[0]);
  if (!candidate) { await interaction.reply({ content: 'Pokémon no válido.', flags: MessageFlags.Ephemeral }); return; }
  const key = `${session.guildId}:${session.ownerId}`;
  if (running.has(key)) { await interaction.reply({ content: '⏳ Tu fusión ya está siendo procesada.', flags: MessageFlags.Ephemeral }); return; }
  running.add(key);
  try {
    const result = await fusePokemon(session.guildId, session.ownerId, candidate.id, candidate.name);
    if (!result) {
      await interaction.update({ content: '❌ Ya no tienes cinco copias normales de ese Pokémon. Abre `$pokefuse` de nuevo.', embeds: [], components: [] });
      sessions.delete(token);
      return;
    }
    sessions.delete(token);
    const emoji = candidate.emoji || '🔹';
    await interaction.update({ content: `✨ **Fusión completada:** ${emoji} **${displayName(candidate.name)} shiny**\nSe consumieron 4 copias normales, conservaste 1 y recibiste 1 shiny.`, embeds: [], components: [] });
  } finally { running.delete(key); }
}

module.exports = { showFuse, handleFuseSelect };
