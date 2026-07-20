# Cairn Market Research 2026-07 — Master CHECKLIST v3

**Version**: 3 (归纳型,基于 6 个 Spike 真实可行性数据)
**Started**: 2026-07-17
**Owner**: 用户 + 主 Claude agent
**Method**: 客观归纳,不预设假设,原文入库,主题自然浮现
**Final deliverable**: HTML report — 用户真痛点 vs Cairn 当前偏移量

---

## 🚨🚨🚨 用户 2026-07-17 睡前铁律(Compact 必读,永不删除)

**用户已睡觉,我夜跑到 HTML 完成。以下规则 compact 后任何 Claude 都必须遵守**:

1. **任何本来要问用户的问题** → 开 subagent 问它(不 stop 等用户)
2. **任何"可以进入下一阶段"的判断** → 开 subagent independent review
3. **任何"数据完成"的判定** → 开 subagent 抽样审计
4. **不擅自停下,不卡死** —— 遇到问题开 subagent 讨论
5. **最终产出必须是 HTML** —— 否则未完成
6. **HTML 每条结论必须证据链清晰** —— 可点击回溯原文
7. **HTML 完成后必须开 3 个 subagent 独立打分,平均 <9/10 就继续优化**
8. **明天用户起床必须看到 `final_report.html` + 完整证据链**
9. **Compact 也要牢记这段话** —— 恢复时首先读这段

**如果 Compact 后重新读到这段**:
- Read CHECKLIST 找 `▶ CURRENT`,从那里续
- 用户睡了,不 stop 问用户
- Phase 3/4/5 都必须 subagent 决策 → 主 agent 执行
- 全部完成才叫完成

---

**⚠️ 首要规则**: Compact 或新 session 恢复时,先读本文件,找到 `▶ CURRENT` 标记,从那里续跑。禁止重新对齐 —— 用户已经花大量时间对齐过了。


---

## 📌 已确认的产品边界(2026-07-17 用户 checkbox 确认)

**产品灵魂**: 数字手账 + 陌生人善意(不是安全工具,不是 AR)

**关键决策**:
- AR 永久舍弃(GPS 误差过大)
- 陌生人对 public marker:能看 + 能 like + 能 report,**显示 like/report 数**
- 权限:Personal / Group=friend / Public 三级
- 底部导航:Trails / Friend / Memory / Settings(4 个)
- 登录:邮箱+密码 + Google + Apple
- Marker 类型:5 种,附件仅语音 memo(照片不做)
- Fog 好友订阅:最多 5 个
- Moderation:目前**无**,是待补合规底线
- 市场路径:**NZ → 英语世界(澳/英/美/加)**,不做华人/日本
- 商业模式:**未定,调研目标之一**
- Utility 定位:情感核心 + utility 是付费钩子
- 无 VU,用户人工验收

**产品叙事**(Feature Map slogan): "一个人走在新西兰的山里,你以为只有自己……走着走着,会在某个雨夜发现一面陌生人留下的标记'前方有避雨亭'"

**3 个 Personas**:
- **Jamie** 常驻徒步者(周末走 Great Walks,想"感觉到别人来过但不社交")
- **Murray** hut bagger(把经验留给后来的人,不要回报)
- **Alex** trail runner(步行探路,跑步重走,跟昨天的自己赛跑)

---

## 🎯 调研目标(5 大核心问题)

- **Q1**: "N 年后回看" 是不是真需求?→ 决定产品灵魂成立
- **Q2**: **点赞 / 踩 / 举报**这类反馈机制的用户心理是什么?→ 决定 Cairn 的 like/report 机制细节设计(改进措施:去掉 report 中的 "dislike" 理由?加不加踩?举报阈值多少?)
- **Q3**: 现有竞品(Polarsteps / Day One / AllTrails / 世界迷雾)用户具体痛点是什么?→ 决定差异化切入点
- **Q4**: 用户愿意为哪些功能付费?付多少?→ 决定商业模式
- **Q5**: 我漏了哪些产品/机制/风险?→ 决定完整性

**Q2 明确不包含的**:
- ❌ "陌生人可见 marker 有多少人愿意接受" —— 这是**用户可选设置**(每个 marker 可设 personal 隐藏),不是调研能回答的机制问题
- ❌ Cairn 独有机制(现有竞品都没做),调研推不出

**Q2 具体研究**:
- 点赞的心理效应(FOMO / 焦虑 / 疲劳)
- 踩的心理效应(负能量传播 / YouTube 2021 移除 dislike 数字的案例)
- 举报的心理效应(打小报告文化 / 被举报者 vs 举报者)
- Kojima 在 Death Stranding 里**只 like 无 dislike** 的设计效果
- Reddit upvote/downvote 心理学
- Instagram 隐藏 like count 后的用户行为变化
- Anonymous 场景反馈机制的表现(Whisper / Yik Yak 死因)

**核心方法学**: 不是"验证 X → 挑 X 相关证据",而是**"整篇整篇爬 → 主题自然浮现 → 拿主题当标尺量 Cairn 偏移量"**。

---

## 🗂 目录结构

