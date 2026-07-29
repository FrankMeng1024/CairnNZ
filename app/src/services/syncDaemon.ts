/**
 * syncDaemon — v412 已 Save 未同步 hike 后台自动上传
 *
 * 触发时机:
 *   1. useAppStore.hydrate() 完成后 (冷启)
 *   2. NetInfo isConnected false → true (网络恢复)
 *   3. AppState background → active (前后台切回)
 *
 * 契约 (v412 design §0.9):
 *   - 每次触发扫 pendingSyncStore.listPending()
 *   - 逐条尝试 saveHikeAtomic (用 pending 里保存的 idempotencyKey)
 *   - 成功 → removePending + useSessionStore.markSynced
 *   - 失败 → markAttempt, 保留 pending, 等下次触发
 *   - **无自动过期**: 用户已点 Save 的数据永远不丢, 直到成功 or 用户长按放弃
 *   - Mutex: 同一时刻只允许一个 drain, 但记 pendingSignal 保证 drain 中新触发不丢
 */

import { listPending, removePending, markAttempt, updateRemoteId, type PendingHike } from './pendingSyncStore';
import { saveHikeAtomic, startSession } from './sessionService';
import { crashLogger } from './crashLogger';

let isDraining = false;
let pendingSignal = false;

/**
 * 触发一次 drain。多次并发调用只跑一次, 但记 pendingSignal 保证跑完立刻再跑。
 */
export async function drainPending(): Promise<void> {
  if (isDraining) {
    pendingSignal = true;
    return;
  }
  isDraining = true;
  try {
    do {
      pendingSignal = false;
      const list = await listPending();
      // Sprint 6 round-11 R11B4 fix: safety-sweep — sessions marked
      // syncState='pending' in-memory but with NO matching fs entry
      // are "orphan pending" from a markSynced-then-removePending
      // failure. Coerce them to 'synced' so the banner drops. Pre-fix
      // the banner stuck at N forever until app reload.
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { useSessionStore } = require('../store/useSessionStore');
        const sessions = useSessionStore.getState().sessions;
        const pendingSet = new Set(list.map(h => h.localId));
        for (const sess of sessions) {
          if (sess.syncState === 'pending' && !pendingSet.has(sess.id)) {
            // Sprint 6 round-20 R20B5: only mark synced if we have a REAL
            // remoteId. Pre-fix, `sess.remoteId || 0` silently converted
            // pending-without-remoteId cards to synced-with-remoteId=0.
            // The UI then treated them as tappable synced cards, but
            // fetchSessionDetail(0) would 404 → user sees "Route data
            // unavailable" and the local trackPoints are the only truth
            // (silent data-loss risk if trackPoints storage also lost).
            // Truthy remoteId → orphan sweep is safe (real server row).
            // Falsy remoteId → keep as pending; the pendingSyncStore
            // fs entry may have been lost, but the correct recovery is
            // to re-enqueue rather than silently succeed.
            if (sess.remoteId && typeof useSessionStore.getState().markSynced === 'function') {
              useSessionStore.getState().markSynced(sess.id, sess.remoteId);
            } else {
              // Missing remoteId + missing fs entry = orphan. Leave in
              // pending state so the banner + long-press-discard
              // affordance remain visible to the user.
              crashLogger.breadcrumb(
                `v412:orphan_pending_no_remoteid localId=${String(sess.id).slice(0, 8)}`,
              );
            }
          }
        }
      } catch (e) {
        crashLogger.breadcrumb(`v412:orphan_sweep_failed ${String(e).slice(0, 60)}`);
      }
      if (list.length === 0) return;
      crashLogger.breadcrumb(`v412:sync_drain start count=${list.length}`);
      for (const hike of list) {
        await uploadOne(hike);
      }
    } while (pendingSignal);
  } finally {
    isDraining = false;
  }
}

/**
 * 上传单条 pending。
 *
 * remoteId 为 null 的情况 (hike 开始时也离线, POST /sessions/start 从未成过):
 *   先 startSession 拿 remoteId, 再 saveHikeAtomic。startSession 失败也 markAttempt。
 *
 * 4xx (非 401) 视为客户端错误, 不删 pending 也不 markAttempt, 等下次机会 (设计保守)。
 * 5xx / 网络错误 → markAttempt, 保留 pending, 等下次。
 */
