const { ActionRowBuilder,StringSelectMenuBuilder,PermissionFlagsBits,MessageFlags }=require('discord.js');
const { t,setLanguage,withLanguage }=require('./i18n');
async function showLanguage(message,server=false) {
  if(server && !message.member?.permissions.has(PermissionFlagsBits.ManageGuild)) {
    return message.reply(t('Necesitas Administrar servidor para cambiar su idioma.','You need Manage Server to change its language.'));
  }
  const select=new StringSelectMenuBuilder().setCustomId(`language:${message.author.id}:${server?'guild':'user'}:${message.guild.id}`)
    .setPlaceholder(t('Elige un idioma','Choose a language')).addOptions({label:'Español',value:'es',emoji:'🇪🇸'},{label:'English',value:'en',emoji:'🇬🇧'});
  return message.reply({content:server?t('Idioma de los anuncios del servidor:','Server announcement language:'):t('Tu idioma:','Your language:'),components:[new ActionRowBuilder().addComponents(select)],allowedMentions:{parse:[]}});
}
async function handleLanguage(interaction) {
  const [,owner,scope,guild]=interaction.customId.split(':');
  if(owner!==interaction.user.id || guild!==interaction.guildId || !['user','guild'].includes(scope) ||
    (scope==='guild' && !interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild))) {
    return interaction.reply({content:t('Este selector no te pertenece o no tienes permisos.','This selector is not yours or you lack permission.'),flags:MessageFlags.Ephemeral});
  }
  const language=interaction.values[0];
  if(!['es','en'].includes(language)) return;
  await interaction.deferUpdate();
  try {
    await setLanguage(scope+':'+(scope==='user'?owner:guild),language);
    await withLanguage(language,()=>interaction.editReply({content:t('✅ Idioma guardado: Español.','✅ Language saved: English.'),components:[]}));
  } catch(error) {
    await interaction.editReply({content:t('No se pudo guardar el idioma. Intenta de nuevo.','Could not save the language. Please try again.'),components:[]});
    throw error;
  }
}
module.exports={showLanguage,handleLanguage};

