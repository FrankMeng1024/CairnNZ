/**
 * RunningScreen — sleep-run 2026-08-16 rev-2 (Hiking-parity)
 *
 * States:
 * 1. Pre-start (R0): route selection card + full-width Start Running pill
 * 2. Running (R1 + R2): map + polyline + top stats bar; persistent 3-button
 *    action tray (Pause / Cairn / Done). No lock overlay, no compass ring.
 * 3. Save-name sheet: opens on Done tap. Collects an optional session name
 *    and drives the transition to R4 via handleStop(name) → stopTracking.
 * 4. Complete (R4): hero image + stat trio + View Activity / Done CTAs.
 *
 * Uses useTrackingStore (real GPS via expo-location, graceful web fallback).
 * activityMode set to 'running' before startTracking.
 */
import React, { useState, useRef, useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Animated, Easing, ScrollView,
  Platform, Image, TextInput, KeyboardAvoidingView, Keyboard, Share,
} from 'react-native';
import Svg, { Polyline as SvgPolyline } from 'react-native-svg';
import { haptic } from '../services/hapticService';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useKeepAwake } from 'expo-keep-awake';
import { useNavigation, useFocusEffect, useIsFocused, CommonActions } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/RootNavigator';
import { useTrackingStore } from '../store/useTrackingStore';
import { useRouteStore } from '../store/useRouteStore';
import { useMarkerStore } from '../store/useMarkerStore';
import { getCurrentRegion } from '../config/regions';
import { getPrimaryMapStyle, getMapStyleForLayer } from '../config/mapbox';
import { formatDuration } from '../utils/geo';
import { useDistance } from '../utils/distanceFormat';
import { Colors, Spacing, Radius, FontSize, Shadow } from '../components/tokens';
import { Icon } from '../components/Icon';
import { BackButton } from '../components/BackButton';
import { useAppearance } from '../hooks/useAppearance';
import { PulseDot } from '../components/PulseDot';
import { TooShortSheet } from '../components/TooShortSheet';
import { PermissionDeniedModal } from '../components/PermissionDeniedModal';
import { crashLogger } from '../services/crashLogger';

type Nav = NativeStackNavigationProp<RootStackParamList>;

type RunState = 'pre' | 'running' | 'stopped';

// ── Concept tokens (sleep-run 2026-08-15) ────────────────────────────────
// Concept was locked to forest green for BOTH R0 button and R1 polyline
// even though `Colors.running` is defined as blue elsewhere. These local
// tokens keep RunningScreen visually aligned with docs/ui-redesign/
// Running.spec.json without changing the shared design token file.
//
// Fix 5 (COLOR-DRIFT): unified to the CONCEPT_TRUTH primary #3E5F3A. The
// previous forest #455D3C and R1 polyline #5F8B3A drifted apart across
// files; now every RunningScreen surface (Start pill, SaveSheet CTA, R2
// button accents where used, R1 polyline, R4 CTA, mini-map polyline)
// resolves to the same hex.
const RunConcept = {
  paper: '#F9F6F3',
  forest: '#3E5F3A',
  forestDark: '#2F3F28',
  textPrimary: '#1E2A24',
  textSecondary: '#5F6B62',
  textMuted: '#8A8579',
  cardSurface: 'rgba(249,246,243,0.94)',
  hairline: 'rgba(20,42,30,0.10)',
} as const;

// ── Mapbox conditional import ────────────────────────────────────────────
// Lazily loaded once per app session — same pattern as HikingScreen.
// On web Mapbox modules are absent; falls back to a static placeholder.
let MapView: any = null;
let CameraComponent: any = null;
// Sleep-run 2026-08-16 patch: re-import ShapeSource + LineLayer so the R1
// tracking screen can render the live polyline again (concept R1-tracking.png).
// O1 batch 34 removed these when R1 was reduced to a compass-only card.
let ShapeSource: any = null;
let LineLayer: any = null;
let UserLocationComponent: any = null;
// 2026-08-17 concept R1: green start-dot marker at trackPoints[0].
// PointAnnotation is the same Mapbox primitive HikingMap uses; imported
// here so we can render the extracted concept asset without pulling in
// the whole HikingMap component.
let PointAnnotationComponent: any = null;
if (Platform.OS !== 'web') {
  try {
    const Mapbox = require('@rnmapbox/maps');
    MapView = Mapbox.MapView;
    CameraComponent = Mapbox.Camera;
    ShapeSource = Mapbox.ShapeSource;
    LineLayer = Mapbox.LineLayer;
    UserLocationComponent = Mapbox.UserLocation;
    PointAnnotationComponent = Mapbox.PointAnnotation;
  } catch {
    // @rnmapbox/maps not installed in this build (Expo Go) — fallback used.
  }
}

// ── Keep-awake guard ────────────────────────────────────────────────────────
function useRunKeepAwake() {
  // Keep screen awake whenever RunningScreen is mounted
  useKeepAwake();
}

// Sleep-run 2026-08-16 rev-2: local PulsingDot component removed with
// the lock overlay it belonged to. The shared PulseDot component in the
// stats bar continues to signal GPS status.

// ── Stat item ────────────────────────────────────────────────────────────────
// 2026-08-17 concept R0/R1: stats bar reads as one horizontal row with
// the unit hugging the value ("4.12 km", "01:20:15", "5'52"/km"). The
// previous vertical stack (value on top, "elapsed" beneath) was replaced
// so the row matches the concept sheet exactly. Label is rendered inline,
// slightly smaller and muted, with a hair of horizontal padding so it
// doesn't crowd the digits.
function StatItem({ value, label }: { value: string; label: string }) {
  return (
    <View style={runStyles.statItem}>
      <Text style={runStyles.statValue} numberOfLines={1}>
        {value}
        {label ? <Text style={runStyles.statUnit}> {label}</Text> : null}
      </Text>
    </View>
  );
}

/**
 * Sleep-run 2026-08-16: R4 mini-map polyline preview.
 *
 * Same fallback approach as StopSummarySheet.MiniMapPolyline — projects
 * trackPoints into an SVG viewBox with padding, aggressive downsampling for
 * long tracks, aspect-preserving scale so the shape reads correctly.
 *
 * Static (no Mapbox), because R4 renders while the tracking map may still
 * hold a GL context; standing up a second Mapbox surface here would compete
 * for GPU on lower-end devices with no benefit — the goal is a preview,
 * not a live map.
 */
