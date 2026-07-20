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
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { getMapbox } from '../../memory/services/mapboxAdapter';
import { PinNudgeConfig } from '../config/plantConfig';
import { MemoryColors } from '../../memory/config/memoryConfig';
import { Colors } from '../../../components/tokens';
import { haversineM } from '../../../utils/geo';
import { getPrimaryMapStyle } from '../../../config/mapbox';
import { log } from '../../../services/appLog';
import { Icon } from '../../../components/Icon';
import { BackButton } from '../../../components/BackButton';

interface Props {
  /** GPS-locked anchor — the immutable center of the 50m ring. Set
   *  once in step 1 (GpsLockStep) and never overwritten across step
   *  3 → step 2 back navigation. */
  gpsLat: number;
  gpsLng: number;
  /** Initial pin position on remount. On first entry equals (gpsLat,
   *  gpsLng); on re-entry from step 3, equals the last-confirmed pin
   *  coord. The 50m gate still measures from (gpsLat,gpsLng), so the
   *  pin cannot drift further than 50m from the original GPS spot
   *  even across step transitions (N5 fix). */
  initialLat: number;
  initialLng: number;
  accuracyM: number;
  onConfirm: (lat: number, lng: number) => void;
  onBack: () => void;
}

const SATELLITE_STYLE = 'mapbox://styles/mapbox/satellite-streets-v12';

// Zoom range — same physical bounds as v296. Below 14 the 50m ring
// collapses to a few px; above 20 mapbox runs out of tile data.
const MIN_ZOOM = 14;
const MAX_ZOOM = 20;
// v299 N2: another -1 from previous 16.5 per user request — "默认应该
// 是现在的zoom -1的大小 就是我点了屏幕的-". Initial view now starts at
// the same zoom as one minus tap from v298. At 15.5 the 50m ring is
// still readable (~80px diameter) but more peripheral context is
// visible.
const INITIAL_ZOOM = 15.5;
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

