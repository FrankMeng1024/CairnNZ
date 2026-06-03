/**
 * Generate strand sprite PNG into app/assets/ar/strand_sprite.png
 *
 * v2: thicker, warmer-coloured ribbon. The previous v1 was too thin and
 * too white — additive blending stacked the colour up to pure white in
 * AR. v2 is wider (3:8 aspect), uses a warm deep-amber base so the
 * additive stack lands on golden yellow (DS aesthetic) instead of
 * blowing out to white.
 *
 * Run from app dir:
 *   node scripts/gen_strand_sprite.mjs
 */
import sharp from 'sharp';
import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, '..', 'assets', 'ar');

// 256×512: wider than v1 (was 128×512). The taller-than-wide ratio still
// reads as a vertical streak, but the extra width means each particle is
// more visible at distance and the soft horizontal taper is more present.
const W = 256, H = 512;

const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <!-- Vertical taper: deep amber edges, warm gold core. NOT pure white —
         additive blending in AR will stack this toward yellow-white, not
         saturated white. -->
    <linearGradient id="taper" x1="0" y1="0" x2="0" y2="${H}">
      <stop offset="0%"   stop-color="#d4a050" stop-opacity="0"/>
      <stop offset="15%"  stop-color="#d4a050" stop-opacity="0.7"/>
      <stop offset="50%"  stop-color="#e8b860" stop-opacity="1.0"/>
      <stop offset="85%"  stop-color="#d4a050" stop-opacity="0.7"/>
      <stop offset="100%" stop-color="#d4a050" stop-opacity="0"/>
    </linearGradient>
    <!-- Horizontal soft mask: feather edges so each particle blends with
         neighbours instead of stacking as visible rectangles. -->
    <linearGradient id="hsoft" x1="0" y1="0" x2="${W}" y2="0">
      <stop offset="0%"   stop-color="#ffffff" stop-opacity="0"/>
      <stop offset="20%"  stop-color="#ffffff" stop-opacity="0.4"/>
      <stop offset="50%"  stop-color="#ffffff" stop-opacity="1"/>
      <stop offset="80%"  stop-color="#ffffff" stop-opacity="0.4"/>
      <stop offset="100%" stop-color="#ffffff" stop-opacity="0"/>
    </linearGradient>
    <mask id="hmask">
      <rect width="${W}" height="${H}" fill="url(#hsoft)"/>
    </mask>
    <filter id="blur" x="-10%" y="-5%" width="120%" height="110%">
      <feGaussianBlur stdDeviation="10"/>
    </filter>
  </defs>

  <!-- Wide soft halo (deep amber) -->
  <rect width="${W}" height="${H}" fill="url(#taper)" mask="url(#hmask)" filter="url(#blur)" opacity="0.85"/>

  <!-- Mid spine (warm gold) -->
  <rect x="${W * 0.32}" y="0" width="${W * 0.36}" height="${H}"
        fill="url(#taper)" mask="url(#hmask)" filter="url(#blur)" opacity="0.95"/>

  <!-- Hot core, narrow and slightly dimmer than v1 to avoid white-out -->
  <rect x="${W * 0.44}" y="${H * 0.10}" width="${W * 0.12}" height="${H * 0.80}"
        fill="#ffe0a0" opacity="0.85" filter="url(#blur)"/>
</svg>`;

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  const png = await sharp(Buffer.from(svg)).png().toBuffer();
  const out = join(OUT_DIR, 'strand_sprite.png');
  await writeFile(out, png);
  console.log(`wrote ${out}  (${png.length} bytes)`);
}

main().catch(e => { console.error(e); process.exit(1); });
