import type { DurableActivityContext } from '../../services/backgroundLocationTask';
import type { CanonicalJournalPoint } from '../../services/hikeTrackWriter';
import {
  restoreRealGpsContinuityState,
  type RealGpsContinuityState,
  type TrustedMotionObservation,
} from './realGpsContinuity';

function restoredObservation(
  point: CanonicalJournalPoint,
  index: number,
): TrustedMotionObservation {
  return {
    lat: point.lat,
    lng: point.lng,
    t: point.t,
    accuracy: point.accuracy,
    verticalAccuracy: point.verticalAccuracy,
    altitude: point.alt,
    speed: point.speed,
    course: point.course,
    source: point.source === 'simulator' ? 'foreground' : point.source,
    observationId: `journal-restored-${index}-${point.t}`,
    rawOrdinal: point.rawOrdinal,
    segmentId: point.segmentId,
  };
}

/**
 * Re-establishes the foreground classifier's ordering/continuity authority
 * after a headless TaskManager runtime has owned GPS. The durable context owns
 * rejected/pending observations and the raw watermark; the canonical journal
 * supplies a verified fallback trusted tail. Neither input changes route data.
 */
export function reconcileActivityContinuityAfterJournal(input: {
  clientActivityId: string;
  ownerGeneration: string;
  journal: ReadonlyArray<CanonicalJournalPoint>;
  durableContext: DurableActivityContext | null;
  currentRawOrdinal: number;
}): { continuityState: RealGpsContinuityState; rawOrdinal: number; source: 'durable-context' | 'journal' } {
  const ownedJournal = input.journal.filter(point => (
    point.clientActivityId === input.clientActivityId
    && point.ownerGeneration === input.ownerGeneration
  ));
  const fallback = ownedJournal.slice(-2).map(restoredObservation);
  const context = input.durableContext?.clientActivityId === input.clientActivityId
    && input.durableContext.ownerGeneration === input.ownerGeneration
    ? input.durableContext
    : null;
  return {
    continuityState: restoreRealGpsContinuityState(context?.continuityState, fallback),
    rawOrdinal: Math.max(
      input.currentRawOrdinal,
      Number(context?.rawOrdinal) || 0,
      ...ownedJournal.map(point => point.rawOrdinal ?? 0),
    ),
    source: context ? 'durable-context' : 'journal',
  };
}
