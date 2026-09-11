import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState } from 'react-native';
import { activitySimulatorBuildCapable } from './capability';
import { useActivitySimulatorStore } from './useActivitySimulatorStore';
import { useSettingsStore } from '../../store/useSettingsStore';

export type SimulatorLogCategory =
  | 'APP'
  | 'SCREEN'
  | 'DEBUG'
  | 'PROVIDER'
  | 'LOCATION'
  | 'SIM_SESSION'
  | 'SIM_INPUT'
  | 'SIM_POSITION'
  | 'SIM_SAMPLE'
  | 'MAP_STATE'
  | 'GPS_ACCEPT'
  | 'GPS_REJECT'
  | 'GPS_GAP'
  | 'GPS_SEGMENT'
  | 'ACTIVITY_STATE'
  | 'ACTIVITY_POINT'
  | 'ACTIVITY_METRICS'
  | 'ACTIVITY_RECOVERY'
  | 'ACTIVITY_COMPLETION'
  | 'MEMORY_EVIDENCE'
  | 'CAIRN_COMMIT'
  | 'CAIRN_ASSOCIATION'
  | 'SYNC_STATE'
  | 'SYNC_ACK'
  | 'SYNC_CLEANUP'
  | 'ACCOUNT_OWNER'
  | 'ERROR';

export interface SimulatorLogEvent {
  session_id: string;
  qaSessionId: string;
  timestamp: number;
  eventName: string;
  category: SimulatorLogCategory;
  simulatorSessionId: string | null;
  clientActivityIdSuffix: string | null;
  ownerSuffix: string | null;
  virtualTimestamp: number | null;
  wallClockTimestamp: number;
  timeScale: number;
  effectiveVirtualElapsed: number;
  sampleSequence: number;
  batchSequence: number;
  coordinateSource: 'simulator' | 'real' | 'none';
  debugMode: boolean;
  simulatorEnabled: boolean;
  providerSource: 'real' | 'simulator';
  trackingStatus: 'idle' | 'requesting' | 'tracking' | 'paused';
  fields: Record<string, unknown>;
}

const MAX_EVENTS_PER_SESSION = 2_000;
const MAX_BYTES_PER_SESSION = 512 * 1024;
const MAX_SESSIONS = 5;
// Real Activities may run for hours. Upload a complete bounded snapshot every
// two minutes and reserve enough attempts for a ten-hour diagnostic session;
// lifecycle/error transitions still request an immediate durable local flush.
const AUTO_UPLOAD_INTERVAL_MS = 120_000;
const MAX_CONSECUTIVE_UPLOAD_FAILURES = 5;
const MAX_AUTO_UPLOADS_PER_SESSION = 300;
const QA_LOCAL_RETENTION_MS = 24 * 60 * 60 * 1_000;
const INDEX_KEY = (userId: string) => `@cairn:activity_simulator_logs:index:v1:${userId}`;
const LOG_KEY = (userId: string, sessionId: string) =>
  `@cairn:activity_simulator_logs:v1:${userId}:${sessionId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 96)}`;
const UPLOAD_STATE_KEY = (userId: string, sessionId: string) =>
  `@cairn:activity_simulator_upload:v1:${userId}:${sessionId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 96)}`;
const FORBIDDEN_FIELD = /(access|refresh)?token|password|passcode|reset.?code|email|authorization|cookie|secret|api.?key/i;
const PRECISE_COORDINATE_FIELD = /(^|_)(lat|lng|lon|latitude|longitude|coordinate|coordinates)($|_)/i;

