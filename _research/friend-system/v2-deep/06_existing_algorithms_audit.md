# 06 — 现有 Like / Report / Quality 算法考古报告

> 调研时间: 2026-06-27
> 目的: 在为 Public mark 设计密度筛选算法前,先彻底搞清楚现有代码库里"已经存在什么"。
> 纪律: 每行 reference 都是真实代码,不编造。

---

## TL;DR

| 系统 | 状态 | 在哪里 |
|---|---|---|
| **Like / Report 后端 (production)** | **存在 + 可用** | `backend/src/migrations/012_marker_community.sql` + `backend/src/routes/markers.js` |
| **Like / Report 前端 hook** | **存在 + 完整 (production-grade)** | `app/src/hooks/useLikeReport.ts` |
| **Like / Report UI** | **挂在 ARScreenLegacy,v025 路径下不渲染** | `app/src/components/LikeReportSheet.tsx` 仅在 `ARScreenLegacy` 里挂载 |
| **useCommunityStore (本地 like/report 状态机)** | **DEAD CODE** | 无任何消费者 |
| **算法 v6 (寿命 / 占比 / 投票即治疗)** | **设计完整 + sandbox 原型,未接入** | `sandbox/algorithm-v6.mjs` (542 行) + `sandbox/algorithm-思想-v6.md` |
| **Public mark 服务端发现/筛选 endpoint** | **不存在** | 没有 `GET /api/markers/public` 或 viewport-based query |
| **Quality score / ranking 落地代码** | **不存在 (production)** | 仅 sandbox 内有 |

---

## §1 — 现有 Like 代码 (每行真实 reference)

### 1.1 数据库 schema (production)

`backend/src/migrations/012_marker_community.sql:1-58`

- L20-24: ALTER markers ADD `helpful_count INT`, `report_count INT`, `status VARCHAR(16) DEFAULT 'healthy'`, `hidden_at DATETIME`
- L27-42: CREATE TABLE `marker_votes` — `(user_id, marker_id) UNIQUE`, `type ENUM('like','report')`, `reason VARCHAR(32)`, `reporter_lat/lng`, `distance_m`, `created_at`
- L48-58: CREATE TABLE `abuse_signals` — append-only telemetry (`rate_limit`, `gps_too_far`, `impossible_travel`, `replay_nonce_invalid`, `mocked_location`, `clock_skew`)

Canon (引自 schema 注释): **"一人一 mark 只能赞或举报一种 — 互斥, 永久 1 票 (不能改、不能撤)"** — 由 `UNIQUE(user_id, marker_id)` + 应用层无 UPDATE/DELETE 端点保证。

### 1.2 后端 API endpoints (production, mounted)

`backend/src/routes/markers.js`:

- L259-289 `GET /api/markers/:id/community-state` — 返回 `{helpful_count, report_count, status, hidden_at, user_vote}`
- L293-299 `GET /api/markers/:id/interact-nonce` — 短期 HMAC nonce (防 replay)
- L306-477 `POST /api/markers/:id/vote` — 单点提交 like 或 report,服务端有:
  - L48-83 速率限制: like 30/min;report 5/min + 20/hour
  - L323-348 nonce 验证 + 时钟偏差 (`MAX_TIMESTAMP_SKEW_MS = 60000`)
  - L329-330 GPS 精度门限 (`MAX_GPS_ACCURACY_M = 100`)
  - L356-373 距离门限 (`SERVER_INTERACT_RANGE_M = 50`,30m AR + 20m GPS margin) — 用户必须物理到场
  - L380-401 不可能旅行检测 (5km / 60s)
  - L406-412 `INSERT IGNORE marker_votes` (利用 UNIQUE 保证 mutex)
  - L413-429 409 Conflict 时返回 `existing_vote` 给客户端
  - L433-451 计数器递增 + `report_count >= REPORT_HIDE_THRESHOLD (=5)` 自动 `status='hidden'`

### 1.3 前端 hook (production-grade,完整实现)

`app/src/hooks/useLikeReport.ts:1-294` — 用户在 v199 时硬化过,有 mountedRef、abortController、stable callback refs、5s 撤回 (canon §一-4 严格遵守: 撤回期内 request 不发)、issueNonce → postVote、9 类 error 分支。

接口:
- `scheduleLike(userPos, undoMs=5000) → cancelFn` (L238-256)
- `submitReport(reason, userPos) → Promise<CommunityState | null>` (L258-261)
- 每 8s 轮询 `community-state` (L116-136)

### 1.4 前端 UI (mounted, 但 production 路径下不可见)

