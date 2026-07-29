# Sprint 6 Plan v3 — Code Completion Sprint

**Scope**: 代码完成. 不含 STORE 素材 / 律师 / 上线运营 / reviewer demo seed / 跨境传输迁移. 那些是 Sprint 7 launch prep.

**Baseline**: O18 (commit `a42cedf`)

**Deliverable**: 
- 94 项 `now` 代码全实装
- 后端 endpoint 全部写 + deploy to aliyun
- 前端 UI 全接
- 每 batch 4-eyes review PASS
- 全验证: 后端 integration test + 前端 tsc + Playwright 关键 flow
- **不推 OTA**
- **EAS build**: 4 eyes PASS + 你 explicit 允许后一次性 build (含 Apple/Google/Push native)

**Realistic timeline**: 130-160h = 16-20 天 (8h/day)

---

## 完整 94 项 gap analysis (marked `now`)

**Legend**: 
- ✅ **DONE-O17/O18** — 已在 O17 或 O18 完成, batch 6 只 verify
- 🔨 **B6.X** — Batch 6.X 内实装
- ⏭️ **SKIP-S7** — Sprint 6 不做, Sprint 7 (上线运营 sprint) 做  
- ⛔ **SKIP-PERM** — 用户永久 skip (基于之前 note)

### Auth (10)
| ID | Title | Status |
|---|---|---|
| AUTH-01 | 删除账户真删 | 🔨 B6.3 |
| AUTH-02 | Apple 登录实装 | 🔨 B6.6 |
| AUTH-03 | Google 登录实装 | 🔨 B6.6 |
| AUTH-04 | 忘记密码 | 🔨 B6.3 |
| AUTH-05 | 密码强度提示 (只注册) | 🔨 B6.3 |
| AUTH-06 | 年龄门 (COPPA) | 🔨 B6.3 |
| AUTH-07 | 6 格验证码 | 🔨 B6.3 |
| AUTH-08 | 登出 revoke JWT | 🔨 B6.3 |
| AUTH-09 | 徒步中登出警告 | 🔨 B6.3 |
| AUTH-10 | email 校验挡老账户 | 🔨 B6.3 (verify + 保留放宽逻辑) |

### Onboarding (4)
| ID | Title | Status |
|---|---|---|
| ONB-01 | 首次引导 (类似 memory 一次性) | 🔨 B6.0 |
| ONB-02 | GPS 权限解释屏 (集成到 memory 引导) | 🔨 B6.0 |
| ONB-03 | 'Kia ora Explorer' 全英化 | ✅ DONE-O18 |
| ONB-04 | 拒 GPS 后每次功能引导 | 🔨 B6.0 |

### Home (7)
| ID | Title | Status |
|---|---|---|
| HOME-01 | 新用户主 CTA | ⛔ SKIP-PERM (你说首页 onboarding 覆盖了) |
| HOME-02 | pending sync 可点 + 手动同步 | 🔨 B6.1 |
| HOME-03 | Routes/Cairns 加刷新 icon | 🔨 B6.1 |
| HOME-04 | 周/月/年统计 | 🔨 B6.1 |
| HOME-05 | Profile 显示"已使用 X 天" | 🔨 B6.1 (前端本地算) |
| HOME-06 | 离线全局 banner | 🔨 B6.1 |
| HOME-07 | Memory 图标换 | ✅ DONE-O18 (Footprints) |

### Hiking (7)
| ID | Title | Status |
|---|---|---|
| HIKE-01 | 独立 Pause | ✅ DONE-O18 |
| HIKE-02 | GPS 精度 chip | ✅ DONE-O18 |
| HIKE-03 | 偏离路线提示 | 🔨 B6.1 |
| HIKE-04 | 徒步中加备注 | ⛔ SKIP-PERM (你说 cairn 就是备注) |
| HIKE-05 | 共享位置给朋友 | ⛔ SKIP-PERM |
| HIKE-06 | 天黑/日落预警 | ⛔ SKIP-PERM |
| HIKE-07 | 1km 自动打点 | 🔨 B6.1 |

