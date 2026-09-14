async function resolveMention(guild,text) {
  const match=text.trim().match(/^<@!?(\d+)>$/);
  if(!match) return null;
  const member=await guild.members.fetch(match[1]).catch(()=>null);
  return member?.user || null;
}
module.exports={resolveMention};
