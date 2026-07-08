/**
 * Cairn Global App Store (Zustand)
 * Single source of truth for UI mode and app-wide state.
 */
import { create } from 'zustand';
import { storage } from './storage';
import { getMe } from '../services/authService';
import { fetchSessions } from '../services/sessionService';
import { useSessionStore, type ActivityMode as SessionActivityMode, type TrackPoint } from './useSessionStore';
import { useMarkerStore } from './useMarkerStore';
import { useArOriginStore } from './useArOriginStore';
import { runA8Migration } from '../services/a8Migration';
import { isPlaywrightBypass } from '../utils/devFlags';
import { crashLogger } from '../services/crashLogger';
// v405: memorySync attach 从 FGUM 提前到 hydrate,让 stopTracking →
// pushMemoryNow 无论用户是否进过 Memory tab 都能 push。见 happy-path
// 诊断报告 修复 1。
import { attachMemorySync, detachMemorySync } from '../services/memorySync';
import { hydrateMemoryForUser, detachMemoryPersistence } from '../features/memory/services/memoryPersistence';

export type UIMode = 'beginner' | 'expert';
export type ActivityMode = 'hiking' | 'running';
export type TrackingState = 'idle' | 'tracking' | 'paused';

export interface UserProfile {
  id: string;
  name: string;
  email: string;
}

const STORAGE_KEY_UI_MODE = 'cairn_ui_mode';
// Sprint 72 STORY-00549: 注销硬清标记 — 用户主动 logout 后写入,
// 冷启动 hydrate 看到此标记 → 强制走 AuthScreen 不做 auto-login。
// 用户下次成功登录时清除此标记。
const STORAGE_KEY_LOGOUT_MARKER = 'cairn_logout_marker';

interface AppState {
  // UI Mode — core of STORY-00006
  uiMode: UIMode;
  setUIMode: (mode: UIMode) => void;

  // Activity mode
  activityMode: ActivityMode;
  setActivityMode: (mode: ActivityMode) => void;

  // Tracking state
  trackingState: TrackingState;
  setTrackingState: (state: TrackingState) => void;

  // Mock elapsed tracking data
  trackingDistance: number;    // km
  trackingDuration: number;    // seconds
  incrementTracking: () => void;

  // Auth
  isLoggedIn: boolean;
  setLoggedIn: (v: boolean) => void;
  user: UserProfile | null;
  setUser: (user: UserProfile | null) => void;
  hydrated: boolean;
  sessionExpired: boolean;
  setSessionExpired: (v: boolean) => void;
  logout: () => void;

  // v412 4-eye fix (Critical #4): hydrationTs 供 HikingScreen 的 v412 unfinished recovery
  // useEffect 依赖数组用. hydrate 结束时 set({hydrationTs: Date.now()}), 让 iOS jetsam
  // 后组件 re-mount 或 冷启 hydrate 完成后, useEffect 重跑读盘检测未完成 hike.
  hydrationTs: number;

  // Sprint 72 STORY-00551: pending unfinished session detected at hydrate.
  // RootNavigator / HomeScreen reads this to show the "Continue your hike?" banner.
  pendingSessionResume: {
    sessionId: string;
    startedAt?: number;
    ageMs?: number;
  } | null;
  setPendingSessionResume: (v: AppState['pendingSessionResume']) => void;

  // Hydrate persisted settings on app start
  hydrate: () => Promise<void>;
}