const memory = new Map<string, SimulatorLogEvent[]>();
const loads = new Map<string, Promise<SimulatorLogEvent[]>>();
const dirty = new Set<string>();
const dirtyOwners = new Map<string, { userId: string; sessionId: string }>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let writeTail: Promise<void> = Promise.resolve();
const uploadTimers = new Map<string, ReturnType<typeof setTimeout>>();
const uploadFailures = new Map<string, number>();
const uploadCounts = new Map<string, number>();
const uploadInProgress = new Set<string>();
const lastUploadAt = new Map<string, number>();
const appendTails = new Map<string, Promise<void>>();
const CRITICAL_EVENT_NAMES = new Set([
  'app_start',
  'app_foregrounded',
  'app_backgrounded',
  'app_inactive',
  'debug_mode_on',
  'debug_mode_off',
  'simulator_setting_changed',
  'simulator_setting_rejected',
  'qa_session_started',
  'qa_session_ended',
  'hike_opened',
  'hike_closed',
  'run_opened',
  'run_closed',
  'hike_map_mounted',
  'hike_map_unmounted',
  'run_map_mounted',
  'run_map_unmounted',
  'hike_map_style_load_started',
  'run_map_style_load_started',
  'hike_map_style_loaded',
  'run_map_style_loaded',
  'hike_map_loaded',
  'run_map_loaded',
  'hike_map_readiness_timeout',
  'run_map_readiness_timeout',
  'hike_map_loading_error',
  'run_map_loading_error',
  'hike_camera_fly_to_started',
  'run_camera_fly_to_started',
  'hike_camera_fly_to_completed',
  'run_camera_fly_to_completed',
  'hike_camera_fly_to_interrupted',
  'run_camera_fly_to_interrupted',
  'virtual_origin_selected',
  'virtual_origin_cleared',
  'simulator_fresh_setup_entry',
  'activity_provider_selected',
  'activity_start_requested',
  'activity_tracking_started',
  'activity_start_rejected',
  'activity_start_failed',
  'simulator_provider_locked',
  'simulator_first_sample_generated',
  'simulator_first_point_accepted',
  'simulator_first_point_committed',
  'real_callback_rejected_for_simulator_activity',
  'real_activity_location_source_activated',
  'activity_location_cadence_experiment_v1',
  'activity_location_lifecycle_plan_v1',
  'activity_sampling_metadata_updated_v1',
  'real_activity_background_registration_attempted',
  'real_activity_background_registration_result',
  'real_activity_background_task_started',
  'real_activity_background_task_stopped',
  'real_activity_background_callback_checkpoint',
  'real_activity_background_journal_result',
  'real_activity_background_drain',
  'real_activity_foreground_takeover',
  'background_location_authorization_refreshed',
  'real_activity_background_source_unavailable',
  'activity_candidate_transition_v1',
  'activity_journal_commit_v2',
  'activity_background_authority_v2',
  'activity_background_batch_v2',
  'activity_segment_decision_v2',
  'activity_match_preflight_v2',
  'activity_match_segment_v2',
  'activity_final_geometry_v2',
  'activity_telemetry_health_v2',
  'real_gps_filter_rejected',
  'candidate_created',
  'candidate_confirmed',
  'candidate_rejected',
  'candidate_timeout',
  'activity_recording_gap_opened',
  'elevation_gain_credited',
  'speed_preset_set',
  'custom_speed_set',
  'time_scale_set',
  'simulator_gps_state_changed',
  'simulator_gps_lost',
  'simulator_gps_restored',
  'altitude_model_set',
  'simulator_walking_route_requested',
  'simulator_walking_route_ready',
  'simulator_walking_route_failed',
  'simulator_manual_reacquisition_requested',
  'simulator_manual_reacquisition_committed',
  'simulator_manual_reacquisition_not_committed',
  'canonical_segment_changed',
  'simulator_rollback_requested',
  'simulator_rollback_completed',
  'activity_finish_requested',
  'activity_completion_finished',
  'activity_save_started',
  'activity_save_acknowledged',
  'activity_save_pending',
  'activity_sync_acknowledged',
  'simulator_activity_server_acknowledged',
  'activity_map_matching_started',
  'activity_map_matching_completed',
  'activity_map_matching_raw_fallback',
  'activity_map_matching_failed',
  'activity_map_matching_unavailable',
  'activity_deleted',
  'activity_rename_succeeded',
  'activity_rename_failed',
  'hike_cairn_location_selected',
  'run_quick_cairn_location_selected',
  'simulator_panel_opened',
  'simulator_panel_closed',
  'joystick_granted',
  'joystick_released',
  'joystick_terminated',
  'simulator_keep_awake_started',
  'simulator_keep_awake_stopped',
  'qa_upload_checkpoint',
  'qa_upload_failed',
]);
const SAMPLED_EVENT_NAMES = new Set([
  'simulator_sample_generated',
  'simulator_position_advanced',
  'canonical_gps_accepted',
  'canonical_gps_rejected',
  'location_sample_accepted',
  'location_sample_rejected',
  'activity_point_committed',
  'activity_metrics_derived',
  'activity_memory_evidence_committed',
]);

