const { POKEMON_LIST } = require('./pokemonService');

// A roll only needs IDs/names. Sprites are used exclusively during emoji setup.
let shuffled = [];

function reshuffle() {
  shuffled = [...POKEMON_LIST];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
}

function takeFromPool(count) {
  if (!Number.isInteger(count) || count < 1 || count > POKEMON_LIST.length) {
    throw new RangeError('Cantidad inválida de Pokémon para la tirada.');
  }
  if (shuffled.length < count) reshuffle();
  return shuffled.splice(0, count);
}

function startPool() { reshuffle(); }
function poolSize() { return POKEMON_LIST.length; }

module.exports = { startPool, takeFromPool, poolSize };
