/**
 * BackgroundLocationTask — registers a TaskManager handler for expo-location
 * background updates. Critical: this MUST be registered at module load time
 * (before any startLocationUpdatesAsync call), so this file is imported by
 * App.tsx at top level.
 *
 * Behavior:
 *   - Pushes coords into pendingBackgroundLocations queue (read by useTrackingStore)
 *   - Logs `gps_fix` events via debugLogger (in-memory path)
 *   - **Fallback path**: if debugLogger has no active session (e.g. iOS killed
 *     the app and just woke this task to deliver a new GPS fix), the handler
 *     directly appends a JSONL line to the session file — using a session_id
 *     and enabled-flag persisted to AsyncStorage. This means we never lose
 *     background fixes even if app process died.
 *
 * iOS requires `UIBackgroundModes: ["location"]` (already set in app.json).
 *
 * Web fallback: import is no-op — TaskManager not available.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { debugLogger } from './debugLogger';
import { crashLogger } from './crashLogger';
import { newSegmentId, shouldStartNewSegment, type SegmentedTrackPoint } from '../features/activity/activityContracts';

export const BACKGROUND_LOCATION_TASK = 'cairn-background-location';

// R114/O22 STORY-73003 (K10): capture module-load timestamp so we can
// quantify the registration-lag hypothesis. If a `k10:task_fire` breadcrumb
// arrives with a timing shorter than this, iOS actually did wake us before
// registration completed — that would be a smoking gun.
const moduleLoadTs = Date.now();

// AsyncStorage keys for crash-survival of session metadata
const STORAGE_KEY_SESSION = 'cairn_bg_active_session_id';
// v409 fix #5: semantic rename — 老 key 'cairn_bg_logging_enabled' 语义
// 是"debug 是否开",现在语义应为"hike 是否 active"。v409 迁移在
// useAppStore.hydrate 里做:老 key 值若='1' 但无 active session
// (STORAGE_KEY_SESSION 空) → 清除,防止 stale flag 触发误 Path B 写盘。
const STORAGE_KEY_HIKE_ACTIVE = 'cairn_bg_hike_active';
// v409: 保留老 key 仅用于 hydrate 迁移检测,新写入统一用 HIKE_ACTIVE
const STORAGE_KEY_LEGACY_ENABLED = 'cairn_bg_logging_enabled';
const STORAGE_KEY_ACTIVITY_CONTEXT = 'cairn_bg_activity_context_v2';

export { STORAGE_KEY_SESSION, STORAGE_KEY_HIKE_ACTIVE, STORAGE_KEY_LEGACY_ENABLED, STORAGE_KEY_ACTIVITY_CONTEXT };

export interface DurableActivityContext {
  clientActivityId: string;
  userId: string;
  ownerGeneration: string;
  segmentId: string;
  activityMode: 'hiking' | 'running';
  /** Reject native batches sampled before this ownership generation began. */
  acceptAfterMs: number;
}

// The native callback and UI lifecycle can run on interleaved promise turns.
// Serialize the complete "validate live lease -> journal append" operation with
// lease mutation. Therefore Finish/Logout either waits for a commit that began
// before its fence, or disables the lease before the callback can validate.
let ownershipTail: Promise<void> = Promise.resolve();
async function withOwnershipBoundary<T>(operation: () => Promise<T>): Promise<T> {
  const prior = ownershipTail.catch(() => undefined);
  let release: () => void = () => undefined;
  ownershipTail = new Promise<void>((resolve) => { release = resolve; });
  await prior;
  try {
    return await operation();
  } finally {
    release();
  }
}

/**
 * Persist current session_id + hike-active flag for the background task
 * to read even after the app process is killed.
 *
 * v409 fix #5: hikeActive 语义 = "hike 正在进行(startTracking 后,stopTracking 前)",
 * 不再是 debug logger 的 enabled 状态。这样 iOS jetsam 后 native TaskManager
 * fire 时 Path B 能无条件写盘(gate 移除)。
 */
