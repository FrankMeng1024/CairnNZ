# v409 Research D — 现有代码 audit: GPS 记录链路 · 本地存储 · offline retry · debugMode gate · 194 session 数据流

**日期**: 2026-07-06 (v404 OTA 后)
**范围**: 只读 audit,不改代码。回答 v409 修复必须从哪里下手的四个问题。
**方法**: 全 repo Read/Grep + SSH aliyun MySQL 交叉验证。
**关键引用**: 全部 file:line。

---

## 1. 现有 GPS 记录完整时序 (Start Hike → Server)

```
用户按 Start Hike
   │
   ▼
useTrackingStore.startTracking()          [useTrackingStore.ts:204]
   │
   ├── set({ status:'requesting', sessionId:generateId() })          [line 206-211]
   │
   ├── startSession(mode, iso)             fire-and-forget          [line 225]
   │     └── POST /api/sessions/start → 拿 remoteSessionId          [sessionService.ts:83-98]
   │         失败 → remoteSessionId=null,永远走不了增量 flush 路径
   │
   ├── debugLogger.startSession()          返回本地 dbgSessionId    [line 239]
   │     └── debugLogger 内部只有 enabled=true 才真写 buffer       [debugLogger.ts:266-267]
   │
   ├── persistBackgroundContext(dbgSid, debugLogger.isEnabled())    [line 243]
   │     └── AsyncStorage:
   │         - cairn_bg_active_session_id = dbgSid                  [backgroundLocationTask.ts:40]
   │         - cairn_bg_logging_enabled = '1' or '0'                [line 44]
   │
   ├── registerBackgroundTask()   若 bg permission granted          [line 314]
   │     └── TaskManager.defineTask(cairn-background-location, ...)
   │
   ├── activateForegroundSource() 立即启动 foreground watcher       [line 326 or 942]
   │     └── Location.watchPositionAsync({ Best, 3000ms, 5m })
   │         callback:
   │           debugLogger.log({event:'gps_fix', ...})   [1199-1211] gate: enabled+sessionId
   │           useTrackingStore.getState().addTrackPoint(coord, ts) [1212-1221]
   │
   ├── AppState listener 单源守恒                                    [line 342]
   │     ├── active  → activateForegroundSource + deactivateBackgroundSource
   │     └── background/inactive → deactivateForegroundSource + activateBackgroundSource
   │
   ├── drainInterval = setInterval(1s)                              [line 429]
   │     └── drainBackgroundLocations() → addTrackPoint             [backgroundLocationTask.ts:64]
   │
   ├── dynamicSamplingInterval = setInterval(10s)                   [line 451]
   │     └── 重新算 sampling 频率 + 必要时重启 source
   │
   ├── incrementalFlushInterval = setInterval(FG_MS=120_000 / BG_MS=300_000)  [line 512-533]
   │     └── remoteAppendPoints(remoteId, trackPoints.slice(lastFlushedIdx))
   │         成功 → lastFlushedIdx = total
   │         失败 → offlineQueue.enqueue(session_append)             [sessionService.ts:123]
   │
   └── tokenRefreshInterval = setInterval(30min)                    [line 561]
```

### GPS fix 落地路径 (per point)

- **Foreground active**: `Location.watchPositionAsync` callback → `useTrackingStore.addTrackPoint()` → in-memory `trackPoints[]` / `trackPointsSmoothed[]` / `trackPointsRaw[]` (Zustand state)   [useTrackingStore.ts:946-1077]
- **Background active (app in bg,JS 还活)**: `TaskManager` handler → `pendingBackgroundLocations.push()` → 1s drainInterval → `addTrackPoint()`   [backgroundLocationTask.ts:117-149]
- **Background active (app 被 iOS kill,JS 死)**:
  - Path A: `debugLogger.isEnabled() && getCurrentSessionId()` → `debugLogger.log()`  [line 154-160] — **只有 debugMode 开才写**
  - Path B: `STORAGE_KEY_ENABLED === '1'` → `appendDirectlyToSessionFile()` 写 `cairn-logs/sessions/{sid}.jsonl`  [line 163-171] — **也 gate 在 debugMode**
  - **debugMode 关的情况下 Path A 和 Path B 都跳过,GPS 只在 `pendingBackgroundLocations` 内存队列里**  — 但 JS 已死,没人 drain,队列在下次 process 冷启动时清零 (module-level `const`)

