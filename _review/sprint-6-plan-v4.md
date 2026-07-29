# Sprint 6 Plan v4 — Code Completion Sprint (final)

**Delta from v3**: 修 reviewer #2 (完整性视角) 指出的 3 大方向硬伤:
1. Backend deploy 流程明确 (每 batch 后 deploy 到 aliyun)
2. Pre-Build 关卡 (native module 首次集成前先 dev build 验证)
3. IAP 3 前置 async 启动 (ASC 商品 + RC + Sandbox tester, 你手动)

其他 subagent#1 指出的 batch 工作量低估 = 开发中调整.

**Baseline**: O18 (commit `a42cedf`)
**Scope**: 代码 sprint (不含 STORE 素材 / 律师 / 上线运营 / 跨境迁移)
**Deliverable**: 代码全实装 + 一次 EAS build + 你 TestFlight 真机验证
**Realistic timeline**: 180-220h ≈ 22-26 天 (含 native rebuild + deploy)

---

## v4 三大修复

### 1. Backend deploy 策略 (每 batch 后 deploy)

**流程**:
- 我本地写代码 → 本地 tsc + node -c → local unit test
- git commit + push to 我的 backend repo
- SSH aliyun → `cd /root/cairn-backend && git pull && docker-compose build && docker-compose up -d`
- Health check: `curl https://api.yiiling.cn/api/health` 200 OK
- Playwright 端到端: 用 web 前端 (Metro dev server) 打新 endpoint 真 API

**DB migration**:
- 每个 migration 文件放 `backend/src/migrations/YYYYMMDD-name.sql`
- 部署前 SSH 到 aliyun 手工跑: `docker exec ainews-db mysql -uroot -p... cairn < migration.sql`
- **DRY-RUN 铁律**: 每个 migration 先 `EXPLAIN` + 备份表 → 确认无误再跑
- Rollback SQL 也写好 (down migration), 存 `backend/src/migrations/rollback/`

**部署顺序**:
- Batch 6.3 (Auth) 完 → deploy → 前端接口 verify
- Batch 6.4 (Friends+Profile) 完 → deploy
- Batch 6.5 (Push) 完 → deploy
- Batch 6.7 (GDPR) 完 → deploy
- Batch 6.8 (IAP webhook) 完 → deploy

其他 batch 只改前端, 不 deploy.

---

### 2. Pre-Build 关卡 (Batch 6.10 — 新增, 原 6.10 被 skip 到 S7)

**触发**: Batch 6.6 (Apple/Google) 完成后, 在 6.7/6.8 之前

**步骤**:
1. `eas build --profile development --platform ios` (**dev build, 不是 production**)
2. 装到你 iPhone (TestFlight 或 Ad-Hoc)
3. 你 (或我远程带你) 走一遍:
   - Apple Sign In 按钮点了不 crash + 完整 flow
   - Google Sign In 按钮点了不 crash + 完整 flow
   - Push 通知能收到 (从后端触发 test)
- 发现 native module 层 bug → 修 → 再 dev build (你决定是否值得)
- Native 层 OK 后, Sprint 结束再做 production build

**成本**: 多 1-2 次 dev build. 用户允许多次 build (本月额度够).

---

### 3. IAP 3 前置 async (Day 0 章节, 你手动)

**位置**: `C:\ClaudeCodeProjects\Cairn\_review\asc-revenuecat-setup.md` (已写好步骤)

**你 async 做** (今天/明天, 30-60 分钟):
- ASC 建订阅商品 `cairn.premium.monthly` (NZ$5.99) + 提交审核 (24-48h)
- (可选) 年费 `cairn.premium.yearly` (NZ$59.99)
- ASC 建 Sandbox tester 账号
- RevenueCat 注册 + 配置 offering + 拿 public API key 给我
- (RC webhook 我后端建完后你回来加)

**我 async 做** (你建 ASC 时): 修 plan v4 完 + 开工 B6.0 Onboarding

**B6.8 IAP 前置 gate check**:
- ✅ ASC 商品 approved (24-48h 后)
- ✅ RC offering 配置好
- ✅ RC public API key 我有
- ✅ Sandbox tester 账号建了

3 项 ✅ 才开 B6.8. 否则 B6.8 只能 mock 测.

---

## Batch 划分 (v3 保留, 加 Pre-Build 6.10)

### 前置 (你 async 启动)
- ASC 建订阅商品 → 24-48h Apple 审核
- RevenueCat 注册 + 配置
- 我 async 修 plan + 开工 B6.0

