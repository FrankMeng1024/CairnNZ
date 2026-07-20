# DISCOVERY.md — Cairn

## Project Type
Mobile App (React Native + Expo, iOS priority)

## UI Intent
全新开发，按FRONTEND_STANDARDS.md最高质量标准执行。

---

## Competitive Analysis

**2026-07-17 定位重校准**：AR 已舍弃（GPS 误差过大导致体验不可用）。产品实际定位不是安全工具、不是 AR 工具，而是 **数字手账 + 陌生人善意**：
- 自我维度：走过的路、探索过的区域、留下的话，N 年后依旧可以回看
- 他人维度：非社交、非社群、非算法推荐，好友订阅式互看 marker 的克制善意

**真正的直接竞品**（重新识别）：
- **Polarsteps** — 走过的路 + 时间线 + 分享给亲友，最直接对标
- **Day One (journal app)** — 带地理位置的手账，"on this day" 回顾机制
- **Findpenguins** — 旅行 footprint + 故事
- **Strava Heatmap** — 只对标它的"heatmap 情感"部分，非运动指标部分

**间接竞品**（异步善意哲学）：
- **Death Stranding (游戏)** — 产品灵魂来源，Like 系统 + 异步留言
- **Geocaching** — 现实版异步藏点，20+ 年老牌
- **Randonautica** — 已凉，但探索未知点的诉求还在

**反面参考**：
- **AllTrails** — 反着做（不做发现/不做公开路线数据库/不做算法推荐）
- **Foursquare / Swarm** — 只记录不产生意义 = 死
- **Path (2015 关停)** — 亲密社交哲学接近但商业化失败，必读死因

详见 `research/market_analysis.md`（原）和 `research/2026-07/`（新一轮真实用户调研）。

---

## User Persona

### Primary: NZ Tramper (Sam)
- 30-45岁，新西兰本地人
- 每月至少1次多日tramping（Great Walks或DOC步道）
- 已在用AllTrails找路线，用Strava记录
- 痛点：步道没信号时导航困难；无法标记个人发现的危险点/好点位；想和跑团分享路况但不想公开
- 极度重视隐私，反感社交推荐

### Secondary: NZ Trail Runner (Mika)
- 25-40岁，每周3-4次越野跑
- 有固定路线但偶尔探索新线
- 痛点：跑错路浪费时间和体力；跑步时无法看手机；想听歌但需要路况提醒
- 需要语音播报+偏离纠正

### Tertiary: International Visitor (Yuki)
- 20-35岁，到NZ旅游的国际游客
- 第一次走Great Walks，对路况不熟
- 痛点：不了解本地步道风险；语言可能有障碍；网络不可靠
- 需要官方风险数据+离线地图+简单标记

---

## Feature Priority (MoSCoW)

### Must Have (Phase 1 MVP)
1. 邮箱注册 + Google/Apple登录
2. 离线地图（NZ热门步道 - Mapbox）
3. GPS路线追踪 + 轨迹记录
4. 地图标记（pin）+ 三级权限（Personal/Group/Public）
5. 标记附带短文本（30字）
6. 官方风险图层（DOC数据）
7. 路线偏离检测 + 语音播报纠偏
8. 好友系统（邮箱添加，双向确认）
9. 跑步模式 vs 徒步模式切换
10. 新手/老手双UI模式

### Should Have (Phase 2)
11. ~~AR插旗视觉体验（ARKit）~~ **[2026-07-17 舍弃：GPS 误差过大]**
12. ~~旗帜附带5秒语音memo~~ **[随 AR 一并舍弃]**
13. "有帮助"反馈机制 + 周汇总通知
14. 社区公开旗帜展示（同区域可选查看）
15. 发现密度算法（每500米最多3面旗）
16. GPX导入/导出
17. 实时天气集成（MetService）

### Could Have (Phase 3)
18. 步道关闭实时预警推送
19. Apple Watch简版（纯震动+方向指引）
20. AU市场步道数据接入
21. 多语言支持（EN/ZH/JP）

### Won't Build
- 动态广场/个人主页/流量机制
- 点赞/评论/陌生人互动
- 好友推荐/路线重合推荐/附近的人
- 手机号注册/通讯录读取
- 排行榜/勋章/成就系统
- 直播/实时位置共享
- 商业化广告

---

## Viewports

- **Primary**: iPhone 14/15 (390×844pt, iOS 16+)
- **Secondary**: iPhone SE (375×667pt)
- **Tertiary**: Android mid-range (360×800dp)

跑步模式需适配：锁屏状态下语音播报正常工作。

---

## What We Will NOT Build

见上方 Won't Build 列表。

核心原则：**工具属性优先，社交极度克制**。任何偏向泛社交方向的功能提议自动拒绝。

---

## Acceptance Mode

`acceptance_mode: auto` — Autonomous iteration until Virtual User verdict >= 9.5/10.

---

## Shortcuts

（无）
