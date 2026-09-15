const test=require('node:test'),assert=require('node:assert/strict');
const {loadModule}=require('./helpers');
const {PermissionFlagsBits,MessageFlags}=require('discord.js');
test('sleep and wake persist only enabled and acknowledge privately before writes',async()=>{
  const writes=[],restarts=[];let deferred=false;
  const {command}=loadModule('src/wildControl.js',{
    './database':{getGuildSettings:async()=>({spawn_channel_id:'c',mode:'messages',msg_min:10,msg_max:50}),
      updateGuildSettings:async(g,p)=>{assert.ok(deferred);writes.push([g,p]);}},
    './spawnManager':{restartTimeSpawner:async(c,g)=>restarts.push(g)},
  });
  const i={guildId:'g',memberPermissions:{has:p=>p===PermissionFlagsBits.ManageGuild},
    async deferReply(p){assert.equal(p.flags,MessageFlags.Ephemeral);deferred=true;},async editReply(p){this.result=p;}};
  await command(false).execute(i);assert.match(i.result,/pausadas/);
  await command(true).execute(i);assert.match(i.result,/reactivados/);
  assert.deepEqual(JSON.parse(JSON.stringify(writes)),[['g',{enabled:0}],['g',{enabled:1}]]);
  assert.deepEqual(restarts,['g','g']);
  assert.equal(command(false).data.toJSON().name,'pokesleep');
});
test('wild controls deny non-managers and wake requires a configured channel',async()=>{
  let writes=0;
  const {command}=loadModule('src/wildControl.js',{
    './database':{getGuildSettings:async()=>({spawn_channel_id:null}),updateGuildSettings:async()=>writes++},
    './spawnManager':{restartTimeSpawner:async()=>{}},
  });
  const i={guildId:'g',memberPermissions:{has:()=>false},async reply(p){this.result=p.content;},async deferReply(){},async editReply(p){this.result=p;}};
  await command(false).execute(i);assert.match(i.result,/permiso/);
  i.memberPermissions.has=()=>true;await command(true).execute(i);assert.match(i.result,/canal/);assert.equal(writes,0);
});
