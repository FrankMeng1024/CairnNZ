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
import { useMemoryStore, VisitedPoint } from '../features/memory/store/useMemoryStore';

const PUSH_DEBOUNCE_MS = 5_000;
const BACKOFF_MS = 15_000;
const MAX_BATCH = 500;
const HTTP_TIMEOUT_MS = 30_000;
const PULL_PAGE_LIMIT = 10_000;
const PULL_MAX_PAGES = 50;
const RETRY_PULL_DELAY_MS = 1_500;

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
/** Epoch token, bumped on every detach/reset. */
let epoch = 0;

/** O7 fix: persistent pull cursor so an aborted pull resumes from where it stopped. */
let pullCursor: { afterTs: number; afterCid: string } = { afterTs: 0, afterCid: '' };

interface ServerPoint {
  lat: number;
  lng: number;
  ts: number;
  cid: string;
}

interface EchoEntry {
  batch_index: number;
  ts: number;
  cid: string;
}

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

export async function pullMemoryFromServer(userId: string): Promise<void> {
  if (!userId) return;
  // v313: beacon at entry so we can see if pull even started.
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('../services/bootDiagnostics').markBootPhase('pull_memory_entry');
  } catch {/* ignore */}
  if (pullRunning || pushRunning) {
    setTimeout(() => {
      if (userId === activeUserId) void pullMemoryFromServer(userId);
    }, RETRY_PULL_DELAY_MS);
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
  try {
    for (let page = 0; page < PULL_MAX_PAGES; page++) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('../services/bootDiagnostics').markBootPhase('pull_memory_before_fetch', { page });
      } catch {/* ignore */}
      const url = `/api/memory/points?after_ts=${afterTs}&after_cid=${encodeURIComponent(afterCid)}&until=${pullStartTs}&limit=${PULL_PAGE_LIMIT}`;
      const res = await fetchWithTimeout(url, { method: 'GET' }, myCtrl);
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('../services/bootDiagnostics').markBootPhase('pull_memory_after_fetch', { page, ok: res.ok, status: res.status });
      } catch {/* ignore */}
      if (myEpoch !== epoch || myUserId !== activeUserId) { aborted = true; return; }
      if (!res.ok) { aborted = true; return; }
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
        return;
      }
      const body = await res.json();
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('../services/bootDiagnostics').markBootPhase('pull_memory_after_parse', { page, n: (body.points ?? []).length });
      } catch {/* ignore */}
      if (myEpoch !== epoch || myUserId !== activeUserId) { aborted = true; return; }
      const batch: ServerPoint[] = (body.points ?? []).filter((p: any): p is ServerPoint =>
        typeof p?.lat === 'number' && typeof p?.lng === 'number' &&
        typeof p?.ts === 'number' && typeof p?.cid === 'string'
      );
      accumulated.push(...batch);
      if (batch.length < PULL_PAGE_LIMIT) {
        // Done — full snapshot acquired. Reset cursor so next pull
        // starts fresh.
        pullCursor = { afterTs: 0, afterCid: '' };
        break;
      }
      const last = batch[batch.length - 1];
      afterTs = last.ts;
      afterCid = last.cid;
      // O7: persist cursor in case we get aborted mid-pagination.
      pullCursor = { afterTs, afterCid };
    }
  } catch {
    aborted = true;
  } finally {
    pullRunning = false;
    if (pullAbortController === myCtrl) pullAbortController = null;
    if (myEpoch === epoch && myUserId === activeUserId) {
      useMemoryStore.getState().bumpInFlight(-1);
    }
  }

  if (myEpoch !== epoch || myUserId !== activeUserId) return;

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('../services/bootDiagnostics').markBootPhase('pull_memory_pages_done', {
      total: accumulated.length,
      aborted,
    });
  } catch {/* ignore */}

  // Apply whatever pages we got — O7 partial-result rule.
  if (accumulated.length === 0) {
    // If we were aborted with NO pages, nothing to merge. Schedule a
    // retry so user data eventually loads.
    if (aborted && pullCursor.afterTs > 0) {
      setTimeout(() => { if (myUserId === activeUserId) void pullMemoryFromServer(myUserId); }, RETRY_PULL_DELAY_MS);
    }
    return;
  }

  const serverPoints: VisitedPoint[] = accumulated.map((p) => ({
    lat: p.lat, lng: p.lng, ts: p.ts, cid: p.cid, synced: true,
  }));
  const serverCidSet = new Set(serverPoints.map((p) => p.cid));
  const serverGeoTsSet = new Set(
    serverPoints.map((p) => `${p.lat.toFixed(6)}|${p.lng.toFixed(6)}|${p.ts}`)
  );
  const localPoints = useMemoryStore.getState().points;
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
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('../services/bootDiagnostics').markBootPhase('pull_memory_after_replacepoints');
  } catch {/* ignore */}

  // If we got aborted mid-pagination, schedule resume on remaining pages.
  if (aborted && pullCursor.afterTs > 0) {
    setTimeout(() => { if (myUserId === activeUserId) void pullMemoryFromServer(myUserId); }, RETRY_PULL_DELAY_MS);
  }
}

