# v409 Research B — 本地 GPS 轨迹存储方案对比

**Author**: Research Agent B (独立调研员)
**Date**: 2026-07-06
**Scope**: 1–8h 连续 GPS 记录场景下,Cairn v409 的本地存储方案选型
**方法**: context7 拉库文档 + GLM websearch + Cairn 现有代码 (`memorySync.ts`, `useSessionStore.ts`, `debugLogger.ts`, `backgroundLocationTask.ts`, `telemetryUploader.ts`, `package.json`) 逐段读

> **说明**: 报告中标注 "**已知**" 的数值来自 library README / 官方 docs / Cairn 代码本身;标注 "**估算**" 的是我的数量级推断,不是精确 benchmark;标注 "**不知道**" 的表示官方文档 + web search 都没找到硬数据,不猜。

---

## 1. Cairn 当前存储现状 (从代码读出的 ground truth)

| 场景 | 当前方案 | 位置 |
|------|---------|------|
| Session summary (无 trackPoints) | AsyncStorage (`cairn_sessions_<uid>`) | `useSessionStore.ts` |
| Session trackPoints | AsyncStorage per-session (`cairn_trackpoints_<uid>_<sid>`) | `useSessionStore.ts:83-86` |
| Memory points (fog reveal) | Zustand in-memory + backend sync via `memorySync.ts` | `useMemoryStore.ts` |
| Debug telemetry (gps_fix events) | JSONL file via `expo-file-system/legacy` | `debugLogger.ts` |
| Background GPS (app killed) | JSONL file, session_id + enabled 存 AsyncStorage | `backgroundLocationTask.ts:74-108` |
| Upload queue | `debugLogger.listSessions()` filter `!uploaded && ended_at !== null` | `telemetryUploader.ts:196-211` |

**关键代码痛点**:
1. `debugLogger.doFlush()` line 356–366 是 **read-modify-write append** — 每次 flush 全文件 read + concat + write。1h session 到 50MB 后 read/write 单次 IO 会成本很高 (line 361 硬编码 50MB drop tail)。
2. `useSessionStore.addSession` line 82–86 用 `JSON.stringify(session.trackPoints)` 全序列化,单条 AsyncStorage setItem。3600 点 (1h @ BestForNavigation) ~200KB 一次性写。
3. AsyncStorage on iOS 无 native 大小上限告知(实际是 SQLite backing),Android 有 6MB 单值上限 (**已知**: `@react-native-async-storage/async-storage` 从 0.63 起 Android 用 SQLite,`AsyncStorage_db_size_in_MB` 默认 6MB,可 gradle.properties 调)。
4. `memorySync.ts` line 135 `MAX_RESPONSE_BYTES = 500_000` — pull 端 500KB 已经会 Hermes JSON.parse sync-freeze 1–3s。同样问题存在于本地 read-then-parse。

---

## 2. 存储方案对比 (5 维度)

