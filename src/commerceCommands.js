const {SlashCommandBuilder,MessageFlags,ActionRowBuilder,ButtonBuilder,ButtonStyle,StringSelectMenuBuilder}=require('discord.js');
const {randomBytes,createHash}=require('node:crypto');
const store=require('./commerceStore'),paypal=require('./paypal');
const {PRODUCTS}=require('./commerceCatalog');
const {t}=require('./i18n');
const owner=i=>i.user.id===(process.env.BOT_OWNER_ID||'468832874066608135');
const setupLocks=new Set();
const paymentChecks=new Set();
async function verifyPayment(i,user,id){
 const key=i.message.id;
 const used=i.message.components.some(row=>row.components.some(button=>button.customId===i.customId&&button.disabled));
 if(used||paymentChecks.has(key))return i.reply({content:t('Esta verificación ya fue utilizada. Consulta `$pokewallet`.','This verification was already used. Check `$pokewallet`.'),flags:MessageFlags.Ephemeral});
 paymentChecks.add(key);
 setTimeout(()=>paymentChecks.delete(key),15*60*1000).unref();
 await i.deferUpdate();
 const components=i.message.components.map(row=>new ActionRowBuilder().addComponents(row.components.map(button=>{
  const copy=ButtonBuilder.from(button);
  if(button.customId===i.customId)copy.setDisabled(true);
  return copy;
 })));
 try{
  await i.editReply({content:t('Comprobando el pago…','Checking payment…'),components});
  const c=await store.query('commerce_checkouts','select',null,{id,user_id:user,guild_id:i.guildId});if(!c)throw Error('Unknown checkout');
  const r=await paypal.settle(c);
  await i.editReply({content:r.pending?t('Pago aún no confirmado. Si falta, completa el pago en PayPal. Se acreditará automáticamente al confirmarse; revisa `$pokewallet`.','Payment not confirmed yet. Complete payment in PayPal if needed. It will be credited automatically when confirmed; check `$pokewallet`.'):t('✅ Pago verificado. Beneficios acreditados una sola vez. Consulta `$pokewallet`.','✅ Payment verified. Benefits credited once. Check `$pokewallet`.'),components});
 }catch(e){
  console.error('[PayPal verification]',e.message);
  await i.editReply({content:t('No se pudo confirmar el pago. Si ya pagaste, no hagas otra compra: la confirmación automática puede llegar después. Revisa `$pokewallet` y contacta al administrador si no se acredita.','Could not confirm payment. If already paid, do not purchase again: automatic confirmation may arrive later. Check `$pokewallet` and contact the administrator if it is not credited.'),components});
 }
}
const commands={
 paypalsetup:{data:new SlashCommandBuilder().setName('paypalsetup').setDescription('Configurar PayPal (solo propietario del bot)').setDMPermission(false),async execute(i){
  if(!owner(i))return i.reply({content:'Solo el propietario del bot.',flags:MessageFlags.Ephemeral});
  await i.deferReply({flags:MessageFlags.Ephemeral});
  if(setupLocks.has('setup'))return i.editReply('La configuración está en curso.');setupLocks.add('setup');
  try{const r=await paypal.setup();await i.editReply(`✅ PayPal ${r.environment}: planes mensuales y webhook configurados. URL: ${r.webhookUrl}\nLos pagos todavía deben probarse en Sandbox.`);}catch(e){console.error('[PayPal setup]',e.message);await i.editReply('No se pudo configurar PayPal. Revisa la migración SQL, las credenciales y los logs de Render.');}finally{setupLocks.delete('setup');}
 }},
 pokeshop:{data:new SlashCommandBuilder().setName('pokeshop').setDescription('Suscripciones y créditos por PayPal').setDMPermission(false),async execute(i){
  if(paypal.environment()==='sandbox'&&!owner(i))return i.reply({content:t('La tienda está en pruebas privadas.','The shop is in private testing.'),flags:MessageFlags.Ephemeral});
  if(!store.enabled())return i.reply({content:t('La tienda está en preparación.','The shop is being prepared.'),flags:MessageFlags.Ephemeral});
  return i.reply({content:t('Elige una suscripción mensual o un paquete de créditos. Los créditos y tickets se guardan en este servidor. Puedes cancelar la renovación desde PayPal.','Choose a monthly subscription or credit pack. Credits and tickets are stored in this server. Cancel renewal through PayPal.')+(paypal.environment()==='sandbox'?'\n🧪 SANDBOX — pruebas, sin dinero real.':''),flags:MessageFlags.Ephemeral,components:[new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId('pokeshop:'+i.user.id).setPlaceholder(t('Elegir producto','Choose product')).addOptions(Object.entries(PRODUCTS).map(([sku,p])=>({label:sku==='personal'?'Premium personal · US$5/mes':sku==='server'?'Premium servidor · US$10/mes':`${p.credits} créditos · US$${p.usd}${sku==='credits50'?' + 6 tickets':''}`,value:sku}))))]});
 }},
 pokekey:{data:new SlashCommandBuilder().setName('pokekey').setDescription('Generar o canjear una clave premium').setDMPermission(false)
  .addSubcommand(s=>s.setName('crear').setDescription('Solo propietario del bot').addStringOption(o=>o.setName('tipo').setDescription('Suscripción o paquete').setRequired(true).addChoices(...Object.entries(PRODUCTS).map(([value,p])=>({name:p.kind==='subscription'?value:`${p.credits} créditos${value==='credits50'?' + 6 tickets':''}`,value})))).addIntegerOption(o=>o.setName('dias').setDescription('Días de suscripción (ignorado para créditos)').setRequired(true).setMinValue(1).setMaxValue(366)))
  .addSubcommand(s=>s.setName('canjear').setDescription('Canjear una clave').addStringOption(o=>o.setName('clave').setDescription('Tu clave privada').setRequired(true))),async execute(i){
   if(!store.enabled())return i.reply({content:t('Premium todavía no está activado.','Premium is not enabled yet.'),flags:MessageFlags.Ephemeral});
   const create=i.options.getSubcommand()==='crear';if(create&&!owner(i))return i.reply({content:'Solo el propietario del bot.',flags:MessageFlags.Ephemeral});
   await i.deferReply({flags:MessageFlags.Ephemeral});
   if(create){const key=randomBytes(24).toString('base64url');await store.query('commerce_keys','insert',{hash:createHash('sha256').update(key).digest('hex'),sku:i.options.getString('tipo'),days:i.options.getInteger('dias'),expires_at:new Date(Date.now()+30*86400000).toISOString()});return i.editReply('Clave de un uso (canjear dentro de 30 días): `'+key+'`');}
   const hash=createHash('sha256').update(i.options.getString('clave').trim()).digest('hex');const r=await store.action(i.guildId,i.user.id,i.id,'key',{hash});return i.editReply(r.status==='activated'?t(`✅ Premium activado por ${r.days} días.`,`✅ Premium enabled for ${r.days} days.`):r.status==='credited'?t('✅ Paquete acreditado. Consulta `$pokewallet`.','✅ Pack credited. Check your wallet.'):t('Clave inválida, usada o expirada.','Invalid, used or expired key.'));
 }},
};
async function handle(i){
 if(!store.enabled())return i.reply({content:t('La tienda no está disponible.','Shop unavailable.'),flags:MessageFlags.Ephemeral});
 const [type,user,id]=i.customId.split(':');
 if(i.user.id!==user)return i.reply({content:t('Este panel pertenece a otra persona.','This panel belongs to another person.'),flags:MessageFlags.Ephemeral});
 if(type==='paycheck')return verifyPayment(i,user,id);
 await i.deferReply({flags:MessageFlags.Ephemeral});
 try{
  if(type==='pokeshop'){
   const sku=i.values[0],c=await paypal.createCheckout(i.guildId,user,sku);
   return await i.editReply({content:t('Abre PayPal para aprobar el pago. Después pulsa «Verificar pago».','Open PayPal to approve payment. Then press “Verify payment”.'),components:[new ActionRowBuilder().addComponents(new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('PayPal').setURL(c.url),new ButtonBuilder().setStyle(ButtonStyle.Primary).setLabel(t('Verificar pago','Verify payment')).setCustomId(`paycheck:${user}:${c.id}`))]});
  }
 }catch(e){console.error('[PayPal checkout]',e.message);await i.editReply(t('No se pudo abrir el pago. Si ya pagaste, consulta `$pokewallet` antes de iniciar otra compra.','Could not open payment. If already paid, check `$pokewallet` before starting another purchase.'));}
}
module.exports={commands,handle};
