# Backend + 测试基础设施盘点（2026-07-19）

范围：`backend/src/**` Node.js 业务代码 + `app/__tests__` + `app/tests/sprint7X` + `scripts/` 测试工具链。前端 UI/screens/services 由前 3 个 subagent 覆盖，此报告不重复。

---

## Backend

**入口**：`backend/src/index.js`（145 行）Express 应用，`app.listen(PORT=3001)`。
- helmet + CORS（allowed origins via `CORS_ORIGINS` env）+ trust proxy 1（nginx/caddy 前置）
- 分路径 body 限制：`/api/telemetry` 12MB JSON/JSONL，`/api/debug-snapshot` 走 express.raw，其余 1MB
- `GET /health` 真跑 `SELECT 1`（不是 hard-code 200）
- `DISABLE_CRON=1` 关掉 weekly cleanup；否则 `node-cron` 每周日 03:00 UTC 跑 `cleanHiddenItemsOrphans`

Startup 时 `pool.getConnection() → SELECT 1`；DB 断了不 crash，交给 /health 报 503。

### API 路由（14 个 router 文件，55+ 个端点，全部真业务）

| 路由 | HTTP | 业务状态 | 认证 | 表操作 | 关键点 |
|---|---|---|---|---|---|
| **auth.js**（338 行） | | | | | |
| /api/auth/register | POST | real-done | 无 | pending_registrations upsert | rate 10/15min；dev env 返回 dev_code；nodemailer 异步发邮件不 block 注册 |
| /api/auth/verify | POST | real-done | 无 | pending → users + user_oauth 转正 | 6位 code 5 次错误锁定；发现同 email 已 Google 注册返 409 hint=use_oauth |
| /api/auth/resend | POST | real-done | 无 | pending_registrations | rate 2/60s |
| /api/auth/login | POST | real-done | email+pwd | users + user_oauth | OAuth-only 账户返回 hint=use_oauth；错误密码走 bcrypt.compare timing wall |
| /api/auth/google | POST | real-done | id_token | users + user_oauth linkOAuth | verifyIdToken via google-auth-library；rate 60/15min |
| /api/auth/me | GET | real-done | JWT | users + user_oauth | DB 挂了兜底返 JWT payload 里的 minimal user，前端不掉登录 |
| /api/auth/refresh | POST | real-done | JWT | — | Sprint72 STORY-00550，客户端 30 分钟刷 |
| /api/auth/password | PATCH | real-done | JWT | users.password_hash | OAuth-only 用户首次设密码不需 current password |
| **sessions.js**（422 行） | | | | | |
| /api/sessions | POST | real-done | JWT + idempotency | sessions (JSON route_points, flags) | legacy all-in-one；<2 pts 返 422 |
| /api/sessions | GET | real-done | JWT | sessions | omits JSON columns |
| /api/sessions/start | POST | real-done | JWT + idempotency | sessions createEmpty（end_time=start_time 占位） | 增量流起点 |
| /api/sessions/:id/append-points | PATCH | real-done | JWT + idempotency | sessions（FOR UPDATE + read-merge-write JSON） | 60s flush；transaction 防两 flush 并发覆盖；`t\|lat.toFixed(6)\|lng.toFixed(6)` 去重 |
| /api/sessions/:id | PATCH | real-done | JWT + idempotency | sessions.finalize（含 finalized_at） | v411 兼容路径；<2 pts 删 session 返 422 |
| /api/sessions/:id/save | PATCH | real-done | JWT + idempotency | sessions UPDATE + memory_points bulk INSERT（同 tx） | v412 原子事务；FOR UPDATE 锁 row；finalized_at 兜底幂等；rejected/accepted 计数 |
| /api/sessions/:id | GET | real-done | JWT | sessions | 返回完整 JSON |
| /api/sessions/:id | DELETE | real-done | JWT | sessions | user 归属 |
| **routes.js**（169 行） | | | | | |
| /api/routes | POST | real-done | JWT | routes（JSON points + waypoints） | 拒绝 `permission='public'`（v4 H1）；v120 fix `JSON.stringify` 防 mysql2 落成 `[object Object]` |
| /api/routes | GET | real-done | JWT | routes ORDER BY run_count DESC | omits points |
| /api/routes/:id | GET | real-done | JWT | routes | 完整 |
| /api/routes/:id | PUT | real-done | JWT | routes | 部分更新 |
| /api/routes/:id | DELETE | real-done | JWT | routes | |
| /api/routes/:id/run | PATCH | real-done | JWT | routes.run_count + last_run_at | |
| **markers.js**（552 行） | | | | | |
| /api/markers | GET | real-done | JWT | markers（用户自己） | v300 加了 user_id 到返回体（BUG-001 fix） |
| /api/markers/public | GET | real-done | JWT | markers LEFT JOIN hidden_items | bbox lat_sw,lng_sw,lat_ne,lng_ne；≤10° 跨度；LIMIT 50；author_name=null（v4 §7 匿名） |
| /api/markers | POST | real-done | JWT + idempotency | markers | 拒绝 `permission='public'`；类型 danger/junction/water/hut/cairn；text 250 上限 |
| /api/markers/:id | PUT | real-done | JWT | markers | 部分更新；permission=public 拒 |
| /api/markers/:id | DELETE | real-done | JWT | markers | |
| /api/markers/:id/community-state | GET | real-done | JWT | markers + marker_votes | v199：读 helpful_count/report_count + 用户 vote |
| /api/markers/:id/interact-nonce | GET | real-done | JWT | — | HMAC nonce（TTL 60s，bind userId/markerId/ts） |
| /api/markers/:id/vote | POST | real-done | JWT + idempotency + userKeyed rateLimit | marker_votes（UNIQUE tx）+ markers counter + abuse_signals | 全套 anti-abuse：GPS acc ≤100m + 时钟偏差 ≤60s + haversine ≤50m + 5km/60s impossible-travel + INSERT IGNORE mutex + 5 举报自动 hide |
| **friends.js**（186 行） | | | | | |
| /api/friends/request | POST | real-done | JWT | friend_requests | 拒重复、拒自己 |
| /api/friends/requests | GET | real-done | JWT | friend_requests JOIN users | pending 收件箱 |
| /api/friends/accept | POST | real-done | JWT | friends（双向 INSERT）+ friend_requests | 一次 INSERT 两行对称，简化 circle 查询 |
| /api/friends/reject | POST | real-done | JWT | friend_requests.status | |
| /api/friends | GET | real-done | JWT | friends JOIN users | |
| /api/friends/:id | DELETE | real-done | JWT | friends 双向 DELETE | |
| /api/friends/:id/markers | GET | real-done | JWT | markers WHERE user_id=? AND perm IN (group,public) | legacy — circle/markers 是新入口 |
| **circle.js**（212 行） | | | | | |
| /api/circle/markers | GET | real-done | JWT | markers JOIN users LEFT JOIN hidden_items | v376 fix：Friend-tier 走 mutual friendship，不走 memory_subscription |
| /api/circle/routes | GET | real-done | JWT | routes JOIN users LEFT JOIN hidden_items | 同上 |
| /api/circle/fog | GET | real-done | JWT | memory_points GROUP BY user_id | 走 memory_subscriptions（cap=5）；返回 friend_id → JSON_ARRAYAGG points；polygon UNION 推给 client tesselate（SPIKE-67-1 决定的） |
| **hide.js**（80 行） | | | | | |
| /api/hide | POST | real-done | JWT | hidden_items（PK user_id+type+id） | 不允许 hide 自己的 item；no DELETE（v4 §5 irreversible） |
| **memory.js**（185 行） | | | | | |
| /api/memory/points | POST | real-done | JWT | memory_points（bulk INSERT ... ON DUPLICATE） | 1000 pt batch cap；ts 整数校验；deterministicCid fallback；服务器 SELECT 回读确认真落地（M2 fix） |
| /api/memory/points | GET | real-done | JWT | memory_points | keyset pagination via after_ts + after_cid；LIMIT 上限 10000；until snapshot bound |
| /api/memory/points | DELETE | real-done | JWT | memory_points | 全清 |
| **memory-subscriptions.js**（120 行） | | | | | |
| /api/memory-subscriptions | POST | real-done | JWT | memory_subscriptions（DB trigger 校验 cap+friendship） | SIGNAL SQLSTATE 45000 → 403/409 映射；SELECT FOR UPDATE race-safe |
| /api/memory-subscriptions/:id | DELETE | real-done | JWT | memory_subscriptions | |
| /api/memory-subscriptions | GET | real-done | JWT | memory_subscriptions JOIN users + users.memory_subscription_limit | 返 limit + count + list，避免二次 round-trip |
| **telemetry.js**（215 行） | | | | | |
| /api/telemetry/sessions | POST | real-done | X-API-Key **但 requireApiKey 是 no-op！** | telemetry_sessions（LONGTEXT raw_jsonl） | 支持 JSON object 或 JSONL string；10MB body cap；rate 60/5min；UPSERT ON DUPLICATE |
| /api/telemetry/sessions | GET | real-done | X-API-Key **但 no-op** | telemetry_sessions | list |
| /api/telemetry/sessions/:id | GET | real-done | X-API-Key **但 no-op** | telemetry_sessions | detail with raw_jsonl |
| **debug-snapshot.js**（152 行） | | | | | |
| /api/debug-snapshot | POST | real-done | 无（dev） | debug_snapshots (LONGBLOB image_blob) | 12MB PNG raw；magic byte 校验；1h TTL 机会性清理 |
| /api/debug-snapshot/latest | GET | real-done | 无 | debug_snapshots | JSON meta |
| /api/debug-snapshot/:id | GET | real-done | 无 | debug_snapshots | 返 PNG bytes |
| **feature-flags.js**（44 行） | | | | | |
| /api/feature-flags | GET | real-done | 无（by design） | feature_flags LIMIT 1000 | 引导前必读；ADR-008 说明非私 |
| **v025/debug-events.js**（98 行） | | | | | |
| /api/v025/debug-events | POST | real-done | optional JWT | debug_events_v2 | 200 events/req batch；PII strip 坐标+邮箱；rate 60/min/IP |
| **v025/worldmaps.js**（106 行） | | | | | |
| /api/v025/worldmaps/:spaceId | POST | real-done | JWT | 文件系统 `backend/storage/v025/worldmaps/*.arworldmap` | 50MB cap；rate 30/min/IP |
| /api/v025/worldmaps/:spaceId | GET | real-done | JWT | 文件系统 | 404 时**空 body**（v0.2.5 Phase 3 fix：expo-file-system downloadAsync 别写 JSON 到 .arworldmap） |

