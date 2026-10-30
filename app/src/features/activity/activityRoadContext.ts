import { haversineM } from '../../utils/geo';
import {
  activityPresentationIdentity,
  activityPresentationScopeKey,
  sameActivityPresentationPoint,
} from './activityPresentationIdentity';

export type ActivityRoadContextAvailability =
  | 'available'
  | 'no-road-features'
  | 'outside-viewport'
  | 'map-not-ready'
  | 'unsupported'
  | 'query-error';

export interface ActivityRoadCorridor {
  id: string;
  coordinates: Array<[number, number]>;
  styleLayerId: string | null;
  sourceLayerId: string | null;
  roadClass: string | null;
  structure: 'surface' | 'bridge' | 'tunnel' | 'unknown';
}

export interface ActivityRoadObstacle {
  id: string;
  /** GeoJSON polygon rings: the first is the shell and the rest are holes. */
  rings: Array<Array<[number, number]>>;
  styleLayerId: string | null;
  sourceLayerId: string | null;
  provenance: 'rendered-building-polygon';
}

export interface ActivityRoadContext {
  availability: ActivityRoadContextAvailability;
  provenance: 'mapbox-rendered-features';
  mapMountId: string;
  styleGeneration: number;
  viewportGeneration: number;
  queryGeneration: number;
  queriedAtMs: number;
  observedThroughTimestamp: number | null;
  coverage: {
    center: { lat: number; lng: number };
    screenRect: [number, number, number, number] | null;
    visibleBounds: [[number, number], [number, number]] | null;
    radiusM: number;
  };
  corridors: ActivityRoadCorridor[];
  obstacles: ActivityRoadObstacle[];
  structure: {
    renderedFeatureCount: number;
    roadFeatureCount: number;
    buildingFeatureCount: number;
    styleLayerIds: string[];
    sourceLayerIds: string[];
  };
  uncertainty: {
    reason: string;
    maxPresentationOffsetM: number;
  };
  queryDurationMs: number;
}

type RenderedFeature = {
  id?: unknown;
  geometry?: { type?: unknown; coordinates?: unknown };
  properties?: Record<string, unknown> | null;
  layer?: { id?: unknown; sourceLayer?: unknown } | null;
  sourceLayer?: unknown;
};

const ROAD_HINT = /(road|street|motorway|trunk|primary|secondary|tertiary|residential|service|path|trail|track|footway|pedestrian|cycleway|transport)/i;
const BUILDING_HINT = /(building|structure)/i;
const APP_LAYER_PREFIX = /^(activity-|track-|planned-route|approach-line|memory-|cairn-)/i;
const MAX_LIVE_PRESENTATION_OFFSET_M = 6;

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function featureLayerIds(feature: RenderedFeature) {
  const properties = feature.properties ?? {};
  const styleLayerId = stringValue(feature.layer?.id)
    ?? stringValue(properties.layer)
    ?? stringValue(properties.layer_id);
  const sourceLayerId = stringValue(feature.sourceLayer)
    ?? stringValue(feature.layer?.sourceLayer)
    ?? stringValue(properties.source_layer)
    ?? stringValue(properties.sourceLayer);
  return { styleLayerId, sourceLayerId };
}

function lineStrings(feature: RenderedFeature): Array<Array<[number, number]>> {
  const geometry = feature.geometry;
  if (!geometry || !Array.isArray(geometry.coordinates)) return [];
  const validLine = (candidate: unknown): candidate is Array<[number, number]> => (
    Array.isArray(candidate)
    && candidate.length >= 2
    && candidate.every(point => Array.isArray(point)
      && point.length >= 2
      && Number.isFinite(Number(point[0]))
      && Number.isFinite(Number(point[1])))
  );
  if (geometry.type === 'LineString' && validLine(geometry.coordinates)) {
    return [geometry.coordinates.map(point => [Number(point[0]), Number(point[1])])];
  }
  if (geometry.type === 'MultiLineString') {
    return geometry.coordinates
      .filter(validLine)
      .map(line => line.map(point => [Number(point[0]), Number(point[1])]));
  }
  return [];
}

