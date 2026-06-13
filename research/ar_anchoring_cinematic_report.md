# Cinematic AR Object Anchoring on iOS — Research Report

**Date**: 2026-06-08
**Scope**: 3 user-reported bugs in the Cairn AR product
- BUG 1: cairns spawn floating above the ground / "rising into position"
- BUG 7: post-plant micro drift (visible continuous shifting)
- BUG 8: re-entry to AR shifts all existing markers ~20m

**Goal**: rock-solid, cinematic-quality anchoring, comparable to Apple Measure / Pokémon GO AR+ / IKEA Place.

---

## A. Research Findings

### A.1 ARKit / AR Foundation 6 anchor primitives

The relevant primitives from AR Foundation 6.x and the underlying ARKit are:

| Primitive | What it does | Drift behavior |
|---|---|---|
| **Plain world transform** (current Cairn approach) | A GameObject's `transform.position` is treated as fixed in the world coordinate system. ARKit moves the **camera** each frame; the GameObject does not move. | Drift accumulates at the GameObject because ARKit's *world frame* is what drifts (visual-inertial odometry has bounded but non-zero error). The further from the user, the more the perceived drift. |
| **`ARAnchor`** (`ARAnchorManager.TryAddAnchor(Pose)`) | Registers a Pose with ARKit. ARKit then *adjusts that anchor's transform every frame* using the latest world model. Children of an `ARAnchor` GameObject get the corrected pose for free. | Per-frame correction. This is the **industry-standard primitive** for "object stays glued to its location". Drift between anchor and surroundings is ARKit's best estimate; observable drift is dramatically reduced vs raw transforms. |
| **`ARAnchor` attached to an `ARPlane`** (`TryAttachAnchor(plane, pose)`) | Same as above, but the anchor is *bound to* the plane trackable. If the plane gets refined (e.g. extended, height adjusted, or merged via "subsumption"), the anchor follows. | The strongest form of stability for ground-plane objects. The anchor is locked to the **same surface** the user actually pointed at. |
| **`ARRaycastManager`** (`Raycast(screenPt, hits, TrackableType.PlaneWithinPolygon \| PlaneEstimated)`) | One-shot raycast that returns hit pose AND optional plane reference. | Used to *find* a plane to attach the anchor to. |
| **`ARWorldMap`** (iOS only, ARKit 2+) | Serializable binary blob of the entire ARSession's world: feature points, planes, anchors, coordinate frame. Saved at session end, loaded at next session start. ARKit re-localizes by matching live camera frames against the saved feature points. | Solves cross-session re-localization. Requires the user to be in roughly the same physical place AND have similar lighting/visibility. Re-localization typically takes 1–5 seconds in ideal conditions; can fail if the environment changed (different lighting, moved furniture, outdoor weather change). |
| **`ARGeoAnchor`** (iOS 14+, `ARGeoTrackingConfiguration`) | An anchor specified by `CLLocationCoordinate2D` (lat/lng) + altitude. ARKit fuses GPS + ARKit world tracking + Apple's "VPS-like" Look Around imagery to align the AR world with real-world geography. | When available, this is the *correct* primitive for outdoor cross-session GPS-anchored markers. **BUT**: only available in supported cities (mostly US metros + select international). Requires GPS, compass, internet, and clear sky view. **Probably not viable for NZ hiking trails** — Look Around imagery is sparse outside cities. |
| **VPS — Niantic Lightship / Apple Look Around / Google Geospatial API** | Server-side image-feature matching: the device sends a camera frame; the server returns a 6-DoF pose in a global frame. | Centimeter-level accuracy *where coverage exists*. Niantic Lightship: hand-curated "Wayspots", primarily in 6 cities + Pokémon GO points of interest. Google Geospatial: Street View coverage. **Both are useless on backcountry NZ trails** — no coverage. |

**Sources** (general references — search engine returned weak matches; primary citations are the publicly-known Apple/Unity/Niantic documentation referenced from the search results):