export function PinAdjustStep({
  gpsLat, gpsLng, initialLat, initialLng, accuracyM, onConfirm, onBack,
}: Props) {
  const Mapbox = getMapbox();
  // Safety: if the supplied initial pin is somehow outside the 50m
  // ring (shouldn't happen — confirm gate is also 50m — but defends
  // against draft persistence migration / future refactors), clamp
  // it back to the GPS anchor. (N5 invariant: visible pin is always
  // within the ring on mount.)
  const initialDist = haversineM({ lat: gpsLat, lng: gpsLng }, { lat: initialLat, lng: initialLng });
  const startLat = initialDist > PinNudgeConfig.maxNudgeMeters ? gpsLat : initialLat;
  const startLng = initialDist > PinNudgeConfig.maxNudgeMeters ? gpsLng : initialLng;

  const [pinLat, setPinLat] = useState(startLat);
  const [pinLng, setPinLng] = useState(startLng);
  const [zoom, setZoom] = useState(INITIAL_ZOOM);
  const [hintVisible, setHintVisible] = useState(false);
  // v299 N4: only show the Target (recenter) button once the user has
  // actually moved the map. Initial mount = map already centered on
  // origin, recenter would be a no-op.
  const [hasMoved, setHasMoved] = useState(false);
  // v298 N4: high-frequency boundary flag so the confirm button
  // disables IMMEDIATELY when the map center crosses the 50m ring
  // (no 200ms onMapIdle latency). Updated by onCameraTick; setState
  // only fires when crossing the boundary (1 event per crossing),
  // so this is NOT a render storm.
  const [overLimit, setOverLimit] = useState(false);
  // origin = the immutable GPS anchor from step 1, NOT the last
  // confirmed pin coord. Cannot drift across step 3 → step 2 back.
  const originRef = useRef({ lat: gpsLat, lng: gpsLng });
  const hintTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [mapStyle, setMapStyle] = useState<'outdoors' | 'satellite'>('outdoors');
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
  const latestCoordRef = useRef<{ lat: number; lng: number }>({ lat: startLat, lng: startLng });
  const latestZoomRef = useRef<number>(INITIAL_ZOOM);

  // v298 N2: removed first-time mobile-data Alert per user feedback.
  // Style toggle is now instant + free; satellite tiles still cache
  // locally on Mapbox's side after first load.
  const onToggleStyle = () => {
    const next = mapStyle === 'outdoors' ? 'satellite' : 'outdoors';
    log('plant.pin_style_toggle', { to: next });
    setMapStyle(next);
  };

  // v299 N1: removed accuracy fill+outline ring per user request —
  // "实心圈不要 只要外层虚线50m圈". Only the 50m maxNudgeCircle
  // remains on the map.
  const maxNudgeCircle = useMemo(
    () => makeCircleGeoJson(originRef.current.lat, originRef.current.lng, PinNudgeConfig.maxNudgeMeters),
    []
  );

  // Show a hint banner when the user pushes past the boundary;
  // hide it 2.5s after they stop pushing.
  // v301 Bug B: dedup — if hint is already visible, don't reset the
  // timer on every camera-tick. Under high-frequency onCameraChanged
  // events (30-60Hz) the previous always-reset path created a
  // setTimeout / clearTimeout churn that pinned the JS thread and
  // delayed `Back` taps by several seconds.
  const briefHint = () => {
    if (hintTimer.current) return;  // already counting down — leave alone
    tickCountRef.current.hintShows++;
    setHintVisible(true);
    hintTimer.current = setTimeout(() => {
      setHintVisible(false);
      hintTimer.current = null;
    }, 2500);
  };

  useEffect(() => () => {
    if (hintTimer.current) clearTimeout(hintTimer.current);
  }, []);

  // v301 Bug A: skip the very first batch of onCameraChanged events.
  // Mapbox emits transient camera positions during init (e.g. [0,0]
  // before defaultSettings applies) which haversine to GPS origin
  // measures as thousands of km — that wrongly flips overLimit=true
  // and triggers a hint on mount, BEFORE the user has even seen the
  // map. We wait for onMapIdle to fire ONCE (= camera has settled at
  // defaultSettings center) before honoring camera-tick events.
  const cameraReadyRef = useRef(false);

  /**
   * onCameraChanged fires high-frequency (every frame during pan).
   * Refs (latestCoordRef, latestZoomRef) update every event — these
   * power the confirm-tap source-of-truth read (no setState, no
   * render).
   *
   * v298 N4: also flip `overLimit` state when the map center crosses
   * the 50m ring. This gives REAL-TIME visual feedback (button
   * disabled, hint banner) — previously the button only disabled at
   * onMapIdle settle which had a 100-200ms lag. We compare against
   * the current state and setState only when crossing (once per
   * crossing) so this is NOT a render storm despite 30-60Hz events.
   *
   * v301 Bug A+B: gate dist/hint work behind cameraReadyRef so the
   * map's init transients never flip overLimit/hint on mount; gate
   * briefHint() so reflowing setTimeout doesn't pile up under
   * high-frequency mapbox events.
   */
  // v301 perf instrumentation: count onCameraChanged frequency and
  // briefHint setTimeout reuses, so we can see in real-device telemetry
  // whether the v301 fixes keep the JS-thread cost bounded.
  const tickCountRef = useRef({ ticks: 0, overLimitFlips: 0, hintShows: 0 });
  // v301 Pri-1 fix (subagent perf review): mirror overLimit + hasMoved
  // to refs so the high-frequency onCameraTick path can EARLY-RETURN
  // before scheduling a setState. Previously setOverLimit((prev) =>
  // prev === newOver ? prev : newOver) still went through React's
  // scheduler queue (which de-dupes on reconcile but pays per-tick
  // queue cost) — under 30-60Hz pan events that queue starved user
  // tap events, causing the reported "Back tap delayed 5 seconds".
  const overLimitRef = useRef(false);
  const hasMovedRef = useRef(false);
  // v301 Pri-1 fix: throttle onCameraTick to 10Hz (every 100ms). The
  // human eye can't tell the difference between 10Hz and 60Hz boundary
  // detection on a 50m ring; the JS thread certainly can. Light work
  // (ref writes) still runs every frame; heavy work (haversine,
  // setState, briefHint) runs at most 10×/s.
  const lastTickMsRef = useRef(0);
  useEffect(() => {
    const id = setInterval(() => {
      const c = tickCountRef.current;
      if (c.ticks > 0) {
        log('plant.pin_perf', {
          ticks_5s: c.ticks,
          over_flips_5s: c.overLimitFlips,
          hint_shows_5s: c.hintShows,
        });
        tickCountRef.current = { ticks: 0, overLimitFlips: 0, hintShows: 0 };
      }
    }, 5000);
    return () => clearInterval(id);
  }, []);

  const onCameraTick = (feature: any) => {
    tickCountRef.current.ticks++;
    const coord = feature?.properties?.center;
    if (!Array.isArray(coord) || coord.length < 2) return;
    const lng = coord[0];
    const lat = coord[1];
    // Cheap path: always update refs so confirm-tap reads truth even
    // mid-frame between throttled ticks.
    latestCoordRef.current = { lng, lat };
    const z = feature?.properties?.zoom;
    if (typeof z === 'number') latestZoomRef.current = z;

    // v301 Bug A: ignore camera-tick events that arrive before the
    // map has settled at the GPS origin for the first time.
    if (!cameraReadyRef.current) return;

    // v301 Pri-1: throttle heavy work (haversine + state) to 10Hz.
    const now = Date.now();
    if (now - lastTickMsRef.current < 100) return;
    lastTickMsRef.current = now;

    // Real-time boundary cross detection (N4) — now throttled.
    const dist = haversineM(
      { lat: originRef.current.lat, lng: originRef.current.lng },
      { lat, lng }
    );
    const newOver = dist > PinNudgeConfig.maxNudgeMeters;
    // Pri-1: ref-gate so React scheduler queue stays clean.
    if (overLimitRef.current !== newOver) {
      overLimitRef.current = newOver;
      tickCountRef.current.overLimitFlips++;
      setOverLimit(newOver);
    }
    if (newOver) {
      briefHint();
    }

    // v418 fix: hasMoved is a symmetric position check, not a one-way flag.
    // Show recenter icon iff map center is >0.5m from GPS origin. Setting
    // hasMoved=true in one direction only (as v299 did) means doRecenter's
    // setCamera animation frames (which pass through onCameraTick with
    // dist>0.5 mid-transition) can re-flip it back to true after doRecenter
    // sets false — causing the icon to require a second tap to disappear.
    // Now the flag mirrors current position vs origin every tick, no
    // timers or suppress windows needed.
    const shouldShow = dist > 0.5;
    if (hasMovedRef.current !== shouldShow) {
      hasMovedRef.current = shouldShow;
      setHasMoved(shouldShow);
    }
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

    // v301 Bug A: first settle = camera has snapped to defaultSettings
    // (= GPS origin). From this point on it's safe to trust subsequent
    // onCameraChanged events as real user-initiated motion.
    if (!cameraReadyRef.current) {
      cameraReadyRef.current = true;
    }

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

  // v298 N1: "回归当前位置" button — pull the map back to the GPS
  // anchor (originRef), preserving current zoom level. Works in both
  // outdoors and satellite styles. Equivalent to HikingScreen's
  // Target button at HikingScreen.tsx:1647-1664.
  const doRecenter = () => {
    const lng = originRef.current.lng;
    const latC = originRef.current.lat;
    const z = latestZoomRef.current;
    expectedCenterRef.current = [lng, latC];
    cameraRef.current?.setCamera?.({
      centerCoordinate: [lng, latC],
      zoomLevel: z,
      animationDuration: 280,
    });
    // v418: no manual setHasMoved needed — onCameraTick now mirrors
    // position vs origin every tick. Icon stays visible during the
    // 280ms recenter animation and disappears cleanly when settled.
    log('plant.pin_recenter', {});
  };

  if (!Mapbox.available) {
    return <PinAdjustFallback lat={startLat} lng={startLng} accuracyM={accuracyM}
                              onConfirm={() => onConfirm(pinLat, pinLng)}
                              onBack={onBack} />;
  }
  const { MapView, Camera, ShapeSource, FillLayer, LineLayer } = Mapbox;

  return (
    <View style={styles.container}>
      {/* v299 N3: BackButton in the top area, above the title — not
          overlaid on the map. Matches the user's preference of "back
          不是在图层里的 是在 you are here 上方的". */}
      <View style={styles.backRow}>
        <BackButton variant="pill" onPress={onBack} />
      </View>
      <Text style={styles.title}>Where's your cairn?</Text>
      <Text style={styles.sub}>
        Drag the map to fine-tune. Tap Confirm when it feels right.
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
          {/* v299 N1: accuracy ring removed; only 50m nudge ring stays. */}
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

        {/* v302 N1: simplified pin — single circle, no tail.
            With the old pinHead+pinTail bounding box the View center
            (= screenCenter = map.center = stored lat/lng) was NOT
            the visual circle center but a midpoint between head and
            tail, so the visible arrow could be outside the 50m ring
            while the stored coord was still inside. Now the circle
            IS the anchor, no ambiguity. */}
        <View pointerEvents="none" style={styles.centerOverlay}>
          <View style={styles.pinDot}>
            <View style={styles.pinDotInner} />
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
          {/* v299 N4: Target only visible after the user has moved
              the map from origin. Hidden initially since recenter
              is a no-op. */}
          {hasMoved && (
            <TouchableOpacity
              style={[styles.zoomBtn, { marginTop: 6 }]}
              onPress={doRecenter}
              activeOpacity={0.7}
            >
              <Icon
                name="Target"
                size={18}
                color={Colors.primary}
                strokeWidth={2}
              />
            </TouchableOpacity>
          )}
        </View>

        {/* v299 N3: BackButton moved out of the map layer — see
            backRow above the title. */}
      </View>

      {/* v418: accuracy chip + field note fill the previously-empty
          gap between map and Confirm button. Keeps user oriented
          (accuracy) and reinforces Cairn/NZ handbook tone. */}
      <View style={styles.metaRow}>
        <View style={styles.metaChip}>
          <View style={styles.metaDot} />
          <Text style={styles.metaChipText}>± {Math.round(accuracyM)} m accuracy</Text>
        </View>
      </View>

      <View style={styles.fieldNote}>
        <View style={styles.fieldNoteAccent} />
        <Text style={styles.fieldNoteHeader}>·· Field note ··</Text>
        <Text style={styles.fieldNoteBody}>
          <Text style={styles.fieldNoteLede}>Cairns rest lightly.</Text>
          {' '}Return them when you leave.
        </Text>
      </View>

      <View style={{ flex: 1 }} />
      {/* Confirm button.
          v298 N4: button state driven by `overLimit` (flipped in
          onCameraChanged the moment the map crosses the 50m ring) —
          NOT by onMapIdle-state pinLat/pinLng which lagged ~120ms.
          v297 B2: onPress still re-reads latestCoordRef as final
          source of truth, so even a residual visible/real mismatch
          can't submit a stale coord. */}
      {(() => {
        const canConfirm = !overLimit;
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
              {canConfirm ? 'Confirm this spot' : `Pin too far — pan back within ${PinNudgeConfig.maxNudgeMeters} m`}
            </Text>
          </TouchableOpacity>
        );
      })()}
    </View>
  );
}

