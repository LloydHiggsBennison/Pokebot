const sharp = require('sharp');

const CELL_SIZE = 96;
const INDICATOR_SIZE = 56;
const PADDING = 8;
const POKE_COLS = 3;

function checkmarkSvg(size) {
  return Buffer.from(`
    <svg width="${size}" height="${size}">
      <polyline points="${size * 0.15},${size * 0.5} ${size * 0.4},${size * 0.78} ${size * 0.85},${size * 0.2}"
                fill="none" stroke="#3ba55d" stroke-width="9" stroke-linecap="round" stroke-linejoin="round" />
    </svg>
  `);
}

function crossSvg(size) {
  return Buffer.from(`
    <svg width="${size}" height="${size}">
      <line x1="${size * 0.15}" y1="${size * 0.15}" x2="${size * 0.85}" y2="${size * 0.85}"
            stroke="#ed4245" stroke-width="9" stroke-linecap="round" />
      <line x1="${size * 0.85}" y1="${size * 0.15}" x2="${size * 0.15}" y2="${size * 0.85}"
            stroke="#ed4245" stroke-width="9" stroke-linecap="round" />
    </svg>
  `);
}

// rows: [{ items: [{spriteBuffer}, {spriteBuffer}, {spriteBuffer}], isWinner: bool }, ...]
async function buildPuzzleImage(rows) {
  const numRows = rows.length;
  const gridWidth = POKE_COLS * CELL_SIZE + (POKE_COLS + 1) * PADDING;
  const width = gridWidth + INDICATOR_SIZE + PADDING;
  const height = numRows * CELL_SIZE + (numRows + 1) * PADDING;

  const composites = [];

  for (let r = 0; r < numRows; r++) {
    const row = rows[r];
    const top = PADDING + r * (CELL_SIZE + PADDING);

    for (let c = 0; c < POKE_COLS; c++) {
      const left = PADDING + c * (CELL_SIZE + PADDING);
      const spriteBuffer = await sharp(row.items[c].spriteBuffer)
        .resize(CELL_SIZE, CELL_SIZE, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .png()
        .toBuffer();
      composites.push({ input: spriteBuffer, left, top });
    }

    const indicatorLeft = Math.round(gridWidth);
    const indicatorTop = Math.round(top + (CELL_SIZE - INDICATOR_SIZE) / 2);
    const indicatorSvg = row.isWinner ? checkmarkSvg(INDICATOR_SIZE) : crossSvg(INDICATOR_SIZE);
    composites.push({ input: indicatorSvg, left: indicatorLeft, top: indicatorTop });
  }

  return sharp({
    create: { width: Math.round(width), height, channels: 4, background: { r: 35, g: 36, b: 41, alpha: 1 } },
  })
    .composite(composites)
    .png()
    .toBuffer();
}

module.exports = { buildPuzzleImage };