# Cairn 算法 v6 接入分析报告 (HANDOFF)

> 文件: `algorithm-v6.mjs` (~543 行)  对照: `algorithm-思想-v6.md` (v6.7)
> 受众: 即将把算法接入 Cairn app 的工程师
> 本报告**仅分析现有代码**,不改写源码

---

## 第一部分: 导出接口完整列表

算法导出 7 个核心函数 + 7 个 V4 兼容别名。所有导出函数**不抛异常**,但部分会**修改传入的 marker 对象**(下表标注)。

### 1. `createMarker(opts)` — 创建 mark

**签名**:
```js
createMarker({ id, type, x, y, authorId, tCreate, isOfficial, authorRole, isRevived, historyAssets }) → markerObject
```

| 参数 | 类型 | 必需 | 含义 / 典型值 |
|---|---|---|---|
| `id` | string | 是 | mark 全局唯一 ID(产品层生成,如 UUID) |
| `type` | enum | 是 | `danger` / `supply` / `junction` / `scenic` / `cairn`,决定 base 寿命(365/540/540/730/540 天) |
| `x`, `y` | number | 是 | 经纬度。**算法本身不用**,只透传存储 |
| `authorId` | string | 是 | 创建者 user ID。算法用它阻止作者自赞自报(`addLike` / `addReport` 内判定) |
| `tCreate` | number(ms) | 否 | 创建时间戳(默认 0)。**所有时间字段都用 ms epoch** |
| `isOfficial` | bool | 否 | 是否官方(DOC 等)。**算法不豁免**,只透传存储 |
| `authorRole` | string | 否 | 默认 `'user'`。仅存储,算法不用 |
| `isRevived` | bool | 否 | 是否复活 mark |
| `historyAssets` | `{likes, reports}` | 否 | 复活时传入历史 like/report **数量**(数字,不是数组)。当 `total>=10 && likes/total>=0.7` 时给寿命加成,渐近上限 ~5x base |

**返回**: 完整 marker 对象(见第二部分)
**使用场景**: 用户在 app 上首次创建 mark / 后端复活 DEAD mark
**副作用**: 无(纯构造)

---

### 2. `recordView(marker)` — 记录被看到一次

**签名**: `recordView(marker) → void`
**使用场景**: 用户打开 AR 看到 mark 时调用一次,**必须每次 view 都调**(转化率分母靠它)
**副作用**: `marker.viewCount++`
**注意**: 算法**不去重 view**——同一 user 多次打开 AR 也会累加。如要按用户去重,需产品层包一层。

---

### 3. `addLike(marker, uid, t, reporter)` — 加点赞

**签名**: `addLike(marker, uid, t, reporter) → void`

| 参数 | 类型 | 含义 |
|---|---|---|
| `marker` | object | createMarker 返回的对象 |
| `uid` | string | 点赞用户 ID |
| `t` | number(ms) | 点赞时刻 |
| `reporter` | object | 点赞者信誉档案(见第三部分),可为 `null`(权重 1.0) |

**使用场景**: 用户在 AR 现场对 mark 点赞
**副作用**:
- 静默拒绝条件: 是作者本人 / 已点赞过 / 已举报过(1人1票永久互斥)
- 通过则 `marker.likes.push({ uid, t, weight })`,weight 由 `reputationWeight` 算出([0.2, 1.5])

---

### 4. `addReport(marker, uid, reasonCategory, t, reporter)` — 加举报

**签名**: `addReport(marker, uid, reasonCategory, t, reporter) → void`
**`reasonCategory`**: 见第四部分
**副作用**: 同 `addLike`,push 进 `marker.reports[]`,带 `severity`、`suppressedAt=0` 字段
**静默拒绝**: 同 addLike(作者 / 已 report / 已 like)

---

### 5. `lifeLeft(marker, tNow)` / `lifeLeftEffective(marker, tNow)`

**签名**: `lifeLeft(marker, tNow) → days`(可负)
**逻辑**: `(baseLifespanMs + extraLifespanMs - effectiveAgeMs) / DAY_MS`
**副作用**: 无(只读),但内部调 `effectiveAgeMs`(O(N) 扫所有 likes+reports)
`lifeLeftEffective` 是相同实现的别名(历史遗留)

---

### 6. `markerStatus(marker, tNow)` — **核心状态判定**

**签名**: `markerStatus(marker, tNow) → 'healthy' | 'suspicious' | 'critical' | 'heartbeat' | 'dead_natural' | 'dead_sick'`

