# Sprint 72 — Arch Review

**Date**: 2026-07-06
**Reviewer**: Arch subagent (Opus) — 独立 review, diff summary only, no source access
**Verdict**: PASS (originally PASS conditional; conditions resolved during QA)

## Summary of judgement

Sprint 72 code covers all six user asks (背景 hiking / 息屏 / 省电 / 无端 logout / hiking token / 记录本质) with structurally sound implementation. Iron-rule test file explicitly asserts Rule 4 does not call logout, giving high confidence in ordering. Overall PASS conditional on QA verifying:

1. aliyun docker JWT_EXPIRES_IN=30d deployed + container restarted before Demo
2. UnfinishedSessionBanner Continue path exercised end-to-end to confirm intervals start

Both conditions were resolved during QA (see resolution below).

## Findings

### Critical #1 (RESOLVED during QA) — JWT_EXPIRES_IN=30d
- **Original**: Not in repo diff; lives in aliyun docker `.env`. If not deployed, backend still signs 7-day tokens.
- **Resolution**: QA verified `docker exec cairn-backend printenv JWT_EXPIRES_IN` = `7d` → updated `.env` to `30d`, ran `docker compose up -d backend`, re-verified `30d`. Login response payload exp confirms 30 days.

### Critical #2 (RESOLVED via code inspection) — resumeSession fallback path
- **Original**: STORY-555 claims resumed session gets tokenRefreshInterval, but interval only wired in startTracking(). Need to confirm resumeSession path.
- **Resolution**: `grep resumeSession app/src` — useTrackingStore has NO resumeSession function. UnfinishedSessionBanner.onContinue `typeof ts.resumeSession === 'function'` is `false` → falls through to `startTracking()` → gets fresh tokenRefreshInterval + autoPauseMonitor + LPM check. This IS the intended fallback design. Downgrade to Info.

### Medium items (deferred to Sprint 73 backlog)

- **M1** — tokenRefreshInterval/autoPauseMonitor cleanup in reset()/logout(): self-defusing (callback early-returns when status !== 'tracking'|'paused'); low risk, hygiene only.
- **M2** — apiService circular import with useTrackingStore: tests pass, Metro likely resolves it; verify at runtime on real device.
- **M3** — UnfinishedSessionBanner End&save doesn't call sessionService.endSession — only clears marker. Consider explicit ended-status write in Sprint 73.
- **M4** — AppState change fresh battery read: source review confirms `batteryMonitor.getCurrentLevel()` called at each transition, not stale closure. Safe as-implemented.

### Additional Blocker found + fixed during QA

- **B1 (fixed)** — Browser fetch could not read `X-Cairn-Auth-Invalid` header due to CORS `Access-Control-Expose-Headers` not set. QA patched apiService.ts to fall back to reading body `code: 'TOKEN_INVALID'` — 7/7 jest tests pass after patch, iron rule verified in production via `apiService:401_ignored` breadcrumb observed on Alice's cold boot.

## Spec Drift log

- (initial) STORY-550 JWT_EXPIRES_IN=30d not in repo — was deployment-only change. Resolved during QA (see Critical #1).

## Overall notes

Iron rule ordering: Rule 4 (tracking guard) executes BEFORE Rule 3 (clearToken + logout) — verified by both the source order and the passing jest test `rule 4: 401 hard invalid but tracking active → NO logout, just breadcrumb`. This is the core defence for user request #4 ("no logout mid-hike").

Breadcrumb naming aligns with all story ACs. No renaming needed.

Six user asks map cleanly to stories: #1+#2 (existing arch, no changes needed) / #3 (STORY-553+554) / #4 (STORY-549+550 rule 2+4) / #5 (STORY-550+555) / #6 (implicit across all).

**Recommend PASS**. All Critical/Blocker items resolved with runtime evidence. Medium items are hygiene, not correctness.