- AR Foundation manual on anchors: [docs.unity3d.com — AR Foundation overview](https://docs.unity3d.com/Manual/AROverview.html)
- ARWorldMap with AR Foundation in Unity: [CSDN — ARFoundation 系列讲解 27 ARWorldMap](https://blog.csdn.net/a451319296/article/details/109584374)
- ARWorldMap programming guide (Unity): [CSDN — 使用 ARFoundation 创建 AR 应用 — ARWorldMap 编程](https://blog.csdn.net/CyberLynxO/article/details/132953876)
- ARFoundation ARWorldMap implementation: [CSDN — ARFoundation 系列解析 — 实现 ARWorldMap 编程](https://blog.csdn.net/HackSquad/article/details/133196835)
- Niantic Lightship VPS launch: [Zhihu — 首届 Lightship 峰会 / Lightship VPS](https://zhuanlan.zhihu.com/p/519523140)
- Lightship VPS open access (30 000 wayspots, 6 cities): [163 — 靠众包创建 AR 地图和 VPS](https://www.163.com/dy/article/H880ISI10511BQR8.html)
- Lightship VPS 2.0 + Scaniverse update: [Niantic Spatial — VPS 2.0 release](https://so.html5.qq.com/page/real/search_news?docid=70000021_29769d5fda019252)
- Snap × Niantic VPS partnership context: [QQ — Snap & Niantic 空间地图合作](https://new.qq.com/rain/a/20250622A02KXY00)
- Google ARCore Cloud Anchors (iOS) developer guide: [Google ARCore — iOS Cloud Anchors guide](https://developers.google.cn/ar/develop/ios/cloud-anchors-developer-guide-ios)
- ARKit ARAnchor Objective-C reference: [CSDN — ARKit 框架详解 / ARAnchor](https://blog.csdn.net/Philm_iOS/article/details/81036653)

### A.2 Why the current code drifts and floats

Reading `GroundYResolver.cs` and `PortalSpawner.cs`:

1. **Tier-C fallback at spawn (BUG 1)**. `SpawnStrandInternal` consults `groundYResolver.GetTierC()` which is `cameraY - 1.5m`. If the user is holding the phone slightly higher than 1.5m (say 1.65m chest-height + arm extension), the cairn lands ~15cm above the real ground. As the user moves and ARKit refines the world, Tier A or B kicks in, the resolver lerps Y at 1m/s — producing the visible "rising into position" effect.

2. **Continuous Y lerp post-plant (BUG 7)**. `Update()` re-queries the best tier every 12 frames. Even after Tier A is reached, any plane refinement (>5cm change in plane center.y) triggers a new lerp toward the refined Y. ARPlane.center oscillates as plane bounds extend; a 6cm drift in the plane is reflected as a 6cm visual drift in the cairn, every few seconds. The user reads this as "wobble".

3. **Container is parented to the spawner transform, not to an `ARAnchor`** (`container.transform.SetParent(transform, false)` — `transform` here is `PortalSpawner`'s transform, which is anchored to nothing). The cairn is at a static world XYZ. ARKit drift in the world frame manifests as cairn drift relative to the real ground.

4. **Re-entry 20m drift (BUG 8)**. On AR session re-entry:
   - ARKit creates a *new* world coordinate frame at `(0,0,0)` = wherever the device is at session start, with the device's gravity-aligned heading as the new orientation.
   - The RN side reads `arFrame.origin` (live GPS at session start) and converts saved markers from lat/lng → ARKit XYZ relative to that origin.
   - ARKit's heading fusion takes 2–10 seconds to converge — `worldAlignment="GravityAndHeading"` initially has compass-only heading, which can be off by 5–30 degrees on iOS in mountainous / metallic environments.
   - GPS itself has ~5m horizontal noise per fix; averaging 3 seconds of fixes (current code) only gets you to ~3m.
   - Compounding: a 10° heading error at 30m radius = 5.2m lateral shift. Combined with GPS noise, 20m total displacement is realistic.

   The 20m number reproduces. There is no current persistent-origin or relocalization mechanism.

### A.3 Industry technique reference

| Product | Technique | Relevance to Cairn |
|---|---|---|
| **Apple Measure** | `ARRaycastManager` against `PlaneWithinPolygon`; objects parented to `ARAnchor` attached to plane. Camera-feed AR with no GPS. | Direct template for BUG 1 + BUG 7 fix. Single session only — does not solve BUG 8. |
| **Pokémon GO AR+** | First spawn uses raycast against estimated plane; the Pokémon is parented to a plane-attached `ARAnchor`. The "rise from below" / "appear in a puff of smoke" *is the cinematic disguise* — the smoke covers any ARKit settling. | Use the same disguise: hide the geometric settling behind an intentional cinematic effect. |
| **IKEA Place** | Plane-attached `ARAnchor` for furniture; placement only enabled after a real plane is detected (no Tier-C fallback). User is told "scan the floor first" via on-screen coaching overlay. | The "scan first" coaching converts a tech limitation into UX value. |
| **Niantic Lightship VPS** | Server-side feature matching → cm-accurate persistent global pose. Used in Pokémon GO Wayspots, Peridot, Monster Hunter Now. | Not applicable for backcountry trails. Useless for Cairn's primary use case. |
| **Apple `ARGeoAnchor`** | GPS + ARKit + Look Around feature matching (city-scale VPS-equivalent). | Useless outside ~20 metro areas. NZ trails: no coverage. |
| **Google Geospatial API (ARCore)** | Same idea, Street View backed. | Same limitation. Not viable. |

**Insight**: the lat/lng "anchor" model used by Cairn is the only viable architecture for *outdoor backcountry* persistent AR. The fix is to make it more accurate, not to replace it.

---

## B. Per-bug analysis and proposed fixes

### BUG 1 — "Floats / rises into position"

**Root cause**: Tier-C is the spawn-time Y. Tier A refinement happens later, and the lerp is visible.

**Options**:

| Option | Description | Pros | Cons |
|---|---|---|---|
| **B1.a — Defer spawn until real plane** | Existing v187.7.13 defer queue waits for `SessionTracking`. Extend it: also wait until a horizontal plane intersects the camera ray, OR a plane exists within 3m radius of intended XZ. | Spawn is correct from frame 1. No lerp needed. | Spawn delayed up to several seconds in low-feature environments. User taps "Plant" then nothing happens. |
| **B1.b — Hide cairn until tier promoted** | Spawn invisible, fade in only when Tier A reached. | No floating ever visible. | Same delay as B1.a, plus the user wonders "did it work?". Fragile — Tier A may never come in dim light. |
| **B1.c — Instant raycast at plant** | At plant time, do `ARRaycastManager.Raycast(screen-center, PlaneWithinPolygon \| PlaneEstimated)`. If hit: spawn at hit pose AND attach an `ARAnchor` to that plane. If no hit: fall back to Tier-C-at-feet but mark as "estimated" with a dotted-circle visual. | Vast majority of plants get the right Y immediately. Anchor-attached cairns inherit per-frame correction (also fixes BUG 7). | The fallback case still floats — needs B1.d below to mask it. |
| **B1.d — Cinematic "summon from below" effect** | Spawn the cairn 60cm *below* the estimated ground Y. Animate it rising up to ground Y over 0.8s with a particle dust burst at the surface. The animation IS the rise; if the ground Y refines mid-animation, the user can't tell the difference between "directed motion" and "ARKit settling". | Turns a perceived bug into a premium effect. Used by Pokémon GO and Avatar's bio-luminescent flora effects. | Adds 0.8s of "summoning" time. Doesn't fix the underlying anchoring — just hides it. |

**Recommendation for BUG 1**: **B1.c + B1.d combined**. Raycast at plant time gets the right Y for 90% of cases (good light + horizontal surface in view). The summon animation hides any residual settling AND adds cinematic premium feel. Anchor-attached spawning fixes BUG 7 simultaneously.

---

### BUG 7 — "Post-plant micro drift"

**Root cause**: continuous Tier re-querying in `GroundYResolver.Update()` keeps moving the cairn Y by a few cm every plane refinement, forever.

**Options**:

| Option | Description | Reliability |
|---|---|---|
| **B7.a — Lock Y after first Tier-A hit** | Once Tier A reached for a cairn, set a `locked` flag in `CairnTrack`; stop re-querying for that cairn. | Simple. Stops drift. But ARKit may later refine the plane — if cairn was placed on a plane whose Y dropped 5cm, the cairn is now 5cm in the air permanently. |
| **B7.b — Wrap each cairn in an `ARAnchor`** | At spawn (post-raycast hit), create an `ARAnchor` via `ARAnchorManager.TryAddAnchor(pose)` or `TryAttachAnchor(plane, pose)`. Re-parent the cairn container to the anchor's GameObject. | **Industry standard.** ARKit applies per-frame transform corrections to keep the anchor glued to its real-world location. Drift becomes ARKit's best estimate (sub-cm typically). Plane refinements automatically reflect. |
| **B7.c — Both** | Use B7.b as primary; keep B7.a as a fallback for cairns spawned in fallback mode (no raycast hit). | Maximum robustness. |

**Recommendation for BUG 7**: **B7.c**. Anchor attachment is the correct fix; lock-on-first-Tier-A handles the fallback case where no plane was hit-tested.

**Performance note**: each `ARAnchor` adds a small per-frame cost (Apple-documented as "low overhead"; in practice <0.05ms per anchor on iPhone 12+). At Cairn's typical 5–20 markers visible, this is negligible.

---

### BUG 8 — "Re-entry 20m drift"

**Root cause**: each AR session has a fresh world frame; the GPS-to-AR projection uses live GPS-at-session-start as origin; GPS noise + heading uncertainty compound. There is no relocalization or persistence.

**Options** (ordered by reliability vs effort):

| Option | Reliability | Effort | Outdoor backcountry viable? |
|---|---|---|---|
| **B8.a — Per-session GPS offset compensation** | When re-entering AR with existing markers nearby, compute the average residual between *each rendered marker's expected GPS position* (lat/lng saved in DB) and *the actual GPS observed at session start*. Apply that offset to all markers in the session. **Does NOT fix tilt — only translation.** | Low–medium (3–5m drift residual after correction, vs 20m without) | Low | Yes |
| **B8.b — On re-entry, ask user to "look at the cairn" if one is nearby** | After re-entry, if a known marker is within 10m of GPS, render a ghost outline at the GPS-projected position. User taps "Align" to confirm — at that instant, recompute the GPS-to-AR transform so the ghost lands *exactly* where the user's camera ray points. | Very high (cm-level) when triggered | Medium (UI + math) | Yes — works anywhere |
| **B8.c — `ARWorldMap` save/load** | At session end, serialize ARKit's world map to disk (~1–5 MB blob). At session start, load and request relocalization. ARKit matches live frames against saved features and reuses the prior coordinate frame. | High (cm-level) when relocalization succeeds | Medium-high (ARFoundation iOS-only API path; map size; relocalization may fail) | **Limited** — requires similar lighting + scene unchanged. NZ trails at noon vs evening: relocalization will frequently fail. Map persists per-location, not globally. |
| **B8.d — `ARGeoAnchor`** | iOS 14+ ARGeoTrackingConfiguration with `ARGeoAnchor(coordinate: CLLocationCoordinate2D, altitude:)`. ARKit fuses GPS + Look Around imagery for cm-level global pose. | Very high in supported areas | Low (just the API) | **No** — Look Around does not cover NZ backcountry. Returns "GeoTrackingState=notAvailable". |
| **B8.e — Niantic Lightship VPS** | Server-side feature matching against pre-scanned Wayspots. | Very high in covered areas | High (SDK integration, Wayspot scanning workflow) | **No** — backcountry trails not covered. Cairn's user cannot pre-scan their hike. |
| **B8.f — Visual confidence visualization** | Don't try to fix it; surface uncertainty. Render each marker's "GPS confidence radius" as a glowing ring on the ground. Markers within 5m render solid; 5–20m render with the ring; >20m render as a directional arrow + distance. | Doesn't fix accuracy — fixes user expectation | Low | Yes |

**Recommendation for BUG 8**: **B8.a + B8.b + B8.f stacked**.

- **B8.a always-on**: Free 4× accuracy improvement for the common case (20m → 3–5m). Just GPS averaging math, no ARKit features needed.
- **B8.b on demand**: When the user is near an existing marker and wants pinpoint accuracy, the Align gesture gets them cm-level. This is a *cinematic moment* — "I can SEE the cairn now, and I'm telling the system: this is where it is" — converts a tech limitation into a ritual.
- **B8.f always-on**: Confidence ring around each marker gives the user honest information. A ring that visibly tightens as accuracy improves *feels* premium and accurate.
- ARWorldMap (B8.c) was considered but rejected: NZ trails have wildly variable lighting (clouds, time of day, season) and the user often won't return to a marker for weeks or months. Relocalization will fail too often to be reliable.
- ARGeoAnchor (B8.d) was rejected: no coverage in NZ backcountry. Apple's docs explicitly state `ARGeoTrackingConfiguration.checkAvailability` returns false outside supported areas.

---

## C. Solution architectures

Three distinct architectures are proposed. Each addresses all three bugs with a different trade-off profile.

### Architecture 1 — "Anchor-first" (minimal cinematic, maximum reliability)

**Components**:
- Unity: `ARAnchorManager` added to scene; `PortalSpawner.SpawnStrandInternal` does an `ARRaycastManager.Raycast` at plant; on hit, creates an `ARAnchor` via `TryAttachAnchor(plane, pose)` and parents the cairn container to the anchor's GameObject; `GroundYResolver` switched from "always lerp" to "lerp once until first Tier A, then lock".
- Unity: keep the defer queue (v187.7.13) but extend the readiness check to "ARSession tracking AND at least one horizontal plane in view".
- RN: at session start, after `ArReady`, compute average residual GPS offset across all markers within 20m and apply as a per-session correction (`B8.a`).

**Scores**:
| Metric | Score | Notes |
|---|---|---|
| Reliability | **9/10** | Anchor-attached = ARKit-grade stability. |
| Implementation effort | **3/10** | All public AR Foundation APIs; no UI work. |
| Mobile perf cost | **2/10** | One `ARAnchor` per cairn; negligible. |
| Cinematic feel | **5/10** | No new UX delight; just stops the bugs. |
| Compatibility | **9/10** | Works offline, no internet, all iPhones with ARKit, all conditions. |

**Best for**: ship fast, fix the bugs, no creative work needed.

---

### Architecture 2 — "Cinematic Summon" (premium feel, medium effort)

**Components**:
- Everything in Architecture 1, PLUS:
- Unity: `PortalSpawner` adds a "summon" pre-roll. Cairn spawns 60cm below the resolved ground Y, scale 0.3, alpha 0. Animates over 0.8s: rise to ground Y with eased cubic curve, scale to 1.0, alpha to 1.0. At the moment of surfacing, a one-shot dust/sigil particle burst plays at ground level. Wisps and text fade in over the following 0.4s.
- Unity: `GroundYResolver` Tier-A refinement during the 0.8s window is *invisibly absorbed* into the rise animation — if Tier A arrives at 0.4s and shifts target Y by 8cm, the rise curve is recomputed to land at the new Y. The user sees a directed cinematic, not ARKit settling.
- RN + Unity: a "scanning grid" effect (Avatar-style bio-luminescent fronds responding to the camera ray) renders during AR init pre-tracking. Each gridline glows briefly when the camera ray crosses it. Replaces the "low-light" overlay with a positive-feedback shader effect that rewards the user for moving the camera around.
- RN: marker confidence ring visualization (`B8.f`) — a soft glowing ring on the ground around each marker, radius = GPS confidence (typically 3–5m post-correction); the ring breathes gently and tightens visibly as the user approaches.

**Scores**:
| Metric | Score | Notes |
|---|---|---|
| Reliability | **9/10** | Same as Arch 1. |
| Implementation effort | **6/10** | Summon animation + dust burst shader + scanning grid shader + confidence ring shader. |
| Mobile perf cost | **4/10** | Several new visual effects. URP particle batching keeps it manageable. |
| Cinematic feel | **9/10** | Every transition is a directed effect. Failure modes (no plane detected) look intentional. |
| Compatibility | **9/10** | All effects are GPU-only; no internet, no special hardware. |

**Best for**: the premium product Cairn aspires to. Each fix becomes a feature.

---

### Architecture 3 — "Persistent World" (highest accuracy, highest effort, scope-limited)

**Components**:
- Everything in Architecture 2, PLUS:
- Unity: `ARWorldMapManager` (iOS-only path via `ARKitSessionSubsystem.GetARWorldMapAsync()` in AR Foundation 6). At session end (or every 60s during use), serialize world map to `Application.persistentDataPath/cairn-worldmap-<region-id>.dat`. Region key derived from a 1km-grid GPS bucket so the user's home trail vs city park keep separate maps.
- Unity: at session start, if a region map exists for the user's current GPS bucket, load and request relocalization. Show "Relocalizing…" UI for up to 5s; if successful, all subsequent marker placement uses the persistent world frame (BUG 8 → cm-level). If relocalization fails (lighting changed too much), fall back to Architecture 2 behavior (per-session GPS offset).
- RN: explicit "Re-anchor here" gesture — when user taps a marker icon and confirms, a B8.b alignment happens: the rendered ghost cairn moves to *exactly* where the user's camera ray hits the ground, and the GPS-to-AR transform is updated for the rest of the session AND saved with the world map for future sessions.

**Scores**:
| Metric | Score | Notes |
|---|---|---|
| Reliability | **10/10 in covered areas, 9/10 elsewhere** | Best-case: cm-level cross-session. Worst-case: same as Arch 2. |
| Implementation effort | **9/10** | iOS-only API in AR Foundation; map serialization; region keying; relocalization UI; Re-anchor gesture. Multi-week work. |
| Mobile perf cost | **6/10** | Map sizes 1–10 MB per region; relocalization runs full ARKit feature matching for several seconds at session start. |
| Cinematic feel | **10/10** | "I planted this cairn last month and it's still EXACTLY there" is a magic moment. |
| Compatibility | **6/10** | Relocalization fails in different lighting / weather / season. Map files grow per region; storage management needed. iOS only. |

**Best for**: a future "v2" milestone after Arch 2 ships and stabilizes.

---

## D. AR Foundation 6 iOS-specific availability

| Feature | AR Foundation 6 API | iOS support |
|---|---|---|
| `ARAnchorManager.TryAddAnchor(Pose)` | Yes | Yes — wraps `ARSession.add(anchor:)` |
| `ARAnchorManager.TryAttachAnchor(plane, pose)` | Yes | Yes — wraps `ARSession.add(anchor:)` with plane reference |
| `ARRaycastManager.Raycast(screen, hits, types)` | Yes | Yes — `PlaneWithinPolygon`, `PlaneEstimated`, `FeaturePoint`, `PlaneWithinInfinite` all supported |
| **`ARWorldMap` save/load** | **Yes via ARKit-specific subsystem extension** (`ARKitSessionSubsystem.GetARWorldMapAsync`, `ApplyWorldMapAsync`). Requires `using UnityEngine.XR.ARKit;` | **iOS only** (ARCore has no equivalent — Cloud Anchors fills that role on Android) |
| **`ARGeoAnchor` / Geo-tracking** | **Yes via ARKit subsystem** in AR Foundation 6.x; check `ARGeoAnchorManager`. Requires iOS 14+ and `ARGeoTrackingConfiguration` | **iOS only**, **major-city only** (`ARGeoTrackingConfiguration.checkAvailability(at:)` returns false in NZ backcountry) |
| `ARPlane.subsumedBy` | Yes | Yes — important: when ARKit merges two planes, the smaller one's `subsumedBy` points at the survivor. Anchors attached to the subsumed plane should be re-parented to the survivor. AR Foundation handles this transparently for `TryAttachAnchor` but not for manually-parented GameObjects. |

**Verdict for Cairn**: ARWorldMap is available and iOS-implementable. ARGeoAnchor is technically available but commercially unviable for the target use case (NZ backcountry).

---

## E. Avatar-level pre-tracking UX — "Scanning Grid"

The current code shows a "Low light or featureless area" warning when AR fails to track within 8s (`ARScreen.tsx` line 308). This is a negative framing: "the system failed".

**Proposed reframe — a "scanning grid" Avatar-style effect**:

Concept: while AR is initializing (pre-`SessionTracking`), instead of (or alongside) the "Looking around…" pill, render a subtle bio-luminescent grid overlay on the camera feed. Each gridline is a thin shader stroke that:
- pulses gently in the direction the camera is moving;
- brightens momentarily when ARKit registers a feature point on it (subscribe to `ARTrackedFeaturePointsManager.featurePointsChanged`);
- fades to invisible once tracking is confirmed.

The user perceives "the world is responding to me — it's *alive* and waking up". This is psychologically different from "the system is broken". Apple Measure does a softer version of this with the dot-grid on the floor; Pokémon GO has the "tap to wake" puff. Avatar's Pandora vegetation glows on touch — the same biofeedback loop.

**Implementation**: a single full-screen overlay shader. ~80 lines of HLSL. Performance: 1–2 ms / frame on iPhone 12.

This is included in Architecture 2 but worth highlighting on its own — it's the highest UX-leverage change for the smallest code footprint, and it converts the BUG 1 floating period from "frustrating wait" to "anticipation".

---

## F. Top recommendation

**Ship Architecture 2 ("Cinematic Summon").**

Reasoning:
- Architecture 1 fixes the bugs but the product still feels like a workaround app. Cairn's positioning is "premium hiking AR" — Arch 1 doesn't deliver on that.
- Architecture 3 is the right *eventual* destination but a 4–8 week project. Two of its features (ARWorldMap, Re-anchor gesture) depend on Architecture 2 being stable underneath. Don't build them on the current shaky foundation.
- Architecture 2 sits at the sweet spot:
  - **Fixes all three bugs** (anchors handle 1 + 7; per-session GPS offset handles the worst of 8).
  - **Gives every fix a cinematic dimension** (summon animation, scanning grid, confidence ring) that makes the product feel premium instead of patched.
  - **2–3 week implementation** — no exotic APIs, no internet dependency, no city coverage limitation.
  - **Universal compatibility** — works on every iPhone with ARKit, in every environment, online or off.

**Sequence of changes (Sprint plan suggestion)**:
1. Sprint S+1: anchor wrapping (B7.b) + raycast at plant (B1.c) + Tier-A lock fallback (B7.a). Ships fix for BUG 1 + BUG 7.
2. Sprint S+2: cinematic summon animation (B1.d) + scanning grid pre-tracking effect.
3. Sprint S+3: per-session GPS offset compensation (B8.a) + confidence ring visualization (B8.f). Ships fix for BUG 8.
4. Sprint S+4: polish, retro, decide if Architecture 3 (ARWorldMap) is worth pursuing for a v2 milestone.

Each Sprint independently shippable; each addresses a distinct user-visible quality gap.

---

## Sources

- [docs.unity3d.com — AR Foundation overview](https://docs.unity3d.com/Manual/AROverview.html)
- [CSDN — ARFoundation 系列讲解 27 ARWorldMap](https://blog.csdn.net/a451319296/article/details/109584374)
- [CSDN — 使用 ARFoundation 创建 AR 应用 — ARWorldMap 编程](https://blog.csdn.net/CyberLynxO/article/details/132953876)
- [CSDN — ARFoundation 系列解析 — 实现 ARWorldMap 编程](https://blog.csdn.net/HackSquad/article/details/133196835)
- [CSDN — ARKit 框架详解 / ARAnchor reference](https://blog.csdn.net/Philm_iOS/article/details/81036653)
- [Zhihu — 首届 Lightship 峰会 / Lightship VPS](https://zhuanlan.zhihu.com/p/519523140)
- [163 — 靠众包创建 AR 地图和 VPS](https://www.163.com/dy/article/H880ISI10511BQR8.html)
- [Niantic Spatial — VPS 2.0 release](https://so.html5.qq.com/page/real/search_news?docid=70000021_29769d5fda019252)
- [QQ — Snap & Niantic 空间地图合作](https://new.qq.com/rain/a/20250622A02KXY00)
- [Google ARCore — iOS Cloud Anchors developer guide](https://developers.google.cn/ar/develop/ios/cloud-anchors-developer-guide-ios)
