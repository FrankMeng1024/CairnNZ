# SPIKE-Q3c — Telemetry Replay 可行性调研

**Date**: 2026-06-14 · **Author**: 数据/可观测性 spike · **Mandate**: 调研用真机已收集 telemetry 反向重放 ARKit pose 在 Editor 验证 fix 的可行性。**不写代码**。

---

## 问题 1 — Telemetry 当前覆盖度

**Emit 标签清单**（grep 全仓所得，按子系统分组）:

| 子系统 | 标签 | 文件:行 | Payload 字段 |
|---|---|---|---|
| Plant Anchor | `v22-PLANT-ANCHOR-CREATE` | PortalSpawner.cs:620, PendingAnchorRetry.cs:110/153 | id, anchor pose |
| Plant Anchor | `v22-PLANT-ANCHOR-DRIFT-DETECTED` | AnchorDriftMonitor.cs:74 | id, reason, initial(x,y,z), now(x,y,z), emit/cap |
| Plant Anchor | `v22-PLANT-ANCHOR-TIER-A/-A-REJECT/-B` | unityCairnSpawn.ts:189/206/215 | id, originDelta, arkit(x,y,z), gps, xz, y |
| Acquire FSM | `v22-ACQUIRE-STATE/-LATCH-PROGRESS/-TRIGGER/-ANCHOR/-L2/-LINGER` | EXEC_REPORT.md:78-83；CairnAcquireController.cs | markerId, state, dist, rayHitMarkXZ, facingDot, planeArea, latencyMs |
| Ceremony | `v22-CEREMONY-DONE`, `v22-CAIRN-IMMORTAL` | EXEC_REPORT.md:84；CairnAcquireController | markerId, atPos[3], fromFallback |
| Cross-session | `v22-CROSS-SESSION-SNAP` | CrossSessionGroundSnap.cs:153 | markerId, oldY, newY, xzDelta, latencyMs |
| Ground-Y | `v22-GROUND-Y-SOURCE` | GroundYResolver.cs:235/250/295/304 | tier (A/B/C), 偏差 cm |
| AR session | `v22-WORLDALIGN`, `v22-DIAG-SESSION` | ARKitSessionInit.cs:118-192, CairnBridge.cs:637 | requested vs current, binVer, buildGuid |
| Cairn fingerprint | `v22-DIAG-CAIRN`, `v22-DIAG-SPAWN` | PortalSpawnerV199.cs:293, PortalSpawner.cs:492 | id, type, layer enabled flags |
| Anchor attach | `v22-ANCHOR` | PortalSpawnerV199.cs:845/859/872/929, MultiSpawner.cs:276/282 | skip reason / attach result |
| Resume / Retry | `v22-RESUME-RELOCALIZE`, `v22-RETRY-OK`, `v22-RETRY-DEADLINE` | 014_marker_anchor_metadata.sql:35-42 (commented; emit 在 PendingAnchorRetry) | markerId, latency |
| Migration / FSM | `v22-MIGRATION`, `v22-A4-FSM` | a8Migration.ts:71-124, useArOriginStore.ts:142-222 | from/to version, marker count, FSM state |
| Frame timing | `v22-FRAME-TIMING` | MASTER_BUG_SHEET.md:79 (设计；未在 Unity 仓搜到 emit) | fps, sample-1Hz |
| Session offset | `v22-SESSION-OFFSET` | UnityAROverlay.tsx:746 (RN side) | decision, mag |

**RN 上传链路**:
- Unity 端 `CairnBridge.SendToRN(name, json)` (CairnBridge.cs:1058) → RN `unityBridge.ts:285` switch handler
- 也可走 `UnityLogger.IForward` → console.log → RN crashLogger breadcrumb (`a8Migration.ts:71` 风格)
- 真正的持久化在 `app/src/services/debugLogger.ts`：内存 buffer (max 1000 events)，每 100 条或 30s flush 到 `{documentDirectory}/cairn-logs/sessions/{session_id}.jsonl`，session-rotate 保留 10 个
- 上传 `app/src/services/telemetryUploader.ts` → `POST /api/telemetry/sessions` (Content-Type: application/x-ndjson)，触发于 endSession + network-online + AppState=active + 启动 5s 后
- Auth 通过 `X-API-Key` header 但 backend 当前 `requireApiKey` is no-op (`telemetry.js:49-51`)，dev 模式

**Verdict**: 覆盖度对 plant-time / acquire / ceremony / spawn 充分，**但缺少**：(1) 周期性 ARKit camera pose 流，(2) IMMORTAL 后 cairn pos 周期性快照，(3) `worldMappingStatus` (B-Apple 核心信号，整仓 0 处 emit)，(4) ARFrame 级时序 (只有事件型)。

