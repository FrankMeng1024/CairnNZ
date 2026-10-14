import { resolveCachedMemoryCenter, resolveCurrentLocationViewport, resolveMemoryEntryCameraAuthority, resolveMemoryInitialMapCenter } from '../services/memoryEntryCameraPolicy';

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

  test('paints cached account Memory while locating without treating it as current', () => {
    expect(resolveMemoryInitialMapCenter({
      authority: 'wait-for-location',
      current: null,
      manualCenter: [116.4074, 39.9042],
      cachedMemoryCenter: { lat: 31.22, lng: 121.46, ts: 20 },
    })).toEqual({ lat: 31.22, lng: 121.46, ts: 20 });
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

  test('chooses the newest cached personal evidence without combining cities', () => {
    expect(resolveCachedMemoryCenter([
      { lat: 39.9042, lng: 116.4074, ts: 10 },
      { lat: 31.2200, lng: 121.4600, ts: 30 },
      { lat: 31.2450, lng: 121.4900, ts: 20 },
    ])).toEqual({ lat: 31.2200, lng: 121.4600, ts: 30 });
  });

  test('entry and Recenter target the live dot rather than a history bounding box', () => {
    expect(resolveCurrentLocationViewport({ lat: 31.2304, lng: 121.4737 }))
      .toEqual({ center: [121.4737, 31.2304], zoom: 16.5, usedOwnEvidence: false });
  });
});
