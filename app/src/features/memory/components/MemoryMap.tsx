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

import React, { useCallback, useEffect, useRef, useState } from 'react';
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

  // v340: when Recenter pill is tapped, MemoryScreen bumps
  // recenterToken; we then run cameraRef.setCamera with 600ms flyTo.
  // During that animation rnmapbox sometimes labels intermediate
  // onRegionIsChanging events with isUserInteraction=true (depends on
  // SDK version + gesture state at the moment of flyTo). Use a
  // suppress-ref to ignore pan-detect events during the 1s window
  // after a programmatic recenter, otherwise the Recenter pill flashes
  // back on immediately after the user taps it.
  const suppressPanDetectUntilRef = useRef<number>(0);

  // v336: when recenterToken bumps, fly the camera back to the current
  // GPS coord WITHOUT remounting Camera (the old cameraKey strategy
  // caused a one-frame fog reset on every tap). setCamera on the same
  // Camera ref is animated and produces no remount flash. Reset the
  // anchor so the pan-detection (onMapSettle) doesn't immediately fire
  // panned=true again.
  useEffect(() => {
    if (recenterToken > 0) {
      anchorRef.current = { lat: centerLat, lng: centerLng };
      setHasPannedAway(false);
      suppressPanDetectUntilRef.current = Date.now() + 1000;
      cameraRef.current?.setCamera?.({
        centerCoordinate: [centerLng, centerLat],
        zoomLevel: INITIAL_ZOOM,
        animationDuration: 600,
      });
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
  // v336: Camera no longer remounts on recenter (was: bumping
  // cameraKey via recenterToken caused a 1-frame fog reset = flash).
  // We now drive recenter via cameraRef.setCamera in the recenterToken
  // useEffect above. The Camera stays mounted for the whole MemoryMap
  // lifetime.

  if (!Mapbox.available) {
    return <View style={styles.webStub} />;
  }
  const { MapView, Camera, UserLocation, CircleLayer } = Mapbox as any;

  return (
    <View style={styles.container}>
      <MapView
        ref={mapViewRef}
        style={styles.map}
        styleURL={SEPIA_STYLE_URL}
        compassEnabled={false}
        scaleBarEnabled={false}
        logoEnabled={false}
        attributionEnabled={false}
        onMapIdle={onMapSettle}
        onRegionIsChanging={(feature: any) => {
          // v340: suppress pan-detect for 1s after a programmatic
          // recenter — rnmapbox flyTo can emit isUserInteraction=true
          // mid-animation depending on SDK state, which would flash the
          // Recenter pill back on immediately after the user tapped it.
          if (Date.now() < suppressPanDetectUntilRef.current) return;
          const isUser = feature?.properties?.isUserInteraction;
          if (!isUser) return;
          const cc = feature?.geometry?.coordinates;
          if (!Array.isArray(cc) || cc.length < 2) return;
          const dist = haversineM(
            { lat: anchorRef.current.lat, lng: anchorRef.current.lng },
            { lat: cc[1], lng: cc[0] }
          );
          if (dist > 50) {
            setHasPannedAway((prev) => prev ? prev : true);
            if (onMapMoved) onMapMoved();
          }
        }}
      >
        <Camera
          ref={cameraRef}
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
        {/* v349: re-enable custom UserLocation puck — CircleLayer is now
            exported by mapboxAdapter (v348 fix), so the v347 crash root
            cause (CircleLayer === undefined) is gone. UserLocation.js:201
            confirms: children prop fully replaces normalIcon's 15px halo
            + 9px white + 6px blue stack. With renderMode default ('normal',
            line 44-48) the children path is the official API.

            Result: small white-ringed blue dot. No 15px translucent halo
            that users were mistaking for a "default fog reveal circle". */}
        <UserLocation visible={true} animated={true}>
          <CircleLayer
            id="memory-user-location-ring"
            style={{
              circleRadius: 7,
              circleColor: '#FFFFFF',
              circlePitchAlignment: 'map',
            }}
          />
          <CircleLayer
            id="memory-user-location-dot"
            aboveLayerID="memory-user-location-ring"
            style={{
              circleRadius: 5,
              circleColor: 'rgba(51, 181, 229, 1)',
              circlePitchAlignment: 'map',
            }}
          />
        </UserLocation>
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
