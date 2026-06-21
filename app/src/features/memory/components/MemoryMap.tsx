/**
 * MemoryMap — Mapbox view + sepia fog overlay + cairn pins.
 *
 * Wires together:
 *   - Mapbox MapView/Camera (cross-platform via mapboxAdapter)
 *   - FogLayer (needs current viewport bounds — see N5 root cause work,
 *     mapbox-gl-js can't render a world-spanning polygon so the fog
 *     outer ring is built from the visible bounds)
 *   - CairnPinsLayer (markers within the explored area)
 *   - UserLocation (the blue dot)
 *
 * recenterToken bump forces Camera remount → fresh flyTo to the current
 * `centerCoordinate`. Without remount, native @rnmapbox/maps' Camera
 * doesn't follow centerCoordinate prop updates after first mount.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { getMapbox } from '../services/mapboxAdapter';
import { useMarkerStore } from '../../../store/useMarkerStore';
import { MemoryColors } from '../config/memoryConfig';
import { FogLayer } from './FogLayer';
import { FogBounds } from '../services/fogBuilder';
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
const INITIAL_ZOOM = 16.5;

/**
 * Estimate the viewport bounds before the first onMapIdle fires. Lets
 * FogLayer render fog immediately on first mount instead of waiting
 * for the camera to settle.
 *
 * Sized to match the visible viewport at INITIAL_ZOOM (16.5) on a
 * typical phone-sized map — at lat ~31° that's roughly 0.005° wide,
 * 0.002° tall. We pick slightly larger to account for tall phone
 * aspect ratios. The first onMapIdle event replaces this estimate.
 */
function estimateInitialBounds(centerLat: number, centerLng: number): FogBounds {
  // ≈ 0.005° = 550m at lat 31°, slightly bigger than visible viewport
  const halfDegLng = 0.005;
  const halfDegLat = 0.003;
  return {
    west: centerLng - halfDegLng,
    east: centerLng + halfDegLng,
    north: centerLat + halfDegLat,
    south: centerLat - halfDegLat,
  };
}

export function MemoryMap({ centerLat, centerLng, recenterToken = 0 }: Props) {
  const Mapbox = getMapbox();
  const allMarkers = useMarkerStore((s) => s.markers);

  const [bounds, setBounds] = useState<FogBounds>(() =>
    estimateInitialBounds(centerLat, centerLng)
  );

  /**
   * Update bounds only if the new bounds differ from current beyond a
   * small epsilon. mapbox-gl's onIdle fires after every micro-movement
   * (including the user-location dot's reflow), and replacing the bounds
   * object on every fire would re-trigger fogBuilder for a 571-hole
   * polygon — causing the source's tiles to enter permanent 'reloading'
   * and never finish painting.
   */
  const updateBoundsIfChanged = useCallback((next: FogBounds) => {
    setBounds((prev) => {
      const eps = 1e-5; // ≈ 1m at lat 31°
      if (
        Math.abs(prev.west - next.west) < eps &&
        Math.abs(prev.east - next.east) < eps &&
        Math.abs(prev.north - next.north) < eps &&
        Math.abs(prev.south - next.south) < eps
      ) {
        return prev; // same object reference → useMemo upstream skips
      }
      return next;
    });
  }, []);

  // Update initial bounds estimate if the center coord changes (e.g.
  // navigation re-enter at a different location) BEFORE the first
  // onMapIdle fires.
  useEffect(() => {
    updateBoundsIfChanged(estimateInitialBounds(centerLat, centerLng));
  }, [centerLat, centerLng, updateBoundsIfChanged]);

  /**
   * onMapIdle receives a synthesized event from the adapter with
   * properties.center and properties.zoom. We approximate viewport
   * bounds from these — both native and web shims expose these fields
   * uniformly so the math is platform-agnostic.
   */
  const onMapSettle = useCallback((feature: any) => {
    const center = feature?.properties?.center;
    const zoom = feature?.properties?.zoom;
    if (!Array.isArray(center) || center.length < 2 || typeof zoom !== 'number') return;
    // Approximate degrees-per-screen at this zoom using a standard
    // Web Mercator m/px formula. We use a generous half-width that
    // safely covers all phone aspect ratios.
    const metersPerPixel = (Math.cos(center[1] * Math.PI / 180) * 2 * Math.PI * 6378137) /
                           (256 * Math.pow(2, zoom));
    const halfMeters = metersPerPixel * 400; // 800px viewport, half
    const dLatPerM = 1 / 111_000;
    const cosLat = Math.max(Math.cos(center[1] * Math.PI / 180), 1e-6);
    const dLngPerM = dLatPerM / cosLat;
    const halfLat = halfMeters * dLatPerM;
    const halfLng = halfMeters * dLngPerM;
    updateBoundsIfChanged({
      west: center[0] - halfLng,
      east: center[0] + halfLng,
      north: Math.min(85.05, center[1] + halfLat),
      south: Math.max(-85.05, center[1] - halfLat),
    });
  }, [updateBoundsIfChanged]);

  // Camera key remount strategy — bumping recenterToken alone triggers
  // a fresh flyTo to the current center. Center prop changes flow into
  // Camera without remount (native @rnmapbox doesn't follow prop
  // changes well, but the recenter button bumps the token to compensate).
  const cameraKey = useMemo(() => `cam-${recenterToken}`, [recenterToken]);

  useEffect(() => {
    log('memory.map_camera_key', { cameraKey, recenterToken });
  }, [cameraKey, recenterToken]);

  if (!Mapbox.available) {
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
        onMapIdle={onMapSettle}
      >
        <Camera
          key={cameraKey}
          centerCoordinate={[centerLng, centerLat]}
          zoomLevel={INITIAL_ZOOM}
          animationMode={'flyTo'}
          animationDuration={600}
        />
        <UserLocation visible={true} />
        <FogLayer bounds={bounds} />
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
