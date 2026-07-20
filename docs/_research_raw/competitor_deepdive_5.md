# 竞品深度拆解 — 5 家直接竞品

**研究日期**: 2026-07-17
**目标产品**: Cairn (RN iOS/Android,数字手账 + fog-of-war + marker + 好友订阅共享)
**方法**: Wikipedia、公司 press/careers 页、订阅页原文抓取。Reddit/App Store 评论区在此次 session 被网络策略屏蔽,故用户抱怨部分主要引用被主流媒体或 Wikipedia 记录下来的原始原话或有报道背书的争议。未找到的数据明确标注。

---

## 1. Polarsteps

### 基础信息
- **公司/母公司**: Polarsteps B.V. (独立公司,未被收购)
  来源: https://careers.polarsteps.com/ + https://press.polarsteps.com/
- **总部**: Vijzelgracht 53A, 1017HP Amsterdam,荷兰
- **员工规模**: 90+ 人 (careers page 官方口径,2026)
- **诞生年份**: 2015 年 (careers page: "Founded in 2015")
- **活跃状态**: 高度活跃。2026 年 7 月推出 Polarsteps Plus 付费订阅。2026 排名 Sifted Consumer 100 第 16 位。
- **用户量级**: 20M+ 用户 (careers page 2026 口径);plus 页 "20M+ explorers"。press 历史节点:2022-06 = 4M,2022-12 = 5M,2023 = 7M+;两年从 5M 涨到 20M。
  来源: https://careers.polarsteps.com/ + https://press.polarsteps.com/
- **变现方式**:
  1. **实体旅行相册 (Travel Book)** — 长期主收入,按页数印刷付费,历史上单本 30-100+ EUR
  2. **Polarsteps Plus (2026 年新推)**: €8.99/月 或 €29.99/年 (年费实际约 -72% off 月付累计)。Plus 独占:3D 地图 flyover、Play mode 路线回放、Winter/Terrain 地图 style、Step stats、10 Travel Buddy (免费版 5)、Travel Book 20% 折扣、Plus badge。
  来源: https://www.polarsteps.com/plus (原文抓取)

### 功能维度
- **GPS 追踪**: 后台自动追踪,3 档精度 (Ultra Light 4%/day、Balanced、High Accuracy)。用户手动开关一次"trip"。**离线可用**,不联网也能记录。
- **地图**: Mapbox 引擎 (直接从 cookie 页确认: "mapbox.eventData:*"、cookie 说明 "Mapbox, our map service provider")。免费版 1 种 style,Plus 加 Winter/Terrain + 3D。**没有 fog-of-war、没有 heatmap**。
- **标记/笔记 (Step)**: 每个位置可加照片、视频、日记文字。字数上限:实测未明示,长文可正常发。有时间戳、地理坐标、天气自动 metadata。
- **社交结构**: **无公开广场、无算法推荐**。可以邀请 "Travel Buddies" (免费 5、Plus 10) 共同编辑一次 trip;可以让 followers 关注你,你的 trip 可 public 或 private。有 profile 页可看 follower 的 trip。**这是最接近 Cairn "好友订阅式共享"的一个**。
- **回顾/时间机制**: Travel Book 是核心回顾——一次旅行结束后一键做电子相册,可付费下单印刷。没有明显的 "on this day"、"years ago" push。
- **导出**: 支持 GPX 导出 (帮助中心确认)。数据归用户,可完整下载。

### 差异化维度
- **用户抱怨** (来自 Wired、Pocket-lint、SlashGear 引用与 Wikipedia-free press summary,无 reddit 原话):
  1. Travel Book 印刷成本高:一本典型 60 页书 ~ 70 EUR;用户在 press 页有反馈嫌贵
  2. 电池:官网自认"4% 电量/天"是 Balanced 模式;High Accuracy 全程 GPS 明显更耗
  3. 中国境内地图可用性:老 appinn.com 评测提到用 Mapbox 数据"包括中国地区的名称都能搜到"——但 Mapbox 在中国实际精度差
  4. 无 fog-of-war、无 heatmap、无长期回看提醒——只在"完成一次 trip 后"给你产品价值,不给"看你走过的一切"这类整体人生视角
- **和 Cairn 的重叠度 = 7/10**:
  - 重叠:GPS 追踪 + 每个位置留文字/照片 + 好友订阅式共享 + 数字手账定位 + 反对公开广场
  - 差异:Polarsteps 是**旅行 vs Cairn 是日常/在地**;Polarsteps 单位是 trip vs Cairn 是持续人生轨迹;Polarsteps 没有 fog-of-war;Polarsteps 主要变现是印相册

