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

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View, TouchableOpacity } from 'react-native';
import { getMapbox } from '../services/mapboxAdapter';
import { useMarkerStore } from '../../../store/useMarkerStore';
import { MemoryColors } from '../config/memoryConfig';
import { FogLayer } from './FogLayer';
import { FogBounds } from '../services/fogBuilder';
import { CairnPinsLayer } from './CairnPinsLayer';
import { log } from '../../../services/appLog';
import { Icon } from '../../../components/Icon';
import { Colors } from '../../../components/tokens';
import { haversineM } from '../../../utils/geo';
import { useMemoryFogControl, type FogRenderMode } from './MemoryFogControl';

interface Props {
  centerLat: number;
  centerLng: number;
  /**
   * Bumping this number triggers Camera flyTo (recenter). Parent
   * uses it for the recenter button.
   */
  recenterToken?: number;
  /**
   * v303: fog rendering mode. Default 'legacy' (existing polygon-with-
   * holes path) until users opt-in to a native SDF mode.
   * - 'legacy'   — current FogLayer (JS, polygon-union + holes)
   * - 'off'      — no fog at all (debug)
   * - 'sdf-soft' — native Metal SDF with feathered soft edge (~30%)
   * - 'sdf-sharp'— native Metal SDF with hard edge
   */
  fogMode?: FogRenderMode;
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

export function MemoryMap({ centerLat, centerLng, recenterToken = 0, fogMode = 'legacy' }: Props) {
  const Mapbox = getMapbox();
  const allMarkers = useMarkerStore((s) => s.markers);
  // v303: ref to the actual MapView so the native fog module can
  // find its reactTag via findNodeHandle.
  const mapViewRef = useRef<any>(null);

  // v303: drive the native Metal SDF fog layer. No-op when fogMode
  // is 'legacy' — the JS <FogLayer> below handles that case.
  useMemoryFogControl({ mapViewRef, mode: fogMode });

  const [bounds, setBounds] = useState<FogBounds>(() =>
    estimateInitialBounds(centerLat, centerLng)
  );
  // v302 N6: track whether the user has panned the map away from
  // the GPS-driven center. Hiking-style: don't auto-follow user
  // location; instead expose a recenter pill when the camera drifts
  // beyond ~50m of the GPS fix. Same UX as HikingScreen.
  const [hasPannedAway, setHasPannedAway] = useState(false);
  // We anchor on the first known center (the GPS fix at mount time)
  // — not the live coord prop, which would let `centerCoord` updates
  // from the watcher quietly drag the "did the user pan?" baseline.
  const anchorRef = useRef({ lat: centerLat, lng: centerLng });
  const cameraRef = useRef<any>(null);

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

  // Update initial bounds estimate only on FIRST mount. After that,
  // watcher-driven centerLat/Lng prop changes must NOT recompute
  // bounds (v302 N6: the Camera is intentionally not following the
  // watcher; rebuilding fog bounds on every push would still trigger
  // fogBuilder work for a map view that never moved).
  const firstBoundsSetRef = useRef(false);
  useEffect(() => {
    if (firstBoundsSetRef.current) return;
    firstBoundsSetRef.current = true;
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

    // v302 N6: compare the settled center to the GPS anchor. If the
    // user panned > 50m away, surface the recenter pill (same as
    // HikingScreen's followUser=false UX).
    const dist = haversineM(
      { lat: anchorRef.current.lat, lng: anchorRef.current.lng },
      { lat: center[1], lng: center[0] }
    );
    const panned = dist > 50;
    setHasPannedAway((prev) => (prev === panned ? prev : panned));

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

  // v302 N6: when the recenter button bumps the token, re-anchor on
  // the current GPS coord and reset the pan-away flag. The Camera is
  // also remounted (via cameraKey) so it flies to the new center.
  useEffect(() => {
    if (recenterToken > 0) {
      anchorRef.current = { lat: centerLat, lng: centerLng };
      setHasPannedAway(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recenterToken]);

  const onRecenter = useCallback(() => {
    log('memory.map_recenter_btn');
    anchorRef.current = { lat: centerLat, lng: centerLng };
    setHasPannedAway(false);
    cameraRef.current?.setCamera?.({
      centerCoordinate: [centerLng, centerLat],
      zoomLevel: INITIAL_ZOOM,
      animationDuration: 600,
    });
  }, [centerLat, centerLng]);

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
        ref={mapViewRef}
        style={styles.map}
        styleURL={SEPIA_STYLE_URL}
        compassEnabled={false}
        scaleBarEnabled={false}
        onMapIdle={onMapSettle}
      >
        <Camera
          ref={cameraRef}
          key={cameraKey}
          // v302 N6: defaultSettings (instead of centerCoordinate prop)
          // so a centerLat/Lng prop change (e.g. watcher push) does NOT
          // auto-fly back to the user's current position. The user
          // explicitly drives recenter via the pill button.
          defaultSettings={{
            centerCoordinate: [centerLng, centerLat],
            zoomLevel: INITIAL_ZOOM,
          }}
          animationMode={'flyTo'}
          animationDuration={600}
        />
        <UserLocation visible={true} />
        {/* v303: only mount JS FogLayer in 'legacy' mode. Other
            modes are rendered by the native Metal SDF layer via
            useMemoryFogControl. */}
        {fogMode === 'legacy' && <FogLayer bounds={bounds} />}
        <CairnPinsLayer markers={allMarkers} centerLat={centerLat} centerLng={centerLng} />
      </MapView>
      {/* v302 N6: recenter pill — shown after user pans away. Same
          interaction as HikingScreen.tsx Target button. */}
      {hasPannedAway && (
        <TouchableOpacity style={styles.recenterBtn} onPress={onRecenter} activeOpacity={0.85}>
          <Icon name="Target" size={22} color={Colors.primary} strokeWidth={2} />
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  map: { flex: 1 },
  webStub: { flex: 1, backgroundColor: MemoryColors.cream },
  recenterBtn: {
    position: 'absolute',
    right: 16,
    bottom: 24,
    width: 48, height: 48, borderRadius: 24,
    backgroundColor: 'rgba(255,255,255,0.95)',
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: Colors.border,
    shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 5,
    shadowOffset: { width: 0, height: 2 }, elevation: 4,
  },
});
