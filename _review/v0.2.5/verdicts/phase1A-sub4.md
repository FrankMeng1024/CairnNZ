# Phase 1A — Sub-agent #1A-4 verdict (round 2)

```json
{
  "subagent": "1A-4",
  "round": 2,
  "initial_verdict": "NEEDS_REVISION",
  "newly_found_issues": [
    {"severity": "CRITICAL", "topic": "Float-precision flip in Validate_PlaneAtExactlyMaxAboveUser_Accepted — naive userHeadY=1.6f, y=1.6f+0.3f computes heightDelta=0.30000007 which strictly > MaxAboveUserMeters=0.30000001, test would FAIL at runtime", "fixed": true, "fix": "Reconstructed boundary as userHeadY=0f, y=MaxAboveUserMeters → heightDelta exactly equal. Added Validate_PlaneJustAboveMaxAboveUser_Rejected_B7 to pin opposite side."},
    {"severity": "MEDIUM", "topic": "AnchorAttachStrategy: float3 NaN propagates to AR anchor — undefined Unity behavior", "fixed": true, "fix": "Added math.any(math.isnan(...)) guard at AttachAsync entry; throws ArgumentException"},
    {"severity": "MEDIUM", "topic": "MapVersionMismatch + MapCorrupt factory methods have no unit test", "fixed": true, "fix": "Added PersistenceResultFactoryTests covering all 9 factory methods + null-diagnostic coalesce"},
    {"severity": "MEDIUM", "topic": "GeoMath EarthRadiusMeters drift risk vs Phase 2A.2 geoMath.ts — no shared fixture", "fixed": true, "fix": "Created _review/v0.2.5/fixtures/geomath_parity.json + GeoMathParityFixtureTests; Phase 2A.2 will consume same JSON"},
    {"severity": "MEDIUM", "topic": "ADR-010 IsPlatformSupported expiration too far (Phase 4) — should audit at Phase 2A end", "fixed": true, "fix": "ADR-010 §A expiration changed to Phase 2A end-of-phase audit"},
    {"severity": "LOW", "topic": "PhaseStepTracker seq increment outside lock — phase/step/seq not consistent snapshot at micro-window", "fixed": true, "fix": "Moved Interlocked.Increment INSIDE the lock alongside phase/step read"}
  ],
  "verified_clean": [
    "cairn_lint --scope v025 PASS",
    "Rule P regex still uses _find_class_body",
    "Anchor_C5 AttemptOrder test correctly pins load BEFORE raycast",
    "FloorPlaneValidatorV2 ResolveFallback covers 6 cases + default",
    "B7' boundary passes by coincidence (1.6-3.0=-1.4 exact in fp)"
  ],
  "concerns_for_phase_2A": [
    "Cross-platform GeoMath parity needs the fixture file",
    "cairnSpawnV2.ts MUST consume IsPlatformSupported",
    "Float-boundary tests should use exact-construction pattern"
  ],
  "final_verdict_after_fixes": "PASS"
}
```