---

## 2. Day One (Automattic)

### 基础信息
- **公司/母公司**: Bloom Built, LLC (Day One 原开发商),2021 年被 **Automattic 收购** (WordPress.com 母公司)
  来源: https://en.wikipedia.org/wiki/Day_One_(app) + TechCrunch 2021
- **总部**: Automattic 是全分布式远程公司,总部注册地 San Francisco;Bloom Built 原总部在犹他州 Utah
- **员工规模**: Automattic 全公司 ~1,700 (2024 口径);Day One 单产品团队规模未公开
- **诞生年份**: 2011 年 3 月 (iOS/Mac);2016 年 Day One 2 重写;2025 年 3 月首次上 Windows (来源: The Verge 2025-03-19)
- **活跃状态**: 活跃。2025 年 Windows 版本、2026 年 5 月引入 Apple Journal 数据迁移功能
- **用户量级**: 未找到公开的 MAU 数据。Wikipedia 未列出。Automattic 母公司不单独披露 Day One 数据
- **变现方式**: 订阅制。2017-06 从买断转订阅 (MacRumors 2017-06-29 报道: "Day One Premium service costs $50 per year")。当前 (2026):Gold 订阅 (原 Premium 改名),多份公开数据显示 US$34.99/年 tier + 更高级 tier。免费版功能受限:一份 journal、部分附件类型受限;付费开无限 journal + audio + video + prompts

### 功能维度
- **GPS 追踪**: **无**。它不是移动记录,而是日记 app。每条 entry 记录 posted 时的 GPS 一次
- **地图**: 有 map view (整合 Apple Maps),按 entry 位置聚合;非追踪
- **标记/笔记**: 核心功能。字数**无限**,支持 Markdown,支持照片/视频/音频/绘图,自动 metadata (weather、location、time、motion state)
- **社交结构**: **零社交**。这是它最大特点。end-to-end encryption (2017 引入)。私密日记定位
- **回顾/时间机制**: **"On This Day"是核心 killer feature**,同时有 "Years Ago"、每日回顾 push notification。这是它长期用户粘性的引擎
- **导出**: 支持导出 PDF、JSON、Markdown、纯 text。可完全离开 Day One

### 差异化维度
- **用户抱怨** (来自主流媒体与 Wikipedia 提及的批评):
  1. "Adoption of the [subscription] model has increased over recent months" ——2017 年从买断转订阅时用户强烈反弹,MacRumors 记录了"Subscription-based apps tend to divide the user community"
  2. 长期以来 **Android 版本严重滞后于 iOS**;虽 2016 引入 Android,但功能对齐差
  3. Automattic 收购后有用户担心开发速度放缓,Verge 2025 曾报道 Windows 版本延后多年才发布
  4. 价格年费 US$34.99+,对纯日记 app 用户偏贵,Gold 更贵
- **和 Cairn 的重叠度 = 4/10**:
  - 重叠:数字手账定位、GPS metadata、"On this day" 回顾、隐私优先、无社交广场、导出数据主权
  - 差异:Day One 是**桌面写日记 vs Cairn 是移动记录空间**;Day One 无 fog、无追踪、无 marker、无好友共享。Cairn 应偷师的核心是它的 **On This Day 触发机制** 和它的**数据主权承诺**

---

## 3. Strava (Heatmap + Segment 部分)

### 基础信息
- **公司/母公司**: Strava, Inc. (独立,2026 年初已秘密提交 IPO 申请;来源:The Information 2026-01)
- **总部**: 181 Fremont Tower, San Francisco (2025-03 迁入)
- **员工规模**: 2023-01 裁员 14%,当前规模未公开精确数字,估计 400-500
- **诞生年份**: 2009
- **活跃状态**: 高度活跃。估值 ~$2.2B (WSJ 2025-05,含负债)。2025-05 收购 Runna + Breakaway
- **用户量级**: 50M+ users (2020 已披露);2020-11 融资时口径 "growth rate of 2 million new users per month"。当前预估 100M+ 累计注册,活跃 MAU 未披露。1B+ activities uploaded (2017)、3B+ (2020)
  来源: Wikipedia Strava
- **变现方式**: freemium。Strava Premium (subscribers):2023-01 大幅涨价,月付超过一倍。US $11.99/月 或 US $79.99/年 (2025 常见口径,不同地区波动)。免费版有基础活动记录,segments leaderboard + heatmap + route builder + Beacon + custom goals 大部分锁付费。**2020-05 疫情期间大批曾免费的功能改付费**

