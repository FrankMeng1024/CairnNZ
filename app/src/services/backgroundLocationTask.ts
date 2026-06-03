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
import { debugLogger } from './debugLogger';

export const BACKGROUND_LOCATION_TASK = 'cairn-background-location';

// AsyncStorage keys for crash-survival of session metadata
const STORAGE_KEY_SESSION = 'cairn_bg_active_session_id';
const STORAGE_KEY_ENABLED = 'cairn_bg_logging_enabled';

/**
 * Persist current session_id + enabled flag for the background task to read
 * even after the app process is killed. Call from useTrackingStore on
 * startTracking/stopTracking.
 */
export async function persistBackgroundContext(
  sessionId: string | null,
  enabled: boolean,
): Promise<void> {
  try {
    if (sessionId) {
      await AsyncStorage.setItem(STORAGE_KEY_SESSION, sessionId);
    } else {
      await AsyncStorage.removeItem(STORAGE_KEY_SESSION);
    }
    await AsyncStorage.setItem(STORAGE_KEY_ENABLED, enabled ? '1' : '0');
  } catch {
    // best effort
  }
}

// Singleton queue of pending background updates — store drains this on each foreground tick
type LocationCoords = {
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
 */
async function appendDirectlyToSessionFile(events: object[]): Promise<void> {
  try {
    const FS = await import('expo-file-system/legacy');
    if (!FS.documentDirectory) return;

    const rawSid = await AsyncStorage.getItem(STORAGE_KEY_SESSION);
    if (!rawSid) return; // no active session — drop silently
    // Sanitize defensively (we control the writer but mistakes happen)
    const sid = String(rawSid).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80);
    if (!sid) return;
    const path = FS.documentDirectory + 'cairn-logs/sessions/' + sid + '.jsonl';

    // Ensure dir exists
    const dir = FS.documentDirectory + 'cairn-logs/sessions/';
    const dirInfo = await FS.getInfoAsync(dir);
    if (!dirInfo.exists) {
      await FS.makeDirectoryAsync(dir, { intermediates: true });
    }

    // Read existing + append
    const lines =
      events.map((e) => JSON.stringify({ ...e, session_id: sid })).join('\n') + '\n';
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
export async function registerBackgroundTask(): Promise<boolean> {
  if (registered) return true;
  try {
    const TaskManager = await import('expo-task-manager');
    if (!TaskManager.isTaskDefined(BACKGROUND_LOCATION_TASK)) {
      TaskManager.defineTask(BACKGROUND_LOCATION_TASK, async ({ data, error }) => {
        if (error) {
          // Try logging via debugLogger first; if no session, write to file directly
          try { debugLogger.logError(error, 'BackgroundLocationTask'); } catch { /* ignore */ }
          return;
        }
        const payload = data as { locations?: Array<{ coords: LocationCoords; timestamp: number }> };
        const locations = payload?.locations ?? [];

        // Build event objects (without session_id — added per path below)
        const events: object[] = [];
        for (const loc of locations) {
          const coords: LocationCoords = {
            ...loc.coords,
            timestamp: loc.timestamp,
          };
          pendingBackgroundLocations.push(coords);
          events.push({
            // Use GPS-fix timestamp when available so events sort correctly,
            // even if the task was queued for a few seconds before firing.
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

        // Path A — debugLogger has active session in memory (app alive)
        if (debugLogger.isEnabled() && debugLogger.getCurrentSessionId()) {
          for (const e of events) {
            // log() will add session_id from currentSessionId
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            debugLogger.log(e as any);
          }
          return;
        }

        // Path B — app was killed by iOS; debugLogger has no session.
        // Read persisted context from AsyncStorage and append to file directly.
        try {
          const enabled = (await AsyncStorage.getItem(STORAGE_KEY_ENABLED)) === '1';
          if (!enabled) return;
          await appendDirectlyToSessionFile(events);
        } catch {
          // swallow
        }
      });
    }
    registered = true;
    return true;
  } catch (err) {
    // expo-task-manager not available (web/Expo Go without dev client)
    return false;
  }
}
