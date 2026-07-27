/**
 * RunningScreen — Sprint 18 premium lock screen
 *
 * States:
 * 1. Pre-start: route selection with SVG icons, animated start button
 * 2. Running — LOCKED: large elapsed time + secondary stats, pulsing GPS dot
 * 3. Running — UNLOCKED: stop/relock controls fade in
 *
 * Uses useTrackingStore (real GPS via expo-location, graceful web fallback).
 * activityMode set to 'running' before startTracking.
 */
import React, { useState, useRef, useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Animated, Easing, ScrollView,
  Platform,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useKeepAwake } from 'expo-keep-awake';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/RootNavigator';
import { useTrackingStore } from '../store/useTrackingStore';
import { useRouteStore } from '../store/useRouteStore';
import { useMarkerStore } from '../store/useMarkerStore';
import { getCurrentRegion } from '../config/regions';
import { getPrimaryMapStyle } from '../config/mapbox';
import { formatDistance, formatDuration } from '../utils/geo';
import { Colors, Spacing, Radius, FontSize, Shadow, IconSize } from '../components/tokens';
import { Icon } from '../components/Icon';
import { BackButton } from '../components/BackButton';
import { PulseDot } from '../components/PulseDot';
import { TooShortSheet } from '../components/TooShortSheet';
import { crashLogger } from '../services/crashLogger';
import { checkAnnouncements, resetAnnouncements } from '../services/navigationAnnouncer';

type Nav = NativeStackNavigationProp<RootStackParamList>;

type RunState = 'pre' | 'running' | 'stopped';

// ── Mapbox conditional import ────────────────────────────────────────────
// Lazily loaded once per app session — same pattern as HikingScreen.
// On web Mapbox modules are absent; falls back to a static placeholder.
let MapView: any = null;
let CameraComponent: any = null;
// O1 batch 34: PointAnnotation, LineLayer, ShapeSource removed — declared but never used in JSX.
let UserLocationComponent: any = null;
if (Platform.OS !== 'web') {
  try {
    const Mapbox = require('@rnmapbox/maps');
    MapView = Mapbox.MapView;
    CameraComponent = Mapbox.Camera;
    UserLocationComponent = Mapbox.UserLocation;
  } catch {
    // @rnmapbox/maps not installed in this build (Expo Go) — fallback used.
  }
}

// ── Keep-awake guard ────────────────────────────────────────────────────────
function useRunKeepAwake() {
  // Keep screen awake whenever RunningScreen is mounted
  useKeepAwake();
}

// ── Pulsing GPS dot ───────────────────────────────────────────────────────────
function PulsingDot({ active }: { active: boolean }) {
  const pulse = useRef(new Animated.Value(0.8)).current;
  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1.2, duration: 1000, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.8, duration: 1000, useNativeDriver: true }),
      ])
    ).start();
  }, []);
  return (
    <Animated.View style={[runStyles.pulsingDot, { transform: [{ scale: pulse }], backgroundColor: active ? Colors.success : Colors.textMuted }]} />
  );
}

// ── Stat item ────────────────────────────────────────────────────────────────
function StatItem({ value, label }: { value: string; label: string }) {
  return (
    <View style={runStyles.statItem}>
      <Text style={runStyles.statValue}>{value}</Text>
      <Text style={runStyles.statLabel}>{label}</Text>
    </View>
  );
}

