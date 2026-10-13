import type { AcquiredCairnMapMarker } from '../../cairns/cairnPresentationStore';

export function buildAcquiredCairnFeatureCollection(markers: AcquiredCairnMapMarker[]) {
  return {
    type: 'FeatureCollection' as const,
    features: markers.map(marker => ({
      type: 'Feature' as const,
      id: marker.markerId,
      properties: { markerId: marker.markerId, unread: marker.unread ? 1 : 0 },
      geometry: { type: 'Point' as const, coordinates: [marker.lng, marker.lat] },
    })),
  };
}

function rowPriority(marker: AcquiredCairnMapMarker): number {
  if (marker.unread && marker.currentFriend) return 3;
  if (marker.currentFriend) return 2;
  if (marker.unread) return 1;
  return 0;
}

export function stableAcquiredGroupOrder(markerIds: string[], markers: AcquiredCairnMapMarker[]): string[] {
  const requested = new Set(markerIds);
  return markers
    .filter(marker => requested.has(marker.markerId))
    .sort((a, b) => rowPriority(b) - rowPriority(a)
      || (Date.parse(b.acquiredAt ?? '') || 0) - (Date.parse(a.acquiredAt ?? '') || 0)
      || a.markerId.localeCompare(b.markerId))
    .map(marker => marker.markerId);
}
