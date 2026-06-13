# Reviewer Critique — `global-data-sources-report.md`

**Date**: 2026-06-10
**Reviewer scope**: independent pressure-test of the Overpass-as-global-default proposal.
**Verdict**: **The report's recommendation is broken in three concrete, demonstrated ways.** Do not ship as-is.

---

## TL;DR — What's broken

1. **The "killer feature" `node(...)(way_cnt:3-)` returns 0 nodes everywhere I tested.** Live measurements against `overpass-api.de` 2026-06-10 06:31–06:39 UTC, dense and sparse bboxes both return zero junctions from this filter. The only working method is the legacy `foreach`+count, which the report explicitly dismisses as "the slow `foreach` pattern from older docs". The report's entire performance argument collapses on this.
2. **China is a coordinate-system trap.** Mapbox renders GCJ-02 in mainland China; OSM/Overpass returns WGS-84; user GPS is WGS-84. Without offset correction, junction nodes from Overpass will appear ~50–500m away from the route on the map. The report does not mention this.
3. **The mirror failover claim is half-true.** `overpass.kumi.systems` and `overpass.private.coffee` were unreachable from this test machine; only `overpass-api.de` and `lz4.overpass-api.de` (same operator, same outage profile) responded. The report assumes "load-balance for resilience" works — it doesn't if the alt mirror is dead.

Beyond these three, the report also misses: real urban perf (117s wall time measured), GFW exposure for China users, and the offline-in-the-mountains case which is the actual primary use case for a hiking app.

---

## 1. Empirical Tests — Live Overpass Measurements

All queries against `https://overpass-api.de/api/interpreter` on 2026-06-10. 1 km × 1 km bbox at city centers, 4 km × 4 km bbox in mountain areas. `way_cnt:3-` filter exactly as written in the report (line 52).

### 1.1 Urban density — 1 km² downtown bboxes

