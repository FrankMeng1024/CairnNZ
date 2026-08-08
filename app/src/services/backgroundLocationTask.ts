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

export { STORAGE_KEY_SESSION, STORAGE_KEY_HIKE_ACTIVE, STORAGE_KEY_LEGACY_ENABLED };

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
): Promise<void> {
  try {
    if (sessionId) {
      await AsyncStorage.setItem(STORAGE_KEY_SESSION, sessionId);
    } else {
      await AsyncStorage.removeItem(STORAGE_KEY_SESSION);
    }
    await AsyncStorage.setItem(STORAGE_KEY_HIKE_ACTIVE, hikeActive ? '1' : '0');
    // v409 fix #5 migration: 清老 key 避免 hydrate 时 stale 干扰
    if (!hikeActive) {
      try { await AsyncStorage.removeItem(STORAGE_KEY_LEGACY_ENABLED); } catch { /* ignore */ }
    }
  } catch {
    // best effort
  }
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
async function appendDirectlyToHikeTrack(events: object[]): Promise<void> {
  try {
    const FS = await import('expo-file-system/legacy');
    if (!FS.documentDirectory) return;

    const rawSid = await AsyncStorage.getItem(STORAGE_KEY_SESSION);
    if (!rawSid) return; // no active session — drop silently
    const sid = String(rawSid).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80);
    if (!sid) return;

    const dir = FS.documentDirectory + 'cairn-hike-tracks/active/';
    const dirInfo = await FS.getInfoAsync(dir);
    if (!dirInfo.exists) {
      await FS.makeDirectoryAsync(dir, { intermediates: true });
    }
    const path = dir + sid + '.jsonl';

    // Read existing + append (still read-modify-write because expo-file-system
    // legacy has no native append; but each call is atomic-write within JS
    // callback, so at worst we lose the last chunk on kill mid-write).
    const lines = events.map((e) => JSON.stringify({ ...e, session_id: sid })).join('\n') + '\n';
    let existing = '';
    const info = await FS.getInfoAsync(path);
    if (info.exists) {
      existing = await FS.readAsStringAsync(path);
      // Cap at 50MB
      if (existing.length > 50 * 1024 * 1024) {
        existing = existing.slice(-30 * 1024 * 1024);
      }
    }
    await FS.writeAsStringAsync(path, existing + lines);
  } catch {
    // best effort
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
const handleBackgroundLocationTask = async ({ data, error }: { data: any; error: any }) => {
  crashLogger.breadcrumb(
    `k10:task_fire loc_count=${data?.locations?.length ?? 0} err=${error ? String(error).slice(0, 40) : 'none'} elapsed_ms=${Date.now() - moduleLoadTs}`
  );
  if (error) {
    try { debugLogger.logError(error, 'BackgroundLocationTask'); } catch { /* ignore */ }
    return;
  }
  const payload = data as { locations?: Array<{ coords: LocationCoords; timestamp: number }> };
  const locations = payload?.locations ?? [];
  const events: object[] = [];
  for (const loc of locations) {
    const coords: LocationCoords = {
      ...loc.coords,
      timestamp: loc.timestamp,
    };
    pendingBackgroundLocations.push(coords);
    events.push({
      ts: loc.timestamp || Date.now(),
      event: 'gps_fix',
      lat: coords.latitude,
      lon: coords.longitude,
      accuracy_m: coords.accuracy,
      altitude_m: coords.altitude,
      altitude_accuracy_m: coords.altitudeAccuracy,
      speed_mps: coords.speed,
      heading_deg: coords.heading,
      raw_or_filtered: 'raw',
      source: 'background',
    });
  }
  if (events.length === 0) return;
  if (debugLogger.isEnabled() && debugLogger.getCurrentSessionId()) {
    crashLogger.breadcrumb(`k10:path_a sid=${debugLogger.getCurrentSessionId()}`);
    for (const e of events) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      debugLogger.log(e as any);
    }
    return;
  }
  try {
    const hikeActive = (await AsyncStorage.getItem(STORAGE_KEY_HIKE_ACTIVE)) === '1';
    const hasActiveSid = !!(await AsyncStorage.getItem(STORAGE_KEY_SESSION));
    const legacyEnabled = (await AsyncStorage.getItem(STORAGE_KEY_LEGACY_ENABLED)) === '1';
    crashLogger.breadcrumb(
      `k10:path_b hikeActive=${hikeActive} hasSid=${hasActiveSid} legacy=${legacyEnabled}`
    );
    if (!hikeActive && !(legacyEnabled && hasActiveSid)) return;
    await appendDirectlyToHikeTrack(events);
    crashLogger.breadcrumb(`k10:path_b_write n=${events.length}`);
  } catch (e: any) {
    crashLogger.breadcrumb(`k10:path_b_err ${String(e?.message || e).slice(0, 60)}`);
  }
};

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
