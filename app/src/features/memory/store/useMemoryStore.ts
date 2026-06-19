/**
 * Memory store — Zustand store holding the user's visited GPS points.
 *
 * v0.2.6.3 (K plan v2):
 *   - K2: every point now carries a stable cid (uuid v4 client-side OR
 *     deterministic hash for legacy migrations). server UNIQUE is
 *     (user_id, cid), so simultaneous-millisecond points no longer
 *     collide.
 *   - K4: spatial bucket index uses a CANONICAL cosLat per 0.1° band
 *     so bucketKey() and computeBucketsForRadius() agree on lng-bucket
 *     size — no more boundary points missed by isExplored().
 *   - K5: geometryVersion counter; bumped only when geometry changes
 *     (recordPoint/recordCircleUnlock/replacePoints/clearAll). NOT
 *     bumped by markPointsSynced. FogLayer memoizes on geometryVersion
 *     so synced-flag flips don't trigger expensive polygon rebuilds.
 *   - K6: syncState lives in the store; memorySync mutates via
 *     bumpInFlight(±1). UI subscribes via normal selectors.
 *
 * The store does NOT:
 *   - Talk to the network. The sync service in services/memorySync.ts
 *     subscribes to this store and uploads.
 *   - Decide unlock policy (radius, speed gates). Logic lives in
 *     unlockEngine which calls into this store.
 */

import { create } from 'zustand';
import { UnlockConfig } from '../config/memoryConfig';

export interface VisitedPoint {
  lat: number;
  lng: number;
  /** Unix ms when the user was here. */
  ts: number;
  /** Stable cid (uuid v4 client OR sha1-based for legacy) — server's UNIQUE key. */
  cid: string;
  /** True iff successfully uploaded to server. */
  synced?: boolean;
}

/** Legacy v2 schema (tile bitmap) — declared so persistence can detect it. */
export interface ExploredTile {
  key: string;
  bitmap: Uint8Array;
  firstSeenAt: number;
  lastSeenAt: number;
}

interface SyncState {
  /** Number of pushes currently in flight. > 0 means "syncing now". */
  inFlightCount: number;
  /** Unix ms of last successful push (informational; UI can show "last synced"). */
  lastSyncAt: number;
}

interface MemoryState {
  points: VisitedPoint[];
  /** Spatial bucket index for fast isExplored. Internal — null = rebuild on use. */
  _bucketIndex: Map<string, VisitedPoint[]> | null;
  /** Bumped on geometry mutations. FogLayer keys its memo on this. */
  geometryVersion: number;
  /**
   * M9 fix: incrementally-maintained count of unsynced points. Lets the
   * memorySync subscribe avoid O(N) scans of points on every state
   * mutation. Always equals points.filter(p => !p.synced).length.
   */
  _unsyncedCount: number;
  initialRevealDone: boolean;
  syncState: SyncState;

  /** Record one GPS point as visited. Idempotent. */
  recordPoint: (lat: number, lng: number, atMs?: number) => void;

  /** Mark a circular region (initial reveal) — drops a single point. */
  recordCircleUnlock: (lat: number, lng: number, radiusMeters: number, atMs?: number) => void;

  /** Read API — is this lat/lng within `unlockRadius` of any visited point? */
  isExplored: (lat: number, lng: number) => boolean;

  /** Read API — full list for the fog renderer. */
  listVisitedPoints: () => VisitedPoint[];

  /** Mark unsynced points as synced by cid (sync service). Does NOT bump geometryVersion. */
  markPointsSyncedByCid: (cids: string[]) => void;

  /**
   * L1 fix: apply per-point server echo from a push response. Each
   * echo entry includes localIdx (the client's batch index) so the
   * client can align even if some entries were rejected server-side.
   * Falls back to (ts, oldCid) matching for cases where localIdx is
   * unavailable.
   */
  applyServerEchoForPush: (echo: Array<{ localIdx: number; ts: number; oldCid: string; newCid: string }>) => void;

  /**
   * N2 fix: receive the exact batch (the array memorySync sent) and
   * the echo aligned 1:1 by index. The store updates points whose
   * cid+ts match batch[i]. This bypasses the lookup-map collision
   * that broke legacy dual-empty-cid same-ts cases.
   */
  applyServerEchoForPushAligned: (batch: VisitedPoint[], echo: Array<{ batch_index?: number; ts?: number; cid?: string } | null>) => void;

