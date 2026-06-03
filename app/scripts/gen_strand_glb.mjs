/**
 * Generate 5 strand ribbon GLB meshes: app/assets/ar/strand_a..e.glb
 *
 * Each is a curved tube along a 5-control-point Catmull-Rom curve, 40m tall,
 * with along-length thickness modulation (0.18 → 0.30 → 0.18 m). Texture UVs
 * tile 4× along V so a texture scroll shader sees fast flow.
 *
 * Implementation: pure THREE.js (already in deps) for curve/tube generation,
 * then a hand-rolled minimal binary glTF (.glb) writer. NO new dependency.
 *
 * Run from app/:
 *   node scripts/gen_strand_glb.mjs
 *
 * GLB spec: https://github.com/KhronosGroup/glTF/tree/main/specification/2.0
 * - 12-byte header + JSON chunk + BIN chunk
 * - Mesh primitive uses TRIANGLES topology
 * - Accessors point into a single binary buffer for POSITION, NORMAL,
 *   TEXCOORD_0, INDICES.
 */
import * as THREE from 'three';
import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, '..', 'assets', 'ar');

// ── Strand parameters ─────────────────────────────────────────
// v7 (post-v148 user reaction "5/100"): radically simplify.
// User feedback: too thick, too chaotic, no DS-feel at all.
// Strategy: make strands LOOK like delicate threads of light, not pillars.
// - Tiny radius 0.012m (was 0.030 — 2.5× thinner)
// - Modest bulge so they swell only slightly mid-flight
// - Single low-frequency curve modulation (no 4-frequency chaos)
// - 5 control points (back from 7) — simple lazy S, not a tangle
// - Lower jitter ±0.20m (was ±0.55m) — strand stays near vertical
const STRAND_HEIGHT_M = 7;
const TUBULAR_SEGS = 80;
const RADIAL_SEGS = 6;
const BASE_RADIUS = 0.012;        // hair-thin
const RADIUS_BULGE = 0.012;       // doubles only at mid (0.024 max)
const RADIUS_WOBBLE = 0.003;
const UV_V_REPEAT = 2;

// Per-type GLB tinting. v4 (post-v142 visual debug): screenshots in
// debug_snapshots table proved Viro3DObject ignores the `materials` prop —
// strands rendered pure white regardless of registered material. Fix by
// baking colour into the GLB's own pbrMetallicRoughness.baseColorFactor,
// so the GLB ALREADY has the right colour without depending on Viro's
// material override path. Generate 5× as many GLBs (5 curves × 5 types).
const TYPE_TINTS = {
  // [r, g, b, a] in 0-1 linear space. emissive duplicates to give bloom-glow.
  danger:   [1.0, 0.30, 0.20, 1.0],   // red
  supply:   [0.30, 0.85, 0.45, 1.0],  // green
  junction: [1.0, 0.55, 0.15, 1.0],   // orange
  scenic:   [0.30, 0.45, 1.0, 1.0],   // blue
  cairn:    [0.95, 0.70, 0.30, 1.0],  // amber gold (DS canonical)
};
// 5 strand seeds — back to 5 control points, gentle ±0.20m jitter.
// Y values 0, 1.75, 3.5, 5.25, 7.0. Each strand has a SINGLE noticeable
// bend, not a knot. Strands a/b/c lean slightly different ways.
const SEEDS = [
  { name: 'a', jitter: [[ 0.05, 0.05], [ 0.18,-0.10], [-0.05, 0.18], [-0.10,-0.05], [ 0.05, 0.05]] },
  { name: 'b', jitter: [[-0.05, 0.05], [-0.18, 0.10], [ 0.10,-0.18], [ 0.05, 0.05], [-0.05,-0.05]] },
  { name: 'c', jitter: [[ 0.05,-0.05], [ 0.10, 0.18], [-0.18, 0.05], [ 0.05,-0.10], [-0.05, 0.05]] },
  { name: 'd', jitter: [[-0.05,-0.05], [ 0.20, 0.05], [ 0.05,-0.20], [-0.10, 0.10], [ 0.05, 0.05]] },
  { name: 'e', jitter: [[ 0.05, 0.05], [-0.10,-0.18], [ 0.20, 0.10], [-0.05,-0.10], [-0.05, 0.05]] },
];

