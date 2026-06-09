/**
 * candidateNodes — given a selected RouteNodeAnchor, compute the set of
 * other anchors the user can drag to.
 *
 * v200 spec rules (locked with PO):
 *
 * Intersection node (degree>=3 graph junction):
 *   - Run Dijkstra from the source's graphNodeId, prune by 1km cost.
 *   - For every reachable node D (within 1km), validate that the
 *     resulting route A→D→Z (where A=prev anchor in route, Z=next anchor)
 *     stays within corridorRadiusM of the original walkedIndex.
 *   - The validation is cheap-pre-check: sample a few points along the
 *     straight A→D and D→Z lines and check each is inside corridor.
 *     The full re-route happens at commit time via existing
 *     applyMidpointDrag.
 *   - Filter out candidates where validation fails. User only sees
 *     guaranteed-draggable nodes.
 *
 * Endpoint node (start/end):
 *   - Trim candidates: nodes ON the current route, between this endpoint
 *     and the OTHER endpoint. (Implemented as workingPoints[k] for
 *     intermediate k that have a graphNodeId via routeNodeAnchors.)
 *   - Restore candidates: trim-restore-* anchors (originalPoints
 *     positions outside the current workingPoints slice).
 *   - No 1km corridor check — these are all on the original route.
 */

import type { RouteNodeAnchor } from './routeNodeAnchors';
import type { TrailGraph } from './graph/TrailGraph';
import type { PointCloudIndex } from './corridor/PointCloudIndex';
import type { LngLat } from './corridor/PolylineSampler';
import { dijkstra } from './graph/Dijkstra';
import { isPointInCorridor } from './corridor/CorridorQuery';
import { haversineM } from '../../utils/geo';

const REACH_RADIUS_M = 1000;

/**
 * Given the selected anchor and the full anchor list + supporting context,
 * return the subset of anchors that are valid drag targets.
 */
export function computeCandidates(args: {
  selected: RouteNodeAnchor;
  allAnchors: RouteNodeAnchor[];
  workingPoints: LngLat[];
  trailGraph: TrailGraph | null;
  walkedIndex: PointCloudIndex | null;
  corridorRadiusM: number;
}): RouteNodeAnchor[] {
  const { selected, allAnchors, workingPoints, trailGraph, walkedIndex, corridorRadiusM } = args;

  if (selected.kind === 'intersection') {
    return candidatesForIntersection({
      selected,
      allAnchors,
      workingPoints,
      trailGraph,
      walkedIndex,
      corridorRadiusM,
    });
  }
  if (selected.kind === 'endpoint-start' || selected.kind === 'endpoint-end') {
    return candidatesForEndpoint({ selected, allAnchors });
  }
  // Trim-restore anchors are themselves candidates surfaced when an
  // endpoint is tapped — they don't have their own candidate set.
  return [];
}

function candidatesForIntersection(args: {
  selected: RouteNodeAnchor;
  allAnchors: RouteNodeAnchor[];
  workingPoints: LngLat[];
  trailGraph: TrailGraph | null;
  walkedIndex: PointCloudIndex | null;
  corridorRadiusM: number;
}): RouteNodeAnchor[] {
  const { selected, allAnchors, workingPoints, trailGraph, walkedIndex, corridorRadiusM } = args;
  if (!trailGraph || !walkedIndex || !selected.graphNodeId) return [];

  // Source position in route (workingPointIdx). Need previous and next
  // anchors on the route to validate the new A→D→Z geometry.
  const idx = selected.workingPointIdx;
  if (idx === undefined || idx <= 0 || idx >= workingPoints.length - 1) return [];

  const prevPos = workingPoints[idx - 1];
  const nextPos = workingPoints[idx + 1];

  // Dijkstra with 1km cost cutoff — efficiently reachable subset.
  const result = dijkstra(trailGraph.nodes, selected.graphNodeId);

  const out: RouteNodeAnchor[] = [];
  for (const anchor of allAnchors) {
    if (anchor.id === selected.id) continue;
    if (anchor.kind !== 'intersection') continue;
    if (!anchor.graphNodeId) continue;

    const cost = result.distances.get(anchor.graphNodeId);
    if (cost === undefined || !Number.isFinite(cost)) continue;
    if (cost > REACH_RADIUS_M) continue;

    // Pre-check: sample 5 points each on prev→anchor and anchor→next
    // straight lines, all must be inside corridor.
    if (!segmentInCorridor(prevPos, anchor, walkedIndex, corridorRadiusM)) continue;
    if (!segmentInCorridor(anchor, nextPos, walkedIndex, corridorRadiusM)) continue;

    out.push(anchor);
  }
  return out;
}

function candidatesForEndpoint(args: {
  selected: RouteNodeAnchor;
  allAnchors: RouteNodeAnchor[];
}): RouteNodeAnchor[] {
  const { selected, allAnchors } = args;
  const isStart = selected.kind === 'endpoint-start';

  const out: RouteNodeAnchor[] = [];
  for (const anchor of allAnchors) {
    if (anchor.id === selected.id) continue;

    // Trim direction: intersection nodes ON the route between this
    // endpoint and the opposite endpoint.
    if (anchor.kind === 'intersection') {
      out.push(anchor);
      continue;
    }
    // Restore direction: trim-restore-* anchors of matching side.
    if (isStart && anchor.kind === 'trim-restore-start') {
      out.push(anchor);
      continue;
    }
    if (!isStart && anchor.kind === 'trim-restore-end') {
      out.push(anchor);
      continue;
    }
  }
  return out;
}

/**
 * Sample 5 evenly-spaced points along the straight line a→b. All must
 * lie within corridorRadiusM of the walkedIndex point cloud, otherwise
 * the new route segment leaves the corridor.
 *
 * Cheap pre-check — at commit time, applyMidpointDrag does the real
 * corridor enforcement on the actual graph-routed polyline. This pre-
 * check just filters out obvious losers so the UI doesn't show
 * candidates that are guaranteed to fail.
 */
function segmentInCorridor(
  a: { lng: number; lat: number },
  b: { lng: number; lat: number },
  walkedIndex: PointCloudIndex,
  corridorRadiusM: number,
): boolean {
  const SAMPLES = 5;
  for (let i = 0; i <= SAMPLES; i++) {
    const t = i / SAMPLES;
    const lng = a.lng + (b.lng - a.lng) * t;
    const lat = a.lat + (b.lat - a.lat) * t;
    const check = isPointInCorridor(lng, lat, walkedIndex, corridorRadiusM);
    if (!check.inCorridor) return false;
  }
  return true;
}

/**
 * Find the nearest candidate to a target screen drop point — used for
 * snap-on-drag-release. Returns null if no candidate is within
 * snapRadiusM.
 */
export function findNearestCandidate(
  candidates: RouteNodeAnchor[],
  targetLng: number,
  targetLat: number,
  snapRadiusM: number,
): RouteNodeAnchor | null {
  let best: RouteNodeAnchor | null = null;
  let bestDist = Infinity;
  for (const c of candidates) {
    const d = haversineM({ lat: targetLat, lng: targetLng }, { lat: c.lat, lng: c.lng });
    if (d < bestDist) {
      bestDist = d;
      best = c;
    }
  }
  if (bestDist > snapRadiusM) return null;
  return best;
}
