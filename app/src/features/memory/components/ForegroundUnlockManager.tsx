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
import { hydrateMemoryForUser, detachMemoryPersistence, flushMemoryNow } from '../services/memoryPersistence';
import { attachMemorySync, detachMemorySync, pullMemoryFromServer, pushMemoryNow } from '../../../services/memorySync';

const WATCH_OPTIONS: Location.LocationOptions = {
  accuracy: Location.Accuracy.BestForNavigation,
  timeInterval: 2_000,    // 2s between readings — enough for walking pace
  distanceInterval: 5,    // OR 5m of motion, whichever comes first
};

export function ForegroundUnlockManager() {
  const enabled = useMemorySettingsStore((s) => s.foregroundAutoUnlockEnabled);
  const userId = useAppStore((s) => s.user?.id ?? null);
  const subRef = useRef<Location.LocationSubscription | null>(null);
  // Read latest `enabled` from a ref inside async closures so a toggle
  // mid-AppState transition doesn't fire the wrong branch.
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  // Memory tile hydration tied to user identity.
  useEffect(() => {
    if (!userId) {
      // No user: detach any prior subscription and reset dedup so the
      // next sign-in starts clean.
      void detachMemoryPersistence();
      detachMemorySync();
      resetUnlockEngineForUser();
      return;
    }
    // Reset cross-user dedup BEFORE hydrate so the new user's first
    // reading isn't silently suppressed.
    resetUnlockEngineForUser();
    // 1. Hydrate from local AsyncStorage offline buffer (instant)
    // 2. Attach sync service (subscribes to store changes)
    // 3. Pull server state to seed the store (overwrites local)
    void (async () => {
      await hydrateMemoryForUser(userId);
      attachMemorySync(userId);
      void pullMemoryFromServer(userId);
    })();
    return () => {
      void detachMemoryPersistence();
      detachMemorySync();
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
          if (!enabledRef.current) return;
          performInitialRevealIfNeeded(loc.coords.latitude, loc.coords.longitude);
          processReading({
            lat: loc.coords.latitude,
            lng: loc.coords.longitude,
            accuracyM: loc.coords.accuracy ?? null,
            speedMs: loc.coords.speed ?? null,
            timestampMs: loc.timestamp ?? Date.now(),
          });
        });
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

