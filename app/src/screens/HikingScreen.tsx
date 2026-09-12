/**
 * HikingScreen — topo map + GPS tracking
 *
 * States:
 * 1. Map view: full-screen topo placeholder, GPS chip, back chip, FAB
 * 2. Tracking: stats bar appears above map
 * 3. Plant note sheet: optional note before saving
 * 4. Marker detail sheet: view / delete a marker
 *
 * expo-keep-awake: activates when status === 'tracking'
 * Real stores: useTrackingStore (GPS), useMarkerStore (flags)
 */
import React, { useState, useRef, useEffect, useMemo } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView,
  Alert, Animated, Easing, Linking,
} from 'react-native';
import { haptic } from '../services/hapticService';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Location from 'expo-location';
import { useNavigation, CommonActions, useFocusEffect, useIsFocused } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/RootNavigator';
import { useAppStore } from '../store/useAppStore';
import { useTrackingStore } from '../store/useTrackingStore';
import { useMarkerStore } from '../store/useMarkerStore';
import { useRouteStore } from '../store/useRouteStore';
import { getCurrentRegion } from '../config/regions';
import { formatDuration, haversineM } from '../utils/geo';
import { useDistance } from '../utils/distanceFormat';
import { Colors, Spacing, Radius, FontSize, Shadow } from '../components/tokens';
import { Icon } from '../components/Icon';
import { StopSummarySheet } from './StopSummarySheet';
// R114 (2026-08-07): legacy screens/MarkerDetailSheet retired — replaced by
// unified features/marks/components/MarkDetailSheet. On the Hiking map,
// the tapped marker is (usually) the user's own just-planted flag → form A.
import { MarkDetailSheet } from '../features/marks/components/MarkDetailSheet';
import { useMemoryStore } from '../features/memory/store/useMemoryStore';
import { useMemorySubscriptionsStore } from '../features/memory/store/useMemorySubscriptionsStore';
import { useMarkLikeStore } from '../features/marks/store/useMarkLikeStore';
import { useFriendStore } from '../store/useFriendStore';
import { HikingMap } from './HikingMap';
import { TooShortSheet } from '../components/TooShortSheet';
import { useVisualTheme } from '../hooks/useVisualTheme';
import { PermissionDeniedModal } from '../components/PermissionDeniedModal';
import { UnfinishedRecoveryModal } from '../components/UnfinishedRecoveryModal';
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
import {
  resolveHikeCameraContract,
  resolveSimulatorControlsVisible,
  resolveSimulatorMapState,
} from '../features/activitySimulator/simulatorMapState';
import {
  deriveActivityOperationalState,
  isActivitySessionVisible,
} from '../features/activity/activityOperationalState';
import { saveEligibility } from '../features/activity/activityContracts';
import { deriveActivityLocationHealth } from '../features/activity/activityLocationHealth';
import {
  findRecoverableActivity,
  restoreRecoverableActivity,
  saveRecoverableActivity,
  discardRecoverableActivity,
  type RecoverableActivity,
} from '../features/activity/activityRecovery';
import {
  ActivityControlDock,
  ActivityRecenterButton,
  ActivityStartDock,
  ActivityTopChrome,
  type ActivityNoticePresentation,
  type ActivityStatusTone,
} from '../components/activity/ActivityRecordingChrome';


// ── Main HikingScreen ──────────────────────────────────────────────────────
type Nav = NativeStackNavigationProp<RootStackParamList>;

type UIState = 'map' | 'detail';