---

## 问题 2 — 服务端数据结构

**两张表**：

1. **`telemetry_sessions`** (`backend/src/migrations/006_telemetry.sql`)
   - 主键 `session_id` (UNIQUE)，列：device_model/os/os_version/app_version/build_number, started_at/ended_at/duration_ms, events_count, raw_size_bytes, activity_mode, **`raw_jsonl LONGTEXT`**, uploaded_at, upload_source
   - **整段 JSONL 完整存** — 每 event 一行 JSON，可直接 stream-parse
   - 索引：session_id, uploaded_at, started_at, app_version

2. **`debug_snapshots`** (`backend/src/migrations/011_debug_snapshots.sql`)
   - 主键 `snapshot_id`，**`image_blob LONGBLOB`** (PNG 2-6MB)，meta JSON (free-form)，device_os, app_version, ar_mode
   - 用户按 🐛 按钮触发 — **不是逐帧 ARFrame** 抓拍
   - 与 telemetry_sessions 是分表分上传通道

**字节量预估** (一次完整 plant→IMMORTAL 流程):
- 事件数：plant (5) + acquire FSM (~30 state transitions @ 1Hz) + 仪式 (3) + IMMORTAL (1) ≈ 40 events
- 每 event ~200 字节 JSON → ~8KB raw_jsonl
- 加 `v22-ACQUIRE-LATCH-PROGRESS` 1Hz × 15s ≈ 15 行 → 11KB total
- **如加周期性 pose dump (10Hz × 60s × 80 字节)** = 48KB/分钟 cairn → 一次 5min plant flow ≈ 250KB/cairn
- `raw_jsonl LONGTEXT` 上限 4GB，10MB 单 upload cap (telemetry.js:30)，完全够用

**查询接口**: `GET /api/telemetry/sessions?since=...` 列表 + `GET /api/telemetry/sessions/:id` 取完整 raw_jsonl。SQL 直查可走 `WHERE raw_jsonl LIKE '%v22-XXX%'` (EXEC_REPORT.md:162 已证实在用)。

---

## 问题 3 — Replay 可行性

**从一份完整 plant session JSONL 可重建**:

| 维度 | 可重建？ | 来源标签 |
|---|---|---|
| cairn spawn pos / type | YES | `v22-PLANT-ANCHOR-CREATE` + `v22-DIAG-SPAWN` (tier-A 含 arkitX/Y/Z, tier-B 含 xz+groundY) |
| Tier 决策路径 | YES | `v22-PLANT-ANCHOR-TIER-A/-B` + `v22-GROUND-Y-SOURCE` |
| sessionOffset 决策 | YES | `v22-SESSION-OFFSET decision/mag` |
| Acquire FSM 全过程 | YES | `v22-ACQUIRE-STATE` 序列 |
| IMMORTAL 时 cairn 落点 | YES | `v22-CEREMONY-DONE atPos[3]` |
| Drift 事件 | YES (但只有 5 次/session cap, AnchorDriftMonitor.cs:30) | `v22-PLANT-ANCHOR-DRIFT-DETECTED initial vs now` |
| **ARKit camera pose 序列** | **NO** | 整仓未 emit per-frame camera pose |
| **floor plane Y 历史** | 部分 | tier-B 时 emit 一次 groundY；plane refine 历史无 |
| **cairn 飘走过程** | **NO** | drift 只 emit "前 5 次跳变"，不是 timeline |

**Editor 端 `TelemetryReplayHarness` 设计 (假设性)**:
1. 读 JSONL → 按 ts 排序 → 顺序回放
2. 每条 `v22-PLANT-ANCHOR-CREATE` 触发 `PortalSpawnerV199.AddCairn(reconstructed_data)` 走真实代码路径
3. 每条 `v22-CROSS-SESSION-SNAP` 模拟二次启动，强制 `bestPlane.center.y = newY`
4. Editor 截图与真机 expected screenshot 侧边对比

**对 Q2 Approach B (XR Simulation 合成 drift) 的提升**：
- B 用 **合成**位移走 ARFoundation 模拟器；Q3c 用**真实事件序列**走真实 `PortalSpawnerV199` 代码
- B 验证 fix 的数学；Q3c 验证 fix 在真实场景顺序下的行为（覆盖 race condition / state machine 顺序问题）
- **限制**：JSONL 只有事件，无 ARKit per-frame pose — 无法重放 SLAM tug-of-war 真过程，**只能重放事件结果**

**实现成本**: ReplayHarness ~150 LOC C# Editor script + JSONL parser，1-2 天。

---

## 问题 4 — 不可仿信号清单

