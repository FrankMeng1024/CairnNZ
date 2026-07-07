# v409 DESIGN — Hike Data 后台生存 + Offline Queue + 缓存清理

**Date**: 2026-07-06  
**Author**: v409 架构决策员（基于 A/B/C/D + debate 五份材料）  
**Scope**: 设计文档，不写代码。用户拍板后主 agent 照此实施。  
**引用规则**: `[A]` = Research A / `[B]` = Research B / `[C]` = Research C / `[D]` = Research D / `[DBT]` = debate。

---

## 0. 产品承诺（先定义再实施）

v409 **不承诺 "GPS 零丢"**。debate 明确：iOS force-quit / jetsam 后 continuous updates 永久失效，SLC 只是 ~500m/5min 粗点，continuous 1Hz 精度不可能恢复 [A §1a-1c, DBT Q1]。

**承诺（精确措辞）**：
> "Kill 后重开可恢复到 kill 前最后一次落盘的 GPS 点。中间 gap 段自动补一条 SLC 粗点连线并标记为 low-confidence，不参与 distance / duration 统计。"

这是产品语义硬约束，写入 Story AC，PO 拍板前不能改。

---

## 1. iOS 位置 API 组合（三级栈）

| 级别 | API | 何时激活 | 精度 | 覆盖场景 |
|---|---|---|---|---|
| **L1 continuous** | `Location.watchPositionAsync({ accuracy: BestForNavigation, distanceInterval: 5 })` (foreground) + `Location.startLocationUpdatesAsync(TASK, {...})` (background) — **Cairn 现状** [D §1] | AppState active/background 且 status='tracking' | ~5-10m GPS | 主链路；user 未 kill App 时的所有采集 |
| **L2 SLC** | `Location.startLocationUpdatesAsync(BG_SLC_TASK, { activityType: 'other', deferredUpdatesInterval: 0, showsBackgroundLocationIndicator: false })` **配合 expo-location patch 或 native module 调 `startMonitoringSignificantLocationChanges`** — **Cairn 尚无** [A §3b, D §4] | `status='tracking'` 时与 L1 并行 register；stopTracking 时 unregister | ~100-500m cell/WiFi | force-quit / jetsam 后 iOS 重新拉起 App，让 App 恢复 L1 |
| **L3 last-fix cache** | `cairn_last_fix_v1` AsyncStorage 已存在 [D §2] | 每次 GPS callback 落盘 | 无采集，只提供"最后已知位置" | 冷启动地图初始 pan、SLC gap segment 起始点 |

**关键设计决策**：
- **L1 + L2 并行**（同一 CLLocationManager 或独立 manager 均可，Apple 允许 [A §2d]）
- **L2 未确证 expo-location 是否直接支持** → 见 §9 Spike-1；如需 native 补丁，走 "expo-location patches" 目录，不重新 EAS build（用户 memory 铁律）
- **不使用 geofencing** — 任意路径 hiking 不适合，radius 与精度矛盾 [A §3d]
- **SLC gap segment 语义**：连续两个 SLC 点之间 > 3 分钟且距离 > 300m → 生成一条虚拟 track_point，`is_low_confidence=1`，UI 灰色断线

---

## 2. 本地存储方案

**选定**：**独立 hike-track 纯 append JSONL** 作为 v409 交付方案，`expo-sqlite` 作为 Sprint N+1 的迁移目标。理由：

- debate 结论 "expo-sqlite 是合理默认但不是无争议赢家；纯 append JSONL 在 crash safety + 简单性上竞争力强，半行只丢 1 行" [DBT Q2]
- B 报告承认 3 处"不知道"，其中 (a) SQLite iOS jetsam 后 WAL 恢复行为 + (b) expo-sqlite 是否已在当前 EAS build 内 —— 都是决策阻塞点 [B §6.3]
- 用户 memory "eas build 永远禁"，SQLite 就算是官方 Expo module 也需要一次 archive build 验证，v409 不冒这个风险
- v409 是 hotfix 性质（194 session 后 56 分钟数据 zero），要**这个周期就能推 OTA**

**文件 layout**：
```
{FileSystem.documentDirectory}/cairn-hike-tracks/
  ├── active/
  │     └── {sessionId}.jsonl        ← 当前活跃 hike 的 tail，每 30s / 每 50 点 append
  ├── completed/
  │     └── {sessionId}.jsonl        ← stopTracking 后 rename 到此，等待 finalize 上传确认
  └── meta/
        └── {sessionId}.json         ← { started_at, remote_session_id, activity_mode, last_ts, total_points, uploaded }
```