`app/src/components/LikeReportSheet.tsx:1-?` (前 80 行已读) — bottom sheet,5s 撤回 toast,3 类 reason 选择 (`fake_ad`/`info_mismatch`/`dislike`),距离超出 `arInteractRangeM` 时显示 "get closer"。

**挂载点**: `app/src/screens/ARScreenLegacy.tsx:43` (import), L1579-1589 (JSX 挂载,条件 `ARUiState === 'aim-locked' || 'report-reason'`)。

**Production 不可见的原因**: `app/src/screens/ARScreen.tsx:17-23` 根据 `useV025Enabled()` 路由——`true` 走 `ARScreenV2`,`false` 走 Legacy。服务端默认 `useV025=true` (`backend/src/migrations/015b_feature_flags.sql:15`),而 `ARScreenV2.tsx` grep 结果显示 **不包含任何 `LikeReportSheet` 或 `useLikeReport` import**。

→ **结论: like/report UI 是写过但 v025 切上线后丢了的功能。** 后端依然 live,前端代码依然在,只是没人调用。

---

## §2 — 现有 Report 代码

Report 与 like 共用同一套基础设施 (单 endpoint, 单表, 单 hook)。差异点:

- 3 类 reason: `fake_ad` / `info_mismatch` / `dislike` (`useLikeReport.ts:15`)
- 无撤回 (`useLikeReport.ts:258-261` 直接 POST,不走 5s timer)
- 后端门限不同 (L60-83): 5/min + 20/hour
- `report_count >= 5` 时 `markers.status='hidden'` (`markers.js:444-450`,常量 L34 `REPORT_HIDE_THRESHOLD = 5`)

---

## §3 — 现有 Quality / Ranking 代码

### 3.1 Production: 几乎没有

Production 后端的"质量"只有一个动作: `report_count >= 5 → status='hidden'`。无 ranking,无 quality score,无排序。

`GET /api/markers/` (`markers.js:101-113`) 只返回**当前用户自己的** markers,按 `created_at DESC`,不暴露 helpful_count/report_count 给查询。

**关键缺口**: 没有 `GET /api/markers/public` 或 viewport-based 公共 mark 发现 endpoint。Public mark 在 schema 上能标 (`permission='public'`), 但没有任何 API 让陌生人看到别人的 public mark。`GET /api/friends/:id/markers` (`friends.js:159-184`) 只能拉**已 confirmed 的好友**的 public+group。

### 3.2 Sandbox: 完整算法 v6 (542 行,未接入)

`sandbox/algorithm-v6.mjs` (542 行) + `sandbox/algorithm-思想-v6.md` (~430 行,v6.7)。

接口 (摘自 `sandbox/algorithm-v6-release/HANDOFF.md`):
- `createMarker(opts)` — 给 mark 一个 base 寿命 (danger=365天 / supply=540 / junction=540 / scenic=730 / cairn=540)
- `recordView(marker)` — viewCount++ (转化率分母)
- `addLike(marker, uid, t, reporter)` / `addReport(marker, uid, t, reporter, severity)` — 双时钟模型 (自然衰减 + 治疗时钟)
- 5 大状态: `HEALTHY / SUSPICIOUS / CRITICAL / HEARTBEAT / DEAD`
- Reporter 信誉权重 + Report 严重度 (虚假广告 > 信息不符 > 不喜欢)

**接入证据搜索**: backend 下唯一引用 `algorithm-思想-v6.md` 的文件是 `migrations/012_marker_community.sql:3` 和 `utils/abuseSignals.js:6` (注释里说"为 v2 model trains"),**没有任何 import / require / 调用**。

→ **结论: 思想成熟,sandbox 跑通过 chaos test (`chaos-monkey-v6.mjs`),但 production 没接。**

### 3.3 历史 spike

`_spike/*` 都是 fog-of-war / radius / Mapbox 相关,**没有 like/report/quality 主题的 spike**。`_research/friend-system/*` 是 friend system 的前期 brainstorm,与 like/report 算法本身无关。

---

## §4 — Community Store 现状

`app/src/store/useCommunityStore.ts:1-203` — 完整实现的 Zustand store:

- 数据模型: `CommunityMarker { helpfulVotes, notHelpfulVotes, reportCount, isHidden }`
- 操作: `voteHelpful` / `voteNotHelpful` / `reportMarker` (本地状态机,**不调后端**)
- 自动隐藏门限: L63 `REPORT_HIDE_THRESHOLD = 5`,L64 `VOTE_HIDE_THRESHOLD = -10` (helpful - notHelpful)
- 集群: L147-187 `getClusters(zoomLevel)` — 50m radius × `Math.pow(2, 15-zoom)`,>=5 个 mark 合一个 cluster
- 显示门限: L72 `maxDisplayCount = 50`,L142-144 按 `helpfulVotes - notHelpfulVotes` 排序后 slice
- AsyncStorage 持久化

