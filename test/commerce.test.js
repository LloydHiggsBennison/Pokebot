const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
const {loadModule}=require('./helpers');
const {ticketReward,PRODUCTS,PRICES}=require('../src/commerceCatalog');
test('premium roll quota replaces the old cooldown and writes only through the atomic RPC',async()=>{
 const {fakeClient,fakeDatabase,fakeMessage,fixedRandom}=require('./helpers');
 const {client}=fakeClient(),db=fakeDatabase();let calls=0;
 db.getLastRoll=async()=>{throw Error('Legacy cooldown must not run');};
 db.setLastRoll=async()=>{throw Error('Legacy write must not run');};
 db.addCaptures=async()=>{throw Error('Legacy award must not run');};
 const manager=loadModule('src/puzzleManager.js',{'./database':db,'./emojiManager':{getEmojiStatus:()=>({status:'ready'}),prepareRollEmojis:(_g,ps)=>ps.map(p=>':pk'+p.id+':')},'./badgeManager':{getNewBadgeEmoji:()=>''},'./commerceStore':{action:async()=>{calls++;return {status:'rolled'};}}},{process:{env:{COMMERCE_ENABLED:'true'}},Math:fixedRandom(0)});
 const msg=fakeMessage(client);msg.id='roll';await manager.rollPuzzle(msg,{puzzle_cooldown_seconds:600});assert.equal(calls,1);assert.ok(msg.sent.length);
});

