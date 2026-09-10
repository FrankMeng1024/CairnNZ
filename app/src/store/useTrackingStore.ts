/**
 * useTrackingStore — live GPS tracking session management.
 *
 * Architecture:
 *   - foreground: watchPositionAsync gives instant updates while app is active
 *   - background: startLocationUpdatesAsync + TaskManager keeps tracking on lock screen
 *   - Single-source guarantee: at any given instant ONLY ONE source feeds addTrackPoint —
 *     foreground watcher when AppState is 'active', background drain when 'background'.
 *     This eliminates the 1.7× duplicate-fix logging seen in Sprint 41 telemetry.
 *   - Timestamp-based dedupe: addTrackPoint uses position.timestamp; if a fix with the
 *     same timestamp has already been recorded, we skip it. Fallback: same-timestamp
 *     fixes >5m apart are kept (GPS may reuse timestamps but real movement still wins).
 *   - dynamic sampling: every 60s checks battery + movement and updates future
 *     provider activation settings without churning an already-running native task
 *
 * Web/non-native fallback: recording start remains unavailable without a real
 * location source; QA may render controlled store states without starting GPS.
 */
import { create } from 'zustand';
import { Alert, AppState, Platform, type AppStateStatus } from 'react-native';
import {
  haversineM, getSamplingInterval, classifyMovement,
  kalmanInit, kalmanUpdate, type KalmanState,
} from '../utils/geo';
import { getCurrentRegion } from '../config/regions';
import { resolveMapboxPublicTokenAuthority } from '../config/mapbox';
import { useSessionStore } from './useSessionStore';
import type { TrackPoint, ActivityMode } from './useSessionStore';
import type { Coordinate } from '../utils/geo';
import { debugLogger } from '../services/debugLogger';
import { batteryMonitor } from '../services/batteryMonitor';
import { networkMonitor } from '../services/networkMonitor';
import { sessionRecorder } from '../services/sessionRecorder';
import { telemetryUploader } from '../services/telemetryUploader';
import {
  startSessionResolved,
  fetchSessionDetail,
  appendPoints as remoteAppendPoints,
  deleteRemoteSession,
  deleteRemoteSessionByClientId,
  saveHikeAtomic,
} from '../services/sessionService';
import { crashLogger } from '../services/crashLogger';
// v412: 用于 saveHikeAtomic idempotencyKey + memory unsynced 采样
import { uuidv4 } from '../services/offlineQueue';
import { useMemoryStore } from '../features/memory/store/useMemoryStore';
import { useAppStore } from './useAppStore';
// v402: snap-to-road at hike-save.
import {
  analyzeTrustedEndpointCoverage,
  evaluateMatchedGeometryQuality,
  preserveTrustedRouteEndpoints,
  snapTrack,
} from '../services/routing/snapTrack';
import {
  BACKGROUND_LOCATION_TASK,
  registerBackgroundTask,
  drainBackgroundLocations,
  persistBackgroundContext,
  settleBackgroundLocationWrites,
} from '../services/backgroundLocationTask';
import {
  calculateLifecycleDurationMs,
  calculateActivityStats,
  isCredibleMotionSample,
  MAX_ACCEPTABLE_HORIZONTAL_ACCURACY_M,
  MAX_CREDITABLE_ACTIVE_INTERVAL_MS,
  newSegmentId,
  saveEligibility,
  segmentTrace,
  shouldStartNewSegment,
  toServerPoint,
  type SegmentedTrackPoint,
  type SegmentStartReason,
} from '../features/activity/activityContracts';
import {
  refreshBackgroundAuthorization,
  type BackgroundLocationPermissionState,
} from '../features/activity/backgroundAuthorization';
import {
  acknowledgeActivity,
  completeActivity,
  getUnfinishedActivity,
  mapActivityServerId,
  replaceUnfinishedActivity,
  registerUnfinishedActivity,
  tombstoneActivity,
  updateUnfinishedActivity,
} from '../features/activity/activityRegistry';
import { recordMemoryEvidence } from '../features/memory/services/recordMemoryEvidence';
import {
  activateSimulatorProvider,
  endSimulatorProvider,
  isSimulatorProviderBound,
  pauseSimulatorProvider,
  pauseSimulatorProviderForCorrection,
  prepareSimulatorProvider,
  reacquireSimulatorProviderAt,
  restoreSimulatorProviderTail,
  selectedActivityLocationSource,
} from '../features/activitySimulator/activityLocationProvider';
import {
  appendSimulatorLog,
  beginQaTelemetrySession,
  endQaTelemetrySession,
  flushSimulatorLogs,
  getQaTelemetryHealth,
} from '../features/activitySimulator/simulatorLog';
import {
  acceptRealGpsObservation,
  createRealGpsContinuityState,
  discardPendingCandidate,
  evaluateRealGpsObservation,
  REAL_GPS_CANDIDATE_MAX_AGE_MS,
  type MotionDecision,
  type RealGpsContinuityState,
  type RealGpsObservation,
} from '../features/activity/realGpsContinuity';
import {
  createElevationQualityState,
  reduceElevationObservation,
  type ElevationDecision,
  type ElevationQualityState,
} from '../features/activity/elevationQuality';
import {
  activityFreshnessNow,
  activityTimestampForSource,
  simulatorActivityStartTimestamp,
} from '../features/activitySimulator/simulatorTime';
import { useActivitySimulatorStore } from '../features/activitySimulator/useActivitySimulatorStore';
import type { ActivityLocationSource } from '../features/activitySimulator/types';
import { planSimulatorRollback } from '../features/activitySimulator/simulatorActivityCorrection';
import { validateCoordinate } from '../features/activitySimulator/geodesy';

// Lazy import expo-location to avoid crash on web
let Location: typeof import('expo-location') | null = null;
let locationSubscription: { remove: () => void } | null = null;
let drainInterval: ReturnType<typeof setInterval> | null = null;
let dynamicSamplingInterval: ReturnType<typeof setInterval> | null = null;
let incrementalFlushInterval: ReturnType<typeof setInterval> | null = null;
// Sprint 72 STORY-00555 — hiking token refresh interval
let tokenRefreshInterval: ReturnType<typeof setInterval> | null = null;
let realTelemetryHealthInterval: ReturnType<typeof setInterval> | null = null;
let activityLifecycleInterval: ReturnType<typeof setInterval> | null = null;
let appStateSubscription: { remove: () => void } | null = null;
let lastSamplingIntervalMs = 3000;
let backgroundTaskActive = false;
let simulatorSourceActive = false;
let backgroundGrantedCached = false;
let pointIngestTail: Promise<void> = Promise.resolve();
let finishIngestCutoffMs: number | null = null;
let realGpsContinuitySessionId: string | null = null;
let realGpsContinuityState: RealGpsContinuityState = createRealGpsContinuityState();
let realGpsRawOrdinal = 0;
let realGpsCandidateTimer: ReturnType<typeof setTimeout> | null = null;
let realElevationState: ElevationQualityState = createElevationQualityState();
let realActivityQaSessionId: string | null = null;
const LEGACY_SAF01_STORAGE_KEY = 'cairn_saf01_payload';
const saf01StorageKey = (userId: string) => `cairn_saf01_payload:${userId}`;
// Index into trackPoints[] of the next un-flushed point. The periodic
// incremental-backup interval reads `trackPoints.slice(lastFlushedIdx)`,
// PATCHes those to the server, and advances the index on success. On
// failure the index is NOT advanced — next interval re-tries the same
// range, so dropped network is recovered automatically.
let lastFlushedIdx = 0;

// Legacy Kalman state remains Simulator-only for parity. Real GPS uses the
// versioned physical-continuity reducer and its bounded causal display tail.
let kalmanLat: KalmanState | null = null;
let kalmanLng: KalmanState | null = null;
// Simulator-only legacy presentation constant.
const KALMAN_PROCESS_NOISE = 1e-9;
const ACCURACY_REJECT_M = MAX_ACCEPTABLE_HORIZONTAL_ACCURACY_M;
// v77: tightened from 15 → 10 m/s. Real upper bound for hike/run/trail
// running is 8 m/s (top trail runner). 10 gives buffer; anything beyond
// is GPS glitch (river-crossing teleport).
const TELEPORT_SPEED_MPS = 10;
const STATIONARY_SPEED_MPS = 0.5;         // below this, we treat as standing still
const STATIONARY_RADIUS_MIN_M = 8;        // suppress fixes within this circle of last accepted
// R114/O22 STORY-73012 (K2): 15 km/h = 4.17 m/s upper bound for hiking.
// Above this the user is driving (car / bike / bus) — the segment should
// not count toward the hike. Points at overspeed are dropped from the
// clean track (still logged raw for audit). We also set an `overSpeed`
// state flag so HikingScreen can render a "too fast to be a hike" banner.
// Applies only when activityMode === 'hiking' (running can legitimately
// exceed 15 km/h in short sprints).
const HIKING_OVERSPEED_MPS = 4.17;
// Source Activity durability is already committed locally before this wait.
// Give a healthy server a short chance to acknowledge; weak networks fall
// back to the idempotent pending-sync record instead of blocking Finish for
// the historical 20-second envelope.
const IMMEDIATE_SERVER_SAVE_BUDGET_MS = 4_000;
// v77: avgSpeedMps removed. We now use GPS-reported `coords.speed`
// (Doppler-derived, immune to position drift) instead of computing
// speed from position history — which produced false-positive "you're
// moving 3 m/s" readings while actually standing still due to GPS noise.

async function getLocation() {
  if (!Location) {
      try {
        const imported = await import('expo-location');
        Location = ((imported as any).default ?? imported) as typeof import('expo-location');
      } catch {
        try {
          // Jest/CommonJS and some Metro recovery bundles expose the same
          // module synchronously even when the dynamic-import wrapper fails.
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const imported = require('expo-location');
          Location = (imported?.default ?? imported) as typeof import('expo-location');
        } catch {
          return null;
        }
      }
  }
  return Location;
}

async function refreshRealBackgroundAuthorization(
  requestIfEligible: boolean,
): Promise<boolean> {
  const loc = await getLocation();
  if (!loc) {
    backgroundGrantedCached = false;
    useTrackingStore.setState({ backgroundLocationPermission: 'foreground-only' });
    return false;
  }
  try {
    const result = await refreshBackgroundAuthorization(loc, { requestIfEligible });
    backgroundGrantedCached = result.granted;
    useTrackingStore.setState({ backgroundLocationPermission: result.state });
    const state = useTrackingStore.getState();
    appendSimulatorLog('PROVIDER', 'background_location_authorization_refreshed', {
      permissionState: result.state,
      canAskAgain: result.canAskAgain,
      requestAttempted: result.requestAttempted,
    }, {
      userId: state.ownerUserId,
      clientActivityId: state.sessionId,
      coordinateSource: 'none',
    });
    appendSimulatorLog('PROVIDER', 'activity_background_authority_v2', {
      phase: 'authorization-refreshed',
      permissionState: result.state,
      canAskAgain: result.canAskAgain,
      requestAttempted: result.requestAttempted,
      appState: AppState.currentState,
      foregroundWatcherActive: Boolean(locationSubscription),
      backgroundTaskActive,
      ownerGenerationSuffix: state.liveOwnerGeneration?.slice(-8) ?? null,
    }, {
      userId: state.ownerUserId,
      clientActivityId: state.sessionId,
      qaSessionId: realActivityQaSessionId,
      coordinateSource: 'none',
    });
    return result.granted;
  } catch (error) {
    backgroundGrantedCached = false;
    useTrackingStore.setState({ backgroundLocationPermission: 'foreground-only' });
    crashLogger.breadcrumb(`activity:bg_permission_refresh_failed ${String(error).slice(0, 80)}`);
    return false;
  }
}

function resetRealGpsDiagnosticState(clientActivityId: string | null): void {
  if (realGpsCandidateTimer) clearTimeout(realGpsCandidateTimer);
  realGpsCandidateTimer = null;
  realGpsContinuitySessionId = clientActivityId;
  realGpsContinuityState = createRealGpsContinuityState();
  realGpsRawOrdinal = 0;
  realElevationState = createElevationQualityState();
}

function ensureRealGpsContinuityState(state: TrackingState): RealGpsContinuityState {
  if (!realActivityQaSessionId && state.ownerUserId) {
    // Recovery reuses the persisted Internal-QA session when it is still live;
    // otherwise the telemetry store creates a new bounded continuation.
    realActivityQaSessionId = beginQaTelemetrySession(state.ownerUserId, false);
  }
  if (
    realGpsContinuitySessionId === state.sessionId
    && !(state.trackPoints.length === 0 && realGpsContinuityState.lastTrusted !== null)
  ) return realGpsContinuityState;
  const restored = state.trackPoints.slice(-2).map((point, index) => {
    const segmented = point as SegmentedTrackPoint;
    return {
      lat: point.lat,
      lng: point.lng,
      t: point.t,
      accuracy: point.accuracy ?? null,
      verticalAccuracy: point.verticalAccuracy ?? null,
      altitude: point.alt ?? null,
      speed: point.speed ?? null,
      course: point.course ?? null,
      source: segmented.source === 'background' ? 'background' as const : 'foreground' as const,
          observationId: 'restored-' + index + '-' + point.t,
          rawOrdinal: point.rawOrdinal,
          segmentId: segmented.segmentId || state.currentSegmentId || 'legacy-0',
    };
  });
  realGpsContinuitySessionId = state.sessionId;
  realGpsContinuityState = createRealGpsContinuityState(restored);
  realGpsRawOrdinal = Math.max(
    state.trackPointsRaw.length,
    ...state.trackPointsRaw.map(point => point.rawOrdinal ?? 0),
  );
  realElevationState = createElevationQualityState(state.elevationGainM);
  return realGpsContinuityState;
}

function diagnosticNumber(value: number | null | undefined): number | null {
  return value != null && Number.isFinite(value) ? Math.round(value * 100) / 100 : null;
}

function geometryFingerprint(points: ReadonlyArray<TrackPoint>): string {
  // Equality/provenance only: coordinates never leave telemetry, and this
  // one-way compact fingerprint cannot render or reconstruct a route.
  let hash = 0x811c9dc5;
  for (const point of points) {
    const value = `${point.lat.toFixed(6)},${point.lng.toFixed(6)},${point.segmentId ?? ''};`;
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
  }
  return hash.toString(16).padStart(8, '0');
}

function motionStateFor(decision: MotionDecision): 'acquiring' | 'stationary' | 'moving' {
  if (decision.diagnostics.dtFromTrustedMs === null) return 'acquiring';
  return (decision.diagnostics.displacementFromTrustedM ?? 0) < 3 ? 'stationary' : 'moving';
}

function emitRealGpsDecision(
  owner: TrackingState,
  observation: RealGpsObservation,
  decision: MotionDecision,
  decisionStartedAtMs: number,
  rawOrdinal: number,
): void {
  const fields = {
    filterVersion: 1,
    rawOrdinal,
    sampleSource: observation.source,
    sampleTimestamp: observation.t,
    horizontalAccuracyM: diagnosticNumber(observation.accuracy),
    verticalAccuracyM: diagnosticNumber(observation.verticalAccuracy),
    reportedSpeedValid: observation.speed != null && observation.speed >= 0,
    reportedSpeedMps: observation.speed != null && observation.speed >= 0
      ? diagnosticNumber(observation.speed)
      : null,
    reportedCourseValid: observation.course != null && observation.course >= 0,
    dtFromTrustedMs: decision.diagnostics.dtFromTrustedMs,
    displacementFromTrustedM: diagnosticNumber(decision.diagnostics.displacementFromTrustedM),
    impliedSpeedMps: diagnosticNumber(decision.diagnostics.impliedSpeedMps),
    accuracyAdjustedSpeedMps: diagnosticNumber(decision.diagnostics.lowerBoundSpeedMps),
    trajectoryInnovationM: diagnosticNumber(decision.diagnostics.predictionInnovationM),
    headingDeltaDeg: diagnosticNumber(decision.diagnostics.headingDeltaDeg),
    motionState: motionStateFor(decision),
    decision: decision.kind,
    decisionReason: decision.reason,
    candidateId: decision.candidateEvent?.candidateId ?? decision.state.pending?.id ?? null,
    candidateRawOrdinal: decision.candidateEvent?.candidateRawOrdinal
      ?? decision.state.pending?.observation.rawOrdinal
      ?? null,
    corroboratingRawOrdinal: decision.candidateEvent ? rawOrdinal : null,
    candidateEvidenceCount: decision.state.pending?.evidenceCount ?? null,
    decisionLatencyMs: Date.now() - decisionStartedAtMs,
    segmentId: owner.currentSegmentId,
  };
  appendSimulatorLog(
    decision.kind === 'ACCEPT' ? 'GPS_ACCEPT' : 'GPS_REJECT',
    'activity_filter_decision_v2',
    fields,
    {
      userId: owner.ownerUserId,
      clientActivityId: owner.sessionId,
      qaSessionId: realActivityQaSessionId,
      coordinateSource: 'real',
    },
  );
  if (decision.candidateEvent) {
    appendSimulatorLog('GPS_REJECT', 'activity_candidate_transition_v1', {
      transition: decision.candidateEvent.type,
      rawOrdinal,
      reason: decision.reason,
      candidateId: decision.candidateEvent.candidateId,
      candidateRawOrdinal: decision.candidateEvent.candidateRawOrdinal
        ?? decision.state.pending?.observation.rawOrdinal
        ?? null,
      ageMs: decision.candidateEvent.delayMs,
      fixCount: decision.state.pending?.evidenceCount ?? 2,
      detourExcessM: diagnosticNumber(decision.candidateEvent.detourExcessM),
      reversalDeg: diagnosticNumber(decision.candidateEvent.reversalDeg),
    }, {
      userId: owner.ownerUserId,
      clientActivityId: owner.sessionId,
      qaSessionId: realActivityQaSessionId,
      coordinateSource: 'real',
    });
    appendSimulatorLog(
      decision.candidateEvent.type === 'candidate_confirmed' ? 'GPS_ACCEPT' : 'GPS_REJECT',
      decision.candidateEvent.type,
      {
        rawOrdinal,
        reason: decision.reason,
        candidateId: decision.candidateEvent.candidateId,
        candidateRawOrdinal: decision.candidateEvent.candidateRawOrdinal ?? null,
        corroboratingRawOrdinal: rawOrdinal,
        delayIntroducedMs: decision.candidateEvent.delayMs,
        relativeDisplacementM: diagnosticNumber(decision.diagnostics.displacementFromTrustedM),
        horizontalAccuracyM: diagnosticNumber(observation.accuracy),
        dtFromTrustedMs: decision.diagnostics.dtFromTrustedMs,
        corroboratingDisplacementM: diagnosticNumber(decision.candidateEvent.corroboratingDisplacementM),
        detourExcessM: diagnosticNumber(decision.candidateEvent.detourExcessM),
        reversalDeg: diagnosticNumber(decision.candidateEvent.reversalDeg),
      },
      {
        userId: owner.ownerUserId,
        clientActivityId: owner.sessionId,
        qaSessionId: realActivityQaSessionId,
        coordinateSource: 'real',
      },
    );
  }
}

async function emitRealTelemetryHealth(reason: string): Promise<void> {
  const state = useTrackingStore.getState();
  if (!state.ownerUserId || !state.sessionId || !realActivityQaSessionId) return;
  const health = await getQaTelemetryHealth(state.ownerUserId, realActivityQaSessionId);
  appendSimulatorLog('SYNC_STATE', 'activity_telemetry_health_v2', {
    reason,
    expectedRawOrdinalHighWatermark: realGpsRawOrdinal,
    retainedObservationDeficit: Math.max(0, realGpsRawOrdinal - health.retainedObservationCount),
    retainedDecisionDeficit: Math.max(0, realGpsRawOrdinal - health.retainedDecisionCount),
    rawPointCount: state.trackPointsRaw.length,
    canonicalPointCount: state.trackPoints.length,
    pendingCandidate: Boolean(realGpsContinuityState.pending),
    latestAcceptedAgeMs: state.lastCoordinateTime == null
      ? null
      : Math.max(0, Date.now() - state.lastCoordinateTime),
    backgroundTaskActive,
    appState: AppState.currentState,
    ...health,
  }, {
    userId: state.ownerUserId,
    clientActivityId: state.sessionId,
    qaSessionId: realActivityQaSessionId,
    coordinateSource: 'none',
  });
}

function stopRealTelemetryHealthTimer(): void {
  if (!realTelemetryHealthInterval) return;
  clearInterval(realTelemetryHealthInterval);
  realTelemetryHealthInterval = null;
}

function startRealTelemetryHealthTimer(): void {
  stopRealTelemetryHealthTimer();
  if (useTrackingStore.getState().locationProviderSource !== 'real') return;
  void emitRealTelemetryHealth('tracking-started');
  realTelemetryHealthInterval = setInterval(() => {
    void emitRealTelemetryHealth('periodic-60s');
  }, 60_000);
}

async function persistCurrentRealBackgroundContext(): Promise<boolean> {
  const state = useTrackingStore.getState();
  if (
    state.locationProviderSource !== 'real'
    || state.status !== 'tracking'
    || !state.sessionId
    || !state.ownerUserId
    || !state.liveOwnerGeneration
  ) return false;
  return persistBackgroundContext(state.sessionId, true, {
    clientActivityId: state.sessionId,
    userId: state.ownerUserId,
    ownerGeneration: state.liveOwnerGeneration,
    segmentId: state.currentSegmentId ?? newSegmentId(state.sessionId),
    activityMode: state.activityMode,
    acceptAfterMs: state.liveOwnerAcceptAfterMs ?? state.startedAt ?? Date.now(),
    qaSessionId: realActivityQaSessionId,
    continuityState: realGpsContinuityState,
    rawOrdinal: realGpsRawOrdinal,
    backgroundPermissionState: state.backgroundLocationPermission,
  });
}

function schedulePendingCandidateTimeout(owner: TrackingState): void {
  if (realGpsCandidateTimer) clearTimeout(realGpsCandidateTimer);
  realGpsCandidateTimer = null;
  const pending = realGpsContinuityState.pending;
  if (!pending || !owner.sessionId) return;
  const activityId = owner.sessionId;
  realGpsCandidateTimer = setTimeout(() => {
    realGpsCandidateTimer = null;
    if (
      realGpsContinuitySessionId !== activityId
      || realGpsContinuityState.pending?.id !== pending.id
    ) return;
    const displacementM = realGpsContinuityState.lastTrusted
      ? diagnosticNumber(haversineM(realGpsContinuityState.lastTrusted, pending.observation))
      : null;
    realGpsContinuityState = discardPendingCandidate(realGpsContinuityState);
    appendSimulatorLog('GPS_REJECT', 'candidate_timeout', {
      candidateId: pending.id,
      candidateRawOrdinal: pending.observation.rawOrdinal ?? null,
      reason: 'wall-clock-bound-expired-without-corroborating-fix',
      delayIntroducedMs: REAL_GPS_CANDIDATE_MAX_AGE_MS,
      relativeDisplacementM: displacementM,
      horizontalAccuracyM: diagnosticNumber(pending.observation.accuracy),
    }, {
      userId: owner.ownerUserId,
      clientActivityId: activityId,
      qaSessionId: realActivityQaSessionId,
      coordinateSource: 'real',
    });
    void persistCurrentRealBackgroundContext();
  }, REAL_GPS_CANDIDATE_MAX_AGE_MS);
}

export type TrackingStatus = 'idle' | 'requesting' | 'tracking' | 'paused';
export type TrackingStartError = 'location-unavailable' | 'permission-denied' | 'initialization-failed' | 'unfinished-exists';

export interface ActivityLocationAcceptance {
  accepted: boolean;
  reason: string;
  segmentId?: string | null;
  memoryCommitted?: boolean;
  memoryDeduplicated?: boolean;
}

export interface ActivityCoordinate extends Coordinate {
  clientActivityId?: string;
  ownerGeneration?: string;
  segmentId?: string;
  segmentStartReason?: SegmentStartReason;
  source?: 'foreground' | 'background' | 'significant-change' | 'simulator';
  /** A headless point durably committed before Finish disabled the lease. */
  committedBeforeFinish?: boolean;
  /** Background TaskManager already durably committed this accepted point. */
  continuityPreclassified?: boolean;
  canonicalDecision?: 'ACCEPT' | 'REJECT' | 'QUARANTINE';
  decisionReason?: string;
  continuityStateAfter?: RealGpsContinuityState;
}

interface TrackingState {
  status: TrackingStatus;
  /** Store-boundary finish lock. UI disabling alone cannot prevent two
   * concurrent stop/save pipelines from persisting the same session twice. */
  isFinishing: boolean;
  /** Last proven start failure. Cleared on a new start attempt or success. */
  startError: TrackingStartError | null;
  sessionId: string | null;
  /** Immutable account owner captured before Activity initialization awaits. */
  ownerUserId: string | null;
  /** Durable callback ownership token. A stale source cannot write without it. */
  liveOwnerGeneration: string | null;
  liveOwnerAcceptAfterMs: number | null;
  currentSegmentId: string | null;
  pendingSegmentStartReason: SegmentStartReason | null;
  /** Server-side session id, set after POST /api/sessions/start succeeds.
   *  Used by periodic append backup and the atomic completion request. It
   *  remains null offline; completion then persists a full local payload and
   *  the sync daemon idempotently creates the server shell later. */
  remoteSessionId: number | null;
  activityMode: ActivityMode;
  /** Fixed at Start; provider streams may never be silently merged. */
  locationProviderSource: ActivityLocationSource;
  startedAt: number | null;
  durationS: number;
  /** Lifecycle time frozen before the currently open tracking interval. */
  activeDurationAccumulatedMs: number;
  /** Provider-clock start of the open tracking interval; null while paused. */
  activeDurationStartedAtMs: number | null;
  distanceM: number;
  elevationGainM: number;
  trackPoints: TrackPoint[];
  /** Causal accepted display geometry. Real GPS stays within a small envelope
   *  of canonical truth; Simulator retains its frozen legacy presentation. */
  trackPointsSmoothed: TrackPoint[];
  /** Full in-session raw audit track, including rejected and quarantined
   *  observations. Stored once at
   *  session finalize as `route_points_raw` for debug / future
   *  re-processing with new algorithms. NOT used for rendering or
   *  distance — those use `trackPoints` (clean) and
   *  `trackPointsSmoothed` (Kalman-smoothed clean). */
  trackPointsRaw: TrackPoint[];
  markerIds: string[];         // markers planted during this session
  pausePins: Coordinate[];     // locations where user paused (rendered as flag pins)
  locationAvailable: boolean;  // false on web/simulator
  /** Actual refreshed native background authorization, separate from foreground GPS health. */
  backgroundLocationPermission: BackgroundLocationPermissionState;
  lastCoordinate: Coordinate | null;
  lastCoordinateTime: number | null;  // unix ms of last accepted Activity coordinate
  lastFixTimestamp: number | null;    // latest canonical sample timestamp (for dedupe)
  // O1 batch 40: altitudeHistory removed — written but 0 external readers

  /** v116: why the most recent stopTracking() ended.
   *  - 'saved'     : session had ≥ 2 trackPoints, persisted to local + server
   *  - 'too-short' : < 2 trackPoints, session was discarded (no path to draw)
   *  - null        : initial state, or after the consuming screen has shown the notice and cleared it
   *  Screens watch this to surface a friendly explanation when a stop produces no Activities-list entry. */
  lastStopReason: 'saved' | 'saved_pending' | 'too-short' | 'save_lost' | null;

