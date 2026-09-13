const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { getGuildSettings, updateGuildSettings } = require('../database');
const { restartTimeSpawner } = require('../spawnManager');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('pokeconfig')
    .setDescription('Configura el bot de captura de Pokémon')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((sub) =>
      sub
        .setName('canal')
        .setDescription('Canal donde aparecerán los Pokémon')
        .addChannelOption((opt) =>
          opt.setName('canal').setDescription('Canal de texto').setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('modo')
        .setDescription('Modo de spawn: por mensajes, por tiempo, o ambos')
        .addStringOption((opt) =>
          opt
            .setName('valor')
            .setDescription('Modo')
            .setRequired(true)
            .addChoices(
              { name: 'Mensajes', value: 'messages' },
              { name: 'Tiempo', value: 'time' },
              { name: 'Ambos', value: 'both' }
            )
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('umbral_mensajes')
        .setDescription('Rango de mensajes para el spawn (modo mensajes)')
        .addIntegerOption((opt) =>
          opt.setName('min').setDescription('Mínimo de mensajes').setRequired(true)
        )
        .addIntegerOption((opt) =>
          opt.setName('max').setDescription('Máximo de mensajes').setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('intervalo')
        .setDescription('Segundos entre spawns (modo tiempo)')
        .addIntegerOption((opt) =>
          opt.setName('segundos').setDescription('Segundos').setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('comando_captura')
        .setDescription('Comando que los usuarios escriben para atrapar (ej: $p)')
        .addStringOption((opt) =>
          opt.setName('comando').setDescription('Comando').setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('activar')
        .setDescription('Activa o desactiva los spawns')
        .addBooleanOption((opt) =>
          opt.setName('valor').setDescription('true/false').setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('cooldown')
        .setDescription('Segundos de cooldown entre tiradas de $p (0 para desactivar)')
        .addIntegerOption((opt) =>
          opt.setName('segundos').setDescription('Segundos de cooldown').setRequired(true)
        )
    )
    .addSubcommand((sub) => sub.setName('ver').setDescription('Muestra la configuración actual')),

  async execute(interaction) {
    const guildId = interaction.guild.id;
    const sub = interaction.options.getSubcommand();

    if (sub === 'canal') {
      const canal = interaction.options.getChannel('canal');
      await updateGuildSettings(guildId, { spawn_channel_id: canal.id });
      await restartTimeSpawner(interaction.client, guildId);
      return interaction.reply(`✅ Canal de spawns configurado en ${canal}.`);
    }

    if (sub === 'modo') {
      const valor = interaction.options.getString('valor');
      await updateGuildSettings(guildId, { mode: valor });
      await restartTimeSpawner(interaction.client, guildId);
      return interaction.reply(`✅ Modo de spawn cambiado a **${valor}**.`);
    }

    if (sub === 'umbral_mensajes') {
      const min = interaction.options.getInteger('min');
      const max = interaction.options.getInteger('max');
      if (min < 1 || max < min) {
        return interaction.reply({
          content: '⚠️ Rango inválido: min debe ser ≥ 1 y max ≥ min.',
          ephemeral: true,
        });
      }
      await updateGuildSettings(guildId, { msg_min: min, msg_max: max });
      return interaction.reply(`✅ Umbral de mensajes configurado entre **${min}** y **${max}**.`);
    }

    if (sub === 'intervalo') {
      const segundos = interaction.options.getInteger('segundos');
      if (segundos < 10) {
        return interaction.reply({
          content: '⚠️ El intervalo mínimo recomendado es 10 segundos.',
          ephemeral: true,
        });
      }
      await updateGuildSettings(guildId, { time_interval_seconds: segundos });
      await restartTimeSpawner(interaction.client, guildId);
      return interaction.reply(`✅ Intervalo de tiempo configurado a **${segundos}** segundos.`);
    }

    if (sub === 'comando_captura') {
      const comando = interaction.options.getString('comando');
      await updateGuildSettings(guildId, { catch_command: comando });
      return interaction.reply(`✅ Comando de captura cambiado a \`${comando}\`.`);
    }

    if (sub === 'activar') {
      const valor = interaction.options.getBoolean('valor');
      await updateGuildSettings(guildId, { enabled: valor ? 1 : 0 });
      return interaction.reply(`✅ Spawns ${valor ? 'activados' : 'desactivados'}.`);
    }

    if (sub === 'cooldown') {
      const segundos = interaction.options.getInteger('segundos');
      if (segundos < 0) {
        return interaction.reply({
          content: '⚠️ El cooldown no puede ser negativo.',
          ephemeral: true,
        });
      }
      await updateGuildSettings(guildId, { puzzle_cooldown_seconds: segundos });
      return interaction.reply(`✅ Cooldown del puzzle configurado a **${segundos}** segundos.`);
    }

    if (sub === 'ver') {
      const s = await getGuildSettings(guildId);
      return interaction.reply({
        content: [
          '**Configuración actual:**',
          `• Canal: ${s.spawn_channel_id ? `<#${s.spawn_channel_id}>` : 'no configurado'}`,
          `• Modo: ${s.mode}`,
          `• Umbral de mensajes: ${s.msg_min} - ${s.msg_max}`,
          `• Intervalo de tiempo: ${s.time_interval_seconds}s`,
          `• Comando de captura: \`${s.catch_command}\``,
          `• Cooldown puzzle ($p): ${s.puzzle_cooldown_seconds ?? 0}s`,
          `• Activo: ${s.enabled ? 'sí' : 'no'}`,
        ].join('\n'),
        ephemeral: true,
      });
    }
  },
};