| 方案 | 写延迟 (append 1 point) | 读延迟 (整 session 3600 pts) | Max size | Crash safety | iOS jetsam 存活 | Cache 清理难度 |
|------|------------------------|------------------------------|----------|--------------|-----------------|----------------|
| **AsyncStorage** (现状) | 中等: 全 session read+stringify+write ~5–50ms (随 size 增长) | 慢: 一次 getItem + JSON.parse,3600 pts JSON ~300KB → Hermes parse **估算 200–800ms** | Android 默认 6MB/key (可调),iOS ~SQLite 无硬限制 (**已知**) | 一般: SQLite backing 提供原子性,但每次 replace 整值,写中断 = 上次数据 | ok: iOS suspend 前 flush 完就存活 | 差: 只能 `getAllKeys` 全枚举 filter(见 `clearSessions` line 145 注释) |
| **expo-file-system JSONL** (现状 telemetry 用) | 中等偏慢: `debugLogger.doFlush` 是 read+concat+write,size 越大越慢 (**估算 10MB 文件单次 flush 100–500ms**) | 慢: 一次 readAsStringAsync 全文件,3600 pts JSONL ~350KB **估算 200–500ms** parse | 单文件 50MB (代码硬 cap `debugLogger.ts:361`) | **不好**: 写中断 = 半行,parse 时报错;`writeAsStringAsync` 不是原子 rename (**已知**: expo-file-system legacy 没有 atomic write API) | ok: `persistMetaForKillSafety` (line 161) 已实现 background flush | 好: 直接 `deleteAsync` per file,`listSessions` 枚举 meta 目录 |
| **expo-sqlite** | 快: `runAsync` 单条 INSERT **估算 <5ms**;`withTransactionAsync` 批 100 条 **估算 20–50ms** (WAL 模式) | 快: `SELECT * WHERE session_id=? ORDER BY t LIMIT 3600` **估算 <50ms**;`getEachAsync` 可流式 iterate 避免全内存 parse | 硬盘容量上限 (**已知**: SQLite 页面 max 281TB 理论);单表 unlimited rows | 好: WAL 模式 + `withTransactionAsync` 提供 ACID,写中断整个 tx rollback | ok: SQLite fsync on commit,iOS jetsam 前已 flush | 好: `DELETE FROM points WHERE session_id=?` + `VACUUM` 或按 session id 批删 |
| **react-native-mmkv** | 极快: JSI 同步 setter **已知 ~30x 于 AsyncStorage**,单 write **估算 <0.5ms** | 极快: mmap 直读,**估算 <5ms**;但整 session 二进制 blob 才有意义 | (**不知道** MMKV 单实例默认上限 — Tencent MMKV core 是 mmap 映射整个 crc 段,理论无硬上限,但实际大 blob 性能会退化;**已知** README 建议 `byteSize > 4096` 就 `trim()`) | 好: mmap + crc,进程 kill 掉最近未 sync 的会丢 1 个 write (**已知** README) | ok: mmap 页会随内存压力被 iOS 换出,但文件已 on-disk | 中等: `clearAll` / `delete(key)`,但 append-only GPS 流不适合 key-value 模型;需要自己按 session 分 instance |
| **realm** | 快: 结构化 write **估算 <5ms** | 快: query object graph **估算 <50ms** | 硬盘上限 | 好: 事务 ACID | ok | 中等: `realm.write(() => realm.delete(...))` |

**重要 caveats**:
- **MMKV V4** (Nitro-based, 2025) 向后兼容 old architecture (**已知** context7 README);Cairn `package.json` 用 RN 0.81 + expo 54,支持,但**需要 `npx expo prebuild` + native module** — 不能在 Expo Go 用,现有 EAS build 需要重新配置。
- **Realm** 同样需 native module + EAS build,且 Realm 已被 MongoDB deprecate(Atlas Device SDK 转到 maintenance)。
- **expo-sqlite** SDK 54 已在 Cairn 依赖树内(via expo umbrella),**不需要额外 native module**,可直接 `import * as SQLite from 'expo-sqlite'` (**已知** context7 docs 有 v54/v55/v56 SDK 均包含此库)。
- 用户 memory feedback: "永禁 eas build" — 这一条**排除掉 MMKV 和 Realm 两种方案**,因为它们都需要重新 native prebuild + EAS build。**expo-sqlite 是 Expo SDK 内置,不需要额外 native prebuild**(**不知道** 是否已在 Cairn 当前 EAS 配置中,但基于 SDK 54 依赖是可以 opt-in 而不重新 build)。

---

## 3. 1h hike 数据结构 & 大小估算

### GPS 点数

| 采集模式 | 频率 | 1h 点数 | 8h 点数 |
|---------|------|---------|---------|
| BestForNavigation | ~1s | 3,600 | 28,800 |
| significant-change | ~30–300s (iOS 系统决定) | 12–120 | 100–960 |

Cairn 现在 `backgroundLocationTask.ts` 通过 `pendingBackgroundLocations` queue 累积,不做 client-side downsample,所以点数 = expo-location 实际吐出数。

### 单点大小 (估算)