function polygonRings(feature: RenderedFeature): Array<Array<Array<[number, number]>>> {
  const geometry = feature.geometry;
  if (!geometry || !Array.isArray(geometry.coordinates)) return [];
  const validRing = (candidate: unknown): candidate is Array<[number, number]> => (
    Array.isArray(candidate)
    && candidate.length >= 4
    && candidate.every(point => Array.isArray(point)
      && point.length >= 2
      && Number.isFinite(Number(point[0]))
      && Number.isFinite(Number(point[1])))
  );
  const validPolygon = (candidate: unknown): candidate is Array<Array<[number, number]>> => (
    Array.isArray(candidate) && candidate.length > 0 && candidate.every(validRing)
  );
  if (geometry.type === 'Polygon' && validPolygon(geometry.coordinates)) {
    return [geometry.coordinates.map(ring => ring.map(point => [Number(point[0]), Number(point[1])]))];
  }
  if (geometry.type === 'MultiPolygon') {
    return geometry.coordinates
      .filter(validPolygon)
      .map(polygon => polygon.map(ring => ring.map(point => [Number(point[0]), Number(point[1])])));
  }
  return [];
}

function isRoadFeature(feature: RenderedFeature): boolean {
  const { styleLayerId, sourceLayerId } = featureLayerIds(feature);
  if (styleLayerId && APP_LAYER_PREFIX.test(styleLayerId)) return false;
  const properties = feature.properties ?? {};
  const descriptor = [
    styleLayerId,
    sourceLayerId,
    properties.class,
    properties.type,
    properties.highway,
    properties.road_class,
    properties.network,
  ].filter(Boolean).join(' ');
  return ROAD_HINT.test(descriptor);
}

function structureFor(feature: RenderedFeature): ActivityRoadCorridor['structure'] {
  const properties = feature.properties ?? {};
  const value = [properties.structure, properties.layer, properties.brunnel, properties.class]
    .filter(Boolean).join(' ').toLowerCase();
  if (value.includes('bridge')) return 'bridge';
  if (value.includes('tunnel')) return 'tunnel';
  if (value.length > 0) return 'surface';
  return 'unknown';
}

