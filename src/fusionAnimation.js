const { Worker,isMainThread,parentPort,workerData }=require('node:worker_threads');
const cache=new Map(),pending=new Map(),queue=[];
const MAX_CACHE_BYTES=24*1024*1024,MAX_QUEUE=8;
let cacheBytes=0,active=false;
if(!isMainThread) {
  require('./fusionRenderer').renderAnimation({...workerData,onProgress:(stage,frame)=>parentPort.postMessage({stage,frame})}).then(
    buffer=>parentPort.postMessage({buffer}),
    error=>parentPort.postMessage({error:error.message})
  );
}
function runWorker(data) {
  return new Promise(resolve=>{
    const started=Date.now();
    let worker,settled=false,stage='startup';
    let watchdog,total;
    const finish=(buffer,reason)=>{
      if(settled)return;settled=true;clearTimeout(watchdog);clearTimeout(total);
      if(worker)void worker.terminate();
      console[buffer?'log':'warn'](JSON.stringify({event:buffer?'fusion_animation_ready':'fusion_animation_failed',
        pokemonId:data.id,stage,reason,ms:Date.now()-started,bytes:buffer?.length||0}));
      resolve(buffer);
    };
    const resetWatchdog=()=>{
      clearTimeout(watchdog);
      watchdog=setTimeout(()=>finish(null,'worker stalled'),30000);
    };
    try {
      worker=new Worker(__filename,{workerData:data});
      resetWatchdog();
      total=setTimeout(()=>finish(null,'total timeout'),90000);
      worker.on('message',result=>{
        if(result.stage){stage=result.stage;resetWatchdog();return;}
        finish(result.buffer?Buffer.from(result.buffer):null,result.buffer?undefined:(result.error||'no buffer'));
      });
      worker.once('error',error=>finish(null,error.message));
      worker.once('exit',code=>finish(null,'worker exit '+code));
    } catch(error) {finish(null,error.message);}
  });
}
async function drain() {
  if(active)return;
  active=true;
  try {
    while(queue.length){
      const job=queue.shift();
      const buffer=await runWorker(job.data);
      if(buffer){
        while(cacheBytes+buffer.length>MAX_CACHE_BYTES && cache.size){
          const first=cache.keys().next().value;cacheBytes-=cache.get(first).length;cache.delete(first);
        }
        cache.set(job.key,buffer);cacheBytes+=buffer.length;
      }
      pending.delete(job.key);job.resolve(buffer);
    }
  } finally {active=false;}
}
function getFusionAnimation(id,name,language) {
  const key=id+':'+language;
  if(cache.has(key)){
    const buffer=cache.get(key);cache.delete(key);cache.set(key,buffer);
    return Promise.resolve(buffer);
  }
  if(pending.has(key))return pending.get(key);
  if(queue.length>=MAX_QUEUE){
    console.warn(JSON.stringify({event:'fusion_animation_failed',pokemonId:id,reason:'queue full'}));
    return Promise.resolve(null);
  }
  let resolve;
  const task=new Promise(done=>{resolve=done;});
  pending.set(key,task);queue.push({key,data:{id,name,language},resolve});
  void drain();
  return task;
}
module.exports={getFusionAnimation};