### 增量 flush → server 路径

- FG 每 120s / BG 每 300s: `remoteAppendPoints(remoteId, slice)` → `PATCH /api/sessions/{id}/append-points`  [useTrackingStore.ts:522]
- 成功 → `lastFlushedIdx = total`
- 失败 (network / 5xx / 401): `enqueue(makeOp('session_append', ..., opId))` 到 offlineQueue [sessionService.ts:123]
- **4xx (except 401) 直接 return false,不 enqueue** — 这是 loss vector 之一 (但 append-points 应该不会返回 400)

### stopTracking → server finalize 路径

- Preflight too-short guard (trackPoints<2 OR distanceM<20) → delete remote session   [useTrackingStore.ts:604-631]
- Final-flush tail 增量 append 一次 fire-and-forget   [line 738-747]
- snapTrack 同步等 Mapbox map-matching   [line 782-807]
- pushMemoryNow() 同步等 → memory_points POST   [line 822]
- finalizeSession fire-and-forget → `PATCH /api/sessions/{id}` 带 name / distance / duration / route_points (snapped) / route_points_raw   [line 834-858]
- 本地: `useSessionStore.addSession()` → AsyncStorage `cairn_sessions_<userId>` + `cairn_trackpoints_<userId>_<id>`   [useSessionStore.ts:73-140]

### JS 死了这条链哪里断,native 还在跑什么

| 组件 | JS 死后状态 |
|---|---|
| `Location.watchPositionAsync` foreground callback | 死 (JS callback 不再触发) |
| `TaskManager.defineTask` background handler | native 层 iOS TaskManager 会重新拉起 JS worker,任务 handler 重新注册 (App.tsx top-level import) |
| `pendingBackgroundLocations` in-memory 队列 | **JS 死 → 整个 module state 清零,队列清空** |
| `drainInterval` (1s) | 死 |
| `incrementalFlushInterval` (120s) | 死 |
| `remoteSessionId` / `trackPoints[]` Zustand state | **全部清零 (Zustand 是纯 in-memory)** |
| `debugLogger.currentSessionId` | 清零 (module-level) |
| **AsyncStorage `cairn_bg_active_session_id`** | 存在 — hydrate 时可读 |
| **AsyncStorage `cairn_bg_logging_enabled`** | 存在 |
| **磁盘 `cairn-logs/sessions/{sid}.jsonl`** | 存在 — 但**只有 debugMode='1' 时才写过任何 gps_fix** |
| **AsyncStorage `cairn_sessions_<uid>` (完成session summary)** | 存在,但不含本次未完成的 session |
| **AsyncStorage `cairn_trackpoints_<uid>_<sid>` (完成session tp)** | 存在,但**只在 addSession 里写** — stopTracking 前不写 |
| Server `sessions` 行 | 存在 (start 时创建),但 route_points 只到最后一次成功 flush 为止 |

**结论**: JS 死时唯一还能写数据的路径是 background TaskManager 的 Path B (直接 append jsonl),但**它 gate 在 debugMode**。debugMode 默认关。**所以对普通用户,JS 死了 = 数据永久丢失**。

---

## 2. 现有本地存储盘点

### AsyncStorage keys

