# Sessions 关键路径深读（2026-07-19）

范围: `backend/src/routes/sessions.js`, `middleware/idempotency.js`, `lib/deterministicCid.js`, `models/Session.js` + 前端 `hikeTrackWriter.ts`, `hikeTracksCache.ts`, `syncDaemon.ts`, `pendingSyncStore.ts`, `offlineQueue.ts`, `useSessionStore.ts`, `useTrackingStore.ts`, `sessionService.ts`。全函数级阅读,只报**可能上线 crash / 数据丢 / 静默错行为**的问题。

---

## 数据流一致性

### 前端 `saveHikeAtomic` payload → 后端 `PATCH /:id/save`

| 字段 | 前端 (sessionService.ts:200-208) | 后端 (sessions.js:216-270) | 一致性 |
|---|---|---|---|
| `end_time` | ISO 8601 string | `Date.parse` 校验 | ✅ |
| `distance_m` | number | `typeof === 'number' && >=0` | ✅ |
| `duration_s` | number | `typeof === 'number' && >=0` | ✅ |
| `route_points[i]` | `{lat, lng, t}` | 校验同名 3 字段 `-90/-180` bounds | ✅ |
| `route_points_raw[i]` | `{lat, lng, t, acc?}` | 校验 lat/lng/t, 允许 acc | ✅ |
| `memory_points[i]` | `{lat, lng, ts}` | 校验 lat/lng/ts, 要求 `ts` 是**整数** | ⚠️ 见 Blocker #2 |

### `PATCH /append-points` (v411 flow) → `Session.appendPoints`

前端发 `{ points, client_op_id }`(sessionService.ts:113), 后端 idempotency middleware 读 header 优先、body fallback。**匹配**。

### `X-Idempotency-Key` vs `body.client_op_id` 一致性

- v412 `saveHikeAtomic` 用 header (sessionService.ts:230)
- v411 `appendPoints` / `finalizeSession` 用 body `client_op_id` (sessionService.ts:113, 159)
- middleware 两者都读, header 优先 (idempotency.js:32-42)
- 混用无问题 ✅

---

## 错误处理漏洞(严重级别排序)

### 🔴 Blocker

**B1. `useTrackingStore.stopTracking` 会永久静默丢已 flush 的 memory_points (useTrackingStore.ts:939-943)**

```ts
if (cids.length > 0 && typeof useMemoryStore.getState().markPointsSyncedByCid === 'function') {
  useMemoryStore.getState().markPointsSyncedByCid(cids);
}
} catch (markErr) {
  crashLogger.breadcrumb(`v412:mark_synced_failed ${String(markErr).slice(0, 60)}`);
}
```
服务器 `save-hike-atomic` 已经把 memory 落库 (accepted=N), 但 client 端 `markPointsSyncedByCid` 若 throw 或方法不存在, breadcrumb 完就走了。下次 `pushMemoryNow` 会**再上传一遍**同一批 cid。deterministicCid 里 `crypto.sha1(userId|ts|lat|lng)` 对同一点稳定 → ON DUPLICATE KEY 会兜住,但 client 侧永远显示"未同步"、走无休止 pending 循环。建议: mark 失败必须写一个 retry marker,不能只 breadcrumb。

**B2. `sessions.js:266-270` memory_points 超过 1000 直接 400,client 无分片逻辑**

```js
if (memPts.length > 1000) {
  return res.status(400).json({ error: 'memory_points batch too large (max 1000).' });
}
```
在 `useTrackingStore.ts:897-899` 采样:
```ts
const memoryUnsynced = useMemoryStore.getState().points
  .filter(...)
  .map(...)
```
**无 slice/chunk**。一次长 hike 累积 unsynced > 1000 (Memory 每 30s 一个 H3 cell = 3h 就有 360;累积多次未同步 hike 会超) → 服务器 400 → catch 走 pendingSyncStore → SyncDaemon 用同一个 idempotencyKey 再 retry → 服务器再 400 → 幂等 cache 记录 4xx? 不,idempotency.js:85-86 **只 cache 2xx**,所以 SyncDaemon 每次都真跑 → 每次 400 → **永远上不去,pendingSyncStore 永远清不掉**,直到用户长按放弃。⚠️ 用户没有 UI 反馈"为什么这条一直灰"。

