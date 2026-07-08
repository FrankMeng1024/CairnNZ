# v412 — Save-Hike 原子事务重构方案 (v3.3, 实现前最终版)

**Date**: 2026-07-07
**Author**: main agent, 用户九轮 PM 语言校准 + 5 轮 subagent 4-eye review 后落地
**Status**: DESIGN v3.3 — 已通过两轮独立 subagent 4-eye review, 进入实现
**版本历史**:
- v1-v3: 早期迭代, backend + mobile 反复 REJECT
- v3.1: 承认 iOS 技术悖论, 简化到统一 Modal 恢复
- v3.2: mobile 第四轮补 Modal 关闭规则 + location task 冲突修
- v3.3 (本版): 第五轮 review 两个 subagent 都 APPROVED_WITH_CHANGES, 6 个实现细节全部修入

---

## 0. 用户校准过的产品契约 — 铁律 (违反此表任何一条 = 违规)

### 0.1 Save-hike 事务范围
1. 一次 Save 按钮 = 一次原子操作, 要么全成一起, 要么全不发生
2. 事务包含 4 件事 (仅此 4 件, 不多不少):
   - a. 原 GPS 点 → 服务器 `sessions.route_points_raw`
   - b. Snap 后 GPS 点 → 服务器 `sessions.route_points`
   - c. Activity 元数据 → 服务器 `sessions` (end_time, distance_m, duration_s, name)
   - d. Memory 解锁 → 服务器 `memory_points` 批量

### 0.2 Save 时的 UI 契约
3. 界面只显示一个 "Save" 按钮, 不区分 online/offline
4. 后台判定当前网络, 用户完全无感
5. 点 Save → 显示 "数据整理中" spinner (阻塞式, 不允许 back)
6. 服务器 200 → 弹回 Home
7. 20s timeout 到 or offline → 走本地暂存分支, 弹回 Home, Home 显示温和 pending 提示
8. Save 后一律弹 Home (任何分支都是)

### 0.3 hike/run 进行中的磁盘 backup 规则 (与 Strava 一致)
9. hike/run 进行中每 30s / 每 50 点写 GPS 到磁盘 backup:
   - `cairn-hike-tracks/active/<sessionId>.jsonl` (hike)
   - `cairn-run-tracks/active/<sessionId>.jsonl` (run)
10. **磁盘上 unfinished backup (即 `active/` 目录) 最多同时存在 1 条 hike + 1 条 run**, hike/run 各自独立
    - **v3.3 澄清 (mobile subagent M3)**: 此"1 条限制"**只针对 `active/` 目录里的 unfinished backup**, **不包括** pendingSyncStore 里已 Save 未同步的 hike (§0.9)
    - 两套存储独立计数: 用户可以同时有 1 条 unfinished + 5 条 pendingSync 未同步的 hike, 都存在磁盘上, 不冲突

### 0.4 善终 vs 未善终 (关键定义)
11. **善终**: 用户主动点了 Save (在线成功 or 离线暂存到 pendingSyncStore) 或 Cancel/Discard
12. **未善终**: 其他任何原因结束 (系统 jetsam / 用户主动杀 app / crash / 手机没电)
13. 善终 → 立刻删对应 backup 文件
14. 未善终 → backup 保留在磁盘, 等冷启动/进 hike run 界面时按下列规则处理

### 0.5 Unfinished 活动恢复规则 (v3.1 核心, v3.2 补关闭行为)
15. **弹窗时机**: 用户从 Home 点 Hiking/Running 卡 → **先跳转到 hiking/running 界面**, 界面完全渲染 → **然后**在界面上叠一个 Modal 弹窗 (不同 z-index 层, 覆盖式)
16. **弹窗触发条件**: 进入界面时, 检测对应类型 (hike or run) 是否有 < 72h 的 unfinished backup
17. **弹窗内容**:
    ```
    上次 hike/run 未完成
    已走: X.X km
    时长: XX 分钟
    最后记录: X 小时前 / X 天前
    [继续这条]  [丢弃]
    ```
    不显示 GPS 坐标 / 地名, 只展示时长 + 距离 + 相对时间
18. **[继续这条]**: 从磁盘读 GPS 回内存 → Modal 消失, hiking/running 界面正常运作 (Start 按钮变 Pause 之类), GPS 继续录, 后续走的加到这条
19. **[丢弃]**: 立即删除对应 backup 文件 → Modal 消失, hiking/running 界面回到干净状态, 用户可以点 Start 开新的
20. **hike/run 各自独立**: 用户点 Hiking 只问 hike 的 backup, 点 Running 只问 run 的 backup, 两类互不干扰 (Cairn tracking store 系统性一次只能一个 activity, hike/run 互斥)
20a. **Modal 强制选择 (v3.3 用户校准修正)**: **用户必须明确点 [继续这条] 或 [丢弃] 才能关闭弹窗**:
    - iOS 左边缘 swipe / Android 硬件 Back / tap Modal 外空白区域 → **全部无效, 弹窗不消失, backup 不动**
    - 只有 [继续这条] 或 [丢弃] 两个按钮生效
    - 例外: 用户按 iOS Home 键切后台 → 不算关闭, Modal 保留状态, 回来还是这个 Modal
    - 目的: 避免"我关一下想想"的中间态导致数据丢失, 强制用户在两个明确选项中选一个

### 0.6 Unfinished backup 时间分段清理 (v3.2 措辞澄清)

**注意: "unfinished backup" 和 "pendingSyncStore" 是两套完全不同的磁盘存储, 有各自的生命周期规则, 不要混淆:**

**Unfinished backup** (`cairn-hike-tracks/active/` + `cairn-run-tracks/active/`):
- 用户**没点过 Save** 的 in-progress hike/run GPS 增量
- 用户没表达"我要保存"意愿, 系统只给 72h 抢救窗口
21. **< 72h 的 unfinished**: 进对应界面时弹恢复对话框问用户
22. **≥ 72h 的 unfinished**: App 冷启动扫描时**静默删除**, 不弹, 不提示
23. **磁盘目录 > 100 文件 或 > 100 MB 兜底**: 强制清理最旧的 + 弹一次警告