export const useAppStore = create<AppState>((set) => ({
  uiMode: 'beginner',    // Default: beginner (Explorer) for new users
  setUIMode: (mode) => {
    set({ uiMode: mode });
    storage.setItem(STORAGE_KEY_UI_MODE, mode);
  },

  activityMode: 'hiking',
  setActivityMode: (mode) => set({ activityMode: mode }),

  trackingState: 'idle',
  setTrackingState: (state) => set({ trackingState: state }),

  trackingDistance: 0,
  trackingDuration: 0,
  incrementTracking: () =>
    set((s) => ({
      trackingDistance: Math.round((s.trackingDistance + 0.01) * 100) / 100,
      trackingDuration: s.trackingDuration + 3,
    })),

  isLoggedIn: false,
  setLoggedIn: (v) => set({ isLoggedIn: v }),
  user: null,
  setUser: (user) => set({ user }),
  hydrated: false,
  sessionExpired: false,
  setSessionExpired: (v) => set({ sessionExpired: v }),

  // v412 4-eye fix (Critical #4): 供 HikingScreen recovery useEffect 依赖数组用
  hydrationTs: 0,

  // Sprint 72 STORY-00551
  pendingSessionResume: null,
  setPendingSessionResume: (v) => set({ pendingSessionResume: v }),

  logout: () => {
    crashLogger.breadcrumb('logout:start');
    set({ isLoggedIn: false, user: null, sessionExpired: false });
    crashLogger.breadcrumb('logout:state_cleared');
    useSessionStore.getState().clearSessions();
    crashLogger.breadcrumb('logout:sessions_cleared');
    useMarkerStore.getState().clearMarkers();
    crashLogger.breadcrumb('logout:markers_cleared');
    // v405: 断开 memory sync + memory persistence,避免 logout 后
    // 后续 pushPendingPoints 用旧 userId 推数据到新用户。
    try { detachMemorySync(); } catch { /* swallow */ }
    try { void detachMemoryPersistence(); } catch { /* swallow */ }
    crashLogger.breadcrumb('logout:memory_sync_detached');
    // Sprint 72 STORY-00549: 硬清标记 — 阻止下次冷启动 auto-login。
    // 用户下次点 Sign In 成功后 AuthScreen 清此标记。
    storage.setItem(STORAGE_KEY_LOGOUT_MARKER, '1').catch(() => {});
    crashLogger.breadcrumb('logout:marker_set');
  },

  hydrate: async () => {
    // Outermost try/catch: hydrate must NEVER throw, otherwise the
    // App.tsx await blocks and the loading View renders forever (or
    // worse, RN's default global handler kills the app).
    try {
      const saved = await storage.getItem(STORAGE_KEY_UI_MODE);
      if (saved === 'beginner' || saved === 'expert') {
        set({ uiMode: saved });
      }

      // Playwright bypass: only allowed in __DEV__ to prevent leaking into production builds.
      // Production builds ignore EXPO_PUBLIC_PLAYWRIGHT_BYPASS even if env leaks in.
      if (isPlaywrightBypass) {
        const playwrightUser: UserProfile = { id: '0', name: 'Playwright', email: 'pw@cairn.nz' };
        set({ isLoggedIn: true, user: playwrightUser, hydrated: true });
        return;
      }

      // ── Auth policy (v404 — kill 后必登 / warm 无感) ──────────────────
      // hydrate 只在 App.tsx mount 时跑一次（cold boot）。切后台/回前台
      // JS runtime 存活 → Zustand isLoggedIn 保留 → 不经过这里 → 用户
      // 无感回到 Home。所以 hydrate 触发 = 必然是 cold boot（kill /
      // iOS jetsam / 首次冷启）。
      //
      // 产品规则：任何 cold boot → 强制 AuthScreen，永远不 auto-login。
      // 用户想重开就要重登（记住邮箱 checkbox 已由 AuthScreen 处理）。
      //
      // 但 pre-warm 数据要做：markers/sessions/AR origin 从本地缓存加载
      // user.id 的槽位，登录成功后 UI 立刻可见，无空白等待。
      //
      // token 处理：
      //   - getMe() 成功（token 有效）→ pre-warm user-scoped 缓存，
      //     token 保留（下次登录只需密码）。
      //   - getMe() null（token 真无效）→ guest 缓存 + token 已被
      //     authService.getMe 清（见 authService 401 分支）。
      //   - getMe() throw（网络挂）→ token 保留，走 guest 缓存兜底。
      //
      // logoutMarker 从此变成 no-op（读一下清一下即可），因为无 marker
      // 也不 auto-login，marker 存在意义消失。保留读取只为把老 marker
      // 清干净。
      crashLogger.breadcrumb('hydrate:start');
      try {
        await storage.setItem(STORAGE_KEY_LOGOUT_MARKER, '');
      } catch { /* swallow */ }

      try {
        const user = await getMe();
        if (user) {
          // Token 有效 —— pre-warm user-scoped 缓存，但 **不** flip isLoggedIn。
          // AuthScreen 会显示；用户登录成功后 setLoggedIn(true) 即刻可见数据。
          set({ user });
          crashLogger.breadcrumb(`hydrate:cold_boot_prewarm user_id=${user.id}`);
          try { await useMarkerStore.getState().hydrate(user.id); } catch { /* swallow */ }
          // v0.2.3 Stage 5 — A8 schema migration. Boot order (Plan
          // V2-CONFLICT-2): markerStore hydrate → A8 → arOriginStore
          // hydrate → UI mount. Preserves cairn world coords for v0.2.2
          // upgraders, stamps schemaVersion=2 so A4 FSM can advance from
          // COLD_INIT.
          try {
            const result = await runA8Migration(user.id);
            if (result.showToast && result.toastMessage) {
              useArOriginStore.getState().setMigrationToast(result.toastMessage);
            }
          } catch { /* swallow */ }
          // v0.2.3 Stage 4 — hydrate A4 FSM (useArOriginStore) AFTER
          // markerStore + A8 migration so it sees the stamped schemaVersion.
          try { await useArOriginStore.getState().hydrate(user.id); } catch { /* swallow */ }
          // v405: hydrate memory points from AsyncStorage + attach memory
          // sync. 修复 happy path bug: pre-v405 attachMemorySync 只在
          // MemoryScreen 挂载时跑,用户 hike → save → pushMemoryNow 因
          // activeUserId=null 直接 return, memory_points 表无新增。
          // 现在 cold-boot 就 attach,任何屏幕的 pushMemoryNow 都能 push。
          //
          // 顺序: hydrateMemoryForUser (从 AsyncStorage 载 unsynced points
          // 到 useMemoryStore) → attachMemorySync (subscriber 检测到 unsynced
          // count 就 schedulePush)。反过来会漏掉旧 unsynced points。
          try {
            await hydrateMemoryForUser(user.id);
            crashLogger.breadcrumb(`v405:mem_hydrate_ok user_id=${user.id}`);
          } catch (memErr) {
            crashLogger.breadcrumb(`v405:mem_hydrate_failed ${String(memErr).slice(0, 80)}`);
          }
          try {
            attachMemorySync(user.id);
            crashLogger.breadcrumb(`v405:mem_sync_attached user_id=${user.id}`);
          } catch (attachErr) {
            crashLogger.breadcrumb(`v405:mem_sync_attach_failed ${String(attachErr).slice(0, 80)}`);
          }
          // v404: fetch backend sessions on cold boot even though isLoggedIn=false.
          // 登录成功后 UI 需要立刻看到 activity 列表，避免登录后再等一轮网络。
          try {
            const remote = await fetchSessions();
            const localSessionStore = useSessionStore.getState();
            const localByRemoteId = new Map<number, string>();
            for (const s of localSessionStore.sessions) {
              if (s.remoteId != null && s.name) {
                localByRemoteId.set(s.remoteId, s.name);
              }
            }
            const sessions = remote.map((r) => ({
              id: String(r.id),
              remoteId: r.id,
              activityMode: r.type as SessionActivityMode,
              regionCode: 'nz',
              startedAt: new Date(r.start_time).getTime(),
              endedAt: new Date(r.end_time).getTime(),
              durationS: r.duration_s,
              distanceM: r.distance_m,
              elevationGainM: 0,
              trackPoints: [] as TrackPoint[],
              markerIds: [] as string[],
              name: r.name ?? localByRemoteId.get(r.id) ?? undefined,
            }));
            useSessionStore.setState({ sessions, currentUserId: user.id });
          } catch {
            try { await useSessionStore.getState().hydrate(user.id); } catch { /* swallow */ }
          }
        } else {
          // getMe returned null — token invalid or missing.
          crashLogger.breadcrumb('hydrate:token_invalid_back_to_auth');
          // Not logged in — load from guest slots only
          try { await useSessionStore.getState().hydrate('guest'); } catch { /* swallow */ }
          try { await useMarkerStore.getState().hydrate('guest'); } catch { /* swallow */ }
          try { await runA8Migration('guest'); } catch { /* swallow */ }
          try { await useArOriginStore.getState().hydrate('guest'); } catch { /* swallow */ }
        }
      } catch {
        // Network unavailable — token preserved by getMe (see authService).
        // Fall through to AuthScreen so user can retry.
        crashLogger.breadcrumb('hydrate:network_error_token_preserved');
        try { await useSessionStore.getState().hydrate('guest'); } catch { /* swallow */ }
        try { await useMarkerStore.getState().hydrate('guest'); } catch { /* swallow */ }
        try { await runA8Migration('guest'); } catch { /* swallow */ }
        try { await useArOriginStore.getState().hydrate('guest'); } catch { /* swallow */ }
      }
    } catch (err) {
      // Last-resort safeguard: never block app boot on hydrate.
      // eslint-disable-next-line no-console
      console.warn('[useAppStore.hydrate] caught unexpected:', err);
    }

    // Sprint 72 STORY-00551: check for an unfinished tracking session
    // (survived a force-quit / iOS jetsam kill). If found, expose via
    // pendingSessionResume so RootNavigator can show the "Continue your
    // hike?" banner. Uses AsyncStorage direct read to bypass Zustand
    // hydrate races.
    try {
      // Dynamic import to keep Zustand tests happy (jest 无 AsyncStorage mock)
      const AsyncStorageMod = await import('@react-native-async-storage/async-storage');
      const AsyncStorage = AsyncStorageMod.default ?? AsyncStorageMod;

      // v409 fix #5 migration: 老 key cairn_bg_logging_enabled 若='1'
      // 但当前无 active sid → 清除,防 stale 干扰 Path B。
      try {
        const legacyEnabled = await AsyncStorage.getItem('cairn_bg_logging_enabled');
        const activeSidCheck = await AsyncStorage.getItem('cairn_bg_active_session_id');
        if (legacyEnabled === '1' && !activeSidCheck) {
          await AsyncStorage.removeItem('cairn_bg_logging_enabled');
          crashLogger.breadcrumb('v409:legacy_hike_enabled_migration_cleared');
        }
      } catch { /* ignore */ }

      const activeSid = await AsyncStorage.getItem('cairn_bg_active_session_id');

      // v409 fix #10: 检查 hikeTrackWriter 的 active/ 目录 —— 如果有磁盘
      // JSONL 但 activeSid 不对齐,以磁盘 meta 为准。这样 iOS jetsam 后
      // AsyncStorage 可能被清但磁盘还在时依然能 replay。
      let diskMetas: Array<{ session_id: string; started_at: number; total_points: number }> = [];
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { listActiveHikes } = require('../services/hikeTrackWriter');
        diskMetas = await listActiveHikes();
      } catch { /* best effort */ }

      // Priority: 优先用磁盘 metas (有 started_at + total_points 完整信息)
      if (diskMetas.length > 0) {
        const newest = diskMetas[0];
        const ageMs = Date.now() - newest.started_at;
        if (ageMs > 24 * 60 * 60_000) {
          crashLogger.breadcrumb(`v409:disk_hike_stale_24h id=${newest.session_id}`);
          // >24h 视为 stale, 磁盘不删 (可能想留 debug),只清 AsyncStorage marker
          try { await AsyncStorage.removeItem('cairn_bg_active_session_id'); } catch { /* ignore */ }
        } else {
          crashLogger.breadcrumb(`v409:disk_hike_recovered id=${newest.session_id} pts=${newest.total_points} age_ms=${ageMs}`);
          set({ pendingSessionResume: {
            sessionId: newest.session_id,
            startedAt: newest.started_at,
            ageMs,
          } });
        }
      } else if (activeSid) {
        // Legacy fallback: 老 marker 存在但磁盘无 → 仍走 Sprint 72 STORY-00551 逻辑
        const localSessions = useSessionStore.getState().sessions;
        const found = localSessions.find(s => s.id === activeSid);
        const startedAt = found?.startedAt;
        const ageMs = startedAt ? Date.now() - startedAt : undefined;
        // Stale > 24h → silent end, do NOT surface banner
        if (ageMs != null && ageMs > 24 * 60 * 60_000) {
          crashLogger.breadcrumb(`unfinished_session:silent_end id=${activeSid} reason=stale_24h`);
          try { await AsyncStorage.removeItem('cairn_bg_active_session_id'); } catch { /* ignore */ }
        } else {
          crashLogger.breadcrumb(`unfinished_session:detected id=${activeSid} age_ms=${ageMs ?? 'unknown'}`);
          set({ pendingSessionResume: { sessionId: activeSid, startedAt, ageMs } });
        }
      }

      // v409: cold-start 触发一次 offline queue drain — 防止 kill 前有未
      // 上传的 append/finalize 一直躺在队列里。
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { drain } = require('../services/offlineQueue');
        void drain().catch(() => {});
      } catch { /* best effort */ }
    } catch { /* swallow — best effort */ }

    // v412: 触发 SyncDaemon 扫本地 pendingSyncStore, 后台上传"已 Save 未同步" hike
    // 与 offlineQueue.drain 并行, 互不影响
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { drainPending } = require('../services/syncDaemon');
      void drainPending().catch(() => {});
    } catch { /* best effort */ }

    // Always mark hydrated so App.tsx unblocks the loading View.
    crashLogger.breadcrumb('hydrate:end');
    set({ hydrated: true, hydrationTs: Date.now() });
  },
}));