**这是算法的入口函数**。按思想 v6.6 状态机判定,内部:
1. 调 `updateContinuousLifespan` 累加每 30 天的续命奖励(只在 healthy)
2. 检查 `lifeLeftEffective <= 0` → 直接 DEAD(寿命优先)
3. 调 `detectAcuteShift` 识别急转
4. 检查"持续负向"(60 天窗口、占比 ≥ 55%、加权等效条数 ≥ 4)
5. 急转 down 或持续负向 → 状态向恶化方向推进(冷却 21 天)
6. 急转 up 或近期正向 → 强心剂(回退一档 + 加 extraLifespan + 旧 report 标 `suppressedAt`)
7. 状态变化时更新 `marker.state` + `marker.stateEnteredAt`

**使用场景**: 决定展示前必调,也用于后端定时巡检
**副作用**: **大量修改 marker**——`state`, `stateEnteredAt`, `extraLifespanMs`, `lastBoostT`, `lastHeartStarterAt`, `reports[].suppressedAt`。**调用必落库**(见第五部分持久化)

---

### 7. `exposureRate(marker, tNow)` / `shouldRender(marker, tNow, rng)`

| 状态 | exposureRate |
|---|---|
| healthy / suspicious | 1.0 |
| critical | 0.30 |
| heartbeat | 0.05 |
| dead_natural / dead_sick / dead | 0.0 |

**注意**: `exposureRate` 读 `marker.state` 但**不更新它**。必须先调 `markerStatus` 才能拿最新状态。
`shouldRender` = 用 `rng()`(默认 `Math.random()`)和 `rate` 做伯努利采样,返回 bool。

---

## 第二部分: Marker 对象完整结构

`createMarker` 返回:

```js
{
  // === 不变字段(产品层来源,初始化后不改) ===
  id, type, x, y, authorId,
  tCreate,                  // ms
  isOfficial, authorRole,
  isRevived, historyAssets, // 透传

  // === 信号数组(append-only,不要删) ===
  likes:   [{ uid, t, weight }],
  reports: [{ uid, t, weight, reasonCategory, severity, suppressedAt }],

  // === 流量计数 ===
  viewCount: 0,             // recordView 加

  // === 状态机字段(算法内部维护,markerStatus 会改) ===
  state: 'healthy',         // 当前状态
  stateEnteredAt: tCreate,  // 进入当前状态时间(用于 21 天冷却)
  lastHeartStarterAt: 0,    // 最近一次强心剂时间
  lastBoostT: undefined,    // updateContinuousLifespan 的游标(首次进入 markerStatus 才被设置)

  // === 寿命系统(ms) ===
  baseLifespanMs,           // 创建即定,不再变
  extraLifespanMs: 0,       // 续命+强心剂累积加成
}
```

**外部禁改**: `state`, `stateEnteredAt`, `extraLifespanMs`, `lastBoostT`, `lastHeartStarterAt`, `likes/reports[].suppressedAt`,以及 `likes/reports/viewCount`(只能通过 add* 接口加)。
**外部可读**: 所有字段,UI 可直接展示 `likes.length / reports.length / state`。

---

## 第三部分: Reporter 信誉档案规格

`reporter` 是 `addLike` / `addReport` 第 4 参数。**算法只读不写**。产品层每次互动前组装一份新的传入。允许传 `null`(默认权重 1.0)。

| 字段 | 类型 | 含义 / 计算方式 |
|---|---|---|
| `daysSinceRegistration` | number | `(now - user.createdAt) / DAY_MS`。算法判定 < 30 天则 ×0.4 |
| `totalLikes` | number | 该用户**全平台累计点赞数**(终身,不是窗口) |
| `totalReports` | number | 全平台累计举报数 |
| `recentReportSpread` | number | **跨多少个不同 mark 在最近 N 天内被该用户举报**(去重 markerId)。算法判定 > 3 触发降权 |
| `recentDays` | number | 上面 spread 的窗口长度(天)。算法判定 < 7 才触发降权(即"7 天内跨 3+ mark 集中举报") |
| `confirmedTrueReports` | number | "经过验证为真"的历史 report 数。算法判定 ≥ 3 给 ×1.2 加成 |

**"confirmed true" 怎么定义?** — 代码没规定。产品层需要定一个机制:比如该 report 触发 mark 进 SUSPICIOUS 后最终走到 dead_sick,或者人工审核确认。**这是产品层接入时必须补的逻辑**。

