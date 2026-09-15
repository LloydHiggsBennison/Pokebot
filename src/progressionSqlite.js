function initialize(db){
  const cols=new Set(db.prepare('PRAGMA table_info(captures)').all().map(c=>c.name));
  for(const [name,type] of [['level','INTEGER'],['iv_total','INTEGER'],['experience','INTEGER NOT NULL DEFAULT 0'],['battle_id','TEXT'],['battle_until','INTEGER']])
    if(!cols.has(name))db.exec('ALTER TABLE captures ADD COLUMN '+name+' '+type);
  db.exec(`CREATE TABLE IF NOT EXISTS pokemon_fusion_receipts(request_id TEXT PRIMARY KEY,guild_id TEXT,user_id TEXT,capture_id INTEGER,result TEXT);
    CREATE TABLE IF NOT EXISTS pokemon_battles(id TEXT PRIMARY KEY,guild_id TEXT,state TEXT,revision INTEGER,status TEXT,deadline INTEGER,updated_at INTEGER);
    CREATE TABLE IF NOT EXISTS pokemon_battle_players(guild_id TEXT,user_id TEXT,battle_id TEXT,until_ms INTEGER,PRIMARY KEY(guild_id,user_id));
    CREATE TRIGGER IF NOT EXISTS battle_capture_delete BEFORE DELETE ON captures WHEN OLD.battle_id IS NOT NULL AND OLD.battle_until>unixepoch()*1000 BEGIN SELECT RAISE(ABORT,'Pokemon is battling'); END;
    CREATE TRIGGER IF NOT EXISTS battle_capture_update BEFORE UPDATE ON captures WHEN OLD.battle_id IS NOT NULL AND OLD.battle_until>unixepoch()*1000 AND (NEW.user_id<>OLD.user_id OR NEW.guild_id<>OLD.guild_id OR NEW.is_shiny<>OLD.is_shiny OR NEW.pokemon_id<>OLD.pokemon_id) BEGIN SELECT RAISE(ABORT,'Pokemon is battling'); END;`);
}
function fuse(db,guild,user,id,request){
  return db.transaction(()=>{
    const old=db.prepare('SELECT * FROM pokemon_fusion_receipts WHERE request_id=?').get(request);
    if(old){if(old.guild_id!==guild||old.user_id!==user||String(old.capture_id)!==String(id))throw Error('Fusion mismatch');return JSON.parse(old.result);}
    const chosen=db.prepare('SELECT * FROM captures WHERE id=? AND guild_id=? AND user_id=? AND is_shiny=0').get(id,guild,user);
    if(!chosen||(chosen.battle_id&&chosen.battle_until>Date.now()))return null;
    const other=db.prepare('SELECT id FROM captures WHERE guild_id=? AND user_id=? AND pokemon_id=? AND is_shiny=0 AND id<>? AND (battle_id IS NULL OR battle_until<=?) ORDER BY coalesce(level,5),experience,id LIMIT 4').all(guild,user,chosen.pokemon_id,id,Date.now());
    if(other.length<4)return null;
    for(const p of other.slice(0,3))db.prepare('DELETE FROM captures WHERE id=?').run(p.id);
    db.prepare('UPDATE captures SET is_shiny=1 WHERE id=?').run(id);
    const result={...chosen,is_shiny:1};
    db.prepare('INSERT INTO pokemon_fusion_receipts VALUES(?,?,?,?,?)').run(request,guild,user,id,JSON.stringify(result));return result;
  })();
}
function save(db,id,expected,actor,state){
  return db.transaction(()=>{
    const s=structuredClone(state),now=Date.now(),old=db.prepare('SELECT * FROM pokemon_battles WHERE id=?').get(id);
    if(s.users.length!==2||s.users[0]===s.users[1]||!s.users.includes(actor))throw Error('Invalid battle');
    if(old){
      const previous=JSON.parse(old.state);
      if(old.guild_id!==s.guildId||JSON.stringify(previous.users)!==JSON.stringify(s.users))throw Error('Battle mismatch');
      if(old.revision!==expected||['finished','cancelled'].includes(old.status))return {conflict:true,state:previous,revision:old.revision};
      if(old.status==='active'&&previous.fighters[previous.turn].user!==actor&&s.reason!=='surrender')throw Error('Not your turn');
    }else{
      if(expected!==-1||s.status!=='invited'||actor!==s.users[0])throw Error('Invalid invitation');
      db.prepare('DELETE FROM pokemon_battle_players WHERE until_ms<=?').run(now);
      for(const user of s.users)db.prepare('INSERT INTO pokemon_battle_players VALUES(?,?,?,?)').run(s.guildId,user,id,now+360000);
    }
    const selected=(s.fighters||[]).filter(Boolean);
    for(const c of db.prepare('SELECT id FROM captures WHERE battle_id=?').all(id))
      if(!selected.some(f=>String(f.copyId)===String(c.id)))db.prepare('UPDATE captures SET battle_id=NULL,battle_until=NULL WHERE id=?').run(c.id);
    for(const f of selected){
      const c=db.prepare('SELECT * FROM captures WHERE id=? AND guild_id=? AND user_id=?').get(f.copyId,s.guildId,f.user);
      if(!c||!s.users.includes(f.user)||(c.battle_id&&c.battle_id!==id&&c.battle_until>now)){
        if(['finished','cancelled'].includes(s.status)){s.status='cancelled';s.winner=null;continue;}throw Error('Copy unavailable');
      }
      db.prepare('UPDATE captures SET battle_id=?,battle_until=? WHERE id=?').run(id,now+360000,f.copyId);
    }
    if(['finished','cancelled'].includes(s.status)){
      db.prepare('UPDATE captures SET battle_id=NULL,battle_until=NULL WHERE battle_id=?').run(id);
      db.prepare('DELETE FROM pokemon_battle_players WHERE battle_id=?').run(id);s.xp=0;
      if(s.status==='finished'&&s.winner&&s.turns>=4){
        const previous=db.prepare("SELECT state FROM pokemon_battles WHERE guild_id=? AND status='finished' AND updated_at>?").all(s.guildId,now-86400000).filter(r=>JSON.parse(r.state).users.every(u=>s.users.includes(u))).length;
        const xp=previous<3?100:previous<10?25:0,f=s.fighters.find(f=>f.user===s.winner);
        const c=db.prepare('SELECT * FROM captures WHERE id=? AND user_id=?').get(f.copyId,s.winner);
        const total=Math.max(c.experience,(c.level||5)**3)+xp,level=Math.min(100,Math.floor(Math.cbrt(total)+0.000001));
        db.prepare('UPDATE captures SET experience=?,level=? WHERE id=?').run(total,Math.max(c.level||5,level),f.copyId);s.xp=xp;s.winnerLevel=level;
      }
    }else db.prepare('UPDATE pokemon_battle_players SET until_ms=? WHERE battle_id=?').run(now+360000,id);
    db.prepare('INSERT INTO pokemon_battles VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET state=excluded.state,revision=excluded.revision,status=excluded.status,deadline=excluded.deadline,updated_at=excluded.updated_at')
      .run(id,s.guildId,JSON.stringify(s),expected+1,s.status,s.deadline,now);
    return {state:s,revision:expected+1,conflict:false};
  })();
}
module.exports={initialize,fuse,save};