**Editor 永远拿不到的 ARKit native 信号**:
- `worldMappingStatus` (B-Apple 核心) — ARKit 私有
- `ARCamera.trackingState` 的 `notAvailable/limited(.relocalizing)` 真因 (IMU drift / featureless)
- LiDAR mesh classification (`ARMeshClassification.Floor` 等) — XR Sim 无
- IMU drift 累积曲线
- 真实 plane refine 历史 (XR Sim plane 是 hand-authored，refine 是 stub)
- 后台 30s 后 ARSession 重建是否成功 relocalize

**Editor 可验证的（即使仿不了 ARKit 原生信号）**:
- C# 业务逻辑分支 (tier-A/B/C 选择, sessionOffset 决策, FSM 状态机)
- spawn → acquire → ceremony 完整状态机走通
- CrossSessionGroundSnap 在已知 plane 下的 SnapToFloorY 数值正确
- AnchorDriftMonitor emit cap 与阈值逻辑

**最终判定**:
| Bug | 必须真机 telemetry | Editor (replay) 够 |
|---|---|---|
| B-Apple (worldMappingStatus) | ✅ | ❌ |
| B4-2 (跨 session SLAM 漂) | ✅ | 验证 snap 数学 OK，验证不了 SLAM 漂本身 |
| Tier-A/B 决策 bug | — | ✅ |
| FSM order bug | — | ✅ |
| sessionOffset zero-lock | — | ✅ |

---

## 问题 5 — Telemetry 增强建议

**当前 emit 漏的关键字段**:

1. **IMMORTAL 后 pose 周期 dump** — `v22-CAIRN-LIVE-POSE` (新): 每 10s emit `(markerId, worldPos[3], anchorPos[3], planeY, cameraPos[3], trackingState)`，在 `CairnAcquireController` IMMORTAL 状态下加 InvokeRepeating。**字节量**: 80B × 6/min × 10min session = 4.8KB/cairn — 可忽略。**LOC**: ~25 行。
2. **worldMappingStatus 周期** — `v22-WORLD-MAPPING-STATUS` (新): 1Hz emit ARKit native value (需 v0.2.5 EAS build + native plugin bridge — 不能 OTA)。**LOC**: native ~50 + Unity P/Invoke ~30。
3. **AnchorDriftMonitor cap 改 sliding-window** — 现 5/session 太少，改为 5/min 滑窗，能完整捕捉跨小时漂移。**LOC**: ~10 行。
4. **per-frame ARFrame snapshot** (重型，仅 debug 模式开): `v22-ARFRAME` 1Hz, 含 camera pose + active anchors count + planes count。**字节量**: 200B × 60/min ≈ 12KB/min。**LOC**: ~40 行 + debug toggle。

---

## 整体结论

**Telemetry replay 是 Q2 Approach B 的更高保真补充，不是替代**。

- **B (XR Simulation 合成 drift)**：低成本验证 fix 的数学正确性，可在任何 Sprint 跑，但全人造数据
- **Q3c (Telemetry replay)**：高保真验证 fix 在真实事件序列下的行为，但**依赖真机已采集的 session JSONL**，且无法重现 ARKit native 信号

**搭配方案**:
- **数学层** (sessionOffset clamp / drift snap 数值) → B 跑得快、回归友好
- **顺序层** (FSM race / acquire→ceremony→IMMORTAL 时序) → Q3c 用真 session 跑过一次
- **ARKit 原生信号层** (B-Apple, B4-2 SLAM) → 必须真机 + v0.2.5 EAS build，**两者都覆盖不了**

**短期 (v0.2.4)**:
- 不开发 ReplayHarness（OTA 内不可上 native，且 v0.2.4 已有 AnchorDriftMonitor / CrossSessionGroundSnap 的 telemetry）
- 加埋点 #1 (`v22-CAIRN-LIVE-POSE` 10s 周期) + #3 (drift cap 滑窗) — **OTA 可推**，本 Sprint 内
- 用真机现有 `v22-PLANT-ANCHOR-DRIFT-DETECTED` aliyun 查询当 ground truth，按 `feedback_review_loop_dynamic` 内存铁律做 fix 验证

**长期 (v0.2.5)**:
- 上 #2 (`worldMappingStatus` native bridge) + #4 (per-frame ARFrame dump，debug-only)
- 同 Sprint 实现 ReplayHarness Editor script — 用 v0.2.5 收来的真机 JSONL 做回归套件
- 排序：B (Sprint 内) → Q3c with #1/#3 (Sprint 内) → #2/#4 + Harness (v0.2.5)

**绝不替代**：真机 + aliyun debug_snapshots + telemetry_sessions 仍是 B-Apple / B4-2 唯一 ground truth (与内存 `feedback_review_loop_dynamic` 一致)。