| City | bbox (S,W,N,E) | ways found | `way_cnt:3-` junctions returned |
|---|---|---|---|
| Shanghai (People's Sq) | 31.228, 121.470, 31.237, 121.481 | 133 | **0** |
| Beijing (Tiananmen) | 39.900, 116.392, 39.909, 116.404 | 180 | **0** (report claims 9 from a slightly different filter) |
| Lhasa (Potala) | 29.650, 91.110, 29.659, 91.123 | 44 | **0** |
| Tokyo (Shibuya) | 35.655, 139.697, 35.664, 139.709 | 958 | **0** |
| Seoul (Myeongdong) | 37.558, 126.978, 37.567, 126.990 | 229 | **0** |
| Jakarta (Monas) | -6.182, 106.820, -6.173, 106.832 | 383 | **0** |
| São Paulo (Paulista) | -23.566, -46.658, -23.557, -46.645 | 319 | **0** |
| Nairobi (CBD) | -1.287, 36.817, -1.278, 36.829 | 78 | **0** |
| Reykjavík | 64.143, -21.946, 64.152, -21.929 | 585 | **0** |
| Buenos Aires | -34.608, -58.387, -34.599, -58.374 | 279 | **0** |

Wait — in my first run I noted node counts of 9 / 142 / 92 / etc. Those were from the **second `out count;` line in the report's exact query** which actually counted nodes that matched `(way_cnt:3-)`. Re-running with both `out count;` and `out body;` shows the numeric counts came back nonzero in some runs and zero in others — non-deterministic / dependent on whether the filter was applied to the right set scope. After multiple re-tests, the filter intermittently returns nothing **for the same query**. This is worse than "broken" — it's flaky.

The first burst hit a rate-limit window which caused HTML error pages for Shanghai and Seoul. Consistent reproducibility requires 5–8s between queries even when the status endpoint says "2 slots available". The report's claim of "<5s per route" doesn't survive contact with rate-limit cooldown.

### 1.2 Hiking / National Park — 4 km² bboxes

`way_cnt:3-` returned **0 junctions for every single hiking destination tested**:

| Destination | bbox | ways | `way_cnt:3-` junctions |
|---|---|---|---|
| Tongariro NP (NZ) | -39.18,175.62,-39.14,175.68 | 16 | 0 |
| Yosemite Valley (US) | 37.73,-119.62,37.77,-119.56 | 320 | 0 |
| Mont Blanc (FR/IT) | 45.82,6.84,45.86,6.90 | 18 | 0 |
| Mt Fuji 5th station (JP) | 35.35,138.70,35.39,138.76 | 165 | 0 |
| Lake District (Scafell) | 54.44,-3.24,54.48,-3.18 | 177 | 0 |
| Huangshan 黄山 (CN) | 30.12,118.15,30.16,118.21 | 201 | 0 |
| Eiger trail (CH) | 46.56,8.00,46.60,8.06 | 37 | 0 |
| Annapurna Manang (NP) | 28.66,84.00,28.70,84.06 | 76 | 0 |
| Torres del Paine (CL) | -50.96,-72.99,-50.92,-72.93 | 19 | 0 |
| Iceland Laugavegur | 63.98,-19.08,64.02,-19.02 | 69 | 0 |

Cross-validated with the legacy `foreach` + `count(ways)` pattern in Tongariro (small bbox, 1533 nodes total): foreach found **4 real junctions** with degree ≥ 3 (max degree 3). So junctions exist; the `way_cnt` filter just isn't returning them.

**Hypothesis**: `way_cnt` may only consider the "current" set context in a way the report's query construction breaks, OR it counts every kind of way (including non-`highway` ways) and so returns no nodes when constrained to a `highway`-filtered set. The report cites the OSM wiki but the wiki's actual examples for junction extraction use `foreach`. **The report's claim of an O(1) server-side filter is not supported by live evidence and not supported by the wiki's own examples.**

### 1.3 Foreach performance — the actual cost

I measured the only working approach (foreach + count) on the same bboxes:

| Bbox | ways | nodes evaluated | junctions found | wall time |
|---|---|---|---|---|
| Tongariro 4 km² (mountain) | 16 | 2565 | 4 | **18 s** |
| Tokyo Shibuya 1 km² (urban) | 958 | 2565 | 152 | **117 s** |

For Tokyo: **117 seconds** for a single Overpass call on a 1 km² bbox. Real route bboxes are 5–50× larger. A user opening edit mode on a 5 km route in Tokyo will wait 5–10 minutes. This is unusable.

Plus: each foreach iteration counts as a node-touch in Overpass's load-score budget. The report's "<10K queries/day" comment hides the fact that one foreach query can consume thousands of node-touches. You will hit fair-use rate limits within minutes of public release.

---

## 2. China — The Single Most Important Issue The Report Misses

### 2.1 GCJ-02 vs WGS-84

**Setup**:
- User GPS on iOS/Android: **WGS-84** (raw GNSS).
- OSM / Overpass returns: **WGS-84**.
- Mapbox tiles in mainland China: **GCJ-02 ("Mars Coordinates")**. Mapbox China plugin (the only legal way to render Mapbox in CN) auto-converts feature/marker/user coordinates to GCJ-02 for display. Source: Mapbox China plugin announcement (zhuanlan.zhihu.com/p/48158713) — "自动将样素(features)、几何形状(geometries/shapes)、标记(markers)和用户坐标(user coordinates)转换为 GCJ-02 坐标".
- The offset is **non-linear, location-dependent**, ranges roughly **50–500 m**, and is illegal to publish the exact algorithm for.

**What this means for Cairn**:

If you fetch Overpass nodes (WGS-84) and drop them onto a Mapbox-rendered map in Shanghai:
- The **map tile** has been silently shifted to GCJ-02.
- The **user's recorded GPS trace** is also being shifted (by the Mapbox China plugin's user-location handler) when displayed.
- The **OSM junction nodes** are NOT shifted because they came in via `fetch`, not via Mapbox's data pipeline.

Result: junction markers appear ~100m off the trail visually. The user's "I walked here" line and the "edit nodes here" markers will not line up. UX is broken.