### Running (7)
| ID | Title | Status |
|---|---|---|
| RUN-01 | 跑步 Pause | ✅ DONE-O18 |
| RUN-02 | 信号丢失 chip | ✅ DONE-O18 |
| RUN-03 | 跑步指南针 | 🔨 B6.1 (你 note = now, 我 O18 skip 掉了, 补回) |
| RUN-04 | Live Activity | 🔨 B6.1 (估时高, 可能拖到 B6.5) |
| RUN-05 | 配速目标 | 🔨 B6.1 |
| RUN-06 | 锁屏解锁放宽 | 🔨 B6.1 (500ms→700ms) |
| RUN-07 | 停止落地统一 | ✅ DONE-O18 |

### Map (7)
| ID | Title | Status |
|---|---|---|
| MAP-01 | 图层切换 (地形/卫星) | 🔨 B6.1 |
| MAP-02 | 天气覆盖层 | ⛔ SKIP-PERM (你决定不做) |
| MAP-03 | 3D 地形 | ⛔ SKIP-PERM |
| MAP-04 | 地图搜索 | ⛔ SKIP-PERM (你决定不做) |
| MAP-05 | 长按空地种 cairn | ⛔ SKIP-PERM (你 skip) |
| MAP-06 | Marker 聚合 | 🔨 B6.1 |
| MAP-07 | 所有徒步一张图 | ⛔ SKIP-PERM (你 skip) |

### History (9)
| ID | Title | Status |
|---|---|---|
| HIST-01 | 历史搜索 | ✅ DONE-O18 |
| HIST-02 | 完整过滤 (日期/类型/排序) | 🔨 B6.1 |
| HIST-03 | hike 改名 | ✅ DONE-O18 |
| HIST-04 | 事后 plant cairn | ⛔ SKIP-PERM |
| HIST-05 | 导出单个 hike | ⛔ SKIP-PERM |
| HIST-06 | 改可见性 | ⛔ SKIP-PERM (hike 都是 private) |
| HIST-07 | 对比 2 次 | ⛔ SKIP-PERM |
| HIST-08 | 离线灰卡手动同步 | 🔨 B6.1 |
| HIST-09 | 日期格式 settings 可切 | ✅ DONE-O18 |

### Routes (9)
| ID | Title | Status |
|---|---|---|
| ROUTE-01 | 分享路线给朋友 (内部 App) | 🔨 B6.4 (走 shares 表) |
| ROUTE-02 | 导出 GPX/KML | ⛔ SKIP-PERM |
| ROUTE-03 | 难度评级 UI | ⛔ SKIP-PERM |
| ROUTE-04 | 另存为/反向 | ⛔ SKIP-PERM |
| ROUTE-05 | 社区/发现 | ⛔ SKIP-PERM |
| ROUTE-06 | Activities 朋友视图 | ⛔ SKIP-PERM (activity 纯私人) |
| ROUTE-07 | 路线列表搜索 | 🔨 B6.1 |
| ROUTE-08 | 路线离线下载 | 🔨 B6.1 (前端 UI + backend 已有 offlineMap) |
| ROUTE-09 | 收藏 | 🔨 B6.1 (前端本地 flag) |

### Marker (10)
| ID | Title | Status |
|---|---|---|
| MARK-01 | 4 个名字统一 cairn | ✅ DONE-O18 (verify: Flags tab, RoutesScreen 相关) |
| MARK-02 | Sheet vs Screen 统一 | 🔨 B6.1 |
| MARK-03 | 加照片 | ⛔ SKIP-PERM |
| MARK-04 | 语音备忘录 UI | ⛔ SKIP-PERM |
| MARK-05 | Get directions | ⛔ SKIP-PERM (你 skip) |
| MARK-06 | 谁点了赞 | ⛔ SKIP-PERM |
| MARK-07 | 评论/讨论 | ⛔ SKIP-PERM |
| MARK-08 | 举报 24h 反馈 | 🔨 B6.4 (admin review 表 + auto-hide) |
| MARK-09 | Only me/Just me 统一 | ✅ DONE-O18 |
| MARK-10 | 默认类型统一 | ✅ DONE-O18 |

