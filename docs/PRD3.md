# PRD3 — Cairn (NZ本土化与视觉差异化)

**Product Name**: Cairn
**Tagline**: Leave a mark. Guide the next.
**Version**: 3.0
**Created**: 2026-05-18
**PO**: User
**Supersedes**: PRD2.md (PRD2功能性需求保留有效，PRD3聚焦本土化/视觉/品牌差异化层)
**Source**: 基于`docs/research/NZ_USER_AND_COMPETITOR_REFERENCE.md`基线对Sprint 54+实际项目的全维度审计（综合得分5.5/10）
**Confirmation**: PRD3全部内容已确认，执行时无需再向用户确认任何细节。
**Git**: 每个Sprint结束必须commit到GitHub。Push失败不阻塞。
**Sprint节奏**: 按Story sizing规则切分（每条1-3天），不把所有内容压到一个Sprint。
**验证**: 凡能用Playwright/EAS Build测试的，必须真实截图验证。地图相关Epic必须用真实Mapbox渲染截图，不接受placeholder。
**研究**: websearch skill随时可用。Mapbox style/i18n/Te Reo规则等不确定的，主动搜索。

---

## Vision

PRD2交付了Cairn的功能完整性（地图、GPS、AR、好友、SOS、播报、社区）。**PRD3要交付的是"NZ用户一眼识别这是本地APP"的差异化**。

当前现状：审计显示12雷区避开了10条（很好），但**字体3/10、地图视觉4/10、零Te Reo、主品牌色仍在绿色品类红海**——离"NZ-native信号"这个核心定位差最关键的一步。

PRD3的目标是闭合这一步：让任何NZ tramper打开Cairn的前30秒就能感受到"这APP是本地人做的、是真走过这些步道的"——这是基线文档提出的、唯一能在NZ本土打败AllTrails的定位。

---

## Epics

### E-012: 字体系统与排版规范
**Phase 4 — 立刻**

引入专业字体替代iOS系统默认，建立Te Reo长音符号渲染基线，并把数字stats字体单独处理。这是品牌差异化最低成本最高ROI的一笔。

**关键需求**：
- 集成`@expo-google-fonts/inter`：Inter-Regular(400) / Inter-SemiBold(600) / Inter-Bold(700)
- 全部screens的`fontFamily`从系统默认迁移到Inter
- 数字stats（HomeScreen / RoutesScreen / RunningScreen / HikingScreen的距离/海拔/时间）单独用`fontVariant: ['tabular-nums']`确保对齐
- Te Reo长音符号渲染验证：在iOS模拟器与真机各跑一次，确认 ā ē ī ō ū Ā Ē Ī Ō Ū 渲染正常（不是a+组合符号、kerning自然）
- 字体加载失败fallback到系统字体（不阻塞首屏）
- 配置中心化：新增`app/src/config/fonts.ts`，所有screens引用同一source
- v1.1或之后评估Klim许可（Söhne / Founders Grotesk）作为升级路径，**本Epic先用Inter**
- 保留`tokens.ts`现有FontSize体系（h1 28px → tiny 9px），仅改`fontFamily`字段

**验收标准**：
- 任何screens不出现iOS默认San Francisco字体
- "Tāmaki Makaurau / Aoraki / Tongariro" 文本在主屏渲染无macron破损
- 数字"12.4 km"和body文本"距离"在视觉上明显区分（不同family/字距）

---

### E-013: 离线Topo50激活与Mapbox本土化样式
**Phase 4 — 立刻**

PRD2 E-001声明"NZ离线地图"是核心承诺，架构层（`offlineMapService.ts` + `offlinePacks.ts`）已就位但用户用不到。同时Mapbox当前用通用`outdoors-v12`，与AllTrails/Komoot视觉无差异——错过基线指出的最大独占机会"NZ Topo50致敬是Cairn可独占的真实性信号，0个Tier 1竞品owns"。

**关键需求**：
- **离线包下载UI**（必交付）：
  - SettingsScreen新增"Offline Maps"section，列出已定义packs（Tongariro / Routeburn / 待加：Milford / Abel Tasman / Kepler / Heaphy）
  - 每个pack显示：名称（毛利名+英文）/ 大小（MB）/ 下载状态 / 上次更新
  - 调用已实现的`offlineMapService.downloadPack(packId)`，进度条+取消按钮
  - 离线模式自动切到本地tile，不发起网络请求
