const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
const {loadModule}=require('./helpers');
const migration=path.join(__dirname,'../supabase/migrations/20260914210042_pokemon_transfers.sql');
test('PostgreSQL transfers preserve copies, metadata, ownership and idempotency; rollback is atomic',async()=>{
  const db=new PGlite();
  try {
    await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;');
    await db.exec(fs.readFileSync(path.join(__dirname,'../supabase_schema.sql'),'utf8'));
    const sql=fs.readFileSync(migration,'utf8');await db.exec(sql);await db.exec(sql);
    await db.exec("INSERT INTO captures(guild_id,user_id,pokemon_id,pokemon_name,is_shiny,caught_at) VALUES ('g','a',6,'charizard',1,123),('g','b',9,'blastoise',0,456),('g','a',25,'pikachu',0,789),('other','b',151,'mew',0,999);");
    const call=(request,give,take=null,guild='g',sender='a',receiver='b')=>db.query('SELECT transfer_pokemon($1,$2,$3,$4,$5,$6) AS ok',[request,guild,sender,receiver,give,take]);
    const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
    await db.exec('SET ROLE service_role');
    assert.equal((await call(id(1),1,4)).rows[0].ok,false);
    assert.equal((await call(id(2),1,2)).rows[0].ok,true);
    assert.equal((await call(id(2),1,2)).rows[0].ok,true);
    await assert.rejects(call(id(2),3));
    let rows=(await db.query('SELECT * FROM captures ORDER BY id')).rows;
    assert.equal(rows[0].user_id,'b');assert.equal(rows[0].is_shiny,1);assert.equal(Number(rows[0].caught_at),123);
    assert.equal(rows[1].user_id,'a');assert.equal(rows.length,4);
    assert.equal((await call(id(3),1)).rows[0].ok,false);
    assert.equal((await call(id(4),3)).rows[0].ok,true);
    await db.exec('RESET ROLE');
    await db.exec("CREATE FUNCTION fail_transfer() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.id=2 THEN RAISE EXCEPTION 'test'; END IF; RETURN NEW; END; $$; CREATE TRIGGER fail_transfer BEFORE UPDATE ON captures FOR EACH ROW EXECUTE FUNCTION fail_transfer();");
    await assert.rejects(call(id(5),1,2,'g','b','a'));
    rows=(await db.query('SELECT * FROM captures ORDER BY id')).rows;
    assert.equal(rows[0].user_id,'b');assert.equal(rows[1].user_id,'a');
    assert.equal((await db.query('SELECT count(*)::int AS n FROM pokemon_transfers')).rows[0].n,2);
    await db.exec('SET ROLE anon');
    await assert.rejects(call(id(6),3));
    await assert.rejects(db.query('SELECT * FROM pokemon_transfers'));
  } finally {await db.close();}
});
function fixture() {
  const sent=[],writes=[],members=new Set(['111','222']);
  let now=1000,fail=false;
  const manager=loadModule('src/transferManager.js',{
    './guildMembers':{resolveMention:async()=>({id:'222',bot:false})},
    './transferStore':{
      findCapture:async(g,u,id,shiny)=>({id:u==='111'?1:2,pokemon_id:id,pokemon_name:id===6?'charizard':'blastoise',is_shiny:shiny?1:0}),
      transferPokemon:async s=>{writes.push(s.id);if(fail){fail=false;throw Error('timeout');}return true;},
    },
  },{Date:{now:()=>now}});
  const guild={id:'g',members:{fetch:async id=>members.has(id)?{user:{id,bot:false}}:null}};
  const message={guild,channel:{id:'c'},author:{id:'111'},reply:async payload=>{const m={id:'m'+sent.length,payload,async edit(p){this.payload=p;}};sent.push(m);return m;}};
  const click=(user='222',action='accept')=>{
    const customId=sent[0].payload.components[0].components[0].data.custom_id.replace(/accept$/,action);
    return {customId,guildId:'g',guild,user:{id:user},message:{id:'m0'},async deferUpdate(){this.deferred=true;},async editReply(p){this.updated=p;},async update(p){this.updated=p;},async reply(p){this.replied=p;}};
  };
  return {manager,message,sent,writes,members,click,expire(){now+=300001;},fail(){fail=true;}};
}
test('gift requires recipient acceptance; donor and strangers cannot accept',async()=>{
  const f=fixture();await f.manager.showTransfer(f.message,'$pokegive <@222> charizard shiny');
  assert.match(f.sent[0].payload.content,/¿Confirmar regalo/);
  assert.equal(f.writes.length,0);
  for(const user of ['111','333']) {const i=f.click(user);await f.manager.handleTransfer(i);assert.ok(i.replied);}
  const i=f.click();await f.manager.handleTransfer(i);assert.equal(f.writes.length,1);assert.match(i.updated.content,/completada/);
  await f.manager.handleTransfer(i);assert.equal(f.writes.length,1);
});
test('text yes is scoped to recipient and channel; decline writes nothing',async()=>{
  const f=fixture();await f.manager.showTransfer(f.message,'$poketrade <@222> charizard / blastoise');
  assert.equal(await f.manager.handleTransferReply({...f.message,content:'y'}),false);
  assert.equal(await f.manager.handleTransferReply({...f.message,content:'y',author:{id:'222'},channel:{id:'wrong'}}),false);
  assert.equal(await f.manager.handleTransferReply({...f.message,content:'no',author:{id:'222'}}),true);
  assert.equal(f.writes.length,0);assert.match(f.sent[0].payload.content,/cancelada/);
});
test('retry reuses operation ID and membership/expiration are checked before transfers',async()=>{
  const f=fixture();await f.manager.showTransfer(f.message,'$poketrade <@222> charizard / blastoise');
  f.fail();const i=f.click();await f.manager.handleTransfer(i);await f.manager.handleTransfer(i);
  assert.equal(f.writes.length,2);assert.equal(f.writes[0],f.writes[1]);
  const left=fixture();await left.manager.showTransfer(left.message,'$pokegive <@222> charizard');left.members.delete('222');
  await left.manager.handleTransfer(left.click());assert.equal(left.writes.length,0);
  const expired=fixture();await expired.manager.showTransfer(expired.message,'$pokegive <@222> charizard');expired.expire();
  await expired.manager.handleTransfer(expired.click());assert.equal(expired.writes.length,0);
});

