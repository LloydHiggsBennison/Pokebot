const {storage:{supabase}}=require('./database');
function enabled(){return process.env.COMMERCE_ENABLED==='true';}
async function rpc(name,args){
 if(!supabase)throw Error('Commerce requires PostgreSQL');
 const {data,error}=await supabase.rpc(name,args);if(error)throw error;return data;
}
async function query(table,method,body,filter){
 if(!supabase)throw Error('Commerce requires PostgreSQL');
 let q=method==='insert'?supabase.from(table).insert(body):method==='update'?supabase.from(table).update(body):supabase.from(table).select('*');
 for(const [key,value] of Object.entries(filter||{}))q=q.eq(key,value);
 if(method==='select')q=q.maybeSingle();
 const {data,error}=await q;if(error)throw error;return data;
}
const state=(guild,user)=>rpc('commerce_state',{p_guild:guild,p_user:user});
const action=(guild,user,request,kind,data={})=>rpc('commerce_action',{p_guild:guild,p_user:user,p_request:request,p_kind:kind,p_data:data});
module.exports={enabled,rpc,query,state,action};