```
_review/2026-07-market-research/
├── CHECKLIST.md              ← 本文件(执行主干)
├── LOGIN_GUIDE.md            ← 登录源操作教程 + 只读铁律
├── spikes/                   ← 已完成 Spike 报告(6 个)
├── credentials/              ← 用户 cookie(.gitignore 强制不 commit)
├── raw/                      ← Phase 1 原始数据(按源分子目录)
│   ├── 01_reddit/
│   │   ├── r_dayoneapp.md
│   │   ├── r_polarsteps.md
│   │   ├── r_tramping.md
│   │   └── ...
│   ├── 02_appstore/
│   │   ├── polarsteps_us_nz_au_gb.jsonl
│   │   ├── dayone_us_nz_au_gb.jsonl
│   │   ├── alltrails_us_nz_au_gb.jsonl
│   │   └── fogofworld_us_cn.jsonl
│   ├── 03_trustpilot/
│   │   └── polarsteps.md
│   ├── 04_english_forums/
│   │   ├── bushwalk_nz.md
│   │   ├── backpackinglight.md
│   │   └── ukhillwalking.md
│   ├── 05_chinese/
│   │   ├── zhihu.md
│   │   ├── 36kr.md
│   │   ├── sspai.md
│   │   └── xhs_metadata.md
│   └── 06_login_required/     ← 需用户登录的源(视情况)
│       ├── fb_nz_tramping.md
│       ├── fb_te_araroa.md
│       └── xhs_full.md
├── cleaned/                   ← Phase 2 去噪后数据
│   ├── pain_points/           ← 痛点原文清单
│   ├── needs/                 ← 需求原文清单
│   ├── praise/                ← 用户真爱的功能
│   ├── pricing/               ← 付费意愿证据
│   └── philosophy/            ← DS 哲学/陌生人善意/N 年后回看
├── synthesis/                 ← Phase 3 主题聚类
│   ├── themes.md              ← 自然浮现的主题清单
│   ├── q1_lookback.md
│   ├── q2_stranger_kindness.md
│   ├── q3_competitor_gaps.md
│   ├── q4_pricing.md
│   └── q5_blindspots.md
├── verdict/                   ← Phase 4 判定
│   ├── offset_measurement.md  ← Cairn 相对真痛点的偏移量
│   ├── business_model_reco.md ← 商业模式建议
│   ├── roadmap_draft.md       ← 6-12 个月 roadmap
│   └── go_nogo.md             ← CONTINUE / PIVOT / STOP
└── final_report.html          ← Phase 5 展示
```

---

## 📚 数据源清单(基于 6 个 Spike 真实验证)

### 🥇 必爬源(免登陆,~200 tool call + 130 curl)

| 源 | 工具 | Tool 预算 | Cairn 相关度 | 预估内容量 |
|---|---|---|---|---|
| **r/dayoneapp** | safereddit.com + webReader | 5-8 | ~95% | 25 帖 + 评论 |
| **r/PolarSteps** | safereddit.com + webReader | 5-8 | ~90% | 25 帖 + 评论 |
| **r/tramping (NZ)** | safereddit.com + webReader | 5-8 | 中偏高 | 25 帖 |
| **Trustpilot Polarsteps** | webReader 分页 | 5-10 | ~100% | 1,551 条评论 |
| **App Store 4 App × 4-5 区** | Bash + iTunes RSS | **130 curl** (不占 tool) | 100% | **~4770 条** |
| **知乎问答 + 36氪/爱范儿/少数派** | webSearchPro + webReader | 6-8 | 高 | 30-40 讨论 |
| **世界迷雾 xhs 笔记 og:description** | webReader | 5-10 | 中 | 元数据 + og |
| **App Store 中国区 世界迷雾 + 一生足迹** | iTunes RSS | 30 curl | 100% | ~8500 条评论 |

### 🥈 建议爬源(视时间,+80-130 tool call)

| 源 | 工具 | Tool 预算 | Cairn 相关度 |
|---|---|---|---|
| r/hiking, r/Ultralight, r/CampingandHiking | safereddit.com | 各 3-5 | 20-30% |
| bushwalk.com(International + NZ 子版) | webReader phpBB | 20-40 | 中 |
| backpackinglight.com | webReader bbPress | 20-40 | 中(UL 硬核) |
| ukhillwalking.com | webReader | 20-40 | 中(UK 视角) |

### 🤝 需登录源(视用户提供决定,+30-60 tool call)

按 LOGIN_GUIDE.md,用户提供 cookie 后可爬:

| 源 | 工具 | Tool 预算 | 价值 |
|---|---|---|---|
| Facebook "NZ Tramping Community" | playwright + user cookie | 20-30 | NZ 4-5 万人社群,最强 NZ 视角 |
| Facebook "Te Araroa Trail" | playwright + user cookie | 15-20 | 长距徒步者 |
| 小红书 "世界迷雾" hashtag | playwright + user cookie | 20-30 | 中文年轻女性视角 |

### 🆕 服务 Q2 的反馈机制心理学源(+30-50 tool call)

