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
import { useMemoryStore } from '../store/useMemoryStore';
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
   * BUG-003 fix (Sprint 71 post-review): stranger Public marks within
   * visibility radius but outside fog — forwarded to CairnPinsLayer for
   * blurred-icon render (Sprint 70 STORY-00543). When MemoryScreen wires
   * the /api/markers/public?bbox= loader in F5, populating this prop
   * activates the visual layer end-to-end. Optional; defaults undefined =
   * no stranger icons rendered.
   */
  strangerMarks?: import('../../../store/useMarkerStore').Marker[];
  /**
   * v333: fired when the user actively pans/zooms the map (not when
   * code-driven Camera animation moves it). Parent gates the Recenter
   * button on this so the button only appears after the user has
   * moved the map (decision E).
   */
  onMapMoved?: () => void;
  /**
   * v359: fired when Mapbox `onDidFinishRenderingMapFully` triggers —
   * the basemap is fully painted. Used by MemoryScreen as one of two
   * gates for hiding the loading overlay.
   */
  onMapFullyReady?: () => void;
  /**
   * v359: fired when FogLayer first computes a fog shape with holes
   * (corridor cutouts from GPS data). Used by MemoryScreen as the
   * second gate for hiding the loading overlay.
   */
  onFogReady?: () => void;
}

const SEPIA_STYLE_URL = 'mapbox://styles/mapbox/outdoors-v12';
const INITIAL_ZOOM = 16.5;