function isCriticalEvent(event: SimulatorLogEvent): boolean {
  return event.category === 'ERROR'
    || CRITICAL_EVENT_NAMES.has(event.eventName)
    || (event.eventName === 'activity_filter_decision_v2' && event.fields.decision !== 'ACCEPT')
    || (event.eventName === 'activity_elevation_decision_v1' && Number(event.fields.creditedDeltaM) > 0);
}

interface QaUploadState {
  uploadCount: number;
  consecutiveFailures: number;
  lastUploadAt: number;
  expiresAt: number;
}

async function loadQaUploadState(userId: string, qaSessionId: string, startedAt: number): Promise<QaUploadState> {
  try {
    const raw = await AsyncStorage.getItem(UPLOAD_STATE_KEY(userId, qaSessionId));
    const parsed = raw ? JSON.parse(raw) : {};
    const result = {
      uploadCount: Math.max(0, Math.floor(Number(parsed.uploadCount) || 0)),
      consecutiveFailures: Math.max(0, Math.floor(Number(parsed.consecutiveFailures) || 0)),
      lastUploadAt: Math.max(0, Number(parsed.lastUploadAt) || 0),
      expiresAt: startedAt + QA_LOCAL_RETENTION_MS,
    };
    uploadCounts.set(qaSessionId, result.uploadCount);
    uploadFailures.set(qaSessionId, result.consecutiveFailures);
    lastUploadAt.set(qaSessionId, result.lastUploadAt);
    return result;
  } catch {
    return {
      uploadCount: 0,
      consecutiveFailures: 0,
      lastUploadAt: 0,
      expiresAt: startedAt + QA_LOCAL_RETENTION_MS,
    };
  }
}

async function saveQaUploadState(userId: string, qaSessionId: string, state: QaUploadState): Promise<void> {
  uploadCounts.set(qaSessionId, state.uploadCount);
  uploadFailures.set(qaSessionId, state.consecutiveFailures);
  lastUploadAt.set(qaSessionId, state.lastUploadAt);
  await AsyncStorage.setItem(UPLOAD_STATE_KEY(userId, qaSessionId), JSON.stringify(state));
}

function suffix(value: string | null | undefined): string | null {
  if (!value) return null;
  return value.length <= 8 ? value : value.slice(-8);
}

function sanitizeValue(value: unknown, depth = 0): unknown {
  if (depth > 3) return '[truncated]';
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') return value.slice(0, 240);
  if (Array.isArray(value)) return value.slice(0, 24).map(item => sanitizeValue(item, depth + 1));
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value as Record<string, unknown>).slice(0, 48)) {
      if (FORBIDDEN_FIELD.test(key)) continue;
      out[key] = sanitizeValue(nested, depth + 1);
    }
    return out;
  }
  return String(value).slice(0, 240);
}

export function sanitizeSimulatorLogFields(fields: Record<string, unknown>): Record<string, unknown> {
  return sanitizeValue(fields) as Record<string, unknown>;
}

