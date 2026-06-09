/**
 * featureFlags — Sprint 66 灰度策略
 *
 * Will move to: app/src/config/featureFlags.ts
 *
 * 优先级（高→低）：
 *   1. AsyncStorage override (dev menu, 连点版本号 5 次解锁)
 *   2. 静态 default (本文件)
 *   3. (Sprint 67) Backend remote config
 *
 * Sprint 66 strategy:
 *   - core flags 默认 false (production 用户看不到 Edit 按钮)
 *   - dev/QA 通过 AsyncStorage override 打开做内测
 *   - Sprint 67 接 backend `/api/config/edit-mode` 远程灰度 1% → 10% → 100%
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = '@cairn:feature_flags:v1';

export interface FeatureFlags {
  // Edit mode 主开关 (default false)
  editModeEnabled: boolean;

  // Midpoint drag 子开关 (default false)
  midpointDragEnabled: boolean;

  // Undo (P1，Sprint 66 不做)
  enableUndo: boolean;

  // 双源决策模式
  // 'auto'      自动 DualSourceRouter
  // 'mapbox-only' 强制 Mapbox（debug 用）
  // 'doc-only'    强制 DOC（debug 用）
  dualSourceMode: 'auto' | 'mapbox-only' | 'doc-only';

  // 编辑 corridor 半径（米）
  editCorridorRadiusMeters: number;

  // Reroute 配置
  rerouteTimeoutMs: number;
  rerouteMaxDetourRatio: number;

  // 数据源开关
  enableDOCSource: boolean;
  enableMapboxSource: boolean;
}

export const DEFAULT_FLAGS: FeatureFlags = {
  // Sprint 66 Wave 7 (post-merge audit v29): dual-source edit UI is now
  // wired into RouteEditorScreen and the entire useRouteEditStore
  // pipeline (saveAndExit, beginEdit, persistence, recovery) has been
  // hardened across v14-v28. Flipping defaults to true so the OTA build
  // ships the feature live for all users. Previous default was false
  // for a planned remote-config gradual rollout that never materialised.
  editModeEnabled: true,
  midpointDragEnabled: true,
  enableUndo: false,              // P1 不做
  dualSourceMode: 'auto',
  editCorridorRadiusMeters: 1000, // rules v4 锁定 1km
  rerouteTimeoutMs: 8000,
  rerouteMaxDetourRatio: 3.0,
  enableDOCSource: true,
  enableMapboxSource: true,
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
  // Persist only the override fields (not all flags) to AsyncStorage
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
