const path = require('node:path');
const { randomBytes } = require('node:crypto');
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags, escapeMarkdown } = require('discord.js');
const { getPokedexEntries } = require('./database');
const { getPreparedEmoji } = require('./emojiManager');
const { POKEMON_LIST } = require('./pokemonService');
const PAGE_SIZE = 10;
const SESSION_MS = 10 * 60 * 1000;
const MAX_SESSIONS = 200;
const sessions = new Map();
const pending = new Set();
const thumbnail = path.join(__dirname, '..', 'assets', 'pokedex.png');

function cleanup() {
  for (const [token, session] of sessions) if (session.expires <= Date.now()) sessions.delete(token);
}
const sweep = setInterval(cleanup, 60000);
sweep.unref();

function renderPage(session, token, page) {
  const pages = Math.max(1, Math.ceil(session.entries.length / PAGE_SIZE));
  const description = session.entries.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).map(p => {
    const name = escapeMarkdown(p.name.charAt(0).toUpperCase() + p.name.slice(1));
    return `${p.isShiny ? '✨ ' : ''}${p.emoji} ${name}${p.count > 1 ? ` x${p.count}` : ''}`;
  }).join('\n') || 'Todavía no has capturado Pokémon. Usa `$p` para empezar tu colección.';
  const embed = new EmbedBuilder().setColor(0xffcb05)
    .setAuthor({ name: session.username, ...(session.avatar ? { iconURL: session.avatar } : {}) })
    .setThumbnail('attachment://pokedex.png').setDescription(description)
    .setFooter({ text: `${new Set(session.entries.map(entry => entry.id)).size} / ${POKEMON_LIST.length.toLocaleString('es-CL')} - Página ${page + 1} / ${pages}` });
  const buttons = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`pokedex:${token}:${(page + pages - 1) % pages}:prev`).setEmoji('👈').setStyle(ButtonStyle.Secondary).setDisabled(pages === 1),
    new ButtonBuilder().setCustomId(`pokedex:${token}:${(page + 1) % pages}:next`).setEmoji('👉').setStyle(ButtonStyle.Secondary).setDisabled(pages === 1),
  );
  return { embeds: [embed], components: [buttons], allowedMentions: { parse: [] } };
}

async function showPokedex(message) {
  const key = `${message.guild.id}:${message.author.id}`;
  if (pending.has(key)) {
    await message.reply({ content: 'Tu Pokédex se está cargando.', allowedMentions: { repliedUser: false } });
    return;
  }
  pending.add(key);
  let sent;
  let token;
  try {
    sent = await message.reply({ content: '📖 Cargando tu Pokédex…', allowedMentions: { repliedUser: false } });
    const entries = await getPokedexEntries(message.guild.id, message.author.id);
    for (const entry of entries) {
      try { entry.emoji = getPreparedEmoji(message.guild.client, `pkv2_${entry.id}`); }
      catch { entry.emoji = '🔹'; } // Usable even while the emoji catalog is warming.
    }
    cleanup();
    if (sessions.size >= MAX_SESSIONS) sessions.delete(sessions.keys().next().value);
    token = randomBytes(12).toString('hex');
    const session = { ownerId: message.author.id, guildId: message.guild.id, messageId: sent.id,
      username: message.author.username, avatar: message.author.displayAvatarURL?.(),
      entries, expires: Date.now() + SESSION_MS };
    sessions.set(token, session);
    await sent.edit({ content: null, ...renderPage(session, token, 0), files: [{ attachment: thumbnail, name: 'pokedex.png' }] });
  } catch (error) {
    if (token) sessions.delete(token);
    console.error('[Pokedex] No se pudo cargar la colección:', error.message);
    if (sent) await sent.edit({ content: 'No se pudo cargar tu Pokédex. Intenta de nuevo en unos segundos.', embeds: [], components: [] });
    else throw error;
  } finally { pending.delete(key); }
}

async function handlePokedexButton(interaction) {
  const [, token, requestedPage] = interaction.customId.split(':');
  const session = sessions.get(token);
  if (!session || session.expires <= Date.now()) {
    if (session) sessions.delete(token);
    await interaction.reply({ content: 'Esta Pokédex expiró. Escribe `$pokedex` para abrirla de nuevo.', flags: MessageFlags.Ephemeral });
    return;
  }
  if (interaction.user.id !== session.ownerId || interaction.guildId !== session.guildId || interaction.message.id !== session.messageId) {
    await interaction.reply({ content: 'Esta Pokédex pertenece a otra persona. Usa `$pokedex` para ver la tuya.', flags: MessageFlags.Ephemeral });
    return;
  }
  const page = Number(requestedPage);
  if (!/^\d+$/.test(requestedPage || '') || page >= Math.max(1, Math.ceil(session.entries.length / PAGE_SIZE))) {
    await interaction.reply({ content: 'Página no válida.', flags: MessageFlags.Ephemeral });
    return;
  }
  await interaction.update(renderPage(session, token, page));
}

module.exports = { showPokedex, handlePokedexButton };
