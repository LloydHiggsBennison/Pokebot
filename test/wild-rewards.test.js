const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
const {loadModule,fakeDatabase,fakeClient,fakeMessage}=require('./helpers');
const {rarityFor,createEncounter,COINS}=require('../src/wildRewards');
const {withLanguage,t}=require('../src/i18n');

test('rarity covers every species and IV/level remain in range',()=>{
  for(let id=1;id<=1025;id++) assert.ok(COINS[rarityFor(id)]);
  assert.equal(COINS[rarityFor(359)],35);
  assert.equal(COINS[rarityFor(150)],150);
  assert.equal(COINS[rarityFor(151)],300);
  for(let i=0;i<100;i++){
    const p=createEncounter({id:359,name:'absol'},'channel');
    assert.ok(p.level>=1 && p.level<=100);
    assert.ok(p.ivTotal>=0 && p.ivTotal<=186);
  }
});

test('PostgreSQL: rewards are atomic, replay safe, owner scoped and restricted to bot role',async()=>{
  const db=new PGlite();
  try {
    await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;');
    await db.exec(fs.readFileSync(path.join(__dirname,'../supabase_schema.sql'),'utf8'));
    const sql=fs.readFileSync(path.join(__dirname,'../supabase_migration_wild_rewards.sql'),'utf8');
    await db.exec(sql);await db.exec(sql);
    const award=(id,user='owner')=>db.query("SELECT record_wild_capture($1,'guild',$2,359,'absol',10,122,'rare',35) AS result",[id,user]);
    await db.exec('SET ROLE service_role');
    const id='00000000-0000-4000-8000-000000000001';
    const first=(await award(id)).rows[0].result;
    assert.equal(first.coins,35);assert.equal(first.balance,35);assert.equal(first.level,10);
    assert.equal((await award(id)).rows[0].result.new_claim,false);
    assert.equal((await award(id,'other')).rows[0].result,null);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM captures')).rows[0].n,1);
    await db.exec('RESET ROLE');
    // Force the second step to fail: neither the claim nor wallet increment may survive.
    await db.exec("CREATE FUNCTION reject_test_capture() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test rollback'; END; $$; CREATE TRIGGER reject_test_capture BEFORE INSERT ON captures FOR EACH ROW EXECUTE FUNCTION reject_test_capture();");
    await assert.rejects(award('00000000-0000-4000-8000-000000000002'));
    assert.equal((await db.query('SELECT count(*)::int AS n FROM wild_claims')).rows[0].n,1);
    assert.equal(Number((await db.query('SELECT balance FROM pokecoin_wallets')).rows[0].balance),35);
    await db.exec('SET ROLE anon');
    await assert.rejects(award(id));
    await assert.rejects(db.query('SELECT * FROM pokecoin_wallets'));
  } finally {await db.close();}
});

test('wild encounter reserves the correct channel and retains identity after save failure',async()=>{
  const manager=loadModule('src/spawnManager.js',{'./database':fakeDatabase()});
  const p=createEncounter({id:359,name:'absol'},'channel');
  manager.getState('guild').activeSpawn=p;
  assert.equal(manager.reserveCatch('guild','wrong','absol','u'),null);
  assert.equal(manager.reserveCatch('guild','channel','wrong','u'),null);
  assert.equal(manager.reserveCatch('guild','channel','Absol','u'),p);
  assert.equal(manager.reserveCatch('guild','channel','Absol','other'),null);
  manager.finishCatch('guild',p.encounterId,false);
  assert.equal(manager.reserveCatch('guild','channel','Absol','other'),null);
  assert.equal(manager.reserveCatch('guild','channel','Absol','u'),p);
  manager.finishCatch('guild',p.encounterId,true);
  assert.equal(manager.getState('guild').activeSpawn,null);
});

test('catch success is translated and sent only after persistence',async()=>{
  for(const lang of ['es','en']){
    let saved=false;
    const manager=loadModule('src/catchManager.js',{
      './spawnManager':{reserveCatch:()=>({encounterId:'id'}),finishCatch:()=>{}},
      './economy':{async recordWildCapture(){saved=true;return {pokemon_name:'absol',level:10,iv_total:122,coins:35};}},
    });
    const message=fakeMessage(fakeClient().client);message.channel.id='c';
    message.reply=async p=>{assert.equal(saved,true);assert.match(p.content,lang==='es'?/Atrapaste un Absol de nivel 10/:/caught a Level 10 Absol/);assert.match(p.content,/65.59%/);assert.match(p.content,/35 Pokécoins/);};
    await withLanguage(lang,()=>manager.catchWild(message,'absol'));
  }
});

