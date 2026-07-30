# Cairn 三条数据链路诊断档案

**日期**: 2026-07-30  
**目的**: 建 `sessions` 表之前 100% 搞清楚 activity / memory / offline 三条链路当前 vs 期望的行为差距  
**范围**: 只写档案,不改代码  
**背景**:
- aliyun 生产库 `sessions` 表被 R9B7 auto-migration runner 误删（`server_start_migration_runner` boot 时跑 `004_auth_rebuild.sql`,legacy migrations 假设 fresh DB → 副作用把 sessions 删了。见 `MEMORY.md > feedback_migration_runner_dry_run`）
- backup 表 `_sessions_backup_o1_20260726` 有 21 条历史 activity 完整
- `memory_points` 表活着,2026-07-29 还在收新点
- 客户端 `pendingSyncStore` + `syncDaemon` 里现在积压所有 Save 失败的 activity

---

## 0. 三条链路一张图

```
                            ┌─────────────────────────────────────────────────┐
                            │  用户点 Stop → StopSummarySheet 填名字 → Save     │
                            └────────────────────────┬────────────────────────┘
                                                     │
                                       ┌─────────────┴─────────────┐
                                       │   useTrackingStore.        │
                                       │      stopTracking(name)    │
                                       └─────────────┬─────────────┘
                                                     │
                    ┌──────────────────────┬─────────┴─────────┬──────────────────────┐
                    │                      │                   │                      │
              (A) activity            (B) memory          (offlineQueue          (C) offline
              一次 hike 整体           N 个 GPS 点          append-points)         已 Save 未同步
                    │                      │                   │                      │
      PATCH /api/sessions/:id/save   POST /api/memory/points   PATCH .../append-points   FileSystem:
      → sessions 表 UPDATE           → memory_points INSERT    (增量,60-120s 一次,          {docDir}/cairn-pending-sync/
      + memory_points INSERT          (独立通道,hike 中批量)     hike 里)                    {localId}.json
        (一个事务)                                                                          ↓
                                                                                       SyncDaemon 重试直到成功
                                                                                       or 用户长按放弃
```

**核心事实**（先立起来,后面每条链路细讲）:

| 事实 | 现状 | 期望 |
|---|---|---|
| `sessions` 表在 aliyun | **不存在**（被 R9B7 auto-migration 误删） | 存在 |
| `memory_points` 表 | 存在,活着,2026-07-29 有新点 | 保持 |
| 客户端 `saveHikeAtomic` → PATCH `/api/sessions/:id/save` | **必挂**（表不存在 → 500 或 404） | 200 |
| 每次 Save 失败后 payload 写入 pendingSyncStore | 已经发生了 30+ 天 | 用完清空 |
| offline 队列里的 payload | 全部 activity payload(含 memory_points 复本),`attemptCount` 无上限 | 表建好后一次性重放,全部落库 |

---

## 1. 链路 A — Activity（== session == hike）

一次完整 hike 的整体记录:名字、类型、起止时间、总距离、总时长、路径 JSON、raw 轨迹。

### 1.1 数据模型

**客户端 (`TrackingSession`, `app/src/store/useSessionStore.ts:32-56`)**:

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | string | UUID (client 生成) 或 String(remoteId)（hydrate 后） |
| `remoteId` | number \| undefined | 后端 sessions 表 row id,同步成功后回填 |
| `activityMode` | 'hiking' \| 'running' | 类型 |
| `regionCode` | string | 'nz' / 'au' |
| `startedAt` | number (ms) | 起始时间 unix ms |
| `endedAt` | number (ms) | 结束时间 unix ms |
| `durationS` | number | 总秒 |
| `distanceM` | number | 总米 |
| `elevationGainM` | number | 累积爬升 |
| `trackPoints` | `TrackPoint[]` | 路径点（snapped 或 Kalman-smoothed）**仅本地 AsyncStorage,不发服务器** |
| `markerIds` | string[] | 本次 hike 内种的标记 id |
| `name` | string? | 用户命名（默认 "Hike — DD/MM/YYYY"） |
| `memoryNewCells` | number? | 本地字段,新解锁的 H3 cells 数,不进服务器 |
| `syncState` | 'synced' \| 'pending' \| 'syncing' \| undefined | v412 状态机 |

