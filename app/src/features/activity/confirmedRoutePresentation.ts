import { haversineM } from '../../utils/geo';
import {
  activityPresentationScopeKey,
  sameActivityPresentationPoint,
} from './activityPresentationIdentity';
import { applyAdaptiveRouteVisualGeometry } from './adaptiveRouteVisualGeometry';

export interface ConfirmedRoutePoint {
  lat: number;
  lng: number;
  t?: number;
  segmentId?: string;
  observationId?: string;
  clientActivityId?: string;
  ownerGeneration?: string;
  rawOrdinal?: number;
  livePresentationBreakBefore?: true;
  accuracy?: number | null;
}

export interface ConfirmedRouteSegment {
  key: string;
  coordinates: [number, number][];
}

export const MAX_LIVE_ROUTE_HEAD_POINTS = 256;
// The causal presentation may revise up to ten recent source observations.
// A frozen chunk therefore keeps one overlap point before that entire domain;
// otherwise a legal suffix correction can move a vertex already embedded in
// the preceding static edge.
export const MAX_LIVE_ROUTE_MUTABLE_SOURCE_POINTS = 10;
export const MAX_LIVE_ROUTE_TOPOLOGY_CONTEXT_POINTS = 256;

export interface IncrementalRoutePresentation {
  sourceCount: number;
  lastSourcePoint: ConfirmedRoutePoint | null;
  sourcePoints: ReadonlyArray<ConfirmedRoutePoint>;
  staticChunks: ConfirmedRouteSegment[];
  activeHead: ConfirmedRouteSegment | null;
  activeHeadStartIndex: number | null;
  activeHeadSourcePoints: ReadonlyArray<ConfirmedRoutePoint>;
  activeHeadLastRoundedSourceOffset: number | null;
  activeHeadCoordinateSourceOffsets: number[];
  topologyContextSourcePoints: ReadonlyArray<ConfirmedRoutePoint>;
  nextChunkOrdinal: number;
  geometryBuildCount: number;
  sourceUpdateCount: number;
  latestUpdatePayloadBytes: number;
  cumulativePayloadBytes: number;
  rebuilt: boolean;
  scopeKey: string | null;
}

export function createIncrementalRoutePresentation(): IncrementalRoutePresentation {
  return {
    sourceCount: 0,
    lastSourcePoint: null,
    sourcePoints: [],
    staticChunks: [],
    activeHead: null,
    activeHeadStartIndex: null,
    activeHeadSourcePoints: [],
    activeHeadLastRoundedSourceOffset: null,
    activeHeadCoordinateSourceOffsets: [],
    topologyContextSourcePoints: [],
    nextChunkOrdinal: 0,
    geometryBuildCount: 0,
    sourceUpdateCount: 0,
    latestUpdatePayloadBytes: 0,
    cumulativePayloadBytes: 0,
    rebuilt: false,
    scopeKey: null,
  };
}

function coordinateOf(point: ConfirmedRoutePoint): [number, number] {
  return [point.lng, point.lat];
}

function presentationBreak(
  previous: ConfirmedRoutePoint | null,
  next: ConfirmedRoutePoint,
  fallbackGapMs: number,
  fallbackGapDistanceM: number,
): boolean {
  if (!previous) return false;
  if (next.livePresentationBreakBefore) return true;
  if (previous.segmentId && next.segmentId) {
    // Durable source segment identity represents accepted continuity. Display
    // simplification can legitimately leave minutes between retained
    // vertices; that is not evidence of GPS silence. Time/distance fallback
    // remains only for legacy points that lack segment provenance.
    return previous.segmentId !== next.segmentId;
  }
  const dtMs = previous.t != null && next.t != null ? next.t - previous.t : 0;
  return dtMs > fallbackGapMs || haversineM(previous, next) > fallbackGapDistanceM;
}

function payloadBytes(chunks: ReadonlyArray<ConfirmedRouteSegment>): number {
  // Privacy-safe approximation: two numeric coordinates at eight bytes each.
  return chunks.reduce((total, chunk) => total + chunk.coordinates.length * 16, 0);
}

/**
 * Incremental static-body + bounded-live-head projection. Normal append work
 * examines only new canonical points. Rollback/recovery replacement rebuilds
 * once, preserving exact segment gaps, U-turns and repeated traversal.
 */
