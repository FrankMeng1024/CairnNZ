const mockValues = new Map<string, string>();
const mockAddSession = jest.fn(async () => undefined);
let mockPending: any = null;
let mockArtifact: any = null;
let mockToken: string | null = null;
let mockOwnerId = 'owner-a';
let mockLoggedIn = true;
let mockNetworkState: 'online' | 'offline' | null = null;
const mockReconstruct = jest.fn();
const mockCommitArtifact = jest.fn();
const reviewReceipts: Array<Record<string, unknown>> = [];

jest.mock('../../../store/storage', () => ({
  storage: {
    getItem: jest.fn(async (key: string) => mockValues.get(key) ?? null),
    setItem: jest.fn(async (key: string, value: string) => { mockValues.set(key, value); }),
  },
}));
jest.mock('../../../config/mapbox', () => ({
  resolveMapboxPublicTokenAuthority: jest.fn(async () => ({ token: mockToken, source: mockToken ? 'runtime' : 'none' })),
}));
jest.mock('../../../services/networkMonitor', () => ({
  networkMonitor: { getState: () => mockNetworkState ? { state: mockNetworkState } : null },
}));
jest.mock('../../../store/useAppStore', () => ({
  useAppStore: { getState: () => ({ isLoggedIn: mockLoggedIn, user: { id: mockOwnerId } }) },
}));
jest.mock('../../../store/useSessionStore', () => ({
  useSessionStore: { getState: () => ({ sessions: [], addSession: mockAddSession }) },
}));
jest.mock('../../../services/pendingSyncStore', () => ({
  finishPendingPreparation: jest.fn(),
  markPendingUploadReady: jest.fn(async () => undefined),
  readPendingReadonly: jest.fn(async () => mockPending),
  savePending: jest.fn(async () => undefined),
}));
jest.mock('../activityFinalArtifact', () => ({
  loadActivityFinalArtifact: jest.fn(async () => mockArtifact),
  commitActivityFinalArtifact: (...args: any[]) => mockCommitArtifact(...args),
  activityGeometryFingerprint: (points: any[]) => JSON.stringify(points.map(point => [point.lat, point.lng, point.segmentId])),
}));
jest.mock('../../../services/routing/pedestrianFinalRoute', () => ({
  reconstructPedestrianFinalRoute: (...args: any[]) => mockReconstruct(...args),
}));
jest.mock('../../../services/routing/snapTrack', () => ({
  analyzeTrustedEndpointCoverage: jest.fn(() => ({ eligibleForAnchoring: true })),
  preserveTrustedRouteEndpoints: jest.fn((_canonical: any, points: any) => points),
  evaluateMatchedGeometryQuality: jest.fn(() => ({ accepted: true })),
}));
jest.mock('../../activitySimulator/simulatorLog', () => ({ appendSimulatorLog: jest.fn() }));
jest.mock('../../../services/syncDaemon', () => ({ drainPending: jest.fn(async () => undefined) }));

import {
  cancelAllActivityFinalRefinementsForOwner,
  cancelActivityFinalRefinement,
  enqueueActivityFinalRefinement,
  readActivityFinalRefinementJob,
  resumeActivityFinalRefinement,
} from '../activityFinalRefinementQueue';

const pendingMocks = jest.requireMock('../../../services/pendingSyncStore') as {
  savePending: jest.Mock;
  markPendingUploadReady: jest.Mock;
};

function baseArtifact() {
  return {
    format: 'cairn-activity-final' as const,
    version: 1 as const,
    ownerUserId: 'owner-a',
    clientActivityId: 'activity-a',
    revision: 1,
    parentRevision: null,
    algorithmVersion: 'pedestrian-final-v2-base' as const,
    source: 'base' as const,
    canonicalFingerprint: 'canonical-a',
    displayFingerprint: 'display-a',
    points: [
      { lat: -41, lng: 174, t: 1_000, segmentId: 's' },
      { lat: -41.001, lng: 174, t: 2_000, segmentId: 's' },
    ],
    committedAt: 3_000,
  };
}

function requestResult(overrides: Record<string, unknown> = {}) {
  return {
    kind: 'map-matching',
    sourceStart: 0,
    sourceEnd: 1,
    inputPointCount: 2,
    sourceIndexMap: [0, 1],
    durationMs: 10,
    result: 'ok',
    httpStatus: 200,
    responseCode: 'Ok',
    matchingCount: 1,
    tracepointCount: 2,
    nullTracepointCount: 0,
    acceptedCandidateCount: 0,
    rejectedCandidateCount: 0,
    profile: 'walking',
    matcherTidy: false,
    invoked: true,
    governorReason: null,
    responseBytes: 120,
    ...overrides,
  };
}

