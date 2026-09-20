jest.mock('../store/useH3VisitedStore', () => ({
  useH3VisitedStore: { getState: () => ({ addPointToCells: jest.fn(), clear: jest.fn() }) },
}));
jest.mock('../services/lastFixCache', () => ({ persistLastFix: jest.fn() }));

import { useMemoryStore } from '../store/useMemoryStore';

describe('central Memory semantic authority', () => {
  beforeEach(() => useMemoryStore.getState().resetForUserSwitch());

  test('overlapping Activity, passive and Cairn evidence creates one explored place', () => {
    const store = useMemoryStore.getState();
    store.recordPoint(-41, 174, 1_000);
    store.recordPoint(-41.00001, 174, 2_000); // roughly 1.1m away
    store.recordPoint(-41, 174.00001, 3_000); // roughly 0.8m away
    expect(useMemoryStore.getState().points).toHaveLength(1);
  });

  test('distinct explored cells remain independent', () => {
    useMemoryStore.getState().recordPoint(-41, 174, 1_000);
    useMemoryStore.getState().recordPoint(-41.0003, 174, 2_000);
    expect(useMemoryStore.getState().points).toHaveLength(2);
  });

  test('server acknowledgement does not replace the client Memory identity or geometry', () => {
    useMemoryStore.getState().recordPoint(-41, 174, 1_000);
    const before = useMemoryStore.getState().points[0];
    useMemoryStore.getState().markPointsSyncedByCid([before.cid]);
    const after = useMemoryStore.getState().points[0];
    expect(after).toMatchObject({ lat: before.lat, lng: before.lng, cid: before.cid, synced: true });
  });

  test('a later real return preserves presence without inflating coverage', () => {
    const day = 24 * 60 * 60 * 1000;
    const first = useMemoryStore.getState().recordPoint(-45, 170, day, {
      source: 'passive_real',
      horizontalAccuracyM: 8,
      continuityState: 'accepted',
    });
    const returned = useMemoryStore.getState().recordPoint(-45, 170, day * 4, {
      source: 'passive_real',
      horizontalAccuracyM: 7,
      continuityState: 'accepted',
    });

    expect(first).toMatchObject({ coverageChanged: true, presenceChanged: true });
    expect(returned).toMatchObject({ coverageChanged: false, presenceChanged: true });
    expect(useMemoryStore.getState().points).toHaveLength(1);
    expect(useMemoryStore.getState().presenceWitnesses).toHaveLength(2);
    expect(useMemoryStore.getState().presenceWitnesses.map((witness: any) => witness.observedAtMs))
      .toEqual([day, day * 4]);
  });

  test('a later real Activity at the same place is a new witness, not new coverage', () => {
    const first = useMemoryStore.getState().recordPoint(-41, 174, 100_000, {
      source: 'activity_real',
      sourceActivityClientId: '11111111-1111-4111-8111-111111111111',
      sourceSegmentId: 'segment-first',
      horizontalAccuracyM: 6,
      continuityState: 'accepted',
    });
    const second = useMemoryStore.getState().recordPoint(-41, 174, 200_000, {
      source: 'activity_real',
      sourceActivityClientId: '22222222-2222-4222-8222-222222222222',
      sourceSegmentId: 'segment-second',
      horizontalAccuracyM: 5,
      continuityState: 'accepted',
    });
    expect(first.coverageChanged).toBe(true);
    expect(second).toMatchObject({ coverageChanged: false, presenceChanged: true });
    expect(useMemoryStore.getState().points).toHaveLength(1);
    expect(useMemoryStore.getState().presenceWitnesses).toHaveLength(2);
  });

  test('stale repeats do not inflate presence, while a fresh same-context observation advances latest only', () => {
    const activityId = '11111111-1111-4111-8111-111111111111';
    const metadata = {
      source: 'activity_real' as const,
      sourceActivityClientId: activityId,
      sourceSegmentId: 'segment-a',
      horizontalAccuracyM: 8,
      continuityState: 'accepted' as const,
    };
    useMemoryStore.getState().recordPoint(-41, 174, 100_000, metadata);
    const stale = useMemoryStore.getState().recordPoint(-41, 174, 100_000, metadata);
    const fresh = useMemoryStore.getState().recordPoint(-41.00001, 174, 116_000, metadata);

    expect(stale).toMatchObject({ coverageChanged: false, presenceChanged: false });
    expect(fresh).toMatchObject({ coverageChanged: false, presenceChanged: true });
    expect(useMemoryStore.getState().presenceWitnesses).toHaveLength(1);
    expect(useMemoryStore.getState().presenceWitnesses[0]).toMatchObject({
      firstObservedAtMs: 100_000,
      observedAtMs: 116_000,
      firstLat: -41,
      lat: -41.00001,
    });
  });

  test('stronger real provenance is additive and never rewrites old provenance', () => {
    useMemoryStore.getState().recordPoint(-41, 174, 100_000, {
      source: 'passive_real', horizontalAccuracyM: 9, continuityState: 'accepted',
    });
    useMemoryStore.getState().recordPoint(-41, 174, 120_000, {
      source: 'activity_real',
      sourceActivityClientId: '11111111-1111-4111-8111-111111111111',
      sourceSegmentId: 'segment-activity',
      horizontalAccuracyM: 5,
      continuityState: 'accepted',
    });
    expect(useMemoryStore.getState().points).toHaveLength(1);
    expect(useMemoryStore.getState().presenceWitnesses.map(witness => witness.evidenceSource))
      .toEqual(['passive_real', 'activity_real']);
    expect(useMemoryStore.getState().presenceWitnesses[0].firstObservedAtMs).toBe(100_000);
  });

  test.each([
    [{ source: 'historical_unknown' as const, horizontalAccuracyM: 5, continuityState: 'accepted' as const }],
    [{ source: 'simulator_test' as const, horizontalAccuracyM: 5, continuityState: 'accepted' as const }],
    [{ source: 'passive_real' as const, horizontalAccuracyM: 80, continuityState: 'accepted' as const }],
    [{ source: 'passive_real' as const, horizontalAccuracyM: 5, continuityState: 'unknown' as const }],
  ])('unknown, simulator, inaccurate, or unresolved evidence creates no real presence witness', (metadata) => {
    useMemoryStore.getState().recordPoint(-41, 174, 100_000, metadata);
    expect(useMemoryStore.getState().presenceWitnesses).toEqual([]);
  });
});
