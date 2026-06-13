# Sprint Spec — Mapbox Vector Tile Junction Extraction (Edit Mode)

**Status**: commit-ready, awaiting implementation subagent
**Owner**: Routing core
**Sprint**: next (immediately after Spike B PASS)
**Decision context**: User locked Mapbox vector tile path as the *single* production data source for `editContext.ts`. DOC ArcGIS pipeline stays in tree but is no longer wired in. NZ-specific DOC merging is deferred to a later Sprint.
**Constraints**:
- All-JS / OTA-shippable. No new native deps.
- Edit + save-as-route are online use cases; offline edit not in scope.
- iOS expo-location in CN returns WGS-84-corrected fixes; we are NOT shipping GCJ-02 conversion this Sprint (Spike Q2 PASS on test devices). Re-open if real-device offset > 5 m.
- `@rnmapbox/maps@10.3.1` already in tree; `kdbush@4.1.0` already in tree.

---

## 0. Plan Holes — Read First

Before reading the rest, three holes the user's brief has, that this spec resolves:

1. **`querySourceFeatures` is *visible-tile only*.** Calling it for a route's bbox doesn't magically fetch tiles outside the viewport. If the camera is far from the route or zoomed out, `querySourceFeatures` returns 0–partial features. The user's brief says "force zoom ≥ 14 — only on edit entry": **this is necessary but not sufficient**. We additionally need to *fit camera to route bbox* and *await `onDidFinishRenderingMapFully`* before extraction. Spec §4 covers this.
2. **`graphNodeId` field is load-bearing in the candidate path.** `routeNodeAnchors.ts` writes `graphNodeId` and `candidateNodes.ts` runs Dijkstra against `editStore.trailGraph.nodes` keyed by that id. If we replace TrailGraph with a flat junction list, the entire 1km Dijkstra reachability check breaks. The user said "use fingerprint string" — that's correct, but we also have to **keep building a TrailGraph from the Mapbox features** so Dijkstra still works. Anything else is a regression. Spec §3 + §1 cover this.
3. **`editContext.ts` is called from `enterDualEdit` — `mapRef` is in `RouteEditorScreen` but the editStore wraps it.** mapRef has to traverse: `RouteEditorScreen.cameraRef`/`mapRef` → `buildEditContext(routeId, mapRef)` → `extractJunctionsViaMapbox(mapRef, bbox)`. The store itself **does not** receive mapRef (would couple zustand to react refs). Spec §4 covers the wiring.

---

## 1. New Files

### 1.1 `app/src/services/routing/mapbox/MapboxJunctionExtractor.ts` (~220 LOC)

Pure extraction module. No React, no zustand. Takes a `mapRef` + bbox, returns `{ junctions, ways }`.

```ts
import type { RefObject } from 'react';
import type { LngLat } from '../corridor/PolylineSampler';
import type { BBox } from '../doctrails/DOCTrailsTypes';

/** A junction extracted from Mapbox vector tiles. */
export interface MapboxJunction {
  /** Stable fingerprint id: "mj_${lng5}_${lat5}" — 5-decimal rounding ≈ 1.1m. */
  id: string;
  lng: number;
  lat: number;
  /** Vertex count (≥3 = topological junction). */
  degree: number;
  /** Way feature ids that touch this point. Used for graph edges. */
  wayFeatureIds: string[];
}

/** A road feature simplified to LngLat[] coords + class + id. */
export interface MapboxWay {
  /** Stable fingerprint id: "mw_${properties.id ?? hash(coords)}". */
  id: string;
  /** highway class — 'path' | 'footway' | 'track' | 'pedestrian' | 'street' | etc. */
  klass: string;
  /** Densified vertices in WGS-84. */
  coords: LngLat[];
}

export interface ExtractResult {
  ok: true;
  junctions: MapboxJunction[];
  ways: MapboxWay[];
  diagnostics: {
    rawFeatureCount: number;
    rawVertexCount: number;
    extractMs: number;
    bboxArea: number;
  };
}

export interface ExtractError {
  ok: false;
  error: 'no-map-ref' | 'map-not-ready' | 'zoom-too-low' | 'no-features' | 'query-failed';
  detail?: string;
}

export interface ExtractOptions {
  /** Min topological degree to consider a vertex a junction. Default 3. */
  minDegree?: number;
  /** Coordinate fingerprint precision in decimal places. Default 5 (~1.1m). */
  fingerprintPrecision?: number;
  /** Densify interval (m) for the returned ways. Default 10 — matches DOC. */
  densifyIntervalM?: number;
  /** Map zoom floor. Default 14. */
  minZoom?: number;
  /** Source-layer to query. Default 'road'. */
  sourceLayer?: string;
  /** Source name in the Mapbox style. Default 'composite'. */
  sourceName?: string;
}

export async function extractJunctions(
  mapRef: RefObject<any>,
  routeBbox: BBox,
  options?: ExtractOptions,
): Promise<ExtractResult | ExtractError>;
```

