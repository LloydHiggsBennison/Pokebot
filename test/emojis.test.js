const test = require('node:test');
const assert = require('node:assert/strict');
const { loadModule, fakeClient, POKEMON_LIST, emoji } = require('./helpers');
const sharp = require('sharp');

test('startup is single-flight and warm restarts only fetch once', async () => {
  const { client, calls } = fakeClient();
  const manager = loadModule('src/emojiManager.js');
  await Promise.all(Array.from({ length: 50 }, () => manager.initializeEmojis(client)));
  await manager.initializeEmojis(client);
  assert.equal(calls.fetch, 1);
  assert.equal(calls.create, 0);
  const restarted = loadModule('src/emojiManager.js');
  await restarted.initializeEmojis(client);
  assert.equal(calls.fetch, 2);
  assert.equal(calls.create, 0);
  assert.equal(restarted.getEmojiStatus(client).status, 'ready');
});

test('only missing emoji is uploaded; badge and unrelated emojis are retained', async () => {
  const { client, calls, cache } = fakeClient();
  cache.delete('25');
  cache.set('custom', emoji('custom', 7777));
  const spriteBuffer = await sharp({ create: { width: 10, height: 10, channels: 4, background: '#ffcc00' } }).png().toBuffer();
  const requested = [];
  const manager = loadModule('src/emojiManager.js', { './pokemonService': {
    POKEMON_LIST, async fetchSinglePokemonWithSprite(id) { requested.push(id); return { spriteBuffer }; },
  } });
  await manager.initializeEmojis(client);
  assert.deepEqual(requested, [25]);
  assert.equal(calls.create, 1);
  assert.ok(cache.has('badge'));
  assert.ok(cache.has('custom'));
  assert.equal(manager.getEmojiStatus(client).status, 'ready');
});

test('capacity fails before uploading, no evictions, no partial ready state', async () => {
  const { client, calls, cache } = fakeClient();
  cache.delete('25');
  for (let i = cache.size; i < 2000; i++) cache.set(`other${i}`, emoji(`other${i}`, 5000 + i));
  const manager = loadModule('src/emojiManager.js');
  await assert.rejects(manager.initializeEmojis(client), /espacios/);
  assert.equal(calls.create, 0);
  assert.equal(cache.size, 2000);
  assert.equal(manager.getEmojiStatus(client).status, 'error');
  assert.throws(() => manager.prepareRollEmojis({ client }, [{ id: 1 }]), /no preparado/);
});

test('fetch failure can retry and application caches are isolated', async () => {
  const first = fakeClient(), second = fakeClient();
  const manager = loadModule('src/emojiManager.js');
  const fetch = first.client.application.emojis.fetch;
  first.client.application.emojis.fetch = async () => { throw new Error('offline'); };
  await assert.rejects(manager.initializeEmojis(first.client), /offline/);
  first.client.application.emojis.fetch = fetch;
  await manager.initializeEmojis(first.client);
  assert.equal(manager.getEmojiStatus(first.client).status, 'ready');
  assert.equal(manager.getEmojiStatus(second.client).status, 'starting');
});

test('REST-only setup uses actual discord.js application manager, no gateway login', async () => {
  const { Client, Routes } = require('discord.js');
  const { setupApplicationEmojis } = require('../scripts/setup-emojis');
  const client = new Client({ intents: [] });
  const routes = [];
  const catalog = fakeClient().cache;
  client.rest.get = async route => {
    routes.push(route);
    if (route === Routes.currentApplication()) return { id: '100000000000000000', name: 'Pokebot', icon: null, description: '' };
    if (route === Routes.applicationEmojis('100000000000000000')) return { items: [...catalog.values()].map(e => ({ id: e.id, name: e.name, animated: false })) };
    throw new Error(`Unexpected API route ${route}`);
  };
  try {
    await setupApplicationEmojis(client);
    assert.equal(routes.length, 2);
  } finally { await client.destroy(); }
});