**"7 天 / 3 mark" 是怎么用的?** — 注意 `recentReportSpread` 和 `recentDays` 是**两个独立字段**,产品层应每次调用前**实时计算**(查最近 7 天内该 user 的 report 涉及的 distinct markerId 数)。`recentDays` 推荐固定传 7。

最终权重 clamp 在 `[0.2, 1.5]`。

---

## 第四部分: Report 类型映射

代码 `SEVERITY` 表:

**v6.6 标准 3 类(产品层应只用这 3 个)**:
| reasonCategory | severity | 思想层语义 |
|---|---|---|
| `fake_ad` | 3.0 | 虚假广告(最高) |
| `info_mismatch` | 1.5 | 信息不符(中) |
| `dislike` | 0.5 | 不喜欢(最低) |

**旧兼容映射(代码保留,不应再传)**:
`info_wrong:1.5`, `outdated:1.5`, `wrong_location:1.0`, `not_useful:0.5`, `unsafe_to_visit:1.5`, `offensive:0.5`

**未知 category** → 默认 1.0(`severityOf` 兜底)

**产品 UI 建议(各 mark type 暴露的选项)**:

| mark type | UI 上的 reason 选项 → 算法 reasonCategory |
|---|---|
| danger | "信息已失效 / 标记不准" → `info_mismatch`; "我不认为这危险" → `dislike` |
| supply | "资源已没了" → `info_mismatch`; "广告 / 引流" → `fake_ad`; "我用不上" → `dislike` |
| junction | "路标不存在 / 位置错" → `info_mismatch`; "广告" → `fake_ad` |
| scenic | "广告 / 营销" → `fake_ad`; "和描述不符" → `info_mismatch`; "不喜欢" → `dislike` |
| cairn | 同 junction |

**严重度只影响处理力度**——`detectAcuteShift` 和 SUSPICIOUS 入口判定**不用 severity**,只在状态升级速度上微调(代码中 `severityBonus` 把 sustained 门槛 0.55 微降)。

---

## 第五部分: 接入流程(典型用户流程)

下面顺序与代码当前接口一一对应:

### 1. 用户建 mark
```js
const marker = createMarker({ id, type, x, y, authorId, tCreate: Date.now(), ... });
// 落库: 见下方持久化策略
```

### 2. 用户打开 AR 看到 mark
```js
recordView(marker);
saveMarker(marker);  // 至少 viewCount 字段
```
**性能注意**: 高 view 频次可考虑批量,但 viewCount 是转化率分母,**不能丢**。

### 3. 用户点赞 / 举报
```js
const reporter = await buildReporterProfile(uid);  // 查用户档案
addLike(marker, uid, Date.now(), reporter);
// 或
addReport(marker, uid, 'fake_ad', Date.now(), reporter);
saveMarker(marker);
```

### 4. 决定是否展示给某用户(陌生人)
```js
markerStatus(marker, Date.now());  // 必须先调,会修改 state
saveMarker(marker);                 // 状态可能变了,落库
if (shouldRender(marker, Date.now(), Math.random)) { 渲染 }
```
**已互动用户走 UI 个人化**(算法不管),`shouldRender` 只针对陌生人。

### 5. 何时调 markerStatus
**两种策略**:
- **实时(每次拉地图)**: 简单但高频时浪费,且 `markerStatus` 是 O(N) 扫所有 likes+reports
- **批处理 + 缓存(推荐)**: 后端定时(每 1-6 小时)对所有活跃 mark 跑一次 `markerStatus`,把 `state` 和 `exposureRate` 缓存。前端读缓存即可。新事件(like/report)发生时立即跑一次该 mark
- **混合**: DEAD 永远缓存;HEALTHY 缓存 1 小时;病期(suspicious/critical/heartbeat)缓存 10 分钟

### 6. 持久化策略(数据库 schema 建议)

**markers 表**(每行一个 marker):
```
id PK, type, x, y, authorId,
tCreate, isOfficial, authorRole, isRevived,
history_likes INT, history_reports INT,    -- 复活时用
viewCount,
state, stateEnteredAt,
lastHeartStarterAt, lastBoostT,
baseLifespanMs, extraLifespanMs,
updatedAt
```

**likes 表**(每行一个 like):
```
markerId FK, uid, t, weight, PRIMARY KEY(markerId, uid)
```

**reports 表**:
```
markerId FK, uid, t, weight, reasonCategory, severity, suppressedAt,
PRIMARY KEY(markerId, uid)
```

**关键索引**:
- `(markerId, t)` 在 likes/reports 上 — `detectAcuteShift` 按时间排序
- `(uid)` — 算 `recentReportSpread` 用
- `(state, type)` — 拉地图筛非 DEAD

