const mockValues = new Map<string, string>();

jest.mock('../../../store/storage', () => ({
  storage: {
    getItem: jest.fn(async (key: string) => mockValues.get(key) ?? null),
    setItem: jest.fn(async (key: string, value: string) => { mockValues.set(key, value); }),
    removeItem: jest.fn(async (key: string) => { mockValues.delete(key); }),
  },
}));
jest.mock('../../../services/sessionService', () => ({
  deleteRemoteSession: jest.fn(),
  deleteRemoteSessionByClientId: jest.fn(),
  renameRemoteSession: jest.fn(),
}));
jest.mock('../activityRegistry', () => ({
  getActivityRegistry: jest.fn(async () => ({ completed: [], unfinished: null })),
  isActivityTombstoned: jest.fn(async () => false),
  markActivityLocalArtifactsCleaned: jest.fn(async () => undefined),
  tombstoneActivity: jest.fn(async () => undefined),
}));
jest.mock('../../../services/crashLogger', () => ({
  crashLogger: { breadcrumb: jest.fn() },
}));

import { useSessionStore, type TrackingSession } from '../../../store/useSessionStore';

const baseSession = (): TrackingSession => ({
  id: 'activity-a',
  clientActivityId: 'activity-a',
  remoteId: 2162,
  serverActivityId: 2162,
  activityMode: 'hiking',
  regionCode: 'nz',
  startedAt: 1_000,
  endedAt: 2_000,
  durationS: 60,
  distanceM: 100,
  elevationGainM: 4,
  trackPoints: [
    { lat: -41, lng: 174, t: 1_000 },
    { lat: -41.001, lng: 174.001, t: 2_000 },
  ],
  markerIds: [],
  syncState: 'synced',
  finalGeometryState: 'base_ready',
  finalGeometryRevision: 1,
  finalGeometryFingerprint: 'base',
});

describe('Activity Final publication preserves server ACK authority', () => {
  beforeEach(() => {
    mockValues.clear();
    useSessionStore.setState({ sessions: [], currentUserId: 'owner-a' });
  });

  test('a late optional geometry upsert cannot regress synced to pending', async () => {
    await useSessionStore.getState().addSession(baseSession(), 'owner-a');

    await useSessionStore.getState().addSession({
      ...baseSession(),
      trackPoints: [
        { lat: -41, lng: 174, t: 1_000 },
        { lat: -41.0005, lng: 174.0004, t: 1_500 },
        { lat: -41.001, lng: 174.001, t: 2_000 },
      ],
      syncState: 'pending',
      finalGeometryState: 'enhanced',
      finalGeometryRevision: 2,
      finalGeometryFingerprint: 'refined',
    }, 'owner-a');

    expect(useSessionStore.getState().sessions).toEqual([
      expect.objectContaining({
        id: 'activity-a',
        remoteId: 2162,
        serverActivityId: 2162,
        syncState: 'synced',
        finalGeometryState: 'enhanced',
        finalGeometryRevision: 2,
        finalGeometryFingerprint: 'refined',
        trackPoints: expect.arrayContaining([
          expect.objectContaining({ t: 1_500 }),
        ]),
      }),
    ]);
  });
});
