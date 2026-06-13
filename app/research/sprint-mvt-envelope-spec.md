# Sprint MVT-Envelope — Server-Authoritative Edit Envelope

**Status**: Spec — pre-implementation
**Author**: Spec subagent (continuation of session a5441a62f29f6adcd)
**Date**: 2026-06-10

## Goal

Move the junction extraction + trail-graph construction off the device and onto the backend, by persisting (per route) a precomputed *edit envelope*: the set of Mapbox-vector-tile-derived junctions and densified ways covering the route's bbox+1.5km buffer. The app reads this envelope at edit-mode entry and skips its on-device extractor entirely.

The on-device pipeline (`extractJunctions` → `buildTrailGraphFromMapbox` → ways subsample → kdbush) is the dominant source of: (a) silent fallback to endpoint-only mode when ways exceed `MAX_WAYS_FOR_GRAPH=1500` or vertex count exceeds `maxVertexCount=20000`, (b) UI-blocking 300ms+ kdbush construction on first edit, (c) variability across users on the same route (different MapView zoom → different tile load → different feature set).

The envelope is computed once server-side at route save (and regenerated on demand), cached in MySQL, and shipped to the app as compact JSON. The app feeds the envelope directly to `buildTrailGraphFromMapbox` (or a near-identical replacement) — no Mapbox query on device for the purposes of editing.

---

## 1. Data Model — `EditEnvelope` schema

### 1.1 Persisted form (DB)

New table `route_edit_envelopes`:

```sql
CREATE TABLE route_edit_envelopes (
  route_id        BIGINT      NOT NULL PRIMARY KEY,
  version         INT         NOT NULL DEFAULT 1,
  bbox_west       DOUBLE      NOT NULL,
  bbox_south      DOUBLE      NOT NULL,
  bbox_east       DOUBLE      NOT NULL,
  bbox_north      DOUBLE      NOT NULL,
  pad_km          DOUBLE      NOT NULL DEFAULT 1.5,
  source          VARCHAR(32) NOT NULL DEFAULT 'mapbox-mvt',
  ways_json       MEDIUMTEXT  NOT NULL,    -- JSON array of WayLite
  junctions_json  MEDIUMTEXT  NOT NULL,    -- JSON array of JunctionLite
  diagnostics     TEXT        NULL,        -- JSON: rawFeatureCount, rawVertexCount, extractMs, etc.
  generated_at    BIGINT      NOT NULL,
  generator_v     INT         NOT NULL DEFAULT 1,
  CONSTRAINT fk_envelope_route FOREIGN KEY (route_id) REFERENCES routes(id) ON DELETE CASCADE
);
CREATE INDEX idx_envelope_routeid ON route_edit_envelopes(route_id);
```

**Why MEDIUMTEXT** — A 1.5km×1.5km urban bbox after MAX_WAYS_FOR_GRAPH=1500 sampling is ~250 KB JSON gzipped to ~40 KB. MEDIUMTEXT (16 MB) covers the worst-case 10km route (~2 MB raw). Binary protobuf was considered (Plan B §13) but JSON keeps the diff trivially debuggable in `routes.js`.

### 1.2 Wire form (`GET /api/routes/:id/edit-envelope`)

```ts
// app/src/services/routing/editEnvelopeTypes.ts (NEW)
export interface WayLite {
  id: string;                         // stable: `way_<sourceLayer>_<featureId>` from MVT
  coords: Array<{ lng: number; lat: number }>;  // already 10m-densified
  klass?: string;                     // e.g. 'street', 'path', 'service' — for future filtering
}

export interface JunctionLite {
  id: string;                         // `j_<lng5>_<lat5>` — stable across regenerations
  lng: number;
  lat: number;
  degree: number;                     // graph-edge count (>=3)
  wayIds: string[];                   // ways meeting at this junction
}

export interface EditEnvelope {
  version: 1;
  routeId: string;
  bbox: { west: number; south: number; east: number; north: number };
  padKm: number;
  source: 'mapbox-mvt';
  generatedAt: number;                // ms epoch
  generatorV: number;                 // bump when extractor algo changes
  ways: WayLite[];
  junctions: JunctionLite[];
  diagnostics: {
    rawFeatureCount: number;
    rawVertexCount: number;
    extractMs: number;
    bboxAreaKm2: number;
    waysAfterSubsample: number;
    waysSubsampled: boolean;
  };
}
```