// ── Build one strand geometry ─────────────────────────────────
function buildStrandGeometry(jitter) {
  // 5 control points, height 7m
  const ys = [0, 1.75, 3.5, 5.25, 7.0];
  const points = ys.map((y, i) => new THREE.Vector3(jitter[i][0], y, jitter[i][1]));
  const curve = new THREE.CatmullRomCurve3(points, false, 'catmullrom', 0.5);

  // Generate constant-radius tube first
  const tube = new THREE.TubeGeometry(curve, TUBULAR_SEGS, BASE_RADIUS, RADIAL_SEGS, false);

  // SINGLE-frequency thickness: bell curve (bulge mid, taper ends).
  // No more 4-frequency chaos — strand reads as a clean thread of light.
  const positions = tube.attributes.position.array;
  const ringVertCount = RADIAL_SEGS + 1;
  for (let s = 0; s <= TUBULAR_SEGS; s++) {
    const t = s / TUBULAR_SEGS;
    const bell = Math.sin(t * Math.PI);
    const rTarget = BASE_RADIUS + RADIUS_BULGE * bell + RADIUS_WOBBLE * Math.sin(t * Math.PI * 5);
    const radiusScale = rTarget / BASE_RADIUS;
    const centre = curve.getPoint(t);
    for (let r = 0; r < ringVertCount; r++) {
      const idx = (s * ringVertCount + r) * 3;
      const px = positions[idx + 0];
      const py = positions[idx + 1];
      const pz = positions[idx + 2];
      const dx = (px - centre.x) * radiusScale;
      const dy = (py - centre.y) * radiusScale;
      const dz = (pz - centre.z) * radiusScale;
      positions[idx + 0] = centre.x + dx;
      positions[idx + 1] = centre.y + dy;
      positions[idx + 2] = centre.z + dz;
    }
  }
  tube.attributes.position.needsUpdate = true;
  tube.computeVertexNormals();

  const uvs = tube.attributes.uv.array;
  for (let i = 0; i < uvs.length; i += 2) {
    uvs[i + 1] = uvs[i + 1] * UV_V_REPEAT;
  }

  // Per-vertex colour with ALPHA gradient. Even though Viro iOS may ignore
  // COLOR_0 alpha (we observed in v145), keep the attribute baked — if
  // some build/version DOES respect it the strand fades correctly. Cost:
  // 32KB per GLB.
  const vertexCount = tube.attributes.position.count;
  const colors = new Float32Array(vertexCount * 4);
  for (let s = 0; s <= TUBULAR_SEGS; s++) {
    const t = s / TUBULAR_SEGS;
    const alpha = Math.pow(1 - t, 1.2);  // gentler fade than 1.5
    for (let r = 0; r < ringVertCount; r++) {
      const vIdx = s * ringVertCount + r;
      colors[vIdx * 4 + 0] = 1;
      colors[vIdx * 4 + 1] = 1;
      colors[vIdx * 4 + 2] = 1;
      colors[vIdx * 4 + 3] = alpha;
    }
  }
  tube.setAttribute('color', new THREE.BufferAttribute(colors, 4));

  return tube;
}

