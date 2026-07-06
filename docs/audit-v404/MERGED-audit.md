# Cairn v404 全局功能体检 — 合并盘点（A + B 双 subagent 交叉验证）

**日期**: 2026-07-06 (v404 OTA 后)
**方法**: Agent A (代码 + DB 抽查 + PROJECT_STATE) + Agent B (用户视角 + PRD 对账)。**两 agent 独立跑，事后合并**。
**交叉验证原则**: A+B 都发现 = 铁证；只 A 或只 B 提到 = 独立发现（仍收录，只要证据在）。

---

## 🔴 A+B 双证 · 最高置信度不足（Priority 1 修复）

这些是 A 和 B **都独立发现的**，两条证据链交叉验证，几乎无争议。

### 1. SOS 链路完全空壳 — 户外救命功能名存实亡
- **组件孤儿**: `SOSButton.tsx` 存在，`sosService.ts` 存在，但 Grep `<SOSButton|<SOSFab` 全 app 0 命中
- **Settings 断链**: "Emergency Contacts" 是 stub Alert（`SettingsScreen.tsx:565-567`），"Broadcast Interval" 是 stub（`SettingsScreen.tsx:617`）
- **PROJECT_STATE 谎报**: Sprint 47/48/53 声明 SOS/HikingScreen SOS Done
- **产品定位破功**: Cairn 卖点之一是"户外 safety tool"，装了 app 出险按不出 SOS
- **修复动作**: HikingScreen 挂 SOSButton + SettingsScreen 补 EmergencyContactsSheet + Broadcast Interval Picker → 全链路 web 模拟 + 真机验证

### 2. Friend System v1 主账户空壳
- **数据孤儿**: user_id=4 有 5 条 `friend_requests` status='accepted'，但 `friends` 表 0 行（accept 逻辑写在 F1 之后，老数据没触发 bidirectional insert）
- **屏幕效应**: MapScreen Friend markers 空 / RoutesScreen Friends tab 空 / FriendsScreen 列表空 / MemoryScreen Friends fog 空
- **iPhone gate 未过**: Sprint 71 STORY-545 真机审 + STORY-546 fog UNION FPS + STORY-547 5-friend perf 全 "Cannot run in current workflow env"
- **修复动作**: (1) SQL 补齐 `friends` 表 bidirectional 行 (2) `loadCircleFog` + `loadStrangerPublicBbox` 实装 (3) iPhone 真机跑一遍 F1-F4 全屏审

### 3. Memory 解雾 = 项目最不稳核心（v383→v404 修 9+ 版）
- v394 self-plant 强制 revealed / v395 SVG 合一 / v396 bypass cull / v397 telemetry / v398 uuid polyfill / v399 二分定位 / v400 根因修 / v401 hydrate 保留 unsynced / v404 finalize 真传 snapped
- 每 2 周破一次，用户 telemetry 大量 slow-banner
- **修复动作**: 双 subagent 独立 review 现 recordPoint→FogLayer→memory_points push 全链路，找**根根因**而不是继续打补丁

### 4. Elevation 数据全表 = 0
- DB: `SELECT DISTINCT elevation_gain_m FROM routes` = 0，sessions 表甚至没 elevation 列
- UI: Activity Detail 永远显示 "+0m elevation"（`MapHistoryScreen.tsx:519,922,1002`）
- **修复动作**: expo-location altitude 字段接入 recordPoint + DB migration 加 sessions.elevation_gain_m 列 + 前端展示打通

---

## 🟠 单 agent 发现但证据硬 · 次高优先级

### 5. voiceService + NavigationController 孤儿（Agent B）
- Grep `voiceService` 在 screens/services (除自身) 0 消费者
- Grep `NavigationController` in HikingScreen/RunningScreen 无匹配
- 用户戴耳机跑山永远听不到偏离提醒 — PRD2 E-008 承诺完全破功
- **修复动作**: 定夺 — 要么挂上 HikingScreen（Sprint 46-48 补完），要么删 module（"零消费者代码 = 未来 bug 温床"）

### 6. PRD3 NZ 本土化交付率 <30%（Agent B）
- E-012 字体 ✓ / E-019 插画 ✓
- E-013 Cairn Topo Mapbox style 未激活（`CAIRN_TOPO_STYLE_URL` 仅定义处）
- E-014 "Nau mai, haere mai" 零命中 + cultural-consultation.md 不存在（release blocker）
- E-016 warning 色仍 `#b36b00`，非 DOC 橙 `#F26522`
- E-017 "Active now"/"Last active Xh ago" 硬编码 "Online"
- E-018 "trail" 未替换为 "track"
- **修复动作**: 一次 Sprint 集中收 PRD3 全部剩余项，走 web Playwright 视觉对账

### 7. "Plan Route" 死链（Agent A）
- `MapHistoryScreen.tsx:964` `Alert('Plan Route', 'Route planning coming soon')`
- **修复动作**: 要么打通到 RouteEditor，要么改文案（暂时不敢承诺）

### 8. "Your tracks stay on this device" 隐私文案与实际数据流冲突（Agent A）
- Auth 文案（Sprint 72 STORY-556）+ AuthScreen 底部承诺 "stay on device"
- 实际 sessions 全量同步 aliyun MySQL（`122.51.174.118`, `cairn` db, 191 条 sessions rows）
- 一旦有用户查隐私协议对不上会翻车
- **修复动作**: 改文案 → "Sign in to sync activity across devices"（实事求是）

