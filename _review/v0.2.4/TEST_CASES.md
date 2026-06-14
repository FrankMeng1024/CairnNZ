# Cairn v0.2.4 — QA Test Case Matrix (TEST_CASES.md)

**用户铁律**: "用户 plant 一个 mark,这个 mark 永永远远焊死在那,一动不动。"

任何让 cairn 偏离 plant 当时地面 hit 点的行为 = FAIL。

---

## Test naming + folder convention

- 每个 case 一个 ID: `QA-NN-<short-name>`
- 输出 `Logs/qa-cases/QA-NN-<name>/` 包含:
  - `before.png` — plant 那一刻视角
  - `after.png` — 触发"挪动条件"后视角
  - `verdict.txt` — PASS/FAIL + 量化 delta (米) + 失败原因
- 全套一条 cmdline: `Unity.exe -executeMethod QARunAll.RunHeadless -batchmode -quit -logFile -`
- 退出码: 0 = 全 PASS,1 = 任意 FAIL

## PASS 阈值

- **位置 delta**: |after.pos - before.pos| < 0.05m (5cm) — 用户铁律允许的最大 jitter
- **视觉 cone tip pixel delta**: < 30px (1280x720, FOV 60°, ~2m 距离 ≈ 5cm — 与 0.05m 口径一致)
- **跨 session delta** (QA-10/11/12): 0.10m **[基线后实测再定,目前占位]**
- **GPS accuracy threshold**: 10m — 来源 `app/src/screens/ARScreen.tsx` (B-Apple+B3 fix 后)
- **arOrigin distance threshold**: 50m — 来源 `app/src/screens/ARScreen.tsx`
- **maxFloorDistanceBelowCam**: 5m — 来源 `FloorPlaneValidator.cs:47` 默认值
- 任何 case 超阈值即 FAIL,具体写入 verdict.txt

**Tags**:
- `[device-only]` — Editor 没法 mock,batchmode 自动 skip,真机才跑
- `[mock-ok]` — Editor 可全程 mock

---

## 测试矩阵

### A 类 — 同 session,挪动行为 (P0 致命场景)

| ID | Case | 触发条件 | PASS 标准 |
|----|------|----------|-----------|
| QA-01 | plant 后立即不动 [mock-ok] | 相机站定 plant,1s 后再观察 | **数学**: anchor.transform.position delta < 0.01m |
| QA-02 | plant 后走开 5m 再回来 [mock-ok] | 相机走 +X 方向 5m,再走回原位 | **视觉**: cone tip pixel y delta < 30px |
| QA-03 | plant 后绕 180° [mock-ok] | 相机绕 cairn 转半圈再回来 | **视觉**: cone tip pixel y delta < 30px |
| QA-04 | plant 后蹲下站起 [mock-ok] | 相机 y 从 1.6 → 0.6 → 1.6 | **数学**: anchor delta < 0.02m |
| QA-05 | 同 session SLAM 慢漂 (合成) [mock-ok] | 用 transform 平移每帧 +0.001m drift,跑 60 帧 | **数学**: cairn world 位置 delta < 0.05m, AnchorDriftMonitor 应 emit `v22-PLANT-ANCHOR-DRIFT-DETECTED` |
| QA-06 | SLAM relocalize 一次性跳 0.3m [mock-ok] | 单帧 transform 平移 +0.3m | **视觉**: cone tip pixel y delta < (0.10m 换算 ≈ 60px),AnchorDriftMonitor 应 emit `single-frame-jump` reason |

### B 类 — 跨 session,重开 app (P0 最致命)

注: Editor 无真 scene reload,用 Destroy + Instantiate + sessionOffset reset 模拟。

| ID | Case | 触发条件 | PASS 标准 |
|----|------|----------|-----------|
| QA-10 | 重开 app,ARKit world frame y 漂 0.6m [mock-ok] | scene reload + cairn parent transform.y +0.6 | **视觉**: CrossSessionGroundSnap 触发后 `\|cairn.y - groundPlane.y\| < 0.02m` |
| QA-11 | 重开 app,ARKit world frame xz 漂 0.3m [mock-ok] | scene reload + cairn parent.x +0.3 | **视觉**: re-snap 后 \|cairn.xz - hit.xz\| < 0.10m **[基线后定]** |
| QA-12 | 重开 app,无 floor plane 探测到 [mock-ok] | scene reload, 不放 mock plane | **数学**: cairn 应保持原 anchor 位置 (不 snap), `cairn.transform.position` 与 reload 前一致 (delta < 0.001m) |
| QA-13 | 重开 app,B-Apple worldMappingStatus 锁 [device-only] | 模拟 Limited 状态 plant gate 应禁 | **数学**: a4PlantEnabled === false, plant 调用应被 reject (RN 端 console.log "v22-PLANT-REJECT-LIMITED") |

