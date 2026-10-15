import type { LngLat } from '../../services/routing/corridor/PolylineSampler';
import {
  resolveProviderOwnedLegacyGeometry,
  resolveRouteDrawing,
  type DrawingViewport,
  type RouteDrawingDecision,
} from './routeDrawingIntent';

const TRACE_VERSION = 2;
const MAX_TRACES = 8;
const MAX_EVENTS_PER_TRACE = 600;
const MAX_TRACE_BYTES = 2 * 1024 * 1024;
const MAX_ORIGINAL_ROUTE_BYTES = 1024 * 1024;

export type RouteDrawingTraceStage =
  | 'session'
  | 'raw-input'
  | 'projection'
  | 'geographic-stroke'
  | 'intent'
  | 'attachment'
  | 'stabilized'
  | 'provider-request'
  | 'provider-response'
  | 'selection'
  | 'commit'
  | 'persistence'
  | 'state';

export interface RouteDrawingTraceEvent {
  sequence: number;
  timestampMs: number;
  sessionId: string;
  operationId: string;
  stage: RouteDrawingTraceStage;
  kind: string;
  payload: Record<string, unknown>;
}

export interface RouteDrawingTrace {
  version: number;
  sessionId: string;
  routeId: string;
  source: { kind: 'route' | 'activity' | 'draft'; id: string | null };
  initialGeometryRevision: number | null;
  originalRoute: LngLat[];
  initialUndoDepth: number;
  startedAtMs: number;
  endedAtMs: number | null;
  events: RouteDrawingTraceEvent[];
  droppedEvents: number;
  approximateBytes: number;
  captureError: 'original-route-too-large' | null;
}

export interface RouteDrawingReplayFixture {
  fixtureVersion: 1;
  id: string;
  source: 'captured-redacted' | 'synthetic';
  originalRoute: LngLat[];
  rawStroke: LngLat[];
  providerGeometry: LngLat[] | null;
  viewport: DrawingViewport;
  recordedFinalGeometry?: LngLat[];
}

export interface RouteDrawingReplayResult {
  fixture: RouteDrawingReplayFixture;
  decision: RouteDrawingDecision;
  legacyGeometry: LngLat[];
  divergenceStage: RouteDrawingDecision['divergenceStage'];
  overlays: {
    originalRoute: LngLat[];
    rawStroke: LngLat[];
    providerCandidate: LngLat[];
    selectedReplacement: LngLat[];
    finalGeometry: LngLat[];
    recordedFinalGeometry: LngLat[];
  };
}

export interface RouteOperationReplayEvidence {
  operationId: string;
  kind: 'draw' | 'point' | 'session';
  outcome: 'committed' | 'rejected' | 'abandoned' | 'incomplete';
  divergenceStage: RouteDrawingTraceStage | null;
  reason: string | null;
  preStateGeometry: LngLat[];
  inputGeometry: LngLat[];
  providerGeometry: LngLat[];
  selectedGeometry: LngLat[];
  finalGeometry: LngLat[];
}

let enabled = false;
let activeSessionId: string | null = null;
let selectedOperationId: string | null = null;
let operationByStrokeId = new Map<string, string>();
const traces = new Map<string, RouteDrawingTrace>();

function clonePoints(value: unknown): LngLat[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap(item => {
    if (Array.isArray(item) && item.length >= 2
      && Number.isFinite(Number(item[0])) && Number.isFinite(Number(item[1]))) {
      return [{ lng: Number(item[0]), lat: Number(item[1]) }];
    }
    if (item && typeof item === 'object') {
      const point = item as Partial<LngLat>;
      if (Number.isFinite(point.lng) && Number.isFinite(point.lat)) {
        return [{ lng: Number(point.lng), lat: Number(point.lat), ...(point.alt == null ? {} : { alt: point.alt }) }];
      }
    }
    return [];
  });
}

