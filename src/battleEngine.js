const data=require('../data/battle-data.json');
const {createHash}=require('node:crypto');
const {t}=require('./i18n');
function ivs(copy){
  const bytes=createHash('sha256').update('iv:'+copy.id).digest();
  if(copy.iv_total==null)return Array.from(bytes.subarray(0,6),n=>n%32);
  const values=Array(6).fill(0);let total=Math.max(0,Math.min(186,Number(copy.iv_total))),i=0;
  const order=[0,1,2,3,4,5].sort((a,b)=>bytes[a]-bytes[b]);
  while(total>0){const k=order[i++%6];if(values[k]<31){values[k]++;total--;}}
  return values;
}
function stats(copy){
  const s=data.species[copy.pokemon_id],level=Math.max(1,Math.min(100,Number(copy.level)||5)),iv=ivs(copy);
  const values=s.stats.map((base,i)=>Math.floor((2*base+iv[i])*level/100)+(i===0?level+10:5));
  if(copy.pokemon_id===292)values[0]=1;
  return {level,hp:values[0],attack:values[1],defense:values[2],specialAttack:values[3],specialDefense:values[4],speed:values[5],iv};
}
const defenses={
  'growl':'weaken','charm':'weaken','baby-doll-eyes':'weaken','feather-dance':'weaken',
  'smokescreen':'distract','sand-attack':'distract','kinesis':'distract',
  'harden':'guard','defense-curl':'guard','withdraw':'guard','iron-defense':'guard','barrier':'guard',
  'protect':'guard','detect':'guard','reflect':'guard','light-screen':'guard','swords-dance':'boost',
  'calm-mind':'boost','nasty-plot':'boost','growth':'boost','dragon-dance':'boost','bulk-up':'boost',
  'recover':'heal','roost':'heal','synthesis':'heal','rest':'heal','soft-boiled':'heal','slack-off':'heal',
};
const fallback=(id,es,name,role,effect,power=0)=>({id,es,name,role,effect,power,type:1,damageClass:2,accuracy:100,pp:role==='attack1'?15:role==='attack2'?10:role==='defense'?5:3,generic:true});
function movesFor(copy){
  const s=data.species[copy.pokemon_id],level=stats(copy).level;
  const learn=s.learn.map(([id,at])=>({...data.moves[id],at})).filter(m=>m.id);
  const unlocked=learn.filter(m=>m.at<=level);
  const damage=learn.filter(m=>m.power>0&&m.damageClass!==1&&m.power<=150);
  const sort=(a,b)=>(Number(b.at<=level)-Number(a.at<=level)) || (Number(s.types.includes(b.type))-Number(s.types.includes(a.type))) || Math.abs(a.power-60)-Math.abs(b.power-60) || a.id-b.id;
  const attacks=[...damage].sort(sort);
  const first=attacks.find(m=>m.at<=level) || attacks[0];
  const second=attacks.find(m=>m.id!==first?.id&&m.at<=level) || attacks.find(m=>m.id!==first?.id);
  const defensive=[...unlocked,...learn].find(m=>defenses[m.name]&&['guard','weaken','distract'].includes(defenses[m.name]));
  const special=damage.filter(m=>m.id!==first?.id&&m.id!==second?.id).sort((a,b)=>(Number(b.at<=level)-Number(a.at<=level))||(Number(s.types.includes(b.type))-Number(s.types.includes(a.type)))||b.power-a.power)[0]
    || [...unlocked,...learn].find(m=>m.id!==defensive?.id&&['boost','heal'].includes(defenses[m.name]));
  const slots=[
    first?{...first,role:'attack1',effect:'damage',pp:15}:fallback(-1,'Forcejeo','Struggle','attack1','damage',40),
    second?{...second,role:'attack2',effect:'damage',pp:10}:fallback(-2,'Golpe de emergencia','Emergency strike','attack2','damage',50),
    defensive?{...defensive,role:'defense',effect:defenses[defensive.name],pp:5}:fallback(-3,'Guardia','Guard','defense','guard'),
    special?{...special,role:'special',effect:special.power?'damage':defenses[special.name],pp:3}:fallback(-4,'Concentración','Focus','special','boost'),
  ];
  // Distinct, species-compatible signatures for the example evolution family.
  const preferred={4:['scratch','ember','growl','fire-fang'],5:['scratch','fire-fang','smokescreen','flamethrower'],6:['dragon-claw','air-slash','smokescreen','fire-blast']}[copy.pokemon_id];
  if(preferred)preferred.forEach((n,i)=>{const m=learn.find(m=>m.name===n);if(m)slots[i]={...m,role:slots[i].role,pp:slots[i].pp,effect:i===2?defenses[m.name]:'damage'};});
  if(copy.pokemon_id===132){const m=learn.find(m=>m.name==='transform');if(m)slots[3]={...m,role:'special',pp:3,effect:'transform'};}
  return slots.map(m=>({...m,remaining:m.pp}));
}
function fighter(copy,user){
  const calculated=stats(copy);
  return {user,copyId:String(copy.id),pokemonId:copy.pokemon_id,name:copy.pokemon_name,shiny:!!copy.is_shiny,
    ...calculated,maxHp:calculated.hp,moves:movesFor(copy),types:data.species[copy.pokemon_id].types,guard:false,boost:0,weaken:0,distract:false};
}
function startFight(state){
  const next=structuredClone(state);next.status='active';next.turn=next.fighters[0].speed>=next.fighters[1].speed?0:1;
  next.turns=0;next.deadline=Date.now()+60000;next.log=t('¡Comienza la batalla!','The battle begins!');return next;
}
function moveName(m){return t(m.es,m.name.replace(/-/g,' '));}
function act(state,user,index,random=Math.random){
  if(state.status!=='active'||state.fighters[state.turn].user!==user)throw Error('Not your turn');
  if(!Number.isInteger(index)||index<0||index>3)throw Error('Invalid move');
  const next=structuredClone(state),a=next.fighters[next.turn],b=next.fighters[1-next.turn],m=a.moves[index];
  if(m.remaining<=0)throw Error('No PP');m.remaining--;next.turns++;
  let result='';
  if(m.effect==='damage'){
    const hit=random()<(m.accuracy/100)*(a.distract?0.75:1);a.distract=false;
    if(hit){
      const attack=(m.damageClass===3?a.specialAttack:a.attack)*(1+Math.min(3,a.boost)*0.25)/(1+Math.min(3,a.weaken)*0.25);
      const defense=m.damageClass===3?b.specialDefense:b.defense;
      const effectiveness=b.types.reduce((n,type)=>n*(data.efficacy[m.type+':'+type]??1),1);
      const power=Math.min(m.power,40+a.level*2);
      const damage=effectiveness===0?0:Math.max(1,Math.floor(((2*a.level/5+2)*power*attack/Math.max(1,defense)/50+2)*(a.types.includes(m.type)?1.5:1)*effectiveness*(b.guard?0.5:1)*(0.85+random()*0.15)));
      b.guard=false;b.hp=Math.max(0,b.hp-damage);result=t(`causó ${damage} de daño`,`dealt ${damage} damage`);
    }else result=t('falló','missed');
  }else if(m.effect==='guard'){a.guard=true;result=t('reducirá el próximo golpe a la mitad','will halve the next hit');}
  else if(m.effect==='weaken'){b.weaken=Math.min(3,b.weaken+1);result=t('redujo el ataque rival','lowered the opponent’s attack');}
  else if(m.effect==='distract'){b.distract=true;result=t('redujo la precisión del próximo ataque rival','lowered accuracy of the opponent’s next attack');}
  else if(m.effect==='heal'){a.hp=Math.min(a.maxHp,a.hp+Math.ceil(a.maxHp*0.25));result=t('recuperó HP','recovered HP');}
  else if(m.effect==='transform'){
    for(const key of ['attack','defense','specialAttack','specialDefense','speed','types'])a[key]=structuredClone(b[key]);
    for(let k=0;k<2;k++)a.moves[k]={...b.moves[k],role:a.moves[k].role,pp:a.moves[k].pp,remaining:Math.min(5,a.moves[k].remaining)};
    result=t('copió los atributos y ataques del rival durante esta batalla','copied the opponent’s attributes and attacks for this battle');
  }else {a.boost=Math.min(3,a.boost+1);result=t('aumentó su ataque','raised its attack');}
  next.log=`${a.name}: ${moveName(m)} — ${result}.`;
  if(b.hp===0){next.status='finished';next.winner=a.user;next.reason='knockout';}
  else if(next.turns>=100||next.fighters.every(f=>f.moves.every(m=>m.remaining===0))){next.status='finished';next.winner=null;next.reason='draw';}
  else{
    next.turn=1-next.turn;
    if(next.fighters[next.turn].moves.every(m=>m.remaining===0)){next.status='finished';next.winner=next.fighters[1-next.turn].user;next.reason='no-pp';}
  }
  next.deadline=Date.now()+60000;return next;
}
function finish(state,user,reason='surrender'){
  const next=structuredClone(state);
  if(!next.users.includes(user))throw Error('Not a player');
  next.status=next.status==='active'?'finished':'cancelled';
  next.winner=next.status==='finished'?next.users.find(u=>u!==user):null;
  next.reason=reason;next.log=t('La batalla terminó.','The battle ended.');return next;
}
function timeout(state){
  if(state.deadline>Date.now())return state;
  return finish(state,state.status==='active'?state.fighters[state.turn].user:state.users[0],'timeout');
}
module.exports={stats,ivs,movesFor,fighter,startFight,act,finish,timeout,moveName};
