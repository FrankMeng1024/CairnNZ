#!/usr/bin/env python
"""One-shot replacement: lines 299-630 (SilkRibbon class) -> minimal v17."""
import sys
sys.stdout.reconfigure(encoding='utf-8')

FP = 'C:/ClaudeCodeProjects/Cairn/design_v2026-06_variant_C_3D.html'

NEW_BLOCK = '''// ── 丝带 (Silk Ribbon) — 极简版 v17 ─────────────────────────
// Arch review 后的最简方案:
//   1. 匀速 (constant velocity) — 无 ease, 无分阶段, 无速度突变
//   2. 越往上越淡 (alpha = 1 - worldY/LIFE_HEIGHT) — 像烟雾消散
//   3. 宽度方向 = camera-facing billboard (perpendicular to camera-to-point + world-up)
//      → 彻底消除"横线 artifact" (旧版 tx/tz 固定水平方向是根因)
//   4. 删除所有 detach 风格 / segCut / topAlphaCurve / energyBand / twistY / bubble / stream 死代码
class SilkRibbon {
  constructor(angle, phaseOffset = 0) {
    this.startA = angle;
    this.seed = Math.random() * 1000;
    this.maxWidth = 0.05 + Math.random() * 0.025;
    // 匀速 4-6s 全寿命, 错开 phase 让 8 根处于不同高度
    this.lifeDuration = 4.0 + Math.random() * 2.0;
    this.life = phaseOffset * this.lifeDuration;
    this.material = new THREE.MeshBasicMaterial({
      transparent: true, blending: THREE.AdditiveBlending,
      depthWrite: false, side: THREE.DoubleSide, vertexColors: true,
    });
    this.mesh = new THREE.Mesh(new THREE.BufferGeometry(), this.material);
    cairnGroup.add(this.mesh);
  }
  update(dt) {
    this.life += dt;
    if (this.life >= this.lifeDuration) {
      this.life = 0;
      this.lifeDuration = 4.0 + Math.random() * 2.0;
      this.startA += (Math.random() - 0.5) * 0.2;
      this.seed = Math.random() * 1000;
    }
    this.rebuild();
  }
  rebuild() {
    // 匀速参数: strand 顶端从 0 升到 LIFE_HEIGHT, 本体 BODY 长
    const BODY = 1.0;
    const LIFE_HEIGHT = 3.0;
    const lifeT = this.life / this.lifeDuration;          // 0..1 完全线性
    const topY = LIFE_HEIGHT * lifeT;                     // 顶端 Y 匀速线性
    const bottomY = Math.max(0, topY - BODY);             // 底端 clamp 到 0
    const actualLen = topY - bottomY;
    if (actualLen < 0.05) {
      this.mesh.visible = false; return;
    }
    this.mesh.visible = true;

    // 中线采样 — 直线垂直, 不用 CatmullRom (避免端点切线 artifact)
    const a = this.startA;
    const baseX = Math.cos(a) * RING_RADIUS * 1.05;
    const baseZ = Math.sin(a) * RING_RADIUS * 1.05;
    const SEGS = 20;
    const positions = [], colors = [], indices = [];

    // 宽度方向 = camera-facing billboard:
    // widthDir = normalize(camera→point) × worldUp
    // → ribbon 永远朝相机展开, 永远不会变成水平横扁带
    const camPos = camera.position;
    const worldUp = new THREE.Vector3(0, 1, 0);
    const tmp = new THREE.Vector3();
    const widthDir = new THREE.Vector3();

    for (let s = 0; s <= SEGS; s++) {
      const sT = s / SEGS;
      const y = bottomY + actualLen * sT;
      // toCam = camPos - point
      tmp.set(camPos.x - baseX, camPos.y - y, camPos.z - baseZ).normalize();
      // widthDir = toCam × up
      widthDir.crossVectors(tmp, worldUp).normalize();
      // 宽度: 底窄顶宽 (温和线性, 不用 sT^1.3 急剧增长)
      const w = this.maxWidth * (0.6 + 0.6 * sT);
      const px = baseX + widthDir.x * w;
      const pz = baseZ + widthDir.z * w;
      const nx = baseX - widthDir.x * w;
      const nz = baseZ - widthDir.z * w;
      positions.push(nx, y, nz);
      positions.push(px, y, pz);

      // alpha: worldY 越高越淡 — 这就是用户要的"越上越稀薄"
      const worldT = y / LIFE_HEIGHT;          // 0 (地面) → 1 (顶端)
      const alpha = Math.max(0, 1 - worldT);
      colors.push(activeColor.r, activeColor.g, activeColor.b, alpha);
      colors.push(activeColor.r, activeColor.g, activeColor.b, alpha);
    }
    for (let i = 0; i < SEGS; i++) {
      const a0 = i*2, a1 = i*2+1, b0 = (i+1)*2, b1 = (i+1)*2+1;
      indices.push(a0, b0, a1, a1, b0, b1);
    }
    const g = this.mesh.geometry;
    g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 4));
    g.setIndex(indices);
  }
}
'''

with open(FP, 'r', encoding='utf-8') as f:
    lines = f.readlines()

assert lines[298].startswith('// ── 丝带 (Silk Ribbon)'), f'wrong line 299: {lines[298][:80]}'
assert lines[305].strip() == 'class SilkRibbon {', f'wrong line 306: {lines[305][:80]}'
assert lines[629].strip() == '}', f'wrong line 630: {lines[629][:80]}'
assert 'const ribbons' in lines[631], f'wrong line 632: {lines[631][:80]}'

# Replace lines[298:630] (inclusive boundaries 299..630) with NEW_BLOCK
new_lines_block = NEW_BLOCK.splitlines(keepends=True)
result = lines[:298] + new_lines_block + lines[630:]

with open(FP, 'w', encoding='utf-8') as f:
    f.writelines(result)

print(f'Replaced {630-299+1} lines with {len(new_lines_block)} new lines.')
print(f'New file: {len(result)} lines.')
