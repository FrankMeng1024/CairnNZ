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
// v417: useArOriginStore + runA8Migration deleted
// R21 (2026-08-17): isPlaywrightBypass import removed — bypass block deleted
// below. Real auth flow only, dev + prod identical.
import { crashLogger } from '../services/crashLogger';
// v405: memorySync attach 从 FGUM 提前到 hydrate,让 stopTracking →
// pushMemoryNow 无论用户是否进过 Memory tab 都能 push。见 happy-path
// 诊断报告 修复 1。
import { detachMemorySync } from '../services/memorySync';
import { detachMemoryPersistence } from '../features/memory/services/memoryPersistence';

// O12 (2026-07-27): UIMode / uiMode / setUIMode removed. Was Explorer/Navigator
// double-switch — dead code (only 'brg' placeholder stat used isExpert). Also
// removed STORAGE_KEY_UI_MODE. Persisted 'cairn_ui_mode' key on old installs
// is now orphaned — safe to ignore (MMKV/AsyncStorage will just carry a stale
// entry no one reads). No migration needed.
//
// O12 Round-3 (2026-07-27): also removed mock tracking fields (activityMode /
// setActivityMode / trackingState / setTrackingState / trackingDistance /
// trackingDuration / incrementTracking). Only MapScreen consumed them and
// its whole tracking-bar / start-tracking / mode-modal UI was dead (gated
// behind viewOnly=false paths that no live nav.navigate produces). Real
// activity mode + tracking state live in useTrackingStore.

interface UserProfile {
  id: string;
  name: string;
  email: string;
  // O18 HOME-05: registration timestamp from backend `toPublic`. Optional
  // because older builds and the offline JWT-fallback path (auth.js:287)
  // do not populate it.
  createdAt?: string | null;
  // O18 AUTH-06: date of birth (YYYY-MM-DD or null for legacy pre-migration
  // users). Absence prompts the DOB backfill modal on next login.
  dateOfBirth?: string | null;
  // O18 AUTH-01: soft-delete timestamp; when set backend returns hint=
  // 'pending_deletion' on /login so the client can surface the restore modal.
  deletedAt?: string | null;
  // O18 AUTH-06: OAuth link providers (google, apple...) exposed by /me.
  hasPassword?: boolean;
  providers?: string[];
}

// Sprint 72 STORY-00549: 注销硬清标记 — 用户主动 logout 后写入,
// 冷启动 hydrate 看到此标记 → 强制走 AuthScreen 不做 auto-login。
// 用户下次成功登录时清除此标记。
const STORAGE_KEY_LOGOUT_MARKER = 'cairn_logout_marker';

interface AppState {
  // Auth
  isLoggedIn: boolean;
  setLoggedIn: (v: boolean) => void;
  user: UserProfile | null;
  setUser: (user: UserProfile | null) => void;
  hydrated: boolean;
  // R21 (2026-08-17): re-added sessionExpired flag. When hydrate finds a
  // token but getMe returns 401 (token expired/revoked), we set this true
  // so AuthScreen can show a "Your session has expired" banner above the
  // Sign In form. Cleared on next successful login.
  sessionExpired: boolean;
  setSessionExpired: (v: boolean) => void;
  logout: () => Promise<void>;

  // v412 4-eye fix (Critical #4): hydrationTs 供 HikingScreen 的 v412 unfinished recovery
  // useEffect 依赖数组用. hydrate 结束时 set({hydrationTs: Date.now()}), 让 iOS jetsam
  // 后组件 re-mount 或 冷启 hydrate 完成后, useEffect 重跑读盘检测未完成 hike.
  hydrationTs: number;

  // Hydrate persisted settings on app start
  hydrate: () => Promise<void>;
}

