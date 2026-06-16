# Phase 0 — DONE Report

**Phase**: 0
**完成时间**: 2026-06-17
**git tag**: v0.2.5-phase-1A-start (next phase start)

## Sub-items completed
- [x] 0.0a-d 预扫(backend / RN / .env / Python deps)
- [x] 0.1 cairn_lint.py(C.1 forbidden phrases + C.2 catch type + Rule P Monitor mitigation)
- [x] 0.2 verify_progress.py(commit + AST + ADR expiration + utf-8)
- [x] 0.3 lock_plan.py(SHA-256 lock with code-fence-aware extraction)
- [x] 0.4 visual_compare.py(SSIM, HTML demo baseline)
- [x] 0.5 / 0.5b / 0.6 pre-commit hook + self-check + violation simulation
- [x] 0.7 ADR-001..005 预批准
- [x] 0.8-0.10 templates(BLOCKER / ADR / phase-DONE / signoff)
- [x] 0.10a-e Test framework(manifest test-framework 1.4.5 + asmdef Runtime + Tests + jest)
- [x] 0.11-0.12 v025 directory tree(Unity + RN + backend + Plugins/iOS)
- [x] 0.13 backend migration(015 + 015b + run-migration.js + assertSafeDb allowlist)
- [x] 0.14 ARScreen.tsx → ARScreenLegacy.tsx + new ARScreen wrapper(useV025 routes V2 / Legacy)
- [x] 0.15 feature_flags table + featureFlagsClient + /api/feature-flags backend route(LIMIT 1000)
- [-] 0.16 — BLOCKER-001 → ADR-006 deferred to Phase 7
- [-] 0.17-0.19 — BLOCKER-002 → ADR-007 deferred to Phase 7
- [x] 0.20a grep done; 0.20b/c deferred per ADR-007
- [x] 0.20d Unity compile sanity(no .cs changed)
- [x] 0.21a v025 scope grep老schema = 0
- [-] 0.21b/c deferred per ADR-007
- [x] 0.22 retrofit lint --scope all:42 violations all in legacy code, 0 in v025 scope
- [x] 0.23 lock_plan write + check(15 locks, Constitution 5977 chars Rule A-S)
- [x] 0.24 PROGRESS.md
- [x] 0.25-0.26 4 眼 review(2 rounds, 4 subagents total)
- [x] 0.27 commit(round 1 commit 9a12db4 + round 2 commit pending after this report)

## 4-eye review verdicts
- Round 1:
  - Sub-agent #0-1: NEEDS_REVISION → all 5 issues fixed → see verdicts/phase0-sub1.md
  - Sub-agent #0-2: NEEDS_REVISION → all 6 issues fixed → see verdicts/phase0-sub2.md
- Round 2:
  - Sub-agent #0-3: PASS (12/12 checklist) → see verdicts/phase0-sub3.md
  - Sub-agent #0-4: NEEDS_REVISION → all 5 newly-found issues fixed → see verdicts/phase0-sub4.md
- Main agent reconciliation: ALL_PASS_AFTER_FIXES → see verdicts/phase0-signoff.md
- ready_for_next_phase: true

## BLOCKERs encountered
- BLOCKER-001 → resolved by ADR-006(marker store fields kept till Phase 7)
- BLOCKER-002 → resolved by ADR-007(old code deletion deferred to Phase 7)

Round-1 + round-2 reviewer-found BLOCKERs / CRITICALs(11 total)were all fixed in same round.

## ADRs added
- ADR-000 malware reminder conflict
- ADR-001 Tier-S→Tier-G fallback
- ADR-002 Android not built
- ADR-003 Android stub test scope
- ADR-004 Visual degradation feature flag
- ADR-005 SDF texture from v0.2.4
- ADR-006 Marker store fields retained
- ADR-007 Old code deletion deferred to Phase 7
- ADR-008 Feature flags public read + fail-closed
- ADR-009 Migration DB allowlist

## Lint / verify_progress / lock_plan status
- cairn_lint --scope v025: PASS (4 files clean — V025BuildCanary canary added)
- verify_progress --phase 0: PASS
- lock_plan --mode check: PASS (15 locks, Constitution full Rule A-S coverage)

## Backend migration status
- markers table: 10 test rows deleted, +space_id +has_worldmap +anchor_kind columns
- feature_flags table: created, useV025='true' seeded
- /api/feature-flags route: live + verified curl returned {flags:{useV025:'true'}}

## Next phase entry point
- Phase 1A sub-item 1A.1 — IAnchorPersistence.cs

git tag for resume: v0.2.5-phase-1A-start
