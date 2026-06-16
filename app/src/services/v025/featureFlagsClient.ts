/**
 * featureFlagsClient — v0.2.5 client-side feature flag accessor.
 *
 * Backend table: feature_flags(flag_key, flag_value).
 * Backend route: GET /api/feature-flags
 *
 * Default policy (Phase 0; will be re-evaluated at Phase 1A canary signoff):
 *   useV025 = 'false' as the FAIL-CLOSED hard default.
 *
 *   Reasoning (per round-2 review #0-4 CRITICAL):
 *     If the backend is unreachable at first launch (DNS / TLS / firewall / outage)
 *     and a user has never successfully cached a value, hard-defaulting to 'true'
 *     would silently force the entire userbase onto the unproven v025 path with
 *     no kill switch. Hard-defaulting to 'false' means: outage = users keep getting
 *     ARScreenLegacy. The backend default IS 'true' (set in 015b_feature_flags.sql),
 *     so the moment the boot fetch succeeds the flag flips to true and v025 is on.
 *     This is a one-way ratchet: cache persists in AsyncStorage, so subsequent
 *     boots remain on v025 even offline.
 *
 *   See ADR-008 for the full reasoning + acceptance criteria for flipping the
 *   hard default to 'true'.
 *
 * Strategy:
 *   - Boot-time fetch from /api/feature-flags (single GET, cached in AsyncStorage)
 *   - Stale-while-revalidate: return cached immediately, refresh in background
 *   - Offline fallback: last cached value
 *   - Hard default if never fetched: useV025 = false (fail-closed kill switch)
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'v025.featureFlags.cache';
const HARD_DEFAULTS: Record<string, string> = {
  useV025: 'false',
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
