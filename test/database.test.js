const test = require('node:test');
const assert = require('node:assert/strict');
const { createClient } = require('@supabase/supabase-js');
const { loadModule } = require('./helpers');

function supabaseFixture() {
  const requests = [];
  const settings = new Map();
  const captures = [];
  const rolls = new Map();
  let fail = false;
  let now = Date.now();
  let holdRead = null;
  const fetchWithTimeout = async (url, options, timeout) => {
    assert.equal(timeout, 15000);
    const parsed = new URL(url);
    const table = parsed.pathname.split('/').pop();
    const method = options.method || 'GET';
    const g = parsed.searchParams.get('guild_id')?.replace('eq.', '');
    const u = parsed.searchParams.get('user_id')?.replace('eq.', '');
    const name = parsed.searchParams.get('pokemon_name')?.replace('eq.', '');
    const body = options.body ? JSON.parse(options.body) : null;
    requests.push({ table, method, body });
    if (holdRead && table === 'guild_settings' && method === 'GET') {
      const snapshot = settings.has(g) ? [{ ...settings.get(g) }] : [];
      const wait = holdRead;
      holdRead = null;
      await wait;
      return new Response(JSON.stringify(snapshot), { status: 200 });
    }
    if (fail) return new Response(JSON.stringify({ code: 'XX000', message: 'test database failure', details: '', hint: '' }), { status: 503 });
    let data = null;
    if (table === 'fuse_pokemon') data = [];
    if (table === 'guild_settings') {
      if (method === 'GET') data = settings.has(g) ? [settings.get(g)] : [];
      if (method === 'POST') { if (!settings.has(body.guild_id)) settings.set(body.guild_id, body); data = [settings.get(body.guild_id)]; }
      if (method === 'PATCH') { Object.assign(settings.get(g), body); }
    }
    if (table === 'captures') {
      if (method === 'POST') for (const item of body) captures.push({ ...item, id: captures.length + 1 });
      if (method === 'GET') {
        data = captures.filter(p => p.guild_id === g && p.user_id === u && (!name || name === p.pokemon_name));
        for (const filter of parsed.searchParams.getAll('id')) {
          const [op, id] = filter.split('.');
          data = data.filter(p => op === 'gt' ? p.id > Number(id) : p.id <= Number(id));
        }
        if (parsed.searchParams.get('order')?.startsWith('id.')) {
          data.sort((a,b) => parsed.searchParams.get('order').includes('desc') ? b.id-a.id : a.id-b.id);
        }
        // Simulate a server cap lower than the requested page size.
        if (parsed.searchParams.has('limit')) data = data.slice(0, Math.min(100, Number(parsed.searchParams.get('limit'))));
      }
    }
    if (table === 'user_rolls') {
      if (method === 'POST') rolls.set(`${body.guild_id}:${body.user_id}`, body);
      if (method === 'GET') data = rolls.has(`${g}:${u}`) ? [rolls.get(`${g}:${u}`)] : [];
    }
    return new Response(data === null ? null : JSON.stringify(data), { status: data === null ? 204 : 200, headers: { 'Content-Type': 'application/json' } });
  };
  let clientOptions;
  const db = loadModule('src/database.js', {
    '@supabase/supabase-js': { createClient(url, key, options) { clientOptions = options; return createClient(url, key, options); } },
    './network': { fetchWithTimeout },
  }, { process: { env: { SUPABASE_URL: 'https://database.test', SUPABASE_KEY: 'test-key' } }, Date: { now: () => now } });
  assert.equal(clientOptions.db.retry, false);
  return { db, requests, captures, settings, fail(value) { fail = value; },
    advance(ms) { now += ms; }, hold(promise) { holdRead = promise; } };
}

test('real Supabase SDK: settings reads coalesce, stay cached and invalidate on config change', async () => {
  const { db, requests } = supabaseFixture();
  const rows = await Promise.all(Array.from({ length: 100 }, () => db.getGuildSettings('g')));
  assert.equal(requests.length, 2); // one lookup and one insert for the whole burst
  assert.ok(rows.every(row => row.catch_command === '$p'));
  await db.getGuildSettings('g');
  assert.equal(requests.length, 2);
  await db.updateGuildSettings('g', { catch_command: '!p' });
  assert.equal((await db.getGuildSettings('g')).catch_command, '!p');
  assert.equal(requests.length, 4); // update and refreshed read
  assert.equal((await db.getGuildSettings('other')).catch_command, '$p');
});

