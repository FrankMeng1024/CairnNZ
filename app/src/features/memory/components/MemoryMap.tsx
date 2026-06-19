/**
 * MemoryMap — Mapbox layer + sepia fog overlay + cairn pins.
 *
 * v0.2.6.4 (S2 fix): Camera uses centerCoordinate prop directly (no
 * key remount on prop change). `recenterToken` bump forces a Camera
 * remount which retriggers flyTo to the latest center. Without
 * remount, native @rnmapbox/maps Camera doesn't follow centerCoordinate
 * updates after first mount — so the user dot moved but the map
 * didn't pan.
 */

import React, { useMemo } from 'react';
import { StyleSheet, View, Platform } from 'react-native';
import { getMapbox } from '../services/mapboxAdapter';
import { useMarkerStore } from '../../../store/useMarkerStore';
import { MemoryColors } from '../config/memoryConfig';
import { FogLayer } from './FogLayer';
import { CairnPinsLayer } from './CairnPinsLayer';

interface Props {
  centerLat: number;
  centerLng: number;
  /**
   * Bumping this number triggers Camera flyTo (recenter). Parent
   * uses it for the recenter button.
   */
  recenterToken?: number;
}

const SEPIA_STYLE_URL = 'mapbox://styles/mapbox/outdoors-v12';

export function MemoryMap({ centerLat, centerLng, recenterToken = 0 }: Props) {
  const Mapbox = getMapbox();
  const allMarkers = useMarkerStore((s) => s.markers);

  if (!Mapbox.available || Platform.OS === 'web') {
    return <View style={styles.webStub} />;
  }

  const { MapView, Camera, UserLocation } = Mapbox;

  // S2 fix: cameraKey changes when EITHER recenterToken bumps OR
  // center coords change appreciably. The coord delta gate
  // (rounded to ~10m) prevents micro-drift from re-mounting Camera
  // on every watcher tick — that would re-trigger flyTo, costing
  // animation frames. Big jumps (>~10m) and recenter taps both
  // re-mount and animate.
  const cameraKey = useMemo(
    () => `cam-${recenterToken}-${centerLat.toFixed(4)}-${centerLng.toFixed(4)}`,
    [recenterToken, centerLat, centerLng]
  );

  return (
    <View style={styles.container}>
      <MapView
        style={styles.map}
        styleURL={SEPIA_STYLE_URL}
        compassEnabled={false}
        scaleBarEnabled={false}
      >
        <Camera
          key={cameraKey}
          centerCoordinate={[centerLng, centerLat]}
          zoomLevel={16.5}
          animationMode={'flyTo'}
          animationDuration={600}
        />
        <UserLocation visible={true} />
        <FogLayer />
        <CairnPinsLayer markers={allMarkers} centerLat={centerLat} centerLng={centerLng} />
      </MapView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  map: { flex: 1 },
  webStub: { flex: 1, backgroundColor: MemoryColors.cream },
});

