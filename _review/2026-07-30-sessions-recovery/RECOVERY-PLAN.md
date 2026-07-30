# Cairn sessions 表恢复计划

**日期**: 2026-07-30  
**根源**: R9B7 auto-migration runner 误 DROP sessions 表(2026-07-29)  
**恢复目标**: 建表 + 灌回 21 条 backup + 修补客户端 pending 重传 + Playwright 端到端测

参考: `_review/2026-07-30-sessions-recovery/CHAIN-DIAGNOSIS.md` 已完成的链路梳理。

---

## 1. 建表 DDL(合并 002+005+007+008+019 权威 schema)

```sql
USE cairn;

CREATE TABLE IF NOT EXISTS sessions (
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

  INDEX idx_session_user      (user_id),
  INDEX idx_session_time      (user_id, start_time DESC),
  INDEX idx_sessions_finalized (user_id, finalized_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

**关键点**:
- `CREATE TABLE IF NOT EXISTS` 幂等,不会覆盖现有表
- `auto_increment` 会从 1 开始,但我们 INSERT 时会保留 backup 原 id(最大 201),所以之后新插入会从 202 开始
- **两个 FK 是硬约束**:如果 `users` / `routes` 表里 target 行不存在,INSERT 会失败——已提前 verify 过 backup 里 10 个 user_id 全部存在

---

## 2. 数据回迁 SQL

### Step 1: INSERT 全部 21 条(保留原 id + FK)

```sql
INSERT INTO sessions
  (id, user_id, route_id, type, start_time, end_time, finalized_at,
   distance_m, duration_s, name, route_points, route_points_raw, flags, created_at)
SELECT
  id, user_id, route_id, type, start_time, end_time, finalized_at,
  distance_m, duration_s, name, route_points, route_points_raw, flags, created_at
