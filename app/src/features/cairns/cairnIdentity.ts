import type { Marker } from '../../store/useMarkerStore';

/** Every identifier that may legitimately refer to the same owned Cairn. */
export function cairnIdentityKeys(marker: Pick<Marker, 'id' | 'clientCairnId' | 'serverCairnId' | 'localId'>): string[] {
  return [marker.clientCairnId, marker.localId, marker.id, marker.serverCairnId]
    .filter((value, index, values): value is string => Boolean(value) && values.indexOf(value) === index);
}

/** The durable client identity wins; legacy rows fall back to their current id. */
export function cairnStableId(marker: Pick<Marker, 'id' | 'clientCairnId' | 'localId'>): string {
  return marker.clientCairnId ?? marker.localId ?? marker.id;
}

export function cairnMatchesIdentity(
  marker: Pick<Marker, 'id' | 'clientCairnId' | 'serverCairnId' | 'localId'>,
  targetId: string,
): boolean {
  return cairnIdentityKeys(marker).includes(String(targetId));
}

function isLocallyAuthoritative(marker: Marker): boolean {
  return marker.syncState === 'pending'
    || marker.syncState === 'syncing'
    || marker.syncState === 'failed';
}

function mergePair(cached: Marker, server: Marker): Marker {
  const cachedNewer = (cached.updatedAt ?? 0) > (server.updatedAt ?? 0);
  const contentAuthority = isLocallyAuthoritative(cached) || cachedNewer ? cached : server;
  return {
    ...server,
    ...contentAuthority,
    id: cairnStableId(cached),
    clientCairnId: cached.clientCairnId ?? server.clientCairnId,
    localId: cached.localId ?? server.localId ?? server.clientCairnId,
    serverCairnId: server.serverCairnId ?? cached.serverCairnId,
    authorId: server.authorId || cached.authorId,
    synced: isLocallyAuthoritative(cached) ? cached.synced : true,
    syncState: isLocallyAuthoritative(cached) ? cached.syncState : 'synced',
  };
}

/**
 * Merge owner-scoped cache/outbox projections with server history without
 * duplicating acknowledgement shapes or reviving tombstoned client ids.
 */
export function mergeOwnedCairns(
  cached: ReadonlyArray<Marker>,
  server: ReadonlyArray<Marker>,
  tombstonedClientIds: ReadonlySet<string> = new Set(),
): Marker[] {
  const merged: Marker[] = [];

  const add = (candidate: Marker, fromCache: boolean) => {
    if (cairnIdentityKeys(candidate).some(id => tombstonedClientIds.has(id))) return;
    const index = merged.findIndex(existing => (
      cairnIdentityKeys(existing).some(id => cairnIdentityKeys(candidate).includes(id))
    ));
    if (index === -1) {
      merged.push(candidate);
      return;
    }
    merged[index] = fromCache
      ? mergePair(candidate, merged[index])
      : mergePair(merged[index], candidate);
  };

  server.forEach(marker => add(marker, false));
  cached.forEach(marker => add(marker, true));
  return merged.sort((a, b) => {
    const time = (b.createdAt ?? 0) - (a.createdAt ?? 0);
    return time || cairnStableId(a).localeCompare(cairnStableId(b));
  });
}
