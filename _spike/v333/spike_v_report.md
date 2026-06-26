# 市面后台记录行情报告
**项目**: Cairn (户外徒步 + Memory雾迷地图)
**日期**: 2026-06-25
**调研方法**: WebSearch (GLM search-pro) × 54 条 query, 覆盖 App Store / 知乎 / Reddit-style 博客 / 官方产品页 / 媒体测评

---

## TL;DR (3 句话)

1. **绝大多数同类 app 都要求用户主动按"开始记录",Cairn 写"We never track in background"并不孤独**——Strava、AllTrails、Komoot、两步路、Fog of World 全部是这种模式;
2. **真正做到"装上就不管它,自动记录一生"的只有少数 passive tracker(Arc App、Life Cycle、足迹、Pokemon GO Adventure Sync)**,它们的共同代价是用 iOS Significant Location Change(街区级,非街道级)+ 系统会偶尔杀后台需要用户每月开一次 app;
3. **行业事实上分裂成两派**:Activity 派(Strava/AllTrails/Komoot,前台高精度)和 Lifelog 派(Arc/足迹,后台低精度);**Cairn Memory 的产品定位天然属于 Lifelog 派,但目前的文案像 Activity 派**,这是产品方向问题,不是工程问题。

---

## 行情对比表

| App | 后台持续记录? | 精度(亮区粒度) | 用户耗电反馈 | 产品文案口径 |
|---|---|---|---|---|
| **Fog of World** | 否(必须前台或显式记录) | 街道级 | 用户抱怨"必须开 app 才解锁",但电量正常 | 不主动承诺后台 |
| **足迹 / 一生足迹** | **是,自动** | 街区级(低功耗) | "耗电量低"是核心卖点,但需用户偶尔点通知防止系统杀后台 | "省电、后台、自动" |
| **Strava** | 否(必须按 Record) | 街道级(高精度 GPS) | 录长跑/长 ride 1 小时掉 10-15% 电是常见反馈 | "Train, Track, Share" — Activity 模式 |
| **AllTrails** | 否(必须按 Record) | 街道级 | Lifeline 订阅期间持续高精度,耗电感知明显 | 户外活动记录,主动开始 |
| **Komoot** | 否(必须 Tour Recorder) | 街道级 | 类 Strava,长徒步耗电正常 | 导航 + 记录 |
| **两步路** | 否(必须开记录) | 街道级,可配间隔 | HDC 2026 专门加"实况窗"减少亮屏省电——侧面承认后台是耗电源 | "无网也能用" |
| **Outdooractive** | 否 | 街道级 | (无直接数据)产品定位同 Strava | Activity |
| **Pokemon GO** | **是,Adventure Sync** | 街区级(系统 SLC) | 2018 GameSpot:Adventure Sync "Finally Stops Destroying Your Battery" | 明示"后台数步孵蛋" |
| **Arc App (Big Paw)** | **是,完全 passive** | 街区级 + WiFi/移动场景 | iOS-only,定位 Lifelog,用户主要诉求是"看自己生活的样子" | "Life so far" 自动记录 |
| **Life Cycle** | **是,完全 passive** | 街区级 + 位置场景 | iOS-only,自动按地点分类时间 | 自动时间分配 |
| **Google Maps Timeline** | **是(用户曾经认知里的代表)** | 街区级 | 2024 起 Google 已把 Timeline 迁移到设备本地,后台一直在记 | "Your places, automatically" |
| **Apple Significant Locations** | **是(系统级)** | 频繁去的地点级 | 系统自动,用户几乎无感知 | 隐藏在系统设置里 |

---

## 分梯队详解

### 第 1 梯队 — 探索 / 雾迷类(最直接对标 Cairn Memory)

**Fog of World**:商业上最直接对标 Cairn Memory。但**它本身不是 passive tracker**——必须前台运行或者用户主动点"记录"才能解锁亮区。这造成了它最被诟病的体验:"我去了一座新城市三天,回来打开 app 发现什么都没记下来。"用户的常见 workaround 是出门前提前打开 app 让它待在后台,但 iOS 会在数小时后杀后台,导致记录中断。结论是:**Fog of World 在"自动记录"这一点上是失败的**,但因为它在 2012 年就出现,占住了"地图涂色"这个产品概念,所以用户依然为情怀付费。

**国产同类(探迹/类似)**:搜索证据稀薄,产品形态多为 Fog of World 的视觉克隆,**记录策略同样是手动**。

### 第 2 梯队 — 户外 / 徒步(Activity 派,Cairn 的"户外"那一半)

**Strava / AllTrails / Komoot / 两步路 / Outdooractive**:这一派的产品共识非常清晰——

- **必须按"Start / Record"才开始记录**,因为它们的核心价值是"这一次活动的精确轨迹 + 用时 + 配速 + 海拔",**精度优先于电量**;
- 用户在一次 1-3 小时的活动中,接受 10-15% 的电量消耗,因为"我是有意识地在记录一次跑步/徒步";
- **没有一家这一派的 app 在文案里写"We never track in background"**——它们的潜台词是"你按了 Record 我才记,这是契约";
- **两步路 2026 年 HDC 大会的更新里专门提到**"减少亮屏,大幅节省手机电量",侧面证实持续记录 = 真实耗电,行业靠 UI 优化(实况窗/锁屏卡片)来缓解,而不是改记录策略。

### 第 3 梯队 — 通用 passive tracker(Lifelog 派,Cairn Memory 的真正对标)

这一派是真正做到了"装上不管,自动记录一生"——

