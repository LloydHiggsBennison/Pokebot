const test=require('node:test'),assert=require('node:assert/strict');
const {loadModule}=require('./helpers');
const {MessageFlags}=require('discord.js');
function fixture(){
 const edits=[],fused=[],reveals=[];
 const candidates=Array.from({length:45},(_,i)=>({id:i+1,name:'pokemon'+(i+1),count:25}));
 const manager=loadModule('src/fusionSelection.js',{
  './database':{getFuseCandidates:async(g,u)=>{assert.equal(g,'g');assert.equal(u,'u');return candidates;}},
  './progressionStore':{
   copyPage:async(g,u,o)=>({total:25,rows:Array.from({length:o.page?5:20},(_,i)=>({id:o.page*20+i+1,pokemon_id:o.species,pokemon_name:'bulbasaur',level:5+i,experience:125}))}),
   fuseSelected:async(...args)=>{fused.push(args);return {id:1,pokemon_id:1,pokemon_name:'bulbasaur',level:5,is_shiny:1};},
  },
  './pokefuseManager':{revealFusion:async(...args)=>reveals.push(args)},
 });
 const i={customId:'pokefuse-open:u:0',guildId:'g',user:{id:'u'},message:{id:'private'},
   async deferReply(p){this.flags=p.flags;},async deferUpdate(){this.deferred=true;},async editReply(p){edits.push(p);return {id:'private'};},async reply(p){this.replied=p;}};
 return {manager,edits,fused,reveals,i};
}
test('fusion privately paginates all species then individual levelled copies; only final selection writes',async()=>{
 const f=fixture();await f.manager.openPrivateFuse(f.i);
 assert.equal(f.i.flags,MessageFlags.Ephemeral);
 let p=f.edits.at(-1);assert.equal(p.components[0].components[0].toJSON().options.length,20);
 f.i.customId=p.components[1].components[1].data.custom_id;await f.manager.handleFuseSelect(f.i);
 p=f.edits.at(-1);assert.equal(p.components[0].components[0].toJSON().options[0].value,'21');
 f.i.customId=p.components[0].components[0].data.custom_id;f.i.values=['21'];await f.manager.handleFuseSelect(f.i);
 p=f.edits.at(-1);assert.match(p.components[0].components[0].toJSON().options[0].label,/Lv./);assert.equal(f.fused.length,0);
 f.i.customId=p.components[1].components[1].data.custom_id;await f.manager.handleFuseSelect(f.i);
 p=f.edits.at(-1);assert.equal(p.components[0].components[0].toJSON().options[0].value,'21');
 f.i.customId=p.components[0].components[0].data.custom_id;f.i.values=['21'];await f.manager.handleFuseSelect(f.i);
 assert.equal(f.fused.length,1);assert.equal(f.fused[0][2],'21');assert.equal(f.reveals.length,1);
 await f.manager.handleFuseSelect(f.i);assert.equal(f.fused.length,1);
});
test('fusion ownership checks protect private menus',async()=>{
 const f=fixture();f.i.user.id='other';await f.manager.openPrivateFuse(f.i);
 assert.equal(f.i.replied.flags,MessageFlags.Ephemeral);assert.equal(f.edits.length,0);
 f.i.user.id='u';await f.manager.openPrivateFuse(f.i);
 f.i.customId=f.edits.at(-1).components[0].components[0].data.custom_id;f.i.values=['1'];f.i.user.id='other';
 await f.manager.handleFuseSelect(f.i);assert.equal(f.fused.length,0);assert.equal(f.edits.length,1);
});
test('animation failure still confirms completed transformation and allows replay without a database call',async()=>{
 let calls=0;
 const manager=loadModule('src/pokefuseManager.js',{'./fusionSelection':{},'./fusionAnimation':{getFusionAnimation:async()=>{if(++calls===1)throw Error('media unavailable');return Buffer.from('GIF89a');}}});
 const i={user:{id:'u'},guildId:'g',message:{id:'m'},async editReply(p){this.payload=p;},async deferUpdate(){}};
 await manager.revealFusion(i,{id:6,name:'charizard'});
 assert.match(i.payload.content,/Fusión completada/);
 i.customId=i.payload.components[0].components[0].data.custom_id;
 await manager.handleFuseReplay(i);assert.equal(i.payload.files[0].name,'pokefuse.gif');assert.equal(calls,2);
});
