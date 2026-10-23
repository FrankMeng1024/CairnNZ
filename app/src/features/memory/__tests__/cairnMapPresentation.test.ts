import { excludeAcquiredFriendMarkers, markersForMemoryScope } from '../services/cairnMapPresentation';

const marker = (id: string, serverCairnId?: string) => ({
  id,
  serverCairnId,
  type: 'cairn',
  regionCode: 'nz',
  lat: -41.28,
  lng: 174.77,
  note: 'Friend cairn',
  authorId: 'friend-1',
  createdAt: 1,
  permission: 'group',
}) as any;

describe('Memory map Cairn presentation', () => {
  test('omits acquired Friend Cairns from the generic pin layer by stable server id', () => {
    const result = excludeAcquiredFriendMarkers(
      [marker('legacy-local', '42'), marker('43')],
      [{ markerId: '42', lat: -41.28, lng: 174.77 }] as any,
    );

    expect(result.map(item => item.id)).toEqual(['43']);
  });

  test('Friends composite always preserves Mine Cairns and dedupes borrowed/acquired copies', () => {
    const mine = marker('mine-1');
    const result = markersForMemoryScope(
      'combined',
      [mine],
      [marker('mine-1'), marker('borrowed-2'), marker('legacy-acquired', '42')],
      [{ markerId: '42', lat: -41.28, lng: 174.77 }] as any,
    );

    expect(result.map(item => item.id)).toEqual(['mine-1', 'borrowed-2']);
    expect(result[0]).toBe(mine);
  });
});
