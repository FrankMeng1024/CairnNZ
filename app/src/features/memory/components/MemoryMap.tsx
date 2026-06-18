/**
 * MemoryMap — Mapbox layer + sepia fog overlay + cairn pins.
 *
 * This component is the visual heart of Memory mode. Three layers from
 * bottom to top:
 *   1. Mapbox base style (sepia / outdoors-v12 with custom paint).
 *   2. Fog overlay (FillLayer with explored regions cut out).
 *   3. Cairn pins (mystery in fog, revealed in clear).
 *
 * Logic for "what is explored" comes from useMemoryStore.
 * Logic for "which cairns are visible at current zoom" comes from
 * MysteryVisibilityConfig in memoryConfig.
 *
 * NOTE — v0.2.6 MVP scope: this is a structural skeleton. The actual
 * fog FillLayer GeoJSON generation and the cairn rendering are stubs
 * marked with `// TODO(v0.2.6 §X)` so the full feature can be filled
 * in incrementally without restructuring.
 */

import React, { useMemo } from 'react';
import { StyleSheet, View, Platform } from 'react-native';
import { getMapbox } from '../services/mapboxAdapter';
import { useMemoryStore } from '../store/useMemoryStore';
import { useMarkerStore } from '../../../store/useMarkerStore';
import { MemoryColors } from '../config/memoryConfig';
import { FogLayer } from './FogLayer';
import { CairnPinsLayer } from './CairnPinsLayer';

interface Props {
  centerLat: number;
  centerLng: number;
}

const SEPIA_STYLE_URL = 'mapbox://styles/mapbox/outdoors-v12'; // TODO(v0.2.6 §A): custom Topo50 style

export function MemoryMap({ centerLat, centerLng }: Props) {
  const Mapbox = getMapbox();
  const exploredTiles = useMemoryStore((s) => s.tiles);
  const allMarkers = useMarkerStore((s) => s.markers);

  // Web fallback — Mapbox isn't available.
  if (!Mapbox.available || Platform.OS === 'web') {
    return <View style={styles.webStub} />;
  }

  const { MapView, Camera, UserLocation } = Mapbox;

  return (
    <View style={styles.container}>
      <MapView
        style={styles.map}
        styleURL={SEPIA_STYLE_URL}
        compassEnabled={false}
        scaleBarEnabled={false}
      >
        <Camera
          centerCoordinate={[centerLng, centerLat]}
          zoomLevel={15}
          animationMode={'flyTo'}
          animationDuration={500}
        />
        <UserLocation visible={true} />
        <FogLayer exploredTiles={exploredTiles} />
        <CairnPinsLayer markers={allMarkers} centerLat={centerLat} centerLng={centerLng} />
      </MapView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  map: { flex: 1 },
  webStub: {
    flex: 1,
    backgroundColor: MemoryColors.cream,
  },
});
