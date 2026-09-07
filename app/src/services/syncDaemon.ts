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

import { listPending, removePending, markAttempt, updateRemoteId, resetForResync, type PendingHike } from './pendingSyncStore';
import { deleteRemoteSession, deleteRemoteSessionByClientId, saveHikeAtomic, startSessionResolved } from './sessionService';
import { authenticatedFetch } from './apiService';
import { listMarkerTombstones } from './markerTombstones';
import { crashLogger } from './crashLogger';
import {
  acknowledgeActivity,
  completeActivity,
  getActivityRegistry,
  isActivityTombstoned,
  removeAcknowledgedActivity,
  updateCompletedActivitySyncState,
} from '../features/activity/activityRegistry';
import { deleteAcknowledgedHikeTrackArtifacts } from './hikeTrackWriter';
import { removeLocalTrackPoints } from '../store/useSessionStore';

let isDraining = false;
let pendingSignal = false;

function isCurrentActivityOwner(userId: string): boolean {
  if (!userId || userId === 'unknown' || userId === 'guest') return false;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { useSessionStore } = require('../store/useSessionStore');
    return String(useSessionStore.getState().currentUserId ?? '') === String(userId);
  } catch {
    return false;
  }
}

/**
 * 触发一次 drain。多次并发调用只跑一次, 但记 pendingSignal 保证跑完立刻再跑。
 *
 * O21 HOME-SYNC-UX fix: 支持 onProgress 回调 + 返回统计结果, 让 UI 层
 * 能显示 "Syncing N/M..." 并在完成时区分 succeeded/failed/skipped。
 * 老 fire-and-forget 调用者(useAppStore.hydrate)不传 opts, 忽略返回值
 * 即可, 行为兼容。
 */
export interface DrainResult {
  attempted: number;
  succeeded: number;
  failed: number;
  skipped: number;
}

export async function drainPending(opts?: {
  onProgress?: (done: number, total: number) => void;
}): Promise<DrainResult> {
  const result: DrainResult = { attempted: 0, succeeded: 0, failed: 0, skipped: 0 };
  if (isDraining) {
    pendingSignal = true;
    return result;
  }
  isDraining = true;
  try {
    do {
      pendingSignal = false;
      await reconcileDurableTombstones();
      await reconcileAcknowledgedActivityCleanup();
      const list = await listPending();
      // Sprint 6 round-11 R11B4 fix: safety-sweep — sessions marked
      // syncState='pending' in-memory but with NO matching fs entry
      // are "orphan pending" from a markSynced-then-removePending
      // failure. Coerce them to 'synced' so the banner drops. Pre-fix
      // the banner stuck at N forever until app reload.
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { useSessionStore } = require('../store/useSessionStore');
        const currentUserId = String(useSessionStore.getState().currentUserId ?? '');
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
              void useSessionStore.getState().markSynced(sess.id, sess.remoteId, undefined, currentUserId);
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
      if (list.length === 0) return result;
      crashLogger.breadcrumb(`v412:sync_drain start count=${list.length}`);
      const total = list.length;
      let done = 0;
      try { opts?.onProgress?.(done, total); } catch { /* silent */ }
      for (const hike of list) {
        result.attempted += 1;
        const outcome = await uploadOne(hike);
        if (outcome === 'succeeded') result.succeeded += 1;
        else if (outcome === 'failed') result.failed += 1;
        else if (outcome === 'skipped') result.skipped += 1;
        done += 1;
        try { opts?.onProgress?.(done, total); } catch { /* silent */ }
      }
    } while (pendingSignal);
  } finally {
    isDraining = false;
  }
  return result;
}

/**
 * Tombstones are product data until the server has observed them. We retain
 * the lightweight local records after acknowledgement so a later stale
 * operation can still be suppressed after logout/relogin or queue replay.
 */
async function reconcileDurableTombstones(): Promise<void> {
  let userId = '';
  try {
    const { useSessionStore } = require('../store/useSessionStore');
    userId = String(useSessionStore.getState().currentUserId ?? '');
  } catch { /* no signed-in store yet */ }
  if (!userId) return;
  const registry = await getActivityRegistry(userId);
  for (const tombstone of registry.tombstones) {
    if (!isCurrentActivityOwner(userId)) return;
    await deleteRemoteSessionByClientId(tombstone.clientActivityId).catch(() => false);
  }
  for (const clientCairnId of await listMarkerTombstones(userId)) {
    if (!isCurrentActivityOwner(userId)) return;
    try {
      await authenticatedFetch(`/api/markers/client/${encodeURIComponent(clientCairnId)}`, { method: 'DELETE' });
    } catch { /* retained locally for the next connectivity trigger */ }
  }
}