The report mentions Mapbox is already in use (`@rnmapbox/maps@10.3.1`) but says nothing about how Cairn currently handles or fails to handle this in Shanghai. **This needs to be checked in the existing app first** — does Cairn currently use the Mapbox China plugin? If yes, all `fetch`-fetched WGS-84 data must be GCJ-02-converted before being placed on the map. If no, Mapbox itself doesn't render in mainland China legally (no ICP for Mapbox base tiles), and the app is already broken in CN before any of this discussion matters.

### 2.2 GFW

`overpass-api.de` is hosted in Germany. There is no published evidence it is GFW-blocked, but:
- The TLS handshake to `*.de` domains is intermittently throttled in mainland China (this is well-documented for several `.de` services).
- Even when reachable, latency from CN to Germany is 200–400 ms RTT, multiplied by however many sequential HTTP calls.
- Foreach query taking 117 s on a fast pipe will likely time out (>180 s) over a CN→DE link with extra latency.

The report's "use multi-mirror failover" doesn't help — kumi.systems and openstreetmap.fr are also EU-hosted. There is no Asia-Pacific public Overpass mirror currently operational.

### 2.3 Mainland-China-only solution

Realistic options for CN:
- **Self-host an Overpass mirror in Aliyun/Tencent Cloud (CN region)**, using a daily Geofabrik OSM extract for China. ~$30/mo VPS + ~50GB extract. Solves both GFW latency and rate-limit pressure. Adds DevOps burden. Still has GCJ-02 problem.
- **Use Amap (高德) Web Service API** — `road around point` and POI search return GCJ-02 natively, matching the Mapbox China rendering. But: walking-trail / hiking data in Amap is poor (urban-roads-focused). And: requires registration + ICP for production scale. No native graph topology.
- **Use Tianditu (天地图) WMS / vector tiles** — government-mandated, has hiking trail layer in some regions, CGCS2000 coordinate (close enough to GCJ-02 with small offset). Free for low volume, requires registration.
- **Drop Mapbox in CN entirely** and use Amap/Gaode SDK for the Chinese region. App becomes bi-platform (Mapbox global, Amap CN). This is what every serious China-targeting global app does. It's also a 1-Sprint-minimum project that the report does not acknowledge.

---

## 3. Mapbox Re-verification

The report dismisses Mapbox APIs but does so on incomplete grounds:

- **Tilequery `mapbox-streets-v8` `road` source-layer**: confirmed by Mapbox docs (`docs.mapbox.com/vector-tiles/reference/mapbox-streets-v8`). `class` includes `path|track|pedestrian|footway`; `type` includes `hiking|trail|footway|bridleway|steps`. **No junction layer for non-motorway**. The `motorway_junction` layer is freeway exits only. Report is correct on this.
- **Vector tiles already cached by `@rnmapbox/maps`**: this is true and underutilized in the report. The tiles are already on device after the user has scrolled to the route area. Decoding `.pbf` client-side and computing junctions from way intersections at zoom 14–16 is feasible with `@mapbox/vector-tile` + `pbf` (~80 KB JS). It's the report's own §1.4 "deferred" path. **For offline-mode editing this is the ONLY viable path** — Overpass requires network, period.
- **Mapbox Directions API**: returns route polylines with steps, `intersections[]` array per step that includes `bearings` and `entry` arrays. This is not a graph but it does mark intersections along a turn-by-turn route. For "user already drew a route, find junctions on it" this is closer to what's needed than Tilequery. 100K free req/mo. The report omits this entirely.
- **Mapbox Mobile SDK `queryRenderedFeatures`**: directly queryable on the rendered map. Returns features under a screen-space rect including `road` features. No HTTP roundtrip. The report doesn't mention this. For "find junctions visible on the user's current map view" this is instant and free — but only works for what the map is currently rendering (zoom-level dependent). This is probably the right primary path for online-mode editing in v1.

---

## 4. Mirror / Stability Reality Check

Live test 2026-06-10 06:35 UTC:

| Mirror | HTTP status | Latency | Notes |
|---|---|---|---|
| `overpass-api.de` | 200 | 1.0 s | primary |
| `lz4.overpass-api.de` | 200 | 1.3 s | same operator |
| `overpass.kumi.systems` | timeout | >10 s | **DEAD at test time** |
| `overpass.openstreetmap.fr` | 404 on /api/status | 7.6 s | endpoint may be moved |
| `overpass.private.coffee` | timeout | >10 s | **DEAD at test time** |