### 数据库 Schema（19 个 migration，17 张核心表）

Migrations 位置：`backend/src/migrations/`，编号 001-019。跑 script：`backend/scripts/run-migration.js`。

**主要表**：
- **users** (001, 004 重建) — id, name, email UNIQUE, password_hash NULLABLE (OAuth-only), account_type ENUM(free/pro) DEFAULT free, memory_subscription_limit INT DEFAULT 5（018 加）, created_at, updated_at
- **user_oauth** (004) — PK(provider, provider_id), UNIQUE(user_id, provider), FK user_id CASCADE
- **pending_registrations** (004) — PK email, code CHAR(6), expires_at, attempts, password_hash 已 hash
- **sessions** (002/004/007/008/019) — id, user_id FK, route_id FK NULL, type ENUM(hiking/running), start_time, end_time, **finalized_at DATETIME NULL**（v412 加，用来判是否已 finalize；backfill: end_time≠start_time 视为已 finalize；孤儿用 route_points 尾点 t 回填）, distance_m, duration_s, name, route_points JSON（snap 后的干净线）, route_points_raw JSON（v77 audit track backup）, flags JSON, created_at
- **routes** (005/013/018) — id, user_id FK, name, description, points JSON, waypoints JSON DEFAULT '[]', distance_m, elevation_gain_m, run_count, last_run_at, **permission ENUM(personal/friend/public) DEFAULT personal**（018 加，index）, created_at, updated_at
- **markers** (003/010/012/014/017) — id, user_id FK, type VARCHAR (danger/junction/water/hut/cairn), text VARCHAR(250), lat/lng DOUBLE, alt DOUBLE, permission ENUM(personal/group/public) — legacy 'group' == 'friend', approximate, public_snapshot JSON, **helpful_count / report_count INT**（012 vote counters）, status VARCHAR (healthy/suspicious/hidden), hidden_at, **plant_anchor_y / plant_surface_tier / plant_lidar_available / plant_classification / plant_session_ground_y / is_estimated_ground / plant_arworldmap_blob_url**（014 AR metadata）
- **marker_votes** (012) — UNIQUE(user_id, marker_id) 强制"一人一 mark 一票"；type ENUM(like/report)；reason 只在 report 时用；reporter_lat/lng + distance_m 存审计；no DELETE endpoint（永久）
- **abuse_signals** (012) — append-only 反作弊 telemetry；kind: gps_too_far/gps_low_accuracy/impossible_travel/replay_nonce_invalid/mocked_location/rate_limit/clock_skew/unauthorized
- **friends** (003) — PK(user_id, friend_id) unique；双向存两行；FK CASCADE
- **friend_requests** (003) — status ENUM(pending/accepted/rejected)
- **memory_points**（在 `backup/pre-friend-system-*.sql` 里，migration 未包含！） — id, user_id FK CASCADE, lat/lng DOUBLE, ts BIGINT UNSIGNED（unix ms）, client_id VARCHAR(36), UNIQUE(user_id, client_id), INDEX (user_id, ts), INDEX (user_id, ts, client_id) — auto increment 已到 1225
- **memory_points_pre_kalman** — Kalman resmooth 之前的备份表（v355 spike 留下）
- **memory_subscriptions** (018) — PK(user_id, friend_id)，`trg_memory_subscription_cap` trigger BEFORE INSERT 检查：(1) friends 关系已存在；(2) 当前 count<memory_subscription_limit（FOR UPDATE 加锁）
- **hidden_items** (018) — PK(user_id, item_type ENUM(mark/route), item_id) — polymorphic, no FK to markers/routes，靠 cron 清 orphan
- **telemetry_sessions** (006) — session_id UNIQUE, device_model/os/os_version/app_version/build_number, started_at/ended_at BIGINT, duration_ms, events_count, raw_size_bytes, activity_mode, raw_jsonl LONGTEXT, upload_source
- **debug_snapshots** (011) — snapshot_id, image_blob LONGBLOB, image_bytes, meta JSON, device_os/app_version/ar_mode header echo
- **idempotency_keys** (009) — PK op_id, user_id, status_code, response_json JSON —— 缓存幂等响应
- **feature_flags** (015b) — flag_key + flag_value 简单 KV
- **debug_events_v2** (016) — v0.2.5 bulk telemetry，PK auto-inc；(user_id NULL, session_instance_id, phase, step, seq, timestamp_unix_ms, outcome, diagnostic)

