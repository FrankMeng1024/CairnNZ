# v0.2.4 PROGRESS — 实时执行状态

**用途**:Compact 后 Claude 第一件事读这个文件,知道做到哪。
**协议**:每完成一个 sub-phase,append 一行(时间戳 + commit SHA + 验证)

---

## 已完成 ✅

| T+ | Sub-phase | Commit | 验证 |
|---|---|---|---|
| 0:00 | Plan 写完 | (uncommitted) | _review/v0.2.4/PLAN.md |
| 0:30 | MISSION.md 写完 | (uncommitted) | _review/v0.2.4/MISSION.md |
| 0:45 | 3 reviewer 启动 | (n/a) | a9f5da3 / a43933d / a7f67fd |
| 1:30 | Branch C step 1: 视觉资产新建 | b9fdd3e | TypeParticleController + CeremonyController + RuneSDF + RibbonSilkV2 |
| 2:00 | Branch A: GroundYResolver ARAnchor 短路 | (uncommitted) | line 663 加 if (anchor != null) continue |
| 2:00 | Branch A: PendingAnchorRetry.cs 新建 | (uncommitted) | 1s 重试,不立即 destroy |
| 2:00 | Branch B: FloorPlaneValidator.cs 新建 | (uncommitted) | 6 条硬规则 |
| 2:30 | 3 reviewer 报告全到 | (n/a) | 共识:9 项 MVP,不要碰 Branch C/D 视觉/ARWorldMap |

---

## v0.2.4 续作 — 自主全程(2026-06-13 下午起)

用户拍板:Plan 100% 可行,所有 defer 项本次必做。中途用户不参与。

| T+ | Sub-phase | Commit | 验证 |
|---|---|---|---|
| 续 0:00 | Block A 触发根因 + B OTA 23 + C 7埋点 + 顺手 4 项 | 9e5b5ef | Unity batch SetupScene 0 错误 |
| 续 0:30 | Block E1 PortalSpawnerV199 自动挂 CairnAcquireController | 5c50c8c | Unity batch SetupScene 0 错误,scene saved |

---

## 当前在做 🔄

按 plan Phase 顺序:
- [x] Phase 1.1 Block A 触发修复
- [x] Phase 1.2 Block B 23 OTA 化
- [x] Phase 1.3 Block C 7/8 埋点
- [x] Phase 1.4 Block E1 PortalSpawner 自动挂
- [x] Phase 1.5 Block A 自动化截图验证 (V024TriggerTest harness 3/3 PASS)
- [x] Phase 1.6 A8 bug fix (subagent review 发现)
- [x] Phase 2 Block E2/E3 RN render + 路由
- [x] Phase 3 Block D 视觉收尾(D1 sweep + D2 5 type 加强 + D3 同步)
- [x] Phase 4 Block F 跨 session re-snap + C8 埋点
- [x] Phase 5 EXECUTION_REPORT.md + 最终 subagent review (9/9 PASS)

**全部完成**。等用户回来 review,准备 macOS 端 EAS build + 真机验证。

---

## 关键 Reviewer 修订(必须采纳)

### Reviewer A 修订
- R-A1: PLAN §4.1 anchor 短路条件改为 `anchor != null && trackingState == Tracking`(Limited 时 resolver 仍可修)
- R-A2: §4.3 距离 hysteresis: 进入 10m 退出 12m,APPROACH 状态保留 3s 缓冲
- R-A3: §4.3 三条件锁存细化:三条件齐过 0.3s 持续 → 冻结 hit.pose + anchor → 启动仪式
- R-A4: §4.6 兜底 Y 改为 max(camera.y-1.5, observedMinTierAY-0.05);倾角 >5° 不允许 fallback
- R-A5: §4.6 兜底 spawn 后 30s 监听窗口,cairn 不在视野时无感 snap
- R-A6: §4.7 plant 攻陷条件三选一(Floor / size>1.5m²+1.5s / LiDAR Depth 双确认)
- R-A7: ARWorldMap 不是 OTA flag,需 iOS Swift native plugin → defer to v0.2.5
- R-A8: ARCore Geospatial iOS 端不存在 → defer

### Reviewer B 修订
- R-B1: 仪式时长 1.0s → 1.8-2.2s
- R-B2: 触发距离 10m → 5-7m(屏幕上 cairn 至少 150 像素)
- R-B3: facing hysteresis 0.8s → 0.4s 进入 / 0.6s 退出
- R-B4: reseat anchor 提前到仪式启动前 0 帧,不在末端
- R-B5: 10-15m 加 ghost cairn preview(铁律修订:这是 mid-LOD 不是 30m+)
- R-B6: T0-T15 文案重写情感化(GuidanceCopy.ts 常量)
- R-B7: haptic 改 渐强 light→medium→heavy
- R-B8: LOD 切换加 fade transition(0.8s)+ 双滞后(进入5.5m / 退出6.5m)
- R-B9: T15 文案"看,在这里"(轻 fade in)而非"为你显示标记"(暗示系统介入)
- R-B10: TutorialOverlay 组件 + 3s GIF 素材 → defer 到 v0.2.5(单晚做不了美术)

### Reviewer C 修订
- R-C1: 9 项 MVP 严格执行
- R-C2: 视觉 (Branch C) 不阻塞 ship,当前 v3.5q baseline 接受
- R-C3: ARWorldMap / Geospatial 整 Phase 5 defer
- R-C4: commit message 加 v024-PXx 标签便于 git log --grep

---

## Defer 到 v0.2.5(明确不做)

- ARWorldMap iOS Swift native plugin
- ARCore Geospatial(iOS 不支持)
- TutorialOverlay 教学 GIF
- Branch C 5 type 粒子的"加强"工作(当前 baseline ship)
- 自动评分循环到 9.7(batchmode 不跑 ARAnchor)
- xcframework rebuild + 真机 OTA 推
- 5-LOD ghost preview shader

---

## Compact 接续协议

新 Claude 接手第一件事:
1. Read `_review/v0.2.4/MISSION.md`
2. Read `_review/v0.2.4/PROGRESS.md`(本文件,看最后一项做完哪个)
3. `git log --grep="v024-" --oneline`(交叉验证)
4. 不要重读 PLAN.md(过期工时不准,以 PROGRESS + MISSION 为准)
5. 继续上面"当前在做"的下一项
6. 不问用户(用户在睡觉),fork 决策自行写 DECISIONS.md
