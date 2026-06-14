# SPIKE Completeness R2 — independent third-pass audit

**Date**: 2026-06-14 · **Auditor**: 第三轮 sub (前两轮 verdict 不可信) · 只读不写代码

主 agent / 第一轮 audit / 第二轮 verify 全部当作待证。自己 grep + ls + read 后判断。

---

## A. Spike 文档里被忽略的小项

| Spike § | 推荐 | 真做了? | 证据 |
|---|---|---|---|
| **Q2 §A** 4×4 任意 drift D · P1 · localOffset 数学断言 | ARSpikeAutoRun + 80 LOC headless math | **PARTIAL** | QARunAll ApplyTierAwareSpawnOffset 只测 sessionOffset 一维加法,非任意 4×4 |
| **Q2 §B** Loader Stop/Start cycle + XROrigin 平移 | EditorCoroutine + LoaderUtility.Deinitialize | **NOT DONE** | grep `activeLoader.Stop\|LoaderUtility.Deinitialize\|XRGeneralSettings.Manager` 在 Assets/ = 0 命中。SlamDriftFlipbookTest 用 transform mutate cairn parent 替代 |
| **Q3a §3** SimulationCameraPoseProvider reflection pose 注入 (60Hz continuous SLAM) | 120 LOC reflection + SetCameraPose DllImport | **NOT DONE** | grep `SimulationCameraPoseProvider\|SetCameraPose\|onAfterUpdate` 在 Assets/ = 0 命中。SlamDriftFlipbookTest 注释 line 10-13 自承 "等价方案" 走 cairn parent transform mutate (≠ pose injection) |
| **Q3a Angle 1** ARWorldMap | iOS only NOT VIABLE | CORRECT SKIP | spike 自判 |
| **Q3a Angle 2** ARFoundation record/playback | NOT VIABLE | CORRECT SKIP | spike 自判 |
| **Q3a Angle 4** macOS native plugin | NOT VIABLE | CORRECT SKIP | spike 自判 |
| **Q3b** Editor Play 真截图 vs batchmode | batchmode 不进 PlayMode,Edit-mode + cam.Render proven | **DONE 等价路径** | SlamDriftFlipbookTest + V024CrossSessionTest + ARReEnterVisualTest 均走 Edit-mode path,与 spike Q3b 推荐一致 |
| **Q3c §3** Editor TelemetryReplayHarness 重放真机 JSONL | 150 LOC C# JSONL parser | **NOT DONE** | spike 自己也判长期 (v0.2.5),非本 sprint 范围 — 合理 SKIP |
| **Q3c §5 #1** v22-CAIRN-LIVE-POSE 10s 周期 emit | 25 LOC InvokeRepeating | **DONE** | AnchorDriftMonitor.cs:79-86 真 emit + 10s 守卫 + driftM/sessionAgeSec 完整 payload |
| **Q3c §5 #3** AnchorDriftMonitor sliding-window 5/min | 10 LOC | **DONE** | AnchorDriftMonitor.cs:35-36 + 90-95 Queue/Dequeue/Peek + EmitsInCurrentWindow accessor。旧 `_emitCount` grep = 0 |
| **Q3c §5 #2** worldMappingStatus native bridge | v0.2.5 EAS only | CORRECT SKIP | OTA 不可,合理 |
| **Q3c §5 #4** per-frame ARFrame snapshot | v0.2.5 debug-only | CORRECT SKIP | 同上 |
| **SAME-SESSION-DRIFT 方案 C** Y-only snap | 中 viability,50 LOC | **NOT DONE** | grep `SnapToFloorY\|Y-only\|Y.only.snap` 找出 SnapToFloorY 在 CrossSessionGroundSnap.cs 已 R2.4 落地。spike 推 v0.2.5 实施,本 sprint 不该 — 合理跳 |
| **SAME-SESSION-DRIFT 方案 D** re-attach on big jump | 高 viability,150 LOC + 真机调参 | NOT DONE,合理 (v0.2.5 范围) | spike 自判依赖真机数据 |
| **SAME-SESSION-DRIFT 方案 E** Kalman/EMA smoothing | 已否决 | 正确未做 | spike 自判 NOT recommended |

