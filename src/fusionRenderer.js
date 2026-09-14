const sharp = require('sharp');
const { fetchWithTimeout } = require('./network');
const WIDTH=480, HEIGHT=320, FRAMES=60;
const escape = value => String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
const clamp = x => Math.max(0,Math.min(1,x));
const smooth = x => { x=clamp(x);return x*x*(3-2*x); };
const spriteUrl = (id,shiny=false) => 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/'+(shiny?'shiny/':'')+id+'.png';

async function loadSprite(id,shiny) {
  const response=await fetchWithTimeout(spriteUrl(id,shiny),{},4500);
  if(!response.ok) throw new Error('Sprite HTTP '+response.status);
  const data=Buffer.from(await response.arrayBuffer());
  if(data.length>1024*1024) throw new Error('Sprite too large');
  const png=await sharp(data,{limitInputPixels:1024*1024}).trim().resize(180,180,{fit:'inside',kernel:'nearest'}).png().toBuffer();
  return 'data:image/png;base64,'+png.toString('base64');
}
function frameSvg(frame,normal,shiny,name,language) {
  const en=language==='en', cx=300,cy=166;
  const converge=smooth((frame-10)/23),reveal=smooth((frame-35)/9);
  const flash=frame>=30 && frame<=41 ? Math.sin((frame-30)/11*Math.PI)*0.8 : 0;
  const title=en?'SHINY FUSION':'FUSIÓN SHINY';
  const stage=frame<12?(en?'FOUR COPIES. ONE NEW BEGINNING.':'CUATRO COPIAS. UN NUEVO COMIENZO.'):
    frame<35?(en?'THEIR ENERGY IS COMBINING':'SU ENERGÍA SE ESTÁ UNIENDO'):
    (en?'A SHINY POKÉMON IS BORN':'NACE UN POKÉMON SHINY');
  const image=(url,x,y,size,opacity=1)=>'<image href="'+url+'" x="'+(x-size/2)+'" y="'+(y-size/2)+'" width="'+size+'" height="'+size+'" opacity="'+opacity+'" preserveAspectRatio="xMidYMid meet"/>';
  let s='<svg xmlns="http://www.w3.org/2000/svg" width="480" height="320" viewBox="0 0 480 320"><defs>'+
    '<radialGradient id="bg"><stop stop-color="#24225d"/><stop offset="1" stop-color="#070c1c"/></radialGradient>'+
    '<radialGradient id="orb"><stop stop-color="#fffde3"/><stop offset=".3" stop-color="#a2ffff" stop-opacity=".9"/><stop offset="1" stop-color="#7863ff" stop-opacity="0"/></radialGradient>'+
    '<linearGradient id="line"><stop stop-color="#53edee"/><stop offset="1" stop-color="#ecbf63"/></linearGradient></defs>'+
    '<rect width="480" height="320" rx="18" fill="url(#bg)"/><rect x="8" y="8" width="464" height="304" rx="13" fill="none" stroke="#403f70"/>'+
    '<text x="22" y="31" fill="#f4df99" font-family="sans-serif" font-weight="bold" font-size="18" letter-spacing="3">'+title+'</text>'+
    '<text x="22" y="48" fill="#b9c1de" font-family="sans-serif" font-size="9" letter-spacing="1">'+stage+'</text>';
  // Deterministic stars keep the GIF stable and make the motion intentional.
  for(let i=0;i<34;i++){
    const x=18+(i*83)%445,y=60+(i*47)%226;
    const a=.18+.2*(1+Math.sin(frame*.15+i))/2;
    s+='<circle cx="'+x+'" cy="'+y+'" r="'+(i%3===0?1.2:.65)+'" fill="#c6d9ff" opacity="'+a+'"/>';
  }
  // The fifth, original Pokémon stays intact throughout the entire sequence.
  s+='<rect x="20" y="102" width="88" height="135" rx="12" fill="#101e35" stroke="#529a98"/>'+
    '<text x="64" y="121" text-anchor="middle" font-family="sans-serif" font-size="10" fill="#a6efe1">ORIGINAL</text>'+
    image(normal,64,170,74)+'<text x="64" y="218" text-anchor="middle" font-family="sans-serif" font-size="12" fill="#e1fff5">×1</text>';
  s+='<ellipse cx="'+cx+'" cy="249" rx="88" ry="13" fill="#071326"/>';
  for(let ring=0;ring<3;ring++){
    const radius=58+ring*23;
    s+='<circle cx="'+cx+'" cy="'+cy+'" r="'+radius+'" fill="none" stroke="'+(ring===1?'#c797ff':'#4be0e5')+'" stroke-width="'+(ring===0?2:1)+'" opacity=".3" stroke-dasharray="18 8 3 8" transform="rotate('+(frame*(ring%2?-3:2))+','+cx+','+cy+')"/>';
  }
  if(frame<35) {
    for(let i=0;i<4;i++){
      const a=i*Math.PI/2+converge*Math.PI*2;
      const radius=82*(1-converge),x=cx+Math.cos(a)*radius,y=cy+Math.sin(a)*radius;
      if(frame>10) {
        for(let j=1;j<=6;j++){
          const tailA=a-j*.12,tailR=radius+j*2;
          s+='<circle cx="'+(cx+Math.cos(tailA)*tailR)+'" cy="'+(cy+Math.sin(tailA)*tailR)+'" r="'+(5-j*.6)+'" fill="'+(i%2?'#e5b8ff':'#8ef8ff')+'" opacity="'+(.5-j*.06)+'"/>';
        }
      }
      s+='<circle cx="'+x+'" cy="'+y+'" r="'+(28*(1-converge)+4)+'" fill="#163858" stroke="#8cd8ec" opacity="'+(1-converge)+'"/>';
      s+=image(normal,x,y,56*(1-converge)+4,1-converge);
    }
  }
  if(frame>10 && frame<44) s+='<circle cx="'+cx+'" cy="'+cy+'" r="'+(18+converge*92)+'" fill="url(#orb)"/>';
  if(frame>=35) {
    for(let i=0;i<12;i++){
      const a=i*Math.PI/6+frame*.007;
      s+='<path d="M '+(cx+Math.cos(a)*60)+' '+(cy+Math.sin(a)*60)+' L '+(cx+Math.cos(a)*135)+' '+(cy+Math.sin(a)*135)+'" stroke="'+(i%2?'#edc46b':'#99e8fa')+'" stroke-width="2" opacity="'+(.18*reveal)+'"/>';
    }
    s+='<circle cx="'+cx+'" cy="'+cy+'" r="102" fill="url(#orb)" opacity="'+(.65*reveal)+'"/>';
    s+=image(shiny,cx,cy-3,115+reveal*65,reveal);
    for(let i=0;i<7;i++){
      const a=i*2*Math.PI/7+frame*.015,r=88+(i%2)*20,x=cx+Math.cos(a)*r,y=cy+Math.sin(a)*r;
      const size=4+3*(1+Math.sin(frame*.25+i))/2;
      s+='<path d="M '+x+' '+(y-size)+' L '+(x+size*.28)+' '+(y-size*.28)+' L '+(x+size)+' '+y+' L '+(x+size*.28)+' '+(y+size*.28)+' L '+x+' '+(y+size)+' L '+(x-size*.28)+' '+(y+size*.28)+' L '+(x-size)+' '+y+' L '+(x-size*.28)+' '+(y-size*.28)+' Z" fill="#ffecad" opacity="'+reveal+'"/>';
    }
  }
  if(flash>0) s+='<circle cx="'+cx+'" cy="'+cy+'" r="127" fill="url(#orb)" opacity="'+flash+'"/>';
  const caption=frame>=44?escape(name.toUpperCase())+' · SHINY':en?'4 REGULAR → 1 SHINY':'4 NORMALES → 1 SHINY';
  s+='<text x="300" y="292" text-anchor="middle" font-family="sans-serif" font-weight="bold" font-size="15" fill="#fff0bb">'+caption+'</text>'+
    '<rect x="22" y="303" width="'+(436*Math.min(1,frame/45))+'" height="2" rx="1" fill="url(#line)"/></svg>';
  return s;
}
async function renderAnimation({id,name,language='es',sprites}) {
  if(!Number.isInteger(id)||id<1||id>1025)throw new Error('Invalid species');
  const [normal,shiny]=sprites || await Promise.all([loadSprite(id,false),loadSprite(id,true)]);
  const frames=[];
  for(let f=0;f<FRAMES;f++) {
    frames.push(await sharp(Buffer.from(frameSvg(f,normal,shiny,name,language))).ensureAlpha().raw().toBuffer());
  }
  const gif=await sharp(Buffer.concat(frames),{raw:{width:WIDTH,height:HEIGHT*FRAMES,channels:4,pageHeight:HEIGHT}})
    .gif({loop:1,delay:Array.from({length:FRAMES},(_,i)=>i===FRAMES-1?2500:80),colours:128,effort:3,dither:0.2}).toBuffer();
  if(gif.length>7*1024*1024)throw new Error('Animation exceeds upload budget');
  return gif;
}
module.exports={renderAnimation,frameSvg,spriteUrl,WIDTH,HEIGHT,FRAMES};

