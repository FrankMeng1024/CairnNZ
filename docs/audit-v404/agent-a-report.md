# Cairn v404 产品体检报告 — Agent A

**扫描日期**: 2026-07-06
**范围**: v404 OTA (cold-boot 必登 + snapped route_points)
**方法**: 代码路径 + aliyun MySQL 抽查 + git log + PROJECT_STATE + lessons

---

### AuthScreen
**入口**: 冷启动无 token / v404 后 logout marker → 强制显示
**当前功能**: Splash 动画 → Sign In / Create Account → 邮件+密码 或 Google OAuth,验证码,注册,Privacy Policy 展示
**不足清单**:
- [P1] Apple Sign In 按钮**disabled 状态**且提示"Sprint 36 real OAuth"过时 tooltip,现在 Sprint 72 后 Apple 仍是 disabled
  - 证据: `app/src/screens/AuthScreen.tsx:11` 注释 "Apple (disabled, shows info) + Google (placeholder → Sprint 36 real OAuth)"
  - 用户可见影响: iOS 用户看到 Apple 按钮以为可用,点了没反应
- [P1] AuthScreen 文件 1339 行,包含 Trail 动画 + 3-stone Cairn 动画 + password/email/verify 多态 form,单文件难维护、启动开销大
  - 证据: `app/src/screens/AuthScreen.tsx` 全文
  - 用户可见影响: 冷启动到看到登录页有可觉察延迟(SVG 动画首帧)
- [P2] Email 验证正则只做基本 `x@y.z` 校验,无 disposable email 检测
  - 证据: `app/src/screens/FriendsScreen.tsx:42` (相同 regex)
- [P2] "Your tracks stay on this device" 承诺文案(Sprint 72 STORY-556)但 sessions 早已同步到 aliyun MySQL(id=188/190/191 都在服务器)
  - 证据: DB `sessions` 表 191 条记录,`app/src/services/*` 有 syncSession 逻辑;文案与实际数据流不符
  - 用户可见影响: 承诺与实际数据存储位置**冲突**,隐私敏感用户可发起投诉
**测试盲点**: verifyCode 流程真机;Google OAuth 在 iOS iCloud 邮箱 alias 下的表现;LPM 24h dedupe 真机是否触发

---

### HomeScreen
**入口**: 登录成功后默认首屏
**当前功能**: 问候语(Kia ora)+ UnfinishedSessionBanner + 最近活动/进行中活动一行 + 4 张活动大卡片(Hiking/Running/Memory/Trails)+ Tools row(Map/AR/Friends/Settings)
**不足清单**:
- [P1] `TrailsScreen.tsx` 是**dead code** — 只被自己引用,RootNavigator 用 RoutesScreen 承载 Activities/Flags/Routes
  - 证据: `Grep TrailsScreen` 只在 `app/src/screens/TrailsScreen.tsx` 出现;`app/src/navigation/RootNavigator.tsx` 只有 RoutesScreen 注册
  - 用户可见影响: 无(未挂载),但仓库有假实现造成后续开发混淆
- [P1] MarkDetailDevPreview 入口用 `__DEV__` 硬开关暴露在 Home,production build 不见但 dev channel 会看到
  - 证据: Sprint 68 note "HomeScreen `__DEV__` entry link"
- [P2] Kia ora 问候 5-12 点显示,但代码用**设备本地小时**,用户跨时区(比如新西兰用户在中国)会看到错乱问候
  - 证据: `app/src/screens/HomeScreen.tsx:33` `new Date().getHours()`
- [P2] getGreeting 用 mode='beginner'|'expert' 分 "Explorer" / "Navigator",但 UI 没提供切换入口在 Home 上,依赖 Settings 深藏
- [P2] "Recent activity within 24h" 硬编码 24h 窗口,间隔一天 hiking 的用户回来看不到最近一次记录
  - 证据: HomeScreen.tsx:48 `if the most recent activity was within 24h`
