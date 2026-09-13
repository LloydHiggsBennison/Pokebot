const { randomInt, randomUUID } = require('node:crypto');
const species = require('../data/species-rarity.json');
const COINS = Object.freeze({common:10,uncommon:20,rare:35,legendary:150,mythical:300});
function rarityFor(id) {
  const s=species[id];
  if(!s) throw new Error('Unknown species');
  return s.mythical?'mythical':s.legendary?'legendary':s.captureRate<=45?'rare':s.captureRate<=120?'uncommon':'common';
}
function createEncounter(pokemon,channelId) {
  const rarity=rarityFor(pokemon.id);
  const ivTotal=Array.from({length:6},()=>randomInt(32)).reduce((a,b)=>a+b,0);
  return {...pokemon,channelId,encounterId:randomUUID(),level:randomInt(1,101),ivTotal,rarity,coins:COINS[rarity]};
}
module.exports={rarityFor,createEncounter,COINS};