### C 类 — Tier-A vs Tier-B (B2 系列)

| ID | Case | 触发条件 | PASS 标准 |
|----|------|----------|-----------|
| QA-20 | Tier-A spawn 不应用 sessionOffset (已初始化) [mock-ok] | data.tier="A", x=10, sessionOffset=(5,0,3) | **数学**: spawnX === 10 (不是 15) |
| QA-21 | Tier-B spawn 应用 sessionOffset [mock-ok] | data.tier="B", x=10, sessionOffset=(5,0,3) | **数学**: spawnX === 15 |
| QA-22 | null tier 默认走 Tier-B compat [mock-ok] | data.tier=null | **数学**: spawnX === 15 |
| QA-23 | MultiSpawner Tier-A bypass (R2.5) [mock-ok] | MultiSpawner.cs 调 SpawnRequest tier="A" | **数学**: 走过的 sessionOffset 加值 === 0 (grep `[v22-MultiSpawner-Tier]` log) |
| QA-95 | Tier-A 在 sessionOffset 未初始化时 spawn [mock-ok] | sessionOffset=(0,0,0), tier="A", x=10 | **数学**: spawnX === 10 (Tier-A 永远 bypass,与 sessionOffset 是否初始化无关) |

### D 类 — Floor plane 判断 (B1 系列)

| ID | Case | 触发条件 | PASS 标准 |
|----|------|----------|-----------|
| QA-30 | 站姿 (camY=1.5) 接受 belowCam=1.0 plane [mock-ok] | adaptiveMin = 0.9, 1.0 >= 0.9 | **数学**: FloorPlaneValidator.Validate 返 true |
| QA-31 | 蹲姿 (camY=0.5) 接受 belowCam=0.3 plane [mock-ok] | adaptiveMin = 0.3, 0.3 >= 0.3 | **数学**: Validate 返 true |
| QA-32 | 趴姿 (camY=0.2) 用 floor=0.2m [mock-ok] | adaptiveMin = 0.2 (clamped) | **数学**: Validate 返 true (belowCam=0.2) |
| QA-33 | 拒桌面 (camY=1.5, hitY=1.0) [mock-ok] | belowCam=0.5 < adaptiveMin=0.9 | **数学**: Validate 返 false |
| QA-34 | 拒悬崖 (camY=1.5, hitY=-10) [mock-ok] | belowCam=11.5 > maxFloorDistance=5 | **数学**: Validate 返 false |
| QA-35 | 拒非地面 classification (参数化) [mock-ok] | classification ∈ {Couch, WallArt, Window, Door} | **数学**: Validate 对每种 classification 都返 false |
| QA-39 | R2.2 修后,正常站姿 (camY=1.5, hitY=0.9, classification=Floor) 仍 accept [mock-ok] | belowCam=0.6, adaptiveMin=0.9 — 边缘但还在范围 | **数学**: Validate 返 true (确保 R2.2 没把合法站姿打飞) |

### E 类 — Tracking state gate (A 系列)

| ID | Case | 触发条件 | PASS 标准 |
|----|------|----------|-----------|
| QA-40 | tracking state = tracking 允许 plant [mock-ok] | ArFrame.track = "tracking" | **数学**: a4PlantEnabled === true |
| QA-41 | tracking state = limited 禁 plant [mock-ok] | track = "limited" | **数学**: a4PlantEnabled === false |
| QA-42 | tracking state = none 禁 plant [mock-ok] | track = "none" | **数学**: a4PlantEnabled === false |
| QA-43 | tracking ↔ limited flicker 不破窗 (R2.7) [mock-ok] | 1s 内连续 5 次 toggle | **数学**: a4PlantEnabled 状态变化次数 ≤ 1 (200ms 滞后 debounce 生效) |
| QA-44 | plant 按下时机正好在 flicker 中途 [mock-ok] | t=0.0 tracking, t=0.1 plant 调用, t=0.05 limited 来一帧 | **数学**: plant 按下时拿的是 t=0.0 那帧的 tracking state (gate true), 调用应被 accept |