test('market panel rejects another user and retries a failed delivery with the same receipt key',async()=>{
 let panel,attempts=0;const receipts=[];
 const manager=loadModule('src/commerceManager.js',{'./progressionStore':{copyPage:async()=>({rows:[],total:0})},'./commerceStore':{enabled:()=>true,state:async()=>({account:{},coins:200,day:'2026-10-14',purchases:0}),action:async(_g,_u,id)=>{receipts.push(id);return {status:'purchased'};}}},{setInterval:()=>({unref(){}})});
 await manager.show({guild:{id:'g'},author:{id:'u'},reply:async()=>({edit:async p=>{panel=p;}})},'$pokemarket');
 const customId=panel.components[0].components[0].data.custom_id;
 const interaction={customId,guildId:'g',user:{id:'other'},reply:async p=>{assert.equal(p.flags,64);},deferUpdate:async()=>{interaction.deferred=true;},editReply:async()=>{if(++attempts===1)throw Error('delivery failed');}};
 await manager.handle(interaction);assert.equal(receipts.length,0);
 interaction.user.id='u';await manager.handle(interaction);await manager.handle(interaction);assert.equal(receipts.length,2);assert.equal(receipts[0],receipts[1]);
});
test('catalog prices, fixed shiny tickets and independent special shiny probability',()=>{
 assert.deepEqual(PRICES,[100,200,400,600,800,1000,2000]);assert.equal(PRODUCTS.credits50.credits,10000);
 assert.equal(PRODUCTS.credits50.legendary,5);assert.equal(PRODUCTS.credits50.mythical,1);
 assert.equal(ticketReward('legendary',()=>0).isShiny,true);assert.equal(ticketReward('mythical',()=>0).isShiny,false);
 let shines=0;for(let i=0;i<100;i++){let call=0;const p=ticketReward('special',()=>++call===1?29:call===2?i:0);assert.equal(p.rarity,'mythical');if(p.isShiny)shines++;}assert.equal(shines,5);
});
test('commerce SQL grants once, guards receipts and balances, resets Chile days, applies quotas and preserves levels',async()=>{
 const db=new PGlite();
 try{
  await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;');
  for(const file of ['supabase_schema.sql','supabase_migration_wild_rewards.sql','supabase/migrations/20260914210042_pokemon_transfers.sql','supabase/migrations/20260915014322_pokemon_battles_progression.sql','supabase/migrations/20261014235948_premium_commerce.sql'])await db.exec(fs.readFileSync(path.join(__dirname,'..',file),'utf8'));
  await db.exec(fs.readFileSync(path.join(__dirname,'../supabase/migrations/20261014235948_premium_commerce.sql'),'utf8'));
  await db.exec('SET ROLE service_role');
  const q=async(sql,args=[])=>(await db.query(sql,args)).rows[0];
  const action=async(id,kind,data={},user='a')=>(await q('SELECT commerce_action($1,$2,$3,$4,$5) r',['g',user,id,kind,JSON.stringify(data)])).r;
  const state=async()=>(await q("SELECT commerce_state('g','a') r")).r;
  const cid='00000000-0000-4000-8000-000000000001';
  await db.query("INSERT INTO commerce_checkouts(id,guild_id,user_id,sku,environment,provider_id) VALUES($1,'g','a','credits50','sandbox','ORDER')",[cid]);
  await q('SELECT commerce_grant($1,$2) r',[cid,'CAPTURE']);await q('SELECT commerce_grant($1,$2) r',[cid,'CAPTURE']);
  let s=await state();assert.equal(Number(s.account.credits),10000);assert.equal(s.account.legendary,5);assert.equal(s.account.mythical,1);
  for(let i=0;i<7;i++){const r=await action('buy'+i,'buy',{price:PRICES[i],day:s.day,currency:'credits'});assert.equal(r.status,'purchased');}
  assert.equal((await action('buy8','buy',{price:2000,day:s.day,currency:'credits'})).status,'daily_limit');
  assert.equal((await state()).account.special,7);
  await action('buy0','buy',{price:100,day:s.day,currency:'credits'});assert.equal((await state()).account.special,7);
  await assert.rejects(action('buy0','buy',{},'b'));
  await db.exec("UPDATE commerce_daily SET day=day-1 WHERE guild_id='g' AND user_id='a';");
  assert.equal((await action('nextday','buy',{price:100,day:s.day,currency:'credits'})).status,'purchased');
  const r=await action('redeem','redeem',{ticket:'legendary',reward:ticketReward('legendary',()=>0)});
  assert.equal(r.status,'redeemed');await action('redeem','redeem',{});assert.equal((await state()).account.legendary,4);
  const before=await q('SELECT count(*)::INTEGER n FROM captures');
  await assert.rejects(action('bad','redeem',{ticket:'mythical',reward:{id:1,name:'bad',rarity:'common',isShiny:true}}));assert.equal((await state()).account.mythical,1);assert.equal((await q('SELECT count(*)::INTEGER n FROM captures')).n,before.n);
  assert.equal((await action('r1','roll',{quantity:1,winners:[]})).status,'rolled');assert.equal((await action('r2','roll',{quantity:1,winners:[]})).status,'roll_limit');
  await db.exec("INSERT INTO commerce_entitlements VALUES('key:personal','user','a',now()+interval '1 day','a',false),('key:server','guild','g',now()+interval '1 day','a',false);");
  assert.equal((await action('r3','roll',{quantity:4,winners:[]})).status,'rolled');assert.equal((await action('r4','roll',{quantity:1,winners:[]})).status,'roll_limit');
  await action('item','item');const copy=(await q('SELECT id,iv_total FROM captures LIMIT 1'));
  const level=await action('level','level',{copy:copy.id,quantity:1});assert.equal(level.status,'levelled');assert.ok(level.level>5);assert.equal((await q('SELECT iv_total FROM captures WHERE id=$1',[copy.id])).iv_total,copy.iv_total);
  const wild="SELECT commerce_wild('00000000-0000-4000-8000-000000000002','g','a',1,'bulbasaur',5,100,'common',10) r";await q(wild);await q(wild);assert.equal((await state()).account.candy,1);
  await db.exec("INSERT INTO commerce_keys VALUES('hash','personal',30,now()+interval '1 day',NULL,NULL)");
  assert.equal((await action('key','key',{hash:'hash'})).status,'activated');assert.equal((await action('key2','key',{hash:'hash'},'b')).status,'invalid_key');
  await db.exec("INSERT INTO captures(guild_id,user_id,pokemon_id,pokemon_name,is_shiny,caught_at,level,experience) VALUES('g','b',6,'charizard',0,1,5,125),('g','b',6,'charizard',0,1,5,125),('g','a',9,'blastoise',0,1,5,125);");
  const own=(await db.query("SELECT id FROM captures WHERE user_id='b' ORDER BY id")).rows;
  const giveReq='00000000-0000-4000-8000-000000000010';
  assert.equal((await q("SELECT commerce_transfer($1,'g','b','a',$2,NULL) ok",[giveReq,own[0].id])).ok,true);
  assert.equal((await q("SELECT commerce_transfer($1,'g','b','a',$2,NULL) ok",[giveReq,own[0].id])).ok,true);
  await assert.rejects(q("SELECT commerce_transfer('00000000-0000-4000-8000-000000000011','g','b','a',$1,NULL)",[own[1].id]));
  await assert.rejects(q("SELECT commerce_fuse('00000000-0000-4000-8000-000000000012','g','b',$1)",[own[1].id]));
  const opponent=await q("SELECT id FROM captures WHERE user_id='a' LIMIT 1");
  const bid='00000000-0000-4000-8000-000000000013';
  let battle={guildId:'g',users:['a','b'],status:'invited',fighters:[null,null],deadline:Date.now()+300000};
  await q('SELECT commerce_save_battle($1,-1,$2,$3)',[bid,'a',JSON.stringify(battle)]);
  battle={...battle,status:'selecting',fighters:[{copyId:String(opponent.id),user:'a'},{copyId:String(own[1].id),user:'b'}]};
  await q('SELECT commerce_save_battle($1,0,$2,$3)',[bid,'b',JSON.stringify(battle)]);
  battle={...battle,status:'finished',winner:'b',turns:4};
  const won=(await q('SELECT commerce_save_battle($1,1,$2,$3) r',[bid,'b',JSON.stringify(battle)])).r;assert.equal(won.state.xp,50);
  await q('SELECT commerce_save_battle($1,1,$2,$3) r',[bid,'b',JSON.stringify(battle)]);
  assert.equal(Number((await q('SELECT experience FROM captures WHERE id=$1',[own[1].id])).experience),175);
  await db.exec("UPDATE commerce_accounts SET special=10 WHERE guild_id='g' AND user_id='b'");
  assert.equal((await action('cap','buy',{price:100,day:s.day,currency:'credits'},'b')).status,'capacity');
  await db.exec('RESET ROLE; SET ROLE anon');await assert.rejects(q("SELECT commerce_state('g','a')"));await assert.rejects(q('SELECT * FROM commerce_accounts'));
 }finally{await db.close();}
});

