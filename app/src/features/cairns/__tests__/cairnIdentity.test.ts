import type { Marker } from '../../../store/useMarkerStore';
import {
  cairnMatchesIdentity,
  cairnStableId,
  mergeOwnedCairns,
} from '../cairnIdentity';

function marker(patch: Partial<Marker> = {}): Marker {
  return {
    id: 'client-a',
    clientCairnId: 'client-a',
    localId: 'client-a',
    serverCairnId: '42',
    type: 'cairn',
    regionCode: 'nz',
    lat: -43,
    lng: 170,
    note: '',
    authorId: 'owner-a',
    createdAt: 100,
    permission: 'personal',
    synced: true,
    syncState: 'synced',
    ...patch,
  };
}

describe('one owned Cairn identity', () => {
  test('Quick, Plant, Activity, map, list, local and server ids resolve one object', () => {
    const owned = marker();
    for (const id of ['client-a', '42']) {
      expect(cairnMatchesIdentity(owned, id)).toBe(true);
    }
    expect(cairnStableId(owned)).toBe('client-a');
  });

  test('fast acknowledgement shapes deduplicate without replacing stable client identity', () => {
    const local = marker({ serverCairnId: undefined, synced: false, syncState: 'pending', note: 'Local truth' });
    const server = marker({ id: 'client-a', localId: undefined, note: 'Server truth' });
    const merged = mergeOwnedCairns([local], [server]);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({
      id: 'client-a',
      clientCairnId: 'client-a',
      serverCairnId: '42',
      note: 'Local truth',
      syncState: 'pending',
    });
  });

  test('a newer accepted local edit cannot be overwritten by stale hydration', () => {
    const accepted = marker({ note: 'New words', updatedAt: 2_000 });
    const stale = marker({ note: 'Old words', updatedAt: 1_000 });
    expect(mergeOwnedCairns([accepted], [stale])[0].note).toBe('New words');
  });

  test('tombstones exclude cache, server and late acknowledgement projections', () => {
    const tombstones = new Set(['client-a']);
    expect(mergeOwnedCairns([marker()], [marker()], tombstones)).toEqual([]);
  });

  test('recent-first ordering is stable for equal creation times', () => {
    const merged = mergeOwnedCairns(
      [marker({ id: 'client-b', clientCairnId: 'client-b', localId: 'client-b', serverCairnId: '43', createdAt: 200 })],
      [marker({ createdAt: 100 })],
    );
    expect(merged.map(cairnStableId)).toEqual(['client-b', 'client-a']);
  });
});
