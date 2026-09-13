// Optional build step. Runtime rolls never read/download sprites.
const { POKEMON_LIST, fetchSinglePokemonWithSprite } = require('../src/pokemonService');
const BATCH_SIZE = 8;

async function main() {
  let failed = 0;
  for (let i = 0; i < POKEMON_LIST.length; i += BATCH_SIZE) {
    await Promise.all(POKEMON_LIST.slice(i, i + BATCH_SIZE).map(async pokemon => {
      try {
        await fetchSinglePokemonWithSprite(pokemon.id);
      } catch (error) {
        failed++;
        console.error(`[Sprites] ${pokemon.id}: ${error.message}`);
      }
    }));
    process.stdout.write(`\r${Math.min(i + BATCH_SIZE, POKEMON_LIST.length)}/${POKEMON_LIST.length} comprobados`);
  }
  if (failed) throw new Error(`${failed} sprites no disponibles. Repite la descarga para completar los pendientes.`);
  console.log('\n✅ Catálogo de sprites completo.');
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
