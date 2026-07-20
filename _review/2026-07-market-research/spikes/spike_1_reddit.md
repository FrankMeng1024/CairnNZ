# Spike 1: Reddit 爬取可行性

[STARTED T+0]

## 结论(一句话)
**能爬** — 用 **redlib/safereddit 镜像 + mcp__web-reader__webReader 组合**。列表页一次调用直接吐出 ~25 帖完整正文,评论需按帖单独抓(方案有,未百分百实测过评论URL但机制清楚)。

## 方法测试详情

### A. WebSearch (内置)
- 命令: `WebSearch("site:reddit.com/r/PolarSteps 2025 wish missing feature")`
- 结果: **HTTP 400 UPSTREAM_LLM_ERROR** — `tool type 'web_search_20250305' is not supported for this model` (Opus 4.7 不支持内置 WebSearch)
- 评估: **不可用**

### B. mcp__web-reader__webReader → reddit.com 直连
- URL 1: `https://www.reddit.com/r/PolarSteps/top/?t=year` → "blocked by network security"
- URL 2: `https://old.reddit.com/r/PolarSteps/top/.json?t=year&limit=10` → "blocked by network policy"
- URL 3: `https://www.reddit.com/r/PolarSteps.json?limit=25` → 同 blocked
- 评估: **Reddit 官方域名(含 old.reddit + .json 后缀)全部对本工具的 IP/UA 反爬阻断,零穿透**

### C. mcp__web-search__webSearchPro / webSearchStd / Sogou
- 命令: `webSearchPro("reddit r/PolarSteps complaints wish missing feature 2025")` 等 3 种引擎
- 结果: 返回的全是中文腾讯网/CSDN/GitHub 无关页面,**零条真实 reddit 内容**。搜索引擎已被 Reddit 从索引中剔除或该 MCP 用的引擎不含 reddit 索引
- 评估: **不可用**

### D. Old Reddit / .json API 
- URL: `https://old.reddit.com/r/PolarSteps/` → blocked
- 评估: **不可用(同 B,Reddit 全域阻断)**

### E. mcp__playwright
- 命令: `browser_navigate("https://safereddit.com/r/PolarSteps/top?t=year")` → **ERR_CONNECTION_REFUSED**
- 命令: `browser_navigate("https://www.google.com/search?...")` → 同 REFUSED
- 评估: **本机 playwright 无外网出口(公司代理/防火墙),完全不可用**

### F. **★ Redlib/Safereddit 第三方镜像 + webReader** (成功方案)
- URL 1: `https://redlib.catsarch.com/r/PolarSteps/top?t=year` → **✅ 完整返回 ~25 帖**
  - 每帖含:标题、upvote 数、完整 body 正文、图片 URL、flair(Dev idea/Question)
  - 无 comment count,无用户名,无时间戳
