/**
 * FogLayer — v346 buffered-path fog of war (path-shaped cutout).
 *
 * Architecture (replaces v331-v345 hybrid Skia+ImageSource pipeline):
 *
 *   Single ShapeSource + FillLayer:
 *     - Outer ring = world rect
 *     - Inner rings = turf.buffer(GPS path, 25m) corridors per hike segment
 *     - Result: fog covers everywhere EXCEPT where the user actually walked
 *
 * Why this works where v331-v345 didn't:
 *   - v331-v345 used <ImageSource url={mask.uri}> with Skia-rendered PNG.
 *     - v331-v342 tried file:// URI → silent fail (rnmapbox/maps#1457, open
 *       5+ years on iOS Mapbox SDK 11.x)
 *     - v343 tried data:image/png;base64 → also silent fail (verified by
 *       v344 magenta diagnostic — user saw zero magenta = data: rejected)
 *     - The "Skia + ImageSource" architecture is fundamentally incompatible
 *       with Mapbox iOS SDK 11.20.1 dynamic image loading. No OTA fix exists.
 *   - v346 abandons raster entirely: GPS path → turf.buffer → polygon hole.
 *     Mapbox ShapeSource + GeoJSON polygon-with-holes IS supported and works.
 *
 * Spike validation (_spike/v346-fog-options/spike-A-z14.png etc):
 *   - 10-point GPS path + turf.buffer 25m → 1 polygon ring with ~60 vertices
 *   - z14/z12: VISIBLE — clean ribbon shape, basemap roads readable
 *   - z9: corridor becomes sub-pixel (~1m wide on screen) — acceptable
 *
 * Avoids the v325-v330 earcut bug (mapbox-gl-js#7023):
 *   - v325-v330 used N independent small holes (one per H3 cell) → triggers
 *     earcut tessellation failure at zoom-out
 *   - v346 uses ONE buffered corridor per hike (or unioned for all hikes) →
 *     ~60-200 vertices total → well below earcut threshold
 *
 * Triggers:
 *   - userCenter changes → recompute fog if needed (geometry doesn't depend
 *     on viewport; pan/zoom doesn't trigger rebuild)
 *   - useMemoryStore.points changes (new hike saved) → recompute corridors
 *
 * No Skia, no PNG, no transport, no http URL, no file://, no data: URI.
 */

import React, { useMemo } from 'react';
import { useMemorySettingsStore } from '../store/useMemorySettingsStore';
import { useMemoryStore } from '../store/useMemoryStore';
import { getMapbox } from '../services/mapboxAdapter';
import { log } from '../../../services/appLog';
import bufferTurf from '@turf/buffer';
import differenceTurf from '@turf/difference';
import unionTurf from '@turf/union';
import simplifyTurf from '@turf/simplify';
import { lineString, polygon, multiLineString, featureCollection, multiPolygon } from '@turf/helpers';
import type { Feature, Polygon, MultiPolygon, LineString, MultiLineString } from 'geojson';

interface Props {
  /** Current map center. Reserved for future use (e.g. recompute on big pan). */
  userCenter?: { lat: number; lng: number } | null;
}

// Corridor width in meters around each GPS line — this is the "trail width"
// visible to the user. 25m feels generous on hiking-zoom (z14-z16) without
// looking absurdly wide on city streets.
const CORRIDOR_WIDTH_M = 25;
// Douglas-Peucker simplification tolerance — 5m smooths jitter without
// distorting visible path shape.
const SIMPLIFY_TOLERANCE_DEG = 5 / 111320;
// Max GPS points per hike before chunking (keeps turf.buffer cost bounded).
const MAX_POINTS_PER_HIKE = 2000;
// Recompute the fog geometry at most once per N ms (the points store is
// append-only during hike, but we only re-render after each save).
const RECOMPUTE_DEBOUNCE_MS = 500;

/**
 * Group GPS points into hike segments. A new segment starts when there is
 * a > 5 minute gap between consecutive points (likely a new hike).
 *
 * Note: Cairn's useMemoryStore.points is a flat array across all hikes; we
 * synthesise hike boundaries from timestamp gaps. In future, when sessions
 * store explicit hike IDs, we can group by hikeId instead.
 */
function segmentByGap(points: Array<{ lat: number; lng: number; ts: number }>): Array<Array<[number, number]>> {
  if (points.length === 0) return [];
  const HIKE_GAP_MS = 5 * 60 * 1000;
  const segments: Array<Array<[number, number]>> = [];
  let current: Array<[number, number]> = [];
  let prevTs = points[0].ts;
  for (const p of points) {
    if (p.ts - prevTs > HIKE_GAP_MS && current.length > 0) {
      segments.push(current);
      current = [];
    }
    current.push([p.lng, p.lat]);
    prevTs = p.ts;
  }
  if (current.length > 0) segments.push(current);
  return segments;
}

