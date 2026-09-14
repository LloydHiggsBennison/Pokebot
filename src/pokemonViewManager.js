const {EmbedBuilder,ActionRowBuilder,ButtonBuilder,ButtonStyle,MessageFlags} = require('discord.js');
const {randomBytes} = require('node:crypto');
const {getPokedexEntries} = require('./database');
const {getGallery} = require('./pokemonGallery');
const {rarityFor} = require('./wildRewards');
const {t} = require('./i18n');
const sessions = new Map(), pending = new Set();
const normalize = name => name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/♀/g,'f').replace(/♂/g,'m').replace(/[^a-z0-9]/g,'');
function cleanup() {for(const [token,s] of sessions) if(s.expires<=Date.now()) sessions.delete(token);}
setInterval(cleanup,60000).unref();

function payload(s,token,page) {
  const image = s.pages[page];
  const kind = {artwork:t('Ilustración','Artwork'),animation:t('Animación','Animation'),home:'HOME',sprite:'Sprite',back:t('Vista posterior','Back view')}[image.kind];
  const rarity = {common:t('Común','Common'),uncommon:t('No común','Uncommon'),rare:t('Súper raro','Super rare'),legendary:t('Legendario','Legendary'),mythical:t('Mítico','Mythical')}[rarityFor(s.id)];
  const embed = new EmbedBuilder().setColor(0xffa51f)
    .setTitle(s.name+(image.isShiny?' ✨':''))
    .setDescription([
      'Pokémon · #'+s.id,
      rarity+' · '+(image.isShiny?'✨ Shiny':t('Normal','Regular')),
      t(`Tu colección: **${s.normal} normales · ${s.shiny} shiny**`,`Your collection: **${s.normal} regular · ${s.shiny} shiny**`),
      t(`Entrenador: <@${s.ownerId}>`,`Trainer: <@${s.ownerId}>`),
    ].join('\n'))
    .setImage(image.url)
    .setFooter({text:`${page+1} / ${s.pages.length} · ${kind}`});
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`pvw:${token}:${(page+s.pages.length-1)%s.pages.length}`).setEmoji('👈').setStyle(ButtonStyle.Secondary).setDisabled(s.pages.length===1),
    new ButtonBuilder().setCustomId(`pvw:${token}:${(page+1)%s.pages.length}`).setEmoji('👉').setStyle(ButtonStyle.Secondary).setDisabled(s.pages.length===1));
  return {content:null,embeds:[embed],components:[row],allowedMentions:{parse:[]}};
}

async function showPokemonView(message,query='') {
  if(!query.trim()) return message.reply(t('Usa `$pvw charizard` o `$pvw charizard shiny` para ver un Pokémon de tu colección.','Use `$pvw charizard` or `$pvw charizard shiny` to view a Pokémon you own.'));
  const onlyShiny = /\s+shiny$/i.test(query);
  const wanted = normalize(query.replace(/\s+shiny$/i,''));
  const key = message.guild.id+':'+message.author.id;
  if(pending.has(key)) return message.reply(t('⏳ Tu galería se está cargando.','⏳ Your gallery is loading.'));
  pending.add(key);
  let sent,token;
  try {
    sent = await message.reply({content:t('📖 Cargando tu Pokémon…','📖 Loading your Pokémon…'),allowedMentions:{repliedUser:false}});
    const entries = (await getPokedexEntries(message.guild.id,message.author.id)).filter(p=>normalize(p.name)===wanted);
    const variants = entries.filter(p=>!onlyShiny || p.isShiny).sort((a,b)=>Number(a.isShiny)-Number(b.isShiny));
    if(!variants.length) {
      await sent.edit({content:t('No tienes ese Pokémon en tu colección. Revisa el nombre en `$pokedex`.','You do not own that Pokémon. Check its name in `$pokedex`.')});
      return;
    }
    const pages = (await Promise.all(variants.map(async p=>(await getGallery(p.id,!!p.isShiny)).map(media=>({...media,isShiny:!!p.isShiny}))))).flat();
    cleanup();if(sessions.size>=200) sessions.delete(sessions.keys().next().value);
    token = randomBytes(12).toString('hex');
    const p = variants[0];
    const s = {ownerId:message.author.id,guildId:message.guild.id,messageId:sent.id,
      username:message.author.username,avatar:message.author.displayAvatarURL?.(),id:p.id,
      name:p.name.charAt(0).toUpperCase()+p.name.slice(1),normal:entries.filter(p=>!p.isShiny).reduce((n,p)=>n+p.count,0),
      shiny:entries.filter(p=>p.isShiny).reduce((n,p)=>n+p.count,0),pages,expires:Date.now()+600000};
    sessions.set(token,s);
    await sent.edit(payload(s,token,0));
  } catch(error) {
    if(token) sessions.delete(token);
    console.error('[Pvw]',error.message);
    if(sent) await sent.edit({content:t('No se pudo cargar tu Pokémon. Inténtalo de nuevo.','Could not load your Pokémon. Please try again.'),embeds:[],components:[]});
    else throw error;
  } finally {pending.delete(key);}
}

async function handlePokemonView(interaction) {
  const [,token,requested] = interaction.customId.split(':');
  const s = sessions.get(token);
  if(!s || s.expires<=Date.now()) {
    sessions.delete(token);
    return interaction.reply({content:t('Esta galería expiró. Usa `$pvw nombre` de nuevo.','This gallery expired. Use `$pvw name` again.'),flags:MessageFlags.Ephemeral});
  }
  if(s.ownerId!==interaction.user.id || s.guildId!==interaction.guildId || s.messageId!==interaction.message.id)
    return interaction.reply({content:t('Esta galería pertenece a otra persona.','This gallery belongs to someone else.'),flags:MessageFlags.Ephemeral});
  if(!/^\d+$/.test(requested||'') || Number(requested)>=s.pages.length)
    return interaction.reply({content:t('Página no válida.','Invalid page.'),flags:MessageFlags.Ephemeral});
  await interaction.update(payload(s,token,Number(requested)));
}
module.exports = {showPokemonView,handlePokemonView};
