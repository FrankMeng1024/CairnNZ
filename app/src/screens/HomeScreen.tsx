/**
 * HomeScreen — spec-driven implementation.
 *
 * This screen used to be 978 lines of hand-crafted layout. That version is
 * archived at HomeScreen.OLD.tsx.bak. The new flow:
 *   1. docs/ui-redesign/Home.spec.json  (single source of truth)
 *   2. spike/spec_to_rn.py  generates  screens/home_generated/*
 *   3. this file wires nav + real store data + navigation callbacks into
 *      the generated component
 *
 * When the concept changes: edit spec.json → rerun spec_to_rn.py → nothing
 * to touch here unless a new prop appears.
 */
import React, { useMemo, useState, useEffect } from 'react';
import { View, StyleSheet, LayoutChangeEvent, TouchableOpacity, Text, Platform } from 'react-native';
import { useNavigation, useFocusEffect, useIsFocused } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/RootNavigator';
import { HomeScreen as GeneratedHome } from './home_generated/HomeScreen.generated';
import { useSessionStore } from '../store/useSessionStore';
import { useTrackingStore } from '../store/useTrackingStore';
import { useAppStore } from '../store/useAppStore';
import { useMemoryStore } from '../features/memory/store/useMemoryStore';
import { useWeatherStore, NZ_TEST_CITIES } from '../store/useWeatherStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { useMarkerStore } from '../store/useMarkerStore';
import { useScenicTimeState } from '../hooks/useScenicTimeState';
import { scheduleVisibleFrame, useAppIsActive } from '../hooks/useAppIsActive';
import { resolveCurrentCountry } from '../services/countryService';
import { getHomeBackground, getWeatherReviewBackground } from '../utils/homeBackground';
import { SUNNY_AMBIENT_MOTION_ENABLED } from '../config/homeVisual';
import {
  ensureUnfinishedActivityRegistry,
  findRecoverableActivity,
  type RecoverableActivity,
} from '../features/activity/activityRecovery';
import {
  deriveActivityOperationalState,
  type ActivityOperationalState,
} from '../features/activity/activityOperationalState';
import { activitySimulatorBuildCapable } from '../features/activitySimulator/capability';
import { useDistance } from '../utils/distanceFormat';
import { useCairnPresentationStore } from '../features/cairns/cairnPresentationStore';
import { OtaReleaseMarker } from '../components/OtaBadge';
import {
  buildDiscoveryHomeCopy,
  hasPersonalMemoryEvidence,
  resolveDiscoveryHomeDestination,
  resolveHomeStateWindow,
} from '../features/cairns/homeStateWindow';
import { cairnText, formatCairnDate } from '../i18n/runtime';

type Nav = NativeStackNavigationProp<RootStackParamList>;

const DESIGN_W = 375;
const DESIGN_H = 812;

// R21 (2026-08-17): country area (km²) for percentage-of-country stat.
// Wikipedia data, hard-coded lookup for common target markets.
const COUNTRY_AREA_KM2: Record<string, number> = {
  'NZ': 268021,
  'AU': 7692024,
  'US': 9833520,
  'CA': 9984670,
  'GB': 243610,
  'CN': 9596961,
  'JP': 377975,
  'DE': 357022,
  'FR': 643801,
  'IN': 3287263,
  'BR': 8515767,
  'ZA': 1221037,
};