**Algorithm** (pseudocode — implementer fills in):

```
1. Validate mapRef.current && map is loaded. Else 'map-not-ready'.
2. Read current zoom via mapRef.current.getZoom() (or last known via setter helper).
   If zoom < minZoom, return 'zoom-too-low' (caller is responsible for fitting).
3. t0 = Date.now()
4. const fc = await mapRef.current.querySourceFeatures(
     sourceName ?? 'composite',
     [],                           // empty filter — we do our own class filter below
     [sourceLayer ?? 'road'],
   )
5. Filter features:
   - keep only geometry.type LineString | MultiLineString
   - keep only properties.class in [path, track, footway, pedestrian, cycleway, street, service]
     (configurable later — for hiking we want path/track/footway primarily, but the
      user asked for global so we include street to handle parks where OSM tags vary)
6. Flatten each feature to parts (use existing flattenGeometryToParts from PolylineSampler).
   Densify each part to densifyIntervalM (10m) — same algorithm DOC uses, so existing
   downstream code (TrailGraph) sees the same density.
7. Build vertex fingerprint counter:
     fingerprint(lng, lat) = `${round(lng, 5)}_${round(lat, 5)}`
     Map<fingerprint, { lng, lat, count, ways: Set<wayId> }>
   Iterate every vertex of every densified way; bump count + add wayId.
8. Junctions = [...map.values()].filter(v => v.count >= minDegree)
              .map(v => ({ id: 'mj_' + fingerprint, lng, lat, degree: v.count, wayFeatureIds: [...v.ways] }))
9. Ways = densified wayList.map(w => ({ id, klass, coords }))
10. Return { ok: true, junctions, ways, diagnostics }.
```

**Performance guard**:
- After step 5, if `rawVertexCount > 12000`, log a warning to editAnalytics + still proceed. The Spike B Q3 path validated `InteractionManager.runAfterInteractions` + 500-vertex chunked yield as a UI-responsiveness fix; this module exposes that chunked variant too:
  - Wrap the loop in `await new Promise(r => InteractionManager.runAfterInteractions(() => r(undefined)))` once before step 7.
  - Yield (`await new Promise(r => setTimeout(r, 0))`) every 1000 vertices during the fingerprint counter loop.

**Why fingerprint not OSM node id**: vector tiles emit ways without sharing a global node id — the same coordinate appearing in multiple ways indicates a junction, but tile boundaries split ways, so a single way passing through the same junction in two adjacent tiles will register as two separate features and we'd lose the connection. 5-decimal fingerprint (≈1.1 m) closes the gap. 8 m tolerance from the user's brief is too loose — would over-merge densified vertices on the same path. **Spec sticks with 5 decimals (≈1.1m). User's "8m" was for inter-vertex de-dup; we apply it at union-find merge time inside TrailGraph (via existing `JUNCTION_THRESHOLD_M = 30` or a tightened constant).**

---

### 1.2 `app/src/services/routing/mapbox/MapboxJunctionExtractor.test.ts` (~180 LOC)

- Mocks `mapRef.current.querySourceFeatures` to return a fixture FeatureCollection.
- Three fixtures: simple T-junction, simple cross, isolated 2-vertex segment (no junction).
- Asserts:
  - T-junction → 1 junction with degree 3.
  - Cross → 1 junction with degree 4.
  - Isolated segment → 0 junctions.
  - Densification: 100m segment with intervalM=10 produces 11 points.
  - Fingerprint stability: same lng/lat at 5 decimals → same id even after small float perturbation in 7th decimal.