function stageForKind(kind: string): RouteDrawingTraceStage {
  if (kind === 'brush_raw_samples' || kind === 'route_draw_raw_samples') return 'raw-input';
  if (kind === 'brush_point_added' || kind === 'route_draw_geographic_stroke') return 'geographic-stroke';
  if (kind === 'brush_end') return 'geographic-stroke';
  if (kind.includes('endpoint_magnet')) return 'attachment';
  if (kind.includes('mapbox_attempt') || kind === 'route_draw_provider_request') return 'provider-request';
  if (kind.includes('mapbox_response') || kind.includes('full_dump') || kind.includes('mapbox_error') || kind === 'route_draw_provider_response') return 'provider-response';
  if (kind.includes('intent')) return 'intent';
  if (kind.includes('stabilized')) return 'stabilized';
  if (kind.includes('final_dump') || kind.includes('splice_done')) return 'selection';
  if (kind.includes('save') || kind.includes('persist')) return 'persistence';
  if (kind.includes('undo') || kind.includes('reset') || kind.includes('eraser') || kind.includes('cancel')) return 'state';
  if (kind.includes('preview_completed')) return 'commit';
  return 'state';
}

function trimTrace(trace: RouteDrawingTrace): void {
  while (trace.events.length > MAX_EVENTS_PER_TRACE || trace.approximateBytes > MAX_TRACE_BYTES) {
    const removed = trace.events.shift();
    if (!removed) break;
    trace.approximateBytes = Math.max(0, trace.approximateBytes - JSON.stringify(removed).length);
    trace.droppedEvents += 1;
  }
}

function currentTrace(): RouteDrawingTrace | null {
  return activeSessionId ? traces.get(activeSessionId) ?? null : null;
}

export function setRouteDrawingDiagnosticsEnabled(next: boolean): void {
  if (!next && enabled && activeSessionId) endRouteDrawingTrace('detached');
  enabled = next;
  if (!next) {
    activeSessionId = null;
    selectedOperationId = null;
    operationByStrokeId = new Map();
  }
}

export function isRouteDrawingDiagnosticsEnabled(): boolean {
  return enabled;
}

export function beginRouteDrawingTrace(input: {
  sessionId: string;
  routeId: string;
  source: { kind: 'route' | 'activity' | 'draft'; id: string | null };
  initialGeometryRevision?: number | null;
  originalRoute: LngLat[];
  initialUndoDepth: number;
}): void {
  if (!enabled) return;
  if (activeSessionId) endRouteDrawingTrace('replaced');
  activeSessionId = input.sessionId;
  selectedOperationId = `${input.sessionId}:session`;
  operationByStrokeId = new Map();
  const originalRoute = input.originalRoute.map(point => ({ ...point }));
  const originalRouteBytes = JSON.stringify(originalRoute).length;
  const captureError = originalRouteBytes > MAX_ORIGINAL_ROUTE_BYTES
    ? 'original-route-too-large'
    : null;
  const trace: RouteDrawingTrace = {
    version: TRACE_VERSION,
    sessionId: input.sessionId,
    routeId: input.routeId,
    source: input.source,
    initialGeometryRevision: input.initialGeometryRevision ?? null,
    // An exact original is required for a trustworthy replay. If it cannot
    // fit inside the bounded buffer, retain an explicit error instead of a
    // deceptively partial geometry.
    originalRoute: captureError ? [] : originalRoute,
    initialUndoDepth: input.initialUndoDepth,
    startedAtMs: Date.now(),
    endedAtMs: null,
    events: [],
    droppedEvents: 0,
    approximateBytes: captureError ? 0 : originalRouteBytes,
    captureError,
  };
  traces.set(input.sessionId, trace);
  while (traces.size > MAX_TRACES) {
    const oldest = traces.keys().next().value;
    if (!oldest) break;
    traces.delete(oldest);
  }
  recordRouteDrawingTrace('route_session_started', {
    routeId: input.routeId,
    source: input.source,
    initialGeometryRevision: input.initialGeometryRevision ?? null,
    initialUndoDepth: input.initialUndoDepth,
    originalRoutePointCount: input.originalRoute.length,
    captureError,
  }, 'session');
}

