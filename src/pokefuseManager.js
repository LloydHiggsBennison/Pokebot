const { t } = require('./i18n');
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
    description: t(`${candidate.count} normales → consume 4 y conserva 1 + shiny`, `${candidate.count} regular → consume 4, keep 1 + shiny`),
    emoji: '✨',
  }));
  const embed = new EmbedBuilder().setColor(0xffcb05)
    .setTitle(t('✨ Fusión Pokémon', "✨ Pokémon Fusion"))
    .setDescription(t('Elige un Pokémon con **x5 o más** normales. Se consumirán 4, conservarás 1 normal y recibirás 1 shiny.', "Choose a Pokémon with **x5 or more** regular copies. Consume 4, keep at least 1 regular copy and receive 1 shiny."))
    .addFields({ name: t('Disponibles', "Available"), value: session.candidates.map(p => `${p.emoji} **${displayName(p.name)}** x${p.count}`).join('\n').slice(0, 1024) })
    .setFooter({ text: t('Solo tú puedes usar este selector · Expira en 5 minutos', "Only you can use this menu · Expires in 5 minutes") });
  const select = new StringSelectMenuBuilder().setCustomId(`pokefuse:${token}`).setPlaceholder(t('Selecciona un Pokémon para fusionar…', "Select a Pokémon to fuse…")).addOptions(options);
  return { embeds: [embed], components: [new ActionRowBuilder().addComponents(select)], allowedMentions: { parse: [] } };
}

async function showFuse(message) {
  cleanup();
  const key = `${message.guild.id}:${message.author.id}`;
  if (running.has(key)) { await message.reply(t('⏳ Ya tienes una fusión en curso.', "⏳ You already have a fusion in progress.")); return; }
  running.add(key);
  try {
    const candidates = await getFuseCandidates(message.guild.id, message.author.id);
    if (!candidates.length) {
      await message.reply(t('✨ Aún no tienes Pokémon normales con **x5**. Necesitas cinco copias iguales para fusionar.', "✨ You do not have **x5** regular Pokémon yet. You need five identical copies to fuse."));
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
    await interaction.reply({ content: t('Este selector expiró. Escribe `$pokefuse` de nuevo.', "This menu expired. Type `$pokefuse` again."), flags: MessageFlags.Ephemeral });
    return;
  }
  if (interaction.user.id !== session.ownerId || interaction.guildId !== session.guildId || interaction.message.id !== session.messageId) {
    await interaction.reply({ content: t('Este selector pertenece a otra persona. Usa `$pokefuse` para abrir el tuyo.', "This menu belongs to someone else. Use `$pokefuse` to open yours."), flags: MessageFlags.Ephemeral });
    return;
  }
  const candidate = session.candidates.find(p => String(p.id) === interaction.values[0]);
  if (!candidate) { await interaction.reply({ content: t('Pokémon no válido.', "Invalid Pokémon."), flags: MessageFlags.Ephemeral }); return; }
  const key = `${session.guildId}:${session.ownerId}`;
  if (running.has(key)) { await interaction.reply({ content: t('⏳ Tu fusión ya está siendo procesada.', "⏳ Your fusion is already being processed."), flags: MessageFlags.Ephemeral }); return; }
  running.add(key);
  try {
    await interaction.deferUpdate();
    const result = await fusePokemon(session.guildId, session.ownerId, candidate.id, candidate.name);
    if (!result) {
      await interaction.editReply({ content: t('❌ Ya no tienes cinco copias normales de ese Pokémon. Abre `$pokefuse` de nuevo.', "❌ You no longer have five regular copies of that Pokémon. Open `$pokefuse` again."), embeds: [], components: [] });
      sessions.delete(token);
      return;
    }
    sessions.delete(token);
    const emoji = candidate.emoji || '🔹';
    await interaction.editReply({ content: t(`✨ **Fusión completada:** ${emoji} **${displayName(candidate.name)} shiny**\nSe consumieron 4 copias normales y recibiste 1 shiny; conservas tus copias normales restantes.`, `✨ **Fusion complete:** ${emoji} **${displayName(candidate.name)} shiny**\nConsumed 4 regular copies and received 1 shiny; you keep your remaining regular copies.`), embeds: [], components: [] });
  } catch (error) {
    sessions.delete(token);
    if (interaction.deferred) {
      await interaction.editReply({ content: t('No se pudo confirmar la fusión. Revisa tu `$pokedex` antes de intentarlo de nuevo.', "Could not confirm the fusion. Check your `$pokedex` before trying again."), embeds: [], components: [] });
    }
    throw error;
  } finally { running.delete(key); }
}

module.exports = { showFuse, handleFuseSelect };