**B3. `sessions.js:339-348` memory_points `ts` 要求 `Number.isInteger`**

```js
!Number.isInteger(p.ts) || ...
```
但 `useMemoryStore` 里的 `p.ts` 是**从内存 Date.now() 生成**,前端 useTrackingStore.ts:899 用 `Math.floor(p.ts)` 补救。若某个上游代码路径生成了 `Date.now() + Math.random()` 或 `performance.now()` 派生的浮点 ts → **单点 reject 无致命**,但 rejected 计数被计入 accepted/rejected 也不告诉用户哪个字段错。前端凭 `memory.rejected` 也无法定位。中级 warning; 但结合 B1、这些 rejected 点永远不会被 mark synced → 每次 hike 都尝试重传相同的坏点。

**B4. `hikeTrackWriter.ts:262-292` flushBuffer 的 read-modify-write 有 GC 雪崩风险**

```ts
let existing = '';
try {
  const info = await fs.getInfoAsync(activePath);
  if (info.exists) existing = await fs.readAsStringAsync(activePath);
} catch { /* best effort */ }
await fs.writeAsStringAsync(activePath, existing + lines);
```
注释自己已经说了: "30s buffer × 1h = ~120 flushes, each concat writes O(file_size). For 1h/3600pts file (~350KB), each write is 350KB × 120 = manageable." **不 manageable**。8 小时 hike ≈ 28800 点, 文件 ≈ 2.8 MB, 每 30s 读 + 拼 + 写 2.8MB, iOS 后台 RAM 峰值可能触发 jetsam。且**读失败落到空字符串会静默清空整个文件** (`existing = ''` fallthrough + `writeAsStringAsync(existing + lines)` 覆盖原文件)。若 read 失败原因是磁盘临时锁而不是不存在 → **前 N 小时数据一次性丢**,catch 只吞异常无信号。

**B5. `useTrackingStore.ts:918-931` wall-clock timeout 用 setInterval 保护 race 有泄漏**

```ts
v412Result = await new Promise<any>((resolve, reject) => {
  let done = false;
  const timer = setInterval(() => { ... }, 500);
  saveHikeAtomic(...).then(...).catch(...);
});
```
若 `saveHikeAtomic` 的 promise 永不 resolve/reject (fetch stuck on iOS OS suspend), timer 只做 20s 超时后 reject,fetch 底层的 XHR/AbortController **没有** abort。之后 20s 内 iOS 恢复,原 fetch resolve → **v412Result 已经被 reject,但 fetch response 已经写入服务器** → server 已经 finalize,client 走 pendingSyncStore + 用同 idempotencyKey retry → idempotent replay 会兜住(200 + memory: {accepted: 0, rejected: 0}) → 但 SyncDaemon 拿到 accepted=0 认为**这次上传"没有 memory 点"**, 但服务器上传其实第一次已经全落。B1 的 mark synced 就永远不会跑。**结果:memory 数据在服务器有,client 显示未同步,永远。**

---

### 🟡 Warning

**W1. `offlineQueue.ts:284-288` uuidv4 用 Math.random**

```ts
'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
  const r = (Math.random() * 16) | 0;
```
注释说"realistic queue depth of dozens of ops"。但 offlineQueue 的 opId 也可能被 v411 finalize 用来做 idempotency key。middleware.js:25 UUID_RE 严格,uuidv4 生成一定通过。但 Math.random 不是加密安全,如果 3 台设备同时冷启走 background drain,理论上有低概率碰撞 → 服务器 idempotent replay 把 A 的 payload 响应返给 B。低概率 warning。

**W2. `pendingSyncStore.ts:180-186` markAttempt 无 attempt 上限**

