/**
 * Foreground unlock subscriber + memory tile hydration.
 *
 * When the app is in the foreground:
 *   - Subscribes to expo-location updates and feeds them to the unlock
 *     engine so memory fog clears as the user walks around.
 *   - Hydrates the memory tile bitmap from AsyncStorage when the user
 *     ID becomes known (post-auth) and persists subsequent changes.
 *
 * Lifecycle:
 *   - On app foreground + user known: start the watcher (expo-location).
 *   - On app background: stop the watcher.
 *   - On user toggle off (Settings): stop the watcher.
 *   - On user logout / change: detach persistence subscription, flush
 *     pending writes, then re-hydrate for the new user.
 *
 * Triggered from the app root via <ForegroundUnlockManager />.
 * Renders nothing — pure side-effect component.
 */

import { useEffect, useRef } from 'react';
import { AppState, InteractionManager } from 'react-native';
import * as Location from 'expo-location';
// O1: unlockEngine deleted — memory unlock now only via flushHikingToMemory + sim-walker
import { useMemorySettingsStore } from '../store/useMemorySettingsStore';
import { useAppStore } from '../../../store/useAppStore';
import { useMemoryStore } from '../store/useMemoryStore';
import { useMarkerStore } from '../../../store/useMarkerStore';
import { useTrackingStore } from '../../../store/useTrackingStore';
import { hydrateMemoryForUser, detachMemoryPersistence, flushMemoryNow } from '../services/memoryPersistence';
// O1: unlockEngine service deleted — real-time GPS auto-unlock has been
// dead since v322 (ForegroundUnlockManager watcher body has early `return`).
// Memory now only unlocks via flushHikingToMemory (Save Hike) + sim-walker.
// v305 OTA: H3 hex-cell fog layer — replaces turf.union polygon path.
import { hydrateH3ForUser, detachH3Persistence, flushH3Now } from '../services/h3Persistence';
import { attachMemorySync, detachMemorySync, pullMemoryFromServer, pushMemoryNow } from '../../../services/memorySync';
import { log } from '../../../services/appLog';

// BUG-E fix (v371 post-OTA): tracks which userIds we've already
// reconciled this app-session. First pull per user uses reconcile=true
// (full server sweep + replace) so server-side deletes propagate to
// client cache. Subsequent pulls in the same session use the cheaper
// incremental keyset cursor. Cleared on process restart (module re-eval).
const reconciledUsersThisSession = new Set<string>();

const WATCH_OPTIONS: Location.LocationOptions = {
  accuracy: Location.Accuracy.BestForNavigation,
  timeInterval: 2_000,    // 2s between readings — enough for walking pace
  distanceInterval: 5,    // OR 5m of motion, whichever comes first
};

