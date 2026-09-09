/**
 * useSessionStore — completed tracking session persistence.
 *
 * Stores completed hiking/running sessions locally.
 * Schema is geo-extensible: sessions are tagged with regionCode.
 * MapHistoryScreen and RoutesScreen read from this store in Sprint 16.
 *
 * Storage keys are USER-SCOPED to prevent cross-user data leak:
 *   cairn_sessions_<userId>            — session summaries (no trackPoints)
 *   cairn_trackpoints_<userId>_<id>    — per-session trackPoints
 *   cairn_sessions_guest, cairn_trackpoints_guest_<id> — pre-login state
 */
import { create } from 'zustand';
import { storage } from './storage';
import type { Coordinate } from '../utils/geo';
import { deleteRemoteSession, deleteRemoteSessionByClientId, renameRemoteSession } from '../services/sessionService';
import { tombstoneActivity } from '../features/activity/activityRegistry';
import { crashLogger } from '../services/crashLogger';

// O18 SAF-03: serialize concurrent hydrate() calls so a race between the
// post-login hydrate and any background hydrate can't overwrite each other
// in a mixed-user order. Second caller waits for first to finish, then
// no-ops if user matches.
let hydrateInFlight: Promise<void> | null = null;
let hydrateInFlightUserId: string | null = null;
let sessionWriteTail: Promise<void> = Promise.resolve();

export type ActivityMode = 'hiking' | 'running';

export interface TrackPoint extends Coordinate {
  t: number;  // Unix ms timestamp
  segmentId?: string;
  segmentStartReason?: 'start' | 'resume' | 'process-recovery' | 'gps-reacquired' | 'legacy';
}

export interface TrackingSession {
  id: string;
  clientActivityId?: string;
  remoteId?: number;           // backend session ID — set after successful sync
  serverActivityId?: number;
  activityMode: ActivityMode;
  regionCode: string;         // geo-extensible: 'nz', 'au', etc.
  startedAt: number;          // Unix ms
  endedAt: number;            // Unix ms
  durationS: number;          // seconds
  distanceM: number;          // meters (convert to km/mi at display layer)
  elevationGainM: number;     // meters
  trackPoints: TrackPoint[];  // GPS breadcrumb trail (gated/clean)
  markerIds: string[];        // markers planted during this session
  // O1 batch 40: trackPointsRaw, pausePins removed — written into session but 0 external readers
  name?: string;              // user-assigned name (optional, auto-generated if absent)
  /** v333: number of NEW H3 cells unlocked in the Memory map by this
   *  session. LOCAL-ONLY — NOT included in the POST /api/sessions body
   *  whitelist (see line ~95-117 below), so it does not leak to backend.
   *  Used by StopSummarySheet to show "Memory: +X km²" banner. */
  memoryNewCells?: number;
  /** v412: 同步状态机
   *   - 'synced' (default): 已在服务器, 卡片正常可点
   *   - 'pending': 已 Save 但未同步 (pendingSyncStore 里有 payload), 灰卡不可点
   *   - 'syncing': SyncDaemon 正在上传该条 (短暂) */
  syncState?: 'synced' | 'pending' | 'syncing' | 'sync_error';
}

const MAX_SESSIONS = 100;

const sessionsKey = (userId: string) => `cairn_sessions_${userId}`;
const trackPointsKey = (userId: string, sessionId: string) =>
  `cairn_trackpoints_${userId}_${sessionId}`;

function retainPendingAndCapHistory(sessions: TrackingSession[]): TrackingSession[] {
  let retainedServerBacked = 0;
  return sessions.filter(session => {
    if (session.syncState && session.syncState !== 'synced') return true;
    if (retainedServerBacked >= MAX_SESSIONS) return false;
    retainedServerBacked += 1;
    return true;
  });
}

async function persistedSessionsFor(userId: string): Promise<TrackingSession[]> {
  const raw = await storage.getItem(sessionsKey(userId));
  if (!raw) return [];
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) throw new Error('session_store_corrupt');
  return parsed.map(session => ({ ...session, trackPoints: [] }));
}