### Memory (5)
| ID | Title | Status |
|---|---|---|
| MEM-01 | 分享/导出 Memory | ⛔ SKIP-PERM (走 SHR-01 截图分享) |
| MEM-02 | 时间轴回放 | ⛔ SKIP-PERM |
| MEM-03 | 单独退订好友 memory | 🔨 B6.4 |
| MEM-04 | 零 hike memory 解释 | 🔨 B6.1 |
| MEM-05 | GPS 拒绝后打开设置 CTA | 🔨 B6.1 |

### Friends (9)
| ID | Title | Status |
|---|---|---|
| FRI-01 | 删好友 | 🔨 B6.4 (verify 现有 endpoint) |
| FRI-02 | 屏蔽用户 + 黑名单 | 🔨 B6.4 |
| FRI-03 | 搜现有用户 | ⛔ SKIP-PERM |
| FRI-04 | 好友 profile card | 🔨 B6.4 (含 memory 百分比 selector) |
| FRI-05 | pending outbound | 🔨 B6.4 |
| FRI-06 | 删假字段 (online/sharedMarkers) | 🔨 B6.1 |
| FRI-07 | 实时位置共享 | ⛔ SKIP-PERM |
| FRI-08 | 接受/拒绝按钮 hitSlop | ✅ DONE-O18 |
| FRI-09 | 邀请不存在报错 | ✅ DONE-O18 |

### Profile (5)
| ID | Title | Status |
|---|---|---|
| PROF-01 | 独立 Profile 页 | ⛔ SKIP-PERM (你 note skip, 但你在 FRI-04 note 说要名片系统 — 用 FRI-04 profile card 覆盖自己的 profile 显示) |
| PROF-02 | 头像上传 | ⛔ SKIP-PERM (你说需要审核 skip) |
| PROF-03 | 改显示名字 | 🔨 B6.4 |
| PROF-04 | 个人统计 | 🔨 B6.4 (含在 FRI-04 profile card) |
| PROF-05 | 公开个人页/handle | ⛔ SKIP-PERM |

### Settings (8)
| ID | Title | Status |
|---|---|---|
| SET-01 | GDPR 下载数据 | 🔨 B6.7 |
| SET-02 | dark mode 开关 verify | 🔨 B6.1 (verify 现有 nightMode 是否真能用) |
| SET-03 | 语言切换 | ⛔ SKIP-PERM (later) |
| SET-04 | 区域切换 | ⛔ SKIP-PERM (你说自动够) |
| SET-05 | 通知偏好 | 🔨 B6.5 (放 push 里) |
| SET-06 | 关键词 clear track | ✅ DONE-O18 (→ reset memory) |
| SET-07 | 删账户不走邮件 | 🔨 B6.3 (含在 AUTH-01) |
| SET-08 | 只用英文 | ✅ DONE-O18 |

### Push (4)
| ID | Title | Status |
|---|---|---|
| PUSH-01 | Push 系统 (好友请求/share) | 🔨 B6.5 |
| PUSH-02 | Settings 通知列表 | 🔨 B6.5 |
| PUSH-03 | App icon badge | ⛔ SKIP-PERM (你 skip) |
| PUSH-04 | auto-pause 检查权限 | 🔨 B6.5 |

### Sharing (4)
| ID | Title | Status |
|---|---|---|
| SHR-01 | 分享 (activity 卡片图, memory 截图, routes/marks 内部) | 🔨 B6.2 (activity/memory) + B6.4 (routes/marks) |
| SHR-02 | 删 GPX 承诺 | 🔨 B6.2 (later 但一句话删) |
| SHR-03 | CSV/JSON 导出 | ⛔ SKIP-PERM (你 note skip) |
| SHR-04 | 深链 | 🔨 B6.4 (移到这, 依赖 shares 表) |

### Search (2)
| ID | Title | Status |
|---|---|---|
| SRCH-01 | 全 App 搜索 (Friends 剩下) | 🔨 B6.1 |
| SRCH-02 | 地图地址/trail 搜索 | ⛔ SKIP-PERM (你说不做) 或 later 若你改主意 |

### Safety (7)
| ID | Title | Status |
|---|---|---|
| SAF-01 | 保存失败静默丢 | ✅ DONE-O18 |
| SAF-02 | AsyncStorage 满 | ✅ DONE-O18 (strict mode 加到 storage.ts, callers 后续按需切) |
| SAF-03 | 切用户串数据 | ✅ DONE-O18 (hydrate mutex) |
| SAF-04 | cellular/wifi 区分 | 🔨 B6.7 |
| SAF-05 | 存储密钥整理 | 🔨 B6.7 |
| SAF-06 | 力关闭 Resume 提示 | ✅ DONE-O18 |
| SAF-07 | 紧急 SOS | ⛔ SKIP-PERM |

