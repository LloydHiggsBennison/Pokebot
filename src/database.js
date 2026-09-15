const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const { fetchWithTimeout } = require('./network');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY || process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const configuredTimeout = Number(process.env.SUPABASE_TIMEOUT_MS || 15000);
const supabaseTimeoutMs = Number.isFinite(configuredTimeout)
  ? Math.min(60000, Math.max(1000, configuredTimeout)) : 15000;

let useSupabase = false;
let supabase = null;
let db = null;

if (supabaseUrl && supabaseKey) {
  useSupabase = true;
  supabase = createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    db: { retry: false },
    global: { fetch: (url, options) => fetchWithTimeout(url, options, supabaseTimeoutMs) },
  });
  console.log('⚡ Base de datos conectada a Supabase (PostgreSQL)');
} else {
  // SQLite como fallback local (solo para desarrollo en PC)
  try {
    const Database = require('better-sqlite3');
    db = new Database(process.env.SQLITE_PATH || path.join(__dirname, '..', 'pokebot.sqlite'));
    db.pragma('journal_mode = WAL');
    db.exec(`
    CREATE TABLE IF NOT EXISTS guild_settings (
      guild_id TEXT PRIMARY KEY,
      spawn_channel_id TEXT,
      mode TEXT DEFAULT 'messages',
      msg_min INTEGER DEFAULT 15,
      msg_max INTEGER DEFAULT 40,
      time_interval_seconds INTEGER DEFAULT 1800,
      catch_command TEXT DEFAULT '$p',
      enabled INTEGER DEFAULT 1,
      puzzle_cooldown_seconds INTEGER DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS captures (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT, user_id TEXT,
      pokemon_name TEXT, pokemon_id INTEGER, is_shiny INTEGER DEFAULT 0, caught_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS user_rolls (
      guild_id TEXT, user_id TEXT, last_roll INTEGER,
      PRIMARY KEY (guild_id, user_id)
    );
    CREATE INDEX IF NOT EXISTS captures_owner_pokemon_idx ON captures (guild_id, user_id, pokemon_name);
    `);
    if (!db.prepare('PRAGMA table_info(captures)').all().some(column => column.name === 'is_shiny')) {
      db.exec('ALTER TABLE captures ADD COLUMN is_shiny INTEGER NOT NULL DEFAULT 0');
    }
    db.exec('CREATE INDEX IF NOT EXISTS captures_fusion_idx ON captures (guild_id, user_id, pokemon_id, is_shiny, id)');
    try { db.exec('ALTER TABLE guild_settings ADD COLUMN puzzle_cooldown_seconds INTEGER DEFAULT 0;'); } catch (_) {}
    console.log('📁 Base de datos conectada a SQLite local (pokebot.sqlite)');
  } catch (_) {
    console.error('❌ No hay Supabase configurado y better-sqlite3 no está disponible.');
    console.error('   Configura SUPABASE_URL y SUPABASE_KEY en las variables de entorno.');
    process.exit(1);
  }
}

// ----------------------------------------------------
// GUILD SETTINGS
// ----------------------------------------------------
const settingsCache = new Map();
const pendingSettings = new Map();
const SETTINGS_TTL_MS = 30000;
const SETTINGS_MAX_AGE_MS = 300000;
const SETTINGS_RETRY_MS = 10000;
const SETTINGS_CACHE_LIMIT = 10000;

function cacheSettings(guildId, value) {
  if (settingsCache.size >= SETTINGS_CACHE_LIMIT) settingsCache.delete(settingsCache.keys().next().value);
  settingsCache.set(guildId, { value: Object.freeze({ ...value }),
    expires: Date.now() + SETTINGS_TTL_MS, usableUntil: Date.now() + SETTINGS_MAX_AGE_MS,
    retryAt: 0 });
}

async function getGuildSettings(guildId) {
  const cached = settingsCache.get(guildId);
  if (cached && cached.expires > Date.now()) return cached.value;
  if (cached && cached.usableUntil > Date.now()) {
    // Keep the last known settings usable while a slow connection refreshes them.
    // Never invent defaults on a failed read, or keep stale settings indefinitely.
    if (!pendingSettings.has(guildId) && cached.retryAt <= Date.now()) {
      refreshGuildSettings(guildId).catch(error => {
        cached.retryAt = Date.now() + SETTINGS_RETRY_MS;
        console.warn('[Settings] No se pudo actualizar la configuración en segundo plano:', error.message);
      });
    }
    return cached.value;
  }
  return refreshGuildSettings(guildId);
}

function refreshGuildSettings(guildId) {
  if (pendingSettings.has(guildId)) return pendingSettings.get(guildId);
  const pending = loadGuildSettings(guildId).then(value => {
    // A config write can invalidate this request while it is in flight.
    if (pendingSettings.get(guildId) === pending) cacheSettings(guildId, value);
    return Object.freeze({ ...value });
  }).finally(() => {
    if (pendingSettings.get(guildId) === pending) pendingSettings.delete(guildId);
  });
  pendingSettings.set(guildId, pending);
  return pending;
}