### 认证机制

**JWT** 单一来源：`backend/src/config/jwt.js`（19 行）
- HS256 with `process.env.JWT_SECRET`，`JWT_EXPIRES_IN` 默认 7 天
- 若 `JWT_SECRET` 未设 throw error（不是 fallback 到弱 secret）

**中间件** `backend/src/middleware/authenticate.js`（33 行）
- 所有失败都 `X-Cairn-Auth-Invalid: true` header + body `code: 'TOKEN_INVALID'` → 前端 apiService 铁律区分真 401 vs 其他 401
- TokenExpiredError 单独返回 `Session expired. Please sign in again.`
- 全 `/api/*` 除 auth/register + verify/resend/login/google + feature-flags + debug-snapshot + telemetry(no-op key) + v025/debug-events(optional) 都强制 JWT

**Optional auth** `middleware/optionalAuthenticate.js` — `/api/v025/debug-events` 用：登录了记 user_id，没登录也接受 anon 上传

**Idempotency** `middleware/idempotency.js`（102 行）
- v412 支持 `X-Idempotency-Key` header 优先，body `client_op_id` fallback
- UUIDv4 严格校验
- 2xx 才缓存；replay 时插 `idempotent_replay: true` 字段 + `X-Idempotent-Replay: 1` header
- 同 key 不同 payload 是 client 违规，会返回旧 body（SyncDaemon 保证不发生）

