import { qualifiedLocationPoint } from '../locationFixPolicy';

describe('qualifiedLocationPoint', () => {
  const now = 2_000_000;

  test('accepts a recent accurate device fix', () => {
    expect(qualifiedLocationPoint({
      coords: { latitude: 31.2304, longitude: 121.4737, accuracy: 18 },
      timestamp: now - 4_000,
    }, { now, maxAgeMs: 120_000, maxAccuracyM: 100 })).toEqual({ lat: 31.2304, lng: 121.4737 });
  });

  test('rejects stale, inaccurate and invalid fixes', () => {
    expect(qualifiedLocationPoint({
      coords: { latitude: 39.9, longitude: 116.4, accuracy: 20 },
      timestamp: now - 120_001,
    }, { now, maxAgeMs: 120_000, maxAccuracyM: 100 })).toBeNull();
    expect(qualifiedLocationPoint({
      coords: { latitude: 31.2, longitude: 121.4, accuracy: 101 },
      timestamp: now,
    }, { now, maxAgeMs: 120_000, maxAccuracyM: 100 })).toBeNull();
    expect(qualifiedLocationPoint({
      coords: { latitude: 91, longitude: 121.4, accuracy: 10 },
      timestamp: now,
    }, { now, maxAgeMs: 120_000, maxAccuracyM: 100 })).toBeNull();
  });
});