**JSONL 每行 schema** (~85 bytes)：
```json
{"t":1720260000000,"lat":-36.848461,"lng":174.763336,"acc":8.5,"alt":42.3,"src":"fg|bg|slc","conf":1}
```
- `src`: `fg`=foreground watch, `bg`=TaskManager background, `slc`=significant-change gap point
- `conf`: `1`=high (GPS)，`0.5`=low (cell/WiFi)，`0`=gap fill only

**Crash safety**：纯 append，绝不 read-modify-write。写中断只丢 1 行（可能半行），tail-recover 时 skip malformed line。**不复用 debugLogger.doFlush 的 read-concat-write 路径** [B §1, DBT Q2]。

**与 debugLogger 完全解耦** —— 独立目录、独立文件、独立 gate（gate 在 `status==='tracking'`，不 gate 在 debugMode）[D §4]。

---

## 3. 无网离线 queue

**数据流图**：
```
GPS callback (fg / bg)
   │
   ▼
addTrackPoint()  → Zustand trackPoints[]（内存）
   │
   ├──► hikeTrackWriter.append(point)   ← 立即写磁盘 active/{sid}.jsonl
   │       └── 30s 批量 flush（fsync 前的 write buffer）
   │
   └──► 每 60s (FG) / 300s (BG) tick:
            ├──► sessionService.remoteAppendPoints(slice)
            │       ├── ok → lastFlushedIdx = total
            │       └── fail (5xx / network / 401) → offlineQueue.enqueue(op)
            │
            └──► （新增）每 5 min 检查 active/{sid}.jsonl 大小
                    大小 > 500 KB 或 uptime > 30 min 无成功 flush → 强制 offlineQueue.enqueue 一份磁盘 tail slice
```

**Retry / backoff 参数**（改写现有 `offlineQueue.ts`）：
- 初始 backoff：**5s**
- 公式：**指数** `min(2^attempts * 5s, 30min)`（不是现在的 `attempts^2 * 5s`，debate + B 都指出线性平方不够 [B §5, DBT Q5]）
- MAX_ATTEMPTS：8（保留）
- Trigger：`networkMonitor.online` / `AppState=active` / 冷启 hydrate（新增）
- **Chunk upload**：payload > 512 KB 时切分为 512 KB chunks，每 chunk 独立 opId，server 端按 opId 幂等 dedupe

---

## 4. 无 GPS 语义（产品决策）

**选定选项 A**（debate 推荐 [DBT Q3]）：
- 精度 > 100m 的 fix → 不写入 trackPoints[]（保留现有 accuracy gate），但**必须 append 到 JSONL** 带 `conf=0.5` 标记，供 stopTracking 后 debug 分析
- SLC-only 段 → 生成"gap segment"，UI 显示灰色断线，distance/duration 不计
- Activity Detail 页显示："This hike has X min of low-signal gap (subway, deep valley, or app killed). Track jumps to next known location."

**绝对不做**：把低精度点当高精度点连线 —— 这是 194 session 类型的信任事故 [DBT Q3]。

---

## 5. 缓存清理

**v409 只做 2 层**（debate 结论 "L1/L3 延后，先做 L2 + L4" [DBT Q4]）：

| 层 | 阈值 | 触发 | 保留 |
|---|---|---|---|
| **L2 Size cap** | `cairn-hike-tracks/` 总大小 > **150MB** | 每次 stopTracking + 冷启 hydrate | 未上传 (`meta.uploaded=false`) 全保；已上传按 `ended_at` 升序删最老的 completed 文件 |
| **L4 用户手动** | Settings 加两个按钮："Clear uploaded hike data" / "Clear all local hike data (danger)" | 用户主动点按 | 由用户选 |

**150MB 阈值理由**：Strava 2h ≈ 1MB [C §1.3]。150MB ≈ 300h hike。中低端 iPhone (64GB) 5% 内。重度用户 (>300h) 会先看到 L4 提示。

**不做 L1**（上传后立即降级 summary）：debate 反对，UX 风险未评估 [DBT Q4]。用户可能想在 App 内 review 老 hike 的 detail 路径。

**不做 L3 (TTL)**：debate 明确 "共识来源是 B 自己的假设" [DBT Q4]。

---

