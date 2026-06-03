# BACKLOG.md — Cairn

**Last cleaned**: 2026-05-27 (post-v78)
**Completion legend**: ✅ Done · 🚧 Partial · 🆕 Not started

## Phase 1 — 地图 + GPS

| # | Feature | Epic | Priority | Status | Notes |
|---|---------|------|----------|--------|-------|
| 2 | 离线 tile 分区域下载 + 进度 UI | E-001 | Must Have | 🆕 | NZ 区域包：Tongariro、南岛步道等。当前 metro 地下无信号时无地图，这条解决该问题 |
| 5 | 模拟定位测试框架（NZ 坐标注入）| E-002 | Should Have | 🆕 | 开发阶段必备，但 v77 实地 metro 测试已替代了一部分价值 |

> **已完成移除**: #1 Mapbox 真实地图（Hike+History 已用 @rnmapbox/maps）· #3 Kalman+动态采样（v74-v78）· #4 GPS 速度/方向一致性（v77 Doppler anchor + v78 teleport 10 m/s）

## Phase 2 — 路线 + 播报 + 旗帜管理 + SOS

| # | Feature | Epic | Priority | Status | Notes |
|---|---------|------|----------|--------|-------|
| 6 | MAP 路线绘制/添加 | E-007 | Must Have | 🆕 | OTA 可做 |
| 7 | Waypoint（临时播报点）| E-007 | Must Have | 🆕 | OTA 可做 |
| 8 | 路线偏离检测 + 语音纠偏 | E-007/E-008 | Must Have | 🆕 | 偏离检测 OTA；语音纠偏依赖 #9 |
| 9 | Audio ducking TTS（不打断音乐）| E-008 | Must Have | 🆕 | **Needs native build** — 原生模块控制 AVAudioSession ducking |
| 10 | 播报优先级队列 + 合并策略 | E-008 | Must Have | 🆕 | P0/P1/P2 + 15s 间隔。OTA 可做 |
| 11 | MAP 旗帜修改/删除 | E-006 | Must Have | 🆕 | OTA 可做 |
| 12 | 旗帜权限变更（个人↔好友↔社区）| E-006 | Should Have | 🆕 | 后端已支持 permission 字段；前端编辑 UI 缺 |
| 13 | SOS 一键求助（长按+SMS fallback）| E-011 | Must Have | 🆕 | OTA 可做。SMS fallback 走 expo-sms |
| 14 | 行程分享（预计时间+超时通知）| E-011 | Should Have | 🆕 | OTA |
| 15 | 路线历史 + 跑步次数统计 | E-007 | Should Have | 🆕 | OTA |
| 16 | GPX 导入/导出 | E-007 | Should Have | 🆕 | OTA |
| 17 | 预定义路线高亮 + 旗帜关联 | E-007 | Must Have | 🆕 | OTA |
| 18 | 路线分享给好友 | E-007 | Should Have | 🆕 | Phase 2.5 好友系统就绪后 |

## Phase 2.5 — 好友 + 天气路况

| # | Feature | Epic | Priority | Status | Notes |
|---|---------|------|----------|--------|-------|
| 19 | 双向好友确认（in-app + email）| E-004 | Must Have | 🆕 | 后端 friends 表已建 |
| 20 | 好友旗帜同步 + 视觉区分 | E-004 | Must Have | 🆕 | |
| 21 | 好友旗帜屏蔽/分享管理 | E-004 | Should Have | 🆕 | |
| 22 | 旗帜时效性显示 + 过滤器 | E-004 | Should Have | 🆕 | |
| 23 | DOC 步道状态接入 | E-009 | Must Have | 🆕 | 免费，户外最相关 |
| 24 | Open-Meteo 天气集成 | E-009 | Must Have | 🆕 | 免费，山区加 disclaimer |
| 25 | NZTA 路况接入 | E-009 | Could Have | 🆕 | 公路覆盖，步道不适用 |
| 26 | 数据源冲突整合逻辑 | E-009 | Must Have | 🆕 | 优先级：DOC > Open-Meteo > NZTA |

## Phase 3 — AR 进阶 + 社区

> **已完成**: #27 AR 插旗（v67-v72）· #28 AR 3D 外观（v70）· #29 AR 降级（v78 #3 加了 low-light 提示）

### AR 进阶（多数需要 native build，攒一批一起 build）