function redactPreciseCoordinates(value: unknown, depth = 0): unknown {
  if (depth > 4 || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(item => redactPreciseCoordinates(item, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (PRECISE_COORDINATE_FIELD.test(key)) continue;
    out[key] = redactPreciseCoordinates(nested, depth + 1);
  }
  return out;
}

/** Upload representation: real/unknown coordinates are removed fail-safe. */
export function serializeQaEventsForUpload(events: SimulatorLogEvent[]): string {
  return bounded(events).map((event) => JSON.stringify({
    ...event,
    fields: event.coordinateSource === 'simulator'
      ? event.fields
      : redactPreciseCoordinates(event.fields),
  })).join('\n');
}

function bounded(events: SimulatorLogEvent[]): SimulatorLogEvent[] {
  // Reserve lifecycle/decision evidence independently from the routine ring.
  // This is intentionally bounded: high-volume callbacks are coalesced below,
  // while the transitions needed to diagnose a failed walk survive churn.
  const protectedEvents = events.filter(isCriticalEvent).slice(-384);
  let result = events.length > MAX_EVENTS_PER_SESSION
    ? events.slice(events.length - MAX_EVENTS_PER_SESSION)
    : events;
  if (protectedEvents.length > 0) {
    const identities = new Set(result.map(event => `${event.timestamp}:${event.eventName}:${event.sampleSequence}`));
    result = [...protectedEvents.filter(event => !identities.has(`${event.timestamp}:${event.eventName}:${event.sampleSequence}`)), ...result]
      .sort((a, b) => a.timestamp - b.timestamp);
  }
  let serialized = JSON.stringify(result);
  while (serialized.length > MAX_BYTES_PER_SESSION && result.length > 1) {
    const nonCritical = result.findIndex(event => !isCriticalEvent(event));
    // Critical transitions survive ordinary high-volume sample churn, but the
    // diagnostic buffer is still a hard bound. Pathological critical-only
    // input drops its oldest entry instead of growing without limit.
    const removable = nonCritical >= 0 ? nonCritical : 0;
    result = [...result.slice(0, removable), ...result.slice(removable + 1)];
    serialized = JSON.stringify(result);
  }
  return result;
}

export function boundSimulatorLogEvents(events: SimulatorLogEvent[]): SimulatorLogEvent[] {
  return bounded(events);
}

/** Privacy-safe self-audit used by the terminal/periodic health watermark. */
export async function getQaTelemetryHealth(
  userId: string,
  qaSessionId: string,
): Promise<{
  retainedEventCount: number;
  retainedBytes: number;
  retainedCriticalCount: number;
  retainedObservationCount: number;
  retainedDecisionCount: number;
  uploadCount: number;
  consecutiveUploadFailures: number;
  lastUploadAt: number | null;
}> {
  const key = LOG_KEY(userId, qaSessionId);
  const pending = appendTails.get(key);
  if (pending) await pending.catch(() => undefined);
  const events = bounded(await loadSession(userId, qaSessionId));
  return {
    retainedEventCount: events.length,
    retainedBytes: serializeQaEventsForUpload(events).length,
    retainedCriticalCount: events.filter(isCriticalEvent).length,
    retainedObservationCount: events.filter(event => event.eventName === 'activity_observation_received_v2').length,
    retainedDecisionCount: events.filter(event => event.eventName === 'activity_filter_decision_v2').length,
    uploadCount: uploadCounts.get(qaSessionId) ?? 0,
    consecutiveUploadFailures: uploadFailures.get(qaSessionId) ?? 0,
    lastUploadAt: lastUploadAt.get(qaSessionId) ?? null,
  };
}

function scheduleFlush(): void {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flushSimulatorLogs();
  }, 1_500);
}

async function loadSession(userId: string, sessionId: string): Promise<SimulatorLogEvent[]> {
  const key = LOG_KEY(userId, sessionId);
  const existing = memory.get(key);
  if (existing) return existing;
  const inFlight = loads.get(key);
  if (inFlight) return inFlight;
  const load = (async () => {
    try {
      const raw = await AsyncStorage.getItem(key);
      const parsed = raw ? JSON.parse(raw) : [];
      const events = Array.isArray(parsed) ? parsed.slice(-MAX_EVENTS_PER_SESSION) : [];
      memory.set(key, events);
      return events;
    } catch {
      memory.set(key, []);
      return [];
    } finally {
      loads.delete(key);
    }
  })();
  loads.set(key, load);
  return load;
}

async function updateIndex(userId: string, sessionId: string): Promise<void> {
  let index: string[] = [];
  try {
    const raw = await AsyncStorage.getItem(INDEX_KEY(userId));
    const parsed = raw ? JSON.parse(raw) : [];
    if (Array.isArray(parsed)) index = parsed.filter(item => typeof item === 'string');
  } catch { /* use an empty index */ }
  index = [sessionId, ...index.filter(item => item !== sessionId)];
  const evicted = index.slice(MAX_SESSIONS);
  index = index.slice(0, MAX_SESSIONS);
  await AsyncStorage.setItem(INDEX_KEY(userId), JSON.stringify(index));
  for (const oldSession of evicted) {
    const oldKey = LOG_KEY(userId, oldSession);
    const timer = uploadTimers.get(oldSession);
    if (timer) clearTimeout(timer);
    memory.delete(oldKey);
    loads.delete(oldKey);
    dirty.delete(oldKey);
    dirtyOwners.delete(oldKey);
    uploadTimers.delete(oldSession);
    uploadFailures.delete(oldSession);
    uploadCounts.delete(oldSession);
    uploadInProgress.delete(oldSession);
    lastUploadAt.delete(oldSession);
    appendTails.delete(oldKey);
    await AsyncStorage.removeItem(oldKey);
    await AsyncStorage.removeItem(UPLOAD_STATE_KEY(userId, oldSession));
  }
}