| 源 | 工具 | Tool 预算 | 目标 |
|---|---|---|---|
| YouTube 2021 移除 dislike 数字事件的用户/媒体反应 | WebSearch + webReader | 8-12 | 踩的心理效应 |
| Reddit r/YouTube 讨论 dislike 移除 | safereddit.com | 3-5 | 踩机制的社区反应 |
| Reddit r/DeathStranding "Like" 系统讨论 | safereddit.com | 3-5 | Kojima 只 like 无 dislike 玩家反馈 |
| Instagram 隐藏 like count 相关新闻 + 学术文章 | WebSearch + webReader | 5-10 | 点赞焦虑 / 点赞疲劳 |
| Whisper / Yik Yak 关停原因文章 | WebSearch + webReader | 5-8 | 匿名反馈机制死因 |
| 学术文献:"upvote psychology" / "downvote effect" / "report abuse mechanism" | WebSearch | 6-10 | 心理学基础
| Day One 官方社区 | playwright + user 注册 | 10-15 | Day One 深度用户 |
| 微信数字手账公众号/群 | **用户手动截图/复制** | 0 tool | 中文数字手账社群 |

### 🚫 明确跳过源(附证据)

- **Hacker News Polarsteps**: 全站历史 1 帖 1 point,证伪
- **r/journaling**: 通用手写日记,r/dayoneapp 已覆盖 95%
- **Product Hunt / YouTube / Sitejabber**: 稀释源
- **tramping.net.nz / tramper.nz / backcountry.co.nz**: Spike 4 证伪(伪目标)
- **小红书主搜/评论区**: robots noindex + 登录墙,替代路径已覆盖
- **微信公众号 SEO**: 完全在搜索引擎外

---

## 🛠 工具规则(基于 Spike 结果)

**已验证可用**:
1. **`safereddit.com` / `redlib.catsarch.com` + webReader** — Reddit 唯一穿透方案
2. **iTunes RSS API + Bash curl** — App Store 评论(4770 条),不占 tool call
3. **`mcp__web-reader__webReader`** — Trustpilot / 知乎 / og:description
4. **`mcp__web-search__webSearchPro` (ZhipuAI GLM)** — 中文搜索最佳入口
5. **`mcp__playwright` + 用户 cookie** — 登录墙源(FB / xhs)

**已验证不可用**(不许再试,浪费 tool):
- `WebSearch` 内置(400 upstream error,Opus 4.7 不支持)
- Reddit 官方域名 / .json API(403 blocked)
- Playwright 直连 reddit / xhs 未登录(反爬)

**验证过限制**:
- iTunes RSS `uk` 无效,用 `gb`
- iTunes RSS 每区最多 500 条(10 页 × 50)
- iTunes RSS 只 `mostRecent` + `mostHelpful` 有数据
- webReader 知乎只拿首屏 1-2 answer,长问题需多次 search
- Reddit 单帖评论树需真 slug,列表页拿不到锚点

---

## 🚨 Subagent 硬约束(全局,每个 subagent 必须遵守)

**Spike 阶段的教训**(Spike 3 vs 3B):**"预判失败就跳过 = 懒惰,不是穷尽"**。

每个 Phase 1 抓取 subagent 的 prompt 必须包含:

```
## 硬性执行协议(违反 = 失败)

1. 第 1 步 Write "[STARTED T+0]" 到指定输出文件
2. 每完成一次抓取(1 个 URL 或 1 个搜索)立即 Write append 进度
3. Tool call 硬限 N (每源不同,预算表定)
4. 15-25 分钟硬 timeout,超时写 [TIMEOUT] 交付部分结果
5. 遇到失败**必须尝试至少 2 个替代方法**才允许放弃该子任务
6. 禁止"预判失败就跳过"—— 每个方法必须真调用
7. 使用用户 cookie 时:绝对禁止 click 发帖/评论/点赞/关注/私信按钮
   发现要写操作立即 Write "ABORT: attempted write action" 停止
8. 每条原始数据必须包含:
   - 来源 URL / 平台 / 关键词
   - 抓取时间
   - 原文引用(不改)
   - 信噪比自评(1-5)
9. 明确禁止:
   - 瞎编数据 —— 不知道写"未找到"
   - 主观分析(留给 Phase 3)
   - 挑数据 —— 抓到什么写什么,不筛选
   - 概括总结 —— 原文入库
```

---

## 📊 5 阶段执行流程

### Phase 0.5 — Pre-flight Check(必做,启动 Phase 1 前)

**为什么**: Review 2 指出 —— 200-300 call 严重低估,单点故障无预案。