**服务器 (`sessions` 表,`backend/src/models/Session.js` + `PATCH /save` handler)**:

| 列 | 类型 | 说明 |
|---|---|---|
| `id` | int PK | auto increment |
| `user_id` | int FK | |
| `route_id` | int? | 未用（预留） |
| `type` | enum('hiking','running') | |
| `start_time` | datetime | |
| `end_time` | datetime | |
| `distance_m` | float | |
| `duration_s` | int | |
| `name` | varchar? | 用户命名 |
| `route_points` | JSON | snapped 或 Kalman 后的干净路径 `[{lat,lng,t}]` |
| `route_points_raw` | JSON? | 全轨迹（含低精度、静止点） |
| `flags` | JSON? | 已弃用 |
| `finalized_at` | datetime? | v412: NOT NULL = 已 finalize,NULL = 只 start 未 save |
| `created_at` | datetime | |

**1:1 严格程度**: **不严格**。客户端的 `trackPoints`、`elevationGainM`、`memoryNewCells`、`regionCode`、`markerIds`、`syncState` 都不发服务器；服务器的 `route_id`、`flags`、`finalized_at` 客户端不 mirror。**磁盘上的 `trackPoints` 才是权威路径**（大数组不进 sessions 表内存 store,`AsyncStorage cairn_trackpoints_<userId>_<sessionId>` 单独存）,服务器上则是 `route_points` JSON 列。

### 1.2 写路径（happy path）

```
1. HikingScreen tap Stop
   └→ StopSummarySheet 弹出 → 用户填名字 → tap Save
       └→ useTrackingStore.stopTracking(name)
2. too-short 检查（<2 点或 <20m）→ 若过短,删掉 server empty row,return
3. cleanup:清 intervals / subscriptions / TaskManager background task
4. snap-to-road:snapTrack(trackPointsSmoothed) → snappedTrackPoints
5. flushHikingToMemory(hikeSource) → memoryNewCells + 本地 useMemoryStore 累积
6. 构 v412Payload:
   {
     end_time, distance_m, duration_s, name,
     route_points: <snapped 或 smoothed>,
     route_points_raw: <trackPointsRaw>,
     memory_points: <memoryStore.points 里 !synced 且 ts 落在本 hike 时间窗内的>
   }
7. 生成 idempotencyKey (uuidv4),20s wall-clock 超时包裹 saveHikeAtomic(remoteId, payload, key)
       ↓
       PATCH /api/sessions/:id/save,X-Idempotency-Key header
       ↓
       服务器:
         a. 起事务 + FOR UPDATE 锁 sessions row
         b. 校验归属 + 未 finalize（finalized_at IS NULL AND end_time == start_time）
         c. UPDATE sessions (SET end_time, distance_m, duration_s, name, route_points,
                                  route_points_raw, finalized_at = NOW())
         d. INSERT memory_points 批量（chunk=50, ON DUPLICATE KEY UPDATE cid=cid）
         e. attributeMemoryPoints(conn, userId, minTs, maxTs) 把新点归入 unlocked_regions
         f. commit → 200 { ok:true, session_id, finalized_at, memory:{accepted, rejected} }
8. v412Success = true → useSessionStore.addSession({ ..., syncState:'synced' })
9. markPointsSyncedByCid(cids) 把 memoryStore 里的对应点标 synced
10. renameToCompleted(sid) 把 hikeTrackWriter 的 active/{sid}.jsonl 挪到 completed/
```

**当前实际发生的**:
- **步骤 7 服务器端会 fail**（sessions 表不存在,`FOR UPDATE` 抛 `ER_NO_SUCH_TABLE`）→ 500
- **步骤 8 走 else 分支**: `syncState:'pending'` + `savePending(hike)` → 写 FS
- **步骤 9 不跑** → memoryStore 里的对应点仍 `!synced`
- **步骤 10 仍会跑**(rename 是磁盘操作,和 server 无关)