| Key | Owner | Purpose | GPS 相关? |
|---|---|---|---|
| `cairn_bg_active_session_id` | backgroundLocationTask.ts:26 | 后台任务能读到当前 dbg session_id | ✓ 间接 (crash-recover 才用) |
| `cairn_bg_logging_enabled` | backgroundLocationTask.ts:27 | Path B gate | ✓ 决定 JS 死时磁盘 append 开关 |
| `cairn_sessions_<userId>` | useSessionStore.ts:54 | 完成 session summary (无 tp) | ✓ 完成后才写 |
| `cairn_trackpoints_<userId>_<sessionId>` | useSessionStore.ts:55-56 | 完成 session 的 trackPoints | ✓ 完成后才写 |
| `cairn_markers_v026_<userId>` | useMarkerStore.ts:85 | AR markers | ✗ |
| `cairn_ar_origin_v1_<userId>` | useMarkerStore.ts:96 | AR anchor | ✗ |
| `cairn_ar_schema_version_<userId>` | a8Migration.ts:36, useArOriginStore.ts:54 | schema migration | ✗ |
| `cairn_ar_migration_ts_<userId>` | a8Migration.ts:37 | migration 时间戳 | ✗ |
| `cairn_ui_mode` | useAppStore.ts:31 | UI mode toggle | ✗ |
| `cairn_logout_marker` | useAppStore.ts:35 | logout 状态 | ✗ |
| `cairn_last_fix_v1` | features/memory/services/lastFixCache.ts:30 | 最近一个 GPS fix cache | ✓ 只 1 个点 |
| `cairn_memory_hydrate_failed_v1` | features/memory/lib/memoryHydrateGate.ts:35 | hydrate gate | ✗ |
| `cairn_h3_load_failed_v1` | features/memory/lib/h3LoadGate.ts:21 | h3 gate | ✗ |
| `cairn_friends` / `cairn_friend_markers` | useFriendStore.ts:74-75 | 好友 | ✗ |
| `cairn_boot_checkpoint_v1` / `_previous_v1` | bootDiagnostics.ts:45-46 | 冷启 phase 诊断 | ✗ |
| `@cairn:feature_flags:v1` | config/featureFlags.ts:19 | feature flags | ✗ |
| `@cairn:offline_queue:v1` | services/offlineQueue.ts:36 | offline retry queue | ✓ **只在 append-points/finalize/marker create 失败时写** |
| `cairn_memory_points_<userId>` (via memoryPersistence.ts:168) | memory 存储 | ✓ 完成 hike 后 recordPoint → 本地缓存 |
| `cairn_h3_visited_<userId>` (via h3Persistence.ts) | H3 fog 存储 | ✓ 完成 hike 后 bulkImportSync |
| `@cairn:auth:token` (via tokenStore) | Auth token | ✗ |

### 文件系统

`{FileSystem.documentDirectory}/cairn-logs/sessions/{sanitized_sid}.jsonl`
- Owner: debugLogger.ts:47 + backgroundLocationTask.ts:84
- 内容: 每行一个 LogEvent (gps_fix / error / battery / network ...) — JSONL
- **写入触发**: (a) `debugLogger.log()` 缓冲满 100 events 或 30s 定时,且 enabled=true (b) Path B backgroundLocationTask 直接 append,且 STORAGE_KEY_ENABLED='1'
- **本次 (v404) 现状**: 用户默认 `debugMode: false` → **文件基本不存在或空**
- Rotation: 保留最近 10 个 session (debugLogger.ts:46 MAX_SESSIONS_KEPT)
- Size cap: 单 session 50MB (debugLogger.ts:361-364)

`{documentDirectory}/cairn-logs/meta/{sid}.json`
- Owner: debugLogger.ts:48
- 内容: SessionMetadata (started_at / ended_at / events_count / device_info / uploaded / upload_attempts)
- 写入触发: `endSession()` + `persistMetaForKillSafety` (AppState=background 时)

### Zustand stores → 磁盘映射

| Store | AsyncStorage key | 何时写盘 |
|---|---|---|
| useSessionStore.sessions[] | `cairn_sessions_<uid>` | 每次 addSession (stopTracking end) |
| useSessionStore trackPoints per session | `cairn_trackpoints_<uid>_<sid>` | 每次 addSession (stopTracking end) |
| **useTrackingStore (live)** | **无 — 纯 in-memory** | **从不写盘 (v409 修复目标)** |
| useMemoryStore (points, revealed cells) | `cairn_memory_points_<uid>` | recordPoint 内部有 debounced flush 到 disk |
| useH3VisitedStore (cells set) | `cairn_h3_visited_<uid>` | bulkImportSync 后 debounced flush |

**关键漏洞**: **live tracking 期间的 trackPoints[] 从不写盘**。只有 stopTracking 时才 addSession 写入 `cairn_trackpoints_<uid>_<sid>`。中途 JS 死 = trackPoints[] 清零。