// ── Main ────────────────────────────────────────────────────────────────────
export function RunningScreen() {
  const nav = useNavigation<Nav>();
  const routes = useRouteStore(s => s.routes);
  const loadRoutes = useRouteStore(s => s.loadRoutes);
  const [runState, setRunState] = useState<RunState>('pre');
  const [selectedRoute, setSelectedRoute] = useState<string | null>(null);
  const [showRoutePicker, setShowRoutePicker] = useState(false);
  // foregroundGranted gates UserLocation rendering on the pre-start map.
  // Without this, Mapbox UserLocation silently fails (no blue dot) and the
  // map shows the default region instead of the user's location.
  const [foregroundGranted, setForegroundGranted] = useState(false);
  const routePickerSlide = useRef(new Animated.Value(300)).current;
  const routePickerOpacity = useRef(new Animated.Value(0)).current;
  const [isLocked, setIsLocked] = useState(true);
  const [tapCount, setTapCount] = useState(0);
  const tapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Real tracking store
  const status = useTrackingStore(s => s.status);
  const durationS = useTrackingStore(s => s.durationS);
  const distanceM = useTrackingStore(s => s.distanceM);
  const locationAvailable = useTrackingStore(s => s.locationAvailable);
  const lastCoordinate = useTrackingStore(s => s.lastCoordinate);
  const sessionId = useTrackingStore(s => s.sessionId);
  const linkMarker = useTrackingStore(s => s.linkMarker);
  const setActivityMode = useTrackingStore(s => s.setActivityMode);
  const startTracking = useTrackingStore(s => s.startTracking);
  const stopTracking = useTrackingStore(s => s.stopTracking);
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

  // ── Navigation waypoint announcements ──────────────────────────────────────
  // Fire TTS when the user approaches or arrives at a waypoint that has
  // announceOnArrival=true. Only active while a run is in progress.
  // Reset announcement state when the route changes or the run ends.
  const activeWaypoints = routes.find(r => r.id === selectedRoute)?.waypoints ?? [];
  useEffect(() => {
    if (runState !== 'running' || !lastCoordinate) return;
    checkAnnouncements(lastCoordinate, activeWaypoints);
  }, [lastCoordinate, runState]);

  // Clear announcement state when selected route changes or run stops.
  useEffect(() => {
    resetAnnouncements();
  }, [selectedRoute, runState]);

  // Request foreground location permission on mount so the pre-start map's
  // UserLocation dot can render. If denied, dot is hidden but map still shows.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const Location = await import('expo-location');
        const perm = await Location.getForegroundPermissionsAsync();
        if (cancelled) return;
        let granted = perm.status === 'granted';
        if (!granted && perm.canAskAgain) {
          const ask = await Location.requestForegroundPermissionsAsync();
          if (!cancelled && ask.status === 'granted') granted = true;
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
  const controlsFade = useRef(new Animated.Value(0)).current;
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

  // Show/hide unlocked controls with animation
  useEffect(() => {
    Animated.timing(controlsFade, {
      toValue: isLocked ? 0 : 1,
      duration: 200,
      useNativeDriver: true,
    }).start();
  }, [isLocked]);

  // v118: friendly notice when a too-short run gets stopped. The session
  // is preserved by stopTracking's pre-check; "Got it" simply dismisses
  // the modal and tracking continues. The TooShortSheet element is
  // rendered at the bottom of this component.

  const onStartPressIn = () =>
    Animated.spring(startBtnScale, { toValue: 0.96, useNativeDriver: true, tension: 300, friction: 10 }).start();
  const onStartPressOut = () =>
    Animated.spring(startBtnScale, { toValue: 1, useNativeDriver: true, tension: 300, friction: 8 }).start();

  const handleScreenTap = () => {
    if (!isLocked) return;
    const newCount = tapCount + 1;
    setTapCount(newCount);
    if (tapTimer.current) clearTimeout(tapTimer.current);
    if (newCount >= 2) {
      setIsLocked(false);
      setTapCount(0);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } else {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      tapTimer.current = setTimeout(() => setTapCount(0), 500);
    }
  };

  async function handleStart() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setActivityMode('running');
    await startTracking();
    setRunState('running');
    setIsLocked(true);
  }

  function handleStop() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    // v118: stopTracking has a too-short pre-check that preserves the
    // session and sets lastStopReason='too-short'. We only transition to
    // 'stopped' if a real stop happened (status moved off tracking).
    stopTracking();
    const stillTracking = useTrackingStore.getState().status !== 'idle';
    if (!stillTracking) setRunState('stopped');
  }

  // Plant a cairn at the user's current GPS position.
  //
  // Running cairns are intentionally lower-friction than Hiking ones:
  // a runner on the move can't choose type / write a note without
  // breaking stride, so a single tap (only available AFTER unlock)
  // drops a 'scenic' cairn — the implicit "this is worth stopping for"
  // type. Per route-rules.md §7.3 the unlock barrier is the friction
  // that ensures running cairns are meaningful.
  async function handlePlantCairn() {
    if (!lastCoordinate) {
      // Should be rare — locked mode keeps GPS active. Don't throw,
      // just bail out silently with a haptic to acknowledge press.
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      return;
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    const region = getCurrentRegion();
    try {
      const marker = await addMarker({
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

  const activeRouteName = routes.find(r => r.id === selectedRoute)?.name;

  // Format display values
  const distDisplay = locationAvailable ? formatDistance(distanceM, 'km', 2) : '--';
  const durationDisplay = formatDuration(durationS);
  // Pace: min/km (seconds per meter → minutes per km)
  const paceDisplay = (() => {
    if (!locationAvailable || distanceM < 10) return '--';
    const secPerKm = durationS / (distanceM / 1000);
    const paceMin = Math.floor(secPerKm / 60);
    const paceSec = Math.round(secPerKm % 60);
    return `${paceMin}'${String(paceSec).padStart(2, '0')}"`;
  })();

  // ── Stopped state ──────────────────────────────────────────────────────────
  if (runState === 'stopped') {
    const distKm = formatDistance(distanceM, 'km', 2);

    return (
      <SafeAreaView style={preStyles.container} edges={['top', 'bottom']}>
        <View style={preStyles.header}>
          <View style={preStyles.topBar}>
            <BackButton
              variant="inline"
              onPress={() => {
                if (nav.canGoBack()) nav.goBack();
                else nav.navigate('Home' as never);
              }}
            />
            <Text style={preStyles.title}>Run Complete</Text>
            <View style={{ width: 60 }} />
          </View>
          <Text style={preStyles.subtitle}>Session saved</Text>
        </View>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.xl }}>
          <Icon name="CircleCheck" size={56} color={Colors.primary} strokeWidth={1.5} />
          <View style={preStyles.summaryCard}>
            <View style={preStyles.summaryStatRow}>
              <View style={preStyles.summaryStat}>
                <Text style={preStyles.summaryStatVal}>{distKm}</Text>
                <Text style={preStyles.summaryStatLbl}>km</Text>
              </View>
              <View style={preStyles.summaryDivider} />
              <View style={preStyles.summaryStat}>
                <Text style={preStyles.summaryStatVal}>{durationDisplay}</Text>
                <Text style={preStyles.summaryStatLbl}>elapsed</Text>
              </View>
              <View style={preStyles.summaryDivider} />
              <View style={preStyles.summaryStat}>
                <Text style={preStyles.summaryStatVal}>{paceDisplay}</Text>
                <Text style={preStyles.summaryStatLbl}>pace</Text>
              </View>
            </View>
          </View>
        </View>
        <View style={preStyles.footer}>
          <TouchableOpacity onPress={() => { setRunState('pre'); }}>
              <LinearGradient
                colors={[Colors.primary, Colors.primaryDark]}
                start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
                style={preStyles.startBtn}
              >
                <Icon name="PlayCircle" size={IconSize.md} color="#fff" strokeWidth={2} />
                <Text style={preStyles.startBtnText}>New Run</Text>
              </LinearGradient>
            </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // ── Pre-start ─────────────────────────────────────────────────────────────
  if (runState === 'pre') {
    return (
      <View style={{ flex: 1, backgroundColor: Colors.primaryBg }}>
        {/* Real Mapbox basemap (or fallback if Mapbox unavailable) */}
        {MapView ? (
          <MapView
            key={`map-${mapEpoch}`}
            style={StyleSheet.absoluteFillObject}
            styleURL={getPrimaryMapStyle()}
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
              Real Map (EAS Build)
            </Text>
            <Text style={{ fontSize: FontSize.body, color: Colors.textSecondary, textAlign: 'center' }}>
              Build with EAS to enable live tracking map
            </Text>
          </View>
        )}

        {/* Top overlay: back + GPS chip */}
        <SafeAreaView style={preStyles.topOverlay} edges={['top']} pointerEvents="box-none">
          <View style={preStyles.topRow}>
            <BackButton variant="pill" onPress={() => {
              if (nav.canGoBack()) nav.goBack();
              else nav.navigate('Home' as never);
            }} />
            <View style={preStyles.gpsChip}>
              <View style={[preStyles.gpsDot, { backgroundColor: Colors.severityWarning }]} />
              <Text style={preStyles.gpsText}>Enable GPS</Text>
            </View>
          </View>
        </SafeAreaView>

        {/* Bottom: route pill + start button */}
        <SafeAreaView style={preStyles.bottomOverlay} edges={['bottom']} pointerEvents="box-none">
          <View style={preStyles.bottomPanel}>
            {/* Route selector pill — card style */}
            <TouchableOpacity style={preStyles.routePill} onPress={openRoutePicker} activeOpacity={0.85}>
              <View style={preStyles.routePillIcon}>
                <Icon name={selectedRoute ? 'Route' : 'Target'} size={20} color={Colors.running} strokeWidth={1.8} />
              </View>
              <View style={preStyles.routePillTextGroup}>
                <Text style={preStyles.routePillText} numberOfLines={1}>{selectedRouteName}</Text>
                <Text style={preStyles.routePillHint}>Tap to change route</Text>
              </View>
              <Icon name="ChevronUp" size={16} color={Colors.running} strokeWidth={2.5} />
            </TouchableOpacity>

            {/* Start button row */}
            <View style={preStyles.bottomRow}>
              <Animated.View style={[{ flex: 1, height: 56 }, { transform: [{ scale: startBtnScale }] }]}>
                <TouchableOpacity
                  activeOpacity={1}
                  onPress={handleStart}
                  onPressIn={onStartPressIn}
                  onPressOut={onStartPressOut}
                >
                  <LinearGradient
                    colors={[Colors.primary, Colors.primaryDark]}
                    start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
                    style={preStyles.startBtn}
                  >
                    <Icon name="Play" size={IconSize.sm} color="#fff" strokeWidth={2.5} />
                    <Text style={preStyles.startBtnText}>Start Running</Text>
                  </LinearGradient>
                </TouchableOpacity>
              </Animated.View>
            </View>
            <View style={preStyles.lockHintRow}>
              <Icon name="Lock" size={14} color={Colors.textMuted} strokeWidth={2} />
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
                  <View style={[preStyles.routePickerBadge, { backgroundColor: Colors.runningLight }]}>
                    <Icon name="Target" size={16} color={Colors.running} strokeWidth={2} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={preStyles.routePickerName}>Free Run</Text>
                    <Text style={preStyles.routePickerMeta}>No route · explore freely</Text>
                  </View>
                  {selectedRoute === null && <Icon name="Check" size={16} color={Colors.running} strokeWidth={2.5} />}
                </TouchableOpacity>

                {/* Saved routes */}
                {routes.map(r => (
                  <TouchableOpacity
                    key={r.id}
                    style={[preStyles.routePickerRow, selectedRoute === r.id && preStyles.routePickerRowSelected]}
                    onPress={() => pickRoute(r.id)}
                    activeOpacity={0.8}
                  >
                    <View style={[preStyles.routePickerBadge, { backgroundColor: Colors.runningLight }]}>
                      <Icon name="Route" size={16} color={Colors.running} strokeWidth={2} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={preStyles.routePickerName}>{r.name}</Text>
                      <Text style={preStyles.routePickerMeta}>
                        {(r.distanceM / 1000).toFixed(1)} km
                        {r.elevationGainM > 0 ? ` · ↑${Math.round(r.elevationGainM)}m` : ''}
                        {r.runCount > 0 ? ` · ${r.runCount}× done` : ''}
                      </Text>
                    </View>
                    {selectedRoute === r.id && <Icon name="Check" size={16} color={Colors.running} strokeWidth={2.5} />}
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </Animated.View>
          </Animated.View>
        )}
      </View>
    );
  }

  // ── Running (locked + unlocked) ───────────────────────────────────────────
  return (
    <View style={runStyles.container}>
      <TouchableOpacity
        style={StyleSheet.absoluteFillObject}
        onPress={handleScreenTap}
        activeOpacity={1}
      >
        <View style={runStyles.bg}>
          {/* Stats bar */}
          <SafeAreaView edges={['top']}>
            <View style={runStyles.statsBar}>
              <StatItem value={distDisplay} label="km" />
              <StatItem value={durationDisplay} label="elapsed" />
              <StatItem value={paceDisplay} label="pace" />
              <View style={[runStyles.statItem, { justifyContent: 'center' }]}>
                <PulseDot
                  size={8}
                  color={locationAvailable ? Colors.success : Colors.textMuted}
                  pulsing={locationAvailable}
                />
                <Text style={runStyles.statLabel}>{locationAvailable ? 'GPS' : 'Offline'}</Text>
              </View>
            </View>
          </SafeAreaView>

          {/* Compass area */}
          <View style={runStyles.compassArea}>
            <View style={runStyles.compassRing}>
              <Icon name="Navigation" size={72} color={Colors.primary} strokeWidth={1.5} />
              <Text style={runStyles.compassDir}>Keep going</Text>
            </View>
            {activeRouteName && (
              <Text style={runStyles.routeLabel}>{activeRouteName}</Text>
            )}
          </View>

          {/* Lock indicator — premium lock screen */}
          {isLocked && (
            <View style={runStyles.lockScreen}>
              {/* GPS pulsing indicator */}
              <PulsingDot active={locationAvailable} />
              {/* Primary stat: elapsed */}
              <Text style={runStyles.lockPrimary}>{durationDisplay}</Text>
              {/* Secondary row */}
              <View style={runStyles.lockSecondary}>
                <Text style={runStyles.lockSecStat}>{distDisplay} <Text style={runStyles.lockSecUnit}>km</Text></Text>
                <View style={runStyles.lockSecDivider} />
                <Text style={runStyles.lockSecStat}>{paceDisplay} <Text style={runStyles.lockSecUnit}>min/km</Text></Text>
              </View>
              {/* Hint */}
              <Text style={runStyles.lockText}>Double-tap to unlock</Text>
              <View style={runStyles.tapDots}>
                {[0, 1].map(i => (
                  <View key={i} style={[runStyles.tapDot, i < tapCount && runStyles.tapDotActive]} />
                ))}
              </View>
            </View>
          )}

          {/* Unlocked controls — fade in */}
          <Animated.View style={[runStyles.unlockedWrap, { opacity: controlsFade }]} pointerEvents={isLocked ? 'none' : 'box-none'}>
            <SafeAreaView edges={['bottom']}>
              <View style={runStyles.unlockedRow}>
                <TouchableOpacity
                  style={runStyles.stopBtn}
                  onPress={handleStop}
                >
                  <Icon name="Square" size={IconSize.sm} color="#fff" strokeWidth={2.5} />
                  <Text style={runStyles.stopBtnText}>Stop</Text>
                </TouchableOpacity>
                {/* Plant Cairn — middle position. Only reachable after
                    unlock, which is the deliberate friction that keeps
                    running cairns meaningful (see route-rules.md §7.3). */}
                <TouchableOpacity
                  style={runStyles.plantBtn}
                  onPress={handlePlantCairn}
                  disabled={!locationAvailable}
                >
                  <Icon name="MapPin" size={IconSize.sm} color="#fff" strokeWidth={2.5} />
                  <Text style={runStyles.plantBtnText}>Plant</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={runStyles.relockBtn}
                  onPress={() => setIsLocked(true)}
                >
                  <Icon name="Lock" size={IconSize.sm} color="rgba(255,255,255,0.8)" strokeWidth={2} />
                  <Text style={runStyles.relockText}>Lock</Text>
                </TouchableOpacity>
              </View>
              {plantToast && (
                <View style={runStyles.plantToast}>
                  <Text style={runStyles.plantToastText}>{plantToast}</Text>
                </View>
              )}
            </SafeAreaView>
          </Animated.View>
        </View>
      </TouchableOpacity>

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
          setRunState('stopped');
        }}
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

  // New compact layout
  bottomPanel: { paddingHorizontal: Spacing.base, paddingBottom: Spacing.xs, gap: Spacing.sm },
  routePill: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    backgroundColor: 'rgba(255,255,255,0.97)', borderRadius: Radius.card,
    padding: Spacing.md,
    borderWidth: 1.5, borderColor: Colors.running + '40',
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.10, shadowRadius: 14, elevation: 5,
  },
  routePillIcon: {
    width: 44, height: 44, borderRadius: 12,
    backgroundColor: Colors.runningLight, alignItems: 'center', justifyContent: 'center',
  },
  routePillTextGroup: { flex: 1, gap: 1 },
  routePillText: { fontSize: FontSize.body, fontWeight: '600', color: Colors.textPrimary },
  routePillHint: { fontSize: FontSize.small, color: Colors.running, fontWeight: '500' },
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
  routePickerTitle: { fontSize: FontSize.caption, fontWeight: '700', color: Colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 4 },
  routePickerRow: {
    backgroundColor: 'rgba(255,255,255,0.92)', borderRadius: Radius.card,
    flexDirection: 'row', alignItems: 'center',
    padding: Spacing.base, gap: Spacing.md,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.4)',
    borderLeftWidth: 3, borderLeftColor: 'transparent',
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.08, shadowRadius: 12, elevation: 4,
  },
  routePickerRowSelected: { borderLeftColor: Colors.running, backgroundColor: Colors.runningCardBg, borderColor: Colors.runningBorder },
  routePickerBadge: {
    width: 44, height: 44, borderRadius: 12,
    backgroundColor: Colors.runningLight,
    alignItems: 'center', justifyContent: 'center',
  },
  routePickerName: { fontSize: FontSize.body, fontWeight: '600', color: Colors.textPrimary },
  routePickerMeta: { fontSize: FontSize.small, color: Colors.textSecondary, marginTop: 2 },

  footer: { padding: Spacing.xl, gap: Spacing.sm },
  startBtn: {
    borderRadius: Radius.pill,
    height: 60, alignItems: 'center',
    flexDirection: 'row', gap: Spacing.sm, justifyContent: 'center',
  },
  startBtnText: { color: '#fff', fontWeight: '700', fontSize: FontSize.body },
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

// ── Styles: running ─────────────────────────────────────────────────────────
const runStyles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.runningBg },
  bg: { flex: 1, backgroundColor: Colors.runningBg },

  statsBar: {
    flexDirection: 'row', paddingHorizontal: Spacing.xl,
    paddingTop: Spacing.md, paddingBottom: Spacing.sm,
    borderBottomWidth: 1, borderBottomColor: Colors.runningBorder,
    gap: Spacing.base,
  },
  statItem: { flex: 1, alignItems: 'center' },
  statValue: { fontSize: FontSize.h2, fontWeight: '800', color: Colors.runningText, letterSpacing: -0.5, fontVariant: ['tabular-nums'] },
  statLabel: { fontSize: FontSize.tiny, color: 'rgba(255,255,255,0.4)', marginTop: 2, letterSpacing: 0.5 },
  // O1 batch 34: gpsIndicator removed — superseded by PulseDot component (0 JSX references).

  compassArea: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.lg },
  compassRing: {
    width: 220, height: 220, borderRadius: 110,
    borderWidth: 1.5, borderColor: 'rgba(93,124,70,0.4)',
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: Colors.primaryBg,
    gap: Spacing.sm,
  },
  compassDir: {
    fontSize: FontSize.small, color: 'rgba(255,255,255,0.55)',
    letterSpacing: 2, textTransform: 'uppercase',
  },
  routeLabel: {
    fontSize: FontSize.small, color: 'rgba(255,255,255,0.35)',
    textAlign: 'center', paddingHorizontal: Spacing.xl,
  },

  lockScreen: {
    alignItems: 'center', paddingBottom: 60, gap: Spacing.md,
  },
  lockPrimary: {
    fontSize: 60, fontWeight: '200', color: '#ffffff',
    letterSpacing: -2, lineHeight: 68,
  },
  lockSecondary: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.lg,
  },
  lockSecStat: {
    fontSize: 20, fontWeight: '300', color: 'rgba(255,255,255,0.85)',
  },
  lockSecUnit: {
    fontSize: 13, fontWeight: '400', color: 'rgba(255,255,255,0.5)',
  },
  lockSecDivider: {
    width: 1, height: 20, backgroundColor: 'rgba(255,255,255,0.2)',
  },
  pulsingDot: {
    width: 14, height: 14, borderRadius: 7, marginBottom: Spacing.sm,
  },
  lockText: { fontSize: FontSize.caption, color: 'rgba(255,255,255,0.4)' },
  tapDots: { flexDirection: 'row', gap: Spacing.md, marginTop: 4 },
  tapDot: {
    width: 10, height: 10, borderRadius: 5,
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.25)',
  },
  tapDotActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },

  unlockedWrap: { position: 'absolute', bottom: 0, left: 0, right: 0 },
  unlockedRow: { flexDirection: 'row', gap: Spacing.sm, paddingHorizontal: Spacing.xl, paddingBottom: Spacing.lg },
  stopBtn: {
    flex: 2, backgroundColor: Colors.danger, borderRadius: Radius.button,
    paddingVertical: Spacing.lg, alignItems: 'center',
    flexDirection: 'row', gap: Spacing.sm, justifyContent: 'center',
    ...Shadow.fab,
  },
  stopBtnText: { color: '#fff', fontWeight: '800', fontSize: FontSize.h3 },
  relockBtn: {
    flex: 1, borderRadius: Radius.button, paddingVertical: Spacing.lg,
    alignItems: 'center', justifyContent: 'center',
    flexDirection: 'row', gap: Spacing.xs,
    borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.3)',
    backgroundColor: 'rgba(255,255,255,0.07)',
  },
  relockText: { color: 'rgba(255,255,255,0.7)', fontWeight: '700', fontSize: FontSize.caption },
  // Plant cairn button — middle of the unlocked row, primary running
  // accent. Sits between Stop (danger) and Lock (subtle).
  plantBtn: {
    flex: 1.4, backgroundColor: Colors.running, borderRadius: Radius.button,
    paddingVertical: Spacing.lg, alignItems: 'center', justifyContent: 'center',
    flexDirection: 'row', gap: Spacing.xs,
    ...Shadow.fab,
  },
  plantBtnText: { color: '#fff', fontWeight: '800', fontSize: FontSize.body },
  // Toast confirmation after plant. Floats above the bottom safe area
  // so users see it without obscuring the controls.
  plantToast: {
    alignSelf: 'center',
    backgroundColor: 'rgba(0,0,0,0.85)',
    paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm,
    borderRadius: Radius.pill,
    marginBottom: Spacing.sm,
  },
  plantToastText: { color: '#fff', fontWeight: '700', fontSize: FontSize.small },
});
