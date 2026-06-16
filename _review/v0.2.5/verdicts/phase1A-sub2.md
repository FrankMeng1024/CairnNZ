# Phase 1A — Sub-agent #1A-2 verdict (round 1)

```json
{
  "subagent": "1A-2",
  "verdict": "NEEDS_REVISION",
  "newly_found_issues": [
    {"severity": "CRITICAL", "topic": "AnchorAttachStrategy.tierSAttachIfRelocalized — pre-LoadAsync precondition leak, parameter name misleading", "fixed": true, "fix": "Renamed to cairnTargetXyzInRelocalizedFrame; XML doc explains caller pre-computes via GeoMath.LatLngToEnuMeters from saved origin"},
    {"severity": "MEDIUM", "topic": "Anchor_C5 anti-pattern test does not pin attempt order", "fixed": true, "fix": "Added AttemptOrder_TierS_BeforePlaneScan_BeforeRaycast test using OrderRecordingPersistence + shared log"},
    {"severity": "MEDIUM", "topic": "Ground_B10 NoHit test does not assert Position == float3.zero", "fixed": true, "fix": "Added Assert.AreEqual(float3.zero, resolved.Position) in NoHit test"},
    {"severity": "MEDIUM", "topic": "EventTypes header comment contradicts actual format (says lower-case-with-hyphen, but constants are UPPER-CASE)", "fixed": true, "fix": "EventTypes.cs:9 reworded to 'Convention: phase is v22-UPPER-HYPHEN, step is lower-hyphen'"},
    {"severity": "MINOR", "topic": "GroundResolverV2 delegate signature mismatch with Phase 4 ARRaycastManager (normalized vs pixel screen coords)", "fixed": "deferred to Phase 4 wiring", "fix": "Phase 4 author will adapt; documented in ADR-010 concerns_for_phase_2A"},
    {"severity": "MINOR", "topic": "IAnchorPersistence.IsPlatformSupported is dead surface in Phase 1A — no consumer", "fixed": "documented", "fix": "ADR-010 §A retains for Phase 2A consumer (UI hint pre-Save); expiration set to Phase 2A end-of-phase audit"}
  ],
  "verified_clean": [
    "Rule C.1 forbidden-phrase scan: 0 hits in v025 Core",
    "Rule C.1 legitimate ADR citation format used correctly (见 ADR-NNN(描述))",
    "Rule P regex satisfied: ResolveFallback matches (Mitigate|Recover|Resolve)\\w*",
    "Rule S: V025Phases.AutoProgress = 'v22-AUTO-PROGRESS' matches plan",
    "Rule H: all 7 V025Phases follow v22- prefix"
  ],
  "concerns_for_phase_2A": [
    "Resolve cairnTargetXyzInRelocalizedFrame semantics in API_SPEC before CairnSpawnerV2.cs writes",
    "geoMath.ts MUST consume _review/v0.2.5/fixtures/geomath_parity.json",
    "PendingAnchorRetryV2 catch must use catch(BlockerSentinelException) not Exception",
    "AnchorRecoveryV2 must reuse same PhaseStepTracker (no seq reset)",
    "useCairnStoreV2 sessionInstanceId must match PhaseStepTracker semantics"
  ]
}
```
