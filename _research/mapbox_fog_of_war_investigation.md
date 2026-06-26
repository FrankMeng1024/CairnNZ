# Mapbox + Mobile H3 Fog-of-War Investigation

**Date**: 2026-06-25
**Author**: Subagent B (research-only, no Cairn source reading)
**Question**: Is Cairn's "GeoJSON Polygon with 1000+ rectangular holes" architecture viable, and if not what should replace it?

---

## TL;DR (executive summary)

**Cairn's current architecture is fundamentally incompatible with reliable Mapbox rendering.** This is not a tuning bug — it is a documented, 7-year-open core limitation of `mapbox-gl-native` / `mapbox-gl-js` for which Mapbox's own core engineer (Volodymyr Agafonkin / "mourner") says: *"we don't have any workarounds to offer"* for GeoJSON, and the only reliable solution is to **pre-tile the polygons to MVT vector tiles** instead of feeding GeoJSON at runtime.

The reference app Cairn is trying to clone — **Fog of World** — does **not** use polygons. It uses **packed bitmaps** on disk and renders them at runtime as **HTML5 Canvas raster tiles** attached to Mapbox as a `canvas`/`image` source. Polygons never enter the pipeline.

The 5 attempted Cairn fixes (v325→v330) cannot succeed because the architecture is wrong, not the parameters.

---

## A. Mapbox GL Native Polygon Rendering — Internal Mechanics