export function updateIncrementalRoutePresentation(
  previousState: IncrementalRoutePresentation,
  points: ReadonlyArray<ConfirmedRoutePoint>,
  fallbackGapMs = 120_000,
  fallbackGapDistanceM = 200,
): IncrementalRoutePresentation {
  if (points.length === 0) return createIncrementalRoutePresentation();
  const scopeKey = activityPresentationScopeKey(points);
  const scopeChanged = previousState.sourceCount > 0
    && previousState.scopeKey !== scopeKey
    && (previousState.scopeKey != null || scopeKey != null);
  if (scopeChanged) {
    let rebuilt = createIncrementalRoutePresentation();
    for (const point of points) {
      rebuilt = appendPoint(rebuilt, point, fallbackGapMs, fallbackGapDistanceM);
    }
    return { ...rebuilt, sourcePoints: points, scopeKey, rebuilt: true };
  }
  const headStart = previousState.activeHeadStartIndex;
  const hasComparableHead = previousState.sourceCount > 0
    && previousState.sourcePoints.length === previousState.sourceCount
    && headStart != null
    && previousState.activeHead != null;
  // The static prefix is immutable by contract. Its boundary fingerprint is
  // enough to authorize bounded tail reconciliation; a changed boundary,
  // contraction across it, or owner replacement falls back to a full rebuild.
  const staticBoundaryMatches = hasComparableHead
    && points.length > headStart!
    && (headStart === 0 || sameActivityPresentationPoint(
      points[headStart - 1],
      previousState.sourcePoints[headStart - 1],
      headStart - 1,
    ));
  const comparableEnd = Math.min(previousState.sourceCount, points.length);
  const comparisonStart = Math.max(
    0,
    comparableEnd - MAX_LIVE_ROUTE_MUTABLE_SOURCE_POINTS,
  );
  let firstChangedHeadIndex: number | null = null;
  if (staticBoundaryMatches) {
    for (let index = comparisonStart; index < comparableEnd; index += 1) {
      if (!sameActivityPresentationPoint(
        points[index],
        previousState.sourcePoints[index],
        index,
      )) {
        firstChangedHeadIndex = index;
        break;
      }
    }
  }
  const headPrefixMatches = staticBoundaryMatches && firstChangedHeadIndex == null;
  const appendOnly = headPrefixMatches && points.length >= previousState.sourceCount;
  const boundedTailRevision = staticBoundaryMatches && (
    (firstChangedHeadIndex != null && firstChangedHeadIndex >= headStart!)
    || (firstChangedHeadIndex == null && points.length < previousState.sourceCount)
  );
  if (!appendOnly && !boundedTailRevision) {
    let rebuilt = createIncrementalRoutePresentation();
    for (const point of points) {
      rebuilt = appendPoint(rebuilt, point, fallbackGapMs, fallbackGapDistanceM);
    }
    return { ...rebuilt, sourcePoints: points, scopeKey, rebuilt: true };
  }
  let next = previousState;
  if (boundedTailRevision) {
    // Re-run the ordinary append/chunk path from the existing overlap point.
    // This preserves frozen chunk object identity while guaranteeing that a
    // legal revision cannot grow the mutable head beyond its hard bound.
    next = {
      ...previousState,
      sourceCount: headStart!,
      lastSourcePoint: headStart! > 0 ? points[headStart! - 1] : null,
      sourcePoints: previousState.sourcePoints.slice(0, headStart!),
      activeHead: null,
      activeHeadStartIndex: null,
      activeHeadSourcePoints: [],
      activeHeadLastRoundedSourceOffset: null,
      activeHeadCoordinateSourceOffsets: [],
      topologyContextSourcePoints: points.slice(
        Math.max(0, headStart! - MAX_LIVE_ROUTE_TOPOLOGY_CONTEXT_POINTS),
        headStart!,
      ),
      latestUpdatePayloadBytes: 0,
    };
    for (let index = headStart!; index < points.length; index += 1) {
      next = appendPoint(next, points[index], fallbackGapMs, fallbackGapDistanceM);
    }
  }
  if (points.length === previousState.sourceCount) {
    return { ...next, sourcePoints: points, scopeKey, rebuilt: false };
  }
  if (boundedTailRevision) {
    return { ...next, sourcePoints: points, scopeKey, rebuilt: false };
  }
  for (let index = previousState.sourceCount; index < points.length; index += 1) {
    next = appendPoint(next, points[index], fallbackGapMs, fallbackGapDistanceM);
  }
  return { ...next, sourcePoints: points, scopeKey, rebuilt: false };
}