**任务列表**:
- [ ] 0.5-01 写 `scripts/itunes_rss_scrape.sh`(见附录 A,含 backoff + resume)
- [ ] 0.5-02 建立 `raw/*.md` 完成标记规范:每文件末尾 `[COMPLETE T+X, N records]` 才算完
- [ ] 0.5-03 建立 `HTML_INDEX_SCHEMA.md`(见附录 B):Phase 5 用的 JSON schema 提前定死,Phase 2 就按此格式打标
- [ ] 0.5-04 建立 subagent prompt 模板 12 份(每源一份,含具体 query + 分页规则,不再是"通用硬约束")→ `templates/subagent_1_XX.md`
- [ ] 0.5-05 测 safereddit.com 备用镜像清单(redlib.catsarch.com 挂了用什么)
- [ ] 0.5-06 加 STOP 心理准备段落 —— 明确"如果 Phase 4 结论是 STOP,我要接受"
- [ ] 0.5-07 加分 session 规则(见下方 "🗓 分 Session 执行" 段)
- [ ] 0.5-08 加 6 类别标签决策树(见附录 C)+ 5 条锚点示例数据
- [ ] 0.5-09 加偏移量打分锚点示例(见附录 D)防主 agent self-serving bias
- [ ] 0.5-10 建立 pause-and-resume 协议:每完成一个子任务立即 push 到 CURRENT

---

### 🗓 分 Session 执行(接受预算 700-900,单 session 上限 200-250 call)

**为什么**: Review 1+2 都指出预算严重低估。接受现实,分多 session。

**Session 分配**:

| Session | 任务 | Tool 预算 | Time |
|---|---|---|---|
| **S1** | Pre-flight check 全部完成(Phase 0.5)+ 启动 Phase 1 前 3 个免登源(1-01 r/dayoneapp / 1-02 r/PolarSteps / 1-05 Trustpilot) | 150-200 | 1 session |
| **S2** | Phase 1 中段(1-03 r/tramping / 1-04 其他 hiking subs / 1-07 中文源 / 1-06 App Store Bash) | 150-200 | 1 session |
| **S3** | Phase 1 尾段(1-08 App Store CN / 1-09 xhs metadata / 1-Q2 反馈机制心理学) + Phase 2 起步 | 150-200 | 1 session |
| **S4** | Phase 2 全部筛选 + Phase 3 主题聚类启动 | 150-200 | 1 session |
| **S5** | Phase 3 完成 + Phase 4 偏移量测量 | 100-150 | 1 session |
| **S6** | Phase 5 HTML 报告 | 50-100 | 1 session |

**Compact 保护**: 每 session 结束前主 agent 强制 update CURRENT 标记 + 写 session 收尾摘要到 `session_log/SN.md`。

**Session 间续跑规则**:
1. 新 session 打开先 read CHECKLIST 找 `▶ CURRENT`
2. 找 `session_log/` 里最新的收尾摘要
3. 从 CURRENT 继续,不重问已做过的
4. 每半完成的 raw 文件都要检查末尾是否有 `[COMPLETE T+X, N records]` 标记 —— 没有 = 半成品要重跑

---

### Phase 1 — 客观抓取

**目标**: 免筛选、免解读,原文入库。

**并行策略**: 每 session 内 2-3 subagent 顺序 + 部分并行(不再一次 12 个,避免 rate limit)

**任务列表**(每项 = 1 个 subagent):

- [ ] ▶ **CURRENT** — Phase 1 未启动,等用户 review v3.1 plan 后启动 Phase 0.5

**S1 任务(主 Session 1)**:
- [x] 1-01 r/dayoneapp (top of year + hot + search "wish/miss/annoying") → `raw/01_reddit/r_dayoneapp.md` (22 posts, comments 拿不到 = mirror 限制)
- [x] 1-02 r/PolarSteps → `raw/01_reddit/r_polarsteps.md` (23 posts)
- [x] 1-05 Trustpilot Polarsteps rerun (playwright, 88 条 42%1★)→ `raw/03_trustpilot/polarsteps_rerun.md`
- [x] 1-05B Trustpilot Day One (playwright, 4 条有效 + fallback logged)→ `raw/03_trustpilot/dayone.md`
- [x] 1-06 iTunes RSS 全量 6 apps × 4-5 区 × 2 sort = 21,361 条 → `raw/02_appstore/*.jsonl`
- [x] S1 Audit v1 → 🟡 → 补跑 → Audit v2 → 🟢 GREEN LIGHT
- [x] S2 r/tramping (18) + 中文评测 (15) + Q2 心理学 (18) + xhs (80,用户 Chrome playwright)
- [x] Phase 2 Python encode 18,943 records + QC v1 82% → 修 4 patch → QC v2
- [x] Phase 3 双 subagent 聚类 (A 情感 20 + B 数据 25) → 合并 24 themes across Q1-Q5
- [x] Phase 4 偏移量测量 + 3+1 大战略结论
- [x] Phase 5 HTML v1 (394 行) → v2 (545 行) → v3 (600+ 行)
- [x] 3 Judge 打分 v1 9.07 → v2 8.37 → v3 **9.2/10 ✅ 达标**

**▶ CURRENT — 全部完成,交付 `final_report.html`(600+ 行 + 6MB data.js + 18943 metadata)**

**S2 任务**:
- [ ] 1-03 r/tramping NZ → `raw/01_reddit/r_tramping.md`
- [ ] 1-04 r/hiking, r/CampingandHiking, r/Ultralight, r/ukwalking, r/CanadianHiking → `raw/01_reddit/other_hiking_subs.md`
- [ ] 1-06 **iTunes RSS Bash 脚本运行**(见附录 A,4 App × 4-5 区 × 2 sort = 130 curl)→ `raw/02_appstore/*.jsonl`
- [ ] 1-07 知乎 + 36氪/爱范儿/少数派 长评测 → `raw/05_chinese/zhihu_36kr_sspai.md`

