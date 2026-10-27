/**
 * MemoryScreen — Memory tab screen.
 *
 * v0.2.6.4 R-round:
 *   R4: prefer the watcher's cached fix (useMemoryStore.lastWatcherFix)
 *       over getCurrentPositionAsync. Avoids dual-watcher conflict on
 *       iOS that caused 12s timeouts when Hiking watcher was active.
 *   R5: mountKey is useState (not useRef) so its bump actually
 *       triggers re-render and MemoryMap remount.
 *   R7: recenter only bumps cameraKey; if no fresh fix is available
 *       it falls back to the watcher cache; the retryToken refetch is
 *       gated on actual staleness.
 *   R8: showHint waits for settings store hydrate so existing users
 *       don't see a one-frame flash of the hint.
 *   R9: rapid focus events are debounced — at most one GPS refetch
 *       per 5 seconds.
 */

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Animated, Image, View, StyleSheet, SafeAreaView, Text, ActivityIndicator, TouchableOpacity, Linking, InteractionManager, FlatList, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Location from 'expo-location';
import { useNavigation, useFocusEffect, useIsFocused } from '@react-navigation/native';
import { useMemoryStore } from '../store/useMemoryStore';
import { useSettingsStore } from '../../../store/useSettingsStore';
import { useActivitySimulatorStore } from '../../activitySimulator/useActivitySimulatorStore';
import { useMemorySettingsStore } from '../store/useMemorySettingsStore';
import { useMemoryScopeStore } from '../store/useMemoryScopeStore';
import { useMemorySubscriptionsStore } from '../store/useMemorySubscriptionsStore';
import { useFriendMemoryStore } from '../store/useFriendMemoryStore';
import { usePreparedMemoryCoverageStore } from '../store/usePreparedMemoryCoverageStore';
import { useMemoryCameraStore } from '../store/useMemoryCameraStore';
import { useMemoryNavigationSessionStore } from '../store/useMemoryNavigationSessionStore';
import { useFriendStore } from '../../../store/useFriendStore';
import { readLastFix } from '../services/lastFixCache';
import { MemoryColors } from '../config/memoryConfig';
import { MemoryMap, type MemoryMapHandle } from '../components/MemoryMap';
import { MapLoadOverlay, type MapLoadState } from '../../../components/MapLoadOverlay';
import { MEMORY_TOP_CONTROL_HEIGHT, MemoryScopeToggle } from '../components/MemoryScopeToggle';
import { MemoryFriendPickModal } from '../components/MemoryFriendPickModal';
import { BackButton } from '../../../components/BackButton';
import { Icon } from '../../../components/Icon';
import { CairnIcon } from '../../../components/CairnIcon';
import { Colors, FontSize, Radius, Shadow, Spacing } from '../../../components/tokens';
import { useVisualTheme } from '../../../hooks/useVisualTheme';
import { useAppIsActive } from '../../../hooks/useAppIsActive';
import { log, flushNow as flushLogsNow } from '../../../services/appLog';
// v322: ForegroundUnlockManager moved here from App root. Mounts only
// when MemoryScreen mounts, unmounts when user leaves. This means H3 +
// memory hydrate + pullMemoryFromServer only run when fog is actually
// being viewed — fixes login-time crash where eager-loading these on
// Home (which has no fog UI) crashed the app.
import { ForegroundUnlockManager } from '../components/ForegroundUnlockManager';
// v425: fly to real explored point inside sibling region (bug 2 fix)
import { ModalCard, ModalCardHeader } from '../../../components/ModalCard';
import { AppButton } from '../../../components/AppButton';
import { useMarkerStore } from '../../../store/useMarkerStore';
import { useAppStore } from '../../../store/useAppStore';
import { useCairnPresentationStore } from '../../cairns/cairnPresentationStore';
import { PublicWalkingDiscoveryCard } from '../../public/components/PublicWalkingDiscoveryCard';
import { stableAcquiredGroupOrder } from '../components/acquiredCairnClusters';
import { pullMemoryFromServer } from '../../../services/memorySync';
import { publishInitialMemoryReconcile } from '../services/memoryPersistence';
// v427: async hierarchy from /api/hierarchy (world-wide data)
import { fetchDeepest } from '../services/hierarchyService';
import {
  resolveCachedMemoryCenter,
  resolveCurrentLocationViewport,
  resolveMemoryEntryCameraAuthority,
  resolveMemoryInitialMapCenter,
  type MemoryCityViewport,
} from '../services/memoryEntryCameraPolicy';
import {
  MEMORY_ENTRY_MESSAGE_DELAY_MS,
  MEMORY_WARM_ENTRY_MESSAGE_DELAY_MS,
  memoryFogTransitionIsVisiblyPending,
  memoryMinePreviewCanRender,
} from '../services/memoryEntryPresentation';
import { memoryUserLocationShouldMount } from '../services/memoryLocationOwnership';
import {
  memoryFogPreparingMayClearFailure,
  memoryFogTargetFailureVisible,
} from '../services/memoryFogReadiness';
import { claimMemoryGuidance } from '../services/memoryGuidance';
import {
  resolveMemoryCityCameraTarget,
  type MemoryCityCoverageSource,
} from '../services/memoryCityCameraTarget';
// v424 hierarchy panel
import { HierarchyPanel } from '../components/HierarchyPanel';
import { cairnText, formatCairnDate } from '../../../i18n/runtime';
// v427: hierarchy migrated to async /api/hierarchy — legacy static store deleted.

interface FixState { lat: number; lng: number }
/** S4 fix: extended freshness window to 10 minutes. Stale lat/lng is
 *  acceptable for showing the map (user typically opens Memory while
 *  near the last known location); the watcher updates as soon as user
 *  moves. This avoids spawning a competing high-accuracy one-shot that
 *  conflicts with the running watcher on iOS. */
const ONE_SHOT_TIMEOUT_MS = 12_000;
const WATCHER_FIX_FRESH_MS = 10 * 60 * 1000; // 10 min — stale lat/lng OK for map display
const FOCUS_REFETCH_DEBOUNCE_MS = 5_000;
const FOCUS_REMOUNT_DEBOUNCE_MS = 5 * 60 * 1000; // v302 N3: 30s→5min — Mapbox cold reload is heavy (1-3s), don't redo it during the same session unless old.

type FailReason = 'permission' | 'timeout' | 'error';

// v333: module-scope cache for "Looking for your position…" flicker fix
// (Spike L true root cause — transient store-state null causes the real
// <Text> node to mount for one paint cycle). The 30s TTL lets us bridge
// re-render hiccups without showing wildly stale coords. Lives at module
// scope so it survives MemoryScreen unmount/remount within a session
// (tab switching). Does NOT survive app cold start — that's fine.
// Dev caveat: Metro fast refresh resets module scope, so the fix is only
// verifiable on release builds.
const _lastKnownCoordByOwner = new Map<string, { lat: number; lng: number; ts: number }>();
// A combined Mapbox snapshot contains borrowed geography and cannot be
// independently re-authorized after focus, expiry, or revoke. Warm previews
// therefore hold only an exact, fully painted Mine scene.
let _authorizedMemoryPreview: {
  ownerId: string;
  scope: 'self';
  themeMode: string;
  uri: string;
  capturedAtMs: number;
} | null = null;
const MAX_MEMORY_PREVIEW_BYTES = 4 * 1024 * 1024;

function MemoryStateMark({ label }: { label: string }) {
  const theme = useVisualTheme();
  return (
    <>
      <View
        style={[
          styles.stateMark,
          {
            backgroundColor: theme.surface,
            borderColor: theme.border,
          },
        ]}
      >
        <CairnIcon name="memory" size={28} color={theme.iconActive} accent={theme.accent} active />
      </View>
      <Text style={[styles.stateEyebrow, { color: theme.foregroundSecondary }]}>{label}</Text>
    </>
  );
}

