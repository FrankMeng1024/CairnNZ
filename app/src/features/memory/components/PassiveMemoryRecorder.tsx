import React, { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import * as Location from 'expo-location';
import { useMemorySettingsStore, PASSIVE_BACKGROUND_CONSENT_VERSION } from '../store/useMemorySettingsStore';
import { useAppStore } from '../../../store/useAppStore';
import { useTrackingStore } from '../../../store/useTrackingStore';
import { useSettingsStore } from '../../../store/useSettingsStore';
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

interface PassiveContinuityAuthority {
  ownerUserId: string;
  source: 'real' | 'simulator';
  eligible: boolean;
  effectGeneration: number;
  continuityState: RealGpsContinuityState;
  rawOrdinal: number;
  backgroundEpoch: string | null;
}

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
  const debugMode = useSettingsStore(state => state.debugMode);
  const continuityAuthorityRef = useRef<PassiveContinuityAuthority | null>(null);

  useEffect(() => {
    let cancelled = false;
    let unsubscribeSimulator: (() => void) | null = null;
    let ownedBackgroundEpoch: string | null = null;
    let activeForegroundGeneration: string | null = null;
    let acquisitionGeneration = 0;
    let acquisitionPhase: 'foreground' | 'background' | 'stopped' = 'stopped';
    const ownerUserId = userId == null ? '' : String(userId);
    const acquisitionSource = selectedActivityLocationSource();
    const eligible = enabled
      && isLoggedIn
      && Boolean(ownerUserId)
      && (trackingStatus === 'idle' || trackingStatus === 'paused');
    const priorAuthority = continuityAuthorityRef.current;
    const mayRetainContinuity = eligible
      && priorAuthority?.eligible === true
      && priorAuthority.ownerUserId === ownerUserId
      && priorAuthority.source === acquisitionSource;
    const continuityAuthority: PassiveContinuityAuthority = mayRetainContinuity
      ? priorAuthority
      : {
          ownerUserId,
          source: acquisitionSource,
          eligible,
          effectGeneration: 0,
          continuityState: createPassiveMemoryContinuityState(),
          rawOrdinal: 0,
          backgroundEpoch: null,
        };
    continuityAuthority.effectGeneration += 1;
    const effectGeneration = continuityAuthority.effectGeneration;
    continuityAuthorityRef.current = continuityAuthority;
    if (priorAuthority && priorAuthority !== continuityAuthority
      && typeof useMemoryStore.setState === 'function') {
      // Qualified passive position is ephemeral source evidence. Account,
      // consent/OFF, Activity-priority, and real/simulator boundaries must not
      // let the next authority inherit its freshness.
      useMemoryStore.setState({ lastWatcherFix: null });
    }
    const authorityIsCurrent = () => continuityAuthorityRef.current === continuityAuthority
      && continuityAuthority.effectGeneration === effectGeneration;
    const ownerIsCurrent = () => {
      const auth = useAppStore.getState();
      return !cancelled
        && authorityIsCurrent()
        && auth.isLoggedIn === true
        && String(auth.user?.id ?? '') === ownerUserId
        && useMemorySettingsStore.getState().passiveExplorationEnabled
        && selectedActivityLocationSource() === acquisitionSource;
    };
    const passiveMayProduce = () => {
      const status = useTrackingStore.getState().status;
      return status === 'idle' || status === 'paused';
    };
    const beginAcquisitionTransition = (phase: typeof acquisitionPhase) => {
      acquisitionPhase = phase;
      acquisitionGeneration += 1;
      return acquisitionGeneration;
    };
    const transitionIsCurrent = (
      generation: number,
      phase: 'foreground' | 'background',
    ) => !cancelled
      && acquisitionGeneration === generation
      && acquisitionPhase === phase
      && ownerIsCurrent()
      && passiveMayProduce()
      && (phase === 'background'
        ? AppState.currentState === 'background'
        : AppState.currentState !== 'background');
    const stopForeground = async () => {
      const generation = activeForegroundGeneration;
      activeForegroundGeneration = null;
      unsubscribeSimulator?.();
      unsubscribeSimulator = null;
      if (generation) {
        await nativeRealLocationSupervisor.removeConsumer('passive-memory', generation);
      }
    };
    const publishAccepted = async (
      observation: RealGpsObservation,
      transitionGeneration: number,
      foregroundGeneration: string,
    ) => {
      if (!transitionIsCurrent(transitionGeneration, 'foreground')
        || activeForegroundGeneration !== foregroundGeneration) return;
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
    const consumeRealObservation = async (
      location: Location.LocationObject,
      atMs: number,
      transitionGeneration: number,
      foregroundGeneration: string,
    ) => {
      if (!transitionIsCurrent(transitionGeneration, 'foreground')
        || activeForegroundGeneration !== foregroundGeneration) return;
      continuityAuthority.rawOrdinal += 1;
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
        observationId: `${foregroundGeneration.slice(-8)}:${continuityAuthority.rawOrdinal}`,
        rawOrdinal: continuityAuthority.rawOrdinal,
      };
      appendSimulatorLog('LOCATION', 'passive_memory_observation_received_v1', {
        rawOrdinal: continuityAuthority.rawOrdinal,
        sampleTimestamp: atMs,
        callbackReceiptMs: Date.now(),
        callbackDelayMs: Math.max(0, Date.now() - atMs),
        horizontalAccuracyM: observation.accuracy,
        sampleSource: 'foreground',
      }, { userId: ownerUserId, coordinateSource: 'none' });
      const reduced = reducePassiveMemoryObservation(
        continuityAuthority.continuityState,
        observation,
        Date.now(),
      );
      if (!transitionIsCurrent(transitionGeneration, 'foreground')
        || activeForegroundGeneration !== foregroundGeneration) return;
      continuityAuthority.continuityState = reduced.state;
      if (reduced.qualifiedPosition) {
        useMemoryStore.getState().setLastWatcherFix(
          reduced.qualifiedPosition.lat,
          reduced.qualifiedPosition.lng,
          reduced.qualifiedPosition.t,
        );
      }
      for (const accepted of reduced.accepted) {
        await publishAccepted(accepted, transitionGeneration, foregroundGeneration);
      }
    };
    const stopBackground = async (
      adoptPersisted = false,
      transition?: { generation: number; phase: 'foreground' | 'background' },
    ) => {
      const expectedOwnedEpoch = ownedBackgroundEpoch;
      const persisted = await readPassiveMemoryContext().catch(() => null);
      if (transition && !transitionIsCurrent(transition.generation, transition.phase)) return;
      const epoch = expectedOwnedEpoch
        // A newly authenticated owner or simulator selection must retire an
        // exact stale native lease even when the durable context belongs to
        // the previous owner. Ownership gates evidence adoption below; it
        // must not preserve somebody else's physical acquisition runtime.
        ?? (adoptPersisted ? persisted?.epoch ?? null : null);
      if (!epoch) return;
      if (ownedBackgroundEpoch === epoch) ownedBackgroundEpoch = null;
      if (continuityAuthority.backgroundEpoch === epoch) continuityAuthority.backgroundEpoch = null;
      if (persisted?.ownerUserId === ownerUserId && authorityIsCurrent() && !cancelled) {
        continuityAuthority.continuityState = persisted.continuityState;
        continuityAuthority.rawOrdinal = persisted.rawOrdinal;
        const qualified = persisted.continuityState.positionEstimate
          ?? (persisted.continuityState.liveCoordinate
            ? {
                ...persisted.continuityState.liveCoordinate,
                // latestObservationTimestampMs includes rejected raw input;
                // only trusted/refined evidence may timestamp this position.
                t: persisted.continuityState.lastTrusted?.t
                  ?? persisted.acceptAfterMs,
              }
            : null);
        if (qualified) {
          useMemoryStore.getState().setLastWatcherFix(qualified.lat, qualified.lng, qualified.t);
        }
      }
      await stopPassiveMemoryBackgroundUpdates(epoch);
    };
    const startForeground = async () => {
      const transitionGeneration = beginAcquisitionTransition('foreground');
      const foregroundGeneration = `passive:${ownerUserId}:${Date.now()}:${transitionGeneration}:${Math.random().toString(36).slice(2)}`;
      activeForegroundGeneration = foregroundGeneration;
      if (!transitionIsCurrent(transitionGeneration, 'foreground')) return;
      await stopBackground(true, { generation: transitionGeneration, phase: 'foreground' });
      if (!transitionIsCurrent(transitionGeneration, 'foreground')
        || activeForegroundGeneration !== foregroundGeneration) return;
      await reconcileDurableMemoryEvidenceNow().catch(() => undefined);
      if (!transitionIsCurrent(transitionGeneration, 'foreground')
        || activeForegroundGeneration !== foregroundGeneration) return;
      if (acquisitionSource === 'simulator') {
        activitySimulatorEngine.startRuntime();
        if (unsubscribeSimulator) return;
        unsubscribeSimulator = activitySimulatorEngine.subscribePassive(sample => {
          if (!transitionIsCurrent(transitionGeneration, 'foreground')
            || activeForegroundGeneration !== foregroundGeneration) return;
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
      if (permission.status !== Location.PermissionStatus.GRANTED
        || !transitionIsCurrent(transitionGeneration, 'foreground')
        || activeForegroundGeneration !== foregroundGeneration) return;
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
          transitionGeneration,
          foregroundGeneration,
        ),
        onTerminalError: error => {
          appendSimulatorLog('ERROR', 'passive_memory_foreground_source_error_v1', {
            errorCode: String(error).slice(0, 120),
          }, { userId: ownerUserId, coordinateSource: 'none' });
        },
      });
      // setConsumer can await native watcher creation. A background takeover,
      // OFF/logout, or Activity start during that await owns the next phase and
      // must be able to remove this exact obsolete generation after it appears.
      if (!transitionIsCurrent(transitionGeneration, 'foreground')
        || activeForegroundGeneration !== foregroundGeneration) {
        await nativeRealLocationSupervisor.removeConsumer('passive-memory', foregroundGeneration);
      }
    };
    const startBackground = async () => {
      const transitionGeneration = beginAcquisitionTransition('background');
      await stopForeground();
      if (!transitionIsCurrent(transitionGeneration, 'background')) return;
      if (acquisitionSource === 'simulator') {
        // Simulator passive exploration is a foreground QA facility. It has no
        // headless runtime, so backgrounding suspends it and revokes any old
        // real-source lease instead of silently falling back to physical GPS.
        await stopBackground(true, { generation: transitionGeneration, phase: 'background' });
        appendSimulatorLog('PROVIDER', 'passive_memory_simulator_background_suspended_v1', {
          ownerSuffix: ownerUserId.slice(-8),
          physicalFallbackStarted: false,
        }, { userId: ownerUserId, coordinateSource: 'none' });
        return;
      }
      const consented = backgroundConsent === 'granted'
        && backgroundConsentVersion >= PASSIVE_BACKGROUND_CONSENT_VERSION;
      if (!consented || !passiveBackgroundMemoryCapability().supported) return;
      const epoch = `passive-bg:${ownerUserId}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
      ownedBackgroundEpoch = epoch;
      continuityAuthority.backgroundEpoch = epoch;
      const context = await acquirePassiveMemoryLease({
        ownerUserId,
        epoch,
        source: 'real',
        acceptAfterMs: Date.now(),
        continuityState: continuityAuthority.continuityState,
        rawOrdinal: continuityAuthority.rawOrdinal,
      }).catch(() => null);
      if (!context) {
        if (ownedBackgroundEpoch === epoch) ownedBackgroundEpoch = null;
        if (continuityAuthority.backgroundEpoch === epoch) continuityAuthority.backgroundEpoch = null;
        return;
      }
      if (!transitionIsCurrent(transitionGeneration, 'background')
        || continuityAuthority.backgroundEpoch !== epoch) {
        await stopPassiveMemoryBackgroundUpdates(epoch);
        return;
      }
      const started = await startPassiveMemoryBackgroundUpdates(context).catch(() => false);
      if (!started || !transitionIsCurrent(transitionGeneration, 'background')
        || continuityAuthority.backgroundEpoch !== epoch) {
        await stopPassiveMemoryBackgroundUpdates(epoch);
      }
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
      beginAcquisitionTransition('stopped');
      void stopForeground();
      void stopBackground(true);
    } else if (AppState.currentState === 'background') {
      void startBackground();
    } else {
      void startForeground();
    }
    return () => {
      cancelled = true;
      beginAcquisitionTransition('stopped');
      appState.remove();
      void stopForeground();
      // Cleanup caused by OFF/logout/account/status changes must revoke the
      // durable lease. Normal process suspension does not run React cleanup.
      void stopBackground(false);
    };
  }, [
    backgroundConsent,
    backgroundConsentVersion,
    enabled,
    debugMode,
    isLoggedIn,
    simulatorEnabled,
    trackingStatus,
    userId,
  ]);

  return null;
}
