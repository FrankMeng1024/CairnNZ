# v399 Cold Review — Reviewer A

**Reviewer**: cold subagent (no implementation context from v398/v399 build)
**Scope**: plant-unlock fog hole regression. Two declared root causes (FogLayer single-point skip; reconcile wipes unsynced).
**Files audited**:
- `app/src/store/useMarkerStore.ts` (addMarker — v399 plant unlock fix at 259-315)
- `app/src/services/memorySync.ts` (reconcile branch fix at 227-259)
- `app/src/features/memory/components/FogLayer.tsx` (segmentByGap 85-133, buildFogShape 138-237)
- `app/src/features/memory/store/useMemoryStore.ts` (uuid, recordPoint, replacePoints, isExplored, buildBucketIndex)

**Verdict**: **NEEDS_FIX** — 4 problems found, 1 confirmed correct, 1 concern that is medium severity.

---

## Problem 1 — BLOCKER — `_bucketIndex: null` poisons `isExplored` callsites until next mutation

**Location**: `useMarkerStore.ts:298`

```ts
useMemoryStore.setState({
  points: newPoints,
  geometryVersion: state.geometryVersion + 1,
  _bucketIndex: null,        // ← cleared
  _unsyncedCount: state._unsyncedCount + planted.length,
});
```

`useMemoryStore.isExplored` (lines 391-410) checks `_bucketIndex` first; if non-null it uses bucket lookup, **otherwise it falls back to a linear scan**. So setting `_bucketIndex: null` does NOT break correctness — the next `isExplored` call will linearly scan all points (including the 3 planted ones). Functionally OK.

**However**: `recordPoint` (line 246) and `recordCircleUnlock` (line 295) both **expect** `_bucketIndex` to be incrementally maintained via `Map(get()._bucketIndex!)` clone-and-mutate. If a GPS-driven `recordPoint` fires immediately after a plant, it does:

```ts
const idx = get()._bucketIndex ? new Map(get()._bucketIndex!) : buildBucketIndex(points);
```

`points` at that moment includes the 3 planted points. `buildBucketIndex(points)` is run on the whole list. **Correct**, but expensive (O(N) at every GPS tick after plant until the bucket index is rebuilt). On a user with 5000+ visited points, this means a several-ms blocking scan inside a GPS callback path.

**Why it matters**: not a fog correctness bug, but a regression hazard on the watcher hot path. Sprint 12 had a regression of similar shape that caused jank during walks.

**Fix proposal**: rebuild the bucket index inline at plant time (cheap — done once, off the GPS path):
```ts
import { buildBucketIndex } ... // would need to export
_bucketIndex: buildBucketIndex(newPoints),
```
Or, simpler: replicate the `recordPoint` inline-update pattern (clone existing index, append 3 keys).

**Severity**: Medium → Blocker if a long-haul user reports plant-then-walk jank.

---

## Problem 2 — CRITICAL — H3 dual-write reads `state` snapshot taken BEFORE setState

**Location**: `useMarkerStore.ts:283-305`

```ts
const state = useMemoryStore.getState();
const newPoints = [...state.points, ...planted];
...
useMemoryStore.setState({ ... });
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { useH3VisitedStore } = require('../features/memory/store/useH3VisitedStore');
for (const p of planted) {
  useH3VisitedStore.getState().addPointToCells(p.lat, p.lng, p.ts);
}
```

This is correct **for the 3 plant points**, but contrast with the canonical `useMemoryStore.recordPoint` (line 265) and `replacePoints` (lines 565-583, with the deferred 100ms `setTimeout` + `h3.clear()` + `h3.bulkImport(snapshot)`).

**The hazard**: the dual-write timing in `addMarker` is **synchronous after setState**. `replacePoints` reset path is **asynchronous (100ms setTimeout, then clear, then re-import)**. If a `pullMemoryFromServer` reconcile is in flight and lands its `replacePoints` between the plant's `setState` and the H3 `addPointToCells`, the H3 store will be wiped by `h3.clear()` *after* the plant adds its 3 cells.

The timeline that breaks H3:
1. T+0: plant `setState` adds 3 points to `useMemoryStore`
2. T+10ms: server response → `replacePoints(merged, ...)` called
3. T+10ms: `replacePoints` calls `setTimeout(() => { h3.clear(); h3.bulkImport(snapshot); }, 100)`
4. T+11ms: plant code runs `h3.addPointToCells` for the 3 planted points
5. T+110ms: setTimeout fires → `h3.clear()` wipes everything including the plant cells, then re-imports the snapshot of `merged` (which has the 3 plant points because reconcile fix at memorySync.ts:256 keeps unsynced)

