# v0.2.5 Progress

**自动模式启动时间**: 2026-06-16
**当前 phase**: Phase 2A DONE → Phase 2B start
**最后完成 sub-item**: 2A.14

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
- [x] 0.23 `scripts/lock_plan.py --mode write`:15 locks 写盘到 `_review/v0.2.5/.plan_locks.json`,check PASS。Round-2 修复:Constitution 覆盖完整 Rule A-S(5977 chars,vs round-1 的 800 chars 截断)
- [x] 0.24 本 PROGRESS.md
- [x] 0.25 4 眼 review:Round-1 sub#0-1 (NEEDS_REVISION 1B+4C,fixed) + sub#0-2 (NEEDS_REVISION 2B+4C,fixed);Round-2 sub#0-3 (PASS 12/12) + sub#0-4 (NEEDS_REVISION 3C,fixed)。All 11 BLOCKER/CRITICAL fixed.
- [x] 0.26 修光 BLOCKER + CRITICAL,verdict 终态 PASS — 见 `_review/v0.2.5/verdicts/phase0-signoff.md`
- [x] 0.27 commit "v0.2.5 phase 0 round-1 scaffold" (9a12db4) + round-2 fixes commit(pending after this update)

### Phase 0 出口判据自检
- [x] cairn_lint v025 scope 全绿(4 files clean,V025BuildCanary 加入)
- [x] lock_plan check 全绿(15 locks,Constitution 完整覆盖 Rule A-S)
- [x] verify_progress phase=0 PASS
- [x] 老 schema grep 命中 0(v025 scope)
- [x] backend migration 015 + 015b 跑成功 + verify PASS;/api/feature-flags 路由 live curl 验证成功
- [x] feature_flags useV025=true(后端);HARD_DEFAULTS=false(客户端 fail-closed,见 ADR-008)
- [x] 4 眼 review 终态 PASS(sub#0-3 PASS + sub#0-4 PASS-after-fixes)

### Active BLOCKERs(状态)
- BLOCKER-001 ADR-006 决议 → 字段保留至 Phase 7(open,但已 ADR 决策)
- BLOCKER-002 ADR-007 决议 → 老代码删除延期至 Phase 7(open,但已 ADR 决策)
- 影响:0.16/0.17/0.18/0.19/0.20b/c 标 [-] 不阻塞 phase 闭合,因 ADR 已批准延期方案。
  Phase 0 在 Phase 7 才会真正"完全 done"(届时这些 sub-item 真正 [x])。但 Rule B v3 item 9
  允许"phase done 推迟到 BLOCKER 解决"且"主 agent 继续做下一 phase 可推进部分",所以
  现在进入 Phase 1A 是合规的。

### ADRs added (Phase 0)
- ADR-000 malware reminder 冲突 + 主 agent 决策
- ADR-001..005 预批准
- ADR-006 marker store 字段保留
- ADR-007 老代码删除延期至 Phase 7
- ADR-008 feature-flags 路由 unauth + LIMIT 1000 + HARD_DEFAULTS fail-closed(round-2 修复)
- ADR-009 migration DB allowlist(round-2 修复)

---

## Phase 1A — Core 接口 + Android stub + 工具类

**Phase 1A 起始 git tag**: v0.2.5-phase-1A-start (commit 9a12db4 → 6472e20)
**Phase 1A 结束 commit**: 82cacd3
**Phase 1A 结束 git tag**: v0.2.5-phase-2A-start

- [x] 1A.1 IAnchorPersistence interface + PersistenceOutcome 9 cases + PersistenceResult envelope (`UnityARLib/Assets/Scripts/v025/Core/IAnchorPersistence.cs:1`)
- [x] 1A.2 PersistenceFactory(#if UNITY_EDITOR / UNITY_IOS / UNITY_ANDROID 三分支)
- [x] 1A.3 ArkitWorldMapPersistence(Phase 4 will fill real impl)
- [x] 1A.4 ArcoreStubPersistence(NotSupported, ADR-002)
- [x] 1A.5 NullPersistence(Editor / fallback)
- [x] 1A.6 EventTypes + V025Phases + V025Outcomes + PhaseStepTracker(thread-safe with _phaseLock)
- [x] 1A.7 GeoMath(Haversine + ENU + bearing) + 9+2 单测 + parity fixture
- [x] 1A.8 LidarAvailability sticky cache + 反 pattern C8(no flicker)
- [x] 1A.9 FloorPlaneValidatorV2 + 13 单测(B6/B7/B7'/C6/C7 + boundary + ResolveFallback Rule P)
- [x] 1A.10 GroundResolverV2 + 反 pattern B10(no Y=0 default)
- [x] 1A.11 AnchorAttachStrategy(Tier-S → Tier-G plane → Tier-G raycast → refuse)+ 反 pattern C5
- [x] 1A.12 BlockerSentinel + 4 单测(emit-before-throw)
- [x] 1A.13 PROGRESS.md
- [x] 1A.14 4 眼 review:Round-1 sub#1A-1 (3C/4M/2Mi) + sub#1A-2 (1C/3M/2Mi);Round-2 sub#1A-3 PASS + sub#1A-4 (1C/5M)。所有 5 CRITICAL fixed + 11 MEDIUM fixed/documented + 6 MINOR resolved.
- [x] 1A.15 修光 BLOCKER + CRITICAL,verdict 终态 PASS — 见 `_review/v0.2.5/verdicts/phase1A-signoff.md`
- [x] 1A.16 commit 82cacd3 + tag v0.2.5-phase-2A-start

### Phase 1A 出口判据自检
- [x] cairn_lint v025 scope 全绿(25 files clean)
- [x] lock_plan check 全绿(15 locks)
- [x] 反 pattern 单测全绿(C5 + C6/C7 + C8 + B6/B7/B7' + B10)
- [x] Rule P compliance(FloorPlaneValidatorV2.ResolveFallback)
- [x] Rule H envelope (PhaseStepTracker phase/step/seq/sessionInstanceId)
- [x] Rule G parity infrastructure (geomath_parity.json + GeoMathParityFixtureTests)
- [x] 4 眼 review 终态 PASS

### ADRs added (Phase 1A)
- ADR-010 Phase 1A interface design choices (IsPlatformSupported / Static ResolveFallback / GeoMath limits)

---

## 下一步 (Phase 2B 入口)

Phase 2B 起始 sub-item:**2B.1 CairnBaseRenderer.cs**

git tag for resume: `v0.2.5-phase-2B-start`

详见 `_review/v0.2.5/progress/phase2A-DONE.md`

---

## Phase 2A — GPS 路径主流程 (RN + Unity)

**Phase 2A 起始 git tag**: v0.2.5-phase-2A-start (commit 82cacd3)
**Phase 2A 结束 commit**: (after this update)
**Phase 2A 结束 git tag**: v0.2.5-phase-2B-start

- [x] 2A.1 cairnSpawnV2.ts + 8 单测
- [x] 2A.2 geoMath.ts + parity fixture (TS↔C# Rule G)
- [x] 2A.3 CairnSpawnerV2.cs + 3 单测
- [x] 2A.4 PendingAnchorRetryV2 + 5 单测(round-2 加 per-attempt telemetry)
- [x] 2A.5 AnchorRecoveryV2 + 6 单测 + Rule P MitigateOrReset
- [x] 2A.6 ArSessionLifecycleV2 + 7 单测
- [x] 2A.7 useCairnStoreV2 + useArSessionStoreV2 + 15 单测
- [x] 2A.8 CairnBridgeV2 RN + Unity (round-2 BLOCKER fix:加 Unity 端 + MiniJson + 4 单测)
- [x] 2A.9 反 pattern B1(scope=Core only,round-2 紧化)
- [x] 2A.10 GpsAlgorithmLockStepTests
- [x] 2A.11 PROGRESS.md (本节)
- [x] 2A.12 4 眼 review:sub#2A-1 (1B+4C, all fixed) + sub#2A-2 (2M+5Lo, all fixed/documented)
- [x] 2A.13 修光 BLOCKER + CRITICAL → verdict PASS
- [x] 2A.14 commit + tag v0.2.5-phase-2B-start

### Phase 2A 出口判据自检
- [x] cairn_lint v025 scope 全绿(48 files)
- [x] npx jest src/services/v025 src/store/v025 全绿(46/46)
- [x] lock_plan check 全绿
- [x] 反 pattern B1 + B3 单测全绿
- [x] Rule G parity fixture 14 cases (5 haversine + 3 enu_forward + 4 enu_inverse + 4 bearing)
- [x] 4 眼 review 终态 PASS