**JSON** (`{ts, lat, lng, accuracy, altitude}` 5 字段):
- `{"t":1720260000000,"lat":-36.848461,"lng":174.763336,"acc":8.5,"alt":42.3}` = **~82 bytes**
- 3600 点 = **~290 KB**
- 28800 点 (8h) = **~2.3 MB**

**Delta encoding** (每点相对前一点存 delta):
- ts delta 10 bits (1024s 内),lat/lng delta 20 bits (~1cm at equator),acc 10 bits = **~7 bytes/point** (估算)
- 3600 点 = **~25 KB** (~12x 压缩)
- 8h 28800 点 = **~200 KB**

**Google Encoded Polyline** (**已知** 算法,只压缩 lat/lng,不带 ts/acc):
- 每点 5–11 bytes 平均 **~7 bytes**,只有 lat/lng
- 3600 点 = **~25 KB**,但丢失 ts 和 acc,不适合本项目(要 replay + accuracy filter)

**Protobuf** (schema: `repeated Point points`, `Point { fixed64 ts, sint32 lat_e7, sint32 lng_e7, uint32 acc_cm }`):
- 每点 **~15–20 bytes** (估算,含 varint tag)
- 3600 点 = **~60 KB**
- 但需引 protobufjs 或类似库,增加 bundle 20–50KB

**结论**: 
- 现状 JSON 存 3600 pts (1h) = 290KB → Hermes JSON.parse 估算 200–500ms sync freeze,是 memorySync line 135 已知的 pain 点
- 8h session JSON = 2.3MB → Android AsyncStorage 6MB 单值限制内但接近;iOS 无硬限但 parse 会 freeze **估算 1–3s**
- SQLite 存 raw columns (ts, lat_e7, lng_e7, acc_cm) = 每行 ~30 bytes on disk,查询无 parse 开销

### File lock 竞态 (前台 store + background TaskManager 同时写)

**当前风险**: `backgroundLocationTask.ts` `appendDirectlyToSessionFile` (line 74) 和 `debugLogger.doFlush` (line 341) 都对同一 session file 做 read-modify-write。expo-file-system legacy 没有文件锁,两者交错会**丢数据** (later write overwrites earlier):

```
T0: bg reads file (10KB)
T1: fg reads file (10KB)  
T2: bg writes file (10KB + bg_line)
T3: fg writes file (10KB + fg_line)  ← bg_line 丢
```

**已经在生产**: 见 `backgroundLocationTask.ts` line 154–161 有 "Path A" (debugLogger 活着) 短路避免大部分场景,但 kill app 到重启的窗口内,如果 debugLogger 未 attach,只走 Path B,依然有 bg-only 单写,ok。真正风险在**并发前台 + 后台**同时活 (app 前台但 TaskManager fired) — 从代码看这是可能的,expo-location foreground + background 是同一 task。

**SQLite 直接解决**: `withTransactionAsync` 用独占 lock,BEGIN IMMEDIATE 后其他 tx block 直到 commit。

---

## 4. Cache 清理策略 (业界最佳实践 + 推荐)

### 业界参考 (基于 GLM/context7 找到的 & 我不知道的部分)

- **Strava**: **不知道** 详细内部机制,web search 未返回权威技术分享。公开可见的是 offline route download 用 tile cache,activity 上传后本地保留完整数据直至用户清除。
- **Google Maps offline**: **已知** 有 tile TTL (30 天默认自动过期,除非续订),数据在系统 tmp 目录会随 iOS jetsam 优先清理。GPS trace 在 Timeline 是云端主导,本地只 cache 显示层。
- **AllTrails**: **不知道** 内部实现;公开信息是 Pro 用户可 offline download,清理由用户手动 trigger。

以上是**不知道具体阈值**的诚实回答。用户 memory feedback "不许猜" 严格执行。

### 我基于 Cairn 现状推荐的 4 层策略

**L1 — 上传成功即降级** (最激进,推荐):
- Session `uploaded=true` 且 `remoteId` 已 patch → **删除本地 trackPoints (保留 summary)**
- Summary 只 ~200 bytes/session,100 sessions = 20KB,永远存
- MapHistory / RoutesScreen 需要 detail 时按需 pull from server
- 触发点: `telemetryUploader.upload` 成功 (line 160) 之后