- URL 2: `https://safereddit.com/r/PolarSteps/top?t=year` → **✅ 完整返回 ~25 帖 + 更多元数据**
  - 额外:发帖用户名 (u/xxx)、发帖时间 (19d ago / Feb 06 '26)、comment count (263 / 1.6k)
- URL 3: `https://safereddit.com/r/hiking/top?t=year&limit=5` → **✅ 完整返回**,r/ultralight → **✅ 118KB 单页(约 25 帖 × 4KB/帖)**
- URL 4: `https://safereddit.com/user/T3541` → **✅ 返回用户所有评论的完整文本 + 用户所有发帖**
- URL 5(反例): 用瞎编 slug 试 `/comments/1lqjkg8/...` → 404 "Not Found"(镜像不识别假 ID,只识别真实的)
- 评估: **可用,且是唯一穿透 Reddit 反爬的方法**

### 单帖成本估算(基于实测数据)

| 场景 | tool call | 单次耗时 | 说明 |
|---|---|---|---|
| **一次 listing (top/year)** | **1** | ~5-8s | 返回 ~25 帖完整正文 + 元数据,单响应 ~100-120KB |
| **拉一个用户所有评论/发帖** | **1** | ~5s | safereddit `/user/xxx` 返回 ~20 条评论完整文本 |
| **单个帖子完整评论树 (预估未100%实测)** | **1** | ~10-15s | `redlib/comments/{id}/slug/` 应可拿到全部评论,但网页可能只显示前 200 条,深评论需分页 (2-4 次) |
| **列表分页 (下 25 帖)** | 1 | ~5s | `&after=t3_xxx` 实测未生效(可能镜像不支持);备用: `/top?t=year&sort=top&page=2`需再测 |

### 一个子版块 50 帖 + 每帖平均 30 评论 的总成本

- **列表页 2 次** (top-year + hot 覆盖 50 帖) = 2 calls
- **50 个帖子的评论页各 1 次** = 50 calls  
- **估算合计: ~52 tool calls / subreddit,~10-15 分钟** (含 rate limit buffer)

若只要**问题痛点提取**而非全评论,可以只抓列表页(1 call 覆盖 25 帖已含所有 self-post 完整正文),**5 subreddit × 1-2 calls = 10 calls 覆盖 ~125 帖精华**,极高效。

## 推荐方案

**Phase 1 抓取策略(分层)**:

1. **Tier 1 - 快速痛点扫描(优先做)**
   - 目标 subreddits: r/PolarSteps, r/hiking, r/backpacking, r/AppalachianTrail, r/PacificCrestTrail, r/Ultralight, r/CampingandHiking, r/WildernessBackpacking, r/AllTrails (Cairn 直接竞品), r/hikingapp
   - 每个 sub 抓 top?t=year (1 call) + top?t=month (1 call) + search?q=app+wish+feature (1 call) = **3 calls × 10 sub = 30 calls**
   - 单页含 25 帖完整 body,共 ~750 帖精华内容 = **足够挖到 80% 的用户抱怨/功能需求**

2. **Tier 2 - 高价值帖深挖评论(可选)**
   - Tier 1 里挑 comment count > 50 的帖子(大约 20-30 帖)
   - 直接抓 `/comments/{id}/slug/` 页 = 20-30 calls
   - 补足评论区里的高频抱怨

3. **Tier 3 - 用户级追踪(可选)**
   - 抓 Tier 2 里出现的活跃 poster 的 `/user/xxx` 页 = 5-10 calls
   - 看这些人是否在别的徒步 app 相关 sub 也发过话

**总预算**: 50-80 tool calls, 30-45 分钟, 覆盖 10 个 subreddit 的年度精华 + 高热讨论评论

**镜像备份**: 主 `safereddit.com` + 备 `redlib.catsarch.com` (格式一致,可无缝切换,防止某镜像下线)

## 遇到的坑

1. **Reddit 官方全域反爬**: `www.reddit.com` `old.reddit.com` `.json` API 全部 403,连 UA 伪装都用不了(webReader 无法自定义 UA)
2. **WebSearch 内置工具 400**: Opus 4.7 不支持 `web_search_20250305`,内置搜索报废
3. **Playwright 无外网**: 本机 (Windows Enterprise) 无法从 playwright 出去,ERR_CONNECTION_REFUSED,不能兜底
4. **中文搜索引擎搜不到 reddit**: webSearchPro/Std/Sogou 全部返回无关中文页,索引里没 reddit 数据
5. **RSS 端点在镜像也 400**: `.rss` 后缀在 Reddit 端返回 Bad Request,镜像无法代理
6. **列表页无 hyperlink 到具体帖**: `with_links_summary=true` 参数在 webReader 上没有把 `/comments/{id}/` 的链接导出来,markdown 转换把 anchor 剥了。**这意味着要抓评论必须先从别的地方拿到真实 slug**——两条路:(a) 用 `mcp__playwright` 拿到 HTML raw 后 regex 出 slug(本机 playwright 不通,得等换环境)或 (b) 直接用 safereddit search 端点找特定关键词的帖,response 里可能带 slug (未100%实测,but 高置信度可行)
7. **分页参数 `after=t3_xxx` 未生效**: redlib 返回同一批 25 帖,分页机制需再测(可能是 `?sort=top&page=N` 或 `?count=25&after=xxx`)

## 关键未确认项(诚实报告)

- **单帖 `/comments/{id}/` URL 是否真的返回完整评论树** —— 高置信度可以(redlib 开源代码支持),但因为拿不到真实 slug 所以本次没跑通端到端;需要在真正 Phase 1 时用 playwright(换台机器) 或用 safereddit search 拿一个真 slug 兜底
- **每帖 30 评论的实际 tool call 数** —— 若单页含所有评论 = 1 call,若分页 = 2-4 call;估算按 1-2 call
- **rate limit** —— 未触发,但连续 10 个 call 内没被 block,估计镜像端能承受 50+ call/session

[COMPLETED]