### 1h hike 磁盘占用估算

假设 hiking:
- 采样 3s/fix (前台) → 60min × 20 fix/min = 1200 fix
- 后台可能降级到 5-10s/fix → 保守 1200 fix

每 fix 存 3 处 (raw / smoothed / rawAudit) TrackPoint (lat+lng+alt+t+accuracy+speed) ≈ 80 bytes JSON。

**In-memory (Zustand)**: 1200 × 3 × 80 bytes = **288 KB** (不落盘)。

**如果 debugMode=on 且 jsonl append every fix**:
- `gps_fix` event ≈ 240 bytes JSON per line × 1200 = **288 KB** per session

**offlineQueue (最坏)**: 若每次 120s flush 都失败,1 hour = 30 次 = 30 个 op,每个 op body ≈ (120s/3s=40 pts × 80B) = 3.2 KB → **96 KB total**

**总磁盘占用 (v404 现状,debugMode 关)**: 基本 0 (offlineQueue 只在失败时才有内容; live trackPoints 从不落盘; jsonl 空)

**v409 修复后目标 (每 60s 落盘 tail)**: 约 500 KB - 1 MB / 1h hike (可接受)。

---

## 3. 现有 offline retry 逻辑

### memorySync.ts

- `pushPendingPoints()` 内部 debounced 5s (PUSH_DEBOUNCE_MS)   [memorySync.ts:23]
- 失败 backoff 15s (BACKOFF_MS)   [memorySync.ts:24]
- Batch size 500   [MAX_BATCH]
- 无 offlineQueue,只是内存重试。**若 app 被 kill,pending points 保留在 useMemoryStore.points (synced=false),下次冷启 attachMemorySync 会重试**
- 只批推 500,余下 schedulePush(0) 递归

### apiService.ts 401 处理

Sprint 72 铁律   [apiService.ts:52-101]:
1. Network error (fetch throws) → 从不 touch token
2. 401 无 `X-Cairn-Auth-Invalid: true` header → 保留 token,只 breadcrumb,return 401 给 caller
3. 401 + hard invalid header + tracking active → 仅 mark `pendingReauth`, 不 logout
4. 401 + hard invalid + not tracking → clearToken + logout

**对 GPS 链路的影响**: hiking 中 401 → 保留 token → append-points caller 拿到 401 → sessionService.ts:120 判 `!== 401` 才 enqueue → **401 直接 return false 不 enqueue** [sessionService.ts:122]。也就是说,401 场景下这批 20 个点丢失,除非下一次 flush 里 lastFlushedIdx 没变,同样的 slice 会再试。 **但注意 sessionService.ts:122 逻辑: `res.status >= 400 && res.status < 500 && res.status !== 401`** — 401 走 enqueue 分支。所以 401 是 retry 的。

### remoteAppendPoints 失败会怎样

sessionService.ts:106-129:
```
res.ok           → return true
res.status 400   → return false, 不 enqueue     (bad payload assumption)
res.status 401   → enqueue (opId 幂等), return false
res.status 5xx   → enqueue, return false
fetch throws     → enqueue, return false
```

上层 useTrackingStore.ts:522-528: `ok=false → lastFlushedIdx 不变`。下次 120s 再重试同一 slice + 增量新点。**幂等 opId 靠 client_op_id + idempotency_keys 表 (server 侧)**。

### 有没有 offline queue?现状是否"网挂就丢"?

**有 offlineQueue** [services/offlineQueue.ts]:
- 存 AsyncStorage `@cairn:offline_queue:v1`
- Drain 触发: (a) networkMonitor state='online' 事件, (b) AppState → 'active'
- Backoff: `attempts^2 * 5s`,最长 5 min
- MAX_ATTEMPTS=8,超过 drop
- Re-entrancy guard: `draining` flag

**没丢**:
- 网挂 → fetch throws → enqueue → 网回来后 drain
- 5xx → enqueue → backoff → 下次 drain

