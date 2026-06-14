/**
 * R2.3 origin stale + GPS lock decision test.
 *
 * 真 import services/originPropagation (ARScreen.tsx 也调同函数)。
 * 反 self-licking — 反向 mutate helper 应让 jest 真 FAIL。
 */

import {
  distanceMeters,
  isOriginStale,
  decideGpsLock,
  ORIGIN_STALE_DISTANCE_M,
  GPS_HIGH_ACC_M,
  GPS_MAX_ACC_M,
} from '../src/services/originPropagation';

describe('R2.3 distanceMeters', () => {
  it('same point = 0m', () => {
    expect(distanceMeters({ lat: 30.0, lng: 120.0 }, { lat: 30.0, lng: 120.0 })).toBeCloseTo(0, 2);
  });

  it('1° lat diff ≈ 111km', () => {
    const d = distanceMeters({ lat: 30.0, lng: 120.0 }, { lat: 31.0, lng: 120.0 });
    expect(d).toBeCloseTo(111000, -2);
  });

  it('GPS-scale (~5m) walks at lat=30°', () => {
    // 0.000045° lat ≈ 5m
    const d = distanceMeters({ lat: 30.0, lng: 120.0 }, { lat: 30.000045, lng: 120.0 });
    expect(d).toBeCloseTo(5, 0);
  });
});

describe('R2.3 isOriginStale (50m threshold)', () => {
  const origin = { lat: 30.0, lng: 120.0 };

  it('within 30m: not stale', () => {
    // 0.000270° lat ≈ 30m
    expect(isOriginStale(origin, { lat: 30.000270, lng: 120.0 })).toBe(false);
  });

  it('exactly 50m boundary: not stale (>=50 not >50)', () => {
    // 0.000450° lat ≈ 50m exactly
    const d = distanceMeters(origin, { lat: 30.000450, lng: 120.0 });
    expect(d).toBeCloseTo(50, 0);
    // The function uses `> 50`, so 50.0 returns false
    expect(isOriginStale(origin, { lat: 30.000450, lng: 120.0 })).toBe(false);
  });

  it('beyond 50m: stale', () => {
    // 0.000550° lat ≈ 61m
    expect(isOriginStale(origin, { lat: 30.000550, lng: 120.0 })).toBe(true);
  });

  it('custom threshold respected', () => {
    expect(isOriginStale(origin, { lat: 30.000270, lng: 120.0 }, 20)).toBe(true);  // 30m > 20
  });

  it('ORIGIN_STALE_DISTANCE_M is 50', () => {
    expect(ORIGIN_STALE_DISTANCE_M).toBe(50);
  });
});

describe('R2.3 decideGpsLock (GPS accuracy gate)', () => {
  it('acc=5 → lock high-accuracy', () => {
    const d = decideGpsLock(5);
    expect(d.action).toBe('lock');
    expect((d as any).lowAccuracy).toBe(false);
  });

  it('acc=10 (boundary) → lock high-accuracy (>10 not >=10)', () => {
    const d = decideGpsLock(10);
    expect(d.action).toBe('lock');
    expect((d as any).lowAccuracy).toBe(false);
  });

  it('acc=15 → lock low-accuracy', () => {
    const d = decideGpsLock(15);
    expect(d.action).toBe('lock');
    expect((d as any).lowAccuracy).toBe(true);
  });

  it('acc=25 (boundary) → lock low-accuracy', () => {
    const d = decideGpsLock(25);
    expect(d.action).toBe('lock');
    expect((d as any).lowAccuracy).toBe(true);
  });

  it('acc=26 → reject', () => {
    const d = decideGpsLock(26);
    expect(d.action).toBe('reject');
    expect((d as any).reason).toBe('too-noisy');
  });

  it('acc=null → reject (treated as 999)', () => {
    const d = decideGpsLock(null);
    expect(d.action).toBe('reject');
  });

  it('acc=undefined → reject', () => {
    const d = decideGpsLock(undefined);
    expect(d.action).toBe('reject');
  });

  it('threshold constants', () => {
    expect(GPS_HIGH_ACC_M).toBe(10);
    expect(GPS_MAX_ACC_M).toBe(25);
  });
});