- Mock options: pass `{ minDegree: 2 }` and verify endpoints become junctions.

### 1.3 `app/src/services/routing/mapbox/index.ts` (~5 LOC)

Re-export `extractJunctions`, types. Single import path.

### 1.4 `app/src/services/routing/mapbox/buildTrailGraphFromMapbox.ts` (~80 LOC)

Adapter from `ExtractResult` → existing `TrailGraph` instance, so the rest of the system (Dijkstra in `candidateNodes.ts`, junction snap in `routeNodeAnchors.ts`) is unchanged.

```ts
import { TrailGraph } from '../graph/TrailGraph';
import type { DOCTrailFeature } from '../doctrails/DOCTrailsTypes';
import type { ExtractResult } from './MapboxJunctionExtractor';

/**
 * Convert MapboxJunctionExtractor output into a TrailGraph by synthesising
 * DOCTrailFeature[] (the input shape TrailGraph.fromTrails already accepts).
 * This keeps TrailGraph as the single graph builder — its union-find junction
 * merge + truncation cap apply equally well to Mapbox-derived ways.
 */
export function buildTrailGraphFromMapbox(extract: ExtractResult): TrailGraph {
  const trails: DOCTrailFeature[] = extract.ways.map(w => ({
    trackId: w.id,
    name: `mb-${w.klass}-${w.id}`,
    objectType: w.klass,
    geometry: {
      type: 'LineString',
      coordinates: w.coords.map(c => [c.lng, c.lat]),
    },
  }));
  return TrailGraph.fromTrails(trails);
}
```

**Why this adapter exists**: TrailGraph already does union-find junction merge with kdbush at 30m radius and has the truncation safety net (`MAX_GRAPH_NODES = 500`). Re-using it costs ~80 LOC and zero behavior risk vs ~300 LOC of bespoke code. The MapboxJunction list returned by §1.1 is *informational* (used for diagnostics + hiding the result behind feature flags); the actual edit-mode decisions all flow through TrailGraph.

### 1.5 `app/src/services/routing/mapbox/buildTrailGraphFromMapbox.test.ts` (~60 LOC)

- Round-trip test: ExtractResult → TrailGraph → snapToGraph for a coord on a way → returns nodeId with finite distance.
- Junction degree assertion: a T-junction in the input produces a TrailGraph node with `edges.length >= 3`.

---

## 2. Modified Files

### 2.1 `app/src/services/routing/editContext.ts` (+50 / −15 LOC)

```diff
- import { getCachedOrFetch } from './doctrails/DOCTrailsCache';
- import type { BBox } from './doctrails/DOCTrailsTypes';
+ import type { BBox } from './doctrails/DOCTrailsTypes';
+ import { extractJunctions } from './mapbox/MapboxJunctionExtractor';
+ import { buildTrailGraphFromMapbox } from './mapbox/buildTrailGraphFromMapbox';

- export async function buildEditContext(routeId: string): Promise<EditContext | null> {
+ export async function buildEditContext(
+   routeId: string,
+   mapRef: { current: any } | null,
+ ): Promise<EditContext | null> {
```

The DOC fetch block is replaced with:

```ts
let trailGraph: TrailGraph | null = null;
if (mapRef && mapRef.current) {
  const bbox = padBboxKm(originalPoints, 5);
  const result = await extractJunctions(mapRef, bbox, {
    minDegree: 3,
    densifyIntervalM: 10,
  });
  if (result.ok) {
    trailGraph = buildTrailGraphFromMapbox(result);
    // Densify the ways into the corridor index too, same as DOC did.
    for (const w of result.ways) {
      for (let i = 0; i < w.coords.length; i++) {
        indexedPoints.push({
          lng: w.coords[i].lng,
          lat: w.coords[i].lat,
          source: 'doc' as const,           // re-use 'doc' enum — see §2.1.1 below
          refId: `mb:${w.id}:${i}`,
        });
      }
    }
  } else {
    // result.error in {'map-not-ready','zoom-too-low','no-features','query-failed'}
    // Log via editAnalytics. trailGraph stays null — corridor enforcement still
    // works on originalPoints alone. UI gets endpoint-only edit anchors.
  }
}
```

