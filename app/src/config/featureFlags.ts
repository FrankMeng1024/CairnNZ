/**
 * featureFlags — client-side feature toggles
 *
 * O1: 简化。/api/feature-flags 后端路由已删,只保留有 real caller 的
 * flags: editModeEnabled, midpointDragEnabled, editCorridorRadiusMeters。
 * 其余 (enableUndo/dualSourceMode/enableDOCSource/enableMapboxSource/
 * rerouteTimeoutMs/rerouteMaxDetourRatio) 全 0 caller 删除。
 *
 * 优先级(高→低):
 *   1. AsyncStorage override (dev-only)
 *   2. 静态 default (本文件)
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = '@cairn:feature_flags:v1';

export interface FeatureFlags {
  // Edit mode 主开关 (default true post-Sprint 66 wave 7)
  editModeEnabled: boolean;

  // Midpoint drag 子开关 (default true post-Sprint 66 wave 7)
  midpointDragEnabled: boolean;

  // 编辑 corridor 半径(米) — persistence snapshot 使用
  editCorridorRadiusMeters: number;
}

export const DEFAULT_FLAGS: FeatureFlags = {
  editModeEnabled: true,
  midpointDragEnabled: true,
  editCorridorRadiusMeters: 1000, // rules v4 锁定 1km
};

let cachedFlags: FeatureFlags | null = null;

/**
 * Read flags. Priority: AsyncStorage override > DEFAULT_FLAGS.
 * Cached in memory after first read.
 */
export async function getFlags(): Promise<FeatureFlags> {
  if (cachedFlags) return cachedFlags;
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (raw) {
      const overrides = JSON.parse(raw) as Partial<FeatureFlags>;
      cachedFlags = { ...DEFAULT_FLAGS, ...overrides };
    } else {
      cachedFlags = DEFAULT_FLAGS;
    }
  } catch {
    cachedFlags = DEFAULT_FLAGS;
  }
  return cachedFlags;
}

/**
 * Synchronous accessor. Must be called after getFlags() at app startup.
 * Returns DEFAULT_FLAGS if not yet loaded.
 */
export function getFlagsSync(): FeatureFlags {
  return cachedFlags ?? DEFAULT_FLAGS;
}

/**
 * Override a flag. For dev menu use only.
 */
export async function setFlagOverride<K extends keyof FeatureFlags>(
  key: K,
  value: FeatureFlags[K],
): Promise<void> {
  const current = await getFlags();
  const next = { ...current, [key]: value };
  cachedFlags = next;
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    const existing = raw ? JSON.parse(raw) : {};
    existing[key] = value;
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(existing));
  } catch {
    // ignore
  }
}

/**
 * Clear all overrides — restore defaults.
 */
export async function clearFlagOverrides(): Promise<void> {
  cachedFlags = DEFAULT_FLAGS;
  try {
    await AsyncStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}