- **自定义Mapbox style "Cairn Topo"**（必交付）：
  - 背景cream `#F7F2E5`（Topo50纸张色）
  - 等高线sepia `#b5823d` opacity 0.4 line-width 0.5-0.8
  - 植被柔mint `#c9d9c5` opacity 0.6
  - 水体blue-gray `#8ba8c0`
  - 道路淡化（不抢主体）
  - 标签humanist sans（与Inter族协调）
  - style ID注册到Mapbox账户，`app/src/config/mapbox.ts`新增`CAIRN_TOPO_STYLE_URL`
  - MapScreen / HikingScreen / RouteEditorScreen / MapHistoryScreen 全部切到新style
- **等高线图层激活**：用Mapbox内置`mapbox-mapbox-terrain-v2` ShapeSource + LineLayer
- **降级策略**：自定义style加载失败回落`outdoors-v12`，记录错误不阻塞
- **真实截图回归**：本Epic Demo前必须有真实Mapbox渲染的截图（不是EAS Build placeholder），覆盖：日间/夜间、有/无离线包、不同zoom level

**验收标准**：
- Settings里能看到至少3个Great Walks离线包，可下载并断网验证
- MapScreen打开后地图明显是cream底+sepia等高线（不是Mapbox默认蓝绿）
- 一张MapScreen截图与AllTrails截图并排时，**视觉风格明显不同**

---

### E-014: Te Reo Māori双语第一波集成
**Phase 4 — 立刻**

基线文档强调"双语Te Reo/英文标签是默认期望，不是加分"，且NZ政府数字服务标准（Digital Service Design Standard）已把双语视为baseline。当前app零Te Reo——审计指出这是NZ用户App Store评论会立刻指出的问题。

**关键需求**：
- **i18n框架**：新增`app/src/config/i18n.ts`，定义string keys + en/mi（毛利文）双语map
- **第一波双语覆盖范围**（最小可识别集）：
  - Auth Splash加副标"Nau mai, haere mai"（在"Leave a mark. Guide the next."下方）
  - HomeScreen问候支持"Kia ora, [name]"作为"Good morning"的早晨变体（一天3次问候之一）
  - 所有Great Walks名称双语：Tongariro Northern Circuit / Milford Track (Te Araroa) / Routeburn Track / Kepler Track / Abel Tasman Coast Track / Heaphy Track / Paparoa Track / Lake Waikaremoana / Whanganui Journey / Rakiura Track / Hump Ridge Track
  - 主要地名双标格式："Aoraki / Mount Cook"、"Tāmaki Makaurau / Auckland"、"Te Wai Pounamu / South Island"
  - SettingsScreen底部加"Ngā mihi"作为致谢（feedback section或about区域）
- **macron强制**：所有Te Reo字符串必须带正确长音符号（ā ē ī ō ū），代码review加lint检查（如`Maori`没有macron则失败）
- **正式翻译流程**：
  - 聘请Te Taura Whiri i te Reo Māori（毛利语言委员会）官方注册译者
  - 翻译记录写入`docs/cultural-consultation.md`：译者名/资质/日期/string清单
  - 不接受机翻、不接受社区翻译、不接受"我朋友是毛利人"翻译
- **不做的**：
  - 不做全UI双语（v1只做"亮点点缀"+地名双标，避免半成品翻译）
  - 不在UI放任何kowhaiwhai/tukutuku/koru图案（基线雷区）
  - 不做Te Reo Only模式（v1英文是默认，Te Reo是accent）

**验收标准**：
- App Store截图至少3张能看到Te Reo元素（splash / home / settings或地图）
- 全app搜索"Maori"不带macron的实例 = 0
- `docs/cultural-consultation.md`存在且记录了译者信息

---

### E-015: Marker系统视觉升级与Cairn石堆品牌marker
**Phase 4**

UI_SPEC.md L88-110明确规范了多层Pin（icon + 发光环 + 底座 + elevation-2阴影 + 选中扩大40px + 好友头像 + 社区虚线 + 聚合渐变），但当前实现是单层28px圆形。同时基线最招牌的"Cairn石堆作为陌生人之间留言"差异化没用作marker——错过Death Stranding式异步社交温度。