  /**
   * R114/O22 STORY-73012 (K2): when the active hike session detects that
   * Simulator speed exceeds the hiking upper bound (15 km/h ≈ 4.17 m/s), we drop
   * the point from the clean track AND set this flag so HikingScreen can
   * render a banner ("You're moving too fast to be hiking — this segment
   * won't count"). Auto-clears after a real hiking-speed fix comes in.
   */
  overSpeedActive: boolean;

  /**
   * R114/O22 STORY-73017 (K9): save-in-progress state. When the user taps
   * Save on a long hike may briefly wait for an immediate server ACK. UI subscribes
   * to this to render a determinate progress hint ("Uploading points…",
   * "Building memory…", "Finalising…") instead of a spinner-with-no-info.
   * null = not saving; string = current sub-step description.
   */
  savingHikeStep: string | null;

  /**
   * O18 SAF-01: when both saveHikeAtomic AND its pendingSyncStore fallback
   * fail (e.g. AsyncStorage disk full), we set this flag so the UI can
   * surface a hard error with a Retry button instead of silently losing
   * the hike. Cleared by clearLastStopReason() (same lifecycle).
   */
  saveLostSessionId: string | null;
  // Sprint 6 round-5 review R5B2: also stash the payload + remoteId +
  // idempotencyKey + activityMode when SAF-01 fires. Retry needs these
  // to re-attempt savePending — the pendingSyncStore is empty (that's
  // the whole reason SAF-01 fired in the first place). Reset on
  // clearLastStopReason.
  saveLostPayload: {
    localId: string;
    remoteId: number | null;
    idempotencyKey: string;
    activityMode: 'hiking' | 'running';
    payload: any;
    // Sprint 6 round-8 review R8B8: capture the userId at Save time
    // (not Retry time) so a Retry after a user switch does not upload
    // to the wrong account. syncDaemon R7B5 gate reads this.
    userId: string;
  } | null;

  // Actions
  setActivityMode: (mode: ActivityMode) => void;
  /** Refresh the actual native background permission without prompting. */
  refreshBackgroundLocationPermission: () => Promise<void>;
  startTracking: () => Promise<boolean>;
  // Optional sessionName: when supplied (from the post-stop summary sheet)
  // the saved session is tagged with this name; otherwise the session
  // gets a default name on the consumer side ("Hike — DD/MM/YYYY").
  stopTracking: (sessionName?: string) => Promise<boolean>;
  pauseTracking: () => Promise<void>;
  resumeTracking: () => Promise<boolean>;
  addTrackPoint: (coord: ActivityCoordinate, timestamp?: number) => Promise<ActivityLocationAcceptance>;
  linkMarker: (markerId: string) => void;
  // O1 batch 37: reset removed — 0 external callers confirmed by grep audit.
  /** Clear lastStopReason after the screen has surfaced its notice. */
  clearLastStopReason: () => void;
  // Sprint 6 round-14 R14B9: on cold-boot, HikingScreen calls this to
  // restore saveLostSessionId + saveLostPayload from AsyncStorage so
  // the SAF-01 Alert re-fires after a force-quit / crash.
  hydrateSaf01: () => Promise<void>;
  /** Revoke in-memory/native ownership on logout without discarding the
   * owner-scoped unfinished Activity or its journal. */
  suspendForUserSwitch: () => Promise<void>;
  /** v118: discard the current too-short session entirely. Called when
   *  the user taps "End anyway" in the TooShortSheet — does the full
   *  cleanup (delete server row, stop subscriptions/intervals, reset
   *  store) that stopTracking normally would. */
  discardCurrentSession: () => Promise<void>;
  /** Internal QA-only known-continuity break; Resume owns the new segment. */
  simulateRecordingInterruption: () => Promise<boolean>;
  /** Internal QA-only explicit Lost reacquisition; starts a zero-distance segment. */
  reacquireSimulatorAt: (
    coordinate: Coordinate,
    nextSignal?: Exclude<import('../features/activitySimulator/types').SimulatorSignal, 'lost'>,
  ) => Promise<boolean>;
  /** Internal QA-only correction of accepted Simulator Activity evidence. */
  rollbackSimulatorTail: (distanceM: number) => Promise<{
    ok: boolean;
    actualDistanceM: number;
    removedPointCount: number;
    reason?: string;
  }>;
}

const initialState = {
  status: 'idle' as TrackingStatus,
  isFinishing: false,
  startError: null as TrackingStartError | null,
  sessionId: null,
  ownerUserId: null as string | null,
  liveOwnerGeneration: null as string | null,
  liveOwnerAcceptAfterMs: null as number | null,
  currentSegmentId: null as string | null,
  pendingSegmentStartReason: null as SegmentStartReason | null,
  remoteSessionId: null as number | null,
  activityMode: 'hiking' as ActivityMode,
  locationProviderSource: 'real' as ActivityLocationSource,
  startedAt: null,
  durationS: 0,
  activeDurationAccumulatedMs: 0,
  activeDurationStartedAtMs: null,
  distanceM: 0,
  elevationGainM: 0,
  trackPoints: [],
  trackPointsSmoothed: [],
  trackPointsRaw: [],
  markerIds: [],
  pausePins: [] as Coordinate[],
  locationAvailable: false,
  backgroundLocationPermission: 'unknown' as BackgroundLocationPermissionState,
  lastCoordinate: null,
  lastCoordinateTime: null,
  lastFixTimestamp: null,
  lastStopReason: null as 'saved' | 'saved_pending' | 'too-short' | 'save_lost' | null,
  // R114/O22 STORY-73012 (K2): default false. Set true when active hike
  // ingests a fix with GPS speed > HIKING_OVERSPEED_MPS (~15 km/h). Cleared
  // when a real hiking-speed fix is accepted, or on stopTracking.
  overSpeedActive: false,
  // R114/O22 STORY-73017 (K9): default null (not saving).
  savingHikeStep: null as string | null,
  saveLostSessionId: null as string | null,
  saveLostPayload: null as null | {
    localId: string;
    remoteId: number | null;
    idempotencyKey: string;
    activityMode: 'hiking' | 'running';
    payload: any;
    userId: string;
  },
};

