import { buildAcquiredCairnFeatureCollection, stableAcquiredGroupOrder } from '../components/acquiredCairnClusters';

describe('acquired Cairn map source', () => {
  test('keeps one selectable feature per Cairn even at identical coordinates', () => {
    const collection = buildAcquiredCairnFeatureCollection([
      { markerId: '1', lat: -41.2865, lng: 174.7762, unread: true, acquiredAt: null, sourceAudience: 'friends', authorName: 'Aroha', currentFriend: true },
      { markerId: '2', lat: -41.2865, lng: 174.7762, unread: false, acquiredAt: null, sourceAudience: 'public', authorName: null, currentFriend: false },
      { markerId: '3', lat: -41.2864, lng: 174.7763, unread: true, acquiredAt: null, sourceAudience: null, authorName: null, currentFriend: false },
    ]);
    expect(collection.features.map(feature => feature.id)).toEqual(['1', '2', '3']);
    expect(collection.features[0].geometry.coordinates).toEqual(collection.features[1].geometry.coordinates);
    expect(collection.features.map(feature => feature.properties.unread)).toEqual([1, 0, 1]);
  });

  test('freezes deterministic unread/current-friend ordering for an opened group', () => {
    const markers = [
      { markerId: 'read', lat: 0, lng: 0, unread: false, acquiredAt: '2026-10-13T03:00:00Z', sourceAudience: 'public' as const, authorName: null, currentFriend: false },
      { markerId: 'unread', lat: 0, lng: 0, unread: true, acquiredAt: '2026-10-13T02:00:00Z', sourceAudience: 'public' as const, authorName: null, currentFriend: false },
      { markerId: 'friend', lat: 0, lng: 0, unread: false, acquiredAt: '2026-10-13T01:00:00Z', sourceAudience: 'friends' as const, authorName: 'A', currentFriend: true },
    ];
    expect(stableAcquiredGroupOrder(['read', 'unread', 'friend'], markers)).toEqual(['friend', 'unread', 'read']);
  });
});