function PinAdjustFallback({
  lat, lng, onConfirm, onBack,
}: {
  lat: number; lng: number; accuracyM: number;
  onConfirm: () => void; onBack: () => void;
}) {
  return (
    <View style={styles.container}>
      <View style={styles.backRow}>
        <BackButton variant="pill" onPress={onBack} />
      </View>
      <Text style={styles.title}>Where's your cairn?</Text>
      <Text style={styles.sub}>Map preview not available on this platform.</Text>
      <View style={styles.fallbackBox}>
        <Text style={styles.fallbackCoord}>{lat.toFixed(6)}, {lng.toFixed(6)}</Text>
      </View>
      <View style={{ flex: 1 }} />
      <TouchableOpacity style={styles.primaryBtn} onPress={onConfirm}>
        <Text style={styles.primaryBtnText}>Confirm</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  title: { fontSize: 22, fontWeight: '500', color: MemoryColors.sepiaDeep, marginBottom: 6 },
  sub:   { fontSize: 13, color: MemoryColors.cairnPublic, marginBottom: 16 },
  mapWrap: {
    height: 300,
    borderRadius: 14,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: Colors.border,
  },
  // v418: single-chip meta row under the map for accuracy readout.
  metaRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 12,
    flexWrap: 'wrap',
  },
  metaChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 14,
    backgroundColor: '#fff',
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 2,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  metaDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: '#5d7c46',
  },
  metaChipText: {
    fontSize: 12,
    color: '#4a3d2c',
    fontWeight: '500',
  },
  // v418: field note — handbook book-edge style. Top warm-sepia hairline
  // gives it a "torn from a field notebook" feel, so it reads as a
  // natural part of the page instead of a toast/warning banner.
  fieldNote: {
    marginTop: 12,
    paddingTop: 14,
    paddingBottom: 12,
    paddingHorizontal: 16,
    backgroundColor: '#faf4e6',
    borderRadius: 10,
    position: 'relative',
    overflow: 'hidden',
  },
  fieldNoteAccent: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 2,
    backgroundColor: '#c88a2a',
    opacity: 0.85,
  },
  fieldNoteHeader: {
    fontSize: 10,
    color: '#a67c3e',
    letterSpacing: 1.4,
    textTransform: 'uppercase',
    fontWeight: '700',
    marginBottom: 5,
  },
  fieldNoteBody: {
    fontSize: 13,
    color: '#6a4c22',
    lineHeight: 20,
  },
  fieldNoteLede: {
    color: '#5d7c46',
    fontStyle: 'italic',
    fontWeight: '500',
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
  // v299 N3: BackButton row above the title (not overlaid on map).
  backRow: {
    flexDirection: 'row',
    paddingBottom: 8,
  },
  centerOverlay: {
    position: 'absolute',
    top: 0, bottom: 0, left: 0, right: 0,
    alignItems: 'center', justifyContent: 'center',
  },
  // v302 N1: replacement for old pin head+tail. Outer ring is the
  // type color (defaults to flag/orange) at 30 px; inner dot at 10 px
  // gives a clear, centered "this is the spot" marker. Both centers
  // align to the View's geometric center, which Flexbox places
  // exactly on the screen center. Stored lat/lng == visual center.
  pinDot: {
    width: 30, height: 30, borderRadius: 15,
    backgroundColor: 'rgba(255,255,255,0.55)',
    borderWidth: 3,
    borderColor: Colors.flag,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
  },
  pinDotInner: {
    width: 10, height: 10, borderRadius: 5,
    backgroundColor: Colors.flag,
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
  primaryBtn: {
    backgroundColor: MemoryColors.sepia,
    padding: 14, borderRadius: 12, alignItems: 'center',
  },
  primaryBtnDisabled: {
    backgroundColor: '#d4ccbd',
  },
  primaryBtnText: { color: '#fff', fontSize: 14, fontWeight: '500' },
  primaryBtnTextDisabled: { color: '#fff', opacity: 0.85 },
});
