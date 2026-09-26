/**
 * memorySync — cloud sync layer.
 *
 * v0.2.6.3 O-round fixes:
 *   O2: per-op AbortControllers (push has its own; pull has its own).
 *       Push and pull no longer abort each other. detachMemorySync
 *       aborts both.
 *   O6: serverError tail (backoffUntil + schedulePush) is guarded by
 *       epoch / activeUserId so a logged-out user's failure can't
 *       pollute the next user's session.
 *   O7: aborted-mid-pagination pull preserves accumulated pages and
 *       remembers cursor; resumes on next call.
 *   O8: applyEcho pre-builds a (ts,lat,lng) map for empty-cid lookup —
 *       O(N+M) instead of O(N*M) per push.
 *   O9: pull also bumps inFlight so the chip honestly reports state.
 *   O10: skip replacePoints when the merge result is identical to
 *        current store (avoid unnecessary fog rebuild).
 */

import { authenticatedFetch } from './apiService';
import {
  MemoryPresenceWitness,
  useMemoryStore,
  VisitedPoint,
} from '../features/memory/store/useMemoryStore';
import { purgeDurableMemoryEvidence } from '../features/memory/services/memoryEvidenceJournal';
import {
  beginMemoryPersistenceReset,
  commitMemoryPersistenceReset,
  flushMemoryNow,
} from '../features/memory/services/memoryPersistence';
import { purgeFogDisplayCache } from '../features/memory/services/fogDisplayCache';
import { resetH3PersistenceForUser } from '../features/memory/services/h3Persistence';

const PUSH_DEBOUNCE_MS = 30_000;
const PUSH_MAX_WAIT_MS = 60_000;
const BACKOFF_MS = 15_000;
const MAX_BATCH = 500;
const HTTP_TIMEOUT_MS = 30_000;
const PULL_PAGE_LIMIT = 10_000;
const PULL_MAX_PAGES = 50;
const RETRY_PULL_DELAY_MS = 1_500;
const RETRY_PULL_MAX_DELAY_MS = 60_000;

let pushTimer: ReturnType<typeof setTimeout> | null = null;
/** Are we currently performing a push or pull? Serializes pushes/pulls. */
let pushRunning = false;
let pullRunning = false;
let activeUserId: string | null = null;
let backoffUntil = 0;
let unsubscribe: (() => void) | null = null;
/** O2 fix: separate controllers per op, aborted only on detach. */
let pushAbortController: AbortController | null = null;
let pullAbortController: AbortController | null = null;
let pullRetryTimer: ReturnType<typeof setTimeout> | null = null;
let pullRetryAttempt = 0;
/** Epoch token, bumped on every detach/reset. */
let epoch = 0;
let pendingBurstStartedAt: number | null = null;
let authBlocked = false;
let syncMetrics = { pushRequests: 0, pushedPoints: 0, pushedPresenceWitnesses: 0, authBlocked: false };

function currentAuthenticatedOwnerIs(userId: string): boolean {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { useAppStore } = require('../store/useAppStore');
    const state = useAppStore.getState();
    return state.isLoggedIn === true && String(state.user?.id ?? '') === userId;
  } catch {
    return false;
  }
}

function clearPullRetry(): void {
  if (pullRetryTimer) clearTimeout(pullRetryTimer);
  pullRetryTimer = null;
  pullRetryAttempt = 0;
}

function schedulePullRetry(userId: string, opts?: { reconcile?: boolean }): void {
  if (pullRetryTimer || userId !== activeUserId || !currentAuthenticatedOwnerIs(userId)) return;
  const scheduledEpoch = epoch;
  const delay = Math.min(RETRY_PULL_MAX_DELAY_MS, RETRY_PULL_DELAY_MS * (2 ** pullRetryAttempt));
  pullRetryAttempt = Math.min(pullRetryAttempt + 1, 6);
  pullRetryTimer = setTimeout(() => {
    pullRetryTimer = null;
    if (scheduledEpoch !== epoch || userId !== activeUserId || !currentAuthenticatedOwnerIs(userId)) return;
    void pullMemoryFromServer(userId, opts);
  }, delay);
}

export function resetMemorySyncMetrics(): void {
  syncMetrics = { pushRequests: 0, pushedPoints: 0, pushedPresenceWitnesses: 0, authBlocked };
}

export function getMemorySyncMetrics(): typeof syncMetrics {
  return { ...syncMetrics };
}

/** O7 fix: persistent pull cursor so an aborted pull resumes from where it stopped. */
let pullCursor: { afterTs: number; afterCid: string } = { afterTs: 0, afterCid: '' };

