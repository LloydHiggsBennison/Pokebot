const { t } = require('../i18n');
module.exports = {
  name: 'interactionCreate',
  async execute(interaction, client) {
    if (interaction.isButton?.() && interaction.customId.startsWith('pokefuse-replay:')) {
      try { await require('../pokefuseManager').handleFuseReplay(interaction); }
      catch (error) { console.error('[Pokefuse replay]', error.message); }
      return;
    }
    if (interaction.isStringSelectMenu?.() && interaction.customId.startsWith('language:')) {
      await require('../languageManager').handleLanguage(interaction);
      return;
    }
    if (interaction.isButton?.() && interaction.customId.startsWith('pokedex:')) {
      try {
        await require('../pokedexManager').handlePokedexButton(interaction);
      } catch (error) {
        console.error('[Pokedex] Error al cambiar página:', error.message);
        if (!interaction.replied && !interaction.deferred) {
          await interaction.reply({ content: t('No se pudo cambiar de página. Vuelve a usar `$pokedex`.', "Could not change the page. Use `$pokedex` again."), ephemeral: true });
        }
      }
      return;
    }
    if (interaction.isStringSelectMenu?.() && interaction.customId.startsWith('pokefuse:')) {
      try { await require('../pokefuseManager').handleFuseSelect(interaction); }
      catch (error) {
        console.error('[Pokefuse] Error:', error.message);
        if (!interaction.replied && !interaction.deferred) await interaction.reply({ content: t('No se pudo completar la fusión.', "Could not complete the fusion."), ephemeral: true });
      }
      return;
    }
    if (!interaction.isChatInputCommand()) return;

    const command = client.commands.get(interaction.commandName);
    if (!command) return;

    try {
      await command.execute(interaction);
    } catch (err) {
      console.error(err);
      const reply = { content: t('❌ Hubo un error al ejecutar el comando.', "❌ An error occurred executing the command."), ephemeral: true };
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp(reply);
      } else {
        await interaction.reply(reply);
      }
    }
  },
};
