# Sprint 6 Plan — 94 items, no OTA, one build

**Baseline**: O18 (commit `a42cedf`, live on production OTA)
**Target**: build 一次 (你允许后), 直接上 App Store submission
**No OTA during this sprint**
**4-eyes 铁律**: 每 batch 完工后走接入点 2

---

## Batch 划分

### Batch 6.1 — 前端小改 (无后端, 无 native rebuild)
估时 4-6h.

| ID | 内容 | 涉及文件 |
|---|---|---|
| HOME-03 | Routes / Cairns 列表加刷新 icon (不做下拉刷新) | RoutesScreen |
| HOME-05 | Profile 展示 "已使用 Cairn X 天" (从 register 起算) | SettingsScreen profile card |
| HOME-07 | Memory 图标 Map → Footprints (**已在 O18 完成**, verify) | HomeScreen — verify only |
| FRI-06 | 删掉好友卡片上的 online 状态 + sharedMarkers 假字段 | FriendsScreen |
| MAP-01 | 图层切换 (地形/卫星) UI + 状态 | MapScreen + HikingMap + MapHistoryScreen (共 3 处 mapbox 用) |
| MAP-06 | Marker 聚合 (supercluster, public cairn 密集时) | MapScreen + CairnPinsLayer |
| SET-04 | **skip** (你决定不做) | — |
| CROSS-01 | 3 种成功反馈样式统一 (haptic + toast 组件) | 新组件 + Plant/Running/Friends 迁移 |
| CROSS-02 | 3 种 empty state 设计统一 | 新组件 + 迁移 |
| CROSS-03 | 12+ 处 Alert 统一到 Toast 组件 (或先只做最常见 3 个) | 新 Toast + 逐个迁移 |
| CROSS-05 | 3 个 marker type registry 合并 | 3 个 config file 合并 |
| VER-01~07 | O17/O18 待真机 verify 项 (真机 build 后一起测) | — |

**4 eyes checkpoint**: batch 6.1 完工后 subagent#1 + #2 review.

### Batch 6.2 — 分享 (前端, 无后端)
估时 4-6h.

| ID | 内容 |
|---|---|
| SHR-01 activity | hike 卡片图 (地图轨迹 + 距离 + 时间) 生成 + 系统 share sheet |
| SHR-01 memory | Memory 地图截图 + 系统 share sheet |
| SHR-01 routes/marks | App 内部分享 (给朋友, 走后端 — 归入 batch 6.4 friend) |
| SHR-04 深链 | cairnapp.nz/route/xxx / /cairn/xxx URL 处理 (Universal Links config) |
| SHR-02 隐私承诺 | 删掉 AuthScreen "GPX export" 那句 |

**4 eyes checkpoint**.

### Batch 6.3 — Auth 后端 (App Store 硬需求 4 件套)
估时 8-12h.

| ID | 后端 endpoint | 前端 UI |
|---|---|---|
| AUTH-01 | `DELETE /account` (软删 + 7 天 grace + cron 清理) + email confirm | SettingsScreen delete flow (去掉 mailto) |
| AUTH-04 | `POST /auth/password-reset/request` + `POST /auth/password-reset/verify` (6 位 code + 新密码) | AuthScreen 加 "Forgot password" link |
| AUTH-06 | 注册 schema 加 `dateOfBirth`, <13 拒绝 | AuthScreen register 加 DOB field |
| AUTH-08 | `POST /auth/logout` (blacklist JWT) + 添 `token_blacklist` 表 | authService.logout() 加后端调用 |
| AUTH-05 | 密码强度 (纯前端, 只注册时) | AuthScreen 加 strength meter |
| AUTH-07 | 6 格 OTP 组件 (注册 verify code) | AuthScreen 换组件 |
| AUTH-09 | 徒步中登出警告 | SettingsScreen sign-out check tracking |
| AUTH-10 | 登录 email 校验放宽 (verify DB 无老数据受损) | 已在 O17 改, backend 查一次 |

**DB schema 加**:
```sql
ALTER TABLE users ADD COLUMN date_of_birth DATE NULL;
ALTER TABLE users ADD COLUMN deleted_at DATETIME NULL, ADD INDEX idx_deleted_at (deleted_at);
CREATE TABLE token_blacklist (jti VARCHAR(64) PRIMARY KEY, user_id INT, expires_at DATETIME, INDEX idx_expires (expires_at));
CREATE TABLE password_reset_codes (email VARCHAR(255), code VARCHAR(6), expires_at DATETIME, used TINYINT DEFAULT 0, INDEX idx_email_code (email, code));
```

**Cron**: 每小时清理 `deleted_at < NOW() - 7 days` 的 users + 相关数据.

**4 eyes checkpoint**.

### Batch 6.4 — Friends + Profile (后端 + 前端)
估时 6-8h.

