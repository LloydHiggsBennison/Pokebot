const { t } = require('./i18n');
const { EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');
const { randomBytes } = require('node:crypto');
const { getFuseCandidates, fusePokemon } = require('./database');
const { getPreparedEmoji } = require('./emojiManager');
const { getFusionAnimation } = require('./fusionAnimation');

const SESSION_MS = 5 * 60 * 1000;
const sessions = new Map();
const receipts = new Map();
const running = new Set();

function cleanup() {
  for (const [token, session] of sessions) if (session.expires <= Date.now()) sessions.delete(token);
  for (const [token, receipt] of receipts) if (receipt.expires <= Date.now()) receipts.delete(token);
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

function normalizeName(name) {
  return name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .replace(/♀/g,'f').replace(/♂/g,'m').replace(/[^a-z0-9]/g,'');
}

async function showFuse(message, requestedName = '', privateMenu = false) {
  if(!requestedName && !privateMenu) {
    return message.reply({content:t('✨ Abre tu selección de fusión privada.','✨ Open your private fusion selection.'),
      components:[new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('pokefuse-open:'+message.author.id)
        .setLabel(t('Abrir selección privada','Open private selection')).setStyle(ButtonStyle.Primary))],allowedMentions:{parse:[]}});
  }
  cleanup();
  let directInteraction;
  const key = `${message.guild.id}:${message.author.id}`;
  if (running.has(key)) { await message.reply(t('⏳ Ya tienes una fusión en curso.', "⏳ You already have a fusion in progress.")); return; }
  running.add(key);
  try {
    const candidates = await getFuseCandidates(message.guild.id, message.author.id);
    if (!candidates.length) {
      await message.reply(t('✨ Aún no tienes Pokémon normales con **x5**. Necesitas cinco copias iguales para fusionar.', "✨ You do not have **x5** regular Pokémon yet. You need five identical copies to fuse."));
      return;
    }
    const selected = requestedName ? candidates.find(p => normalizeName(p.name) === normalizeName(requestedName)) : null;
    if (requestedName && !selected) {
      await message.reply(t('No tienes cinco copias normales de ese Pokémon, o el nombre no es válido. Usa `$pokefuse` para ver los disponibles.', 'You do not have five regular copies of that Pokémon, or the name is invalid. Use `$pokefuse` to see available species.'));
      return;
    }
    const token = randomBytes(12).toString('hex');
    if(sessions.size>=200) sessions.delete(sessions.keys().next().value);
    for (const candidate of candidates) {
      try { candidate.emoji = getPreparedEmoji(message.guild.client, `pkv2_${candidate.id}`); } catch { candidate.emoji = '🔹'; }
    }
    sessions.set(token, { ownerId: message.author.id, guildId: message.guild.id, messageId: null, candidates, expires: Date.now() + SESSION_MS });
    const sent = await message.reply(selected ? t('⏳ Preparando la fusión…','⏳ Preparing the fusion…') : payload(sessions.get(token), token));
    sessions.get(token).messageId = sent.id;
    if (selected) {
      directInteraction = {
        customId:'pokefuse:'+token,values:[String(selected.id)],user:message.author,
        guildId:message.guild.id,message:sent,
        async deferUpdate(){this.deferred=true;},
        editReply: data => sent.edit(data),
        reply: data => message.reply({content:data.content,allowedMentions:{parse:[]}}),
      };
    }
  } finally { running.delete(key); }
  if (directInteraction) await handleFuseSelect(directInteraction);
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
    await revealFusion(interaction,candidate);
  } catch (error) {
    sessions.delete(token);
    if (interaction.deferred) {
      await interaction.editReply({ content: t('No se pudo confirmar la fusión. Revisa tu `$pokedex` antes de intentarlo de nuevo.', "Could not confirm the fusion. Check your `$pokedex` before trying again."), embeds: [], components: [] });
    }
    throw error;
  } finally { running.delete(key); }
}

