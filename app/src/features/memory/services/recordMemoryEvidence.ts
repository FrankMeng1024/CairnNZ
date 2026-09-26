import { MemoryEvidenceSource, useMemoryStore } from '../store/useMemoryStore';
import {
  ensureMemoryPersistenceForUser,
  flushMemoryNow,
  flushSyntheticMemoryNow,
  getMemoryOwnerWriteEpoch,
} from './memoryPersistence';
import { attachMemorySync } from '../../../services/memorySync';
import { appendDurableMemoryEvidence } from './memoryEvidenceJournal';

let commitTail: Promise<void> = Promise.resolve();
let evidenceMetrics = {
  calls: 0,
  mutations: 0,
  coverageMutations: 0,
  presenceMutations: 0,
  metadataMutations: 0,
  deduplicated: 0,
  batchFlushes: 0,
};

export function resetMemoryEvidenceMetrics(): void {
  evidenceMetrics = {
    calls: 0,
    mutations: 0,
    coverageMutations: 0,
    presenceMutations: 0,
    metadataMutations: 0,
    deduplicated: 0,
    batchFlushes: 0,
  };
}

export function getMemoryEvidenceMetrics(): typeof evidenceMetrics {
  return { ...evidenceMetrics };
}

/**
 * One semantic explored-place write boundary for all active producers.
 * useMemoryStore owns the spatial 12.5m dedupe. Activity evidence is already
 * one-point durable in the Activity WAL and is replayed into Memory after a
 * process death, so its full Memory snapshot is debounced. One-off producers
 * and reconciliation force a snapshot before returning unless a caller is
 * explicitly batching a journal-backed reconciliation pass.
 */
