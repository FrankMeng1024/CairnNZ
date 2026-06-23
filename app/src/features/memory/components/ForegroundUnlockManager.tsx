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
import { AppState } from 'react-native';
import * as Location from 'expo-location';
import { processReading, performInitialRevealIfNeeded, resetUnlockEngineForUser } from '../services/unlockEngine';
import { useMemorySettingsStore } from '../store/useMemorySettingsStore';
import { useAppStore } from '../../../store/useAppStore';
import { useMemoryStore } from '../store/useMemoryStore';
import { useMarkerStore } from '../../../store/useMarkerStore';
import { useTrackingStore } from '../../../store/useTrackingStore';
import { hydrateMemoryForUser, detachMemoryPersistence, flushMemoryNow } from '../services/memoryPersistence';
// v305 OTA: H3 hex-cell fog layer — replaces turf.union polygon path.
import { hydrateH3ForUser, detachH3Persistence, flushH3Now } from '../services/h3Persistence';
import { attachMemorySync, detachMemorySync, pullMemoryFromServer, pushMemoryNow } from '../../../services/memorySync';
import { log } from '../../../services/appLog';

const WATCH_OPTIONS: Location.LocationOptions = {
  accuracy: Location.Accuracy.BestForNavigation,
  timeInterval: 2_000,    // 2s between readings — enough for walking pace
  distanceInterval: 5,    // OR 5m of motion, whichever comes first
};

export function ForegroundUnlockManager() {
  const enabled = useMemorySettingsStore((s) => s.foregroundAutoUnlockEnabled);
  // Q9 + R6: recordMode gates whether watcher should record without
  // an active session. `status` includes 'tracking' AND 'paused' as
  // active session phases (lastCoordinate is null during pause but
  // user is still in a session).
  const recordMode = useMemorySettingsStore((s) => s.recordMode);
  const trackingStatus = useTrackingStore((s) => s.status);
  const sessionActive = trackingStatus === 'tracking' || trackingStatus === 'paused';
  const userId = useAppStore((s) => s.user?.id ?? null);
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
    const myGen = ++userGenRef.current;
    if (!userId) {
      void (async () => {
        await detachMemoryPersistence();
        await detachH3Persistence();
        if (myGen !== userGenRef.current) return;
        detachMemorySync();
        resetUnlockEngineForUser();
        useMemoryStore.getState().resetForUserSwitch();
        // O4 fix (v0.2.6.3): also clear cross-user marker state so
        // CairnPinsLayer doesn't flash the previous user's pins.
        useMarkerStore.getState().clearMarkers();
      })();
      return;
    }
    void (async () => {
      detachMemorySync();
      resetUnlockEngineForUser();
      // O4 fix: clear marker store before hydrate so the new user's
      // marker hydration starts from a clean slate.
      useMarkerStore.getState().clearMarkers();
      // v305 OTA: H3 cache hydrate first (fast path — fog visible
      // immediately if cache exists). Then hydrateMemoryForUser fires
      // replacePoints which is the canonical rebuild of cells from
      // points (source of truth). If H3 cache was stale or missing,
      // replacePoints fixes it. No separate migration step needed.
      await hydrateH3ForUser(userId);
      if (myGen !== userGenRef.current) return;
      await hydrateMemoryForUser(userId);
      if (myGen !== userGenRef.current) return;
      attachMemorySync(userId);
      void pullMemoryFromServer(userId);
    })();
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
  }, [userId]);

  // GPS watcher tied to enabled flag + app state.
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
          if (!enabledRef.current) return;
          if (recordModeRef.current === 'session-only' && !sessionActiveRef.current) {
            return;
          }
          performInitialRevealIfNeeded(loc.coords.latitude, loc.coords.longitude);
          processReading({
            lat: loc.coords.latitude,
            lng: loc.coords.longitude,
            accuracyM: loc.coords.accuracy ?? null,
            speedMs: loc.coords.speed ?? null,
            timestampMs: loc.timestamp ?? Date.now(),
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

    if (enabled && (AppState.currentState === 'active' || AppState.currentState === 'inactive' || AppState.currentState === 'unknown')) {
      void start();
    }
    const listener = AppState.addEventListener('change', handleAppState);

    return () => {
      cancelled = true;
      listener.remove();
      stop();
    };
  }, [enabled]);

  return null;
}