**测试盲点**: UnfinishedSessionBanner 在 cold-boot 时和 hydrate 时序竞态;大量 sessions(如 100+)时 RecentRow 性能

---

### HikingScreen
**入口**: HomeScreen 的 Hiking 卡片 tap
**当前功能**: 全屏 Mapbox + 顶部 GPS 状态 + 底部 Start/Stop + Flag 拖放 plant + 保存时命名 + 太短提示 + Kalman 平滑 + 后台采样降频(Sprint 72)
**不足清单**:
- [P0] **BroadcastService(P0/P1/P2 提示,Sprint 46)** 在 HikingScreen 完全没被引用 — 走偏路提醒/waypoint 到达提示都不会触发
  - 证据: `grep BroadcastService screens/ features/` 无结果;NavigationController 也未被挂载
  - 用户可见影响: 用户偏离路线不会有任何听觉/触觉/视觉提醒 — Sprint 46-48 全部功能死码
- [P0] **SOSButton** 组件存在(`app/src/components/SOSButton.tsx`)但 zero import — HikingScreen 里 grep SOSButton 无结果
  - 证据: `grep -rn "SOSButton" screens/ features/` 无结果
  - 用户可见影响: PROJECT_STATE 声称 "HikingScreen SOS" Done(Sprint 53),实际 UI 无 SOS 按钮 — 用户户外出事按不到
- [P1] session 190 (2026-07-02) 有 89 raw / 61 snapped,但 v402/v404 之后**没有回填** — 早期数据 route_points_raw 为 NULL(session 183-187 都是 raw=NULL)
  - 证据: DB `SELECT ... FROM sessions WHERE id IN (183,184,185,186,187)` 全部 raw_count=NULL
  - 用户可见影响: 旧 activity 看不到 snap 前后对比,MapHistory 上老 session 显示无原始轨迹
- [P1] `elevation_gain_m` 字段全表为 0 — 无高程数据采集
  - 证据: DB `SELECT DISTINCT elevation_gain_m FROM routes` = 0;sessions 表甚至没有 elevation 列
  - 用户可见影响: "+0m" 显示在所有 activity 详情,山地徒步用户觉得数据缺
- [P2] `TooShortSheet` 触发阈值(< 100m?)硬编码在代码里,山地场景短距离穿越可能误伤
  - 证据: `app/src/screens/HikingScreen.tsx` 引用 TooShortSheet 组件
- [P2] 后台采样降频(Sprint 72 STORY-553)真机电池省电效果**从未测过**(PROJECT_STATE 明确 "Deferred to real iPhone gate")
**测试盲点**: 长时间(>2h)hiking 内存增长;iOS LPM 触发时 keep-awake 是否失效;Kalman 在隧道/密林 GPS 断开后恢复的表现

---

### MapScreen
**入口**: HomeScreen Tools row "Map" / Marker detail 返回 / RoutesScreen Flag tap
**当前功能**: 全屏 Mapbox + markers(tier-aware 3色: self/friend/stranger)+ 底部 panel + edit modal + OfflineMapSheet
**不足清单**:
- [P0] `loadCircleMarkers` 一挂载就无条件调用,但 `friends` 表为空(user_id=4 只有 accepted friend_requests 无对应 friends 行)→ Friend markers 永远为空
  - 证据: DB `SELECT * FROM friends WHERE user_id=4` 返回 0 行;`friend_requests` 表有 5 条 accepted
  - 用户可见影响: F1-F3 sprint 声称 Done,实际 user_id=4 打开 Map 看不到任何 friend marker
- [P1] MapScreen 里 Mapbox 不可用时 fallback 用"grid 3×N"随机位置放 markers(见 hardcoded grid 注释),不反映真实经纬度
  - 证据: `app/src/screens/MapScreen.tsx:120-140` grid layout
  - 用户可见影响: Expo Go dev 或 native 崩溃时,marker 位置全错