export function HikingScreen() {
  const simulatorOwnerUserId = useAppStore((s) => s.user?.id ?? null);
  const simulatorHydratedUserId = useActivitySimulatorStore((s) => s.hydratedUserId);
  const debugMode = useSettingsStore((s) => s.debugMode);
  const simulatorEnabled = useActivitySimulatorStore((s) => s.enabled);
  const simulatorStartConfigured = useActivitySimulatorStore((s) => s.startConfigured);
  const simulatorPosition = useActivitySimulatorStore((s) => s.current);
  const simulatorSignal = useActivitySimulatorStore((s) => s.signal);
  const simulatorVirtualTimestamp = useActivitySimulatorStore((s) => s.virtualTimestampMs);
  const simulatorPickerMode = useActivitySimulatorStore((s) => s.pickerMode);
  const status = useTrackingStore(s => s.status);
  const locationProviderSource = useTrackingStore((s) => s.locationProviderSource);
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

  const nav = useNavigation<Nav>();
  const isFocused = useIsFocused();
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
          screen: 'hike',
          result,
        }, { coordinateSource: 'none' });
      });
      return undefined;
    }, [debugMode, simulatorEnabled, simulatorHydratedUserId, simulatorOwnerUserId]),
  );
  // O12: uiMode/isExpert removed — was dead double-switch (only 'brg' placeholder used it)
  const insets = useSafeAreaInsets();
  // R21 (2026-08-17 user "确保hike界面根据系统主题色 切换 白天和黑夜"):
  // read Appearance. When isDark, gpsChip/actions/stats surface swap to
  // deep slate. Mapbox styleURL also switches via HikingMap → dark-v11.
  const hikeTheme = useVisualTheme();

  // Real tracking store
  const isFinishing = useTrackingStore(s => s.isFinishing);
  const startError = useTrackingStore(s => s.startError);
  const durationS = useTrackingStore(s => s.durationS);
  const distanceM = useTrackingStore(s => s.distanceM);
  const elevationGainM = useTrackingStore(s => s.elevationGainM);
  const locationAvailable = useTrackingStore(s => s.locationAvailable);
  const lastCoordinate = useTrackingStore(s => s.lastCoordinate);
  const latestSourceLocationTime = useTrackingStore(s => s.latestSourceLocationTime);
  const realMotionState = useTrackingStore(s => s.realMotionState);
  const realCandidatePending = useTrackingStore(s => s.realCandidatePending);
  const realCanonicalDecisionReason = useTrackingStore(s => s.realCanonicalDecisionReason);
  const pendingSegmentStartReason = useTrackingStore(s => s.pendingSegmentStartReason);
  const backgroundLocationPermission = useTrackingStore(s => s.backgroundLocationPermission);
  const refreshBackgroundLocationPermission = useTrackingStore(s => s.refreshBackgroundLocationPermission);
  useEffect(() => {
    if (!isFocused) return undefined;
    appendSimulatorLog('SCREEN', 'hike_opened', {
      debugMode,
      simulatorEnabled,
      trackingStatus: status,
      providerSource: locationProviderSource,
    }, { coordinateSource: 'none' });
    return () => appendSimulatorLog('SCREEN', 'hike_closed', {}, { coordinateSource: 'none' });
  }, [isFocused]);
  // Camera display is independent from Simulator Activity authority. Before
  // Set Start, retain the normal real-GPS map path; during a Simulator
  // Activity, display the last canonically accepted fix (not an unaccepted
  // engine-only position).
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
  useEffect(() => {
    if (!isFocused || status !== 'idle' || simulatorLocationAuthoritative) return;
    void refreshBackgroundLocationPermission();
  }, [isFocused, refreshBackgroundLocationPermission, simulatorLocationAuthoritative, status]);
  const sessionId = useTrackingStore(s => s.sessionId);
  const trackPoints = useTrackingStore(s => s.trackPoints);
  const trackPointsSmoothed = useTrackingStore(s => s.trackPointsSmoothed);
  const liveTrackPoints = locationProviderSource === 'real' ? trackPointsSmoothed : trackPoints;
  const liveMapTrackPoints = useMemo(
    () => liveTrackPoints.map(point => ({
      lat: point.lat,
      lng: point.lng,
      t: point.t,
      segmentId: point.segmentId,
    })),
    [liveTrackPoints],
  );
  // Completion still uses canonical truth. The real live line uses only its
  // bounded causal presentation twin (same points/segments/timestamps, ≤6m
  // tail offset); Simulator keeps exact canonical parity.
  const startTracking = useTrackingStore(s => s.startTracking);
  const stopTracking = useTrackingStore(s => s.stopTracking);
  // v120: pause + resume hooks for the Stop button. Tapping Stop pauses
  // tracking immediately (timer + GPS halt), then opens the summary
  // sheet. Resume button on the sheet re-arms tracking; the gap is
  // simply treated as signal loss in the recorded track.
  const pauseTracking = useTrackingStore(s => s.pauseTracking);
  const resumeTracking = useTrackingStore(s => s.resumeTracking);
  // v116/v118: surface a friendly explanation when stopTracking discards a
  // session because it had no drawable path (< 2 GPS points). v118 changed
  // this from a system Alert to TooShortSheet — and the session is now
  // PRESERVED, so "Got it" simply dismisses and tracking continues.
  const lastStopReason = useTrackingStore(s => s.lastStopReason);
  const clearLastStopReason = useTrackingStore(s => s.clearLastStopReason);
  // O18 SAF-01: hard save failure watcher. When both saveHikeAtomic AND
  // its pendingSyncStore fallback failed (disk full etc.), the store sets
  // saveLostSessionId. We surface a modal Alert with a Retry button so
  // the user knows their hike is at risk and can act.
  const saveLostSessionId = useTrackingStore(s => s.saveLostSessionId);
  const saveLostPayload = useTrackingStore(s => s.saveLostPayload);
  const discardCurrentSession = useTrackingStore(s => s.discardCurrentSession);
  const activityMode = useTrackingStore(s => s.activityMode);
  // R114/O22 STORY-73012 (K2): overspeed flag from the tracking store.
  // True when the last few fixes exceeded 15 km/h during hiking mode.
  const overSpeedActive = useTrackingStore(s => s.overSpeedActive);
  // R114/O22 STORY-73017 (K9): live save-progress step from the tracking
  // store. Rendered on the StopSummarySheet during long uploads.
  const savingHikeStep = useTrackingStore(s => s.savingHikeStep);

  // Real marker store
  const deleteMarker = useMarkerStore(s => s.deleteMarker);
  const getMarkersForRegion = useMarkerStore(s => s.getMarkersForRegion);
  const allMarkers = useMarkerStore(s => s.markers);
  const region = getCurrentRegion();
  // R114 (2026-08-07): plumbing for unified MarkDetailSheet — mirrors
  // MapScreen so the sheet renders the correct 4-form variant when a
  // user taps their own or someone else's flag on the Hiking map.
  const viewerId = useMarkerStore(s => s.userId);
  const friends = useFriendStore(s => s.friends);
  const friendIds = useMemo(() => friends.map(f => f.id), [friends]);
  const subscriptions = useMemorySubscriptionsStore(s => s.subscriptions);
  const subscribedFriendIds = useMemo<ReadonlyArray<string | number>>(
    () => subscriptions.map(s => s.friend_id),
    [subscriptions],
  );
  const isExploredFn = useMemoryStore(s => s.isExplored);
  const likedSetForSheet = useMarkLikeStore(s => s.liked);
  const isMarkLikedForSheet = useMemo(
    () => (id: string) => likedSetForSheet.includes(id),
    [likedSetForSheet],
  );
  // 2026-07-20 perf: memoize markers filter so trackPoints updates (every 3s
  // during hike) don't force downstream <MarkerList> to see a new array ref.
  const markers = useMemo(
    () => getMarkersForRegion(region.code),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [allMarkers, region.code]
  );

  const [ui, setUi] = useState<UIState>('map');
  const [selectedMarkerId, setSelectedMarkerId] = useState<string | null>(null);
  // v118: followUser controls whether the live map auto-recenters on
  // each GPS update. true (default during tracking) = Mapbox snaps the
  // camera to the user. false = user has manually panned/zoomed; we
  // honour that until they tap the recenter button.
  const [followUser, setFollowUser] = useState(true);
  // v119: imperative ref filled by HikingMap; recenter button calls this
  // to flyTo the user's position and reset zoom to 15.
  const recenterImperativeRef = useRef<(() => void) | null>(null);
  // Stop-summary sheet state. We don't call stopTracking immediately
  // when the user hits Stop — instead we capture a snapshot of the
  // current stats and surface a summary sheet so the user can name
  // the activity (or skip and use the default Type+Date name). Only
  // when the sheet is confirmed do we actually call stopTracking with
  // the chosen name.
  const [stopSummary, setStopSummary] = useState<null | {
    distanceM: number; durationS: number; elevationGainM: number;
    activityMode: 'hiking' | 'running'; trackPoints: Array<{ lat: number; lng: number }>;
    startedAt: number;
  }>(null);
  // O18 ONB-04: shared permission-denied modal state. When the user
  // rejects GPS on the initial prime effect (line ~525) or on Start Hike,
  // show a modal with Open Settings + Not now instead of silent return.
  const [permissionDeniedVisible, setPermissionDeniedVisible] = useState(false);
  // R114/O22 STORY-73009 (H3): persistent permission state for the inline
  // banner. When location was denied, the shared modal in HikingScreen only
  // shows once and then vanishes — user reports "no prompt / no explanation
  // / no way to fix". This state drives an inline banner above the route
  // pill that stays visible until permission is granted, offering both
  // Grant (re-prompt) and Open Settings (deep-link) CTAs.
  //   null   → not yet probed (during initial mount effect)
  //   true   → foreground location granted
  //   false  → user denied; banner is shown
  const [hasLocationPermission, setHasLocationPermission] = useState<boolean | null>(null);
  // Keep the sheet mounted with a "Saving…" spinner until the authoritative
  // local completion boundary returns. A transport timeout must never make
  // the UI claim that an uncommitted Activity was saved.
  const [savingHike, setSavingHike] = useState(false);
  // R21 (2026-08-18 user "finish如果too short现在没任何提示 应该有提示 让
  // 用户选择resume 或者discard"): local flag that forces TooShortSheet
  // when the Finish button detects an obviously-too-short hike. This
  // avoids racing with useTrackingStore.stopTracking's own lastStopReason
  // pathway and always shows the confirmation sheet before any teardown.
  const [showTooShortConfirm, setShowTooShortConfirm] = useState(false);
  const [selectedRoute, setSelectedRoute] = useState<string | null>(null);

  const routes = useRouteStore(s => s.routes);
  const loadRoutes = useRouteStore(s => s.loadRoutes);
  const isTracking = status === 'tracking';
  // v120: paused state behaves like tracking for layout purposes (the
  // user pauses via Stop, the summary sheet appears, but the live stats
  // bar stays visible so the user can still see distance/time/elev).
  const isTrackingOrPaused = status === 'tracking' || status === 'paused';
  const hasLiveSession = status !== 'idle' || isFinishing;

  // v412: unfinished 恢复弹窗 state
  // 进入 Hiking 界面时检测磁盘 backup, 依赖 hydrationTs 让 iOS jetsam 复活后能重跑
  // v412 4-eye fix (Critical #4): hydrationTs 现在是 useAppStore 真实字段, 冷启 hydrate 完成后会变
  const hydrationTs = useAppStore(s => s.hydrationTs ?? 0);
  const [unfinished, setUnfinished] = useState<RecoverableActivity | null>(null);
  const [unfinishedResolutionRequested, setUnfinishedResolutionRequested] = useState(false);
  useEffect(() => {
    // 只在非 tracking/paused 状态下检测: 用户已经在 recording 中不该弹恢复
    if (hasLiveSession) return;
    {
      let current = true;
      const timer = setTimeout(() => {
        void findRecoverableActivity('hiking').then(activity => {
          if (current) setUnfinished(activity);
        });
      }, 100);
      return () => { current = false; clearTimeout(timer); };
    }
  }, [hydrationTs, hasLiveSession]);

  useEffect(() => { loadRoutes(); }, []);

  // Sprint 6 round-11 R11B3: SAF-01 alert-visibility ref, shared by
  // primary useEffect and AppState re-fire useEffect. Declared here so
  // both effects can read/write it. Prevents stacked Alerts.
  const saf01AlertShownRef = useRef(false);

  // Sprint 6 round-14 R14B9: on mount, hydrate SAF-01 state from disk
  // so a force-quit during Alert display doesn't permanently lose the
  // hike. hydrateSaf01 is a no-op if no persisted blob exists.
  useEffect(() => {
    useTrackingStore.getState().hydrateSaf01();
  }, []);

  // O18 SAF-01: surface hard save failure with a modal Alert + Retry.
  useEffect(() => {
    if (!saveLostSessionId) return;
    // Sprint 6 round-11 R11B3: guard against stacking with AppState-fired
    // Alert. Primary and AppState effects share saf01AlertShownRef so
    // only one Alert is on screen at a time.
    if (saf01AlertShownRef.current) return;
    saf01AlertShownRef.current = true;
    Alert.alert(
      "We couldn't save this activity",
      "Your device may be low on storage. Your Activity is still recorded in the app. Tap Retry to try saving again, or Discard to remove it.",
      [
        {
          text: 'Discard',
          style: 'destructive',
          onPress: () => {
            saf01AlertShownRef.current = false;
            clearLastStopReason();
            try {
              discardCurrentSession();
            } catch { /* best-effort */ }
          },
        },
        {
          text: 'Retry',
          onPress: async () => {
            // Sprint 6 round-5 review R5B2 fix: Retry re-attempts
            // savePending with the captured payload FIRST, then drains.
            // Sprint 6 round-8 review R8B6 fix: DO NOT clear the marker
            // until AFTER the drain succeeds. Pre-fix, clearLastStopReason
            // ran optimistically at line-start — if drain threw, state
            // was already zeroed and the user thought Retry worked while
            // the hike was silently lost.
            const payload = saveLostPayload;
            try {
              if (payload) {
                const { savePending } = require('../services/pendingSyncStore');
                await savePending({
                  ...payload,
                  // Sprint 6 round-8 review R8B8: use the userId captured
                  // at Save time (in the payload), not 'unknown'. This
                  // matches syncDaemon R7B5 gate that skips uploads whose
                  // userId doesn't match the current signed-in user.
                  userId: payload.userId,
                  createdAt: Date.now(),
                  lastAttemptAt: null,
                  attemptCount: 0,
                });
              }
              const { drainPending } = require('../services/syncDaemon');
              await drainPending();
              // Sprint 6 round-9 review R9B4 fix: drainPending catches
              // per-hike errors internally (markAttempt) so a "successful"
              // drain doesn't prove OUR hike uploaded. Explicitly check
              // whether our localId is still in the pending queue before
              // clearing the SAF-01 marker. If it's still there, keep the
              // marker set so the user gets another chance.
              const { listPending } = require('../services/pendingSyncStore');
              const stillPending = (await listPending()).some(
                (h: any) => h.localId === payload?.localId,
              );
              if (!stillPending) {
                clearLastStopReason();
              }
              // else: leave saveLostSessionId set — Alert re-fires on
              // next AppState=active or mount.
            } catch (e) {
              // eslint-disable-next-line no-console
              console.warn('[SAF-01] retry failed:', e);
              // Keep saveLostSessionId set — the Alert will re-fire on
              // AppState=active (see R8B5 fix below) or next mount.
            } finally {
              // Sprint 6 round-11 R11B3: reset ref so a future re-fire
              // (mount/AppState) can show the Alert again.
              saf01AlertShownRef.current = false;
            }
          },
        },
      ],
      { cancelable: false },
    );
  }, [saveLostSessionId]);

  // Sprint 6 round-8 review R8B5 fix + round-9 R9B3 fix: re-fire the
  // SAF-01 Alert when the app foregrounds while saveLostSessionId is
  // still set. iOS dismisses `Alert.alert` on background even with
  // cancelable=false. Round-9 fix: (1) use the SAME async Retry handler
  // as the primary useEffect (not a stub that treated Retry === Discard),
  // and (2) guard against stacking Alerts by tracking `alertVisible` in
  // a ref. R11B3: ref hoisted above primary useEffect so both share.
  useEffect(() => {
    // Sprint 6 round-12 R12B5: don't reset saf01AlertShownRef here.
    // The ref must be driven by button handlers (Discard/Retry finally)
    // only, so a state transition where saveLostSessionId nulls doesn't
    // decouple ref state from an Alert that may still be on-screen (iOS
    // Alert.alert doesn't auto-dismiss on state change).
    //
    // Sprint 6 round-21 R21B3: on background, iOS dismisses the Alert
    // automatically but the ref stays true — the user comes back to
    // foreground and the guard at line 584 blocks the re-show, so the
    // SAF-01 prompt is stuck until app relaunch. Fix: when AppState
    // transitions to 'background' or 'inactive', reset the ref so
    // the next 'active' event can re-fire. Cancelable:false means the
    // Alert can't be dismissed by tapping outside — only iOS itself
    // dismisses on background — so this reset is only reached when
    // the Alert really is gone.
    if (!saveLostSessionId) return;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { AppState } = require('react-native');
    const sub = AppState.addEventListener('change', (state: string) => {
      if (state === 'background' || state === 'inactive') {
        // iOS auto-dismissed the Alert. Clear the ref so the next
        // foreground can re-show it.
        saf01AlertShownRef.current = false;
        return;
      }
      if (state !== 'active') return;
      if (!useTrackingStore.getState().saveLostSessionId) return;
      if (saf01AlertShownRef.current) return;
      saf01AlertShownRef.current = true;
      Alert.alert(
        "We couldn't save this activity",
        "Your device may be low on storage. Your Activity is still recorded in the app. Tap Retry to try saving again, or Discard to remove it.",
        [
          {
            text: 'Discard',
            style: 'destructive',
            onPress: () => {
              saf01AlertShownRef.current = false;
              clearLastStopReason();
              try { discardCurrentSession(); } catch { /* best-effort */ }
            },
          },
          {
            text: 'Retry',
            onPress: async () => {
              const payload = useTrackingStore.getState().saveLostPayload;
              try {
                if (payload) {
                  const { savePending } = require('../services/pendingSyncStore');
                  await savePending({
                    ...payload,
                    userId: payload.userId,
                    createdAt: Date.now(),
                    lastAttemptAt: null,
                    attemptCount: 0,
                  });
                }
                const { drainPending } = require('../services/syncDaemon');
                await drainPending();
                const { listPending } = require('../services/pendingSyncStore');
                const stillPending = (await listPending()).some(
                  (h: any) => h.localId === payload?.localId,
                );
                if (!stillPending) clearLastStopReason();
              } catch (err) {
                // eslint-disable-next-line no-console
                console.warn('[SAF-01 AppState retry] failed:', err);
              } finally {
                saf01AlertShownRef.current = false;
              }
            },
          },
        ],
        { cancelable: false },
      );
    });
    return () => { try { sub.remove(); } catch { /* silent */ } };
  }, [saveLostSessionId, discardCurrentSession, clearLastStopReason]);

  // Pre-fetch a one-shot GPS fix on enter so the route picker can show
  // accurate distance-from-start labels and apply the "too far" filter
  // even before tracking starts. Without this, lastCoordinate is null
  // until startTracking, which is why the > 25km dim/disable logic was
  // visibly inactive on V8.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (simulatorLocationAuthoritative) {
          if (!cancelled) setHasLocationPermission(true);
          return;
        }
        const perm = await Location.getForegroundPermissionsAsync();
        if (!perm.granted) {
          const req = await Location.requestForegroundPermissionsAsync();
          if (!req.granted) {
            // O18 ONB-04: user denied GPS — surface the shared modal so
            // they know why hiking won't start, and offer Open Settings.
            // Prior behavior silently returned; users tapped Start Hiking
            // and nothing visible happened.
            // R114/O22 STORY-73009: also set persistent hasLocationPermission
            // = false so the inline banner (above the route pill) renders.
            if (!cancelled) {
              setPermissionDeniedVisible(true);
              setHasLocationPermission(false);
            }
            return;
          }
          if (!cancelled) setHasLocationPermission(true);
        } else {
          if (!cancelled) setHasLocationPermission(true);
        }
        const fix = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        if (cancelled) return;
        // Only seed lastCoordinate when no tracking session is active —
        // an active session has its own watchPositionAsync stream and
        // we don't want to clobber a fresher value.
        const cur = useTrackingStore.getState();
        if (cur.status !== 'tracking') {
          useTrackingStore.setState({
            lastCoordinate: {
              lat: fix.coords.latitude,
              lng: fix.coords.longitude,
              alt: fix.coords.altitude ?? null,
            },
            lastCoordinateTime: Date.now(),
          });
        }
      } catch {
        // Permission denied or position unavailable — distance labels
        // will fall back to "no GPS" rendering. Non-fatal.
      }
    })();
    return () => { cancelled = true; };
  }, [simulatorLocationAuthoritative]);

  const operationalState = deriveActivityOperationalState({
    trackingStatus: status,
    isFinishing,
    hasRecovery: unfinished !== null,
    hasStartError: startError !== null,
  });
  const activitySessionVisible = isActivitySessionVisible(operationalState);
  const hikeCameraContract = resolveHikeCameraContract({
    activityVisible: activitySessionVisible,
    simulatorLocationAuthoritative,
    displayPosition: mapDisplayPosition,
  });

  const handleStartHike = async () => {
    haptic.impact('medium');
    if (unfinished) {
      setUnfinishedResolutionRequested(true);
      return;
    }
    const started = await startTracking();
    if (!started) {
      const authoritative = await findRecoverableActivity('hiking');
      if (authoritative) {
        setUnfinished(authoritative);
        setUnfinishedResolutionRequested(true);
      }
    }
  };

  // v118: too-short modal replaced the v116 system Alert. The session is
  // now preserved by stopTracking's pre-check (see useTrackingStore), so
  // tapping "Got it" leaves the user back on the still-running tracking
  // view with all stats intact. Tapping "End anyway" calls
  // discardCurrentSession() which does the full teardown.

  const selectedMarker = markers.find(m => m.id === selectedMarkerId) ?? null;

  function handleDeleteMarker() {
    if (selectedMarkerId) {
      deleteMarker(selectedMarkerId);
    }
    setSelectedMarkerId(null);
    setUi('map');
  }

  // Unified save-then-navigate helper. Every successful completion lands on
  // Activity Detail; unsuccessful local commit remains paused/retryable.
  async function saveHikeAndNav(name: string) {
    // O14 Bug 4 fix: flip saving state BEFORE dismissing the sheet so
    // the sheet shows "Saving…" spinner + disabled buttons while
    // stopTracking runs its flush+rename chain (up to 15s wall).
    setSavingHike(true);
    // Snapshot identity before stopTracking clears the live store.
    const preState = useTrackingStore.getState();
    const capturedSessionId = preState.sessionId;
    let saved = false;
    try {
      saved = await stopTracking(name);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[activity] stopTracking error:', String(err));
    }
    setSavingHike(false);
    if (saved || useTrackingStore.getState().lastStopReason === 'too-short') {
      setStopSummary(null);
    }

    // v407 fix #3: snapshot isLoggedIn before nav — auto-logout during
    // stopTracking would leave only Auth in the stack and reset would
    // throw.
    const stillLoggedIn = useAppStore.getState().isLoggedIn;
    if (!saved || !stillLoggedIn) {
      // Too-short/local failure remains on the Activity surface. TooShortSheet
      // is driven by lastStopReason; a storage failure remains paused.
      // Not-logged-in: auto-logout handler owns the redirect to Auth.
      return;
    }

    try {
      if (capturedSessionId) {
        // Primary "View Activity" — land on MapHistory detail with the
        // Routes(activities) list as the back-stack target.
        nav.dispatch(
          CommonActions.reset({
            index: 2,
            routes: [
              { name: 'Home' },
              { name: 'Routes', params: { initialTab: 'activities' } },
              { name: 'MapHistory', params: { sessionId: capturedSessionId } },
            ],
          })
        );
      }
    } catch (navErr) {
      // eslint-disable-next-line no-console
      console.warn('[v407] nav.reset failed:', String(navErr));
    }
  }

  // O12: settings-aware distance format (metric vs imperial).
  const dist = useDistance();

  // O18 HIKE-07: quiet 1 km / 1 mi auto-lap. Fires a light haptic + brief
  // toast each time distanceM crosses a unit-appropriate boundary. Does
  // NOT persist laps to the store (persistence + full split UI is a
  // future project) — this is purely a live feedback nudge so runners
  // and long-hikers get the "you just crossed 1 km" signal.
  const lapStepM = dist.imperial ? 1609.344 : 1000;
  const lastLapCountRef = useRef(0);
  const lapSessionIdRef = useRef<string | null>(null);
  const lapToastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [lapToast, setLapToast] = useState<string | null>(null);
  useEffect(() => {
    // A recovered/rehydrated Activity may enter the screen with kilometres
    // already recorded. Establish its current lap boundary silently instead
    // of replaying historical milestones as a fresh "1–5 km" toast.
    if (lapSessionIdRef.current !== sessionId) {
      lapSessionIdRef.current = sessionId;
      lastLapCountRef.current = Math.floor(distanceM / lapStepM);
      return;
    }
    if (!isTracking) {
      lastLapCountRef.current = Math.floor(distanceM / lapStepM);
      return;
    }
    const currentLap = Math.floor(distanceM / lapStepM);
    // Sprint 6 round-5 review R5B4: on burst distance jumps (background
    // task backfill after long tunnel / jetsam), currentLap can jump
    // multiple boundaries in one update. Show the range instead of
    // silently swallowing the intermediate milestones.
    if (currentLap > lastLapCountRef.current) {
      const prev = lastLapCountRef.current;
      lastLapCountRef.current = currentLap;
      haptic.impact('light');
      const unit = dist.imperial ? 'mi' : 'km';
      const msg = currentLap - prev > 1
        ? `${prev + 1}–${currentLap} ${unit}`
        : `${currentLap} ${unit}`;
      // Clear any pending toast timer so bursts don't leave orphaned
      // setTimeouts stacking up.
      if (lapToastTimerRef.current) {
        clearTimeout(lapToastTimerRef.current);
      }
      setLapToast(msg);
      lapToastTimerRef.current = setTimeout(() => {
        setLapToast(null);
        lapToastTimerRef.current = null;
      }, 2000);
      return () => {
        if (lapToastTimerRef.current) clearTimeout(lapToastTimerRef.current);
      };
    }
  }, [distanceM, isTracking, lapStepM, dist.imperial, sessionId]);
  const distDisplay = dist.format(distanceM, 1);
  const durationDisplay = formatDuration(durationS);

  const lastTrackT = trackPoints.length > 0 ? trackPoints[trackPoints.length - 1].t : null;
  const freshnessNow = locationProviderSource === 'simulator'
    ? simulatorVirtualTimestamp
    : activityFreshnessNow(locationProviderSource);
  const realLocationHealth = deriveActivityLocationHealth({
    nowMs: freshnessNow,
    sourceActive: isTracking && locationAvailable,
    latestSourceTimestamp: latestSourceLocationTime,
    latestCanonicalTimestamp: lastTrackT,
    pendingCandidate: realCandidatePending,
    latestCanonicalDecisionReason: realCanonicalDecisionReason,
    continuityGapOpen: pendingSegmentStartReason === 'gps-reacquired',
    motionState: realMotionState,
  });
  const signalLost = isTracking && locationProviderSource === 'real'
    && realLocationHealth.userFacingIssue === 'source-unavailable';
  const canonicalDegraded = isTracking && locationProviderSource === 'real'
    && realLocationHealth.userFacingIssue === 'sustained-route-unreliable';
  const signalLostFor = signalLost ? realLocationHealth.sourceAgeMs ?? 0 : 0;
  const signalLostMin = Math.floor(signalLostFor / 60_000);
  const gpsFixHealthy = isTracking && locationAvailable && lastTrackT !== null
    && realLocationHealth.sourceHealth === 'fresh'
    && !signalLost && !canonicalDegraded;
  const simulatorGpsActive = isTracking && locationProviderSource === 'simulator';
  const gpsStatusLabel = simulatorGpsActive
    ? `SIM · ${{ normal: 'Good', poor: 'Poor', lost: 'Lost', frozen: 'Frozen' }[simulatorSignal]}`
    : status === 'paused'
      ? 'GPS held'
      : signalLost
        ? 'Signal lost'
        : canonicalDegraded
          ? 'Location issue'
        : gpsFixHealthy
          ? 'GPS good'
          : hasLocationPermission === false
            ? 'Location off'
            : 'Finding GPS';
  const gpsStatusTone: ActivityStatusTone = simulatorGpsActive
    ? simulatorSignal === 'normal' ? 'healthy'
      : simulatorSignal === 'poor' ? 'warning'
        : simulatorSignal === 'lost' ? 'danger'
          : 'info'
    : status === 'paused' ? 'muted'
      : signalLost ? 'danger'
        : canonicalDegraded ? 'warning'
        : gpsFixHealthy ? 'healthy'
          : hasLocationPermission === false ? 'danger'
            : 'warning';
  const backgroundTrackingWarning = locationProviderSource === 'real'
    && backgroundLocationPermission === 'foreground-only'
    ? 'Background location is off — keep CairnNZ open'
    : null;
  const hikeNotices: ActivityNoticePresentation[] = [];
  if (signalLost) {
    hikeNotices.push({
      label: signalLostMin >= 1 ? `No location update for ${signalLostMin} min` : 'GPS signal lost',
      tone: 'danger',
      icon: 'CloudOff',
    });
  } else if (canonicalDegraded) {
    hikeNotices.push({
      label: 'Location signal is too weak to map reliably',
      tone: 'warning',
      icon: 'Navigation',
    });
  }
  if (isTracking && overSpeedActive) {
    hikeNotices.push({
      label: 'Moving quickly for a hike — your path may be less precise',
      tone: 'warning',
      icon: 'TriangleAlert',
    });
  } else if (isTracking && lapToast) {
    hikeNotices.push({ label: `${lapToast} explored`, tone: 'healthy', icon: 'Milestone' });
  }

  const [showRoutePicker, setShowRoutePicker] = useState(false);
  const routePickerSlide = useRef(new Animated.Value(300)).current;
  const routePickerOpacity = useRef(new Animated.Value(0)).current;

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

  const selectedRouteName = routes.find(r => r.id === selectedRoute)?.name ?? 'Free Hike';

  // v412: 两个 return 分支 (phase='select' early return + Phase 2 主 return) 都需要挂
  // UnfinishedRecoveryModal, 抽成一个 node 避免复制粘贴导致 onContinue/onDiscard 逻辑分叉。
  const recoveryModalNode = (
    <UnfinishedRecoveryModal
      visible={unfinishedResolutionRequested && unfinished !== null && !hasLiveSession}
      data={unfinished}
      onContinue={async () => {
        const u = unfinished;
        if (!u) return;
        try {
          await restoreRecoverableActivity(u);
        } catch (_recoverErr) {
          try {
            const cl = require('../services/crashLogger');
            (cl.crashLogger ?? cl.default)?.breadcrumb?.(`v412:recovery_continue_failed ${String(_recoverErr).slice(0, 80)}`);
          } catch { /* silent */ }
        }
        setUnfinishedResolutionRequested(false);
        setUnfinished(null);
      }}
      onSave={async () => {
        const u = unfinished;
        if (!u) return;
        try {
          const saved = await saveRecoverableActivity(u);
          if (saved) {
            nav.dispatch(
              CommonActions.reset({
                index: 2,
                routes: [
                  { name: 'Home' },
                  { name: 'Routes', params: { initialTab: 'activities' } },
                  { name: 'MapHistory', params: { sessionId: u.clientActivityId } },
                ],
              }),
            );
          }
        } catch { /* local journal remains recoverable */ }
        setUnfinishedResolutionRequested(false);
        setUnfinished(null);
      }}
      onDiscard={async () => {
        const u = unfinished;
        if (!u) return;
        try {
          await discardRecoverableActivity(u);
        } catch { /* keep the prompt dismissible; disk delete is idempotent */ }
        setUnfinishedResolutionRequested(false);
        setUnfinished(null);
      }}
    />
  );

  // 2026-08-17 R21: handleGrantLocation / handleOpenSettings removed with
  // the inline permission banner. GPS state now surfaces via the amber chip
  // at top-right (matches Running R0). If user returns after granting in
  // Settings, the focus-recheck useEffect below clears permissionDeniedVisible.

  // 2026-08-17 R21: re-check permission when screen regains focus. Handles
  // the case where user goes to iOS Settings, grants location, and returns —
  // without this, permissionDeniedVisible modal could re-appear or
  // hasLocationPermission stays false (dot stays amber).
  useEffect(() => {
    if (!isFocused) return;
    if (simulatorLocationAuthoritative) {
      setHasLocationPermission(true);
      setPermissionDeniedVisible(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const perm = await Location.getForegroundPermissionsAsync();
        if (cancelled) return;
        if (perm.granted) {
          setHasLocationPermission(true);
          setPermissionDeniedVisible(false);
        } else {
          setHasLocationPermission(false);
        }
      } catch { /* non-fatal */ }
    })();
    return () => { cancelled = true; };
  }, [isFocused, simulatorLocationAuthoritative]);

  // ── Phase 1: Route Selection ─────────────────────────────────────────────
  // One native Mapbox owner spans pre-start and Tracking. Activity/provider
  // transitions update layers and camera data; they never replace a map that
  // has already loaded on the device.
  const activeRoute = selectedRoute ? routes.find(r => r.id === selectedRoute) : null;
  const routePolyline = activeRoute?.points ?? [];
  const hikeMapSurface = (
    <HikingMap
      key="hike-map-surface"
      markers={activitySessionVisible ? markers : []}
      trackPoints={activitySessionVisible ? liveMapTrackPoints : []}
      onMarkerPress={(id) => {
        if (!activitySessionVisible) return;
        setSelectedMarkerId(id);
        setUi('detail');
      }}
      routeStart={activitySessionVisible && routePolyline.length > 0
        ? { lat: routePolyline[0].lat, lng: routePolyline[0].lng }
        : null}
      userPos={hikeCameraContract.userPosition}
      simulatorEnabled={hikeCameraContract.simulatorEnabled}
      simulatorControlsEnabled={showSimulator}
      simulatorCenterPickerVisible={showSimulator && (status === 'idle' || simulatorPickerMode !== null)}
      trackStartVariant={activitySessionVisible && isTrackingOrPaused ? 'hike' : null}
      instantCamera={hikeCameraContract.instantCamera}
      followUser={activitySessionVisible ? followUser : true}
      onUserGesture={activitySessionVisible ? () => setFollowUser(false) : undefined}
      recenterImperativeRef={activitySessionVisible ? recenterImperativeRef : undefined}
    />
  );

  const handlePauseResumeHike = () => {
    haptic.impact('light');
    if (status === 'paused') void resumeTracking();
    else void pauseTracking();
  };

  const handleFinishHike = async () => {
    haptic.impact('medium');
    const current = useTrackingStore.getState();
    if (!current.startedAt) {
      await stopTracking();
      return;
    }
    await pauseTracking();
    const frozen = useTrackingStore.getState();
    if (!saveEligibility(frozen.trackPoints, frozen.distanceM).eligible) {
      setShowTooShortConfirm(true);
      return;
    }
    setStopSummary({
      distanceM: frozen.distanceM,
      durationS: frozen.durationS,
      elevationGainM: frozen.elevationGainM,
      activityMode: frozen.activityMode,
      trackPoints: frozen.trackPoints.map(point => ({ lat: point.lat, lng: point.lng })),
      startedAt: frozen.startedAt!,
    });
  };

  if (!activitySessionVisible) {
    return (
      <>
      <View style={[styles.container, { backgroundColor: hikeTheme.background }]}>
        {hikeMapSurface}

        <ActivityTopChrome
          mode="hike"
          phase={operationalState === 'starting' ? 'starting' : 'ready'}
          safeTop={insets.top}
          gpsLabel={simulatorLocationAuthoritative
            ? 'SIM ready'
            : hasLocationPermission === false
              ? 'Location off'
              : hasLocationPermission === true
                ? 'GPS ready'
                : 'Checking GPS'}
          gpsTone={simulatorLocationAuthoritative || hasLocationPermission === true
            ? 'healthy'
            : hasLocationPermission === false ? 'danger' : 'warning'}
          onBack={() => nav.goBack()}
        />

        <ActivityStartDock
          mode="hike"
          safeBottom={insets.bottom}
          routeName={selectedRouteName}
          routeDescription={selectedRoute ? 'Follow a saved route' : 'Explore freely without a planned route'}
          readinessLabel={simulatorLocationAuthoritative
            ? 'Simulator origin ready'
            : hasLocationPermission === false
              ? 'Location permission is needed before recording'
              : hasLocationPermission === true
                ? 'Location ready · your path will be saved as you move'
                : 'Checking location readiness'}
          readinessTone={simulatorLocationAuthoritative || hasLocationPermission === true
            ? 'healthy'
            : hasLocationPermission === false ? 'danger' : 'warning'}
          backgroundWarning={backgroundTrackingWarning}
          onChooseRoute={openRoutePicker}
          onStart={handleStartHike}
          onOpenSettings={backgroundTrackingWarning ? () => { void Linking.openSettings(); } : undefined}
          starting={operationalState === 'starting'}
          startError={startError === 'permission-denied'
            ? 'Location permission is needed to start.'
            : startError
              ? 'Couldn’t start GPS. Check location settings and try again.'
              : null}
        />

        {/* Route picker sheet — non-fullscreen, slides up from bottom */}
        {showRoutePicker && (
          <Animated.View style={[styles.routePickerBackdrop, { backgroundColor: hikeTheme.scrim, opacity: routePickerOpacity }]}>
            <TouchableOpacity style={StyleSheet.absoluteFillObject} onPress={closeRoutePicker} activeOpacity={1} />
            <Animated.View style={[styles.routePickerSheet, { backgroundColor: hikeTheme.sheetSurface, borderTopColor: hikeTheme.border, transform: [{ translateY: routePickerSlide }] }]}>
              <View style={[styles.routePickerHandle, { backgroundColor: hikeTheme.borderStrong }]} />
              <Text style={[styles.routePickerTitle, { color: hikeTheme.foreground }]}>Choose a route</Text>
              <ScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: 280 }} contentContainerStyle={{ gap: Spacing.sm }}>
                {/* Free Hiking */}
                <TouchableOpacity
                  style={[
                    styles.routePickerRow,
                    { backgroundColor: hikeTheme.surface, borderColor: hikeTheme.border },
                    selectedRoute === null && { backgroundColor: hikeTheme.recordSelected, borderColor: hikeTheme.primary },
                  ]}
                  onPress={() => pickRoute(null)}
                  activeOpacity={0.8}
                >
                  <View style={[styles.routePickerBadge, { backgroundColor: hikeTheme.surfaceElevated }]}>
                    <Icon name="Target" size={16} color={hikeTheme.iconActive} strokeWidth={2} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.routePickerName, { color: hikeTheme.foreground }]}>Free Hike</Text>
                    <Text style={[styles.routePickerMeta, { color: hikeTheme.foregroundSecondary }]}>No route · explore freely</Text>
                  </View>
                  {selectedRoute === null && <Icon name="Check" size={16} color={hikeTheme.iconActive} strokeWidth={2.5} />}
                </TouchableOpacity>

                {/* Saved routes — show start-point distance from the
                    user. Routes whose start is more than 25km from the
                    current GPS fix are dimmed and made non-tappable;
                    starting a hike that requires driving 50km first
                    is rarely the user's intent and clutters the list. */}
                {routes.map(r => {
                  const startPt = r.points?.[0] ?? r.waypoints?.[0];
                  const distFromUser = (lastCoordinate && startPt)
                    ? haversineM(lastCoordinate, { lat: startPt.lat, lng: startPt.lng })
                    : null;
                  const TOO_FAR_M = 25_000;
                  const tooFar = distFromUser !== null && distFromUser > TOO_FAR_M;
                  const distLabel = distFromUser === null
                    ? null
                    : distFromUser < 100
                      ? '· at start'
                      : `· ${dist.formatShort(distFromUser)} away`;
                  return (
                    <TouchableOpacity
                      key={r.id}
                      style={[
                        styles.routePickerRow,
                        { backgroundColor: hikeTheme.surface, borderColor: hikeTheme.border },
                        selectedRoute === r.id && { backgroundColor: hikeTheme.recordSelected, borderColor: hikeTheme.primary },
                        tooFar && { opacity: 0.45 },
                      ]}
                      onPress={tooFar ? undefined : () => pickRoute(r.id)}
                      disabled={tooFar}
                      activeOpacity={0.8}
                    >
                      <View style={[styles.routePickerBadge, { backgroundColor: hikeTheme.surfaceElevated }]}>
                        <Icon name="Route" size={16} color={hikeTheme.iconActive} strokeWidth={2} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.routePickerName, { color: hikeTheme.foreground }]}>{r.name}</Text>
                        <Text style={[styles.routePickerMeta, { color: hikeTheme.foregroundSecondary }]}>
                          {dist.format(r.distanceM, 1)} {dist.unit}
                          {r.elevationGainM > 0 ? ` · ↑${dist.formatElevation(r.elevationGainM)}${dist.elevUnit}` : ''}
                          {r.runCount > 0 ? ` · ${r.runCount}× done` : ''}
                          {distLabel ? ` ${distLabel}` : ''}
                          {tooFar ? ' · too far' : ''}
                        </Text>
                      </View>
                      {selectedRoute === r.id && <Icon name="Check" size={16} color={hikeTheme.iconActive} strokeWidth={2.5} />}
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            </Animated.View>
          </Animated.View>
        )}
        {showSimulator ? <ActivitySimulatorPanel /> : null}
        {/* v412 4-eye fix (Critical #3): recoveryModalNode 已提到最外层 Fragment, 见函数结尾. */}
      </View>
      {recoveryModalNode}
      </>
    );
  }

  // ── Phase 2: Tracking ────────────────────────────────────────────────────

  return (
    <>
    <View style={[styles.container, { backgroundColor: hikeTheme.background }]}>
      {hikeMapSurface}

      <ActivityTopChrome
        mode="hike"
        phase={operationalState === 'finishing'
          ? 'finishing'
          : operationalState === 'paused' ? 'paused' : 'tracking'}
        safeTop={insets.top}
        gpsLabel={gpsStatusLabel}
        gpsTone={gpsStatusTone}
        onBack={() => nav.goBack()}
        primaryMetric={{ label: 'DISTANCE', value: distDisplay, unit: dist.unit }}
        secondaryMetrics={[
          { label: 'ACTIVE TIME', value: durationDisplay },
          { label: 'ELEVATION', value: `↑${dist.formatElevation(elevationGainM)}`, unit: dist.elevUnit },
        ]}
        notices={hikeNotices}
      />

      {!stopSummary ? (
        <ActivityControlDock
          mode="hike"
          phase={operationalState === 'finishing'
            ? 'finishing'
            : status === 'paused' ? 'paused' : 'tracking'}
          safeBottom={insets.bottom}
          backgroundWarning={backgroundTrackingWarning}
          onPauseResume={handlePauseResumeHike}
          onCairn={() => {
            haptic.selection();
            nav.navigate('Plant');
          }}
          onFinish={() => { void handleFinishHike(); }}
        />
      ) : null}

      {!stopSummary && !followUser ? (
        <ActivityRecenterButton
          mode="hike"
          safeBottom={insets.bottom}
          raised={Boolean(backgroundTrackingWarning)}
          onPress={() => {
            haptic.selection();
            recenterImperativeRef.current?.();
            setTimeout(() => setFollowUser(true), 700);
          }}
        />
      ) : null}

      {/* Marker Detail Sheet */}
      {/* R114 (2026-08-07): swapped legacy screens/MarkerDetailSheet for
          unified MarkDetailSheet. onOpenDetail (jump to full
          MarkerDetailScreen for edit) now flows through onEdit — the
          sheet's Edit button navigates to the screen instead of opening
          an inline editor, preserving the previous "See details" UX. */}
      {ui === 'detail' && selectedMarker && (
        <MarkDetailSheet
          marker={selectedMarker}
          viewerId={viewerId}
          subscribedFriendIds={subscribedFriendIds}
          friendIds={friendIds}
          inMyFog={isExploredFn}
          isLiked={isMarkLikedForSheet}
          onClose={() => { setSelectedMarkerId(null); setUi('map'); }}
          onEdit={(m) => {
            // Preserve v299 "See details" behavior: Edit on the sheet
            // jumps into the full MarkerDetailScreen so edits happen
            // there, not inline. Sheet stays as quick-view surface.
            const id = m.id;
            setSelectedMarkerId(null);
            setUi('map');
            nav.navigate('MarkerDetail', { markerId: id });
          }}
          onDelete={(m, semantic) => {
            if (semantic === 'own') {
              // R114 review fix: destructive action needs confirmation.
              // Matches CairnPinsLayer.handleDeleteOrHide + MarkerDetailScreen.
              Alert.alert(
                'Delete this cairn?',
                'This cannot be undone.',
                [
                  { text: 'Cancel', style: 'cancel' },
                  { text: 'Delete', style: 'destructive', onPress: handleDeleteMarker },
                ]
              );
            } else {
              // Non-owner hide — Hiking map generally only shows own
              // markers, so this branch is rare; wipe cache pending
              // Story-534.
              setSelectedMarkerId(null);
              setUi('map');
            }
          }}
        />
      )}

      {/* Stop summary sheet — shown after user taps Stop, before
          the session is actually written to the store. Lets the user
          name the activity (or skip and accept the default Type+Date
          name). Cancelling here keeps tracking running. */}
      {stopSummary && (
        <StopSummarySheet
          summary={stopSummary}
          saving={savingHike}
          savingStep={savingHikeStep}
          onCancel={() => {
            // v120: Resume — un-pause and dismiss the sheet. Tracking
            // resumes from where it left off. The gap between Stop
            // tap and Resume tap is recorded as a signal-loss interval
            // (no distance/elev accumulation; Kalman jumps once on the
            // next fresh GPS point).
            resumeTracking();
            setStopSummary(null);
          }}
          onDiscard={async () => {
            // The store owns the crash-safe order: durable tombstone first,
            // then pending cancellation, server cancellation and file cleanup.
            await discardCurrentSession();
            setStopSummary(null);
          }}
          onConfirm={async (name) => {
            // 2026-08-16 (H4 redesign): primary "View Activity" CTA —
            // save then nav.reset into MapHistory detail (existing v405
            // behavior).
            await saveHikeAndNav(name);
          }}
          // O1: removed onSaveAsRoute prop — hike is activity not template
        />
      )}

      {/* v118: too-short modal — renders when stopTracking detected the
          session has < 2 GPS points. Got it = continue tracking (state
          was preserved). End anyway = full discard via store action. */}
      <TooShortSheet
        visible={lastStopReason === 'too-short' || showTooShortConfirm}
        activityMode={activityMode}
        onContinue={() => {
          setShowTooShortConfirm(false);
          clearLastStopReason();
          if (useTrackingStore.getState().status === 'paused') void resumeTracking();
        }}
        onDiscard={() => {
          setShowTooShortConfirm(false);
          clearLastStopReason();
          void discardCurrentSession();
        }}
      />
      {/* O18 ONB-04: permission-denied modal — shown when GPS was rejected
          during the initial hiking prime. Replaces prior silent return. */}
      <PermissionDeniedModal
        visible={permissionDeniedVisible && isFocused}
        featureName="Hiking"
        onDismiss={() => setPermissionDeniedVisible(false)}
      />
      {showSimulator ? <ActivitySimulatorPanel /> : null}
      {/* v412: 未完成 hike 恢复弹窗 — 挂在 Fragment 顶层, 见下方 */}
    </View>
    {recoveryModalNode}
    </>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────
// Concept-lock color tokens (sleep-run 2026-08-15):
//   Paper:   #F9F6F3
//   Ink:     #1E2A24
//   Muted:   #5F6B62 / #8A8579
//   HikeAccent: #455D3C
const CONCEPT = {
  paper: '#F9F6F3',
  paper94: 'rgba(249,246,243,0.94)',
  ink: '#1E2A24',
  mutedInk: '#5F6B62',
  mutedText: '#8A8579',
  hike: '#455D3C',
  hikeDark: '#2F3F28',
  hairline: 'rgba(20,42,30,0.10)',
} as const;

const styles = StyleSheet.create({
  container: { flex: 1 },

  // ── Concept stats strip (H0-H4 shared) ────────────────────────────────
  // R21 (2026-08-18 user "上方4个数字没有格子 所以显得悬浮在那很突兀"):
  // wrap stats in a paper card matching Home action-button surface —
  // rgba(255,253,247,0.45) day / deep slate 0.6 night — so numbers sit
  // in a defined container instead of floating awkwardly on the map.
  statsStrip: {
    marginHorizontal: Spacing.base,
    marginTop: Spacing.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: 18,
    backgroundColor: 'rgba(255,253,247,0.45)',
    borderWidth: 1,
    borderColor: 'rgba(20,42,30,0.08)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  statsStripKm: {
    fontSize: 14, fontWeight: '700', color: CONCEPT.ink,
    fontVariant: ['tabular-nums'],
  },
  statsStripTime: {
    fontSize: 14, fontWeight: '700', color: CONCEPT.ink,
    fontVariant: ['tabular-nums'],
  },
  statsStripElev: {
    fontSize: 14, fontWeight: '600', color: CONCEPT.ink,
    fontVariant: ['tabular-nums'],
  },
  statsStripGpsWrap: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
  },
  statsStripGpsDot: {
    width: 8, height: 8, borderRadius: 4,
  },
  statsStripGpsText: {
    fontSize: 12, fontWeight: '700', color: CONCEPT.hike, letterSpacing: 0.2,
  },

  // ── H0 bottom stack (FREE HIKE pill + Route row + Start button) ───────
  freeHikePill: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: CONCEPT.paper94,
    borderWidth: 1, borderColor: CONCEPT.hairline,
    borderRadius: 18,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    minHeight: 72,
    gap: Spacing.md,
    ...Shadow.card,
  },
  // 2026-08-17 concept H0: fern-leaf glyph sits at 28pt on the left of
  // the FREE HIKE pill. Uses the shared PNG (assets/hiking/fern-leaf)
  // so it stays in sync with the botanical vocabulary used on the
  // TooShort sheet and the complete-screen feedback card.
  freeHikeGlyph: {
    width: 28, height: 28,
  },
  freeHikeEyebrow: {
    fontSize: 12, fontWeight: '800',
    color: CONCEPT.ink, letterSpacing: 0.6,
    marginBottom: 4,
  },
  freeHikeSub: {
    fontSize: 13, fontWeight: '500',
    color: CONCEPT.mutedInk,
  },
  routeRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: CONCEPT.paper94,
    borderWidth: 1, borderColor: CONCEPT.hairline,
    borderRadius: 12,
    paddingHorizontal: Spacing.base,
    paddingVertical: Spacing.md,
    minHeight: 44,
  },
  routeRowLabel: {
    flex: 1,
    fontSize: 14, fontWeight: '600', color: CONCEPT.ink,
  },
  startHikeBtn: {
    height: 52, borderRadius: 26,
    backgroundColor: CONCEPT.hike,
    alignItems: 'center', justifyContent: 'center',
    ...Shadow.card,
  },
  startHikeBtnText: {
    color: CONCEPT.paper,
    fontSize: 17, fontWeight: '700', letterSpacing: 0.2,
  },
  startFailureText: {
    fontSize: FontSize.small,
    lineHeight: 18,
    textAlign: 'center',
  },

  // ── H1 tracking FABs (44x44) ──────────────────────────────────────────
  fabPale: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: CONCEPT.paper94,
    borderWidth: 1, borderColor: CONCEPT.hairline,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.10, shadowRadius: 12, elevation: 4,
  },

  // R21 (2026-08-18): tray anchor sits at BOTTOM-LEFT (old compass FAB
  // position). Navigation button collapses/expands horizontal row that
  // slides out to its right (Pause → Cairn → Finish).
  trayAnchorLayer: {
    position: 'absolute',
    left: 0, right: 0, bottom: 0,
    pointerEvents: 'box-none',
  },
  trayAnchorRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.md,
    paddingLeft: Spacing.base,
  },
  trayRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.md,
  },
  // R21 (2026-08-18 user "需要是一行 现在不平 且大小不一"): anchor + fabs
  // share identical dimensions (48x48) and sit on the same baseline. Label
  // uses absolute-position under each fab so the fab row stays perfectly
  // aligned regardless of whether a label is present or wraps.
  //
  // 2026-08-31 fix (user "hike左下角展开和收缩箭头位置不一致"): trayItem
  // was using default overflow, so the trayFabLabel (marginTop:4 + ~14px
  // text) added ~18px to the item's height. Because trayAnchorRow is
  // `alignItems: 'flex-start'`, the taller trayItems pulled the anchor
  // (label-less, 48px) toward the top of the row — anchor's screen-Y
  // shifted up by ~9px between collapsed and expanded states. Fix:
  // trayItem height is now pinned to 48 (matching the fab) and the
  // label truly sits absolute-positioned below, matching what the
  // comment above always claimed.
  trayItem: {
    width: 48,
    height: 48,
    alignItems: 'center',
  },
  trayAnchor: {
    width: 48, height: 48, borderRadius: 24,
    backgroundColor: CONCEPT.paper94,
    borderWidth: 1, borderColor: CONCEPT.hairline,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15, shadowRadius: 10, elevation: 6,
  },
  trayFab: {
    width: 48, height: 48, borderRadius: 24,
    backgroundColor: CONCEPT.paper94,
    borderWidth: 1, borderColor: CONCEPT.hairline,
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
    color: Colors.textSecondary,
    fontWeight: '600',
    textAlign: 'center',
  },

  // Legacy h2* styles kept for now (unused after tray rework).
  h2Layer: {
    position: 'absolute',
    left: 0, right: 0, bottom: 0,
    alignItems: 'center',
    pointerEvents: 'box-none',
  },
  h2Tray: {
    alignItems: 'center',
    paddingHorizontal: Spacing.base,
    paddingBottom: Spacing.sm,
  },
  h2ChevronHandle: {
    width: 44, height: 20, borderRadius: 10,
    backgroundColor: CONCEPT.paper94,
    borderWidth: 1, borderColor: CONCEPT.hairline,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: Spacing.xs,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08, shadowRadius: 6, elevation: 2,
  },
  h2Row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: Spacing.lg,
    paddingHorizontal: Spacing.base,
    paddingVertical: Spacing.sm,
  },
  h2Slot: {
    alignItems: 'center',
  },
  h2Fab: {
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: CONCEPT.paper94,
    borderWidth: 1, borderColor: CONCEPT.hairline,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.12, shadowRadius: 14, elevation: 5,
  },
  h2FabLabel: {
    marginTop: Spacing.xs,
    fontSize: FontSize.tiny,
    color: Colors.textSecondary,
    fontWeight: '500',
  },

  // 2026-08-16 UI overhaul: h2 lock overlay removed with the Lock button.
  // Tray collapses to chevron by default which already prevents pocket-taps.

  // R114/O22 STORY-73009: permission banner styles removed 2026-08-17 R21.
  // Banner was gated by `false &&` (dead code). GPS state now shown via chip
  // at top-right only.

  // Route selection (phase 1)
  bottomPanel: { paddingHorizontal: Spacing.base, paddingBottom: Spacing.sm, gap: Spacing.sm },

  // Route picker sheet
  routePickerBackdrop: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 80,
    elevation: 80,
    // Dim backdrop so the route picker reads as a modal layer instead
    // of a floating panel. Matches the rest of the app's bottom-sheet
    // language (MarkerDetailSheet, StopSummarySheet, etc).
    backgroundColor: 'rgba(0,0,0,0.35)',
    justifyContent: 'flex-end',
  },
  // R21 (2026-08-18 user "改成和外部一样的风格"): route picker sheet uses
  // Home paper palette (rgba(255,253,247,0.98) for the sheet itself with
  // dark-green ink text) so it feels continuous with Home / Settings.
  routePickerSheet: {
    backgroundColor: 'rgba(255,253,247,0.98)',
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    paddingHorizontal: Spacing.base, paddingTop: Spacing.sm, paddingBottom: Spacing.xxl,
    gap: Spacing.sm,
    borderTopWidth: 1, borderTopColor: 'rgba(20,42,30,0.08)',
    shadowColor: '#000', shadowOffset: { width: 0, height: -4 }, shadowOpacity: 0.12, shadowRadius: 20, elevation: 82,
  },
  routePickerHandle: {
    width: 40, height: 4, borderRadius: 2,
    backgroundColor: 'rgba(20,42,30,0.20)', alignSelf: 'center', marginBottom: Spacing.sm,
  },
  routePickerTitle: {
    fontSize: 15, fontWeight: '600', color: '#1B3A28',
    letterSpacing: 0, marginBottom: Spacing.xs, paddingHorizontal: 4,
  },
  routePickerRow: {
    backgroundColor: 'rgba(255,253,247,0.45)', borderRadius: 16,
    flexDirection: 'row', alignItems: 'center',
    padding: Spacing.base, gap: Spacing.md,
    borderWidth: 1, borderColor: 'rgba(20,42,30,0.10)',
  },
  routePickerRowSelected: {
    backgroundColor: 'rgba(20,42,30,0.10)',
    borderColor: 'rgba(20,42,30,0.30)',
  },
  routePickerBadge: {
    width: 44, height: 44, borderRadius: 12,
    backgroundColor: 'rgba(20,42,30,0.08)',
    alignItems: 'center', justifyContent: 'center',
  },
  routePickerName: { fontSize: FontSize.body, fontWeight: '600', color: '#1B3A28' },
  routePickerMeta: { fontSize: FontSize.small, color: 'rgba(27,58,40,0.62)', marginTop: 2 },

  // Top overlay
  topOverlay: { position: 'absolute', top: 0, left: 0, right: 0, pointerEvents: 'box-none' },
  topRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    // paddingTop is supplied by the topOverlay container inline
    // (insets.top + Spacing.lg). Don't double-pad here, otherwise Back/GPS
    // chips drift further from the status bar than the rest of the
    // app (Home uses inset + Spacing.sm only).
    paddingHorizontal: Spacing.base, gap: Spacing.sm,
  },
  gpsChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: 'rgba(255,255,255,0.65)', borderRadius: Radius.pill,
    paddingHorizontal: Spacing.md, paddingVertical: 7,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.4)',
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.08, shadowRadius: 12, elevation: 4,
  },
  gpsChipOffline: {
    backgroundColor: Colors.dangerBg,
  },
  gpsChipAmber: {
    backgroundColor: Colors.severityWarningBg,
  },
  gpsDot: { width: 8, height: 8, borderRadius: 4 },
  gpsText: { fontSize: FontSize.small, fontWeight: '600', color: Colors.textPrimary },
  gpsTextOffline: { color: Colors.danger },
  gpsTextAmber: { color: Colors.severityWarning },

  trackingBar: {
    // Deprecated 2026-08-16 (kept as harmless stub in case a legacy
    // reference lingers in a hot-reload cache). Safe to fully remove
    // after next full rebuild cycle. No consumers in current code.
    display: 'none',
  },
  // v78 #1: Signal-lost pill — amber chip above the stats bar.
  // Self-aligned start, only visible when GPS hasn't fixed in 30s+.
  // R114/O22 STORY-73012: overspeed banner (top second row). numberOfLines=1
  // per user spec — must never wrap. Padding kept snug to fit typical
  // 40-char English message on the narrowest device (iPhone SE 375pt).
  overSpeedBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    marginHorizontal: Spacing.base, marginTop: Spacing.sm,
    paddingHorizontal: Spacing.md, paddingVertical: 6,
    backgroundColor: Colors.severityWarningBg,
    borderRadius: 999,
    borderWidth: 1, borderColor: Colors.severityWarning,
  },
  overSpeedBannerText: {
    fontSize: FontSize.small,
    fontWeight: '700',
    color: Colors.severityWarning,
    flexShrink: 1,
  },
  signalLostPill: {
    flexDirection: 'row', alignItems: 'center',
    alignSelf: 'flex-start',
    marginHorizontal: Spacing.base, marginTop: Spacing.sm,
    paddingHorizontal: Spacing.md, paddingVertical: 6,
    backgroundColor: 'transparent',
    borderRadius: 999,
    gap: 6,
  },
  signalLostDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#FFFFFF' },
  signalLostText: { fontSize: 11, fontWeight: '700', color: '#FFFFFF', letterSpacing: 0.2, textShadowColor: 'rgba(0,0,0,0.6)', textShadowRadius: 4, textShadowOffset: { width: 0, height: 1 } },
  // O18 HIKE-02: GPS accuracy chip — same shape as signalLostPill but
  // neutral color (Colors.textSecondary). Only rendered when accuracy > 15m
  // during active tracking (so 3m and 30m fixes read very differently).
  accuracyPill: {
    flexDirection: 'row', alignItems: 'center',
    alignSelf: 'flex-start',
    marginHorizontal: Spacing.base, marginTop: Spacing.sm,
    paddingHorizontal: Spacing.sm, paddingVertical: Spacing.xs,
    backgroundColor: 'rgba(255,255,255,0.95)', borderRadius: Radius.chip,
    borderWidth: 1, borderColor: Colors.textMuted,
    gap: 6,
  },
  accuracyText: { fontSize: 11, fontWeight: '600', color: Colors.textSecondary, letterSpacing: 0.2 },
  // O18 HIKE-07: lap toast — brief celebration when 1 km / 1 mi crossed.
  // R114/O22 STORY-73025 (K6): position the "3 km signpost" toast at
  // top-center below the GPS chip, distinct from left-aligned warning
  // pills (signal-lost / overspeed). Larger horizontal padding + higher
  // contrast border reads as an achievement badge rather than a warning.
  lapToast: {
    flexDirection: 'row', alignItems: 'center',
    alignSelf: 'center',
    marginTop: Spacing.sm,
    paddingHorizontal: Spacing.md, paddingVertical: 8,
    backgroundColor: Colors.primary, borderRadius: 999,
    gap: 6,
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18, shadowRadius: 12, elevation: 5,
  },
  lapToastText: { fontSize: 13, fontWeight: '800', color: '#fff', letterSpacing: 0.3 },
  // 2026-08-16 UI overhaul: trackingBar + inline Pause/Resume/Stop
  // controls removed. All action affordances now live in the H2 tray.
  // These styles (trackingBar, trackingStat, trackingValueLg, trackingValue,
  // trackingUnit, statDivider, routeSwitchBtn, stopBtn/text, pauseBtn/text,
  // resumeBtn/text) are intentionally omitted — no consumers remain.

  // Bottom overlay
  bottomOverlay: { position: 'absolute', bottom: 0, left: 0, right: 0, pointerEvents: 'box-none' },
  bottomRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingBottom: Spacing.lg, paddingHorizontal: Spacing.base, gap: Spacing.sm,
  },
  // Three-column control bar shown while tracking. space-between so
  // the compass left + flag right align horizontally with the
  // Back/GPS chips in the top overlay (also space-between with the
  // same paddingHorizontal). User asked for left/right edges to
  // line up across top + bottom.
  controlRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: Spacing.base, paddingBottom: Spacing.lg,
  },
  controlSlot: {
    alignItems: 'center', justifyContent: 'center',
  },
  // Compass chip — bottom-left slot, mirrors the GPS chip in the top
  // overlay (same shadow, border, surface colour) so the page reads as
  // a coherent system rather than a pile of buttons.
  trackBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm,
    backgroundColor: 'rgba(255,255,255,0.95)',
    borderRadius: Radius.pill,
    height: 60,
    paddingHorizontal: Spacing.xl,
    borderWidth: 2, borderColor: Colors.primaryMuted,
    ...Shadow.card,
  },
  trackBtnText: { fontSize: FontSize.body, fontWeight: '700', color: Colors.primary },
});
