import type { RoutePoint } from '../../store/useRouteStore';
import {
  normalizeOrderedPoints,
  routePointDistanceM,
  type OrderedRouteDraft,
} from './orderedRouteDraft';
import { orderedShapeDeviationM } from './routePlanningProvider';

const RETRACE_TARGET_TOLERANCE_M = 20;
const RETRACE_PROVIDER_DEVIATION_M = 12;
const MAX_POINT_SNAP_M = 18;
const MIN_POINT_SNAP_M = 3;
const POINT_SNAP_PIXELS = 18;
const MAX_PROVIDER_START_SHIFT_M = 12;
const NEARBY_TARGET_MAX_DIRECT_M = 250;
const NEARBY_TARGET_MAX_ROUTE_M = 400;
const NEARBY_TARGET_MAX_INFLATION = 5;
const TERMINAL_SPUR_MIN_TURN_DEG = 65;
const CONTINUATION_MAX_TURN_DEG = 42;
const MAPPED_RESOLUTIONS = new Set(['point', 'draw-matched', 'recorded']);

export type PointCandidateSource = 'provider' | 'known-mapped-retrace' | 'continuity-snap';

export interface PointCandidateSelection {
  accepted: boolean;
  points: RoutePoint[];
  source: PointCandidateSource;
  reason: 'provider-faithful' | 'provider-moved-start' | 'provider-moved-target'
    | 'provider-absurd-detour' | 'no-provider-route' | 'known-retrace-faithful'
    | 'known-retrace-local' | 'continuity-terminal-spur';
  requiresChoice: false;
  rawTarget: RoutePoint;
  effectiveTarget: RoutePoint | null;
  providerTarget: RoutePoint | null;
  knownRetrace: RoutePoint[] | null;
  providerDeviationM: number | null;
  lengthInflation: number | null;
  providerStartShiftM: number;
  providerTargetShiftM: number;
  networkDistanceM: number;
  directDistanceM: number;
  knownRetraceLengthM: number | null;
  snapToleranceM: number;
  terminalSpurLengthM: number | null;
  alternatives: Array<{ source: Exclude<PointCandidateSource, 'continuity-snap'>; points: RoutePoint[] }>;
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

function localVector(a: RoutePoint, b: RoutePoint): { x: number; y: number } {
  const latitude = (a.lat + b.lat) * Math.PI / 360;
  return {
    x: (b.lng - a.lng) * 111_000 * Math.cos(latitude),
    y: (b.lat - a.lat) * 111_000,
  };
}

function angleDegrees(a: { x: number; y: number }, b: { x: number; y: number }): number {
  const denominator = Math.hypot(a.x, a.y) * Math.hypot(b.x, b.y);
  if (denominator <= 0) return 180;
  const cosine = Math.max(-1, Math.min(1, (a.x * b.x + a.y * b.y) / denominator));
  return Math.acos(cosine) * 180 / Math.PI;
}

/** 18 screen pixels, bounded so a wide view never becomes a remote snap. */
export function pointSnapToleranceM(latitude: number, zoom: number): number {
  const metresPerPixel = 156543.03392 * Math.cos(latitude * Math.PI / 180) / (2 ** zoom);
  return Math.max(MIN_POINT_SNAP_M, Math.min(MAX_POINT_SNAP_M, metresPerPixel * POINT_SNAP_PIXELS));
}

function latestDirection(points: RoutePoint[]): { x: number; y: number } | null {
  for (let index = points.length - 1; index > 0; index -= 1) {
    if (routePointDistanceM(points[index - 1], points[index]) >= 2) {
      return localVector(points[index - 1], points[index]);
    }
  }
  return null;
}

/** Find the latest eligible occurrence while preserving ordered revisits. */
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

