/**
 * OtaBadge — production-grade OTA status pill.
 *
 * Two display modes:
 *   • Default (floating top-right) — used on screens like Home where there
 *     is no natural slot for an inline badge. Hidden when up-to-date.
 *   • inline=true — renders inline (caller positions it). Always visible:
 *     shows "Up to date" when no update, "Updating…" while downloading,
 *     and "Update ready · tap to restart" when a downloaded update is
 *     waiting. Used on AuthScreen above the Sign In title.
 *
 * Behaviour:
 *   - Auto-checks expo-updates on mount
 *   - Auto-downloads when an update is available (no user prompt)
 *   - Once downloaded → shows "Update ready" pill that user taps to apply
 *   - Tap → modal "Restart now / Later" (inline mode) or direct restart
 *
 * Lazy-loads expo-updates so a missing module doesn't crash the screen.
 */
import React, { useEffect, useRef, useState } from 'react';
import {
  TouchableOpacity, Text, View, StyleSheet, ActivityIndicator,
  Animated, Easing, Modal, Pressable,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

// Manual OTA version counter. Bump this by 1 every time we ship an
// OTA update so the user can visually confirm they're running the
// latest bundle. The value is baked into the JS bundle, so when the
// pill says "v5 · Up to date" the user knows v5's changes are live.
//
// Bump rule: increment by 1 immediately before running `eas update`.
// Never reuse a number, never decrement.
//
// History:
//   186 — last v186 OTA before v187 portal cairn native build (#27/EAS).
//   192 — v187.7.12: link.xml IL2CPP preserve + asset fingerprint drift
//         monitor + AUTOMATION docs. Baked together with v187.7.11 CI
//         gate + URP/Cam/Volume instrumentation. After next EAS build:
//         AR feed should display real camera (no more yellow), and
//         ARDebugOverlay shows URPDiag/CamDiag/VolumeDiag for any future
//         visual issue.
//   193 — v187.7.13: GroundYResolver SessionTracking gate + PortalSpawner
//         defer queue (fixes "marker too close after re-enter AR") +
//         3 additional CairnBridge diagnostics (ARBgDiag2, RenderListDiag,
//         SessionLifecycleDiag) + CairnVolumeProfile regen.
//   194 — v187.7.13 OTA: re-expose OTA param panel + photo upload from
//         Photos library. Replaces the 📍 reset-location button (no longer
//         needed — AR origin works correctly) with a 🐞 debug-menu button
//         that opens an action sheet → either OTAControlPanel (21 sliders)
//         or photo upload to /api/debug-snapshot. No native build required;
//         uses expo-image-picker + expo-file-system already in package.json.
//         Backend route debug-snapshot.js exists from earlier iteration,
//         reused as-is. Drops __DEV__ gate so panel is reachable in
//         production builds (temporary tuning tool — will be hidden again
//         after visual issues resolved).
//   195 — Sprint 66: dual-source route edit ships. Existing routes get an
//         "Edit on map" surface with trim handles + 1km-corridor midpoint
//         drag, dual-line UI showing original GPS vs working line, save
//         preserves original trace. Routing decisions auto-pick DOC trails
//         (NZ official) for mountain routes, Mapbox roads for urban,
//         straight-line fallback only with explicit user confirmation.
//         App-kill / soft-unmount recovery via EditResumePrompt. OTA-only
//         (no native deps added — kdbush + expo-file-system pre-existing).
//   196 — v195.1 debug-button simplification: OTA params panel UI and
//         text-log upload are removed from ARScreen. The right-top button
//         now opens the iOS multi-select photo picker directly (single
//         action). Tuning is done by the dev based on uploaded screenshots,
//         not by the user. Multi-select + confirm sheet + 1h server TTL
//         (committed earlier under v194.1 but not OTA'd) ride along.
//   197 — v196.1 four user-reported AR fixes:
//         5 远处看不到 → setGlobal bumps WispFadeFar/IconScale/Halo/Wisp/Scroll
//         6 平放报错 → phone-flat threshold 0.85→0.97 + removed from plant gate
//         9 mark 完不让连 mark → PlantSheet squeeze 1.2s→0.5s + no await onPlant
//         10 init UX 干扰 → init=floating pill (not full-screen), 4s→8s timeout
//         Bug 8 (退出再进 marker 漂移 20m) intentionally postponed — needs
//         proper per-session anchor compensation that's beyond OTA scope.
//         Bugs 1/2/3/4/7 are Unity-side, await next build.
//   198 — Sprint 66 routes follow-up: 6 user-reported bugs from real-device
//         test batch + dual-review cleanup of regressions in the first pass.
//         User-visible changes:
//           1+2 Save as Route from Activity now opens RouteEditor in
//               draft mode with an editable name input (defaults to
//               'Hike Jun 9'/'Run Jun 9'), shows the activity's polyline
//               on the map, and lands on the Routes tab after save (not
//               the Activity detail).
//           3+4 View Route + Save-as-route draft both fit the camera to
//               the route bbox (cosine(lat) corrected, 1.4x padding).
//               No more user-GPS flash before snap.
//           5   Activity detail map gets a recenter button after the
//               user pans away.
//           6   too-short hike rejection now also checks distanceM<20m
//               (not just trackPoints<2) so 0-movement sessions with GPS
//               jitter no longer slip through.
//         Internal: handleSave is now async (awaits addRoute/updateRoute);
//         server-only sessions no longer break save (MapHistoryScreen
//         passes server-hydrated trackpoints via nav param);
//         displayedStats reads from geometry source priority instead
//         of empty waypoints[]; addRoute null result now throws into
//         catch instead of silent goBack. OTA-only.
//   199 — v198 follow-up: real-device test of save-as-route showed the
//         camera stuck on Mapbox's global default view (Corsica from
//         Asia) instead of the route. Root cause: the v198 "render no
//         Camera while waiting for hydration" path let MapView fall
//         back to the global default, and the late-mounting Camera
//         with center+zoom prop did not always pull the view back on
//         iOS. Fix: (a) Camera now uses the bounds prop (more reliable
//         than center+zoom for late-arriving data), (b) wait-state
//         Camera mounts at userCoord/region-center (never null), so
//         MapView never falls back to global default, (c) imperative
//         cameraRef.fitBounds() runs in a useEffect when routeCameraFit
//         changes — guarantees the view moves even if the prop update
//         path missed. Bbox padded ±10% (min 0.0005°) so the polyline
//         has breathing room. OTA-only.
//   200 — v200 route edit redesign: replace the 3-fixed-handle
//         (trim-start/trim-end/midpoint) interaction with a node-tap
//         model. Both entries (save-as-route from Activity, view-route
//         from Routes) now land in view-only mode; user taps Edit to
//         enter edit-mode. The right button toggles between Cancel
//         (save-as-route draft) and Delete (existing route). In edit
//         mode the route's snap-to-road junction nodes (degree>=3 in
//         the corridor TrailGraph) appear as small grey circles, plus
//         the two endpoints as colored handles. Tap a node → its 1km-
//         reachable, corridor-validated candidates light up. Tap a
//         candidate → commit the replacement (midpoint nodes call
//         commitMidpointDrag; endpoints route through trimStart/Stop or
//         the new restoreStart/restoreEnd actions for trim-restore).
//         Pre-validation filters out candidates whose post-replacement
//         segments leave the original 1km corridor — user only sees
//         working candidates. Background tap deselects.
//         Foundation: routeNodeAnchors helper (anchor extraction +
//         endpoint-exclusion + degree filter), candidateNodes helper
//         (Dijkstra + corridor pre-check + nearest-snap utility),
//         EditableNodeLayer component (Mapbox PointAnnotation rendering
//         with idle/selected/candidate state colors).
//         restoreStart/restoreEnd are pure-prepend/append (no orchestrator
//         re-routing) — they reuse originalPoints geometry so the
//         operation is reversible to the GPS truth. Coverage invariant
//         enforced. Persistence chain unchanged.
//         Trim handle drag (long-press + drag) is replaced by tap-to-
//         tap. The Phase 5 spec drag-with-magnet pass is deferred —
//         tap-to-tap covers the common case smoothly without gesture
//         conflict. OTA-only.
//   201 — v199 cinematic AR rebuild ships (the Phase 4-7 EAS build).
//         Single build replaces v187 cairn visual stack with Pounamu
//         greenstone NZ-aesthetic Avatar-grade system: ARAnchor parenting
//         (fixes #1/#7 floating + drift), per-session GPS offset
//         compensation (fixes #8 re-entry 20m), TMP SDF rune text on
//         stone backplate (fixes #2 字重叠), 3D oblate-spheroid pebble
//         cairn icon matching logo + billboard type chips for other
//         types (fixes #3 icon angles), real ascending strand particle
//         lifecycle Trails Module PerParticle + 5 hero mesh ribbons +
//         far-distance light shaft (fixes #4 flowing + #5 distance),
//         permanent floating-pill init UX with Avatar-style scanning
//         grid (locks #10), Tier-A Y-lock to eliminate post-plant
//         micro-drift, brand-new like/report aim-detection UX with
//         on-cairn realtime count badge. Backend canon-correct single
//         /vote endpoint with HMAC nonce + rate-limit + impossible-
//         travel + GPS gate (canon §一-4 mutex + 永久1票 enforced).
//         ~135 OTA-tunable globals (vs ~25 in v187). app.json version
//         0.2.0 → 0.2.1 to gate LikeReportSheet on binaries with the
//         new Unity LikeBadge handler (V2.C8).
//   202 — v200 follow-up: review subagent found 2 Blockers + 4 Critical
//         in the v200 first-ship attempt; this commit addresses them.
//         B1 (orphan persisted route on Cancel): freshlyCreatedRouteId
//         tracked across the save-as-route → Edit flow; cancel/discard
//         deletes the backend route. Unmount cleanup catches the case
//         where the user exits via hardware back / BackButton without
//         hitting Cancel. The view-mode Cancel button now branches on
//         (fromSessionId && !routeId) OR (freshlyCreatedRouteId === routeId)
//         so post-addRoute view-mode still treats Cancel as "discard".
//         B2 (two-tap Edit UX with no feedback): single-tap Edit now
//         calls addRoute then continues straight into the existing-route
//         dualEdit init using effectiveRouteId/effectiveExistingRoute
//         locals. No re-tap needed.
//         C3 (top-bar + bottom-row both render Save/Cancel): top-bar in
//         dualEditActive now keeps ONLY Reset. Save + Cancel are bottom-
//         row only.
//         C1, C2, C4 deferred to v203 (zoom-gate-with-active-selection
//         edge case + drag snap-radius scale-by-zoom + drag gesture
//         long-press conflict are bounded by tap-to-tap fallback being
//         primary).
//         OTA-only.
//   203 — v199 cinematic AR rebuild ships in the next EAS build (binary
//         version 0.2.1, see V2.C8 gate). Same scope as documented at
//         line 145-162 above; bumped because v202 occupied 201. After
//         this OTA, the new aim-detection LikeReportSheet UI mounts only
//         on binaries >= 0.2.1; older v0.2.0 binaries running v203 OTA
//         see no LikeReportSheet, no Unity LikeBadge, no broken UX.
//   204 — v200 follow-up: review subagent found 2 Blockers + 4 Critical
//         in the v200 first-ship attempt; this commit addresses them.
//         (Originally bumped 200→202 in an earlier draft; master-side
//         AR work landed v203 in parallel, hence final 204.)
//         B1 (orphan persisted route on Cancel): freshlyCreatedRouteId
//         tracked across the save-as-route → Edit flow; cancel/discard
//         deletes the backend route. Unmount cleanup catches the case
//         where the user exits via hardware back / BackButton without
//         hitting Cancel. The view-mode Cancel button now branches on
//         (fromSessionId && !routeId) OR (freshlyCreatedRouteId === routeId)
//         so post-addRoute view-mode still treats Cancel as "discard".
//         B2 (two-tap Edit UX with no feedback): single-tap Edit now
//         calls addRoute then continues straight into the existing-
//         route dualEdit init using effectiveRouteId/effectiveExistingRoute
//         locals. No re-tap needed.
//         C1 (zoom < 14 hides candidate dots): hideIntersections check
//         now exempts isSelected + isCandidate, so endpoint-tap at low
//         zoom still surfaces visible candidates.
//         C2 (snap radius too generous at low zoom): SNAP_RADIUS_M now
//         scales by current zoom (~50px screen-equivalent), capped
//         [20m, 200m]. handleAnchorDragEnd useCallback deps include
//         currentZoom.
//         C3 (top-bar + bottom-row both render Save/Cancel): top-bar
//         in dualEditActive keeps ONLY Reset. Save + Cancel are bottom-
//         row only.
//         C4 (long-press drag gesture conflict on iOS PointAnnotation):
//         documented trade-off — tap-to-tap is the primary discovered
//         path; drag-with-magnet is a power-user alternative requiring
//         long-press by Mapbox native default. Replacing this with a
//         custom screen-coord overlay is a v205 candidate.
//         OTA-only.
//   205 — v199 cinematic AR rebuild SHIPS. Pairs with the EAS build that
//         consumes UnityFramework.xcframework SHA ddcee027… (CI run
//         27221206395 on commit 692022f, master-merged as b7e8bd1). The
//         RN bundle delivered by this OTA contains:
//           • LikeReportSheet aim-cone activation (3D dot-product, V2.C1)
//             — only mounts on binaries >= 0.2.1 (v203 V2.C8 gate retained)
//           • useLikeReport hook hardened: mountedRef + abortRef + stable
//             getAuthTokenRef so 8s poll no longer restarts on every
//             ArFrame (10Hz parent re-render → server hammered) and post-
//             unmount setState/setError calls are guarded
//           • UnityAROverlay per-session GPS offset compensation (B3 fix
//             for "exit-and-reenter cairn drifts ~20m"): one-shot
//             OnSetSessionOffset before bulk-spawn, projOrigin = persisted
//             arOrigin else live userPos, offsetN/E from cosine-corrected
//             delta
//         Native side (binary 0.2.1, EAS build pending):
//           • PortalSpawnerV199 cinematic stack (8 shaders, 3 pebble
//             meshes, ribbon strands, scan grid, confidence ring,
//             handshake beam, type chip, light shaft)
//           • CairnGlobalsExt 110 OTA globals (5 missing ShaderUniform
//             bindings + 6 kill-switches added)
//           • SummonThenAnchor coroutine (C2: serialise summon → anchor)
//           • link.xml IL2CPP preserve covers URP/Core/TextMeshPro
//           • BuildScript silent-imports TMP Essentials before SceneSetup
//             so LiberationSans SDF is present on CI fresh checkout —
//             without this RuneText + LikeBadge silently fail-soft skip
//         Asset fingerprint extended: 8 v199 shaders + 3 pebble meshes +
//         PortalSpawnerV199 + CairnGlobalsExt monitored for cross-Unity-
//         version drift (76f1 local vs 36f1 CI). Spike 2 thermal
//         validation deferred to post-ship telemetry per Sprint 0
//         scope decision.
//   206 — v199 production-test bug-fix wave. User reported 6 issues on
//         binary 0.2.0 + OTA v205: cairn 不贴地、ribbon 不动、上方白色遮挡、
//         关 AR 重开标记不见、闪烁飞天、远端飘走. Telemetry baseline
//         (docs/v206-runtime-baseline.md) extracted from aliyun
//         telemetry_sessions confirmed root causes. RN-side fixes
//         deliverable as OTA, Unity-side rides next EAS build (v207).
//
//         RN fixes shipped THIS OTA (works on 0.2.0 + 0.2.1 binaries):
//           A1 BULK-EMPTY-BURN: UnityAROverlay.tsx one-shot burned when
//              nearbyMarkers temporarily empty (lastCoord race after
//              MMKV hydrate) → reopen AR with no cairns rendered.
//              Fix: drop length===0 burn clause; add 30/100-frame
//              waiting-markers diagnostic breadcrumb so empty state
//              is visible in telemetry.
//           A2 AROrigin-NONREACTIVE: ARScreen.tsx:1039 read arOrigin via
//              getState() non-reactively → baseline showed 5/5
//              OnSetSessionOffset events all ox=0/oz=0/mode=live,
//              persisted arOrigin NEVER used. Fix: useMarkerStore(s=>s.arOrigin)
//              selector subscription + replace offsetSentRef one-shot
//              with lastSentOriginRef equality check that RE-sends
//              OnSetSessionOffset when projOrigin transitions
//              null→persisted mid-session.
//           B1 RN GROUND-Y POLICY: groundYRef was "last plane wins
//              regardless of area" — plant 5 in baseline got groundY
//              from 0.3m² outlier overwriting 1.9m² stable plane.
//              Fix: drop area<0.5; 5s rolling buffer; pick largest
//              area; AND listen for Unity "[GroundYResolver] locked
//              Y=... tier=A" log line so Unity's authoritative value
//              supersedes raw plane events once locked.
//
//         Native fixes pending EAS v207 build (binary 0.2.2):
//           B2 adaptive lerp (snap >15cm, fast 2.5m/s 5-15cm, slow
//              <5cm); B3 ASSUMED_HOLD_HEIGHT 1.5→1.3m default + OTA
//              tunable + TierC override only when Tier-A unavailable
//              AND data.y unreasonable; C FarShaftDistanceGate runtime
//              MonoBehaviour hides shaft <6m (FarShaftMinDist); D1
//              Pebble_S Y 0.45→0.43 stack alignment; D2 5 kill-switches
//              wired in code (V199LayerEnabled, RuneTextEnabled,
//              PebbleStackEnabled, TypeChipEnabledOTA, AnchorAttachEnabled
//              were previously registered in CairnGlobalsExt but never
//              consulted in PortalSpawnerV199 — flipping them did
//              nothing in v205).
//
//   207 — Sprint Mapbox-Migration: replace NZ-only DOC ArcGIS pipeline
//         with global Mapbox vector tile junction extraction. Edit mode
//         now works in any city/region where Mapbox has road/trail data
//         (which is global). Files: new mapbox/MapboxJunctionExtractor +
//         buildTrailGraphFromMapbox; editContext.ts wired through;
//         RouteEditorScreen forces zoom>=14 + 600ms wait before extract.
//         DOC code retained in tree for future NZ-region merge.
//   208 — Sprint Mapbox-Migration v207 follow-up review fixes:
//         B1 (double camera jump), B2 (endpoint POI occlusion),
//         C1 (onDidFinishRenderingMapFully), C2 (legacy path timing),
//         C3 (Android source fallback), C4 (walkedIndex dedup).
//   209 — v208 follow-up: fix non-legacy branch buildEditContext
//         time-ordering — was running extractJunctions BEFORE beginEdit
//         (dualEditActive=false → camera still on routeCameraFit, often
//         zoom<14 for long routes → extractor early-exit zoom-too-low).
//         Now mirrors legacy branch pattern: beginEdit → wait tiles →
//         buildEditContext → setState inject.
//   210 — virtualOrigin per session. Telemetry 715 confirmed ARKit world
//         coords reset every reopen (camera.px/pz jumps 6m+ across 7 reopens).
//         RN was projecting cairn (lat,lng) into meters relative to a
//         persisted arOrigin, but those meters were handed to ARKit as if
//         its world origin == arOrigin. ARKit's world origin = wherever
//         camera was at first SessionTracking — never == arOrigin. So
//         cairn landed at (1.62, 0, 1.11) every reopen, but visually at
//         random direction relative to user (camera moved between sessions).
//         Fix (Option C from design subagent): at first ArFrame, derive
//         virtualOrigin from camera.px/pz + user GPS:
//           virtualOrigin.lat = user.lat + camera.pz / 111000
//           virtualOrigin.lng = user.lng - camera.px / (cosLat × 111000)
//         Cairn projected via virtualOrigin lands at (camera.px, *,
//         camera.pz) for cairns at user GPS, +1m east → (camera.px+1, *,
//         camera.pz). Stable user-relative position regardless of how
//         ARKit oriented its world this session. Plant flow same change:
//         lat/lng derived via virtualOrigin so plant↔spawn projection
//         consistent. _sessionOffsetX/Z stays 0 (offset baked into
//         virtualOrigin). arOrigin in MMKV becomes informational only.
//   211 — Mapbox junction extractor: replace narrow whitelist with blacklist.
//         v207-209 default allowedClasses was [path,track,footway,pedestrian,
//         cycleway,street,service,tertiary] — too restrictive globally.
//         City main roads (primary/secondary) and residential were silently
//         dropped, so urban routes outside NZ saw very few intersection
//         anchors (Shanghai 0.7km route showed only 1 idle anchor in
//         user telemetry id=73). Switch to blacklist excluding only
//         high-speed / non-walkable infra (motorway*, trunk*, ferry, golf,
//         aerialway, *_rail, construction). Now keeps every walkable
//         road class globally + forward-compat for new Mapbox class values.
//         Allowlist mode preserved as opt-in for callers needing strict
//         filtering. Coverage: 95/95 routing tests pass.
//   212 — REVERT v210 virtualOrigin. v210 was wrong path: it used camera.px/pz
//         in a frame ARKit doesn't actually align (Unity ARFoundation never
//         configures worldAlignment=GravityAndHeading; ARKit defaults to
//         ARWorldAlignmentGravity where +X=phone-facing-at-start, NOT east).
//         Recomputing projOrigin every frame from camera + GPS amplified
//         camera SLAM drift (telemetry 715: camera.pz drifted 0→6.87 across
//         reopens) → cairn shifted up to 6m+ per session compounding into
//         "偏到奶奶家" overshoot. Restored Viro's working pattern: lock
//         arOrigin = user GPS once, persist to MMKV (drop only on >100m
//         travel), spawn directly with arOrigin as projection basis,
//         ARKit SLAM keeps cairn visually stable within session. ARKit
//         camera position used ONLY for hit-test ray (where user pointed),
//         NOT for re-deriving projection origin.
//
//         Known LIMITATION (compass direction wrong): without
//         worldAlignment=GravityAndHeading, ARKit world axes orient to
//         phone-facing direction at AR mount, not true north. Cairn
//         distance is correct, direction is rotated. Needs native iOS
//         plugin in next EAS build to set worldAlignment properly. v210's
//         virtualOrigin attempted to compensate this but compounded the
//         error instead. Direction-bug acknowledged, distance-bug fixed.
//   213 — v211 follow-up: the broaden-class-filter commit alone does not
//         fix the Shanghai bug because editContext was padding bbox by
//         5km on each axis (a 0.7km route → 100km² query area). With
//         dense urban OSM coverage that routinely emits 50k-200k
//         vertices, tripping the 20k vertex cap and aborting the entire
//         extract → trailGraph=null → endpoint-only mode (the exact
//         regression v211 was meant to fix). Two changes:
//           a) editContext padBboxKm 5 → 1.5 (corridor radius is 1km,
//              so 1.5km gives 0.5km safety; bbox area cut by ~10× for
//              short routes). Long routes still fit naturally.
//           b) maxVertexCount 20000 → 60000 to absorb dense viewports
//              (Manhattan, Tokyo) without aborting. UI responsiveness
//              still protected by yield-every-1000-vertices.
//   214 — plant↔spawn origin consistency. v212 reverted v210 virtualOrigin
//         so spawn uses persisted arOrigin, but PLANT was still using
//         arFrame.origin (= live userPos at plant time). Telemetry 749
//         confirmed: plant origin=31.230326,121.435167 but spawn
//         projOrigin=31.2303506,121.4353929 — 21m apart. GPS noise
//         between live and persisted made round-trip inconsistent →
//         cairn visible offset between plant and reopen.
//         Fix: plant reads persisted arOrigin from store directly,
//         falls back to arFrame.origin only if not yet locked. Now
//         plant.cairnLat/Lng → spawn.x/z is mathematically consistent.
//         Compass-direction bug still requires native GravityAndHeading
//         plugin (next EAS build).
//   215 — junction emission HM6 root-cause fix. v207-214 still showed
//         only 1 intersection anchor on the user's Shanghai 0.7km route
//         despite class-broaden + bbox + cap fixes. Root cause: the
//         old algorithm iterated workingPoints (GPS samples on
//         sidewalk) and snapped them to graph nodes (road centerlines
//         10-15m away on wide streets). With GPS noise + sidewalk
//         offset, snap distance often exceeded SNAP_TOLERANCE_M=30,
//         and even when it didn't, the closest node was usually a
//         degree-2 densified vertex, not the actual junction.
//         New algorithm: iterate trailGraph nodes (degree>=3 only) and
//         project each onto the route polyline; emit anchor if
//         perpendicular distance < ROUTE_PROXIMITY_TOLERANCE_M=30. The
//         distance metric is now polyline-to-junction (independent of
//         GPS sample density), and the anchor's coordinate is the
//         actual junction (centerline crossing point), not a sidewalk
//         GPS sample. Adds [edit-diag-extract], [edit-diag-graph],
//         [edit-diag-anchors] console logs for further telemetry.
//         Also: HM5 latent fix — querySourceFeatures now passes
//         undefined instead of [] for filter (some Mapbox iOS SDK
//         builds reject all features when given empty-array filter).
//   216 — auto-upload edit diagnostics to /api/edit-diag (no screenshots
//         needed). Three streams emitted on every enterDualEdit:
//         extract / graph / anchors. Backend stores 24h with TTL,
//         readable via GET /api/edit-diag and /api/edit-diag/:id.
//         Fire-and-forget; failures swallowed; never blocks edit flow.
//   217 — telemetry-driven cap bumps. v216 diag id=2 confirmed Shanghai
//         0.7km route emitted 60296 raw vertices, just barely tripping
//         the 60k cap → endpoint-only fallback (the same regression
//         v213/v215 tried to fix). Bumps:
//           - maxVertexCount  60000 → 200000  (covers central Shanghai
//             at 1.5km bbox padding ~50km road/km² density)
//           - MAX_GRAPH_NODES   500 → 3000   (Shanghai 200k vertex graph
//             after 30m union-find ~1500-2500 nodes; 500 forced 80%
//             into the truncated bucket making junctions unreachable)
//         Dijkstra cost on 3000 nodes still <50ms.
//   218 — v0.2.2 binary ship — Cairn AR root cause fix wave. Companion
//         OTA bumped 217→218 alongside binary 0.2.1→0.2.2 EAS build.
//
//         **The actual root cause** of "标记每次位置不一样 / 跟我走 /
//         偏到奶奶家" found this cycle: Unity ARFoundation NEVER sets
//         ARKit's worldAlignment=GravityAndHeading. ARKit defaults to
//         ARWorldAlignmentGravity → +X axis = phone-facing-direction at
//         session start (NOT true east). Every "+X=East, -Z=North"
//         comment in this codebase has been aspirational, not actual.
//         Cairn projection math (gpsToArkitWorld) assumed GravityAndHeading
//         semantics; under default Gravity it landed cairns at the
//         correct distance but at random compass rotation each session.
//         This was the SAME alignment Viro used by default (declarative
//         worldAlignment="GravityAndHeading" prop on ViroARSceneNavigator).
//         Migration to Unity ARFoundation silently dropped the config →
//         every visible-AR symptom from v199-v214 traces back here.
//
//         v0.2.2 NEW MonoBehaviour ARKitSessionInit ([DefaultExecutionOrder
//         (-100)]) sets ARKitSessionSubsystem.requestedWorldAlignment =
//         GravityAndHeading at session-Ready, verifies via readback +
//         retries via ARSession.Reset() once on mismatch. SceneSetup wires
//         it onto ARSession GameObject. link.xml preserves type. Pure C#
//         — no native Obj-C plugin needed (ARFoundation 6.0.5 exposes the
//         API publicly per docs/research and Library/PackageCache source).
//
//         v0.2.2 ALSO ships everything that was source-fixed but never
//         binary-shipped (v206-v214 source mods only got into RN OTA,
//         not native binary):
//           - PortalSpawner: data.x+_sessionOffsetX, _sessionOffsetZ+data.z
//             at spawn (v209 fix, was dead in 0.2.1 binary)
//           - PortalSpawner: B3-policy (Tier-A wins, data.y trusted unless
//             unreasonable >3m or <0.3m below camera)
//           - GroundYResolver: AssumedHoldHeight 1.5→1.3 + OTA-tunable
//             via CairnGlobals; adaptive lerp (snap >0.15m, fast 2.5m/s,
//             slow 1m/s)
//           - PortalSpawnerV199: Pebble_S Y 0.45→0.43 stack alignment
//           - 4 kill-switches wired (V199LayerEnabled, RuneTextEnabled,
//             PebbleStackEnabled, TypeChipEnabledOTA)
//           - FarShaftDistanceGate MonoBehaviour (5Hz hide when <6m)
//           - TMPDistanceFader for v199 cinematic rune text fade (was
//             attaching legacy MarkTextDistanceFader which silently no-op'd
//             on TMP_Text)
//
//         v0.2.2 NEW IN THIS BUILD (not just shipping v206-v214 source):
//           - AnchorAttachEnabled OTA killswitch wired into TryParentToAnchor
//             (was orphan: registered in CairnGlobalsExt but never read).
//             Set false to keep cairn parented to spawner GO via SLAM only,
//             skip ARAnchor attempt if it misbehaves on user's device.
//           - 3-step font lookup chain in SceneSetup: TMP/Resources →
//             Resources/Fonts → Resources.Load runtime fallback. Logs
//             which path resolved.
//           - [v22-DIAG-SESSION] one-shot at ArReady: binVer + buildGuid +
//             worldAlignment readback + all v207-218 fix flags fingerprint
//           - [v22-DIAG-SPAWN] per-cairn from PortalSpawner: rnX/Y/Z, ox/oz,
//             finalX/Y/Z, groundSrc (RN|TierA|TierB|TierC), tierAFound,
//             camY, assumedH
//           - [v22-DIAG-CAIRN] per-cairn from PortalSpawnerV199: every
//             OTA killswitch state + every layer attach result
//           - [v22-WORLDALIGN] from ARKitSessionInit: requested vs actual
//             alignment, verified bool, retry count
//           - [v22-ANCHOR] from TryParentToAnchor: skip reason or attach
//             result with parent name
//
//         If ANY bug appears post-v0.2.2, RN telemetry breadcrumbs greppable
//         by [v22-*] tag will identify exactly which fix code path didn't
//         take. No more guessing.
//   219 — extractor subsample replaces densify. Telemetry id=3 (v217)
//         showed Shanghai 1.5km bbox raw vertex count exceeded 200000
//         even after lifting cap from 60k. Root cause: Mapbox z14
//         vector tile preserves OSM 1-3m vertex spacing (already so
//         dense densify(part, 10) is a no-op). 382 features × ~520
//         raw vertices each = 200k+. Density was fine; the algorithm
//         was double-paying for already-dense data.
//         Fix: drop densify, replace with cap-50-vertices-per-part
//         subsample (preserve first + last so junction endpoint
//         sharing across ways still produces matching fingerprints).
//         Per-way coords now <=51 vertices, 382 ways × 51 ≈ 19k
//         total — well under maxVertexCount (rolled back to 30k).
//         Junction topology preserved at way endpoints; corridor
//         density still adequate for kdbush proximity queries.
//   220 — diag plumbing fix. v219 telemetry id=4 showed extract OK
//         (5843 ways, 742 junctions, 15724 vertices) but anchors and
//         graph diag never uploaded — meaning the downstream pipeline
//         either threw silently OR the upload was eaten by the
//         console.log gate. Two fixes:
//           a) buildTrailGraphFromMapbox wrapped in try/catch with
//              uploadEditDiag('graph-error') so kdbush OOM /
//              union-find RangeError surfaces instead of silent null.
//           b) graph diag upload moved out of the
//              `if (typeof console !== 'undefined' && console.log)`
//              gate — RN production may strip the entire block. The
//              console line stays gated; the upload runs unconditionally.
//           c) outer try/catch around extractJunctions also uploads
//              `extract-error` with message + name when it throws.
//         Next telemetry roundtrip will tell us whether 5843 ways are
//         choking TrailGraph (need to cap ways pre-graph) or the graph
//         builds fine but routeNodeAnchors is wrong.
//   221 — local E2E pipeline smoke test reproduced the 0-anchor symptom
//         WITHOUT a real device. Synthesized 50×50 city grid (5700 ways)
//         + 0.7km route on row 25. Found two real bugs:
//           a) MAX_GRAPH_NODES=3000 truncated row 16+ entirely; route on
//              row 25 had ZERO graph nodes within 1100m. Bumped to 10000.
//           b) routeNodeAnchors did not skip the 'tnTRUNC' overflow
//              bucket → it tried to project a fake junction at the
//              first overflow vertex's coord (degree 768) onto the
//              polyline, useless garbage. Now skipped explicitly.
//         After both fixes, smoke test produces 6 intersection anchors
//         (8 grid junctions on route minus 2 endpoint-exclusion).
//         Smoke moved to src/services/routing/__smoke__ to keep jest
//         from auto-running the standalone script.
//   222 — diag for render side. v221 telemetry id=11 confirmed anchors
//         pipeline produces 8 anchors (2 endpoint + 6 intersection)
//         but user still sees only endpoints in screenshots, AND
//         endpoint marker drifts off the line tip. Two new diag streams:
//           - 'anchors': now also uploads endpoint anchor coords +
//             polylineStart/End coords + first 10 intersection coords
//             so we can verify endpoint-coord==polyline-coord and check
//             whether intersection coords are visually onroute.
//           - 'render': fired on every (currentZoom, anchorCount) change,
//             reports currentZoom + hideIntersections + counts. If
//             currentZoom < 14 the EditableNodeLayer hides intersections
//             — we'll know if zoom-state is stuck.
//   223 — telemetry showed routeId=20 ran extract OK (5843 ways) but
//         NO graph/anchors uploaded — buildTrailGraphFromMapbox is
//         silently dying on 5843 × ~51 = ~300k vertices. Cap ways to
//         1500 (even-sample) before feeding the graph builder. Add
//         'graph-enter' diag to confirm we entered the branch (the
//         existing graph-error catch may have lost its upload too).
//   224 — AR observability + telemetry trust round. v0.2.2 production cycle
//         shipped F1 (real sessionOffset) + F4 anti-tabletop, but user
//         report "全部错误" + adversarial subagent review (5 rounds, 16
//         failure scenarios) revealed:
//           a) F4 camY-0.5 threshold too lenient — let plane y=-0.07 through
//              with camY=+0.4 (wardrobe top accepted as floor).
//           b) telemetry app_version reports '0.2.0' on v0.2.2 IPAs because
//              5 sites hardcode '0.2.0' literal (crashLogger.ts × 3,
//              ARScreen.tsx × 2 — one of which uses Constants.expoConfig
//              .version which is JS-bundle-time, not native-binary-time).
//              Backend cannot trust app_version filtering until this lands.
//           c) Real Unity-side root cause for 飞天 is GroundYResolver
//              Tier-A unconditionally accepting any horizontal plane (no
//              area gate, no classification, no HorizontalDown rejection)
//              + 1s lock making bad picks permanent. That fix needs an
//              EAS rebuild — NOT this OTA.
//         This OTA delivers the RN-side improvements that DO NOT need a
//         binary rebuild:
//           1) F4 tightened: threshold camY-0.5 → camY-0.8 (chest-height
//              hold = floor ≥0.8m below cam, tabletops ~0.7m below caught)
//              + bottom-third heuristic (plane must be in lowest 1/3 of
//              observed Y range over 5s window — defense for rooms where
//              multiple tabletops appear before any floor is detected).
//              F4 protects bulk-spawn's shared seed value (groundYRef →
//              data.y for ALL N markers → Unity Tier-A 'closest-to-tap-y'
//              tiebreaker).
//           2) app_version telemetry trust: 5 sites switched to
//              Application.nativeApplicationVersion (expo-application).
//              v0.2.2 IPA reports '0.2.2', v0.2.3 IPA reports '0.2.3',
//              regardless of which OTA bundle is loaded. Backend can now
//              filter by IPA version reliably.
//         Pending for next EAS build (NOT in this OTA):
//           - GroundYResolver v3: ARPlane.classifications.Floor primary,
//             dataY-anchor disambiguation, no Tier-C camY heuristic
//           - UnityLogger rate-limit bypass for [v22-*] tags
//           - TMP font BuildScript hard-fail + Resources/Fonts commit
//           - debug-snapshot enriched meta (state snapshot RPC)
//   225 — F4 hotfix from v224 telemetry id=783 measured behavior. Two
//         bugs surfaced:
//           a) bot3 false-positive: real floor at y=-0.95 was rejected
//              with bot3=false because the entire observed cluster was
//              floor-tier (range 0.19m), so 34% cutoff demanded plane
//              be in lowest 0.065m — tighter than ARKit's per-frame
//              plane jitter. Fix: require range >= 0.5m before bot3
//              can reject (below that, all observed planes are likely
//              the same physical floor cluster); add absolute-distance
//              safety net (any plane within 0.20m of minY always passes
//              regardless of percentile).
//           b) max-area picked wrong plane: telemetry showed groundYRef
//              jumping to y=-0.06 (small wardrobe top) over y=-0.86
//              (real floor 1.6m²) because area is not a reliable proxy
//              for "is this floor". v225 changes selection to LOWEST-Y
//              among F4-survivors. Anything that survived F4 is
//              plausibly floor-like; among those the lowest is most
//              likely the actual floor (tabletops/beds always ABOVE
//              floor in the AR world frame).
//   226 — "grounded visual defaults" auto-push at ArReady. v225 telemetry
//         + 4 user snaps confirmed the Y coordinate has been correct since
//         v199: Tier-A locks reliably to floor (-0.04m) across 4 camera
//         postures (camY 0.5/1.1/1.3/1.5). User reports "全部浮空" are
//         caused by upper-structure dominance, NOT Y bugs:
//           - LikeBadge floats at y=1.6m (face level for camY 1.4)
//           - FarShaft top reaches y=2.5m
//           - RuneText at y=1.3m
//         At close hit-test distance (0.3-1m) these ornaments fill the
//         user's gaze axis while the actual pebble base on the floor sits
//         below the lower edge of the screen → looks "floating".
//         Adversarial subagent verified pivot is at BASE (PebbleStack
//         offsets each pebble by halfHeight; bottom of L touches container
//         y=0 = groundY). No model bug.
//         Fix (OTA-only, no EAS rebuild): auto-push 9 OTA globals at
//         ArReady to drop ornaments below face level + strengthen the
//         contact shadow (the #1 perceptual cue that an object is on
//         the ground):
//           PortalScale 1.0→0.6, HeroRibbonHeight 1.5→0.8, count 6→3,
//           WispHeight 1.0→0.7, TextHeight 1.0→0.7, LikeBadgeFloatHeight
//           1.6→1.0, ContactShadowAlpha 0.55→0.85, ContactShadowRadiusMul
//           1.0→1.4, SummonRiseDistance 0.6→0.3.
//         All clamped server-side via CairnGlobals.SafeClamp; values are
//         pure visual tuning so a bad payload only changes feel, never
//         disappears cairns.
//   227 — disable summon-rise animation. v226 telemetry id=791-792 + user
//         confirmation: cairn DOES rise from finalY-0.30 UP to finalY over
//         0.4s (ease-out cubic, intentional v199 §C.1 design). Subagent
//         verified at PortalSpawnerV199.cs:563 startPos = finalPos -
//         (0, rise, 0). User report "出现的时候是升上来的 → 浮空感" is the
//         animation, not a Y bug.
//         Fix: push SummonEnabled=0 + SummonRiseDistance=0 via OTA.
//         CairnGlobals reads SummonEnabled at PortalSpawnerV199.cs:188-191;
//         when false the entire summon coroutine is skipped — cairn settles
//         at finalPos on first frame, instant appear, no rise.
//         Note: separate Tier-A floor-selection bug (finalY=-0.37 instead
//         of true floor) still requires Unity rebuild — see GroundYResolver
//         v3 in pending Phase 1.
//   228 — EMERGENCY HOTFIX for v220-v227 sessionOffset blowout. v227
//         production telemetry id=797 caught: ox=-21.4m oz=+2.7m
//         (live lat-lng drifted 0.0002°×3 = 22m × √2 from persisted in
//         under 1 minute). PortalSpawner.SpawnStrandInternal shifted
//         EVERY cairn by 21m → all spawns landed at finalX≈-21m → off-
//         screen. User reported "mark不渲染。看不到任何".
//         Root cause: F1 (v220) trusted EVERY GPS sample as user-movement.
//         Indoor/stationary phones produce 10-30m random GPS walks per
//         minute. Pushing that as sessionOffset breaks the entire session.
//         Fix: clamp |offset| to ≤5m. Beyond that, force ox=0 oz=0 —
//         either user actually walked too far for the AR session to
//         track (in which case re-spawn is needed anyway), OR it's GPS
//         noise (in which case we must NOT translate cairns).
//         This restores cairn visibility for users on v220-v227.
//   229 — Sprint MVT-Envelope. Move junction extraction off device entirely.
//         Backend (Node.js) now decodes Mapbox Vector Tiles at route save
//         time, builds an EditEnvelope (ways + junctions within 1.5km
//         corridor) and persists to MySQL `route_edit_envelopes`.
//         App's `buildEditContext` first tries `fetchEditEnvelope` →
//         `adaptEnvelope` → existing TrailGraph pipeline. On miss it falls
//         back to the legacy on-device MVT path (kept intact for
//         compatibility). Spike validated 5 cities; Shanghai 5km bbox
//         9 tiles ≈ 1.5s, 783 ways, 43 junctions. Eliminates 4 OOM
//         failures on Hermes by moving compute to Node.
//   230 — v229 review fixes (pre-deploy):
//           B1 — pin pbf@^3 + @mapbox/vector-tile@^1 (CJS, Node 20 OK).
//                v5/v3 are ESM-only and would crash the production
//                Dockerfile (node:20-bullseye-slim) on require().
//           B2 — drop EXPO_PUBLIC_MAPBOX_TOKEN fallback in mvtTileFetch
//                (app-bundle-only var, backend can't read). Add
//                MAPBOX_SERVER_TOKEN to .env.example with deploy notes.
//           C2 — concurrency cap MAX_CONCURRENT_BUILDS=5 to prevent
//                backend OOM on bursty saves (each build holds ~5MB
//                MVT buffers + decoded GeoJSON in flight).
//           C4 — reject empty envelopes (ways<10 or junctions===0) in
//                editContext, fall through to legacy path. Empty
//                envelope is WORSE than legacy (legacy still gives
//                endpoint-only with a proper corridor index).
//   231 — v230 re-review fix N1: `job.resolve(null) && console.error(...)`
//         short-circuited because resolve returns undefined → all
//         build failures were silently swallowed in production. Ops
//         had ZERO visibility into Mapbox token misconfig / fetch
//         errors / decoder crashes. Replaced with explicit
//         console.error THEN resolve(null). Now failures show up in
//         backend logs while still letting the app fall through to
//         legacy MVT path (no user-visible regression).
//   232 — v231 re-review C1+C2 race fixes:
//         C1 — dedup key was just routeId. PUT with new points within
//         the build window joined the OLDER inflight build, which
//         then upserted an envelope based on the OLD points (silently
//         discarding the new ones). Now dedup key = routeId + points
//         fingerprint (length + first/mid/last lng/lat at 5dp).
//         Same content → join; different content → fresh build.
//         C2 — PUT enqueued unconditionally if `points` was in the
//         body. Many clients PUT the full route on name-only edits.
//         Each such PUT wasted Mapbox tile fetches AND raced against
//         in-flight builds. Now PUT loads pre-update points, compares
//         length + sample 3 vertices at 5dp; skips enqueue if equal.
//   233 — Edit UX fixes after first real-device test of v232:
//         User reported: (1) far too many fake "junctions" (157 in
//         Shanghai 0.7km route — Mapbox doesn't have a real junction
//         API, the previous code fingerprinted every densified vertex
//         which inflated counts 50×); (2) trim-restore showed N gps
//         dots stacked when tapping endpoint (1 anchor per original
//         GPS point); (3) drag was unreliable (iOS long-press +
//         scrolling map).
//         Fixes:
//           • backend mvtEnvelopeBuilder: fingerprint only way
//             ENDPOINTS (OSM splits ways at junctions, so junctions
//             ARE endpoints — mid-vertex matches are noise) + 50m
//             proximity dedup. Spike validated: Shanghai 157 → ~3-5.
//           • routeNodeAnchors: trim-restore samples every 100m along
//             the trimmed segment instead of every GPS vertex.
//           • EditableNodeLayer: drag disabled — tap-to-tap only.
//   234 — v233 follow-up after first device test:
//         • app cache prefix v1 → v2 to force-invalidate v232's bad
//           157-junction envelopes (the cache hid the v233 backend
//           filter improvement on existing routes).
//         • dot sizes raised ~1.7× (idle 10→18, candidate 14→22,
//           selected 18→28) with thicker white borders. v232 dots
//           were too small to see/tap on a busy map.
//   235 — Bypass union-find merging in editEnvelopeAdapter. v234
//         still fed envelope.ways through buildTrailGraphFromMapbox
//         which densified + 30m union-find — destroying the
//         server-side junction precision (anchors offset from road
//         centerline by 5-30m). Now adapter directly constructs a
//         TrailGraph node per env.junctions[i] with the exact
//         server coord, edges inferred from shared wayIds. No
//         densify, no merge, no truncation cap. Anchor coords now
//         match the real intersection lng/lat.
//   236 — v0.2.3 Stage 2 H8: replace v228 single-threshold sessionOffset
//         clamp (|offset|>5m → 0) with three-band boundary check:
//         <1m=NOISE→0, 1-50m=REAL_WALK→apply, >50m=TELEPORT→0+warn.
//         New telemetry tag [v22-SESSION-OFFSET] decision/mag.
//         Fixes v228-pending root-cause: small real walks (3-5m) were
//         being zero'd by 5m clamp, breaking Q5 跨session GPS-follow.
//         Stage 4 will later wire TELEPORT → INVALIDATED_BY_DISTANCE.
//   237 — v0.2.3 Stage 3-7 + review hotfix:
//         Stage 3 (A1 GroundYResolver FSM rewrite + 14 PlayMode tests),
//         Stage 4 (A4-merged useArOriginStore), Stage 5 (A8 schema
//         migration + 6 jest fixture tests), Stage 6 (A9 PlantSheet
//         disabled hint), Stage 7 (A7 phone-flat protection — abs(fy)
//         > 0.85 catches both screen-up flat AND looking-down).
//         Hotfix: unityBridge.ts A1State arm — Stage 4 was DOA before
//         hotfix because parser dropped A1State as Unknown → onA1State
//         never called → Plant button perma-grey.
//         Hotfix: A7 threshold direction (review caught fy<-0.85
//         engaged the WRONG case for Q7 平放).
//         Hotfix: cached PortalSpawner ref (60Hz scene scan was an
//         A11 perf cost) + [v22-A7] engage/disengage telemetry.
//   238 — v0.2.3 root-cause sessionOffset reversal (urgent).
//         User-confirmed product semantics (2026-06-11):
//           cairn 插下去那一刻 = 永久世界坐标固定。无论用户走多远，
//           cairn 不动。GPS 抖动只在 1-2m 内，但 cairn 仍不会"跟着"
//           用户。
//         Every prior implementation of sessionOffset was wrong:
//           v210 per-frame virtualOrigin → unbounded drift
//           v220 (live-persisted)*111000 → cairn pushed at user
//           v228 5m clamp → bandaid on v220's wrong model
//           v0.2.3 Stage 2 1-50m three-band → still wrong
//         Fix: ox=0 oz=0 PERMANENTLY. cairn position is computed from
//         absolute (lat,lng,arOrigin) inside buildSpawnRequest; ARKit
//         SLAM holds it stable post-spawn. sessionOffset adds no value;
//         every "real walk" application was double-translating.
//         Also removed: A4 INVALIDATED_BY_DISTANCE (100m threshold) —
//         cairns don't invalidate by user distance, ever. Removed
//         distM helper, INVALIDATE_DISTANCE_M constant, INVALIDATED
//         recovery path in onA1State. A4State enum keeps the value
//         for backwards compat but no code path enters it.
//   258 — v6.5 brush diagnostic + radius relax OTA:
//         (1) Mapbox /matching DEFAULT_RADIUS_M 25 → 50 (API cap).
//             Reason: with r=25, when a brush stroke's middle segment
//             crosses a building (no walking edge within 25m of those
//             points), HMM /matching collapses to a 2-point degenerate
//             match — renders as a literal straight line through the
//             building. With r=50 Mapbox has 2× search radius to find a
//             real detour (parallel road, nearest junction). r=50 is
//             the API hard cap.
//   262 — strokeSimplify uniform-fallback removed in normal path.
//         Diag from v261 retest (route 3, diag 265): 120-pt user brush
//         → uniform_fallback to 100 → Mapbox curve end 308m off C →
//         splice gap 308m through-building. Root cause: uniform sampling
//         smears real turning points; Mapbox HMM follows the smeared
//         input shape. v261's "<60 → uniform" rule was wrong — even a
//         5-point DP simplification preserves the meaningful turns and
//         lets HMM at r=50m reconstruct the road.
//         New rule: take FIRST DP epsilon ≤ 100 from the ladder
//         {5,10,20,40}, regardless of output sparsity. Uniform fallback
//         is now reserved for the edge case where even ε=40 can't get
//         under 100 (very rare — 5km+ stroke at 5m density).
//         Test: 200-pt straight stroke now produces 2-point DP output
//         (was uniform 100 in v259).
//   267 — endStroke magnet: insert B/C as new endpoints (was: replace
//         brush[0]/brush[N-1]). Real-device case 3 evidence:
//         input[0]=input[1]=B (duplicate magnet point), input[2]
//         actually 38.7m away. Replacing brush[0] with B ate the
//         distance between user's true fingertip down-point and B,
//         producing a 38m L-jump from B to brush[1]. Mapbox HMM
//         interpreted the L as a cross-street turn → bounced the
//         matched curve onto a parallel road and back → tiny "过
//         马路 Z" artifact at intersections. Insert preserves
//         brush[0] as a continuous transition: new sequence is
//         [B, brush[0], brush[1], ...]. By construction
//         B→brush[0] ≤ 50m (the magnetism trigger condition is
//         exactly that). Same for end: [..., brush[N-1], C].
//         Direction is natural; no synthetic L-jump for HMM to
//         misread. Tested on case 3 brush input via subagent
//         dataflow review: SHIP verdict — no consumer of
//         stroke.points[0] semantically depends on it being the
//         baseline projection.
//   268 — endStroke magnet: lower-bound 5m + telemetry on begin/end/magnet.
//         v267 unshift was unconditional within ENDPOINT_SNAP_M=50m,
//         producing visible 5–50m connector segments even when brush[0]
//         was effectively on the baseline (d ≤ 5m). Real-device test
//         after v267 OTA showed a ~30m yellow jut across Yanping Rd in
//         the middle of the rendered stroke (PNG 158, no Preview yet —
//         confirmed it's pure stroke.points geometry, not Mapbox).
//         Fix: only unshift when 5m < d ≤ 50m. d ≤ 5m → no-op (B is
//         essentially the same point as brush[0]; inserting it adds
//         visual clutter with no functional value). d > 50m → already
//         rejected by anchorsToBaseline check above. PO requirement
//         "起点终点要有磁吸" preserved for the meaningful range.
//         Also: brush_begin / brush_end / brush_endpoint_magnet now
//         registered as KEY_EVENTS in editDiagSender, so the gesture
//         lifecycle is uploaded immediately on stroke end without
//         requiring Preview/Save/backgrounding. Telemetry includes
//         raw stroke points + magnet projection distances + which
//         endpoints were actually magnetized — enough to diagnose
//         any future "莫名磁吸" report from raw_jsonl alone.
// v269  PO request: brush 中段尖尖 root-cause hunting (DIAGNOSTIC ONLY,
//         no behavior change). v268 brush_end telemetry exposed a hard
//         signature: in 3 of 5 recent strokes, 2-5 consecutive sample
//         points have lng pinned to the EXACT same float32 value
//         121.433944702148438 (= 0x42F3796F, also a Mapbox Z=19 tile
//         X-edge longitude); lat varies freely. Not finger jitter
//         (consecutive frames + double-precision lat), not endpoint
//         magnet (only fires at endStroke, doesn't touch mid-stroke
//         points), not any app-layer snap (grep'd whole repo, no
//         121.4339 literal anywhere; subagent confirmed no mid-stroke
//         pull code). Two competing theories survive: (A) Mapbox SDK
//         native bridge quantizes lng to a tile-grid value on certain
//         frames; (B) async unproject reorders frames in a way that
//         coincidentally sits on a tile edge. Need per-frame data to
//         disambiguate. v269 adds brush_raw_samples telemetry: every
//         handleUpdate entry records (enterSeq, pushSeq, enterTs, pushTs,
//         x, y, lng, lat, droppedByGuard, unprojectFailed) plus
//         startZoom/endZoom; one batch upload per stroke at endStroke
//         (KEY_EVENT, immediate flush). enterSeq vs pushSeq mismatch
//         proves async reordering (theory B). lng quantization with
//         monotonic enterSeq=pushSeq proves SDK-layer issue (theory A).
//         Other observable: did this only start happening after some
//         recent change, or is it baseline behavior? Need 3-5 fresh
//         strokes at varying zoom levels to see if quantization scales
//         with zoom (Z=19 tile size doubles every zoom step).
// v270  Spike B (DIAGNOSTIC ONLY, no behavior change). v269 telemetry
//         100% confirmed: zoom < 15 → 0 lng quantization, zoom > 15 →
//         lng pinned to Z=19 tile X integer boundaries (verified math:
//         121.43394470 = Z19 X=438995, 121.43531799 = Z19 X=438997).
//         enterSeq == pushSeq, droppedByGuard=0 — async path is clean.
//         Root cause traced through code: Cairn → @rnmapbox/maps@10.3.1
//         (post-PR-#4116, bridge uses .doubleValue) → MapboxMaps@~>11.20.1
//         coordinate(for:) → __map.coordinateForPixel (CLOSED SOURCE
//         MapboxCoreMaps C++ binary). Bug confirmed lives in mapbox
//         native projection layer; not visible in any OSS code path.
//         v270 adds Spike B: parallel pure-JS self-mercator unproject
//         from getCenter+getZoom. Math sim shows 0 quantization at
//         zoom=16.5, but real-device validation needed (getCenter/getZoom
//         themselves might be quantized; viewport size assumption might
//         not hold). Per-sample now also records selfLng/selfLat/cLng/
//         cLat/zoom so we can post-hoc compute (a) does selfLng avoid
//         f32 boundaries, (b) does selfLat ≈ native lat (within 1m),
//         (c) consistency of camera state during a stroke.
// v271  FIX (3 bugs at once, real-device validated). v270 telemetry
//         100% confirmed (a) self-mercator at zoom 15.7 agrees with
//         native to <1m, AND (b) native getCoordinateFromView is
//         BROKEN at zoom < 15: same screen pixel returns wildly
//         different lat/lng across zooms (e.g. 5 strokes drawn at
//         the SAME touch point x≈137 y≈484 at zooms 13.6/14.0/14.7
//         all returned native lat ≈31.2331 — physically impossible
//         since visible center moves with zoom). This was the
//         "zoom 缩到很小直接报 300m" bug: native returns nonsense
//         lat/lng at low zoom → brush points are physically off
//         baseline by 100-300m → output gate rejects.
//         v271 fixes:
//         (1) BrushOverlay: self-mercator unproject is now PRIMARY,
//             native is fallback. Self uses onLayout-measured viewport
//             (the v270 Dimensions fallback was wrong for this device).
//             Verified by reverse-engineering measured viewW=430 viewH=
//             932 from a stroke that worked at zoom 15.7 — same viewport
//             then correctly recomputes all other strokes' self values
//             matching telemetry exactly.
//         (2) Output corridor gate (useRouteEditStore.ts:2130): single
//             250m threshold for input AND output (was 250+50). PO
//             direction "我只要求了 250m 画线的时候不能超过 250M
//             返回也不能超过 250M" — single threshold matches user mental
//             model.
//         (3) Bug 1 (zoom > 15 lng pinned to Z=19 tile X edge) is
//             auto-resolved by (1) — self-mercator never touches native
//             projection matrix, so no quantization. v270 telemetry
//             showed self f32-quantized count = 0 across all 9 strokes
//             (vs native's 1-11 per stroke at zoom > 15).
// v272  FIX rotation. v271 self-mercator silently assumed bearing=0
//         and pitch=0, so any rotated map produced strokes that landed
//         60-270m off the finger (real-device telemetry, S3-S7).
//         Fix: subscribe to MapView.onCameraChanged in RouteEditorScreen,
//         push center+zoom+bearing+pitch to a module-scoped state in
//         BrushOverlay; self-mercator now de-rotates the screen offset
//         by -bearing before inverting Mercator. Pitch (tilt) is best-
//         effort: we still use the planar inverse, accuracy degrades
//         past ~10° tilt because Mapbox doesn't expose the full
//         view-projection matrix. Telemetry now also records bearing
//         + pitch per sample so we can post-hoc detect any remaining
//         issues. Single-threshold 250m corridor (v271) preserved.
// v273  Visual + 3 audit fixes (4-eye review of undo/reset/eraser combos).
//         Visual: head/tail magnet connector (B-point unshift) was a
//         single long polyline segment that read as "open beginning
//         disconnected from baseline". Densified to ~3m steps so it
//         visually merges with the brush stroke.
//         Audit findings (all 100% from code, not telemetry):
//         (1) eraseAt didn't clear strokeSnapCache → erase + redraw
//             same shape would hit stale snap cache → preview ignored.
//         (2) undo didn't clear strokeSnapCache → Preview → undo →
//             redraw would similarly hit stale cache.
//         (3) eraseAt didn't null previewMatchedPoints → Preview →
//             erase → Save (no fresh Preview) would persist pre-erase
//             geometry. Now cleared.
//         Telemetry added: brush_eraser, brush_reset (new kinds);
//         brush_undo enriched with stack depth + before/after stroke
//         counts + preview state. Together with v270 brush_raw_samples,
//         a full N-step session can now be reproduced from telemetry
//         alone for any combo of brush/preview/undo/reset/eraser.
// v274  PO direction — major UX overhaul + 2 functional fixes.
//         UI:
//         (1) Replace EditOverlayV236 with EditOverlayV274 — top-right
//             tool FAB, tap to bloom radial wheel (5 items: Draw / Move
//             / Erase / Undo / Reset + close X). Game-feel.
//         (2) Bottom bar single row, no Cancel (back arrow replaces).
//             Smart logic: state A (has unpreviewed strokes) shows ONE
//             button = Preview (disabled on validation error); state B
//             (clean / previewed) shows TWO = Beautify + Save.
//         (3) Flatten flow: arriving from Save-as-Route auto-enters
//             edit mode, no view-then-edit middle screen.
//         Functional:
//         (4) Preview-undo bug: pre-v274 wiped undoStack on commit so
//             "preview 后 undo 不让用". Now pushes pre-preview snapshot
//             so undo restores brushStrokes + matchedPoints.
//         (5) Eraser endpoint telemetry: brush_eraser now records
//             newStrokeEndpointStatus per surviving stroke so we can
//             diagnose "橡皮擦擦过后再画线衔接收尾告诉我不对" with
//             real data before relaxing the gate.
//         Removed: 0/8 stroke counter (v274 says it's no longer
//         meaningful — top status pill shows mode/state instead).
// v275  PO direction — 6 fixes from v274 testing.
//         (1) FAB pixel quality — bumped to 56×56 + 26 icon + 2.5 border;
//             no more crowded/blurry top-right.
//         (2) Status pill removed from top — was occluding the back arrow.
//             Errors now show ABOVE the bottom bar; "Drew N strokes"
//             text removed entirely (PO: "没意义").
//         (3) Wheel layout: Reset at CENTER (red), 4 tools at N/E/S/W
//             (Draw / Erase / Undo / Move). No close × — tap backdrop.
//         (4) Eraser-disabled bug: pre-v275 erase split a stroke whose
//             cut endpoints landed off baseline → validateStrokes
//             flagged them → Preview disabled. Now eraseAt
//             auto-anchors each new sub-stroke endpoint to baseline
//             projection if 5-50m off (mirrors endStroke magnetism).
//         (5) Beautify route now actually calls Mapbox /matching —
//             pre-v275 the no-strokes path just copied points without
//             snapping. Now slices baseline into ≤100-coord segments
//             with 1-coord overlap for stitching, calls matchSegment
//             on each, falls back to raw on partial failure.
//         (6) Head/tail magnet densify step 3m → 1m. PO reported
//             "开头依旧没连上,preview 后才正确" — at 3m the connector
//             still rendered as visible dashes. 1m is continuous.
// v276  PO direction — simplify and re-anchor.
//         (1) Remove Eraser entirely from the UI. PO: "去掉橡皮擦的
//             功能吧 我们用 undo 代替". The store action is preserved
//             for legacy state; the wheel just doesn't expose it.
//             First-render coercion: if activeTool === 'eraser',
//             setActiveTool('brush') so resumed sessions don't stick.
//         (2) Wheel back to top-right (anchored at FAB), 2x2 grid
//             (Draw, Move, Undo, Reset). v275's center-anchored ring
//             was harder to reach single-handed; PO: "画笔也不要在
//             中间了 还是右上角吧 按照游戏方式 2 + 2".
//         (3) Bottom status pill above Preview/Beautify shows
//             "Drawing — start and end on the route" type text.
//             PO: "drawing 那行提示 放在 preview 上方".
//         (4) Undo can now undo a Preview commit (already enabled in
//             v274 — pre-preview snapshot pushed instead of wiping
//             undoStack). PO: "可以 undo preview 这种步骤" —
//             confirmed working from v274.
// v277  PO direction.
//         (1) Tail-fork bug fix: when last brush point landed 1-5m
//             off baseline (e.g. 2.01m), v268's MIN_MAGNET_M=5 rule
//             skipped the snap, so brush[-1] stayed off-line while
//             baseline kept rendering past it → looked like a 2-pronged
//             fork at the end. Lower bound dropped to 0; tiny distances
//             produce 1-2 invisible densify points instead of nothing.
//         (2) Wheel layout: 1-big + 3-small ring (instead of v276's
//             2x2 grid). PO: "一大3小, move 大, 3 小围着她, 包围而不
//             是格子". Big center = Move (pan); orbiters at top/SW/SE
//             = Draw / Undo / Reset. Anchored near top-right FAB.
// v278  PO direction.
//         Wheel layout adjustment: v277 sized BIG=84 with the small
//         orbiters at the cardinal directions (one even at the top —
//         off-screen on small devices). PO: "出了界面了 我希望的是
//         move 变大一点点 然后另外3个都在左下".
//         (1) Move shrunk to 68 (just slightly bigger than the 56
//             FAB) so it doesn't dominate.
//         (2) Draw / Undo / Reset all clustered to the bottom-left of
//             Move in a fanned arc (12-o'clock-left, 7-o'clock,
//             5-o'clock-down) so nothing crosses the screen edge.
// v279  PO direction.
//         (1) Tail-fork — true root cause confirmed visual:
//             when MIN_MAGNET_M=0 (v277) every brush end snapped a
//             baseline-projection point, but the baseline itself is
//             rendered separately as a continuous line in both
//             directions through that projection point. So brush
//             ended at the projection but baseline kept rendering
//             past it → V/fork visual. v279 reverts MIN to 5: small
//             distances (<5m) skip the snap entirely. Brush simply
//             ends ≤5m off the baseline; on small screens this is
//             <5px and visually imperceptible. The 5-50m band still
//             gets the densified connector.
//         (2) Wheel layout (per PO): "Move 离边上太近 / 3个小的太近
//             / 分散点". Move shifted left ~8px from FAB position;
//             three orbiters spread further apart in a wider fan
//             (Draw at -1.25R / Undo at -1.05R+1.35R / Reset at
//             -0.05R+1.6R).
//         (3) Bottom buttons restyled to match HikingScreen's
//             "Save as Route" CTA: sage tinted background +
//             1.5 sage border + sage text/icon. Consistent across
//             the app for primary route-acting CTAs.
// v280  PO direction.
//         (1) Full rollback of the v273-introduced densify of the
//             head/tail magnet connector. PO confirmed v279 still
//             showed a fork at the tail; turning off densify (back
//             to v272 unshift/push of a single baselineProj point)
//             eliminates the densified-polyline-vs-baseline-render
//             interaction that produces the V shape. Net: v272
//             magnet behaviour exactly.
//         (2) Wheel layout — three small orbiters at EQUAL distance
//             from Move (PO: "希望每个小 icon 和 Move 的距离都一样").
//             ORBIT_R = 90; angles 165° / 210° / 255° (ccw from +x)
//             so all three sit on the inner / bottom-left arc.
// v281  Wheel angles tweaked. PO: "draw 离 move 上方的距离应该和
//         reset 离 move 右侧的距离一致, 应该是对角线对称的".
//         Angles changed from 165°/210°/255° (all bottom-left) to
//         135°/225°/315° (UL / LL / LR). Draw and Reset are
//         diagonally symmetric around Move; Undo at exact bottom-left
//         on the same arc. Same R=90 keeps all three equidistant.
// v282  Wheel: equilateral-triangle layout per PO golden-ratio
//         direction. Move at the centroid of an equilateral triangle
//         whose vertices are Draw / Undo / Reset on a single arc of
//         radius R=90:
//           Draw  at 120° (upper-left of Move, slightly above)
//           Undo  at 180° (directly left)
//           Reset at 240° (lower-left, mirrored to Draw)
//         Draw and Reset are upper/lower mirrors across Undo's
//         horizontal — perfectly symmetric. Pairwise spacing equal
//         (60° arc between each). Move is slightly south of the FAB
//         to give Draw enough headroom above (R*0.85 push so 120°
//         vertical extent stays in screen).
//         A dashed sage ring (opacity 0.35) is drawn at radius R+2
//         to make the orbit visible. PO: "他的弧线 要出来".
// v283  PO selected I1 from the iPhone-real-size demos.
//         Wheel layout:
//           Move at FAB anchor (top-right corner, no offset).
//           Reset : 180° (R=90 directly left)
//           Undo  : 225° (R=90 lower-left, on symmetry diagonal)
//           Draw  : 270° (R=90 directly below)
//         True edge-to-edge symmetry: Reset upper-edge to screen-top
//         equals Draw right-edge to screen-right (geometric: both
//         orbiters 50px wide, both at distance R=90 from Move-center,
//         Move itself padded equally from top & right).
// v284  Bug fix: head-magnet visual missing.
//         Real-device confirmed: brush head-magnet's data was correct
//         (endStroke unshift'd baseline-projection point into
//         stroke.points; Preview output was correct), but the visual
//         polyline never showed the head connection. Tail-magnet was
//         fine.
//         Root cause (sub-agent + manual code re-verification):
//         BrushStrokeLayer.buildStrokeIncremental is an APPEND-only
//         incremental builder, keyed by stroke.id, that tracks
//         lastBuiltPointCount and processes only segments
//         [lastBuiltPointCount, N). When endStroke unshifts a
//         baseline-projection point at the head, every existing
//         index shifts +1 — but the cached builder is unaware. Next
//         render frame:
//           startSeg = max(1, lastBuiltPointCount) = old count
//           for i = old..N: a = points[i-1], b = points[i]
//         → the new head segment [points[0], points[1]] is never
//         processed, and existing segments are mis-indexed.
//         Tail push doesn't shift indices so the same builder
//         correctly handles it.
//         Fix: builder now caches firstPointRef = s.points[0]. On
//         each render, if points[0] !== firstPointRef → full rebuild.
//         appendStrokePoint never changes points[0], so the live
//         drawing path stays incremental (no perf regression).
//         No OTA — will ship with next native build. Verify on
//         next-build manual test.
// v285  Trim restored. PO: "trim 功能咋没了... T4 但是大小平分
//         点击 trim 上方展示拉条 点其他地方就隐藏".
//         Bottom action bar (state B = clean / previewed) becomes
//         3 EQUAL-WIDTH buttons: [ Beautify | Trim | Save ]. Tapping
//         Trim toggles a slider panel that lifts above the action
//         row showing the existing TrimSlider component (preserves
//         all v242 gesture handling). A full-screen invisible
//         backdrop catches taps outside the panel and dismisses it.
//         Tapping Beautify or Save also dismisses the panel.
//         When the user enters brush mode (hasUnpreviewedStrokes),
//         the trim panel auto-hides since the bottom bar collapses
//         to a single Preview button anyway.
//         Scissors icon registered in Icon.tsx for this feature.
//         No OTA — ships with next native build.
// v286  v0.2.6 → v0.2.6.3 Memory Mode (4 consecutive OTAs without
//         bumping OTA_VERSION — fixed in this push). Memory Mode
//         introduces fog-of-world map (zoom-17 tile + 25m circle
//         renders), 3-step Plant flow (GPS lock → Mapbox pin adjust
//         → title/text/voice stub), 4-tab navigation
//         (Trails/Friends/Memory/Settings), per-user cloud-bound
//         memory points, 8 Shanghai seed cairns from official user.
//         Backend: new /api/memory/points (GET keyset paginated /
//         POST INSERT-ON-DUPLICATE-KEY-with-confirm-SELECT / DELETE),
//         memory_points table with UNIQUE(user_id, client_id) +
//         covering index, markers.text widened VARCHAR(50→500).
//         Sync: per-op AbortControllers, epoch token, central
//         resetForUserSwitch chokepoint, deterministic-cid for
//         legacy v0.2.6.2 client compat. Convergence after 7 review
//         rounds (K → L → M → N → O → P): 0 Blocker / 0 Critical
//         remaining. 35/35 unit tests pass. 0 new TypeScript errors.
// v287  v0.2.6.4 — post-v286 user feedback bundle:
//         (1) BottomTabNavigator removed; restored v0.2.5 NativeStack.
//             HomeScreen ToolsRow has Trails/Friends/Memory/Settings.
//         (2) Plant card flex 0.5→0.4 (smaller, tertiary action).
//         (3) GPS sampler rewritten — poll getCurrentPositionAsync
//             instead of watchPositionAsync (avoids iOS watcher
//             collision with Hiking that caused "No GPS readings").
//         (4) Universal appLog: services/appLog.ts. Single log(tag,
//             ctx?) — Plant + Memory + foreground unlock all
//             instrumented. Reuses /api/edit-diag (existing schema,
//             rate-limited, TTL'd).
//         (5) Memory: BackButton, first-visit hint modal, recenter
//             FAB, useFocusEffect remount on tab open.
//         (6) Memory initial zoom 15→16.5; initialRevealRadius
//             200m→500m so first impression isn't "all fog".
//         (7) Settings segmented control: Record memory =
//             "Whenever app open" | "Only during Hiking/Running".
// v288  R-round: post-v287 subagent review fixes.
//         (1) appLog: drain queue on 4xx too (was retry storm against
//             permanent failures); only 5xx/network retain for retry.
//         (2) gpsSampler: windowSec 5→10, MIN_READINGS 3→2 — cold GPS
//             used to consume the whole 5s window on a single call.
//         (3) Memory tab now reuses ForegroundUnlockManager's watcher
//             cache (useMemoryStore.lastWatcherFix). Avoids iOS
//             dual-watcher conflict that produced 12s timeouts when
//             Hiking watcher was already running.
//         (4) MemoryScreen mountKey is useState (was useRef →
//             mutating it never re-rendered, remount fired only by
//             accident via retryToken).
//         (5) session-only mode uses tracking.status ('tracking' OR
//             'paused') instead of lastCoordinate != null.
//         (6) Recenter only refetches GPS when watcher cache stale
//             (>30s); otherwise just camera-flies. retryToken bump
//             gated by 5s debounce.
//         (7) First-visit hint shows only after settings hydrate.
//         (8) Focus refetch debounced 5s.
//         (9) Deleted dead BottomTabNavigator.tsx.
// v289  S-round: post-v288 review fixes.
//         (1) S1: coord = fresh watcher → oneShot → stale watcher
//             (oneShot was dead code under watcherFix??oneShot).
//         (2) S2: MemoryMap Camera follows user motion. cameraKey
//             now includes coords (rounded ≈10m).
//         (3) S3: mountKey debounce 30s — Memory tab back-and-forth
//             no longer reloads Mapbox tiles.
//         (4) S4: WATCHER_FIX_FRESH 30s→10min. Stale lat/lng > iOS
//             dual-watcher conflict.
//         (5) S5: gpsSampler per-call timeout (4×interval).
//             windowSec 10→15 for cold-start safety.
//         (6) S6: setLastWatcherFix throttle (>5m or >5s).
//         (7) MemoryScreen useEffect dep [refetchToken] only.
// v290  U-round: real-device feedback after v289 OTA.
//         Server-log diagnosis: gps_decision after 30 polls of identical
//         8m readings = 15s wasted; first-attempt failed because React 18
//         StrictMode double-mount cancelled mid-flight before any sample
//         landed.
//         Fixes:
//         (1) U1: gpsSampler early-exit. As soon as ≥2 readings have
//             best accuracy ≤ rejectThreshold (15m), return immediately.
//             Plant lock now ~1-2s on a phone with cached GPS.
//         (2) U2: GpsLockStep mount guard via inFlightRetryRef so the
//             StrictMode double-mount no longer races the first attempt.
//         (3) U3: PinAdjust default style is now Hiking's outdoors-v12
//             (lighter, more battery-friendly). Top-right toggle 🌐/🗺
//             switches to satellite. First-time satellite tap shows
//             a 1-2 MB data warning Alert.
//         (4) U4: pin onDragEnd accepts both v10+ payload shapes
//             (top-level coordinates AND nested geometry.coordinates).
//             Pin can drag again. Logs unknown shapes for SDK upgrade
//             debugging.
//         (5) U5: full plant flow telemetry — every step transition,
//             commit attempt/ok/failed, pin drag, style toggle,
//             cancel — all uploaded to /api/edit-diag (kind=app_log).
// v291  V+R-round: 10-fix bundle from user feedback on v290 +
//         double-subagent review fixes.
//         V1: PinAdjustStep Didi-style fixed-center pan (replaces drag).
//             R-round B7 follow-up: switched onCameraChanged → onMapIdle
//             (settle event, NOT continuous ~60Hz), removed dead
//             geometry.coordinates fallback per @rnmapbox v10 contract.
//         V2: max-nudge hint banner when user pushes past ring.
//         V3: enablePublicOption flipped on (Public visibility option).
//         V4: ContentStep keyboard now dismissible by tapping outside;
//             button no longer blocked. R-round B6: multiline
//             blurOnSubmit=false + returnKeyType=default so return key
//             inserts newline (previously dismissed keyboard).
//         V5: success modal + cairn type chips. R-round B1: draft.type
//             now plumbed to ContentStep initialType — back/rehydrate
//             preserves user's choice. R-round: setTimeout for modal
//             dismiss cleared on unmount (prev: stale nav.goBack on
//             background suspend).
//         V6: Memory initial reveal hex-tiled. R-round B3: switched
//             from concentric rings (36m off-axis gaps caused fog
//             discontinuity) to TRUE axial hex grid at 40m spacing —
//             continuous coverage guaranteed. R-round B4: large-radius
//             reveal points marked synced=true (client-derived, no
//             push storm). R-round B2 migration: legacy v290 users
//             with initialRevealDone + <50 points auto re-reveal on
//             first launch after OTA (original 'two circles' reporters
//             now get the fix).
//         V7: cairn-tap modal backdrop opacity reduced (0.55→0.30 /
//             0.45→0.25).
//         V8: MemoryMap recenter telemetry. R-round B8: cameraKey
//             reduced to recenterToken-only (was toFixed(4) ≈ 11m,
//             causing Camera remount every GPS tick while walking).
//         V9: Memory back button now safe-area-inset aware,
//             matches Hiking pill variant.
//         V10: NEW — Settings → Feedback "Send screenshot to dev team"
//             action row. New services/debugUpload.ts (AR migration
//             deferred to v0.2.7). R-round B9: isMountedRef guards
//             all upload setState calls. R-round B10: success/err
//             states stay clickable so retry is immediate and label
//             color isn't dimmed by disabled treatment.
// v292  N-round: 4 fixes after v291 real-device feedback + double
//         subagent review.
//         N1: fogBuilder.ts inner-ring winding fixed (theta -2π→+2π).
//             v291's hex-tile reveal exposed an old latent bug — inner
//             rings shared winding with the outer world ring, so each
//             of the 567 visited points rendered as an ADDITIONAL FILLED
//             25m disc (the "fog donut" the user saw on screen) rather
//             than as a hole. With CCW inner rings now opposite the
//             CW world outer ring, Mapbox correctly cuts them as holes.
//         N2: GpsLockStep fast-path. Plant GPS was 15s every time even
//             when an active Memory watcher had a fresh fix. Now:
//               (a) lastWatcherFix < 8s old → use it (~10ms)
//               (b) else Location.getLastKnownPositionAsync(maxAge=8s,
//                   requiredAccuracy=20m) → use it (~50ms)
//               (c) else fall through to the 15s sampleGpsWindow
//             Fast path also guards iOS CLLocation horizontalAccuracy<0
//             (invalid fix) which expo-location's requiredAccuracy
//             numeric filter wouldn't catch on its own.
//         N3: PinAdjustStep zoom 18→17.5, mapWrap height 280→340.
//             50m max-nudge ring now fits inside the map preview;
//             user could see "out of bounds" boundary they were
//             told to stay within.
//         N4: PinAdjustStep zoom-vs-pan disambiguation. Previously
//             onMapIdle treated pinch with off-center focus as a pan
//             → pin moved when user only meant to zoom. New rule: any
//             zoom delta > 0.05 → ignore center change, keep pin
//             where it was. Hard-disable "Looks right" button if pin
//             ever exceeds maxNudge (defensive — clamp normally
//             prevents this, but the gate is cheap insurance).
export const OTA_VERSION = 327;
//         v284: head-magnet visual fix (incremental builder).
//         BRUSH (root cause: walkedIndex/baseLine drift after Preview):
//           * walkedIndex now permanently anchored to state.originalPoints
//             — was being rebuilt from matchedPoints at Preview commit and
//             at undo, accumulating Mapbox-OSM-snap drift each cycle. PO
//             snap "尖角不是我画的是磁吸过去的" was traced to subsequent
//             strokes magnetizing onto a drifted (no-longer-on-real-road)
//             baseline. Reset already used originalPoints; Preview commit
//             and undo did not.
//           * endStroke magnetism re-enabled (was removed in an earlier
//             draft; PO clarified magnet is essential for "last stroke
//             connecting back to baseline" — without it BCEF projB/projC
//             sit far off baseline when raw fingertip stops short).
//             Magnet target = state.originalPoints, NOT matchedPoints.
//           * runPreview baseLine = state.originalPoints (was matchedPoints
//             || originalPoints — same drift class).
//           * BCEF primitives moved to src/store/brush/bcef.ts so the
//             Python self-test (scripts/brush_self_test.py) and future
//             jest tests can exercise the exact production functions.
//         ACTIVITY:
//           * MapHistoryScreen first-frame "Activity too short to record
//             path" flash fixed — trackPoints state changed from `[]` to
//             `null` to distinguish loading vs empty. While null, map
//             area renders nothing instead of showing the misleading
//             too-short message.
//         REGRESSION RECOVERY (audit subagent):
//           * RoutesScreen.tsx: tap activity / route → directly to detail;
//             long-press preserves the action sheet. Memory said this was
//             fixed before but git log showed no commit — change had been
//             stashed during another task and dropped.
//           * RouteEditorScreen.tsx: Save → CommonActions.reset back to
//             Home (replaces StackActions.replace which silently no-op'd
//             on typed nav). Recovered from stash@{0}.
//           * Backend route_points field on PATCH /api/sessions kept (no
//             frontend caller in v261; reserved for future opt-in snap).

type OtaState =
  | 'idle'          // checked, no update — "Up to date"
  | 'checking'      // initial check in progress
  | 'downloading'   // update found, fetching bundle
  | 'ready'         // bundle downloaded, waiting for user to restart
  | 'applying'      // user tapped restart
  | 'error';        // network / OTA failure (inline mode only — floating mode hides)

const COLORS = {
  bg: 'rgba(255,255,255,0.96)',
  border: 'rgba(0,0,0,0.06)',
  text: '#111827',
  textMuted: '#6B7280',
  dotBlue: '#3B82F6',
  dotAmber: '#F59E0B',
  dotGreen: '#10B981',
  dotGrey: '#9CA3AF',
  ctaBg: '#5d7c46',
  ctaText: '#FFFFFF',
};

interface Props {
  /**
   * inline=true: render inline (no absolute positioning), always visible.
   * inline=false (default): float at top-right, only show when there's
   *   something to show (downloading / ready / applying).
   */
  inline?: boolean;
  /**
   * idleHidden=true: don't render anything when state is 'idle' (no update
   * available). Useful when the badge is positioned in a layout where its
   * presence vs absence shifts other content (e.g. the splash screen) — set
   * this so the user only ever sees the pill when there is actually an
   * update being downloaded or ready to install.
   */
  idleHidden?: boolean;
}

export function OtaBadge({ inline = false, idleHidden = false }: Props) {
  const [state, setState] = useState<OtaState>('checking');
  const [modalOpen, setModalOpen] = useState(false);
  const fade = useRef(new Animated.Value(inline ? 1 : 0)).current;
  const pulse = useRef(new Animated.Value(1)).current;
  const pulseLoopRef = useRef<Animated.CompositeAnimation | null>(null);
  const insets = useSafeAreaInsets();
  // Dynamic Island on iPhone 14 Pro / 15 Pro / Pro Max sits inside the
  // safe-area top inset region. Push the badge ~10px below the inset to
  // clear both the island and the system status bar reliably across all
  // notch / island devices.
  const topOffset = insets.top + 10;

  // Floating mode: fade in only when state has something to show
  useEffect(() => {
    if (inline) return; // inline mode is always visible
    const visible = state === 'downloading' || state === 'ready' || state === 'applying';
    Animated.timing(fade, {
      toValue: visible ? 1 : 0,
      duration: visible ? 280 : 220,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [state, inline]);

  // Pulse when ready — draws the eye to the actionable state
  useEffect(() => {
    if (state === 'ready') {
      const loop = Animated.loop(
        Animated.sequence([
          Animated.timing(pulse, { toValue: 1.06, duration: 700, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
          Animated.timing(pulse, { toValue: 1.0, duration: 700, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        ]),
      );
      pulseLoopRef.current = loop;
      loop.start();
    } else {
      pulseLoopRef.current?.stop();
      pulse.setValue(1);
    }
    return () => { pulseLoopRef.current?.stop(); };
  }, [state]);

  // OTA check + auto-download flow
  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Hard cap on the check phase — on flaky networks
      // checkForUpdateAsync can hang for tens of seconds. v82.1: bumped
      // 15s → 30s + auto-retry once before surfacing error. User feedback:
      // 15s was too tight for EAS production endpoint cold-starts; users
      // were forced to tap "retry" themselves when patience would have
      // worked. Now: try, if fail try once more, only THEN show error.
      //
      // v89 + 1 升级: 错误分类 — 只对 timeout 重试，对其他错误 (DNS/TLS/
      // 401/auth) 不重试 (重试也是失败). 用户反馈 v85+ 仍偶遇 retry,
      // 真因可能是 _不可恢复错误_ 重试 N 次白等 60s 才出 error.
      const TIMEOUT_ERROR = 'ota-timeout';
      const withTimeout = <T,>(p: Promise<T>, ms: number): Promise<T> =>
        new Promise((resolve, reject) => {
          const t = setTimeout(() => reject(new Error(TIMEOUT_ERROR)), ms);
          p.then(v => { clearTimeout(t); resolve(v); }, e => { clearTimeout(t); reject(e); });
        });
      // 判断错误是否值得重试. 只重试 timeout (临时性). 其他错误重试也无用.
      const isRetryableError = (err: any): boolean => {
        const msg = String(err?.message || err || '').toLowerCase();
        return msg.includes(TIMEOUT_ERROR);
      };
      try {
        const Updates = await import('expo-updates');
        if (!Updates.isEnabled) {
          if (!cancelled) setState('idle');
          return;
        }
        // v89+1: check phase 错误分类重试. 只对 timeout 重试 1 次.
        const checkOnce = () => withTimeout(Updates.checkForUpdateAsync(), 30000);
        let result;
        try {
          result = await checkOnce();
        } catch (err) {
          if (cancelled) return;
          if (!isRetryableError(err)) {
            // 不可恢复错误 (DNS/TLS/401), 立即报错不重试.
            throw err;
          }
          // Timeout — silent retry. 用户全程看到 "Checking" 不闪 error.
          result = await checkOnce();
        }
        if (cancelled) return;
        if (!result.isAvailable) {
          setState('idle');
          return;
        }
        setState('downloading');
        // v89+1: download phase 同样错误分类.
        const fetchOnce = () => withTimeout(Updates.fetchUpdateAsync(), 60000);
        try {
          await fetchOnce();
        } catch (err) {
          if (cancelled) return;
          if (!isRetryableError(err)) {
            throw err;
          }
          await fetchOnce();
        }
        if (cancelled) return;
        // Auto-apply: instead of asking the user to tap "Restart", reload
        // immediately. Users complained that the manual "Done · tap to
        // restart" prompt + 3-cold-start cycle to actually receive the
        // bundle was confusing. Now: open app → "Downloading" pill →
        // app reboots → next frame they're on the new bundle.
        setState('applying');
        // Tiny delay so the user briefly sees the "Restarting" pill —
        // otherwise the reload feels like a random crash.
        setTimeout(() => { Updates.reloadAsync().catch(() => {}); }, 600);
      } catch {
        // 重试用尽 (timeout 都失败) 或不可恢复错误 → 显示 error.
        if (!cancelled) setState('error');
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const handlePress = () => {
    if (state === 'ready') setModalOpen(true);
    if (state === 'error') {
      // Re-trigger the OTA check on tap — same code path as the mount
      // useEffect, but we just bump state to checking so the spinner
      // shows immediately and let the existing effect re-run via a
      // state-key change. Cheap retry: full reload of the JS surface.
      setState('checking');
      // Use Updates.reloadAsync as a hard retry, since refreshing the
      // useEffect dep is non-trivial — and reloadAsync is cheap when
      // there's no pending bundle (it just re-runs the JS).
      import('expo-updates').then(U => U.reloadAsync().catch(() => setState('error')));
    }
  };

  const handleApply = async () => {
    setModalOpen(false);
    setState('applying');
    try {
      const Updates = await import('expo-updates');
      setTimeout(() => Updates.reloadAsync(), 400);
    } catch {
      setState('error');
    }
  };

  const handleLater = () => {
    setModalOpen(false);
    // stays in 'ready' — user can tap again later
  };

  // Floating mode: hide entirely when nothing actionable
  if (!inline && (state === 'idle' || state === 'checking' || state === 'error')) {
    return null;
  }
  // Inline + idleHidden: hide when there's no update — prevents the pill
  // from popping in/out of layout flow on screens where its presence
  // would shift surrounding content.
  if (inline && idleHidden && (state === 'idle' || state === 'error' || state === 'checking')) {
    return null;
  }

  // Visual config per state
  let dotColor = COLORS.dotGreen;
  let label = '';
  let showSpinner = false;
  let interactive = false;

  switch (state) {
    case 'checking':
      // Honest checking state — never pretend we already verified.
      dotColor = COLORS.dotGrey;
      label = 'Checking for update';
      showSpinner = true;
      break;
    case 'idle':
      // Only reached when the OTA endpoint *successfully* told us there
      // is no newer bundle. This is the only state where "Up to date"
      // is truthful — never use it as a fallback for failures.
      dotColor = COLORS.dotGreen;
      label = 'Up to date';
      break;
    case 'downloading':
      dotColor = COLORS.dotBlue;
      label = 'Downloading update';
      showSpinner = true;
      break;
    case 'ready':
      // Should be brief — auto-reload kicks in 600ms after download.
      // Kept tappable as a manual fallback in case reload fails.
      dotColor = COLORS.dotAmber;
      label = 'Update downloaded';
      interactive = true;
      break;
    case 'applying':
      dotColor = COLORS.dotBlue;
      label = 'Restarting…';
      showSpinner = true;
      break;
    case 'error':
      // Honest failure state — do NOT mask as "Up to date".
      dotColor = COLORS.dotGrey;
      label = "Couldn't check · tap to retry";
      interactive = true;
      break;
  }

  const wrapStyle = inline
    ? [styles.wrapInline, { opacity: fade, transform: [{ scale: pulse }] }]
    : [styles.wrapFloating, { top: topOffset, opacity: fade, transform: [{ scale: pulse }] }];

  return (
    <>
      <Animated.View style={wrapStyle} pointerEvents="box-none">
        <TouchableOpacity
          style={styles.badge}
          onPress={handlePress}
          activeOpacity={interactive ? 0.65 : 1}
          disabled={!interactive}
        >
          {showSpinner ? (
            <ActivityIndicator size="small" color={dotColor} style={styles.spinner} />
          ) : (
            <View style={[styles.dot, { backgroundColor: dotColor }]} />
          )}
          <Text style={styles.label}>{`v${OTA_VERSION} · ${label}`}</Text>
        </TouchableOpacity>
      </Animated.View>

      <Modal
        visible={modalOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setModalOpen(false)}
      >
        <Pressable style={styles.modalBackdrop} onPress={() => setModalOpen(false)}>
          <Pressable style={styles.modalCard} onPress={(e) => e.stopPropagation()}>
            <View style={styles.modalIconRow}>
              <View style={[styles.modalIconDot, { backgroundColor: COLORS.dotAmber }]} />
              <View style={[styles.modalIconDot, { backgroundColor: COLORS.dotAmber, opacity: 0.5 }]} />
              <View style={[styles.modalIconDot, { backgroundColor: COLORS.dotAmber, opacity: 0.25 }]} />
            </View>
            <Text style={styles.modalTitle}>Update downloaded</Text>
            <Text style={styles.modalBody}>
              The new version is ready. Restart now to apply — it only takes a second.
            </Text>
            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.btnSecondary} onPress={handleLater} activeOpacity={0.7}>
                <Text style={styles.btnSecondaryText}>Later</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.btnPrimary} onPress={handleApply} activeOpacity={0.85}>
                <Text style={styles.btnPrimaryText}>Restart now</Text>
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  wrapFloating: {
    position: 'absolute',
    right: 12,
    zIndex: 1000,
  },
  wrapInline: {
    alignSelf: 'flex-start',
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.bg,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderWidth: 1,
    borderColor: COLORS.border,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.10,
    shadowRadius: 6,
    elevation: 3,
  },
  dot: { width: 8, height: 8, borderRadius: 4, marginRight: 7 },
  spinner: { marginRight: 6, transform: [{ scale: 0.7 }] },
  label: { fontSize: 11.5, fontWeight: '600', color: COLORS.text, letterSpacing: 0.1 },

  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  modalCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    paddingHorizontal: 22,
    paddingTop: 22,
    paddingBottom: 14,
    width: '100%',
    maxWidth: 340,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.18,
    shadowRadius: 24,
    elevation: 10,
  },
  modalIconRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 14,
  },
  modalIconDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  modalTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: COLORS.text,
    marginBottom: 8,
  },
  modalBody: {
    fontSize: 14,
    lineHeight: 20,
    color: COLORS.textMuted,
    marginBottom: 18,
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
  },
  btnSecondary: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 10,
  },
  btnSecondaryText: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.textMuted,
  },
  btnPrimary: {
    backgroundColor: COLORS.ctaBg,
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 10,
  },
  btnPrimaryText: {
    fontSize: 14,
    fontWeight: '700',
    color: COLORS.ctaText,
  },
});