### 1.3 读路径

**hydrate (`app/src/store/useAppStore.ts:189+`)** 顺序:

1. `useSessionStore.hydrate(userId)` — 从 `AsyncStorage.cairn_sessions_<userId>` 载 summary（无 trackPoints）,推断 `syncState`（有 remoteId → 'synced',无 → 'pending'）
2. `beforeMerge` = 本地 hydrate 后所有 session
3. `preservedLocals` = filter(`syncState === 'pending' | 'syncing'` 或 `remoteId == null`）
4. `remote = fetchSessions()` → `GET /api/sessions` (Session.findByUser)
5. remote 里 filter 掉 preservedRemoteIds
6. merged = [...preservedLocals, ...remoteSessions]
7. **孤儿 pending 兜底**（SAF-06,2026-07-29 加的）:`listPending()` 磁盘上的 pending 若不在 merged 里,构占位卡塞回去
8. `useSessionStore.setState({ sessions: merged })`

**list**: `SessionsList` 直接读 `useSessionStore.getState().sessions`

**detail**:
- 本地 fallback:`loadTrackPoints(sessionId)` → 读 `AsyncStorage.cairn_trackpoints_<userId>_<sessionId>`
- 服务器:`fetchSessionDetail(remoteId)` → `GET /api/sessions/:id`（含 route_points JSON）

### 1.4 失败模式

| 失败场景 | 行为 |
|---|---|
| 网络断（`saveHikeAtomic` catch netErr） | 500ms 内重试 1 次 → 仍失败 → throw status=0 → catch 走 pending 分支,`savePending()` 写盘 → syncState='pending' |
| 服务器 5xx | 500ms 重试 1 次 → 仍 5xx → throw with status → 走 pending 分支 |
| 服务器 4xx (非 401) | **不重试**,直接 throw → 走 pending 分支（saveHikeAtomic 里的 break 后 !res.ok 逻辑） |
| 服务器 401 | `saveHikeAtomic` 不特判 401 → throw → 走 pending 分支（**问题**:token 挂时永远无法上传,应该走 refresh） |
| Malformed response (`ok !== true` 或 `session_id` 非 number) | throw `err.malformed=true` → 走 pending 分支 |
| Wall-clock 20s 超时（切后台 setTimeout 暂停） | reject with 'v412 wall-clock timeout 20s' → 走 pending 分支 |
| pending 磁盘写盘也挂（SAF-01） | 设 `saveLostSessionId` + `saveLostPayload`,`storage.setItem('cairn_saf01_payload', ...)`,HikingScreen 冷启读回 → 弹 Alert 让用户手动 Retry |

### 1.5 当前具体问题

| 问题 | 定位 | 观察到的事实 |
|---|---|---|
| **sessions 表不存在** | aliyun DB | R9B7 auto-migration runner 误删（见 MEMORY.md `feedback_migration_runner_dry_run`,2026-07-29:R9B7 boot 时跑 `004_auth_rebuild.sql`） |
| **backup 表存在** | aliyun DB | `_sessions_backup_o1_20260726` 有 21 条历史 activity 完整（含 route_points JSON） |
| POST /api/routes 独立死 endpoint（不在本次 scope) | — | 见 MEMORY.md `project_routes_endpoint_dead` — schema/handler 不一致,任何 POST 400,DB 最后 route 2026-06-28 |
| Save 后 activity detail "Loading route..." 再消失 | `stopTracking` outer try/catch (`useTrackingStore.ts:920+`) | 用户 12:11 事件（见 `MEMORY.md > 项目 v416`）触发 O8 log,`o8.stop.outer_throw` 会记录 |
| 30+ 天的 pending payload 堆积 | `{docDir}/cairn-pending-sync/*.json` | `savePending` 无上限,`attemptCount` 无上限（`syncDaemon.ts:96+`）,SyncDaemon 每次 NetInfo online / AppState active 都会重试 |
| memoryStore 里对应点仍 `!synced` | `useMemoryStore` | 因为 v412 saveHikeAtomic 500 → 没跑到 `markPointsSyncedByCid`,但 memory_points 表**收到过 client 直接批量 POST**（因为 flushHikingToMemory 走的是不同通道,见链路 B） |
| finalize 兜底 handler PATCH /:id 仍活 | `sessions.js:113-198` | 但也会挂在 sessions 表不存在 |