export async function persistBackgroundContext(
  sessionId: string | null,
  hikeActive: boolean,
  context?: DurableActivityContext | null,
): Promise<boolean> {
  return withOwnershipBoundary(async () => {
    try {
    if (hikeActive) {
      if (!sessionId || !context) return false;
      await AsyncStorage.setItem(STORAGE_KEY_SESSION, sessionId);
      await AsyncStorage.setItem(STORAGE_KEY_ACTIVITY_CONTEXT, JSON.stringify(context));
      // Enable last: a headless callback must never observe `active` before
      // the complete owner context is durable.
      await AsyncStorage.setItem(STORAGE_KEY_HIKE_ACTIVE, '1');
    } else {
      // Disable first: queued native callbacks are fenced before owner keys
      // are removed one by one.
      await AsyncStorage.setItem(STORAGE_KEY_HIKE_ACTIVE, '0');
      await AsyncStorage.removeItem(STORAGE_KEY_ACTIVITY_CONTEXT);
      await AsyncStorage.removeItem(STORAGE_KEY_SESSION);
    }
    // v409 fix #5 migration: 清老 key 避免 hydrate 时 stale 干扰
    if (!hikeActive) {
      try { await AsyncStorage.removeItem(STORAGE_KEY_LEGACY_ENABLED); } catch { /* ignore */ }
    }
      return true;
    } catch {
      if (!hikeActive) {
        // Removing descriptive owner keys is cleanup; the durable live bit is
        // the safety boundary. Retry that boundary once and report success only
        // when a callback can no longer consider the lease active.
        try {
          await AsyncStorage.setItem(STORAGE_KEY_HIKE_ACTIVE, '0');
          return (await AsyncStorage.getItem(STORAGE_KEY_HIKE_ACTIVE)) === '0';
        } catch { /* caller must fail closed */ }
      } else {
        // A partially written acquire must never inherit a prior `1` live bit.
        try { await AsyncStorage.setItem(STORAGE_KEY_HIKE_ACTIVE, '0'); } catch { /* caller fails closed */ }
      }
      return false;
    }
  });
}

// Singleton queue of pending background updates — store drains this on each foreground tick
export type LocationCoords = {
  latitude: number;
  longitude: number;
  altitude: number | null;
  accuracy: number | null;
  altitudeAccuracy: number | null;
  speed: number | null;
  heading: number | null;
  timestamp: number;
  clientActivityId?: string;
  ownerGeneration?: string;
  segmentId?: string;
  segmentStartReason?: 'start' | 'resume' | 'process-recovery' | 'gps-reacquired' | 'legacy';
};

const pendingBackgroundLocations: LocationCoords[] = [];

export function drainBackgroundLocations(): LocationCoords[] {
  if (pendingBackgroundLocations.length === 0) return [];
  return pendingBackgroundLocations.splice(0, pendingBackgroundLocations.length);
}

/**
 * Direct file-system append for the case when app process was killed and
 * TaskManager woke us up just to deliver a GPS fix. We bypass debugLogger
 * because its in-memory state is empty.
 *
 * v409 fix #6: 写到 cairn-hike-tracks/active/{sid}.jsonl (与 hikeTrackWriter
 * 同目录同文件),不再写到 cairn-logs/sessions/。这样 stopTracking 之后
 * 完整 tail 都在同一个文件,hydrate 补 replay 一次读齐。
 * gate 从 debugLogger.enabled 换成 STORAGE_KEY_HIKE_ACTIVE (语义换了)。
 */
