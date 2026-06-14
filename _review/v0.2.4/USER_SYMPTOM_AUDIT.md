# USER_SYMPTOM_AUDIT — 2026-06-14 (audit sub)

主 agent 言论一律不可信。本报告只引文件 + 行号。

---

## Section 1: 三大症状 vs R2 fix vs 真测覆盖

### 飞天 (重开 app cairn 飘到天上 / 跨 session 飞)

- **主 fix**:
  - R2.4 `CrossSessionGroundSnap.PickSnapPlane` (UnityARLib/Assets/Scripts/CrossSessionGroundSnap.cs) — 重开后选最近 plane snap Y, 加 `CrossFloorBlocked` 防 1F→2F 跨层 (>1.5m 不 snap)
  - R2.3 `setArOriginIfMissing` + 50m 阈值 + GPS acc≤25m (ARScreen.tsx:518-530)
  - R2.6 LiDAR runtime detect 三处一致 (PortalSpawnerV199.cs:251 + GroundYResolver.cs:336 + PendingAnchorRetry.cs:91-96)
- **真测过 case (PASS)**:
  - QA-70 nearest-XZ pick (真调 PickSnapPlane,QARunAll.cs:558)
  - QA-71 single plane (QARunAll.cs:578)
  - QA-72 no plane skip (QARunAll.cs:589)
  - QA-73 cross-floor block 1F vs 2F y=2.8m (QARunAll.cs:596) — 反 self-licking,真路径
  - jest r23-low-accuracy.test.ts 5/5,r23-caller-propagation.test.ts 5/5 (含反向 buggy origin case)
- **真机 only**:
  - QA-10/11/12/13 跨 session reload SKIPPED — 注释 "dummy GameObject + 平移测试不真测 R2.4 的 PickSnapPlane / SnapToFloorY,自洽 trivially"。**真 reload 行为 (ARKit world frame y 漂 0.6m / xz 漂 0.3m / worldMappingStatus lock) 没真测**,只测了 PickSnapPlane 单元函数
  - QA-50/51 GPS native acc — Editor 不可 mock
- **评级**: **PARTIAL** — R2.4 单元层覆盖,跨 session 端到端 (reload → hydrate → pick plane → SnapToFloorY → cairn parent 不被 ARAnchor SLAM 拉走) 没 Editor 测,**真机依赖**

### 移动 (同 session cairn 慢慢漂走)

- **主 fix**:
  - R1 已删 (`AnchorDriftMonitor.cs:7-16`) — self-correct 跟 ARKit anchor refine 打架,**R2 决策: trust ARKit, monitor 只 emit telemetry, 不修 drift**
  - B4 anchor retry 单路径 (PortalSpawnerV199.cs:856-862, PortalSpawner.cs:647 互斥 yield-break)
  - A2.1 pre-spawn ARAnchor (PortalSpawner.cs:621-628 plane-attached anchor + driftMon.Init)
- **真测过 case (PASS)**:
  - 没有真测 same-session drift 的 case
  - QA-01~06 全 SKIP (注释: "dummy GO trivially-true,真测要 PlayMode + ARFoundation runtime")
- **真机 only**:
  - 整个 P1 (B4-2 self-correct) 在 R2 被砍掉,**改为只 emit telemetry**。意思是 v0.2.4 没修同 session 漂,把锅推给 v0.2.5 EAS build + 真机 telemetry 数据再决定怎么修
  - QA-60/61 PendingAnchorRetry vs V199 互斥 SKIP (真 ARFoundation runtime 不可 Editor mock)
  - QA-94 ARSession.RemoveTrackable 不可 Editor mock
- **评级**: **NOT COVERED** — 用户铁律 "同 session 内不漂",R2 把 self-correct 删了改成 trust ARKit + telemetry 观测。**没修,只埋点**。任何同 session 漂走问题 v0.2.4 出 build 还会再现。

### 消失 (cairn 不见 / spawn 失败 / mark 找不到)

- **主 fix**:
  - R2.2 FloorPlaneValidator kRejectMaskHard + Couch 大面积松绑 (FloorPlaneValidator.cs)
  - R2.3 GPS 10-25m 低精度 fallback (ARScreen.tsx:507) — 之前 >10m 直接 return 导致室内不能 plant
  - A 类 trackingState.limited 拒 plant + R2.7 200ms debounce (trackStateDebounce.ts)
