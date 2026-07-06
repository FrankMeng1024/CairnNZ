# Cairn v404 产品体检报告 — Agent B（用户视角 + PRD 承诺对账）

**方法论**: 3种用户角色走查 + PRD/PRD2/PRD3 逐条对账 + 反复修 commit 聚焦分析 + Deferred story 追溯。
**证据类型**: file:line / PRD:line / commit SHA / grep 结果 / 目录存在性。
**范围**: 27个 issue 覆盖 12 页面 + 4 项跨页 PRD gap。

---

### AuthScreen
**入口**: 冷启动首屏 / 401 被登出后
**当前功能**: Sign In / Create Account / Google OAuth / Email 验证码
**用户视角不足**:

- **[P0] PRD3 E-014 承诺 splash 副标 "Nau mai, haere mai" 未上线，AuthScreen 完全无 Te Reo 元素** — 新用户第一屏 = "这就是一个普通 AllTrails 抄袭"
  - 证据: `docs/PRD3.md:92`（"Auth Splash加副标"），Grep `Nau mai` 全 app 零命中，`app/src/screens/AuthScreen.tsx:1-100` 无相关字符串
- **[P0] `docs/cultural-consultation.md` 不存在 = PRD3 release blocker** — 现有 "Kia ora" 上生产但**无翻译资质记录**
  - 证据: `ls docs/cultural-consultation.md` = No such file，PRD3.md:338 明确 "作为 release prerequisite"
- **[P1] Email 前端验证已被开发者临时注释关掉且未恢复**
  - 证据: commit `31f6fd2` "v378: 前端 email/password 验证临时注释" — 未见 revert

### HomeScreen
- **[P1] PRD3 E-018 承诺 sub 文案 "Navigate tracks · Leave cairns · Explore at your pace" 未替换**
  - 证据: Grep `Navigate tracks|Leave cairns` = No matches found
- **[P2] `getGreeting` 硬编码 3 段问候，"Kia ora" 只覆盖 5-12 点** — 下午+晚上 Te Reo 覆盖率 0%
- **[P2] Explorer/Navigator 差异 UI 无解释**

### HikingScreen (2308 LOC)
- **[P0] SOS 按钮承诺"HikingScreen / MapScreen 加固定 SOS FAB"完全未实现** — HikingScreen 仅注释提到 SOS，无 `<SOSButton>` 挂载
  - 证据: `HikingScreen.tsx:333,1636,1638` 全是注释；Grep `<SOSButton|<SOSFab` on all screens = 0 命中
- **[P0] `voiceService` 存在但整个 hiking flow 无调用** — 说好的"路线偏离语音播报"实为空壳
  - 证据: Grep `voiceService` in screens/services（排除自定义）= 0 消费者
- **[P1] `NavigationController` 存在但未在 HikingScreen 挂载**
- **[P2] Sprint 70+ 3-stage flicker 修了 10+ 版才收敛（v354→v370）**

### RunningScreen
- **[P0] PRD2 声称"跑步模式语音为主、锁屏可用"，但 `voiceService` 在 RunningScreen 也无消费者**
- **[P1] 无 audio ducking 集成到 running loop** — PRD2 E-008 明确要 iOS `.duckOthers`

### MapScreen (1387 LOC)
- **[P0] PRD3 E-013 "自定义 Cairn Topo Mapbox style"未激活** — `CAIRN_TOPO_STYLE_URL` 仅定义处，MapScreen 未切换
  - 证据: PRD3.md:75 明确 "MapScreen/HikingScreen/RouteEditorScreen/MapHistoryScreen 全部切到新 style"
- **[P0] MapScreen 依然无 SOS FAB**
- **[P1] PRD3 E-016 warning 色仍是 `#b36b00`（土黄），未改为真 DOC 橙 `#F26522`**
  - 证据: `app/src/components/tokens.ts:31`
- **[P2] Legacy `PointAnnotation → MarkerView` 迁移改了 7 版才稳（v384-v393）** — pin 视觉基础层不稳

### Memory Tab (MapHistoryScreen)
- **[P0] Plant 解雾功能从 v383 到 v400 反复出 bug 修了 9+ 版** — 该功能仍是本项目最不稳的核心
  - 证据: v394→v395→v396→v397→v398→v399→v400→v401→v404 全部涉解雾
- **[P1] Friend/subscribed 雾 tier 的 UNION 性能验收 (STORY-00547 "5-friend fog UNION < 3s") 未在真机 iPhone 上通过**

### TrailsScreen
- **[P1] 好友活动 feed 完全缺失** — PRD2 E-004 承诺"session 开始前拉取好友最新数据"
- **[P2] "Leave a Cairn here" 按钮直接跳 Plant，但新用户不知 Cairn 是什么**

### RoutesScreen
- **[P1] 路线分享 "来自XXX" 标签未实现** — PRD2 E-007 承诺
- **[P2] GPX 只有 export，无 import**

