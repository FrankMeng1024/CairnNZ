# SPIKE-Q3a — ARWorldMap / native pose replay in Editor (research only)

**Date**: 2026-06-14
**Author**: Arch (no code written)
**Stack**: Unity 6000.0.76f1, ARFoundation 6.0.5, ARKit 6.0.5
**Sibling**: SPIKE-Q2.md (Approach B = XROrigin offset, single-frame teleport)

---

## Angle 1 — ARWorldMap (2026 status)

**Verdict**: **NOT VIABLE in Editor**, VIABLE on real iOS device only.

**Evidence** (read directly from package cache):
- `Library/PackageCache/com.unity.xr.arkit@d7def32d6bb7/Runtime/ARWorldMap.cs` — `public struct ARWorldMap` with `Serialize(Allocator)` + `static TryDeserialize(NativeArray<byte>, out ARWorldMap)`. **C# wrapper exists** — invalidates the prior v0.2.5-plan claim "no C# wrapper".
- `ARKitSessionSubsystem.cs:125-151`: `worldMappingStatusSupported`, `worldMappingStatus` (returns `ARWorldMappingStatus`), `ApplyWorldMap(ARWorldMap)`, `GetARWorldMapAsync()` — all public.
- BUT every entry point routes to `Api.UnityARKit_*` P/Invoke into `XRSimulationSubsystem`/`UnityARKit` native libs that ship **iOS-only** (line 614 stub: `UnityARKit_Session_GetNotTrackingReason → Unsupported`).
- Result: in macOS Editor under XR Simulation, `worldMappingStatusSupported == false`, `ApplyWorldMap` no-ops, `GetARWorldMapAsync()` returns invalid handle. The wrapper is real, the runtime is iOS-bound.
- China region: ARKit world tracking + ARWorldMap **work** on iOS in CN — Apple has not gated ARWorldMap by region (only Apple-Maps-backed services). Prior v0.2.5 memo was incorrect on both points; correct constraint is **platform** (iOS only), not region.

**Cost**: irrelevant — Editor cannot host the binary regardless of effort.
**Fidelity vs Approach B**: N/A in Editor. On-device WorldMap export → re-load **does** reproduce real SLAM relocalization, but only on device — i.e. it equals telemetry, not Editor sim.

---

## Angle 2 — ARFoundation session record/playback

**Verdict**: **NOT VIABLE**.

**Evidence** (grep over both package caches):
- Zero matches for `ARRecordingMode`, `ARPlaybackMode`, `StartRecording`, `StartPlayback`, `SetPlaybackDataset` in `com.unity.xr.arfoundation@6.0.5` or `com.unity.xr.arkit@6.0.5`.
- Only hits are `Samples~/InputRecorder/` inside `com.unity.inputsystem` — that records keyboard/mouse/InputAction state, **not** ARFrame.
- ARCore has a Recording/Playback API (`Session.startRecording(RecordingConfig)`); ARFoundation does **not** expose a cross-platform wrapper for it. ARKit has no equivalent native API at all — Apple's `ARSession` exposes `setWorldOrigin` and `pause/run(_:options:)` but no frame-stream record/replay.
- Net: there is no "record on device, replay in Editor" path through ARFoundation 6.0.5.

**Cost**: prohibitive — would require forking ARFoundation + writing both recorder and a custom XR provider.
**Fidelity vs B**: would have been higher (real frame stream), but path does not exist.

---

## Angle 3 — Synthetic pose injection into XR Simulation

**Verdict**: **VIABLE — best fidelity available in Editor, strictly better than Approach B**.

