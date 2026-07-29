# Sprint 6 Plan v2 — Full launch-ready sprint

**Baseline**: O18 (commit `a42cedf`)
**Target**: NZ App Store submission (9-10 月)
**No OTA during sprint. One (potentially few) EAS builds — user-explicit.**
**Two 4-eyes subagent reviews FAILED v1 — this v2 fixes:**
1. 30+ missing `now` items
2. STORE-02/05/10 wrongly deferred
3. External-dependency lead times ignored
4. 90h severely underestimated (real: 150-200h)
5. Operational readiness missing

Realistic scope: **~2 weeks (14 days) work, not 4 days**.

---

## O17 + O18 已完成清单 (v1 未标, 需要 verify 不是重做)

### Copy / 一致性 已完成
- MARK-01 (flag→cairn, 部分, batch 6 完成 tab 命名 Flags→Cairns 剩余)
- MARK-09 (Only me→Just me)
- MARK-10 (default type 统一 danger)
- SET-06 (clear track→reset memory)
- SET-08 + CROSS-07 (Māori 全去)
- CROSS-04 (sheet translateY 300)
- CROSS-06 (danger red 统一)
- CROSS-08 (walks→hikes)
- HOME-07 (Memory icon Map→Footprints)
- HIST-09 (date format + settings picker)
- FRI-08 (accept/reject hitSlop + a11y)
- FRI-09 (friend request 已存在/自己/未找到 handling)

### 户外核心 已完成
- HIKE-01 独立 Pause 按钮 (Hiking)
- RUN-01 独立 Pause 按钮 (Running)
- RUN-02 signal-lost chip
- HIKE-02 GPS 精度 chip
- RUN-07 Running stop 加 View activity detail

### 数据安全 已完成
- SAF-01 保存失败 Alert + Retry
- SAF-02 storage.setItem strict mode
- SAF-03 hydrate atomic mutex
- SAF-06 Resume 提示改进

### 搜索 + rename 已完成
- HIST-01 MapHistory 搜索框
- HIST-03 hike 改名 (inline pencil)

### O17 pre-完成 (背景 batch)
- iOS 权限文案清理
- ErrorBoundary 挂 App.tsx
- PressBtn a11y props 转发
- 各 password eye 按钮 hitSlop
- PlantScreen zoom/style/recenter a11y
- Paywall NZ$5.99
- 多处 error copy contextual

**共 ~60 项 O17/O18 已完成. Sprint 6 verify + 补齐, 不重做.**

---

## Sprint 6 v2 结构

### Day 0 (Sprint 启动前置, async 并行跑)

**外部依赖必须先启动 — 有刚性 24-48h 等待时间:**