**pendingSyncStore** (`cairn_pending_sync_<localId>.json`):
- 用户**已点过 Save** 但网络暂时不通的完整 hike (包含 raw + snapped + memory)
- **72h 规则不适用 — 用户已表达"我要这条"意愿, 数据永久保护, 直到:**
  - **服务器 200 成功** → 自动删本地, 卡片变正常
  - **用户长按灰卡菜单选"放弃这条"** → 立即删本地, 卡片消失
- 不管网络多久没恢复 (一周 / 一个月 / 一年), 只要 app 还能打开, 那条 hike 就一直在灰卡里等
- 后台每次能上网就自动重试, 失败继续等, 直到二者之一发生

### 0.7 空窗期 UI (与 Strava/AllTrails 一致)
24. iOS jetsam → 复活期间的 5-15min GPS 空窗期是物理事实, 无解
25. UI 静默直线连接两端, 不画虚线, 不加提示 (与 Strava/AllTrails 一致)

### 0.8 位置权限教育
26. 首次 hike 前, 检测 iOS 权限档位, 若非 "Always Allow" → 一次性教育弹窗 → 引导用户升级
27. 记录 hasSeenLocationEducation flag, 不重复弹

### 0.9 已 Save 未同步的 hike (核心 offline 保证)
28. 一旦用户点过 Save (无论在线离线), 数据永远不丢, 直到成功上传
29. 离线 Save → 全部数据 (raw + snapped + memory) 写磁盘 (pendingSyncStore, 每 hike 一个文件)
30. App 冷启 / 网络恢复在线 / 前台从后台回来 → SyncDaemon 自动扫描, 后台上传, 用户无感; 上传失败 (5xx / 超时 / 网络) → 保留 pending, 下次机会继续重试, 直到成功 or 用户手动放弃 (§0.9 第 34-35 条)
31. **Activity 列表展示离线 hike 卡片**: 卡片正常出现在列表中, 与已同步 hike 卡片同视觉结构, 但下方多一行灰色小字 "离线保存中, 联网后自动上传"。**卡片是纯 placeholder, 主体不可交互**:
    - 整张卡片主体不可点 (不导航到 Activity detail)
    - **唯一操作**: 长按卡片 → 弹菜单"放弃这条?" (§0.9 第 35 条)
    - 用户不长按就等自动同步 (v3.3 用户校准, 保留放弃出口避免"看着烦但删不掉")
32. 上传成功后, "离线保存中" 标记自动消失, 卡片变正常样式
33. Home 页顶部也显示 pending 计数条 "N 条 hike 还没同步, 有网时会自动完成" (与 Activity 卡片双重展示)
34. **pendingSyncStore 无自动过期**: 已 Save 未同步的 hike **不删除**, 直到:
    - 服务器 200 成功 → 自动删本地
    - 用户长按灰色卡片 → 弹菜单"放弃这条?" → 用户确认 → 立即删本地
    (v3.3 用户校准: 已点 Save = 用户明确表达"要保存", 无论多久后有网都要传上去; 但给用户明确的"放弃"入口)
35. **离线卡片长按菜单 (v3.3 新增)**: 用户长按 Activity 列表里的灰色离线卡片 → 弹菜单"放弃这条?" → 用户点 [放弃] 则彻底删除, 点 [取消] 则回到原状态。这是 pendingSyncStore 的唯一手动放弃入口。

### 0.10 Markers 独立契约
35. Marker 是独立 API, 独立页面, 与 hike 无关
36. hike 中点 mark → 立即 POST /api/markers (在线) or 入 offlineQueue (离线, 有网自动补发)
37. marker 不进入 save-hike 事务

---

## 一句话总结

> **"用户按一次 Save 这条 hike 就永远不会丢。有网直接同步, 没网本地暂存并在 Activity 里展示 '离线保存中' 卡片, 有网时后台自动上传。hike/run 进行中被任何原因中断 → 各自最多保留 1 条 backup, 用户下次点 Hiking/Running 卡进入对应界面时, 界面上叠 Modal 弹窗问 [继续/丢弃]。72h 内的 unfinished 保留, 更老的静默删。空窗期 GPS 缺失静默直线连, 与 Strava 一致。"**

---

## 1. 事务契约 (backend PATCH /api/sessions/:id/save)

### 1.1 请求

```
PATCH /api/sessions/:id/save
Authorization: Bearer <jwt>
X-Idempotency-Key: <uuid v4, client 生成, 首次生成后持久化到 pendingSyncStore>
Content-Type: application/json

{
  "end_time": "2026-07-07T07:03:01.290Z",
  "distance_m": 1415.12,
  "duration_s": 1075,
  "name": "Pudong→Lujiazui",
  "route_points": [{"lat":..., "lng":..., "t":...}, ...],      // snapped, 3 字段
  "route_points_raw": [{"lat":..., "lng":..., "t":..., "acc":...}, ...],  // 原, 4 字段
  "memory_points": [
    {"lat":..., "lng":..., "ts": 1783406706290}
    // 注意: client 不算 cid, server 端算, 保证跨端算法一致
  ]
}
```

### 1.2 响应

**首次成功 (200)**:
```json
{
  "ok": true,
  "session_id": 196,
  "finalized_at": "2026-07-07T07:03:01.290Z",
  "memory": { "accepted": 21, "rejected": 0 }
}
```

**幂等命中 (200 + replay flag)**:
```json
{
  "ok": true,
  "session_id": 196,
  "finalized_at": "2026-07-07T07:03:01.290Z",
  "memory": { "accepted": 21, "rejected": 0 },
  "idempotent_replay": true
}
```

**5xx**: 事务回滚, 服务器状态零改变, client 视为离线, 走本地暂存 + SyncDaemon 重试。

### 1.3 事务边界

