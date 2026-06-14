# ALTAR_PHASE1_SCOPE — 阵图 Phase 1 拆 (独立调研, 不动代码)

调研日期: 2026-06-14. 主 agent 言论一律不可信 (QA_TRUST_RULES.md). 本报告完全基于直接 Read/Grep 拿到的文件:行号 证据.

---

## 1. HTML 基准 (design_v2026-06_variant_C_3D.html)

文件: `C:\ClaudeCodeProjects\Cairn\design_v2026-06_variant_C_3D.html` (737 行).

**底座 = 阵图视觉规格**:

- **形状**: 双圈圆环 (XZ 平面, y=0). 外环 `RingGeometry(R-0.013, R, 96)` line 146, 内环 `RingGeometry(R*0.65, R*0.665, 64)` line 158. 半径 `RING_RADIUS = 0.55m` line 142.
- **sweep 方向**: 12 点钟起 clockwise (顺时针). 起始角 `-π/2` line 654, sweep `0..2π`. 外环 + 内环**同步描边** (内环不再一开始就完整, 跟外环同步画出来).
- **持续时长**: `CEREMONY_DURATION = 1.0s` line 631.
- **关键帧** (line 626-666):
  - **0.00–0.50 (drawT 0..1)**: 外环 + 内环 clockwise sweep, opacity 0.55 (外) / 0.50 (内). Three.js 用 `RingGeometry(... thetaStart, thetaLength)` 重建 mesh 实现 sweep, line 643-657.
  - **0.50–0.85 (runeT 0..1)**: 中心 SDF rune fade in, opacity `runeT * 0.95`, scale `0.7 → 1.0` line 663-665. rune mesh = `PlaneGeometry(R*1.7, R*1.7)`, plane y=0.002.
  - **0.85–1.00**: ribbons (8 根 SilkRibbon) 开始 update, type 粒子开始 spawn line 673-685, label 浮现 line 709-719.
- **颜色**: per-type, `TYPES` 表 line 80-86. 5 type (cairn/danger/water/hut/junction) 各有自己 hex (cairn `0xb89968`, water `0x5fa8d8`, danger `0xff7866`, hut `0xe8c47a`, junction `0xa4d889`). ring 颜色 = `activeColor.lerp(0x2B1810, 0.55)` (type 色 → dark amber, 白底友好) line 583-584.
- **type icon 时机**: 跟 ring sweep 平行进入, 0.50 才浮现 (即 ring 描完一半, rune 开始). 5 个 SDF (cairn=3 椭圆 / triangle=三角+! / drop=水滴 / house=房子 / fork=分叉箭头) line 222-251 由 canvas 烘到 texture, 不依赖 sweep.

---

## 2. 当前 Unity 阵图代码 (跟 HTML 差距清单)

