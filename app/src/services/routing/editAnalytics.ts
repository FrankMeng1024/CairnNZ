/**
 * editAnalytics — telemetry events for Sprint 66 Route Edit feature.
 *
 * Wraps existing debugLogger to emit structured events that backend can
 * aggregate. Lazy-imports debugLogger so this is web-safe.
 *
 * O1 audit (2026-07-26): kept 7 functions with live callers in
 * useRouteEditStore. Pruned 12 functions that were declared in Sprint 66
 * Wave 8 but never wired into RouteEditorScreen:
 * logMidpointDragStarted, logMidpointDragCompleted, logRerouteRequested,
 * logRerouteCompleted, logRerouteFailed, logDualSourceDecision,
 * logEditOfflineBannerShown, logDocApiCall, logDocCacheHit,
 * logDijkstraDuration, logDragFps, logDijkstraNodeCountP95.
 */

type LogFn = (event: any) => void;

let debugLog: LogFn = () => {};
try {
  // Lazy require — debugLogger has its own platform gates
  const { debugLogger } = require('../debugLogger');
  debugLog = (e: any) => debugLogger.log(e);
} catch {
  // ignore
}

// edit_entered — fired when user opens the route editor screen.
export function logEditEntered(args: {
  routeId: string;
  trackPointCount: number;
  hasOriginalPoints: boolean;
  isLegacy: boolean;
}) {
  debugLog({ ts: Date.now(), event: 'edit_entered', ...args });
}

// edit_exited — fired when user leaves the editor (save/cancel/back).
export function logEditExited(args: {
  duration: number;
  edited: boolean;
  saved: boolean;
  cancelled: boolean;
}) {
  debugLog({ ts: Date.now(), event: 'edit_exited', ...args });
}

// trim_applied — fired on start/end trim in the editor.
export function logTrimApplied(args: { trimmedDistanceM: number; side: 'start' | 'end' }) {
  debugLog({ ts: Date.now(), event: 'trim_applied', ...args });
}

// edit_save — fired when a route edit is persisted.
export function logEditSave(args: {
  totalEdits: number;
  finalLengthM: number;
  originalLengthM: number;
  segmentCount: number;
}) {
  debugLog({ ts: Date.now(), event: 'edit_save', ...args });
}

// edit_start_duration — performance SLO: how long the editor took to
// become interactive after the user tapped Edit.
export function logEditStartDuration(args: { ms: number }) {
  debugLog({ ts: Date.now(), event: 'edit_start_duration', ...args });
}

// route_save_failure — fired on catch when persisting an edited route.
export function logRouteSaveFailure(args: { routeId: string; error: string }) {
  debugLog({ ts: Date.now(), event: 'route_save_failure', ...args });
}

// migrator_failure — fired when LegacyRouteMigrator returns { ok: false }.
export function logMigratorFailure(args: { routeId: string; error: string; retry: boolean }) {
  debugLog({ ts: Date.now(), event: 'migrator_failure', ...args });
}