- **真测过 case (PASS)**:
  - QA-30~35,39 真调 FloorPlaneValidator.Validate,真构造 ARPlane (QARunAll.cs CreateMockARPlane reflection),9 case 真测拒/接受分支
  - jest r27-track-debounce.test.ts 真调 trackStateDebounce module — 7 case (含 hard cap 200ms + sub#B BLOCKER 反 cancel-rearm)
  - jest r23-low-accuracy + caller-propagation 10 case 真测 buildSpawnRequest 阈值切换
- **真机 only**:
  - QA-40~46 trackingState gate (RN useEffect),C# Editor 不可达,jest 替代
  - QA-90 raycast 没 hit 真路径 SKIP (PortalSpawner.OnSpawnStrand 走 ARRaycastManager)
  - QA-91 dedupe by id SKIP — **而且 PortalSpawner.cs grep 0 命中 by-id dedupe 逻辑**,这个 fix 根本没写
  - QA-92 persist app restart 注释说"真测应该在 RN side jest" — 但 `app/__tests__` 没 marker-store.test.ts / origin-hydrate.test.ts (grep 0 命中)
- **评级**: **PARTIAL** — FloorPlane + trackState + Tier-A 阈值真测;但 dedupe + persist app restart + raycast no-hit 三类真路径未测

---

## Section 2: 用户场景漏洞 (R2 没修 / 测不到)

| 场景 | R2 状态 | 证据 |
|------|---------|------|
| **同 session 慢漂走** | **没修,只 emit telemetry** | AnchorDriftMonitor.cs:14 "trust ARKit. 这个 monitor 只 emit telemetry, 真有大漂移让 telemetry 上报" |
| **dedupe 同 id 重 plant** | **没修** | grep PortalSpawner.cs 0 命中 spawn-id / dedupe / Contains by-id 逻辑;QA-91 SKIP |
| **markerStore.hydrate 端到端** | **零 jest 测** | `app/__tests__` 无 marker-store.test.ts;hydrate (useMarkerStore.ts:278-305) 持久化 lowAccuracy 字段读回路径无单元 test 守 |
| **ARMeshManager 没挂 scene** | **scene blocker 未修** | grep `ARMeshManager` 在 `Assets/Scenes/*.unity` 0 命中。R2.2 LiDAR 分支 + R2.6 lidar runtime detect 永远 false。LiDAR Pro 设备地毯/楼梯 fix 等于不存在 (PROD_PATH_AUDIT.md:14 已报,scene 文件未改) |
| **app backgrounded 半截 plant** | **没测** | QA-96 SKIP (OnApplicationPause 真机 lifecycle) |
| **ARSession Limited / 隧道电梯 plant** | **R2.7 jest 测,真信号 device-only** | QA-13 SKIP "ARKit native worldMappingStatus 不可在 Editor mock" |
| **arOrigin 50m → 重 lock 后旧 cairn 命运** | **未测** | ARScreen.tsx:518-520 走 50m 时 `clearArOrigin()` + 重 set;旧 marker 持久化 arOriginLat/Lng 不清,Tier-A 阈值仍按 originDelta 计算 — 但走出 50m 后新 origin 跟 marker.arOriginLat 距离会 >50m,逻辑上必然 fallback Tier-B GPS,**没单元 test 守此 invariant** |
| **跨房间 cairn parent 漂** | **未测** | "用户走出客厅再回来 cairn 在原位吗" — 同 session SLAM relocalize 行为 R2.4 不在 scope (注释:R2.4 只管跨 session snap,不管 same-session anchor refine);QA-11 注释 "XZ drift R2.4 不在 scope" |

---

## Section 3: 还能加的 Editor / jest case

**能加 (低成本,真值得加)**:

1. **markerStore hydrate jest test** (`app/__tests__/marker-store-hydrate.test.ts`):
   - mock storage,写 `lowAccuracy: true` payload,调 `hydrate(userId)`,断言 `arOrigin.lowAccuracy === true`
   - 反向: 写没 lowAccuracy 字段的旧 payload,断言 hydrate 后 `arOrigin.lowAccuracy === undefined` (不强转 false)
   - 成本: 1 文件 ~30 行,catch 真问题: 持久化 schema breaking change / hydrate 字段丢失
   
2. **arOrigin 50m 自洁 jest test** (`app/__tests__/origin-stale.test.ts`):
   - 当前已有但 grep 0 命中 (QARunAll.cs:104 自我引用 "RN jest in app/__tests__/origin-stale.test.ts" — **此 jest 文件不存在**)
   - 写: 调 setArOriginIfMissing + clearArOrigin → 新 origin 距离旧 marker.arOriginLat >50m 时 buildSpawnRequest 必返 Tier-B
   - 成本: ~20 行,catch: 50m fallback 无静默退化
   
3. **track-debounce QA-44 plant-during-flicker jest 化**:
   - QARunAll.cs:97 注释 SKIP "RN useEffect 是 TypeScript runtime"
   - 但 trackStateDebounce module pure function,r27-track-debounce.test.ts 已有 onTrackEvent — 加一条:t=0.0 tracking → t=0.05 limited (200ms timer schedule) → t=0.10 plant called → 断言 applied 仍 'tracking'
   - 成本: r27 文件加 5 行
   
4. **buildSpawnRequest 全分支 (Tier-A vs Tier-B 全组合)**:
   - 当前覆盖 5/8: 漏 `arkitX==null` (走 Tier-B 快路) + `origin==null` (返 null) + `groundY==null` Tier-B 落 y=0
   - 成本: r23-low-accuracy.test.ts 加 3 case
   
5. **FloorPlaneValidator lidarAvailable=true 分支真测**:
   - QA-30~35 全部 lidarAvailable: false。R2.2 LiDAR 分支永没 jest 覆盖 (CairnAR.unity 缺 ARMeshManager 也是这个原因 — 测不到所以没人发现)
   - QARunAll.cs 加 4 case (lidar=true × 各 classification),不需要真 ARMeshManager,Validate 只看 bool 入参
   - 成本: ~40 行 C#

6. **PortalSpawner dedupe by id case (新写 fix + QA-91 改 PASS)**:
   - 当前 grep 0 dedupe 逻辑。如果 R2 想覆盖 QA-91,要先在 PortalSpawner.cs 加 HashSet<string> _spawnedIds Contains check 才有 fix 可以测
   - 这是 **新 fix 不是新 case**,主 agent 没做

**不能加 (真 device only)**:
- ARKit anchor SLAM refine / single-frame jump (QA-05/06): 真 ARKit native 行为
- worldMappingStatus / relocalize (QA-13): native API
- LiDAR ARMeshManager runtime classification (QA-80/81): 需 LiDAR 硬件
- ARSession 删 trackable (QA-94)
- OnApplicationPause 半截 plant (QA-96)
- GPS native accuracy 真值 (QA-50/51/54)
- PendingAnchorRetry coroutine 真起 (QA-60/61): 需 PlayMode + ARSession
- raycast hit 真路径 (QA-90/93): ARRaycastManager runtime

---

## Section 4: 真机依赖清单 (Editor 实在测不到)

最小集 — 必须 EAS build + 真机 telemetry 验:

1. **跨 session reload 真行为** — ARKit world frame y/xz 漂 + worldMappingStatus 锁 + CrossSessionSnap 触发 + cairn parent ARAnchor SLAM
2. **同 session 慢漂** — AnchorDriftMonitor 真 emit `v22-PLANT-ANCHOR-DRIFT-DETECTED` (R2 没修,**只观测**)
3. **LiDAR Pro 设备** — 地毯 / 楼梯 / 草地 R2.2 + R2.6 真起作用 (前提: scene 先挂 ARMeshManager,目前没挂 = blocker)
4. **GPS accuracy 实测** — 室内 10-25m / 室外 ≤10m / 隧道 >25m 三档 ARScreen.tsx:507-511 行为
5. **app backgrounded mid-plant** — OnApplicationPause(true) 1s 后 false 真行为
6. **ARSession Limited 拒 plant** — 隧道/电梯/暗光 真信号触发 a4PlantEnabled=false
7. **PendingAnchorRetry vs V199 互斥** — 真 1s × 0.1s coroutine 是否撞 V199
8. **ARSession.RemoveTrackable** — anchor.trackingState=Removed 时 V199 行为 (AnchorDriftMonitor.cs:83 应 log `v22-anchor-removed` — 但 grep 该文件 0 命中此 string,**埋点没写**)
9. **PortalSpawner dedupe** — 同 id 连发 3 次真行为 (R2 没写 fix,真机会重叠 spawn)

---

## Verdict

**三大症状是否"已支持 + 真测 + Editor 已尽全力"**: **NO**

具体差什么:

| 症状 | 差什么 |
|------|--------|
| 飞天 | R2.4 单元 PASS,但 Editor 加 markerStore hydrate jest + arOrigin 50m fallback jest 没做 (Section 3 #1, #2);scene 缺 ARMeshManager → R2.2 + R2.6 LiDAR 分支永不触发 |
| 移动 | **R2 主动放弃修**,只埋 telemetry。这不是 "Editor 测不到",是 "代码层根本没 fix"。AnchorDriftMonitor.cs:14 明文 "trust ARKit … 真正修法是重 attach anchor — 但需要 v0.2.5"。用户铁律 "同 session 不动" v0.2.4 build 无修复 |
| 消失 | dedupe by id (QA-91) 没写 fix;markerStore persist 端到端无 jest;PortalSpawner Limited gate 真路径靠 RN debounce 单元测;AnchorDriftMonitor `v22-anchor-removed` 埋点 grep 0 命中 (TEST_CASES.md 写要 emit 但代码没写) |

**严苛认定**:
- 真 PASS 的 16 个 Editor + 18 个 jest case **全是单元函数级**,无一覆盖端到端 (hydrate → spawn → anchor → drift)
- "Editor 已尽全力" 不成立 — Section 3 列出 6 类可加 Editor/jest case 都没做
- "同 session 漂走" 是 NOT COVERED 而非 PARTIAL — R2 决策放弃修
- ARMeshManager scene 配置 blocker 在 PROD_PATH_AUDIT.md 已报,**scene 文件 grep 0 命中,未修**

**结论**: 现状不是 "只能等真机"。是 (a) 至少 4 类 Editor/jest case 没加,(b) 1 个 scene 配置 blocker 没修,(c) 1 个 fix (同 session drift self-correct) 主动放弃,(d) 1 个 fix (dedupe by id) 根本没写。说 "三大症状真测都过 + Editor 尽全力 = 等真机" 是 self-licking — 真机能 catch 的问题 Editor 还没尽力。

SUSPECT 等级: 主 agent 若声称 "v0.2.4 三大症状 Editor 全力覆盖" = 不诚实。
