const fs = require('node:fs/promises');
const path = require('node:path');
const { fetchWithTimeout } = require('./network');
const { selectPokemon } = require('./pokemonSelection');
const POKEMON_LIST = require('../data/pokemon.json');
const pokemonById = new Map(POKEMON_LIST.map(p => [p.id, p]));
const SPRITES_DIR = path.join(__dirname, '..', 'data', 'sprites');
const pendingSprites = new Map();

async function readOrDownloadSprite(pokemon) {
  const filePath = path.join(SPRITES_DIR, `${pokemon.id}.png`);
  try {
    const buffer = await fs.readFile(filePath);
    if (buffer.length) return buffer;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const response = await fetchWithTimeout(pokemon.spriteUrl);
  if (!response.ok) throw new Error(`Sprite ${pokemon.id}: HTTP ${response.status}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  if (!buffer.length) throw new Error(`Sprite ${pokemon.id} vacío.`);
  await fs.mkdir(SPRITES_DIR, { recursive: true });
  const temporary = `${filePath}.${process.pid}.tmp`;
  await fs.writeFile(temporary, buffer);
  await fs.rename(temporary, filePath);
  return buffer;
}

function getSpriteBuffer(pokemon) {
  if (!pendingSprites.has(pokemon.id)) {
    pendingSprites.set(pokemon.id, readOrDownloadSprite(pokemon)
      .finally(() => pendingSprites.delete(pokemon.id)));
  }
  return pendingSprites.get(pokemon.id);
}

async function fetchSinglePokemonWithSprite(id) {
  const pokemon = pokemonById.get(id);
  if (!pokemon) return null;
  return { id: pokemon.id, name: pokemon.name, image: pokemon.spriteUrl,
    spriteBuffer: await getSpriteBuffer(pokemon) };
}

async function getRandomPokemonBatch(count) {
  return Promise.all(selectPokemon(count).map(p => fetchSinglePokemonWithSprite(p.id)));
}

function getRandomPokemon() {
  const [pokemon] = selectPokemon();
  return { ...pokemon, image: pokemon.spriteUrl };
}

module.exports = { getRandomPokemon, getRandomPokemonBatch, fetchSinglePokemonWithSprite, POKEMON_LIST };