export function buildActivityRoadContext(args: {
  features: { features?: unknown[] } | null | undefined;
  center: { lat: number; lng: number };
  observedThroughTimestamp: number | null;
  mapMountId: string;
  styleGeneration: number;
  viewportGeneration: number;
  queryGeneration: number;
  queriedAtMs: number;
  queryDurationMs: number;
  screenRect: [number, number, number, number] | null;
  visibleBounds: [[number, number], [number, number]] | null;
  radiusM?: number;
  availability?: Exclude<ActivityRoadContextAvailability, 'available' | 'no-road-features'>;
}): ActivityRoadContext {
  const renderedFeatures = Array.isArray(args.features?.features)
    ? args.features!.features as RenderedFeature[]
    : [];
  const corridors: ActivityRoadCorridor[] = [];
  const obstacles: ActivityRoadObstacle[] = [];
  const dedup = new Set<string>();
  const styleLayerIds = new Set<string>();
  const sourceLayerIds = new Set<string>();
  let buildingFeatureCount = 0;

  for (const feature of renderedFeatures) {
    const ids = featureLayerIds(feature);
    if (ids.styleLayerId) styleLayerIds.add(ids.styleLayerId);
    if (ids.sourceLayerId) sourceLayerIds.add(ids.sourceLayerId);
    const properties = feature.properties ?? {};
    if (BUILDING_HINT.test([ids.styleLayerId, ids.sourceLayerId, properties.class, properties.type].filter(Boolean).join(' '))) {
      buildingFeatureCount += 1;
      for (const rings of polygonRings(feature)) {
        obstacles.push({
          id: String(feature.id ?? `${ids.sourceLayerId ?? ids.styleLayerId ?? 'building'}:${obstacles.length}`),
          rings,
          styleLayerId: ids.styleLayerId,
          sourceLayerId: ids.sourceLayerId,
          provenance: 'rendered-building-polygon',
        });
      }
    }
    if (!isRoadFeature(feature)) continue;
    const roadClass = stringValue(properties.class)
      ?? stringValue(properties.road_class)
      ?? stringValue(properties.highway)
      ?? stringValue(properties.type);
    for (const coordinates of lineStrings(feature)) {
      const geometryKey = coordinates.map(point => `${point[0].toFixed(6)},${point[1].toFixed(6)}`).join(';');
      if (dedup.has(geometryKey)) continue;
      dedup.add(geometryKey);
      corridors.push({
        id: String(feature.id ?? `${ids.sourceLayerId ?? ids.styleLayerId ?? 'road'}:${corridors.length}`),
        coordinates,
        styleLayerId: ids.styleLayerId,
        sourceLayerId: ids.sourceLayerId,
        roadClass,
        structure: structureFor(feature),
      });
    }
  }

  const availability = args.availability
    ?? (corridors.length > 0 ? 'available' : 'no-road-features');
  return {
    availability,
    provenance: 'mapbox-rendered-features',
    mapMountId: args.mapMountId,
    styleGeneration: args.styleGeneration,
    viewportGeneration: args.viewportGeneration,
    queryGeneration: args.queryGeneration,
    queriedAtMs: args.queriedAtMs,
    observedThroughTimestamp: args.observedThroughTimestamp,
    coverage: {
      center: args.center,
      screenRect: args.screenRect,
      visibleBounds: args.visibleBounds,
      radiusM: Math.max(1, args.radiusM ?? 45),
    },
    corridors,
    obstacles,
    structure: {
      renderedFeatureCount: renderedFeatures.length,
      roadFeatureCount: corridors.length,
      buildingFeatureCount,
      styleLayerIds: [...styleLayerIds].sort(),
      sourceLayerIds: [...sourceLayerIds].sort(),
    },
    uncertainty: {
      reason: availability === 'available'
        ? 'rendered-corridor-near-accepted-tail; presentation-only'
        : `${availability}; absence-is-not-off-road-evidence`,
      maxPresentationOffsetM: MAX_LIVE_PRESENTATION_OFFSET_M,
    },
    queryDurationMs: Math.max(0, args.queryDurationMs),
  };
}

function orientation(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
  c: { lat: number; lng: number },
): number {
  return (b.lng - a.lng) * (c.lat - a.lat) - (b.lat - a.lat) * (c.lng - a.lng);
}

function onSegment(
  point: { lat: number; lng: number },
  start: { lat: number; lng: number },
  end: { lat: number; lng: number },
): boolean {
  const epsilon = 1e-10;
  return Math.abs(orientation(start, end, point)) <= epsilon
    && point.lng >= Math.min(start.lng, end.lng) - epsilon
    && point.lng <= Math.max(start.lng, end.lng) + epsilon
    && point.lat >= Math.min(start.lat, end.lat) - epsilon
    && point.lat <= Math.max(start.lat, end.lat) + epsilon;
}

function segmentsIntersect(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
  c: { lat: number; lng: number },
  d: { lat: number; lng: number },
): boolean {
  const abC = orientation(a, b, c);
  const abD = orientation(a, b, d);
  const cdA = orientation(c, d, a);
  const cdB = orientation(c, d, b);
  if (((abC > 0 && abD < 0) || (abC < 0 && abD > 0))
    && ((cdA > 0 && cdB < 0) || (cdA < 0 && cdB > 0))) return true;
  return onSegment(c, a, b) || onSegment(d, a, b) || onSegment(a, c, d) || onSegment(b, c, d);
}

function pointInsideRing(point: { lat: number; lng: number }, ring: Array<[number, number]>): boolean {
  let inside = false;
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index, index += 1) {
    const current = { lng: ring[index][0], lat: ring[index][1] };
    const prior = { lng: ring[previous][0], lat: ring[previous][1] };
    if (onSegment(point, prior, current)) return true;
    const crossesLatitude = (current.lat > point.lat) !== (prior.lat > point.lat);
    const crossingLng = (prior.lng - current.lng) * (point.lat - current.lat)
      / ((prior.lat - current.lat) || Number.EPSILON) + current.lng;
    if (crossesLatitude && point.lng < crossingLng) inside = !inside;
  }
  return inside;
}