test('empty Supabase fusion result means insufficient copies, never success', async () => {
  const { db, requests } = supabaseFixture();
  assert.equal(await db.fusePokemon('g', 'u', 25, 'pikachu'), null);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].table, 'fuse_pokemon');
  assert.equal(requests[0].body.p_user_id, 'u');
});

test('real Supabase SDK: captures use one bulk insert, ownership filters and cooldown persist', async () => {
  const { db, requests } = supabaseFixture();
  await db.addCaptures('g', 'u', [{ id: 1, name: 'bulbasaur' }, { id: 25, name: 'pikachu' }]);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].body.length, 2);
  assert.equal(await db.hasCapture('g', 'u', 'pikachu'), true);
  assert.equal(await db.hasCapture('other', 'u', 'pikachu'), false);
  assert.equal(await db.hasCapture('g', 'other', 'pikachu'), false);
  assert.equal((await db.getUserCaptures('g', 'u')).length, 2);
  await db.setLastRoll('g', 'u', 12345);
  assert.equal(await db.getLastRoll('g', 'u'), 12345);
  assert.equal(await db.getLastRoll('g', 'other'), 0);
  const before = requests.length;
  await db.addCaptures('g', 'u', []);
  assert.equal(requests.length, before);
});

test('real Supabase SDK: failed reads/writes reject without retries or cached defaults', async () => {
  const fixture = supabaseFixture();
  fixture.fail(true);
  const db = fixture.db;
  const operations = [
    () => db.getGuildSettings('g'), () => db.getLastRoll('g', 'u'),
    () => db.hasCapture('g', 'u', 'pikachu'),
    () => db.addCaptures('g', 'u', [{ id: 25, name: 'pikachu' }]),
    () => db.setLastRoll('g', 'u', 123),
  ];
  for (const operation of operations) await assert.rejects(operation(), error => error.message === 'test database failure');
  assert.equal(fixture.requests.length, operations.length);
  fixture.fail(false);
  assert.equal((await db.getGuildSettings('g')).catch_command, '$p');
  fixture.fail(true);
  await assert.rejects(db.updateGuildSettings('g', { catch_command: '!p' }), error => error.message === 'test database failure');
  fixture.fail(false);
  assert.equal((await db.getGuildSettings('g')).catch_command, '$p');
});

test('SQLite queries execute on a real in-memory SQLite engine (node:sqlite adapter)', async () => {
  const { DatabaseSync } = require('node:sqlite');
  let connection;
  class SQLiteAdapter {
    constructor() { connection = new DatabaseSync(':memory:'); }
    pragma(value) { connection.exec(`PRAGMA ${value}`); }
    exec(sql) { return connection.exec(sql); }
    prepare(sql) { return connection.prepare(sql); }
    transaction(fn) { return () => {
      connection.exec('BEGIN');
      try { const result = fn(); connection.exec('COMMIT'); return result; }
      catch (error) { connection.exec('ROLLBACK'); throw error; }
    }; }
  }
  const db = loadModule('src/database.js', { 'better-sqlite3': SQLiteAdapter }, { process: { env: {} } });
  try {
    assert.equal((await db.getGuildSettings('g')).catch_command, '$p');
    await db.updateGuildSettings('g', { puzzle_cooldown_seconds: 60 });
    assert.equal((await db.getGuildSettings('g')).puzzle_cooldown_seconds, 60);
    await db.addCaptures('g', 'u', [{ id: 25, name: 'pikachu' }, { id: 1, name: 'bulbasaur' }]);
    await db.addCaptures('g', 'u', Array.from({ length: 5 }, () => ({ id: 7, name: 'squirtle' })));
    const fusion = await db.fusePokemon('g', 'u', 7, 'squirtle');
    assert.equal(fusion.pokemon_id, 7);
    assert.equal(fusion.pokemon_name, 'squirtle');
    assert.equal(fusion.consumed, 4);
    const fused = await db.getPokedexEntries('g', 'u');
    assert.equal(fused.find(entry => entry.id === 7 && !entry.isShiny).count, 1);
    assert.equal(fused.find(entry => entry.id === 7 && entry.isShiny).count, 1);
    assert.equal(await db.fusePokemon('g', 'u', 7, 'squirtle'), null);
    assert.equal(await db.hasCapture('g', 'u', 'pikachu'), true);
    assert.equal(await db.hasCapture('g', 'other', 'pikachu'), false);
    assert.equal((await db.getUserCaptures('g', 'u')).length, 4);
    await db.setLastRoll('g', 'u', 100);
    await db.setLastRoll('g', 'u', 200);
    assert.equal(await db.getLastRoll('g', 'u'), 200);
    const plan = connection.prepare('EXPLAIN QUERY PLAN SELECT id FROM captures WHERE guild_id = ? AND user_id = ? AND pokemon_name = ? LIMIT 1').all('g', 'u', 'pikachu');
    assert.match(plan[0].detail, /captures_owner_pokemon_idx/);
  } finally { connection.close(); }
});

