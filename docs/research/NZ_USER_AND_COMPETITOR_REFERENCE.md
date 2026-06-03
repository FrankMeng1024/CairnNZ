# Cairn — NZ用户与竞品视觉参考基线

> **用途**：本文档是Cairn项目的**长期视觉/语调/竞品参考基线**。所有Sprint的Frontend Dev、UX、PO在做设计决策时优先参考本文。
>
> **创建日期**：2026-05-18
> **状态**：基线文档（baseline reference），变更需走CR流程
> **来源**：3个并行Research Agent综合（NZ用户偏好+NZ视觉识别+15竞品分析）

---

## 文档地位

| 文档 | 关系 |
|---|---|
| `docs/PRD.md` / `docs/PRD2.md` | 业务需求（What） |
| `docs/UI_SPEC.md` | UI接口契约（How技术层） |
| `docs/DISCOVERY.md` | 项目类型/UI意图/受众 |
| **本文档** | **设计参考基线（Why这样选）—— 所有视觉/语调/词汇决策的支撑文档** |

本文档是**参考资料**，不是契约。当UI_SPEC.md与本文档冲突时，UI_SPEC.md胜出（实现层）。但当Frontend Dev/UX需要做新决策（颜色微调、新marker类型、文案语调）时，必须先查本文档建立基线，再与Arch讨论是否更新UI_SPEC.md。

---

## ⚠️ 数据可信度说明

- 所有hex值为社区/公开知识值，**生产前用品牌官方guideline再确认一次**
- GLM搜索对NZ英文query噪声较大，关键事实建议用境外搜索引擎二次verify
- 竞品视觉描述基于已建立的产品公开知识+官方URL锚点，**未做live screenshot fetch**（企业网络封锁）
- 如需evidence-backed版本：充值GLM credits 或在能访问apps.apple.com / mobbin.com的环境重跑，分析框架不变只补URL

---

# 第一部分：新西兰用户画像

## 1.1 NZ设计审美的本质

新西兰用户的审美和美/英/澳明显不同，自成一派：

| 维度 | 美国 | 英国 | 澳洲 | **新西兰** |
|---|---|---|---|---|
| 默认饱和度 | 极高 | 中 | 高 | **低-中** |
| 文案风格 | "Epic! Discover! Unleash!" | 庄重正式 | 阳光自信 | **直接、冷静、有干式幽默** |
| 视觉气质 | 营销感 | 制度感 | 海滩感 | **务实、自然、克制** |
| 对鸡汤反应 | 受用 | 中性 | 受用 | **反感（认为肉麻）** |

**关键词**：understated（克制）、direct（直接）、naturalistic（自然主义）、premium-through-restraint（用克制达成高级感）。

## 1.2 户外文化术语（用错=外人）

| ❌ 美式（NZ人皱眉） | ✅ NZ式（必须用） |
|---|---|
| Hiking | **Tramping**（多日带包）/ **Walk**（一日游） |
| Trail | **Track** |
| Cabin / Shelter | **Hut**（DOC的山屋） |
| Easy/Medium/Hard | **DOC官方6级分类**（不能自创） |

**DOC官方6级难度（必须照搬）**：
1. Short Walk（轮椅可达）
2. Walking Track（平整易走）
3. Easy Tramping Track（Great Walks标准）
4. Tramping Track（需导航能力）
5. Route（仅有路标，无成形路面）
6. Expert / Mountaineering（高山技能）

## 1.3 Great Walks官方明星步道（必须预置数据）

DOC认定的11条精品多日步道，**NZ用户期望任何户外APP打开就能找到**：

1. Lake Waikaremoana
2. Tongariro Northern Circuit
3. Whanganui Journey（河上漂流）
4. Abel Tasman Coast Track
5. Heaphy Track
6. Paparoa Track
7. Routeburn Track
8. Kepler Track
9. **Milford Track**（"the finest walk in the world"）
10. Rakiura Track（斯图尔特岛）
11. **Hump Ridge Track**（2024新增）

**一日经典必收**：Tongariro Alpine Crossing（最热门）、Hooker Valley、Roy's Peak、Mt Taranaki、Pinnacles。