- [P1] `helpful_count` / `report_count` / `status='hidden'` DB schema 有,UI 侧完全没读没显示
  - 证据: `grep helpful_count screens/` 无结果;DB `describe markers` 有 helpful_count/report_count/status/hidden_at
  - 用户可见影响: Like/Report(Sprint 68 STORY-533)存在 session-only fake state,不 sync 到后端
- [P2] MapBottomPanel 数据源在挂载时一次性拉取,markers 新增/删除后不 auto-refresh
- [P2] OfflineMapSheet 存在但离线 tile 下载状态/大小/清理入口未在 Settings 暴露
**测试盲点**: 4G 断网时 Map 挂载路径;subscribe 到某个朋友但对方 revoke 后 marker 是否会 leak

---

### MemoryScreen (fog 地图 tab)
**入口**: HomeScreen 的 Memory 卡片
**当前功能**: Mapbox 上叠雾遮罩 + hike 走过区域 h3-cell 解锁 + Mine|Friends scope toggle + 5-friend pick modal + PaywallSheet UI
**不足清单**:
- [P0] **fog UNION render (Sprint 70 STORY-541)明确 DEFERRED to F5/iPhone** — Friends scope 打开后仍显示自己的 fog,好友的 memory_points 完全没被合成
  - 证据: PROJECT_STATE:124 "STORY-00541 — DEFERRED";`grep loadCircleFog features/memory` 无结果
  - 用户可见影响: F5 承诺的核心 "看好友地图" 功能**根本没实现**,只有 UI 空壳
- [P0] `loadStrangerPublicBbox` (Sprint 70 follow-up)从未实现 — 陌生人 public marker 蓝色显示到 fog 边缘的功能空
  - 证据: `grep loadStrangerPublicBbox` 无匹配
- [P1] PaywallSheet 硬编码 `Alert('Coming soon')` — 5-friend 上限 paywall 不能真订阅(v1 明确 no IAP,但公开发布需要)
  - 证据: `app/src/features/memory/components/PaywallSheet.tsx:28`
- [P1] MemoryScreen 内部注释显示 v322 修过 login-time crash(移到 ForegroundUnlockManager 局部挂载),但如果用户直接 冷启动 → Memory tab 是否有回归待验
  - 证据: MemoryScreen.tsx:38 `v322: mounts only when MemoryScreen mounts`
- [P2] `_lastKnownCoord` 30s TTL 模块级缓存(v333),cold-boot 后拿不到,导致 "Looking for your position…" flicker 仍存在于 release build
  - 证据: MemoryScreen.tsx:64-72
- [P2] Memory 首次访问 firstVisitDone hint 只在 hydrate 之后显示,若 storage 慢,老用户会看到一帧 hint
**测试盲点**: fog UNION 5 好友真机 FPS(SPIKE-67-1 全 desk research 无真机数);memory_points 2227 条时 fog render 性能

---

### TrailsScreen (Activities/Flags/Routes 三 sub-tab)
**入口**: HomeScreen Tools row(实际由 RoutesScreen 承载,路由名叫 `Routes`)
**当前功能**: 3-tab (Activities/Routes/Flags) + Mine|Friends scope(仅 Flags/Routes)+ Filter chips + Empty state 插画
**不足清单**:
- [P0] "Plan Route" 按钮硬 `Alert('Plan Route', 'Route planning coming soon')` — 主要 route 规划入口是死链
  - 证据: `app/src/screens/MapHistoryScreen.tsx:964`
  - 用户可见影响: 用户点 "Plan Route" 只弹 alert,承诺的路线规划功能不存在
- [P1] Activities 里没有 raw 轨迹回放(session 183-187 raw_count=NULL),但已经声明 "you can see raw + smoothed"
  - 证据: DB 5 条老 sessions raw=NULL
