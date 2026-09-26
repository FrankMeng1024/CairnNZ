/**
 * countryService — resolve user's current country from GPS.
 *
 * R114/O26 (2026-08-14): first pass at Home hero exploration badge.
 * Displays "You've explored X km² of {country}" where {country} is the
 * best-effort ISO 3166 country name derived from the user's last known
 * position.
 *
 * Strategy (fastest → most-degraded fallback):
 *   1. AsyncStorage cache — if we resolved within the last 24h and the
 *      cached position is < 50 km from current, reuse the cached country
 *      name. Zero network / zero GPS-permission cost.
 *   2. expo-location reverseGeocodeAsync — free, works offline (uses
 *      device geocoder), needs foreground location permission.
 *   3. If permission denied AND cache empty: return null. Caller shows
 *      a permission-agnostic copy ("Your world is waiting").
 *
 * Not a stream — resolved once per Home render; cache serves subsequent
 * mounts. Never blocks Home paint.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

// R21 v2 (2026-08-17): bumped key to v2 because we changed the semantic
// of countryName from country-level ("China", "New Zealand") to city-level
// ("Guiyang", "Auckland"). Old v1 cache holds country-only strings; using
// a new key makes every existing device re-resolve fresh on first load.
const CACHE_KEY = 'cairn.current_country.v3';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 h
const CACHE_DISTANCE_M = 50_000;           // 50 km → same country

export type CountryCache = {
  /** Display name — prefers city, falls back to region, then country. */
  countryName: string;                     // e.g. "Auckland" or "Guizhou" or "New Zealand"
  countryCode: string;                     // e.g. "NZ" (ISO 3166 alpha-2, best-effort)
  lat: number;
  lng: number;
  resolvedAt: number;                      // epoch ms
};

