import { haversineM } from '../../utils/geo';

export interface ConfirmedRoutePoint {
  lat: number;
  lng: number;
  t?: number;
  segmentId?: string;
}

export interface ConfirmedRouteSegment {
  key: string;
  coordinates: [number, number][];
}

export const MAX_LIVE_ROUTE_HEAD_POINTS = 256;

export interface IncrementalRoutePresentation {
  sourceCount: number;
  lastSourcePoint: ConfirmedRoutePoint | null;
  sourcePoints: ReadonlyArray<ConfirmedRoutePoint>;
  staticChunks: ConfirmedRouteSegment[];
  activeHead: ConfirmedRouteSegment | null;
  activeHeadStartIndex: number | null;
  nextChunkOrdinal: number;
  geometryBuildCount: number;
  sourceUpdateCount: number;
  latestUpdatePayloadBytes: number;
  cumulativePayloadBytes: number;
  rebuilt: boolean;
}

export function createIncrementalRoutePresentation(): IncrementalRoutePresentation {
  return {
    sourceCount: 0,
    lastSourcePoint: null,
    sourcePoints: [],
    staticChunks: [],
    activeHead: null,
    activeHeadStartIndex: null,
    nextChunkOrdinal: 0,
    geometryBuildCount: 0,
    sourceUpdateCount: 0,
    latestUpdatePayloadBytes: 0,
    cumulativePayloadBytes: 0,
    rebuilt: false,
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
  if (previous.segmentId && next.segmentId && previous.segmentId !== next.segmentId) return true;
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
  const appendOnly = previousState.sourceCount > 0
    && points.length >= previousState.sourceCount
    && points[previousState.sourceCount - 1] === previousState.lastSourcePoint;
  const boundedTailRevision = previousState.sourceCount > 0
    && points.length >= previousState.sourceCount
    && previousState.sourcePoints.length === previousState.sourceCount
    && points[0] === previousState.sourcePoints[0]
    && (previousState.sourceCount <= 2
      || points[previousState.sourceCount - 3] === previousState.sourcePoints[previousState.sourceCount - 3]);
  if (!appendOnly && !boundedTailRevision) {
    let rebuilt = createIncrementalRoutePresentation();
    for (const point of points) {
      rebuilt = appendPoint(rebuilt, point, fallbackGapMs, fallbackGapDistanceM);
    }
    return { ...rebuilt, sourcePoints: points, rebuilt: true };
  }
  let next = previousState;
  if (boundedTailRevision && !appendOnly) {
    const revisionStart = Math.max(0, previousState.sourceCount - 2);
    const headStart = previousState.activeHeadStartIndex;
    if (headStart === null || revisionStart < headStart || !previousState.activeHead) {
      let rebuilt = createIncrementalRoutePresentation();
      for (const point of points) {
        rebuilt = appendPoint(rebuilt, point, fallbackGapMs, fallbackGapDistanceM);
      }
      return { ...rebuilt, sourcePoints: points, rebuilt: true };
    }
    const coordinates = previousState.activeHead.coordinates.slice();
    for (let index = revisionStart; index < previousState.sourceCount; index += 1) {
      coordinates[index - headStart] = coordinateOf(points[index]);
    }
    const activeHead = { ...previousState.activeHead, coordinates };
    const latestUpdatePayloadBytes = payloadBytes([activeHead]);
    next = {
      ...previousState,
      lastSourcePoint: points[previousState.sourceCount - 1],
      activeHead,
      geometryBuildCount: previousState.geometryBuildCount + 1,
      sourceUpdateCount: previousState.sourceUpdateCount + 1,
      latestUpdatePayloadBytes,
      cumulativePayloadBytes: previousState.cumulativePayloadBytes + latestUpdatePayloadBytes,
    };
  }
  if (points.length === previousState.sourceCount) {
    return { ...next, sourcePoints: points, rebuilt: false };
  }
  for (let index = previousState.sourceCount; index < points.length; index += 1) {
    next = appendPoint(next, points[index], fallbackGapMs, fallbackGapDistanceM);
  }
  return { ...next, sourcePoints: points, rebuilt: false };
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
    activeHeadStartIndex = state.sourceCount;
  } else {
    activeHead = { ...activeHead, coordinates: [...activeHead.coordinates, coordinateOf(point)] };
    if (activeHead.coordinates.length > MAX_LIVE_ROUTE_HEAD_POINTS) {
      const frozenCoordinates = activeHead.coordinates.slice(0, MAX_LIVE_ROUTE_HEAD_POINTS);
      const frozen = {
        key: `${activeHead.key}:body-${nextChunkOrdinal++}`,
        coordinates: frozenCoordinates,
      };
      staticChunks = [...staticChunks, frozen];
      changedChunks.push(frozen);
      activeHead = {
        key: `${point.segmentId ?? 'legacy'}:head-${nextChunkOrdinal}`,
        coordinates: [frozenCoordinates[frozenCoordinates.length - 1], coordinateOf(point)],
      };
      activeHeadStartIndex = state.sourceCount - 1;
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
    nextChunkOrdinal,
    geometryBuildCount: state.geometryBuildCount + 1,
    sourceUpdateCount: state.sourceUpdateCount
      + changedChunks.filter(chunk => chunk.coordinates.length >= 2).length,
    latestUpdatePayloadBytes,
    cumulativePayloadBytes: state.cumulativePayloadBytes + latestUpdatePayloadBytes,
    rebuilt: state.rebuilt,
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
    const explicitBreak = Boolean(
      previous.segmentId && point.segmentId && previous.segmentId !== point.segmentId,
    );
    const dtMs = previous.t != null && point.t != null ? point.t - previous.t : 0;
    const fallbackBreak = !explicitBreak
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
