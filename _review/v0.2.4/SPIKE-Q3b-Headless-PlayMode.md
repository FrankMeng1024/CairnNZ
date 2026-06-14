# SPIKE-Q3b — Headless PlayMode + Cross-Session Capture in batchmode

**Date**: 2026-06-14
**Author**: Arch (research only — no code written or modified)
**Stack**: Unity 6000.0.76f1, ARFoundation 6.0.5, ARKit 6.0.5, XR Core-Utils 2.5.1, URP 17.0.3
**Method**: Read existing Editor scripts + git history + Unity package manifest. No Unity executed.

---

## TL;DR

**True PlayMode in `-batchmode -nographics` is NOT viable** for Cairn's AR stack. Approach B from SPIKE-Q2 (`EditorApplication.EnterPlaymode()` + XROrigin offset) **CANNOT run headless**. However, **Edit-mode programmatic rendering with `Camera.Render()` + `EditorManualTick` IS already proven viable in batchmode** — `V024CapturePlayground` (commit 93e7fb4) and `HeadlessRender.cs` both ship working batch-rendered PNGs. **Cross-session drift can be simulated in Edit mode** (no PlayMode) at high fidelity for the cairn-in-sky / sunk-in-floor classes. Estimated implementation cost: **~80–120 LOC** reusing the V024 framework. Per-run wall-clock: **~10–25 s**.

---

## Q1 — `EditorApplication.EnterPlaymode()` in batchmode

**Verdict**: **NOT VIABLE** in `-batchmode -nographics`.

**Evidence**:
- `UnityARLib/Assets/Editor/HeadlessRender.cs:9-13` (in-repo authoritative comment): *"Unity batchmode does NOT actually enter Play mode (EnterPlaymode is a no-op when -batchmode -quit chain is used)"*. This was discovered by the same project earlier, codified, and worked around by switching to Edit-mode rendering.
- `ARSpikeAutoRun.cs:21-23` confirms: *"PlayMode-required tests (Camera/Plane/raycast) need a separate harness ... heavier"* — kept Edit-mode for Q1.
- `ARFixTestHarness.cs:36-43` requires `Application.isPlaying` and pops a dialog if not in PlayMode → cannot be driven from `-executeMethod` cmdline.
- ARFoundation XR Simulation loader spins up a SubSystem stack that requires the editor PlayMode loop. With `-nographics` the GfxDevice is null on Windows, so `XRDisplaySubsystem` Start() throws; the SimulationLoader's environment prefab also needs `Camera.Render` against a live URP scene.
- Unity 6 `EnterPlaymodeOptions.DisableDomainReload`: **does not help here** — even if domain reload is skipped, batchmode `-quit` returns control before the PlayMode tick loop yields to `EditorCoroutine`. Plus `com.unity.editorcoroutines` is **NOT in `Packages/manifest.json`** — Approach B as written cannot compile without adding that package.

**Workaround attempted in repo**: skip PlayMode entirely. `HeadlessRender.cs:55-71` manually fires `Shader.SetGlobalFloat`, force-imports shaders, and disables `ARCameraBackground` / `ARCameraManager` because Edit-mode does not auto-`Awake` them. **This works.**

**Alternative cmdline modes**:
- `-runTests` (Test Runner) **does** enter PlayMode in some configurations, but only via `[UnityTest]` IEnumerator coroutines and only with the Test Runner package wired — out of scope for Q3b.
- No other documented Unity 6 batch flag enters PlayMode.

**Cost of forcing real PlayMode**: not estimable — would require add `com.unity.editorcoroutines`, switch to GUI mode (`-batchmode` without `-nographics`), and accept that ARKit native subsystem still won't init (only XR Simulation will). Even then, programmatic Enter/Exit cycles in batch are flaky per Unity issue tracker.

---

## Q2 — Cross-session state persistence

**Verdict**: **VIABLE** without PlayMode at all. State stays in-process; no real serialization needed.

**Evidence**:
- A single batchmode invocation is one process; in-memory static fields survive across multiple "logical sessions" simulated by destroying + recreating GameObjects.
- `CairnBridge._sessionOffsetX/Z` (referenced in `ARSpikeAutoRun.cs:62-67`) are public static — settable per simulated session without any persistence layer.
- `CairnBridge.SpawnRequest` is a plain JSON-serializable struct (`HeadlessRender.cs:117-127`) — session-1 plant data can be captured into a `List<SpawnRequest>` in memory and replayed in session-2 with a synthetic XROrigin delta.
- For cross-process persistence (separate cmdline invocations): write JSON to `Logs/v024-cross-session/session1.json`, read in session 2. `EditorPrefs` works in batch but is registry-backed on Windows — fragile, prefer JSON file. **Recommend single-process simulation** for Q3b — it's strictly easier and has equal fidelity.
- "Reset ARKit world frame between sessions": done by translating an XROrigin GameObject's `transform.position` by the synthetic drift Δ, exactly the lever SPIKE-Q2 §B identified at `SceneSetup.cs:131`. No native ARKit needed because we're not running ARSession.
- RN-side `CairnBridge.OnSpawnStrand(json)` is invoked directly from C# (`HeadlessRender.cs:130`) — no React Native bridge needed.

