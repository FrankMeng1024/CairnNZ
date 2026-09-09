import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { normalizeLongitude, validateCoordinate } from './geodesy';
import {
  SIMULATOR_ACCURACY_METERS,
  SIMULATOR_SPEED_KMH,
  type SimulatorAccuracyPreset,
  type SimulatorAltitudeMode,
  type SimulatorCoordinate,
  type SimulatorSignal,
  type SimulatorSpeedPreset,
  type SimulatorTimeScale,
  type SimulatorWaypoint,
} from './types';
import { resolveSimulatorContinuityLock } from './simulatorContinuity';
import type { UnfinishedActivityRecord } from '../activity/activityRegistry';

const STORAGE_VERSION = 1;
// A walking Directions geometry is intentionally kept as a bounded queue.
// This is persisted Debug input, never a CairnNZ Route object.
export const MAX_SIMULATOR_AUTOPILOT_POINTS = 256;
export const QA_SESSION_MAX_AGE_MS = 6 * 60 * 60 * 1_000;
const DEFAULT_COORDINATE: SimulatorCoordinate = { lat: -45.0312, lng: 168.6626 };
const keyFor = (userId: string) => `@cairn:activity_simulator:v1:${userId}`;

export interface SimulatorDecision {
  accepted: boolean;
  reason: string;
  sequence: number;
  atMs: number;
  lat?: number;
  lng?: number;
  segmentId?: string | null;
  memoryCommitted?: boolean;
  memoryDeduplicated?: boolean;
}

export interface SimulatorGeneratedSample {
  sequence: number;
  atMs: number;
  lat: number;
  lng: number;
  bearingDegrees: number;
  joystickMagnitude: number;
  effectiveVirtualElapsedMs: number;
}

export interface SimulatorMapDiagnostics {
  mountId: string | null;
  screen: 'hike' | 'run' | null;
  mounted: boolean;
  styleLoaded: boolean;
  mapReady: boolean;
  loadState: 'unmounted' | 'loading' | 'style-loaded' | 'ready' | 'timed-out' | 'error';
  lastEvent: string;
  cameraTarget: SimulatorCoordinate | null;
  displayedPosition: SimulatorCoordinate | null;
}

interface PersistedSimulatorState {
  version: 1;
  enabled: boolean;
  startConfigured: boolean;
  qaSessionId: string | null;
  qaSessionStartedAt: number | null;
  qaSessionEndedAt: number | null;
  simulatorSessionId: string | null;
  boundActivityClientId: string | null;
  latestActivityClientId: string | null;
  origin: SimulatorCoordinate;
  current: SimulatorCoordinate;
  altitudeM: number;
  altitudeMode: SimulatorAltitudeMode;
  verticalRateMPerHour: number;
  speedPreset: SimulatorSpeedPreset;
  speedKmh: number;
  accuracyPreset: SimulatorAccuracyPreset;
  customAccuracyM: number | null;
  signal: SimulatorSignal;
  timeScale: SimulatorTimeScale;
  waypoints: SimulatorWaypoint[];
  virtualActivityStartedAtMs: number | null;
  virtualTimestampMs: number;
  effectiveVirtualElapsedMs: number;
  sampleSequence: number;
  batchSequence: number;
  clockLimitReached: boolean;
  deterministicSeed: number;
}

export interface ActivitySimulatorState extends PersistedSimulatorState {
  hydratedUserId: string | null;
  expanded: boolean;
  pickerMode: 'reacquire' | 'destination' | null;
  mapSelection: SimulatorCoordinate | null;
  joystickActive: boolean;
  joystickBearingDegrees: number;
  joystickMagnitude: number;
  autopilotActive: boolean;
  lastGeneratedSample: SimulatorGeneratedSample | null;
  lastAcceptedSample: SimulatorDecision | null;
  lastRejectionReason: string | null;
  mapDiagnostics: SimulatorMapDiagnostics;
  lastDecision: SimulatorDecision | null;
  lastFailure: string | null;
  setEnabled: (enabled: boolean) => void;
  setExpanded: (expanded: boolean) => void;
  setPickerMode: (mode: 'reacquire' | 'destination' | null) => void;
  setOrigin: (coordinate: SimulatorCoordinate) => boolean;
  setCurrent: (coordinate: SimulatorCoordinate) => boolean;
  setMapSelection: (coordinate: SimulatorCoordinate | null) => void;
  setSpeedPreset: (preset: SimulatorSpeedPreset) => void;
  setCustomSpeed: (speedKmh: number) => boolean;
  setAltitude: (altitudeM: number) => boolean;
  setAltitudeMode: (mode: SimulatorAltitudeMode) => void;
  setVerticalRate: (metresPerHour: number) => boolean;
  setAccuracyPreset: (preset: SimulatorAccuracyPreset) => void;
  setCustomAccuracy: (accuracyM: number | null) => boolean;
  setSignal: (signal: SimulatorSignal) => void;
  setTimeScale: (timeScale: SimulatorTimeScale) => boolean;
  setJoystickActive: (active: boolean) => void;
  setJoystick: (bearingDegrees: number, magnitude: number) => void;
  releaseJoystick: () => void;
  replaceWaypoints: (waypoints: SimulatorWaypoint[]) => void;
  enqueueWaypoint: (coordinate: SimulatorCoordinate) => boolean;
  moveToWaypoint: (coordinate: SimulatorCoordinate) => boolean;
  stopAutopilot: () => void;
  restoreRuntimeTail: (coordinate: SimulatorCoordinate, altitudeM: number, virtualTimestampMs: number) => void;
  setRuntimePosition: (
    coordinate: SimulatorCoordinate,
    altitudeM: number,
    clock: {
      virtualTimestampMs: number;
      effectiveVirtualElapsedMs: number;
      batchSequence: number;
      clockLimitReached: boolean;
    },
  ) => void;
  shiftWaypoint: () => void;
  bindActivity: (userId: string, clientActivityId: string, startedAt: number) => string;
  unbindActivity: (options?: { clearOrigin?: boolean }) => void;
  recordGeneratedSample: (sample: SimulatorGeneratedSample) => void;
  recordDecision: (decision: SimulatorDecision) => void;
  setMapDiagnostics: (diagnostics: Partial<SimulatorMapDiagnostics>) => void;
  setLastFailure: (failure: string | null) => void;
  beginQaSession: (userId: string, forceNew?: boolean) => string | null;
  endQaSession: () => string | null;
  resetWhenIdle: () => boolean;
}

