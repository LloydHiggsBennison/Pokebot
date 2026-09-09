// Script de build: descarga todos los sprites a data/sprites/ para que el bot
// no tenga que descargarlos en tiempo real. Render cachea esta carpeta entre deploys.
// Uso: node scripts/download-sprites.js

const fs   = require('fs');
const path = require('path');

const POKEMON_LIST = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'data', 'pokemon.json'), 'utf8')
);

const SPRITES_DIR = path.join(__dirname, '..', 'data', 'sprites');
const BATCH_SIZE  = 30; // descargas en paralelo

fs.mkdirSync(SPRITES_DIR, { recursive: true });

async function downloadOne(pokemon) {
  const filePath = path.join(SPRITES_DIR, `${pokemon.id}.png`);
  if (fs.existsSync(filePath)) return; // ya está en caché

  try {
    const res = await fetch(pokemon.spriteUrl);
    if (!res.ok) return;
    const buf = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(filePath, buf);
  } catch (_) {}
}

async function main() {
  const missing = POKEMON_LIST.filter(p => !fs.existsSync(path.join(SPRITES_DIR, `${p.id}.png`)));

  if (missing.length === 0) {
    console.log(`✅ Todos los sprites ya están en caché (${POKEMON_LIST.length} Pokémon).`);
    return;
  }

  console.log(`Descargando ${missing.length} sprites a data/sprites/...`);

  for (let i = 0; i < missing.length; i += BATCH_SIZE) {
    const batch = missing.slice(i, i + BATCH_SIZE);
    await Promise.all(batch.map(downloadOne));
    process.stdout.write(`\r  → ${Math.min(i + BATCH_SIZE, missing.length)}/${missing.length} sprites...`);
  }

  const total = fs.readdirSync(SPRITES_DIR).length;
  console.log(`\n✅ ${total} sprites listos en data/sprites/`);
}

main().catch(console.error);