## 6. 上传通道

**保持三条独立**（debate 明确纠正 B 的"两条"漏报 [DBT Q5]）：

| # | 通道 | Endpoint | 触发 | 幂等 key |
|---|---|---|---|---|
| 1 | **hike GPS 主链** | `PATCH /api/sessions/{id}/append-points` + `PATCH /api/sessions/{id}` (finalize) | 60s FG / 300s BG / 冷启 replay | `client_op_id`（新增，backend 已有 `idempotency_keys` 表）[D §3] |
| 2 | **memory_points** | `POST /api/memory/points` | `useMemoryStore.subscribe` unsynced 变化，5s debounce | `cid` (client-side UUID，已存在) |
| 3 | **telemetry (debug)** | `POST /api/telemetry/upload` | `telemetryUploader` — 只在 `debugMode=on` 时激活 | `session_id` (dbg) |

**共享基础设施**：全部走 `offlineQueue`，队列条目 `op_kind` 区分。三条独立 payload shape，独立 endpoint list，独立 lifecycle。

**Payload shape 变化**（v409 新增）：
- append-points body 从 `{ points: [...] }` 改为 `{ points: [...], client_op_id: "uuid" }`
- backend 需支持 `client_op_id` dedupe（当前 idempotency_keys 表已支持 opId 概念）
- 若 backend 未准备好 → v409 client 先送 opId（backend 忽略也不错），backend 下个 sprint 加 dedupe 逻辑

---

## 7. 代码改动清单

| # | 文件 | 位置 | 改动 | 风险 |
|---|---|---|---|---|
| 1 | **新增** `app/src/services/hikeTrackWriter.ts` | 全新 | 独立 hike-track 落盘服务：`append(point)` + `flush()` + `renameToCompleted(sid)` + `readTail(sid)` | 低（独立模块） |
| 2 | `app/src/store/useTrackingStore.ts` | `startTracking` 约 line 240-243 | `persistBackgroundContext` 传入 hardcoded `true`，语义从 debug 开关改为 "hike active"；启动 hikeTrackWriter；start L2 SLC watcher | 中（改现有 startTracking 时序） |
| 3 | `app/src/store/useTrackingStore.ts` | `addTrackPoint` 约 line 946-1077 | 每次 addTrackPoint 也 call `hikeTrackWriter.append(point)` | 低（一行 side-effect） |
| 4 | `app/src/store/useTrackingStore.ts` | `stopTracking` 约 line 604-858 | 增加 `hikeTrackWriter.renameToCompleted(sid)`；stop L2 SLC watcher；`persistBackgroundContext(null, false)` 清 gate | 中 |
| 5 | `app/src/services/backgroundLocationTask.ts` | `STORAGE_KEY_ENABLED` 语义 line 27 | 重命名为 `STORAGE_KEY_HIKE_ACTIVE`；Path B gate 保持不变（值语义换了） | 中（迁移 key，冷启加一次读旧 key 兼容） |
| 6 | `app/src/services/backgroundLocationTask.ts` | Path B line 74-108 | `appendDirectlyToSessionFile` 改写：直接 append 到 `cairn-hike-tracks/active/{sid}.jsonl`（不复用 debugLogger 目录） | 中 |
| 7 | `app/src/services/offlineQueue.ts` | line 148-152 backoff | 改 `attempts^2 * 5s` → `min(2^attempts * 5s, 30min)` | 低 |
| 8 | `app/src/services/offlineQueue.ts` | `enqueue` + `drain` | Payload > 512 KB 时切分 chunk；每 chunk 独立 opId | 中 |
| 9 | `app/src/services/sessionService.ts` | `remoteAppendPoints` line 106-129 | Body 加 `client_op_id` field | 低 |
| 10 | `app/src/store/useAppStore.ts` | `hydrate` line 271-296 | 检测 `cairn-hike-tracks/active/` 目录有文件 → 读 meta.json → 若 `age < 24h`，set `pendingSessionResume` 附带 disk tail path | 中 |
| 11 | **新增** `app/src/features/tracking/components/ResumeHikeBanner.tsx` | 全新 | 冷启 replay UI：读 disk tail → 显示 "Continue your hike? (N points recovered)" → 用户点 Continue 触发 replay，Discard 触发磁盘删 | 低（新组件） |
| 12 | `app/src/screens/HikingScreen.tsx` | Home 挂载点 | 显示 ResumeHikeBanner（不是当前的 UnfinishedSessionBanner 那种"只有 detect 无 replay"逻辑 [D §5]） | 低 |
| 13 | **新增** `app/src/services/slcWatcher.ts` | 全新 | 封装 SLC register / unregister + gap segment 检测；写入独立 `cairn-hike-tracks/active/{sid}.slc.jsonl` | 高（依赖 spike 结果） |
| 14 | **新增** `app/src/services/hikeTracksCache.ts` | 全新 | `enforceSizeCap()` + `clearUploaded()` + `clearAll()` for L2/L4 | 低 |
| 15 | `app/src/screens/SettingsScreen.tsx` | Debug section | 加两个 button：Clear uploaded / Clear all | 低 |
| 16 | `app/src/services/telemetryUploader.ts` | 现有 chunk 逻辑 | 从 `offlineQueue` chunk 逻辑复用，不各自实现 | 低（重构） |