| 文件:行号 | 当前职责 | HTML 基准 | 差距 |
|---|---|---|---|
| `RingMeshBuilder.cs:24-93` | 程序生成 ring mesh, XZ 平面, UV.x = 角度 0..1 (用于 shader sweep discard), 起始 `-π/2`, clockwise. | 一致. | **未被 PortalSpawner 使用**: PortalSpawner.cs:762 用的是 `CreateFlatQuad` + `portalRingMaterial`, 不是 RingMeshBuilder. RingMeshBuilder 是死代码. |
| `CeremonyController.cs:84-96` | 1.0s 协程驱动 `_t = 0..1`, 然后调 `ApplyState(t)`. | 一致 (1.0s, _ringSweepEndT=0.50, _runeStartT=0.50, _runeEndT=0.85, _ribbonStartT=0.85). | timeline 数字对得上, 但下面字段全是死的. |
| `CeremonyController.cs:107-110` | 写 MPB `_SweepAngle = sweepT * 2π`. | HTML 通过重建 RingGeometry(thetaStart, thetaLength) 实现 sweep. | **PortalRingShader.shader 没有 `_SweepAngle` property** (Grep 整个 shader 搜不到). MPB 写了但 shader 不读 → sweep 不工作. |
| `CeremonyController.cs:144-152` | 写 MPB `_Reveal = runeT`. | HTML 用 runeMat.opacity + runeMesh.scale. | shader 同样**没有 `_Reveal` property**. rune fade 不工作. |
| `PortalSpawner.cs:762-784` | 主路径 spawn 阵图: `CreateFlatQuad("PortalRing")` + `portalRingMaterial` (Cairn/PortalRingShader), MPB 设 `_TypeIndex`. | HTML 双圈圆环. | **只有 1 个 quad, 不是 RingMeshBuilder 双圈**. PortalRingShader 自己内部用 SDF `|r - radius| < thickness` 模拟 ring (line 184) + spin 自转 (line 205, `angHL = atan2(p.y,p.x) - spin`). 类型 icon 在 quad 中心 SDF, line 219-291. **但**: 没有 sweep 逻辑, ring 是一上来全圈, 中心 icon 是一上来全亮. |
| `PortalSpawnerV199.cs:117-207` | 在 Portal_<id> 容器下挂 V199Layer (子物件: ribbons/halo/shadow/rune-text/...). 其中 `PlantCeremony` 协程 line 203-207 跑 1s, 期间 `isCeremonyActive=true` 让 GroundYResolver A7 不 fight. | HTML 仪式驱动 ring + rune + ribbon 出场. | V199Layer 没有 sweep / rune fade. PlantCeremony 只 set flag, 没碰任何 ring 视觉. CeremonyController 是另一条路径, 在 V199 里被引用 (line 223 `GetComponentInChildren<CeremonyController>`) 但**没有人调 .Play()** — Grep 整个 PortalSpawnerV199.cs 搜不到 `ceremony.Play()`. CairnAcquireController.cs:566 IMMORTAL 时才调 — 这是 acquire 流程, 不是 plant 流程. |
| `PortalSpawnerV199.cs:148-156` | `if (data.type == "cairn") AttachPebbleStack(...)`. 非-cairn type 注释说"靠 PortalRing 中心 SDF". | HTML 5 type 都有 SDF. | 跟 HTML 数量一致, 但 SDF 在 `PortalRingShader.shader:222-291` 是写死索引 (`int typeIdx = (int)(_TypeIndex+0.5)`). cairn=0/danger=1/junction=2/water=3/hut=4. |

**差距汇总**:
1. CeremonyController 写的 `_SweepAngle` / `_Reveal` MPB 字段 PortalRingShader 不读 → **整个 sweep 仪式视觉不工作**, 只有 timeline 跑了, 视觉一上来全亮.
2. PortalSpawner 主路径用单 quad + portalRingMaterial, 不挂 CeremonyController, 不挂 RingMeshBuilder. CeremonyController 在 V199 里**没人调 .Play()**, Plant 时根本不仪式.
3. PortalSpawner.cs:762 没有内圈, HTML 是双圈.
4. RingMeshBuilder.cs 是死代码 (整个 Cairn repo Grep `RingMeshBuilder.Build` 0 caller).

---

## 3. Type icon 当前

**App 端** (`app/src/config/markerTypes.ts:43-87`): 5 type 用 `lucide` 图标 — cairn=Mountain (实际渲染走自定义 `<CairnStoneIcon>` SVG), danger=TriangleAlert, junction=Navigation2, water=Droplets, hut=House. 全是 lucide 风格的 line-icon.

**Unity 端** (`PortalRingShader.shader:222-291`): 5 type 在 ring 中心用程序化 SDF 画:
- cairn (typeIdx=0): 3 个堆叠 ellipse outline.
- danger (typeIdx=1): 三角 outline + 中央 ! (bar+dot).
- junction (typeIdx=2): 两个填充 triangle 拼成箭头.
- water (typeIdx=3): circle + triangle min() 合成水滴 outline.
- hut (typeIdx=4): roof triangle outline + wall rect + door.

**一致性**: 视觉上**不一致**. App lucide line-icon vs. Unity 自手写 SDF, 风格差异大. 但**形状语义对得上** (三角=danger, 房子=hut, 水滴=water, 箭头=junction). HTML 基准也是手写 canvas 路径 (line 222-251), 风格更接近 Unity SDF, 不是 lucide. 所以问题不是 Unity vs HTML, 是 App lucide vs Unity SDF 两边不像.

**TypeIndex 映射不一致警告**:
- `PortalSpawnerV199.cs:426-435 TypeChipIndex`: danger=0, junction=1, water=2, hut=3, cairn=4 (fallback).
- `PortalRingShader.shader:31`: "0=cairn 1=danger 2=junction 3=water 4=hut".
- `PortalSpawner.cs` 用 `TypeToIndex(data.type)` (没在 grep 范围, 但写入 `_TypeIndex`).

V199 layer 的 TypeChip 已被 Stage 8 删 (line 141-147), 所以这映射不冲突 — 但留着是 footgun.

---

## 4. 跨 session "焊死" 视觉路径 (现状)

