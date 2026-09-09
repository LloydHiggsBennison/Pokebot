const sharp = require('sharp');

// Caché local: pokemon_id → emoji string "<:pkv2_X:id>"
// Se mantiene en memoria para no consultar la API de Discord en cada $p.
const localCache = new Map();

const MAX_EMOJIS = 48; // Dejar 2 slots de margen sobre el límite de 50
const EMOJI_PREFIX = 'pkv2_';

/**
 * Libera espacio de emojis del bot si hace falta, UNA sola vez por lote
 * (evita que varias subidas en paralelo intenten evictar al mismo tiempo).
 */
async function ensureCapacity(guild, neededSlots) {
  const freeSlots = MAX_EMOJIS - guild.emojis.cache.size;
  if (freeSlots >= neededSlots) return;

  const toFree = neededSlots - freeSlots;
  const botEmojis = guild.emojis.cache
    .filter((e) => e.name.startsWith(EMOJI_PREFIX))
    .first(toFree);

  await Promise.all(
    botEmojis.map((e) => {
      localCache.delete(Number(e.name.replace(EMOJI_PREFIX, '')));
      return e.delete('Liberando espacio para nuevos Pokémon').catch(() => {});
    })
  );
}

/**
 * Devuelve el emoji string para un Pokémon, creándolo si no existe.
 * Usa caché local primero, luego caché de Discord.js, y solo sube si es nuevo.
 * Asume que ya se llamó a ensureCapacity() antes si se está creando en lote.
 */
async function getOrCreateEmoji(guild, pokemon) {
  const emojiName = `${EMOJI_PREFIX}${pokemon.id}`;

  // 1. Caché local (0ms)
  if (localCache.has(pokemon.id)) return localCache.get(pokemon.id);

  // 2. Caché de Discord.js (ya en memoria, 0ms)
  const existing = guild.emojis.cache.find((e) => e.name === emojiName);
  if (existing) {
    localCache.set(pokemon.id, existing.toString());
    return existing.toString();
  }

  // 3. Crear el emoji en el servidor
  try {
    const processedBuffer = await sharp(pokemon.spriteBuffer)
      .trim()
      .resize(128, 128, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer();

    const created = await guild.emojis.create({ attachment: processedBuffer, name: emojiName });
    const str = created.toString();
    localCache.set(pokemon.id, str);
    return str;
  } catch (err) {
    console.warn(`[Emoji] No se pudo crear ${emojiName}:`, err.message);
    return '';
  }
}

/**
 * Prepara emojis para una lista de Pokémon EN PARALELO.
 * Los que ya están en caché son gratuitos (0ms).
 * Los nuevos liberan espacio una sola vez y se suben todos a la vez.
 */
async function prepareRollEmojis(guild, items) {
  const pending = items.filter((p) => !localCache.has(p.id));
  if (pending.length > 0) {
    await ensureCapacity(guild, pending.length);
  }
  return Promise.all(items.map((item) => getOrCreateEmoji(guild, item)));
}

/**
 * Pre-calienta emojis para una lista de Pokémon en background, EN PARALELO.
 * Antes se hacía uno por uno (mucho más lento); ahora se libera espacio una
 * vez y se lanzan todas las subidas a la vez.
 */
async function prewarmEmojis(guild, pokemons) {
  const pending = pokemons.filter((p) => !localCache.has(p.id));
  if (pending.length === 0) return;
  await ensureCapacity(guild, pending.length);
  await Promise.all(pending.map((pokemon) => getOrCreateEmoji(guild, pokemon).catch(() => {})));
}

module.exports = { prepareRollEmojis, prewarmEmojis };