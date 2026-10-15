const store=require('./commerceStore');
const {PRODUCTS}=require('./commerceCatalog');
const {randomUUID}=require('node:crypto');
let token=null,pendingToken=null;
function environment(){const env=process.env.PAYPAL_ENV||'sandbox';if(!['sandbox','live'].includes(env))throw Error('Invalid PAYPAL_ENV');return env;}
function base(){return environment()==='live'?'https://api-m.paypal.com':'https://api-m.sandbox.paypal.com';}
function publicUrl(){const url=new URL(process.env.PUBLIC_URL||process.env.RENDER_EXTERNAL_URL||'https://pokebot-i345.onrender.com');if(url.protocol!=='https:')throw Error('PUBLIC_URL must use HTTPS');return url.origin;}
async function accessToken(){
 if(token&&token.until>Date.now())return token.value;
 if(pendingToken)return pendingToken;
 pendingToken=(async()=>{
  if(!process.env.PAYPAL_CLIENT_ID||!process.env.PAYPAL_CLIENT_SECRET)throw Error('PayPal credentials missing');
  const response=await fetch(base()+'/v1/oauth2/token',{method:'POST',headers:{Authorization:'Basic '+Buffer.from(process.env.PAYPAL_CLIENT_ID+':'+process.env.PAYPAL_CLIENT_SECRET).toString('base64'),'Content-Type':'application/x-www-form-urlencoded'},body:'grant_type=client_credentials',signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw Error('PayPal authentication failed ('+response.status+')');
  const data=await response.json();token={value:data.access_token,until:Date.now()+(data.expires_in-60)*1000};return token.value;
 })();try{return await pendingToken;}finally{pendingToken=null;}
}
async function api(path,method='GET',body,request){
 if(!/^\/v[12]\//.test(path))throw Error('Invalid PayPal path');
 const response=await fetch(base()+path,{method,headers:{Authorization:'Bearer '+await accessToken(),'Content-Type':'application/json',Prefer:'return=representation',...(request?{'PayPal-Request-Id':request}:{})},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(20000)});
 if(!response.ok)throw Error('PayPal API '+response.status+' '+path.split('/').slice(0,4).join('/'));
 return response.status===204?{}:response.json();
}
async function config(){const row=await store.query('commerce_config','select',null,{id:'paypal:'+environment()});if(!row)throw Error('Run /paypalsetup first');return row.value;}
async function setup(){
 const key='paypal:'+environment();let row=await store.query('commerce_config','select',null,{id:key});
 if(!row){await store.query('commerce_config','insert',{id:key,value:{}});row={value:{}};}
 const c=row.value,save=()=>store.query('commerce_config','update',{value:c},{id:key});
 if(!c.product){const p=await api('/v1/catalogs/products','POST',{name:'Pokebot Premium',type:'SERVICE',category:'SOFTWARE'},'pokebot-product-v1');c.product=p.id;await save();}
 for(const sku of ['personal','server'])if(!c[sku]){
  const plan=await api('/v1/billing/plans','POST',{product_id:c.product,name:'Pokebot '+sku,status:'ACTIVE',billing_cycles:[{frequency:{interval_unit:'MONTH',interval_count:1},tenure_type:'REGULAR',sequence:1,total_cycles:0,pricing_scheme:{fixed_price:{value:PRODUCTS[sku].usd,currency_code:'USD'}}}],payment_preferences:{auto_bill_outstanding:false,payment_failure_threshold:1}},'pokebot-plan-'+sku+'-v1');c[sku]=plan.id;await save();
 }
 const url=publicUrl()+'/paypal/webhook';
 if(!c.webhook){
  const hooks=await api('/v1/notifications/webhooks');let hook=hooks.webhooks?.find(h=>h.url===url);
  if(!hook)hook=await api('/v1/notifications/webhooks','POST',{url,event_types:['CHECKOUT.ORDER.APPROVED','PAYMENT.CAPTURE.COMPLETED','PAYMENT.CAPTURE.REFUNDED','PAYMENT.CAPTURE.REVERSED','BILLING.SUBSCRIPTION.ACTIVATED','BILLING.SUBSCRIPTION.CANCELLED','BILLING.SUBSCRIPTION.SUSPENDED','BILLING.SUBSCRIPTION.EXPIRED','PAYMENT.SALE.COMPLETED','PAYMENT.SALE.REFUNDED','PAYMENT.SALE.REVERSED'].map(name=>({name}))});
  c.webhook=hook.id;await save();
 }
 return {environment:environment(),webhookUrl:url};
}
async function createCheckout(guild,user,sku){
 if(environment()==='sandbox'&&user!==(process.env.BOT_OWNER_ID||'468832874066608135'))throw Error('Sandbox is owner-only');
 const p=PRODUCTS[sku];if(!p)throw Error('Invalid product');
 const conf=await config(),id=randomUUID();
 await store.query('commerce_checkouts','insert',{id,guild_id:guild,user_id:user,sku,environment:environment()});
 const context={brand_name:'Pokebot',shipping_preference:'NO_SHIPPING',return_url:publicUrl()+'/paypal/return',cancel_url:publicUrl()+'/paypal/cancel'};
 const result=p.kind==='order'
  ?await api('/v2/checkout/orders','POST',{intent:'CAPTURE',purchase_units:[{custom_id:id,description:'Pokebot '+sku,amount:{currency_code:'USD',value:p.usd}}],payment_source:{paypal:{experience_context:{...context,user_action:'PAY_NOW'}}}},id)
  :await api('/v1/billing/subscriptions','POST',{plan_id:conf[sku],custom_id:id,application_context:{...context,user_action:'SUBSCRIBE_NOW'}},id);
 const url=result.links?.find(l=>['approve','payer-action'].includes(l.rel))?.href;
 if(!url||!/^https:\/\/([a-z0-9-]+\.)*paypal\.com\//i.test(url))throw Error('Missing PayPal approval URL');
 await store.query('commerce_checkouts','update',{provider_id:result.id,approval_url:url},{id});
 return {id,url};
}
function validAmount(amount,expected){return amount?.currency_code==='USD'&&/^\d+(\.\d{1,2})?$/.test(amount.value||'')&&Number(amount.value)===Number(expected);}
async function settle(c){
 if(c.environment!==environment())throw Error('Environment mismatch');
 const p=PRODUCTS[c.sku];if(!p)throw Error('Invalid stored product');
 if(p.kind==='order'){
  let order=await api('/v2/checkout/orders/'+encodeURIComponent(c.provider_id));
  if(order.status==='APPROVED')order=await api('/v2/checkout/orders/'+encodeURIComponent(c.provider_id)+'/capture','POST',{},c.id);
  const unit=order.purchase_units?.[0],capture=unit?.payments?.captures?.[0];
  if(order.status!=='COMPLETED'||capture?.status!=='COMPLETED')return {pending:true};
  if(order.purchase_units.length!==1||unit.custom_id!==c.id||!validAmount(unit.amount,p.usd)||!validAmount(capture.amount,p.usd)||unit.payments.captures.length!==1)throw Error('Payment verification mismatch');
  return store.rpc('commerce_grant',{p_checkout:c.id,p_payment:capture.id,p_until:null});
 }
 const s=await api('/v1/billing/subscriptions/'+encodeURIComponent(c.provider_id)),conf=await config();
 if(s.custom_id!==c.id||s.plan_id!==conf[c.sku])throw Error('Subscription identity mismatch');
 if(s.status!=='ACTIVE')return {pending:true,status:s.status};
 const payment=s.billing_info?.last_payment,until=s.billing_info?.next_billing_time;
 if(!validAmount(payment?.amount,p.usd)||!payment?.time||!until||Date.parse(until)<=Date.now()||Date.parse(until)>Date.now()+40*86400000)return {pending:true};
 return store.rpc('commerce_grant',{p_checkout:c.id,p_payment:c.provider_id+':'+payment.time,p_until:until});
}
async function verifyEvent(headers,event){
 const c=await config();
 const fields={'auth_algo':'paypal-auth-algo','cert_url':'paypal-cert-url','transmission_id':'paypal-transmission-id','transmission_sig':'paypal-transmission-sig','transmission_time':'paypal-transmission-time'};
 const body={webhook_id:c.webhook,webhook_event:event};
 for(const [key,header]of Object.entries(fields)){if(typeof headers[header]!=='string')return false;body[key]=headers[header];}
 const checked=await api('/v1/notifications/verify-webhook-signature','POST',body);
 return checked.verification_status==='SUCCESS';
}
async function webhook(headers,event){
 if(!await verifyEvent(headers,event))throw Error('Invalid webhook signature');
 const r=event.resource||{},type=event.event_type||'';
 const providerId=type.startsWith('BILLING.SUBSCRIPTION.')?r.id:r.billing_agreement_id||r.supplementary_data?.related_ids?.order_id||(type==='CHECKOUT.ORDER.APPROVED'?r.id:null);
 let c=providerId?await store.query('commerce_checkouts','select',null,{provider_id:providerId}):null;
 if(!c&&/REFUNDED|REVERSED/.test(type)){
  const captureId=r.supplementary_data?.related_ids?.capture_id||r.links?.map(l=>l.href?.match(/^https:\/\/api-m(?:\.sandbox)?\.paypal\.com\/v2\/payments\/captures\/([A-Z0-9]+)$/)?.[1]).find(Boolean)||(type==='PAYMENT.CAPTURE.REVERSED'?r.id:null);
  if(captureId){const receipt=await store.query('commerce_receipts','select',null,{request_id:'payment:'+captureId});if(receipt)c=await store.query('commerce_checkouts','select',null,{id:receipt.result.checkout});}
  if(!c)throw Error('Refund requires reconciliation: '+event.id);
 }
 if(!c)return;
 if(c.environment!==environment())throw Error('Webhook environment mismatch');
 if(/REFUNDED|REVERSED/.test(type)){
  await store.query('commerce_accounts','update',{hold:true},{guild_id:c.guild_id,user_id:c.user_id});
  await store.query('commerce_entitlements','update',{revoked:true},{source:c.provider_id});return;
 }
 const result=await settle(c);
 if(result.pending&&['PAYMENT.SALE.COMPLETED','PAYMENT.CAPTURE.COMPLETED'].includes(type))throw Error('Payment state not synchronized yet');
}
async function cancel(c){if(PRODUCTS[c.sku]?.kind!=='subscription')throw Error('Not a subscription');await api('/v1/billing/subscriptions/'+encodeURIComponent(c.provider_id)+'/cancel','POST',{reason:'Cancelled by subscriber in Discord'});}
module.exports={environment,publicUrl,setup,createCheckout,settle,webhook,cancel,validAmount};
