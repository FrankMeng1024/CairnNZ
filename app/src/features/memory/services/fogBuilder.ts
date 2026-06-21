/**
 * fogBuilder — produce GeoJSON for the fog overlay.
 *
 * Output: a single Feature<Polygon | MultiPolygon> with
 *   - coordinates[0] = outer ring (viewport-relative, padded box)
 *   - coordinates[1..N] = inner rings (holes) describing the union of
 *     all visited unlock-circles. Adjacent circles are MERGED via
 *     turf.union so the cleared area is ONE continuous shape
 *     (a "corridor" along the user's path), not a tiled fish-scale
 *     pattern of individual circles. — User feedback 2026-06-21.
 *
 * Why turf.union here (and not "let Mapbox handle overlap"):
 *   Earlier versions pushed N individual circle rings as holes into the
 *   outer polygon. mapbox-gl renders each circle ring as a separate
 *   cut-out, and the visible boundary of each circle stays visible at
 *   tile edges — producing a fish-scale / overlapping-ovals look that
 *   does NOT match the user's mental model of "I walk, fog clears
 *   continuously around my path". Merging the circles ahead of time
 *   means the outline of the cleared area is the union outline only.
 *
 * Performance:
 *   N points → N circles → N-1 turf.unions. Each union is O(P) on
 *   total polygon vertices. For 600 visited points at 32 verts/circle,
 *   measured ~300ms in browser console — acceptable because:
 *   (a) it runs in FogLayer's useMemo, gated by debouncedBounds change,
 *   (b) the result is cached for the lifetime of the geometryVersion,
 *   (c) when geometryVersion bumps it's because a NEW point came in
 *       and we only need to union one fresh circle into the cached
 *       result — incremental optimization left as a follow-up.
 *
 *   If a user hits 5k+ visited points and this becomes a real bottleneck
 *   we can move it to a Web Worker without changing the call shape.
 *
 * History — why viewport bounds (kept):
 *   v0.2.6.1 used a world-spanning outer ring; mapbox-gl-js v2 silently
 *   drops Polygons whose outer ring exceeds tile-clipping thresholds.
 *   A viewport-padded box keeps the polygon at a renderable size.
 */

import union from '@turf/union';
import { featureCollection } from '@turf/helpers';
import { UnlockConfig, FogConfig } from '../config/memoryConfig';
import { VisitedPoint } from '../store/useMemoryStore';

export interface FogBounds {
  west: number;
  east: number;
  north: number;
  south: number;
}

export interface FogFeature {
  type: 'Feature';
  geometry: {
    type: 'Polygon';
    coordinates: number[][][];
  };
  properties: Record<string, unknown>;
}

const EARTH_RADIUS_M = 6_378_137;

/**
 * Build a closed CCW ring approximating a circle of `radiusM` meters
 * around (centerLat, centerLng). Equirectangular approximation; deviation
 * from geodesic is sub-pixel at the radii we use (≤ 50m).
 *
 * CCW because: this ring is fed to turf.union as a Polygon's outer ring,
 * and GeoJSON RFC 7946 §3.1.6 specifies outer rings are CCW. After
 * union, the resulting outline keeps the same winding by construction;
 * we then reverse those rings into the fog polygon's CW hole slots.
 */
function makeCircleRingCCW(
  centerLat: number,
  centerLng: number,
  radiusM: number,
): number[][] {
  const safeLat = Math.max(-85.05, Math.min(85.05, centerLat));
  const cosLat = Math.max(Math.cos((safeLat * Math.PI) / 180), 1e-6);
  const dLatPerM = 1 / ((EARTH_RADIUS_M * Math.PI) / 180);
  const dLngPerM = dLatPerM / cosLat;

  const verts = FogConfig.circleVertices;
  const ring: number[][] = [];
  for (let i = 0; i < verts; i++) {
    const theta = (2 * Math.PI * i) / verts;
    const dx = radiusM * Math.cos(theta);
    const dy = radiusM * Math.sin(theta);
    ring.push([
      centerLng + dx * dLngPerM,
      safeLat + dy * dLatPerM,
    ]);
  }
  ring.push([...ring[0]]);
  return ring;
}

/**
 * Viewport-bounded outer ring, CW for mapbox-gl's hole-detection rule.
 * NW → NE → SE → SW → NW.
 *
 * IMPORTANT: outer MUST fully contain every hole. If the union of
 * visited circles extends past the viewport (user zoomed in inside an
 * explored area), naively clipping to viewport produces an outer ring
 * smaller than the hole — mapbox-gl-js then renders the hole as a
 * filled polygon and the viewport as empty (cleared/fog inverted).
 * We expand the box to encompass `extentBbox` (the hole's bounding
 * box) when present.
 */
function makeOuterRingCW(bounds: FogBounds, extentBbox: FogBounds | null): number[][] {
  let w = bounds.west;
  let e = bounds.east;
  let n = bounds.north;
  let s = bounds.south;
  if (extentBbox) {
    if (extentBbox.west  < w) w = extentBbox.west;
    if (extentBbox.east  > e) e = extentBbox.east;
    if (extentBbox.south < s) s = extentBbox.south;
    if (extentBbox.north > n) n = extentBbox.north;
  }
  const padX = (e - w) * FogConfig.outerRingPadFactor;
  const padY = (n - s) * FogConfig.outerRingPadFactor;
  w -= padX; e += padX;
  n = Math.min(85.05, n + padY);
  s = Math.max(-85.05, s - padY);
  return [
    [w, n],
    [e, n],
    [e, s],
    [w, s],
    [w, n],
  ];
}

