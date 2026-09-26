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
  /** Why this point exists. `simulator_test` is valid only in testPoints. */
  evidenceSource: PersonalMemoryEvidenceSource | 'simulator_test';
  /** Stable Activity identity used by the server to prove completed-Activity sharing. */
  sourceActivityClientId?: string;
  /** Canonical source segment; a recording gap starts a distinct context. */
  sourceSegmentId?: string;
  /** Accuracy captured at observation time; absent for historical rows. */
  horizontalAccuracyM?: number;
  /** Direct-observation continuity classification. */
  continuityState?: 'accepted' | 'gap' | 'unknown';
}

/**
 * Bounded time-qualified evidence, separate from exploration geometry.
 * `first*` is immutable; the latest fields may advance within the same
 * source context so a later accepted observation is not lost to spatial
 * coverage dedupe. This is not a visit counter or a reconstructed journey.
 */
export interface MemoryPresenceWitness {
  cid: string;
  firstLat: number;
  firstLng: number;
  firstObservedAtMs: number;
  lat: number;
  lng: number;
  observedAtMs: number;
  evidenceSource: 'activity_real' | 'passive_real';
  sourceActivityClientId?: string;
  sourceSegmentId?: string;
  horizontalAccuracyM: number;
  continuityState: 'accepted';
  synced?: boolean;
}

export interface MemoryMutationResult {
  accepted: boolean;
  coverageChanged: boolean;
  presenceChanged: boolean;
  metadataChanged: boolean;
}

export type PersonalMemoryEvidenceSource = 'activity_real' | 'passive_real' | 'historical_unknown';
export type MemoryEvidenceSource = PersonalMemoryEvidenceSource | 'simulator_test';

export interface MemoryEvidenceMetadata {
  source: MemoryEvidenceSource;
  sourceActivityClientId?: string;
  sourceSegmentId?: string;
  horizontalAccuracyM?: number;
  continuityState?: 'accepted' | 'gap' | 'unknown';
}

interface SyncState {
  /** Number of pushes currently in flight. > 0 means "syncing now". */
  inFlightCount: number;
  /** Unix ms of last successful push (informational; UI can show "last synced"). */
  lastSyncAt: number;
}

interface MemoryState {
  points: VisitedPoint[];
  presenceWitnesses: MemoryPresenceWitness[];
  /** Explicitly isolated QA realm. Rendered only by the labeled Debug Raw GPS
   * authority; never synchronized or shared as Personal Memory. */
  testPoints: VisitedPoint[];
  /** Spatial bucket index for fast isExplored. Internal — null = rebuild on use. */
  _bucketIndex: Map<string, VisitedPoint[]> | null;
  /** Bumped on geometry mutations. FogLayer keys its memo on this. */
  geometryVersion: number;
  /** Changes only for presence, never drives Fog geometry. */
  presenceVersion: number;
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
  _unsyncedPresenceCount: number;
  initialRevealDone: boolean;
  syncState: SyncState;
  /** Local disk/journal authority. Empty points are meaningful only at ready. */
  localHydration: {
    ownerUserId: string | null;
    status: 'detached' | 'hydrating' | 'ready' | 'blocked';
    /** True only when no valid local coverage snapshot or journal exists. */
    requiresInitialReconcile: boolean;
    initialReconcile: 'not_required' | 'pending' | 'success' | 'offline';
    revision: number;
  };

  /** Record one GPS point as visited. Idempotent. */
  recordPoint: (lat: number, lng: number, atMs?: number, metadata?: MemoryEvidenceMetadata) => MemoryMutationResult;

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

  markPresenceWitnessesSynced: (batch: MemoryPresenceWitness[], acceptedCids: string[]) => void;

