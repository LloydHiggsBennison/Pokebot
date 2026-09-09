const fs   = require('fs');
const path = require('path');

const POKEMON_LIST = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'data', 'pokemon.json'), 'utf8')
);

const SPRITES_DIR = path.join(__dirname, '..', 'data', 'sprites');

console.log(`[PokemonService] ${POKEMON_LIST.length} Pokémon cargados desde archivo local.`);

/**
 * Obtiene el buffer del sprite:
 * 1. Lee desde disco local (data/sprites/<id>.png) → instantáneo
 * 2. Si no existe, descarga desde CDN y lo guarda en disco para la próxima vez
 */
async function getSpriteBuffer(pokemon) {
  const filePath = path.join(SPRITES_DIR, `${pokemon.id}.png`);

  // Leer desde disco (< 1ms)
  if (fs.existsSync(filePath)) {
    return fs.readFileSync(filePath);
  }

  // Fallback: descargar y cachear en disco
  try {
    const res = await fetch(pokemon.spriteUrl);
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    fs.mkdirSync(SPRITES_DIR, { recursive: true });
    fs.writeFileSync(filePath, buf); // guardar para próxima vez
    return buf;
  } catch (_) {
    return null;
  }
}

/** Construye el objeto completo de un Pokémon con su spriteBuffer */
async function fetchSinglePokemonWithSprite(id) {
  const pokemon = POKEMON_LIST.find(p => p.id === id);
  if (!pokemon) return null;

  const spriteBuffer = await getSpriteBuffer(pokemon);
  if (!spriteBuffer) return null;

  return { id: pokemon.id, name: pokemon.name, image: pokemon.spriteUrl, spriteBuffer };
}

/**
 * Obtiene `count` Pokémon distintos al azar con sus sprites.
 * Si los sprites están en disco → todo local, sin red.
 */
async function getRandomPokemonBatch(count) {
  const shuffled  = [...POKEMON_LIST].sort(() => Math.random() - 0.5);
  const candidates = shuffled.slice(0, count + 5);

  const results = await Promise.all(candidates.map(p => fetchSinglePokemonWithSprite(p.id)));
  return results.filter(Boolean).slice(0, count);
}

function getRandomPokemon() {
  return POKEMON_LIST[Math.floor(Math.random() * POKEMON_LIST.length)];
}

module.exports = { getRandomPokemon, getRandomPokemonBatch, fetchSinglePokemonWithSprite, POKEMON_LIST };
