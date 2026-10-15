import type { RoutePoint } from '../../store/useRouteStore';
import {
  normalizeOrderedPoints,
  routePointDistanceM,
  type OrderedRouteDraft,
} from './orderedRouteDraft';
import { orderedShapeDeviationM } from './routePlanningProvider';

const RETRACE_TARGET_TOLERANCE_M = 20;
const RETRACE_PROVIDER_DEVIATION_M = 12;
const MAPPED_RESOLUTIONS = new Set(['point', 'draw-matched', 'recorded']);

export interface PointCandidateSelection {
  points: RoutePoint[];
  source: 'provider' | 'known-mapped-retrace';
  reason: 'provider-faithful' | 'no-known-retrace' | 'provider-detour' | 'provider-length-inflation';
  knownRetrace: RoutePoint[] | null;
  providerDeviationM: number | null;
  lengthInflation: number | null;
  occurrence: { partId: string; segmentIndex: number; fraction: number; distanceM: number } | null;
}

function project(point: RoutePoint, a: RoutePoint, b: RoutePoint) {
  const metresPerLat = 111_000;
  const metresPerLng = metresPerLat * Math.cos(point.lat * Math.PI / 180);
  const ax = (a.lng - point.lng) * metresPerLng;
  const ay = (a.lat - point.lat) * metresPerLat;
  const bx = (b.lng - point.lng) * metresPerLng;
  const by = (b.lat - point.lat) * metresPerLat;
  const dx = bx - ax;
  const dy = by - ay;
  const denominator = dx * dx + dy * dy;
  const fraction = denominator > 0 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / denominator)) : 0;
  const projected = {
    lat: a.lat + (b.lat - a.lat) * fraction,
    lng: a.lng + (b.lng - a.lng) * fraction,
  };
  return { fraction, point: projected, distanceM: routePointDistanceM(point, projected) };
}

function lengthM(points: RoutePoint[]): number {
  return points.slice(1).reduce((sum, point, index) => sum + routePointDistanceM(points[index], point), 0);
}

/**
 * Find the latest eligible occurrence of the requested target before the
 * current endpoint. Latest-occurrence ownership preserves ordered repeated
 * traversals (A→B→A→B) instead of collapsing equal coordinates as a set.
 */
export function knownMappedRetrace(
  draft: OrderedRouteDraft,
  target: RoutePoint,
  toleranceM = RETRACE_TARGET_TOLERANCE_M,
): { points: RoutePoint[]; occurrence: PointCandidateSelection['occurrence'] } | null {
  if (!draft.parts.length) return null;
  const gapAfter = new Set(draft.gaps.map(gap => gap.afterPartId));
  let firstEligiblePart = draft.parts.length - 1;
  while (firstEligiblePart > 0
    && !gapAfter.has(draft.parts[firstEligiblePart - 1].id)
    && MAPPED_RESOLUTIONS.has(draft.parts[firstEligiblePart - 1].resolution)
    && MAPPED_RESOLUTIONS.has(draft.parts[firstEligiblePart].resolution)) {
    firstEligiblePart -= 1;
  }
  const parts = draft.parts.slice(firstEligiblePart);
  if (!parts.every(part => MAPPED_RESOLUTIONS.has(part.resolution))) return null;

  const flattened: Array<{ point: RoutePoint; partId: string; pointIndex: number }> = [];
  for (const part of parts) {
    part.points.forEach((point, pointIndex) => {
      if (flattened.length && routePointDistanceM(flattened.at(-1)!.point, point) <= 0.35) return;
      flattened.push({ point, partId: part.id, pointIndex });
    });
  }
  if (flattened.length < 2) return null;
  let selected: null | {
    segmentIndex: number; fraction: number; point: RoutePoint; distanceM: number; partId: string;
  } = null;
  for (let index = 0; index < flattened.length - 1; index += 1) {
    const hit = project(target, flattened[index].point, flattened[index + 1].point);
    if (hit.distanceM > toleranceM) continue;
    // The terminal occurrence itself is not a retrace target.
    if (index === flattened.length - 2 && hit.fraction >= 0.995) continue;
    const candidate = { ...hit, segmentIndex: index, partId: flattened[index].partId };
    if (!selected
      || candidate.segmentIndex + candidate.fraction > selected.segmentIndex + selected.fraction
      || (candidate.segmentIndex === selected.segmentIndex && candidate.fraction === selected.fraction
        && candidate.distanceM < selected.distanceM)) selected = candidate;
  }
  if (!selected) return null;
  const forward = [selected.point, ...flattened.slice(selected.segmentIndex + 1).map(item => item.point)];
  const reversed = normalizeOrderedPoints(forward.reverse());
  if (reversed.length < 2) return null;
  reversed[reversed.length - 1] = { ...target };
  return {
    points: reversed,
    occurrence: {
      partId: selected.partId,
      segmentIndex: selected.segmentIndex,
      fraction: selected.fraction,
      distanceM: selected.distanceM,
    },
  };
}

export function selectPointRouteCandidate(input: {
  draft: OrderedRouteDraft;
  target: RoutePoint;
  provider: RoutePoint[];
}): PointCandidateSelection {
  const provider = normalizeOrderedPoints(input.provider);
  const known = knownMappedRetrace(input.draft, input.target);
  if (!known) return {
    points: provider, source: 'provider', reason: 'no-known-retrace', knownRetrace: null,
    providerDeviationM: null, lengthInflation: null, occurrence: null,
  };
  const knownLength = Math.max(0.01, lengthM(known.points));
  const inflation = lengthM(provider) / knownLength;
  const deviation = orderedShapeDeviationM(known.points, provider);
  if (inflation > 1.2 || deviation > RETRACE_PROVIDER_DEVIATION_M) {
    return {
      points: known.points,
      source: 'known-mapped-retrace',
      reason: inflation > 1.2 ? 'provider-length-inflation' : 'provider-detour',
      knownRetrace: known.points,
      providerDeviationM: deviation,
      lengthInflation: inflation,
      occurrence: known.occurrence,
    };
  }
  return {
    points: provider,
    source: 'provider',
    reason: 'provider-faithful',
    knownRetrace: known.points,
    providerDeviationM: deviation,
    lengthInflation: inflation,
    occurrence: known.occurrence,
  };
}