**Schema invariants** (validated client-side at parse time):
- `ways[i].coords.length >= 2`
- `junctions[i].degree >= 3`
- `bbox.west < bbox.east`, `bbox.south < bbox.north`
- `version === 1` (else fall back to on-device extractor — see §13 Plan B)
- `ways.length <= 1500` (server enforces same cap as on-device path)

### 1.3 PointCloudIndex compatibility

`buildTrailGraphFromMapbox` currently consumes `extractJunctions`'s `ExtractResult`. The wire `EditEnvelope` is a strict subset; one new shim:

```ts
// app/src/services/routing/editEnvelope.ts (NEW)
export function envelopeToExtractResult(env: EditEnvelope): {
  ok: true;
  ways: WayLite[];
  junctions: JunctionLite[];
  diagnostics: typeof env.diagnostics;
};
```

---

## 2. Backend changes

### 2.1 New files

| File | LOC | Role |
|------|----:|------|
| `backend/src/models/EditEnvelope.js` | ~120 | DB layer: `create`, `findByRouteId`, `upsert`, `delete`, `markStale` |
| `backend/src/services/mvtEnvelopeBuilder.js` | ~280 | The actual MVT fetch + extract + junction detection |
| `backend/src/services/mvtTileFetch.js` | ~90 | Mapbox tile HTTP client (token + cache headers + retry) |
| `backend/src/services/envelopeJobs.js` | ~110 | Build queue (in-process for v1; Redis Plan B in §13) |
| `backend/src/routes/edit-envelope.js` | ~140 | HTTP routes — `GET`, `POST regen`, `DELETE` |
| `backend/migrations/2026-06-10-edit-envelopes.sql` | ~25 | Table + index |

### 2.2 Modified files

| File | Change | LOC delta |
|------|--------|----------:|
| `backend/src/routes/routes.js` | After `Route.create` (line 47-48): enqueue envelope build. After `Route.update` if `points` changed: mark envelope stale + enqueue regen. After `Route.delete`: cascade-delete envelope row (FK handles, but call `markStale` first to abort in-flight job). | +18 |
| `backend/src/server.js` | Mount `/api/routes/:id/edit-envelope` router | +2 |
| `backend/src/models/Route.js` | Expose `getPointsForEnvelope(routeId)` returning lng/lat-only array | +12 |
| `.env.example` | Add `MAPBOX_SERVER_TOKEN` (server-side secret token, separate from `EXPO_PUBLIC_MAPBOX_TOKEN`) | +1 |

### 2.3 Function signatures

```js
// backend/src/models/EditEnvelope.js
async function findByRouteId(routeId)      // -> { ...row } | null
async function upsert(routeId, envelope)   // -> void
async function markStale(routeId)          // -> void  (sets generator_v = 0)
async function isStale(routeId)            // -> boolean
async function delete_(routeId)            // -> void

// backend/src/services/mvtEnvelopeBuilder.js
async function buildEnvelope(args: {
  routeId: number,
  routePoints: Array<{lng:number,lat:number}>,
  padKm?: number,           // default 1.5
}): Promise<EditEnvelope>

// backend/src/services/mvtTileFetch.js
async function fetchTile(z: number, x: number, y: number): Promise<Buffer>
function bboxToTiles(bbox, zoom): Array<{z,x,y}>
function tilePixelToLngLat(tile, px, py, extent=4096): {lng,lat}

// backend/src/services/envelopeJobs.js
function enqueueBuild(routeId: number, opts?: { regen?: boolean }): void
function getJobStatus(routeId: number): 'idle'|'building'|'done'|'failed'
async function awaitJob(routeId: number, timeoutMs=10000): Promise<'done'|'failed'|'timeout'>

// backend/src/routes/edit-envelope.js — endpoints
GET    /api/routes/:id/edit-envelope            -> 200 EditEnvelope | 202 {status:'building'} | 404
POST   /api/routes/:id/edit-envelope/regenerate -> 202 {status:'building'}
DELETE /api/routes/:id/edit-envelope            -> 204 (admin only — auth gate via existing middleware)
```