### 外部集成

| 服务 | 状态 | 位置 |
|---|---|---|
| **Mapbox /matching/v5/walking** | client 直连（有 CAIRN_JWT + MAPBOX_TOKEN 硬编码在 scripts）；backend **未代理** | `scripts/replay-KL-real-snap.js`, `scripts/test-mapbox-kl.js`, client-side snapTrack.ts |
| **Google OAuth verifyIdToken** | backend 集成 via `google-auth-library`（唯一使用） | `routes/auth.js:224` |
| **Gmail SMTP** | backend nodemailer（App Password） | `services/emailService.js` |
| **MetService / DOC / GNS Science / LINZ** | **完全没接** — 未来 hiking 数据源缺口 | — |
| **Aliyun OSS / S3** | worldmaps 现在是 filesystem `backend/storage/v025/worldmaps/`；ADR 里说 v0.2.6 迁 OSS | `routes/v025/worldmaps.js` |

---

## 测试基础设施

### Jest 单元测试

**配置**：`app/package.json` 内嵌 `"jest"` block，`preset: "jest-expo"`
- setupFilesAfterFramework: `@testing-library/jest-native/extend-expect`
- testMatch: `__tests__/**/*.test.[jt]s?(x)` + `**/?(*.)+(spec|test).[jt]s?(x)` + v025 三个专门目录
- transformIgnorePatterns 允许 `expo-*`, `react-native`, `@rnmapbox`, `kdbush` 走 babel
- `__mocks__/expo-location.ts` + `expo-speech.ts`

