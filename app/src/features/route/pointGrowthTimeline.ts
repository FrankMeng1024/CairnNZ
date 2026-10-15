import type { RoutePoint } from '../../store/useRouteStore';
import { routePointDistanceM } from './orderedRouteDraft';

export interface PointGrowthFrame {
  progress: number;
  head: RoutePoint;
  visiblePoints: RoutePoint[];
  travelledM: number;
  totalM: number;
}

export function pointGrowthDurationMs(points: RoutePoint[]): number {
  const totalM = points.slice(1).reduce((sum, point, index) => sum + routePointDistanceM(points[index], point), 0);
  return Math.round(Math.max(720, Math.min(2_200, 620 + totalM * 3.1)));
}

/** One arc-length clock owns both the revealed line and camera head. */
export function pointGrowthFrame(points: RoutePoint[], progress: number): PointGrowthFrame | null {
  if (points.length < 2) return null;
  const cumulative = [0];
  for (let index = 1; index < points.length; index += 1) {
    cumulative.push(cumulative[index - 1] + routePointDistanceM(points[index - 1], points[index]));
  }
  const totalM = cumulative.at(-1)!;
  if (totalM <= 0) return null;
  const normalized = Math.max(0, Math.min(1, progress));
  const travelledM = normalized * totalM;
  let endIndex = 1;
  while (endIndex < cumulative.length - 1 && cumulative[endIndex] < travelledM) endIndex += 1;
  const segmentStartM = cumulative[endIndex - 1];
  const segmentLengthM = Math.max(1e-9, cumulative[endIndex] - segmentStartM);
  const fraction = Math.max(0, Math.min(1, (travelledM - segmentStartM) / segmentLengthM));
  const start = points[endIndex - 1];
  const end = points[endIndex];
  const head = {
    lat: start.lat + (end.lat - start.lat) * fraction,
    lng: start.lng + (end.lng - start.lng) * fraction,
  };
  const visiblePoints = [...points.slice(0, endIndex), head];
  if (normalized >= 1) visiblePoints[visiblePoints.length - 1] = { ...points.at(-1)! };
  return { progress: normalized, head, visiblePoints, travelledM, totalM };
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

