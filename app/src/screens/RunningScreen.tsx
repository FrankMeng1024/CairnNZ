/**
 * RunningScreen — sleep-run 2026-08-16 rev-2 (Hiking-parity)
 *
 * States:
 * 1. Pre-start (R0): route selection card + full-width Start Running pill
 * 2. Running (R1 + R2): map + polyline + top stats bar; persistent 3-button
 *    action tray (Pause / Cairn / Done). No lock overlay, no compass ring.
 * 3. Save-name sheet: freezes recording, collects an optional name, saves
 *    through the shared Activity lifecycle, then opens Activity Detail.
 *
 * Uses useTrackingStore (real GPS via expo-location, graceful web fallback).
 * activityMode set to 'running' before startTracking.
 */
import React, { useState, useRef, useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Animated, Easing, ScrollView,
  Platform, TextInput, KeyboardAvoidingView, Keyboard,
} from 'react-native';
import { haptic } from '../services/hapticService';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useFocusEffect, useIsFocused, CommonActions } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/RootNavigator';
import { useTrackingStore } from '../store/useTrackingStore';
import { useAppStore } from '../store/useAppStore';
import { useRouteStore } from '../store/useRouteStore';
import { useMarkerStore } from '../store/useMarkerStore';
import { getCurrentRegion } from '../config/regions';
import { formatDuration } from '../utils/geo';
import { useDistance } from '../utils/distanceFormat';
import { Colors, Spacing, Radius, FontSize, Shadow } from '../components/tokens';
import { Icon } from '../components/Icon';
import { BackButton } from '../components/BackButton';
import { useAppearance } from '../hooks/useAppearance';
import { useVisualTheme } from '../hooks/useVisualTheme';
import { PulseDot } from '../components/PulseDot';
import { TooShortSheet } from '../components/TooShortSheet';
import { PermissionDeniedModal } from '../components/PermissionDeniedModal';
import { UnfinishedRecoveryModal } from '../components/UnfinishedRecoveryModal';
import { crashLogger } from '../services/crashLogger';
import {
  deriveActivityOperationalState,
  isActivitySessionVisible,
} from '../features/activity/activityOperationalState';
import { saveEligibility } from '../features/activity/activityContracts';
import {
  findRecoverableActivity,
  restoreRecoverableActivity,
  saveRecoverableActivity,
  discardRecoverableActivity,
  type RecoverableActivity,
} from '../features/activity/activityRecovery';
import { useActivitySaveLossRecovery } from '../features/activity/useActivitySaveLossRecovery';
import { useSettingsStore } from '../store/useSettingsStore';
import { activitySimulatorBuildCapable } from '../features/activitySimulator/capability';
import { ActivitySimulatorPanel } from '../features/activitySimulator/ActivitySimulatorPanel';
import {
  initializeFreshSimulatorSetupForActivityEntry,
  useActivitySimulatorStore,
} from '../features/activitySimulator/useActivitySimulatorStore';
import { activityFreshnessNow } from '../features/activitySimulator/simulatorTime';
import { appendSimulatorLog } from '../features/activitySimulator/simulatorLog';
import { useSimulatorKeepAwake } from '../features/activitySimulator/useSimulatorKeepAwake';
import { resolveSimulatorControlsVisible, resolveSimulatorMapState } from '../features/activitySimulator/simulatorMapState';
import { HikingMap } from './HikingMap';

type Nav = NativeStackNavigationProp<RootStackParamList>;

type RunState = 'pre' | 'running';

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
function StatItem({ value, label, title }: { value: string; label: string; title: string }) {
  const theme = useVisualTheme();
  return (
    <View style={runStyles.statItem}>
      <Text style={[runStyles.statLabel, { color: theme.muted }]}>{title}</Text>
      <Text style={[runStyles.statValue, { color: theme.foreground }]} numberOfLines={1}>
        {value}
        {label ? <Text style={[runStyles.statUnit, { color: theme.foregroundSecondary }]}> {label}</Text> : null}
      </Text>
    </View>
  );
}