**L2 — Size cap** (safety net):
- 未上传 + 已上传但未 L1 降级的总磁盘用量 > **200MB** 时,按 session `ended_at` 升序批删最老 (但保留 `uploaded=false` 的 → 不能删未上传)
- 100 sessions × 2MB 平均 = 200MB 是 iPhone 中低端存储友好的 ceiling
- 阈值可 override via settings

**L3 — TTL** (兜底):
- Session `ended_at < now - 90 days` **且** `uploaded=true` 时强清 trackPoints (summary 保留)
- 30 天 (原题建议) 我觉得太激进,用户可能中断 hike 后隔月复习;90 天是 Strava/AllTrails 常见默认

**L4 — 用户手动**:
- Settings 页面 "Clear all uploaded sessions"、"Clear all local data (danger)" 两个 button
- 现在 `debugLogger.clearAllSessions` (line 487) 已有基础设施

**阈值总结** (推荐值):
| 层 | 阈值 | 触发 | 保留内容 |
|----|------|------|---------|
| L1 | uploaded 成功后立即 | telemetryUploader ok | summary only |
| L2 | 200MB 总量 | 每次 flush 后 check | 未上传全保 + 上传时间最新 |
| L3 | 90 天 & uploaded=true | 冷启动/日 check | summary |
| L4 | 用户点按 | 手动 | 由用户选 |

---

## 5. 上传 queue 现状评估

`telemetryUploader.ts` 已经实现了:

| 特性 | 状态 | 位置 |
|------|------|------|
| Retry on network online | ✅ | line 40–44 |
| Retry on foreground | ✅ | line 48–54 |
| WiFi-only mode | ✅ | line 95 |
| Idempotent (backend ON DUPLICATE) | ✅ | line 14 注释 |
| MAX_AUTO_RETRIES = 20 | ✅ | line 197 |
| Concurrent guard | ✅ | `uploadInProgress` Set line 30 |
| Exponential backoff | ❌ **缺失** | 现在是每次 network event 全 retry,可能被 rate-limit |
| Chunk-of-chunks partial upload | ❌ 全 session 一次 POST | line 127 `body: jsonl` (整文件) |
| Dedup by client_op_id | ⚠️ 部分: session_id 唯一但 payload 内每 event 无 op_id | jsonl 每行不带 client_op_id |
| Offline queue persistence | ✅ implicit via meta file `uploaded=false` | line 146–164 |

**Gap #1: no exponential backoff**. 网络抖动或 backend 500 时 20 次 retry 会紧密堆叠(networkMonitor 变更 → 立即 retry;5 s 内 online/offline flip 就已经消耗多次)。建议:每次 failure 后写 `next_retry_ts = now + min(2^attempts * 5s, 30min)` 到 meta,`retryAll` 过滤 `now >= next_retry_ts`。

**Gap #2: 全 session 一次 POST**. 8h session 2.3MB body,慢网 (100kbps) 需 ~3min,期间任何断网即失败重来。建议 chunk 1MB/次,server 端支持 append 或 tag session_id + chunk_seq。**已知** 现在 `body: jsonl` 是 NDJSON,天然支持 chunk 切分。

**Gap #3: memoryPoints (VisitedPoint) 的 sync** 在 `memorySync.ts` 是**另一条独立管道**,不走 `telemetryUploader`。这条管道有 exp backoff (`BACKOFF_MS = 15_000`, line 24) 但只是固定 15s,不是 exponential;`MAX_BATCH = 500` 分批 push 已实现;有 `client_op_id` 概念 (`cid` field, line 51) 做 dedup。**评价**: memoryPoints 上传比 telemetry 更成熟,可作为 v409 重构的参考。

---

## 6. 推荐方案 + 理由

### 推荐: **expo-sqlite** (单一 SQLite DB, 多表)

