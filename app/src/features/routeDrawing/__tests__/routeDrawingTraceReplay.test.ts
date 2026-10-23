const mockAutomaticCapture = jest.fn(async (_input: unknown) => undefined);
jest.mock('../../../services/automaticDiagnosticOutbox', () => ({
  captureAutomaticDiagnosticEvent: (input: unknown) => mockAutomaticCapture(input),
}));

import {
  _resetRouteDrawingTraceForTesting,
  beginRouteDrawingTrace,
  endRouteDrawingTrace,
  exportRouteDrawingTrace,
  getLatestRouteDrawingTrace,
  listRouteDrawingTraces,
  listRouteDrawingOperationIds,
  parseRouteDrawingTrace,
  recordRouteDrawingTrace,
  replayRouteDrawingTrace,
  replayRouteOperationEvidence,
  selectRouteDrawingOperation,
  selectRouteDrawingSessionOperation,
  setRouteDrawingDiagnosticsEnabled,
} from '../routeDrawingTrace';

const original = [
  { lat: -36.848, lng: 174.764 },
  { lat: -36.8475, lng: 174.7645 },
  { lat: -36.848, lng: 174.765 },
];

describe('bounded multi-operation Route trace round-trip', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    _resetRouteDrawingTraceForTesting();
    setRouteDrawingDiagnosticsEnabled(true);
    beginRouteDrawingTrace({
      sessionId: 'owner-session-a', routeId: 'activity:goood:create-a',
      accountId: 'owner-a',
      source: { kind: 'activity', id: 'goood' }, initialGeometryRevision: 1,
      originalRoute: original, initialUndoDepth: 0,
    });
  });

  afterEach(() => _resetRouteDrawingTraceForTesting());

  test('export → parse → replay preserves a rejection, Point return, and session abandonment', () => {
    const drawOperation = selectRouteDrawingOperation('draw-rejected');
    const stroke = [original[0], original[2]];
    recordRouteDrawingTrace('route_draw_geographic_stroke', { strokeId: 'draw-rejected', rawPoints: stroke }, 'geographic-stroke');
    recordRouteDrawingTrace('route_draw_transaction_intent', {
      strokeId: 'draw-rejected', preStateGeometry: original, diagnostics: { ambiguityReason: 'near-equal-intervals' },
    }, 'intent');
    recordRouteDrawingTrace('route_draw_ambiguous', {
      strokeId: 'draw-rejected', reason: 'near-equal-intervals', unchangedFinalGeometry: original,
    }, 'attachment');

    const pointOperation = selectRouteDrawingOperation('point-return', 'point');
    const returned = [original[2], original[1], original[0]];
    recordRouteDrawingTrace('route_point_provider_request', {
      strokeId: 'point-return', start: original[2], target: original[0], preStateGeometry: original,
    }, 'provider-request');
    recordRouteDrawingTrace('route_point_provider_response', {
      strokeId: 'point-return', providerGeometry: [original[2], { lat: -36.846, lng: 174.7645 }, original[0]],
    }, 'provider-response');
    recordRouteDrawingTrace('route_point_candidate_selected', {
      strokeId: 'point-return', reason: 'provider-detour', selectedGeometry: returned,
    }, 'selection');
    recordRouteDrawingTrace('route_draw_commit', { finalGeometry: [...original, original[1], original[0]] }, 'commit');

    const sessionOperation = selectRouteDrawingSessionOperation();
    recordRouteDrawingTrace('route_creation_abandoned', { finalGeometry: original }, 'session');
    endRouteDrawingTrace('cancelled');

    const exported = exportRouteDrawingTrace('owner-session-a');
    expect(exported).not.toBeNull();
    const imported = parseRouteDrawingTrace(exported!);
    expect(imported).not.toBeNull();
    expect(listRouteDrawingOperationIds(imported!)).toEqual([drawOperation, pointOperation, sessionOperation]);

    const rejected = replayRouteOperationEvidence(imported!, drawOperation);
    expect(rejected).toMatchObject({ kind: 'draw', outcome: 'rejected', reason: 'near-equal-intervals' });
    expect(rejected?.preStateGeometry).toEqual(original);
    expect(rejected?.finalGeometry).toEqual(original);
    expect(replayRouteDrawingTrace(imported!, drawOperation)?.fixture.originalRoute).toEqual(original);

    const point = replayRouteOperationEvidence(imported!, pointOperation);
    expect(point).toMatchObject({ kind: 'point', outcome: 'committed', reason: 'provider-detour' });
    expect(point?.providerGeometry).toHaveLength(3);
    expect(point?.selectedGeometry).toEqual(returned);

    const abandoned = replayRouteOperationEvidence(imported!, sessionOperation);
    expect(abandoned).toMatchObject({ kind: 'session', outcome: 'abandoned' });
    expect(abandoned?.finalGeometry).toEqual(original);
    expect(getLatestRouteDrawingTrace()?.droppedEvents).toBe(0);
  });

  test('malformed or unbounded imports are refused', () => {
    expect(parseRouteDrawingTrace('{bad')).toBeNull();
    expect(parseRouteDrawingTrace('x'.repeat(4 * 1024 * 1024))).toBeNull();
  });

  test('an overflowing active operation preserves its start and reports an incomplete capture', () => {
    selectRouteDrawingOperation('large-stroke');
    recordRouteDrawingTrace('route_draw_geographic_stroke', {
      strokeId: 'large-stroke', rawPoints: [original[0], original[2]],
    }, 'geographic-stroke');
    for (let index = 0; index < 700; index += 1) {
      recordRouteDrawingTrace('route_point_animation_frame', {
        strokeId: 'large-stroke', index, head: original[index % original.length],
      }, 'state');
    }
    const trace = getLatestRouteDrawingTrace();
    expect(trace?.events[0].kind).toBe('route_session_started');
    expect(trace?.events.some(event => event.kind === 'route_draw_geographic_stroke')).toBe(true);
    expect(trace?.events.length).toBeLessThanOrEqual(600);
    expect(trace?.droppedEvents).toBeGreaterThan(0);
    expect(trace?.captureError).toBe('event-budget-exceeded');
  });

  test('exports account scope and replays cancelled Draw plus committed Trim terminal evidence', () => {
    const cancelledDraw = selectRouteDrawingOperation('native-cancel');
    recordRouteDrawingTrace('route_draw_raw_samples', {
      strokeId: 'native-cancel',
      samples: [{ x: 14, y: 28, geographic: original[0] }],
      projectionFailures: 0,
    }, 'raw-input');
    recordRouteDrawingTrace('route_draw_geographic_stroke', {
      strokeId: 'native-cancel', rawPoints: [original[0], original[1]],
    }, 'geographic-stroke');
    recordRouteDrawingTrace('route_operation_terminal', {
      strokeId: 'native-cancel', outcome: 'cancelled', reason: 'gesture-interrupted',
      finalGeometry: original,
    }, 'state');

    const trimOperation = selectRouteDrawingOperation('trim-one', 'trim');
    const trimmed = original.slice(0, 2);
    recordRouteDrawingTrace('route_trim_started', {
      strokeId: 'trim-one', trimFractions: { start: 0, end: 0.5 }, preStateGeometry: original,
    }, 'intent');
    recordRouteDrawingTrace('route_draw_commit', {
      strokeId: 'trim-one', operation: 'trim', finalGeometry: trimmed,
    }, 'commit');
    recordRouteDrawingTrace('route_operation_terminal', {
      strokeId: 'trim-one', outcome: 'committed', finalGeometry: trimmed,
    }, 'state');

    expect(exportRouteDrawingTrace('owner-session-a', 'owner-b')).toBeNull();
    const serialized = exportRouteDrawingTrace('owner-session-a', 'owner-a')!;
    expect(serialized).not.toContain('owner-a');
    const trace = parseRouteDrawingTrace(serialized);
    expect(trace?.accountId).toBe('current-owner');
    expect(replayRouteOperationEvidence(trace!, cancelledDraw)).toMatchObject({
      kind: 'draw', outcome: 'cancelled', reason: 'gesture-interrupted', finalGeometry: original,
    });
    expect(replayRouteOperationEvidence(trace!, trimOperation)).toMatchObject({
      kind: 'trim', outcome: 'committed', finalGeometry: trimmed,
    });
  });

  test('keeps a coordinate-free owner-scoped summary when precise capture is off', async () => {
    _resetRouteDrawingTraceForTesting();
    setRouteDrawingDiagnosticsEnabled(false);
    beginRouteDrawingTrace({
      sessionId: 'summary-a', routeId: 'route-private-a', accountId: 'owner-a',
      source: { kind: 'activity', id: 'activity-private-a' },
      originalRoute: original, initialUndoDepth: 0,
    });
    recordRouteDrawingTrace('route_point_provider_request', {
      strokeId: 'stroke-private', target: original[1], pointCount: 2, provider: 'mapbox',
    }, 'provider-request');
    recordRouteDrawingTrace('route_operation_terminal', {
      strokeId: 'stroke-private', outcome: 'rejected', reason: 'provider-timeout',
      finalGeometry: original,
    }, 'state');
    recordRouteDrawingTrace('route_point_animation_frame', { head: original[0] }, 'state');
    endRouteDrawingTrace('cancelled');

    expect(listRouteDrawingTraces('owner-b')).toEqual([]);
    const exported = exportRouteDrawingTrace('summary-a', 'owner-a');
    expect(exported).not.toBeNull();
    expect(exported).not.toContain('174.764');
    expect(exported).not.toContain('route-private-a');
    expect(exported).not.toContain('activity-private-a');
    const parsed = JSON.parse(exported!);
    expect(parsed).toMatchObject({
      captureMode: 'summary-default',
      accountId: 'current-owner',
      privacy: { preciseGeometryIncluded: false, automaticUpload: false },
    });
    expect(parsed.suppressedEvents).toBeGreaterThan(0);
    expect(parsed.events.map((event: any) => event.kind)).toEqual(expect.arrayContaining([
      'route_session_started', 'route_point_provider_request', 'route_operation_terminal', 'route_session_ended',
    ]));
    await Promise.resolve();
    expect(mockAutomaticCapture).toHaveBeenCalledWith(expect.objectContaining({
      ownerUserId: 'owner-a',
      stream: expect.objectContaining({ sourceType: 'route', routeEditSessionId: 'summary-a' }),
    }));
  });
});
