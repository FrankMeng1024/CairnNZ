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
import { isPlaywrightBypass } from '../utils/devFlags';
import { crashLogger } from '../services/crashLogger';
// v405: memorySync attach 从 FGUM 提前到 hydrate,让 stopTracking →
// pushMemoryNow 无论用户是否进过 Memory tab 都能 push。见 happy-path
// 诊断报告 修复 1。
import { attachMemorySync, detachMemorySync } from '../services/memorySync';
import { hydrateMemoryForUser, detachMemoryPersistence } from '../features/memory/services/memoryPersistence';

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
  // O1 batch 37: sessionExpired + setSessionExpired removed — field written by apiService.ts
  // but 0 external readers; logout() reset also removed below.
  logout: () => void;

  // v412 4-eye fix (Critical #4): hydrationTs 供 HikingScreen 的 v412 unfinished recovery
  // useEffect 依赖数组用. hydrate 结束时 set({hydrationTs: Date.now()}), 让 iOS jetsam
  // 后组件 re-mount 或 冷启 hydrate 完成后, useEffect 重跑读盘检测未完成 hike.
  hydrationTs: number;

  // Hydrate persisted settings on app start
  hydrate: () => Promise<void>;
}

export const useAppStore = create<AppState>((set) => ({
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
          try {
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const { registerForPush } = require('../services/pushService');
            registerForPush().catch(() => { /* silent */ });
          } catch { /* silent */ }
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
  // O1 batch 37: sessionExpired + setSessionExpired removed (0 external readers)

  // v412 4-eye fix (Critical #4): 供 HikingScreen recovery useEffect 依赖数组用
  hydrationTs: 0,

  logout: () => {
    crashLogger.breadcrumb('logout:start');
    // O18 batch 6.5: unregister push token before dropping auth state so
    // the /unregister call goes out with a valid token. Fire-and-forget —
    // never let a push failure block sign-out.
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { unregisterCurrent } = require('../services/pushService');
      unregisterCurrent().catch(() => { /* silent */ });
    } catch { /* pushService import failed — silent */ }
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
      // O12: uiMode restore removed. STORAGE_KEY_UI_MODE key on old installs
      // will remain as orphaned MMKV entry — harmless.

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
          // Token 有效 —— pre-warm user-scoped 缓存，但 **不** flip isLoggedIn。
          // AuthScreen 会显示；用户登录成功后 setLoggedIn(true) 即刻可见数据。
          set({ user });
          crashLogger.breadcrumb(`hydrate:cold_boot_prewarm user_id=${user.id}`);
          try { await useMarkerStore.getState().hydrate(user.id); } catch { /* swallow */ }
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
            const remote = await fetchSessions();
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
            const remoteSessions = remote
              .filter((r) => !preservedRemoteIds.has(r.id))
              .map((r) => ({
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
                syncState: 'synced' as const,
              }));
            const merged = [...preservedLocals, ...remoteSessions];
            // O18 SAF-06 (2026-07-29): rebuild orphaned pending rows.
            // If a prior version of the app already wiped the in-memory
            // pending session (bug fixed above), the payload may still be
            // sitting on disk in pendingSyncStore. Rebuild a placeholder
            // TrackingSession for each such file so the user sees the grey
            // card + banner and can retry sync. Placeholders have empty
            // trackPoints (loadTrackPoints will fall back to storage which
            // is empty — the retry itself will re-populate on success via
            // markSynced updating remoteId).
            try {
              // eslint-disable-next-line @typescript-eslint/no-require-imports
              const { listPending } = require('../services/pendingSyncStore');
              const disk = await listPending();
              const existingLocalIds = new Set(merged.map((s) => s.id));
              const orphans = (Array.isArray(disk) ? disk : []).filter((h: any) => (
                h && h.localId && !existingLocalIds.has(h.localId)
              ));
              for (const h of orphans) {
                const payload = h.payload ?? {};
                merged.push({
                  id: h.localId,
                  remoteId: h.remoteId ?? undefined,
                  activityMode: h.activityMode || 'hiking',
                  regionCode: 'nz',
                  startedAt: h.createdAt || Date.now(),
                  endedAt: payload.end_time ? new Date(payload.end_time).getTime() : (h.createdAt || Date.now()),
                  durationS: payload.duration_s || 0,
                  distanceM: payload.distance_m || 0,
                  elevationGainM: 0,
                  trackPoints: [],
                  markerIds: [],
                  name: payload.name || undefined,
                  syncState: 'pending' as const,
                });
              }
              if (orphans.length > 0) {
                crashLogger.breadcrumb(`hydrate:rebuilt_orphan_pending count=${orphans.length}`);
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
