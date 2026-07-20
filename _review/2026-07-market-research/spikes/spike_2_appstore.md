# Spike 2: App Store 评论爬取可行性

[STARTED T+0]

## 结论
**能爬取,推荐用方法 A(官方 iTunes RSS Customer Reviews Feed)。所有 4 个目标 App × 4 个区域全部可爬,单区上限 500 条(10 页 × 50 条/页,按 mostRecent 或 mostHelpful 排序)。star 筛选无法在 API 端做,只能拉回后本地按 `im:rating` 字段过滤。**

## 关键订正
用户 brief 里给的 app id **有两个是错的**:
- Polarsteps: brief 写 `943883369`,实际 = `947925763` (via `itunes.apple.com/search?term=polarsteps`)
- Fog of World: brief 写 `560696852`,实际 = `505367096`
- Day One 1044867788、AllTrails 405075943 正确

错误 id 在所有区域 lookup 都返回 `resultCount: 0`,RSS 返回 878 字节空 feed。**必须用正确 id 才能拿到数据。**

---

## 方法 A: 官方 iTunes RSS Customer Reviews (可用)

### 端点
```
https://itunes.apple.com/{region}/rss/customerreviews/id={app_id}/sortBy={sort}/page={n}/json
```

### 实测参数
- **region 编码**: `us`, `gb`(不是 uk!), `au`, `nz` — uk 返回空 body(0 字节)
- **每页数量**: 50 条(固定)
- **最大页数**: 10 (feed 的 `link[rel=last]` 明确写死 page=10,page 11+ 返回 67 字节空 XML)
- **单区域上限**: 50 × 10 = **500 条评论**
- **sortBy 支持**:
  - `mostRecent` → 返回 50 条 ✓
  - `mostHelpful` → 返回 50 条 ✓
  - `mostFavorable` → 返回 0 条(feed 存在但 entry 数组空)
  - `mostCritical` → 返回 0 条
- **星级筛选**: 不支持。star 只能拉回后按 entry `im:rating.label` (值 "1"~"5") 本地过滤

### 返回字段(每条 review)
```json
{
  "im:rating": {"label": "5"},          // 星级 1-5
  "title": {"label": "Great tour diary"},
  "content": {"label": "This app is great for..."},
  "author": {"name": {"label": "..."}},
  "updated": {"label": "2026-07-11T20:53:44-07:00"},
  "im:version": {"label": "10.1.0"}
}
```

### 覆盖矩阵实测(全 real fetch)

| App | US | GB | AU | NZ |
|---|---|---|---|---|
| Polarsteps (947925763) | 500 (10p) | 450 (10p) | 450 (10p) | 56 (3p) |
| Day One (1044867788) | 500 (10p) | 500 (10p) | 500 (10p) | ~99+ |
| AllTrails (405075943) | 500 (10p) | 500 (10p) | 500 (10p) | 99 (2p) |
| Fog of World (505367096) | 500 (10p) | 100 (3p) | 72 (2p) | 18 (1p) |

**总可爬评论 = 约 4770 条**(4 app × 4 region 合计,考虑到 NZ 小 + Fog 边缘区)

### 全区总评分数据(via `itunes.apple.com/lookup?id=X&country=Y`)
- Day One US: 117254 ratings, 4.83
- AllTrails US: 1033044 ratings, 4.89
- 但 RSS **只暴露最新/最有帮助的 500 条**,不是全部历史

## 方法 B: 网页直接爬(不可行)
- `curl` App Store HTML (NZ locale) → 2MB 页面里 **0 个 review 相关 JSON 字段**(grep `userReview`/`ratingCount` 全 0 hit)
- App Store web 的评论区靠内部 AMP API (`amp-api.apps.apple.com/v1/catalog/.../reviews`) 加载,需要动态 JWT token — HTTP 500 without auth
- Playwright 打开 NZ 页面直接被重定向到 CN(网络出口 geo-block),即使拿到也是 lazy-load,不比 RSS 好

## 方法 C: WebSearch site:apps.apple.com
未测试(方法 A 已完全解决问题,不必要浪费 tool call)

## 方法 D: 第三方 API
未测试(方法 A 完全免费,无 rate limit 迹象,无需引入付费服务如 AppFigures/SensorTower)

---

## 单个 App 成本估算

**Per (app, region, sort) 组合 = 最多 10 pages = 10 curl call ≈ 30 秒**

| 任务 | Tool call 数 | 时间 |
|---|---|---|
| Polarsteps NZ 全部评论 (56 条) | 3 curl | ~10s |
| Polarsteps 全 4 区 mostRecent | 10+10+10+3 = 33 | ~2 min |
| 4 App × 4 区 × mostRecent+mostHelpful | 约 250 curl | ~10 min |
| **推荐:** 4 App × 4 区 × 只用 mostRecent | ~130 curl | ~5 min |

用一个 shell for-loop 一次跑完,不用 20 个 tool call,一个 Bash 就够。

---

## 推荐方案

1. **用方法 A RSS**,以 mostRecent 为主(mostHelpful 冗余度高,同一批老 review 被多次返回)
2. 循环 4 apps × 4 regions × pages 1-10,单 Bash 脚本,存到本地 JSON
3. 本地脚本按 `im:rating.label` 分星级、按 `updated` 年份筛选
4. **注意 gb 用 gb 不用 uk;NZ Fog 数据太少(18 条)可考虑合并 AU+NZ**
5. **两个 app id 用订正后的值**:Polarsteps=947925763, Fog of World=505367096

### 局限
- 单区上限 500 条(Apple 官方硬限),历史评论无法回溯到 App 上线以来
- 星级筛选只能事后本地做(API 层 mostFavorable/mostCritical 返回空)
- Version 字段可用 → 能按 app 版本切片(如"Polarsteps v10.1.0 后差评趋势")

[COMPLETED]
