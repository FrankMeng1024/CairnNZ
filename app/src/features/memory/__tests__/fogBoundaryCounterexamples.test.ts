import booleanPointInPolygon from '@turf/boolean-point-in-polygon';
import booleanValid from '@turf/boolean-valid';
import { destination as turfDestination, point as turfPoint } from '@turf/turf';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
jest.mock('../store/useFriendMemoryStore', () => ({
  useFriendMemoryStore: Object.assign(jest.fn(), {
    getState: jest.fn(() => ({ getVisibleCells: () => [] })),
  }),
}));
jest.mock('../store/useH3VisitedStore', () => ({
  useH3VisitedStore: { getState: () => ({ addPointToCells: jest.fn(), clear: jest.fn(), bulkImport: jest.fn() }) },
}));
jest.mock('../services/lastFixCache', () => ({ persistLastFix: jest.fn() }));

import {
  buildTiledCombinedDisplayEvidence,
  buildTiledMemoryDisplayEvidence,
  composeFogShape,
  restoreDisplayGeometryCache,
} from '../components/FogLayer';

const emptySelfCache = () => restoreDisplayGeometryCache([]);

describe('Fog exact boundary counterexamples', () => {
  test('A4/FRIEND-RECT-01 rejects a closed three-corner ring instead of revealing its bbox', async () => {
    const triangle: Array<[number, number]> = [
      [0, 0], [0.0008, 0], [0, 0.0008], [0, 0],
    ];
    const combined = await buildTiledCombinedDisplayEvidence(emptySelfCache(), [triangle], () => true);

    expect(combined?.rejectedFriendCellCount).toBe(1);
    expect(combined?.evidence).toBeNull();
    if (combined?.evidence) {
      expect(booleanPointInPolygon(turfPoint([0.0007, 0.0007]), combined.evidence)).toBe(false);
    }
  });

  test('A4/ANTIMERIDIAN-01 retains both supported sides of a footprint crossing +180', async () => {
    // Keep the cardinal probes away from a half-open latitude tile seam so
    // this case isolates longitude wrapping rather than the intentional gap.
    const source = { lat: 0.0004, lng: 179.99995 };
    const built = await buildTiledMemoryDisplayEvidence([source], () => true);
    expect(built?.evidence).not.toBeNull();
    if (!built?.evidence) throw new Error('wrapped footprint unavailable');

    const eastUnwrapped = turfDestination(turfPoint([source.lng, source.lat]), 20, 90, { units: 'meters' });
    const eastAcrossDateline = turfPoint([
      ((eastUnwrapped.geometry.coordinates[0] + 180) % 360 + 360) % 360 - 180,
      eastUnwrapped.geometry.coordinates[1],
    ]);
    const westSameSide = turfDestination(turfPoint([source.lng, source.lat]), 20, 270, { units: 'meters' });
    expect(eastAcrossDateline.geometry.coordinates[0]).toBeLessThan(0);
    expect(booleanPointInPolygon(eastAcrossDateline, built.evidence)).toBe(true);
    expect(booleanPointInPolygon(westSameSide, built.evidence)).toBe(true);
    const fog = composeFogShape(built.evidence);
    expect(fog).not.toBeNull();
    expect(booleanValid(fog!)).toBe(true);
    expect(booleanPointInPolygon(eastAcrossDateline, fog!)).toBe(false);
    expect(booleanPointInPolygon(westSameSide, fog!)).toBe(false);
  });

  test('A4/ANTIMERIDIAN-02 retains both supported sides of a footprint crossing -180', async () => {
    const source = { lat: 0.0004, lng: -179.99995 };
    const built = await buildTiledMemoryDisplayEvidence([source], () => true);
    expect(built?.evidence).not.toBeNull();
    if (!built?.evidence) throw new Error('wrapped footprint unavailable');

    const westUnwrapped = turfDestination(turfPoint([source.lng, source.lat]), 20, 270, { units: 'meters' });
    const westAcrossDateline = turfPoint([
      ((westUnwrapped.geometry.coordinates[0] + 180) % 360 + 360) % 360 - 180,
      westUnwrapped.geometry.coordinates[1],
    ]);
    const eastSameSide = turfDestination(turfPoint([source.lng, source.lat]), 20, 90, { units: 'meters' });
    expect(westAcrossDateline.geometry.coordinates[0]).toBeGreaterThan(0);
    expect(booleanPointInPolygon(westAcrossDateline, built.evidence)).toBe(true);
    expect(booleanPointInPolygon(eastSameSide, built.evidence)).toBe(true);
    const fog = composeFogShape(built.evidence);
    expect(fog).not.toBeNull();
    expect(booleanValid(fog!)).toBe(true);
    expect(booleanPointInPolygon(westAcrossDateline, fog!)).toBe(false);
    expect(booleanPointInPolygon(eastSameSide, fog!)).toBe(false);
  });

  test('A4/TILE-MAX-01 accepts an exact 8x8 half-open rectangle at the 64-tile cap', async () => {
    const exact64: Array<[number, number]> = [
      [0, 0], [0.008, 0], [0.008, 0.008], [0, 0.008], [0, 0],
    ];
    const combined = await buildTiledCombinedDisplayEvidence(emptySelfCache(), [exact64], () => true);

    expect(combined?.rejectedFriendCellCount).toBe(0);
    expect(combined?.evidence).not.toBeNull();
  });

  test('A4/FRIEND-ORDER-01 combined tile ordering does not invoke locale collation', async () => {
    const ring: Array<[number, number]> = [
      [-0.0015, -0.0015], [0.0015, -0.0015], [0.0015, 0.0015],
      [-0.0015, 0.0015], [-0.0015, -0.0015],
    ];
    const localeCompare = jest.spyOn(String.prototype, 'localeCompare')
      .mockImplementation(() => { throw new Error('locale collation invoked'); });
    try {
      await expect(buildTiledCombinedDisplayEvidence(emptySelfCache(), [ring], () => true))
        .resolves.toMatchObject({ rejectedFriendCellCount: 0 });
    } finally {
      localeCompare.mockRestore();
    }
  });
});