test('concurrent language contexts do not leak between users',async()=>{
  const results=await Promise.all(['en','es'].map(lang=>withLanguage(lang,async()=>{await new Promise(r=>setImmediate(r));return t('Español','English');})));
  assert.deepEqual(results,['English','Español']);
  assert.equal(t('Español','English'),'Español');
});

test('language preferences persist and user choice overrides guild default',async()=>{
  const rows=[];
  const lang=loadModule('src/i18n.js',{'./economy':{async loadLanguages(){return rows;},async saveLanguage(scope_id,language){rows.push({scope_id,language});}}});
  await lang.setLanguage('guild:g','en');assert.equal(lang.languageFor('u','g'),'en');
  await lang.setLanguage('user:u','es');assert.equal(lang.languageFor('u','g'),'es');
  assert.equal(lang.languageFor('other','g'),'en');
  const restarted=loadModule('src/i18n.js',{'./economy':{async loadLanguages(){return rows;}}});
  await restarted.initializeLanguages();assert.equal(restarted.languageFor('u','g'),'es');assert.equal(restarted.guildLanguage('g'),'en');
});

test('mention catch routes only when the mentioned user is this bot',async()=>{
  let calls=0;const client={user:{id:'123'}};
  const event=loadModule('src/events/messageCreate.js',{
    '../spawnManager':{async handleMessage(){}},'../database':fakeDatabase(),'../puzzleManager':{},
    '../catchManager':{async catchWild(m,guess){calls++;assert.equal(guess,'absol');}},
  });
  const m=fakeMessage(client);m.content='<@123> catch absol';await event.execute(m,client);
  m.content='<@999> catch absol';await event.execute(m,client);assert.equal(calls,1);
});

test('language selector rejects another owner and lost server permissions',async()=>{
  let writes=0;
  const manager=loadModule('src/languageManager.js',{'./i18n':{t,withLanguage,async setLanguage(){writes++;}}});
  const base={customId:'language:owner:guild:g',guildId:'g',values:['en'],async reply(p){this.result=p;}};
  await manager.handleLanguage({...base,user:{id:'other'}});
  await manager.handleLanguage({...base,user:{id:'owner'},memberPermissions:{has:()=>false}});
  assert.equal(writes,0);
  const permitted={...base,user:{id:'owner'},memberPermissions:{has:()=>true},async deferUpdate(){this.deferred=true;},async editReply(p){assert.ok(this.deferred);this.result=p;}};
  await manager.handleLanguage(permitted);
  assert.equal(writes,1);assert.match(permitted.result.content,/Language saved/);
});

test('SQLite persists a wild capture and wallet exactly once',async()=>{
  const {DatabaseSync}=require('node:sqlite');const db=new DatabaseSync(':memory:');
  const adapter={exec:s=>db.exec(s),prepare:s=>db.prepare(s),transaction:fn=>()=>{db.exec('BEGIN');try{const r=fn();db.exec('COMMIT');return r;}catch(e){db.exec('ROLLBACK');throw e;}}};
  try {
    db.exec('CREATE TABLE captures(id INTEGER PRIMARY KEY,guild_id TEXT,user_id TEXT,pokemon_id INTEGER,pokemon_name TEXT,is_shiny INTEGER,caught_at INTEGER)');
    const economy=loadModule('src/economy.js',{'./database':{storage:{sqlite:adapter}}});
    const p=createEncounter({id:359,name:'absol'},'c');
    await economy.recordWildCapture('g','u',p);await economy.recordWildCapture('g','u',p);
    assert.equal(await economy.getBalance('g','u'),35);
    assert.equal(await economy.recordWildCapture('g','other',p),null);
    assert.equal(db.prepare('SELECT count(*) AS n FROM captures').get().n,1);
    await economy.saveLanguage('user:u','en');
    assert.equal((await economy.loadLanguages())[0].language,'en');
  }finally{db.close();}
});

