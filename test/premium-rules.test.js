const test=require('node:test'),assert=require('node:assert/strict');
const {limits,battleExperience,canStoreSpecialRolls,SHINY_CHANCE}=require('../src/premiumRules');
test('server and personal subscriptions stack rolls but only personal unlocks features',()=>{
  assert.equal(limits().rolls,1);
  assert.equal(limits({server:true}).rolls,3);
  assert.equal(limits({personal:true}).rolls,3);
  assert.equal(limits({server:true,personal:true}).rolls,5);
  assert.equal(limits().windowMs,600000);
  assert.equal(limits({server:true}).canFuse,false);
  assert.equal(limits({server:true}).canTrade,false);
  assert.equal(limits({personal:true}).canFuse,true);
  assert.equal(limits({personal:true}).canTrade,true);
  assert.equal(limits({server:true}).giftsPerDay,1);
  assert.equal(limits({personal:true}).giftsPerDay,5);
});
test('non-premium XP is half, including odd rewards, and inventories cannot overflow',()=>{
  assert.equal(battleExperience(100),50);
  assert.equal(battleExperience(25),12.5);
  assert.equal(battleExperience(25,true),25);
  assert.equal(canStoreSpecialRolls(9,1),true);
  assert.equal(canStoreSpecialRolls(10,1),false);
  assert.equal(canStoreSpecialRolls(49,1,true),true);
  assert.equal(canStoreSpecialRolls(50,1,true),false);
  assert.equal(canStoreSpecialRolls(40,1,false),false);
  assert.equal(canStoreSpecialRolls(0,-1),false);
  assert.equal(SHINY_CHANCE,0.05);
});