```js
const conn = await pool.getConnection();
try {
  await conn.beginTransaction();

  // 1. FOR UPDATE 锁行, 校验归属 + 未 finalize
  const [rows] = await conn.execute(
    `SELECT id, start_time, end_time, finalized_at FROM sessions
     WHERE id=? AND user_id=? FOR UPDATE`,
    [id, userId]
  );
  if (!rows[0]) { await conn.rollback(); return res.status(404).json({error:'Session not found'}); }

  // 关键: 老数据 (v411 之前) finalized_at IS NULL 但 end_time != start_time
  // 说明是老流程 finalize 过的, 视为已锁定, 拒绝再改
  const alreadyFinalized =
    rows[0].finalized_at !== null ||
    (rows[0].end_time && new Date(rows[0].end_time).getTime() !== new Date(rows[0].start_time).getTime());

  if (alreadyFinalized) {
    await conn.rollback();
    // 幂等: 返回当前 server 状态, idempotent_replay=true
    const [full] = await pool.execute(
      `SELECT finalized_at, end_time FROM sessions WHERE id=?`, [id]
    );
    return res.status(200).json({
      ok: true, session_id: id,
      finalized_at: full[0].finalized_at || full[0].end_time,
      memory: { accepted: 0, rejected: 0 },
      idempotent_replay: true
    });
  }

  // 2. UPDATE sessions (含 finalized_at = NOW())
  await conn.execute(
    `UPDATE sessions SET end_time=?, distance_m=?, duration_s=?, name=?,
     route_points=?, route_points_raw=?, finalized_at=NOW() WHERE id=? AND user_id=?`,
    [end_time, distance_m, duration_s, name,
     JSON.stringify(route_points), JSON.stringify(route_points_raw), id, userId]
  );

  // 3. bulk INSERT memory_points, chunk=50, cid server 端算
  let accepted = 0;
  if (memory_points?.length) {
    for (let i = 0; i < memory_points.length; i += 50) {
      const slice = memory_points.slice(i, i + 50);
      const rows2 = slice.map(p => [
        userId, p.lat, p.lng, p.ts,
        deterministicCid(userId, p.ts, p.lat, p.lng)  // server 端算, 与 memory.js 同函数
      ]);
      await conn.query(
        `INSERT INTO memory_points (user_id, lat, lng, ts, client_id) VALUES ?
         ON DUPLICATE KEY UPDATE client_id=VALUES(client_id)`,
        [rows2]
      );
      accepted += slice.length;
    }
  }

  await conn.commit();

  const finalizedAt = new Date().toISOString();
  res.status(200).json({
    ok: true, session_id: id, finalized_at: finalizedAt,
    memory: { accepted, rejected: 0 }
  });
} catch (err) {
  await conn.rollback();
  console.error('[sessions/save]', err);
  res.status(500).json({ error: 'Server error' });
} finally {
  conn.release();
}
```

### 1.4 Schema Migration

```sql
-- v412-001-sessions-finalized-at.sql
ALTER TABLE sessions
  ADD COLUMN finalized_at DATETIME NULL AFTER end_time,
  ALGORITHM=INPLACE, LOCK=NONE;
CREATE INDEX idx_sessions_finalized ON sessions(user_id, finalized_at);

-- Backfill 老数据: end_time != start_time 的老 session 视为已 finalize
-- v3.1 修正 (backend subagent blocker 1): 简化条件, 去掉冗余的 OR route_points 分支
UPDATE sessions
  SET finalized_at = end_time
  WHERE end_time IS NOT NULL
    AND end_time != start_time;

-- v3.2 兜底 (backend subagent blocker 1 真问题): end_time IS NULL 但有 route_points 的老孤儿
-- 用最后一个 GPS 点的 t 反推 end_time, 只处理 24h 前的行 (保护 in-progress hike)
-- v3.3 修 (backend subagent B1): 显式要求 JSON_LENGTH >= 2 防 $[-1] NULL
UPDATE sessions
  SET
    end_time = FROM_UNIXTIME(
      JSON_UNQUOTE(JSON_EXTRACT(route_points, CONCAT('$[', JSON_LENGTH(route_points)-1, '].t'))) / 1000
    ),
    finalized_at = FROM_UNIXTIME(
      JSON_UNQUOTE(JSON_EXTRACT(route_points, CONCAT('$[', JSON_LENGTH(route_points)-1, '].t'))) / 1000
    )
  WHERE end_time IS NULL
    AND route_points IS NOT NULL
    AND JSON_LENGTH(route_points) >= 2   -- 硬约束: 防 JSON_LENGTH-1=-1 → $[-1] 返回 NULL 崩溃
    AND created_at < NOW() - INTERVAL 24 HOUR;
```

**部署要求 (v3.3 补, backend subagent B3)**:
- 部署前先确认服务器时钟与 NTP 同步, 否则 `created_at < NOW() - INTERVAL 24 HOUR` guard 可能失效
- 3 步 SQL 建议手动一步一步跑, 每步 SELECT count 确认后再执行
- 保留 rollback 脚本: `ALTER TABLE sessions DROP COLUMN finalized_at;`

### 1.5 孤儿 backfill 脚本

`scripts/repair-orphan-sessions.js` — **只在部署当天手动跑一次**:
- WHERE 条件: `finalized_at IS NULL AND end_time = start_time AND JSON_LENGTH(route_points) >= 2 AND updated_at < NOW() - INTERVAL 4 HOUR`
- 用 `route_points[N-1].t` 反推 end_time
- 用 haversine 累加算 distance_m
- name = "Hike (recovered YYYY-MM-DD)"
- 写 finalized_at = NOW()
- **v3.1 修正 (backend subagent blocker): updated_at guard 从 2h 放宽到 4h 保证不误伤最长 hike (Cairn 现最长 hike 记录 3.5h, 4h 足够 safety margin)**
- **执行方式**: 先 `--dry-run` 打印待修的行数 + 每行 diff, 确认后再 `--execute` 真跑

### 1.6 Idempotency middleware 修改

现状 `backend/src/middleware/idempotency.js` **可能不存在** (backend subagent blocker 5 flag 过, 待新建/确认):

**如果不存在**: 完整新建 `backend/src/middleware/idempotency.js`:
- 内存 LRU cache + 24h TTL 兜底 (7 天 TTL 用 Redis/DB 会更好, v412 初版走内存)
- **key 读取顺序 (v3.3 明确 backend subagent B2)**: 优先读 `X-Idempotency-Key` header, 若无则 fallback `req.body.client_op_id`. **如果两者同时存在, 严格用 header, 完全忽略 body 里的 key**. 理由: header 是明确的请求头, body 内容可能被中间件/proxy 改写, 优先 header 更安全。
- 命中 → 直接 `res.status(cachedStatus).json({ ...cachedBody, idempotent_replay: true })`
- 未命中 → 让请求继续, 用 `res.on('finish')` 钩子拦截 200/201 response 写 cache
- 不 cache 5xx
- 应用于路由: `PATCH /api/sessions/:id/save` (新), 保留应用于 `POST /api/sessions` / `PATCH /api/sessions/:id/append-points` / `PATCH /api/sessions/:id` (兼容旧)