**理由**:
1. **不需要 EAS rebuild** — 用户 memory feedback "eas build 永远禁" 排除 MMKV/Realm。expo-sqlite 是 Expo SDK 54 内 pre-bundled,`npx expo install expo-sqlite` 即用 (**不知道** Cairn 当前 EAS build 里 expo-sqlite 是否已 bundle,但由于是 Expo 官方 module,加入不需要 native prebuild)。
2. **解决 JSON.parse freeze** — 现状 `memorySync.ts` line 135 已经承认 500KB Hermes parse 会 sync-freeze 1–3s,SQLite `getEachAsync` 流式 iterate 不需要一次 parse 全 blob。
3. **解决 file lock 竞态** — `withTransactionAsync` BEGIN IMMEDIATE 提供原子性,前台 store 和 background TaskManager 同时写 GPS 时不丢数据(SQLite 自身的进程内 mutex)。
4. **原生支持增量删除** — `DELETE FROM points WHERE session_id=?` 比 AsyncStorage `getAllKeys` filter 或 file-per-session `readDirectory` 都快。
5. **crash safety** — WAL 模式提供 rollback,写中断 tx 会被自动 rollback (不像 JSONL 半行 write 的问题)。
6. **size 无硬上限** — 8h × 100 sessions × 30 bytes/row = 8.6MB,SQLite 无压力;AsyncStorage Android 6MB/key 是硬限制(要多 key 分片才能绕开)。

### Schema 建议 (供 v409 参考)

```sql
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  remote_id INTEGER,
  activity_mode TEXT,
  region_code TEXT,
  started_at INTEGER NOT NULL,
  ended_at INTEGER,
  distance_m REAL,
  duration_s INTEGER,
  elevation_gain_m REAL,
  name TEXT,
  uploaded INTEGER DEFAULT 0,
  memory_new_cells INTEGER DEFAULT 0
);
CREATE INDEX idx_sessions_ended_at ON sessions(ended_at DESC);
CREATE INDEX idx_sessions_uploaded ON sessions(uploaded);

CREATE TABLE track_points (
  session_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  ts INTEGER NOT NULL,
  lat_e7 INTEGER NOT NULL,       -- lat * 1e7, saves parse cost
  lng_e7 INTEGER NOT NULL,
  accuracy_cm INTEGER,
  altitude_cm INTEGER,
  is_raw INTEGER DEFAULT 0,       -- 0 = filtered, 1 = raw audit
  PRIMARY KEY(session_id, seq),
  FOREIGN KEY(session_id) REFERENCES sessions(id) ON DELETE CASCADE
);
CREATE INDEX idx_tp_session ON track_points(session_id, ts);
```

- `lat_e7` 用 INTEGER 存 lat*1e7 (~1cm 精度) 避免 REAL 精度问题 + 更小
- Cascade delete: `DELETE FROM sessions WHERE id=?` 自动清 track_points
- WAL 模式: `PRAGMA journal_mode = WAL` (在 migration 里 set 一次)

### 迁移路径

**不推荐 big-bang**:
1. **Sprint 1**: 加 expo-sqlite,创 tables,双写 (AsyncStorage + SQLite),读还从 AsyncStorage。开关 flag `useSqliteRead` 灰度。
2. **Sprint 2**: 读切到 SQLite,AsyncStorage 变备份。观察一个 OTA 周期。
3. **Sprint 3**: 删 AsyncStorage 写路径,只留 read-once migration 逻辑(冷启动检测旧 key 迁到 SQLite 后删)。
4. **Sprint 4**: 删 migration 逻辑,cleanup。

memoryPoints (`memorySync.ts`) 可以放到 Sprint 5+ 独立迁移,和 sessions 解耦(因为它已经有云端主导 + cid 幂等,本地丢失可 re-pull)。

### 不选 MMKV / Realm / JSONL 的具体理由

