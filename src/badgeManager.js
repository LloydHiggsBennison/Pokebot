const fs   = require('fs');
const path = require('path');

const BADGE_NAME = 'pk_new';
const BADGE_PATH = path.join(__dirname, '..', 'assets', 'new_badge.webp');

let cachedBadgeEmoji = null;

/**
 * Sube el badge "new" como emoji custom al servidor (si no existe ya)
 * y retorna su string "<:pk_new:id>" para usar en mensajes.
 */
async function getNewBadgeEmoji(guild) {
  if (cachedBadgeEmoji) return cachedBadgeEmoji;

  // Buscar en caché de Discord.js primero
  const existing = guild.emojis.cache.find(e => e.name === BADGE_NAME);
  if (existing) {
    cachedBadgeEmoji = existing.toString();
    return cachedBadgeEmoji;
  }

  // Subir el badge como emoji
  try {
    const attachment = fs.readFileSync(BADGE_PATH);
    const created = await guild.emojis.create({ attachment, name: BADGE_NAME });
    cachedBadgeEmoji = created.toString();
    console.log(`[Badge] Emoji "${BADGE_NAME}" subido al servidor.`);
  } catch (err) {
    console.warn(`[Badge] No se pudo subir el badge:`, err.message);
    cachedBadgeEmoji = '🆕'; // fallback Unicode
  }

  return cachedBadgeEmoji;
}

module.exports = { getNewBadgeEmoji };
