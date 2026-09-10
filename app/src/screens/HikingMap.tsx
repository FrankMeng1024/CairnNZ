/**
 * HikingMap — full-screen Mapbox map component for the hiking/running screen.
 *
 * Extracted from HikingScreen.tsx (O1 batch 28 refactor).
 *
 * - Real Mapbox native (iOS/Android) when @rnmapbox/maps is available.
 * - Web/Expo-Go fallback: simple tile placeholder with overlay MarkerPins.
 * - Polyline splits at signal-loss gaps (dt > 120s AND dist > 200m).
 * - Simulator puck: skips Mapbox.UserLocation and draws the synthetic source.
 */
import React, { useState, useRef, useEffect, useMemo } from 'react';
import {
  View, Text, StyleSheet, Platform, ActivityIndicator, Image,
} from 'react-native';
import { Colors, Spacing, FontSize, Radius, Shadow } from '../components/tokens';
import { Icon, type IconName } from '../components/Icon';
import { getCurrentRegion } from '../config/regions';
import { getMapStyleForLayer, getMapStyleForTheme, getPrimaryMapStyle, themeToStandardPreset, buildStandardConfig, isMapboxTokenConfigured } from '../config/mapbox';
import { useSettingsStore } from '../store/useSettingsStore';
import { useVisualTheme } from '../hooks/useVisualTheme';
import { useMapTheme } from '../hooks/useMapTheme';
import { haversineM } from '../utils/geo';
import { useTrackingStore } from '../store/useTrackingStore';
import { MARKER_META } from '../data/mockData';
import { FLAG_TYPES } from '../data/flagTypes';
import { MarkerPin } from './MarkerPin';
import type { Marker } from '../store/useMarkerStore';
import { registerSimulatorMapCenterGetter } from '../features/activitySimulator/simulatorMapBridge';
import { useActivitySimulatorStore } from '../features/activitySimulator/useActivitySimulatorStore';
import { appendSimulatorLog } from '../features/activitySimulator/simulatorLog';
import { activitySimulatorBuildCapable } from '../features/activitySimulator/capability';
import { useIsFocused } from '@react-navigation/native';

// ── Mapbox conditional import ────────────────────────────────────────────
// @rnmapbox/maps components are native-only — on web they may be undefined.
// Force fallback on web to avoid "Element type is invalid" crash.
let MapView: any = null;
let CameraComponent: any = null;
let PointAnnotation: any = null;
let UserLocationComponent: any = null;
let LineLayer: any = null;
let ShapeSource: any = null;
let CircleLayer: any = null;
let StyleImport: any = null;
if (Platform.OS !== 'web') {
  try {
    const Mapbox = require('@rnmapbox/maps');
    MapView = Mapbox.MapView;
    CameraComponent = Mapbox.Camera;
    PointAnnotation = Mapbox.PointAnnotation;
    UserLocationComponent = Mapbox.UserLocation;
    LineLayer = Mapbox.LineLayer;
    ShapeSource = Mapbox.ShapeSource;
    CircleLayer = Mapbox.CircleLayer;
    StyleImport = Mapbox.StyleImport;
  } catch {
    // Mapbox native not available
  }
}

type HikingMapProps = {
  markers: Marker[];
  // v78 #1: trackPoints carry an optional `t` (epoch ms) so we can split
  // the polyline at GPS-signal-loss gaps. When two consecutive points are
  // separated by more than GAP_THRESHOLD_MS in time, we render that
  // segment as a dashed "lost signal" line instead of a solid track.
  trackPoints: Array<{ lat: number; lng: number; t?: number; segmentId?: string }>;
  onMarkerPress: (id: string) => void;
  // When a saved route is selected and the user isn't already at its
  // start, we draw a dashed "approach" line from the user's current
  // position to the route's first waypoint, plus a "Start" pin so the
  // user can see how far away the trailhead is.
  routeStart?: { lat: number; lng: number } | null;
  userPos?: { lat: number; lng: number } | null;
  // 2026-08-17 concept H1/R1: green dot marker placed at trackPoints[0]
  // so the user can see where they started. Rendered via PointAnnotation
  // with the extracted concept asset (assets/map/marker-start.png).
  // Passing `null` disables it (used pre-tracking on H0/R0).
  trackStartVariant?: 'hike' | 'run' | null;
  activityVariant?: 'hike' | 'run';
  // When true, skip the camera fly-in animation. Used when resuming
  // an in-progress hike — the user already knows where they are, the
  // 1-second zoom-in feels slow.
  instantCamera?: boolean;
  // v118: external follow-user toggle. When false, the Mapbox Camera
  // disables followUserLocation so the user can pan/zoom without being
  // snapped back. The recenter button (rendered by HikingScreen, not
  // HikingMap) flips this back to true via setFollowUser.
  followUser?: boolean;
  onUserGesture?: () => void;
  // v119: optional ref the parent fills with an imperative recenter()
  // function so the recenter button can flyTo the user's location even
  // when the cameraRef itself is private to HikingMap.
  /** Fixed provider is Simulator; never use this merely for generic Debug Mode. */
  simulatorEnabled?: boolean;
  /** Simulator setup affordances may be visible before a start is authoritative. */
  simulatorControlsEnabled?: boolean;
  /** Fixed target only while choosing an origin, destination, or reacquisition. */
  simulatorCenterPickerVisible?: boolean;
  recenterImperativeRef?: React.MutableRefObject<(() => void) | null>;
};

