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

import React, { useMemo, useEffect } from 'react';
import { StyleSheet, View, Platform } from 'react-native';
import { getMapbox } from '../services/mapboxAdapter';
import { useMarkerStore } from '../../../store/useMarkerStore';
import { MemoryColors } from '../config/memoryConfig';
import { FogLayer } from './FogLayer';
import { CairnPinsLayer } from './CairnPinsLayer';
import { log } from '../../../services/appLog';

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

  if (!Mapbox.available) {
    return <View style={styles.webStub} />;
  }

  const { MapView, Camera, UserLocation } = Mapbox;

  // V8 + R-round B8: cameraKey changes ONLY when recenterToken bumps.
  // The previous fix included centerLat/Lng (toFixed(4) ≈ 11m precision)
  // which caused Camera to remount on every watcher tick when the user
  // walks — interrupting flyTo animations every ~1s. centerCoordinate
  // is still passed as a prop, so manual recenter (recenterToken++)
  // forces a fresh flyTo to the current center; passive watcher
  // updates flow through prop change without remount.
  const cameraKey = useMemo(
    () => `cam-${recenterToken}`,
    [recenterToken]
  );

  // V8 telemetry: log every cameraKey change so the dev team can see
  // whether the recenter button actually triggers remount.
  useEffect(() => {
    log('memory.map_camera_key', { cameraKey, recenterToken });
  }, [cameraKey, recenterToken]);

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

