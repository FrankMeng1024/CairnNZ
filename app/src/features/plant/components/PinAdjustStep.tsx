/**
 * PinAdjustStep — Step 2 of plant flow.
 *
 * v0.2.6.7 (v297) — true root-cause fix:
 *   Two-subagent investigation confirmed Mapbox iOS native SDK pinch
 *   zoom anchor is hardcoded = pinch midpoint. No public API can
 *   change it to screen-center. gestureSettings.pinchPanEnabled only
 *   disables the PAN component of a pinch, NOT the zoom anchor.
 *   v296's "post-settle setCamera recenter" couldn't prevent the
 *   visible drift DURING the gesture (onMapIdle only fires AFTER
 *   the user lifts fingers).
 *
 *   Fix: completely disable all native zoom gestures (pinch, double-
 *   tap, quick-zoom) and add explicit +/- buttons. The +/- buttons
 *   call setCamera with centerCoordinate locked to current pin GPS
 *   coord, so zoom is PHYSICALLY incapable of drifting. This is the
 *   same UX Didi/Uber use on their pin-adjust screens.
 *
 *   Side-effect: onMapSettle is now always a pan event (no zoom can
 *   be triggered without the +/- buttons, which use setCamera that
 *   bypasses the gesture system). The zoom-branch early-return that
 *   was masking pinLat/pinLng updates is gone — so the >50m hint and
 *   the disabled-button gate now fire reliably.
 *
 * Previous (v0.2.6.6 V1+V2): Drag UX rewritten to Didi/Uber style:
 * the pin is FIXED at screen center; the user pans the MAP under it.
 * accuracy + max-nudge circles render anchored to the original GPS
 * spot. Drag past the max-nudge boundary shows a hint banner.
 *
 * Style toggle (top-right): outdoors ↔ satellite, with first-time
 * mobile-data warning.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Platform, Alert } from 'react-native';
import { getMapbox } from '../../memory/services/mapboxAdapter';
import { PinNudgeConfig } from '../config/plantConfig';
import { MemoryColors } from '../../memory/config/memoryConfig';
import { Colors } from '../../../components/tokens';
import { haversineM } from '../../../utils/geo';
import { getPrimaryMapStyle } from '../../../config/mapbox';
import { log } from '../../../services/appLog';
import { Icon } from '../../../components/Icon';

interface Props {
  lat: number;
  lng: number;
  accuracyM: number;
  onConfirm: (lat: number, lng: number) => void;
  onBack: () => void;
}

const SATELLITE_STYLE = 'mapbox://styles/mapbox/satellite-streets-v12';

// Zoom range — same physical bounds as v296. Below 14 the 50m ring
// collapses to a few px; above 20 mapbox runs out of tile data.
const MIN_ZOOM = 14;
const MAX_ZOOM = 20;
const INITIAL_ZOOM = 17.5;
const ZOOM_STEP = 1;

function makeCircleGeoJson(lat: number, lng: number, radiusM: number): any {
  const points: [number, number][] = [];
  const earthRad = 6378137;
  const cosLat = Math.cos((lat * Math.PI) / 180);
  for (let i = 0; i <= 64; i++) {
    const theta = (i / 64) * Math.PI * 2;
    const dLat = (radiusM * Math.cos(theta)) / earthRad;
    const dLng = (radiusM * Math.sin(theta)) / (earthRad * cosLat);
    points.push([lng + (dLng * 180) / Math.PI, lat + (dLat * 180) / Math.PI]);
  }
  return {
    type: 'Feature',
    geometry: { type: 'Polygon', coordinates: [points] },
    properties: {},
  };
}

export function PinAdjustStep({ lat, lng, accuracyM, onConfirm, onBack }: Props) {
  const Mapbox = getMapbox();
  const [pinLat, setPinLat] = useState(lat);
  const [pinLng, setPinLng] = useState(lng);
  const [zoom, setZoom] = useState(INITIAL_ZOOM);
  const [hintVisible, setHintVisible] = useState(false);
  const originRef = useRef({ lat, lng });
  const hintTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [mapStyle, setMapStyle] = useState<'outdoors' | 'satellite'>('outdoors');
  const [satelliteWarned, setSatelliteWarned] = useState(false);
  // Camera ref — used by the +/- zoom buttons to set both
  // centerCoordinate (locked to current pin) and zoomLevel in one
  // atomic call. Because we disable all native zoom gestures below,
  // setCamera is the ONLY path that changes zoom. Map cannot drift.
  const cameraRef = useRef<any>(null);
  // v297 subagent-review fixes:
  //   B1/C2: replace boolean "next-settle suppress" with an expected
  //     center match. setCamera's 180ms ease can produce >1 onMapIdle
  //     events; a boolean only swallows the first, leaking later ones.
  //     We now only skip the settle handler if the settled center is
  //     within ~1m of the expected post-setCamera center.
  //   B2: the confirm-tap handler used React state pinLat/pinLng,
  //     which lags onMapIdle by up to ~120ms on native (touch-end →
  //     bridge → JS render). User could pan past 50m and tap "Looks
  //     right" inside that window before the gate disabled itself.
  //     latestCoordRef is updated on every onCameraChanged event
  //     (continuous during pan, not just on settle) — confirm-tap
  //     reads it instead of state for the source-of-truth coord.
  //   C3: doZoom now reads latestZoomRef instead of stale closure
  //     `zoom` state — rapid double-tap +/- advances zoom by the
  //     correct delta even if React state hasn't committed yet.
  const expectedCenterRef = useRef<[number, number] | null>(null);
  const latestCoordRef = useRef<{ lat: number; lng: number }>({ lat, lng });
  const latestZoomRef = useRef<number>(INITIAL_ZOOM);

  const onToggleStyle = () => {
    if (mapStyle === 'outdoors') {
      if (!satelliteWarned) {
        Alert.alert(
          'Switch to satellite view?',
          'Satellite imagery uses about 1–2 MB of mobile data on first load. The view caches locally afterwards. Continue?',
          [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Use satellite',
              onPress: () => {
                log('plant.pin_style_toggle', { to: 'satellite' });
                setSatelliteWarned(true);
                setMapStyle('satellite');
              },
            },
          ]
        );
        return;
      }
      log('plant.pin_style_toggle', { to: 'satellite' });
      setMapStyle('satellite');
    } else {
      log('plant.pin_style_toggle', { to: 'outdoors' });
      setMapStyle('outdoors');
    }
  };

  const accuracyCircle = useMemo(
    () => makeCircleGeoJson(originRef.current.lat, originRef.current.lng, Math.max(accuracyM, 2)),
    [accuracyM]
  );
  const maxNudgeCircle = useMemo(
    () => makeCircleGeoJson(originRef.current.lat, originRef.current.lng, PinNudgeConfig.maxNudgeMeters),
    []
  );

  // Show a hint banner when the user pushes past the boundary;
  // hide it 2.5s after they stop pushing.
  const briefHint = () => {
    setHintVisible(true);
    if (hintTimer.current) clearTimeout(hintTimer.current);
    hintTimer.current = setTimeout(() => setHintVisible(false), 2500);
  };

  useEffect(() => () => {
    if (hintTimer.current) clearTimeout(hintTimer.current);
  }, []);

  /**
   * onCameraChanged fires high-frequency (every frame during pan).
   * We use it ONLY to update refs (no setState → no React render
   * storm). The refs are read by the confirm-tap handler so it
   * sees the true current map center even during the touch-end →
   * onMapIdle latency window (subagent review B2).
   *
   * For UI updates (hint banner, button gate visual state) we still
   * use the lower-frequency onMapIdle settle event below.
   */
  const onCameraTick = (feature: any) => {
    const coord = feature?.properties?.center;
    if (!Array.isArray(coord) || coord.length < 2) return;
    latestCoordRef.current = { lng: coord[0], lat: coord[1] };
    const z = feature?.properties?.zoom;
    if (typeof z === 'number') latestZoomRef.current = z;
  };

  /**
   * onMapIdle fires AFTER pan settles. With native zoom gestures
   * fully disabled (gestureSettings below), the only way the map
   * center moves is the user dragging it (pan). So every settle is
   * a pan event — no need for a zoom branch.
   *
   * The +/- buttons trigger a setCamera that also fires mapIdle.
   * Instead of a boolean suppress (which only swallows ONE idle —
   * see B1), we compare the settled center to the expected post-
   * setCamera center. Only events whose center matches expected
   * within ~1m are dropped; subsequent real pans pass through.
   */
  const onMapSettle = (feature: any) => {
    const coord = feature?.properties?.center;
    if (!Array.isArray(coord) || coord.length < 2) return;
    const newLng = coord[0];
    const newLat = coord[1];

    // Suppress only events that match the expected post-setCamera
    // center. Once matched, clear the expectation. A subsequent
    // pan to a different center will not match → processes normally.
    const expected = expectedCenterRef.current;
    if (expected) {
      const dExp = haversineM(
        { lat: expected[1], lng: expected[0] },
        { lat: newLat, lng: newLng }
      );
      if (dExp < 1.0) {
        expectedCenterRef.current = null;
        return;
      }
    }

    setPinLat(newLat);
    setPinLng(newLng);
    const dist = haversineM(
      { lat: originRef.current.lat, lng: originRef.current.lng },
      { lat: newLat, lng: newLng }
    );
    if (dist > PinNudgeConfig.maxNudgeMeters) {
      briefHint();
      log('plant.pin_out_of_range', { distM: Math.round(dist) });
    }
  };

  // +/- zoom buttons. setCamera with centerCoordinate=[latest pin coord]
  // explicitly locks the map center on the pin's current GPS coord,
  // so the visible map cannot drift during the zoom animation. We
  // read latestZoomRef (not React state) so rapid taps within the
  // same render frame advance zoom correctly (C3 fix).
  const doZoom = (delta: number) => {
    const currentZoom = latestZoomRef.current;
    const target = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, currentZoom + delta));
    if (Math.abs(target - currentZoom) < 0.01) return;
    const lng = latestCoordRef.current.lng;
    const latC = latestCoordRef.current.lat;
    latestZoomRef.current = target;  // keep ref in sync immediately
    setZoom(target);                 // and update UI state for button disabled
    expectedCenterRef.current = [lng, latC];
    cameraRef.current?.setCamera?.({
      centerCoordinate: [lng, latC],
      zoomLevel: target,
      animationDuration: 180,
    });
    log('plant.pin_zoom', { zoom: target });
  };

  if (!Mapbox.available) {
    return <PinAdjustFallback lat={lat} lng={lng} accuracyM={accuracyM}
                              onConfirm={() => onConfirm(pinLat, pinLng)}
                              onBack={onBack} />;
  }
  const { MapView, Camera, ShapeSource, FillLayer, LineLayer } = Mapbox;

  return (
    <View style={styles.container}>
      <Text style={styles.title}>You are here?</Text>
      <Text style={styles.sub}>
        Drag the map to fine-tune. Use + / − to zoom.
      </Text>

      <View style={styles.mapWrap}>
        <MapView
          style={styles.map}
          styleURL={mapStyle === 'satellite' ? SATELLITE_STYLE : getPrimaryMapStyle()}
          compassEnabled={false}
          scaleBarEnabled={false}
          attributionEnabled={false}
          logoEnabled={false}
          // v297: disable ALL native zoom gestures. The +/- buttons
          // are the only zoom path, and they call setCamera with an
          // explicit centerCoordinate locked to the current pin —
          // so zoom physically cannot drift. (See file-level doc.)
          gestureSettings={{
            pinchZoomEnabled: false,
            pinchPanEnabled: false,
            rotateEnabled: false,
            pitchEnabled: false,
            quickZoomEnabled: false,
            doubleTapToZoomInEnabled: false,
            doubleTouchToZoomOutEnabled: false,
            panEnabled: true,
          }}
          onMapIdle={onMapSettle}
          onCameraChanged={onCameraTick}
        >
          <Camera
            ref={cameraRef}
            defaultSettings={{
              centerCoordinate: [originRef.current.lng, originRef.current.lat],
              zoomLevel: INITIAL_ZOOM,
            }}
            minZoomLevel={MIN_ZOOM}
            maxZoomLevel={MAX_ZOOM}
          />
          <ShapeSource id="acc-src" shape={accuracyCircle}>
            <FillLayer
              id="acc-fill"
              style={{ fillColor: Colors.primary, fillOpacity: 0.18 }}
            />
            <LineLayer
              id="acc-line"
              style={{ lineColor: Colors.primary, lineWidth: 1.5, lineOpacity: 0.6 }}
            />
          </ShapeSource>
          <ShapeSource id="nudge-src" shape={maxNudgeCircle}>
            <LineLayer
              id="nudge-line"
              style={{
                lineColor: Colors.flag,
                lineWidth: 1,
                lineOpacity: 0.4,
                lineDasharray: [2, 3],
              }}
            />
          </ShapeSource>
        </MapView>

        {/* pin is fixed at screen center — non-interactive overlay. */}
        <View pointerEvents="none" style={styles.centerOverlay}>
          <View style={styles.pin}>
            <View style={styles.pinHead} />
            <View style={styles.pinTail} />
          </View>
        </View>

        {/* hint banner when user drags past the max-nudge ring */}
        {hintVisible && (
          <View style={styles.hintBanner} pointerEvents="none">
            <Text style={styles.hintBannerText}>
              Pin stays within {PinNudgeConfig.maxNudgeMeters} m of your GPS spot.
            </Text>
          </View>
        )}

        <TouchableOpacity
          style={styles.styleToggle}
          onPress={onToggleStyle}
          activeOpacity={0.7}
        >
          <Icon
            name={mapStyle === 'satellite' ? 'Map' : 'Globe'}
            size={18}
            color={MemoryColors.sepiaDeep}
            strokeWidth={2}
          />
        </TouchableOpacity>

        {/* +/- zoom buttons — v297 replacement for native pinch zoom */}
        <View style={styles.zoomCol} pointerEvents="box-none">
          <TouchableOpacity
            style={[styles.zoomBtn, zoom >= MAX_ZOOM && styles.zoomBtnDisabled]}
            onPress={() => doZoom(+ZOOM_STEP)}
            disabled={zoom >= MAX_ZOOM}
            activeOpacity={0.7}
          >
            <Icon
              name="Plus"
              size={18}
              color={zoom >= MAX_ZOOM ? Colors.textSecondary : MemoryColors.sepiaDeep}
              strokeWidth={2.5}
            />
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.zoomBtn, { marginTop: 6 }, zoom <= MIN_ZOOM && styles.zoomBtnDisabled]}
            onPress={() => doZoom(-ZOOM_STEP)}
            disabled={zoom <= MIN_ZOOM}
            activeOpacity={0.7}
          >
            <Icon
              name="Minus"
              size={18}
              color={zoom <= MIN_ZOOM ? Colors.textSecondary : MemoryColors.sepiaDeep}
              strokeWidth={2.5}
            />
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.metaRow}>
        <Text style={styles.metaText}>
          ± {accuracyM.toFixed(1)} m · drag the map to fine-tune
        </Text>
      </View>

      <View style={{ flex: 1 }} />
      {/* Confirm button. visualGate uses React state pinLat/pinLng for
          the button's visible disabled/text — this is what the user
          SEES. But onPress reads latestCoordRef (updated by
          onCameraChanged every frame during pan) for the actual
          coord to submit — this is what the user GETS. The two are
          identical at idle; they only differ during the ~120ms
          window between user touch-end and onMapIdle, in which
          window the button's visible state lags the true map center.
          Reading the ref at tap time means the SUBMITTED coord is
          always the latest map center, never stale (B2 fix). */}
      {(() => {
        const visualDist = haversineM(
          { lat: originRef.current.lat, lng: originRef.current.lng },
          { lat: pinLat, lng: pinLng }
        );
        const canConfirm = visualDist <= PinNudgeConfig.maxNudgeMeters + 0.5;
        return (
          <TouchableOpacity
            style={[styles.primaryBtn, !canConfirm && styles.primaryBtnDisabled]}
            disabled={!canConfirm}
            onPress={() => {
              // Read the TRUE current map center at tap time, not the
              // possibly-stale React state.
              const latestLat = latestCoordRef.current.lat;
              const latestLng = latestCoordRef.current.lng;
              const trueDist = haversineM(
                { lat: originRef.current.lat, lng: originRef.current.lng },
                { lat: latestLat, lng: latestLng }
              );
              if (trueDist > PinNudgeConfig.maxNudgeMeters + 0.5) {
                // Race caught: visible state said within-range but
                // map center has since moved past. Refuse the tap,
                // surface the hint so the user knows why.
                briefHint();
                log('plant.pin_confirm_blocked_race', { distM: Math.round(trueDist) });
                return;
              }
              log('plant.pin_confirm', { lat: latestLat, lng: latestLng });
              onConfirm(latestLat, latestLng);
            }}
          >
            <Text style={[styles.primaryBtnText, !canConfirm && styles.primaryBtnTextDisabled]}>
              {canConfirm ? 'Looks right' : `Pin too far — pan back within ${PinNudgeConfig.maxNudgeMeters} m`}
            </Text>
          </TouchableOpacity>
        );
      })()}
      <TouchableOpacity style={styles.backBtn} onPress={onBack}>
        <Text style={styles.backBtnText}>Back</Text>
      </TouchableOpacity>
    </View>
  );
}

