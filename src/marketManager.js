const {EmbedBuilder,ActionRowBuilder,StringSelectMenuBuilder,MessageFlags}=require('discord.js');
const {marketOffers,marketRotation,HOUR}=require('./marketCatalog');
const {getMarketState,buyMarketPokemon}=require('./marketStore');
const {getPreparedEmoji}=require('./emojiManager');
const {t}=require('./i18n');
const busy=new Set();
const title=name=>name.charAt(0).toUpperCase()+name.slice(1);
function render(guild,user,rotation,state,content=null){
  const offers=marketOffers(guild.id,rotation);
  const labels={common:t('Común','Common'),uncommon:t('No común','Uncommon'),rare:t('Súper raro','Super rare'),legendary:t('Legendario','Legendary'),mythical:t('Mítico','Mythical')};
  const lines=offers.map(p=>{
    let emoji='🔹';try{emoji=getPreparedEmoji(guild.client,'pkv2_'+p.id);}catch{}
    return `${state.purchased.includes(p.slot)?'✅':emoji} **${title(p.name)}** · ${labels[p.rarity]} · **${p.price} Pokécoins**${state.purchased.includes(p.slot)?t(' · Comprado',' · Purchased'):''}`;
  });
  const embed=new EmbedBuilder().setColor(0xffcb05).setTitle(t('🛒 Mercado Pokémon','🛒 Pokémon market'))
    .setDescription(t(`Tu saldo: **${state.balance} Pokécoins**\n\n`,`Your balance: **${state.balance} Pokécoins**\n\n`)+lines.join('\n')+
      t(`\n\nRenovación: <t:${Math.floor((rotation+1)*HOUR/1000)}:R>\nSeleccionar una oferta compra **1 copia normal** al precio indicado.`,`\n\nRefresh: <t:${Math.floor((rotation+1)*HOUR/1000)}:R>\nSelecting an offer buys **1 regular copy** at the listed price.`))
    .setFooter({text:t('Una compra por oferta y usuario · Gana monedas capturando Pokémon salvajes','One purchase per offer per user · Earn coins by catching wild Pokémon')});
  const available=offers.filter(p=>!state.purchased.includes(p.slot));
  const components=available.length?[new ActionRowBuilder().addComponents(new StringSelectMenuBuilder()
    .setCustomId(`pokemarket:${user}:${rotation}`).setPlaceholder(t('Comprar un Pokémon…','Buy a Pokémon…'))
    .addOptions(available.map(p=>({label:title(p.name),value:`${p.slot}:${p.id}:${p.price}`,description:labels[p.rarity]+' · '+p.price+' Pokécoins'}))))]:[];
  return {content,embeds:[embed],components,allowedMentions:{parse:[]}};
}
async function showMarket(message){
  const key=message.guild.id+':'+message.author.id;
  if(busy.has(key))return message.reply(t('⏳ Tu mercado está siendo procesado.','⏳ Your market is being processed.'));
  busy.add(key);let sent;
  try{
    sent=await message.reply({content:t('🛒 Cargando el mercado…','🛒 Loading the market…'),allowedMentions:{repliedUser:false}});
    const rotation=marketRotation();
    const state=await getMarketState(message.guild.id,message.author.id,rotation);
    await sent.edit(render(message.guild,message.author.id,rotation,state));
  }catch(error){
    console.error('[Pokemarket]',error.message);
    if(sent)await sent.edit({content:t('El mercado no está disponible en este momento. Intenta de nuevo más tarde.','The market is unavailable right now. Please try again later.'),embeds:[],components:[]});
    else throw error;
  }finally{busy.delete(key);}
}
async function handleMarket(i){
  const [,owner,rawRotation]=i.customId.split(':');
  const reply=content=>i.reply({content,flags:MessageFlags.Ephemeral});
  if(i.user.id!==owner)return reply(t('Abre tu propio mercado con `$pokemarket`.','Open your own market with `$pokemarket`.'));
  if(!/^\d+$/.test(rawRotation||''))return reply(t('Oferta no válida.','Invalid offer.'));
  const rotation=Number(rawRotation);
  // Old rotations may only acknowledge an already committed receipt in the database.
  const value=i.values?.[0]||'';
  const offer=marketOffers(i.guildId,rotation).find(p=>value===`${p.slot}:${p.id}:${p.price}`);
  if(!offer)return reply(t('La oferta cambió. Abre `$pokemarket` de nuevo.','The offer changed. Open `$pokemarket` again.'));
  const key=i.guildId+':'+owner;
  if(busy.has(key))return reply(t('⏳ Tu compra se está procesando.','⏳ Your purchase is processing.'));
  busy.add(key);let result;
  try{
    await i.deferUpdate();
    result=await buyMarketPokemon(i.guildId,owner,rotation,offer);
    let text;
    if(result.status==='purchased') text=result.new_purchase
      ?t(`✅ Compraste **${title(result.pokemon_name)}** por **${offer.price} Pokécoins**. Añadido a tu Pokédex. Saldo: **${result.balance}**.`,`✅ Bought **${title(result.pokemon_name)}** for **${offer.price} Pokécoins**. Added to your Pokédex. Balance: **${result.balance}**.`)
      :t('✅ Esta compra ya estaba guardada. No se volvió a cobrar.','✅ This purchase was already saved. You were not charged again.');
    else if(result.status==='insufficient')text=t(`❌ No tienes suficientes Pokécoins: necesitas ${offer.price} y tienes ${result.balance}.`,`❌ Not enough Pokécoins: you need ${offer.price} and have ${result.balance}.`);
    else text=t('Esta oferta expiró. Abre `$pokemarket` para ver la nueva lista.','This offer expired. Open `$pokemarket` to see the new list.');
    try{
      const state=await getMarketState(i.guildId,owner,rotation);
      const payload=render(i.guild,owner,rotation,state,text);
      if(rotation!==marketRotation())payload.components=[];
      await i.editReply(payload);
    }catch(error){
      console.warn('[Pokemarket refresh]',error.message);
      await i.editReply({content:text,embeds:[],components:[]});
    }
  }catch(error){
    console.error('[Pokemarket purchase]',error.message);
    if(i.deferred)await i.editReply({content:t('No se pudo confirmar la compra. Vuelve a seleccionar la misma oferta para comprobarla sin cobrar dos veces.','Could not confirm the purchase. Select the same offer again to check without being charged twice.')});
  }finally{busy.delete(key);}
}
module.exports={showMarket,handleMarket};