export const useTrackingStore = create<TrackingState>((set, get) => ({
  ...initialState,

  setActivityMode: (mode) => set({ activityMode: mode }),

  refreshBackgroundLocationPermission: async () => {
    if (Platform.OS === 'web') {
      set({ backgroundLocationPermission: 'not-applicable' });
      return;
    }
    if (get().locationProviderSource === 'simulator') {
      set({ backgroundLocationPermission: 'not-applicable' });
      return;
    }
    await refreshRealBackgroundAuthorization(false);
  },

  startTracking: async () => {
    const beforeStart = get();
    // Store-boundary idempotency: the synchronous requesting transition is
    // the lock. A second tap/caller cannot initialize another writer,
    // location subscription, timer set, or remote session.
    if (beforeStart.status !== 'idle' || beforeStart.isFinishing) return false;

    const startWallClockTimestamp = Date.now();
    const mode = beforeStart.activityMode;
    const userId = String(useAppStore.getState().user?.id ?? '');
    if (!userId) {
      set({ ...initialState, activityMode: mode, startError: 'initialization-failed' });
      return false;
    }
    const locationProviderSource = selectedActivityLocationSource();
    // Every real Activity owns a dedicated forensic session. Previously the
    // logger only existed when the Simulator panel had started one, which is
    // why the O42 failure retained just nine useful events.
    realActivityQaSessionId = locationProviderSource === 'real'
      ? beginQaTelemetrySession(userId, true)
      : null;
    appendSimulatorLog('PROVIDER', 'activity_provider_selected', {
      requestedSource: locationProviderSource,
      startConfigured: useActivitySimulatorStore.getState().startConfigured,
      activityMode: mode,
    }, { userId, coordinateSource: 'none' });
    if (locationProviderSource === 'simulator' && !await prepareSimulatorProvider(userId)) {
      appendSimulatorLog('ACTIVITY_STATE', 'activity_start_rejected', {
        rejectionReason: 'simulator-start-not-configured',
        requestedSource: locationProviderSource,
      }, { userId, coordinateSource: 'none' });
      set({ ...initialState, activityMode: mode, startError: 'location-unavailable' });
      return false;
    }
    const startedAt = locationProviderSource === 'simulator'
      ? simulatorActivityStartTimestamp(
          useActivitySimulatorStore.getState().timeScale,
          startWallClockTimestamp,
        )
      : startWallClockTimestamp;
    const localSessionId = uuidv4();
    const ownerGeneration = uuidv4();
    const initialSegmentId = newSegmentId(localSessionId, startedAt);
    resetRealGpsDiagnosticState(locationProviderSource === 'real' ? localSessionId : null);
    set({
      status: 'requesting',
      isFinishing: false,
      startError: null,
      sessionId: localSessionId,
      ownerUserId: userId,
      liveOwnerGeneration: ownerGeneration,
      liveOwnerAcceptAfterMs: startedAt,
      currentSegmentId: initialSegmentId,
      pendingSegmentStartReason: 'start',
      remoteSessionId: null,
      locationProviderSource,
      startedAt,
      lastCoordinate: null,
      lastCoordinateTime: null,
      lastFixTimestamp: null,
      trackPoints: [],
      trackPointsSmoothed: [],
      trackPointsRaw: [],
      distanceM: 0,
      durationS: 0,
      activeDurationAccumulatedMs: 0,
      activeDurationStartedAtMs: null,
      elevationGainM: 0,
    });
    appendSimulatorLog('ACTIVITY_STATE', 'activity_start_requested', {
      activityMode: mode,
      providerSource: locationProviderSource,
      ownerGenerationSuffix: ownerGeneration.slice(-8),
    }, { userId, clientActivityId: localSessionId, coordinateSource: 'none' });

    // Reset module-level state from any previous session
    lastSamplingIntervalMs = 3000;
    lastFlushedIdx = 0;
    finishIngestCutoffMs = null;
    kalmanLat = null;
    kalmanLng = null;

    // Foreground location is the required native dependency for a genuine
    // recording. Prove it before creating server/writer/monitor resources;
    // failure returns to a retryable state rather than presenting TRACKING
    // with no recording source.
    const loc = locationProviderSource === 'real' ? await getLocation() : null;
    if (locationProviderSource === 'real') {
      if (!loc) {
        set({ ...initialState, activityMode: mode, startError: 'location-unavailable' });
        return false;
      }
      try {
        const fg = await loc.requestForegroundPermissionsAsync();
        if (fg.status !== 'granted') {
          set({ ...initialState, activityMode: mode, startError: 'permission-denied' });
          return false;
        }
      } catch (err) {
        debugLogger.logError(err, 'startTracking:foreground-permission');
        set({ ...initialState, activityMode: mode, startError: 'location-unavailable' });
        return false;
      }
    }

    try {
      const existing = await getUnfinishedActivity(userId);
      if (existing && existing.clientActivityId !== localSessionId) {
        set({ ...initialState, activityMode: mode, startError: 'unfinished-exists' });
        return false;
      }
      await registerUnfinishedActivity({
        clientActivityId: localSessionId,
        serverActivityId: null,
        userId,
        activityMode: mode,
        startedAt,
        lastMeaningfulAt: startedAt,
        activeDurationMs: 0,
        activeSinceMs: null,
        liveOwnerGeneration: ownerGeneration,
        currentSegmentId: initialSegmentId,
        nextSegmentStartReason: 'start',
        locationProviderSource,
        lifecycle: 'unfinished',
      });
    } catch {
      set({ ...initialState, activityMode: mode, startError: 'unfinished-exists' });
      return false;
    }

    // Reserve the authoritative server singleton while online before any live
    // GPS source is acquired. A five-second timeout remains offline-first: a
    // lost response is safe because this exact business ID reconciles later.
    const startResolution = await startSessionResolved(
      mode,
      new Date(startedAt).toISOString(),
      localSessionId,
    );
    if (startResolution.kind === 'started') {
      set({ remoteSessionId: startResolution.serverActivityId });
      await mapActivityServerId(userId, localSessionId, startResolution.serverActivityId);
      crashLogger.breadcrumb(`session:start:server-id=${startResolution.serverActivityId}`);
    } else if (startResolution.kind === 'conflict') {
      const existing = startResolution.existing;
      if (existing) {
        const existingStartedAt = Date.parse(existing.startedAt);
        const existingOwnerGeneration = uuidv4();
        const existingSegmentId = newSegmentId(existing.clientActivityId, Date.now());
        const authoritativeRecovery = {
          clientActivityId: existing.clientActivityId,
          serverActivityId: existing.id,
          userId,
          activityMode: existing.type,
          startedAt: Number.isFinite(existingStartedAt) ? existingStartedAt : Date.now(),
          lastMeaningfulAt: Date.now(),
          activeDurationMs: 0,
          activeSinceMs: null,
          liveOwnerGeneration: existingOwnerGeneration,
          currentSegmentId: existingSegmentId,
          nextSegmentStartReason: 'process-recovery' as const,
          locationProviderSource: 'real' as const,
          lifecycle: 'unfinished' as const,
        };
        // Replace the speculative local reservation first. Journal hydration is
        // best-effort, but a fetch/filesystem failure must never leave a fake
        // second unfinished identity masking the authoritative server one.
        await replaceUnfinishedActivity(userId, localSessionId, authoritativeRecovery);
        try {
          // Materialize a recoverable local anchor for the authoritative
          // Activity. If server detail is available, preserve its real points;
          // otherwise the zero-point recovery remains discardable, not live.
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const { startHikeTrack, appendHikePoint } = require('../services/hikeTrackWriter');
          await startHikeTrack(existing.clientActivityId, {
            started_at: Number.isFinite(existingStartedAt) ? existingStartedAt : Date.now(),
            activity_mode: existing.type,
            user_id: userId,
            owner_generation: existingOwnerGeneration,
            remote_id: existing.id,
          });
          const detail = await fetchSessionDetail(existing.id);
          const remotePoints = Array.isArray(detail?.route_points) ? detail.route_points : [];
          for (const point of remotePoints) {
            const pointTime = typeof point.t === 'number'
              ? point.t
              : (typeof point.timestamp === 'string' ? Date.parse(point.timestamp) : NaN);
            if (!Number.isFinite(pointTime)) continue;
            await appendHikePoint({
              t: pointTime,
              lat: point.lat,
              lng: point.lng,
              alt: point.alt ?? null,
              acc: point.acc ?? null,
              src: 'slc',
              conf: 1,
              clientActivityId: existing.clientActivityId,
              ownerGeneration: existingOwnerGeneration,
              segmentId: point.segment_id ?? existingSegmentId,
              segmentStartReason: point.segment_start_reason ?? 'process-recovery',
            });
          }
        } catch (conflictMaterializeError) {
          crashLogger.breadcrumb(`session:start:conflict_materialize_failed ${String(conflictMaterializeError).slice(0, 80)}`);
        }
      }
      set({ ...initialState, activityMode: mode, startError: 'unfinished-exists' });
      return false;
    } else {
      crashLogger.breadcrumb('session:start:server-unavailable');
    }

    // Start debug logger session (no-op if disabled)
    const dbgSessionId = debugLogger.startSession({ activity_mode: get().activityMode });
    sessionRecorder.start();

    // v409 fix #2: 语义换了 —— hikeActive=true 表示 "hike 在跑",不依赖
    // debug mode。这样 iOS jetsam 后 Path B 无条件写盘,修复 194 session
    // 后 56 分钟数据丢失的根因。
    const contextPersisted = locationProviderSource === 'simulator'
      ? await persistBackgroundContext(null, false)
      : await persistBackgroundContext(get().sessionId, true, {
          clientActivityId: localSessionId,
          userId,
          ownerGeneration,
          segmentId: initialSegmentId,
          activityMode: mode,
          acceptAfterMs: startedAt,
          qaSessionId: realActivityQaSessionId,
          continuityState: realGpsContinuityState,
          rawOrdinal: realGpsRawOrdinal,
        });
    if (!contextPersisted) {
      await tombstoneActivity({ userId, clientActivityId: localSessionId });
      void deleteRemoteSessionByClientId(localSessionId);
      set({ ...initialState, activityMode: mode, startError: 'initialization-failed' });
      return false;
    }

    // v409 fix #2: 启动独立 hike-track 磁盘落盘服务。每次 addTrackPoint
    // 会写一行 JSONL,stopTracking 时 rename 到 completed/。
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { startHikeTrack } = require('../services/hikeTrackWriter');
      const sid = get().sessionId;
      if (sid) {
        // v430 fix: await instead of fire-and-forget. If user opens hike then
        // immediately kills app, we need the disk meta file to be present so
        // listActiveHikes() next launch finds it and shows UnfinishedRecoveryModal.
        // Previous void-call could race: kill happens before write completes,
        // leaving server-side dangling row with no client-side detection path.
        await startHikeTrack(sid, {
          started_at: get().startedAt,
          activity_mode: get().activityMode,
          user_id: userId,
          owner_generation: ownerGeneration,
          location_source: locationProviderSource,
        });
      }
    } catch (e) {
      crashLogger.breadcrumb(`v409:hikeTrackWriter:startHikeTrack failed ${String(e).slice(0, 80)}`);
      await tombstoneActivity({ userId, clientActivityId: localSessionId });
      await persistBackgroundContext(null, false);
      void deleteRemoteSessionByClientId(localSessionId);
      set({ ...initialState, activityMode: mode, startError: 'initialization-failed' });
      return false;
    }

    // Start battery + network monitors (non-blocking)
    batteryMonitor.start().catch(() => {});
    networkMonitor.start().catch(() => {});

    // Defensive: clear any stale intervals before starting new ones.
    // Prevents leaks if startTracking is called twice without stopTracking
    // (crash recovery, double-tap, etc.) which would otherwise leave
    // multiple drain loops + multiple sampling timers running, defeating
    // the single-source guarantee.
    if (drainInterval) {
      clearInterval(drainInterval);
      drainInterval = null;
    }
    if (dynamicSamplingInterval) {
      clearInterval(dynamicSamplingInterval);
      dynamicSamplingInterval = null;
    }
    if (incrementalFlushInterval) {
      clearInterval(incrementalFlushInterval);
      incrementalFlushInterval = null;
    }
    if (appStateSubscription) {
      try { appStateSubscription.remove(); } catch { /* no-op */ }
      appStateSubscription = null;
    }
    stopActivityLifecycleTimer();

    try {
      // Native permission education belongs only to the real provider. The
      // simulator is an internal source and must never provoke an OS prompt.
      if (locationProviderSource === 'real') {
      // Refresh the native value on every Activity Start. A module-level cache
      // is only a mirror, never permission authority. The OS request remains a
      // one-time foreground action; AppState transitions below are read-only.
      let hasSeenBackgroundEducation = false;
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const SecureStore = require('expo-secure-store');
        hasSeenBackgroundEducation = (
          await SecureStore.getItemAsync('cairn_has_seen_always_allow_education')
        ) === '1';
      } catch { /* secure storage is advisory; native permission remains authority */ }
      await refreshRealBackgroundAuthorization(!hasSeenBackgroundEducation);

      // v412 §3 iOS Always Allow 位置权限教育弹窗 (一次性):
      // 用户第一次授权时若选了 "While Using the App" (不给 background),
      // 弹一次教育对话框引导升级到 "Always Allow"。已弹过 (SecureStore flag)
      // 就不再弹。用户后续 hike 结束路径断了会知道原因。
      if (!backgroundGrantedCached) {
        try {
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const SecureStore = require('expo-secure-store');
          const KEY = 'cairn_has_seen_always_allow_education';
          if (!hasSeenBackgroundEducation) {
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const { Alert, Linking } = require('react-native');
            await new Promise<void>((resolve) => {
              Alert.alert(
                'Keep recording when screen is off?',
                'Cairn keeps recording your hike when your screen is off or you switch apps. Set Location permission to "Always Allow" in Settings.',
                [
                  {
                    text: 'Later',
                    style: 'cancel',
                    onPress: async () => {
                      try { await SecureStore.setItemAsync(KEY, '1'); } catch { /* silent */ }
                      resolve();
                    },
                  },
                  {
                    text: 'Open Settings',
                    onPress: async () => {
                      try { await SecureStore.setItemAsync(KEY, '1'); } catch { /* silent */ }
                      try { Linking.openSettings(); } catch { /* silent */ }
                      resolve();
                    },
                  },
                ],
                { cancelable: false }
              );
            });
          }
        } catch { /* silent — 教育弹窗失败不影响主流程 */ }
      }

      // Pre-register the background task so we can quickly start/stop it
      // when AppState changes — but DON'T start it yet; foreground watcher
      // is the active source while app is in foreground.
      if (backgroundGrantedCached) {
        const registered = await registerBackgroundTask();
        if (!registered) backgroundGrantedCached = false;
      }
      } else {
        backgroundGrantedCached = false;
        set({ backgroundLocationPermission: 'not-applicable' });
      }

      // Activate whichever source matches CURRENT app state FIRST, before
      // wiring up the AppState listener. This avoids a race where the
      // listener fires mid-await of the initial activation and both paths
      // run concurrently.
      const startState = AppState.currentState;
      if (startState === 'background' || startState === 'inactive') {
        if (locationProviderSource === 'real' && !backgroundGrantedCached) {
          throw new Error('background-location-unavailable-at-start');
        }
        await activateBackgroundSource();
        if (!isCurrentLocationSourceActive()) throw new Error('background-location-source-failed');
      } else {
        // 'active' or 'unknown' → foreground watcher
        await activateForegroundSource();
        if (!isCurrentLocationSourceActive()) throw new Error('foreground-location-source-failed');
      }

      if (locationProviderSource === 'simulator') {
        appendSimulatorLog('PROVIDER', 'simulator_provider_locked', {
          providerSource: 'simulator',
          realForegroundActive: Boolean(locationSubscription),
          realBackgroundActive: backgroundTaskActive,
          firstAcceptedPointPending: get().trackPoints.length === 0,
          segmentId: initialSegmentId,
          ownerGenerationSuffix: ownerGeneration.slice(-8),
        }, {
          userId,
          clientActivityId: localSessionId,
          coordinateSource: 'none',
        });
      }

      // TRACKING is entered only after a real recording source is active.
      const lifecycleStartedAt = activityTimestampForSource(
        locationProviderSource,
        Date.now(),
        startedAt,
      );
      set({
        status: 'tracking',
        locationAvailable: true,
        startError: null,
        activeDurationAccumulatedMs: 0,
        activeDurationStartedAtMs: lifecycleStartedAt,
      });
      await updateUnfinishedActivity(userId, localSessionId, {
        activeDurationMs: 0,
        activeSinceMs: lifecycleStartedAt,
      });
      startActivityLifecycleTimer(localSessionId);
      appendSimulatorLog('ACTIVITY_STATE', 'activity_tracking_started', {
        activityMode: mode,
        providerSource: locationProviderSource,
        currentSegmentId: initialSegmentId,
      }, { userId, clientActivityId: localSessionId, coordinateSource: 'none' });
      startRealTelemetryHealthTimer();

      // Subscribe AppState ONCE to flip sources foreground ↔ background.
      // Single-source guarantee eliminates the duplicate-fix logging bug.
      // Each handler awaits via the activation queue to prevent TOCTOU races
      // between hasStartedLocationUpdatesAsync and startLocationUpdatesAsync.
      //
      // v78 #7/#8: 2s debounce on `active` direction. Real-world metro
      // hike showed 18 app_state_changes in 23 minutes (clustered every
      // 30s) — likely brief screen unlock cycles. The `active` handler
      // is idempotent but still kicks off a foreground source restart
      // each time, which causes brief GPS gaps and battery churn. We
      // debounce only the `active` direction; `background`/`inactive`
      // always fire immediately so we never miss the off-screen pause.
      let activeDebounceTimer: ReturnType<typeof setTimeout> | null = null;
      appStateSubscription = AppState.addEventListener('change', (nextState: AppStateStatus) => {
        if (get().status !== 'tracking') return;
        const lifecycleOwner = get();
        appendSimulatorLog(
          'APP',
          nextState === 'active' ? 'app_foregrounded' : 'app_backgrounded',
          {
            appState: nextState,
            backgroundPermissionState: lifecycleOwner.backgroundLocationPermission,
            cachedBackgroundGranted: backgroundGrantedCached,
            foregroundWatcherActive: Boolean(locationSubscription),
            backgroundTaskActive,
            latestAcceptedAgeMs: lifecycleOwner.lastCoordinateTime === null
              ? null
              : Math.max(0, Date.now() - lifecycleOwner.lastCoordinateTime),
            ownerGenerationSuffix: lifecycleOwner.liveOwnerGeneration?.slice(-8) ?? null,
          },
          {
            userId: lifecycleOwner.ownerUserId,
            clientActivityId: lifecycleOwner.sessionId,
            qaSessionId: realActivityQaSessionId,
            coordinateSource: lifecycleOwner.locationProviderSource === 'real' ? 'real' : 'simulator',
          },
        );
        if (nextState !== 'active' && lifecycleOwner.locationProviderSource === 'real') {
          void flushSimulatorLogs(lifecycleOwner.ownerUserId ?? undefined);
        }
        crashLogger.breadcrumb(`appstate:${nextState}`);
        // Sprint 72 STORY-00553: immediate sampling re-eval on AppState change
        // (don't wait for the 10s dynamicSamplingInterval tick).
        try {
          const speed = get().lastCoordinate ? estimateSpeed(get().trackPoints) : 0;
          const movement = classifyMovement(speed);
          const bl = batteryMonitor.getCurrentLevel();
          const desired = getSamplingInterval(
            movement,
            bl !== null && bl < 0.2,
            {
              appState: nextState as 'active' | 'background' | 'inactive' | 'unknown',
              batteryLevel: bl ?? undefined,
              isCharging: batteryMonitor.getIsCharging(),
            }
          );
          if (Math.abs(desired - lastSamplingIntervalMs) >= 500) {
            const from = lastSamplingIntervalMs;
            lastSamplingIntervalMs = desired;
            const downgraded = desired > from;
            crashLogger.breadcrumb(
              `sampling:${downgraded ? 'downgrade' : 'restore'} from_ms=${from} to_ms=${desired} reason=appstate_change:${nextState}`
            );
          }
        } catch { /* swallow */ }
        // Sprint 72 STORY-00554: also switch flush interval based on AppState.
        try {
          const restart = (globalThis as unknown as { __cairnRestartFlush?: (ms: number) => void }).__cairnRestartFlush;
          if (restart) {
            const inBg = nextState === 'background' || nextState === 'inactive';
            const newMs = inBg ? 300_000 : 120_000;
            restart(newMs);
            crashLogger.breadcrumb(`timer:flush_interval_adjust to_ms=${newMs} reason=${inBg ? 'background' : 'foreground'}`);
          }
        } catch { /* swallow */ }
        if (nextState === 'active') {
          // If we already have a pending active-flip, leave it. If we
          // were going to background within the debounce window, reset.
          if (activeDebounceTimer) clearTimeout(activeDebounceTimer);
          activeDebounceTimer = setTimeout(() => {
            activeDebounceTimer = null;
            // Re-check current state at the moment the timer fires —
            // if user flipped back to background, do nothing.
            if (AppState.currentState !== 'active') return;
            enqueueActivation(async () => {
              if (get().locationProviderSource === 'real') {
                await transitionToForegroundSource();
              } else {
                await activateForegroundSource();
                deactivateBackgroundSource();
              }
            });
          }, 2000);
          // R114/O22 STORY-73015 (K7): after screen wake, if GPS has
          // been silent >60s (signal was lost or watcher stalled during
          // sleep), kick a one-shot getCurrentPositionAsync to force
          // re-acquisition. Without this, the watcher can appear active
          // but never deliver a fresh fix, and the user sees a "frozen"
          // dot until they interact.
          try {
            const lastT = get().lastCoordinateTime;
            const stale = lastT === null || Date.now() - lastT > 60_000;
            if (stale && get().locationProviderSource === 'real') {
              const wakeOwnerSessionId = get().sessionId;
              const wakeOwnerGeneration = get().liveOwnerGeneration;
              const wakeSegmentId = get().currentSegmentId;
              if (!wakeOwnerSessionId || !wakeOwnerGeneration) return;
              crashLogger.breadcrumb(`k7:wake_stale_gps last_ms_ago=${lastT === null ? 'null' : Date.now() - lastT}`);
              (async () => {
                try {
                  const Loc = await getLocation();
                  if (!Loc) return;
                  const fix = await Loc.getCurrentPositionAsync({ accuracy: Loc.Accuracy.Balanced });
                  crashLogger.breadcrumb('k7:wake_kick_ok');
                  appendSimulatorLog('LOCATION', 'real_activity_location_callback', {
                    sampleSource: 'foreground-wake-current',
                    sequenceTimestamp: Math.floor(fix.timestamp),
                    callbackWallTimestamp: Date.now(),
                    accuracyM: fix.coords.accuracy ?? null,
                    verticalAccuracyM: fix.coords.altitudeAccuracy ?? null,
                    speedMps: fix.coords.speed ?? null,
                    courseValid: fix.coords.heading != null && fix.coords.heading >= 0,
                    appState: AppState.currentState,
                  }, {
                    userId,
                    clientActivityId: wakeOwnerSessionId,
                    coordinateSource: 'real',
                  });
                  // Feed the fresh fix through the same path a watcher
                  // update would take — this updates lastCoordinate, the
                  // clean track, distance accumulation, etc.
                  get().addTrackPoint(
                    {
                      lat: fix.coords.latitude,
                      lng: fix.coords.longitude,
                      alt: fix.coords.altitude,
                      accuracy: fix.coords.accuracy ?? null,
                      speed: fix.coords.speed ?? null,
                      verticalAccuracy: fix.coords.altitudeAccuracy ?? null,
                      course: fix.coords.heading ?? null,
                      clientActivityId: wakeOwnerSessionId,
                      ownerGeneration: wakeOwnerGeneration,
                      segmentId: wakeSegmentId ?? undefined,
                      source: 'foreground',
                    },
                    fix.timestamp,
                  );
                } catch (err) {
                  crashLogger.breadcrumb(`k7:wake_kick_err ${String(err).slice(0, 60)}`);
                }
              })();
            }
          } catch { /* silent — non-fatal */ }
        } else if (nextState === 'background' || nextState === 'inactive') {
          // R114/O22 STORY-73003 (K10) breadcrumb: entry to bg branch.
          crashLogger.breadcrumb(`k10:appstate_bg_branch state=${nextState}`);
          // Cancel any pending active-flip timer — user dropped back
          // to background within the debounce window.
          if (activeDebounceTimer) {
            clearTimeout(activeDebounceTimer);
            activeDebounceTimer = null;
          }
          enqueueActivation(async () => {
            deactivateForegroundSource();
            const active = await activateBackgroundSource();
            if (!active) await markRecordingContinuityUnavailable('background-provider-unavailable');
          });
        }
      });

      // Re-check AppState AFTER listener registered: if state changed during
      // the brief window between initial activation and addEventListener,
      // the listener missed it — correct course now.
      const postListenerState = AppState.currentState;
      if (postListenerState !== startState) {
        if (postListenerState === 'background' || postListenerState === 'inactive') {
          enqueueActivation(async () => {
            deactivateForegroundSource();
            const active = await activateBackgroundSource();
            if (!active) await markRecordingContinuityUnavailable('background-provider-unavailable');
          });
        } else {
          enqueueActivation(async () => {
            if (get().locationProviderSource === 'real') {
              await transitionToForegroundSource();
            } else {
              await activateForegroundSource();
              deactivateBackgroundSource();
            }
          });
        }
      }

      // ── Background drain loop (poll task queue every 1s) ──
      // Drains buffered fixes from the background task into the store.
      // The drain only runs while background source is active; status check
      // protects against firing during foreground-only windows.
      drainInterval = setInterval(() => {
        if (get().status !== 'tracking') return;
        // A TaskManager callback can finish just after the foreground switch
        // stops the background source. Its points are already journaled and
        // owner-fenced; drain that historical tail even while the foreground
        // watcher is now active instead of stranding it until another lock.
        const drained = drainBackgroundLocations().sort((a, b) => a.timestamp - b.timestamp);
        for (const c of drained) {
          get().addTrackPoint(
            {
              lat: c.latitude,
              lng: c.longitude,
              alt: c.altitude,
              accuracy: c.accuracy ?? null,
              speed: c.speed ?? null,
              verticalAccuracy: c.altitudeAccuracy ?? null,
              course: c.heading ?? null,
              clientActivityId: c.clientActivityId,
              ownerGeneration: c.ownerGeneration,
              segmentId: c.segmentId,
              segmentStartReason: c.segmentStartReason,
              rawOrdinal: c.rawOrdinal,
              continuityPreclassified: c.continuityPreclassified,
              canonicalDecision: c.canonicalDecision,
              decisionReason: c.decisionReason,
              continuityStateAfter: c.continuityStateAfter,
              source: 'background',
            },
            c.timestamp,
          );
        }
      }, 1000);

      // ── Dynamic sampling — restart background+foreground if interval should change ──
      // v78 #4/#6: tighten reaction window from 60s to 10s. User starts
      // running mid-hike → mode/UI should reflect it within ~30s of pace
      // change instead of waiting up to a minute.
      dynamicSamplingInterval = setInterval(async () => {
        if (get().status !== 'tracking') return;
        if (get().locationProviderSource === 'simulator') return;
        const lastCoord = get().lastCoordinate;
        const speed = lastCoord ? estimateSpeed(get().trackPoints) : 0;
        const movement = classifyMovement(speed);
        const batteryLevel = batteryMonitor.getCurrentLevel();
        const batteryLow = batteryLevel !== null && batteryLevel < 0.2;
        // Sprint 72 STORY-00553: pass AppState + battery ctx so background
        // + low-battery + not-charging combos downgrade sampling. Foreground
        // or charging or ≥50% battery still uses tight rates.
        const currentAppState = AppState.currentState as 'active' | 'background' | 'inactive' | 'unknown';
        const isCharging = batteryMonitor.getIsCharging();
        const desiredMs = getSamplingInterval(movement, batteryLow, {
          appState: currentAppState,
          batteryLevel: batteryLevel ?? undefined,
          isCharging,
        });

        // Emit a diagnostic breadcrumb on every eval so log-based inspection
        // can prove which branch fired even without adjusting the interval.
        crashLogger.breadcrumb(
          `sampling:eval movement=${movement} app_state=${currentAppState} battery=${batteryLevel ?? 'na'} charging=${isCharging} interval_ms=${desiredMs}`
        );

        if (Math.abs(desiredMs - lastSamplingIntervalMs) >= 500) {
          const from = lastSamplingIntervalMs;
          lastSamplingIntervalMs = desiredMs;
          const downgraded = desiredMs > from;
          crashLogger.breadcrumb(
            `sampling:${downgraded ? 'downgrade' : 'restore'} from_ms=${from} to_ms=${desiredMs} reason=${
              downgraded ? 'background_low_battery' : 'foreground_or_charging'
            }`
          );

          // Restart whichever source is currently active with the new interval.
          // Goes through the activation queue to avoid racing with AppState
          // listener-driven flips.
          if (currentAppState === 'background' || currentAppState === 'inactive') {
            if (backgroundTaskActive) {
              enqueueActivation(async () => { await activateBackgroundSource(); });
            }
          } else {
            // 'active' or 'unknown'
            enqueueActivation(activateForegroundSource);
          }
        }
      }, 10_000);

      // ── Incremental backup — every 120s, PATCH new points to the
      // server so a force-quit / OS-kill mid-session doesn't lose the
      // entire run. Silent on failure — buffer stays in-memory and
      // next interval re-tries the unflushed range.
      // v78: bumped 60s → 120s. Halves background network frequency and
      // saves modest battery. Trade-off: at most 2 minutes of points
      // lost on a force-kill instead of 1 minute. Acceptable: real
      // session crashes are rare and a 1-min vs 2-min loss is minor.
      // Sprint 72 STORY-00554: further stretch to 300s when app is in
      // background. Cuts background network wakeups roughly in half again.
      // Foreground stays at 120s so users see near-live sync when watching.
      const FLUSH_FG_MS = 120_000;
      const FLUSH_BG_MS = 300_000;
      const startFlushInterval = (ms: number) => {
        if (incrementalFlushInterval) clearInterval(incrementalFlushInterval);
        incrementalFlushInterval = setInterval(async () => {
          const state = get();
          if (state.status !== 'tracking') return;
          const remoteId = state.remoteSessionId;
          if (!remoteId) return;
          const ownerSessionId = state.sessionId;
          const ownerGeneration = state.liveOwnerGeneration;
          const total = state.trackPoints.length;
          if (total <= lastFlushedIdx) return;
          const slice = state.trackPoints.slice(lastFlushedIdx, total);
          const ok = await remoteAppendPoints(remoteId, slice.map(toServerPoint));
          const current = get();
          if (
            ok &&
            current.sessionId === ownerSessionId &&
            current.liveOwnerGeneration === ownerGeneration
          ) {
            lastFlushedIdx = total;
            crashLogger.breadcrumb(`session:flush count=${slice.length} idx=${total}`);
          } else {
            crashLogger.breadcrumb(`session:flush:failed count=${slice.length}`);
          }
        }, ms);
      };
      // Initial state — pick based on current AppState.
      const initialAs = AppState.currentState;
      startFlushInterval(initialAs === 'background' || initialAs === 'inactive' ? FLUSH_BG_MS : FLUSH_FG_MS);
      // Expose an internal restart hook the AppState listener can call.
      (globalThis as unknown as { __cairnRestartFlush?: (ms: number) => void }).__cairnRestartFlush = startFlushInterval;

      // Sprint 72 STORY-00552: auto-pause monitor
      try {
        const { startAutoPauseMonitor } = await import('../services/autoPauseMonitor');
        startAutoPauseMonitor({
          getStatus: () => get().status,
          getPoints: () => get().trackPoints.map(p => ({
            latitude: p.lat,
            longitude: p.lng,
            timestamp: p.t,
            speed: p.speed ?? undefined,
          })),
          onSilentEnd: () => {
            // Fire-and-forget: ends session with no user prompt.
            void get().stopTracking();
          },
        });
      } catch { /* swallow */ }

      // Sprint 72 STORY-00555: proactive hiking token refresh — every 30
      // minutes while actively tracking, silently POST /api/auth/refresh
      // so an 8-hour hike never crosses a token boundary. Failure NEVER
      // clears the token (iron rule); we just breadcrumb and keep hiking.
      try {
        const HIKING_REFRESH_MS = 30 * 60_000;
        tokenRefreshInterval = setInterval(async () => {
          if (get().status !== 'tracking' && get().status !== 'paused') return;
          crashLogger.breadcrumb('hiking_refresh:start');
          try {
            const { refreshToken } = await import('../services/authService');
            const result = await refreshToken();
            if (result.token) {
              crashLogger.breadcrumb('hiking_refresh:success');
            } else {
              crashLogger.breadcrumb(`hiking_refresh:fail reason=${result.error ?? 'unknown'} authInvalid=${!!result.authInvalid}`);
              // Iron rule: refresh failure does NOT logout the user mid-hike.
              // Even if authInvalid=true, we keep GPS running and let the
              // hydrate/AppState=active path handle re-login after tracking.
            }
          } catch (err) {
            crashLogger.breadcrumb(`hiking_refresh:fail reason=exception msg=${String(err).slice(0, 50)}`);
          }
        }, HIKING_REFRESH_MS);
      } catch { /* swallow */ }

      // Sprint 72 STORY-00556: check Low Power Mode once at tracking start
      try {
        const { checkAndWarnLowPowerMode } = await import('../services/lowPowerModeWarn');
        void checkAndWarnLowPowerMode();
      } catch { /* swallow */ }
      return true;
    } catch (err) {
      debugLogger.logError(err, 'startTracking');
      // Roll back every resource created during initialization. A failed
      // start must be retryable and must not leave timers, writers or
      // subscriptions masquerading as an active session.
      stopActivityLifecycleTimer();
      try { appStateSubscription?.remove(); } catch { /* no-op */ }
      appStateSubscription = null;
      try { locationSubscription?.remove(); } catch { /* no-op */ }
      locationSubscription = null;
      if (backgroundTaskActive && Location) {
        try { await Location.stopLocationUpdatesAsync(BACKGROUND_LOCATION_TASK); } catch { /* no-op */ }
      }
      backgroundTaskActive = false;
      if (drainInterval) { clearInterval(drainInterval); drainInterval = null; }
      if (dynamicSamplingInterval) { clearInterval(dynamicSamplingInterval); dynamicSamplingInterval = null; }
      if (incrementalFlushInterval) { clearInterval(incrementalFlushInterval); incrementalFlushInterval = null; }
      if (tokenRefreshInterval) { clearInterval(tokenRefreshInterval); tokenRefreshInterval = null; }
      stopRealTelemetryHealthTimer();
      networkMonitor.stop();
      sessionRecorder.stop();
      void batteryMonitor.stop().catch(() => {});
      void debugLogger.endSession().catch(() => {});
      await persistBackgroundContext(null, false).catch(() => {});
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { discardActiveHike } = require('../services/hikeTrackWriter');
        await discardActiveHike(localSessionId).catch(() => {});
      } catch { /* writer unavailable */ }
      const remoteId = get().sessionId === localSessionId ? get().remoteSessionId : null;
      await tombstoneActivity({ userId, clientActivityId: localSessionId, serverActivityId: remoteId });
      void deleteRemoteSessionByClientId(localSessionId)
        .then((cancelled) => {
          if (!cancelled && remoteId) return deleteRemoteSession(remoteId);
          return true;
        })
        .catch(() => {});
      if (locationProviderSource === 'simulator') {
        await endSimulatorProvider('start-failed').catch(() => {});
        simulatorSourceActive = false;
      }
      appendSimulatorLog('ERROR', 'activity_start_failed', {
        providerSource: locationProviderSource,
        rejectionReason: String(err instanceof Error ? err.message : err).slice(0, 160),
      }, { userId, clientActivityId: localSessionId, coordinateSource: 'none' });
      set({ ...initialState, activityMode: mode, startError: 'initialization-failed' });
      return false;
    }
  },

  stopTracking: async (sessionName?: string) => {
    const stopEntry = get();
    if (stopEntry.status === 'idle' || stopEntry.isFinishing) return false;
    const finishOwnerUserId = String(stopEntry.ownerUserId ?? '');
    if (!finishOwnerUserId || String(useAppStore.getState().user?.id ?? '') !== finishOwnerUserId) {
      return false;
    }
    const saveTimelineStartedAt = Date.now();
    const recordSavePhase = (phase: string, phaseStartedAt: number, details: Record<string, unknown> = {}) => {
      appendSimulatorLog('ACTIVITY_COMPLETION', 'activity_save_phase_timing', {
        phase,
        durationMs: Date.now() - phaseStartedAt,
        totalDurationMs: Date.now() - saveTimelineStartedAt,
        ...details,
      }, {
        userId: finishOwnerUserId,
        clientActivityId: stopEntry.sessionId,
        coordinateSource: 'none',
      });
    };
    // Synchronous shared-boundary lock: repeated UI taps, auto-pause and
    // another caller all converge on one stop/save pipeline.
    const frozenLifecycle = stopEntry.status === 'tracking'
      ? lifecycleDurationPatch(stopEntry)
      : null;
    finishIngestCutoffMs = Date.now();
    stopActivityLifecycleTimer();
    set({ ...(frozenLifecycle ?? {}), isFinishing: true });
    if (frozenLifecycle && stopEntry.sessionId) {
      // Finish is already an acceptance fence. Persist the frozen lifecycle
      // clock before any network/review await so a crash cannot resurrect it
      // as an indefinitely running Activity.
      await updateUnfinishedActivity(finishOwnerUserId, stopEntry.sessionId, {
        activeDurationMs: frozenLifecycle.activeDurationAccumulatedMs,
        activeSinceMs: null,
      }).catch(() => false);
    }
    appendSimulatorLog('ACTIVITY_STATE', 'activity_finish_requested', {
      providerSource: stopEntry.locationProviderSource,
      activityMode: stopEntry.activityMode,
    }, {
      userId: finishOwnerUserId,
      clientActivityId: stopEntry.sessionId,
      coordinateSource: 'none',
    });
    // Freeze every producer before doing eligibility, network, or review work.
    // The background context shares a serialization boundary with headless
    // append, so this await proves all commits before the fence are complete
    // and every later native callback will observe a disabled lease.
    try { appStateSubscription?.remove(); } catch { /* no-op */ }
    appStateSubscription = null;
    deactivateForegroundSource();
    if (stopEntry.locationProviderSource === 'real') {
      await stopRealBackgroundSourceForHandoff();
    } else {
      deactivateBackgroundSource();
    }
    if (stopEntry.locationProviderSource === 'simulator') {
      pauseSimulatorProvider();
      simulatorSourceActive = false;
    }
    const finishFenceDurable = await persistBackgroundContext(null, false);
    if (!finishFenceDurable) {
      finishIngestCutoffMs = null;
      set({
        status: 'paused',
        isFinishing: false,
        startError: 'initialization-failed',
        pendingSegmentStartReason: 'resume',
      });
      Alert.alert(
        'Could not finish safely',
        'CairnNZ could not disable background recording. Your Activity remains recoverable and has not been saved.',
      );
      return false;
    }
    if (stopEntry.locationProviderSource === 'real') {
      await drainCommittedBackgroundLocations(true);
    }
    // Include every foreground fix whose acceptance pipeline began before
    // Finish froze new ingestion. Each such fix reaches disk and store state
    // before the completion snapshot below is calculated.
    await pointIngestTail.catch(() => {});
    finishIngestCutoffMs = null;
    recordSavePhase('finish_reconciliation', saveTimelineStartedAt, {
      acceptedPointCount: get().trackPoints.length,
      rawPointCount: get().trackPointsRaw.length,
    });

    // v118 too-short pre-check (BEFORE any cleanup): if the session has
    // < 2 trackPoints, surface a "too short" sheet but DON'T tear down
    // location subscriptions / intervals. The user gets a friendly modal
    // with two options:
    //   - "Got it"     → dismisses the sheet; tracking continues from
    //                    where it was (subscriptions and intervals never
    //                    stopped, so this is seamless).
    //   - "End anyway" → the screen calls discardCurrentSession() which
    //                    does the full cleanup + reset.
    // Without this guard the user would lose their session as soon as
    // they tapped Stop, even if they only meant to check.
    {
      const pre = get();
      // v198 too-short check: refuse if trackPoints<2 OR distanceM<20.
      // Original v118 design only guarded trackPoints<2, but a hiker who
      // taps Start, sits in place for a few minutes, and taps Stop will
      // accumulate dozens of trackPoints from GPS jitter — passing the
      // length check while distanceM stays ~0. 20m is roughly 2x typical
      // GPS accuracy (5-10m), so it stably distinguishes "stationary
      // noise" from "actually walked".
      const tooShort = pre.status !== 'idle' && !saveEligibility(
        pre.trackPoints,
        pre.distanceM,
      ).eligible;
      // v449: emit structured log so we can diagnose too-short in
      // production without relying on crashLogger.breadcrumb (which
      // doesn't ship to aliyun debug_events_v2).
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { log } = require('../services/appLog');
        log('v449.stop.too_short_check', {
          tooShort,
          pts: pre.trackPoints.length,
          distanceM: Number(pre.distanceM.toFixed(2)),
          remoteSessionId: pre.remoteSessionId,
          locationProviderSource: pre.locationProviderSource,
          status: pre.status,
        });
      } catch { /* log module unavailable */ }
      if (tooShort) {
        crashLogger.breadcrumb(`session:stop:too-short pts=${pre.trackPoints.length} dist=${pre.distanceM.toFixed(1)}m — preserving session`);
        // The Activity remains unfinished until the user explicitly resumes,
        // saves, or discards it. Keep the idempotent remote shell mapping:
        // deleting it merely because the Save UI was opened would make a
        // continued Activity split across two server identities.
        set({ status: 'paused', lastStopReason: 'too-short', pendingSegmentStartReason: 'resume' });
        set({ isFinishing: false });
        return false;
      }
    }

    if (drainInterval) {
      clearInterval(drainInterval);
      drainInterval = null;
    }
    if (dynamicSamplingInterval) {
      clearInterval(dynamicSamplingInterval);
      dynamicSamplingInterval = null;
    }
    if (incrementalFlushInterval) {
      clearInterval(incrementalFlushInterval);
      incrementalFlushInterval = null;
    }

    // Sprint 72 STORY-00552: stop auto-pause monitor along with tracking.
    try {
      const { stopAutoPauseMonitor } = require('../services/autoPauseMonitor');
      stopAutoPauseMonitor();
    } catch { /* swallow */ }

    // Sprint 72 STORY-00555: stop hiking token refresh
    if (tokenRefreshInterval) {
      clearInterval(tokenRefreshInterval);
      tokenRefreshInterval = null;
    }
    stopRealTelemetryHealthTimer();

    // Stop monitors. We do this asynchronously but the order matters:
    // batteryMonitor's final session_end sample must be logged before
    // debugLogger.endSession flushes, otherwise it's lost.
    networkMonitor.stop();
    sessionRecorder.stop();
    // Chain battery stop → debugLogger end → upload
    batteryMonitor.stop()
      .catch(() => {})
      .finally(() => {
        debugLogger.endSession().then((endedId) => {
          if (endedId) {
            telemetryUploader.upload(endedId).catch(() => {});
          }
        }).catch(() => {});
      });

    const s = get();
    const finalStats = calculateActivityStats(s.trackPoints);
    const finalDurationS = Math.max(0, Math.floor(s.durationS));
    const ownerUserId = finishOwnerUserId;
    let cleanupAfterRename = false;
    let durableSaveCommitted = false;
    let serverSaveAcknowledged = false;
    let stopReason: 'saved' | 'saved_pending' | 'too-short' | null = null;
    if (s.sessionId && s.startedAt) {
      // O8 (2026-07-26): 顶层 try/catch 兜底 — 用户 12:11 真实 hike 里
      // stopTracking 在 too_short_check 和 addSession 之间某处 die 但没
      // 上到 aliyun (crashLogger.breadcrumb 不 ship)。这个块里有很多
      // 未 try/catch 的同步点 (uuidv4, .map, region.code 访问等)。任何
      // 一处抛错 stopTracking 就 reject → HikingScreen wall-clock catch
      // → nav 到 activity detail 但 session 永远丢。这个 try/catch 兜底:
      //   - 抛错时先 log 到 aliyun 保留证据 (o8.stop.outer_throw)
      //   - 尝试 minimal fallback addSession 保存本地路径 (best-effort)
      //   - 不 re-throw,stopTracking 正常 return 完成 cleanup
      try {
      // O8 checkpoint 1: 进入 save 分支
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { log } = require('../services/appLog');
        log('o8.stop.save_branch_entered', {
          sessionId: s.sessionId?.slice(0, 8),
          startedAt: s.startedAt,
          status: s.status,
          trackPoints_n: s.trackPoints.length,
          distanceM: Number(s.distanceM.toFixed(1)),
        });
      } catch { /* log unavailable */ }
      const region = getCurrentRegion();
      // Default name: "Hike — DD/MM/YYYY" / "Run — DD/MM/YYYY". Used
      // when the user skipped the post-stop name input. Keeps the
      // Activities list legible — every entry is at minimum
      // recognisable by type + date.
      const defaultName = (() => {
        const d = new Date(s.startedAt);
        const dd = String(d.getDate()).padStart(2, '0');
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const yyyy = d.getFullYear();
        const label = s.activityMode === 'running' ? 'Run' : 'Hike';
        return `${label} — ${dd}/${mm}/${yyyy}`;
      })();
      const finalName = (sessionName && sessionName.trim().length > 0)
        ? sessionName.trim().slice(0, 60)
        : defaultName;

      // The same durable completion path handles both an existing remote
      // shell and an Activity that started fully offline.
      // v115: too-short guard — < 2 points means no drawable path.
      // v198 extension: also reject distanceM < 20m (stationary GPS jitter
      // can pass the length check). Same threshold as the pre-check above
      // so behavior is consistent whether stopTracking runs once or twice.
      // Don't save to local store; also skip legacy POST and finalize PATCH.
      // Clean up the server-side empty row if one was created.
      if (!saveEligibility(
        s.trackPoints,
        s.distanceM,
      ).eligible) {
        const remoteId = s.remoteSessionId;
        if (remoteId) {
          // v449: inspect boolean return (deleteRemoteSession never throws)
          const ok = await deleteRemoteSession(remoteId);
          if (!ok) {
            try {
              // eslint-disable-next-line @typescript-eslint/no-require-imports
              const { log } = require('../services/appLog');
              log('v449.stop.shell_delete_failed_post', { remoteId });
            } catch { /* ignore */ }
          }
        }
        crashLogger.breadcrumb(`session:stop:too-short pts=${s.trackPoints.length} dist=${s.distanceM.toFixed(1)}m — discarded`);
        stopReason = 'too-short';
        // Fall through to reset() below; do NOT call addSession.
      } else {
      const remoteId = s.remoteSessionId;
      const endedAt = activityTimestampForSource(
        s.locationProviderSource,
        Date.now(),
        s.trackPoints[s.trackPoints.length - 1]?.t ?? s.startedAt,
      );
      // v404: final-flush 提前跑（还是 fire-and-forget，只推增量 tail）。
      // 不含 finalize —— finalize 挪到 snap 完成之后，才能带上 snapped
      // route_points。
      if (remoteId) {
        const tail = s.trackPoints.slice(lastFlushedIdx);
        if (tail.length > 0) {
          (async () => {
            const ok = await remoteAppendPoints(remoteId, tail.map(toServerPoint));
            crashLogger.breadcrumb(`session:final-flush count=${tail.length} ok=${ok}`);
          })().catch(() => undefined);
        }
      }

      // v333: flush this session's trackPoints into Memory store.
      // Finish refines presentation from immutable canonical accepted truth.
      // Memory reconciliation below remains independent and never consumes
      // this derived route.
      let memoryNewCells = 0;
      let snappedTrackPoints: TrackPoint[] | null = null;
      const matchingStartedAt = Date.now();
      try {
        const mapboxAuthority = await resolveMapboxPublicTokenAuthority();
        const mapboxToken = mapboxAuthority.token;
        let hikeSource: TrackPoint[] = s.trackPoints;
        const sourceSegments = segmentTrace(s.trackPoints).segments;
        let matchedSegmentCount = 0;
        // Matching is a bounded presentation refinement. A slightly larger
        // four-second envelope lets the longest useful segment run first while
        // preserving fast durable Save and canonical fallback on every failure.
        const matchingDeadlineMs = matchingStartedAt + 4_000;
        appendSimulatorLog('ACTIVITY_COMPLETION', 'activity_match_preflight_v2', {
          algorithmVersion: 'segment-walking-v2',
          matcherCredentialAuthority: mapboxAuthority.source,
          matcherAvailable: Boolean(mapboxToken),
          segmentCount: sourceSegments.length,
          eligibleSegmentCount: sourceSegments.filter(segment => segment.length >= 2).length,
          totalBudgetMs: 4_000,
        }, { userId: ownerUserId, clientActivityId: s.sessionId, qaSessionId: realActivityQaSessionId, coordinateSource: 'none' });
        if (mapboxToken && sourceSegments.some(segment => segment.length >= 2)) {
          const snappedSegments: TrackPoint[][] = sourceSegments.map(segment => segment);
          const prioritizedSegments = sourceSegments
            .map((segment, segmentIndex) => ({ segment, segmentIndex }))
            .filter(({ segment }) => segment.length >= 2)
            .sort((a, b) => b.segment.length - a.segment.length || a.segmentIndex - b.segmentIndex);
          for (const [priority, { segmentIndex, segment }] of prioritizedSegments.entries()) {
            if (segment.length < 2) {
              continue;
            }
            const remainingBudgetMs = matchingDeadlineMs - Date.now();
            if (remainingBudgetMs < 250) {
              appendSimulatorLog('ACTIVITY_COMPLETION', 'activity_map_matching_raw_fallback', {
                segmentIndex,
                rawPointCount: segment.length,
                reason: 'finish-budget-exhausted',
              }, { userId: ownerUserId, clientActivityId: s.sessionId, coordinateSource: 'none' });
              appendSimulatorLog('ACTIVITY_COMPLETION', 'activity_match_segment_v2', {
                algorithmVersion: 'segment-walking-v2',
                segmentIndex,
                priority,
                pointCount: segment.length,
                decision: 'raw-fallback',
                fallbackReason: 'finish-budget-exhausted',
                requestCount: 0,
                durationMs: 0,
              }, { userId: ownerUserId, clientActivityId: s.sessionId, qaSessionId: realActivityQaSessionId, coordinateSource: 'none' });
              continue;
            }
            const segmentMatchStartedAt = Date.now();
            try {
              // Gaps are a truth boundary. Each real segment is matched
              // independently; the missing connector is never sent to the
              // routing service and can therefore never become road geometry.
              appendSimulatorLog('ACTIVITY_COMPLETION', 'activity_map_matching_started', {
                segmentIndex,
                priority,
                segmentCount: sourceSegments.length,
                rawPointCount: segment.length,
                headTimestamp: segment[0]?.t ?? null,
                tailTimestamp: segment[segment.length - 1]?.t ?? null,
              }, { userId: ownerUserId, clientActivityId: s.sessionId, coordinateSource: 'none' });
              const canonicalInput = segment.map(p => ({
                  lat: p.lat,
                  lng: p.lng,
                  t: p.t,
                  alt: p.alt,
                  accuracy: p.accuracy,
                  speed: p.speed,
                }));
              const snapRes = await snapTrack(canonicalInput, {
                mapboxToken,
                totalTimeoutMs: remainingBudgetMs,
                perCallTimeoutMs: Math.min(1_600, remainingBudgetMs),
              });
              if (!snapRes.ok || snapRes.points.length < 2 || snapRes.stats.chunksOk === 0) {
                const fallbackReason = snapRes.ok
                  ? (snapRes.points.length < 2 ? 'too-few-result-points' : 'no-derived-chunks')
                  : snapRes.reason;
                appendSimulatorLog('ACTIVITY_COMPLETION', 'activity_map_matching_raw_fallback', {
                  segmentIndex,
                  rawPointCount: segment.length,
                  reason: fallbackReason,
                }, { userId: ownerUserId, clientActivityId: s.sessionId, coordinateSource: 'none' });
                appendSimulatorLog('ACTIVITY_COMPLETION', 'activity_match_segment_v2', {
                  algorithmVersion: 'segment-walking-v2',
                  segmentIndex,
                  priority,
                  pointCount: segment.length,
                  headTimestamp: segment[0]?.t ?? null,
                  tailTimestamp: segment[segment.length - 1]?.t ?? null,
                  decision: 'raw-fallback',
                  fallbackReason,
                  requestCount: snapRes.stats.apiCalls,
                  requestResults: snapRes.stats.requestResults,
                  durationMs: Date.now() - segmentMatchStartedAt,
                }, { userId: ownerUserId, clientActivityId: s.sessionId, qaSessionId: realActivityQaSessionId, coordinateSource: 'none' });
                continue;
              }
              const endpointCoverage = analyzeTrustedEndpointCoverage(canonicalInput, snapRes.points);
              const unanchoredQuality = evaluateMatchedGeometryQuality(canonicalInput, snapRes.points);
              if (!endpointCoverage.eligibleForAnchoring) {
                appendSimulatorLog('ACTIVITY_COMPLETION', 'activity_match_segment_v2', {
                  algorithmVersion: 'segment-walking-v2',
                  segmentIndex,
                  priority,
                  pointCount: segment.length,
                  decision: 'raw-fallback',
                  fallbackReason: 'endpoint-coverage-outside-envelope',
                  endpointCoverage,
                  quality: unanchoredQuality,
                  requestCount: snapRes.stats.apiCalls,
                  requestResults: snapRes.stats.requestResults,
                  durationMs: Date.now() - segmentMatchStartedAt,
                }, { userId: ownerUserId, clientActivityId: s.sessionId, qaSessionId: realActivityQaSessionId, coordinateSource: 'none' });
                continue;
              }
              const anchored = preserveTrustedRouteEndpoints(canonicalInput, snapRes.points);
              const finalQuality = evaluateMatchedGeometryQuality(canonicalInput, anchored);
              if (!finalQuality.accepted) {
                appendSimulatorLog('ACTIVITY_COMPLETION', 'activity_map_matching_raw_fallback', {
                  segmentIndex,
                  rawPointCount: segment.length,
                  reason: `final-quality-${finalQuality.reason}`,
                  quality: finalQuality,
                }, { userId: ownerUserId, clientActivityId: s.sessionId, coordinateSource: 'none' });
                appendSimulatorLog('ACTIVITY_COMPLETION', 'activity_match_segment_v2', {
                  algorithmVersion: 'segment-walking-v2',
                  segmentIndex,
                  priority,
                  pointCount: segment.length,
                  decision: 'raw-fallback',
                  fallbackReason: `final-quality-${finalQuality.reason}`,
                  endpointCoverage,
                  quality: finalQuality,
                  requestCount: snapRes.stats.apiCalls,
                  requestResults: snapRes.stats.requestResults,
                  durationMs: Date.now() - segmentMatchStartedAt,
                }, { userId: ownerUserId, clientActivityId: s.sessionId, qaSessionId: realActivityQaSessionId, coordinateSource: 'none' });
                continue;
              }
              const first = segment[0];
              const last = segment[segment.length - 1];
              const n = anchored.length;
              snappedSegments[segmentIndex] = anchored.map((point, index) => ({
                lat: point.lat,
                lng: point.lng,
                alt: point.alt,
                t: first.t + Math.round(((last.t - first.t) * index) / Math.max(1, n - 1)),
                segmentId: first.segmentId,
                ...(index === 0 && first.segmentStartReason
                  ? { segmentStartReason: first.segmentStartReason }
                  : {}),
              }));
              matchedSegmentCount += 1;
              appendSimulatorLog('ACTIVITY_COMPLETION', 'activity_map_matching_completed', {
                segmentIndex,
                rawPointCount: segment.length,
                matchedPointCount: anchored.length,
                endpointAnchored: true,
                endpointCoverage,
                unanchoredQuality,
                quality: finalQuality,
                stats: snapRes.stats,
              }, { userId: ownerUserId, clientActivityId: s.sessionId, coordinateSource: 'none' });
              appendSimulatorLog('ACTIVITY_COMPLETION', 'activity_match_segment_v2', {
                algorithmVersion: 'segment-walking-v2',
                segmentIndex,
                priority,
                pointCount: segment.length,
                matchedPointCount: anchored.length,
                decision: 'matched',
                endpointDecision: 'bounded-canonical-anchor',
                endpointCoverage,
                quality: finalQuality,
                requestCount: snapRes.stats.apiCalls,
                requestResults: snapRes.stats.requestResults,
                confidence: snapRes.stats.minConfidence,
                durationMs: Date.now() - segmentMatchStartedAt,
              }, { userId: ownerUserId, clientActivityId: s.sessionId, qaSessionId: realActivityQaSessionId, coordinateSource: 'none' });
            } catch (snapErr) {
              crashLogger.breadcrumb(`activity:segment_snap_failed ${String(snapErr).slice(0, 80)}`);
              appendSimulatorLog('ERROR', 'activity_map_matching_failed', {
                segmentIndex,
                errorCode: String(snapErr).slice(0, 100),
              }, { userId: ownerUserId, clientActivityId: s.sessionId, coordinateSource: 'none' });
              appendSimulatorLog('ERROR', 'activity_match_segment_v2', {
                algorithmVersion: 'segment-walking-v2',
                segmentIndex,
                priority,
                pointCount: segment.length,
                decision: 'raw-fallback',
                fallbackReason: 'unexpected-exception',
                errorCategory: String(snapErr).slice(0, 100),
                durationMs: Date.now() - segmentMatchStartedAt,
              }, { userId: ownerUserId, clientActivityId: s.sessionId, qaSessionId: realActivityQaSessionId, coordinateSource: 'none' });
            }
          }
          // Every output segment is independently truthful: a successful
          // match contributes derived presentation geometry, while that
          // segment's own failure contributes its accepted raw fallback.
          // One failed segment must not discard successful matches from the
          // others, and flattening retains segmentId boundaries so no gap is
          // ever presented or measured as walked geometry.
          hikeSource = snappedSegments.flat();
          if (matchedSegmentCount > 0) snappedTrackPoints = hikeSource;
        } else if (!mapboxToken) {
          appendSimulatorLog('ACTIVITY_COMPLETION', 'activity_map_matching_unavailable', {
            reason: 'public-token-unavailable',
            rawPointCount: s.trackPoints.length,
            segmentCount: sourceSegments.length,
          }, { userId: ownerUserId, clientActivityId: s.sessionId, coordinateSource: 'none' });
        }
        const memoryReconciliationStartedAt = Date.now();
        recordSavePhase('map_matching', matchingStartedAt, {
          matched: snappedTrackPoints !== null,
          segmentCount: sourceSegments.length,
          matchedSegmentCount,
        });
        // Finish is only a completeness pass. Memory authority is the real
        // accepted GPS evidence, never road-matched presentation geometry.
        // Central spatial dedupe makes this safe after incremental writes or
        // crash recovery, and iterating points cannot unlock a dashed gap.
        for (const point of s.trackPoints) {
          const result = await recordMemoryEvidence({
            lat: point.lat,
            lng: point.lng,
            atMs: point.t,
            source: 'reconciliation',
            ownerUserId,
          });
          if (result.committed && !result.deduplicated) memoryNewCells += 1;
        }
        recordSavePhase('memory_reconciliation', memoryReconciliationStartedAt, {
          inputPointCount: s.trackPoints.length,
          newEvidenceCount: memoryNewCells,
        });
        crashLogger.breadcrumb(`activity:memory_reconciled pts=${s.trackPoints.length} new=${memoryNewCells}`);
      } catch (e) {
        // The Activity journal is the crash-recoverable intent for accepted
        // points that may not yet exist in Memory (notably headless points).
        // Do not complete or rename/delete that journal until reconciliation
        // is durably committed.
        crashLogger.breadcrumb(`activity:memory_commit_failed ${String(e).slice(0, 80)}`);
        Alert.alert(
          'Activity not saved',
          'CairnNZ could not safely preserve your exploration Memory. Your Activity remains paused so you can try again.',
        );
        set({ status: 'paused', isFinishing: false, lastStopReason: null, savingHikeStep: null });
        return false;
      }

      // v412: 用原子 save-hike-atomic 端点替换 v411 的 "pushMemoryNow +
      // fire-and-forget finalize" 双请求。目标: 服务器一次事务完成
      // sessions + memory_points 落库, 要么全成一起要么全不发生。
      //
      // 失败分支: 网络异常 / 5xx → 完整 payload 写 pendingSyncStore,
      // SyncDaemon 后续用同 idempotencyKey 自动重试直到成功 or 用户长按放弃。
      //
      // v411 老路径 (pushMemoryNow + finalizeSession) **不再调用**,
      // v412 之后只走这一个 code path。
      const payloadStartedAt = Date.now();
      // One display contract: local completion, pending replay and server
      // Detail receive the exact same matched-or-canonical geometry. Kalman is
      // never a silent no-match fallback and cannot move saved endpoints.
      const finalDisplayTrackPoints = snappedTrackPoints ?? s.trackPoints;
      appendSimulatorLog('ACTIVITY_COMPLETION', 'activity_final_geometry_v2', {
        geometrySource: snappedTrackPoints
          ? (segmentTrace(finalDisplayTrackPoints).segments.length > 1 ? 'mixed-per-segment' : 'matched')
          : 'canonical',
        algorithmVersion: snappedTrackPoints ? 'segment-walking-v2' : 'canonical-fallback-v1',
        canonicalPointCount: s.trackPoints.length,
        displayPointCount: finalDisplayTrackPoints.length,
        canonicalSegmentCount: segmentTrace(s.trackPoints).segments.length,
        displaySegmentCount: segmentTrace(finalDisplayTrackPoints).segments.length,
        canonicalFingerprint: geometryFingerprint(s.trackPoints),
        displayFingerprint: geometryFingerprint(finalDisplayTrackPoints),
        localServerPayloadEqual: true,
      }, {
        userId: ownerUserId,
        clientActivityId: s.sessionId,
        qaSessionId: realActivityQaSessionId,
        coordinateSource: 'none',
      });
      const v412Route3 = finalDisplayTrackPoints.map(p => toServerPoint(p));
      const v412RouteRaw = (s.trackPointsRaw.length > 0 ? s.trackPointsRaw : s.trackPoints)
        .map(p => toServerPoint(p));

      // 采样 memory_points: 从 memoryStore 里拉这次 hike 期间产生的 unsynced points
      const memoryUnsynced = useMemoryStore.getState().points
        .filter((p: any) => !p.synced && p.ts >= s.startedAt! && p.ts <= endedAt)
        .map((p: any) => ({ lat: p.lat, lng: p.lng, ts: Math.floor(p.ts), cid: p.cid }));

      const v412Payload = {
        end_time: new Date(endedAt).toISOString(),
        distance_m: finalStats.distanceM,
        duration_s: finalDurationS,
        name: finalName,
        route_points: v412Route3,
        route_points_raw: v412RouteRaw,
        memory_points: memoryUnsynced,
      };
      recordSavePhase('payload_serialization', payloadStartedAt, {
        displayPointCount: v412Route3.length,
        rawPointCount: v412RouteRaw.length,
        memoryPointCount: memoryUnsynced.length,
      });
      appendSimulatorLog('ACTIVITY_COMPLETION', 'activity_save_started', {
        rawPointCount: v412RouteRaw.length,
        displayPointCount: v412Route3.length,
        segmentCount: segmentTrace(s.trackPoints).segments.length,
      }, { userId: ownerUserId, clientActivityId: s.sessionId, coordinateSource: 'none' });
      // O8 checkpoint 2: payload built. 下一步 uuidv4 曾在其他 RN app 里
      // 被报 throw (crypto.getRandomValues 不可用),先记一笔。
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { log } = require('../services/appLog');
        log('o8.stop.payload_built', {
          route_n: v412Route3.length,
          raw_n: v412RouteRaw.length,
          memory_unsynced_n: memoryUnsynced.length,
        });
      } catch { /* ignore */ }
      let idempotencyKey: string;
      try {
        idempotencyKey = uuidv4();
      } catch (uuidErr) {
        // Fallback: 用 time + random 做 idempotencyKey (质量弱一些但 non-throw)
        idempotencyKey = `fallback-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
        try {
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const { log } = require('../services/appLog');
          log('o8.stop.uuidv4_fallback', { err: String(uuidErr).slice(0, 100), key: idempotencyKey });
        } catch { /* ignore */ }
      }
      let v412Result: any = null;
      let v412Success = false;
      // Local product data is authoritative until verified server handoff.
      // Commit the immutable payload + summary + lifecycle before networking.
      const durableCommitStartedAt = Date.now();
      try {
        const { savePending } = require('../services/pendingSyncStore');
        await savePending({
          localId: s.sessionId,
          userId: ownerUserId,
          remoteId,
          idempotencyKey,
          activityMode: s.activityMode,
          payload: v412Payload,
          createdAt: Date.now(),
          startedAt: s.startedAt,
          summary: {
            startedAt: s.startedAt,
            endedAt,
            distanceM: finalStats.distanceM,
            durationS: finalDurationS,
            elevationGainM: finalStats.elevationGainM,
            name: finalName,
            markerIds: s.markerIds,
          },
          lastAttemptAt: null,
          attemptCount: 0,
        });
        await useSessionStore.getState().addSession({
          id: s.sessionId,
          clientActivityId: s.sessionId,
          remoteId: remoteId ?? undefined,
          serverActivityId: remoteId ?? undefined,
          activityMode: s.activityMode,
          regionCode: region.code,
          startedAt: s.startedAt,
          endedAt,
          durationS: finalDurationS,
          distanceM: finalStats.distanceM,
          elevationGainM: finalStats.elevationGainM,
          trackPoints: finalDisplayTrackPoints,
          markerIds: s.markerIds,
          name: finalName,
          memoryNewCells,
          syncState: 'pending',
        }, ownerUserId);
        await completeActivity({
          clientActivityId: s.sessionId,
          serverActivityId: remoteId,
          userId: ownerUserId,
          activityMode: s.activityMode,
          startedAt: s.startedAt,
          endedAt,
          lifecycle: 'completed_local',
          syncState: 'pending',
          locationProviderSource: s.locationProviderSource,
        });
        durableSaveCommitted = true;
        recordSavePhase('local_durable_completion', durableCommitStartedAt, {
          syncState: 'pending',
        });
      } catch (commitError) {
        crashLogger.breadcrumb(`activity:local_commit_failed ${String(commitError).slice(0, 80)}`);
      }

      if (!durableSaveCommitted) {
        // The local commit is the Save authority. Never upload, rename the
        // recovery journal, reset the store, or claim completion unless it
        // succeeded in full. The paused Activity remains available to retry.
        Alert.alert(
          'Activity not saved',
          'CairnNZ could not safely complete the local save. Your recorded Activity remains paused so you can try again.',
        );
        set({
          status: 'paused',
          isFinishing: false,
          lastStopReason: null,
          savingHikeStep: null,
        });
        return false;
      }

      if (remoteId) {
        const serverRequestStartedAt = Date.now();
        let serverResponseReceived = false;
        let serverAckPersistenceStartedAt = serverRequestStartedAt;
        try {
          // Local completion is already durable. Bound the optional immediate
          // ACK so weak Mapbox/network conditions cannot turn Finish into the
          // former 20-second blocking transaction; the same idempotent payload
          // is persisted for the sync daemon on timeout.
          set({ savingHikeStep: 'Uploading your hike…' });
          v412Result = await new Promise<any>((resolve, reject) => {
            let done = false;
            const timer = setInterval(() => {
              if (done) return;
              const elapsed = Date.now() - serverRequestStartedAt;
              if (elapsed > IMMEDIATE_SERVER_SAVE_BUDGET_MS) {
                clearInterval(timer);
                done = true;
                reject(new Error('immediate server save budget exceeded'));
                return;
              }
              // Update the step message with elapsed seconds — reassures
              // the user on long uploads that progress is happening.
              if (elapsed > 2000) {
                set({ savingHikeStep: `Uploading your hike… (${Math.floor(elapsed / 1000)}s)` });
              }
            }, 500);
            saveHikeAtomic(remoteId, v412Payload, idempotencyKey, s.sessionId!)
              .then((r) => { if (!done) { done = true; clearInterval(timer); resolve(r); } })
              .catch((e) => { if (!done) { done = true; clearInterval(timer); reject(e); } });
          });
          serverResponseReceived = true;
          serverAckPersistenceStartedAt = Date.now();
          recordSavePhase('server_save_request', serverRequestStartedAt, {
            acknowledged: true,
          });
          set({ savingHikeStep: 'Finalising…' });
          v412Success = true;
          crashLogger.breadcrumb(`v412:save_atomic ok sid=${v412Result?.session_id} replay=${!!v412Result?.idempotent_replay} mem_acc=${v412Result?.memory?.accepted}`);
          // 服务器已把 memory 落库 → 标 client 端 memoryStore 里对应的点为 synced
          try {
            const cids = (useMemoryStore.getState().points || [])
              .filter((p: any) => !p.synced && p.ts >= s.startedAt! && p.ts <= endedAt)
              .map((p: any) => p.cid);
            if (cids.length > 0 && typeof useMemoryStore.getState().markPointsSyncedByCid === 'function') {
              useMemoryStore.getState().markPointsSyncedByCid(cids);
            }
          } catch (markErr) {
            crashLogger.breadcrumb(`v412:mark_synced_failed ${String(markErr).slice(0, 60)}`);
          }
          // Persist product summary + registry mapping before removing the
          // pending payload. Any failure leaves the payload for safe replay.
          const sessionMarked = await useSessionStore.getState().markSynced(
            s.sessionId,
            v412Result.session_id,
            undefined,
            ownerUserId,
          );
          const registryMarked = await acknowledgeActivity(
            ownerUserId,
            s.sessionId,
            v412Result.session_id,
          );
          if (!sessionMarked || !registryMarked) throw new Error('activity_ack_persistence_failed');
          serverSaveAcknowledged = true;
          recordSavePhase('server_ack_persistence', serverAckPersistenceStartedAt, {
            acknowledged: true,
          });
          cleanupAfterRename = true;
          const { removePending } = require('../services/pendingSyncStore');
          try {
            await removePending(s.sessionId, ownerUserId);
          } catch (cleanupError) {
            // ACK/mapping is already durable. Keep the synced registry entry
            // so the daemon retries cleanup-only and never uploads again.
            crashLogger.breadcrumb(`activity:pending_cleanup_deferred ${String(cleanupError).slice(0, 80)}`);
          }
        } catch (v412Err: any) {
          v412Success = false;
          recordSavePhase(
            serverResponseReceived ? 'server_ack_persistence' : 'server_save_request',
            serverResponseReceived ? serverAckPersistenceStartedAt : serverRequestStartedAt,
            { acknowledged: false },
          );
          // O1 batch 28.2: 更细粒度 log,便于诊断 Bug 6 假 pending sync。
          // 记录 status + body error message preview + payload size 判断
          // 是网络挂 / 服务器 400/500 / idempotency 冲突。
          const errStatus = v412Err?.status ?? 'net';
          const errBody = v412Err?.body?.error ?? (v412Err?.message ?? '').slice(0, 100);
          const pointsN = v412Payload?.route_points?.length ?? 0;
          const memN = v412Payload?.memory_points?.length ?? 0;
          crashLogger.breadcrumb(`v412:save_atomic_failed status=${errStatus} err="${errBody}" pts=${pointsN} mem=${memN} → pending`);
          // 写 pendingSyncStore, SyncDaemon 后续重试
          try {
            const { savePending } = require('../services/pendingSyncStore');
            await savePending({
              localId: s.sessionId,
              userId: ownerUserId,
              remoteId,
              idempotencyKey,
              activityMode: s.activityMode,  // v412 blocker 1: 传真实 type, 不硬编码
              payload: v412Payload,
              createdAt: Date.now(),
              lastAttemptAt: null,
              attemptCount: 0,
            });
            crashLogger.breadcrumb(`v412:saved_to_pending localId=${s.sessionId.slice(0, 8)}`);
          } catch (persistErr) {
            crashLogger.breadcrumb(`v412:pending_persist_failed ${String(persistErr).slice(0, 60)}`);
            // O18 SAF-01 + Sprint 6 round-5 R5B2: pending persist failed
            // too — surface to UI so the user knows their hike is at risk
            // and can retry manually. Stash the payload so Retry can
            // re-attempt savePending (the store didn't accept our first
            // write, but a retry after clearing storage might work).
            set({
              saveLostSessionId: s.sessionId,
              saveLostPayload: {
                localId: s.sessionId,
                remoteId,
                idempotencyKey,
                activityMode: s.activityMode,
                payload: v412Payload,
                userId: ownerUserId,
              },
            });
            // Sprint 6 round-14 R14B9 fix: persist to AsyncStorage so a
            // force-quit during the SAF-01 Alert doesn't permanently
            // lose the hike. HikingScreen mount reads this back and
            // re-fires the Alert.
            try {
              // eslint-disable-next-line @typescript-eslint/no-require-imports
              const { storage } = require('./storage');
              await storage.setItem(saf01StorageKey(ownerUserId), JSON.stringify({
                saveLostSessionId: s.sessionId,
                saveLostPayload: {
                  localId: s.sessionId,
                  remoteId,
                  idempotencyKey,
                  activityMode: s.activityMode,
                  payload: v412Payload,
                  userId: ownerUserId,
                },
              }), { strict: true });
            } catch { /* silent */ }
          }
        }
      } else {
        // 极端: hike 开始时也离线, remoteId 为 null → 直接写 pendingSyncStore, 让 SyncDaemon 之后先 startSession 再 saveHikeAtomic
        try {
          const { savePending } = require('../services/pendingSyncStore');
          await savePending({
            localId: s.sessionId,
            userId: ownerUserId,
            remoteId: null,
            idempotencyKey,
            activityMode: s.activityMode,  // v412 blocker 1: 传真实 type
            payload: v412Payload,
            createdAt: Date.now(),
            lastAttemptAt: null,
            attemptCount: 0,
          });
          crashLogger.breadcrumb(`v412:no_remoteid_saved_to_pending`);
        } catch (persistErr) {
          crashLogger.breadcrumb(`v412:pending_persist_failed ${String(persistErr).slice(0, 60)}`);
          // O18 SAF-01 + Sprint 6 R5B2: same as branch above — stash payload for retry.
          set({
            saveLostSessionId: s.sessionId,
            saveLostPayload: {
              localId: s.sessionId,
              remoteId: null,
              idempotencyKey,
              activityMode: s.activityMode,
              payload: v412Payload,
              userId: ownerUserId,
            },
          });
          // Sprint 6 round-14 R14B9 fix: same persistence for the
          // no-remoteId branch (hike started offline).
          try {
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const { storage } = require('./storage');
            await storage.setItem(saf01StorageKey(ownerUserId), JSON.stringify({
              saveLostSessionId: s.sessionId,
              saveLostPayload: {
                localId: s.sessionId,
                remoteId: null,
                idempotencyKey,
                activityMode: s.activityMode,
                payload: v412Payload,
                userId: ownerUserId,
              },
            }), { strict: true });
          } catch { /* silent */ }
        }
      }

      // O7 (2026-07-26): 用户报 12:11 真实 hike Save 后 activity detail
      // "Loading route..." 然后 session 消失。aliyun 上 too_short_check
      // 之后 zero save events → stopTracking 在这里之前 die 但 crashLogger
      // 断点没上到 aliyun。加高保真 aliyun log 便于下次诊断。
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { log } = require('../services/appLog');
        log('o7.stop.about_to_addSession', {
          sessionId: s.sessionId?.slice(0, 8),
          remoteId: remoteId ?? null,
          finalName: (finalName ?? '').slice(0, 30),
          hasStartedAt: !!s.startedAt,
          v412Success,
          trackPoints_n: finalDisplayTrackPoints.length,
          distanceM: Number(s.distanceM.toFixed(1)),
        });
      } catch { /* log unavailable */ }
      stopReason = v412Success ? 'saved' : 'saved_pending';
      // O7: log addSession success so aliyun trace has definitive "session
      // persisted locally" evidence. If this log is missing on next incident,
      // addSession itself threw silently — very rare but flag will show it.
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { log } = require('../services/appLog');
        log('o7.stop.addSession_ok', {
          sessionId: s.sessionId?.slice(0, 8),
          stopReason,
        });
      } catch { /* log unavailable */ }
      } // end too-short guard
      } catch (outerErr) {
        // A broad failure before the durable product commit must never be
        // converted into a completed Activity without an outbox payload.
        // After the commit, the local completed copy is authoritative and
        // this path may safely finish as pending (or synced when ACK state
        // was already persisted).
        try {
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const { log } = require('../services/appLog');
          log('o8.stop.outer_throw', {
            sessionId: s.sessionId?.slice(0, 8),
            err: String(outerErr).slice(0, 200),
            stopReason,
            trackPoints_n: s.trackPoints.length,
            distanceM: Number(s.distanceM.toFixed(1)),
          });
        } catch { /* log unavailable */ }
        crashLogger.breadcrumb(`o8:stop_outer_throw ${String(outerErr).slice(0, 100)}`);
        if (!durableSaveCommitted) {
          Alert.alert(
            'Activity not saved',
            'CairnNZ could not safely complete the local save. Your recorded Activity remains paused so you can try again.',
          );
          set({
            status: 'paused',
            isFinishing: false,
            lastStopReason: null,
            savingHikeStep: null,
          });
          return false;
        }
        stopReason = serverSaveAcknowledged ? 'saved' : 'saved_pending';
      }
    }

    // v409 fix #4: rename hike-track active JSONL → completed 供未来 replay
    // 或 cache 清理策略处理。同时清 persistBackgroundContext (hikeActive=false)
    // 以免 iOS 后续 fire background GPS 时误认为 hike 还在跑。
    // O6 (2026-07-26): await 而不是 fire-and-forget。之前 `void flushNow()
    // .then(renameToCompleted)` 是 fire-and-forget,用户点 Save 后立即杀
    // app 会让 rename 没跑完,active/{sid}.jsonl 留在磁盘,下次冷启
    // UnfinishedRecoveryModal 会弹一个用户明明已 saved 的 hike (Bug 8)。
    // 现在 await 让 rename 在 stopTracking return 前落盘。用户不会点完
    // Save 立刻杀 app,给 ~200ms 完成时间是可以接受的。
    // O7 (2026-07-26 subagent audit): stopTracking 被 HikingScreen 的 5s
    // wall-clock timeout 包住。若 flushNow 因 large 文件 (3-6h hike) 走
    // 3-10s,wall timeout 会中断 stopTracking 让 renameToCompleted 从来
    // 不跑 → 重现 Bug 8。修:flush 加 2.5s inner-timeout, 超时就 fire-
    // and-forget 让 rename 挂到 flush.then 后台跑。这样 stopTracking 本身
    // 在 2.5s 内 return,而 rename 保证会在磁盘 flush 完的下一 tick 触发,
    // 即便用户此时杀 app 也已经启动了写盘序列 (iOS 会给几秒 grace period)。
    try {
      const priorSid = s.sessionId;
      if (priorSid) {
        // O16 C2 fix: close the background task marker BEFORE rename so
        // the TaskManager Path B gate (STORAGE_KEY_SESSION) can't
        // resurrect an active/{sid}.jsonl during the rename window.
        // Pre-fix, persistBackgroundContext(null,false) was fire-and-
        // forget AFTER rename — a stray background GPS fire in that
        // 15s+ window could re-create the JSONL we just moved.
        try { await persistBackgroundContext(null, false); } catch { /* swallow */ }
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { renameToCompleted, flushNow } = require('../services/hikeTrackWriter');
        // O14 Bug 5 fix: pre-fix, FLUSH_INNER_TIMEOUT_MS=2500 was too aggressive.
        // For large hikes flush took >2.5s, we fell into the fire-and-forget
        // rename branch, stopTracking returned in <3s, user tapped Hike tab,
        // recovery useEffect fired while active/{sid}.jsonl was still on disk
        // (rename hadn't finished) → the just-Saved hike surfaced as
        // "unfinished". Widen the flush timeout to 15s so 99% of hikes rename
        // synchronously before stopTracking returns; the UI shows a saving
        // spinner during this window (Bug 4 fix in StopSummarySheet).
        const FLUSH_INNER_TIMEOUT_MS = 15000;
        const flushPromise = flushNow();
        const timedFlush = Promise.race([
          flushPromise.then(() => 'ok' as const),
          new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), FLUSH_INNER_TIMEOUT_MS)),
        ]);
        const result = await timedFlush;
        // Regardless of flush ok/timeout, always await rename — the previous
        // fire-and-forget branch was the root cause of Bug 5 (Save → unfinished
        // modal on next open). renameToCompleted internally re-flushes the
        // remaining buffer, so it tolerates a partial flush.
        try {
          await renameToCompleted(priorSid, Date.now(), s.remoteSessionId ?? undefined);
          if (result === 'timeout') {
            crashLogger.breadcrumb(`o14:rename_after_flush_timeout sid=${priorSid.slice(0, 8)}`);
          }
        } catch (renameErr) {
          crashLogger.breadcrumb(`o14:rename_failed ${String(renameErr).slice(0, 80)}`);
        }
      }
    } catch (e) {
      crashLogger.breadcrumb(`v409:hikeTrackWriter:rename failed ${String(e).slice(0, 80)}`);
    }
    if (cleanupAfterRename && s.sessionId && ownerUserId !== 'unknown') {
      try {
        const { cleanupAcknowledgedActivityArtifacts } = require('../services/syncDaemon');
        await cleanupAcknowledgedActivityArtifacts(ownerUserId, s.sessionId);
      } catch (cleanupError) {
        // Registry remains acknowledged if cleanup was interrupted; a later
        // reconciliation pass can safely repeat this per-Activity cleanup.
        crashLogger.breadcrumb(`activity:cleanup_deferred ${String(cleanupError).slice(0, 80)}`);
      }
    }
    // O16 C2: persistBackgroundContext(null,false) moved above (before
    // rename) so background TaskManager can't resurrect the JSONL
    // during the rename window. No second call needed here.

    // v409 fix #14: trigger cache cleanup (size cap + TTL). Fire-and-forget
    // — cleanup 挂了不影响用户看到 Activity Detail。
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { enforceSizeCap, enforceTTL } = require('../services/hikeTracksCache');
      void enforceSizeCap().catch(() => {});
      void enforceTTL().catch(() => {});
    } catch { /* best effort */ }

    // O7: final aliyun log before state reset. If we see this AND o7.stop.
    // addSession_ok = save flow completed. If we see this but NO
    // addSession_ok = something threw between addSession start and end.
    // If we see NEITHER = stopTracking threw before reaching addSession.
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { log } = require('../services/appLog');
      log('o7.stop.final', { stopReason });
    } catch { /* log unavailable */ }
    // Sprint 6 round-5 review R5B1 fix: preserve saveLostSessionId
    // across the state reset. Pre-fix, `set({ ...initialState, ... })`
    // wiped the field to null in the same synchronous flush as it was
    // set, so React subscribers only saw the null value and the SAF-01
    // Alert never fired. Now: read the current value + carry it through.
    // R5B2 companion: also carry saveLostPayload so Retry can re-attempt.
    if (s.locationProviderSource === 'simulator') {
      appendSimulatorLog('ACTIVITY_COMPLETION', serverSaveAcknowledged
        ? 'activity_save_acknowledged'
        : 'activity_save_pending', {
        stopReason,
        syncState: serverSaveAcknowledged ? 'synced' : 'pending',
      }, { userId: ownerUserId, clientActivityId: s.sessionId, coordinateSource: 'none' });
      appendSimulatorLog('ACTIVITY_COMPLETION', 'activity_completion_finished', {
        stopReason,
        distanceM: finalStats.distanceM,
        durationS: finalDurationS,
        elevationGainM: finalStats.elevationGainM,
        syncState: serverSaveAcknowledged ? 'synced' : 'pending',
      }, { userId: ownerUserId, clientActivityId: s.sessionId });
      await endSimulatorProvider('completed');
      simulatorSourceActive = false;
    } else {
      appendSimulatorLog('ACTIVITY_COMPLETION', serverSaveAcknowledged
        ? 'activity_save_acknowledged'
        : 'activity_save_pending', {
        stopReason,
        syncState: serverSaveAcknowledged ? 'synced' : 'pending',
      }, {
        userId: ownerUserId,
        clientActivityId: s.sessionId,
        qaSessionId: realActivityQaSessionId,
        coordinateSource: 'none',
      });
      appendSimulatorLog('ACTIVITY_COMPLETION', 'activity_completion_finished', {
        stopReason,
        rawPointCount: s.trackPointsRaw.length,
        canonicalPointCount: s.trackPoints.length,
        distanceM: finalStats.distanceM,
        durationS: finalDurationS,
        elevationGainM: finalStats.elevationGainM,
        syncState: serverSaveAcknowledged ? 'synced' : 'pending',
      }, {
        userId: ownerUserId,
        clientActivityId: s.sessionId,
        qaSessionId: realActivityQaSessionId,
        coordinateSource: 'none',
      });
      await emitRealTelemetryHealth('finish');
      await endQaTelemetrySession(ownerUserId, 'real-activity-completed');
      realActivityQaSessionId = null;
    }
    set((prev) => ({
      ...initialState,
      lastStopReason: stopReason,
      saveLostSessionId: prev.saveLostSessionId,
      saveLostPayload: prev.saveLostPayload,
    }));
    return true;
  },

  pauseTracking: async () => {
    const pauseOwner = get();
    if (pauseOwner.status !== 'tracking' || pauseOwner.isFinishing) return;
    // Drop a flag pin at the current location so the user can see WHERE they paused.
    const cur = get().lastCoordinate;
    if (cur) {
      set((s) => ({ pausePins: [...s.pausePins, cur] }));
    }
    // Freeze acceptance synchronously before any native/storage await. A GPS
    // callback already queued after the user's Pause tap must see `paused`.
    const frozenLifecycle = lifecycleDurationPatch(pauseOwner);
    stopActivityLifecycleTimer();
    set({ ...frozenLifecycle, status: 'paused' });
    appendSimulatorLog('ACTIVITY_STATE', 'activity_paused', {
      providerSource: pauseOwner.locationProviderSource,
    }, {
      userId: pauseOwner.ownerUserId,
      clientActivityId: pauseOwner.sessionId,
      coordinateSource: 'none',
    });
    if (pauseOwner.locationProviderSource === 'real') {
      await emitRealTelemetryHealth('paused');
      stopRealTelemetryHealthTimer();
    }
    deactivateForegroundSource();
    if (pauseOwner.locationProviderSource === 'real') await stopRealBackgroundSourceForHandoff();
    else deactivateBackgroundSource();
    // Drop already-delivered native samples from the prior ownership window.
    // Resume rotates generation, so even a concurrent drain cannot adopt them.
    drainBackgroundLocations();
    // Invalidate the durable native callback context while paused. Any task
    // wake after this write cannot append samples to the parked Activity.
    const pauseFenceDurable = await persistBackgroundContext(null, false).catch(() => false);
    if (pauseOwner.locationProviderSource === 'simulator') {
      pauseSimulatorProvider();
      simulatorSourceActive = false;
    }
    const afterFence = get();
    if (
      afterFence.sessionId !== pauseOwner.sessionId
      || afterFence.ownerUserId !== pauseOwner.ownerUserId
      || afterFence.liveOwnerGeneration !== pauseOwner.liveOwnerGeneration
    ) return;
    if (!pauseFenceDurable) {
      set({ locationAvailable: false, startError: 'initialization-failed' });
      Alert.alert(
        'Recording paused',
        'CairnNZ stopped the visible GPS source but could not verify the durable background fence. Finish or logout is blocked until storage is available.',
      );
      return;
    }
    // The simulator may move physically while paused. Clearing the accepted
    // anchor ensures Resume starts a real new segment and never fabricates
    // paused distance back to the pre-Pause coordinate.
    set({ status: 'paused', lastCoordinate: null, lastFixTimestamp: null, pendingSegmentStartReason: 'resume' });
    if (realGpsCandidateTimer) clearTimeout(realGpsCandidateTimer);
    realGpsCandidateTimer = null;
    realGpsContinuityState = createRealGpsContinuityState();
    realElevationState = createElevationQualityState(pauseOwner.elevationGainM);
    // Any fix already inside validate/commit before status became paused is
    // included durably, while callbacks arriving afterward are rejected.
    await pointIngestTail.catch(() => {});
    await updateUnfinishedActivity(String(pauseOwner.ownerUserId ?? ''), String(pauseOwner.sessionId ?? ''), {
      activeDurationMs: frozenLifecycle.activeDurationAccumulatedMs,
      activeSinceMs: null,
    }).catch(() => false);
  },

  resumeTracking: async () => {
    if (get().status !== 'paused' || get().isFinishing) return false;
    const rebuildingAfterProcessDeath = appStateSubscription === null;
    const resumeSource = get().locationProviderSource;
    const ownerForProvider = String(get().ownerUserId ?? '');
    if (resumeSource === 'simulator' && !await prepareSimulatorProvider(ownerForProvider)) {
      set({ locationAvailable: false, startError: 'location-unavailable' });
      return false;
    }
    const loc = resumeSource === 'real' ? await getLocation() : null;
    if (resumeSource === 'real' && !loc) {
      set({ locationAvailable: false, startError: 'location-unavailable' });
      return false;
    }
    if (resumeSource === 'real' && loc) {
      await refreshRealBackgroundAuthorization(false);
      if (backgroundGrantedCached) {
        const registered = await registerBackgroundTask();
        if (!registered) backgroundGrantedCached = false;
      }
    }

    const resumeState = get();
    const ownerUserId = String(resumeState.ownerUserId ?? '');
    if (
      !resumeState.sessionId
      || !ownerUserId
      || String(useAppStore.getState().user?.id ?? '') !== ownerUserId
    ) {
      set({ locationAvailable: false, startError: 'initialization-failed' });
      return false;
    }
    if (resumeSource === 'real') {
      realActivityQaSessionId = beginQaTelemetrySession(ownerUserId, false);
      realGpsContinuitySessionId = resumeState.sessionId;
      realGpsContinuityState = createRealGpsContinuityState();
      realElevationState = createElevationQualityState(resumeState.elevationGainM);
    }
    const resumeSegmentId = newSegmentId(resumeState.sessionId ?? 'activity');
    const resumeGenerationStartedAt = activityTimestampForSource(
      resumeSource,
      Date.now(),
      resumeState.lastFixTimestamp ?? resumeState.startedAt ?? 0,
    );
    const resumedOwnerGeneration = uuidv4();
    set({
      currentSegmentId: resumeSegmentId,
      liveOwnerGeneration: resumedOwnerGeneration,
      liveOwnerAcceptAfterMs: resumeGenerationStartedAt,
      pendingSegmentStartReason: rebuildingAfterProcessDeath ? 'process-recovery' : 'resume',
    });
    // Prepare durable recovery metadata while the live bit remains disabled.
    // Status is still paused, so a foreground watcher cannot publish a point.
    try {
      const registryPrepared = await updateUnfinishedActivity(ownerUserId, resumeState.sessionId, {
        liveOwnerGeneration: resumedOwnerGeneration,
        currentSegmentId: resumeSegmentId,
        nextSegmentStartReason: rebuildingAfterProcessDeath ? 'process-recovery' : 'resume',
        activeDurationMs: resumeState.activeDurationAccumulatedMs,
        activeSinceMs: null,
      });
      if (!registryPrepared) throw new Error('resume_registry_missing');
      const { updateHikeMeta } = require('../services/hikeTrackWriter');
      await updateHikeMeta(resumeState.sessionId, { owner_generation: resumedOwnerGeneration });
    } catch (error) {
      await persistBackgroundContext(null, false).catch(() => false);
      set({ status: 'paused', locationAvailable: false, startError: 'initialization-failed' });
      crashLogger.breadcrumb(`activity:resume_prepare_failed ${String(error).slice(0, 80)}`);
      return false;
    }

    // Establish a real source before presenting the recovered/paused session
    // as TRACKING. A failed resume keeps the preserved session paused.
    const currentAppState = AppState.currentState;
    if (currentAppState === 'background' || currentAppState === 'inactive') {
      if (resumeSource === 'real' && !backgroundGrantedCached) {
        set({ locationAvailable: false, startError: 'permission-denied' });
        await persistBackgroundContext(null, false).catch(() => false);
        return false;
      }
      await activateBackgroundSource();
      if (!isCurrentLocationSourceActive()) {
        set({ locationAvailable: false, startError: 'initialization-failed' });
        await persistBackgroundContext(null, false).catch(() => false);
        return false;
      }
    } else {
      await activateForegroundSource();
      if (!isCurrentLocationSourceActive()) {
        set({ locationAvailable: false, startError: 'initialization-failed' });
        await persistBackgroundContext(null, false).catch(() => false);
        return false;
      }
    }
    if (String(useAppStore.getState().user?.id ?? '') !== ownerUserId) {
      deactivateForegroundSource();
      deactivateBackgroundSource();
      await persistBackgroundContext(null, false).catch(() => false);
      set({ status: 'paused', locationAvailable: false, startError: 'initialization-failed' });
      return false;
    }
    const leasePersisted = resumeSource === 'simulator'
      ? await persistBackgroundContext(null, false)
      : await persistBackgroundContext(resumeState.sessionId, true, {
          clientActivityId: resumeState.sessionId,
          userId: ownerUserId,
          ownerGeneration: resumedOwnerGeneration,
          segmentId: resumeSegmentId,
          activityMode: resumeState.activityMode,
          acceptAfterMs: resumeGenerationStartedAt,
          qaSessionId: realActivityQaSessionId,
          continuityState: realGpsContinuityState,
          rawOrdinal: realGpsRawOrdinal,
        });
    if (!leasePersisted || String(useAppStore.getState().user?.id ?? '') !== ownerUserId) {
      deactivateForegroundSource();
      deactivateBackgroundSource();
      await persistBackgroundContext(null, false).catch(() => false);
      set({ status: 'paused', locationAvailable: false, startError: 'initialization-failed' });
      return false;
    }
    const lifecycleStartedAt = activityTimestampForSource(
      resumeSource,
      Date.now(),
      resumeGenerationStartedAt,
    );
    const lifecycleRegistered = await updateUnfinishedActivity(ownerUserId, resumeState.sessionId, {
      activeDurationMs: get().activeDurationAccumulatedMs,
      activeSinceMs: lifecycleStartedAt,
    }).catch(() => false);
    if (!lifecycleRegistered) {
      deactivateForegroundSource();
      deactivateBackgroundSource();
      await persistBackgroundContext(null, false).catch(() => false);
      set({ status: 'paused', locationAvailable: false, startError: 'initialization-failed' });
      return false;
    }
    set({
      status: 'tracking',
      locationAvailable: true,
      startError: null,
      activeDurationStartedAtMs: lifecycleStartedAt,
    });
    startActivityLifecycleTimer(resumeState.sessionId);
    startRealTelemetryHealthTimer();
    appendSimulatorLog('ACTIVITY_STATE', 'activity_resumed', {
      providerSource: resumeSource,
      segmentId: resumeSegmentId,
      recovery: rebuildingAfterProcessDeath,
    }, {
      userId: ownerUserId,
      clientActivityId: resumeState.sessionId,
      coordinateSource: 'none',
    });

    // The next accepted point proves the first valid interval after Resume.

    if (rebuildingAfterProcessDeath) {
      lastFlushedIdx = get().trackPoints.length;
      void batteryMonitor.start().catch(() => {});
      void networkMonitor.start().catch(() => {});
      sessionRecorder.start();

      appStateSubscription = AppState.addEventListener('change', (nextState: AppStateStatus) => {
        if (get().status !== 'tracking') return;
        const lifecycleOwner = get();
        appendSimulatorLog(
          'APP',
          nextState === 'active' ? 'app_foregrounded' : 'app_backgrounded',
          {
            appState: nextState,
            backgroundPermissionState: lifecycleOwner.backgroundLocationPermission,
            cachedBackgroundGranted: backgroundGrantedCached,
            foregroundWatcherActive: Boolean(locationSubscription),
            backgroundTaskActive,
            latestAcceptedAgeMs: lifecycleOwner.lastCoordinateTime === null
              ? null
              : Math.max(0, Date.now() - lifecycleOwner.lastCoordinateTime),
            ownerGenerationSuffix: lifecycleOwner.liveOwnerGeneration?.slice(-8) ?? null,
          },
          {
            userId: lifecycleOwner.ownerUserId,
            clientActivityId: lifecycleOwner.sessionId,
            qaSessionId: realActivityQaSessionId,
            coordinateSource: lifecycleOwner.locationProviderSource === 'real' ? 'real' : 'simulator',
          },
        );
        if (nextState !== 'active' && lifecycleOwner.locationProviderSource === 'real') {
          void flushSimulatorLogs(lifecycleOwner.ownerUserId ?? undefined);
        }
        if (nextState === 'background' || nextState === 'inactive') {
          enqueueActivation(async () => {
            deactivateForegroundSource();
            const active = await activateBackgroundSource();
            if (!active) await markRecordingContinuityUnavailable('background-provider-unavailable');
          });
        } else if (nextState === 'active') {
          enqueueActivation(async () => {
            if (get().locationProviderSource === 'real') {
              await transitionToForegroundSource();
            } else {
              await activateForegroundSource();
              deactivateBackgroundSource();
            }
          });
        }
      });

      drainInterval = setInterval(() => {
        if (get().status !== 'tracking') return;
        for (const coordinate of drainBackgroundLocations().sort((a, b) => a.timestamp - b.timestamp)) {
          get().addTrackPoint({
            lat: coordinate.latitude,
            lng: coordinate.longitude,
            alt: coordinate.altitude,
            accuracy: coordinate.accuracy ?? null,
            speed: coordinate.speed ?? null,
            verticalAccuracy: coordinate.altitudeAccuracy ?? null,
            course: coordinate.heading ?? null,
            clientActivityId: coordinate.clientActivityId,
            ownerGeneration: coordinate.ownerGeneration,
            segmentId: coordinate.segmentId,
            segmentStartReason: coordinate.segmentStartReason,
            rawOrdinal: coordinate.rawOrdinal,
            continuityPreclassified: coordinate.continuityPreclassified,
            canonicalDecision: coordinate.canonicalDecision,
            decisionReason: coordinate.decisionReason,
            continuityStateAfter: coordinate.continuityStateAfter,
            source: 'background',
          }, coordinate.timestamp);
        }
      }, 1000);

      incrementalFlushInterval = setInterval(async () => {
        const current = get();
        if (current.status !== 'tracking' || !current.remoteSessionId) return;
        const ownerSessionId = current.sessionId;
        const ownerGeneration = current.liveOwnerGeneration;
        const total = current.trackPoints.length;
        if (total <= lastFlushedIdx) return;
        const slice = current.trackPoints.slice(lastFlushedIdx, total);
        const ok = await remoteAppendPoints(current.remoteSessionId, slice.map(toServerPoint));
        const after = get();
        if (
          ok &&
          after.sessionId === ownerSessionId &&
          after.liveOwnerGeneration === ownerGeneration
        ) {
          lastFlushedIdx = total;
        }
      }, 120_000);

      try {
        const { startAutoPauseMonitor } = await import('../services/autoPauseMonitor');
        startAutoPauseMonitor({
          getStatus: () => get().status,
          getPoints: () => get().trackPoints.map(point => ({
            latitude: point.lat,
            longitude: point.lng,
            timestamp: point.t,
            speed: point.speed ?? undefined,
          })),
          onSilentEnd: () => { void get().stopTracking(); },
        });
      } catch { /* non-fatal */ }

      tokenRefreshInterval = setInterval(async () => {
        if (get().status !== 'tracking' && get().status !== 'paused') return;
        try {
          const { refreshToken } = await import('../services/authService');
          await refreshToken();
        } catch { /* never interrupt a recording */ }
      }, 30 * 60_000);
    }
    return true;
  },

  addTrackPoint: async (coord, timestamp) => {
    // Serialize validate → durable journal → publish. Every provider receives
    // the same explicit decision; no provider may mutate derived state itself.
    const previousIngest = pointIngestTail;
    let releaseIngest: () => void = () => {};
    pointIngestTail = new Promise<void>((resolve) => { releaseIngest = resolve; });
    await previousIngest.catch(() => {});
    try {
      const ingestStartedAt = Date.now();
      const before = get();
      // Legacy/manual callers without a native timestamp can land twice in
      // one millisecond. Preserve strict ordering without weakening explicit
      // native timestamp dedupe.
      const sampleTimestamp = timestamp == null
        ? Math.max(Math.floor(ingestStartedAt), (before.lastFixTimestamp ?? 0) + 1)
        : Math.floor(timestamp);
      const owned = coord as ActivityCoordinate;
      const coordinateSource = owned.source === 'simulator' ? 'simulator' as const : 'real' as const;
      const reconcilingCommittedBackground = Boolean(
        before.status === 'tracking'
        && before.isFinishing
        && owned.source === 'background'
        && owned.committedBeforeFinish
        && finishIngestCutoffMs !== null
        && sampleTimestamp <= finishIngestCutoffMs,
      );
      const inactiveForNormalIngest =
        before.status !== 'tracking'
        || before.isFinishing;
      const reject = (reason: string): ActivityLocationAcceptance => {
        appendSimulatorLog('LOCATION', 'location_sample_rejected', {
          sampleSource: owned.source ?? 'foreground',
          accuracyM: owned.accuracy ?? null,
          rejectionReason: reason,
          sequenceTimestamp: sampleTimestamp,
          sampleTimestamp,
          sampleAgeMs: Math.max(0, Date.now() - sampleTimestamp),
          decisionLatencyMs: Date.now() - ingestStartedAt,
          ownerGenerationSuffix: before.liveOwnerGeneration?.slice(-8) ?? null,
        }, {
          userId: before.ownerUserId,
          clientActivityId: before.sessionId,
          coordinateSource,
        });
        return {
          accepted: false,
          reason,
          segmentId: before.currentSegmentId,
        };
      };
      if (
        (inactiveForNormalIngest && !reconcilingCommittedBackground)
        || !before.sessionId
        || !before.liveOwnerGeneration
        || !before.ownerUserId
        || String(useAppStore.getState().user?.id ?? '') !== before.ownerUserId
      ) return reject('inactive-or-unowned');

      if (owned.clientActivityId && owned.clientActivityId !== before.sessionId) {
        return reject('stale-client-activity');
      }
      if (owned.ownerGeneration && owned.ownerGeneration !== before.liveOwnerGeneration) {
        return reject('stale-owner-generation');
      }
      const isSimulatorSample = owned.source === 'simulator';
      if (
        (before.locationProviderSource === 'simulator') !== isSimulatorSample
      ) {
        if (before.locationProviderSource === 'simulator' && !isSimulatorSample) {
          appendSimulatorLog('PROVIDER', 'real_callback_rejected_for_simulator_activity', {
            rejectionReason: 'provider-source-mismatch',
            sampleSource: owned.source ?? 'foreground',
            ownerGenerationSuffix: before.liveOwnerGeneration.slice(-8),
          }, { userId: before.ownerUserId, clientActivityId: before.sessionId, coordinateSource: 'real' });
        }
        return reject('provider-source-mismatch');
      }
      if (
        !Number.isFinite(coord.lat) || coord.lat < -90 || coord.lat > 90
        || !Number.isFinite(coord.lng) || coord.lng < -180 || coord.lng > 180
      ) return reject('invalid-coordinate');
      if (before.liveOwnerAcceptAfterMs !== null && sampleTimestamp < before.liveOwnerAcceptAfterMs) {
        return reject('before-owner-generation');
      }
      if (
        (isSimulatorSample || owned.continuityPreclassified)
        && before.lastFixTimestamp !== null
        && sampleTimestamp <= before.lastFixTimestamp
      ) {
        return reject('non-monotonic-timestamp');
      }

      let realObservation: RealGpsObservation | null = null;
      let realMotionDecision: MotionDecision | null = null;
      let confirmedCandidateObservation: RealGpsObservation | null = null;
      let rawOrdinal: number | null = null;
      if (!isSimulatorSample && owned.continuityPreclassified) {
        ensureRealGpsContinuityState(before);
        rawOrdinal = owned.rawOrdinal ?? realGpsRawOrdinal + 1;
        realGpsRawOrdinal = Math.max(realGpsRawOrdinal, rawOrdinal);
        realObservation = {
          lat: coord.lat,
          lng: coord.lng,
          t: sampleTimestamp,
          accuracy: coord.accuracy ?? null,
          verticalAccuracy: coord.verticalAccuracy ?? null,
          altitude: coord.alt ?? null,
          speed: coord.speed ?? null,
          course: coord.course ?? null,
          source: 'background',
          observationId: String(before.sessionId).slice(-8) + ':' + rawOrdinal,
          rawOrdinal,
        };
        if (owned.canonicalDecision !== 'ACCEPT') {
          const auditPoint: SegmentedTrackPoint = {
            ...coord,
            t: sampleTimestamp,
            rawOrdinal,
            segmentId: before.currentSegmentId ?? newSegmentId(before.sessionId, sampleTimestamp),
            source: 'background',
          };
          if (owned.continuityStateAfter) realGpsContinuityState = owned.continuityStateAfter;
          set(state => (
            state.sessionId === before.sessionId
            && state.liveOwnerGeneration === before.liveOwnerGeneration
              ? {
                  trackPointsRaw: [...state.trackPointsRaw, auditPoint],
                }
              : state
          ));
          await persistCurrentRealBackgroundContext().catch(() => false);
          return reject(owned.decisionReason ?? 'background-preclassified-rejection');
        }
      } else if (!isSimulatorSample) {
        const continuity = ensureRealGpsContinuityState(before);
        rawOrdinal = ++realGpsRawOrdinal;
        realObservation = {
          lat: coord.lat,
          lng: coord.lng,
          t: sampleTimestamp,
          accuracy: coord.accuracy ?? null,
          verticalAccuracy: coord.verticalAccuracy ?? null,
          altitude: coord.alt ?? null,
          speed: coord.speed ?? null,
          course: coord.course ?? null,
          source: owned.source === 'background'
            ? 'background'
            : owned.source === 'significant-change' ? 'significant-change' : 'foreground',
          observationId: String(before.sessionId).slice(-8) + ':' + rawOrdinal,
          rawOrdinal,
        };
        appendSimulatorLog('LOCATION', 'activity_observation_received_v2', {
          rawOrdinal,
          sampleSource: realObservation.source,
          sampleTimestamp,
          callbackDelayMs: Math.max(0, ingestStartedAt - sampleTimestamp),
          horizontalAccuracyM: diagnosticNumber(realObservation.accuracy),
          verticalAccuracyValid: realObservation.verticalAccuracy != null
            && realObservation.verticalAccuracy >= 0,
          verticalAccuracyM: diagnosticNumber(realObservation.verticalAccuracy),
          reportedSpeedValid: realObservation.speed != null && realObservation.speed >= 0,
          reportedSpeedMps: realObservation.speed != null && realObservation.speed >= 0
            ? diagnosticNumber(realObservation.speed)
            : null,
          reportedCourseValid: realObservation.course != null && realObservation.course >= 0,
          appState: AppState.currentState,
          ownerGenerationSuffix: before.liveOwnerGeneration.slice(-8),
        }, {
          userId: before.ownerUserId,
          clientActivityId: before.sessionId,
          qaSessionId: realActivityQaSessionId,
          coordinateSource: 'real',
        });
        realMotionDecision = evaluateRealGpsObservation(
          continuity,
          realObservation,
          before.activityMode,
          Date.now(),
        );
        realGpsContinuityState = realMotionDecision.state;
        confirmedCandidateObservation = realMotionDecision.confirmedCandidate ?? null;
        emitRealGpsDecision(before, realObservation, realMotionDecision, ingestStartedAt, rawOrdinal);
        schedulePendingCandidateTimeout(before);
        if (realMotionDecision.kind !== 'ACCEPT') {
          // Raw observations are audit evidence, not automatically Activity
          // truth. A rejected/quarantined fix must never advance the trusted
          // continuity anchor, distance, elevation, Memory or live line.
          const auditPoint: SegmentedTrackPoint = {
            ...coord,
            t: sampleTimestamp,
            rawOrdinal,
            segmentId: before.currentSegmentId ?? newSegmentId(before.sessionId, sampleTimestamp),
            source: owned.source ?? 'foreground',
          };
          set(state => (
            state.sessionId === before.sessionId
            && state.liveOwnerGeneration === before.liveOwnerGeneration
              ? {
                  trackPointsRaw: [...state.trackPointsRaw, auditPoint],
                }
              : state
          ));
          await persistCurrentRealBackgroundContext().catch(() => false);
          return reject(
            realMotionDecision.kind === 'QUARANTINE'
              ? 'physical-continuity-quarantine'
              : realMotionDecision.reason,
          );
        }
      }

      const acceptance: {
        point?: SegmentedTrackPoint;
        points?: SegmentedTrackPoint[];
        transition?: Partial<TrackingState>;
        reason?: string;
        continuityState?: RealGpsContinuityState;
        elevationDecision?: ElevationDecision;
        elevationDecisions?: Array<{ point: SegmentedTrackPoint; decision: ElevationDecision }>;
        elevationState?: ElevationQualityState;
        gapDecision?: {
          previousSegmentId: string | null;
          nextSegmentId: string;
          intervalMs: number | null;
          displacementM: number | null;
        };
      } = {};
      set((s) => {
        if (
          s.status !== 'tracking'
          || (s.isFinishing && !reconcilingCommittedBackground)
          || s.sessionId !== before.sessionId
          || s.ownerUserId !== before.ownerUserId
          || s.liveOwnerGeneration !== before.liveOwnerGeneration
        ) {
          acceptance.reason = 'ownership-changed';
          return s;
        }
        const acc = coord.accuracy ?? null;
        const speed = coord.speed ?? null;
        const t = sampleTimestamp;
        if (s.liveOwnerAcceptAfterMs !== null && t < s.liveOwnerAcceptAfterMs) {
          acceptance.reason = 'before-owner-generation';
          return s;
        }
        if (s.lastFixTimestamp !== null && t <= s.lastFixTimestamp) {
          acceptance.reason = 'non-monotonic-timestamp';
          return s;
        }

        if (isSimulatorSample && s.lastCoordinate && s.lastCoordinateTime) {
          const dtMs = t - s.lastCoordinateTime;
          const dtS = dtMs / 1000;
          if (dtS > 0) {
            const distM = haversineM(s.lastCoordinate, coord);
            const impliedSpeed = distM / dtS;
            if (impliedSpeed > TELEPORT_SPEED_MPS && distM > 30 && owned.segmentStartReason !== 'gps-reacquired') {
              const previousPoint = s.trackPoints.length > 0
                ? s.trackPoints[s.trackPoints.length - 1] as SegmentedTrackPoint
                : null;
              const credibleReacquisition = dtMs > MAX_CREDITABLE_ACTIVE_INTERVAL_MS
                && shouldStartNewSegment({
                  previous: previousPoint,
                  next: { ...coord, t },
                  mode: s.activityMode,
                });
              if (!credibleReacquisition) {
                acceptance.reason = 'implausible-teleport';
                return s;
              }
            }
          }
        }

        const tail = s.trackPoints.length > 0
          ? s.trackPoints[s.trackPoints.length - 1] as SegmentedTrackPoint
          : null;
        const durableBackgroundSegment = owned.source === 'background' ? owned.segmentId : undefined;
        const explicitSimulatorReacquisitionSegment = owned.source === 'simulator'
          && owned.segmentStartReason === 'gps-reacquired'
          ? owned.segmentId
          : undefined;
        const classifiedGap = durableBackgroundSegment
          ? !!tail && durableBackgroundSegment !== tail.segmentId
          : shouldStartNewSegment({
              previous: tail,
              next: { ...coord, t },
              mode: s.activityMode,
            });
        const segmentId = durableBackgroundSegment ?? explicitSimulatorReacquisitionSegment ?? (classifiedGap
          ? newSegmentId(s.sessionId ?? 'activity', t)
          : (owned.segmentId || s.currentSegmentId || newSegmentId(s.sessionId ?? 'activity', t)));
        const segmentStartReason = owned.segmentStartReason ?? s.pendingSegmentStartReason
          ?? (classifiedGap ? 'gps-reacquired' : tail ? undefined : 'start');
        if (classifiedGap) {
          acceptance.gapDecision = {
            previousSegmentId: tail?.segmentId ?? null,
            nextSegmentId: segmentId,
            intervalMs: tail ? Math.max(0, t - tail.t) : null,
            displacementM: tail ? diagnosticNumber(haversineM(tail, coord)) : null,
          };
        }
        const rawPoint: SegmentedTrackPoint = {
          ...coord,
          t,
          ...(rawOrdinal !== null ? { rawOrdinal } : {}),
          segmentId,
          ...(segmentStartReason ? { segmentStartReason } : {}),
          source: owned.source ?? 'foreground',
        };

        if (acc !== null && acc > ACCURACY_REJECT_M) {
          acceptance.reason = 'poor-accuracy';
          return {
            ...s,
            trackPointsRaw: [...s.trackPointsRaw, rawPoint],
            lastFixTimestamp: isSimulatorSample ? t : s.lastFixTimestamp,
          };
        }
        if (
          isSimulatorSample
          &&
          s.activityMode === 'hiking'
          && speed !== null
          && speed > HIKING_OVERSPEED_MPS
        ) {
          acceptance.reason = 'hiking-overspeed';
          return {
            ...s,
            trackPointsRaw: [...s.trackPointsRaw, rawPoint],
            overSpeedActive: true,
            lastFixTimestamp: t,
          };
        }

        const distFromLastAccepted = s.lastCoordinate
          ? haversineM(s.lastCoordinate, coord)
          : Infinity;
        const previousRaw = s.trackPointsRaw.length > 0
          ? s.trackPointsRaw[s.trackPointsRaw.length - 1]
          : null;
        const suppressRadius = isSimulatorSample
          ? Math.max(STATIONARY_RADIUS_MIN_M, acc ?? 0)
          : Math.min(4, Math.max(2, (acc ?? 10) * 0.25));
        let acceptedCoord: ActivityCoordinate = coord;
        if (
          speed !== null
          && speed >= 0
          && speed < STATIONARY_SPEED_MPS
          && s.lastCoordinate
          && distFromLastAccepted <= suppressRadius
        ) {
          // A bounded clean-track heartbeat preserves trusted elapsed time and
          // continuity without crediting positional drift as distance/elevation.
          const sinceCleanPointMs = tail ? t - tail.t : Infinity;
          if (sinceCleanPointMs < 30_000) {
            acceptance.reason = 'stationary-suppressed';
            return {
              ...s,
              trackPointsRaw: [...s.trackPointsRaw, rawPoint],
              lastFixTimestamp: isSimulatorSample ? t : s.lastFixTimestamp,
            };
          }
          acceptedCoord = {
            ...coord,
            lat: s.lastCoordinate.lat,
            lng: s.lastCoordinate.lng,
            alt: tail?.alt ?? coord.alt,
            speed: 0,
          };
          acceptance.reason = 'accepted-stationary-heartbeat';
        }

        const withinIndoorDriftGate = (
          isSimulatorSample
          &&
          acceptedCoord === coord
          && s.lastCoordinate !== null
          && (acc === null || acc > 12)
          && distFromLastAccepted < 15
          && s.lastCoordinateTime !== null
          && t - s.lastCoordinateTime < 30_000
        );
        const credibleMotion = Boolean(
          withinIndoorDriftGate
          && s.lastCoordinate
          && isCredibleMotionSample({
            mode: s.activityMode,
            lastAccepted: s.lastCoordinate,
            previousRaw,
            current: { ...coord, t },
          }),
        );
        if (withinIndoorDriftGate && !credibleMotion) {
          acceptance.reason = 'indoor-drift-suppressed';
          try {
            crashLogger.breadcrumb(
              `k8:indoor_suppress acc=${acc ?? 'na'} dist_m=${Math.round(distFromLastAccepted)}`,
            );
          } catch { /* diagnostic only */ }
          return {
            ...s,
            trackPointsRaw: [...s.trackPointsRaw, rawPoint],
            lastFixTimestamp: isSimulatorSample ? t : s.lastFixTimestamp,
          };
        }
        if (withinIndoorDriftGate && credibleMotion) {
          acceptance.reason = 'accepted-credible-motion';
        }

        const cleanPoint: SegmentedTrackPoint = {
          ...rawPoint,
          lat: acceptedCoord.lat,
          lng: acceptedCoord.lng,
          alt: acceptedCoord.alt,
          speed: acceptedCoord.speed,
        };
        const confirmedCandidatePoint: SegmentedTrackPoint | null = confirmedCandidateObservation
          ? {
              lat: confirmedCandidateObservation.lat,
              lng: confirmedCandidateObservation.lng,
              alt: confirmedCandidateObservation.altitude ?? null,
              accuracy: confirmedCandidateObservation.accuracy,
              verticalAccuracy: confirmedCandidateObservation.verticalAccuracy ?? null,
              speed: confirmedCandidateObservation.speed ?? null,
              course: confirmedCandidateObservation.course ?? null,
              t: confirmedCandidateObservation.t,
              rawOrdinal: confirmedCandidateObservation.rawOrdinal,
              segmentId,
              source: confirmedCandidateObservation.source,
            }
          : null;
        const canonicalPoints = confirmedCandidatePoint
          ? [confirmedCandidatePoint, cleanPoint]
          : [cleanPoint];
        let smoothedPoints: TrackPoint[] = [];
        let smoothedLat = acceptedCoord.lat;
        let smoothedLng = acceptedCoord.lng;
        if (!isSimulatorSample && owned.continuityStateAfter) {
          smoothedLat = owned.continuityStateAfter.liveCoordinate?.lat ?? acceptedCoord.lat;
          smoothedLng = owned.continuityStateAfter.liveCoordinate?.lng ?? acceptedCoord.lng;
          acceptance.continuityState = owned.continuityStateAfter;
        } else if (!isSimulatorSample && realObservation && realMotionDecision) {
          let continuityForAcceptance = realMotionDecision.state;
          if (confirmedCandidateObservation && confirmedCandidatePoint) {
            const candidateLive = acceptRealGpsObservation(
              continuityForAcceptance,
              confirmedCandidateObservation,
              segmentId,
            );
            continuityForAcceptance = candidateLive.state;
            smoothedPoints.push({
              ...confirmedCandidatePoint,
              lat: candidateLive.liveCoordinate.lat,
              lng: candidateLive.liveCoordinate.lng,
            });
          }
          const acceptedObservation: RealGpsObservation = {
            ...realObservation,
            lat: acceptedCoord.lat,
            lng: acceptedCoord.lng,
            altitude: acceptedCoord.alt ?? null,
            speed: acceptedCoord.speed ?? null,
          };
          const live = acceptRealGpsObservation(
            continuityForAcceptance,
            acceptedObservation,
            segmentId,
          );
          smoothedLat = live.liveCoordinate.lat;
          smoothedLng = live.liveCoordinate.lng;
          acceptance.continuityState = live.state;
        } else if (kalmanLat === null || kalmanLng === null) {
          const accForInit = acc ?? 10;
          kalmanLat = kalmanInit(acceptedCoord.lat, accForInit, KALMAN_PROCESS_NOISE);
          kalmanLng = kalmanInit(acceptedCoord.lng, accForInit, KALMAN_PROCESS_NOISE);
        } else {
          smoothedLat = kalmanUpdate(kalmanLat, acceptedCoord.lat, acc ?? undefined);
          smoothedLng = kalmanUpdate(kalmanLng, acceptedCoord.lng, acc ?? undefined);
        }
        const smoothedPoint: TrackPoint = {
          lat: smoothedLat,
          lng: smoothedLng,
          alt: acceptedCoord.alt,
          accuracy: acceptedCoord.accuracy,
          speed: acceptedCoord.speed,
          t,
          segmentId,
          ...(segmentStartReason ? { segmentStartReason } : {}),
        };
        smoothedPoints.push(smoothedPoint);

        let addedDistance = 0;
        let distanceTail: Coordinate | null = s.lastCoordinate;
        let distanceTailSegmentId = tail?.segmentId ?? null;
        for (const point of canonicalPoints) {
          if (distanceTail && distanceTailSegmentId === point.segmentId) {
            const edgeM = haversineM(distanceTail, point);
            if (edgeM <= 200) addedDistance += edgeM;
          }
          distanceTail = point;
          distanceTailSegmentId = point.segmentId;
        }
        const legacyElevationGainM = (() => {
          if (acceptedCoord.alt == null) return s.elevationGainM;
          const prevAlt = tail && tail.segmentId === segmentId ? tail.alt : null;
          if (prevAlt == null) return s.elevationGainM;
          const delta = acceptedCoord.alt - prevAlt;
          return s.elevationGainM + (delta > 0 ? delta : 0);
        })();
        let elevationGainM = legacyElevationGainM;
        if (!isSimulatorSample) {
          let elevationState = realElevationState;
          const elevationDecisions = canonicalPoints.map(point => {
            const decision = reduceElevationObservation(elevationState, { ...point, segmentId });
            elevationState = decision.state;
            return { point, decision };
          });
          acceptance.elevationDecision = elevationDecisions[elevationDecisions.length - 1]?.decision;
          acceptance.elevationDecisions = elevationDecisions;
          acceptance.elevationState = elevationState;
          elevationGainM = elevationState.cumulativeGainM;
        }
        acceptance.point = cleanPoint;
        acceptance.points = canonicalPoints;
        acceptance.reason = acceptance.reason ?? (classifiedGap ? 'accepted-new-segment' : 'accepted');
        acceptance.transition = {
          trackPoints: [...s.trackPoints, ...canonicalPoints],
          trackPointsSmoothed: [...s.trackPointsSmoothed, ...smoothedPoints],
          trackPointsRaw: s.trackPointsRaw.some(point => point.rawOrdinal === rawPoint.rawOrdinal)
            ? s.trackPointsRaw
            : [...s.trackPointsRaw, rawPoint],
          lastCoordinate: acceptedCoord,
          lastCoordinateTime: t,
          lastFixTimestamp: t,
          distanceM: s.distanceM + addedDistance,
          elevationGainM,
          currentSegmentId: segmentId,
          pendingSegmentStartReason: null,
          overSpeedActive: false,
        };
        return s;
      });

      if (!acceptance.point || !acceptance.transition) {
        return reject(acceptance.reason ?? 'rejected');
      }
      const accepted = acceptance.point;
      const acceptedPoints = acceptance.points ?? [accepted];
      const acceptedTransition = acceptance.transition;
      try {
        const journalStartedAt = Date.now();
        if (!isSimulatorSample) {
          appendSimulatorLog('ACTIVITY_POINT', 'activity_journal_commit_v2', {
            phase: 'attempt',
            firstRawOrdinal: acceptedPoints[0]?.rawOrdinal ?? null,
            lastRawOrdinal: accepted.rawOrdinal ?? null,
            ledgerKind: 'canonical',
            canonicalAttemptCount: acceptedPoints.length,
          }, {
            userId: before.ownerUserId,
            clientActivityId: before.sessionId,
            qaSessionId: realActivityQaSessionId,
            coordinateSource: 'none',
          });
        }
        if (owned.source !== 'background') {
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const { appendHikePoint } = require('../services/hikeTrackWriter');
          for (const point of acceptedPoints) {
            await appendHikePoint({
              t: point.t,
              lat: point.lat,
              lng: point.lng,
              acc: point.accuracy ?? undefined,
              alt: point.alt ?? undefined,
              vAcc: point.verticalAccuracy ?? undefined,
              speed: point.speed ?? undefined,
              course: point.course ?? undefined,
              rawOrdinal: point.rawOrdinal,
              src: point.source === 'significant-change'
                ? 'slc'
                : point.source === 'simulator' ? 'sim' : point.source === 'background' ? 'bg' : 'fg',
              conf: 1,
              clientActivityId: before.sessionId,
              ownerGeneration: before.liveOwnerGeneration,
              segmentId: point.segmentId,
              segmentStartReason: point.segmentStartReason,
            });
          }
        }
        const journalCommittedAt = Date.now();
        if (!isSimulatorSample) {
          appendSimulatorLog('ACTIVITY_POINT', 'activity_journal_commit_v2', {
            phase: 'result',
            firstRawOrdinal: acceptedPoints[0]?.rawOrdinal ?? null,
            lastRawOrdinal: accepted.rawOrdinal ?? null,
            ledgerKind: 'canonical',
            committed: true,
            latencyMs: Math.max(0, journalCommittedAt - journalStartedAt),
            canonicalCommittedCount: acceptedPoints.length,
            canonicalAckPointCount: before.trackPoints.length + acceptedPoints.length,
          }, {
            userId: before.ownerUserId,
            clientActivityId: before.sessionId,
            qaSessionId: realActivityQaSessionId,
            coordinateSource: 'none',
          });
        }
        const current = get();
        if (
          (current.status !== 'tracking' && current.status !== 'paused')
          || current.ownerUserId !== before.ownerUserId
          || current.sessionId !== before.sessionId
          || current.liveOwnerGeneration !== before.liveOwnerGeneration
        ) return reject('ownership-changed-during-commit');

        set((state) => {
          const next = { ...state, ...acceptedTransition };
          if (state.status === 'paused') {
            return {
              ...next,
              lastCoordinate: state.lastCoordinate,
              lastCoordinateTime: state.lastCoordinateTime,
              pendingSegmentStartReason: state.pendingSegmentStartReason,
            };
          }
          return next;
        });
        const storePublishedAt = Date.now();
        if (!isSimulatorSample) {
          appendSimulatorLog('ACTIVITY_POINT', 'activity_store_publish_v2', {
            firstRawOrdinal: acceptedPoints[0]?.rawOrdinal ?? null,
            lastRawOrdinal: accepted.rawOrdinal ?? null,
            canonicalVersion: before.trackPoints.length + acceptedPoints.length,
            pointCount: before.trackPoints.length + acceptedPoints.length,
            tailAgeMs: Math.max(0, storePublishedAt - accepted.t),
            commitToPublishLatencyMs: Math.max(0, storePublishedAt - journalCommittedAt),
          }, {
            userId: before.ownerUserId,
            clientActivityId: before.sessionId,
            qaSessionId: realActivityQaSessionId,
            coordinateSource: 'none',
          });
        }
        if (!isSimulatorSample) {
          if (acceptance.continuityState) realGpsContinuityState = acceptance.continuityState;
          if (acceptance.elevationState) realElevationState = acceptance.elevationState;
          if (!realGpsContinuityState.pending && realGpsCandidateTimer) {
            clearTimeout(realGpsCandidateTimer);
            realGpsCandidateTimer = null;
          }
        }
        if (!isSimulatorSample && acceptance.gapDecision) {
          appendSimulatorLog('GPS_SEGMENT', 'activity_segment_decision_v2', {
            decision: 'new-segment',
            trigger: owned.segmentStartReason ?? 'canonical-continuity-classifier',
            ...acceptance.gapDecision,
            continuityAllowed: false,
            distanceContributionM: 0,
            elevationContributionM: 0,
            memoryBridgeAllowed: false,
          }, {
            userId: before.ownerUserId,
            clientActivityId: before.sessionId,
            qaSessionId: realActivityQaSessionId,
            coordinateSource: 'none',
          });
        }

        const userId = before.ownerUserId;
        if (userId) {
          await updateUnfinishedActivity(userId, before.sessionId, {
            lastMeaningfulAt: accepted.t,
            currentSegmentId: accepted.segmentId,
            nextSegmentStartReason: undefined,
          });
          const latest = get();
          if (
            before.locationProviderSource === 'real'
            && latest.status === 'tracking'
            && !latest.isFinishing
            && latest.ownerUserId === userId
            && latest.sessionId === before.sessionId
            && latest.liveOwnerGeneration === before.liveOwnerGeneration
          ) {
            await persistCurrentRealBackgroundContext();
          }
        }
        let memoryResult = { committed: false, deduplicated: true };
        for (const point of acceptedPoints) {
          const pointMemoryResult = await recordMemoryEvidence({
            lat: point.lat,
            lng: point.lng,
            atMs: point.t,
            source: 'activity',
            ownerUserId: before.ownerUserId,
          });
          memoryResult = {
            committed: memoryResult.committed || pointMemoryResult.committed,
            deduplicated: memoryResult.deduplicated && pointMemoryResult.deduplicated,
          };
        }
        const latest = get();
        appendSimulatorLog('ACTIVITY_POINT', 'activity_point_committed', {
          sampleSource: owned.source ?? 'foreground',
          segmentId: accepted.segmentId,
          segmentStartReason: accepted.segmentStartReason ?? null,
          canonicalCommittedCount: acceptedPoints.length,
          pointCount: latest.trackPoints.length,
          ownerGenerationSuffix: before.liveOwnerGeneration.slice(-8),
        }, {
          userId: before.ownerUserId,
          clientActivityId: before.sessionId,
          virtualTimestamp: isSimulatorSample ? accepted.t : null,
          coordinateSource,
        });
        if (isSimulatorSample && before.trackPoints.length === 0) {
          appendSimulatorLog('ACTIVITY_POINT', 'simulator_first_point_committed', {
            segmentId: accepted.segmentId,
            pointCount: latest.trackPoints.length,
            journalCommitted: true,
            lat: accepted.lat,
            lng: accepted.lng,
          }, {
            userId: before.ownerUserId,
            clientActivityId: before.sessionId,
            virtualTimestamp: accepted.t,
            coordinateSource: 'simulator',
          });
        }
        appendSimulatorLog('ACTIVITY_METRICS', 'activity_metrics_derived', {
          distanceM: latest.distanceM,
          durationS: latest.durationS,
          elevationGainM: latest.elevationGainM,
        }, {
          userId: before.ownerUserId,
          clientActivityId: before.sessionId,
          virtualTimestamp: isSimulatorSample ? accepted.t : null,
          coordinateSource,
        });
        if (!isSimulatorSample && acceptance.elevationDecision) {
          const elevationDecisions = acceptance.elevationDecisions
            ?? [{ point: accepted, decision: acceptance.elevationDecision }];
          for (const { point, decision: elevation } of elevationDecisions) {
          const elevationAnchorM = elevation.state.gainAnchorM;
          appendSimulatorLog(
            elevation.incrementM > 0 ? 'ACTIVITY_METRICS' : 'LOCATION',
            'activity_elevation_decision_v1',
            {
              rawOrdinal: point.rawOrdinal ?? null,
              segmentId: point.segmentId,
              verticalAccuracyM: diagnosticNumber(elevation.verticalAccuracyM),
              verticalEligible: elevation.reason !== 'missing-altitude'
                && elevation.reason !== 'missing-vertical-accuracy'
                && elevation.reason !== 'poor-vertical-accuracy',
              rawToFilteredDeltaM: elevation.rawAltitudeM == null || elevation.filteredAltitudeM == null
                ? null
                : diagnosticNumber(elevation.rawAltitudeM - elevation.filteredAltitudeM),
              filteredRiseFromAnchorM: elevation.filteredAltitudeM == null || elevationAnchorM == null
                ? null
                : diagnosticNumber(elevation.filteredAltitudeM - elevationAnchorM),
              pendingRiseSamples: elevation.state.pendingRiseSamples,
              pendingRiseDistanceM: diagnosticNumber(elevation.state.pendingRiseDistanceM),
              creditedDeltaM: diagnosticNumber(elevation.incrementM),
              decisionReason: elevation.reason,
              cumulativeGainM: diagnosticNumber(elevation.state.cumulativeGainM),
            },
            {
              userId: before.ownerUserId,
              clientActivityId: before.sessionId,
              qaSessionId: realActivityQaSessionId,
              coordinateSource: 'real',
            },
          );
          }
        }
        appendSimulatorLog('MEMORY_EVIDENCE', 'activity_memory_evidence_committed', {
          committed: memoryResult.committed,
          deduplicated: memoryResult.deduplicated,
        }, {
          userId: before.ownerUserId,
          clientActivityId: before.sessionId,
          virtualTimestamp: isSimulatorSample ? accepted.t : null,
          coordinateSource,
        });
        appendSimulatorLog('LOCATION', 'location_sample_accepted', {
          sampleSource: owned.source ?? 'foreground',
          accuracyM: accepted.accuracy ?? null,
          acceptanceReason: acceptance.reason ?? 'accepted',
          segmentId: accepted.segmentId,
          pointCount: get().trackPoints.length,
          memoryCommitted: memoryResult.committed,
          memoryDeduplicated: memoryResult.deduplicated,
          sequenceTimestamp: accepted.t,
          sampleTimestamp: accepted.t,
          sampleAgeAtPublicationMs: Math.max(0, storePublishedAt - accepted.t),
          ingestQueueLatencyMs: Math.max(0, journalStartedAt - ingestStartedAt),
          journalCommitLatencyMs: Math.max(0, journalCommittedAt - journalStartedAt),
          storePublicationLatencyMs: Math.max(0, storePublishedAt - journalCommittedAt),
          ownerGenerationSuffix: before.liveOwnerGeneration.slice(-8),
        }, {
          userId: before.ownerUserId,
          clientActivityId: before.sessionId,
          virtualTimestamp: isSimulatorSample ? accepted.t : null,
          coordinateSource,
        });
        return {
          accepted: true,
          reason: acceptance.reason ?? 'accepted',
          segmentId: accepted.segmentId,
          memoryCommitted: memoryResult.committed,
          memoryDeduplicated: memoryResult.deduplicated,
        };
      } catch (err: unknown) {
        const reason = String(err instanceof Error ? err.message : err).slice(0, 120);
        if (!isSimulatorSample) {
          appendSimulatorLog('ERROR', 'activity_journal_commit_v2', {
            phase: 'result',
            firstRawOrdinal: acceptedPoints[0]?.rawOrdinal ?? null,
            lastRawOrdinal: accepted.rawOrdinal ?? null,
            ledgerKind: 'canonical',
            committed: false,
            errorCategory: reason,
          }, {
            userId: before.ownerUserId,
            clientActivityId: before.sessionId,
            qaSessionId: realActivityQaSessionId,
            coordinateSource: 'none',
          });
        }
        crashLogger.breadcrumb(`activity:durable_commit_failed ${reason}`);
        const current = get();
        if (
          current.ownerUserId === before.ownerUserId
          && current.sessionId === before.sessionId
          && current.liveOwnerGeneration === before.liveOwnerGeneration
        ) {
          const frozenLifecycle = current.status === 'tracking'
            ? lifecycleDurationPatch(current)
            : null;
          stopActivityLifecycleTimer();
          deactivateForegroundSource();
          deactivateBackgroundSource();
          if (before.locationProviderSource === 'simulator') {
            pauseSimulatorProvider();
            simulatorSourceActive = false;
          }
          await persistBackgroundContext(null, false).catch(() => {});
          set({ ...(frozenLifecycle ?? {}), status: 'paused', startError: 'initialization-failed' });
          if (frozenLifecycle) {
            await updateUnfinishedActivity(before.ownerUserId, before.sessionId, {
              activeDurationMs: frozenLifecycle.activeDurationAccumulatedMs,
              activeSinceMs: null,
            }).catch(() => false);
          }
          Alert.alert(
            'Recording paused',
            'CairnNZ could not safely store the latest GPS sample. Your earlier recorded Activity is still preserved.',
          );
        }
        return reject(`durable-commit-failed:${reason}`);
      }
    } finally {
      releaseIngest();
    }
  },


  linkMarker: (markerId) => {
    set((s) => ({ markerIds: [...s.markerIds, markerId] }));
  },

  // O1 batch 37: reset removed — 0 external callers confirmed by grep audit.

  clearLastStopReason: () => {
    set({ lastStopReason: null, saveLostSessionId: null, saveLostPayload: null });
    // Clear only the signed-in owner's emergency payload. Logout/account
    // switch must hide another owner's data without destroying it.
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { storage } = require('./storage');
      const userId = String(useAppStore.getState().user?.id ?? '');
      if (userId) void storage.removeItem(saf01StorageKey(userId));
      // Legacy global records are removed only when their embedded owner is
      // the user explicitly clearing the error.
      if (userId) {
        void storage.getItem(LEGACY_SAF01_STORAGE_KEY).then((raw: string | null) => {
          if (!raw) return;
          try {
            const parsed = JSON.parse(raw);
            if (String(parsed?.saveLostPayload?.userId ?? '') === userId) {
              return storage.removeItem(LEGACY_SAF01_STORAGE_KEY);
            }
          } catch { /* malformed legacy artifact remains quarantined */ }
        });
      }
    } catch { /* silent */ }
  },
  hydrateSaf01: async () => {
    // Sprint 6 round-14 R14B9: read persisted SAF-01 state from disk
    // on cold-boot so a hike that failed to Save AND we couldn't stash
    // in pendingSyncStore survives app termination. HikingScreen mount
    // calls this before rendering.
    //
    // Emergency payloads are per-user. A legacy global record is readable
    // only by its embedded owner and is migrated to that owner's key; another
    // account neither sees nor deletes it.
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { storage } = require('./storage');
      const currentUserId = String(useAppStore.getState().user?.id ?? '');
      if (!currentUserId) return;
      const stillOwnsHydration = () => (
        String(useAppStore.getState().user?.id ?? '') === currentUserId
      );
      let raw = await storage.getItem(saf01StorageKey(currentUserId));
      let fromLegacy = false;
      if (!raw) {
        raw = await storage.getItem(LEGACY_SAF01_STORAGE_KEY);
        fromLegacy = !!raw;
      }
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (parsed?.saveLostSessionId && parsed?.saveLostPayload) {
        const payloadUserId = String(parsed.saveLostPayload.userId ?? '');
        if (!payloadUserId || payloadUserId === 'unknown' || payloadUserId !== currentUserId) return;
        if (!stillOwnsHydration()) return;
        if (fromLegacy) {
          await storage.setItem(saf01StorageKey(currentUserId), raw, { strict: true });
          // If account ownership changed during the write, preserve both the
          // owner-scoped copy and legacy fallback but never expose A in B.
          if (!stillOwnsHydration()) return;
          await storage.removeItem(LEGACY_SAF01_STORAGE_KEY);
        }
        if (!stillOwnsHydration()) return;
        set({
          saveLostSessionId: parsed.saveLostSessionId,
          saveLostPayload: parsed.saveLostPayload,
        });
      }
    } catch { /* silent — corrupt blob = drop */ }
  },

  reacquireSimulatorAt: async (coordinate, nextSignal = 'normal') => {
    const activity = get();
    const validated = validateCoordinate(coordinate.lat, coordinate.lng);
    if (
      !validated.ok
      || activity.status !== 'tracking'
      || activity.isFinishing
      || activity.locationProviderSource !== 'simulator'
      || !activity.sessionId
      || !activity.ownerUserId
      || !activity.liveOwnerGeneration
      || !['lost', 'frozen'].includes(useActivitySimulatorStore.getState().signal)
    ) {
      appendSimulatorLog('GPS_GAP', 'simulator_manual_reacquisition_rejected', {
        rejectionReason: !validated.ok ? validated.reason : 'invalid-activity-state',
      }, { userId: activity.ownerUserId, clientActivityId: activity.sessionId, coordinateSource: 'none' });
      return false;
    }
    try {
      await pauseSimulatorProviderForCorrection();
      await pointIngestTail.catch(() => {});
      const previousVirtualTimestamp = useActivitySimulatorStore.getState().virtualTimestampMs;
      const at = Number.isFinite(previousVirtualTimestamp) && previousVirtualTimestamp > 0
        ? previousVirtualTimestamp + 1
        : Date.now();
      const segmentId = newSegmentId(activity.sessionId, at);
      await updateUnfinishedActivity(activity.ownerUserId, activity.sessionId, {
        lastMeaningfulAt: activity.lastFixTimestamp ?? activity.startedAt ?? at,
        currentSegmentId: segmentId,
        nextSegmentStartReason: 'gps-reacquired',
      });
      set({ currentSegmentId: segmentId, pendingSegmentStartReason: 'gps-reacquired' });
      appendSimulatorLog('GPS_GAP', 'simulator_manual_reacquisition_requested', {
        previousSegmentId: activity.currentSegmentId,
        segmentId,
        gapDistanceCreditedM: 0,
      }, { userId: activity.ownerUserId, clientActivityId: activity.sessionId, coordinateSource: 'simulator' });
      await reacquireSimulatorProviderAt(validated.coordinate, segmentId, nextSignal);
      const tail = get().trackPoints[get().trackPoints.length - 1] as SegmentedTrackPoint | undefined;
      const accepted = tail?.segmentId === segmentId;
      appendSimulatorLog('GPS_SEGMENT', accepted
        ? 'simulator_manual_reacquisition_committed'
        : 'simulator_manual_reacquisition_not_committed', {
        segmentId,
        accepted,
        segmentCount: segmentTrace(get().trackPoints).segments.length,
        gapCount: segmentTrace(get().trackPoints).gaps.length,
        gapDistanceCreditedM: 0,
      }, { userId: activity.ownerUserId, clientActivityId: activity.sessionId, coordinateSource: 'simulator' });
      // The durable segment transition is committed even when the first Poor
      // fix is rejected by the normal accuracy gate. The engine retains the
      // segment-start marker until a later credible fix is accepted.
      return true;
    } catch (error) {
      const unchangedTail = get().trackPoints[get().trackPoints.length - 1] as SegmentedTrackPoint | undefined;
      if (unchangedTail) restoreSimulatorProviderTail({
        coordinate: unchangedTail,
        altitudeM: unchangedTail.alt ?? useActivitySimulatorStore.getState().altitudeM,
        virtualTimestampMs: unchangedTail.t,
        segmentId: unchangedTail.segmentId,
      });
      appendSimulatorLog('ERROR', 'simulator_manual_reacquisition_failed', {
        errorCode: String(error).slice(0, 120),
      }, { userId: activity.ownerUserId, clientActivityId: activity.sessionId, coordinateSource: 'none' });
      return false;
    }
  },

  rollbackSimulatorTail: async (requestedDistanceM) => {
    const activity = get();
    const fail = (reason: string) => ({ ok: false, actualDistanceM: 0, removedPointCount: 0, reason });
    if (
      activity.status !== 'tracking'
      || activity.isFinishing
      || activity.locationProviderSource !== 'simulator'
      || !activity.sessionId
      || !activity.ownerUserId
    ) return fail('invalid-activity-state');
    const preliminaryPlan = planSimulatorRollback(activity.trackPoints, requestedDistanceM);
    if (!preliminaryPlan || preliminaryPlan.keptPoints.length === 0) return fail('insufficient-accepted-route');
    appendSimulatorLog('ACTIVITY_STATE', 'simulator_rollback_requested', {
      requestedDistanceM,
      acceptedPointCount: activity.trackPoints.length,
    }, { userId: activity.ownerUserId, clientActivityId: activity.sessionId, coordinateSource: 'none' });
    try {
      await pauseSimulatorProviderForCorrection();
      await pointIngestTail.catch(() => {});
      const frozen = get();
      const plan = planSimulatorRollback(frozen.trackPoints, requestedDistanceM);
      if (!plan || plan.keptPoints.length === 0) {
        const unchangedTail = frozen.trackPoints[frozen.trackPoints.length - 1] as SegmentedTrackPoint | undefined;
        if (unchangedTail) restoreSimulatorProviderTail({
          coordinate: unchangedTail,
          altitudeM: unchangedTail.alt ?? useActivitySimulatorStore.getState().altitudeM,
          virtualTimestampMs: unchangedTail.t,
          segmentId: unchangedTail.segmentId,
        });
        return fail('insufficient-accepted-route');
      }
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { truncateActiveHikeTrack, readActiveHikeTail } = require('../services/hikeTrackWriter');
      const retained = plan.keptPoints as SegmentedTrackPoint[];
      const retainedJournal = retained.map((point) => ({
        t: point.t,
        lat: point.lat,
        lng: point.lng,
        acc: point.accuracy ?? undefined,
        alt: point.alt ?? undefined,
        speed: point.speed ?? undefined,
        src: 'sim' as const,
        conf: 1,
        clientActivityId: activity.sessionId!,
        ownerGeneration: activity.liveOwnerGeneration!,
        segmentId: point.segmentId,
        segmentStartReason: point.segmentStartReason,
      }));
      try {
        await truncateActiveHikeTrack(activity.sessionId, retainedJournal);
      } catch (journalError) {
        // The write-ahead cap may already have made the shorter prefix the
        // durable authority even if the snapshot swap itself failed. Do not
        // restore a longer in-memory tail in that case; prove the exact prefix
        // and roll forward to the corrected state.
        const recovered = await readActiveHikeTail(activity.sessionId);
        const correctionCommitted = recovered.length === retainedJournal.length
          && recovered.every((point: { t: number }, index: number) => point.t === retainedJournal[index].t);
        if (!correctionCommitted) throw journalError;
        appendSimulatorLog('ERROR', 'simulator_rollback_snapshot_swap_degraded', {
          errorCode: String(journalError).slice(0, 120),
          durablePrefixProven: true,
          retainedPointCount: retainedJournal.length,
        }, { userId: activity.ownerUserId, clientActivityId: activity.sessionId, coordinateSource: 'none' });
      }
      const tail = retained[retained.length - 1];
      const stats = calculateActivityStats(retained);
      const raw = frozen.trackPointsRaw.filter(point => point.t <= tail.t);
      lastFlushedIdx = Math.min(lastFlushedIdx, retained.length);
      kalmanLat = null;
      kalmanLng = null;
      set({
        trackPoints: retained,
        trackPointsSmoothed: frozen.trackPointsSmoothed.slice(0, retained.length),
        trackPointsRaw: raw,
        distanceM: stats.distanceM,
        elevationGainM: stats.elevationGainM,
        lastCoordinate: tail,
        lastCoordinateTime: tail.t,
        lastFixTimestamp: tail.t,
        currentSegmentId: tail.segmentId,
        pendingSegmentStartReason: null,
      });
      restoreSimulatorProviderTail({
        coordinate: { lat: tail.lat, lng: tail.lng },
        altitudeM: tail.alt ?? useActivitySimulatorStore.getState().altitudeM,
        virtualTimestampMs: tail.t,
        segmentId: tail.segmentId,
      });
      try {
        await updateUnfinishedActivity(activity.ownerUserId, activity.sessionId, {
          lastMeaningfulAt: tail.t,
          currentSegmentId: tail.segmentId,
          nextSegmentStartReason: undefined,
        });
      } catch (registryError) {
        // The crash-safe Activity journal already contains the corrected tail
        // and recovery derives route/segment truth from it. Keep the committed
        // correction and expose the advisory-registry failure for QA.
        appendSimulatorLog('ERROR', 'simulator_rollback_registry_update_failed', {
          errorCode: String(registryError).slice(0, 120),
        }, { userId: activity.ownerUserId, clientActivityId: activity.sessionId, coordinateSource: 'none' });
      }
      appendSimulatorLog('ACTIVITY_STATE', 'simulator_rollback_completed', {
        requestedDistanceM,
        actualDistanceM: plan.actualDistanceM,
        removedPointCount: plan.removedPoints.length,
        retainedPointCount: retained.length,
        distanceM: stats.distanceM,
        durationS: get().durationS,
        durationAuthority: 'activity-lifecycle',
        elevationGainM: stats.elevationGainM,
        memoryRolledBack: false,
        cairnsRolledBack: false,
        finalSaveAuthoritative: true,
      }, { userId: activity.ownerUserId, clientActivityId: activity.sessionId, coordinateSource: 'simulator' });
      return {
        ok: true,
        actualDistanceM: plan.actualDistanceM,
        removedPointCount: plan.removedPoints.length,
      };
    } catch (error) {
      const unchangedTail = get().trackPoints[get().trackPoints.length - 1] as SegmentedTrackPoint | undefined;
      if (unchangedTail) restoreSimulatorProviderTail({
        coordinate: unchangedTail,
        altitudeM: unchangedTail.alt ?? useActivitySimulatorStore.getState().altitudeM,
        virtualTimestampMs: unchangedTail.t,
        segmentId: unchangedTail.segmentId,
      });
      appendSimulatorLog('ERROR', 'simulator_rollback_failed', {
        errorCode: String(error).slice(0, 120),
      }, { userId: activity.ownerUserId, clientActivityId: activity.sessionId, coordinateSource: 'none' });
      return fail(String(error).slice(0, 120));
    }
  },

  simulateRecordingInterruption: async () => {
    const activity = get();
    if (
      activity.status !== 'tracking'
      || activity.isFinishing
      || activity.locationProviderSource !== 'simulator'
      || !activity.sessionId
      || !activity.ownerUserId
    ) return false;

    // Freeze the same owner before tearing down producers. Resume will rotate
    // generation and allocate the mandatory process-recovery segment.
    const frozenLifecycle = lifecycleDurationPatch(activity);
    stopActivityLifecycleTimer();
    set({ ...frozenLifecycle, status: 'paused', pendingSegmentStartReason: 'process-recovery' });
    try { appStateSubscription?.remove(); } catch { /* no-op */ }
    appStateSubscription = null;
    deactivateForegroundSource();
    deactivateBackgroundSource();
    pauseSimulatorProvider();
    simulatorSourceActive = false;
    drainBackgroundLocations();
    if (drainInterval) { clearInterval(drainInterval); drainInterval = null; }
    if (dynamicSamplingInterval) { clearInterval(dynamicSamplingInterval); dynamicSamplingInterval = null; }
    if (incrementalFlushInterval) { clearInterval(incrementalFlushInterval); incrementalFlushInterval = null; }
    if (tokenRefreshInterval) { clearInterval(tokenRefreshInterval); tokenRefreshInterval = null; }
    stopRealTelemetryHealthTimer();
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('../services/autoPauseMonitor').stopAutoPauseMonitor();
    } catch { /* monitor unavailable */ }
    networkMonitor.stop();
    sessionRecorder.stop();
    await batteryMonitor.stop().catch(() => {});
    const fenced = await persistBackgroundContext(null, false).catch(() => false);
    await pointIngestTail.catch(() => {});
    if (!fenced) {
      set({ locationAvailable: false, startError: 'initialization-failed' });
      return false;
    }
    await updateUnfinishedActivity(activity.ownerUserId, activity.sessionId, {
      nextSegmentStartReason: 'process-recovery',
      activeDurationMs: frozenLifecycle.activeDurationAccumulatedMs,
      activeSinceMs: null,
    });
    set({
      lastCoordinate: null,
      lastCoordinateTime: null,
      lastFixTimestamp: null,
      locationAvailable: false,
    });
    appendSimulatorLog('GPS_GAP', 'recording_interruption_forced', {
      gapReason: 'process-recovery',
      knownContinuityBreak: true,
    }, { userId: activity.ownerUserId, clientActivityId: activity.sessionId });
    appendSimulatorLog('ACTIVITY_RECOVERY', 'activity_parked_for_recovery', {
      resumeCreatesNewSegment: true,
    }, { userId: activity.ownerUserId, clientActivityId: activity.sessionId });
    return true;
  },

  suspendForUserSwitch: async () => {
    const activity = get();
    if (activity.status === 'idle' || !activity.sessionId) {
      stopActivityLifecycleTimer();
      deactivateForegroundSource();
      deactivateBackgroundSource();
      drainBackgroundLocations();
      const idleFence = await persistBackgroundContext(null, false).catch(() => false);
      if (!idleFence) throw new Error('activity_logout_background_fence_failed');
      set({ saveLostSessionId: null, saveLostPayload: null });
      return;
    }
    const frozenLifecycle = activity.status === 'tracking'
      ? lifecycleDurationPatch(activity)
      : null;
    stopActivityLifecycleTimer();
    if (frozenLifecycle) {
      set(frozenLifecycle);
      await updateUnfinishedActivity(String(activity.ownerUserId ?? ''), activity.sessionId, {
        activeDurationMs: frozenLifecycle.activeDurationAccumulatedMs,
        activeSinceMs: null,
      }).catch(() => false);
    }
    const clientActivityId = activity.sessionId;
    if (activity.locationProviderSource === 'simulator') {
      await endSimulatorProvider('account-switch').catch(() => {});
      simulatorSourceActive = false;
      appendSimulatorLog('ACCOUNT_OWNER', 'simulator_activity_owner_suspended', {
        lifecycle: activity.status,
      }, { userId: activity.ownerUserId, clientActivityId });
    }

    // Revoke visible/live ownership synchronously. The durable registry and
    // journal are deliberately untouched, so this is parking for account
    // isolation—not Activity discard.
    try { appStateSubscription?.remove(); } catch { /* no-op */ }
    appStateSubscription = null;
    try { locationSubscription?.remove(); } catch { /* no-op */ }
    locationSubscription = null;
    if (backgroundTaskActive && Location) {
      Location.stopLocationUpdatesAsync(BACKGROUND_LOCATION_TASK).catch(() => {});
      backgroundTaskActive = false;
    }
    if (drainInterval) { clearInterval(drainInterval); drainInterval = null; }
    if (dynamicSamplingInterval) { clearInterval(dynamicSamplingInterval); dynamicSamplingInterval = null; }
    if (incrementalFlushInterval) { clearInterval(incrementalFlushInterval); incrementalFlushInterval = null; }
    if (tokenRefreshInterval) { clearInterval(tokenRefreshInterval); tokenRefreshInterval = null; }
    stopRealTelemetryHealthTimer();
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { stopAutoPauseMonitor } = require('../services/autoPauseMonitor');
      stopAutoPauseMonitor();
    } catch { /* monitor unavailable */ }
    const backgroundFence = await persistBackgroundContext(null, false).catch(() => false);
    if (!backgroundFence) throw new Error('activity_logout_background_fence_failed');
    await pointIngestTail.catch(() => {});
    // Finish owns a captured A snapshot and may be persisting its local commit.
    // Keep A as the active store owner until that operation resolves, otherwise
    // its delayed UI/ACK work could race a newly started B Activity.
    if (activity.isFinishing) {
      const waitStartedAt = Date.now();
      while (
        get().isFinishing
        && get().sessionId === activity.sessionId
        && get().ownerUserId === activity.ownerUserId
      ) {
        if (Date.now() - waitStartedAt > 45_000) {
          throw new Error('activity_logout_finish_timeout');
        }
        await new Promise<void>((resolve) => setTimeout(resolve, 25));
      }
    }
    set({ ...initialState, activityMode: activity.activityMode });

    networkMonitor.stop();
    sessionRecorder.stop();
    await batteryMonitor.stop().catch(() => {});
    await debugLogger.endSession().catch(() => {});
    try {
      // Finish any writer replacement already in flight, but keep the active
      // file discoverable for the original owner.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { flushNow } = require('../services/hikeTrackWriter');
      await flushNow();
    } catch (error) {
      crashLogger.breadcrumb(`activity:user_switch_flush_failed id=${clientActivityId.slice(0, 8)} ${String(error).slice(0, 60)}`);
    }
  },

  discardCurrentSession: async () => {
    const discardEntry = get();
    if (discardEntry.status === 'idle' || !discardEntry.sessionId || discardEntry.isFinishing) return;
    const frozenLifecycle = discardEntry.status === 'tracking'
      ? lifecycleDurationPatch(discardEntry)
      : null;
    stopActivityLifecycleTimer();
    set({ ...(frozenLifecycle ?? {}), isFinishing: true });
    if (discardEntry.locationProviderSource === 'simulator') {
      pauseSimulatorProvider();
      simulatorSourceActive = false;
    }
    // Full teardown for too-short sessions when user taps "End anyway".
    // Mirrors the cleanup at the top of stopTracking() but without the
    // saved-session bookkeeping (no addSession, no name dialog).
    try { appStateSubscription?.remove(); } catch { /* no-op */ }
    appStateSubscription = null;
    try { locationSubscription?.remove(); } catch { /* no-op */ }
    locationSubscription = null;
    if (backgroundTaskActive && Location) {
      Location.stopLocationUpdatesAsync(BACKGROUND_LOCATION_TASK).catch(() => {});
      backgroundTaskActive = false;
    }
    if (drainInterval) { clearInterval(drainInterval); drainInterval = null; }
    if (dynamicSamplingInterval) { clearInterval(dynamicSamplingInterval); dynamicSamplingInterval = null; }
    if (incrementalFlushInterval) { clearInterval(incrementalFlushInterval); incrementalFlushInterval = null; }
    if (tokenRefreshInterval) { clearInterval(tokenRefreshInterval); tokenRefreshInterval = null; }
    stopRealTelemetryHealthTimer();
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { stopAutoPauseMonitor } = require('../services/autoPauseMonitor');
      stopAutoPauseMonitor();
    } catch { /* monitor unavailable */ }

    networkMonitor.stop();
    sessionRecorder.stop();
    const s = get();
    const ownerUserId = String(s.ownerUserId ?? '');
    if (!ownerUserId || String(useAppStore.getState().user?.id ?? '') !== ownerUserId) {
      throw new Error('activity_discard_owner_mismatch');
    }
    const discardFence = await persistBackgroundContext(null, false).catch(() => false);
    if (!discardFence) throw new Error('activity_discard_background_fence_failed');
    await pointIngestTail.catch(() => {});
    if (s.sessionId) {
      // Include headless points that are durable in the canonical journal but
      // have not yet been projected into the live Zustand snapshot.
      const { readActiveHikeTail } = require('../services/hikeTrackWriter');
      const acceptedPoints = await readActiveHikeTail(s.sessionId);
      for (const point of acceptedPoints) {
        await recordMemoryEvidence({
          lat: point.lat,
          lng: point.lng,
          atMs: point.t,
          source: 'reconciliation',
          ownerUserId,
        });
      }
    }
    // Persist cancellation before attempting any network or file cleanup.
    // A crash after this point cannot let stale queued work resurrect the
    // discarded business identity.
    if (s.sessionId) {
      await tombstoneActivity({
        userId: ownerUserId,
        clientActivityId: s.sessionId,
        serverActivityId: s.remoteSessionId,
      });
      try {
        const { removePending } = require('../services/pendingSyncStore');
        await removePending(s.sessionId, ownerUserId);
      } catch { /* pending queue may not be initialized */ }
    }
    await batteryMonitor.stop().catch(() => {});
    await debugLogger.endSession().catch(() => {});
    if (s.sessionId) {
      // Client-id cancellation is idempotent and also installs the server
      // tombstone. Numeric deletion remains a compatibility fallback.
      const cancelled = await deleteRemoteSessionByClientId(s.sessionId).catch(() => false);
      if (!cancelled && s.remoteSessionId) {
        await deleteRemoteSession(s.remoteSessionId).catch(() => false);
      }
    }
    // Tear down writer state and journal after tombstoning. Waiting for its
    // serialized write tail prevents an already-entered point commit from
    // recreating the discarded Activity.
    if (s.sessionId) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { discardActiveHike } = require('../services/hikeTrackWriter');
        await discardActiveHike(s.sessionId).catch(() => {});
      } catch { /* swallow — writer may not be loaded on web */ }
    }
    crashLogger.breadcrumb(`session:discard pts=${s.trackPoints.length}`);
    if (s.locationProviderSource === 'simulator') {
      appendSimulatorLog('ACTIVITY_COMPLETION', 'simulator_activity_discarded', {
        pointCount: s.trackPoints.length,
        distanceM: s.distanceM,
      }, { userId: ownerUserId, clientActivityId: s.sessionId });
      await endSimulatorProvider('discarded');
      simulatorSourceActive = false;
    } else {
      appendSimulatorLog('ACTIVITY_COMPLETION', 'activity_completion_finished', {
        stopReason: 'discarded',
        rawPointCount: s.trackPointsRaw.length,
        canonicalPointCount: s.trackPoints.length,
      }, {
        userId: ownerUserId,
        clientActivityId: s.sessionId,
        qaSessionId: realActivityQaSessionId,
        coordinateSource: 'none',
      });
      await emitRealTelemetryHealth('discarded');
      await endQaTelemetrySession(ownerUserId, 'real-activity-discarded');
      realActivityQaSessionId = null;
    }
    set({ ...initialState });
  },
}));