function newLocalId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function defaults(userId: string | null): ActivitySimulatorState {
  return {
    version: STORAGE_VERSION,
    enabled: false,
    startConfigured: false,
    qaSessionId: null,
    qaSessionStartedAt: null,
    qaSessionEndedAt: null,
    simulatorSessionId: null,
    boundActivityClientId: null,
    latestActivityClientId: null,
    origin: DEFAULT_COORDINATE,
    current: DEFAULT_COORDINATE,
    altitudeM: 0,
    altitudeMode: 'flat',
    verticalRateMPerHour: 300,
    speedPreset: 'walk',
    speedKmh: SIMULATOR_SPEED_KMH.walk,
    accuracyPreset: 'good',
    customAccuracyM: null,
    signal: 'normal',
    timeScale: 1,
    waypoints: [],
    virtualActivityStartedAtMs: null,
    virtualTimestampMs: 0,
    effectiveVirtualElapsedMs: 0,
    sampleSequence: 0,
    batchSequence: 0,
    clockLimitReached: false,
    deterministicSeed: 1,
    hydratedUserId: userId,
    expanded: false,
    pickerMode: null,
    mapSelection: null,
    joystickActive: false,
    joystickBearingDegrees: 0,
    joystickMagnitude: 0,
    autopilotActive: false,
    lastGeneratedSample: null,
    lastAcceptedSample: null,
    lastRejectionReason: null,
    mapDiagnostics: {
      mountId: null,
      screen: null,
      mounted: false,
      styleLoaded: false,
      mapReady: false,
      loadState: 'unmounted',
      lastEvent: 'unmounted',
      cameraTarget: null,
      displayedPosition: null,
    },
    lastDecision: null,
    lastFailure: null,
    ...actions,
  };
}

function persistedSnapshot(state: ActivitySimulatorState): PersistedSimulatorState {
  return {
    version: STORAGE_VERSION,
    enabled: state.enabled,
    startConfigured: state.startConfigured,
    qaSessionId: state.qaSessionId,
    qaSessionStartedAt: state.qaSessionStartedAt,
    qaSessionEndedAt: state.qaSessionEndedAt,
    simulatorSessionId: state.simulatorSessionId,
    boundActivityClientId: state.boundActivityClientId,
    latestActivityClientId: state.latestActivityClientId,
    origin: state.origin,
    current: state.current,
    altitudeM: state.altitudeM,
    altitudeMode: state.altitudeMode,
    verticalRateMPerHour: state.verticalRateMPerHour,
    speedPreset: state.speedPreset,
    speedKmh: state.speedKmh,
    accuracyPreset: state.accuracyPreset,
    customAccuracyM: state.customAccuracyM,
    signal: state.signal,
    timeScale: state.timeScale,
    waypoints: state.waypoints.slice(0, MAX_SIMULATOR_AUTOPILOT_POINTS),
    virtualActivityStartedAtMs: state.virtualActivityStartedAtMs,
    virtualTimestampMs: state.virtualTimestampMs,
    effectiveVirtualElapsedMs: state.effectiveVirtualElapsedMs,
    sampleSequence: state.sampleSequence,
    batchSequence: state.batchSequence,
    clockLimitReached: state.clockLimitReached,
    deterministicSeed: state.deterministicSeed,
  };
}

let persistTimer: ReturnType<typeof setTimeout> | null = null;
let persistTail: Promise<void> = Promise.resolve();

export function scheduleSimulatorPersistence(): void {
  if (persistTimer) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    void persistActivitySimulatorNow();
  }, 1_000);
}