**HTTP status policy**:
- `200` — envelope exists and is fresh
- `202` — build in progress; client should retry after 1.5s
- `404` — no envelope and no job (shouldn't happen post-create; fallback to on-device path)
- `409` — route has fewer than 2 points; envelope cannot be built
- `503` — Mapbox quota exceeded; client falls back to on-device path

---

## 3. App changes

### 3.1 New files

| File | LOC | Role |
|------|----:|------|
| `app/src/services/routing/editEnvelopeTypes.ts` | ~60 | Wire types (§1.2) + Zod-style validator |
| `app/src/services/routing/editEnvelopeClient.ts` | ~140 | `fetchEditEnvelope(routeId)` with 202-retry and AsyncStorage cache |
| `app/src/services/routing/editEnvelopeAdapter.ts` | ~80 | `envelopeToExtractResult` + corridor PointCloudIndex builder |

### 3.2 Modified files

| File | Change |
|------|--------|
| `app/src/services/routing/editContext.ts` | Replace the entire `mapRef && mapRef.current` block (lines 106-256) with a single call to `fetchEditEnvelope(routeId)` → `envelopeToExtractResult` → `buildTrailGraphFromMapbox`. Keep all `uploadEditDiag` calls but rename phases: `extract` → `envelope-fetch`, `graph-enter`/`graph`/`graph-error` unchanged. Drop `mapRef` parameter (still accepted but unused — deprecation comment). |
| `app/src/services/routing/RouteEditOrchestrator.ts` | No change to public surface. Only `editContext` feeds it. |
| `app/src/store/useRouteEditStore.ts` | `beginEdit` already accepts `trailGraph` + `walkedIndex` from caller; the caller's source changes (server vs MVT) but the store sees the same shapes. **No store changes**. |
| `app/src/services/routing/__tests__/editContext.test.ts` | Replace MVT-mock fixtures with envelope-mock fixtures. |

### 3.3 Files to deprecate (NOT delete in this Sprint)

These remain in the tree, untouched, behind a fallback branch (§6.3 / §13 Plan B). Mark with banner comment `// DEPRECATED — see sprint-mvt-envelope-spec.md §3.3`:

- `app/src/services/routing/mapbox/MapboxJunctionExtractor.ts` (`extractJunctions`)
- `app/src/services/routing/mapbox/buildTrailGraphFromMapbox.ts` — **kept**, server feeds it via the adapter; only the MVT-extraction half is deprecated.
- `app/src/services/routing/doctrails/*` — already off the path (per `editContext.ts` comment line 18-20); leave as-is.

Deletion happens in a follow-up Sprint after one full release confirms the envelope path stable.

---

## 4. Save flow (sequence)

```
User taps Save in RouteEditorScreen
  │
  ▼
useRouteEditStore.saveAndExit()
  ├── saveExtras() to AsyncStorage  (existing)
  └── (existing) returns ok
        │
        ▼
RouteEditOrchestrator caller invokes useRouteStore.updateRoute(id, points)
        │
        ▼
PUT /api/routes/:id { points, ... }   (existing — backend/src/routes/routes.js line 83)
  │
  ├── Route.update(...)               (existing)
  └── ── NEW ── if points changed:
        EditEnvelope.markStale(routeId)
        envelopeJobs.enqueueBuild(routeId, { regen: true })
        │
        ▼  (async, fire-and-forget; response returns immediately)
mvtEnvelopeBuilder.buildEnvelope({ routeId, routePoints, padKm: 1.5 })
  │
  ├── padBboxKm(routePoints, 1.5)                      → bbox
  ├── bboxToTiles(bbox, zoom=14)                       → tiles[]
  ├── for each tile: mvtTileFetch.fetchTile(z,x,y)     → Buffer (parallel, max 6 concurrent)
  ├── @mapbox/vector-tile parse → features
  ├── filter source-layer ∈ {'road', 'transportation'} klass ∈ allowed set
  ├── densify each LineString to 10m intervals (extractor algo §7)
  ├── extractJunctions (server port of app's MapboxJunctionExtractor §7)
  ├── if ways > 1500: subsample step = ceil(ways/1500)
  └── EditEnvelope.upsert(routeId, envelope)
        │
        ▼
envelopeJobs marks 'done'
```

**On POST /api/routes (route create)**: same as above, but `markStale` is skipped (no prior envelope) and `enqueueBuild` runs with `regen: false`.

**Latency budget**: Save returns to user in <500ms (envelope build is async). Envelope build itself: target <8s for 1km route, <20s for 10km route. Cold-start tile fetch dominates; cached tiles cut to <2s.

---

## 5. Edit flow (sequence)

```
User taps Edit on RouteCard
  │
  ▼
RouteEditorScreen mounts
  │
  ▼
buildEditContext(routeId, mapRef)        (mapRef now ignored)
  │
  ├── loadExtras(routeId)                (existing)
  ├── ── NEW ── fetchEditEnvelope(routeId):
  │     1. Check AsyncStorage cache (key = `editEnvelope:${routeId}`)
  │        - If hit AND cached.generatedAt > extras.updatedAt → return cached
  │     2. GET /api/routes/:id/edit-envelope
  │        - 200 → parse, validate (§1.2 invariants), store in AsyncStorage, return
  │        - 202 → wait 1500ms, retry (max 6 retries = 9s ceiling)
  │              after 6 retries → throw 'envelope-build-timeout'
  │        - 404 / 503 / network err / validate fail → throw to caller; caller (§6.3) decides fallback
  │  ── on success ──
  ├── envelopeToExtractResult(env) → { ok:true, ways, junctions, diagnostics }
  ├── (cap-and-subsample logic from editContext.ts lines 164-171 — UNCHANGED, applied to envelope.ways)
  ├── buildTrailGraphFromMapbox({ ...envelope, ways: waysForGraph })
  ├── feed densified ways into PointCloudIndex (existing dedupe loop, lines 227-241)
  └── return EditContext { walkedIndex, trailGraph, originalPoints }
        │
        ▼
useRouteEditStore.beginEdit({ trailGraph, walkedIndex, ... })   (UNCHANGED)
        │
        ▼
RouteEditor renders anchors via routeNodeAnchors.computeRouteNodeAnchors(...)
                                                       (UNCHANGED)
```

---

## 6. Cache regen strategy

### 6.1 When the server regenerates

| Trigger | Action |
|---------|--------|
| `POST /api/routes` (new route) | `enqueueBuild(routeId, {regen:false})` |
| `PUT /api/routes/:id` with `points` mutated | `markStale(routeId)` then `enqueueBuild(routeId, {regen:true})` |
| `PATCH /api/routes/:id/run` | No-op (run_count doesn't affect geometry) |
| `DELETE /api/routes/:id` | `markStale` aborts in-flight job; FK cascade deletes row |
| `POST /api/routes/:id/edit-envelope/regenerate` (admin/debug) | Force enqueue ignoring stale state |

**Detecting "points mutated"**: in `routes.js` PUT handler, compare `req.body.points` length and first/last/middle samples to the existing row before update — same heuristic as `useRouteEditStore.beginEdit`'s `routePointsDifferFromExtras` (lines 378-446). If unchanged, skip regen.

### 6.2 When the client invalidates cache

App-side AsyncStorage cache:
- Cache key: `editEnvelope:${routeId}`
- TTL: none (server is authoritative; client trusts the row's `generatedAt`)
- Eviction: on `useRouteStore.updateRoute(routeId, ...)` success, app clears `editEnvelope:${routeId}`. This forces a refetch which will land 202 if the server is still building, then 200 with the new envelope.
- Storage budget: cap total cache to 50 MB; LRU evict by `generatedAt`. Implemented in `editEnvelopeClient.ts` with a sidecar `editEnvelopeIndex` JSON in AsyncStorage.

### 6.3 Fallback when envelope unavailable

`fetchEditEnvelope` rejects with `'envelope-build-timeout'`, `'envelope-not-found'`, `'mapbox-quota'`, or network error. Caller (`editContext.ts`) catches:

```ts
try {
  const env = await fetchEditEnvelope(routeId);
  // ... happy path
} catch (e) {
  uploadEditDiag('envelope-fetch-error', { routeId, message: String(e) });
  // Fallback: trailGraph stays null. Editor opens in endpoint-only mode.
  // (Same final state as current "no MVT extraction available" path —
  // §3.3 deprecated extractor is NOT invoked. This is a deliberate
  // simplification: one fallback path, not two.)
  trailGraph = null;
}
```

This means: in v1, an envelope outage degrades the editor to endpoint-only (trim works, midpoint drag does not). The on-device extractor is **not** a runtime fallback. It remains in the tree (§3.3) only as a Plan B (§13) requiring a code change to re-enable.

---

## 7. Algorithm detail

### 7.1 `extractJunctions` (server port)

Port of `app/src/services/routing/mapbox/MapboxJunctionExtractor.ts` to Node:

1. For each tile in `bboxToTiles(bbox, 14)`:
   - Fetch via `mvtTileFetch.fetchTile`
   - Parse with `@mapbox/vector-tile` + `pbf`
   - Iterate features in `composite` source's `road` / `transportation` layers
   - Filter by `klass`: keep `{street, primary, secondary, tertiary, motorway_link, trunk, path, footway, pedestrian, service, track}`. Reject `{ferry, aerialway, golf}`.
   - For each LineString feature: project each tile-pixel coord to lng/lat via `tilePixelToLngLat`, dedupe consecutive identical coords.
   - Densify: walk segments, insert intermediate points so no segment exceeds `densifyIntervalM=10`. Haversine distance.
   - Emit `WayLite { id: 'way_'+layer+'_'+featureId, coords, klass }`
2. Junction detection (union-find over way endpoints + intermediate vertex coincidences):
   - Round each coord to 5 decimal places (`~1.1m`) for fingerprinting.
   - Build `Map<fingerprint, { wayIds: Set<string>, lng, lat }>`
   - Junction = entries where `wayIds.size >= MIN_INTERSECTION_DEGREE = 3`
   - Emit `JunctionLite { id: 'j_'+lng5+'_'+lat5, lng, lat, degree: wayIds.size, wayIds: [...wayIds] }`
3. Cap ways at `MAX_WAYS_FOR_GRAPH = 1500` via even-spaced subsample (preserve first/last; pick every Nth in between). Track `waysSubsampled` boolean for diagnostics.

### 7.2 `bboxToTiles(bbox, zoom)`

Standard Web Mercator tile coverage. At zoom=14, 1.5km × 1.5km bbox in mid-latitudes spans ~3×3 tiles = 9 fetches typical, 16 worst case at high latitudes.

```js
function lngLatToTile(lng, lat, z) {
  const n = 2 ** z;
  const x = Math.floor(((lng + 180) / 360) * n);
  const latRad = (lat * Math.PI) / 180;
  const y = Math.floor(((1 - Math.asinh(Math.tan(latRad)) / Math.PI) / 2) * n);
  return { x, y };
}
function bboxToTiles(bbox, z) {
  const tl = lngLatToTile(bbox.west,  bbox.north, z);
  const br = lngLatToTile(bbox.east,  bbox.south, z);
  const tiles = [];
  for (let x = tl.x; x <= br.x; x++)
    for (let y = tl.y; y <= br.y; y++)
      tiles.push({ z, x, y });
  return tiles;
}
```

### 7.3 `tilePixelToLngLat(tile, px, py, extent=4096)`

Inverse of MVT-standard `tilePixelTo*`. Tile coords are 0..extent (default 4096); top-left = (0,0).

```js
function tilePixelToLngLat({ z, x, y }, px, py, extent = 4096) {
  const n = 2 ** z;
  const lng = ((x + px / extent) / n) * 360 - 180;
  const yNorm = (y + py / extent) / n;
  const latRad = Math.atan(Math.sinh(Math.PI * (1 - 2 * yNorm)));
  const lat = (latRad * 180) / Math.PI;
  return { lng, lat };
}
```

### 7.4 `padBboxKm`

Identical to `app/src/services/routing/editContext.ts` lines 36-57. Reused verbatim server-side; copy into `mvtEnvelopeBuilder.js` (no shared module — backend has no TS).

---

## 8. Error handling matrix

| Phase | Failure | Server response | Client behavior |
|-------|---------|-----------------|-----------------|
| Save: enqueueBuild | Job queue full | log + skip enqueue | Next edit: GET → 404 → fallback (§6.3) |
| Build: tile fetch 401 | Bad/missing `MAPBOX_SERVER_TOKEN` | log error; mark job 'failed' | GET → 503 → fallback |
| Build: tile fetch 429 | Mapbox quota | retry with exp backoff (max 3); fail | GET → 503 → fallback |
| Build: tile fetch network | Timeout/DNS | retry 3x; fail | GET → 503 → fallback |
| Build: parse error | Bad MVT bytes | log; mark 'failed' | GET → 503 → fallback |
| Build: 0 ways extracted | Sparse OSM area | upsert empty envelope (ways=[], junctions=[]) | GET → 200 with empty arrays → trailGraph=null in app → endpoint-only mode |
| GET: route not found | 404 | 404 | Fallback (no envelope possible) |
| GET: build in progress | First fetch after save | 202 `{status:'building'}` | Retry up to 6× @ 1.5s; then fallback |
| GET: validate fail (client) | Schema mismatch / version mismatch | n/a | Log to `uploadEditDiag('envelope-validate-error',...)`; fallback |
| Client cache: AsyncStorage write fail | Disk full | n/a | Continue without cache; refetch each time |
| App offline | No network at edit time | n/a | If cached: use cache (even if stale). Else: fallback |

Every failure path emits an `uploadEditDiag` event with phase tag — see §10.

---

## 9. Test plan

### 9.1 Backend unit (Jest)

`backend/test/services/mvtEnvelopeBuilder.test.js`:
- `bboxToTiles` — known bbox→tile coverage at z=14 (3 fixed cases: NYC, Auckland, Shanghai)
- `tilePixelToLngLat` — round-trip with `lngLatToTile` (within 1e-9)
- `extractJunctions` against fixture MVT files in `backend/test/fixtures/mvt/`:
  - `nyc-grid.mvt` — expect ≥10 junctions, all degree≥3
  - `rural-trail.mvt` — expect 0-2 junctions
  - `dense-shanghai.mvt` — expect ways subsampled (>1500 raw)
- Densification: input 100m segment with no intermediate vertices → output 11 vertices (10m spacing + endpoints)

`backend/test/models/EditEnvelope.test.js`:
- `upsert` then `findByRouteId` — round-trip preserves all fields
- `markStale` sets `generator_v=0`
- `delete` removes row
- FK cascade: `routes.delete(id)` removes envelope row

### 9.2 Backend integration

`backend/test/integration/edit-envelope.test.js` (uses real DB + mocked Mapbox tile fetch):
- `POST /api/routes` triggers envelope build; `GET /api/routes/:id/edit-envelope` returns 202 then 200
- `PUT /api/routes/:id` with new `points` re-builds; `generatedAt` advances
- `PUT /api/routes/:id` with same `points` does NOT re-build
- `DELETE /api/routes/:id` cascades
- Auth: unauthenticated GET → 401
- Auth: GET another user's envelope → 403
- Mapbox 429 mock: route returns 503 to client

### 9.3 App unit (Jest + RNTL)

`app/src/services/routing/__tests__/editEnvelopeClient.test.ts`:
- 200 happy path → cache write
- 202 → 200 retry sequence
- 404 → throws `envelope-not-found`
- 503 → throws `mapbox-quota`
- Validate fail (bad version, ways[i].coords.length<2, etc.) → throws
- Cache hit (cache.generatedAt > extras.updatedAt) → no network call

`app/src/services/routing/__tests__/editEnvelopeAdapter.test.ts`:
- Empty envelope → `{ok:true, ways:[], junctions:[]}` → buildTrailGraphFromMapbox returns empty graph (existing behavior)
- 100-way envelope → graph node count matches junctions length

`app/src/services/routing/__tests__/editContext.test.ts` (update existing):
- Replace MVT-mock with envelope-mock
- Path: envelope ok → trailGraph built → walkedIndex contains original + envelope ways
- Path: envelope fetch fails → trailGraph=null, walkedIndex contains original only
- mapRef is unused (assert no calls on it)

### 9.4 E2E smoke (manual + automated)

Sprint Demo script:
1. Save a new 1km city route → wait 10s → enter edit → verify junction anchors visible
2. Save a 10km rural route → enter edit → verify endpoint-only mode (envelope likely empty in sparse OSM area) and no console error
3. Edit and save existing route → re-enter edit → verify junctions update for new geometry
4. Airplane mode + cached envelope → enter edit → still works
5. Airplane mode + no cache → enter edit → falls back gracefully (no crash, no infinite spinner)

---

## 10. Diagnostic log schema

Every phase posts to `/api/edit-diag` (existing endpoint, see `editDiagUploader.ts`). New phases for MVT-Envelope:

```ts
type EnvelopePhase =
  | 'envelope-fetch'         // client GET success; payload: { routeId, status:'cache'|'200'|'202-retry', ms }
  | 'envelope-fetch-error'   // client GET fail; payload: { routeId, message, code }
  | 'envelope-validate-error'// client schema fail; payload: { routeId, field, value }
  | 'envelope-build-start'   // server build start; payload: { routeId, bboxAreaKm2, padKm }
  | 'envelope-build-done'    // server build success; payload: { routeId, ways, junctions, ms, waysSubsampled }
  | 'envelope-build-error'   // server build fail; payload: { routeId, phase, message }
  | 'envelope-empty'         // server built 0 ways; payload: { routeId, bboxAreaKm2 }
```

Existing phases `extract`, `graph-enter`, `graph`, `graph-error`, `anchors` continue with same payloads — they now describe the post-fetch graph build, not MVT extraction. The on-device `extract` payloads disappear from production traffic; their absence is the canary that the new path is live.

Server-side: `mvtEnvelopeBuilder` writes the same JSON shape to a server log file `backend/logs/envelope-build.jsonl` for debugging without round-tripping through the device.

---

## 11. Commit plan (7 commits)

| # | Commit | Files | Verification |
|---|--------|-------|--------------|
| 1 | `feat(backend): add route_edit_envelopes table + EditEnvelope model` | migration, models/EditEnvelope.js, model unit tests | DB migration runs; model unit tests pass |
| 2 | `feat(backend): MVT envelope builder service` | services/mvtTileFetch.js, services/mvtEnvelopeBuilder.js, fixture MVTs, builder unit tests | All §9.1 pass |
| 3 | `feat(backend): edit-envelope routes + jobs queue` | routes/edit-envelope.js, services/envelopeJobs.js, server.js mount, integration tests | §9.2 pass; manual `curl GET /api/routes/1/edit-envelope` returns 202 then 200 |
| 4 | `feat(backend): trigger envelope build on route create/update` | routes/routes.js, models/Route.js | Save a route in dev app; check envelope row exists |
| 5 | `feat(app): editEnvelope client + adapter + types` | editEnvelopeTypes.ts, editEnvelopeClient.ts, editEnvelopeAdapter.ts, unit tests | §9.3 pass |
| 6 | `feat(app): editContext consumes server envelope; deprecate on-device extractor` | editContext.ts (rewrite block), MapboxJunctionExtractor.ts deprecation banner, editContext.test.ts updates | §9.3 pass; `extract` diag phase no longer emitted in dev runs |
| 7 | `chore: docs + lessons` | research/sprint-mvt-envelope-spec.md (this file), tasks/lessons.md, CHANGELOG | n/a |

Each commit MUST leave the project in a runnable, test-passing state. Commits 1-4 ship server-only; commit 5 lands client code that doesn't activate until commit 6 flips the call site. If a regression appears after commit 6, revert just commit 6 (single-file revert) — server work survives.

---

## 12. OTA verification

Commits 5-7 are JS-only and ship via EAS Update OTA. Commit 6 is the only behavior-changing OTA — verify before rollout:

1. **Pre-OTA**: tag `v(N)-pre-mvt-envelope` so we can OTA-rollback if telemetry shows fallback rate >5%.
2. **OTA target**: `production` channel, staged rollout 10% → 50% → 100% over 24h.
3. **Post-OTA telemetry watch** (24h after each stage):
   - `edit-diag-extract` count → expect drop to ~0 (canary)
   - `envelope-fetch` p50 latency → expect <500ms after warmup, <2s p95
   - `envelope-fetch-error` rate → expect <1% of edit sessions
   - `graph` nodeCount distribution → compare to pre-OTA distribution; should match within ±10%
   - `anchors` `finalAnchorCount` p50 → must not regress (any drop >20% = halt rollout)
4. **Rollback trigger**: if any of (a) envelope-fetch-error >5%, (b) anchor count regression >20%, (c) crash rate up >0.1%, OTA-revert to pre-mvt-envelope tag.

Native binary unchanged — no EAS build required for this Sprint.

---

## 13. Risks + Plan B

### 13.1 Risks

| Risk | Likelihood | Mitigation |
|------|-----------:|-----------|
| Mapbox server-side quota cost | Medium | Monitor `mvtTileFetch` request count; cap concurrent builds at 4; cache tiles in process memory for 1h (LRU 100 MB) |
| Envelope row size for 50km ultra routes | Low | MEDIUMTEXT covers 16 MB; ways subsample at 1500 keeps actual size <500 KB |
| Job queue lost on backend restart | Medium | v1: in-process queue, jobs lost on restart but route remains in `pending`-needs-build state — next GET re-enqueues. v2 (Plan B): Redis BullMQ. |
| Client AsyncStorage cache corruption | Low | Validate on read; on validate-fail, clear cache key and refetch |
| Envelope generator algorithm divergence from on-device | Medium | Port from app code in commit 2; share fixture-based tests. Generator version field (`generator_v`) lets server force regen if algo changes. |
| Empty envelope in dense urban area (build silently failed) | Medium | `envelope-empty` diag event; server-side alert if rate >1% |
| Race: route saved + edited while envelope still building | High | GET returns 202; client retries up to 9s; if still building falls back to endpoint-only — user still gets a working editor |

### 13.2 Plan B (if envelope path fails post-OTA)

1. **OTA-revert commit 6** — restores on-device extractor as primary path. Server-side envelope rows continue to be built (commits 1-4 remain) but are unused. No data loss.
2. **Diagnose**: compare on-device vs server `extractJunctions` outputs on the same fixture routes.
3. **Re-roll** with fix.

### 13.3 Plan C (graceful degradation if Mapbox server token unavailable)

Backend env without `MAPBOX_SERVER_TOKEN` set:
- `mvtEnvelopeBuilder` returns early with `envelope-build-error` `{message: 'no-token'}`
- Job marks 'failed'; envelope row absent
- Client GET → 404 → on-device fallback (§6.3)

System remains functional in the same shape as today (endpoint-only edit when MVT path fails), giving deploy-ops time to provision the token.

---

## 14. Out of scope

- **DOC trails re-integration** (`doctrails/`). Stays off the path. NZ region merge deferred per `editContext.ts` line 18-20 comment.
- **Per-user envelope variants** (e.g. user A prefers footways, user B prefers streets). v1 envelope is one-size-fits-all per route.
- **Envelope sharing across overlapping routes**. Each route has its own row even if bboxes are nearly identical. Tile-level cache (§13.1) is the only cross-route reuse.
- **Versioning of envelope schema** beyond v1 bump-and-regen. A future v2 wire format would land as a new endpoint or `?v=2` query param.
- **Server-side graph construction** (`buildTrailGraphFromMapbox` running on backend). Stays on device. The envelope ships extractor outputs, not the graph. This keeps the app-side memory layout (TrailGraph kdbush etc.) unchanged.
- **Deletion of deprecated on-device files** (§3.3). Follow-up Sprint after one full release proves stability.
- **Real-time envelope updates** (e.g. websocket push when build completes). Client polls via 202-retry; no push channel.
- **Admin tooling** beyond `DELETE /api/routes/:id/edit-envelope` and `POST .../regenerate`. No UI; CLI/curl only.
- **Backfill of envelopes for existing routes**. New endpoint `POST /api/admin/envelopes/backfill` is out of scope; ops can run a one-shot script that walks `routes` and calls `enqueueBuild` for each, but writing/testing that script is not part of this Sprint.
