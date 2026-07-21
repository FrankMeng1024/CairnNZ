/**
 * useHierarchyRegions — v424
 *
 * 生产 memory 层级导航所需的 region 数据 tree.
 *
 * R1 (v424): 静态 mock 数据 + 简单的 lat/lng 边界匹配, 不接 Mapbox Places API.
 * 用户 lat/lng 落在某个已知 bbox 内 → 归到那个 region. 目的:
 *   1. UI 骨架先出来, 用户能测层级导航手感
 *   2. Mapbox reverse geocode 集成留给 R2 (费 API quota + 缓存策略)
 *
 * R2 计划:
 *   - Mapbox Places API 反向 geocode 每个 memory point
 *   - 本地 AsyncStorage 缓存 hex → { country, region, place, district }
 *   - 首次进 world 视图批量反查 (Promise.all, 最多 50 hex)
 *   - 老用户长期堆积的 memory_points 通过 backend 后台预计算
 *
 * 数据 shape:
 *   type RegionLevel = 'world' | 'continent' | 'country' | 'region' | 'district'
 *   type Region = {
 *     id: string;         // 稳定 id: e.g. 'CN-31-101'
 *     name: string;       // "Shanghai" / "Jing'an"
 *     level: RegionLevel;
 *     parentId: string | null;
 *     bbox: [number, number, number, number]; // [minLng, minLat, maxLng, maxLat]
 *     state: 'marked' | 'walked' | 'locked';  // 用户当前状态
 *     mark_count?: number;
 *   }
 *
 * 上级/下级判断: parentId 关联.
 * "你在这" = 当前 GPS lat/lng 命中最深的 region.
 * marked = 该 region 内至少 1 个 marker
 * walked = 该 region 内有 memory_point 但没 marker
 * locked = 该 region 内 memory_point 数 = 0
 */

import { useMemo } from 'react';
import { useMarkerStore } from '../../../store/useMarkerStore';
import { useMemoryStore } from './useMemoryStore';

export type RegionLevel = 'world' | 'continent' | 'country' | 'region' | 'district';
export type RegionState = 'marked' | 'walked' | 'locked' | 'here';

export interface Region {
  id: string;
  name: string;
  level: RegionLevel;
  parentId: string | null;
  bbox: [number, number, number, number]; // [minLng, minLat, maxLng, maxLat]
  state: RegionState;
  markCount?: number;
}

// ─────────────────────────────────────────────────────────────────────────
// R1 mock hierarchy — 覆盖 NZ + China + 少量 Asia 邻居 (够用户测)
// bbox 数据来自公开地理 wiki, 精度到 0.1 度足够层级归属.
// ─────────────────────────────────────────────────────────────────────────

