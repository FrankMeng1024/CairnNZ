/**
 * hierarchyService — v427 client-side interface to /api/hierarchy
 *
 * Responsibilities:
 *  - fetchDeepestRegion(lat, lng): find deepest region for a coord
 *  - fetchPanelData(regionId): full panel data with siblings + counts
 *  - Per-request AsyncStorage cache with TTL to reduce redundant calls
 *
 * The regions table is static (~500 rows total). Server-side counts depend on
 * memoryPoints and change frequently, so we DON'T cache panel data long
 * (60s TTL). Deepest lookups are pure geo → 24h TTL.
 */

import { API_BASE_URL } from '../../../config/api';
import { getToken } from '../../../services/tokenStore';
import AsyncStorage from '@react-native-async-storage/async-storage';

export type RegionLevel = 0 | 1 | 2 | 3 | 4; // world | continent | country | province | district

export interface Region {
  id: string;
  parent_id: string | null;
  name_en: string;
  level: RegionLevel;
  bbox: [number, number, number, number]; // [minLng, minLat, maxLng, maxLat]
}

export interface SiblingRow {
  id: string;
  name_en: string;
  level: RegionLevel;
  bbox: [number, number, number, number];
  is_here: boolean;
  state: 'explored' | 'locked';
  point_count: number;
}

export interface PanelData {
  current: Region;
  parent: { id: string; name_en: string; level: RegionLevel } | null;
  explored_here: boolean;
  here_point_count: number;
  siblings: SiblingRow[];
  explored_count: number;
  locked_count: number;
}

const DEEPEST_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h
const PANEL_CACHE_TTL_MS = 60 * 1000; // 60s

async function authedFetch(path: string): Promise<Response> {
  const token = await getToken();
  return fetch(`${API_BASE_URL}${path}`, {
    method: 'GET',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
}

// ─────────────────────────────────────────────────────────────────────────
// Deepest region lookup (used to init "you are here")
// ─────────────────────────────────────────────────────────────────────────
export async function fetchDeepestRegion(lat: number, lng: number): Promise<Region | null> {
  // Round to 2 decimals for cache key stability
  const key = `hierarchy:deepest:${lat.toFixed(2)},${lng.toFixed(2)}`;
  try {
    const cached = await AsyncStorage.getItem(key);
    if (cached) {
      const parsed = JSON.parse(cached);
      if (Date.now() - parsed.ts < DEEPEST_CACHE_TTL_MS) {
        return parsed.region;
      }
    }
  } catch { /* ignore cache errors */ }

  try {
    const res = await authedFetch(`/api/hierarchy/deepest?lat=${lat}&lng=${lng}`);
    if (!res.ok) return null;
    const data = await res.json();
    const region = data.region as Region | undefined;
    if (region) {
      try {
        await AsyncStorage.setItem(key, JSON.stringify({ ts: Date.now(), region }));
      } catch { /* ignore */ }
    }
    return region ?? null;
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Panel data (siblings + counts)
// ─────────────────────────────────────────────────────────────────────────
export async function fetchPanelData(regionId: string): Promise<PanelData | null> {
  const key = `hierarchy:panel:${regionId}`;
  try {
    const cached = await AsyncStorage.getItem(key);
    if (cached) {
      const parsed = JSON.parse(cached);
      if (Date.now() - parsed.ts < PANEL_CACHE_TTL_MS) {
        return parsed.data;
      }
    }
  } catch { /* ignore */ }

  try {
    const res = await authedFetch(`/api/hierarchy/panel?region_id=${encodeURIComponent(regionId)}`);
    if (!res.ok) return null;
    const data = (await res.json()) as PanelData;
    try {
      await AsyncStorage.setItem(key, JSON.stringify({ ts: Date.now(), data }));
    } catch { /* ignore */ }
    return data;
  } catch {
    return null;
  }
}

/** Invalidate panel cache for a specific region (call after memory point changes) */
export async function invalidatePanelCache(regionId?: string): Promise<void> {
  try {
    if (regionId) {
      await AsyncStorage.removeItem(`hierarchy:panel:${regionId}`);
    } else {
      // Remove all panel cache keys
      const keys = await AsyncStorage.getAllKeys();
      const panelKeys = keys.filter((k) => k.startsWith('hierarchy:panel:'));
      if (panelKeys.length > 0) await AsyncStorage.multiRemove(panelKeys);
    }
  } catch { /* ignore */ }
}