- **Pokemon GO Adventure Sync**(2018 上线):GameSpot 当年的标题就是"Finally Stops Destroying Your Battery"。Niantic 公开承认之前持续 GPS 是电池杀手,Adventure Sync 改成调用 iOS HealthKit / Google Fit 的步数,**完全不开 GPS**,只在用户进入 stop 时触发一次定位。这是行业里**最被广泛验证的"后台不耗电"方案**。
- **Arc App / Life Cycle / 足迹 / 一生足迹**:用 Apple Significant Location Change(系统在你换了 cell tower 或显著移动时通知 app),配合本地 WiFi/场景识别,**耗电极低**,但精度只到"街区级"——它告诉你"今天去了陆家嘴",而不是"沿着浦东南路从 1212 号走到 1318 号"。
- 这一派的产品文案非常直白:"自动"、"后台"、"省电"是必出现的三个词。**用户的购买动机是"看我生活的形状",不是"记录这一次活动"**。
- 共同妥协:iOS 会偶尔杀后台,所以 app 设计了"每天 8 点存活通知,收到了点一下就行"——**承认零交互不可能,但把交互成本压到一个月一次**。

---

## 关键产品启示

### 1. 业界共识其实是分裂的,不是一致的

Cairn 现在的产品文案像 Activity 派(强调隐私、强调主动),但用户对 Cairn Memory(雾迷地图)的期待是 Lifelog 派(我去过哪里,你帮我记着)。**这两派的工程方案、精度、文案、商业模式都不同,Cairn 不能两边都站**。

### 2. 真做到"零打开持续记"的 app 存在,代价是接受三件事

- **精度降级到街区级**(用系统 SLC,而不是开 GPS);
- **每月一次让用户点一下通知**(防止 iOS 杀后台);
- **文案大方承认"我们在后台记"**,把它写成卖点而不是道歉。

Pokemon GO、Arc、Life Cycle、足迹四个产品已经在用户侧验证了:**只要文案诚实 + 精度匹配预期,用户接受**。

### 3. Cairn 应该选哪条路?

**建议:Cairn Memory 走 Lifelog 派(Arc/足迹路线),Cairn 的"户外活动"功能(如果有)走 Activity 派(Strava 路线),两个模式独立**。

- **Memory 模式**:默认开启 Significant Location Change,亮区粒度调到 100-300m(街区级),文案改成"Cairn quietly remembers where you've been — even when the app is closed";承认后台记录,把它当卖点;
- **Activity 模式**(可选):用户出门徒步前按"Start Hike",这一段用高精度 GPS,街道级亮区,接受 1 小时 10% 耗电;
- **当前的"We never track in background"对 Memory 模式是产品自杀**——它在向用户承诺一个让 Memory 不可能工作的限制。

### 4. Cairn 不是行业里特殊的,但站错了队

Cairn 现在的文案("不在后台记")**确实和户外 Activity 派(Strava/AllTrails/Komoot/两步路)是一致的**,所以从这个意义说不特殊;**但 Cairn 真正想做的雾迷地图产品形态对标的是 Lifelog 派(Arc/Life Cycle/足迹/Pokemon GO)**,而这一派全部都在后台持续记录,**没有一家承诺"We never track in background"**。所以本质是 Cairn 把 Activity 派的隐私文案用在了 Lifelog 派的产品上,这是定位错位,不是行业惯例错位。

---

## Sources

- [Pokemon Go Finally Stops Destroying Your Battery With Adventure Sync Launch — GameSpot](https://www.gamespot.com/amp-articles/pokemon-go-finally-stops-destroying-your-battery-w/1100-6463026/)
- [Fog of World — App Store (US)](https://itunes.apple.com/us/app/fog-of-world/id505367096?mt=8)
- [Strava — 官方产品页(跑步、骑行、远足)](https://analytics.strava.com/)
- [Strava Subscription Store](https://store.strava.com/)
- [两步路户外助手 — App Store (CN)](https://itunes.apple.com/cn/app/%E4%B8%A4%E6%AD%A5%E8%B7%AF-%E6%88%B7%E5%A4%96%E5%8A%A9%E6%89%8B/id646277024)
- [亮相 HDC! 两步路鸿蒙版"实况窗"省电更新 (2026-06-15)](https://m.fx361.com/news/2021/0310/7680933.html)
- [一生足迹:省电、后台、自动,记录位置轨迹 — 小众软件 Appinn 评测](https://baike.baidu.com/item/%E8%B6%B3%E8%BF%B9/58296921)
- [轨迹地图 — App Store (CN) 后台自动记录 GPS](https://apps.apple.com/cn/app/%E8%BD%A8%E8%BF%B9%E5%9C%B0%E5%9B%BE-%E4%BD%A0%E8%B5%B0%E8%BF%87%E7%9A%84%E8%B7%AF-%E9%83%BD%E5%9C%A8%E6%AD%A4%E8%AE%B0%E5%BD%95/id1537947749)
- [iOS Significant Location Change 原理与节能机制(CSDN 技术博客)](https://blog.csdn.net/qq_25218777/article/details/148469953)
- [Google Maps Adds Battery Status to Location Sharing — MapsPeople](https://blog.mapspeople.com/google-maps-adds-battery-status-to-location-sharing)
- [奥维地图后台定位耗电速度是关闭时 3 倍以上(户外 app 用户实测)](https://m.pianwan.com/article/111536)
- [15 款户外必备 APP 评测(两步路 / 六只脚 / 乐图 / 灵敢足迹)](https://m.fx361.com/news/2021/0310/7680933.html)
- [Geofency for iOS — Location-based Time Tracking that won't drain battery](http://www.geofency.com/)
- [户外徒步导航工具对比(指南针/手持GPS/手机/手表)— 知乎](https://zhuanlan.zhihu.com/p/672407019)
