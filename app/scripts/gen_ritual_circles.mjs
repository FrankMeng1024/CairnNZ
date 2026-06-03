/**
 * Generate 5 ritual circle PNGs (one per type) into app/assets/ar/
 * Uses sharp (already a dependency) to rasterize SVG → PNG.
 *
 * Run from app dir:
 *   node scripts/gen_ritual_circles.mjs
 */
import sharp from 'sharp';
import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
// __dirname = .../app/scripts → assets/ar is at ../assets/ar
const OUT_DIR = join(__dirname, '..', 'assets', 'ar');

const TYPES = {
  danger:   { color: '#ff6a55', accent: '#ffaa66' },
  supply:   { color: '#5fcc7a', accent: '#a0e8b0' },
  junction: { color: '#ffa040', accent: '#ffd080' },
  scenic:   { color: '#7090ff', accent: '#a8c0ff' },
  cairn:    { color: '#d4a050', accent: '#f0c890' },
};

const SIZE = 1024;

function iconSvg(type, color, accent, scale = 0.20) {
  const s = SIZE * scale;
  switch (type) {
    case 'danger':
      return `
        <g filter="url(#glow)">
          <path d="M 0 ${-s*0.55} C ${s*0.45} ${-s*0.15} ${s*0.42} ${s*0.45} 0 ${s*0.55}
                   C ${-s*0.42} ${s*0.45} ${-s*0.45} ${-s*0.15} 0 ${-s*0.55} Z"
                fill="${color}"/>
          <path d="M 0 ${-s*0.30} C ${s*0.22} 0 ${s*0.18} ${s*0.30} 0 ${s*0.35}
                   C ${-s*0.18} ${s*0.30} ${-s*0.22} 0 0 ${-s*0.30} Z"
                fill="${accent}"/>
        </g>`;
    case 'supply':
      return `
        <g filter="url(#glow)">
          <path d="M 0 ${-s*0.55} C ${s*0.50} ${-s*0.10} ${s*0.42} ${s*0.50} 0 ${s*0.55}
                   C ${-s*0.42} ${s*0.50} ${-s*0.50} ${-s*0.10} 0 ${-s*0.55} Z"
                fill="${color}"/>
          <ellipse cx="${-s*0.13}" cy="${s*0.10}" rx="${s*0.08}" ry="${s*0.18}" fill="${accent}"/>
        </g>`;
    case 'junction':
      return `
        <g filter="url(#glow)" stroke="${color}" stroke-width="${s*0.18}" stroke-linecap="round" stroke-linejoin="round" fill="none">
          <line x1="${-s*0.40}" y1="${s*0.40}" x2="${s*0.35}" y2="${-s*0.35}"/>
          <polyline points="${s*0.10},${-s*0.45} ${s*0.45},${-s*0.45} ${s*0.45},${-s*0.10}"/>
        </g>`;
    case 'scenic':
      return `
        <g filter="url(#glow)">
          <polygon points="${-s*0.55},${s*0.40} ${-s*0.20},${-s*0.35} ${s*0.05},${s*0.05} ${s*0.30},${-s*0.50} ${s*0.60},${s*0.40}"
                   fill="${color}"/>
          <polygon points="${s*0.30},${-s*0.50} ${s*0.20},${-s*0.20} ${s*0.40},${-s*0.20}" fill="${accent}"/>
        </g>`;
    case 'cairn': {
      const stone = (y, w, h, fill) => {
        const r = h * 0.4;
        return `<rect x="${-w/2}" y="${y - h/2}" width="${w}" height="${h}" rx="${r}" ry="${r}" fill="${fill}"/>`;
      };
      return `
        <g filter="url(#glow)">
          ${stone(s*0.30, s*0.85, s*0.32, color)}
          ${stone(s*0.00, s*0.65, s*0.28, color)}
          ${stone(-s*0.28, s*0.45, s*0.24, accent)}
        </g>`;
    }
  }
  return '';
}

function ringSvg(type) {
  const { color, accent } = TYPES[type];
  const cx = SIZE / 2, cy = SIZE / 2;
  const ticks12 = Array.from({ length: 12 }, (_, i) => {
    const a = (i / 12) * Math.PI * 2;
    const r1 = SIZE * 0.42, r2 = SIZE * 0.46;
    return `<line x1="${cx + Math.cos(a) * r1}" y1="${cy + Math.sin(a) * r1}"
                  x2="${cx + Math.cos(a) * r2}" y2="${cy + Math.sin(a) * r2}"
                  stroke="${accent}" stroke-width="6" stroke-linecap="round" opacity="0.85"/>`;
  }).join('');
  const ticks24 = Array.from({ length: 24 }, (_, i) => {
    const a = (i / 24) * Math.PI * 2;
    const r1 = SIZE * 0.46, r2 = SIZE * 0.49;
    return `<line x1="${cx + Math.cos(a) * r1}" y1="${cy + Math.sin(a) * r1}"
                  x2="${cx + Math.cos(a) * r2}" y2="${cy + Math.sin(a) * r2}"
                  stroke="${color}" stroke-width="3" stroke-linecap="round" opacity="0.5"/>`;
  }).join('');

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">
  <defs>
    <radialGradient id="outerGlow" cx="50%" cy="50%" r="50%">
      <stop offset="60%" stop-color="${color}" stop-opacity="0"/>
      <stop offset="84%" stop-color="${color}" stop-opacity="0.18"/>
      <stop offset="100%" stop-color="${color}" stop-opacity="0"/>
    </radialGradient>
    <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur stdDeviation="6" result="b"/>
      <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
    <filter id="ringGlow" x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur stdDeviation="14" result="b"/>
      <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
  </defs>

  <rect width="${SIZE}" height="${SIZE}" fill="url(#outerGlow)"/>

  <circle cx="${cx}" cy="${cy}" r="${SIZE * 0.42}" fill="none"
          stroke="${accent}" stroke-width="12" opacity="0.95" filter="url(#ringGlow)"/>

  <circle cx="${cx}" cy="${cy}" r="${SIZE * 0.30}" fill="none"
          stroke="${color}" stroke-width="4" opacity="0.7" filter="url(#glow)"/>

  <g filter="url(#glow)">${ticks12}</g>
  <g>${ticks24}</g>

  <circle cx="${cx}" cy="${cy}" r="${SIZE * 0.36}" fill="none"
          stroke="${color}" stroke-width="3" stroke-dasharray="16,12" opacity="0.5"/>

  <g transform="translate(${cx},${cy})">
    ${iconSvg(type, color, accent)}
  </g>
</svg>`;
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  for (const type of Object.keys(TYPES)) {
    const svg = ringSvg(type);
    const png = await sharp(Buffer.from(svg)).png().toBuffer();
    const out = join(OUT_DIR, `ritual_circle_${type}.png`);
    await writeFile(out, png);
    console.log(`wrote ${out}  (${png.length} bytes)`);
  }
  console.log('\nDone. Files written to:', OUT_DIR);
}

main().catch(e => { console.error(e); process.exit(1); });
