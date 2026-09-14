const test=require('node:test');
const assert=require('node:assert/strict');
const sharp=require('sharp');
const {renderAnimation,frameSvg,WIDTH,HEIGHT,FRAMES}=require('../src/fusionRenderer');
test('fusion GIF plays once, preserves original, reveals shiny and fits upload budget',async()=>{
  const sprite=async background=>'data:image/png;base64,'+(await sharp({create:{width:24,height:32,channels:4,background}}).png().toBuffer()).toString('base64');
  const normal=await sprite('#348bdb'),shiny=await sprite('#f59443');
  const gif=await renderAnimation({id:359,name:'Absol',language:'es',sprites:[normal,shiny]});
  const meta=await sharp(gif,{animated:true}).metadata();
  assert.equal(meta.width,WIDTH);assert.equal(meta.pageHeight,HEIGHT);
  assert.equal(meta.pages,FRAMES);assert.equal(meta.loop,1);
  assert.equal(meta.delay.at(-1),2500);assert.ok(gif.length<7*1024*1024);
  // Decode the full animation: optimized GIF frames depend on preceding frames.
  const decoded=await sharp(gif,{animated:true}).ensureAlpha().raw().toBuffer();
  const center=((FRAMES-1)*WIDTH*HEIGHT+166*WIDTH+300)*4;
  assert.ok(decoded[center]>200 && decoded[center+2]<120,'Last GIF frame must contain the orange shiny sprite');
  // Use source frames for the unchanged original check; GIF palette quantization can differ.
  const first=await sharp(Buffer.from(frameSvg(0,normal,shiny,'Absol','es'))).png().toBuffer();
  const last=await sharp(Buffer.from(frameSvg(59,normal,shiny,'Absol','es'))).png().toBuffer();
  const original={left:24,top:106,width:78,height:126};
  assert.deepEqual(await sharp(first).extract(original).raw().toBuffer(),await sharp(last).extract(original).raw().toBuffer());
  assert.notDeepEqual(await sharp(first).raw().toBuffer(),await sharp(last).raw().toBuffer());
  assert.match(frameSvg(59,normal,shiny,'Absol','en'),/A SHINY POKÉMON IS BORN/);
  assert.match(frameSvg(59,normal,shiny,'Absol','es'),/NACE UN POKÉMON SHINY/);
});

