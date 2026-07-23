/**
 * hierarchyService — v434 (2-layer tree: World → Country → City)
 *
 * Endpoints:
 *  - fetchDeepest(lat, lng): find the deepest region for a coord.
 *    Returns { city: {id, name_en, country_id, bbox} | null,
 *              country: {id, name_en, bbox} | null }.
 *  - fetchPanelData(titleId, hereCityId, hereCountryId): full panel data.
 *
 * Cache versions bumped to v3 (was v1/v2 in v427-v433) so old cached
 * shapes cannot be parsed.
 */

import { API_BASE_URL } from '../../../config/api';
import { getToken } from '../../../services/tokenStore';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { log } from '../../../services/appLog';

export interface CityHit {
  id: string;
  name_en: string;
  country_id: string;
  bbox: [number, number, number, number];
}

export interface CountryHit {
  id: string;
  name_en: string;
  bbox: [number, number, number, number];
}

export interface DeepestResponse {
  city: CityHit | null;
  country: CountryHit | null;
}

export interface PanelItem {
  id: string;
  name_en: string;
  state: 'marked' | 'walked';
  bbox: [number, number, number, number];
  is_here: boolean;
}

export interface PanelData {
  title: { id: string; name_en: string; level: 0 | 2 };
  parent: { id: string; name_en: string; level: 0 } | null;
  items: PanelItem[];
  locked_count: number;
}

const DEEPEST_CACHE_TTL_MS = 60 * 1000; // 60s (was 24h — was preventing panel from refreshing when user flew to a new city)
const PANEL_CACHE_TTL_MS = 30 * 1000; // 30s (short — user memory changes)
const DEEPEST_CACHE_VERSION = 'v4';
const PANEL_CACHE_VERSION = 'v4';

async function authedFetch(path: string): Promise<Response> {
  const token = await getToken();
  const url = `${API_BASE_URL}${path}`;
  const t0 = Date.now();
  log('v434.hierarchy.fetch_start', { path });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      signal: controller.signal,
    });
    clearTimeout(timer);
    log('v434.hierarchy.fetch_done', {
      path, status: res.status, ok: res.ok, dur_ms: Date.now() - t0,
    });
    return res;
  } catch (e: any) {
    clearTimeout(timer);
    log('v434.hierarchy.fetch_err', {
      path, err: String(e?.name || e?.message || 'unknown'), dur_ms: Date.now() - t0,
    });
    throw e;
  }
}

// -----------------------------------------------------------------------
// fetchDeepest
// -----------------------------------------------------------------------
export async function fetchDeepest(lat: number, lng: number): Promise<DeepestResponse> {
  const key = `hierarchy:deepest:${DEEPEST_CACHE_VERSION}:${lat.toFixed(2)},${lng.toFixed(2)}`;
  try {
    const cached = await AsyncStorage.getItem(key);
    if (cached) {
      const parsed = JSON.parse(cached);
      if (Date.now() - parsed.ts < DEEPEST_CACHE_TTL_MS) {
        return parsed.data;
      }
    }
  } catch { /* ignore cache errors */ }

  try {
    const res = await authedFetch(`/api/hierarchy/deepest?lat=${lat}&lng=${lng}`);
    if (!res.ok) return { city: null, country: null };
    const data = (await res.json()) as DeepestResponse;
    try {
      await AsyncStorage.setItem(key, JSON.stringify({ ts: Date.now(), data }));
    } catch { /* ignore */ }
    return data;
  } catch (e: any) {
    log('v434.hierarchy.deepest_err', { err: String(e?.name || e?.message || 'unknown'), lat, lng });
    return { city: null, country: null };
  }
}

// -----------------------------------------------------------------------
// fetchPanelData
// -----------------------------------------------------------------------
export async function fetchPanelData(
  titleId: string,
  hereCityId: string | null,
  hereCountryId: string | null,
): Promise<PanelData | null> {
  const cacheKey = `hierarchy:panel:${PANEL_CACHE_VERSION}:${titleId}:${hereCityId ?? '_'}:${hereCountryId ?? '_'}`;
  try {
    const cached = await AsyncStorage.getItem(cacheKey);
    if (cached) {
      const parsed = JSON.parse(cached);
      if (Date.now() - parsed.ts < PANEL_CACHE_TTL_MS) {
        return parsed.data;
      }
    }
  } catch { /* ignore */ }

  try {
    const parts = [`title_id=${encodeURIComponent(titleId)}`];
    if (hereCityId) parts.push(`here_city_id=${encodeURIComponent(hereCityId)}`);
    if (hereCountryId) parts.push(`here_country_id=${encodeURIComponent(hereCountryId)}`);
    const res = await authedFetch(`/api/hierarchy/panel?${parts.join('&')}`);
    if (!res.ok) {
      log('v434.hierarchy.panel_nok', { titleId, status: res.status });
      return null;
    }
    const data = (await res.json()) as PanelData;
    log('v434.hierarchy.panel_ok', {
      titleId, items: data.items?.length ?? 0, locked: data.locked_count,
    });
    try {
      await AsyncStorage.setItem(cacheKey, JSON.stringify({ ts: Date.now(), data }));
    } catch { /* ignore */ }
    return data;
  } catch (e: any) {
    log('v434.hierarchy.panel_throw', { titleId, err: String(e?.name || e?.message || 'unknown') });
    return null;
  }
}

/** Invalidate all panel cache (call after memory point / marker changes) */
export async function invalidatePanelCache(): Promise<void> {
  try {
    const keys = await AsyncStorage.getAllKeys();
    const panelKeys = keys.filter((k) => k.startsWith('hierarchy:panel:'));
    if (panelKeys.length > 0) await AsyncStorage.multiRemove(panelKeys);
  } catch { /* ignore */ }
}
