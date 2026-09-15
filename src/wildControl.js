const {SlashCommandBuilder,PermissionFlagsBits,MessageFlags}=require('discord.js');
const {getGuildSettings,updateGuildSettings}=require('./database');
const {restartTimeSpawner}=require('./spawnManager');
const {t}=require('./i18n');

function command(enabled){
  return {
    data:new SlashCommandBuilder().setName(enabled?'pokewake':'pokesleep')
      .setDescription(enabled?'Reanuda las apariciones de Pokémon salvajes':'Pausa las apariciones de Pokémon salvajes')
      .setDescriptionLocalizations({'en-US':enabled?'Resume wild Pokémon appearances':'Pause wild Pokémon appearances'})
      .setDMPermission(false).setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
    async execute(i){
      if(!i.guildId||!i.memberPermissions?.has(PermissionFlagsBits.ManageGuild))
        return i.reply({content:t('Necesitas el permiso Administrar servidor.','You need the Manage Server permission.'),flags:MessageFlags.Ephemeral});
      await i.deferReply({flags:MessageFlags.Ephemeral});
      try{
        const settings=await getGuildSettings(i.guildId);
        if(enabled&&!settings.spawn_channel_id)return i.editReply(t('Primero elige un canal con `/pokeconfig canal`.','First choose a channel with `/pokeconfig canal`.'));
        await updateGuildSettings(i.guildId,{enabled:enabled?1:0});
        await restartTimeSpawner(i.client,i.guildId);
        return i.editReply(enabled
          ?t(`☀️ Pokémon salvajes reactivados en <#${settings.spawn_channel_id}>. Se conserva la frecuencia configurada.`,`☀️ Wild Pokémon resumed in <#${settings.spawn_channel_id}>. The configured frequency is preserved.`)
          :t('💤 Apariciones de Pokémon salvajes pausadas. Usa `/pokewake` para reanudarlas. Puedes seguir atrapando al que ya apareció y usar los demás comandos.','💤 Wild Pokémon appearances paused. Use `/pokewake` to resume. You can still catch an existing encounter and use the other commands.'));
      }catch(error){
        console.error('[Wild control]',error.message);
        return i.editReply(t('No se pudo confirmar el cambio. Consulta `/pokeconfig ver` y vuelve a intentarlo.','Could not confirm the change. Check `/pokeconfig ver` and try again.'));
      }
    },
  };
}
module.exports={command};