**反序列化**: `markerStatus` 期望传入完整 marker 对象(含 likes/reports 数组)。如果 marker 含 1000+ reports,需考虑只加载窗口内的(但 `effectiveAgeMs` 需要全部 events,不能省)。

---

## 第六部分: 目前算法不够的地方

### 对照思想 v6.7 缺失

| 思想要求 | 代码状态 |
|---|---|
| DEAD 复活机制 | **缺 `reviveMarker(deadMarker, ...)` 接口**。`createMarker` 接受 `isRevived + historyAssets` 但调用方需自己拼装,且**历史 likes/reports 数组没有保留入口**——只接收 `{likes:N, reports:N}` 两个数字算寿命加成。思想要求"历史 like/report 全部保留",代码没实现 |
| 复活两层判断(资格 + 加成) | **资格判断完全没实现**。"历史信誉够 → 远程复活 / 一般 → 必须到场 / 差 → 不可复活"——代码完全在产品层 |
| 0 view 期慢速流失(0.3x) | ✅ 已实现 (`effectiveAgeMs` + `FROZEN_RATE = 0.3`,30 天沉默后启动) |
| 续命定期奖励(每 30 天) | ✅ 已实现 (`updateContinuousLifespan`) |
| 信号消化(强心剂后旧 report 降权) | ✅ 已实现 (`suppressedAt` 标 + `effectiveReportWeight × 0.2`) |
| 急转双向对称 | ✅ 已实现 |

### 代码本身的边界 case

1. **`tNow < marker.tCreate`(时钟回拨)** — `effectiveAgeMs` 返回负数,`lifeLeft` 变得很大。无防御
2. **`viewCount = 0` 但有 likes** — `conversionRateBoost` 的 `marker.viewCount < 5` 短路返回 1.0,正常。但若 viewCount=0 likes=100(异常数据),应抛错而代码静默返回 1.0
3. **`historyAssets.likes/reports` 是负数或 NaN** — 无校验
4. **重入安全** — `markerStatus` 修改 marker,**无锁**。多请求并发调同一 marker 会竞态(state 跳变、extraLifespan 双倍累加)。**产品层必须串行化每个 marker 的更新**(行级锁或队列)
5. **`updateContinuousLifespan` while 循环** — 如果 `lastBoostT` 损坏(远早于 tCreate),会跑成天文次数循环。无上限保护
6. **`lastBoostT` 初始化时机** — 只在 `updateContinuousLifespan` 里 lazy 设;新创建的 marker 落库时该字段是 `undefined`,反序列化要小心(JSON 会丢)。建议落库时显式存 null

### 性能问题(大数据量)

- **`markerStatus` = O(N + M)**(N=likes, M=reports)。1000 报告 mark 每次状态判定都全扫 → 高频拉地图卡
- **`detectAcuteShift` 内** 数组深拷贝 + sort,O((N+M) log (N+M))
- **`effectiveAgeMs`** 每次构建 events 数组并排序,O((N+M) log (N+M))
- **建议(产品层)**: 在 marker 上缓存"最近 60 天 like/report 索引",或在 markerStatus 入口前预过滤。代码层不做。

### 缺失接口

- ❌ **没有批量 `markerStatuses(markers, tNow)`** — 拉一屏地图 50 个 mark 各调一次
- ❌ **没有 `serializeMarker / deserializeMarker`** — 直接 JSON.stringify 可以,但反序列化时 `state` 等字段值合法性不校验
- ❌ **没有 `reviveMarker(oldMarker, tNow)`** — 复活逻辑产品层自己拼
- ❌ **没有 dry-run / explain 接口** — 调试时看不到为什么进了 SUSPICIOUS
- ❌ **没有事件溯源** — `markerStatus` 修改 state 没记历史,调试难

### 时区 / 时间戳精度

- 全用 ms epoch,**不涉及时区**(产品层注意)
- 所有窗口 ms 算,亚毫秒精度无意义
- 代码假定 `t` 单调递增。乱序事件(网络延迟后才落库)在 `detectAcuteShift` 内会被 sort 修正,但 `lastBoostT` 推进逻辑可能错位

---

## 第七部分: 产品层 vs 算法层职责划分

