# Cairn 全功能清单（Step 2 · 2026-07-19）

**用途**：Step 3 playwright 全功能基线扫测的依据。用户明确：**settings 不测，其他都测**。

**Screen 数（Navigator 引用中的活跃 screen，不含 zombie）**：14

| # | Screen | 行数 | 状态 | 是否测试 |
|---|---|---|---|---|
| 1 | HomeScreen | 635 | real-done | ✅ 测 |
| 2 | HikingScreen | 2528 | real-done · 最大文件 | ✅ 测 |
| 3 | RunningScreen | 970 | real-done | ✅ 测 |
| 4 | AuthScreen | 1341 | real-done | ✅ 测 |
| 5 | ~~SettingsScreen~~ | ~~1063~~ | ~~real-done~~ | ❌ 用户明确不测 |
| 6 | DebugScreen | 468 | real-done | ⚠️ dev-only 可选测 |
| 7 | PlantScreen | 310 | real-done | ✅ 测 |
| 8 | MarkerDetailScreen | 636 | real-done | ✅ 测 |
| 9 | MapScreen | 1387 | half-done · 与 Hiking 重叠 | ✅ 测 |
| 10 | MapHistoryScreen | 1667 | real-done | ✅ 测 |
| 11 | RoutesScreen | 1483 | half-done · FLAG_TYPES 重复 | ✅ 测 |
| 12 | RouteEditorScreen | 1147 | real-done | ✅ 测 |
| 13 | FriendsScreen | 881 | half-done · online/lastSeen 后端无字段 | ✅ 测 |
| 14 | MemoryScreen | 1300 | real-done | ✅ 测 |
| 15 | MarkDetailDevPreviewScreen | ? | dev-only preview | ❌ dev 可选 |

**共 12 个 screen 需 playwright 基线扫测**（排除 SettingsScreen + Debug + DevPreview）。

---

## 每 Screen 的核心功能 + 测试点

### 1. HomeScreen · 主 dashboard
- **入口**：登录后首屏
- **核心组件**：4 个 ToolBtn（开始 hike / 跑步 / 地图 / 好友） + RecentRow（最近活动）
- **依赖 service**：sessionStore, useAppStore
- **测试点**：
  - a) 页面加载不 crash
  - b) 4 个 ToolBtn 全部可点击 + 跳转正确 Screen
  - c) RecentRow 显示最近 session 数据
  - d) navigation drawer / bottom tab 可用

### 2. HikingScreen · Hiking 主流程（2528 行大文件）
- **入口**：Home → ToolBtn "Hike"
- **核心组件**：Mapbox map + tracking 状态机 + marker plant button + finalize sheet
- **依赖 service**：trackingStore, sessionStore, hikeTrackWriter, hikeTracksCache, syncDaemon, pendingSyncStore, batteryMonitor, offlineQueue, memoryStore
- **测试点**：
  - a) 开始 hike（获取 GPS 权限）
  - b) GPS 轨迹渲染到地图
  - c) 长按 SOS（**将砍**，测存在与否 + 无残留）
  - d) 暂停 / 恢复 / 结束
  - e) Finalize（v412 原子事务）
  - f) 上传 memory_points（1000 pt chunk）
  - g) 崩溃恢复
  - h) 离线时的 offline queue

### 3. RunningScreen · 跑步模式
- **入口**：Home → ToolBtn "Run"
- **核心组件**：3 态锁屏（idle / running / paused） + 配速显示
- **依赖 service**：trackingStore（跑步分支）, sessionStore
- **测试点**：
  - a) 3 态切换（idle → running → paused → idle）
  - b) 配速实时更新
  - c) 短走动过滤（<200m 不入库）
  - d) 结束保存到 sessions

