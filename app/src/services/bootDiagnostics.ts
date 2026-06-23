/**
 * bootDiagnostics — capture cold-start crashes that happen BEFORE
 * appLog has a chance to debounce-flush.
 *
 * The v299 crash story:
 *   - h3-js was added in v298. Its 475 KB / 15.8k-line emscripten
 *     bundle must be parsed by Hermes at cold start. Hermes parser
 *     spike + Mapbox native init in the same RunLoop pushes RSS past
 *     iOS jetsam threshold → SIGKILL with NO log, NO crash report.
 *   - appLog uses 3s debounce → flush never fires in time.
 *   - crashLogger only catches JS errors via ErrorUtils → jetsam is
 *     an OS-level kill, not a JS error, so ErrorUtils never sees it.
 *
 * What this module does:
 *   1. On every cold start, BEFORE anything else, write a checkpoint
 *      to AsyncStorage saying "about to boot vXXX at TIMESTAMP".
 *   2. Send a fire-and-forget HTTP POST to the server with the same
 *      info. If the OS kills us 50 ms later, the server still has the
 *      boot beacon (network packet flushed to kernel before kill).
 *   3. Each boot phase calls `markPhase(name)` which BOTH:
 *      (a) updates the AsyncStorage checkpoint synchronously (best
 *          effort — RN AsyncStorage on iOS uses fast NSUserDefaults
 *          for short keys, so writes usually complete in a few ms).
 *      (b) fires another beacon to the server.
 *   4. On the NEXT cold start, drain the AsyncStorage checkpoint. If
 *      it didn't reach "boot_complete", report "previous boot died at
 *      <last phase>" to the server. This is how we know what step
 *      killed v298/v299.
 *
 * Why this is robust against jetsam:
 *   - Beacon = single fetch, no retry, no debounce. Headers sent
 *     immediately on next event loop tick.
 *   - Checkpoint = AsyncStorage write, fast path via NSUserDefaults.
 *   - Both run BEFORE Mapbox init / h3-js parse / any heavy module.
 *
 * Module rules (CRITICAL):
 *   - Only depend on `fetch` (global) and AsyncStorage. NO other imports.
 *   - Top-level body must be tiny (a few consts + function declarations).
 *   - All side effects gated behind explicit function calls.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

const CHECKPOINT_KEY = 'cairn_boot_checkpoint_v1';
const PREVIOUS_KEY = 'cairn_boot_checkpoint_previous_v1';
const BEACON_ENDPOINT = '/api/edit-diag';

const API_BASE_URL =
  (typeof process !== 'undefined' && process.env?.EXPO_PUBLIC_API_BASE_URL) ||
  'https://api.yiiling.cn';

const sessionId = `boot-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const sessionStart = Date.now();

interface BootCheckpoint {
  phase: string;
  ts: number;
  /** OTA version label written at boot — lets server tell which bundle the user is on. */
  ota_version?: number;
}

let lastPhase = 'init';

/**
 * Send a one-shot beacon to the server. Fire-and-forget; no awaiting.
 * If the OS kills the app right after this, the TCP packet has usually
 * already left the device by then.
 */
function fireBeacon(phase: string, extra?: Record<string, any>): void {
  try {
    const url = API_BASE_URL.replace(/\/$/, '') + BEACON_ENDPOINT;
    const body = JSON.stringify({
      kind: 'app_log',
      events: [
        {
          ts: Date.now(),
          tag: `boot.${phase}`,
          session_id: sessionId,
          device: { platform: Platform.OS, version: String(Platform.Version) },
          ctx: {
            ms_since_session_start: Date.now() - sessionStart,
            ...extra,
          },
        },
      ],
    });
    // Don't await — let it race with potential jetsam.
    void fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    }).catch(() => {/* ignore — best effort */});
  } catch {
    // catch synchronous failures (e.g. fetch unavailable on a broken JS env)
  }
}

/**
 * Mark a boot phase. Writes to AsyncStorage (for next-boot drain) AND
 * fires a beacon (for live diagnostics).
 */
export function markBootPhase(phase: string, extra?: Record<string, any>): void {
  lastPhase = phase;
  try {
    const cp: BootCheckpoint = { phase, ts: Date.now() };
    void AsyncStorage.setItem(CHECKPOINT_KEY, JSON.stringify(cp)).catch(() => {});
  } catch {/* ignore */}
  fireBeacon(phase, extra);
}

/**
 * Drain the previous boot's checkpoint. Call this at the START of
 * cold-start (after AsyncStorage is available, before any heavy init).
 * If the previous boot didn't reach 'boot_complete', report it.
 *
 * v300.1: rotates CHECKPOINT_KEY → PREVIOUS_KEY first, so that a
 * concurrent markBootPhase('module_loaded') that happened *before*
 * drain ran doesn't overwrite the previous boot's last-known phase.
 *
 * Returns nothing — fire-and-forget upload.
 */
export async function drainPreviousBootCheckpoint(otaVersion: number): Promise<void> {
  try {
    // Read whatever the OS preserved from the previous boot. If the previous
    // boot already finished a "rotation" via this function, the truly-previous
    // value is at PREVIOUS_KEY. Otherwise (first-ever boot or upgrade) read
    // the legacy CHECKPOINT_KEY which may also be empty.
    let raw = await AsyncStorage.getItem(PREVIOUS_KEY);
    if (!raw) {
      raw = await AsyncStorage.getItem(CHECKPOINT_KEY);
    }
    if (raw) {
      try {
        const cp = JSON.parse(raw) as BootCheckpoint;
        if (cp && cp.phase !== 'boot_complete') {
          // Previous boot didn't reach completion — likely jetsam'd or crashed
          // during render.
          fireBeacon('previous_boot_died', {
            previous_phase: cp.phase,
            previous_ts: cp.ts,
            ms_dead: Date.now() - cp.ts,
            ota_version: otaVersion,
          });
        } else if (cp) {
          // Optional: emit a "previous boot was healthy" beacon so we can
          // distinguish "clean restart" from "crash" in the dataset.
          fireBeacon('previous_boot_ok', {
            previous_phase: cp.phase,
            ota_version: otaVersion,
          });
        }
      } catch {/* parse error — best effort */}
    }
    // Clear both keys; the current boot's markBootPhase calls will repopulate
    // CHECKPOINT_KEY, and the next boot's rotateCheckpoint will move it to
    // PREVIOUS_KEY before drain runs.
    await AsyncStorage.removeItem(PREVIOUS_KEY);
    await AsyncStorage.removeItem(CHECKPOINT_KEY);
  } catch {/* ignore */}
}

/**
 * Rotate the checkpoint: copy CHECKPOINT_KEY (last boot's final phase) to
 * PREVIOUS_KEY before any markBootPhase of this boot overwrites it. Must run
 * BEFORE the very first markBootPhase of the current cold start.
 *
 * Synchronous "best effort" semantics: AsyncStorage is async, so we
 * fire-and-forget the read+write. Real serialization is impossible
 * pre-React. The data is good enough because the new module_loaded write
 * lands in CHECKPOINT_KEY, not PREVIOUS_KEY — so even if rotate hasn't
 * finished, drain (which reads PREVIOUS_KEY first) won't be racy.
 */
export function rotateCheckpoint(): void {
  void (async () => {
    try {
      const raw = await AsyncStorage.getItem(CHECKPOINT_KEY);
      if (raw) {
        await AsyncStorage.setItem(PREVIOUS_KEY, raw);
      }
    } catch {/* ignore */}
  })();
}

export function getBootSessionId(): string {
  return sessionId;
}

export function getLastBootPhase(): string {
  return lastPhase;
}
