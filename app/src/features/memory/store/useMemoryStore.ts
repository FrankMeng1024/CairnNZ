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
// v305 OTA: dual-write to H3 hex-cell store on every recordPoint /
// recordCircleUnlock / replacePoints / pullMemoryFromServer path so the
// new H3-based FogLayer sees the same world as the legacy points store.
import { useH3VisitedStore } from './useH3VisitedStore';
import { UnlockConfig } from '../config/memoryConfig';
// v326: persist lastWatcherFix to AsyncStorage so cold-start has an
// immediate location for fog drawing — fixes "Looking for your position"
// loop reported by user in v325 testing.
import { persistLastFix } from '../services/lastFixCache';

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
  // O1: recentUnlocks removed — v303 Skia burst overlay 已在 v346 native
  // fog 上线后被替代,MemoryFogBurstOverlay 已删。原来是"dead-writer"(每
  // 次 recordPoint push 但无消费者),现在字段和 push 全清。
  /**
   * R4 fix (v0.2.6.4): cache the most recent GPS fix any watcher saw.
   * MemoryScreen reads this to avoid spawning a competing
   * getCurrentPositionAsync that conflicts with ForegroundUnlockManager's
   * BestForNavigation watcher on iOS.
   */
  lastWatcherFix: { lat: number; lng: number; ts: number } | null;
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

  /** Read API — is this lat/lng within `unlockRadius` of any visited point? */
  isExplored: (lat: number, lng: number) => boolean;

  // O1: removed listVisitedPoints() — 0 external callers. Consumers use
  // useMemoryStore(s => s.points) selector directly.

  /** Mark unsynced points as synced by cid (sync service). Does NOT bump geometryVersion. */
  markPointsSyncedByCid: (cids: string[]) => void;

  /**
   * L1 fix: apply per-point server echo from a push response. Each
   * echo entry includes localIdx (the client's batch index) so the
   * client can align even if some entries were rejected server-side.
   * Falls back to (ts, oldCid) matching for cases where localIdx is
   * unavailable.
   */
  // O1: applyServerEchoForPush interface removed — see impl comment below.
  // applyServerEchoForPushAligned is the only variant memorySync uses.

  /**
   * N2 fix: receive the exact batch (the array memorySync sent) and
   * the echo aligned 1:1 by index. The store updates points whose
   * cid+ts match batch[i]. This bypasses the lookup-map collision
   * that broke legacy dual-empty-cid same-ts cases.
   */
  applyServerEchoForPushAligned: (batch: VisitedPoint[], echo: Array<{ batch_index?: number; ts?: number; cid?: string } | null>) => void;

  /** Replace all points (called by persistence on hydrate / by sync on download). */
  replacePoints: (points: VisitedPoint[], initialRevealDone: boolean) => void;

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

  /** R4: any GPS watcher caches its latest fix here so MemoryScreen
   *  can use it without competing for a fresh fix. */
  setLastWatcherFix: (lat: number, lng: number, ts: number) => void;
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
  lastWatcherFix: null,

  recordPoint: (lat, lng, atMs = Date.now()) => {
    if (!isFinite(lat) || !isFinite(lng)) return;
    // M6 fix (v0.2.6.3): force ts to integer at the boundary so server
    // and client agree on the deterministic-cid hash input. Fractional
    // ts breaks echo lookup → infinite retry.
    const ts = Math.floor(atMs);
    const points = get().points;
    // O1: CULL 从 slice(-32) 改成走 bucket index 全量查 (9-cell sweep).
    // 之前 32-tail scan 在长 hike 后段的邻近点 dedup 失败 → 服务器 UNIQUE
    // 拦不住 (每个 uuid 不同),同一 cell 存多份。走 bucket index O(1) 查
    // 附近所有已 recordPoint 的点,同 12.5m 内 skip。
    const idxRef = get()._bucketIndex ?? buildBucketIndex(points);
    const targetBuckets = computeBucketsForRadius({ lat, lng });
    for (const k of targetBuckets) {
      const bucketPts = idxRef.get(k);
      if (!bucketPts) continue;
      for (const p of bucketPts) {
        if (distanceSqMeters({ lat, lng }, p) < CULL_THRESHOLD_SQ) return;
      }
    }
    const newPoint: VisitedPoint = { lat, lng, ts, cid: uuidv4(), synced: false };
    const newPoints = [...points, newPoint];
    const idx = get()._bucketIndex ? new Map(get()._bucketIndex!) : buildBucketIndex(points);
    const k = bucketKey(lat, lng);
    const arr = idx.get(k) ? [...idx.get(k)!, newPoint] : [newPoint];
    idx.set(k, arr);
    // O1: recentUnlocks push removed — Skia burst overlay 死了不需要 feed
    set({
      points: newPoints,
      _bucketIndex: idx,
      geometryVersion: get().geometryVersion + 1,
      _unsyncedCount: get()._unsyncedCount + 1,
    });
    // v305 OTA: dual-write to H3 cell store, AFTER setState so the two
    // stores update in the same JS tick — FogLayer (subscribed to
    // cellVersion) will see both stores consistent on next render.
    // Done last so any throw above doesn't desync.
    useH3VisitedStore.getState().addPointToCells(lat, lng, ts);
  },

  /**
   * v413 invariant (DO NOT UNION FRIEND POINTS HERE):
   * This method MUST stay self-only. Friend memory union is done at the
   * consumer layer (FogLayer, CairnPinsLayer) gated on memoryScope === 'friends'.
   *
   * Callers that DEPEND on self-only semantics:
   * - MapScreen.tsx: `inMyFog` predicate for MarkDetailSheet — determines
   *   form-B (own fog) vs form-C (friend-fog) rendering
   * - markVisibility.ts: `getMarkVisibility()` uses this to compute
   *   `viaSubscribedFriend` classification (iron law 2: can_like_report)
   *
   * If a future PR needs union behavior, add a SEPARATE method (e.g.
   * `isExploredUnion`) instead of modifying this. Or take the union at
   * the call-site (see CairnPinsLayer.tsx:82-99 for the pattern).
   */
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

  // O1: listVisitedPoints() implementation removed (see interface comment above).

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

  // O1: applyServerEchoForPush (M11 legacy) removed — memorySync uses
  // the Aligned variant only, and grep confirms 0 external callers.

  replacePoints: (points, initialRevealDone) => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('../../../services/bootDiagnostics').markBootPhase('replacepoints_entry', { points_n: points.length });
    } catch {/* ignore */}
    const unsyncedCount = points.reduce((n, p) => n + (p.synced ? 0 : 1), 0);
    set({
      points,
      _bucketIndex: buildBucketIndex(points),
      geometryVersion: get().geometryVersion + 1,
      _unsyncedCount: unsyncedCount,
      initialRevealDone,
    });
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('../../../services/bootDiagnostics').markBootPhase('replacepoints_after_set');
    } catch {/* ignore */}
    // v305 OTA: H3 cells is a CACHE of points (single source of truth =
    // points). On every replacePoints (hydrate, server pull, user
    // switch), rebuild cells from scratch so the two stores can never
    // disagree.
    //
    // v306 fix: DEFER bulkImport to next macro task via setTimeout(0).
    // bulkImport triggers h3-js lazy load → 32 MB ArrayBuffer alloc.
    // On cold start that collides with Mapbox's memory budget and
    // triggers iOS jetsam SIGKILL. Deferring lets cold start complete
    // (release transient cold-start memory) before h3-js init kicks in.
    // Side effect: FogLayer's first render may have empty cells; useMemo
    // will rebuild once bulkImport finishes and bumps cellVersion.
    //
    // v311 fix: bumped 0ms → 100ms. The 100ms window gives the boot-time
    // primeH3FailedFlag() AsyncStorage read time to populate the in-memory
    // gate cache before bulkImport's first getH3() check. Without this,
    // a cold-start race could miss the persisted "previously failed"
    // signal and re-trigger the same crash that set the flag.
    if (points.length > 0) {
      const snapshot = points.map((p) => ({ lat: p.lat, lng: p.lng, ts: p.ts }));
      setTimeout(() => {
        try {
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          require('../../../services/bootDiagnostics').markBootPhase('replacepoints_settimeout_fired', { n: snapshot.length });
        } catch {/* ignore */}
        const h3 = useH3VisitedStore.getState();
        h3.clear();
        try {
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          require('../../../services/bootDiagnostics').markBootPhase('replacepoints_after_h3clear');
        } catch {/* ignore */}
        h3.bulkImport(snapshot);
      }, 100);
    } else {
      // Clear synchronously when empty — no h3-js load needed.
      useH3VisitedStore.getState().clear();
    }
  },

  clearAll: () => set({
    points: [],
    _bucketIndex: null,
    geometryVersion: get().geometryVersion + 1,
    _unsyncedCount: 0,
    initialRevealDone: false,
    lastWatcherFix: null,
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

  setLastWatcherFix: (lat, lng, ts) => {
    if (!isFinite(lat) || !isFinite(lng)) return;
    const cur = get().lastWatcherFix;
    if (cur) {
      const dt = ts - cur.ts;
      // T-round: out-of-order ts (clock skew / queued events) — take
      // the new value rather than silently drop it.
      if (dt >= 0 && dt < 5_000) {
        const dLat = (lat - cur.lat) * 111_000;
        const cosLat = Math.cos((cur.lat * Math.PI) / 180);
        const dLng = (lng - cur.lng) * 111_000 * cosLat;
        const dM2 = dLat * dLat + dLng * dLng;
        if (dM2 < 25 /* 5m squared */) return;
      }
    }
    set({ lastWatcherFix: { lat, lng, ts } });
    // v326: persist to AsyncStorage. Fire-and-forget; failure non-fatal.
    persistLastFix({ lat, lng, ts });
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
    lastWatcherFix: null,
  }),
}));
