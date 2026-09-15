const {createHash}=require('node:crypto');
const {selectPokemon}=require('./pokemonSelection');
const {rarityFor}=require('./wildRewards');
const PRICES=Object.freeze({common:100,uncommon:250,rare:1000,legendary:5000,mythical:10000});
const HOUR=3600000;
function marketRotation(){return Math.floor(Date.now()/HOUR);}
function marketOffers(guild,rotation=marketRotation()){
  let seed=createHash('sha256').update('pokemarket:v1:'+guild+':'+rotation).digest().readUInt32LE(0);
  const random=()=>{seed=(Math.imul(1664525,seed)+1013904223)>>>0;return seed/4294967296;};
  return selectPokemon(6,random).map((p,index)=>({...p,slot:index+1,rarity:rarityFor(p.id),price:PRICES[rarityFor(p.id)]}));
}
module.exports={marketOffers,marketRotation,PRICES,HOUR};
