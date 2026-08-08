# Sprint 73 — R114/O22 用户真机 bug 全修

**Sprint Goal**: 用户 2026-08-07 真机测 O21 报的 25 条 bug (P0+P1) 全部高质量修复, 一次性 OTA 推 O22.

**Sprint mode**: acceptance_mode: auto (per `/project --auto` invocation)

**Duration**: 2026-08-07 起, 中间不停顿, 直到 VU ACCEPTED

**Governing spec**: `tasks/r114-o22-spec-locked.md` (25 条 bug 完整 spec, 用户已 confirm)

## User workflow rules (强制)

1. **能 Playwright 重现**: reproduce → 分析 → subagent review 方案 → fix → Playwright verify
2. **无法 web 重现** (真机独占如 iOS Apple SI / native GPS 后台 / iOS DateTimePicker):
   - subagent 二次确认无法重现 (非主 agent 单方面判断)
   - subagent 一起探究原因
   - 加足够 crashLogger breadcrumb + 标记
   - fix
   - subagent 4-eyes review (主 + 2 subagent + 用户)
3. **中间不停顿**, 全 25 条修完才 commit + push + `eas update`
4. **不 eas build** (memory `feedback_no_push_no_build.md`)
5. 每 fix 高质量, 别 rush

## Story 拆分

按 spec-locked.md 25 条, 每条一个 Story. 优先级从 P0 → P1.

**P0 (Blocker)**:
- STORY-73001 (L1) — DOB 空白 [magnet: L1] — 磁盘已改 O22, 补 log, 真机 verify
- STORY-73002 (L3) — Apple 登录闪退 — 补完整 breadcrumb + subagent 探究
- STORY-73003 (K10) — 后台 GPS 不记 (熄屏+切后台) — subagent 深挖 backgroundLocationTask
- STORY-73004 (L2) — Create Account 键盘自动弹 [DONE 磁盘] — Playwright verify
- STORY-73005 (R2) — Running button 风格 [DONE 磁盘] — Playwright verify

**P1 (Sprint 主体)**:
- STORY-73006 (H2) — Onboarding 跟账号走 (backend + client 同步)
- STORY-73007 (H4) — Home 3 卡片标题下短线删除
- STORY-73008 (H1) — Enable Location button 位置对齐
- STORY-73009 (H3) — 拒 permission 后 Hike banner + Settings 跳转
- STORY-73010 (H5) — 首次 Home 0.5s 闪烁 + 偏高
- STORY-73011 (K1) — 网络差时地图黑/白 fallback
- STORY-73012 (K2) — 15km/h 上限 + 顶部一行 banner (numberOfLines=1)
- STORY-73013 (K3+K5) — Auto-camera 双态 (system/user) + Recenter button
- STORY-73014 (K4) — GPS gap 断开 polyline (不虚线连接) + breadcrumb
- STORY-73015 (K7) — 高速信号丢失亮屏 resume (AppState listener)
- STORY-73016 (K8) — Airport 抖动 stationary detection
- STORY-73017 (K9) — 长 hike save 慢 profile + progress UI
- STORY-73018 (R1) — Running permission 不重弹
- STORY-73019 (MM4) — 虚线不解锁 fog (只算 real GPS)
- STORY-73020 (MM5) — Map + fog 同帧 render
- STORY-73021 (MM6) — 新西兰脏数据查 + 清 (aliyun MySQL)
- STORY-73022 (S1) — Edit name 落库 verify + log
- STORY-73023 (S2) — Settings "view activity" 定位 + 决策
- STORY-73024 (S3) — Memory always-on GPS + Settings toggle (default 开)
- STORY-73025 (K6) — Hike "3km 路牌" 定位后决策

## Acceptance criteria (Sprint gate)

Sprint 73 closes when:
- [ ] 25 stories 全部 Status = Done
- [ ] Arch subagent code review = PASS
- [ ] QA subagent verdict = PASS
- [ ] UX subagent review 无 Blocker friction
- [ ] Playwright evidence: 能重现的 bug 全 Playwright verify
- [ ] Log 覆盖: 无法 web 重现的 bug crashLogger breadcrumb 齐
- [ ] Virtual User (Mode 2) 最终 acceptance >= 9.5/10 且 verdict = ACCEPTED
- [ ] git commit + push + `eas update --branch production` → 看到 Published! + update IDs
