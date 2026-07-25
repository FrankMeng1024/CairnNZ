/**
 * appLog — universal client-side log uploader.
 *
 * **One method for the whole app.** Call `log(tag, payload?)` from any
 * feature; no per-feature setup, no service-of-the-month.
 *
 * Backed by the existing `/api/edit-diag` endpoint (originally built
 * for v6.3 brush-edit, but the server schema is generic — `kind`
 * (varchar) + `payload` (JSON), with TTL cleanup + rate limit). We
 * piggyback so there is no migration / new table to maintain.
 *
 * Transport (mirrors editDiagSender's pattern, generalized):
 *   - Best-effort: never throws, never blocks UI.
 *   - Bounded queue (200 events), oldest dropped on overflow.
 *   - Debounced flush (3s) so a burst doesn't spam.
 *   - AppState 'background' / 'inactive' → immediate flush.
 *   - 5xx / network → batch dropped (no retry storm).
 *
 * Privacy:
 *   - Payload is small categorical/numeric context. Avoid PII.
 *   - sessionId is per app-launch (fresh on cold start), not stable.
 *
 * How to read logs (dev team):
 *   ssh root@122.51.174.118
 *   docker exec ainews-db mysql -uroot -p<pw> cairn -e "
 *     SELECT id, kind, JSON_EXTRACT(payload, '$.tag') AS tag,
 *            JSON_EXTRACT(payload, '$.session_id') AS session,
 *            uploaded_at, JSON_EXTRACT(payload, '$.ctx') AS ctx
 *       FROM edit_diagnostics
 *      WHERE kind = 'app_log' AND uploaded_at > NOW() - INTERVAL 1 HOUR
 *      ORDER BY uploaded_at DESC LIMIT 100;"
 */

import { AppState, Platform } from 'react-native';
import { API_BASE_URL } from '../config/api';

const ENDPOINT = '/api/edit-diag';
const FLUSH_DEBOUNCE_MS = 3_000;
const FLUSH_SIZE_THRESHOLD = 20;
const QUEUE_MAX = 200;
const MAX_BATCH = 50;
const REQUEST_TIMEOUT_MS = 5_000;

interface LogRecord {
  tag: string;
  ts: number;
  session_id: string;
  ctx?: Record<string, any>;
  device?: { platform: string; version: string };
}

let queue: LogRecord[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let inFlight = false;
let appStateAttached = false;

const SESSION_ID = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
const DEVICE = { platform: Platform.OS, version: String(Platform.Version) };

function ensureAppStateListener() {
  if (appStateAttached) return;
  appStateAttached = true;
  if (typeof AppState?.addEventListener !== 'function') return;
  AppState.addEventListener('change', (state) => {
    if (state === 'background' || state === 'inactive') {
      void flushNow();
    }
  });
}

function scheduleFlush() {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flushNow();
  }, FLUSH_DEBOUNCE_MS);
}

/**
 * Log a single event. Universal — use from ANY feature.
 *
 *   import { log } from 'app/src/services/appLog';
 *   log('plant.gps_decision', { ok: false, reason: 'no-readings' });
 *
 * @param tag dotted free-form string ('plant.gps_decision', 'memory.tab_open').
 * @param ctx small JSON context — categorical/numeric, no PII.
 */
export function log(tag: string, ctx?: Record<string, any>): void {
  ensureAppStateListener();
  queue.push({ tag, ts: Date.now(), session_id: SESSION_ID, ctx, device: DEVICE });
  if (queue.length > QUEUE_MAX) {
    queue.splice(0, queue.length - QUEUE_MAX);
  }
  if (queue.length >= FLUSH_SIZE_THRESHOLD) {
    void flushNow();
  } else {
    scheduleFlush();
  }
}

/** Force-upload now. Returns when the request settles (or aborts). */
export async function flushNow(): Promise<void> {
  if (inFlight) return;
  if (queue.length === 0) return;
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  const batch = queue.slice(0, MAX_BATCH);
  inFlight = true;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(`${API_BASE_URL}${ENDPOINT}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'app_log', events: batch }),
        signal: ctrl.signal,
      });
      // R2 fix (v287→v0.2.6.4): drop batch on success OR 4xx. Only
      // 5xx and network errors retain the batch for retry. 4xx will
      // never succeed on retry (validation, rate limit) — keeping it
      // queued causes a permanent retry storm against a known-bad
      // request.
      if (res.ok || (res.status >= 400 && res.status < 500)) {
        queue = queue.slice(batch.length);
        if (queue.length > 0) scheduleFlush();
      }
      // 5xx: keep batch, retry on next emit.
    } finally {
      clearTimeout(timer);
    }
  } catch {
    // Network / abort — keep queue, retry on next emit.
  } finally {
    inFlight = false;
  }
}

// O1: getSessionId() removed — 0 external callers.
