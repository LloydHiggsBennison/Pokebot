const sharp = require('sharp');
const { readFile } = require('node:fs/promises');
const path = require('node:path');
const { POKEMON_LIST, fetchSinglePokemonWithSprite } = require('./pokemonService');

const EMOJI_PREFIX = 'pkv2_';
const BADGE_NAME = 'pk_new';
const MAX_APPLICATION_EMOJIS = 2000;
// Each application has its own catalog. No guild emoji is created or deleted.
const catalogs = new WeakMap();

function catalogFor(client) {
  if (!catalogs.has(client)) {
    catalogs.set(client, { status: 'starting', emojis: new Map(), promise: null });
  }
  return catalogs.get(client);
}

function getEmojiStatus(client) {
  const catalog = catalogFor(client);
  return { status: catalog.status, loaded: catalog.emojis.size, total: POKEMON_LIST.length + 1 };
}

// Keep the exact pkv2 image transformation: trim, transparent 128x128, PNG.
function processPokemonSprite(buffer) {
  return sharp(buffer)
    .trim()
    .resize(128, 128, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
}

function initializeEmojis(client) {
  const catalog = catalogFor(client);
  if (catalog.status === 'ready') return Promise.resolve();
  if (catalog.promise) return catalog.promise;
  catalog.status = 'loading';
  catalog.promise = (async () => {
    const manager = client.application?.emojis;
    if (!manager) throw new Error('La aplicación de Discord aún no está disponible.');
    const existing = await manager.fetch();
    const byName = new Map([...existing.values()].map(emoji => [emoji.name, emoji.toString()]));
    const names = [...POKEMON_LIST.map(p => `${EMOJI_PREFIX}${p.id}`), BADGE_NAME];
    catalog.emojis.clear();
    for (const name of names) {
      if (byName.has(name)) catalog.emojis.set(name, byName.get(name));
    }
    const missing = names.length - catalog.emojis.size;
    if (existing.size + missing > MAX_APPLICATION_EMOJIS) {
      throw new Error(`Se necesitan ${missing} espacios para emojis de aplicación; solo hay ${MAX_APPLICATION_EMOJIS - existing.size}.`);
    }
    console.log(`[Emojis] ${catalog.emojis.size}/${names.length} existentes; ${missing} por preparar.`);
    // Only startup/setup uploads. Sequential, single-flight, resumable on restart.
    // Discord.js respects Retry-After; no arbitrary sleeps or guild rate-limit queue.
    for (const pokemon of POKEMON_LIST) {
      const name = `${EMOJI_PREFIX}${pokemon.id}`;
      if (catalog.emojis.has(name)) continue;
      const full = await fetchSinglePokemonWithSprite(pokemon.id);
      if (!full) throw new Error(`No se pudo cargar el sprite ${pokemon.id}.`);
      const attachment = await processPokemonSprite(full.spriteBuffer);
      const created = await manager.create({ attachment, name });
      catalog.emojis.set(name, created.toString());
      if (catalog.emojis.size % 50 === 0) console.log(`[Emojis] ${catalog.emojis.size}/${names.length} preparados.`);
    }
    if (!catalog.emojis.has(BADGE_NAME)) {
      const attachment = await readFile(path.join(__dirname, '..', 'assets', 'new_badge.webp'));
      const created = await manager.create({ attachment, name: BADGE_NAME });
      catalog.emojis.set(BADGE_NAME, created.toString());
    }
    catalog.status = 'ready';
    console.log(`[Emojis] Listos: ${names.length}. Las tiradas no suben ni borran emojis.`);
  })().catch(error => {
    catalog.status = 'error';
    throw error;
  }).finally(() => { catalog.promise = null; });
  return catalog.promise;
}

function getPreparedEmoji(client, name) {
  const catalog = catalogFor(client);
  const emoji = catalog.emojis.get(name);
  if (catalog.status !== 'ready' || !emoji) throw new Error(`Emoji no preparado: ${name}`);
  return emoji;
}

function prepareRollEmojis(guild, items) {
  return items.map(item => getPreparedEmoji(guild.client, `${EMOJI_PREFIX}${item.id}`));
}

module.exports = { initializeEmojis, prepareRollEmojis, getPreparedEmoji, getEmojiStatus, processPokemonSprite };
