import type { CanonicalJournalPoint } from '../../../services/hikeTrackWriter';
import { projectActivityJournal } from '../activityJournalProjection';

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
});
