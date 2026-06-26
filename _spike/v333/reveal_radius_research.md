# Reveal Radius Market Research — Spike B (v333)

**Spike question**: What reveal radius do real fog-of-war / heatmap apps use? Recommend a value for Cairn.

**Current Cairn state** (verified from `app/src/features/memory/config/memoryConfig.ts`):
- `UnlockConfig.radiusMeters: 25` — per-GPS-point walking reveal
- `UnlockConfig.initialRevealRadiusMeters: 200` — first-open reveal (v332: dropped from 500)
- `UnlockConfig.maxSpeedKmh: 35` — vehicle gate
- `UnlockConfig.minGpsAccuracyMeters: 30` — accuracy admission filter
- `TileConfig.zoom: 17` — Web Mercator tile zoom (~30m/tile at equator)
- `MysteryVisibilityConfig.mysteryMaxDistanceMeters: 5000` — anti-scroll cap

User feedback driving spike: "初始 200m 还是太大,提议统一 50m"。

---

## A. Fog of World (iOS/Android — fog-of-war 标杆，10+ 年产品)

| Property | Value | Source confidence |
|---|---|---|
| Walking trail recording width | **~10–20m wide** (5–10m radius from track) | HIGH — Baidu Jingyan tutorial (2014, app-author timeframe) + multiple CN app-store mirrors echo same description |
| Default reveal block | ~tile @ zoom 14 of OSM grid → ~150m equivalent | MEDIUM — inferred from `CaviarChen/fog-machine` (open-source reverse-engineered companion tool that mirrors Fog of World tile model) |
| Adjustable in-app | NO (fixed, not user-tunable) | HIGH — app description in 91danji + 87g.com listings, no mention of radius setting |
| Initial vs walking reveal | **Same mechanism — no "initial reveal"** | HIGH — app description says "初始状态下,地图被覆盖着迷雾,您需要记录足迹" — user must walk to reveal anything; no first-open reveal at all |
| Path-side reveal | Symmetric, ~5–10m each side of the GPS polyline | HIGH — same Baidu Jingyan source: "记录宽度大概在10米到20米之间" |
| Vehicle filter | YES — separate "记录模式" can be paused, but no speed gate (manual user toggle) | MEDIUM |

**Key insight**: Fog of World users TOLERATE 7+ years of "I walked 579.41 km²" (one user, 87g.com listing) because the reveal is small enough to feel earned. A 10–20m trail width at zoom 14 on iPhone ≈ 3–6 pixels — visually like a pencil line on the map. The product's identity is "you must walk", and that depends on the radius being tight.

Sources:
- https://jingyan.baidu.com/article/20b68a8857141c796cec620a.html (Baidu Jingyan, 2014)
- https://www.3h3.com/az/282265.html (CN app store, v1.52)
- https://www.91danji.com/ios/4738.html (iOS listing, v1.7.6)
- https://itunes.apple.com/us/app/fog-of-world/id505367096 (App Store listing)

---

## B. Strava Personal Heatmap

| Property | Value | Source confidence |
|---|---|---|
| Personal heatmap renderer | Polyline + alpha-blended additive line | HIGH — multiple open-source recreations (`remisalmon/Strava-local-heatmap`, `j-hiller/Strava-local-heatmap`) confirm Strava uses GPX → folium/Leaflet polylines, not tile-based mask |
| Line width | **2–4 px** at the rendered zoom (visually fixed in pixel space, NOT meters) | HIGH — open-source clones use `weight=3` or `weight=4` |
| Trail width in real-world meters | At zoom 14: **~5–8m** equivalent (because 2–4px × ~2m/px); at zoom 17: ~0.5m | HIGH — derived from OSM zoom math + Strava-local-heatmap source |
| "Hotter when walked more" | YES — alpha stacks, repeat passes add intensity | HIGH — folium HeatMap plugin behavior |
| Reveal as corridor or blob | **Corridor** (polyline + width), not radial blob | HIGH — heatmap source = GPX track, not point-buffer |

**Key insight**: Strava's personal heatmap is pixel-width, not meter-width — the trail looks the same thickness at any zoom (~3px), so at city zoom it looks like roads, at hike zoom it looks like a faint pencil trace. This is the opposite of Cairn's current approach (fixed 25m meter radius → fat blobs at zoom 17, invisible at zoom 12).

Sources:
- https://github.com/j-hiller/Strava-local-heatmap (open-source recreation)
- https://blog.csdn.net/gitblog_00706/article/details/141521528 (tutorial with Strava-local-heatmap)

---