### A1. Tessellation
- Mapbox switched from `libtess2` + `ClipperLib` to **earcut** (`earcut.hpp` in native, `earcut` JS in GL JS) around 2015-2016 ([mapbox-gl-native PR #2444](https://github.com/mapbox/mapbox-gl-native/pull/2444)). Earcut is faster (2×–15×) but **cannot handle non-simple polygons** (self-intersections, intersecting rings, holes outside outer ring).
- Tessellation is done **per tile** — every tile a polygon intersects gets independently tessellated. This is critical to understand: a 1000-hole world-spanning polygon must be re-tessellated for every Mapbox tile it covers.

### A2. Vector tile quantization
- Default extent = **4096** integer units per tile ([Mapbox vector tile spec](https://github.com/mapbox/vector-tile-spec)).
- `geojson-vt` slices GeoJSON at runtime, then **rounds vertices to integer coordinates** in the [0, 4096) tile coordinate system.
- This is where the bug is born. Source: [`mapbox/mapbox-gl-js#7023` (master ticket)](https://github.com/mapbox/mapbox-gl-js/issues/7023), Volodymyr Agafonkin (Mapbox core eng):

> "polygon geometries have to be sliced into tiles, with shapes converted into an integer tile coordinate system and simplified for every zoom level — performed by geojson-vt. **This process alters original geometry in subtle ways that can lead fully valid simple polygons to become invalid on certain zoom levels — in particular, introduce self-intersections.** This in turn, although rarely, triggers rendering artifacts in GL JS for which **we don't have any workarounds** to offer."

- The simplification step (Douglas-Peucker) makes it worse: see [`geojson-vt#185`](https://github.com/mapbox/geojson-vt/issues/185) (2024) "Not self intersecting geojson becomes self intersecting as a result of simplify".

### A3. Draw calls for 1000-hole polygon
- A single GeoJSON `Polygon` feature with 1 outer ring + N inner rings is **one geometry**. Earcut emits one triangle list for it (per tile slice). That goes to **one fill draw call per tile** for fill, plus **one line draw call per tile** for the outline (drawn around **every ring including holes** — see A5).
- The GPU vertex buffer size scales linearly with hole count. With 1000 holes × 4 vertices each = ~4000 ring vertices, plus the outer world ring, earcut produces roughly **2N triangles** for the fog ring system (N holes ≈ 2000 triangles per tile). Performance is generally fine; **correctness is the problem**.

### A4. fill-antialias on even-odd hole polygons
- Mapbox uses **earcut even-odd tessellation** for hole handling, not the stencil buffer (`mapbox-gl-js` switched away from stencil in [#682](https://github.com/mapbox/mapbox-gl-js/issues/682) ca. 2015 because stencil-buffer bits are scarce on mobile and conflicted with too many layers — see [`mapbox-gl-native#1857`](https://github.com/mapbox/mapbox-gl-native/issues/1857)).
- `fill-antialias: true` (default) renders a 1px AA outline along **every ring** including holes. With 1000 holes this means 1000+ tiny outlines, each subject to the same quantization rounding. Known partial workaround: **`fill-antialias: false`** (simon-sat, [#7023 comment](https://github.com/mapbox/mapbox-gl-js/issues/7023#issuecomment-505815013)). This eliminates the seam outlines but not the structural artifacts.

### A5. LineLayer applied over Polygon
- LineLayer on a Polygon geometry draws **every ring** (outer + all inner). For Cairn's 1000-hole fog polygon, this means drawing 1000+ tiny rectangles' outlines — exactly the "checkerboard outline" Cairn is seeing.
- If the LineLayer is intended only for the outer fog boundary, the data must be split: separate the outer world ring (as a LineString or stand-alone Polygon) from the holes (different source).

### A6. Zoom re-tessellation
- Yes — **`geojson-vt` re-runs simplification at every zoom level**. Each zoom has its own integer quantization grid. A polygon valid at z=14 can become self-intersecting at z=10 because the simplification + integer rounding at z=10 may collapse two distinct holes into overlapping geometry. This is exactly why Cairn's bug "appears on zoom out, doesn't disappear on zoom in" — once geojson-vt cached the broken z=10 tile, it stays cached.

---

## B. Market Implementations Survey

| App | Data structure | Rendering | Platform | Key technique | Source |
|---|---|---|---|---|---|
| **Fog of World** (the canonical fog-of-war hiking app, 10+ yrs on iOS/Android) | **Packed bitmap on disk**: world = 512×512 tiles, each tile = 128×128 blocks, each block = 64×64 bitmap. Encoded as zlib-compressed binary files. | **Pre-rasterized HTML5 Canvas → Mapbox `canvas` source → `raster` layer**. Canvas is filled opaque black, `clearRect` punches visited pixels. LRU-cached per (x,y,z) tile. | Native iOS + Android (sync format reverse-engineered) | Bitmap → raster image, NEVER polygon. No tessellation pipeline involved at all. | [`CaviarChen/Fog-of-World-Data-Parser`](https://github.com/CaviarChen/Fog-of-World-Data-Parser) (parser source); [`CaviarChen/fog-machine`](https://github.com/CaviarChen/fog-machine) — see `editor/src/utils/MapRenderer.ts`; [zijun.dev blog](https://www.zijun.dev/en/posts/fog-of-world-data-parser/) |
| **Strava Heatmap** | Aggregated GPS heatmap pre-baked on server | **Server-rendered raster tiles** (PNG, served via WMTS), client just shows them as raster overlay | Web + iOS + Android | Heavy lifting is offline/server-side; client is "dumb" raster viewer. Personal heatmap = subset of same architecture, regenerated on activity upload. | Strava engineering blog (no longer publicly indexed); reverse-engineered in [`bertt/wmts#2`](https://github.com/bertt/wmts/issues/2) showing tile URL pattern `https://heatmap-external-{a,b,c}.strava.com/tiles/{type}/{color}/{z}/{x}/{y}.png` |
| **Pokémon GO** | Niantic Real World Platform — proprietary | Custom Unity-based map renderer with own tile pipeline (NOT Mapbox); explored regions are stored as part of "Niantic Wayfarer" / spatial mesh, not as user-visible fog | iOS + Android (Unity) | Bespoke engine; not transferable | Niantic public talks at GDC; no direct fog-of-war primitive — exploration shows as Pokestops/Gyms unlocking, not visual unmasking |
| **Footpath** (hiking route planner with completed-trail highlight) | Mapbox vector tiles for basemap; user routes as GeoJSON LineStrings overlaid | LineLayer only (paths), not Polygon fog | iOS + Android | Doesn't actually do fog-of-war — highlights completed routes as colored polylines on top of basemap. Simpler problem. | App Store listing; no public engineering blog |
| **Komoot** | Mapbox vector tiles (own custom basemap "Komoot Maps") | Pre-generated raster overlays for completed trails + LineLayer for routes | iOS + Android | Pre-baked server-side raster overlays, not runtime polygon math | [Komoot Maps blog](https://www.komoot.com/c/komoot-maps); they purchased Skobbler in 2019 to build their custom tile pipeline |
| **WilliamYuhangLee/FogOfWorld** (community clone) | H3 cells | GeoJSON polygon with holes via deck.gl | Web | **Same architecture as Cairn — and has the same bugs**. 9 stars, abandoned. | [Repo](https://github.com/WilliamYuhangLee/FogOfWorld) |
| **HamzaFettouch/mapaviajes** (RN/Expo, June 2026) | H3 cells (h3-js, polygonToCells) | GeoJSON Polygon w/ holes inside MapLibre in a WebView | Expo + WebView (not native Mapbox) | **Identical architecture to Cairn**. Will hit the same bug above ~hundreds of cells. Author has not reported issues yet because demo only covers small city bbox. | [Repo](https://github.com/HamzaFettouch/mapaviajes) |

### B-key takeaway

**No production fog-of-war app uses runtime GeoJSON-polygon-with-holes on native Mapbox.** The two big shipping examples (Fog of World, Strava) both bypass polygon rendering entirely: bitmap raster mask + canvas/image source. Community RN attempts that do use polygon-with-holes are either toy projects or have not yet hit the scale where the bug manifests.

---

## C. H3 Mobile Status (2026)

### C1. h3-js on React Native + Hermes
- **`h3-js` is an Emscripten WASM build**. It does not work on Hermes/RN ≥ 0.76 out of the box because of a `new TextDecoder("utf-16le")` line at module load — Hermes doesn't support `utf-16le` encoding and crashes at parse time, even though that line is **never executed**. Tracked in [`uber/h3-js#203`](https://github.com/uber/h3-js/issues/203), open since 2025, no official fix.
- Workarounds in the wild:
  - `patch-package` to delete the `UTF16Decoder` line (fragile — breaks on h3-js rebuild)
  - `fast-text-encoding` polyfill via `polyfillGlobal` from `react-native/Libraries/Utilities/PolyfillFunctions` (cleanest)
  - **Reimplementing H3 in pure JS** — which Cairn already did at v323 (commit 762a341 "replace h3-js with pure JS h3Pure"). This is the right call.
- Upstream maintainer @nrabinowitz: "every time we attempt an emscripten upgrade, performance suffers significantly" — they consider the WASM/Emscripten approach the limiter.

### C2. Does Uber's own mobile app use H3 for rendering?
- **No**. Uber uses H3 as a **spatial index** for backend services (supply/demand modeling, surge pricing, ETA buckets) — not for client-side map rendering. The Uber rider/driver app shows traffic, polylines, and pickup zones, none rendered as hex grids.
- H3 was open-sourced specifically as a server-side indexing library. Client visualization is a downstream use case mostly done in deck.gl on **web**, not native mobile.

### C3. deck.gl H3HexagonLayer architecture
- Uses **GPU instanced drawing**: one hexagon mesh template, the GPU instances it once per hex with per-instance position/color attributes ([deck.gl H3HexagonLayer docs](https://github.com/visgl/deck.gl/blob/master/docs/api-reference/geo-layers/h3-hexagon-layer.md)).
- Avoids tessellation per hex — no earcut, no quantization issues, no per-zoom re-simplification.
- Has a `highPrecision: 'auto' | true | false` flag for pentagon edge cases and low-resolution (res 0-5) cells where Mercator distortion makes the "single template" assumption visible.
- **deck.gl does not have a first-class React Native binding.** It runs in WebGL/WebGL2 contexts. Options:
  - **WebView** (mapaviajes pattern) — works, but inherits all WebView GPU/perf limitations
  - **`@deck.gl/mapbox`** as an overlay on `mapbox-gl-js` running in a `react-native-webview` — same WebView caveat
  - There is no native React Native port of deck.gl as of June 2026.

### C4. mapbox-gl-h3 plugin status
- No active plugin called "mapbox-gl-h3". A few abandoned experiments exist. The mainstream integration path is deck.gl H3HexagonLayer overlaid on Mapbox — both run in WebGL, browser only.

### C5. Correct architecture for H3 fog of war on mobile (2026 answer)

There are **three viable architectures**, in order of robustness:

1. **Bitmap-mask + raster image source** (Fog of World approach). H3 is used only as the storage indexing system; the renderer rasterizes visited cells into per-tile canvases / PNGs and feeds them to Mapbox as ImageSource. **Most robust, fewest moving parts, no Mapbox internals dependency.**
2. **Server-pre-baked MVT vector tiles**. Use H3 to track visited cells; periodically (or on a job) write the polygon-with-holes data as MVT files served as a Mapbox vector source. Mourner's own recommendation: *"this issue doesn't happen with vector tiles. It only manifests on GeoJSON files. So the only reliable workaround for now is to use vector tiles instead of GeoJSON"* ([#7023, 2025-06-13](https://github.com/mapbox/mapbox-gl-js/issues/7023#issuecomment-2966)).
3. **Custom Mapbox layer with shader-based mask** (deck.gl-style on native). Requires custom native code per platform; very high effort. Cairn shouldn't go here.

---

## D. Public Cases of the Checkerboard Artifact

| Source | Phenomenon | Root cause | Fix offered |
|---|---|---|---|
| [`mapbox-gl-native#14316`](https://github.com/mapbox/mapbox-gl-native/issues/14316) "Strange Artifacts in Fill Layer" (2019) | "When using holes in Fill Layer strange artefacts do appear depending on the zoom level. Problem is even worse when polygon data is as big as the whole world." Includes jradasaurus comment: "I have a geojson object of the entire world, and I 'cut' out holes (which are all squares). Depending on zoom level strange artifacts appear." | geojson-vt quantization → earcut tessellation failure on degenerate input | None. Bot-closed for inactivity. |
| [`mapbox-gl-js#7023`](https://github.com/mapbox/mapbox-gl-js/issues/7023) "GeoJSON polygon rendering is unreliable (master ticket)" (2018→open) | Master ticket consolidating ~30 sub-tickets (#12356, #10768, #10592, #10299, #10106, #9981, #9913, #9761, #9441, #9072, #7857, #7663, #7433, #7228, #6383, #6313, #6069, #3545, #3080, #13147, #12903, #7748, #7233, #5265, #4962, #3032, #2975, #2696). All zoom-dependent polygon artifacts. | Same as above. | Three options Mapbox has considered: (a) port Wagyu C++ to JS, (b) Emscripten-compile Wagyu, (c) new "polysnap" project — none shipped. As of 2025: **use vector tiles instead of GeoJSON**. |
| [`mapbox-gl-native#1857`](https://github.com/mapbox/mapbox-gl-native/issues/1857) "Polygons on top of rasters have tile-border artifacts" (2015) | Tile-edge yellow lines on polygons over satellite. | **Stencil buffer overflow** when too many layers compete for the limited stencil bits. nicomgd: "my current style would need 12 bits of stencil to draw fine, 5 of which are allocated to annotations." | Reduce layer count; disable stencil clipping per-source. (Mapbox eventually moved away from stencil for polygons.) |
| [`mapbox-gl-native#3260`](https://github.com/mapbox/mapbox-gl-native/issues/3260) "[iOS] Distorted polygons at certain zoom level" (2015) | Polygons distort at certain zoom levels, return to correct shape on zoom-out. | Same quantization-induced earcut failure. | None. |
| [`mapbox-gl-js#7023 comment 2019`](https://github.com/mapbox/mapbox-gl-js/issues/7023#issuecomment-505815013) | Polygon rendering artifacts on overlapping polygons. | Same. | **`fill-antialias: false`** reduces visible artifacts substantially (does not fix structural triangulation, but hides seam outlines). |
| [`mapbox-gl-js#7023 comment 2025`](https://github.com/mapbox/mapbox-gl-js/issues/7023#issuecomment-2966) | Production user @annamenitskaya: "Self-intersections appear to be introduced during simplification/grid snapping at lower zoom levels, causing triangulation failures and visually corrupted polygons. Affecting production users." | Confirmed root cause. | **mourner**: *"use vector tiles (e.g. through Mapbox MTS service) instead of GeoJSON"* |
| [`geojson-vt#185`](https://github.com/mapbox/geojson-vt/issues/185) "Not self intersecting geojson becomes self intersecting as a result of simplify" (2024) | Direct reproducible case: a valid simple polygon becomes self-intersecting after geojson-vt simplification. | Simplification is unaware of topology. | None. |
| [`mapbox-gl-native#9686`](https://github.com/mapbox/mapbox-gl-native/issues/9686) "queryRenderedFeatures on FillLayer with holes" (open) | Holes break feature queries too. | Even-odd tessellation produces invalid feature geometry for picking. | None. Hole-rendering is treated as a problem domain on its own. |

The community's pattern is unambiguous: **the more holes, and the wider the outer polygon, the more often the bug manifests**. Cairn (outer = entire world, holes = 1000+) is at the worst end of that spectrum.

---

## E. Architectural Recommendation for Cairn

Cairn's current architecture is **not viable** for the stated scale (1000+ rectangular cells, runtime updates, zoom-out usage). The five attempted fixes failed because the fixes target tessellation parameters or layer composition — but the bug is in geojson-vt + earcut, deep in the Mapbox tile pipeline, and **cannot be reached or corrected from the public API surface**. This is the same conclusion Mapbox's own engineering reached, documented across 7+ years.

### Three replacement architectures (ranked)

#### Option 1 — **Rasterized canvas mask** (Fog of World pattern) — RECOMMENDED

**Architecture**:
- Keep H3/grid cell storage unchanged (Cairn's 25m × 25m visited cell data stays as-is)
- For each Mapbox tile in the viewport, render a 256×256 or 512×512 canvas: fill with semi-transparent fog color, then `clearRect`/erase the visited cells
- Attach via `mapbox-gl`'s `canvas` source (web) or `ImageSource` (`@rnmapbox/maps` supports this)
- LRU-cache by `(z,x,y)` so pan is free
- Re-render on cell-set changes (debounced)

**Trade-offs**:
- **Pros**: bypasses every Mapbox rendering bug (no polygon, no tessellation, no quantization). Identical to the only known-working shipping implementation (Fog of World). Smooth at any cell count.
- **Cons**: rasterization is per-frame work on viewport change. Mitigation: per-tile LRU cache. Edge softness must be done in rasterizer (Gaussian blur on canvas, or pre-rendered anti-aliased disk stamps per cell).
- **Edge fidelity**: 256×256 px per tile gives ~1 px / world meter at z=18, which is finer than the 25m cell grid. No visible pixelation up to z=18.

**Implementation cost on RN/Cairn**:
- Need a rasterizer that works without `<canvas>` DOM. Options: `react-native-skia` (production-grade, GPU-accelerated, can encode to base64 PNG), `expo-gl` + manual draw, or pure-JS Uint8ClampedArray → PNG via `upng-js`. **react-native-skia is the right tool** — Shopify maintains it, supports offscreen canvases, fast.
- Cell storage: unchanged. Only the renderer module changes.
- Sprint estimate: 1 sprint for Skia rasterizer + ImageSource glue + LRU cache. Add 1 sprint for edge anti-aliasing/feathering tuning.

#### Option 2 — **Server-pre-baked MVT vector tiles**

**Architecture**:
- Keep H3 cell storage on device + sync to backend
- On backend (aliyun), maintain per-user MVT tile pyramid generated from visited cells
- Mapbox `VectorSource` pointing at backend tile URL
- Invalidate / regenerate on a schedule or on cell-set change

**Trade-offs**:
- **Pros**: Mapbox's own recommended workaround (mourner, 2025). Vector tiles do not trigger the runtime simplification bug. Renders crisply at any zoom.
- **Cons**: Requires server-side MVT generation (tippecanoe or PostGIS ST_AsMVT). High latency between "user walks" and "fog updates" (minutes, not real-time). Increases server load. Per-user vector tile namespaces required.
- **Real-time fog update is impossible** with this architecture without aggressive cache invalidation.

**Implementation cost**: 2-3 sprints (backend tile generation + invalidation strategy + Mapbox source migration).

**Verdict**: viable only if real-time update can be relaxed (e.g. "fog updates within 60 seconds of walk"). For Cairn's UX promise of immediate unmasking, this is the wrong choice.

#### Option 3 — **Custom layer / shader / deck.gl overlay**

**Architecture**:
- Write a Mapbox CustomLayer (`type: 'custom'`) that runs a GLSL fragment shader
- Shader samples a texture (uploaded per frame from a Uint8 grid) and outputs fog color
- Bypasses earcut entirely

**Trade-offs**:
- **Pros**: most flexible, highest visual quality (per-pixel control, soft edges via shader)
- **Cons**: massive native code per platform. `@rnmapbox/maps` does not expose Mapbox's `CustomLayer` API at all on iOS/Android. Would require forking rnmapbox + writing Swift/Kotlin native modules per platform. Deck.gl on native is not supported.
- Not realistic for Cairn's resource constraints.

**Verdict**: rule out.

### Recommendation

**Adopt Option 1**. The implementation is well-defined, contained to one module, preserves all existing cell storage code, and exactly matches the architecture of the only successful long-running fog-of-war shipping app. Mapbox's own engineering recommendation (Option 2) is a fallback if Skia integration runs into trouble.

---

## F. Three Quick Experiments to Falsify the Current Architecture

These are designed to be runnable in **one Cairn build** and produce a definitive answer per experiment.

### Experiment F1 — `fill-antialias: false` removes the seam outlines but leaves structural artifacts

**Hypothesis**: Cairn's checkerboard has two visual components: (a) thin seam lines around every hole (caused by AA outline) and (b) larger geometric corruption (caused by earcut failures). Disabling AA will eliminate (a) but not (b).

**Action**: Set `fillAntialias={false}` on Cairn's FillLayer for the fog polygon. No other change. Build OTA, run on a heavily explored area, zoom out to z=10.

**Expected**: thin grid lines disappear, but if there's still a large blocky/triangular corruption pattern at z=10, that confirms the deeper earcut bug.

**How to observe**: side-by-side Playwright screenshot comparison (current vs `antialias:false`) at the same lat/lng/zoom. Look at the screenshot — no code review needed.

**Significance**: if both layers of artifact persist, Option 1 (raster) is mandatory. If only seams remain, that's a much cheaper fix (just disable AA).

### Experiment F2 — One synthetic GeoJSON Polygon with N rectangular holes in mapbox-gl-js's online editor

**Hypothesis**: The bug is reproducible in pure mapbox-gl-js (no Cairn code involved), proving it's a Mapbox-level issue, not a Cairn integration issue.

**Action**: In a browser tab, open `https://docs.mapbox.com/mapbox-gl-js/example/simple-map/` and in DevTools console, add a FillLayer with a GeoJSON Polygon: outer ring = world (`[[-180,-85],[180,-85],[180,85],[-180,85],[-180,-85]]`), holes = 500 random 25m×25m rectangles within a 5km area. Zoom out from z=18 to z=10.

**Expected**: identical checkerboard / artifact pattern appears at z=10 or lower. This proves the bug is in mapbox-gl-js, not Cairn.

**How to observe**: screenshot of mapbox-gl-js demo with synthetic data alongside Cairn screenshot showing the same artifact pattern.

**Significance**: kills any remaining theory that this is a Cairn-specific bug. Demonstrates to any future skeptic (including ourselves after a future compact) that the architecture is wrong.

### Experiment F3 — Replace one tile's polygon with a static raster image and confirm artifact disappears

**Hypothesis**: Switching the same visited cells from polygon-with-holes to a rasterized PNG attached as ImageSource will produce zero artifacts at any zoom.

**Action**: Pre-generate a single 512×512 PNG of the fog mask for one fixed bbox using any tool (Python PIL, online drawing tool, even MS Paint). Replace Cairn's FillLayer in that bbox with an `<ImageSource>` + `<RasterLayer>` pointing at the PNG. Build OTA, zoom in/out across that bbox.

**Expected**: zero artifacts at any zoom level. The image scales/resamples per Mapbox's standard raster pipeline (bilinear filtering), so it's visually clean.

**How to observe**: screenshots at z=18, z=14, z=10. Look at the bbox area — no checkerboard.

**Significance**: this is the **architectural proof-of-concept** for Option 1. It demonstrates the entire pipeline (ImageSource + RasterLayer on rnmapbox + Mapbox) works correctly with a raster mask. The remaining work to ship Option 1 is just dynamic generation of the PNG (which is what Fog of World does in pure JS).

---

## Sources

Mapbox / engineering ground truth:
- [mapbox-gl-js #7023 — master polygon ticket](https://github.com/mapbox/mapbox-gl-js/issues/7023) — mourner's full root-cause explanation and 2025 "use vector tiles" recommendation
- [mapbox-gl-native #14316 — Strange Artifacts in Fill Layer](https://github.com/mapbox/mapbox-gl-native/issues/14316) — exact Cairn symptom, multiple reporters, never fixed
- [mapbox-gl-native #2444 — Switch to earcut](https://github.com/mapbox/mapbox-gl-native/pull/2444) — tessellator history
- [mapbox-gl-native #1857 — tile-border artifacts](https://github.com/mapbox/mapbox-gl-native/issues/1857) — stencil overflow background
- [mapbox-gl-native #3260 — distorted polygons at certain zoom](https://github.com/mapbox/mapbox-gl-native/issues/3260)
- [geojson-vt #185 — simplification creates self-intersections](https://github.com/mapbox/geojson-vt/issues/185)
- [mapbox-gl-native #9686 — queryRenderedFeatures on FillLayer with holes](https://github.com/mapbox/mapbox-gl-native/issues/9686)
- [Mapbox vector tile spec](https://github.com/mapbox/vector-tile-spec)

Fog of World architecture:
- [CaviarChen/Fog-of-World-Data-Parser](https://github.com/CaviarChen/Fog-of-World-Data-Parser) — binary format reverse engineering
- [CaviarChen/fog-machine](https://github.com/CaviarChen/fog-machine) — full open-source reimplementation, see `editor/src/utils/MapRenderer.ts` for the canvas + raster layer rendering pattern
- [zijun.dev blog](https://www.zijun.dev/en/posts/fog-of-world-data-parser/) — motivation and data structure summary

H3 + RN status:
- [uber/h3-js #203 — Hermes utf-16le crash](https://github.com/uber/h3-js/issues/203) — current as of mid-2025, no upstream fix
- [uber/h3-js #163 — Emscripten upgrade tracking](https://github.com/uber/h3-js/issues/163)
- [deck.gl H3HexagonLayer docs](https://github.com/visgl/deck.gl/blob/master/docs/api-reference/geo-layers/h3-hexagon-layer.md) — instanced-drawing approach

Comparable RN/Expo attempts:
- [HamzaFettouch/mapaviajes](https://github.com/HamzaFettouch/mapaviajes) — June 2026 RN/Expo fog-of-war using H3 + GeoJSON polygon-with-holes via WebView. Same architecture as Cairn. Hasn't hit the bug yet because demo scope is small.
- [WilliamYuhangLee/FogOfWorld](https://github.com/WilliamYuhangLee/FogOfWorld) — abandoned web clone using polygon-with-holes
- [vishpatel913/fog-of-war-react-native](https://github.com/vishpatel913/fog-of-war-react-native)

rnmapbox raster pipeline:
- [rnmapbox ImageSource docs](https://github.com/rnmapbox/maps/blob/main/docs/ImageSource.md) — confirms `ImageSource` + `RasterLayer` are supported on iOS and Android
- [rnmapbox #3705 — RasterLayer artifacts](https://github.com/rnmapbox/maps/issues/3705) — raster has its own bugs, but they are zoom-AA bugs, NOT structural; far less severe than polygon-hole bugs

---

## One-line conclusion

**Cairn is fighting a documented, irreparable bug in `geojson-vt` + `earcut` that Mapbox itself has not fixed in 7 years and explicitly tells users to avoid by using non-GeoJSON sources. The single fastest path forward is to copy Fog of World's architecture: rasterize visited cells into a canvas / PNG per Mapbox tile and feed them as `ImageSource` + `RasterLayer`. Polygons should never enter the fog rendering pipeline.**
