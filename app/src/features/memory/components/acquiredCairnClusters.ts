import type { AcquiredCairnMapMarker } from '../../cairns/cairnPresentationStore';

export async function loadAllClusterLeaves(
  source: { getClusterLeaves?: (feature: unknown, limit: number, offset: number) => Promise<any> } | null,
  feature: unknown,
  expectedCount: number,
  pageSize = 50,
): Promise<any[]> {
  if (!source?.getClusterLeaves || expectedCount <= 0) return [];
  const result: any[] = [];
  const seen = new Set<string>();
  for (let offset = 0; offset < expectedCount; offset += pageSize) {
    const requested = Math.min(pageSize, expectedCount - offset);
    const response = await source.getClusterLeaves(feature, requested, offset);
    const page = Array.isArray(response?.features) ? response.features : Array.isArray(response) ? response : [];
    for (const leaf of page) {
      const id = String(leaf?.properties?.markerId ?? leaf?.id ?? '');
      if (!id || seen.has(id)) continue;
      seen.add(id);
      result.push(leaf);
    }
    if (page.length < requested) break;
  }
  return result;
}

export function buildAcquiredCairnFeatureCollection(markers: AcquiredCairnMapMarker[]) {
  return {
    type: 'FeatureCollection' as const,
    features: markers.map(marker => ({
      type: 'Feature' as const,
      id: marker.markerId,
      properties: {
        markerId: marker.markerId,
        unread: marker.unread ? 1 : 0,
        friends: marker.sourceAudience === 'friends' ? 1 : 0,
        public: marker.sourceAudience === 'public' ? 1 : 0,
        title: marker.title ?? '',
        preview: marker.preview ?? '',
        revisionCount: marker.revisionCount ?? 1,
      },
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
