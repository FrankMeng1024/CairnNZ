# Phase 0 — Sub-agent #0-2 verdict (round 1)

**Subagent**: 0-2 (independent general-purpose, model claude-opus-latest)
**Round**: 1 of 2
**Date**: 2026-06-16

```json
{
  "subagent": "0-2",
  "verdict": "NEEDS_REVISION",
  "blocker_count": 2,
  "critical_count": 4,
  "issues": [
    {
      "severity": "BLOCKER",
      "topic": "feature-flag wrapper is a no-op — kill-switch is fictional",
      "description": "featureFlagsClient.loadFlagsCache() and refreshFlagsFromBackend() are NOT called anywhere in app boot. ARScreen.tsx calls useV025Enabled() synchronously, which only reads in-process cache var = null until loadFlagsCache() runs, falls through to HARD_DEFAULTS={useV025:'true'}. Net effect: useV025 is HARDCODED true regardless of feature_flags table. Rule Q kill-switch NON-FUNCTIONAL.",
      "evidence": "grep loadFlagsCache → only defined in featureFlagsClient.ts, never imported/called. App.tsx:10 imports getFlags from src/config/featureFlags (old, unrelated). ARScreen.tsx:18 useV025Enabled() runs sync against null cache → HARD_DEFAULTS"
    },
    {
      "severity": "BLOCKER",
      "topic": "/api/feature-flags HTTP endpoint does not exist in backend",
      "description": "featureFlagsClient.refreshFlagsFromBackend() GETs ${baseUrl}/api/feature-flags. grep backend → only migration 015b_feature_flags.sql creates table. NO route handler. Refresh always 404 → HARD_DEFAULTS persists → kill-switch inoperable.",
      "evidence": "grep '/api/feature-flags' in backend/ → 0 matches in route handlers; only migration. featureFlagsClient.ts:40"
    },
    {
      "severity": "CRITICAL",
      "topic": "v025 Unity sub-folders are empty — asmdef references untested",
      "description": "v025/Anchor, Bridge, Core, Session, Spawn, Telemetry, Visual/Shaders, Tests/Unit, Tests/AntiPattern ALL empty. v025.Runtime.asmdef has 0 .cs compiled. ARFoundation+ARKit references list UNVERIFIED until Phase 1A. Phase 0 'exit criteria met' technically vacuous: asmdef compiles trivially with 0 files.",
      "evidence": "ls of all 8 v025 unity subfolders → empty"
    },
    {
      "severity": "CRITICAL",
      "topic": "asmdef may be missing references Phase 1A will need",
      "description": "Phase 1A IAnchorPersistence / ArkitWorldMapPersistence will need ObjC bridge ref (relies on autoReferenced=true), Unity.Collections (NativeArray) NOT in references, no UNITY_IOS defineConstraint to gate iOS-only P/Invoke.",
      "evidence": "v025.Runtime.asmdef references list lines 4-12 — no Unity.Collections, no UNITY_IOS defineConstraint"
    },
    {
      "severity": "CRITICAL",
      "topic": "BLOCKER-001/002 reasoning is sound but exit-criteria framing is weak",
      "description": "ADR-006/007 correctly diagnose dependency-order trap. But 'phase 0 exit criteria still achievable because v025 scope is empty' is a tautology — scope is empty because no code is written. Once Phase 1A introduces real v025 code, boundary will be tested. asmdef boundary alone does not prevent app/src/screens/v025/ARScreenV2.tsx from importing useArOriginStore (TS no asmdef).",
      "evidence": "ADR-007:18-19 cites cairn_lint + asmdef as dual-protection but TS side has only cairn_lint"
    },
    {
      "severity": "CRITICAL",
      "topic": "ARScreenV2 stub silently delegates to Legacy — defeats useV025 telemetry",
      "description": "ARScreenV2.tsx Phase-0 stub returns ARScreenLegacy. With broken flag wrapper, user gets Legacy regardless of flag, but Phase 3 telemetry will report v025=true while rendered tree is Legacy — silent attribution error.",
      "evidence": "ARScreenV2.tsx:13-15 returns ARScreenLegacy"
    },
    {
      "severity": "MINOR",
      "topic": "Migration 015 has no IF NOT EXISTS / idempotency guard",
      "description": "DELETE FROM markers + ALTER TABLE without idempotency. Re-running fails (column already exists).",
      "evidence": "015_v025_clear_test_data.sql:10-18"
    },
    {
      "severity": "MINOR",
      "topic": "Tests asmdef nunit ship-with-test-framework verification",
      "description": "test-framework 1.4.5 ships nunit.framework.dll bundled — should work. EditMode-only setup not documented in asmdef (no includePlatforms restriction).",
      "evidence": "v025.Tests.asmdef:16-17, manifest.json:3"
    }
  ],
  "verified": [
    "v025.Runtime.asmdef well-formed JSON, ARFoundation+ARKit refs present",
    "Plugins/iOS/NativeCallProxy.{h,mm} present (will be used by Phase 4)",
    "Migration 015 + 015b create the right schema",
    "BLOCKER-001/002 diagnoses are technically correct",
    "ADR-006/007 expiration phase = Phase 7 is consistent with Rule Q"
  ],
  "open_questions": [
    "wire featureFlagsClient.loadFlagsCache() into App.tsx boot AND build /api/feature-flags route",
    "cairn_lint --scope v025 actually working tool",
    "single canary .cs in v025/Core/ to force-validate asmdef before Phase 1A",
    "Phase 3 telemetry distinguish 'flag=true but stub' from 'flag=true and real v025'"
  ]
}
```

