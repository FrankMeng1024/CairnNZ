/**
 * featureFlagsClient — v0.2.5 client-side feature flag accessor.
 *
 * Backend table: feature_flags(flag_key, flag_value).
 * Phase 0.15 default: useV025 = true.
 *
 * Strategy:
 *   - Boot-time fetch from /api/feature-flags (single GET, cached in AsyncStorage)
 *   - Stale-while-revalidate: return cached immediately, refresh in background
 *   - Offline fallback: last cached value
 *   - Hard default if never fetched: useV025 = true (matches backend default)
 *
 * This is intentionally minimal — Phase 3 telemetry will report which flag values were active.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'v025.featureFlags.cache';
const HARD_DEFAULTS: Record<string, string> = {
  useV025: 'true',
};

let cache: Record<string, string> | null = null;

export async function loadFlagsCache(): Promise<Record<string, string>> {
  if (cache) return cache;
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (raw) {
      cache = JSON.parse(raw);
      return cache!;
    }
  } catch (err) {
    // AsyncStorage unavailable; fall through to defaults
  }
  cache = { ...HARD_DEFAULTS };
  return cache;
}

export async function refreshFlagsFromBackend(baseUrl: string): Promise<Record<string, string>> {
  const url = `${baseUrl.replace(/\/+$/, '')}/api/feature-flags`;
  try {
    const r = await fetch(url, { method: 'GET' });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const body = await r.json();
    if (body && typeof body === 'object' && body.flags) {
      cache = { ...HARD_DEFAULTS, ...body.flags };
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(cache));
      return cache;
    }
  } catch (err) {
    // Network or parse error — keep cached value
  }
  return cache ?? { ...HARD_DEFAULTS };
}

export function isFlagEnabled(key: string): boolean {
  const v = (cache ?? HARD_DEFAULTS)[key];
  return v === 'true' || v === '1';
}

export function getFlagValue(key: string, fallback = ''): string {
  return (cache ?? HARD_DEFAULTS)[key] ?? fallback;
}

/**
 * Synchronous convenience for hooks: assumes loadFlagsCache() ran during app boot.
 * If it didn't, returns hard defaults.
 */
export function useV025Enabled(): boolean {
  return isFlagEnabled('useV025');
}