**如果存在**: 增量修改支持 header key + TTL 延长到 7 天 + response body cache (不只是 op_id dedup)。

**极端情况 (key 过期, 服务器不认了)**: 依赖 §1.3 的 finalized_at 兜底判定, 直接 200 replay 当前 server 状态。

### 1.7 deterministicCid 函数抽公共模块 (v3.1 新增, v3.3 补强)

现状 `deterministicCid` 定义在 `backend/src/routes/memory.js` 内部 (line 27-34), 未 export。sessions.js 需要用。

**修改**: 抽到 `backend/src/lib/deterministicCid.js`:
```js
// backend/src/lib/deterministicCid.js
const crypto = require('crypto');
function deterministicCid(userId, ts, lat, lng) {
  return crypto.createHash('sha1')
    .update(`${userId}|${ts}|${lat.toFixed(7)}|${lng.toFixed(7)}`)
    .digest('hex')
    .slice(0, 36);
}
module.exports = { deterministicCid };
```

**v3.3 硬约束 (backend subagent B3)**:
- **实现时, memory.js 里原有的 deterministicCid 私有函数必须删除**, 改成 `const { deterministicCid } = require('../lib/deterministicCid');`
- 保证长期只有一份实现, 不会散落两处代码不同步
- code review 时必须 verify memory.js 里 `function deterministicCid` 已删除

### 1.8 finalized_at 判定逻辑修正 (v3.1 修 backend subagent blocker 2)

§1.3 事务里的 `alreadyFinalized` 判定, 加防御性 isFinite 检查:

```js
const alreadyFinalized =
  rows[0].finalized_at !== null ||
  (rows[0].end_time &&
   Number.isFinite(new Date(rows[0].end_time).getTime()) &&
   Number.isFinite(new Date(rows[0].start_time).getTime()) &&
   new Date(rows[0].end_time).getTime() !== new Date(rows[0].start_time).getTime());
```

防御 `'0000-00-00'` 之类无效日期 → NaN 比较 → 误判为"未 finalize" bug。

### 1.9 旧端点也写 finalized_at (v3.1 修 backend subagent blocker 4)

**旧端点 `PATCH /:id` (v411 finalize) 保留 30 天期间, 也需同步升级**: 写 `finalized_at = NOW()`。

修改 `backend/src/routes/sessions.js` 里的旧 `PATCH /:id` 处理函数, 在 finalize 数据落库时同时设 `finalized_at`。这样保证 v411 client 用旧端点 finalize 一个 session 后, 新代码 (v3.1) 看到该行 finalized_at 非 NULL, 不会误认为"未 finalize"。



---

## 2. Client 侧模块设计

### 2.1 保留 hikeTrackWriter (调整用途)

**保留**:
- 每 30s / 每 50 点写磁盘 backup (v409 的原始设计)
- `startHikeTrack / appendHikePoint / flushNow / renameToCompleted / discardActiveHike` 全部保留
- `resumeHikeTrack` 保留 (给 iOS jetsam 复活场景用)

**调整**:
- `active/` 目录清理触发点变成明确 5 条 (见 §0.3 第 10 条)
- 冷启动 `listActiveHikes` 后必须区分场景 (见 §5)

### 2.2 新增 pendingSyncStore

`app/src/services/pendingSyncStore.ts`:

```typescript
export interface PendingHike {
  localId: string;
  userId: string;
  remoteId: number | null;         // 若 hike 开始时也离线, 可为 null (SyncDaemon 需先建 server row)
  idempotencyKey: string;          // v4 uuid, 首次生成, 磁盘持久化
  payload: {
    end_time: string;
    distance_m: number;
    duration_s: number;
    name: string;
    route_points: Point3[];
    route_points_raw: PointRaw[];
    memory_points: MemPoint[];
  };
  createdAt: number;
  lastAttemptAt: number | null;
  attemptCount: number;
}

// 每 hike 独立文件, 避免并发写冲突
// 文件名: cairn_pending_sync_<localId>.json
// web fallback: localStorage[cairn_pending_sync_<localId>]

export async function savePending(hike: PendingHike): Promise<void>;
export async function listPending(): Promise<PendingHike[]>;
export async function removePending(localId: string): Promise<void>;
export async function markAttempt(localId: string): Promise<void>;
```

### 2.3 SyncDaemon

`app/src/services/syncDaemon.ts`:

**触发时机**:
1. `useAppStore.hydrate()` 成功 (冷启后)
2. `NetInfo.addEventListener` — isConnected 从 false → true
3. (P1 可选) 用户手动点 Home pending 提示

**mutex 保证**:
```typescript
let isDraining = false;
export async function drainPending() {
  if (isDraining) return;
  isDraining = true;
  try {
    // ... 逐条 pending 上传 ...
  } finally {
    isDraining = false;
  }
}
```

**上传单条**:
```typescript
async function uploadOne(hike: PendingHike) {
  // 极端情况: hike 开始时也离线, remoteId 是 null
  if (!hike.remoteId) {
    const r = await startSession(hike.payload).catch(() => null);
    if (!r) { await pendingSyncStore.markAttempt(hike.localId); return; }
    hike.remoteId = r.id;
    await pendingSyncStore.savePending(hike);  // 更新 remoteId
  }
  try {
    const result = await saveHikeAtomic(hike.remoteId, hike.payload, hike.idempotencyKey);
    await pendingSyncStore.removePending(hike.localId);
    useSessionStore.getState().markSynced(hike.localId, hike.remoteId);
  } catch (err) {
    await pendingSyncStore.markAttempt(hike.localId);
    // 不主动重试, 等下次 NetInfo 事件或冷启
  }
}
```

### 2.4 stopTracking 重构

