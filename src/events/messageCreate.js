const { AttachmentBuilder } = require('discord.js');
const { handleMessage, tryCatch } = require('../spawnManager');
const { rollPuzzle } = require('../puzzleManager');
const { getGuildSettings, addCapture } = require('../database');

module.exports = {
  name: 'messageCreate',
  async execute(message, client) {
    if (message.author.bot || !message.guild) return;

    const content = message.content.trim();
    // $p can report initialization immediately, even if the database is down.
    const settings = content.toLowerCase() === '$p' ? null : await getGuildSettings(message.guild.id);
    const catchCmd = (settings?.catch_command || '$p').trim();

    // "$p" solo o el comando de captura configurado sin parámetros -> tirada personal (puzzle de 15 pokemon)
    if (content.toLowerCase() === '$p' || content.toLowerCase() === catchCmd.toLowerCase()) {
      console.log(`[$p] ${message.author.tag} en guild ${message.guild.id} inició una tirada...`);
      try {
        await rollPuzzle(message, settings);
        console.log(`[$p] ${message.author.tag} -> comando atendido.`);
      } catch (err) {
        console.error('[$p] Error durante la tirada:', err);
        await message.reply('❌ Ocurrió un error generando el puzzle. Revisa la consola del bot.');
      }
      return;
    }

    // "<catchCmd> <nombre>" -> intento de atrapar el spawn salvaje activo del canal
    if (catchCmd && content.toLowerCase().startsWith(`${catchCmd.toLowerCase()} `)) {
      const guess = content.slice(catchCmd.length).trim();
      const caught = tryCatch(message.guild.id, guess);

      if (caught) {
        await addCapture(message.guild.id, message.author.id, caught.name, caught.id);
        const capitalize = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : '');

        const files = [];
        if (caught.image) {
          try {
            const spriteRes = await fetch(caught.image, { signal: AbortSignal.timeout(5000) });
            if (spriteRes.ok) {
              const spriteBuf = Buffer.from(await spriteRes.arrayBuffer());
              files.push(new AttachmentBuilder(spriteBuf, { name: `${caught.name}.png` }));
            }
          } catch (e) {}
        }

        await message.reply({
          content: `¡Felicidades ${message.author}! Atrapaste a **${capitalize(caught.name)}**.`,
          files,
        });
      }
      return; // no contar el mensaje de captura como parte del contador de spawn
    }

    await handleMessage(client, message, settings);
  },
};
