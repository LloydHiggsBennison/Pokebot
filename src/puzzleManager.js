const { t } = require('./i18n');
const { prepareRollEmojis, getEmojiStatus } = require('./emojiManager');
const { takeFromPool } = require('./pokemonPool');
const { getGuildSettings, getLastRoll, setLastRoll, addCaptures, hasCapture } = require('./database');
const { getNewBadgeEmoji } = require('./badgeManager');

const NUM_ROWS = 5;
const BELL  = '🔔';
const CROSS = '❌';

const OUTCOME_TABLE = [
  { count: 0, weight: 0.10 },
  { count: 1, weight: 0.65 },
  { count: 2, weight: 0.20 },
  { count: 3, weight: 0.05 },
];

function pickWinnerCount() {
  const rand = Math.random();
  let acc = 0;
  for (const { count, weight } of OUTCOME_TABLE) {
    acc += weight;
    if (rand < acc) return count;
  }
  return OUTCOME_TABLE[OUTCOME_TABLE.length - 1].count;
}

function pickRandomIndices(max, count) {
  const indices = Array.from({ length: max }, (_, i) => i);
  for (let i = indices.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }
  return indices.slice(0, count);
}

function formatCooldown(ms) {
  const totalSeconds = Math.ceil(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

function capitalize(str) {
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1);
}

const activeRolls = new Set();

async function rollPuzzle(message, settings) {
  const status = getEmojiStatus(message.guild.client);
  if (status.status !== 'ready') {
    const text = status.status === 'error'
      ? t('❌ No se pudo preparar el catálogo de Pokémon. El administrador debe revisar la consola y reiniciar el bot.', "❌ Could not prepare the Pokémon catalog. An administrator must check the logs and restart the bot.")
      : t(`⏳ Preparando los emojis de Pokémon (${status.loaded}/${status.total}). Vuelve a tirar cuando termine la preparación inicial.`, `⏳ Preparing Pokémon emojis (${status.loaded}/${status.total}). Roll again when setup finishes.`);
    await message.reply(text);
    return;
  }
  const key = `${message.guild.id}:${message.author.id}`;
  if (activeRolls.has(key)) {
    await message.reply(t('⏳ Tu tirada anterior todavía está en curso.', "⏳ Your previous roll is still running."));
    return;
  }
  activeRolls.add(key);
  const started = performance.now();
  try {
    await executeRoll(message, settings, started);
  } finally {
    activeRolls.delete(key);
  }
}

async function executeRoll(message, providedSettings, started) {
  const guildId = message.guild.id;
  const userId  = message.author.id;
  const username = message.author.username; // sin @ ni mención

  const settings = providedSettings || await getGuildSettings(guildId);
  const cooldownMs = (settings.puzzle_cooldown_seconds ?? 0) * 1000;
  const lastRoll = cooldownMs > 0 ? await getLastRoll(guildId, userId) : 0;
  const settingsDone = performance.now();
  const now = Date.now();

  if (cooldownMs > 0 && now - lastRoll < cooldownMs) {
    const remaining = formatCooldown(cooldownMs - (now - lastRoll));
    await message.reply(t(`⏳ Espera **${remaining}** para volver a tirar.`, `⏳ Wait **${remaining}** before rolling again.`));
    return;
  }

  // 1. Full catalog in memory; no sprite reads or network calls.
  const pool = takeFromPool(15);
  let poolIdx = 0;
  const next = () => { const p = pool[poolIdx % pool.length]; poolIdx++; return p; };

  const winnerCount      = pickWinnerCount();
  const winnerRowIndices = new Set(pickRandomIndices(NUM_ROWS, winnerCount));

  const rows    = [];
  const winners = [];

  for (let r = 0; r < NUM_ROWS; r++) {
    if (winnerRowIndices.has(r)) {
      const w = next();
      rows.push({ items: [w, w, w], isWinner: true });
      winners.push(w);
    } else {
      let p1 = next(), p2 = next(), p3 = next();
      if (p1.id === p2.id && p2.id === p3.id) { poolIdx++; p3 = next(); }
      rows.push({ items: [p1, p2, p3], isWinner: false });
    }
  }

  // 2. Emojis: obtener todos los únicos del grid + los ganadores
  const uniqueMap = new Map();
  for (const row of rows)
    for (const p of row.items)
      if (!uniqueMap.has(p.id)) uniqueMap.set(p.id, p);

  const uniqueList   = [...uniqueMap.values()];
  const emojiStrings = prepareRollEmojis(message.guild, uniqueList);

  // Mapa rápido id → emoji string
  const emojiMap = new Map();
  uniqueList.forEach((p, i) => emojiMap.set(p.id, emojiStrings[i]));

  // 3. Construir el grid como texto de emojis
  //    Al ser solo emojis por línea, Discord los muestra en tamaño jumbo
  const gridLines = rows.map(row => {
    const pokeEmojis = row.items.map(p => emojiMap.get(p.id)).join(' ');
    return `${pokeEmojis} ${row.isWinner ? BELL : CROSS}`;
  });
  const gridText = gridLines.join('\n');

  // 4. Verificar qué ganadores son NUEVOS (antes de guardar en BBDD)
  const badge = winners.length ? getNewBadgeEmoji(message.guild) : '';
  const isNewMap = new Map();
  await Promise.all(
    winners.map(async w => {
      const alreadyHas = await hasCapture(guildId, userId, w.name);
      isNewMap.set(w.id, !alreadyHas);
    })
  );

  // 5. Finish both writes before releasing the user lock, also on failure.
  const writes = await Promise.allSettled([
    setLastRoll(guildId, userId, now),
    addCaptures(guildId, userId, winners),
  ]);
  const failure = writes.find(result => result.status === 'rejected');
  if (failure) throw failure.reason;
  const databaseDone = performance.now();

  // 6. Texto del resultado con badge condicional
  let resultText;
  if (winners.length === 0) {
    resultText = t(`${username}: No has ganado ningún Pokémon.`, `${username}: You did not win any Pokémon.`);
  } else if (winners.length === 1) {
    const w = winners[0];
    const e = emojiMap.get(w.id) || '';
    const b = isNewMap.get(w.id) ? `${badge} ` : '';
    resultText = t(`${username}: ${b}${e} Has ganado un **${capitalize(w.name)}**`, `${username}: ${b}${e} You won a **${capitalize(w.name)}**`);
  } else {
    const names = winners.map(w => {
      const e = emojiMap.get(w.id) || '';
      const b = isNewMap.get(w.id) ? `${badge} ` : '';
      return `${b}${e} **${capitalize(w.name)}**`;
    }).join(', ');
    resultText = t(`${username}: Has ganado ${winners.length} Pokémon: ${names}`, `${username}: You won ${winners.length} Pokémon: ${names}`);
  }

  // 6. Primero el grid de emojis (reply), luego el resultado debajo (send)
  await message.reply(gridText);
  const gridSent = performance.now();
  await message.channel.send(resultText);
  console.log(JSON.stringify({ event: 'roll_timing', guildId, userId,
    settingsMs: Math.round(settingsDone - started),
    prepareAndSaveMs: Math.round(databaseDone - settingsDone),
    gridSendMs: Math.round(gridSent - databaseDone),
    totalMs: Math.round(performance.now() - started),
  }));
}

module.exports = { rollPuzzle };