describe('durable Activity Final refinement queue', () => {
  afterAll(() => {
    if (!process.env.CAIRN_FIELD03_ROAD_RECEIPTS_OUTPUT) return;
    require('node:fs').writeFileSync(
      process.env.CAIRN_FIELD03_ROAD_RECEIPTS_OUTPUT,
      `${JSON.stringify({
        schema: 'cairn-field03-mocked-road-aware-receipts',
        note: 'Synthetic coordinates only; no network request was issued.',
        receipts: reviewReceipts,
      }, null, 2)}\n`,
    );
  });

  beforeEach(() => {
    mockValues.clear();
    jest.clearAllMocks();
    mockArtifact = baseArtifact();
    mockToken = null;
    mockOwnerId = 'owner-a';
    mockLoggedIn = true;
    mockNetworkState = null;
    mockReconstruct.mockReset();
    mockCommitArtifact.mockReset();
    mockPending = {
      uploadState: 'preparing',
      preparationPhase: 'registry_committed',
      localId: 'activity-a',
      userId: 'owner-a',
      remoteId: null,
      idempotencyKey: 'same-key-through-preparation',
      activityMode: 'hiking',
      payload: {
        end_time: new Date(2_000).toISOString(),
        distance_m: 100,
        duration_s: 60,
        name: 'Walk',
        route_points: [],
        route_points_raw: [],
        route_points_canonical: [
          { lat: -41, lng: 174, t: 1_000, segment_id: 's' },
          { lat: -41.001, lng: 174, t: 2_000, segment_id: 's' },
        ],
        memory_points: [],
      },
      createdAt: 2_000,
      startedAt: 1_000,
      summary: {
        startedAt: 1_000,
        endedAt: 2_000,
        distanceM: 100,
        durationS: 60,
        elevationGainM: 4,
        name: 'Walk',
        markerIds: [],
      },
      finalArtifact: {
        revision: 1,
        displayFingerprint: 'display-a',
        canonicalFingerprint: 'canonical-a',
        source: 'base',
        algorithmVersion: 'pedestrian-final-v2-base',
      },
      lastAttemptAt: null,
      attemptCount: 0,
    };
  });

  test('restartable queued work retains validated Base and releases exactly one payload when road refinement is unavailable', async () => {
    const artifact = baseArtifact();
    await enqueueActivityFinalRefinement({
      ownerUserId: 'owner-a', clientActivityId: 'activity-a', baseArtifact: artifact,
    });
    await expect(resumeActivityFinalRefinement('owner-a', 'activity-a')).resolves.toBe('complete');
    expect(pendingMocks.savePending).toHaveBeenCalledWith(expect.objectContaining({
      idempotencyKey: 'same-key-through-preparation',
      uploadState: 'preparing',
      finalArtifact: expect.objectContaining({ revision: 1, source: 'base' }),
    }));
    expect(pendingMocks.markPendingUploadReady).toHaveBeenCalledWith('activity-a');
    expect(mockAddSession).toHaveBeenCalledWith(expect.objectContaining({
      finalGeometryState: 'base_ready',
      finalGeometryRevision: 1,
    }), 'owner-a');
    const job = await readActivityFinalRefinementJob('owner-a', 'activity-a');
    reviewReceipts.push({ scenario: 'token authority unavailable', ...job });
    expect(job).toMatchObject({
      status: 'complete', outcome: 'base-retained', completedRevision: 1,
    });
  });

  test('offline selection publishes the stable local route without dispatching a paid request', async () => {
    mockToken = 'token-that-must-not-be-used';
    mockNetworkState = 'offline';
    await enqueueActivityFinalRefinement({
      ownerUserId: 'owner-a', clientActivityId: 'activity-a', baseArtifact: baseArtifact(),
    });
    await expect(resumeActivityFinalRefinement('owner-a', 'activity-a')).resolves.toBe('complete');
    expect(mockReconstruct).not.toHaveBeenCalled();
    const job = await readActivityFinalRefinementJob('owner-a', 'activity-a');
    reviewReceipts.push({ scenario: 'offline', ...job });
    expect(job).toMatchObject({
      status: 'complete',
      technicalOutcome: 'offline',
      tokenAuthorityLabel: 'runtime',
      matchingAttempted: false,
      candidateDecision: 'stable-local-selected',
      selectedSource: 'base',
      completedRevision: 1,
    });
  });

  test('owner deletion cancellation is durable and prevents a queued job from running', async () => {
    await enqueueActivityFinalRefinement({
      ownerUserId: 'owner-a', clientActivityId: 'activity-a', baseArtifact: baseArtifact(),
    });
    await cancelActivityFinalRefinement('owner-a', 'activity-a');
    await expect(resumeActivityFinalRefinement('owner-a', 'activity-a')).resolves.toBe('cancelled');
    expect(pendingMocks.savePending).not.toHaveBeenCalled();
    const job = await readActivityFinalRefinementJob('owner-a', 'activity-a');
    reviewReceipts.push({ scenario: 'owner deletion cancellation', ...job });
    expect(job).toMatchObject({
      status: 'cancelled', outcome: 'deleted',
    });
  });

  test('privacy reset cancels every indexed job for the exact owner only', async () => {
    await enqueueActivityFinalRefinement({
      ownerUserId: 'owner-a', clientActivityId: 'activity-a', baseArtifact: baseArtifact(),
    });
    const second = { ...baseArtifact(), clientActivityId: 'activity-b', canonicalFingerprint: 'canonical-b' };
    await enqueueActivityFinalRefinement({
      ownerUserId: 'owner-a', clientActivityId: 'activity-b', baseArtifact: second,
    });
    await cancelAllActivityFinalRefinementsForOwner('owner-a');
    await expect(resumeActivityFinalRefinement('owner-a', 'activity-a')).resolves.toBe('cancelled');
    await expect(resumeActivityFinalRefinement('owner-a', 'activity-b')).resolves.toBe('cancelled');
  });

  test('durable cancellation aborts an in-flight request and prevents later publication or dispatch', async () => {
    mockToken = 'token';
    let release!: (value: any) => void;
    mockReconstruct.mockImplementation((_segment, options) => new Promise(resolve => {
      release = resolve;
      options.signal.addEventListener('abort', () => resolve({
        ok: false, reason: 'aborted', stats: {},
      }), { once: true });
    }));
    await enqueueActivityFinalRefinement({
      ownerUserId: 'owner-a', clientActivityId: 'activity-a', baseArtifact: baseArtifact(),
    });
    const running = resumeActivityFinalRefinement('owner-a', 'activity-a');
    for (let turn = 0; turn < 20 && mockReconstruct.mock.calls.length === 0; turn += 1) await Promise.resolve();
    expect(mockReconstruct).toHaveBeenCalledTimes(1);
    await cancelActivityFinalRefinement('owner-a', 'activity-a');
    await expect(running).resolves.toBe('cancelled');
    expect(mockReconstruct).toHaveBeenCalledTimes(1);
    expect(pendingMocks.savePending).not.toHaveBeenCalled();
    expect(await readActivityFinalRefinementJob('owner-a', 'activity-a')).toMatchObject({ status: 'cancelled' });
    void release;
  });

  test('owner privacy cancellation waits an uninterruptible entered call, then prevents every local commit', async () => {
    mockToken = 'token';
    let release!: (value: any) => void;
    mockReconstruct.mockImplementation(() => new Promise(resolve => { release = resolve; }));
    await enqueueActivityFinalRefinement({
      ownerUserId: 'owner-a', clientActivityId: 'activity-a', baseArtifact: baseArtifact(),
    });
    const running = resumeActivityFinalRefinement('owner-a', 'activity-a');
    for (let turn = 0; turn < 20 && mockReconstruct.mock.calls.length === 0; turn += 1) await Promise.resolve();
    let purgeFenceSettled = false;
    const purgeFence = cancelAllActivityFinalRefinementsForOwner('owner-a')
      .then(() => { purgeFenceSettled = true; });
    for (let turn = 0; turn < 20; turn += 1) await Promise.resolve();
    expect(purgeFenceSettled).toBe(false);
    release({ ok: false, reason: 'aborted-late', stats: {} });
    await purgeFence;
    await expect(running).resolves.toBe('cancelled');
    expect(mockCommitArtifact).not.toHaveBeenCalled();
    expect(pendingMocks.savePending).not.toHaveBeenCalled();
  });

  test('a valid production local improvement can replace Base even with zero matched distance', async () => {
    mockToken = 'token';
    const canonical = [
      { lat: -41, lng: 174, t: 1_000, segment_id: 's' },
      { lat: -41.0005, lng: 174.0003, t: 1_500, segment_id: 's' },
      { lat: -41.001, lng: 174, t: 2_000, segment_id: 's' },
    ];
    mockPending.payload.route_points_canonical = canonical;
    mockArtifact = {
      ...baseArtifact(),
      points: canonical.map(point => ({ ...point, segmentId: point.segment_id })),
    };
    mockReconstruct.mockResolvedValue({
      ok: true,
      points: [canonical[0], canonical[2]],
      stats: {
        acceptedMatchedDistanceM: 0,
        canonicalDerivedSectionCount: 1,
        displayRefined: true,
        wholeRouteValidation: { accepted: true },
      },
    });
    const limited = { ...mockArtifact, revision: 2, source: 'limited', displayFingerprint: 'local-improved' };
    mockCommitArtifact.mockResolvedValue({ committed: true, artifact: limited });
    await enqueueActivityFinalRefinement({
      ownerUserId: 'owner-a', clientActivityId: 'activity-a', baseArtifact: mockArtifact,
    });
    await expect(resumeActivityFinalRefinement('owner-a', 'activity-a')).resolves.toBe('complete');
    expect(mockCommitArtifact).toHaveBeenCalledWith(expect.objectContaining({ source: 'limited' }));
    expect(pendingMocks.savePending).toHaveBeenCalledWith(expect.objectContaining({
      finalArtifact: expect.objectContaining({ source: 'limited', revision: 2 }),
    }));
  });

  test('passes only the bounded user-flow budget to optional road-aware work', async () => {
    mockToken = 'token';
    mockNetworkState = 'online';
    mockReconstruct.mockResolvedValue({
      ok: false,
      reason: 'aborted',
      stats: { requestResults: [] },
    });
    await enqueueActivityFinalRefinement({
      ownerUserId: 'owner-a', clientActivityId: 'activity-a', baseArtifact: baseArtifact(),
    });
    await expect(resumeActivityFinalRefinement('owner-a', 'activity-a')).resolves.toBe('complete');
    expect(mockReconstruct).toHaveBeenCalled();
    const options = mockReconstruct.mock.calls[0][1];
    expect(options.totalTimeoutMs).toBeGreaterThan(0);
    expect(options.totalTimeoutMs).toBeLessThanOrEqual(4_500);
    expect(options.perCallTimeoutMs).toBeLessThanOrEqual(2_600);
    expect(mockCommitArtifact).not.toHaveBeenCalled();
  });

  test.each([
    ['NoMatch', requestResult({ responseCode: 'NoMatch', result: 'response-no-match' }), 'no-match', 'stable-local-no-match'],
    ['authorization rejection', requestResult({ httpStatus: 401, responseCode: 'Unauthorized', result: 'http-401' }), 'auth', 'stable-local-auth-rejected'],
    ['local request budget', requestResult({ invoked: false, governorReason: 'budget', httpStatus: null, responseCode: null, result: 'governor-denied' }), 'budget', 'stable-local-governor-denied'],
    ['unsafe returned candidate', requestResult({ acceptedCandidateCount: 0, rejectedCandidateCount: 1 }), 'unsafe-candidate', 'candidate-rejected'],
    ['bounded deadline', requestResult({ result: 'timeout-or-abort', httpStatus: null, responseCode: null }), 'deadline', 'stable-local-deadline'],
  ])('records a precise %s receipt while retaining the stable local route', async (
    _label,
    request,
    technicalOutcome,
    candidateDecision,
  ) => {
    mockToken = 'token';
    mockNetworkState = 'online';
    mockReconstruct.mockResolvedValue({
      ok: true,
      points: baseArtifact().points,
      stats: {
        requestResults: [request],
        acceptedMatchedDistanceM: 0,
        canonicalDerivedSectionCount: 1,
        displayRefined: false,
        wholeRouteValidation: { accepted: true },
      },
    });
    await enqueueActivityFinalRefinement({
      ownerUserId: 'owner-a', clientActivityId: 'activity-a', baseArtifact: baseArtifact(),
    });
    await expect(resumeActivityFinalRefinement('owner-a', 'activity-a')).resolves.toBe('complete');
    expect(mockCommitArtifact).not.toHaveBeenCalled();
    const job = await readActivityFinalRefinementJob('owner-a', 'activity-a');
    reviewReceipts.push({ scenario: _label, ...job });
    expect(job).toMatchObject({
      status: 'complete',
      technicalOutcome,
      candidateDecision,
      selectedSource: 'base',
      selectedFingerprint: 'display-a',
    });
  });

  test('multiple declared segments publish one hybrid revision after matched success plus bounded fallback', async () => {
    mockToken = 'token';
    const canonical = [
      { lat: -41, lng: 174, t: 1_000, segment_id: 'one' },
      { lat: -41.001, lng: 174, t: 2_000, segment_id: 'one' },
      { lat: -41.01, lng: 174.01, t: 3_000, segment_id: 'two' },
      { lat: -41.011, lng: 174.01, t: 4_000, segment_id: 'two' },
    ];
    mockPending.payload.route_points_canonical = canonical;
    mockArtifact = {
      ...baseArtifact(),
      points: canonical.map(point => ({ ...point, segmentId: point.segment_id })),
    };
    mockReconstruct
      .mockResolvedValueOnce({
        ok: true,
        points: canonical.slice(0, 2),
        stats: {
          requestResults: [requestResult({ acceptedCandidateCount: 1 })],
          acceptedMatchedDistanceM: 100,
          canonicalDerivedSectionCount: 0,
          displayRefined: true,
          wholeRouteValidation: { accepted: true },
        },
      })
      .mockResolvedValueOnce({ ok: false, reason: 'timeout', stats: {} });
    const hybrid = { ...mockArtifact, revision: 2, source: 'hybrid', displayFingerprint: 'hybrid-two-segments' };
    mockCommitArtifact.mockResolvedValue({ committed: true, artifact: hybrid });

    await enqueueActivityFinalRefinement({
      ownerUserId: 'owner-a', clientActivityId: 'activity-a', baseArtifact: mockArtifact,
    });
    await expect(resumeActivityFinalRefinement('owner-a', 'activity-a')).resolves.toBe('complete');
    expect(mockReconstruct).toHaveBeenCalledTimes(2);
    expect(mockCommitArtifact).toHaveBeenCalledWith(expect.objectContaining({
      source: 'hybrid',
      expectedRevision: 1,
    }));
    expect(pendingMocks.savePending).toHaveBeenCalledWith(expect.objectContaining({
      finalArtifact: expect.objectContaining({ source: 'hybrid', revision: 2 }),
    }));
    const job = await readActivityFinalRefinementJob('owner-a', 'activity-a');
    reviewReceipts.push({ scenario: 'matched hybrid success', ...job });
    expect(job).toMatchObject({
      status: 'complete',
      technicalOutcome: 'matched-success',
      tokenAuthorityLabel: 'runtime',
      matchingAttempted: true,
      governorAuthorized: true,
      candidateDecision: 'accepted',
      selectedSource: 'hybrid',
      selectedFingerprint: 'hybrid-two-segments',
      completedRevision: 2,
    });
  });

  test('an account switch during a network request defers the durable job and publishes nothing stale', async () => {
    mockToken = 'token';
    let release!: (value: any) => void;
    mockReconstruct.mockImplementation(() => new Promise(resolve => { release = resolve; }));
    await enqueueActivityFinalRefinement({
      ownerUserId: 'owner-a', clientActivityId: 'activity-a', baseArtifact: baseArtifact(),
    });
    const running = resumeActivityFinalRefinement('owner-a', 'activity-a');
    for (let turn = 0; turn < 20 && mockReconstruct.mock.calls.length === 0; turn += 1) await Promise.resolve();
    expect(mockReconstruct).toHaveBeenCalledTimes(1);
    mockOwnerId = 'owner-b';
    release({
      ok: true,
      points: baseArtifact().points,
      stats: {
        acceptedMatchedDistanceM: 100,
        canonicalDerivedSectionCount: 0,
        displayRefined: true,
        wholeRouteValidation: { accepted: true },
      },
    });
    await expect(running).resolves.toBe('deferred-owner');
    expect(mockCommitArtifact).not.toHaveBeenCalled();
    expect(pendingMocks.savePending).not.toHaveBeenCalled();
    expect(await readActivityFinalRefinementJob('owner-a', 'activity-a')).toMatchObject({
      status: 'queued', outcome: 'owner-deferred',
    });
  });
});
