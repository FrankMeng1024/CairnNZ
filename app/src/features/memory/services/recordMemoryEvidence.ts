import { useMemoryStore } from '../store/useMemoryStore';
import { ensureMemoryPersistenceForUser, flushMemoryNow } from './memoryPersistence';
import { attachMemorySync } from '../../../services/memorySync';

export type MemoryEvidenceSource = 'activity' | 'passive' | 'cairn' | 'reconciliation';

let commitTail: Promise<void> = Promise.resolve();

/**
 * One semantic explored-place write boundary for all active producers.
 * useMemoryStore owns the spatial 12.5m dedupe. A new point is flushed before
 * this promise resolves; callers may safely describe it as locally committed.
 */
export function recordMemoryEvidence(args: {
  lat: number;
  lng: number;
  atMs?: number;
  source: MemoryEvidenceSource;
  ownerUserId?: string;
}): Promise<{ committed: boolean; deduplicated: boolean }> {
  // Capture ownership at invocation, before this operation waits behind an
  // earlier commit. Reading the active user from inside commitTail allowed an
  // Account A callback to be attributed to Account B after a fast switch.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { useAppStore } = require('../../../store/useAppStore');
  const ownerUserId = String(args.ownerUserId ?? useAppStore.getState().user?.id ?? '');
  let result = { committed: false, deduplicated: false };
  const run = commitTail.then(async () => {
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
      result = { committed: true, deduplicated: true };
      return;
    }
    await flushMemoryNow();
    result = { committed: true, deduplicated: false };
  });
  commitTail = run.catch(() => {});
  return run.then(() => result);
}
