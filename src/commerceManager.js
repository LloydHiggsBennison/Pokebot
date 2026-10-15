const {EmbedBuilder,ActionRowBuilder,ButtonBuilder,ButtonStyle,StringSelectMenuBuilder,MessageFlags}=require('discord.js');
const {randomUUID}=require('node:crypto');
const store=require('./commerceStore');
const {PRICES,ticketReward}=require('./commerceCatalog');
const {copyPage}=require('./progressionStore');
const {stats}=require('./battleEngine');
const {t}=require('./i18n');
const sessions=new Map();
setInterval(()=>{for(const [id,s]of sessions)if(!s.busy&&s.expires<Date.now())sessions.delete(id);},60000).unref();
function session(guild,user){if(sessions.size>=500)throw Error('Too many panels');const s={id:randomUUID(),guild,user,expires:Date.now()+600000};sessions.set(s.id,s);return s;}
const button=(s,action,label)=>new ButtonBuilder().setCustomId(`commerce:${s.id}:${action}`).setLabel(label).setStyle(ButtonStyle.Secondary);
function wallet(state){const a=state.account;return t(`💰 Pokécoins: **${state.coins}**\n💳 Créditos: **${a.credits||0}**\n🎟️ Tiradas especiales: **${a.special||0}/${state.personal?50:10}**\n✨ Tickets legendarios shiny: **${a.legendary||0}**\n🌟 Tickets míticos normales: **${a.mythical||0}**\n🍬 Caramelos EXP: **${a.candy||0}**\nPremium personal: **${state.personal?'Sí':'No'}** · Servidor: **${state.server?'Sí':'No'}**`,`💰 Pokécoins: **${state.coins}**\n💳 Credits: **${a.credits||0}**\n🎟️ Special rolls: **${a.special||0}/${state.personal?50:10}**\n✨ Shiny legendary tickets: **${a.legendary||0}**\n🌟 Regular mythical tickets: **${a.mythical||0}**\n🍬 EXP candies: **${a.candy||0}**\nPersonal premium: **${state.personal?'Yes':'No'}** · Server: **${state.server?'Yes':'No'}**`);}
async function market(guild,user,content=null){
 const state=await store.state(guild,user),s=session(guild,user);s.day=state.day;s.price=PRICES[state.purchases];
 const rows=[];
 if(s.price)rows.push(new ActionRowBuilder().addComponents(button(s,'buy-coins',`${s.price} Pokécoins`),button(s,'buy-credits',`${s.price} ${t('créditos','credits')}`)));
 rows.push(new ActionRowBuilder().addComponents(button(s,'redeem-special',t('Usar tirada especial','Use special roll')),button(s,'redeem-legendary',t('Canjear legendario shiny','Redeem shiny legendary')),button(s,'redeem-mythical',t('Canjear mítico','Redeem mythical'))));
 rows.push(new ActionRowBuilder().addComponents(button(s,'item',t('1 caramelo · 100 créditos','1 candy · 100 credits'))));
 return {content,embeds:[new EmbedBuilder().setColor(0xffcb05).setTitle(t('🛒 Mercado y cartera','🛒 Market and wallet')).setDescription(wallet(state)+t(`\n\nCompras de hoy: **${state.purchases}/7**. Reinicio a las 00:00 de Chile.\nCada tirada especial garantiza 1 Pokémon: raro 83,33%, legendario 13,33%, mítico 3,33%. Shiny: 5%.\nCaramelo: +1.000 EXP con \`$plvl\`.`,`\n\nPurchases today: **${state.purchases}/7**. Resets at midnight in Chile.\nEach special roll guarantees 1 Pokémon: rare 83.33%, legendary 13.33%, mythical 3.33%. Shiny: 5%.\nCandy: +1,000 XP with \`$plvl\`.`))],components:rows,allowedMentions:{parse:[]}};
}
async function show(message,content){
 if(/^\$plvl(?:\s|$)/i.test(content)){
  const s=session(message.guild.id,message.author.id);const sent=await message.reply({content:t('🍬 Elige en privado la copia que quieres subir de nivel. Cada uso consume 1 caramelo (+1.000 EXP), máximo nivel 100.','🍬 Privately choose a copy to level up. Each use consumes 1 candy (+1,000 XP), maximum level 100.'),components:[new ActionRowBuilder().addComponents(button(s,'open-level',t('Elegir Pokémon','Choose Pokémon')))]});s.messageId=sent.id;return;
 }
 const sent=await message.reply(t('Cargando cartera…','Loading wallet…'));
 try{await sent.edit(await market(message.guild.id,message.author.id));}catch(e){console.error('[Commerce view]',e.message);await sent.edit(t('La cartera no está disponible. Comprueba la configuración de comercio.','Wallet unavailable. Check commerce configuration.'));}
}
async function levelPanel(s,page){
 const {rows,total}=await copyPage(s.guild,s.user,{page});
 if(!rows.length)return {content:t('No hay Pokémon en esta página.','No Pokémon on this page.'),embeds:[],components:[]};
 return {content:t(`Selecciona una copia para usar 1 caramelo · Página ${page+1}/${Math.ceil(total/20)}`,`Select a copy to use 1 candy · Page ${page+1}/${Math.ceil(total/20)}`),embeds:[],components:[new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId(`commerce:${s.id}:level`).setPlaceholder(t('Subir nivel','Level up')).addOptions(rows.map(c=>{const a=stats(c);return {label:`${c.pokemon_name}${c.is_shiny?' ✨':''} · Lv. ${a.level}`.slice(0,100),value:String(c.id),description:`IV ${(a.iv.reduce((x,y)=>x+y,0)/186*100).toFixed(2)}% · HP ${a.hp} · ATK ${a.attack} · DEF ${a.defense}`};}))),new ActionRowBuilder().addComponents(button(s,'page-'+Math.max(0,page-1),'👈').setDisabled(page===0),button(s,'page-'+(page+1),'👉').setDisabled((page+1)*20>=total))]};
}
async function handle(i){
 const [,id,action]=i.customId.split(':'),s=sessions.get(id);
 const refuse=content=>i.reply({content,flags:MessageFlags.Ephemeral});
 if(!store.enabled()||!s||s.expires<Date.now())return refuse(t('Panel expirado. Abre el comando de nuevo.','Panel expired. Open the command again.'));
 if(s.guild!==i.guildId||s.user!==i.user.id)return refuse(t('Este panel pertenece a otra persona.','This panel belongs to another person.'));
 if(s.busy)return refuse(t('Procesando…','Processing…'));s.busy=true;
 try{
  if(action==='open-level'){
   if(s.messageId!==i.message.id)throw Error('Invalid panel');await i.deferReply({flags:MessageFlags.Ephemeral});
   s.privateId=(await i.editReply(await levelPanel(s,0))).id;return;
  }
  await i.deferUpdate();
  if(action.startsWith('page-')){if(i.message.id!==s.privateId)throw Error('Invalid panel');const page=Number(action.slice(5));if(!Number.isInteger(page)||page<0||page>100000)throw Error('Invalid page');return await i.editReply(await levelPanel(s,page));}
  let kind,data={};
  if(action.startsWith('buy-')){kind='buy';data={currency:action.slice(4),price:s.price,day:s.day};}
  else if(action.startsWith('redeem-')){kind='redeem';const ticket=action.slice(7);s.rewards ||= {};s.rewards[action] ||= ticketReward(ticket);data={ticket,reward:s.rewards[action]};}
  else if(action==='item')kind='item';
  else if(action==='level'){
   if(i.message.id!==s.privateId)throw Error('Invalid panel');kind='level';s.copy ||=i.values[0];if(s.copy!==i.values[0])throw Error('Retry the selected copy');data={copy:s.copy,quantity:1};
  }else throw Error('Invalid action');
  const result=await store.action(s.guild,s.user,s.id+':'+action,kind,data);
  const messages={purchased:t('✅ Tirada especial guardada.','✅ Special roll saved.'),item_purchased:t('✅ Caramelo añadido.','✅ Candy added.'),daily_limit:t('Llegaste a las 7 compras diarias.','You reached 7 purchases today.'),capacity:t('Tu inventario está lleno. Usa una tirada antes de comprar.','Inventory full. Use a roll before buying.'),changed:t('El precio o día cambió. Revisa el mercado actualizado.','Price or day changed. Check the refreshed market.'),insufficient:t('Saldo insuficiente en la moneda elegida.','Insufficient selected currency.'),no_tickets:t('No tienes tickets de ese tipo.','No tickets of that type.'),no_items:t('No tienes caramelos EXP.','No EXP candies.'),max_level:t('Este Pokémon ya es nivel 100.','This Pokémon is already level 100.'),unavailable:t('Copia no disponible o en batalla.','Copy unavailable or battling.')};
  let text=messages[result.status]||result.status;
  if(result.status==='redeemed')text=t(`🎉 Obtuviste **${result.reward.name}${result.reward.isShiny?' shiny ✨':''}**. Guardado en tu Pokédex.`,`🎉 You received **${result.reward.name}${result.reward.isShiny?' shiny ✨':''}**. Saved in your Pokédex.`);
  if(result.status==='levelled')text=t(`🍬 **${result.name}** ahora está en nivel **${result.level}**. Se conserva su IV.`,`🍬 **${result.name}** is now level **${result.level}**. IVs preserved.`);
  if(kind==='level')return await i.editReply({content:text,embeds:[],components:[]});
  await i.editReply(await market(s.guild,s.user,text));
 }catch(e){console.error('[Commerce action]',e.message);if(i.deferred)await i.editReply({content:t('No se pudo confirmar. Reintenta el mismo botón para comprobar la operación sin duplicarla.','Could not confirm. Retry the same button to check without duplicating the operation.')});else await refuse(t('No se pudo abrir el panel.','Could not open panel.'));}finally{s.busy=false;}
}
module.exports={show,handle};
