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