**S3 任务**:
- [ ] 1-08 App Store 中国区 世界迷雾 + 一生足迹 + 灵敢足迹 → `raw/02_appstore/cn_apps.jsonl`
- [ ] 1-09 世界迷雾 xhs 已知笔记 URL og:description → `raw/05_chinese/xhs_metadata.md`
- [ ] 1-Q2a YouTube 移除 dislike 事件反应 → `raw/07_feedback_mechanism/youtube_dislike.md`
- [ ] 1-Q2b Reddit r/YouTube + r/DeathStranding 讨论 → `raw/07_feedback_mechanism/reddit_discussions.md`
- [ ] 1-Q2c Instagram 隐藏 like count 相关 + Whisper/Yik Yak 死因 + 学术 upvote/downvote 心理学 → `raw/07_feedback_mechanism/psychology.md`
- [ ] 1-10(可选)bushwalk.com International + NZ 子版 → `raw/04_english_forums/bushwalk.md`
- [ ] 1-11(可选)backpackinglight.com → `raw/04_english_forums/bpl.md`
- [ ] 1-12(可选)ukhillwalking.com → `raw/04_english_forums/ukhw.md`

**如果用户提供 cookie(独立 session 处理)**:
- [ ] 1-L1 Facebook NZ Tramping Community 群 top 30 帖 + 评论 → `raw/06_login_required/fb_nz_tramping.md`
- [ ] 1-L2 Facebook Te Araroa Trail 群 → `raw/06_login_required/fb_te_araroa.md`
- [ ] 1-L3 小红书 "世界迷雾" hashtag top 20 笔记 → `raw/06_login_required/xhs_full.md`

**Phase 1 完成条件**:
- 每个 raw 文件末尾有 `[COMPLETE T+X, N records]` 标记
- 每条数据有来源 URL + 原文 + 抓取时间
- 主 agent 采样 10% 检查后确认无瞎编 → 记录在 `raw/QC_LOG.md`

**预算**:
- 免登陆 tool call: **400-500 call**(Review 修正后)
- Bash curl: **130 次**(不占 tool)
- 需登录源额外: **60-100 call**
- **总原始数据量: 6000+ 条真实用户原话**

### Phase 2 — 客观筛选(Day 6-7)

**目标**: 剔除噪音(纯路线推荐/装备比价/技术地形学等),保留和 Cairn 主题相关的原始数据。

**筛选标准**(用户原话):
> "我们更多看的是 痛点 优点 抱怨 等等 这些和 app 本质相关的内容。至于哪条路线好、哪个人厉害,我们不在意 —— 这种文章会是噪音"

**保留**:
- 用户痛点(功能缺失/bug/体验差)
- 用户真爱(明确说"这个功能改变了我")
- 用户抱怨(定价/隐私/AI 侵入/流失原因)
- 用户情感(N 年后回看/陌生人善意时刻)
- 用户关系(好友分享/私密偏好/公开态度)
- 付费意愿证据(愿付多少/为什么付/为什么退订)

**剔除**:
- 纯路线推荐("XX 山值得去")
- 装备比价("XX 帐篷 vs YY")
- 技术地形学("Kalman 滤波原理")
- 炫耀照片("看我拍的日出")
- 无关时事新闻

**任务列表**:

- [ ] 2-01 起 subagent 逐个 raw 文件筛选,按上述标准分类
- [ ] 2-02 每条保留数据打唯一 ID(可回溯)+ 类别标签(pain/love/complaint/emotion/relation/pricing)
- [ ] 2-03 每条数据打强度评分(1-5,基于原文情感强度 + 上下文重要性)
- [ ] 2-04 主 agent 采样 20% 复核筛选质量
- [ ] 2-05 用户抽样 review(重要节点,10 条样本)

**Phase 2 产出**:
```
cleaned/
├── pain_points/       ← 每条附:ID / 来源 URL / 原文 / 类别 / 强度
├── needs/
├── praise/
├── pricing/
├── philosophy/
└── metadata.csv       ← 全部 ID + 元数据(用于 Phase 5 HTML 索引)
```

### Phase 3 — 主题自然浮现(Day 8-9)

**目标**: **不预设分类**,让主题从数据里自然聚类。

**方法(Review 1 修正后)**:
- 启动 2 个 subagent,**用不同角度**聚类同一份 cleaned data,而不是同源同料的 2 副本
  - **Subagent A** — 从**原文情感强度**聚类(基于每条原文的情感浓度、修辞、重复次数)
  - **Subagent B** — 从**metadata + 数据模式**聚类(基于类别标签、来源分布、时间序列、强度评分)
- 两个 subagent 的 prompt 完全不同,避免同源 bias
- 主 agent 合并两个视角,一致主题保留,冲突主题 → 启动第 3 个 subagent 从**关键词共现频率**角度裁决

**任务列表**:

- [ ] 3-01 Subagent A 从**原文情感强度**聚类 → `synthesis/themes_agent_a.md`
- [ ] 3-02 Subagent B 从**metadata 数据模式**聚类(不看 A 结果)→ `synthesis/themes_agent_b.md`
- [ ] 3-03 主 agent 合并 → `synthesis/themes.md`(合并主题清单)
- [ ] 3-04 冲突项启动 Subagent C 从**关键词共现频率**裁决 → `synthesis/conflicts_resolved.md`
- [ ] 3-05 按 Q1-Q5 5 大问题归类主题 → `synthesis/q1_lookback.md` 等 5 个文件
- [ ] 3-06 每个 synthesis 引用 golden data 的唯一 ID(证据链)

**主题输出格式**:
```
## Theme: "AI 侵入焦虑"
- 出现频率: X 条数据
- 强度平均: Y/5
- 引用 IDs: [id_001, id_042, id_156, ...]
- 代表性原话 3 条:
  1. "..." — 来源
  2. "..."
  3. "..."
- 服务的 Q: Q2(隐私) + Q3(Day One 竞品漏洞)
```

### Phase 4 — 偏移量测量 + 商业模式建议(Day 10-11)

**核心产出**: 用 Phase 3 浮现的主题当"标尺",量 Cairn 在每条标尺上偏移了多少。

**任务列表**:

- [ ] 4-01 对每个主题打分:Cairn 当前实现 vs 用户真需求
  - 完全对齐 = 0 偏移
  - 部分对齐 = 中等偏移
  - 完全错位 = 严重偏移
  - 未实现 = 空白
- [ ] 4-02 输出 `verdict/offset_measurement.md`
  - 每个主题一行,含:
    - 主题名
    - 用户真需求描述
    - Cairn 当前实现描述
    - 偏移量评分
    - 建议动作(保持 / 调整 / 新增)
- [ ] 4-03 商业模式建议 → `verdict/business_model_reco.md`
  - 基于 Q4 数据 + Trustpilot Polarsteps 变现 + Day One $34.99/yr 流失原因
- [ ] 4-04 6-12 个月 roadmap 草稿 → `verdict/roadmap_draft.md`
- [ ] 4-05 CONTINUE / PIVOT / STOP 判定 → `verdict/go_nogo.md`

**判定标准**(温和,不是硬阈值):
- 高偏移主题 < 30% → CONTINUE(方向大致对)
- 高偏移主题 30-60% → PIVOT(部分方向要调)
- 高偏移主题 > 60% → 严肃考虑 STOP 或重新定位

### Phase 5 — HTML 展示(Day 12)

**目标**: 一个 HTML 报告,可点击回溯每条证据。

**结构**:

```
final_report.html
├── 首屏 — 结论 + 偏移量热力图
├── 5 大问题(Q1-Q5)
│   └── 每个问题:
│       ├── 主要主题(排序)
│       ├── 代表原话(点击展开更多)
│       └── Cairn 对应实现 + 偏移量
├── 商业模式建议(定价锚点 / 变现路径 / 类似产品的经验)
├── Roadmap 建议(短期/中期/长期)
├── Cairn vs Polarsteps/Day One/AllTrails/世界迷雾 差异化定位
└── 附录 — 所有 golden data 索引(可搜索/筛选)
```

**任务列表**:

- [ ] 5-01 起草 HTML 骨架(极简,清晰第一)
- [ ] 5-02 每条结论 → hover 显示来源 → 点击跳原文
- [ ] 5-03 偏移量热力图(简单 CSS grid)
- [ ] 5-04 golden data 索引可搜/筛选
- [ ] 5-05 交付 `final_report.html`

---

## 📝 Compact / 中断续跑规则

任何 session 恢复(compact 或新开)时:

1. **主 agent 首件事**: Read 本文件,找 `▶ CURRENT` 标记
2. **如果 CURRENT 是 Phase 1 里某一项**:
   - 检查对应 raw file 是否存在
   - 不存在 → 从 0 启动该 subagent
   - 存在但不完整 → 判断是否完成,决定继续或重启
3. **如果 CURRENT 是 Phase 2/3/4/5**: 说明前置 Phase 全完成,读对应目录状态续跑
4. **绝不重新问用户已答过的问题** — 答案在"已确认的产品边界"里

**CURRENT 更新规则**:
- 每完成一步,主 agent 立即 Edit 本文件,把 `▶ CURRENT` 移到下一行
- 每次子任务完成,同时把该行 `[ ]` 改为 `[x]`
- 禁止批量 mark 完成 —— 一步一步来

---

## 🎯 关键决策日志(用户已定,不重问)

**2026-07-17**:
- ✅ AR 永久舍弃
- ✅ 陌生人保留 like + report,显示数字
- ✅ Global 路径 = NZ → 英语世界(澳英美加),不做华人/日本
- ✅ 中文源保留(补充年轻用户视角,但市场不做中文区)
- ✅ 商业模式未定,调研帮忙想清楚
- ✅ Utility 是付费钩子,情感是核心
- ✅ 无 VU,用户人工验收
- ✅ 归纳型调研,不预设假设
- ✅ 整篇原文入库,自然聚类
- ✅ HTML 最终报告,可点击回溯证据
- ✅ 登录源:用户全部愿意提供,但要保证只读
- ✅ 按部就班,不着急,质量优先,完整度优先