```typescript
stopTracking: async (sessionName?: string) => {
  // ...too-short guard 保留 (逻辑同 v411)...

  if (tooShort) {
    // 离线时 deleteRemoteSession 会失败, 加个"delete_orphan_session" op 到 offlineQueue 兜底
    if (s.remoteSessionId) {
      const online = await isOnline();
      if (online) {
        await deleteRemoteSession(s.remoteSessionId).catch(() => {
          offlineQueue.enqueue({ type: 'delete_orphan_session', remoteId: s.remoteSessionId });
        });
      } else {
        offlineQueue.enqueue({ type: 'delete_orphan_session', remoteId: s.remoteSessionId });
      }
    }
    // 清 hikeTrackWriter active 文件
    hikeTrackWriter.discardActiveHike(s.sessionId);
    stopReason = 'too_short';
    return;
  }

  // snap + memory 计算 (纯本地)
  const snappedTrack = ... /* 现有 snap 逻辑 */;
  const memoryPoints = computeMemoryPointsFromTrack(snappedTrack);

  const idempotencyKey = uuidv4();
  const payload = {
    end_time: new Date(endedAt).toISOString(),
    distance_m: s.distanceM,
    duration_s: s.durationS,
    name: finalName,
    route_points: snappedTrack.map(p => ({lat:p.lat, lng:p.lng, t:p.t})),
    route_points_raw: s.trackPointsRaw,
    memory_points: memoryPoints,
  };

  const online = await isOnline();

  if (online && s.remoteSessionId) {
    // 阻塞式 "数据整理中" 20s
    setStatus('finalizing');  // UI 展示 spinner + 禁 back
    try {
      // v3.3 M5: 用 wall-clock Date.now 作 timeout, 而非纯 setTimeout
      // 防止用户按 Home 键切后台时 iOS 暂停 setTimeout, 导致 20s 变几分钟
      const startedAt = Date.now();
      const result = await withWallClockTimeout(
        saveHikeAtomic(s.remoteSessionId, payload, idempotencyKey),
        20000,
        startedAt
      );
      // withWallClockTimeout 内部用 Date.now() - startedAt 判 elapsed, 不受后台影响
      // 成功
      useSessionStore.getState().addSession({
        id: s.sessionId, remoteId: result.session_id,
        ..., syncState: 'synced', trackPoints: payload.route_points,
      });
      useMemoryStore.getState().addSyncedMemoryPoints(memoryPoints);
      hikeTrackWriter.discardActiveHike(s.sessionId);  // 磁盘清干净
      stopReason = 'saved';
      return;
    } catch (netErr) {
      // timeout or 5xx → 降级到离线分支
      crashLogger.breadcrumb(`v412:save_online_failed_${String(netErr).slice(0,80)}`);
    }
  }

  // 离线分支 (含 online 失败降级)
  await pendingSyncStore.savePending({
    localId: s.sessionId, userId: currentUserId,
    remoteId: s.remoteSessionId,
    idempotencyKey,
    payload,
    createdAt: Date.now(),
    lastAttemptAt: null, attemptCount: 0,
  });
  useSessionStore.getState().addSession({
    id: s.sessionId, remoteId: s.remoteSessionId ?? undefined,
    ..., syncState: 'pending', trackPoints: payload.route_points,
  });
  useMemoryStore.getState().addSyncedMemoryPoints(memoryPoints);
  hikeTrackWriter.discardActiveHike(s.sessionId);  // pendingSync 已接管, active 可以删
  stopReason = 'saved_pending';
};
```

### 2.5 Home 页 pending 提示 + Activity 卡片 placeholder

**Home 页 pending 计数条** (只在有 pending 时显示):
```jsx
const pendingCount = useSessionStore(s =>
  s.sessions.filter(x => x.syncState === 'pending' || x.syncState === 'syncing').length
);
{pendingCount > 0 && (
  <View style={styles.pendingBanner}>
    <Text>{pendingCount} 条 hike 还没同步, 有网时会自动完成</Text>
  </View>
)}
```

**Activity 卡片 placeholder** (v3.1 新增, 关键 UX):

```jsx
<ActivityCard>
  <MainRow>
    <Icon />
    <HikeTitle>{session.name}</HikeTitle>
    <Stats>{session.distanceM}km · {session.durationMinutes}分钟</Stats>
    <TimeAgo>{formatTimeAgo(session.endedAt)}</TimeAgo>
  </MainRow>
  {session.syncState === 'pending' && (
    <PendingRow>
      <SyncingIcon size={12} color={grey500} />
      <Text style={{color: grey500, fontSize: 12}}>
        离线保存中, 联网后自动上传
      </Text>
    </PendingRow>
  )}
  {session.syncState === 'syncing' && (
    <PendingRow>
      <SyncingIcon animated size={12} color={grey500} />
      <Text style={{color: grey500, fontSize: 12}}>
        同步中...
      </Text>
    </PendingRow>
  )}
</ActivityCard>
```

**关键 UX 契约** (§0.9 第 31 条):
- 卡片与已同步 hike 卡片**同视觉结构**, 可点开看 detail
- **无任何用户可操作元素** (无重试按钮, 无删除按钮)
- 上传成功后 `syncState` → 'synced', pendingRow 自动消失, 卡片变正常样式

`syncState` 状态机:
- 'synced' (默认) — 已在服务器
- 'pending' — 已写 pendingSyncStore, SyncDaemon 未跑或跑失败
- 'syncing' — SyncDaemon 正在上传该条 (bumped 时短暂)

---

## 3. iOS 位置权限教育

### 3.1 触发时机

`HikingScreen` 点开的那一刻 (第一次 hike), 或每次 `startTracking` 前:

```typescript
async function checkAndEducateLocationPermission() {
  const hasSeenEducation = await getFlag('hasSeenLocationEducation');
  if (hasSeenEducation) return;

  const fg = await Location.getForegroundPermissionsAsync();
  const bg = await Location.getBackgroundPermissionsAsync();
  if (bg.status === 'granted') {
    await setFlag('hasSeenLocationEducation', true);
    return;
  }

  // 弹教育对话框
  Alert.alert(
    '为了更好地记录 hike',
    'Cairn 需要在屏幕锁定或后台时继续记录 GPS。请在设置中把位置权限设为 "始终允许 (Always Allow)"',
    [
      { text: '稍后', onPress: async () => { await setFlag('hasSeenLocationEducation', true); }},
      { text: '打开设置', onPress: async () => {
          await setFlag('hasSeenLocationEducation', true);
          Linking.openSettings();
        }},
    ]
  );
}
```

