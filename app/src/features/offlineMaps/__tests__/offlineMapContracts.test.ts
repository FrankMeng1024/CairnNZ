import {
  OFFLINE_MAP_MAX_ZOOM,
  OFFLINE_MAP_MIN_ZOOM,
  OFFLINE_MAP_PACK_PREFIX,
  formatOfflineMapBytes,
  isCairnOfflineMapPack,
  makeOfflineMapPackName,
  offlineMapBoundaryFeature,
  offlineMapBounds,
  offlineMapsFeatureEnabled,
  validateOfflineMapDraft,
} from '../offlineMapContracts';

describe('offline map contracts', () => {
  test('feature is default-off and requires an explicit true value', () => {
    expect(offlineMapsFeatureEnabled(undefined)).toBe(false);
    expect(offlineMapsFeatureEnabled('false')).toBe(false);
    expect(offlineMapsFeatureEnabled(' TRUE ')).toBe(true);
  });

  test('bounds remain ordered and bounded near the antimeridian and poles', () => {
    const bounds = offlineMapBounds({ center: { lat: 84.99, lng: 179.99 }, radiusKm: 10 });
    expect(bounds.northEast[0]).toBeLessThanOrEqual(180);
    expect(bounds.northEast[1]).toBeLessThanOrEqual(85);
    expect(bounds.southWest[0]).toBeLessThan(bounds.northEast[0]);
    expect(bounds.southWest[1]).toBeLessThan(bounds.northEast[1]);
  });

  test('rejects broad or malformed regions before native work starts', () => {
    expect(() => validateOfflineMapDraft({ center: { lat: 0, lng: 0 }, radiusKm: 11 })).toThrow('Coverage radius');
    expect(() => validateOfflineMapDraft({ center: { lat: Number.NaN, lng: 0 }, radiusKm: 5 })).toThrow('Latitude');
    expect(() => validateOfflineMapDraft({ center: { lat: 0, lng: 0 }, radiusKm: 5, minZoom: 16, maxZoom: 15 })).toThrow('Maximum zoom');
  });

  test('uses a closed rectangular polygon and fixed safe zoom defaults', () => {
    const draft = validateOfflineMapDraft({ center: { lat: -41.2865, lng: 174.7762 }, radiusKm: 5 });
    expect(draft.minZoom).toBe(OFFLINE_MAP_MIN_ZOOM);
    expect(draft.maxZoom).toBe(OFFLINE_MAP_MAX_ZOOM);
    const ring = offlineMapBoundaryFeature(draft).geometry.coordinates[0];
    expect(ring).toHaveLength(5);
    expect(ring[0]).toEqual(ring[4]);
  });

  test('owns only versioned Cairn packs and never fabricates an estimate', () => {
    const name = makeOfflineMapPackName(123456);
    expect(name.startsWith(OFFLINE_MAP_PACK_PREFIX)).toBe(true);
    expect(isCairnOfflineMapPack(name)).toBe(true);
    expect(isCairnOfflineMapPack('another-app-pack')).toBe(false);
    expect(formatOfflineMapBytes(null)).toBe('Size unavailable');
    expect(formatOfflineMapBytes(1_048_576)).toBe('1.0 MB');
  });
});
