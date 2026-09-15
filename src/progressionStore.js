const {storage:{supabase,sqlite}}=require('./database');
const {randomUUID}=require('node:crypto');
if(sqlite)require('./progressionSqlite').initialize(sqlite);
async function copyPage(guild,user,{species=null,normalOnly=false,page=0}={}){
  const size=20;
  if(!supabase){
    const where='guild_id=? AND user_id=?'+(species?' AND pokemon_id=?':'')+(normalOnly?' AND is_shiny=0':'');
    const args=[guild,user,...(species?[species]:[])];
    const total=sqlite.prepare('SELECT count(*) AS n FROM captures WHERE '+where).get(...args).n;
    const rows=sqlite.prepare('SELECT * FROM captures WHERE '+where+' ORDER BY id LIMIT ? OFFSET ?').all(...args,size,page*size);
    return {rows,total};
  }
  let q=supabase.from('captures').select('*',{count:'exact'}).eq('guild_id',guild).eq('user_id',user);
  if(species)q=q.eq('pokemon_id',species);if(normalOnly)q=q.eq('is_shiny',0);
  const {data,error,count}=await q.order('id').range(page*size,page*size+size-1);
  if(error)throw error;return {rows:data||[],total:count||0};
}
async function getCopy(guild,user,id){
  if(!supabase)return sqlite.prepare('SELECT * FROM captures WHERE guild_id=? AND user_id=? AND id=?').get(guild,user,id);
  const {data,error}=await supabase.from('captures').select('*').eq('guild_id',guild).eq('user_id',user).eq('id',id).maybeSingle();
  if(error)throw error;return data;
}
async function fuseSelected(guild,user,id,request=randomUUID()){
  if(!supabase)return require('./progressionSqlite').fuse(sqlite,guild,user,id,request);
  const {data,error}=await supabase.rpc('fuse_selected_pokemon',{p_request:request,p_guild:guild,p_user:user,p_capture:id});
  if(error)throw error;return data;
}
async function getBattle(id){
  if(!supabase){const r=sqlite.prepare('SELECT * FROM pokemon_battles WHERE id=?').get(id);return r?{state:JSON.parse(r.state),revision:r.revision}:null;}
  const {data,error}=await supabase.from('pokemon_battles').select('state,revision').eq('id',id).maybeSingle();if(error)throw error;return data;
}
async function saveBattle(id,revision,actor,state){
  if(!supabase)return require('./progressionSqlite').save(sqlite,id,revision,actor,state);
  const {data,error}=await supabase.rpc('save_pokemon_battle',{p_id:id,p_expected:revision,p_actor:actor,p_state:state});
  if(error)throw error;return data;
}
async function expiredBattles(){
  if(!supabase)return sqlite.prepare("SELECT id,state,revision FROM pokemon_battles WHERE status IN ('invited','selecting','active') AND deadline<=? LIMIT 50").all(Date.now()).map(r=>({...r,state:JSON.parse(r.state)}));
  const {data,error}=await supabase.from('pokemon_battles').select('id,state,revision').in('status',['invited','selecting','active']).lte('deadline',Date.now()).limit(50);
  if(error)throw error;return data||[];
}
module.exports={copyPage,getCopy,fuseSelected,getBattle,saveBattle,expiredBattles};
