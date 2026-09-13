const test = require('node:test');
const assert = require('node:assert/strict');
const sharp = require('sharp');
const { loadModule, fakeClient, fakeMessage, fakeDatabase, fixedRandom, POKEMON_LIST } = require('./helpers');

function rollModule(database, emojis, random = Math, baseline = false) {
  return loadModule(baseline ? 'test/fixtures/puzzle-before.js' : 'src/puzzleManager.js', {
    './database': database,
    './pokemonPool': { takeFromPool: () => POKEMON_LIST.slice(0, 15) },
    './emojiManager': emojis,
    './badgeManager': { getNewBadgeEmoji: guild => emojis.getPreparedEmoji(guild.client, 'pk_new') },
  }, { Math: random });
}

for (const [outcome, winnerCount] of [[0.05, 0], [0.5, 1], [0.85, 2], [0.98, 3]]) {
  for (const alreadyOwned of [false, true]) {
    test(`grid and result exactly match original: ${winnerCount} wins, owned=${alreadyOwned}`, async () => {
      const { client } = fakeClient();
      const emojis = loadModule('src/emojiManager.js');
      await emojis.initializeEmojis(client);
      const messages = [];
      for (const baseline of [true, false]) {
        const db = fakeDatabase();
        if (alreadyOwned) for (const p of POKEMON_LIST.slice(0, 15)) db.captures.push({ guildId: 'guild', userId: 'user', ...p });
        const message = fakeMessage(client);
        await rollModule(db, emojis, fixedRandom(outcome), baseline).rollPuzzle(message);
        assert.equal(db.captures.length, (alreadyOwned ? 15 : 0) + winnerCount);
        assert.equal(message.sent[0][1].split('\n').length, 5);
        assert.equal((message.sent[0][1].match(/<:pkv2_/g) || []).length, 15);
        assert.equal((message.sent[0][1].match(/🔔/g) || []).length, winnerCount);
        messages.push(message.sent);
      }
      assert.deepEqual(messages[1], messages[0]);
    });
  }
}

test('warm runtime never calls emoji REST or sprite loaders, across guilds', async () => {
  const { client, calls } = fakeClient();
  const emojis = loadModule('src/emojiManager.js', { './pokemonService': {
    POKEMON_LIST, fetchSinglePokemonWithSprite() { throw new Error('No sprite IO allowed'); },
  } });
  await emojis.initializeEmojis(client);
  const db = fakeDatabase();
  const { rollPuzzle } = rollModule(db, emojis);
  await Promise.all(Array.from({ length: 100 }, (_, i) => rollPuzzle(fakeMessage(client, `user${i}`, `guild${i % 3}`))));
  assert.equal(calls.fetch, 1);
  assert.equal(calls.create, 0);
});

test('initializing responds before any database calls; no captures or cooldown', async () => {
  const client = fakeClient().client;
  const db = fakeDatabase();
  db.getGuildSettings = () => { throw new Error('Do not wait for DB while warming'); };
  const message = fakeMessage(client);
  await rollModule(db, loadModule('src/emojiManager.js')).rollPuzzle(message);
  assert.match(message.sent[0][1], /Preparando/);
  assert.equal(db.captures.length, 0);
  assert.equal(db.rolls.size, 0);
});

test('cooldown and overlapping rolls prevent duplicate awards, lock releases', async () => {
  const { client } = fakeClient();
  const emojis = loadModule('src/emojiManager.js');
  await emojis.initializeEmojis(client);
  const db = fakeDatabase();
  db.settings.puzzle_cooldown_seconds = 60;
  const { rollPuzzle } = rollModule(db, emojis, fixedRandom(0.5));
  const first = fakeMessage(client), duplicate = fakeMessage(client);
  await Promise.all([rollPuzzle(first), rollPuzzle(duplicate)]);
  assert.match(duplicate.sent[0][1], /anterior/);
  assert.equal(db.captures.length, 1);
  const later = fakeMessage(client);
  await rollPuzzle(later);
  assert.match(later.sent[0][1], /Espera/);
  assert.equal(db.captures.length, 1);
});

test('failed save does not announce success; lock is released for next roll', async () => {
  const { client } = fakeClient();
  const emojis = loadModule('src/emojiManager.js');
  await emojis.initializeEmojis(client);
  const db = fakeDatabase();
  const save = db.addCaptures;
  let fail = true;
  db.addCaptures = async (...args) => { if (fail) throw new Error('database unavailable'); return save(...args); };
  const { rollPuzzle } = rollModule(db, emojis, fixedRandom(0.5));
  const message = fakeMessage(client);
  await assert.rejects(rollPuzzle(message), /database unavailable/);
  assert.equal(message.sent.length, 0);
  fail = false;
  await rollPuzzle(message);
  assert.equal(message.sent.length, 2);
});

test('pool stays unique across reshuffles and covers all 1025 without sprite IO', () => {
  const pool = loadModule('src/pokemonPool.js', { './pokemonService': { POKEMON_LIST } });
  assert.equal(pool.poolSize(), 1025);
  assert.equal(new Set(pool.takeFromPool(1025).map(p => p.id)).size, 1025);
  for (let i = 0; i < 200; i++) assert.equal(new Set(pool.takeFromPool(15).map(p => p.id)).size, 15);
  for (const count of [0, -1, 1026, 1.5]) assert.throws(() => pool.takeFromPool(count), /inválida/);
});

test('image bytes equal original sharp processing', async () => {
  const sprite = await sharp({ create: { width: 96, height: 96, channels: 4, background: '#00000000' } })
    .composite([{ input: await sharp({ create: { width: 40, height: 70, channels: 4, background: '#e44c24' } }).png().toBuffer(), left: 18, top: 8 }])
    .png().toBuffer();
  let originalBytes;
  const { Collection } = require('discord.js');
  const guild = { emojis: { cache: new Collection(), async create({ attachment }) {
    originalBytes = attachment;
    return { toString: () => '<:pkv2_1:1>' };
  } } };
  const before = loadModule('test/fixtures/emoji-before.js', {}, { setTimeout: fn => { fn(); } });
  await before.prepareRollEmojis(guild, [{ id: 1, spriteBuffer: sprite }]);
  const after = loadModule('src/emojiManager.js');
  assert.deepEqual(await after.processPokemonSprite(sprite), originalBytes);
});