/** Haversine, meters. Small implementation to keep this file self-contained. */
function distanceM(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

async function readCache(): Promise<unknown | null> {
  try {
    const raw = await AsyncStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

async function writeCache(c: CountryCache): Promise<void> {
  try {
    await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(c));
  } catch { /* silent */ }
}

function englishRegionName(countryCode: string): string {
  const code = String(countryCode || '').toUpperCase();
  if (!/^[A-Z]{2}$/.test(code)) return '';
  try {
    return new Intl.DisplayNames(['en'], { type: 'region' }).of(code) ?? '';
  } catch {
    const fallback: Record<string, string> = {
      NZ: 'New Zealand', AU: 'Australia', US: 'United States', CA: 'Canada',
      GB: 'United Kingdom', CN: 'China', JP: 'Japan', DE: 'Germany',
      FR: 'France', IN: 'India', BR: 'Brazil', ZA: 'South Africa',
    };
    return fallback[code] ?? '';
  }
}

function englishOnlyName(name: string, countryCode: string): string {
  const normalized = String(name || '').trim();
  return normalized && !/[^\u0000-\u007F]/.test(normalized)
    ? normalized
    : englishRegionName(countryCode);
}

/**
 * Treat persisted reverse-geocoder output as untrusted input. Older builds
 * wrote the device-localized locality directly, so every cache return path
 * must pass through the same English-only boundary as a fresh lookup.
 */
export function normalizeCachedCountry(value: unknown): CountryCache | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<CountryCache>;
  const countryCode = String(candidate.countryCode ?? '').trim().toUpperCase();
  const countryName = englishOnlyName(String(candidate.countryName ?? ''), countryCode);
  const lat = Number(candidate.lat);
  const lng = Number(candidate.lng);
  const resolvedAt = Number(candidate.resolvedAt);
  if (!countryName
    || !Number.isFinite(lat) || lat < -90 || lat > 90
    || !Number.isFinite(lng) || lng < -180 || lng > 180
    || !Number.isFinite(resolvedAt) || resolvedAt <= 0) return null;
  return { countryName, countryCode, lat, lng, resolvedAt };
}

/**
 * Resolve current country. Returns null if we have neither a fresh cache
 * nor GPS permission. Never throws.
 */
export async function resolveCurrentCountry(): Promise<CountryCache | null> {
  // Fastest path: fresh cache
  const cachedRaw = await readCache();
  const cached = normalizeCachedCountry(cachedRaw);
  if (cached && JSON.stringify(cachedRaw) !== JSON.stringify(cached)) {
    // Rewrite legacy locale-specific cache entries before any early return.
    await writeCache(cached);
  }
  const now = Date.now();
  if (cached && (now - cached.resolvedAt) < CACHE_TTL_MS) {
    // Attempt fresh coords to verify user hasn't crossed a border.
    try {
      const Location = await import('expo-location');
      const perm = await Location.getForegroundPermissionsAsync();
      if (perm.status !== 'granted') return cached; // no perm — reuse cache
      const pos = await Location.getLastKnownPositionAsync();
      if (!pos) return cached;
      const d = distanceM(cached, { lat: pos.coords.latitude, lng: pos.coords.longitude });
      if (d < CACHE_DISTANCE_M) return cached; // still within the cached country
      // else fall through and re-resolve
    } catch {
      return cached; // module missing / any error → trust cache
    }
  }

  // Fresh resolve via expo-location
  try {
    const Location = await import('expo-location');
    const perm = await Location.getForegroundPermissionsAsync();
    if (perm.status !== 'granted') return cached; // may be null
    // getCurrentPositionAsync is slow — start with last-known first.
    const pos = await Location.getLastKnownPositionAsync()
      ?? await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
    if (!pos) return cached;

    // R21 (2026-08-17): reverse geocode. Native uses expo-location (works
    // on iOS/Android), web falls back to open-meteo's free geocoding API
    // because expo-location.reverseGeocodeAsync is removed on web since
    // SDK 49 (Google Geocoding API deprecated).
    let displayName = '';
    let countryCode = cached?.countryCode ?? '';
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { Platform } = require('react-native');
      if (Platform.OS !== 'web') {
        const [place] = await Location.reverseGeocodeAsync({
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
        });
        displayName = place?.city ?? place?.subregion ?? place?.region ?? place?.country ?? '';
        countryCode = (place?.isoCountryCode ?? countryCode).toUpperCase();
        // R21 fix (2026-08-17 user "出现了中文 系统必须纯英语"): expo-location
        // reverseGeocodeAsync returns locale-specific names on device (Chinese
        // device → Chinese city names). Detect non-ASCII and fall back to
        // BigDataCloud with localityLanguage=en for a guaranteed English name.
        const isNonAscii = /[^\u0000-\u007F]/.test(displayName);
        if (isNonAscii || !displayName) {
          try {
            const url = `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${pos.coords.latitude.toFixed(4)}&longitude=${pos.coords.longitude.toFixed(4)}&localityLanguage=en`;
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 4000);
            const res = await fetch(url, { signal: controller.signal });
            clearTimeout(timeout);
            if (res.ok) {
              const j = await res.json();
              const eng = j.city ?? j.locality ?? j.principalSubdivision ?? j.countryName ?? '';
              if (eng) displayName = eng;
              if (j.countryCode) countryCode = (j.countryCode as string).toUpperCase();
            }
          } catch { /* silent — keep expo-location result */ }
        }
      } else {
        // R21 (2026-08-17 fix): web fallback uses BigDataCloud free reverse
        // geocoding. Tested from user's location (Guiyang, China) and works
        // without an API key. Nominatim was tried but blocked from
        // corporate network; Open-Meteo doesn't support reverse (only
        // forward geocoding).
        const url = `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${pos.coords.latitude.toFixed(4)}&longitude=${pos.coords.longitude.toFixed(4)}&localityLanguage=en`;
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 4000);
        const res = await fetch(url, { signal: controller.signal });
        clearTimeout(timeout);
        if (res.ok) {
          const j = await res.json();
          // Prefer city (Guiyang, Auckland), fall back to locality
          // (district), then principalSubdivision (state/province), then
          // country as final fallback.
          displayName =
            j.city ?? j.locality ?? j.principalSubdivision ?? j.countryName ?? '';
          countryCode = (j.countryCode ?? countryCode).toUpperCase();
        }
      }
    } catch { /* silent — displayName stays empty, will fall through to cache */ }

    displayName = englishOnlyName(displayName, countryCode);
    if (!displayName) {
      displayName = cached?.countryName ?? '';
    }
    displayName = englishOnlyName(displayName, countryCode || cached?.countryCode || '');
    if (!displayName) return cached;

    const next: CountryCache = {
      countryName: displayName,
      countryCode,
      lat: pos.coords.latitude,
      lng: pos.coords.longitude,
      resolvedAt: now,
    };
    await writeCache(next);
    return next;
  } catch {
    return cached;
  }
}
