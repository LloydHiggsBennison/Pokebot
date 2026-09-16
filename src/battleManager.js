const {EmbedBuilder,ActionRowBuilder,ButtonBuilder,ButtonStyle,StringSelectMenuBuilder,MessageFlags}=require('discord.js');
const {randomUUID}=require('node:crypto');
const store=require('./progressionStore'),engine=require('./battleEngine');
const {resolveMention}=require('./guildMembers');
const {t,withLanguage,guildLanguage}=require('./i18n');
let sweeping=false;
function button(id,action,label,style=ButtonStyle.Secondary){return new ButtonBuilder().setCustomId('pokefight:'+id+':'+action).setLabel(label).setStyle(style);}
function bar(f){return '█'.repeat(Math.round(f.hp/f.maxHp*10))+'░'.repeat(10-Math.round(f.hp/f.maxHp*10));}
function publicPayload(id,row){
  const s=row.state;
  let text=s.users.map(u=>'<@'+u+'>').join(' ⚔️ ');
  if(s.status==='invited')text+=t('\nEl destinatario debe abrir el desafío para aceptarlo en privado.','\nThe recipient must open the challenge to accept privately.');
  else if(s.status==='selecting')text+=t('\nCada jugador debe abrir su panel privado y elegir una copia.','\nEach player must open their private panel and choose a copy.');
  if(s.fighters?.some(Boolean))text+='\n\n'+s.fighters.filter(Boolean).map(f=>`**${f.shiny?'✨ ':''}${f.name} · Lv. ${f.level}** (<@${f.user}>)\n${bar(f)} **${f.hp}/${f.maxHp} HP**`).join('\n\n');
  if(s.status==='active')text+=t(`\n\nTurno de <@${s.fighters[s.turn].user}> · <t:${Math.floor(s.deadline/1000)}:R>`,`\n\n<@${s.fighters[s.turn].user}>'s turn · <t:${Math.floor(s.deadline/1000)}:R>`);
  if(s.status==='finished')text+=s.winner?t(`\n\n🏆 Ganó <@${s.winner}> · **+${s.xp||0} EXP**`,`\n\n🏆 <@${s.winner}> won · **+${s.xp||0} XP**`):t('\n\n🤝 Empate.','\n\n🤝 Draw.');
  if(s.status==='cancelled')text+=t('\n\nDesafío cancelado o expirado.','\n\nChallenge cancelled or expired.');
  if(s.log)text+='\n\n'+s.log;
  const ended=['finished','cancelled'].includes(s.status);
  return {content:null,embeds:[new EmbedBuilder().setColor(ended?0xffcb05:0xe95c4b).setTitle(t('⚔️ Batalla Pokémon','⚔️ Pokémon battle')).setDescription(text).setFooter({text:t('HP y PP se recuperan al terminar · Sin evoluciones','HP and PP recover after battle · No evolutions')})],
    components:ended?[]:[new ActionRowBuilder().addComponents(button(id,'open',t('Abrir panel privado','Open private panel'),ButtonStyle.Primary))],allowedMentions:{parse:[]}};
}
async function privatePayload(id,row,user,page=0){
  const s=row.state,revision=row.revision;
  if(s.status==='invited'){
    const options=user===s.users[1]?[button(id,'accept:'+revision,t('Aceptar batalla','Accept battle'),ButtonStyle.Success),button(id,'decline:'+revision,t('Rechazar','Decline'),ButtonStyle.Danger)]
      :[button(id,'decline:'+revision,t('Cancelar desafío','Cancel challenge'))];
    return {content:t('¿Quieres participar en esta batalla?','Would you like to join this battle?'),embeds:[],components:[new ActionRowBuilder().addComponents(options)]};
  }
  if(s.status==='selecting'){
    const {rows,total}=await store.copyPage(s.guildId,user,{page});
    if(!rows.length)return {content:t('No hay Pokémon en esta página. Vuelve a abrir tu panel.','No Pokémon on this page. Open your panel again.'),embeds:[],components:[new ActionRowBuilder().addComponents(button(id,'decline:'+revision,t('Cancelar','Cancel')))]};
    return {content:t(`Elige tu Pokémon · Página ${page+1}/${Math.ceil(total/20)}. Seleccionar otra copia sustituye la elección mientras esperas.`,`Choose your Pokémon · Page ${page+1}/${Math.ceil(total/20)}. You can change your choice while waiting.`),embeds:[],
      components:[new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId(`pokefight:${id}:pick:${revision}`).setPlaceholder(t('Elegir copia','Choose a copy')).addOptions(rows.map(c=>{
        const a=engine.stats(c);return {label:`${c.is_shiny?'✨ ':''}${c.pokemon_name} Lv.${a.level}`.slice(0,100),value:String(c.id),description:`HP ${a.hp} · ATK ${a.attack} · DEF ${a.defense} · SPD ${a.speed}`};
      }))),new ActionRowBuilder().addComponents(button(id,'page:'+Math.max(0,page-1),'👈').setDisabled(page===0),button(id,'page:'+(page+1),'👉').setDisabled((page+1)*20>=total),button(id,'decline:'+revision,t('Cancelar','Cancel')))]};
  }
  if(s.status!=='active')return {...publicPayload(id,row),content:t('La batalla terminó.','The battle has ended.')};
  const active=s.fighters[s.turn],isTurn=active.user===user;
  const components=[];
  if(isTurn)components.push(new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId(`pokefight:${id}:move:${revision}`).setPlaceholder(t('Elegir movimiento','Choose a move'))
    .addOptions(active.moves.map((m,index)=>({label:engine.moveName(m).slice(0,100),value:String(index),
      description:`${{attack1:t('Ataque 1','Attack 1'),attack2:t('Ataque 2','Attack 2'),defense:t('Defensa','Defense'),special:t('Especial','Special')}[m.role]} · ${m.remaining}/${m.pp} PP · ${m.effect==='damage'?'⚔ '+Math.min(m.power,40+active.level*2):{guard:t('Protección','Protection'),weaken:t('Baja ataque rival','Lowers enemy attack'),distract:t('Baja precisión rival','Lowers enemy accuracy'),heal:t('Recupera HP','Restores HP'),boost:t('Aumenta ataque','Raises attack'),transform:t('Copia al rival','Copies opponent')}[m.effect]}`.slice(0,100)})) )));
  components.push(new ActionRowBuilder().addComponents(button(id,'refresh',t('Actualizar','Refresh')),button(id,'surrender:'+revision,t('Rendirse','Surrender'),ButtonStyle.Danger)));
  return {content:isTurn?t('Es tu turno. Cada movimiento consume 1 PP.','Your turn. Each move uses 1 PP.'):t('Espera el turno de tu rival.','Wait for your opponent’s turn.'),embeds:[],components};
}
async function updatePublic(client,id,row){
  const s=row.state;
  try{
    const channel=await client.channels.fetch(s.channelId);
    await channel.messages.edit(s.messageId,withLanguage(guildLanguage(s.guildId),()=>publicPayload(id,row)));
  }catch(e){console.error('[Battle public]',e.message);}
}
async function challenge(message,mention){
  const other=await resolveMention(message.guild,mention);
  if(!other||other.bot||other.id===message.author.id)return message.reply(t('Usa `$pokefight @usuario` con otra persona de este servidor.','Use `$pokefight @user` with another person in this server.'));
  let sent;
  try{
    const checks=await Promise.all([message.author.id,other.id].map(user=>store.copyPage(message.guild.id,user)));
    if(checks.some(p=>!p.total))return message.reply(t('Ambos jugadores necesitan al menos un Pokémon.','Both players need at least one Pokémon.'));
    sent=await message.reply({content:t(`<@${other.id}>, tienes un desafío de batalla.`,`<@${other.id}>, you have a battle challenge.`),allowedMentions:{users:[other.id],repliedUser:false}});
    const id=randomUUID(),state={guildId:message.guild.id,channelId:message.channel.id,messageId:sent.id,users:[message.author.id,other.id],
      fighters:[null,null],status:'invited',deadline:Date.now()+300000};
    const row=await store.saveBattle(id,-1,message.author.id,state);await sent.edit(publicPayload(id,row));
  }catch(e){console.error('[Battle challenge]',e.message);const text=t('No se pudo abrir el desafío. Comprueba que ninguno esté en otra batalla.','Could not open the challenge. Check that neither player is already battling.');if(sent)await sent.edit({content:text,components:[]});else await message.reply(text);}
}
async function handleBattle(i){
  const [,id,action,arg]=i.customId.split(':');
  let row=await store.getBattle(id);
  const refuse=content=>i.reply({content,flags:MessageFlags.Ephemeral});
  if(!row||row.state.guildId!==i.guildId||!row.state.users.includes(i.user.id))return refuse(t('No participas en esta batalla.','You are not a participant in this battle.'));
  const opening=['open','page'].includes(action);
  if(opening)await i.deferReply({flags:MessageFlags.Ephemeral});else await i.deferUpdate();
  try{
    if(!['finished','cancelled'].includes(row.state.status)&&row.state.deadline<=Date.now()){
      const timed=engine.timeout(row.state),actor=row.state.status==='active'?row.state.fighters[row.state.turn].user:row.state.users[0];
      row=await store.saveBattle(id,row.revision,actor,timed);await updatePublic(i.client,id,row);
    }
    if(['open','page','refresh'].includes(action)){
      const page=action==='page'?Number(arg):0;if(!Number.isInteger(page)||page<0||page>100000)throw Error('Invalid page');
      return await i.editReply(await privatePayload(id,row,i.user.id,page));
    }
    if(Number(arg)!==row.revision)return await i.editReply(await privatePayload(id,row,i.user.id));
    let next=structuredClone(row.state);
    if(action==='accept'){
      if(next.status!=='invited'||i.user.id!==next.users[1])throw Error('Invalid acceptance');
      const members=await Promise.all(next.users.map(user=>i.guild.members.fetch(user).catch(()=>null)));
      if(members.some(m=>!m||m.user.bot))throw Error('Participant unavailable');
      next.status='selecting';next.deadline=Date.now()+300000;
    }else if(action==='decline'){
      if(!['invited','selecting'].includes(next.status))throw Error('Battle already active');
      next=engine.finish(next,i.user.id,'declined');
    }else if(action==='pick'){
      if(next.status!=='selecting')throw Error('Not selecting');
      const copy=await store.getCopy(i.guildId,i.user.id,i.values[0]);if(!copy)throw Error('Copy unavailable');
      next.fighters[next.users.indexOf(i.user.id)]=engine.fighter(copy,i.user.id);
      next.deadline=Date.now()+300000;if(next.fighters.every(Boolean))next=engine.startFight(next);
    }else if(action==='move')next=engine.act(next,i.user.id,Number(i.values[0]));
    else if(action==='surrender')next=engine.finish(next,i.user.id);
    else throw Error('Invalid action');
    row=await store.saveBattle(id,row.revision,i.user.id,next);
    await updatePublic(i.client,id,row);
    await i.editReply(await privatePayload(id,row,i.user.id));
  }catch(e){console.error('[Battle action]',e.message);await i.editReply({content:t('La acción no pudo confirmarse. Abre de nuevo el panel para ver el estado guardado; no repitas clics.','The action could not be confirmed. Reopen the panel to see the saved state.'),embeds:[],components:[]});}
}
function startBattleSweeper(client){
  const timer=setInterval(async()=>{
    if(sweeping)return;sweeping=true;
    try{for(const row of await store.expiredBattles()){
      const actor=row.state.status==='active'?row.state.fighters[row.state.turn].user:row.state.users[0];
      const result=await store.saveBattle(row.id,row.revision,actor,engine.timeout(row.state));await updatePublic(client,row.id,result);
    }}catch(e){console.error('[Battle timeout]',e.message);}finally{sweeping=false;}
  },15000);timer.unref();return timer;
}
module.exports={challenge,handleBattle,startBattleSweeper,publicPayload};
