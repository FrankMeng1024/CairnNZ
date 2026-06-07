# DS Strand Visual Upgrade — Final Plan

> Synthesized from two independent subagent reviews (visual-quality lens + engineering-risk lens) on 2026-06-07.
> v185 OTA is in production. Next milestone: EAS Build with this upgrade + Sprint 66 routes work.
> User has explicitly required: "as much OTA-able as possible", "build is precious — must land first time", "ship the most ambitious thing one build cycle can responsibly deliver."

---

## 0. North Star

The user must say "this is Death Stranding." The first reviewer ranked the eight visual elements that, if any single one is missing, the user will say "no." The second reviewer ranked the engineering risks that, if any single one is missed, the build dies. This plan keeps every must-have visual that can be made HLSL-only + texture-asset, and explicitly cuts every visual that requires Shader Graph, VFX Graph, depth occlusion, or new asset types.

---

## 1. Scope of this build cycle

### What ships in v186

#### A. Cleanup (atomic with the visual upgrade — see §4 for atomicity rationale)
- Remove `USE_VIRO`, `USE_UNITY_AR`, `RITUAL_ENABLED` flags from `ARScreen.tsx` (~15 sites)
- Delete `ViroAROverlay.tsx`, `ViroARRitualOverlay.tsx`, `AR3DCairnOverlay.tsx`
- Remove `@reactvision/react-viro` from `package.json`
- Remove `withViroPodfileFix` plugin file + `app.json` plugin entry
- Remove the 4 verification pillars from production runtime path; keep them behind a `Debug.isDebugBuild` gate so they remain available for editor diagnostic spawning
- Replace the 30s no-plane fallback's spawn with **one** demo cairn of the new style (so users without a detected plane still see *something* and we don't ship a black screen)

#### B. Visual upgrade — DS strand v2

**Shader rewrite** (`Cairn/StrandShader` evolves; not a new shader file — keep the GUID stable so existing material `.mat` references survive):
- ✅ Add `_FlowTex` (1×N grayscale streak luminance, 256×1024 R8) — replaces the procedural single-stripe smoothstep
- ✅ Add vertical envelope: `_RootFadeEnd` (default 0.15) + `_TipFadeStart` (default 0.6) + smoothstep envelope
- ✅ Add `_FresnelIntensity` (default 1.0); current code has `*0.4` literal — promote to scalar
- ✅ Switch `Cull Back` → `Cull Off` (volumetric density doubles for free)
- ✅ Output premultiplied `float4(color * envelope, envelope)` instead of `(color, 1.0)` — better falloff
- ✅ Breathing pulse: `_BreathFreq` (default 0.7Hz) + `_BreathAmp` (default 0.05) → multiplied at fragment end
- ✅ Per-type stylization via existing `_BaseColor / _ScrollSpeed / _BloomBoost` (already wired) — just add per-type recipes (table below)

**Per-type recipe (set via `MultiSpawner.SpawnStrand` call from RN — already wired)**:

| Type     | Color (hex)  | ScrollSpeed | BloomBoost | FresnelPow | FresnelInt | Particles/sec | Halo color |
|----------|-------------|-------------|------------|------------|------------|---------------|-----------|
| danger   | #FF2A1A     | 1.6         | 3.5        | 1.2        | 1.0        | 30            | #3A0A05   |
| junction | #FFB347     | 0.7         | 3.0        | 1.8        | 0.9        | 25            | #5C3A12   |
| water    | #5AE6FF     | 0.45        | 2.2        | 2.5        | 1.2        | 35            | #0F3540   |
| hut      | #D4A06B     | 0.35        | 2.0        | 1.5        | 0.7        | 15            | #3E2814   |
| cairn    | #E8C896     | 0.6         | 2.5        | 1.6        | 0.85       | 20            | #2E1F12   |