**Plant 时刻 spawn Y 决定**:
1. `PortalSpawner.SpawnStrandInternal:428-447`: 优先 `groundYResolver.QueryGroundY(data.x, 0, data.z)` 拿 Tier-A (PlaneClassification.Floor 优先, 再 area≥1.5m² + height>0.8m 兜底) / Tier-B (raycast PlaneWithinPolygon|Depth, 走 FloorPlaneValidator). **Tier-A/B 都已应用 floor-only 过滤** (`GroundYResolver.cs:218-303`).
2. 拿不到 Tier-A/B → 拒绝 spawn, emit `SpawnRejected` line 475-485. 用户铁律 "只要最终落在地面我就接受" 已经 enforce.

**结论 1**: 哪怕用户 aim 桌面, GroundYResolver Floor-only 过滤会拒绝桌面 plane (PlaneClassification.Table/Seat/Wall 全 reject, line 181-182), 命不中就直接 SpawnRejected, **不会真的 spawn 在桌面**. 这条规则数学已闭环, 但 RN 端 `unityCairnSpawn.ts:162` `buildSpawnRequest` 给 Unity 的 `data.y` 是 RN raycast hit point (有可能是桌面 hit). 当 `groundDetected=false` 时 PortalSpawner 拒绝 → 用户重 plant. 没有"snap 到地面" — 是"不让你 plant 在桌面".

**Tier-A 跨 session 重 spawn 视觉路径**:
1. Marker 持久化在 RN store, 含 `arkitX/Y/Z` (上次 session 焊死时的 ARKit world 坐标) + `arOriginLat/Lng`.
2. 重进 AR → `originPropagation.projectOrigin` 算新 origin, 跟旧 `arOriginLat/Lng` 距离 ≤ `ARKIT_XYZ_TIER_A_MAX_DELTA_M` (低精度 origin 收紧 5→2m, line 158-160 + 193-197) → tier=A. 否则 fallback Tier-B (重投 GPS→ARKit, line 220-225 line 238).
3. Tier-A: `unityCairnSpawn.ts:200-213` 直接传 `arkitY` 给 Unity. PortalSpawner.cs:557 `ApplyTierAwareSpawnOffset` Tier-A bypass sessionOffset, Tier-B apply offset.
4. **关键**: Unity 端 `PortalSpawner.SpawnStrandInternal:428-447` 仍然**优先 GroundYResolver.QueryGroundY**, 只在它返回 false 时才考虑 `data.y`. 即: 重 spawn 即使 RN 给的 arkitY 是上次焊死的地面 Y, Unity 也会**重新查当前 session 的 GroundYResolver**, 拿当前 ARKit 看到的 floor plane Y. 当前看不到任何 floor plane → SpawnRejected (line 465-486, editor bypass 例外).
5. `CrossSessionGroundSnap.cs:69-181`: ArReady 后 5s 扫所有 IMMORTAL cairn, 每个找 nearest-XZ floor plane, |yDelta|>0.10m 且 ≤1.5m (跨层保护) 才 snap. **但 cairn 必须先成功 spawn 才能进 IMMORTAL**, snap 是事后修正, 不是 spawn 时定 Y.

**结论 2**: 视觉层"焊死"路径**部分通**:
- ✅ Plant 时刻: GroundYResolver Floor-only 决定 Y, 桌面/沙发不会被当地面.
- ⚠️ 跨 session 重 spawn: 仍走 GroundYResolver 当前 session 的 floor plane. 如果当前 session ARKit 还没找到 floor → SpawnRejected. 用户得等 ARKit plane detection 完成.
- ⚠️ 跨 session snap: CrossSessionGroundSnap 只对 IMMORTAL cairn (用户走近过的) snap, 远处的 cairn 视野外不 snap (line 144-149). 但视觉路径是 nearest-XZ plane, 而不是用 RN store 持久化的 arkitY → 跨 session 用的是当前 session 实测 floor plane.cs

**结论 3**: aim 命中桌面 → GroundYResolver 拒掉桌面 plane (Table classification reject) → SpawnRejected. **没有 snap-to-floor 行为, 是 reject-and-retry**. 用户报"必定在地面"如果意思是"哪怕 aim 桌面也成功 plant 在桌下地面", 当前**不实现**. 当前实现是"aim 桌面就拒绝 plant, 让你重 aim 地面".

---

## 5. 3 段 Story 拆 (Editor 真测能验证的边界)

### Story A: aim 命中桌面 → snap 到桌下地面 (而非拒绝)

