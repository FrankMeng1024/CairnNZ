# SPIKE Completeness Audit — v0.2.4

**Date**: 2026-06-14 · **Auditor**: independent reviewer (主 agent claims 不可信) · 只读不写代码

---

## Spike 设计 vs 主 agent 实际做了什么 (对照表)

| Spike # | 设计能做的 | 主 agent 做了? | 证据 |
|---|---|---|---|
| **Q2 §A** Approach A 合成 4×4 transform unit | ARSpikeAutoRun 扩展 ~80 LOC,headless 数学断言 | **PARTIAL** | `Editor/QARunAll.cs:340` 真调 ApplyTierAwareSpawnOffset + QA-20~23 真测,但**没**给出 "4×4 任意 drift D · P1 · localOffset" 完整数学断言 (只测 sessionOffset 一维) |
| **Q2 §B** XROrigin transform 平移仿跨 session shift | ~150 LOC EditorCoroutine,Stop/Start loader + XROrigin 平移 | **PARTIAL** | `CrossSessionDriftTest.cs:81-129` 创建 XROrigin GO 并 `xrOrigin.transform.position = new Vector3(0f, -driftY, 0f)` (line 119),但**只 -0.6m Y 一次性平移**,没 Loader.Stop/Start cycle,没参数化的 (Δx, Δy, Δz) 漂移序列。Logs 内 `cross-session/` 目录**不存在** (line 31-33 标的输出路径) — 4 张实际 PNG 落在 `Logs/ar-re-enter/` 下,是 `ARReEnterVisualTest.cs` 的产物,不是 CrossSessionDriftTest |
| **Q3a §3** SimulationCameraPoseProvider 反射 pose 注入 (continuous SLAM 60 Hz tug-of-war) | ~120 LOC EditorCoroutine + reflection,InputSystem.onAfterUpdate hook,SetCameraPose DllImport | **NOT DONE** | grep `SimulationCameraPoseProvider` 在 `UnityARLib/Assets/` = 0 命中。grep `SetCameraPose|ISimulationSessionResetHandler|onAfterUpdate` 在 Editor 源码 = 0 命中 (只有 il2cppOutput build 产物) |
| **Q3b** PlayMode flipbook (60 帧持续漂 cone 慢漂动画) | V024 pattern 复用,~80 LOC,PNG flipbook 0..N 帧逐帧 cam.Render | **NOT DONE for drift** | `ar-re-enter/` 下只 4 张静态 PNG (S1/S2/S3a/S3b),非 60 帧 flipbook。`fly-to-sky/` 目录**不存在** (用户描述的"早期 fly-to-sky 截图"在 git status 之外)。`v024-capture/ceremony-*.png` 是 24 帧 ribbon flipbook (commit c19ddbd)**不是 drift flipbook**。`CairnFlyToSkyTest.cs` 文件存在但 grep `flipbook|frame-|for.*60|InvokeRepeating` = 0 命中 |
| **Q3c #1** v22-CAIRN-LIVE-POSE 10s 周期 emit (本 sprint OTA 该推) | ~25 行 InvokeRepeating 在 CairnAcquireController IMMORTAL 状态下 | **NOT DONE** | grep `CAIRN-LIVE-POSE\|LIVE-POSE` 在 `UnityARLib/Assets/Scripts/` = 0 命中 (只在 spike md 里). grep `InvokeRepeating` 在 CairnAcquireController.cs = 0 命中。**违反 Q3c §问题 5 推荐 + SPIKE-SAME-SESSION-DRIFT.md:51 短期推荐** — 没有这埋点,v0.2.5 拿不到真机 drift 量级分布 |
| **Q3c #3** AnchorDriftMonitor cap 改 sliding-window (5/min) | ~10 行改 cap | **NOT DONE** | grep `sliding|滑窗\|TimeSpan|FromMinutes` 在 AnchorDriftMonitor.cs = 0 命中。仍是 cap=5/session |
| `v22-anchor-removed` 埋点 (USER_SYMPTOM_AUDIT.md:130 列的) | AnchorDriftMonitor 加 emit | **DONE** | `AnchorDriftMonitor.cs:64` `UnityLogger.IForward("v22-anchor-removed", ...)` |
| **Multi-cairn batch snap test** (R2.4 多 cairn 同时 PickSnapPlane) | QARunAll 加 case,N 个 cairn 同时 snap | **NOT DONE** | QA-70~73 全是 1 cairn × 1 plane 组合 (`QARunAll.cs:640-694`)。grep `multi.cairn\|MultiCairn\|batch.*snap` 在 Editor = 0 命中 |
| **60 帧持续 SLAM 漂 flipbook** (AnchorDriftMonitor 时序数据) | Editor transform 每帧 +0.001 m × 60 帧 → 60 张 PNG | **NOT DONE** | grep `frame-\|0\.001\|for.*60.*Render\|EditorManualTick.*drift` 在 Editor = 0 命中。CrossSessionDriftTest 只两点采样 (S1/S2),无 timeline |
| **ARWorldMap (Angle 1)** | iOS only, NOT VIABLE in Editor | **CORRECTLY SKIPPED** | spike 自己判 N/A |
| **Angle 2 ARFoundation record/playback** | NOT VIABLE | **CORRECTLY SKIPPED** | spike 自己判 N/A |
| **Angle 4 macOS native plugin** | NOT VIABLE | **CORRECTLY SKIPPED** | spike 自己判 N/A |
| QA-05/06/13 (SLAM slow drift / relocalize / worldMappingStatus) | spike 明判 Editor 不可仿,真机 telemetry 才行 | **CORRECTLY SKIPPED** | `QA-05/06/13/verdict.txt` 全 SKIPPED + 写 reason "真机 telemetry 验证" |

