// Prueba local de la lógica del bot, sin conexión real a Discord ni a PokeAPI.

// 1) Mockeamos pokemonService ANTES de que spawnManager lo requiera,
//    para no depender de la red.
const pokemonServicePath = require.resolve('../src/pokemonService');
require.cache[pokemonServicePath] = {
  id: pokemonServicePath,
  filename: pokemonServicePath,
  loaded: true,
  exports: {
    getRandomPokemon: async () => ({ id: 25, name: 'pikachu', image: 'https://fake.url/pikachu.png' }),
  },
};

const { updateGuildSettings, getGuildSettings, getUserCaptures } = require('../src/database');
const { handleMessage, tryCatch } = require('../src/spawnManager');

const GUILD_ID = 'test-guild-1';
const CHANNEL_ID = 'test-channel-1';
const USER_ID = 'test-user-1';

let sentEmbeds = 0;

// Cliente falso: solo necesita channels.fetch(id) -> objeto con .send()
const fakeClient = {
  channels: {
    async fetch(id) {
      if (id !== CHANNEL_ID) return null;
      return {
        async send(payload) {
          sentEmbeds += 1;
          const embed = payload.embeds[0].data;
          console.log(`  📨 Bot publicó spawn #${sentEmbeds} -> título: "${embed.title}"`);
        },
      };
    },
  },
};

function fakeMessage(content) {
  return {
    author: { bot: false, id: USER_ID },
    guild: { id: GUILD_ID },
    content,
  };
}

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

(async () => {
  console.log('=== TEST 1: configuración inicial ===');
  await updateGuildSettings(GUILD_ID, {
    spawn_channel_id: CHANNEL_ID,
    mode: 'messages',
    msg_min: 3,
    msg_max: 3, // umbral fijo = 3 para que la prueba sea determinista
    enabled: 1,
  });
  console.log('Config guardada:', await getGuildSettings(GUILD_ID));

  console.log('\n=== TEST 2: contador de mensajes dispara el spawn al 3er mensaje ===');
  await handleMessage(fakeClient, fakeMessage('hola'));
  await handleMessage(fakeClient, fakeMessage('qué tal'));
  console.log(`  (van 2 mensajes, no debería haber spawn aún: ${sentEmbeds === 0 ? 'OK ✅' : 'FALLÓ ❌'})`);
  await handleMessage(fakeClient, fakeMessage('tercer mensaje'));

  // spawnPokemon es async (fetch + send), damos tiempo a que resuelva
  await sleep(50);
  console.log(`  (debería haber 1 spawn: ${sentEmbeds === 1 ? 'OK ✅' : 'FALLÓ ❌'})`);

  console.log('\n=== TEST 3: intento de captura fallido ===');
  const fallo = tryCatch(GUILD_ID, 'charmander');
  console.log(`  Intento con nombre incorrecto -> ${fallo === null ? 'rechazado correctamente ✅' : 'FALLÓ ❌ (no debería atrapar)'}`);

  console.log('\n=== TEST 4: captura correcta ===');
  const exito = tryCatch(GUILD_ID, 'pikachu');
  console.log('  Resultado:', exito);
  console.log(`  -> ${exito && exito.name === 'pikachu' ? 'Captura exitosa ✅' : 'FALLÓ ❌'}`);

  console.log('\n=== TEST 5: no se puede capturar dos veces el mismo spawn ===');
  const segundoIntento = tryCatch(GUILD_ID, 'pikachu');
  console.log(`  -> ${segundoIntento === null ? 'Correcto, ya no hay spawn activo ✅' : 'FALLÓ ❌'}`);

  console.log('\n=== TEST 6: el contador se reinicia tras el spawn (necesitan 3 mensajes más) ===');
  sentEmbeds = 0;
  await handleMessage(fakeClient, fakeMessage('uno'));
  await handleMessage(fakeClient, fakeMessage('dos'));
  console.log(`  (2 mensajes, aún sin spawn: ${sentEmbeds === 0 ? 'OK ✅' : 'FALLÓ ❌'})`);
  await handleMessage(fakeClient, fakeMessage('tres'));
  await sleep(50);
  console.log(`  (3er mensaje dispara nuevo spawn: ${sentEmbeds === 1 ? 'OK ✅' : 'FALLÓ ❌'})`);

  console.log('\n=== TEST 7: cambio de configuración vía updateGuildSettings ===');
  await updateGuildSettings(GUILD_ID, { catch_command: ',catch' });
  const settings = await getGuildSettings(GUILD_ID);
  console.log(`  Comando de captura actualizado -> ${settings.catch_command === ',catch' ? 'OK ✅' : 'FALLÓ ❌'}`);

  console.log('\n✅ Todas las pruebas ejecutadas.');
  process.exit(0);
})();
