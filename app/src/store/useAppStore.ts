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

      // ── Auth policy (Sprint 72 STORY-00549) ──────────────────────────
      // Cold start behavior:
      //   1. If a logout marker exists → force AuthScreen (do NOT auto-login)
      //      even if a token still exists. User explicitly signed out; respect it.
      //   2. If getMe() returns a valid user AND no logout marker → auto-login
      //      directly to Home. This is the new default, per Sprint 72 user
      //      requirement "没在 hiking 时也不应该动不动回 login".
      //   3. If getMe() returns null (401/403 real token invalid) → AuthScreen.
      //   4. If getMe() throws (network timeout, offline) → keep token,
      //      AuthScreen shown so user can retry / sign in offline. Token is
      //      NOT cleared on network errors (see authService.getMe:121-124).
      crashLogger.breadcrumb('hydrate:start');
      let logoutMarker: string | null = null;
      try {
        logoutMarker = await storage.getItem(STORAGE_KEY_LOGOUT_MARKER);
      } catch { /* swallow */ }
      const hasLogoutMarker = logoutMarker === '1';

      try {
        const user = await getMe();
        if (user && !hasLogoutMarker) {
          // Auto-login: token valid + no active logout marker
          set({ user, isLoggedIn: true });
          crashLogger.breadcrumb(`hydrate:auto_login_success user_id=${user.id}`);
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
          try {
            const remote = await fetchSessions();
            // Pre-load any locally-stored sessions so we can preserve
            // names the user just typed in the post-stop summary —
            // the backend may not have returned them yet (network race
            // condition), and we don't want hydrate to wipe out a
            // freshly-named activity.
            const localSessionStore = useSessionStore.getState();
            const localByRemoteId = new Map<number, string>();
            for (const s of localSessionStore.sessions) {
              if (s.remoteId != null && s.name) {
                localByRemoteId.set(s.remoteId, s.name);
              }
            }
            const sessions = remote.map((r) => ({
              id: String(r.id),
              // Mirror the backend row id so future delete / update calls
              // can target the correct backend record. Without this,
              // deleteSession's "fire-and-forget DELETE" was a no-op for
              // every session that came from the server, leaving zombie
              // rows in the DB after a user "deletes" an activity.
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
              // Prefer backend-stored name; fall back to whatever was
              // in the local cache (covers the race where backend
              // hadn't persisted name yet at fetch time).
              name: r.name ?? localByRemoteId.get(r.id) ?? undefined,
            }));
            useSessionStore.setState({ sessions, currentUserId: user.id });
          } catch {
            // Session fetch failed — fall back to user-scoped local cache
            try { await useSessionStore.getState().hydrate(user.id); } catch { /* swallow */ }
          }
        } else if (user && hasLogoutMarker) {
          // Token still valid but user explicitly signed out — respect marker.
          // Pre-warm data so Sign In feels instant, but do NOT flip isLoggedIn.
          set({ user });
          crashLogger.breadcrumb('hydrate:logout_marker_detected user_prewarmed');
          try { await useMarkerStore.getState().hydrate(user.id); } catch { /* swallow */ }
          try {
            const result = await runA8Migration(user.id);
            if (result.showToast && result.toastMessage) {
              useArOriginStore.getState().setMigrationToast(result.toastMessage);
            }
          } catch { /* swallow */ }
          try { await useArOriginStore.getState().hydrate(user.id); } catch { /* swallow */ }
          try { await useSessionStore.getState().hydrate(user.id); } catch { /* swallow */ }
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
      const activeSid = await AsyncStorage.getItem('cairn_bg_active_session_id');
      if (activeSid) {
        // Get session startedAt from the local session cache (if any).
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
    } catch { /* swallow — best effort */ }

    // Always mark hydrated so App.tsx unblocks the loading View.
    crashLogger.breadcrumb('hydrate:end');
    set({ hydrated: true });
  },
}));
