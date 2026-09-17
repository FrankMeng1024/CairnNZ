import { haversineM } from '../../utils/geo';

export interface LivePacePoint {
  lat: number;
  lng: number;
  t: number;
  accuracy?: number | null;
  segmentId?: string;
}

export interface LivePaceResult {
  secondsPerKm: number | null;
  evidenceDistanceM: number;
  evidenceDurationMs: number;
  reason: 'available' | 'not-recording' | 'stale' | 'poor-accuracy' | 'insufficient' | 'stationary' | 'implausible';
}

const WINDOW_MS = 35_000;
const MAX_WINDOW_DISTANCE_M = 140;
const MIN_EVIDENCE_DURATION_MS = 12_000;
const MIN_EVIDENCE_DISTANCE_M = 20;
const RECENT_MOTION_MS = 10_000;
const MIN_RECENT_MOTION_M = 5;
const MAX_POINT_AGE_MS = 12_000;
const MAX_ACCURACY_M = 25;

/**
 * Run Live Pace answers “how fast am I moving recently?” from accepted
 * canonical movement. The window is the newest 35 s or 140 m, whichever is
 * reached first, and never crosses a segment/Resume boundary. It requires at
 * least 12 s and 20 m of useful evidence. A stale/stationary/poor-accuracy
 * window is deliberately unavailable instead of presenting false precision.
 */
export function deriveLivePace(args: {
  points: LivePacePoint[];
  nowMs: number;
  recording: boolean;
}): LivePaceResult {
  const unavailable = (reason: LivePaceResult['reason'], evidenceDistanceM = 0, evidenceDurationMs = 0): LivePaceResult => ({
    secondsPerKm: null,
    evidenceDistanceM,
    evidenceDurationMs,
    reason,
  });
  if (!args.recording) return unavailable('not-recording');
  const tail = args.points[args.points.length - 1];
  if (!tail || args.nowMs - tail.t > MAX_POINT_AGE_MS) return unavailable('stale');
  const segmentId = tail.segmentId ?? '__legacy';
  const eligible: LivePacePoint[] = [];
  let accuracyBoundary = false;
  for (let index = args.points.length - 1; index >= 0; index -= 1) {
    const point = args.points[index];
    if ((point.segmentId ?? '__legacy') !== segmentId) break;
    if (point.accuracy != null && point.accuracy > MAX_ACCURACY_M) {
      accuracyBoundary = true;
      break;
    }
    eligible.unshift(point);
  }
  if (eligible.length < 2) {
    return unavailable(accuracyBoundary || args.points.length >= 2 ? 'poor-accuracy' : 'insufficient');
  }

  const selected: LivePacePoint[] = [eligible[eligible.length - 1]];
  let distanceM = 0;
  for (let index = eligible.length - 2; index >= 0; index -= 1) {
    const newer = selected[0];
    const point = eligible[index];
    const edgeM = haversineM(point, newer);
    const proposedDurationMs = tail.t - point.t;
    if (proposedDurationMs > WINDOW_MS || distanceM + edgeM > MAX_WINDOW_DISTANCE_M) break;
    selected.unshift(point);
    distanceM += edgeM;
  }
  const durationMs = tail.t - selected[0].t;
  if (durationMs < MIN_EVIDENCE_DURATION_MS || distanceM < MIN_EVIDENCE_DISTANCE_M) {
    return unavailable('insufficient', distanceM, durationMs);
  }

  let recentDistanceM = 0;
  for (let index = selected.length - 1; index > 0; index -= 1) {
    if (tail.t - selected[index - 1].t > RECENT_MOTION_MS) break;
    recentDistanceM += haversineM(selected[index - 1], selected[index]);
  }
  if (recentDistanceM < MIN_RECENT_MOTION_M) return unavailable('stationary', distanceM, durationMs);

  const secondsPerKm = durationMs / 1_000 / (distanceM / 1_000);
  if (!Number.isFinite(secondsPerKm) || secondsPerKm < 90 || secondsPerKm > 1_200) {
    return unavailable('implausible', distanceM, durationMs);
  }
  return { secondsPerKm, evidenceDistanceM: distanceM, evidenceDurationMs: durationMs, reason: 'available' };
}

/** Whole-Activity average remains a separate Summary/Detail metric. */
export function deriveAveragePaceSecondsPerKm(durationS: number, distanceM: number): number | null {
  return durationS > 0 && distanceM > 0 ? durationS / (distanceM / 1_000) : null;
}