export function HikingMap({
  markers, trackPoints, onMarkerPress, routeStart, userPos,
  instantCamera, followUser = true, onUserGesture, recenterImperativeRef,
  simulatorEnabled, simulatorControlsEnabled = simulatorEnabled,
  simulatorCenterPickerVisible = false,
  trackStartVariant = null, activityVariant = 'hike',
}: HikingMapProps) {
  const isFocused = useIsFocused();
  const telemetryScreenPrefix = activityVariant === 'run' ? 'run' : 'hike';
  const region = getCurrentRegion();
  // O18 MAP-01: react to user's saved map layer preference (outdoors / satellite).
  const mapLayer = useSettingsStore((s) => s.mapLayer);
  const debugMode = useSettingsStore((s) => s.debugMode);
  const theme = useVisualTheme();
  const mapTheme = useMapTheme();
  const hikeLightPreset = themeToStandardPreset(mapTheme);

  // R114/O22 (2026-08-08) Bug 4: watch network state. When offline, Mapbox
  // tiles fail to fetch → map renders black/white. Overlay a friendly
  // banner so the user knows why the map isn't drawing and can decide
  // whether to keep hiking. Non-fatal for GPS recording — track continues.
  const [isOffline, setIsOffline] = useState(false);
  // R114/O22 Bug 4: also track "map has finished rendering at least once".
  // On first launch tiles must download from Mapbox — if the CDN is slow
  // (common in China) the user stares at a white canvas thinking the app
  // is broken. This state drives a "Loading map…" overlay that hides
  // itself as soon as the native side reports the map is fully rendered.
  const [mapFirstRender, setMapFirstRender] = useState(false);
  const [mapEpoch, setMapEpoch] = useState(0);
  const mapMountIdRef = useRef(`${telemetryScreenPrefix}-map-${Date.now().toString(36)}-0`);
  const hasFocusedRef = useRef(false);
  // R114/O24 (2026-08-12) Hiking Loading Map fix: onDidFinishRenderingMapFully
  // alone is unreliable — matches Memory v361 lesson (v357 telemetry showed
  // that event never fires in a normal session). Add onDidFinishLoadingMap
  // (fires when style + first tile batch ready = basemap visible) as the
  // primary trigger, keep onDidFinishRenderingMapFully as backup, and add
  // an 8s wall-clock fallback so the overlay never gets stuck permanently.
  useEffect(() => {
    if (mapFirstRender) return;
    const t = setTimeout(() => {
      setMapFirstRender(true);
      if (activitySimulatorBuildCapable) {
        useActivitySimulatorStore.getState().setMapDiagnostics({
          screen: telemetryScreenPrefix,
          mounted: Boolean(MapView),
          mapReady: false,
          loadState: 'timed-out',
          lastEvent: 'readiness-timeout',
        });
        appendSimulatorLog('MAP_STATE', `${telemetryScreenPrefix}_map_readiness_timeout`, {
          mountId: mapMountIdRef.current,
        }, { coordinateSource: 'none' });
      }
    }, 8000);
    return () => clearTimeout(t);
  }, [mapFirstRender, mapEpoch]);
  useEffect(() => {
    if (!isFocused) return undefined;
    const nextEpoch = hasFocusedRef.current ? mapEpoch + 1 : mapEpoch;
    const mountId = `${telemetryScreenPrefix}-map-${Date.now().toString(36)}-${nextEpoch}`;
    mapMountIdRef.current = mountId;
    if (hasFocusedRef.current) setMapEpoch(nextEpoch);
    hasFocusedRef.current = true;
    setMapFirstRender(false);
    firstRealLocationSeenRef.current = false;
    initialCameraAppliedRef.current = false;
    if (!activitySimulatorBuildCapable) return undefined;
    useActivitySimulatorStore.getState().setMapDiagnostics({
      mountId,
      screen: telemetryScreenPrefix,
      mounted: Boolean(MapView),
      styleLoaded: false,
      mapReady: false,
      loadState: MapView ? 'loading' : 'error',
      lastEvent: MapView ? 'mounted' : 'native-map-unavailable',
    });
    appendSimulatorLog('MAP_STATE', `${telemetryScreenPrefix}_map_mounted`, {
      mountId,
      nativeMapAvailable: Boolean(MapView),
      cameraRefAvailable: Boolean(cameraRef.current),
      cameraInitialTarget: instantCamera && userPos ? 'accepted-location' : 'mapbox-default',
      cameraAnimationMode: instantCamera ? 'none' : 'flyTo',
      cameraAnimationDurationMs: instantCamera ? 0 : 600,
      realUserLocationMounted: !simulatorEnabled,
      mapboxTokenConfigured: isMapboxTokenConfigured(),
    }, { coordinateSource: 'none' });
    appendSimulatorLog('MAP_STATE', `${telemetryScreenPrefix}_map_style_load_started`, { mountId }, { coordinateSource: 'none' });
    return () => {
      const state = useActivitySimulatorStore.getState();
      if (state.mapDiagnostics.screen === telemetryScreenPrefix) {
        state.setMapDiagnostics({ mounted: false, loadState: 'unmounted', lastEvent: 'unmounted' });
      }
      appendSimulatorLog('MAP_STATE', `${telemetryScreenPrefix}_map_unmounted`, { mountId }, { coordinateSource: 'none' });
    };
  // Focus is the screen-entry boundary. Mapbox receives a fresh native key,
  // while durable Activity/provider state remains in its independent store.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isFocused]);
  useEffect(() => {
    if (!activitySimulatorBuildCapable) return;
    useActivitySimulatorStore.getState().setMapDiagnostics({
      screen: telemetryScreenPrefix,
      cameraTarget: userPos ? { lat: userPos.lat, lng: userPos.lng } : null,
      displayedPosition: userPos ? { lat: userPos.lat, lng: userPos.lng } : null,
    });
  }, [userPos?.lat, userPos?.lng]);
  useEffect(() => {
    let cancelled = false;
    let unsub: (() => void) | undefined;
    (async () => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const NetInfo = require('@react-native-community/netinfo').default;
        const state = await NetInfo.fetch();
        if (!cancelled) setIsOffline(!(state.isConnected && state.isInternetReachable !== false));
        unsub = NetInfo.addEventListener((st: { isConnected: boolean; isInternetReachable: boolean | null }) => {
          if (cancelled) return;
          setIsOffline(!(st.isConnected && st.isInternetReachable !== false));
        });
      } catch { /* NetInfo not available on this platform — treat as online */ }
    })();
    return () => { cancelled = true; if (unsub) unsub(); };
  }, []);

  // v79 #1 fix: split the track into solid + gap segments by time AND
  // distance. v78 used 30s alone, but real walking data showed 30-90s
  // gaps with <10m distance (user standing at a light, slow walk
  // through dense city, dynamic-sampling 0.1Hz when stationary). All
  // those triggered false-positive dashed segments.
  //
  // Real signal-loss (verified on session 38 metro hike): 13-minute
  // gap with kilometres of distance. So the rule is now both:
  //   • dt > 120s (long enough to genuinely stop tracking)
  //   • dist > 200m (user actually moved out of GPS reach)
  // Stationary users + dynamic-sampling-driven slow ticks no longer
  // false-trigger. Real underground/metro segments still draw dashed.
  const GAP_THRESHOLD_MS = 120_000;
  const GAP_DIST_THRESHOLD_M = 200;
  type Segment = { coords: [number, number][]; gap: boolean };

  // 2026-07-20 perf: memoize segment computation + GeoJSON build.
  // Runs O(N) over trackPoints; without memo this fires every render even
  // when trackPoints reference is unchanged. `trackPoints` gets a new
  // reference every 3s during a hike so the memo dep is intentional.
  //
  // R114/O22 STORY-73014 (K4): during LIVE hike, do NOT draw dashed gap
  // segments. User spec: "hike realtime polyline gap 段完全不画" — a
  // dashed line across signal-loss regions was misleading users who
  // thought the app was tracking during the gap. Finished activities
  // (MapHistoryScreen) still render dashes because there the user is
  // reviewing a completed hike and the dash correctly conveys "we lost
  // signal here". This file (HikingMap) is only mounted during live
  // hikes, so we simply return an empty gapGeoJSON.
  const { solidGeoJSON, gapGeoJSON } = useMemo(() => {
    const segs: Segment[] = [];
    if (trackPoints.length >= 2) {
      let cur: Segment = { coords: [[trackPoints[0].lng, trackPoints[0].lat]], gap: false };
      for (let i = 1; i < trackPoints.length; i++) {
        const prev = trackPoints[i - 1];
        const p = trackPoints[i];
        const dt = (prev.t != null && p.t != null) ? (p.t - prev.t) : 0;
        const distM = haversineM({ lat: prev.lat, lng: prev.lng }, { lat: p.lat, lng: p.lng });
        const isSegmentBreak = Boolean(prev.segmentId && p.segmentId && prev.segmentId !== p.segmentId);
        const isGap = !isSegmentBreak && dt > GAP_THRESHOLD_MS && distM > GAP_DIST_THRESHOLD_M;
        if (isSegmentBreak) {
          // Close the current segment, start a fresh one at the new
          // point. No gap-dash rendering — just a clean break.
          if (cur.coords.length >= 2) segs.push(cur);
          cur = { coords: [[p.lng, p.lat]], gap: false };
        } else if (isGap) {
          // R114/O22 STORY-73014: break the polyline cleanly. Do NOT
          // push a gap segment — during live hike we want zero visual
          // connection across signal loss. Also emit a crashLogger
          // breadcrumb so post-hoc debugging can see which fixes were
          // treated as gaps.
          if (cur.coords.length >= 2) segs.push(cur);
          try {
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const cl = require('../services/crashLogger');
            (cl.crashLogger ?? cl.default)?.breadcrumb?.(
              `k4:gap dt_ms=${dt} dist_m=${Math.round(distM)}`
            );
          } catch { /* silent */ }
          cur = { coords: [[p.lng, p.lat]], gap: false };
        } else {
          cur.coords.push([p.lng, p.lat]);
        }
      }
      if (cur.coords.length >= 2) segs.push(cur);
    }
    return {
      solidGeoJSON: {
        type: 'FeatureCollection' as const,
        features: segs.filter(s => !s.gap).map(s => ({
          type: 'Feature' as const,
          geometry: { type: 'LineString' as const, coordinates: s.coords },
          properties: {},
        })),
      },
      // R114/O22 STORY-73014: always empty during live hike — see comment above.
      gapGeoJSON: {
        type: 'FeatureCollection' as const,
        features: [] as Array<{ type: 'Feature'; geometry: { type: 'LineString'; coordinates: number[][] }; properties: Record<string, never> }>,
      },
    };
  }, [trackPoints]);

  const traceTailTimestamp = trackPoints[trackPoints.length - 1]?.t ?? null;
  useEffect(() => {
    if (!activitySimulatorBuildCapable || traceTailTimestamp === null) return;
    appendSimulatorLog('MAP_STATE', 'activity_trace_state_received', {
      screen: telemetryScreenPrefix,
      pointCount: trackPoints.length,
      sequenceTimestamp: Math.floor(traceTailTimestamp),
      reactObservedWallTimestamp: Date.now(),
      sampleAgeMs: simulatorEnabled ? 0 : Math.max(0, Date.now() - traceTailTimestamp),
    }, {
      clientActivityId: useTrackingStore.getState().sessionId,
      coordinateSource: simulatorEnabled ? 'simulator' : 'real',
    });
    // React Native/Mapbox does not expose a per-ShapeSource paint callback.
    // This checkpoint is therefore explicitly the source-update request, not a
    // claim that the GPU has painted; it bounds the app-side render latency.
    appendSimulatorLog('MAP_STATE', 'activity_trace_map_source_update_requested', {
      screen: telemetryScreenPrefix,
      pointCount: trackPoints.length,
      sequenceTimestamp: Math.floor(traceTailTimestamp),
      mapSourceRequestWallTimestamp: Date.now(),
      sampleAgeMs: simulatorEnabled ? 0 : Math.max(0, Date.now() - traceTailTimestamp),
    }, {
      clientActivityId: useTrackingStore.getState().sessionId,
      coordinateSource: simulatorEnabled ? 'simulator' : 'real',
    });
    appendSimulatorLog('MAP_STATE', 'activity_live_trace_update_v2', {
      screen: telemetryScreenPrefix,
      canonicalVersion: trackPoints.length,
      routePointCount: trackPoints.length,
      segmentCount: solidGeoJSON.features.length,
      sequenceTimestamp: Math.floor(traceTailTimestamp),
      sourceAssignmentWallTimestamp: Date.now(),
      tailAgeMs: simulatorEnabled ? 0 : Math.max(0, Date.now() - traceTailTimestamp),
    }, {
      clientActivityId: useTrackingStore.getState().sessionId,
      coordinateSource: simulatorEnabled ? 'simulator' : 'real',
    });
  }, [traceTailTimestamp, trackPoints.length, simulatorEnabled, telemetryScreenPrefix, solidGeoJSON.features.length]);

  // Imperative camera ref — used to forcefully snap the camera to the
  // user's position on resume, bypassing the followUserLocation
  // auto-fly-to-puck animation that runs even when defaultSettings is
  // provided. Without this, "Resume" still flies in from globe view.
  const cameraRef = useRef<any>(null);
  // The bounded bridge exposes only map center selection to the QA panel.
  const mapViewRef = useRef<any>(null);
  const flyToStateRef = useRef<{ startedAt: number; timeout: ReturnType<typeof setTimeout> | null } | null>(null);
  const firstRealLocationSeenRef = useRef(false);
  const initialCameraAppliedRef = useRef(false);

  useEffect(() => () => {
    if (flyToStateRef.current?.timeout) clearTimeout(flyToStateRef.current.timeout);
    if (flyToStateRef.current) {
      appendSimulatorLog('MAP_STATE', `${telemetryScreenPrefix}_camera_fly_to_interrupted`, {
        reason: 'map-unmounted',
      }, { coordinateSource: 'none' });
      flyToStateRef.current = null;
    }
  }, []);

  const handleRealUserLocationUpdate = (location: any) => {
    if (!activitySimulatorBuildCapable) return;
    appendSimulatorLog('LOCATION', 'real_location_sample_observed', {
      accuracyM: location?.coords?.accuracy ?? null,
      altitudeAvailable: Number.isFinite(location?.coords?.altitude),
      speedMps: location?.coords?.speed ?? null,
      sequenceTimestamp: location?.timestamp ?? null,
    }, { coordinateSource: 'real' });
    if (firstRealLocationSeenRef.current) return;
    firstRealLocationSeenRef.current = true;
    if (instantCamera || simulatorEnabled || !followUser || flyToStateRef.current) return;
    const startedAt = Date.now();
    appendSimulatorLog('MAP_STATE', `${telemetryScreenPrefix}_camera_fly_to_started`, {
      trigger: 'first-real-user-location',
      animationDurationMs: 600,
      initialTarget: 'mapbox-default',
    }, { coordinateSource: 'none' });
    const timeout = setTimeout(() => {
      if (flyToStateRef.current?.startedAt !== startedAt) return;
      appendSimulatorLog('MAP_STATE', `${telemetryScreenPrefix}_camera_fly_to_interrupted`, {
        reason: 'no-map-idle-after-animation-window',
      }, { coordinateSource: 'none' });
      flyToStateRef.current = null;
    }, 1_600);
    flyToStateRef.current = { startedAt, timeout };
  };

  useEffect(() => {
    if (!debugMode) return undefined;
    const getter = async () => {
      try {
        const m = mapViewRef.current;
        if (!m || typeof m.getCenter !== 'function') return null;
        const raw = m.getCenter();
        const c = raw && typeof raw.then === 'function' ? await raw : raw;
        if (Array.isArray(c) && c.length >= 2) return { lat: c[1], lng: c[0] };
        if (c && typeof c.lat === 'number' && typeof c.lng === 'number') return { lat: c.lat, lng: c.lng };
        return null;
      } catch {
        return null;
      }
    };
    return registerSimulatorMapCenterGetter(getter);
  }, [debugMode]);

  // v119: expose an imperative recenter() to the parent so the recenter
  // button (rendered outside HikingMap) can flyTo the user's location
  // and force zoom=15. Mapbox's followUserLocation alone doesn't reset
  // zoom — toggling it true→true is a no-op when zoom has been changed.
  useEffect(() => {
    if (!recenterImperativeRef) return;
    recenterImperativeRef.current = () => {
      // Simulator fixes intentionally do not populate the real-GPS selector
      // before every camera action. Recenter on the position already chosen
      // by the screen for the active provider; preserve the old store lookup
      // for normal GPS.
      const cur = simulatorEnabled ? userPos : useTrackingStore.getState().lastCoordinate;
      appendSimulatorLog('MAP_STATE', `${telemetryScreenPrefix}_camera_recenter_tapped`, {
        providerSource: simulatorEnabled ? 'simulator' : 'real',
        hasTarget: Boolean(cur),
        cameraRefAvailable: Boolean(cameraRef.current),
      }, { coordinateSource: 'none' });
      if (!cur || !cameraRef.current) {
        appendSimulatorLog('MAP_STATE', `${telemetryScreenPrefix}_camera_recenter_rejected`, {
          rejectionReason: !cur ? 'no-accepted-target' : 'camera-ref-unavailable',
        }, { coordinateSource: 'none' });
        return;
      }
      cameraRef.current.setCamera({
        centerCoordinate: [cur.lng, cur.lat],
        zoomLevel: 15,
        animationDuration: 600,
        animationMode: 'flyTo',
      });
      appendSimulatorLog('MAP_STATE', `${telemetryScreenPrefix}_camera_recenter_started`, {
        animationDurationMs: 600,
      }, { coordinateSource: simulatorEnabled ? 'simulator' : 'real' });
    };
    return () => {
      if (recenterImperativeRef) recenterImperativeRef.current = null;
    };
  }, [recenterImperativeRef, simulatorEnabled, userPos?.lat, userPos?.lng]);

  // When in instant mode (resume or the first accepted Simulator fix), skip
  // Mapbox's real-UserLocation follow. Apply the known position once for this
  // map mount; later samples move the puck/trace and explicit Recenter owns
  // camera travel. For an ordinary fresh entry, fall through to the original
  // native UserLocation fly-in.
  useEffect(() => {
    if (!instantCamera || !userPos || !cameraRef.current || initialCameraAppliedRef.current) return;
    initialCameraAppliedRef.current = true;
    cameraRef.current.setCamera({
      centerCoordinate: [userPos.lng, userPos.lat],
      zoomLevel: 15,
      animationDuration: 0,
      animationMode: 'none',
    });
    appendSimulatorLog('MAP_STATE', `${telemetryScreenPrefix}_camera_initial_target_applied`, {
      mountId: mapMountIdRef.current,
      animationDurationMs: 0,
      animationMode: 'none',
      providerSource: simulatorEnabled ? 'simulator' : 'real',
    }, { coordinateSource: simulatorEnabled ? 'simulator' : 'real' });
  }, [instantCamera, userPos?.lat, userPos?.lng, mapEpoch]);

  // During the welcome fly-in, gestures must be disabled so that an
  // accidental tap (e.g. user reaching for the Stop button before the
  // animation finishes) doesn't cancel the camera mid-flight. After
  // the fly-in completes (or immediately when instantCamera) we
  // re-enable gestures.
  const [gesturesEnabled, setGesturesEnabled] = useState(instantCamera);
  useEffect(() => {
    if (instantCamera) {
      setGesturesEnabled(true);
      return;
    }
    setGesturesEnabled(false);
    // 600ms fly-in duration + 100ms safety buffer
    const t = setTimeout(() => setGesturesEnabled(true), 700);
    return () => clearTimeout(t);
  }, [instantCamera, mapEpoch]);

  const markStyleLoaded = () => {
    setMapFirstRender(true);
    if (!activitySimulatorBuildCapable) return;
    useActivitySimulatorStore.getState().setMapDiagnostics({
      mountId: mapMountIdRef.current,
      screen: telemetryScreenPrefix, mounted: true, styleLoaded: true, loadState: 'style-loaded', lastEvent: 'style-loaded',
    });
    appendSimulatorLog('MAP_STATE', `${telemetryScreenPrefix}_map_style_loaded`, {
      mountId: mapMountIdRef.current,
      cameraRefAvailable: Boolean(cameraRef.current),
      mapboxTokenConfigured: isMapboxTokenConfigured(),
    }, { coordinateSource: 'none' });
  };
  const markMapReady = (eventName: string) => {
    if (!mapFirstRender) setMapFirstRender(true);
    if (!activitySimulatorBuildCapable) return;
    useActivitySimulatorStore.getState().setMapDiagnostics({
      mountId: mapMountIdRef.current,
      screen: telemetryScreenPrefix, mounted: true, styleLoaded: true, mapReady: true, loadState: 'ready', lastEvent: eventName,
    });
    appendSimulatorLog('MAP_STATE', `${telemetryScreenPrefix}_map_${eventName}`, {
      mountId: mapMountIdRef.current,
      cameraRefAvailable: Boolean(cameraRef.current),
      mapReadyDerived: true,
    }, { coordinateSource: 'none' });
  };
  const markMapIdle = () => {
    setMapFirstRender(true);
    if (!activitySimulatorBuildCapable) return;
    useActivitySimulatorStore.getState().setMapDiagnostics({
      mountId: mapMountIdRef.current,
      screen: telemetryScreenPrefix, mounted: true, styleLoaded: true, mapReady: true, loadState: 'ready', lastEvent: 'map-idle',
    });
    appendSimulatorLog('MAP_STATE', `${telemetryScreenPrefix}_map_idle`, {
      mountId: mapMountIdRef.current,
      cameraRefAvailable: Boolean(cameraRef.current),
      mapReadyDerived: true,
    }, { coordinateSource: 'none' });
    if (flyToStateRef.current) {
      if (flyToStateRef.current.timeout) clearTimeout(flyToStateRef.current.timeout);
      appendSimulatorLog('MAP_STATE', `${telemetryScreenPrefix}_camera_fly_to_completed`, {
        completionSignal: 'native-map-idle',
        elapsedMs: Date.now() - flyToStateRef.current.startedAt,
      }, { coordinateSource: 'none' });
      flyToStateRef.current = null;
    }
  };
  const markMapError = (event: unknown) => {
    if (!activitySimulatorBuildCapable) return;
    useActivitySimulatorStore.getState().setMapDiagnostics({
      mountId: mapMountIdRef.current,
      screen: telemetryScreenPrefix, mounted: true, lastEvent: 'loading-error',
    });
    appendSimulatorLog('MAP_STATE', `${telemetryScreenPrefix}_map_loading_error`, {
      mountId: mapMountIdRef.current,
      error: (() => { try { return JSON.stringify(event).slice(0, 500); } catch { return String(event).slice(0, 180); } })(),
      nonTerminal: true,
      mapboxTokenConfigured: isMapboxTokenConfigured(),
    });
  };

  // Fallback when Mapbox not available
  if (!MapView) {
    return (
      <View style={[mapStyles.mapBg, { backgroundColor: theme.background }]}>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <View style={{ alignItems: 'center', gap: Spacing.sm, width: '78%', paddingHorizontal: Spacing.xl, paddingVertical: Spacing.lg, borderRadius: Radius.cardLg, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.surface }}>
            <Icon name="Map" size={38} color={theme.iconInactive} />
            <Text style={{ fontSize: FontSize.h3, fontWeight: '700', color: theme.foreground }}>
              Map unavailable
            </Text>
            <Text style={{ fontSize: FontSize.caption, lineHeight: 18, color: theme.foregroundSecondary, textAlign: 'center' }}>
              GPS recording can continue while the map is unavailable
            </Text>
          </View>
        </View>
        {markers.map((m, i) => (
          <MarkerPin
            key={m.id}
            type={m.type}
            x={80 + (i % 5) * 55}
            y={200 + (i % 3) * 100}
            onPress={() => onMarkerPress(m.id)}
          />
        ))}
      </View>
    );
  }

  const resolvedMapStyle = getMapStyleForTheme(mapLayer, mapTheme);

  return (
    <View style={mapStyles.mapBg}>
      <MapView
        key={`hike-map-${mapEpoch}`}
        ref={mapViewRef}
        style={StyleSheet.absoluteFillObject}
        {...(resolvedMapStyle.kind === 'url'
          ? { styleURL: resolvedMapStyle.url }
          : { styleJSON: resolvedMapStyle.json })}
        logoEnabled
        attributionEnabled
        logoPosition={{ top: trackStartVariant ? 214 : 116, left: 8 }}
        attributionPosition={{ top: trackStartVariant ? 214 : 116, right: 8 }}
        // Mapbox's built-in compass is hidden — we draw our own as a
        // bottom-left chip so it sits in a predictable spot relative to
        // Place Flag (right). showCompass is also
        // gated on tracking state so a fresh map screen isn't cluttered.
        compassEnabled={false}
        // Disable gestures during the fly-in so a stray tap doesn't
        // freeze the camera mid-animation. Tapping anywhere on the
        // map during a Mapbox flyTo cancels the animation by default.
        scrollEnabled={gesturesEnabled}
        zoomEnabled={gesturesEnabled}
        rotateEnabled={gesturesEnabled}
        pitchEnabled={gesturesEnabled}
        scaleBarEnabled={false}
        // v118: detect user gesture → notify parent to release followUser.
        // Mapbox fires onCameraChanged for every camera move including
        // programmatic ones; we only react to gestures.
        onCameraChanged={(state: any) => {
          if (simulatorControlsEnabled && simulatorCenterPickerVisible && state?.gestures?.isGestureActive) {
            const center = state?.properties?.center
              ?? state?.properties?.centerCoordinate
              ?? state?.centerCoordinate;
            if (Array.isArray(center) && center.length >= 2) {
              useActivitySimulatorStore.getState().setMapSelection({
                lat: Number(center[1]),
                lng: Number(center[0]),
              });
            }
          }
          if (state?.gestures?.isGestureActive && followUser) {
            if (flyToStateRef.current) {
              if (flyToStateRef.current.timeout) clearTimeout(flyToStateRef.current.timeout);
              appendSimulatorLog('MAP_STATE', `${telemetryScreenPrefix}_camera_fly_to_interrupted`, {
                reason: 'user-gesture',
              }, { coordinateSource: 'none' });
              flyToStateRef.current = null;
            }
            onUserGesture?.();
          }
        }}
        onLongPress={(event: any) => {
          if (!simulatorControlsEnabled || !simulatorCenterPickerVisible) return;
          const coordinates = event?.geometry?.coordinates ?? event?.features?.[0]?.geometry?.coordinates;
          if (Array.isArray(coordinates) && coordinates.length >= 2) {
            const selected = {
              lat: Number(coordinates[1]),
              lng: Number(coordinates[0]),
            };
            useActivitySimulatorStore.getState().setMapSelection(selected);
            appendSimulatorLog('SIM_INPUT', 'map_point_selected', selected, { coordinateSource: 'simulator' });
          }
        }}
        // R114/O24 (2026-08-12): primary trigger — fires when style +
        // first tile batch loaded (basemap visible). More reliable than
        // onDidFinishRenderingMapFully across Mapbox SDK versions.
        onDidFinishLoadingStyle={markStyleLoaded}
        onWillStartLoadingMap={() => {
          appendSimulatorLog('MAP_STATE', `${telemetryScreenPrefix}_map_style_load_started`, { mountId: mapMountIdRef.current }, { coordinateSource: 'none' });
        }}
        onDidFinishLoadingMap={() => markMapReady('loaded')}
        // R114/O22 Bug 4: backup event — fires once when Mapbox has
        // rendered all tiles in the current viewport at their native LOD.
        // Kept as defensive fallback (some SDK builds only fire this one).
        onDidFinishRenderingMapFully={() => markMapReady('rendered_fully')}
        onMapIdle={markMapIdle}
        onMapLoadingError={markMapError}
      >
        {/* R21-v3 v2 (2026-08-30): Standard style lightPreset — day/dusk/night
            follows useMapTheme. Satellite layer skips the import (Standard
            is not the loaded style). key={preset} forces remount so the
            preset re-applies cleanly when sunset/night hits mid-session. */}
        {mapLayer !== 'satellite' && StyleImport ? (
          <StyleImport
            key={hikeLightPreset}
            id="basemap"
            existing
            config={buildStandardConfig(mapTheme) as any}
          />
        ) : null}
        <CameraComponent
          ref={cameraRef}
          // v118: followUser respects the new toggle state. While true,
          // Mapbox auto-recenters on every GPS fix (original behaviour).
          // While false, the user can pan/zoom freely until they tap the
          // recenter button.
          followUserLocation={!simulatorEnabled && !instantCamera && followUser}
          followZoomLevel={15}
          followPitch={0}
          animationDuration={instantCamera ? 0 : 600}
          animationMode={instantCamera ? 'none' : 'flyTo'}
          defaultSettings={(instantCamera || simulatorEnabled) && userPos
            ? { centerCoordinate: [userPos.lng, userPos.lat], zoomLevel: 15 }
            : undefined}
        />
        {simulatorEnabled && userPos ? (
          <ShapeSource
            id="activity-simulator-puck"
            shape={{ type: 'Feature', geometry: { type: 'Point', coordinates: [userPos.lng, userPos.lat] }, properties: {} } as any}
          >
            <CircleLayer
              id="activity-simulator-puck-halo"
              style={{ circleRadius: 14, circleColor: '#1E88E5', circleOpacity: 0.25 }}
            />
            <CircleLayer
              id="activity-simulator-puck-dot"
              style={{ circleRadius: 7, circleColor: '#1E88E5', circleStrokeWidth: 2, circleStrokeColor: '#ffffff' }}
            />
          </ShapeSource>
        ) : (
          <UserLocationComponent
            visible={true}
            renderMode="normal"
            onUpdate={activitySimulatorBuildCapable ? handleRealUserLocationUpdate : undefined}
          />
        )}

        {/* Track polyline — solid segments (good signal) */}
        {solidGeoJSON.features.length > 0 && (
          <ShapeSource id="track-line" shape={solidGeoJSON}>
            <LineLayer
              id="track-line-casing"
              style={{
                lineColor: theme.surfaceElevated,
                lineOpacity: 0.86,
                lineWidth: 8,
                lineCap: 'round',
                lineJoin: 'round',
              }}
            />
            <LineLayer
              id="track-line-layer"
              style={{
                // Activity identity is semantic and stable across Mapbox
                // styles: Hike follows the active CairnNZ forest theme;
                // Run uses the existing movement-blue token. A restrained
                // material casing keeps both traces legible over trails,
                // minor roads, satellite imagery, sunset and night maps.
                lineColor: activityVariant === 'run' ? Colors.running : theme.primary,
                lineWidth: 4.5,
                lineCap: 'round',
                lineJoin: 'round',
              }}
            />
          </ShapeSource>
        )}

        {/* v78 #1: Track polyline — dashed gap segments (signal lost > 30s).
            Muted color + dashed pattern signals "we couldn't track here"
            without breaking the visual continuity of the path. */}
        {gapGeoJSON.features.length > 0 && (
          <ShapeSource id="track-gap-line" shape={gapGeoJSON}>
            <LineLayer
              id="track-gap-line-layer"
              style={{
                lineColor: Colors.textMuted,
                lineWidth: 3,
                lineDasharray: [2, 1.5],
                lineCap: 'round',
                lineJoin: 'round',
              }}
            />
          </ShapeSource>
        )}

        {/* Approach line — dashed link from the user's current position
            to the start of a selected route. Only drawn when both
            endpoints exist and the user isn't already standing on the
            start (within ~50m). Helps the user see how to get to the
            trailhead from where they are. */}
        {routeStart && userPos && (() => {
          const distM = haversineM(userPos, routeStart);
          if (distM < 50) return null;
          return (
            <ShapeSource
              id="approach-line"
              shape={{
                type: 'Feature',
                geometry: {
                  type: 'LineString',
                  coordinates: [
                    [userPos.lng, userPos.lat],
                    [routeStart.lng, routeStart.lat],
                  ],
                },
                properties: {},
              }}
            >
              <LineLayer
                id="approach-line-layer"
                style={{
                  lineColor: Colors.severityCaution,
                  lineWidth: 5,
                  lineOpacity: 0.85,
                  lineDasharray: [2, 2],
                  lineCap: 'round',
                }}
              />
            </ShapeSource>
          );
        })()}
        {/* Route start pin */}
        {routeStart && (
          <PointAnnotation
            id="route-start"
            coordinate={[routeStart.lng, routeStart.lat]}
          >
            <View style={mapStyles.routeStartPin}>
              <Icon name="Flag" size={12} color="#fff" strokeWidth={2.5} />
            </View>
          </PointAnnotation>
        )}

        {/* 2026-08-17 concept H1/R1: track start dot. Rendered at
            trackPoints[0] once we have at least one recorded GPS point.
            Hike variant = blue dot (matches concept H1 blue puck at
            trailhead), Run variant = green dot (matches concept R1
            green marker at trailhead). Kept as PointAnnotation so
            Mapbox scales it correctly across zoom levels. */}
        {trackStartVariant && trackPoints.length > 0 && (
          <PointAnnotation
            id="track-start-dot"
            coordinate={[trackPoints[0].lng, trackPoints[0].lat]}
          >
            <Image
              source={trackStartVariant === 'run'
                ? require('../../assets/map/marker-start.png')
                : require('../../assets/map/marker-current.png')}
              style={mapStyles.trackStartDot}
              resizeMode="contain"
            />
          </PointAnnotation>
        )}

        {/* Markers */}
        {markers.map((m) => (
          <PointAnnotation
            key={m.id}
            id={m.id}
            coordinate={[m.lng, m.lat]}
            onSelected={() => onMarkerPress(m.id)}
          >
            <View style={[mapStyles.markerPin, {
              borderColor: MARKER_META[m.type]?.color ?? Colors.textSecondary,
              backgroundColor: MARKER_META[m.type]?.bg ?? Colors.surface,
            }]}>
              <Icon
                name={(FLAG_TYPES.find(f => f.id === m.type)?.icon || 'Flag') as IconName}
                size={11}
                color={MARKER_META[m.type]?.color ?? Colors.textSecondary}
                strokeWidth={2.5}
              />
            </View>
          </PointAnnotation>
        ))}
      </MapView>
      {/* R114/O22 Bug 4: first-load overlay. Sits over the still-loading
          map until Mapbox reports mapFirstRender. On slow networks (China
          CDN, first hike after fresh install) tile download can take 5–20s;
          without this overlay the user sees a blank white/cream canvas
          and thinks the app is broken. When offline, the offline banner
          below takes priority so we don't double-message. */}
      {!mapFirstRender && !isOffline && (
        <View style={mapStyles.mapLoadingOverlay} pointerEvents="none">
          <View style={mapStyles.mapLoadingCard}>
            <ActivityIndicator size="small" color={Colors.primary} />
            <Text style={mapStyles.mapLoadingText}>Loading map…</Text>
          </View>
        </View>
      )}
      {/* R114/O22 STORY-73011 (K1): offline banner. Shown when NetInfo
          reports no internet — Mapbox tiles won't fetch so the map is
          effectively blank. GPS recording is unaffected; this banner
          tells the user "the map is offline but we're still tracking". */}
      {isOffline && (
        <View style={mapStyles.offlineOverlay} pointerEvents="box-none">
          <View style={mapStyles.offlineCard}>
            <Text style={mapStyles.offlineTitle}>No connection</Text>
            <Text style={mapStyles.offlineBody}>
              The map can't load without internet. Your activity is still being tracked — the map will fill in when you're back online.
            </Text>
          </View>
        </View>
      )}
      {/* Touch shield during the welcome fly-in. Absolutely positioned
          over the map and intercepts all touches so Mapbox's native
          gesture handler can't cancel the running camera animation
          when the user taps anywhere on the map area. Removed the
          moment fly-in completes (gesturesEnabled flips to true).
          The Stop / Compass / Flag buttons sit in their own absolute
          overlays ABOVE this shield in the JSX tree, so they remain
          tappable. */}
      {!gesturesEnabled && (
        <View
          style={StyleSheet.absoluteFillObject}
          // pointerEvents: 'auto' (the React Native default) — every
          // touch on this view is consumed and never reaches MapView.
        />
      )}
      {/* Simulator target only during origin/destination/reacquisition selection. */}
      {simulatorControlsEnabled && simulatorCenterPickerVisible && (
        <View pointerEvents="none" style={mapStyles.debugCenterCircle} />
      )}
    </View>
  );
}