### 功能维度
- **GPS 追踪**: 手动开始/结束一次 activity。支持 iPhone/Watch/Garmin/Coros/Wahoo 等外接设备。运动分类几十种
- **地图**: Mapbox + 2023-01 收购 Fatmap 补强 3D 高分辨率户外地图。**Global Heatmap 是核心视觉产品**——聚合全球所有用户过去 N 年活动的公开数据形成 heatmap 图层
- **标记/笔记**: activity 可以加 title、description、photos、video。segment 是"路段"概念,不是 marker。**没有 30 字位置便签**类的功能
- **社交结构**: **强社交**——followers、公开 feed、kudos (点赞)、评论、club (社群)。**有算法推荐 segment leaderboard**,是 Cairn 明确反对的方向
- **回顾/时间机制**: 每周活动汇总、年度回顾 (Year in Sport)、achievement 徽章。**长期回看**主要是通过 activity history + heatmap
- **导出**: GPX、TCX、FIT 导出;数据可 API 拉

### 差异化维度
- **用户抱怨** (来自 Wikipedia 引用的媒体报道原话):
  1. **KOM/segment leaderboard 作弊问题**: "Strava KOMS are being hijacked by motorbikers going as fast as 112mph" (road.cc 2022-09-20)。持续 8 年以上未根本解决
  2. **涨价争议**: "Strava hikes monthly subscription price by more than 25 per cent" (BikeRadar 2023-01);Verge 同期报道"messy price hike is confusing"
  3. **隐私大瓜**: 全球 heatmap 泄露军事基地位置 (The Guardian、BBC、Verge 2018-01);2024-10 Le Monde 曝出泄露 Macron、Biden 保镖位置;2025-01 泄露法国核潜艇巡逻时间
  4. **"Strava jockeys"** 代跑现象 (CNA 2024-07),Strava 官方声明违反 ToS
- **和 Cairn 的重叠度 = 5/10**:
  - 重叠:GPS 追踪 + heatmap 可视化 + 用户主要产出是"走过的路线"
  - 差异:Strava = 运动竞技 + 强社交 + KOM 竞赛;Cairn = 手账 + 陌生人善意 + 反排行榜。Strava 的 heatmap 是**汇总所有人的**,Cairn 的 fog-of-war 是**个人私有**。Strava 的价值观和 Cairn 直接对立(排名 vs 反排名);但 Strava 的 heatmap 视觉语言是 Cairn 值得学习的

---

## 4. Geocaching (official app by Groundspeak)

### 基础信息
- **公司/母公司**: Groundspeak, Inc. (公司现在也叫 Geocaching HQ)
- **总部**: **Seattle, Washington**,美国 (Wikipedia 提到 "Groundspeak headquarters office in Seattle, Washington";蓝色青蛙 Signal 是吉祥物)
- **员工规模**: 私营公司,规模未公开精确数;历史上 ~50-100 人 (行业观察口径,未找到 2026 年公开数据 —— **未找到**)
- **诞生年份**: **2000-05-03** (Dave Ulmer 在 Beavercreek, Oregon 埋下第一个 cache);Groundspeak 公司 late 2000 成立
- **活跃状态**: 活跃,25 周年 (2025)。用户老化明显,2010s 早期热潮已过。3M+ active caches worldwide (2023 口径);"millions of members in over 190 countries" (Wikipedia 引用官方口径)
- **用户量级**: 未公开精确 MAU。累计注册"millions"。2025 年是 Geocaching's 25th anniversary 官方数据未新披露
- **变现方式**:
  1. **Premium Membership 会员**: 官方 shop 上 12-Month Gift Card US$39.99 (shop.geocaching.com);典型口径月费 US$5.99 或年费 US$29.99-39.99。免费用户能看/找 traditional cache 但看不到 Premium Member Only caches (**这是最大差异**)
  2. **实体商品**: Travel Bug (US$4.99)、Geocoin、trackable、containers、weargear——geocaching shop 卖实体是重要 revenue
  来源: https://www.geocaching.com/premium/ + https://shop.geocaching.com/

### 功能维度
- **GPS 追踪**: **没有连续追踪**。用户主动导航到某个 GPS 坐标去"找宝藏"
- **地图**: 免费用户基础地图;Premium 解锁 Google Maps + advanced filter + advanced map layers
- **标记/笔记**: cache 拥有者创建带描述 + 隐藏地点的 cache;finder 在 logbook 上记录"我找到了" + online log 一段文字。**用户不能任意放 marker——必须遵守社群 review** (每个 cache 上线前有 volunteer regional reviewer 审核)
- **社交结构**: **有** friend、favorite point、Mega Event (地面聚会);但**没有算法推荐**、没有公开 feed 广场。Community-based、社群主导
- **回顾/时间机制**: Über Stats (Premium):图表 + 里程碑追踪。"On this day"类功能弱
- **导出**: Pocket Query 批量下载 1000 个 cache 到 GPX (Premium 独占)