---

### Batch 6.0 — Onboarding (8-10h)
- ONB-01 首次引导 3-4 屏 (类似 memory 一次性)
- ONB-02 GPS 权限解释屏 (集成到 memory 引导)
- ONB-04 拒 GPS 后每次功能弹提示

**4 eyes checkpoint**.

---

### Batch 6.1a — 前端小改 state / copy (6-8h)
- HOME-02 pending sync 可点手动同步
- HOME-03 Routes/Cairns 加刷新 icon
- HOME-04 周/月/年统计
- HOME-05 Profile 显示 "已使用 X 天"
- HOME-06 离线全局 banner
- FRI-06 删假字段 (online/sharedMarkers)
- MEM-04 零 hike memory 解释
- MEM-05 GPS 拒绝后 CTA
- SET-02 dark mode verify
- ROUTE-09 收藏 (前端本地 flag)
- VER-05 PlantScreen/RouteEditor 后端 message 丢失 (真 bug fix, 映射错误代码)
- VER-06 dev screen "Delete this mark?" 一处
- VER-07 MapHistory 标题不居中 (布局微调)

**4 eyes checkpoint**.

---

### Batch 6.1b — Map + 路线 (6-8h)
- MAP-01 图层切换 (地形/卫星)
- MAP-06 marker 聚合 (supercluster)
- ROUTE-07 路线搜索
- ROUTE-08 路线离线下载 (前端 UI, backend offlineMap 已有)

**4 eyes checkpoint**.

---

### Batch 6.1c — MarkerDetail 统一 (4-6h)
- MARK-02 Sheet ↔ Screen 统一 (Sheet 补 permission chip + edit / delete + snapshot banner)

**4 eyes checkpoint**.

---

### Batch 6.1d — Hiking/Running 补齐 (6-8h)
- HIKE-03 偏离路线提示
- HIKE-07 1km 自动打点
- RUN-03 跑步指南针 (统计 bar 挤爆则调)
- **RUN-04 Live Activity — 单独决策**: iOS ActivityKit 2-3 天工作量, plan 中标注 "**可能推 S7, 待用户拍板**"
- RUN-05 配速目标
- RUN-06 锁屏解锁 500ms→700ms

**4 eyes checkpoint**.

---

### Batch 6.1e — History 补齐 (4-6h)
- HIST-02 完整过滤 (日期/类型/排序)
- HIST-08 离线灰卡手动同步

**4 eyes checkpoint**.

---

### Batch 6.2 — 分享 (6-8h)
- SHR-01 activity 卡片图 (react-native-view-shot)
- SHR-01 memory 截图 (mapbox map snapshot)
- SHR-02 删 AuthScreen GPX 承诺一句
- SRCH-01 Friends 搜索 (前端 filter)

**4 eyes checkpoint**.

---

### Batch 6.3 — Auth 后端 4 件套 + 补齐 (24-30h — 上调, subagent 反馈)

**后端新 endpoint**:
- `POST /auth/logout` — JWT blacklist
- `POST /auth/password-reset/request` — 发 6 位 code
- `POST /auth/password-reset/verify` — code + 新密码 → 更新
- `DELETE /account` — 软删 + 7 天 grace
- `POST /account/restore` — grace 期内恢复
- `PATCH /auth/register` — 加 dateOfBirth field

**DB migration**:
```sql
ALTER TABLE users ADD COLUMN date_of_birth DATE NULL AFTER email;
ALTER TABLE users ADD COLUMN deleted_at DATETIME NULL, ADD INDEX idx_deleted_at (deleted_at);
CREATE TABLE token_blacklist (jti VARCHAR(64) PRIMARY KEY, user_id INT NOT NULL, expires_at DATETIME NOT NULL, INDEX idx_expires (expires_at));
CREATE TABLE password_reset_codes (id INT AUTO_INCREMENT PRIMARY KEY, email VARCHAR(255) NOT NULL, code VARCHAR(6) NOT NULL, expires_at DATETIME NOT NULL, used TINYINT DEFAULT 0, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, INDEX idx_email_code (email, code));
```

**JWT blacklist 策略**: MySQL 表 + in-memory LRU 5 分钟 (dev 环境接受 5min 生效延迟)

**AUTH-06 DOB 策略**:
- 新注册: 强制 DOB, `<13` 拒
- 老用户: 下次登录弹 blocking modal 补录 (30 天 grace 期), grace 后强制补录才能进 App
- Grace 起点: user record 创建于 `deployed_at` 前 = 老用户

