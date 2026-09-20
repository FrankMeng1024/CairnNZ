jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
jest.mock('../store/useFriendMemoryStore', () => ({
  useFriendMemoryStore: Object.assign(jest.fn(), {
    getState: jest.fn(() => ({ getEnabledFriendPoints: () => [] })),
  }),
}));

import booleanPointInPolygon from '@turf/boolean-point-in-polygon';
import {
  buildFogShape,
  MEMORY_FOG_GEOMETRY_REVISION,
  memoryFogContentSignature,
  selectFogEvidencePoints,
} from '../components/FogLayer';

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

  test('display smoothing remains clipped to the original accepted footprint', () => {
    const shape = buildFogShape([
      { lat: 0, lng: 0, ts: 1 },
      { lat: 0, lng: 0.0002, ts: 2 },
    ]);
    expect(shape).not.toBeNull();
    // Evidence centres remain visible, while a location beyond the configured
    // 30 m footprint cannot be invented by the presentation smoother.
    expect(isStillFogged(shape!, 0, 0)).toBe(false);
    expect(isStillFogged(shape!, 0.0002, 0)).toBe(false);
    expect(isStillFogged(shape!, 0, 0.0003)).toBe(true);
  });

  test('1999/2000/2001 points cannot lose prior evidence at the former stride boundary', () => {
    const points = Array.from({ length: 2001 }, (_, index) => ({
      lat: 0,
      lng: index === 1 ? 0.01 : 0,
      ts: index + 1,
    }));
    for (const count of [1999, 2000, 2001]) {
      expect(selectFogEvidencePoints(points.slice(0, count))).toContain(points[1]);
    }
  });

  test('middle geometry and friend authorization revisions invalidate equal-count caches', () => {
    const points = [
      { cid: 'first', lat: -41, lng: 174, ts: 1 },
      { cid: 'middle', lat: -41.001, lng: 174.001, ts: 2 },
      { cid: 'last', lat: -41.002, lng: 174.002, ts: 3 },
    ];
    const moved = points.map(point => ({ ...point }));
    moved[1].lat = -41.01;
    const ring: Array<[number, number]> = [[174, -41], [174.01, -41], [174.01, -41.01], [174, -41.01], [174, -41]];
    const cells = [{ id: 'cell', polygon: ring, sourceFriendId: 'a', authorizationVersion: 1, projectionVersion: 'p1' }];
    const revised = [{ ...cells[0], authorizationVersion: 2, projectionVersion: 'p2' }];

    expect(memoryFogContentSignature('viewer|combined', points, cells))
      .not.toBe(memoryFogContentSignature('viewer|combined', moved, cells));
    expect(memoryFogContentSignature('viewer|combined', points, cells))
      .not.toBe(memoryFogContentSignature('viewer|combined', points, revised));
    expect(memoryFogContentSignature('viewer-a|self', points, []))
      .not.toBe(memoryFogContentSignature('viewer-b|self', points, []));
    expect(memoryFogContentSignature('viewer-a|self', points, []))
      .toContain(`|${MEMORY_FOG_GEOMETRY_REVISION}|`);
  });
});
