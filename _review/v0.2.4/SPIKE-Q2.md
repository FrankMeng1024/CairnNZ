# SPIKE-Q2 — Cross-session ARKit drift simulation in Editor

**Date**: 2026-06-14
**Author**: Arch (research only, no code written)
**Stack**: Unity 6000.0.76f1, ARFoundation 6.0.5, ARKit 6.0.5, XR Core-Utils 2.5.1

---

## Final Verdict (top)

- **BEST APPROACH**: **B (XROrigin offset on simulated session restart)**, with **A as a fallback unit-level harness**.
- **IMPLEMENTABLE TODAY**: **YES** for B + A. **NO** for true ARKit-level world-frame replay (that needs a real-device + ARWorldMap, out of Editor scope).
- **FIDELITY CEILING**: B reproduces the user-visible bug class (cairn-in-sky, sunk-in-floor, lateral shift) at high fidelity because the cairn is parented to `ARAnchor.transform` and the camera is parented to `XROrigin` — translating XROrigin moves the world relative to anchors *exactly* as ARKit does on relocalize.
- **IF NOT VIABLE FALLBACK**: aliyun `debug_snapshots` + `telemetry_sessions` `v22-PLANT-ANCHOR-DRIFT-DETECTED` + `v22-CROSS-SESSION-SNAP` already log `(initialPos, nowPos)` deltas; for full B-Apple coverage we need `v0.2.5` EAS build emitting `worldMappingStatus` + `arOrigin.transform` per frame. Spike B does **not** replace that — it only validates fix logic.

---

## Approach A — Synthetic 4×4 transform on ARAnchor positions

**Verdict**: **VIABLE WITH CONDITIONS** (unit-level only).

**Evidence**:
- `ARAnchor` (ARFoundation 6) inherits `MonoBehaviour`. Its `transform.position` is **driven each frame** by the `XRAnchorSubsystem` from native pose data. Direct `anchor.transform.position = ...` writes are silently overwritten next subsystem update tick — confirmed pattern in repo `AnchorDriftMonitor.cs:18-19` ("先前 R1 让 drift > 阈值时强制 transform.position = _initialWorldPos snap 回去 ... self-correct 跟 refine 打架").
- `ARAnchor` exposes no public `SetPose` / `MutatePose`. Public surface: `trackableId`, `trackingState`, `sessionId`, `pending` (read-only).
- Workaround: cairns are already parented `container.transform.SetParent(a.transform, worldPositionStays: true)` at `PortalSpawnerV199.cs:896, 920`. Wrap each ARAnchor in a synthetic parent GO and translate the parent — mathematically equivalent to drift, but the subsystem will fight back the moment it ticks (every frame in PlayMode).
- In **Edit mode + headless** (`ARSpikeAutoRun` pattern), no XR subsystem ticks. Pure-math assertions on a fake `Pose` work fine — that's exactly what `ARSpikeAutoRun.RunHeadless()` already proves at lines 30-56.

**Cost**: ~80 LOC headless test extending `ARSpikeAutoRun` to assert "given anchor at P1, cairn parent at P2, after applied 4×4 drift D, cairn world position = D · P1 · localOffset".

**Fidelity**: Validates the **math** of any future "re-attach anchor on drift" fix. Does **not** reproduce the user-visible cairn-in-sky animation. Only catches Tier-A vs Tier-B sessionOffset mistakes (already covered).

---

## Approach B — XROrigin offset on simulated session restart

**Verdict**: **VIABLE** — **best fidelity available in Editor**.