// ── Activity lifecycle clock ───────────────────────────────────────────────

function stopActivityLifecycleTimer(): void {
  if (!activityLifecycleInterval) return;
  clearInterval(activityLifecycleInterval);
  activityLifecycleInterval = null;
}

function lifecycleDurationPatch(
  state: Pick<TrackingState,
    | 'locationProviderSource'
    | 'activeDurationAccumulatedMs'
    | 'activeDurationStartedAtMs'>,
  wallClockTimestamp = Date.now(),
): Pick<TrackingState,
  | 'durationS'
  | 'activeDurationAccumulatedMs'
  | 'activeDurationStartedAtMs'> {
  const nowMs = activityFreshnessNow(state.locationProviderSource, wallClockTimestamp);
  const elapsedMs = calculateLifecycleDurationMs({
    accumulatedMs: state.activeDurationAccumulatedMs,
    activeSinceMs: state.activeDurationStartedAtMs,
    nowMs,
  });
  return {
    durationS: Math.floor(elapsedMs / 1000),
    activeDurationAccumulatedMs: elapsedMs,
    activeDurationStartedAtMs: null,
  };
}

function startActivityLifecycleTimer(clientActivityId: string): void {
  stopActivityLifecycleTimer();
  const tick = () => {
    const state = useTrackingStore.getState();
    if (
      state.status !== 'tracking'
      || state.isFinishing
      || state.sessionId !== clientActivityId
      || state.activeDurationStartedAtMs === null
    ) {
      stopActivityLifecycleTimer();
      return;
    }
    const nowMs = activityFreshnessNow(state.locationProviderSource);
    const durationS = Math.floor(calculateLifecycleDurationMs({
      accumulatedMs: state.activeDurationAccumulatedMs,
      activeSinceMs: state.activeDurationStartedAtMs,
      nowMs,
    }) / 1000);
    if (durationS !== state.durationS) useTrackingStore.setState({ durationS });
  };
  tick();
  // Recompute from the provider clock instead of incrementing a counter, so
  // JS timer suspension in background cannot lose Activity time.
  activityLifecycleInterval = setInterval(tick, 250);
}