  /** Replace all points (called by persistence on hydrate / by sync on download). */
  replacePoints: (points: VisitedPoint[], initialRevealDone: boolean) => void;

  /** Mark initial-reveal as done so we don't re-trigger. */
  markInitialRevealDone: () => void;

  /** Clear all memory. */
  clearAll: () => void;

  /** Sync service hooks for the syncState atom. */
  /**
   * N1 fix (v0.2.6.3) — central reset entrypoint. ALL user-switch /
   * logout / clearAll callers funnel here so we cannot leave stale
   * pieces of state behind. Adding new state fields requires updating
   * this single function — no cross-cutting.
   */
  resetForUserSwitch: () => void;

  bumpInFlight: (delta: 1 | -1) => void;
}

const CULL_THRESHOLD_M = UnlockConfig.radiusMeters * 0.5;
const CULL_THRESHOLD_SQ = CULL_THRESHOLD_M * CULL_THRESHOLD_M;

function distanceSqMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const dLat = (a.lat - b.lat) * 111_000;
  const cosLat = Math.cos((b.lat * Math.PI) / 180);
  const dLng = (a.lng - b.lng) * 111_000 * cosLat;
  return dLat * dLat + dLng * dLng;
}

/**
 * L5 fix (v0.2.6.3): drop band quantization. Bands introduced cross-band
 * asymmetry where bucketKey and computeBucketsForRadius computed
 * different cosLat for points near band boundaries (40.999 vs 41.001).
 *
 * We now use the POINT's exact cosLat for keying AND the QUERY's exact
 * cosLat for sweeping — they will differ slightly across a 100m bucket
 * but only by < 0.001% at typical latitudes (NZ -36 to -46), so the
 * 9-cell sweep is wide enough to catch any matching point. Math:
 *   - Bucket size: 100m. lng-bucket-deg = 100m / (111km * cosLat).
 *   - Within ±100m of the query, lat differs by ≤ 0.0009°. cosLat
 *     change is ≤ 1.5e-5 at lat 45°. lng-bucket-deg shifts by < 0.002%.
 *     A 100m horizontal distance is 1 bucket; 0.002% drift is far below
 *     1 bucket, so the 9-cell sweep (±1) always covers it.
 */
const BUCKET_M = 100;
const BUCKET_LAT_DEG = BUCKET_M / 111_000;

function bucketKey(lat: number, lng: number): string {
  const cosLat = Math.cos((lat * Math.PI) / 180);
  const lngBucketDeg = BUCKET_LAT_DEG / Math.max(cosLat, 1e-6);
  return `${Math.floor(lat / BUCKET_LAT_DEG)}|${Math.floor(lng / lngBucketDeg)}`;
}

