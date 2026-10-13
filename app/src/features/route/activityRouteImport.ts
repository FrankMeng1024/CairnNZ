import type { TrackPoint } from '../../store/useSessionStore';

/**
 * A local canonical Activity track is the highest-fidelity factual source for
 * a new independent Route. The persisted selected Final remains the fallback
 * for cross-device or legacy rows without a local canonical track.
 */
export function selectActivityRouteImportPoints(
  canonicalPoints: readonly TrackPoint[],
  selectedFinalPoints: readonly TrackPoint[],
): TrackPoint[] {
  const source = canonicalPoints.length >= 2 ? canonicalPoints : selectedFinalPoints;
  return source.map(point => ({ ...point }));
}
