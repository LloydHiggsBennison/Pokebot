// Reproducible compact battle catalog sourced from PokeAPI's public CSV dataset.
const fs=require('node:fs/promises'),path=require('node:path');
const root=path.join(__dirname,'..'),cache=path.join(root,'..','battle-source');
async function rows(name){
  const file=path.join(cache,name+'.csv');let text;
  try{text=await fs.readFile(file,'utf8');}catch{
    const r=await fetch('https://raw.githubusercontent.com/PokeAPI/pokeapi/master/data/v2/csv/'+name+'.csv',{signal:AbortSignal.timeout(60000)});
    if(!r.ok)throw Error(name+' '+r.status);text=await r.text();await fs.mkdir(cache,{recursive:true});await fs.writeFile(file,text);
  }
  const lines=text.trim().split(/\r?\n/),keys=lines.shift().split(',');
  return lines.map(line=>Object.fromEntries(line.split(',').map((v,i)=>[keys[i],v])));
}
(async()=>{
  const [stats,types,moves,names,learnsets,efficacy,versions]=await Promise.all(['pokemon_stats','pokemon_types','moves','move_names','pokemon_moves','type_efficacy','version_groups'].map(rows));
  const species={};for(let id=1;id<=1025;id++)species[id]={stats:[],types:[],learn:[]};
  for(const r of stats)if(species[r.pokemon_id])species[r.pokemon_id].stats[Number(r.stat_id)-1]=Number(r.base_stat);
  for(const r of types)if(species[r.pokemon_id])species[r.pokemon_id].types.push(Number(r.type_id));
  const catalog={};
  for(const m of moves) catalog[m.id]={id:Number(m.id),name:m.identifier,es:m.identifier,type:Number(m.type_id),power:Number(m.power)||0,accuracy:Number(m.accuracy)||100,damageClass:Number(m.damage_class_id),pp:Number(m.pp)||5};
  for(const r of names)if(catalog[r.move_id]&&r.local_language_id==='7')catalog[r.move_id].es=r.name.replace(/^"|"$/g,'');
  // Level-up moves from the most recent game version containing each species.
  const version={};
  const rank=Object.fromEntries(versions.map(v=>[v.id,Number(v.generation_id)*100+Number(v.order)]));
  for(const r of learnsets)if(species[r.pokemon_id]&&r.pokemon_move_method_id==='1'&&(rank[r.version_group_id]>(rank[version[r.pokemon_id]]||0)))version[r.pokemon_id]=Number(r.version_group_id);
  for(const r of learnsets)if(species[r.pokemon_id]&&r.pokemon_move_method_id==='1'&&Number(r.version_group_id)===version[r.pokemon_id]){
    const s=species[r.pokemon_id],id=Number(r.move_id),level=Number(r.level);
    const old=s.learn.find(m=>m[0]===id);if(!old)s.learn.push([id,level]);else old[1]=Math.min(old[1],level);
  }
  // Machine/tutor/egg moves only as species-valid candidates when level-up slots are missing.
  for(const r of learnsets)if(species[r.pokemon_id]&&Number(r.version_group_id)===version[r.pokemon_id]&&catalog[r.move_id]){
    const s=species[r.pokemon_id],id=Number(r.move_id);if(!s.learn.some(m=>m[0]===id))s.learn.push([id,101]);
  }
  const matrix={};for(const r of efficacy)matrix[r.damage_type_id+':'+r.target_type_id]=Number(r.damage_factor)/100;
  for(const [id,s] of Object.entries(species))if(s.stats.length!==6||!s.types.length)throw Error('Missing species '+id);
  await fs.writeFile(path.join(root,'data','battle-data.json'),JSON.stringify({species,moves:catalog,efficacy:matrix}));
  console.log(JSON.stringify({species:Object.keys(species).length,moves:Object.keys(catalog).length,emptyLearnsets:Object.entries(species).filter(([,s])=>!s.learn.length).map(([id])=>id)}));
})().catch(e=>{console.error(e);process.exitCode=1;});