test('stale settings return immediately while one background read is pending', async () => {
  const fixture = supabaseFixture();
  await fixture.db.getGuildSettings('g');
  fixture.advance(31000);
  let release;
  fixture.hold(new Promise(resolve => { release = resolve; }));
  const rows = await Promise.all(Array.from({ length: 100 }, () => fixture.db.getGuildSettings('g')));
  assert.ok(rows.every(row => row.catch_command === '$p'));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(fixture.requests.length, 3);
  release();
  await new Promise(resolve => setImmediate(resolve));
  await fixture.db.getGuildSettings('g');
  assert.equal(fixture.requests.length, 3);
});

test('failed background reads back off and settings older than five minutes fail closed', async () => {
  const fixture = supabaseFixture();
  await fixture.db.getGuildSettings('g');
  fixture.advance(31000);
  fixture.fail(true);
  assert.equal((await fixture.db.getGuildSettings('g')).catch_command, '$p');
  await new Promise(resolve => setImmediate(resolve));
  for (let i = 0; i < 100; i++) await fixture.db.getGuildSettings('g');
  assert.equal(fixture.requests.length, 3);
  fixture.advance(10001);
  await fixture.db.getGuildSettings('g');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(fixture.requests.length, 4);
  fixture.advance(300000);
  await assert.rejects(fixture.db.getGuildSettings('g'), error => error.message === 'test database failure');
});

test('a late background response cannot overwrite an explicit config update', async () => {
  const fixture = supabaseFixture();
  await fixture.db.getGuildSettings('g');
  fixture.advance(31000);
  let release;
  fixture.hold(new Promise(resolve => { release = resolve; }));
  await fixture.db.getGuildSettings('g');
  await new Promise(resolve => setImmediate(resolve));
  await fixture.db.updateGuildSettings('g', { catch_command: '!new' });
  assert.equal((await fixture.db.getGuildSettings('g')).catch_command, '!new');
  release();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal((await fixture.db.getGuildSettings('g')).catch_command, '!new');
});

test('pokedex reads every capture beyond 1000 and isolates guild and owner', async () => {
  const { db } = supabaseFixture();
  await db.addCaptures('g', 'owner', Array.from({ length: 1105 }, (_, i) => ({ id: i % 11 + 1, name: `pokemon${i % 11 + 1}` })));
  await db.addCaptures('g', 'other', [{ id: 999, name: 'foreign' }]);
  await db.addCaptures('other', 'owner', [{ id: 998, name: 'foreignguild' }]);
  const entries = await db.getPokedexEntries('g', 'owner');
  assert.equal(entries.length, 11);
  assert.equal(entries.reduce((total, p) => total + p.count, 0), 1105);
  assert.equal(entries[0].count, 101);
  assert.equal(entries.some(p => p.id >= 998), false);
  assert.equal((await db.getPokedexEntries('g', 'missing')).length, 0);
});
