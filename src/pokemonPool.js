const POKEMON_LIST = require('../data/pokemon.json');
const { selectPokemon } = require('./pokemonSelection');

// Independent weighted draws, unique within a roll; no rare-species cycle.

function takeFromPool(count) {
  if (!Number.isInteger(count) || count < 1 || count > POKEMON_LIST.length) {
    throw new RangeError('Cantidad inválida de Pokémon para la tirada.');
  }
  return selectPokemon(count);
}

function startPool() {}
function poolSize() { return POKEMON_LIST.length; }

module.exports = { startPool, takeFromPool, poolSize };
