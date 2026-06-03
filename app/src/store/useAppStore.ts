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

  logout: () => {
    crashLogger.breadcrumb('logout:start');
    set({ isLoggedIn: false, user: null, sessionExpired: false });
    crashLogger.breadcrumb('logout:state_cleared');
    useSessionStore.getState().clearSessions();
    crashLogger.breadcrumb('logout:sessions_cleared');
    useMarkerStore.getState().clearMarkers();
    crashLogger.breadcrumb('logout:markers_cleared');
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

      // ── Auth policy ────────────────────────────────────────────────────
      // The user must always go through the Sign In screen on a cold
      // start, even if a JWT is still valid in storage. We hydrate the
      // user-scoped data ahead of time (so Sign In feels instant once
      // the user taps it) but DO NOT flip isLoggedIn to true here. The
      // AuthScreen "Remember me" flow is responsible for putting the
      // user into Home.
      try {
        const user = await getMe();
        if (user) {
          // Token still valid — pre-warm this user's data, but keep
          // isLoggedIn=false so the splash + Sign In renders.
          set({ user });
          try { await useMarkerStore.getState().hydrate(user.id); } catch { /* swallow */ }
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
        } else {
          // Not logged in — load from guest slots only
          try { await useSessionStore.getState().hydrate('guest'); } catch { /* swallow */ }
          try { await useMarkerStore.getState().hydrate('guest'); } catch { /* swallow */ }
        }
      } catch {
        // Network unavailable — guest fallback
        try { await useSessionStore.getState().hydrate('guest'); } catch { /* swallow */ }
        try { await useMarkerStore.getState().hydrate('guest'); } catch { /* swallow */ }
      }
    } catch (err) {
      // Last-resort safeguard: never block app boot on hydrate.
      // eslint-disable-next-line no-console
      console.warn('[useAppStore.hydrate] caught unexpected:', err);
    }
    // Always mark hydrated so App.tsx unblocks the loading View.
    set({ hydrated: true });
  },
}));