/**
 * Internal-build QA logging. Callers must label coordinate provenance:
 * explicitly synthetic coordinates may be retained, while real/unknown
 * coordinates are stripped by both serialization and the shared uploader.
 */
export function appendSimulatorLog(
  category: SimulatorLogCategory,
  eventName: string,
  fields: Record<string, unknown> = {},
  context?: {
    userId?: string | null;
    clientActivityId?: string | null;
    simulatorSessionId?: string | null;
    qaSessionId?: string | null;
    virtualTimestamp?: number | null;
    coordinateSource?: 'simulator' | 'real' | 'none';
    force?: boolean;
  },
): void {
  const simulator = useActivitySimulatorStore.getState();
  const debugMode = useSettingsStore.getState().debugMode;
  if (!activitySimulatorBuildCapable) return;
  const userId = String(context?.userId ?? simulator.hydratedUserId ?? '');
  const qaSessionId = String(context?.qaSessionId ?? simulator.qaSessionId ?? '');
  if (!userId || !qaSessionId) return;
  if (!context?.force && simulator.qaSessionId === qaSessionId && simulator.qaSessionEndedAt !== null) return;
  if (
    SAMPLED_EVENT_NAMES.has(eventName)
    && context?.coordinateSource !== 'real'
    && simulator.sampleSequence > 3
    && simulator.sampleSequence % 10 !== 0
  ) return;
  const stationaryNoise = (
    eventName === 'simulator_sample_generated'
    || eventName === 'canonical_gps_rejected'
    || eventName === 'location_sample_rejected'
  ) && (
    fields.rejectionReason === 'stationary-suppressed'
    || (eventName === 'simulator_sample_generated'
      && Number(fields.emittedSpeedMps) === 0
      && !fields.joystickActive
      && !fields.autopilotActive)
  );
  if (stationaryNoise && simulator.sampleSequence > 1 && simulator.sampleSequence % 30 !== 0) return;
  let providerSource: 'real' | 'simulator' = 'real';
  let trackingStatus: SimulatorLogEvent['trackingStatus'] = 'idle';
  let trackedActivityId: string | null = null;
  try {
    // Lazy to avoid the TrackingStore -> simulatorLog initialization cycle.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const tracking = require('../../store/useTrackingStore').useTrackingStore.getState();
    providerSource = tracking.locationProviderSource === 'simulator' ? 'simulator' : 'real';
    trackingStatus = tracking.status;
    trackedActivityId = tracking.sessionId;
  } catch { /* pre-store app events use safe defaults */ }
  const simulatorSessionId = context?.simulatorSessionId ?? simulator.simulatorSessionId ?? null;
  const key = LOG_KEY(userId, qaSessionId);
  const event: SimulatorLogEvent = {
    session_id: qaSessionId,
    qaSessionId,
    timestamp: Date.now(),
    eventName: eventName.slice(0, 96),
    category,
    simulatorSessionId,
    clientActivityIdSuffix: suffix(context?.clientActivityId ?? trackedActivityId ?? simulator.boundActivityClientId ?? simulator.latestActivityClientId),
    ownerSuffix: suffix(userId),
    virtualTimestamp: context?.virtualTimestamp ?? simulator.virtualTimestampMs ?? null,
    wallClockTimestamp: Date.now(),
    timeScale: simulator.timeScale,
    effectiveVirtualElapsed: simulator.effectiveVirtualElapsedMs,
    sampleSequence: simulator.sampleSequence,
    batchSequence: simulator.batchSequence,
    coordinateSource: context?.coordinateSource
      ?? (category.startsWith('SIM_') || providerSource === 'simulator' ? 'simulator' : 'none'),
    debugMode,
    simulatorEnabled: simulator.enabled,
    providerSource,
    trackingStatus,
    fields: sanitizeSimulatorLogFields(fields),
  };
  // Multiple point-pipeline events are emitted in the same promise turn.
  // Serialize read/append so sibling events cannot all read the same old
  // array and overwrite one another (the O37 first-point telemetry loss).
  const priorAppend = appendTails.get(key) ?? Promise.resolve();
  const nextAppend = priorAppend.catch(() => undefined).then(async () => {
    await loadSession(userId, qaSessionId);
    const events = memory.get(key) ?? [];
    let nextEvents = events;
    const coalesceWindowMs = eventName.endsWith('_map_loading_error')
      || eventName.endsWith('_map_idle')
      ? 5_000
      : eventName === 'real_location_sample_observed'
        || eventName === 'real_activity_location_callback'
        || eventName === 'location_sample_accepted'
        || eventName === 'activity_point_committed'
        || eventName === 'activity_metrics_derived'
        || eventName === 'activity_memory_evidence_committed'
        || eventName === 'activity_journal_commit_v2'
        || eventName === 'activity_store_publish_v2'
        || eventName === 'elevation_decision_checkpoint'
        || eventName === 'elevation_quality_checkpoint'
        || eventName === 'activity_trace_map_source_update_requested'
        || eventName === 'activity_trace_state_received' ? 10_000 : 0;
    if (coalesceWindowMs > 0) {
      const previousIndex = events.findLastIndex(previous =>
        previous.eventName === eventName
        && previous.clientActivityIdSuffix === event.clientActivityIdSuffix
        && String(previous.fields.mountId ?? '') === String(event.fields.mountId ?? '')
        && String(previous.fields.phase ?? '') === String(event.fields.phase ?? '')
        && event.timestamp - previous.timestamp <= coalesceWindowMs,
      );
      if (previousIndex >= 0) {
        const previous = events[previousIndex];
        const currentSequenceTimestamp = Number(event.fields.sequenceTimestamp);
        const previousSequenceTimestamp = Number(previous.fields.sequenceTimestamp);
        const intervalMs = Number.isFinite(currentSequenceTimestamp)
          && Number.isFinite(previousSequenceTimestamp)
          ? Math.max(0, currentSequenceTimestamp - previousSequenceTimestamp)
          : null;
        const previousIntervals = Array.isArray(previous.fields.intervalSamplesMs)
          ? previous.fields.intervalSamplesMs.filter(value => Number.isFinite(Number(value))).map(Number)
          : [];
        event.fields = {
          ...event.fields,
          firstObservedAt: previous.fields.firstObservedAt ?? previous.timestamp,
          repeatCount: Number(previous.fields.repeatCount ?? 1) + 1,
          ...(Number.isFinite(Number(previous.fields.firstSequenceTimestamp))
            ? { firstSequenceTimestamp: Number(previous.fields.firstSequenceTimestamp) }
            : Number.isFinite(previousSequenceTimestamp)
              ? { firstSequenceTimestamp: previousSequenceTimestamp }
              : {}),
          ...(intervalMs === null
            ? {}
            : { intervalSamplesMs: [...previousIntervals, intervalMs].slice(-24) }),
        };
        nextEvents = [...events.slice(0, previousIndex), ...events.slice(previousIndex + 1)];
      }
    }
    memory.set(key, bounded([...nextEvents, event]));
    dirty.add(key);
    dirtyOwners.set(key, { userId, sessionId: qaSessionId });
    if (category === 'ERROR' || category === 'GPS_REJECT' || isCriticalEvent(event)) {
      void flushSimulatorLogs(userId);
    }
    else scheduleFlush();
  });
  appendTails.set(key, nextAppend);
  void nextAppend.finally(() => {
    if (appendTails.get(key) === nextAppend) appendTails.delete(key);
  });
}

