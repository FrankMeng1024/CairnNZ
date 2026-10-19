import type { RoutePoint } from '../../store/useRouteStore';
import { routePointDistanceM } from './orderedRouteDraft';

export interface PointGrowthFrame {
  progress: number;
  head: RoutePoint;
  visiblePoints: RoutePoint[];
  travelledM: number;
  totalM: number;
}

export interface PointGrowthSample {
  progress: number;
  head: RoutePoint;
  visiblePointCount: number;
  travelledM: number;
  totalM: number;
}

export interface PointGrowthTimeline {
  points: RoutePoint[];
  cumulativeM: number[];
  totalM: number;
}

export interface PointCameraStop {
  point: RoutePoint;
  progress: number;
  sourceIndex: number;
}

export function preparePointGrowthTimeline(points: RoutePoint[]): PointGrowthTimeline | null {
  if (points.length < 2) return null;
  const stablePoints = points.map(point => ({ ...point }));
  const cumulativeM = [0];
  for (let index = 1; index < stablePoints.length; index += 1) {
    cumulativeM.push(cumulativeM[index - 1] + routePointDistanceM(stablePoints[index - 1], stablePoints[index]));
  }
  const totalM = cumulativeM.at(-1)!;
  return Number.isFinite(totalM) && totalM > 0 ? { points: stablePoints, cumulativeM, totalM } : null;
}

export function pointGrowthDurationMs(points: RoutePoint[]): number {
  const totalM = points.slice(1).reduce((sum, point, index) => sum + routePointDistanceM(points[index], point), 0);
  // Point is an editing acknowledgement, not route playback. O86's 8 s cap
  // made ordinary 0.8–1.1 km accepted legs take roughly 9–10 s once the
  // bounded entry move was included. Restore the lively O85 distance curve
  // while retaining O86's allocation-light reveal and stable camera path.
  return Math.round(Math.max(720, Math.min(2_200, 620 + totalM * 3.1)));
}

function pointToSegmentDistanceM(
  point: RoutePoint,
  start: RoutePoint,
  end: RoutePoint,
): number {
  const latitude = (point.lat + start.lat + end.lat) / 3;
  const lngScale = 111_320 * Math.cos(latitude * Math.PI / 180);
  const latScale = 110_574;
  const px = (point.lng - start.lng) * lngScale;
  const py = (point.lat - start.lat) * latScale;
  const ex = (end.lng - start.lng) * lngScale;
  const ey = (end.lat - start.lat) * latScale;
  const lengthSquared = ex * ex + ey * ey;
  if (lengthSquared <= 1e-9) return Math.hypot(px, py);
  const fraction = Math.max(0, Math.min(1, (px * ex + py * ey) / lengthSquared));
  return Math.hypot(px - ex * fraction, py - ey * fraction);
}

/**
 * Reduce dense provider vertices to the actual bends the native camera must
 * follow. Every retained stop is tied to the same source arc-length clock as
 * the reveal head; no independent camera timeline or per-provider-vertex
 * chase is introduced.
 */
export function pointCameraStops(
  timeline: PointGrowthTimeline,
  toleranceM: number,
): PointCameraStop[] {
  const { points, cumulativeM, totalM } = timeline;
  if (points.length < 2 || totalM <= 0) return [];
  const keep = new Set<number>([0, points.length - 1]);
  const ranges: Array<[number, number]> = [[0, points.length - 1]];
  const threshold = Math.max(0.2, toleranceM);
  while (ranges.length > 0) {
    const [startIndex, endIndex] = ranges.pop()!;
    if (endIndex - startIndex <= 1) continue;
    let furthestIndex = -1;
    let furthestDistanceM = threshold;
    for (let index = startIndex + 1; index < endIndex; index += 1) {
      const distanceM = pointToSegmentDistanceM(points[index], points[startIndex], points[endIndex]);
      if (distanceM > furthestDistanceM) {
        furthestDistanceM = distanceM;
        furthestIndex = index;
      }
    }
    if (furthestIndex < 0) continue;
    keep.add(furthestIndex);
    ranges.push([startIndex, furthestIndex], [furthestIndex, endIndex]);
  }
  const stops = [...keep]
    .sort((a, b) => a - b)
    .map(sourceIndex => ({
      point: points[sourceIndex],
      progress: cumulativeM[sourceIndex] / totalM,
      sourceIndex,
    }));
  if (stops.length <= 2) return stops;
  // Provider geometry can place two RDP bends less than two display frames
  // apart around a noisy reversal. Such a stop cannot present meaningfully,
  // but a genuine ~60 ms U-turn (Test3) must remain so the camera follows the
  // visible head instead of cutting its corner. Exact segment durations mean
  // retained stops no longer inflate the overall follow clock.
  const collapsed: PointCameraStop[] = [stops[0]];
  for (let index = 1; index < stops.length - 1; index += 1) {
    const priorStop = collapsed.at(-1)!;
    const priorPriorStop = collapsed.at(-2);
    if (priorPriorStop && stops[index].progress - priorStop.progress < 0.014) {
      const incoming = {
        x: priorStop.point.lng - priorPriorStop.point.lng,
        y: priorStop.point.lat - priorPriorStop.point.lat,
      };
      const outgoing = {
        x: stops[index].point.lng - priorStop.point.lng,
        y: stops[index].point.lat - priorStop.point.lat,
      };
      const denominator = Math.hypot(incoming.x, incoming.y) * Math.hypot(outgoing.x, outgoing.y);
      const turnDegrees = denominator > 1e-12
        ? Math.acos(Math.max(-1, Math.min(1,
          (incoming.x * outgoing.x + incoming.y * outgoing.y) / denominator,
        ))) * 180 / Math.PI
        : 0;
      if (turnDegrees >= 135) continue;
    }
    collapsed.push(stops[index]);
  }
  const finalStop = stops.at(-1)!;
  collapsed.push(finalStop);
  return collapsed;
}