export function endRouteDrawingTrace(reason: 'saved' | 'cancelled' | 'detached' | 'replaced'): void {
  if (!enabled) return;
  const trace = currentTrace();
  if (!trace) return;
  recordRouteDrawingTrace('route_session_ended', { reason }, 'session');
  trace.endedAtMs = Date.now();
  activeSessionId = null;
  selectedOperationId = null;
  operationByStrokeId = new Map();
}

export function selectRouteDrawingOperation(strokeId: string, kind: 'draw' | 'point' = 'draw'): string {
  const trace = currentTrace();
  if (!trace) return `disabled:${strokeId}`;
  const existing = operationByStrokeId.get(strokeId);
  if (existing) {
    selectedOperationId = existing;
    return existing;
  }
  const operationId = `${trace.sessionId}:${kind}:${strokeId}`;
  operationByStrokeId.set(strokeId, operationId);
  selectedOperationId = operationId;
  return operationId;
}

export function selectRouteDrawingSessionOperation(): string {
  const trace = currentTrace();
  selectedOperationId = trace ? `${trace.sessionId}:session` : null;
  return selectedOperationId ?? 'disabled:session';
}

export function recordRouteDrawingTrace(
  kind: string,
  payload: Record<string, unknown>,
  explicitStage?: RouteDrawingTraceStage,
): void {
  if (!enabled) return;
  const trace = currentTrace();
  if (!trace) return;
  const strokeId = typeof payload.strokeId === 'string' ? payload.strokeId : null;
  const operationId = strokeId
    ? selectRouteDrawingOperation(strokeId)
    : selectedOperationId ?? `${trace.sessionId}:session`;
  const event: RouteDrawingTraceEvent = {
    sequence: trace.events.length + trace.droppedEvents,
    timestampMs: Date.now(),
    sessionId: trace.sessionId,
    operationId,
    stage: explicitStage ?? stageForKind(kind),
    kind,
    payload,
  };
  trace.events.push(event);
  trace.approximateBytes += JSON.stringify(event).length;
  trimTrace(trace);
}

export function listRouteDrawingTraces(): RouteDrawingTrace[] {
  return [...traces.values()].sort((a, b) => b.startedAtMs - a.startedAtMs);
}

export function getRouteDrawingTrace(sessionId: string): RouteDrawingTrace | null {
  return traces.get(sessionId) ?? null;
}

export function getLatestRouteDrawingTrace(): RouteDrawingTrace | null {
  return listRouteDrawingTraces()[0] ?? null;
}

export function exportRouteDrawingTrace(sessionId?: string): string | null {
  const trace = sessionId ? getRouteDrawingTrace(sessionId) : getLatestRouteDrawingTrace();
  return trace ? JSON.stringify(trace, null, 2) : null;
}

/** Parse an explicitly imported local export without adding it to live capture. */
export function parseRouteDrawingTrace(serialized: string): RouteDrawingTrace | null {
  if (serialized.length > MAX_TRACE_BYTES + MAX_ORIGINAL_ROUTE_BYTES + 128 * 1024) return null;
  try {
    const value = JSON.parse(serialized) as Partial<RouteDrawingTrace>;
    if ((value.version !== 1 && value.version !== TRACE_VERSION)
      || typeof value.sessionId !== 'string'
      || !Array.isArray(value.originalRoute)
      || !Array.isArray(value.events)) return null;
    return value as RouteDrawingTrace;
  } catch {
    return null;
  }
}

export function clearRouteDrawingTraces(): void {
  traces.clear();
  activeSessionId = null;
  selectedOperationId = null;
  operationByStrokeId = new Map();
}

function eventFor(trace: RouteDrawingTrace, kind: string, operationId?: string): RouteDrawingTraceEvent | null {
  return [...trace.events].reverse().find(event =>
    event.kind === kind && (!operationId || event.operationId === operationId),
  ) ?? null;
}