### F 类 — GPS 精度 + arOrigin 距离 (B-Apple+B3 系列)

| ID | Case | 触发条件 | PASS 标准 |
|----|------|----------|-----------|
| QA-50 | GPS accuracy=5m 允许 plant [device-only] | accuracy < 10m threshold | accept |
| QA-51 | GPS accuracy=15m 禁 plant (room) [device-only] | accuracy > 10m | reject — 但有 fallback (R2.3) |
| QA-52 | arOrigin 距离 30m 允许 [mock-ok] | dist < 50m threshold | **数学**: B3 gate 不阻 |
| QA-53 | arOrigin 距离 80m 禁 (要求重启 session) [mock-ok] | dist > 50m | **数学**: B3 gate 阻挡 + emit "session-stale" |
| QA-54 | GPS=15m 室内 fallback 真 plant 落地 (R2.3) [device-only] | accuracy=15m, fallback enabled | **视觉**: cone 落到 raycast hit 点,delta < 0.05m |

### G 类 — Anchor lifecycle (B4 系列)

| ID | Case | 触发条件 | PASS 标准 |
|----|------|----------|-----------|
| QA-60 | PendingAnchorRetry 在场时 V199 不重 parent [mock-ok] | plant 后 PendingAnchorRetry 还在 component (per-case fresh scene 必须) | **数学**: trace.log grep `[V199] PendingAnchorRetry present, yield-break` 命中 |
| QA-61 | PendingAnchorRetry 移除后 V199 才工作 [mock-ok] | plant 100ms 后 retry 完成 → component remove (per-case fresh scene 必须) | **数学**: trace.log grep `[V199] Parented to ARAnchor` 命中,且 cairn.parent === ARAnchor |
| QA-94 | ARKit 删 trackable 后 V199 行为 [mock-ok] | cairn 已 IMMORTAL, ARSession 标 anchor.trackingState = removed | **数学**: V199 不应 throw, AnchorDriftMonitor.cs:83 应 log `[v22-anchor-removed]`, cairn world pos 保持上一帧值 (delta < 0.001m) |

### H 类 — Cross-session ground snap (R2.4)

| ID | Case | 触发条件 | PASS 标准 |
|----|------|----------|-----------|
| QA-70 | 多 floor plane 时取 cairn-XZ-nearest [mock-ok] | 两个 plane: A(area=8m², 距离 cairn 5m), B(area=2m², 距离 cairn 0.3m) | **视觉 + 数学**: snap 后 cairn.y === planeB.y, trace.log grep `[CrossSessionSnap] picked nearest-xz` |
| QA-71 | 单 plane 走原 area-largest 路径 [mock-ok] | 只一个 plane | **数学**: snap 取它,trace.log `[CrossSessionSnap] picked single` |
| QA-72 | 没 plane 时不 snap [mock-ok] | trackables 空 | **数学**: cairn.transform.position 与 reload 前一致 (delta < 0.001m), trace.log `[CrossSessionSnap] no-plane skip` |

### I 类 — LiDAR 三处一致 (R2.6)

| ID | Case | 触发条件 | PASS 标准 |
|----|------|----------|-----------|
| QA-80 | LiDAR 启用时三处都返 true [device-only] | ARMeshManager 在跑 | GroundYResolver, PendingAnchorRetry, PortalSpawnerV199 三处都识别 LiDAR |
| QA-81 | LiDAR 禁时三处都返 false [device-only] | ARMeshManager 不在 | 三处都 false |

### J 类 — UX edge cases

| ID | Case | 触发条件 | PASS 标准 |
|----|------|----------|-----------|
| QA-90 | plant 时 raycast 没命中 plane [mock-ok] | 朝天空 plant | **视觉**: 截图无 cone 出现, trace.log grep `[plant-reject] no-raycast-hit` |
| QA-91 | plant 同一点连发 3 次 [mock-ok] | 3 个 SpawnRequest 同一 x/z, 100ms 间隔 | **数学**: 生成 cairn count === 1 (dedupe by id), 不 === 3 |
| QA-92 | plant 后立刻关 app 再开 [mock-ok] | spawn → cleanup → reload | **视觉**: cairn 持久化,出现在原位 (delta < 0.10m **[基线后定]**) |
| QA-93 | plant 双 hit (floor + table) [mock-ok] | raycast 同时命中 floor (y=0, classification=Floor) + table (y=1.0, classification=Table) | **数学**: 取 floor 不取 table, trace.log `[ground-resolve] picked floor classification` |
| QA-96 | app backgrounded 半截 plant [device-only] | plant 流程中 OnApplicationPause(true), 1s 后 false | **视觉**: resume 后 cairn 完成 plant 在 expected 位置, delta < 0.10m |

