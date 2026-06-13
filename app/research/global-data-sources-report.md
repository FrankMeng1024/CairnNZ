# Global Data Sources for Route Edit Nodes — Research Report

**Date**: 2026-06-10
**Scope**: Cairn v200 node-based route editor; non-NZ regions (current DOC-only path returns trailGraph=null outside NZ).
**Existing assets**: `@rnmapbox/maps@10.3.1`, `kdbush@4.1.0`, `TrailGraph.ts` (densify + union-find junction merge), `DOCTrailsClient.ts` (ArcGIS NZ DOC).

---

## TL;DR Recommendation

**Adopt OSM Overpass API as the global default trail data source.** It is the only option that gives:
1. Worldwide coverage (including Shanghai parks, European Alps, US national forests)
2. **Native junction-degree filter** (`node(way_cnt:3-)` returns intersection nodes directly — no client-side computation needed)
3. Free, no API key, no GPS-upload privacy concern (only bbox sent)
4. Same GeoJSON-ish output shape as DOC → drop-in replacement for `DOCTrailFeature[]`
5. OTA-deployable in a single Sprint (no native modules; just `fetch` + JSON parse)

**Keep DOC as NZ-region enhancement**, not as primary source. DOC has higher fidelity (track grades, alerts, hut-tied metadata), but it's redundant with OSM for the node-graph use case. Layer DOC over OSM only inside NZ bbox.

**Mapbox APIs are NOT recommended for the primary node extraction path.** Tilequery is point-based (bad for polyline corridors — would need O(N) requests per route), Map Matching gives a snapped polyline but no graph topology, and both consume your paid quota for data Overpass returns free. Mapbox is still useful for one specific role: **Map Matching as a pre-pass** to clean up noisy GPS traces before bbox calculation (already in your subscription).

---

## 1. Data Source Comparison

### 1.1 OpenStreetMap Overpass API ★ RECOMMENDED PRIMARY

**Endpoint**: `https://overpass-api.de/api/interpreter` (POST or GET with `data=` parameter)
**Mirrors**: `overpass.kumi.systems`, `overpass.openstreetmap.fr` (load-balance for resilience)

| Dimension | Detail |
|---|---|
| Global coverage | Yes. OSM is worldwide. Quality varies — see §2. |
| Topology | Yes. Returns ways + nodes; `node(way_cnt:3-)` filter returns junction nodes natively. |
| Cost | Free. No API key. |
| Rate limit | Fair-use: ~10K queries/day per IP, 2 parallel slots, query timeout default 180s. Public servers throttle by load score; `[timeout:25]` recommended per query. |
| Privacy | Only bbox is sent. No user GPS leaves device until bbox is computed. |
| RN/iOS friendliness | Pure HTTP+JSON. No SDK needed. Works with built-in `fetch`. |
| Offline | Possible via tile pre-cache or pbf extract (out of scope for v1). |

**Killer feature — native junction filter (Overpass QL)**:
```
[out:json][timeout:25];
(
  way["highway"~"^(path|footway|track|cycleway|bridleway|steps|pedestrian)$"]
    (around:50, {trace_lat_lng_list});
);
node(w)->.allnodes;        // every node touched by these ways
node.allnodes(way_cnt:3-); // nodes in 3+ ways = junctions
out body;
>;
out skel qt;
```

The `way_cnt:3-` recurse is documented at `wiki.openstreetmap.org/wiki/Overpass_API/Overpass_QL` and is implemented server-side. You don't need the slow `foreach` pattern from older docs — that's the legacy approach. With `way_cnt`, junction extraction is O(1) wall time per query for typical routes.

**For Cairn specifically**: a route's bbox is small (typically <50 km²). Overpass returns this in <5s. Cache by bbox-hash to reuse across edits.

**Hiking-relevant `highway=*` values to query**: `path` (default OSM hiking trail tag), `footway`, `track` (forestry/farm tracks often used as trails), `bridleway`, `steps`, `pedestrian`, `cycleway`. `route=hiking` on relations adds curated long trails (PCT, Te Araroa, etc.) but is a relation, not a way, so layer it separately if you want the named-trail label.

### 1.2 Mapbox Map Matching API ★ KEEP for GPS cleanup, NOT for node extraction