**关键需求**：
- **统一类型源**：建`app/src/config/markerTypes.ts`，把现在`MapScreen.tsx` L54-66 / `HikingScreen.tsx` L45-57 / `mockData.ts` L18-24三处重复的FLAG_TYPES合并为单一source
- **新增第6类"Cairn"marker**：
  - 字形：3块石头堆叠（圆鹅卵石、不对称），与AuthScreen的splash logo同源但简化为24px
  - 用途：标记一段对陌生人有用的信息（"这里有溪水"、"这段路湿滑"），与现有danger/scenic/supply/junction/free平行
  - 视觉：sepia棕`#b5823d`填充，无强type色（"留给陌生人的信"应是中性的）
- **多层Pin组件**：建`app/src/components/MapMarkerPin.tsx`，统一替换screens里的inline pin实现
  - icon层（lucide或Cairn石堆SVG）
  - 发光环层（type色，opacity 0.4，blur 8px）
  - 底座圆形（type色 25%透明度bg + 60%透明度border）
  - elevation-2阴影
  - 选中：底座扩大28px→40px，shadow加深，spring animation
  - 好友：底座右下角小头像（friend store的avatar或initial）
  - 社区：外圈虚线圈（dashed border）
  - 聚合：cluster数字+混合渐变bg
- **首次发现halo**：当用户是某段时间（24h）内第一个查看该marker时，触发柔和halo动画（opacity 0→0.6→0持续2s），视觉的"thank you for visiting"——基线L387建议
- **DOC三角元素（可选）**：Pin底座加"顶尖底圆"混合形暗示DOC路标三角

**验收标准**：
- 全项目搜索`FLAG_TYPES = `只有1处定义
- MapScreen截图能看到6种marker（含Cairn石堆类）
- 选中marker有明显scale+shadow变化
- 好友marker / 社区marker / 聚合marker有视觉区分

---

### E-016: 配色精准化（DOC橙正名 + 严重等级阶梯补全）
**Phase 4**

`tokens.ts`里`warning #b36b00`是偏暗土黄色，**不是真DOC路标橙#F26522**。这意味着用户在Cairn里看到的"安全橙"和户外步道实际DOC路标的橙**不是同一色**——错失最强NZ wayfinding认知信号。同时严重等级阶梯（绿→黄→橙→红→黑）当前缺中间黄色和极端黑，未来天气警报/雪崩等级需要时会临时拼凑。

**关键需求**：
- **DOC橙正名**：
  - `tokens.ts`改`warning: '#F26522'`（真DOC orange triangle marker色）
  - `tokens.ts`新增`warningSoft: '#b36b00'`（保留原色给非DOC语义场景，如"GPS信号弱"这类轻提示）
  - 全代码搜索`Colors.warning`使用点review：仅"安全标记/路线偏离/SOS预警/真DOC路标"4类场景用真DOC橙；其他场景（如表单错误、弱信号）改用`warningSoft`
- **严重等级阶梯补全**：tokens.ts新增对齐MetService/NZAA/MSC国家标准
  ```typescript
  // 严重等级阶梯（NZ国标，不可自创）
  severityNotice:  '#3D7A4B',  // 安全 / 绿
  severityCaution: '#F0C419',  // 注意 / 黄（MetService Watch）
  severityWarning: '#F26522',  // 警告 / 橙（与DOC橙同色，MetService Warning）
  severityDanger:  '#D52B1E',  // 严重 / 红（MetService Severe）
  severityExtreme: '#1A1A1A',  // 极端 / 黑底（雪崩level 5约定）
  ```
- **透明度梯度文档化**：tokens.ts行内加注释明确每档使用场景
  ```typescript
  primaryLight: 'rgba(93,124,70,0.15)',  // 卡片背景bg
  primaryBg:    'rgba(93,124,70,0.08)',  // 极浅chip / hint
  primaryDim:   'rgba(93,124,70,0.20)',  // 中层topo ring
  primaryDeep:  'rgba(93,124,70,0.30)',  // 深ring
  ```
- **可选（非阻塞）**：A/B测试sepia棕做主品牌色（用现有trail #b5823d往上提）vs 当前beech绿——不强制切换，作为v1.1之后评估

**验收标准**：
- tokens.ts里warning = #F26522
- 全代码使用`Colors.warning`的位置review完毕，文档化哪些场景用哪个橙
- severityCaution / severityExtreme 在tokens.ts存在（即使本Epic未消费）