```ts
hike.attemptCount = (hike.attemptCount || 0) + 1;
await fs.writeAsStringAsync(path, JSON.stringify(hike));
```
`offlineQueue.ts` 里 `MAX_ATTEMPTS=8` 后 drop,但 pendingSyncStore **永远重试** (注释"用户已点 Save 的数据永远不丢")。如果 payload 因某个 field 永远被服务器 400 拒 (B2/B3 场景),pendingSyncStore 里的这条会**每次 drainPending 都跑一次网络请求**,DoS 自己服务器。建议对 attemptCount > 100 之类的走一个"警告状态"提示用户查看。

**W3. `useSessionStore.ts:157-160` orphan trackpoint keys 永远清不掉**

```ts
// Note: trackpoints keyed per-session-id are not enumerable on AsyncStorage
// without listing all keys. They become orphaned but unreachable since
// sessions list is gone.
```
`clearSessions()` (logout 触发) 只删 summary key,per-session trackpoint 键孤儿。长期累积 AsyncStorage 会膨胀 (每 session ~150KB × N)。iOS AsyncStorage 硬限 6MB,理论上可以塞满卡住 setItem。已知 workaround: `getAllKeys()` filter。

**W4. `useTrackingStore.ts:791` too-short 判定用 `s.distanceM < 20`**

```ts
if (s.trackPoints.length < 2 || s.distanceM < 20) { ... 丢 }
```
但 addTrackPoint 里 line 1217 `if (addedDistance > 200) addedDistance = 0` — 一次 GPS 巨跳 > 200m 会不计入 distanceM。如果用户在有严重 GPS glitch 的地方走了 30 分钟,teleport gate + 200m clamp 联合作用让 distanceM 保持在 < 20m → **合法长 hike 被判 too-short 丢弃**。发生概率低但真实(高楼峡谷 + iOS SDK 特定 bug 可以复现)。

**W5. `hikeTracksCache.ts:150-170` enforceSizeCap 不考虑 pending 状态**

```ts
const uploaded = files.filter(f => f.uploaded).sort((a, b) => a.ended_at - b.ended_at);
```
只删 `uploaded=true` 的。但如果全部 completed 都 uploaded=false (pendingSyncStore 堵着) 且总 size > 300MB,函数**啥都不删**,继续增长。极端: 用户离线走了 200GB hike (夸张) → 磁盘满。中级 warning。

---

## 边界条件问题

### 时间/时区
- `sessions.js:227` `isNaN(Date.parse(end_time))`: 接受 `"2026-13-45T99:99:99Z"` (Date.parse 部分浏览器 tolerant) → 落库 `Invalid Date` MySQL 存 `0000-00-00 00:00:00` 或 NULL。后端 v3.3 判 finalize 时 `new Date(rows[0].end_time).getTime() = NaN`,`Number.isFinite(endTs)` 为 false → alreadyFinalized 判 false → 允许重复 save。**极端 client 时钟错乱可能双写**。

### GPS 坐标边界
- v412 严格 -90/-180 (sessions.js:243, 258) ✅
- 但 `Session.findByIdAndUser` (Session.js:65) 老数据没 v412 校验,DB 里可能有污点。GET 出来给 rendering,不 crash 但地图会跳到南极。

### 数值精度
- `deterministicCid.js:16`: `lat.toFixed(7)`。若 lat=1e-8 之类极小 → toFixed(7) = "0.0000000",信息丢失。同一用户 (userId=1, ts=T, lat=1e-8, lng=1e-8) 与 (userId=1, ts=T, lat=2e-8, lng=2e-8) 产生**相同 cid** → ON DUPLICATE KEY 会覆盖。真实场景不会有 1e-8 度的点,警告级。

