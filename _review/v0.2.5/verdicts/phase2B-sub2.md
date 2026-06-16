# Phase 2B — Sub-agent #2B-2 verdict (round 1)

```json
{
  "subagent": "2B-2",
  "verdict": "NEEDS_REVISION",
  "newly_found_issues": [
    {"severity": "BLOCKER", "topic": "SDF resource dir does not exist", "fixed": true,
     "fix": "Same as #2B-1-B2: PlaceholderTextures runtime fallback + ADR-005 revised"},
    {"severity": "BLOCKER", "topic": "CairnBase shader was deemed missing — actually committed at v025/Visual/Shaders/CairnBase.shader",
     "fixed": "verified existed", "fix": "Confirmed CairnBase.shader present + 3 other URP shaders all in v025/Visual/Shaders/"},
    {"severity": "BLOCKER", "topic": "ARScreenV2 was status panel, not real Unity AR mount + no bridge subscribe", "fixed": true,
     "fix": "Rewrote ARScreenV2: lazy-imports @azesmway/react-native-unity (falls back to status panel in jest/web), wires onUnityMessage → cairnBridgeV2 listeners, subscribes v025/spawn-ok/refused → useCairnStoreV2.confirm/refuse, plant button → spawnCairnV2, retry button on bootError"},
    {"severity": "BLOCKER", "topic": "No prefab asset → CairnAssemblyV2 SpawnAtPosition errors", "fixed": true,
     "fix": "Added V025PrefabFactory.BuildRuntimePrefab(); CairnAssemblyV2.SpawnAtPosition calls EnsurePrefab() which auto-builds a runtime prefab if none registered"},
    {"severity": "CRITICAL", "topic": "Linear stone shrinkage will not match SSIM ≥ 0.65", "fixed": "documented",
     "fix": "ADR-011 documents Phase 2B SSIM gate deferred to Phase 4; designer measures HTML demo profile and exports stoneRadiusByLayer in Phase 4"},
    {"severity": "CRITICAL", "topic": "Phase 2B.9 SSIM gate structurally unrunnable in this session", "fixed": "documented",
     "fix": "ADR-011 documents — Phase 4 EAS build #1 runs Editor capture + Playwright baseline + SSIM compare end-to-end"},
    {"severity": "MEDIUM", "topic": "TypeParticleV2Controller missing RequireComponent + warning", "fixed": "deferred to Phase 4 designer prefab",
     "fix": "Phase 4 prefab will include ParticleSystem child; runtime warning suffices for Phase 2B"},
    {"severity": "MEDIUM", "topic": "EditorCoroutineHost yield handling not validated", "fixed": true,
     "fix": "Same as #2B-1-B1: rewrote with reflection-based pending instruction tracking"},
    {"severity": "LOW", "topic": "CeremonyV2Controller _block null defensive", "fixed": "accepted",
     "fix": "Standard Awake-before-Update Unity lifecycle; not adding belt-and-suspenders"}
  ],
  "verified_clean": [
    "CairnBaseRenderer / CairnTypeIconRenderer RequireComponent + Awake/OnEnable lifecycle safe",
    "CairnAssemblyV2 instance map cleanup (Despawn + replace) correct",
    "URP 17.0.3 + Lighting.hlsl path valid"
  ],
  "concerns_for_phase_3_4": [
    "Phase 3 telemetry must wire CairnSpawnerV2.emit + AnchorRecoveryV2.emit to TelemetryBatcherV2",
    "Phase 4 must: author designer prefab, replace PlaceholderTextures with real SDFs, profile stone shrinkage from HTML demo, capture SSIM baseline + run compare to verify ≥ 0.65",
    "Phase 4 must wire useArOriginStore (lat/lng origin) → cairnLat/Lng in spawn payload (currently hardcoded 0,0 in ARScreenV2)"
  ]
}
```