| ID | 后端 | 前端 |
|---|---|---|
| FRI-01 | 已有 `DELETE /friends/:id` (verify works, 双向删) | FriendsScreen 加 remove UI |
| FRI-02 block | `POST /friends/:id/block` + `DELETE /friends/:id/block` + `GET /friends/blocklist` + 好友请求接受选项加"block" | FriendsScreen incoming request 加 Block 按钮 + Settings blocklist 管理 |
| FRI-04 profile | `GET /users/:id/profile-card` (返回 name/avatar/hikeStats/memoryPercentage/memoryDisplayMode) + `PUT /users/me/profile-card` | ProfileScreen 新页 + FriendsScreen 卡片点击进入 |
| FRI-05 | `GET /friends/requests?scope=outbound` | FriendsScreen 加 "Sent" tab |
| FRI-08 | (已在 O18) | (已在 O18) |
| FRI-09 | (已在 O18) | (已在 O18) |
| MEM-03 | `DELETE /memory_subscriptions/:friendId` (单独退订) + verify existing endpoint | MemoryScreen 加单独退订 UI |
| SHR-01 routes | `POST /shares/route` (给朋友发路线邀请) + `GET /shares/inbound` | 朋友 detail 页 "Share" 按钮 + 通知 |
| SHR-01 marks | 同上 for markers | 同上 |

**DB schema 加**:
```sql
CREATE TABLE friend_blocks (blocker_id INT, blocked_id INT, created_at DATETIME, PRIMARY KEY (blocker_id, blocked_id));
CREATE TABLE user_profile_cards (user_id INT PRIMARY KEY, memory_display_mode ENUM('country', 'global') DEFAULT 'country', memory_country_code VARCHAR(2) DEFAULT 'NZ', updated_at DATETIME);
CREATE TABLE shares (id INT AUTO_INCREMENT PRIMARY KEY, from_user_id INT, to_user_id INT, kind ENUM('route', 'marker'), target_id INT, status ENUM('pending', 'accepted', 'rejected'), created_at DATETIME);
```

**4 eyes checkpoint**.

### Batch 6.5 — Push notification (native rebuild)
估时 6-10h.

| ID | 内容 |
|---|---|
| PUSH-01 | APNs 集成 (expo-notifications native module 已有), 后端: `POST /push/register-token` + Firebase Admin SDK 发推送 |
| PUSH-02 | Settings 加通知列表 (最近 30 天 in-app 通知) |
| PUSH-04 | auto-pause 检查权限 |

**DB schema 加**:
```sql
CREATE TABLE push_tokens (user_id INT, token VARCHAR(255), platform ENUM('ios','android'), created_at DATETIME, PRIMARY KEY (user_id, token));
CREATE TABLE notifications (id INT AUTO_INCREMENT PRIMARY KEY, user_id INT, kind VARCHAR(32), payload JSON, read_at DATETIME NULL, created_at DATETIME);
```

**推送触发**:
- 好友请求收到 → 通知 to_user
- 好友分享 route / cairn → 通知 to_user
- **不推**: memory 更新, 步频提醒等

**4 eyes checkpoint**.

### Batch 6.6 — Apple + Google 登录 (代码实装, native rebuild 需求)
估时 6-8h.

| ID | 内容 |
|---|---|
| AUTH-02 | `expo-apple-authentication` 集成 + 后端 `POST /auth/apple` verify apple identity token |
| AUTH-03 | Google OAuth 2 (`@react-native-google-signin/google-signin` 或 web OAuth flow) + 后端 `POST /auth/google` (已有 stub, 填肉) |

**关键前提**: **native module 缺失时 graceful degrade** (按钮显示但点了 Alert "requires app rebuild", **不 crash**)

**4 eyes checkpoint**.

### Batch 6.7 — Safety + Data + GDPR
估时 6-8h.

| ID | 内容 |
|---|---|
| SET-01 GDPR | `GET /account/export` (打包 zip 邮件发送) + Settings 加 "Download my data" |
| SAF-04 | cellular vs wifi 区分 (NetInfo + telemetryWifiOnly opt-in) |
| SAF-05 | 存储 key 整理 (dead migration 检查 + 单个 storage 层) |
| SAF-07 | 紧急 SOS - 你选 skip. **不做** |

**4 eyes checkpoint**.

### Batch 6.8 — IAP (真订阅)
估时 8-12h.

| ID | 内容 |
|---|---|
| IAP-01 | RevenueCat 集成 (subscription products in ASC + RC dashboard). NZ$5.99 monthly. |
| IAP-02 | Restore purchases 按钮 |
| IAP-03 | 年费 + 试用 + 促销码 (RevenueCat entitlements) |

**后端**: `POST /iap/webhook` (App Store server-to-server) + `GET /me/subscription`