export async function flushSimulatorLogs(requestedUserId?: string): Promise<void> {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  // Drain event appends before snapshotting `dirty`. Without this barrier an
  // app-background upload can serialize the preceding event while dropping
  // sibling events still waiting in the same JS promise turn.
  await Promise.all([...appendTails.values()].map(tail => tail.catch(() => undefined)));
  const entries = [...dirty]
    .map(key => ({ key, owner: dirtyOwners.get(key), events: bounded(memory.get(key) ?? []) }))
    .filter(entry => entry.owner && (!requestedUserId || entry.owner.userId === requestedUserId));
  if (entries.length === 0) return;
  const run = writeTail.then(async () => {
    for (const entry of entries) {
      await AsyncStorage.setItem(entry.key, JSON.stringify(entry.events));
      dirty.delete(entry.key);
      dirtyOwners.delete(entry.key);
      await updateIndex(entry.owner!.userId, entry.owner!.sessionId);
    }
  });
  writeTail = run.catch(() => {});
  await run;
  for (const entry of entries) {
    if (entry.owner) scheduleQaUpload(entry.owner.userId, entry.owner.sessionId);
  }
}

function scheduleQaUpload(userId: string, qaSessionId: string, immediate = false): void {
  if (!activitySimulatorBuildCapable || !useSettingsStore.getState().telemetryUploadEnabled) return;
  if ((uploadFailures.get(qaSessionId) ?? 0) >= MAX_CONSECUTIVE_UPLOAD_FAILURES) return;
  if ((uploadCounts.get(qaSessionId) ?? 0) >= MAX_AUTO_UPLOADS_PER_SESSION) return;
  const existing = uploadTimers.get(qaSessionId);
  if (existing) {
    if (!immediate) return;
    clearTimeout(existing);
  }
  const sinceLast = Date.now() - (lastUploadAt.get(qaSessionId) ?? 0);
  const delay = immediate ? 0 : Math.max(0, AUTO_UPLOAD_INTERVAL_MS - sinceLast);
  uploadTimers.set(qaSessionId, setTimeout(() => {
    uploadTimers.delete(qaSessionId);
    void uploadQaTelemetrySession(userId, qaSessionId, false);
  }, delay));
}

