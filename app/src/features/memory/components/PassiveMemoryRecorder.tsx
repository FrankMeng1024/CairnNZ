import React, { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import * as Location from 'expo-location';
import { useMemorySettingsStore } from '../store/useMemorySettingsStore';
import { useAppStore } from '../../../store/useAppStore';
import { useTrackingStore } from '../../../store/useTrackingStore';
import { useMemoryStore } from '../store/useMemoryStore';
import { recordMemoryEvidence } from '../services/recordMemoryEvidence';
import { flushMemoryNow, reconcileDurableMemoryEvidenceNow } from '../services/memoryPersistence';
import { useSettingsStore } from '../../../store/useSettingsStore';
import { selectedActivityLocationSource } from '../../activitySimulator/activityLocationProvider';
import { activitySimulatorEngine } from '../../activitySimulator/activitySimulatorEngine';
import { appendSimulatorLog } from '../../activitySimulator/simulatorLog';
import { useActivitySimulatorStore } from '../../activitySimulator/useActivitySimulatorStore';
import { MAX_ACCEPTABLE_HORIZONTAL_ACCURACY_M } from '../../activity/activityContracts';

const OPTIONS: Location.LocationOptions = {
  accuracy: Location.Accuracy.Balanced,
  timeInterval: 5_000,
  distanceInterval: 10,
};

/** Settings-controlled exploration outside explicit Activities. */
export function PassiveMemoryRecorder() {
  const enabled = useMemorySettingsStore(state => state.foregroundAutoUnlockEnabled);
  const isLoggedIn = useAppStore(state => state.isLoggedIn);
  const userId = useAppStore(state => state.user?.id ?? null);
  const debugMode = useSettingsStore(state => state.debugMode);
  const simulatorEnabled = useActivitySimulatorStore(state => state.enabled);
  const subscription = useRef<Location.LocationSubscription | null>(null);

  useEffect(() => {
    let cancelled = false;
    let unsubscribeSimulator: (() => void) | null = null;
    const ownerUserId = userId == null ? '' : String(userId);
    const ownerIsCurrent = () => {
      const auth = useAppStore.getState();
      return !cancelled
        && auth.isLoggedIn === true
        && String(auth.user?.id ?? '') === ownerUserId;
    };
    const stop = () => {
      subscription.current?.remove();
      subscription.current = null;
      unsubscribeSimulator?.();
      unsubscribeSimulator = null;
    };
    const start = async () => {
      if (cancelled || subscription.current || unsubscribeSimulator || !enabled || !isLoggedIn || !ownerUserId) return;
      if (selectedActivityLocationSource() === 'simulator') {
        activitySimulatorEngine.startRuntime();
        unsubscribeSimulator = activitySimulatorEngine.subscribePassive(sample => {
          if (!ownerIsCurrent() || useTrackingStore.getState().status !== 'idle') return;
          if (sample.accuracy > MAX_ACCEPTABLE_HORIZONTAL_ACCURACY_M) {
            appendSimulatorLog('GPS_REJECT', 'passive_memory_location_rejected', {
              rejectionReason: 'poor-accuracy',
              accuracy: sample.accuracy,
            }, { userId: ownerUserId, virtualTimestamp: sample.timestamp });
            return;
          }
          useMemoryStore.getState().setLastWatcherFix(sample.lat, sample.lng, sample.timestamp);
          void recordMemoryEvidence({
            lat: sample.lat,
            lng: sample.lng,
            atMs: sample.timestamp,
            source: 'simulator_test',
            ownerUserId,
            horizontalAccuracyM: sample.accuracy,
            continuityState: 'accepted',
          }).then(result => {
            appendSimulatorLog('MEMORY_EVIDENCE', 'passive_memory_evidence_committed', {
              committed: result.committed,
              deduplicated: result.deduplicated,
              lat: sample.lat,
              lng: sample.lng,
            }, { userId: ownerUserId, virtualTimestamp: sample.timestamp });
          }).catch(error => {
            appendSimulatorLog('ERROR', 'passive_memory_commit_failed', {
              errorCode: String(error).slice(0, 120),
            }, { userId: ownerUserId, virtualTimestamp: sample.timestamp });
          });
        });
        return;
      }
      const permission = await Location.getForegroundPermissionsAsync();
      if (permission.status !== 'granted' || !ownerIsCurrent()) return;
      const watcher = await Location.watchPositionAsync(OPTIONS, location => {
        if (!ownerIsCurrent()) return;
        const atMs = location.timestamp ?? Date.now();
        const accuracy = location.coords.accuracy;
        if (accuracy !== null && accuracy > MAX_ACCEPTABLE_HORIZONTAL_ACCURACY_M) return;
        useMemoryStore.getState().setLastWatcherFix(
          location.coords.latitude,
          location.coords.longitude,
          atMs,
        );
        if (useTrackingStore.getState().status !== 'idle') return;
        void recordMemoryEvidence({
          lat: location.coords.latitude,
          lng: location.coords.longitude,
          atMs,
          source: 'passive_real',
          ownerUserId,
          horizontalAccuracyM: accuracy ?? undefined,
          continuityState: 'accepted',
        }).catch(error => {
          appendSimulatorLog('ERROR', 'passive_memory_commit_failed', {
            errorCode: String(error).slice(0, 120),
          }, { userId: ownerUserId, virtualTimestamp: atMs });
        });
      });
      if (cancelled) watcher.remove();
      else subscription.current = watcher;
    };
    const appState = AppState.addEventListener('change', next => {
      if (next === 'active') {
        // Active Hike/Run evidence may have committed in TaskManager's
        // separate runtime. Reconcile it even when passive exploration is off.
        if (ownerIsCurrent()) void reconcileDurableMemoryEvidenceNow().catch(() => {});
        void start();
      }
      if (next === 'background') {
        stop();
        void flushMemoryNow().catch(() => {});
      }
    });
    if (AppState.currentState === 'active') void start();
    return () => {
      cancelled = true;
      appState.remove();
      stop();
    };
  }, [debugMode, enabled, isLoggedIn, simulatorEnabled, userId]);

  return null;
}
