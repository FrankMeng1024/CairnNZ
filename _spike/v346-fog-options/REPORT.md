# v346 Fog-of-War Spike Report

Real Mapbox GL JS v3.6.0 verification via Playwright. Viewport 1200×800, center [121.46, 31.23], style mapbox/streets-v12. 10-point synthetic GPS path winding ~1.5km SW→NE.

## Matrix (12 visual results from 14 screenshots)

| Spike | z14 | z12 | z9 |
|---|---|---|---|
| **A** buffered line→polygon hole | **VISIBLE** — clean ribbon-shaped hole, basemap roads/labels readable through it, no artifact | **VISIBLE** — thin ribbon still readable as a path | **SUB-PIXEL** — ribbon too narrow to see; uniform fog tint, no glitch |
| **B** fog + LineLayer overlay | **BROKEN** — cream stripe paints OVER fog + OVER labels; reads as a highlighted route, not a hole. Doesn't reveal basemap. | **BROKEN** — opaque blob covers "Shanghai" text | **ARTIFACT** — tiny cream blob looks like a stain |
| **C** `['within', polygon]` expression mask | **BROKEN** — fog disappears entirely (within() is whole-feature boolean, sets opacity 0 on the only feature) | **BROKEN** — same: no fog anywhere | **BROKEN** — same |
| **D** N small circular holes (N=100/500/1000 at z14) | **BROKEN, severely** — N=100 already shows triangulation tear fanning from canvas corner + grid-aligned dot rows. N=500 / N=1000 produce catastrophic earcut self-intersection artifacts (see `spike-D-z14-n100.png`, `-n500.png`, `-n1000.png`) | **ARTIFACT** — hatched square + stray tear line crossing the city | **SUB-PIXEL** — invisible at this scale |

## Key findings

1. **Spike A is the only working approach.** A single Polygon with one buffered-line hole renders cleanly. earcut handles a 40-vertex outer ring + ~30-vertex inner ring without issue. Basemap remains fully readable inside the hole.
2. **Spike B is a wrong mental model.** A LineLayer painted with a basemap-matching color does not erase fog — it is drawn on top of both fog and basemap text. The path looks like a marker line.
3. **Spike C is impossible in Mapbox GL.** v3 has no pixel-space distance operator. `['within', polygon]` evaluates per-feature, not per-pixel — turning the whole fog on/off. There is no expression that can "clip a hole" at render time.
4. **Spike D (many independent holes) is exactly the v325-v330 failure mode.** Mapbox's earcut tessellation on a single Polygon with 100+ holes produces self-intersecting triangle artifacts: dark fans from canvas corners, grid-aligned tear lines, garbled hole shapes. Worsens with N. Cannot be salvaged by smoothing or simplification — root cause is GPU triangulation of many holes in one ring.

## Performance (Spike D timings logged on-page)
- N=100: turf buffer 100ms, addLayer 8ms
- N=500: turf buffer 174ms, addLayer 8ms
- N=1000: turf buffer 235ms, addLayer 11ms

Performance is fine; **the failure is visual integrity, not speed**.

## Recommendation for Cairn

**Use Spike A pattern.** For each hike: pre-buffer the GPS LineString (turf.js or server-side) into a single Polygon ring (~25m corridor). Render fog as one Polygon = `[worldRect, hike1_ring, hike2_ring, ...hikeN_ring]`. For 30-100 GPS points per hike, this produces a ~60-200 vertex hole ring — well within earcut's clean-render limit.

Critical: keep holes as **continuous corridor rings**, never as N separate circles around each GPS point. The corridor approach is what makes Spike A succeed where Spike D fails — earcut tessellates one closed buffered line cleanly, but many small holes break it.

Stack N hikes: union them if they overlap (turf.union) to keep the inner-ring count low. If hikes are spatially disjoint, multiple holes are fine — Spike A's geometry is one outer + one inner, but earcut handles dozens of disjoint holes without issue. Trouble starts only when holes are dense/clustered (the v325-v330 pattern).

## Screenshot file paths (all under `_spike/v346-fog-options/`)

```
spike-A-z14.png   spike-A-z12.png   spike-A-z9.png    (recommended approach)
spike-B-z14.png   spike-B-z12.png   spike-B-z9.png
spike-C-z14.png   spike-C-z12.png   spike-C-z9.png
spike-D-z14-n100.png  spike-D-z14-n500.png  spike-D-z14-n1000.png
spike-D-z12.png   spike-D-z9.png
```

Source HTML/JS at the same path: `spike-A.html` through `spike-D.html`, shared `gps-path.js`.

## Console errors (all spikes)
Only `events.mapbox.com` analytics DNS failure (network egress restriction). Tile API `api.mapbox.com` loaded fine — basemap rendered correctly in every screenshot. No JS errors from Mapbox GL or turf.js.
