import type { TrackPoint } from '../../store/useSessionStore';
import { haversineM } from '../../utils/geo';

export interface SimulatorRollbackPlan {
  keptPoints: TrackPoint[];
  removedPoints: TrackPoint[];
  requestedDistanceM: number;
  actualDistanceM: number;
}

/**
 * Plans a Debug correction exclusively from accepted Activity evidence.
 * Whole committed points are removed; rejected raw samples never increase the
 * requested rollback amount. At least the Activity origin remains.
 */
export function planSimulatorRollback(
  points: ReadonlyArray<TrackPoint>,
  requestedDistanceM: number,
): SimulatorRollbackPlan | null {
  if (!Number.isFinite(requestedDistanceM) || requestedDistanceM <= 0 || points.length < 2) return null;
  let cutoff = points.length - 1;
  let actualDistanceM = 0;
  while (cutoff > 0 && actualDistanceM < requestedDistanceM) {
    const current = points[cutoff];
    const previous = points[cutoff - 1];
    const sameSegment = !current.segmentId || !previous.segmentId || current.segmentId === previous.segmentId;
    if (sameSegment) actualDistanceM += haversineM(previous, current);
    cutoff -= 1;
  }
  if (cutoff === points.length - 1) return null;
  return {
    keptPoints: points.slice(0, cutoff + 1),
    removedPoints: points.slice(cutoff + 1),
    requestedDistanceM,
    actualDistanceM,
  };
}

