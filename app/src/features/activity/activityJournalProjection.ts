import type { CanonicalJournalPoint } from '../../services/hikeTrackWriter';
import type { TrackPoint } from '../../store/useSessionStore';
import { buildCausalLiveRoute } from './causalLiveRoute';
import { calculateActivityStats } from './activityContracts';

function pointKey(point: TrackPoint): string {
  const rawOrdinal = point.rawOrdinal;
  return rawOrdinal != null
    ? `${point.segmentId ?? 'legacy'}:ordinal:${rawOrdinal}`
    : `${point.segmentId ?? 'legacy'}:${point.t}:${point.lat.toFixed(7)}:${point.lng.toFixed(7)}`;
}

function asTrackPoint(point: CanonicalJournalPoint | TrackPoint): TrackPoint {
  return {
    lat: point.lat,
    lng: point.lng,
    alt: point.alt ?? null,
    accuracy: point.accuracy ?? null,
    verticalAccuracy: point.verticalAccuracy ?? null,
    speed: point.speed ?? null,
    course: point.course ?? null,
    t: Math.floor(point.t),
    rawOrdinal: point.rawOrdinal,
    segmentId: point.segmentId,
    segmentStartReason: point.segmentStartReason,
  };
}

export interface ActivityJournalProjection {
  canonical: TrackPoint[];
  live: TrackPoint[];
  distanceM: number;
  elevationGainM: number;
  appendedFromJournal: number;
}

/**
 * Rebuild the visible Activity from the durable canonical ledger. The journal
 * supplies history that a headless wake committed while no React store was
 * mounted; current canonical points are retained only when the same durable
 * snapshot has not exposed them yet. Stable identity is segment + raw ordinal
 * (or exact evidence fields for legacy points), never title or rounded metrics.
 */
export function projectActivityJournal(
  current: ReadonlyArray<TrackPoint>,
  journal: ReadonlyArray<CanonicalJournalPoint>,
): ActivityJournalProjection {
  const byKey = new Map<string, TrackPoint>();
  for (const point of current) byKey.set(pointKey(point), asTrackPoint(point));
  let appendedFromJournal = 0;
  for (const journalPoint of journal) {
    const point = asTrackPoint(journalPoint);
    const key = pointKey(point);
    if (!byKey.has(key)) appendedFromJournal += 1;
    // The checksummed journal wins when an in-memory twin differs.
    byKey.set(key, point);
  }
  const canonical = Array.from(byKey.values()).sort((left, right) => (
    left.t - right.t
    || (left.rawOrdinal ?? Number.MAX_SAFE_INTEGER) - (right.rawOrdinal ?? Number.MAX_SAFE_INTEGER)
  ));
  const stats = calculateActivityStats(canonical);
  return {
    canonical,
    live: buildCausalLiveRoute(canonical),
    distanceM: stats.distanceM,
    elevationGainM: stats.elevationGainM,
    appendedFromJournal,
  };
}