---

### E-017: 安全语调升级（Tell Someone + 异步友谊状态）
**Phase 4**

基线L309强调"Did you tell someone?"是NZ独特的安全共鸣（来自MSC #MakeItHomeNZ campaign），当前app无此提示。同时FriendsScreen的"Online"实时圆点偏Strava式实时社交，违背基线"异步>实时"原则（"X left a cairn here last week" > "X is hiking now"）。

**关键需求**：
- **Tell Someone软提示**：
  - 触发：HikingScreen / RunningScreen 首次启动tracking时，且（用户未设置紧急联系人 OR 24h内未确认过）
  - 形式：非blocking modal，2按钮
    - 文案："Plan before you go.\nDid you tell a friend or family member your plans?"
    - 按钮1："Yes, I told someone"（关闭）
    - 按钮2："Set up Trip Sharing"（跳到Settings相关section）
    - 按钮3（次要文字）："Remind me later"
  - 不阻塞tracking启动：用户可以直接关闭后立刻开始记录
  - 每session仅提示一次，下次启动tracking按规则重新触发
- **Online状态改为异步措辞**：
  - FriendsScreen的"Online"圆点改为"Active now"（仅当好友过去5分钟内有应用心跳）
  - 否则显示"Last active Xh ago" / "Last active Xd ago"
  - 圆点颜色：active now = info冰川青；inactive = 中性灰
  - 这是基线L478精神：友谊状态应是温暖回忆不是实时竞争
- **SOS主界面前置**：
  - HikingScreen / MapScreen 加固定SOS FAB（位置由UX在`docs/UI_SPEC.md`确认，不与现有Plant Flag FAB冲突）
  - 视觉：红色`#D52B1E` 圆形 56px + SOS图标 + elevation-3阴影
  - 行为不变：长按3s + 5s倒计时 + SMS fallback（PRD2 E-011已实现）
  - 视觉重点：用户不应需要进Settings才能找到SOS
- **隐私文案review**：SettingsScreen隐私section所有文案review一遍
  - 标准："plain English, not legal jargon"
  - 例：避免"GDPR compliance"，改"Your walks aren't public unless you say so."
  - 每个toggle有一句explanation（"Share location with friends — they'll see your approximate position while you're active"）

**验收标准**：
- 首次按"Start Hiking"显示Tell Someone提示，且"Remind me later"不阻塞tracking
- FriendsScreen不显示纯"Online"，至少是"Active now"或"Last active Xh ago"
- HikingScreen / MapScreen可见SOS按钮（不需进Settings）

---

### E-018: 文案与术语NZ化
**Phase 4**

基线明确NZ户外术语必须用对（Tramping / Track / Hut，不用Hiking / Trail / Cabin），且空状态文案应有Death Stranding式异步温度（基线L478）。当前文案大部分是说明书风（"No friends yet. Add friends to share flags"），缺少"Cairn is better with trail companions"这类邀请感。

**关键需求**：
- **术语审计**：全代码搜索面向用户的字符串
  - 替换`trail` → `track`（NZ标准）
  - 保留`hike/hiking`（用户也这样说，PRD2已用）
  - 替换`cabin/shelter` → `hut`（如果出现）
  - 添加DOC 6级难度分类支持（即使v1只显示2-3级，框架就位）：Short Walk / Walking Track / Easy Tramping Track / Tramping Track / Route / Expert
- **空状态文案改写**：
  - FriendsScreen：→ "Cairn is better with trail companions.\nInvite friends to share markers and stay connected on the track."
  - MapScreen marker空：→ "Leave your first mark when you find something worth noting."
  - RoutesScreen空：→ "Plan your next track. Save routes for offline use."
  - HomeScreen sub："Navigate trails · Plant flags · Explore" → "Navigate tracks · Leave cairns · Explore at your pace"
- **避免美式hype保持现状**：现有tagline / 问候文案已避开"Discover/Epic/Unleash"，保持
- **术语词典文档化**：新增`docs/terminology.md`列出NZ vs 美式对照，作为后续PR review checklist
- **不做的**：
  - 不做全文本overhaul（避免回退Tagline这类已优秀文案）
  - 不强制所有screens加Te Reo（双语集成在E-014专门做）

**验收标准**：
- `docs/terminology.md`存在
- 全代码搜索`trail`（小写boundary match）= 0或仅限技术术语（如`trailColor`变量名）
- 至少3个screens的空状态用"邀请感"文案