export async function uploadQaTelemetrySession(
  userId: string,
  qaSessionId: string,
  flushFirst = true,
): Promise<boolean> {
  if (!activitySimulatorBuildCapable || uploadInProgress.has(qaSessionId)) return false;
  uploadInProgress.add(qaSessionId);
  try {
    if (flushFirst) await flushSimulatorLogs(userId);
    const events = await loadSession(userId, qaSessionId);
    if (events.length === 0) return false;
    const uploadState = await loadQaUploadState(userId, qaSessionId, events[0]?.timestamp ?? Date.now());
    if (
      Date.now() > uploadState.expiresAt
      || uploadState.consecutiveFailures >= MAX_CONSECUTIVE_UPLOAD_FAILURES
      || uploadState.uploadCount >= MAX_AUTO_UPLOADS_PER_SESSION
    ) return false;
    uploadState.uploadCount += 1;
    uploadState.lastUploadAt = Date.now();
    await saveQaUploadState(userId, qaSessionId, uploadState);
    // Reuse the reviewed telemetry endpoint/uploader. This logger owns only
    // QA event production, local bounds, and privacy-safe serialization.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { telemetryUploader } = require('../../services/telemetryUploader');
    const result = await telemetryUploader.uploadQaSession({
      sessionId: qaSessionId,
      jsonl: serializeQaEventsForUpload(events),
      startedAt: events[0]?.timestamp ?? Date.now(),
      endedAt: useActivitySimulatorStore.getState().qaSessionEndedAt,
    });
    if (result.ok) {
      uploadState.consecutiveFailures = 0;
      await saveQaUploadState(userId, qaSessionId, uploadState);
      if (uploadState.uploadCount === 1 || uploadState.uploadCount % 5 === 0) {
        appendSimulatorLog('SYNC_STATE', 'qa_upload_checkpoint', {
          uploadCount: uploadState.uploadCount,
          localEventCount: events.length,
          uploadedBytes: result.bytes,
          bounded: events.length >= MAX_EVENTS_PER_SESSION
            || serializeQaEventsForUpload(events).length >= MAX_BYTES_PER_SESSION - 1024,
        }, { userId, qaSessionId, coordinateSource: 'none', force: true });
      }
      return true;
    }
    if (result.retryable) {
      uploadState.consecutiveFailures += 1;
    } else {
      uploadState.consecutiveFailures = MAX_CONSECUTIVE_UPLOAD_FAILURES;
    }
    await saveQaUploadState(userId, qaSessionId, uploadState);
    appendSimulatorLog('ERROR', 'qa_upload_failed', {
      uploadCount: uploadState.uploadCount,
      consecutiveFailures: uploadState.consecutiveFailures,
      retryable: result.retryable,
    }, { userId, qaSessionId, coordinateSource: 'none', force: true });
    return false;
  } catch {
    const events = await loadSession(userId, qaSessionId).catch(() => []);
    const state = await loadQaUploadState(userId, qaSessionId, events[0]?.timestamp ?? Date.now());
    state.consecutiveFailures += 1;
    await saveQaUploadState(userId, qaSessionId, state).catch(() => {});
    return false;
  } finally {
    uploadInProgress.delete(qaSessionId);
  }
}

