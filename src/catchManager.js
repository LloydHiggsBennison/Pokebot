const { reserveCatch,finishCatch }=require('./spawnManager');
const { recordWildCapture }=require('./economy');
const { t }=require('./i18n');
async function catchWild(message,guess) {
  if(!guess) return message.reply(t('Usa `@Pokebot catch <nombre>`.','Use `@Pokebot catch <name>`.'));
  const pokemon=reserveCatch(message.guild.id,message.channel.id,guess,message.author.id);
  if(!pokemon) return message.reply(t('No hay un Pokémon con ese nombre disponible aquí, o ya se está capturando.','No Pokémon with that name is available here, or it is being caught.'));
  let result;
  try {
    result=await recordWildCapture(message.guild.id,message.author.id,pokemon);
    finishCatch(message.guild.id,pokemon.encounterId,true);
  } catch(error) {
    finishCatch(message.guild.id,pokemon.encounterId,false);
    console.error('[Catch]',error.message);
    return message.reply(t('No se pudo confirmar la captura. Repite el mismo comando para comprobarla sin duplicar premios.','Could not confirm the catch. Repeat the same command to check it without duplicating rewards.'));
  }
  if(!result) return message.reply(t('Este Pokémon ya fue capturado.','This Pokémon has already been caught.'));
  const name=result.pokemon_name.charAt(0).toUpperCase()+result.pokemon_name.slice(1);
  const iv=(result.iv_total/186*100).toFixed(2);
  return message.reply({content:t(
    `¡Felicidades **<@${message.author.id}>**! ¡Atrapaste un ${name} de nivel ${result.level} (${iv}%)! Añadido a tu Pokédex. ¡Recibiste ${result.coins} Pokécoins!`,
    `Congratulations **<@${message.author.id}>**! You caught a Level ${result.level} ${name} (${iv}%)! Added to Pokédex. You received ${result.coins} Pokécoins!`
  ),allowedMentions:{users:[message.author.id],repliedUser:false}});
}
module.exports={catchWild};