- [P1] Routes 表只 3 条(全是 Sprint 67 mock seed,name 带 "(saved)" 后缀),user_id=4 没有任何真实 saved route
  - 证据: DB `SELECT * FROM routes` — 只 66/65/64 三条,user_id 是 19/23,不属于 user 4
  - 用户可见影响: user_id=4 打开 Routes tab 永远 empty state,即使 hike 完选 "Save as Route" 也不 persist(RouteEditor 走的是 useRouteStore,后端 POST /api/routes 是否成功待验)
- [P1] Friends sub-tab 因为 friends 表空(见 MapScreen [P0]),永远 empty
- [P2] Flag 过滤 chip 有 `all / danger / cairn / water / junction`,但 marker 类型还包括 `hut` 和 `free` — UI 过滤不全
  - 证据: RoutesScreen.tsx:51-64 vs DB `SELECT DISTINCT type FROM markers` 有 hut
- [P2] ScopeTabBar 底边 border 高亮设计,视觉权重低于原 tab bar,首次用户可能忽略
  - 证据: RoutesScreen.tsx:126-155 (UX-Med-5 fix note)
**测试盲点**: 100+ activities 时 FlatList 滚动性能;raw vs snapped 切换是否有 UI 入口

---

### RoutesScreen / RouteEditorScreen
**入口**: TrailsScreen Routes tab → tap route / "Save as Route" from Hiking
**当前功能**: Route 列表 + 详情 sheet + Editor(edit 已存 route 或从 session 创建)+ Beautify/Preview
**不足清单**:
- [P0] elevation_gain_m 保存时永远 0(见 HikingScreen [P1])— 保存后 Route 详情 "+ 0m elevation"
  - 证据: DB routes 表全 0
- [P1] RouteEditor 的 EditOverlayV274 包含 Save/Preview/Beautify/Cancel,但 Beautify 具体算法未文档化,用户不知道会改成什么
  - 证据: `RouteEditorScreen.tsx:868`
- [P1] Route permission='public' 被 backend v4 §H1 强制拒绝(POST 时 400),但 Editor 里 UI 可能仍展示 Public 选项让用户 confused
  - 证据: PROJECT_STATE 68 "v4 H1 enforcement (POST/PUT markers/routes reject permission='public')"
- [P2] shareGPX / sharePDF import 存在但无入口按钮 — Export 功能死码
  - 证据: `RoutesScreen.tsx:27` "kept for future Export action"
- [P2] RouteEditor Save 后 CommonActions.reset 到 Home,用户失去了浏览刚保存 route 的返回按钮语义
  - 证据: `RouteEditorScreen.tsx:619-629`
**测试盲点**: 大 route(>500 点)Editor 交互卡顿;Beautify 算法对乱序点/穿墙点的容错

---

### FriendsScreen
**入口**: HomeScreen Tools row Friends
**当前功能**: 邮件加好友 + pending request accept/reject + Friend 列表 + share toggle per friend + 空态插画
**不足清单**:
- [P0] user_id=4 的 5 条 accepted `friend_requests` 从未产生 `friends` 表行(legacy 数据孤儿)— 现在 Friends 列表**永远空**,好友演示不了
  - 证据: DB `SELECT * FROM friends WHERE user_id=4` = 0 行;`SELECT * FROM friend_requests WHERE to_user_id=4 AND status='accepted'` = 5 行
  - 用户可见影响: 主账户看不到任何 friend,所有 friend 功能自 F1 起对 user_id=4 都是空 shell
- [P1] `toggleShare` 只改本地 state(`friends` 数组过滤),不 POST 到后端 — 关掉 sharing 下次 App 冷启动还是 sharing
  - 证据: `FriendsScreen.tsx:427-429` `setFriends(prev => prev.map(...))`
- [P1] friend online/lastSeen 显示逻辑存在(`hasStatus`)但 backend 从不返回,永远 fallback 到 "N/A" 隐藏 → 死代码分支
  - 证据: `FriendsScreen.tsx:83-84` 注释 "Backend doesn't (yet) return online status"
