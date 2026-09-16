const {EmbedBuilder,ActionRowBuilder,StringSelectMenuBuilder,ButtonBuilder,ButtonStyle,MessageFlags}=require('discord.js');
const {randomUUID}=require('node:crypto');
const {getFuseCandidates}=require('./database');
const {copyPage,fuseSelected}=require('./progressionStore');
const {stats}=require('./battleEngine');
const {t}=require('./i18n');
const sessions=new Map();
setInterval(()=>{for(const [id,s] of sessions)if(!s.busy&&s.expires<Date.now())sessions.delete(id);},60000).unref();
const name=n=>n.charAt(0).toUpperCase()+n.slice(1);
const normalize=n=>n.toLowerCase().replace(/[^a-z0-9]/g,'');
function nav(token,mode,page,total){
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`pokefuse-page:${token}:${mode}:${Math.max(0,page-1)}`).setEmoji('👈').setStyle(ButtonStyle.Secondary).setDisabled(page===0),
    new ButtonBuilder().setCustomId(`pokefuse-page:${token}:${mode}:${page+1}`).setEmoji('👉').setStyle(ButtonStyle.Secondary).setDisabled((page+1)*20>=total),
    new ButtonBuilder().setCustomId(`pokefuse-page:${token}:back:0`).setLabel(t('Especies','Species')).setStyle(ButtonStyle.Secondary).setDisabled(mode==='species'));
}
async function render(s,token,mode,page){
  let options,description,total;
  if(mode==='species'){
    total=s.candidates.length;page=Math.max(0,Math.min(page,Math.ceil(total/20)-1));
    const list=s.candidates.slice(page*20,page*20+20);
    options=list.map(p=>({label:name(p.name),value:String(p.id),description:t(`${p.count} normales disponibles`,`${p.count} regular copies available`)}));
    description=t('Elige la especie. Después elegirás la copia que se convertirá en shiny.','Choose a species, then the individual copy to turn shiny.');
  }else{
    const result=await copyPage(s.guildId,s.ownerId,{species:s.species.id,normalOnly:true,page});
    total=result.total;s.copies=result.rows;
    options=result.rows.map(p=>{const a=stats(p);return {label:`${name(p.pokemon_name)} · Lv. ${a.level}`.slice(0,100),value:String(p.id),
      description:`HP ${a.hp} · ATK ${a.attack} · DEF ${a.defense} · EXP ${p.experience||0}`,emoji:p.battle_id&&p.battle_until>Date.now()?'🔒':'✨'};});
    description=t('Selecciona la copia que **se transformará** en shiny conservando su nivel, EXP y estadísticas. Se consumen otras 3 copias de menor nivel; queda al menos 1 normal.','Select the copy that **transforms** into shiny, keeping its level, XP and stats. Three other lower-level copies are consumed; at least one regular remains.');
  }
  const embed=new EmbedBuilder().setColor(0xffcb05).setTitle(t('✨ Fusión Pokémon','✨ Pokémon fusion')).setDescription(description)
    .setFooter({text:t(`Página ${page+1} / ${Math.max(1,Math.ceil(total/20))} · Solo tú puedes ver esto`,`Page ${page+1} / ${Math.max(1,Math.ceil(total/20))} · Only visible to you`)});
  const components=options.length?[new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId(`pokefuse:${token}:${mode}`).setPlaceholder(t('Seleccionar…','Select…')).addOptions(options)),nav(token,mode,page,total)]:[nav(token,mode,page,total)];
  return {content:null,embeds:[embed],components,allowedMentions:{parse:[]}};
}
async function showFuse(message,requestedName=''){
  const match=requestedName?require('../data/pokemon.json').find(p=>normalize(p.name)===normalize(requestedName)):null;
  if(requestedName&&!match)return message.reply(t('Nombre de Pokémon no válido.','Invalid Pokémon name.'));
  return message.reply({content:t('✨ Abre la selección privada y elige qué copia convertir en shiny.','✨ Open the private selection and choose which copy to turn shiny.'),
    components:[new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`pokefuse-open:${message.author.id}:${match?.id||0}`).setStyle(ButtonStyle.Primary).setLabel(t('Abrir selección privada','Open private selection')))],allowedMentions:{parse:[]}});
}
async function openPrivateFuse(i){
  const [,owner,species]=i.customId.split(':');
  if(owner!==i.user.id)return i.reply({content:t('Este botón pertenece a otra persona.','This button belongs to someone else.'),flags:MessageFlags.Ephemeral});
  await i.deferReply({flags:MessageFlags.Ephemeral});
  try {
  const own=await getFuseCandidates(i.guildId,i.user.id);
  if(!own.length)return i.editReply({content:t('Necesitas cinco copias normales iguales.','You need five matching regular copies.')});
  const token=randomUUID(),s={guildId:i.guildId,ownerId:i.user.id,candidates:own,expires:Date.now()+600000};
  s.species=own.find(p=>String(p.id)===species);
  if(sessions.size>=200)sessions.delete(sessions.keys().next().value);
  sessions.set(token,s);
  const sent=await i.editReply(await render(s,token,s.species?'copy':'species',0));s.messageId=sent.id;
  } catch(error) {
    console.error('[Fusion open]',error.message);
    await i.editReply({content:t('No se pudo abrir el selector. Pulsa «Abrir selección privada» para reintentar.','Could not open the selector. Press “Open private selection” to retry.'),embeds:[],components:[]});
  }
}
async function handleFuseSelect(i){
  const [,token,action,rawPage]=i.customId.split(':');
  const s=sessions.get(token);
  const refuse=content=>i.reply({content,flags:MessageFlags.Ephemeral});
  if(!s||s.expires<Date.now())return refuse(t('El selector expiró. Usa `$pokefuse` de nuevo.','This menu expired. Use `$pokefuse` again.'));
  if(s.ownerId!==i.user.id||s.guildId!==i.guildId||s.messageId!==i.message.id)return refuse(t('Este selector pertenece a otra persona.','This menu belongs to someone else.'));
  if(s.busy)return refuse(t('⏳ Procesando tu selección.','⏳ Processing your selection.'));
  s.busy=true;
  try{
    await i.deferUpdate();
    if(i.customId.startsWith('pokefuse-page:')){
      if(s.request)throw Error('Retry the selected copy first');
      if(!/^\d+$/.test(rawPage||'')||Number(rawPage)>100000||!['copy','species','back'].includes(action)||(action==='copy'&&!s.species))throw Error('Invalid page');
      return await i.editReply(await render(s,token,action==='back'?'species':action,action==='back'?0:Number(rawPage)));
    }
    if(action==='species'){
      if(s.request)throw Error('Retry the selected copy first');
      s.species=s.candidates.find(p=>String(p.id)===i.values[0]);if(!s.species)throw Error('Invalid species');
      return await i.editReply(await render(s,token,'copy',0));
    }
    const selected=s.copies?.find(p=>String(p.id)===i.values[0]);if(!selected||action!=='copy')throw Error('Invalid copy');
    if(s.selected&&s.selected!==String(selected.id))throw Error('Retry the same copy');
    s.selected=String(selected.id);s.request ||=randomUUID();
    const result=await fuseSelected(s.guildId,s.ownerId,s.selected,s.request);
    if(!result){sessions.delete(token);return await i.editReply({content:t('No se pudo fusionar: faltan copias disponibles o el Pokémon está combatiendo.','Cannot fuse: not enough available copies, or the Pokémon is battling.'),embeds:[],components:[]});}
    sessions.delete(token);
    await require('./pokefuseManager').revealFusion(i,{id:result.pokemon_id,name:result.pokemon_name,level:result.level||5,copyId:result.id});
  }catch(error){
    console.error('[Fusion selection]',error.message);
    await i.editReply({content:t('No se pudo confirmar. Reintenta la misma copia; no se consume dos veces.','Could not confirm. Retry the same copy; it will not be consumed twice.')});
  }finally{s.busy=false;}
}
module.exports={showFuse,openPrivateFuse,handleFuseSelect};
