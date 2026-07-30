# Cairn sessions 表恢复计划 v2(review 后)

**日期**: 2026-07-30  
**根源**: R9B7 auto-migration runner 误 DROP sessions 表(2026-07-29)  
**Review 记录**: `RECOVERY-PLAN-REVIEW.md`(subagent 挑刺 5 Blocker + 6 Medium + 4 Minor)  
**v2 变更**: 所有 Blocker 已解决并附证据

---

## 0. Blocker 证据(review 要求验证)

### B1: backup 表 schema(SHOW CREATE 验证)

```
CREATE TABLE `_sessions_backup_o1_20260726` (
  `id` bigint unsigned NOT NULL DEFAULT '0',
  `user_id` bigint unsigned NOT NULL,
  `route_id` bigint unsigned DEFAULT NULL,
  `type` enum('hiking','running') COLLATE utf8mb4_unicode_ci NOT NULL,
  `start_time` datetime NOT NULL,
  `end_time` datetime NOT NULL,
  `finalized_at` datetime DEFAULT NULL,   ← 有,B1 通过
  `distance_m` float NOT NULL DEFAULT '0',
  `duration_s` int NOT NULL DEFAULT '0',
  `name` varchar(60) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `route_points` json DEFAULT NULL,
  `route_points_raw` json DEFAULT NULL,
  `flags` json DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
```

✅ 14 列顺序完全对齐权威 schema。INSERT SELECT 用**逐列显式命名**(不 SELECT *)。

### B2: id 分布(MAX/MIN/GAP 验证)

```
MIN(id)=1, MAX(id)=201, COUNT=21
所有 id: 1,2,46,180,181,182,183,184,185,186,187,188,190,191,192,193,196,197,199,200,201
```

✅ AUTO_INCREMENT=202 正确(> max)。大 gap 是**永久占用**——新 id 从 202 开始,不冲突现有卡。

### B3: FK verify

```
user_id 孤儿: 0(所有 21 条的 user_id 在 users 表都存在)
route_id 孤儿: 0
route_id 非 NULL 行数: 0（backup 里所有 route_id 都是 NULL）
```

✅ FK 无风险。INSERT SELECT 不会因 FK 失败。

### B4: pendingSyncStore.updateRemoteId 语义

```typescript
// pendingSyncStore.ts:205
export async function updateRemoteId(localId: string, remoteId: number): Promise<void>
```

签名是 `number`,不接受 `null`。**修补 A 需要改签名为 `number | null`**,让"清 remoteId 到 null"成为 first-class 操作。改动点已明确。

### B5: R9B7 runner 状态

```
- backend/src/services/migrationRunner.js: 不存在(已删)
- 源码里 migrationRunner / _schema_migrations 引用: 0 处
- backend/src/index.js 只有 passive schema check(missing → console.error + start anyway),不 apply migrations
```

✅ 建表安全,docker restart 后不会再删。

---

## 1. 建表 DDL(v2 修订)

```sql
USE cairn;

-- 显式检查:如果表已存在,不建。等人工确认状态。
-- (回退变简单: DROP TABLE sessions 之后可重跑)
CREATE TABLE sessions (
  id               BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id          BIGINT UNSIGNED NOT NULL,
  route_id         BIGINT UNSIGNED NULL,
  type             ENUM('hiking','running') NOT NULL,
  start_time       DATETIME NOT NULL,
  end_time         DATETIME NOT NULL,
  finalized_at     DATETIME NULL,
  distance_m       FLOAT    NOT NULL DEFAULT 0,
  duration_s       INT      NOT NULL DEFAULT 0,
  name             VARCHAR(60) NULL,
  route_points     JSON     NULL,
  route_points_raw JSON     NULL,
  flags            JSON     NULL,
  created_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT fk_session_user  FOREIGN KEY (user_id)  REFERENCES users(id)  ON DELETE CASCADE,
  CONSTRAINT fk_session_route FOREIGN KEY (route_id) REFERENCES routes(id) ON DELETE SET NULL,

  INDEX idx_session_user       (user_id),
  INDEX idx_session_time       (user_id, start_time DESC),
  INDEX idx_sessions_finalized (user_id, finalized_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

Review B1 变更:去掉 `IF NOT EXISTS`(review MI1)—— 让重复建表爆错更明显。

---

## 2. 数据回迁 SQL(逐列命名,不用 SELECT *)

```sql
INSERT INTO sessions
  (id, user_id, route_id, type, start_time, end_time, finalized_at,
   distance_m, duration_s, name, route_points, route_points_raw, flags, created_at)
SELECT
  id, user_id, route_id, type, start_time, end_time, finalized_at,
  distance_m, duration_s, name, route_points, route_points_raw, flags, created_at
FROM _sessions_backup_o1_20260726;

-- 验证 count
SELECT COUNT(*) AS n, MIN(id) AS min_id, MAX(id) AS max_id FROM sessions;
-- 期望: n=21, min_id=1, max_id=201

