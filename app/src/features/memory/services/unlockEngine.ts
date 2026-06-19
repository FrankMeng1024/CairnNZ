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
 */
export function performInitialRevealIfNeeded(lat: number, lng: number): boolean {
  const store = useMemoryStore.getState();
  if (store.initialRevealDone) return false;
  store.recordCircleUnlock(lat, lng, UnlockConfig.initialRevealRadiusMeters, Date.now());
  store.markInitialRevealDone();
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
