/**
 * editAnalytics — 19 telemetry events for Sprint 66 Route Edit feature.
 *
 * Wraps existing debugLogger to emit structured events that backend can
 * aggregate. Lazy-imports debugLogger so this is web-safe.
 *
 * Sprint 66 Wave 8.
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

interface BaseEvent {
  ts: number;
}

// 1. edit_entered
export function logEditEntered(args: {
  routeId: string;
  trackPointCount: number;
  hasOriginalPoints: boolean;
  isLegacy: boolean;
}) {
  debugLog({ ts: Date.now(), event: 'edit_entered', ...args });
}

// 2. edit_exited
export function logEditExited(args: {
  duration: number;
  edited: boolean;
  saved: boolean;
  cancelled: boolean;
}) {
  debugLog({ ts: Date.now(), event: 'edit_exited', ...args });
}

// 3. trim_applied
export function logTrimApplied(args: { trimmedDistanceM: number; side: 'start' | 'end' }) {
  debugLog({ ts: Date.now(), event: 'trim_applied', ...args });
}

// 4. midpoint_drag_started
export function logMidpointDragStarted(args: { originalLat: number; originalLng: number }) {
  debugLog({ ts: Date.now(), event: 'midpoint_drag_started', ...args });
}

// 5. midpoint_drag_completed
export function logMidpointDragCompleted(args: {
  distanceFromOriginalM: number;
  withinCorridor: boolean;
}) {
  debugLog({ ts: Date.now(), event: 'midpoint_drag_completed', ...args });
}

// 6. reroute_requested
export function logRerouteRequested(args: { source: string; distanceM: number }) {
  debugLog({ ts: Date.now(), event: 'reroute_requested', ...args });
}

// 7. reroute_completed
export function logRerouteCompleted(args: {
  source: string;
  durationMs: number;
  success: boolean;
  fallbackUsed: boolean;
}) {
  debugLog({ ts: Date.now(), event: 'reroute_completed', ...args });
}

// 8. reroute_failed
export function logRerouteFailed(args: { source: string; errorCode: string; durationMs: number }) {
  debugLog({ ts: Date.now(), event: 'reroute_failed', ...args });
}

// 9. dual_source_decision
export function logDualSourceDecision(args: { chosen: string; reason: string; confidence: string }) {
  debugLog({ ts: Date.now(), event: 'dual_source_decision', ...args });
}

// 10. edit_save
export function logEditSave(args: {
  totalEdits: number;
  finalLengthM: number;
  originalLengthM: number;
  segmentCount: number;
}) {
  debugLog({ ts: Date.now(), event: 'edit_save', ...args });
}

// 11. edit_offline_banner_shown
export function logEditOfflineBannerShown(args: { duration: number }) {
  debugLog({ ts: Date.now(), event: 'edit_offline_banner_shown', ...args });
}

// 12. doc_api_call
export function logDocApiCall(args: {
  bboxArea: number;
  durationMs: number;
  featuresReturned: number;
  success: boolean;
}) {
  debugLog({ ts: Date.now(), event: 'doc_api_call', ...args });
}

// 13. doc_cache_hit
export function logDocCacheHit(args: { tileKey: string; age: number }) {
  debugLog({ ts: Date.now(), event: 'doc_cache_hit', ...args });
}

// 14-16. Performance SLO (review v3.1 §17 added)
export function logEditStartDuration(args: { ms: number }) {
  debugLog({ ts: Date.now(), event: 'edit_start_duration', ...args });
}

export function logDijkstraDuration(args: { nodeCount: number; edgeCount: number; ms: number }) {
  debugLog({ ts: Date.now(), event: 'dijkstra_duration', ...args });
}

export function logDragFps(args: { avgFps: number; minFps: number; sampleCount: number }) {
  debugLog({ ts: Date.now(), event: 'drag_fps', ...args });
}

// 17-19. Failure / migration / corridor (review v3.1 §17 build-out)
export function logRouteSaveFailure(args: { routeId: string; error: string }) {
  debugLog({ ts: Date.now(), event: 'route_save_failure', ...args });
}

export function logMigratorFailure(args: { routeId: string; error: string; retry: boolean }) {
  debugLog({ ts: Date.now(), event: 'migrator_failure', ...args });
}

export function logDijkstraNodeCountP95(args: { nodeCount: number }) {
  debugLog({ ts: Date.now(), event: 'dijkstra_node_count_p95', ...args });
}
