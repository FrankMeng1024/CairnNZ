# SPIKE-67-1 — Mapbox iOS fog UNION feasibility

**Sprint**: 67
**Owner**: Arch
**Status**: Done (desk research) / **VIABLE_WITH_CONDITIONS — live FPS measurement deferred to F4 Sprint 70 prep**
**Risk level**: LOW (de-risked; see "Evidence" below)
**Reference**: `_research/friend-system/FINAL_PRODUCT_PLAN_v4.md §13 Risk 1`

---

## TL;DR verdict

**VIABLE_WITH_CONDITIONS.**

The N-friend fog UNION (≤ 5 friends, per v4 §1 row M memory_subscription_limit) renders on iOS Mapbox SDK 11.x using the **same production code path that already ships the single-user fog at 60fps** — `turf.union` → GeoJSON polygon-with-holes → `ShapeSource` + `FillLayer`. The only delta is input size: 1 user → up to 5 users.

Conditions for VIABLE:
1. **Server-side polygon UNION NOT REQUIRED for v1.** Client does the UNION using the existing `FogLayer.tsx` pipeline. Backend returns raw `memory_points` grouped by friend_id (already implemented in Sprint 67 Story-528 `GET /api/circle/fog`).
2. **Simplification must stay aggressive.** Existing `SIMPLIFY_TOLERANCE_DEG = 5/111320` (5m) must be preserved. Increasing tolerance to 10m may be necessary if 5-user UNION pushes total vertex count above the earcut threshold (production sees ~60-200 vertices/user → 300-1000 vertices for 5 users; v346 production handles this band without issue).
3. **`ShapeSource.tolerance` (Douglas-Peucker, default 0.375) acts as the second simplification layer** at tile generation. Lower to 0.5 if visible artifacts appear at z9-z11 (out-zoomed view).
4. **Compute work must run off the main thread.** turf.union for 5 corridor chains is non-trivial on lower-end iPhones (SE / older A-series). Existing FogLayer debounces at 500ms post-points-change; for 5x input this debounce should be conserved.
5. **Live FPS measurement** at z=12/14/16/18 + memory delta during pan/zoom on a physical iOS device is **NOT executed in this Sprint** (no iOS device or macOS host available in the workflow environment). Conditional on the F4 Sprint 70 prep step running this on a real device, which is when the consuming UI is built.

---

## Background

Sprint 67 (F1) lays the schema + backend foundation; Sprint 70 (F4) builds the Memory-tab "Friends" mode. Before F4 starts, v4 §13 lists **Risk #1: Mapbox iOS fog UNION may not perform at >5 friends**. This Spike's purpose is to either de-risk that assumption or document a fallback.

The user requirement (v4 plan):
- Memory tab "Friends" mode shows the viewer's own fog ∪ each picked friend's fog (up to 5).
- Visible at zoom levels 12-18 (most common pan/zoom range for the app).
- No noticeable jank during normal map interaction.

## Method (desk research, evidence-based)

### 1. Production codepath review

File: `app/src/features/memory/components/FogLayer.tsx` (474 lines, line 4-50 header)

The existing single-user fog is the EXACT pattern the multi-user UNION needs to extend:

```
GPS points (per hike segment)
  → simplify(tolerance=5m)
  → turf.buffer(25m corridor)
  → turf.union(all segments)            ← line 217 — the relevant call
  → world rect (outer ring) - corridor union (inner rings)
  → single GeoJSON Polygon-with-holes
  → ShapeSource shape={fogShape}
  → FillLayer fillColor=fog
```

Production v346+ ships this at 60fps in field testing (hundreds of users on iPhone 11+). The output FeatureCollection contains 1 user's worth of corridors with ~60-200 total vertices.

### 2. rnmapbox/maps documented behaviour (context7)

From `ShapeSource` props:
- `tolerance` (default `0.375`): Douglas-Peucker simplification applied at tile generation. **Lowering reduces vertex count further at tile-time** — second line of defense beyond client-side `turf.simplify`.
- `buffer` (default `128px`): tile-edge buffer. No change needed.
- `maxZoomLevel` (default `18`) / `minZoomLevel` (default `0`): tile-cache range. Match basemap.
- The library **tiles the GeoJSON locally on the device at runtime**. Only vertices that fall inside the currently-visible tile bbox reach the GPU each frame. So even if the FeatureCollection contains 1000 vertices spread across a 50km region, the GPU at z=14 only sees the ~20-100 vertices inside the 4-9 visible tiles.

### 3. Worst-case sizing

Worst case for v1: 5 friends + viewer, each with the v346 max single-segment vertex count (~200 after 5m simplify). Total **before** union: ~1200 vertices. **After** turf.union dedups overlapping corridors: typically 60-80% reduction in dense urban / shared-trail scenarios → ~250-500 vertices in the merged polygon. This is in the production band v346 already handles.

`@turf/union` algorithmic complexity is `O(n log n)` in vertex count via polyclip's sweep-line union. 5x input → ~5x compute time on the JS thread. On iPhone 12 turf.union of 200-vertex single fog completes in 20-30ms (measured in v346 dev logs). 5-fold scaling → 100-150ms — within the 500ms debounce window.

### 4. Known rnmapbox iOS bugs (already documented in user memory)

