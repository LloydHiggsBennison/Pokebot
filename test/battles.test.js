const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
const engine=require('../src/battleEngine'),{loadModule}=require('./helpers');
const copy=(id,species=6,level=15)=>({id,pokemon_id:species,pokemon_name:'pokemon'+species,level,experience:level**3});
test('all species have four bounded moves and stats; evolution examples differ',()=>{
 for(let id=1;id<=1025;id++){
  const c=copy(id,id),moves=engine.movesFor(c),s=engine.stats(c);
  assert.equal(moves.length,4);assert.deepEqual(moves.map(m=>m.role),['attack1','attack2','defense','special']);
  assert.ok(moves.every(m=>m.remaining>0));assert.ok(s.hp>0);
  assert.equal(new Set(moves.map(m=>m.id)).size,4,'duplicate moves: '+id);
 }
 const sets=[4,5,6].map(id=>engine.movesFor(copy(id,id)).map(m=>m.id).join(','));
 assert.equal(new Set(sets).size,3);
 assert.deepEqual(engine.stats({...copy(1),is_shiny:1}),engine.stats(copy(1)));
});
test('turns, PP, damage, defense, surrender and timeout are enforced without mutating saved state',()=>{
 let s=engine.startFight({status:'selecting',users:['a','b'],fighters:[engine.fighter(copy(1),'a'),engine.fighter(copy(2,9),'b')]});
 const actor=s.fighters[s.turn].user,other=s.users.find(u=>u!==actor),before=JSON.stringify(s);
 assert.throws(()=>engine.act(s,other,0));
 const next=engine.act(s,actor,0,()=>0);assert.equal(JSON.stringify(s),before);
 assert.equal(next.fighters[s.turn].moves[0].remaining,14);
 assert.ok(next.fighters[1-s.turn].hp<s.fighters[1-s.turn].hp);
 next.fighters[next.turn].moves[0].remaining=0;assert.throws(()=>engine.act(next,next.fighters[next.turn].user,0));
 const guard=engine.act(s,actor,2,()=>0);assert.equal(guard.turn,1-s.turn);
 assert.equal(engine.finish(s,actor).winner,other);
 assert.equal(engine.timeout({...s,deadline:0}).winner,other);
});
test('PostgreSQL selected fusion retains exact identity/progress; battles lock copies and award XP once',async()=>{
 const db=new PGlite();
 try{
  await db.exec('CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role BYPASSRLS;');
  await db.exec(fs.readFileSync(path.join(__dirname,'../supabase_schema.sql'),'utf8'));
  const sql=fs.readFileSync(path.join(__dirname,'../supabase/migrations/20260915014322_pokemon_battles_progression.sql'),'utf8');
  await db.exec(sql);await db.exec(sql);
  await db.exec("INSERT INTO captures(guild_id,user_id,pokemon_id,pokemon_name,is_shiny,caught_at,level,experience,iv_total) SELECT 'g','a',6,'charizard',0,123,CASE WHEN n=3 THEN 30 ELSE 5 END,CASE WHEN n=3 THEN 27020 ELSE 125 END,100 FROM generate_series(1,5) n; INSERT INTO captures(guild_id,user_id,pokemon_id,pokemon_name,is_shiny,caught_at,level) VALUES('g','b',9,'blastoise',0,456,5);");
  await db.exec('SET ROLE service_role');
  const request='00000000-0000-4000-8000-000000000001';
  const fused=(await db.query("SELECT fuse_selected_pokemon($1,'g','a',3) AS result",[request])).rows[0].result;
  assert.equal(fused.id,3);assert.equal(fused.level,30);assert.equal(fused.experience,27020);assert.equal(fused.iv_total,100);
  assert.equal((await db.query("SELECT count(*)::int n FROM captures WHERE user_id='a'")).rows[0].n,2);
  assert.equal((await db.query("SELECT fuse_selected_pokemon($1,'g','a',3) AS result",[request])).rows[0].result.id,3);
  const bid='00000000-0000-4000-8000-000000000002';
  let state={guildId:'g',users:['a','b'],status:'invited',fighters:[null,null],deadline:Date.now()+300000},rev=-1;
  const save=async(actor,s,expected=rev)=>{const r=(await db.query('SELECT save_pokemon_battle($1,$2,$3,$4) AS result',[bid,expected,actor,JSON.stringify(s)])).rows[0].result;if(!r.conflict)rev=r.revision;return r;};
  await save('a',state);
  state={...state,status:'selecting',fighters:[engine.fighter(fused,'a'),engine.fighter({...copy(6,9,5),pokemon_name:'blastoise'},'b')]};
  await save('b',state);
  await assert.rejects(db.exec("UPDATE captures SET user_id='c' WHERE id=3"));
  await assert.rejects(db.exec('DELETE FROM captures WHERE id=3'));
  state=engine.startFight(state);await save('a',state);
  const stale=rev;
  const wrong=state.users.find(u=>u!==state.fighters[state.turn].user);
  await assert.rejects(save(wrong,state));
  state={...state,status:'finished',winner:'a',turns:4,reason:'knockout'};
  const won=await save(state.fighters[state.turn].user,state);
  assert.equal(won.state.xp,100);
  assert.equal((await save('a',state,stale)).conflict,true);
  assert.equal(Number((await db.query('SELECT experience FROM captures WHERE id=3')).rows[0].experience),27120);
  await db.exec("UPDATE captures SET user_id='c' WHERE id=3");
  await db.exec('SET ROLE anon');
  await assert.rejects(db.query('SELECT * FROM pokemon_battles'));
 }finally{await db.close();}
});