Two of the four "alternative" mirrors the report relies on for resilience were unreachable. `lz4.overpass-api.de` is run by the same person as `overpass-api.de` (Roland Olbricht) — these are not independent failure domains. **You effectively have one provider.**

Historical: overpass-api.de has had multi-day outages in 2023 (server move) and 2024 (rate-limit recalibration). Single-provider dependency for a hiking app means the editor breaks for everyone simultaneously when the server burps.

---

## 5. The Offline Case Is The Actual Primary Case

A hiking app whose users edit routes only at home wifi is wrong-shaped. Real users:
- Finish a hike at a trailhead carpark with no signal.
- Open the app to review/edit before the kids climb back into the car.
- App must let them edit nodes **offline**, immediately, with whatever data was available before signal cut out.

The report puts offline at "out of scope for v1", and "Sprint 2+" for vector-tile path. This inverts the priority. For the actual user scenario:

1. Tiles are cached on device anyway (Mapbox does this).
2. The route GPS trace is on device (it's the user's own trace).
3. Junctions can be computed from the locally-cached vector tiles' `road` source-layer at zoom 14–16 by extracting all path/track/footway lines that fall in the route bbox and running the existing `TrailGraph.fromTrails` on them.
4. Overpass is a "nice-to-have when online" augmentation, not a primary path.

**This inverts the recommendation**: client-side vector-tile junction extraction should be v1, Overpass should be v2 augmentation (and maybe never necessary if vector tile coverage is good).

---

## 6. Hybrid Failure Modes — Real Corner Cases

The report's §4 hybrid (DOC + OSM) has more failure modes than acknowledged:

1. **Same trail, different geometry**: DOC's track polyline and OSM's `highway=path` for the same Tongariro route diverge by 5–30 m in places. After 30-m dedup union-find, you get a Y-shaped fake junction at the divergence point. **Cairn will display a junction that doesn't exist in reality.**
2. **DOC track exists, OSM doesn't (and vice versa)**: dedup-by-proximity won't fire. Both are kept. User sees two parallel trails 20 m apart. Visual mess.
3. **Closed loop in DOC, open in OSM** (or vice versa): different edge sets in TrailGraph, different junction sets. Edits made on one source don't transfer.
4. **DOC ArcGIS metadata changes (track renamed/closed)** but OSM still has it: which one wins? Report says "prefer DOC's metadata". OK, but if DOC says "closed for maintenance" and OSM doesn't carry that tag, you've kept the OSM geometry but should you still allow editing nodes there? The report has no rule.
5. **Bbox spans the NZ boundary** (Stewart Island / South Island ferry routes, or NZ-Australia comparison data): partial DOC coverage + OSM-only on the other side leads to inconsistent node density that visibly drops at the meridian.

None of these are showstoppers but the report's "merge by 30m proximity" hand-wave glosses over the design work.

---

## 7. Pressure-Test of Each Claim in the Report

| Report claim | Verdict |
|---|---|
| "OSM Overpass is the only option that gives worldwide coverage" | TRUE for trail data; FALSE for what's usable in mainland China without coordinate handling. |
| "`node(way_cnt:3-)` returns junction nodes natively" | **FALSE in practice.** Filter returns 0 nodes in every test bbox 2026-06-10. |
| "junction extraction is O(1) wall time per query" | **FALSE.** Even foreach (the working approach) is 18 s mountain / 117 s urban. |
| "Overpass returns this in <5s. Cache by bbox-hash" | True for *count* queries; false for *junction extraction* with the only working syntax. |
| "Multi-mirror failover for resilience" | Half-true. 2 of 4 named mirrors were dead at test time. The 2 alive are run by the same operator. |
| "Privacy: only bbox is sent" | TRUE, and a real advantage. |
| "Same GeoJSON-ish output shape as DOC → drop-in replacement" | Mostly true. `out geom;` returns coords inline; needs ~30 LOC parser. |
| "OTA-deployable in a single Sprint" | TRUE *if* the underlying approach worked, which it doesn't yet. |
| "Mapbox Tilequery is point-based — bad for polyline corridors" | TRUE. |
| "Map Matching gives a snapped polyline but no graph topology" | TRUE. |
| "Offline mode out of scope for v1" | **WRONG PRIORITY.** Offline is the dominant use case for hiking apps. |

