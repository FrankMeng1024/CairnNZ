const mockValues = new Map<string, string>();
const mockAddSession = jest.fn(async () => undefined);
let mockPending: any = null;
let mockArtifact: any = null;

jest.mock('../../../store/storage', () => ({
  storage: {
    getItem: jest.fn(async (key: string) => mockValues.get(key) ?? null),
    setItem: jest.fn(async (key: string, value: string) => { mockValues.set(key, value); }),
  },
}));
jest.mock('../../../config/mapbox', () => ({
  resolveMapboxPublicTokenAuthority: jest.fn(async () => ({ token: null, source: 'none' })),
}));
jest.mock('../../../store/useAppStore', () => ({
  useAppStore: { getState: () => ({ isLoggedIn: true, user: { id: 'owner-a' } }) },
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
  commitActivityFinalArtifact: jest.fn(),
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

describe('durable Activity Final refinement queue', () => {
  beforeEach(() => {
    mockValues.clear();
    jest.clearAllMocks();
    mockArtifact = baseArtifact();
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
    expect(await readActivityFinalRefinementJob('owner-a', 'activity-a')).toMatchObject({
      status: 'complete', outcome: 'base-retained', completedRevision: 1,
    });
  });

  test('owner deletion cancellation is durable and prevents a queued job from running', async () => {
    await enqueueActivityFinalRefinement({
      ownerUserId: 'owner-a', clientActivityId: 'activity-a', baseArtifact: baseArtifact(),
    });
    await cancelActivityFinalRefinement('owner-a', 'activity-a');
    await expect(resumeActivityFinalRefinement('owner-a', 'activity-a')).resolves.toBe('cancelled');
    expect(pendingMocks.savePending).not.toHaveBeenCalled();
    expect(await readActivityFinalRefinementJob('owner-a', 'activity-a')).toMatchObject({
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
});
