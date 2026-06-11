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
import { uploadEditDiag } from './editDiagUploader';
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
      // v213 fix: bbox padding was 5km on each axis ⇒ 100km² for a short
      // 0.7km city route ⇒ 50k-200k vertex in dense urban areas ⇒ trips
      // maxVertexCount=20000 ⇒ trailGraph=null ⇒ endpoint-only mode (the
      // exact regression the v211 broaden-class commit was meant to fix).
      // Corridor enforcement uses 1km radius (editCorridorRadiusMeters),
      // so 1.5km padding = 1km corridor + 0.5km safety is the smallest
      // safe size. Cuts bbox area by ~10× for short routes; long routes
      // still fit comfortably (a 10km route needs 10km × 10km min,
      // 1.5km pad gives 13km × 13km).
      const bbox = padBboxKm(originalPoints, 1.5);
      const result = await extractJunctions(mapRef, bbox, {
        minDegree: 3,
        densifyIntervalM: 10,
      });
      // v215 diagnostic log: surface extractor outcome to console so
      // we can see in production telemetry whether junction emission
      // failures are upstream (Mapbox returned 0 features), midstream
      // (no junctions detected), or downstream (graph built but
      // routeNodeAnchors couldn't find matches).
      // v216: also fire-and-forget upload to /api/edit-diag.
      const extractDiag = {
        ok: result.ok,
        error: result.ok ? null : result.error,
        ways: result.ok ? result.ways.length : 0,
        junctions: result.ok ? result.junctions.length : 0,
        rawFeatureCount: result.ok
          ? result.diagnostics.rawFeatureCount
          : result.diagnostics?.rawFeatureCount,
        rawVertexCount: result.ok
          ? result.diagnostics.rawVertexCount
          : result.diagnostics?.rawVertexCount,
        extractMs: result.ok
          ? result.diagnostics.extractMs
          : result.diagnostics?.extractMs,
        bboxArea: result.ok
          ? result.diagnostics.bboxArea
          : result.diagnostics?.bboxArea,
        routeId,
        bboxWest: bbox.west,
        bboxSouth: bbox.south,
        bboxEast: bbox.east,
        bboxNorth: bbox.north,
      };
      if (typeof console !== 'undefined' && console.log) {
        console.log('[edit-diag-extract]', extractDiag);
      }
      uploadEditDiag('extract', extractDiag);
      if (result.ok && result.ways.length > 0) {
        // v223: log entry into graph build branch — diag id<34 showed
        // extract OK but no graph/anchors uploads, meaning either the
        // try/catch swallowed silently OR buildTrailGraphFromMapbox
        // didn't return. Cap ways count BEFORE feeding TrailGraph:
        // 5843 ways × ~51 vertex = ~300k vertex feeding kdbush
        // union-find — likely OOM/RangeError on RN Hermes. Cap to
        // 1500 ways (sample evenly, preserve junction-relevant ones).
        const MAX_WAYS_FOR_GRAPH = 1500;
        let waysForGraph = result.ways;
        let waysSubsampled = false;
        if (result.ways.length > MAX_WAYS_FOR_GRAPH) {
          waysSubsampled = true;
          const step = Math.ceil(result.ways.length / MAX_WAYS_FOR_GRAPH);
          waysForGraph = result.ways.filter((_, i) => i % step === 0);
        }
        uploadEditDiag('graph-enter', {
          routeId,
          waysIn: result.ways.length,
          waysForGraph: waysForGraph.length,
          waysSubsampled,
        });
        try {
          trailGraph = buildTrailGraphFromMapbox({
            ...result,
            ways: waysForGraph,
          });
        } catch (e: any) {
          uploadEditDiag('graph-error', {
            routeId,
            ways: waysForGraph.length,
            message: e?.message ?? String(e),
            name: e?.name ?? 'unknown',
          });
          trailGraph = null;
        }
        if (trailGraph) {
          // v220 fix: pull diag log out of console.log gate so the
          // upload always fires. v219 had it nested under
          // `if (typeof console !== 'undefined' && console.log)` — in
          // RN production the babel transform may strip the entire
          // block, including the upload. The console line stays gated
          // (cheap dev signal); the upload is unconditional.
          const degHist: Record<number, number> = {};
          for (const n of trailGraph.nodes.values()) {
            const d = n.edges.length;
            degHist[d] = (degHist[d] ?? 0) + 1;
          }
          if (typeof console !== 'undefined' && console.log) {
            console.log('[edit-diag-graph]', {
              nodeCount: trailGraph.nodes.size,
              truncated: trailGraph.truncated,
              degHist,
            });
          }
          uploadEditDiag('graph', {
            routeId,
            nodeCount: trailGraph.nodes.size,
            truncated: trailGraph.truncated,
            degHist,
          });
          // Densify ways into the corridor index too — same role DOC played.
          // PointSource 'doc' is reused for Mapbox-sourced points; consumers
          // (corridor enforcement) only care about lng/lat. See PointCloudIndex.
          // v208 fix C4: dedupe by 5-decimal-place fingerprint (~1.1m)
          // before pushing into indexedPoints. Mapbox ways share vertices
          // at junctions — without dedupe, a 5km city bbox can produce
          // 10000+ duplicates which makes kdbush construction (~300ms)
          // visibly block the UI on first edit. Original GPS points
          // (above) are NOT deduped since they're real samples and
          // unlikely to share fingerprints.
          const seenFp = new Set<string>();
          for (const w of result.ways) {
            for (let i = 0; i < w.coords.length; i++) {
              const c = w.coords[i];
              const fp = `${c.lng.toFixed(5)}_${c.lat.toFixed(5)}`;
              if (seenFp.has(fp)) continue;
              seenFp.add(fp);
              indexedPoints.push({
                lng: c.lng,
                lat: c.lat,
                source: 'doc' as const,
                refId: `mb:${w.id}:${i}`,
              });
            }
          }
        }
      }
      // result.ok === false: trailGraph stays null. Editor opens with
      // endpoint-only anchors (trim still works). No throw, no banner here —
      // upstream UI surfaces the limited-edit state.
    } catch (e: any) {
      // Mapbox extraction threw unexpectedly — proceed with original-only corridor.
      uploadEditDiag('extract-error', {
        routeId,
        message: e?.message ?? String(e),
        name: e?.name ?? 'unknown',
      });
      trailGraph = null;
    }
  }
  // mapRef absent (legacy callers / tests without a MapView): trailGraph
  // stays null, edit mode runs with endpoints only. This is the same fallback
  // pre-Mapbox-migration callers experienced when DOC returned 0 trails.

  const walkedIndex = new PointCloudIndex(indexedPoints);
  return { walkedIndex, trailGraph, originalPoints };
}
