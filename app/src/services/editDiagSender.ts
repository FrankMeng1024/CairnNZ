/**
 * editDiagSender.ts — best-effort telemetry uploader for v6.3 brush-edit.
 *
 * Plan §5 + §1.7. Sends per-edit diagnostic events to the yiiling
 * `/api/edit-diag` endpoint (verified live in V6_3_EDIT_DIAG_VERIFICATION.md).
 *
 * Contract:
 *   - Best-effort: failures NEVER block UI or throw to the caller.
 *   - Queued + debounced (5s) so a burst of gate failures doesn't spam.
 *   - Bounded queue (50 max) drops oldest on overflow — telemetry is
 *     sampled, not buffered indefinitely.
 *   - 429 response → batch goes back to head of queue, retried on next flush.
 *   - Other failures (network/5xx) → batch dropped (no retry storm).
 *   - AppState 'background' → immediate flush (defends against crash data loss).
 *   - Key events ('brush_save_committed', 'brush_mapbox_error') → immediate flush.
 *
 * No imports of brush-edit business code; pure transport. Unit-tested.
 */

import { AppState, type AppStateStatus } from 'react-native';
import { API_BASE_URL } from '../config/api';

// === Constants ==============================================================

export const EDIT_DIAG_PATH = '/api/edit-diag';
export const MAX_QUEUE_SIZE = 50;
export const MAX_BATCH_SIZE = 10;
export const FLUSH_DEBOUNCE_MS = 5_000;
export const FLUSH_REQUEST_TIMEOUT_MS = 3_000;

// === Event types ============================================================

/** All event kinds we emit. Mirror plan §5.3. */
export type TelemetryKind =
  | 'brush_preview_started'
  | 'brush_preview_completed'
  | 'brush_mapbox_attempt'
  | 'brush_gate_failure'
  | 'brush_undo'
  | 'brush_save_committed'
  | 'brush_mapbox_error'
  | 'brush_alt_dem_null'
  // v258 PO direction "穿楼直线" diag — see OtaBadge.tsx note for v258
  | 'brush_mapbox_response'
  | 'brush_splice_done'
  // v266: full raw data dump for offline analysis
  | 'brush_full_dump'
  | 'brush_final_dump';

/** Events that bypass the debounce timer (high-value or terminal events). */
const KEY_EVENTS: ReadonlyArray<TelemetryKind> = [
  'brush_save_committed',
  'brush_mapbox_error',
];

interface QueuedEvent {
  kind: TelemetryKind;
  payload: Record<string, unknown>;
  timestamp_ms: number;
}

// === Module state ===========================================================

const queue: QueuedEvent[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let inflight: Promise<void> | null = null;
let appStateSubscription: { remove(): void } | null = null;

// Lazy AppState subscription (only attached the first time sendEditDiag
// fires — keeps test setup simpler). Pre-mounted into the module for
// production convenience.
function ensureAppStateListener(): void {
  if (appStateSubscription !== null) return;
  if (typeof AppState === 'undefined' || typeof AppState.addEventListener !== 'function') {
    return; // jest jsdom or other no-RN env
  }
  appStateSubscription = AppState.addEventListener('change', (state: AppStateStatus) => {
    if (state === 'background' || state === 'inactive') {
      // Immediate flush on backgrounding. Crash recovery for telemetry: if
      // user kills app from the multitasker, we want save_committed events
      // to have made it to the server.
      cancelDebounce();
      void flushQueue();
    }
  });
}

function cancelDebounce(): void {
  if (flushTimer !== null) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
}

function scheduleDebouncedFlush(): void {
  if (flushTimer !== null) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flushQueue();
  }, FLUSH_DEBOUNCE_MS);
  // R6 C2: jest's worker process complains about a "leaked" timer that
  // outlives the test. unref keeps the timer functional for production
  // but lets the Node event loop exit if it's the only thing keeping
  // the process alive (no-op in RN where Timer.unref isn't implemented).
  if (flushTimer && typeof (flushTimer as any).unref === 'function') {
    (flushTimer as any).unref();
  }
}

// === Public API =============================================================

/**
 * Enqueue a telemetry event. Never throws. Never blocks.
 *
 * Behavior:
 *   - Pushes to queue (drops oldest if at MAX_QUEUE_SIZE)
 *   - Schedules a debounced flush (FLUSH_DEBOUNCE_MS) if not already scheduled
 *   - Key events trigger immediate flush instead of debouncing
 */
export function sendEditDiag(
  kind: TelemetryKind,
  payload: Record<string, unknown>,
): void {
  ensureAppStateListener();
  if (queue.length >= MAX_QUEUE_SIZE) {
    queue.shift(); // drop oldest
  }
  queue.push({ kind, payload, timestamp_ms: Date.now() });

  if (KEY_EVENTS.includes(kind)) {
    cancelDebounce();
    void flushQueue();
  } else {
    scheduleDebouncedFlush();
  }
}

/**
 * Force an immediate flush. Returns the in-flight promise so tests can await.
 * Production callers generally don't need this; sendEditDiag handles scheduling.
 */
export async function flushQueue(): Promise<void> {
  if (inflight !== null) return inflight;
  if (queue.length === 0) return;

  const batch = queue.splice(0, MAX_BATCH_SIZE);
  inflight = (async () => {
    const url = `${API_BASE_URL}${EDIT_DIAG_PATH}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FLUSH_REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ events: batch }),
        signal: controller.signal,
      });
      if (res.status === 429) {
        // Rate limited: put the batch back at the head of the queue so the
        // next flush picks it up. Honors the 60-req/5-min/IP server limit.
        queue.unshift(...batch);
      }
      // Other non-2xx: drop the batch silently. Telemetry is best-effort.
    } catch {
      // Network/timeout/abort: drop. No retry — avoids storms when offline.
    } finally {
      clearTimeout(timer);
    }
  })();

  try {
    await inflight;
  } finally {
    inflight = null;
  }
}

/** Test/teardown helper — clears queue + cancels timer + detaches AppState. */
export function _resetForTesting(): void {
  queue.length = 0;
  cancelDebounce();
  inflight = null;
  if (appStateSubscription) {
    try {
      appStateSubscription.remove();
    } catch {
      /* ignore */
    }
    appStateSubscription = null;
  }
}

/** Test helper — observe queue length without awaiting flush. */
export function _peekQueueLength(): number {
  return queue.length;
}