export async function persistActivitySimulatorNow(): Promise<void> {
  if (persistTimer) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
  const state = useActivitySimulatorStore.getState();
  const userId = state.hydratedUserId;
  if (!userId) return;
  const value = JSON.stringify(persistedSnapshot(state));
  const run = persistTail.then(() => AsyncStorage.setItem(keyFor(userId), value));
  persistTail = run.catch(() => {});
  await run;
}

function sanitizePersisted(value: unknown): Partial<PersistedSimulatorState> {
  if (!value || typeof value !== 'object') return {};
  const raw = value as Partial<PersistedSimulatorState>;
  if (raw.version !== STORAGE_VERSION) return {};
  const origin = validateCoordinate(Number(raw.origin?.lat), Number(raw.origin?.lng));
  const current = validateCoordinate(Number(raw.current?.lat), Number(raw.current?.lng));
  const speedKmh = Number(raw.speedKmh);
  const altitudeM = Number(raw.altitudeM);
  const verticalRate = Number(raw.verticalRateMPerHour);
  const virtualTimestampMs = Number(raw.virtualTimestampMs);
  const virtualActivityStartedAtMs = Number(raw.virtualActivityStartedAtMs);
  const effectiveVirtualElapsedMs = Number(raw.effectiveVirtualElapsedMs);
  const sampleSequence = Number(raw.sampleSequence);
  const batchSequence = Number(raw.batchSequence);
  const waypoints = Array.isArray(raw.waypoints)
    ? raw.waypoints.slice(0, MAX_SIMULATOR_AUTOPILOT_POINTS).flatMap((waypoint) => {
        const validated = validateCoordinate(Number(waypoint?.lat), Number(waypoint?.lng));
        return validated.ok
          ? [{ id: String(waypoint?.id || newLocalId('wp')), ...validated.coordinate }]
          : [];
      })
    : [];
  return {
    enabled: raw.enabled === true,
    // A legacy v1 origin was a default value, not evidence that a tester
    // deliberately configured a start. Missing means unconfigured.
    startConfigured: typeof raw.startConfigured === 'boolean' ? raw.startConfigured : false,
    qaSessionId: typeof raw.qaSessionId === 'string' && /^qa-[a-z0-9-]{8,61}$/i.test(raw.qaSessionId)
      ? raw.qaSessionId.slice(0, 64)
      : null,
    qaSessionStartedAt: Number.isFinite(Number(raw.qaSessionStartedAt)) && Number(raw.qaSessionStartedAt) > 0
      ? Number(raw.qaSessionStartedAt)
      : null,
    qaSessionEndedAt: Number.isFinite(Number(raw.qaSessionEndedAt)) && Number(raw.qaSessionEndedAt) > 0
      ? Number(raw.qaSessionEndedAt)
      : null,
    simulatorSessionId: typeof raw.simulatorSessionId === 'string' ? raw.simulatorSessionId : null,
    boundActivityClientId: typeof raw.boundActivityClientId === 'string' ? raw.boundActivityClientId : null,
    latestActivityClientId: typeof raw.latestActivityClientId === 'string' ? raw.latestActivityClientId : null,
    origin: origin.ok ? origin.coordinate : DEFAULT_COORDINATE,
    current: current.ok ? current.coordinate : (origin.ok ? origin.coordinate : DEFAULT_COORDINATE),
    altitudeM: Number.isFinite(altitudeM) ? Math.max(-500, Math.min(9_000, altitudeM)) : 0,
    altitudeMode: ['flat', 'climb', 'descend', 'custom'].includes(String(raw.altitudeMode))
      ? raw.altitudeMode as SimulatorAltitudeMode
      : 'flat',
    verticalRateMPerHour: Number.isFinite(verticalRate) ? Math.max(-3_000, Math.min(3_000, verticalRate)) : 300,
    speedPreset: ['slow', 'walk', 'brisk', 'hike', 'run', 'custom'].includes(String(raw.speedPreset))
      ? raw.speedPreset as SimulatorSpeedPreset
      : 'walk',
    speedKmh: Number.isFinite(speedKmh) ? Math.max(0.1, Math.min(60, speedKmh)) : SIMULATOR_SPEED_KMH.walk,
    accuracyPreset: ['good', 'normal', 'poor'].includes(String(raw.accuracyPreset))
      ? raw.accuracyPreset as SimulatorAccuracyPreset
      : 'good',
    customAccuracyM: Number.isFinite(Number(raw.customAccuracyM))
      ? Math.max(1, Math.min(500, Number(raw.customAccuracyM)))
      : null,
    signal: ['normal', 'poor', 'lost', 'frozen'].includes(String(raw.signal))
      ? raw.signal as SimulatorSignal
      : 'normal',
    timeScale: [1, 2, 5, 10, 30, 60, 120].includes(Number(raw.timeScale))
      ? Number(raw.timeScale) as SimulatorTimeScale
      : 1,
    waypoints,
    virtualActivityStartedAtMs: Number.isFinite(virtualActivityStartedAtMs) && virtualActivityStartedAtMs > 0
      ? virtualActivityStartedAtMs
      : null,
    virtualTimestampMs: Number.isFinite(virtualTimestampMs) ? virtualTimestampMs : 0,
    effectiveVirtualElapsedMs: Number.isFinite(effectiveVirtualElapsedMs)
      ? Math.max(0, effectiveVirtualElapsedMs)
      : 0,
    sampleSequence: Number.isFinite(sampleSequence) ? Math.max(0, Math.floor(sampleSequence)) : 0,
    batchSequence: Number.isFinite(batchSequence) ? Math.max(0, Math.floor(batchSequence)) : 0,
    clockLimitReached: raw.clockLimitReached === true,
    deterministicSeed: Number.isFinite(Number(raw.deterministicSeed)) ? Math.floor(Number(raw.deterministicSeed)) : 1,
  };
}