### 9. Old sessions route_points_raw = NULL（Agent A+B 都提及）
- session 183-187 raw_count=NULL（v402 前的 seed）
- v404 finalize 修复后新 session 有 raw，但老数据没回填
- MapHistoryScreen 打开老 activity 无原始轨迹叠图
- **修复动作**: 一次性 SQL migration，raw IS NULL 时用 route_points 兜底填入

### 10. RouteEditor 缺 trim + midpoint drag（Agent B）
- STORY-00519/00520 Status = Deferred (Sprint 66)
- 用户路线画错一段只能重画
- **修复动作**: 从 Deferred 复活进 Sprint 73/74

---

## 🟡 P2 · 明显缺陷但不阻塞

- **[Agent A]** TrailsScreen.tsx 是 dead code（RootNavigator 用 RoutesScreen 承载）
- **[Agent A]** Kia ora 问候只覆盖 5-12 点，下午/晚上无 Te Reo
- **[Agent A]** MapBottomPanel 不 auto-refresh markers 变动
- **[Agent A]** OfflineMapSheet 存在但 Settings 无入口
- **[Agent A]** helpful_count / report_count / status='hidden' schema 有 UI 侧不读
- **[Agent A]** PaywallSheet 硬编码 'Coming soon'（v1 明确 no IAP，但公开发布需要）
- **[Agent A]** shareGPX / sharePDF import 存在但无 UI 入口（Export 死码）
- **[Agent A]** RouteEditor Save 后 reset 到 Home，用户失去返回浏览刚存 route
- **[Agent A]** ARScreenV2 `cairnType: 'cairn'` hardcode（选 danger/water 都变石堆）
- **[Agent A]** MarkerDetailScreen photo upload 承诺 v1.1（架构已有 photoUrls）
- **[Agent B]** GPX 只 export 无 import — AllTrails/Komoot 用户迁移路线不可能
- **[Agent B]** Route "来自XXX" 归属标签未实现
- **[Agent B]** MarkerDetailScreen "首次发现 halo" 未实现（PRD3 E-015）
- **[Agent B]** Explorer/Navigator 差异 UI 无解释
- **[Agent B]** Trip Sharing overdue 通知未实现（纯 UI toggle）
- **[Agent B]** UI 仍能选 permission='public' 但 backend H1 直接 400 静默失败
- **[Agent B]** email 前端验证被 v378 临时注释关掉未恢复
- **[Agent A]** module-level state (`_lastKnownCoord`, tracking watcher) 在 logout 不 reset

---

## 📊 修复优先级排序 · 供你 Sprint 73 挑

| # | 项目 | 双证? | 影响面 | 修复量 | 建议 |
|---|---|---|---|---|---|
| 1 | SOS 链路挂载 | A+B | 产品定位破功 | 中（挂组件 + Emergency Contacts sheet + Interval picker） | **Sprint 73 P0** |
| 2 | Friend v1 主账户 SQL 补 + 真机审 | A+B | 4 个 tab 空壳 | 小 SQL + 大真机审 | **Sprint 73 P0** |
| 3 | Memory 解雾根因 review（不是继续打补丁） | A+B | 灵魂功能不稳 | 大（需 spike） | **Sprint 73 P1** |
| 4 | Elevation 采集 + DB migration + UI | A+B | 数据专业度 | 中 | **Sprint 74** |
| 5 | voiceService / NavigationController 定夺 | B | Broadcast E-008 破功 | 中或删 | **Sprint 73/74** |
| 6 | PRD3 NZ 本土化集中收（<30% → 90%） | B | App Store 差评核心 + release blocker | 中（大部分是文案+色） | **Sprint 74** |
| 7 | Plan Route 死链 | A | 明显 UX bug | 小（改文案 or 打通） | **v405 hotfix** |
| 8 | "stay on this device" 隐私文案 | A | 法律风险 | 极小（改一行） | **v405 hotfix** |
| 9 | old sessions raw 回填 SQL | A+B | 老数据修复 | 极小 | **v405 hotfix** |
| 10 | RouteEditor trim + midpoint drag | B | 编辑体验 | 中 | **Sprint 74** |

---

## 🎯 我的推荐

**v405 hotfix（1 天内可推）**:
- Plan Route 死链改文案
- "stay on this device" 文案改为 "Sign in to sync"
- old sessions raw_points 回填 SQL（一条 update）

**Sprint 73（3-5 天）**:
- SOS 链路全挂上（HikingScreen SOSButton + Emergency Contacts sheet + Broadcast Interval picker）
- Friend v1 主账户 SQL 补 `friends` 表 + loadCircleFog 实装

**Sprint 74（5-7 天）**:
- PRD3 NZ 本土化集中收（cultural-consultation.md 建立 + "Nau mai, haere mai" + DOC 橙 + Active now 等）
- Elevation 采集
- voiceService/NavigationController 定夺（挂或删）

**iPhone gate（等你有真机时间）**:
- Sprint 71 F5 三个 story（真机审 + fog UNION FPS + 5-friend perf）
- 也把新加的 SOS + Friend 补丁在真机复审一遍

---

## 详细报告存档

- `docs/audit-v404/agent-a-report.md` — Agent A 全文（代码路径 + DB 抽查角度）
- `docs/audit-v404/agent-b-report.md` — Agent B 全文（用户视角 + PRD 对账角度）
- 本文件 = 合并盘点，去重后总条数约 40 条