### IAP (3)
| ID | Title | Status |
|---|---|---|
| IAP-01 | 真订阅 (RevenueCat + NZ$5.99) | 🔨 B6.8 |
| IAP-02 | Restore purchase | 🔨 B6.8 |
| IAP-03 | 年费/试用/促销码 | 🔨 B6.8 |

### Accessibility (5)
| ID | Title | Status |
|---|---|---|
| A11Y-01 | iOS 大字号 | ⛔ SKIP-PERM (你说 skip) |
| A11Y-02 | VoiceOver | ⛔ SKIP-PERM (你 skip) |
| A11Y-03 | 44pt hitSlop | 🔨 B6.9 |
| A11Y-04 | 语音字幕 | ⛔ SKIP-PERM |
| A11Y-05 | 触觉反馈开关 | 🔨 B6.9 (verify + 补 gate) |

### Cross-feature (8)
| ID | Title | Status |
|---|---|---|
| CROSS-01 | 3 种成功反馈统一 | 🔨 B6.9 |
| CROSS-02 | 3 种 empty state 统一 | 🔨 B6.9 |
| CROSS-03 | 12+ Alert 统一 Toast | 🔨 B6.9 |
| CROSS-04 | sheet translateY 统一 | ✅ DONE-O18 |
| CROSS-05 | 3 marker type registry 合并 | 🔨 B6.9 |
| CROSS-06 | 3 红色统一 | ✅ DONE-O18 |
| CROSS-07 | 毛利/英文策略 | ✅ DONE-O18 (全英) |
| CROSS-08 | walks/hikes | ✅ DONE-O18 |

### Store / Verify (17 — all SKIP-S7 or DONE)
| ID | Title | Status |
|---|---|---|
| STORE-01 | App 图标验证 | ⏭️ SKIP-S7 (你不急) |
| STORE-02 | 截图 | ⏭️ SKIP-S7 |
| STORE-03 | 描述文案 | ⏭️ SKIP-S7 |
| STORE-04 | 隐私营养标签 | ⏭️ SKIP-S7 |
| STORE-05 | TestFlight external | ⏭️ SKIP-S7 |
| STORE-06 | 年龄评级 | ⏭️ SKIP-S7 |
| STORE-07 | 客服邮箱 URL | ⏭️ SKIP-S7 |
| STORE-08 | EAS staged rollout | ⏭️ SKIP-S7 |
| STORE-09 | EULA/ToS | ⏭️ SKIP-S7 (需律师) |
| STORE-10 | 内部测试 | ⏭️ SKIP-S7 |
| VER-01 | iOS 权限文案 verify | 🔨 B6.12 (build 后真机 verify) |
| VER-02 | ErrorBoundary verify | 🔨 B6.12 |
| VER-03 | PulsingDot cleanup verify | 🔨 B6.12 |
| VER-04 | 所有 copy verify | 🔨 B6.12 |
| VER-05 | Plant/Route 后端 message 丢失 (真 bug) | 🔨 B6.1 (fix, 不只 verify) |
| VER-06 | dev screen Delete this mark (真 bug) | 🔨 B6.1 (fix) |
| VER-07 | MapHistory 标题不居中 (真 bug) | 🔨 B6.1 (fix) |

---

## 统计

| 状态 | 数量 |
|---|---|
| ✅ DONE-O17/O18 | ~28 |
| 🔨 B6.X 实装 | ~53 |
| ⛔ SKIP-PERM (用户 skip) | ~35 |
| ⏭️ SKIP-S7 (Sprint 7 上线运营) | ~10 |
| **合计** | 126 (137 - 11 ask 待你回答后归类) |

**Sprint 6 实装项 ~53 + 4 eyes review + verify ~28 already-done + fix 3 VER bugs.**

---

## Batch 划分 (per subagent 反馈, 拆细)