const actions = {
  setEnabled(enabled: boolean) {
    const state = useActivitySimulatorStore.getState();
    let continuity = resolveSimulatorContinuityLock({
      boundActivityClientId: state.boundActivityClientId,
      trackingStatus: 'idle',
      trackingSessionId: null,
      providerSource: 'real',
    });
    try {
      // Lazy resolution avoids a module-initialization cycle: Tracking imports
      // this store, while Settings invokes this action after initialization.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const tracking = require('../../store/useTrackingStore').useTrackingStore.getState();
      continuity = resolveSimulatorContinuityLock({
        boundActivityClientId: state.boundActivityClientId,
        trackingStatus: tracking.status,
        trackingSessionId: tracking.sessionId,
        providerSource: tracking.locationProviderSource,
      });
    } catch { /* persisted Simulator binding remains the fail-safe */ }
    if (continuity.locked && state.enabled !== enabled) {
      useActivitySimulatorStore.setState({ lastFailure: continuity.reason });
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('./simulatorLog').appendSimulatorLog('DEBUG', 'simulator_setting_rejected', {
          requestedEnabled: enabled,
          rejectionReason: continuity.reason,
        }, { coordinateSource: 'none' });
      } catch { /* diagnostics cannot affect the setting */ }
      return;
    }
    useActivitySimulatorStore.setState({
      enabled,
      ...(!enabled ? { pickerMode: null, mapSelection: null } : {}),
    });
    if (!enabled) {
      // The toggle is a capability boundary, not merely panel visibility.
      // With no Activity owner (guarded above), stop the JS provider runtime
      // so Debug Mode can remain on while Hike/Run use only real GPS.
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { activitySimulatorEngine } = require('./activitySimulatorEngine');
        void activitySimulatorEngine.stopRuntime();
      } catch { /* engine may not be initialized in isolated store tests */ }
    }
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('./simulatorLog').appendSimulatorLog('DEBUG', 'simulator_setting_changed', {
        enabled,
      }, { coordinateSource: 'none' });
    } catch { /* diagnostics cannot affect the setting */ }
    scheduleSimulatorPersistence();
  },
  setExpanded(expanded: boolean) {
    useActivitySimulatorStore.setState({ expanded });
  },
  setPickerMode(pickerMode: 'reacquire' | 'destination' | null) {
    useActivitySimulatorStore.setState({ pickerMode });
  },
  setOrigin(coordinate: SimulatorCoordinate): boolean {
    const result = validateCoordinate(coordinate.lat, coordinate.lng);
    if (!result.ok) {
      useActivitySimulatorStore.setState({ lastFailure: result.reason });
      return false;
    }
    useActivitySimulatorStore.setState({
      origin: result.coordinate,
      current: result.coordinate,
      startConfigured: true,
      pickerMode: null,
      mapSelection: null,
      waypoints: [],
      autopilotActive: false,
      lastFailure: null,
    });
    scheduleSimulatorPersistence();
    return true;
  },
  setCurrent(coordinate: SimulatorCoordinate): boolean {
    const result = validateCoordinate(coordinate.lat, coordinate.lng);
    if (!result.ok) {
      useActivitySimulatorStore.setState({ lastFailure: result.reason });
      return false;
    }
    useActivitySimulatorStore.setState({ current: result.coordinate, lastFailure: null });
    scheduleSimulatorPersistence();
    return true;
  },
  setMapSelection(coordinate: SimulatorCoordinate | null) {
    if (!coordinate) {
      useActivitySimulatorStore.setState({ mapSelection: null });
      return;
    }
    const result = validateCoordinate(coordinate.lat, coordinate.lng);
    useActivitySimulatorStore.setState(result.ok
      ? { mapSelection: result.coordinate, lastFailure: null }
      : { lastFailure: result.reason });
  },
  setSpeedPreset(preset: SimulatorSpeedPreset) {
    const speedKmh = preset === 'custom'
      ? useActivitySimulatorStore.getState().speedKmh
      : SIMULATOR_SPEED_KMH[preset];
    useActivitySimulatorStore.setState({ speedPreset: preset, speedKmh });
    scheduleSimulatorPersistence();
  },
  setCustomSpeed(speedKmh: number): boolean {
    if (!Number.isFinite(speedKmh) || speedKmh < 0.1 || speedKmh > 60) {
      useActivitySimulatorStore.setState({ lastFailure: 'Speed must be between 0.1 and 60 km/h.' });
      return false;
    }
    useActivitySimulatorStore.setState({ speedPreset: 'custom', speedKmh, lastFailure: null });
    scheduleSimulatorPersistence();
    return true;
  },
  setAltitude(altitudeM: number): boolean {
    if (!Number.isFinite(altitudeM) || altitudeM < -500 || altitudeM > 9_000) {
      useActivitySimulatorStore.setState({ lastFailure: 'Altitude must be between -500 and 9,000 m.' });
      return false;
    }
    useActivitySimulatorStore.setState({ altitudeM, lastFailure: null });
    scheduleSimulatorPersistence();
    return true;
  },
  setAltitudeMode(altitudeMode: SimulatorAltitudeMode) {
    const verticalRateMPerHour = altitudeMode === 'climb'
      ? 300
      : altitudeMode === 'descend' ? -300 : altitudeMode === 'flat' ? 0 : useActivitySimulatorStore.getState().verticalRateMPerHour;
    useActivitySimulatorStore.setState({ altitudeMode, verticalRateMPerHour });
    scheduleSimulatorPersistence();
  },
  setVerticalRate(verticalRateMPerHour: number): boolean {
    if (!Number.isFinite(verticalRateMPerHour) || verticalRateMPerHour < -3_000 || verticalRateMPerHour > 3_000) {
      useActivitySimulatorStore.setState({ lastFailure: 'Vertical rate must be between -3,000 and 3,000 m/h.' });
      return false;
    }
    useActivitySimulatorStore.setState({ altitudeMode: 'custom', verticalRateMPerHour, lastFailure: null });
    scheduleSimulatorPersistence();
    return true;
  },
  setAccuracyPreset(accuracyPreset: SimulatorAccuracyPreset) {
    useActivitySimulatorStore.setState({ accuracyPreset, customAccuracyM: null });
    scheduleSimulatorPersistence();
  },
  setCustomAccuracy(customAccuracyM: number | null): boolean {
    if (customAccuracyM === null) {
      useActivitySimulatorStore.setState({ customAccuracyM: null });
      scheduleSimulatorPersistence();
      return true;
    }
    if (!Number.isFinite(customAccuracyM) || customAccuracyM < 1 || customAccuracyM > 500) {
      useActivitySimulatorStore.setState({ lastFailure: 'Accuracy must be between 1 and 500 m.' });
      return false;
    }
    useActivitySimulatorStore.setState({ customAccuracyM, lastFailure: null });
    scheduleSimulatorPersistence();
    return true;
  },
  setSignal(signal: SimulatorSignal) {
    useActivitySimulatorStore.setState({ signal });
    scheduleSimulatorPersistence();
  },
  setTimeScale(timeScale: SimulatorTimeScale): boolean {
    if (![1, 2, 5, 10, 30, 60, 120].includes(timeScale)) {
      useActivitySimulatorStore.setState({ lastFailure: 'Time scale must be 1×, 2×, 5×, 10×, 30×, 60×, or 120×.' });
      return false;
    }
    useActivitySimulatorStore.setState({ timeScale, lastFailure: null });
    scheduleSimulatorPersistence();
    return true;
  },
  setJoystickActive(joystickActive: boolean) {
    useActivitySimulatorStore.setState({ joystickActive });
  },
  setJoystick(joystickBearingDegrees: number, joystickMagnitude: number) {
    if (!Number.isFinite(joystickBearingDegrees) || !Number.isFinite(joystickMagnitude)) return;
    useActivitySimulatorStore.setState({
      joystickBearingDegrees: ((joystickBearingDegrees % 360) + 360) % 360,
      joystickMagnitude: Math.max(0, Math.min(1, joystickMagnitude)),
      autopilotActive: false,
    });
  },
  releaseJoystick() {
    useActivitySimulatorStore.setState({ joystickActive: false, joystickMagnitude: 0 });
  },
  replaceWaypoints(waypoints: SimulatorWaypoint[]) {
    const bounded = waypoints.slice(0, MAX_SIMULATOR_AUTOPILOT_POINTS);
    const validated = bounded.flatMap((waypoint) => {
      const result = validateCoordinate(waypoint.lat, waypoint.lng);
      return result.ok ? [{ id: waypoint.id || newLocalId('wp'), ...result.coordinate }] : [];
    });
    useActivitySimulatorStore.setState({
      waypoints: validated,
      autopilotActive: validated.length > 0,
      lastFailure: validated.length === bounded.length ? null : 'Walking path contained an invalid coordinate.',
    });
    scheduleSimulatorPersistence();
  },
  enqueueWaypoint(coordinate: SimulatorCoordinate): boolean {
    const result = validateCoordinate(coordinate.lat, coordinate.lng);
    if (!result.ok) {
      useActivitySimulatorStore.setState({ lastFailure: result.reason });
      return false;
    }
    const state = useActivitySimulatorStore.getState();
    if (state.waypoints.length >= MAX_SIMULATOR_AUTOPILOT_POINTS) {
      useActivitySimulatorStore.setState({ lastFailure: `Waypoint queue is limited to ${MAX_SIMULATOR_AUTOPILOT_POINTS}.` });
      return false;
    }
    useActivitySimulatorStore.setState({
      waypoints: [...state.waypoints, { id: newLocalId('wp'), ...result.coordinate }],
      autopilotActive: true,
      lastFailure: null,
    });
    scheduleSimulatorPersistence();
    return true;
  },
  moveToWaypoint(coordinate: SimulatorCoordinate): boolean {
    const result = validateCoordinate(coordinate.lat, coordinate.lng);
    if (!result.ok) {
      useActivitySimulatorStore.setState({ lastFailure: result.reason });
      return false;
    }
    useActivitySimulatorStore.setState({
      waypoints: [{ id: newLocalId('wp'), ...result.coordinate }],
      autopilotActive: true,
      pickerMode: null,
      mapSelection: null,
      lastFailure: null,
    });
    scheduleSimulatorPersistence();
    return true;
  },
  stopAutopilot() {
    useActivitySimulatorStore.setState({ autopilotActive: false, waypoints: [] });
    scheduleSimulatorPersistence();
  },
  restoreRuntimeTail(current: SimulatorCoordinate, altitudeM: number, virtualTimestampMs: number) {
    const state = useActivitySimulatorStore.getState();
    const startedAt = state.virtualActivityStartedAtMs ?? virtualTimestampMs;
    useActivitySimulatorStore.setState({
      current: { lat: current.lat, lng: normalizeLongitude(current.lng) },
      altitudeM,
      virtualTimestampMs,
      effectiveVirtualElapsedMs: Math.max(0, virtualTimestampMs - startedAt),
      clockLimitReached: false,
      joystickActive: false,
      joystickMagnitude: 0,
      autopilotActive: false,
      pickerMode: null,
      waypoints: [],
      lastFailure: null,
    });
    scheduleSimulatorPersistence();
  },
  setRuntimePosition(current: SimulatorCoordinate, altitudeM: number, clock: {
    virtualTimestampMs: number;
    effectiveVirtualElapsedMs: number;
    batchSequence: number;
    clockLimitReached: boolean;
  }) {
    useActivitySimulatorStore.setState({
      current: { lat: current.lat, lng: normalizeLongitude(current.lng) },
      altitudeM,
      virtualTimestampMs: clock.virtualTimestampMs,
      effectiveVirtualElapsedMs: clock.effectiveVirtualElapsedMs,
      batchSequence: clock.batchSequence,
      clockLimitReached: clock.clockLimitReached,
    });
    scheduleSimulatorPersistence();
  },
  shiftWaypoint() {
    const state = useActivitySimulatorStore.getState();
    const waypoints = state.waypoints.slice(1);
    useActivitySimulatorStore.setState({ waypoints, autopilotActive: waypoints.length > 0 });
    scheduleSimulatorPersistence();
  },
  bindActivity(userId: string, clientActivityId: string, startedAt: number): string {
    const current = useActivitySimulatorStore.getState();
    const resumingSameActivity = current.boundActivityClientId === clientActivityId;
    const simulatorSessionId = resumingSameActivity && current.simulatorSessionId
      ? current.simulatorSessionId
      : newLocalId('sim');
    const virtualActivityStartedAtMs = resumingSameActivity && current.virtualActivityStartedAtMs
      ? current.virtualActivityStartedAtMs
      : startedAt;
    const virtualTimestampMs = resumingSameActivity
      ? Math.max(startedAt, current.virtualTimestampMs || 0)
      : startedAt;
    useActivitySimulatorStore.setState({
      hydratedUserId: userId,
      simulatorSessionId,
      boundActivityClientId: clientActivityId,
      latestActivityClientId: clientActivityId,
      virtualActivityStartedAtMs,
      virtualTimestampMs,
      effectiveVirtualElapsedMs: resumingSameActivity
        ? Math.max(current.effectiveVirtualElapsedMs, virtualTimestampMs - virtualActivityStartedAtMs)
        : 0,
      sampleSequence: resumingSameActivity ? current.sampleSequence : 0,
      batchSequence: resumingSameActivity ? current.batchSequence : 0,
      clockLimitReached: resumingSameActivity ? current.clockLimitReached : false,
      lastGeneratedSample: resumingSameActivity ? current.lastGeneratedSample : null,
      lastAcceptedSample: resumingSameActivity ? current.lastAcceptedSample : null,
      lastRejectionReason: resumingSameActivity ? current.lastRejectionReason : null,
      lastDecision: resumingSameActivity ? current.lastDecision : null,
      lastFailure: resumingSameActivity ? current.lastFailure : null,
    });
    scheduleSimulatorPersistence();
    return simulatorSessionId;
  },
  unbindActivity(options) {
    const clearOrigin = options?.clearOrigin === true;
    useActivitySimulatorStore.setState({
      boundActivityClientId: null,
      virtualActivityStartedAtMs: null,
      effectiveVirtualElapsedMs: 0,
      batchSequence: 0,
      clockLimitReached: false,
      joystickActive: false,
      joystickMagnitude: 0,
      autopilotActive: false,
      pickerMode: null,
      mapSelection: null,
      waypoints: [],
      ...(clearOrigin ? {
        startConfigured: false,
        origin: DEFAULT_COORDINATE,
        current: DEFAULT_COORDINATE,
        latestActivityClientId: null,
        simulatorSessionId: null,
        virtualTimestampMs: 0,
        sampleSequence: 0,
        lastGeneratedSample: null,
        lastAcceptedSample: null,
        lastRejectionReason: null,
        lastDecision: null,
      } : {}),
    });
    scheduleSimulatorPersistence();
  },
  recordGeneratedSample(lastGeneratedSample: SimulatorGeneratedSample) {
    useActivitySimulatorStore.setState({ lastGeneratedSample });
  },
  recordDecision(lastDecision: SimulatorDecision) {
    useActivitySimulatorStore.setState({
      lastDecision,
      lastAcceptedSample: lastDecision.accepted
        ? lastDecision
        : useActivitySimulatorStore.getState().lastAcceptedSample,
      lastRejectionReason: lastDecision.accepted ? null : lastDecision.reason,
      sampleSequence: Math.max(useActivitySimulatorStore.getState().sampleSequence, lastDecision.sequence),
      lastFailure: lastDecision.accepted ? useActivitySimulatorStore.getState().lastFailure : lastDecision.reason,
    });
  },
  setMapDiagnostics(diagnostics: Partial<SimulatorMapDiagnostics>) {
    const current = useActivitySimulatorStore.getState().mapDiagnostics;
    useActivitySimulatorStore.setState({ mapDiagnostics: { ...current, ...diagnostics } });
  },
  setLastFailure(lastFailure: string | null) {
    useActivitySimulatorStore.setState({ lastFailure });
  },
  beginQaSession(userId: string, forceNew = false): string | null {
    const state = useActivitySimulatorStore.getState();
    if (!userId || state.hydratedUserId !== userId) return null;
    const now = Date.now();
    const reusable = !forceNew
      && state.qaSessionId
      && state.qaSessionEndedAt === null
      && state.qaSessionStartedAt !== null
      && now - state.qaSessionStartedAt <= QA_SESSION_MAX_AGE_MS;
    if (reusable) return state.qaSessionId;
    const qaSessionId = newLocalId('qa').slice(0, 64);
    useActivitySimulatorStore.setState({
      qaSessionId,
      qaSessionStartedAt: now,
      qaSessionEndedAt: null,
    });
    scheduleSimulatorPersistence();
    return qaSessionId;
  },
  endQaSession(): string | null {
    const state = useActivitySimulatorStore.getState();
    if (!state.qaSessionId || state.qaSessionEndedAt !== null) return state.qaSessionId;
    useActivitySimulatorStore.setState({ qaSessionEndedAt: Date.now() });
    scheduleSimulatorPersistence();
    return state.qaSessionId;
  },
  resetWhenIdle(): boolean {
    const state = useActivitySimulatorStore.getState();
    let activityInProgress = Boolean(state.boundActivityClientId);
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const tracking = require('../../store/useTrackingStore').useTrackingStore.getState();
      activityInProgress = activityInProgress || tracking.status !== 'idle' || Boolean(tracking.sessionId);
    } catch { /* bound identity remains the fail-safe */ }
    if (activityInProgress) {
      useActivitySimulatorStore.setState({ lastFailure: 'Finish or discard the active Activity before resetting Simulator.' });
      return false;
    }
    useActivitySimulatorStore.setState({
      ...defaults(state.hydratedUserId),
      enabled: state.enabled,
      qaSessionId: state.qaSessionId,
      qaSessionStartedAt: state.qaSessionStartedAt,
      qaSessionEndedAt: state.qaSessionEndedAt,
    });
    scheduleSimulatorPersistence();
    return true;
  },
} satisfies Pick<
  ActivitySimulatorState,
  | 'setEnabled' | 'setExpanded' | 'setPickerMode' | 'setOrigin' | 'setCurrent' | 'setMapSelection'
  | 'setSpeedPreset' | 'setCustomSpeed' | 'setAltitude' | 'setAltitudeMode'
  | 'setVerticalRate' | 'setAccuracyPreset' | 'setCustomAccuracy' | 'setSignal' | 'setTimeScale'
  | 'setJoystickActive' | 'setJoystick' | 'releaseJoystick' | 'replaceWaypoints' | 'enqueueWaypoint'
  | 'moveToWaypoint' | 'stopAutopilot' | 'restoreRuntimeTail' | 'setRuntimePosition' | 'shiftWaypoint'
  | 'bindActivity' | 'unbindActivity' | 'recordGeneratedSample' | 'recordDecision'
  | 'setMapDiagnostics' | 'setLastFailure' | 'beginQaSession' | 'endQaSession'
  | 'resetWhenIdle'
