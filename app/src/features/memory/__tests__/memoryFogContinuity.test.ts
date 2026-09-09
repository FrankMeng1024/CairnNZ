jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
jest.mock('../store/useFriendMemoryStore', () => ({
  useFriendMemoryStore: Object.assign(jest.fn(), {
    getState: jest.fn(() => ({ getEnabledFriendPoints: () => [] })),
  }),
}));

import booleanPointInPolygon from '@turf/boolean-point-in-polygon';
import { buildFogShape } from '../components/FogLayer';

function isStillFogged(shape: NonNullable<ReturnType<typeof buildFogShape>>, lng: number, lat: number): boolean {
  return booleanPointInPolygon({
    type: 'Feature',
    properties: {},
    geometry: { type: 'Point', coordinates: [lng, lat] },
  }, shape);
}

describe('Memory evidence rendering continuity', () => {
  test('overlapping accepted evidence footprints form a continuous component', () => {
    const shape = buildFogShape([
      { lat: 0, lng: 0, ts: 1 },
      { lat: 0, lng: 0.0001, ts: 2 },
      { lat: 0, lng: 0.0002, ts: 3 },
    ]);
    expect(shape).not.toBeNull();
    expect(isStillFogged(shape!, 0.00015, 0)).toBe(false);
  });

  test('GPS gaps and fresh Activities never gain an inferred Memory bridge', () => {
    const shape = buildFogShape([
      { lat: 0, lng: 0, ts: 1 },
      { lat: 0, lng: 0.0001, ts: 2 },
      // A later segment or Activity begins roughly one kilometre away.
      { lat: 0, lng: 0.01, ts: 3 },
      { lat: 0, lng: 0.0101, ts: 4 },
      // A second explicit discontinuity exercises the multi-gap invariant.
      { lat: 0.01, lng: 0.01, ts: 5 },
      { lat: 0.0101, lng: 0.01, ts: 6 },
    ]);
    expect(shape).not.toBeNull();
    expect(isStillFogged(shape!, 0.005, 0)).toBe(true);
    expect(isStillFogged(shape!, 0.01, 0.005)).toBe(true);
    expect(isStillFogged(shape!, 0.01, 0)).toBe(false);
  });
});