test('PayPal ignores unverified webhooks and never grants on a cancelled subscription',async()=>{
 let grants=0,verified=false;
 const store={query:async(table,method,body,filter)=>table==='commerce_config'?{value:{webhook:'WEBHOOK',personal:'PLAN'}}:{provider_id:'SUB',sku:'personal',id:'c',environment:'sandbox'},rpc:async()=>grants++};
 const p=loadModule('src/paypal.js',{'./commerceStore':store},{process:{env:{PAYPAL_ENV:'sandbox',PAYPAL_CLIENT_ID:'client',PAYPAL_CLIENT_SECRET:'secret'}},fetch:async url=>({ok:true,status:200,json:async()=>url.endsWith('/token')?{access_token:'token',expires_in:300}:url.endsWith('verify-webhook-signature')?{verification_status:verified?'SUCCESS':'FAILURE'}:{status:'CANCELLED',custom_id:'c',plan_id:'PLAN'}})});
 const headers=Object.fromEntries(['auth-algo','cert-url','transmission-id','transmission-sig','transmission-time'].map(k=>['paypal-'+k,'test']));
 const event={id:'EVENT',event_type:'BILLING.SUBSCRIPTION.CANCELLED',resource:{id:'SUB'}};
 await assert.rejects(p.webhook(headers,event));assert.equal(grants,0);verified=true;await p.webhook(headers,event);assert.equal(grants,0);
});
test('PayPal verifies capture identity, USD amount and completed status before granting',async()=>{
 let granted=0;const checkout={id:'checkout',provider_id:'ORDER',sku:'credits50',environment:'sandbox',guild_id:'g',user_id:'u'};
 const order={status:'COMPLETED',purchase_units:[{custom_id:'checkout',amount:{currency_code:'USD',value:'50.00'},payments:{captures:[{id:'CAPTURE',status:'COMPLETED',amount:{currency_code:'USD',value:'50.00'}}]}}]};
 const p=loadModule('src/paypal.js',{'./commerceStore':{rpc:async()=>{granted++;return {paid:true};}}},{process:{env:{PAYPAL_ENV:'sandbox',PAYPAL_CLIENT_ID:'client',PAYPAL_CLIENT_SECRET:'secret'}},fetch:async url=>({ok:true,status:200,json:async()=>url.endsWith('/token')?{access_token:'token',expires_in:300}:order})});
 assert.equal((await p.settle(checkout)).paid,true);assert.equal(granted,1);
 order.purchase_units[0].custom_id='another';await assert.rejects(p.settle(checkout));assert.equal(granted,1);
 order.purchase_units[0].custom_id='checkout';order.purchase_units[0].payments.captures[0].amount.value='1.00';await assert.rejects(p.settle(checkout));assert.equal(granted,1);
 order.status='CREATED';assert.equal((await p.settle(checkout)).pending,true);assert.equal(granted,1);
});
