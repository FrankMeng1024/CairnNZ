import type { CanonicalJournalPoint } from '../../../services/hikeTrackWriter';
import { projectActivityJournal } from '../activityJournalProjection';
import { buildBaseFinalTrackPoints } from '../activityFinalArtifact';

function point(
  index: number,
  segmentId = 'segment-a',
  source: CanonicalJournalPoint['source'] = 'background',
): CanonicalJournalPoint {
  const turn = index < 300 ? index : 600 - index;
  return {
    t: 1_000 + index * 1_000,
    lat: -41 + index / 1_000_000,
    lng: 174 + turn / 1_000_000,
    alt: 5,
    accuracy: 5,
    verticalAccuracy: 5,
    speed: 1,
    course: 20,
    rawOrdinal: index + 1,
    source,
    clientActivityId: 'activity-a',
    ownerGeneration: 'generation-a',
    segmentId,
    ...(index === 0 ? { segmentStartReason: 'start' as const } : {}),
  };
}

describe('durable Activity journal projection', () => {
  test.each(['hiking', 'running'])('%s restores the frozen prefix plus later headless tail', () => {
    const durable = Array.from({ length: 620 }, (_, index) => point(index));
    const staleMountedTail = durable.slice(590, 600);

    const projected = projectActivityJournal(staleMountedTail, durable);

    expect(projected.canonical).toHaveLength(620);
    expect(projected.canonical[0].t).toBe(1_000);
    expect(projected.canonical[619].t).toBe(620_000);
    expect(projected.appendedFromJournal).toBe(610);
    expect(projected.live[0].t).toBe(1_000);
    expect(projected.live[projected.live.length - 1].t).toBe(620_000);
    expect(projected.distanceM).toBeGreaterThan(0);
  });

  test('retains explicit gaps without manufacturing a connector', () => {
    const first = [point(0, 'segment-a'), point(1, 'segment-a')];
    const second = [point(20, 'segment-b'), point(21, 'segment-b')].map((item, index) => ({
      ...item,
      ...(index === 0 ? { segmentStartReason: 'gps-reacquired' as const } : {}),
    }));

    const projected = projectActivityJournal([], [...first, ...second]);

    expect(projected.live.map(item => item.segmentId)).toEqual([
      'segment-a', 'segment-a', 'segment-b', 'segment-b',
    ]);
    expect(projected.distanceM).toBeLessThan(10);
  });

  test('deduplicates an already-mounted point by stable evidence identity', () => {
    const durable = [point(0), point(1), point(2)];
    const projected = projectActivityJournal([durable[0], durable[1]], durable);
    expect(projected.canonical).toHaveLength(3);
    expect(projected.appendedFromJournal).toBe(1);
  });

  test('rebasing at commit time retains a foreground fix accepted while the WAL read was in flight', () => {
    const journal = Array.from({ length: 96 }, (_, index) => point(index));
    const stateAtReadStart = journal.slice(0, 72);
    const staleProjection = projectActivityJournal(stateAtReadStart, journal);
    const concurrentForegroundFix = point(96, 'segment-a', 'foreground');

    // This is the old failure: committing a projection calculated before the
    // new foreground fix silently drops that fix.
    expect(staleProjection.canonical.at(-1)).toMatchObject({ rawOrdinal: 96 });

    const currentStateAtCommit = [...stateAtReadStart, concurrentForegroundFix];
    const rebasedProjection = projectActivityJournal(currentStateAtCommit, journal);
    expect(rebasedProjection.canonical).toHaveLength(97);
    expect(rebasedProjection.canonical.at(-1)).toMatchObject({ rawOrdinal: 97 });
  });

  test.each(['hiking', 'running'])('%s keeps a frozen prefix through headless writes, restore, continuation, and Finish', () => {
    const foreground = Array.from({ length: 72 }, (_, index) => point(index, 'segment-a', 'foreground'));
    const headless = Array.from({ length: 24 }, (_, offset) => point(offset + 72, 'segment-a', 'background'));
    const restored = projectActivityJournal(foreground, [...foreground, ...headless]);
    expect(restored.canonical).toHaveLength(96);
    expect(restored.canonical.slice(0, 72)).toEqual(foreground.map(item => expect.objectContaining({
      t: item.t,
      rawOrdinal: item.rawOrdinal,
    })));

    const continued = Array.from({ length: 12 }, (_, offset) => point(offset + 96, 'segment-a', 'foreground'));
    const afterContinuation = projectActivityJournal(
      restored.canonical,
      [...foreground, ...headless, ...continued],
    );
    expect(afterContinuation.canonical).toHaveLength(108);
    expect(afterContinuation.canonical[0]).toMatchObject({ rawOrdinal: 1, t: 1_000 });
    expect(afterContinuation.canonical.at(-1)).toMatchObject({ rawOrdinal: 108, t: 108_000 });
    expect(afterContinuation.live[0]).toMatchObject({ rawOrdinal: 1, t: 1_000 });

    const finish = buildBaseFinalTrackPoints(afterContinuation.canonical);
    expect(finish[0]).toMatchObject({ t: afterContinuation.canonical[0].t });
    expect(finish.at(-1)).toMatchObject({ t: afterContinuation.canonical.at(-1)!.t });
  });
});