export function ForegroundUnlockManager() {
  // v312: mark mount so we can see whether ForegroundUnlockManager
  // ever renders. v311 server data showed boot dying after AuthScreen
  // mounted — checking if FGUM mount runs at all.
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('../../../services/bootDiagnostics').markBootPhase('fgum_render_enter');
  } catch {/* ignore */}
  const enabled = useMemorySettingsStore((s) => s.foregroundAutoUnlockEnabled);
  // Q9 + R6: recordMode gates whether watcher should record without
  // an active session. `status` includes 'tracking' AND 'paused' as
  // active session phases (lastCoordinate is null during pause but
  // user is still in a session).
  const recordMode = useMemorySettingsStore((s) => s.recordMode);
  const trackingStatus = useTrackingStore((s) => s.status);
  const sessionActive = trackingStatus === 'tracking' || trackingStatus === 'paused';
  const userId = useAppStore((s) => s.user?.id ?? null);
  // v314 fix: also require isLoggedIn=true. v312/v313 server data showed
  // hydrate+pull running with isLoggedIn=false but user.id present
  // (session-expired state: user object hydrated from cache but auth
  // gate still gated). pullMemoryFromServer then hits /api/memory/points
  // with stale token → server returns full payload → res.json() of MB-sized
  // body sync-blocks main thread → iOS watchdog (~9s) SIGKILL.
  const isLoggedIn = useAppStore((s) => s.isLoggedIn);
  const effectiveUserId = isLoggedIn ? userId : null;
  const subRef = useRef<Location.LocationSubscription | null>(null);
  // Read latest `enabled` from a ref inside async closures so a toggle
  // mid-AppState transition doesn't fire the wrong branch.
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  const recordModeRef = useRef(recordMode);
  recordModeRef.current = recordMode;
  const sessionActiveRef = useRef(sessionActive);
  sessionActiveRef.current = sessionActive;

  // Memory tile hydration tied to user identity.
  // v0.2.6.2 fix (J1 B3): track a generation token so the cleanup +
  // re-hydrate sequence cannot interleave under fast user switch.
  const userGenRef = useRef(0);
  useEffect(() => {
    // v312: fine-grained user-effect anchor.
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('../../../services/bootDiagnostics').markBootPhase('fgum_user_effect_enter', {
        hasUserId: !!userId,
        isLoggedIn: !!isLoggedIn,
        effective: !!effectiveUserId,
      });
    } catch {/* ignore */}
    const myGen = ++userGenRef.current;
    // v314 fix: only enter hasUser branch if effectively logged in
    // (user.id AND isLoggedIn). Otherwise treat as no-user (clean up).
    if (!effectiveUserId) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('../../../services/bootDiagnostics').markBootPhase('fgum_user_effect_no_user_branch');
      } catch {/* ignore */}
      void (async () => {
        try {
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          require('../../../services/bootDiagnostics').markBootPhase('fgum_nouser_async_enter');
        } catch {/* ignore */}
        await detachMemoryPersistence();
        try {
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          require('../../../services/bootDiagnostics').markBootPhase('fgum_nouser_after_detach_memory');
        } catch {/* ignore */}
        await detachH3Persistence();
        try {
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          require('../../../services/bootDiagnostics').markBootPhase('fgum_nouser_after_detach_h3');
        } catch {/* ignore */}
        if (myGen !== userGenRef.current) return;
        detachMemorySync();
        useMemoryStore.getState().resetForUserSwitch();
        // O4 fix (v0.2.6.3): also clear cross-user marker state so
        // CairnPinsLayer doesn't flash the previous user's pins.
        useMarkerStore.getState().clearMarkers();
        try {
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          require('../../../services/bootDiagnostics').markBootPhase('fgum_nouser_async_done');
        } catch {/* ignore */}
      })();
      return;
    }
    // v315 fix: wrap the heavy hydrate+pull chain in
    // InteractionManager.runAfterInteractions so it yields to UI thread
    // before doing sync-blocking JSON.parse / fetch. This is critical
    // because the chain runs RIGHT AFTER login (setLoggedIn → fgum
    // useEffect re-runs → enters hasUser branch). Login transition
    // animation + Home screen mount must complete first; otherwise the
    // JSON.parse on memory cache blocks the main thread mid-transition
    // and triggers iOS watchdog SIGKILL.
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('../../../services/bootDiagnostics').markBootPhase('fgum_hasuser_scheduled');
    } catch {/* ignore */}
    // v354 fix: 5000ms → 100ms. The original v320 5s defer was
    // protecting against h3-js emscripten 32MB alloc + Mapbox tile
    // init colliding on Home mount → iOS watchdog SIGKILL. Three
    // things have since neutralised that risk:
    //   (1) v323 replaced h3-js (WASM) with h3Pure (pure JS, zero
    //       heap pressure, sync ~5ms)
    //   (2) v320 added 500KB Content-Length guard in pullMemoryFromServer
    //       blocking the huge res.json() that could 9s-freeze Hermes
    //   (3) v322 moved FGUM into MemoryScreen so it doesn't run on
    //       Home tab mount anymore — only when user explicitly opens
    //       Memory, where there's no concurrent OtaBadge re-check
    // The 5s defer now only adds 5000ms of empty fog to Memory tab
    // first paint with no protection benefit. Telemetry on v353 boot
    // confirmed: Memory tab → 5000ms wait → memhydrate → fog. Pure
    // dead time. 100ms is enough to let the navigation transition
    // animation complete without competing for the main thread on
    // the heavy hydrate burst.
    setTimeout(() => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('../../../services/bootDiagnostics').markBootPhase('fgum_hasuser_interaction_done');
      } catch {/* ignore */}
      if (myGen !== userGenRef.current) return;
      void (async () => {
        try {
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          require('../../../services/bootDiagnostics').markBootPhase('fgum_hasuser_async_enter');
        } catch {/* ignore */}
        detachMemorySync();
        // v345 fix: only clear marker store on actual user switch — NOT
        // on every FGUM mount. Pre-v345 this fired clearMarkers() on
        // every Memory-tab open (v322 moved FGUM into MemoryScreen, so
        // FGUM mounts/unmounts on each tab focus); the 5s setTimeout
        // delay + clearMarkers() chain produced "markers visible for
        // 5s, then disappear, only fixed by app kill" — useMarkerStore
        // re-hydrate is only wired in useAppStore at login time, never
        // in FGUM, so the cleared store stayed empty until next cold
        // start. Now only clear when the marker store's tracked userId
        // doesn't match the effective userId (real user switch).
        const markerStore = useMarkerStore.getState();
        if (markerStore.userId && markerStore.userId !== effectiveUserId) {
          markerStore.clearMarkers();
        }
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('../../../services/bootDiagnostics').markBootPhase('fgum_hasuser_before_hydrate_h3');
      } catch {/* ignore */}
      // v305 OTA: H3 cache hydrate first (fast path — fog visible
      // immediately if cache exists). Then hydrateMemoryForUser fires
      // replacePoints which is the canonical rebuild of cells from
      // points (source of truth). If H3 cache was stale or missing,
      // replacePoints fixes it. No separate migration step needed.
      await hydrateH3ForUser(effectiveUserId);
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('../../../services/bootDiagnostics').markBootPhase('fgum_hasuser_after_hydrate_h3');
      } catch {/* ignore */}
      if (myGen !== userGenRef.current) return;
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('../../../services/bootDiagnostics').markBootPhase('fgum_hasuser_before_hydrate_memory');
      } catch {/* ignore */}
      await hydrateMemoryForUser(effectiveUserId);
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('../../../services/bootDiagnostics').markBootPhase('fgum_hasuser_after_hydrate_memory');
      } catch {/* ignore */}
      if (myGen !== userGenRef.current) return;
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('../../../services/bootDiagnostics').markBootPhase('fgum_hasuser_before_attach_sync');
      } catch {/* ignore */}
      attachMemorySync(effectiveUserId);
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('../../../services/bootDiagnostics').markBootPhase('fgum_hasuser_after_attach_sync');
      } catch {/* ignore */}
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('../../../services/bootDiagnostics').markBootPhase('fgum_hasuser_before_pull_memory');
      } catch {/* ignore */}
      // BUG-E fix (v371 post-OTA): first pull per session is reconcile-mode
      // so server-side deletes (e.g. Sprint 67 Story-526 9163 cleanup)
      // wipe stale local cache. Subsequent pulls in the same session run
      // in incremental keyset mode (default) for efficiency.
      const wasReconciled = reconciledUsersThisSession.has(effectiveUserId);
      if (!wasReconciled) {
        reconciledUsersThisSession.add(effectiveUserId);
        void pullMemoryFromServer(effectiveUserId, { reconcile: true });
      } else {
        void pullMemoryFromServer(effectiveUserId);
      }
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('../../../services/bootDiagnostics').markBootPhase('fgum_hasuser_after_pull_memory_dispatched');
      } catch {/* ignore */}
      })();
    }, 100);  // v354: was 5000 — see v354 comment block ~line 140
    return () => {
      // Cleanup runs synchronously but may chain async work. Bumping
      // the gen ref lets in-flight async fall out of the race.
      userGenRef.current++;
      void (async () => {
        await detachMemoryPersistence();
        await detachH3Persistence();
        detachMemorySync();
      })();
    };
  }, [effectiveUserId]);

  // GPS watcher tied to enabled flag + app state.
  // v318: also gate on isLoggedIn. Pre-login GPS readings were triggering
  // performInitialRevealIfNeeded → recordCircleUnlock → bulkImport → store
  // subscriber chain (memoryPersistence.scheduleFlush) — and crashing
  // before user could complete login. GPS data is only useful AFTER login
  // anyway (no user → nowhere to record fog clearing).
  const isLoggedInForGps = useAppStore((s) => s.isLoggedIn);
  useEffect(() => {
    let cancelled = false;
    // Serialize concurrent start() calls so a fast inactive→active
    // bounce doesn't create two subscriptions.
    let starting = false;

    const start = async () => {
      if (starting || cancelled || subRef.current) return;
      starting = true;
      try {
        const { status } = await Location.getForegroundPermissionsAsync();
        if (status !== 'granted') return;
        if (cancelled || subRef.current) return;
        const sub = await Location.watchPositionAsync(WATCH_OPTIONS, (loc) => {
          if (cancelled) return;
          // R4 fix (v0.2.6.4): cache the latest fix for MemoryScreen
          // even if recordMode gates the actual fog clearing — this
          // way Memory tab opens fast without competing for GPS.
          useMemoryStore.getState().setLastWatcherFix(
            loc.coords.latitude,
            loc.coords.longitude,
            loc.timestamp ?? Date.now(),
          );
          // v334: PHASE 2 deferred (after 2026-07-01 eas build).
          // v333 product decision: Memory unlocks ONLY via the hiking-save
          // activity → memory transaction. Standing still / panning the
          // map / opening Memory tab MUST NOT auto-unlock cells around
          // the user — that contradicts "no hike imported = ALL fog".
          // The setLastWatcherFix above is kept because it powers the
          // UserLocation blue dot + stableCoord flicker fix, both of
          // which are pure VISUAL position rendering (no fog clearing).
          // O1: removed dead branch (was `return;` then unreachable code
          // calling performInitialRevealIfNeeded/processReading). The
          // unlockEngine service is deleted in O1 as memory only unlocks
          // via flushHikingToMemory (Save Hike) + sim-walker.
          return;
        });
        log('memory.watcher_started', { mode: recordModeRef.current });
        if (cancelled) {
          sub.remove();
        } else {
          subRef.current = sub;
        }
      } catch {
        // expo-location can throw if location services are off at OS
        // level. Silent fail — user simply won't see fog clear; nothing
        // crashes.
      } finally {
        starting = false;
      }
    };

    const stop = () => {
      if (subRef.current) {
        subRef.current.remove();
        subRef.current = null;
      }
    };

    const handleAppState = (state: string) => {
      if (state === 'active' && enabledRef.current) {
        void start();
      } else if (state === 'background') {
        // Distinguish 'background' (real absence) from 'inactive'
        // (transient — control center, multitask switcher). Stop only
        // on real background, force-flush memory to disk AND push
        // pending points to the server before iOS suspends the JS
        // thread.
        stop();
        void flushMemoryNow();
        void flushH3Now();
        void pushMemoryNow();
      }
      // 'inactive': do nothing — keep the watcher alive briefly to
      // survive transient OS interactions.
    };

    if (enabled && isLoggedInForGps && (AppState.currentState === 'active' || AppState.currentState === 'inactive' || AppState.currentState === 'unknown')) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('../../../services/bootDiagnostics').markBootPhase('gps_watcher_starting');
      } catch {/* ignore */}
      void start();
    } else {
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('../../../services/bootDiagnostics').markBootPhase('gps_watcher_gated', {
          enabled: !!enabled,
          loggedIn: !!isLoggedInForGps,
        });
      } catch {/* ignore */}
    }
    const listener = AppState.addEventListener('change', handleAppState);

    return () => {
      cancelled = true;
      listener.remove();
      stop();
    };
  }, [enabled, isLoggedInForGps]);

  return null;
}

