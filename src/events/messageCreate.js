const { handleMessage } = require('../spawnManager');
const { rollPuzzle } = require('../puzzleManager');
const { getGuildSettings } = require('../database');
const { t } = require('../i18n');

module.exports = {
  name: 'messageCreate',
  async execute(message, client) {
    if (message.author.bot || !message.guild) return;

    const content = message.content.trim();
    if(content.toLowerCase()==='$pokemarket')return require('../marketManager').showMarket(message);
    if (/^(y|yes|si|sí|n|no)$/i.test(content) && await require('../transferManager').handleTransferReply(message)) return;
    if (/^\$p(?:k)?vw(?:\s|$)/i.test(content)) {
      return require('../pokemonViewManager').showPokemonView(message,content.replace(/^\$p(?:k)?vw\s*/i,''));
    }
    if (/^\$(idioma|language)(\s+(servidor|server))?$/i.test(content)) {
      return require('../languageManager').showLanguage(message, /\s/.test(content));
    }
    if (/^\$(pokecoins|saldo|balance)$/i.test(content)) {
      try {
        const balance=await require('../economy').getBalance(message.guild.id,message.author.id);
        return message.reply(t(`💰 Tienes **${balance} Pokécoins**.`,`💰 You have **${balance} Pokécoins**.`));
      } catch(error) { return message.reply(t('No se pudo consultar tu saldo.','Could not load your balance.')); }
    }
    const mention=content.match(/^<@!?(\d+)>\s+catch(?:\s+(.*))?$/i);
    if(mention && mention[1]===client.user?.id) return require('../catchManager').catchWild(message,mention[2] || '');
    if (/^\$pokedex(?:\s|$)/i.test(content)) {
      const argument=content.slice(8).trim();
      const target=argument ? await require('../guildMembers').resolveMention(message.guild,argument) : message.author;
      if(!target) return message.reply(t('Usa `$pokedex @usuario` con alguien de este servidor.','Use `$pokedex @user` with a member of this server.'));
      await require('../pokedexManager').showPokedex(message,target);
      return;
    }
    if (/^\$(poketrade|pokegive)(?:\s|$)/i.test(content)) {
      await require('../transferManager').showTransfer(message,content);
      return;
    }
    if (/^\$pokefuse(?:\s|$)/i.test(content)) {
      await require('../pokefuseManager').showFuse(message, content.slice(9).trim());
      return;
    }
    const quick = content.match(/^\$p\s+([+-]?[\d.]+)(?:\s.*)?$/i);
    if (quick) {
      try { await rollPuzzle(message, null, Number(content.slice(2).trim())); }
      catch (err) {
        console.error('[$p quick]', err);
        await message.reply(t('❌ No se pudo confirmar la tirada. Revisa tu Pokédex antes de repetirla.', '❌ Could not confirm the roll. Check your Pokédex before retrying.'));
      }
      return;
    }
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
        await message.reply(t('❌ Ocurrió un error generando el puzzle. Revisa la consola del bot.', "❌ An error occurred generating the puzzle. Check the bot logs."));
      }
      return;
    }

    // "<catchCmd> <nombre>" -> intento de atrapar el spawn salvaje activo del canal
    if (catchCmd && content.toLowerCase().startsWith(`${catchCmd.toLowerCase()} `)) {
      const guess = content.slice(catchCmd.length).trim();
      await require('../catchManager').catchWild(message, guess);
      return; // no contar el mensaje de captura como parte del contador de spawn
    }

    await handleMessage(client, message, settings);
  },
};
