import { excludeAcquiredFriendMarkers } from '../services/cairnMapPresentation';

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
});