async function loadGuildSettings(guildId) {
  if (useSupabase) {
    let { data, error } = await supabase
      .from('guild_settings')
      .select('*')
      .eq('guild_id', guildId)
      .maybeSingle();
    if (error) throw error;

    if (!data) {
      const defaultSettings = {
        guild_id: guildId,
        spawn_channel_id: null,
        mode: 'messages',
        msg_min: 15,
        msg_max: 40,
        time_interval_seconds: 1800,
        catch_command: '$p',
        enabled: 1,
        puzzle_cooldown_seconds: 0,
      };

      const { data: inserted, error: insertErr } = await supabase
        .from('guild_settings')
        .upsert(defaultSettings, { onConflict: 'guild_id', ignoreDuplicates: true })
        .select()
        .maybeSingle();

      if (insertErr) {
        throw insertErr;
      }
      // A second process may have created the settings between SELECT and INSERT.
      if (!inserted) {
        const { data: concurrent, error: readError } = await supabase.from('guild_settings')
          .select('*').eq('guild_id', guildId).single();
        if (readError) throw readError;
        return concurrent;
      }
      return inserted;
    }
    return data;
  } else {
    let row = db.prepare('SELECT * FROM guild_settings WHERE guild_id = ?').get(guildId);
    if (!row) {
      db.prepare('INSERT INTO guild_settings (guild_id) VALUES (?)').run(guildId);
      row = db.prepare('SELECT * FROM guild_settings WHERE guild_id = ?').get(guildId);
    }
    return row;
  }
}

async function updateGuildSettings(guildId, fields) {
  await getGuildSettings(guildId);
  try {
    if (useSupabase) {
      const { error } = await supabase
        .from('guild_settings')
        .update(fields)
        .eq('guild_id', guildId);
      if (error) throw error;
    } else {
      const keys = Object.keys(fields);
      if (keys.length === 0) return;
      const setClause = keys.map((k) => `${k} = @${k}`).join(', ');
      db.prepare(`UPDATE guild_settings SET ${setClause} WHERE guild_id = @guild_id`).run({
        ...fields,
        guild_id: guildId,
      });
    }
  } finally {
    settingsCache.delete(guildId);
    pendingSettings.delete(guildId);
  }
}

// ----------------------------------------------------
// CAPTURES
// ----------------------------------------------------
async function addCapture(guildId, userId, pokemonName, pokemonId) {
  return addCaptures(guildId, userId, [{ name: pokemonName, id: pokemonId }]);
}

async function addCaptures(guildId, userId, pokemons) {
  if (!pokemons.length) return;
  const caughtAt = Date.now();
  if (useSupabase) {
    const { error } = await supabase.from('captures').insert(pokemons.map(pokemon => ({
        guild_id: guildId,
        user_id: userId,
        pokemon_name: pokemon.name,
        pokemon_id: pokemon.id,
        is_shiny: pokemon.isShiny ? 1 : 0,
        caught_at: caughtAt,
      })));
    if (error) throw error;
  } else {
    const insert = db.prepare(
      'INSERT INTO captures (guild_id, user_id, pokemon_name, pokemon_id, is_shiny, caught_at) VALUES (?, ?, ?, ?, ?, ?)'
    );
    db.transaction(() => {
      for (const pokemon of pokemons) insert.run(guildId, userId, pokemon.name, pokemon.id, pokemon.isShiny ? 1 : 0, caughtAt);
    })();
  }
}

async function getUserCaptures(guildId, userId) {
  if (useSupabase) {
    const { data, error } = await supabase
      .from('captures')
      .select('*')
      .eq('guild_id', guildId)
      .eq('user_id', userId)
      .order('caught_at', { ascending: false });
    if (error) throw error;
    return data || [];
  } else {
    return db
      .prepare('SELECT * FROM captures WHERE guild_id = ? AND user_id = ? ORDER BY caught_at DESC')
      .all(guildId, userId);
  }
}

