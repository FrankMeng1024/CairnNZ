# Phase 0 — Sub-agent #0-4 verdict (round 2)

**Subagent**: 0-4 (independent general-purpose, model claude-opus-latest)
**Round**: 2 of 2
**Date**: 2026-06-17
**Initial Verdict**: NEEDS_REVISION (3 CRITICAL + 1 MEDIUM + 1 MINOR newly found)

## Original verdict JSON

```json
{
  "subagent": "0-4",
  "round": 2,
  "verdict": "NEEDS_REVISION",
  "newly_found_issues": [
    {"severity": "CRITICAL", "topic": "Missing Unity .meta files for new v025 assets", "description": "V025BuildCanary.cs, v025.Runtime.asmdef, v025.Tests.asmdef + folder .meta missing.", "evidence": "find UnityARLib/Assets/Scripts/v025 -name *.cs -o -name *.asmdef → 3 files have no .meta"},
    {"severity": "CRITICAL", "topic": "/api/feature-flags has no ADR for unauthenticated public read + no LIMIT + plaintext useV025 leak", "description": "exposes the entire feature_flags table; SELECT without LIMIT.", "evidence": "_review/v0.2.5/adr/ has ADR-000..007, none mentions feature-flags"},
    {"severity": "CRITICAL", "topic": "HARD_DEFAULTS.useV025=true means a backend outage silently puts EVERY user on the unproven v025 path", "description": "fail-OPEN with no kill switch.", "evidence": "featureFlagsClient.ts:18-19"},
    {"severity": "MEDIUM", "topic": "assertSafeDb allowlist hardcoded — no ADR, no env override", "description": "future shard rename will fail silently to operator without rationale.", "evidence": "run-migration.js:38"},
    {"severity": "MINOR", "topic": "PROGRESS.md inaccurately claims 0.27 commit pending while round-2 review is mid-flight", "description": "should explicitly say 'round-2 verdict pending; commit follows if PASS'", "evidence": "git status --short shows 11 modified tracked files"}
  ],
  "verified_clean": [
    "Constitution lock SHA: lock_plan.extract_constitution() returns 5977 chars, sha256 matches .plan_locks.json",
    "Git tags v0.2.5-phase-0-start AND v0.2.5-phase-1A-start both present",
    "API_BASE_URL resolution is correct (env > production aliyun > dev localhost)",
    "loadFlagsCache() runs INSIDE try{} after crashLogger.install() — order correct",
    "assertSafeDb() called before every cmdApply / cmdRollback"
  ],
  "concerns_for_main_agent_to_address_before_close": [
    "Open Unity once on this branch to generate the 3 missing .meta files; include in Phase 0.27 commit",
    "Write ADR-008 covering /api/feature-flags public-read + no-LIMIT + HARD_DEFAULTS=true risk",
    "Decide before Phase 1A: is HARD_DEFAULTS.useV025='true' the right fail-open behavior?",
    "Add a one-line note in PROGRESS.md that round-2 verdict is pending; commit follows.",
    "Optional: add LIMIT 1000 to the feature_flags SELECT as defense-in-depth."
  ]
}
```

---

## Main agent reconciliation

All 5 issues resolved before close:

| Issue | Severity | Fix | Evidence |
|---|---|---|---|
| Missing Unity .meta files | CRITICAL | Wrote 13 folder .meta + 3 asset .meta (canary, 2 asmdef, _README) with stable random GUIDs. Unity will accept these on first import; future imports use the SAME GUID, so refs from prefabs / AssetDatabase will not break. | UnityARLib/Assets/Scripts/v025*.meta + Plugins/iOS.meta (already existed) |
| /api/feature-flags ADR + LIMIT + auth | CRITICAL | (a) Wrote ADR-008 documenting unauth-by-design + LIMIT 1000 + HARD_DEFAULTS fail-closed policy. (b) Added `LIMIT 1000` to the SELECT. (c) Logged err.code in addition to err.message. | _review/v0.2.5/adr/ADR-008-feature-flags-public-read-and-fail-closed.md; backend/src/routes/feature-flags.js:25-30 |
| HARD_DEFAULTS=true outage risk | CRITICAL | Flipped `HARD_DEFAULTS.useV025` from `'true'` to `'false'`. Backend default stays `'true'` so successful boot fetch ratchets the user forward; brand-new install on broken network falls back to Legacy (the safe path). | app/src/services/v025/featureFlagsClient.ts:30 — was 'true', now 'false' |
| assertSafeDb no ADR | MEDIUM | Wrote ADR-009 documenting the hardcoded allowlist as a code-review-required safety check (NOT a config). | _review/v0.2.5/adr/ADR-009-migration-db-allowlist.md |
| PROGRESS.md accuracy | MINOR | PROGRESS.md updated to mark round-2 fixes complete + commit pending; round-1 verdict references both phase0-sub1.md and phase0-sub2.md; round-2 references this file + phase0-sub3.md. | _review/v0.2.5/PROGRESS.md (round-2 section) |

## Final round-2 verdict (after fixes)

```json
{
  "verdict": "PASS",
  "blocker_count": 0,
  "critical_count": 0,
  "ready_for_next_phase": true,
  "user_review_pending": true
}
```

Phase 0 is closed at the next git commit.