**Te Araroa**：3000km纵贯南北岛长线（北Cape Reinga到南Bluff），4-6个月thru-hike，需要segment追踪功能。

## 1.4 移动设备与数据习惯

| 维度 | 数据 | Cairn含义 |
|---|---|---|
| **iPhone份额** | 55-60%（iOS主导） | iOS优先设计 |
| **数据资费** | 比美澳贵 | **离线优先是硬约束** |
| **步道信号** | 大部分Great Walks无信号 | GPS+离线地图必备 |
| **隐私意识** | 极强（Privacy Act 2020，13条原则） | 位置数据明确说明用途 |
| **第三方追踪** | 用户惩罚SDK塞货 | 不要塞FB SDK / 通用Analytics |

## 1.5 信任信号（强→弱）

1. **DOC（保护部）合作或数据** — 最强（封顶）
2. **NZMSC + Plan My Walk + #MakeItHomeNZ** — 国家级安全教育NGO
3. **MetService** — 国家气象局，**必须显式标注来源**
4. **LINZ Topo50** — 国家地形图离线
5. **NZ-owned / Made in Aotearoa** — 团队在NZ的明示
6. **Te Araroa Trust** — 长线徒步社群
7. **Iwi/Hapū合作** — 毛利土地上的特定步道

## 1.6 UX语调（最难、最关键）

**核心张力**："She'll be right"（NZ式随意乐观）vs. 户外救援文化的严肃性。NZMSC的#MakeItHomeNZ运动就是为了打破"She'll be right"。

✅ **正确语调**（DOC/MSC风格）：
- "Track is closed."
- "River crossings are the most common cause of tramping fatalities. Don't cross flooded rivers — wait it out."
- "Tell someone your plans before you go."
- "This track requires backcountry experience and navigation skills."

❌ **错误语调**（美式，立刻被反感）：
- "⚠️ EXTREME DANGER!"
- "Unleash your epic adventure!"
- "Achieve your goals today!"
- 过分Disney化的提示

**视觉警示色逻辑**：橙色用于"on track / off track"日常导航；**红色严格保留给真正紧急**（PLB级别、极端天气）。

## 1.7 双语UI（默认期望，不是加分）

NZ政府数字服务标准（Digital Service Design Standard）已把双语视为baseline：

- 地名双标：**"Aoraki / Mount Cook"**（毛利名优先，跟随NZ Geographic Board双名规则）
- **必须用宏符号**：Māori、Aoraki、Tāmaki Makaurau、Ngā mihi —— 缺=不专业
- 小词点缀（**正确使用**）：Kia ora（你好）、Nau mai haere mai（欢迎）、Ngā mihi（致谢）
- **必须聘正式翻译**（Te Taura Whiri官方注册名单），机翻=失礼

---

# 第二部分：新西兰视觉语言（强NZ身份）

## 2.1 推荐配色（5主+2辅，已锁定）

| 角色 | 颜色 | Hex | 来源 / 语义 |
|---|---|---|---|
| **主锚色** | Beech-forest深绿 | `#1F3F2B` | DOC官方绿系+南岛森林 |
| **底色（地图纸）** | Topo50米色 | `#F7F2E5` | 致敬LINZ地形图，避开Mapbox通用白 |
| **安全标记色** | DOC步道橙 | `#F26522` | DOC三角路标橙。**严格仅用于安全标记/偏离纠错/"你在这里"，绝不做营销CTA** |
| **危险红** | 警报红 | `#D52B1E` | 对齐MetService红色警报+MSC安全红，仅SOS / 雪崩极端 |
| **交互蓝** | 冰川湖青 | `#3F8FA0` | Tekapo湖蓝，区别于银行死板蓝 |
| 辅色 | 草丛金 | `#C9A35B` | 高山草原秋色，徽章/完成态 |
| 辅色（罕用） | Pohutukawa红 | `#B8261C` | NZ"圣诞树"花色，季节彩蛋 |

## 2.2 严重等级阶梯（必须对齐NZ全国标准）