// ── Source activation helpers (single-source guarantee) ────────────────────

/**
 * Serializes source activations to prevent TOCTOU races where two activations
 * concurrently observe `hasStartedLocationUpdatesAsync = false` and both call
 * `startLocationUpdatesAsync`, causing the second to throw.
 *
 * Each task is bounded by a 5s timeout so a stalled expo-location call (e.g.
 * during OS suspend) cannot block the whole queue indefinitely.
 */
let activationChain: Promise<void> = Promise.resolve();
function enqueueActivation(task: () => Promise<void>): Promise<void> {
  activationChain = activationChain.then(() =>
    Promise.race([
      task(),
      new Promise<void>((resolve) => setTimeout(resolve, 5000)),
    ]),
  ).catch((err) => {
    debugLogger.logError(err, 'enqueueActivation');
  });
  return activationChain;
}

/**
 * Start the foreground watcher, replacing any existing one.
 * Called when AppState transitions to 'active'.
 */
async function activateForegroundSource(): Promise<void> {
  const ownerAtActivation = useTrackingStore.getState();
  if (!ownerAtActivation.sessionId || !ownerAtActivation.liveOwnerGeneration) return;

  if (ownerAtActivation.locationProviderSource === 'simulator') {
    deactivateRealForegroundSource();
    deactivateRealBackgroundSource();
    simulatorSourceActive = activateSimulatorProvider(
      {
        clientActivityId: ownerAtActivation.sessionId,
        ownerGeneration: ownerAtActivation.liveOwnerGeneration,
        ownerUserId: String(ownerAtActivation.ownerUserId ?? ''),
        activityMode: ownerAtActivation.activityMode,
        segmentId: ownerAtActivation.currentSegmentId ?? newSegmentId(ownerAtActivation.sessionId),
        startedAt: ownerAtActivation.startedAt ?? Date.now(),
        acceptAfterMs: ownerAtActivation.lastFixTimestamp ?? ownerAtActivation.liveOwnerAcceptAfterMs,
      },
      (sample, sampleTimestamp) => useTrackingStore.getState().addTrackPoint(sample, sampleTimestamp),
      isSimulatorProviderBound(ownerAtActivation.sessionId)
        || ownerAtActivation.pendingSegmentStartReason === 'resume'
        || ownerAtActivation.pendingSegmentStartReason === 'process-recovery',
    );
    return;
  }
  simulatorSourceActive = false;
  if (!Location) return;
  // Module state is not durable across a jetsam/relaunch. Ask the native
  // provider itself before starting the foreground watcher so recovery can
  // never leave an OS-owned background stream running beside the new watcher.
  await stopRealBackgroundSourceForHandoff();
  // Tear down any existing foreground sub first
  try { locationSubscription?.remove(); } catch { /* no-op */ }
  locationSubscription = null;

  try {
    locationSubscription = await Location.watchPositionAsync(
      {
        accuracy: Location.Accuracy.BestForNavigation,
        timeInterval: lastSamplingIntervalMs,
        distanceInterval: 5,
      },
      (position) => {
        const ts = position.timestamp || Date.now();
        appendSimulatorLog('LOCATION', 'real_activity_location_callback', {
          sampleSource: 'foreground',
          sequenceTimestamp: Math.floor(ts),
          callbackWallTimestamp: Date.now(),
          accuracyM: position.coords.accuracy ?? null,
          verticalAccuracyM: position.coords.altitudeAccuracy ?? null,
          speedMps: position.coords.speed ?? null,
          courseValid: position.coords.heading != null && position.coords.heading >= 0,
          appState: AppState.currentState,
          ownerGenerationSuffix: ownerAtActivation.liveOwnerGeneration?.slice(-8) ?? null,
        }, {
          userId: ownerAtActivation.ownerUserId,
          clientActivityId: ownerAtActivation.sessionId,
          coordinateSource: 'real',
        });
        debugLogger.log({
          ts,
          event: 'gps_fix',
          lat: position.coords.latitude,
          lon: position.coords.longitude,
          accuracy_m: position.coords.accuracy ?? null,
          altitude_m: position.coords.altitude ?? null,
          altitude_accuracy_m: position.coords.altitudeAccuracy ?? null,
          speed_mps: position.coords.speed ?? null,
          heading_deg: position.coords.heading ?? null,
          raw_or_filtered: 'raw',
          source: 'foreground',
        });
        const ownerSessionId = ownerAtActivation.sessionId;
        const ownerGeneration = ownerAtActivation.liveOwnerGeneration;
        if (!ownerSessionId || !ownerGeneration) return;
        useTrackingStore.getState().addTrackPoint(
          {
            lat: position.coords.latitude,
            lng: position.coords.longitude,
            alt: position.coords.altitude,
            accuracy: position.coords.accuracy ?? null,
            speed: position.coords.speed ?? null,
            verticalAccuracy: position.coords.altitudeAccuracy ?? null,
            course: position.coords.heading ?? null,
            clientActivityId: ownerSessionId,
            ownerGeneration,
            segmentId: ownerAtActivation.currentSegmentId ?? undefined,
            source: 'foreground',
          },
          ts,
        );
      },
      (error) => {
        debugLogger.logError(error, 'watchPositionAsync:foreground');
        appendSimulatorLog('ERROR', 'real_activity_location_source_error', {
          sampleSource: 'foreground',
          errorCode: String(error).slice(0, 160),
        }, {
          userId: ownerAtActivation.ownerUserId,
          clientActivityId: ownerAtActivation.sessionId,
          coordinateSource: 'real',
        });
      },
    );
    appendSimulatorLog('PROVIDER', 'real_activity_location_source_activated', {
      sampleSource: 'foreground',
      requestedIntervalMs: lastSamplingIntervalMs,
      requestedDistanceM: 5,
    }, {
      userId: ownerAtActivation.ownerUserId,
      clientActivityId: ownerAtActivation.sessionId,
      coordinateSource: 'real',
    });
  } catch (err) {
    debugLogger.logError(err, 'activateForegroundSource');
    appendSimulatorLog('ERROR', 'real_activity_location_source_error', {
      sampleSource: 'foreground-activation',
      errorCode: String(err).slice(0, 160),
    }, {
      userId: ownerAtActivation.ownerUserId,
      clientActivityId: ownerAtActivation.sessionId,
      coordinateSource: 'real',
    });
  }
}

