/**
 * routeNodeAnchors — identify "editable junction nodes" along a snapped
 * route polyline.
 *
 * v200 spec: when the user enters edit-mode on a route, every visible
 * tappable circle is a "node anchor" — either an intersection node
 * (snap-to-road junction with degree>=3) on the route, or one of the two
 * endpoints (always present, drives trim).
 *
 * For trim restoration the spec also exposes the trimmed-off prefix /
 * suffix points from the original GPS trace as "trim-restore" anchors —
 * tapping the current endpoint lights them up so the user can extend the
 * route back toward originalPoints[0] / [last].
 *
 * NOTE: trim-restore anchors carry an originalPointIdx, NOT a
 * workingPointIdx (because they aren't on workingPoints). The store-side
 * trim/restore logic must consume both kinds.
 *
 * v215 (HM6 root-cause fix): junction emission switched from "for each
 * GPS sample, snap to graph" to "for each graph junction, project onto
 * route polyline". GPS samples sit on sidewalks while Mapbox road
 * features are road centerlines (10-15m offset in Shanghai-class wide
 * streets). The old direction filtered by 30m sidewalk-to-centerline
 * snap distance AND required the nearest neighbor to be a degree-3
 * junction (often it was a degree-2 densified vertex on the same
 * centerline). The new direction projects each junction directly onto
 * the route polyline — the polyline-to-junction distance is the right
 * metric, decoupled from GPS sample density.
 */

import type { LngLat } from './corridor/PolylineSampler';
import type { TrailGraph } from './graph/TrailGraph';
import { haversineM } from '../../utils/geo';
import { uploadEditDiag } from './editDiagUploader';

const ROUTE_PROXIMITY_TOLERANCE_M = 30;
const ENDPOINT_EXCLUSION_M = 50;
const MIN_INTERSECTION_DEGREE = 3;

export type RouteNodeAnchorKind =
  | 'endpoint-start'
  | 'endpoint-end'
  | 'intersection'
  | 'trim-restore-start'
  | 'trim-restore-end';

export interface RouteNodeAnchor {
  kind: RouteNodeAnchorKind;
  lng: number;
  lat: number;
  workingPointIdx?: number;
  originalPointIdx?: number;
  graphNodeId?: string;
  id: string;
}

export function computeRouteNodeAnchors(args: {
  workingPoints: LngLat[];
  originalPoints: LngLat[];
  trailGraph: TrailGraph | null;
}): RouteNodeAnchor[] {
  const { workingPoints, originalPoints, trailGraph } = args;
  if (workingPoints.length < 2) return [];

  const anchors: RouteNodeAnchor[] = [];
  const lastIdx = workingPoints.length - 1;

  // Endpoints — always present.
  anchors.push({
    kind: 'endpoint-start',
    lng: workingPoints[0].lng,
    lat: workingPoints[0].lat,
    workingPointIdx: 0,
    id: 'endpoint-start',
  });
  anchors.push({
    kind: 'endpoint-end',
    lng: workingPoints[lastIdx].lng,
    lat: workingPoints[lastIdx].lat,
    workingPointIdx: lastIdx,
    id: 'endpoint-end',
  });

  // Intersection nodes — forward projection from graph junctions onto
  // the route polyline. (See file-header note on the v215 algorithm
  // change.)
  let stats = { degOk: 0, projTooFar: 0, endpointExcl: 0, accepted: 0 };
  if (trailGraph) {
    const startCoord = workingPoints[0];
    const endCoord = workingPoints[lastIdx];

    // Iterate every graph node; keep only degree>=3 (true junctions).
    for (const [nodeId, node] of trailGraph.nodes) {
      // v220 fix: skip the truncated-overflow bucket. When a graph hits
      // MAX_GRAPH_NODES, all overflow vertices fold into a single
      // 'tnTRUNC' node whose coordinates are the first overflow
      // vertex's lng/lat (arbitrary) and whose edge count balloons to
      // hundreds. Treating that as a real junction puts an anchor at a
      // garbage coord and bloats degree statistics.
      if (nodeId === 'tnTRUNC') continue;
      if (node.edges.length < MIN_INTERSECTION_DEGREE) continue;
      stats.degOk += 1;

      const meta = trailGraph.meta.get(nodeId);
      if (!meta) continue;
      const junctionLngLat = { lng: meta.lng, lat: meta.lat };

      // Find the closest segment on the route polyline.
      const proj = projectPointToPolyline(junctionLngLat, workingPoints);
      if (!proj) continue;
      if (proj.distanceM > ROUTE_PROXIMITY_TOLERANCE_M) {
        stats.projTooFar += 1;
        continue;
      }

      // Endpoint exclusion: drop junctions within 50m of either endpoint.
      const distFromStart = haversineM(junctionLngLat, startCoord);
      if (distFromStart < ENDPOINT_EXCLUSION_M) {
        stats.endpointExcl += 1;
        continue;
      }
      const distFromEnd = haversineM(junctionLngLat, endCoord);
      if (distFromEnd < ENDPOINT_EXCLUSION_M) {
        stats.endpointExcl += 1;
        continue;
      }

      stats.accepted += 1;
      anchors.push({
        kind: 'intersection',
        lng: meta.lng,
        lat: meta.lat,
        // workingPointIdx tracks the polyline segment-end-index so
        // candidate ordering by along-route position remains stable.
        workingPointIdx: proj.segmentEndIdx,
        graphNodeId: nodeId,
        id: `int-${nodeId}`,
      });
    }
  }

  // Diagnostics: surface anchor pipeline stats so we can see in
  // production why so few intersections show up. Only emit when a graph
  // exists — without a graph the diagnostics are vacuous and would just
  // spam the unit-test console.
  if (trailGraph) {
    const diagPayload = {
      workingPoints: workingPoints.length,
      originalPoints: originalPoints.length,
      graphNodes: trailGraph.nodes.size,
      graphTruncated: trailGraph.truncated,
      junctionStats: stats,
      finalAnchorCount: anchors.length,
    };
    if (typeof console !== 'undefined' && console.log) {
      console.log('[edit-diag-anchors]', diagPayload);
    }
    uploadEditDiag('anchors', diagPayload);
  }

  // Trim-restore anchors.
  const firstWorkingIdxInOriginal = findIndexNear(originalPoints, workingPoints[0]);
  const lastWorkingIdxInOriginal = findIndexNear(originalPoints, workingPoints[lastIdx]);

  if (firstWorkingIdxInOriginal !== null && firstWorkingIdxInOriginal > 0) {
    for (let k = 0; k < firstWorkingIdxInOriginal; k++) {
      const op = originalPoints[k];
      anchors.push({
        kind: 'trim-restore-start',
        lng: op.lng,
        lat: op.lat,
        originalPointIdx: k,
        id: `restore-start-${k}`,
      });
    }
  }
  if (
    lastWorkingIdxInOriginal !== null &&
    lastWorkingIdxInOriginal < originalPoints.length - 1
  ) {
    for (let k = lastWorkingIdxInOriginal + 1; k < originalPoints.length; k++) {
      const op = originalPoints[k];
      anchors.push({
        kind: 'trim-restore-end',
        lng: op.lng,
        lat: op.lat,
        originalPointIdx: k,
        id: `restore-end-${k}`,
      });
    }
  }

  return anchors;
}