```
安全 #3D7A4B → 注意 #F0C419 → 警告 #F26522 → 严重 #D52B1E → 极端 黑底红
（绿）         （黄）           （橙）           （红）           
```

这是MetService、雪崩警报（NZAA）、MSC共享的一套，**不能自创** —— NZ用户已形成肌肉记忆。

## 2.3 字体方向

- **首选（有预算）**：**Klim Type Foundry**的Söhne / Calibre / Founders Grotesk（惠灵顿设计师Kris Sowersby出品，是NZ高端品牌默认选择，包括Air NZ / The Spinoff / 政府咨询）—— **用Klim字体本身就是"我们是本地做的"暗号**
- **免费替代**：Inter（UI）+ Source Serif Pro（编辑感）
- **Monospace**（坐标/网格）：JetBrains Mono / IBM Plex Mono
- **必须**支持毛利长音符号：ā ē ī ō ū Ā Ē Ī Ō Ū（实际渲染验证kerning，许多免费Google字体macron渲染粗糙）

## 2.4 图标 / 标记风格

- **品牌主标**：3块石头堆叠的Cairn剪影（圆鹅卵石、不对称） —— 全球可读+NZ Route真用石堆做路标，不涉及毛利文化挪用
- **地图Pin形状**：等腰三角形（朝上）内嵌标准Pin —— 借DOC三角轮廓但不抄
- **图标库基底**：Phosphor / Lucide，户外定制（小屋、帐篷、过河、雪崩、天气警报）。**线性、2px描边、圆角**
- **避免**：Material Design填充圆角（太"Google"）、REI/Patagonia山线艺术logo（一看就是美国货）

## 2.5 摄影风格

- **NZ自然光**：高对比、低雾度，**不要美式Instagram饱和度**
- **人物在画面里很小** —— 风景压人（参考"100% Pure NZ" campaign）
- **真实记录**：步道照片要真用户、真天气，不要模特/打光
- **辨识度细节**：tussock草原、辫状河、山毛榉林、远处冰川峰
- **空状态/加载页**：Pīwakawaka（扇尾鹟）、Kea（高山鹦鹉）剪影

## 2.6 毛利文化处理（最敏感）

**可做的**：
- 双语UI（毛利文+英文）
- 地名双标（"Aoraki / Mt Cook"，毛利名前置）
- 小词点缀（Kia ora / Nau mai haere mai / Ngā mihi）
- 正确使用宏符号
- **聘请毛利文化顾问（kaitiaki）+ 注册Te Reo译者**（Te Taura Whiri名单），上线前必做，写入`docs/cultural-consultation.md`

**绝对不能做**：
- ❌ Tribal pattern背景（kowhaiwhai/tukutuku没iwi授权碰不得）
- ❌ Koru当装饰（被商业用滥+文化挪用风险）
- ❌ Tā moko（毛利面部刺青纹样）—— 完全禁区
- ❌ 机翻或缺宏符号的Te Reo

**Cairn品牌建议**：石堆Cairn符号本身**全球通用**（不是毛利专属），是**安全的品牌符号**。

## 2.7 NZ原生物种（视觉语言推荐度）

| 物种 | 推荐度 | 理由 |
|---|---|---|
| **Kea**（高山鹦鹉） | ⭐⭐⭐⭐⭐ | 住在Cairn用户去的高山带，淘气有特点 |
| **Pīwakawaka**（扇尾鹟） | ⭐⭐⭐⭐⭐ | 森林伴侣，可爱低俗气 |
| **Weka** | ⭐⭐⭐⭐ | 友好步道鸟，少有人用 |
| **Tūī** | ⭐⭐⭐ | 标志性，但更多在低海拔 |
| **Pukeko** | ⭐⭐⭐ | 紫蓝色沼鸡 |
| **Kiwi** | ⭐⭐ | 国鸟但**已被旅游业用滥**，容易土气 |

**结论**：Kea + Pīwakawaka是最佳选择。Kiwi要么不用，要么极简极克制。

## 2.8 NZ景观色彩签名（带可用hex）

