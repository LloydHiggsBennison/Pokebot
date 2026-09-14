const test=require('node:test');
const assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const {loadModule}=require('./helpers');

test('concurrent animations queue, identical requests share work, and successful GIFs are cached',async()=>{
  let active=0,maximum=0,created=0;
  class Worker extends EventEmitter {
    constructor(filename,{workerData}) {
      super();created++;active++;maximum=Math.max(maximum,active);
      setImmediate(()=>this.emit('message',{buffer:Buffer.from('GIF'+workerData.id)}));
    }
    terminate(){active--;return Promise.resolve(0);}
  }
  const {getFusionAnimation:get}=loadModule('src/fusionAnimation.js',{'node:worker_threads':{Worker,isMainThread:true}});
  const first=get(25,'Pikachu','es');
  assert.equal(get(25,'Pikachu','es'),first);
  const second=get(502,'Dewott','es');
  const result=await Promise.all([first,second]);
  assert.equal(result[0].toString(),'GIF25');
  assert.equal(result[1].toString(),'GIF502');
  assert.equal(maximum,1);
  assert.equal(await get(25,'Pikachu','es'),result[0]);
  assert.equal(created,2);
});

test('worker failure logs its cause and releases the next queued animation',async()=>{
  const logs=[];
  class Worker extends EventEmitter {
    constructor(filename,{workerData}) {
      super();
      setImmediate(()=>workerData.id===25?this.emit('error',new Error('Out of memory')):this.emit('message',{buffer:Buffer.from('GIF')}));
    }
    terminate(){return Promise.resolve(0);}
  }
  const {getFusionAnimation:get}=loadModule('src/fusionAnimation.js',{'node:worker_threads':{Worker,isMainThread:true}},
    {console:{log(){},warn(line){logs.push(JSON.parse(line));}}});
  const result=await Promise.all([get(25,'Pikachu','es'),get(502,'Dewott','es')]);
  assert.equal(result[0],null);
  assert.equal(result[1].toString(),'GIF');
  assert.equal(logs[0].reason,'Out of memory');
});
