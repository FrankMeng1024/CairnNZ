const mockCountryCache = new Map<string, string>();
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async (key: string) => mockCountryCache.get(key) ?? null),
  setItem: jest.fn(async (key: string, value: string) => { mockCountryCache.set(key, value); }),
}));

import AsyncStorage from '@react-native-async-storage/async-storage';
import { normalizeCachedCountry, resolveCurrentCountry } from '../countryService';

describe('country cache presentation authority', () => {
  const base = {
    lat: 26.647,
    lng: 106.63,
    resolvedAt: 1_790_260_498_004,
  };

  beforeEach(() => {
    mockCountryCache.clear();
    jest.clearAllMocks();
  });

  test('legacy localized cache is converted before any early cache return', () => {
    expect(normalizeCachedCountry({
      ...base,
      countryName: '贵阳市',
      countryCode: 'cn',
    })).toEqual({
      ...base,
      countryName: 'China',
      countryCode: 'CN',
    });
  });

  test('an untranslatable localized cache is rejected rather than displayed', () => {
    expect(normalizeCachedCountry({
      ...base,
      countryName: '未知地点',
      countryCode: '',
    })).toBeNull();
  });

  test('English locality is retained and malformed coordinates fail closed', () => {
    expect(normalizeCachedCountry({
      ...base,
      countryName: 'Auckland',
      countryCode: 'nz',
    })?.countryName).toBe('Auckland');
    expect(normalizeCachedCountry({
      ...base,
      lat: 190,
      countryName: 'Auckland',
      countryCode: 'NZ',
    })).toBeNull();
  });

  test('the real cache return path rewrites a localized legacy value before returning it', async () => {
    const key = 'cairn.current_country.v3';
    mockCountryCache.set(key, JSON.stringify({
      ...base,
      resolvedAt: Date.now(),
      countryName: '贵阳市',
      countryCode: 'CN',
    }));
    const result = await resolveCurrentCountry();
    expect(result).toMatchObject({ countryName: 'China', countryCode: 'CN' });
    expect(AsyncStorage.setItem).toHaveBeenCalledWith(
      key,
      expect.stringContaining('"countryName":"China"'),
    );
  });
});