interface SessionState {
  sessions: TrackingSession[];
  currentUserId: string;            // 'guest' before login, real userId after
  addSession: (session: TrackingSession, ownerUserId?: string) => Promise<void>;
  deleteSession: (id: string) => Promise<void>;
  /** Rename only after the server or pending outbox accepts the mutation. */
  renameSession: (id: string, name: string) => Promise<{
    ok: boolean;
    reason?: 'not-found' | 'syncing' | 'pending-missing' | 'rejected' | 'unavailable' | 'invalid';
  }>;
  clearSessions: () => void;       // called on logout to remove prior user's data
  getSessions: () => TrackingSession[];
  // O1 batch 40: getSessionsByRegion, markSyncing removed — 0 external callers
  hydrate: (userId?: string) => Promise<void>;
  // v412: 已 Save 未同步 hike 的 syncState 管理
  /**
   * SyncDaemon 上传成功后调用: syncState → 'synced', 更新 remoteId
   * R97: 变 upsert 语义。找不到 localId 时若提供 upsertData 就插入新条目
   * (offline save → hydrate 时序竞争丢 sessions 的兜底)
   */
  markSynced: (localId: string, remoteId: number, upsertData?: {
    activityMode: ActivityMode;
    regionCode?: string;
    startedAt: number;
    endedAt: number;
    durationS?: number;
    distanceM?: number;
    elevationGainM?: number;
    name?: string;
  }, ownerUserId?: string) => Promise<boolean>;
  markSyncState: (localId: string, syncState: 'pending' | 'syncing' | 'sync_error', ownerUserId?: string) => Promise<void>;
  /** 用户长按灰卡"放弃"调用: 从 sessions 数组删除, 不通知服务器 */
  removeLocal: (localId: string, ownerUserId?: string) => Promise<void>;
}