### 3.2 flag 存储

- native: SecureStore or MMKV
- web: localStorage
- Reset 时机: 用户手动 logout → 清 flag (下次登录再教育一次)

---

## 4. hike 进行中的磁盘 backup 生命周期 (第五条铁律的详细规则)

保留 v409 `hikeTrackWriter` 全部功能, 但清理触发规则精确化:

### 4.1 写盘时机 (v409 保持)
- `startTracking` → `startHikeTrack(sessionId, meta)` (truncate + 写头)
- 每接收 GPS 点 → `appendHikePoint(p)` (缓冲, 30s 或 50 点 flush 一次)

### 4.2 清理时机 (五条铁律)

**规则 A — Save 成功**:
- 在线 saveHikeAtomic 200 → `discardActiveHike(sessionId)`
- 离线 pendingSyncStore.savePending 成功 → `discardActiveHike(sessionId)` (数据已被 pendingSync 接管)

**规则 B — Cancel/Discard**:
- 用户点 Discard/Cancel → `discardActiveHike(sessionId)`

**规则 C — 开新 hike 之前**:
- `startTracking` 一开始 → `hikeTrackWriter.cleanOrphanActive()`  (扫 active/, 全删)

**规则 D — 冷启动扫描**:
- `useAppStore.hydrate()` 或 app 冷启动 → 扫 `active/`, **区分场景** (见 §5), 决策删或恢复

**规则 E — 24h 兜底**:
- 冷启动扫描时, 任何 `active/` 文件 mtime > 24h → 静默删

### 4.3 discardActiveHike 保证幂等

- 若文件不存在, 也不抛错 (可能被 iOS 已经清了)
- 若 flush buffer 里有点还没写盘, 先 abort buffer 再删文件

---

## 5. Unfinished 恢复的正确实现路径 (v3.1 关键修改)

### 5.1 承认技术悖论: 不区分用户主动杀 vs 系统杀

之前 v3 试图区分 "用户主动杀 app" 和 "iOS 系统 jetsam", 但 JS 层无法可靠区分 (v3 review REJECT 的主因)。**v3.1 放弃这个区分**, 走 Strava/AllTrails 的做法:

- **产品上不区分**, 用户看到的行为一致
- **一律 backup 到磁盘, 一律通过 "进 hike/run 界面后弹 Modal 恢复对话框" 处理**
- 用户选 [继续] or [丢弃], 简单直白

### 5.2 触发时机 (Modal 覆盖式弹窗, 不是导航前拦截)

用户从 Home 点 Hiking/Running 卡:
1. React Navigation 正常跳转到 HikingScreen / RunningScreen
2. Screen 挂载后 `useEffect` 检测对应类型的 unfinished backup (< 72h)
3. 检测到 → 在 Screen 之上叠一个 `Modal` 组件 (RN Modal, transparent overlay)
4. 用户看到的画面: 底下是 hiking/running 界面 (完整渲染, 静态), 中间浮一个恢复对话框
5. 用户 [继续] 或 [丢弃] → Modal 消失, 界面正常运作

**关键**: 弹窗是**独立 z-index 层**, 不是路由导航前的拦截。用户如果按 Back 按钮退出 hiking 界面, Modal 也自然消失, backup 保留, 下次再问。

### 5.3 弹窗触发的检测代码骨架

```typescript
// HikingScreen.tsx
function HikingScreen() {
  const [unfinished, setUnfinished] = useState<UnfinishedHike | null>(null);

  // v3.3 M4: 依赖 hydrationTs, 让 hydrate 完成后 Modal 检测能重跑一次
  // 场景: 用户 hike 中 iOS jetsam, 系统后台复活 app 继续录 GPS + 磁盘 backup 更新
  //       用户之后前台打开 app → HikingScreen 早就挂载了, 单次 useEffect 不会重跑
  //       但 hydrate 会在冷启后重跑, hydrationTs 更新会触发这个 useEffect
  const hydrationTs = useAppStore(s => s.hydrationTs);

  useEffect(() => {
    (async () => {
      const active = await hikeTrackWriter.listActiveHikes();
      const mostRecent = active
        .filter(f => Date.now() - f.mtime < 72 * 3600_000)  // < 72h
        .sort((a, b) => b.mtime - a.mtime)[0];
      if (mostRecent) {
        const meta = await hikeTrackWriter.readActiveHikeMeta(mostRecent.sessionId);
        setUnfinished(meta);
      }
    })();
  }, [hydrationTs]);   // 依赖 hydrationTs, 而非 [] 单次

  return (
    <View>
      {/* hiking 主界面正常渲染 */}
      <HikingMainView />

      {/* 恢复 Modal 覆盖在主界面上 */}
      {unfinished && (
        <>
          {/* v3.3 用户校准修正: Modal 强制选择, 关不掉 */}
          {/* 外层 Pressable 覆盖全屏但 onPress 是 noop, 拦截 tap outside 让它无效 */}
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={() => {
              // noop: tap outside 不允许关闭, 强制用户点两个按钮之一
            }}
          />
          <UnfinishedRecoveryModal
            data={unfinished}
            onContinue={async () => {
              // v3.2 修 (mobile subagent blocker 2): 显式停 background location task
              // 防止 iOS jetsam 复活后 task 已在跑, resumeTracking 再启一次 → 重复注册
              // v3.3 M1: 强顺序 (await 完成), 防止异步 GPS 点漏入 setState 前
              await Location.stopLocationUpdatesAsync(BACKGROUND_LOCATION_TASK).catch(() => {});

              const points = await hikeTrackWriter.readActiveHikeTail(unfinished.sessionId, Infinity);
              useTrackingStore.setState({
                sessionId: unfinished.sessionId,
                remoteSessionId: unfinished.remoteId,
                trackPoints: points,
                startedAt: unfinished.startedAt,
                status: 'tracking',
                // ... 其他 state
              });
              await hikeTrackWriter.resumeHikeTrack(unfinished.sessionId);

              // v3.3 M1: 明确的 AppState 条件分支, 不用不存在的 activateSourceForCurrentAppState
              const appState = AppState.currentState;
              if (appState === 'background' || appState === 'inactive') {
                await useTrackingStore.getState().activateBackgroundSource?.();
              } else {
                await useTrackingStore.getState().activateForegroundSource?.();
              }

              setUnfinished(null);
              // 2s toast: "hike 已恢复"
              showToast('hike 已恢复');
            }}
            onDiscard={async () => {
              await hikeTrackWriter.discardActiveHike(unfinished.sessionId);
              setUnfinished(null);
            }}
            onRequestClose={() => {
              // v3.3 用户校准: iOS swipe / Android Back → 拦截, 不允许关闭
              // 只有 [继续这条] 或 [丢弃] 按钮能关 Modal
            }}
          />
        </>
      )}
    </View>
  );
}
```

