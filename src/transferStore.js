const {storage:{supabase,sqlite}}=require('./database');
if(sqlite) sqlite.exec('CREATE TABLE IF NOT EXISTS pokemon_transfers (request_id TEXT PRIMARY KEY, payload TEXT NOT NULL)');

async function findCapture(guild,user,pokemonId,isShiny) {
  if(!supabase) return sqlite.prepare('SELECT * FROM captures WHERE guild_id=? AND user_id=? AND pokemon_id=? AND is_shiny=? ORDER BY id LIMIT 1').get(guild,user,pokemonId,isShiny?1:0);
  const {data,error}=await supabase.from('captures').select('id,pokemon_id,pokemon_name,is_shiny')
    .eq('guild_id',guild).eq('user_id',user).eq('pokemon_id',pokemonId).eq('is_shiny',isShiny?1:0).order('id').limit(1).maybeSingle();
  if(error) throw error;
  return data;
}
async function transferPokemon(offer) {
  const params={p_request_id:offer.id,p_guild_id:offer.guildId,p_sender_id:offer.senderId,p_receiver_id:offer.receiverId,
    p_give_id:String(offer.give.id),p_take_id:offer.take?String(offer.take.id):null};
  if(supabase) {
    const {data,error}=await supabase.rpc('transfer_pokemon',params);
    if(error) throw error;
    return data;
  }
  return sqlite.transaction(()=>{
    const payload=JSON.stringify(params);
    const prior=sqlite.prepare('SELECT payload FROM pokemon_transfers WHERE request_id=?').get(offer.id);
    if(prior) {if(prior.payload!==payload) throw Error('Transfer mismatch');return true;}
    if(offer.senderId===offer.receiverId) throw Error('Invalid recipient');
    const owns=(id,user)=>sqlite.prepare('SELECT id FROM captures WHERE id=? AND guild_id=? AND user_id=?').get(id,offer.guildId,user);
    if(!owns(offer.give.id,offer.senderId) || (offer.take && !owns(offer.take.id,offer.receiverId))) return false;
    const update=sqlite.prepare('UPDATE captures SET user_id=? WHERE id=? AND guild_id=? AND user_id=?');
    update.run(offer.receiverId,offer.give.id,offer.guildId,offer.senderId);
    if(offer.take) update.run(offer.senderId,offer.take.id,offer.guildId,offer.receiverId);
    sqlite.prepare('INSERT INTO pokemon_transfers VALUES (?,?)').run(offer.id,payload);
    return true;
  })();
}
module.exports={findCapture,transferPokemon};