function appendPoint(
  state: IncrementalRoutePresentation,
  point: ConfirmedRoutePoint,
  fallbackGapMs: number,
  fallbackGapDistanceM: number,
): IncrementalRoutePresentation {
  const split = presentationBreak(state.lastSourcePoint, point, fallbackGapMs, fallbackGapDistanceM);
  let staticChunks = state.staticChunks;
  let activeHead = state.activeHead;
  let activeHeadStartIndex = state.activeHeadStartIndex;
  let activeHeadSourcePoints = state.activeHeadSourcePoints;
  let activeHeadLastRoundedSourceOffset = state.activeHeadLastRoundedSourceOffset;
  let activeHeadCoordinateSourceOffsets = state.activeHeadCoordinateSourceOffsets;
  const topologyContextSourcePoints = [
    ...state.topologyContextSourcePoints,
    point,
  ].slice(-MAX_LIVE_ROUTE_TOPOLOGY_CONTEXT_POINTS);
  let nextChunkOrdinal = state.nextChunkOrdinal;
  const changedChunks: ConfirmedRouteSegment[] = [];

  if (!activeHead || split) {
    if (activeHead && activeHead.coordinates.length >= 2) {
      const frozen = { ...activeHead, key: `${activeHead.key}:body-${nextChunkOrdinal++}` };
      staticChunks = [...staticChunks, frozen];
      changedChunks.push(frozen);
    }
    activeHead = {
      key: `${point.segmentId ?? `legacy-${point.t ?? state.sourceCount}`}:head-${nextChunkOrdinal}`,
      coordinates: [coordinateOf(point)],
    };
    activeHeadSourcePoints = [point];
    activeHeadLastRoundedSourceOffset = null;
    activeHeadCoordinateSourceOffsets = [0];
    activeHeadStartIndex = state.sourceCount;
  } else {
    const newSourceOffset = activeHeadSourcePoints.length;
    activeHeadSourcePoints = [...activeHeadSourcePoints, point];
    const cornerOffset = activeHeadSourcePoints.length - 2;
    const overlapsPreviousCurve = activeHeadLastRoundedSourceOffset != null
      && cornerOffset - activeHeadLastRoundedSourceOffset <= 1;
    const newestCorner = overlapsPreviousCurve || activeHeadSourcePoints.length < 3
      ? null
      : applyAdaptiveRouteVisualGeometry(activeHeadSourcePoints.slice(-3), {
        armMode: 'adjacent',
        topologyContext: state.topologyContextSourcePoints.slice(0, -2),
      });
    if (newestCorner?.diagnostics.roundedCorners === 1) {
      activeHead = {
        ...activeHead,
        coordinates: [
          ...activeHead.coordinates.slice(0, -1),
          ...newestCorner.points.slice(1).map(coordinateOf),
        ],
      };
      activeHeadCoordinateSourceOffsets = [
        ...activeHeadCoordinateSourceOffsets.slice(0, -1),
        ...Array.from(
          { length: newestCorner.points.length - 1 },
          () => newSourceOffset,
        ),
      ];
      activeHeadLastRoundedSourceOffset = cornerOffset;
    } else {
      activeHead = {
        ...activeHead,
        coordinates: [...activeHead.coordinates, coordinateOf(point)],
      };
      activeHeadCoordinateSourceOffsets = [
        ...activeHeadCoordinateSourceOffsets,
        newSourceOffset,
      ];
    }
    if (activeHeadSourcePoints.length > MAX_LIVE_ROUTE_HEAD_POINTS) {
      const tentativeSourceOffset = Math.max(
        1,
        activeHeadSourcePoints.length - MAX_LIVE_ROUTE_MUTABLE_SOURCE_POINTS - 1,
      );
      let boundaryCoordinateIndex = -1;
      for (let index = 0; index < activeHeadCoordinateSourceOffsets.length; index += 1) {
        if (activeHeadCoordinateSourceOffsets[index] <= tentativeSourceOffset) {
          boundaryCoordinateIndex = index;
        }
      }
      const retainedSourceOffset = activeHeadCoordinateSourceOffsets[
        Math.max(1, boundaryCoordinateIndex)
      ];
      const frozenCoordinates = activeHead.coordinates.slice(
        0,
        Math.max(1, boundaryCoordinateIndex) + 1,
      );
      const frozen = {
        key: `${activeHead.key}:body-${nextChunkOrdinal++}`,
        coordinates: frozenCoordinates,
      };
      staticChunks = [...staticChunks, frozen];
      changedChunks.push(frozen);
      activeHeadSourcePoints = activeHeadSourcePoints.slice(retainedSourceOffset);
      activeHead = {
        key: `${point.segmentId ?? 'legacy'}:head-${nextChunkOrdinal}`,
        coordinates: activeHead.coordinates.slice(Math.max(1, boundaryCoordinateIndex)),
      };
      activeHeadCoordinateSourceOffsets = activeHeadCoordinateSourceOffsets
        .slice(Math.max(1, boundaryCoordinateIndex))
        .map(offset => offset - retainedSourceOffset);
      activeHeadStartIndex = (activeHeadStartIndex ?? 0) + retainedSourceOffset;
      activeHeadLastRoundedSourceOffset = activeHeadLastRoundedSourceOffset != null
        && activeHeadLastRoundedSourceOffset >= retainedSourceOffset
        ? activeHeadLastRoundedSourceOffset - retainedSourceOffset
        : null;
    }
  }
  changedChunks.push(activeHead);
  const latestUpdatePayloadBytes = payloadBytes(changedChunks);
  return {
    sourceCount: state.sourceCount + 1,
    lastSourcePoint: point,
    sourcePoints: state.sourcePoints,
    staticChunks,
    activeHead,
    activeHeadStartIndex,
    activeHeadSourcePoints,
    activeHeadLastRoundedSourceOffset,
    activeHeadCoordinateSourceOffsets,
    topologyContextSourcePoints,
    nextChunkOrdinal,
    geometryBuildCount: state.geometryBuildCount + 1,
    sourceUpdateCount: state.sourceUpdateCount
      + changedChunks.filter(chunk => chunk.coordinates.length >= 2).length,
    latestUpdatePayloadBytes,
    cumulativePayloadBytes: state.cumulativePayloadBytes + latestUpdatePayloadBytes,
    rebuilt: state.rebuilt,
    scopeKey: state.scopeKey,
  };
}

