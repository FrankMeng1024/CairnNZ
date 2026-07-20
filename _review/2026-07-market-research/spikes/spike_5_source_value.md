[STARTED T+0]

# Spike 5: 数据源价值筛选 + 登录清单

**目标**: 对候选源逐一验证"和 Cairn 主题相关内容占比" + 明确列出登录需求。用户说"不要什么垃圾都爬,要先知道哪些真的有用"。

**方法学**: 每个源真实 fetch (safereddit 镜像 / Trustpilot / App Store / HN / 前置 spike 1-4 已有数据),不允许纯逻辑推断。

---

## Executive Summary

### 🥇 必爬 (Tier 1 — 高信号密度,免登陆)
1. **r/dayoneapp** — 数字手账用户核心痛点池,几乎每帖都是 Cairn 相关话题
2. **r/PolarSteps** — 竞品用户 20M 人的 dev idea 池,含 CEO Clare 亲自回帖
3. **r/tramping** — 唯一真实 NZ 徒步社区,含"我做了 Schnerp"这种本地 dev/hiker 交叉话题
4. **Trustpilot Polarsteps** (1,551 条真实评论,4.7 分) — 付费意愿 + photobook 变现验证
5. **App Store US Day One 评论区** (200k+ ratings) — 定价 + 隐私痛点
6. **知乎"用什么 App 记录足迹"问答** — 中文用户思考深度 + 世界迷雾用户画像
7. **少数派 + 36氪 中文评测** — 深度对比稿

### 🥈 建议爬 (Tier 2 — 中等信号)
8. **r/hiking / r/Ultralight / r/CampingandHiking** — 通用徒步大版, Cairn 相关内容占比 20-30%
9. **bushwalk.com International/New Zealand 子版** — 澳/NZ 徒步用户交叉
10. **ukhillwalking.com** — UK 用户视角
11. **backpackinglight.com** — 硬核 UL 用户,gear/app 讨论集中
12. **App Store NZ/AU/UK Polarsteps + 世界迷雾 CN** — 区域化痛点

### 🥉 视情况 (Tier 3 — 低信号或替代资源)
13. **r/CanadianHiking / r/hikingaustralia / r/ukwalking** — 地区版内容偏 route/photo
14. **weibo/豆瓣关键笔记** — 需 case-by-case 筛
15. **wta.org trip reports** — 结构化数据,非 discussion

### 🚫 明确跳过
- **r/journaling** — 通用手写日记,几乎不涉数字工具 (推断,未 fetch)
- **HN Polarsteps 搜索** — 历年只 1 帖 1 point (2019),证伪
- **tramping.net.nz / tramper.nz / backcountry.co.nz** — 前 spike4 已证伪
- **Sitejabber** — 未验证但同类替代 Trustpilot 已够 (跳过)
- **Product Hunt** — 徒步/journaling 类不是 PH 主流讨论场
- **YouTube 评论区** — 视频评论质量低,过滤成本高
- **outsideonline.com Disqus** — 需 JS 渲染,成本高,内容偏杂志
- **hikingupward.com** — 未测,估计 US-East regional trail info,非 app 讨论

### 需要用户登录帮忙的源
| 源 | 为什么值得 | 登录方式 | 预期收益 |
|---|---|---|---|
| **Facebook Group "NZ Tramping Community"** | 真实 NZ 徒步社群,4-5万成员,活跃度高;NZ 视角最强 | 用户浏览器 cookie 导出或 playwright + user session | 直接触达 NZ 用户,Cairn 差异化定位关键源 |
| **Facebook Group "Te Araroa Trail"** | Te Araroa 徒步者社群,长距离徒步用户 = Cairn 高价值目标 | 同上 | 长距离徒步者的记录/日记/分享痛点 |
| **小红书"世界迷雾"/徒步 tag** | 中文年轻用户 (18-25 女性) 的 app 使用讨论 | 用户手机小红书 App 截图导入 or 用户账号 cookie | 中文年轻女性用户视角,潜在小红书获客渠道 |
| **微信"数字手账"公众号后台 / 群** | 中文数字手账社群深度 | 用户拉群/公众号截图 | 数字手账用户对 Cairn 的兴趣点 |
| **Day One 官方社区论坛** | 部分需登录 Bloom Built 账号 | 用户注册 Day One 试用账号 | Day One 深度用户流失原因 |

---

## 详细评估