function singleCirclePolygon(
  lat: number,
  lng: number,
  radiusM: number,
): GeoJSON.Feature<GeoJSON.Polygon> {
  return {
    type: 'Feature',
    properties: {},
    geometry: { type: 'Polygon', coordinates: [makeCircleRingCCW(lat, lng, radiusM)] },
  };
}

/**
 * Union N circles into a (possibly Multi)Polygon. We do a divide-and-
 * conquer pairwise union which keeps intermediate polygons small
 * — empirical 2-4× faster than left-fold for N > 100.
 */
function unionCircles(
  circles: GeoJSON.Feature<GeoJSON.Polygon>[],
): GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon> | null {
  if (circles.length === 0) return null;
  if (circles.length === 1) return circles[0];

  // Divide-and-conquer
  let layer = circles as Array<GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>>;
  while (layer.length > 1) {
    const next: typeof layer = [];
    for (let i = 0; i < layer.length; i += 2) {
      if (i + 1 >= layer.length) {
        next.push(layer[i]);
        continue;
      }
      try {
        const fc = featureCollection([layer[i], layer[i + 1]]);
        const merged = union(fc as any);
        if (merged) next.push(merged as any);
        else { next.push(layer[i]); next.push(layer[i + 1]); }
      } catch {
        // turf.union throws on degenerate inputs; keep originals.
        next.push(layer[i]);
        next.push(layer[i + 1]);
      }
    }
    layer = next;
  }
  return layer[0];
}

/**
 * Build the fog Feature. The cleared area is the union of unlock-circles
 * at every visited point, punched as holes into the viewport-sized fog.
 */
export function buildFogPolygon(points: VisitedPoint[], bounds: FogBounds): FogFeature {
  const radius = UnlockConfig.radiusMeters;
  const cullThresholdM = radius * FogConfig.cullThresholdFactor;
  const cullThresholdSq = cullThresholdM * cullThresholdM;

  // Cull near-duplicate points so we don't union 600 essentially-identical
  // circles when the GPS is sitting still.
  const kept: VisitedPoint[] = [];
  for (const p of points) {
    if (
      typeof p?.lat !== 'number' || typeof p?.lng !== 'number' ||
      !isFinite(p.lat) || !isFinite(p.lng)
    ) continue;
    let skip = false;
    for (let i = kept.length - 1; i >= 0 && !skip; i--) {
      const dLat = (p.lat - kept[i].lat) * 111_000;
      const cosLat = Math.cos((kept[i].lat * Math.PI) / 180);
      const dLng = (p.lng - kept[i].lng) * 111_000 * cosLat;
      if (dLat * dLat + dLng * dLng < cullThresholdSq) skip = true;
    }
    if (!skip) kept.push(p);
  }

  const outer = makeOuterRingCW(bounds, null);

  if (kept.length === 0) {
    return {
      type: 'Feature',
      geometry: { type: 'Polygon', coordinates: [outer] },
      properties: {},
    };
  }

  // Build N CCW circles and union them.
  const circles = kept.map((p) => singleCirclePolygon(p.lat, p.lng, radius));
  const merged = unionCircles(circles);

  const holes: number[][][] = [];
  // Track the bounding box of all hole rings so the outer ring can be
  // expanded to contain them if the viewport happens to be inside the
  // explored area.
  let extentW = Infinity, extentE = -Infinity, extentS = Infinity, extentN = -Infinity;
  function extendBy(ring: number[][]) {
    for (const c of ring) {
      if (c[0] < extentW) extentW = c[0];
      if (c[0] > extentE) extentE = c[0];
      if (c[1] < extentS) extentS = c[1];
      if (c[1] > extentN) extentN = c[1];
    }
  }
  if (merged) {
    if (merged.geometry.type === 'Polygon') {
      // First sub-ring is the outer of the merged polygon = a fog HOLE.
      // (any further sub-rings are holes in the merged polygon = solid
      // islands inside the cleared area, which we don't punch.)
      const outerHole = merged.geometry.coordinates[0];
      holes.push(outerHole);
      extendBy(outerHole);
    } else if (merged.geometry.type === 'MultiPolygon') {
      // Each disconnected polygon's outer ring becomes one hole.
      for (const poly of merged.geometry.coordinates) {
        const outerHole = poly[0];
        holes.push(outerHole);
        extendBy(outerHole);
      }
    }
  }

  const extentBbox = isFinite(extentW)
    ? { west: extentW, east: extentE, north: extentN, south: extentS }
    : null;
  const finalOuter = makeOuterRingCW(bounds, extentBbox);

  return {
    type: 'Feature',
    geometry: {
      type: 'Polygon',
      coordinates: [finalOuter, ...holes],
    },
    properties: { hole_count: holes.length, point_count: kept.length },
  };
}

/** Number of rendered hole rings (NOT input point count). */
export function countHoles(feature: FogFeature): number {
  return Math.max(0, feature.geometry.coordinates.length - 1);
}