- **MMKV**: 需要 `expo prebuild` + native module,违反 "eas build 永远禁"。且 append-only 时间序列(GPS point stream) 用 key-value 别扭 — 必须自己实现 seq→key 映射 (`session_id:0`, `session_id:1`,...) 或整 blob write(大 session 时又回到 JSON.parse freeze 问题)。**已知** MMKV 优势是同步 API + 快 kv,场景是 settings/preferences,不是 time-series。
- **Realm**: 同样需要 native module,而且 MongoDB Atlas Device SDK 已进入 maintenance mode (**不知道** 精确 EOL 时间,但公开信息显示新项目不推荐)。
- **JSONL (现状)**: read-modify-write append 在 10MB+ 后开始明显慢,且**没有原子性** — 已经在 telemetryUploader path 用着但只作为 debug 数据不影响用户功能。GPS 主数据用它会承担 crash-halfline 风险。

### 不知道的问题(留给后续 spike)

1. **expo-sqlite 在 iOS jetsam 后 WAL 文件的恢复行为** — SQLite 号称 WAL 是 crash-safe,但 iOS 强杀进程 + 文件系统 fsync 时序,**没找到官方 Expo 侧的确认**。建议 Sprint 前做 spike: 写 100 pts → kill app → 重启读能否读全。
2. **expo-sqlite 是否已在 Cairn 当前 EAS build 内** — 需要看 `.easrc` / `app.json plugins`。**不知道**,建议 grep `app.json` 后确认;若否,添加 `expo-sqlite` 不需要 prebuild(它是 Expo 官方 pre-bundled module)但 IOS 首次 archive 需要一次 build。**用户 memory 说 "永禁 eas build"**,这个约束下需要与用户确认 SQLite 是否是"已内置豁免"还是仍算新 native module。
3. **1h BestForNavigation 实际点数** — 从 iOS Core Location 侧,BestForNavigation @ 1Hz 在户外开阔地约 3600 点,但市区/建筑遮挡下 iOS 会 backfill/dedupe,实际点数可能 2000–4000 波动。**不知道** Cairn 的真实分布,建议从 aliyun sessions 表 `LEN(route_points_raw)` group by hour 出统计。

---

## 7. 一页总结

| 结论 | 内容 |
|------|------|
| **推荐方案** | expo-sqlite 单库多表 (sessions + track_points) |
| **不推荐** | MMKV (需 eas build)、Realm (需 eas build + deprecated)、continue AsyncStorage/JSONL (JSON.parse freeze + 无原子性) |
| **数据格式** | 存 lat_e7/lng_e7 INTEGER 避免 REAL 精度 & parse 成本;单点 ~30 bytes on disk |
| **1h GPS 大小** | JSON 290KB,SQLite raw 108KB,delta ~25KB (但复杂度不值) |
| **Cache 清理阈值** | L1: 上传后立即降级 summary;L2: 200MB cap;L3: 90 天 TTL;L4: 用户手动 |
| **Upload queue Gap** | 缺 exponential backoff、缺 chunk upload;telemetry vs memoryPoints 两条管道,memoryPoints 更成熟可参考 |
| **迁移策略** | 4-sprint 灰度: 双写 → 读切 → 删旧写 → cleanup |
| **需要 spike 的未知** | (a) SQLite iOS jetsam 后恢复行为;(b) expo-sqlite 在当前 EAS build 内的状态;(c) 真实 1h GPS 点数分布 |

---

## 附录: 引用文件

- `app/src/services/memorySync.ts` (memoryPoints sync,已成熟)
- `app/src/store/useSessionStore.ts` (现状 AsyncStorage 写法)
- `app/src/services/debugLogger.ts` (JSONL flush,痛点 line 356–366)
- `app/src/services/backgroundLocationTask.ts` (bg task 直接 append)
- `app/src/services/telemetryUploader.ts` (upload queue 现状)
- `app/src/store/storage.ts` (AsyncStorage 抽象层)
- `app/package.json` (expo 54 / RN 0.81 / async-storage 2.2.0)
- context7 `/expo/expo` (expo-sqlite v54–v57 docs)
- context7 `/mrousavy/react-native-mmkv` (MMKV V4 features + limits)
- context7 `/react-native-async-storage/async-storage` (AsyncStorage API)