Actually this re-import path **saves us** if `merged` contains the planted points — which it does, per memorySync.ts:256 (`[...serverPoints, ...localUnsynced]`). So H3 is eventually consistent.

**But**: there is a 100-ms window where `useH3VisitedStore` is empty but `useMemoryStore` has 374 points. Any UI selector that depends on H3 (e.g. H3 fog mode toggle) will paint blank during this window. Since v346+ uses point-based fog by default (`useH3Fog` reads from settings — line 241), this is normally benign, but `useH3Fog: true` users would see flicker.

**Severity**: Medium. Documenting; the plant flow shouldn't worsen the existing race.

**Fix proposal**: gate the H3 update behind the same epoch check used in `memorySync.ts`, or skip H3 dual-write at plant time and rely on the next `replacePoints` to repopulate it.

---

## Problem 3 — BLOCKER — Centroid of the 3-point triangle is NOT at `data.lat/lng`

**User-cited reasoning #4 was right but understated**.

```ts
const dLat = 4.5e-5;        // ~5m north
const dLng = 4.5e-5 / cos(lat);  // ~5m east
const planted = [
  { lat: data.lat,         lng: data.lng         },  // center
  { lat: data.lat + dLat,  lng: data.lng         },  // 5m N
  { lat: data.lat,         lng: data.lng + dLng  },  // 5m E
];
```

These three points form a **right triangle with the right angle at `data.lat/lng`**.
- Centroid = (`data.lat + dLat/3`, `data.lng + dLng/3`) ≈ 1.67m NE of `data.lat/lng`
- `lineString([P0, P1, P2])` builds a polyline `P0→P1→P2`, which is `center→north→east`. That's an **L-shape**, not a triangle, because `lineString` does not close the ring.
- `turf.buffer(lineString, 25m, steps:16)` produces a **rounded-rectangle / capsule shape around the L**, with the corner at `P0`. The buffered region is asymmetric: the polygon extends ~25m beyond each endpoint (`P1` and `P2`) plus the 25m perpendicular offset around each segment.

**Visual outcome**:
- Plant location `data.lat/lng` is at the inside corner of the L → it is covered by the buffer (good)
- But the buffered region extends **further north (to 5m+25m = 30m N of plant) and further east (30m E of plant)** than it does south or west (25m S, 25m W)
- The fog hole is offset NE relative to the plant marker

**User's original requirement**: "mark 在中间因为以 mark 为中心解锁". The mark would be visually OFF-CENTER (toward the SW edge of the hole). For a 60m × 60m hole this is a ~5m visual offset — noticeable on a hiking map at z16.

**Fix proposal**: symmetric pattern around plant:
```ts
// Triangle with centroid at plant location:
const dLat = 4.5e-5;
const dLng = 4.5e-5 / cos(lat);
const planted = [
  { lat: data.lat + dLat,         lng: data.lng,                ts: ts,   cid: ..., synced: false },
  { lat: data.lat - dLat/2,       lng: data.lng - dLng*0.866,   ts: ts+1, cid: ..., synced: false },
  { lat: data.lat - dLat/2,       lng: data.lng + dLng*0.866,   ts: ts+2, cid: ..., synced: false },
];
```
This is an equilateral triangle centered exactly on `data.lat/lng`. Centroid coincides with the plant.

**Alternative**: just push a single point at `data.lat/lng` and fix the **real** root cause — see Problem 4.

**Severity**: Blocker on UX grounds (user will say "fog hole is not centered on my mark"). Not a functional regression but defeats the entire reason for the fix.

---

## Problem 4 — BLOCKER — The 3-point workaround is treating the symptom, not the root cause

The real root cause is in `FogLayer.tsx:160` (`if (seg.length < 2) continue`), but the chosen fix is in `useMarkerStore.ts`, which means:

