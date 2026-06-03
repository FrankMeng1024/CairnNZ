/**
 * generate-icons.js — generate icon.png/adaptive-icon.png/splash-icon.png.
 *
 * MATCHES CairnLogo.tsx exactly:
 *   - White background (App Store icon spec)
 *   - Sage green stones (#5d7c46) — same colour as the in-app small logo
 *   - Asymmetric stone offsets (base right, mid left, top right) — same as
 *     the on-screen CairnLogo for visual consistency
 *   - Shadow arcs with same opacities (.18 / .22 / .26)
 *
 * No alpha on icon.png / adaptive-icon.png / favicon.png (App Store rejects
 * alpha-channel icons). Splash kept transparent so app.json's
 * splash.backgroundColor controls the rim.
 *
 * Run: node scripts/generate-icons.js
 */
const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

const ASSETS = path.join(__dirname, '..', 'assets');

const BG_LIGHT = '#ffffff'; // pure white background, matches in-app HomeScreen header
const STONE = '#5d7c46';    // sage green — Colors.primary, identical to CairnLogo default

/**
 * 3-stone cairn matching CairnLogo.tsx geometry.
 * Reference viewBox 18×24, asymmetric offsets:
 *   base   cx=9.5  cy=21   rx=7.5 ry=2.4
 *   middle cx=8.5  cy=15   rx=5.5 ry=2.0
 *   top    cx=11   cy=9.5  rx=3.4 ry=1.7
 * shadow opacities: .18 / .22 / .26 — same as CairnLogo
 */
function cairnSvgInner(size, scale = 0.55) {
  const cx = size / 2;
  const cy = size / 2;
  // Source viewBox is 18×24; scaled-up ratio across canvas
  const u = (scale * size) / 18;

  // Original visual centre is roughly (9.3, 15.5) — base stone widest at the
  // bottom dominates visual mass; bias slightly upward to centre on canvas.
  const ox = 9.3;
  const oy = 15.5;
  const project = (px, py) => ({ x: cx + (px - ox) * u, y: cy + (py - oy) * u });

  const stones = [
    { p: project(9.5, 21),  rx: 7.5 * u, ry: 2.4 * u, shadowOp: 0.18 },
    { p: project(8.5, 15),  rx: 5.5 * u, ry: 2.0 * u, shadowOp: 0.22 },
    { p: project(11,  9.5), rx: 3.4 * u, ry: 1.7 * u, shadowOp: 0.26 },
  ];

  return stones.map((s) => `
    <ellipse cx="${s.p.x}" cy="${s.p.y}" rx="${s.rx}" ry="${s.ry}" fill="${STONE}"/>
    <path d="M ${s.p.x - s.rx} ${s.p.y} a ${s.rx} ${s.ry} 0 0 0 ${s.rx * 2} 0" fill="${STONE}" opacity="${s.shadowOp}"/>
  `).join('');
}

function buildSvg(size, opts = { background: true, scale: 0.55 }) {
  const bg = opts.background ? `<rect width="${size}" height="${size}" fill="${BG_LIGHT}"/>` : '';
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  ${bg}
  ${cairnSvgInner(size, opts.scale ?? 0.55)}
</svg>`;
}

async function ensureAssetsDir() {
  if (!fs.existsSync(ASSETS)) fs.mkdirSync(ASSETS, { recursive: true });
}

async function main() {
  await ensureAssetsDir();

  // Apple App Store rejects icons with alpha channel — flatten onto white.
  const flatten = (svg) => sharp(Buffer.from(svg))
    .flatten({ background: BG_LIGHT })
    .png({ compressionLevel: 9 });

  // 1. icon.png — white square + sage stones (NO alpha)
  await flatten(buildSvg(1024, { background: true, scale: 0.55 }))
    .toFile(path.join(ASSETS, 'icon.png'));
  console.log('✓ icon.png (1024×1024, no alpha)');

  // 2. adaptive-icon.png — Android foreground; smaller scale for safe zone
  await flatten(buildSvg(1024, { background: true, scale: 0.40 }))
    .toFile(path.join(ASSETS, 'adaptive-icon.png'));
  console.log('✓ adaptive-icon.png (1024×1024, no alpha)');

  // 3. splash-icon.png — keep transparent (splash overlays bg color from app.json)
  await sharp(Buffer.from(buildSvg(1024, { background: false, scale: 0.50 })))
    .png()
    .toFile(path.join(ASSETS, 'splash-icon.png'));
  console.log('✓ splash-icon.png (1024×1024, transparent)');

  // 4. favicon.png — 48×48 web favicon
  await flatten(buildSvg(48, { background: true, scale: 0.55 }))
    .toFile(path.join(ASSETS, 'favicon.png'));
  console.log('✓ favicon.png (48×48, no alpha)');
}

main().catch((err) => {
  console.error('icon generation failed:', err);
  process.exit(1);
});