#### 2.1.1 PointSource enum decision

`PointCloudIndex.ts` currently has `PointSource = 'original' | 'activity' | 'doc' | 'shared'`. We have two options:

- **Option A (chosen — minimal risk)**: re-use `'doc'` for Mapbox-sourced points. The string is opaque to the consumer (`isPointInCorridor` only cares about the lng/lat). Cost: misleading enum value. Fix later when removing DOC entirely.
- **Option B**: add `'mapbox'` to the union.

This Sprint picks **A**. A 1-line comment in `PointCloudIndex.ts` documents the lie:
```ts
/** 'doc' historically meant DOC ArcGIS; v201+ also covers Mapbox vector tile.
 *  Treated identically by corridor enforcement — both are "walkable surface". */
```

### 2.2 `app/src/screens/RouteEditorScreen.tsx` (+20 / −2 LOC)

The `mapRef` is currently a local lazy `cameraRef`, not a MapView ref. We add a sibling `mapViewRef`:

```diff
+ const mapViewRef = useRef<any>(null);
  ...
  <MapView
+   ref={mapViewRef}
    ...
  >
```

In `enterDualEdit`, change the `buildEditContext(effectiveRouteId)` call sites (there are two — non-legacy + legacy paths):
```diff
- ctx = await buildEditContext(effectiveRouteId);
+ ctx = await buildEditContext(effectiveRouteId, mapViewRef);
```

**Camera fit before extract**: `extractJunctions` requires zoom ≥ 14. Currently `dualEditCameraFit` runs `setCamera({ zoom })` which already zooms to 14 if the route bbox span ≤ 700 m, but for longer routes (a 5 km loop) it picks zoom 12 — below the floor. Two-step solution:

1. Before calling `buildEditContext` in `enterDualEdit`, fit camera to route bbox **clamped to zoom 14 minimum**.
2. Add a 600 ms `await new Promise(r => setTimeout(r, 600))` after the fit, before extract — empirical from Spike (matches the value used in SpikeMapboxJunctionScreen before `queryRenderedFeaturesInRect`).

