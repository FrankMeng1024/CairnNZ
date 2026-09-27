import React, { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import * as Location from 'expo-location';
import { useMemorySettingsStore, PASSIVE_BACKGROUND_CONSENT_VERSION } from '../store/useMemorySettingsStore';
import { useAppStore } from '../../../store/useAppStore';
import { useTrackingStore } from '../../../store/useTrackingStore';
import { useMemoryStore } from '../store/useMemoryStore';
import { recordMemoryEvidence } from '../services/recordMemoryEvidence';
import { flushMemoryNow, reconcileDurableMemoryEvidenceNow } from '../services/memoryPersistence';
import { selectedActivityLocationSource } from '../../activitySimulator/activityLocationProvider';
import { activitySimulatorEngine } from '../../activitySimulator/activitySimulatorEngine';
import { appendSimulatorLog } from '../../activitySimulator/simulatorLog';
import { useActivitySimulatorStore } from '../../activitySimulator/useActivitySimulatorStore';
import { MAX_ACCEPTABLE_HORIZONTAL_ACCURACY_M } from '../../activity/activityContracts';
import { nativeRealLocationSupervisor } from '../../activity/nativeRealLocationSupervisor';
import {
  createPassiveMemoryContinuityState,
  reducePassiveMemoryObservation,
} from '../services/passiveMemoryContinuity';
import type { RealGpsContinuityState, RealGpsObservation } from '../../activity/realGpsContinuity';
import { passiveBackgroundMemoryCapability } from '../services/passiveMemoryCapability';
import {
  acquirePassiveMemoryLease,
  readPassiveMemoryContext,
  startPassiveMemoryBackgroundUpdates,
  stopPassiveMemoryBackgroundUpdates,
} from '../../../services/passiveMemoryBackgroundTask';

const OPTIONS: Location.LocationOptions = {
  accuracy: Location.Accuracy.Balanced,
  timeInterval: 10_000,
  distanceInterval: 10,
};

/** App-scoped optional exploration. Activity capture has higher priority and
 * supplies its own Memory evidence, so there is never a second native watcher
 * or duplicate passive write while Hike/Run is actively recording. */
export function PassiveMemoryRecorder() {
  const enabled = useMemorySettingsStore(state => state.passiveExplorationEnabled);
  const backgroundConsent = useMemorySettingsStore(state => state.passiveBackgroundConsent);
  const backgroundConsentVersion = useMemorySettingsStore(state => state.passiveBackgroundConsentVersion);
  const isLoggedIn = useAppStore(state => state.isLoggedIn);
  const userId = useAppStore(state => state.user?.id ?? null);
  const trackingStatus = useTrackingStore(state => state.status);
  const simulatorEnabled = useActivitySimulatorStore(state => state.enabled);
  const continuityRef = useRef<RealGpsContinuityState>(createPassiveMemoryContinuityState());
  const rawOrdinalRef = useRef(0);
  const backgroundEpochRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let unsubscribeSimulator: (() => void) | null = null;
    let ownedBackgroundEpoch: string | null = null;
    const ownerUserId = userId == null ? '' : String(userId);
    const foregroundGeneration = `passive:${ownerUserId}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
    const ownerIsCurrent = () => {
      const auth = useAppStore.getState();
      return !cancelled
        && auth.isLoggedIn === true
        && String(auth.user?.id ?? '') === ownerUserId
        && useMemorySettingsStore.getState().passiveExplorationEnabled;
    };
    const passiveMayProduce = () => {
      const status = useTrackingStore.getState().status;
      return status === 'idle' || status === 'paused';
    };
    const stopForeground = () => {
      void nativeRealLocationSupervisor.removeConsumer('passive-memory', foregroundGeneration);
      unsubscribeSimulator?.();
      unsubscribeSimulator = null;
    };
    const publishAccepted = async (observation: RealGpsObservation) => {
      if (!ownerIsCurrent() || !passiveMayProduce()) return;
      await recordMemoryEvidence({
        lat: observation.lat,
        lng: observation.lng,
        atMs: observation.t,
        source: 'passive_real',
        ownerUserId,
        horizontalAccuracyM: observation.accuracy ?? undefined,
        continuityState: 'accepted',
      });
    };
    const consumeRealObservation = async (location: Location.LocationObject, atMs: number) => {
      if (!ownerIsCurrent() || !passiveMayProduce()) return;
      rawOrdinalRef.current += 1;
      const observation: RealGpsObservation = {
        lat: location.coords.latitude,
        lng: location.coords.longitude,
        t: atMs,
        accuracy: location.coords.accuracy ?? null,
        verticalAccuracy: location.coords.altitudeAccuracy ?? null,
        altitude: location.coords.altitude ?? null,
        speed: location.coords.speed ?? null,
        course: location.coords.heading ?? null,
        source: 'foreground',
        observationId: `${foregroundGeneration.slice(-8)}:${rawOrdinalRef.current}`,
        rawOrdinal: rawOrdinalRef.current,
      };
      appendSimulatorLog('LOCATION', 'passive_memory_observation_received_v1', {
        rawOrdinal: rawOrdinalRef.current,
        sampleTimestamp: atMs,
        callbackReceiptMs: Date.now(),
        callbackDelayMs: Math.max(0, Date.now() - atMs),
        horizontalAccuracyM: observation.accuracy,
        sampleSource: 'foreground',
      }, { userId: ownerUserId, coordinateSource: 'none' });
      const reduced = reducePassiveMemoryObservation(continuityRef.current, observation, Date.now());
      continuityRef.current = reduced.state;
      if (reduced.qualifiedPosition) {
        useMemoryStore.getState().setLastWatcherFix(
          reduced.qualifiedPosition.lat,
          reduced.qualifiedPosition.lng,
          reduced.qualifiedPosition.t,
        );
      }
      for (const accepted of reduced.accepted) await publishAccepted(accepted);
    };
    const stopBackground = async (adoptPersisted = false) => {
      const persisted = await readPassiveMemoryContext().catch(() => null);
      const epoch = ownedBackgroundEpoch
        ?? (adoptPersisted && persisted?.ownerUserId === ownerUserId ? persisted.epoch : null);
      if (!epoch) return;
      ownedBackgroundEpoch = null;
      if (backgroundEpochRef.current === epoch) backgroundEpochRef.current = null;
      if (persisted?.ownerUserId === ownerUserId) {
        continuityRef.current = persisted.continuityState;
        rawOrdinalRef.current = persisted.rawOrdinal;
        const qualified = persisted.continuityState.positionEstimate
          ?? (persisted.continuityState.liveCoordinate
            ? {
                ...persisted.continuityState.liveCoordinate,
                t: persisted.latestObservationTimestampMs ?? Date.now(),
              }
            : null);
        if (qualified) {
          useMemoryStore.getState().setLastWatcherFix(qualified.lat, qualified.lng, qualified.t);
        }
      }
      await stopPassiveMemoryBackgroundUpdates(epoch);
    };
    const startForeground = async () => {
      if (!ownerIsCurrent() || !passiveMayProduce() || AppState.currentState === 'background') return;
      await stopBackground(true);
      if (!ownerIsCurrent() || !passiveMayProduce()) return;
      await reconcileDurableMemoryEvidenceNow().catch(() => undefined);
      if (selectedActivityLocationSource() === 'simulator') {
        activitySimulatorEngine.startRuntime();
        if (unsubscribeSimulator) return;
        unsubscribeSimulator = activitySimulatorEngine.subscribePassive(sample => {
          if (!ownerIsCurrent() || !passiveMayProduce()) return;
          if (sample.accuracy > MAX_ACCEPTABLE_HORIZONTAL_ACCURACY_M) return;
          useMemoryStore.getState().setLastWatcherFix(sample.lat, sample.lng, sample.timestamp);
          void recordMemoryEvidence({
            lat: sample.lat,
            lng: sample.lng,
            atMs: sample.timestamp,
            source: 'simulator_test',
            ownerUserId,
            horizontalAccuracyM: sample.accuracy,
            continuityState: 'accepted',
          });
        });
        return;
      }
      const permission = await Location.getForegroundPermissionsAsync();
      if (permission.status !== Location.PermissionStatus.GRANTED || !ownerIsCurrent()) return;
      await nativeRealLocationSupervisor.setConsumer({
        id: 'passive-memory',
        ownerUserId,
        generation: foregroundGeneration,
        priority: 10,
        options: OPTIONS,
        optionsKey: 'passive-memory:balanced:10s:10m',
        onObservation: ({ observation, observationTimestampMs }) => consumeRealObservation(
          observation,
          observationTimestampMs,
        ),
        onTerminalError: error => {
          appendSimulatorLog('ERROR', 'passive_memory_foreground_source_error_v1', {
            errorCode: String(error).slice(0, 120),
          }, { userId: ownerUserId, coordinateSource: 'none' });
        },
      });
    };
    const startBackground = async () => {
      stopForeground();
      if (!ownerIsCurrent() || !passiveMayProduce()) return;
      const consented = backgroundConsent === 'granted'
        && backgroundConsentVersion >= PASSIVE_BACKGROUND_CONSENT_VERSION;
      if (!consented || !passiveBackgroundMemoryCapability().supported) return;
      const epoch = `passive-bg:${ownerUserId}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
      ownedBackgroundEpoch = epoch;
      backgroundEpochRef.current = epoch;
      const context = await acquirePassiveMemoryLease({
        ownerUserId,
        epoch,
        acceptAfterMs: Date.now(),
        continuityState: continuityRef.current,
        rawOrdinal: rawOrdinalRef.current,
      });
      if (!ownerIsCurrent() || !passiveMayProduce() || backgroundEpochRef.current !== epoch) {
        await stopPassiveMemoryBackgroundUpdates(epoch);
        return;
      }
      const started = await startPassiveMemoryBackgroundUpdates(context).catch(() => false);
      if (!started) await stopPassiveMemoryBackgroundUpdates(epoch);
    };
    const appState = AppState.addEventListener('change', next => {
      if (next === 'active') void startForeground();
      if (next === 'background') {
        void flushMemoryNow().catch(() => undefined);
        void startBackground();
      }
      // iOS inactive is transient; keep the current owner.
    });
    if (!enabled || !isLoggedIn || !ownerUserId || !passiveMayProduce()) {
      stopForeground();
      void stopBackground(true);
    } else if (AppState.currentState === 'background') {
      void startBackground();
    } else {
      void startForeground();
    }
    return () => {
      cancelled = true;
      appState.remove();
      stopForeground();
      // Cleanup caused by OFF/logout/account/status changes must revoke the
      // durable lease. Normal process suspension does not run React cleanup.
      void stopBackground(false);
    };
  }, [
    backgroundConsent,
    backgroundConsentVersion,
    enabled,
    isLoggedIn,
    simulatorEnabled,
    trackingStatus,
    userId,
  ]);

  return null;
}