**Evidence**:
- `Unity.XR.CoreUtils.XROrigin` is a normal MonoBehaviour with mutable `transform`. `SceneSetup.cs:131` constructs it: `xrOriginGo.AddComponent<Unity.XR.CoreUtils.XROrigin>()`. The AR camera lives under `Camera Offset` under XROrigin.
- ARFoundation's documented model (per Unity manual on XR Origin and `XRInputSubsystem.TrySetTrackingOriginMode`): **all tracked-space coordinates are reported in the XROrigin's local space, and XROrigin's transform converts them to world space**. Translating/rotating `XROrigin.transform` shifts every tracked anchor's world position by exactly that delta — the camera moves with it because it is a child.
- However, anchors are also reported by the subsystem in tracked space, so the *world* delta between camera and anchor remains the same after an XROrigin-only translation. To produce the **drift** illusion (anchor world position changes relative to the real-world floor) we apply the offset only to the **camera offset child** (or equivalently rotate XROrigin while leaving the anchor's tracked-space pose). The asymmetry is what visualizes as "cairn in sky".
- Cleanest in-Editor recipe (no native ARKit needed):
  1. Run the scene in PlayMode under **XR Simulation** loader (already configured: `XR/Loaders/SimulationLoader.asset`, `XRSimulationRuntimeSettings.asset`).
  2. Plant a cairn → ARAnchor created → cairn parented to anchor.
  3. "End session 1" = stop PlayMode, OR call `LoaderUtility.Deinitialize()` → `Initialize()` on the active `XRGeneralSettings.Manager` (documented runtime API). This destroys the simulation session; ARAnchorManager flushes anchors.
  4. Before re-init, translate `XROrigin.transform` by a synthetic `(Δx, Δy, Δz)` representing ARKit's session-2 origin shift.
  5. Persist cairn world pose via existing `CrossSessionGroundSnap` IMMORTAL-state path (it already enumerates IMMORTAL cairns; we feed it the pre-stop world position).
  6. Re-init loader → new session, anchor pool empty, cairn now sits at session-1 world coordinates which now correspond to session-2 floor + Δy → **floats**.
- `XRGeneralSettings.Manager.activeLoader.Stop()` / `Start()` is supported on XR Simulation; it is the same path the editor uses on PlayMode toggle.

**Cost**: ~150 LOC EditorCoroutine harness driving Enter/Exit PlayMode programmatically (the technique referenced in `ARSpikeAutoRun.cs:21-23`). Reuses existing `SceneSetup.cs` scene wiring and `XRSimulationRuntimeSettings.asset`. No new packages.

**Fidelity**: **High** for B-Apple / B4-2 / C bug classes — the user actually sees a cairn float, sink, or shift laterally, exercised through the live `CrossSessionGroundSnap` path. Does **not** reproduce ARKit's continuous SLAM refinement (single-frame jump only).

---

## Approach C — Mock ARRaycastManager drift injection

**Verdict**: **NOT VIABLE** for this question.

**Evidence**:
- `ARRaycastManager.Raycast(...)` is `sealed` in ARFoundation 6 (no virtual hooks); its underlying `XRRaycastSubsystem` is not user-pluggable without forking the package.
- Even if mockable, raycast drift is not the bug. The user bug is **stored anchor pose persisting across sessions while ARKit's world frame moves underneath it**. Raycast hits in session 2 are *correct* — the anchor pose from session 1 is wrong.
- Confirmed by reading repo `PortalSpawnerV199.cs:887-893`: raycast is one-shot at plant time; nothing reads it again on session restart.

**Cost**: prohibitive (fork package), wrong layer.
**Fidelity**: zero for cross-session drift.

---

## Approach D — XR Simulation programmatic origin reset

**Verdict**: **VIABLE WITH CONDITIONS** — equivalent to B but rougher.

**Evidence**:
- `XRSimulationRuntimeSettings.asset` and `XRSimulationPreferences.asset` exist in repo (per `git status`); both are ScriptableObjects without runtime-mutation API in ARFoundation 6.0.5. Modifying them at runtime requires `EditorUtility.SetDirty` + asset re-import — not cleanly reversible mid-session.
- The Simulation environment (room mesh, planes) loads from a prefab referenced in the settings asset. There is no public "shift environment origin by Δ" API. You can swap the environment prefab between session 1 and session 2 (different room → different plane Y) which approximates B-Apple but is not parameterized drift.
- Net: D collapses into B once you accept that the cleanest lever is `XROrigin.transform`, not the simulation settings asset.

**Cost**: similar to B (~150 LOC) but with extra asset re-import overhead and brittle to package upgrades.
**Fidelity**: same as B for floor-plane Y shift; worse for arbitrary 4×4 drift because environment prefab is rigid.

---

## Recommendation

1. **Today**: extend `ARSpikeAutoRun` with Approach A unit tests covering the B4-2 self-correct math (the R2 reverted code) so we don't regress when v0.2.5 re-introduces re-attach logic.
2. **Sprint 1 of v0.2.4 Q2**: implement Approach B as `ARSpikeAutoRun_PlayMode.cs` driving `XRGeneralSettings.Manager.activeLoader.Stop/Start` + `XROrigin.transform` translation. Verify `CrossSessionGroundSnap.SnapAfterDelay` actually pulls a floating IMMORTAL cairn back to plane.center.y.
3. **Cannot replace real-device telemetry**: B reproduces a *single-frame teleport*, not ARKit's continuous SLAM tug-of-war that `AnchorDriftMonitor.cs:9-16` describes. Keep aliyun `debug_snapshots` + `telemetry_sessions` `v22-PLANT-ANCHOR-DRIFT-DETECTED` as the source of truth for B-Apple / B3 (`worldMappingStatus`) which **only ARKit reports** — XR Simulation has no equivalent signal.

---

## Files referenced (absolute paths)

- C:\ClaudeCodeProjects\Cairn\UnityARLib\Assets\Scripts\PortalSpawnerV199.cs (lines 224, 893, 896, 920 — anchor parenting)
- C:\ClaudeCodeProjects\Cairn\UnityARLib\Assets\Scripts\AnchorDriftMonitor.cs (lines 9-19 — why direct mutation fails)
- C:\ClaudeCodeProjects\Cairn\UnityARLib\Assets\Scripts\CrossSessionGroundSnap.cs (lines 40-50, 113-160 — the snap path B will exercise)
- C:\ClaudeCodeProjects\Cairn\UnityARLib\Assets\Editor\ARSpikeAutoRun.cs (lines 21-56 — proven headless pattern, A reuses it)
- C:\ClaudeCodeProjects\Cairn\UnityARLib\Assets\Editor\SceneSetup.cs (lines 129-133 — XROrigin construction lever for B)
- C:\ClaudeCodeProjects\Cairn\UnityARLib\Packages\manifest.json (ARFoundation 6.0.5, XR Core-Utils 2.5.1)
- C:\ClaudeCodeProjects\Cairn\UnityARLib\Assets\XR\Loaders\SimulationLoader.asset (B's runtime loader)

Word count: ~770.