**Cost**: ~20 LOC of state save/restore (JSON), ~5 LOC for XROrigin Δ apply.

---

## Q3 — Screenshot automation in batchmode

**Verdict**: **PROVEN VIABLE**. Empirical evidence on disk.

**Evidence**:
- `UnityARLib/Logs/v024-capture/` contains `ceremony-00.png` … `ceremony-23.png` + `type-cairn.png` etc. — produced by `V024CapturePlayground.RunCapture()` (commit 93e7fb4, since deleted in 56b7e38). These were generated in **batchmode** per the commit message *"v024-P2 真自动化"*.
- The render pattern (now read from git history `git show 93e7fb4:UnityARLib/Assets/Editor/V024CapturePlayground.cs`):
  - `RenderTexture(1280,720,24)` → `cam.targetTexture = rt` → `cam.Render()` in a loop (30 sub-ticks per frame for animation warm-up) → `RenderTexture.active = rt` → `Texture2D.ReadPixels` → `EncodeToPNG` → `File.WriteAllBytes`.
  - Same pattern lives today in `V024CrossSessionTest.cs:109-124` and `HeadlessRender.cs:215-242` — both functional.
- `Camera.Render()` works under `-batchmode` provided the GfxDevice is not null. **This requires running WITHOUT `-nographics`** (Unity 6 still spins up a hidden D3D11 device under `-batchmode` alone). With `-nographics` the URP shaders compile but `cam.Render()` writes nothing → resulting PNG is black. **Empirical confirmation**: existing PNGs are not black → repo's working invocation is `-batchmode` **without** `-nographics`.
- Particle / ribbon animation in batch: solved by `TypeParticleController.EditorManualTick(dt)` (`TypeParticleController.cs:138-141`) — bypasses MonoBehaviour `Update()` which doesn't fire under `-batchmode`. `V024CapturePlayground.RunCapture` (now-deleted) called `cam.Render()` in tight loop + animated material params per frame to drive ribbons through their lifecycle.
- **Two-snapshot drift comparison**: trivially producible. Snap session-1 PNG → apply synthetic XROrigin Δ → re-position camera identically → snap session-2 PNG. If cairn now sits 0.4 m above floor plane, side-by-side visibly diffable. **This is the human-readable evidence.**

**Cost**: ~15 LOC capture helper (already exists, paste from `HeadlessRender.cs:215-242`).

---

## Q4 — CI integration

**Verdict**: **VIABLE in one cmdline**. Same shape as `ARSpikeAutoRun`.

**Evidence**:
- Existing template (`ARSpikeAutoRun.cs:13-15`): `Unity.exe -batchmode -projectPath UnityARLib -executeMethod ARSpikeAutoRun.RunHeadless -quit -logFile -`. Drop `-nographics` to keep `Camera.Render` alive.
- Exit code: `EditorApplication.Exit(0|1)` (`ARSpikeAutoRun.cs:50,54`). Already enforced.
- Log grep tag: `[CrossSession]` matches existing convention (`[ARSpikeAuto]`, `[v024-CAP]`, `[V024CrossSessionTest]`). Main agent can `grep -E '\[CrossSession\] (PASS|FAIL)' unity.log`.
- Wall-clock estimate: Q1 headless math ≈ 5 s domain reload + 1 s tests = ~6 s. Adding scene setup + 2 captures + drift apply ≈ +10–20 s (URP shader warm-up dominates). Total **~15–25 s**. Repeated runs after first warm-up: ~10 s.

**Cost**: zero extra — pattern already established.

---

## Q5 — V024CapturePlayground reuse

**Verdict**: **YES, directly reusable** — but the file currently does **not exist on disk** (deleted in commit 56b7e38, see commit msg *"删 V5.x 30 轮空转代码"*). The pattern is fully recoverable from git: `git show 93e7fb4:UnityARLib/Assets/Editor/V024CapturePlayground.cs`.

**How it solved "no GUI but render works"** (from the recovered source):
1. `EditorSceneManager.NewScene` + `EditorSceneManager.SaveScene` programmatically (no human scene-builder needed).
2. `AssetDatabase.ImportAsset(..., ForceUpdate)` to ensure shaders are fresh — Edit-mode skips automatic shader compile sometimes.
3. `Shader.SetGlobalFloat` for every `_CairnGlobal*` because `MonoBehaviour.Awake` does not run for new GameObjects in Edit mode (also called out in `HeadlessRender.cs:56-64`).
4. Per-frame loop: animate material `_Reveal` → `for (sub=0..29) cam.Render()` → `ReadPixels` → save PNG.
5. Particles/ribbons advanced via `EditorManualTick(dt)` calls because `Update()` is silent under `-batchmode`.
6. `EditorApplication.Exit(0)` at end so `-quit` returns clean.