/**
 * Build the fog GeoJSON: world rect with corridor-shaped holes.
 */
function buildFogShape(
  points: Array<{ lat: number; lng: number; ts: number }>,
): Feature<Polygon | MultiPolygon> | null {
  // World rect — slightly inset from poles to avoid Mapbox projection edge cases.
  const world = polygon([[
    [-180, -85],
    [180, -85],
    [180, 85],
    [-180, 85],
    [-180, -85],
  ]]);

  if (points.length === 0) {
    // No hikes yet — return solid fog with no holes.
    return world;
  }

  const segments = segmentByGap(points);
  // Each segment becomes a buffered polygon. Single-point segments are
  // skipped (no line geometry possible).
  const corridors: Array<Feature<Polygon | MultiPolygon>> = [];
  for (const seg of segments) {
    if (seg.length < 2) continue;
    // Cap at MAX_POINTS_PER_HIKE per segment (defensive — turf.buffer cost
    // scales with vertex count).
    const capped = seg.length > MAX_POINTS_PER_HIKE
      ? seg.filter((_, i) => i % Math.ceil(seg.length / MAX_POINTS_PER_HIKE) === 0)
      : seg;
    try {
      let line = lineString(capped);
      // Simplify before buffering — fewer vertices = faster buffer + cleaner shape.
      try {
        line = simplifyTurf(line, { tolerance: SIMPLIFY_TOLERANCE_DEG, highQuality: false });
      } catch {/* simplify can fail on duplicate points; use unsimplified */}
      // v351: steps 8 → 16. v349-v350 used steps:8 (quadrant segments,
      // 32 vertices per full circle = 11.25° per segment). At z16 a 25m
      // corridor cap is ~80-150px wide on screen, so each segment was
      // 3-5px — visible jagged "dog-bitten" edges per user feedback.
      // steps:16 → 64 vertices per circle, 5.6° per segment, sub-pixel
      // smooth at z14+. Vertex budget: 5-hike accum × 30 GPS pts × 16
      // = ~2400 verts, still well under the ~5000 vert earcut bug
      // threshold (#7023 was confirmed broken at 1848 in v325-v330 era,
      // but those were N independent small holes; we have 1 MultiPolygon
      // with corridors — different geometry class, higher safe threshold).
      const buf = bufferTurf(line, CORRIDOR_WIDTH_M, { units: 'meters', steps: 16 });
      if (buf && buf.geometry) {
        corridors.push(buf as Feature<Polygon | MultiPolygon>);
      }
    } catch (e: any) {
      log('fog.buffer_failed', { seg_len: seg.length, err: String(e?.message ?? e).slice(0, 100) });
    }
  }

  if (corridors.length === 0) return world;

  // v352 fix: replace direct push-into-MultiPolygon with progressive
  // turf.union. Pre-v352 code stacked all per-segment buffers as
  // sibling polygons in one MultiPolygon, but GeoJSON spec forbids
  // sibling overlap — polyclip-ts (turf.difference's underlying engine)
  // applies even-odd rule to overlapping siblings, treating overlap
  // regions as HOLES. Result: when the user crossed the same area
  // twice (folded path or close-by parallel segments), the overlap
  // created sharp diamond-shaped "unsolved" spikes inside what should
  // be revealed corridors. User-visible as: "中间有一片没解锁的尖锐位置".
  //
  // turf.union calls polyclip's union path (different from difference)
  // which correctly merges overlapping polygons into a single non-
  // overlapping polygon-with-no-internal-holes. Then differenceTurf
  // sees one clean shape and produces clean fog cutouts.
  //
  // Cost: O(N²) for N segments via reduce, but N is small (<20 typical
  // for a user's lifetime hike count). <100ms for typical case.
  let merged: Feature<Polygon | MultiPolygon> | null = null;
  for (const c of corridors) {
    if (!merged) {
      merged = c;
      continue;
    }
    try {
      const u = unionTurf(featureCollection([merged as any, c as any]) as any);
      if (u && u.geometry) merged = u as Feature<Polygon | MultiPolygon>;
      // If union fails, keep previous merged — better than dropping segments.
    } catch (e: any) {
      log('fog.union_failed', { err: String(e?.message ?? e).slice(0, 100) });
    }
  }
  if (!merged) return world;

  try {
    const fc = featureCollection([world as any, merged as any]);
    const fog = differenceTurf(fc as any);
    if (fog && fog.geometry) {
      return fog as Feature<Polygon | MultiPolygon>;
    }
  } catch (e: any) {
    log('fog.difference_failed', { n_corridors: corridors.length, err: String(e?.message ?? e).slice(0, 100) });
  }
  // Fallback: solid world fog (no holes) — never blank screen.
  return world;
}