RunningScreen 同理, 使用独立的 `runTrackWriter` 或复用 hikeTrackWriter 但用不同目录 (`cairn-run-tracks/active/`)。

### 5.4 冷启动扫描仅做 72h 兜底清理

App 冷启动 `useAppStore.hydrate()` 完成后:
```typescript
async function cleanupOldBackups() {
  const cutoff = Date.now() - 72 * 3600_000;
  const hikeActive = await hikeTrackWriter.listActiveHikes();
  const runActive = await runTrackWriter.listActiveHikes();

  for (const f of [...hikeActive, ...runActive]) {
    if (f.mtime < cutoff) {
      await deleteFile(f.path);
    }
  }
  // 磁盘容量兜底: > 100 文件 or > 100 MB 强制清理最旧的
  await enforceStorageLimit(100, 100 * 1024 * 1024);
}
```

**注意**: 冷启动**不弹恢复对话框**, 只做静默清理。恢复对话框只在用户主动进 hiking/running 界面时弹。

### 5.5 场景验证

**场景 A**: 用户 hike 中被 iOS jetsam 杀 → 系统自动 (通过 significant location changes) 或 用户手动重开 app
- Home 干净, 无提示
- 用户点 Hiking 卡 → 进 hiking 界面 → 弹恢复 Modal "上次 hike 未完成, 3.2km / 40 分钟 / 1 小时前"
- 用户点 [继续] → 无缝继续
- 用户点 [丢弃] → 干净开始新的

**场景 B**: 用户 hike + 主动杀 + 又 run + 主动杀 + 一段时间后打开
- Home 干净, 无提示
- 用户点 Hiking 卡 → 弹 hike 恢复 Modal (最近那条 hike backup)
- 用户处理后进入 hiking 界面
- 用户之后点 Running 卡 → 弹 run 恢复 Modal (最近那条 run backup)
- 各问各的, 互不干扰

**场景 C**: 用户忘了一周
- 冷启动扫描时 >72h 的 backup 全部静默删
- 用户之后点 Hiking → 无恢复弹窗, 干净开始

**场景 D**: 用户狂开狂杀
- 上次 unfinished hike 已在磁盘 → 用户进 hiking 界面弹 Modal, 用户 [丢弃] → 磁盘清空 → 界面上可以点 Start 开新的
- 或用户 [继续] → 恢复到那条 hike, GPS 继续录, 用户如果想结束点 Cancel or Save

---

## 6. 空窗期 UI (v412 初版策略)

**与 Strava/AllTrails 完全一致**:
- Activity map polyline 直接把 iOS jetsam 前后两段 GPS 用直线连
- 不画虚线, 不加"GPS 中断"提示
- 距离用点间累加 (空窗期只算两端点直线距离)
- 时间用 start→end 差 (空窗期算进 duration)
- 用户如果关心, 未来可加"GPS accuracy 评分" (P1 可选, 不进 v412)

---

## 7. 迁移策略

### 7.1 后端
- v412 部署当天:
  1. 跑 schema migration (§1.4) → ADD COLUMN + backfill 老数据的 finalized_at
  2. 跑 §1.5 孤儿 backfill 脚本 → 修 name=NULL 的孤儿 session
  3. 部署新代码, 上线 PATCH /save 端点
- 旧端点 (`/append-points`, `POST /memory/points`, `PATCH /:id`) **保留 30 天** 给未升级 client 兜底
- 30 天后废弃

### 7.2 Client
- v412 冷启动只用新端点, 不再调旧端点
- v411 client 打 v412 backend, 走旧路径, 一切照旧 (旧端点还在)
- **不需要 feature flag** — v412 client 无脑用新端点即可

### 7.3 hikeTrackWriter 数据兼容
- v411 已有的 active/ 目录 JSONL 文件, v412 冷启动可直接读 (格式没变)
- 但 v411 从来没有区分场景 2/3, 所以 v411 → v412 升级后, 用户第一次冷启动可能看到"上次 hike 被静默删了" (v411 会 resume 提示, v412 视为用户 relaunch 无提示)
- 影响: 极小 (只影响升级瞬间正好有 orphan hike 的用户), 可以接受

---

## 8. 用户测试契约 (给下一轮 E2E 定的门)

### 8.1 快乐路径 (在线)
| 用户行为 | Playwright 动作 | 期望网络行为 |
|---|---|---|
| 打开 app | navigate | 无 |
| 登录 | 邮箱密码 | 1 次 POST /auth/login → 200 |
| 进 Hiking | 点卡 | 无 |
| 授予 Always Allow | 弹权限对话框, 允许 (若未授权先弹教育) | 无 |
| 点 Start | 点按钮 | 1 次 POST /api/sessions/start → 201 |
| 走 (feed GPS) | 循环 | **零网络** (hike 中零 append-points) |
| 途中 mark | 点 mark | 1 次 POST /api/markers → 201 (独立) |
| 站 5min (feed 静止) | 继续 | 零网络 |
| 继续走 | feed | 零网络 |
| 点 Save + 命名 | 点 Save | 1 次 PATCH /api/sessions/:id/save → 200 |
| 期间 UI | 观察 | 阻塞式 "数据整理中" spinner, 服务器 200 后弹 Home |
| 进 Activity | 点 Trails | 1 次 GET /api/sessions → 200 |
| 看 polyline | 点 hike 卡 | 1 次 GET /api/sessions/:id → 200 |
| 看 Memory | 点 Memory | 本地数据, 无网络 |

