// Pokémon Service — carga los datos desde data/pokemon.json (generado una sola vez).
// El bot NUNCA llama a PokeAPI en tiempo real; solo descarga el sprite PNG desde el CDN.

const fs = require('fs');
const path = require('path');

// Cargar el listado completo de Pokémon al arrancar (síncrono, < 5ms)
const POKEMON_LIST = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'data', 'pokemon.json'), 'utf8')
);

console.log(`[PokemonService] ${POKEMON_LIST.length} Pokémon cargados desde archivo local.`);

/** Descarga el sprite PNG de un Pokémon dado su objeto { id, name, spriteUrl } */
async function fetchSprite(pokemon) {
  try {
    const res = await fetch(pokemon.spriteUrl);
    if (!res.ok) return null;
    const spriteBuffer = Buffer.from(await res.arrayBuffer());
    return { id: pokemon.id, name: pokemon.name, image: pokemon.spriteUrl, spriteBuffer };
  } catch (_) {
    return null;
  }
}

/**
 * Obtiene `count` Pokémon distintos al azar con sus sprites descargados en paralelo.
 * Solo 1 petición HTTP por Pokémon (solo la imagen PNG desde CDN de GitHub).
 */
async function getRandomPokemonBatch(count) {
  const shuffled = [...POKEMON_LIST].sort(() => Math.random() - 0.5);
  const candidates = shuffled.slice(0, count + 5); // extra por si alguno falla

  const results = await Promise.all(candidates.map(fetchSprite));
  const valid = results.filter(Boolean);
  return valid.slice(0, count);
}

/** Obtiene un único Pokémon por ID con sprite descargado */
async function fetchSinglePokemonWithSprite(id) {
  const pokemon = POKEMON_LIST.find((p) => p.id === id);
  if (!pokemon) return null;
  return fetchSprite(pokemon);
}

/** Obtiene un Pokémon aleatorio simple (sin sprite buffer) */
function getRandomPokemon() {
  return POKEMON_LIST[Math.floor(Math.random() * POKEMON_LIST.length)];
}

module.exports = { getRandomPokemon, getRandomPokemonBatch, fetchSinglePokemonWithSprite, POKEMON_LIST };
