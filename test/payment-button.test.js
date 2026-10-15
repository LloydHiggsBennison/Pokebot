const test=require('node:test'),assert=require('node:assert/strict');
const {loadModule}=require('./helpers');
const {ActionRowBuilder,ButtonBuilder,ButtonStyle}=require('discord.js');
for(const outcome of ['success','pending','error'])test('payment button is consumed on '+outcome+' and rejects concurrent clicks',async()=>{
 let calls=0,release;
 const waiting=new Promise(resolve=>{release=resolve;});
 const manager=loadModule('src/commerceCommands.js',{'./commerceStore':{enabled:()=>true,query:async()=>({id:'c'})},'./paypal':{settle:async()=>{calls++;await waiting;if(outcome==='error')throw Error('timeout');return {pending:outcome==='pending'};}}});
 const edits=[],replies=[];
 const i={customId:'paycheck:u:c',user:{id:'u'},guildId:'g',message:{id:'m',components:[new ActionRowBuilder().addComponents(new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('PayPal').setURL('https://www.sandbox.paypal.com/'),new ButtonBuilder().setCustomId('paycheck:u:c').setStyle(ButtonStyle.Primary).setLabel('Verify'))]},deferUpdate:async()=>{},editReply:async p=>{edits.push(p);},reply:async p=>{replies.push(p);}};
 // Discord received components expose customId/disabled on component objects.
 i.message.components=i.message.components.map(row=>({components:row.components.map(b=>({customId:b.data.custom_id,disabled:b.data.disabled,toJSON:()=>b.toJSON()}))}));
 const first=manager.handle(i);
 await manager.handle(i);assert.equal(replies.length,1);
 release();await first;
 assert.equal(calls,1);assert.equal(edits.length,2);
 for(const edit of edits){assert.equal(edit.components[0].components[1].data.disabled,true);assert.equal(edit.components[0].components[0].data.url,'https://www.sandbox.paypal.com/');}
 await manager.handle(i);assert.equal(calls,1);
});