-- 对齐 AUTO_INCREMENT
ALTER TABLE sessions AUTO_INCREMENT = 202;
```

---

## 3. 代码修补清单(v2 明确改动点)

### 修补 A: pending remoteId 死指针问题

**问题**: pending 里 payload.remoteId 是被删的老 session id(比如 remoteId=88,但新 sessions 表里从 202 开始,88 永远不存在)→ PATCH 404 → syncDaemon 无限重试。

**具体改动**(3 处):

**A.1 backend/src/routes/sessions.js PATCH /:id/save handler**  
FOR UPDATE 查出 0 行时,现在返回 404 `{ error: 'Session not found' }`。**改**为返回 `{ error: 'session_not_found', code: 'SESSION_NOT_FOUND_RESYNC' }`,让 client 能 detect 该场景。

**A.2 app/src/services/sessionService.ts saveHikeAtomic HTTP error 路径**  
现在 `throw new Error('saveHikeAtomic HTTP ${status}: ${errBody?.error}')`,只带 status,不带 code。**改**为把 `err.code = errBody?.code` 也带上。

**A.3 app/src/services/pendingSyncStore.ts updateRemoteId 签名**  
现在 `updateRemoteId(localId: string, remoteId: number)`。**改**为 `remoteId: number | null`,允许显式清 null。

**A.4 app/src/services/syncDaemon.ts uploadOne catch 分支**  
现在 catch 直接 markAttempt。**改**为先 detect `err.status === 404 && err.code === 'SESSION_NOT_FOUND_RESYNC'` → `await updateRemoteId(hike.localId, null)` + markAttempt + 下次触发时 `!hike.remoteId` 分支 → 重新 startSession + saveHikeAtomic。

### 修补 B: skip(review 决定 backlog)

### 修补 C: fetchSessions 5xx 时不清 hydrate

**问题**: `sessionService.ts fetchSessions()` `if (!res.ok) return []` 太粗。5xx 时应该 throw,`useAppStore.hydrate` 应该 preserve 本地 preservedLocals + 已 hydrate 的 old-synced sessions,不清 UI。

**具体改动**(2 处):

**C.1 sessionService.ts fetchSessions**:  
```typescript
if (!res.ok) {
  if (res.status >= 500) throw new Error(`fetchSessions 5xx: ${res.status}`);
  return [];  // 4xx: 认为服务器说"没有",继续 hydrate 走空 merge
}
```

**C.2 useAppStore.ts hydrate**:  
catch fetchSessions throw → **不 merge remote**,保留 `beforeMerge`(即 useSessionStore 已 hydrate 的本地 state)。

---

## 4. Playwright 测试场景(v2 缩减)

从 review M2/M3/M4 反馈裁掉/延后:

**Scenario 1 (in-scope)**: cold hydrate → 登录 user 4 → MapHistoryScreen 里能看到 11 条历史 activity(含 "back")。**不用 GPS mock**,只测显示。

**Scenario 2 (in-scope)**: 手工 POST 一个 fake activity → aliyun docker exec sql 直接看 sessions +1 行。**不用 Playwright**,curl 就行。

**Scenario 3 (in-scope)**: idempotent replay(依赖 R87)。先 verify 生产 backend 里 handler 是不是最新版本(subagent M4 要求)。

**Scenario 4 (out-of-scope, moved to next Sprint)**: Save as Route —— POST /api/routes 现在死的,单独修。

**Scenario 5 (out-of-scope for now)**: 虚拟摇杆真机 mock —— 需要先确认 web hook 是否活着。

---

## 5. 执行顺序(v2)

0. ~~Review 恢复计划~~ ✅ 已完成
1. ⏳ 建 sessions 表 + 灌 21 条 + AUTO_INCREMENT = 202
2. ⏳ 验证 sessions.count = 21 + user 4 有 11 条
3. ⏳ 修补 A(4 处)+ C(2 处)
4. ⏳ subagent review 修补 diff
5. ⏳ 部署 backend
6. ⏳ curl smoke: PATCH /:id/save 用有效 token → 200 或 404 但不 500
7. ⏳ Playwright Scenario 1 + curl Scenario 2 + Scenario 3

---

## 6. 风险与回退(v2 补充)

| 风险 | 处理 |
|---|---|
| F1 finalized_at 值错乱 | backup 里都不是 NULL 时,一致 → INSERT 后抽检 3 行 |
| F2 route_id 孤儿 | ✅ 已验证 0 orphan |
| F3 JSON schema 差异 | INSERT 后 curl GET /:id 抽检 3 条 route_points |
| **F4** 修补 A 客户端改动如果没 OTA 推给用户 → 用户设备上 syncDaemon 还是老逻辑 → pending 永远失败 | 客户端改动**这轮只 commit,不 OTA**(等 real-device 测)。用户手机上 pending 卡片继续灰,但**新 hike 会成功**——大部分症状消失。老 pending 需下次 OTA |
| F5 部署新 backend 时并发 request 在飞 | health check + restart 之间 <1s,可接受 |

**回退**:
1. DROP TABLE sessions
2. 服务器代码 A.1 部分回退(git revert 只 revert backend commit)
3. 客户端 A.2/A.3/A.4/C.1/C.2 不推 OTA → 无需回退

---

## 7. 完成标志(v2)

- [ ] sessions.count = 21, user 4 有 11 条
- [ ] backend deploy 完 aliyun HTTP 200
- [ ] curl PATCH /:id/save 有效 token,某个 backup 里 id(如 46) → 200 且 sessions 表新增 memory_points 或 replay
- [ ] curl PATCH /:id/save 无效 id(如 999999) → 404 with code=SESSION_NOT_FOUND_RESYNC
- [ ] user 4 冷启 app 看到 11 条历史 activity(需 real-device test)
