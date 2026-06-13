# Sprint Spec — Map Matching Edit Mode (replaces vector-tile junction extraction)

**Status**: locked, commit-ready
**Author**: Arch
**Sprint target**: next OTA (runtime 0.2.2 compatible)
**Predecessor**: 4 failed attempts at client-side vector-tile graph reconstruction (see `MapboxJunctionExtractor.ts` audit history v200–v223). Pivots to server-side **Mapbox Map Matching v5** for intersection nodes, with sealed-line trim anchors as fallback.

---

## 0. North Star

Edit mode anchors fall into **exactly two kinds**:

1. **`mapbox-intersection`** — driven by Map Matching `steps[].intersections[]`. Always rendered when present. Produces **midpoint reroute** candidates (1km reachable subset, existing intersection-to-intersection algorithm).
2. **`gps-stride-trim`** — sampled every N meters along the user's actual GPS trace. **Hidden by default**; lit only when the user taps an endpoint. Produces **trim** candidates (no reroute).

The legacy `intersection` (graph-derived) and `trim-restore-start/end` (one-anchor-per-original-point) kinds are deprecated. All four legacy graph files (`MapboxJunctionExtractor`, `buildTrailGraphFromMapbox`, `TrailGraph`, `routeNodeAnchors`'s graph branch) stay in tree, marked `@deprecated v224`, scheduled for deletion next sprint.

3 product scenarios drive the rendering rules:

| Scenario | Trigger condition | Default visible | Endpoint tap | Intersection tap |
|----------|-------------------|-----------------|--------------|------------------|
| **A — Full coverage** | global confidence ≥ THRESH; segments-without-data is empty | start + intersections + end | trim anchors light (sealed line) | 1km reachable subset lights |
| **B — No coverage** | global confidence < THRESH OR all chunks `error: 'no-segment'` | start + end only | trim anchors light | n/a (no intersections) |
| **C — Mixed** | per-chunk: some confident, some not | start + (confident-region intersections) + end | trim anchors for the no-data side light | reachable subset within confident region |

After a trim in scenario C, the new endpoint becomes a regular endpoint anchor. Tapping it again lights both directions: trim further into the no-data region (forward) AND restore back toward the original endpoint (backward).

---

## 1. New file inventory

```
app/src/services/routing/mapMatching/
  MapMatchingClient.ts         ~200 LOC
  MapMatchingChunker.ts        ~140 LOC
  TrimAnchorGenerator.ts       ~90 LOC
  types.ts                     ~60 LOC
  index.ts                     ~15 LOC re-exports
  __tests__/
    MapMatchingClient.test.ts        ~180 LOC
    MapMatchingChunker.test.ts       ~120 LOC
    TrimAnchorGenerator.test.ts      ~90 LOC
    integration.test.ts              ~140 LOC
```

### 1.1 `types.ts`

```ts
import type { LngLat } from '../corridor/PolylineSampler';

export interface Intersection {
  id: string;                      // stable hash of "lng,lat,bearings" for memo + diag
  lng: number;
  lat: number;
  classes: string[];               // e.g. ["motorway","tunnel"]; empty array if absent
  entry: boolean[];                // bearings entry permission, parallel to bearings[]
  bearings: number[];              // raw degrees from steps[].intersections[i].bearings
  workingPointIdx: number;         // segmentEndIdx after projection onto matchedPolyline
  chunkIdx: number;                // which chunk produced this — for diag only
  inLeg: number;                   // matchings[].legs[i] index; for stable ordering
}

export interface TrimAnchor {
  id: string;                      // `trim-${side}-${originalPointIdx}`
  lng: number;
  lat: number;
  originalPointIdx: number;        // index into MapMatchingExtras.gpsTrace
  side: 'start' | 'end';           // bookkeeping; renderer uses tapped endpoint, not this
  // visibility is computed by the renderer from selectedAnchorId, NOT stored here
}

export interface MapMatchingExtras {
  intersections: Intersection[];   // empty if scenario B
  trimAnchors: TrimAnchor[];       // ALWAYS populated — fallback path
  matchedPolyline: LngLat[];       // tidied/snapped geometry from API; falls back to gpsTrace if all chunks failed
  gpsTrace: LngLat[];              // pristine input — drives trim sampling, not rendering
  globalConfidence: number;        // length-weighted mean across chunks; 0 if all failed
  hasMapboxData: boolean;          // globalConfidence >= CONFIDENCE_THRESHOLD AND ≥1 chunk ok
  segmentsWithoutData: Array<{ startIdx: number; endIdx: number }>; // ranges in gpsTrace
  diag: MapMatchingDiag;           // uploaded via editDiagUploader
}

export interface MapMatchingDiag {
  coordCount: number;
  chunkCount: number;
  chunkOutcomes: Array<{
    chunkIdx: number;
    ok: boolean;
    confidence: number;
    intersectionCount: number;
    errorCode?: MapMatchingErrorCode;
    httpStatus?: number;
    durationMs: number;
  }>;
  globalConfidence: number;
  intersectionCount: number;
  trimAnchorCount: number;
  hasMapboxData: boolean;
  segmentsWithoutDataCount: number;
  totalDurationMs: number;
}

export type MapMatchingErrorCode =
  | 'low-confidence'
  | 'no-segment'        // 422 NoSegment — points couldn't be matched to any road
  | 'too-many-coords'   // > 100 in a chunk; should never fire post-chunker
  | 'invalid-input'     // 422 other
  | 'rate-limit'        // 429
  | 'quota'             // 401/403/payment
  | 'network'           // fetch threw / timeout
  | 'aborted'           // caller AbortController
  | 'http'              // other 5xx/4xx
  | 'malformed';        // schema mismatch
```

### 1.2 `MapMatchingClient.ts`

```ts
export const MAPBOX_MAP_MATCHING_BASE =
  'https://api.mapbox.com/matching/v5/mapbox/walking';

export interface MatchOptions {
  /** Per-coordinate radius (m). Default 25, max 50 (API). Used for noisy GPS. */
  radiusM?: number;
  /** AbortSignal from caller (e.g. saveAndExit / unmount). */
  signal?: AbortSignal;
  /** Per-call timeout (default 12000). Long routes can exceed default fetch. */
  timeoutMs?: number;
}

export interface ChunkMatchResult {
  ok: true;
  confidence: number;            // matchings[0].confidence
  intersections: Intersection[]; // already projected onto matchedGeometry
  matchedGeometry: LngLat[];     // matchings[0].geometry decoded
  rawDurationMs: number;
}
export interface ChunkMatchFailure {
  ok: false;
  error: MapMatchingErrorCode;
  httpStatus?: number;
  message?: string;
  durationMs: number;
}
export type ChunkMatchOutcome = ChunkMatchResult | ChunkMatchFailure;

/** Single-chunk fetch. Caller (orchestrator) handles chunking + merging. */
export async function matchChunk(
  coords: LngLat[],
  chunkIdx: number,
  opts?: MatchOptions,
): Promise<ChunkMatchOutcome>;

/** End-to-end: chunk → fetch all → merge → produce MapMatchingExtras. */
export async function matchRoute(
  gpsTrace: LngLat[],
  opts?: MatchOptions & {
    confidenceThreshold?: number; // default 0.4 (see §5)
    strideM?: number;             // trim anchor stride; default 100
  },
): Promise<MapMatchingExtras>;
```

**Implementation notes**:
- Reads `EXPO_PUBLIC_MAPBOX_TOKEN` (already used by `DualSourceRouter`). HARD FAIL if absent: return all-trim extras with diag `error: 'quota'`.
- Request URL: `${BASE}/${coords.map(c=>`${c.lng},${c.lat}`).join(';')}?steps=true&geometries=geojson&overview=full&tidy=true&access_token=...&radiuses=${radiusList}` (radiuses semicolon-joined, one per coord).
- 429 handling: parse `Retry-After`, return `rate-limit`. **No auto-retry inside client.** Orchestrator decides (we don't want to block UI).
- Response schema validation (Zod-lite, manual): `data.matchings[]` array, each has `confidence: number`, `geometry.coordinates: number[][]`, `legs[].steps[].intersections[]`. Anything missing → `malformed`.
- Use `matchings[0]` only (highest confidence). Other matchings discarded.
- Project each intersection onto the matched geometry using the existing `projectPointToPolyline` (currently private in `routeNodeAnchors.ts`; promote to a shared `geo/projectPointToPolyline.ts` helper as part of Commit 2).

### 1.3 `MapMatchingChunker.ts`

```ts
export const MAX_COORDS_PER_CHUNK = 95;   // hard API limit 100, leave 5 for safety
export const OVERLAP_POINTS = 8;          // each chunk overlaps prev by N for stitching

export function chunkCoords(
  coords: LngLat[],
  maxPerChunk: number = MAX_COORDS_PER_CHUNK,
  overlap: number = OVERLAP_POINTS,
): Array<{ chunkIdx: number; gpsStartIdx: number; gpsEndIdx: number; coords: LngLat[] }>;

/**
 * Merge per-chunk outcomes into a single MapMatchingExtras.
 * - Concatenates matchedGeometry, dropping the overlap-prefix on chunks 1..n
 * - Concatenates intersections, deduping by (lng,lat) within 5m
 * - Computes globalConfidence as length-weighted mean of OK chunks
 * - Computes segmentsWithoutData from gpsStartIdx/gpsEndIdx of failed chunks
 * - Generates trim anchors from gpsTrace (NOT matched geometry)
 */
export function mergeChunkOutcomes(args: {
  gpsTrace: LngLat[];
  chunks: Array<{ gpsStartIdx: number; gpsEndIdx: number; outcome: ChunkMatchOutcome }>;
  confidenceThreshold: number;
  strideM: number;
}): MapMatchingExtras;
```

**Pre-densification rule**: if `coords.length > 95` AND `polylineLengthM(coords) / coords.length > 80m`, downsample to 50m stride first via `densifyPolyline` (existing helper). Avoids burning chunks on barely-populated traces.

**Dedup tolerance**: 5m haversine. Mapbox returns the same intersection at chunk boundaries (the overlap region) — without dedup we render a double anchor.

### 1.4 `TrimAnchorGenerator.ts`

```ts
export const DEFAULT_STRIDE_M = 100;
export const MIN_STRIDE_M = 25;            // floor for very short routes
export const MAX_TRIM_ANCHORS_PER_SIDE = 40; // hard cap for UI responsiveness

/**
 * Sample evenly along the GPS trace, generating both 'start'-side and
 * 'end'-side anchors. The same originalPointIdx CAN appear on both
 * sides (e.g. midpoint of a 200m route) — caller renders only the
 * side matching the tapped endpoint.
 */
export function generateTrimAnchors(
  gpsTrace: LngLat[],
  strideM: number = DEFAULT_STRIDE_M,
  cap: number = MAX_TRIM_ANCHORS_PER_SIDE,
): TrimAnchor[];
```

Stride is computed in **cumulative-distance space**, not index space — required because GPS traces have variable point density (paused-and-resumed walks). Use `polylineLengthM` per-segment accumulation.

For traces shorter than `2 * MIN_STRIDE_M` (~50m): emit endpoints only, no trim anchors. The route is too short to trim usefully.

---

## 2. Modified file inventory

| File | Change | Why |
|------|--------|-----|
| `app/src/services/routing/editContext.ts` | Replace Mapbox vector-tile branch (lines 106–256) with `matchRoute(originalPoints)` call. Return type changes: drop `trailGraph`, add `mapMatching: MapMatchingExtras`. Keep `walkedIndex` (still used by corridor enforcement) but feed it from `matchedPolyline + originalPoints`, NOT extracted ways. **`mapRef` parameter becomes unused** — delete it from signature; this is the green-light marker that we no longer touch tiles. | Old path failed 4 sprints in a row. Map Matching is server-side, deterministic, stays inside OTA budget. |
| `app/src/services/routing/routeNodeAnchors.ts` | Add new computation path `computeRouteNodeAnchorsFromMapMatching(args: { workingPoints, originalPoints, mapMatching })`. The old `computeRouteNodeAnchors` stays exported but is no longer called by `RouteEditorScreen`. New kinds emitted: `endpoint-start`, `endpoint-end`, `mapbox-intersection`, `gps-stride-trim`. The forward-projection helper `projectPointToPolyline` extracted to `geo/projectPointToPolyline.ts`. | Anchor input shape changes from graph to flat intersection list. Forward-projection algorithm preserved verbatim — it's the only piece of v215 that worked. |
| `app/src/store/useRouteEditStore.ts` | Replace field `trailGraph: TrailGraph \| null` with `mapMatching: MapMatchingExtras \| null`. Keep `walkedIndex` (corridor enforcement still needs it). `beginEdit` arg shape updated; `resumeFrom` path also takes a snapshot of `mapMatching` (so resume after app-kill keeps anchors without a fresh API call — token amortization). `restoreStart/restoreEnd` REMOVED from this sprint's surface (replaced by trim anchor flow); leave the methods in place but mark unused — they're still called by legacy waypoint editor screens. | Store is the join point between `editContext` and `RouteEditorScreen`. Mapbox-derived anchors are session data; replacing the field name makes the migration commit-grep-able. |
| `app/src/screens/RouteEditorScreen.tsx` | `enterDualEdit` (line 424): drop `mapViewRef` argument to `buildEditContext`. Pass `ctx.mapMatching` into `beginEdit`. Anchor selection effect (line 753, the `useMemo` of anchors): switch to `computeRouteNodeAnchorsFromMapMatching`. The `dualEditCameraFit` block stays untouched. | Single integration point. ~30 LOC delta. |
| `app/src/components/map/EditableNodeLayer.tsx` | New visual state for `gps-stride-trim`: render style identical to current `trim-restore-start/end` (orange dashed-ring on candidate, hidden on idle). Key change: visibility is no longer driven by `candidateAnchorIds` membership — it's driven by `selectedAnchorId === endpoint-start \|\| === endpoint-end`. Add `selectedKind` prop OR derive inside via the existing `selectedIsEndpoint` helper. Drop the special-case render logic for `trim-restore-start/end` (they will not be emitted by the new pipeline). | The renderer currently couples visibility to candidate-set; the new design needs visibility = "selected anchor is an endpoint". Smaller logic, fewer kinds. |
| `app/src/services/routing/editDiagUploader.ts` | Add `'map-matching'` kind. No code change — just allow new payload shape through. | One-line type widening. |
| `app/src/services/routing/RouteEditOrchestrator.ts` (only if `applyMidpointDrag` reads `trailGraph`) | If yes: pass `mapMatching.intersections` instead and adapt the reachable-set algorithm to work on a flat intersection list rather than a graph. **Investigate first** — if `applyMidpointDrag` only consumes `walkedIndex` for corridor enforcement, no change needed. Recorded as Open Question Q1 below. | Mapbox intersections have no edges, so existing 1km-reachable-via-Dijkstra cannot run as-is. Either we use straight-line-distance-on-polyline for reachability (simpler, correct enough for trim/edit UX), or we re-route via a fresh Map Matching call between drag-source and drag-target (slower but accurate). |
| `app/src/services/routing/mapbox/MapboxJunctionExtractor.ts` | Add `/** @deprecated v224 — replaced by Map Matching API. Removed in next sprint. */` JSDoc. **No code deletion.** | Reverting this sprint requires the file to still exist. |
| `app/src/services/routing/mapbox/buildTrailGraphFromMapbox.ts` | Same JSDoc-only `@deprecated v224`. | Same. |
| `app/src/services/routing/graph/TrailGraph.ts` | Same JSDoc-only `@deprecated v224 (for edit mode; still used by DOC routing)`. | DualSourceRouter still imports `TrailGraph` for DOC. Don't break that path. |

---

## 3. UX flow pseudocode

### 3.1 Entry

```
user taps Edit on route
  → enterDualEdit()
    → buildEditContext(routeId)
      → loadExtras(routeId) → originalPoints
      → matchRoute(originalPoints)  // NETWORK
        → chunk into N chunks of ≤95 coords
        → Promise.all(matchChunk × N)  // parallel; rate-limit via global semaphore (max 4)
        → mergeChunkOutcomes
        → uploadEditDiag('map-matching', diag)
        → return MapMatchingExtras
      → walkedIndex = new PointCloudIndex(originalPoints + matchedPolyline)
      → return { walkedIndex, mapMatching, originalPoints }
    → useRouteEditStore.beginEdit({ ..., mapMatching, walkedIndex })
    → routeNodeAnchors recomputed via useMemo
```

**Loading UX**: a banner "Aligning to map…" shows once `matchRoute` total time crosses 800ms. Banner dismissed automatically on completion. Cancel button calls AbortController (chunks in flight return `aborted`, rendered as scenario B).

### 3.2 Default render (post-load)

```
default:
  selectedAnchorId = null
  candidateAnchorIds = ∅

  visible anchors:
    - endpoint-start                        (always)
    - endpoint-end                          (always)
    - all mapbox-intersection               (always — scenario A or C-confident-region)
    - gps-stride-trim                       (HIDDEN unless endpoint selected)
```

### 3.3 Tap endpoint (scenario A or C — has intersections)

```
selectedAnchorId = endpoint-start (or endpoint-end)
candidateAnchorIds = { all gps-stride-trim where side === selected_side
                       AND originalPointIdx is on the trim-toward direction }

visible:
  - selected endpoint (highlighted)
  - other endpoint (idle)
  - all mapbox-intersection (idle, dimmer)
  - lit gps-stride-trim (orange)

user taps a gps-stride-trim anchor:
  → trimStart(originalPointIdx) or trimEnd(originalPointIdx)
  → workingPoints = originalPoints[idx..lastIdx] (or [0..idx])
  → editOpSeq++
  → re-render: new endpoint at trimmed position; remaining gps-stride-trim
    on the OUTSIDE of new endpoint go BACK to "hidden until tapped" state
```

### 3.4 Tap intersection (scenario A or C)

```
selectedAnchorId = mapbox-intersection-X
candidateAnchorIds = reachable-1km-subset of OTHER mapbox-intersection (existing algorithm)

user taps a candidate intersection:
  → applyMidpointDrag(fromPointIdx=X.workingPointIdx, toCoord=candidate.lngLat)
  → orchestrator decides: DOC route / Mapbox Directions / straight-fallback
  → workingPoints rewritten in [X..candidate] range
  → re-render
```

### 3.5 Tap endpoint (scenario B — no intersections at all)

```
Same as 3.3 but candidateAnchorIds is the FULL set of gps-stride-trim on the
correct side. No intersection anchors exist to render.
```

### 3.6 Scenario C twist — trim into no-data region, then re-tap

```
(initial state: front 40% no-data, back 60% has intersections)

user taps endpoint-start
  → gps-stride-trim anchors light over the front 40%
user taps anchor at ~20% mark
  → trimStart succeeds; new start point is at 20% of original
  → new endpoint-start is at 20% mark
user taps the new endpoint-start
  → candidateAnchorIds = {
      gps-stride-trim where idx < 20% mark  (back toward original start — restore)
      gps-stride-trim where idx in (20%, 40%) (forward — further trim)
    }
  → user can BOTH directions with one tap
  → tap behind original start → trim restores prefix (uses originalPoints
    slice, same code path as today's restoreStart but with new anchor kind)
  → tap forward → further trim (workingPoints[idx..lastIdx])
```

### 3.7 Save / cancel / app-kill

`saveAndExit` and `cancelEdit` unchanged. `MapMatchingExtras` is NOT persisted to AsyncStorage — too large, and re-fetching is cheap (single round-trip on resume). Resume path: `EditSessionPersistence.checkResumable()` returns session, `RouteEditorScreen` re-runs `buildEditContext` which re-fetches.

---

## 4. Data model addendum — store delta

```ts
// useRouteEditStore.ts — fields delta only

// REMOVE
trailGraph: TrailGraph | null;

// ADD
mapMatching: MapMatchingExtras | null;

// beginEdit args — replace trailGraph with mapMatching
beginEdit(args: {
  routeId: string;
  routePoints: LngLat[];
  routeUpdatedAt?: number;
  mapMatching: MapMatchingExtras | null;   // <-- was trailGraph
  walkedIndex: PointCloudIndex | null;
  resumeFrom?: { ...; mapMatching?: MapMatchingExtras };
})
```

The `EditFlagsSnapshot` is unchanged — `editCorridorRadiusMeters` and `midpointDragEnabled` are still relevant.

---

## 5. Confidence threshold + chunk merging

**Threshold**: `CONFIDENCE_THRESHOLD = 0.4`.

Rationale:
- API docs note confidence can drop to ~5e-10 in low-coverage areas; that's clearly scenario B
- Empirical Mapbox guidance treats ≥0.5 as "trustworthy" but walking traces in dense urban areas are often 0.3–0.6 due to GPS jitter against road centerlines (Shanghai sidewalk effect noted in `routeNodeAnchors.ts` v215 comment)
- 0.4 lets typical urban walking pass while excluding obvious mismatches
- Configurable via env var `EXPO_PUBLIC_MAP_MATCHING_CONFIDENCE_THRESHOLD` so we can tune post-launch without code change

**Per-chunk merge rules** (encoded in `mergeChunkOutcomes`):

| Chunk states | globalConfidence | hasMapboxData | intersections emitted | segmentsWithoutData |
|--------------|------------------|---------------|------------------------|---------------------|
| All N chunks ok, all conf ≥ 0.4 | length-weighted mean | true | from all chunks | empty |
| All N ok but ≥1 conf < 0.4 | length-weighted mean | false (the low-conf chunk's region is treated as no-data) | from chunks where conf ≥ 0.4 only | spans of low-conf chunks' gpsStartIdx..gpsEndIdx |
| Mix of ok and failed | length-weighted mean of ok chunks only | true if mean ≥ 0.4 AND ≥1 ok chunk | from ok+confident chunks | spans of failed chunks |
| All failed | 0 | false | empty | full trace [0..n-1] |

**Length weighting**: `Σ(chunkLengthM × confidence) / Σ(chunkLengthM)`. Prevents a tiny low-conf tail chunk from dragging down a 95% confident route.

---

## 6. Error handling

| Error | UX surface | Banner | Retry | Diag log |
|-------|-----------|--------|-------|----------|
| `network` (fetch threw, timeout, DNS) | All chunks → trim-only mode (scenario B) | "网络不通,只能修剪起终点" | Manual: edit close + reopen | yes |
| `quota` (401/403) | All chunks → trim-only | "地图服务暂不可用" | None (token issue, ops fix) | yes |
| `rate-limit` (429) | All chunks → trim-only | "稍后再试" | Auto-retry **once** after 2s, then give up | yes |
| `low-confidence` (chunk-level) | That chunk's region → no-data; other chunks render normally (scenario C) | None (silent — UI shows trim anchors instead) | None | yes |
| `no-segment` (422 NoSegment) | That chunk → no-data | None | None | yes |
| `aborted` (caller signal) | Discard partial results, don't render | None | n/a | yes (kind: `aborted`, no-op error) |
| `too-many-coords` | impossible after chunker; if it fires, log it as a bug | "内部错误" | None | yes (HIGH severity — chunker bug) |
| `malformed` | All chunks → trim-only | "地图数据格式错误" | None | yes (HIGH severity — Mapbox API change) |
| `http` (5xx) | All chunks → trim-only | "服务器繁忙" | Auto-retry once after 2s | yes |

**Banner**: re-uses the existing `lastWarning` channel in `useRouteEditStore` with `lastWarningKind: 'orchestrator'`. Persistence-failure warnings continue to win per existing precedence.

**Cancellation**: `enterDualEdit` creates an `AbortController`, passes signal to `matchRoute`, aborts on:
- user taps Cancel button on the loading banner
- `RouteEditorScreen` unmounts before load completes (existing `dualEditActiveRef` cleanup)

---

## 7. Test plan

### 7.1 Unit tests

**`MapMatchingClient.test.ts`**
- happy path: 1 chunk, 50 coords → ok, intersections projected, geometry decoded
- 422 NoSegment → `no-segment` error code
- 429 → `rate-limit`
- network throw → `network`
- malformed JSON → `malformed`
- timeout (mock `setTimeout`) → `network` with `aborted` distinguishable
- AbortSignal pre-aborted → `aborted` immediately (no fetch)
- response with `matchings: []` → `no-segment`
- intersection projection > 30m off polyline → still emitted but flagged in diag (Mapbox can return an intersection anchored to a parallel road; UX is acceptable since user can ignore)

**`MapMatchingChunker.test.ts`**
- 50 coords, max=95, overlap=8 → 1 chunk
- 100 coords → 2 chunks: [0..94], [87..99] (8-pt overlap)
- 200 coords → 3 chunks
- chunk index boundaries computed from gpsTrace indices (not chunked-coords indices) — assert
- merge: 2 chunks with 1 shared intersection in overlap → dedup to 1
- merge: chunk 1 ok (conf 0.9), chunk 2 fail → globalConfidence 0.9, segmentsWithoutData has chunk-2 range
- merge: all fail → globalConfidence 0, hasMapboxData false, intersections empty, trimAnchors populated from full trace
- length-weighted mean: 80% chunk at 0.5 + 20% at 0.1 → 0.42, hasMapboxData true (above 0.4)

**`TrimAnchorGenerator.test.ts`**
- 1km trace, stride 100m → 10 anchors per side
- 30m trace → 0 anchors (below floor)
- 5km trace, stride 100m → cap at 40 per side; stride auto-stretches
- variable-density trace (some segments 10m apart, some 80m) → cumulative-distance sampling produces evenly-spaced anchors
- `originalPointIdx` always points at a real index in `gpsTrace`

**`integration.test.ts`** (mocked fetch)
- end-to-end `matchRoute(2km Shanghai trace)` → returns `MapMatchingExtras` with intersections + trim
- end-to-end with all chunks failing → scenario B output
- end-to-end with mid-chunk failure → scenario C output
- diag payload structure validated

### 7.2 Smoke test (manual)

1. Pick a real 2-3km Shanghai walk recorded in dev. Open edit mode. Verify intersection anchors render at every observed road junction, none on top of buildings, none on parallel roads.
2. Pick a hutong walk. Verify scenario B: only endpoints render, trim works.
3. Pick a walk that crosses a hutong area into a major road. Verify scenario C: half the route has intersections, other half only shows trim anchors when endpoint tapped.
4. NZ alpine track (DOC). Verify `DualSourceRouter` still routes via DOC for midpoint drag while edit anchors come from Map Matching (intersections empty in alpine areas — falls back to scenario B with trim-only).

### 7.3 Performance test
- 30km route (300 coords post-densify): expect 4 chunks, parallel fetch, total ≤ 8s on 4G, ≤ 3s on Wi-Fi. Banner displays. Cancel works.
- App continues responsive during load (no main-thread blocking — fetch is async).

---

## 8. Diagnostic log

New diag kind `'map-matching'` uploaded via existing `uploadEditDiag`:

```json
{
  "kind": "map-matching",
  "routeId": "rt_...",
  "coordCount": 287,
  "chunkCount": 4,
  "chunkOutcomes": [
    { "chunkIdx": 0, "ok": true, "confidence": 0.82, "intersectionCount": 14, "durationMs": 412 },
    { "chunkIdx": 1, "ok": true, "confidence": 0.06, "intersectionCount": 0, "errorCode": "low-confidence", "durationMs": 380 },
    { "chunkIdx": 2, "ok": false, "errorCode": "no-segment", "httpStatus": 422, "durationMs": 220 },
    { "chunkIdx": 3, "ok": true, "confidence": 0.91, "intersectionCount": 18, "durationMs": 401 }
  ],
  "globalConfidence": 0.71,
  "intersectionCount": 32,
  "trimAnchorCount": 24,
  "hasMapboxData": true,
  "segmentsWithoutDataCount": 2,
  "totalDurationMs": 1413
}
```

Backend `/api/edit-diag` endpoint requires no schema change (it stores blob payloads). Index by `kind` for queries.

---

## 9. Legacy code disposition

**Stays in tree, marked `@deprecated v224`** (this sprint):
- `app/src/services/routing/mapbox/MapboxJunctionExtractor.ts`
- `app/src/services/routing/mapbox/buildTrailGraphFromMapbox.ts`
- `app/src/services/routing/graph/TrailGraph.ts` — partial deprecation (still used by DualSourceRouter for DOC); add JSDoc clarifying edit-mode usage is gone
- `app/src/services/routing/routeNodeAnchors.ts` — old `computeRouteNodeAnchors` retained but no longer called

**Deletion sprint** (next sprint, separate commit chain):
- All four files above (TrailGraph only if DOC routing also migrates; otherwise it stays)

**Tests for deleted files**: leave existing tests passing this sprint (since files compile). Delete tests in deletion sprint.

---

## 10. Commit plan (atomic, in order)

1. **`spec(edit): lock map-matching pivot — types + diag schema`**
   - `app/research/sprint-mapmatching-spec.md` (this file)
   - `types.ts` interfaces only (no impls)
   - `editDiagUploader.ts` widen kind union
   - `MapMatchingExtras` type re-exported from store types

2. **`feat(edit): MapMatchingClient (single-chunk fetch + projection)`**
   - `MapMatchingClient.ts` + tests
   - extract `projectPointToPolyline` to `geo/projectPointToPolyline.ts` + import-rewrite in `routeNodeAnchors.ts`
   - tests pass; no other file affected

3. **`feat(edit): chunker + merger`**
   - `MapMatchingChunker.ts` + tests
   - tests cover chunk boundaries, dedup, length-weighted confidence

4. **`feat(edit): TrimAnchorGenerator`**
   - `TrimAnchorGenerator.ts` + tests
   - cumulative-distance sampling, cap, floor

5. **`feat(edit): editContext switches to mapMatching`**
   - `editContext.ts` rewritten — vector-tile branch removed, `matchRoute` called
   - `EditContext` return type updated
   - Existing tests for `editContext` updated to mock `matchRoute` instead of `extractJunctions`

6. **`feat(edit): store + screen + renderer wired to new anchors`**
   - `useRouteEditStore.ts`: field rename `trailGraph` → `mapMatching` plus all internal references (note: `RouteEditOrchestrator.applyMidpointDrag` may need adapting — see Q1)
   - `routeNodeAnchors.ts`: new `computeRouteNodeAnchorsFromMapMatching`; old function retained
   - `RouteEditorScreen.tsx`: `enterDualEdit` calls new path; anchor `useMemo` uses new function; `mapViewRef` no longer threaded into `buildEditContext`
   - `EditableNodeLayer.tsx`: trim anchor visibility via `selectedKind`; legacy `trim-restore-*` render branch removed
   - All affected tests updated

7. **`chore(edit): deprecate legacy graph extractors + OTA bump`**
   - JSDoc `@deprecated v224` on the three legacy files
   - `app.json` runtimeVersion / OTA channel bump per project convention
   - `lessons.md` entry: 4 prior failed attempts → pivot rationale

Each commit must compile and pass its own tests in isolation. Commits 1–4 don't touch screen/store at all — they're pure additions.

---

## 11. OTA verification

- **All JS, zero native deps**. Pure HTTP client + array math. No new modules in `package.json` (uses global `fetch`, existing `AbortController`, existing `Mapbox` token plumbing).
- **Bundle size impact**: ~15KB gzipped (new TS files + tests excluded from bundle). Negligible.
- **Runtime 0.2.2 compatible**: confirmed — `fetch`, `URLSearchParams`, `AbortController`, `Promise.all` all available.
- **Hermes compat**: no regex lookbehind, no BigInt, no top-level await — clean.
- **iOS / Android parity**: no platform-specific paths. Same `fetch` everywhere.

OTA test before publish:
1. Build a dev OTA bundle, push to staging EAS Update channel
2. Open app, edit a route, verify Map Matching call fires and intersections render
3. Verify diag uploads land in `/api/edit-diag` with `kind: 'map-matching'`
4. Verify scenario B fallback (turn off Wi-Fi mid-load) → trim-only mode renders within 12s timeout

---

## 12. Risks + Plan B

**R1 — Token abuse**: `EXPO_PUBLIC_MAPBOX_TOKEN` is a `pk.*` public token. Already used by Directions API. Add **URL referrer restriction** on the Mapbox dashboard (`api.cairn.app`, `*.expo.dev` for dev builds). Enforce client-side rate limit: max 4 chunks parallel, max 1 `matchRoute` call per second per route (debounce in `enterDualEdit`).

**R2 — China hutong low confidence**: empirically expected. Plan: scenario B (trim-only) is the designed outcome — not a bug. Verify in smoke test #2.

**R3 — NZ alpine no road network**: same as R2. DOC routing still works for midpoint drag (separate path via `DualSourceRouter`); only intersection-anchors are missing. Acceptable.

**R4 — Long route stalling UI**: 30km route = 4-6 chunks ≈ 5-8s wall time. Mitigation: parallel fetch, AbortController on cancel, banner with progress text "对齐中…(2/4)". Loading banner mandatory above 800ms.

**R5 — Mapbox API outage**: scenario B fallback covers this. User sees "网络不通" + trim-only. No edit blocked.

**R6 — Reachable-set algorithm**: existing 1km-reachable subset uses graph Dijkstra. Without graph, we need a substitute. **Plan B: straight-line haversine distance ≤ 1km on the matchedPolyline.** Simpler, looks the same to the user, accepted limitation: doesn't account for road topology (a 1km away intersection might require 2km of walking due to one-way streets). Acceptable for v1; revisit if user reports unrouteable candidates.

**R7 — `applyMidpointDrag` depends on `trailGraph`**: **Open Question Q1.** Must investigate before Commit 6. If yes, two options:
- **Q1a**: Adapt the orchestrator to call Mapbox Directions API for the A→B reroute (already wired in `DualSourceRouter`). Slower (one extra round-trip per drag commit) but correct.
- **Q1b**: Keep using `TrailGraph` from a fresh extraction (revert to old code for THIS one path) — defeats the migration.
- **Decision rule**: Q1a unless smoke test shows it's too slow (>3s per drag). Recorded in `lessons.md` whichever way it lands.

**R8 — Resume after app-kill needs re-fetch**: re-running `matchRoute` on resume burns one round-trip per resume. Acceptable — resumes are rare. Future optimization: cache `MapMatchingExtras` keyed by `(routeId, originalPoints fingerprint)` in AsyncStorage. Out of scope this sprint.

---

## 13. Out of scope (explicitly)

- Offline Map Matching (user explicitly rejected)
- Server-side cache of `MapMatchingExtras` (defer to v2)
- Cross-route intersection sharing (e.g. two routes through the same junction sharing an anchor) — defer
- Auto-retry beyond the single 2s retry on 429/5xx
- User-tunable confidence threshold via in-app settings (env-var only this sprint)
- Migrating DOC routing off `TrailGraph` (separate sprint; orthogonal)
- Removing the deprecated files (next sprint, after one full release verifies stability)

---

## 14. Open questions (must resolve before Commit 6)

- **Q1**: Does `RouteEditOrchestrator.applyMidpointDrag` consume `trailGraph` directly, or only via `walkedIndex` and `DualSourceRouter`? — Investigate at start of Commit 5.
- **Q2**: Are intersection coordinates from Mapbox returned as `[lng, lat]` or `[lat, lng]`? Docs say `[lng, lat]`. Verify in dev with one real call before locking client schema.
- **Q3**: `radiuses` parameter — Mapbox docs say max 50m; setting too high causes more matches but worse confidence. Default to 25m, allow override via opts. Tune after smoke tests.
- **Q4**: Do we want the loading banner to be cancellable from the start, or only after 800ms? UX call. Default: **cancellable always** (Cancel button visible from the second the API call begins).

---

## 15. Plan-review pushback (where I disagreed with the brief)

1. **Brief's `OVERLAP_POINTS = 10`** → I dropped to 8. 10 is wasteful at 95-coord chunks (~10% overhead); 8 is enough to dedup boundary intersections within 5m at typical urban walking density.
2. **Brief's `confidence` field as the only gate** → Added length-weighting in merge. A 1.5km chunk at 0.9 + a 200m chunk at 0.1 should NOT average to 0.5; that's misleading. Length-weighted mean is the honest metric.
3. **Brief's "trim anchor every N meters"** → I made stride **cumulative-distance based, not index based**. GPS traces are not uniform in spacing — a paused walk has dense clusters. Index-stride would put 5 anchors at the same physical location.
4. **Brief's separate `start` / `end` `TrimAnchor` arrays** → Single array with `side` field. Halves storage; the renderer filters by side cheaper than indexing two arrays.
5. **Brief's `restoreStart/restoreEnd` retention** → I'm calling them out as **superseded by trim-anchor flow** in the new model. The trim-anchor approach handles both "trim further" and "restore prefix" with one anchor kind; keeping `restoreStart/End` would be parallel infrastructure for the same UX. Marked unused this sprint, full removal next sprint.
6. **Brief's "30 second total stall on 30km routes"** → I'm putting an 8-second target with parallel fetch. 30s is unacceptable UX; if we can't beat 8s on a 30km route we should pre-densify more aggressively (cut to 200 coords max → 3 chunks).
7. **Brief glossed over reachable-set algorithm** → R6 calls it out as a **breaking change**. The 1km Dijkstra reachable subset cannot run without a graph. We have to ship Plan B (straight-line haversine) and document it as a known limitation, OR run a second Map Matching call per drag (slower). I'd ship Plan B and watch telemetry.
8. **Brief did not specify `mapMatching` persistence** → Decision: do NOT persist to AsyncStorage. Costs a round-trip on resume but avoids stale-data bugs and keeps store schema simple.

---

## 16. Acceptance criteria (commit-ready definition of done)

- [ ] All 7 commits land in order, each compiles + tests pass in isolation
- [ ] `app/research/sprint-mapmatching-spec.md` exists (this file)
- [ ] `matchRoute(2kmShanghaiGPS)` returns `MapMatchingExtras` with ≥1 intersection (real network call, dev token)
- [ ] Edit mode opens on a Shanghai route with intersection anchors visible at junctions
- [ ] Edit mode opens on a hutong route in scenario B (trim-only); banner does NOT show "网络不通"
- [ ] Toggling airplane mode mid-load → trim-only fallback renders within 12s
- [ ] Tap endpoint → trim anchors light; tap intersection → reachable subset lights
- [ ] Tap trim anchor → `trimStart` succeeds, new endpoint at trimmed position
- [ ] Diag uploads with `kind: 'map-matching'` visible in `/api/edit-diag`
- [ ] Three deprecated files have `@deprecated v224` JSDoc
- [ ] OTA bundle published to staging channel; manual smoke test passes on iOS + Android
- [ ] No console errors in any flow (`browser_console_messages(level=error)` clean after each navigation)
- [ ] `lessons.md` entry written: "v220-v223 vector-tile pivot failed 4 sprints; map-matching server-side replaces it"

---

End of spec.
