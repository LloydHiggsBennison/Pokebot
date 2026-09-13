const { storage } = require('./database');
const { supabase, sqlite } = storage;

if (sqlite) {
  const columns = new Set(sqlite.prepare('PRAGMA table_info(captures)').all().map(c => c.name));
  for (const [name, type] of [['level','INTEGER'],['iv_total','INTEGER'],['rarity','TEXT']]) {
    if (!columns.has(name)) sqlite.exec(`ALTER TABLE captures ADD COLUMN ${name} ${type}`);
  }
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS bot_languages (scope_id TEXT PRIMARY KEY, language TEXT NOT NULL CHECK(language IN ('es','en')));
    CREATE TABLE IF NOT EXISTS pokecoin_wallets (guild_id TEXT,user_id TEXT,balance INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(guild_id,user_id));
    CREATE TABLE IF NOT EXISTS wild_claims (encounter_id TEXT PRIMARY KEY,guild_id TEXT,user_id TEXT,pokemon_id INTEGER,pokemon_name TEXT,level INTEGER,iv_total INTEGER,rarity TEXT,coins INTEGER,caught_at INTEGER);
  `);
}

async function loadLanguages() {
  if (!supabase) return sqlite.prepare('SELECT * FROM bot_languages').all();
  let cursor = ''; const rows = [];
  while (true) {
    const { data, error } = await supabase.from('bot_languages').select('*').gt('scope_id', cursor).order('scope_id').limit(500);
    if (error) throw error;
    if (!data?.length) return rows;
    rows.push(...data); cursor = data[data.length - 1].scope_id;
  }
}
async function saveLanguage(scope, language) {
  if (!['es','en'].includes(language)) throw new Error('Invalid language');
  if (supabase) {
    const { error } = await supabase.from('bot_languages').upsert({ scope_id: scope, language });
    if (error) throw error;
  } else sqlite.prepare('INSERT INTO bot_languages VALUES (?,?) ON CONFLICT(scope_id) DO UPDATE SET language=excluded.language').run(scope,language);
}
async function getBalance(guild, user) {
  if (!supabase) return sqlite.prepare('SELECT balance FROM pokecoin_wallets WHERE guild_id=? AND user_id=?').get(guild,user)?.balance || 0;
  const {data,error}=await supabase.from('pokecoin_wallets').select('balance').eq('guild_id',guild).eq('user_id',user).maybeSingle();
  if(error) throw error;
  return data?.balance || 0;
}
async function recordWildCapture(guild,user,p) {
  if (supabase) {
    const {data,error}=await supabase.rpc('record_wild_capture',{
      p_encounter_id:p.encounterId,p_guild_id:guild,p_user_id:user,p_pokemon_id:p.id,
      p_pokemon_name:p.name,p_level:p.level,p_iv_total:p.ivTotal,p_rarity:p.rarity,p_coins:p.coins,
    });
    if(error) throw error;
    return data;
  }
  return sqlite.transaction(() => {
    let claim=sqlite.prepare('SELECT * FROM wild_claims WHERE encounter_id=?').get(p.encounterId);
    const isNew=!claim;
    if(claim && (claim.guild_id!==guild || claim.user_id!==user)) return null;
    if(!claim) {
      sqlite.prepare('INSERT INTO wild_claims VALUES (?,?,?,?,?,?,?,?,?,?)').run(p.encounterId,guild,user,p.id,p.name,p.level,p.ivTotal,p.rarity,p.coins,Date.now());
      claim=sqlite.prepare('SELECT * FROM wild_claims WHERE encounter_id=?').get(p.encounterId);
      sqlite.prepare('INSERT INTO captures(guild_id,user_id,pokemon_id,pokemon_name,is_shiny,caught_at,level,iv_total,rarity) VALUES(?,?,?,?,0,?,?,?,?)').run(guild,user,p.id,p.name,claim.caught_at,p.level,p.ivTotal,p.rarity);
      sqlite.prepare('INSERT INTO pokecoin_wallets VALUES(?,?,?) ON CONFLICT(guild_id,user_id) DO UPDATE SET balance=balance+excluded.balance').run(guild,user,p.coins);
    }
    return {...claim,balance:sqlite.prepare('SELECT balance FROM pokecoin_wallets WHERE guild_id=? AND user_id=?').get(guild,user).balance,new_claim:isNew};
  })();
}
module.exports={loadLanguages,saveLanguage,getBalance,recordWildCapture};

