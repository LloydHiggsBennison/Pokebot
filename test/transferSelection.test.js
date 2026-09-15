const test=require('node:test'),assert=require('node:assert/strict');
const {loadModule}=require('./helpers');
const {MessageFlags}=require('discord.js');
function fixture(trade=true){
 const sent=[],offers=[];
 const copies=Array.from({length:25},(_,i)=>({id:i+1,pokemon_id:6,pokemon_name:'charizard',is_shiny:0,level:i+5,iv_total:i}));
 const target={id:80,pokemon_id:9,pokemon_name:'blastoise',is_shiny:0,level:25,iv_total:100};
 const manager=loadModule('src/transferSelection.js',{
  './guildMembers':{resolveMention:async()=>({id:'222'})},
  './database':{getPokedexEntries:async(g,u)=>u==='111'?[{id:6,isShiny:false,copies}]:[{id:9,isShiny:false,copies:[target]}]},
  './progressionStore':{getCopy:async(g,u,id)=>u==='111'?copies.find(c=>String(c.id)===id):String(target.id)===id?target:null},
  './transferManager':{parsePokemon:text=>({id:text==='charizard'?6:9,isShiny:false}),showTransfer:async(m,c,selected)=>offers.push(selected)},
 });
 const message={guild:{id:'g'},channel:{id:'c'},author:{id:'111'},async reply(payload){const m={id:'public',payload,async edit(p){this.payload=p;}};sent.push(m);return m;}};
 const click=(id,user='111',msg='public')=>({customId:id,guildId:'g',user:{id:user},message:{id:msg},async deferReply(p){this.flags=p.flags;},async deferUpdate(){},async editReply(p){this.payload=p;return {id:'private-'+user};},async reply(p){this.refused=p;}});
 return {manager,message,sent,offers,click,content:trade?'$poketrade <@222> charizard / blastoise':'$pokegive <@222> charizard'};
}
test('both traders choose exact copies privately across pages before confirmation offer',async()=>{
 const f=fixture();await f.manager.showSelection(f.message,f.content);
 const openId=f.sent[0].payload.components[0].components[0].data.custom_id;
 const wrong=f.click(openId,'222');await f.manager.handleSelection(wrong);assert.ok(wrong.refused);
 const a=f.click(openId);await f.manager.handleSelection(a);assert.equal(a.flags,MessageFlags.Ephemeral);
 assert.match(a.payload.components[0].components[0].toJSON().options[0].description,/IV/);
 a.customId=a.payload.components[1].components[1].data.custom_id;a.message.id='private-111';await f.manager.handleSelection(a);
 assert.equal(a.payload.components[0].components[0].toJSON().options[0].value,'21');
 a.customId=a.payload.components[0].components[0].data.custom_id;a.values=['24'];await f.manager.handleSelection(a);assert.equal(f.offers.length,0);
 const b=f.click(f.sent[0].payload.components[0].components[0].data.custom_id,'222');await f.manager.handleSelection(b);
 b.customId=b.payload.components[0].components[0].data.custom_id;b.message.id='private-222';b.values=['80'];await f.manager.handleSelection(b);
 assert.equal(f.offers.length,1);assert.equal(f.offers[0].give.id,24);assert.equal(f.offers[0].take.id,80);
 await f.manager.handleSelection(b);assert.equal(f.offers.length,1);
});
test('gift selects donor copy and rejects forged copy IDs without creating an offer',async()=>{
 const f=fixture(false);await f.manager.showSelection(f.message,f.content);
 const a=f.click(f.sent[0].payload.components[0].components[0].data.custom_id);await f.manager.handleSelection(a);
 a.customId=a.payload.components[0].components[0].data.custom_id;a.message.id='private-111';a.values=['999'];await f.manager.handleSelection(a);assert.equal(f.offers.length,0);
 a.values=['7'];await f.manager.handleSelection(a);assert.equal(f.offers.length,1);assert.equal(f.offers[0].give.id,7);assert.equal(f.offers[0].take,undefined);
});
