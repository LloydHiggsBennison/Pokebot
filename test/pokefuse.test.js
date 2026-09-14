const test = require('node:test');
const assert = require('node:assert/strict');
const { MessageFlags } = require('discord.js');
const { loadModule, fakeMessage, fakeClient, fakeDatabase } = require('./helpers');

function fixture(animation = async () => Buffer.from('GIF89a')) {
  const db = fakeDatabase();
  for (let i = 0; i < 5; i++) db.captures.push({ guildId: 'guild', userId: 'owner', id: 25, name: 'pikachu', isShiny: false });
  for (let i = 0; i < 4; i++) db.captures.push({ guildId: 'guild', userId: 'other', id: 25, name: 'pikachu', isShiny: false });
  const manager = loadModule('src/pokefuseManager.js', {
    './database': db,
    './fusionAnimation': { getFusionAnimation: animation },
    './emojiManager': { getPreparedEmoji() { return '<:pkv2_25:123>'; } },
  });
  const client = fakeClient().client;
  const message = fakeMessage(client, 'owner');
  message.guild.id = 'guild';
  message.author.username = 'owner';
  const interactions = [];
  const reply = async payload => { const sent = { id: 'fuse-message', payload, async edit(next) { this.payload = next; } }; interactions.push(sent); return sent; };
  message.reply = reply;
  return { db, manager, message, interactions };
}

test('fusion by name skips menu and consumes only the requesting users copies',async()=>{
  const f=fixture();
  await f.manager.showFuse(f.message,'PIKACHU');
  assert.match(f.interactions[0].payload.content,/Fusión completada/);
  assert.equal(f.db.captures.filter(p=>p.userId==='owner'&&!p.isShiny).length,1);
  assert.equal(f.db.captures.filter(p=>p.userId==='owner'&&p.isShiny).length,1);
  assert.equal(f.db.captures.filter(p=>p.userId==='other').length,4);
});

test('unknown fusion name never consumes another species',async()=>{
  const f=fixture();
  await f.manager.showFuse(f.message,'charizard');
  assert.equal(f.db.captures.filter(p=>p.userId==='owner').length,5);
  assert.match(f.interactions[0].payload,/nombre no es válido/);
});

test('$pokefuse only offers normal species with five copies', async () => {
  const f = fixture();
  await f.manager.showFuse(f.message);
  assert.equal(f.interactions.length, 1);
  const payload = f.interactions[0].payload;
  assert.match(payload.embeds[0].data.title, /Fusión/);
  assert.match(payload.embeds[0].data.fields[0].value, /Pikachu.*x5/);
  assert.equal(payload.components[0].components[0].toJSON().options[0].value, '25');
});

test('fusion consumes exactly four normals and creates one shiny', async () => {
  const f = fixture();
  await f.manager.showFuse(f.message);
  const token = f.interactions[0].payload.components[0].components[0].data.custom_id.split(':')[1];
  const interaction = { customId: `pokefuse:${token}`, values: ['25'], user: { id: 'owner' }, guildId: 'guild', message: { id: 'fuse-message' },
    async deferUpdate() { this.deferred = true; },
    async editReply(payload) { assert.equal(this.deferred, true); this.updated = payload; }, async reply(payload) { this.replied = payload; } };
  await f.manager.handleFuseSelect(interaction);
  assert.equal(f.db.captures.filter(p => p.guildId === 'guild' && p.userId === 'owner' && p.id === 25 && !p.isShiny).length, 1);
  assert.equal(f.db.captures.filter(p => p.guildId === 'guild' && p.userId === 'owner' && p.id === 25 && p.isShiny).length, 1);
  assert.match(interaction.updated.content, /consumieron 4/);
  assert.equal(interaction.updated.components.length, 1);
});

test('fusion selector is owner-only and duplicate clicks cannot consume twice', async () => {
  const f = fixture();
  await f.manager.showFuse(f.message);
  const token = f.interactions[0].payload.components[0].components[0].data.custom_id.split(':')[1];
  const base = { customId: `pokefuse:${token}`, values: ['25'], guildId: 'guild', message: { id: 'fuse-message' }, async deferUpdate() { this.deferred = true; }, async editReply(p) { this.updated = p; }, async reply(p) { this.replied = p; } };
  const other = { ...base, user: { id: 'other' } };
  await f.manager.handleFuseSelect(other);
  assert.equal(other.replied.flags, MessageFlags.Ephemeral);
  assert.equal(f.db.captures.filter(p => p.userId === 'owner').length, 5);
  const first = { ...base, user: { id: 'owner' } };
  await f.manager.handleFuseSelect(first);
  const second = { ...base, user: { id: 'owner' } };
  await f.manager.handleFuseSelect(second);
  assert.match(second.replied?.content || second.updated?.content || '', /expiró|cinco|consumir/);
  assert.equal(f.db.captures.filter(p => p.userId === 'owner' && p.isShiny).length, 1);
});

