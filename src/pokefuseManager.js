const {t}=require('./i18n');
const {EmbedBuilder,ActionRowBuilder,ButtonBuilder,ButtonStyle,MessageFlags}=require('discord.js');
const {randomBytes}=require('node:crypto');
const {getFusionAnimation}=require('./fusionAnimation');
const receipts=new Map(),running=new Set();
function cleanup(){for(const [id,s] of receipts)if(s.expires<=Date.now())receipts.delete(id);}
setInterval(cleanup,60000).unref();
function displayName(name){return name.charAt(0).toUpperCase()+name.slice(1);}
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
  const content=t(`✨ **Fusión completada: ${name} shiny**\nLa copia elegida se transformó conservando su progreso. Se consumieron otras 3 copias normales; conservas las restantes.`,`✨ **Fusion complete: ${name} shiny**\nThe selected copy transformed with its progress intact. Three other regular copies were consumed; you keep the rest.`);
  const shinyUrl='https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/shiny/'+candidate.id+'.png';
  try {
    await interaction.editReply({content:t('⚡ Fusión guardada. Las cuatro copias están concentrando su energía…','⚡ Fusion saved. The four copies are concentrating their energy…'),embeds:[],components:[],attachments:[]});
    const gif=await getFusionAnimation(candidate.id,name,t('es','en'));
    const canAttach=gif && gif.length <= (interaction.attachmentSizeLimit || 7*1024*1024);
    if(gif && !canAttach) console.warn('[Pokefuse animation] GIF exceeds attachment limit:',gif.length,interaction.attachmentSizeLimit);
    const embed=new EmbedBuilder().setColor(0xf4cf70)
      .setTitle(t(`✨ ¡Ha nacido un ${name} shiny!`,`✨ A shiny ${name} is born!`))
      .setImage(canAttach?'attachment://pokefuse.gif':shinyUrl)
      .setFooter({text:t('La copia elegida se transformó · Conserva nivel y estadísticas','The selected copy transformed · Level and stats preserved')});
    await interaction.editReply({content:content+(canAttach?'':mediaFailure),embeds:[embed],components:buttons(canAttach),attachments:[],files:canAttach?[{attachment:gif,name:'pokefuse.gif'}]:[]});
  } catch(error) {
    // The reward is already committed. A media/upload failure must never report a failed fusion.
    console.error('[Pokefuse animation]',error.message);
    try { await interaction.editReply({content:content+mediaFailure,embeds:[],components:buttons(false),attachments:[],files:[]}); }
    catch(deliveryError) { console.error('[Pokefuse confirmation]',deliveryError.message); }
  }
}

module.exports = { ...require('./fusionSelection'), handleFuseReplay, revealFusion };
