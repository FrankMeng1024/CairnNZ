# DISCOVERY.md — Cairn

## Project Type
Mobile App (React Native + Expo, iOS priority)

## UI Intent
全新开发，按FRONTEND_STANDARDS.md最高质量标准执行。

---

## Competitive Analysis

详见 `research/market_analysis.md` 和 `research/product_spec_v2.md`。

核心竞品：
- **AllTrails** — 路线发现+离线地图，社交弱，无AR，月$400万流水
- **Strava** — 运动GPS+社交竞争，1.2亿用户，不做徒步安全
- **Komoot** — 路线规划，欧洲为主，NZ覆盖弱
- **PeakVisor** — AR识山峰，功能单一

**直接竞品**：无。"AR标记+安全工具+异步社交"组合在市场上不存在。

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
11. AR插旗视觉体验（ARKit）
12. 旗帜附带5秒语音memo
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
