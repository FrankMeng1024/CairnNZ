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
import { deleteRemoteSession } from '../services/sessionService';
import { crashLogger } from '../services/crashLogger';

// O18 SAF-03: serialize concurrent hydrate() calls so a race between the
// post-login hydrate and any background hydrate can't overwrite each other
// in a mixed-user order. Second caller waits for first to finish, then
// no-ops if user matches.
let hydrateInFlight: Promise<void> | null = null;
let hydrateInFlightUserId: string | null = null;

export type ActivityMode = 'hiking' | 'running';

export interface TrackPoint extends Coordinate {
  t: number;  // Unix ms timestamp
}

export interface TrackingSession {
  id: string;
  remoteId?: number;           // backend session ID — set after successful sync
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
  syncState?: 'synced' | 'pending' | 'syncing';
}

const MAX_SESSIONS = 100;

const sessionsKey = (userId: string) => `cairn_sessions_${userId}`;
const trackPointsKey = (userId: string, sessionId: string) =>
  `cairn_trackpoints_${userId}_${sessionId}`;

interface SessionState {
  sessions: TrackingSession[];
  currentUserId: string;            // 'guest' before login, real userId after
  addSession: (session: TrackingSession) => void;
  deleteSession: (id: string) => void;
  /** O18 HIST-03: rename a completed hike. Persists via storage.setItem. */
  renameSession: (id: string, name: string) => void;
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
  }) => void;
  /** 用户长按灰卡"放弃"调用: 从 sessions 数组删除, 不通知服务器 */
  removeLocal: (localId: string) => void;
}

export const useSessionStore = create<SessionState>((set, get) => ({
  sessions: [],
  currentUserId: 'guest',

  addSession: (session) => {
    const userId = get().currentUserId;
    set((s) => {
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
      let existingIdx = s.sessions.findIndex((x) => x.id === session.id);
      if (existingIdx < 0 && session.remoteId) {
        existingIdx = s.sessions.findIndex(
          (x) => x.remoteId && x.remoteId === session.remoteId,
        );
      }
      let next;
      if (existingIdx >= 0) {
        next = s.sessions.slice();
        next[existingIdx] = { ...next[existingIdx], ...session };
      } else {
        // Prepend newest first, prune oldest beyond MAX_SESSIONS
        next = [session, ...s.sessions].slice(0, MAX_SESSIONS);
      }
      // Store summary without trackPoints to keep localStorage small;
      // trackPoints stored separately under per-user key
      const summaries = next.map(({ trackPoints: _, ...rest }) => rest);
      storage.setItem(sessionsKey(userId), JSON.stringify(summaries));
      if (session.trackPoints.length > 0) {
        storage.setItem(
          trackPointsKey(userId, session.id),
          JSON.stringify(session.trackPoints),
        );
      }
      return { sessions: next };
    });

  },

  // O18 HIST-03: rename a saved hike. Persists the summary list to storage.
  // Trims empty names to keep display fallbacks working; caller can gate on
  // trimmed length before invoking.
  renameSession: (id, name) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const userId = get().currentUserId;
    set((state) => {
      const next = state.sessions.map((s) => s.id === id ? { ...s, name: trimmed } : s);
      // Persist summaries (no trackPoints, matches hydrate's read shape).
      try {
        const summaries = next.map(({ trackPoints, ...rest }) => rest);
        storage.setItem(sessionsKey(userId), JSON.stringify(summaries));
      } catch (err) {
        crashLogger.breadcrumb(`session:rename:persist_failed ${String(err).slice(0, 60)}`);
      }
      return { sessions: next };
    });
  },

  clearSessions: () => {
    const userId = get().currentUserId;
    storage.removeItem(sessionsKey(userId));
    // Note: trackpoints keyed per-session-id are not enumerable on AsyncStorage
    // without listing all keys. They become orphaned but unreachable since
    // sessions list is gone. Acceptable trade-off; full cleanup would require
    // AsyncStorage.getAllKeys() filter.
    set({ sessions: [] });
  },

  deleteSession: (id) => {
    const userId = get().currentUserId;
    const session = get().sessions.find((s) => s.id === id);
    crashLogger.breadcrumb(`session:delete:start id=${id} hasRemoteId=${!!session?.remoteId}`);
    set((s) => {
      const next = s.sessions.filter((sess) => sess.id !== id);
      const summaries = next.map(({ trackPoints: _, ...rest }) => rest);
      storage.setItem(sessionsKey(userId), JSON.stringify(summaries));
      storage.removeItem(trackPointsKey(userId, id));
      return { sessions: next };
    });
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
    if (session?.remoteId != null) {
      deleteRemoteSession(session.remoteId)
        .then((ok) => crashLogger.breadcrumb(`session:delete:remote ok=${ok} target=${session.remoteId}`))
        .catch((err) => crashLogger.breadcrumb(`session:delete:remote-error ${String(err).slice(0, 80)}`));
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
  markSynced: (localId, remoteId, upsertData) => {
    set((s) => {
      const idx = s.sessions.findIndex((sess) => sess.id === localId);
      let updated: TrackingSession[];
      if (idx >= 0) {
        // Found: 原路径 in-place mutate
        updated = s.sessions.map((sess, i) =>
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
        updated = [upsertSession, ...s.sessions];
      } else {
        // 无 upsertData 兜底:保持原 silent no-op 行为(不该发生,但防御性)
        return {};
      }
      const summaries = updated.map(({ trackPoints: _, ...rest }) => rest);
      storage.setItem(sessionsKey(get().currentUserId), JSON.stringify(summaries));
      return { sessions: updated };
    });
  },

  // v412: 用户长按灰卡"放弃"调用 (无 remoteId or 未成功同步的场景)
  removeLocal: (localId) => {
    const userId = get().currentUserId;
    set((s) => {
      const next = s.sessions.filter((sess) => sess.id !== localId);
      const summaries = next.map(({ trackPoints: _, ...rest }) => rest);
      storage.setItem(sessionsKey(userId), JSON.stringify(summaries));
      storage.removeItem(trackPointsKey(userId, localId));
      return { sessions: next };
    });
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
