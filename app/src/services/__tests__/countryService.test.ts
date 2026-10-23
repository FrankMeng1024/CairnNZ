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

  test('a localized or country-only cache is rejected rather than mislabeled as a city', () => {
    expect(normalizeCachedCountry({
      ...base,
      countryName: '贵阳市',
      countryCode: 'cn',
    })).toBeNull();
    expect(normalizeCachedCountry({
      ...base,
      countryName: 'China',
      countryCode: 'CN',
    })).toBeNull();
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

  test('the real cache return path does not present a country as the current city', async () => {
    const key = 'cairn.current_city.v1';
    mockCountryCache.set(key, JSON.stringify({
      ...base,
      resolvedAt: Date.now(),
      countryName: '贵阳市',
      countryCode: 'CN',
    }));
    const result = await resolveCurrentCountry();
    expect(result).toBeNull();
    expect(AsyncStorage.setItem).not.toHaveBeenCalled();
  });
});