/**
 * Presentation segmentation mirrors canonical segment identity and retains a
 * conservative legacy fallback for old, unsegmented recovered tracks. A gap
 * never becomes an animation target or a visible connector.
 */
export function buildConfirmedRouteSegments(
  points: ReadonlyArray<ConfirmedRoutePoint>,
  fallbackGapMs = 120_000,
  fallbackGapDistanceM = 200,
): ConfirmedRouteSegment[] {
  if (points.length === 0) return [];
  const segments: ConfirmedRouteSegment[] = [];
  let current: ConfirmedRouteSegment = {
    key: points[0].segmentId ?? `legacy-${points[0].t ?? 0}`,
    coordinates: [[points[0].lng, points[0].lat]],
  };
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const point = points[index];
    const hasSourceContinuity = Boolean(previous.segmentId && point.segmentId);
    const explicitBreak = point.livePresentationBreakBefore === true
      || (hasSourceContinuity && previous.segmentId !== point.segmentId);
    const dtMs = previous.t != null && point.t != null ? point.t - previous.t : 0;
    const fallbackBreak = !hasSourceContinuity
      && (dtMs > fallbackGapMs
        || haversineM(previous, point) > fallbackGapDistanceM);
    if (explicitBreak || fallbackBreak) {
      if (current.coordinates.length > 0) segments.push(current);
      current = {
        key: point.segmentId ?? `legacy-${point.t ?? index}`,
        coordinates: [[point.lng, point.lat]],
      };
    } else {
      current.coordinates.push([point.lng, point.lat]);
    }
  }
  if (current.coordinates.length > 0) segments.push(current);
  return segments;
}

export const MAX_CONTINUOUS_ROUTE_MUTABLE_POINTS = 8;

export interface ContinuousRouteTargetPlan {
  stableCount: number;
  fullTargetCoordinates: [number, number][];
  mutableCount: number;
  boundedResetRequired: boolean;
}

/**
 * One LineString owns the active route, so there is no separately capped head
 * origin. Equal coordinates in the stable prefix never move; only the suffix
 * added after the last completed target can interpolate. A callback burst
 * snaps that suffix complete once it reaches the fixed cap.
 */
export function planContinuousRouteTarget(
  coordinates: ReadonlyArray<[number, number]>,
  stableCount: number,
): ContinuousRouteTargetPlan {
  if (coordinates.length === 0) {
    return {
      stableCount: 0,
      fullTargetCoordinates: [],
      mutableCount: 0,
      boundedResetRequired: false,
    };
  }
  const boundedStableCount = Math.min(Math.max(1, stableCount), coordinates.length);
  const mutableCount = coordinates.length - boundedStableCount;
  if (mutableCount > MAX_CONTINUOUS_ROUTE_MUTABLE_POINTS) {
    return {
      stableCount: coordinates.length,
      fullTargetCoordinates: coordinates.slice(),
      mutableCount: 0,
      boundedResetRequired: true,
    };
  }
  return {
    stableCount: boundedStableCount,
    fullTargetCoordinates: coordinates.slice(),
    mutableCount,
    boundedResetRequired: false,
  };
}

export function isAppendOnlyRouteUpdate(
  previous: ReadonlyArray<[number, number]>,
  next: ReadonlyArray<[number, number]>,
): boolean {
  return previous.length <= next.length && previous.every((coordinate, index) => (
    coordinate[0] === next[index]?.[0] && coordinate[1] === next[index]?.[1]
  ));
}

/** Normal one-second fixes settle before the next puck target, while callback
 * bursts use a shorter catch-up duration. This is presentation-only. */
export function continuousRouteAnimationDurationMs(deltaTimestampMs: number | null): number {
  if (deltaTimestampMs == null || !Number.isFinite(deltaTimestampMs) || deltaTimestampMs <= 0) return 720;
  return Math.round(Math.min(850, Math.max(180, deltaTimestampMs * 0.72)));
}
