/**
 * Generate 3 sprite assets used by 5 strand variants in v150 A/B test.
 *
 * Outputs to app/assets/ar/:
 *   - sprite_streak.png      (64×256 — vertical light streak for danger particles)
 *   - sprite_dot.png         (64×64  — round soft glow for supply particles)
 *   - flow_gradient.png      (64×512 — vertical noise+hot-bands for scenic shader)
 *
 * Run from app/:
 *   node scripts/gen_v150_sprites.mjs
 */
import sharp from 'sharp';
import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, '..', 'assets', 'ar');

// ── 1. Streak (vertical light streak for particle sprites) ─────────
async function genStreak() {
  const W = 64, H = 256;
  const buf = Buffer.alloc(W * H * 4);
  for (let y = 0; y < H; y++) {
    const v = y / H;
    // Bright in middle 60%, fade ends
    const vEnvelope = Math.min(1, Math.sin(v * Math.PI) * 1.5);
    for (let x = 0; x < W; x++) {
      const u = x / W;
      const uEnvelope = Math.cos((u - 0.5) * Math.PI);  // bell across width
      const a = Math.round(255 * vEnvelope * uEnvelope);
      const idx = (y * W + x) * 4;
      buf[idx + 0] = 255;
      buf[idx + 1] = 255;
      buf[idx + 2] = 255;
      buf[idx + 3] = a;
    }
  }
  const png = await sharp(buf, { raw: { width: W, height: H, channels: 4 } }).png().toBuffer();
  await writeFile(join(OUT_DIR, 'sprite_streak.png'), png);
  console.log(`wrote sprite_streak.png ${png.length}b`);
}

// ── 2. Dot (round soft glow for floating-light particles) ──────────
async function genDot() {
  const W = 64, H = 64;
  const buf = Buffer.alloc(W * H * 4);
  const cx = W / 2, cy = H / 2;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const dx = (x - cx) / cx;
      const dy = (y - cy) / cy;
      const d = Math.sqrt(dx * dx + dy * dy);
      // Soft Gaussian falloff
      const a = Math.round(255 * Math.max(0, 1 - d) ** 2);
      const idx = (y * W + x) * 4;
      buf[idx + 0] = 255;
      buf[idx + 1] = 255;
      buf[idx + 2] = 255;
      buf[idx + 3] = a;
    }
  }
  const png = await sharp(buf, { raw: { width: W, height: H, channels: 4 } }).png().toBuffer();
  await writeFile(join(OUT_DIR, 'sprite_dot.png'), png);
  console.log(`wrote sprite_dot.png ${png.length}b`);
}

// ── 3. Flow gradient (for scenic UV-scroll shader) ─────────────────
async function genFlow() {
  const W = 64, H = 512;
  const buf = Buffer.alloc(W * H * 4);
  // 4 hot bands at different v positions
  const HOTS = [0.10, 0.35, 0.62, 0.88];
  for (let y = 0; y < H; y++) {
    const v = y / H;
    let s = 0.05;  // dim base
    for (const hv of HOTS) {
      const dv = (v - hv) * H;
      s += Math.exp(-(dv * dv) / (2 * 24 * 24));
    }
    s = Math.min(1, s);
    for (let x = 0; x < W; x++) {
      const u = x / W;
      const uEnv = Math.cos((u - 0.5) * Math.PI) ** 0.7;  // narrower than streak
      const a = Math.round(255 * s * uEnv);
      const idx = (y * W + x) * 4;
      buf[idx + 0] = 255;
      buf[idx + 1] = 255;
      buf[idx + 2] = 255;
      buf[idx + 3] = a;
    }
  }
  // Seam-clamp top+bottom for tileable scroll
  const SEAM = 6;
  for (let y = 0; y < SEAM; y++) {
    for (let x = 0; x < W; x++) {
      const top = (y * W + x) * 4 + 3;
      const bot = ((H - SEAM + y) * W + x) * 4 + 3;
      const avg = Math.round((buf[top] + buf[bot]) / 2);
      buf[top] = avg;
      buf[bot] = avg;
    }
  }
  const png = await sharp(buf, { raw: { width: W, height: H, channels: 4 } }).png().toBuffer();
  await writeFile(join(OUT_DIR, 'flow_gradient.png'), png);
  console.log(`wrote flow_gradient.png ${png.length}b`);
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  await genStreak();
  await genDot();
  await genFlow();
  console.log('Done.');
}
main().catch(e => { console.error(e); process.exit(1); });