| 任务 | 责任方 | Lead time | 检查方式 |
|---|---|---|---|
| 生成 Apple Sign In capability + provisioning profile 更新 | 你 (Apple Developer portal) | 立即生效 | Xcode/EAS build 时 verify |
| 生成 APNs Auth Key .p8 + 记录 Team ID / Key ID | 你 (Apple Developer > Keys) | 立即 | 记入后端 env |
| Google OAuth 客户端 ID (iOS bundle: com.yiiling.cairn) | 你 (Google Cloud Console) | 立即 | GoogleService-Info.plist |
| ASC 创建 subscription product: Cairn Founder Monthly NZ$5.99 | 你 (App Store Connect) | **24-48h 审核** | ASC 后台状态 |
| ASC sandbox tester 账号创建 | 你 (ASC > Users) | 立即 | sandbox 登录 |
| 部署 cairnapp.nz/privacy + /terms + /support 静态页 | 我 (nginx + Let's Encrypt) | 立即 | curl 200 |
| Sentry / crash reporting SDK 账号 | 你 (sentry.io 免费 tier) | 立即 | dashboard 收到 test event |

**Day 0 我不动代码, 只 (a) 部署 3 个静态页 + SSL, (b) 帮你确认 ASC 配置 checklist, (c) audit 现有后端 env 缺哪些 key.**

---

### Batch 6.1 — 前端零后端小改 (前端独立, 无 native rebuild)

估时 **8-10h**

- HOME-01 新用户首次给 Hiking 卡片 highlight + tooltip
- HOME-02 pending sync banner 可点展开
- HOME-03 Routes / Cairns 列表加刷新 icon
- HOME-04 周/月/年统计切换 (Home statsRow)
- HOME-05 Profile 展示 "已使用 X 天" (从 register 起, 前端本地算)
- HOME-06 离线状态全局 banner (顶部薄条)
- FRI-06 删掉 online 状态 + sharedMarkers 假字段
- MAP-01 图层切换 (地形/卫星, 前端 state, 无 mapbox 用量变化)
- MAP-06 marker 聚合 (supercluster + 视口 filter)
- MEM-04 零 hike memory 解释 empty state
- MEM-05 GPS 拒绝后 CTA (Linking.openSettings)
- MARK-02 MarkerDetailSheet ↔ MarkerDetailScreen 统一 (让 Sheet 补 permission chip + edit / delete + 公开 snapshot banner)
- SET-07 删账户流程无论邮件成功都登出 (fix in AUTH-01 batch)
- SET-02 Dark mode 开关 verify (nightMode 现在藏了, 打开 + verify 所有 color token 支持)
- HIST-02 MapHistory 完整过滤 (类型/时间/排序)
- HIST-08 离线灰卡改成可点手动同步
- ROUTE-07 Routes 列表搜索 (复用 HIST-01 pattern)
- SRCH-01 Friends 搜索
- MARK-08 举报流程加 24h 后跟进反馈 (前端 UI, 后端 batch 6.4)
- CROSS-01/02/03/05 (设计系统统一 — 大改动, 单独 sub-batch)

**4 eyes checkpoint**: batch 6.1 完工后 2 subagent 独立 review.

---

### Batch 6.2 — 分享 (前端截图 + 系统 share sheet)

估时 **6-8h**

- SHR-01 activity 卡片图 (地图轨迹 + 距离 + 时间, `react-native-view-shot` 生成)
- SHR-01 memory 地图截图 (mapbox map snapshot API)
- SHR-02 删掉 AuthScreen "GPX export" 承诺
- SHR-04 深链解析基础设施 (`cairn://route/xxx`, `cairn://cairn/xxx`) — target 深链数据需要 batch 6.4 后端支持, 6.2 先做深链解析 stub

**4 eyes checkpoint**.

---

### Batch 6.3 — Auth 后端 (App Store 硬需求 4 件套 + 邮件/JWT 基础设施)

估时 **20-24h**

**前置**: emailService.js 已存在 (Gmail SMTP), 需要新加模板 (password-reset, delete-confirm, delete-cancel, data-export)

**新后端 endpoint**:
- `POST /auth/logout` — blacklist JWT (JWT 加 jti + 检查表)
- `POST /auth/password-reset/request` — 发送 6 位 code 到 email
- `POST /auth/password-reset/verify` — code + 新密码 → 更新
- `DELETE /account` — 软删 + 发确认邮件 + 7 天 grace
- `POST /account/restore` — grace 期内可恢复
- `PATCH /auth/register` extend — 加 dateOfBirth field, <13 拒绝
- (`GET /auth/me` 已存在, 需扩展返 `deleted_at` for grace 检测)

**DB migration**:
```sql
ALTER TABLE users ADD COLUMN date_of_birth DATE NULL AFTER email;
ALTER TABLE users ADD COLUMN deleted_at DATETIME NULL, ADD INDEX idx_deleted_at (deleted_at);
CREATE TABLE token_blacklist (jti VARCHAR(64) PRIMARY KEY, user_id INT NOT NULL, expires_at DATETIME NOT NULL, INDEX idx_expires (expires_at));
CREATE TABLE password_reset_codes (id INT AUTO_INCREMENT PRIMARY KEY, email VARCHAR(255) NOT NULL, code VARCHAR(6) NOT NULL, expires_at DATETIME NOT NULL, used TINYINT DEFAULT 0, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, INDEX idx_email_code (email, code));
```

**JWT blacklist 策略**: 简单方案 = MySQL 表 + cron 清理 expired. 生产 API middleware 查表 (加 in-memory LRU 缓存 5 分钟).

**老用户 DOB 处理** (AUTH-06):
- 现有 users 表 DOB=NULL 老用户可以继续用
- 但登录后弹一次性 "补充生日" modal (不填不能 plant / friend, hike 不 block 因为已有数据)
- 新注册强制 DOB, <13 拒绝

**Cron**: 
- 每小时清 `deleted_at < NOW() - 7 days` 的 users
- 每小时清 `expires_at < NOW()` 的 blacklist / reset codes

**前端 UI**:
- AuthScreen 加 "Forgot password?" link + reset flow
- AuthScreen register 加 DOB field + validation
- AuthScreen 密码强度 meter (纯前端 zxcvbn 库)
- AuthScreen 6 格 OTP 组件 (替换单大输入框)
- SettingsScreen delete 流程去 mailto, 走真删 + 邮件确认
- SettingsScreen 登录后如果 deleted_at 非空, 弹 Restore modal
- SettingsScreen 徒步中登出警告
- authService.logout() 加 backend call

**4 eyes checkpoint**.

---

### Batch 6.4 — Friends + Profile (后端 + 前端)

估时 **12-16h**

**Friends**:
- FRI-01 delete friend 已有 endpoint verify (双向删)
- FRI-02 block:
  - `POST /friends/:id/block`
  - `DELETE /friends/:id/block`
  - `GET /friends/blocklist`
  - 好友请求接受选项加 "Block"
  - Settings 加 blocklist 管理
- FRI-04 profile card:
  - `GET /users/:id/profile-card` — returns { name, avatarInitials, hikeStats, memoryDisplay }
  - `PUT /users/me/profile-card` — updates memory_display_mode
  - 前端 ProfileScreen (自己的) + FriendProfileScreen (别人的, 点好友卡进入)
  - Memory display selector: country/global 二选一
- FRI-05 pending outbound:
  - `GET /friends/requests?scope=outbound` (现有 endpoint 加 scope query)
  - Friends tab 加 "Sent" section

**Profile 独立页 (PROF-01/02/03/04)**:
- 新 screen ProfileScreen (自己的, 不同于 FriendProfileScreen)
- PROF-01 独立 nav entry
- PROF-02 头像上传 (先做前端本地保存, backend upload 待 Batch 6.7)
- PROF-03 改显示名字 (backend PATCH /users/me/name)
- PROF-04 个人统计 (总里程 / 总徒步 / 总时长, 从 sessions 计算)

**Memory subscription**:
- MEM-03 单独退订: `DELETE /memory_subscriptions/:friendId` (verify 是否已存在)
- Memory 好友列表加 unsubscribe 按钮

**Marker report follow-up** (MARK-08):
- 后端加 admin review 表 (先只写 schema, admin UI 后期)
- 前端举报后弹 "Thanks — we'll review within 24 hours"
- 后台 cron 检查 report_count 超阈自动隐藏 marker

**Shares** (batch 6.2 SHR-01 routes/marks 部分):
- `POST /shares/route` — 分享路线给朋友
- `POST /shares/marker` — 分享 marker 给朋友
- `GET /shares/inbound` — 收到的分享
- `PUT /shares/:id/accept` / `PUT /shares/:id/reject`

**DB migration**:
```sql
CREATE TABLE friend_blocks (blocker_id INT NOT NULL, blocked_id INT NOT NULL, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (blocker_id, blocked_id));
CREATE TABLE user_profile_cards (user_id INT PRIMARY KEY, memory_display_mode ENUM('country','global') DEFAULT 'country', memory_country_code VARCHAR(2) DEFAULT 'NZ', updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP);
CREATE TABLE shares (id INT AUTO_INCREMENT PRIMARY KEY, from_user_id INT NOT NULL, to_user_id INT NOT NULL, kind ENUM('route','marker') NOT NULL, target_id INT NOT NULL, status ENUM('pending','accepted','rejected') DEFAULT 'pending', created_at DATETIME DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE marker_reports_review (marker_id INT NOT NULL, hidden_at DATETIME NULL, reviewed_at DATETIME NULL, action ENUM('none','hidden','removed') DEFAULT 'none', PRIMARY KEY (marker_id));
```

**4 eyes checkpoint**.

---

### Batch 6.5 — Push notification (native rebuild 需求)

估时 **12-16h**

**前置 (Day 0 已做)**: APNs Auth Key .p8 生成 + Firebase Admin SDK setup

**后端**:
- `POST /push/register-token` — 客户端上报 device token
- `DELETE /push/register-token` — logout 时清除
- 触发点:
  - Friend request 创建 → 推送给 to_user
  - Share (route/marker) 创建 → 推送给 to_user
  - Marker liked → 推送给 marker owner (可选, 频率控制)
  - Auto-pause detection → 推送给自己 (已有代码, PUSH-04 加权限检查)
- 后端集成: Firebase Admin SDK (支持 APNs + FCM)

**前端**:
- app.json 加 `expo-notifications` capability + entitlements
- 注册 push token on login (registerDeviceTokenAsync)
- 通知 tap handler (深链跳转到相应页面)
- PUSH-02 Settings 加 "Notifications" 列表 (最近 30 天 in-app)
- PUSH-03 App icon badge (未读通知计数)
- PUSH-04 auto-pause 前检查 permission

**DB migration**:
```sql
CREATE TABLE push_tokens (user_id INT NOT NULL, token VARCHAR(255) NOT NULL, platform ENUM('ios','android') NOT NULL, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (user_id, token));
CREATE TABLE notifications (id INT AUTO_INCREMENT PRIMARY KEY, user_id INT NOT NULL, kind VARCHAR(32) NOT NULL, payload JSON, read_at DATETIME NULL, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, INDEX idx_user_created (user_id, created_at));
```

**4 eyes checkpoint**.

---

### Batch 6.6 — Apple + Google 登录 (native rebuild 需求)

估时 **10-12h**

**前置 (Day 0 已做)**: Apple Sign In capability + Google OAuth client ID

- AUTH-02 `expo-apple-authentication` full integration
  - AuthScreen Apple button 真实 flow
  - 后端 `POST /auth/apple` verify identity token (jwks.apple.com)
  - 创建 users 表新用户或关联现有 email
- AUTH-03 `@react-native-google-signin/google-signin` (或 expo-auth-session)
  - GoogleService-Info.plist 配置
  - 后端 `POST /auth/google` verify id_token (已存在 stub, 填实)

**注意**: sprint 计划最后一次 build, native module 会装. Plan v1 中的 "degrade 路径" 删除 — 不需要.

**4 eyes checkpoint**.

---

### Batch 6.7 — Safety 剩余 + GDPR + Storage 整理

估时 **8-10h**

- SAF-04 Cellular / Wi-Fi 检测 (NetInfo) → 遥测尊重 telemetryWifiOnly
- SAF-05 存储 key 整理 (dead migration 检查 + 统一 storage 层 wrap)
- SET-01 GDPR data export:
  - `GET /account/export` — 后端打包 zip (sessions + markers + memory + friends) → 发送邮件下载链接
  - Settings 加 "Download my data" 按钮
- Photo upload backend (为 PROF-02 头像):
  - `POST /users/me/avatar` (multipart, 存 S3 or backend static)
  - 简化: 存 backend `/uploads/avatars/`

**4 eyes checkpoint**.

---

### Batch 6.8 — IAP (真订阅)

估时 **16-20h** — **提前到 Batch 6.3/6.4 后并行, 因为 ASC subscription approval 需要 24-48h**

**前置 (Day 0 已启动)**: ASC subscription product 建立 + 提审

- IAP-01 RevenueCat SDK 集成
  - `react-native-purchases` npm install
  - 初始化 RevenueCat API key
  - PaywallSheet 接真订阅 (点 Subscribe → RC purchase flow)
- IAP-02 Restore purchases 按钮
- IAP-03 
  - 年费 tier (Annual NZ$59.99) — ASC 加 product
  - 试用: 7 days free trial (introductory offer)
  - 促销码: RevenueCat entitlements

**后端**:
- `POST /iap/webhook` — App Store Server-to-Server notifications
- `GET /me/subscription` — 查用户订阅状态
- Redis / MySQL 缓存 entitlement (避免每次 API 都问 RC)

**4 eyes checkpoint**.

---

### Batch 6.9 — 无障碍 + verify + 收尾

估时 **6-8h**

- A11Y-01 Dynamic Type: 全局 Text 组件默认 allowFontScaling + 测试 XXL 布局
- A11Y-02 VoiceOver: 剩余屏加 accessibilityLabel (Memory / Friends / Settings / Marker Detail 全扫)
- A11Y-03 44pt hitSlop 剩余小按钮全扫
- A11Y-05 触觉反馈开关: verify hapticFeedback 被所有 haptic.* 调用尊重
- HIKE-06 日落预警 (计算日落时间 + 提前 30min push, 复用 Push batch)
- HIKE-04 徒步中加快速备注 (skip, 你 note = skip)
- HIST-05 hike 导出 (skip)
- CROSS-01/02/03/05 大重构 (统一 Toast/EmptyState/marker-type-registry) — 只做 CROSS-01 (Toast 组件, 迁移 12+ 处 Alert), 其他保留到下 sprint
- VER-01~07 verify 项 (真机 build 后)

**4 eyes checkpoint**.

---

### Batch 6.10 — App Store 提交素材 (**must in scope**)

估时 **12-16h**

- STORE-01 App icon 1024x1024 验证 (Preview 检查 alpha/圆角) + 修补
- STORE-02 商店截图 (iPhone 6.7 + 5.5 各 3-10 张, Simulator 生成)
- STORE-03 描述文案:
  - App Name (30 char), Subtitle (30 char), Description (4000 char), Keywords (100 char)
  - 我写 draft 你审
- STORE-04 隐私营养标签文档 (`docs/store-listing/privacy-nutrition.md`)
- STORE-05 TestFlight external group 配置 (ASC 后台)
- STORE-06 年龄评级填写
- STORE-07 客服邮箱 (support@cairnapp.nz auto-responder) + URL 200 verify
- STORE-08 EAS staged rollout 5% 配置 (eas.json)
- STORE-09 服务条款 / EULA
  - draft 内容 (借鉴 AllTrails/Strava, 由你审)
  - 部署到 cairnapp.nz/terms (Day 0)
- STORE-10 封闭 dogfood 至少 1 轮 (你 + 3-5 朋友装 TestFlight, 我协助)

**4 eyes checkpoint**.

---

### Batch 6.11 — 运营准备 (**新增**)

估时 **6-8h**

- Sentry / crash reporting SDK 前端集成
- App Store review demo account seed (`reviewer@cairnapp.nz`, 密码写 ASC 提交表单)
- Feature flag / kill switch 系统 (简版: remote config JSON in backend, 前端 App boot 拉取)
- FAQ 静态页 (cairnapp.nz/faq) — 常见 5-10 问题
- support@cairnapp.nz auto-responder (SMTP forward + template)
- Post-launch monitoring dashboard (可选 — Grafana / 手动 SQL)

**4 eyes checkpoint**.

---

### Batch 6.12 — 全 sprint 最终 4 eyes + build

- 2 独立 subagent 读全部 sprint diff → find blocker / regression
- Playwright 关键 flow: login → hike → save → plant cairn → friend → settings → memory
- Backend integration test suite (所有新 endpoint 真 API + 真 DB)
- 你允许后 → EAS build → 装 TestFlight → 你真机全流程验证
- verify PASS → 提交 App Store review

---

## Realistic Timeline

| Phase | 估时 |
|---|---|
| Day 0 async 外部依赖 (你启动) | 24-48h wallclock (async) |
| Batch 6.1 前端零后端 | 8-10h |
| Batch 6.2 分享 | 6-8h |
| Batch 6.3 Auth 4 件套 | 20-24h |
| Batch 6.4 Friends + Profile | 12-16h |
| Batch 6.5 Push | 12-16h |
| Batch 6.6 Apple/Google | 10-12h |
| Batch 6.7 Safety + GDPR | 8-10h |
| Batch 6.8 IAP | 16-20h |
| Batch 6.9 无障碍 + 收尾 | 6-8h |
| Batch 6.10 素材 | 12-16h |
| Batch 6.11 运营准备 | 6-8h |
| Batch 6.12 最终 verify + build | 8-12h |
| **合计** | **~140-170h ≈ 12-14 days** |

不停歇 8h/day = **17-21 天 (约 2-3 周)**. 建议接受 2 周 timeline.

---

## Skipped (per your decisions)

- HIST-04 事后 plant cairn
- HIST-05/06/07 hike 导出/可见性/对比
- MARK-03 cairn 加照片
- MARK-04/05/06/07 语音/导航/点赞列表/评论
- SET-03 语言切换 (later)
- SET-04 区域切换
- MAP-03 3D 地形
- MAP-04 地图搜索
- ROUTE-02/03/04/05 路线相关
- MEM-01/02 memory 分享/时间轴 (memory 分享走 SHR-01 截图)
- FRI-03/07 用户搜索 / 实时位置共享
- SAF-07 紧急 SOS
- SHR-03 CSV/JSON 导出 (可合并 SET-01 GDPR)
- CROSS-02/03/05 (下 sprint 做设计系统统一)

---

## 开工前 checklist

1. ✅ 邮件基础设施存在 (nodemailer + Gmail)
2. ❌ Crash reporting SDK 未接 (batch 6.11 加 Sentry)
3. ✅ 后端 auth/friends/markers/sessions routes 已存在
4. ⏳ Day 0 外部依赖你启动 (Apple/Google/APNs/ASC subscription)
5. ⏳ 你审 plan v2 → 说 "开始 Day 0" 或 "开始 batch 6.1"

---

## 铁律 (Sprint 6 全程)

- 无 OTA
- EAS build 你 explicit 允许才做, 不浪费 (但有额度)
- 4 eyes 每 batch 完 review 一次 (小 batch, 高频)
- 全验证: 后端 integration test (真 aliyun DB), 前端 tsc + Playwright 关键 flow
- Subagent "100% verified" → 独立 subagent#2 反驳
- Dev tool 删数据 → DRY-RUN + 二次 confirm
- 每一行代码有作用 (unused code 探根因, 禁批量删)
- 命名/结构不擅自改 (v414 教训)
- 数据入库前对比 + 入库后清理
- 100% log 覆盖 (dev 功能开发中, 完工统一删)