### Batch 6.0 — Onboarding (**新增**, subagent 强烈要求)
估时 **8-10h**
- ONB-01 首次引导 (3-4 屏, 类似 Memory 一次性)
- ONB-02 GPS 权限解释屏 (集成到 memory 引导)
- ONB-04 拒 GPS 后每次功能弹提示

### Batch 6.1a — 前端小改 (state / copy)
估时 **6-8h**
- HOME-02/03/04/05/06 (5 项)
- FRI-06 删假字段
- MEM-04/05
- SET-02 dark mode verify
- ROUTE-09 收藏 (前端本地)
- VER-05/06/07 fix

### Batch 6.1b — Map + 路线 (中改)
估时 **6-8h**
- MAP-01 图层切换
- MAP-06 marker 聚合 (supercluster)
- ROUTE-07 路线搜索
- ROUTE-08 路线离线下载

### Batch 6.1c — MarkerDetail 统一 (大改)
估时 **4-6h**
- MARK-02 Sheet ↔ Screen 统一 (让 Sheet 补 permission chip + edit / delete + snapshot banner)

### Batch 6.1d — Hiking/Running 补齐 (中改)
估时 **6-8h**
- HIKE-03 偏离路线提示
- HIKE-07 1km 自动打点
- RUN-03 跑步指南针
- RUN-04 Live Activity (可能拖到 B6.5, iOS-only, ActivityKit)
- RUN-05 配速目标
- RUN-06 锁屏解锁 500ms→700ms

### Batch 6.1e — History 补齐
估时 **4-6h**
- HIST-02 完整过滤
- HIST-08 离线灰卡手动同步

### Batch 6.2 — 分享 (前端截图)
估时 **6-8h**
- SHR-01 activity 卡片图 (react-native-view-shot)
- SHR-01 memory 截图
- SHR-02 删 GPX 承诺 (1 行)
- SRCH-01 Friends 搜索 (前端 filter)

### Batch 6.3 — Auth 后端 4 件套
估时 **20-24h**
- AUTH-01 delete account (软删 7天 grace + restore)
- AUTH-04 forgot password (nodemailer + 6 位 code + reset)
- AUTH-06 年龄门 (新注册强制, 老用户 30 天 grace 补录)
- AUTH-08 logout revoke JWT (blacklist 表 + LRU 缓存)
- AUTH-05 密码强度 (前端 zxcvbn)
- AUTH-07 6 格 OTP 组件
- AUTH-09 徒步中登出警告
- AUTH-10 email 校验 verify 老账户 (grep DB, 有必要就放宽)

### Batch 6.4 — Friends + Profile + Share (后端 + 前端)
估时 **16-20h**
- FRI-01 verify + UI
- FRI-02 block (backend + UI)
- FRI-04 profile card (backend + FriendProfileScreen)
- FRI-05 pending outbound (backend scope + UI)
- MEM-03 单独退订
- MARK-08 举报 24h 反馈 (admin review 表 + auto-hide + 前端弹 Thanks)
- PROF-03 改显示名字 (backend + UI)
- PROF-04 个人统计 (backend + UI, 含在 profile card)
- SHR-01 routes/marks 分享 (shares 表 + endpoints + UI)
- SHR-04 深链 (依赖 shares 完成, 一起做)

### Batch 6.5 — Push
估时 **12-16h**
- PUSH-01 APNs + Firebase Admin SDK + 触发点 (friend request / share)
- PUSH-02 Settings 通知列表
- PUSH-04 auto-pause 检查权限
- SET-05 通知偏好 (放 Settings)

### Batch 6.6 — Apple + Google 登录
估时 **10-12h**
- AUTH-02 Apple Sign In (expo-apple-authentication + backend verify)
- AUTH-03 Google Sign In (react-native-google-signin + backend verify)

### Batch 6.7 — GDPR + Safety 剩余
估时 **8-10h**
- SET-01 GDPR data export (backend zip + 邮件发下载链接 — 避 Gmail 附件限)
- SAF-04 cellular/wifi 区分 (NetInfo)
- SAF-05 存储密钥整理

### Batch 6.8 — IAP
估时 **16-20h**
- IAP-01 RevenueCat 集成 + PaywallSheet 接真订阅
- IAP-02 Restore purchases
- IAP-03 年费 / 试用 / 促销码
- 后端 POST /iap/webhook (RC event) + subscription 表