---

### E-019: 视觉品质与摄影占位策略
**Phase 5（与E-012/013/014同一波，但优先级稍后）**

基线F维度打分2/10——零摄影资源。竞品AllTrails / Komoot每条route都有hero photo。Cairn全是text+icon会显得"完成度70%"。本Epic不立刻补摄影（成本高、版权敏感），但要把架构层准备好+空状态升级。

**关键需求**：
- **架构层加hero photo字段**（必交付）：
  - `useRouteStore.ts`的Route interface加`heroPhotoUrl?: string`和`photoCredit?: string`
  - `useMarkerStore.ts`的Marker interface加`photoUrls?: string[]`（用户为marker附加的真实照片）
  - 后端API（PRD2 E-006/E-007相关）相应字段
  - 不做photo上传UI（v1.1做），仅准备数据结构
- **空状态插画**（必交付，作为摄影替代）：
  - 新增`app/src/components/Illustrations/`目录
  - 至少3张原创SVG插画（Natural Warm配色）：
    - EmptyRoutes（步道线条 + 远山 + 小Cairn石堆）
    - EmptyMarkers（地图视角 + 第一颗pin落下 + ripple）
    - EmptyFriends（两个石堆遥相呼应 + 之间的虚线track）
  - 风格：线条画 + 2-3色partial fill，不要photorealistic、不要LOTR感
  - 用在对应screens的空状态
- **摄影策略文档**（不实施，仅记录）：
  - 新增`docs/photography_strategy.md`：v1.1或v2何时引入真实摄影、来源（不用Unsplash游客照、优先用户上传 + DOC/Tourism NZ合作）、风格指南（NZ自然光、人小景大、tussock/beech/冰川/水细节）
- **不做的**：
  - 不集成stock photo API（基线明确反对Patagonia stock-look）
  - 不做用户photo上传UI（v1.1）
  - 不做photo压缩/CDN（v1.1）

**验收标准**：
- Route / Marker interface有photo字段
- 至少3个screens空状态显示原创插画（非emoji、非系统icon）
- `docs/photography_strategy.md`存在

---

## Phase排期

| Phase | Epics | 核心交付 | 预估Sprint数 |
|-------|-------|---------|------|
| **Phase 4 (Sprint 55-58)** | E-012 + E-013 + E-014 + E-016 + E-017 + E-018 | 字体 / 离线Topo50 / Te Reo第一波 / 配色精准化 / 安全语调 / 术语NZ化 | 4个Sprint |
| **Phase 5 (Sprint 59-60)** | E-015 + E-019 | Marker多层升级 / 视觉品质 + 空态插画 | 2个Sprint |
| **Phase 6 (post-v1.0)** | A/B sepia棕主色 / Klim字体 / 全UI双语 / 真实摄影 / Topo50更精细style | 品牌完成度 | 待评估 |

**Sprint Planning建议切分**：
- Sprint 55: E-012字体 + E-016配色精准化（轻量Sprint，确认基线）
- Sprint 56: E-013离线Topo50激活（重磅，单独Sprint）
- Sprint 57: E-013自定义Mapbox style + E-017安全语调
- Sprint 58: E-014 Te Reo第一波 + E-018术语NZ化
- Sprint 59: E-015 Marker多层升级
- Sprint 60: E-019视觉品质 + 空态插画

---

## Success Metrics

| 指标 | 当前（审计基线） | Phase 4目标 | Phase 5目标 |
|------|----------------|-------------|-------------|
| 视觉综合分（基线对照） | 5.5/10 | > 7.5/10 | > 8.5/10 |
| 配色系统 | 7/10 | 8.5/10 | 9/10 |
| 字体 | 3/10 | 8/10 | 8.5/10 |
| 地图风格 | 4/10 | 8/10 | 9/10 |
| 文案语调 | 6.5/10 | 8/10 | 8.5/10 |
| Te Reo覆盖 | 0个string | ≥10个string + 11条Great Walks双语 | ≥30个string |
| 离线包可下载数 | 0（架构未激活） | ≥3个Great Walks | ≥6个Great Walks |
| Marker类型 | 5种单层 | 6种（含Cairn）+多层 | 6种 + 好友/社区/聚合状态 |
| NZ用户首屏识别度（VU acceptance） | 未评估 | "感觉是NZ做的" ≥ 7/10 | ≥ 9/10 |

