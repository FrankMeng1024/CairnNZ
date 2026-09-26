import { activityRouteStateCopy, deriveActivityRouteState } from '../activityRouteState';

const point = (index: number, segmentId = 'a') => ({
  lat: -41 + index / 100_000,
  lng: 174,
  t: 1_000 + index * 1_000,
  segmentId,
});

describe('Activity / sync / Final / Route state separation', () => {
  test('offline Activity is locally ready and Route-ready without claiming sync', () => {
    const state = deriveActivityRouteState({
      session: { syncState: 'pending', finalGeometryState: 'base_ready' },
      trackPoints: [point(0), point(1), point(2)],
    });
    expect(state).toMatchObject({
      localReadiness: 'ready',
      serverSync: 'pending',
      finalEnhancement: 'base',
      routeReadiness: 'ready',
    });
    expect(activityRouteStateCopy(state).routeLabel).toBe('Route ready');
  });

  test('a true gap stays a missing section but permits explicit Route recovery', () => {
    const state = deriveActivityRouteState({
      session: { syncState: 'synced', finalGeometryState: 'enhanced' },
      trackPoints: [point(0), point(1), point(2, 'b'), point(3, 'b')],
    });
    expect(state.routeReadiness).toBe('missing_section');
    expect(state.manualAction).toBe('choose_or_reconnect');
    expect(state.gapCount).toBe(1);
  });

  test('limited network evidence asks for review without invalidating the Activity', () => {
    const state = deriveActivityRouteState({
      session: { syncState: 'sync_error', finalGeometryState: 'limited_evidence' },
      trackPoints: [point(0), point(1)],
    });
    expect(state.localReadiness).toBe('ready');
    expect(state.serverSync).toBe('retryable_error');
    expect(state.routeReadiness).toBe('needs_review');
    expect(activityRouteStateCopy(state).syncLabel).toContain('retry');
  });

  test.each([
    ['auth_required', 'auth_required', 'Sign in'],
    ['action_required', 'action_required', 'needs review'],
    ['dependency', 'dependency', 'another Activity'],
  ] as const)('preserves %s as a distinct visible state', (failure, expected, copy) => {
    const state = deriveActivityRouteState({
      session: { syncState: 'sync_error', syncFailureKind: failure, finalGeometryState: 'base_ready' },
      trackPoints: [point(0), point(1)],
    });
    expect(state.serverSync).toBe(expected);
    expect(activityRouteStateCopy(state).syncLabel).toContain(copy);
  });
});