function findIndexNear(
  pts: LngLat[],
  target: LngLat,
): number | null {
  const TOL_M = 5;
  let bestIdx: number | null = null;
  let bestDist = Infinity;
  for (let i = 0; i < pts.length; i++) {
    const d = haversineM(
      { lat: pts[i].lat, lng: pts[i].lng },
      { lat: target.lat, lng: target.lng },
    );
    if (d < bestDist) {
      bestDist = d;
      bestIdx = i;
    }
  }
  if (bestDist > TOL_M) return null;
  return bestIdx;
}

/**
 * Project a point onto a polyline; return the closest segment along with
 * the perpendicular distance in meters. Used by the v215 forward-projection
 * junction-anchor algorithm.
 *
 * `segmentEndIdx` is the index of the polyline vertex AFTER the closest
 * segment. Used as `workingPointIdx` so candidate sort-by-route-order
 * stays stable.
 */
function projectPointToPolyline(
  p: LngLat,
  poly: LngLat[],
): { distanceM: number; segmentEndIdx: number } | null {
  if (poly.length < 2) return null;
  let bestDist = Infinity;
  let bestEndIdx = -1;
  for (let i = 1; i < poly.length; i++) {
    const a = poly[i - 1];
    const b = poly[i];
    const d = pointToSegmentMeters(p, a, b);
    if (d < bestDist) {
      bestDist = d;
      bestEndIdx = i;
    }
  }
  if (bestEndIdx < 0) return null;
  return { distanceM: bestDist, segmentEndIdx: bestEndIdx };
}

/**
 * Perpendicular meters from point p to the line segment a→b.
 * Equirectangular projection at the segment's mid-latitude — accurate
 * to ~1m at city scale, the precision we need for 30m tolerance gates.
 */
function pointToSegmentMeters(p: LngLat, a: LngLat, b: LngLat): number {
  const midLat = (a.lat + b.lat) / 2;
  const cosLat = Math.cos((midLat * Math.PI) / 180);
  const M_PER_DEG = 111000;
  const ax = a.lng * cosLat * M_PER_DEG;
  const ay = a.lat * M_PER_DEG;
  const bx = b.lng * cosLat * M_PER_DEG;
  const by = b.lat * M_PER_DEG;
  const px = p.lng * cosLat * M_PER_DEG;
  const py = p.lat * M_PER_DEG;
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq < 1e-9) {
    // a == b: point distance to a
    const ddx = px - ax;
    const ddy = py - ay;
    return Math.sqrt(ddx * ddx + ddy * ddy);
  }
  let t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
  if (t < 0) t = 0;
  else if (t > 1) t = 1;
  const fx = ax + t * dx;
  const fy = ay + t * dy;
  const ex = px - fx;
  const ey = py - fy;
  return Math.sqrt(ex * ex + ey * ey);
}