**消费者**: 用 `grep useCommunityStore` 在整个 `app/` 下查 — **只有定义文件自身**。无 import,无消费者。

→ **结论: 100% dead code。** 是 Sprint 51 STORY-00174 时写的"Phase 3 E-005 community shared markers"实现,后来 v199 重做 like/report 时被 server-authoritative 模式取代,这个 store 就没人用了。**但它的 cluster + maxDisplay + helpful-rank 排序算法对当下的 Public mark 密度筛选有参考价值。**

### 4.1 useMarkerStore (production)

`app/src/store/useMarkerStore.ts:1-394` (查到 30 个 match) — 用户**自己**的 marker store。`loadFromBackend` 只拉自己的。**不涉及他人 public mark**。

---

## §5 — Public Mark 密度筛选 v1 推荐算法

### 5.1 现状约束

1. 后端**没有** "viewport 内 public mark"endpoint — 必须先在 backend 加一个 (例如 `GET /api/markers/public?bbox=&limit=`)。
2. 后端**有** `markers.status='hidden'` (来自 report_count >=5),自然可以作为 WHERE 过滤条件。
3. 后端**有** `helpful_count` + `report_count` 字段,可直接参与排序。
4. 算法 v6 (sandbox) 不接,**保持 minimal**——用户原话"有一个简单的小算法"。

### 5.2 v1 算法 (推荐,minimal)

**好友 mark**: 不筛选,100% 展示 (用户原话: "好友数量有限,可以全展示")。

**Public mark**: server-side 单查询完成,客户端不二次计算:

```sql
-- 概念性 SQL (实际需要参数化 + 索引)
SELECT id, type, lat, lng, text, permission,
       helpful_count, report_count, public_snapshot, created_at,
       /* quality_score = helpful - 2*report,新鲜度加成在 30 天内衰减 */
       (helpful_count - 2 * report_count
        + GREATEST(0, 5 - DATEDIFF(NOW(), created_at) / 6)) AS quality_score
FROM markers
WHERE permission = 'public'
  AND status != 'hidden'              -- 自动隐藏的 report>=5 mark 不进
  AND lat BETWEEN ? AND ?              -- viewport bbox
  AND lng BETWEEN ? AND ?
  AND user_id != ?                     -- 不返回自己创建的 (前端单独叠加)
ORDER BY quality_score DESC, created_at DESC
LIMIT 50;                              -- viewport 硬上限
```

**4 条核心规则**:

1. **viewport 上限 50 个 Public mark** — 与 `useCommunityStore.maxDisplayCount = 50` 一致,经验值。如果地图缩到全国级别也是 50,服务端不分 zoom。
2. **筛选优先级**: `quality_score DESC, created_at DESC`。Quality = `helpful - 2*report + freshness_bonus`,30 天内的 mark 每天加 (5 - days/6) 分,30 天后归 0。**报告比点赞权重大 (2:1)** —— 因为 cairn 的核心场景是"避坑",负面信号更重要。
3. **不需要 like 字段就能跑** — `helpful_count` 字段已经在 schema 里 (`012_marker_community.sql:21`) 且 production 后端在写。即使从来没有用户点过赞,`quality_score` = `-2*report_count + freshness`,依然有效。**唯一前提**: production 必须暴露这个 helpful/report 数字给陌生人 (现在 `community-state` endpoint 只对**单个** marker 返回,需扩展或新建 viewport endpoint)。
4. **status='hidden' 自然兜底** — 不需要前端做任何 cluster/dismiss 逻辑,后端已经把恶心的 mark 过滤掉了。

### 5.3 v1 不做什么 (anti-overengineering)

- ❌ **不做** cluster (`useCommunityStore.getClusters`) — 50 个 mark 直接撒在 viewport 上即可,DS 的密度也大概在这个量级。等用户反馈"还是太多了"再做。
- ❌ **不接** algorithm-v6.mjs 寿命模型 — 巨大引擎,2-3 个 Sprint 起步,对 v1 用户感受**无可见提升**。
- ❌ **不做** 个性化 (基于用户活动半径推荐) — 等有遥测数据再做。
- ❌ **不做** 客户端二次筛选 — 服务端 LIMIT 50 后,客户端全部展示;否则用户看到 25 个但 scroll/zoom 突然变 50 个,UX 抖动。

### 5.4 实现工作量估计

