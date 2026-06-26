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

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useMemorySettingsStore } from '../store/useMemorySettingsStore';
import { useMemoryStore } from '../store/useMemoryStore';
import { getMapbox } from '../services/mapboxAdapter';
import { log } from '../../../services/appLog';
import bufferTurf from '@turf/buffer';
import differenceTurf from '@turf/difference';
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
      const buf = bufferTurf(line, CORRIDOR_WIDTH_M, { units: 'meters', steps: 4 });
      if (buf && buf.geometry) {
        corridors.push(buf as Feature<Polygon | MultiPolygon>);
      }
    } catch (e: any) {
      log('fog.buffer_failed', { seg_len: seg.length, err: String(e?.message ?? e).slice(0, 100) });
    }
  }

  if (corridors.length === 0) return world;

  // Combine all corridor polygons into one MultiPolygon for a single
  // turf.difference call (more reliable than chained per-corridor difference).
  const allCoords: any[] = [];
  for (const c of corridors) {
    if (c.geometry.type === 'Polygon') {
      allCoords.push(c.geometry.coordinates);
    } else if (c.geometry.type === 'MultiPolygon') {
      for (const poly of c.geometry.coordinates) allCoords.push(poly);
    }
  }
  if (allCoords.length === 0) return world;

  const combinedCorridors = multiPolygon(allCoords);

  try {
    const fc = featureCollection([world as any, combinedCorridors as any]);
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

  const [fogShape, setFogShape] = useState<Feature<Polygon | MultiPolygon> | null>(null);
  const recomputeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isMountedRef = useRef(true);

  // Debounced recompute of fog geometry. Cheap when points haven't changed,
  // but turf.buffer + difference can be 50-300ms with 1000+ vertices.
  useEffect(() => {
    if (!useH3Fog) {
      setFogShape(null);
      return;
    }
    if (recomputeTimerRef.current) clearTimeout(recomputeTimerRef.current);
    recomputeTimerRef.current = setTimeout(() => {
      if (!isMountedRef.current) return;
      const t0 = Date.now();
      const shape = buildFogShape(points);
      if (!isMountedRef.current) return;
      log('fog.shape_built', {
        n_points: points.length,
        build_ms: Date.now() - t0,
        has_holes: shape !== null && shape.geometry.type === 'Polygon'
          && (shape.geometry.coordinates as any[]).length > 1,
      });
      setFogShape(shape);
    }, RECOMPUTE_DEBOUNCE_MS);
  }, [points, geometryVersion, useH3Fog]);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (recomputeTimerRef.current) clearTimeout(recomputeTimerRef.current);
    };
  }, []);

  if (!useH3Fog) return null;
  if (!Mapbox.available) return null;
  if (!fogShape) return null;

  const { ShapeSource, FillLayer } = Mapbox as any;

  return (
    <ShapeSource id="memory-fog-src" shape={fogShape}>
      <FillLayer
        id="memory-fog"
        style={{
          // Slightly deeper than the previous sepia (#3A2A18 at 0.66) per
          // user feedback "颜色可以更深一点". This produces a clear "I haven't
          // been here" feel while still letting basemap roads show through
          // the corridor cutouts.
          fillColor: 'rgba(40, 30, 18, 0.80)',
          fillOpacity: 1,
          // Disable AA to avoid 1px seams along hole edges (mapbox-gl-js#7023
          // workaround per Simon Sat 2019).
          fillAntialias: false,
        }}
      />
    </ShapeSource>
  );
}
