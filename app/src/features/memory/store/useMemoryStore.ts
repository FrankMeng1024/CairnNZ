/**
 * Memory store — Zustand store holding the user's visited GPS points.
 *
 * v0.2.6.1 model rewrite:
 *   Previously: tile-bitmap (Web Mercator z17 tile + 128×128 sub-grid)
 *   Now:        sequence of GPS points; each point unlocks a 25m circle
 *
 * Why the switch: visual model is "circle around me", not "square
 * tiles". Storage is also simpler (~30 bytes/point vs 2KB/tile) and
 * directly cloud-syncable as a typed JSON array.
 *
 * Responsibilities:
 *   - Record visited points (idempotent — culls near-duplicates).
 *   - Persist to AsyncStorage as offline buffer.
 *   - Cloud sync (separate service uploads + clears local once acked).
 *   - Provide read APIs for fogBuilder + isExplored checks.
 *
 * It does NOT:
 *   - Talk to the network. The sync service in services/memorySync.ts
 *     subscribes to this store and uploads.
 *   - Decide unlock policy (radius, speed gates). Logic lives in
 *     unlockEngine which calls into this store.
 */

import { create } from 'zustand';
import { UnlockConfig } from '../config/memoryConfig';

/**
 * One GPS reading the user has visited. Stored chronologically.
 *
 * `synced` flags whether this point has been uploaded to the server
 * (true) or is still local-only (false). The sync service flips false
 * → true as it acks each batch.
 */
export interface VisitedPoint {
  lat: number;
  lng: number;
  /** Unix ms when the user was here. */
  ts: number;
  /** True iff successfully uploaded to server. */
  synced?: boolean;
}

/**
 * Tile-shaped record kept ONLY for backwards compatibility with the
 * persistence layer's older `SerializedMemory v1` payloads. New writes
 * never produce one; deserialize will convert v1 tiles → v2 points by
 * picking the tile center.
 */
export interface ExploredTile {
  key: string;
  bitmap: Uint8Array;
  firstSeenAt: number;
  lastSeenAt: number;
}

interface MemoryState {
  /** All visited points, chronological. Cull-on-write keeps it sparse. */
  points: VisitedPoint[];
  /**
   * Spatial bucket index for fast isExplored lookup. ~100m per bucket.
   * Internal — not exposed in selectors.
   */
  _bucketIndex: Map<string, VisitedPoint[]> | null;
  /** Whether the initial reveal has been performed. */
  initialRevealDone: boolean;

  /** Record one GPS point as visited. Idempotent. */
  recordPoint: (lat: number, lng: number, atMs?: number) => void;

  /** Mark a circular region (initial reveal) — drops a single point. */
  recordCircleUnlock: (lat: number, lng: number, radiusMeters: number, atMs?: number) => void;

  /** Read API — is this lat/lng within `unlockRadius` of any visited point? */
  isExplored: (lat: number, lng: number) => boolean;

  /** Read API — full list for the fog renderer. */
  listVisitedPoints: () => VisitedPoint[];

  /** Mark unsynced points as synced (called by the sync service). */
  markPointsSynced: (timestamps: number[]) => void;

  /** Replace all points (called by persistence on hydrate / by sync on download). */
  replacePoints: (points: VisitedPoint[], initialRevealDone: boolean) => void;

  /** Mark initial-reveal as done so we don't re-trigger. */
  markInitialRevealDone: () => void;

  /** Clear all memory (debug / settings → wipe). */
  clearAll: () => void;
}

const CULL_THRESHOLD_M = UnlockConfig.radiusMeters * 0.5; // 12.5m at default 25m radius
const CULL_THRESHOLD_SQ = CULL_THRESHOLD_M * CULL_THRESHOLD_M;

function distanceSqMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const dLat = (a.lat - b.lat) * 111_000;
  const cosLat = Math.cos((b.lat * Math.PI) / 180);
  const dLng = (a.lng - b.lng) * 111_000 * cosLat;
  return dLat * dLat + dLng * dLng;
}

/** ~100m bucket size in degrees lat. Lng buckets use 100m / cosLat scaling. */
const BUCKET_M = 100;
const BUCKET_LAT_DEG = BUCKET_M / 111_000;

function bucketKey(lat: number, lng: number): string {
  const cosLat = Math.cos((lat * Math.PI) / 180);
  const lngBucketDeg = BUCKET_LAT_DEG / Math.max(cosLat, 1e-6);
  return `${Math.floor(lat / BUCKET_LAT_DEG)}|${Math.floor(lng / lngBucketDeg)}`;
}