interface ServerPoint {
  lat: number;
  lng: number;
  ts: number;
  cid: string;
  evidence_source?: 'activity_real' | 'passive_real' | 'historical_unknown';
  source_activity_client_id?: string | null;
  source_segment_id?: string | null;
  horizontal_accuracy_m?: number | null;
  continuity_state?: 'accepted' | 'gap' | 'unknown';
}

interface EchoEntry {
  batch_index: number;
  ts: number;
  cid: string;
}

export type MemoryPushResult = {
  status: 'acknowledged' | 'nothing_to_push' | 'busy' | 'auth_required' | 'owner_mismatch' | 'backoff' | 'failed';
  acceptedPointCids: string[];
  acceptedPresenceCids: string[];
};

const emptyPushResult = (status: MemoryPushResult['status']): MemoryPushResult => ({
  status,
  acceptedPointCids: [],
  acceptedPresenceCids: [],
});

/**
 * O2 fix: separate AbortController per op. Detach is the only thing
 * that aborts both. Internal request timeouts use the same controller
 * so the timeout abort is op-scoped.
 */
async function fetchWithTimeout(
  path: string,
  init: any,
  controller: AbortController,
): Promise<Response> {
  const timer = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);
  try {
    return await authenticatedFetch(path, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export async function pullMemoryFromServer(userId: string, opts?: { reconcile?: boolean }): Promise<void> {
  if (!userId || userId !== activeUserId || !currentAuthenticatedOwnerIs(userId)) return;
  const reconcile = !!opts?.reconcile;
  // BUG-E fix (v371 post-OTA): reconcile=true forces a full server sweep
  // and treats server response as canonical truth. Without it, the
  // incremental keyset cursor (afterTs/afterCid) means once a client has
  // pulled past a point, server-side deletes (e.g. Sprint 67 Story-526
  // 9163 cleanup) are NEVER reflected — pullMemoryFromServer's append-only
  // model means stale local points persist forever. reconcile=true resets
  // the cursor to (0, '') and after a successful full sweep replaces the
  // local store with serverPoints only (no localOnly merge).
  if (reconcile) {
    pullCursor = { afterTs: 0, afterCid: '' };
  }
  // v313: beacon at entry so we can see if pull even started.
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('../services/bootDiagnostics').markBootPhase('pull_memory_entry', { reconcile });
  } catch {/* ignore */}
  if (pullRunning || pushRunning) {
    schedulePullRetry(userId, opts);
    return;
  }
  pullRunning = true;
  pullAbortController = new AbortController();
  const myCtrl = pullAbortController;
  const myEpoch = epoch;
  const myUserId = userId;
  // O9: bump inFlight so the chip honestly says "Syncing…" during pull.
  useMemoryStore.getState().bumpInFlight(1);
  let pullStartTs = Date.now();
  let { afterTs, afterCid } = pullCursor;
  const accumulated: ServerPoint[] = [];
  let aborted = false;
  let completeSnapshot = false;
  let retryableFailure = false;
  let authFailure = false;
  try {
    for (let page = 0; page < PULL_MAX_PAGES; page++) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('../services/bootDiagnostics').markBootPhase('pull_memory_before_fetch', { page });
      } catch {/* ignore */}
      const url = `/api/memory/points?after_ts=${afterTs}&after_cid=${encodeURIComponent(afterCid)}&until=${pullStartTs}&limit=${PULL_PAGE_LIMIT}`;
      const res = await fetchWithTimeout(url, {
        method: 'GET',
        expectedUserId: myUserId,
      }, myCtrl);
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('../services/bootDiagnostics').markBootPhase('pull_memory_after_fetch', { page, ok: res.ok, status: res.status });
      } catch {/* ignore */}
      if (myEpoch !== epoch || myUserId !== activeUserId || !currentAuthenticatedOwnerIs(myUserId)) {
        aborted = true;
        return;
      }
      if (!res.ok) {
        aborted = true;
        authFailure = res.status === 401 || res.status === 403;
        retryableFailure = res.status === 408 || res.status === 425 || res.status === 429 || res.status >= 500;
        break;
      }
      // v314 fix: guard against MB-sized response bodies. res.json() on
      // a huge body sync-blocks the main thread in Hermes (no streaming),
      // matching the 9s watchdog SIGKILL pattern observed in v312/v313
      // server beacons. If Content-Length exceeds threshold, abort the
      // pull rather than freeze the app.
      const contentLengthHeader = res.headers.get('content-length');
      const contentLength = contentLengthHeader ? parseInt(contentLengthHeader, 10) : 0;
      const MAX_RESPONSE_BYTES = 500_000;  // 500 KB (v320: tightened from 2MB; Subagent F confirmed 500KB-2MB Hermes JSON.parse can sync-freeze 1-3s)
      if (contentLength > MAX_RESPONSE_BYTES) {
        try {
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          require('../services/bootDiagnostics').markBootPhase('pull_memory_too_large', {
            page,
            content_length: contentLength,
            limit: MAX_RESPONSE_BYTES,
          });
        } catch {/* ignore */}
        aborted = true;
        retryableFailure = true;
        break;
      }
      const body = await res.json();
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('../services/bootDiagnostics').markBootPhase('pull_memory_after_parse', { page, n: (body.points ?? []).length });
      } catch {/* ignore */}
      if (myEpoch !== epoch || myUserId !== activeUserId || !currentAuthenticatedOwnerIs(myUserId)) {
        aborted = true;
        return;
      }
      const rawBatch = body?.points;
      const validBatch = Array.isArray(rawBatch) && rawBatch.every((p: any) =>
        typeof p?.lat === 'number' && Number.isFinite(p.lat)
        && typeof p?.lng === 'number' && Number.isFinite(p.lng)
        && typeof p?.ts === 'number' && Number.isFinite(p.ts)
        && typeof p?.cid === 'string' && p.cid.length > 0
      );
      if (!validBatch) {
        aborted = true;
        retryableFailure = true;
        break;
      }
      const batch = rawBatch as ServerPoint[];
      accumulated.push(...batch);
      if (batch.length < PULL_PAGE_LIMIT) {
        // Done — full snapshot acquired. Reset cursor so next pull
        // starts fresh.
        pullCursor = { afterTs: 0, afterCid: '' };
        completeSnapshot = true;
        break;
      }
      const last = batch[batch.length - 1];
      afterTs = last.ts;
      afterCid = last.cid;
      // O7: persist cursor in case we get aborted mid-pagination.
      pullCursor = { afterTs, afterCid };
    }
    if (!completeSnapshot) aborted = true;
  } catch {
    aborted = true;
    retryableFailure = true;
  } finally {
    pullRunning = false;
    if (pullAbortController === myCtrl) pullAbortController = null;
    if (myEpoch === epoch && myUserId === activeUserId) {
      useMemoryStore.getState().bumpInFlight(-1);
    }
  }

  if (myEpoch !== epoch || myUserId !== activeUserId || !currentAuthenticatedOwnerIs(myUserId)) return;

  const publishInitialReconcile = async (outcome: 'success' | 'offline') => {
    if (!reconcile || myEpoch !== epoch || myUserId !== activeUserId) return false;
    try {
      // Lazy access avoids making persistence initialization part of the
      // Memory transport module graph.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      return await require('../features/memory/services/memoryPersistence')
        .publishInitialMemoryReconcile(myUserId, outcome);
    } catch { return false; /* hydration may have detached at this exact boundary */ }
  };

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('../services/bootDiagnostics').markBootPhase('pull_memory_pages_done', {
      total: accumulated.length,
      aborted,
    });
  } catch {/* ignore */}

  // Apply whatever pages we got — O7 partial-result rule.
  if (accumulated.length === 0) {
    // BUG-E fix: in reconcile mode, an empty server result means
    // "server canonically has zero synced points". Drop stale synced cache
    // rows while retaining only genuinely unsynced local evidence so an
    // offline Activity is not erased before its first upload. The supported
    // account reset aborts pending work and clearAll()s locally, so reset
    // points cannot be resurrected through this branch.
    if (reconcile && !aborted) {
      const localUnsynced = useMemoryStore.getState().points.filter((point) => !point.synced);
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('./appLog').log('o41.pull_memory_reconcile_server_empty', {
          local_n: useMemoryStore.getState().points.length,
          unsynced_n: localUnsynced.length,
        });
      } catch {/* ignore */}
      useMemoryStore.getState().replacePoints(localUnsynced, useMemoryStore.getState().initialRevealDone);
      clearPullRetry();
      await publishInitialReconcile('success');
      return;
    }
    // If we were aborted with NO pages, nothing to merge. Schedule a
    // retry so user data eventually loads.
    if (aborted) {
      await publishInitialReconcile('offline');
      if (authFailure) {
        authBlocked = true;
        syncMetrics.authBlocked = true;
      } else if (retryableFailure) {
        schedulePullRetry(myUserId, opts);
      }
    }
    return;
  }

  const serverPoints: VisitedPoint[] = accumulated.map((p) => ({
    lat: p.lat, lng: p.lng, ts: p.ts, cid: p.cid, synced: true,
    evidenceSource: p.evidence_source === 'activity_real' || p.evidence_source === 'passive_real'
      ? p.evidence_source
      : 'historical_unknown',
    sourceActivityClientId: p.source_activity_client_id ?? undefined,
    sourceSegmentId: p.source_segment_id ?? undefined,
    horizontalAccuracyM: typeof p.horizontal_accuracy_m === 'number' ? p.horizontal_accuracy_m : undefined,
    continuityState: p.continuity_state ?? 'unknown',
  }));
  const serverCidSet = new Set(serverPoints.map((p) => p.cid));
  const serverGeoTsSet = new Set(
    serverPoints.map((p) => `${p.lat.toFixed(6)}|${p.lng.toFixed(6)}|${p.ts}`)
  );
  const localPoints = useMemoryStore.getState().points;

  // BUG-E fix: reconcile mode treats server as truth — no localOnly merge.
  // Server-side delete is honored. Cursor was reset to (0,0) so this is
  // a full sweep; if we got here with accumulated.length > 0 it's complete
  // (or partially aborted, in which case we'd have hit the empty short-
  // circuit above with reconcile && aborted; that path returns without
  // wiping to avoid losing local on a transient network error).
  if (reconcile) {
    if (aborted) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('./appLog').log('v371.pull_memory_reconcile_aborted', {
          accumulated_n: accumulated.length, local_n: localPoints.length,
        });
      } catch {/* ignore */}
      // Aborted reconcile: don't wipe; skip this run, leave local intact and
      // retry even when the first failed page left the cursor at zero.
      await publishInitialReconcile('offline');
      if (authFailure) {
        authBlocked = true;
        syncMetrics.authBlocked = true;
      } else if (retryableFailure) {
        schedulePullRetry(myUserId, opts);
      }
      return;
    }
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('./appLog').log('v371.pull_memory_reconcile_replace', {
        server_n: serverPoints.length, local_n: localPoints.length,
      });
    } catch {/* ignore */}
    serverPoints.sort((a, b) => a.ts - b.ts);
    // v399 fix: preserve unsynced local points (synced=false). These are
    // freshly-planted points that haven't been pushed to server yet — if
    // we drop them during reconcile, plant-unlock fog hole disappears 3
    // sec after plant (aliyun fog.shape_built logs confirmed this race).
    const localUnsynced = localPoints.filter((p) => !p.synced);
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('./appLog').log('v399.reconcile_keep_unsynced', {
        unsynced_n: localUnsynced.length,
      });
    } catch {/* ignore */}
    const merged = [...serverPoints, ...localUnsynced].sort((a, b) => a.ts - b.ts);
    useMemoryStore.getState().replacePoints(merged, useMemoryStore.getState().initialRevealDone);
    clearPullRetry();
    await publishInitialReconcile('success');
    return;
  }

  const localOnly = localPoints.filter((p) => {
    if (p.cid && serverCidSet.has(p.cid)) return false;
    if (!p.cid) {
      const geoKey = `${p.lat.toFixed(6)}|${p.lng.toFixed(6)}|${p.ts}`;
      if (serverGeoTsSet.has(geoKey)) return false;
    }
    return true;
  });
  const seen = new Set<string>();
  const merged = [...serverPoints, ...localOnly].filter((p) => {
    const key = p.cid || `${p.lat.toFixed(6)}|${p.lng.toFixed(6)}|${p.ts}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  merged.sort((a, b) => a.ts - b.ts);

  // O10: skip replacePoints if merge is identical to current state
  // — avoids unnecessary fog/cairn rebuild on no-op pulls.
  if (sameContent(merged, localPoints)) {
    clearPullRetry();
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('./appLog').log('v338.pull_memory_skip_same_content', {
        accumulated_n: accumulated.length,
        local_n: localPoints.length,
        merged_n: merged.length,
      });
    } catch { /* ignore */ }
    return;
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('./appLog').log('v338.pull_memory_before_replacepoints', {
      accumulated_n: accumulated.length,
      local_n: localPoints.length,
      merged_n: merged.length,
    });
  } catch { /* ignore */ }
  useMemoryStore.getState().replacePoints(merged, useMemoryStore.getState().initialRevealDone);
  if (!aborted) clearPullRetry();
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('../services/bootDiagnostics').markBootPhase('pull_memory_after_replacepoints');
  } catch {/* ignore */}

  // If we got aborted mid-pagination, schedule resume on remaining pages.
  if (aborted && authFailure) {
    authBlocked = true;
    syncMetrics.authBlocked = true;
  } else if (aborted && retryableFailure && pullCursor.afterTs > 0) {
    schedulePullRetry(myUserId);
  }
}

function sameContent(a: VisitedPoint[], b: VisitedPoint[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].cid !== b[i].cid) return false;
    if (a[i].synced !== b[i].synced) return false;
    if (a[i].ts !== b[i].ts) return false;
    if (a[i].lat !== b[i].lat || a[i].lng !== b[i].lng) return false;
    if (a[i].evidenceSource !== b[i].evidenceSource) return false;
    if (a[i].sourceActivityClientId !== b[i].sourceActivityClientId) return false;
    if (a[i].sourceSegmentId !== b[i].sourceSegmentId) return false;
    if (a[i].horizontalAccuracyM !== b[i].horizontalAccuracyM) return false;
    if (a[i].continuityState !== b[i].continuityState) return false;
  }
  return true;
}

async function pushPendingPoints(options?: { sourceActivityClientId?: string }): Promise<MemoryPushResult> {
  if (authBlocked) return emptyPushResult('auth_required');
  if (pushRunning || pullRunning) {
    schedulePush(PUSH_DEBOUNCE_MS);
    return emptyPushResult('busy');
  }
  if (!activeUserId || !currentAuthenticatedOwnerIs(activeUserId)) {
    return emptyPushResult('owner_mismatch');
  }
  // v407 fix #2: 若未登录(pre-warm 阶段 hydrate 已 attach 但用户还没登录),
  // 不推。避免 401 → apiService 走 auto-logout → 清刚 pre-warm 的 sessions/markers。
  // subscriber 依然订阅,用户登录后 next unsynced count 变化会 re-trigger push。
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { useAppStore } = require('../store/useAppStore');
    if (!useAppStore.getState().isLoggedIn) {
      // Reschedule for after login flip — subscriber will pick it up naturally.
      return emptyPushResult('auth_required');
    }
  } catch { /* module cycle safety */ }
  const now = Date.now();
  if (now < backoffUntil) {
    schedulePush(backoffUntil - now);
    return emptyPushResult('backoff');
  }
  const myEpoch = epoch;
  const myUserId = activeUserId;
  const memoryState = useMemoryStore.getState();
  const allPoints = memoryState.points;
  const sourceActivityClientId = options?.sourceActivityClientId;
  const pending = allPoints.filter((p) => !p.synced
    && (!sourceActivityClientId || p.sourceActivityClientId === sourceActivityClientId));
  const pendingPresence = (memoryState.presenceWitnesses ?? []).filter((witness) => !witness.synced
    && (!sourceActivityClientId || witness.sourceActivityClientId === sourceActivityClientId));
  if (pending.length === 0 && pendingPresence.length === 0) {
    pendingBurstStartedAt = null;
    return emptyPushResult('nothing_to_push');
  }

  const batch = pending.slice(0, MAX_BATCH);
  const presenceBatch: MemoryPresenceWitness[] = pendingPresence.slice(0, MAX_BATCH);
  pushRunning = true;
  pushAbortController = new AbortController();
  const myCtrl = pushAbortController;
  useMemoryStore.getState().bumpInFlight(1);
  let serverError = false;
  let result = emptyPushResult('failed');
  try {
    syncMetrics.pushRequests += 1;
    syncMetrics.pushedPoints += batch.length;
    syncMetrics.pushedPresenceWitnesses += presenceBatch.length;
    const res = await fetchWithTimeout('/api/memory/points', {
      method: 'POST',
      expectedUserId: myUserId,
      body: JSON.stringify({
        points: batch.map((p) => ({
          lat: p.lat,
          lng: p.lng,
          ts: p.ts,
          ...(p.cid ? { cid: p.cid } : {}),
          evidence_source: p.evidenceSource,
          source_activity_client_id: p.sourceActivityClientId,
          source_segment_id: p.sourceSegmentId,
          horizontal_accuracy_m: p.horizontalAccuracyM,
          continuity_state: p.continuityState,
        })),
        presence_witnesses: presenceBatch.map((witness) => ({
          cid: witness.cid,
          first_lat: witness.firstLat,
          first_lng: witness.firstLng,
          first_observed_at_ms: witness.firstObservedAtMs,
          lat: witness.lat,
          lng: witness.lng,
          observed_at_ms: witness.observedAtMs,
          evidence_source: witness.evidenceSource,
          source_activity_client_id: witness.sourceActivityClientId,
          source_segment_id: witness.sourceSegmentId,
          horizontal_accuracy_m: witness.horizontalAccuracyM,
          continuity_state: witness.continuityState,
        })),
      }),
    }, myCtrl);
    if (myEpoch !== epoch || myUserId !== activeUserId || !currentAuthenticatedOwnerIs(myUserId)) {
      return emptyPushResult('owner_mismatch');
    }
    if (res.ok) {
      const body = await res.json().catch(() => null);
      if (myEpoch !== epoch || myUserId !== activeUserId || !currentAuthenticatedOwnerIs(myUserId)) {
        return emptyPushResult('owner_mismatch');
      }
      const rawEcho = body?.points;
      const echoShapeValid = Array.isArray(rawEcho)
        && rawEcho.length === batch.length
        && rawEcho.every((entry: any, index: number) => entry === null || (
          Number.isInteger(entry?.batch_index)
          && entry.batch_index === index
          && Number(entry.ts) === batch[index].ts
          && typeof entry.cid === 'string'
          && entry.cid.length > 0
        ));
      const echo: Array<EchoEntry | null> = echoShapeValid ? rawEcho : [];
      useMemoryStore.getState().applyServerEchoForPushAligned(batch, echo);
      const acceptedPointCids = echo
        .map(entry => String(entry?.cid ?? ''))
        .filter(Boolean);
      const sentPresenceCids = new Set(presenceBatch.map(entry => entry.cid));
      const rawPresenceEcho = body?.presence_witnesses;
      const presenceEchoShapeValid = Array.isArray(rawPresenceEcho)
        && rawPresenceEcho.every((entry: any) => (
          typeof entry?.cid === 'string'
          && sentPresenceCids.has(entry.cid)
          && Number.isFinite(Number(entry.observed_at_ms))
        ));
      const acceptedPresenceCids = presenceEchoShapeValid
        ? [...new Set(rawPresenceEcho.map((entry: any) => String(entry.cid)))]
        : [];
      useMemoryStore.getState().markPresenceWitnessesSynced(presenceBatch, acceptedPresenceCids);
      const completeEcho = echoShapeValid
        && presenceEchoShapeValid
        && acceptedPointCids.length === batch.length
        && acceptedPresenceCids.length === presenceBatch.length;
      if (completeEcho) {
        result = { status: 'acknowledged', acceptedPointCids, acceptedPresenceCids };
        backoffUntil = 0;
        const hasMore = pending.length > MAX_BATCH || pendingPresence.length > MAX_BATCH;
        pendingBurstStartedAt = hasMore ? Date.now() : null;
        if (hasMore) schedulePush(0);
      } else {
        // A 2xx is not durability proof when even one submitted record is
        // absent from the server echo. Keep every unacknowledged item queued.
        serverError = true;
        result = emptyPushResult('failed');
      }
    } else if (res.status === 401) {
      // A final 401 after authenticatedFetch's own refresh path is not a
      // transient network error. Preserve local evidence and wait for a real
      // authentication transition instead of waking the radio every 15s.
      authBlocked = true;
      syncMetrics.authBlocked = true;
      pendingBurstStartedAt = null;
      result = emptyPushResult('auth_required');
    } else {
      serverError = true;
      result = emptyPushResult('failed');
    }
  } catch {
    serverError = true;
    result = emptyPushResult('failed');
  } finally {
    pushRunning = false;
    if (pushAbortController === myCtrl) pushAbortController = null;
    if (myEpoch === epoch && myUserId === activeUserId) {
      useMemoryStore.getState().bumpInFlight(-1);
    }
  }
  // O6 fix: epoch-guard the serverError tail. Don't pollute a new
  // user's session with a logged-out user's failure backoff.
  if (serverError && myEpoch === epoch && myUserId === activeUserId) {
    backoffUntil = Date.now() + BACKOFF_MS;
    schedulePush(BACKOFF_MS);
  }
  return result;
}

function schedulePush(delayMs = PUSH_DEBOUNCE_MS): void {
  if (authBlocked) return;
  const now = Date.now();
  if (pendingBurstStartedAt === null) pendingBurstStartedAt = now;
  const maxWaitRemaining = Math.max(0, pendingBurstStartedAt + PUSH_MAX_WAIT_MS - now);
  const effectiveDelay = Math.max(
    Math.min(Math.max(0, delayMs), maxWaitRemaining),
    backoffUntil - now,
  );
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    pushTimer = null;
    void pushPendingPoints();
  }, effectiveDelay);
}

export function attachMemorySync(userId: string): void {
  // v407 fix #1: idempotent attach — 若已 attach 到相同 userId 且 subscriber
  // 活着,跳过 detach+re-subscribe。避免 hydrate(pre-warm) + FGUM(Memory tab)
  // + AuthScreen 二次 hydrate 三处都调 attachMemorySync 时反复 detach
  // abort in-flight push,memory_points 丢批次(下个 bounded debounce 后重推)。
  if (activeUserId === userId && unsubscribe) {
    require('./appLog').log('memory_sync.attach_skip', { userId, reason: 'same-user-already-attached' });
    return;
  }
  const fromEpoch = epoch;
  detachMemorySync();
  require('./appLog').log('memory_sync.attach_epoch_bump', {
    userId, from: fromEpoch, to: epoch, prev_active: activeUserId,
  });
  activeUserId = userId;
  authBlocked = false;
  syncMetrics.authBlocked = false;
  let lastUnsyncedCount = useMemoryStore.getState()._unsyncedCount
    + (useMemoryStore.getState()._unsyncedPresenceCount ?? 0);
  unsubscribe = useMemoryStore.subscribe((s) => {
    const u = s._unsyncedCount + (s._unsyncedPresenceCount ?? 0);
    if (u > lastUnsyncedCount) schedulePush();
    lastUnsyncedCount = u;
  });
  if (useMemoryStore.getState()._unsyncedCount + (useMemoryStore.getState()._unsyncedPresenceCount ?? 0) > 0) {
    schedulePush(PUSH_DEBOUNCE_MS);
  }
}

export function detachMemorySync(): void {
  epoch++;
  if (pushAbortController) {
    try { pushAbortController.abort(); } catch { /* noop */ }
    pushAbortController = null;
  }
  if (pullAbortController) {
    try { pullAbortController.abort(); } catch { /* noop */ }
    pullAbortController = null;
  }
  if (pushTimer) {
    clearTimeout(pushTimer);
    pushTimer = null;
  }
  clearPullRetry();
  if (unsubscribe) {
    unsubscribe();
    unsubscribe = null;
  }
  activeUserId = null;
  authBlocked = false;
  syncMetrics.authBlocked = false;
  backoffUntil = 0;
  pendingBurstStartedAt = null;
  pushRunning = false;
  pullRunning = false;
  pullCursor = { afterTs: 0, afterCid: '' };
}

export async function pushMemoryNow(): Promise<MemoryPushResult> {
  if (pushTimer) {
    clearTimeout(pushTimer);
    pushTimer = null;
  }
  return pushPendingPoints();
}

/**
 * Flush and prove Memory evidence for one immutable Activity identity. This
 * bypasses unrelated older batches but still requires the normal authenticated
 * endpoint's exact echo. Public discovery cannot treat a busy, auth, backoff,
 * partial, or HTTP outcome as acknowledgement.
 */
export async function pushMemoryForActivityNow(input: {
  ownerUserId: string;
  sourceActivityClientId: string;
}): Promise<{ acknowledged: boolean; reason: MemoryPushResult['status'] | 'missing_evidence' | 'partial' }> {
  if (!input.ownerUserId || activeUserId !== input.ownerUserId) {
    return { acknowledged: false, reason: 'owner_mismatch' };
  }
  const matchesActivity = (value: { sourceActivityClientId?: string }) => (
    value.sourceActivityClientId === input.sourceActivityClientId
  );
  const evidence = () => {
    const state = useMemoryStore.getState();
    const points = state.points.filter(matchesActivity);
    const presence = (state.presenceWitnesses ?? []).filter(matchesActivity);
    return {
      total: points.length + presence.length,
      unsynced: points.filter(point => !point.synced).length
        + presence.filter(witness => !witness.synced).length,
    };
  };
  let current = evidence();
  if (current.total === 0) return { acknowledged: false, reason: 'missing_evidence' };
  if (current.unsynced === 0) return { acknowledged: true, reason: 'nothing_to_push' };

  for (let batchIndex = 0; batchIndex < 50 && current.unsynced > 0; batchIndex += 1) {
    const before = current.unsynced;
    const pushed = await pushPendingPoints({ sourceActivityClientId: input.sourceActivityClientId });
    if (pushed.status !== 'acknowledged' && pushed.status !== 'nothing_to_push') {
      return { acknowledged: false, reason: pushed.status };
    }
    current = evidence();
    if (current.unsynced >= before) return { acknowledged: false, reason: 'partial' };
  }
  return current.unsynced === 0
    ? { acknowledged: true, reason: 'acknowledged' }
    : { acknowledged: false, reason: 'partial' };
}

/** Resume a 401-paused Memory outbox only after authentication is known good. */
export function notifyMemoryAuthRefreshed(userId: string): void {
  if (!userId || userId !== activeUserId || !authBlocked) return;
  authBlocked = false;
  syncMetrics.authBlocked = false;
  backoffUntil = 0;
  if (useMemoryStore.getState()._unsyncedCount + (useMemoryStore.getState()._unsyncedPresenceCount ?? 0) > 0) schedulePush(0);
  const hydration = useMemoryStore.getState().localHydration;
  if (hydration?.ownerUserId === userId
    && hydration.requiresInitialReconcile
    && hydration.initialReconcile !== 'success') {
    schedulePullRetry(userId, { reconcile: true });
  }
}

/** Force-clear memory on the server.
 *
 * O12 fix (subagent audit C-N2 + Round-2 N2-C1): pre-fix, an in-flight
 * OR pending-scheduled push could re-upload a batch AFTER the DELETE
 * landed server-side, re-populating the exact points the user just
 * asked to erase. Now we:
 *   1. bump `epoch` so any push/pull already running will discard its
 *      result at its next epoch check.
 *   2. clear `pushTimer` so the debounced push cannot fire between
 *      our epoch bump and the DELETE (Round-2 N2-C1: first fix only
 *      caught in-flight aborts, missed scheduled timer).
 *   3. abort the in-flight push + pull controllers immediately so their
 *      HTTP requests don't complete the round-trip.
 *   4. THEN issue the DELETE.
 *   5. clearAll() locally on success.
 * The DELETE still uses its own controller — the abort above only stops
 * the earlier operations, not this new one.
 */
export async function deleteAllMemoryFromServer(expectedUserId: string): Promise<boolean> {
  if (!expectedUserId
    || activeUserId !== expectedUserId
    || !currentAuthenticatedOwnerIs(expectedUserId)) return false;
  // (1) invalidate any in-flight push/pull results
  epoch += 1;
  const deleteEpoch = epoch;
  const persistenceResetEpoch = beginMemoryPersistenceReset(expectedUserId);
  clearPullRetry();
  // (2) cancel any debounced push scheduled to fire imminently
  if (pushTimer) {
    clearTimeout(pushTimer);
    pushTimer = null;
  }
  // (3) abort push/pull if running — safe if already null
  if (pushAbortController) {
    try { pushAbortController.abort(); } catch { /* noop */ }
    pushAbortController = null;
  }
  if (pullAbortController) {
    try { pullAbortController.abort(); } catch { /* noop */ }
    pullAbortController = null;
  }
  // (4) issue the DELETE
  const ctrl = new AbortController();
  try {
    const res = await fetchWithTimeout('/api/memory/points', {
      method: 'DELETE',
      expectedUserId,
    }, ctrl);
    // The response belongs to the initiating account only. A detach/attach or
    // account switch must never clear the process-global store hydrated for a
    // newer owner.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const appState = require('../store/useAppStore').useAppStore.getState();
    const liveOwnerId = appState.isLoggedIn && appState.user?.id
      ? String(appState.user.id)
      : null;
    if (res.ok
      && deleteEpoch === epoch
      && activeUserId === expectedUserId
      && liveOwnerId === expectedUserId) {
      // (5) Fence the independent headless evidence journal before clearing
      // the mounted projection. Otherwise the next hydrate would replay the
      // just-deleted route and could upload it again.
      try {
        await purgeDurableMemoryEvidence(expectedUserId);
        await purgeFogDisplayCache(expectedUserId, { permanent: false });
        await resetH3PersistenceForUser(expectedUserId);
      } catch {
        // Privacy completion is fail-closed. Do not clear the visible/durable
        // snapshot while an independent precise-evidence store may remain.
        await flushMemoryNow().catch(() => undefined);
        schedulePush(0);
        return false;
      }
      const ownerAfterPurge = require('../store/useAppStore').useAppStore.getState().user?.id;
      if (deleteEpoch !== epoch
        || activeUserId !== expectedUserId
        || String(ownerAfterPurge ?? '') !== expectedUserId) return false;
      try {
        await commitMemoryPersistenceReset(expectedUserId, persistenceResetEpoch);
      } catch {
        return false;
      }
      return true;
    }
    await flushMemoryNow().catch(() => undefined);
    schedulePush(0);
    return false;
  } catch {
    await flushMemoryNow().catch(() => undefined);
    schedulePush(0);
    return false;
  }
}

// O1: getSyncStatus() removed — 0 external callers.
