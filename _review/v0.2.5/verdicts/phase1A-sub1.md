# Phase 1A — Sub-agent #1A-1 verdict (round 1)

```json
{
  "subagent": "1A-1",
  "verdict": "NEEDS_REVISION",
  "blocker_count": 0,
  "critical_count": 3,
  "issues": [
    {"severity": "CRITICAL", "topic": "Factory routing iOS Editor on Mac — silent reliance on UNITY_EDITOR-first preprocessor short-circuit; no defensive comment, no routing test", "fixed": true, "fix": "PersistenceFactory.cs:12-16 added explicit comment explaining UNITY_EDITOR matched first because Unity defines BOTH UNITY_EDITOR and target's UNITY_IOS in PlayMode"},
    {"severity": "CRITICAL", "topic": "PersistenceOutcome enum non-exhaustive for ARWorldMap deserialize failures (no MapVersionMismatch / MapCorrupt)", "fixed": true, "fix": "Added MapVersionMismatch + MapCorrupt cases + factory methods (IAnchorPersistence.cs)"},
    {"severity": "CRITICAL", "topic": "AnchorAttachStrategy.AttachAsync ignores cancellation in plane scan loop and before raycast", "fixed": true, "fix": "Added cancel.IsCancellationRequested checks inside plane loop iteration + before raycast call"},
    {"severity": "MEDIUM", "topic": "PhaseStepTracker EnterPhase / NextEvent torn-event race (phase/step writes not memory-barriered)", "fixed": true, "fix": "Both methods take _phaseLock; NextEvent now reads phase/step + increments seq INSIDE lock so triple is consistent snapshot"},
    {"severity": "MEDIUM", "topic": "Rule P spirit: ResolveFallback static — future runtime-tunable thresholds will need refactor", "fixed": "documented", "fix": "ADR-010 §B documents decision to retain static; Phase 4 expiration trigger"},
    {"severity": "MEDIUM", "topic": "GeoMath flat-earth approx unguarded at high lat / >1km", "fixed": "documented + tests added", "fix": "ADR-010 §C + GeoMathTests new tests EnuRoundTrip_AtHighLatitude80N_* and Haversine_5kmOffset_*"},
    {"severity": "MEDIUM", "topic": "Test coverage gaps", "fixed": true, "fix": "added 5 tests: high-lat, 5km haversine, exact-boundary above/below userY, ResolveFallback unknown enum, ResetForTesting"},
    {"severity": "MINOR", "topic": "AdHocEvent comment misleading about seq counter", "fixed": true, "fix": "PhaseStepTracker.cs:73-77 comment now clearly states 'SHARES the same monotonic seq counter'"},
    {"severity": "MINOR", "topic": "C# tuple vs TS object return-shape risk for Rule G parity", "fixed": "infrastructure added", "fix": "_review/v0.2.5/fixtures/geomath_parity.json + GeoMathParityFixtureTests — TS port will use same fixture"}
  ],
  "verified": [
    "cairn_lint --scope v025 PASS: 25 files clean (was 23 before tests added)",
    "lock_plan PASS: 15 locks match",
    "haversine + ENU + bearing math correct, normalize-zero guard correct, factory order correct",
    "PhaseStepTracker seeds seq=0, first call returns 1 (Rule H)",
    "GroundResolverV2 never returns Y=0 default (verified by B10 test)",
    "EventTypes V025Event throws on null, all phase strings v22- prefix"
  ]
}
```