// ----------------------------------------------------
// USER ROLLS COOLDOWN
// ----------------------------------------------------
// Snapshot by capture ID: no Supabase row-limit truncation or endlessly growing scan.
async function getPokedexEntries(guildId, userId, { includeCopies = false } = {}) {
  if (!useSupabase && !includeCopies) {
    return db.prepare(`SELECT pokemon_id AS id, pokemon_name AS name, is_shiny AS isShiny, COUNT(*) AS count
      FROM captures WHERE guild_id = ? AND user_id = ?
      GROUP BY pokemon_id, pokemon_name, is_shiny ORDER BY MIN(id)`).all(guildId, userId);
  }
  if (!useSupabase) {
    const entries = new Map();
    for (const copy of db.prepare('SELECT * FROM captures WHERE guild_id = ? AND user_id = ? ORDER BY id').all(guildId,userId)) {
      const key = `${copy.pokemon_id}:${copy.is_shiny ? 1 : 0}`;
      if (!entries.has(key)) entries.set(key,{id:copy.pokemon_id,name:copy.pokemon_name,isShiny:!!copy.is_shiny,count:0,copies:[]});
      const entry=entries.get(key);entry.count++;entry.copies.push(copy);
    }
    return [...entries.values()];
  }
  const scoped = () => supabase.from('captures').select(includeCopies ? 'id,pokemon_id,pokemon_name,is_shiny,level,iv_total,experience' : 'id,pokemon_id,pokemon_name,is_shiny')
    .eq('guild_id', guildId).eq('user_id', userId);
  const { data: latest, error: latestError } = await scoped().order('id', { ascending: false }).limit(1);
  if (latestError) throw latestError;
  if (!latest?.length) return [];
  const upperId = latest[0].id;
  let cursor = 0;
  const entries = new Map();
  while (true) {
    const { data, error } = await scoped().gt('id', cursor).lte('id', upperId)
      .order('id', { ascending: true }).limit(500);
    if (error) throw error;
    if (!data?.length) break;
    for (const capture of data) {
      const key = `${capture.pokemon_id}:${capture.is_shiny ? 1 : 0}`;
      const existing = entries.get(key);
      if (existing) existing.count++;
      else entries.set(key, { id: capture.pokemon_id, name: capture.pokemon_name, isShiny: !!capture.is_shiny, count: 1 });
      if (includeCopies) {
        const entry=entries.get(key);entry.copies ||= [];entry.copies.push(capture);
      }
    }
    const next = data[data.length - 1].id;
    if (BigInt(next) <= BigInt(cursor)) throw new Error('La consulta de Pokédex no avanzó.');
    cursor = next;
    if (BigInt(cursor) >= BigInt(upperId)) break;
  }
  return [...entries.values()];
}

async function fusePokemon(guildId, userId, pokemonId, pokemonName) {
  if (!Number.isInteger(pokemonId) || !pokemonName) throw new TypeError('Pokémon inválido.');
  if (useSupabase) {
    const { data, error } = await supabase.rpc('fuse_pokemon', {
      p_guild_id: guildId, p_user_id: userId, p_pokemon_id: pokemonId, p_pokemon_name: pokemonName,
    });
    if (error) throw error;
    return Array.isArray(data) ? (data[0] || null) : (data || null);
  }
  const transaction = db.transaction(() => {
    const normal = db.prepare(`SELECT id FROM captures WHERE guild_id = ? AND user_id = ?
      AND pokemon_id = ? AND COALESCE(is_shiny, 0) = 0 ORDER BY id LIMIT 5`).all(guildId, userId, pokemonId);
    if (normal.length < 5) return null;
    db.prepare(`DELETE FROM captures WHERE id IN (${normal.slice(1).map(() => '?').join(',')})`).run(...normal.slice(1).map(row => row.id));
    db.prepare(`INSERT INTO captures (guild_id,user_id,pokemon_name,pokemon_id,is_shiny,caught_at)
      VALUES (?,?,?,?,1,?)`).run(guildId, userId, pokemonName, pokemonId, Date.now());
    return { pokemon_id: pokemonId, pokemon_name: pokemonName, consumed: 4 };
  });
  return transaction();
}

async function getFuseCandidates(guildId, userId) {
  const entries = await getPokedexEntries(guildId, userId);
  return entries.filter(entry => !entry.isShiny && entry.count >= 5);
}

async function getLastRoll(guildId, userId) {
  if (useSupabase) {
    const { data, error } = await supabase
      .from('user_rolls')
      .select('last_roll')
      .eq('guild_id', guildId)
      .eq('user_id', userId)
      .maybeSingle();
    if (error) throw error;
    return data ? Number(data.last_roll) : 0;
  } else {
    const row = db
      .prepare('SELECT last_roll FROM user_rolls WHERE guild_id = ? AND user_id = ?')
      .get(guildId, userId);
    return row ? Number(row.last_roll) : 0;
  }
}

async function setLastRoll(guildId, userId, timestamp) {
  if (useSupabase) {
    const { error } = await supabase
      .from('user_rolls')
      .upsert({ guild_id: guildId, user_id: userId, last_roll: timestamp });
    if (error) throw error;
  } else {
    db.prepare(`
      INSERT INTO user_rolls (guild_id, user_id, last_roll)
      VALUES (?, ?, ?)
      ON CONFLICT(guild_id, user_id) DO UPDATE SET last_roll = excluded.last_roll
    `).run(guildId, userId, timestamp);
  }
}

/** Devuelve true si el usuario ya tiene al menos 1 captura de ese pokémon (antes de este roll) */
async function hasCapture(guildId, userId, pokemonName) {
  if (useSupabase) {
    const { data, error } = await supabase
      .from('captures')
      .select('id')
      .eq('guild_id', guildId)
      .eq('user_id', userId)
      .eq('pokemon_name', pokemonName)
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return !!data;
  } else {
    const row = db
      .prepare('SELECT id FROM captures WHERE guild_id = ? AND user_id = ? AND pokemon_name = ? LIMIT 1')
      .get(guildId, userId, pokemonName);
    return !!row;
  }
}

module.exports = {
  storage: { supabase, sqlite: db },
  getGuildSettings,
  updateGuildSettings,
  addCapture,
  addCaptures,
  getUserCaptures,
  getPokedexEntries,
  fusePokemon,
  getFuseCandidates,
  hasCapture,
  getLastRoll,
  setLastRoll,
};