export async function retryPendingQaTelemetryUploads(): Promise<void> {
  const state = useActivitySimulatorStore.getState();
  const userId = state.hydratedUserId;
  if (!userId) return;
  let index: string[] = [];
  try {
    const raw = await AsyncStorage.getItem(INDEX_KEY(userId));
    const parsed = raw ? JSON.parse(raw) : [];
    if (Array.isArray(parsed)) index = parsed.filter(item => typeof item === 'string').slice(0, MAX_SESSIONS);
  } catch { return; }
  for (const qaSessionId of index) scheduleQaUpload(userId, qaSessionId, true);
}

export function beginQaTelemetrySession(userId: string, forceNew = false): string | null {
  const qaSessionId = useActivitySimulatorStore.getState().beginQaSession(userId, forceNew);
  if (!qaSessionId) return null;
  appendSimulatorLog('APP', 'qa_session_started', {
    buildCapable: activitySimulatorBuildCapable,
  }, { userId, qaSessionId, coordinateSource: 'none', force: true });
  return qaSessionId;
}

export async function endQaTelemetrySession(userId: string, reason: string): Promise<string | null> {
  const state = useActivitySimulatorStore.getState();
  const qaSessionId = state.qaSessionId;
  if (!qaSessionId) return null;
  appendSimulatorLog('APP', 'qa_session_ended', { reason }, {
    userId,
    qaSessionId,
    coordinateSource: 'none',
    force: true,
  });
  state.endQaSession();
  await flushSimulatorLogs(userId);
  scheduleQaUpload(userId, qaSessionId, true);
  return qaSessionId;
}

export async function readSimulatorDiagnostics(userId: string): Promise<string> {
  await flushSimulatorLogs(userId);
  let index: string[] = [];
  try {
    const raw = await AsyncStorage.getItem(INDEX_KEY(userId));
    const parsed = raw ? JSON.parse(raw) : [];
    if (Array.isArray(parsed)) index = parsed.filter(item => typeof item === 'string').slice(0, MAX_SESSIONS);
  } catch { /* empty export */ }
  const lines: string[] = [];
  for (const sessionId of index) {
    const events = await loadSession(userId, sessionId);
    for (const event of events) lines.push(JSON.stringify(event));
  }
  return lines.join('\n');
}

export async function clearSimulatorLogs(userId: string): Promise<void> {
  await flushSimulatorLogs(userId);
  let index: string[] = [];
  try {
    const raw = await AsyncStorage.getItem(INDEX_KEY(userId));
    const parsed = raw ? JSON.parse(raw) : [];
    if (Array.isArray(parsed)) index = parsed.filter(item => typeof item === 'string');
  } catch { /* empty */ }
  for (const sessionId of index) {
    const key = LOG_KEY(userId, sessionId);
    memory.delete(key);
    loads.delete(key);
    dirty.delete(key);
    dirtyOwners.delete(key);
    const timer = uploadTimers.get(sessionId);
    if (timer) clearTimeout(timer);
    uploadTimers.delete(sessionId);
    uploadFailures.delete(sessionId);
    uploadCounts.delete(sessionId);
    uploadInProgress.delete(sessionId);
    appendTails.delete(key);
    lastUploadAt.delete(sessionId);
    await AsyncStorage.removeItem(key);
    await AsyncStorage.removeItem(UPLOAD_STATE_KEY(userId, sessionId));
  }
  await AsyncStorage.removeItem(INDEX_KEY(userId));
}

export const SIMULATOR_LOG_LIMITS = {
  maxEventsPerSession: MAX_EVENTS_PER_SESSION,
  maxBytesPerSession: MAX_BYTES_PER_SESSION,
  maxSessions: MAX_SESSIONS,
  autoUploadIntervalMs: AUTO_UPLOAD_INTERVAL_MS,
  maxConsecutiveUploadFailures: MAX_CONSECUTIVE_UPLOAD_FAILURES,
  maxAutoUploadsPerSession: MAX_AUTO_UPLOADS_PER_SESSION,
  localRetentionMs: QA_LOCAL_RETENTION_MS,
} as const;

AppState.addEventListener('change', state => {
  if (state === 'background' || state === 'inactive') {
    void flushSimulatorLogs().then(() => retryPendingQaTelemetryUploads());
  }
});