>;

export const useActivitySimulatorStore = create<ActivitySimulatorState>(() => defaults(null));

export type FreshSimulatorSetupResult =
  | 'reset'
  | 'preserved-live-activity'
  | 'preserved-unfinished-activity'
  | 'preserved-registry-uncertain'
  | 'owner-not-hydrated';

/**
 * Start each newly focused Hike/Run with a clean virtual-origin setup while
 * preserving the exact durable state needed to recover one unfinished
 * Activity. This is deliberately registry-aware: screen-local `status=idle`
 * alone is also true before the recovery modal restores an unfinished owner.
 */
export async function initializeFreshSimulatorSetupForActivityEntry(
  userId: string,
  getUnfinished?: (ownerUserId: string) => Promise<UnfinishedActivityRecord | null>,
): Promise<FreshSimulatorSetupResult> {
  const before = useActivitySimulatorStore.getState();
  if (!userId || before.hydratedUserId !== userId) return 'owner-not-hydrated';

  let tracking: { status: string; sessionId: string | null } = { status: 'idle', sessionId: null };
  try {
    // Lazy resolution avoids the Tracking -> Simulator store initialization cycle.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    tracking = require('../../store/useTrackingStore').useTrackingStore.getState();
  } catch { /* persisted binding below remains the fail-safe */ }
  if (before.boundActivityClientId || tracking.status !== 'idle' || tracking.sessionId) {
    return 'preserved-live-activity';
  }

  const lookup = getUnfinished ?? (async (ownerUserId: string) => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getUnfinishedActivity } = require('../activity/activityRegistry');
    return getUnfinishedActivity(ownerUserId) as Promise<UnfinishedActivityRecord | null>;
  });
  let unfinished: UnfinishedActivityRecord | null;
  try {
    unfinished = await lookup(userId);
  } catch {
    // Storage uncertainty fails closed. Clearing a recoverable virtual owner
    // is worse than requiring one manual retry on this entry.
    return 'preserved-registry-uncertain';
  }

  // Re-check after storage I/O so a concurrently started Activity can never be
  // reset by a stale screen-focus continuation.
  const current = useActivitySimulatorStore.getState();
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    tracking = require('../../store/useTrackingStore').useTrackingStore.getState();
  } catch { /* persisted binding below remains the fail-safe */ }
  if (
    current.hydratedUserId !== userId
    || current.boundActivityClientId
    || tracking.status !== 'idle'
    || tracking.sessionId
  ) return 'preserved-live-activity';
  if (unfinished) return 'preserved-unfinished-activity';

  useActivitySimulatorStore.setState({
    ...defaults(userId),
    enabled: current.enabled,
    qaSessionId: current.qaSessionId,
    qaSessionStartedAt: current.qaSessionStartedAt,
    qaSessionEndedAt: current.qaSessionEndedAt,
    // Mapbox owns its screen lifecycle. Resetting virtual GPS input must not
    // rewrite a MapView that may already have emitted native readiness.
    mapDiagnostics: current.mapDiagnostics,
  });
  await persistActivitySimulatorNow();
  return 'reset';
}

