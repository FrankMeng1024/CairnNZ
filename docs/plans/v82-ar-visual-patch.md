# v82 AR 视觉修复 — 修复 2 + 修复 3 patch

**目标**: 解决 v81 的 2 个 P0 视觉 bug
- 修复 2: icon 像 2D 贴纸 (Lambert+Fresnel 在 Viro 上不工作 → 改 Constant + bloom)
- 修复 3: 粒子飞天花板 (`+=0.12` loop 累加 → 改 2 段往返串联)

**文件**: `app/src/components/ViroAROverlay.tsx`
**OTA bump**: `app/src/components/OtaBadge.tsx` 81 → 82

> 注: 修复 1 (ICON_SCALE 2.0 → 0.7) 暂未在本 patch 内 — 等用户确认。

---

## Patch A — Icon 材质改 Constant + bloom (修复 2)

### 改动位置
`ViroAROverlay.tsx` 大约 line 426-431

### 原代码
```ts
matDict[`icon${t}`] = {
  lightingModel: 'Lambert',
  diffuseColor: c.mid,
  fresnelExponent: 2.0,
  bloomThreshold: 0.40,
};
```

### 改为
```ts
// v82 fix #2 (icon 2D 贴纸): Lambert + fresnelExponent 在 Viro 上不工作
// (fresnelExponent 是 PhysicallyBased 属性，Lambert 不识别；Viro 也没
// 自定义 fragment shader 能力复刻 reference HTML 的 ShaderMaterial Fresnel)。
// 改回 Constant lightingModel — icon 自发光始终饱和亮色 + 强 bloom 光晕。
// 失去精确边缘高光，但收获 reference HTML 的"亮颜色块自带光晕"视觉。
matDict[`icon${t}`] = {
  lightingModel: 'Constant',
  diffuseColor: c.mid,
  bloomThreshold: 0.30,
};
```

---

## Patch B — 粒子 bob 改往返 (修复 3)

### 改动位置 1 — Animation 注册 (大约 line 532-550)

### 原代码
```ts
// v81: per-particle Y bob — register 3 phase variants so the ring
// pulses with shifted rhythm rather than rigid synchronized
// up/down. Each variant is a 2-step cycle going up by `bob`,
// then back. Particles get assigned variant by index%3.
particleBobA: {
  properties: { positionY: '+=0.12' },
  duration: 1100,
  easing: 'EaseInEaseOut',
},
particleBobB: {
  properties: { positionY: '+=0.10' },
  duration: 1300,
  easing: 'EaseInEaseOut',
},
particleBobC: {
  properties: { positionY: '+=0.14' },
  duration: 950,
  easing: 'EaseInEaseOut',
},
```

### 改为
```ts
// v82 fix #3 (粒子飞天花板): v81 的 `+=0.12` + loop:true 永久累加，
// 50 个粒子每 1.1s +0.12m，几分钟后飞到 1-3m 高 → 撞天花板。
// reference HTML 是 sin(t*0.9 + i)*0.10 绕中心点 ±0.10m 摆动，不累加。
// Viro 动画系统不支持纯 sin 摆动，必须用 "+= 然后 -=" 2 段循环。
// 用 chained animation 串起来: up → down 形成完整一周期，正负相消，
// 粒子永远在初始 Y ±bob 范围内，绝不漂走。
//
// 方案 A: 经典环绕 (reference HTML particleClassic) 的 Viro 近似
particleBobAUp: {
  properties: { positionY: '+=0.10' },
  duration: 1100,
  easing: 'EaseInEaseOut',
},
particleBobADown: {
  properties: { positionY: '-=0.10' },
  duration: 1100,
  easing: 'EaseInEaseOut',
},
particleBobA: {
  properties: [
    ['particleBobAUp', 'particleBobADown'],
  ],
} as any,

particleBobBUp: {
  properties: { positionY: '+=0.08' },
  duration: 1300,
  easing: 'EaseInEaseOut',
},
particleBobBDown: {
  properties: { positionY: '-=0.08' },
  duration: 1300,
  easing: 'EaseInEaseOut',
},
particleBobB: {
  properties: [
    ['particleBobBUp', 'particleBobBDown'],
  ],
} as any,

particleBobCUp: {
  properties: { positionY: '+=0.12' },
  duration: 950,
  easing: 'EaseInEaseOut',
},
particleBobCDown: {
  properties: { positionY: '-=0.12' },
  duration: 950,
  easing: 'EaseInEaseOut',
},
particleBobC: {
  properties: [
    ['particleBobCUp', 'particleBobCDown'],
  ],
} as any,
```

### 改动位置 2 — 检查 ViroAnimations 串联语法

⚠️ **不确定项**: Viro 的 chained animation API 实际语法。需要验证以下两种之一:

**方案 1**: `ViroAnimations.registerAnimations` 接受顶层 `animations: { name: { animations: [[a, b]] } }` 结构
**方案 2**: 用 `ViroNode animation` prop 的多 step 数组

参考 `@reactvision/react-viro` 文档 — 如果两个都不行，**回退方案**:
直接把 `loop:true` 去掉，改成只播一次的 `+=0.10` 然后 onFinish 切换到 `-=0.10`，再 onFinish 切回。即用 React state 管 toggle。

更简单的回退方案 (如果 chained 不可用):
```ts
// 减小 loop 累加幅度 → 让漂移很慢，10 分钟内仍可接受
particleBobA: {
  properties: { positionY: '+=0.02' },  // 0.12 → 0.02 (减 6 倍)
  duration: 1100,
},
```
但这只是缓解，不根治。优先用 chained 实现。

---

## Patch C — OTA Bump

### `app/src/components/OtaBadge.tsx`

### 找到
```ts
const OTA_VERSION = 81;
```

### 改为
```ts
const OTA_VERSION = 82;
```

---

## 验收测试清单 (v82 push 后)

1. [ ] OTA Badge 显示 `82`
2. [ ] AR icon 颜色饱和度高、有 bloom 光晕 (不再是纯实色平面)
3. [ ] 粒子环 5 分钟后仍贴在 icon 周围，不漂到天花板
4. [ ] icon 仍然太大撑爆屏幕 ⚠️ — **预期**, 修复 1 (ICON_SCALE) 未在本 patch 内

---

## Push 命令

```bash
cd C:/ClaudeCodeProjects/Cairn/app
EAS_SKIP_AUTO_FINGERPRINT=1 eas update --branch production --message "fix(v82): icon Constant material + particle bob round-trip" --platform ios --non-interactive 2>&1 | tail -15
```

```bash
cd C:/ClaudeCodeProjects && git add -A && git commit -m "fix(v82): AR visual patch 2+3 — icon Constant material, particle bob round-trip"
```

---

## 风险 & 已知 unknowns

1. **chained animation 语法不确定** — 如果 Viro 版本不支持，回退到"减小累加幅度"方案 (临时)
2. **修复 1 (ICON_SCALE 2.0 → 0.7) 未包含** — 用户需先确认尺寸目标，避免一次改太多变量难定位
3. **Constant 材质失去 Fresnel** — reference HTML 的 ShaderMaterial 边缘高光在 Viro 上无法 1:1 复刻；Constant + bloom 是次优解，但用户会感觉"更亮更鲜艳"