export function MemoryScreen() {
  const theme = useVisualTheme();
  // v317: mark memory-screen render entry. v316 server data showed user
  // navigated from login → Memory tab → crash. No beacon coverage in
  // MemoryScreen mount path.
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('../../../services/bootDiagnostics').markBootPhase('memory_screen_render_start');
  } catch {/* ignore */}
  const nav = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const watcherFix = useMemoryStore((s) => s.lastWatcherFix);
  const initialDone = useMemoryStore((s) => s.initialRevealDone);
  const memoryPoints = useMemoryStore((s) => s.points);
  const syntheticTestPoints = useMemoryStore((s) => s.testPoints);
  const presenceWitnesses = useMemoryStore((s) => s.presenceWitnesses);
  const localHydration = useMemoryStore((s) => s.localHydration);
  const debugMode = useSettingsStore((s) => s.debugMode);
  const simulatorEnabled = useActivitySimulatorStore((s) => s.enabled);
  const simulatorCurrent = useActivitySimulatorStore((s) => s.current);
  const syntheticQaAuthority = debugMode && simulatorEnabled;
  const memoryEvidenceContext = useMemo(() => {
    const times = (syntheticQaAuthority
      ? syntheticTestPoints.map(point => Number(point.ts))
      : presenceWitnesses.length > 0
      ? presenceWitnesses.flatMap(witness => [witness.firstObservedAtMs, witness.observedAtMs])
      : memoryPoints.map(point => Number(point.ts)))
      .filter(Number.isFinite)
      .sort((a, b) => a - b);
    if (times.length === 0) return null;
    return {
      first: formatCairnDate(new Date(times[0])),
      last: formatCairnDate(new Date(times[times.length - 1])),
    };
  }, [memoryPoints, presenceWitnesses, syntheticQaAuthority, syntheticTestPoints]);
  const firstVisitDone = useMemorySettingsStore((s) => s.firstVisitDone);
  const settingsHydrated = useMemorySettingsStore((s) => s.hydrated);
  const setSetting = useMemorySettingsStore((s) => s.set);

  const [oneShot, setOneShot] = useState<FixState | null>(null);
  const [failReason, setFailReason] = useState<FailReason | null>(null);
  const [refetchToken, setRefetchToken] = useState(0);
  const [recenterToken, setRecenterToken] = useState(0);
  const [mountKey, setMountKey] = useState(0);
  const mountKeyRef = useRef(0);
  const [showHint, setShowHint] = useState(false);
  // 2026-08-16 Round 5 fix: MemoryScreen is kept mounted by react-navigation
  // (native-stack keeps prev screens alive), and React Native <Modal> is a
  // root-level overlay. Without an isFocused gate the "Walk to unlock" modal
  // leaks over Settings/Friends/Map when user navigates away with the hint
  // still open. Gate Modal `visible={showHint && isFocused}`.
  const isMemoryFocused = useIsFocused();
  const appIsActive = useAppIsActive();
  const acquiredMarkers = useCairnPresentationStore(state => state.acquiredMarkers);
  const acquiredUnreadCount = useCairnPresentationStore(state => state.unreadCount);
  const [acquiredGroupIds, setAcquiredGroupIds] = useState<string[] | null>(null);
  const [acquiredClusterError, setAcquiredClusterError] = useState(false);
  const acquiredGroupRows = useMemo(() => {
    if (!acquiredGroupIds) return [];
    const byId = new Map(acquiredMarkers.map(marker => [marker.markerId, marker]));
    return acquiredGroupIds.flatMap(markerId => byId.get(markerId) ?? []);
  }, [acquiredGroupIds, acquiredMarkers]);
  useLayoutEffect(() => {
    if (acquiredGroupIds && acquiredGroupRows.length === 0) setAcquiredGroupIds(null);
  }, [acquiredGroupIds, acquiredGroupRows.length]);

  // v434 hierarchy panel state (2-layer tree: World → Country → City)
  const [hierarchyOpen, setHierarchyOpen] = useState(false);
  const [hierarchyTitleId, setHierarchyTitleId] = useState<string>('world');
  const [hierarchyCurrentCityId, setHierarchyCurrentCityId] = useState<string | null>(null);
  const [hierarchyCurrentCountryId, setHierarchyCurrentCountryId] = useState<string | null>(null);
  // Race guard: increment on every panel-open request; async fetch only
  // applies its state changes if this ref still matches at completion.
  const panelOpenRequestIdRef = useRef(0);
  const [flyToTarget, setFlyToTarget] = useState<{ center: [number, number]; zoom: number; token: number } | null>(null);
  const flyTokenRef = useRef(0);
  // v427: track map camera center so hierarchy panel opens based on
  // where user is looking, not their physical GPS position.
  const cameraCenterRef = useRef<{ lat: number; lng: number } | null>(null);

  // v447: imperative handle to MemoryMap so panel-open can pull the
  // true current center from the map (not stale cameraCenterRef which
  // only updates when onCameraChanged fires e.properties.center — a
  // condition that never actually happens on native during plain pan).
  const mapRef = useRef<MemoryMapHandle | null>(null);

  // v360: full UX loading state machine — replaces v359's simple 3s
  // hard timeout. Industry benchmark (Nielsen 10s attention limit,
  // Mapbox official latency guidance, AllTrails/Komoot offline UX):
  //   - 8s hard timeout (was 3s; 3s misjudged normal 4G as failure)
  //   - Stage-based loading copy at 0/2s/5s gives "things are happening"
  //     feedback (perceived speed +30% vs pure spinner per skeleton
  //     screen research)
  //   - On timeout, do NOT force-fade. Fade the overlay BUT keep a
  //     small top banner "网络较慢，未完全加载完 [重试]" so the user
  //     sees the partial state AND can retry without leaving the tab.
  //
  // States: 'loading' (overlay opaque) | 'ready' (faded out) | 'slow'
  // (faded out + banner).
  const [mapReady, setMapReady] = useState(false);
  const entryStartedAtRef = useRef(Date.now());
  const qaReadinessTimersRef = useRef<Array<ReturnType<typeof setTimeout>>>([]);
  const qaReadinessScheduledRef = useRef(new Set<string>());
  // Outgoing sharing is managed in Friends; this is display selection only.
  const [pickModalOpen, setPickModalOpen] = useState(false);
  const memoryScope = useMemoryScopeStore((s) => s.scope);
  const setMemoryScope = useMemoryScopeStore((s) => s.setScope);
  const activateMemoryScopeOwner = useMemoryScopeStore((s) => s.activateOwner);
  const [fogReady, setFogReady] = useState(false);
  const [fogPresentationVersion, setFogPresentationVersion] = useState(0);
  const [fogScenePending, setFogScenePending] = useState(false);
  const [fogUnavailable, setFogUnavailable] = useState(false);
  const fogTargetReadinessKeyRef = useRef('');
  const fogReadyReadinessKeyRef = useRef('');
  const fogUnavailableReadinessKeyRef = useRef('');
  const entryUsableRef = useRef(false);
  const [entryVeilMounted, setEntryVeilMounted] = useState(true);
  const entryVeilOpacity = useRef(new Animated.Value(1)).current;
  const [entryMapLoadState, setEntryMapLoadState] = useState<MapLoadState>('loading');
  const [cameraTransitionState, setCameraTransitionState] = useState<MapLoadState | null>(null);
  const [cityNavigationNotice, setCityNavigationNotice] = useState<string | null>(null);
  // v413: friend memory 加载 — Memory 页 mount + subscribed friends 变化时拉 /api/circle/fog
  const subscriptions = useMemorySubscriptionsStore((s) => s.subscriptions);
  const loadSubs = useMemorySubscriptionsStore((s) => s.load);
  const retrySelectionIntents = useMemorySubscriptionsStore((s) => s.retrySelectionIntents);
  const selectionError = useMemorySubscriptionsStore((s) => s.selectionError);
  const hydrateFriendProjections = useFriendMemoryStore((s) => s.hydrate);
  const friendProjectionError = useFriendMemoryStore((s) => s.error);
  const friendMemoryVersion = useFriendMemoryStore((s) => s.version);
  const hasVisibleFriendCoverage = useMemo(
    () => memoryScope !== 'self' && useFriendMemoryStore.getState().getVisibleGeometries().length > 0,
    [friendMemoryVersion, memoryScope],
  );
  const userId = useAppStore((s) => s.user?.id ?? null);
  const activeOwnerId = userId == null ? null : String(userId);
  const cameraOwnerId = useMemoryCameraStore((s) => s.ownerId);
  const cameraHydrated = useMemoryCameraStore((s) => s.hydrated);
  const manualCity = useMemoryCameraStore((s) => s.manualCity);
  const hydrateMemoryCamera = useMemoryCameraStore((s) => s.hydrate);
  const selectMemoryCity = useMemoryCameraStore((s) => s.selectCity);
  const clearManualMemoryCity = useMemoryCameraStore((s) => s.clearManualCity);
  const loadCircleMarkers = useMarkerStore((s) => s.loadCircleMarkers);
  // Bug-5 fix: pre-load friend list on Memory mount so friend picker always
  // has data immediately (previously required visiting Friends tab first).
  const loadFriendsFromBackend = useFriendStore((s) => s.loadFriendsFromBackend);
  const friendsLoadedRef = useRef(false);
  const restoredManualCityRef = useRef<string | null>(null);
  const manualBrowseThisMountRef = useRef(false);
  const hasFocusedNavigationSessionRef = useRef(false);
  const currentCityAppliedRef = useRef<string | null>(null);
  const currentLocationViewportRef = useRef<MemoryCityViewport | null>(null);
  const captureLocalOverlay = useCallback(() => {
    const memoryState = useMemoryStore.getState();
    const pending = new Set(memoryState.pendingPreparedCoverageCids);
    return memoryState.points.filter(point => (
      !point.synced || Boolean(point.cid && pending.has(point.cid))
    ));
  }, []);
  useEffect(() => {
    if (!activeOwnerId) return undefined;
    const localOverlayReady = localHydration.ownerUserId === activeOwnerId
      && localHydration.status === 'ready';
    const frozenLocalOverlay = localOverlayReady ? captureLocalOverlay() : [];
    const sessionId = useMemoryNavigationSessionStore.getState()
      .begin(activeOwnerId, frozenLocalOverlay, localOverlayReady);
    log('memory.navigation_session_begin', {
      session_id: sessionId,
      owner_id: activeOwnerId,
      local_overlay_n: frozenLocalOverlay.length,
      local_overlay_ready: localOverlayReady,
    });
    return () => {
      useMemoryNavigationSessionStore.getState().end(sessionId);
      // Friend geometry is process-only and belongs to this navigation flow.
      // A real route exit releases its proof timers/controllers and borrowed
      // coordinates; Cairns/detail pushes do not unmount this screen.
      useFriendMemoryStore.getState().reset();
      log('memory.navigation_session_end', { session_id: sessionId, owner_id: activeOwnerId });
    };
  // Hydration completion is captured below without redefining session lifetime.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeOwnerId, captureLocalOverlay]);
  useEffect(() => {
    if (!activeOwnerId || localHydration.ownerUserId !== activeOwnerId
      || localHydration.status !== 'ready') return;
    useMemoryNavigationSessionStore.getState()
      .pinLocalOverlay(activeOwnerId, captureLocalOverlay());
  }, [activeOwnerId, captureLocalOverlay, localHydration.ownerUserId, localHydration.status]);
  useEffect(() => {
    // Remember the user's Mine/Friends choice while navigating in the same
    // signed-in session, but never carry it across an account boundary.
    activateMemoryScopeOwner(activeOwnerId);
  }, [activateMemoryScopeOwner, activeOwnerId]);
  useEffect(() => {
    if (!activeOwnerId) return;
    useMemoryNavigationSessionStore.getState().setPresentation(activeOwnerId, {
      selectedCityId: manualCity?.cityId ?? hierarchyCurrentCityId,
      scope: memoryScope,
      selectedFriendIds: subscriptions.map(source => String(source.friend_id)),
    });
  }, [activeOwnerId, hierarchyCurrentCityId, manualCity?.cityId, memoryScope, subscriptions]);
  useEffect(() => {
    if (!activeOwnerId || cameraOwnerId === activeOwnerId) return;
    void hydrateMemoryCamera(activeOwnerId);
  }, [activeOwnerId, cameraOwnerId, hydrateMemoryCamera]);
  useEffect(() => {
    // Bug-5: load friends once per mount if not already loaded this session
    if (!friendsLoadedRef.current) {
      friendsLoadedRef.current = true;
      void loadFriendsFromBackend();
    }
  }, [loadFriendsFromBackend]);
  const openFriendPicker = useCallback(() => {
    setPickModalOpen(true);
  }, []);
  const friendRegionSources = useMemo(() => {
    const result: Record<string, {
      names: string[];
      region: {
        id: string;
        parentId: string | null;
        level: 2 | 3;
        name: string;
        bbox: [number, number, number, number];
        anchor: [number, number];
      };
    }> = {};
    const namesById = new Map(subscriptions.map(source => [String(source.friend_id), source.friend_name]));
    for (const region of useFriendMemoryStore.getState().getVisibleRegions()) {
      const friendName = namesById.get(region.sourceFriendId);
      if (!friendName) continue;
      const current = result[region.id] ?? { names: [], region };
      if (!current.names.includes(friendName)) current.names.push(friendName);
      current.names.sort((a, b) => a.localeCompare(b));
      result[region.id] = current;
    }
    return result;
  // The version is the render signal; getVisibleRegions applies current
  // source/version authorization and never reads persisted Friend geometry.
  }, [friendMemoryVersion, subscriptions]);

  const handlePickModalClose = useCallback(() => {
    setPickModalOpen(false);
  }, []);

  const handleCameraCenter = useCallback(
    (lat: number, lng: number, sourceMountKey: number) => {
      if (mountKeyRef.current !== sourceMountKey) return;
      cameraCenterRef.current = { lat, lng };
    },
    [],
  );
  const handleMapUnavailable = useCallback((sourceMountKey: number) => {
    if (mountKeyRef.current !== sourceMountKey) return;
    log('memory.map_renderer_unavailable', {});
    // The fallback is a completed, usable state. It has no fog renderer, so
    // satisfy both presentation gates without claiming geometry was drawn.
    setMapReady(true);
    setFogReady(true);
  }, []);
  // One parent-owned veil covers both basemap and Fog readiness. MemoryMap
  // reports renderer state but never paints a competing loading page.
  useEffect(() => {
    entryStartedAtRef.current = Date.now();
    qaReadinessTimersRef.current.forEach(clearTimeout);
    qaReadinessTimersRef.current = [];
    qaReadinessScheduledRef.current.clear();
    entryUsableRef.current = false;
    fogTargetReadinessKeyRef.current = '';
    fogReadyReadinessKeyRef.current = '';
    fogUnavailableReadinessKeyRef.current = '';
    setEntryVeilMounted(true);
    entryVeilOpacity.setValue(1);
    setMapReady(false);
    setFogReady(false);
    setFogScenePending(false);
    setEntryMapLoadState('loading');
    log('memory.entry_visible_state', { state: 'stable-placeholder', mount_key: mountKey });
    return () => {
      qaReadinessTimersRef.current.forEach(clearTimeout);
      qaReadinessTimersRef.current = [];
    };
  }, [entryVeilOpacity, mountKey]);

  // Development-only presentation harness. It drives the screen's actual
  // readiness state at exact boundaries so 0/50/…/4000 ms transitions are
  // genuine injected scenarios rather than timestamps sampled from a pair
  // of naturally slow map loads. Native callbacks are still recorded below,
  // but they cannot race or redefine a controlled scenario.
  useEffect(() => {
    const qaRoot = globalThis as typeof globalThis & {
      __cairnMemoryQaConfig?: {
        controlledReadiness?: boolean;
        readinessDelayMs?: number;
        events?: Array<Record<string, unknown>>;
      };
    };
    const qa = Platform.OS === 'web' && debugMode ? qaRoot.__cairnMemoryQaConfig : undefined;
    if (!qa?.controlledReadiness) return undefined;
    const sourceMountKey = mountKey;
    const delayMs = Math.max(0, Math.min(4_000, Number(qa.readinessDelayMs) || 0));
    const elapsedMs = Date.now() - entryStartedAtRef.current;
    const remainingMs = Math.max(0, delayMs - elapsedMs);
    qa.events?.push({ kind: 'combined', phase: 'injected-scheduled', elapsedMs, delayMs, remainingMs });
    const deliver = () => {
      if (mountKeyRef.current !== sourceMountKey) return;
      qa.events?.push({ kind: 'combined', phase: 'delivered', elapsedMs: Date.now() - entryStartedAtRef.current });
      setMapReady(true);
      setFogReady(true);
    };
    if (remainingMs <= 0) {
      deliver();
      return undefined;
    }
    const timer = setTimeout(deliver, remainingMs);
    qaReadinessTimersRef.current.push(timer);
    return () => clearTimeout(timer);
  }, [debugMode, mountKey]);

  const deliverReadiness = useCallback((kind: 'map' | 'fog', sourceMountKey: number, apply: () => void, authorityKey = 'entry') => {
    const qaRoot = globalThis as typeof globalThis & {
      __cairnMemoryQaConfig?: {
        controlledReadiness?: boolean;
        readinessDelayMs?: number;
        events?: Array<Record<string, unknown>>;
      };
    };
    if (Platform.OS === 'web' && debugMode && qaRoot.__cairnMemoryQaConfig?.controlledReadiness) {
      qaRoot.__cairnMemoryQaConfig.events?.push({
        kind,
        phase: 'native-observed',
        elapsedMs: Date.now() - entryStartedAtRef.current,
      });
      return;
    }
    const configuredDelay = Platform.OS === 'web' && debugMode
      ? Number(qaRoot.__cairnMemoryQaConfig?.readinessDelayMs ?? 0)
      : 0;
    // Map is one-shot per mount; Fog can publish many exact authorities while
    // the retained MapView stays mounted. Keying only by `kind` dropped every
    // Friends/Mine readiness after the first scene and left the loader stuck.
    const deliveryKey = `${sourceMountKey}:${kind}:${authorityKey}`;
    if (qaReadinessScheduledRef.current.has(deliveryKey)) return;
    qaReadinessScheduledRef.current.add(deliveryKey);
    const elapsedMs = Date.now() - entryStartedAtRef.current;
    const remainingMs = Number.isFinite(configuredDelay)
      ? Math.max(0, Math.min(4_000, configuredDelay) - elapsedMs)
      : 0;
    const deliver = () => {
      if (mountKeyRef.current !== sourceMountKey) return;
      qaRoot.__cairnMemoryQaConfig?.events?.push({ kind, phase: 'delivered', elapsedMs: Date.now() - entryStartedAtRef.current });
      apply();
    };
    qaRoot.__cairnMemoryQaConfig?.events?.push({ kind, phase: 'native-ready', elapsedMs, remainingMs });
    if (remainingMs <= 0) deliver();
    else qaReadinessTimersRef.current.push(setTimeout(deliver, remainingMs));
  }, [debugMode]);

  // Retry handler: reset state + bump refetchToken to re-trigger pull.
  const handleRetryLoad = () => {
    log('v360.user_retry');
    setMapReady(false);
    setFogReady(false);
    setFogScenePending(false);
    setFogUnavailable(false);
    setCameraTransitionState(null);
    setRefetchToken((n) => n + 1);
    setMountKey((n) => {
      const next = n + 1;
      mountKeyRef.current = next;
      return next;
    });
  };

  const handleRetrySharedMap = useCallback(() => {
    fogUnavailableReadinessKeyRef.current = '';
    setFogUnavailable(false);
    setFogScenePending(true);
    void (async () => {
      await retrySelectionIntents();
      await loadSubs(true);
      const viewport = mapRef.current?.getCoverageViewport();
      const selectionStillPending = Object.keys(
        useMemorySubscriptionsStore.getState().selectionPending,
      ).length > 0;
      if (viewport && !selectionStillPending) {
        await useFriendMemoryStore.getState().loadSelectedProjections(undefined, viewport);
      }
    })();
  }, [loadSubs, retrySelectionIntents]);

  const initialMemoryOffline = Boolean(
    userId
    && localHydration.ownerUserId === String(userId)
    && localHydration.status === 'ready'
    && localHydration.requiresInitialReconcile
    && localHydration.initialReconcile === 'offline'
  );
  const handleRetryInitialMemory = useCallback(async () => {
    if (!userId) return;
    const owner = String(userId);
    if (!await publishInitialMemoryReconcile(owner, 'pending')) return;
    setFogUnavailable(false);
    setFogReady(false);
    await pullMemoryFromServer(owner, { reconcile: true });
  }, [userId]);

  // v333: Recenter button is hidden until the user actively pans/zooms.
  // User intent (decision E): "an icon like Hiking — only appears after I
  // move the map, so I can get back to my current location."
  //
  // R8-5 fix (Engineer #8): if the persisted lastWatcherFix (from a
  // prior session, possibly a different city) is far from the just-
  // acquired GPS fix, force mapMoved=true so the Recenter button shows
  // immediately — otherwise a user who flies from city A to city B
  // would be stranded looking at city A with no visible way to find
  // themselves except panning blindly.
  //
  // UX #11 CRIT-2 fix: GPS cold-start can flutter 500m-2km on first
  // 1-2 fixes even when user is at home. To avoid false positives:
  //  (a) require horizontal accuracy < 100m before trusting the sample
  //  (b) raise dist threshold to 2km (true cross-city, not GPS noise)
  //  (c) keep re-evaluating until accuracy is good enough (no one-shot
  //      ref that locks in the first fluttered fix forever)
  const [mapMoved, setMapMoved] = useState(false);
  useEffect(() => {
    if (mapMoved) return;       // already true: nothing to do
    if (!watcherFix) return;
    let cancelled = false;
    (async () => {
      try {
        const fresh = await Location.getLastKnownPositionAsync({ maxAge: 30_000 });
        if (cancelled || !fresh) return;
        // UX #11 CRIT-2: drop fluttered low-accuracy fixes
        if (fresh.coords.accuracy != null && fresh.coords.accuracy > 100) return;
        const freshLat = fresh.coords.latitude;
        const freshLng = fresh.coords.longitude;
        const M_PER_DEG_LAT = 111320;
        const cosLat = Math.cos(((watcherFix.lat + freshLat) / 2 * Math.PI) / 180);
        const dy = (freshLat - watcherFix.lat) * M_PER_DEG_LAT;
        const dx = (freshLng - watcherFix.lng) * M_PER_DEG_LAT * Math.max(cosLat, 1e-6);
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > 2000) {
          log('memory.cross_city_detected', { dist_m: Math.round(dist) });
          setMapMoved(true);
        }
      } catch {
        // Best-effort — if GPS lookup fails, fall back to user gesture
      }
    })();
    return () => { cancelled = true; };
  }, [watcherFix, mapMoved]);
  const lastRefetchAtRef = useRef(0);
  // S3 fix: separate debounce for the EXPENSIVE map remount.
  const lastMountAtRef = useRef(0);
  useEffect(() => {
    if (!settingsHydrated || !activeOwnerId) return undefined;
    if (localHydration.ownerUserId !== activeOwnerId || localHydration.status !== 'ready') return undefined;
    let cancelled = false;
    void claimMemoryGuidance({
      ownerId: activeOwnerId,
      hasExploredEvidence: memoryPoints.length > 0 || presenceWitnesses.length > 0,
      legacyDone: firstVisitDone,
    }).then(shouldShow => {
      if (!cancelled) setShowHint(shouldShow);
    });
    return () => { cancelled = true; };
  }, [activeOwnerId, firstVisitDone, localHydration.ownerUserId, localHydration.status, memoryPoints.length, presenceWitnesses.length, settingsHydrated]);

  // v326: hydrate persisted last-fix immediately on mount. If watcherFix
  // is already populated (warm reopen during the same session), do
  // nothing. Otherwise read AsyncStorage cache and write to store so the
  // map can draw at the last-known location while the watcher boots.
  // Prevents 12s "Looking for your position" on every cold-start.
  useEffect(() => {
    // The app-scoped Memory authority resets the in-memory projection before
    // it publishes this owner's durable state. Reading before that boundary
    // creates an intermittent race: this effect sees a warm fix and returns,
    // hydration clears it a moment later, and the unchanged userId means the
    // cache is never read again. Wait for the account-bound authority so the
    // cached fix is restored after (never before) its security reset.
    if (!activeOwnerId
      || localHydration.ownerUserId !== activeOwnerId
      || localHydration.status !== 'ready') return;
    if (useMemoryStore.getState().lastWatcherFix) return;
    let cancelled = false;
    void (async () => {
      const cached = await readLastFix(activeOwnerId);
      if (cancelled) return;
      if (!cached) return;
      const latestHydration = useMemoryStore.getState().localHydration;
      if (latestHydration.ownerUserId !== activeOwnerId
        || latestHydration.status !== 'ready') return;
      // Don't overwrite if a fresh watcher fix arrived during the await.
      if (useMemoryStore.getState().lastWatcherFix) return;
      log('memory.last_fix_hydrated', { age_ms: Date.now() - cached.ts });
      useMemoryStore.getState().setLastWatcherFix(
        cached.lat,
        cached.lng,
        cached.ts,
        cached.accuracyM,
        cached.provenance,
        cached.ownerId,
      );
    })();
    return () => { cancelled = true; };
  }, [activeOwnerId, localHydration.ownerUserId, localHydration.status]);

  useFocusEffect(
    React.useCallback(() => {
      let focusActive = true;
      const activeSession = useMemoryNavigationSessionStore.getState();
      const returningToRetainedSession = hasFocusedNavigationSessionRef.current
        && activeSession.ownerId === String(useAppStore.getState().user?.id ?? '')
        && Boolean(activeSession.sessionId)
        && Boolean(activeSession.camera);
      hasFocusedNavigationSessionRef.current = true;
      if (returningToRetainedSession) {
        // Cairns/detail and a short background transition retain the Memory
        // navigation session. Its last settled camera is authoritative: a
        // focus-owned location refresh must not re-run Current City and steal
        // centre/zoom/bearing/pitch after Back.
        manualBrowseThisMountRef.current = true;
        log('memory.navigation_session_camera_retained', {
          session_id: activeSession.sessionId,
          camera_action_id: activeSession.camera?.actionId ?? null,
        });
      }
      // O1 (2026-07-26) stale closure fix: 从 ref/store getState 拿 latest
      // 值。原代码 mountKey / settingsHydrated 在 React.useCallback(fn, [])
      // 空 deps 里读 = 永远拿首次 mount 时的 0 / false, log 数据完全失真
      // (server 收到 v357.mountKey_bumped 恒 from:0 to:1, 追不到真 remount
      // 序列)。改从 getState() 直接读避免 closure 陷阱,同时 setMountKey
      // 走 functional updater 已经用 latest。
      const settingsHydratedLatest = useMemorySettingsStore.getState().hydrated;
      const mountKeyLatest = mountKeyRef.current;
      // v357 diagnostic: tab focus entry — fires BEFORE mountKey bump.
      // The pair (v357.tab_focus_entry → v357.mountKey_bumped) lets us
      // see whether mountKey actually bumped this focus (debounce-gated)
      // or was skipped (FOCUS_REMOUNT_DEBOUNCE_MS window still active).
      // 2026-08-31: added `will_bump` field so we don't have to correlate
      // two logs — server can see at a glance whether Settings→Memory
      // return was fast (reuse) or slow (bump → cold Mapbox reload).
      const _msSinceLastMount = lastMountAtRef.current === 0 ? -1 : Date.now() - lastMountAtRef.current;
      // The screen is kept mounted, so a normal focus transition reuses the
      // same native map host. Automatic remounting was the second large
      // Preparing/map flash. Explicit Retry remains the only remount owner.
      const _willBump = false;
      log('v357.tab_focus_entry', {
        points_n: useMemoryStore.getState().points.length,
        mountKey_pre: mountKeyLatest,
        ms_since_last_mount: _msSinceLastMount,
        threshold_ms: FOCUS_REMOUNT_DEBOUNCE_MS,
        will_bump: _willBump,
      });
      // v303 OTA 三修:扩充 tab_focus log,包含进入时的 state 快照,server
      // 可看用户进 memory 时 fog / points / hydrate 状态。
      log('memory.tab_focus', {
        points: useMemoryStore.getState().points.length,
        initialDone: useMemoryStore.getState().initialRevealDone,
        settingsHydrated: settingsHydratedLatest,
        mountKey: mountKeyLatest,
      });
      // Child screens (Cairns/detail) blur and refocus this retained route.
      // The Memory navigation session owns these guards, not focus events;
      // clearing them here re-ran Current City and stole the saved camera.
      const now = Date.now();
      // Focus is a presentation transition, not an authorization mutation.
      // Keep an unexpired server-issued projection visible while the bounded
      // sources lease refreshes; projection expiry/revoke/logout still fences
      // borrowed geometry synchronously in the store.
      void (async () => {
        const ownerId = String(useAppStore.getState().user?.id ?? '');
        if (!ownerId) return;
        if (useFriendMemoryStore.getState().userId !== ownerId) {
          await hydrateFriendProjections(ownerId);
          if (!focusActive || String(useAppStore.getState().user?.id ?? '') !== ownerId) return;
        }
        const authorityLoaded = await loadSubs();
        if (!focusActive || authorityLoaded === false
          || String(useAppStore.getState().user?.id ?? '') !== ownerId) return;
        await retrySelectionIntents();
        if (!focusActive || String(useAppStore.getState().user?.id ?? '') !== ownerId) return;
        const selectionStillPending = Object.keys(
          useMemorySubscriptionsStore.getState().selectionPending,
        ).length > 0;
        // Camera is only a local render hint. Complete Mine/Friends snapshots
        // are reusable across screens and must not be invalidated on focus.
        const memoryViewport = mapRef.current?.getCoverageViewport();
        if (memoryViewport) {
          await Promise.all([
            usePreparedMemoryCoverageStore.getState().loadViewport(memoryViewport),
            selectionStillPending
              ? Promise.resolve()
              : useFriendMemoryStore.getState().loadSelectedProjections(undefined, memoryViewport),
          ]);
        }
        if (!focusActive || String(useAppStore.getState().user?.id ?? '') !== ownerId) return;
        await loadCircleMarkers();
      })();
      lastMountAtRef.current = now;
      if (now - lastRefetchAtRef.current >= FOCUS_REFETCH_DEBOUNCE_MS) {
        lastRefetchAtRef.current = now;
        setRefetchToken((n) => n + 1);
      }
      void useCairnPresentationStore.getState().refreshAcquiredMap();
      const focusStartedAt = Date.now();
      return () => {
        // An authorization refresh may still be in flight when the user opens
        // Route. Never let the blurred Memory task reclaim the two shared
        // coverage viewports or overwrite Route's active request generation.
        focusActive = false;
        log('memory.tab_blur', { total_focus_ms: Date.now() - focusStartedAt });
        // v327: force-flush logs on tab blur. Without this, all the
        // memory.* / fog.* / gps.* logs sit in the in-memory queue
        // until the app goes to background. User reported issues
        // while inside the tab can never be diagnosed otherwise.
        void flushLogsNow();
      };
    }, [hydrateFriendProjections, loadCircleMarkers, loadSubs, retrySelectionIntents])
  );

  // R4 + S1: only fetch a one-shot fix when (a) user explicitly
  // asked (refetchToken bumped) AND (b) watcher cache is stale.
  // The dep array is [refetchToken] — does NOT include watcherFix
  // so a watcher tick doesn't re-run this effect / wipe failReason.
  useEffect(() => {
    let cancelled = false;
    let timeoutTimer: ReturnType<typeof setTimeout> | null = null;

    // Simulator owns location inside the isolated QA workspace. Asking iOS
    // for physical GPS here centers Memory on the tester instead of the
    // simulated walk and makes accepted QA evidence appear to do nothing.
    if (syntheticQaAuthority) {
      setFailReason(null);
      setOneShot({ lat: simulatorCurrent.lat, lng: simulatorCurrent.lng });
      return () => {};
    }

    if (watcherFix && Date.now() - watcherFix.ts < WATCHER_FIX_FRESH_MS) {
      log('memory.using_watcher_fix', { age_ms: Date.now() - watcherFix.ts });
      // Watcher fresh — we're not going to fetch, but we should clear
      // any stale failReason so the success UI shows.
      setFailReason(null);
      return;
    }

    const fetchOnce = async () => {
      // T-round: only clear failReason when we actually start a new
      // attempt — otherwise Try-Again with a fresh watcher would clear
      // the error UI without surfacing a result.
      setFailReason(null);
      try {
        let perm = await Location.getForegroundPermissionsAsync();
        if (perm.status !== 'granted') {
          perm = await Location.requestForegroundPermissionsAsync();
        }
        if (cancelled) return;
        if (perm.status !== 'granted') {
          log('memory.permission_denied', { status: perm.status });
          setFailReason('permission');
          return;
        }
        const locPromise = Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.High,
        });
        const timeoutPromise = new Promise<never>((_, reject) => {
          timeoutTimer = setTimeout(() => reject(new Error('timeout')), ONE_SHOT_TIMEOUT_MS);
        });
        const loc = (await Promise.race([locPromise, timeoutPromise])) as Awaited<typeof locPromise>;
        if (timeoutTimer) { clearTimeout(timeoutTimer); timeoutTimer = null; }
        if (cancelled) return;
        if (loc.coords.accuracy != null && loc.coords.accuracy > 25) {
          log('memory.gps_fix_unqualified', { accuracy: loc.coords.accuracy });
          setFailReason('error');
          return;
        }
        log('memory.gps_fix_ok', { accuracy: loc.coords.accuracy });
        setOneShot({ lat: loc.coords.latitude, lng: loc.coords.longitude });
      } catch (e: any) {
        if (timeoutTimer) { clearTimeout(timeoutTimer); timeoutTimer = null; }
        if (cancelled) return;
        const reason: FailReason = e?.message === 'timeout' ? 'timeout' : 'error';
        log('memory.gps_fix_failed', { reason });
        setFailReason(reason);
      }
    };
    void fetchOnce();
    return () => {
      cancelled = true;
      if (timeoutTimer) { clearTimeout(timeoutTimer); timeoutTimer = null; }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refetchToken, simulatorCurrent.lat, simulatorCurrent.lng, syntheticQaAuthority]);

  // A stale watcher may be useful diagnostics, but it is not current-entry
  // camera authority. Showing it while a fresh attempt is unresolved is what
  // made an old city look like the user's present location.
  const watcherFresh = !!watcherFix && Date.now() - watcherFix.ts < WATCHER_FIX_FRESH_MS;
  const coord: FixState | null = watcherFresh && watcherFix
    ? { lat: watcherFix.lat, lng: watcherFix.lng }
    : oneShot
      ? oneShot
      : null;

  const ownedEvidenceForCamera = useMemo(() => {
    if (!activeOwnerId
      || localHydration.ownerUserId !== activeOwnerId
      || localHydration.status !== 'ready') return [];
    return syntheticQaAuthority
      ? syntheticTestPoints.map(point => ({ lat: point.lat, lng: point.lng, ts: point.ts }))
      : [
          ...memoryPoints.map(point => ({ lat: point.lat, lng: point.lng, ts: point.ts })),
          ...presenceWitnesses.map(witness => ({
            lat: witness.lat,
            lng: witness.lng,
            ts: witness.observedAtMs,
          })),
        ];
  }, [
    activeOwnerId,
    localHydration.ownerUserId,
    localHydration.status,
    memoryPoints,
    presenceWitnesses,
    syntheticQaAuthority,
    syntheticTestPoints,
  ]);

  // v333: stableCoord — fix the "Looking for your position…" flicker
  // (Spike L true root cause). When the Zustand selectors briefly
  // resolve coord to null within a single render commit cycle (e.g.
  // during a re-render where watcherFix/oneShot are transiently re-read
  // as null), the literal `<Text>` at line ~330 renders for one paint,
  // producing the user-visible flicker on zoom. Hold the last non-null
  // coord at module scope so this transient null falls back to a
  // recent known value. 30s TTL is enough to absorb GPS reacquisition
  // gaps while preventing wildly stale positions from being shown.
  // QA note: dev fast-refresh resets module scope; verify the fix on a
  // release build, not dev/Metro.
  useEffect(() => {
    if (coord && activeOwnerId) {
      _lastKnownCoordByOwner.set(activeOwnerId, { lat: coord.lat, lng: coord.lng, ts: Date.now() });
    }
  }, [activeOwnerId, coord]);
  const cachedLiveCoord = activeOwnerId ? _lastKnownCoordByOwner.get(activeOwnerId) : null;
  const stableCoord: FixState | null = coord ?? (
    cachedLiveCoord && Date.now() - cachedLiveCoord.ts < 30_000
      ? { lat: cachedLiveCoord.lat, lng: cachedLiveCoord.lng }
      : null
  );

  const freshCurrentEvidence = watcherFresh || Boolean(oneShot) || syntheticQaAuthority;
  const entryCameraAuthority = resolveMemoryEntryCameraAuthority({
    hasFreshCurrentEvidence: freshCurrentEvidence,
    locationAttemptFailed: Boolean(failReason),
    hasManualCity: Boolean(manualCity),
    manualBrowseThisMount: manualBrowseThisMountRef.current,
  });

  // v353 emergency fix: v352 placed this block at line 141 (BEFORE
  // stableCoord was declared at line 301). stableCoord was undefined
  // there → lastRenderedCoordRef.current never populated → persistentCoord
  // always null → user permanently saw "Looking for your position"
  // overlay and the map never rendered. Moved here, AFTER stableCoord
  // declaration, so the ref correctly captures the last valid coord.
  //
  // v352 intent: persist the last coord that MemoryMap was mounted
  // with, across re-renders. If stableCoord transiently becomes null
  // (selector hiccup during zoom-induced re-render), we render
  // MemoryMap with this last-known value instead of tearing it down
  // to a "Looking for position" overlay. Map never unmounts after
  // first successful render → no full-screen flash during pinch/zoom.
  const lastRenderedCoordRef = useRef<{
    ownerUserId: string;
    coord: { lat: number; lng: number };
  } | null>(null);
  const cachedMemoryCenter = useMemo(
    () => resolveCachedMemoryCenter(ownedEvidenceForCamera),
    [ownedEvidenceForCamera],
  );
  const nextMapCenter = resolveMemoryInitialMapCenter({
    authority: entryCameraAuthority,
    current: stableCoord,
    manualCenter: manualCity?.center ?? null,
    cachedMemoryCenter,
  });
  if (activeOwnerId && nextMapCenter) {
    lastRenderedCoordRef.current = {
      ownerUserId: activeOwnerId,
      coord: { lat: nextMapCenter.lat, lng: nextMapCenter.lng },
    };
  }
  const persistentCoord = activeOwnerId
    && lastRenderedCoordRef.current?.ownerUserId === activeOwnerId
    ? lastRenderedCoordRef.current.coord
    : null;

  const mapMayBeShown = Boolean(persistentCoord);
  const memoryEntryUsable = mapMayBeShown && mapReady && (fogReady || fogUnavailable);
  const targetFriendFailureVisible = memoryFogTargetFailureVisible({
    combinedScope: memoryScope !== 'self',
    failure: selectionError ?? friendProjectionError,
    targetReadinessKey: fogTargetReadinessKeyRef.current,
    readyReadinessKey: fogReadyReadinessKeyRef.current,
  });
  const authorizedPreviewUri = memoryMinePreviewCanRender({
    scope: memoryScope,
    ownerId: activeOwnerId,
    themeMode: theme.mode,
    preview: _authorizedMemoryPreview,
  })
    ? _authorizedMemoryPreview?.uri ?? null
    : null;
  useEffect(() => {
    if (!memoryEntryUsable) {
      if (!failReason) {
        setEntryVeilMounted(true);
        entryVeilOpacity.setValue(1);
        log('memory.entry_visible_state', {
          state: 'stable-placeholder',
          mount_key: mountKey,
          map_ready: mapReady,
          fog_ready: fogReady,
          has_center: mapMayBeShown,
        });
      }
      return undefined;
    }
    entryUsableRef.current = true;
    // Ready content wins immediately. The previous 150 ms JS-driven fade was
    // routinely stretched by initial map work and turned a fast readiness
    // signal into the Owner's perceived one-second mandatory interstitial.
    entryVeilOpacity.setValue(0);
    setEntryVeilMounted(false);
    log('memory.entry_visible_state', { state: 'usable-map', mount_key: mountKey });
    return undefined;
  }, [entryVeilOpacity, failReason, fogReady, fogUnavailable, mapMayBeShown, mapReady, memoryEntryUsable, mountKey]);
  useEffect(() => {
    if (!memoryEntryUsable || !activeOwnerId || memoryScope !== 'self') return undefined;
    let cancelled = false;
    const task = InteractionManager.runAfterInteractions(() => {
      void mapRef.current?.captureAuthorizedPreview().then(uri => {
        if (cancelled || !uri || uri.length > MAX_MEMORY_PREVIEW_BYTES) return;
        _authorizedMemoryPreview = {
          ownerId: activeOwnerId,
          scope: 'self',
          themeMode: theme.mode,
          uri,
          capturedAtMs: Date.now(),
        };
        log('memory.entry_preview_captured', {
          owner_id: activeOwnerId,
          scope: 'self',
          theme: theme.mode,
          bytes: uri.length,
        });
      });
    });
    return () => {
      cancelled = true;
      task.cancel?.();
    };
  }, [activeOwnerId, fogPresentationVersion, memoryEntryUsable, memoryScope, theme.mode]);
  useEffect(() => {
    if (!activeOwnerId || !cameraHydrated || cameraOwnerId !== activeOwnerId) return undefined;
    if (manualBrowseThisMountRef.current) return undefined;
    let cancelled = false;

    if (entryCameraAuthority === 'current' && stableCoord) {
      const applicationKey = `${activeOwnerId}:${stableCoord.lat.toFixed(5)},${stableCoord.lng.toFixed(5)}:${refetchToken}`;
      if (currentCityAppliedRef.current === applicationKey) return undefined;
      currentCityAppliedRef.current = applicationKey;
      const viewport = resolveCurrentLocationViewport(stableCoord);
      currentLocationViewportRef.current = viewport;
      flyTokenRef.current += 1;
      log('memory.camera_command', {
        intent: 'current-location-entry',
        token: flyTokenRef.current,
        center_lat: stableCoord.lat,
        center_lng: stableCoord.lng,
        zoom: viewport.zoom,
      });
      setFlyToTarget({ ...viewport, token: flyTokenRef.current });
      setMapMoved(false);
      restoredManualCityRef.current = null;
      if (manualCity) void clearManualMemoryCity();
      void (async () => {
        const { city, country } = await fetchDeepest(stableCoord.lat, stableCoord.lng);
        if (cancelled || manualBrowseThisMountRef.current) return;
        // Hierarchy metadata is deliberately not camera authority. A delayed
        // city response can update labels, but cannot pull the camera away
        // from the live puck or override an explicit Recenter.
        setHierarchyCurrentCityId(city?.id ?? null);
        setHierarchyCurrentCountryId(country?.id ?? city?.country_id ?? null);
      })();
      return () => { cancelled = true; };
    }

    // Do not restore a historical city while a fresh-location attempt is
    // unresolved. A stored manual city is only the fallback after that
    // attempt has explicitly failed.
    if (entryCameraAuthority !== 'manual-fallback' || !manualCity) return undefined;
    const restorationKey = `${activeOwnerId}:${manualCity.cityId}:${manualCity.center.join(',')}`;
    if (restoredManualCityRef.current === restorationKey) return undefined;
    restoredManualCityRef.current = restorationKey;
    currentLocationViewportRef.current = null;
    flyTokenRef.current += 1;
    log('memory.camera_command', {
      intent: 'manual-city-fallback',
      token: flyTokenRef.current,
      center_lat: manualCity.center[1],
      center_lng: manualCity.center[0],
      zoom: manualCity.zoom,
    });
    setFlyToTarget({ center: manualCity.center, zoom: manualCity.zoom, token: flyTokenRef.current });
    setHierarchyCurrentCityId(manualCity.cityId);
    setHierarchyCurrentCountryId(manualCity.countryId);
    setMapMoved(true);
    return undefined;
  }, [
    activeOwnerId,
    cameraHydrated,
    cameraOwnerId,
    clearManualMemoryCity,
    entryCameraAuthority,
    manualCity,
    oneShot,
    refetchToken,
    stableCoord,
  ]);

  // v327 debug: track WHY the "Looking for your position" UI appears.
  // User reports it shows up briefly during zoom — but zoom should not
  // affect coord. Log every change in the inputs that decide coord so
  // we can see the actual trigger.
  const coordSignature = coord ? `${coord.lat.toFixed(5)},${coord.lng.toFixed(5)}` : 'null';
  const prevCoordSigRef = useRef<string>(coordSignature);
  useEffect(() => {
    if (prevCoordSigRef.current !== coordSignature) {
      log('memory.coord_changed', {
        prev: prevCoordSigRef.current,
        next: coordSignature,
        has_watcher: !!watcherFix,
        watcher_age_ms: watcherFix ? Date.now() - watcherFix.ts : null,
        watcher_fresh: watcherFresh,
        has_oneshot: !!oneShot,
        fail_reason: failReason,
        refetch_token: refetchToken,
      });
      prevCoordSigRef.current = coordSignature;
    }
  }, [coordSignature, watcherFix, watcherFresh, oneShot, failReason, refetchToken]);

  // v333: removed initial-reveal call. User's expectation (2026-06-26):
  // "no hike imported = NO area unlocked". The initial 200m reveal was
  // a v32x concept that pre-unlocks ground the user never walked, which
  // conflicts with "Memory only shows what you actually walked".
  // Initial reveal logic stays in the codebase (performInitialRevealIfNeeded)
  // but is not invoked here; it will be re-enabled in phase 2 (background
  // SLC recording, 100m circle on app open).

  const dismissHint = () => {
    log('memory.first_visit_hint_dismissed');
    setSetting('firstVisitDone', true);
    setShowHint(false);
  };

  const onRecenter = () => {
    log('memory.recenter_tap');
    setCityNavigationNotice(null);
    // A panel lookup started before this explicit camera command may update
    // labels, but it must not reopen stale city UI after Recenter wins.
    panelOpenRequestIdRef.current += 1;
    manualBrowseThisMountRef.current = false;
    const currentLocationViewport = stableCoord
      ? resolveCurrentLocationViewport(stableCoord)
      : currentLocationViewportRef.current;
    if (currentLocationViewport) {
      flyTokenRef.current += 1;
      log('memory.camera_command', {
        intent: 'explicit-recenter',
        token: flyTokenRef.current,
        center_lat: currentLocationViewport.center[1],
        center_lng: currentLocationViewport.center[0],
        zoom: currentLocationViewport.zoom,
      });
      setFlyToTarget({
        center: currentLocationViewport.center,
        zoom: currentLocationViewport.zoom,
        token: flyTokenRef.current,
      });
    } else {
      setRecenterToken((n) => n + 1);
    }
    restoredManualCityRef.current = null;
    void clearManualMemoryCity();
    // v445 fix: eagerly update cameraCenterRef to real GPS location so
    // that reopening the hierarchy panel right after recenter uses the
    // new location, not the stale KL/etc from previous fly-to. The map's
    // onCameraChanged should also fire later, but relying on it alone
    // was unreliable for imperative camera moves.
    if (persistentCoord) {
      const target = currentLocationViewport
        ? { lat: currentLocationViewport.center[1], lng: currentLocationViewport.center[0] }
        : stableCoord ?? persistentCoord;
      cameraCenterRef.current = { lat: target.lat, lng: target.lng };
      log('v445.recenter_camera_ref_set', { lat: target.lat, lng: target.lng });
    }
    // R7 fix: only refetch GPS if we have nothing OR our cached fix is
    // older than the freshness window. Otherwise just camera-flyTo.
    const stale = !watcherFix || Date.now() - watcherFix.ts >= WATCHER_FIX_FRESH_MS;
    if (stale && Date.now() - lastRefetchAtRef.current >= FOCUS_REFETCH_DEBOUNCE_MS) {
      lastRefetchAtRef.current = Date.now();
      setRefetchToken((n) => n + 1);
    }
  };

  return (
    <View style={[styles.root, { backgroundColor: theme.background }]}>
      {/* v322: fgum mounts here. Unmounts when MemoryScreen unmounts
          (user navigates back to Home), releasing GPS watcher + h3
          + memory-store subscriptions. */}
      <ForegroundUnlockManager />
      {/* The screen chrome is independent from Mapbox/Fog readiness. It stays
          interactive on cold entry, warm re-entry and retained-scene refresh. */}
      <View style={[styles.topBar, { paddingTop: insets.top + 8 }]} pointerEvents="box-none">
        <BackButton variant="inline" onPress={() => nav.goBack()} testID="memory-back" />
        {/* v376: Pick icon 移到 MemoryScopeToggle 内部作为第三个 segment,
            scope=friends 时 width+opacity 展开,scope=mine 时 collapse 到 0
            (用户 v375 反馈: 之前的 fixed-position 占位空白难看)。 */}
        <View style={styles.topActions}>
          <TouchableOpacity
            testID="memory-all-cairns-entry"
            style={[styles.libraryAction, { backgroundColor: theme.surfaceElevated, borderColor: theme.border }]}
            onPress={() => nav.navigate('AllCairns')}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel={acquiredUnreadCount > 0
              ? cairnText('memory.memory-screen.open-cairns-value-unread-cairn-groups', { acquiredUnreadCount: acquiredUnreadCount })
              : cairnText('memory.memory-screen.open-cairns')}
            hitSlop={{ top: 2, bottom: 2, left: 2, right: 2 }}
          >
            <Icon name="MapPin" size={17} color={theme.iconActive} strokeWidth={2.1} />
            <Text style={[styles.libraryActionLabel, { color: theme.foreground }]}>{cairnText('memory.memory-screen.cairns')}</Text>
            {acquiredUnreadCount > 0 ? (
              <View style={[styles.libraryUnread, { backgroundColor: theme.primary }]}>
                <Text style={[styles.libraryUnreadText, { color: theme.onPrimary }]}>
                  {acquiredUnreadCount > 99 ? '99+' : acquiredUnreadCount}
                </Text>
              </View>
            ) : null}
          </TouchableOpacity>
          <MemoryScopeToggle onPickPress={openFriendPicker} />
        </View>
      </View>
      {syntheticQaAuthority ? (
        <View
          testID="memory-evidence-context"
          pointerEvents="none"
          style={[styles.evidenceContext, { top: insets.top + 120, backgroundColor: theme.mapOverlay, borderColor: theme.borderStrong }]}
        >
          <Text style={[styles.evidenceContextTitle, { color: theme.foreground }]}>{cairnText('memory.memory-screen.simulator-test-memory')}</Text>
          <Text style={[styles.evidenceContextText, { color: theme.foregroundSecondary }]}>
            {memoryEvidenceContext
              ? cairnText('memory.memory-screen.isolated-synthetic-evidence-first-accepted-value-latest', { first: memoryEvidenceContext.first, last: memoryEvidenceContext.last })
              : cairnText('memory.memory-screen.isolated-synthetic-evidence-no-accepted-movement-yet')}
          </Text>
        </View>
      ) : null}

      {/* v352 zoom-flicker fix: render MemoryMap with persistentCoord
          (last-rendered coord, kept in ref across re-renders) instead of
          stableCoord directly. Once MemoryMap has mounted once with
          valid coords, it stays mounted forever — transient nulls in
          stableCoord during zoom-induced re-renders no longer tear down
          MapView. The "Looking for position" / permission / error UI
          renders as an OVERLAY only when we've never seen any coord
          (i.e. persistentCoord is null too). Eliminates the full-screen
          flash that v346-v351 had on every zoom gesture. */}
      {mapMayBeShown && persistentCoord ? (
        <MemoryMap
          ref={mapRef}
          centerLat={persistentCoord.lat}
          centerLng={persistentCoord.lng}
          // Keep the map/camera/Fog mounted across navigation, but release
          // RNMapbox UserLocation (and its native location/heading owners)
          // whenever this retained screen cannot actually show the puck.
          showUserLocation={memoryUserLocationShouldMount({
            coordinateAvailable: Boolean(stableCoord),
            screenFocused: isMemoryFocused,
            appActive: appIsActive,
          })}
          recenterToken={recenterToken}
          flyToTarget={flyToTarget}
          onOpenAcquiredCairn={markerId => nav.navigate('AcquiredCairnDetail', { markerId })}
          onOpenAcquiredGroup={markerIds => {
            setAcquiredClusterError(false);
            setAcquiredGroupIds(stableAcquiredGroupOrder(
              markerIds,
              useCairnPresentationStore.getState().acquiredMarkers,
            ));
          }}
          onAcquiredClusterError={() => setAcquiredClusterError(true)}
          onMapMoved={() => {
            if (mountKeyRef.current === mountKey) setMapMoved(true);
          }}
          onCameraCenter={(lat, lng) => handleCameraCenter(lat, lng, mountKey)}
          onMapFullyReady={() => {
            if (mountKeyRef.current !== mountKey) return;
            log('v359.map_fully_ready_cb', {});
            deliverReadiness('map', mountKey, () => setMapReady(true));
          }}
          onMapUnavailable={() => handleMapUnavailable(mountKey)}
          onFogPreparing={(readinessKey, retainsDisplayedScene) => {
            if (mountKeyRef.current !== mountKey) return;
            fogTargetReadinessKeyRef.current = readinessKey;
            // FogLayer may classify a cold request failure in an earlier
            // effect than its Preparing callback for the same authority.
            // Never let that later callback erase the already-classified
            // error; Retry clears this ref before starting fresh work.
            if (memoryFogPreparingMayClearFailure(
              fogUnavailableReadinessKeyRef.current,
              readinessKey,
            )) {
              setFogUnavailable(false);
            }
            const visiblyPending = memoryFogTransitionIsVisiblyPending({
              readinessKey,
              readyReadinessKey: fogReadyReadinessKeyRef.current,
              retainsDisplayedScene,
            });
            log('o94.memory.fog_transition', {
              readiness_key: readinessKey,
              retained_scene: retainsDisplayedScene,
              visible_loading: visiblyPending,
            });
            setFogScenePending(visiblyPending);
            if (!entryUsableRef.current) setFogReady(false);
          }}
          onFogReady={(readinessKey) => {
            if (mountKeyRef.current !== mountKey) return;
            if (fogTargetReadinessKeyRef.current && fogTargetReadinessKeyRef.current !== readinessKey) return;
            log('v359.fog_ready_cb', {});
            deliverReadiness('fog', mountKey, () => {
              if (fogTargetReadinessKeyRef.current && fogTargetReadinessKeyRef.current !== readinessKey) return;
              fogReadyReadinessKeyRef.current = readinessKey;
              fogUnavailableReadinessKeyRef.current = '';
              setFogUnavailable(false);
              setFogScenePending(false);
              setFogReady(true);
              setFogPresentationVersion(value => value + 1);
            }, readinessKey);
          }}
          onFogUnavailable={(readinessKey) => {
            if (mountKeyRef.current !== mountKey) return;
            if (fogTargetReadinessKeyRef.current && fogTargetReadinessKeyRef.current !== readinessKey) return;
            fogUnavailableReadinessKeyRef.current = readinessKey;
            if (!entryUsableRef.current) setFogReady(false);
            setFogScenePending(false);
            setFogUnavailable(true);
          }}
          qaWorkspaceActive={syntheticQaAuthority}
          presentationOwnedByParent
          onPresentationState={setEntryMapLoadState}
          onCameraTransitionState={setCameraTransitionState}
          key={`map-${mountKey}`}
        />
      ) : failReason === 'permission' ? (
        <View style={styles.emptyState}>
          <MemoryStateMark label={cairnText('memory.memory-screen.location-memory')} />
          <Text style={[styles.emptyTitle, { color: theme.foreground }]}>{cairnText('memory.memory-screen.location-permission-needed')}</Text>
          <Text style={[styles.emptySub, { color: theme.foregroundSecondary }]}>{cairnText('memory.memory-screen.memory-needs-your-location-to-draw-the')}</Text>
          <TouchableOpacity
            style={[styles.emptyPrimaryBtn, { backgroundColor: theme.primary }]}
            onPress={() => Linking.openSettings()}
            activeOpacity={0.85}
          >
            <Text style={[styles.emptyPrimaryBtnText, { color: theme.onPrimary }]}>{cairnText('memory.memory-screen.open-settings')}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.emptySecondaryBtn}
            onPress={() => setRefetchToken((n) => n + 1)}
            activeOpacity={0.7}
          >
            <Text style={[styles.emptySecondaryBtnText, { color: theme.foregroundSecondary }]}>{cairnText('memory.memory-screen.try-again')}</Text>
          </TouchableOpacity>
        </View>
      ) : failReason === 'timeout' || failReason === 'error' ? (
        <View style={styles.emptyState}>
          <MemoryStateMark label={cairnText('memory.memory-screen.memory-map')} />
          <Text style={[styles.emptyTitle, { color: theme.foreground }]}>{cairnText('memory.memory-screen.we-couldn-t-find-your-location')}</Text>
          <Text style={[styles.emptySub, { color: theme.foregroundSecondary }]}>{cairnText('memory.memory-screen.check-that-location-services-are-on-then')}</Text>
          <TouchableOpacity
            style={[styles.emptyPrimaryBtn, { backgroundColor: theme.primary }]}
            onPress={() => setRefetchToken((n) => n + 1)}
            activeOpacity={0.85}
          >
            <Text style={[styles.emptyPrimaryBtnText, { color: theme.onPrimary }]}>{cairnText('memory.memory-screen.try-again')}</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <View style={[styles.memoryEntryPlaceholder, { backgroundColor: theme.background }]} testID="memory-entry-placeholder" />
      )}

      {entryVeilMounted && !failReason ? (
        <Animated.View
          pointerEvents={memoryEntryUsable ? 'none' : 'auto'}
          style={[StyleSheet.absoluteFill, { opacity: entryVeilOpacity, zIndex: 7, backgroundColor: theme.background }]}
          testID="memory-entry-veil"
        >
          {authorizedPreviewUri ? (
            <Image
              source={{ uri: authorizedPreviewUri }}
              resizeMode="cover"
              style={StyleSheet.absoluteFill}
              testID="memory-authorized-preview"
            />
          ) : null}
          {!memoryEntryUsable ? (
            <MapLoadOverlay
              state={entryMapLoadState}
              delayMs={authorizedPreviewUri ? MEMORY_WARM_ENTRY_MESSAGE_DELAY_MS : MEMORY_ENTRY_MESSAGE_DELAY_MS}
              onRetry={entryMapLoadState === 'slow' || entryMapLoadState === 'error' ? handleRetryLoad : undefined}
              testID="memory-entry-loading"
            />
          ) : null}
        </Animated.View>
      ) : null}

      {memoryEntryUsable && persistentCoord && !freshCurrentEvidence && !failReason ? (
        <View
          style={[styles.locationStatusBanner, { top: insets.top + (syntheticQaAuthority ? 174 : 120), backgroundColor: theme.mapOverlay, borderColor: theme.border }]}
          pointerEvents="none"
          testID="memory-finding-location"
        >
          <ActivityIndicator color={theme.primary} size="small" />
          <Text style={[styles.locationStatusText, { color: theme.foreground }]}>{cairnText('memory.memory-screen.finding-your-location')}</Text>
        </View>
      ) : null}

      {mapMayBeShown && persistentCoord && !freshCurrentEvidence && failReason ? (
        <TouchableOpacity
          style={[styles.locationStatusBanner, { top: insets.top + (syntheticQaAuthority ? 174 : 120), backgroundColor: theme.mapOverlay, borderColor: theme.border }]}
          onPress={() => setRefetchToken((n) => n + 1)}
          accessibilityRole="button"
          accessibilityLabel={cairnText('memory.memory-screen.try-finding-your-location-again')}
          testID="memory-location-unavailable"
        >
          <Icon name="Target" size={16} color={theme.iconInactive} strokeWidth={2} />
          <Text style={[styles.locationStatusText, { color: theme.foreground }]}>{cairnText('memory.memory-screen.we-couldn-t-find-your-location-tap')}</Text>
        </TouchableOpacity>
      ) : null}

      {mapMayBeShown && persistentCoord && stableCoord && mapMoved && (
        <TouchableOpacity
          style={[styles.recenterBtn, { backgroundColor: theme.mapOverlay, borderColor: theme.border }]}
          onPress={() => {
            onRecenter();
            setMapMoved(false);
          }}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityLabel={cairnText('memory.memory-screen.recenter-on-current-location')}
          testID="memory-recenter"
        >
          {/* v334: Target icon to match HikingScreen.tsx recenter pill
              (decision E: "and an icon like Hiking, ..."). */}
          <Icon name="Target" size={22} color={theme.iconActive} strokeWidth={2} />
        </TouchableOpacity>
      )}

      {/* v424: Hierarchy button (left-bottom, mirrors Recenter position).
          Always visible when we have coords. Tap → toggle popover.
          Layers icon differentiates from Target crosshair on right. */}
      {mapMayBeShown && persistentCoord && (
        <TouchableOpacity
          style={[
            styles.hierarchyBtn,
            { backgroundColor: theme.mapOverlay, borderColor: theme.border },
            hierarchyOpen && { backgroundColor: theme.primary, borderColor: theme.primary },
          ]}
          testID="memory-city-switcher"
          accessibilityRole="button"
          accessibilityLabel={cairnText('memory.memory-screen.browse-explored-cities')}
          onPress={async () => {
            if (hierarchyOpen) {
              setHierarchyOpen(false);
              return;
            }
            // v441.1 fix "still shows KL after user manually pans to Shanghai":
            //   Always compute green from the *current* map center via
            //   fetchDeepest — the map center is the source of truth,
            //   NOT the last city the user tapped.
            //
            //   To avoid the "2-stage flash" (panel opens showing loading,
            //   then title/list appears), we FETCH FIRST, then open the
            //   panel with the resolved state in a single setState batch.
            const myReqId = ++panelOpenRequestIdRef.current;
            // v447: prefer live map center over stale cameraCenterRef.
            // Root cause of v445 KL→Shanghai bug: onCameraChanged rarely
            // populates e.properties.center on native during pan, so the
            // ref stayed on the last hierarchy_fly target (KL) even after
            // the user panned to Shanghai.
            let liveCenter: { lat: number; lng: number } | null = null;
            try {
              liveCenter = (await mapRef.current?.getCurrentCenter?.()) ?? null;
            } catch (err) {
              log('v447.hierarchy_open_getcenter_err', { err: String(err) });
            }
            if (panelOpenRequestIdRef.current !== myReqId) {
              log('v441.hierarchy_open_stale_drop', {});
              return;
            }
            const anchor = liveCenter ?? cameraCenterRef.current ?? persistentCoord ?? { lat: 0, lng: 0 };
            log('v447.hierarchy_open_start', {
              anchor_lat: Number(anchor.lat.toFixed(4)),
              anchor_lng: Number(anchor.lng.toFixed(4)),
              source: liveCenter ? 'live' : cameraCenterRef.current ? 'ref' : 'coord',
              prev_city: hierarchyCurrentCityId,
              prev_country: hierarchyCurrentCountryId,
            });
            const { city, country } = await fetchDeepest(anchor.lat, anchor.lng);
            if (panelOpenRequestIdRef.current !== myReqId) {
              log('v441.hierarchy_open_stale_drop', {});
              return;
            }
            // Resolve state + open panel in one shot → no flash
            if (country) {
              setHierarchyTitleId(country.id);
              setHierarchyCurrentCityId(city?.id ?? null);
              setHierarchyCurrentCountryId(country.id);
              log('v441.hierarchy_open_resolved', {
                city: city?.id ?? null,
                country: country.id,
              });
            } else {
              setHierarchyTitleId('world');
              setHierarchyCurrentCityId(null);
              setHierarchyCurrentCountryId(null);
              log('v441.hierarchy_open_ocean', {});
            }
            setHierarchyOpen(true);
          }}
          activeOpacity={0.85}
        >
          <Icon name="Layers" size={22} color={hierarchyOpen ? theme.onPrimary : theme.iconActive} strokeWidth={2} />
        </TouchableOpacity>
      )}

      {mapMayBeShown && persistentCoord && initialMemoryOffline ? (
        <TouchableOpacity
          style={[styles.memoryRestoreBanner, { backgroundColor: theme.mapOverlay, borderColor: theme.border }]}
          onPress={handleRetryInitialMemory}
          accessibilityRole="button"
          accessibilityLabel={cairnText('memory.memory-screen.connect-and-retry-restoring-memory')}
          testID="memory-initial-reconcile-offline"
        >
          <Icon name="CloudOff" size={14} color={theme.iconInactive} strokeWidth={2.2} />
          <Text style={[styles.slowBannerText, { color: theme.foregroundSecondary, marginLeft: 7 }]} numberOfLines={2}>{cairnText('memory.memory-screen.connect-to-restore-memory-tap-to-retry')}</Text>
        </TouchableOpacity>
      ) : null}

      {mapMayBeShown && persistentCoord && cityNavigationNotice ? (
        <TouchableOpacity
          style={[styles.cityNavigationNotice, { backgroundColor: theme.mapOverlay, borderColor: theme.border }]}
          onPress={() => setCityNavigationNotice(null)}
          accessibilityRole="button"
          accessibilityLabel={cityNavigationNotice}
          testID="memory-city-coverage-unavailable"
        >
          <Icon name="MapPin" size={14} color={theme.iconInactive} strokeWidth={2} />
          <Text style={[styles.cityNavigationNoticeText, { color: theme.foregroundSecondary }]}>{cityNavigationNotice}</Text>
        </TouchableOpacity>
      ) : null}

      {memoryEntryUsable && (cameraTransitionState
        || (memoryScope !== 'self' && (fogUnavailable || targetFriendFailureVisible || fogScenePending))) ? (
        <View
          style={[styles.mapStatusRegion, { top: insets.top + 116, bottom: insets.bottom + 92 }]}
          pointerEvents="box-none"
          testID="memory-map-status-region"
        >
          <TouchableOpacity
            style={[styles.mapStatusCard, { backgroundColor: theme.mapOverlay, borderColor: theme.border }]}
            disabled={!fogUnavailable && !targetFriendFailureVisible && cameraTransitionState !== 'error'}
            onPress={() => {
              if (cameraTransitionState === 'error') {
                handleRetryLoad();
                return;
              }
              if (fogUnavailable || targetFriendFailureVisible) {
                handleRetrySharedMap();
                return;
              }
            }}
            accessibilityRole={fogUnavailable || targetFriendFailureVisible || cameraTransitionState === 'error' ? 'button' : undefined}
            accessibilityLabel={fogUnavailable || targetFriendFailureVisible || cameraTransitionState === 'error' ? cairnText('memory.memory-screen.retry-loading-map') : cairnText('memory.memory-screen.loading-map')}
            testID="memory-map-status"
          >
            {fogUnavailable || targetFriendFailureVisible || cameraTransitionState === 'error' ? (
              <Icon name={(selectionError ?? friendProjectionError) === 'offline' ? 'CloudOff' : 'RotateCcw'} size={15} color={theme.iconInactive} strokeWidth={2.2} />
            ) : (
              <ActivityIndicator color={theme.primary} size="small" />
            )}
            <Text style={[styles.mapStatusText, { color: theme.foreground }]} numberOfLines={2}>
              {cameraTransitionState === 'error'
                ? cairnText('memory.memory-screen.map-tiles-couldn-t-load-tap-to')
                : cameraTransitionState === 'loading'
                    ? cairnText('memory.memory-screen.loading-this-place')
                    : (selectionError ?? friendProjectionError) === 'offline'
                ? cairnText('memory.memory-screen.connect-to-load-shared-places-tap-to')
                : (selectionError ?? friendProjectionError) === 'unauthorized'
                  ? cairnText('memory.memory-screen.shared-places-are-no-longer-available-tap')
                  : fogUnavailable
                    ? cairnText('memory.memory-screen.shared-map-couldn-t-load-tap-to')
                    : cairnText('memory.memory-screen.loading-shared-map')}
            </Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {memoryEntryUsable && hasVisibleFriendCoverage && !fogScenePending && !fogUnavailable ? (
        <View
          style={[styles.memoryLegend, { bottom: insets.bottom + 72, backgroundColor: theme.mapOverlay, borderColor: theme.border }]}
          pointerEvents="none"
          testID="memory-friends-legend"
        >
          {[
            ['Mine', theme.mapMineMemoryFill],
            ['Friends', theme.mapFriendMemoryFill],
            ['Both', theme.mapMemoryOverlapFill],
          ].map(([label, color]) => (
            <View key={label} style={styles.memoryLegendItem}>
              <View style={[styles.memoryLegendSwatch, { backgroundColor: color }]} />
              <Text style={[styles.memoryLegendText, { color: theme.foreground }]}>{label}</Text>
            </View>
          ))}
        </View>
      ) : null}

      <PublicWalkingDiscoveryCard
        surface="memory"
        safeTop={insets.top}
        safeBottom={insets.bottom}
        bottomOffset={176}
        blocked={Boolean(showHint || acquiredGroupIds || pickModalOpen || hierarchyOpen || !memoryEntryUsable)}
        onOpen={(markerId, markerIds, revisionIdsByMarker) => markerId
          ? nav.navigate('AcquiredCairnDetail', {
            markerId,
            revisionId: revisionIdsByMarker?.[markerId],
          })
          : nav.navigate('AllCairns', { initialSection: 'found', markerIds, revisionIdsByMarker })}
      />

      {acquiredClusterError ? (
        <TouchableOpacity
          style={[styles.slowBanner, { top: insets.top + 254, left: 80, right: 12, zIndex: 14 }]}
          onPress={() => setAcquiredClusterError(false)}
          accessibilityRole="button"
          accessibilityLabel={cairnText('memory.memory-screen.dismiss-cluster-retry-message')}
        >
          <Icon name="RotateCcw" size={13} color={theme.iconInactive} strokeWidth={2.2} />
          <Text style={[styles.slowBannerText, { marginLeft: 6 }]} numberOfLines={2}>{cairnText('memory.memory-screen.could-not-resolve-every-cairn-dismiss-then')}</Text>
        </TouchableOpacity>
      ) : null}

      <ModalCard visible={showHint && isMemoryFocused} onDismiss={dismissHint} testID="memory-unlock-guidance">
          <View>
            <Text style={[styles.hintTitle, { color: theme.foreground }]}>{cairnText('memory.memory-screen.walk-to-unlock-your-memory')}</Text>
            <Text style={[styles.hintBody, { color: theme.foregroundSecondary }]}>{cairnText('memory.memory-screen.the-map-starts-covered-in-fog-as', { value1: '\n\n' })}</Text>
            <AppButton label={cairnText('memory.memory-screen.got-it')} onPress={dismissHint} />
          </View>
      </ModalCard>

      <ModalCard
        visible={isMemoryFocused && acquiredGroupIds !== null}
        onDismiss={() => setAcquiredGroupIds(null)}
        testID="memory-acquired-cairn-group"
      >
        <ModalCardHeader
          title={cairnText('memory.memory-screen.value-cairns-here', { length: acquiredGroupRows.length })}
          body={cairnText('memory.memory-screen.value-unread-opening-this-list-does-not', { length: acquiredGroupRows.filter(row => row.unread).length })}
          onClose={() => setAcquiredGroupIds(null)}
        />
        <FlatList
          style={styles.acquiredGroupList}
          contentContainerStyle={styles.acquiredGroupListContent}
          data={acquiredGroupRows}
          keyExtractor={row => row.markerId}
          initialNumToRender={12}
          maxToRenderPerBatch={12}
          windowSize={7}
          renderItem={({ item: row }) => {
            const source = row.sourceAudience === 'friends'
              ? (row.authorName ? cairnText('memory.cairn-source.friend-name', { name: row.authorName }) : cairnText('memory.cairn-source.friend'))
              : cairnText('memory.cairn-source.public');
            const acquired = row.acquiredAt ? formatCairnDate(new Date(row.acquiredAt)) : cairnText('memory.saved-in-memory');
            return (
              <TouchableOpacity
                key={row.markerId}
                style={[styles.acquiredGroupRow, { borderColor: theme.border }]}
                onPress={() => nav.navigate('AcquiredCairnDetail', { markerId: row.markerId })}
                accessibilityRole="button"
                accessibilityLabel={cairnText('memory.memory-screen.value-value-found-value', { source: source, value2: row.unread ? cairnText('memory.cairn-state.unread') : cairnText('memory.cairn-state.read'), acquired: acquired })}
              >
                <View style={styles.acquiredGroupCopy}>
                  <Text style={[styles.acquiredGroupTitle, { color: theme.foreground }]} numberOfLines={1}>
                    {row.title || row.preview || source}
                  </Text>
                  <Text style={[styles.acquiredGroupMeta, { color: theme.foregroundSecondary }]} numberOfLines={1}>{cairnText('memory.memory-screen.value-value-value', { source: source, acquired: acquired, value3: Number(row.revisionCount) > 1 ? cairnText('memory.memory-screen.value-versions', { revisionCount: Number(row.revisionCount) }) : '' })}</Text>
                  {row.title && row.preview ? (
                    <Text style={[styles.acquiredGroupPreview, { color: theme.muted }]} numberOfLines={2}>{row.preview}</Text>
                  ) : null}
                </View>
                {row.unread ? <View style={[styles.acquiredGroupUnread, { backgroundColor: theme.primary }]} /> : null}
                <Icon name="ChevronRight" size={16} color={theme.iconInactive} />
              </TouchableOpacity>
            );
          }}
        />
      </ModalCard>

      {/* BUG-D fix (v371 post-OTA): old bottom-right "Pick friends" FAB
          was replaced by the top-right Users icon in the top bar above.
          The bottom-right area was occluding map content too aggressively.
          The pick modal itself is unchanged — only its entry point moved. */}
      <MemoryFriendPickModal
        visible={pickModalOpen}
        onClose={handlePickModalClose}
      />

      {/* v434: Hierarchy popover — 2-layer tree (World → Country → City).
          Fetches panel data from /api/hierarchy/panel. */}
      {hierarchyOpen && (
        <HierarchyPanel
          titleId={hierarchyTitleId}
          currentCityId={hierarchyCurrentCityId}
          currentCountryId={hierarchyCurrentCountryId}
          friendRegionSources={friendRegionSources}
          onSelectItem={(itemId, itemType, bbox) => {
            panelOpenRequestIdRef.current += 1;
            log('v434.hierarchy_tap', { id: itemId, type: itemType });
            if (itemType === 'country') {
              // World layer → tap country: switch title, do NOT fly.
              // currentCountryId stays tied to map center; user has not moved
              // the map, so green in the future world layer will still reflect
              // the actual location, not the tapped country.
              setHierarchyTitleId(itemId);
              return;
            }
            // Country layer → tap city: fly + refetch panel with new here_city_id.
            manualBrowseThisMountRef.current = true;
            const citySources: MemoryCityCoverageSource[] = [];
            const prepared = usePreparedMemoryCoverageStore.getState().coverage;
            const mineRegion = prepared?.complete
              ? prepared.regions.find(region => region.level === 3 && region.id === itemId)
              : null;
            if (prepared?.complete && mineRegion) {
              citySources.push({
                source: 'mine',
                sourceId: prepared.snapshotId,
                regionId: mineRegion.id,
                regionAnchor: mineRegion.anchor,
                geometry: prepared.geometry,
              });
            }
            const friendStore = useFriendMemoryStore.getState();
            for (const region of friendStore.getVisibleRegions()) {
              if (region.level !== 3 || region.id !== itemId) continue;
              const visibleSource = friendStore.getVisibleGeometries(region.sourceFriendId)
                .find(source => source.sourceFriendId === region.sourceFriendId);
              if (!visibleSource) continue;
              citySources.push({
                source: 'friends',
                sourceId: visibleSource.sourceFriendId,
                regionId: region.id,
                // Shared region anchors are intentionally coarse. The target
                // is derived below from authorized Fog geometry instead.
                regionAnchor: null,
                geometry: visibleSource.geometry,
              });
            }
            const cityTarget = resolveMemoryCityCameraTarget({
              cityId: itemId,
              bbox,
              sources: citySources,
            });
            if (!cityTarget) {
              setCityNavigationNotice(cairnText('memory.memory-screen.no-authorised-coverage-in-this-city'));
              log('o94.memory.city_target_unavailable', { city_id: itemId });
              return;
            }
            setCityNavigationNotice(null);
            const [flyLng, flyLat] = cityTarget.center;
            const zoom = cityTarget.zoom;
            if (cityTarget.source === 'friends' && memoryScope === 'self') {
              // The destination must be visible. This changes only the local
              // presentation scope; selected Friends and grants are untouched.
              setMemoryScope('combined');
            }

            flyTokenRef.current += 1;
            log('memory.camera_command', {
              intent: 'explored-city',
              token: flyTokenRef.current,
              city_id: itemId,
              source: cityTarget.source,
              center_lat: flyLat,
              center_lng: flyLng,
              zoom,
            });
            setFlyToTarget({ center: [flyLng, flyLat], zoom, token: flyTokenRef.current });
            // v441.1: eagerly update cameraCenterRef to the fly target so
            // that if user closes the panel and reopens immediately (before
            // the map's onCameraChanged has fired), the reopen fetchDeepest
            // sees the correct location. Real onCameraChanged will overwrite
            // this later — either matching (fly succeeded) or diverging
            // (user panned away, in which case that's the truth).
            cameraCenterRef.current = { lat: flyLat, lng: flyLng };
            // v440.1: fly-to via hierarchy panel counts as "map moved" —
            // recenter icon should appear on the right so user can jump
            // back to their real GPS. Same pattern as user pan/zoom.
            setMapMoved(true);
            log('v441.hierarchy_fly', { itemId, flyLat, flyLng, source: cityTarget.source });
            // v436: city tap moves the map → update currentCityId AND
            // currentCountryId. In country-layer, title IS the country, so
            // any city tapped is a child of it. This makes ↑ back to World
            // correctly highlight the country the user just flew to.
            setHierarchyCurrentCityId(itemId);
            setHierarchyCurrentCountryId(hierarchyTitleId === 'world' ? null : hierarchyTitleId);
            if (cityTarget.source === 'friends') {
              // Exact Friend-derived geography is authorized session data,
              // not durable camera metadata. Keep the deliberate fly-to now,
              // while ensuring revoke/relaunch cannot restore this anchor.
              void clearManualMemoryCity();
            } else {
              void selectMemoryCity({
                source: 'mine',
                cityId: itemId,
                countryId: hierarchyTitleId === 'world' ? null : hierarchyTitleId,
                bbox,
                center: [flyLng, flyLat],
                zoom,
              });
            }
          }}
          onGoUp={() => {
            log('v434.hierarchy_up', { from: hierarchyTitleId });
            // ↑ = go to world layer. Do NOT change currentCityId /
            // currentCountryId — those follow map center, not tap history.
            setHierarchyTitleId('world');
          }}
          onClose={() => setHierarchyOpen(false)}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  memoryEntryPlaceholder: { flex: 1 },
  root: { flex: 1, backgroundColor: MemoryColors.cream },
  topBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 12,
    zIndex: 40,
    flexDirection: 'row',
    alignItems: 'center',
    // Activity Detail's inline Back is the navigation reference. Map actions
    // retain their own material, but navigation itself is never wrapped.
    justifyContent: 'space-between',
  },
  topActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  libraryAction: {
    minWidth: 76,
    height: MEMORY_TOP_CONTROL_HEIGHT,
    paddingHorizontal: 12,
    borderRadius: Radius.pill,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 5,
    alignItems: 'center',
    justifyContent: 'center',
    ...Shadow.card,
  },
  libraryActionLabel: { fontSize: 12, fontWeight: '700' },
  libraryUnread: { position: 'absolute', right: -3, top: -3, minWidth: 18, height: 18, paddingHorizontal: 4, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  libraryUnreadText: { fontSize: 9, lineHeight: 12, fontWeight: '800' },
  cityNavigationNotice: {
    position: 'absolute',
    left: 72,
    right: 72,
    bottom: 112,
    minHeight: 44,
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    zIndex: 26,
  },
  cityNavigationNoticeText: { flexShrink: 1, fontSize: 12, lineHeight: 16, fontWeight: '600', textAlign: 'center' },
  evidenceContext: {
    position: 'absolute',
    left: 12,
    right: 12,
    zIndex: 11,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  evidenceContextTitle: { fontSize: 12, fontWeight: '700' },
  evidenceContextText: { fontSize: 11, lineHeight: 16, marginTop: 2 },
  locationStatusBanner: {
    position: 'absolute',
    left: 12,
    right: 12,
    zIndex: 13,
    minHeight: 40,
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: 13,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  locationStatusText: { flex: 1, fontSize: FontSize.small, lineHeight: 18, fontWeight: '600' },
  // Concept-aligned empty state (2026-08-16 sleep-run redesign):
  //   - Centered vertically on paper background
  //   - Title: 18px, dark textPrimary, weight 500
  //   - Sub:   14px, muted textSecondary
  //   - Primary CTA: fully-rounded green pill, 14px medium white
  //   - Secondary: plain text link, muted, no chrome
  // Matches Memory-1.png exactly.
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 40,
  },
  stateMark: {
    width: 64,
    height: 64,
    borderRadius: 22,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 13,
  },
  stateEyebrow: {
    fontSize: 9,
    lineHeight: 12,
    fontWeight: '700',
    letterSpacing: 1.45,
    marginBottom: 8,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '500',
    color: Colors.textPrimary,
    textAlign: 'center',
  },
  emptySub: {
    fontSize: 14,
    color: Colors.textSecondary,
    marginTop: 10,
    textAlign: 'center',
    lineHeight: 20,
  },
  emptyPrimaryBtn: {
    marginTop: 22,
    backgroundColor: Colors.primary,
    paddingVertical: 12,
    paddingHorizontal: 28,
    borderRadius: 999,
    minWidth: 168,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  emptyPrimaryBtnText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
    letterSpacing: 0.2,
  },
  emptySecondaryBtn: {
    marginTop: 14,
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  emptySecondaryBtnText: {
    color: Colors.textSecondary,
    fontSize: 14,
    fontWeight: '400',
  },
  recenterBtn: {
    position: 'absolute',
    right: 16, bottom: 110,
    width: 48, height: 48, borderRadius: 24,
    backgroundColor: '#fff',
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 }, elevation: 4,
    borderWidth: 1, borderColor: '#e8dfc8', zIndex: 25,
  },
  // v424: Hierarchy button (left-bottom, mirrors Recenter). Always visible
  // once GPS coords known. Layers icon → tap opens the region popover.
  hierarchyBtn: {
    position: 'absolute',
    left: 16, bottom: 110,
    width: 48, height: 48, borderRadius: 24,
    backgroundColor: '#fff',
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 }, elevation: 4,
    borderWidth: 1, borderColor: '#e8dfc8',
    zIndex: 25,
  },
  hierarchyBtnActive: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
    shadowOpacity: 0.32,
    shadowRadius: 12,
  },
  // BUG-D fix (v371 post-OTA): Pick friends top-right cluster — sits
  // inline with the scope toggle in the top bar. Replaces the bottom-
  // right FAB pattern which was occluding map content.
  // v376: topPickBtn / topPickBtnHidden / topRightCluster styles removed
  // — Pick icon is now an internal segment of MemoryScopeToggle (third
  // expand-out segment), no external button cluster.
  hintTitle: { fontSize: 17, fontWeight: '600', color: Colors.textPrimary, marginBottom: 10 },
  hintBody:  { fontSize: 13, lineHeight: 19, color: Colors.textSecondary, marginBottom: 18 },
  // v359: loading overlay — covers the entire MemoryMap during the
  // v366 slow-network banner — frosted pill matched to BackButton.
  // Height = BackButton.pillContent (paddingVertical 7 + small font ~17
  // line-height = 31). borderRadius = Radius.pill (20). White semi-
  // translucent background + soft card shadow for visual continuity.
  slowBanner: {
    position: 'absolute',
    backgroundColor: 'rgba(255, 255, 255, 0.85)',
    borderRadius: 20,
    paddingLeft: 12,
    paddingRight: 8,
    paddingVertical: 7,
    flexDirection: 'row',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 20,
    elevation: 4,
    zIndex: 8,
    height: 31,
  },
  memoryRestoreBanner: {
    position: 'absolute',
    left: '50%',
    top: '50%',
    alignSelf: 'center',
    transform: [{ translateX: -105 }, { translateY: -16 }],
    width: 210,
    minHeight: 32,
    maxWidth: 210,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    paddingVertical: 7,
    flexDirection: 'row',
    alignItems: 'center',
    zIndex: 8,
  },
  mapStatusRegion: {
    position: 'absolute',
    left: 24,
    right: 24,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 14,
  },
  mapStatusCard: {
    minHeight: 44,
    maxWidth: 280,
    borderRadius: 22,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  mapStatusText: { fontSize: 12, lineHeight: 16, fontWeight: '600', flexShrink: 1 },
  memoryLegend: {
    position: 'absolute',
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 7,
    zIndex: 14,
  },
  memoryLegendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  memoryLegendSwatch: { width: 11, height: 11, borderRadius: 3 },
  memoryLegendText: { fontSize: 10, lineHeight: 13, fontWeight: '700' },
  slowBannerSpinner: {
    marginRight: 8,
    transform: [{ scale: 0.7 }],
  },
  slowBannerText: {
    color: Colors.primary,
    fontSize: 11,
    fontWeight: '600',
    flex: 1,
  },
  acquiredGroupList: { maxHeight: 360 },
  acquiredGroupListContent: { gap: Spacing.xs },
  acquiredGroupRow: {
    minHeight: 56,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingVertical: Spacing.sm,
  },
  acquiredGroupCopy: { flex: 1 },
  acquiredGroupTitle: { fontSize: FontSize.body, fontWeight: '700' },
  acquiredGroupMeta: { fontSize: FontSize.small, marginTop: 2 },
  acquiredGroupPreview: { fontSize: FontSize.small, lineHeight: 16, marginTop: 4 },
  acquiredGroupUnread: { width: 8, height: 8, borderRadius: 4 },
});