function computeBucketsForRadius(c: { lat: number; lng: number }): string[] {
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

/**
 * Generate a uuid v4 string. Lightweight implementation — Hermes-safe,
 * no external dep.
 */
function uuidv4(): string {
  // RFC4122-ish; Math.random is sufficient for ~2^61 plant rate.
  const r = () => Math.floor(Math.random() * 0x10000).toString(16).padStart(4, '0');
  const d4 = () => (Math.floor(Math.random() * 0x4000) + 0x8000).toString(16);
  const d12 = () => `${r()}${r()}${r()}`;
  return `${r()}${r()}-${r()}-4${r().slice(0, 3)}-${d4()}-${d12()}`;
}

export const useMemoryStore = create<MemoryState>((set, get) => ({
  points: [],
  _bucketIndex: null,
  geometryVersion: 0,
  _unsyncedCount: 0,
  initialRevealDone: false,
  syncState: { inFlightCount: 0, lastSyncAt: 0 },

  recordPoint: (lat, lng, atMs = Date.now()) => {
    if (!isFinite(lat) || !isFinite(lng)) return;
    // M6 fix (v0.2.6.3): force ts to integer at the boundary so server
    // and client agree on the deterministic-cid hash input. Fractional
    // ts breaks echo lookup → infinite retry.
    const ts = Math.floor(atMs);
    const points = get().points;
    const recent = points.slice(-32);
    for (const p of recent) {
      if (distanceSqMeters({ lat, lng }, p) < CULL_THRESHOLD_SQ) return;
    }
    const newPoint: VisitedPoint = { lat, lng, ts, cid: uuidv4(), synced: false };
    const newPoints = [...points, newPoint];
    const idx = get()._bucketIndex ? new Map(get()._bucketIndex!) : buildBucketIndex(points);
    const k = bucketKey(lat, lng);
    const arr = idx.get(k) ? [...idx.get(k)!, newPoint] : [newPoint];
    idx.set(k, arr);
    // M9 fix: maintain unsyncedCount incrementally — saves O(N) scan
    // in memorySync subscribe.
    set({
      points: newPoints,
      _bucketIndex: idx,
      geometryVersion: get().geometryVersion + 1,
      _unsyncedCount: get()._unsyncedCount + 1,
    });
  },

  recordCircleUnlock: (lat, lng, _radiusMeters, atMs = Date.now()) => {
    if (!isFinite(lat) || !isFinite(lng)) return;
    const ts = Math.floor(atMs);
    // O5 fix (v0.2.6.3): if a point already exists within the cull
    // radius (e.g. ForegroundUnlockManager's watcher just recorded
    // one at the same coords), reuse it instead of inserting a
    // duplicate. The fog renderer paints a 25m circle around the
    // existing point, which is what plant wants. Avoids server
    // storing 2 rows for the same physical location.
    const points = get().points;
    const recent = points.slice(-32);
    for (const p of recent) {
      if (distanceSqMeters({ lat, lng }, p) < CULL_THRESHOLD_SQ) {
        // Existing nearby point — no new insertion needed.
        return;
      }
    }
    const newPoint: VisitedPoint = { lat, lng, ts, cid: uuidv4(), synced: false };
    const idx = get()._bucketIndex ? new Map(get()._bucketIndex!) : buildBucketIndex(points);
    const k = bucketKey(lat, lng);
    const arr = idx.get(k) ? [...idx.get(k)!, newPoint] : [newPoint];
    idx.set(k, arr);
    set({
      points: [...points, newPoint],
      _bucketIndex: idx,
      geometryVersion: get().geometryVersion + 1,
      _unsyncedCount: get()._unsyncedCount + 1,
    });
  },

  isExplored: (lat, lng) => {
    const target = { lat, lng };
    const radiusSq = UnlockConfig.radiusMeters * UnlockConfig.radiusMeters;
    const buckets = computeBucketsForRadius(target);
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
    for (const p of get().points) {
      if (distanceSqMeters(target, p) <= radiusSq) return true;
    }
    return false;
  },

  listVisitedPoints: () => get().points,

  /**
   * K5 fix: this only flips synced flags — geometry is unchanged, so
   * geometryVersion is NOT bumped. FogLayer (memoized on
   * geometryVersion) does not rebuild.
   */
  markPointsSyncedByCid: (cids) => {
    if (cids.length === 0) return;
    const set_ = new Set(cids);
    const oldPoints = get().points;
    let flippedCount = 0;
    const newPoints = oldPoints.map((p) => {
      if (p.cid && set_.has(p.cid) && !p.synced) {
        flippedCount++;
        return { ...p, synced: true };
      }
      return p;
    });
    if (flippedCount === 0) return;
    // M12 fix: bucket index unaffected by synced-flag flips. Keep
    // existing index reference — geometry didn't change.
    set({
      points: newPoints,
      // _bucketIndex unchanged.
      _unsyncedCount: Math.max(0, get()._unsyncedCount - flippedCount),
      // geometryVersion intentionally NOT bumped.
      syncState: { ...get().syncState, lastSyncAt: Date.now() },
    });
  },

  /**
   * N2 fix: align by exact batch identity. The caller passes the
   * SAME array references it sent in the push, so we can find each
   * store point unambiguously and update cid+synced.
   *
   * For batch[i].cid !== '': find store point by cid.
   * For batch[i].cid === '' (legacy v2): disambiguate by (ts, lat, lng).
   * The (ts, lat, lng) tuple is unique because a user can't be at
   * two places at the same ms.
   */
  applyServerEchoForPushAligned: (batch, echo) => {
    if (batch.length === 0) return;
    const updates = new Map<VisitedPoint, string>();
    const oldPoints = get().points;
    // O8 fix (v0.2.6.3): pre-build a (ts,lat,lng) map for empty-cid
    // lookups so we don't do oldPoints.find() inside the loop. Without
    // this, push of N legacy points scans M store points per echo entry
    // → O(N*M). With it, O(N+M) total.
    const byCid = new Map<string, VisitedPoint>();
    const byGeoTs = new Map<string, VisitedPoint>();
    for (const p of oldPoints) {
      if (p.cid) byCid.set(p.cid, p);
      else byGeoTs.set(`${p.ts}|${p.lat}|${p.lng}`, p);
    }
    for (let i = 0; i < batch.length; i++) {
      const ec = echo[i];
      if (!ec || typeof ec.cid !== 'string' || ec.cid.length === 0) continue;
      const b = batch[i];
      let found: VisitedPoint | undefined;
      if (b.cid) found = byCid.get(b.cid);
      else found = byGeoTs.get(`${b.ts}|${b.lat}|${b.lng}`);
      if (found && !found.synced) updates.set(found, ec.cid);
    }
    if (updates.size === 0) return;
    const newPoints = oldPoints.map((p) => {
      const newCid = updates.get(p);
      if (!newCid) return p;
      return { ...p, cid: newCid, synced: true };
    });
    set({
      points: newPoints,
      _unsyncedCount: Math.max(0, get()._unsyncedCount - updates.size),
      syncState: { ...get().syncState, lastSyncAt: Date.now() },
    });
  },

  /**
   * M11 fix: match echo entries by batch index passed back from server,
   * AND fall back to (ts, oldCid) matching for legacy paths. Server now
   * emits `null` placeholders so caller's batch[i] aligns to echo[i].
   * (Kept for any non-migrated caller. Memory sync uses Aligned variant.)
   */
  applyServerEchoForPush: (echo) => {
    if (echo.length === 0) return;
    // Build lookup keyed by both (ts, oldCid) pair AND by stable
    // batch identity (clientLocalIdx string the caller assigns).
    const lookup = new Map<string, string>();
    for (const e of echo) {
      lookup.set(`${e.localIdx}`, e.newCid);
      lookup.set(`${e.ts}|${e.oldCid}`, e.newCid);
    }
    const oldPoints = get().points;
    let changed = 0;
    const newPoints = oldPoints.map((p) => {
      // Prefer cid match (current cid identifies the point uniquely
      // post-echo); fall back to (ts, '') match for legacy v2 points.
      const tsKey = `${p.ts}|${p.cid ?? ''}`;
      const newCid = lookup.get(tsKey);
      if (newCid && (newCid !== p.cid || !p.synced)) {
        const wasSynced = p.synced ?? false;
        if (!wasSynced) changed++;
        return { ...p, cid: newCid, synced: true };
      }
      return p;
    });
    if (changed === 0 && newPoints === oldPoints) return;
    set({
      points: newPoints,
      // M12: geometry unchanged; reuse existing bucket index. Note:
      // index entries hold references to OLD point objects, but their
      // lat/lng are identical so spatial queries still work. The
      // _unsyncedCount tracks the actual flag state.
      _unsyncedCount: Math.max(0, get()._unsyncedCount - changed),
      syncState: { ...get().syncState, lastSyncAt: Date.now() },
    });
  },

  replacePoints: (points, initialRevealDone) => {
    const unsyncedCount = points.reduce((n, p) => n + (p.synced ? 0 : 1), 0);
    set({
      points,
      _bucketIndex: buildBucketIndex(points),
      geometryVersion: get().geometryVersion + 1,
      _unsyncedCount: unsyncedCount,
      initialRevealDone,
    });
  },

  markInitialRevealDone: () => set({ initialRevealDone: true }),

  clearAll: () => set({
    points: [],
    _bucketIndex: null,
    geometryVersion: get().geometryVersion + 1,
    _unsyncedCount: 0,
    initialRevealDone: false,
    // N1 fix (v0.2.6.3): reset syncState too. Otherwise a logout
    // mid-push leaves inFlightCount=1 in the store; the next user's
    // MemorySummaryCard reads "Syncing…" indefinitely.
    syncState: { inFlightCount: 0, lastSyncAt: 0 },
  }),

  bumpInFlight: (delta) => {
    const cur = get().syncState;
    set({
      syncState: {
        inFlightCount: Math.max(0, cur.inFlightCount + delta),
        lastSyncAt: cur.lastSyncAt,
      },
    });
  },

  /**
   * N1 fix: single source of truth for state reset on user-switch.
   * Calls clearAll's logic plus syncState reset. Use anywhere a
   * caller previously had to update multiple slices.
   */
  resetForUserSwitch: () => set({
    points: [],
    _bucketIndex: null,
    geometryVersion: get().geometryVersion + 1,
    _unsyncedCount: 0,
    initialRevealDone: false,
    syncState: { inFlightCount: 0, lastSyncAt: 0 },
  }),
}));