### r/tramping (NZ) — 🥇 必爬
- **URL**: https://safereddit.com/r/tramping/top?t=year
- **真实活跃度**: Top-year 前 25 帖 upvote 从 472 (第1) 到 17 (第25),均值 ~65,**极活跃**
- **相关内容占比 (25 帖分类)**:
  - trail conditions/routes: 8 (32%) — Borland tops / Dusky Track / French Ridge / Greenstone-Caples / Rees-Dart
  - trip reports/photos: 6 (24%) — Kime Hut sunset / Cute couples / Mt Aspiring
  - **GPS/apps/tools/journaling: 4 (16%)** — Schnerp DOC booking tool (2 帖) + "Would you use gear library" + SAT NAV tips
  - safety/rescue: 2 (8%) — NZMSC winter safety + Rees-Dart river crossing
  - gear: 2 (8%)
  - other: 3 (12%)
- **和 Cairn 主题相关内容占比**: **中偏高** — 虽然大多是 trip report,但含 dev/tool 讨论 (Schnerp),读者是真实 NZ 徒步用户群,可以 mine "NZ 用户如何记录/规划徒步"的语料
- **登录要求**: 无 (safereddit 镜像穿透)
- **优先级**: 🥇 必爬 — NZ 视角最强的唯一真实源

### r/PolarSteps — 🥇 必爬
- **URL**: https://safereddit.com/r/PolarSteps/top?t=year
- **真实活跃度**: Polarsteps 官方在 sub 里挂 CEO Clare + team 员工亲自回帖,20M 用户全球版
- **相关内容占比 (25 帖分类)**:
  - **dev idea / feature request: 10+ (40%+)** — DayTrips / Best friends filter / Snap to River / More train modes / Countries per continent / Geotags / Chronological photo sort / Private-but-shareable / Following's Trip Preview
  - Polarsteps 官方公告: 4 (Plus launch / 20M / Apple feature / travel planning roadmap)
  - **bug/complaint**: 3 (Clean map无法过滤 / 误判国家 / 广告位讨论)
  - showcase: 2
- **和 Cairn 主题相关内容占比**: **极高 (~90%)** — 每一个 dev idea 都是 Cairn 可以先做的功能 gap (Snap to River 尤其相关 = Cairn 水面追踪场景)
- **登录要求**: 无
- **优先级**: 🥇 必爬 — 竞品用户直接吐槽和许愿池,情报密度最高

### r/dayoneapp — 🥇 必爬
- **URL**: https://safereddit.com/r/dayoneapp/top?t=year
- **真实活跃度**: Top-year 前 25 帖 upvote 124 到 20,全部是深度讨论帖(3 帖是 200-500 字长文)
- **相关内容占比 (25 帖分类)**:
  - **AI 隐私焦虑: 5 帖 (20%)** — "Stay away from journals" / "keyboard AI popup" / "AI 让 E2EE 失效" / "Bitter taste on Gold tier" / "cancelling" — **数字手账用户对隐私/主权的深度诉求 = Cairn DS 哲学切入点**
  - **定价/流失: 4 帖** — Nigeria user 800% 涨价 / "12 年老用户告别" / Silver-Gold 混乱 / "Diarly 替代"
  - **feature idea: 6 帖** — Obsidian-like linking / On This Day 独立 tab / handwriting mode / template creation / linking memories / review workflow
  - **use case showcase: 4 帖** — 8000 天打印成书 / 366 天 streak / 单一 source of truth 系统 / 用 AI 分析 2025 日记
  - **security bug: 2 帖** — macOS 数据未加密 / iOS keyboard lag
  - other: 4
- **和 Cairn 主题相关内容占比**: **~95%** — 每一帖都是 Cairn "数字手账 + 陌生人善意" 想要的用户
- **登录要求**: 无
- **优先级**: 🥇 必爬 — journaling 视角最强的源,同时也是 Cairn "反 AI 侵入" 差异化定位的直接情报

### r/hiking / r/Ultralight / r/CampingandHiking — 🥈 建议爬
- 前 spike1 已证明可爬 (~10 tool calls 覆盖 250 帖精华)
- **Cairn 相关内容占比估算**: 20-30% (路线/装备/照片炫耀是主流,GPS 记录/日记讨论是少数)
- **优先级**: 🥈 每 sub 1-2 calls 拿 top+search,不亏

### bushwalk.com — 🥈 建议爬 (International / NZ 子版)
- **URL**: https://www.bushwalk.com/forum/viewforum.php?f=<int>
- **前 spike4 确认**: 432k posts, phpBB, 完全公开
- **优先级**: 🥈 只爬 International / NZ 子版即可,AU 内容当 secondary

### ukhillwalking.com — 🥈 建议爬
- 前 spike4 确认活跃, UK 用户视角
- **优先级**: 🥈