1. **Every other code path that produces single-point segments will still silently drop the fog hole.** What about `recordCircleUnlock` for `requestedRadius <= pointSpacingM` (line 288)? That single-point branch will hit the same skip. Tested by reading line 294 — yes, single point insertion. Any first-time GPS reveal at small radius would also have no fog hole, if it ever results in a single segment.
2. **`segmentByGap` is structured to emit segments based on time gaps**. With HIKE_GAP_MS = 60 minutes (line 99), the 3 planted points (ts, ts+1, ts+2) will land in whatever segment the user was already building. If the user JUST opened the app and has zero prior points, they form their own segment — fine. But if the user planted RIGHT AFTER a long pause where the previous segment ended 65 minutes ago, the plant might be the first point of a new segment and the previous orphan single-point segment is still skipped silently.

**The deeper concern**: the user-reported failure happens on a fresh user planting their first mark. The 3-point hack works there because all 3 land in one segment. But the bug **inside FogLayer** is unfixed.

**Fix proposal**: in `FogLayer.tsx:160`, treat single-point segments as a circular buffer:
```ts
for (const seg of segments) {
  if (seg.length === 1) {
    // Single point — buffer a Point feature instead of a LineString.
    const [lng, lat] = seg[0];
    const pt = point([lng, lat]);
    const buf = bufferTurf(pt, CORRIDOR_WIDTH_M, { units: 'meters', steps: 16 });
    if (buf?.geometry) corridors.push(buf as Feature<Polygon | MultiPolygon>);
    continue;
  }
  if (seg.length < 2) continue;
  ...
}
```
With this fix, a single plant at `data.lat/lng` produces a perfectly-circular 25m fog hole centered on the mark. Problem 3 evaporates (no triangle math needed). Problem 1 evaporates (only 1 point inserted, lower memory impact). The 3-point workaround can be removed entirely.

**Why the user's proposed fix didn't choose this**: turf's `buffer` of a `Point` feature is well-documented and supported — there is no reason to avoid it. The 3-point triangle is a workaround that should not ship.

**Severity**: Blocker. The chosen fix works in the happy path but leaves the underlying bug in production, and any future code path that produces single-point segments (e.g. server pulling 1-point data for a partially-synced user) will trigger the same regression.

---

## Problem 5 — CRITICAL — Reconcile keeps unsynced forever; need TTL or "did we ever try to push?" check

User-cited reasoning #2 is correct. Walk through:

1. User plants → 3 unsynced points added to local
2. `memorySync.attachMemorySync` subscribes, sees `_unsyncedCount + 3`, calls `schedulePush(PUSH_DEBOUNCE_MS=5_000ms)`
3. 3 seconds after plant, `pullMemoryFromServer({reconcile:true})` fires (e.g. on map focus refresh)
4. Reconcile branch: `localUnsynced = local.filter(p => !p.synced)` → 3 plant points kept; merged with server's 371
5. `replacePoints(merged)` — 374 points in store
6. T+5s: `pushPendingPoints` actually runs. POSTs the 3 plant points. Server responds with cids. `applyServerEchoForPushAligned` flips them `synced: true`.
7. ✓ Works correctly

**But the failure mode**: what if the **server rejected the plant point** (e.g. 400 because lat/lng out of range, or duplicate-cid 409, or the user authenticated with a different account)?

- `pushPendingPoints` line 360: if `res.ok` is false and not 5xx/401, it does **nothing** — the point stays `synced: false` forever
- `applyServerEchoForPushAligned` is only called if `res.ok` (line 354) — so synced never flips
- Every subsequent reconcile keeps those points forever
- Eventually the user can have hundreds of zombie unsynced points that the server has explicitly rejected

**Severity**: Critical. Storage bloat + sync churn. Not a regression from v399 — pre-existing — but the v399 reconcile-keep-unsynced change makes the symptom **invisible** (point looks visited locally, fog hole appears, server says "nope" but user never finds out).

**Fix proposal**: add a "last push attempt + outcome" field to `VisitedPoint`. If `lastPushAttempt > N` attempts ago and `lastPushOutcome === 'rejected'`, drop the point on next reconcile. Or, simpler: log when this happens via `bootDiagnostics` so we can detect it in production.

---

## Problem 6 — MEDIUM — `synced=false` for plant points means `_unsyncedCount` grows without bound if push never lands

User-cited reasoning #5. Looking at the existing `recordCircleUnlock` large-radius branch (line 349):
```ts
newPoints.push({ lat: pLat, lng: pLng, ts, cid: uuidv4(), synced: true });
```
**Initial reveal points are flagged `synced: true`** because they are CLIENT-DERIVED (R-round B4 fix comment, line 327). They don't need server roundtrip.

