const {randomInt}=require('node:crypto');
const pokemon=require('../data/pokemon.json');
const {rarityFor}=require('./wildRewards');
const PRICES=Object.freeze([100,200,400,600,800,1000,2000]);
const PRODUCTS=Object.freeze({
 personal:Object.freeze({kind:'subscription',usd:'5.00',scope:'user'}),
 server:Object.freeze({kind:'subscription',usd:'10.00',scope:'guild'}),
 credits1:Object.freeze({kind:'order',usd:'1.00',credits:300}),
 credits5:Object.freeze({kind:'order',usd:'5.00',credits:700}),
 credits10:Object.freeze({kind:'order',usd:'10.00',credits:1300}),
 credits20:Object.freeze({kind:'order',usd:'20.00',credits:2100}),
 credits50:Object.freeze({kind:'order',usd:'50.00',credits:10000,legendary:5,mythical:1}),
});
const pools=Object.fromEntries(['rare','legendary','mythical'].map(r=>[r,pokemon.filter(p=>rarityFor(p.id)===r)]));
function ticketReward(kind,random=randomInt){
 let rarity,isShiny=false;
 if(kind==='legendary'){rarity='legendary';isShiny=true;}
 else if(kind==='mythical')rarity='mythical';
 else if(kind==='special'){
  // Preserve the existing relative rarity weights, excluding common/uncommon.
  const roll=random(30);rarity=roll<25?'rare':roll<29?'legendary':'mythical';isShiny=random(100)<5;
 }else throw Error('Invalid ticket type');
 const p=pools[rarity][random(pools[rarity].length)];
 return {...p,rarity,isShiny};
}
module.exports={PRICES,PRODUCTS,ticketReward};