export async function hydrateActivitySimulatorForUser(userId: string | null): Promise<void> {
  await persistTail.catch(() => {});
  if (!userId) {
    useActivitySimulatorStore.setState(defaults(null));
    return;
  }
  // Clear another user's in-memory coordinates before awaiting storage.
  if (useActivitySimulatorStore.getState().hydratedUserId !== userId) {
    useActivitySimulatorStore.setState(defaults(userId));
  }
  try {
    const raw = await AsyncStorage.getItem(keyFor(userId));
    if (useActivitySimulatorStore.getState().hydratedUserId !== userId) return;
    const saved = raw ? sanitizePersisted(JSON.parse(raw)) : {};
    useActivitySimulatorStore.setState({ ...defaults(userId), ...saved, hydratedUserId: userId });
    const boundActivityClientId = useActivitySimulatorStore.getState().boundActivityClientId;
    if (boundActivityClientId) {
      try {
        // A completed/discarded Activity from an older build can leave a stale
        // provider binding. Keep it only when the durable registry proves the
        // exact unfinished Simulator owner still exists.
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { getUnfinishedActivity } = require('../activity/activityRegistry');
        const unfinished = await getUnfinishedActivity(userId);
        if (useActivitySimulatorStore.getState().hydratedUserId !== userId) return;
        if (
          !unfinished
          || unfinished.clientActivityId !== boundActivityClientId
          || unfinished.locationProviderSource !== 'simulator'
        ) {
          useActivitySimulatorStore.getState().unbindActivity({ clearOrigin: true });
          await persistActivitySimulatorNow();
        }
      } catch {
        // Registry uncertainty fails safe: retain continuity until the next
        // successful reconciliation or explicit Activity resolution.
      }
    }
  } catch {
    useActivitySimulatorStore.setState(defaults(userId));
  }
}

export function simulatorAccuracyMeters(state = useActivitySimulatorStore.getState()): number {
  return state.customAccuracyM ?? SIMULATOR_ACCURACY_METERS[state.accuracyPreset];
}

export function simulatorStorageKey(userId: string): string {
  return keyFor(userId);
}
