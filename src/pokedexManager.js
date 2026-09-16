const { t } = require('./i18n');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags, escapeMarkdown } = require('discord.js');
const { getPokedexEntries } = require('./database');
const { getPreparedEmoji } = require('./emojiManager');
const { POKEMON_LIST } = require('./pokemonService');
const { stats } = require('./battleEngine');
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

function renderPage(session, token, page, mode = 'list') {
  const rows = mode === 'iv' ? session.entries.flatMap(entry => (entry.copies || []).map(copy=>({...entry,copy}))) : session.entries;
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const description = rows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).map(p => {
    const name = escapeMarkdown(p.name.charAt(0).toUpperCase() + p.name.slice(1));
    if (mode === 'iv') {
      const a=stats(p.copy),total=a.iv.reduce((sum,n)=>sum+n,0);
      return `${p.isShiny ? '✨ ' : ''}${p.emoji} **${name}** · Lv. ${a.level} · **IV ${(total/186*100).toFixed(2)}%**\nHP ${a.iv[0]} · ATK ${a.iv[1]} · DEF ${a.iv[2]} · SpA ${a.iv[3]} · SpD ${a.iv[4]} · SPE ${a.iv[5]}`;
    }
    return `${p.isShiny ? '✨ ' : ''}${p.emoji} ${name}${p.count > 1 ? ` x${p.count}` : ''}`;
  }).join('\n') || t('Todavía no has capturado Pokémon. Usa `$p` para empezar tu colección.', "You have not caught any Pokémon yet. Use `$p` to start your collection.");
  const embed = new EmbedBuilder().setColor(0xffcb05)
    .setAuthor({ name: session.username, ...(session.avatar ? { iconURL: session.avatar } : {}) })
    .setThumbnail('attachment://pokedex.png').setDescription(description)
    .setFooter({ text: t(`${new Set(session.entries.map(entry => entry.id)).size} / ${POKEMON_LIST.length.toLocaleString('es-CL')} - Página ${page + 1} / ${pages}`, `${new Set(session.entries.map(entry => entry.id)).size} / ${POKEMON_LIST.length.toLocaleString('en-US')} - Page ${page + 1} / ${pages}`) });
  const buttons = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`pokedex:${token}:${(page + pages - 1) % pages}:prev:${mode}`).setEmoji('👈').setStyle(ButtonStyle.Secondary).setDisabled(pages === 1),
    new ButtonBuilder().setCustomId(`pokedex:${token}:${(page + 1) % pages}:next:${mode}`).setEmoji('👉').setStyle(ButtonStyle.Secondary).setDisabled(pages === 1),
    new ButtonBuilder().setCustomId(`pokedex:${token}:0:toggle:${mode === 'iv' ? 'list' : 'iv'}`).setLabel(mode === 'iv' ? t('Ver listado','View list') : t('Ver IV por copia','View IVs per copy')).setStyle(ButtonStyle.Secondary).setDisabled(!session.entries.length),
  );
  return { embeds: [embed], components: [buttons], allowedMentions: { parse: [] } };
}

async function showPokedex(message, target = message.author) {
  const key = `${message.guild.id}:${message.author.id}`;
  if (pending.has(key)) {
    await message.reply({ content: t('Tu Pokédex se está cargando.', "Your Pokédex is loading."), allowedMentions: { repliedUser: false } });
    return;
  }
  pending.add(key);
  let sent;
  let token;
  try {
    sent = await message.reply({ content: t('📖 Cargando tu Pokédex…', "📖 Loading your Pokédex…"), allowedMentions: { repliedUser: false } });
    const entries = await getPokedexEntries(message.guild.id, target.id, {includeCopies:true});
    entries.sort((a,b)=>Number(!!a.isShiny)-Number(!!b.isShiny)||a.name.localeCompare(b.name,'en',{sensitivity:'base',numeric:true})||a.id-b.id);
    for (const entry of entries) {
      try { entry.emoji = getPreparedEmoji(message.guild.client, `pkv2_${entry.id}`); }
      catch { entry.emoji = '🔹'; } // Usable even while the emoji catalog is warming.
    }
    cleanup();
    if (sessions.size >= MAX_SESSIONS) sessions.delete(sessions.keys().next().value);
    token = randomBytes(12).toString('hex');
    const session = { ownerId: message.author.id, guildId: message.guild.id, messageId: sent.id,
      username: target.username, avatar: target.displayAvatarURL?.(),
      entries, expires: Date.now() + SESSION_MS };
    sessions.set(token, session);
    await sent.edit({ content: null, ...renderPage(session, token, 0), files: [{ attachment: thumbnail, name: 'pokedex.png' }] });
  } catch (error) {
    if (token) sessions.delete(token);
    console.error('[Pokedex] No se pudo cargar la colección:', error.message);
    if (sent) await sent.edit({ content: t('No se pudo cargar tu Pokédex. Intenta de nuevo en unos segundos.', "Could not load your Pokédex. Try again in a few seconds."), embeds: [], components: [] });
    else throw error;
  } finally { pending.delete(key); }
}

async function handlePokedexButton(interaction) {
  const [, token, requestedPage, , requestedMode] = interaction.customId.split(':');
  const mode=requestedMode || 'list';
  const session = sessions.get(token);
  if (!session || session.expires <= Date.now()) {
    if (session) sessions.delete(token);
    await interaction.reply({ content: t('Esta Pokédex expiró. Escribe `$pokedex` para abrirla de nuevo.', "This Pokédex expired. Type `$pokedex` to open it again."), flags: MessageFlags.Ephemeral });
    return;
  }
  if (interaction.user.id !== session.ownerId || interaction.guildId !== session.guildId || interaction.message.id !== session.messageId) {
    await interaction.reply({ content: t('Esta Pokédex pertenece a otra persona. Usa `$pokedex` para ver la tuya.', "This Pokédex belongs to someone else. Use `$pokedex` to view yours."), flags: MessageFlags.Ephemeral });
    return;
  }
  const page = Number(requestedPage);
  const count=mode==='iv'?session.entries.reduce((sum,p)=>sum+(p.copies?.length||0),0):session.entries.length;
  if (!['list','iv'].includes(mode) || !/^\d+$/.test(requestedPage || '') || page >= Math.max(1, Math.ceil(count / PAGE_SIZE))) {
    await interaction.reply({ content: t('Página no válida.', "Invalid page."), flags: MessageFlags.Ephemeral });
    return;
  }
  await interaction.update(renderPage(session, token, page, mode));
}

module.exports = { showPokedex, handlePokedexButton };
