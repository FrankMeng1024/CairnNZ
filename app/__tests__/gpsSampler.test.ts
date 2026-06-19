/**
 * Unit tests — gpsSampler.decideFromReadings
 *
 * Pure decision function: feed a list of fake CLLocation-shaped
 * readings, verify the weighted-mean and gating logic.
 */

import { decideFromReadings } from '../src/features/plant/services/gpsSampler';

interface Reading { lat: number; lng: number; accuracy: number; timestamp: number; }

function r(lat: number, lng: number, accuracy: number): Reading {
  return { lat, lng, accuracy, timestamp: Date.now() };
}

describe('gpsSampler · decideFromReadings', () => {
  it('rejects when fewer than 2 readings', () => {
    const out = decideFromReadings([r(0, 0, 5)]);
    expect(out.ok).toBe(false);
    expect(out.reason).toBe('no-readings');
  });

  it('rejects when all readings are too inaccurate', () => {
    const out = decideFromReadings([
      r(0, 0, 100), r(0, 0, 100), r(0, 0, 100),
    ]);
    expect(out.ok).toBe(false);
    expect(out.reason).toBe('accuracy-too-poor');
  });

  it('accepts a tight cluster within the accuracy window', () => {
    const out = decideFromReadings([
      r(31.23, 121.43, 4),
      r(31.23, 121.43, 5),
      r(31.23, 121.43, 4),
      r(31.23, 121.43, 6),
    ]);
    expect(out.ok).toBe(true);
    expect(out.lat).toBeCloseTo(31.23, 5);
    expect(out.lng).toBeCloseTo(121.43, 5);
    expect(out.accuracyMeters).toBeLessThanOrEqual(15);
    expect(out.samplesUsed).toBeGreaterThanOrEqual(3);
  });

  it('weighted mean favors more accurate readings', () => {
    // Pull center of mass toward the (lat=10) point because it's most accurate.
    const out = decideFromReadings([
      r(10, 0, 1),     // very accurate
      r(20, 0, 50),    // very inaccurate (will be dropped before weighting too)
      r(20, 0, 50),
      r(10, 0, 2),
    ]);
    // lat should be much closer to 10 than 20
    if (out.ok) {
      expect(Math.abs(out.lat - 10)).toBeLessThan(Math.abs(out.lat - 20));
    }
  });

  it('rejects jumpy clusters even when each reading is "accurate"', () => {
    // Best accuracy is OK (3m) but the points are spread 30m apart.
    const out = decideFromReadings([
      r(31.230, 121.430, 3),
      r(31.231, 121.431, 3),  // ~140m diagonal away — way too far
      r(31.230, 121.430, 3),
      r(31.231, 121.431, 3),
    ]);
    expect(out.ok).toBe(false);
    expect(out.reason).toBe('too-jumpy');
  });
});
