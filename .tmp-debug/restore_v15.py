#!/usr/bin/env python
"""Restore v15 SilkRibbon — 5-vertex dual-layer + AdditiveBlending + activeColor halo + 白热 core."""
import sys
sys.stdout.reconfigure(encoding='utf-8')

FP = 'C:/ClaudeCodeProjects/Cairn/design_v2026-06_variant_C_3D.html'

with open(FP, 'r', encoding='utf-8') as f:
    lines = f.readlines()

# Find class SilkRibbon { ... } end
start_idx = None  # index of "class SilkRibbon {"
end_idx = None    # index of the closing "}" of the class
for i, line in enumerate(lines):
    if 'class SilkRibbon {' in line:
        start_idx = i
        break

assert start_idx is not None
# find matching close brace
depth = 0
for j in range(start_idx, len(lines)):
    for ch in lines[j]:
        if ch == '{': depth += 1
        elif ch == '}':
            depth -= 1
            if depth == 0:
                end_idx = j
                break
    if end_idx is not None:
        break

print(f'class SilkRibbon: lines {start_idx+1}..{end_idx+1}')

NEW_CLASS = '''class SilkRibbon {
  constructor(angle, phaseOffset = 0) {
    this.startA = angle;
    this.seed = Math.random() * 1000;
    this.maxWidth = 0.10 + Math.random() * 0.05;   // 加粗 ×2 保留 (用户要求粗一点)
    this.lifeDuration = 4.0 + Math.random() * 2.0; // 匀速 4-6s
    this.life = phaseOffset * this.lifeDuration;
    // v15 还原: AdditiveBlending (即使白底会偏 wash, 这是 v15 原貌)
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
    // 匀速 lifecycle (v15 风格)
    const BODY = 1.0;
    const LIFE_HEIGHT = 3.0;
    const lifeT = this.life / this.lifeDuration;
    const topY = LIFE_HEIGHT * lifeT;
    const bottomY = Math.max(0, topY - BODY);
    const actualLen = topY - bottomY;
    if (actualLen < 0.05) {
      this.mesh.visible = false; return;
    }
    this.mesh.visible = true;

    // 全局 alpha 包络 — 出生淡入 + 退场淡出
    let globalFade = 1.0;
    if (lifeT < 0.15) globalFade = lifeT / 0.15;
    else if (lifeT > 0.85) globalFade = (1 - lifeT) / 0.15;

    const a = this.startA;
    const baseX = Math.cos(a) * RING_RADIUS * 1.05;
    const baseZ = Math.sin(a) * RING_RADIUS * 1.05;
    const SEGS = 24;
    const positions = [], colors = [], indices = [];

    // 柔软 sway (v15 风格)
    const SWAY_AMP = 0.05;
    const swayPhase = performance.now() * 0.0004 + this.seed;
    const swayTanX = -Math.sin(a);
    const swayTanZ = Math.cos(a);

    const camPos = camera.position;
    const worldUp = new THREE.Vector3(0, 1, 0);
    const tmp = new THREE.Vector3();
    const widthDir = new THREE.Vector3();

    // v15 双层 ribbon: 5 顶点
    //   leftHalo (alpha 0) - leftCore (0.45) - center (1.0) - rightCore (0.45) - rightHalo (0)
    //   center 用白热色 (activeColor lerp 到白), halo 用 activeColor 品牌金
    const coreR = Math.min(1, activeColor.r * 1.4 + 0.15);
    const coreG = Math.min(1, activeColor.g * 1.4 + 0.15);
    const coreB = Math.min(1, activeColor.b * 1.4 + 0.20);

    for (let s = 0; s <= SEGS; s++) {
      const sT = s / SEGS;
      const y = bottomY + actualLen * sT;

      // sway
      const swayMag = SWAY_AMP * sT * sT;
      const swayOff = swayMag * Math.sin(sT * 2.5 + swayPhase);
      const cx = baseX + swayTanX * swayOff;
      const cz = baseZ + swayTanZ * swayOff;

      // billboard width direction
      tmp.set(camPos.x - cx, camPos.y - y, camPos.z - cz).normalize();
      widthDir.crossVectors(tmp, worldUp);
      if (widthDir.lengthSq() < 1e-4) {
        widthDir.set(swayTanX, 0, swayTanZ);
      } else {
        widthDir.normalize();
      }

      // 烟柱形宽度: 底窄 → 中粗 → 顶端散开
      const spindleShape = 0.4 + 0.6 * Math.sin(sT * Math.PI) + 0.5 * Math.pow(sT, 0.7);
      const noiseL = 0.85 + 0.30 * Math.sin(sT * 7.3 + this.seed);
      const noiseR = 0.85 + 0.30 * Math.sin(sT * 6.1 - this.seed * 1.7);
      const wHaloL = this.maxWidth * spindleShape * noiseL;
      const wHaloR = this.maxWidth * spindleShape * noiseR;
      const wCoreL = wHaloL * 0.35;
      const wCoreR = wHaloR * 0.35;

      // 5 顶点
      positions.push(cx - widthDir.x * wHaloL, y, cz - widthDir.z * wHaloL);
      positions.push(cx - widthDir.x * wCoreL, y, cz - widthDir.z * wCoreL);
      positions.push(cx,                       y, cz);
      positions.push(cx + widthDir.x * wCoreR, y, cz + widthDir.z * wCoreR);
      positions.push(cx + widthDir.x * wHaloR, y, cz + widthDir.z * wHaloR);

      // alpha — 越上越淡 (Sky Children 曲线: 底厚, 顶端 ~15% 急消)
      const worldT = y / LIFE_HEIGHT;
      const heightAlpha = Math.pow(Math.max(0, 1 - worldT), 1.6) * globalFade;
      const aHaloEdge = 0;
      const aHaloIn   = heightAlpha * 0.45;
      const aCenter   = heightAlpha * 1.0;

      // colors (v15 双色)
      colors.push(activeColor.r, activeColor.g, activeColor.b, aHaloEdge);
      colors.push(activeColor.r, activeColor.g, activeColor.b, aHaloIn);
      colors.push(coreR, coreG, coreB, aCenter);
      colors.push(activeColor.r, activeColor.g, activeColor.b, aHaloIn);
      colors.push(activeColor.r, activeColor.g, activeColor.b, aHaloEdge);
    }

    // 索引: 每段 4 quad strip
    for (let i = 0; i < SEGS; i++) {
      const b = i * 5;
      const n = (i+1) * 5;
      indices.push(b+0, b+1, n+0,  n+0, b+1, n+1);
      indices.push(b+1, b+2, n+1,  n+1, b+2, n+2);
      indices.push(b+2, b+3, n+2,  n+2, b+3, n+3);
      indices.push(b+3, b+4, n+3,  n+3, b+4, n+4);
    }
    const g = this.mesh.geometry;
    g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 4));
    g.setIndex(indices);
  }
}
'''

# Replace lines[start_idx..end_idx] inclusive with NEW_CLASS
new_block = NEW_CLASS.splitlines(keepends=True)
result = lines[:start_idx] + new_block + lines[end_idx+1:]

with open(FP, 'w', encoding='utf-8') as f:
    f.writelines(result)

print(f'Replaced {end_idx-start_idx+1} lines with {len(new_block)} lines.')
print(f'New file: {len(result)} lines.')