const STATIC_REGIONS: Omit<Region, 'state' | 'markCount'>[] = [
  // World / Continents
  { id: 'world', name: 'World', level: 'world', parentId: null, bbox: [-180, -90, 180, 90] },
  { id: 'AS', name: 'Asia', level: 'continent', parentId: 'world', bbox: [26, -10, 180, 82] },
  { id: 'OC', name: 'Oceania', level: 'continent', parentId: 'world', bbox: [110, -50, 180, 0] },
  { id: 'EU', name: 'Europe', level: 'continent', parentId: 'world', bbox: [-10, 35, 60, 72] },
  { id: 'NA', name: 'North America', level: 'continent', parentId: 'world', bbox: [-170, 15, -50, 84] },

  // Countries
  { id: 'CN', name: 'China', level: 'country', parentId: 'AS', bbox: [73, 18, 135, 54] },
  { id: 'NZ', name: 'New Zealand', level: 'country', parentId: 'OC', bbox: [166, -47, 179, -34] },
  { id: 'MY', name: 'Malaysia', level: 'country', parentId: 'AS', bbox: [99, 0.8, 120, 7.4] },
  { id: 'AU', name: 'Australia', level: 'country', parentId: 'OC', bbox: [113, -44, 154, -10] },
  { id: 'JP', name: 'Japan', level: 'country', parentId: 'AS', bbox: [122, 24, 146, 46] },

  // China provinces/municipalities
  { id: 'CN-31', name: 'Shanghai', level: 'region', parentId: 'CN', bbox: [120.85, 30.68, 122.24, 31.88] },
  { id: 'CN-33', name: 'Hangzhou', level: 'region', parentId: 'CN', bbox: [118.34, 29.19, 120.72, 30.55] },
  { id: 'CN-51', name: 'Chengdu', level: 'region', parentId: 'CN', bbox: [102.98, 30.09, 104.88, 31.44] },
  { id: 'CN-11', name: 'Beijing', level: 'region', parentId: 'CN', bbox: [115.42, 39.44, 117.5, 41.06] },

  // NZ regions
  { id: 'NZ-AUK', name: 'Auckland', level: 'region', parentId: 'NZ', bbox: [174.28, -37.30, 175.30, -36.10] },
  { id: 'NZ-WGN', name: 'Wellington', level: 'region', parentId: 'NZ', bbox: [174.60, -41.60, 175.60, -40.70] },
  { id: 'NZ-CAN', name: 'Canterbury', level: 'region', parentId: 'NZ', bbox: [169.60, -44.70, 174.10, -42.20] },
  { id: 'NZ-OTA', name: 'Otago', level: 'region', parentId: 'NZ', bbox: [167.60, -46.80, 171.20, -44.20] },
  { id: 'NZ-MWT', name: 'Manawatū-Whanganui', level: 'region', parentId: 'NZ', bbox: [174.60, -40.30, 176.60, -38.90] },

  // Shanghai districts (16)
  { id: 'CN-31-101', name: "Jing'an", level: 'district', parentId: 'CN-31', bbox: [121.42, 31.20, 121.49, 31.29] },
  { id: 'CN-31-102', name: 'Pudong', level: 'district', parentId: 'CN-31', bbox: [121.44, 30.83, 122.24, 31.42] },
  { id: 'CN-31-103', name: 'Xuhui', level: 'district', parentId: 'CN-31', bbox: [121.40, 31.14, 121.48, 31.22] },
  { id: 'CN-31-104', name: 'Huangpu', level: 'district', parentId: 'CN-31', bbox: [121.47, 31.19, 121.51, 31.25] },
  { id: 'CN-31-105', name: 'Changning', level: 'district', parentId: 'CN-31', bbox: [121.35, 31.19, 121.43, 31.24] },
  { id: 'CN-31-106', name: 'Putuo', level: 'district', parentId: 'CN-31', bbox: [121.34, 31.23, 121.43, 31.28] },
  { id: 'CN-31-107', name: 'Yangpu', level: 'district', parentId: 'CN-31', bbox: [121.49, 31.25, 121.58, 31.33] },
  { id: 'CN-31-108', name: 'Hongkou', level: 'district', parentId: 'CN-31', bbox: [121.46, 31.25, 121.52, 31.30] },
  { id: 'CN-31-109', name: 'Minhang', level: 'district', parentId: 'CN-31', bbox: [121.30, 31.00, 121.55, 31.18] },
  { id: 'CN-31-110', name: 'Baoshan', level: 'district', parentId: 'CN-31', bbox: [121.35, 31.35, 121.55, 31.52] },
  { id: 'CN-31-111', name: 'Jiading', level: 'district', parentId: 'CN-31', bbox: [121.15, 31.28, 121.40, 31.50] },
  { id: 'CN-31-112', name: 'Songjiang', level: 'district', parentId: 'CN-31', bbox: [121.03, 30.90, 121.35, 31.15] },
  { id: 'CN-31-113', name: 'Qingpu', level: 'district', parentId: 'CN-31', bbox: [120.85, 30.95, 121.20, 31.28] },
  { id: 'CN-31-114', name: 'Fengxian', level: 'district', parentId: 'CN-31', bbox: [121.35, 30.75, 121.75, 31.00] },
  { id: 'CN-31-115', name: 'Chongming', level: 'district', parentId: 'CN-31', bbox: [121.30, 31.55, 122.05, 31.85] },
  { id: 'CN-31-116', name: 'Jinshan', level: 'district', parentId: 'CN-31', bbox: [120.85, 30.68, 121.35, 30.92] },

  // Auckland sub-regions (mock — R1 只做几个)
  { id: 'NZ-AUK-01', name: 'City Centre', level: 'district', parentId: 'NZ-AUK', bbox: [174.75, -36.86, 174.79, -36.83] },
  { id: 'NZ-AUK-02', name: 'North Shore', level: 'district', parentId: 'NZ-AUK', bbox: [174.65, -36.85, 174.80, -36.72] },
  { id: 'NZ-AUK-03', name: 'Waitakere', level: 'district', parentId: 'NZ-AUK', bbox: [174.55, -37.00, 174.75, -36.80] },
];

