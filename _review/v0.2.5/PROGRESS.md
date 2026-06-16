# v0.2.5 Progress

**自动模式启动时间**: 2026-06-16
**当前 phase**: Phase 0 (4-eye review pending)
**最后完成 sub-item**: 0.27 (pending after 4-eye)

## Phase 0 — 测试数据清理 + 脚手架 + lint

### 0.0 预扫
- [x] 0.0a backend 结构已扫:`backend/src/{migrations,routes,scripts}` 标准结构,migrations 到 014
- [x] 0.0b RN deps audit:`expo-file-system: ~19.0.23` 存在(纯 JS),不需 native rebuild;无 react-native-fs
- [x] 0.0c backend/.env DB 验证:mysql 连接 OK,version 8.0.45
- [x] 0.0d Python deps:scripts/requirements.txt 加 Pillow + scikit-image + playwright

### 0.1-0.10 工具脚本
- [x] 0.1 `scripts/cairn_lint.py:1` 已写,PASS smoke test(C.1 + C.2 + Rule P)
- [x] 0.2 `scripts/verify_progress.py:1` 已写,PASS smoke test on phase=0(commit + AST + ADR check)
- [x] 0.3 `scripts/lock_plan.py:1` 已写,15 locks WRITE+CHECK PASS
- [x] 0.4 `scripts/visual_compare.py:1` 已写(Playwright capture-baseline + SSIM compare)
- [x] 0.5 `.git/hooks/pre-commit:1` 已写,chmod +x,内含 cairn_lint + lock_plan + 自检
- [x] 0.5b hook 自检在 pre-commit 内(SHA mismatch refuse)
- [x] 0.6 hook 测试:模拟 `// trust ARKit` 违规 → cairn_lint FAIL (1 violation),清理后 PASS
- [x] 0.7 ADR-001..005 预批准全部写完
- [x] 0.8 BLOCKER 模板 `_review/v0.2.5/blockers/_TEMPLATE.md`
- [x] 0.9 ADR 模板 `_review/v0.2.5/adr/_TEMPLATE.md`(含 Expiration phase + Signoff)
- [x] 0.10 phase done + signoff 模板写完

### 0.10a-e 测试框架
- [x] 0.10a `UnityARLib/Packages/manifest.json:3` 加 `com.unity.test-framework: 1.4.5`
- [x] 0.10b `UnityARLib/Assets/Scripts/v025/_README.md:1` 架构地图
- [x] 0.10c `UnityARLib/Assets/Scripts/v025/v025.Runtime.asmdef:1`(name reference,跨版本稳定)
- [x] 0.10d `UnityARLib/Assets/Scripts/v025/Tests/v025.Tests.asmdef:1`(EditMode + UNITY_INCLUDE_TESTS)
- [x] 0.10e `app/package.json` jest testMatch 加 v025 globs

### 0.11-0.12 v025 目录
- [x] 0.11 Unity v025 子目录全建:Core/Spawn/Anchor/Session/Visual/Shaders/Telemetry/Bridge/Tests/{AntiPattern,Unit};Plugins/iOS 也建
- [x] 0.12 RN v025 子目录:app/src/services/v025 + store/v025 + screens/v025;backend/src/routes/v025

### 0.13 backend migration
- [x] 0.13a `backend/scripts/run-migration.js:1` 写成,支持 apply/rollback/verify/schema
- [x] 0.13b `backend/src/migrations/015_v025_clear_test_data.sql:1` 写成
- [x] 0.13c `backend/src/migrations/015_rollback.sql:1` 写成
- [x] 0.13d 备份 + 跑 015 → DELETE 10 markers + ALTER TABLE 加 space_id/has_worldmap/anchor_kind
- [x] 0.13e schema diff verify:3/3 columns present

### 0.14-0.19 RN 端清理
- [x] 0.14 ARScreen.tsx → ARScreenLegacy.tsx (`app/src/screens/ARScreenLegacy.tsx:206` ARScreen→ARScreenLegacy);新 `app/src/screens/ARScreen.tsx:1` 是 wrapper(useV025 ? V2 : Legacy);`app/src/screens/v025/ARScreenV2.tsx:1` stub
- [x] 0.15 backend feature_flags 表 + useV025=true (`backend/src/migrations/015b_feature_flags.sql:1`);RN 端 client `app/src/services/v025/featureFlagsClient.ts:1`
- [-] 0.16 BLOCKER-001 → ADR-006 字段保留至 Phase 7
- [-] 0.17 BLOCKER-002 → ADR-007 延期 Phase 7
- [-] 0.18 BLOCKER-002 → ADR-007 延期 Phase 7
- [-] 0.19 BLOCKER-002 → ADR-007 延期 Phase 7

### 0.20 老 Unity .cs
- [x] 0.20a grep done,引用方记录在 BLOCKER-002
- [-] 0.20b/c BLOCKER-002 → ADR-007 延期 Phase 7
- [x] 0.20d 当前 Unity 编译状态:未改老 .cs,sanity 不变(编译验证留至 Editor 跑时)

### 0.21 grep 全 repo 老 schema
- [x] 0.21a v025 scope grep 老文件名 = 0 命中 ✅
- [-] 0.21b/c ADR-007 延期(老路径不动)

### 0.22 retrofit 全扫描
- [x] 0.22 cairn_lint --scope all:42 violations,全在老代码(PortalSpawner / ARScreenLegacy 等),v025 scope 0 violation,无 false positive

### 0.23-0.27 收口
- [x] 0.23 `scripts/lock_plan.py --mode write`:15 locks 写盘到 `_review/v0.2.5/.plan_locks.json`,check PASS
- [x] 0.24 本 PROGRESS.md
- [ ] 0.25 4 眼 review (新开 sub#0-1 + sub#0-2) — 待跑
- [ ] 0.26 修光 BLOCKER + CRITICAL,直到 verdict PASS — 待跑
- [ ] 0.27 commit "v0.2.5 phase 0 — scaffold + lint + Constitution lock" — 待跑

### Phase 0 出口判据自检
- [x] cairn_lint v025 scope 全绿(3 files clean)
- [x] lock_plan check 全绿(15 locks)
- [x] verify_progress phase=0 PASS(signoff 缺失为 warn 不为 err)
- [x] 老 schema grep 命中 0(v025 scope)
- [x] backend migration 015 + 015b 跑成功 + verify PASS
- [x] feature_flags useV025=true
- [ ] 4 眼 review verdict PASS(待跑)

### Active BLOCKERs
- BLOCKER-001(ADR-006 决议,字段保留至 Phase 7)
- BLOCKER-002(ADR-007 决议,老代码删除延期至 Phase 7)
- 影响:0.16/0.17/0.18/0.19/0.20b/c 标 [-] 不阻塞 phase 闭合,因 ADR 已批准延期方案

### ADRs added
- ADR-000 malware reminder 冲突 + 主 agent 决策
- ADR-001/002/003/004/005 预批准
- ADR-006 marker store 字段保留(BLOCKER-001 决议)
- ADR-007 老代码删除延期(BLOCKER-002 决议)