/** Buckets that the unlock radius around (lat,lng) can possibly intersect. */
function computeBucketsForRadius(c: { lat: number; lng: number }): string[] {
  // Unlock radius (~25m) is well under one bucket (~100m), so only
  // the cell containing (lat,lng) plus its 8 neighbours can matter.
  const cosLat = Math.cos((c.lat * Math.PI) / 180);
  const lngBucketDeg = BUCKET_LAT_DEG / Math.max(cosLat, 1e-6);
  const cy = Math.floor(c.lat / BUCKET_LAT_DEG);
  const cx = Math.floor(c.lng / lngBucketDeg);
  const out: string[] = [];
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      out.push(`${cy + dy}|${cx + dx}`);
    }
  }
  return out;
}

function buildBucketIndex(points: VisitedPoint[]): Map<string, VisitedPoint[]> {
  const idx = new Map<string, VisitedPoint[]>();
  for (const p of points) {
    const k = bucketKey(p.lat, p.lng);
    let arr = idx.get(k);
    if (!arr) { arr = []; idx.set(k, arr); }
    arr.push(p);
  }
  return idx;
}

export const useMemoryStore = create<MemoryState>((set, get) => ({
  points: [],
  _bucketIndex: null,
  initialRevealDone: false,

  recordPoint: (lat, lng, atMs = Date.now()) => {
    if (!isFinite(lat) || !isFinite(lng)) return;
    const points = get().points;
    const recent = points.slice(-32);
    for (const p of recent) {
      if (distanceSqMeters({ lat, lng }, p) < CULL_THRESHOLD_SQ) return;
    }
    const newPoint: VisitedPoint = { lat, lng, ts: atMs, synced: false };
    const newPoints = [...points, newPoint];
    // Maintain bucket index incrementally.
    const idx = get()._bucketIndex ? new Map(get()._bucketIndex!) : buildBucketIndex(points);
    const k = bucketKey(lat, lng);
    const arr = idx.get(k) ? [...idx.get(k)!, newPoint] : [newPoint];
    idx.set(k, arr);
    set({ points: newPoints, _bucketIndex: idx });
  },

  recordCircleUnlock: (lat, lng, _radiusMeters, atMs = Date.now()) => {
    if (!isFinite(lat) || !isFinite(lng)) return;
    const newPoint: VisitedPoint = { lat, lng, ts: atMs, synced: false };
    const points = get().points;
    const idx = get()._bucketIndex ? new Map(get()._bucketIndex!) : buildBucketIndex(points);
    const k = bucketKey(lat, lng);
    const arr = idx.get(k) ? [...idx.get(k)!, newPoint] : [newPoint];
    idx.set(k, arr);
    set({ points: [...points, newPoint], _bucketIndex: idx });
  },

  isExplored: (lat, lng) => {
    // Bucket lookup: divide world into ~100m grid cells, only check
    // points whose bucket key matches. With N=10000 points and even
    // distribution this drops the per-call cost from O(N) to ~O(1).
    // Worst case (clustered) is bounded by points per cell which for
    // a 25m unlock radius can only be a few dozen due to cull-12.5m.
    const target = { lat, lng };
    const radiusSq = UnlockConfig.radiusMeters * UnlockConfig.radiusMeters;
    const buckets = computeBucketsForRadius(target);
    const points = get().points;
    const bucketIndex = get()._bucketIndex;
    if (bucketIndex) {
      for (const bk of buckets) {
        const arr = bucketIndex.get(bk);
        if (!arr) continue;
        for (const p of arr) {
          if (distanceSqMeters(target, p) <= radiusSq) return true;
        }
      }
      return false;
    }
    // Fallback: linear scan if index hasn't been built yet.
    for (const p of points) {
      if (distanceSqMeters(target, p) <= radiusSq) return true;
    }
    return false;
  },

  listVisitedPoints: () => get().points,

  markPointsSynced: (timestamps) => {
    const set_ = new Set(timestamps);
    const newPoints = get().points.map((p) =>
      set_.has(p.ts) ? { ...p, synced: true } : p
    );
    // Bucket index is unaffected by synced flag flips, but the array
    // references inside have changed — rebuild for safety.
    set({ points: newPoints, _bucketIndex: buildBucketIndex(newPoints) });
  },

  replacePoints: (points, initialRevealDone) => {
    set({ points, _bucketIndex: buildBucketIndex(points), initialRevealDone });
  },

  markInitialRevealDone: () => set({ initialRevealDone: true }),

  clearAll: () => set({ points: [], _bucketIndex: null, initialRevealDone: false }),
}));