const mapStyles = StyleSheet.create({
  // R114/O22 Bug 4: loading overlay (first tile render).
  mapLoadingOverlay: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    // Not fully opaque — the cream mapBg shows through faintly so the
    // transition to real tiles feels like a fade-in rather than a blink.
    backgroundColor: 'rgba(220, 216, 209, 0.85)',
  },
  mapLoadingCard: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: 'rgba(255,255,255,0.95)',
    paddingHorizontal: 18, paddingVertical: 12,
    borderRadius: 999,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 10,
    elevation: 4,
  },
  mapLoadingText: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.textPrimary,
  },
  // R114/O22 STORY-73011: offline banner overlay. Sits mid-screen so it's
  // impossible to miss without covering the entire viewport.
  offlineOverlay: {
    position: 'absolute',
    left: 20,
    right: 20,
    top: 80,
    alignItems: 'center',
  },
  offlineCard: {
    backgroundColor: 'rgba(255,255,255,0.97)',
    borderRadius: 16,
    paddingVertical: 14,
    paddingHorizontal: 16,
    gap: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 6,
    maxWidth: 320,
  },
  offlineTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#111',
  },
  offlineBody: {
    fontSize: 13,
    color: '#555',
    lineHeight: 18,
  },
  mapBg: {
    flex: 1,
    // R114 (2026-08-07): map placeholder colour changed from Colors.primaryBg
    // (very pale green rgba 0.08 → reads as near-white on light theme) to a
    // muted map-tone gray. User reported that on poor network the Earth
    // area shows as "black or white" while Mapbox tiles fail to load. A
    // neutral map-gray communicates "map is loading" and blends when
    // tiles arrive.
    backgroundColor: '#dcd8d1',
    overflow: 'hidden',
  },
  // v447: 60x60 dashed circle centered on the map viewport. Marks the
  // point that ⟲ will teleport injector.currentPos to. Semi-transparent
  // so it doesn't hide underlying map features. pointerEvents:'none' so
  // it never blocks map pan/zoom gestures.
  debugCenterCircle: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    width: 60,
    height: 60,
    marginTop: -30,
    marginLeft: -30,
    borderRadius: 30,
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: 'rgba(30,136,229,0.85)',
  },
  markerPin: {
    position: 'absolute', width: 24, height: 24, borderRadius: 12,
    borderWidth: 2, alignItems: 'center', justifyContent: 'center',
    backgroundColor: Colors.surface, ...Shadow.card,
  },
  // Route start pin — distinct from regular markers so users can spot
  // the trailhead at a glance.
  routeStartPin: {
    width: 26, height: 26, borderRadius: 13,
    backgroundColor: Colors.severityCaution,
    borderWidth: 2, borderColor: '#fff',
    alignItems: 'center', justifyContent: 'center',
    ...Shadow.card,
  },
  // 2026-08-17 concept H1/R1 track-start dot. Sized to match the
  // concept (dot ~14pt with subtle halo ring, source PNG is 108x108
  // for 3x retina crispness).
  trackStartDot: {
    width: 26, height: 26,
  },
});
