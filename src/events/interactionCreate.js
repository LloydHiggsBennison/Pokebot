module.exports = {
  name: 'interactionCreate',
  async execute(interaction, client) {
    if (interaction.isButton?.() && interaction.customId.startsWith('pokedex:')) {
      try {
        await require('../pokedexManager').handlePokedexButton(interaction);
      } catch (error) {
        console.error('[Pokedex] Error al cambiar página:', error.message);
        if (!interaction.replied && !interaction.deferred) {
          await interaction.reply({ content: 'No se pudo cambiar de página. Vuelve a usar `$pokedex`.', ephemeral: true });
        }
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
      const reply = { content: '❌ Hubo un error al ejecutar el comando.', ephemeral: true };
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp(reply);
      } else {
        await interaction.reply(reply);
      }
    }
  },
};