### 8.2 离线路径
| 用户行为 | 期望 |
|---|---|
| 关网络 | NetInfo.isConnected = false |
| Hike + Save | UI "数据整理中" → 20s timeout → toast "已本地保存, 有网自动同步" → 弹 Home → Home 显示"1 条未同步" |
| 恢复网络 | SyncDaemon 触发 → 后台 PATCH /save → 成功 → Home 提示消失, Activity syncing icon 消失 |
| 期间 Activity 页 | 能看到 hike, 卡上有 syncing icon |

### 8.3 iOS jetsam 模拟 (P1, 可能只在真机测)
| 场景 | 期望 |
|---|---|
| 走 5min → 手动杀 app 进程 (模拟 jetsam) → 手动通过 iOS 设置模拟 Location Task 复活 → 打开 app | Zustand tracking store 恢复到之前状态, 磁盘 backup 的 GPS 点读回内存, 用户看到 "hike 继续中" 而不是 "从头开始" |

### 8.4 用户主动杀 app 模拟
| 场景 | 期望 |
|---|---|
| 走 5min → 用户手动杀 app → 用户从桌面点 icon 打开 | 干净 Home 页, 无提示无恢复, 磁盘 active/ 已清空 |

### 8.5 幂等重试
| 场景 | 期望 |
|---|---|
| Save 请求打出去, 服务器 200 响应但网络回程丢包 → client 视为超时 → 进 pendingSync → 下次 SyncDaemon 用同 idempotencyKey 重试 | 服务器 middleware 命中 cache → 200 + idempotent_replay: true → client 认为成功, 数据不重复 |

---

## 9. Sprint 拆分

| Story | 内容 | 点 |
|---|---|---|
| S1 | Schema migration + backfill 老 finalized_at | 1 |
| S2 | Backend PATCH /api/sessions/:id/save + 事务 + memory bulk batching | 5 |
| S3 | Backend idempotency middleware 改 (支持 header + body key, TTL 延长 7 天, replay body) | 2 |
| S4 | Client pendingSyncStore 模块 (含 web fallback) | 3 |
| S5 | Client stopTracking 重构 + 阻塞式 UI | 5 |
| S6 | Client SyncDaemon (mutex + NetInfo + 冷启触发) | 3 |
| S7 | Home pending 提示 + Activity syncing icon + syncState 状态机 | 2 |
| S8 | Client 冷启动场景区分 (§5) + hikeTrackWriter 清理触发规则 | 3 |
| S9 | iOS 位置权限教育弹窗 + hasSeenLocationEducation flag | 2 |
| S10 | too-short 离线 delete_orphan_session 兜底 (offlineQueue op) | 1 |
| S11 | 一次性 backfill 脚本 (scripts/repair-orphan-sessions.js) | 1 |
| S12 | Playwright E2E 新脚本 (8.1 + 8.2 快乐路径) | 3 |
| S13 | 真机 iOS jetsam 恢复测试 (8.3) | 2 |
| **合计** | | **33 点 ≈ 2 sprint** |

---

## 10. 风险清单

1. **Idempotency key TTL 7 天不够**: 用户离线超过 1 周才有网 → key 过期。fallback 是 finalized_at 兜底 (§1.3), 极端场景下 replay 服务器已有状态即可, 不会重复插入
2. **iOS system_revive 检测启发式**: 目前用"hydrate 时 hasStartedLocationTask=true 且 active/ 有文件"启发式。**可能误判为场景 2** (比如用户主动杀 app 但 iOS location task 还在跑) — 但即使误判为场景 2, 用户看到"hike 恢复"的效果, 反而比"数据消失"体验好。误判方向对用户友好
3. **pendingSyncStore 磁盘 quota**: web localStorage 5MB, 大约能存 50 条离线 hike, 长途用户可能爆。native (expo-file-system) 无限。web 爆时 `savePending` 抛错, UI 弹提示 "本地存储已满, 请在 Wi-Fi 环境下同步已有 hike 再继续" (P2, v412 不做)
4. **Sync race**: 冷启 hydrate 和 NetInfo 事件同时触发 → mutex flag 保证串行, 不会重复 upload
5. **saveHikeAtomic 20s timeout**: 快网嫌等着无聊, 慢网可能不够。默认 20s, 用户反馈再调
6. **权限教育时机**: 首次 hike 前弹, 会打断用户 startTracking 流程 — 但一次性成本, 收益是把 iOS 权限档从"While Using"升到"Always"

---

## 11. 落地检查表 (进入实现前必须全绿)

- [x] 用户 confirm 26 条铁律 (§0)
- [ ] Backend subagent 第三轮 review 通过 (无 blocker)
- [ ] Mobile subagent 第三轮 review 通过 (无 blocker)
- [ ] Schema migration + backfill 脚本准备好 (可 rollback)
- [ ] 一次性孤儿修复脚本演练过 (dry-run + confirm 模式)
- [ ] E2E 测试脚本(8.1 + 8.2)可执行

---

## 12. 与前几版的差异

**v3.1 (本版) 相较 v3 的关键变化**:

| 项 | v3 | v3.1 |
|---|----|------|
| iOS jetsam vs 用户主动杀 | 试图区分, 启发式检测 (mobile subagent REJECT) | **不区分**, 统一走恢复弹窗 |
| 恢复弹窗时机 | 冷启动时候的决策 | **进 Hiking/Running 界面后弹 Modal** (界面上叠) |
| unfinished 时间分段 | 24h 内恢复, 24h 外静默删 | **72h 内弹弹窗, 72h 外静默删** |
| hike/run 独立 | 未明说 | **磁盘各保留 1 条 backup, 分开管** |
| 离线 Save 卡片展示 | Home 页 pending 计数 | **Activity 列表卡片 + 灰色小字 "离线保存中, 联网后自动上传"** + Home pending 计数 |
| pendingSync 72h 兜底 | 未提 | **超过 72h 静默删, 与 unfinished backup 同规则, 不弹提示** (v3.3 用户校准) |
| 冷启动扫描 | 复杂场景区分处理 | **只做 72h 兜底清理**, 弹恢复延后到进界面时 |

**v3 相较 v2**: 引入 hikeTrackWriter 保留 / iOS jetsam 复活 / Always Allow 教育 / 空窗期直线连
**v2 相较 v1**: markers 剔除事务 / 阻塞式 UI / offlineQueue 简化
**v1**: 起点

---

**这份文档就是契约。任何后续实现必须以此为准, 偏离必须先改契约再改代码。**