| 任务 | 工时 |
|---|---|
| 后端: 加 `GET /api/markers/public?bbox=...` endpoint | 0.5 天 |
| 后端: bbox 索引 (`CREATE INDEX idx_markers_public_bbox ON markers(permission, status, lat, lng)`) | 0.25 天 |
| 前端: useCommunityStore 重写为 server-driven (扔掉本地状态机) | 0.5 天 |
| 前端: MapScreen 集成 + viewport debounce (300ms) | 0.5 天 |
| QA: 数据库压力测试 (10k public marks scenario) | 0.5 天 |
| **合计** | **~2.5 天** (1 个 Story,5 点) |

可以挂在一个 Sprint 里。

### 5.5 升级路径 (v2, 不在本次范围)

如果 v1 上线后用户反馈"地图上 mark 太多"或"高质量内容看不到":

- **v2a**: 重新启用 `useCommunityStore.getClusters` 的 50m 集群逻辑 (zoom-aware)。
- **v2b**: `quality_score` 公式调权 (例如加入 view_count 转化率)。
- **v2c**: 接入 algorithm-v6 寿命/治疗模型 (DEAD mark 不查,HEARTBEAT mark 加 boost 系数)。

---

## §6 — 风险

### 6.1 like/report UI 死在 v025 路径下 (高优先级)

最大风险点: production 用户 (走 `ARScreenV2`) **看不到 LikeReportSheet**。意味着自 v025 上线起,production 完全没有 like/report 数据进入数据库。

**影响 v1 算法**: 如果 `helpful_count = 0, report_count = 0` 对所有 public mark 都成立,`quality_score` 退化为纯 `freshness_bonus + 0`,排序变成 "按创建时间降序"。

**修复方案** (在 v1 之前): 把 `LikeReportSheet` 挂到 `ARScreenV2` 上。这是 1 个 Story 的工作量,不复杂。

### 6.2 Public mark 没有 "陌生人能拉到" 的 endpoint

如 §3.1 / §5.1 说明。必须先加 endpoint,才能谈密度筛选。这是 v1 算法的硬前置依赖。

### 6.3 数据库索引缺失

`markers` 表目前在 `permission` + `status` + `lat`/`lng` 上没有联合索引 (没看到 migration)。如果 public mark 量上去,bbox 查询会全表扫。需要补:

```sql
CREATE INDEX idx_markers_public_geo ON markers(permission, status, lat, lng);
```

### 6.4 algorithm-v6 思想 vs 简化 v1 的张力

`sandbox/algorithm-思想-v6.md` 写过寿命/治疗的精密模型 (5 状态机 + 双时钟 + reporter 信誉权重)。v1 的 `quality_score = helpful - 2*report + freshness` 是它的极简退化。
- **风险**: 用户日后想接入 v6 时,v1 字段不够 (没存 viewCount / lastInteract / reporterTrust)。
- **缓解**: v1 字段全部是 v6 的子集,**升级时只需在后端加列 + 重算**,不会丢数据,不会破坏 API。可以放心做 v1。

### 6.5 useCommunityStore dead code 残留

`app/src/store/useCommunityStore.ts` 203 行 dead code,有 cluster 算法 + 持久化。如果 v1 做 server-driven,应该:
- (a) 直接删除 (推荐),OR
- (b) 重写为只缓存 server 返回的 50 个 mark,不再做本地 vote/report (这些走 useLikeReport hook)。

不要让两个 store 都在跑——容易出现状态不一致 bug。

---

## 附: 文件清单速查

| 路径 | 行数 | 状态 |
|---|---|---|
| `backend/src/migrations/012_marker_community.sql` | 58 | production live |
| `backend/src/routes/markers.js` | 481 | production live |
| `backend/src/utils/abuseSignals.js` | ? | production live (telemetry) |
| `app/src/hooks/useLikeReport.ts` | 294 | wired into ARScreenLegacy only |
| `app/src/components/LikeReportSheet.tsx` | ? | wired into ARScreenLegacy only |
| `app/src/screens/ARScreenLegacy.tsx` | 1500+ | v025=false 时才走 |
| `app/src/screens/v025/ARScreenV2.tsx` | ~230 | **没有 import LikeReportSheet** |
| `app/src/store/useCommunityStore.ts` | 203 | **dead code, 无消费者** |
| `sandbox/algorithm-v6.mjs` | 542 | sandbox 原型,未接入 |
| `sandbox/algorithm-思想-v6.md` | ~430 | 思想文档 |
| `sandbox/algorithm-v6-release/HANDOFF.md` | ? | 接入分析,未执行 |