### 1.6 建 sessions 表之后

**会不会自动恢复**? **不会 100% 自动,需要三步**:

1. **建表**（要求 schema 和 `Session.js` + `PATCH /save` handler 完全一致):
   - 关键列:`id, user_id, type, start_time, end_time, distance_m, duration_s, name, route_points (JSON), route_points_raw (JSON), flags (JSON), finalized_at, created_at`
   - 索引:`(user_id, start_time DESC)` 供 `findByUser` 用
   - 引擎 InnoDB(用了 `FOR UPDATE` 行锁)

2. **回迁 backup 21 条**:`INSERT INTO sessions SELECT * FROM _sessions_backup_o1_20260726`

3. **客户端 SyncDaemon 自动重放**:
   - 每个用户下次 `hydrate()` 完成 → `drainPending()`
   - 逐个 payload 用**同 idempotencyKey** 再 PATCH `/:id/save`
   - 成功 → `markSynced` + `removePending`
   - **风险 1**:pending payload 里的 `remoteId` 指向已被删的 sessions row(id 已不复存在)→ handler `FOR UPDATE` 会 404("Session not found")→ **payload 会一直 retry 失败**
   - **风险 2**:pending 里若 `remoteId=null`(hike start 时就离线),`uploadOne` 会先 `startSession` 重新拿 remoteId,再 saveHikeAtomic → 这条路径能自动恢复
   - **正确恢复方案**: 建表 + backup 回迁完成后,手动脚本把 pending 里的 payload 直接 `INSERT INTO sessions` 强制回填,再 client 端 `removePending`;或者改 handler 允许 finalized session 幂等 replay(其实已经支持,`alreadyFinalized` 分支 200)——但**核心问题是 remoteId 指向的 row 不存在**,所以要么 handler 加一条"row 不存在时用 remoteId 直接 INSERT",要么客户端把 pending 里所有 `remoteId` 清 null 让 SyncDaemon 走 startSession 分支。

---

## 2. 链路 B — Memory（== memory_points 足迹点）

每 ~2 秒采样一次的 GPS 点,单独通道,和 activity 独立。

### 2.1 数据模型

**客户端 (`useMemoryStore.points`)**:

| 字段 | 类型 |
|---|---|
| `lat` | number |
| `lng` | number |
| `ts` | number (ms, integer) |
| `cid` | string(≤36) — deterministic 或 UUID |
| `synced` | boolean — client 端标记 |

**AsyncStorage key**: `cairn:memory:tiles:v5:<userId>`（h3 tile 聚合缓存）+ unsynced points 单独持久化。

**服务器 (`memory_points` 表,`backend/src/routes/memory.js`)**:

| 列 | 类型 |
|---|---|
| `id` | int PK |
| `user_id` | int FK |
| `lat` | double |
| `lng` | double |
| `ts` | bigint |
| `client_id` | varchar(36) |
| **UNIQUE (user_id, client_id)** | v0.2.6.3 K2 fix,pre-fix 是 (user_id, ts) 会冲突 |

**1:1 严格程度**: 数据严格 1:1。客户端 `synced` 是本地状态,服务器不知道。

### 2.2 写路径

**两条并行通道**:

**通道 B1 — 独立批量 POST**（一直活着,和 activity 无关):
- `flushHikingToMemory(trackPoints)` 或 `MemoryScreen ForegroundUnlockManager` 在 hike 中记录点入 `useMemoryStore`
- `memorySync` 服务每 30-60s 批量 `POST /api/memory/points {points:[{lat,lng,ts,cid}]}`
- 服务器批量 INSERT（`ON DUPLICATE KEY UPDATE cid=cid`,幂等）
- 返回 `{points:[{batch_index,ts,cid} | null,...]}` — client 用 echo 结果标 synced