function RunMiniMapPolyline({ points, stroke, width, height }: {
  points: Array<{ lat: number; lng: number }>;
  stroke: string;
  width: number;
  height: number;
}) {
  if (!points || points.length < 2) return null;

  const step = Math.max(1, Math.floor(points.length / 200));
  const sampled: Array<{ lat: number; lng: number }> = [];
  for (let i = 0; i < points.length; i += step) sampled.push(points[i]);
  if (sampled[sampled.length - 1] !== points[points.length - 1]) {
    sampled.push(points[points.length - 1]);
  }

  let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
  for (const p of sampled) {
    if (p.lat < minLat) minLat = p.lat;
    if (p.lat > maxLat) maxLat = p.lat;
    if (p.lng < minLng) minLng = p.lng;
    if (p.lng > maxLng) maxLng = p.lng;
  }
  const latSpan = Math.max(1e-6, maxLat - minLat);
  const lngSpan = Math.max(1e-6, maxLng - minLng);
  const pad = 10;
  const w = width - pad * 2;
  const h = height - pad * 2;
  const scale = Math.min(w / lngSpan, h / latSpan);
  const offsetX = pad + (w - lngSpan * scale) / 2;
  const offsetY = pad + (h - latSpan * scale) / 2;

  const coords = sampled
    .map(p => {
      const x = offsetX + (p.lng - minLng) * scale;
      const y = offsetY + (maxLat - p.lat) * scale;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  return (
    <Svg width={width} height={height}>
      <SvgPolyline
        points={coords}
        fill="none"
        stroke={stroke}
        strokeWidth={2.5}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </Svg>
  );
}

// ── Main ────────────────────────────────────────────────────────────────────
export function RunningScreen() {
  const nav = useNavigation<Nav>();
  const isFocused = useIsFocused();
  const routes = useRouteStore(s => s.routes);
  const loadRoutes = useRouteStore(s => s.loadRoutes);
  const [runState, setRunState] = useState<RunState>('pre');
  // R21 (2026-08-18): dark theme parity with Hiking. Run tray + top pills
  // + Recenter FAB honour Settings Appearance so day/night reads the same.
  const { isDark: runIsDark } = useAppearance();
  // R21 (2026-08-18 user "点击 向右侧展开"): tracking action tray is
  // collapsed by default. Tap the Navigation anchor (bottom-left) to
  // expand → Pause / Cairn / Finish slides out to the right.
  const [runActionsExpanded, setRunActionsExpanded] = useState(false);
  // R21 (2026-08-18): follow-camera state so Recenter FAB is only shown
  // when the user has dragged the map off-position.
  const [runFollowUser, setRunFollowUser] = useState(true);
  // O18 RUN-07: capture sessionId at Stop so 'View activity detail' can
  // navigate to MapHistory even after stopTracking clears the store's id.
  const [stoppedSessionId, setStoppedSessionId] = useState<string | number | null>(null);
  // Sleep-run 2026-08-16: R4 mini-map card width — measured onLayout so the
  // SVG polyline preview scales responsively across iPhone widths.
  const [r4MiniMapWidth, setR4MiniMapWidth] = useState(0);
  // O18 ONB-04: shared permission-denied modal state.
  const [permissionDeniedVisible, setPermissionDeniedVisible] = useState(false);
  const [selectedRoute, setSelectedRoute] = useState<string | null>(null);
  const [showRoutePicker, setShowRoutePicker] = useState(false);
  // foregroundGranted gates UserLocation rendering on the pre-start map.
  // Without this, Mapbox UserLocation silently fails (no blue dot) and the
  // map shows the default region instead of the user's location.
  const [foregroundGranted, setForegroundGranted] = useState(false);
  // R114/O22 STORY-73018 (R1) UX-review fix: separate "denied and cannot
  // ask again" state so the pre-start UI can show a persistent inline
  // hint pointing to Settings. Without this, users who previously denied
  // saw NOTHING when re-entering Running — no map dot, no explanation,
  // no path forward. Mirrors HikingScreen's H3 hasLocationPermission=false
  // banner but lightweight (chip, not full card) because the pre-start
  // map is already useful without GPS.
  const [permissionBlocked, setPermissionBlocked] = useState(false);
  const routePickerSlide = useRef(new Animated.Value(300)).current;
  const routePickerOpacity = useRef(new Animated.Value(0)).current;
  // Sleep-run 2026-08-16 rev-2: lock concept dropped. R1 is now just a
  // clean map + polyline + top stats bar; R2 is a persistent 3-button
  // tray (Pause / Cairn / Done) that no longer requires a double-tap
  // unlock. Any legacy isLocked / tapCount / tapTimer state has been
  // removed with the compass ring and dark lock overlay.
  //
  // Save-name sheet: shown when the user taps Done. Collects an optional
  // session name, then triggers handleStop(name) which calls stopTracking
  // and transitions to R4.
  const [showSaveSheet, setShowSaveSheet] = useState(false);
  const [pendingName, setPendingName] = useState('');
  const saveSheetSlide = useRef(new Animated.Value(300)).current;
  const saveSheetOpacity = useRef(new Animated.Value(0)).current;

  // Real tracking store
  const status = useTrackingStore(s => s.status);
  const durationS = useTrackingStore(s => s.durationS);
  const distanceM = useTrackingStore(s => s.distanceM);
  const locationAvailable = useTrackingStore(s => s.locationAvailable);
  const lastCoordinate = useTrackingStore(s => s.lastCoordinate);
  const sessionId = useTrackingStore(s => s.sessionId);
  const linkMarker = useTrackingStore(s => s.linkMarker);
  const setActivityMode = useTrackingStore(s => s.setActivityMode);
  // O12: settings-aware distance/pace formatting.
  const dist = useDistance();
  const startTracking = useTrackingStore(s => s.startTracking);
  const stopTracking = useTrackingStore(s => s.stopTracking);
  // O18 RUN-01: pause / resume actions from the shared tracking store
  // (previously only Hiking wired these — parity gap).
  const pauseTracking = useTrackingStore(s => s.pauseTracking);
  const resumeTracking = useTrackingStore(s => s.resumeTracking);
  // O18 RUN-02: signal-lost detection (parity with Hiking §566).
  const trackPoints = useTrackingStore(s => s.trackPoints);
  // v116/v118: too-short modal hooks. v118 changed Alert → TooShortSheet
  // and the session is now preserved on too-short stops.
  const lastStopReason = useTrackingStore(s => s.lastStopReason);
  const clearLastStopReason = useTrackingStore(s => s.clearLastStopReason);
  const discardCurrentSession = useTrackingStore(s => s.discardCurrentSession);
  const addMarker = useMarkerStore(s => s.addMarker);
  // Toast for the "cairn planted" feedback shown after the user uses
  // the unlock-protected plant button. Only relevant in the unlocked
  // running state — in pre-/post-run states this stays null.
  const [plantToast, setPlantToast] = useState<string | null>(null);

  // Keep screen awake when running
  useRunKeepAwake();

  useEffect(() => { loadRoutes(); }, []);

  // Request foreground location permission on mount so the pre-start map's
  // UserLocation dot can render. If denied, dot is hidden but map still shows.
  //
  // R114/O22 STORY-73018 (R1): do NOT re-request if the user previously
  // denied. iOS's requestForegroundPermissionsAsync silently returns denied
  // when canAskAgain=false, but on some paths the shared permission-denied
  // modal was re-shown every time the user re-entered Running, which the
  // user reports as annoying ("拒绝后每次进都弹"). Now we only show the
  // modal on the FIRST denial (perm.canAskAgain === true implies we can
  // still ask). If canAskAgain=false, we skip both the ask AND the modal —
  // the user has already made their choice and can enable via Settings.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const Location = await import('expo-location');
        const perm = await Location.getForegroundPermissionsAsync();
        if (cancelled) return;
        let granted = perm.status === 'granted';
        let didAskThisMount = false;
        if (!granted && perm.canAskAgain) {
          didAskThisMount = true;
          const ask = await Location.requestForegroundPermissionsAsync();
          if (!cancelled && ask.status === 'granted') granted = true;
        }
        // O18 ONB-04 + R114/O22 STORY-73018: only surface the shared
        // permission-denied modal when the denial happened in THIS mount
        // (didAskThisMount=true) — i.e. the user just tapped deny in the
        // OS dialog. If they had denied on a prior visit (canAskAgain=false
        // now), do not re-open the modal; that behavior was the "re-prompt"
        // annoyance the user reported.
        if (!granted && didAskThisMount && !cancelled) {
          setPermissionDeniedVisible(true);
        }
        // R114/O22 STORY-73018 UX fix: track "denied, cannot ask again"
        // so the pre-start UI can show a small persistent chip pointing
        // to Settings. Without this the user would see no reason why
        // their GPS dot isn't rendering.
        if (!granted && !perm.canAskAgain && !cancelled) {
          setPermissionBlocked(true);
        }
        if (granted) {
          if (!cancelled) setForegroundGranted(true);
          // v119: pre-fetch a one-shot GPS fix so the pre-start map opens
          // centered on the user instead of falling back to the NZ-wide
          // Auckland anchor. Mirrors the HikingScreen seed pattern at
          // line ~1178. Skipped if a tracking session is already running
          // (its watchPositionAsync stream owns lastCoordinate).
          const cur = useTrackingStore.getState();
          if (cur.status !== 'tracking' && !cur.lastCoordinate) {
            try {
              const fix = await Location.getCurrentPositionAsync({
                accuracy: Location.Accuracy.Balanced,
              });
              if (cancelled) return;
              useTrackingStore.setState({
                lastCoordinate: {
                  lat: fix.coords.latitude,
                  lng: fix.coords.longitude,
                  alt: fix.coords.altitude ?? null,
                },
                lastCoordinateTime: Date.now(),
              });
            } catch { /* getCurrentPositionAsync timed out; map will show fallback */ }
          }
        }
      } catch { /* permission unavailable — dot stays hidden */ }
    })();
    return () => { cancelled = true; };
  }, []);

  const openRoutePicker = () => {
    setShowRoutePicker(true);
    Animated.parallel([
      Animated.timing(routePickerSlide, { toValue: 0, duration: 280, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.timing(routePickerOpacity, { toValue: 1, duration: 220, easing: Easing.out(Easing.ease), useNativeDriver: true }),
    ]).start();
  };
  const closeRoutePicker = () => {
    Animated.parallel([
      Animated.timing(routePickerSlide, { toValue: 300, duration: 220, easing: Easing.in(Easing.quad), useNativeDriver: true }),
      Animated.timing(routePickerOpacity, { toValue: 0, duration: 200, easing: Easing.in(Easing.ease), useNativeDriver: true }),
    ]).start(() => setShowRoutePicker(false));
  };
  const pickRoute = (id: string | null) => {
    setSelectedRoute(id);
    closeRoutePicker();
  };

  const selectedRouteName = routes.find(r => r.id === selectedRoute)?.name ?? 'Free Run';

  // Animated values
  const startBtnScale = useRef(new Animated.Value(1)).current;
  // Sleep-run 2026-08-16 rev-2: controlsFade removed. The R2 action tray
  // is now always visible during 'running' state (no lock overlay).
  // v122: full mirror of HikingScreen's instantCamera pattern. cameraRef
  // is the imperative handle used by the useEffect below to setCamera
  // synchronously on every userPos change when in instant mode (skip the
  // flyTo animation; we already know where the user is).
  const cameraRef = useRef<any>(null);
  // v123 fix #2: use followUserLocation+flyTo every entry, ignoring
  // whether lastCoordinate is already known. User wants the same fly-in
  // experience on every Running open (so their entry is consistent),
  // not the Hiking pattern of "fly-in once, then instant on subsequent
  // resumes". instantCamera is intentionally always false here.
  const instantCamera = false;

  // v123 diag: log mount + key state so we can see in telemetry exactly
  // what RunningScreen sees on first vs second open. The user's complaint
  // ("第一次没动画 第二次没动画也不一致") is impossible to debug from a
  // screenshot alone — the timing of lastCoordinate vs Camera mount is
  // the variable.
  useEffect(() => {
    crashLogger.breadcrumb(
      `runscreen:mount runState=${runState} lastCoord=${lastCoordinate ? `(${lastCoordinate.lat.toFixed(5)},${lastCoordinate.lng.toFixed(5)})` : 'null'} instant=${instantCamera} fg=${foregroundGranted}`
    );
  }, []);
  useEffect(() => {
    crashLogger.breadcrumb(
      `runscreen:lastCoord-change has=${lastCoordinate != null} instant=${instantCamera}`
    );
  }, [lastCoordinate?.lat, lastCoordinate?.lng]);

  // v123: with instantCamera=false the imperative setCamera useEffect
  // is no longer needed — followUserLocation handles positioning via
  // its built-in flyTo each entry.

  // v127: simplified back to the Hiking pattern. gesturesEnabled is
  // disabled for the first 700ms after mount only. Mapbox handles the
  // fly-in via followUserLocation + animationMode='flyTo'. This is the
  // exact same lifecycle Hiking uses; the v126 useFocusEffect + mapEpoch
  // remount tricks made 2nd-entry behaviour different from Hiking
  // instead of identical. Subsequent entries reuse the MapView and
  // skip the fly-in — same as Hiking, which is what the user wanted.
  const [gesturesEnabled, setGesturesEnabled] = useState(false);
  // v128b: full MapView remount per focus. RunningScreen actually stays
  // alive between exits (RootNavigator stack keeps it cached), so the
  // Mapbox MapView reuses its previous camera state and the second
  // entry starts mid-zoom instead of from the globe. Bumping mapEpoch
  // on every focus forces a fresh `key` → MapView unmounts + remounts
  // → Mapbox replays the fly-in.
  const [mapEpoch, setMapEpoch] = useState(0);
  useFocusEffect(
    React.useCallback(() => {
      setMapEpoch(e => e + 1);
      setGesturesEnabled(false);
      const t = setTimeout(() => setGesturesEnabled(true), 700);
      return () => clearTimeout(t);
    }, []),
  );

  // Sleep-run 2026-08-16 rev-2: controlsFade effect removed with the
  // lock/unlocked concept — the action tray is always visible now.

  // v118: friendly notice when a too-short run gets stopped. The session
  // is preserved by stopTracking's pre-check; "Got it" simply dismisses
  // the modal and tracking continues. The TooShortSheet element is
  // rendered at the bottom of this component.

  const onStartPressIn = () =>
    Animated.spring(startBtnScale, { toValue: 0.96, useNativeDriver: true, tension: 300, friction: 10 }).start();
  const onStartPressOut = () =>
    Animated.spring(startBtnScale, { toValue: 1, useNativeDriver: true, tension: 300, friction: 8 }).start();

  // Sleep-run 2026-08-16 rev-2: double-tap unlock gesture removed.
  // The R1 tracking screen no longer has a lock overlay to unlock; the
  // R2 action tray (Pause / Cairn / Done) is always visible.

  // Save-name sheet lifecycle. Opens on Done tap, closes on Save or Cancel.
  const openSaveSheet = () => {
    setShowSaveSheet(true);
    Animated.parallel([
      Animated.timing(saveSheetSlide, { toValue: 0, duration: 260, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.timing(saveSheetOpacity, { toValue: 1, duration: 200, easing: Easing.out(Easing.ease), useNativeDriver: true }),
    ]).start();
  };
  const closeSaveSheet = (then?: () => void) => {
    Keyboard.dismiss();
    Animated.parallel([
      Animated.timing(saveSheetSlide, { toValue: 300, duration: 220, easing: Easing.in(Easing.quad), useNativeDriver: true }),
      Animated.timing(saveSheetOpacity, { toValue: 0, duration: 180, easing: Easing.in(Easing.ease), useNativeDriver: true }),
    ]).start(() => {
      setShowSaveSheet(false);
      then?.();
    });
  };

  async function handleStart() {
    haptic.impact('medium');
    setActivityMode('running');
    await startTracking();
    setRunState('running');
  }

  // handleStop is now invoked from the save-name sheet's Save button.
  // The optional `name` is passed through to stopTracking so the session
  // is persisted with the user-chosen title (or the default if empty).
  //
  // Fix 1 (SAVESHEET-TOO-SHORT-BROKEN): if stopTracking triggers the
  // too-short pre-check, lastStopReason becomes 'too-short' and the
  // TooShortSheet is shown. In that case we intentionally KEEP
  // pendingName in local state so the eventual "End anyway" path can
  // re-invoke handleStop with the same user-chosen title — the name is
  // no longer lost between SaveSheet close and TooShortSheet resolution.
  async function handleStop(name?: string) {
    haptic.impact('medium');
    // v118: stopTracking has a too-short pre-check that preserves the
    // session and sets lastStopReason='too-short'. We only transition to
    // 'stopped' if a real stop happened (status moved off tracking).
    // O18 RUN-07: capture sessionId before stopTracking clears it so
    // 'View Activity' can navigate to MapHistory.
    const capturedId = useTrackingStore.getState().sessionId;
    const trimmed = name && name.trim().length > 0 ? name.trim() : undefined;
    await stopTracking(trimmed);
    const stillTracking = useTrackingStore.getState().status !== 'idle';
    const stopReason = useTrackingStore.getState().lastStopReason;
    if (!stillTracking) {
      setStoppedSessionId(capturedId ?? null);
      setRunState('stopped');
      // Successful stop → clear pendingName so a subsequent run starts clean.
      setPendingName('');
    } else if (stopReason !== 'too-short') {
      // Stop refused for a reason other than too-short (rare — e.g. already
      // idle). Also clear pendingName so the sheet doesn't retain stale data.
      setPendingName('');
    }
    // else: too-short — keep pendingName; TooShortSheet.onDiscard will
    // discard the session and transition to R4 without needing the name.
  }

  // Plant a cairn at the user's current GPS position.
  //
  // Fix 6 (R2-CAIRN-QUICK-PLANT-TYPE): quick-plant now drops a 'personal'
  // cairn (gray 4-tier marker per CONCEPT_TRUTH §Cairn Markers) instead of
  // a 'danger' hazard flag. Running quick-plant is the "worth stopping for"
  // gesture — a private marker on the user's own map — not a public
  // hazard broadcast. A hazard mid-run should be an explicit choice via
  // PlantScreen, not the default.
  async function handlePlantCairn() {
    if (!lastCoordinate) {
      // Should be rare — locked mode keeps GPS active. Don't throw,
      // just bail out silently with a haptic to acknowledge press.
      haptic.notification('warning');
      return;
    }
    haptic.impact('heavy');
    const region = getCurrentRegion();
    try {
      const marker = await addMarker({
        // Fix 6: quick-plant defaults to a personal cairn (type=cairn +
        // permission=personal) — the 灰色石堆图标 in CONCEPT_TRUTH §Cairn
        // Markers. This is the "worth stopping for" private marker on the
        // user's own map, not a hazard broadcast. Users who want to flag
        // hazards go through PlantScreen to pick the type deliberately.
        // MarkerType is one of danger|junction|water|hut|cairn (see
        // src/config/markerTypes.ts); 'personal' is a permission value
        // not a type value — separating them here matches the schema.
        type: 'cairn',
        regionCode: region.code,
        lat: lastCoordinate.lat,
        lng: lastCoordinate.lng,
        note: '',
        authorId: 'local',
        permission: 'personal',
        sessionId: sessionId ?? undefined,
      });
      if (sessionId) linkMarker(marker.id);
      setPlantToast('Cairn planted');
      setTimeout(() => setPlantToast(null), 1500);
    } catch {
      setPlantToast('Failed to plant cairn');
      setTimeout(() => setPlantToast(null), 2000);
    }
  }

  // Sleep-run 2026-08-16 rev-2: activeRouteName was rendered under the
  // compass ring which has been removed. If we later surface an active
  // route badge on R1, re-derive it from routes + selectedRoute at the
  // render site.

  // Format display values
  const distDisplay = locationAvailable ? dist.format(distanceM, 2) : '--';
  const durationDisplay = formatDuration(durationS);
  // O18 RUN-02: signal-lost chip (parity with HikingScreen). Fires at 2 min
  // of no accepted GPS fix during active tracking.
  const RUN_SIGNAL_GAP_MS = 120_000;
  const lastTrackT = trackPoints.length > 0 ? trackPoints[trackPoints.length - 1].t : null;
  const signalLostFor = (lastTrackT != null) ? (Date.now() - lastTrackT) : 0;
  const signalLost = lastTrackT != null && signalLostFor > RUN_SIGNAL_GAP_MS;
  const signalLostMin = Math.floor(signalLostFor / 60_000);
  // Pace: min/km (or min/mi if imperial) — seconds per meter → minutes per unit
  // 2026-08-17 concept R0: pace reads as `5'52"/km` with the unit inline
  // (tiny). paceDisplay itself returns just the numeric portion; the
  // stat row is responsible for rendering the unit via StatItem.label.
  const paceUnit = dist.imperial ? '/mi' : '/km';
  const paceDisplay = (() => {
    if (!locationAvailable || distanceM < 10) return '--';
    // For imperial: seconds per mile (1609.344 m). For metric: seconds per km (1000 m).
    const secPerUnit = dist.imperial
      ? durationS / (distanceM / 1609.344)
      : durationS / (distanceM / 1000);
    const paceMin = Math.floor(secPerUnit / 60);
    const paceSec = Math.round(secPerUnit % 60);
    return `${paceMin}'${String(paceSec).padStart(2, '0')}"`;
  })();

  // Sleep-run 2026-08-16 patch: R1 polyline GeoJSON. Rebuilt inline from
  // trackPoints (no store subscription change — same array we already read
  // for signal-lost detection above). Only rendered if trackPoints has >= 2
  // coordinates; MapView is safe even if this returns an empty FeatureColl.
  const trackLineGeoJSON = React.useMemo(() => {
    if (!trackPoints || trackPoints.length < 2) {
      return { type: 'FeatureCollection', features: [] } as any;
    }
    return {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: {
            type: 'LineString',
            coordinates: trackPoints.map(p => [p.lng, p.lat]),
          },
          properties: {},
        },
      ],
    } as any;
  }, [trackPoints]);

  // ── Stopped state (R4 Complete) ────────────────────────────────────────────
  // Sleep-run 2026-08-16 rev-2: redesigned per R4-complete.png.
  //   • Hero image uses aspectRatio 16/10 (no fixed 320px height).
  //   • Stat values render in dark ink (#1E2A24) — the forest green is
  //     reserved for the primary CTA. Labels are simplified: km / time / /km.
  //   • Primary CTA "View Activity" → MapHistory detail for the saved run.
  //   • Secondary CTA "Done" → returns Home.
  //   • The old "Discard" text link is removed. Discard now only exists in
  //     the too-short flow (see TooShortSheet below), not on the summary.
  if (runState === 'stopped') {
    const summaryDist = dist.format(distanceM, 2);
    const goHome = () => {
      setStoppedSessionId(null);
      setRunState('pre');
      nav.dispatch(
        CommonActions.reset({
          index: 0,
          routes: [{ name: 'Home' }],
        })
      );
    };
    const goActivityDetail = () => {
      if (stoppedSessionId == null) { goHome(); return; }
      nav.dispatch(
        CommonActions.reset({
          index: 2,
          routes: [
            { name: 'Home' },
            { name: 'Routes', params: { initialTab: 'activities' } },
            { name: 'MapHistory', params: { sessionId: stoppedSessionId } },
          ],
        })
      );
    };
    // Sleep-run 2026-08-16 (R4 concept): share this run via the iOS system
    // share sheet. Built-in React Native Share API — no new dependency.
    const shareRun = async () => {
      try {
        const message = `I just ran ${summaryDist} ${dist.unit} in ${durationDisplay} — tracked with CairnNZ.`;
        await Share.share({ message });
      } catch {
        // User cancelled or share unavailable — no-op.
      }
    };

    return (
      <SafeAreaView style={completeStyles.container} edges={['top', 'bottom']}>
        <ScrollView contentContainerStyle={completeStyles.scroll} showsVerticalScrollIndicator={false}>
          {/* Header row (fix 3): Back chevron (left) + Share icon (right).
              Back is semantically equivalent to Done — the run is already
              saved, so both routes go Home. Without a Back the R4 screen
              had no visible way to leave besides the CTAs which felt like
              a dead-end when a user just wanted to bail. */}
          <View style={completeStyles.headerRow}>
            {/* R21 v3 (2026-08-17): unified back button to Auth standard —
                was icon-only ChevronLeft (24pt, no "Back" label); users had
                to guess the affordance. Now inline "Back" text + chevron,
                matches Sign In / Sign Up / Settings across the app. */}
            <BackButton variant="inline" onPress={goHome} />
            <View style={{ flex: 1 }} />
            <TouchableOpacity
              onPress={shareRun}
              style={completeStyles.shareBtn}
              accessibilityRole="button"
              accessibilityLabel="Share this run"
              activeOpacity={0.6}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Icon name="Share2" size={22} color={RunConcept.textPrimary} strokeWidth={2} />
            </TouchableOpacity>
          </View>
          <Image
            source={require('../../assets/running/run-complete-hero.png')}
            style={completeStyles.hero}
            resizeMode="cover"
          />
          <Text style={completeStyles.title}>Run Complete</Text>
          <View style={completeStyles.statsRow}>
            <View style={completeStyles.statCell}>
              <Text style={completeStyles.statVal}>{summaryDist}</Text>
              <Text style={completeStyles.statLbl}>{dist.unit}</Text>
            </View>
            <View style={completeStyles.statCell}>
              <Text style={completeStyles.statVal}>{durationDisplay}</Text>
              <Text style={completeStyles.statLbl}>time</Text>
            </View>
            <View style={completeStyles.statCell}>
              <Text style={completeStyles.statVal}>{paceDisplay}</Text>
              <Text style={completeStyles.statLbl}>/{dist.unit}</Text>
            </View>
          </View>

          {/* Mini-map preview (concept R4). SVG polyline over rounded paper
              card — same fallback strategy as StopSummarySheet. Static so
              the R4 screen doesn't need to spin up another Mapbox context. */}
          <View
            style={completeStyles.miniMapCard}
            onLayout={(e) => setR4MiniMapWidth(e.nativeEvent.layout.width)}
          >
            {r4MiniMapWidth > 0 && (
              <RunMiniMapPolyline
                points={trackPoints.map(p => ({ lat: p.lat, lng: p.lng }))}
                stroke={RunConcept.forest}
                width={r4MiniMapWidth}
                height={130}
              />
            )}
          </View>

          {/* "Great run!" feedback card (concept R4). Small fern icon + bold
              header + muted subtitle. Reinforces the exploration story before
              the primary CTA. */}
          <View style={completeStyles.feedbackCard}>
            <View style={completeStyles.feedbackIcon}>
              <Icon name="Leaf" size={22} color={RunConcept.forest} strokeWidth={2} />
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={completeStyles.feedbackTitle}>Great run!</Text>
              <Text style={completeStyles.feedbackSubtitle}>
                Another piece of your world explored.
              </Text>
            </View>
          </View>

          <View style={completeStyles.ctaGroup}>
            <TouchableOpacity
              style={completeStyles.primaryBtn}
              onPress={goActivityDetail}
              accessibilityRole="button"
              accessibilityLabel="View this run in Activity Detail"
              activeOpacity={0.9}
            >
              <Text style={completeStyles.primaryBtnText}>View Activity</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={goHome}
              style={completeStyles.doneBtn}
              accessibilityRole="button"
              accessibilityLabel="Done — return home"
            >
              <Text style={completeStyles.doneBtnText}>Done</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  // ── Pre-start ─────────────────────────────────────────────────────────────
  if (runState === 'pre') {
    return (
      <View style={{ flex: 1, backgroundColor: runIsDark ? '#0F1620' : Colors.primaryBg }}>
        {/* Real Mapbox basemap (or fallback if Mapbox unavailable) */}
        {MapView ? (
          <MapView
            key={`map-${mapEpoch}`}
            style={StyleSheet.absoluteFillObject}
            styleURL={runIsDark ? getMapStyleForLayer('outdoors', true) : getPrimaryMapStyle()}
            logoEnabled={false}
            attributionEnabled={false}
            scaleBarEnabled={false}
            compassEnabled={false}
            // v124 fix #2: disable gestures during the fly-in so an
            // accidental touch doesn't cancel the camera mid-animation
            // (which is what made the Running fly-in land mid-zoom
            // instead of starting at the full globe like Hiking does).
            scrollEnabled={gesturesEnabled}
            zoomEnabled={gesturesEnabled}
            rotateEnabled={gesturesEnabled}
            pitchEnabled={gesturesEnabled}
          >
            {/* v122 fix #2: full mirror of HikingScreen — Camera always
                mounts. instantCamera mode (lastCoordinate known) uses
                defaultSettings + animationMode='none' AND the imperative
                setCamera useEffect above. Cold mode (no GPS yet) uses
                followUserLocation+flyTo, same as HikingScreen first
                entry. The previous version (only mount when lastCoord
                known) caused the inconsistent "stuck globe → instant"
                divergence between first/second open. */}
            {CameraComponent && (
              <CameraComponent
                ref={cameraRef}
                followUserLocation={!instantCamera && foregroundGranted}
                followZoomLevel={15}
                followPitch={0}
                animationDuration={instantCamera ? 0 : 600}
                animationMode={instantCamera ? 'none' : 'flyTo'}
                // v127 fix #2: drop the Auckland-zoom2 default. Hiking
                // doesn't set defaultSettings either when not in instant
                // mode — it lets Mapbox start from its own default
                // (zoom 0, [0,0]) and fly to the user. Forcing
                // Auckland-zoom-2 made Running fly horizontally across
                // the globe to the user's actual GPS, instead of zooming
                // in straight from the full-globe view.
                defaultSettings={instantCamera && lastCoordinate
                  ? { centerCoordinate: [lastCoordinate.lng, lastCoordinate.lat], zoomLevel: 15 }
                  : undefined}
              />
            )}
            {UserLocationComponent && foregroundGranted && (
              <UserLocationComponent visible androidRenderMode="normal" />
            )}
          </MapView>
        ) : (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.md }}>
            <Icon name="Map" size={48} color={Colors.primaryMuted} />
            <Text style={{ fontSize: FontSize.h3, fontWeight: '600', color: Colors.textPrimary }}>
              Map unavailable
            </Text>
            <Text style={{ fontSize: FontSize.body, color: Colors.textSecondary, textAlign: 'center' }}>
              Live map appears when GPS is enabled
            </Text>
          </View>
        )}

        {/* Top overlay: back + GPS chip */}
        <SafeAreaView style={preStyles.topOverlay} edges={['top']} pointerEvents="box-none">
          <View style={preStyles.topRow}>
            <BackButton variant="inline" onPress={() => {
              if (nav.canGoBack()) nav.goBack();
              else nav.navigate('Home' as never);
            }} />
            {/* R114/O22 STORY-73018 UX fix: when permission is denied AND
                the OS won't let us re-prompt (canAskAgain=false), turn the
                "Enable GPS" chip into a tappable Settings deep-link so the
                user has a path forward instead of a dead-end. Non-blocked
                state (permission granted, or not yet asked) keeps the
                static chip. */}
            {permissionBlocked ? (
              <TouchableOpacity
                style={preStyles.gpsChip}
                onPress={() => { try { require('react-native').Linking.openSettings(); } catch { /* silent */ } }}
                accessibilityRole="button"
                accessibilityLabel="Open device Settings to enable location"
              >
                <View style={[preStyles.gpsDot, { backgroundColor: Colors.severityWarning }]} />
                <Text style={preStyles.gpsText}>Enable in Settings</Text>
              </TouchableOpacity>
            ) : (
              <View style={preStyles.gpsChip}>
                <View style={[preStyles.gpsDot, { backgroundColor: Colors.severityWarning }]} />
                <Text style={preStyles.gpsText}>Enable GPS</Text>
              </View>
            )}
          </View>
          {/* 2026-08-16 Round 6: R0 stats strip per concept row-03/04 col 1.
              4-item row (km / time / pace / GPS dot) shown pre-start too so
              layout is symmetric with Hiking H0 statsStrip. Zeros gracefully
              before user hits Start. */}
          <View style={preStyles.statsStrip} pointerEvents="none">
            <Text style={preStyles.statsStripKm}>0.00 {dist.unit}</Text>
            <Text style={preStyles.statsStripTime}>00:00</Text>
            <Text style={preStyles.statsStripPace}>{`--'--"/${dist.unit}`}</Text>
            <View style={preStyles.statsStripGpsWrap}>
              <View style={[preStyles.statsStripGpsDot, { backgroundColor: permissionBlocked ? Colors.severityWarning : RunConcept.forest }]} />
              <Text style={preStyles.statsStripGpsText}>GPS</Text>
            </View>
          </View>
        </SafeAreaView>

        {/* Bottom: FREE RUN card + Route row + green Start Running (R0 concept) */}
        <SafeAreaView style={preStyles.bottomOverlay} edges={['bottom']} pointerEvents="box-none">
          <View style={preStyles.bottomPanel}>
            {/* FREE RUN card — 2026-08-17 concept R0: compass/target
                glyph on the left, eyebrow + sub in the middle, chevron
                on the right. Compass matches the "Run anywhere" story
                and echoes the R0 map orientation cue. */}
            <TouchableOpacity style={preStyles.freeRunCard} onPress={openRoutePicker} activeOpacity={0.9}>
              <View style={preStyles.freeRunGlyph}>
                <Icon name="Target" size={22} color={RunConcept.textPrimary} strokeWidth={2} />
              </View>
              <View style={preStyles.freeRunTextGroup}>
                <Text style={preStyles.freeRunEyebrow}>FREE RUN</Text>
                <Text style={preStyles.freeRunSub}>Run anywhere</Text>
              </View>
              <Icon name="ChevronUp" size={20} color={RunConcept.textMuted} strokeWidth={2} />
            </TouchableOpacity>

            {/* Route row — separate line per concept */}
            <TouchableOpacity style={preStyles.routeRow} onPress={openRoutePicker} activeOpacity={0.9}>
              <Text style={preStyles.routeRowText}>Route: {selectedRoute ? selectedRouteName : 'None'}</Text>
              <Icon name="ChevronRight" size={18} color={RunConcept.textMuted} strokeWidth={2} />
            </TouchableOpacity>

            {/* Start Running — full-width forest-green pill */}
            <Animated.View style={{ transform: [{ scale: startBtnScale }] }}>
              <TouchableOpacity
                activeOpacity={0.92}
                onPress={handleStart}
                onPressIn={onStartPressIn}
                onPressOut={onStartPressOut}
                style={preStyles.startBtn}
              >
                <Text style={preStyles.startBtnText}>Start Running</Text>
              </TouchableOpacity>
            </Animated.View>
            {/* 2026-08-17 concept R0: tiny lock hint below Start Running.
                Reassures the user that the phone screen auto-locks so they
                can stash the device in a pocket without worrying about
                accidental input during the run. */}
            <View style={preStyles.lockHintRow}>
              <Icon name="Lock" size={11} color={Colors.textMuted} strokeWidth={2} />
              <Text style={preStyles.lockHint}>Screen locks automatically</Text>
            </View>
          </View>
        </SafeAreaView>

        {/* Route picker sheet */}
        {showRoutePicker && (
          <Animated.View style={[preStyles.routePickerBackdrop, { opacity: routePickerOpacity }]}>
            <TouchableOpacity style={StyleSheet.absoluteFillObject} onPress={closeRoutePicker} activeOpacity={1} />
            <Animated.View style={[preStyles.routePickerSheet, { transform: [{ translateY: routePickerSlide }] }]}>
              <View style={preStyles.routePickerHandle} />
              <Text style={preStyles.routePickerTitle}>Choose a route</Text>
              <ScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: 280 }} contentContainerStyle={{ gap: Spacing.sm }}>
                {/* Free Run */}
                <TouchableOpacity
                  style={[preStyles.routePickerRow, selectedRoute === null && preStyles.routePickerRowSelected]}
                  onPress={() => pickRoute(null)}
                  activeOpacity={0.8}
                >
                  <View style={[preStyles.routePickerBadge, { backgroundColor: RunConcept.forest + '1F' }]}>
                    <Icon name="Target" size={16} color={RunConcept.forest} strokeWidth={2} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={preStyles.routePickerName}>Free Run</Text>
                    <Text style={preStyles.routePickerMeta}>No route · explore freely</Text>
                  </View>
                  {selectedRoute === null && <Icon name="Check" size={16} color={RunConcept.forest} strokeWidth={2.5} />}
                </TouchableOpacity>

                {/* Saved routes */}
                {routes.map(r => (
                  <TouchableOpacity
                    key={r.id}
                    style={[preStyles.routePickerRow, selectedRoute === r.id && preStyles.routePickerRowSelected]}
                    onPress={() => pickRoute(r.id)}
                    activeOpacity={0.8}
                  >
                    <View style={[preStyles.routePickerBadge, { backgroundColor: RunConcept.forest + '1F' }]}>
                      <Icon name="Route" size={16} color={RunConcept.forest} strokeWidth={2} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={preStyles.routePickerName}>{r.name}</Text>
                      <Text style={preStyles.routePickerMeta}>
                        {dist.format(r.distanceM, 1)} {dist.unit}
                        {r.elevationGainM > 0 ? ` · ↑${dist.formatElevation(r.elevationGainM)}${dist.elevUnit}` : ''}
                        {r.runCount > 0 ? ` · ${r.runCount}× done` : ''}
                      </Text>
                    </View>
                    {selectedRoute === r.id && <Icon name="Check" size={16} color={RunConcept.forest} strokeWidth={2.5} />}
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </Animated.View>
          </Animated.View>
        )}
      </View>
    );
  }

  // ── Running (R1 tracking + R2 actions) ────────────────────────────────────
  // Sleep-run 2026-08-16 rev-2 layout:
  //   • Full-bleed Mapbox basemap with the live polyline drawn on top.
  //   • Top stats bar (distance / elapsed / pace / GPS chip).
  //   • Persistent 3-button action tray at the bottom: Pause / Cairn / Done.
  //   • No compass ring, no lock overlay, no double-tap gesture. Done opens
  //     the save-name sheet which drives the transition to R4.
  return (
    <View style={[runStyles.container, runIsDark ? { backgroundColor: '#0F1620' } : null]}>
      <View style={[runStyles.bg, runIsDark ? { backgroundColor: '#0F1620' } : null]}>
          {/* R1 basemap + tracking polyline. Concept R1-tracking.png shows
              a full terrain map behind the top stats bar with the run's
              green trail drawn on top. Store subscriptions unchanged —
              geometry rebuilt from the same trackPoints already read for
              signal-lost detection. */}
          {MapView && (
            <View style={StyleSheet.absoluteFillObject} pointerEvents="none">
              <MapView
                style={StyleSheet.absoluteFillObject}
                styleURL={runIsDark ? getMapStyleForLayer('outdoors', true) : getPrimaryMapStyle()}
                logoEnabled={false}
                attributionEnabled={false}
                scaleBarEnabled={false}
                compassEnabled={false}
                scrollEnabled={false}
                zoomEnabled={false}
                rotateEnabled={false}
                pitchEnabled={false}
              >
                {CameraComponent && (
                  <CameraComponent
                    followUserLocation={foregroundGranted}
                    followZoomLevel={16}
                    followPitch={0}
                    animationDuration={600}
                    animationMode="flyTo"
                    defaultSettings={lastCoordinate
                      ? { centerCoordinate: [lastCoordinate.lng, lastCoordinate.lat], zoomLevel: 16 }
                      : undefined}
                  />
                )}
                {ShapeSource && LineLayer && trackLineGeoJSON.features.length > 0 && (
                  <ShapeSource id="run-track-line" shape={trackLineGeoJSON}>
                    <LineLayer
                      id="run-track-line-layer"
                      style={{
                        // 2026-08-17 concept R1: run polyline reads
                        // as olive/yellow-green (#7A9830), sampled
                        // from the mid section of the concept trail.
                        // Distinct from Hike's darker forest green
                        // (#3F5D37) so first-time users can tell the
                        // two activities apart on the shared history
                        // map without a legend.
                        lineColor: '#7A9830',
                        lineWidth: 5,
                        lineCap: 'round',
                        lineJoin: 'round',
                      }}
                    />
                  </ShapeSource>
                )}
                {UserLocationComponent && foregroundGranted && (
                  <UserLocationComponent visible androidRenderMode="normal" />
                )}
                {/* 2026-08-17 concept R1: green start-dot marker at
                    trackPoints[0]. Renders as soon as we have at least
                    one recorded fix so the trailhead is visible even
                    on the first stride. Uses the extracted concept
                    asset (assets/map/marker-start.png). */}
                {PointAnnotationComponent && trackPoints.length > 0 && (
                  <PointAnnotationComponent
                    id="run-track-start"
                    coordinate={[trackPoints[0].lng, trackPoints[0].lat]}
                  >
                    <Image
                      source={require('../../assets/map/marker-start.png')}
                      style={{ width: 26, height: 26 }}
                      resizeMode="contain"
                    />
                  </PointAnnotationComponent>
                )}
              </MapView>
            </View>
          )}
          {/* O18 RUN-02: Signal-lost chip (parity with Hiking).
              Visible only during active tracking after 2 min of no fix.
              R21 (2026-08-18): pinned to top-right + dark-aware. */}
          {status === 'tracking' && signalLost && (
            <SafeAreaView edges={['top']} style={{ alignItems: 'flex-end', paddingHorizontal: Spacing.base }}>
              <View style={runStyles.signalLostPill}>
                <View style={runStyles.signalLostDot} />
                <Text style={runStyles.signalLostText}>
                  {signalLostMin >= 1 ? `Signal lost · ${signalLostMin} min` : 'Signal lost'}
                </Text>
              </View>
            </SafeAreaView>
          )}
          {/* Stats bar — 2026-08-17 concept R0/R1: distance / duration
              / pace / GPS pill. Label strings match the concept ("km",
              blank for duration since HH:MM:SS reads on its own,
              "/km" suffix baked into paceDisplay). */}
          <SafeAreaView edges={['top']}>
            <View style={[runStyles.statsBar, runIsDark ? { backgroundColor: "rgba(15,22,38,0.55)", borderBottomColor: "rgba(220,230,240,0.14)" } : null]}>
              <StatItem value={distDisplay} label={dist.unit} />
              <StatItem value={durationDisplay} label="" />
              <StatItem value={paceDisplay} label={paceDisplay === '--' ? '' : paceUnit} />
              <View style={[runStyles.statItem, { justifyContent: 'center', gap: 4 }]}>
                <PulseDot
                  size={8}
                  color={locationAvailable ? RunConcept.forest : RunConcept.textMuted}
                  pulsing={locationAvailable}
                />
                <Text style={runStyles.statUnit}>{locationAvailable ? 'GPS' : 'Offline'}</Text>
              </View>
            </View>
          </SafeAreaView>

          {/* Sleep-run 2026-08-16 rev-2: compass ring + dark lock overlay
              removed. R1 is now a clean map-first view — the polyline and
              stats bar carry the whole R1 experience. */}

          {/* R21 (2026-08-18 user "run同步 也是一样"): R2 action tray now
              mirrors Hiking — collapsible anchor at bottom-left (old
              compass FAB position). Tap Navigation → Pause / Cairn /
              Finish slides out to the right. Same behaviour paused or
              running. Recenter FAB lives bottom-right and only appears
              when the user has dragged the map off follow. */}
          <View style={runStyles.trayAnchorLayer} pointerEvents="box-none">
            <SafeAreaView edges={['bottom']} pointerEvents="box-none">
              <View style={runStyles.trayAnchorRow} pointerEvents="auto">
                <TouchableOpacity
                  style={[runStyles.trayAnchor, runIsDark ? { backgroundColor: 'rgba(15,22,38,0.85)', borderColor: 'rgba(220,230,240,0.24)' } : null]}
                  activeOpacity={0.85}
                  accessibilityRole="button"
                  accessibilityLabel={runActionsExpanded ? 'Hide quick actions' : 'Show quick actions'}
                  onPress={() => {
                    haptic.selection();
                    setRunActionsExpanded(v => !v);
                  }}
                >
                  <Icon
                    name={runActionsExpanded ? 'ChevronLeft' : 'Navigation'}
                    size={22}
                    color={runIsDark ? '#F0EEE6' : RunConcept.textPrimary}
                    strokeWidth={2.2}
                  />
                </TouchableOpacity>
                {runActionsExpanded && (
                  <View style={runStyles.trayRow}>
                    <View style={runStyles.trayItem}>
                      <TouchableOpacity
                        style={[runStyles.trayFab, runIsDark ? { backgroundColor: 'rgba(15,22,38,0.72)', borderColor: 'rgba(220,230,240,0.20)' } : null]}
                        activeOpacity={0.85}
                        onPress={() => {
                          haptic.impact('light');
                          if (status === 'paused') resumeTracking();
                          else pauseTracking();
                          setRunActionsExpanded(false);
                        }}
                        accessibilityRole="button"
                        accessibilityLabel={status === 'paused' ? 'Resume run' : 'Pause run'}
                      >
                        <Icon
                          name={status === 'paused' ? 'Play' : 'Pause'}
                          size={22} color={runIsDark ? '#F0EEE6' : RunConcept.textPrimary} strokeWidth={2.2}
                        />
                      </TouchableOpacity>
                      <Text style={[runStyles.trayFabLabel, runIsDark ? { color: '#F0EEE6' } : null]}>
                        {status === 'paused' ? 'Resume' : 'Pause'}
                      </Text>
                    </View>
                    <View style={runStyles.trayItem}>
                      <TouchableOpacity
                        style={[runStyles.trayFab, runIsDark ? { backgroundColor: 'rgba(15,22,38,0.72)', borderColor: 'rgba(220,230,240,0.20)' } : null]}
                        activeOpacity={0.85}
                        onPress={() => {
                          setRunActionsExpanded(false);
                          handlePlantCairn();
                        }}
                        disabled={!locationAvailable}
                        accessibilityRole="button"
                        accessibilityLabel="Leave a Cairn"
                      >
                        <Image
                          source={runIsDark
                            ? require('../../assets/home/action-leave-cairn-night.png')
                            : require('../../assets/home/action-leave-cairn-day.png')}
                          style={{ width: 28, height: 28 }}
                          resizeMode="contain"
                        />
                      </TouchableOpacity>
                      <Text style={[runStyles.trayFabLabel, runIsDark ? { color: '#F0EEE6' } : null]}>Cairn</Text>
                    </View>
                    <View style={runStyles.trayItem}>
                      <TouchableOpacity
                        style={[runStyles.trayFab, runIsDark ? { backgroundColor: 'rgba(15,22,38,0.72)', borderColor: 'rgba(220,230,240,0.20)' } : null]}
                        activeOpacity={0.85}
                        onPress={() => {
                          haptic.impact('medium');
                          setRunActionsExpanded(false);
                          openSaveSheet();
                        }}
                        accessibilityRole="button"
                        accessibilityLabel="Finish run"
                      >
                        <Icon name="Flag" size={22} color={runIsDark ? '#F0EEE6' : RunConcept.textPrimary} strokeWidth={2.2} />
                      </TouchableOpacity>
                      <Text style={[runStyles.trayFabLabel, runIsDark ? { color: '#F0EEE6' } : null]}>Finish</Text>
                    </View>
                  </View>
                )}
              </View>
              {plantToast && (
                <View style={runStyles.plantToast}>
                  <Text style={runStyles.plantToastText}>{plantToast}</Text>
                </View>
              )}
            </SafeAreaView>
          </View>
      </View>

      {/* Save-name sheet — lightweight local sheet (name input + Save +
          Cancel). Opens on Done tap; Save triggers handleStop(name) which
          persists the session and transitions this screen to R4. */}
      {showSaveSheet && (
        <Animated.View
          style={[runStyles.saveSheetBackdrop, { opacity: saveSheetOpacity }]}
          pointerEvents="auto"
        >
          <TouchableOpacity
            style={StyleSheet.absoluteFillObject}
            activeOpacity={1}
            onPress={() => closeSaveSheet()}
          />
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            style={{ width: '100%' }}
          >
            <Animated.View
              style={[runStyles.saveSheet, { transform: [{ translateY: saveSheetSlide }] }]}
            >
              <View style={runStyles.saveSheetHandle} />
              <Text style={runStyles.saveSheetTitle}>Name this run</Text>
              <TextInput
                style={runStyles.saveSheetInput}
                placeholder="Morning Run"
                placeholderTextColor={RunConcept.textMuted}
                value={pendingName}
                onChangeText={(t) => setPendingName(t.slice(0, 60))}
                autoFocus
                returnKeyType="done"
                onSubmitEditing={() => {
                  // Fix 1: do NOT clear pendingName here — handleStop clears
                  // it after a successful (non-too-short) stop. Keeping it
                  // preserves the user's chosen name across a too-short
                  // TooShortSheet resolution.
                  const name = pendingName;
                  closeSaveSheet(() => { void handleStop(name); });
                }}
              />
              <TouchableOpacity
                style={runStyles.saveSheetBtn}
                onPress={() => {
                  const name = pendingName;
                  closeSaveSheet(() => { void handleStop(name); });
                }}
                accessibilityRole="button"
                accessibilityLabel="Save this run"
                activeOpacity={0.9}
              >
                <Text style={runStyles.saveSheetBtnText}>Save</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={runStyles.saveSheetCancel}
                onPress={() => closeSaveSheet()}
                accessibilityRole="button"
                accessibilityLabel="Cancel and keep running"
              >
                <Text style={runStyles.saveSheetCancelText}>Cancel</Text>
              </TouchableOpacity>
            </Animated.View>
          </KeyboardAvoidingView>
        </Animated.View>
      )}

      {/* v118: too-short modal — rendered at the running layer so it
          covers the lock + controls. Got it = continue tracking (state
          preserved by stopTracking pre-check). End anyway = full discard. */}
      <TooShortSheet
        visible={lastStopReason === 'too-short'}
        activityMode="running"
        onContinue={() => clearLastStopReason()}
        onDiscard={() => {
          clearLastStopReason();
          discardCurrentSession();
          // Fix 4 (STATE-LEAK-STOPPED-SESSION-ID): after a too-short
          // discard there is no persisted session to view. Explicitly
          // null out stoppedSessionId so R4's "View Activity" falls back
          // to Home instead of navigating to an old / wrong session.
          setStoppedSessionId(null);
          // Fix 1: also drop the SaveSheet name — this run is gone.
          setPendingName('');
          setRunState('stopped');
        }}
      />
      {/* O18 ONB-04: permission-denied modal for Running. */}
      <PermissionDeniedModal
        visible={permissionDeniedVisible && isFocused}
        featureName="Running"
        onDismiss={() => setPermissionDeniedVisible(false)}
      />
    </View>
  );
}

// ── Styles: pre-run ─────────────────────────────────────────────────────────
const preStyles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },
  header: {
    paddingHorizontal: Spacing.base,
    paddingTop: Spacing.sm,
    paddingBottom: Spacing.md,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  topBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: Spacing.sm,
  },
  // O1 batch 34: removed backBtn, backText, routeList, selectLabel, routeCard,
  // routeCardSelected, routeCardSelectedGreen, routeIconBadge, routeName, routeMeta,
  // checkBadge — dead keys from old list-based route selector UI (0 JSX references).
  title: {
    flex: 1, textAlign: 'center',
    fontSize: FontSize.h3, fontWeight: '700',
    color: Colors.textPrimary,
  },
  subtitle: { fontSize: FontSize.small, color: Colors.textSecondary, marginTop: 4 },

  // New compact layout — R0 concept
  bottomPanel: { paddingHorizontal: Spacing.base, paddingBottom: Spacing.md, gap: Spacing.sm },
  freeRunCard: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: RunConcept.cardSurface, borderRadius: 18,
    paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md,
    borderWidth: 1, borderColor: RunConcept.hairline,
    gap: Spacing.md,
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.08, shadowRadius: 14, elevation: 4,
  },
  // 2026-08-17 concept R0: 40x40 rounded well for the compass glyph.
  // No fill — the icon reads directly on the card surface, matching
  // the concept sheet's understated iconography.
  freeRunGlyph: {
    width: 40, height: 40,
    alignItems: 'center', justifyContent: 'center',
  },
  freeRunTextGroup: { flex: 1, gap: 2 },
  freeRunEyebrow: {
    fontSize: 12, fontWeight: '800', color: RunConcept.textPrimary,
    letterSpacing: 0.6,
  },
  freeRunSub: {
    fontSize: 13, fontWeight: '500', color: RunConcept.textSecondary,
  },
  routeRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: RunConcept.cardSurface, borderRadius: 12,
    paddingHorizontal: Spacing.base, height: 44,
    borderWidth: 1, borderColor: 'rgba(20,42,30,0.08)',
  },
  routeRowText: {
    flex: 1, fontSize: 14, fontWeight: '600', color: RunConcept.textPrimary,
  },
  // Legacy pill kept for route picker referencing (removed from JSX but styles
  // referenced in picker sheet below). Retained to avoid breaking route picker.
  routePill: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    backgroundColor: 'rgba(255,255,255,0.97)', borderRadius: Radius.card,
    padding: Spacing.md,
    borderWidth: 1.5, borderColor: RunConcept.forest + '40',
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.10, shadowRadius: 14, elevation: 5,
  },
  routePillIcon: {
    width: 44, height: 44, borderRadius: 12,
    backgroundColor: RunConcept.forest + '1F', alignItems: 'center', justifyContent: 'center',
  },
  routePillTextGroup: { flex: 1, gap: 1 },
  routePillText: { fontSize: FontSize.body, fontWeight: '600', color: Colors.textPrimary },
  routePillHint: { fontSize: FontSize.small, color: RunConcept.forest, fontWeight: '500' },
  // O1 batch 34: routePillChevron removed — 0 JSX references (superseded by inline Icon in pill row).

  routePickerBackdrop: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'flex-end',
  },
  routePickerSheet: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: 20, borderTopRightRadius: 20,
    paddingHorizontal: Spacing.base, paddingTop: Spacing.sm, paddingBottom: Spacing.xxl,
    gap: Spacing.sm,
    shadowColor: '#000', shadowOffset: { width: 0, height: -4 }, shadowOpacity: 0.12, shadowRadius: 20, elevation: 12,
  },
  routePickerHandle: {
    width: 36, height: 4, borderRadius: 2,
    backgroundColor: Colors.border, alignSelf: 'center', marginBottom: Spacing.xs,
  },
  routePickerTitle: { fontSize: FontSize.caption, fontWeight: '700', color: Colors.textMuted,  letterSpacing: 0.8, marginBottom: 4 },
  routePickerRow: {
    backgroundColor: 'rgba(255,255,255,0.92)', borderRadius: Radius.card,
    flexDirection: 'row', alignItems: 'center',
    padding: Spacing.base, gap: Spacing.md,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.4)',
    borderLeftWidth: 3, borderLeftColor: 'transparent',
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.08, shadowRadius: 12, elevation: 4,
  },
  routePickerRowSelected: { borderLeftColor: RunConcept.forest, backgroundColor: RunConcept.forest + '14', borderColor: RunConcept.forest + '33' },
  routePickerBadge: {
    width: 44, height: 44, borderRadius: 12,
    backgroundColor: RunConcept.forest + '1F',
    alignItems: 'center', justifyContent: 'center',
  },
  routePickerName: { fontSize: FontSize.body, fontWeight: '600', color: Colors.textPrimary },
  routePickerMeta: { fontSize: FontSize.small, color: Colors.textSecondary, marginTop: 2 },

  footer: { padding: Spacing.xl, gap: Spacing.sm },
  // R0 concept: Start Running is a full-width forest-green pill. No icon,
  // just centered label — matches sleep-run-2026-08-15 frame exactly.
  startBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    backgroundColor: RunConcept.forest,
    borderRadius: 26,
    height: 52,
    paddingHorizontal: Spacing.xl,
  },
  startBtnText: { fontSize: 17, fontWeight: '700', color: RunConcept.paper },
  lockHintRow: { flexDirection: 'row', alignItems: 'center', gap: 6, justifyContent: 'center' },
  lockHint: { fontSize: FontSize.small, color: Colors.textMuted, textAlign: 'center' },
  // O1 batch 34: shareBtn, shareBtnText removed — 0 JSX references.

  summaryCard: {
    backgroundColor: Colors.surface, borderRadius: Radius.card,
    paddingVertical: Spacing.xl, paddingHorizontal: Spacing.base,
    width: '100%', ...Shadow.card,
    borderWidth: 1, borderColor: Colors.border,
  },
  summaryStatRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around',
  },
  summaryStat: { flex: 1, alignItems: 'center', gap: 4 },
  summaryStatVal: {
    fontSize: FontSize.h2, fontWeight: '800',
    color: Colors.textPrimary, letterSpacing: -0.5,
  },
  summaryStatLbl: { fontSize: FontSize.small, color: Colors.textSecondary },
  summaryDivider: { width: 1, height: 36, backgroundColor: Colors.border },

  // Hiking-style overlay layout
  topOverlay: { position: 'absolute', top: 0, left: 0, right: 0, pointerEvents: 'box-none' },
  // 2026-08-16 Round 6: R0 stats strip (per concept row-03/04 col 1).
  // 4-item row, positioned below top gps chip row.
  statsStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 6,
    paddingBottom: 8,
  },
  statsStripKm: { fontSize: 14, fontWeight: '700', color: RunConcept.textPrimary, fontVariant: ['tabular-nums'] },
  statsStripTime: { fontSize: 14, fontWeight: '700', color: RunConcept.textPrimary, fontVariant: ['tabular-nums'] },
  statsStripPace: { fontSize: 14, fontWeight: '700', color: RunConcept.textPrimary, fontVariant: ['tabular-nums'] },
  statsStripGpsWrap: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  statsStripGpsDot: { width: 6, height: 6, borderRadius: 3 },
  statsStripGpsText: { fontSize: 12, fontWeight: '600', color: RunConcept.textSecondary },
  topRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: Spacing.base, paddingTop: Spacing.lg, gap: Spacing.sm,
  },
  gpsChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: Colors.severityWarningBg, borderRadius: Radius.pill,
    paddingHorizontal: Spacing.md, paddingVertical: 7,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.4)',
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.08, shadowRadius: 12, elevation: 4,
  },
  gpsDot: { width: 8, height: 8, borderRadius: 4 },
  gpsText: { fontSize: FontSize.small, fontWeight: '600', color: Colors.severityWarning },
  bottomOverlay: { position: 'absolute', bottom: 0, left: 0, right: 0, pointerEvents: 'box-none' },
  bottomRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: Spacing.base, gap: Spacing.sm,
  },
});