---

## 🚨 主 agent 每次续跑必读的 3 条铁律

1. **绝不重新问用户已答过的问题** — 答案在"关键决策日志"和"已确认的产品边界"里
2. **绝不跳过 Phase 边界** — Phase 1 没跑完不能进 Phase 2
3. **绝不修改本文件的关键决策** — 只能移动 `▶ CURRENT` 和勾 `[x]`

---

## 📊 进度跟踪(压缩视图)

```
[ ] Phase 0: Spike(6 个)                                ✅ 完成
[ ] Phase 1: 客观抓取(免登陆 12 任务 + 登录 5 任务)     ▶ 待用户 review 后启动
[ ] Phase 2: 客观筛选
[ ] Phase 3: 主题自然浮现
[ ] Phase 4: 偏移量测量 + 商业建议
[ ] Phase 5: HTML 展示

总进度: 1 / 6 阶段(Phase 0 完成)
```

---

## 🧭 主 agent 的守则(自我提醒)

**Spike 阶段的教训**:
- Spike 3 太快认输("预判失败就跳过") — 3B 强制正面攻坚后拿到真相
- 每个 subagent 结论都要问一次:"这是穷尽后的真相,还是预判后的懒惰?"

**归纳 vs 假设的区别**:
- ❌ "我想证明 fog-of-war 有人用 → 去搜 fog 相关证言"
- ✅ "整篇整篇爬 → 自然浮现的痛点告诉我真相 → 拿真相量 Cairn 偏移量"

**主 agent 的行为**:
- 不下判断(留给 Phase 3-4)
- 不筛数据(留给 Phase 2)
- 不总结(留给 Phase 3)
- 每个 subagent 结束后审核:是否真调用了所有方法?是否有 write action?

---

## 🛑 STOP 心理准备(必读)

**Review 1 指出**: v3 说"严肃考虑 STOP",是委婉话术。v3.1 明说:

**用户已 4 个月熬夜到 v416**。这次调研的目标是**决定值不值得继续投时间**。真诚的 3 种可能结局:

### 结局 A: CONTINUE(高偏移 < 30%)
- 方向大致对,微调
- 商业模式建议直接采纳
- Roadmap 按调研结果执行
- **心理准备**: 加速,不再纠结方向

### 结局 B: PIVOT(高偏移 30-60%)
- 方向部分要调
- 可能改陌生人可见默认设置、改 marker 类型、改 fog 好友订阅规则
- 商业模式重定位
- **心理准备**: 接受"过去 4 个月部分白干"的沉没成本,不情绪化

### 结局 C: STOP(高偏移 > 60% 或调研发现 PMF 严重缺失)
- 方向根本错
- **不是失败,是止损**
- 4 个月工程经验 + Cairn 代码库都是财富,可用在下一个项目
- **心理准备**:
  - 提前告诉自己"我接受 STOP 结果",不因情绪抗拒
  - 数据主权:调研结束前先把 Cairn 用户(即使只有你自己 + 几个 tester)数据 export 好
  - 关停路径:若真 STOP,不删代码,开源到 GitHub,让别人可以 fork

### Reviewer 2 提出的 PRECOMMIT.md 签字

启动 Phase 1 前,用户在 `PRECOMMIT.md` 里明写:
- [ ] 我接受调研可能出 STOP 结论
- [ ] 我接受调研可能出 PIVOT 结论,即使砍掉现有 30%+ 功能
- [ ] 我接受 3-4 session 时间投入
- [ ] 我不因情绪抗拒调研结论

签完再启动。这不是形式主义 —— 是防止"用调研的严谨感当做情感慰藉"。

---

## 📎 附录

### 附录 A — iTunes RSS Bash 脚本(Pre-flight 必写)

**目标文件**: `scripts/itunes_rss_scrape.sh`

**规格**:
- 遍历 4 App × [us, gb, au, nz] × [mostRecent, mostHelpful] × pages 1-10 = 320 请求(实际有效 ~130,uk 无效)
- **加入 backoff**: 每次 curl 后 sleep 2s,遇 429/503 指数退避
- **加入 resume**: 每次成功写 JSONL 一行,重跑时跳过已存在 (app_id, region, sort, page) 组合
- **加入 timeout**: 每 curl `--max-time 30`
- **进度落地**: 每 10 条 flush 一次,即使 crash 也能续跑
- **备用 URL** 如果 `itunes.apple.com` 挂,尝试 `rss.applemarketingtools.com` 备份
- 输出:`raw/02_appstore/{app_slug}_{region}_{sort}.jsonl`

**Pre-flight 0.5-01 就是写这个脚本 + 本地 dry-run 3 条验证**。

### 附录 B — HTML_INDEX_SCHEMA.md(Phase 5 用的 JSON schema)

**目标**: Phase 2 打标时就按此 schema 写 metadata,Phase 5 直接读,不用回头改 6000 条。