**通道 B2 — v412 一体化事务**（stopTracking Save 时):
- `useMemoryStore.points.filter(!synced && ts in hike window).map(cid)` 塞进 `saveHikeAtomic` 的 payload.memory_points
- 服务器在同一个事务内批量 INSERT memory_points（同样 `ON DUPLICATE KEY UPDATE`)
- 成功后 client 端 `markPointsSyncedByCid`

**双通道设计的意图**: hike 中的通道 B1 保证即使 app 崩溃也已持久化到服务器；通道 B2 保证 Save 时"最后一批点"和 activity 原子落库,不需要额外一次网络。

### 2.3 读路径

`hydrateMemoryForUser(userId)`（`useAppStore.hydrate` 里跑）:

1. `GET /api/memory/points?after_ts=<localMaxTs>&until=<now>` 分页拉服务器新点
2. keyset pagination:`(ts > after_ts) OR (ts = after_ts AND cid > after_cid)`
3. merge 进本地 `useMemoryStore.points`,反向填 h3 tile 缓存

### 2.4 失败模式

| 场景 | 行为 |
|---|---|
| 网络断 | POST /points throws → 本地 unsynced 累积,下次周期重试 |
| 5xx | 同上,重试 |
| 401 | 走 apiService refresh(和 activity 一样),refresh 失败则 unsynced 继续攒 |
| rate-limit（120/5min/userId） | 429 → 下次重试 |
| Invalid points（NaN/Infinity/超范围) | server 返 null 占位 → client 靠 confirmedSet 保守不标 synced,下次 retry(但 payload 相同,永远失败——设计忽略,交给 attributeMemoryPoints 错误日志) |

### 2.5 当前具体问题

**没问题**。用户明确验证 2026-07-29 memory_points 表有 11 个新点入库(链路 B1 走通)。

细节:
- `POST /api/memory/points` 全流程正常（`memory.js:57+`）
- `deterministicCid` 幂等,retry 不会重复
- rate-limit 120/5min/user 对正常使用足够
- `attributeMemoryPoints` 有独立 try/catch,不 rollback

### 2.6 建 sessions 表之后

**这条链路完全不受影响**。当前正常,建表也不动它。

**但通道 B2 (v412 一体化)会重启**:
- 建表后 SyncDaemon 重放 pending payload → 走 `PATCH /:id/save` → memory_points 批量 INSERT 又跑起来
- **风险**:pending payload 里的 memory_points 大部分 cid 已经通过通道 B1 落库了 → `ON DUPLICATE KEY UPDATE` 会静默 no-op → `accepted` 计数偏低但**不会脏数据**
- markPointsSyncedByCid 也会跑起来,把 client 端 30+ 天前的 unsynced 标 synced —— 这个是要的。

---

## 3. 链路 C — Offline (== pendingSyncStore)

因网络/服务器失败暂存的 **activity save payload**。纯客户端队列,服务器不参与。

### 3.1 数据模型

**磁盘 (`{docDir}/cairn-pending-sync/{localId}.json`, `pendingSyncStore.ts:36-56`)**:

```ts
interface PendingHike {
  localId: string;                    // uuid,hike 结束时生成
  userId: string;                     // 归属用户
  remoteId: number | null;            // hike start 拿到的 sessions.id,null = start 时也离线
  idempotencyKey: string;             // uuidv4,retry 用同一个
  activityMode: 'hiking' | 'running'; // v412 blocker 1: 必须存,否则 running 变 hiking
  payload: {
    end_time: string;                 // ISO
    distance_m: number;
    duration_s: number;
    name: string;
    route_points: [{lat,lng,t}];      // v412 干净轨迹
    route_points_raw: [{lat,lng,t,acc?}]; // v412 全轨迹
    memory_points: [{lat,lng,ts}];    // v412 内联 memory 复本
  };
  createdAt: number;
  lastAttemptAt: number | null;
  attemptCount: number;               // 无上限
}
```

