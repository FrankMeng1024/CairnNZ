# Phase 2A — Sub-agent #2A-1 verdict (round 1)

```json
{
  "subagent": "2A-1",
  "verdict": "NEEDS_REVISION",
  "blocker_count": 1,
  "critical_count": 4,
  "issues": [
    {"severity": "BLOCKER", "topic": "CairnBridgeV2.cs Unity-side missing", "fixed": true,
     "fix": "Added UnityARLib/Assets/Scripts/v025/Bridge/CairnBridgeV2.cs (305 LOC) + MiniJson + 4 unit tests in CairnBridgeV2Tests.cs"},
    {"severity": "CRITICAL", "topic": "candidateGroundAltM data dropped", "fixed": true,
     "fix": "Removed from MessageTypes.SpawnRequest + cairnSpawnV2.buildSpawnRequest + SpawnRequestInput; test updated"},
    {"severity": "CRITICAL", "topic": "ArSessionLifecycleV2.Teardown race", "fixed": true,
     "fix": "Added Teardown_DuringActiveSpawn_DoesNotBreakSnapshottedTracker test pinning the caller-snapshot pattern"},
    {"severity": "CRITICAL", "topic": "PendingAnchorRetryV2 no per-attempt telemetry", "fixed": true,
     "fix": "Added PhaseStepTracker + Action<V025Event> DI; per-attempt telemetry emit; new SuccessAfterTwoRetries test"},
    {"severity": "CRITICAL", "topic": "ENU inverse parity fixture has only 1 case", "fixed": true,
     "fix": "Added 3 enu_inverse_cases (100m east / 100m north / 200m diagonal); TS parity test consumes them"}
  ],
  "verified": [
    "AntiPattern B1 reflection scoped to v025.Runtime; tests separate asmdef",
    "GeoMath C# / TS constants + formulas line-for-line equivalent",
    "useArSessionStoreV2 vs ArSessionLifecycleV2 are equivalent FSMs",
    "cairn_lint --scope v025 PASS (was 46, now 48)",
    "npx jest 46/46 PASS (was 42, +4 enu_inverse)"
  ]
}
```
