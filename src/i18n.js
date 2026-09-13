const { AsyncLocalStorage } = require('node:async_hooks');
const context = new AsyncLocalStorage();
const preferences = new Map();
const t = (es,en) => context.getStore() === 'en' ? en : es;
const languageFor = (user,guild) => preferences.get('user:'+user) || preferences.get('guild:'+guild) || 'es';
const guildLanguage = guild => preferences.get('guild:'+guild) || 'es';
const withLanguage = (language,fn) => context.run(language === 'en' ? 'en' : 'es',fn);
async function initializeLanguages() {
  const rows = await require('./economy').loadLanguages();
  for (const row of rows) preferences.set(row.scope_id,row.language);
}
async function setLanguage(scope, language) {
  await require('./economy').saveLanguage(scope,language);
  preferences.set(scope,language);
}
module.exports={t,languageFor,guildLanguage,withLanguage,initializeLanguages,setLanguage};