test('Discord battle flow keeps acceptance and moves private, scopes copies, rejects stale turns and recovers timeouts',async()=>{
 let row=null,id,publicMessage,tick;
 const guild={id:'g',members:{fetch:async user=>({user:{id:user}})}};
 const client={channels:{fetch:async()=>({messages:{edit:async(mid,p)=>{publicMessage=p;}}})}};
 const copies={a:{...copy(1,6),user_id:'a'},b:{...copy(2,9),user_id:'b'}};
 const store={
  copyPage:async(g,u)=>({rows:[copies[u]],total:1}),
  getCopy:async(g,u,cid)=>String(copies[u].id)===cid?copies[u]:null,
  getBattle:async()=>row,
  saveBattle:async(bid,revision,actor,state)=>{id=bid;if(row&&revision!==row.revision)return {...row,conflict:true};row={state:structuredClone(state),revision:revision+1};return row;},
  expiredBattles:async()=>row.state.deadline<Date.now()?[{id,...row}]:[],
 };
 const manager=loadModule('src/battleManager.js',{'./progressionStore':store,'./guildMembers':{resolveMention:async()=>({id:'b'})}},
  {setInterval:fn=>{tick=fn;return {unref(){}};}});
 const message={guild,author:{id:'a'},channel:{id:'c'},reply:async p=>({id:'m',edit:async p=>{publicMessage=p;}})};
 await manager.challenge(message,'<@b>');assert.equal(row.state.status,'invited');
 const interaction=(user,action,values)=>({customId:'pokefight:'+id+':'+action,guildId:'g',guild,client,user:{id:user},values,
   async deferReply(p){this.private=p.flags;},async deferUpdate(){this.deferred=true;},async editReply(p){this.payload=p;},async reply(p){this.replied=p;}});
 const other=interaction('c','open');await manager.handleBattle(other);assert.ok(other.replied);
 const opening=interaction('b','open');await manager.handleBattle(opening);assert.equal(opening.private,64);
 await manager.handleBattle(interaction('b','accept:'+row.revision));assert.equal(row.state.status,'selecting');
 await manager.handleBattle(interaction('a','pick:'+row.revision,['2']));assert.equal(row.state.fighters[0],null);
 await manager.handleBattle(interaction('a','pick:'+row.revision,['1']));
 await manager.handleBattle(interaction('b','pick:'+row.revision,['2']));assert.equal(row.state.status,'active');
 const actor=row.state.fighters[row.state.turn].user,wrong=row.state.users.find(u=>u!==actor),revision=row.revision;
 await manager.handleBattle(interaction(wrong,'move:'+revision,['0']));assert.equal(row.revision,revision);
 await manager.handleBattle(interaction(actor,'move:'+revision,['0']));assert.equal(row.revision,revision+1);
 await manager.handleBattle(interaction(actor,'move:'+revision,['0']));assert.equal(row.revision,revision+1);
 row.state.deadline=0;manager.startBattleSweeper(client);await tick();assert.equal(row.state.status,'finished');
 assert.equal(publicMessage.components.length,0);
});

test('SQLite copy transformation and persisted battle progression match the PostgreSQL behavior',async()=>{
 const {DatabaseSync}=require('node:sqlite'),db=new DatabaseSync(':memory:');
 const adapter={exec:s=>db.exec(s),prepare:s=>db.prepare(s),transaction:fn=>()=>{db.exec('BEGIN');try{const r=fn();db.exec('COMMIT');return r;}catch(e){db.exec('ROLLBACK');throw e;}}};
 try{
  db.exec("CREATE TABLE captures(id INTEGER PRIMARY KEY,guild_id TEXT,user_id TEXT,pokemon_id INTEGER,pokemon_name TEXT,is_shiny INTEGER,caught_at INTEGER)");
  const module=require('../src/progressionSqlite');module.initialize(adapter);
  for(let id=1;id<=6;id++)db.prepare('INSERT INTO captures(id,guild_id,user_id,pokemon_id,pokemon_name,is_shiny,caught_at,level,experience) VALUES(?,?,?,?,?,0,123,5,125)').run(id,'g',id===6?'b':'a',id===6?9:6,'pokemon');
  const transformed=module.fuse(adapter,'g','a',3,'request');assert.equal(transformed.id,3);assert.equal(transformed.is_shiny,1);
  assert.equal(module.fuse(adapter,'g','a',3,'request').id,3);
  let s={guildId:'g',users:['a','b'],fighters:[null,null],status:'invited',deadline:Date.now()+300000};
  module.save(adapter,'battle',-1,'a',s);
  s={...s,status:'selecting',fighters:[engine.fighter(transformed,'a'),engine.fighter(copy(6,9,5),'b')]};
  module.save(adapter,'battle',0,'b',s);
  assert.throws(()=>db.exec('DELETE FROM captures WHERE id=3'));
  s=engine.startFight(s);module.save(adapter,'battle',1,'a',s);
  s={...s,status:'finished',turns:4,winner:'a'};
  const r=module.save(adapter,'battle',2,s.fighters[s.turn].user,s);
  assert.equal(r.state.xp,100);assert.equal(db.prepare('SELECT experience FROM captures WHERE id=3').get().experience,225);
  assert.equal(module.save(adapter,'battle',2,'a',s).conflict,true);
 }finally{db.close();}
});