| # | Feature | Epic | Priority | Status | OTA/Build | Notes |
|---|---------|------|----------|--------|-----------|-------|
| 30 | AR 旗帜修改 | E-006 | Should Have | 🆕 | OTA | 与 #11 联动 |
| 48 | AR cairn halo PNG asset（柔光雾化感）| E-003 | Should Have | 🆕 | **Build (assets)** | 加 1 张 radial gradient PNG，启用 ViroSpriteMaterial halo |
| 49 | AR cairn 高级视觉（SceneKit/RealityKit + Metal shader）| E-003 | Could Have | 🆕 | **Build (大)** | 5-8 天，几乎重写 AR 层。仅在 #48 视觉验收不通过时启动 |
| 50 / 58 | **ARWorldMap 跨 session 持久化**（修 5-10m 飘移 bug）| E-003 | Should Have | 🆕 | **Build (Swift)** | 用户实测：plant flag → 关 AR → 回原地开 AR → flag 飘前 5-10m，循环越来越远。修法：序列化 ARSession.getCurrentWorldMap() 到 device，下次 ARSession.initialWorldMap = saved。约 200 行 Swift + 50 行 RN bridge |
| 51 | DragCairnPicker 死代码清理 | E-003 | Could Have | 🆕 | OTA | ARScreen.tsx ~230 行被 PlantSheet 替代但未删 |
| 52 | getDistanceScale + AR_SNAP_RANGE_M 死代码 | E-003 | Could Have | 🆕 | OTA | 同上一条一起清 |
| 53 | AR plant 模式精细距离控制 | E-003 | Could Have | 🆕 | OTA | 当前 hit-test 自动判断；power user 可能想手动设 5/10/20m |
| 54 | AR cairn 远距视觉降级（>80m → billboard sprite）| E-003 | Should Have | 🆕 | OTA | 100m+ 的球只是一个点，省 GPU |
| 55 | AR cairn 类型扩展（cairn / free 语义）| E-003 | Should Have | 🆕 | 需 PO | 当前 v70 把这两类 fallback 渲染为灰色通用球 |
| 56 | AR 粒子贴图 + Fresnel 强度 | E-003 | Should Have | 🆕 | **Build (assets)** | 配合 #48；fresnelExponent ~3.0 + ViroParticleEmitter |
| 57 | AR cairn note 长文本/语音 | E-003 | Should Have | 🆕 | OTA + 语音需 build | 当前 30m 内显示 note；> 60 字省略号点击展开 |

### 社区

| # | Feature | Epic | Priority | Status | Notes |
|---|---------|------|----------|--------|-------|
| 31 | 关键词黑名单筛选 | E-003 | Must Have | 🆕 | 好友级别起用 |
| 32 | 社区旗帜展示开放 | E-005 | Should Have | 🆕 | 用户量 >1000 后 |
| 33 | 社区旗帜聚合+投票+举报 | E-005 | Should Have | 🆕 | |
| 34 | 社区危险 disclaimer | E-005 | Must Have | 🆕 | 法务审查后 |

## 贯穿所有 Phase — 非功能性

| # | Feature | Epic | Priority | Status | Notes |
|---|---------|------|----------|--------|-------|
| 35 | 暗色模式（自动+手动覆盖）| E-010 | Should Have | 🆕 | OTA |
| 36 | i18n 架构搭建（仅英文内容）| E-010 | Should Have | 🆕 | OTA |
| 37 | GDPR 隐私合规（删除/导出/最小化）| E-010 | Must Have | 🆕 | Phase 2 前完成 |
| 38 | 无障碍基础（VoiceOver/TalkBack/44pt）| E-010 | Must Have | 🆕 | 持续 |
| 39 | 个人统计展示（好友可见）| E-010 | Could Have | 🆕 | Phase 2 |
| 40 | Onboarding 轻量引导（3-5 屏可跳过）| E-010 | Should Have | 🆕 | OTA |

## 延期项（Phase 3+ 或评估后再排）

| # | Feature | Epic | Priority | Notes |
|---|---------|------|----------|-------|
| 41 | Apple Watch 震动方向指引 | E-002 | Could Have | **需独立 watchOS 工程** |
| 42 | 步道关闭实时推送 | E-009 | Could Have | Phase 3 |
| 43 | AU 步道数据接入 | E-001 | Could Have | Phase 3 |
| 44 | 多语言支持 | E-010 | Could Have | Phase 3，i18n 框架（#36）就绪后 |
| 45 | 旗帜 5 秒语音 memo | E-003 | Should Have | **Needs native build** — 录音权限 + AVAudioRecorder。和 AR 同期 |
| 46 | "有帮助"反馈+周汇总通知 | E-005 | Should Have | Phase 3 |
| 47 | 发现密度算法 | E-005 | Should Have | Phase 3 |