function pointInBbox(lat: number, lng: number, bbox: [number, number, number, number]): boolean {
  const [minLng, minLat, maxLng, maxLat] = bbox;
  return lng >= minLng && lng <= maxLng && lat >= minLat && lat <= maxLat;
}

/**
 * 找到 lat/lng 最深的 region (district > region > country > continent > world).
 * 用于 "你在这" 判断.
 */
export function findDeepestRegion(lat: number, lng: number): Region | null {
  const levels: RegionLevel[] = ['district', 'region', 'country', 'continent', 'world'];
  for (const level of levels) {
    const match = STATIC_REGIONS.find(r => r.level === level && pointInBbox(lat, lng, r.bbox));
    if (match) return { ...match, state: 'here' };
  }
  return null;
}

/**
 * 给定 parentId, 返回该级 tree 内所有直接 children.
 */
function getChildren(parentId: string | null): Omit<Region, 'state' | 'markCount'>[] {
  return STATIC_REGIONS.filter(r => r.parentId === parentId);
}

/**
 * useHierarchyRegions — 给定 current region id, 返回该 region 的 siblings 及各自 state.
 *
 * @param currentRegionId 用户当前 region id (来自 findDeepestRegion 或用户上钻)
 * @returns {
 *   current: Region — 当前 region
 *   siblings: Region[] — 该 region 的 parent 的 children (含 self)
 *   parent: Region | null — 上一层
 * }
 */
export function useHierarchyRegions(currentRegionId: string | null): {
  current: Region | null;
  siblings: Region[];
  parent: Region | null;
} {
  const markers = useMarkerStore(s => s.markers);
  const memoryPoints = useMemoryStore(s => s.points);

  return useMemo(() => {
    if (!currentRegionId) return { current: null, siblings: [], parent: null };
    const currentRaw = STATIC_REGIONS.find(r => r.id === currentRegionId);
    if (!currentRaw) return { current: null, siblings: [], parent: null };

    // Fetch siblings (含 self) + parent
    const siblingsRaw = getChildren(currentRaw.parentId);
    const parentRaw = currentRaw.parentId
      ? STATIC_REGIONS.find(r => r.id === currentRaw.parentId) ?? null
      : null;

    // Compute state for each sibling: marked / walked / locked / here
    const siblings: Region[] = siblingsRaw.map(sib => {
      const markCount = markers.filter(m => pointInBbox(m.lat, m.lng, sib.bbox)).length;
      const walkedCount = memoryPoints.filter(p => pointInBbox(p.lat, p.lng, sib.bbox)).length;
      let state: RegionState;
      if (sib.id === currentRegionId) {
        state = 'here';
      } else if (markCount > 0) {
        state = 'marked';
      } else if (walkedCount > 0) {
        state = 'walked';
      } else {
        state = 'locked';
      }
      return { ...sib, state, markCount };
    });

    const current: Region = {
      ...currentRaw,
      state: 'here',
      markCount: markers.filter(m => pointInBbox(m.lat, m.lng, currentRaw.bbox)).length,
    };

    const parent: Region | null = parentRaw
      ? {
          ...parentRaw,
          state: 'marked', // parent shown at up-chip, state 意义不大
        }
      : null;

    return { current, siblings, parent };
  }, [currentRegionId, markers, memoryPoints]);
}
