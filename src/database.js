const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const { fetchWithTimeout } = require('./network');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY || process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

let useSupabase = false;
let supabase = null;
let db = null;

if (supabaseUrl && supabaseKey) {
  useSupabase = true;
  supabase = createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    db: { retry: false },
    global: { fetch: (url, options) => fetchWithTimeout(url, options, 5000) },
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
      pokemon_name TEXT, pokemon_id INTEGER, caught_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS user_rolls (
      guild_id TEXT, user_id TEXT, last_roll INTEGER,
      PRIMARY KEY (guild_id, user_id)
    );
    CREATE INDEX IF NOT EXISTS captures_owner_pokemon_idx ON captures (guild_id, user_id, pokemon_name);
    `);
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
const SETTINGS_CACHE_LIMIT = 10000;

function cacheSettings(guildId, value) {
  if (settingsCache.size >= SETTINGS_CACHE_LIMIT) settingsCache.delete(settingsCache.keys().next().value);
  settingsCache.set(guildId, { value: Object.freeze({ ...value }), expires: Date.now() + SETTINGS_TTL_MS });
}

async function getGuildSettings(guildId) {
  const cached = settingsCache.get(guildId);
  if (cached && cached.expires > Date.now()) return cached.value;
  if (pendingSettings.has(guildId)) return pendingSettings.get(guildId);
  const pending = loadGuildSettings(guildId).then(value => {
    cacheSettings(guildId, value);
    return settingsCache.get(guildId).value;
  }).finally(() => pendingSettings.delete(guildId));
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
        caught_at: caughtAt,
      })));
    if (error) throw error;
  } else {
    const insert = db.prepare(
      'INSERT INTO captures (guild_id, user_id, pokemon_name, pokemon_id, caught_at) VALUES (?, ?, ?, ?, ?)'
    );
    db.transaction(() => {
      for (const pokemon of pokemons) insert.run(guildId, userId, pokemon.name, pokemon.id, caughtAt);
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
  getGuildSettings,
  updateGuildSettings,
  addCapture,
  addCaptures,
  getUserCaptures,
  hasCapture,
  getLastRoll,
  setLastRoll,
};