**Emails** (nodemailer + Gmail 已存在, 加 templates):
- password reset code
- delete account confirmation
- data export download link (Batch 6.7)

**Restore UX**:
- 用户被删账户后 7 天内登录 → App 显示 "Your account is scheduled for deletion. Restore?" → 点 Restore → API 恢复 → 正常登录

**前端 UI**:
- AuthScreen 加 "Forgot password?" link + 3 步 flow (输邮箱 → 输 code → 输新密码)
- AuthScreen register 加 DOB field + validation
- AuthScreen 密码强度 meter (zxcvbn)
- AuthScreen 6 格 OTP 组件
- SettingsScreen delete 流程 (去 mailto, 走真删)
- SettingsScreen 登录后如果 deleted_at 非空, 弹 Restore modal
- SettingsScreen 徒步中登出警告
- authService.logout() 加后端调用

**Deploy after 6.3**.

**4 eyes checkpoint**.

---

### Batch 6.4 — Friends + Profile + Share (28-36h — 上调)

**后端**:
- FRI-01 verify existing `DELETE /friends/:id`
- FRI-02 block:
  - `POST /friends/:id/block`
  - `DELETE /friends/:id/block`
  - `GET /friends/blocklist`
- FRI-04 profile card:
  - `GET /users/:id/profile-card`
  - `PUT /users/me/profile-card`
- FRI-05 pending outbound: `GET /friends/requests?scope=outbound`
- MEM-03 单独退订: `DELETE /memory_subscriptions/:friendId`
- MARK-08 admin review:
  - `POST /markers/:id/report` (verify existing, 加 count)
  - Cron: 3 reports/24h/不同用户 → auto-hide + email marker owner
  - `GET /reports/pending` (admin, S7 用)
  - `POST /reports/:id/appeal` (被隐藏 owner 申诉)
- PROF-03 `PATCH /users/me/name`
- SHR-01 routes/marks:
  - `POST /shares/route`, `POST /shares/marker`
  - `GET /shares/inbound`, `GET /shares/outbound`
  - `PUT /shares/:id/accept`, `PUT /shares/:id/reject`

**DB migration**:
```sql
CREATE TABLE friend_blocks (blocker_id INT NOT NULL, blocked_id INT NOT NULL, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (blocker_id, blocked_id));
CREATE TABLE user_profile_cards (user_id INT PRIMARY KEY, memory_display_mode ENUM('country','global') DEFAULT 'country', memory_country_code VARCHAR(2) DEFAULT 'NZ', updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP);
CREATE TABLE shares (id INT AUTO_INCREMENT PRIMARY KEY, from_user_id INT NOT NULL, to_user_id INT NOT NULL, kind ENUM('route','marker') NOT NULL, target_id INT NOT NULL, status ENUM('pending','accepted','rejected') DEFAULT 'pending', created_at DATETIME DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE marker_reports (id INT AUTO_INCREMENT PRIMARY KEY, marker_id INT NOT NULL, reporter_id INT NOT NULL, reason ENUM('fake_ad','info_mismatch','dislike') NOT NULL, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, INDEX idx_marker (marker_id));
ALTER TABLE markers ADD COLUMN hidden_at DATETIME NULL, ADD INDEX idx_hidden (hidden_at);
```

**前端**:
- FriendsScreen 加 block 按钮
- Settings 加 blocklist 管理
- FriendProfileScreen 新页 (点朋友卡进入)
- **PROF-01 决策**: Profile 通过 Settings 里 "编辑我的资料" 入口跳 FriendProfileScreen(self) — 自己看自己. UX 简洁. **待你 5 秒确认**.
- FriendsScreen 加 "Sent" tab (pending outbound)
- Memory 列表加单独退订按钮
- Marker举报后弹 "Thanks — we'll review within 24 hours"
- SettingsScreen 加改名字 UI
- Share endpoint 前端接线 + 深链 dispatch (SHR-04 一起)

**Deploy after 6.4**.

**4 eyes checkpoint**.

---

### Batch 6.5 — Push (12-16h)

**前置**: 你需要生成 APNs Auth Key .p8 (Apple Developer Portal → Keys → +) + 上传 RC 或 Firebase

**后端**:
- `POST /push/register-token` (client 上报 device token)
- `DELETE /push/register-token` (logout 清)
- 触发点集成:
  - Friend request → push to_user
  - Share (route/marker) → push to_user