### 空数组/null
- `hikeTrackWriter.ts:342`: `metas.sort((a, b) => b.started_at - a.started_at)` — 若 `started_at` undefined (磁盘 meta 破损但通过基本 sanity), 排序结果 NaN → 顺序不可预测,可能拿到错误的 activeHike。
- `pendingSyncStore.ts:151-153`: sanity check 只查 `localId + payload` 存在,不查 `remoteId/idempotencyKey/activityMode` → syncDaemon `uploadOne` line 61 `if (!hike.remoteId)` fallback 到 startSession,但若 `idempotencyKey` 也是 undefined → server 无 header,middleware readIdempotencyKey 返 null → 走非幂等分支 → 重复 finalize 服务器 error。

---

## v412 事务边界

### 前端 syncDaemon vs 后端 idempotency
- syncDaemon.ts:76 `saveHikeAtomic(remoteId, payload, idempotencyKey)` 用**存磁盘的 idempotencyKey** retry ✅
- 但 syncDaemon.ts:60-73 startSession 走 `sessionService.startSession`,里面**每次生成新 opId** (sessionService.ts:111) — 那是 v411 legacy 路径,startSession 不用 client_op_id header,middleware 依赖 body。检查 sessionService.ts:83-98:
```ts
export async function startSession(type, startTime) {
  const res = await authenticatedFetch('/api/sessions/start', {
    method: 'POST',
    body: JSON.stringify({ type, start_time: startTime }),
  });
```
**没有 client_op_id**! 后端 sessions.js:83 `router.post('/start', authenticate, idempotency, async...)` 挂了 idempotency 但收不到 key → 每次都真建行。syncDaemon retry 每次会创建**新的空 session 行**,只有最后成功那次的 remoteId 被 updateRemoteId 覆盖存磁盘,之前建的孤儿行永远留在 DB。**已上生产**,建议 warning。

### 1000 memory_points 中途断网
- `sessions.js:353-362` CHUNK=50 分片 INSERT,一个大 transaction。若第 5 chunk 断连,`await conn.commit()` 前 throw → rollback → sessions 表也不 update finalized_at → 前端 catch 走 pendingSyncStore → 用同一 idempotencyKey retry → alreadyFinalized 判 false → 全套重跑。✅ 正确。

### 前端 saveHikeAtomic timeout 中途成功(见 B5)
上述已述。

---

## 性能陷阱

### P1. `useTrackingStore.addTrackPoint` 每点重建整个 state
line 1223-1233:
```ts
return {
  trackPoints: [...s.trackPoints, rawPoint],
  trackPointsSmoothed: [...s.trackPointsSmoothed, smoothedPoint],
  trackPointsRaw: [...s.trackPointsRaw, rawPoint],
  ...
};
```
Zustand set 触发订阅重渲染。HikingScreen 若用 `useTrackingStore(s => s.trackPoints)` 每秒 1 次 re-render,长 hike 有 30000 点 array 展开 O(N) → 后期每次 addTrackPoint 会阻塞主线程 100ms+。若订阅是 `useTrackingStore(s => s)` 更严重。需检查 HikingScreen 具体订阅粒度(未在本次 audit 范围内)。

### P2. `hikeTrackWriter.flushBuffer` O(file_size) 每 30s
B4 已述。属于性能+可靠性双重问题。

### P3. `useTrackingStore.ts:1240-1256` 每 addTrackPoint 一次 require(hikeTrackWriter)
```ts
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { appendHikePoint } = require('../services/hikeTrackWriter');
  appendHikePoint({...});
}
```
`require` 在 Metro 里 cached 后开销小,但**每点** try/catch 有开销。1Hz sampling × 8h = 28800 次。建议 hoist 到模块顶。

---

## 演进遗留(v409-v416)

### R1. `offlineQueue` (v78/v409) vs `pendingSyncStore` (v412) 双存在
- offlineQueue: 保存 raw HTTP op (session_start / session_append / session_finalize / marker_create), AsyncStorage
- pendingSyncStore: 保存 PendingHike (含完整 payload + idempotencyKey), expo-file-system