---

## 优先级

- **P0 必跑** (R2 修完前后都要过): A 类 + B 类 + C 类 + D 类
- **P1 应跑** (R2 修完时要过): E 类 + F 类 + G 类 + H 类
- **P2 体验** (修完最后跑一遍): I 类 + J 类

---

## 实现要点 (写 harness 时注意)

1. **场景共用** — 所有 case 共用一个 minimal scene (sun + ground + camera + cairn cone proxy),只改 spawn pos / camera pos / drift Δ
2. **Mock plane** — 用 stub 数据(不依赖真 ARPlaneManager runtime),在 Edit mode 直接构造 `BoundedPlane` 或更简单的"假 plane Y 值"
3. **数学 case** (D/E/F/G 类) 走 ARSpikeAutoRun 模式 — 纯 assert,不截图
4. **视觉 case** (A/B/H 类) 走 CairnFlyToSkyTest 模式 — 出 PNG,比较 cone tip y 像素 (30px 阈值)
5. **基线运行** (任务 #161) 用未修代码跑,记录哪些 FAIL,哪些 PASS 已经在
6. **每修一个 R2 bug 跑一次** — 期望对应 case 翻 PASS,其余不 regression
7. **Per-case teardown 强制** — 每个 case 跑完必须:
   - Destroy 所有 spawn obj (`Portal_*` GameObject)
   - Reset `CairnBridge._sessionOffsetX/Y/Z = 0`
   - Remove 所有 `PendingAnchorRetry` component
   - 清 trackables list (mock)
   - 否则 QA-60→61 / QA-23→其他 Tier-A case 顺序污染
8. **`[device-only]` case 在 batchmode 自动 skip** — 输出 verdict.txt 写 SKIPPED + 理由 "Editor 无法 mock ARKit native API"

---

## 输出格式 (每个 case)

```
Logs/qa-cases/QA-NN-<name>/
├── before.png        (视觉 case 才有)
├── after.png
├── verdict.txt       (PASS/FAIL + delta + 失败原因)
└── trace.log         (Debug.Log 抓的关键变量)
```

verdict.txt 格式:
```
QA-NN-<name>: PASS|FAIL
expected: <criterion>
actual: <measured value>
delta: <Δ>
threshold: <ε>
notes: <root cause if FAIL>
```

---

## 总览 (写完后填)

注: 新增 8 个 (QA-06 / QA-39 / QA-44 / QA-54 / QA-93 / QA-94 / QA-95 / QA-96), 合并 4→1 (QA-35/36/37/38 → QA-35 参数化), 标 device-only 7 个 (QA-13/50/51/54/80/81/96)。

| 类别 | 总数 | 视觉 | 数学 | mock-ok | device-only | 已实现 | 基线 PASS | R2 后 PASS |
|-----|------|------|------|---------|-------------|--------|-----------|------------|
| A | 6  | 4 | 2 | 6 | 0 | 0/6  | ?/6  | ?/6  |
| B | 4  | 3 | 1 | 3 | 1 | 0/4  | ?/4  | ?/4  |
| C | 5  | 0 | 5 | 5 | 0 | 0/5  | ?/5  | ?/5  |
| D | 7  | 0 | 7 | 7 | 0 | 0/7  | ?/7  | ?/7  |
| E | 5  | 0 | 5 | 5 | 0 | 0/5  | ?/5  | ?/5  |
| F | 5  | 1 | 4 | 2 | 3 | 0/5  | ?/5  | ?/5  |
| G | 3  | 0 | 3 | 3 | 0 | 0/3  | ?/3  | ?/3  |
| H | 3  | 2 | 1 | 3 | 0 | 0/3  | ?/3  | ?/3  |
| I | 2  | 0 | 2 | 0 | 2 | 0/2  | ?/2  | ?/2  |
| J | 5  | 3 | 2 | 4 | 1 | 0/5  | ?/5  | ?/5  |
| **总计** | **45** | **13** | **32** | **38** | **7** | **0/45** | — | — |