export const useAppStore = create<AppState>((set, get) => ({
  isLoggedIn: false,
  setLoggedIn: (v) => {
    set({ isLoggedIn: v });
    // O18 batch 6.5: fire push registration once the user is actually
    // logged in. Fire-and-forget — never block the UI on the permission
    // prompt or the network round-trip.
    // Sprint 6 round-10 review R10B3 fix: some call sites (AuthScreen
    // register/verify path) call setLoggedIn BEFORE setUser. On those
    // paths, useAppStore.getState().user is still null → we'd skip
    // registerForPush / initializePurchases entirely and the RC SDK
    // would never bind for the new user. Now: retry on the next tick
    // if user is null at first read, giving setUser a chance to run.
    if (v) {
      const runOnce = () => {
        try {
          // Sprint 6 round-14 R14B8: don't fire push/RC if user logged
          // out between the setLoggedIn(true) and this retry firing.
          if (!useAppStore.getState().isLoggedIn) return true;
          const currentUser = useAppStore.getState().user;
          if (!currentUser?.id) return false;
          // 2026-08-31: push disabled — do not request notification
          // permission or register device token. Re-enable together with
          // SettingsScreen Notifications section + backend enqueue calls.
          // try {
          //   // eslint-disable-next-line @typescript-eslint/no-require-imports
          //   const { registerForPush } = require('../services/pushService');
          //   registerForPush().catch(() => { /* silent */ });
          // } catch { /* silent */ }
          try {
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const { initializePurchases } = require('../services/iapService');
            initializePurchases(String(currentUser.id)).catch(() => { /* silent */ });
          } catch { /* silent */ }
          return true;
        } catch { return false; }
      };
      if (!runOnce()) {
        // user is not populated yet — try again after setUser fires.
        setTimeout(() => { runOnce(); }, 100);
        // and again at 1s in case setUser is delayed by hydrate.
        setTimeout(() => { runOnce(); }, 1000);
      }
    }
  },
  user: null,
  setUser: (user) => set({ user }),
  hydrated: false,
  // R21 (2026-08-17): sessionExpired flag, default false.
  sessionExpired: false,
  setSessionExpired: (v) => set({ sessionExpired: v }),
  // O1 batch 37: sessionExpired + setSessionExpired removed (0 external readers)

  // v412 4-eye fix (Critical #4): 供 HikingScreen recovery useEffect 依赖数组用
  hydrationTs: 0,

  logout: async () => {
    crashLogger.breadcrumb('logout:start');
    // Immediately revoke any live recorder from the outgoing account. This
    // begins synchronously and hides the store before auth state changes;
    // durable owner-scoped recovery data remains for a later matching login.
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { useTrackingStore } = require('./useTrackingStore');
      await useTrackingStore.getState().suspendForUserSwitch();
      crashLogger.breadcrumb('logout:activity_suspended');
    } catch (error) {
      crashLogger.breadcrumb(`logout:activity_suspend_failed ${String(error).slice(0, 80)}`);
      // Do not release the account while its native lease cannot be proven
      // disabled. The caller may retry once durable storage is available.
      throw error;
    }
    // O18 batch 6.5: unregister push token before dropping auth state so
    // the /unregister call goes out with a valid token. Fire-and-forget —
    // never let a push failure block sign-out.
    // 2026-08-31: push disabled — unregister call is a no-op if no token
    // was ever registered, but skip the require() to avoid loading the
    // module unnecessarily.
    // try {
    //   // eslint-disable-next-line @typescript-eslint/no-require-imports
    //   const { unregisterCurrent } = require('../services/pushService');
    //   unregisterCurrent().catch(() => { /* silent */ });
    // } catch { /* pushService import failed — silent */ }
    // Sprint 6 round-9 review R9B6: log out of RevenueCat so post-logout
    // purchases don't attribute to the just-signed-out user's RC account.
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { resetPurchases } = require('../services/iapService');
      resetPurchases().catch(() => { /* silent */ });
    } catch { /* iapService import failed — silent */ }
    set({ isLoggedIn: false, user: null });
    crashLogger.breadcrumb('logout:state_cleared');
    useSessionStore.getState().clearSessions();
    crashLogger.breadcrumb('logout:sessions_cleared');
    useMarkerStore.getState().clearMarkers();
    crashLogger.breadcrumb('logout:markers_cleared');
    // Detach while the outgoing user's in-memory snapshot is still present.
    // detachMemoryPersistence snapshots synchronously before its first await;
    // clearing the store first used to overwrite Account A's durable Memory
    // with an empty payload during logout.
    try { detachMemorySync(); } catch { /* swallow */ }
    try { await detachMemoryPersistence(); } catch { /* durable store remains authoritative */ }
    crashLogger.breadcrumb('logout:memory_sync_detached');
    // Round-5 R5-M6: also clear memory points + H3 fog cells so the next
    // sign-in doesn't briefly show the previous user's data. Pre-fix,
    // ForegroundUnlockManager cleaned this up on the next foreground tick
    // (~100ms delay) — enough time for SettingsScreen memoryPointCount to
    // flash ghost stats. Now cleared synchronously with markers/sessions.
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { useMemoryStore } = require('../features/memory/store/useMemoryStore');
      useMemoryStore.getState().resetForUserSwitch();
      crashLogger.breadcrumb('logout:memory_reset');
    } catch { /* swallow — memoryStore may not be initialized on cold-boot logout */ }
    // Hide the emergency Save payload from the signed-out UI, but preserve
    // its per-user durable copy. Logout is not account deletion; the original
    // owner may need to resume recovery after signing in again.
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { useTrackingStore } = require('./useTrackingStore');
      useTrackingStore.setState({ saveLostSessionId: null, saveLostPayload: null });
      crashLogger.breadcrumb('logout:saf01_hidden');
    } catch { /* swallow — trackingStore or storage not loaded */ }
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
      // O12: uiMode restore removed. STORAGE_KEY_UI_MODE key on old installs
      // will remain as orphaned MMKV entry — harmless.

      // R21 (2026-08-17): Playwright bypass removed. All boots (dev + prod)
      // follow the same real flow: cold boot → AuthScreen. If a valid JWT
      // is on disk, AuthScreen's own effect calls getMe() and auto-navigates
      // to Home. If not, user signs in manually. No more bypass fake user.

      // ── Auth policy (v404 — kill 后必登 / warm 无感) ──────────────────
      // hydrate 只在 App.tsx mount 时跑一次（cold boot）。切后台/回前台
      // JS runtime 存活 → Zustand isLoggedIn 保留 → 不经过这里 → 用户
      // 无感回到 Home。所以 hydrate 触发 = 必然是 cold boot（kill /
      // iOS jetsam / 首次冷启）。
      //
      // 产品规则：任何 cold boot → 强制 AuthScreen，永远不 auto-login。
      // 用户想重开就要重登（记住邮箱 checkbox 已由 AuthScreen 处理）。
      //
      // 但 pre-warm 数据要做：markers/sessions 从本地缓存加载
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
          // R21 (2026-08-17): unified auth flow — if getMe succeeds during
          // hydrate, we set BOTH user AND isLoggedIn=true. Previously
          // (v404 rule) hydrate only pre-warmed user and left isLoggedIn
          // false so the user always had to sign in again after a cold boot.
          // User now wants auto-login on cold boot when a valid token
          // exists (matches modern mobile app UX). AuthScreen's mount
          // useEffect will nav.replace('Home') on the same tick because
          // the RootNavigator gate `isLoggedIn && user` now flips true.
          set({ user, isLoggedIn: true });
          crashLogger.breadcrumb(`hydrate:cold_boot_prewarm user_id=${user.id}`);
          try { await useMarkerStore.getState().hydrate(user.id); } catch { /* swallow */ }
          // O41: canonical Memory initialization is owned by AppRoot's
          // authenticated-user effect. Keeping it out of this cold-boot-only
          // function also covers password, Apple, registration, and account
          // restore login paths without depending on a screen lifecycle.
          // v404: fetch backend sessions on cold boot even though isLoggedIn=false.
          // 登录成功后 UI 需要立刻看到 activity 列表，避免登录后再等一轮网络。
          try {
            // O18 SAF-06 (2026-07-29): hydrate MUST preserve local pending
            // sessions (syncState='pending' / 'syncing'). Pre-fix, this block
            // did `setState({ sessions: remote.map(...) })` which wiped the
            // in-memory pending-sync sessions the user had just saved (v412
            // atomic-save failed → session stored locally with syncState:
            // 'pending', addSession fired, UI shows grey card + HomeScreen
            // pending banner). Then cold-boot / background→foreground fired
            // this hydrate, remote list didn't include those locals (they
            // never reached the server), setState replaced sessions → cards
            // + banner both silently disappeared. User's data is not lost
            // (pendingSyncStore filesystem still holds the payload) but the
            // UI has no way to surface it, so users think the app ate their
            // hike. Fix: load local storage first (which correctly captures
            // syncState), keep anything with pending/syncing state OR no
            // remoteId (never uploaded), then merge remote list on top for
            // synced rows.
            await useSessionStore.getState().hydrate(user.id);
            const beforeMerge = useSessionStore.getState().sessions;
            const preservedLocals = beforeMerge.filter((s) =>
              s.syncState === 'pending' ||
              s.syncState === 'syncing' ||
              s.remoteId == null
            );
            // R96 修补 C.2: fetchSessions 5xx/网络错时不清 UI。
            // 之前 fetchSessions 遇 500 静默返回 [],这里无条件用空数组
            // 覆盖 → 用户 activity 卡片全消失(即使本地 AsyncStorage 里还
            // 有数据)。现在 5xx 会 throw,此处 catch 后 remote=null,
            // 意味"保持本地状态,不 merge"。
            let remote: Awaited<ReturnType<typeof fetchSessions>> | null = null;
            try {
              remote = await fetchSessions();
            } catch (e) {
              // 服务器错/网络错 → 保留本地 hydrate 结果,不清 UI
              crashLogger.breadcrumb(`hydrate:fetchSessions_failed ${String(e).slice(0, 60)} — keeping local state`);
              remote = null;
            }
            const localByRemoteId = new Map<number, string>();
            for (const s of beforeMerge) {
              if (s.remoteId != null && s.name) {
                localByRemoteId.set(s.remoteId, s.name);
              }
            }
            // Dedupe: any remote row whose id matches a preserved local's
            // remoteId means the local uploaded before this hydrate ran —
            // prefer the remote authoritative copy in that case.
            const preservedRemoteIds = new Set(
              preservedLocals.map((s) => s.remoteId).filter((v): v is number => v != null)
            );
            const preservedClientIds = new Set(
              preservedLocals.map((s) => s.clientActivityId ?? s.id),
            );
            // R96 修补 C.2: remote === null 表示 fetchSessions 失败(5xx/网络错)。
            // 此时 remoteSessions=[] + preservedLocals 拿到全部 beforeMerge
            // 意味 "保留本地不清 UI"。如果 remote 是真实数组(可能为空),
            // 走正常 merge。
            const remoteSessions = remote == null
              ? []
              : remote
                  .filter((r) => !preservedRemoteIds.has(r.id))
                  .filter((r) => !r.client_activity_id || !preservedClientIds.has(r.client_activity_id))
                  .map((r) => ({
                    id: r.client_activity_id || String(r.id),
                    clientActivityId: r.client_activity_id || undefined,
                    remoteId: r.id,
                    serverActivityId: r.id,
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
                    syncState: 'synced' as const,
                  }));
            // remote 失败时不能丢已 hydrate 的 synced sessions,补一份进来
            const preservedAllLocals = remote == null
              ? beforeMerge  // 保留全部本地(含 synced 已从本地 hydrate 的)
              : preservedLocals;
            const merged = [...preservedAllLocals, ...remoteSessions];
            // The verified pending file is the completion intent. Roll every
            // owner-matching intent forward into both durable Detail storage
            // and completed-local lifecycle before recovery detection runs.
            // This covers process death after phase 1 (intent), phase 2
            // (summary/trace), or phase 3 (registry completion).
            try {
              // eslint-disable-next-line @typescript-eslint/no-require-imports
              const { listPending } = require('../services/pendingSyncStore');
              const disk = await listPending();
              const ownedIntents = (Array.isArray(disk) ? disk : []).filter((h: any) => (
                h
                && h.localId
                && String(h.userId ?? '') === String(user.id)
              ));
              for (const h of ownedIntents) {
                const { reconcileCompletedActivityIntent } = require('../features/activity/completedActivityIntent');
                const completedLocal = await reconcileCompletedActivityIntent(String(user.id), h);
                const existingIndex = merged.findIndex((session) => (
                  session.id === h.localId
                  || (h.remoteId != null && session.remoteId === h.remoteId)
                ));
                if (existingIndex >= 0) merged[existingIndex] = completedLocal;
                else merged.push(completedLocal);
              }
              if (ownedIntents.length > 0) {
                crashLogger.breadcrumb(`hydrate:reconciled_completed_intents count=${ownedIntents.length}`);
              }
            } catch (orphanErr) {
              crashLogger.breadcrumb(`hydrate:orphan_rebuild_failed ${String(orphanErr).slice(0, 80)}`);
            }
            useSessionStore.setState({ sessions: merged, currentUserId: user.id });
            crashLogger.breadcrumb(
              `hydrate:merged preserved=${preservedLocals.length} remote=${remoteSessions.length}`
            );
          } catch {
            try { await useSessionStore.getState().hydrate(user.id); } catch { /* swallow */ }
          }
        } else {
          // getMe returned null — token invalid or missing.
          crashLogger.breadcrumb('hydrate:token_invalid_back_to_auth');
          // R21 (2026-08-17): distinguish "no token" (fresh install / signed
          // out) from "invalid token" (session expired). Check disk for a
          // token; if one exists, backend rejected it → flag session
          // expired so AuthScreen shows the "Your session has expired"
          // banner above Sign In.
          try {
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const { getToken } = require('../services/tokenStore');
            const t = await getToken();
            if (t) {
              set({ sessionExpired: true });
              crashLogger.breadcrumb('hydrate:session_expired_flag_set');
            }
          } catch { /* swallow */ }
          // Not logged in — load from guest slots only
          try { await useSessionStore.getState().hydrate('guest'); } catch { /* swallow */ }
          try { await useMarkerStore.getState().hydrate('guest'); } catch { /* swallow */ }
        }
      } catch {
        // Network unavailable — token preserved by getMe (see authService).
        // Fall through to AuthScreen so user can retry.
        crashLogger.breadcrumb('hydrate:network_error_token_preserved');
        try { await useSessionStore.getState().hydrate('guest'); } catch { /* swallow */ }
        try { await useMarkerStore.getState().hydrate('guest'); } catch { /* swallow */ }
      }
    } catch (err) {
      // Last-resort safeguard: never block app boot on hydrate.
      // eslint-disable-next-line no-console
      console.warn('[useAppStore.hydrate] caught unexpected:', err);
    }

    // Sprint 72 STORY-00551: check for an unfinished tracking session
    // (survived a force-quit / iOS jetsam kill). Uses AsyncStorage direct
    // read to bypass Zustand hydrate races.
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

      // Priority: durable file + registry identity. Unfinished Activities do
      // not silently expire after an arbitrary time horizon.
      if (diskMetas.length > 0) {
        const newest = diskMetas[0];
        crashLogger.breadcrumb(`activity:disk_recoverable id=${newest.session_id} pts=${newest.total_points}`);
        const currentUserId = String(get().user?.id ?? '');
        if (currentUserId) {
          try {
            const { ensureUnfinishedActivityRegistry } = require('../features/activity/activityRecovery');
            await ensureUnfinishedActivityRegistry(currentUserId);
          } catch (registryError) {
            crashLogger.breadcrumb(`activity:registry_migration_failed ${String(registryError).slice(0, 80)}`);
          }
        }
      } else if (activeSid) {
        // Legacy fallback: 老 marker 存在但磁盘无 → 仍走 Sprint 72 STORY-00551 逻辑
        const localSessions = useSessionStore.getState().sessions;
        const found = localSessions.find(s => s.id === activeSid);
        const startedAt = found?.startedAt;
        const ageMs = startedAt ? Date.now() - startedAt : undefined;
        crashLogger.breadcrumb(`unfinished_session:detected id=${activeSid} age_ms=${ageMs ?? 'unknown'}`);
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

    // Weather pre-fetch: fire-and-forget in parallel with hydrate completion.
    // Uses locationOverride if set (dev/testing), otherwise tries GPS.
    // 4s internal timeout in fetchWeather — never blocks app boot.
    try {
      const { useWeatherStore } = require('./useWeatherStore');
      const { locationOverride, fetchWeather } = useWeatherStore.getState();
      if (locationOverride) {
        void fetchWeather(locationOverride.lat, locationOverride.lon);
      } else {
        // Try last-known coords from expo-location (fast, no new permission needed).
        import('expo-location').then((Location) => {
          Location.getLastKnownPositionAsync({}).then((pos) => {
            if (pos?.coords) {
              void fetchWeather(pos.coords.latitude, pos.coords.longitude);
            }
          }).catch(() => {/* no cached position — weather stays at default */});
        }).catch(() => {/* expo-location unavailable on web */});
      }
    } catch { /* swallow — weather is non-critical */ }

    // Always mark hydrated so App.tsx unblocks the loading View.
    crashLogger.breadcrumb('hydrate:end');
    set({ hydrated: true, hydrationTs: Date.now() });
  },
}));
