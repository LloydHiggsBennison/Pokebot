const { t } = require('../i18n');
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
      return interaction.reply(t(`✅ Canal de spawns configurado en ${canal}.`, `✅ Spawn channel set to ${canal}.`));
    }

    if (sub === 'modo') {
      const valor = interaction.options.getString('valor');
      await updateGuildSettings(guildId, { mode: valor });
      await restartTimeSpawner(interaction.client, guildId);
      return interaction.reply(t(`✅ Modo de spawn cambiado a **${valor}**.`, `✅ Spawn mode set to **${valor}**.`));
    }

    if (sub === 'umbral_mensajes') {
      const min = interaction.options.getInteger('min');
      const max = interaction.options.getInteger('max');
      if (min < 1 || max < min) {
        return interaction.reply({
          content: t('⚠️ Rango inválido: min debe ser ≥ 1 y max ≥ min.', "⚠️ Invalid range: min must be ≥ 1 and max ≥ min."),
          ephemeral: true,
        });
      }
      await updateGuildSettings(guildId, { msg_min: min, msg_max: max });
      return interaction.reply(t(`✅ Umbral de mensajes configurado entre **${min}** y **${max}**.`, `✅ Message threshold set between **${min}** and **${max}**.`));
    }

    if (sub === 'intervalo') {
      const segundos = interaction.options.getInteger('segundos');
      if (segundos < 10) {
        return interaction.reply({
          content: t('⚠️ El intervalo mínimo recomendado es 10 segundos.', "⚠️ The minimum recommended interval is 10 seconds."),
          ephemeral: true,
        });
      }
      await updateGuildSettings(guildId, { time_interval_seconds: segundos });
      await restartTimeSpawner(interaction.client, guildId);
      return interaction.reply(t(`✅ Intervalo de tiempo configurado a **${segundos}** segundos.`, `✅ Time interval set to **${segundos}** seconds.`));
    }

    if (sub === 'comando_captura') {
      const comando = interaction.options.getString('comando');
      await updateGuildSettings(guildId, { catch_command: comando });
      return interaction.reply(t(`✅ Comando de captura cambiado a \`${comando}\`.`, `✅ Catch command set to \`${comando}\`.`));
    }

    if (sub === 'activar') {
      const valor = interaction.options.getBoolean('valor');
      await updateGuildSettings(guildId, { enabled: valor ? 1 : 0 });
      return interaction.reply(t(`✅ Spawns ${valor ? 'activados' : 'desactivados'}.`, `✅ Spawns ${valor ? 'enabled' : 'disabled'}.`));
    }

    if (sub === 'cooldown') {
      const segundos = interaction.options.getInteger('segundos');
      if (segundos < 0) {
        return interaction.reply({
          content: t('⚠️ El cooldown no puede ser negativo.', "⚠️ Cooldown cannot be negative."),
          ephemeral: true,
        });
      }
      await updateGuildSettings(guildId, { puzzle_cooldown_seconds: segundos });
      return interaction.reply(t(`✅ Cooldown del puzzle configurado a **${segundos}** segundos.`, `✅ Puzzle cooldown set to **${segundos}** seconds.`));
    }

    if (sub === 'ver') {
      const s = await getGuildSettings(guildId);
      return interaction.reply({
        content: [
          t('**Configuración actual:**', "**Current settings:**"),
          t(`• Canal: ${s.spawn_channel_id ? `<#${s.spawn_channel_id}>` : t('no configurado', "not configured")}`, `• Channel: ${s.spawn_channel_id ? `<#${s.spawn_channel_id}>` : t('no configurado', "not configured")}`),
          t(`• Modo: ${s.mode}`, `• Mode: ${s.mode}`),
          t(`• Umbral de mensajes: ${s.msg_min} - ${s.msg_max}`, `• Message threshold: ${s.msg_min} - ${s.msg_max}`),
          t(`• Intervalo de tiempo: ${s.time_interval_seconds}s`, `• Time interval: ${s.time_interval_seconds}s`),
          t(`• Comando de captura: \`${s.catch_command}\``, `• Catch command: \`${s.catch_command}\``),
          t(`• Cooldown puzzle ($p): ${s.puzzle_cooldown_seconds ?? 0}s`, `• Puzzle cooldown ($p): ${s.puzzle_cooldown_seconds ?? 0}s`),
          t(`• Activo: ${s.enabled ? 'sí' : 'no'}`, `• Enabled: ${s.enabled ? 'yes' : 'no'}`),
        ].join('\n'),
        ephemeral: true,
      });
    }
  },
};

// Discord localizes command discovery using the client's UI language; replies use $idioma.
const commandNames={canal:'channel',modo:'mode',valor:'value',umbral_mensajes:'message_threshold',
  intervalo:'interval',segundos:'seconds',comando_captura:'catch_command',comando:'command',
  activar:'enable',ver:'view'};
const descriptions={
  'Configura el bot de captura de Pokémon':'Configure the Pokémon bot',
  'Canal donde aparecerán los Pokémon':'Channel where Pokémon appear',
  'Canal de texto':'Text channel',
  'Modo de spawn: por mensajes, por tiempo, o ambos':'Spawn mode: messages, time or both',
  'Modo':'Mode',
  'Rango de mensajes para el spawn (modo mensajes)':'Message range for spawning in message mode',
  'Mínimo de mensajes':'Minimum messages','Máximo de mensajes':'Maximum messages',
  'Segundos entre spawns (modo tiempo)':'Seconds between spawns in time mode',
  'Segundos':'Seconds',
  'Comando que los usuarios escriben para atrapar (ej: $p)':'Command used to catch Pokémon (e.g. $p)',
  'Comando':'Command','Activa o desactiva los spawns':'Enable or disable spawns',
  'true/false':'true/false',
  'Segundos de cooldown entre tiradas de $p (0 para desactivar)':'Seconds between $p rolls (0 to disable)',
  'Segundos de cooldown':'Cooldown seconds','Muestra la configuración actual':'Show current settings',
};
function localize(builder) {
  const name=builder.name || builder.data?.name;
  const description=builder.description || builder.data?.description;
  if(commandNames[name]) builder.setNameLocalizations({'en-US':commandNames[name],'en-GB':commandNames[name]});
  if(descriptions[description]) builder.setDescriptionLocalizations({'en-US':descriptions[description],'en-GB':descriptions[description]});
  for(const option of builder.options || []) localize(option);
  for(const choice of builder.choices || []) {
    const translated={Mensajes:'Messages',Tiempo:'Time',Ambos:'Both'}[choice.name];
    if(translated) choice.name_localizations={'en-US':translated,'en-GB':translated};
  }
}
localize(module.exports.data);