export function listRouteDrawingOperationIds(trace: RouteDrawingTrace): string[] {
  const grouped = new Map<string, RouteDrawingTraceEvent[]>();
  for (const event of trace.events) {
    const current = grouped.get(event.operationId) ?? [];
    current.push(event);
    grouped.set(event.operationId, current);
  }
  return [...grouped.entries()]
    .flatMap(([operationId, events]) => {
      if (!operationId.endsWith(':session')) return [{ operationId, sequence: events[0]?.sequence ?? 0 }];
      const lifecycle = events.find(event => event.kind === 'route_creation_abandoned');
      return lifecycle ? [{ operationId, sequence: lifecycle.sequence }] : [];
    })
    .sort((a, b) => a.sequence - b.sequence)
    .map(item => item.operationId);
}

export function replayRouteOperationEvidence(
  trace: RouteDrawingTrace,
  requestedOperationId?: string,
): RouteOperationReplayEvidence | null {
  const operationId = requestedOperationId ?? listRouteDrawingOperationIds(trace).at(-1)
    ?? (trace.events.some(event => event.kind === 'route_creation_abandoned') ? `${trace.sessionId}:session` : null);
  if (!operationId) return null;
  const events = trace.events.filter(event => event.operationId === operationId);
  const find = (kind: string) => [...events].reverse().find(event => event.kind === kind) ?? null;
  const pointRequest = find('route_point_provider_request');
  const drawInput = find('route_draw_geographic_stroke') ?? find('brush_end');
  const drawIntent = find('route_draw_transaction_intent');
  const provider = find('route_point_provider_response') ?? find('route_draw_provider_response') ?? find('brush_full_dump');
  const selected = find('route_point_candidate_selected') ?? find('route_draw_intent_decision') ?? find('brush_intent_decision');
  const rejected = find('route_draw_rejected') ?? find('route_draw_ambiguous');
  const committed = find('route_draw_commit');
  const abandoned = find('route_creation_abandoned');
  const kind = pointRequest ? 'point' : drawInput ? 'draw' : 'session';
  const outcome = committed ? 'committed' : rejected ? 'rejected' : abandoned ? 'abandoned' : 'incomplete';
  const reasonValue = rejected?.payload.code ?? rejected?.payload.reason
    ?? selected?.payload.reason ?? abandoned?.payload.reason ?? null;
  return {
    operationId,
    kind,
    outcome,
    divergenceStage: rejected?.stage ?? selected?.stage ?? null,
    reason: reasonValue == null ? null : String(reasonValue),
    preStateGeometry: clonePoints(pointRequest?.payload.preStateGeometry
      ?? drawIntent?.payload.preStateGeometry
      ?? trace.originalRoute),
    inputGeometry: clonePoints(pointRequest ? [pointRequest.payload.start, pointRequest.payload.target] : drawInput?.payload.rawPoints),
    providerGeometry: clonePoints(provider?.payload.providerGeometry ?? provider?.payload.stitched_curve_full),
    selectedGeometry: clonePoints(selected?.payload.selectedGeometry
      ?? selected?.payload.selectedReplacement
      ?? selected?.payload.finalGeometry),
    finalGeometry: clonePoints(committed?.payload.finalGeometry
      ?? rejected?.payload.unchangedFinalGeometry
      ?? abandoned?.payload.finalGeometry),
  };
}

function viewportFromSamples(event: RouteDrawingTraceEvent | null): DrawingViewport {
  const payload = event?.payload ?? {};
  const samples = Array.isArray(payload.samples) ? payload.samples as Array<Record<string, unknown>> : [];
  const sample = samples.find(item => Number.isFinite(item.zoom) && Number.isFinite(item.cLng) && Number.isFinite(item.cLat));
  const camera = payload.camera && typeof payload.camera === 'object'
    ? payload.camera as Record<string, unknown>
    : {};
  return {
    width: Number(payload.viewportWidth) || 390,
    height: Number(payload.viewportHeight) || 844,
    center: {
      lng: sample ? Number(sample.cLng) : Number(camera.centerLng) || 0,
      lat: sample ? Number(sample.cLat) : Number(camera.centerLat) || 0,
    },
    zoom: sample ? Number(sample.zoom) : Number(camera.zoom) || Number(payload.startZoom) || 15,
    bearing: sample ? Number(sample.bearing) || 0 : Number(camera.bearing) || 0,
    pitch: sample ? Number(sample.pitch) || 0 : Number(camera.pitch) || 0,
  };
}