---

## 漏的清单 (sub 真验)

1. **Q3a §3 Pose 注入 (HIGHEST FIDELITY,SPIKE 明判 "supersedes Approach B")** — 完全没做。120 LOC + reflection,无外部依赖,Editor only,无 EAS build 需求。这是 SPIKE-Q3a 报告 line 71 "Recommend promoting to a Sprint task"。**P0 漏**。
2. **v22-CAIRN-LIVE-POSE 10s emit** — Q3c §问题 5 #1 + SPIKE-SAME-SESSION-DRIFT.md:51 都明判**本 sprint OTA 推**。25 行,可推 OTA,无需 EAS。不加这个 v0.2.5 没真机 drift 量级数据,等于阻断 SPIKE-SAME-SESSION-DRIFT 的 v0.2.5 决策路径。**P0 漏**。
3. **Multi-cairn batch snap test** — R2.4 PickSnapPlane 设计是 per-cairn,但生产场景多 cairn 同时存在。QA-70~73 单 cairn 不能 cover N>1 时的 plane-pick 顺序 / 共享 plane 池竞争。~30 LOC `QARunAll.cs` 加 case。**P1 漏**。
4. **AnchorDriftMonitor sliding-window cap (Q3c #3)** — 现 5/session 跨小时 session 看不全。10 LOC,OTA 可推。**P1 漏**。
5. **60 帧持续 drift flipbook** — Q3a §3 不做的话至少 Q3b 做"transform 每帧 +δ × 60 帧"近似 SLAM 慢漂可视化。当前 4 张静态 PNG 验不了"持续漂 60 帧 cone 是否抖动 / detach"。~50 LOC 复用 V024 pattern。**P1 漏**。
6. **Q2 §B Loader Stop/Start cycle** — 当前 CrossSessionDriftTest 只 transform 平移,没 `XRGeneralSettings.Manager.activeLoader.Stop()` → `Initialize()`,等于 SPIKE-Q2 §B 描述的 "session 1 真销毁 + session 2 重启" 路径**少做一半**。当前实现等价于 §A unit math + 一帧 teleport,fidelity 比 SPIKE-Q2 promise 的低。**P2 漏**。

---

## 不漏 (sub 确认主 agent 做了)

1. **v22-anchor-removed 埋点** — `AnchorDriftMonitor.cs:64` 真 emit (USER_SYMPTOM_AUDIT.md:130 列的项已闭环)
2. **QARunAll 16 真调 PASS** — `Editor/QARunAll.cs:340/366/640-694` 真 invoke FloorPlaneValidator.Validate / ApplyTierAwareSpawnOffset / PickSnapPlane,verdict.txt 落盘,这是 §A 数学层 covered (虽然不完整)
3. **CrossSessionDriftTest XROrigin 平移** — line 81-129 真创建 XROrigin GO + 平移,部分 §B (Y-only,无 Loader cycle)
4. **AR re-enter 4 张视觉 PNG** — `Logs/ar-re-enter/` S1/S2/S3a/S3b PASS criteria 在 summary.txt 列清,这是 R2.4 fix 的视觉证据
5. **Q3a Angle 1/2/4 + QA-05/06/13 正确 SKIP** — spike 自己判 not viable 的,主 agent 没瞎做白工

---

## Verdict

**主 agent 是否"全做了"? NO** — 至少 6 条 spike 设计能做且应做的没做,2 条 P0 (Q3a §3 Pose 注入 + v22-CAIRN-LIVE-POSE 10s emit) 直接堵 v0.2.5 决策路径。

**优先级清单**:
- **P0** (本 sprint 内必加,OTA 可推 / Editor only): #2 v22-CAIRN-LIVE-POSE,#1 Q3a Pose 注入 reflection harness
- **P1** (本 sprint 强烈建议): #3 Multi-cairn batch test,#4 sliding-window cap,#5 60 帧 drift flipbook
- **P2** (可推后): #6 Q2 §B Loader Stop/Start cycle

**主 agent 现状定性**: 把 §A 数学层 + §B 静态 2 帧打了个底,但 spike 报告本身判最高保真的 Q3a §3 完全没碰,Q3c 短期 OTA 推荐埋点也没加。CHECKLIST 上 "Editor 16 PASS + 4 张视觉 PNG" 是 真做了,但**这只是 spike 设计能做的 ~40%**,不是"全做了"。用户问题答案: **NO,差 P0 两条 + P1 三条**。

**Word count**: ~860
