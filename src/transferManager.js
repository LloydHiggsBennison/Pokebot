const {ActionRowBuilder,ButtonBuilder,ButtonStyle,MessageFlags}=require('discord.js');
const {randomUUID}=require('node:crypto');
const catalog=require('../data/pokemon.json');
const {resolveMention}=require('./guildMembers');
const {transferPokemon}=require('./transferStore');
const {stats}=require('./battleEngine');
const {t}=require('./i18n');
const sessions=new Map(), pending=new Set(), pendingRecipients=new Set();
const normalize=name=>name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/♀/g,'f').replace(/♂/g,'m').replace(/[^a-z0-9]/g,'');
function parsePokemon(text) {
  const shiny=/\s+shiny$/i.test(text);
  const name=normalize(text.replace(/\s+shiny$/i,'').trim());
  const p=catalog.find(p=>normalize(p.name)===name);
  return p?{...p,isShiny:shiny}:null;
}
function cleanup(){for(const [id,s] of sessions) if(!s.running && s.expires<=Date.now()) sessions.delete(id);}
setInterval(cleanup,60000).unref();
const label=p=>{const a=stats(p);return (p.is_shiny?'✨ ':'')+p.pokemon_name+(p.is_shiny?' shiny':'')+` · #${p.id} · Lv. ${a.level} · IV ${(a.iv.reduce((sum,n)=>sum+n,0)/186*100).toFixed(2)}%`;};
function controls(s) {
  return [new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('poketransfer:'+s.id+':accept').setLabel(s.take?t('Aceptar intercambio','Accept trade'):t('Confirmar regalo','Confirm gift')).setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('poketransfer:'+s.id+':cancel').setLabel(t('Cancelar','Cancel')).setStyle(ButtonStyle.Secondary))];
}
async function showTransfer(message,content,selected) {
  if(!selected)return require('./transferSelection').showSelection(message,content);
  const trade=/^\$poketrade(?:\s|$)/i.test(content);
  const args=content.replace(/^\$(poketrade|pokegive)\s*/i,'').match(/^(<@!?\d+>)\s+(.+)$/);
  const pieces=args?.[2].split(/\s*\/\s*/);
  if(!args || pieces.length!==(trade?2:1)) return message.reply(t('Usa `$poketrade @usuario charizard / blastoise` o `$pokegive @usuario pikachu`. Añade `shiny` al nombre para esa variante.','Use `$poketrade @user charizard / blastoise` or `$pokegive @user pikachu`. Add `shiny` after a name for that variant.'));
  const key=message.guild.id+':'+message.author.id;
  if(pending.has(key)) return message.reply(t('⏳ Preparando tu oferta.','⏳ Preparing your offer.'));
  pending.add(key);
  let recipientKey;
  try {
    const receiver=await resolveMention(message.guild,args[1]);
    if(!receiver || receiver.bot || receiver.id===message.author.id) return message.reply(t('Elige a otra persona de este servidor.','Choose another person in this server.'));
    const giveSpec=parsePokemon(pieces[0]),takeSpec=trade?parsePokemon(pieces[1]):null;
    if(!giveSpec || (trade && !takeSpec)) return message.reply(t('Nombre de Pokémon no válido. Revisa `$pokedex`.','Invalid Pokémon name. Check `$pokedex`.'));
    const give=selected.give;
    const take=trade?selected.take:null;
    if(!give || (trade && !take)) return message.reply(t('Falta una de las copias indicadas. Revisa la especie y si es normal o shiny.','One of the specified copies is missing. Check the species and regular/shiny variant.'));
    cleanup();
    if(sessions.size>=200) return message.reply(t('Hay demasiadas ofertas pendientes. Intenta más tarde.','There are too many pending offers. Try later.'));
    recipientKey=message.guild.id+':'+message.channel.id+':'+receiver.id;
    if(pendingRecipients.has(recipientKey) || [...sessions.values()].some(s=>s.receiverId===receiver.id && s.channelId===message.channel.id && (s.expires>Date.now() || s.attempted))) {
      recipientKey=null;
      return message.reply(t('Ese usuario ya tiene una oferta pendiente en este canal. Debe responderla primero.','That user already has a pending offer in this channel. They must respond first.'));
    }
    pendingRecipients.add(recipientKey);
    const s={id:randomUUID(),guildId:message.guild.id,channelId:message.channel.id,senderId:message.author.id,receiverId:receiver.id,give,take,expires:Date.now()+300000};
    const description=trade
      ?t(`<@${s.senderId}> ofrece **${label(give)}** a <@${s.receiverId}> por **${label(take)}**.\nEl destinatario debe aceptar. Se intercambia una copia de cada Pokémon.`,`<@${s.senderId}> offers **${label(give)}** to <@${s.receiverId}> for **${label(take)}**.\nThe recipient must accept. One copy of each Pokémon is exchanged.`)
      :t(`<@${s.receiverId}>, <@${s.senderId}> quiere darte **1 ${label(give)}**. ¿Confirmar regalo?`,`<@${s.receiverId}>, <@${s.senderId}> wants to give you **1 ${label(give)}**. Accept gift?`);
    const sent=await message.reply({content:description+t('\nResponde **y / yes / sí** o **n / no**, o usa los botones.\nEste regalo/intercambio es gratis · Expira en 5 minutos.','\nReply **y / yes** or **n / no**, or use the buttons.\nThis gift/trade is free · Expires in 5 minutes.'),components:controls(s),allowedMentions:{users:[receiver.id],repliedUser:false}});
    s.messageId=sent.id;s.sent=sent;sessions.set(s.id,s);
  } catch(error) {
    console.error('[Poketransfer offer]',error.message);
    await message.reply(t('No se pudo preparar la oferta. Intenta de nuevo.','Could not prepare the offer. Please try again.'));
  } finally {pending.delete(key);if(recipientKey)pendingRecipients.delete(recipientKey);}
}
async function handleTransfer(i) {
  const [,id,action]=i.customId.split(':');
  const s=sessions.get(id);
  const reply=content=>i.reply({content,flags:MessageFlags.Ephemeral});
  if(!s || s.expires<=Date.now()) {if(s && !s.running)sessions.delete(id);return reply(t('Esta oferta expiró o ya terminó.','This offer expired or has finished.'));}
  if(i.guildId!==s.guildId || i.message.id!==s.messageId || !['accept','cancel'].includes(action)) return reply(t('Oferta no válida.','Invalid offer.'));
  const actor=action==='accept'?s.receiverId:null;
  if(actor?i.user.id!==actor:![s.senderId,s.receiverId].includes(i.user.id)) return reply(t('No puedes confirmar esta oferta.','You cannot confirm this offer.'));
  if(s.running) return reply(t('⏳ Esta operación se está procesando.','⏳ This operation is being processed.'));
  if(action==='cancel') {
    if(s.attempted) return reply(t('El resultado aún debe confirmarse. Pulsa aceptar para comprobarlo sin duplicar la transferencia.','The result still needs confirmation. Accept again to check without duplicating the transfer.'));
    sessions.delete(id);
    return i.update({content:t('Oferta cancelada.','Offer cancelled.'),embeds:[],components:[]});
  }
  s.running=true;
  try {
    await i.deferUpdate();
    {
      const members=await Promise.all([s.senderId,s.receiverId].map(user=>i.guild.members.fetch(user).catch(()=>null)));
      if(members.some(m=>!m || m.user.bot)) {
        sessions.delete(id);await i.editReply({content:t('Ambos participantes deben seguir en este servidor.','Both participants must still be in this server.'),embeds:[],components:[]});return;
      }
    }
    s.attempted=true;s.expires=Date.now()+1800000;
    const success=await transferPokemon(s);
    await i.editReply({content:success?t('✅ Transferencia completada. Las Pokédex ya están actualizadas.','✅ Transfer complete. Both Pokédex collections are updated.'):t('❌ La operación no se realizó: una copia cambió de propietario o ya no existe.','❌ Nothing was transferred: a copy changed owners or no longer exists.'),embeds:[],components:[]});
    sessions.delete(id);
  } catch(error) {
    console.error('[Poketransfer]',error.message);
    if(i.deferred) await i.editReply({content:t('No se pudo confirmar el resultado. Revisa las Pokédex y pulsa aceptar para comprobar la misma operación sin duplicarla.','Could not confirm the result. Check both Pokédex collections and accept again to verify the same operation without duplicating it.'),components:controls(s)});
  } finally {s.running=false;}
}
async function handleTransferReply(message) {
  const answer=message.content.trim().toLowerCase();
  if(!['y','yes','si','sí','n','no'].includes(answer)) return false;
  const s=[...sessions.values()].find(s=>s.guildId===message.guild.id && s.channelId===message.channel.id && s.receiverId===message.author.id && (s.expires>Date.now() || s.attempted));
  if(!s) return false;
  await handleTransfer({customId:'poketransfer:'+s.id+':'+(['n','no'].includes(answer)?'cancel':'accept'),
    guildId:message.guild.id,guild:message.guild,user:message.author,message:{id:s.messageId},
    async deferUpdate(){this.deferred=true;},editReply:p=>s.sent.edit(p),update:p=>s.sent.edit(p),
    reply:p=>message.reply({content:p.content,allowedMentions:{parse:[]}})});
  return true;
}
module.exports={showTransfer,handleTransfer,handleTransferReply,parsePokemon};