function pointInsideObstacle(point: { lat: number; lng: number }, obstacle: ActivityRoadObstacle): boolean {
  if (!pointInsideRing(point, obstacle.rings[0])) return false;
  return !obstacle.rings.slice(1).some(hole => pointInsideRing(point, hole));
}

function edgeIntersectsObstacle(
  start: { lat: number; lng: number },
  end: { lat: number; lng: number },
  obstacle: ActivityRoadObstacle,
): boolean {
  if (pointInsideObstacle(start, obstacle) || pointInsideObstacle(end, obstacle)) return true;
  for (const ring of obstacle.rings) {
    for (let index = 1; index < ring.length; index += 1) {
      const edgeStart = { lng: ring[index - 1][0], lat: ring[index - 1][1] };
      const edgeEnd = { lng: ring[index][0], lat: ring[index][1] };
      if (segmentsIntersect(start, end, edgeStart, edgeEnd)) return true;
    }
  }
  return false;
}

function adjustmentIntroducesObstacleIntersection<T extends { lat: number; lng: number }>(
  original: readonly T[],
  adjusted: readonly T[],
  changedStartIndex: number,
  context: ActivityRoadContext,
): boolean {
  if (context.obstacles.length === 0) return false;
  const firstEdgeIndex = Math.max(1, changedStartIndex);
  for (let index = firstEdgeIndex; index < adjusted.length; index += 1) {
    if (index > changedStartIndex + 1) break;
    for (const obstacle of context.obstacles) {
      const adjustedIntersects = edgeIntersectsObstacle(adjusted[index - 1], adjusted[index], obstacle);
      if (!adjustedIntersects) continue;
      const originalIntersects = edgeIntersectsObstacle(original[index - 1], original[index], obstacle);
      if (!originalIntersects) return true;
    }
  }
  return false;
}

function projectToSegment(
  point: { lat: number; lng: number },
  start: [number, number],
  end: [number, number],
): { lat: number; lng: number; distanceM: number; bearingDeg: number } {
  const lat0 = point.lat * Math.PI / 180;
  const xScale = Math.max(0.01, Math.cos(lat0));
  const ax = (start[0] - point.lng) * xScale;
  const ay = start[1] - point.lat;
  const bx = (end[0] - point.lng) * xScale;
  const by = end[1] - point.lat;
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;
  const ratio = lengthSquared > 0
    ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / lengthSquared))
    : 0;
  const projected = {
    lng: point.lng + (ax + ratio * dx) / xScale,
    lat: point.lat + ay + ratio * dy,
  };
  const bearingDeg = (Math.atan2(
    (end[0] - start[0]) * xScale,
    end[1] - start[1],
  ) * 180 / Math.PI + 360) % 360;
  return { ...projected, distanceM: haversineM(point, projected), bearingDeg };
}

function nearestOnCorridor(
  point: { lat: number; lng: number },
  corridor: ActivityRoadCorridor,
): { lat: number; lng: number; distanceM: number; bearingDeg: number } | null {
  let nearest: { lat: number; lng: number; distanceM: number; bearingDeg: number } | null = null;
  for (let index = 1; index < corridor.coordinates.length; index += 1) {
    const projected = projectToSegment(point, corridor.coordinates[index - 1], corridor.coordinates[index]);
    if (!nearest || projected.distanceM < nearest.distanceM) nearest = projected;
  }
  return nearest;
}

function bearingDegrees(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const lat0 = ((a.lat + b.lat) / 2) * Math.PI / 180;
  return (Math.atan2((b.lng - a.lng) * Math.cos(lat0), b.lat - a.lat) * 180 / Math.PI + 360) % 360;
}