  const flattened: Array<{ point: RoutePoint; partId: string }> = [];
  for (const part of parts) {
    part.points.forEach(point => {
      if (flattened.length && routePointDistanceM(flattened.at(-1)!.point, point) <= 0.35) return;
      flattened.push({ point, partId: part.id });
    });
  }
  if (flattened.length < 2) return null;
  let selected: null | {
    segmentIndex: number; fraction: number; point: RoutePoint; distanceM: number; partId: string;
  } = null;
  for (let index = 0; index < flattened.length - 1; index += 1) {
    const hit = project(target, flattened[index].point, flattened[index + 1].point);
    if (hit.distanceM > toleranceM) continue;
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

function baseResult(input: {
  draft: OrderedRouteDraft;
  target: RoutePoint;
  provider: RoutePoint[];
  zoom?: number;
}): Omit<PointCandidateSelection, 'accepted' | 'points' | 'source' | 'reason' | 'effectiveTarget' | 'terminalSpurLengthM'> & {
  provider: RoutePoint[];
  known: ReturnType<typeof knownMappedRetrace>;
} {
  const provider = normalizeOrderedPoints(input.provider);
  const draftPoints = input.draft.parts.flatMap(part => part.points);
  const start = draftPoints.at(-1) ?? input.draft.startPoint ?? provider[0];
  const directDistanceM = start ? routePointDistanceM(start, input.target) : Number.POSITIVE_INFINITY;
  const providerStartShiftM = provider.length && start ? routePointDistanceM(start, provider[0]) : Number.POSITIVE_INFINITY;
  const providerTargetShiftM = provider.length ? routePointDistanceM(provider.at(-1)!, input.target) : Number.POSITIVE_INFINITY;
  const networkDistanceM = provider.length >= 2 ? lengthM(provider) : Number.POSITIVE_INFINITY;
  const snapToleranceM = pointSnapToleranceM(input.target.lat, input.zoom ?? 16);
  const known = knownMappedRetrace(input.draft, input.target, snapToleranceM);
  const knownRetraceLengthM = known ? lengthM(known.points) : null;
  const providerDeviationM = known && provider.length >= 2
    ? orderedShapeDeviationM(known.points, provider)
    : null;
  const lengthInflation = knownRetraceLengthM && Number.isFinite(networkDistanceM)
    ? networkDistanceM / knownRetraceLengthM
    : null;
  return {
    provider,
    known,
    requiresChoice: false,
    rawTarget: { ...input.target },
    providerTarget: provider.length ? { ...provider.at(-1)! } : null,
    knownRetrace: known?.points ?? null,
    providerDeviationM,
    lengthInflation,
    providerStartShiftM,
    providerTargetShiftM,
    networkDistanceM,
    directDistanceM,
    knownRetraceLengthM,
    snapToleranceM,
    alternatives: [
      ...(provider.length >= 2 ? [{ source: 'provider' as const, points: provider }] : []),
      ...(known ? [{ source: 'known-mapped-retrace' as const, points: known.points }] : []),
    ],
    occurrence: known?.occurrence ?? null,
  };
}

/**
 * Select walking/provider-backed geometry only. A short transverse terminal
 * spur may be removed when the recent route and provider path both show a
 * stable continuation. The raw target remains recorded separately.
 */
export function selectPointRouteCandidate(input: {
  draft: OrderedRouteDraft;
  target: RoutePoint;
  provider: RoutePoint[];
  zoom?: number;
}): PointCandidateSelection {
  const base = baseResult(input);
  const { provider, known, ...diagnostics } = base;
  const rejected = (reason: PointCandidateSelection['reason']): PointCandidateSelection => ({
    ...diagnostics,
    accepted: false,
    points: [],
    source: 'provider',
    reason,
    effectiveTarget: null,
    terminalSpurLengthM: null,
  });
  if (provider.length < 2) return rejected('no-provider-route');
  if (base.providerStartShiftM > MAX_PROVIDER_START_SHIFT_M) return rejected('provider-moved-start');
  if (base.providerTargetShiftM > base.snapToleranceM) return rejected('provider-moved-target');
  // A nearby closure may legitimately cross a barrier, but accepting a
  // kilometres-long provider detour for a target a few metres away is never
  // a safe Point edit. Leave the canonical Route unchanged and let Draw make
  // the intended local connection explicit.
  if (base.directDistanceM <= NEARBY_TARGET_MAX_DIRECT_M
    && base.networkDistanceM > Math.max(
      NEARBY_TARGET_MAX_ROUTE_M,
      base.directDistanceM * NEARBY_TARGET_MAX_INFLATION,
    )) return rejected('provider-absurd-detour');

  const draftPoints = input.draft.parts.flatMap(part => part.points);
  const routeDirection = latestDirection(draftPoints);
  if (provider.length >= 3 && routeDirection) {
    const beforeSpur = provider.at(-3)!;
    const spurStart = provider.at(-2)!;
    const spurEnd = provider.at(-1)!;
    const precedingVector = localVector(beforeSpur, spurStart);
    const spurVector = localVector(spurStart, spurEnd);
    const terminalSpurLengthM = routePointDistanceM(spurStart, spurEnd);
    const precedingLengthM = routePointDistanceM(beforeSpur, spurStart);
    const followsRoute = angleDegrees(routeDirection, precedingVector) <= CONTINUATION_MAX_TURN_DEG;
    const transverse = angleDegrees(precedingVector, spurVector) >= TERMINAL_SPUR_MIN_TURN_DEG;
    const rawNearContinuation = routePointDistanceM(input.target, spurStart) <= base.snapToleranceM;
    if (terminalSpurLengthM >= 1.5
      && terminalSpurLengthM <= base.snapToleranceM
      && precedingLengthM >= Math.max(8, terminalSpurLengthM * 1.5)
      && followsRoute
      && transverse
      && rawNearContinuation) {
      const points = provider.slice(0, -1);
      return {
        ...diagnostics,
        accepted: true,
        points,
        source: 'continuity-snap',
        reason: 'continuity-terminal-spur',
        effectiveTarget: { ...points.at(-1)! },
        terminalSpurLengthM,
      };
    }
  }

  const localKnownRetrace = known && base.knownRetraceLengthM != null
    && known.occurrence != null
    && known.occurrence.distanceM <= 3
    && base.knownRetraceLengthM <= Math.max(250, base.directDistanceM * 2.5)
    && ((base.providerDeviationM ?? 0) > Math.max(RETRACE_PROVIDER_DEVIATION_M, base.snapToleranceM)
      || (base.lengthInflation ?? 1) > 1.2);
  if (localKnownRetrace) {
    return {
      ...diagnostics,
      accepted: true,
      points: known.points,
      source: 'known-mapped-retrace',
      reason: 'known-retrace-local',
      effectiveTarget: { ...known.points.at(-1)! },
      terminalSpurLengthM: null,
    };
  }

  // Earlier coordinates do not win by identity alone. Reuse a known ordered
  // retrace only when the provider independently returned the same corridor.
  if (known && base.providerDeviationM != null && base.knownRetraceLengthM != null
    && base.providerDeviationM <= Math.max(RETRACE_PROVIDER_DEVIATION_M, base.snapToleranceM)
    && base.lengthInflation != null && base.lengthInflation >= 0.75 && base.lengthInflation <= 1.5) {
    return {
      ...diagnostics,
      accepted: true,
      points: known.points,
      source: 'known-mapped-retrace',
      reason: 'known-retrace-faithful',
      effectiveTarget: { ...known.points.at(-1)! },
      terminalSpurLengthM: null,
    };
  }

  return {
    ...diagnostics,
    accepted: true,
    points: provider,
    source: 'provider',
    reason: 'provider-faithful',
    effectiveTarget: { ...provider.at(-1)! },
    terminalSpurLengthM: null,
  };
}
