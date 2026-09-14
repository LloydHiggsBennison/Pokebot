const { fetchWithTimeout } = require('./network');
const cache = new Map(), pending = new Map();
async function getSprites(id) {
  if(cache.has(id)) return cache.get(id);
  if(pending.has(id)) return pending.get(id);
  const task = (async()=>{
    const response = await fetchWithTimeout('https://pokeapi.co/api/v2/pokemon/'+id,{},4000);
    if(!response.ok) throw new Error('PokéAPI HTTP '+response.status);
    const sprites = (await response.json()).sprites;
    if(!sprites) throw new Error('No sprites');
    if(cache.size>=200) cache.delete(cache.keys().next().value);
    cache.set(id,sprites);
    return sprites;
  })().finally(()=>pending.delete(id));
  pending.set(id,task);
  return task;
}
async function getGallery(id,isShiny) {
  const pages = [];
  const add = (kind,url) => {if(url && !pages.some(p=>p.url===url)) pages.push({kind,url});};
  try {
    const sprites = await getSprites(id);
    const key = isShiny?'front_shiny':'front_default';
    add('animation',sprites.other?.showdown?.[key] || sprites.versions?.['generation-v']?.['black-white']?.animated?.[key]);
    add('artwork',sprites.other?.['official-artwork']?.[key]);
    add('home',sprites.other?.home?.[key]);
    add('sprite',sprites[key]);
    add('back',sprites[isShiny?'back_shiny':'back_default']);
  } catch(error) { console.warn('[Pvw sprites]',id,error.message); }
  if(!pages.length) add('sprite','https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/'+(isShiny?'shiny/':'')+id+'.png');
  return pages;
}
module.exports = {getGallery};
