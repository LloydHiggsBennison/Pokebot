const { prepareRollEmojis } = require('./emojiManager');
const { takeFromPool } = require('./pokemonPool');
const { getGuildSettings, getLastRoll, setLastRoll, addCapture } = require('./database');

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

async function rollPuzzle(message) {
  const guildId = message.guild.id;
  const userId  = message.author.id;
  const username = message.author.username; // sin @ ni mención

  const [settings, lastRoll] = await Promise.all([
    getGuildSettings(guildId),
    getLastRoll(guildId, userId),
  ]);

  const cooldownMs = (settings.puzzle_cooldown_seconds ?? 0) * 1000;
  const now = Date.now();

  if (cooldownMs > 0 && now - lastRoll < cooldownMs) {
    const remaining = formatCooldown(cooldownMs - (now - lastRoll));
    await message.reply(`⏳ Espera **${remaining}** para volver a tirar.`);
    return;
  }

  // 1. Pokémon del pool pre-cargado (0ms si el pool tiene stock)
  const pool = await takeFromPool(15);
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
  const emojiStrings = await prepareRollEmojis(message.guild, uniqueList);

  // Mapa rápido id → emoji string
  const emojiMap = new Map();
  uniqueList.forEach((p, i) => emojiMap.set(p.id, emojiStrings[i] || '❓'));

  // 3. Construir el grid como texto de emojis
  //    Al ser solo emojis por línea, Discord los muestra en tamaño jumbo
  const gridLines = rows.map(row => {
    const pokeEmojis = row.items.map(p => emojiMap.get(p.id)).join(' ');
    return `${pokeEmojis} ${row.isWinner ? BELL : CROSS}`;
  });
  const gridText = gridLines.join('\n');

  // 4. Texto del resultado — username sin @mención, emoji del ganador inline
  let resultText;
  if (winners.length === 0) {
    resultText = `${username}: No has ganado ningún Pokémon.`;
  } else if (winners.length === 1) {
    const e = emojiMap.get(winners[0].id) || '';
    resultText = `${username}: ${e} Has ganado un **${capitalize(winners[0].name)}**`;
  } else {
    const names = winners.map(w => `${emojiMap.get(w.id) || ''} **${capitalize(w.name)}**`).join(', ');
    resultText = `${username}: Has ganado ${winners.length} Pokémon: ${names}`;
  }

  // 5. Guardar en BBDD + enviar mensajes (todo en paralelo)
  await Promise.all([
    setLastRoll(guildId, userId, now),
    ...winners.map(w => addCapture(guildId, userId, w.name, w.id)),
  ]);

  // 6. Primero el grid de emojis (reply), luego el resultado debajo (send)
  await message.reply(gridText);
  await message.channel.send(resultText);
}

module.exports = { rollPuzzle };