const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
const {loadModule}=require('./helpers');
const {marketOffers,PRICES}=require('../src/marketCatalog');
test('market rotation is reproducible across restarts, shared per guild and changes hourly',()=>{
  const a=marketOffers('guild',100);
  assert.deepEqual(marketOffers('guild',100),a);
  assert.notDeepEqual(marketOffers('guild',101),a);
  assert.notDeepEqual(marketOffers('other',100),a);
  assert.equal(new Set(a.map(p=>p.id)).size,6);
  assert.ok(a.every(p=>p.price===PRICES[p.rarity]));
});
test('PostgreSQL market atomically charges and awards, rejects overspending, preserves receipts and rolls back failure',async()=>{
  const db=new PGlite();
  try{
    await db.exec('CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role BYPASSRLS;');
    await db.exec(fs.readFileSync(path.join(__dirname,'../supabase_schema.sql'),'utf8'));
    await db.exec(fs.readFileSync(path.join(__dirname,'../supabase_migration_wild_rewards.sql'),'utf8'));
    const sql=fs.readFileSync(path.join(__dirname,'../supabase/migrations/20260915012019_pokemon_market.sql'),'utf8');
    await db.exec(sql);await db.exec(sql);
    const rotation=Number((await db.query('SELECT floor(extract(epoch FROM clock_timestamp())/3600) AS r')).rows[0].r);
    const buy=(slot=1,user='u',hour=rotation,price=100)=>db.query("SELECT buy_market_pokemon('g',$1,$2,$3,25,'pikachu','common',$4) AS result",[user,hour,slot,price]);
    await db.exec("INSERT INTO pokecoin_wallets VALUES ('g','u',150),('g','rollback',200)");
    await db.exec('SET ROLE service_role');
    assert.equal((await buy()).rows[0].result.balance,50);
    assert.equal((await buy()).rows[0].result.new_purchase,false);
    assert.equal((await buy(2)).rows[0].result.status,'insufficient');
    assert.equal((await buy(1,'other')).rows[0].result.status,'insufficient');
    assert.equal((await buy(1,'u',rotation-1)).rows[0].result.status,'expired');
    await assert.rejects(buy(3,'u',rotation,1));
    assert.equal((await db.query('SELECT count(*)::int AS n FROM captures')).rows[0].n,1);
    await db.exec('RESET ROLE');
    await db.exec("CREATE FUNCTION fail_market() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'forced failure'; END; $$; CREATE TRIGGER fail_market BEFORE INSERT ON captures FOR EACH ROW EXECUTE FUNCTION fail_market();");
    await assert.rejects(buy(1,'rollback'));
    assert.equal(Number((await db.query("SELECT balance FROM pokecoin_wallets WHERE user_id='rollback'")).rows[0].balance),200);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM pokemon_market_purchases')).rows[0].n,1);
    await db.exec('SET ROLE anon');await assert.rejects(buy());await assert.rejects(db.query('SELECT * FROM pokemon_market_purchases'));
  }finally{await db.close();}
});
function fixture(){
  const offers=[{id:25,name:'pikachu',rarity:'common',price:100,slot:1}];
  const edits=[],buys=[];
  let state={balance:150,purchased:[]};
  const manager=loadModule('src/marketManager.js',{
    './marketCatalog':{marketRotation:()=>100,marketOffers:()=>offers,HOUR:3600000},
    './marketStore':{getMarketState:async()=>state,buyMarketPokemon:async(...args)=>{buys.push(args);state={balance:50,purchased:[1]};return {status:'purchased',balance:50,new_purchase:true,pokemon_name:'pikachu'};}},
    './emojiManager':{getPreparedEmoji:()=>'<:pkv2_25:123456789012345678>'},
  });
  const guild={id:'g',client:{}};
  const message={guild,author:{id:'u'},reply:async()=>({edit:async p=>edits.push(p)})};
  const interaction=(user='u',value='1:25:100')=>({customId:'pokemarket:u:100',values:[value],guildId:'g',guild,user:{id:user},
    async deferUpdate(){this.deferred=true;},async editReply(p){edits.push(p);},async reply(p){this.replied=p;}});
  return {manager,message,edits,buys,interaction};
}
test('market shows price and wallet, only owner can buy, purchased offers disappear',async()=>{
  const f=fixture();await f.manager.showMarket(f.message);
  assert.match(f.edits[0].embeds[0].data.description,/150 Pokécoins/);
  const other=f.interaction('other');await f.manager.handleMarket(other);assert.ok(other.replied);assert.equal(f.buys.length,0);
  const changed=f.interaction('u','1:25:1');await f.manager.handleMarket(changed);assert.ok(changed.replied);assert.equal(f.buys.length,0);
  await f.manager.handleMarket(f.interaction());
  assert.equal(f.buys.length,1);assert.match(f.edits.at(-1).content,/Compraste/);
  assert.equal(f.edits.at(-1).components.length,0);
});
test('SQLite purchases charge the same wallet used by wild rewards and cannot charge twice',async()=>{
  const {DatabaseSync}=require('node:sqlite');const db=new DatabaseSync(':memory:');
  const sqlite={exec:sql=>db.exec(sql),prepare:sql=>db.prepare(sql),transaction:fn=>()=>{db.exec('BEGIN');try{const r=fn();db.exec('COMMIT');return r;}catch(e){db.exec('ROLLBACK');throw e;}}};
  try{
    db.exec("CREATE TABLE captures(id INTEGER PRIMARY KEY,guild_id TEXT,user_id TEXT,pokemon_id INTEGER,pokemon_name TEXT,is_shiny INTEGER,caught_at INTEGER,rarity TEXT);CREATE TABLE pokecoin_wallets(guild_id TEXT,user_id TEXT,balance INTEGER,PRIMARY KEY(guild_id,user_id));INSERT INTO pokecoin_wallets VALUES('g','u',150);");
    const store=loadModule('src/marketStore.js',{'./database':{storage:{supabase:null,sqlite}},'./economy':{getBalance:async()=>db.prepare('SELECT balance FROM pokecoin_wallets').get().balance},'./marketCatalog':{PRICES,marketRotation:()=>100}});
    const offer={slot:1,id:25,name:'pikachu',rarity:'common',price:100};
    assert.equal((await store.buyMarketPokemon('g','u',100,offer)).balance,50);
    assert.equal((await store.buyMarketPokemon('g','u',100,offer)).new_purchase,false);
    assert.equal((await store.buyMarketPokemon('g','u',100,{...offer,slot:2})).status,'insufficient');
    assert.equal(db.prepare('SELECT count(*) AS n FROM captures').get().n,1);
    assert.deepEqual(Array.from((await store.getMarketState('g','u',100)).purchased),[1]);
  }finally{db.close();}
});