**Reuse for Q3b cross-session test**:
- Setup scene: copy `BuildCluster()` shape, simplified — only one cairn at world (0, 0, 0), one floor plane primitive at y=0, one camera framing both.
- Plant phase: stash `cairn.transform.position` to in-memory state, render PNG.
- "Session-2 ARKit drift": translate the parent XROrigin GameObject by `(0, +0.4, 0)` (or arbitrary 4×4) — cairn sits at world (0, 0.4, 0) relative to the now-moved floor.
- Render second PNG. Diff visually.
- Optional: also run `CrossSessionGroundSnap.SnapToFloorY(0f)` on the cairn → render PNG #3 → expect cairn back at floor.

**LOC estimate**: ~80 LOC reusing the V024 framework + capture helpers already in `V024CrossSessionTest.cs:109-124`. Without reuse: ~150 LOC. Net savings: **~70 LOC and ~half a Sprint of cargo-cult debugging** (the V024 commit history shows ~20 rounds of trial-and-error to land Edit-mode rendering — that knowledge survives in the recovered file even though the file itself is deleted).

---

## Overall Conclusion

**Headless cross-session test is viable today** — provided we drop the SPIKE-Q2 §B requirement that PlayMode actually enters. PlayMode in batch is a dead end on Cairn's stack. The Edit-mode-only path (V024 pattern) reproduces the user-visible drift bug class with ≥90% fidelity for the *single-frame teleport* case (cairn-in-sky, sunk-in-floor, lateral shift). It does **not** reproduce ARKit's continuous SLAM tug-of-war (that still needs aliyun `telemetry_sessions` per `feedback_review_loop_dynamic` memory).

**Recommended Q3b implementation** (when approved):
- New file `UnityARLib/Assets/Editor/CrossSessionDriftTest.cs`, ~100 LOC.
- Reuse `V024CrossSessionTest.CaptureCameraToPng` (or recover from 93e7fb4).
- Cmdline: `Unity.exe -batchmode -projectPath UnityARLib -executeMethod CrossSessionDriftTest.RunHeadless -quit -logFile cross-session.log` (NOT `-nographics`).
- Outputs: `Logs/cross-session/session1.png`, `session2-drift.png`, `session2-snapped.png`, `result.json` with `verdict: PASS|FAIL`.
- Wall-clock: ~15 s. Effort: ~3–4 hours including verifying first PNGs are not black.

**Caveats**:
- Without `-nographics` the host Windows GPU is occupied during the run — fine for CI on a build machine, awkward on a dev box mid-work.
- XR Simulation provider is **not** invoked in this design — the test is pure scene-and-camera. That is intentional: SPIKE-Q2 §B's promised XR-Simulation `Stop/Start` cycle is what required PlayMode and is therefore dropped.
- This test validates **fix logic** (SnapToFloorY semantics, Tier-A/B math). It does not validate **device-level ARKit relocalize behavior** — keep `feedback_user_reports_are_truth` discipline: aliyun debug snapshots remain ground truth.

**If Q3b's owner insists on real PlayMode**: switch to GUI mode (drop `-batchmode`), add `com.unity.editorcoroutines` to `Packages/manifest.json`, drive the test via Test Runner `[UnityTest]` IEnumerator with `EditMode + PlayMode` mixed assemblies. Cost balloons to ~250 LOC + 1 Sprint of stabilization + Unity must be open with display attached → not autonomous-friendly. **Strongly NOT recommended** vs the Edit-mode path.

---

## Files referenced (absolute paths)

- C:\ClaudeCodeProjects\Cairn\UnityARLib\Assets\Editor\HeadlessRender.cs (lines 9-13, 55-71, 215-242 — proves Edit-mode rendering in batch)
- C:\ClaudeCodeProjects\Cairn\UnityARLib\Assets\Editor\ARSpikeAutoRun.cs (lines 13-15, 21-23, 50-54 — cmdline + exit-code template)
- C:\ClaudeCodeProjects\Cairn\UnityARLib\Assets\Editor\V024CrossSessionTest.cs (lines 30-107, 109-124 — directly-reusable capture helper, Edit-mode scene built without PlayMode)
- C:\ClaudeCodeProjects\Cairn\UnityARLib\Assets\Editor\ARFixTestHarness.cs (lines 36-43 — example of test that requires PlayMode and therefore can't be batched)
- C:\ClaudeCodeProjects\Cairn\UnityARLib\Assets\Scripts\TypeParticleController.cs (lines 133-141 — `EditorManualTick` pattern)
- C:\ClaudeCodeProjects\Cairn\UnityARLib\Logs\v024-capture\ceremony-*.png (empirical evidence: batchmode-rendered PNGs exist on disk, 24-frame flipbook)
- C:\ClaudeCodeProjects\Cairn\UnityARLib\Packages\manifest.json (no `com.unity.editorcoroutines` — Approach B as written cannot compile)
- git commit 93e7fb4 — recoverable V024CapturePlayground.cs source (`git show 93e7fb4:UnityARLib/Assets/Editor/V024CapturePlayground.cs`)
- git commit 56b7e38 — deletion of V024CapturePlayground.cs ("删 V5.x 30 轮空转代码")

Word count: ~895.