This produces **brief visual jump** when the route is large: user enters edit mode, camera zooms from "fit-to-route" to zoom 14 over the centroid for ~600 ms, then either stays (small route) or zooms back out (large route — but we DON'T zoom back; user pans manually). The user explicitly accepted "force zoom ≥ 14 in edit mode" in the brief.

```diff
+ // Force zoom ≥ 14 for Mapbox vector tile junction extraction. The bbox-fit
+ // computed above may pick a lower zoom for large routes; we override here
+ // so querySourceFeatures returns simplified-but-junction-bearing geometry.
+ // 600 ms wait empirically matches Spike B Q3 timing for tile load.
+ if (mapViewRef.current && cameraRef.current) {
+   try {
+     const bbox = computeBboxFit(legacyPoints);
+     if (bbox) {
+       cameraRef.current.fitBounds(bbox.ne, bbox.sw, [60, 40, 60, 40], 0);
+       const targetZoom = Math.max(14, bbox.zoom);
+       if (targetZoom > bbox.zoom) {
+         // Zoom in further than the bbox fit so junction extraction works.
+         cameraRef.current.setCamera({ zoomLevel: targetZoom, animationDuration: 0 });
+       }
+     }
+   } catch { /* best-effort */ }
+   await new Promise(r => setTimeout(r, 600));
+ }
+ ctx = await buildEditContext(effectiveRouteId, mapViewRef);
```

`computeBboxFit` already exists in this file — re-use it.

### 2.3 `app/src/services/routing/corridor/PointCloudIndex.ts` (+2 LOC, comment only)

Add the comment from §2.1.1.

### 2.4 `app/src/services/routing/__tests__/editContext.test.ts` (NEW, +120 LOC)

- Mock the `extractJunctions` import to return a known fixture.
- Mock `loadExtras` to return originalPoints.
- Verify `buildEditContext(routeId, fakeRef)` produces:
  - non-null trailGraph
  - walkedIndex with both original points AND mapbox-derived points
- Verify graceful fallback when `extractJunctions` returns `{ ok: false, error: 'zoom-too-low' }`:
  - trailGraph = null
  - walkedIndex contains only original points

---

## 3. Data Model Mapping

### 3.1 MapboxJunction → RouteNodeAnchor

`routeNodeAnchors.computeRouteNodeAnchors` consumes `trailGraph` (TrailGraph instance), not the raw MapboxJunction list. So the mapping happens **inside TrailGraph.fromTrails** via the §1.4 adapter.

The crucial existing fields in `RouteNodeAnchor`:
```ts
{
  kind: 'intersection',
  workingPointIdx: i,            // index into workingPoints[]
  graphNodeId: snap.nodeId,      // string — TrailGraph node id ("tn0", "tn1", ...)
  id: `int-${snap.nodeId}`,
  ...
}
```

`graphNodeId` is consumed by `candidateNodes.candidatesForIntersection`:
```ts
const result = dijkstra(trailGraph.nodes, selected.graphNodeId);
const cost = result.distances.get(anchor.graphNodeId);
```

**Decision**: Keep `graphNodeId` as TrailGraph's autogenerated `tn{N}` string. The `mj_*` fingerprint id from MapboxJunctionExtractor is **diagnostic only** — never reaches `RouteNodeAnchor`. This lets the change land with **zero modifications** to `routeNodeAnchors.ts` and `candidateNodes.ts`. Their behaviour is identical to the DOC era; only the upstream graph source changed.

### 3.2 1km reachability — Dijkstra vs spatial

User asked: "candidateNodes uses Dijkstra for 1 km reachable — keep or switch to spatial?"

**Keep Dijkstra. Do not switch to spatial.** Rationale:
- A 1 km radius circle around a junction can include junctions on the *other* side of an uncrossable feature (river, cliff, motorway). Spatial radius candidates would let the user "drag" through these — corridor pre-check would eventually reject, but the UX is misleading (showing candidates that look reachable but aren't).
- Dijkstra on a graph capped at 500 nodes runs in 20–50 ms (Spike B Dijkstra telemetry). Negligible.
- Current `corridor` pre-check (`segmentInCorridor`, 5 sample points along straight A→D and D→Z lines) is a *fast filter* on top — not a replacement.

### 3.3 Junction merge tolerance

User suggested 8 m. Existing TrailGraph uses **30 m** (`JUNCTION_THRESHOLD_M = 30`). Two different things:

- **8 m fingerprint**: de-duplicate vertices that are visually the same point. Used inside `MapboxJunctionExtractor` — but we use 5-decimal fingerprint (~1.1 m) instead, which is tighter.
- **30 m union-find merge**: collapse near-but-not-identical junctions across different ways. Used inside `TrailGraph.fromTrails`.

Since Mapbox vector tile geometry is *simplified* (Douglas-Peucker), two ways meeting at a real-world junction will often have their endpoints round to the same vertex within 1 m. The 30 m TrailGraph merge handles the residual jitter. **Do not tighten to 8 m** — would split real junctions whose tile-simplified vertices land 5–15 m apart on adjacent tile boundaries.

---

## 4. Performance Protection

### 4.1 Vertex count guards

Spike B Q3 measured 7423 vertices in 312 ms (Auckland CBD zoom 14, iPhone 12). Pessimistic worst case (Shanghai downtown zoom 14): ~12000 vertices, ~600 ms bridge cost.

Defence in depth:

1. **Source-layer class filter** (§1.1 step 5): drops freeway/motorway from the result. Cuts vertex count by 30–50% in dense urban areas.
2. **InteractionManager wrap**: §1.1 step 6+ runs after current frame interactions complete. UI stays responsive during typing/scrolling at the cost of one frame of delay.
3. **Chunked yields**: every 1000 vertices, `await setTimeout(_, 0)`. Lets RN dispatch any queued events.
4. **Cap**: if `rawVertexCount > 20000`, abort with `{ ok: false, error: 'no-features', detail: 'vertex-cap-exceeded' }`. Editor falls back to endpoint-only mode. Logs a Sentry event for tuning.

### 4.2 Sub-bbox splitting

User asked if we should split. **Decision: no for v1.** The Spike validated whole-viewport extraction up to ~12k vertices on dense urban viewports. Sub-bbox splitting adds complexity (which sub-bboxes? how to merge?) and the failure mode (vertex cap hit) is rare and gracefully handled (endpoint-only fallback). Revisit if telemetry shows >5% of edits hitting the cap.

### 4.3 Cache

User asked nothing about caching. Add no cache in v1:
- DOC had a tile cache because every DOC API call cost 200–800 ms over the network.
- Mapbox `querySourceFeatures` reads from the tile that Mapbox SDK already cached for rendering. It's a JS-side feature filter, not a network call. Caching its output adds invalidation complexity for ~50 ms saving.

---

## 5. Error Handling

| Case | Cause | Behaviour |
|---|---|---|
| `mapRef.current === null` | Component unmounted before extract resumed | Return `{ ok: false, error: 'no-map-ref' }`. Editor opens with endpoint-only anchors. |
| Map not ready (`onDidFinishLoadingMap` not yet) | User taps Edit before tiles load | The 600 ms wait in §2.2 absorbs most of this. If still failing, return `'map-not-ready'`. Editor opens with endpoint-only anchors and shows a non-blocking warning: "Trail data still loading — pull down to retry." |
| Zoom < 14 | User somehow ended up at zoom 12 (long route, fit didn't override) | Return `'zoom-too-low'`. Caller (editContext) treats same as `'no-features'` — endpoint-only mode. |
| `querySourceFeatures` returns 0 features | Genuinely sparse OSM area (Amazon, remote alpine) OR style mismatch (we're using `outdoors-v12` which DOES expose `composite/road`) | Return `'no-features'`. Endpoint-only mode. |
| `querySourceFeatures` throws | `@rnmapbox/maps` SDK error | Catch, return `'query-failed'`. Endpoint-only mode. Log to editAnalytics. |

Editor never crashes on extraction failure. Worst case = endpoint-only edit (trim + restore still work). Same UX as a current non-NZ route in DOC mode.

---

## 6. Tests

### 6.1 New tests
- `app/src/services/routing/mapbox/__tests__/MapboxJunctionExtractor.test.ts` — fixture-driven, mocks `mapRef.current.querySourceFeatures`. Three fixtures (T, cross, isolated). Asserts junction count, degree, fingerprint stability.
- `app/src/services/routing/mapbox/__tests__/buildTrailGraphFromMapbox.test.ts` — round-trip ExtractResult → TrailGraph → snapToGraph.
- `app/src/services/routing/__tests__/editContext.test.ts` — buildEditContext with mocked extractJunctions, both PASS and FAIL paths.

### 6.2 Tests to update
- `app/src/services/routing/__tests__/routeNodeAnchors.test.ts` — none. routeNodeAnchors.ts is unchanged. Existing tests already use a hand-built TrailGraph, not DOC trails. They keep passing.
- `app/src/services/routing/__tests__/candidateNodes.test.ts` — none. Same reason.
- `app/src/services/routing/graph/__tests__/TrailGraph.test.ts` — none. TrailGraph itself unchanged.

### 6.3 Tests to delete or skip
- None. DOC test files (if any exist for `DOCTrailsClient` / `DOCTrailsCache`) keep running because the modules stay in tree (see §8).

### 6.4 Manual integration smoke test
- Edit a saved Shanghai route on iOS device. Verify ≥3 intersection anchors appear on map at zoom 14.
- Edit a saved NZ route. Verify count of intersection anchors is similar to pre-Sprint baseline (Mapbox should expose every DOC junction since DOC tracks are in OSM).
- Edit a route in deep wilderness (high alpine, no OSM data). Verify endpoint-only mode kicks in cleanly with the warning message.
- Edit a 20 km loop in a dense city. Verify the 600 ms wait period is bearable; verify editor doesn't freeze.

---

## 7. Cut vs Keep — DOC Code

**Decision: keep DOC code in tree. Stop calling it.** No file deletions this Sprint.

| Path | Action |
|---|---|
| `app/src/services/routing/doctrails/DOCTrailsClient.ts` | Keep. Unused. |
| `app/src/services/routing/doctrails/DOCTrailsCache.ts` | Keep. Unused. |
| `app/src/services/routing/doctrails/DOCTrailsTypes.ts` | Keep — `BBox` and `DOCTrailFeature` are imported by `editContext.ts` and `buildTrailGraphFromMapbox.ts`. Both are pure type aliases; renaming would just churn the diff. |
| `app/src/services/routing/doctrails/tileKey.ts` | Keep. Unused. |
| `editContext.ts` import of `getCachedOrFetch` | Removed — see §2.1. |

Why keep:
- Sprint scope: NZ-region DOC merge **will** revisit this in 1–2 Sprints. Deletion + re-creation thrash is wasted churn.
- Risk reduction: keeping the modules untouched leaves a one-line revert path if Mapbox extraction ships with a critical bug.
- Bundle size: ~6 KB. Negligible.

Add a `// @deprecated since v201 — see editContext.ts §Mapbox migration` JSDoc tag to `getCachedOrFetch`. That's it.

---

## 8. Spike Screen Disposition

`SpikeMapboxJunctionScreen.tsx` + `research/spike-b-readme.md`: **keep as dev-only validation tool**.

- Rename file header comment: "Mini-Spike B (validation, retained as dev tool post-decision)".
- Move docs note in `spike-b-readme.md` § "Cleanup after decision": replace the 4-step deletion checklist with:
  > **Decision taken (2026-06-XX): Mapbox vector tile path adopted. This screen is retained as a dev-only validation tool. To remove access from production builds, the route entry in `SettingsScreen.tsx` is gated by `debugMode`. No removal needed.**
- Settings screen entry: leave the existing 5-tap-version-to-enable Debug Mode gate. No change.

Estimated edit: 6 LOC across 2 files.

---

## 9. Commit Plan

5 commits, each self-contained and testable in isolation:

| # | Title | Files | LOC | Tests |
|---|---|---|---|---|
| 1 | `feat(routing): MapboxJunctionExtractor + types` | `mapbox/MapboxJunctionExtractor.ts`, `mapbox/index.ts`, `mapbox/__tests__/MapboxJunctionExtractor.test.ts` | +400 | unit tests pass |
| 2 | `feat(routing): TrailGraph adapter for Mapbox extraction` | `mapbox/buildTrailGraphFromMapbox.ts`, `mapbox/__tests__/buildTrailGraphFromMapbox.test.ts` | +140 | unit tests pass; commit 1 still green |
| 3 | `refactor(edit): wire MapboxJunctionExtractor into editContext, remove DOC call` | `editContext.ts`, `corridor/PointCloudIndex.ts` (comment only), `__tests__/editContext.test.ts` | +135 / −15 | new editContext test pass; existing routing tests pass |
| 4 | `feat(edit): pass mapRef from RouteEditorScreen to buildEditContext + force zoom ≥14` | `RouteEditorScreen.tsx` | +25 / −2 | existing UI tests pass; manual smoke (item §6.4) on Cairn dev build |
| 5 | `chore(spike): retain Mini-Spike B as dev validation tool, update README` | `SpikeMapboxJunctionScreen.tsx`, `research/spike-b-readme.md`, OTA-version bump | ~10 | n/a |

Each commit:
- Is independently revertable (commit 4 reverts cleanly without touching commits 1–3).
- Has tests that exercise the new code (except 4, which is UI wiring; covered by manual smoke).
- Builds in CI without commits before/after it (commits 1+2 add unused exports — that's fine; ESLint `no-unused-vars` is configured to ignore exports).

---

## 10. OTA Verification

| Concern | Status |
|---|---|
| New native deps? | None. `@rnmapbox/maps` already in tree at `^10.3.1`. |
| Changes to `app.json` / `eas.json` / iOS / Android native dirs? | None. |
| Changes to `package.json`? | None. `kdbush@4.1.0` already in tree (used by TrailGraph). |
| Bundle size delta | +5 KB JS (extractor + adapter). Negligible. |
| OTA-shippable? | **Yes.** All-JS. Standard Expo Updates flow. |

---

## 11. Risks + Plan B

### 11.1 Performance not meeting target on real device
**Symptom**: Edit mode takes >2 s to open on cheaper Android devices, OR mid-edit interactions janky.
**Plan B**: enable sub-bbox splitting (deferred from §4.2). Split route bbox into 4 quadrants, run `querySourceFeatures` 4 times sequentially with yields between. Total elapsed grows ~1.3× but per-call bridge cost drops 4×. Implementation: ~80 LOC in `MapboxJunctionExtractor.ts`. Gate behind `featureFlags.editMapboxSplitBbox`.

### 11.2 Force zoom 14 jump feels jarring
**Symptom**: Users edit a long route, camera jumps abruptly on Edit tap, lose context.
**Plan B**: instead of forced zoom, accept lower zoom and skip extraction, opening editor in endpoint-only mode with a "Zoom in to enable point editing" hint (the existing `zoomHint` styled view in RouteEditorScreen handles this — extend its trigger to fire when extraction was skipped, not just when current zoom < 14). When user zooms in past 14, re-run extraction *opportunistically* (debounced, 1.5 s after camera idle). ~30 LOC.

### 11.3 OSM sparse in target region (Amazon, central Asia steppe)
**Symptom**: User in deep rural area edits a route, gets endpoint-only mode with no junctions.
**Plan B**: this is the *expected* behaviour — there's no public road network to snap to. The warning banner ("Trail data unavailable here — endpoint trim still works") covers UX. No code change.

### 11.4 China GCJ-02 offset turns out to be real
**Symptom**: Spike Q2 PASS on test devices, but real users in CN report intersection anchors visibly off-road.
**Plan B**: add `app/src/services/routing/mapbox/coordTransform.ts` (~40 LOC pure-JS WGS-84 ↔ GCJ-02). Apply at extractor output if `Region.country === 'CN'`. Spike script and reference algorithm at `https://en.wikipedia.org/wiki/Restrictions_on_geographic_data_in_China`. OTA-shippable. Add to next Sprint backlog as STORY tagged 'mapbox-cn-offset'.

### 11.5 Mapbox style URL change drops the `composite/road` source
**Symptom**: After style switch (already happened from `outdoors-v12` → `streets-v12` in v119), source name or layer name changes silently.
**Plan B**: source/layer names are configurable via `extractJunctions` options. Keep `composite/road` as default — both `outdoors-v12` and `streets-v12` expose it. If a future style breaks this, the Sentry log from `'no-features'` error path catches it. ~5 LOC mitigation.

---

## 12. Lockdown Checklist (before implementation subagent starts)

- [ ] Spike B Q1 PASS (offline `querySourceFeatures` returns features) — this Sprint can ship even if Q1 FAILED, since edit is online-only. **Recorded in Sprint Goal.**
- [ ] Spike B Q2 PASS or ACCEPTED-AS-RISK (CN offset) — accepted as risk; Plan B at §11.4.
- [ ] Spike B Q3 PASS (vertex bridge < 500 ms) — required. If FAIL on real device, do §11.1 first.
- [ ] User confirmed: "no DOC merge this Sprint, Mapbox single-source production".
- [ ] User confirmed: "force zoom ≥ 14 in edit mode is acceptable UX".
- [ ] User confirmed: "edit + save-as-route are online-only — no offline scope".

---

## 13. Out of Scope — Explicitly Not in This Sprint

- **DOC merge for NZ region**. Next Sprint. TrailGraph supports merging in principle (could call `TrailGraph.fromTrails(mapboxTrails.concat(docTrails))`), but the dedupe + confidence-priority logic isn't designed.
- **Offline edit**. Mapbox offline pack does cache vector tiles, and `querySourceFeatures` *should* work offline if pack covers the bbox (Spike B Q1 validates this). But edit-mode-with-no-network has more UX considerations than just data: snap-to-road is online only, save persistence is online only. Out of scope; revisit when offline is a Must-Have.
- **GCJ-02 conversion**. §11.4 plan B. Not implemented unless real-device telemetry shows offset.
- **Sub-bbox splitting**. §11.1 plan B. Not implemented unless real-device telemetry shows unacceptable bridge cost.
- **Vector tile decoding from raw `.pbf`** (research report §1.4). Out of scope — relies on `querySourceFeatures` which `@rnmapbox/maps` already exposes.
- **Overpass API** (research report §1.1). User decided against. Mapbox vector tile is in scope, Overpass is not.
- **DOC code deletion**. §7. Deferred to a later Sprint.

---

**End of spec. Hand to implementation subagent.**