function formatDuration(secs: number): string {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m} min`;
}
function formatRelativeDay(startedAt: number | string): string {
  const t = typeof startedAt === 'number' ? startedAt : new Date(startedAt).getTime();
  const elapsedMs = Math.max(0, Date.now() - t);
  const minutes = Math.floor(elapsedMs / 60000);
  if (minutes < 1) return cairnText('home-screen.just-now');
  if (minutes < 60) return cairnText('home-screen.value-min-ago', { minutes: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return cairnText('home-screen.value-h-ago', { hours: hours });
  const days = Math.floor(hours / 24);
  if (days === 1) return cairnText('home-screen.yesterday');
  if (days < 7) return cairnText('home-screen.value-days-ago', { days: days });
  return formatCairnDate(t);
}

function activityStateCopy(
  state: ActivityOperationalState,
  mode: 'hiking' | 'running' | undefined,
): { eyebrow: string; title: string } {
  const noun = mode === 'running' ? cairnText('home-screen.run') : cairnText('home-screen.hike');
  const modeLabel = noun.toUpperCase();
  switch (state) {
    case 'starting': return { eyebrow: cairnText('home-screen.value-starting', { modeLabel: modeLabel }), title: cairnText('home-screen.starting-value', { noun: noun }) };
    case 'tracking': return { eyebrow: cairnText('home-screen.value-recording', { modeLabel: modeLabel }), title: cairnText('home-screen.current-value', { noun: noun }) };
    case 'resuming': return { eyebrow: cairnText('home-screen.value-resuming', { modeLabel: modeLabel }), title: cairnText('home-screen.resuming-value', { noun: noun }) };
    case 'pausing': return { eyebrow: cairnText('home-screen.value-pausing', { modeLabel: modeLabel }), title: cairnText('home-screen.pausing-value', { noun: noun }) };
    case 'paused': return { eyebrow: cairnText('home-screen.value-paused', { modeLabel: modeLabel }), title: cairnText('home-screen.paused-value', { noun: noun }) };
    case 'finishing': return { eyebrow: cairnText('home-screen.value-finishing', { modeLabel: modeLabel }), title: cairnText('home-screen.finishing-value', { noun: noun }) };
    case 'recovery': return { eyebrow: cairnText('home-screen.value-interrupted', { modeLabel: modeLabel }), title: cairnText('home-screen.interrupted-value', { noun: noun }) };
    default: return { eyebrow: modeLabel, title: cairnText('home-screen.recent-value', { noun: noun }) };
  }
}

export function HomeScreen() {
  const nav = useNavigation<Nav>();
  const isHomeFocused = useIsFocused();
  const distance = useDistance();
  const user = useAppStore(s => s.user);
  const currentUserId = String(user?.id ?? '');
  const sessions = useSessionStore(s => s.sessions);
  const liveStatus = useTrackingStore(s => s.status);
  const liveTransitionState = useTrackingStore(s => s.transitionState);
  const liveIsFinishing = useTrackingStore(s => s.isFinishing);
  const liveActivityMode = useTrackingStore(s => s.activityMode);
  const liveActivityId = useTrackingStore(s => s.sessionId);
  const liveOwnerUserId = useTrackingStore(s => s.ownerUserId);
  const liveStartedAt = useTrackingStore(s => s.startedAt);
  const liveDistanceM = useTrackingStore(s => s.distanceM);
  const liveDurationS = useTrackingStore(s => s.durationS);
  const saveLostSessionId = useTrackingStore(s => s.saveLostSessionId);
  const saveLostPayload = useTrackingStore(s => s.saveLostPayload);
  const memoryPointCount = useMemoryStore(s => s.points.length);
  const ownedCairnCount = useMarkerStore(s => s.markers.length);
  const presentationViewerId = useCairnPresentationStore(s => s.viewerId);
  const presentationPendingCount = useCairnPresentationStore(s => s.pendingGroups.length);
  const presentationGroup = useCairnPresentationStore(s => s.activeGroup);
  const appIsActive = useAppIsActive();
  const presentationSurface = useCairnPresentationStore(s => s.activeSurface);
  const presentationBlocked = useCairnPresentationStore(s => s.presentationBlocked);
  const memoryUnreadCount = useCairnPresentationStore(s => s.unreadCount);
  const acquiredCairnCount = useCairnPresentationStore(s => Math.max(s.acquiredCount, s.acquiredMarkers.length));
  const memoryCairnCount = ownedCairnCount + acquiredCairnCount;
  const weatherCondition = useWeatherStore(s => s.condition);
  const conditionOverride = useWeatherStore(s => s.conditionOverride);
  const locationOverride = useWeatherStore(s => s.locationOverride);
  const fetchWeather = useWeatherStore(s => s.fetchWeather);
  // Effective condition = override if set, else real. Drives bg + tokens.
  const effectiveCondition = conditionOverride ?? weatherCondition;
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);
  const [country, setCountry] = useState<{ name: string; code: string } | null>(null);
  const [showPercent, setShowPercent] = useState(false);
  // Internal QA has an explicit build-gated owner. Normal production builds
  // cannot discover or authorize it through user Settings.
  const debugMode = useSettingsStore(s => s.debugMode);
  const qaToolsAvailable = activitySimulatorBuildCapable || (typeof __DEV__ !== 'undefined' && __DEV__);
  const hikingIconCandidate = useWeatherStore(s => s.hikingIconCandidate);
  const runningIconCandidate = useWeatherStore(s => s.runningIconCandidate);

  // The bounded registry exposes at most one unfinished Activity for the
  // signed-in user. Home may show it without blocking unrelated browsing;
  // tapping the card targets its exact immutable client identity.
  const [unfinishedActivity, setUnfinishedActivity] = useState<RecoverableActivity | null>(null);
  const recoveryLookupGenerationRef = React.useRef(0);
  const refreshUnfinished = React.useCallback(async () => {
    const requestGeneration = ++recoveryLookupGenerationRef.current;
    const userId = currentUserId;
    const isCurrentRequest = () => requestGeneration === recoveryLookupGenerationRef.current
      && String(useAppStore.getState().user?.id ?? '') === userId;
    try {
      if (!userId) {
        if (isCurrentRequest()) setUnfinishedActivity(null);
        return;
      }
      await ensureUnfinishedActivityRegistry(userId);
      if (!isCurrentRequest()) return;
      const registry = await import('../features/activity/activityRegistry');
      const unfinished = await registry.getUnfinishedActivity(userId);
      if (!isCurrentRequest()) return;
      if (!unfinished) {
        setUnfinishedActivity(null);
        return;
      }
      const recovered = await findRecoverableActivity({
        clientActivityId: unfinished.clientActivityId,
        userId,
      });
      if (isCurrentRequest()) setUnfinishedActivity(recovered);
    } catch {
      if (isCurrentRequest()) setUnfinishedActivity(null);
    }
  }, [currentUserId]);
  useEffect(() => {
    recoveryLookupGenerationRef.current += 1;
    setUnfinishedActivity(null);
  }, [currentUserId]);
  // R21 (2026-08-18 user "点击 discard 回到 homepage, 依旧展示 unfinish"):
  // re-list on every focus so Discard from Hiking clears the card
  // immediately. sessions.length dep kept so save-hike also refreshes.
  useFocusEffect(React.useCallback(() => {
    refreshUnfinished();
  }, [refreshUnfinished]));
  useEffect(() => {
    refreshUnfinished();
  }, [sessions.length, refreshUnfinished]);

  const validSessions = useMemo(
    () => sessions.filter((s: any) => (s.distanceM > 0 || s.durationS > 0) && s.startedAt),
    [sessions],
  );
  const hasHike = validSessions.length > 0;
  const state = hasHike ? 'H1' : 'H0';

  // R21 (2026-08-17): resolve current country from GPS. If location override
  // is active, use that instead. Cached 24h so first-render doesn't wait.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (locationOverride) {
        // Use overridden city name as country — dev/test.
        setCountry({ name: locationOverride.label, code: 'NZ' });
        return;
      }
      const result = await resolveCurrentCountry();
      if (!cancelled && result) {
        setCountry({ name: result.countryName, code: result.countryCode });
      }
    })();
    return () => { cancelled = true; };
  }, [locationOverride]);

  // R21 (2026-08-17): fire real weather fetch on mount if no override.
  // If GPS available, use real lat/lon; else fall back to a default. Real
  // condition drives the bg + text tokens.
  useEffect(() => {
    if (locationOverride) return; // dev override handles its own fetch
    let cancelled = false;
    (async () => {
      try {
        // R21 (2026-08-17): defensive — on web + when expo-location's web
        // shim has limited API, some methods can throw. Guard the whole
        // block; failure just means bg stays default. Fixes crash user
        // reported: "进了 memory 返回 他报错了".
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const Location = require('expo-location');
        if (!Location || typeof Location.getForegroundPermissionsAsync !== 'function') return;
        const perm = await Location.getForegroundPermissionsAsync();
        if (cancelled) return;
        if (!perm?.granted) return;
        let pos: any = null;
        try {
          pos = await Location.getLastKnownPositionAsync({});
        } catch { /* fallback */ }
        if (!pos) {
          try {
            pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy?.Lowest ?? 1 });
          } catch { /* silent */ }
        }
        if (!cancelled && pos?.coords) {
          fetchWeather(pos.coords.latitude, pos.coords.longitude);
        }
      } catch { /* silent — bg stays sunny default */ }
    })();
    return () => { cancelled = true; };
  }, [locationOverride, fetchWeather]);

  // exploredKm² = memoryPointCount × 0.000541 (each 25m hex cell ≈ 541 m²)
  const exploredKm2 = useMemo(() => memoryPointCount * 0.000541, [memoryPointCount]);

  // R21 (2026-08-17 user "0.0 不要写", "走了一段写 0.1 km 这种"):
  // display precision + suppression. Below 0.05 km² → no digits (H0).
  // 0.05–0.1 → 0.1 (round up so users see progress right away).
  // Above → normal .toFixed(1).
  // Also: if state is H1 but exploredKm2 < 0.05, fall back to H0-like
  // greeting (no digits) — user's "0.0" complaint.
  const hasMeaningfulExploration = exploredKm2 >= 0.05;
  const displayState = hasHike && hasMeaningfulExploration ? 'H1' : 'H0';

  const lastHike = useMemo(() => {
    if (!hasHike) return null;
    const sorted = [...validSessions].sort((a: any, b: any) => {
      const ta = typeof a.startedAt === 'number' ? a.startedAt : new Date(a.startedAt).getTime();
      const tb = typeof b.startedAt === 'number' ? b.startedAt : new Date(b.startedAt).getTime();
      return tb - ta;
    });
    return sorted[0];
  }, [hasHike, validSessions]);

  // R21 (2026-08-18): priority display — most recent unfinished action wins
  // over the last completed hike. Users see "resume or discard" instead of
  // "here's an old completed hike" when there's an in-progress session.
  const showLiveActivity = (liveStatus !== 'idle' || liveIsFinishing)
    && Boolean(liveActivityId)
    && String(liveOwnerUserId ?? '') === currentUserId;
  const topUnfinished = showLiveActivity || unfinishedActivity?.userId !== currentUserId
    ? null
    : unfinishedActivity;
  const showUnfinished = showLiveActivity || !!topUnfinished;
  const showSaveRecovery = Boolean(saveLostSessionId
    && saveLostPayload
    && String(saveLostPayload.userId) === currentUserId);
  const hasDiscoverySurface = isHomeFocused && appIsActive && presentationSurface === 'home' && !!presentationGroup;
  const homeWindow = resolveHomeStateWindow({
    saveRecovery: showSaveRecovery,
    activeOrRecoverable: showUnfinished,
    unannouncedDiscovery: hasDiscoverySurface,
    recentActivity: Boolean(lastHike),
    personalMemory: hasPersonalMemoryEvidence({
      memoryPointCount,
      ownedCairnCount,
      acquiredCairnCount,
      unreadAcquiredGroupCount: memoryUnreadCount,
    }),
  });
  const showPriorityActivity = homeWindow === 'save-recovery' || homeWindow === 'active-or-recoverable';
  const showDiscovery = homeWindow === 'discovery';
  const showMemoryReturn = homeWindow === 'memory';

  useFocusEffect(React.useCallback(() => {
    if (!currentUserId) return undefined;
    const presentation = useCairnPresentationStore.getState();
    if (presentation.viewerId !== currentUserId) void presentation.initialize(currentUserId);
    else void presentation.refresh();
    return () => {
      useCairnPresentationStore.getState().release('home');
    };
  }, [currentUserId]));

  useEffect(() => {
    if (!isHomeFocused || !appIsActive || showPriorityActivity || presentationBlocked) {
      useCairnPresentationStore.getState().release('home');
      return;
    }
    if (presentationPendingCount > 0) useCairnPresentationStore.getState().claim('home');
  }, [appIsActive, isHomeFocused, presentationBlocked, presentationPendingCount, presentationViewerId, showPriorityActivity]);

  useEffect(() => {
    if (!showDiscovery || !presentationGroup) return undefined;
    const cancelFrame = scheduleVisibleFrame(() => {
      void useCairnPresentationStore.getState().markActiveDisplayed('home').then(displayed => {
        if (displayed) void useCairnPresentationStore.getState().acknowledgeActive('home');
      });
    });
    return cancelFrame;
  }, [appIsActive, presentationGroup?.eventThroughId, presentationGroup?.token, showDiscovery]);
  const displayedMode = showLiveActivity ? liveActivityMode : topUnfinished?.activityMode;
  const displayedDistanceM = showLiveActivity ? liveDistanceM : (topUnfinished?.distanceM ?? 0);
  const displayedDurationS = showLiveActivity ? liveDurationS : (topUnfinished?.durationS ?? 0);
  const displayedStartedAt = showLiveActivity ? (liveStartedAt ?? Date.now()) : (topUnfinished?.startedAt ?? Date.now());
  const formatActivityDistance = (meters: number) => `${distance.format(meters, 1)} ${distance.unit}`;

  const displayedOperationalState = showLiveActivity
    ? deriveActivityOperationalState({
      trackingStatus: liveStatus,
      transitionState: liveTransitionState,
      isFinishing: liveIsFinishing,
    })
    : showUnfinished ? 'recovery' : 'stopped';
  const displayedStateCopy = activityStateCopy(displayedOperationalState, displayedMode);
  const discoveryHomeCopy = presentationGroup
    ? buildDiscoveryHomeCopy(presentationGroup, formatRelativeDay(presentationGroup.mergeStartedAt))
    : null;
  const lastCompletedMode = lastHike?.activityMode === 'running' ? 'running' as const : 'hiking' as const;
  const lastHikeTitle = showSaveRecovery
    ? cairnText('home-screen.activity-needs-saving')
    : showUnfinished
      ? displayedStateCopy.title
    : showDiscovery
      ? discoveryHomeCopy!.title
    : showMemoryReturn
      ? (memoryPointCount > 0 ? cairnText('home-screen.your-memory-is-growing') : cairnText('home-screen.your-cairns-are-in-memory'))
    : (lastHike?.name || (lastCompletedMode === 'running' ? cairnText('home-screen.recent-run') : cairnText('home-screen.recent-hike')));
  const lastHikeMeta = showSaveRecovery
    ? cairnText('home-screen.recorded-on-this-device-tap-to-retry')
    : showUnfinished
      ? cairnText('home-screen.value-value-value', { value1: formatActivityDistance(displayedDistanceM), value2: formatDuration(displayedDurationS), value3: formatRelativeDay(displayedStartedAt) })
    : showDiscovery
      ? discoveryHomeCopy!.meta
    : showMemoryReturn
      ? (memoryPointCount > 0 ? cairnText('home-screen.value-km-explored', { value1: Math.max(0.01, exploredKm2).toFixed(2) }) : cairnText('home.memory.cairns', { count: memoryCairnCount }))
    : (lastHike
    ? cairnText('home-screen.value-value-value', { value1: formatActivityDistance(lastHike.distanceM || 0), value2: formatDuration(lastHike.durationS || 0), value3: formatRelativeDay(lastHike.startedAt) })
    : '');
  const lastHikeDetails = showSaveRecovery
    ? [cairnText('home-screen.recorded-on-device'), cairnText('home-screen.action-required')]
    : showUnfinished
      ? [formatActivityDistance(displayedDistanceM), formatDuration(displayedDurationS), formatRelativeDay(displayedStartedAt)]
    : showDiscovery
      ? discoveryHomeCopy!.details
    : showMemoryReturn
      ? (memoryPointCount > 0
        ? [cairnText('home-screen.value-km-explored', { value1: Math.max(0.01, exploredKm2).toFixed(2) }), cairnText('home-screen.view-memory')]
        : [cairnText('home.memory.cairns-short', { count: memoryCairnCount }), cairnText('home-screen.view-memory')])
    : (lastHike
      ? [formatActivityDistance(lastHike.distanceM || 0), formatDuration(lastHike.durationS || 0), formatRelativeDay(lastHike.startedAt)]
      : []);

  const initial = ((user?.name ?? user?.email ?? '?').charAt(0) || '?').toUpperCase();
  const greetingName = user?.name || cairnText('home-screen.explorer');

  // R21 (2026-08-17 user "右上角小转换 icon 切百分比"): compute % of country
  // area. Only meaningful if we resolved a country. Uses hardcoded area map.
  const countryAreaKm2 = country ? COUNTRY_AREA_KM2[country.code] : undefined;
  const percentOfCountry = countryAreaKm2 ? (exploredKm2 / countryAreaKm2) * 100 : null;

  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    if (width > 0 && height > 0 && (dims?.w !== width || dims?.h !== height)) {
      setDims({ w: width, h: height });
    }
  };

  const scale = dims ? Math.min(dims.w / DESIGN_W, dims.h / DESIGN_H) : 1;

  const scenicTime = useScenicTimeState();
  const bgTokens = useMemo(
    // conditionOverride is a transient Dev/QA-only store field. It is not
    // persisted and normal weather resolution never reaches this review map.
    () => conditionOverride === 'sunny' || conditionOverride === 'cloudy' || conditionOverride === 'rain' || conditionOverride === 'snow'
      ? getWeatherReviewBackground(conditionOverride, scenicTime.timeOfDay)
      : getHomeBackground(effectiveCondition, Date.now(), scenicTime.timeOfDay, 'home', {
        sunriseMs: scenicTime.sunriseMs,
        sunsetMs: scenicTime.sunsetMs,
      }),
    [
      conditionOverride,
      effectiveCondition,
      scenicTime.sunriseMs,
      scenicTime.sunsetMs,
      scenicTime.timeOfDay,
    ],
  );

  // R21 (2026-08-17 user "DEV 改的是我的当前 GPS location + 切白天黑夜 + reset"):
  // DEV menu supports two independent overrides:
  //  - Location: 5 NZ cities → triggers real weather fetch → real condition
  //  - Day/Night: force UI to render day or night variant (independent of clock)
  //  - Reset: clear both, back to real GPS + real time
  // TODO: LAUNCH_GATE — remove before App Store submission.
  const setLocationOverride = useWeatherStore(s => s.setLocationOverride);
  const timeOfDayOverride = useWeatherStore(s => s.timeOfDayOverride);
  const setTimeOfDayOverride = useWeatherStore(s => s.setTimeOfDayOverride);
  const setConditionOverride = useWeatherStore(s => s.setConditionOverride);
  const setHikingIconCandidate = useWeatherStore(s => s.setHikingIconCandidate);
  const setRunningIconCandidate = useWeatherStore(s => s.setRunningIconCandidate);
  const [devMenuOpen, setDevMenuOpen] = useState(false);
  // R21 (2026-08-17 user "二次点击就是取消"): each toggle is idempotent —
  // click city A once = override, click A again = clear. Same for weather
  // and day/night. No "reset" button needed.

  return (
    <View
      style={[styles.root, bgTokens.variant === 'sunny-day' ? styles.sunnyFallback : null]}
      onLayout={onLayout}
    >
      {dims && (
        <View
          style={[
            styles.canvas,
            {
              width: DESIGN_W,
              height: DESIGN_H,
              transform: [{ scale }],
            },
          ]}
        >
          <GeneratedHome
            state={showPriorityActivity || showDiscovery || showMemoryReturn ? 'H1' : displayState}
            initial={initial}
            greetingName={greetingName}
            exploredKm2={exploredKm2}
            countryName={country?.name}
            percentOfCountry={percentOfCountry ?? undefined}
            showPercent={showPercent}
            onToggleUnit={() => setShowPercent(v => !v)}
            lastHikeTitle={lastHikeTitle}
            lastHikeMeta={lastHikeMeta}
            lastHikeDetails={lastHikeDetails}
            lastHikeEyebrow={showSaveRecovery
              ? cairnText('home-screen.save-needs-attention')
              : showUnfinished
                ? displayedStateCopy.eyebrow
              : showDiscovery
                ? cairnText('home-screen.found-in-your-walk')
              : showMemoryReturn
                ? cairnText('home-screen.your-memory')
              : (lastCompletedMode === 'running' ? cairnText('home-screen.last-run') : cairnText('home-screen.last-hike'))}
            lastHikeMode={showSaveRecovery ? saveLostPayload?.activityMode : showUnfinished ? displayedMode : lastCompletedMode}
            onLastHikePress={showSaveRecovery
              ? () => nav.navigate(saveLostPayload!.activityMode === 'running' ? 'Running' : 'Hiking')
              : showUnfinished
              ? () => {
                  if (showLiveActivity) {
                    nav.navigate(liveActivityMode === 'running' ? 'Running' : 'Hiking');
                    return;
                  }
                  const activity = topUnfinished!;
                  nav.navigate(
                    activity.activityMode === 'running' ? 'Running' : 'Hiking',
                    { recoverClientActivityId: activity.clientActivityId },
                  );
                }
              : showDiscovery
                ? () => {
                    const destination = resolveDiscoveryHomeDestination(presentationGroup!.singleMarkerId);
                    if (destination.screen === 'AcquiredCairnDetail') {
                      nav.navigate(destination.screen, destination.params);
                    } else {
                      nav.navigate(destination.screen, destination.params);
                    }
                  }
              : showMemoryReturn
                ? () => nav.navigate('Memory')
              : lastHike
                ? () => nav.navigate('MapHistory', {
                    sessionId: lastHike.id,
                    activityBackContext: 'previous',
                  })
                : undefined}
            memoryUnreadCount={memoryUnreadCount}
            onHikingPress={() => nav.navigate('Hiking')}
            onRunningPress={() => nav.navigate('Running')}
            onPlantPress={() => nav.navigate('Plant', { origin: { kind: 'standalone' } })}
            bgAsset={bgTokens.bgAsset}
            bgTokens={bgTokens}
            forcedIsDark={!bgTokens.useDarkText}
            sunnyMotionEnabled={SUNNY_AMBIENT_MOTION_ENABLED && bgTokens.variant === 'sunny-day'}
            hikingIconCandidate={debugMode ? hikingIconCandidate : null}
            runningIconCandidate={debugMode ? runningIconCandidate : null}
          />
          <View style={styles.otaBadge} pointerEvents="box-none">
            <OtaReleaseMarker />
          </View>
          {qaToolsAvailable && debugMode && (
            <View style={{ position: 'absolute', right: 20, top: 56 }}>
              <TouchableOpacity
                onPress={() => setDevMenuOpen(v => !v)}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                style={{
                  width: 34, height: 34, borderRadius: 17,
                  backgroundColor: 'rgba(255,255,255,0.7)',
                  alignItems: 'center', justifyContent: 'center',
                  borderWidth: 1, borderColor: 'rgba(33,54,44,0.15)',
                }}
                accessibilityLabel={cairnText('home-screen.dev-weather-cycler')}
              >
                <Text style={{ fontSize: 10, fontWeight: '900', color: '#21362C', letterSpacing: 0.5 }}>{cairnText('home-screen.dev')}</Text>
              </TouchableOpacity>
              {devMenuOpen && (
                <View style={{
                  position: 'absolute', right: 0, top: 42,
                  backgroundColor: 'rgba(255,255,255,0.97)',
                  borderRadius: 12,
                  paddingVertical: 6,
                  paddingHorizontal: 8,
                  width: 230,
                  shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 12, shadowOffset: { width: 0, height: 4 },
                  elevation: 6,
                }}>
                  <Text style={{ paddingHorizontal: 4, paddingTop: 2, paddingBottom: 3, fontSize: 9, fontWeight: '700', color: '#8A8F95', letterSpacing: 0.5 }}>{cairnText('home-screen.location')}</Text>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginBottom: 4 }}>
                    {NZ_TEST_CITIES.map((city) => {
                      const active = locationOverride?.label === city.label;
                      return (
                        <TouchableOpacity
                          key={city.label}
                          onPress={() => {
                            // Second click = toggle off (real GPS)
                            if (active) {
                              setLocationOverride(null);
                            } else {
                              setLocationOverride({ label: city.label, lat: city.lat, lon: city.lon });
                            }
                            setDevMenuOpen(false);
                          }}
                          style={{
                            paddingVertical: 4, paddingHorizontal: 8,
                            borderRadius: 8,
                            backgroundColor: active ? 'rgba(33,54,44,0.15)' : 'rgba(33,54,44,0.05)',
                          }}
                        >
                          <Text style={{ fontSize: 11, fontWeight: '600', color: '#21362C' }}>
                            {city.label}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                  <Text style={{ paddingHorizontal: 4, paddingTop: 2, paddingBottom: 3, fontSize: 9, fontWeight: '700', color: '#8A8F95', letterSpacing: 0.5 }}>{cairnText('home-screen.weather')}</Text>
                  <View style={{ flexDirection: 'row', gap: 4, marginBottom: 4 }}>
                    {(['sunny','cloudy','rain','snow'] as const).map((c) => {
                      const active = conditionOverride === c;
                      return (
                        <TouchableOpacity
                          key={c}
                          onPress={() => {
                            setConditionOverride(active ? null : c);
                            setDevMenuOpen(false);
                          }}
                          style={{
                            flex: 1, paddingVertical: 4, paddingHorizontal: 4,
                            borderRadius: 8,
                            alignItems: 'center',
                            backgroundColor: active ? 'rgba(33,54,44,0.15)' : 'rgba(33,54,44,0.05)',
                          }}
                        >
                          <Text style={{ fontSize: 11, fontWeight: '600', color: '#21362C', textTransform: 'capitalize' }}>
                            {c}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                  <Text style={{ paddingHorizontal: 4, paddingTop: 2, paddingBottom: 3, fontSize: 9, fontWeight: '700', color: '#8A8F95', letterSpacing: 0.5 }}>{cairnText('home-screen.time')}</Text>
                  <View style={{ flexDirection: 'row', gap: 4, marginBottom: 4 }}>
                    {([null, 'day', 'sunset', 'night'] as const).map((time) => {
                      const active = timeOfDayOverride === time;
                      return (
                        <TouchableOpacity
                          key={time ?? 'auto'}
                          onPress={() => {
                            setTimeOfDayOverride(time);
                            setDevMenuOpen(false);
                          }}
                          style={{
                            flex: 1, paddingVertical: 4, alignItems: 'center', borderRadius: 8,
                            backgroundColor: active ? 'rgba(33,54,44,0.15)' : 'rgba(33,54,44,0.05)',
                          }}
                        >
                          <Text style={{ fontSize: 10, fontWeight: '600', color: '#21362C', textTransform: 'capitalize' }}>
                            {time ?? cairnText('home-screen.auto')}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                  <Text style={{ paddingHorizontal: 4, paddingBottom: 2, fontSize: 9, color: '#6D746F' }}>{cairnText('home-screen.resolved-value-value', { timeOfDay: scenicTime.timeOfDay, assetId: bgTokens.assetId })}</Text>
                  <Text style={{ paddingHorizontal: 4, paddingTop: 4, paddingBottom: 3, fontSize: 9, fontWeight: '700', color: '#8A8F95', letterSpacing: 0.5 }}>{cairnText('home-screen.action-icons-review-only')}</Text>
                  <View style={{ flexDirection: 'row', gap: 4, marginBottom: 4 }}>
                    {(['H1', 'H2', 'H3', 'H4', 'H5'] as const).map(candidate => (
                      <TouchableOpacity
                        key={candidate}
                        onPress={() => setHikingIconCandidate(hikingIconCandidate === candidate ? null : candidate)}
                        style={{ flex: 1, paddingVertical: 4, alignItems: 'center', borderRadius: 8, backgroundColor: hikingIconCandidate === candidate ? 'rgba(33,54,44,0.15)' : 'rgba(33,54,44,0.05)' }}
                      >
                        <Text style={{ fontSize: 10, fontWeight: '700', color: '#21362C' }}>{candidate}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                  <View style={{ flexDirection: 'row', gap: 4, marginBottom: 4 }}>
                    {(['R1', 'R2', 'R3', 'R4', 'R5'] as const).map(candidate => (
                      <TouchableOpacity
                        key={candidate}
                        onPress={() => setRunningIconCandidate(runningIconCandidate === candidate ? null : candidate)}
                        style={{ flex: 1, paddingVertical: 4, alignItems: 'center', borderRadius: 8, backgroundColor: runningIconCandidate === candidate ? 'rgba(33,54,44,0.15)' : 'rgba(33,54,44,0.05)' }}
                      >
                        <Text style={{ fontSize: 10, fontWeight: '700', color: '#21362C' }}>{candidate}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                  <TouchableOpacity
                    testID="open-debug-tools"
                    onPress={() => {
                      setDevMenuOpen(false);
                      nav.navigate('Debug');
                    }}
                    style={{ marginTop: 6, paddingVertical: 8, alignItems: 'center', borderRadius: 8, backgroundColor: 'rgba(33,54,44,0.10)' }}
                  >
                    <Text style={{ fontSize: 11, fontWeight: '700', color: '#21362C' }}>{cairnText('home-screen.open-debug-tools')}</Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center' },
  canvas: { overflow: 'hidden' },
  otaBadge: { position: 'absolute', right: 12, top: 52, zIndex: 1000 },
  sunnyFallback: { backgroundColor: '#79A8BE' },
});