---

## Non-Functional Requirements

### 兼容PRD2
- PRD2所有功能性NFR（性能/电池/离线/隐私/可访问性/通知节奏/视觉品质）继续有效
- PRD3 Epic不得违反PRD2 NFR（如E-013加自定义Mapbox style不能让冷启动从<3s退化）

### 字体
- 字体文件本地打包（不远程加载，离线友好）
- 字体加载失败必须fallback到系统字体，不阻塞首屏 < 3s
- 字体包总size控制在500KB以内

### 地图样式
- 自定义style首次加载与outdoors-v12性能相当（tile缓存< 500ms）
- style加载失败回落outdoors-v12，记录错误不阻塞
- 离线模式下style本身（不含tile）可用

### Te Reo
- 所有Te Reo字符串必须经Te Taura Whiri注册译者审核
- macron渲染失败= release blocker
- Te Reo字符串变更走CR流程（不允许Frontend Dev随手改）

### 配色
- 改`warning #F26522`后，全代码使用点review必须100%覆盖（不能漏一个会导致非DOC语义场景误用真DOC橙）
- DOC橙误用（如表单错误用#F26522）= release blocker

### 文化合规
- `docs/cultural-consultation.md`必须存在并记录译者资质，作为release prerequisite
- 任何毛利相关视觉元素（即使本PRD不引入新motif）变更走Cultural Advisor review

### 视觉回归
- E-013 Demo前必须有真实Mapbox渲染截图（不是EAS Build placeholder）
- 每Sprint UX Review新增"NZ-native信号"检查项：与AllTrails截图并排，差异是否明显

---

## 风险与权衡

### 已知风险

| 风险 | 应对 |
|------|------|
| Te Reo译者交付周期长 | E-014第一波只做~10个string，先用注册译者最快交付的固定lookup表上线 |
| 自定义Mapbox style设计成本（需Mapbox style专家） | 第一版用基础layer override（cream底+sepia等高线），不追求像素完美的Topo50重现 |
| 字体集成可能引入TS lint warning | 建`fonts.ts`配置中心化，逐步迁移，不阻塞其他Sprint |
| sepia棕主色A/B切换风险大 | 不在Phase 4-5做，留给Phase 6评估，本PRD仅备注 |
| DOC橙正名后非DOC场景widespread修改 | 提供`warningSoft`作平移目标，CR时一次性review |

### 不做的（"What We Will NOT Build"）
- ❌ Klim字体集成（成本高，留给Phase 6）
- ❌ 全UI Te Reo双语（v1只做亮点点缀+地名双标）
- ❌ Te Reo Only模式（v1英文是默认）
- ❌ 用户photo上传UI（v1.1）
- ❌ Stock photo集成（违反基线"避开Patagonia look"）
- ❌ Koru / Kowhaiwhai / Tukutuku装饰图案（基线雷区）
- ❌ Kiwi鸟卡通（基线雷区）
- ❌ 主品牌色立刻切换sepia棕（风险大，留Phase 6 A/B）
- ❌ 自创雪崩等级颜色（必须用NZAA国际5级）
- ❌ 任何LOTR / Hobbit视觉暗示（基线雷区）

---

## 参考依据

本PRD3的所有Epic设计依据：
1. **`docs/research/NZ_USER_AND_COMPETITOR_REFERENCE.md`** — NZ用户/视觉/竞品基线（3个研究Agent综合产出）
2. **审计报告（chat交付，2026-05-18）** — 8维度打分（5.5/10综合），Top 5最重要建议
3. **PRD2.md** — 功能性需求（PRD3不重复，只补差异化层）
4. **UI_SPEC.md L88-110** — Marker多层规范（E-015落地依据）
5. **基线L301** — "双语Te Reo/英文标签默认期望，不是加分"（E-014动机）
6. **基线第5.2节** — "NZ Topo50致敬是Cairn可独占的真实性信号"（E-013动机）
7. **基线第6部分** — 12条必避雷区（PRD3"What We Will NOT Build"依据）

---

**确认状态**：PRD3已就绪，可作为Sprint 55+的执行依据。Sprint Planning从E-012/E-016开始（轻量Sprint热身），逐步推进到E-013（重磅离线Topo50）。
