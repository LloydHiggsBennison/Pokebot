const {ActionRowBuilder,ButtonBuilder,ButtonStyle,StringSelectMenuBuilder,MessageFlags}=require('discord.js');
const {randomUUID}=require('node:crypto');
const {getPokedexEntries}=require('./database');
const {getCopy}=require('./progressionStore');
const {stats}=require('./battleEngine');
const {resolveMention}=require('./guildMembers');
const {t}=require('./i18n');
const sessions=new Map();
setInterval(()=>{for(const [id,s] of sessions)if(!s.busy&&s.expires<Date.now())sessions.delete(id);},60000).unref();
const owner=s=>s.phase==='give'?s.message.author.id:s.receiver.id;
function launch(s){return {content:t(`<@${owner(s)}>, elige la copia que quieres entregar.`,`<@${owner(s)}>, choose the copy you want to send.`),components:[new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`transfercopy:${s.id}:open:${s.phase}`).setLabel(t('Elegir copia en privado','Choose copy privately')).setStyle(ButtonStyle.Primary))],allowedMentions:{users:[owner(s)],repliedUser:false}};}
async function showSelection(message,content){
 const trade=/^\$poketrade(?:\s|$)/i.test(content),args=content.replace(/^\$(poketrade|pokegive)\s*/i,'').match(/^(<@!?\d+>)\s+(.+)$/),pieces=args?.[2].split(/\s*\/\s*/);
 const {parsePokemon}=require('./transferManager');
 if(!args||pieces.length!==(trade?2:1))return message.reply(t('Usa `$poketrade @usuario charizard / blastoise` o `$pokegive @usuario pikachu`.','Use `$poketrade @user charizard / blastoise` or `$pokegive @user pikachu`.'));
 const receiver=await resolveMention(message.guild,args[1]),giveSpec=parsePokemon(pieces[0]),takeSpec=trade?parsePokemon(pieces[1]):null;
 if(!receiver||receiver.bot||receiver.id===message.author.id||!giveSpec||(trade&&!takeSpec))return message.reply(t('Revisa el usuario, la especie y la variante shiny.','Check the user, species and shiny variant.'));
 if(sessions.size>=200)return message.reply(t('Hay demasiadas selecciones pendientes. Intenta más tarde.','Too many pending selections. Try later.'));
 const s={id:randomUUID(),message,content,receiver,giveSpec,takeSpec,phase:'give',expires:Date.now()+600000};
 s.sent=await message.reply(launch(s));sessions.set(s.id,s);
}
function panel(s,page){
 const rows=s.copies.slice(page*20,page*20+20);
 return {content:t(`Elige tu copia · Página ${page+1}/${Math.ceil(s.copies.length/20)}. Todavía no se transfiere ningún Pokémon.`,`Choose your copy · Page ${page+1}/${Math.ceil(s.copies.length/20)}. No Pokémon is transferred yet.`),components:[
 new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId(`transfercopy:${s.id}:pick:${s.phase}`).setPlaceholder(t('Seleccionar copia','Select copy')).addOptions(rows.map(c=>{const a=stats(c);return {label:`${c.pokemon_name}${c.is_shiny?' ✨':''} · Lv. ${a.level}`.slice(0,100),value:String(c.id),description:`IV ${(a.iv.reduce((a,b)=>a+b,0)/186*100).toFixed(2)}% · HP ${a.hp} · ATK ${a.attack} · DEF ${a.defense}`};}))),
 new ActionRowBuilder().addComponents(...[-1,1].map((step,k)=>new ButtonBuilder().setCustomId(`transfercopy:${s.id}:page:${s.phase}:${Math.max(0,page+step)}:${k}`).setEmoji(k?'👉':'👈').setStyle(ButtonStyle.Secondary).setDisabled(k?(page+1)*20>=s.copies.length:page===0)))]};
}
async function handleSelection(i){
 const [,id,action,phase,rawPage]=i.customId.split(':'),s=sessions.get(id);
 const refuse=content=>i.reply({content,flags:MessageFlags.Ephemeral});
 if(!s||s.expires<Date.now())return refuse(t('La selección expiró. Repite el comando.','Selection expired. Use the command again.'));
 if(i.guildId!==s.message.guild.id||i.user.id!==owner(s)||phase!==s.phase)return refuse(t('Esta selección no te pertenece o ya terminó.','This selection is not yours or already ended.'));
 if(action==='open'?i.message.id!==s.sent.id:i.message.id!==s.privateId)return refuse(t('Selector no válido.','Invalid selector.'));
 if(s.busy)return refuse(t('Procesando selección…','Processing selection…'));
 s.busy=true;
 try{
  if(action==='open')await i.deferReply({flags:MessageFlags.Ephemeral});else await i.deferUpdate();
  const spec=s.phase==='give'?s.giveSpec:s.takeSpec;
  if(action==='open'){
   const entries=await getPokedexEntries(i.guildId,i.user.id,{includeCopies:true});
   s.copies=entries.find(p=>p.id===spec.id&&!!p.isShiny===!!spec.isShiny)?.copies||[];
   if(!s.copies.length)return await i.editReply({content:t('No tienes copias de esa variante.','You have no copies of that variant.'),components:[]});
   s.privateId=(await i.editReply(panel(s,0))).id;return;
  }
  if(action==='page'){
   const page=Number(rawPage);if(!Number.isInteger(page)||page<0||page*20>=s.copies.length)throw Error('Invalid page');
   return await i.editReply(panel(s,page));
  }
  if(action!=='pick'||!s.copies.some(c=>String(c.id)===i.values[0]))throw Error('Invalid copy');
  const copy=await getCopy(i.guildId,i.user.id,i.values[0]);
  if(!copy||copy.pokemon_id!==spec.id||!!copy.is_shiny!==!!spec.isShiny||copy.battle_until>Date.now())throw Error('Copy unavailable');
  s[s.phase]=copy;
  if(s.phase==='give'&&s.takeSpec){s.phase='take';s.privateId=null;await s.sent.edit(launch(s));}
  else {await require('./transferManager').showTransfer(s.message,s.content,{give:s.give,take:s.take});sessions.delete(id);await s.sent.edit({content:t('Selección terminada. Revisa la oferta de confirmación.','Selection complete. Review the confirmation offer.'),components:[]});}
  await i.editReply({content:t('✅ Copia seleccionada. Falta confirmar la oferta.','✅ Copy selected. The offer still needs confirmation.'),components:[]});
 }catch(e){console.error('[Transfer selection]',e.message);await i.editReply({content:t('No se pudo seleccionar la copia. Puede estar en batalla o haber cambiado de propietario. Reabre el selector.','Could not select the copy. It may be battling or have changed owners. Reopen the selector.'),components:[]});}finally{s.busy=false;}
}
module.exports={showSelection,handleSelection};