**Endpoint**: `https://api.mapbox.com/matching/v5/{profile}/{coordinates}.json`
**Profile for hiking**: `mapbox/walking` (also handles hiking per Mapbox docs).

| Dimension | Detail |
|---|---|
| Global coverage | Yes (uses Mapbox-curated streets, which incorporate OSM). |
| Topology | **No.** Returns matched polyline + tracepoint indices. No junction graph. |
| Coordinate limit | **2–100 coordinates per request.** Routes longer than 100 GPS points must be batched. |
| Radius param | 0–50m snap distance. |
| Cost | Free tier 100,000 req/mo (Mapbox standard for navigation APIs). Already in your subscription. |
| Privacy | GPS coordinates are uploaded to Mapbox. |
| RN | Plain HTTP — works today. |

**Why not for node extraction**: response gives you `tracepoints[]` with `name` (street/path name) and `location`, but no edge/junction structure. You'd need a second API call (vector tiles) to discover where one path ends and another begins.

**Where it IS useful**: noisy GPS → clean snapped polyline → tighter bbox for Overpass query. Reduces Overpass query cost and avoids querying paths the user wasn't actually on.

### 1.3 Mapbox Tilequery API ★ NOT RECOMMENDED for this use case

**Endpoint**: `GET /v4/{tileset_id}/tilequery/{lon},{lat}.json` (e.g. `mapbox.mapbox-streets-v8`)

| Dimension | Detail |
|---|---|
| Global coverage | Yes. |
| Topology | Partial. `road` layer has `class` (`path`, `track`, `pedestrian`, `motorway`...) and `type` (`hiking`, `footway`, `trail`...). But: **point query only — no graph edges/junctions returned**. |
| Cost | Free tier ~100K req/mo, then per-request. Rate limit 600 req/min. |
| Coordinate model | One lon/lat per request, optional `radius` (max ~1000m), `limit`, `layers`, `geometry`. |
| Junction layer | `motorway_junction` exists but is **highway interchanges only** (freeway exits) — NOT useful for hiking trail forks. |

**Why it fails**: to identify junctions along a 5km route, you'd need ~50 point queries (one every ~100m) and then post-process for ways crossing — which is exactly what Overpass returns in one query.

### 1.4 Mapbox Vector Tiles (raw .pbf) — Power-user option

**Endpoint**: `https://api.mapbox.com/v4/mapbox.mapbox-streets-v8/{z}/{x}/{y}.vector.pbf`

