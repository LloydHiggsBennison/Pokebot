const {storage:{supabase,sqlite}}=require('./database');
const {getBalance}=require('./economy');
const {PRICES,marketRotation}=require('./marketCatalog');
if(sqlite) sqlite.exec(`CREATE TABLE IF NOT EXISTS pokemon_market_purchases(
  guild_id TEXT NOT NULL,user_id TEXT NOT NULL,rotation INTEGER NOT NULL,slot INTEGER NOT NULL,
  pokemon_id INTEGER NOT NULL,pokemon_name TEXT NOT NULL,rarity TEXT NOT NULL,price INTEGER NOT NULL,
  PRIMARY KEY(guild_id,user_id,rotation,slot))`);
async function getMarketState(guild,user,rotation){
  const readPurchases=async()=>{
    if(!supabase) return sqlite.prepare('SELECT slot FROM pokemon_market_purchases WHERE guild_id=? AND user_id=? AND rotation=?').all(guild,user,rotation);
    const {data,error}=await supabase.from('pokemon_market_purchases').select('slot').eq('guild_id',guild).eq('user_id',user).eq('rotation',rotation);
    if(error)throw error;return data||[];
  };
  const [balance,rows]=await Promise.all([getBalance(guild,user),readPurchases()]);
  return {balance,purchased:rows.map(p=>p.slot)};
}
async function buyMarketPokemon(guild,user,rotation,offer){
  if(supabase){
    const {data,error}=await supabase.rpc('buy_market_pokemon',{p_guild_id:guild,p_user_id:user,p_rotation:rotation,p_slot:offer.slot,
      p_pokemon_id:offer.id,p_pokemon_name:offer.name,p_rarity:offer.rarity,p_price:offer.price});
    if(error) throw error;
    return data;
  }
  return sqlite.transaction(()=>{
    if(offer.price!==PRICES[offer.rarity] || !Number.isInteger(offer.slot) || offer.slot<1 || offer.slot>6) throw Error('Invalid offer');
    const old=sqlite.prepare('SELECT * FROM pokemon_market_purchases WHERE guild_id=? AND user_id=? AND rotation=? AND slot=?').get(guild,user,rotation,offer.slot);
    const balance=()=>sqlite.prepare('SELECT balance FROM pokecoin_wallets WHERE guild_id=? AND user_id=?').get(guild,user)?.balance||0;
    if(old){
      if(old.pokemon_id!==offer.id || old.price!==offer.price) throw Error('Offer mismatch');
      return {status:'purchased',balance:balance(),new_purchase:false,pokemon_name:old.pokemon_name};
    }
    if(rotation!==marketRotation()) return {status:'expired',balance:balance()};
    if(balance()<offer.price) return {status:'insufficient',balance:balance()};
    sqlite.prepare('UPDATE pokecoin_wallets SET balance=balance-? WHERE guild_id=? AND user_id=?').run(offer.price,guild,user);
    sqlite.prepare('INSERT INTO captures(guild_id,user_id,pokemon_id,pokemon_name,is_shiny,caught_at,rarity) VALUES(?,?,?,?,0,?,?)')
      .run(guild,user,offer.id,offer.name,Date.now(),offer.rarity);
    sqlite.prepare('INSERT INTO pokemon_market_purchases VALUES(?,?,?,?,?,?,?,?)')
      .run(guild,user,rotation,offer.slot,offer.id,offer.name,offer.rarity,offer.price);
    return {status:'purchased',balance:balance(),new_purchase:true,pokemon_name:offer.name};
  })();
}
module.exports={getMarketState,buyMarketPokemon};