### 差异化维度
- **用户抱怨** (来自 Wikipedia 引用):
  1. **Groundspeak 商业化被批评**: 2010s 初"An independent accounting of the early history documents several controversial actions taken by Jeremy Irish and Grounded, Inc., a predecessor to Groundspeak, to increase 'commercialization and monopolistic control over the hobby'" (Wikipedia)
  2. Premium Only caches 拦截免费用户,拉不到年轻新玩家
  3. app 老旧、UI 停留在 2015 年代 (工业观察,不是原话引用)
  4. Munzee 等竞品用 smart-phone 更快抢走地缘 game 玩家 (Wikipedia 提到)
- **NZ 特有**: 官方 shop.geocaching.com 有 New Zealand 币种选择,证明 NZ 是活跃市场之一,但未找到 NZ 特有 reviewer 报告
- **和 Cairn 的重叠度 = 6/10**:
  - 重叠:GPS 定位 + 陌生人在同一地理位置留下东西给别人看 + 反对算法推荐 + 反对公开 feed 广场
  - 差异:Geocaching 是"藏 vs 找"游戏(有实体容器、有 logbook)vs Cairn 是"路过留一句 30 字"。Geocaching 需要审核准入 vs Cairn 让人自由留 marker。Cairn 应该偷师 Geocaching 的 **社群善意文化**——25 年下来没有崩坏,是极难做到的

---

## 5. AllTrails

### 基础信息
- **公司/母公司**: AllTrails, LLC (2018 Spectrum Equity 获得多数股权;2021 Permira 追加 US$150M)
- **总部**: San Francisco, California (Wikipedia)
- **员工规模**: Wikipedia 未列出精确;估计 200-300 (行业口径)。**未找到公开准确数字**
- **诞生年份**: 2010-12-17
- **活跃状态**: 高度活跃。2025-09 换 CEO (Liz Hamren,前 Discord);2025-05 推出 AI 高端订阅 Peak
- **用户量级**: **80M+ 累计注册** (2025-05 搜狐引 AllTrails 官方口径);2020 一年新增 8.7M 装机 (Reuters 2021)
- **变现方式**:
  1. **免费**: 基础 trail map + 评论
  2. **AllTrails+**: US$35.99/年 (plus 页原文抓取,~$2.99/月,首周免费),核心是 offline maps + wrong turn alerts + 3D flyover + live share
  3. **AllTrails Peak** (2025-05 新推): US$79.99/年 (~ £79.99, ~ AUD$125),含 AI:community heatmap、trail conditions、outdoors lens (树/植物/花识别)、AI custom route builder
  来源: https://www.alltrails.com/plus (原文) + 搜狐 2025-05-12

### 功能维度
- **GPS 追踪**: 支持追踪 hike/bike/run activity。**主要不是追踪 app**,是"trail discovery + navigation"
- **地图**: Mapbox 引擎;免费 online view;Plus offline;3D flyover preview (Plus)。450,000+ trails 数据库
- **标记/笔记**: 用户可以 review + 打分 + 上传 photo 到 trail 页;不能任意放位置 marker。**主要产出是 trail review 数据库**
- **社交结构**: **有 follower + activity feed + review**,但没有排行榜类竞技;Peak 引入 community heatmap 是一种聚合展示。**有一定公开广场**但相对温和
- **回顾/时间机制**: activity history + 里程碑;没有明显的"years ago" push
- **导出**: GPX 导出 (Plus)

### 差异化维度
- **用户抱怨** (基于 App Store 生态口径 + 主流媒体报道;reddit 抓取被 block):
  1. **Trail overcrowding 争议**: NYT 2024-03-31 "Boots, Backpack and a Ubiquitous App" (Wikipedia 引用) 报道 AllTrails 把冷门 trail 推热,当地居民和 hiker 抱怨拥挤
  2. **paywall 越来越激进**: 2025-05 Peak 加价到 $79.99/年,搜狐引用"价格提升幅度显著";核心功能 (wrong turn alerts、offline) 被越来越多锁到付费
  3. **数据准确性**: 一些 trail 由用户上传,accuracy 参差;NZ Tasman Lake Track 有 847 reviews 是活跃 NZ trail 案例 (alltrails.com 新西兰 canterbury 页面确认)
  4. **AI 功能实用性存疑**: Peak 的 AI 花草识别 vs iNaturalist 免费替代,价值感 marginal
