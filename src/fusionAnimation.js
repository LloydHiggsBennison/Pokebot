const { Worker,isMainThread,parentPort,workerData }=require('node:worker_threads');
const cache=new Map(),pending=new Map();
const MAX_CACHE_BYTES=24*1024*1024;
let cacheBytes=0;
if(!isMainThread) {
  require('./fusionRenderer').renderAnimation(workerData).then(
    buffer=>parentPort.postMessage({buffer}),
    error=>parentPort.postMessage({error:error.message})
  );
}
function getFusionAnimation(id,name,language) {
  const key=id+':'+language;
  if(cache.has(key)) {
    const buffer=cache.get(key);cache.delete(key);cache.set(key,buffer);
    return Promise.resolve(buffer);
  }
  if(pending.has(key))return pending.get(key);
  // One rendering worker bounds memory/CPU on the small Render instance.
  if(pending.size) return Promise.resolve(null);
  const task=new Promise(resolve=>{
    const worker=new Worker(__filename,{workerData:{id,name,language}});
    let settled=false;
    const finish=buffer=>{
      if(settled)return;settled=true;clearTimeout(timer);void worker.terminate();
      if(buffer) {
        while(cacheBytes+buffer.length>MAX_CACHE_BYTES && cache.size) {
          const first=cache.keys().next().value;cacheBytes-=cache.get(first).length;cache.delete(first);
        }
        cache.set(key,buffer);cacheBytes+=buffer.length;
      }
      resolve(buffer);
    };
    const timer=setTimeout(()=>finish(null),15000);
    worker.once('message',result=>finish(result.buffer?Buffer.from(result.buffer):null));
    worker.once('error',()=>finish(null));
    worker.once('exit',()=>finish(null));
  }).finally(()=>pending.delete(key));
  pending.set(key,task);
  return task;
}
module.exports={getFusionAnimation};

