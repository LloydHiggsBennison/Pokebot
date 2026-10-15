// Shared rules for the subscription integration. These do not grant
// entitlements: callers must obtain active subscriptions from trusted storage.
const WINDOW_MS=10*60*1000;
const SHINY_CHANCE=0.05;
function limits({personal=false,server=false}={}){
  return {
    rolls:1+(server?2:0)+(personal?2:0),windowMs:WINDOW_MS,
    giftsPerDay:personal?5:1,
    specialRollCapacity:personal?50:10,
    canFuse:personal,canTrade:personal,
    battleExperienceMultiplier:personal?1:0.5,
  };
}
function battleExperience(base,personal=false){
  if(!Number.isSafeInteger(base)||base<0)throw new RangeError('Invalid base experience');
  // PostgreSQL stores fractional experience so a 25 XP reward becomes 12.5.
  return base*(personal?1:0.5);
}
function canStoreSpecialRolls(current,quantity,personal=false){
  return Number.isSafeInteger(current)&&current>=0&&Number.isSafeInteger(quantity)&&quantity>0&&current+quantity<=limits({personal}).specialRollCapacity;
}
module.exports={limits,battleExperience,canStoreSpecialRolls,SHINY_CHANCE};