- 用 Firebase Admin SDK (支持 APNs + FCM)

**前端**:
- `expo-notifications` register token + save server
- notification tap handler + deep link dispatch (依赖 SHR-04 深链解析)
- PUSH-02 Settings 通知列表 (最近 30 天 in-app)
- PUSH-04 auto-pause 前检查 permission
- SET-05 通知偏好 (in Settings — enable/disable friend requests / shares)

**DB migration**:
```sql
CREATE TABLE push_tokens (user_id INT NOT NULL, token VARCHAR(255) NOT NULL, platform ENUM('ios','android') NOT NULL, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (user_id, token));
CREATE TABLE notifications (id INT AUTO_INCREMENT PRIMARY KEY, user_id INT NOT NULL, kind VARCHAR(32) NOT NULL, payload JSON, read_at DATETIME NULL, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, INDEX idx_user_created (user_id, created_at));
```

**Deploy after 6.5**.

**4 eyes checkpoint**.

---

### Batch 6.6 — Apple + Google 登录 (10-12h)

**前置**: 你需要:
1. Apple Developer Portal → Certificates, Identifiers & Profiles → 你的 App ID → Enable "Sign In with Apple" capability
2. Provisioning Profile 更新 (EAS build 会自动 pull)
3. Google Cloud Console: OAuth 2.0 Client ID (iOS bundle: `com.yiiling.cairn`)
4. GoogleService-Info.plist 放 `app/ios/` (EAS build 会 pick up)

**代码**:
- AUTH-02: `expo-apple-authentication` full integration
  - AuthScreen Apple button 真实 flow
  - 后端 `POST /auth/apple` verify identity token (jwks.apple.com)
- AUTH-03: `@react-native-google-signin/google-signin` 或 `expo-auth-session`
  - 后端 `POST /auth/google` verify id_token

**⚠️ 一次 build 铁律 危险信号**: native module 首次集成. 见 Batch 6.10 Pre-Build 关卡.

**4 eyes checkpoint**.

---

### Batch 6.7 — GDPR + Safety 剩余 (8-10h)

- SET-01 GDPR data export:
  - Backend zip (sessions + markers + memory + friends) → 存 `/uploads/exports/{token}.zip`
  - 邮件发下载链接 (7 天 expire)
  - Settings 加 "Download my data" 按钮 + rate limit 1/day
- SAF-04 cellular / wifi 区分 (NetInfo)
- SAF-05 存储 key 整理 (dead migration audit)

**Deploy after 6.7**.

**4 eyes checkpoint**.

---

### Batch 6.8 — IAP (16-20h) — **依赖 ASC approved**

**前置 gate**:
- ✅ ASC 商品 `cairn.premium.monthly` approved (async 已启动)
- ✅ RC public API key
- ✅ Sandbox tester 账号

**代码**:
- `react-native-purchases` npm install
- 初始化 RC SDK
- PaywallSheet 接真订阅 (点 Subscribe → `Purchases.purchasePackage`)
- IAP-02 Restore purchases 按钮 (Settings + Paywall 两处)
- IAP-03:
  - 年费 tier (Annual NZ$59.99) — 前端加 package 选项
  - 试用: 7 days free trial (RC 后台配)
  - 促销码: RC entitlements
  - 试用第 5 天 in-app 提醒 (subagent 反馈: Apple 2023+ 要求订阅 UX 明晰)

**后端**:
- `POST /iap/webhook` — RC event → 更新本地 subscription 表
- `GET /me/subscription` — 客户端查订阅状态
- 用 MySQL cache RC entitlement (每次 API 不问 RC)

**DB migration**:
```sql
CREATE TABLE user_subscriptions (user_id INT PRIMARY KEY, product_id VARCHAR(64), status ENUM('active','expired','cancelled','in_trial'), expires_at DATETIME, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP);
```

**Deploy after 6.8**.

**4 eyes checkpoint**.

---

### Batch 6.9 — 无障碍 + 设计系统 (**20-30h — 上调**, subagent 反馈)

**上调理由**: subagent 指出 CROSS-01/02/03/05 全做 + A11Y 全扫是 20-30h, 12h 会强制 half-refactored.

- A11Y-03 44pt hitSlop 全扫
- A11Y-05 触觉反馈开关 verify + 补 gate
- CROSS-01 Toast 组件 + 迁移 (Plant/Running/Friends success 反馈)
- CROSS-02 EmptyState 组件 + 迁移 (Friends/Routes/MapHistory 3 处)
- CROSS-03 Alert → Toast 迁移 (12+ 处, 每处 20-30min)
- CROSS-05 3 marker type registry 合并 (MARKER_META + MARKER_TYPES + FLAG_TYPES → 单一 source, 消费者迁移)

