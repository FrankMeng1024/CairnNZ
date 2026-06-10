/**
 * editContext — Build the graph + index inputs needed by useRouteEditStore.beginEdit
 * for an existing route. Centralises the wiring between LocalRouteExtras (the
 * authoritative original GPS trace) and the corridor / DOC / Mapbox routing
 * layers consumed by the RouteEditOrchestrator.
 *
 * Sprint 66 Wave 7 integration glue.
 */
import type { RefObject } from 'react';
import { loadExtras } from '../LocalRouteExtras';
import { PointCloudIndex, IndexedPoint } from './corridor/PointCloudIndex';
// densify retained — re-imported only if a future Sprint re-enables a
// pre-densify path. Mapbox extractor already returns 10m-densified ways.
import { TrailGraph } from './graph/TrailGraph';
import { extractJunctions } from './mapbox/MapboxJunctionExtractor';
import { buildTrailGraphFromMapbox } from './mapbox/buildTrailGraphFromMapbox';
// getCachedOrFetch import removed — DOC ArcGIS pipeline retained in tree
// (doctrails/) but no longer wired in. NZ-region merge deferred to a later
// Sprint. Re-introduce this import + getCachedOrFetch call if reverting.
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
export async function buildEditContext(
  routeId: string,
  mapRef?: RefObject<any> | { current: any } | null,
): Promise<EditContext | null> {
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

  // Try to enrich with Mapbox vector tile road/trail features in the route's
  // neighborhood. This is best-effort — failure (no map ref / zoom too low /
  // sparse OSM coverage) yields a null trailGraph, and the editor falls back
  // to endpoint-only mode. The Mapbox extractor reads from tiles already
  // loaded by the running MapView for rendering — no network call.
  let trailGraph: TrailGraph | null = null;
  if (mapRef && mapRef.current) {
    try {
      const bbox = padBboxKm(originalPoints, 5);
      const result = await extractJunctions(mapRef, bbox, {
        minDegree: 3,
        densifyIntervalM: 10,
      });
      if (result.ok && result.ways.length > 0) {
        trailGraph = buildTrailGraphFromMapbox(result);
        // Densify ways into the corridor index too — same role DOC played.
        // PointSource 'doc' is reused for Mapbox-sourced points; consumers
        // (corridor enforcement) only care about lng/lat. See PointCloudIndex.
        for (const w of result.ways) {
          for (let i = 0; i < w.coords.length; i++) {
            indexedPoints.push({
              lng: w.coords[i].lng,
              lat: w.coords[i].lat,
              source: 'doc' as const,
              refId: `mb:${w.id}:${i}`,
            });
          }
        }
      }
      // result.ok === false: trailGraph stays null. Editor opens with
      // endpoint-only anchors (trim still works). No throw, no banner here —
      // upstream UI surfaces the limited-edit state.
    } catch {
      // Mapbox extraction threw unexpectedly — proceed with original-only corridor.
      trailGraph = null;
    }
  }
  // mapRef absent (legacy callers / tests without a MapView): trailGraph
  // stays null, edit mode runs with endpoints only. This is the same fallback
  // pre-Mapbox-migration callers experienced when DOC returned 0 trails.

  const walkedIndex = new PointCloudIndex(indexedPoints);
  return { walkedIndex, trailGraph, originalPoints };
}