**服务器不参与**。web fallback 用 localStorage shim(`getFs()` 里)。

### 3.2 写路径

写入触发场景（只有一个入口 `savePending()`,`pendingSyncStore.ts:142`）:

1. **正常 Save 时 saveHikeAtomic throw**（`useTrackingStore.stopTracking:1168-1182`）:
   - 500 / 4xx / 网络异常 / 20s timeout / malformed → catch → `savePending({...})`
2. **hike 开始时也离线**（remoteId=null,`useTrackingStore.stopTracking:1222-1237`）:
   - startSession 从未成过 → 直接 savePending
3. **磁盘写盘也挂**（SAF-01,`useTrackingStore.stopTracking:1183-1219`）:
   - set `saveLostSessionId` + `saveLostPayload` + `storage.setItem('cairn_saf01_payload')`

### 3.3 读路径

`syncDaemon.drainPending()` （`syncDaemon.ts:28+`):

1. `isDraining` mutex；`pendingSignal` 保证 drain 中新触发不丢
2. `listPending()` 读磁盘全部
3. **orphan-pending sweep**（Sprint 6 R11B4):内存 session 里有 syncState='pending' 但磁盘没有对应文件的 → 若有 remoteId 强 markSynced,若无 remoteId 保 pending("re-enqueue" 语义)
4. 逐条 `uploadOne(hike)`:
   - 用户 gating(R7B5/R9B5):userId 不匹配当前登录用户 → 跳过（不标 attempt,不删）
   - `remoteId` null → 先 `startSession(activityMode, startTime)` → 拿到 rid → `updateRemoteId(localId, rid)`
   - `saveHikeAtomic(remoteId, payload, idempotencyKey)` → 用磁盘上存的**同一个** key
   - 成功:`markSynced(localId, session_id)` → `removePending(localId)`
   - 失败:`markAttempt(localId)`,保留 pending

**触发时机**:
1. `useAppStore.hydrate()` 完成后（冷启,`hydrate:end` breadcrumb 之前会调 `drainPending()`）
2. `NetInfo isConnected false → true`(网络恢复)
3. `AppState background → active`(前后台切回)
4. 用户 tap 顶部 banner(手动触发)
5. `abandonPending(localId)` — 用户长按灰卡放弃(直接删,不重传)

### 3.4 失败模式

| 场景 | 行为 |
|---|---|
| saveHikeAtomic 失败 | `markAttempt`（`attemptCount++`）,pending 保留,下次触发再试 |
| startSession 失败(remoteId=null 分支) | 同上,markAttempt |
| userId 不匹配 | 跳过,不 markAttempt(等匹配用户登入才重传) |
| markSynced throw(store 未 loaded) | 仍会 `removePending` → 磁盘清,但内存里 sess.syncState 停留在 'pending' → orphan sweep 下次修 |
| 用户长按放弃 | `abandonPending` → `removePending` + `removeLocal` → 数据永久丢 |
| **attemptCount 无上限** | pending 永远重试,直到成功 or 用户放弃 |

### 3.5 当前具体问题

| 问题 | 定位 | 事实 |
|---|---|---|
| **pending 永远重试,attemptCount 无上限** | `syncDaemon.ts:96+` uploadOne + `markAttempt` | 服务器 500(表不存在)→ `err.status=500` → catch → markAttempt → 循环 |
| **pending 卡片永远灰** | `useSessionStore` syncState='pending' 且 remoteId 存在但服务器 row 已死 | 用户看到灰卡但无法点开,长按才能放弃 |
| pending 里的 remoteId 全部指向已删除的 sessions row | 每次 saveHikeAtomic 前 startSession 时拿到的 id 都不在了 | 建表后即使 handler 回来了,`FOR UPDATE` 会 404 |
| memory_points 存在 pending payload 里 | `payload.memory_points` | 大部分 cid 通过链路 B1 已落库,SyncDaemon 重放会 dedupe（不脏） |
| SAF-01 blob 只保留 1 条 | `storage.setItem('cairn_saf01_payload', ...)` (`useTrackingStore.ts:1208+`) | 若两条相继 SAF-01,第二条覆盖第一条 blob—— pendingSyncStore 挂时的兜底不 robust |

