// Pool de Pokémon pre-cargados en memoria (sprites ya descargados).
// Cuando llega $p, los sprites ya están listos -> respuesta casi instantánea.
// Ya NO se usan emojis de Discord (esa parte se quitó por los rate limits
// de la API de creación de emojis al usar mucha variedad de especies).

const { fetchSinglePokemonWithSprite } = require('./pokemonService');

const MAX_POKEMON_ID = 1025;
const POOL_TARGET = 45; // 3 tiradas completas en reserva
const REFILL_BATCH = 20;
const REFILL_INTERVAL_MS = 4000;

let pool = [];
let isRefilling = false;

function pickNewIds(count) {
  const existing = new Set(pool.map((p) => p.id));
  const ids = [];
  let attempts = 0;
  while (ids.length < count && attempts < count * 6) {
    const id = Math.floor(Math.random() * MAX_POKEMON_ID) + 1;
    if (!existing.has(id) && !ids.includes(id)) ids.push(id);
    attempts++;
  }
  return ids;
}

async function refillPool() {
  if (isRefilling || pool.length >= POOL_TARGET) return;
  isRefilling = true;

  try {
    const needed = Math.min(POOL_TARGET - pool.length, REFILL_BATCH);
    const ids = pickNewIds(needed + 5);

    const results = await Promise.all(ids.map((id) => fetchSinglePokemonWithSprite(id)));
    const valid = results.filter(Boolean);

    for (const p of valid) {
      if (pool.length < POOL_TARGET) pool.push(p);
    }

    console.log(`[Pool] ${pool.length}/${POOL_TARGET} Pokémon listos`);
  } catch (e) {
    console.warn('[Pool] Error rellenando pool:', e.message);
  } finally {
    isRefilling = false;
  }
}

async function takeFromPool(count) {
  if (pool.length >= count) {
    const taken = pool.splice(0, count);
    refillPool().catch(() => {});
    return taken;
  }

  // Pool bajo — fetch de emergencia
  const taken = pool.splice(0, pool.length);
  const missing = count - taken.length;
  console.warn(`[Pool] Pool bajo (${taken.length}/${count}), fetch de emergencia para ${missing}...`);

  const ids = pickNewIds(missing + 3);
  const results = await Promise.all(ids.map((id) => fetchSinglePokemonWithSprite(id)));
  const valid = results.filter(Boolean).slice(0, missing);

  refillPool().catch(() => {});
  return [...taken, ...valid];
}

function startPool() {
  console.log('[Pool] Iniciando pre-carga de Pokémon en background...');
  refillPool().catch(() => {});
  setInterval(() => refillPool().catch(() => {}), REFILL_INTERVAL_MS);
}

function poolSize() {
  return pool.length;
}

module.exports = { startPool, takeFromPool, poolSize };