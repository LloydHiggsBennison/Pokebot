// Script de un solo uso: descarga los datos de los 1025 Pokémon desde PokeAPI
// y los guarda en data/pokemon.json para que el bot no necesite llamar a PokeAPI nunca más.
//
// Uso: node scripts/fetch-all-pokemon.js

const fs = require('fs');
const path = require('path');

const MAX_ID = 1025;
const BATCH_SIZE = 50; // 50 peticiones en paralelo a la vez (sin sobrecargar)

async function fetchOne(id) {
  try {
    const res = await fetch(`https://pokeapi.co/api/v2/pokemon/${id}`);
    if (!res.ok) return null;
    const data = await res.json();
    const spriteUrl = data.sprites?.front_default || null;
    if (!spriteUrl) return null;
    return { id: data.id, name: data.name, spriteUrl };
  } catch (_) {
    return null;
  }
}

async function main() {
  console.log(`Descargando datos de ${MAX_ID} Pokémon desde PokeAPI...`);
  const all = [];

  for (let start = 1; start <= MAX_ID; start += BATCH_SIZE) {
    const end = Math.min(start + BATCH_SIZE - 1, MAX_ID);
    const ids = Array.from({ length: end - start + 1 }, (_, i) => start + i);
    process.stdout.write(`\r  → IDs ${start}-${end} (${all.length} listos)...`);

    const results = await Promise.all(ids.map(fetchOne));
    all.push(...results.filter(Boolean));
  }

  const outPath = path.join(__dirname, '..', 'data', 'pokemon.json');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(all));
  console.log(`\n✅ Guardados ${all.length} Pokémon en data/pokemon.json`);
}

main().catch(console.error);