### 3.6 建 sessions 表之后

**不会立刻恢复。需要三种可能方案**:

**方案 α:handler 兼容 stale remoteId**（推荐,最少改动）
- 改 `PATCH /:id/save` handler:`FOR UPDATE` 找不到 row 时,不直接 404,而是**用 payload 里的 idempotencyKey 和 start_time 直接 INSERT sessions row**(相当于重建)
- 需要客户端 payload 里加 `start_time`（当前没有——`payload` 里只有 end_time,得从 sessions row 里读）——**这个方案需要 pending payload 扩字段,历史 payload 缺 start_time,无法用**
- 变通:handler 见 remoteId 不存在 → 直接 `INSERT` 一条(start_time = end_time - duration_s 反推),用 idempotencyKey 保证不重复
- 或者 handler 401/404 时改成 create-if-not-exists,把 payload 换成 upsert 语义

**方案 β:客户端一次性重置 pending**(次推荐)
- 建表 + backup 回迁完成后
- 一次性脚本:遍历 pending 目录,把每个 payload 的 `remoteId` 改成 `null`
- SyncDaemon 下次触发 → `uploadOne` 走 `!hike.remoteId` 分支 → `startSession(activityMode)` 建新 row → `saveHikeAtomic` 落库
- **副作用**:所有 pending 会拿到新的 sessions.id,和 backup 表的历史 id 冲突可能性零(auto increment 会继续往上走)
- **风险**:如果 pending 里的 hike 和 backup 里已存在的 hike 是同一次(理论上不可能,因为一个 hike 只走一条链——要么成功进 sessions,要么失败进 pending),重放会造成重复 activity

**方案 γ:直接把 pending 用 admin 脚本入库**(最快,一次性)
- 遍历用户设备 pending 目录(不可行,数据在客户端不在服务器)
- 只能等用户开 app,SyncDaemon 触发,走方案 β 逻辑

---

## 4. 三条链路的关联点

### 4.1 一次 hike 同时产生 activity + N 个 memory_points

**是的**。同一次 hike 时:
- 链路 A(activity):hike 结束时一次性 PATCH /:id/save
- 链路 B1(memory 通道 1):hike 进行中每 30-60s 批量 POST /memory/points
- 链路 B2(memory 通道 2):hike 结束时把 memoryStore 里未 synced 的点复本塞进 A 的 payload

### 4.2 "activity 失败但 memory_points 成功" 会看到什么

**这就是用户 2026-07-29 观察到的场景**:
- memory_points 表:11 个新点(链路 B1 走通,和 activity 无关)
- sessions 表:不存在,任何 activity save 500
- 客户端:pendingSyncStore 里堆了一条 payload,syncState='pending' 灰卡

**用户看到**:MemoryScreen 有新点亮起,但 Activities 列表看不到那次 hike(它以 pending 状态在,但用户可能不知道要长按).这**不是数据丢失**——data 在两地都存着:
- pending payload 里有 activity 完整数据(route_points + raw + name + times)
- memory_points 表里有 hike 中所有采样点(通道 B1 走通的部分)

**建表后**:
- 若走方案 β,SyncDaemon 会用 startSession 重新建 sessions row,把 pending payload 打进去 → activity 卡片从 pending 变 synced
- payload 里 memory_points 会重复 INSERT(链路 B2)→ 但 `ON DUPLICATE KEY UPDATE cid=cid` 静默 dedupe → 无脏数据
- 结果:memory_points 表数据不变,sessions 表新增一条(historical activity 补齐)

### 4.3 offline pending 里的 payload 只涉及 activity 吗?

**不是**。pending payload **同时包含 activity 数据 + memory_points 复本**(见 §3.1 `payload.memory_points`)。

**为什么两条通道 memory 都传**:
- 链路 B1:hike 中周期性传,防止 app 挂掉丢点
- 链路 B2:v412 事务里塞进去,保证 "Save 那一刻" 的最后几个点原子落库

