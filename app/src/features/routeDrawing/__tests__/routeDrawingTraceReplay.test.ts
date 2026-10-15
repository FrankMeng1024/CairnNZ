import {
  _resetRouteDrawingTraceForTesting,
  beginRouteDrawingTrace,
  endRouteDrawingTrace,
  exportRouteDrawingTrace,
  getLatestRouteDrawingTrace,
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
    _resetRouteDrawingTraceForTesting();
    setRouteDrawingDiagnosticsEnabled(true);
    beginRouteDrawingTrace({
      sessionId: 'owner-session-a', routeId: 'activity:goood:create-a',
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
});
