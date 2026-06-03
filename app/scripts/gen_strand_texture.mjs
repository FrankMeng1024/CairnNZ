/**
 * Generate strand flow texture: app/assets/ar/strand_flow.png
 *
 * 128×512 vertical strip, tileable on V (top/bottom seamless). Pure white +
 * transparency: 3 horizontal hot bands at v=0.16, 0.50, 0.83 (Gaussian blobs)
 * over a soft white core gradient. Type-color tinting happens at material
 * level via diffuseColor multiplication.
 *
 * Why white-only: ViroMaterial Constant lighting + Add blendMode multiplies
 * diffuseTexture by diffuseColor. Keeping the texture neutral lets us reuse
 * one PNG across all 5 type colours instead of authoring 5.
 *
 * Run from app/:
 *   node scripts/gen_strand_texture.mjs
 */
import sharp from 'sharp';
import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, '..', 'assets', 'ar');

const W = 128, H = 512;

// Hot-spot centres in normalised v space + gaussian sigma in px.
// v2: tighter sigma + lower base + more spots = more pronounced flow packets,
// less continuous glow. v1 was too uniformly bright (read as solid white
// column). Now between hot bands the strand is dim, so when shader scrolls
// the texture the hot bands move as visible "particles".
const HOTS = [
  { v: 0.10, sigma: 22 },
  { v: 0.36, sigma: 26 },
  { v: 0.62, sigma: 26 },
  { v: 0.88, sigma: 22 },
];

// Cross-section profile: brightest at u=0.5, fades to 0 at edges.
// Modeled as smoothstep curve, NOT pure linear, so the strand has soft edges
// without obvious banding.
function uProfile(u /* 0..1 */) {
  const x = (u - 0.5) * 2; // -1..1
  // smooth bell: cos^2(pi*x/2) → 1 at center, 0 at edges
  return Math.cos((Math.PI * x) / 2) ** 2;
}

function vProfile(v /* 0..1 */) {
  // sum of four Gaussians + a very faint base ridge. Lower base than v1
  // so dark bands between hot spots are clearly dim — flow effect needs
  // contrast to read.
  let s = 0.04; // was 0.18 — much darker between hot spots
  for (const { v: hv, sigma } of HOTS) {
    const dv = (v - hv) * H; // px distance
    s += Math.exp(-(dv * dv) / (2 * sigma * sigma));
  }
  return Math.min(1.0, s);
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });

  // Build raw RGBA buffer
  const buf = Buffer.alloc(W * H * 4);
  for (let y = 0; y < H; y++) {
    const v = y / H;
    const vp = vProfile(v);
    for (let x = 0; x < W; x++) {
      const u = x / W;
      const up = uProfile(u);
      const a = Math.round(255 * vp * up);
      const idx = (y * W + x) * 4;
      buf[idx + 0] = 255; // R
      buf[idx + 1] = 255; // G
      buf[idx + 2] = 255; // B
      buf[idx + 3] = a;   // A — drives Add-blend brightness
    }
  }

  // Seam-clamp: copy bottom 8 rows alpha onto top 8 rows so V-tiling has no
  // visible discontinuity. (vProfile is technically already periodic-friendly
  // since both 0.16 and 0.83 hot spots are symmetric, but explicit clamp is
  // cheap insurance.)
  const SEAM_H = 8;
  for (let y = 0; y < SEAM_H; y++) {
    for (let x = 0; x < W; x++) {
      const topIdx = (y * W + x) * 4 + 3;
      const botIdx = ((H - SEAM_H + y) * W + x) * 4 + 3;
      // Average the two so both edges land at the same value
      const avg = Math.round((buf[topIdx] + buf[botIdx]) / 2);
      buf[topIdx] = avg;
      buf[botIdx] = avg;
    }
  }

  const png = await sharp(buf, { raw: { width: W, height: H, channels: 4 } })
    .png()
    .toBuffer();
  const out = join(OUT_DIR, 'strand_flow.png');
  await writeFile(out, png);
  console.log(`wrote ${out}  (${png.length} bytes, ${W}x${H} RGBA)`);
}

main().catch(e => { console.error(e); process.exit(1); });
