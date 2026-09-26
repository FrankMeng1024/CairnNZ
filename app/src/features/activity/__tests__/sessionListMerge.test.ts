import type { TrackingSession } from '../../../store/useSessionStore';
import { mergeHydratedSessionLists } from '../sessionListMerge';

function session(input: Partial<TrackingSession> & Pick<TrackingSession, 'id' | 'startedAt'>): TrackingSession {
  return {
    activityMode: 'hiking',
    regionCode: 'nz',
    endedAt: input.startedAt + 60_000,
    durationS: 60,
    distanceM: 100,
    elevationGainM: 0,
    trackPoints: [],
    markerIds: [],
    ...input,
  };
}

describe('loss-resistant Activity list reconciliation', () => {
  test('stale empty server list preserves two same-named Hikes and a Run', () => {
    const local = [
      session({ id: 'hike-b', clientActivityId: 'hike-b', startedAt: 300, name: 'seems lost', syncState: 'synced', remoteId: 2098 }),
      session({ id: 'hike-a', clientActivityId: 'hike-a', startedAt: 200, name: 'seems lost', syncState: 'sync_error', remoteId: 2097 }),
      session({ id: 'run-a', clientActivityId: 'run-a', startedAt: 100, name: 'lost', activityMode: 'running', syncState: 'synced', remoteId: 2096 }),
    ];
    expect(mergeHydratedSessionLists(local, []).map(item => item.id)).toEqual([
      'hike-b', 'hike-a', 'run-a',
    ]);
  });

  test('reconciles only stable identity and never merges matching titles', () => {
    const local = [
      session({ id: 'hike-a', clientActivityId: 'uuid-a', startedAt: 200, name: 'seems lost', syncState: 'sync_error' }),
      session({ id: 'hike-b', clientActivityId: 'uuid-b', startedAt: 300, name: 'seems lost', syncState: 'synced', remoteId: 2098 }),
    ];
    const remote = [
      session({ id: 'uuid-b', clientActivityId: 'uuid-b', startedAt: 300, name: 'seems lost', remoteId: 2098, serverActivityId: 2098, syncState: 'synced' }),
    ];
    const result = mergeHydratedSessionLists(local, remote);
    expect(result).toHaveLength(2);
    expect(result.map(item => item.clientActivityId)).toEqual(['uuid-b', 'uuid-a']);
    expect(result.find(item => item.clientActivityId === 'uuid-a')?.syncState).toBe('sync_error');
  });

  test('server refresh cannot erase local final-display revision or pending ownership', () => {
    const local = session({
      id: 'local-a',
      clientActivityId: 'uuid-a',
      startedAt: 100,
      remoteId: 91,
      syncState: 'pending',
      syncFailureKind: 'retryable',
      syncFailureStatus: 503,
      syncFailureCode: 'UPSTREAM_DOWN',
      finalGeometryState: 'enhanced',
      finalGeometryVersion: 'pedestrian-final-v2-base',
      trackPoints: [{ lat: -41, lng: 174, t: 100 }],
    });
    const remote = session({
      id: 'uuid-a',
      clientActivityId: 'uuid-a',
      startedAt: 100,
      remoteId: 91,
      serverActivityId: 91,
      syncState: 'synced',
      trackPoints: [],
    });
    expect(mergeHydratedSessionLists([local], [remote])).toEqual([
      expect.objectContaining({
        id: 'local-a',
        syncState: 'pending',
        syncFailureKind: 'retryable',
        syncFailureStatus: 503,
        syncFailureCode: 'UPSTREAM_DOWN',
        finalGeometryState: 'enhanced',
        trackPoints: [{ lat: -41, lng: 174, t: 100 }],
      }),
    ]);
  });

  test('different client UUIDs remain distinct even if a corrupt numeric mapping collides', () => {
    const local = session({ id: 'local-a', clientActivityId: 'uuid-a', startedAt: 200, remoteId: 91 });
    const remote = session({ id: 'uuid-b', clientActivityId: 'uuid-b', startedAt: 100, remoteId: 91 });
    const result = mergeHydratedSessionLists([local], [remote]);
    expect(result).toHaveLength(2);
    expect(result.map(item => item.clientActivityId)).toEqual(['uuid-a', 'uuid-b']);
  });

  test('same client UUID with conflicting numeric mappings keeps local evidence and flags reconciliation', () => {
    const local = session({ id: 'local-a', clientActivityId: 'uuid-a', startedAt: 100, remoteId: 91 });
    const remote = session({ id: 'uuid-a', clientActivityId: 'uuid-a', startedAt: 100, remoteId: 92, serverActivityId: 92 });
    const result = mergeHydratedSessionLists([local], [remote]);
    expect(result).toHaveLength(2);
    expect(result).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'local-a',
        remoteId: 91,
        identityConflict: {
          kind: 'server_mapping', localServerId: 91, remoteServerId: 92, role: 'local',
        },
        syncState: 'sync_error',
        syncFailureKind: 'action_required',
        syncFailureCode: 'ACTIVITY_IDENTITY_CONFLICT',
      }),
      expect.objectContaining({
        id: 'identity-conflict:uuid-a:92',
        remoteId: 92,
        identityConflict: {
          kind: 'server_mapping', localServerId: 91, remoteServerId: 92, role: 'remote-quarantine',
        },
        syncState: 'sync_error',
      }),
    ]));
    // A later hydrate updates the quarantined server row instead of growing
    // another duplicate, while the local contradictory mapping remains.
    expect(mergeHydratedSessionLists(result, [remote])).toHaveLength(2);
  });
});
