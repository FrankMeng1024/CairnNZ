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
      && dtMs > fallbackGapMs
      && haversineM(previous, point) > fallbackGapDistanceM;
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
