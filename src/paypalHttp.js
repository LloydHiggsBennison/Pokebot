async function handle(req,res){
 const path=req.url.split('?')[0];
 if(req.method==='GET'&&['/paypal/return','/paypal/cancel'].includes(path)){
  res.writeHead(200,{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store'});
  return res.end(path.endsWith('/return')?'Vuelve a Discord y pulsa «Verificar pago». Los premios se entregan después de verificar el pago con PayPal.':'Pago cancelado. Puedes volver a Discord.');
 }
 if(req.method!=='POST'||path!=='/paypal/webhook'){res.writeHead(404);res.end();return;}
 let length=0,chunks=[];req.setTimeout(10000,()=>req.destroy());
 for await(const chunk of req){length+=chunk.length;if(length>262144){res.writeHead(413);res.end();return;}chunks.push(chunk);}
 let event;try{event=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{res.writeHead(400);res.end();return;}
 if(!event.id||!event.event_type){res.writeHead(400);res.end();return;}
 await require('./paypal').webhook(req.headers,event);
 res.writeHead(200);res.end('OK');
}
module.exports={handle};