export const useSessionStore = create<SessionState>((set, get) => ({
  sessions: [],
  currentUserId: 'guest',

  addSession: async (session, requestedOwnerUserId) => {
    // Capture before entering the shared async tail. Completion-time account
    // state must never decide which user's durable key receives this entity.
    const ownerUserId = String(requestedOwnerUserId ?? get().currentUserId ?? '');
    if (!ownerUserId || ownerUserId === 'guest') throw new Error('session_owner_required');
    const run = sessionWriteTail.then(async () => {
      const live = get();
      const base = live.currentUserId === ownerUserId
        ? live.sessions
        : await persistedSessionsFor(ownerUserId);
      // O16 C1: dedupe by session.id. Pre-fix, a double-tap Save race
      // or a retry from HikingScreen's wall-clock catch could add the
      // same local id twice, producing duplicate activity cards. Server
      // handled its side via idempotent replay, but the client store
      // was defenseless. Now: if an entry with the same id exists,
      // update in-place with the fresh copy (which may carry a newly
      // assigned remoteId or updated syncState).
      //
      // Sprint 6 round-20 R20B7: also dedupe by remoteId. Race scenario:
      // (a) local pending session with UUID id and remoteId assigned
      //     from POST /sessions/start
      // (b) remote hydrate GET /api/sessions returns the same row with
      //     id = String(remoteId) (numeric)
      // First dedupe by id misses; second dedupe by remoteId catches it
      // and merges in-place. Prevents ghost duplicate card that would
      // appear after a race between drainPending completion and remote
      // list refresh.
      let existingIdx = base.findIndex((x) => x.id === session.id);
      if (existingIdx < 0 && session.remoteId) {
        existingIdx = base.findIndex(
          (x) => x.remoteId && x.remoteId === session.remoteId,
        );
      }
      let next;
      if (existingIdx >= 0) {
        next = base.slice();
        next[existingIdx] = { ...next[existingIdx], ...session };
      } else {
        next = [session, ...base];
      }
      next = retainPendingAndCapHistory(next);
      // Store summary without trackPoints to keep localStorage small;
      // trackPoints stored separately under per-user key
      const summaries = next.map(({ trackPoints: _, ...rest }) => rest);
      await storage.setItem(sessionsKey(ownerUserId), JSON.stringify(summaries), { strict: true });
      if (session.trackPoints.length > 0) {
        await storage.setItem(
          trackPointsKey(ownerUserId, session.id),
          JSON.stringify(session.trackPoints),
          { strict: true },
        );
      }
      if (get().currentUserId === ownerUserId) set({ sessions: next });
    });
    sessionWriteTail = run.catch(() => {});
    await run;
  },

  renameSession: async (id, name) => {
    const trimmed = name.trim().slice(0, 100);
    if (!trimmed) return { ok: false, reason: 'invalid' };
    const userId = String(get().currentUserId ?? '');
    const session = get().sessions.find(item => item.id === id);
    if (!session || !userId || userId === 'guest') return { ok: false, reason: 'not-found' };

    const failRename = (reason: 'not-found' | 'syncing' | 'pending-missing' | 'rejected' | 'unavailable' | 'invalid') => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('../features/activitySimulator/simulatorLog').appendSimulatorLog('ERROR', 'activity_rename_failed', {
          reason,
          syncState: session.syncState ?? 'synced',
        }, { userId, clientActivityId: session.clientActivityId ?? session.id, coordinateSource: 'none' });
      } catch { /* QA diagnostics cannot affect rename */ }
      return { ok: false as const, reason };
    };
    if (session.syncState === 'syncing') return failRename('syncing');
    if (session.syncState === 'pending' || session.syncState === 'sync_error') {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { renamePendingActivity } = require('../services/pendingSyncStore');
      const pendingRenamed = await renamePendingActivity(session.clientActivityId ?? session.id, userId, trimmed);
      if (!pendingRenamed) return failRename('pending-missing');
    } else {
      const remoteId = session.remoteId ?? session.serverActivityId ?? (/^\d+$/.test(session.id) ? Number(session.id) : null);
      if (!remoteId) return failRename('not-found');
      const remote = await renameRemoteSession(remoteId, trimmed);
      if (!remote.ok) return failRename(remote.reason);
    }

    const run = sessionWriteTail.then(async () => {
      const live = get();
      if (live.currentUserId !== userId || !live.sessions.some(item => item.id === id)) {
        throw new Error('session_rename_stale');
      }
      const next = live.sessions.map(item => item.id === id ? { ...item, name: trimmed } : item);
      const summaries = next.map(({ trackPoints: _, ...rest }) => rest);
      await storage.setItem(sessionsKey(userId), JSON.stringify(summaries), { strict: true });
      if (get().currentUserId === userId) set({ sessions: next });
    });
    sessionWriteTail = run.catch(() => {});
    try {
      await run;
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('../features/activitySimulator/simulatorLog').appendSimulatorLog('ACTIVITY_COMPLETION', 'activity_rename_succeeded', {
          syncState: session.syncState ?? 'synced',
        }, { userId, clientActivityId: session.clientActivityId ?? session.id, coordinateSource: 'none' });
      } catch { /* QA diagnostics cannot affect rename */ }
      return { ok: true };
    } catch {
      return failRename('unavailable');
    }
  },

  clearSessions: () => {
    // Logout is not account deletion. Hide the active user's in-memory view,
    // but retain its scoped summaries/points so pending data returns on login.
    set({ sessions: [], currentUserId: 'guest' });
  },

  deleteSession: async (id) => {
    const userId = String(get().currentUserId ?? '');
    const session = get().sessions.find((s) => s.id === id);
    const clientActivityId = session?.clientActivityId ?? session?.id;
    crashLogger.breadcrumb(`session:delete:start id=${id} hasRemoteId=${!!session?.remoteId}`);
    if (session && userId !== 'guest' && clientActivityId) {
      await tombstoneActivity({
        userId,
        clientActivityId,
        serverActivityId: session.remoteId ?? null,
      });
      try {
        const { removePending } = require('../services/pendingSyncStore');
        await removePending(clientActivityId, userId);
      } catch { /* no pending payload */ }
    }
    const base = get().currentUserId === userId ? get().sessions : await persistedSessionsFor(userId);
    const next = base.filter((sess) => sess.id !== id);
    const summaries = next.map(({ trackPoints: _, ...rest }) => rest);
    await storage.setItem(sessionsKey(userId), JSON.stringify(summaries), { strict: true });
    await storage.removeItem(trackPointsKey(userId, id));
    if (get().currentUserId === userId) set({ sessions: next });
    // Mirror deletion to backend.
    //
    // Sessions can be in two shapes:
    //   1. Pulled from /api/sessions (hydrate): id is a stringified
    //      backend row id; remoteId is the same numeric value (set by
    //      useAppStore.hydrate so this branch always works for synced
    //      sessions).
    //   2. Created locally (stopTracking): id is a UUID-ish string
    //      generated by generateId(); remoteId is set ONLY when the
    //      session has been uploaded. Pre-upload sessions exist only
    //      in local storage — there's no backend row to delete.
    if (session && clientActivityId && get().currentUserId === userId) {
      const cancelled = await deleteRemoteSessionByClientId(clientActivityId);
      const ok = cancelled || (session.remoteId != null
        ? await deleteRemoteSession(session.remoteId)
        : false);
      crashLogger.breadcrumb(`session:delete:remote ok=${ok} target=${session.remoteId ?? clientActivityId}`);
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('../features/activitySimulator/simulatorLog').appendSimulatorLog('ACTIVITY_COMPLETION', 'activity_deleted', {
          remoteDeleteAcknowledged: ok,
        }, { userId, clientActivityId, coordinateSource: 'none' });
      } catch { /* QA diagnostics cannot affect deletion */ }
    } else {
      crashLogger.breadcrumb(`session:delete:local-only id=${id}`);
    }
  },

  getSessions: () => get().sessions,

  // O1 batch 40: getSessionsByRegion removed — 0 external callers

  // v412: SyncDaemon 上传成功后调用。R97: 改成 upsert 语义。
  // 之前 markSynced 只在 memory sessions 里 find + mutate,如果找不到
  // localId 就 silent no-op。用户 offline save 后:
  //   - hydrate 时序 vs drainPending 竞争,或 fetchSessions 已把内存
  //     覆盖掉那条本地 session
  //   - drainPending 从磁盘 pendingSyncStore 拿到该条,uploadOne 成功
  //   - markSynced silent no-op → sessions 数组没这条
  //   - removePending 删了磁盘 pending → 磁盘也没
  //   - 服务器有数据 + 内存/磁盘 UI 双空 → activity 永久消失,用户看不到
  //
  // 修复:markSynced 找不到 localId 时,upsert 一条 synced session
  // (需 caller 传 hike 里 payload 摘要,activityMode 等)。
  // 语义变"确保这条 session 以 synced 状态在 store 里存在",不再
  // 假设 addSession 早就跑过。
  markSynced: async (localId, remoteId, upsertData, requestedOwnerUserId) => {
    const ownerUserId = String(requestedOwnerUserId ?? get().currentUserId ?? '');
    if (!ownerUserId || ownerUserId === 'guest') return false;
    // R110 P2-15: merge semantic verified —— in-memory 分支用 `{...sess, ...}` spread,
    // 现有 sess 字段 (name/description/durationS 等) 保留优先, 只覆盖 remoteId/syncState.
    // upsert 分支只在内存里找不到该 localId 时走 (真孤立), 无服务端 name 需要保留.
    let didUpdate = false;
    const run = sessionWriteTail.then(async () => {
      const live = get();
      const base = live.currentUserId === ownerUserId
        ? live.sessions
        : await persistedSessionsFor(ownerUserId);
      const idx = base.findIndex((sess) => sess.id === localId);
      let updated: TrackingSession[];
      if (idx >= 0) {
        // Found: 原路径 in-place mutate
        updated = base.map((sess, i) =>
          i === idx
            ? { ...sess, remoteId, syncState: 'synced' as const }
            : sess
        );
      } else if (upsertData) {
        // R97: 内存里没这条,upsert 补一条 synced entry
        const upsertSession: TrackingSession = {
          id: localId,
          remoteId,
          activityMode: upsertData.activityMode,
          regionCode: upsertData.regionCode ?? 'nz',
          startedAt: upsertData.startedAt,
          endedAt: upsertData.endedAt,
          durationS: upsertData.durationS ?? 0,
          distanceM: upsertData.distanceM ?? 0,
          elevationGainM: upsertData.elevationGainM ?? 0,
          trackPoints: [],
          markerIds: [],
          name: upsertData.name,
          syncState: 'synced' as const,
        };
        updated = [upsertSession, ...base];
      } else {
        // 无 upsertData 兜底:保持原 silent no-op 行为(不该发生,但防御性)
        return;
      }
      updated = retainPendingAndCapHistory(updated);
      const summaries = updated.map(({ trackPoints: _, ...rest }) => rest);
      await storage.setItem(sessionsKey(ownerUserId), JSON.stringify(summaries), { strict: true });
      if (get().currentUserId === ownerUserId) set({ sessions: updated });
      didUpdate = true;
    });
    sessionWriteTail = run.catch(() => {});
    await run;
    return didUpdate;
  },

  markSyncState: async (localId, syncState, requestedOwnerUserId) => {
    const ownerUserId = String(requestedOwnerUserId ?? get().currentUserId ?? '');
    if (!ownerUserId || ownerUserId === 'guest') return;
    const run = sessionWriteTail.then(async () => {
      const live = get();
      const base = live.currentUserId === ownerUserId
        ? live.sessions
        : await persistedSessionsFor(ownerUserId);
      const next = base.map(session =>
        session.id === localId ? { ...session, syncState } : session,
      );
      await storage.setItem(
        sessionsKey(ownerUserId),
        JSON.stringify(next.map(({ trackPoints: _, ...rest }) => rest)),
        { strict: true },
      );
      if (get().currentUserId === ownerUserId) set({ sessions: next });
    });
    sessionWriteTail = run.catch(() => {});
    await run;
  },

  // v412: 用户长按灰卡"放弃"调用 (无 remoteId or 未成功同步的场景)
  removeLocal: async (localId, requestedOwnerUserId) => {
    const ownerUserId = String(requestedOwnerUserId ?? get().currentUserId ?? '');
    if (!ownerUserId || ownerUserId === 'guest') return;
    const run = sessionWriteTail.then(async () => {
      const live = get();
      const base = live.currentUserId === ownerUserId
        ? live.sessions
        : await persistedSessionsFor(ownerUserId);
      const next = base.filter((sess) => sess.id !== localId);
      await storage.setItem(
        sessionsKey(ownerUserId),
        JSON.stringify(next.map(({ trackPoints: _, ...rest }) => rest)),
        { strict: true },
      );
      await storage.removeItem(trackPointsKey(ownerUserId, localId));
      if (get().currentUserId === ownerUserId) set({ sessions: next });
    });
    sessionWriteTail = run.catch(() => {});
    await run;
  },

  hydrate: async (userId = 'guest') => {
    // O18 SAF-03: mutex — if a hydrate is already running for this user,
    // await it and return (no double-write). If it's running for a DIFFERENT
    // user, still await (avoid overlapping writes) then run ours after so
    // the latest requested user wins deterministically.
    if (hydrateInFlight) {
      const sameUser = hydrateInFlightUserId === userId;
      await hydrateInFlight.catch(() => {});
      if (sameUser) return;
    }
    const run = (async () => {
      set({ currentUserId: userId });
      const raw = await storage.getItem(sessionsKey(userId));
      if (raw) {
        try {
          // Sessions loaded without trackPoints (loaded on demand)
          const parsed = JSON.parse(raw);
          // Sprint 6 round-7 review R7B7: runtime shape validation.
          // If storage contains a non-array (future migration wrote
          // { version: 2, sessions: [...] } or corrupt {}), pre-fix
          // code threw on .map → catch → silently wiped user data.
          // Now: log to aliyun before wiping so we can diagnose.
          if (!Array.isArray(parsed)) {
            try {
              // eslint-disable-next-line @typescript-eslint/no-require-imports
              const { log } = require('../services/appLog');
              log('session_store.hydrate.non_array', {
                userId, shape: typeof parsed, isNull: parsed === null,
              });
            } catch { /* silent */ }
            storage.removeItem(sessionsKey(userId));
            if (useSessionStore.getState().currentUserId === userId) {
              set({ sessions: [] });
            }
            return;
          }
          // Skip malformed entries (missing id or startedAt) instead
          // of injecting broken sessions into state. `.filter(s =>
          // s.distanceM > 0)` downstream mishandles NaN + undefined.
          const summaries = (parsed as any[]).filter(
            s => s && typeof s.id === 'string' && typeof s.startedAt === 'number',
          );
          const sessions: TrackingSession[] = summaries.map((s) => ({
            ...s,
            trackPoints: [],
            // Sprint 6 round-20 R20B6: hydrate MUST preserve syncState so
            // pending cards stay as non-tappable placeholders. If storage
            // was written by an older build without the field (or by a
            // hydrate path that stripped it), infer from remoteId: a
            // stored remoteId means the card was previously synced; no
            // remoteId means the upload never finished and the card
            // must present as pending. Fall through to explicit value if
            // present (don't override recorded state).
            syncState: s.syncState
              || (s.remoteId ? 'synced' as const : 'pending' as const),
          }));
          // Re-check currentUserId in case a newer hydrate raced ahead —
          // only apply if we're still the current user.
          if (useSessionStore.getState().currentUserId === userId) {
            set({ sessions });
          }
        } catch {
          storage.removeItem(sessionsKey(userId));
          if (useSessionStore.getState().currentUserId === userId) {
            set({ sessions: [] });
          }
        }
      } else {
        if (useSessionStore.getState().currentUserId === userId) {
          set({ sessions: [] });
        }
      }
    })();
    hydrateInFlight = run;
    hydrateInFlightUserId = userId;
    try {
      await run;
    } finally {
      if (hydrateInFlight === run) {
        hydrateInFlight = null;
        hydrateInFlightUserId = null;
      }
    }
  },
}));

/**
 * Load track points for a specific session on demand.
 */
export async function loadTrackPoints(sessionId: string): Promise<TrackPoint[]> {
  const userId = useSessionStore.getState().currentUserId;
  const raw = await storage.getItem(trackPointsKey(userId, sessionId));
  if (!raw) return [];
  try {
    return JSON.parse(raw) as TrackPoint[];
  } catch {
    return [];
  }
}

export async function removeLocalTrackPoints(userId: string, sessionId: string): Promise<void> {
  await storage.removeItem(trackPointsKey(userId, sessionId));
}