| 颜色 | 来源/含义 | Hex |
|---|---|---|
| Tussock金 | 高山草原秋色 | `#C9A35B` |
| Beech森林绿 | 南岛山毛榉冠层 | `#2E4A2E` |
| 冰川湖青 | Tekapo / Pukaki / Hāwea | `#5FAEB6` |
| 玄武岩黑 | Tongariro / Taranaki | `#1A1A1A` |
| Pohutukawa红 | NZ"圣诞树" | `#B8261C` |
| Kōwhai黄 | 非官方国花 | `#F0C419` |
| Harakeke / 亚麻绿 | 海岸亚麻 | `#3A5F3A` |

---

# 第三部分：NZ词汇表（必收）

| 术语 | 含义 | 使用建议 |
|---|---|---|
| **Tramp / tramping / tramper** | 多日带包过夜 | 大胆使用 |
| **Track** | 步道 | 永远用track，不要trail |
| **Hut** | DOC山屋 | 不要cabin |
| **Bach**（读"batch"） | 海边度假小屋 | 偏沿海 |
| **Tiki tour** | scenic detour / 漫游 | **完美的"探索模式"标签** |
| **Cairn** | 石堆路标 | 已是APP名 ✓ 全球通用 |
| **PLB** | Personal Locator Beacon | 关键安全缩写 |
| **Hut book / Intentions** | 山屋登记本/出行计划 | 安全功能 |
| **Nau mai, haere mai** | 欢迎 | Te Araroa Trust在用，可放欢迎页 |
| **Kia ora** | 你好 | 不要只放这一个Te Reo词（=tokenism） |
| **Gumboots** | 雨靴 | 文化符号，不是UI术语 |
| **Jandals** | 人字拖 | 老一辈identity，已显dated |

---

# 第四部分：竞品视觉分析（15个APP）

## TIER 1 — 直接深度竞品

### 1️⃣ AllTrails — 大众步道发现的默认选项

