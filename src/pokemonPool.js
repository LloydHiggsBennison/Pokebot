// Pool completo: carga los 1025 Pokémon desde disco al arrancar (sprites en memoria).
// Nunca descarga nada en tiempo real — shuffle constante del array ya cargado.
// Memoria estimada: 1025 sprites × ~15KB ≈ ~15MB (manejable en Render free tier).

const { fetchSinglePokemonWithSprite, POKEMON_LIST } = require('./pokemonService');
const { prewarmEmojis } = require('./emojiManager');

let fullPool    = [];   // los 1025 Pokémon con spriteBuffer en memoria
let shuffled    = [];   // copia barajada para consumo
let isLoaded    = false;
let loadPromise = null;

/** Baraja el array completo y lo asigna a shuffled */
function reshuffle() {
  shuffled = [...fullPool].sort(() => Math.random() - 0.5);
}

/**
 * Carga TODOS los sprites desde disco al arrancar.
 * Como los sprites están en data/sprites/<id>.png, es solo lectura de disco.
 */
async function loadAllPokemon() {
  if (isLoaded) return;
  if (loadPromise) return loadPromise;

  loadPromise = (async () => {
    console.log(`[Pool] Cargando ${POKEMON_LIST.length} Pokémon desde disco...`);
    const start = Date.now();

    // Leer todos los sprites en paralelo (lectura de disco, sin red)
    const BATCH = 100;
    for (let i = 0; i < POKEMON_LIST.length; i += BATCH) {
      const batch = POKEMON_LIST.slice(i, i + BATCH);
      const results = await Promise.all(
        batch.map(p => fetchSinglePokemonWithSprite(p.id).catch(() => null))
      );
      fullPool.push(...results.filter(Boolean));
    }

    reshuffle();
    isLoaded = true;
    console.log(`[Pool] ✅ ${fullPool.length} Pokémon listos en ${Date.now() - start}ms`);
  })();

  return loadPromise;
}

/**
 * Devuelve `count` Pokémon únicos del pool shuffled.
 * Si el shuffled se agota, vuelve a barajar automáticamente.
 */
async function takeFromPool(count) {
  if (!isLoaded) {
    await loadAllPokemon();
  }

  // Si quedan pocos en el shuffled actual, rebara
  if (shuffled.length < count) {
    reshuffle();
  }

  return shuffled.splice(0, count);
}

/**
 * Arranca la carga del pool y pre-calienta emojis en background.
 * Se llama desde ready.js cuando el bot se conecta.
 */
function startPool(guild) {
  loadAllPokemon().then(() => {
    if (guild) {
      // Pre-calentar los emojis de los primeros 45 Pokémon shuffled (silencioso)
      prewarmEmojis(guild, shuffled.slice(0, 45)).catch(() => {});
    }
  }).catch(err => {
    console.error('[Pool] Error cargando Pokémon:', err.message);
  });
}

function poolSize() {
  return fullPool.length;
}

module.exports = { startPool, takeFromPool, poolSize };