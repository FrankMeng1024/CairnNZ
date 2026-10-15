import {
  _peekQueueLength,
  _resetForTesting,
  beginRouteDrawingTrace,
  exportRouteDrawingTrace,
  flushQueue,
  getLatestRouteDrawingTrace,
  listRouteDrawingTraces,
  replayRouteDrawingTrace,
  selectRouteDrawingOperation,
  sendEditDiag,
  setRouteDrawingDiagnosticsEnabled,
} from '../editDiagSender';

const original = [
  { lng: 174.764, lat: -36.848 },
  { lng: 174.765, lat: -36.848 },
];

function begin(sessionId = 'session-1') {
  setRouteDrawingDiagnosticsEnabled(true);
  beginRouteDrawingTrace({
    sessionId,
    routeId: 'route-1',
    source: { kind: 'route', id: 'route-1' },
    initialGeometryRevision: 7,
    originalRoute: original,
    initialUndoDepth: 0,
  });
}

beforeEach(() => _resetForTesting());
afterEach(() => _resetForTesting());

describe('Route drawing diagnostics privacy boundary', () => {
  test('is disabled by default and never performs a network request', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch');
    sendEditDiag('brush_begin', { strokeId: 'stroke-1' });
    await flushQueue();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(_peekQueueLength()).toBe(0);
    fetchSpy.mockRestore();
  });

  test('records only after explicit opt-in and includes original revision authority', () => {
    begin();
    sendEditDiag('brush_begin', { strokeId: 'stroke-1', firstPoint: original[0] });
    const trace = getLatestRouteDrawingTrace();
    expect(trace).not.toBeNull();
    expect(trace).toMatchObject({
      sessionId: 'session-1',
      routeId: 'route-1',
      initialGeometryRevision: 7,
      initialUndoDepth: 0,
    });
    expect(trace?.originalRoute).toEqual(original);
  });

  test('correlates every stage with one session and stable operation id', () => {
    begin();
    const operationId = selectRouteDrawingOperation('stroke-9');
    sendEditDiag('brush_begin', { strokeId: 'stroke-9' });
    sendEditDiag('brush_end', { strokeId: 'stroke-9', rawPoints: original });
    sendEditDiag('brush_mapbox_attempt', { strokeId: 'stroke-9' });
    sendEditDiag('brush_intent_decision', { strokeId: 'stroke-9', finalGeometry: original });
    const trace = getLatestRouteDrawingTrace()!;
    const operationEvents = trace.events.filter(event => event.operationId === operationId);
    expect(operationEvents.map(event => event.stage)).toEqual(expect.arrayContaining([
      'state', 'geographic-stroke', 'provider-request', 'intent',
    ]));
    expect(operationEvents.every(event => event.sessionId === trace.sessionId)).toBe(true);
  });

  test('uses a bounded local buffer and reports dropped evidence', () => {
    begin();
    for (let index = 0; index < 750; index += 1) {
      sendEditDiag('brush_preview_started', { index });
    }
    const trace = getLatestRouteDrawingTrace()!;
    expect(trace.events.length).toBeLessThanOrEqual(600);
    expect(trace.approximateBytes).toBeLessThanOrEqual(2 * 1024 * 1024);
    expect(trace.droppedEvents).toBeGreaterThan(0);
  });

  test('keeps at most eight local traces', () => {
    for (let index = 0; index < 10; index += 1) begin(`session-${index}`);
    expect(listRouteDrawingTraces()).toHaveLength(8);
    expect(listRouteDrawingTraces().some(trace => trace.sessionId === 'session-0')).toBe(false);
  });

  test('exports only when explicitly requested', () => {
    begin();
    sendEditDiag('brush_end', { strokeId: 'stroke-1', rawPoints: original });
    const exported = exportRouteDrawingTrace();
    expect(exported).not.toBeNull();
    const parsed = JSON.parse(exported!);
    expect(parsed.originalRoute).toEqual(original);
    expect(parsed.events.some((event: any) => event.kind === 'brush_end')).toBe(true);
  });

  test('replays a captured operation deterministically with its recorded provider response', () => {
    setRouteDrawingDiagnosticsEnabled(true);
    const vRoute = [
      { lng: 174.764, lat: -36.848 },
      { lng: 174.7645, lat: -36.8473 },
      { lng: 174.765, lat: -36.848 },
    ];
    const raw = [vRoute[0], { lng: 174.7645, lat: -36.848 }, vRoute[2]];
    beginRouteDrawingTrace({
      sessionId: 'replay-session', routeId: 'route-v',
      source: { kind: 'route', id: 'route-v' },
      initialGeometryRevision: 4, originalRoute: vRoute, initialUndoDepth: 0,
    });
    selectRouteDrawingOperation('stroke-v');
    sendEditDiag('brush_end', { strokeId: 'stroke-v', rawPoints: raw });
    sendEditDiag('brush_raw_samples', {
      strokeId: 'stroke-v', viewportWidth: 390, viewportHeight: 844,
      samples: [{ zoom: 16, cLng: 174.7645, cLat: -36.848, bearing: 0, pitch: 0 }],
    });
    sendEditDiag('brush_full_dump', {
      strokeId: 'stroke-v',
      stitched_curve_full: vRoute.map(point => [point.lng, point.lat]),
    });
    const trace = getLatestRouteDrawingTrace()!;
    const first = replayRouteDrawingTrace(trace);
    const second = replayRouteDrawingTrace(trace);
    expect(first).not.toBeNull();
    expect(first).toEqual(second);
    expect(first?.decision.intent).toBe('straight-replacement');
    expect(first?.decision.selectionSource).toBe('drawn-intent');
    expect(first?.divergenceStage).toBe('provider');
  });
});