function PinAdjustFallback({
  lat, lng, accuracyM, onConfirm, onBack,
}: {
  lat: number; lng: number; accuracyM: number;
  onConfirm: () => void; onBack: () => void;
}) {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>You are here?</Text>
      <Text style={styles.sub}>Map preview not available on this platform.</Text>
      <View style={styles.fallbackBox}>
        <Text style={styles.fallbackCoord}>{lat.toFixed(6)}, {lng.toFixed(6)}</Text>
        <Text style={styles.fallbackAcc}>± {accuracyM.toFixed(1)} m</Text>
      </View>
      <View style={{ flex: 1 }} />
      <TouchableOpacity style={styles.primaryBtn} onPress={onConfirm}>
        <Text style={styles.primaryBtnText}>Confirm</Text>
      </TouchableOpacity>
      <TouchableOpacity style={styles.backBtn} onPress={onBack}>
        <Text style={styles.backBtnText}>Back</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  title: { fontSize: 22, fontWeight: '500', color: MemoryColors.sepiaDeep, marginBottom: 6 },
  sub:   { fontSize: 13, color: MemoryColors.cairnPublic, marginBottom: 16 },
  mapWrap: {
    height: 340,
    borderRadius: 14,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: Colors.border,
  },
  map: { flex: 1 },
  styleToggle: {
    position: 'absolute',
    top: 8, right: 8,
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.95)',
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: Colors.border,
    shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 }, elevation: 3,
  },
  zoomCol: {
    position: 'absolute',
    top: 52, right: 8,
    alignItems: 'center',
  },
  zoomBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.95)',
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: Colors.border,
    shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 }, elevation: 3,
  },
  zoomBtnDisabled: {
    backgroundColor: 'rgba(240,240,240,0.95)',
    opacity: 0.6,
  },
  centerOverlay: {
    position: 'absolute',
    top: 0, bottom: 0, left: 0, right: 0,
    alignItems: 'center', justifyContent: 'center',
  },
  hintBanner: {
    position: 'absolute',
    bottom: 12, left: 12, right: 12,
    backgroundColor: 'rgba(0,0,0,0.78)',
    borderRadius: 10,
    paddingVertical: 8, paddingHorizontal: 12,
  },
  hintBannerText: {
    color: '#fff', fontSize: 12, textAlign: 'center',
  },
  metaRow: {
    paddingVertical: 8,
    alignItems: 'center',
  },
  metaText: { fontSize: 11, color: Colors.textSecondary },
  pin: { alignItems: 'center', justifyContent: 'center' },
  pinHead: {
    width: 24, height: 24,
    borderRadius: 12,
    backgroundColor: Colors.flag,
    borderWidth: 3,
    borderColor: '#fff',
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
  },
  pinTail: {
    marginTop: -3,
    width: 0, height: 0,
    borderLeftWidth: 5,
    borderRightWidth: 5,
    borderTopWidth: 8,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderTopColor: Colors.flag,
  },
  fallbackBox: {
    backgroundColor: Colors.surface,
    borderRadius: 14,
    borderWidth: 1, borderColor: Colors.border,
    padding: 16, alignItems: 'center',
  },
  fallbackCoord: { fontFamily: 'Courier', fontSize: 13, color: MemoryColors.sepiaDeep },
  fallbackAcc:   { fontSize: 12, color: Colors.primary, marginTop: 6 },
  primaryBtn: {
    backgroundColor: MemoryColors.sepia,
    padding: 14, borderRadius: 12, alignItems: 'center',
  },
  primaryBtnDisabled: {
    backgroundColor: '#d4ccbd',
  },
  primaryBtnText: { color: '#fff', fontSize: 14, fontWeight: '500' },
  primaryBtnTextDisabled: { color: '#fff', opacity: 0.85 },
  backBtn: { padding: 14, alignItems: 'center' },
  backBtnText: { fontSize: 13, color: MemoryColors.cairnPublic },
});