**4 eyes checkpoint**.

---

### Batch 6.10 — Pre-Build 关卡 (**新增**, 4-6h + dev build 时间)

在 Batch 6.5/6.6 完成后, 6.7/6.8 之前 触发:

1. `eas build --profile development --platform ios`
2. 你装 dev build 到 iPhone
3. 走 native module smoke test:
   - Apple Sign In: 点按钮不 crash, 走完完整 flow
   - Google Sign In: 同上
   - Push notification: 后端 test 触发, 收到 + tap 进 App
   - expo-notifications register token 成功
4. 发现 native bug → 修 → 决定是否再 dev build
5. Native 层 OK → 继续 6.7/6.8/6.9

**4 eyes checkpoint**.

---

### Batch 6.12 — Sprint 末最终 verify (8-12h)

- 完整 4 eyes review 全部 sprint diff (2 独立 subagent)
- Playwright 关键 flow:
  - signup (含 DOB, <13 拒)
  - login (Apple / Google / email)
  - forgot password (完整 6 位 code 流)
  - onboarding (ONB-01/02/04)
  - hike + pause + save + memory reveal
  - plant cairn
  - friend request + accept / block
  - share hike screenshot
  - subscribe (sandbox)
  - delete account (软删 + restore)
- Backend integration test:
  - 用 jest + supertest (backend package.json 有 jest 或加)
  - 每个新 endpoint 真 API + 真 aliyun DB (staging 或 test 用户)
  - test 用户 seed / teardown 明确
- VER-01~04 真机 verify (build 后)
- 你允许后 → **production EAS build** → TestFlight → 你真机全流程

---

## Timeline (subagent 反馈上调)

| Batch | 估时 (v3) | 估时 (v4) |
|---|---|---|
| 6.0 Onboarding | 8-10h | 8-10h |
| 6.1a 小改 | 6-8h | 6-8h |
| 6.1b Map + 路线 | 6-8h | 6-8h |
| 6.1c MarkerDetail | 4-6h | 4-6h |
| 6.1d Hiking/Running | 6-8h | 6-8h |
| 6.1e History | 4-6h | 4-6h |
| 6.2 分享 | 6-8h | 6-8h |
| 6.3 Auth | 20-24h | **24-30h** |
| 6.4 Friends+Profile | 16-20h | **28-36h** |
| 6.5 Push | 12-16h | 12-16h |
| 6.6 Apple/Google | 10-12h | 10-12h |
| 6.7 GDPR + Safety | 8-10h | 8-10h |
| 6.8 IAP | 16-20h | 16-20h |
| 6.9 无障碍 + 设计系统 | 8-12h | **20-30h** |
| 6.10 Pre-Build 关卡 | — | **4-6h + dev build** |
| 6.12 verify | 6-10h | 8-12h |
| **合计** | 130-170h | **170-226h ≈ 22-28 天** |

**接受 timeline: 22-28 天 (~4-5 周) 8h/day. 或者砍某些 batch 加速.**

---

## 待你 5 秒决策 (开工前)

1. **PROF-01 入口**: Settings 里 "编辑我的资料" 跳 FriendProfileScreen(self) → 我这样做行? 或你想 tab bar 加 Me tab?
2. **RUN-04 Live Activity**: 2-3 天 iOS ActivityKit 独立工作. 是否值得? 或者 skip S7?
3. **Timeline 22-28 天**: 你接受? 还是砍范围?
4. **backend deploy**: 我每 batch 完成后 deploy 到 aliyun 生产 (低流量时段). 你没有其他真实用户在用 Cairn 后端, 对吧?

---

## 铁律 (全 Sprint 6)

- 无 OTA
- Pre-Build (dev build) 允许 1-2 次 native 验证
- Production build 1 次, 4 eyes PASS + 你 explicit 允许
- 每 batch 完 4 eyes
- 全验证 (backend integration + tsc + Playwright)
- Subagent "100% verified" → 立开 subagent#2 反驳
- Dev tool 删数据 → DRY-RUN + confirm
- 每一行代码有作用
- 命名不擅改
- 100% log 覆盖 dev 阶段 (完工统一删)
- STORE / 律师 / 运营 / reviewer seed 全推 Sprint 7