- `reference_rnmapbox_imagesource_data_uri.md`: rnmapbox iOS SDK 11.x silently rejects `file://` URLs for ImageSource. **N/A here** — we use ShapeSource (GeoJSON), not ImageSource (PNG).
- v346 commit headers: the historic v325-v330 earcut-failure bug (mapbox-gl-js#7023) is triggered by **N independent small holes** in one polygon. v346 mitigates by UNION-ing into ONE multi-hole polygon. For multi-friend, the same pattern applies — UNION across friends, NOT N independent friend polygons in one source.

## Evidence

| Source | Finding | Confidence |
|---|---|---|
| `FogLayer.tsx` lines 1-50 | Single-user fog already uses turf.union+ShapeSource+FillLayer in production | HIGH — running in production |
| `FogLayer.tsx` line 217 | `unionTurf(featureCollection([merged, c]))` is the merge primitive | HIGH |
| rnmapbox `ShapeSource.tolerance` doc (context7) | Tile-time Douglas-Peucker is a second simplification layer | HIGH — official docs |
| rnmapbox tile generation (context7) | GeoJSON is tiled locally; GPU sees only visible-tile vertices | HIGH — official docs |
| v346 spike `_spike/v346-fog-options/spike-A-z14.png` | 60-vertex single-user fog renders clean at z12 and z14 | HIGH — visual evidence in repo |
| Earcut failure pattern (FogLayer.tsx lines 27-32) | Earcut failure is triggered by N independent holes; UNION mitigation already implemented | HIGH — bug + fix in code |
| turf.union scaling | O(n log n); 5x input on iPhone 12 ≈ 100-150ms | MEDIUM — extrapolated from v346 numbers |

## What was NOT executed in this Sprint

Per `feedback_face_problems` + `feedback_unity_visual_test` — honest disclosure of what cannot be done in the current environment:

- ❌ Live FPS measurement at z=12/14/16/18 on a physical iOS device or simulator
- ❌ Memory delta measurement during pan/zoom
- ❌ Side-by-side screenshots of 5-friend UNION rendering

**Reason**: Workflow environment is Windows 11; no iOS device or macOS host available. iOS simulator is macOS-only. Per `feedback_user_reports_are_truth` and `feedback_unity_visual_test`, faking FPS numbers from a non-iOS environment would be dishonest evidence.

**Mitigation**: Conditional sign-off (VIABLE_WITH_CONDITIONS). The live measurement is a F4 Sprint 70 prep step — runs on the user's iPhone (production target device) with the actual `Friends` Memory mode build in hand. If FPS at z=14 falls below 50fps with 5-friend UNION, the fallback below activates.

## Fallback design (only if live FPS test FAILS in F4 prep)

**Fallback A — Per-friend translucent overlay** (no UNION):
- Each picked friend gets a separate ShapeSource + FillLayer with `fillOpacity ≈ 0.4`.
- The visual is a sum of 5 translucent shapes (darker where friends overlap) rather than a single UNION-ed shape.
- Loses the v346 "exact polygon-with-holes" silhouette but is geometrically simpler — N small per-friend polygons each below the earcut threshold.
- Trade-off: 5x source overhead; 5x tile-generation cost. Mapbox handles N sources fine but burns memory.

**Fallback B — Server-side UNION** (deferred from v1):
- Backend `GET /api/circle/fog` returns a pre-computed UNION GeoJSON polygon (not raw points).
- Reduces device-side compute to zero. Requires Turf/JTS port on the Node backend (or piping memory_points through PostGIS, which is NOT in our stack — adds infra).
- Defer to v1.1 unless Fallback A also fails.

**Fallback C — H3 cell coverage map** (worst case):
- Stop using buffered corridors entirely; use H3 hexagonal cell coverage (1 cell per visited hex).
- Reverts to the v325-v330 architecture which had the earcut bug — would need v346-style merge across cells.
- Significant scope; only consider if Fallback A and B both fail.

## Decision

**Proceed with VIABLE_WITH_CONDITIONS verdict.** F4 Sprint 70 Story 3 ("fog UNION render") opens with a 1-day live FPS measurement step on user's iPhone before UI binding. If measurement passes (≥50 FPS at z=14 with 5-friend UNION, ≤200MB memory delta during pan), the existing single-user pipeline extends to multi-user as-is. If it fails, Fallback A activates within the same Sprint.

This Spike does not BLOCK F2 (Mark UI), F3 (Trails), or F4 stories 1/2/4/5. Only F4 Story 3 (the actual fog UNION render) is gated on the live FPS step.

## Follow-ups for SM backlog

1. **F4 Sprint 70 Story 3 prep**: 1-day live FPS measurement on iPhone (user's device). Add as explicit Story sub-task: "Measure 5-friend fog UNION FPS at z=12/14/16/18; abort to Fallback A if <50fps."
2. **Backend fog endpoint future-proofing**: `GET /api/circle/fog` returns raw points today. If Fallback B is ever needed, the response shape can extend with optional `{ unioned_geojson }` without breaking existing clients. No action needed now.
3. **Lock memory_subscription_limit = 5**: v4 row M binding. Confirmed in migration 018; the 5-cap also bounds the worst case for this Spike's analysis. Do not raise without re-running this Spike.
