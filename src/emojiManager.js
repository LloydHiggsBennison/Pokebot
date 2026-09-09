const sharp = require('sharp');

// Caché local: pokemon_id → emoji string "<:pkv2_X:id>"
const localCache = new Map();

const MAX_EMOJIS   = 48;
const EMOJI_PREFIX = 'pkv2_';

async function ensureCapacity(guild, neededSlots) {
  const freeSlots = MAX_EMOJIS - guild.emojis.cache.size;
  if (freeSlots >= neededSlots) return;

  const toFree = neededSlots - freeSlots + 2; // un poco de margen
  const botEmojis = guild.emojis.cache
    .filter(e => e.name.startsWith(EMOJI_PREFIX) || e.name.startsWith('pk_'))
    .first(toFree);

  for (const e of botEmojis) {
    localCache.delete(Number(e.name.replace(EMOJI_PREFIX, '').replace('pk_', '')));
    await e.delete('Liberando espacio').catch(() => {});
  }
}

/**
 * Devuelve el emoji string para un Pokémon.
 * Caché local → caché Discord.js → crea el emoji (si hace falta).
 * Creación SECUENCIAL para respetar los rate limits de Discord.
 */
async function getOrCreateEmoji(guild, pokemon) {
  const emojiName = `${EMOJI_PREFIX}${pokemon.id}`;

  // 1. Caché local (0ms)
  if (localCache.has(pokemon.id)) return localCache.get(pokemon.id);

  // 2. Caché de Discord.js (ya en memoria, 0ms)
  const existing = guild.emojis.cache.find(e => e.name === emojiName);
  if (existing) {
    localCache.set(pokemon.id, existing.toString());
    return existing.toString();
  }

  // 3. Crear el emoji en Discord (máx 1 a la vez para evitar rate limits)
  try {
    await ensureCapacity(guild, 1);

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
    return ''; // sin emoji si falla
  }
}

/**
 * Prepara emojis para una lista de Pokémon de forma SECUENCIAL.
 * Los que ya están en caché se resuelven en 0ms.
 * Los nuevos se crean uno a uno para no hacer rate limit con Discord.
 */
async function prepareRollEmojis(guild, items) {
  const results = [];
  for (const item of items) {
    results.push(await getOrCreateEmoji(guild, item));
  }
  return results;
}

/**
 * Pre-calienta emojis en background, secuencialmente.
 * Al ser background no bloquea $p.
 */
async function prewarmEmojis(guild, pokemons) {
  for (const pokemon of pokemons) {
    if (!localCache.has(pokemon.id)) {
      await getOrCreateEmoji(guild, pokemon).catch(() => {});
    }
  }
}

module.exports = { prepareRollEmojis, prewarmEmojis };