**4 eyes checkpoint**.

### Batch 6.9 — 无障碍 + 一致性收尾
估时 4-6h.

| ID | 内容 |
|---|---|
| A11Y-01 | Dynamic Type: 全局 Text 组件默认 allowFontScaling (grep 加) |
| A11Y-02 | VoiceOver: 剩余屏加 accessibilityLabel (Memory / Friends / Settings) |
| A11Y-03 | 44pt hitSlop 剩余小按钮扫一遍 |
| A11Y-05 | 触觉反馈开关: verify hapticFeedback setting 被所有 haptic 调用尊重 |
| CROSS-08 | walks → hikes (已在 O18 改一个, 剩余 grep) |
| SET-02 | Dark mode: verify 现有 nightMode 是否真能用, 不能就补 |

**4 eyes checkpoint**.

### Batch 6.10 — App Store 素材 (你决定要做的)
估时 (取决于设计外包)

| ID | 内容 |
|---|---|
| STORE-01 | App 图标 1024×1024 验证 (Preview 打开, 检查无 alpha/圆角/透明) |
| STORE-03 | App Store 描述文案 (App name / subtitle / description / keywords) |
| STORE-04 | 隐私营养标签文档 |
| STORE-06 | 年龄评级 |
| STORE-07 | 支持邮箱 + URL 验证 200 |
| STORE-08 | EAS 分阶段发布配置 (eas.json) |
| STORE-09 | 服务条款 / EULA (需要律师看) |

**STORE-02 (截图) + STORE-05 (TestFlight external group) + STORE-10 (dogfood)** = 你 note skip 到晚点

**注意**: 描述文案 / EULA 涉及产品定位, 我先写 draft 你审, 不擅自定.

### Batch 6.11 — verify + PR-check
最后一批. 所有 batch 完工后:

- 完整 4 eyes review (2 subagent 独立读全部 diff)
- Playwright 关键 flow 跑一遍 (login → hike → save → plant cairn → friend → settings)
- Backend integration test (真 aliyun DB 测试所有新 endpoint)
- 你允许后 → EAS build 一次 → 你装 TestFlight 真机验证

---

## Deferred (你 marked skip / v11 / later)

- HIST-04 事后 plant cairn — skip
- MARK-03 cairn 加照片 — skip
- SET-03 语言切换 (later)
- MAP-03 3D 地形 — skip
- MAP-04 地图搜索 — skip (你决定)
- ROUTE-02/03/04/05 路线导出/难度/另存为/社区 — skip
- HIST-05/06/07 hike 导出/可见性/对比 — skip
- MEM-01/02 memory 分享导出/时间轴 — skip (memory 分享走 SHR-01 memory 截图)
- FRI-03/07 用户搜索 / 实时位置共享 — skip
- MARK-04/05/06/07 语音/导航/点赞列表/评论 — skip
- SAF-07 紧急 SOS — skip
- STORE-02/05/10 截图/testflight external/dogfood — 你后期做

---

## Timeline (估计, 有 buffer)

| Batch | 估时 | 累计 |
|---|---|---|
| 6.1 前端小改 | 4-6h | 6h |
| 6.2 分享 | 4-6h | 12h |
| 6.3 Auth 4件套 | 8-12h | 24h |
| 6.4 Friends + Profile | 6-8h | 32h |
| 6.5 Push | 6-10h | 42h |
| 6.6 Apple/Google | 6-8h | 50h |
| 6.7 Safety + GDPR | 6-8h | 58h |
| 6.8 IAP | 8-12h | 70h |
| 6.9 无障碍收尾 | 4-6h | 76h |
| 6.10 素材 draft | 4-6h | 82h |
| 6.11 4eyes + verify | 8h | 90h |

**共 90h 左右, 不停歇约 4 天. 有中断的话 6-7 天.**

---

## 开工前 checklist (在你说 "开始" 之前必须确认)

1. [x] 记忆全部找回 (4 eyes 规则 / 幻觉规则 / 测试方法 / 后端结构)
2. [x] 4 eyes 频度: 小 batch 多次
3. [x] 验证深度: 全验证 (后端 integration + 前端 tsc + Playwright)
4. [x] Build 策略: 有额度, 但不浪费. 你 explicit 允许再 build. 无 OTA.
5. [ ] 你审 Sprint 6 plan 后确认开工 ← **等这个**

---

## 我不会做的 (红线)

- 不擅自改命名/结构 (v414 教训)
- 不做 OTA (整个 sprint)
- 不 eas build (等你 explicit)
- 不删数据不 DRY-RUN
- 不写 mock 数据入库
- Subagent 说 "100% verified" 不轻信, 立刻 subagent#2 反驳
- 不做 skip 掉的 items (即使技术上简单)
