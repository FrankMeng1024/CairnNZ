/**
 * appLog — universal client-side log uploader.
 *
 * **One method for the whole app.** Call `log(tag, payload?)` from any
 * feature; no per-feature setup, no service-of-the-month.
 *
 * Ordinary best-effort events remain backed by `/api/edit-diag`. A small,
 * explicit set of Memory/Fog/Mapbox lifecycle transitions is routed into the
 * owner-scoped durable automatic-diagnostics outbox instead, so those events
 * survive offline execution without a second caller-facing logging API.
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
 *     SELECT id, phase AS tag, step, outcome, diagnostic, received_at
 *       FROM debug_events_v2
 *      WHERE received_at > NOW() - INTERVAL 1 HOUR
 *      ORDER BY id DESC LIMIT 100;"
 *
 * Note: `phase` column stores the tag (v429 hotfix migrated from the
 * older edit_diagnostics table). `step` is the JSON context. `diagnostic`
 * has the payload. `kind` on the client wrapper is dropped server-side.
 */

import { AppState, Platform } from 'react-native';
import { API_BASE_URL } from '../config/api';
import { activitySimulatorBuildCapable } from '../features/activitySimulator/capability';
import { sanitizeTelemetryEventForUpload } from './telemetryPrivacy';

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
// Sprint 6 round-4 review R4B3 fix: track consecutive failures for the
// current head batch. After MAX_HEAD_FAILURES 5xx / network errors, drop
// the batch and move on — log-loss is preferable to log-inversion where
// stale head events keep replaying and newer events (describing the
// actual failure) get dropped by QUEUE_MAX.
let headFailures = 0;
const MAX_HEAD_FAILURES = 3;

const SESSION_ID = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
const DEVICE = { platform: Platform.OS, version: String(Platform.Version) };

const DURABLE_OWNER_EVENTS = new Set([
  'memory.tab_focus',
  'memory.tab_blur',
  'memory.last_fix_hydrated',
  'memory.permission_denied',
  'memory.gps_fix_unqualified',
  'memory.gps_fix_ok',
  'memory.gps_fix_failed',
  'memory.watcher_started',
  'memory.map_renderer_unavailable',
  'memory.map_loading_error',
  'memory.entry_visible_state',
  'memory_sync.attach_epoch_bump',
  'v357.tab_focus_entry',
  'v357.mapbox_willStartLoadingMap',
  'v357.mapbox_didFinishLoadingMap',
  'v357.mapbox_didFinishRenderingMapFully',
  'v357.fog_layer_mount',
  'v357.fog_layer_unmount',
  'fog.shape_built',
  'fog.shape_unavailable',
  'fog.shape_build_failed',
  'fog.buffer_failed',
  'fog.difference_failed',
  'fog.prepared_difference_failed',
  'fog.display_cache_read_failed',
  'fog.display_cache_write_failed',
  'plant.commit_attempt',
  'plant.commit_failed',
  'plant.commit_ok',
  'plant.post_commit_effect_failed',
  'plant.cancel',
  'plant.gps_window_start',
  'plant.gps_window_end',
  'plant.gps_permission_denied',
  'plant.gps_watcher_subscribe_error',
  'plant.gps_fusion_ok',
  'plant.gps_decision',
]);

function queueDurableOwnerEvent(tag: string, ctx: Record<string, unknown> | undefined): boolean {
  if (!DURABLE_OWNER_EVENTS.has(tag)) return false;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const owner = String(require('../store/useAppStore').useAppStore.getState().user?.id ?? '');
    if (!owner || owner === 'guest' || owner === 'unknown') return true;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { captureAutomaticDiagnosticEvent } = require('./automaticDiagnosticOutbox');
    void captureAutomaticDiagnosticEvent({
      ownerUserId: owner,
      stream: {
        streamId: tag.startsWith('plant.') ? `app:plant:${SESSION_ID}` : `memory:${SESSION_ID}`,
        sourceType: tag.startsWith('plant.') ? 'app' : 'memory',
        ...(tag.startsWith('plant.') ? {} : { memoryScopeId: SESSION_ID }),
      },
      eventCode: tag.toUpperCase().replace(/[^A-Z0-9_]/g, '_'),
      sourceModule: tag.startsWith('plant.')
        ? 'Plant'
        : tag.startsWith('fog.') || tag.startsWith('v357.fog') ? 'FogLayer' : 'Memory',
      severity: /failed|error|denied|unavailable|unqualified/.test(tag) ? 'warn' : 'info',
      details: { tag, ...(ctx ?? {}) },
    });
  } catch { /* durable diagnostics are fail-soft for product behavior */ }
  return true;
}

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
  (flushTimer as any)?.unref?.();
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
  // A binary that can create synthetic GPS Activities is a sealed QA realm.
  // Never let generic operational telemetry become an accidental production
  // export path for anything that happened in that process. Production builds
  // have the capability compiled off and retain their existing diagnostics.
  if (activitySimulatorBuildCapable) return;
  // Universal operational logs are never a synthetic-GPS export surface.
  // Fail private before data enters the in-memory queue: coordinates,
  // credentials, email addresses, and account identifiers are stripped.
  const safe = sanitizeTelemetryEventForUpload({ ctx });
  if (queueDurableOwnerEvent(tag, safe.ctx as Record<string, unknown> | undefined)) return;
  ensureAppStateListener();
  queue.push({
    tag,
    ts: Date.now(),
    session_id: SESSION_ID,
    ctx: safe.ctx as Record<string, any> | undefined,
    device: DEVICE,
  });
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
  if (activitySimulatorBuildCapable) {
    queue = [];
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    return;
  }
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
    (timer as any)?.unref?.();
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
        headFailures = 0;
        if (queue.length > 0) scheduleFlush();
      } else {
        // 5xx: increment head-failure counter. On MAX, drop the batch.
        headFailures += 1;
        if (headFailures >= MAX_HEAD_FAILURES) {
          queue = queue.slice(batch.length);
          headFailures = 0;
        }
      }
    } finally {
      clearTimeout(timer);
    }
  } catch {
    // Network / abort — same head-failure semantics as 5xx.
    headFailures += 1;
    if (headFailures >= MAX_HEAD_FAILURES) {
      queue = queue.slice(batch.length);
      headFailures = 0;
    }
  } finally {
    inFlight = false;
  }
}

// O1: getSessionId() removed — 0 external callers.