export function traceToReplayFixture(
  trace: RouteDrawingTrace,
  operationId?: string,
): RouteDrawingReplayFixture | null {
  const operation = operationId
    ?? [...trace.events].reverse().find(event => event.kind === 'brush_end' || event.kind === 'route_draw_geographic_stroke')?.operationId;
  if (!operation) return null;
  const rawEvent = eventFor(trace, 'route_draw_geographic_stroke', operation)
    ?? eventFor(trace, 'brush_end', operation);
  const sampleEvent = eventFor(trace, 'route_draw_raw_samples', operation)
    ?? eventFor(trace, 'brush_raw_samples', operation);
  const providerEvent = eventFor(trace, 'brush_full_dump', operation)
    ?? eventFor(trace, 'route_draw_provider_response', operation)
    ?? eventFor(trace, 'brush_intent_decision', operation);
  const finalEvent = eventFor(trace, 'route_draw_intent_decision', operation)
    ?? eventFor(trace, 'route_draw_commit', operation)
    ?? eventFor(trace, 'brush_intent_decision', operation)
    ?? eventFor(trace, 'brush_final_dump', operation);
  const rawStroke = clonePoints(rawEvent?.payload.rawPoints);
  const intentEvent = eventFor(trace, 'route_draw_transaction_intent', operation);
  const operationOriginal = clonePoints(intentEvent?.payload.preStateGeometry ?? trace.originalRoute);
  if (operationOriginal.length < 2 || rawStroke.length < 2) return null;
  return {
    fixtureVersion: 1,
    id: operation,
    source: 'captured-redacted',
    originalRoute: operationOriginal,
    rawStroke,
    providerGeometry: clonePoints(
      providerEvent?.payload.providerGeometry
        ?? providerEvent?.payload.stitched_curve_full,
    ),
    viewport: viewportFromSamples(sampleEvent),
    recordedFinalGeometry: clonePoints(
      finalEvent?.payload.finalGeometry
        ?? finalEvent?.payload.final_full,
    ),
  };
}

export function replayRouteDrawingFixture(fixture: RouteDrawingReplayFixture): RouteDrawingReplayResult {
  const decision = resolveRouteDrawing({
    originalRoute: fixture.originalRoute,
    rawStroke: fixture.rawStroke,
    providerGeometry: fixture.providerGeometry,
    viewport: fixture.viewport,
  });
  const legacyGeometry = resolveProviderOwnedLegacyGeometry({
    originalRoute: fixture.originalRoute,
    rawStroke: fixture.rawStroke,
    providerGeometry: fixture.providerGeometry,
    viewport: fixture.viewport,
  });
  return {
    fixture,
    decision,
    legacyGeometry,
    divergenceStage: decision.divergenceStage,
    overlays: {
      originalRoute: fixture.originalRoute,
      rawStroke: fixture.rawStroke,
      providerCandidate: fixture.providerGeometry ?? [],
      selectedReplacement: decision.selectedReplacement,
      finalGeometry: decision.finalGeometry,
      recordedFinalGeometry: fixture.recordedFinalGeometry ?? [],
    },
  };
}

export function replayRouteDrawingTrace(
  trace: RouteDrawingTrace,
  operationId?: string,
): RouteDrawingReplayResult | null {
  const fixture = traceToReplayFixture(trace, operationId);
  return fixture ? replayRouteDrawingFixture(fixture) : null;
}

/** Test-only reset. Diagnostics remain off after reset. */
export function _resetRouteDrawingTraceForTesting(): void {
  enabled = false;
  clearRouteDrawingTraces();
}