export function MemoryMap({ centerLat, centerLng, recenterToken = 0, onMapMoved, onMapFullyReady, onFogReady, strangerMarks }: Props) {
  const Mapbox = getMapbox();
  const allMarkers = useMarkerStore((s) => s.markers);
  const mapViewRef = useRef<any>(null);

  // v302 N6: track whether the user has panned the map away from
  // the GPS-driven center. Hiking-style: don't auto-follow user
  // location; instead expose a recenter pill when the camera drifts
  // beyond ~50m of the GPS fix. Same UX as HikingScreen.
  const [hasPannedAway, setHasPannedAway] = useState(false);
  // v380: fog/map ready gate — pins should not appear until fog is
  // rendered. Pre-fix the user saw pins "popping in" before fog, and some
  // pins missed first paint entirely.
  //
  // v380 review (round 2): primary signal = FogLayer.onFogReady (fixed in
  // round 1 to fire for zero-points users too). Belt-and-suspenders: a 2s
  // timer covers the `useH3Fog=false` settings path where FogLayer returns
  // null and never fires.
  const [fogReady, setFogReady] = useState(false);
  // v387: also gate CairnPinsLayer on server memory hydrate to avoid the
  // first-entry "Mystery flash" then second-entry "Revealed" transition.
  const initialRevealDone = useMemoryStore((s) => s.initialRevealDone);
  useEffect(() => {
    const timer = setTimeout(() => setFogReady(() => true), 2000);
    return () => clearTimeout(timer);
  }, []);
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
    // v386: propagate zoom to shared value so pin components can animate
    // transform:scale on the UI thread (reanimated). This is the
    // OTA-friendly zoom-responsive scaling for PointAnnotation, since
    // Mapbox SDK's GL-side iconSize works only for SymbolLayer (which
    // can't render react-native-svg per v383-exp diagnostic).
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { setMapZoom } = require('./useMapZoom');
    setMapZoom(zoom);
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

  // v359: fire onMapFullyReady once on the first
  // onDidFinishRenderingMapFully event. Subsequent fires (zoom/pan
  // settle) are ignored — the loading overlay only cares about the
  // first paint.
  const mapFullyReadyFiredRef = useRef(false);

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
        onCameraChanged={(e: any) => {
          // v386: propagate live zoom to shared value every camera frame
          // so PointAnnotation pin transform:scale tracks smoothly during
          // pinch. onMapIdle alone fires only at end of pinch (sticky size).
          const z = e?.properties?.zoom ?? e?.zoom;
          if (typeof z === 'number') {
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const { setMapZoom } = require('./useMapZoom');
            setMapZoom(z);
            // v386b: log every ~250ms-ish for telemetry verification
            if (Math.random() < 0.05) {
              // eslint-disable-next-line @typescript-eslint/no-require-imports
              const { log } = require('../../../services/appLog');
              log('v386.camera_zoom', { zoom: Number(z.toFixed(2)) });
            }
          }
        }}
        // v357 diagnostic: three Mapbox native events.
        //   willStartLoadingMap — style + first tile fetch begins. This is
        //     the earliest frame where MapView is in DOM but renders no
        //     basemap yet (likely the "brown screen" stage user reports).
        //   didFinishLoadingMap — style + initial tile batch ready. Basemap
        //     becomes visible; fog may or may not be layered yet depending
        //     on FogLayer build_ms vs this event order.
        //   didFinishRenderingMapFully — all tiles in viewport rendered.
        //     This is when "fully painted" map exists; if fog is missing
        //     after this fires, the bug is in FogLayer, not Mapbox.
        // We log without ctx — these are points, not measurements.
        onWillStartLoadingMap={() => { log('v357.mapbox_willStartLoadingMap', {}); }}
        onDidFinishLoadingMap={() => {
          log('v357.mapbox_didFinishLoadingMap', {});
          // v361 fix: onDidFinishRenderingMapFully is unreliable —
          // v357 telemetry showed it never fired in a normal session
          // while onDidFinishLoadingMap did. The 8s timeout was being
          // hit even on good networks because we were waiting for the
          // wrong event. Fire onMapFullyReady on didFinishLoadingMap
          // instead (style + first tile batch ready → basemap visible),
          // matching what users perceive as "map loaded".
          if (!mapFullyReadyFiredRef.current && onMapFullyReady) {
            mapFullyReadyFiredRef.current = true;
            onMapFullyReady();
          }
        }}
        onDidFinishRenderingMapFully={() => {
          log('v357.mapbox_didFinishRenderingMapFully', {});
          // Backup: also fire here in case didFinishLoadingMap was
          // somehow missed (defensive — ref guard prevents duplicate).
          if (!mapFullyReadyFiredRef.current && onMapFullyReady) {
            mapFullyReadyFiredRef.current = true;
            onMapFullyReady();
          }
        }}
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
          {/* BUG-C fix (v371 post-OTA): User-location ring + dot now scale
              with zoom. Mapbox `circleRadius` default is screen pixels —
              constant size regardless of zoom — which at low zoom levels
              made the blue dot visually huge relative to map features
              ("bigger than a house"). Now interpolated: small at world
              zoom (z=4), normal at hiking zoom (z=14+). Numbers chosen
              so the dot still reads as "you" at all zooms but doesn't
              dominate the map at low zoom.
              The 8px / 6px at z>=14 matches the prior 7px / 5px feel
              (slightly larger because the ring is now more sparse at low
              zoom). */}
          <CircleLayer
            id="memory-user-location-ring"
            style={{
              circleRadius: [
                'interpolate', ['linear'], ['zoom'],
                4, 2.5,    // world zoom — tiny
                10, 4.5,   // city zoom — small
                14, 7,     // hiking zoom — normal
                18, 9,     // street zoom — slightly larger
              ],
              circleColor: '#FFFFFF',
              circlePitchAlignment: 'map',
            }}
          />
          <CircleLayer
            id="memory-user-location-dot"
            aboveLayerID="memory-user-location-ring"
            style={{
              circleRadius: [
                'interpolate', ['linear'], ['zoom'],
                4, 1.6,    // tiny inner dot at world zoom
                10, 3,
                14, 5,
                18, 6.5,
              ],
              circleColor: 'rgba(51, 181, 229, 1)',
              circlePitchAlignment: 'map',
            }}
          />
        </UserLocation>
        <FogLayer userCenter={{ lat: centerLat, lng: centerLng }} onFogReady={() => {
          setFogReady(true);
          onFogReady?.();
        }} />
        {/* v380: render pins only AFTER fog is ready, so they appear
            on top of the fog mask layer.
            v387: additionally gate on initialRevealDone so server-hydrated
            memory_points have arrived — otherwise user sees Mystery pins
            on first entry, then Revealed on second (Mystery flash). */}
        {/* v387b: revert initialRevealDone gate — that flag is only set on
            FIRST-EVER reveal (new user). Existing users skip the reveal step,
            so the flag stays false forever → CairnPinsLayer never mounted →
            no pins visible at all. fogReady alone is enough; Mystery flash
            on first entry is acceptable. */}
        {fogReady && (
          <CairnPinsLayer markers={allMarkers} centerLat={centerLat} centerLng={centerLng} strangerMarks={strangerMarks} />
        )}
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