**用户铁律**: "用户瞄准石头/桌子/沙发, 阵图必须 snap 到地面". 这是行为变更, 当前是 reject.

**改动点 (建议, 主 agent 实施前要再开 sub#A 验)**:
- `PortalSpawner.cs:465-486`: `groundDetected=false` 分支不直接 reject, 先尝试在 `(data.x, _, data.z)` XZ 上**所有可见 floor plane** (走 `GroundYResolver` 内部 collected validPlanes 或 `CrossSessionGroundSnap.PickSnapPlane`) 找 nearest-XZ floor, 强制把 spawnY 设为 `nearestFloorPlane.center.y`. 即使 RN raycast hit 的是桌面, Unity 也 snap 到桌下地面.
- 仍保留 reject: 真没任何 floor plane (室外/纯 LiDAR depth 也无) 才 reject.

**Editor 真测**: 走 `V024CapturePlayground.cs` 类已存在的 harness (在 V024Playground.unity 里), 加新 case:
- 模拟 ARPlaneManager 有 1 个 floor plane y=0 + 1 个 table plane y=0.75. data 传 (x, 0.75, z) (RN 误传桌面). 跑 SpawnStrandInternal, assert container.transform.position.y 接近 0 (地面), 不是 0.75.
- 视觉证据: Editor PNG 截图 阵图位置.

**Sub 复测 (反 self-licking)**: sub#A 把 Story A 的 happy path mutate 几种 — (1) data.y = 桌面 0.75, (2) data.y = 天花板 -0.95 (HorizontalDown 应被 ceiling reject 留 floor=0), (3) 没有任何 plane (应该真 reject). 拿截图 + console log.

### Story B: type icon 5 种跟 app 一致

**两个子选项 (用户/Arch 决定)**:

**B-Option 1 (lucide 同步, 推荐)**: Unity SDF 改成贴近 app lucide 风格 — line-icon, stroke-only, 跟 `markerTypes.ts` 视觉系统一致. 改 PortalRingShader.shader:222-291 SDF 形状 (cairn 改成 lucide Mountain 三尖山形, water 改成 lucide Droplets 双水滴, junction 改成 lucide Navigation2 三角羽箭).

**B-Option 2 (canvas → texture, 走 HTML 路径)**: 写 `TypeIconTextureBaker.cs` 用 RenderTexture + Graphics.Blit 在 runtime 烘 5 张 256×256 SDF texture (1:1 移植 HTML line 222-251 路径), portalRingMaterial 改用 `_TypeIcon` sampler2D 替代 SDF if-else. 优点: 跟 HTML 视觉 1:1.

**改动点**:
- B-1: `PortalRingShader.shader:222-291` 5 个 if 分支改 SDF 几何.
- B-2: 新文件 `TypeIconTextureBaker.cs`. PortalRingShader 加 `_TypeIcon (2D)` property, frag 用 `tex2D(_TypeIcon, ip+0.5)` 替代 SDF.

**Editor 真测**: V024Playground 5 type 各 spawn 一个 cairn, 各拍 PNG, side-by-side 跟 app 端 markerTypes 渲染对比 (app 走 RN, 在 Mac/iOS Simulator 截 5 张 lucide 图标). 主 agent 拼 5×2 grid, 给 sub#B 做视觉判断.

**Sub 复测**: sub#B 看 grid, 写每对的 "shape match (Y/N) + style match (Y/N)" 表. shape match 要 100%, style match 接受 70%.

### Story C: 仪式 sweep 跟 HTML 一致 (1.0s clockwise)

**用户铁律**: 阵图启动有 sweep / circle reveal / glow, 跟 HTML 基准一致.

**当前根因**: CeremonyController 写 `_SweepAngle`/`_Reveal` MPB 但 PortalRingShader 没这俩 property → 视觉不工作.

**两个子选项**:

**C-Option 1 (走 RingMeshBuilder, 1:1 HTML 路径)**: PortalSpawner.cs:762 改成用 `RingMeshBuilder.Build(0.55, 0.537, 96)` + `RingMeshBuilder.Build(0.357, 0.366, 64)` 双圈, 每帧重建 mesh (CeremonyController 拿 sweepT 调 RingMeshBuilder.Build 的新 overload `Build(outer, inner, segs, sweepT)` 只输出 sweepT 那段弧). 跟 HTML line 643-657 完全等价.

**C-Option 2 (PortalRingShader 加 sweep discard)**: shader 加 `_SweepAngle` property, frag 里在 ring SDF 之外加 `if (theta > _SweepAngle) discard;` (theta 已经在 line 182 算出). 单 quad 仍然用, mesh 不重建.

**改动点 (C-Option 2 更轻)**:
- `PortalRingShader.shader:18-31` Properties 加 `_SweepAngle ("Sweep Angle (rad)", Range(0, 6.2832)) = 6.2832` 默认全圈 + `_Reveal ("Rune Reveal", Range(0,1)) = 1`.
- shader frag 在 ring SDF 后加 sweep gate (`float sweep = step(theta01, _SweepAngle/(2π)); ringPx *= sweep;`).
- icon 段加 `iconPx *= _Reveal`.
- `PortalSpawner.cs:782` 之后加 `mpb.SetFloat("_SweepAngle", 0); mpb.SetFloat("_Reveal", 0);` 让初始化是 0, 然后 attach 一个 CeremonyController 子物件 + 把 PortalRing 的 renderer wire 进 `_outerRingRenderer`. Plant 时 `ceremony.Play()`. 当前 V199 line 223 拿到 ceremony 但没 .Play(), 改这里.
- 内圈 — 加第 2 个 quad 同 shader, MPB 不同 radius.

**Editor 真测**: V024Playground harness, 已有 `V5-flipbook-ceremony.gif` 路径 (review/v0.2.4 里有 V4.12-flipbook-final.gif, V5-flipbook-final.gif). 新 case `RunCeremonyCapture`: spawn 1 个 cairn, EditorManualTick 60 帧 (1.0s, 60fps), 每帧 PNG, 拼 24 帧 flipbook GIF. 跟 HTML 对比 5 个关键帧 (t=0.00/0.25/0.50/0.75/1.00).

**Sub 复测**: sub#C 把 flipbook 跟 HTML 截图 (8766/?v=22day10 跑同 type, 截 0.0/0.25/0.50/0.75/1.0) side-by-side. 关键 invariant — t=0.25 时 ring 是半圈 (180°), t=0.50 整圈, t=0.50 rune 0% (还没浮现), t=0.85 rune 100%.

---

## 优先级 / 先做哪个

**用户铁律 1 个一个局部功能来做**, 推荐顺序:

1. **Story C 优先 (仪式 sweep)** — 当前最大视觉差距 (整个仪式不工作). 改动量小 (shader 加 2 property + PortalSpawner 2 行 wire + V199 加 .Play() 1 行). Editor harness 已存在. 不动 type icon 几何, 不动 spawn Y 路径. 风险最低. **最先做**.

2. **Story B 中 (type icon)** — 当前形状对得上 (5 种都有), 风格不一致是次要差距. 选 B-Option 1 改 5 个 SDF 子句即可. Editor 真测靠 5 张 PNG 对比. 不动 spawn 路径. 中等风险.

3. **Story A 最后 (aim 桌面 snap 地面)** — 行为变更, 改 SpawnRejected 逻辑. 风险最高 (会跟 user invariant "只要最终落在地面我就接受" 互动 — snap 到地面跟 reject 都满足这个 invariant, 但现在是 reject, 改成 snap 是行为延伸, 用户得明确确认). 而且 sub#A 必须有 mutation case 验证不会绕过 floor-only 过滤. **最后做, 实施前先开 sub#A 拿用户决策**.

---

## 不可信主 agent 言论清单 (供后续 sub review 引用)

1. 主 agent 之前说 "跨 session 阵图位置数学已闭环 (jest 真测过)" — 数学闭环 ✓ (`originPropagation.projectOrigin` + `buildSpawnRequest` Tier-A/B), 但**视觉层**没闭环: 跨 session 重 spawn Y 走 GroundYResolver 当前 session, 不是 RN 持久化的 arkitY (PortalSpawner.cs:433-447). 当前 session 没看到 floor → SpawnRejected, 用户铁律"原位置 + 地面"在 plane 还没收敛时无法兑现.
2. 主 agent 之前说 CeremonyController 是 1:1 port HTML — port timeline 数字对了, 但 MPB 字段 `_SweepAngle`/`_Reveal` 在 PortalRingShader 不存在 (Grep 0 hit). **整个仪式视觉不工作**, 只是 timeline 跑.
3. 主 agent 之前说 RingMeshBuilder 是 v0.2.4 Branch C tier-1 圆环 — 它存在但**整个 Cairn repo 0 caller**, 死代码. PortalSpawner 主路径是 `CreateFlatQuad("PortalRing")` 单 quad, 不是 RingMeshBuilder 双圈.