### 算法层负责(已实现)
- 状态机判定 (HEALTHY → SUSPICIOUS → CRITICAL → HEARTBEAT → DEAD)
- 急转识别(双向)
- 寿命计算(0 view 慢速 + 30 天续命奖励)
- 信号消化(强心剂后 report 降权)
- 信誉权重 + 严重度加权
- 互斥规则(1 人 1 票、作者不自赞、like/report 互斥)
- 曝光率与采样

### 产品层必须配合做(否则算法不工作)
1. **GPS 物理到场验证** — 算法假定所有进来的 like/report 都是真到场。产品层不挡 = 算法形同虚设
2. **IP / 设备指纹封锁** — 思想 §一第 10 条明确,可疑设备根本不进算法
3. **作者身份认证 / 反多账号** — 算法只比 `authorId === uid`,小号绕过靠产品层
4. **构建 reporter 信誉档案** — 6 个字段每次调用前查
5. **"confirmed true" report 的判定流程** — 算法只读 `confirmedTrueReports` 字段
6. **复活资格判断和触发** — 算法只接受 `isRevived + historyAssets`,何时允许复活、亲自到场 vs 远程,产品层定
7. **每个 marker 更新串行化** — 行级锁或队列,避免 markerStatus 竞态
8. **定时巡检** — 偏远 0 view mark 不会被前端触发 markerStatus,需要 cron 让寿命和状态推进
9. **report reasonCategory UI 映射** — 用户只看到中文选项,产品层映到 3 个 category
10. **DEAD 后 mark 处理** — 不再渲染、保留多久、何时归档

### 数据库层必须存
- markers 表(见第五部分 schema)
- likes / reports 表(全量,append-only)
- users 表(给 reporter 信誉档案用): `userId, createdAt, totalLikes, totalReports, confirmedTrueReports`
- user_actions 时间索引(算 `recentReportSpread`)

---

## 第八部分: 可改进方案(分优先级)

### P0(上线前必须)

1. **每个 marker 更新串行化** — markerStatus 改 state,不串行 = 双倍续命累加 / 状态错跳
2. **`lastBoostT` 默认值显式化** — 反序列化时 `undefined` → 用 `tCreate` 兜底,避免 while 跑飞
3. **时钟回拨防御** — 在 `lifeLeft / markerStatus` 入口加 `if (tNow < marker.tCreate) tNow = marker.tCreate;`
4. **`historyAssets` 校验** — 复活时 likes/reports 必须 ≥ 0 整数
5. **批量 status 接口** — 拉地图一次跑 N 个 marker,避免 N 次单独调
6. **持久化 `marker.state` 缓存** — 不要每次拉地图都跑全量计算

### P1(强烈建议)

7. **`reviveMarker(oldMarker, tNow)`** — 把分散的复活逻辑封装,内部决定资格 + 调 createMarker
8. **复活资格判定函数** — 输入 dead marker,返回 `'remote' | 'in_person' | 'forbidden'`,基于历史 like/report 占比 + 独立用户数 + 寿命
9. **`explainStatus(marker, tNow)`** — 返回判定理由(进 SUSPICIOUS 是因为急转 down rate ratio = 5.2),便于调试和申诉
10. **窗口缓存** — marker 上挂 `_recentSignalsCache: { tCutoff, likeW, reportW }`,减少全扫
11. **事件溯源** — markerStatus 内 state 变化时 push 一条 `stateHistory`(谁触发、当时 ratio)
12. **`reporter.confirmedTrueReports` 自动维护** — 后端 hook: mark 进 dead_sick 时,把所有进 SUSPICIOUS 之前的 report 标 confirmed
13. **`view` 去重** — 同 user 1 小时内多次 view 算 1 次(转化率分母更准)

### P2(可后期补)

14. **批量定时巡检 cron** — 扫所有非 DEAD marker 跑 markerStatus,推进偏远 mark 的寿命和状态
15. **状态变更 webhook** — mark 进 SUSPICIOUS / DEAD 时通知作者
16. **A/B 框架** — `exposureRate` 表外置,方便调整 0.30 / 0.05 这些常数
17. **新 reasonCategory 接入流程文档** — 加新 reason 时需更新 SEVERITY 表 + UI 映射 + 思想文档
18. **指标监控** — 各 type 的 SUSPICIOUS / DEAD 比例,异常时告警(如所有 supply 都进 SUSPICIOUS = 算法可能漂移)

---

## 关键文件路径

- 算法: `C:\ClaudeCodeProjects\Cairn\sandbox\algorithm-v6-release\algorithm-v6.mjs`
- 思想: `C:\ClaudeCodeProjects\Cairn\sandbox\algorithm-v6-release\algorithm-思想-v6.md`