**A plant is server-authoritative** — `useMarkerStore.addMarker` does POST `/api/markers`. But the corresponding memory point (the fog hole for the mark's location) is a CLIENT-DERIVED unlock — it doesn't need to be a memory_points server row. The walking-unlock GPS points need server sync for cross-device. A plant's fog ring is derived from the mark location, which IS on the server.

**Therefore**: the 3 plant points should be `synced: true`, not `synced: false`. Like `recordCircleUnlock`'s initial reveal hex grid (line 349).

**Outcome of this fix**:
- No reconcile-keeps-unsynced issue (Problem 5 attenuated)
- No `_unsyncedCount` growth from plants
- Plant fog still works because they exist in local store
- On reinstall, plants will reappear because `useMarkerStore.loadFromBackend()` repopulates marks; if those marks should trigger fog holes, the existing v380 "plant unlocks memory" code path runs again

**Caveat**: this only works if the plant→fog-unlock relationship is regenerable from marks. Currently `addMarker` is the SOLE producer of these specific memory points (no other code creates fog holes from marker data). On a fresh install, `loadFromBackend()` loads marks but doesn't call `addMarker` again, so the fog rings would NOT regenerate from cloud data.

**Trade-off**: choose one:
- (A) Plant points are `synced: true` (won't sync) — fog rings lost on reinstall, but `_unsyncedCount` clean
- (B) Plant points are `synced: false` (will sync) — fog rings durable across devices, but Problem 5 risk

**Recommendation**: option (A) + add a one-time hydrate hook that calls "create fog hole at mark.lat/lng for every loaded mark with permission=personal", to make plant fog rings durable without server roundtrip. Defer this to a follow-up Sprint; for v399 keep `synced: false` and accept Problem 5 as known limitation.

---

## Confirmed correct (user's worry #1)

3 points in a connected segment + `turf.buffer(lineString, 25m, steps:16)`:
- `segmentByGap` will group ts, ts+1, ts+2 into one segment (60min gap threshold; 1ms intervals are trivially under that)
- `lineString([[lng0,lat0],[lng1,lat1],[lng2,lat2]])` is valid (≥2 points required → 3 satisfies)
- `simplifyTurf` with tolerance 5/111320° (~5m) might collapse 1ms-apart points to single point? Let me check: tolerance is 4.49e-5°, our offset is exactly 4.5e-5°, so **borderline**. Simplify might drop P1 or P2. Wrapped in try/catch fallback to unsimplified line (line 171) — so even if simplify fails or collapses, the unsimplified 3-point line is used.
  - **Subtle**: if simplify SUCCEEDS but reduces to 2 points (drops the corner), the resulting buffered shape changes from L-buffer to straight-segment-buffer. Visual outcome differs slightly. Verify by running locally; not a blocker but a tolerance edge case.
- `turf.buffer` of a 2-3 point line with 25m radius and 16 steps produces a polygon-with-no-holes (~64 vertices around the perimeter); does NOT produce a MultiPolygon. So the `corridors` array gets one Polygon feature per plant call.

✓ Geometry will produce a real visible hole. User worry #1 is unfounded.

---

## Verdict: **NEEDS_FIX**

**Must fix before OTA**:
- **Problem 3** (centroid offset → mark visually off-center) — user-visible regression on the primary metric the user complained about
- **Problem 4** (single-point skip in FogLayer is the real root cause; fix should live there, not be worked around in plant code)

**Should fix in v399 or v400**:
- **Problem 1** (bucket index invalidation cost)
- **Problem 5** (rejected plants become zombie unsynced points)

**Defer to backlog**:
- **Problem 2** (H3 race during reconcile — pre-existing, plant didn't make it worse)
- **Problem 6** (plant memory points sync policy — needs product decision)

**Recommended minimum action**:
1. Move the fix from `useMarkerStore.ts:259-315` into `FogLayer.tsx:160` (handle `seg.length === 1` case with `point()` + `bufferTurf`)
2. Replace the 3-point insertion with a single-point insertion at `data.lat/lng`
3. Bump version to v400, run aliyun fog.shape_built log validation showing `n_points: 1, has_holes: True` at plant time
4. Open backlog Stories for Problems 1, 5

**Aliyun log evidence to verify fix**:
After fix, `addmarker_enter` → `fog.shape_built ctx={n_points: M+1, has_holes: True}` (where M = prior point count). Currently v399 will show `n_points: M+3, has_holes: True` with an asymmetric buffered L-shape.