**测试文件数**：23 个 `.test.ts`（`app/__tests__/`），总 2812 行

**覆盖模块**（从文件名反推）：
- `useAppStore` / `useSessionStore` / `useTrackingStore` — Zustand 全局 store
- `debugLogger` / `telemetryUploader` / `crashLogger` — telemetry 上传路径
- `gpsSampler` / `unlockEngine` — GPS 采样 + 里程/成就解锁引擎
- `storage` / `a8Migration` / `marker-store-hydrate` — AsyncStorage hydration
- `ar-re-mount` / `plantTitleBody` — AR marker 生命周期
- `cross-session-e2e` — 跨 session 完整流
- `origin-stale` / `S2-crash-fixes` / `S4-phase-sync` — 崩溃/相位同步防御
- `r23-caller-propagation` / `r23-low-accuracy` / `r27-track-debounce` — GPS 分级重试
- `i18n` / `devFlags` / `build-spawn-request-branches` — 边角逻辑

**未覆盖的关键模块**（jest 层缺）：
- Backend `routes/*.js` — 一个 backend 单元测试文件都没
- Backend `models/{Session,Route,User}.js` — 无
- `middleware/{authenticate,idempotency,optionalAuthenticate}` — 无
- `utils/{haversine,nonce,abuseSignals}` — 无（nonce HMAC 值得单元验证 timing-safe compare 和 TTL）
- `lib/deterministicCid.js` — 无（v412 sessions/save 和 memory/points 复用同实现，跨端一致性关键）
- Frontend `services/apiService.ts`, `mapboxAdapter.web.tsx` — 从文件名看无（前 3 subagent 会覆盖）

### Playwright 配置

**`app/playwright.config.ts`**（31 行）
- testDir: `./tests/sprint71`
- baseURL: `http://localhost:8081`（expo start --web 端口）
- viewport 375×812（iPhone SE/13 mini）
- headless: true, timeout 60s, trace on failure
- serial（fullyParallel: false）—— expo web 共享端口

