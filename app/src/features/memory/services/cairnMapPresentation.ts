import type { Marker } from '../../../store/useMarkerStore';
import type { AcquiredCairnMapMarker } from '../../cairns/cairnPresentationStore';

/** Keep the acquired collection layer as the single presentation authority
 * for immutable Friend acquisitions that also arrive through circleMarkers. */
export function excludeAcquiredFriendMarkers(
  markers: Marker[],
  acquiredMarkers: AcquiredCairnMapMarker[],
): Marker[] {
  const acquiredIds = new Set(acquiredMarkers.map(marker => marker.markerId));
  return markers.filter(marker => !acquiredIds.has(String(marker.serverCairnId ?? marker.id)));
}

/** Friends is a composite presentation, never a replacement for Mine. */
export function markersForMemoryScope(
  scope: 'self' | 'combined',
  ownMarkers: Marker[],
  friendMarkers: Marker[],
  acquiredMarkers: AcquiredCairnMapMarker[],
): Marker[] {
  if (scope === 'self') return ownMarkers;
  const seen = new Set(ownMarkers.map(marker => String(marker.id)));
  return [...ownMarkers, ...excludeAcquiredFriendMarkers(
    friendMarkers.filter(marker => !seen.has(String(marker.id))),
    acquiredMarkers,
  )];
}
