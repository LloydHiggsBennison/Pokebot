const catalog = require('../data/pokemon.json');
const { rarityFor } = require('./wildRewards');
const RARITY_WEIGHTS = Object.freeze({common:800,uncommon:170,rare:25,legendary:4,mythical:1});
const buckets = Object.entries(RARITY_WEIGHTS).map(([rarity,weight]) => ({
  weight, species:catalog.filter(p => rarityFor(p.id) === rarity),
}));
function selectPokemon(count = 1) {
  if (!Number.isInteger(count) || count < 1 || count > catalog.length) throw new RangeError('Cantidad inválida de Pokémon para la tirada.');
  const available = buckets.map(bucket => ({weight:bucket.weight,species:[...bucket.species]}));
  const selected = [];
  for(let i=0;i<count;i++) {
    const eligible = available.filter(bucket => bucket.species.length);
    let target = Math.random()*eligible.reduce((sum,bucket)=>sum+bucket.weight,0);
    let bucket = eligible[eligible.length-1];
    for(const current of eligible) {
      target -= current.weight;
      if(target < 0) { bucket=current;break; }
    }
    const index = Math.floor(Math.random()*bucket.species.length);
    selected.push(bucket.species[index]);
    bucket.species[index] = bucket.species[bucket.species.length-1];
    bucket.species.pop();
  }
  return selected;
}
module.exports = {selectPokemon,RARITY_WEIGHTS};
