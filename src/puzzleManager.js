const { AttachmentBuilder } = require('discord.js');
const { takeFromPool } = require('./pokemonPool');
const { buildPuzzleImage } = require('./imageGrid');
const { getGuildSettings, getLastRoll, setLastRoll, addCapture } = require('./database');

const NUM_ROWS = 5;

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
  const userId = message.author.id;

  // Estas dos consultas no dependen entre sí -> en paralelo, no en serie
  const [settings, lastRoll] = await Promise.all([
    getGuildSettings(guildId),
    getLastRoll(guildId, userId),
  ]);

  const cooldownMs = (settings.puzzle_cooldown_seconds ?? 0) * 1000;
  const now = Date.now();

  if (cooldownMs > 0 && now - lastRoll < cooldownMs) {
    const remaining = formatCooldown(cooldownMs - (now - lastRoll));
    await message.reply(`⏳ Todavía no puedes tirar. Espera **${remaining}**.`);
    return;
  }

  // 1. Tomar 15 Pokémon del pool pre-cargado en memoria (ya con sprite descargado)
  const pool = await takeFromPool(15);
  let poolIdx = 0;
  const next = () => { const p = pool[poolIdx % pool.length]; poolIdx++; return p; };

  const winnerCount = pickWinnerCount();
  const winnerRowIndices = new Set(pickRandomIndices(NUM_ROWS, winnerCount));

  const rows = [];
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

  // 2. Generar la imagen del puzzle localmente (sin llamar a la API de Discord)
  const imageBuffer = await buildPuzzleImage(rows);
  const attachment = new AttachmentBuilder(imageBuffer, { name: 'puzzle.png' });

  // 3. Construir el texto del resultado
  let resultText;
  if (winners.length === 0) {
    resultText = `${message.author}: No has ganado ningún Pokémon esta vez.`;
  } else if (winners.length === 1) {
    resultText = `${message.author}: 🆕 Has ganado un **${capitalize(winners[0].name)}**`;
  } else {
    const names = winners.map((w) => `**${capitalize(w.name)}**`).join(', ');
    resultText = `${message.author}: 🍀 ¡Golpe de suerte! Ganaste ${winners.length}: ${names}`;
  }

  // 4. Enviar el mensaje y guardar en base de datos AL MISMO TIEMPO
  //    (el usuario no espera a que Supabase confirme el guardado)
  await Promise.all([
    message.reply({ content: resultText, files: [attachment] }),
    setLastRoll(guildId, userId, now),
    ...winners.map((w) => addCapture(guildId, userId, w.name, w.id)),
  ]);
}

module.exports = { rollPuzzle };