test('SQLite transfers preserve variants and retry receipts, and cannot partially swap',async()=>{
  const {DatabaseSync}=require('node:sqlite');
  const connection=new DatabaseSync(':memory:');
  const sqlite={exec:sql=>connection.exec(sql),prepare:sql=>connection.prepare(sql),
    transaction:fn=>()=>{connection.exec('BEGIN');try{const result=fn();connection.exec('COMMIT');return result;}catch(e){connection.exec('ROLLBACK');throw e;}}};
  try {
    connection.exec("CREATE TABLE captures(id INTEGER PRIMARY KEY,guild_id TEXT,user_id TEXT,pokemon_id INTEGER,pokemon_name TEXT,is_shiny INTEGER,caught_at INTEGER); INSERT INTO captures VALUES(1,'g','a',6,'charizard',1,123),(2,'g','b',9,'blastoise',0,456);");
    const store=loadModule('src/transferStore.js',{'./database':{storage:{supabase:null,sqlite}}});
    assert.equal((await store.findCapture('g','a',6,true)).id,1);
    assert.equal(await store.findCapture('g','a',6,false),undefined);
    const offer={id:'transfer1',guildId:'g',senderId:'a',receiverId:'b',give:{id:1},take:{id:999}};
    assert.equal(await store.transferPokemon(offer),false);
    assert.equal(connection.prepare('SELECT user_id FROM captures WHERE id=1').get().user_id,'a');
    offer.take.id=2;
    assert.equal(await store.transferPokemon(offer),true);
    assert.equal(await store.transferPokemon(offer),true);
    const row=connection.prepare('SELECT * FROM captures WHERE id=1').get();
    assert.equal(row.user_id,'b');assert.equal(row.is_shiny,1);assert.equal(row.caught_at,123);
    assert.equal(connection.prepare('SELECT count(*) AS n FROM captures').get().n,2);
    await assert.rejects(store.transferPokemon({...offer,receiverId:'c'}));
  } finally {connection.close();}
});