| Dimension | Detail |
|---|---|
| Global coverage | Yes. |
| Topology | Tile-bounded. Each tile carries a `road` layer with `class`/`type`; junctions must be computed client-side from way intersections (same algorithm you'd write against OSM). |
| Cost | Tile requests count against Map Loads in your existing Mapbox subscription — usually free if @rnmapbox/maps is already rendering them. |
| Decoding on RN | `@mapbox/vector-tile` + `pbf` are pure-JS but pull in protobuf decoding (~80KB). Doable but heavier than the Overpass JSON path. |
| Offline | Yes — tiles are cached by `@rnmapbox/maps` already. **Best path for offline-mode editing.** |

**When to use**: Sprint 2+, after OSM Overpass v1 ships. Best for offline scenarios where the user already has tiles cached for the route bbox.

### 1.5 Google Roads API — NOT RECOMMENDED

`https://roads.googleapis.com/v1/snapToRoads` — same shape as Map Matching, no junction graph, requires Google Cloud billing account, unfavorable pricing (~$10/1K requests after free tier per Google Maps Platform pricing model). No advantage over Mapbox for this use case.

### 1.6 HERE Maps API — NOT RECOMMENDED

Pedestrian routing exists, but no public "snap polyline → junctions" primitive without Premium plan. Hiking trail data inferior to OSM in mountainous regions (HERE optimizes for road/urban).

### 1.7 OpenRouteService / GraphHopper — Honorable mention

Both are OSM-based hosted routing engines. ORS free tier is 2,000 req/day with API key. Both can return turn-by-turn instructions with junction names, but exposing raw graph topology is awkward. **Not better than going direct to Overpass** for this use case, and both add per-query cost that Overpass doesn't.

---

## 2. OSM Hiking Trail Coverage by Region

| Region | Trail tag density (qualitative) | Expected Cairn UX |
|---|---|---|
| Western Europe (Alps, Dolomites, Pyrenees) | Excellent. CAI/SAC trail markings tagged. | Best-case node graph, dense junctions. |
| US national forests / national parks | Very good for popular areas (PCT, JMT, AT all complete in OSM). | Comparable to AllTrails. |
| New Zealand | Good. DOC tracks present in OSM but with less metadata than the DOC ArcGIS source — that's why we keep DOC for NZ. | OSM-only is functional; OSM+DOC is better. |
| Japan, South Korea | Very good in popular hiking zones. | Good. |
| **China (incl. Shanghai)** | **Mixed.** Urban parks: well-mapped (Century Park, Gucun Park have `highway=path` networks). Rural mountain trails: sparse outside major peaks (Huangshan, Tai Shan are mapped). Note: OSM China data has known quality issues from CSDN reports (台湾省 sometimes excluded from "China" boundary queries). | OK for city/park routes; limited for backcountry. |
| South America (Patagonia, Andes) | Sparse outside Torres del Paine, Machu Picchu corridors. | Acceptable for popular routes; node graph may collapse to endpoints-only on obscure trails. |
| Sub-Saharan Africa | Sparse except Kilimanjaro, Drakensberg. | Endpoints-only fallback common. |

**Implication for Cairn**: when Overpass returns 0 ways for a route, fall back to "endpoints only" (current behavior when DOC returns nothing). Show a UI hint: "节点编辑在此区域受限 — OSM trail data sparse here." This is honest and doesn't pretend node graphs exist where they don't.

---

## 3. From GPS Trace to Junctions — Algorithm

The existing `TrailGraph.ts` already implements densify (10m) + kdbush + union-find merge (30m threshold) on `DOCTrailFeature[]`. **Reuse it as-is by adapting the input shape.** The new flow:

```
GPS trackPoints (LngLat[])
  │
  ├── (optional) Mapbox Map Matching (mapbox/walking, batched 100 pts/req)
  │     → cleaned polyline
  │
  ├── compute bbox + 50m buffer
  │
  ├── Overpass query:
  │     way[highway~"path|footway|track|..."](bbox);
  │     node(w)(way_cnt:3-);
  │     out;
  │
  ├── parse JSON → OsmTrailFeature[] (same shape as DOCTrailFeature)
  │     features[].geometry = LineString from way nodes
  │     features[].properties.id = way.id
  │     junction nodes ship as Point features OR are re-derived from union-find
  │
  ├── TrailGraph.fromTrails(osmFeatures) ← unchanged
  │     produces nodes + edges + junction merge
  │
  └── route node anchors = TrailGraph nodes ∩ corridor around route polyline
        (existing routeNodeAnchors.ts logic, unchanged)
```

**Two valid strategies for junction nodes**:

- **(A) Trust Overpass `way_cnt:3-`** — server returns junction nodes directly. Simpler, fewer client lines. Single source of truth.
- **(B) Reconstruct via existing union-find** — let `TrailGraph` compute junctions from way endpoints. Matches current code path. Resilient if Overpass doesn't return `way_cnt` filter result for any reason.

Recommend **(A) primary, (B) fallback** — request both in one Overpass query, prefer A if non-empty.

**Does Mapbox Map Matching add value as a pre-pass?**
- Pro: tightens bbox (cheaper Overpass), filters GPS noise.
- Con: 2 API hops; Map Matching limit of 100 coords forces batching; for routes already saved with reasonable GPS quality, the pre-pass is overkill.
- **Verdict**: skip it for v1. Add later if Overpass returns too many irrelevant ways for noisy traces.

---

## 4. Hybrid Strategy Recommendation

```
                 ┌─ NZ bbox? ─yes─→ DOCTrailsClient (existing) ─┐
GPS trackPoints ─┤                                              ├→ merge → TrailGraph
                 └─ always       → OverpassTrailsClient (new) ──┘
```

**Rules**:
1. **OSM Overpass is always called** — it's the global baseline.
2. **DOC layered when route bbox intersects NZ bbox** (~166–179°E, –47–-34°S). Provides higher-fidelity track grades and DOC-curated metadata.
3. **De-duplicate** by spatial proximity: when DOC and OSM both have a feature within 30m, prefer DOC's metadata (track grade, name) but keep OSM's geometry (usually more vertices, better densification).
4. **Caching**: bbox-keyed cache (already exists for DOC at `DOCTrailsCache.ts`). Same TTL strategy works for OSM. Consider 24h TTL — trail networks rarely change.
5. **Offline mode**: out of scope for v1. v2 path = pre-cache Mapbox vector tiles + Overpass JSON snapshots inside the route's saved bbox at trip-start time.
6. **Cost control**: per-route, expect 1 Overpass call (free) + 0 Mapbox calls (unless Map Matching pre-pass enabled). Per-edit-session, the cache hit means 0 calls. Cost is negligible.

**Urban routes vs mountain trails**: same pipeline works. The `highway=*` filter naturally captures both — `path` and `footway` for parks, `track` and `path` for backcountry, `pedestrian` for plazas.

---

## 5. Sprint-1 Path — OTA Only, No Native Build

**Adds zero native modules.** Pure JS additions. Ships as OTA update.

### 5.1 New file: `src/services/routing/osmtrails/OverpassTrailsClient.ts`

Mirrors the existing `DOCTrailsClient.ts` shape. Pure `fetch` + JSON parse.

```ts
// Pseudocode shape — actual implementation in Sprint 1 Story
interface OsmTrailFeature {
  id: string;
  geometry: { type: 'LineString'; coordinates: [number, number][] };
  properties: {
    osm_id: number;
    highway: string;          // 'path' | 'footway' | 'track' | ...
    name?: string;
    sac_scale?: string;       // hiking difficulty
    surface?: string;
  };
}

interface OsmJunctionNode {
  id: string;
  lng: number;
  lat: number;
  way_count: number;          // 3+ from way_cnt filter
}

async function fetchOsmTrailsForBbox(bbox: [w,s,e,n]): Promise<{
  trails: OsmTrailFeature[];
  junctions: OsmJunctionNode[];
}> {
  const ql = `
    [out:json][timeout:25];
    (
      way["highway"~"^(path|footway|track|cycleway|bridleway|steps|pedestrian)$"]
        (${bbox[1]},${bbox[0]},${bbox[3]},${bbox[2]});
    )->.ways;
    .ways out geom;
    node(w.ways)(way_cnt:3-);
    out body;
  `;
  const res = await fetch('https://overpass-api.de/api/interpreter', {
    method: 'POST',
    body: 'data=' + encodeURIComponent(ql),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });
  // parse Overpass JSON: elements[] split by type ('way' | 'node')
  // map ways → OsmTrailFeature, nodes → OsmJunctionNode
  // ...
}
```

### 5.2 Adapter: `OsmTrailFeature` → existing `DOCTrailFeature` shape

`TrailGraph.fromTrails` is parametrized on the feature interface. Either widen its type to a common `TrailFeature` union, or write a thin adapter `osmToTrailFeature()`. **Adapter is preferred** — keeps DOC code untouched.

### 5.3 Wire-up in `editContext.ts` (or wherever DOC is currently called)

```ts
const doc = await DOCTrailsClient.fetchForBbox(bbox);    // existing
const osm = await OverpassTrailsClient.fetchForBbox(bbox); // new
const merged = mergeTrails(doc, osm); // dedupe by 30m proximity
const graph = TrailGraph.fromTrails(merged);
```

### 5.4 No new dependencies needed

- `kdbush@4.1.0` ✓ already installed
- `fetch` ✓ React Native built-in
- **NOT needed**: `osmtogeojson` (Overpass's `out geom;` already returns GeoJSON-shaped coords; light hand-parse is ~30 lines), `overpass-frontend` (WebSocket-oriented, not RN-friendly), `@mapbox/vector-tile` + `pbf` (only if going the Vector Tile route — defer to v2).

### 5.5 Effort estimate

- OverpassTrailsClient: ~150 LOC (mirrors DOCTrailsClient)
- Adapter + dedupe: ~80 LOC
- Tests: ~200 LOC (mirror existing test patterns, mock fetch)
- Wiring + UI fallback message: ~50 LOC

**Total ~500 LOC, 1 Sprint, OTA-eligible (no Xcode/Gradle changes).**

---

## 6. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Public Overpass server throttle/down | Multi-mirror failover (`overpass-api.de`, `overpass.kumi.systems`); cache aggressively (24h); circuit-breaker shows endpoints-only mode if all mirrors fail. |
| OSM data sparse in some regions | Honest UI: "限制编辑节点 — 此区域路网数据稀疏". Always show endpoints. |
| Overpass returns too many ways (urban dense areas) | Cap query result size with `[maxsize:33554432]` (32MB); limit `highway` types per region (e.g. drop `pedestrian` for backcountry); filter post-fetch by distance to route polyline. |
| Mapbox Map Matching coord limit (100) | Skip Map Matching for v1. If added later, batch with overlapping windows. |
| OSM tag drift (someone retags `path`→`footway`) | Filter is regex `(path|footway|...)` — covers both. Re-evaluate quarterly. |
| Privacy concern (bbox upload) | Document in privacy policy. Bbox alone reveals city-level location only; not user identity. Cleaner than Map Matching which uploads exact GPS. |

---

## 7. Decision Matrix

| Criterion | Overpass | Mapbox Tilequery | Mapbox Vector Tile | Map Matching | DOC (current) |
|---|---|---|---|---|---|
| Global | ✓ | ✓ | ✓ | ✓ | ✗ NZ-only |
| Junction graph natively | ✓ | ✗ | partial (compute) | ✗ | ✓ |
| Free | ✓ | partial | partial | partial | ✓ |
| OTA-only ship | ✓ | ✓ | with libs | ✓ | ✓ |
| Privacy (no GPS upload) | ✓ bbox-only | bbox-only | tiles only | ✗ | ✓ |
| Offline-capable | future | ✗ | ✓ | ✗ | cache-only |
| Rich metadata | sac_scale, surface | class/type | class/type | name only | grade, alerts |

---

## 8. Final Recommendation

**Sprint 1 (OTA)**: ship `OverpassTrailsClient` as global default. Keep DOC active for NZ bbox. Single new file + wire-up. Done in one Sprint.

**Sprint 2+ (only if v1 reveals issues)**:
- Add Mapbox Map Matching pre-pass for noisy GPS traces.
- Add Mapbox Vector Tile offline path for in-trip editing without signal.
- Consider self-hosted Overpass mirror if usage grows past public-server fair-use comfort zone (a single $20/mo VPS can host an extract for one continent).

**Do NOT** invest in: Google Roads API, HERE Maps, GraphHopper hosted, OpenRouteService, Mapbox Tilequery for this use case.

---

## Sources

- Mapbox Tilequery API docs (via context7 `/websites/mapbox`): `docs.mapbox.com/api/maps/tilequery` — confirmed endpoint `/v4/{tileset_id}/tilequery/{lon},{lat}.json`, 600 req/min rate limit, request-billed.
- Mapbox Map Matching API docs (via context7): `docs.mapbox.com/api/navigation/map-matching` — confirmed `/matching/v5/{profile}/{coordinates}` endpoint, 2-100 coord limit, `mapbox/walking` profile for hiking, `radiuses` 0-50m.
- Mapbox Streets v8 reference (via context7): `docs.mapbox.com/vector-tiles/reference/mapbox-streets-v8` — confirmed `road` layer `class` includes `path`, `track`, `pedestrian`; `path` types include `hiking`, `trail`, `footway`, `bridleway`, `steps`. `motorway_junction` layer is highway-interchanges-only (NOT for hiking).
- Overpass API wiki (via context7 `/websites/wiki_openstreetmap_wiki_overpass_api`): `wiki.openstreetmap.org/wiki/Overpass_API/Overpass_QL` — confirmed `node(way_cnt:3-)` filter for junction-degree extraction, `[timeout:N][maxsize:N]` resource controls, fair-use rate limit policy.
- Local code inspection: `C:/ClaudeCodeProjects/Cairn/app/src/services/routing/graph/TrailGraph.ts` (densify+kdbush+union-find pipeline already implemented), `C:/ClaudeCodeProjects/Cairn/app/src/services/routing/doctrails/DOCTrailsClient.ts` (NZ DOC current source), `C:/ClaudeCodeProjects/Cairn/app/package.json` (kdbush 4.1.0, @rnmapbox/maps 10.3.1 confirmed; no @mapbox/vector-tile or pbf installed).
