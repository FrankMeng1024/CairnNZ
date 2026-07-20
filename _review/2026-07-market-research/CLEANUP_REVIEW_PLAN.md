# Phase 3 · 功能语义分类（主 agent 分析产出，给用户勾选）

**产出**：`cleanup_review.html` · 单页面 · 每项功能一行 · 勾选保留/删除 · 提交后生成决策 JSON

## 74 项分类（我基于代码语义预分组，你只用勾选）

### 类别 A · 后端 endpoint 决策（31 项）

按功能语义分组，我 pre-fill 建议（KEEP / DELETE），你调整：

#### A1. 注册 + 邮箱验证流程（5 项）
- **POST /api/auth/register** — 邮箱注册新用户
- **POST /api/auth/verify** — 6 位邮箱验证码
- **POST /api/auth/resend** — 重发验证码
- **POST /api/auth/google** — Google OAuth 登录
- **PATCH /api/auth/password** — 修改密码

建议：全 KEEP（新用户注册流程必须）

#### A2. Marker 完整 CRUD + 反作弊（5 项）
- **PUT /api/markers/:id** — 编辑 marker
- **DELETE /api/markers/:id** — 删除 marker
- **GET /api/markers/public** — 公开 markers 列表（bbox 查询）
- **GET /api/markers/:id/community-state** — 获取 marker 社区互动状态
- **GET /api/markers/:id/interact-nonce** — 反作弊 vote nonce
- **POST /api/markers/:id/vote** — 投票有用/举报

建议：全 KEEP（编辑/删除是 MarkerDetailScreen 必备）

#### A3. Route 编辑 + 分享（4 项）
- **POST /api/routes** — 创建路线
- **GET /api/routes/:id** — 单条路线详情
- **PUT /api/routes/:id** — 编辑路线
- **DELETE /api/routes/:id** — 删除路线
- **PATCH /api/routes/:id/run** — 记录路线被走过一次

建议：全 KEEP（RouteEditorScreen 必备）

#### A4. Friend 请求接受拒绝（4 项）
- **POST /api/friends/request** — 发送好友请求
- **POST /api/friends/accept** — 接受好友请求
- **POST /api/friends/reject** — 拒绝好友请求
- **DELETE /api/friends/:id** — 删除好友

建议：全 KEEP（Friends screen 核心）

#### A5. 好友 marker 查看（2 项）
- **GET /api/friends/:id/markers** — legacy：单个好友的 markers
- **GET /api/circle/routes** — 好友圈所有路线（v4 主入口）

建议：/circle/routes KEEP，/friends/:id/markers 可 DELETE（circle 已取代）

#### A6. Hide 隐藏内容（1 项）
- **POST /api/hide** — 用户拉黑 marker/route

建议：KEEP

#### A7. Memory points 删除（1 项）
- **DELETE /api/memory/points** — 用户清空所有 memory fog

建议：Settings 里"Clear all my memory"按钮用 → KEEP

#### A8. Session 直接 finalize（1 项）
- **POST /api/sessions** — legacy all-in-one 保存（v411 前用法）

建议：v412 已用 start + append + save 三步替代 → **DELETE**（legacy）

#### A9. Telemetry sessions（3 项）
- **POST /api/telemetry/sessions** — client 上传 session 事件日志
- **GET /api/telemetry/sessions** — dev 查询
- **GET /api/telemetry/sessions/:id** — dev 查详情

建议：需你决定 — 是保留 dev telemetry 还是砍

#### A10. Debug snapshot（3 项）
- **POST /api/debug-snapshot** — 上传截图（Settings 里 debug tool）
- **GET /api/debug-snapshot/latest** — 查最新
- **GET /api/debug-snapshot/:id** — 查单条

建议：dev 工具，需你决定

---

### 类别 B · 前端 43 dead files 分组

#### B1. 空 tests (14 项)
- `tests/sprint71-74/*.spec.ts` + `helpers.ts` + `cleanup-baseline` — Playwright 测试脚本，**只在 dev 跑，不进 bundle**

建议：**保留 tests/**（未来 QA 可能用）· 或砍 sprint71-74 老 story test（用户明确 sprint71-74 是历史）

#### B2. Trails 老组件（4 项 · Trails screen 已经删除）
- `components/trails/ActivityBigCard.tsx`
- `components/trails/LeaveCairnCard.tsx`
- `components/trails/RecentActivityRow.tsx`
- `components/trails/TrailsHeader.tsx`

建议：**DELETE 全部**（Trails screen 已删，这些是残余）

#### B3. Illustrations empty state（3 项）
- `EmptyFriends.tsx` / `EmptyMarkers.tsx` / `EmptyRoutes.tsx` — 空态插画

建议：**KEEP**（未来 empty state 会用）—— 但静态分析说没被引用。你确认？

#### B4. AR 残余（1 项）
- `modules/cairn-fog-layer/src/index.ts` — 但 subagent#2 说 fog-layer 不是 AR 是 Metal 图层

建议：**KEEP**（不是 AR，是 fog Metal shader）

#### B5. ActivityIcons SVG（3 项）
- `FlagMarkerIcon.tsx` / `HikingIcon.tsx` / `RunningIcon.tsx`

建议：需你决定 — icon 可能通过 dynamic path 加载

#### B6. Config 未接入（4 项）
- `config/fonts.ts` / `config/i18n.ts` / `config/routeThresholds.ts` / `config/trackDifficulty.ts`

建议：需你决定 — i18n 未来会用，其他可能是老配置

#### B7. Hook + Util 孤立（3 项）
- `hooks/useBackFade.ts` — 已删组件用的 hook
- `hooks/useLikeReport.ts` — Blocker #2 提到"接后端 vote"的 hook，未来会用
- `utils/offRoute.ts` — 偏离路线检测

建议：`useLikeReport` KEEP（未来接 vote），其他 DELETE

#### B8. Service 未接入（2 项）
- `services/contentFilter.ts` — 硬编码 34 词英语黑名单（Agent B 说的空壳）
- `services/routing/mapmatch/coordSampling.ts` — 坐标采样

建议：`contentFilter` DELETE（空壳），`coordSampling` 需你决定

#### B9. Stub（1 项）
- `stubs/mapbox.web.ts` — Web 版 mapbox stub

建议：如果 web playwright 需要就 KEEP，否则 DELETE

#### B10. 其他孤立组件（4 项）
- `components/AimShutter.tsx` — AR aim shutter（AR 残余）
- `components/CairnStoneIcon.tsx` — Cairn 石头 SVG icon
- `components/DistantMarkerArrow.tsx` — 远处 marker 箭头
- `components/ErrorBoundary.tsx` — React ErrorBoundary

建议：AimShutter **DELETE**（AR 残余），CairnStoneIcon **KEEP**（应该在用），DistantMarkerArrow 需你决定，ErrorBoundary **KEEP**（应加到 App root 但被漏了）

#### B11. features gap（1 项）
- `features/memory/services/fogFloorGeometry.ts` — fog 底层几何

建议：需你决定

#### B12. Playwright configs（3 项）
- `playwright.config.ts` / `playwright.cleanup-baseline.config.ts` / `playwright.sprint72.config.ts`

建议：**KEEP**（Phase 4 测试基建需要）