async function uploadOne(hike: PendingHike): Promise<void> {
  // Sprint 6 round-7 review R7B1 + R7B5 fix: gate on current user.
  // A pending file's userId is the user who created the hike; if a
  // different user is now signed in on this device (family device,
  // user switch, or 401-hard-logout re-login as someone else), upload
  // ing to the current JWT sends A's data to B's account. Skip
  // silently — do NOT markAttempt (which would increment forever)
  // and do NOT delete (A might sign back in and want their data).
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { useSessionStore } = require('../store/useSessionStore');
    const currentUserId = String(useSessionStore.getState().currentUserId ?? '');
    // Sprint 6 round-9 review R9B5: reject 'unknown' userId outright.
    // Pre-fix, the escape clause `hike.userId !== 'unknown'` let SAF-01
    // fallback rows upload under whoever was signed in next — cross-user
    // leak. Now: no matching userId AND no valid userId → skip. Rows
    // stay on disk waiting for a matching sign-in.
    const hikeUser = hike.userId ? String(hike.userId) : '';
    if (!hikeUser || hikeUser === 'unknown') {
      crashLogger.breadcrumb(
        `v412:sync_skip_unknown_user localId=${hike.localId.slice(0, 8)}`,
      );
      return;
    }
    if (currentUserId && hikeUser !== currentUserId) {
      crashLogger.breadcrumb(
        `v412:sync_skip_cross_user localId=${hike.localId.slice(0, 8)} hikeUser=${hikeUser} currentUser=${currentUserId}`,
      );
      return;
    }
  } catch { /* silent — session store not loaded */ }

  try {
    // 极端: hike 开始时也离线, remoteId 是 null → 先建 server row
    if (!hike.remoteId) {
      const startTime = new Date(hike.createdAt).toISOString();
      // v412 blocker 1 修: 用 pendingHike 里的 activityMode, 不再硬编码 'hiking'
      // 之前硬编码会导致 running 离线 save 后, 网络恢复时被建成 hiking session (数据破坏)
      const activityMode = hike.activityMode || 'hiking';  // fallback 兼容老磁盘数据
      const r = await startSession(activityMode, startTime);
      if (!r || typeof r !== 'number') {
        await markAttempt(hike.localId);
        crashLogger.breadcrumb(`v412:sync_start_failed localId=${hike.localId.slice(0, 8)}`);
        return;
      }
      hike.remoteId = r;
      await updateRemoteId(hike.localId, r);
    }

    const result = await saveHikeAtomic(hike.remoteId, hike.payload, hike.idempotencyKey);
    crashLogger.breadcrumb(
      `v412:sync_uploaded localId=${hike.localId.slice(0, 8)} sid=${result.session_id} replay=${!!result.idempotent_replay}`,
    );

    // Sprint 6 round-10 review R10B5 fix: mark in-memory FIRST, then
    // removePending. Pre-fix, removePending ran first — if the subsequent
    // markSynced threw (require error, store not loaded), the fs count
    // dropped to 0 but sessions[i].syncState stayed 'pending' forever
    // → banner stuck showing "N hikes pending sync" that tapping did
    // nothing (listPending empty, drain no-op). Reversed order: if
    // markSynced throws, we skip removePending → next drain retries
    // and can recover. If markSynced succeeds and removePending throws,
    // banner drops (in-memory is source of truth for the badge count
    // via Math.max), and the orphan fs entry drains on next tick.
    let memorySynced = false;
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { useSessionStore } = require('../store/useSessionStore');
      const store = useSessionStore.getState();
      if (typeof store.markSynced === 'function') {
        store.markSynced(hike.localId, result.session_id);
        memorySynced = true;
      }
    } catch (e) {
      crashLogger.breadcrumb(`v412:sync_mark_failed ${String(e).slice(0, 60)}`);
    }
    if (memorySynced) {
      await removePending(hike.localId);
    } else {
      // Best-effort: still try removePending so the fs entry doesn't
      // pile up. On next drain the memory state stays 'pending' but
      // that's cosmetic (Math.max with fsPending=0 = inMemoryPending
      // count) — user sees stale badge but data is safe.
      await removePending(hike.localId);
    }
  } catch (err: any) {
    await markAttempt(hike.localId);
    crashLogger.breadcrumb(
      `v412:sync_upload_failed localId=${hike.localId.slice(0, 8)} status=${err?.status || 'net'}`,
    );
  }
}

/**
 * 用户长按灰卡"放弃"入口调用。
 */
export async function abandonPending(localId: string): Promise<void> {
  await removePending(localId);
  crashLogger.breadcrumb(`v412:sync_abandoned localId=${localId.slice(0, 8)}`);
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { useSessionStore } = require('../store/useSessionStore');
    const store = useSessionStore.getState();
    if (typeof store.removeLocal === 'function') {
      store.removeLocal(localId);
    }
  } catch {
    /* silent */
  }
}