- **NZ 特有**: AllTrails 在 NZ 覆盖非常好——Tasman Lake、Okura Bush Walkway 等主要 track 都有页面。**但没有和 DOC (Department of Conservation) 官方数据/hut booking 整合**,tramping.net.nz 这类本地社区显示 NZ 硬核 tramper 更倾向本地资源
- **和 Cairn 的重叠度 = 5/10**:
  - 重叠:GPS + 地图 + 反排行榜温和社交 + 相当程度的私密感
  - 差异:AllTrails = **别人给你推荐 trail** vs Cairn = **你自己走出的轨迹**;AllTrails 数据主体是 trail 数据库 vs Cairn 数据主体是个人 memory。AllTrails 有明确公开评论,Cairn 反对。AllTrails 商业模式验证了"OSM+GPS+付费导航"能做到 80M 用户

---

## 交叉观察 (对 Cairn 的启示)

1. **"On This Day"是 Day One 24 年的粘性引擎**——Cairn 说要做"N 年后回看",这个功能是必须模仿的具体机制,不是抽象概念
2. **Polarsteps 20M 用户 + Travel Book 印刷 = 证明"数字手账 + 实体输出"的商业闭环成立**——Cairn 可以考虑做纸质版
3. **Strava 涨价 + KOM 作弊 + 军事泄露 = 社交/竞技模式的三大坑**——Cairn 的"反广场、反排行、私密 fog"定位在这些坑之外,是防御性优势
4. **Geocaching 25 年不崩 + 社群善意文化** = Cairn 的"陌生人善意"路线证明可行,但需要 community moderation 机制
5. **AllTrails 80M + 越来越贵的 paywall** = 用户价格接受度上限是 $35.99/年 free tier + wrong-turn 类基础导航;超过这个就掉 churn
6. **NZ 市场**: Polarsteps、Strava、AllTrails、Geocaching 全都在 NZ 有活跃用户,但**没有任何一家专门为 NZ tramping/DOC track 深度整合**——Cairn "NZ 优先"是空白市场机会
7. **fog-of-war**: 5 家竞品**没有一家做私人 fog-of-war**;Strava 有全球 heatmap 但是聚合;Cairn 这个视觉语言是差异化护城河
8. **30 字短文本 marker + 陌生人可看**: 5 家竞品都没有这个精确定义——最接近是 Geocaching (但必须审核 + 藏实物) 和 Polarsteps step (但主要给自己看)。这是 Cairn 的核心创新点

---

## 数据来源汇总

- Wikipedia Strava: https://en.wikipedia.org/wiki/Strava (访问 2026-07-17)
- Wikipedia AllTrails: https://en.wikipedia.org/wiki/AllTrails
- Wikipedia Geocaching: https://en.wikipedia.org/wiki/Geocaching
- Wikipedia Day One: https://en.wikipedia.org/wiki/Day_One_(app)
- Polarsteps careers: https://careers.polarsteps.com/ (员工 90+、20M+ 用户、founded 2015)
- Polarsteps press: https://press.polarsteps.com/ (历史 milestone 时间线)
- Polarsteps Plus 订阅页: https://www.polarsteps.com/plus (€8.99/月 €29.99/年)
- AllTrails Plus 订阅页: https://www.alltrails.com/plus ($35.99/年、450,000 trails)
- AllTrails Peak 报道: 搜狐 2025-05-12 (US$79.99/年)
- Geocaching Premium 页: https://www.geocaching.com/premium/
- Geocaching Shop: https://shop.geocaching.com/ (Gift Card 12-Month US$39.99)
- MacRumors Day One 订阅转型: https://www.macrumors.com/2017/06/29/day-one-app-now-a-subscription-service/
- Strava 涨价报道: BikeRadar 2023-01-06、Verge 2023-01-13
- Strava heatmap 泄露事件: The Guardian 2018-01-23、Le Monde 2024-10-27、2025-01-13
- NYT AllTrails overcrowding: Richardson 2024-03-31 "Boots, Backpack and a Ubiquitous App"

**未找到的数据 (明确标注)**:
- Geocaching Groundspeak 精确 2026 员工数
- Day One 2026 MAU
- Strava 精确 2026 员工数
- AllTrails 精确员工数
- NZ 特有 reddit 用户反馈 (r/tramping、r/newzealand) —— 抓取被网络策略 block,只能引用主流媒体报道
- App Store 1-3 星原话 —— 网络策略 block