async function appendDirectlyToHikeTrack(events: any[], context: DurableActivityContext): Promise<any[]> {
  try {
    // Runtime require avoids a module-load cycle while still sharing the same
    // canonical writer, transaction, schema, and mutex as foreground points.
    // It also works in TaskManager's constrained headless CommonJS runtime.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { appendBackgroundHikePoints, readActiveHikeTail } = require('./hikeTrackWriter');
    const tail = await readActiveHikeTail(context.clientActivityId);
    let previous = (tail[tail.length - 1] ?? null) as SegmentedTrackPoint | null;
    let activeSegmentId = previous?.segmentId ?? context.segmentId;
    const accepted: any[] = [];
    for (const event of events) {
      if (!Number.isFinite(event.lat) || !Number.isFinite(event.lng) || !Number.isFinite(event.t)) continue;
      // Native providers may deliver an old queued batch after Resume.  A
      // generation timestamp is necessary but not sufficient: within one
      // generation samples must also be strictly chronological.
      if (event.t < context.acceptAfterMs || (previous && event.t <= previous.t)) continue;
      if (event.acc != null && event.acc > 25) continue;
      if (context.activityMode === 'hiking' && event.speed != null && event.speed > 4.17) continue;
      const startsGap = shouldStartNewSegment({
        previous,
        next: { lat: event.lat, lng: event.lng, t: event.t, accuracy: event.acc ?? null },
        mode: context.activityMode,
      });
      if (startsGap) activeSegmentId = newSegmentId(context.clientActivityId, event.t);
      const point = {
        ...event,
        clientActivityId: context.clientActivityId,
        ownerGeneration: context.ownerGeneration,
        segmentId: activeSegmentId,
        ...(startsGap ? { segmentStartReason: 'gps-reacquired' as const } : {}),
      };
      accepted.push(point);
      previous = { ...point, accuracy: point.acc ?? null } as SegmentedTrackPoint;
    }
    if (accepted.length === 0) return [];
    await appendBackgroundHikePoints(accepted, context.userId);
    if (activeSegmentId !== context.segmentId) {
      await AsyncStorage.setItem(STORAGE_KEY_ACTIVITY_CONTEXT, JSON.stringify({ ...context, segmentId: activeSegmentId }));
    }
    return accepted;
  } catch (error) {
    crashLogger.breadcrumb(`activity:bg_journal_rejected ${String(error).slice(0, 80)}`);
    return [];
  }
}

let registered = false;

