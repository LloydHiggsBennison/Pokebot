// Repeatable local benchmark. Discord and database are immediate mocks.
// Original 600ms sleeps and sharp processing are real; no live API rate limits.
const sharp = require('sharp');
const { Collection } = require('discord.js');
const { performance } = require('node:perf_hooks');
const { loadModule, fakeClient, fakeMessage, fakeDatabase, POKEMON_LIST, emoji } = require('./helpers');

async function main() {
  const spriteBuffer = await sharp({ create: { width: 96, height: 96, channels: 4, background: '#ffaa00' } }).png().toBuffer();
  const items = POKEMON_LIST.slice(0, 15).map(p => ({ ...p, spriteBuffer }));
  const before = loadModule('test/fixtures/emoji-before.js');
  let created = 0;
  const guild = { emojis: { cache: new Collection(), async create({ name }) {
    const value = emoji(name, ++created);
    guild.emojis.cache.set(value.id, value);
    return value;
  } } };
  const coldStarted = performance.now();
  await before.prepareRollEmojis(guild, items);
  const originalColdMs = performance.now() - coldStarted;
  const warmStarted = performance.now();
  await before.prepareRollEmojis(guild, items);
  const originalWarmMs = performance.now() - warmStarted;
  const { client, calls } = fakeClient();
  const manager = loadModule('src/emojiManager.js');
  await manager.initializeEmojis(client);
  const preparedStarted = performance.now();
  manager.prepareRollEmojis({ client }, items);
  const preparedLookupMs = performance.now() - preparedStarted;
  const db = fakeDatabase();
  const roll = loadModule('src/puzzleManager.js', {
    './database': db, './emojiManager': manager,
    './badgeManager': { getNewBadgeEmoji: () => manager.getPreparedEmoji(client, 'pk_new') },
  });
  const timings = [];
  for (let i = 0; i < 1000; i++) {
    const started = performance.now();
    await roll.rollPuzzle(fakeMessage(client, `benchmark${i}`));
    timings.push(performance.now() - started);
  }
  timings.sort((a, b) => a - b);
  const round = value => Number(value.toFixed(3));
  console.log(JSON.stringify({
    environment: { node: process.version, platform: process.platform, arch: process.arch },
    note: 'LOCAL ONLY: instant mocked Discord/DB. Original sleeps and sharp are real. Not Discord end-to-end latency.',
    originalCold15EmojisMs: round(originalColdMs),
    originalWarm15EmojisMs: round(originalWarmMs),
    prepared15EmojisMs: round(preparedLookupMs),
    originalCreates: created,
    newRuntimeCreates: calls.create,
    rolls: timings.length,
    rollP50Ms: round(timings[500]), rollP95Ms: round(timings[950]), rollMaxMs: round(timings[999]),
  }, null, 2));
}

main().catch(error => { console.error(error); process.exitCode = 1; });
