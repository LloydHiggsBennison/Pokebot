const {SlashCommandBuilder,MessageFlags,ActionRowBuilder,ButtonBuilder,ButtonStyle,StringSelectMenuBuilder}=require('discord.js');
const {randomBytes,createHash}=require('node:crypto');
const store=require('./commerceStore'),paypal=require('./paypal');
const {PRODUCTS}=require('./commerceCatalog');
const {t}=require('./i18n');
const owner=i=>i.user.id===(process.env.BOT_OWNER_ID||'468832874066608135');
const setupLocks=new Set();
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
 await i.deferReply({flags:MessageFlags.Ephemeral});
 try{
  if(type==='pokeshop'){
   const sku=i.values[0],c=await paypal.createCheckout(i.guildId,user,sku);
   return await i.editReply({content:t('Abre PayPal para aprobar el pago. Después pulsa «Verificar pago».','Open PayPal to approve payment. Then press “Verify payment”.'),components:[new ActionRowBuilder().addComponents(new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('PayPal').setURL(c.url),new ButtonBuilder().setStyle(ButtonStyle.Primary).setLabel(t('Verificar pago','Verify payment')).setCustomId(`paycheck:${user}:${c.id}`))]});
  }
  const c=await store.query('commerce_checkouts','select',null,{id,user_id:user,guild_id:i.guildId});if(!c)throw Error('Unknown checkout');
  const r=await paypal.settle(c);return await i.editReply(r.pending?t('Pago aún no confirmado. Completa la aprobación en PayPal y vuelve a verificar.','Payment not confirmed yet. Complete PayPal approval and verify again.'):t('✅ Pago verificado. Beneficios acreditados una sola vez. Consulta `$pokewallet`.','✅ Payment verified. Benefits credited once. Check `$pokewallet`.'));
 }catch(e){console.error('[PayPal checkout]',e.message);await i.editReply(t('No se pudo confirmar el pago. Reintenta verificar la misma compra; no abras otro pago si ya pagaste.','Could not confirm payment. Retry verifying the same purchase; do not open another payment if you already paid.'));}
}
module.exports={commands,handle};