// R114/O22 STORY-73003 (K10) root cause hypothesis #1: register the
// TaskManager handler SYNCHRONOUSLY at module load time. iOS's docs
// require `defineTask` to be called before JS runtime is asked to
// dispatch — the previous `await import('expo-task-manager')` inside
// an async function created a microtask-gap window where headless wakes
// could arrive before registration completed. We now use a synchronous
// `require()` guarded by Platform check.
const handleBackgroundLocationTask = async ({ data, error }: { data: any; error: any }) => withOwnershipBoundary(async () => {
  crashLogger.breadcrumb(
    `k10:task_fire loc_count=${data?.locations?.length ?? 0} err=${error ? String(error).slice(0, 40) : 'none'} elapsed_ms=${Date.now() - moduleLoadTs}`
  );
  if (error) {
    try { debugLogger.logError(error, 'BackgroundLocationTask'); } catch { /* ignore */ }
    return;
  }
  const payload = data as { locations?: Array<{ coords: LocationCoords; timestamp: number }> };
  const locations = payload?.locations ?? [];
  let context: DurableActivityContext | null = null;
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY_ACTIVITY_CONTEXT);
    context = raw ? JSON.parse(raw) : null;
  } catch { context = null; }
  if (
    !context
    || typeof context.clientActivityId !== 'string'
    || typeof context.userId !== 'string'
    || typeof context.ownerGeneration !== 'string'
    || typeof context.segmentId !== 'string'
  ) return;
  context.activityMode = context.activityMode === 'running' ? 'running' : 'hiking';
  context.acceptAfterMs = Number.isFinite(context.acceptAfterMs) ? context.acceptAfterMs : 0;
  const hikeActive = (await AsyncStorage.getItem(STORAGE_KEY_HIKE_ACTIVE)) === '1';
  const activeSid = await AsyncStorage.getItem(STORAGE_KEY_SESSION);
  const hasActiveSid = !!activeSid;
  const legacyEnabled = (await AsyncStorage.getItem(STORAGE_KEY_LEGACY_ENABLED)) === '1';
  // A v2 owner context is accepted only with the v2 live bit. The historical
  // debug flag is inspected for diagnostics/migration, never as recording
  // authority after Finish or Logout has disabled the live lease.
  if (!hikeActive) return;
  if (activeSid !== context.clientActivityId) return;
  const events: object[] = [];
  for (const loc of locations) {
    const sampleTimestamp = loc.timestamp || Date.now();
    if (sampleTimestamp < (context.acceptAfterMs || 0)) {
      crashLogger.breadcrumb(`activity:bg_stale_sample_rejected t=${sampleTimestamp}`);
      continue;
    }
    const coords: LocationCoords = {
      ...loc.coords,
      timestamp: sampleTimestamp,
      clientActivityId: context.clientActivityId,
      ownerGeneration: context.ownerGeneration,
      segmentId: context.segmentId,
    };
    events.push({
      t: sampleTimestamp,
      lat: coords.latitude,
      lng: coords.longitude,
      acc: coords.accuracy,
      alt: coords.altitude,
      speed: coords.speed,
      src: 'bg',
      conf: 1,
    });
  }
  if (events.length === 0) return;
  if (debugLogger.isEnabled() && debugLogger.getCurrentSessionId()) {
    crashLogger.breadcrumb(`k10:path_a sid=${debugLogger.getCurrentSessionId()}`);
    for (const e of events) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      debugLogger.log(e as any);
    }
  }
  try {
    crashLogger.breadcrumb(
      `k10:path_b hikeActive=${hikeActive} hasSid=${hasActiveSid} legacy=${legacyEnabled}`
    );
    const accepted = await appendDirectlyToHikeTrack(events, context);
    for (const point of accepted) {
      pendingBackgroundLocations.push({
        latitude: point.lat,
        longitude: point.lng,
        altitude: point.alt ?? null,
        accuracy: point.acc ?? null,
        altitudeAccuracy: null,
        speed: point.speed ?? null,
        heading: null,
        timestamp: point.t,
        clientActivityId: point.clientActivityId,
        ownerGeneration: point.ownerGeneration,
        segmentId: point.segmentId,
        segmentStartReason: point.segmentStartReason,
      });
    }
    crashLogger.breadcrumb(`k10:path_b_write n=${accepted.length}`);
  } catch (e: any) {
    crashLogger.breadcrumb(`k10:path_b_err ${String(e?.message || e).slice(0, 60)}`);
  }
});

// Synchronous top-level registration. Guarded by Platform + try/catch so
// web / Expo Go without dev client don't crash on import.
if (Platform.OS === 'ios' || Platform.OS === 'android') {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const TaskManager = require('expo-task-manager');
    if (!TaskManager.isTaskDefined(BACKGROUND_LOCATION_TASK)) {
      TaskManager.defineTask(BACKGROUND_LOCATION_TASK, handleBackgroundLocationTask);
      registered = true;
      crashLogger.breadcrumb(`k10:register_sync_done elapsed_ms=${Date.now() - moduleLoadTs}`);
    }
  } catch (err: any) {
    crashLogger.breadcrumb(`k10:register_sync_err ${String(err?.message || err).slice(0, 60)}`);
  }
}

export async function registerBackgroundTask(): Promise<boolean> {
  // Kept for backward compat with callers that await this. The actual
  // registration already happened synchronously above at module load.
  if (registered) return true;
  try {
    const TaskManager = await import('expo-task-manager');
    if (!TaskManager.isTaskDefined(BACKGROUND_LOCATION_TASK)) {
      TaskManager.defineTask(BACKGROUND_LOCATION_TASK, handleBackgroundLocationTask);
    }
    registered = true;
    return true;
  } catch {
    return false;
  }
}