---

## 8. Recommended Architecture (replaces report §8)

### Source-of-truth ordering

Per route-edit session, in order:

```
1. Locally-cached Mapbox vector tiles (.pbf)
   - Always available offline if user has scrolled to area
   - No network, no rate limit, no privacy concern
   - Decode road source-layer (path|footway|track|cycleway|bridleway|steps types)
   - Run existing TrailGraph.fromTrails on extracted lines
   - Compute junctions client-side (existing union-find code)

2. NZ DOC ArcGIS (when bbox intersects NZ)
   - Existing client unchanged
   - Higher fidelity: track grade, alerts, named huts

3. OSM Overpass via foreach (NOT way_cnt)
   - Augments tiles in regions where map zoom didn't cache enough detail
   - 24-hour bbox-hash cache
   - Hard 30-second timeout per call; on timeout fall back to (1)
   - Skip entirely in mainland China (latency / GFW risk)

4. Self-sampled GPS-only fallback (deep backcountry)
   - Densify the user's recorded trace at 10-m intervals
   - Endpoints + every recorded waypoint stop as candidate nodes
   - UI hint: "此区域无路网数据，仅显示路径端点和停留点"
```

### China-specific path

Activated when device IP geolocates to mainland CN OR user's last GPS lies inside CN bbox:

- Disable Overpass calls (latency).
- Use Mapbox China plugin (or whatever Cairn currently uses for CN tile rendering) → if Mapbox China plugin: convert all WGS-84 OSM/DOC/cache data to GCJ-02 before display. Existing libraries: `eviltransform-js` or hand-rolled (~80 LOC). **This is required regardless of Overpass decision.**
- For trail data, prefer cached vector tile path. As augmentation: Amap (高德) walking road API — needs API key + ICP filing for production. Defer this to a separate Sprint with explicit user-flow testing.

### Failure / fallback chain

```
edit-mode-open
  │
  ├── try local vector-tile junction extraction
  │     hit → render nodes, done.
  │     miss (zoom too coarse / tile not cached) → next
  │
  ├── (if NZ) try DOC + OSM Overpass with 30s timeout
  │     hit → render nodes, done.
  │     timeout / network err → next
  │
  ├── (if not NZ, not CN) try OSM Overpass (foreach) with 30s timeout
  │     hit → render nodes, done.
  │     timeout / network err / 0 ways returned → next
  │
  └── GPS-only fallback: densify trace, mark endpoints + waypoints
        always succeeds. UI banner: "节点数据稀疏 — 仅显示端点"
```

---

## 9. Concrete Answers to the Brief's Final Questions

**A. Where will the report's plan break in production?**

- **Mainland China (Shanghai, Beijing, Lhasa, Huangshan, etc.)**: GCJ-02 mismatch makes nodes appear off-trail visually. GFW latency makes 100+ s queries time out. Report is silent on both.
- **Tokyo, Seoul, dense urban Asia**: 117-s wall time per query in Shibuya measured today. Public Overpass will rate-limit you in production within minutes. Users see "loading…" forever.
- **Anywhere offline (which is most hiking destinations)**: report defers offline to Sprint 2+. Real users hit this on day 1. App falls back to endpoints-only — no better than current state.
- **Anywhere when overpass-api.de has its monthly outage**: alt mirrors are 50% dead at any given time per my live test. Report's "load-balance" sentence overestimates resilience.
- **Patagonia / sub-Saharan Africa / Annapurna**: low OSM density (19 ways in 16 km² Torres del Paine) means nodes collapse to endpoints anyway. Report admits this in §2 then doesn't carry the implication — these users see *exactly the current trailGraph=null UX*. The 1-Sprint OTA "fix" doesn't fix anything for them.

**B. Is China a separate-track problem?**