- [P2] Email 校验只查 `x@y.z`,自邀请检查用 `OWN_EMAIL = 'me@cairn.app'` 常量(dev placeholder),实际登录邮件不生效
  - 证据: `FriendsScreen.tsx:39`
- [P2] sharedMarkers 计数从未真实计算,依赖 friend 对象携带的静态字段
**测试盲点**: 大量 pending requests(20+)UI 折叠体验;reject 后能否重新发 request

---

### SettingsScreen
**入口**: HomeScreen Tools row Settings
**当前功能**: Explorer/Navigator mode 切换 + Toggle rows(dark mode, haptics, etc.)+ Memory settings section + Debug 上传 + Logout
**不足清单**:
- [P1] Dark mode toggle 在 Settings,但 CLAUDE.md/tokens 尚未见完整暗色主题实现 — 切换后可能只有部分组件响应
  - 证据: `SettingsScreen.tsx:27` import Colors from tokens,tokens.ts 需查
- [P1] Logout 走 `logout()` from authService,清 token,但 MemoryScreen/HikingScreen 的 module-level state(`_lastKnownCoord`, tracking watcher)不 reset
  - 证据: PROJECT_STATE Sprint 73 backlog M1 "tokenRefreshInterval/autoPauseMonitor safety cleanup in reset()/logout()"
  - 用户可见影响: 登出后另一账户登录,残留 fog 或 tracking 状态
- [P2] "Save button hidden until dirty, shimmer animation" — 但如果修改后立即 background,dirty state 是否持久化不明
- [P2] Debug 上传截图流程只在 Sprint 26+ 存在,普通用户找不到入口/入口混淆
  - 证据: `SettingsScreen.tsx:33` `pickDebugScreenshots, uploadDebugScreenshots`
**测试盲点**: Memory subscription 上限从 5 → paywall 交互;Explorer/Navigator 切换是否真的改 HomeScreen 布局密度

---

### ARScreen (现役 + Legacy)
**入口**: HomeScreen Tools row AR(if v025 flag enabled)/ 老入口走 Legacy
**当前功能**:
- ARScreen.tsx = 23 行 wrapper,读 `useV025Enabled()`,true → ARScreenV2,false → ARScreenLegacy
- ARScreenLegacy(1945 行)= v0.2.4 之前的 2D-on-camera + Viro 尝试遗迹
- ARScreenV2(v025)= 新架构 skeleton,大量注释显示仍未完成

**不足清单**:
- [P0] ARScreenV2 里 `cairnType: 'cairn' // TODO Phase 6: read from user type selection UI` — 用户 plant 的 marker type 硬编码为 cairn,选 danger/water/junction 时 AR 里都变石堆
  - 证据: `app/src/screens/v025/ARScreenV2.tsx:175`
- [P0] ARScreenV2 只有 skeleton,注释多次说 "falls back to legacy under the hood",但 `useV025` 的默认值和真机是否走 v2 需查 featureFlagsClient — 双路径共存必然一路失修
  - 证据: `ARScreen.tsx:6` "until then it falls back to legacy under the hood"
- [P1] ARScreenLegacy 1945 行单文件,USE_VIRO=true 但 Viro 已在 memory 里被明确否决(feedback_face_problems)— 死码难 debug
  - 证据: `ARScreenLegacy.tsx:186` "hardcoded as the only path (USE_VIRO=true)"
- [P1] AR 相关的 3 大 feedback(unity_visual_test, face_problems, no_push_no_build)显示 AR 是长期痛点区,Sprint 51-52 后基本停滞
  - 证据: MEMORY.md 多条 AR feedback
- [P2] "camera-perm log + ARKit loader"(commit 6d25cc0)diag 大量存在,说明 AR 路径 crash 概率高,普通用户碰到直接掉 legacy fallback 里
**测试盲点**: AR 在 Android(ARCore)完全未测试;iOS 15 以下 ARKit;Debug logs 里 v025 flag 分布(可查 aliyun `app_logs`)

