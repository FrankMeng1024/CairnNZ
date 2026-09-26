import type { TrackingSession } from '../../store/useSessionStore';

function clientIdentity(session: TrackingSession): string | null {
  if (session.clientActivityId) return session.clientActivityId;
  return /^\d+$/.test(session.id) ? null : session.id;
}

function serverIdentity(session: TrackingSession): number | null {
  return session.remoteId ?? session.serverActivityId ?? (/^\d+$/.test(session.id) ? Number(session.id) : null);
}

export function sameActivityIdentity(a: TrackingSession, b: TrackingSession): boolean {
  const aClient = clientIdentity(a);
  const bClient = clientIdentity(b);
  // Once both sides have immutable business IDs, a numeric collision is a
  // reconciliation fault, never permission to merge two real Activities.
  if (aClient && bClient) return aClient === bClient;
  const aServer = serverIdentity(a);
  const bServer = serverIdentity(b);
  return aServer != null && bServer != null && aServer === bServer;
}

/**
 * Merge an authenticated server list into durable local history without
 * interpreting absence as deletion. Explicit local/server delete paths own
 * deletion; a stale, partial, empty, or delayed list response never does.
 */
export function mergeHydratedSessionLists(
  localSessions: TrackingSession[],
  remoteSessions: TrackingSession[],
): TrackingSession[] {
  const consumedLocals = new Set<number>();
  const mergedRemote = remoteSessions.flatMap((remote) => {
    const remoteClient = clientIdentity(remote);
    const remoteServer = serverIdentity(remote);
    let localIndex = -1;
    let bestScore = -1;
    localSessions.forEach((local, index) => {
      if (consumedLocals.has(index) || !sameActivityIdentity(local, remote)) return;
      const localClient = clientIdentity(local);
      const localServer = serverIdentity(local);
      const score = localClient && remoteClient && localClient === remoteClient && localServer === remoteServer
        ? 3
        : local.identityConflict?.role === 'remote-quarantine' && localServer === remoteServer
          ? 2
          : 1;
      if (score > bestScore) {
        bestScore = score;
        localIndex = index;
      }
    });
    if (localIndex < 0) return [remote];
    consumedLocals.add(localIndex);
    const local = localSessions[localIndex];
    const localServer = serverIdentity(local);
    const conflictingServerMapping = clientIdentity(local) === clientIdentity(remote)
      && localServer != null
      && remoteServer != null
      && localServer !== remoteServer;
    const localStillOwnsSync = local.syncState === 'pending'
      || local.syncState === 'syncing'
      || local.syncState === 'sync_error';
    const merged: TrackingSession = {
      ...local,
      ...remote,
      // Local client identity and durable content references remain stable
      // while the server contributes its numeric mapping and fresh summary.
      id: local.id,
      clientActivityId: local.clientActivityId ?? remote.clientActivityId,
      remoteId: conflictingServerMapping ? local.remoteId : (remote.remoteId ?? local.remoteId),
      serverActivityId: conflictingServerMapping
        ? local.serverActivityId
        : (remote.serverActivityId ?? local.serverActivityId),
      trackPoints: local.trackPoints,
      markerIds: local.markerIds,
      syncState: conflictingServerMapping
        ? 'sync_error'
        : localStillOwnsSync ? local.syncState : 'synced',
      syncFailureKind: conflictingServerMapping
        ? 'action_required'
        : localStillOwnsSync ? local.syncFailureKind : undefined,
      syncFailureStatus: conflictingServerMapping
        ? 409
        : localStillOwnsSync ? local.syncFailureStatus : undefined,
      syncFailureCode: conflictingServerMapping
        ? 'ACTIVITY_IDENTITY_CONFLICT'
        : localStillOwnsSync ? local.syncFailureCode : undefined,
      finalGeometryState: local.finalGeometryState ?? remote.finalGeometryState,
      finalGeometryVersion: local.finalGeometryVersion ?? remote.finalGeometryVersion,
      ...(conflictingServerMapping ? {
        identityConflict: {
          kind: 'server_mapping' as const,
          localServerId: localServer as number,
          remoteServerId: remoteServer as number,
          role: 'local' as const,
        },
      } : {}),
    };
    if (!conflictingServerMapping) return [merged];
    // Keep the contradictory server record as a separate quarantined row.
    // Both rows remain visible/action-required and mutation paths gate on the
    // conflict marker; no title or timestamp heuristic chooses a winner.
    const quarantinedRemote: TrackingSession = {
      ...remote,
      id: `identity-conflict:${remote.clientActivityId ?? remote.id}:${remoteServer}`,
      syncState: 'sync_error',
      syncFailureKind: 'action_required',
      syncFailureStatus: 409,
      syncFailureCode: 'ACTIVITY_IDENTITY_CONFLICT',
      identityConflict: {
        kind: 'server_mapping',
        localServerId: localServer as number,
        remoteServerId: remoteServer as number,
        role: 'remote-quarantine',
      },
    };
    return [merged, quarantinedRemote];
  });
  const localOnly = localSessions.filter((_, index) => !consumedLocals.has(index));
  return [...mergedRemote, ...localOnly].sort((a, b) => b.startedAt - a.startedAt);
}