// ── Main ────────────────────────────────────────────────────────────────────
export function RunningScreen() {
  const simulatorOwnerUserId = useAppStore((s) => s.user?.id ?? null);
  const simulatorHydratedUserId = useActivitySimulatorStore((s) => s.hydratedUserId);
  const nav = useNavigation<Nav>();
  const isFocused = useIsFocused();
  const routes = useRouteStore(s => s.routes);
  const loadRoutes = useRouteStore(s => s.loadRoutes);
  const [runState, setRunState] = useState<RunState>('pre');
  const [unfinishedRun, setUnfinishedRun] = useState<RecoverableActivity | null>(null);
  const [unfinishedResolutionRequested, setUnfinishedResolutionRequested] = useState(false);
  // R21 (2026-08-18): dark theme parity with Hiking. Run tray + top pills
  // + Recenter FAB honour Settings Appearance so day/night reads the same.
  const { isDark: runIsDark } = useAppearance();
  const runTheme = useVisualTheme();
  const debugMode = useSettingsStore(state => state.debugMode);
  const simulatorEnabled = useActivitySimulatorStore(state => state.enabled);
  const simulatorStartConfigured = useActivitySimulatorStore(state => state.startConfigured);
  const simulatorPosition = useActivitySimulatorStore(state => state.current);
  const simulatorSignal = useActivitySimulatorStore(state => state.signal);
  const simulatorVirtualTimestamp = useActivitySimulatorStore(state => state.virtualTimestampMs);
  const simulatorPickerMode = useActivitySimulatorStore(state => state.pickerMode);
  useFocusEffect(
    React.useCallback(() => {
      if (
        !activitySimulatorBuildCapable
        || !debugMode
        || !simulatorEnabled
        || !simulatorOwnerUserId
        || simulatorHydratedUserId !== String(simulatorOwnerUserId)
      ) return undefined;
      void initializeFreshSimulatorSetupForActivityEntry(String(simulatorOwnerUserId)).then(result => {
        appendSimulatorLog('SIM_SESSION', 'simulator_fresh_setup_entry', {
          screen: 'run',
          result,
        }, { coordinateSource: 'none' });
      });
      return undefined;
    }, [debugMode, simulatorEnabled, simulatorHydratedUserId, simulatorOwnerUserId]),
  );
  // R21 (2026-08-18 user "点击 向右侧展开"): tracking action tray is
  // collapsed by default. Tap the Navigation anchor (bottom-left) to
  // expand → Pause / Cairn / Finish slides out to the right.
  const [runActionsExpanded, setRunActionsExpanded] = useState(false);
  // R21 (2026-08-18 user "finish如果too short现在没任何提示"): local guard
  // — Finish button surfaces TooShortSheet directly instead of racing
  // with stopTracking's lastStopReason pathway.
  const [showTooShortConfirmRun, setShowTooShortConfirmRun] = useState(false);
  // R21 (2026-08-18): follow-camera state so Recenter FAB is only shown
  // when the user has dragged the map off-position.
  const [runFollowUser, setRunFollowUser] = useState(true);
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
  const finishPausedBySheet = useRef(false);
  const saveSheetSlide = useRef(new Animated.Value(300)).current;
  const saveSheetOpacity = useRef(new Animated.Value(0)).current;

  // Real tracking store
  const status = useTrackingStore(s => s.status);
  const locationProviderSource = useTrackingStore(s => s.locationProviderSource);
  useSimulatorKeepAwake(
    activitySimulatorBuildCapable
      && debugMode
      && locationProviderSource === 'simulator'
      && status !== 'idle',
  );
  const showSimulator = resolveSimulatorControlsVisible(
    activitySimulatorBuildCapable,
    debugMode,
    simulatorEnabled,
    locationProviderSource,
    status,
  );
  const isFinishing = useTrackingStore(s => s.isFinishing);
  const startError = useTrackingStore(s => s.startError);
  const durationS = useTrackingStore(s => s.durationS);
  const activityStartedAt = useTrackingStore(s => s.startedAt);
  const distanceM = useTrackingStore(s => s.distanceM);
  const locationAvailable = useTrackingStore(s => s.locationAvailable);
  const lastCoordinate = useTrackingStore(s => s.lastCoordinate);
  const {
    simulatorLocationAuthoritative,
    displayPosition: mapDisplayPosition,
  } = resolveSimulatorMapState({
    controlsVisible: showSimulator,
    startConfigured: simulatorStartConfigured,
    trackingStatus: status,
    providerSource: locationProviderSource,
    virtualPosition: simulatorPosition,
    acceptedPosition: lastCoordinate,
  });
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

  const operationalState = deriveActivityOperationalState({
    trackingStatus: status,
    isFinishing,
    hasRecovery: unfinishedRun !== null,
    hasCompletedSummary: false,
    hasStartError: startError !== null,
  });
  useActivitySaveLossRecovery('running');

  useEffect(() => {
    if (!isFocused) return undefined;
    appendSimulatorLog('SCREEN', 'run_opened', {
      debugMode,
      simulatorEnabled,
      trackingStatus: status,
      providerSource: locationProviderSource,
    }, { coordinateSource: 'none' });
    return () => appendSimulatorLog('SCREEN', 'run_closed', {}, { coordinateSource: 'none' });
  }, [isFocused]);

  useEffect(() => { loadRoutes(); }, []);

  // The writer stores both modes under one global unfinished-Activity rule.
  // Discover that record even when it is a Hike: attempting to Start Run must
  // resolve the previous Activity before a new GPS owner can be created.
  useFocusEffect(
    React.useCallback(() => {
      if (useTrackingStore.getState().status !== 'idle') return undefined;
      let cancelled = false;
      void findRecoverableActivity('running').then(activity => {
        if (!cancelled) setUnfinishedRun(activity);
      });
      return () => { cancelled = true; };
    }, [status]),
  );
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
        if (simulatorLocationAuthoritative) {
          if (!cancelled) {
            setForegroundGranted(true);
            setPermissionBlocked(false);
          }
          return;
        }
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
  }, [simulatorLocationAuthoritative]);

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
  useFocusEffect(React.useCallback(() => {
    setRunFollowUser(true);
    return undefined;
  }, []));

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
  const openSaveSheet = async () => {
    // Freeze GPS, active time and metrics before naming/review. If this run
    // was already manually paused, cancelling the sheet must leave it paused.
    finishPausedBySheet.current = useTrackingStore.getState().status === 'tracking';
    if (finishPausedBySheet.current) await pauseTracking();
    setShowSaveSheet(true);
    Animated.parallel([
      Animated.timing(saveSheetSlide, { toValue: 0, duration: 260, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.timing(saveSheetOpacity, { toValue: 1, duration: 200, easing: Easing.out(Easing.ease), useNativeDriver: true }),
    ]).start();
  };
  const closeSaveSheet = (then?: () => void, restoreRecording = true) => {
    Keyboard.dismiss();
    Animated.parallel([
      Animated.timing(saveSheetSlide, { toValue: 300, duration: 220, easing: Easing.in(Easing.quad), useNativeDriver: true }),
      Animated.timing(saveSheetOpacity, { toValue: 0, duration: 180, easing: Easing.in(Easing.ease), useNativeDriver: true }),
    ]).start(() => {
      setShowSaveSheet(false);
      if (restoreRecording && finishPausedBySheet.current) resumeTracking();
      finishPausedBySheet.current = false;
      then?.();
    });
  };

  async function handleStart() {
    haptic.impact('medium');
    if (unfinishedRun) {
      setUnfinishedResolutionRequested(true);
      return;
    }
    setActivityMode('running');
    const started = await startTracking();
    if (started) {
      setRunState('running');
    } else {
      const authoritative = await findRecoverableActivity('running');
      if (authoritative) {
        setUnfinishedRun(authoritative);
        setUnfinishedResolutionRequested(true);
      }
    }
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
    const saved = await stopTracking(trimmed);
    const stillTracking = useTrackingStore.getState().status !== 'idle';
    const stopReason = useTrackingStore.getState().lastStopReason;
    if (saved && !stillTracking && capturedId) {
      setPendingName('');
      nav.dispatch(
        CommonActions.reset({
          index: 2,
          routes: [
            { name: 'Home' },
            { name: 'Routes', params: { initialTab: 'activities' } },
            { name: 'MapHistory', params: { sessionId: capturedId } },
          ],
        }),
      );
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
    const freshnessNow = locationProviderSource === 'simulator'
      ? simulatorVirtualTimestamp
      : activityFreshnessNow(locationProviderSource);
    const acceptedFixIsFresh = lastCoordinate
      && useTrackingStore.getState().lastCoordinateTime !== null
      && freshnessNow - Number(useTrackingStore.getState().lastCoordinateTime) <= 30_000;
    if (!acceptedFixIsFresh || (locationProviderSource === 'simulator' && simulatorSignal === 'lost')) {
      // Should be rare — locked mode keeps GPS active. Don't throw,
      // just bail out silently with a haptic to acknowledge press.
      haptic.notification('warning');
      setPlantToast('Current GPS location unavailable');
      setTimeout(() => setPlantToast(null), 2000);
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
      appendSimulatorLog('ACTIVITY_STATE', 'run_quick_cairn_location_selected', {
        locationSource: locationProviderSource === 'simulator' ? 'last-canonically-accepted-simulator' : 'last-canonically-accepted-real',
        acceptedFixTimestamp: useTrackingStore.getState().lastCoordinateTime,
      }, {
        clientActivityId: sessionId,
        coordinateSource: locationProviderSource === 'simulator' ? 'simulator' : 'real',
        virtualTimestamp: locationProviderSource === 'simulator' ? simulatorVirtualTimestamp : null,
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
  const freshnessNow = locationProviderSource === 'simulator'
    ? simulatorVirtualTimestamp
    : activityFreshnessNow(locationProviderSource);
  const freshnessReference = lastTrackT ?? activityStartedAt;
  const signalLostFor = freshnessReference != null ? Math.max(0, freshnessNow - freshnessReference) : 0;
  const signalLost = status === 'tracking' && freshnessReference != null && signalLostFor > RUN_SIGNAL_GAP_MS;
  const signalLostMin = Math.floor(signalLostFor / 60_000);
  const gpsFixHealthy = status === 'tracking' && locationAvailable && lastTrackT !== null && !signalLost;
  const simulatorGpsActive = status === 'tracking' && locationProviderSource === 'simulator';
  const gpsStatusLabel = simulatorGpsActive
    ? ({ normal: '正常', poor: '较差', lost: '丢失', frozen: '卡住' } as const)[simulatorSignal]
    : gpsFixHealthy ? 'GPS' : 'Waiting';
  const gpsStatusColor = simulatorGpsActive
    ? simulatorSignal === 'normal' ? runTheme.iconActive
      : simulatorSignal === 'poor' ? Colors.severityWarning
        : simulatorSignal === 'lost' ? Colors.danger
          : Colors.info
    : gpsFixHealthy ? runTheme.iconActive : runTheme.iconInactive;
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

  // One native Mapbox owner spans pre-start and Tracking. Activity/provider
  // transitions update layers and camera targets; they never replace the map.
  const runMapSurface = (
    <View key="run-map-surface" style={StyleSheet.absoluteFillObject}>
      <HikingMap
        markers={[]}
        trackPoints={trackPoints}
        onMarkerPress={() => {}}
        userPos={mapDisplayPosition}
        trackStartVariant={isActivitySessionVisible(operationalState) ? 'run' : null}
        activityVariant="run"
        instantCamera={simulatorLocationAuthoritative}
        followUser={runFollowUser}
        onUserGesture={() => setRunFollowUser(false)}
        simulatorEnabled={simulatorLocationAuthoritative}
        simulatorControlsEnabled={showSimulator}
        simulatorCenterPickerVisible={showSimulator && (status === 'idle' || simulatorPickerMode !== null)}
      />
    </View>
  );

  // ── Pre-start ─────────────────────────────────────────────────────────────
  if (!isActivitySessionVisible(operationalState)) {
    return (
      <View style={{ flex: 1, backgroundColor: runTheme.background }}>
        {runMapSurface}

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
          <View style={[preStyles.statsStrip, { backgroundColor: runTheme.mapOverlay, borderColor: runTheme.border }]} pointerEvents="none">
            <Text style={[preStyles.statsStripKm, runIsDark ? { color: runTheme.foreground } : null]}>0.00 {dist.unit}</Text>
            <Text style={[preStyles.statsStripTime, runIsDark ? { color: runTheme.foreground } : null]}>00:00</Text>
            <Text style={[preStyles.statsStripPace, runIsDark ? { color: runTheme.foreground } : null]}>{`--'--"/${dist.unit}`}</Text>
            <View style={preStyles.statsStripGpsWrap}>
              <View style={[preStyles.statsStripGpsDot, { backgroundColor: permissionBlocked ? Colors.severityWarning : RunConcept.forest }]} />
              <Text style={[preStyles.statsStripGpsText, runIsDark ? { color: runTheme.foreground } : null]}>GPS</Text>
            </View>
          </View>
        </SafeAreaView>

        {/* Bottom: FREE RUN card + Route row + green Start Running (R0 concept) */}
        <SafeAreaView style={preStyles.bottomOverlay} edges={['bottom']} pointerEvents="box-none">
          <View style={[preStyles.bottomPanel, { backgroundColor: runTheme.mapOverlay, borderColor: runTheme.border, shadowColor: runTheme.shadow }]}>
            {/* FREE RUN card — 2026-08-17 concept R0: compass/target
                glyph on the left, eyebrow + sub in the middle, chevron
                on the right. Compass matches the "Run anywhere" story
                and echoes the R0 map orientation cue. */}
            <TouchableOpacity style={[preStyles.freeRunCard, runIsDark ? { backgroundColor: runTheme.surfaceElevated, borderColor: runTheme.border } : null]} onPress={openRoutePicker} activeOpacity={0.9}>
              <View style={preStyles.freeRunGlyph}>
                <Icon name="Target" size={22} color={runIsDark ? runTheme.iconActive : RunConcept.textPrimary} strokeWidth={2} />
              </View>
              <View style={preStyles.freeRunTextGroup}>
                <Text style={[preStyles.freeRunEyebrow, runIsDark ? { color: runTheme.foreground } : null]}>FREE RUN</Text>
                <Text style={[preStyles.freeRunSub, runIsDark ? { color: runTheme.foregroundSecondary } : null]}>Run anywhere</Text>
              </View>
              <Icon name="ChevronUp" size={20} color={runIsDark ? runTheme.iconInactive : RunConcept.textMuted} strokeWidth={2} />
            </TouchableOpacity>

            {/* Route row — separate line per concept */}
            <TouchableOpacity style={[preStyles.routeRow, runIsDark ? { backgroundColor: runTheme.surface, borderColor: runTheme.border } : null]} onPress={openRoutePicker} activeOpacity={0.9}>
              <Text style={[preStyles.routeRowText, runIsDark ? { color: runTheme.foreground } : null]}>Route: {selectedRoute ? selectedRouteName : 'None'}</Text>
              <Icon name="ChevronRight" size={18} color={runIsDark ? runTheme.iconInactive : RunConcept.textMuted} strokeWidth={2} />
            </TouchableOpacity>

            {/* Start Running — full-width forest-green pill */}
            <Animated.View style={{ transform: [{ scale: startBtnScale }] }}>
              <TouchableOpacity
                activeOpacity={0.92}
                onPress={handleStart}
                disabled={operationalState === 'starting'}
                onPressIn={onStartPressIn}
                onPressOut={onStartPressOut}
                style={[preStyles.startBtn, runIsDark ? { backgroundColor: runTheme.primary } : null]}
              >
                <Text style={[preStyles.startBtnText, runIsDark ? { color: runTheme.onPrimary } : null]}>
                  {operationalState === 'starting' ? 'Starting…' : 'Start Running'}
                </Text>
              </TouchableOpacity>
            </Animated.View>
            {startError ? (
              <Text style={[preStyles.startFailureText, { color: runTheme.destructive }]} accessibilityRole="alert">
                {startError === 'permission-denied'
                  ? 'Location permission is needed to start.'
                  : 'Couldn’t start GPS. Check your location settings and try again.'}
              </Text>
            ) : null}
            {/* 2026-08-17 concept R0: tiny lock hint below Start Running.
                Reassures the user that the phone screen auto-locks so they
                can stash the device in a pocket without worrying about
                accidental input during the run. */}
            <View style={preStyles.lockHintRow}>
              <Icon name="Lock" size={11} color={runIsDark ? runTheme.muted : Colors.textMuted} strokeWidth={2} />
              <Text style={[preStyles.lockHint, runIsDark ? { color: runTheme.muted } : null]}>Screen locks automatically</Text>
            </View>
          </View>
        </SafeAreaView>

        {/* Route picker sheet */}
        {showRoutePicker && (
          <Animated.View style={[preStyles.routePickerBackdrop, { opacity: routePickerOpacity }]}>
            <TouchableOpacity style={StyleSheet.absoluteFillObject} onPress={closeRoutePicker} activeOpacity={1} />
            <Animated.View style={[preStyles.routePickerSheet, { backgroundColor: runTheme.surfaceElevated, borderTopColor: runTheme.border, transform: [{ translateY: routePickerSlide }] }]}>
              <View style={[preStyles.routePickerHandle, { backgroundColor: runTheme.border }]} />
              <Text style={[preStyles.routePickerTitle, { color: runTheme.muted }]}>Choose a route</Text>
              <ScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: 280 }} contentContainerStyle={{ gap: Spacing.sm }}>
                {/* Free Run */}
                <TouchableOpacity
                  style={[
                    preStyles.routePickerRow,
                    { backgroundColor: runTheme.surface, borderColor: runTheme.border },
                    selectedRoute === null && { backgroundColor: runTheme.surfaceElevated, borderColor: runTheme.primary },
                  ]}
                  onPress={() => pickRoute(null)}
                  activeOpacity={0.8}
                >
                  <View style={[preStyles.routePickerBadge, { backgroundColor: runTheme.surfaceElevated }]}>
                    <Icon name="Target" size={16} color={runTheme.iconActive} strokeWidth={2} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[preStyles.routePickerName, { color: runTheme.foreground }]}>Free Run</Text>
                    <Text style={[preStyles.routePickerMeta, { color: runTheme.foregroundSecondary }]}>No route · explore freely</Text>
                  </View>
                  {selectedRoute === null && <Icon name="Check" size={16} color={runTheme.iconActive} strokeWidth={2.5} />}
                </TouchableOpacity>

                {/* Saved routes */}
                {routes.map(r => (
                  <TouchableOpacity
                    key={r.id}
                    style={[
                      preStyles.routePickerRow,
                      { backgroundColor: runTheme.surface, borderColor: runTheme.border },
                      selectedRoute === r.id && { backgroundColor: runTheme.surfaceElevated, borderColor: runTheme.primary },
                    ]}
                    onPress={() => pickRoute(r.id)}
                    activeOpacity={0.8}
                  >
                    <View style={[preStyles.routePickerBadge, { backgroundColor: runTheme.surfaceElevated }]}>
                      <Icon name="Route" size={16} color={runTheme.iconActive} strokeWidth={2} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[preStyles.routePickerName, { color: runTheme.foreground }]}>{r.name}</Text>
                      <Text style={[preStyles.routePickerMeta, { color: runTheme.foregroundSecondary }]}>
                        {dist.format(r.distanceM, 1)} {dist.unit}
                        {r.elevationGainM > 0 ? ` · ↑${dist.formatElevation(r.elevationGainM)}${dist.elevUnit}` : ''}
                        {r.runCount > 0 ? ` · ${r.runCount}× done` : ''}
                      </Text>
                    </View>
                    {selectedRoute === r.id && <Icon name="Check" size={16} color={runTheme.iconActive} strokeWidth={2.5} />}
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </Animated.View>
          </Animated.View>
        )}
        <UnfinishedRecoveryModal
          visible={unfinishedResolutionRequested && unfinishedRun !== null && status === 'idle' && !isFinishing}
          data={unfinishedRun}
          onContinue={async () => {
            const activity = unfinishedRun;
            if (!activity) return;
            try {
              const restored = await restoreRecoverableActivity(activity);
              if (restored) setRunState('running');
            } catch (error) {
              crashLogger.breadcrumb(`running:recovery_failed ${String(error).slice(0, 80)}`);
            } finally {
              setUnfinishedResolutionRequested(false);
              setUnfinishedRun(null);
            }
          }}
          onSave={async () => {
            const activity = unfinishedRun;
            if (!activity) return;
            try {
              const saved = await saveRecoverableActivity(activity);
              if (saved) {
                nav.dispatch(
                  CommonActions.reset({
                    index: 2,
                    routes: [
                      { name: 'Home' },
                      { name: 'Routes', params: { initialTab: 'activities' } },
                      { name: 'MapHistory', params: { sessionId: activity.clientActivityId } },
                    ],
                  }),
                );
              }
            } catch (error) {
              crashLogger.breadcrumb(`running:recovery_save_failed ${String(error).slice(0, 80)}`);
            } finally {
              setUnfinishedResolutionRequested(false);
              setUnfinishedRun(null);
            }
          }}
          onDiscard={async () => {
            const activity = unfinishedRun;
            if (!activity) return;
            try {
              await discardRecoverableActivity(activity);
            } catch (error) {
              crashLogger.breadcrumb(`running:recovery_discard_failed ${String(error).slice(0, 80)}`);
            } finally {
              setUnfinishedResolutionRequested(false);
              setUnfinishedRun(null);
            }
          }}
        />
        {showSimulator ? <ActivitySimulatorPanel /> : null}
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
    <View style={[runStyles.container, { backgroundColor: runTheme.background }]}>
      {runMapSurface}
      <View style={[runStyles.bg, { backgroundColor: 'transparent' }]}>
          {/* R21 (2026-08-18 user "上方 下方 按钮 等等都和hike是一样的"):
              R2 top row now mirrors Hike — Back left, signal-lost pill
              on the right (only visible when tracking + lost). Kept the
              stats bar below. */}
          <SafeAreaView edges={['top']} pointerEvents="box-none">
            <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: Spacing.base, paddingTop: Spacing.md, gap: Spacing.sm }}>
              <BackButton variant="inline" onPress={() => {
                if (nav.canGoBack()) nav.goBack();
                else nav.navigate('Home' as never);
              }} />
              <View style={{ flex: 1 }} />
              {status === 'tracking' && signalLost && (
                <View style={runStyles.signalLostPill}>
                  <View style={runStyles.signalLostDot} />
                  <Text style={runStyles.signalLostText}>
                    {signalLostMin >= 1 ? `Signal lost · ${signalLostMin} min` : 'Signal lost'}
                  </Text>
                </View>
              )}
            </View>
          </SafeAreaView>
          {/* Stats bar — 2026-08-17 concept R0/R1: distance / duration
              / pace / GPS pill. Label strings match the concept ("km",
              blank for duration since HH:MM:SS reads on its own,
              "/km" suffix baked into paceDisplay). */}
          <View style={[runStyles.statsBar, { backgroundColor: runTheme.mapOverlay, borderColor: runTheme.border, shadowColor: runTheme.shadow }]}>
              <StatItem title="DISTANCE" value={distDisplay} label={dist.unit} />
              <StatItem title="TIME" value={durationDisplay} label="" />
              <StatItem title="PACE" value={paceDisplay} label={paceDisplay === '--' ? '' : paceUnit} />
              <View style={runStyles.statItem}>
                <Text style={[runStyles.statLabel, { color: runTheme.muted }]}>SIGNAL</Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                <PulseDot
                  size={8}
                  color={gpsStatusColor}
                  pulsing={simulatorGpsActive ? simulatorSignal === 'normal' || simulatorSignal === 'poor' : gpsFixHealthy}
                />
                <Text style={[runStyles.statValue, { color: runTheme.foreground, fontSize: 14 }]}>{gpsStatusLabel}</Text>
                </View>
              </View>
            </View>

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
                  style={[runStyles.trayAnchor, runIsDark ? { backgroundColor: runTheme.surfaceElevated, borderColor: runTheme.border } : null]}
                  activeOpacity={0.85}
                  accessibilityRole="button"
                  accessibilityLabel={runActionsExpanded ? 'Hide quick actions' : 'Show quick actions'}
                  onPress={() => {
                    haptic.selection();
                    setRunActionsExpanded(v => !v);
                  }}
                >
                  <Icon
                    name={runActionsExpanded ? 'ChevronLeft' : 'ChevronRight'}
                    size={22}
                    color={runIsDark ? '#F0EEE6' : RunConcept.textPrimary}
                    strokeWidth={2.2}
                  />
                </TouchableOpacity>
                {runActionsExpanded && (
                  <View style={runStyles.trayRow}>
                    <View style={runStyles.trayItem}>
                      <TouchableOpacity
                        style={[runStyles.trayFab, runIsDark ? { backgroundColor: runTheme.surface, borderColor: runTheme.border } : null]}
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
                        style={[runStyles.trayFab, runIsDark ? { backgroundColor: runTheme.surface, borderColor: runTheme.border } : null]}
                        activeOpacity={0.85}
                        onPress={() => {
                          setRunActionsExpanded(false);
                          handlePlantCairn();
                        }}
                        disabled={!locationAvailable}
                        accessibilityRole="button"
                        accessibilityLabel="Leave a Cairn"
                      >
                        <Icon name="Flag" size={24} color={runTheme.iconActive} strokeWidth={1.9} />
                      </TouchableOpacity>
                      <Text style={[runStyles.trayFabLabel, runIsDark ? { color: '#F0EEE6' } : null]}>Cairn</Text>
                    </View>
                    <View style={runStyles.trayItem}>
                      <TouchableOpacity
                        style={[runStyles.trayFab, runIsDark ? { backgroundColor: runTheme.surface, borderColor: runTheme.border } : null]}
                        activeOpacity={0.85}
                        onPress={async () => {
                          haptic.impact('medium');
                          setRunActionsExpanded(false);
                          await pauseTracking();
                          const frozen = useTrackingStore.getState();
                          // The same authority used by Finish and recovery is
                          // evaluated only after the GPS fence is durable.
                          const isTooShort = !saveEligibility(
                            frozen.trackPoints,
                            frozen.distanceM,
                          ).eligible;
                          if (isTooShort) {
                            setShowTooShortConfirmRun(true);
                            return;
                          }
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
              style={[runStyles.saveSheet, { backgroundColor: runTheme.surfaceElevated, borderTopColor: runTheme.border, transform: [{ translateY: saveSheetSlide }] }]}
            >
              <View style={[runStyles.saveSheetHandle, { backgroundColor: runTheme.border }]} />
              <Text style={[runStyles.saveSheetTitle, { color: runTheme.foreground }]}>Name this run</Text>
              <TextInput
                style={[runStyles.saveSheetInput, { backgroundColor: runTheme.surface, borderColor: runTheme.border, color: runTheme.foreground }]}
                placeholder="Morning Run"
                placeholderTextColor={runTheme.muted}
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
                  closeSaveSheet(() => { void handleStop(name); }, false);
                }}
              />
              <TouchableOpacity
                style={[runStyles.saveSheetBtn, { backgroundColor: runTheme.primary }]}
                onPress={() => {
                  const name = pendingName;
                  closeSaveSheet(() => { void handleStop(name); }, false);
                }}
                accessibilityRole="button"
                accessibilityLabel="Save this run"
                activeOpacity={0.9}
              >
                <Text style={[runStyles.saveSheetBtnText, { color: runTheme.onPrimary }]}>Save</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={runStyles.saveSheetCancel}
                onPress={() => closeSaveSheet()}
                accessibilityRole="button"
                accessibilityLabel="Cancel and keep running"
              >
                <Text style={[runStyles.saveSheetCancelText, { color: runTheme.foregroundSecondary }]}>Cancel</Text>
              </TouchableOpacity>
            </Animated.View>
          </KeyboardAvoidingView>
        </Animated.View>
      )}

      {/* v118: too-short modal — rendered at the running layer so it
          covers the lock + controls. Got it = continue tracking (state
          preserved by stopTracking pre-check). End anyway = full discard. */}
      <TooShortSheet
        visible={lastStopReason === 'too-short' || showTooShortConfirmRun}
        activityMode="running"
        onContinue={() => {
          setShowTooShortConfirmRun(false);
          clearLastStopReason();
          if (useTrackingStore.getState().status === 'paused') void resumeTracking();
        }}
        onDiscard={() => {
          setShowTooShortConfirmRun(false);
          clearLastStopReason();
          discardCurrentSession();
          // Drop the SaveSheet name — this run is gone, and there is no
          // false completion state for a discarded Activity.
          setPendingName('');
          setRunState('pre');
        }}
      />
      {/* O18 ONB-04: permission-denied modal for Running. */}
      <PermissionDeniedModal
        visible={permissionDeniedVisible && isFocused}
        featureName="Running"
        onDismiss={() => setPermissionDeniedVisible(false)}
      />
      {showSimulator ? <ActivitySimulatorPanel /> : null}
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
  bottomPanel: {
    marginHorizontal: Spacing.sm,
    marginBottom: Spacing.sm,
    paddingHorizontal: Spacing.base,
    paddingTop: Spacing.base,
    paddingBottom: Spacing.md,
    gap: Spacing.sm,
    borderWidth: 1,
    borderRadius: 24,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.16,
    shadowRadius: 24,
    elevation: 10,
  },
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
  startFailureText: { fontSize: FontSize.small, lineHeight: 18, textAlign: 'center' },
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
    marginHorizontal: Spacing.md,
    marginTop: Spacing.sm,
    paddingHorizontal: Spacing.base,
    paddingVertical: 12,
    borderWidth: 1,
    borderRadius: 16,
    shadowColor: '#102A20',
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.12,
    shadowRadius: 14,
    elevation: 6,
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
  mapStateOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 42,
  },

  statsBar: {
    flexDirection: 'row',
    marginHorizontal: Spacing.base,
    marginTop: Spacing.sm,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.md,
    borderWidth: 1,
    borderRadius: 18,
    gap: Spacing.xs,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.14,
    shadowRadius: 18,
    elevation: 7,
  },
  statItem: { flex: 1, minWidth: 0, alignItems: 'center', justifyContent: 'center', gap: 3 },
  statValue: { fontSize: 17, fontWeight: '800', color: RunConcept.textPrimary, letterSpacing: -0.35, fontVariant: ['tabular-nums'] },
  // 2026-08-17 concept R0: label sits inline with the value (small,
  // muted). Keeping statLabel around so the historical detail views
  // that still stack label under value don't break.
  statUnit: { fontSize: 11, fontWeight: '500', color: RunConcept.textMuted, letterSpacing: 0.2 },
  statLabel: { fontSize: 9, fontWeight: '800', color: RunConcept.textMuted, letterSpacing: 0.9 },

  mapFallback: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 42,
  },
  mapFallbackCard: {
    width: '100%',
    alignItems: 'center',
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.xl,
    borderRadius: 22,
    borderWidth: 1,
    gap: Spacing.sm,
    borderTopWidth: 1,
  },
  mapFallbackIcon: {
    width: 48,
    height: 48,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.xs,
  },
  mapFallbackTitle: { fontSize: 18, fontWeight: '800', letterSpacing: -0.2 },
  mapFallbackText: { fontSize: 13, lineHeight: 19, textAlign: 'center' },

  // R21 (2026-08-18): tray anchor mirrors Hiking — bottom-left, tap
  // Navigation → row expands to the right (Pause / Cairn / Finish).
  trayAnchorLayer: { position: 'absolute', bottom: 0, left: 0, right: 0 },
  trayAnchorRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.md,
    paddingLeft: Spacing.base,
    paddingBottom: Spacing.sm,
  },
  trayRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.md,
  },
  // R21 (2026-08-18): match Hiking — anchor + fabs identical 48x48 so
  // the row is perfectly flat, labels sit under each fab in a fixed
  // 48px column.
  trayItem: { width: 48, height: 48, alignItems: 'center' },
  trayAnchor: {
    width: 48, height: 48, borderRadius: 24,
    backgroundColor: 'rgba(255,253,247,0.94)',
    borderWidth: 1, borderColor: 'rgba(20,42,30,0.10)',
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15, shadowRadius: 10, elevation: 6,
  },
  trayFab: {
    width: 48, height: 48, borderRadius: 24,
    backgroundColor: 'rgba(255,253,247,0.94)',
    borderWidth: 1, borderColor: 'rgba(20,42,30,0.10)',
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12, shadowRadius: 10, elevation: 4,
  },
  trayFabLabel: {
    position: 'absolute',
    top: 52,
    left: 0,
    right: 0,
    fontSize: 11,
    color: RunConcept.textMuted,
    fontWeight: '600',
    textAlign: 'center',
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
    borderTopWidth: 1,
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