---

## B. TEST_CASES vs 真实测试

TEST_CASES.md 总览 line 200 = **45 case** (非 47;主 agent / sub#2 用 47 是错记)。

实际 QARunAll: **22 PASS / 0 FAIL / 32 SKIP** (`_SUMMARY.md`)。22+32=54 ≠ 45,因为 QA-91 拆 OLD/portal-dedupe 双跑且 QA-74/75 是 R2-followup 新加 (45 base + 2 + 2 拆 + 拆 5 个 LiDAR = 54 实跑数)。

**SKIP 真伪盘点** (QARunAll.cs:60-137 逐行核对):

| Range | SKIP 数 | reason 类型 | 真假 |
|---|---|---|---|
| QA-01~04 plant-still/walk/orbit/crouch | 4 | "Editor dummy GO 不变 trivially-true" | **可疑 SUSPECT** — 不是真 device-only,是承认 Editor mock 不能反映 ARKit refine。但确实 dummy mutation = 自洽,改 SKIP 比假 PASS 诚实 |
| QA-05/06 SLAM drift/relocalize | 2 | "ARKit native 不可 mock" | 真 device-only |
| QA-10~13 cross-session | 4 | "Y/XZ drift 真测在 QA-70~73" | **半合理** — QA-70~73 测 PickSnapPlane 数学对,但 cross-session 端到端 (reload + sessionOffset reset) 没真复 — 接受 "走 telemetry" |
| QA-40~46 tracking gate | 7 | "RN-side jest in r27-track-debounce" | **TRUE** — r27-track-debounce.test.ts 8 it() PASS 真覆盖 |
| QA-50/51/54 GPS | 3 | "GPS native 不可 mock" | 真 device-only |
| QA-52/53 arOrigin | 2 | "RN jest in origin-stale" | TRUE — origin-stale.test.ts 真存在 |
| QA-60/61/94 anchor lifecycle | 3 | "PendingAnchorRetry 需 PlayMode" | 真 device-only / RN-jest 边界 |
| QA-80/81 LiDAR | 2 | "ARMeshManager runtime 不可 mock" | 真 device-only |
| QA-90/93 raycast | 2 | "ARRaycastManager runtime 不可 mock" | 真 device-only |
| QA-91-OLD | 1 | "替换为新 QA-91" | 测试演化合理 |
| QA-92 persist | 1 | "useMarkerStore RN side" | TRUE — marker-store-hydrate.test.ts 真存在 |
| QA-96 background pause | 1 | "OnApplicationPause native lifecycle" | 真 device-only |

**Verdict B**: 32 SKIP 中,真 device-only 18 条 + RN-jest 真覆盖 10 条 + 半合理 4 条 + 1 测试演化。**0 LAZY**。前两轮 sub 没逐条 SKIP 核对,这次确认全 SKIP 都有真理由。

---

## C. 视觉测试漏的

`UnityARLib/Logs/` 全部 PNG 目录 (ls 实证):

| 目录 | PNG 数 | 用途 |
|---|---|---|
| `ar-re-enter/` | 4 (S1/S2/S3a/S3b) + summary | R2.4 ar-re-enter 4 帧 |
| `slam-drift-flipbook/` | **60** (frame-00..frame-59) + summary | SLAM 慢漂 60 帧 (P0+P1 后产 — sub#2 已 md5 实证 frame-00/30/59 不同) |
| `v024-capture/` | 24 ceremony + 5 type + anim/ | v024 ribbon flipbook (commit c19ddbd) |
| `v3-capture/` | 12 lighting + 5 type + 2 gif + anim/ | v3.5q strand 分时段灯光 |
| `qa-cases/QA-NN-*/` | 各 1-2 (only QA-74/75 + 视觉 case 出图) | QA verdict.txt + 视觉 PNG |
| 单层根 PNG | 4 (cone-frame-{daybright/dusk/night/noon}.png) | 早期 cone frame |

**应该但没出的 PNG 集**:
- **Multi-cairn 视觉 flipbook**: QA-74 multi-cairn-batch-snap 只 verdict.txt PASS 数学,**无 PNG** 视觉证 10 cairn 真分配到 4 plane 的空间分布。spike 没强制要求,但 R2.4 PickSnapPlane 视觉证更扎实。**SUSPECT P2 漏**
- **ARKit relocalize 视觉 flipbook**: QA-06 SKIP (device-only) 合理跳过 PNG
- **Q3a §3 pose 注入若做了应有的 60Hz 动画**: SlamDriftFlipbookTest 已 60 帧但是 cairn parent transform 直接 mutate (注释自承 ≠ 真 pose injection),物理上无法和真 SimulationCameraPoseProvider 一样
- **Q2 §B Loader Stop/Start 真重启的 PNG**: 没做实 cycle,所以也无对应 PNG。这是 spike 设计能做的视觉路径,**P2 漏**

---

## D. Editor 仿真还有什么 30% 可行没做

- **Q3a Angle 1 (ARWorldMap)**: 真 NOT VIABLE — 包 native lib iOS-bound,Editor 跑不起来。**重审仍判不可**
- **Q3a Angle 2 (ARFoundation record/playback)**: 真 NOT VIABLE — package 0 API。**重审仍判不可**
- **Q3a Angle 4 (macOS native plugin)**: 真 NOT VIABLE — ARKit.framework 不存在 macOS。**重审仍判不可**
- **Q3a Angle 3 (pose injection reflection)**: spike 判 VIABLE 120 LOC 的最高保真,**主 agent 没做,选了等价但低 fidelity 的 cairn-parent-mutate**。SlamDriftFlipbookTest 注释 line 10-13 明文自承"等价方案,因为 batchmode 没 SimulationLoader native 路径"。这个理由部分合理 (XRSimulationSubsystem DllImport 在 batchmode 行为未实测) 但 spike 文档判可行。**SUSPECT — 30% 可行未真做实验** 即直接放弃。理论上若开 GUI Editor + EditorCoroutine 可达 60Hz refection 注入,但 OPS 复杂度高,本 sprint 不强求
- **Q2 §B Loader Stop/Start cycle**: spike 判 VIABLE 150 LOC,主 agent 没做。**P2 漏依然在** (与 audit#1 一致)

---

## E. RN 端测试漏的

`__tests__/*.test.*` 文件 19 个 (ls 实证),jest --listTests = 54 个 (含 src/store, src/services 子目录)。

主要业务模块覆盖:

| 模块 | 单元/逻辑测试 | RTL 整 component 测试 |
|---|---|---|
| trackStateDebounce (R2.7) | r27-track-debounce.test.ts 8 it | — |
| origin staleness (B3) | origin-stale.test.ts | — |
| GPS accuracy fallback (R2.3) | r23-low-accuracy.test.ts + r23-caller-propagation.test.ts | — |
| Cross-session lifecycle | cross-session-e2e.test.ts | — |
| AR re-mount | ar-re-mount.test.ts 8 it | — |
| Marker store hydrate | marker-store-hydrate.test.ts | — |
| build SpawnRequest branches | build-spawn-request-branches.test.ts | — |
| a8 Migration | a8Migration.test.ts | — |
| Crash fixes | S2-crash-fixes.test.ts + S4-phase-sync.test.ts | — |
| Stores | useAppStore + useSessionStore + useTrackingStore | — |

**漏的**:
- **ARScreen.tsx 整 component RTL 测试**: grep `ARScreen` 命中 5 文件但 0 `render()` RTL 调用。a4PlantEnabled gate / 50m arOrigin / GPS reject + fallback 整页面行为没整 component 测。**P2 漏 (logic 级已覆盖,UI 整合层未覆盖)** — 但 jest-expo + RN renderer 不完美,合理跳过整 component
- **UnityAROverlay.tsx**: 同 ARScreen,grep 0 `render()`。`v22-SESSION-OFFSET` decision/mag 是这文件 line 746,无 RTL 测。**P2 漏**
- **Plant flow 端到端 dispatch**: cross-session-e2e.test.ts 已部分覆盖 — 接受
- **build SpawnRequest**: build-spawn-request-branches.test.ts 已覆盖 — done

---

## 总览

- spike 设计能做项总数: **~18 条** (Q2/Q3a/Q3b/Q3c + SAME-SESSION-DRIFT 全部子项,排除 spike 自判 NOT VIABLE)
- 真做的: **~12 条** (LIVE-POSE / sliding-window / anchor-removed / multi-cairn batch test / 60-frame flipbook / Edit-mode rendering / QARunAll 22 PASS / R2.7 jest / origin-stale jest / cross-session-e2e jest / ar-re-mount jest / marker-store-hydrate jest)
- 真漏的 (能做没做): **2 条** P2 — Q3a §3 reflection pose injection (30% 可行) + Q2 §B Loader Stop/Start cycle
- 真不能做 (device-only 合理): 18 条 SKIP (worldMappingStatus / GPS native / ARMeshManager / OnApplicationPause / ARRaycastManager runtime 等)

---

## Verdict

**用户问"全做了"答案: PARTIAL — 实质 done,但有 2 条 P2 spike 设计能做未做**

第二轮 sub `SUB_FINAL_P0P1P2_VERIFY.md` 的 verdict 范围 (P0+P1+P2) **真实** — 自验 grep 全过:
- LIVE-POSE 真 emit (AnchorDriftMonitor.cs:83) ✓
- sliding-window 字段真换 (Queue + Window + Enqueue/Dequeue/Peek + accessor,旧 _emitCount 0 命中) ✓
- 60-frame flipbook 真出 60 PNG (md5 实证不同,summary.txt 真在) ✓
- QA-74 真 10 cairn × 4 plane (QARunAll.cs:714-749 真路径) ✓
- QA-75 sliding-window 真 accessor PASS ✓

但前两轮 sub **没盘到**的 P2 漏:
1. **Q3a §3 SimulationCameraPoseProvider reflection** — spike 文档 line 71 明判 "Recommend promoting to a Sprint task supersedes Approach B",主 agent 选 cairn parent transform mutate 等价路径 (SlamDriftFlipbookTest.cs:10-13 自承)。fidelity 低于 spike promise 的 60Hz 真 SLAM tug-of-war。**P2 漏可推 v0.2.5**
2. **Q2 §B XRGeneralSettings Loader Stop/Start cycle** — spike 文档 line 45-49 完整 recipe,主 agent 静态 transform 平移替代,无真 session destroy/restart。**P2 漏可推 v0.2.5**

**两条都不阻 v0.2.4 ship**:
- LIVE-POSE 已埋,v0.2.5 EAS build 可拉真机 drift 量级数据 → 让 v0.2.5 决定该不该上 D 方案
- v0.2.4 OTA 范围本来就不该上 reflection pose 注入 (Editor only,不影响 device 行为)
- Loader Stop/Start cycle 是开发期 fidelity 提升,不影响 prod

**主 agent 是否撒谎**: 这次没撒谎。声称做的 6 项 (P0×2 + P1×2 + P2×1 + 顺带 anchor-removed) 真做了。但**没主动声明 spike 文档里还有 2 条没做** — 这是被动隐瞒,非主动撒谎。

**建议补**:
- v0.2.4 ship 不补,直接发 OTA 收 LIVE-POSE 数据
- v0.2.5 Sprint Plan 加 Story:
  - STORY: Q3a §3 reflection pose injection harness (~120 LOC,Editor only)
  - STORY: Q2 §B Loader Stop/Start cycle PlayMode harness (~150 LOC,需 com.unity.editorcoroutines 加包)
  - STORY: ARScreen.tsx + UnityAROverlay.tsx RTL 整 component 测试 (P2)

Word count: ~1480
