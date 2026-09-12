import { useMemoryStore } from '../store/useMemoryStore';
import { ensureMemoryPersistenceForUser, flushMemoryNow } from './memoryPersistence';
import { attachMemorySync } from '../../../services/memorySync';

export type MemoryEvidenceSource = 'activity' | 'passive' | 'cairn' | 'reconciliation';

let commitTail: Promise<void> = Promise.resolve();
let evidenceMetrics = { calls: 0, mutations: 0, deduplicated: 0, batchFlushes: 0 };

export function resetMemoryEvidenceMetrics(): void {
  evidenceMetrics = { calls: 0, mutations: 0, deduplicated: 0, batchFlushes: 0 };
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
}): Promise<{ committed: boolean; deduplicated: boolean }> {
  // Capture ownership at invocation, before this operation waits behind an
  // earlier commit. Reading the active user from inside commitTail allowed an
  // Account A callback to be attributed to Account B after a fast switch.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { useAppStore } = require('../../../store/useAppStore');
  const ownerUserId = String(args.ownerUserId ?? useAppStore.getState().user?.id ?? '');
  let result = { committed: false, deduplicated: false };
  const run = commitTail.then(async () => {
    evidenceMetrics.calls += 1;
    // MemoryScreen is intentionally lazy, but explicit Activity/Cairn evidence
    // must still be durable before that screen has ever mounted.
    if (!ownerUserId) throw new Error('memory_user_required');
    if (String(useAppStore.getState().user?.id ?? '') !== ownerUserId) {
      throw new Error('memory_owner_changed');
    }
    await ensureMemoryPersistenceForUser(ownerUserId);
    if (String(useAppStore.getState().user?.id ?? '') !== ownerUserId) {
      throw new Error('memory_owner_changed');
    }
    attachMemorySync(ownerUserId);
    const store = useMemoryStore.getState();
    const before = store.points.length;
    store.recordPoint(args.lat, args.lng, args.atMs ?? Date.now());
    const after = useMemoryStore.getState().points.length;
    if (after === before) {
      evidenceMetrics.deduplicated += 1;
      result = { committed: true, deduplicated: true };
      return;
    }
    evidenceMetrics.mutations += 1;
    if (args.source !== 'activity' && args.durability !== 'deferred') await flushMemoryNow();
    result = { committed: true, deduplicated: false };
  });
  commitTail = run.catch(() => {});
  return run.then(() => result);
}

/** Commit one durable snapshot after a deferred, journal-backed batch. */
export function flushRecordedMemoryEvidence(): Promise<void> {
  const run = commitTail.then(() => {
    evidenceMetrics.batchFlushes += 1;
    return flushMemoryNow();
  });
  commitTail = run.catch(() => {});
  return run;
}