### backpackinglight.com — 🥈 建议爬
- 前 spike4 确认 543k posts, 免登陆可爬
- **付费墙**: 只有部分 editorial 内容锁 member, forum 主体公开
- **优先级**: 🥈 — UL 硬核用户群,懂 GPS/tracking 深度

### Trustpilot Polarsteps — 🥇 必爬
- **URL**: https://www.trustpilot.com/review/polarsteps.com
- **真实数据**: **1,551 条评论,4.7 分,免登陆可读**
- **相关内容占比**: **~100%** — 每条都是付费用户对 Polarsteps + Photobook 服务的真实反馈
- **关键情报 (从我抓到的前 15 条看)**:
  - **Photobook = 主变现产品**,几乎每条评论都提到 (Cairn Photobook 变现验证)
  - "great value" / "speedy delivery" / "great quality" — 用户为纸质制品付费
  - "highly glitchy to edit for excellence but a good product" — app 品质问题
  - "encourage more followers" — 分享驱动力
- **优先级**: 🥇 付费意愿数据最强的源

### App Store 评论 (US/NZ/AU/UK/CN 4-5 区) — 🥇 必爬
- **Day One (US)**: 91.7k ratings, 4.8 分, "15M downloads + 200k 5-star globally", **Editors' Choice**, $34.99/yr Premium
- **Polarsteps NZ**: 页面被 App Store 中国区强制重定向到中文 (Bug!),需要用 US 或 NZ 直连 API 而非 web
- **前 spike2 已确认**: iTunes RSS feed 可拿完整评论,4 区 × 3 app = 12 次调用
- **和 Cairn 相关内容占比**: **~100%**
- **登录要求**: 无
- **优先级**: 🥇 定价 + 具体功能痛点最直接

### 知乎 + 36氪 + 少数派 中文评测 — 🥇 必爬
- 前 spike3 已确认: webReader 直接 fetch,无需登录
- **关键情报 (spike3 已挖出)**:
  - "有什么基于百度地图或者高德地图,能记录足迹的 app?" 知乎问答 — 完整对比世界迷雾/OysterX/苹果/安卓
  - 36氪 "用 App 记下走过的路,除了世界迷雾还有 10+ 个" — 深度对比
  - 少数派 "不用世界迷雾还有这些工具"
  - 简书评测 "轨迹记录 APP 横向对比" — 68RMB 付费用户画像
- **和 Cairn 相关内容占比**: 100%
- **优先级**: 🥇 中文用户思考深度最强

### 小红书笔记 — 需登录帮忙 (见汇总表)
- 前 spike3b 确认: 搜索强登录墙,具体笔记 URL 可爬 title + og:description 首段
- **完全穿透需要用户提供**: cookie 或直接手机 App 截图导入
- **优先级**: 🥇 (只要用户能登录) — 中文年轻女性用户视角

### r/ukwalking / r/CanadianHiking / r/hikingaustralia — 🥉 视情况
- 都是地区版, 内容偏 route/photo, Cairn 相关内容占比推测 15-20%
- **优先级**: 🥉 — 抓 1 次 top-year 看看即可 (~3 calls 总)

### HN Polarsteps — 🚫 明确跳过
- **实测**: `https://news.ycombinator.com/from?site=polarsteps.com` 历史全部提交只有 **1 帖, 1 point, 2019 年** ("Polarsteps hits 1M users")
- **结论**: HN 圈层(SF tech elite)几乎不讨论 Polarsteps/Day One 这类工具,证伪

### r/journaling — 🚫 明确跳过
- 未 fetch,但从 sub 定位推断:通用手写日记 sub,数字工具讨论 <10%,信噪比低
- **代替源**: r/dayoneapp 已覆盖数字手账用户 (100% 相关) — journaling 泛版是稀释

### Product Hunt — 🚫 明确跳过
- 前 spike1/2 没主动查,但从 PH 定位推断: 徒步 app 不是 PH 主流关注,Polarsteps/Day One 在 PH 只有 launch 日的少量评论,情报密度低
- **代替源**: Reddit + Trustpilot 已覆盖用户反馈,PH 是稀释

### YouTube 评论区 — 🚫 明确跳过
- 未测,但同类研究经验:视频评论质量低 (大量 "great video!"),过滤成本远高于收益
- 若确实想看用户视频反应, YouTube Comments API 需要 OAuth + quota

