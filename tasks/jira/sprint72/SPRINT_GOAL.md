# Sprint 72 — 后台生存 + Auth 无感

**Sprint Goal**: 让 Cairn 满足"用户走一天山手机在兜里、息屏、切后台"的核心场景：hiking 中不打断记录、不掉登录态、省电、不因手机状态被 iOS 杀了 app 就丢半程；同时冷启动无感 auto-login（token 有效直进 Home）。

## Scope

**根因**（log + 代码双证据）：
- `useAppStore.ts:117-186` 冷启动**设计上强制**走 AuthScreen 即使 token 有效
- `apiService.ts:41-49` 任何 401 无脑清 token + logout
- Backend JWT 7 天 + 无 refresh endpoint
- Running 后台 500ms 采样 + Kalman 每点计算 + 定时器不 pause = 耗电大头
- 缺 auto-pause（用户回家忘停 = 电量榨干）
- 缺"未结束 session 恢复"（force-quit 后重开丢一半路）

**六条用户诉求**（全部覆盖）：
1. 后台 hiking 持续记录 → 现有双源架构 OK，需实测
2. 息屏工作 → iOS `UIBackgroundModes:['location']` 已配 OK
3. 记录时省电（不是关记录）→ P1-1 后台降频 + P1-2 非 tracking 时定时器 pause
4. 没 hiking 不该回 login → P0-1 auto-login + P0-2 铁律"续期失败绝不清 token"
5. Hiking 中 token 不过期 → P0-2 30天 + P2-1 每 30 分钟静默续
6. 产品持续记录本质 → 全部改动服务这一条

## Stories

| ID | 标题 | Points | Owner | Status | 关键点 |
|---|---|---|---|---|---|
| STORY-00549 | 冷启动 auto-login + 注销硬清 | 3 | Frontend | Todo | useAppStore.hydrate 改设计 |
| STORY-00550 | JWT 30 天 + refresh endpoint + 铁律 | 5 | Backend + Frontend | Todo | 服务端 refresh route + apiService 铁律 |
| STORY-00551 | 未结束 session 恢复 | 3 | Frontend | Todo | 冷启动检测本地未结束 session → 弹恢复条 |
| STORY-00552 | Auto-pause / 静止提醒 | 3 | Frontend | Todo | 15 分钟静止 → 通知；30 分钟不响应自动结束 |
| STORY-00553 | 后台 GPS 采样降频框架 | 3 | Frontend | Todo | AppState=background + battery>50% + !充电 → running 1s / walking 3s |
| STORY-00554 | 非 tracking 时后台定时器 pause | 2 | Frontend | Todo | drain/flush/dynamicSampling 只在非 tracking + background 时 pause |
| STORY-00555 | Hiking 中主动续 token | 2 | Frontend | Todo | tracking active 时每 30 分钟静默 refresh |
| STORY-00556 | 登录页提示 + iOS 低电量警告 | 2 | Frontend + UX | Todo | AuthScreen "数据在本机" + Low Power Mode 一次性 alert |
| STORY-00557 | Playwright + 结构化日志覆盖 | 5 | QA + Frontend | Todo | 所有关键点 breadcrumb + Playwright 场景 |

**Total**: 28 points（略高，但每条 Story 都独立可 demo，符合 vertical slice）

## 已知不做（延到 F5 iPhone session 或后续 Sprint）
- Refresh 链条 90 天硬顶（服务端安全模型，需要单独设计）
- 敏感页 Face ID 兜底分层（需要 UX 设计敏感页边界）
- 多设备活跃列表（新 Epic）

## Acceptance
- **Web Playwright 全过** = Sprint 完成的必要条件（memory feedback_web_playwright_before_iphone）
- 真机 iPhone 侧留 3 项无法 web 兜的：真 GPS 电量对账、iOS 后台 jetsam 生存、真 Low Power Mode 行为
- Sprint 结束推 OTA（memory feedback_ota_push_gate: sprint 末尾一次性推）
