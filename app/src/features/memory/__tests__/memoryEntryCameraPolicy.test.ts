import { resolveCurrentCityViewport, resolveMemoryEntryCameraAuthority, resolveMemoryInitialMapCenter } from '../services/memoryEntryCameraPolicy';

const shanghai: [number, number, number, number] = [120.85, 30.67, 122.2, 31.88];

describe('Memory current-city-first camera policy', () => {
  test('fresh current-city evidence outranks a cached historical city', () => {
    expect(resolveMemoryEntryCameraAuthority({
      hasFreshCurrentEvidence: true,
      locationAttemptFailed: false,
      hasManualCity: true,
      manualBrowseThisMount: false,
    })).toBe('current');
  });

  test('waits for delayed GPS and restores a manual city only after location failure', () => {
    expect(resolveMemoryEntryCameraAuthority({
      hasFreshCurrentEvidence: false,
      locationAttemptFailed: false,
      hasManualCity: true,
      manualBrowseThisMount: false,
    })).toBe('wait-for-location');
    expect(resolveMemoryEntryCameraAuthority({
      hasFreshCurrentEvidence: false,
      locationAttemptFailed: true,
      hasManualCity: true,
      manualBrowseThisMount: false,
    })).toBe('manual-fallback');
  });

  test('never mounts current entry from stale history while fresh location is unresolved', () => {
    expect(resolveMemoryInitialMapCenter({
      authority: 'wait-for-location',
      current: null,
      manualCenter: [116.4074, 39.9042],
    })).toBeNull();
    expect(resolveMemoryInitialMapCenter({
      authority: 'current',
      current: { lat: 31.2304, lng: 121.4737 },
      manualCenter: [116.4074, 39.9042],
    })).toEqual({ lat: 31.2304, lng: 121.4737 });
    expect(resolveMemoryInitialMapCenter({
      authority: 'manual-fallback',
      current: null,
      manualCenter: [116.4074, 39.9042],
    })).toEqual({ lat: 39.9042, lng: 116.4074 });
  });

  test('does not interrupt intentional manual city browsing on the current mount', () => {
    expect(resolveMemoryEntryCameraAuthority({
      hasFreshCurrentEvidence: true,
      locationAttemptFailed: false,
      hasManualCity: true,
      manualBrowseThisMount: true,
    })).toBe('preserve-manual-browse');
  });

  test('frames own current-city Fog and excludes historical evidence in another city', () => {
    const result = resolveCurrentCityViewport(
      { lat: 31.2304, lng: 121.4737 },
      shanghai,
      [
        { lat: 31.2200, lng: 121.4600 },
        { lat: 31.2450, lng: 121.4900 },
        { lat: 39.9042, lng: 116.4074 },
      ],
    );
    expect(result.usedOwnEvidence).toBe(true);
    expect(result.center[0]).toBeGreaterThan(121.45);
    expect(result.center[0]).toBeLessThan(121.50);
    expect(result.center[1]).toBeGreaterThan(31.21);
    expect(result.center[1]).toBeLessThan(31.25);
  });

  test('uses actual current location when current city has no personal Fog', () => {
    expect(resolveCurrentCityViewport(
      { lat: 31.2304, lng: 121.4737 },
      shanghai,
      [{ lat: 39.9042, lng: 116.4074 }],
    )).toEqual({ center: [121.4737, 31.2304], zoom: 14, usedOwnEvidence: false });
  });

  test('has a location-first fallback when city resolution is delayed or unavailable', () => {
    expect(resolveCurrentCityViewport(
      { lat: 31.2304, lng: 121.4737 },
      null,
      [{ lat: 39.9042, lng: 116.4074 }],
    )).toEqual({ center: [121.4737, 31.2304], zoom: 14, usedOwnEvidence: false });
  });
});
