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
 */

import type { LngLat } from './corridor/PolylineSampler';
import type { TrailGraph } from './graph/TrailGraph';
import { haversineM } from '../../utils/geo';

const SNAP_TOLERANCE_M = 30;
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

  // Intersection nodes — only if a graph exists.
  if (trailGraph) {
    const startCoord = workingPoints[0];
    const endCoord = workingPoints[lastIdx];
    const seenJunctionIds = new Set<string>();

    for (let i = 1; i < lastIdx; i++) {
      const p = workingPoints[i];
      const snap = trailGraph.snapToGraph(p.lng, p.lat);
      if (!snap) continue;
      if (snap.distance > SNAP_TOLERANCE_M) continue;

      const node = trailGraph.nodes.get(snap.nodeId);
      if (!node) continue;
      if (node.edges.length < MIN_INTERSECTION_DEGREE) continue;

      if (seenJunctionIds.has(snap.nodeId)) continue;

      const meta = trailGraph.meta.get(snap.nodeId);
      if (!meta) continue;
      const distFromStart = haversineM(
        { lat: meta.lat, lng: meta.lng },
        { lat: startCoord.lat, lng: startCoord.lng },
      );
      if (distFromStart < ENDPOINT_EXCLUSION_M) continue;
      const distFromEnd = haversineM(
        { lat: meta.lat, lng: meta.lng },
        { lat: endCoord.lat, lng: endCoord.lng },
      );
      if (distFromEnd < ENDPOINT_EXCLUSION_M) continue;

      seenJunctionIds.add(snap.nodeId);
      anchors.push({
        kind: 'intersection',
        lng: meta.lng,
        lat: meta.lat,
        workingPointIdx: i,
        graphNodeId: snap.nodeId,
        id: `int-${snap.nodeId}`,
      });
    }
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
