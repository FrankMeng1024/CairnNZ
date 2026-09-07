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
});