**Risk 汇总**：
- **高**：#13 SLC —— 依赖 spike 结论。若 expo-location 不直接支持，可能要 patch 或推迟到 v410
- **中**：#2 #4 #5 #6 #8 #10 —— 都是 startTracking / stopTracking 关键路径修改
- **低**：其余

---

## 8. Playwright 测试计划

Cairn web 已可跑 Playwright（用户 memory feedback_web_playwright_before_iphone）。每项 verify：

| # | 场景 | Web 模拟方法 | 断言 |
|---|---|---|---|
| 1 | 正常 hike 落盘 | mock GPS callback 每 3s 触发 30 次 → check `expo-file-system` mock 里 `cairn-hike-tracks/active/{sid}.jsonl` 行数 = 30 | 磁盘行数 = 内存 trackPoints 长度 |
| 2 | JS crash 后 replay | 触发 store reset → 重新 mount App → hydrate 完成后 pendingSessionResume 非 null，点 Continue → offlineQueue 里出现 append-points op | replay 触发 enqueue |
| 3 | Offline 60s flush 失败 | mock `authenticatedFetch` returns 500 → wait 60s → check offlineQueue AsyncStorage key | 队列长度 = 1 |
| 4 | Backoff 曲线 | mock 5 次连续 500 → check `op.attempts` 和 `op.lastTriedAt` | 每次间隔 ≈ 2^n * 5s |
| 5 | Chunk upload | mock 一个 1MB body 的 op → drain → check fetch 被调用 2 次（512KB 切分） | 两次 POST，opId 不同 |
| 6 | Size cap 触发 | mock `getInfoAsync` 返回 200MB → 触发 `enforceSizeCap` → check 最老 completed 文件被删 | 删除的是 `uploaded=true` 文件，不是 unfinished |
| 7 | 无 GPS gap segment | mock SLC callback → JSONL 里出现 `conf=0.5` 行 → Activity Detail 页显示灰色断线 | UI 有 gap 标签 |
| 8 | debugMode 完全独立 | debugMode=off → 触发 hike → check `cairn-logs/` 目录空，`cairn-hike-tracks/` 目录有数据 | 两条路径完全解耦 |
| 9 | 冷启无 active session | AsyncStorage 无 `cairn_bg_active_session_id` → hydrate → pendingSessionResume=null，ResumeBanner 不 mount | 无副作用 |
| 10 | Cache clear button | Settings 点 "Clear uploaded" → mock 5 sessions（3 uploaded / 2 not）→ check 剩 2 个 unfinished | L4 手动清理正确 |

**web 不能验证的**（推 iPhone gate）：
- L2 SLC 实机 relaunch 行为（Playwright web 无 CoreLocation）
- iOS jetsam 后 TaskManager Path B 真实触发
- 长时间 (>2h) 后台 GPS 电池 & jetsam 存活率
- WAL / fsync 时序（若未来迁 SQLite）

---

## 9. 未知 vs 已确认

