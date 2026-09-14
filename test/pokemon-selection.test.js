const test=require('node:test');
const assert=require('node:assert/strict');
const {loadModule}=require('./helpers');
const {rarityFor}=require('../src/wildRewards');
test('weighted draws match reduced rarity odds across rolls and keep species obtainable',()=>{
  let seed=12345;
  const math=Object.create(Math);
  math.random=()=>{seed=(1664525*seed+1013904223)>>>0;return seed/4294967296;};
  const {selectPokemon,RARITY_WEIGHTS}=loadModule('src/pokemonSelection.js',{}, {Math:math});
  const counts={common:0,uncommon:0,rare:0,legendary:0,mythical:0};
  for(let i=0;i<10000;i++) {
    const batch=selectPokemon(15);
    assert.equal(new Set(batch.map(p=>p.id)).size,15);
    for(const p of batch) counts[rarityFor(p.id)]++;
  }
  for(const [key,weight] of Object.entries(RARITY_WEIGHTS))
    assert.ok(Math.abs(counts[key]/150000-weight/1000)<0.003,key+': '+counts[key]);
  assert.equal(new Set(selectPokemon(1025).map(p=>p.id)).size,1025);
});
test('wild spawns use the shared weighted selector',()=>{
  const service=loadModule('src/pokemonService.js',{'./pokemonSelection':{selectPokemon:()=>[{id:6,name:'charizard',spriteUrl:'https://example.com/6.png'}]}});
  assert.equal(service.getRandomPokemon().id,6);
});
