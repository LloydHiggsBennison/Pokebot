const test=require('node:test');
const assert=require('node:assert/strict');
const {loadModule,fakeClient,fakeDatabase,fakeMessage,POKEMON_LIST}=require('./helpers');
test('shiny has exactly one winning ticket out of 10000',()=>{
  let ticket=0;
  const {rollShiny}=loadModule('src/rollShiny.js',{'node:crypto':{randomInt(max){assert.equal(max,10000);return ticket++;}}});
  let wins=0;
  for(let i=0;i<10000;i++) if(rollShiny()) wins++;
  assert.equal(wins,1);
});
for(const quantity of [undefined,2]) {
  test('shiny rewards are saved and labelled for '+(quantity?'quick':'grid')+' rolls',async()=>{
    const {client}=fakeClient();
    const emojis=loadModule('src/emojiManager.js');await emojis.initializeEmojis(client);
    const db=fakeDatabase();let calls=0;
    const math=Object.create(Math);math.random=()=>0.5;
    const manager=loadModule('src/puzzleManager.js',{
      './database':db,'./emojiManager':emojis,
      './pokemonPool':{takeFromPool:()=>POKEMON_LIST.slice(0,15)},
      './badgeManager':{getNewBadgeEmoji:()=>''},
      './rollShiny':{rollShiny:()=>calls++===0},
    },{Math:math});
    const msg=fakeMessage(client);
    await manager.rollPuzzle(msg,null,quantity);
    assert.equal(db.captures.filter(p=>p.isShiny).length,1);
    assert.equal(db.captures.length,quantity||1);
    const text=msg.sent.map(p=>typeof p[1]==='string'?p[1]:p[1].content).join('\n');
    assert.match(text,/✨.*shiny/);
    if(quantity) {
      assert.equal(db.captures[0].id,db.captures[1].id);
      assert.doesNotMatch(text,/x2/); // normal and shiny are distinct entries
    } else {
      assert.equal(msg.sent[0][1].split('\n').length,5);
      assert.equal((msg.sent[0][1].match(/<:pkv2_/g)||[]).length,15);
    }
  });
}