**`app/playwright.sprint72.config.ts`**（33 行）
- 差别 1：testDir → `./tests/sprint72`
- 差别 2：outputDir → `../docs/qa/sprint72-evidence`（QA evidence 目录规范）
- 差别 3：额外 html reporter `../docs/qa/sprint72-playwright-html`
- 差别 4：video: retain-on-failure（sprint71 无 video）
- 差别 5：screenshot: only-on-failure

Sprint 73 + 74 复用 sprint72 配置模式，各 spec 独立。

### Web Test Hook 精确定位

**`window.__cairnStores`**（v406 加，production 前要删）— `app/App.tsx:381`
```
(globalThis as unknown as { __cairnStores?: unknown }).__cairnStores = {
  useAppStore,
  useTrackingStore: trackingStore,
  useSessionStore: sessionStore,
  useMemoryStore: memoryStore,
};
```
只在 `Platform.OS === 'web'` 分支挂，dynamic require 保证 native bundle 不引用。

**`window.__cairnOfflineQueue`** — `app/App.tsx:392` — v409 offlineQueue 5 个 API
**`window.__cairnHikeWriter`** — `app/App.tsx:401` — hikeTrackWriter 8 个方法（含 v410 resumeHikeTrack）
**`window.__cairnHikeCache`** — `app/App.tsx:419` — hikeTracksCache 5 个 API（TTL、size cap）
**`window.__cairnPendingSync`** — `app/App.tsx:432` — v412 pendingSyncStore + syncDaemon
**`window.__cairnBreadcrumbs`** — `app/src/services/crashLogger.ts:149` — 崩溃日志 ring buffer
**`window.__cairnStores.navigationRef`** — `app/src/navigation/RootNavigator.tsx:88-91` — React Navigation ref，Playwright 可以跳页
**`window.__cairnStores.getCurrentRoute`** — `RootNavigator.tsx:90` — 读当前路由名

副引用（诊断注释里）：
- `app/src/services/hikeTrackWriter.ts:408` — getWriterState 供 __cairnStores 用
- `app/src/services/hikeTracksCache.ts:241` — 标签 + web hook __cairnStores

**清单**：production 前要在 App.tsx 370-450 line 之间的整个 web hook block 删掉（含 try/catch 层）+ RootNavigator.tsx 85-92 line + crashLogger.ts 149。**7 个 hook 挂载点**。

### Sprint 测试规模

| Sprint | 用途 | 文件数 | 总行数 |
|---|---|---|---|
| sprint71 | Friend System v4 场景 | 1 | 142 |
| sprint72 | Story-549 到 557（自动登录/refresh/未完成 session/auto-pause/sampling/flush/hint/breadcrumb hook） | 9 spec + helpers.ts (162 行) | 450 |
| sprint73 | v404 cold-boot | 1 | 75 |
| sprint74 | v409 offline reliability | 1 | 754（最大） |

### GPS 合成 + Replay 工具链

**`scripts/gen-pudong-lujiazui-trace.js`（123 行）** — 生成 30 分钟浦东南路→陆家嘴步行 GPS 轨迹
- 8 个真实浦东路口 waypoints（`WAYPOINTS` 数组）
- 4 段：慢走(1.5 m/s, 5s 间隔) → **静止 5min（±2m GPS drift）** → 快走(2.5 m/s, 3s 间隔) → 慢走结尾
- 5% 概率的**大噪声点（±20m）**——这个刚好让 Mapbox snap 有事做
- 每点 `{ t, lat, lng, acc }`，acc 也随机（大噪时 25/30，常态 8/10）
- 输出：`docs/qa/v409-evidence/pudong-lujiazui-trace.json`，含 `markPoint`（WP4 位置 + elapsed 60%）
- **200-300 pt 一条轨迹**