### Batch 6.9 — 无障碍 + 设计系统
估时 **8-12h** (拆多的两条)
- A11Y-03 44pt hitSlop 全扫
- A11Y-05 触觉反馈开关 verify
- CROSS-01 Toast 组件 + 迁移 Plant/Running/Friends success feedback
- CROSS-02 EmptyState 组件 + 迁移 3 种设计
- CROSS-03 Alert → Toast 12+ 处迁移
- CROSS-05 3 marker type registry 合并

### Batch 6.10 — (**移到 Sprint 7**) STORE 素材
**Sprint 6 不做**. Sprint 7 launch prep 做.

### Batch 6.11 — (**移到 Sprint 7**) 运营准备
**Sprint 6 不做**. Sprint 7 做 Sentry + demo account + kill switch + FAQ.

### Batch 6.12 — Sprint 结束 verify
估时 **6-10h**
- 完整 4 eyes review 全部 diff (2 独立 subagent)
- Playwright 关键 flow: signup(含 DOB) → hike → save → plant cairn → friend request → block → subscription → memory → settings
- Backend integration test 全 endpoint
- VER-01~04 O17/O18 已改文案真机 verify (build 后)
- 你允许后 EAS build → TestFlight → 你真机走一遍

---

## Realistic Timeline

| Batch | 估时 |
|---|---|
| 6.0 Onboarding | 8-10h |
| 6.1a 小改 | 6-8h |
| 6.1b Map + 路线 | 6-8h |
| 6.1c MarkerDetail | 4-6h |
| 6.1d Hiking/Running | 6-8h |
| 6.1e History | 4-6h |
| 6.2 分享 | 6-8h |
| 6.3 Auth 后端 | 20-24h |
| 6.4 Friends + Profile + Share | 16-20h |
| 6.5 Push | 12-16h |
| 6.6 Apple/Google | 10-12h |
| 6.7 GDPR + Safety | 8-10h |
| 6.8 IAP | 16-20h |
| 6.9 无障碍 + 设计系统 | 8-12h |
| 6.12 verify | 6-10h |
| **合计** | **130-170h ≈ 16-21 天** |

---

## 铁律 (Sprint 6)

1. **无 OTA**
2. **一次 EAS build** (4 eyes PASS + 你 explicit 允许后)
3. **4 eyes 每 batch** 完 review 一次 (小 batch, 高频)
4. **全验证** 后端 integration + 前端 tsc + Playwright
5. **Subagent "100% verified" → 立开 subagent#2 独立反驳**
6. **Dev tool 删数据 → DRY-RUN + 二次 confirm**
7. **每一行代码有作用** (unused 探根因 → 删/补, 禁批量)
8. **命名/结构不擅改**
9. **数据入库前对比** (禁 seed 到底)
10. **100% log 覆盖 dev 阶段** (完工统一删)
11. **STORE / 律师 / 运营 / reviewer seed 全部推到 Sprint 7**

---

## 开工前 checklist

1. ✅ 记忆全部找回
2. ✅ Sprint scope 明确 (代码 sprint, 不含上线)
3. ✅ 邮件基础设施存在 (Gmail, 首月够用)
4. ✅ 后端 repo 本地存在
5. ✅ 137 项每条都归类 (无 silent gap)
6. ⏳ 你审 plan v3 → 说 "开始 6.0" (Onboarding) 或 "开始 6.1a" (小改)

---

## 你 note 但 plan 需要 double-check 的项

- **RUN-03 跑步指南针**: 你 note now, 我 O18 skip 掉了 (statsBar 挤). 现在补回 B6.1d. **如果视觉挤爆你不喜欢, 我随时调**.
- **RUN-04 Live Activity**: 你 note now. 这是 iOS ActivityKit 全新 native module, 工作量 2-3 天. 是否值得?
- **HOME-01 新用户 CTA**: 你 note = skip (因为 onboarding 会引导). 我记为 SKIP-PERM. 如需保留请说.
- **PROF-01 独立 Profile 页**: 你 note = skip (FRI-04 profile card 已覆盖). 但意味自己也是通过 "看别人 profile" 的方式看自己? 需要 UX 确认.