---

### Activity Detail (MapHistoryScreen)
**入口**: TrailsScreen Activities tab → session card tap
**当前功能**: session 详情图 + 顶部 map + FlagDetailSheet + 曲线统计 + 分享/编辑入口
**不足清单**:
- [P0] "Plan Route" Alert("coming soon") — 见 TrailsScreen [P0]
- [P1] 老 session (id 183-187)`route_points_raw` 为 NULL,MapHistoryScreen 打开这些 activity 时无原始轨迹叠图
  - 证据: DB 已抽查
- [P1] `elevationGainM` 字段渲染 `+0m`(session 全为 0),UI 上永远是 "+0m elevation"
  - 证据: `MapHistoryScreen.tsx:519,922,1002`
- [P2] FlagDetailSheet delete 依赖 useMarkerStore.deleteMarker,若 network 失败无 optimistic rollback 提示
- [P2] session 命名 fallback (`'Run' / 'Hike'`) 的历史 hardcode 注释还在(414 行),说明处理逻辑复杂
**测试盲点**: 1000+ 点的 session 打开 Map 是否卡顿;expandedStat 展开状态在 tab 切换后保留还是重置

---

## 最痛的 3 个问题

**痛点 1 — Sprint 46-54 一大批"完成"功能实为死码,产品承诺与现实脱节**
BroadcastService(P0/P1/P2 提示)、SOSButton(长按 3s+5s 倒计时+SMS)、NavigationController(deviation+waypoint)、weatherService、trailStatusService、useCommunityStore 在 `screens/` 和 `features/` 里 zero import。 PROJECT_STATE 声称"Sprint 47 SOS 已完成 / Sprint 48 tracking 集成 / Sprint 53 HikingScreen SOS"但**用户点开 HikingScreen 完全找不到 SOS 按钮**,户外出险按不出来。这是最危险的问题——不是 UI 瑕疵,是承诺破功。修复优先级:先补 SOSButton 挂载到 HikingScreen,再决定 BroadcastService 是接还是删。

**痛点 2 — Friend System v1(F1-F4)整套 UI 空壳,主账户根本演示不了**
user_id=4 的 5 条 friend_requests 状态是 accepted 但 `friends` 表为空(数据孤儿,accept 逻辑写在 F1 之后,老 accepted 请求没触发 bidirectional insert)。结果:MapScreen loadCircleMarkers 返回空,RoutesScreen Friends tab 空,FriendsScreen 列表空。加上 Sprint 70 STORY-541(fog UNION 好友雾合成)明确 DEFERRED,STORY-542 paywall 是 fake Alert,`loadCircleFog`/`loadStrangerPublicBbox` 从未实现——**F1-F4 声明 Done 但对真实用户几乎全是死路径**。修复:先用一条 SQL 补齐 user_id=4 的 friends 行(基于 accepted friend_requests),再打通 web Playwright 端到端。

**痛点 3 — GPS 记录关键字段缺失 + 老数据不完整,产品核心竞争力(hiking 数据)有断裂**
`sessions.elevation_gain_m` DB 列不存在,`routes.elevation_gain_m` 全表为 0,UI 上永远 "+0m" ——山地徒步用户会觉得数据不专业。老 session(183-187,来自 6-28 seed)`route_points_raw` 为 NULL,只有 v402 之后 route_points_raw 才有值,MapHistory 打开老 activity 看不到原始轨迹。加上 Sprint 72 承诺"tracks stay on this device"但服务器上 sessions 表就是同步中心——**隐私文案与实际数据流冲突**,一旦有用户查隐私协议对不上会翻车。修复:elevation 采集接入 expo-location altitude 字段并写入 DB schema,老数据回填 raw=NULL 时用 route_points 兜底,同时把 Auth 文案改成实事求是的表述。
