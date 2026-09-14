const test=require('node:test');
const assert=require('node:assert/strict');
const {loadModule}=require('./helpers');
const {withLanguage}=require('../src/i18n');
function fixture(entries=[{id:6,name:'charizard',isShiny:false,count:5},{id:6,name:'charizard',isShiny:true,count:1}]) {
  const reads=[],edits=[],media=[];
  let now=1000;
  const manager=loadModule('src/pokemonViewManager.js',{
    './database':{getPokedexEntries:async(g,u)=>{reads.push([g,u]);return entries;}},
    './pokemonGallery':{getGallery:async(id,shiny)=>{media.push([id,shiny]);return [{kind:'artwork',url:'https://example.com/'+shiny+'.png'},{kind:'animation',url:'https://example.com/'+shiny+'.gif'}];}},
  },{Date:{now:()=>now}});
  const message={guild:{id:'guild'},author:{id:'owner',username:'Sekai'},reply:async()=>({id:'msg',edit:async p=>edits.push(p)})};
  const click=(customId,overrides={})=>({customId,user:{id:'owner'},guildId:'guild',message:{id:'msg'},update:async p=>edits.push(p),async reply(p){this.replied=p;},...overrides});
  return {manager,message,reads,edits,media,click,expire(){now+=600001;}};
}
test('personal gallery navigates artwork, GIF and owned shiny without more database calls',async()=>{
  const f=fixture();
  await f.manager.showPokemonView(f.message,'CHARIZARD');
  assert.deepEqual(f.reads,[['guild','owner']]);
  let p=f.edits.at(-1);
  assert.match(p.embeds[0].data.description,/5 normales · 1 shiny/);
  assert.match(p.embeds[0].data.footer.text,/1 \/ 4/);
  await f.manager.handlePokemonView(f.click(p.components[0].components[1].data.custom_id));
  p=f.edits.at(-1);assert.match(p.embeds[0].data.image.url,/\.gif$/);
  await f.manager.handlePokemonView(f.click(p.components[0].components[1].data.custom_id));
  assert.match(f.edits.at(-1).embeds[0].data.title,/✨/);
  assert.equal(f.reads.length,1);
});
test('gallery rejects foreign owners, guilds, messages, invalid pages and expired sessions',async()=>{
  const f=fixture();await f.manager.showPokemonView(f.message,'charizard');
  const id=f.edits.at(-1).components[0].components[1].data.custom_id;
  for(const overrides of [{user:{id:'other'}},{guildId:'other'},{message:{id:'other'}},{customId:id.replace(/:\d+$/,':999')}]) {
    const i=f.click(id,overrides);await f.manager.handlePokemonView(i);assert.ok(i.replied);
  }
  f.expire();const i=f.click(id);await f.manager.handlePokemonView(i);assert.match(i.replied.content,/expiró/);
});
test('unowned Pokémon or shiny never load media, while English shiny-only view works',async()=>{
  const f=fixture([{id:6,name:'charizard',isShiny:false,count:2}]);
  await f.manager.showPokemonView(f.message,'mew');
  await f.manager.showPokemonView(f.message,'charizard shiny');
  assert.equal(f.media.length,0);
  const shiny=fixture();
  await withLanguage('en',()=>shiny.manager.showPokemonView(shiny.message,'charizard shiny'));
  assert.deepEqual(shiny.media,[[6,true]]);
  assert.match(shiny.edits.at(-1).embeds[0].data.description,/Your collection/);
});
test('gallery caches metadata and never substitutes normal images for missing shiny media',async()=>{
  let calls=0;
  const gallery=loadModule('src/pokemonGallery.js',{'./network':{fetchWithTimeout:async()=>{calls++;return {ok:true,json:async()=>({sprites:{front_default:'https://example.com/normal.png',other:{showdown:{front_default:'https://example.com/normal.gif'}}}})};}}});
  const normal=await gallery.getGallery(6,false);
  assert.equal(normal[0].kind,'animation');
  const shiny=await gallery.getGallery(6,true);
  assert.equal(calls,1);assert.match(shiny[0].url,/shiny\/6.png/);
});
test('gallery has a static fallback when the media provider fails',async()=>{
  const gallery=loadModule('src/pokemonGallery.js',{'./network':{fetchWithTimeout:async()=>{throw Error('timeout');}}});
  assert.match((await gallery.getGallery(502,true))[0].url,/shiny\/502.png/);
});

test('pkvw and pvw aliases route names and shiny arguments before other commands',async()=>{
  const calls=[];
  const event=loadModule('src/events/messageCreate.js',{
    '../spawnManager':{},'../puzzleManager':{},'../database':{getGuildSettings(){throw Error('Wrong route');}},
    '../pokemonViewManager':{showPokemonView:async(m,name)=>calls.push(name)},
  });
  for(const content of ['$pkvw charizard','$pvw charizard shiny','$PKVW Mr. Mime'])
    await event.execute({content,author:{bot:false},guild:{}},{});
  assert.deepEqual(calls,['charizard','charizard shiny','Mr. Mime']);
});