// ── Styles: running (R1/R2 concept, sleep-run 2026-08-16 rev-2) ────────────
// R1 is a clean map-first view; R2 is a persistent 3-button action tray.
// The dark lock overlay and compass ring styles from the previous rev have
// been removed. Save-name sheet styles are grouped at the bottom of the
// block since the sheet is co-rendered inside the running root View.
const runStyles = StyleSheet.create({
  container: { flex: 1, backgroundColor: RunConcept.paper },
  bg: { flex: 1, backgroundColor: RunConcept.paper },

  statsBar: {
    flexDirection: 'row', paddingHorizontal: Spacing.xl,
    paddingTop: Spacing.md, paddingBottom: Spacing.sm,
    borderBottomWidth: 1, borderBottomColor: RunConcept.hairline,
    gap: Spacing.base,
  },
  statItem: { flex: 1, alignItems: 'center', flexDirection: 'row', justifyContent: 'center' },
  statValue: { fontSize: 14, fontWeight: '700', color: RunConcept.textPrimary, letterSpacing: -0.2, fontVariant: ['tabular-nums'] },
  // 2026-08-17 concept R0: label sits inline with the value (small,
  // muted). Keeping statLabel around so the historical detail views
  // that still stack label under value don't break.
  statUnit: { fontSize: 11, fontWeight: '500', color: RunConcept.textMuted, letterSpacing: 0.2 },
  statLabel: { fontSize: FontSize.tiny, color: RunConcept.textMuted, marginTop: 2, letterSpacing: 0.5 },

  // R21 (2026-08-18): tray anchor mirrors Hiking — bottom-left, tap
  // Navigation → row expands to the right (Pause / Cairn / Finish).
  trayAnchorLayer: { position: 'absolute', bottom: 0, left: 0, right: 0 },
  trayAnchorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingLeft: Spacing.base,
    paddingBottom: Spacing.sm,
  },
  trayRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  trayItem: { alignItems: 'center' },
  trayAnchor: {
    width: 48, height: 48, borderRadius: 24,
    backgroundColor: 'rgba(255,253,247,0.94)',
    borderWidth: 1, borderColor: 'rgba(20,42,30,0.10)',
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15, shadowRadius: 10, elevation: 6,
  },
  trayFab: {
    width: 52, height: 52, borderRadius: 26,
    backgroundColor: 'rgba(255,253,247,0.94)',
    borderWidth: 1, borderColor: 'rgba(20,42,30,0.10)',
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12, shadowRadius: 10, elevation: 4,
  },
  trayFabLabel: {
    marginTop: 2,
    fontSize: 11,
    color: RunConcept.textMuted,
    fontWeight: '600',
  },

  unlockedWrap: { position: 'absolute', bottom: 0, left: 0, right: 0 },
  // R2 concept (fix 2): 3 EQUAL pale-paper circular buttons in a row with
  // labels underneath. Concept spec:
  //   • 56×56 pale paper fill (rgba white 0.94) with hairline border
  //   • Dark ink icons (#1E2A24) — no primary color hierarchy
  //   • cairn-stack.png rendered without tintColor so its natural ink shows
  actionsRow: {
    flexDirection: 'row', justifyContent: 'space-around', alignItems: 'flex-end',
    paddingHorizontal: Spacing.xl, paddingBottom: Spacing.md, paddingTop: Spacing.lg,
    gap: Spacing.sm,
  },
  actionCol: { alignItems: 'center', gap: Spacing.sm },
  actionCircleForest: {
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: 'rgba(255,255,255,0.94)',
    borderWidth: 1, borderColor: RunConcept.hairline,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08, shadowRadius: 6, elevation: 2,
  },
  actionCircleCairn: {
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: 'rgba(255,255,255,0.94)',
    borderWidth: 1, borderColor: RunConcept.hairline,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08, shadowRadius: 6, elevation: 2,
  },
  cairnGlyph: { width: 32, height: 32 },
  actionLabel: {
    fontSize: 11, fontWeight: '700', color: RunConcept.textPrimary,
    textAlign: 'center',
  },
  // O18 RUN-02: signal-lost chip (parity with Hiking).
  signalLostPill: {
    flexDirection: 'row', alignItems: 'center',
    alignSelf: 'flex-start',
    marginHorizontal: Spacing.base, marginTop: Spacing.sm,
    paddingHorizontal: Spacing.sm, paddingVertical: Spacing.xs,
    backgroundColor: 'transparent', borderRadius: Radius.chip,
    gap: 6,
  },
  signalLostDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#FFFFFF' },
  signalLostText: { fontSize: 11, fontWeight: '700', color: '#FFFFFF', letterSpacing: 0.2, textShadowColor: 'rgba(0,0,0,0.6)', textShadowRadius: 4, textShadowOffset: { width: 0, height: 1 } },
  // Toast confirmation after plant.
  plantToast: {
    alignSelf: 'center',
    backgroundColor: 'rgba(30,42,36,0.90)',
    paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm,
    borderRadius: Radius.pill,
    marginBottom: Spacing.sm,
  },
  plantToastText: { color: RunConcept.paper, fontWeight: '700', fontSize: FontSize.small },

  // Save-name sheet — lightweight local sheet co-rendered on top of R1/R2
  // when the user taps Done. Only collects an optional name; the actual
  // stopTracking + R4 transition happens in handleStop.
  saveSheetBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.28)',
    justifyContent: 'flex-end',
  },
  saveSheet: {
    backgroundColor: RunConcept.paper,
    borderTopLeftRadius: 20, borderTopRightRadius: 20,
    paddingHorizontal: Spacing.base, paddingTop: Spacing.sm,
    paddingBottom: Spacing.xxl,
    gap: Spacing.md,
    shadowColor: '#000', shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.14, shadowRadius: 22, elevation: 14,
  },
  saveSheetHandle: {
    width: 36, height: 4, borderRadius: 2,
    backgroundColor: RunConcept.hairline,
    alignSelf: 'center', marginBottom: Spacing.xs,
  },
  saveSheetTitle: {
    fontSize: FontSize.h3, fontWeight: '800', color: RunConcept.textPrimary,
    letterSpacing: -0.2, textAlign: 'center',
  },
  saveSheetInput: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1, borderColor: RunConcept.hairline,
    borderRadius: 14,
    paddingHorizontal: Spacing.base, paddingVertical: Spacing.md,
    fontSize: 16, color: RunConcept.textPrimary,
  },
  saveSheetBtn: {
    backgroundColor: RunConcept.forest, borderRadius: 28,
    height: 52, alignItems: 'center', justifyContent: 'center',
  },
  saveSheetBtnText: {
    fontSize: 17, fontWeight: '700', color: RunConcept.paper,
  },
  saveSheetCancel: { alignSelf: 'center', paddingVertical: Spacing.sm },
  saveSheetCancelText: {
    fontSize: 15, fontWeight: '600', color: RunConcept.textMuted,
  },
});