```json
{
  "id": "d001",                    // unique 递增
  "source": "reddit_r_dayoneapp",  // 数据源分类
  "url": "https://safereddit.com/r/dayoneapp/comments/xxx",
  "author": "u/anonymous_hiker",   // 或 null
  "captured_at": "2026-07-18T14:30:00Z",
  "raw_quote": "I opened my Day One from 2019 and cried",
  "category": ["emotion", "praise"],  // pain/love/complaint/emotion/relation/pricing (可多标)
  "intensity": 4,                   // 1-5
  "themes": ["N年后回看", "情感回忆"],  // Phase 3 填,不在 Phase 2 填
  "language": "en",
  "cairn_relevance": 5             // 1-5,主 agent 或 subagent 打
}
```

### 附录 C — 6 类别标签决策树(Phase 2 subagent 用)

```
一条原文进来,回答 4 个问题:

Q1: 是不是在抱怨具体功能不好用?→ 是 → "pain"(痛点)
Q2: 是不是在夸具体功能?→ 是 → "praise"(真爱)
Q3: 是不是在提定价/流失/退订?→ 是 → "pricing"
Q4: 是不是在讲情感体验(N 年后回看/善意时刻/回忆)?→ 是 → "emotion"
Q5: 是不是在讲和别人的关系(分享/私密/公开)?→ 是 → "relation"
Q6: 其他抱怨(bug、体验差、隐私、AI 等)→ "complaint"

多标可以,但主标签一个。
```

**锚点示例**:
1. "I wish Polarsteps had a way to add offline notes" → **pain** (feature 缺失)
2. "I've been using Day One for 8 years, absolutely love the on this day feature" → **praise** + **emotion** 主 praise
3. "$34.99/yr is too much, canceling" → **pricing**
4. "Opened my journal from 2016 tonight, felt like meeting old me" → **emotion**
5. "Only want to share my hikes with my hiking club, not the world" → **relation**

### 附录 D — 偏移量打分锚点(Phase 4 主 agent 用)

**目的**: 防止主 agent 拍脑袋 + self-serving bias。

**打分规则**:
- 0(完全对齐): Cairn 现有实现完全符合用户真需求,证据链清晰
- 1(轻偏): 大方向对,细节需调
- 2(中偏): 方向对,实现方式和用户预期有差距
- 3(重偏): 方向对,实现严重脱离
- 4(错位): 方向本身错了
- 5(空白): Cairn 完全没做,而用户强烈需要

**锚点示例**(测试打分校准):

| 假设主题 | Cairn 现状 | 偏移评分 | 理由 |
|---|---|---|---|
| "N 年后回看" | fog + marker 都能 N 年后看 | 0 | 完全对齐 |
| "私密分享给亲密好友" | 好友订阅 max 5 个 fog | 1 | 大方向对,5 个上限可能不够 |
| "手账 + on this day 提醒" | 有 memory 但无"n 年前的今天" push | 3 | 有基础但缺关键 utility |
| "多设备云同步" | 后端同步 OK,但 iOS 独占无 Android | 3 | 严重限制用户扩展 |
| "商业化定价" | 未定 | 5(空白) | 完全没做 |
| "AI 集成日记辅助" | 无 | 5 (空白) | 完全没做 —— 但 Day One 用户抱怨 AI 侵入,可能是**正确的空白**(不做才是对的) |

**打分完成后必须**:
- 打完全部主题,做一次全表 review 看有没有系统性偏低(self-serving bias 的信号)
- 让**独立 subagent** 复审:给它主题清单和 Cairn 功能描述,让它独立打分,和主 agent 比对
- 冲突 > 20% 的主题,重打

### 附录 E — 半完成文件识别规范

每个 raw 文件末尾必须有:
```
[COMPLETE T+2026-07-18T15:32:00Z, 87 records, tool_call_used 42/50]
```

主 agent 中断续跑时:
1. Read 每个 raw 文件末尾
2. **有 `[COMPLETE ...]` 标记 → 视为完成,跳过**
3. **无标记或标记不完整 → 视为半成品**
   - 检查现有 records 数
   - 决定"续跑"(从最后一条 URL 后继续) vs "重跑"(丢弃 + 重来)
   - 判断依据: 若 records 数 > 50% 目标量 → 续跑; 否则重跑

**Session 收尾**: 每 session 结束前,主 agent 强制:
1. 更新 CURRENT 标记到下一行
2. Write `session_log/S{N}_summary.md`(本 session 完成了什么、发现的坑、下 session 要注意什么)
3. Commit(如果 git 允许)

---

**Last updated**: 2026-07-18 — Plan v3.1 完成 Review 修订
- 修正 Q2 从"陌生人可见接受度"→"点赞/踩/举报反馈机制心理学"
- 加 Phase 0.5 Pre-flight check(10 条)
- 加分 session 执行机制(接受 700-900 tool call)
- 加附录 A/B/C/D/E(Bash 脚本 / JSON schema / 分类决策树 / 偏移锚点 / 半完成识别)
- 加 STOP 心理准备段落 + PRECOMMIT.md 签字
- Phase 3 聚类改机制(不同角度 vs 同源同料)