export function recordMemoryEvidence(args: {
  lat: number;
  lng: number;
  atMs?: number;
  source: MemoryEvidenceSource;
  ownerUserId?: string;
  durability?: 'immediate' | 'deferred';
  sourceActivityClientId?: string;
  sourceSegmentId?: string;
  horizontalAccuracyM?: number;
  continuityState?: 'accepted' | 'gap' | 'unknown';
  /**
   * A globally registered TaskManager callback has no hydrated React auth
   * store. This authority is valid only after backgroundLocationTask has
   * revalidated the durable Activity lease under its ownership mutex.
   */
  ownerAuthority?: 'durable_activity_lease';
}): Promise<{
  committed: boolean;
  deduplicated: boolean;
  coverageChanged: boolean;
  presenceChanged: boolean;
  metadataChanged: boolean;
}> {
  // Capture ownership at invocation, before this operation waits behind an
  // earlier commit. Reading the active user from inside commitTail allowed an
  // Account A callback to be attributed to Account B after a fast switch.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { useAppStore } = require('../../../store/useAppStore');
  const ownerUserId = String(args.ownerUserId ?? useAppStore.getState().user?.id ?? '');
  const evidenceAtMs = args.atMs ?? Date.now();
  const ownerEpochAtInvocation = getMemoryOwnerWriteEpoch(ownerUserId);
  const durableActivityLease = args.ownerAuthority === 'durable_activity_lease'
    && args.source === 'activity_real'
    && Boolean(args.ownerUserId);
  const ownerIsCurrent = () => {
    const liveOwnerId = String(useAppStore.getState().user?.id ?? '');
    return liveOwnerId ? liveOwnerId === ownerUserId : durableActivityLease;
  };
  let result = {
    committed: false,
    deduplicated: false,
    coverageChanged: false,
    presenceChanged: false,
    metadataChanged: false,
  };
  const run = commitTail.then(async () => {
    evidenceMetrics.calls += 1;
    // MemoryScreen is intentionally lazy, but explicit Activity/Cairn evidence
    // must still be durable before that screen has ever mounted.
    if (!ownerUserId) throw new Error('memory_user_required');
    if (!ownerIsCurrent()) {
      throw new Error('memory_owner_changed');
    }
    if (durableActivityLease) {
      // TaskManager may execute in a separate JS runtime. It owns only the
      // immutable evidence journal; hydrating/writing the shared AsyncStorage
      // snapshot here can race an account switch or privacy reset in the UI
      // runtime. Foreground replay projects these events into Personal Memory.
      await appendDurableMemoryEvidence({
        ownerUserId,
        lat: args.lat,
        lng: args.lng,
        atMs: evidenceAtMs,
        source: 'activity_real',
        sourceActivityClientId: args.sourceActivityClientId,
        sourceSegmentId: args.sourceSegmentId,
        horizontalAccuracyM: args.horizontalAccuracyM,
        continuityState: args.continuityState,
      });
      result = {
        committed: true,
        deduplicated: false,
        coverageChanged: false,
        presenceChanged: false,
        metadataChanged: false,
      };
      return;
    }
    await ensureMemoryPersistenceForUser(ownerUserId);
    if (!ownerIsCurrent() || getMemoryOwnerWriteEpoch(ownerUserId) !== ownerEpochAtInvocation) {
      throw new Error('memory_owner_changed');
    }
    if (args.source !== 'simulator_test') {
      await appendDurableMemoryEvidence({
        ownerUserId,
        lat: args.lat,
        lng: args.lng,
        atMs: evidenceAtMs,
        source: args.source,
        sourceActivityClientId: args.sourceActivityClientId,
        sourceSegmentId: args.sourceSegmentId,
        horizontalAccuracyM: args.horizontalAccuracyM,
        continuityState: args.continuityState,
      });
      if (!ownerIsCurrent() || getMemoryOwnerWriteEpoch(ownerUserId) !== ownerEpochAtInvocation) {
        // The immutable Account-A event is already safe and will replay into
        // A on its next hydrate. Do not project it through the process-global
        // store after Account B has taken over while the filesystem commit
        // was in flight.
        result = {
          committed: true,
          deduplicated: false,
          coverageChanged: false,
          presenceChanged: false,
          metadataChanged: false,
        };
        return;
      }
    }
    // Cloud sync requires authenticated app state. Headless durability does
    // not: the next authenticated hydrate/foreground attaches sync normally.
    if (args.source !== 'simulator_test'
      && String(useAppStore.getState().user?.id ?? '') === ownerUserId) {
      attachMemorySync(ownerUserId);
    }
    const store = useMemoryStore.getState();
    const before = args.source === 'simulator_test' ? store.testPoints.length : store.points.length;
    const mutation = store.recordPoint(args.lat, args.lng, evidenceAtMs, {
      source: args.source,
      sourceActivityClientId: args.sourceActivityClientId,
      sourceSegmentId: args.sourceSegmentId,
      horizontalAccuracyM: args.horizontalAccuracyM,
      continuityState: args.continuityState,
    });
    const afterState = useMemoryStore.getState();
    const after = args.source === 'simulator_test' ? afterState.testPoints.length : afterState.points.length;
    const coverageChanged = mutation?.coverageChanged ?? after > before;
    const presenceChanged = mutation?.presenceChanged ?? false;
    const metadataChanged = mutation?.metadataChanged ?? false;
    if (!coverageChanged && !presenceChanged && !metadataChanged) {
      evidenceMetrics.deduplicated += 1;
      result = {
        committed: true,
        deduplicated: true,
        coverageChanged: false,
        presenceChanged: false,
        metadataChanged: false,
      };
      return;
    }
    evidenceMetrics.mutations += 1;
    if (coverageChanged) evidenceMetrics.coverageMutations += 1;
    if (presenceChanged) evidenceMetrics.presenceMutations += 1;
    if (metadataChanged) evidenceMetrics.metadataMutations += 1;
    if (args.source !== 'activity_real' && args.source !== 'simulator_test' && args.durability !== 'deferred') {
      await flushMemoryNow({ coverage: coverageChanged, presence: presenceChanged || metadataChanged });
    }
    result = { committed: true, deduplicated: false, coverageChanged, presenceChanged, metadataChanged };
  });
  commitTail = run.catch(() => {});
  return run.then(() => result);
}

/** Commit one durable snapshot after a deferred, journal-backed batch. */
export function flushRecordedMemoryEvidence(): Promise<void> {
  const run = commitTail.then(async () => {
    evidenceMetrics.batchFlushes += 1;
    await flushMemoryNow();
    await flushSyntheticMemoryNow();
  });
  commitTail = run.catch(() => {});
  return run;
}
