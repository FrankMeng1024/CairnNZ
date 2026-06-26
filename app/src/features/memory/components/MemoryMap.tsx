/**
 * MemoryMap — Mapbox view + sepia fog overlay + cairn pins.
 *
 * Wires together:
 *   - Mapbox MapView/Camera (cross-platform via mapboxAdapter)
 *   - FogLayer (renders L1 world fog + L2 raster mask around user)
 *   - CairnPinsLayer (markers within the explored area)
 *   - UserLocation (the blue dot — user's current position anchor)
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
import { MemoryFogBurstOverlay } from './MemoryFogBurstOverlay';
import { CairnPinsLayer } from './CairnPinsLayer';
import { log } from '../../../services/appLog';
import { flushNow as flushLogsNow } from '../../../services/appLog';
import { Icon } from '../../../components/Icon';
import { Colors } from '../../../components/tokens';
import { haversineM } from '../../../utils/geo';

interface Props {
  centerLat: number;
  centerLng: number;
  /**
   * Bumping this number triggers Camera flyTo (recenter). Parent
   * uses it for the recenter button.
   */
  recenterToken?: number;
  /**
   * v333: fired when the user actively pans/zooms the map (not when
   * code-driven Camera animation moves it). Parent gates the Recenter
   * button on this so the button only appears after the user has
   * moved the map (decision E).
   */
  onMapMoved?: () => void;
}

const SEPIA_STYLE_URL = 'mapbox://styles/mapbox/outdoors-v12';
const INITIAL_ZOOM = 16.5;

export function MemoryMap({ centerLat, centerLng, recenterToken = 0, onMapMoved }: Props) {
  const Mapbox = getMapbox();
  const allMarkers = useMarkerStore((s) => s.markers);
  const mapViewRef = useRef<any>(null);

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
   * onMapIdle receives a synthesized event from the adapter with
   * properties.center and properties.zoom. We use these to detect
   * pan-away (anchor diff > 50m) for the internal recenter pill.
   */
  // v303 OTA 三修: onMapSettle 在初始化期间 Mapbox 会 fire 多次,
  // 用 throttle 100ms 合并连续 fire 防多次 setState 抖动。
  const idleFireCountRef = useRef(0);
  const lastIdleAtRef = useRef(0);
  const idleThrottleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onMapSettle = useCallback((feature: any) => {
    const center = feature?.properties?.center;
    const zoom = feature?.properties?.zoom;
    if (!Array.isArray(center) || center.length < 2 || typeof zoom !== 'number') return;
    idleFireCountRef.current += 1;
    const fireCount = idleFireCountRef.current;
    const tNow = Date.now();
    const msSinceLast = lastIdleAtRef.current === 0 ? -1 : tNow - lastIdleAtRef.current;
    lastIdleAtRef.current = tNow;
    log('memory.map_idle', {
      fire: fireCount,
      zoom: Number(zoom.toFixed(2)),
      ms_since_last: msSinceLast,
      center_lat: Number(center[1].toFixed(5)),
      center_lng: Number(center[0].toFixed(5)),
    });
    void flushLogsNow();
    if (idleThrottleTimerRef.current) clearTimeout(idleThrottleTimerRef.current);
    idleThrottleTimerRef.current = setTimeout(() => {
      idleThrottleTimerRef.current = null;
      const dist = haversineM(
        { lat: anchorRef.current.lat, lng: anchorRef.current.lng },
        { lat: center[1], lng: center[0] }
      );
      const panned = dist > 50;
      setHasPannedAway((prev) => (prev === panned ? prev : panned));
      // v336: bubble pan-away signal to parent (MemoryScreen) so the
      // Recenter pill shows up. Earlier versions relied on rnmapbox's
      // onRegionDidChange + isUserInteraction, but that event was not
      // firing reliably in our setup. onMapIdle fires every time the
      // camera settles, and we already compute the anchor-distance here
      // — just forward the same boolean upstream.
      if (panned && onMapMoved) {
        onMapMoved();
      }
    }, 100);
  }, [onMapMoved]);

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
        <FogLayer userCenter={{ lat: centerLat, lng: centerLng }} />
        <CairnPinsLayer markers={allMarkers} centerLat={centerLat} centerLng={centerLng} />
      </MapView>
      {/* v303 OTA: Skia 解锁扩散动画 overlay。在 MapView 之上 absoluteFill。
          数据从 useMemoryStore.recentUnlocks 来,native fog 7/1 上线后保留
          本组件不变(burst 永远纯 JS 视觉层)。 */}
      <MemoryFogBurstOverlay mapViewRef={mapViewRef} />
      {/* v334: removed MemoryMap's internal Recenter pill — MemoryScreen
          now owns this UI (decision E: "icon like Hiking, only after I
          move the map, taps it to go back"). MemoryMap stays as a pure
          map renderer; pan/zoom signals bubble up via onMapMoved prop. */}
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