test('cannot fuse shiny copies as ingredients', async () => {
  const f = fixture();
  f.db.captures.splice(0, f.db.captures.length, ...f.db.captures.filter(p => p.userId !== 'owner'));
  for (let i = 0; i < 10; i++) f.db.captures.push({ guildId: 'guild', userId: 'owner', id: 25, name: 'pikachu', isShiny: true });
  const replies = [];
  f.message.reply = async payload => { replies.push(payload); return { id: 'fuse-message' }; };
  await f.manager.showFuse(f.message);
  assert.match(replies[0], /Aún no tienes/);
  assert.doesNotMatch(replies[0], /Pikachu/);
});

test('animation failure still confirms the saved shiny without consuming again',async()=>{
  const f=fixture(async()=>{throw new Error('Sprite unavailable');});
  await f.manager.showFuse(f.message);
  const customId=f.interactions[0].payload.components[0].components[0].data.custom_id;
  const i={customId,values:['25'],user:{id:'owner'},guildId:'guild',message:{id:'fuse-message'},
    async deferUpdate(){this.deferred=true;},async editReply(p){this.updated=p;}};
  await f.manager.handleFuseSelect(i);
  assert.match(i.updated.content,/Fusión completada/);
  assert.equal(f.db.captures.filter(p=>p.userId==='owner'&&p.isShiny).length,1);
  assert.equal(f.db.captures.filter(p=>p.userId==='owner'&&!p.isShiny).length,1);
});

test('a failed save never plays the shiny animation',async()=>{
  let renders=0;const f=fixture(async()=>{renders++;return Buffer.from('GIF89a');});
  // Mutate before reloading the module so its destructured dependency is the failing write.
  f.db.fusePokemon=async()=>{throw new Error('Database unavailable');};
  const manager=loadModule('src/pokefuseManager.js',{
    './database':f.db,'./emojiManager':{getPreparedEmoji:()=>''},
    './fusionAnimation':{getFusionAnimation:async()=>{renders++;}},
  });
  await manager.showFuse(f.message);
  const customId=f.interactions[0].payload.components[0].components[0].data.custom_id;
  const i={customId,values:['25'],user:{id:'owner'},guildId:'guild',message:{id:'fuse-message'},
    async deferUpdate(){this.deferred=true;},async editReply(p){this.updated=p;}};
  await assert.rejects(manager.handleFuseSelect(i));
  assert.equal(renders,0);
  assert.equal(f.db.captures.filter(p=>p.userId==='owner').length,5);
  assert.match(i.updated.content,/No se pudo confirmar/);
});

test('animation retry is owner-only and never changes captures',async()=>{
  let renders=0;
  const f=fixture(async()=>++renders===1?null:Buffer.from('GIF89a'));
  await f.manager.showFuse(f.message);
  const i={customId:f.interactions[0].payload.components[0].components[0].data.custom_id,
    values:['25'],user:{id:'owner'},guildId:'guild',message:{id:'fuse-message'},
    async deferUpdate(){this.deferred=true;},async editReply(p){this.updated=p;},async reply(p){this.replied=p;}};
  await f.manager.handleFuseSelect(i);
  assert.match(i.updated.content,/No se pudo mostrar/);
  const customId=i.updated.components[0].components[0].data.custom_id;
  const saved=JSON.stringify(f.db.captures);
  const other={...i,customId,user:{id:'other'},deferred:false};
  await f.manager.handleFuseReplay(other);
  assert.equal(other.replied.flags,MessageFlags.Ephemeral);
  assert.equal(renders,1);
  const owner={...i,customId,deferred:false};
  await f.manager.handleFuseReplay(owner);
  assert.equal(renders,2);
  assert.equal(owner.updated.files[0].name,'pokefuse.gif');
  assert.equal(JSON.stringify(f.db.captures),saved);
});