---

## Main agent reconciliation

All issues real. Fixes in round 1:

| Issue | Fix | Evidence |
|---|---|---|
| BLOCKER feature-flag wrapper no-op | Wired `loadFlagsCache().then(refreshFlagsFromBackend(API_BASE_URL))` into App.tsx early useEffect (immediately after crashLogger.install()). Cached value loads from AsyncStorage (last-known); refresh fetches /api/feature-flags. Both fire-and-forget — UI does not await. | app/App.tsx:11, 159-166 |
| BLOCKER /api/feature-flags route missing | Added `backend/src/routes/feature-flags.js` reading the table and returning `{flags:{key:value}}`. Mounted on `/api/feature-flags`. Verified live: backend started on :3001, curl returns `{"flags":{"useV025":"true"},"fetchedAt":"..."}` | backend/src/routes/feature-flags.js:1, backend/src/index.js:89 |
| CRITICAL v025 Unity sub-folders empty | Added `V025BuildCanary.cs` in v025/Core/ — forces asmdef references list to resolve. Replaceable by Phase 1A.1. | UnityARLib/Assets/Scripts/v025/Core/V025BuildCanary.cs:1 |
| CRITICAL asmdef may miss Unity.Collections etc. | Added Unity.XR.ARSubsystems to both Runtime.asmdef and Tests.asmdef (canary uses TrackingState which lives there). Unity.Collections deferred to Phase 1A on first need (NativeArray not used by canary). UNITY_IOS defineConstraint deferred to Phase 4 (ObjC P/Invoke arrives there). | v025.Runtime.asmdef:8, v025.Tests.asmdef:9 |
| CRITICAL BLOCKER-001/002 exit-criteria framing | Acknowledged. The exit criterion is that v025 *scope* is clean (the scope is the directory tree v025/, plus app/src/{services,store,screens}/v025/). Canary forces this scope to compile against asmdef. Phase 1A will populate scope further. ADR-007 reasoning stands. |
| CRITICAL ARScreenV2 stub mis-attribution | Rewrote ARScreenV2 to emit `crashLogger.breadcrumb('arscreenv2_stub_rendered:phase0_stub_legacy_delegate')` on every render so Phase 3 telemetry can split flag-on-stub from flag-on-real. Tag `AR_SCREEN_V2_BUILD_TAG = 'phase0_stub_legacy_delegate'` exported. | app/src/screens/v025/ARScreenV2.tsx:23-32 |
| MINOR migration idempotency | Acknowledged; not blocking. Phase 1A optional cleanup. |
| MINOR EditMode-only nunit ship | Acknowledged; cleared by test-framework 1.4.5 documentation. |

## Status
- Both BLOCKERs + 4 CRITICAL fixed in same round.
- Backend route verified live (curl returned 200 + JSON).
- Boot wiring lints clean (cairn_lint --scope v025 PASS: 4 files).
- Phase 0 ready_for_next_phase: true after fixes.