### 4. AuthScreen · 登录 / 注册
- **入口**：未登录时首屏
- **核心组件**：email login / register / Google OAuth / verify code / password reset
- **依赖 service**：authService, apiService（/api/auth/*）
- **测试点**：
  - a) email 注册 → 验证码 6 位（dev 环境 backend 返回 dev_code）
  - b) email login（正确密码）
  - c) email login（错误密码 429 rate limit）
  - d) Google OAuth flow
  - e) refresh token 自动续期
  - f) 修改密码

### 5. DebugScreen · Dev 工具（5-tap 解锁）
- **入口**：Settings 或 Home 5-tap 隐藏入口
- **核心组件**：session upload / export / delete，log viewer
- **测试点（可选）**：dev-only，非核心功能

### 6. PlantScreen · 留标记（GPS→pin→content 3 步）
- **入口**：Hiking → Plant Marker 按钮
- **核心组件**：GPS 定位 → 类型选择（danger/junction/water/hut/cairn）→ 输入标题（30字）+ 正文（200字）→ visibility 选择
- **依赖 service**：markerStore, apiService（POST /api/markers）
- **测试点**：
  - a) 3 步流程完整
  - b) **default visibility 是 'friends' 还是 'self'**（**Blocker Bug** · 修前是 friends，修后应为 self）
  - c) 类型图标显示正确
  - d) 30/200 字上限
  - e) 保存后回到 map，marker 可见

### 7. MarkerDetailScreen · 看别人 marker（v416 owner 判定刚修）
- **入口**：地图上点 marker
- **核心组件**：marker 内容展示 + 有用/举报按钮 + 作者 owner 判定
- **依赖 service**：markerStore, useMarkLikeStore（**fake state · Blocker Bug**）, useLikeReport（real API 未接）
- **测试点**：
  - a) owner 看自己 marker：显示编辑/删除
  - b) 非 owner 看：显示 like/report
  - c) 匿名显示（不显示作者 ID）
  - d) **点击 like/report 是否真发 API**（Blocker Bug 修前是 fake state）

### 8. MapScreen · 地图主页
- **入口**：Home → ToolBtn "Map"
- **核心组件**：Mapbox map + 好友圈 markers + 自己 markers + routes overlay
- **依赖 service**：circleStore（/api/circle/markers, /routes, /fog）
- **测试点**：
  - a) 加载好友圈 markers
  - b) 加载自己 markers
  - c) marker 点击进 MarkerDetail
  - d) bbox 加载（zoom 变化时重新拉数据）
  - e) 离线模式 fallback

### 9. MapHistoryScreen · 历史 session 详情
- **入口**：从 sessions 列表点入
- **核心组件**：Mapbox 轨迹渲染 + session meta + memory_points overlay
- **测试点**：
  - a) 加载历史 session
  - b) 轨迹正确渲染（snapped + raw）
  - c) memory points fog dot 显示
  - d) 分享 / 导出（如启用）

### 10. RoutesScreen · 路线管理
- **入口**：Home → ToolBtn "Routes"
- **核心组件**：3-tab（我的 / 好友 / 公开）+ 每 route 卡片
- **依赖 service**：routeStore（/api/routes, /api/circle/routes）
- **测试点**：
  - a) 3 个 tab 切换
  - b) 创建新 route → 进 RouteEditor
  - c) run this route（PATCH /:id/run）
  - d) 删除 route（我的 tab）
  - e) FLAG_TYPES 重复定义 bug 影响？

### 11. RouteEditorScreen · 路线编辑（v236 完整重写）
- **入口**：Routes → New/Edit
- **核心组件**：地图上手绘 → snap-to-road → waypoint 编辑 → 保存
- **测试点**：
  - a) 空 route 创建
  - b) waypoint 添加/删除
  - c) snap-to-road（Mapbox /matching）
  - d) 保存 + reload

### 12. FriendsScreen · 好友管理
- **入口**：Home → ToolBtn "Friends"
- **核心组件**：好友列表 / 添加请求 / 待接受 / 删除好友
- **依赖 service**：friendStore（/api/friends*）
- **测试点**：
  - a) 好友列表加载
  - b) 添加好友请求（用 email）
  - c) 接受 / 拒绝请求
  - d) 删除好友
  - e) **online / lastSeen / sharedMarkers 字段** —— 后端不返，UI 死路径（Agent A 发现）
  - f) **删除好友后 memory_subscriptions 级联** —— Blocker Bug（未级联，隐私违约）

### 13. MemoryScreen · 手账主页
- **入口**：Home → ToolBtn "Memory"
- **核心组件**：Fog 地图（H3 hex）+ 好友订阅列表 + medallion pin
- **依赖 service**：memoryStore, memorySubscriptionStore
- **测试点**：
  - a) 自己 fog 渲染
  - b) 好友 fog 叠加（订阅关系）
  - c) medallion pin 点击展开
  - d) 好友订阅上限（max 5）
  - e) **缺 on-this-day / anniversary / multi-year 回看**（灵魂词 gap）

---

## 需新做的功能（Roadmap 缺）

**从 4 subagent audit + 27 NZ 官方数据 + 4847 Reddit 数据 → 上线前必补**：

1. **天气 + 河流警告**（S61）：MetService + DOC trail alerts + 渡河风险
2. **高山 + 火山警告**（S62）：GNS Science 三山 + winter 等级
3. **Get home-itis 反常识提醒**（S62）：checkpoint 天气变差建议原地等
4. **行程告知机制**（S63）：MSC Land Safety Code 第 4 项落地
5. **On-this-day / anniversary**（S66）：手账灵魂词补齐
6. **Fog 覆盖率 dashboard**（S66）："新西兰你走过 X km² · Y%"
7. **桌面 widget**（S66）：日常仪式感

---

## 已确定砍的功能（S60 首 Sprint）

- ❌ **AR 全系** ~6000 行（用户明确：GitHub 有，需要时再取）
- ❌ **SOS**（SOSButton + sosService） ~580 行
- ❌ **v0.2.5 stack** ~1200 行（永远不跑）
- ❌ **fogMaskRenderer.ts** 437 行（v346 后废码）
- ❌ **EditOverlayV236.tsx** 501 行（V274 取代）
- ❌ **UnfinishedSessionBanner.tsx** 233 行（v412 被 UnfinishedRecoveryModal 取代）
- ❌ **weatherService.ts** 195 行（0 call site；S61 会重做集成 MetService）
- ❌ **voiceService.ts** 152 行（0 引用）
- ❌ **exportService.ts** 167 行（UI 未挂）
- ❌ **TrailsScreen** 58 行 + **SpikeMapboxJunctionScreen** 576 行（Navigator 不引用）
- ❌ **MemorySummaryCard.tsx** 144 行（0 import）
- ❌ **RouteDrawingSheet.tsx** 234 行（0 引用）

**总计强砍 ~10,600 行 = 65,739 行的 16%**。

---

## 测试基线（Step 3 Playwright 扫）

对每个 screen 用 playwright 完成以下操作 + 截图 + console error 检查：
1. 进入该 screen（用 `__cairnStores.navigationRef` 跳转）
2. 触发核心动作（如 hike start / plant marker / add friend）
3. 检查 console.error 数量
4. 检查网络请求成功 / 失败
5. 截图存到 `docs/qa/cleanup-baseline-2026-07-19/{screen}.png`

**Step 3 完成后**：这一组截图作为**清理前基线**，清理后 Step 7 对比。