function headingDelta(a: number, b: number): number {
  const direct = Math.abs(((b - a + 540) % 360) - 180);
  // A rendered line has no travel direction; forward and reverse both agree.
  return Math.min(direct, Math.abs(180 - direct));
}

function supportedOffsetM(point: { accuracy?: number | null }): number {
  const accuracy = point.accuracy;
  if (accuracy == null || !Number.isFinite(accuracy) || accuracy < 0) return 2;
  if (accuracy <= 7) return Math.max(1.2, accuracy * 0.35);
  return Math.min(MAX_LIVE_PRESENTATION_OFFSET_M, Math.max(2.5, accuracy * 0.45));
}

export function deriveRoadAwareLiveTrack<T extends {
  lat: number;
  lng: number;
  t?: number;
  segmentId?: string;
  accuracy?: number | null;
}>(
  canonicalPresentation: readonly T[],
  context: ActivityRoadContext | null,
): T[] {
  if (canonicalPresentation.length < 2 || context?.availability !== 'available') {
    return canonicalPresentation as T[];
  }
  const tail = canonicalPresentation[canonicalPresentation.length - 1];
  const tailTimestamp = tail.t ?? null;
  if (context.observedThroughTimestamp != null && tailTimestamp != null) {
    const contextAgeMs = tailTimestamp - context.observedThroughTimestamp;
    if (contextAgeMs < 0 || contextAgeMs > 20_000) return canonicalPresentation as T[];
  } else if (context.observedThroughTimestamp !== tailTimestamp) {
    return canonicalPresentation as T[];
  }
  if (haversineM(tail, context.coverage.center) > context.coverage.radiusM * 0.8) {
    return canonicalPresentation as T[];
  }

  let chosen: ActivityRoadCorridor | null = null;
  let tailProjection: ReturnType<typeof nearestOnCorridor> = null;
  let secondDistanceM = Number.POSITIVE_INFINITY;
  for (const corridor of context.corridors) {
    const projected = nearestOnCorridor(tail, corridor);
    if (projected && (!tailProjection || projected.distanceM < tailProjection.distanceM)) {
      secondDistanceM = tailProjection?.distanceM ?? secondDistanceM;
      chosen = corridor;
      tailProjection = projected;
    } else if (projected) {
      secondDistanceM = Math.min(secondDistanceM, projected.distanceM);
    }
  }
  if (!chosen || !tailProjection
    || tailProjection.distanceM > Math.min(context.uncertainty.maxPresentationOffsetM, supportedOffsetM(tail))) {
    return canonicalPresentation as T[];
  }
  // Two nearby parallel candidates are map context, not proof of which path
  // was walked. Retain the causal canonical tail under corridor ambiguity.
  if (secondDistanceM <= tailProjection.distanceM + 1.5) return canonicalPresentation as T[];

  const support = canonicalPresentation
    .slice(-4)
    .filter(point => (point.segmentId ?? null) === (tail.segmentId ?? null));
  if (support.length < 3) return canonicalPresentation as T[];
  const supportProjections = support.map(point => nearestOnCorridor(point, chosen!));
  if (supportProjections.some((projected, index) => !projected
    || projected.distanceM > Math.min(
      context.uncertainty.maxPresentationOffsetM,
      supportedOffsetM(support[index]),
    ))) return canonicalPresentation as T[];
  const rawHeading = bearingDegrees(support[0], support[support.length - 1]);
  const corridorHeadings = supportProjections.map(projected => projected!.bearingDeg);
  if (corridorHeadings.some(value => headingDelta(rawHeading, value) > 30)) {
    return canonicalPresentation as T[];
  }

  const priorIndex = canonicalPresentation.length - 2;
  const prior = canonicalPresentation[priorIndex];
  if ((prior.segmentId ?? null) !== (tail.segmentId ?? null)) return canonicalPresentation as T[];
  const priorProjection = nearestOnCorridor(prior, chosen);
  if (!priorProjection || priorProjection.distanceM > Math.min(
    context.uncertainty.maxPresentationOffsetM,
    supportedOffsetM(prior),
  )) {
    return canonicalPresentation as T[];
  }
  const rawStepM = haversineM(prior, tail);
  const projectedStepM = haversineM(priorProjection, tailProjection);
  if (projectedStepM > Math.max(18, rawStepM * 1.5 + 4)) return canonicalPresentation as T[];

  const result = canonicalPresentation.slice() as T[];
  result[priorIndex] = { ...prior, lat: priorProjection.lat, lng: priorProjection.lng };
  result[result.length - 1] = { ...tail, lat: tailProjection.lat, lng: tailProjection.lng };
  // A rendered footprint alone cannot prove an observed traversal impossible.
  // It can, however, prevent this presentation helper from inventing a new
  // chord through a solid building. A bridge/tunnel corridor is explicit
  // passage evidence; otherwise retain the honest canonical presentation.
  if (chosen.structure !== 'bridge' && chosen.structure !== 'tunnel'
    && adjustmentIntroducesObstacleIntersection(canonicalPresentation, result, priorIndex, context)) {
    return canonicalPresentation as T[];
  }
  return result;
}