/**
 * Complete a cleanup interrupted after ACK/mapping persistence. The registry
 * record is removed last, so any process death simply repeats this per-entity
 * sweep. Both active and completed journal locations are covered because the
 * crash may have happened before or after rename.
 */
async function reconcileAcknowledgedActivityCleanup(): Promise<void> {
  let userId = '';
  try {
    const { useSessionStore } = require('../store/useSessionStore');
    userId = String(useSessionStore.getState().currentUserId ?? '');
  } catch { /* no signed-in store yet */ }
  if (!userId) return;
  const registry = await getActivityRegistry(userId);
  for (const activity of registry.completed) {
    if (activity.syncState !== 'synced' || !activity.serverActivityId) continue;
    await cleanupAcknowledgedActivityArtifacts(userId, activity.clientActivityId);
  }
}

/**
 * Cleanup is a retryable phase after the durable server ACK/mapping. The
 * pending payload is removed first and the registry ACK is removed last.
 * Any failure leaves the synced registry record intact, which makes the next
 * launch run cleanup-only instead of issuing another save request.
 */
export async function cleanupAcknowledgedActivityArtifacts(
  userId: string,
  clientActivityId: string,
): Promise<boolean> {
  const registryBeforeCleanup = await getActivityRegistry(userId);
  const simulatorActivity = registryBeforeCleanup.completed.some(
    activity => activity.clientActivityId === clientActivityId && activity.locationProviderSource === 'simulator',
  );
  try {
    await removePending(clientActivityId, userId);
    await removeLocalTrackPoints(userId, clientActivityId);
    await deleteAcknowledgedHikeTrackArtifacts(clientActivityId, userId);
    await removeAcknowledgedActivity(userId, clientActivityId);
    if (simulatorActivity) {
      const { appendSimulatorLog } = require('../features/activitySimulator/simulatorLog');
      appendSimulatorLog('SYNC_CLEANUP', 'simulator_activity_local_cleanup_complete', {
        syncState: 'synced',
      }, { userId, clientActivityId });
    }
    return true;
  } catch (error) {
    crashLogger.breadcrumb(`activity:ack_cleanup_retry ${String(error).slice(0, 80)}`);
    return false;
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
async function uploadOne(hike: PendingHike): Promise<'succeeded' | 'failed' | 'skipped'> {
  let simulatorActivity = false;
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
      return 'skipped';
    }
    if (!currentUserId || currentUserId === 'guest' || hikeUser !== currentUserId) {
      crashLogger.breadcrumb(
        `v412:sync_skip_cross_user localId=${hike.localId.slice(0, 8)} hikeUser=${hikeUser} currentUser=${currentUserId}`,
      );
      return 'skipped';
    }
  } catch { /* silent — session store not loaded */ }

  if (await isActivityTombstoned(hike.userId, hike.localId)) {
    if (!isCurrentActivityOwner(hike.userId)) return 'skipped';
    const cancelled = await deleteRemoteSessionByClientId(hike.localId);
    if (!cancelled && hike.remoteId) await deleteRemoteSession(hike.remoteId);
    try {
      await removePending(hike.localId, hike.userId);
    } catch (error) {
      // The durable tombstone is the acknowledgement authority. A failed
      // local delete is cleanup-only and will be retried without resurrecting
      // or uploading the Activity.
      crashLogger.breadcrumb(`activity:tombstone_cleanup_retry ${String(error).slice(0, 80)}`);
    }
    return 'succeeded';
  }

  try {
    const preflightRegistry = await getActivityRegistry(hike.userId);
    simulatorActivity = preflightRegistry.completed.some(
      item => item.clientActivityId === hike.localId && item.locationProviderSource === 'simulator',
    );
    if (simulatorActivity) {
      const { appendSimulatorLog } = require('../features/activitySimulator/simulatorLog');
      appendSimulatorLog('SYNC_STATE', 'simulator_activity_sync_started', {
        syncState: 'syncing',
        attemptCount: hike.attemptCount ?? 0,
      }, { userId: hike.userId, clientActivityId: hike.localId });
    }
    const acknowledged = preflightRegistry.completed.find(
      item => item.clientActivityId === hike.localId
        && item.syncState === 'synced'
        && !!item.serverActivityId,
    );
    if (acknowledged) {
      await cleanupAcknowledgedActivityArtifacts(hike.userId, hike.localId);
      return 'succeeded';
    }
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { useSessionStore } = require('../store/useSessionStore');
      await useSessionStore.getState().markSyncState?.(hike.localId, 'syncing', hike.userId);
      await updateCompletedActivitySyncState(hike.userId, hike.localId, 'syncing');
    } catch { /* pending payload remains authoritative */ }
    // 极端: hike 开始时也离线, remoteId 是 null → 先建 server row
    if (!hike.remoteId) {
      const startTime = new Date(hike.startedAt ?? hike.createdAt).toISOString();
      // v412 blocker 1 修: 用 pendingHike 里的 activityMode, 不再硬编码 'hiking'
      // 之前硬编码会导致 running 离线 save 后, 网络恢复时被建成 hiking session (数据破坏)
      const activityMode = hike.activityMode || 'hiking';  // fallback 兼容老磁盘数据
      const start = await startSessionResolved(activityMode, startTime, hike.localId);
      if (start.kind === 'conflict') {
        // Another legitimate unfinished Activity owns the server slot. Keep
        // this completed-local Activity intact until that Activity is resolved;
        // never weaken the singleton by manufacturing a second server shell.
        await markAttempt(hike.localId);
        await updateCompletedActivitySyncState(hike.userId, hike.localId, 'sync_error');
        crashLogger.breadcrumb(`activity:sync_start_conflict localId=${hike.localId.slice(0, 8)} existing=${start.existing?.clientActivityId?.slice(0, 8) ?? 'legacy'}`);
        return 'failed';
      }
      if (start.kind !== 'started') {
        await markAttempt(hike.localId);
        crashLogger.breadcrumb(`v412:sync_start_failed localId=${hike.localId.slice(0, 8)}`);
        return 'failed';
      }
      if (!isCurrentActivityOwner(hike.userId)) return 'skipped';
      hike.remoteId = start.serverActivityId;
      await updateRemoteId(hike.localId, start.serverActivityId);
    }

    if (!isCurrentActivityOwner(hike.userId)) return 'skipped';
    const result = await saveHikeAtomic(hike.remoteId, hike.payload, hike.idempotencyKey, hike.localId);
    crashLogger.breadcrumb(
      `v412:sync_uploaded localId=${hike.localId.slice(0, 8)} sid=${result.session_id} replay=${!!result.idempotent_replay}`,
    );
    // The request may have started under A and completed after logout/login.
    // Leave A's acknowledged server entity in its idempotent pending state;
    // A's later retry will reconcile it without touching B's local stores.
    if (!isCurrentActivityOwner(hike.userId)) return 'skipped';

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
    const routePoints = hike.payload?.route_points;
    const reconciledStartedAt = hike.startedAt ?? (
      Array.isArray(routePoints) && routePoints.length > 0 && typeof routePoints[0]?.t === 'number'
        ? routePoints[0].t
        : hike.createdAt
    );
    const reconciledEndedAt = hike.payload?.end_time
      ? new Date(hike.payload.end_time).getTime()
      : Date.now();
    let memorySynced = false;
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { useSessionStore } = require('../store/useSessionStore');
      const store = useSessionStore.getState();
      if (typeof store.markSynced === 'function') {
        // R97: 传 upsertData 让 markSynced 在找不到 localId 时 upsert 一条
        // synced session。offline save 后 hydrate 时序竞争 或者 fetchSessions
        // 覆盖内存 sessions 会让内存里没有这条,原 markSynced silent no-op
        // → removePending 删磁盘 → 服务器有数据但 UI 永远看不见。
        // 现在:找不到 localId → upsert 一条能显示的 synced entry。
        const upsertData = {
          activityMode: hike.activityMode,
          startedAt: reconciledStartedAt,
          endedAt: reconciledEndedAt,
          durationS: hike.payload?.duration_s ?? 0,
          distanceM: hike.payload?.distance_m ?? 0,
          name: hike.payload?.name,
        };
        memorySynced = await store.markSynced(hike.localId, result.session_id, upsertData, hike.userId);
      }
    } catch (e) {
      crashLogger.breadcrumb(`v412:sync_mark_failed ${String(e).slice(0, 60)}`);
    }
    if (!memorySynced) return 'failed';
    const registry = await getActivityRegistry(hike.userId);
    if (!registry.completed.some(item => item.clientActivityId === hike.localId)) {
      await completeActivity({
        clientActivityId: hike.localId,
        serverActivityId: result.session_id,
        userId: hike.userId,
        activityMode: hike.activityMode,
        startedAt: reconciledStartedAt,
        endedAt: reconciledEndedAt,
        lifecycle: 'completed_local',
        syncState: 'pending',
        locationProviderSource: simulatorActivity ? 'simulator' : 'real',
      });
    }
    const registryAcked = await acknowledgeActivity(hike.userId, hike.localId, result.session_id);
    if (!registryAcked) return 'failed';
    if (simulatorActivity) {
      const { appendSimulatorLog } = require('../features/activitySimulator/simulatorLog');
      appendSimulatorLog('SYNC_ACK', 'simulator_activity_server_acknowledged', {
        syncState: 'synced',
        serverMappingSuffix: String(result.session_id).slice(-8),
        idempotentReplay: !!result.idempotent_replay,
      }, { userId: hike.userId, clientActivityId: hike.localId });
    }
    // Handoff is complete even if cleanup is not. The synced registry state
    // prevents a later launch from re-uploading after a local delete failure.
    await cleanupAcknowledgedActivityArtifacts(hike.userId, hike.localId);
    return 'succeeded';
  } catch (err: any) {
    if (simulatorActivity) {
      try {
        const { appendSimulatorLog } = require('../features/activitySimulator/simulatorLog');
        appendSimulatorLog('ERROR', 'simulator_activity_sync_failed', {
          syncState: 'sync_error',
          errorCode: err?.body?.code ?? err?.status ?? 'network',
        }, { userId: hike.userId, clientActivityId: hike.localId });
      } catch { /* diagnostics only */ }
    }
    // R96 修补 A.4 + review B1/B2: detect SESSION_NOT_FOUND_RESYNC 场景。
    // aliyun sessions 表被 R9B7 auto-migration 误删,重建后 auto_increment
    // 从 202 开始。pending 里 payload.remoteId 是死指针(比如指向 88),
    // PATCH /:id/save 会返回 404 + code=SESSION_NOT_FOUND_RESYNC。
    //
    // Review B1: 必须同时换 idempotencyKey — middleware 用
    // sha256(userId:opId) 作 cache key,老 key 会 replay 之前的 404,
    // resync 永远回不了 200。resetForResync 一次搞定(清 remoteId + 新 key)。
    //
    // Review B2: 若 resetForResync 落盘失败(fs write error),不能 markAttempt
    // 累加,否则重启后又读到旧死指针 + attemptCount 涨飞。直接 return 跳过
    // 本轮,下次触发再试。成功也不 markAttempt(这次不算失败,算"路径调整")。
    if (err?.status === 404 && err?.body?.code === 'SESSION_NOT_FOUND_RESYNC') {
      const ok = await resetForResync(hike.localId);
      if (ok) {
        crashLogger.breadcrumb(
          `v412:sync_resync_needed localId=${hike.localId.slice(0, 8)} — cleared remoteId + new idempotencyKey`,
        );
      } else {
        crashLogger.breadcrumb(
          `v412:sync_resync_reset_failed localId=${hike.localId.slice(0, 8)} — will retry next drain`,
        );
      }
      return 'skipped'; // 不 markAttempt: 这是路径调整,不是失败重试
    }
    await markAttempt(hike.localId);
    if ((hike.attemptCount || 0) + 1 >= 3) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { useSessionStore } = require('../store/useSessionStore');
        await useSessionStore.getState().markSyncState?.(hike.localId, 'sync_error', hike.userId);
        await updateCompletedActivitySyncState(hike.userId, hike.localId, 'sync_error');
      } catch { /* retry data remains intact */ }
    } else {
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { useSessionStore } = require('../store/useSessionStore');
        await useSessionStore.getState().markSyncState?.(hike.localId, 'pending', hike.userId);
        await updateCompletedActivitySyncState(hike.userId, hike.localId, 'pending');
      } catch { /* retry data remains intact */ }
    }
    crashLogger.breadcrumb(
      `v412:sync_upload_failed localId=${hike.localId.slice(0, 8)} status=${err?.status || 'net'}`,
    );
    return 'failed';
  }
}

/**
 * 用户长按灰卡"放弃"入口调用。
 */
export async function abandonPending(localId: string): Promise<void> {
  let userId = '';
  let remoteId: number | null = null;
  try {
    const { useSessionStore } = require('../store/useSessionStore');
    const store = useSessionStore.getState();
    userId = String(store.currentUserId ?? '');
    remoteId = store.sessions.find((session: any) => session.id === localId)?.remoteId ?? null;
  } catch { /* handled by retained pending data below */ }
  if (userId && userId !== 'guest') {
    const { tombstoneActivity } = require('../features/activity/activityRegistry');
    await tombstoneActivity({ userId, clientActivityId: localId, serverActivityId: remoteId });
  }
  await removePending(localId, userId);
  const cancelled = await deleteRemoteSessionByClientId(localId);
  if (!cancelled && remoteId) await deleteRemoteSession(remoteId);
  crashLogger.breadcrumb(`v412:sync_abandoned localId=${localId.slice(0, 8)}`);
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { useSessionStore } = require('../store/useSessionStore');
    const store = useSessionStore.getState();
    if (typeof store.removeLocal === 'function') {
      await store.removeLocal(localId, userId);
    }
  } catch {
    /* silent */
  }
}
