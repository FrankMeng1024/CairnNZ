import type { DurableActivityContext } from '../../../services/backgroundLocationTask';
import type { CanonicalJournalPoint } from '../../../services/hikeTrackWriter';
import { reconcileActivityContinuityAfterJournal } from '../activityContinuityReconciliation';
import {
  acceptRealGpsObservation,
  createRealGpsContinuityState,
  type RealGpsObservation,
} from '../realGpsContinuity';

const ACTIVITY = '11111111-1111-4111-8111-111111111111';
const GENERATION = 'generation-a';

function journalPoint(index: number): CanonicalJournalPoint {
  return {
    t: 1_800_000_000_000 + index * 4_000,
    lat: -41.28,
    lng: 174.77 + index / 100_000,
    alt: 5,
    accuracy: 7,
    verticalAccuracy: 9,
    speed: 1.2,
    speedAccuracy: null,
    course: 90,
    courseAccuracy: null,
    rawOrdinal: index + 1,
    source: 'background',
    clientActivityId: ACTIVITY,
    ownerGeneration: GENERATION,
    segmentId: 'segment-a',
  };
}

function durableContext(last: CanonicalJournalPoint, rawOrdinal: number): DurableActivityContext {
  const observation: RealGpsObservation = {
    lat: last.lat,
    lng: last.lng,
    t: last.t,
    accuracy: last.accuracy,
    source: 'background',
    observationId: `background-${last.rawOrdinal}`,
    rawOrdinal: last.rawOrdinal,
  };
  const continuity = acceptRealGpsObservation(
    createRealGpsContinuityState(),
    observation,
    last.segmentId,
  ).state;
  return {
    clientActivityId: ACTIVITY,
    userId: 'owner-a',
    ownerGeneration: GENERATION,
    segmentId: last.segmentId,
    activityMode: 'hiking',
    acceptAfterMs: 1,
    continuityState: { ...continuity, latestObservationTimestamp: last.t + 1_000 },
    rawOrdinal,
  };
}

describe('foreground continuity reconciliation', () => {
  test.each(['hiking', 'running'] as const)('%s resumes beyond the headless raw high-watermark', mode => {
    const journal = Array.from({ length: 100 }, (_unused, index) => journalPoint(index));
    const context: DurableActivityContext = {
      ...durableContext(journal[99], 104),
      activityMode: mode,
    };
    const result = reconcileActivityContinuityAfterJournal({
      clientActivityId: ACTIVITY,
      ownerGeneration: GENERATION,
      journal,
      durableContext: context,
      currentRawOrdinal: 40,
    });
    expect(result.source).toBe('durable-context');
    expect(result.rawOrdinal).toBe(104);
    expect(result.continuityState.lastTrusted?.rawOrdinal).toBe(100);
    expect(result.continuityState.latestObservationTimestamp).toBe(journal[99].t + 1_000);
    // Pre-fix foreground takeover used only its mounted watermark (40), so
    // its next fix reused ordinal 41 already owned by the headless journal.
    expect(40 + 1).toBeLessThanOrEqual(journal.at(-1)!.rawOrdinal!);
    expect(result.rawOrdinal + 1).toBeGreaterThan(journal.at(-1)!.rawOrdinal!);
  });

  test('falls back to the complete owned journal and ignores another generation', () => {
    const owned = Array.from({ length: 80 }, (_unused, index) => journalPoint(index));
    const stale = { ...journalPoint(200), ownerGeneration: 'old-generation', rawOrdinal: 400 };
    const result = reconcileActivityContinuityAfterJournal({
      clientActivityId: ACTIVITY,
      ownerGeneration: GENERATION,
      journal: [...owned, stale],
      durableContext: null,
      currentRawOrdinal: 20,
    });
    expect(result.source).toBe('journal');
    expect(result.rawOrdinal).toBe(80);
    expect(result.continuityState.lastTrusted?.rawOrdinal).toBe(80);
  });
});
