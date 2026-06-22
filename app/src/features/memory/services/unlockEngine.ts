/**
 * Unlock engine — applies unlock policy (radius, speed gate, accuracy
 * gate) to incoming GPS readings and records the resulting unlock(s)
 * into the memory store.
 *
 * Pure logic — no React, no UI. Easy to unit-test by feeding fake
 * GpsReading instances.
 *
 * Lifecycle:
 *   - During an active hike/run, components feed GPS readings via
 *     `processReading()`.
 *   - The engine decides whether the reading qualifies and, if so,
 *     calls `useMemoryStore.recordUnlock()`.
 *   - Unlock policy lives in memoryConfig.UnlockConfig — change there,
 *     not here.
 */

import { useMemoryStore } from '../store/useMemoryStore';
import { UnlockConfig } from '../config/memoryConfig';

export interface GpsReading {
  lat: number;
  lng: number;
  /** Apple horizontalAccuracy (meters). null if unknown. */
  accuracyM: number | null;
  /** Speed in m/s. null if unknown. */
  speedMs: number | null;
  /** Reading timestamp (Unix ms). */
  timestampMs: number;
}

export type UnlockDecision =
  | { kind: 'unlocked'; reason: 'first-fix' | 'walking' }
  | { kind: 'skipped'; reason: 'speed-too-fast' | 'accuracy-too-poor' | 'duplicate-cell' };

const KMH_PER_MS = 3.6;

/**
 * Last cell key we unlocked, used to short-circuit duplicate calls
 * within the same physical cell. Note this is module-level state
 * (not in the store) because the deduplication is a hot-path
 * optimization, not a product-visible decision.
 */
let lastUnlockedCellKey: string | null = null;

export function processReading(reading: GpsReading): UnlockDecision {
  // Gate 1: accuracy
  if (
    reading.accuracyM !== null &&
    reading.accuracyM > UnlockConfig.minGpsAccuracyMeters
  ) {
    return { kind: 'skipped', reason: 'accuracy-too-poor' };
  }

  // Gate 2: speed (vehicle filter)
  if (reading.speedMs !== null) {
    const kmh = reading.speedMs * KMH_PER_MS;
    if (kmh > UnlockConfig.maxSpeedKmh) {
      return { kind: 'skipped', reason: 'speed-too-fast' };
    }
  }

  // Gate 3: dedup (same cell as last reading → skip work)
  // We approximate the cell key by quantizing lat/lng to ~3m steps.
  // Apply cosLat to the lng quantization so non-equatorial latitudes
  // don't collapse multiple cells into the same key.
  const latQuantDeg = 3 / 111_000;
  const cosLat = Math.cos((reading.lat * Math.PI) / 180);
  const lngQuantDeg = 3 / (111_000 * Math.max(cosLat, 1e-6));
  const cellKey = `${Math.round(reading.lat / latQuantDeg)}|${Math.round(reading.lng / lngQuantDeg)}`;
  if (cellKey === lastUnlockedCellKey) {
    return { kind: 'skipped', reason: 'duplicate-cell' };
  }
  lastUnlockedCellKey = cellKey;

  // Apply unlock as a single visited point. The fog renderer paints a
  // 25m circle around it. v0.2.6.1 simplification — was `recordCircleUnlock`
  // that pre-computed sub-grid cells, but the new point-based fog model
  // makes that work redundant.
  useMemoryStore.getState().recordPoint(reading.lat, reading.lng, reading.timestampMs);

  return {
    kind: 'unlocked',
    reason: 'walking',
  };
}

/**
 * Apply the initial-reveal circle on first app open.
 * Idempotent — checks the store flag.
 *
 * v303 OTA 三修 (B-1 真根因):500m hex grid 生成 ~567 个新点 + 重建
 * bucketIndex(1147 keys) 主线程同步阻塞 200-400ms,跟 fog rebuild 叠
 * 加形成"卡 15s"感。setTimeout(0) 让出当前 tick,MemoryMap 和 GPS
 * 渲染先跑完,再异步 reveal。用户第一帧看到 map(无 reveal fog)→
 * 几百 ms 后 reveal 完成 → fog 出现。比 freeze 15s 友好得多。
 */
export function performInitialRevealIfNeeded(lat: number, lng: number): boolean {
  const store = useMemoryStore.getState();
  if (store.initialRevealDone) return false;
  // 立刻标记 done,防止同步 path 多次调
  store.markInitialRevealDone();
  // 延迟到下一 tick,let 主线程先 layout MemoryMap
  setTimeout(() => {
    try {
      const t0 = Date.now();
      const before = useMemoryStore.getState().points.length;
      useMemoryStore.getState().recordCircleUnlock(lat, lng, UnlockConfig.initialRevealRadiusMeters, Date.now());
      const after = useMemoryStore.getState().points.length;
      // log perf — server 可看
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { log } = require('../../../services/appLog');
      log('memory.initial_reveal_done', {
        radius_m: UnlockConfig.initialRevealRadiusMeters,
        added: after - before,
        total: after,
        total_ms: Date.now() - t0,
      });
    } catch {/* best-effort */}
  }, 0);
  // Reset the dedup hint so the next walking reading still records.
  lastUnlockedCellKey = null;
  return true;
}

/**
 * Reset cross-call dedup state. Call when the active user changes —
 * otherwise user B's first reading at the same cell as user A's last
 * reading is silently dropped.
 */
export function resetUnlockEngineForUser(): void {
  lastUnlockedCellKey = null;
}

/**
 * Test helper — reset internal dedup cache. Not exported through the
 * package boundary in production.
 */
export function __resetForTest(): void {
  lastUnlockedCellKey = null;
}