FROM _sessions_backup_o1_20260726;
```

### Step 2: 验证

```sql
SELECT COUNT(*) AS total, MIN(id) AS min_id, MAX(id) AS max_id FROM sessions;
-- 期望: total=21, min_id=1 或最小, max_id=201
```

```sql
SELECT user_id, COUNT(*) FROM sessions GROUP BY user_id;
-- 期望: user 4 → 11, user 8 → 2, users 19-27 → 各 1
```

### Step 3: AUTO_INCREMENT 对齐

```sql
ALTER TABLE sessions AUTO_INCREMENT = 202;
```

避免下一次 INSERT 生成 1 → 冲突现有 id。

---

## 3. 代码修补清单

### 修补 A: pendingSyncStore 里的 remoteId 处理

**问题**: 用户手机 pending 队列里有大量 payload,`remoteId` 指向的是**已删除的旧 sessions.id**。即使建了新表,那些 id 不再存在,PATCH `/api/sessions/:id/save` 会返回 404,syncDaemon 无限重试。

**修补策略选择**(见 CHAIN-DIAGNOSIS.md §3.6):

**方案 α**: handler 加 upsert(检测 id 不存在时 fallback insert) → 但 payload 缺 `start_time`,不可行 ❌

**方案 β**(推荐): 服务器端 handler 检测 "session id 不存在" → 返回特定错误码 `SESSION_NOT_FOUND_RESYNC`; 客户端 syncDaemon 见此码 → 清空 `hike.remoteId` → 下次触发时走 `!hike.remoteId` 分支 → 重新 `startSession()` 获取新 id → 重新 `saveHikeAtomic()`

**方案 γ**: 手工 admin 脚本一次性把所有 pending 的 remoteId 改 null → 但用户设备无法远程操作 ❌

**选定方案 β**:改两处
- `backend/src/routes/sessions.js` PATCH `/:id/save` handler: FOR UPDATE 查出 0 行时,返回 `404 { error: 'session_not_found', code: 'SESSION_NOT_FOUND_RESYNC' }`
- `app/src/services/syncDaemon.ts` uploadOne catch: 检测 err.status === 404 && err.code === 'SESSION_NOT_FOUND_RESYNC' → 更新 pending payload 里的 remoteId 为 null → markAttempt(下次触发时 startSession)

### 修补 B: syncDaemon 无上限 attemptCount

**问题**: pending 卡永远灰,attemptCount 无上限。用户实际最恶劣情况(表被删 30 天)见过每张卡 attemptCount 高达数千。

**修补**: 加软性阈值,attemptCount > 100 时进入 "backoff mode"(减少重试频率,每次触发只重试 5 张最老的),显示 "手动重试" 按钮。这是 UX 优化,不是 correctness 修复。

**决定**: 本轮**不做**——是长期改进,当前建表后 attemptCount 会自然清零,这是次要问题。列入 backlog。

### 修补 C: 客户端 fetchSessions 遇 500 时的 hydrate 保护

**问题**: `useAppStore.hydrate` 在 fetchSessions() 返回 `[]` 时无条件覆盖内存中的本地 sessions,可能导致用户看到"activity 全消失"(CHAIN-DIAGNOSIS.md §H1)。

**修补**: `fetchSessions()` 区分 "网络错/服务器错" vs "真的返回空数组"。前者时保留本地 preservedLocals + 已 hydrate 的 old-synced sessions,不清 UI。

**具体**: `app/src/services/sessionService.ts:332-341` 现在 `if (!res.ok) return [];` 太粗。改为:
- 5xx / 网络错 → throw
- 4xx → return null(表示"服务器说'没有'但可能是 auth 问题",caller 保守处理)
- 200 → return array

`useAppStore.hydrate` catch throw → **不 merge**,保留本地。

---

## 4. Playwright 测试场景清单

Playwright 用 web 版 Cairn(`app/App.tsx` 有 `Platform.OS === 'web'` 分支,`mapboxAdapter.web.tsx` 用真 mapbox-gl-js)。测试基线 dev server 在本地 `npm run web`(port 8081)或 EAS preview。

### Scenario 1: online save
- 步骤: 打开 Cairn web → 登录 user 4 → tap "Start Hike"(hiking mode) → 用虚拟摇杆推 GPS 30 秒 → tap "Stop" → 命名 "playwright-test-001" → Save
- 验证:
  - HTTP 200 from PATCH `/api/sessions/:id/save`
  - `sessions` 表新增 1 行 name='playwright-test-001'
  - `memory_points` 表新增 ~15 个点(30s / 2s = 15 samples)
  - app UI 里 activity 卡片显示为**非灰色**(synced)

### Scenario 2: cold hydrate + 老 backup 数据显示
- 步骤: cold start → 登录 user 4 → 等 hydrate
- 验证: MapHistoryScreen 里应该看到 11 条 backup activity(含 "back" 那条 2026-05-29)

### Scenario 3: save as route
- 步骤: 从 Scenario 1 或历史 activity 里选一条 → tap "Save as Route" → 命名 "route-from-hike-001"
- 验证:
  - HTTP 200 from POST `/api/routes`
  - `routes` 表新增 1 行
  - `sessions` 表对应行 `route_id` **反写为新 route id** (⚠️ 需要确认现有代码有没有这步)

### Scenario 4: idempotent replay
- 步骤: 从 Scenario 1 的 payload 抓 idempotencyKey → 手工再 curl PATCH `/api/sessions/:id/save` 一次
- 验证: HTTP 200 with `idempotent_replay: true`,`sessions` 表**不新增行**

### Scenario 5(可选): offline → online 重传
- 步骤: 断网(devtools throttle offline) → walk 30s → stop → save
- 验证: 客户端弹 "pending sync" 灰卡 → 恢复网络 → syncDaemon 触发 → 灰卡变绿 → server 有行

---

## 5. 执行顺序(严格顺序,不能跳)

1. ✅ Task #55 subagent review 本文件 → 挑刺
2. ⏳ Task #56 建表 + 回迁 21 条 → 立即验证 count=21
3. ⏳ Task #57 代码修补 A + C(不做 B)→ 本地 syntax check
4. ⏳ Task #58 subagent review 代码 diff
5. ⏳ Task #59 部署到 aliyun → curl health 200 → curl `PATCH /:id/save` 无 auth 应返回 401 而非 500
6. ⏳ Task #60 Playwright scenarios 1-5
7. ⏳ Task #61 Playwright scenario 3 (save as route)

---

## 6. 风险与回退

**风险**:
- **F1**: backup 表里 `finalized_at` 存的可能是错误值 → INSERT 后老 activity 显示时间错乱。检查方法: `SELECT id, start_time, end_time, finalized_at FROM _sessions_backup_o1_20260726 WHERE user_id=4 LIMIT 3` 抽检
- **F2**: `route_id` 指向已删除的 routes → FK CASCADE 触发行删。检查: `SELECT s.id FROM _sessions_backup_o1_20260726 s LEFT JOIN routes r ON s.route_id=r.id WHERE s.route_id IS NOT NULL AND r.id IS NULL`
- **F3**: JSON 列(route_points, route_points_raw, flags) 里可能有 v411 之前的 schema 差异 → 客户端解析失败。缓解: fetchSessions() 里加防御性 try/catch

**回退**:
- 建表如果 count 不等于 21 → `DROP TABLE sessions; DROP TABLE 前 backup 依然完整,可重来`
- 代码修补如果部署后 500 → docker cp 老版本 + docker restart(不到 30 秒)
- Playwright 测试失败 → 不影响生产,继续 debug

---

## 7. 完成标志

- [ ] `sessions` 表在 aliyun 存在,count(*) = 21
- [ ] User 4 在 app 里冷启后看到 11 条历史 activity(含 "back")
- [ ] 新 hike save 成功: `sessions` +1 行 + `memory_points` +N 行
- [ ] pending 队列里的老 payload(remoteId 死指针)能自动走"重新 startSession"路径成功入库
- [ ] Playwright Scenario 1-4 通过
- [ ] 无 500 出现在 aliyun 24h log 里