function deactivateForegroundSource(): void {
  deactivateRealForegroundSource();
}

function deactivateRealForegroundSource(): void {
  try { locationSubscription?.remove(); } catch { /* no-op */ }
  locationSubscription = null;
}

/**
 * Start the background TaskManager updates if permission was granted.
 * Idempotent — safe to call repeatedly.
 */
async function markRecordingContinuityUnavailable(reason: string): Promise<void> {
  const state = useTrackingStore.getState();
  if (
    state.status !== 'tracking'
    || state.locationProviderSource !== 'real'
    || !state.sessionId
    || !state.ownerUserId
  ) return;
  const tail = state.trackPoints[state.trackPoints.length - 1] as SegmentedTrackPoint | undefined;
  // With no accepted origin there is no false connector to break yet.
  if (!tail) {
    useTrackingStore.setState({ locationAvailable: false });
    return;
  }
  if (
    state.pendingSegmentStartReason === 'gps-reacquired'
    && state.currentSegmentId
    && state.currentSegmentId !== tail.segmentId
  ) return;

  const nextSegmentId = newSegmentId(state.sessionId, Date.now());
  // A known recording loss is a hard continuity boundary. The next trustworthy
  // fix starts fresh; neither route filtering, elevation nor Memory may infer a
  // connector from the old segment.
  if (realGpsCandidateTimer) clearTimeout(realGpsCandidateTimer);
  realGpsCandidateTimer = null;
  realGpsContinuityState = createRealGpsContinuityState();
  realElevationState = createElevationQualityState(state.elevationGainM);
  useTrackingStore.setState({
    currentSegmentId: nextSegmentId,
    pendingSegmentStartReason: 'gps-reacquired',
    // The old accepted coordinate cannot participate in teleport, distance,
    // elevation, or stationary checks after a known recording loss.
    lastCoordinate: null,
    locationAvailable: false,
  });
  await updateUnfinishedActivity(state.ownerUserId, state.sessionId, {
    currentSegmentId: nextSegmentId,
    nextSegmentStartReason: 'gps-reacquired',
  }).catch(() => false);
  appendSimulatorLog('ACTIVITY_STATE', 'activity_recording_gap_opened', {
    gapReason: reason,
    previousSegmentId: tail.segmentId,
    nextSegmentId,
  }, {
    userId: state.ownerUserId,
    clientActivityId: state.sessionId,
    coordinateSource: 'real',
  });
  appendSimulatorLog('GPS_SEGMENT', 'activity_segment_decision_v2', {
    decision: 'new-segment',
    trigger: reason,
    previousSegmentId: tail.segmentId,
    nextSegmentId,
    continuityAllowed: false,
    distanceContributionM: 0,
    elevationContributionM: 0,
    memoryBridgeAllowed: false,
  }, {
    userId: state.ownerUserId,
    clientActivityId: state.sessionId,
    qaSessionId: realActivityQaSessionId,
    coordinateSource: 'none',
  });
}