v411 legacy 路径 (addSession 里的 POST /api/sessions) 若失败,catch 无入 offlineQueue → 静默丢? 检查 useSessionStore.ts:149-151:
```ts
}).catch(() => {
  // Network failure — session remains in local store without remoteId
});
```
**是的,失败啥都不做**。v411 legacy 路径已经不是主路径 (session.remoteId 通常已 set → early return line 107),但 hike **同时开始时无网** (无法 startSession),`remoteId` 是 undefined,走 addSession 时 line 107 `if (session.remoteId != null) return;` **不 return**,走 POST/api/sessions,失败 → catch 静默 → 数据只在 local storage。但 v412 stopTracking 路径 (useTrackingStore.ts:967-986) 已经把它写入 pendingSyncStore 了,所以数据双落地不会丢。**但 addSession 里再 catch 一次的 fetch 是浪费的重复请求**。

### R2. `finalizeSession` (v411) 与 `saveHikeAtomic` (v412) 并存
sessionService.ts:143 `finalizeSession` 还在,addSession 里的 POST 也在。v412 useTrackingStore 从不调 finalizeSession(useTrackingStore.ts:882 注释确认),但代码仍导出,offlineQueue 里可能残留旧 op `session_finalize`(v411 时用户已下线的 op 冷启后 drain 时可能触发)。这条路径若跑,和 v412 alreadyFinalized 判定协作 OK (server 兜住),但**同一 hike 会被 finalize 两次**,浪费。

### R3. `useSessionStore.addSession` (line 107) 兼容路径可以清理
`if (session.remoteId != null) return;` — v412 都会带 remoteId(saveHikeAtomic 成功)或走 pending(不进 addSession)。理论上永远 return。留着有历史包袱。删了会更安全。

---

## Top 10 Hidden Bug(按严重度)

1. **[Blocker] hikeTrackWriter.ts:272-277** — flushBuffer read 失败静默清空整个 hike JSONL 文件, catch 只吞异常。8h hike 长文件 + 磁盘临时锁 = 一次性丢数据。
2. **[Blocker] useTrackingStore.ts:897-899** — memory_points 采样无 chunk, 单次 hike unsynced > 1000 时 sessions.js:268 直接 400, pendingSyncStore 用同 idempotencyKey 无休止 retry, UI 灰卡永远不消。
3. **[Blocker] useTrackingStore.ts:918-931** — saveHikeAtomic wall-clock 20s timeout 后不 abort 底层 fetch, 实际服务器已 finalize 但 client 走 pendingSyncStore, 重试拿 idempotent_replay accepted=0 → memory 点永远 client 端不标 synced。
4. **[Blocker] useTrackingStore.ts:939-943** — markPointsSyncedByCid throw 后只 breadcrumb, 无 retry 机制, memory 永远显示未同步。
5. **[Blocker] sessions.js:290-294** — endTs 用 `Number.isFinite` 判 alreadyFinalized, Date.parse 接受非法日期时 endTs 为 NaN 导致 finalize=false, client 时钟错乱可绕过幂等重写数据。
6. **[Warning] sessionService.ts:83-98** — startSession 不带 client_op_id, syncDaemon retry 每次都新建空 session 行,生产 DB 已积累孤儿。
7. **[Warning] pendingSyncStore.ts:180-186** — markAttempt 无上限,payload 400 永错时 DoS 自己后端。
8. **[Warning] useTrackingStore.ts:791** — distanceM<20 too-short 判定 + 200m clamp 联合作用可能丢弃合法长 hike(高楼峡谷 GPS glitch 场景)。
9. **[Warning] useTrackingStore.ts:1223-1233** — addTrackPoint 每次展开三个 array, 长 hike 后期主线程阻塞。
10. **[Warning] hikeTracksCache.ts:150-170** — enforceSizeCap 只删 uploaded=true, pending 堆积时磁盘无兜底。

---

## 建议下一步

**立即修 (上线前必修)**: B1、B2、B3、B5
**下 sprint 修**: B4 (需要一套 chunked JSONL 或 native append via new expo-file-system API)、W2、W5
**长期整理**: R1-R3 v409/v412 冗余路径清理