**会丢的场景**:
- **JS 死 (iOS jetsam kill)**:内存 `trackPoints[]` 清零 → 队列里就算有旧 slice 的 op,新的没入队的点 (在下次 flush 之前的 30-119s 累积) 也随内存一起没
- **8 次 retry 都失败**: crashLogger.breadcrumb "offlineQueue:exhausted" 后 drop [offlineQueue.ts:187]
- **flushInterval 从没触发一次**: 用户 hike 4 分钟内就死,append-points 从没跑过,offlineQueue 里根本没这批点 (**这就是 194 session 的情形**)

**换句话说,offlineQueue 保护的是"已经进入 remoteAppendPoints() 的批"。它不保护"还在 trackPoints[] 但没到 flush 时机的点"。**

---

## 4. debugMode gate 但实际是 hike 数据链路的位置

**核心问题**: hike 数据链路 (GPS→disk→server) 被 diagnostic gate `debugMode` 绊住,而 debugMode 默认关。

| # | 位置 | 现在的 gate | 数据链影响 | v409 是否要解开 |
|---|---|---|---|---|
| 1 | `backgroundLocationTask.ts:154` Path A | `debugLogger.isEnabled() && getCurrentSessionId()` | **JS 活但用 log() 路径需要 debug**; 若关,gps_fix 事件不入 buffer | **是** — 或者说完全另建一条 hike-only 落盘路径 (不复用 debugLogger) |
| 2 | `backgroundLocationTask.ts:166` Path B | `STORAGE_KEY_ENABLED === '1'` | **JS 死时的 jsonl 直接落盘 = 完全被关掉** | **是,关键 gate** — 或者建 hike-only 落盘,不复用 STORAGE_KEY_ENABLED |
| 3 | `debugLogger.log()` line 266-267 | `!this.enabled \|\| !this.currentSessionId` return | 每个 gps_fix event 从 useTrackingStore foreground path 也走 debugLogger (line 1199) — 若关就丢 debug 事件 (但 hike trackPoints Zustand path 不受影响) | 视方案 — 若 v409 用 debugLogger 复用,要打开;若另建一路径就不用 |
| 4 | `debugLogger.persistMetaForKillSafety` line 161-172 | 依赖 sessionMeta 是否初始化;若 `enabled=false`,startSession 之后 sessionMeta 存在,但 buffer 空 → meta 写盘但没 events → telemetryUploader 找到 session 但只 upload 空文件 | 部分作用: `unfinished_session` banner 能识别,但没数据可 upload | 部分保留 |
| 5 | `useTrackingStore.ts:243` persistBackgroundContext | 参数是 `debugLogger.isEnabled()` — 若关,`cairn_bg_logging_enabled='0'` | Path B gate 传递 | **是** — 必须让 hike 期间 STORAGE_KEY_ENABLED 一直 '1' |
| 6 | `telemetryUploader.upload()` (stopTracking line 687) | 只调用一次,靠 dbgSid,若 disabled 时 file 空则啥也上传不了 | 无关键影响 | 无 |

### 二次 gate: hike 数据额外没做的事

即使 gate 全解开,现代码**根本没有"live trackPoints 定期落盘"路径**。debugLogger 存的是 gps_fix events 而不是 useTrackingStore.trackPoints[] 数组本身。区别:
- gps_fix events: 每个 fix 一行 JSON,是 raw 数据 (未过 gate 1-4 teleport / accuracy / stationary / kalman)
- trackPoints[]: 已过 4 层 gate 的 clean stream

如果要"JS 死时用磁盘 events 恢复 hike",需要在冷启动 hydrate 时读 jsonl → 反推 trackPoints → 重放 addTrackPoint (走 gate) 或直接跳过 gate 用 raw events 补齐。**这段代码目前不存在**。

### v409 修复必须解开/新建的 gate 清单

**A. 解开现有 gate (最小改动)**:
- `useTrackingStore.ts:243`: `persistBackgroundContext(dbgSessionId, true)` (hike 中恒为 true,不 depend 于 debugMode)
- 相应地把 `STORAGE_KEY_ENABLED` 语义从"用户 debug 开关"改成"当前 tracking 是否 active"。stopTracking 时 setItem '0'。
- `backgroundLocationTask.ts:166`: gate 保留 (STORAGE_KEY_ENABLED='1' = "有活的 hike")
- **副作用**: 每个用户每次 hike 都会产生 jsonl 磁盘写入,不再是 opt-in