async function drainCommittedBackgroundLocations(committedBeforeFinish = false): Promise<number> {
  await settleBackgroundLocationWrites();
  const drained = drainBackgroundLocations().sort((a, b) => a.timestamp - b.timestamp);
  for (const coordinate of drained) {
    await useTrackingStore.getState().addTrackPoint({
      lat: coordinate.latitude,
      lng: coordinate.longitude,
      alt: coordinate.altitude,
      accuracy: coordinate.accuracy ?? null,
      speed: coordinate.speed ?? null,
      verticalAccuracy: coordinate.altitudeAccuracy ?? null,
      course: coordinate.heading ?? null,
      clientActivityId: coordinate.clientActivityId,
      ownerGeneration: coordinate.ownerGeneration,
      segmentId: coordinate.segmentId,
      segmentStartReason: coordinate.segmentStartReason,
      rawOrdinal: coordinate.rawOrdinal,
      continuityPreclassified: coordinate.continuityPreclassified,
      canonicalDecision: coordinate.canonicalDecision,
      decisionReason: coordinate.decisionReason,
      continuityStateAfter: coordinate.continuityStateAfter,
      source: 'background',
      committedBeforeFinish,
    }, coordinate.timestamp);
  }
  return drained.length;
}

async function stopRealBackgroundSourceForHandoff(): Promise<void> {
  if (!Location) return;
  const owner = useTrackingStore.getState();
  let nativeStarted = false;
  try {
    nativeStarted = backgroundTaskActive
      || await Location.hasStartedLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
    if (nativeStarted) await Location.stopLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
    appendSimulatorLog('PROVIDER', 'real_activity_background_task_stopped', {
      nativeWasStarted: nativeStarted,
      stopSucceeded: true,
      appState: AppState.currentState,
      ownerGenerationSuffix: owner.liveOwnerGeneration?.slice(-8) ?? null,
    }, {
      userId: owner.ownerUserId,
      clientActivityId: owner.sessionId,
      qaSessionId: realActivityQaSessionId,
      coordinateSource: 'real',
    });
    appendSimulatorLog('PROVIDER', 'activity_background_authority_v2', {
      phase: 'native-task-stop',
      nativeWasStarted: nativeStarted,
      stopSucceeded: true,
      appState: AppState.currentState,
      ownerGenerationSuffix: owner.liveOwnerGeneration?.slice(-8) ?? null,
    }, {
      userId: owner.ownerUserId,
      clientActivityId: owner.sessionId,
      qaSessionId: realActivityQaSessionId,
      coordinateSource: 'none',
    });
  } catch (error) {
    appendSimulatorLog('ERROR', 'real_activity_background_task_stopped', {
      nativeWasStarted: nativeStarted,
      stopSucceeded: false,
      errorCategory: String(error).slice(0, 120),
      appState: AppState.currentState,
    }, {
      userId: owner.ownerUserId,
      clientActivityId: owner.sessionId,
      qaSessionId: realActivityQaSessionId,
      coordinateSource: 'real',
    });
  }
  backgroundTaskActive = false;
}