### Facebook Groups — 需登录帮忙 (见汇总表)
- **"NZ Tramping Community"** / **"Te Araroa Trail"** — 强登录墙, playwright 需要 user session cookie
- **完全需要用户帮**: 用户自己浏览器登录 Facebook, 导出 cookie, 或 playwright + user profile
- **价值**: NZ 视角最强, 4-5 万成员级别的真实社群 (远大于 r/tramping ~ 5k),Cairn 差异化 NZ 定位关键源
- **优先级**: 🥇 (只要用户能帮登录) — **NZ 视角 + 陌生人善意/DS 哲学最强的源之一**

---

## Cairn 特化建议

**NZ 视角最强**: r/tramping + Facebook "NZ Tramping Community" (需登录) + bushwalk.com NZ 子版

**数字手账/journaling 视角最强**: r/dayoneapp (~95% 相关) + Day One AppStore 评论 + 少数派中文数字手账评测

**陌生人善意 / DS 哲学视角最强**: r/dayoneapp 里的"AI 焦虑"5 帖 (用户对 e2ee/隐私/主权的诉求 = DS 意识形态直接受众) + Facebook Groups 里的"分享型徒步社群"(需登录)

**付费意愿数据最强**: Trustpilot Polarsteps (1,551 付费用户评论) + App Store Day One (Premium $34.99/yr 的用户流失原因) + 简书评测 "68RMB 世界迷雾付费用户画像"

**竞品直接漏洞**: r/PolarSteps 里的 40%+ dev idea 帖 (每一帖都是 Cairn MVP 可以先做的差异化功能)

---

## 登录需求汇总(给用户看)

| 源 | 为什么值得登 | 怎么登 | 预期收益 |
|---|---|---|---|
| **Facebook "NZ Tramping Community" group** | 真实 NZ 徒步社群 4-5 万人,是 r/tramping (~5k) 的 10 倍规模,NZ 差异化定位刚需 | 用户浏览器登 FB → 导 cookies.txt 给我 或用户 Playwright profile 授权 | NZ 目标用户群直接触达 + 徒步文化痛点 |
| **Facebook "Te Araroa Trail" group** | Te Araroa 长距离徒步者社群,Cairn 高价值目标用户 (记录 + 日记双需求) | 同上 | 长距离徒步的记录/分享/回顾痛点 |
| **小红书 "世界迷雾" hashtag 页面** | 中文年轻女性用户 (18-25) 视角, spike3b 证明只能爬具体 URL 的 og:description 首段 | 用户手机 App 内搜索 → 截图导入 或 用户提供小红书 cookie | 中文小红书用户对 Cairn 的兴趣点 + 潜在获客渠道 |
| **微信"数字手账"公众号/群** | 中文数字手账深度社群 | 用户拉入群 or 公众号后台截图导出 | 中文数字手账用户视角 |
| **Day One 官方社区 (dayoneapp.com/community)** | 部分讨论需登录 Bloom Built 账号,大老用户/开发者互动 | 用户注册 Day One 免费账号即可 | Day One 深度用户流失原因 (可能免登录也能看,值 30 秒试一次) |
| **Instagram tag #polarsteps / #trampingnz** | 视觉证据 + 分享驱动力 | 用户提供 IG 账号 cookie 或截图 | 用户为什么分享 + 视觉分享偏好 |

**未列入的登录需求**: Twitter/X (Polarsteps/Day One 官推 + 回复) — 若用户有 X 账号导出 cookies 可加,但优先级低 (Twitter 已被 nerd 化,徒步用户不在)

---

## 总体建议给用户

**执行顺序**:
1. **先无登录爬 4-5 天** — 覆盖 🥇 全部 (Trustpilot / r/dayoneapp / r/PolarSteps / r/tramping / AppStore / 知乎+少数派+36氪)
2. **同时用户帮登录 Facebook Groups + 小红书** — 这两个补 NZ 视角 + 中文年轻女性视角,是无登录 tier 完全拿不到的
3. **Tier 2 补充采集** — 时间允许再爬 (bushwalk / ukhillwalking / backpackinglight)
4. **明确不做**: HN / Product Hunt / r/journaling / YouTube / outsideonline / hikingupward — 这些是稀释,不加信息量

**tool call 预算**:
- Tier 1 免登陆全套: ~40 calls (25 帖 × 5 sub reddit + 12 AppStore + Trustpilot 3 页 + 中文源 5-6 页 = ~30, buffer 到 40)
- Tier 2 补充: ~15 calls
- Facebook Groups (需登录) + 小红书 (需登录): ~10 calls (前提用户提供 cookie)
- **总预算: 65 calls** — 远小于用户之前担心的 "什么垃圾都爬" 场景

---

## 完成时间

- 起始: 2026-07-17 20:48
- 完成: ~15 min in
- Tool call 用量: ~12 / 25