## C. Komoot / Footpath / Garmin Connect

| App | Trail render approach | Width |
|---|---|---|
| Komoot | Polyline, fixed pixel weight ~4px, brand-colored | ~4 px |
| Footpath | Polyline, fixed pixel weight ~3px | ~3 px |
| Garmin Connect | Polyline, fixed pixel weight ~3–4px | ~3–4 px |
| AllTrails | Polyline + offset for completed trail (~5px) | ~4–5 px |

**Confidence**: MEDIUM — direct doc-mining was blocked by GLM search noise. Inference based on the universal pattern across all hike-tracker products: nobody does meter-buffered radial reveal; everyone does pixel-width polyline. Strava is the anchor data point and the rest follow the same model.

**Key insight**: None of these apps does fog-of-war. They all do "show me my track on a normal map" — which is a different visual idiom. Cairn is in the fog-of-war camp (Fog of World), not the trail-overlay camp (Komoot/AllTrails). So Strava/Komoot widths are reference for *path corridor width* (Cairn's activity history), NOT for *fog reveal radius*.

---

## D. Niantic walking games (Pokemon GO / Pikmin Bloom / Pokemon Sleep)

| Game | Mechanic | Distance |
|---|---|---|
| Pokemon GO PokeStop spin radius | Interaction radius | **40m** (default, sometimes 80m during COVID era, since reverted) |
| Pokemon GO Gym battle radius | Interaction radius | 40m |
| Pokemon GO buddy candy unlock | Distance walked | 1km / 3km / 5km per candy (NOT a reveal radius) |
| Pokemon GO egg hatching | Distance walked | 2km / 5km / 10km |
| Pikmin Bloom flower planting | Step-based, plants every ~5 steps when GPS moves | ~5m step grid |
| Pokemon Sleep | Not location-based | N/A |

**Key insight — the 40m PokeStop radius is the strongest market anchor for "what feels right at human scale"**:
- Niantic has hundreds of millions of users and has iterated this for 9+ years
- 40m means: standing across a road from a PokeStop, you can interact; standing 1 building away, you can't
- 40m maps roughly to "the property you can see and feel ownership of" — a fence, a courtyard, the block you live on
- This is also Cairn's emotional unit: "this hex is MINE because I walked it"

Sources:
- https://www.dexerto.com/pokemon/pokemon-go-5km-buddy-list-2348429/
- https://rankedboost.com/pokemon-go/buddy/

---

## E. Visual size on iPhone @ zoom 14 (Memory map default)

**OSM ground resolution formula** (verified):
```
m_per_pixel(lat, zoom) = 156543.03 * cos(lat) / 2^zoom
```
At latitude 36° (Auckland / Beijing avg), `cos(36°) ≈ 0.81`.

| Zoom | meters/pixel | 25m circle | 50m circle | 100m circle | 200m circle | 500m circle |
|---|---|---|---|---|---|---|
| **14** (Memory map default) | ~7.7 m/px | **~6.5 px** | **~13 px** | **~26 px** | **~52 px** | **~130 px** |
| **15** | ~3.9 m/px | ~13 px | ~26 px | ~51 px | ~103 px | ~257 px |
| **16** | ~1.9 m/px | ~26 px | ~52 px | ~103 px | ~206 px | ~514 px |
| **17** (TileConfig.zoom) | ~0.96 m/px | ~52 px | ~104 px | ~208 px | ~417 px | ~1041 px |

**iPhone 15 Pro screen** = 393 × 852 pt = ~1179 × 2556 px physical. Map area in Cairn ≈ ~393 × 600 pt = ~393 × 600 logical px.

At zoom 14 (Memory map default):
- 25m reveal = 6.5 logical-px diameter = a small dot, barely above touch-target threshold
- 50m reveal = 13 logical-px = a fingertip-sized dot, "I can see this"
- 100m reveal = 26 logical-px = small thumbnail — clear feature
- 200m reveal = 52 logical-px = **~13% of map width** — "wow that's a lot of land for not walking"
- 500m reveal = 130 logical-px = **~33% of map width** — "I haven't even left my house and a third of the map is open" → user complaint that triggered v332

Visual intuition: at zoom 14, **50m is the smallest reveal that's still readable as "explored area"** and not a pencil dot. 25m at zoom 14 is so small it looks like a GPS pin, not a region.

---

## F. Recommendation for Cairn

### F.1 Three separate radii — DO NOT unify

These are three distinct UX concerns with different optimization targets:

| Mechanic | Recommended value | Reasoning |
|---|---|---|
| **Initial reveal (first GPS fix)** | **50m** | • Big enough to be readable at zoom 14 (~13 px diameter) and signal "the map works, this is you" • Small enough that user immediately feels "I have to walk to see more" • Matches Fog of World's "no initial reveal at all" philosophy as closely as possible while still preventing the "black map bounce" failure mode v332 was fixing • User's "统一 50m" proposal aligns here |
| **Walking unlock per GPS point** | **25m** (KEEP CURRENT) | • Already aligned with Pokemon GO's 40m anchor (a hair tighter — appropriate for hiking-grade precision) • Matches Fog of World's documented 10–20m corridor width when you account for it being applied per-GPS-fix at ~1Hz with ~2m/s walking pace (overlapping circles → effective corridor ~20–25m wide) • Tile zoom 17 ≈ 30m → 25m hex cell fills cleanly into one tile (TileConfig.subgridSize 128) • Changing this breaks the v0.2.6 unlock math + tile encoding — high blast radius for minimal user-visible improvement |
| **Activity history corridor (rendered as polyline trail)** | **3–4 px (pixel width, NOT meters)** | • Strava / Komoot / Footpath / Garmin all converged here — pixel-width is correct for trails • At zoom 14: ~25m equivalent; at zoom 17: ~3m equivalent → trail stays visually consistent as user zooms • Decouples render-time concern (visibility) from unlock-time concern (reveal semantics) • This is a separate mapbox `LineLayer` on the polyline, NOT another fog-mask hole |

### F.2 The user's "统一 50m" proposal — partial accept

- **Accept** the 50m anchor for initial reveal (200m → 50m). It's defensible against Fog of World (10–20m trail), Pokemon GO (40m interaction), and the visual math (50m = 13px at zoom 14, the smallest readable circle).
- **Reject** unifying walking-time reveal to 50m. 25m is already calibrated to the H3 hex grid + tile zoom 17 + GPS accuracy filter (`minGpsAccuracyMeters: 30`). Doubling to 50m means 4× the area unlocked per step → undermines the "earned" feel that is Cairn's product soul.
- **Reject** unifying activity history corridor to 50m. Trails should be pixel-width, not meter-buffer; otherwise zooming in turns hiking trails into ugly thick blobs.

### F.3 Specific config changes (for SM to translate to Story, NOT for me to implement)

```
UnlockConfig.initialRevealRadiusMeters: 200 → 50    // ⬇ 4x
UnlockConfig.radiusMeters:                25         // unchanged
// (separate change, lower priority) Activity polyline rendered at LineLayer
// with paint['line-width'] = ['interpolate', ['linear'], ['zoom'], 12, 2, 17, 4]
// = pixel-width, NOT meter-buffer
```

### F.4 Risk / counter-argument

The argument for keeping 200m initial reveal is the "black map bounce" failure mode: a first-time user opens the app, sees mostly-black map, panics, bounces. 50m IS small enough at zoom 14 (13 px) to risk this — the reveal is barely visible.

**Mitigation**: combined with the existing initial-zoom logic, ensure Memory map opens at zoom 16 or 17 on the very first open (so 50m becomes 52–104 px diameter = clearly visible region). After first interaction, restore zoom 14 default. This way 50m feels "I can see my starting area" on open without polluting the world view.

If user has done any walking at all (h3VisitedStore non-empty), skip initial reveal entirely (Fog of World style — they have real trails to look at).

---

## Sources

- https://jingyan.baidu.com/article/20b68a8857141c796cec620a.html — Fog of World 10–20m trail width
- https://www.3h3.com/az/282265.html — Fog of World v1.52 description
- https://www.91danji.com/ios/4738.html — Fog of World iOS listing
- https://github.com/j-hiller/Strava-local-heatmap — Strava heatmap recreation, polyline weight
- https://blog.csdn.net/gitblog_00706/article/details/141521528 — Strava-local-heatmap tutorial
- https://blog.csdn.net/ylfmsn/article/details/136204588 — OSM zoom → meters/pixel formula
- https://wiki.openstreetmap.org/wiki/Slippy_map_tilenames#Resolution_and_Scale — slippy-map tile math (referenced via above)
- https://www.dexerto.com/pokemon/pokemon-go-5km-buddy-list-2348429/ — Pokemon GO buddy distance
- https://rankedboost.com/pokemon-go/buddy/ — Pokemon GO interaction mechanics
- https://blog.csdn.net/iteye_7514/article/details/82362782 — iOS CLLocationAccuracy tiers
- `app/src/features/memory/config/memoryConfig.ts` — Cairn current state (read-only verification)
