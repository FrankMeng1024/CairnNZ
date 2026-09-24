import type { Marker } from '../../store/useMarkerStore';

export function markerBelongsToVisibleWorkspace(marker: Marker, qaWorkspaceActive: boolean): boolean {
  return marker.qaProvenance !== 'simulator_test' || qaWorkspaceActive;
}

/** Personal and Simulator evidence share renderers, never persistence truth. */
export function markersForVisibleWorkspace(markers: Marker[], qaWorkspaceActive: boolean): Marker[] {
  return markers.filter(marker => markerBelongsToVisibleWorkspace(marker, qaWorkspaceActive));
}
