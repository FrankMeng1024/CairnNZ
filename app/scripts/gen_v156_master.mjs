/**
 * v156 master strand sprite — the single texture all 5 type variants reuse.
 *
 * Subagent diagnosis on v155: "rendering geometry not light". Five separate
 * primitives (cylinders, polylines) without a shared sprite + shader pipeline
 * = no DS chiral feel. Fix: one painted sprite carrying the radial alpha
 * falloff, internal noise, and hot-white core. Each type tints + animates
 * the same sprite differently.
 *
 * Output: app/assets/ar/strand_master.png  (256×1024)
 *
 * Channels: RGB = white-to-warm gradient (tint multiplier baked at 1.0),
 *           A   = vertical streak envelope × radial bell × noise pockets.
 *
 * Run from app/:
 *   node scripts/gen_v156_master.mjs
 */
import sharp from 'sharp';
import { writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, '..', 'assets', 'ar');

// Deterministic value-noise (seedable, no Math.random — reproducible builds)
function hash(x, y) {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}
function smoothNoise(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const a = hash(xi, yi);
  const b = hash(xi + 1, yi);
  const c = hash(xi, yi + 1);
  const d = hash(xi + 1, yi + 1);
  return a * (1 - u) * (1 - v) + b * u * (1 - v) + c * (1 - u) * v + d * u * v;
}

async function genMaster() {
  const W = 256, H = 1024;
  const buf = Buffer.alloc(W * H * 4);

  for (let y = 0; y < H; y++) {
    const v = y / H;                       // 0=bottom, 1=top
    // Vertical envelope: bright base, taper at top, soft fade at bottom
    // sin(v*PI) bell biased upward via sqrt — DS strands bloom mid-upper
    const bell = Math.sin(v * Math.PI);
    const vEnv = Math.pow(bell, 0.7);

    for (let x = 0; x < W; x++) {
      const u = x / W;                     // 0=left, 1=right
      // Radial bell across width — sharp center, soft edge
      const dx = (u - 0.5) * 2.0;          // -1..1
      const uEnv = Math.exp(-dx * dx * 6.0); // gaussian, sigma~0.4

      // Internal noise — multi-octave for organic light streaks
      const n1 = smoothNoise(u * 3.0, v * 14.0);
      const n2 = smoothNoise(u * 6.0, v * 28.0) * 0.5;
      const n3 = smoothNoise(u * 12.0, v * 56.0) * 0.25;
      const noise = (n1 + n2 + n3) / 1.75;
      // Use noise to carve hot pockets — rare, bright
      const hotPocket = Math.pow(Math.max(0, noise - 0.55) * 2.5, 1.3);

      // Final alpha — radial × vertical × (base + hot pockets)
      const baseAlpha = uEnv * vEnv * (0.55 + 0.45 * noise);
      const alpha = Math.min(1, baseAlpha + hotPocket * uEnv * vEnv * 0.7);

      // RGB carries a subtle warm-to-cold ramp so tint multiplication
      // produces depth (not flat colour). Hot pockets push toward white.
      const warmth = 1.0 - v * 0.15;        // slight cool toward top
      const r = Math.min(255, Math.round(255 * (warmth + hotPocket * 0.5)));
      const g = Math.min(255, Math.round(255 * (warmth * 0.96 + hotPocket * 0.6)));
      const b = Math.min(255, Math.round(255 * (warmth * 0.88 + hotPocket * 0.8)));

      const idx = (y * W + x) * 4;
      buf[idx + 0] = r;
      buf[idx + 1] = g;
      buf[idx + 2] = b;
      buf[idx + 3] = Math.round(255 * alpha);
    }
  }

  const png = await sharp(buf, { raw: { width: W, height: H, channels: 4 } })
    .png({ compressionLevel: 9 })
    .toBuffer();
  await writeFile(join(OUT_DIR, 'strand_master.png'), png);
  console.log(`wrote strand_master.png ${png.length}b (${W}x${H})`);
}

// Particle ember sprite — small additive blob for tip/crown sparks
async function genEmber() {
  const W = 64, H = 64;
  const buf = Buffer.alloc(W * H * 4);
  const cx = W / 2, cy = H / 2;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const dx = (x - cx) / cx;
      const dy = (y - cy) / cy;
      const d = Math.sqrt(dx * dx + dy * dy);
      // Hot core + soft halo, double-falloff for bloom-friendly shape
      const core = Math.exp(-d * d * 8);
      const halo = Math.exp(-d * d * 1.8) * 0.5;
      const a = Math.min(1, core + halo);
      const idx = (y * W + x) * 4;
      buf[idx + 0] = 255;
      buf[idx + 1] = 255;
      buf[idx + 2] = 255;
      buf[idx + 3] = Math.round(255 * a);
    }
  }
  const png = await sharp(buf, { raw: { width: W, height: H, channels: 4 } }).png().toBuffer();
  await writeFile(join(OUT_DIR, 'strand_ember.png'), png);
  console.log(`wrote strand_ember.png ${png.length}b (${W}x${H})`);
}

await genMaster();
await genEmber();
console.log('v156 sprites generated.');