export function pointCameraToleranceM(points: RoutePoint[], zoom: number): number {
  const latitude = points.length > 0
    ? points.reduce((sum, point) => sum + point.lat, 0) / points.length
    : 0;
  const metresPerPixel = 156_543.03392 * Math.cos(latitude * Math.PI / 180) / 2 ** Math.max(0, zoom);
  // The previous sub-pixel cap retained nearly every small provider bend
  // (19 camera stops on the real Test2 leg). Each stop restarts a native/Web
  // camera segment even though the resulting correction is visually
  // imperceptible. A 1.75-screen-pixel bound keeps tight returns within the
  // visible-center contract while materially reducing camera churn.
  return Math.max(0.5, Math.min(8, metresPerPixel * 1.75));
}

/**
 * Allocation-light animation sample. The hot path does not rebuild the
 * already-committed provider polyline on every display frame.
 */
export function pointGrowthSample(
  timeline: PointGrowthTimeline,
  progress: number,
  reusable?: PointGrowthSample,
): PointGrowthSample {
  const { points, cumulativeM: cumulative, totalM } = timeline;
  const normalized = Math.max(0, Math.min(1, progress));
  const travelledM = normalized * totalM;
  let low = 1;
  let high = cumulative.length - 1;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (cumulative[middle] < travelledM) low = middle + 1;
    else high = middle;
  }
  const endIndex = low;
  const segmentStartM = cumulative[endIndex - 1];
  const segmentLengthM = Math.max(1e-9, cumulative[endIndex] - segmentStartM);
  const fraction = Math.max(0, Math.min(1, (travelledM - segmentStartM) / segmentLengthM));
  const start = points[endIndex - 1];
  const end = points[endIndex];
  const sample = reusable ?? {
    progress: 0,
    head: { lat: start.lat, lng: start.lng },
    visiblePointCount: 2,
    travelledM: 0,
    totalM,
  };
  sample.progress = normalized;
  sample.head.lat = start.lat + (end.lat - start.lat) * fraction;
  sample.head.lng = start.lng + (end.lng - start.lng) * fraction;
  sample.visiblePointCount = endIndex + 1;
  sample.travelledM = travelledM;
  sample.totalM = totalM;
  return sample;
}

/** One arc-length clock owns both the revealed line and camera head. */
export function pointGrowthFrame(pointsOrTimeline: RoutePoint[] | PointGrowthTimeline, progress: number): PointGrowthFrame | null {
  const timeline = Array.isArray(pointsOrTimeline)
    ? preparePointGrowthTimeline(pointsOrTimeline)
    : pointsOrTimeline;
  if (!timeline) return null;
  const sample = pointGrowthSample(timeline, progress);
  const endIndex = Math.max(1, sample.visiblePointCount - 1);
  const visiblePoints = [...timeline.points.slice(0, endIndex), sample.head];
  if (sample.progress >= 1) visiblePoints[visiblePoints.length - 1] = { ...timeline.points.at(-1)! };
  return { ...sample, visiblePoints };
}

export function pointInsideUsableMap(
  point: { x: number; y: number },
  viewport: { width: number; height: number; topInset: number; bottomInset: number },
): boolean {
  const left = Math.max(32, viewport.width * 0.18);
  const right = Math.min(viewport.width - 32, viewport.width * 0.82);
  const top = viewport.topInset + 72;
  const bottom = viewport.height - viewport.bottomInset - 56;
  return point.x >= left && point.x <= right && point.y >= top && point.y <= bottom;
}