**建表后的行为**:
- SyncDaemon 重放 payload → 服务器同事务 INSERT memory_points → **绝大多数点已经通过链路 B1 落库了**(它们通过通道 B1 的 memorySync 服务在 hike 中已经传上去了) → `ON DUPLICATE KEY UPDATE cid=cid` no-op
- **净效果**: `memory.accepted` 返回值会显示实际写入,但 memory_points 表实际增加 0 或极少几条(pending payload 制作时是 unsynced 状态,现在很多已经通过通道 B1 落库了)

---

## 5. 建 sessions 表的 checklist

从本诊断里抽出的顺序操作清单:

| 步骤 | 谁做 | 内容 |
|---|---|---|
| 1 | DBA | 从 `_sessions_backup_o1_20260726` 反推 schema,创建 `sessions` 表(InnoDB,含 finalized_at,索引 (user_id, start_time DESC)) |
| 2 | DBA | `INSERT INTO sessions SELECT * FROM _sessions_backup_o1_20260726` 回迁 21 条历史 |
| 3 | Backend | 关掉 R9B7 auto-migration runner or 加 DRY-RUN 白名单,防止再删（见 MEMORY.md feedback） |
| 4 | Backend | (可选)handler `PATCH /:id/save` 加"row 不存在时 upsert"分支,允许 pending 里 stale remoteId 恢复 |
| 5 | Client(或 admin 脚本) | 一次性把 pending 目录里所有文件 remoteId 改 null（如果不用步骤 4） |
| 6 | 观察 | 让一个测试用户开 app → hydrate → drainPending → 观察 pending 卡片能否变 synced |
| 7 | Playwright E2E | 用 web hooks 跑一次完整 hike Save,验证 200 + memory_points 复用 |
| 8 | 清理 | 一周后 backup 表可选保留或 drop |

---

## 6. 关键文件引用总结

| 文件 | 用途 | 关键行 |
|---|---|---|
| `app/src/services/sessionService.ts` | saveHikeAtomic + startSession + appendPoints + fetchSessions | 184-321 |
| `app/src/services/pendingSyncStore.ts` | 磁盘 pending 队列 CRUD | 全文 219 行 |
| `app/src/services/syncDaemon.ts` | drainPending / uploadOne / abandonPending | 全文 205 行 |
| `app/src/store/useSessionStore.ts` | TrackingSession + hydrate + markSynced + removeLocal | 82-310 |
| `app/src/store/useTrackingStore.ts` | stopTracking(save 主线) + startTracking + addTrackPoint | 746-1480 是 stopTracking |
| `app/src/store/useAppStore.ts` | hydrate 合并本地/远程 sessions + SAF-06 孤儿兜底 | 260-365 |
| `backend/src/routes/sessions.js` | 全部 sessions endpoints,含 v412 PATCH /:id/save | 211-401 是 /save 主逻辑 |
| `backend/src/routes/memory.js` | memory_points 批量 POST + keyset GET + 限流 | 57-158 是 POST |
| `backend/src/models/Session.js` | sessions 表 SQL 层 | 全文 235 行 |

---

## 7. 下一步(不含代码改动)

1. **确认 backup 表 schema 和当前 `Session.js` 完全一致**(列名、类型、finalized_at 是否存在),若 backup 是 v411 时代的可能缺 finalized_at 列
2. **决定 stale-remoteId 处理方案** α / β / γ,推荐 β + 一次性 admin 脚本
3. **搭一个 canary 用户环境**,先在测试用户上验证 SyncDaemon 重放 pending 能否顺利落库
4. **建表 SQL 起草放到 `_review/2026-07-30-sessions-recovery/schema-proposal.sql`**(下一步)
5. **admin 脚本起草放到 `_review/2026-07-30-sessions-recovery/pending-reset.md`**(下一步)

---

**档案完**  
参考:MEMORY.md `project_sessions_table_missing`, `project_routes_endpoint_dead`, `feedback_migration_runner_dry_run`, `project_cairn_v416_state`