async function transitionToForegroundSource(): Promise<void> {
  const owner = useTrackingStore.getState();
  appendSimulatorLog('PROVIDER', 'real_activity_foreground_takeover', {
    phase: 'started',
    appState: AppState.currentState,
    backgroundTaskActive,
    latestAcceptedAgeMs: owner.lastCoordinateTime === null
      ? null
      : Math.max(0, Date.now() - owner.lastCoordinateTime),
  }, {
    userId: owner.ownerUserId,
    clientActivityId: owner.sessionId,
    qaSessionId: realActivityQaSessionId,
    coordinateSource: 'real',
  });
  await stopRealBackgroundSourceForHandoff();
  const drainedCount = await drainCommittedBackgroundLocations();
  appendSimulatorLog('PROVIDER', 'real_activity_background_drain', {
    reason: 'foreground-takeover',
    drainedCount,
    ordered: true,
  }, {
    userId: owner.ownerUserId,
    clientActivityId: owner.sessionId,
    qaSessionId: realActivityQaSessionId,
    coordinateSource: 'real',
  });
  await refreshRealBackgroundAuthorization(false);
  await activateForegroundSource();
  const active = isCurrentLocationSourceActive();
  useTrackingStore.setState({ locationAvailable: active });
  appendSimulatorLog('PROVIDER', 'real_activity_foreground_takeover', {
    phase: 'completed',
    drainedCount,
    foregroundWatcherActive: Boolean(locationSubscription),
    backgroundTaskActive,
  }, {
    userId: owner.ownerUserId,
    clientActivityId: owner.sessionId,
    qaSessionId: realActivityQaSessionId,
    coordinateSource: 'real',
  });
}

async function activateBackgroundSource(): Promise<boolean> {
  const state = useTrackingStore.getState();
  if (state.locationProviderSource === 'simulator') {
    deactivateRealForegroundSource();
    deactivateRealBackgroundSource();
    simulatorSourceActive = activateSimulatorProvider(
      {
        clientActivityId: String(state.sessionId ?? ''),
        ownerGeneration: String(state.liveOwnerGeneration ?? ''),
        ownerUserId: String(state.ownerUserId ?? ''),
        activityMode: state.activityMode,
        segmentId: state.currentSegmentId ?? newSegmentId(state.sessionId ?? 'activity'),
        startedAt: state.startedAt ?? Date.now(),
        acceptAfterMs: state.lastFixTimestamp ?? state.liveOwnerAcceptAfterMs,
      },
      (sample, sampleTimestamp) => useTrackingStore.getState().addTrackPoint(sample, sampleTimestamp),
      isSimulatorProviderBound(state.sessionId)
        || state.pendingSegmentStartReason === 'resume'
        || state.pendingSegmentStartReason === 'process-recovery',
    );
    return simulatorSourceActive;
  }
  const granted = await refreshRealBackgroundAuthorization(false);
  if (!Location || !granted) {
    await stopRealBackgroundSourceForHandoff();
    appendSimulatorLog('PROVIDER', 'real_activity_background_source_unavailable', {
      unavailableReason: 'background-permission-not-granted',
    }, {
      userId: state.ownerUserId,
      clientActivityId: state.sessionId,
      coordinateSource: 'real',
    });
    return false;
  }
  // R114/O22 STORY-73003 (K10) breadcrumb: entry with permission +
  // interval snapshot. Enables us to reconstruct on-device why background
  // recording didn't produce points.
  crashLogger.breadcrumb(
    `k10:bg_activate_enter granted=${backgroundGrantedCached} interval_ms=${lastSamplingIntervalMs}`
  );
  try {
    appendSimulatorLog('PROVIDER', 'real_activity_background_registration_attempted', {
      permissionGranted: granted,
      cachedPermissionGranted: backgroundGrantedCached,
      appState: AppState.currentState,
      requestedIntervalMs: lastSamplingIntervalMs,
      ownerGenerationSuffix: state.liveOwnerGeneration?.slice(-8) ?? null,
    }, {
      userId: state.ownerUserId,
      clientActivityId: state.sessionId,
      qaSessionId: realActivityQaSessionId,
      coordinateSource: 'real',
    });
    appendSimulatorLog('PROVIDER', 'activity_background_authority_v2', {
      phase: 'registration-attempt',
      permissionGranted: granted,
      cachedPermissionGranted: backgroundGrantedCached,
      appState: AppState.currentState,
      requestedIntervalMs: lastSamplingIntervalMs,
      ownerGenerationSuffix: state.liveOwnerGeneration?.slice(-8) ?? null,
    }, {
      userId: state.ownerUserId,
      clientActivityId: state.sessionId,
      qaSessionId: realActivityQaSessionId,
      coordinateSource: 'none',
    });
    const taskRegistered = await registerBackgroundTask();
    if (!taskRegistered) throw new Error('background-task-registration-failed');
    const already = await Location.hasStartedLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
    // O43 leading, explicitly hypothesis-driven correction: repository evidence
    // shows repeated stop/start churn on lifecycle and sampling evaluations.
    // Reuse a verified native task instead of opening a delivery gap. The next
    // walk's registration/callback checkpoints will prove whether activation,
    // OS delivery, or a later layer is the actual background failure.
    if (!already) await Location.startLocationUpdatesAsync(BACKGROUND_LOCATION_TASK, {
      accuracy: Location.Accuracy.BestForNavigation,
      timeInterval: lastSamplingIntervalMs,
      distanceInterval: 5,
      showsBackgroundLocationIndicator: true,
      // R114/O22 STORY-73003 (K10) root cause hypothesis #2: default iOS
      // behavior pauses location updates whenever CoreLocation decides
      // the user is stationary (e.g. resting at a viewpoint). Without an
      // explicit resume trigger, "stopped" turns into "silent, forever".
      // Setting pausesUpdatesAutomatically=false keeps GPS active for
      // the whole hike. activityType=Fitness tells iOS this is walking/
      // running so power management is calibrated for that use case.
      pausesUpdatesAutomatically: false,
      activityType: Location.ActivityType.Fitness,
      foregroundService: {
        notificationTitle: 'Cairn is tracking',
        notificationBody: 'Recording your route in the background.',
        notificationColor: '#5d7c46',
      },
    });
    const verifiedStarted = await Location.hasStartedLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
    if (!verifiedStarted) throw new Error('background-task-start-not-observed');
    backgroundTaskActive = verifiedStarted;
    crashLogger.breadcrumb('k10:bg_activate_ok');
    appendSimulatorLog('PROVIDER', 'real_activity_background_registration_result', {
      taskRegistered,
      nativeAlreadyStarted: already,
      nativeVerifiedStarted: verifiedStarted,
      registrationSucceeded: true,
      appState: AppState.currentState,
    }, {
      userId: state.ownerUserId,
      clientActivityId: state.sessionId,
      qaSessionId: realActivityQaSessionId,
      coordinateSource: 'real',
    });
    appendSimulatorLog('PROVIDER', 'real_activity_background_task_started', {
      nativeReused: already,
      nativeVerifiedStarted: verifiedStarted,
      requestedIntervalMs: lastSamplingIntervalMs,
      requestedDistanceM: 5,
    }, {
      userId: state.ownerUserId,
      clientActivityId: state.sessionId,
      qaSessionId: realActivityQaSessionId,
      coordinateSource: 'real',
    });
    appendSimulatorLog('PROVIDER', 'activity_background_authority_v2', {
      phase: 'native-task-start-result',
      taskRegistered,
      nativeAlreadyStarted: already,
      nativeVerifiedStarted: verifiedStarted,
      startSucceeded: true,
      appState: AppState.currentState,
      ownerGenerationSuffix: state.liveOwnerGeneration?.slice(-8) ?? null,
    }, {
      userId: state.ownerUserId,
      clientActivityId: state.sessionId,
      qaSessionId: realActivityQaSessionId,
      coordinateSource: 'none',
    });
    appendSimulatorLog('PROVIDER', 'real_activity_location_source_activated', {
      sampleSource: 'background',
      requestedIntervalMs: lastSamplingIntervalMs,
      requestedDistanceM: 5,
    }, {
      userId: state.ownerUserId,
      clientActivityId: state.sessionId,
      coordinateSource: 'real',
    });
    useTrackingStore.setState({ locationAvailable: true });
    return true;
  } catch (err: any) {
    crashLogger.breadcrumb(`k10:bg_activate_err ${String(err?.message || err).slice(0, 80)}`);
    debugLogger.logError(err, 'activateBackgroundSource');
    appendSimulatorLog('ERROR', 'real_activity_location_source_error', {
      sampleSource: 'background-activation',
      errorCode: String(err?.message || err).slice(0, 160),
    }, {
      userId: state.ownerUserId,
      clientActivityId: state.sessionId,
      coordinateSource: 'real',
    });
    appendSimulatorLog('ERROR', 'real_activity_background_registration_result', {
      registrationSucceeded: false,
      appState: AppState.currentState,
      errorCategory: String(err?.message || err).slice(0, 120),
      cachedPermissionGranted: backgroundGrantedCached,
    }, {
      userId: state.ownerUserId,
      clientActivityId: state.sessionId,
      qaSessionId: realActivityQaSessionId,
      coordinateSource: 'real',
    });
    appendSimulatorLog('ERROR', 'activity_background_authority_v2', {
      phase: 'native-task-start-result',
      startSucceeded: false,
      appState: AppState.currentState,
      errorCategory: String(err?.message || err).slice(0, 120),
      cachedPermissionGranted: backgroundGrantedCached,
    }, {
      userId: state.ownerUserId,
      clientActivityId: state.sessionId,
      qaSessionId: realActivityQaSessionId,
      coordinateSource: 'none',
    });
    backgroundTaskActive = false;
    return false;
  }
}

function deactivateBackgroundSource(): void {
  deactivateRealBackgroundSource();
}

function deactivateRealBackgroundSource(): void {
  if (!Location) return;
  if (backgroundTaskActive) {
    Location.stopLocationUpdatesAsync(BACKGROUND_LOCATION_TASK).catch(() => {});
    backgroundTaskActive = false;
  }
}

function isCurrentLocationSourceActive(): boolean {
  return useTrackingStore.getState().locationProviderSource === 'simulator'
    ? simulatorSourceActive
    : Boolean(locationSubscription || backgroundTaskActive);
}

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Estimate current speed (m/s) from the last few track points.
 * Returns 0 if insufficient data.
 */
function estimateSpeed(points: TrackPoint[]): number {
  if (points.length < 2) return 0;
  const recent = points.slice(-5);
  let totalDist = 0;
  let totalTimeMs = 0;
  for (let i = 1; i < recent.length; i++) {
    totalDist += haversineM(recent[i - 1], recent[i]);
    totalTimeMs += recent[i].t - recent[i - 1].t;
  }
  if (totalTimeMs <= 0) return 0;
  return (totalDist / totalTimeMs) * 1000; // m/s
}