**`scripts/replay-KL-real-snap.js`（132 行）** — 拿 KL session 190 raw 走真 Mapbox /matching
- Env: `CAIRN_JWT` + MAPBOX_TOKEN 硬编码
- CHUNK=80 pts + OVERLAP=10 拼接（`Math.hypot(...)>0.00005` 度过滤重复）
- `radiuses=` 参数按 accuracy clamp 到 10-40m
- `CONF_FALLBACK=0.3` — 若 Mapbox 返 conf<0.3，chunk 回落 raw
- 完整 4 步 replay：POST /sessions/start → PATCH /append-points（60 chunk） → PATCH /:id finalize（含 route_points snapped + route_points_raw）
- 写 `KL-raw.geojson` + `KL-snapped.geojson` 供视觉对比

**`scripts/replay-session-191.js`（127 行）** — v406 nested API replay 到 aliyun 真后端
- 全走 https://api.yiiling.cn（真生产）
- Load `docs/qa/sprint73-evidence/session191-slim.json`（154 raw pts）
- 4 步：start → append-points（60 chunk） → memory/points（10 evenly-spaced 采样）→ finalize（snap 模拟 = 隔一取一）
- 无 mock，纯 HTTPS

**`scripts/test-mapbox-kl.js`（40 行）** — 光测 Mapbox 返回 confidence（不写 backend）；用来调 radiuses 参数

**`scripts/snap-and-patch-192.js`（137 行）** — 类似 replay 但 in-place PATCH（先读老 session 再打 patch）

**改造成 NZ 场景可行性**：
- **高**：`gen-pudong-lujiazui-trace.js` 的架构就是「waypoints 数组 + 4 段速度/停顿混合 + 噪声注入」。改 WAYPOINTS + 段配置就够：
  - **Tongariro Crossing (20.2km 山地)** — 需 8-15 个 waypoints、加大海拔差（现在没有 alt）、失温段（速度 <0.5 m/s 加长停顿）
  - **Milford Track** — 加多个渡河点（速度→0，noise→大）
  - **Kepler Track** — 大 elevation gain + accuracy 阶跃（GPS 上山变差）
- **需要新增**：`accuracy` 字段升级到含 alt/alt_accuracy；不同噪声分布模型（山地 vs 平地）；battery/pause 事件生成
- **改动 <100 行**：把 WAYPOINTS 常量抽成 `presets/{tongariro,milford,kepler}.json`，`generatePath` 接入 preset name

### 关键发现

1. **Backend 单元测试真空** — 55+ API 端点、7 个 middleware/utils/model 模块，jest 覆盖为 0。所有验证靠上层 Playwright + 手工 replay 脚本。上线前值得补至少 `nonce.verify`、`deterministicCid`、`idempotency` 中间件、`markers/vote` handler 的单测。

2. **`memory_points` 表没有 migration 文件** — schema 只存在于 `backup/pre-friend-system-*.sql`（导出）和 spike Python 脚本里。新环境跑 001-019 migrations 会**缺表**。建议补 `020_memory_points.sql`。

3. **`/api/telemetry` 认证是 no-op** — `requireApiKey` middleware 直接 `next()`（backend/src/routes/telemetry.js:49-51）。注释里说"disabled for dev"。上线前必须开，否则任何人可写/读 telemetry_sessions（含 device fingerprint）。smoke-telemetry.js 的第 5 步"wrong key 应返 401"实际上永远不会满足——smoke test 会失败。

4. **v412 原子 `/api/sessions/:id/save`** 是当前最复杂的端点（175 行）：一个 tx 里锁 session row + UPDATE finalized_at + bulk INSERT memory_points（CHUNK=50）+ deterministicCid + 严格逐点校验（lat/lng/t/ts 有限、范围、整数）。已成熟。

5. **Mapbox 客户端调用**——backend 完全不代理 Mapbox。JWT 里没 Mapbox token，client 硬编码在 `replay-KL-real-snap.js:12`（也一定在 app 里）。**上线前风险**：token rotation 需要发 OTA；应当考虑 backend proxy /snap endpoint 加缓存。

6. **hidden_items 是 polymorphic** — item_type ENUM('mark','route') + item_id 没有 FK，靠 weekly cron `cleanHiddenItemsOrphans`（cron/cleanHiddenItemsOrphans.js）。物件被删而 hidden row 遗留是可能的。