function sameContent(a: VisitedPoint[], b: VisitedPoint[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].cid !== b[i].cid) return false;
    if (a[i].synced !== b[i].synced) return false;
    if (a[i].ts !== b[i].ts) return false;
    if (a[i].lat !== b[i].lat || a[i].lng !== b[i].lng) return false;
  }
  return true;
}

async function pushPendingPoints(): Promise<void> {
  if (pushRunning || pullRunning) {
    schedulePush(PUSH_DEBOUNCE_MS);
    return;
  }
  if (!activeUserId) return;
  const now = Date.now();
  if (now < backoffUntil) {
    schedulePush(backoffUntil - now);
    return;
  }
  const myEpoch = epoch;
  const myUserId = activeUserId;
  const allPoints = useMemoryStore.getState().points;
  const pending = allPoints.filter((p) => !p.synced);
  if (pending.length === 0) return;

  const batch = pending.slice(0, MAX_BATCH);
  pushRunning = true;
  pushAbortController = new AbortController();
  const myCtrl = pushAbortController;
  useMemoryStore.getState().bumpInFlight(1);
  let serverError = false;
  try {
    const res = await fetchWithTimeout('/api/memory/points', {
      method: 'POST',
      body: JSON.stringify({
        points: batch.map((p) => p.cid ? ({ lat: p.lat, lng: p.lng, ts: p.ts, cid: p.cid })
                                       : ({ lat: p.lat, lng: p.lng, ts: p.ts })),
      }),
    }, myCtrl);
    if (myEpoch !== epoch || myUserId !== activeUserId) return;
    if (res.ok) {
      const body = await res.json().catch(() => null);
      const echo: Array<EchoEntry | null> = Array.isArray(body?.points) ? body.points : [];
      useMemoryStore.getState().applyServerEchoForPushAligned(batch, echo);
      backoffUntil = 0;
      if (pending.length > MAX_BATCH) schedulePush(0);
    } else {
      serverError = true;
    }
  } catch {
    serverError = true;
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
}

function schedulePush(delayMs = PUSH_DEBOUNCE_MS): void {
  const now = Date.now();
  const effectiveDelay = Math.max(delayMs, backoffUntil - now);
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    pushTimer = null;
    void pushPendingPoints();
  }, effectiveDelay);
}

export function attachMemorySync(userId: string): void {
  detachMemorySync();
  activeUserId = userId;
  let lastUnsyncedCount = useMemoryStore.getState()._unsyncedCount;
  unsubscribe = useMemoryStore.subscribe((s) => {
    const u = s._unsyncedCount;
    if (u > lastUnsyncedCount) schedulePush();
    lastUnsyncedCount = u;
  });
  if (useMemoryStore.getState()._unsyncedCount > 0) {
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
  if (unsubscribe) {
    unsubscribe();
    unsubscribe = null;
  }
  activeUserId = null;
  backoffUntil = 0;
  pushRunning = false;
  pullRunning = false;
  pullCursor = { afterTs: 0, afterCid: '' };
}

export async function pushMemoryNow(): Promise<void> {
  if (pushTimer) {
    clearTimeout(pushTimer);
    pushTimer = null;
  }
  await pushPendingPoints();
}

/** Force-clear memory on the server. Uses its own controller so it
 *  doesn't abort an active push/pull. */
export async function deleteAllMemoryFromServer(): Promise<boolean> {
  const ctrl = new AbortController();
  try {
    const res = await fetchWithTimeout('/api/memory/points', { method: 'DELETE' }, ctrl);
    if (res.ok) {
      useMemoryStore.getState().clearAll();
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

export function getSyncStatus(): { pendingCount: number; inFlight: boolean } {
  const s = useMemoryStore.getState();
  return {
    pendingCount: s._unsyncedCount,
    inFlight: s.syncState.inFlightCount > 0,
  };
}