// ── Styles: R4 complete (sleep-run 2026-08-16 rev-2) ───────────────────────
// Aligned to concept R4-complete.png:
//   • Hero: full-width image with aspectRatio 16/10 (no fixed pixel height).
//   • Stat values: dark textPrimary ink — forest green is reserved for the
//     primary CTA. Labels simplified to km / time / /km.
//   • Two-CTA layout: primary "View Activity" (forest pill) + secondary
//     "Done" text link. Discard is intentionally omitted here.
const completeStyles = StyleSheet.create({
  container: { flex: 1, backgroundColor: RunConcept.paper },
  scroll: { flexGrow: 1, paddingBottom: Spacing.xl },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing.lg,
  },
  // R21 v3 (2026-08-17): backBtn removed — replaced by shared
  // <BackButton variant="inline" onPress={goHome} />. Was
  // { padding: 6 } for a bespoke icon-only 24pt ChevronLeft.
  shareBtn: {
    padding: 6,
  },
  hero: {
    width: '100%',
    aspectRatio: 16 / 10,
    marginTop: Spacing.sm,
  },
  title: {
    fontSize: 24, fontWeight: '800', color: RunConcept.textPrimary,
    textAlign: 'center', letterSpacing: -0.4,
    marginTop: Spacing.md, marginHorizontal: Spacing.xl,
  },
  statsRow: {
    flexDirection: 'row', justifyContent: 'space-between',
    marginTop: Spacing.xl, marginHorizontal: Spacing.xl,
  },
  statCell: { flex: 1, alignItems: 'center', gap: 4 },
  statVal: {
    fontSize: 30, fontWeight: '900', color: RunConcept.textPrimary,
    letterSpacing: -0.8,
  },
  statLbl: { fontSize: 12, fontWeight: '600', color: RunConcept.textMuted },
  miniMapCard: {
    marginTop: Spacing.xl,
    marginHorizontal: Spacing.xl,
    height: 130,
    borderRadius: 16,
    backgroundColor: '#EFEAE0',
    overflow: 'hidden',
  },
  feedbackCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: Spacing.md,
    marginHorizontal: Spacing.xl,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 14,
    backgroundColor: '#EFEAE0',
  },
  feedbackIcon: {
    width: 34, height: 34, borderRadius: 17,
    backgroundColor: '#E0DACB',
    alignItems: 'center', justifyContent: 'center',
  },
  feedbackTitle: {
    fontSize: 15, fontWeight: '800',
    color: RunConcept.textPrimary,
    letterSpacing: -0.2,
  },
  feedbackSubtitle: {
    fontSize: 13, fontWeight: '500',
    color: RunConcept.textMuted,
  },
  ctaGroup: {
    marginTop: Spacing.xxl, marginHorizontal: Spacing.xl, gap: Spacing.md,
  },
  primaryBtn: {
    backgroundColor: RunConcept.forest, borderRadius: 28,
    height: 56, alignItems: 'center', justifyContent: 'center',
  },
  primaryBtnText: {
    fontSize: 17, fontWeight: '700', color: RunConcept.paper,
  },
  doneBtn: { alignSelf: 'center', paddingVertical: Spacing.sm },
  doneBtnText: {
    fontSize: 15, fontWeight: '700', color: RunConcept.textMuted,
  },
});