**B. 新建独立 hike-data 落盘路径 (推荐)**:
- 在 useTrackingStore 新建 `hikeTrackPersistFile` 服务:
  - 每 60s (或每 N 个 addTrackPoint) 把 trackPoints tail append 到 `cairn-logs/hike-tracks/{sessionId}.jsonl`
  - 完成 stopTracking 后 rename 或删除
  - 冷启动 hydrate 时: 若 `cairn_bg_active_session_id` 存在,读对应 hike-tracks 文件 → 走"resume session"UI → 用户点确认后:merge 磁盘 tail + 触发 finalize
- 独立于 debugLogger,不 gate 在 debugMode
- 独立于 offlineQueue (offlineQueue 是网络 retry,这是本地耐久)

**C. 修 194-style 场景需要的其他改动**:
- iOS `expo-task-manager` background 任务里,即使 JS 冷启,handler 拿到 fix 后必须写盘 (Path B),不能依赖 debugMode
- 冷启动 App.tsx 主 import 里立即注册 taskManager (已做,`registerBackgroundTask` 在 startTracking 里做,但要提到 App.tsx module top-level,与 iOS TaskManager 要求一致 — 需要 confirm)
- pendingSessionResume banner 需要能触发一个"从磁盘 replay 未 flush 的 trackPoints 到 server"的动作 (现在有 detect 但没 replay 逻辑)

---

## 5. Backup 数据是否已被写到某处但没上传?

### grep "trackPointsRaw" 使用点

```
useSessionStore.ts:41,45,118,119     完成 session 时写入 addSession + POST body
useSessionStore.ts:118-120           legacy POST 时随 body 一起发
useTrackingStore.ts:140              类型定义
useTrackingStore.ts:188              initialState 空数组
useTrackingStore.ts:852              stopTracking finalize PATCH 时 route_points_raw = s.trackPointsRaw
useTrackingStore.ts:877-879          addSession 时,若 snap 成功则 trackPointsRaw=trackPoints 原始
useTrackingStore.ts:990,1000,1005,1024,1067   addTrackPoint 时始终 push (无论过 gate 与否,除 teleport)
```

**trackPointsRaw 存在哪里**:
- 仅 in-memory (useTrackingStore Zustand state, useSessionStore Zustand state)
- stopTracking end 时写入 `cairn_trackpoints_<uid>_<sid>` AsyncStorage (通过 addSession → useSessionStore.addSession 只写 trackPoints 不写 raw — **注意 useSessionStore.ts:82-87 只 setItem trackPoints,raw 存在于 sessions[] array 里,summary 里被 strip 掉 (`const summaries = next.map(({ trackPoints: _, ...rest }) => rest)`)** — 意思是 raw 存在于 `cairn_sessions_<uid>` summary 的 `trackPointsRaw` 字段里!)
- 上传到 server 的 `sessions.route_points_raw` 列 (finalize PATCH 时)

### 有没有现有 flush 逻辑把 raw 落盘?

- **live 中: 没有。** 只在 stopTracking 完成后 addSession 一次性写盘
- 服务器只在 finalize 时收一次

### 用户昨天 session 194 的数据流分析

**证据 (aliyun MySQL)**:
- sessions.id=194: user_id=4, start_time=2026-07-06 09:23:32, end_time=同上 (从没被 finalize update), distance_m=0, duration_s=0, route_points 有 21 个点 (最后一个 t=1783330052598 = 2026-07-06 09:27:32.598 UTC), route_points_raw=NULL
- idempotency_keys: 单条 op_id=bfa6234d-... op_kind=append-points user_id=4 status_code=200 response `{"ok":true,"appended":21}` created_at=2026-07-06 09:28:34
- app_logs: user_id=4 在 09:00-11:00 UTC 窗口 **0 条**
- telemetry_sessions: 最新一条 crash session 停在 2026-06-24 (v404 时 debugMode 关,telemetryUploader 从没上传新东西)
- memory_points: user_id=4 最新 ts=2026-07-06 04:17:04 (即前一次 sesssion 192/191 结束时),之后 **0 条**

