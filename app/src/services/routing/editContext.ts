/**
 * editContext — Build the graph + index inputs needed by useRouteEditStore.beginEdit
 * for an existing route. Centralises the wiring between LocalRouteExtras (the
 * authoritative original GPS trace) and the corridor / DOC / Mapbox routing
 * layers consumed by the RouteEditOrchestrator.
 *
 * Sprint 66 Wave 7 integration glue.
 */
import { loadExtras } from '../LocalRouteExtras';
import { PointCloudIndex, IndexedPoint } from './corridor/PointCloudIndex';
import { densify } from './corridor/PolylineSampler';
import { TrailGraph } from './graph/TrailGraph';
import { getCachedOrFetch } from './doctrails/DOCTrailsCache';
import type { BBox } from './doctrails/DOCTrailsTypes';
import type { LngLat } from './corridor/PolylineSampler';

export interface EditContext {
  /** Spatial index of points the user (or DOC trails) actually walked.
   *  Used by applyMidpointDrag for corridor enforcement. */
  walkedIndex: PointCloudIndex;
  /** Trail graph for shortest-path routing on DOC trails. May be null if
   *  no DOC coverage in the route's bbox or fetch failed. */
  trailGraph: TrailGraph | null;
  /** The original GPS trace points (for analytics + UI). */
  originalPoints: LngLat[];
}

/** Pad a route's bbox by ~5km for the corridor query. */
function padBboxKm(points: LngLat[], padKm: number): BBox {
  let west = Infinity;
  let east = -Infinity;
  let south = Infinity;
  let north = -Infinity;
  for (const p of points) {
    if (p.lng < west) west = p.lng;
    if (p.lng > east) east = p.lng;
    if (p.lat < south) south = p.lat;
    if (p.lat > north) north = p.lat;
  }
  // 1 deg lat ≈ 111 km. Longitude scaling depends on cosine of latitude.
  const midLat = (south + north) / 2;
  const latPad = padKm / 111;
  const lngPad = padKm / (111 * Math.max(0.01, Math.cos((midLat * Math.PI) / 180)));
  return {
    west: west - lngPad,
    east: east + lngPad,
    south: south - latPad,
    north: north + latPad,
  };
}

/**
 * Build the edit context for a given route. Reads the immutable
 * originalPoints from extras and combines with DOC trail samples in
 * the route's bbox+5km buffer. Idempotent — safe to call repeatedly.
 *
 * Returns null if extras is missing or has insufficient originalPoints.
 * Caller (enterDualEdit) is responsible for triggering migration via
 * useRouteEditStore.beginEdit if needed — this function does NOT call
 * migrateRouteIfNeeded directly. Migration delegation lives in
 * beginEdit because beginEdit is the path that captures pendingBeginArgs
 * for the v23 retry/skip/report UX (MigratorRetryPrompt).
 *
 * v31-fix (functional Blocker regression): v30 added migration here
 * but that bypassed beginEdit's pendingBeginArgs capture, making the
 * MigratorRetryPrompt unreachable. Reverted — caller must invoke
 * beginEdit first (which migrates and surfaces retry UI) and only
 * then call buildEditContext.
 */
export async function buildEditContext(routeId: string): Promise<EditContext | null> {
  const extras = await loadExtras(routeId);
  if (!extras || !extras.originalPoints || extras.originalPoints.length < 2) {
    return null;
  }

  const originalPoints: LngLat[] = extras.originalPoints.map(p => ({
    lng: p.lng,
    lat: p.lat,
  }));

  // Collect all corridor anchor points first — kdbush is finalized at
  // construction time (no add() method post-construction). Start with the
  // user's original GPS trace.
  const indexedPoints: IndexedPoint[] = originalPoints.map((p, i) => ({
    lng: p.lng,
    lat: p.lat,
    source: 'original' as const,
    refId: `${routeId}:original:${i}`,
  }));

  // Try to enrich with DOC trails in the route's neighborhood. This is
  // best-effort — failure (no coverage / network down / quota) yields a
  // null trailGraph, and the orchestrator falls back to Mapbox or straight.
  let trailGraph: TrailGraph | null = null;
  try {
    const bbox = padBboxKm(originalPoints, 5);
    const { trails } = await getCachedOrFetch(bbox);
    if (trails && trails.length > 0) {
      trailGraph = TrailGraph.fromTrails(trails);
      // Densify trails into the corridor index too — the corridor enforcement
      // wants any "actually walkable surface" as a corridor anchor, not just
      // the user's trace.
      for (let ti = 0; ti < trails.length; ti++) {
        const trail = trails[ti];
        // DOCTrailFeature.geometry.coordinates is typed as number[][] |
        // number[][][] (LineString vs MultiLineString). Normalise to
        // number[][][] (an array of parts) so the inner loop is uniform.
        const coords = trail.geometry.coordinates;
        const partsRaw: number[][][] =
          trail.geometry.type === 'MultiLineString'
            ? (coords as number[][][])
            : [coords as number[][]];
        for (let pi = 0; pi < partsRaw.length; pi++) {
          const part = partsRaw[pi];
          if (!part || part.length < 2) continue;
          const partLngLat: LngLat[] = part
            .filter(c => Array.isArray(c) && c.length >= 2)
            .map(c => ({ lng: c[0], lat: c[1] }));
          if (partLngLat.length < 2) continue;
          const dense = densify(partLngLat, 10);
          for (let i = 0; i < dense.length; i++) {
            indexedPoints.push({
              lng: dense[i].lng,
              lat: dense[i].lat,
              source: 'doc' as const,
              refId: `${trail.trackId}:${pi}:${i}`,
            });
          }
        }
      }
    }
  } catch {
    // DOC fetch / parse failed — proceed with original-only corridor.
    trailGraph = null;
  }

  const walkedIndex = new PointCloudIndex(indexedPoints);
  return { walkedIndex, trailGraph, originalPoints };
}
