const mockStorage = new Map<string, string>();

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async (key: string) => {
      // Force both callers to cross an asynchronous boundary. Without a
      // serialized read/modify/write boundary this deterministically exposes
      // the lost-update shape (both read []).
      await Promise.resolve();
      return mockStorage.get(key) ?? null;
    }),
    setItem: jest.fn(async (key: string, value: string) => {
      await Promise.resolve();
      mockStorage.set(key, value);
    }),
  },
}));

import {
  isMarkerTombstoned,
  listMarkerTombstones,
  tombstoneMarker,
} from '../markerTombstones';

describe('Cairn resurrection tombstones', () => {
  beforeEach(() => mockStorage.clear());

  test('concurrent deletes retain every tombstone', async () => {
    await Promise.all([
      tombstoneMarker('account-a', 'cairn-one'),
      tombstoneMarker('account-a', 'cairn-two'),
      tombstoneMarker('account-a', 'cairn-three'),
    ]);

    expect(new Set(await listMarkerTombstones('account-a'))).toEqual(
      new Set(['cairn-one', 'cairn-two', 'cairn-three']),
    );
    await expect(isMarkerTombstoned('account-a', 'cairn-one')).resolves.toBe(true);
    await expect(isMarkerTombstoned('account-a', 'cairn-two')).resolves.toBe(true);
  });

  test('corrupt protection state fails closed instead of looking empty', async () => {
    mockStorage.set('@cairn:marker_tombstones:v1:account-a', '{not-json');
    await expect(isMarkerTombstoned('account-a', 'cairn-one')).rejects.toThrow();
    await expect(tombstoneMarker('account-a', 'cairn-two')).rejects.toThrow();
  });

  test('accounts remain independently scoped', async () => {
    await Promise.all([
      tombstoneMarker('account-a', 'cairn-a'),
      tombstoneMarker('account-b', 'cairn-b'),
    ]);
    await expect(listMarkerTombstones('account-a')).resolves.toEqual(['cairn-a']);
    await expect(listMarkerTombstones('account-b')).resolves.toEqual(['cairn-b']);
  });
});