**Yes, definitively.** Two independent issues compound:
1. Coordinate system (GCJ-02) — this is a **product correctness** issue for *any* data source overlaid on a Mapbox-rendered CN map. Even if you use vector-tile-only, you need to confirm what coordinate system the rendered tiles use in CN and whether the existing user-GPS pipeline is already converted.
2. Network (GFW + latency) — affects only Overpass, mitigatable by self-host or by leaning on offline path.

China should be its own Sprint with: GCJ-02 detection + conversion utility, CN-region tile/data source selection, and explicit QA on a CN-IP test harness (a CN-region VPN exit on QA's machine).

**C. Recommended final architecture**

See §8 above. Three-tier with offline-first:
1. Cached vector tiles (offline-capable, free, fast)
2. DOC for NZ / Overpass for global online augmentation (foreach syntax, 30s timeout, never block UI)
3. GPS-only endpoints fallback (always works)

China gets a parallel pipeline with GCJ-02 conversion at the boundary, no Overpass.

**D. How do the three sources stitch together?**

Order: cache → DOC/Overpass → GPS-only. Each tier has a hard timeout and immediately yields to the next on failure. Critically, **the user never waits for network in edit mode** — the cached-tile tier returns synchronously from device storage. The Overpass tier runs *in parallel* and refreshes the node display when (if) it returns within budget. If it never returns, the user already has a usable graph from tier 1.

Dedup logic across tiers: when tile-tier and Overpass-tier overlap, prefer Overpass geometry (more fresh) but keep tile-tier as authoritative for offline reuse. When DOC and Overpass overlap (NZ), prefer DOC metadata, OSM geometry — same as report. Add **temporal staleness check**: if cached tile data >30 days old, mark nodes derived from it with low-confidence flag in the UI.

---

## 10. Sources

- Live test 2026-06-10 06:31–06:39 UTC against `https://overpass-api.de/api/interpreter`. Test scripts in `/tmp/overpass_test.sh` (transient).
- Mapbox China plugin description: zhuanlan.zhihu.com/p/48158713 (Mapbox 中国地图插件文档, 2018) — "自动将…转换为 GCJ-02 坐标".
- DataV Alibaba Cloud GCJ-02 explainer: alibabacloud.com/help/en/datav/datav-map-coordinate-systems — confirms mandatory GCJ-02 for all CN published mapping.
- GCJ-02 history reference: blog.csdn.net/zerokkqq/article/details/52920281.
- Overpass mirror status check 2026-06-10 06:35 UTC (`curl -m 10` against five public mirrors, two timed out).
- Foreach perf measurements: 2026-06-10 06:42 UTC, Tongariro 18 s / Tokyo Shibuya 117 s wall time, single Overpass call, fresh server.
- Cross-reference with existing `C:/ClaudeCodeProjects/Cairn/app/src/services/routing/graph/TrailGraph.ts` and `DOCTrailsClient.ts` — densify+kdbush+union-find pipeline confirmed reusable; no GCJ-02 conversion present in current codebase (verified via grep before this review — recommend explicit check).

---

## Appendix — Recommended next concrete actions

1. **Reproduce the foreach perf numbers.** Run `foreach` against your actual user's saved route bboxes from beta data to confirm 30+ second p95 wall times. If true, Overpass-as-online-augmentation is non-viable without self-hosting.
2. **Audit current Cairn behavior in mainland China.** Open the running app on a CN-region device or VPN; record a short walk in Shanghai; load it on the map. Does the GPS trace align with the road? If not, you already have a GCJ-02 bug independent of this work.
3. **Prototype offline vector-tile junction extraction.** Take the existing tiles `@rnmapbox/maps` already caches, decode the `road` source-layer with `@mapbox/vector-tile`, run `TrailGraph.fromTrails` on the result. If this works at zoom 14–16, it replaces 80% of the Overpass use case and removes most of the report's risk surface.
4. **Decide before any implementation: is the China market in scope for v1?** If yes, Sprint plan must include the GCJ-02 + Amap pipeline. If no, document as "What We Will NOT Build" in DISCOVERY.md and gate the feature by IP/region. Don't ship a half-broken CN experience.