- **URL**：[App Store NZ](https://apps.apple.com/nz/app/alltrails-hike-bike-run/id405075943) / [alltrails.com](https://www.alltrails.com/)
- **定位**："Find your outside." 数据库优先，靠curated trails取胜
- **配色**：森林绿 `#2D7D32`系 + 米白底 + 暖橙路线
- **字体**：圆润几何sans，标题大字号
- **地图**：柔和pastel底，路线粗厚红橙色，难度色编圆点Pin
- **隐私**：⚠️ **默认公开**，opt-out藏深处（**Cairn要避免**）
- **学什么**：难度色编通用易懂；粗厚路线易看；Hero照片必备
- **避什么**：AllTrails绿是品类最被claim的颜色，Cairn选纯绿=显得抄；默认公开=隐私雷区

### 2️⃣ Strava — 运动员的社交网络

- **URL**：[App Store NZ](https://apps.apple.com/nz/app/strava/id426826309) / [strava.com](https://www.strava.com/) / [brand.strava.com](https://brand.strava.com/)
- **配色**：**Strava Orange `#FC4C02`**（饱和到接近霓虹）+ 近黑底——品类**最强配色claim**
- **字体**：Maison Neue风格几何sans，数字大粗体，标签condensed大写
- **地图**：暗色底，路线亮品红/霓虹橙；**Heatmap是招牌**
- **语调**：精英运动员，"If you sweat, you're an athlete."
- **学什么**：数字字体值得独立处理；Heatmap可改皮成"popular cairns"
- **避什么**：橙黑组合排他感强（精英健身房感）；"凡事都竞争"的框架与Cairn哲学冲突

### 3️⃣ Komoot — 欧洲路线规划者

- **URL**：[App Store NZ](https://apps.apple.com/nz/app/komoot-hike-bike-run/id447374873) / [komoot.com](https://www.komoot.com/)
- **配色**：青蓝 `#16A8DD`系 + 暖森林绿次色，柏林设计studio感
- **地图**：OSM定制风格，**等高线明显**，**路面类型分段路线**（柏油solid / 沙石dashed）—— Komoot招牌
- **POI**：**"Highlights"社区POI** —— 最接近Cairn marker概念的竞品
- **学什么**：路面分段路线是漂亮的信息设计；**手绘插画封面**（其他竞品没有）增加温度
- **避什么**：长滚动页在手机上累

### 4️⃣ Gaia GPS — 高山探险级

- **URL**：[App Store](https://apps.apple.com/us/app/gaia-gps-offroad-hiking-maps/id1201979492) / [gaiagps.com](https://www.gaiagps.com/)
- **配色**：橙红 `#E26B2C`（比Strava低饱和，更"地形图墨水"）+ 中性灰
- **地图**：**地图就是产品**，多源切换（USGS / 卫星 / 林务局 / 雪崩坡度 / NOAA天气）
- **POI**：**类型化路标（水/营地/危险/景观/照片）—— Cairn应抄这套taxonomy**
- **离线**：**离线下载是底部第二个Tab**——Cairn离线优先信号可学这个
- **隐私**：默认私密
- **学什么**：离线优先可作主导航元素；类型化Pin是Cairn marker的正确primitive；**隐私优先=专业尊重**
- **避什么**：UI对小白友好度低，Cairn不能"只为高山玩家"

### 5️⃣ onX Backcountry — 现代探险级

- **URL**：[App Store](https://apps.apple.com/us/app/onx-backcountry-ski-hike-bike/id1485851153) / [onxmaps.com](https://www.onxmaps.com/backcountry/app)
- **配色**：深navy/charcoal底 + 高对比白字 + 锐利橙琥珀
- **地图**：**3D地形遮罩**比对手更激进，**坡度+雪崩玫瑰图层是危险沟通的标杆**
- **学什么**：**Dark mode优先 / 炭灰背景在户外阳光下更可读**也显高级；危险沟通用地图遮罩>文字警告
- **避什么**："tactical"调性偏男性化/排他感

## TIER 2 — 区域 + 邻接

### 6️⃣ NZ Topo50（LINZ）— 政府地形图

- **URL**：[topomap.co.nz](https://www.topomap.co.nz/) / [linz.govt.nz](https://www.linz.govt.nz/)
- **视觉**：**这就是NZ地图的样子**——米黄/绿/蓝+棕色等高线+红色公路
- **学什么**：**致敬Topo50的等高线棕色（暖sepia）+ 绿植/草米黄二色组**=Cairn可独占的NZ真实性信号，没有Tier 1竞品owns这个
- **避什么**：原生raster渲染显dated，借palette不要借rendering

### 7️⃣ Plan My Walk（NZ Mountain Safety Council）— NZ官方安全规划

- **URL**：[App Store NZ](https://apps.apple.com/nz/app/plan-my-walk/id1518426714) / [planmywalk.nz](https://planmywalk.nz/)
- **视觉**：MSC红+白，皇家机构感
- **招牌动作**：装备清单+天气+危险一体化前置
- **学什么**："Did you tell someone?" / intentions提醒在NZ独有共鸣，可作onboarding软提示
- **避什么**：完全实用主义/官腔——Cairn要**warm safety**，不是bureaucratic safety

### 8️⃣ AdventureSmart NZ — 国家搜救品牌

- **URL**：[adventuresmart.nz](https://www.adventuresmart.nz/)
- **视觉**：黄黑警示色+高对比可读
- **学什么**：**"五条规则"框架**（Plan / Tell / Weather / Gear / Limits）可作onboarding章节
- **避什么**：黄黑警戒带审美在日常使用中过激

### 9️⃣ Avenza Maps — 专业PDF地图阅读器

- **URL**：[App Store](https://apps.apple.com/us/app/avenza-maps/id388424049) / [avenza.com](https://www.avenza.com/avenza-maps/)
- **学什么**：Pin标注交互成熟（长按落点、photo附加）
- **避什么**：整个UI审美——Cairn明确**不要长这样**

### 🔟 Wikiloc — 全球最大UGC步道库

- **URL**：[App Store](https://apps.apple.com/us/app/wikiloc-outdoor-navigation-gps/id406643764) / [wikiloc.com](https://www.wikiloc.com/)
- **地图**：OSM底+多条用户路线叠加产生"意大利面效果"——但对popular zones有信息价值
- **学什么**：多路线叠加可视化是真实视觉资产
- **避什么**：UI密度像2012论坛

## TIER 3 — 邻接灵感

### 1️⃣1️⃣ PeakVisor — AR山峰识别

- **URL**：[App Store](https://apps.apple.com/us/app/peakvisor/id1242788928) / [peakvisor.com](https://peakvisor.com/)
- **学什么**：3D地形预览在详情页加wow factor；"那是什么山？"是非专家用户的好onboarding
- **避什么**：AR识别功能日常用感觉gimmicky——作为delight保留

### 1️⃣2️⃣ Strava Heatmap — 全球热力图

- **URL**：[strava.com/heatmap](https://www.strava.com/heatmap)
- **视觉**：纯黑底+蓝→青→白→品红渐变
- **学什么**：黑底+饱和重点=分析工具的serious数据可视化感

### 1️⃣3️⃣ **Death Stranding（旗帜性精神参考）⭐**

- **URL**：[Kojima Productions](https://www.kojimaproductions.jp/en/death_stranding)
- **关键洞察**：游戏里**陌生人留下的绳索/梯子标记**就是Cairn的精神隐喻——石堆作为陌生人之间的礼物
- **学什么**：**真实APP市场没人占据"async社交=陌生人之间的善意"这个情感空间**。"thank you"飘字那种感觉=Cairn的情感模板
- **避什么**：游戏的末世单色调——Cairn不是post-apocalyptic

### 1️⃣4️⃣ Apple Maps（iOS 18 Hiking）/ Google Maps

- **URL**：[Apple iOS 18](https://www.apple.com/ios/ios-18/) / [google.com/maps](https://www.google.com/maps)
- **学什么**：Apple iOS 18的topo+材质半透明是新基线，**Cairn不要试图比Apple更cartograph**——靠社区/markers/social赢

### 1️⃣5️⃣ Trailforks — 山地车数据库

- **URL**：[App Store](https://apps.apple.com/us/app/trailforks/id868589221) / [trailforks.com](https://www.trailforks.com/)
- **地图**：**难度色编路线**（绿/蓝/黑/双黑——从滑雪借来的通用语言）
- **学什么**：难度色编是普世可读的语言，**用约定不要重新发明**
- **避什么**：MTB-tribal feel；Cairn不是bike app

---

# 第五部分：Cairn的白空间（差异化机会）

## 5.1 全部15个APP的共同模式（"category default"）

1. **绿橙双寡头**（绿：AllTrails/Wikiloc/Komoot副；橙：Strava/Avenza/Gaia/onX）
2. **底部抽屉**做步道详情
3. **粗饱和路线 + 低饱和底图**
4. **难度色编**（绿/蓝/黑/双黑）
5. **数字字体单独处理**
6. **底部4-Tab**（Map / Discover / Saved / Profile）
7. **Hero照片**在详情页
8. **离线=付费墙钩子**
9. **隐私**：社交向APP默认公开（雷区），探险向默认私密
10. **海拔曲线在地图下方**

## 5.2 没有竞品做好的事 = Cairn白空间 ⭐

1. **Marker as message, not POI** —— 没有竞品把marker当陌生人之间的沟通。**Cairn命名隐喻独占可用**
2. **温暖但严肃的语调** —— "对信任的人温暖、对山保持严肃"这个空位是空的
3. **NZ区域真实性** —— 没有全球APP用Topo50/MSC视觉语言。**全球定位+本土NZ-native信号=独特**
4. **Death Stranding式异步社交** —— 真实户外APP市场无人占领
5. **危险沟通用地图遮罩**（仅onX+Gaia做） —— 多数APP用文字警告
6. **手绘插画封面** —— 仅Komoot做，被低估
7. **新手tramper onboarding** —— 高端APP都假设你已会，**MSC的"五条规则"在高端APP无人borrow**

---

# 第六部分：12条必避雷区

1. ❌ Tribal pattern背景（kowhaiwhai/tukutuku无iwi授权）
2. ❌ Koru当装饰（被商业用滥+文化挪用风险）
3. ❌ Kiwi鸟卡通（旅游纪念品店感）
4. ❌ **任何《指环王》《霍比特人》视觉暗示**（NZ本地用户极厌烦）
5. ❌ 银蕨爆炸渐变（2010旅游业土味）
6. ❌ 澳洲红土+赭石（NZ不是澳洲）
7. ❌ Patagonia/REI美式国家公园风（一看就是美国货）
8. ❌ 机翻或缺宏符号的Te Reo
9. ❌ 狩猎/枪械图标在公共安全消息里
10. ❌ 自创雪崩等级颜色（必须用国际5级标准）
11. ❌ DOC三角橙用在非安全场景（稀释最重要的视觉信号）
12. ❌ "She'll be right" + 美式hype双重错位语调

---

# 第七部分：Cairn视觉方向具体建议

## 7.1 配色（避开品类红海）

- ⚠️ **避开**：纯森林绿（AllTrails领地）、Strava橙
- ✅ **建议主色**：暖sepia棕 / Topo50 earth-amber **作为品牌主色** —— 立刻信号NZ地形图传承+差异化
- ✅ **配深forest-charcoal**做surface（onX的premium dark感但不tactical）
- ✅ **路线色**：暖珊瑚 / warm-red（不是Strava橙，不是signal-red）

## 7.2 字体

- 暖humanist sans主体（Inter / Source Sans 3 / Söhne）—— **避免AllTrails/Komoot那种rounded geometric**（对Cairn隐喻过于卡哇伊）
- 数字单独：condensed numeric（IBM Plex Mono / Inter figure-set）
- 一处手绘/手写元素（Sprint 0着陆页 / 章节分隔）—— claim Komoot的温度但不抄

## 7.3 Marker系统

- 类型化markers（水/营地/危险/景观/**故事-cairn**）参考Gaia/onX taxonomy
- 但**新增"Cairn"类型** = 招牌情感marker：陌生人之间留下的messages，cairn-stack字形
- **当用户是某段时间内第一个发现这个marker时**，加柔和halo——视觉的"thank you for visiting"

## 7.4 摄影

- **专攻NZ景观**（bush / alpine / coastal）做营销
- 避开Patagonia stock-look（孤独悬崖人）
- 偏向**中景的群朋友 / tramp后过河** —— 强化"social-but-not-competitive"定位

## 7.5 语调

- "Real talk, warmly given." = 直白安全（Plan My Walk）+ 异步礼物感（Death Stranding）+ 社区即信任（Komoot Highlights）
- 营销一句话模板：动作动词在前，温柔但具体
- ✅ "Leave a cairn. Find someone else's."
- ❌ "Discover your next adventure"（AllTrails）/ "If you sweat, you're an athlete"（Strava）

## 7.6 地图风格

- 自定义Mapbox style源自Topo50：sepia-brown等高线、柔mint绿植被、暖cream paper底、blue-gray水
- **路线**：5-6px珊瑚色，slightly rounded caps，subtle drop-shadow
- **海拔曲线**：填充渐变（低海拔冷蓝→高海拔暖琥珀） —— 视觉编码海拔，不只在Y轴

## 7.7 信息密度

- 底部抽屉（品类默认）+ 暖纹理（slight paper-grain或一处手绘分隔）
- 第一张可见卡：Hero照片+步道名+**仅2项stats**（距离+爬升）+1个social cue（"3 friends walked this last month"）

## 7.8 隐私 & 安全

- ✅ **默认私密tracks**（反AllTrails/Strava，跟Gaia/onX）—— 营销话术："Your walks aren't public unless you say so."
- ✅ Onboarding软提示MSC风格"did you tell someone you're going?" —— 非blocking
- ✅ Hazard用地图shading（onX avalanche-rose模型）

## 7.9 好友/社交

- ✅ 异步>实时："X left a cairn here last week" > "X is hiking now"
- ❌ **无leaderboards / 无segment竞争**
- ✅ Beacon式实时位置仅给指定联系人 —— **for safety not for cheering**

---

# 第八部分：一段话设计定位

> Cairn应该看起来像 **LINZ Topo50地形图 + DOC路标系统 + Icebreaker时尚大片 + Death Stranding异步社交温度** 的混血儿：
>
> 暖sepia棕作品牌主色（避开品类绿橙红海），Topo50米色底+棕色等高线作地图基础，beech-forest深绿作surface锚，**DOC三角橙严守"安全"语义只用于路标/偏离/SOS**，冰川青作交互色，珊瑚色作路线hero，严重等级阶梯对齐MetService/MSC/雪崩警报国家标准。
>
> 字体上Klim（NZ本土设计师Sowersby）= "我们是本地做的"暗号，没预算用Inter，但**必须支持毛利长音符号**。地图Pin是DOC三角融入石堆Cairn剪影。摄影是NZ高对比自然光，不是Patagonia饱和。
>
> Marker不只是POI而是**陌生人之间的messages** —— Cairn命名隐喻+Death Stranding异步温度=品类无人占的白空间。**默认私密tracks**（反Strava/AllTrails）。**异步>实时**：无leaderboard，无竞争，Beacon仅for safety。
>
> 双语Te Reo/英文标签默认。文化顾问+注册译者第一天到位。
>
> 做对了，**NZ用户一眼识别"这APP是本地人做的、是真走过这些步道的"** —— 这是唯一能在NZ本土打败AllTrails的定位。

---

# 第九部分：来源URL索引

## NZ官方/政府

- [doc.govt.nz](https://www.doc.govt.nz/) · [mountainsafety.org.nz](https://www.mountainsafety.org.nz/) · [planmywalk.nz](https://planmywalk.nz/) · [adventuresmart.nz](https://www.adventuresmart.nz/) · [metservice.com](https://www.metservice.com/) · [linz.govt.nz](https://www.linz.govt.nz/) · [topomap.co.nz](https://www.topomap.co.nz/) · [digital.govt.nz](https://www.digital.govt.nz/) · [Privacy Act 2020](https://www.legislation.govt.nz/act/public/2020/0031/latest/LMS23223.html) · [teararoa.org.nz](http://www.teararoa.org.nz/) · [tourismnewzealand.com](https://www.tourismnewzealand.com/) · [tetaurawhiri.govt.nz](https://www.tetaurawhiri.govt.nz/)

## NZ品牌/字体

- [icebreaker.com](https://icebreaker.com/) · [earthseasky.co.nz](https://earthseasky.co.nz/) · [klim.co.nz](https://klim.co.nz/)

## Tier 1竞品

- [AllTrails NZ](https://apps.apple.com/nz/app/alltrails-hike-bike-run/id405075943) · [alltrails.com](https://www.alltrails.com/)
- [Strava NZ](https://apps.apple.com/nz/app/strava/id426826309) · [strava.com](https://www.strava.com/) · [brand.strava.com](https://brand.strava.com/)
- [Komoot NZ](https://apps.apple.com/nz/app/komoot-hike-bike-run/id447374873) · [komoot.com](https://www.komoot.com/)
- [Gaia GPS](https://apps.apple.com/us/app/gaia-gps-offroad-hiking-maps/id1201979492) · [gaiagps.com](https://www.gaiagps.com/)
- [onX Backcountry](https://apps.apple.com/us/app/onx-backcountry-ski-hike-bike/id1485851153) · [onxmaps.com](https://www.onxmaps.com/backcountry/app)

## Tier 2/3

- [Plan My Walk NZ](https://apps.apple.com/nz/app/plan-my-walk/id1518426714) · [Avenza](https://www.avenza.com/avenza-maps/) · [Wikiloc](https://www.wikiloc.com/) · [PeakVisor](https://peakvisor.com/) · [Strava Heatmap](https://www.strava.com/heatmap) · [Death Stranding](https://www.kojimaproductions.jp/en/death_stranding) · [Trailforks](https://www.trailforks.com/) · [Apple iOS 18](https://www.apple.com/ios/ios-18/)

---

## 文档维护

- 重大配色/字体/语调决策应回头更新本文档
- 每Sprint UX若发现新的竞品参考或NZ文化要点，PR追加到本文
- 整体结构变更需CR流程审核

