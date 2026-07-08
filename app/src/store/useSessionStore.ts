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
import { authenticatedFetch } from '../services/apiService';
import { deleteRemoteSession } from '../services/sessionService';
import { crashLogger } from '../services/crashLogger';

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
  /** v77: full audit track including stationary drift + low-accuracy
   *  fixes (everything except teleport-rejected). Sent to server once
   *  at session finalize for debug / re-processing. NOT used for
   *  rendering or distance — those use `trackPoints`. */
  trackPointsRaw?: TrackPoint[];
  markerIds: string[];        // markers planted during this session
  pausePins?: Coordinate[];   // locations where user paused (rendered as flag pins)
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
  clearSessions: () => void;       // called on logout to remove prior user's data
  getSessions: () => TrackingSession[];
  getSessionsByRegion: (regionCode: string) => TrackingSession[];
  hydrate: (userId?: string) => Promise<void>;
  // v412: 已 Save 未同步 hike 的 syncState 管理
  /** SyncDaemon 上传成功后调用: syncState → 'synced', 更新 remoteId */
  markSynced: (localId: string, remoteId: number) => void;
  /** SyncDaemon 上传前短暂标记 syncing (可选) */
  markSyncing: (localId: string) => void;
  /** 用户长按灰卡"放弃"调用: 从 sessions 数组删除, 不通知服务器 */
  removeLocal: (localId: string) => void;
}

export const useSessionStore = create<SessionState>((set, get) => ({
  sessions: [],
  currentUserId: 'guest',

  addSession: (session) => {
    const userId = get().currentUserId;
    set((s) => {
      // Prepend newest first, prune oldest beyond MAX_SESSIONS
      const next = [session, ...s.sessions].slice(0, MAX_SESSIONS);
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

    // v73: when the incremental flow already created the server row
    // (remoteId set during stopTracking), skip the legacy all-in-one
    // POST. The row was already finalized via PATCH /api/sessions/:id.
    // Without this guard we'd double-insert the session on every save.
    if (session.remoteId != null) return;

    // Sync to backend, capture remote ID
    authenticatedFetch('/api/sessions', {
      method: 'POST',
      body: JSON.stringify({
        type: session.activityMode,
        start_time: new Date(session.startedAt).toISOString(),
        end_time: new Date(session.endedAt).toISOString(),
        distance_m: session.distanceM,
        duration_s: session.durationS,
        // User-assigned name (or our synthesised default). Without this
        // the backend stores null → on next hydrate the activity list
        // shows "Hike" generic instead of what the user typed in the
        // post-stop summary sheet. Reported as v17 bug "I named it 1
        // but Activities still shows Hike".
        name: session.name ?? null,
        route_points: session.trackPoints.length > 0 ? session.trackPoints : null,
        // v77: also send raw audit track. Backend stores in route_points_raw.
        // Only used by legacy "all-in-one POST" path (when start/append/finalize
        // flow couldn't run, e.g. offline at start). Modern flow ships raw
        // via finalizeSession PATCH — this path won't be hit when remoteId
        // is already set (addSession early-returns above).
        route_points_raw: session.trackPointsRaw && session.trackPointsRaw.length > 0
          ? session.trackPointsRaw
          : null,
        flags: session.markerIds.length > 0 ? session.markerIds : null,
      }),
    }).then(async (res) => {
      if (!res.ok) return;
      const data = await res.json().catch(() => null);
      const remoteId = data?.session?.id;
      if (!remoteId) return;
      // Patch remoteId into the stored session
      set((s) => {
        const updated = s.sessions.map((sess) =>
          sess.id === session.id ? { ...sess, remoteId } : sess
        );
        const summaries = updated.map(({ trackPoints: _, ...rest }) => rest);
        storage.setItem(sessionsKey(get().currentUserId), JSON.stringify(summaries));
        return { sessions: updated };
      });
    }).catch(() => {
      // Network failure — session remains in local store without remoteId
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

  getSessionsByRegion: (regionCode) =>
    get().sessions.filter((s) => s.regionCode === regionCode),

  // v412: SyncDaemon 上传成功后调用
  markSynced: (localId, remoteId) => {
    set((s) => {
      const updated = s.sessions.map((sess) =>
        sess.id === localId
          ? { ...sess, remoteId, syncState: 'synced' as const }
          : sess
      );
      const summaries = updated.map(({ trackPoints: _, ...rest }) => rest);
      storage.setItem(sessionsKey(get().currentUserId), JSON.stringify(summaries));
      return { sessions: updated };
    });
  },

  // v412: SyncDaemon 开始上传时短暂标记 (可选, 用于 spinning icon)
  markSyncing: (localId) => {
    set((s) => ({
      sessions: s.sessions.map((sess) =>
        sess.id === localId ? { ...sess, syncState: 'syncing' as const } : sess
      ),
    }));
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
    set({ currentUserId: userId });
    const raw = await storage.getItem(sessionsKey(userId));
    if (raw) {
      try {
        // Sessions loaded without trackPoints (loaded on demand)
        const summaries: Omit<TrackingSession, 'trackPoints'>[] = JSON.parse(raw);
        const sessions: TrackingSession[] = summaries.map((s) => ({
          ...s,
          trackPoints: [],
        }));
        set({ sessions });
      } catch {
        storage.removeItem(sessionsKey(userId));
        set({ sessions: [] });
      }
    } else {
      set({ sessions: [] });
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
