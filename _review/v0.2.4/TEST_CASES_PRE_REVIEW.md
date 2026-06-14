# TEST_CASES.md Pre-Review (independent reviewer)

铁律基线: cairn = plant 时刻地面 hit 点,焊死。任何偏离 = bug。

## 1. 覆盖完整性 — GAP

漏的:
- **B1 regression**: 只有"接受/拒绝 plane"(QA-30~38),没"修完 R2.1 后,以前 PASS 的桌面/沙发场景没回退"。需 QA-39: 老 belowCam=0.6 站姿场景仍 accept。
- **B3 GPS fallback (R2.3)**: QA-51 写 "reject — 但有 fallback",fallback 是什么没 case 验。需 QA-54: GPS=15m 时走室内 fallback 后 plant 真能落地,delta < 0.05m。
- **track flicker (R2.7)**: QA-43 只测 UI 不抖,没测 plant 在 flicker 中途按下到底吃哪一帧的 gate。
- **MultiSpawner**: QA-23 写得太薄,只一行,没说从哪个 component 调进来,leftover sessionOffset 残留怎么验。
- **AnchorDriftMonitor**: 整个 H 类没用 AnchorDriftMonitor 的 telemetry log 做交叉证据。
- **A 类漏 SLAM 大跳**: QA-05 是 +0.001m/帧 慢漂,真实 ARKit relocalization 是一次性 +0.3m 跳。需补 QA-06。

冗余: QA-35/36/37/38 (Couch/WallArt/Window/Door) 同一逻辑分支,合 1 个参数化 case。

## 2. 阈值合理性 — GAP

- **0.05m 位置 delta**: A 类站定/绕圈合理。但 B 类跨 session(QA-10/11)写 0.10m,没 spec 来源 — CrossSessionGroundSnap 真实精度未实测,先跑基线再定。
- **5px cone tip**: 1280x720 + 默认 FOV 60°,2m 距离,1px ≈ 1.7mm,5px ≈ 8mm,远比 0.05m 严。两个阈值口径不一致。建议视觉 case 也按米换算 (5cm = 约 30px),而不是 5px。
- **GPS 10m / arOrigin 50m / maxFloorDistance 5m**: FloorPlaneValidator.cs:47 默认 5m ✅;GPS/arOrigin 阈值我没在源码里找到 hard-code,case 里需注明这俩数字来源(constant 名 + 行号)否则后续改了 case 不会同步。

## 3. 可独立执行性 — GAP

- D/E/F 数学 case 可走 ARSpikeAutoRun pure-assert,OK。
- **A/B/H 视觉 case 在 batchmode 出 PNG**: CairnFlyToSkyTest 已证明可行 ✅,但 QA-10 "scene reload + transform.y +0.6" 在 Edit-mode 没有真 scene reload,只能手动 Destroy+Instantiate 模拟,case 要写明这个简化。
- **QA-13 worldMappingStatus Limited**: ARKit 这个状态在 Editor 没法 mock,iOS 真机才有。case 必须打 `[device-only]` tag,batchmode 跳过。同理 QA-50/51 GPS,QA-80/81 LiDAR ARMeshManager runtime — Editor 测不到真 LiDAR,只能 mock flag。
- **QA-23 MultiSpawner**: 文件刚被新建(.meta 在 git status),需先确认 MultiSpawner.cs 真存在再写 case。

## 4. 数学 vs 视觉分类 — GAP

13/27 拆得偏视觉。建议:
- **QA-01/04 转数学**: 不动 / 蹲起,直接 assert anchor.transform.position 不变,不需要 PNG。视觉只留 QA-02/03/05 + B 类 + H 类 = 9 视觉。
- **QA-90 (朝天空 plant) 应是视觉**: 看 UI 提示 toast 出现,光 log 不够。

## 5. 边界 case 漏点 — GAP

全没覆盖:
- **plant 时双 hit**: raycast 同时命中 floor + table,取哪个? PortalSpawnerV199.cs 里似乎按 first-hit,需 case 验。
- **ARKit 删 trackable**: cairn anchor 被 ARSession 标记 removed (relocalize 失败),V199 怎么处置? AnchorDriftMonitor.cs 83 行就是干这个的,必须有 case。
- **Tier-A 在 sessionOffset 未初始化时 spawn**: 即 sessionOffset=(0,0,0) 是 "未初始化" 还是 "已初始化但=0"? case QA-20 没区分。
- **plant 期间 app backgrounded**: 半截 plant 流程被 OS pause,resume 后状态。

## 6. 顺序依赖 — GAP

QA-60/61 同名 component PendingAnchorRetry,scene 共用会污染:QA-60 留下的 pendingRetry component 不清,QA-61 起跑时 V199 会以为还在 pending。必须 per-case fresh scene 或 explicit teardown。matrix 没写这一条,加到"实现要点"里。

## 7. PASS criterion 可量化 — GAP

不可机器判的措辞:
- QA-10/11 "cone tip 重新贴地" — "贴地"无量纲。改成 `|cairn.y - groundPlane.y| < 0.02m`。
- QA-43 "UI 不抖" — 抖怎么测。改成 "a4PlantEnabled 在 1s 内 toggle 次数 ≤ 1"。
- QA-91 "只生成 1 个 cairn (or 3 同位置)" — or 是逻辑歧义,必须二选一。
- QA-92 "持久化,出现在原位" — 原位 delta? 沿用 0.10m。
- QA-13 "plant 调用应被 reject" — reject 怎么观察?方法返回 bool? 抛异常? 加一行 trace 关键字。
- QA-60 "yield-break" — 在 trace.log 里 grep 哪个 Debug.Log 字符串,要写明。

---

## 补丁清单

**新增**:
- QA-06 SLAM relocalize 一次性跳 0.3m → 视觉,delta < 0.10m
- QA-39 R2.1 修后老站姿 belowCam=0.6 不 regression → 数学
- QA-54 GPS=15m 室内 fallback 真 plant → 视觉
- QA-44 plant 按下时机正好在 track flicker 中途 → 数学
- QA-93 plant 双 hit (floor + table) → 数学
- QA-94 ARKit 删 trackable 后 V199 行为 → 数学
- QA-95 Tier-A sessionOffset 未初始化 vs (0,0,0) → 数学
- QA-96 app backgrounded 半截 plant → 视觉

**删/合并**: QA-35/36/37/38 → 1 个参数化 QA-35-classification(rejected_kinds)。

**改阈值**:
- 视觉 cone tip 从 5px 改 30px (统一 5cm 口径)
- QA-10/11 0.10m 标 "[基线后定]"
- QA-13/50/51/80/81 加 `[device-only]` tag,batchmode skip

**实现要点新增**:
- 第 7 条: 每个 case 必须 teardown — Destroy 所有 spawn obj + reset sessionOffset + remove PendingAnchorRetry,否则 QA-60→61 顺序污染。

总数 40 → 41 (8 新 - 4 合 - 3 改 tag 不计)。
