const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY || process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

let useSupabase = false;
let supabase = null;
let db = null;

if (supabaseUrl && supabaseKey) {
  useSupabase = true;
  supabase = createClient(supabaseUrl, supabaseKey);
  console.log('⚡ Base de datos conectada a Supabase (PostgreSQL)');
} else {
  const Database = require('better-sqlite3');
  db = new Database(path.join(__dirname, '..', 'pokebot.sqlite'));
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
    guild_id TEXT,
    user_id TEXT,
    pokemon_name TEXT,
    pokemon_id INTEGER,
    caught_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS user_rolls (
    guild_id TEXT,
    user_id TEXT,
    last_roll INTEGER,
    PRIMARY KEY (guild_id, user_id)
  );
  `);

  try {
    db.exec('ALTER TABLE guild_settings ADD COLUMN puzzle_cooldown_seconds INTEGER DEFAULT 0;');
  } catch (e) {}

  console.log('📁 Base de datos conectada a SQLite local (pokebot.sqlite)');
}

// ----------------------------------------------------
// GUILD SETTINGS
// ----------------------------------------------------
async function getGuildSettings(guildId) {
  if (useSupabase) {
    let { data } = await supabase
      .from('guild_settings')
      .select('*')
      .eq('guild_id', guildId)
      .maybeSingle();

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
        .insert([defaultSettings])
        .select()
        .single();

      if (insertErr) {
        console.error('Error insertando guild_settings en Supabase:', insertErr.message);
        return defaultSettings;
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
  if (useSupabase) {
    await getGuildSettings(guildId);
    const { error } = await supabase
      .from('guild_settings')
      .update(fields)
      .eq('guild_id', guildId);
    if (error) console.error('Error al actualizar guild_settings en Supabase:', error.message);
  } else {
    getGuildSettings(guildId);
    const keys = Object.keys(fields);
    if (keys.length === 0) return;
    const setClause = keys.map((k) => `${k} = @${k}`).join(', ');
    db.prepare(`UPDATE guild_settings SET ${setClause} WHERE guild_id = @guild_id`).run({
      ...fields,
      guild_id: guildId,
    });
  }
}

// ----------------------------------------------------
// CAPTURES
// ----------------------------------------------------
async function addCapture(guildId, userId, pokemonName, pokemonId) {
  if (useSupabase) {
    const { error } = await supabase.from('captures').insert([
      {
        guild_id: guildId,
        user_id: userId,
        pokemon_name: pokemonName,
        pokemon_id: pokemonId,
        caught_at: Date.now(),
      },
    ]);
    if (error) console.error('Error al guardar captura en Supabase:', error.message);
  } else {
    db.prepare(
      'INSERT INTO captures (guild_id, user_id, pokemon_name, pokemon_id, caught_at) VALUES (?, ?, ?, ?, ?)'
    ).run(guildId, userId, pokemonName, pokemonId, Date.now());
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
    if (error) console.error('Error al obtener capturas de Supabase:', error.message);
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
    const { data } = await supabase
      .from('user_rolls')
      .select('last_roll')
      .eq('guild_id', guildId)
      .eq('user_id', userId)
      .maybeSingle();
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
    if (error) console.error('Error al guardar last_roll en Supabase:', error.message);
  } else {
    db.prepare(`
      INSERT INTO user_rolls (guild_id, user_id, last_roll)
      VALUES (?, ?, ?)
      ON CONFLICT(guild_id, user_id) DO UPDATE SET last_roll = excluded.last_roll
    `).run(guildId, userId, timestamp);
  }
}

module.exports = {
  getGuildSettings,
  updateGuildSettings,
  addCapture,
  getUserCaptures,
  getLastRoll,
  setLastRoll,
};
