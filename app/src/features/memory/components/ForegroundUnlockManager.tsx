/**
 * Foreground passive recorder + Memory-screen H3 cache hydration.
 *
 * When the app is in the foreground:
 *   - Subscribes to expo-location updates and feeds them to the unlock
 *     engine so memory fog clears as the user walks around.
 *   - Hydrates the optional H3 rendering cache for MemoryScreen.
 *
 * Lifecycle:
 *   - On app foreground + user known: start the watcher (expo-location).
 *   - On app background: stop the watcher.
 *   - On user toggle off (Settings): stop the watcher.
 *   - On user logout / change: detach the screen-local H3 cache.
 *
 * Mounted by MemoryScreen. Canonical Memory hydration and sync are app-scoped;
 * passive GPS ownership lives at app root in PassiveMemoryRecorder.
 * Renders nothing — pure side-effect component.
 */

import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import * as Location from 'expo-location';
// The retired unlockEngine remains intentionally absent. All current
// producers now enter through recordMemoryEvidence below or through the
// explicit Activity recorder.
import { useMemorySettingsStore } from '../store/useMemorySettingsStore';
import { useAppStore } from '../../../store/useAppStore';
import { useMemoryStore } from '../store/useMemoryStore';
import { flushMemoryNow } from '../services/memoryPersistence';
// When managePassiveGps is explicitly enabled this also observes non-Activity
// exploration; Activity capture has its own always-active producer.
// v305 OTA: H3 hex-cell fog layer — replaces turf.union polygon path.
import { hydrateH3ForUser, detachH3Persistence, flushH3Now } from '../services/h3Persistence';
import { pushMemoryNow } from '../../../services/memorySync';
import { log } from '../../../services/appLog';
import { recordMemoryEvidence } from '../services/recordMemoryEvidence';
import { useTrackingStore } from '../../../store/useTrackingStore';

const WATCH_OPTIONS: Location.LocationOptions = {
  accuracy: Location.Accuracy.BestForNavigation,
  timeInterval: 2_000,    // 2s between readings — enough for walking pace
  distanceInterval: 5,    // OR 5m of motion, whichever comes first
};

export function ForegroundUnlockManager({ managePassiveGps = false }: { managePassiveGps?: boolean }) {
  // v312: mark mount so we can see whether ForegroundUnlockManager
  // ever renders. v311 server data showed boot dying after AuthScreen
  // mounted — checking if FGUM mount runs at all.
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('../../../services/bootDiagnostics').markBootPhase('fgum_render_enter');
  } catch {/* ignore */}
  const enabled = useMemorySettingsStore((s) => s.foregroundAutoUnlockEnabled);
  // recordMode is retained only as a diagnostic log field. Product gating is
  // the passive preference plus the explicit no-live-Activity check below.
  const recordMode = useMemorySettingsStore((s) => s.recordMode);
  const userId = useAppStore((s) => s.user?.id ?? null);
  // Require isLoggedIn=true so a cached user object from an expired session
  // cannot hydrate account-scoped screen data under stale auth.
  const isLoggedIn = useAppStore((s) => s.isLoggedIn);
  const effectiveUserId = isLoggedIn ? userId : null;
  const subRef = useRef<Location.LocationSubscription | null>(null);
  // Read latest `enabled` from a ref inside async closures so a toggle
  // mid-AppState transition doesn't fire the wrong branch.
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  const recordModeRef = useRef(recordMode);
  recordModeRef.current = recordMode;

  // MemoryScreen owns only its optional H3 rendering cache. The canonical
  // point store/persistence/server reconcile is app-scoped (useAppStore
  // hydrate) so Home and Memory subscribe to the same authority and opening
  // this screen cannot change whether Home has initialized.
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
      void detachH3Persistence();
      return;
    }
    // Defer the optional H3 cache until the Memory navigation transition has
    // painted; canonical point hydration has already happened app-wide.
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('../../../services/bootDiagnostics').markBootPhase('fgum_hasuser_scheduled');
    } catch {/* ignore */}
    // 100ms is enough to let the navigation animation paint first.
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
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('../../../services/bootDiagnostics').markBootPhase('fgum_hasuser_before_hydrate_h3');
      } catch {/* ignore */}
      // H3 is an optional Memory-screen rendering cache. Canonical Memory
      // points were already hydrated/reconciled by the app authority.
      await hydrateH3ForUser(effectiveUserId);
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('../../../services/bootDiagnostics').markBootPhase('fgum_hasuser_after_hydrate_h3');
      } catch {/* ignore */}
      })();
    }, 100);  // v354: was 5000 — see v354 comment block ~line 140
    return () => {
      // Cleanup runs synchronously but may chain async work. Bumping
      // the gen ref lets in-flight async fall out of the race.
      userGenRef.current++;
      void detachH3Persistence();
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
    if (!managePassiveGps) return;
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
          // The preference controls only passive/non-Activity exploration.
          // Explicit Hike/Run samples use the Activity recorder's mandatory
          // incremental Memory path, so this watcher must not double-produce.
          const activityStatus = useTrackingStore.getState().status;
          if (activityStatus !== 'idle') return;
          void recordMemoryEvidence({
            lat: loc.coords.latitude,
            lng: loc.coords.longitude,
            atMs: loc.timestamp ?? Date.now(),
            source: 'passive',
          });
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
  }, [enabled, isLoggedInForGps, managePassiveGps]);

  return null;
}