**已确认**（有代码或 doc 证据）：
- Cairn 现状：continuous updates + TaskManager Path A/B，两 Path 都 gate 在 debugMode [D §4]
- 194 session 后 56 分钟 zero 数据的根因：debugMode=off 导致 Path B 不写盘 [D §5]
- iOS force-quit / jetsam 后 continuous updates 死，非 SLC/geofence 不 relaunch [A §1a-c, Expo PR #34436]
- `offlineQueue` 已存在，缺 exp backoff + chunk [B §5]
- 三条上传通道独立 [D §3, DBT Q5]

**仍有未知需真机验证**（Sprint 前必做 spike，见 §10）：
- **Spike-1**：SLC 500m/5min 阈值和 reboot 后存活 [A §2a §2b 标注"证据强度=中"]
- **Spike-2**：expo-location 是否直接暴露 SLC API 或需要 patch [A §3d]
- **Spike-3**：iOS jetsam 后 TaskManager Path B 是否真的能重新 fire [A §3c 推理路径]
- **Spike-4**：`cairn-hike-tracks/active/{sid}.jsonl` 冷启后能否 100% 读到 kill 前最后 1 行（appendDirectly 的 fsync 时序）

---

## 10. Sprint 前 3 个必做 Spike（debate 硬要求 [DBT §"最终批判总结"]）

| Spike | 目标 | 通过标准 | 时限 |
|---|---|---|---|
| **Spike-1 SLC 实机** | 真 iPhone 装 SLC-only 版本，走 500m 观察 relaunch | force-quit 后走 500m，App 后台被 iOS 拉起并写 JSONL 1 行 | 1 天 |
| **Spike-2 append 存活率** | Write 100 pts → force-kill → 冷启读文件 | 至少 99 行完整可 parse（末行 malformed 允许 skip） | 半天 |
| **Spike-3 expo-sqlite bundle 检查**（备胎） | Grep app.json plugins + 试 import expo-sqlite | 不需重 EAS build 即可运行 | 半天 |

Spike-1 若 fail → SLC 方案降级：只做 L1 + L3 last-fix，不承诺 gap segment 挽回。
Spike-2 若 fail → 改用 write-then-fsync（每次 append 后 close+reopen 保证 fsync）。

---

## 11. Sprint 分解（供 PM 参考，不算设计）

| Sprint | 内容 |
|---|---|
| **v409** (this) | #1 #2 #3 #4 #5 #6 #7 #9 #10 #11 #12 #14 #15 —— 核心 hike-track 落盘 + replay + backoff 修 + L2/L4 缓存 |
| **v410** | Spike-1/2 通过后 #13 SLC + gap segment；Spike 未过则跳过 |
| **v411+** | expo-sqlite 迁移（Spike-3 通过后）|

---

## AskUserQuestion 建议清单

1. **产品承诺文案确认**：v409 "kill 后重开可恢复到最后一次落盘点 + gap 段用 SLC 粗点标记" —— 你是否接受这个措辞作为 Story AC？（不能承诺"零丢"）
2. **SLC 优先级**：Spike-1 若 fail（expo-location 不支持 SLC 且 native patch 复杂），v409 是否接受"只做磁盘 replay 不做 SLC 兜底"作为交付？还是延到 v410 一起做？
3. **150MB 缓存 cap 是否合理**：这是重度用户（>300h hike）会先撞到的天花板。是否要提高到 300MB / 无 cap 只留 L4 手动？
4. **client_op_id 落地时机**：backend 现有 `idempotency_keys` 表支持 opId 概念但 `/append-points` endpoint 未启用。是否 v409 就同步改 backend endpoint 加 dedupe 逻辑，还是 client 先送、backend 忽略、下个 sprint 补？
5. **debugMode key 迁移策略**：`STORAGE_KEY_ENABLED` 重命名为 `STORAGE_KEY_HIKE_ACTIVE` 需要处理老用户 AsyncStorage 里已有 `cairn_bg_logging_enabled='1'` 的情况。是否接受一次冷启 migration（读旧 key，若 '1' 且当前无 active session → 清除）？

---

## 附录：材料引用清单

- `docs/audit-v404/v409-research-A-ios-corelocation.md` — iOS CoreLocation lifecycle
- `docs/audit-v404/v409-research-B-storage.md` — 本地存储对比
- `docs/audit-v404/v409-research-C-competitors.md` — 竞品调研（多数不可达）
- `docs/audit-v404/v409-research-D-current-state.md` — Cairn 现状 + 194 session 数据流
- `docs/audit-v404/v409-debate.md` — A/B/C/D 批判性对账
- `app/src/store/useTrackingStore.ts:204-858` — startTracking / stopTracking
- `app/src/services/backgroundLocationTask.ts:26-180` — TaskManager Path A/B
- `app/src/services/offlineQueue.ts:36-233` — 现有 queue 结构
- `app/src/store/useAppStore.ts:271-296` — hydrate 里 unfinished session detect
