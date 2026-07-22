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
  // v428: three-state model
  //   marked  = user planted ≥1 marker (flag/cairn) in this region
  //   walked  = has memory_points but no markers
  //   locked  = never visited
  state: 'marked' | 'walked' | 'locked';
  point_count: number;
  marker_count: number;
}

export interface PanelData {
  current: Region;
  parent: { id: string; name_en: string; level: RegionLevel } | null;
  here_point_count: number;
  here_marker_count: number;
  here_state: 'marked' | 'walked' | 'locked';
  // legacy — kept for backwards compat but do not add new consumers
  explored_here: boolean;
  siblings: SiblingRow[];
  marked_count: number;
  walked_count: number;
  locked_count: number;
  explored_count: number; // = marked_count + walked_count
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
//
// v428: `drill` mode — when true, requests children of regionId as siblings
// instead of same-level siblings. Used when user taps the green (current)
// row to drill into its children.
//
// v428 cache: bumped key to `:v2:` because sibling state shape widened
// from {explored|locked} to {marked|walked|locked}. Old v1 cache entries
// would deserialise cleanly (JSON) but the state string would not match
// v428 client expectations. v2 prefix invalidates them, and any orphaned
// v1 keys sit dormant (AsyncStorage is not disk-space-critical); a full
// purge would risk racing with an in-flight write, so we let them expire.
// ─────────────────────────────────────────────────────────────────────────

const PANEL_CACHE_VERSION = 'v2';

/**
 * Normalize a sibling row received from the backend so both v428 clients
 * hitting v427 servers and v428 clients hitting v428 servers produce a
 * consistent SiblingRow shape.
 *
 * v427 backend has no marker_count distinction — all "explored" degrades
 * to 'walked'. No way to recover the marker split from historic responses.
 */
function normalizeSibling(s: any): SiblingRow {
  let state: SiblingRow['state'];
  if (s.state === 'marked' || s.state === 'walked' || s.state === 'locked') {
    state = s.state;
  } else if (s.state === 'explored') {
    // v427 backend
    state = (s.marker_count ?? 0) > 0 ? 'marked' : 'walked';
  } else {
    // unknown — fail safe as locked
    state = 'locked';
  }
  return {
    id: s.id,
    name_en: s.name_en,
    level: s.level,
    bbox: s.bbox,
    is_here: !!s.is_here,
    state,
    point_count: s.point_count ?? 0,
    marker_count: s.marker_count ?? 0,
  };
}

/** Normalize the full PanelData payload for v427 → v428 compat. */
function normalizePanelData(raw: any): PanelData {
  const siblings = Array.isArray(raw?.siblings)
    ? raw.siblings.map(normalizeSibling)
    : [];
  // Recompute counts from normalized state if not present
  const marked_count = raw?.marked_count ?? siblings.filter((s: SiblingRow) => !s.is_here && s.state === 'marked').length;
  const walked_count = raw?.walked_count ?? siblings.filter((s: SiblingRow) => !s.is_here && s.state === 'walked').length;
  const locked_count = raw?.locked_count ?? siblings.filter((s: SiblingRow) => !s.is_here && s.state === 'locked').length;
  const here_marker_count = raw?.here_marker_count ?? 0;
  const here_point_count = raw?.here_point_count ?? 0;
  const here_state: PanelData['here_state'] =
    raw?.here_state
    ?? (here_marker_count > 0 ? 'marked' : here_point_count > 0 ? 'walked' : 'locked');
  return {
    current: raw.current,
    parent: raw.parent ?? null,
    here_point_count,
    here_marker_count,
    here_state,
    explored_here: raw?.explored_here ?? (here_point_count > 0 || here_marker_count > 0),
    siblings,
    marked_count,
    walked_count,
    locked_count,
    explored_count: raw?.explored_count ?? (marked_count + walked_count),
  };
}

export async function fetchPanelData(regionId: string, drill = false): Promise<PanelData | null> {
  const key = `hierarchy:panel:${PANEL_CACHE_VERSION}:${regionId}${drill ? ':drill' : ''}`;
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
    const qs = drill ? `&drill=1` : '';
    const res = await authedFetch(`/api/hierarchy/panel?region_id=${encodeURIComponent(regionId)}${qs}`);
    if (!res.ok) return null;
    const raw = await res.json();
    const data = normalizePanelData(raw);
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

// ─────────────────────────────────────────────────────────────────────────
// v428: Polygon fetch for region highlight
// Returns a FeatureCollection to plug directly into a Mapbox ShapeSource.
// Empty features array = no highlight (continent/world levels).
// ─────────────────────────────────────────────────────────────────────────

export interface RegionPolygon {
  region_id: string;
  type: 'FeatureCollection';
  features: Array<{
    type: 'Feature';
    properties: { id: string; name_en: string; level: RegionLevel };
    geometry: any;
  }>;
}

const POLYGON_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h
const POLYGON_CACHE_VERSION = 'v2';

const EMPTY_FC: RegionPolygon = {
  region_id: '',
  type: 'FeatureCollection',
  features: [],
};

export async function fetchPolygon(regionId: string): Promise<RegionPolygon> {
  const key = `hierarchy:polygon:${POLYGON_CACHE_VERSION}:${regionId}`;
  try {
    const cached = await AsyncStorage.getItem(key);
    if (cached) {
      const parsed = JSON.parse(cached);
      if (Date.now() - parsed.ts < POLYGON_CACHE_TTL_MS) {
        return parsed.data;
      }
    }
  } catch { /* ignore */ }

  try {
    const res = await authedFetch(`/api/hierarchy/polygon/${encodeURIComponent(regionId)}`);
    if (!res.ok) return { ...EMPTY_FC, region_id: regionId };
    const data = (await res.json()) as RegionPolygon;
    // Only cache non-empty results (empty = server said no polygon; retry cheap)
    if (data.features && data.features.length > 0) {
      try {
        await AsyncStorage.setItem(key, JSON.stringify({ ts: Date.now(), data }));
      } catch { /* ignore */ }
    }
    return data;
  } catch {
    return { ...EMPTY_FC, region_id: regionId };
  }
}

/** True if the polygon FeatureCollection has no real features (continents, world, unknown). */
export function isEmptyPolygon(p: RegionPolygon | null | undefined): boolean {
  return !p || !p.features || p.features.length === 0;
}