// ── Minimal binary glTF (.glb) writer ─────────────────────────
// Layout:
//   Header (12 bytes)
//   JSON chunk
//   BIN chunk (POSITION + NORMAL + TEXCOORD_0 + COLOR_0 + INDICES)
function geometryToGLB(geom, tint) {
  const pos = geom.attributes.position.array;       // Float32Array, vec3
  const nrm = geom.attributes.normal.array;         // Float32Array, vec3
  const uv  = geom.attributes.uv.array;             // Float32Array, vec2
  const col = geom.attributes.color.array;          // Float32Array, vec4 (rgba)
  const idx = geom.index.array;                     // Uint32Array

  const vertexCount = pos.length / 3;

  // Per-attribute byte sizes
  const posBytes = pos.byteLength;
  const nrmBytes = nrm.byteLength;
  const uvBytes  = uv.byteLength;
  const colBytes = col.byteLength;
  const idxIsUint16 = vertexCount < 65536;
  const indices = idxIsUint16 ? new Uint16Array(idx) : new Uint32Array(idx);
  const idxBytes = indices.byteLength;

  // Pack into one binary buffer with 4-byte alignment per view
  const align = (n) => (n + 3) & ~3;
  const posOffset = 0;
  const nrmOffset = align(posOffset + posBytes);
  const uvOffset  = align(nrmOffset + nrmBytes);
  const colOffset = align(uvOffset + uvBytes);
  const idxOffset = align(colOffset + colBytes);
  const totalBin  = align(idxOffset + idxBytes);

  const bin = new Uint8Array(totalBin);
  bin.set(new Uint8Array(pos.buffer, pos.byteOffset, posBytes), posOffset);
  bin.set(new Uint8Array(nrm.buffer, nrm.byteOffset, nrmBytes), nrmOffset);
  bin.set(new Uint8Array(uv.buffer, uv.byteOffset, uvBytes), uvOffset);
  bin.set(new Uint8Array(col.buffer, col.byteOffset, colBytes), colOffset);
  bin.set(new Uint8Array(indices.buffer, indices.byteOffset, idxBytes), idxOffset);

  // Compute min/max for POSITION accessor (required by spec)
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < pos.length; i += 3) {
    if (pos[i + 0] < min[0]) min[0] = pos[i + 0];
    if (pos[i + 1] < min[1]) min[1] = pos[i + 1];
    if (pos[i + 2] < min[2]) min[2] = pos[i + 2];
    if (pos[i + 0] > max[0]) max[0] = pos[i + 0];
    if (pos[i + 1] > max[1]) max[1] = pos[i + 1];
    if (pos[i + 2] > max[2]) max[2] = pos[i + 2];
  }

  const json = {
    asset: { version: '2.0', generator: 'cairn gen_strand_glb.mjs' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [{
      primitives: [{
        attributes: { POSITION: 0, NORMAL: 1, TEXCOORD_0: 2, COLOR_0: 3 },
        indices: 4,
        mode: 4, // TRIANGLES
        material: 0,
      }],
    }],
    materials: [{
      name: 'strandSlot',
      pbrMetallicRoughness: {
        // v7: more transparent (0.55 → 0.40) so density of 5 strands isn't
        // overwhelming. Even a thin tube reads when it glows hard.
        baseColorFactor: [tint[0], tint[1], tint[2], 0.40],
        metallicFactor: 0.0,
        roughnessFactor: 1.0,
      },
      // emissive at 1.5× tint clamped to 1.0 — push past bloom threshold so
      // strands glow like neon threads rather than look like static plastic.
      emissiveFactor: [
        Math.min(1, tint[0] * 1.5),
        Math.min(1, tint[1] * 1.5),
        Math.min(1, tint[2] * 1.5),
      ],
      alphaMode: 'BLEND',
      doubleSided: true,
    }],
    accessors: [
      { bufferView: 0, componentType: 5126, count: vertexCount, type: 'VEC3', min, max }, // POSITION
      { bufferView: 1, componentType: 5126, count: vertexCount, type: 'VEC3' },            // NORMAL
      { bufferView: 2, componentType: 5126, count: vertexCount, type: 'VEC2' },            // TEXCOORD_0
      { bufferView: 3, componentType: 5126, count: vertexCount, type: 'VEC4' },            // COLOR_0 (rgba)
      {
        bufferView: 4,
        componentType: idxIsUint16 ? 5123 : 5125,
        count: indices.length,
        type: 'SCALAR',
      },
    ],
    bufferViews: [
      { buffer: 0, byteOffset: posOffset, byteLength: posBytes, target: 34962 },
      { buffer: 0, byteOffset: nrmOffset, byteLength: nrmBytes, target: 34962 },
      { buffer: 0, byteOffset: uvOffset,  byteLength: uvBytes,  target: 34962 },
      { buffer: 0, byteOffset: colOffset, byteLength: colBytes, target: 34962 },
      { buffer: 0, byteOffset: idxOffset, byteLength: idxBytes, target: 34963 },
    ],
    buffers: [{ byteLength: totalBin }],
  };

  // Encode JSON, pad to 4-byte boundary with spaces (0x20)
  let jsonStr = JSON.stringify(json);
  while (jsonStr.length % 4 !== 0) jsonStr += ' ';
  const jsonBytes = Buffer.from(jsonStr, 'utf8');

  // BIN chunk also padded with zeros to 4-byte boundary (already handled
  // above via align())
  const binPadded = bin; // totalBin already aligned

  // GLB total size
  const glbSize = 12 + 8 + jsonBytes.length + 8 + binPadded.length;
  const glb = Buffer.alloc(glbSize);
  let off = 0;

  // Header
  glb.writeUInt32LE(0x46546c67, off); off += 4;          // 'glTF'
  glb.writeUInt32LE(2, off); off += 4;                    // version
  glb.writeUInt32LE(glbSize, off); off += 4;              // total length

  // JSON chunk
  glb.writeUInt32LE(jsonBytes.length, off); off += 4;
  glb.writeUInt32LE(0x4e4f534a, off); off += 4;          // 'JSON'
  jsonBytes.copy(glb, off); off += jsonBytes.length;

  // BIN chunk
  glb.writeUInt32LE(binPadded.length, off); off += 4;
  glb.writeUInt32LE(0x004e4942, off); off += 4;          // 'BIN\0'
  Buffer.from(binPadded.buffer, binPadded.byteOffset, binPadded.byteLength).copy(glb, off);

  return glb;
}

// ── Main ──────────────────────────────────────────────────────
async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  for (const seed of SEEDS) {
    const geom = buildStrandGeometry(seed.jitter);
    for (const [type, tint] of Object.entries(TYPE_TINTS)) {
      const glb = geometryToGLB(geom, tint);
      const out = join(OUT_DIR, `strand_${seed.name}_${type}.glb`);
      await writeFile(out, glb);
      const tris = geom.index.count / 3;
      const verts = geom.attributes.position.count;
      console.log(`wrote ${out}  (${glb.length} bytes, ${verts} verts, ${tris} tris)`);
    }
  }
  console.log('\n5 curves × 5 types = 25 GLBs total. Drag any into https://gltf-viewer.donmccurdy.com/ to inspect.');
}

main().catch(e => { console.error(e); process.exit(1); });