async function handleFuseReplay(interaction) {
  cleanup();
  const token = interaction.customId.split(':')[1];
  const receipt = receipts.get(token);
  if (!receipt) {
    await interaction.reply({content:t('Este botón expiró. Tu shiny sigue guardado.','This button expired. Your shiny is still saved.'),flags:MessageFlags.Ephemeral});
    return;
  }
  if (interaction.user.id !== receipt.ownerId || interaction.guildId !== receipt.guildId || interaction.message.id !== receipt.messageId) {
    await interaction.reply({content:t('Esta animación pertenece a otra persona.','This animation belongs to someone else.'),flags:MessageFlags.Ephemeral});
    return;
  }
  const key = receipt.guildId+':'+receipt.ownerId;
  if (running.has(key)) {
    await interaction.reply({content:t('⏳ La animación se está preparando.','⏳ The animation is being prepared.'),flags:MessageFlags.Ephemeral});
    return;
  }
  running.add(key);
  try {
    await interaction.deferUpdate();
    await revealFusion(interaction,receipt.candidate,token);
  } finally { running.delete(key); }
}

async function revealFusion(interaction,candidate,token) {
  if (!token) {
    token=randomBytes(12).toString('hex');
    cleanup();
    if(receipts.size>=200) receipts.delete(receipts.keys().next().value);
    receipts.set(token,{ownerId:interaction.user.id,guildId:interaction.guildId,messageId:interaction.message.id,candidate,expires:Date.now()+10*60*1000});
  }
  const buttons = success => [new ActionRowBuilder().addComponents(new ButtonBuilder()
    .setCustomId('pokefuse-replay:'+token).setStyle(ButtonStyle.Secondary)
    .setLabel(success?t('Volver a ver','Replay'):t('Reintentar animación','Retry animation')).setEmoji('✨'))];
  const mediaFailure=t('\n⚠️ No se pudo mostrar la animación. Puedes reintentar durante 10 minutos sin consumir Pokémon.','\n⚠️ The animation could not be shown. You can retry for 10 minutes without consuming Pokémon.');
  const name=displayName(candidate.name);
  const content=t(`✨ **Fusión completada: ${name} shiny**\nSe consumieron 4 copias normales y recibiste 1 shiny; conservas tus copias normales restantes.`,`✨ **Fusion complete: ${name} shiny**\nConsumed 4 regular copies and received 1 shiny; you keep your remaining regular copies.`);
  const shinyUrl='https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/shiny/'+candidate.id+'.png';
  try {
    await interaction.editReply({content:t('⚡ Fusión guardada. Las cuatro copias están concentrando su energía…','⚡ Fusion saved. The four copies are concentrating their energy…'),embeds:[],components:[],attachments:[]});
    const gif=await getFusionAnimation(candidate.id,name,t('es','en'));
    const canAttach=gif && gif.length <= (interaction.attachmentSizeLimit || 7*1024*1024);
    if(gif && !canAttach) console.warn('[Pokefuse animation] GIF exceeds attachment limit:',gif.length,interaction.attachmentSizeLimit);
    const embed=new EmbedBuilder().setColor(0xf4cf70)
      .setTitle(t(`✨ ¡Ha nacido un ${name} shiny!`,`✨ A shiny ${name} is born!`))
      .setImage(canAttach?'attachment://pokefuse.gif':shinyUrl)
      .setFooter({text:t('El original permanece contigo · Shiny añadido a tu Pokédex','The original stays with you · Shiny added to your Pokédex')});
    await interaction.editReply({content:content+(canAttach?'':mediaFailure),embeds:[embed],components:buttons(canAttach),attachments:[],files:canAttach?[{attachment:gif,name:'pokefuse.gif'}]:[]});
  } catch(error) {
    // The reward is already committed. A media/upload failure must never report a failed fusion.
    console.error('[Pokefuse animation]',error.message);
    try { await interaction.editReply({content:content+mediaFailure,embeds:[],components:buttons(false),attachments:[],files:[]}); }
    catch(deliveryError) { console.error('[Pokefuse confirmation]',deliveryError.message); }
  }
}

async function openPrivateFuse(interaction) {
  if(interaction.customId.split(':')[1]!==interaction.user.id) {
    return interaction.reply({content:t('Este botón pertenece a otra persona. Usa `$pokefuse`.','This button belongs to someone else. Use `$pokefuse`.'),flags:MessageFlags.Ephemeral});
  }
  await interaction.deferReply({flags:MessageFlags.Ephemeral});
  await showFuse({author:interaction.user,guild:interaction.guild,
    reply: data => interaction.editReply(typeof data==='string'?{content:data}:data)},'',true);
}
module.exports = { showFuse, handleFuseSelect, handleFuseReplay, openPrivateFuse };
