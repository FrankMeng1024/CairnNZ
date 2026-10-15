/**
 * Route-edit diagnostics compatibility facade.
 *
 * O81 deliberately removed the former automatic `/api/edit-diag` upload of
 * precise Route geometry and raw finger history. Route drawing evidence is now
 * opt-in, bounded, local-only, and exported only through an explicit Debug
 * action. The old function name remains so the mature editor can migrate its
 * many stage probes without a risky all-at-once rename.
 */

import {
  _resetRouteDrawingTraceForTesting,
  beginRouteDrawingTrace,
  clearRouteDrawingTraces,
  endRouteDrawingTrace,
  exportRouteDrawingTrace,
  getLatestRouteDrawingTrace,
  getRouteDrawingTrace,
  isRouteDrawingDiagnosticsEnabled,
  listRouteDrawingTraces,
  recordRouteDrawingTrace,
  replayRouteDrawingTrace,
  selectRouteDrawingOperation,
  setRouteDrawingDiagnosticsEnabled,
  traceToReplayFixture,
} from '../features/routeDrawing/routeDrawingTrace';

export type TelemetryKind =
  | 'brush_preview_started'
  | 'brush_preview_completed'
  | 'brush_mapbox_attempt'
  | 'brush_gate_failure'
  | 'brush_undo'
  | 'brush_save_committed'
  | 'brush_mapbox_error'
  | 'brush_alt_dem_null'
  | 'brush_mapbox_response'
  | 'brush_splice_done'
  | 'brush_full_dump'
  | 'brush_final_dump'
  | 'brush_begin'
  | 'brush_end'
  | 'brush_endpoint_magnet'
  | 'brush_raw_samples'
  | 'brush_point_added'
  | 'brush_eraser'
  | 'brush_reset'
  | 'brush_intent_decision'
  | 'brush_stabilized'
  | 'brush_cancelled'
  | 'route_draft_committed'
  | 'route_persisted'
  | 'route_persist_failed';

export function sendEditDiag(kind: TelemetryKind, payload: Record<string, unknown>): void {
  recordRouteDrawingTrace(kind, payload);
}

/** No transport remains. Kept as an async no-op for old test/dev callers. */
export async function flushQueue(): Promise<void> {
  return undefined;
}

export {
  beginRouteDrawingTrace,
  clearRouteDrawingTraces,
  endRouteDrawingTrace,
  exportRouteDrawingTrace,
  getLatestRouteDrawingTrace,
  getRouteDrawingTrace,
  isRouteDrawingDiagnosticsEnabled,
  listRouteDrawingTraces,
  replayRouteDrawingTrace,
  selectRouteDrawingOperation,
  setRouteDrawingDiagnosticsEnabled,
  traceToReplayFixture,
};

export function _resetForTesting(): void {
  _resetRouteDrawingTraceForTesting();
}

export function _peekQueueLength(): number {
  return getLatestRouteDrawingTrace()?.events.length ?? 0;
}