### RouteEditorScreen (1147 LOC)
- **[P0] Backlog STORY-00519/00520 "trim + midpoint drag" 状态 = Deferred (Sprint 66)** — 用户建的路线画错一段只能重画
- **[P1] Backlog STORY-00212 "snap-to-road via Mapbox Directions API" 长期 Todo**
  - 证据: hike-save snap 已上线 (v402)，但 route editor 手绘 tap 仍是直线穿楼

### FriendsScreen
- **[P0] PRD3 E-017 要求 "Online 圆点改 Active now / Last active Xh ago"，代码仍显示纯 "Online"**
  - 证据: `FriendsScreen.tsx:110` 硬编码 "Online" 字面量
- **[P0] Sprint 71 STORY-00545 "iPhone real-device visual review" 未执行** — Friend System v1 每个界面没在真机上审过
- **[P1] Empty state 文案 "Cairn is better with trail companions" 用了旧词 "trail"**

### SettingsScreen
- **[P0] "Emergency Contacts" 是纯 stub — 弹 Alert "Configure in next update"** — SOS 依赖它，SOS 链路自根开始就断
  - 证据: `SettingsScreen.tsx:565-567`
- **[P0] "Broadcast Interval" 同样 stub** — PRD2 E-008 承诺可调
- **[P0] "Offline Maps" section 缺失** — PRD3 E-013 承诺 "SettingsScreen 新增 Offline Maps section, 至少 3 Great Walks"
  - 证据: Grep `downloadPack|offlineMapService` in SettingsScreen = 无
- **[P1] 隐私 section 未做 "plain English" review**

### AR (ARScreen + ARScreenLegacy)
- **[P0] `ARScreenV2` 依赖 `@azesmway/react-native-unity` 但代码用 dynamic require 试探性加载** — 生产 build 里若原生模块缺失 = 静默 fallback 到状态面板
  - 证据: `ARScreenV2.tsx:41-51` `try { require([...].join('/')) } catch {}`
- **[P1] Route 到 AR 只有 HikingScreen 里 1 处入口** — Home 无 AR 入口

### MarkerDetailScreen / PlantScreen
- **[P1] PRD3 E-015 "首次发现 halo"（24h 内首次查看该 marker 触发柔和动画） 未实现**
- **[P2] Marker photo upload UI 承诺 "v1.1做"**

### 跨页 / 系统级
- **[P0] Sprint 72 未结束 session 恢复逻辑仅前端本地检测** — 若已 push 到 aliyun，恢复会不会双写？无双端对账
- **[P0] `docs/cultural-consultation.md` 缺失** = PRD3 release blocker
- **[P1] Trip Sharing 是纯 UI toggle，无 overdue 通知实现**
- **[P1] Community tier 后端 gate 掉写 (H1 rejection)** — UI 侧仍能选 "public"，静默失败

---

## 最痛的 3 个问题（VU-style 严苛裁决）

**1. 安全承诺"完整"实为空壳 — SOS 链路 + 语音偏离播报双双未挂载**
`SOSButton` + `sosService` + `voiceService` + `NavigationController` 全部存在，**没有任何一个屏幕真的挂了它们**。PROJECT_STATE 声称 Phase 2 SOS/Broadcast COMPLETE，实为"零消费者的孤儿代码"。用户装 Cairn 出门以为能一键求救、能语音偏离播报、能"戴耳机跑山不用看手机"——**这三件事一件都做不了**。这是产品定位（safety tool）自己的坍塌。

**2. NZ 本土差异化承诺"名义已开工"实为进度僵化 — PRD3 交付率 <30%**
PRD3 是"打败 AllTrails 唯一路径"的 6 个 Epic (E-012 到 E-019)。实际交付：E-012 字体 ✓、E-019 插画目录 ✓；E-013 离线 style ✗、E-014 只覆盖 33% + cultural-consultation.md 不存在 ✗、E-015 halo ✗、E-016 DOC 橙未替换 ✗、E-017 SOS FAB/"Active now" 零命中 ✗、E-018 空态"trail"未替换 ✗。**这是"我们做了体检、写了 3 版 PRD、然后跳去修 fog 和 auth 了"的经典 sprint drift**。

**3. Friend System v1 上生产但每个界面都没在 iPhone 上审过**
Sprint 71 (F5) 三个 story (真机审 / fog UNION FPS / 5-friend perf) 全部 "Cannot run in current workflow env"。Sprint 68-70 造了 8 个后端 endpoint + Detail Sheet 4 forms + Trails 双 tab + Memory Mine|Friends —— **这些复杂视觉都只在 web Playwright + subagent 眼里"通过"，用户真机首次上手完全是黑盒**。打开 Friend tab 那一刻是 v1 命运时刻，**我们在赌**。