7. **markers.text 上限 250** — v300 从 50 bumped 上来放 plant-flow title(30) + separator + body(200)。前端 UI 允许 30/200 分开输入的假设需要跟前 3 个 subagent 结果对齐。

8. **v025 worldmaps 用文件系统而非 DB** — `backend/storage/v025/worldmaps/*.arworldmap` 二进制。50MB cap。**scale 问题**：磁盘满没告警；同 spaceId 覆盖是设计如此（无版本）。生产迁 OSS 是必需的。

9. **feature_flags 无认证** — by design（ADR-008）。但 LIMIT 1000 硬编码 + 1MB body cap。若有多环境（dev/staging/prod）需靠环境变量区分数据库，不是路由分。

10. **Web Test Hook 分散在 7 处** —— `App.tsx` 一大块 + `RootNavigator.tsx` 2 处 + `crashLogger.ts` 1 处 + 3 个 service diagnostics 注释里的 `__cairnStores` 引用。清理清单要覆盖全部，注释可保留但避免 `getWriterState` 生产暴露。

## Cairn 测试塔提议（基于现有工具）

| Layer | 名称 | 用现有工具 | 缺什么 | 频率 |
|---|---|---|---|---|
| L1 | **单元** | jest (23 files, 2812 行) | **backend 完全空**：加 `backend/__tests__/{nonce,deterministicCid,idempotency,haversine,vote-handler}.test.js`（≥8 files） | 每 commit |
| L2 | **Web E2E** | playwright + `__cairnStores` + navigationRef + breadcrumbs (v406 hooks) | 前 3 个 subagent 报告里可能已提到 hook 需清理；上线前必须把 sprint71-74 的 baseline 跑通 headless 一遍看是否 hook 被删后崩 | 每 Sprint |
| L3 | **后端 API replay** | `replay-session-191.js`（真 aliyun）+ `smoke-telemetry.js` | 需要 `replay-marker-vote-anti-abuse.js`（打 impossible-travel/nonce-replay/gps-far/rate-limit 五路径） | 每 Sprint |
| L4 | **GPS 合成回放** | `gen-pudong-lujiazui-trace.js`（123 行架构清晰） | `presets/tongariro.json` + `presets/milford.json` + `presets/kepler.json` + gen script 参数化，≤2 天工作量 | 每 Sprint |
| L5 | **Web 视觉** | playwright + mapboxAdapter.web.tsx（前端 subagent 覆盖） | 需 baseline PNG regression 库（`docs/qa/visual-baseline/*.png`） | 每 Sprint |
| L6 | **iOS 真机功能** | 上海 TestFlight + Xcode Simulate Location (GPX) | 需 GPX 文件产出脚本（把 gen-*-trace.json 转 .gpx） | Sprint 末 |
| L7 | **iOS 真机户外** | 上海 + 朋友 NZ 真跑 | 上线前 2 次 | 上线前 |

**上线前必须补的测试基础设施**（3-5 条）：
1. **`backend/__tests__/`** — nonce HMAC / deterministicCid / idempotency middleware / markers vote 五路径 anti-abuse。防 regression。
2. **`020_memory_points.sql` migration** — 目前 memory_points 表结构不在 migrations 里，全新部署会 500。
3. **打开 `/api/telemetry` 的 API key**（把 `requireApiKey` 从 no-op 改成真校验，加 `CAIRN_TELEMETRY_API_KEY` env 到部署脚本），并加同 middleware 到 `/api/debug-snapshot`（现在完全无认证）。
4. **`scripts/gen-nz-tramping-trace.js`** — 复用现有 `gen-pudong-lujiazui-trace.js` 骨架加 tongariro/milford/kepler preset + alt 字段。产生 L4 合成回放能力。
5. **`docs/qa/visual-baseline/*.png` + playwright screenshot-compare** — 现有 playwright.sprint72 已经开 screenshot: only-on-failure，缺 baseline 对比。上线前 Web 视觉回归至少要 map 视图 + hike detail + memory 三张。