**时序推断 (UTC)**:
- 09:23:32 startTracking → POST /api/sessions/start → sessions row 194 创建 (remoteSessionId=194,dbg session 起来,persistBackgroundContext 传入 enabled=false)
- 09:23:32 ~ 09:27:32 前 4 分钟 foreground 或 background,采集 21 点入 trackPoints[]
- 09:25:32 第一次 flush 触发?但 idempotency_keys 只记录 1 次 200 append,时间在 09:28:34。可能:
  - (a) 首次 flush 因 network 慢或 pending POST /api/sessions/start 未回而 remoteSessionId 还是 null,skip
  - (b) 首次 flush 在 09:25:32,batch 12 点,失败,offlineQueue 里
  - (c) 首次 flush 直接跑到 09:27:32 tick,batch 21 点,请求发出 (队 ~1min),09:28:34 server 记录 dedup key
- **09:28:34 之后再没 append-points**  ← 关键
- 用户报告 "又走了 56 分钟" → 假设 ~10:24 才停 hike
- 09:28:34 到 10:24 中间 **应该** 有 ~27 次 120s flush tick,idempotency_keys 应该有 ~27 条,实际 **0 条**
- 说明: **JS 或 flushInterval 已经死掉** (不是网络失败,失败会有 idempotency 记录且 op enqueue)

**根因假设**:
1. iOS jetsam kill: 用户切到别的 app / 锁屏,iOS 内存压力回收 Cairn 进程,JS 死。同时:
   - `expo-task-manager` 的 background handler 理论上还会被拉起,但 Path A 需要 `debugLogger.currentSessionId` (新进程里 null) → 走 Path B → 读 `STORAGE_KEY_ENABLED`,值是 '0' (因为用户 debugMode 关) → **return,不写盘**
   - `pendingBackgroundLocations` 队列: 新进程 fresh module,空
   - Foreground fix 也没了 (无 JS)
   - 内存 trackPoints[] 清零
2. App 前台但 JS deadlock / silent throw: 相对少见 (会有 crash breadcrumb),排除
3. 网络挂 1 小时: 若如此,offlineQueue 应有多条 pending op,idempotency_keys 也不会有额外记录,但 trackPoints[] 应该还在内存,用户回来点 Stop 后应能 finalize+flush → sessions.end_time 应被 update — **实际 end_time 仍等于 start_time,duration=0 → 说明用户根本没点 Stop 或点 Stop 时 stopTracking 逻辑没到 finalizeSession** → 反过来印证 JS 已死
4. 用户仍在 hiking,现在还没停:检查 currentTime,若 2026-07-06 09:23 已经过了很久且用户没抱怨还在 hike,基本排除

**磁盘留痕迹**:
- `cairn-logs/sessions/{dbgSid}.jsonl`: **空或不存在** (debugMode 关,Path A/B 都不写)
- `cairn-logs/meta/{dbgSid}.json`: 若 AppState background 触发过 `persistMetaForKillSafety`,可能有一个 meta 文件但 events_count=0,ended_at=null
- `AsyncStorage: cairn_bg_active_session_id`: **有** dbgSid (未被 stopTracking 清)
- `AsyncStorage: cairn_bg_logging_enabled`: '0'
- `AsyncStorage: cairn_sessions_4`: 不含 session-194 对应本地 UUID (因为 addSession 从没被调用)
- `AsyncStorage: cairn_trackpoints_4_<localid>`: 不存在
- `AsyncStorage: @cairn:offline_queue:v1`: 若 flush 曾失败过,可能有,但从 idempotency 记录看 09:28:34 那批是 200,应该 clean 后清了

**用户前 4 分钟 vs 后 56 分钟数据链差别**:

| 阶段 | 数据链 | 结果 |
|---|---|---|
| 前 4 min (09:23-09:27) | JS 活 → foreground callback → trackPoints[] → 120s flush → server sessions.route_points | **21 点落 server** |
| 后 56 min (09:28-10:24) | JS 死 → TaskManager Path B gate '0' → 磁盘不写 / 内存清零 / flushInterval 死 | **0 点落任何地方** |

用户在 v404 的现有代码里,后 56 分钟数据**从未存在过**。不是"存了但没上传",是"从没被记录"。