  /** Replace all points (called by persistence on hydrate / by sync on download). */
  replacePoints: (points: VisitedPoint[], initialRevealDone: boolean) => void;
  /** Restore the account-bound synthetic QA realm without touching Personal Memory. */
  replaceTestPoints: (points: VisitedPoint[]) => void;
  replacePresenceWitnesses: (witnesses: MemoryPresenceWitness[]) => void;

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
export const PRESENCE_REFRESH_MS = 15_000;
export const MAX_PRESENCE_WITNESSES = 4_096;
export const MAX_ENCOUNTER_ACCURACY_M = 50;

const NO_MUTATION: MemoryMutationResult = {
  accepted: false,
  coverageChanged: false,
  presenceChanged: false,
  metadataChanged: false,
};

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

function qualifiesForPresence(metadata: MemoryEvidenceMetadata): metadata is MemoryEvidenceMetadata & {
  source: 'activity_real' | 'passive_real';
  horizontalAccuracyM: number;
  continuityState: 'accepted';
} {
  return (metadata.source === 'activity_real' || metadata.source === 'passive_real')
    && metadata.continuityState === 'accepted'
    && Number.isFinite(metadata.horizontalAccuracyM)
    && Number(metadata.horizontalAccuracyM) >= 0
    && Number(metadata.horizontalAccuracyM) <= MAX_ENCOUNTER_ACCURACY_M
    && (metadata.source !== 'activity_real'
      || (typeof metadata.sourceActivityClientId === 'string' && metadata.sourceActivityClientId.length > 0
        && typeof metadata.sourceSegmentId === 'string' && metadata.sourceSegmentId.length > 0));
}

function samePresenceContext(witness: MemoryPresenceWitness, metadata: MemoryEvidenceMetadata, ts: number): boolean {
  if (witness.evidenceSource !== metadata.source) return false;
  if (metadata.source === 'activity_real') {
    return witness.sourceActivityClientId === metadata.sourceActivityClientId
      && witness.sourceSegmentId === metadata.sourceSegmentId;
  }
  const dayMs = 24 * 60 * 60 * 1000;
  return Math.floor(witness.firstObservedAtMs / dayMs) === Math.floor(ts / dayMs);
}

function pruneSyncedPresence(witnesses: MemoryPresenceWitness[]): MemoryPresenceWitness[] {
  if (witnesses.length <= MAX_PRESENCE_WITNESSES) return witnesses;
  const overflow = witnesses.length - MAX_PRESENCE_WITNESSES;
  const removable = new Set(
    witnesses
      .filter(witness => witness.synced)
      .sort((a, b) => a.observedAtMs - b.observedAtMs)
      .slice(0, overflow)
      .map(witness => witness.cid),
  );
  return removable.size > 0 ? witnesses.filter(witness => !removable.has(witness.cid)) : witnesses;
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
  presenceWitnesses: [],
  testPoints: [],
  _bucketIndex: null,
  geometryVersion: 0,
  presenceVersion: 0,
  _unsyncedCount: 0,
  _unsyncedPresenceCount: 0,
  initialRevealDone: false,
  syncState: { inFlightCount: 0, lastSyncAt: 0 },
  localHydration: {
    ownerUserId: null,
    status: 'detached',
    requiresInitialReconcile: false,
    initialReconcile: 'not_required',
    revision: 0,
  },
  lastWatcherFix: null,

  recordPoint: (lat, lng, atMs = Date.now(), metadata = { source: 'historical_unknown' }) => {
    if (!isFinite(lat) || !isFinite(lng)) return NO_MUTATION;
    // O17 D-MEM-03: reject non-positive / non-finite timestamps at boundary.
    // Prevents negative ts (some legacy replay paths pass 0 or NaN) from
    // corrupting bucket dedupe + deterministic-cid hash.
    if (!(atMs > 0) || !Number.isFinite(atMs)) return NO_MUTATION;
    // M6 fix (v0.2.6.3): force ts to integer at the boundary so server
    // and client agree on the deterministic-cid hash input. Fractional
    // ts breaks echo lookup → infinite retry.
    const ts = Math.floor(atMs);
    const isTestEvidence = metadata.source === 'simulator_test';
    const points = isTestEvidence ? get().testPoints : get().points;
    // O1: CULL 从 slice(-32) 改成走 bucket index 全量查 (9-cell sweep).
    // 之前 32-tail scan 在长 hike 后段的邻近点 dedup 失败 → 服务器 UNIQUE
    // 拦不住 (每个 uuid 不同),同一 cell 存多份。走 bucket index O(1) 查
    // 附近所有已 recordPoint 的点,同 12.5m 内 skip。
    const idxRef = isTestEvidence ? buildBucketIndex(points) : (get()._bucketIndex ?? buildBucketIndex(points));
    const targetBuckets = computeBucketsForRadius({ lat, lng });
    let spatialDuplicate = false;
    for (const k of targetBuckets) {
      const bucketPts = idxRef.get(k);
      if (!bucketPts) continue;
      for (const p of bucketPts) {
        if (distanceSqMeters({ lat, lng }, p) >= CULL_THRESHOLD_SQ) continue;
        spatialDuplicate = true;
        break;
      }
      if (spatialDuplicate) break;
    }
    let coverageChanged = false;
    let newPoints = points;
    let newPoint: VisitedPoint | null = null;
    if (!spatialDuplicate) {
      newPoint = {
        lat,
        lng,
        ts,
        cid: uuidv4(),
        synced: false,
        evidenceSource: metadata.source,
        sourceActivityClientId: metadata.sourceActivityClientId,
        sourceSegmentId: metadata.sourceSegmentId,
        horizontalAccuracyM: metadata.horizontalAccuracyM,
        continuityState: metadata.continuityState ?? 'unknown',
      };
      newPoints = [...points, newPoint];
      coverageChanged = true;
    }
    if (isTestEvidence) {
      if (coverageChanged) set({ testPoints: newPoints });
      return { accepted: true, coverageChanged, presenceChanged: false, metadataChanged: false };
    }
    let nextPresence = get().presenceWitnesses;
    let presenceChanged = false;
    if (qualifiesForPresence(metadata)) {
      let matchIndex = -1;
      for (let index = nextPresence.length - 1; index >= 0; index -= 1) {
        const witness = nextPresence[index];
        if (!samePresenceContext(witness, metadata, ts)) continue;
        if (distanceSqMeters({ lat, lng }, witness) < CULL_THRESHOLD_SQ) {
          matchIndex = index;
          break;
        }
      }
      if (matchIndex >= 0) {
        const existing = nextPresence[matchIndex];
        if (ts > existing.observedAtMs && ts - existing.observedAtMs >= PRESENCE_REFRESH_MS) {
          nextPresence = nextPresence.map((witness, index) => index === matchIndex ? {
            ...witness,
            lat,
            lng,
            observedAtMs: ts,
            horizontalAccuracyM: Number(metadata.horizontalAccuracyM),
            synced: false,
          } : witness);
          presenceChanged = true;
        }
      } else {
        nextPresence = pruneSyncedPresence([...nextPresence, {
          cid: uuidv4(),
          firstLat: lat,
          firstLng: lng,
          firstObservedAtMs: ts,
          lat,
          lng,
          observedAtMs: ts,
          evidenceSource: metadata.source,
          sourceActivityClientId: metadata.sourceActivityClientId,
          sourceSegmentId: metadata.sourceSegmentId,
          horizontalAccuracyM: Number(metadata.horizontalAccuracyM),
          continuityState: 'accepted',
          synced: false,
        }]);
        presenceChanged = true;
      }
    }

    if (coverageChanged && newPoint) {
      // The bucket index is internal and never a render selector. Mutate this
      // derived index in place so a new explored increment does not clone every
      // historical bucket; the public points array remains immutable.
      const idx = idxRef;
      const k = bucketKey(lat, lng);
      const arr = idx.get(k);
      if (arr) arr.push(newPoint);
      else idx.set(k, [newPoint]);
      set({
        points: newPoints,
        _bucketIndex: idx,
        geometryVersion: get().geometryVersion + 1,
        _unsyncedCount: get()._unsyncedCount + 1,
        ...(presenceChanged ? {
          presenceWitnesses: nextPresence,
          presenceVersion: get().presenceVersion + 1,
          _unsyncedPresenceCount: nextPresence.reduce((count, witness) => count + (witness.synced ? 0 : 1), 0),
        } : {}),
      });
      useH3VisitedStore.getState().addPointToCells(lat, lng, ts);
    } else if (presenceChanged) {
      set({
        presenceWitnesses: nextPresence,
        presenceVersion: get().presenceVersion + 1,
        _unsyncedPresenceCount: nextPresence.reduce((count, witness) => count + (witness.synced ? 0 : 1), 0),
      });
    }
    return {
      accepted: true,
      coverageChanged,
      presenceChanged,
      metadataChanged: presenceChanged && !coverageChanged,
    };
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

  markPresenceWitnessesSynced: (batch, acceptedCids) => {
    if (batch.length === 0 || acceptedCids.length === 0) return;
    const accepted = new Set(acceptedCids);
    const sentVersion = new Map(batch.map(witness => [witness.cid, witness.observedAtMs]));
    let changed = 0;
    const witnesses = get().presenceWitnesses.map((witness) => {
      if (!accepted.has(witness.cid)
        || witness.synced
        || sentVersion.get(witness.cid) !== witness.observedAtMs) return witness;
      changed += 1;
      return { ...witness, synced: true };
    });
    if (changed === 0) return;
    const bounded = pruneSyncedPresence(witnesses);
    set({
      presenceWitnesses: bounded,
      presenceVersion: get().presenceVersion + 1,
      _unsyncedPresenceCount: bounded.reduce((count, witness) => count + (witness.synced ? 0 : 1), 0),
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

  replaceTestPoints: (points) => {
    set({
      testPoints: points,
      geometryVersion: get().geometryVersion + 1,
    });
  },

  replacePresenceWitnesses: (witnesses) => {
    const bounded = pruneSyncedPresence(witnesses
      .filter(witness => qualifiesForPresence({
        source: witness.evidenceSource,
        sourceActivityClientId: witness.sourceActivityClientId,
        sourceSegmentId: witness.sourceSegmentId,
        horizontalAccuracyM: witness.horizontalAccuracyM,
        continuityState: witness.continuityState,
      }))
      .sort((a, b) => a.firstObservedAtMs - b.firstObservedAtMs));
    set({
      presenceWitnesses: bounded,
      presenceVersion: get().presenceVersion + 1,
      _unsyncedPresenceCount: bounded.reduce((count, witness) => count + (witness.synced ? 0 : 1), 0),
    });
  },

  clearAll: () => {
    set({
      points: [],
      presenceWitnesses: [],
      testPoints: [],
      _bucketIndex: null,
      geometryVersion: get().geometryVersion + 1,
      presenceVersion: get().presenceVersion + 1,
      _unsyncedCount: 0,
      _unsyncedPresenceCount: 0,
      initialRevealDone: false,
      lastWatcherFix: null,
      // N1 fix (v0.2.6.3): reset syncState too. Otherwise a logout
      // mid-push leaves inFlightCount=1 in the store; the next user's
      // MemorySummaryCard reads "Syncing…" indefinitely.
      syncState: { inFlightCount: 0, lastSyncAt: 0 },
    });
    // O12 Round-3 R3-C2: also clear the H3 visited store so the FogLayer
    // does not keep displaying revealed cells after Reset Memory.
    // replacePoints (line 420) already does this on empty; clearAll was
    // missing the same call — the visible bug: user Resets Memory, server
    // + points cleared, but FogLayer still shows walked-through fog holes.
    useH3VisitedStore.getState().clear();
  },

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
  resetForUserSwitch: () => {
    set({
      points: [],
      presenceWitnesses: [],
      testPoints: [],
      _bucketIndex: null,
      geometryVersion: get().geometryVersion + 1,
      presenceVersion: get().presenceVersion + 1,
      _unsyncedCount: 0,
      _unsyncedPresenceCount: 0,
      initialRevealDone: false,
      syncState: { inFlightCount: 0, lastSyncAt: 0 },
      localHydration: {
        ownerUserId: null,
        status: 'detached',
        requiresInitialReconcile: false,
        initialReconcile: 'not_required',
        revision: get().localHydration.revision + 1,
      },
      lastWatcherFix: null,
    });
    // O12 Round-3 R3-C2: clear H3 fog cells too — switching user must
    // not leave the previous user's revealed cells on the map.
    useH3VisitedStore.getState().clear();
  },
}));