/**
 * Road-aware presentation is deliberately provisional. Mapbox rendered
 * features depend on viewport/style/tile readiness, so they may refine only a
 * two-point tail. Once a point leaves that tail its displayed coordinate is
 * immutable for the remainder of the mounted recording; a later tile query or
 * observation cannot make historical linework rebound.
 */
export interface StableRoadAwareLivePresentation<T> {
  sourceCount: number;
  sourcePoints: ReadonlyArray<T>;
  points: T[];
  scopeKey: string | null;
  contextAuthority: {
    mapMountId: string;
    queryGeneration: number;
  } | null;
  lastAppliedContext: ActivityRoadContext | null;
  publishedStable: Map<string, {
    display: T;
    sourceFingerprint: string;
    durable: boolean;
  }>;
}

export function createStableRoadAwareLivePresentation<T>(): StableRoadAwareLivePresentation<T> {
  return {
    sourceCount: 0,
    sourcePoints: [],
    points: [],
    scopeKey: null,
    contextAuthority: null,
    lastAppliedContext: null,
    publishedStable: new Map(),
  };
}

export function updateStableRoadAwareLivePresentation<T extends {
  lat: number;
  lng: number;
  t?: number;
  segmentId?: string;
  accuracy?: number | null;
  observationId?: string;
  clientActivityId?: string;
  ownerGeneration?: string;
  rawOrdinal?: number;
  liveTrendConfirmed?: true;
  livePresentationSettled?: true;
  livePresentationBreakBefore?: true;
}>(
  previous: StableRoadAwareLivePresentation<T>,
  canonical: ReadonlyArray<T>,
  context: ActivityRoadContext | null,
): StableRoadAwareLivePresentation<T> {
  if (canonical.length === 0) return createStableRoadAwareLivePresentation<T>();
  const nextScopeKey = activityPresentationScopeKey(canonical);
  const scopeChanged = previous.sourceCount > 0
    && previous.scopeKey !== nextScopeKey
    && (previous.scopeKey != null || nextScopeKey != null);
  const base = scopeChanged
    ? createStableRoadAwareLivePresentation<T>()
    : previous;
  const staleContext = context != null
    && base.contextAuthority?.mapMountId === context.mapMountId
    && context.queryGeneration < base.contextAuthority.queryGeneration;
  // The screen already cancels stale rendered-feature queries, but presentation
  // state is the final authority boundary. An old async result may be replayed
  // after checkpoint restoration or object reconstruction; it must not regain
  // permission to move the provisional tail. Reuse the last accepted context
  // for a stale result, while an explicit null still removes road assistance.
  const effectiveContext = staleContext ? base.lastAppliedContext : context;
  // Causal Live owns a ten-observation provisional domain. Reconcile a small
  // overlap beyond that domain so contractions, insertions and rehydrated
  // objects can be handled without re-identifying the complete Activity on
  // every fix. A changed boundary means this is not a legal suffix update and
  // deliberately falls back to a complete presentation reconciliation.
  const minimumSourceCount = Math.min(base.sourceCount, canonical.length);
  let reconcileStart = Math.max(0, minimumSourceCount - 12);
  const prefixReusable = reconcileStart > 0
    && base.sourcePoints.length === base.sourceCount
    && base.points.length === base.sourceCount
    && sameActivityPresentationPoint(
      canonical[reconcileStart - 1],
      base.sourcePoints[reconcileStart - 1],
      reconcileStart - 1,
    );
  if (!prefixReusable) reconcileStart = 0;
  // Road-aware decisions inspect at most four causal tail points. Supplying the
  // entire history needlessly cloned a 20k-point Activity for every append.
  const roadTailStart = Math.max(0, canonical.length - 4);
  const roadTail = deriveRoadAwareLiveTrack(
    canonical.slice(roadTailStart),
    effectiveContext,
  );
  // A point becomes immutable when it leaves the two-point road tail. Capture
  // the coordinate that was actually published immediately before promotion,
  // rather than recomputing it under the next context. Only the bounded old
  // tail can newly cross this boundary, so this never scans full history.
  const priorTailDisplay = new Map<string, {
    display: T;
    sourceFingerprint: string;
  }>();
  const priorTailStart = Math.max(0, base.sourceCount - 12);
  for (let index = priorTailStart; index < base.sourceCount; index += 1) {
    const source = base.sourcePoints[index];
    const display = base.points[index];
    if (!source || !display) continue;
    const identity = activityPresentationIdentity(source, index);
    priorTailDisplay.set(identity.key, {
      display,
      sourceFingerprint: identity.sourceFingerprint,
    });
  }
  const stableBoundary = Math.max(0, canonical.length - 2);
  const points = prefixReusable ? base.points.slice(0, reconcileStart) : [];
  for (let index = reconcileStart; index < canonical.length; index += 1) {
    const canonicalPoint = canonical[index];
    const point = index < roadTailStart
      ? canonicalPoint
      : roadTail[index - roadTailStart];
    const identity = activityPresentationIdentity(canonical[index], index);
    const published = base.publishedStable.get(identity.key);
    const priorTail = priorTailDisplay.get(identity.key);
    const newlyStable = index < stableBoundary
      || canonical[index].liveTrendConfirmed
      || canonical[index].livePresentationSettled;
    const retained = published?.sourceFingerprint === identity.sourceFingerprint
      ? published.display
      : newlyStable && priorTail?.sourceFingerprint === identity.sourceFingerprint
        ? priorTail.display
        : null;
    let resolved = point;
    if (!retained) {
      if (published) base.publishedStable.delete(identity.key);
    } else {
      const source = canonical[index];
      resolved = (
        (source.liveTrendConfirmed && !retained.liveTrendConfirmed)
        || (source.livePresentationSettled && !retained.livePresentationSettled)
      ) ? {
        ...retained,
        ...(source.liveTrendConfirmed ? { liveTrendConfirmed: true as const } : null),
        ...(source.livePresentationSettled ? { livePresentationSettled: true as const } : null),
      } : retained;
    }
    if (newlyStable) {
      const existing = base.publishedStable.get(identity.key);
      if (existing?.sourceFingerprint === identity.sourceFingerprint) {
        if (resolved !== existing.display) {
          base.publishedStable.set(identity.key, { ...existing, display: resolved });
        }
      } else {
        base.publishedStable.set(identity.key, {
          display: resolved,
          sourceFingerprint: identity.sourceFingerprint,
          durable: identity.durable,
        });
      }
    }
    points.push(resolved);
  }
  return {
    sourceCount: canonical.length,
    sourcePoints: canonical,
    points,
    scopeKey: nextScopeKey,
    contextAuthority: staleContext
      ? base.contextAuthority
      : context == null
        ? base.contextAuthority
        : { mapMountId: context.mapMountId, queryGeneration: context.queryGeneration },
    lastAppliedContext: staleContext ? base.lastAppliedContext : context,
    publishedStable: base.publishedStable,
  };
}

export const ACTIVITY_ROAD_CONTEXT_QUERY_RADIUS_PX = 36;