**唯一可能残留的痕迹**: 若 iOS TaskManager 在 JS 死之后仍成功拉起过 JS worker (即使 debugLogger 没 enabled),`pendingBackgroundLocations` 数组会存在于**那个短暂的新 JS worker 生命周期里**,但没有 drainInterval,数据在 worker 结束时随之消失。**磁盘绝对没有,server 绝对没有,AsyncStorage 绝对没有**。

---

## 总结: v409 修复必须做的事 (Research D 视角)

1. **建独立 hike-data 落盘路径,与 debugLogger 解耦**
   - 每 30-60s / 每 50 点 append trackPoints tail 到 `cairn-logs/hike-tracks/{sessionId}.jsonl`
   - 不 gate 在 debugMode,而 gate 在 useTrackingStore.status === 'tracking'/'paused'
   - stopTracking end 后 rename 到 `.done` 或直接删

2. **backgroundLocationTask.ts Path B 的 STORAGE_KEY_ENABLED 语义重定义**
   - 从"用户 debug 开关"改成"当前有活 hike"
   - useTrackingStore.startTracking 里 setItem '1',stopTracking 里 setItem '0'
   - 或另建 key `cairn_bg_hike_active`,不复用 debug 语义

3. **冷启动 replay 逻辑**
   - hydrate 里若 `cairn_bg_active_session_id` 存在 + 磁盘 hike-tracks 文件存在:
     - 弹 "Continue your hike?" banner (Sprint 72 STORY-551 已有 detect,但没 replay)
     - 用户点 Continue → 读磁盘 tail → PATCH /api/sessions/{remoteId}/append-points → finalize
     - 用户点 Discard → 磁盘文件删,server sessions row 保留原 21 点

4. **offlineQueue 应容纳"live tail"**
   - 现在 offlineQueue 只保护"已经决定要 push 但网络失败"的批
   - v409 可以让每 60s 落盘的同时也 enqueue 一份 (magazine 模式) 或直接扩展 offlineQueue 为"disk-backed live buffer"

5. **不需要改的**
   - Kalman gate / accuracy gate / stationary gate (这些是 clean track 的逻辑,与耐久无关)
   - snap-to-road (只在 stopTracking 完成后跑,与耐久无关)
   - memorySync (与 sessions/trackPoints 无关,memory_points 是另一条链)
   - apiService 401 iron rule (与耐久无关)

**修复优先级**:
- P0: 独立 hike-track 磁盘 append (点 1)
- P0: STORAGE_KEY_ENABLED 语义解耦或新 key (点 2)
- P0: 冷启动 replay (点 3)
- P1: offlineQueue 扩展 (点 4) — 可选,点 3 已能救大部分场景

---

## 引用清单

- `app/src/store/useTrackingStore.ts:204-890` — startTracking / stopTracking / addTrackPoint / activateForegroundSource
- `app/src/services/backgroundLocationTask.ts:26-180` — TaskManager handler + Path A/B + persistBackgroundContext
- `app/src/services/debugLogger.ts:47-583` — 磁盘 jsonl 写盘 + rotation + persistMetaForKillSafety
- `app/src/services/sessionService.ts:83-197` — startSession / appendPoints / finalizeSession / deleteRemoteSession
- `app/src/services/offlineQueue.ts:36-233` — offlineQueue 结构 + drain
- `app/src/services/memorySync.ts:322-475` — pushPendingPoints + attach/detach
- `app/src/services/apiService.ts:36-104` — 401 iron rule
- `app/src/store/useSessionStore.ts:73-208` — addSession + AsyncStorage 存储
- `app/src/store/useAppStore.ts:270-296` — hydrate 里 pendingSessionResume detect
- `app/src/features/memory/services/flushHikingToMemory.ts:97-146` — 只在 stopTracking end 跑
- aliyun MySQL: `cairn.sessions.id=194`, `cairn.idempotency_keys` (bfa6234d), `cairn.memory_points` (user_id=4, 最新 2026-07-06 04:17:04), `cairn.app_logs` (user_id=4 09:00-11:00 = 0 行), `cairn.telemetry_sessions` (最新 2026-06-24)