**Evidence**:
- `com.unity.xr.arfoundation@6.0.5/Runtime/Simulation/Subsystems/SimulationCameraPoseProvider.cs:65-78`: every `InputSystem.onAfterUpdate` tick computes a pose via `CameraFPSModeHandler.CalculateMovement(...)` then calls `UpdatePose(pose)` → `[DllImport("XRSimulationSubsystem")] SetCameraPose(x,y,z, qx,qy,qz,qw)`. **This is the documented pose feed for XR Simulation's anchor/plane subsystems.**
- `SimulationCameraPoseProvider.GetOrCreateSimulationCameraPoseProvider()` is `internal static` — reachable via reflection (assembly `Unity.XR.Simulation`).
- Strategy: subscribe a custom handler to `InputSystem.onAfterUpdate` (after the built-in one), then **either** (a) replace the FPS-handler-derived pose with a scripted "drift sequence" (e.g. walk pose for 5 s, then inject Δy = +0.4 m + slow yaw drift to mimic ARKit relocalize tug-of-war), **or** (b) call `SetCameraPose` directly via reflection on the same DllImport entry. The XRSimulationAnchorSubsystem reads the resulting pose and reports anchors **as if** SLAM moved underneath them — which is exactly the B-Apple / B4-2 phenomenon.
- `ISimulationSessionResetHandler.OnSimulationSessionReset()` (internal, same package) gives the anchor-flush hook for "session 2" without `LoaderUtility.Deinitialize()` — cleaner than the SPIKE-Q2 §B recipe.
- Continuous drift (not single-frame teleport): because the injected pose stream runs every `onAfterUpdate` tick (~60 Hz), the cairn appears to drift continuously rather than snap once. This is the missing piece in SPIKE-Q2 §B Fidelity caveat ("single-frame teleport only").

**Cost**: ~120 LOC EditorCoroutine + reflection helper. No new packages. No Apple entitlements (Editor only).
**Fidelity vs B**: **higher**. Reproduces continuous SLAM refinement, exercises `AnchorDriftMonitor.cs` self-correct loop, exercises `CrossSessionGroundSnap` IMMORTAL path under sustained drift. Still does not produce a real `worldMappingStatus` value (that API stays iOS-bound — see Angle 1).

---

## Angle 4 — macOS native plugin hooking ARKit `handleFrame`

**Verdict**: **NOT VIABLE — confirmed dead end**.

**Evidence**: ARKit.framework ships only on iOS/iPadOS/visionOS — not in macOS SDK. There is no `ARSession` symbol to hook in a macOS Editor process. The `UnityARKit` native lib in the package is built `-target arm64-apple-ios`, not loaded by macOS Editor; loading it would fail at `dlopen`. Any "hook" target does not exist in the Editor process address space. Closed.

**Cost**: ∞.
**Fidelity vs B**: N/A.

---

## Overall conclusion

Ranking (best → fallback):
1. **Angle 3 — Pose injection into `SimulationCameraPoseProvider`** — supersedes Approach B as the new Editor-sim ceiling. Continuous drift, real anchor subsystem, 120 LOC. **Recommend promoting to a Sprint task** replacing SPIKE-Q2 §B as the primary harness. Keep §A unit tests as the math gate.
2. **Approach B (XROrigin offset)** — demote to fallback if Angle 3 reflection breaks on a future ARFoundation upgrade. Single-frame fidelity remains useful for visual regression of `CrossSessionGroundSnap`.
3. **Angle 1 ARWorldMap** — only on real iOS device. Treat as device-side validation, not Editor sim.
4. **Angles 2, 4** — closed, do not revisit unless ARFoundation 7 ships a Recording API.

**Permanent telemetry-only signals** (Editor cannot fake any of these — must come from aliyun `debug_snapshots` + `telemetry_sessions`):
- `worldMappingStatus` numeric value (B3 / B-Apple lock detection) — iOS-only API.
- Real `ARSession.currentFrame.camera.trackingState` reasons (`relocalizing`, `excessiveMotion`).
- LiDAR mesh classification labels (C bug class) — XR Simulation has no LiDAR semantic mesh.
- Inter-session ARKit world-origin deltas under genuine relocalization (B4-2 root cause magnitude distribution).

For these, v0.2.5 EAS build emitting per-frame `worldMappingStatus` + `arOrigin.transform` + `currentFrame.camera.trackingState.reason` into `debug_snapshots` remains mandatory. No Editor angle, today or planned, replaces it — `feedback_review_loop_dynamic` rule still binding.

Word count: ~870.
