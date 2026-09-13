const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { once } = require('node:events');
const { fetchWithTimeout } = require('../src/network');
const { loadModule, fakeMessage, fakeClient } = require('./helpers');

test('real HTTP timeout aborts a stalled body, and preserves caller cancellation', async () => {
  const server = http.createServer((req, res) => { res.writeHead(200); res.write('partial body'); });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const url = `http://127.0.0.1:${server.address().port}`;
    const started = performance.now();
    await assert.rejects(async () => {
      const res = await fetchWithTimeout(url, {}, 100);
      await res.text();
    }, error => ['TimeoutError', 'AbortError'].includes(error.name));
    assert.ok(performance.now() - started < 1500);
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(fetchWithTimeout(url, { signal: controller.signal }, 10000), { name: 'AbortError' });
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});

test('$p routes directly; aliases reuse settings; ordinary messages perform only one settings lookup', async () => {
  let reads = 0, rolls = 0, spawns = 0;
  const settings = { catch_command: '!poke' };
  const event = loadModule('src/events/messageCreate.js', {
    '../database': { async getGuildSettings() { reads++; return settings; } },
    '../spawnManager': { async handleMessage(client, message, provided) { assert.equal(provided, settings); spawns++; } },
    '../puzzleManager': { async rollPuzzle(message, provided) { rolls++; assert.equal(provided, message.content === '$p' ? null : settings); } },
  });
  const client = fakeClient().client;
  const message = fakeMessage(client);
  await event.execute(message, client);
  assert.equal(reads, 0);
  message.content = '!poke';
  await event.execute(message, client);
  assert.equal(reads, 1);
  message.content = 'hola';
  await event.execute(message, client);
  assert.equal(reads, 2);
  assert.equal(rolls, 2);
  assert.equal(spawns, 1);
});

test('wild spawn returns the sprite URL used by EmbedBuilder and catch flow', () => {
  const pokemon = require('../src/pokemonService').getRandomPokemon();
  assert.equal(pokemon.image, pokemon.spriteUrl);
  assert.match(pokemon.image, /^https:\/\//);
});

test('health distinguishes a live process from a connected bot with a complete catalog', async () => {
  const { once } = require('node:events');
  let state = { connected: false, emojis: { status: 'loading', loaded: 0, total: 1026 } };
  const health = loadModule('src/healthServer.js', {}, { process: { env: { PORT: '0' }, uptime: () => 1 } });
  const server = health.startHealthServer(() => state);
  await once(server, 'listening');
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    assert.equal((await fetch(base)).status, 200);
    assert.equal((await fetch(`${base}/ready`)).status, 503);
    state = { connected: true, emojis: { status: 'ready', loaded: 1026, total: 1026 } };
    assert.equal((await fetch(`${base}/ready`)).status, 200);
    assert.equal((await fetch(`${base}/missing`)).status, 404);
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});
