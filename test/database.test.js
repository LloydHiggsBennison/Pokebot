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
  const fetchWithTimeout = async (url, options, timeout) => {
    assert.equal(timeout, 5000);
    const parsed = new URL(url);
    const table = parsed.pathname.split('/').pop();
    const method = options.method || 'GET';
    const g = parsed.searchParams.get('guild_id')?.replace('eq.', '');
    const u = parsed.searchParams.get('user_id')?.replace('eq.', '');
    const name = parsed.searchParams.get('pokemon_name')?.replace('eq.', '');
    const body = options.body ? JSON.parse(options.body) : null;
    requests.push({ table, method, body });
    if (fail) return new Response(JSON.stringify({ code: 'XX000', message: 'test database failure', details: '', hint: '' }), { status: 503 });
    let data = null;
    if (table === 'guild_settings') {
      if (method === 'GET') data = settings.has(g) ? [settings.get(g)] : [];
      if (method === 'POST') { if (!settings.has(body.guild_id)) settings.set(body.guild_id, body); data = [settings.get(body.guild_id)]; }
      if (method === 'PATCH') { Object.assign(settings.get(g), body); }
    }
    if (table === 'captures') {
      if (method === 'POST') captures.push(...body);
      if (method === 'GET') data = captures.filter(p => p.guild_id === g && p.user_id === u && (!name || name === p.pokemon_name));
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
  }, { process: { env: { SUPABASE_URL: 'https://database.test', SUPABASE_KEY: 'test-key' } } });
  assert.equal(clientOptions.db.retry, false);
  return { db, requests, captures, settings, fail(value) { fail = value; } };
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
    assert.equal(await db.hasCapture('g', 'u', 'pikachu'), true);
    assert.equal(await db.hasCapture('g', 'other', 'pikachu'), false);
    assert.equal((await db.getUserCaptures('g', 'u')).length, 2);
    await db.setLastRoll('g', 'u', 100);
    await db.setLastRoll('g', 'u', 200);
    assert.equal(await db.getLastRoll('g', 'u'), 200);
    const plan = connection.prepare('EXPLAIN QUERY PLAN SELECT id FROM captures WHERE guild_id = ? AND user_id = ? AND pokemon_name = ? LIMIT 1').all('g', 'u', 'pikachu');
    assert.match(plan[0].detail, /captures_owner_pokemon_idx/);
  } finally { connection.close(); }
});