export function FogLayer({ userCenter: _userCenter }: Props) {
  const Mapbox = getMapbox();
  const useH3Fog = useMemorySettingsStore((s) => s.useH3Fog);
  // v346: drive geometry from useMemoryStore.points (real GPS path),
  // not from useH3VisitedStore.cells (hex mosaic — wrong abstraction).
  const points = useMemoryStore((s) => s.points);
  const geometryVersion = useMemoryStore((s) => s.geometryVersion);

  // v351: SYNCHRONOUS fog shape via useMemo. Replaces v347's
  // useState(worldRect) + useEffect(buildFogShape) async pattern, which
  // caused users to see "all fog, no path" on first mount for ~200-500ms
  // while turf finished computing. User explicitly reported:
  // "应该是和背景同时load出来的不应该是单独load的".
  //
  // Trade-off: first mount blocks JS thread ~200-500ms (telemetry v350
  // build_ms=321ms on 765 points). But:
  //   (a) MemoryTab transition animation is ~200-300ms anyway — turf
  //       runs IN that window, user perceives slightly longer tab
  //       slide-in instead of "fog appears, then path appears".
  //   (b) Subsequent recomputes only fire when points/geometryVersion
  //       actually change (recordPoint or pull) — rare during quiet
  //       viewing.
  // If a hike is huge (5000+ points) and block exceeds 800ms, add
  // a vertex-budget cap inside buildFogShape (deferred).
  const fogShape = useMemo<Feature<Polygon | MultiPolygon> | null>(() => {
    if (!useH3Fog) return null;
    const t0 = Date.now();
    const shape = buildFogShape(points);
    log('fog.shape_built', {
      n_points: points.length,
      build_ms: Date.now() - t0,
      has_holes: shape !== null && shape.geometry.type === 'Polygon'
        && (shape.geometry.coordinates as any[]).length > 1,
    });
    return shape;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [points, geometryVersion, useH3Fog]);

  if (!useH3Fog) return null;
  if (!Mapbox.available) return null;
  if (!fogShape) return null;

  const { ShapeSource, FillLayer, LineLayer } = Mapbox as any;

  return (
    <ShapeSource id="memory-fog-src" shape={fogShape}>
      <FillLayer
        id="memory-fog"
        style={{
          // v349: fog color back to warm dark-brown. User feedback on v347
          // cool slate rgba(28,32,48,0.78): "很冷血" — fog of war is a
          // hiking exploration metaphor, warm earth tones read as
          // "unexplored wilderness" (Diablo, AoE, Civ all use dark-brown
          // ~#2A1F12-#3D2C1A range). #3A2A18 is the original Skia design
          // value (fogMaskRenderer.ts:282 pre-v346), at alpha 0.78 it
          // sits between v346's too-muddy 0.80 and a too-light 0.70.
          fillColor: 'rgba(58, 42, 24, 0.78)',
          fillOpacity: 1,
          // Disable AA to avoid 1px seams along hole edges (mapbox-gl-js#7023
          // workaround per Simon Sat 2019).
          fillAntialias: false,
        }}
      />
      {/* v350: Fragment-wrapped LineLayers were silently broken in v346-v349.
          rnmapbox/maps/src/utils/index.ts:93-96 explicitly skips React.Fragment
          when iterating children to inject sourceID. Result: both LineLayers
          fell back to defaultProps.sourceID (NOT 'memory-fog-src') and never
          rendered on our polygon source. v350 inlines them as direct ShapeSource
          children so cloneReactChildrenWithProps injects sourceID correctly.

          Two-pass corridor halo (mirrors the original Skia fog renderer's
          two-pass cream halo design — see fogMaskRenderer.ts:351-364 pre-v346):
          wide soft outer glow hides the jagged fillAntialias:false stairsteps
          + a tight inner gold rim crisps the cutout edge. Reads as "lantern
          light on a trail through fog" rather than "hole punched in fog". */}
      {LineLayer ? (
        <LineLayer
          id="memory-fog-edge-outer"
          style={{
            lineColor: 'rgba(247, 232, 200, 0.35)',
            lineWidth: 7,
            lineBlur: 8,
            lineOpacity: 0.85,
          }}
        />
      ) : null}
      {LineLayer ? (
        <LineLayer
          id="memory-fog-edge-inner"
          style={{
            lineColor: 'rgba(255, 220, 165, 0.85)',
            lineWidth: 1.6,
            lineBlur: 1.2,
            lineOpacity: 0.9,
          }}
        />
      ) : null}
    </ShapeSource>
  );
}