(Color/speed/bloom values come from visual-quality reviewer's recipe; halo color is its hex 4× darker.)

**Halo disc (new asset)** — addressing visual reviewer's #3:
- Geometry: 1×1 quad mesh, parented as child of strand, lifted +0.003m
- New shader `Cairn/HaloShader.shader` — radial gradient × noise pulse, additive, ZWrite Off, Queue=Transparent+9 (under strand's +10)
- Texture: `cairn_rune_noise.png` 256×256 R8 (one shared asset)
- Per-type halo color set via material property block (no per-type material instances — see §3 perf)
- Pulse frequency = strand's BreathFreq

**Floor shadow blob (new asset)** — addressing visual reviewer's #3.3:
- Geometry: 1×1 quad mesh, parented as child of strand, lifted +0.001m (under halo)
- Multiply blend (`Blend DstColor Zero`)
- Texture: `cairn_shadow_blob.png` 128×128 R8 soft falloff
- Single shared material across all cairns

**Tip particle ascension** — addressing visual reviewer's #4:
- CPU `ParticleSystem` (NOT VFX Graph — engineering reviewer flagged iOS strip risk; visual reviewer agrees to defer)
- Spawned by `MultiSpawner.SpawnStrand` for every cairn (currently only debug pillar D has this)
- Per-type emission rate + color gradient + drift (table above)
- Single shared particle material `CairnParticle.mat` (URP/Particles/Unlit Additive + soft dot texture)
- Texture: `mote_soft.png` 64×64 R8

#### C. OTA-tunable global knobs (this is the user's "可OTA最好" requirement made concrete)

All driven via `Shader.SetGlobalFloat`. RN can set them via a new message `OnSetGlobal` on CairnBridge → `CairnGlobals.cs` MonoBehaviour.

| Global                       | Range     | Default | Use case |
|------------------------------|-----------|---------|----------|
| `_CairnGlobalBloomScale`     | 0.3-2.0   | 1.0     | OTA tone-down if bloom blowout in bright sun |
| `_CairnGlobalAlpha`          | 0.0-1.0   | 1.0     | Master fade for screen transitions |
| `_CairnGlobalLightEstimate`  | 0.3-2.0   | 1.0     | ARKit ambient feed-in (clamped to avoid div-by-zero) |
| `_CairnGlobalScrollMul`      | 0.0-2.0   | 1.0     | Still-strands-for-screenshot mode |
| `_CairnGlobalBreathFreq`     | 0.0-2.0   | 0.7     | Resting pulse frequency |
| `_CairnGlobalThermalScale`   | 0.0-1.0   | 1.0     | Internally driven by ThermalState — not RN-driven |
| `_CairnGlobalHaloRadiusMul`  | 0.5-2.0   | 1.0     | Halo size designer-tunable |

The engineering reviewer also noted: **per-type colors stay material-property baked**, not global. That's right — identity changes deserve a build, only "feel" knobs go OTA.

#### D. Three-Tier silent ground-Y resolver (replaces "30s fallback to debug pillars")

User explicit requirement: "用户不应该有感知 — 如果出问题用户应该是无感知的". Researched + designed against industry precedent (Pokémon GO AR+, Snapchat World Lenses). See `research/arkit_silent_fallback_report.md` for full justification.

**The problem with current design**: ARKit may take 1-5s (or forever, in featureless environments) to detect a horizontal plane. The current code waits 30s then spawns 4 colored debug pillars — user sees failure.

**The fix**: spawn cairns IMMEDIATELY using a tiered ground-Y source. The tier auto-promotes silently as ARKit gathers more info.

```
Tier C (always available, instant): camera.y - 1.5m  (assumed phone-hold height)
Tier B (< 1s in textured envs):     ARRaycastQuery(.estimatedPlane, .horizontal) hit-Y
Tier A (best, may take seconds):    real ARPlaneAnchor under cairn
```

**Mechanism**:
1. On `OnSpawnStrand` (or on bulk-spawn-on-ArReady): spawn at Tier C immediately. Cairn visible within 1 frame.
2. Each frame, attempt to upgrade Tier C → B → A. When a higher tier resolves, lerp Y over 400ms ease-out (≈imperceptible "settling" motion).
3. **Never demote** — if ARKit relocalizes and loses Tier A, keep last-known-A Y until new A or B arrives.
4. Suppress ARCoachingOverlayView entirely (deferred to v187+ anyway).

**Implementation**:
- New `UnityARLib/Assets/Scripts/GroundYResolver.cs` (~80 lines): per-cairn tier state, raycast queries, lerp animation.
- `MultiSpawner.SpawnStrand`: change `position.y = data.y` (today: caller-supplied groundY which may be 0) to `position.y = GroundYResolver.GetTierC(arCamera)` initially; subscribe to resolver's tier-promotion events for lerp.
- `CairnBridge`: delete `_planeFallbackTriggered` + `FALLBACK_PLANE_TIMEOUT` + the call to `SpawnFourVerificationPillars`. Pillars method stays in `MultiSpawner` for editor diagnostics, but production never invokes it.
- RN side: `unityCairnSpawn.ts.buildSpawnRequest` no longer needs to compute Y aggressively — pass `null` or omit, Unity resolver picks up. (For per-plant via hit-test in ARScreen.tsx, we keep the existing Y as a hint to the resolver — Tier B-equivalent — but resolver still runs.)

**Why this is better than 30s fallback**:
- User sees cairn instantly (not 30s of nothing or debug pillars)
- Featureless environments degrade gracefully — cairn stays at Tier C, slightly "floating" near ankle height, but never disappears
- No timer, no state machine, no failure UI to design

**Risks**:
- Tier promotions may be visible if cairn jumps > 50cm (e.g., user pointed at high ceiling at first, later detected real floor). Mitigation: clamp lerp speed at 1m/s, so a 1m correction takes 1s and reads as natural settling.
- ARRaycastQuery(.estimatedPlane) is supported in AR Foundation 6 via `ARRaycastManager.Raycast(screenPoint, ...)`. Verify API surface matches — if AR Foundation only exposes `existingPlaneGeometry` for raycasts, fall back to feature-point cluster geometry (`ARFrame.rawFeaturePoints` — write our own RANSAC). Validate in Editor before commit.

#### E. Sprint 66 routes (rides this build, untouched by us)
JS-only changes from the other agent — independently OTA-revertable. We don't touch `RoutesEditScreen.tsx` or anything routes-related. Our only shared file is `app/package.json` (we remove `@reactvision/react-viro`, they may add their package — both are independent removals/adds, lockfile reconciles).

### What we explicitly DEFER to v187+

- **VFX Graph** entirely (iOS compute kernel strip risk; visual & engineering reviewers both agreed to defer)
- **Tip dispersion glow billboard** — fresnel + envelope + ascending particles already sell dispersion
- **Real-time depth occlusion** — ARKit depth inconsistent on non-LiDAR devices
- **Strand wind bend** — vertex displacement, not in DS itself anyway
- **Per-type unique flow textures** — single shared texture; per-type uses color/scroll/wave for differentiation
- **Per-type unique mesh geometry** — stay on cylinder primitive
- **ARCoachingOverlayView native integration** — separate plugin patch CHANGE K, additional risk; defer to v187 once visual upgrade is stable
- **Pre-warm ARSession on previous screen** — defer (electricity risk, integration with navigation lifecycle)
- **Light estimation feed-in** — global is reserved (`_CairnGlobalLightEstimate`) but actually wiring `ARLightEstimationData` is a follow-up OTA tweak (default 1.0 is fine for v186)

---

## 2. File-level change list (exact)

### Unity Editor assets — created or modified

| File | Action | Reason |
|------|--------|--------|
| `UnityARLib/Assets/Shaders/StrandShader.shader` | **Modify** (preserve GUID/.meta) | Add envelope, flow tex, fresnel intensity, breathing, double-sided, premultiplied output |
| `UnityARLib/Assets/Shaders/HaloShader.shader` | **Create** | Halo disc shader: radial gradient × noise pulse |
| `UnityARLib/Assets/Shaders/ShadowBlobShader.shader` | **Create** | Multiply-blend shadow underlay (or reuse URP/Unlit/Multiply if it exists in URP 17) |
| `UnityARLib/Assets/Textures/strand_flow.png` | **Create** | 256×1024 R8 streak luminance, tileable Y |
| `UnityARLib/Assets/Textures/cairn_rune_noise.png` | **Create** | 256×256 R8 perlin/voronoi for halo |
| `UnityARLib/Assets/Textures/cairn_shadow_blob.png` | **Create** | 128×128 R8 soft round falloff |
| `UnityARLib/Assets/Textures/mote_soft.png` | **Create** | 64×64 R8 soft particle dot |
| `UnityARLib/Assets/Materials/CairnHalo.mat` | **Create** | Uses HaloShader |
| `UnityARLib/Assets/Materials/CairnShadow.mat` | **Create** | Uses ShadowBlobShader |
| `UnityARLib/Assets/Materials/CairnParticle.mat` | **Create** | URP/Particles/Unlit + Additive + mote_soft.png |
| `UnityARLib/Assets/Editor/SceneSetup.cs` | **Modify** | Append new shaders to `m_AlwaysIncludedShaders`; create new materials; ensure URP HDR enabled in pipeline asset |

### Unity C# scripts — created or modified

| File | Action | Reason |
|------|--------|--------|
| `UnityARLib/Assets/Scripts/MultiSpawner.cs` | **Modify** | `SpawnStrand` extended: spawn halo + shadow + particle children. New per-type config dictionary. Material is shared per-type (not per-spawn) via MaterialPropertyBlock to avoid material count blowup over long sessions (engineering reviewer's concern §2.d). |
| `UnityARLib/Assets/Scripts/CairnBridge.cs` | **Modify** | Add `OnSetGlobal(string json)` receiver for OTA globals. Gate `SpawnFourVerificationPillars` call sites with `#if CAIRN_DEBUG_PILLARS`. Add fallback "demo cairn" spawn at 30s no-plane. |
| `UnityARLib/Assets/Scripts/CairnGlobals.cs` | **Create** | Single MonoBehaviour, applies `Shader.SetGlobalFloat` for the knobs in §1.C. |
| `UnityARLib/Assets/Scripts/CairnTypePresets.cs` | **Create** | Static dictionary of the 5 type recipes. Single source of truth. Used by `SpawnStrand` to look up shader + halo + particle params. |
| `UnityARLib/Assets/Scripts/CairnThermalMonitor.cs` | **Create** | Subscribes to `Application.lowMemory` + `iOSDevice.thermalState`, drives `_CairnGlobalThermalScale`. |
| `UnityARLib/Assets/Scripts/GroundYResolver.cs` | **Create** | Three-tier silent ground-Y resolver (Tier C / B / A). See §1.D. |

### RN/TS files — created or modified

| File | Action | Reason |
|------|--------|--------|
| `app/src/services/unityCairnSpawn.ts` | **Modify** | `UnitySpawnRequest` may add `fresnelPower`, `fresnelIntensity` if we choose to expose them per-spawn (decision below); update `markerTypeToShaderParams` table to v186 values |
| `app/src/services/unityGlobals.ts` | **Create** | Typed wrapper for the OTA globals → posts `OnSetGlobal` to CairnBridge |
| `app/src/screens/ARScreen.tsx` | **Modify** | Remove all USE_VIRO/USE_UNITY_AR/RITUAL_ENABLED branches; collapse to single `<UnityAROverlay />` render |
| `app/src/components/UnityAROverlay.tsx` | **Modify (minor)** | Remove now-unused `cairns: []` stub from the onArFrame payload (it's been a stub since v184; cleaner without) |
| `app/src/components/OtaBadge.tsx` | **Modify** | Bump `OTA_VERSION` 185 → 186 (note: visual upgrade is a *build*, not just an OTA, but the JS bundle still gets a version bump) |

### RN/TS files — deleted

| File | Action | Reason |
|------|--------|--------|
| `app/src/components/ViroAROverlay.tsx` | **Delete** | Dead branch |
| `app/src/components/ViroARRitualOverlay.tsx` | **Delete** | Dead branch |
| `app/src/components/AR3DCairnOverlay.tsx` | **Delete** | Dead branch |
| `app/plugins/withViroPodfileFix.js` | **Delete** | No longer needed once Viro pod removed |

### Plugin / package files — modified

| File | Action | Reason |
|------|--------|--------|
| `app/package.json` | **Modify** | Remove `@reactvision/react-viro`; ensure no other change conflicts with Sprint 66 |
| `app/app.json` | **Modify** | Remove `@reactvision/react-viro` plugin entry; remove `./plugins/withViroPodfileFix` plugin entry |
| `app/plugins/withUnityEmbed.js` | **No change** | Plugin chain reduces from 13 → 11 plugins, but withUnityEmbed's idempotency guards (line 706+) don't depend on Viro |

### Database

| Action | Reason |
|--------|--------|
| `DELETE FROM markers;` on `122.51.174.118` MySQL `cairn` DB | User's "删除所有 mark" — clean slate for testing v186 visuals |

---

## 3. Performance & operational decisions

### Material count cap (engineering reviewer's §2.d concern)
Switch from per-spawn material instance to **one material per type, shared by all cairns of that type, parameterized via MaterialPropertyBlock**. Caps at:
- 5 strand materials (one per type, shared)
- 1 halo material (color via PB)
- 1 shadow material (no variance)
- 1 particle material (color via gradient, not material)
- = **8 materials total**, regardless of cairn count

This eliminates the 200-cairn / 500-material heap fragmentation risk over a long hike.

### Visible cairn cap
- 8 visible at any time (in-frustum + within 30m). Beyond that, distance-cull renderer (keep GO alive, disable renderer + particle system). Distance-fade between 12-20m via `_CairnGlobalAlpha` per-instance.
- This keeps draw calls at ≤ 8 strands × 4 children = 32 draw calls + ARCameraBackground + UI = manageable on iPhone 12.

### Thermal escape valve
- `Nominal/Fair`: `_CairnGlobalThermalScale = 1.0`
- `Serious`: 0.6 — bloom drops, particles half emission
- `Critical`: 0.3 — particles off, bloom near-off
- All applied via single global; no per-cairn iteration

### Always-included shader registration (CRITICAL)
`SceneSetup.cs:226 EnsureAlwaysIncludedShaders` MUST be extended to add:
- `Cairn/HaloShader`
- `Cairn/ShadowBlobShader` (if we don't reuse URP/Unlit/Multiply)
- (existing `Cairn/StrandShader` and `URP/Lit` already there)

If missed → magenta halo on device. Engineering reviewer flagged this as silent build failure mode.

### URP HDR + bloom values
- HDR enabled in `UniversalRenderPipelineAsset` at scene-build time (assert in `SceneSetup.Awake`)
- Bloom values: threshold **1.05** (excludes camera feed), intensity **0.7**, scatter **0.65**, tint white
- These ship in the IPA via `CairnVolumeProfile.asset` (regenerated by SceneSetup at build)
- OTA-tunable wrapper: `_CairnGlobalBloomScale` multiplies the base intensity at runtime

---

## 4. Atomicity decision (engineering reviewer's §6)

**Ship cleanup + visual upgrade together in v186 build.** Reasoning:
1. Cleanup removes dead code that's already at runtime (USE_VIRO=false, RITUAL_ENABLED unreachable)
2. Splitting them buys nothing — cleanup-only build is risky (architectural change without user-visible benefit, no upgrade incentive)
3. Both share the same testing surface (TestFlight one device, plant→render verification)
4. Sprint 66 routes is JS-only and rides for free — independently OTA-revertable

**Rollback strategy**: keep v185 IPA in TestFlight production track for 72h after v186 ships. If v186 is catastrophic, push v185 back. No code revert needed — TestFlight handles it.

---

## 5. Cross-version JS compatibility (engineering reviewer's §8)

The v186 JS bundle baked into IPA must work with v186 xcframework. It does NOT need to work with v185 xcframework — v186 device users have v186 xcframework.

**However**: v185 xcframework is on every device that hasn't updated. If we OTA-push a JS bundle (e.g. v187 OTA hot-fix) calling new Unity messages, v185 devices would silently fail.

**Mitigation**: feature-detect via `unityVersion` in `ArReady` message. Engineering reviewer suggested a handshake — I'll adopt: cairn JS sends `OnPing` with the build's expected protocol version, Unity replies with its supported version, JS gates accordingly. This is **not in v186 scope** but the OnPing exchange is already there, so we just need to add a `protocolVersion` field to the Pong response. Tiny addition, big future-proofing.

---

## 6. Testing strategy (engineering reviewer's §7)

### Pre-commit (Editor 76f1, review-only)
- Every shader compiles (no pink materials in playmode)
- `SceneSetup.SetupAndSave()` runs cleanly → `[CairnUnity][SceneSetup]` log clean
- Frame debugger: SRP Batcher reports "compatible" for every new shader
- Spawn one of each type via test harness → visuals differ per type
- `git checkout .` discipline before commit (drop any 76→36 meta drift)

### CI (36f1 docker)
- `unity-build-xcframework.yml` succeeds
- `_sendMessageToMobileApp` symbol verification (existing)
- New: grep IL2CPP output for "shader stripped" warnings → CI fails if any new shader stripped
- New: grep for "WARNING: Shader Unsupported" → CI fails

### Pre-EAS (after CI green xcframework, before EAS Build)
- Marker SHA matches GitHub Release digest (existing mechanism via fingerprint.config.js)
- Local TS `npx tsc --noEmit` passes (no type errors after Viro removal)
- All deleted file imports cleaned up

### Post-EAS, pre-TestFlight
- Cold launch → ArReady within 5s
- Plant one cairn of each type → visuals match Editor preview
- Walk for 5 min → no Metal heap warnings in Xcode console
- Background → foreground → Unity recovers, no black screen
- Force-kill → relaunch → cold start clean

### Ship criteria
- Zero blocker bugs in TestFlight smoke
- Every cairn type visually distinct
- 30-min session no crash

---

## 7. Settled decisions (no longer open)

1. **Per-spawn fresnel exposure**: material-baked per type. Not in wire payload.
2. **No-plane behavior**: replaced by Three-Tier silent ground-Y resolver (§1.D). No 30s timeout, no debug pillars in production.
3. **Sprint 66 sync**: branch isolation — we never touch `feat/sprint-66-routes`. Only master. Their branch will rebase against our v186 master state when they merge. Our cleanup (Viro removal) is one-way and lands first; they pick it up on rebase.
4. **DB markers wipe**: completed by user pre-implementation (14 → 0). No further action.
5. **OTA_VERSION semantics**: 185 → 186 for v186 build, then OTA hotfixes increment from 187. Sequential.

## 8. Estimated implementation cost

(See §11 for ordering.)

- Total: ~14 hours focused work (originally 13h + ~1h amendments)

## 9. Out-of-scope safeguard checklist

(unchanged)

## 10. Decision: ready to move to global review?

(superseded — plan global review completed: APPROVE-WITH-AMENDMENTS, all 10 amendments folded in below)

## 11. Implementation Order (fail-fast)

1. **StrandShader.shader edit + Editor playmode test** — catch HLSL syntax fast (~2h)
2. **HaloShader + ShadowBlobShader + 4 textures + 3 materials** — visual proof (~2h)
3. **SceneSetup.cs**: extend `EnsureAlwaysIncludedShaders` for new shaders, **add ARRaycastManager component to XR Origin**, **update bloom constants to threshold=1.05 / intensity=0.7 / scatter=0.65**, ensure HDR enabled on `UniversalRenderPipelineAsset` (~1h)
4. **CairnTypePresets.cs + MultiSpawner.SpawnStrand refactor** (shared per-type material via MaterialPropertyBlock, child halo/shadow/particle spawning, per-instance `_InstanceAlpha` for distance fade) (~3h)
5. **GroundYResolver.cs + CairnBridge wire-in** — delete pillar fallback (`_planeFallbackTriggered` + `FALLBACK_PLANE_TIMEOUT` + `SpawnFourVerificationPillars` call site), add Tier-C readiness gate (require `ARSession.state >= SessionInitializing` + non-zero camera position before spawning) (~2h)
6. **CairnGlobals.cs + CairnThermalMonitor.cs** with clamps (every setter `Mathf.Clamp` to declared range; `_CairnGlobalAlpha` minimum 0.05; defaults set in `Awake`) (~1h)
7. **RN cleanup** (last so Unity is proven first): delete Viro files, withViroPodfileFix, remove ~21 flag occurrences from ARScreen.tsx, app.json plugins, package.json `@reactvision/react-viro` (~1.5h)
8. **RN OTA layer**: `unityGlobals.ts` service, `markerTypeToShaderParams` update to v186 recipe, `OtaBadge` bump 185 → 186 (~0.5h)
9. **Editor smoke**: spawn one of each type via test harness, verify visuals + frame debugger SRP-batcher compatible + no pink materials (~1h)
10. **Commit + push to master + workflow runs (CI xcframework build, free)**. EAS Build waits for user's explicit signal.

## 12. Amendments folded in (from plan global review)

### A1. ARRaycastManager component wiring (HIGH)
SceneSetup.cs currently only adds `ARPlaneManager`. Without `ARRaycastManager` on XR Origin, the Tier B raycast is silently dead. **Step 3 above** explicitly adds `ARRaycastManager` component. `GroundYResolver` reads it via `FindFirstObjectByType<ARRaycastManager>()` in Awake.

### A2. Bloom constants update (HIGH)
SceneSetup.cs:173-175 currently hard-codes intensity=1.5, threshold=0.7, scatter=0.7. **Step 3 above** explicitly updates to threshold=1.05, intensity=0.7, scatter=0.65 + asserts URP HDR enabled. Without this update, post-build profile keeps v185 values and the visual upgrade looks flat.

### A3. CairnGlobals safety clamps (HIGH)
- Every setter `Mathf.Clamp` to declared range
- `_CairnGlobalAlpha` minimum 0.05f (never invisible — recovery path)
- All 7 globals initialized to defaults in `Awake` (so shaders sampling pre-RN-init don't read 0)
- Out-of-range values logged as W and clamped, never passed through

### A4. Per-instance distance fade clarification (MEDIUM)
- Plan §3 originally said "_CairnGlobalAlpha per-instance" — globals can't be per-instance
- Corrected: per-instance fade uses MaterialPropertyBlock float `_InstanceAlpha` (default 1.0); shader multiplies final color by `_InstanceAlpha * _CairnGlobalAlpha`
- Selection rule: sort by GPS distance per frame, keep nearest 8 with renderer enabled

### A5. Tier-C readiness gate (MEDIUM)
GroundYResolver gates Tier-C spawn on:
- `ARSession.state >= SessionInitializing` AND
- `arCamera.transform.position` is valid (not exactly 0,0,0 unless intentional)

If not yet valid, queue the spawn and re-evaluate next Update. This avoids spawning all cairns at world Y = -1.5m on frame 1 when camera transform isn't ready.

### A6. Flag count correction (MEDIUM, cosmetic)
USE_VIRO/USE_UNITY_AR/RITUAL_ENABLED grep shows ~21 hits, plan §1.A originally said ~15. Mechanical work, no scope change.

### A7. Sprint 66 branch isolation (MEDIUM)
We never touch `feat/sprint-66-routes`. v186 cleanup (Viro removal) lands on master first. Sprint 66 rebases when they merge.

### A8. DB wipe — completed (MEDIUM, no action)
Already done. Removed from open decisions.

### A9. Rollback path clarity (MEDIUM)
- **Path A — broken JS in v186**: OTA push fixed bundle (any future hotfix to channel `production`)
- **Path B — broken xcframework (shader/scene/Unity scene topology)**: re-promote v185.x IPA from TestFlight history; users with v186 installed must wait for App Store rollback or update. **This is a one-way door** — flag at TestFlight submit time
- v186 IPA's JS bundle pairs with v186 xcframework. Pre-OTA-update v186 device users are running v186 JS + v186 xcframework — no compatibility concern.

### A10. Implementation order (MEDIUM)
Specified above in §11. Shaders first (fail-fast on HLSL), Unity scene wiring next, RN cleanup last (mechanical, only after Unity is proven).
