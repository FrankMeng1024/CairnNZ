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

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, StyleSheet, SafeAreaView, Text, ActivityIndicator, TouchableOpacity, Linking, Animated } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Location from 'expo-location';
import { useNavigation, useFocusEffect, useIsFocused } from '@react-navigation/native';
import { useMemoryStore } from '../store/useMemoryStore';
import { useMemorySettingsStore } from '../store/useMemorySettingsStore';
import { useMemoryScopeStore } from '../store/useMemoryScopeStore';
import { useMemorySubscriptionsStore } from '../store/useMemorySubscriptionsStore';
import { useFriendMemoryStore } from '../store/useFriendMemoryStore';
import { useFriendStore } from '../../../store/useFriendStore';
import { readLastFix } from '../services/lastFixCache';
import { MemoryColors } from '../config/memoryConfig';
import { MemoryMap, type MemoryMapHandle } from '../components/MemoryMap';
import { MemoryScopeToggle } from '../components/MemoryScopeToggle';
import { MemoryFriendPickModal } from '../components/MemoryFriendPickModal';
import { PaywallSheet } from '../components/PaywallSheet';
import { BackButton } from '../../../components/BackButton';
import { Icon } from '../../../components/Icon';
import { CairnIcon } from '../../../components/CairnIcon';
import { Colors } from '../../../components/tokens';
import { useVisualTheme } from '../../../hooks/useVisualTheme';
import { log, flushNow as flushLogsNow } from '../../../services/appLog';
// v322: ForegroundUnlockManager moved here from App root. Mounts only
// when MemoryScreen mounts, unmounts when user leaves. This means H3 +
// memory hydrate + pullMemoryFromServer only run when fog is actually
// being viewed — fixes login-time crash where eager-loading these on
// Home (which has no fog UI) crashed the app.
import { ForegroundUnlockManager } from '../components/ForegroundUnlockManager';
// v425: fly to real explored point inside sibling region (bug 2 fix)
import { ModalCard } from '../../../components/ModalCard';
import { AppButton } from '../../../components/AppButton';
import { useMarkerStore } from '../../../store/useMarkerStore';
// v427: async hierarchy from /api/hierarchy (world-wide data)
import { fetchDeepest } from '../services/hierarchyService';
// v424 hierarchy panel
import { HierarchyPanel } from '../components/HierarchyPanel';
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
let _lastKnownCoord: { lat: number; lng: number; ts: number } | null = null;

// Bug fix: track whether fog+map have successfully loaded at least once
// in this JS session. On subsequent mounts (tab switch / 5-min remount),
// skip the 8s loading overlay entirely — show the map immediately since
// cached tiles + module-level fog shape make reload near-instant.
let _fogEverReady = false;

// v357 diagnostic: module-scope counter for MemoryScreen render invocations.
// Counts across mount/unmount within the same JS session so we can tell
// apart "1st cold render" vs "Nth re-render after tab switch".
let _memoryScreenRenderCount = 0;

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
  // v357 diagnostic: log every MemoryScreen render. persistentCoord and
  // points.length are populated lower in the function body — we just
  // increment the module counter here and log later (after both refs are
  // assigned) so the ctx is accurate. See `v357.memory_screen_render` log
  // at end of body.
  _memoryScreenRenderCount += 1;
  const _v357RenderN = _memoryScreenRenderCount;
  const nav = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const watcherFix = useMemoryStore((s) => s.lastWatcherFix);
  const initialDone = useMemoryStore((s) => s.initialRevealDone);
  const memoryPoints = useMemoryStore((s) => s.points);
  const firstVisitDone = useMemorySettingsStore((s) => s.firstVisitDone);
  const settingsHydrated = useMemorySettingsStore((s) => s.hydrated);
  const setSetting = useMemorySettingsStore((s) => s.set);

  const [oneShot, setOneShot] = useState<FixState | null>(null);
  const [failReason, setFailReason] = useState<FailReason | null>(null);
  const [refetchToken, setRefetchToken] = useState(0);
  const [recenterToken, setRecenterToken] = useState(0);
  const [mountKey, setMountKey] = useState(0);
  const [showHint, setShowHint] = useState(false);
  // 2026-08-16 Round 5 fix: MemoryScreen is kept mounted by react-navigation
  // (native-stack keeps prev screens alive), and React Native <Modal> is a
  // root-level overlay. Without an isFocused gate the "Walk to unlock" modal
  // leaks over Settings/Friends/Map when user navigates away with the hint
  // still open. Gate Modal `visible={showHint && isFocused}`.
  const isMemoryFocused = useIsFocused();

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
  const [loadingState, setLoadingState] = useState<'loading' | 'ready' | 'slow'>('loading');
  const [loadingStage, setLoadingStage] = useState<0 | 1 | 2>(0); // 0..2s / 2..5s / 5s+
  const [mapReady, setMapReady] = useState(false);
  // Sprint 70 STORY-00540 + 542: 5-friend pick modal + paywall when 6+.
  const [pickModalOpen, setPickModalOpen] = useState(false);
  const [paywallOpen, setPaywallOpen] = useState(false);
  const memoryScope = useMemoryScopeStore((s) => s.scope);
  const setScope = useMemoryScopeStore((s) => s.setScope);
  const [fogReady, setFogReady] = useState(false);
  // v413: friend memory 加载 — Memory 页 mount + subscribed friends 变化时拉 /api/circle/fog
  const subscriptionsCount = useMemorySubscriptionsStore((s) => s.subscriptions.length);
  const loadSubs = useMemorySubscriptionsStore((s) => s.load);
  const loadFriendFog = useFriendMemoryStore((s) => s.loadFriendFog);
  // Bug-5 fix: pre-load friend list on Memory mount so friend picker always
  // has data immediately (previously required visiting Friends tab first).
  const loadFriendsFromBackend = useFriendStore((s) => s.loadFriendsFromBackend);
  const friendsLoadedRef = useRef(false);
  // Bug-3 fix: throttle loadSubs+loadFriendFog to at most once per 30s.
  // Previously fired on every mount (tab switch), stacking concurrent
  // network requests that caused the "weak signal" timeout banner.
  const lastFriendLoadRef = useRef<number>(0);
  useEffect(() => {
    // Bug-5: load friends once per mount if not already loaded this session
    if (!friendsLoadedRef.current) {
      friendsLoadedRef.current = true;
      void loadFriendsFromBackend();
    }
    // Bug-3: throttle fog/sub refresh to 30s
    const now = Date.now();
    if (now - lastFriendLoadRef.current < 30_000) return;
    lastFriendLoadRef.current = now;
    void loadSubs();
    void loadFriendFog();
  }, [loadSubs, loadFriendFog, loadFriendsFromBackend]);
  // Track previous subscriptions count to detect changes when picker closes.
  const prevSubsCountRef = useRef(0);
  useEffect(() => {
    prevSubsCountRef.current = subscriptionsCount;
  }, [subscriptionsCount]);

  // Refresh friend fog when pick modal closes and subscriptions changed,
  // rather than on every individual subscribe/unsubscribe tap. This
  // prevents the map from re-rendering mid-session while user is still
  // selecting friends in the picker.
  const handlePickModalClose = useCallback(() => {
    setPickModalOpen(false);
    if (subscriptionsCount !== prevSubsCountRef.current) {
      void loadFriendFog();
      log('memory.friend_fog_reload_on_picker_close', {
        prev: prevSubsCountRef.current,
        now: subscriptionsCount,
      });
    }
  }, [subscriptionsCount, loadFriendFog]);

  // R2: public stranger markers. Subscribe to the store slice and provide
  // a debounced loader triggered whenever the map camera center changes.
  const publicMarkers = useMarkerStore((s) => s.publicMarkers);
  const loadPublicMarkers = useMarkerStore((s) => s.loadPublicMarkers);
  const publicLoadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleCameraCenter = useCallback(
    (lat: number, lng: number) => {
      cameraCenterRef.current = { lat, lng };
      // Debounce: only fire 2s after the user stops panning.
      if (publicLoadTimerRef.current) clearTimeout(publicLoadTimerRef.current);
      publicLoadTimerRef.current = setTimeout(() => {
        void loadPublicMarkers(lat, lng);
      }, 2000);
    },
    [loadPublicMarkers],
  );
  // Cleanup debounce timer on unmount.
  useEffect(() => {
    return () => {
      if (publicLoadTimerRef.current) clearTimeout(publicLoadTimerRef.current);
    };
  }, []);
  // v363: user-dismissed banner state. When user taps the X close on
  // the slow-network banner, hide it for the rest of this Memory tab
  // session. Resets on mountKey bump.
  const [slowBannerDismissed, setSlowBannerDismissed] = useState(false);
  const overlayOpacity = useRef(new Animated.Value(1)).current;
  const overlayHiddenRef = useRef(false);
  const overlayFadeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stageTimer1Ref = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stageTimer2Ref = useRef<ReturnType<typeof setTimeout> | null>(null);
  // v368: when the slow banner appears, hold it visible for AT LEAST
  // SLOW_BANNER_MIN_MS so the user actually has time to read it.
  // Without this, a network that completes a few ms after the timeout
  // would show the banner for a single frame — a confusing flash.
  // slowShownAtRef = timestamp banner became visible; bannerMinShowTimerRef
  // = pending timer that will re-evaluate map-ready state once the
  // minimum has elapsed.
  const slowShownAtRef = useRef<number>(0);
  const bannerMinShowTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const SLOW_BANNER_MIN_MS = 2000;

  // Reset overlay state on each remount (mountKey bump).
  useEffect(() => {
    // Bug fix: if fog+map loaded successfully before in this JS session,
    // skip the loading overlay entirely — cached tiles + module-level fog
    // shape make reload near-instant. No 8s timer needed.
    if (_fogEverReady) {
      overlayHiddenRef.current = true;
      overlayOpacity.setValue(0);
      setMapReady(true);
      setFogReady(true);
      setLoadingState('ready');
      setLoadingStage(0);
      setSlowBannerDismissed(false);
      slowShownAtRef.current = 0;
      log('memory.overlay_skipped_fog_ever_ready', { mountKey });
      return () => {};
    }
    overlayHiddenRef.current = false;
    setMapReady(false);
    setFogReady(false);
    setLoadingState('loading');
    setLoadingStage(0);
    setSlowBannerDismissed(false); // v363: reset dismissal on remount
    slowShownAtRef.current = 0; // v368
    overlayOpacity.setValue(1);
    if (overlayFadeTimerRef.current) {
      clearTimeout(overlayFadeTimerRef.current);
      overlayFadeTimerRef.current = null;
    }
    if (stageTimer1Ref.current) clearTimeout(stageTimer1Ref.current);
    if (stageTimer2Ref.current) clearTimeout(stageTimer2Ref.current);
    if (bannerMinShowTimerRef.current) {
      clearTimeout(bannerMinShowTimerRef.current);
      bannerMinShowTimerRef.current = null;
    }
    // Stage transitions: stage 1 at 2s, stage 2 at 5s.
    stageTimer1Ref.current = setTimeout(() => setLoadingStage(1), 2000);
    stageTimer2Ref.current = setTimeout(() => setLoadingStage(2), 5000);
    // 8s hard timeout: fade overlay AND switch to 'slow' state which
    // shows the retry banner.
    overlayFadeTimerRef.current = setTimeout(() => {
      if (!overlayHiddenRef.current) {
        log('v360.overlay_timeout_slow', {});
        overlayHiddenRef.current = true;
        setLoadingState('slow');
        slowShownAtRef.current = Date.now(); // v368: stamp visibility start
        Animated.timing(overlayOpacity, {
          toValue: 0,
          duration: 300,
          useNativeDriver: true,
        }).start();
      }
    }, 8000); // v370: production 8s timeout. v365-v369 used 500ms for debug. User signed off on banner UX (min-show 2s + auto-close + frosted pill style).
    return () => {
      if (overlayFadeTimerRef.current) {
        clearTimeout(overlayFadeTimerRef.current);
        overlayFadeTimerRef.current = null;
      }
      if (stageTimer1Ref.current) clearTimeout(stageTimer1Ref.current);
      if (stageTimer2Ref.current) clearTimeout(stageTimer2Ref.current);
      if (bannerMinShowTimerRef.current) {
        clearTimeout(bannerMinShowTimerRef.current);
        bannerMinShowTimerRef.current = null;
      }
    };
  }, [mountKey, overlayOpacity]);

  // Fade overlay out when BOTH gates are satisfied.
  // v367: do NOT early-return on overlayHiddenRef.current — that guard
  // was preventing the slow-banner from auto-closing when the map
  // eventually finished loading. Now: if we have already faded the
  // overlay (timed out into 'slow' state), we still need to detect
  // map+fog ready and clear loadingState back to 'ready' so the banner
  // disappears. Mapbox keeps retrying tiles in the background — when
  // it finally succeeds, the banner should vanish automatically.
  // v368: when the banner is currently visible (loadingState === 'slow'),
  // enforce a minimum visible duration of SLOW_BANNER_MIN_MS. Otherwise
  // a network that finishes a few ms after the timeout would flash the
  // banner for a single frame, which is more confusing than helpful.
  useEffect(() => {
    if (!mapReady || !fogReady) return;
    // Always clear the timeout/stage timers — they're irrelevant once
    // both gates are satisfied.
    if (overlayFadeTimerRef.current) {
      clearTimeout(overlayFadeTimerRef.current);
      overlayFadeTimerRef.current = null;
    }
    if (stageTimer1Ref.current) clearTimeout(stageTimer1Ref.current);
    if (stageTimer2Ref.current) clearTimeout(stageTimer2Ref.current);

    // Path A: overlay still visible (haven't hit the slow timeout yet).
    // Standard happy-path fade-out.
    if (!overlayHiddenRef.current) {
      overlayHiddenRef.current = true;
      setLoadingState('ready');
      log('v360.overlay_both_ready_fadeout', {});
      Animated.timing(overlayOpacity, {
        toValue: 0,
        duration: 300,
        useNativeDriver: true,
      }).start();
      return;
    }

    // Path B: overlay already faded (banner is showing in 'slow' state).
    // Enforce minimum visible duration before flipping to 'ready'.
    const shownFor = Date.now() - slowShownAtRef.current;
    const remaining = SLOW_BANNER_MIN_MS - shownFor;
    if (remaining <= 0) {
      setLoadingState('ready');
      log('v367.banner_auto_close_after_slow', { shown_ms: shownFor });
      return;
    }
    // Wait the remaining time, then close. Cancel any prior scheduled
    // close (e.g. if useEffect re-runs).
    if (bannerMinShowTimerRef.current) clearTimeout(bannerMinShowTimerRef.current);
    bannerMinShowTimerRef.current = setTimeout(() => {
      setLoadingState('ready');
      log('v368.banner_min_show_elapsed_close', { shown_ms: SLOW_BANNER_MIN_MS });
      bannerMinShowTimerRef.current = null;
    }, remaining);
  }, [mapReady, fogReady, overlayOpacity]);

  // Retry handler: reset state + bump refetchToken to re-trigger pull.
  const handleRetryLoad = () => {
    log('v360.user_retry');
    setLoadingState('loading');
    setLoadingStage(0);
    setMapReady(false);
    setFogReady(false);
    overlayHiddenRef.current = false;
    overlayOpacity.setValue(1);
    setRefetchToken((n) => n + 1);
    setMountKey((n) => n + 1);
  };

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
  // O1 (2026-07-26): mountKey ref mirror,供 useFocusEffect 空 deps closure
  // 读 latest 值 (原直接读 mountKey state 是 stale closure,log 恒 0)。
  const mountKeyRef = useRef(0);

  useEffect(() => {
    if (!settingsHydrated) return;
    if (!firstVisitDone) setShowHint(true);
  }, [settingsHydrated, firstVisitDone]);

  // v326: hydrate persisted last-fix immediately on mount. If watcherFix
  // is already populated (warm reopen during the same session), do
  // nothing. Otherwise read AsyncStorage cache and write to store so the
  // map can draw at the last-known location while the watcher boots.
  // Prevents 12s "Looking for your position" on every cold-start.
  useEffect(() => {
    if (useMemoryStore.getState().lastWatcherFix) return;
    let cancelled = false;
    void (async () => {
      const cached = await readLastFix();
      if (cancelled) return;
      if (!cached) return;
      // Don't overwrite if a fresh watcher fix arrived during the await.
      if (useMemoryStore.getState().lastWatcherFix) return;
      log('memory.last_fix_hydrated', { age_ms: Date.now() - cached.ts });
      useMemoryStore.getState().setLastWatcherFix(cached.lat, cached.lng, cached.ts);
    })();
    return () => { cancelled = true; };
  }, []);

  useFocusEffect(
    React.useCallback(() => {
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
      log('v357.tab_focus_entry', {
        points_n: useMemoryStore.getState().points.length,
        mountKey_pre: mountKeyLatest,
        ms_since_last_mount: lastMountAtRef.current === 0 ? -1 : Date.now() - lastMountAtRef.current,
      });
      // v303 OTA 三修:扩充 tab_focus log,包含进入时的 state 快照,server
      // 可看用户进 memory 时 fog / points / hydrate 状态。
      log('memory.tab_focus', {
        points: useMemoryStore.getState().points.length,
        initialDone: useMemoryStore.getState().initialRevealDone,
        settingsHydrated: settingsHydratedLatest,
        mountKey: mountKeyLatest,
      });
      const now = Date.now();
      // Reset scope to 'mine' on every focus — per product spec, social
      // view is a deliberate switch, not a persistent default.
      useMemoryScopeStore.getState().setScope('mine');
      // S3 fix: debounce map remount separately. Cheap to keep the
      // map mounted across rapid back-and-forth; expensive to tear
      // it down and reload Mapbox tiles.
      if (now - lastMountAtRef.current >= FOCUS_REMOUNT_DEBOUNCE_MS) {
        lastMountAtRef.current = now;
        setMountKey((n) => {
          const next = n + 1;
          // v357 diagnostic: mountKey was actually bumped this focus.
          log('v357.mountKey_bumped', { from: n, to: next });
          mountKeyRef.current = next;
          return next;
        });
      }
      if (now - lastRefetchAtRef.current >= FOCUS_REFETCH_DEBOUNCE_MS) {
        lastRefetchAtRef.current = now;
        setRefetchToken((n) => n + 1);
      }
      // v303 OTA 三修:JS heartbeat — 500ms 一次的 log,证明 JS thread alive
      // (用户报"卡 15s 期间 log 也没上传" → heartbeat 帮我们看到 freeze 区间)。
      // 用 setInterval,失败时 GC 自动停。tab_blur cleanup 时 clearInterval。
      // O17 P-MEM-08: gate heartbeat behind __DEV__ — prod builds don't need
      // 500ms interval firing forever (JS wake keeps radio warm on cellular).
      const heartbeatStart = Date.now();
      const heartbeat = __DEV__ ? setInterval(() => {
        const elapsed = Date.now() - heartbeatStart;
        log('memory.js_heartbeat', { elapsed_ms: elapsed });
      }, 500) : null;
      return () => {
        if (heartbeat) clearInterval(heartbeat);
        log('memory.tab_blur', { total_focus_ms: Date.now() - heartbeatStart });
        // v327: force-flush logs on tab blur. Without this, all the
        // memory.* / fog.* / gps.* logs sit in the in-memory queue
        // until the app goes to background. User reported issues
        // while inside the tab can never be diagnosed otherwise.
        void flushLogsNow();
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])
  );

  // R4 + S1: only fetch a one-shot fix when (a) user explicitly
  // asked (refetchToken bumped) AND (b) watcher cache is stale.
  // The dep array is [refetchToken] — does NOT include watcherFix
  // so a watcher tick doesn't re-run this effect / wipe failReason.
  useEffect(() => {
    let cancelled = false;
    let timeoutTimer: ReturnType<typeof setTimeout> | null = null;

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
  }, [refetchToken]);

  // S1 fix (v0.2.6.4): prefer fresh watcher → else oneShot → else stale
  // watcher. The previous `watcherFix ?? oneShot` made oneShot dead code
  // whenever watcherFix was set, even if stale. Now the user's
  // recently-fetched one-shot wins over a stale watcher cache.
  const watcherFresh = !!watcherFix && Date.now() - watcherFix.ts < WATCHER_FIX_FRESH_MS;
  const coord: FixState | null = watcherFresh && watcherFix
    ? { lat: watcherFix.lat, lng: watcherFix.lng }
    : oneShot
      ? oneShot
      : watcherFix
        ? { lat: watcherFix.lat, lng: watcherFix.lng }
        : null;

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
    if (coord) _lastKnownCoord = { lat: coord.lat, lng: coord.lng, ts: Date.now() };
  }, [coord]);
  const stableCoord: FixState | null = coord ?? (
    _lastKnownCoord && Date.now() - _lastKnownCoord.ts < 30_000
      ? { lat: _lastKnownCoord.lat, lng: _lastKnownCoord.lng }
      : null
  );

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
  const lastRenderedCoordRef = useRef<{ lat: number; lng: number } | null>(null);
  if (stableCoord) {
    lastRenderedCoordRef.current = { lat: stableCoord.lat, lng: stableCoord.lng };
  }
  const persistentCoord = lastRenderedCoordRef.current;

  // v357 diagnostic: log every render of MemoryScreen body. ctx tells us
  // (a) which render index this is, (b) whether we have a coord to draw
  // the map with, (c) how many points exist in store at this instant.
  // Combined with v357.tab_focus_entry / v357.mountKey_bumped / v357.fog_*
  // / v357.mapbox_* this is the canonical timestamp ladder used to map
  // each visible flicker frame to a specific React/Mapbox event.
  log('v357.memory_screen_render', {
    render_n: _v357RenderN,
    persistentCoord_set: !!persistentCoord,
    points_n: useMemoryStore.getState().points.length,
    mountKey,
  });

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
    setRecenterToken((n) => n + 1);
    // v445 fix: eagerly update cameraCenterRef to real GPS location so
    // that reopening the hierarchy panel right after recenter uses the
    // new location, not the stale KL/etc from previous fly-to. The map's
    // onCameraChanged should also fire later, but relying on it alone
    // was unreliable for imperative camera moves.
    if (persistentCoord) {
      cameraCenterRef.current = { lat: persistentCoord.lat, lng: persistentCoord.lng };
      log('v445.recenter_camera_ref_set', { lat: persistentCoord.lat, lng: persistentCoord.lng });
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
      {/* V9: Back button matches Hiking — pill variant + safe-area top inset
          so it doesn't intrude into the Dynamic Island area. */}
      <View style={[styles.topBar, { paddingTop: insets.top + 24 }]} pointerEvents="box-none">
        <BackButton variant="pill" onPress={() => nav.goBack()} />
        {/* v376: Pick icon 移到 MemoryScopeToggle 内部作为第三个 segment,
            scope=friends 时 width+opacity 展开,scope=mine 时 collapse 到 0
            (用户 v375 反馈: 之前的 fixed-position 占位空白难看)。 */}
        <MemoryScopeToggle onPickPress={() => setPickModalOpen(true)} />
      </View>

      {/* v352 zoom-flicker fix: render MemoryMap with persistentCoord
          (last-rendered coord, kept in ref across re-renders) instead of
          stableCoord directly. Once MemoryMap has mounted once with
          valid coords, it stays mounted forever — transient nulls in
          stableCoord during zoom-induced re-renders no longer tear down
          MapView. The "Looking for position" / permission / error UI
          renders as an OVERLAY only when we've never seen any coord
          (i.e. persistentCoord is null too). Eliminates the full-screen
          flash that v346-v351 had on every zoom gesture. */}
      {persistentCoord ? (
        <MemoryMap
          ref={mapRef}
          centerLat={persistentCoord.lat}
          centerLng={persistentCoord.lng}
          recenterToken={recenterToken}
          flyToTarget={flyToTarget}
          onMapMoved={() => setMapMoved(true)}
          onCameraCenter={handleCameraCenter}
          onMapFullyReady={() => {
            log('v359.map_fully_ready_cb', {});
            setMapReady(true);
          }}
          onFogReady={() => {
            log('v359.fog_ready_cb', {});
            _fogEverReady = true;
            setFogReady(true);
          }}
          // BUG-008 fix (Sprint 71 post-review round 2): close the
          // strangerMarks prop chain with an explicit empty list. F5
          // STORY-00543 follow-up will add a loadPublicMarksBbox action
          // and populate this prop. Closing the prop chain now means F5
          // only needs to populate the source, not also touch MemoryMap.
          // Without this, CairnPinsLayer's strangerMarks defaulted to
          // undefined and Sprint 70 STORY-00543's visual layer was
          // structurally inert — caught by Devil's Advocate round 2.
          strangerMarks={publicMarkers}
          key={`map-${mountKey}`}
        />
      ) : failReason === 'permission' ? (
        <View style={styles.emptyState}>
          <MemoryStateMark label="LOCATION + MEMORY" />
          <Text style={[styles.emptyTitle, { color: theme.foreground }]}>Location permission needed</Text>
          <Text style={[styles.emptySub, { color: theme.foregroundSecondary }]}>
            Memory needs your location to draw the map.
          </Text>
          <TouchableOpacity
            style={[styles.emptyPrimaryBtn, { backgroundColor: theme.primary }]}
            onPress={() => Linking.openSettings()}
            activeOpacity={0.85}
          >
            <Text style={[styles.emptyPrimaryBtnText, { color: theme.onPrimary }]}>Open Settings</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.emptySecondaryBtn}
            onPress={() => setRefetchToken((n) => n + 1)}
            activeOpacity={0.7}
          >
            <Text style={[styles.emptySecondaryBtnText, { color: theme.foregroundSecondary }]}>Try again</Text>
          </TouchableOpacity>
        </View>
      ) : failReason === 'timeout' || failReason === 'error' ? (
        <View style={styles.emptyState}>
          <MemoryStateMark label="MEMORY MAP" />
          <Text style={[styles.emptyTitle, { color: theme.foreground }]}>
            {failReason === 'timeout' ? 'Could not get a GPS fix' : 'Location unavailable'}
          </Text>
          <Text style={[styles.emptySub, { color: theme.foregroundSecondary }]}>
            {failReason === 'timeout'
              ? 'GPS signal is weak. Move outside or near a window and try again.'
              : 'We could not read your location. Check that location services are on.'}
          </Text>
          <TouchableOpacity
            style={[styles.emptyPrimaryBtn, { backgroundColor: theme.primary }]}
            onPress={() => setRefetchToken((n) => n + 1)}
            activeOpacity={0.85}
          >
            <Text style={[styles.emptyPrimaryBtnText, { color: theme.onPrimary }]}>Try again</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <View style={styles.emptyState}>
          <MemoryStateMark label="PREPARING YOUR MAP" />
          <ActivityIndicator color={theme.primary} size="large" />
          <Text style={[styles.emptyTitle, { marginTop: 14, color: theme.foreground }]}>Looking for your position…</Text>
          <Text style={[styles.emptySub, { color: theme.foregroundSecondary }]}>
            We need a GPS fix to draw your memory map.
          </Text>
        </View>
      )}

      {persistentCoord && mapMoved && (
        <TouchableOpacity
          style={[styles.recenterBtn, { backgroundColor: theme.mapOverlay, borderColor: theme.border }]}
          onPress={() => {
            onRecenter();
            setMapMoved(false);
          }}
          activeOpacity={0.85}
        >
          {/* v334: Target icon to match HikingScreen.tsx recenter pill
              (decision E: "and an icon like Hiking, ..."). */}
          <Icon name="Target" size={22} color={theme.iconActive} strokeWidth={2} />
        </TouchableOpacity>
      )}

      {/* v424: Hierarchy button (left-bottom, mirrors Recenter position).
          Always visible when we have coords. Tap → toggle popover.
          Layers icon differentiates from Target crosshair on right. */}
      {persistentCoord && (
        <TouchableOpacity
          style={[
            styles.hierarchyBtn,
            { backgroundColor: theme.mapOverlay, borderColor: theme.border },
            hierarchyOpen && { backgroundColor: theme.primary, borderColor: theme.primary },
          ]}
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

      {/* v359: loading overlay covering MemoryMap until both gates fire
          (Mapbox onDidFinishRenderingMapFully + FogLayer first holes) or
          3s timeout. pointerEvents="none" so user gestures pass through
          to the back button and (once visible) the map. Only shown when
          persistentCoord exists — the no-coord branches above render
          their own full-screen UI and don't need this overlay. */}
      {persistentCoord && (
        <Animated.View
          pointerEvents="none"
          style={[styles.loadingOverlay, { opacity: overlayOpacity, backgroundColor: theme.background }]}
        >
          <View style={styles.loadingInner}>
            <View style={[styles.loadingLogoCircle, { backgroundColor: theme.surfaceElevated, borderColor: theme.border }]}>
              <CairnIcon name="memory" size={38} color={theme.iconActive} accent={theme.accent} active />
            </View>
            <Text style={[styles.loadingEyebrow, { color: theme.foregroundSecondary }]}>YOUR MEMORY</Text>
            <Text style={[styles.loadingTitle, { color: theme.foreground }]}>Opening your map</Text>
            <Text style={[styles.loadingSub, { color: theme.foregroundSecondary }]}>
              {loadingStage === 0
                ? 'Loading map…'
                : loadingStage === 1
                  ? 'Restoring explored places…'
                  : 'Network is slow, please wait…'}
            </Text>
            <ActivityIndicator
              color={theme.primary}
              size="small"
              style={styles.loadingSpinner}
            />
          </View>
        </Animated.View>
      )}
      {/* v366: slow-network banner — height-matched frosted pill that
          starts AFTER a visible gap from the back button and stretches
          to the screen right edge.
          User feedback on v365: bar was hugging the back button (gap too
          small), height didn't match back button (32 vs 31), and sepia
          brown looked off against the rest of the UI.
          v366 fixes:
            - left: 100 (12 topBar gutter + ~72 BackButton width + 16 gap)
            - height 31, paddingVertical 7 (matches BackButton.pillContent)
            - borderRadius 20 (Radius.pill, same as BackButton)
            - frosted-light background rgba(255,255,255,0.85) + dark
              text + soft card shadow — visually consistent with the
              back button instead of a foreign sepia bar
          Mapbox auto-retries tile loading underneath; user can dismiss
          via the X button. English copy only. */}
      {persistentCoord && loadingState === 'slow' && !slowBannerDismissed && (
        <View
          style={[styles.slowBanner, { top: insets.top + 8, left: 100, right: 12 }]}
          pointerEvents="box-none"
        >
          <ActivityIndicator
            color={Colors.primary}
            size="small"
            style={styles.slowBannerSpinner}
          />
          <Text style={styles.slowBannerText} numberOfLines={1}>
            Weak signal — still loading map…
          </Text>
          <TouchableOpacity
            style={styles.slowBannerClose}
            onPress={() => {
              log('v363.slow_banner_dismissed');
              setSlowBannerDismissed(true);
            }}
            activeOpacity={0.7}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Text style={styles.slowBannerCloseText}>✕</Text>
          </TouchableOpacity>
        </View>
      )}

      <ModalCard visible={showHint && isMemoryFocused} onDismiss={dismissHint} testID="memory-unlock-guidance">
          <View>
            <Text style={[styles.hintTitle, { color: theme.foreground }]}>Walk to unlock your memory</Text>
            <Text style={[styles.hintBody, { color: theme.foregroundSecondary }]}>
              The map starts covered in fog. As you walk around, the fog clears
              and the places you have been become part of your memory.
              {'\n\n'}
              Cairns left by you and others appear as you discover them.
            </Text>
            <AppButton label="Got it" onPress={dismissHint} />
          </View>
      </ModalCard>

      {/* BUG-D fix (v371 post-OTA): old bottom-right "Pick friends" FAB
          was replaced by the top-right Users icon in the top bar above.
          The bottom-right area was occluding map content too aggressively.
          The pick modal itself is unchanged — only its entry point moved. */}
      <MemoryFriendPickModal
        visible={pickModalOpen}
        onClose={handlePickModalClose}
        onCapHit={() => {
          handlePickModalClose();
          setPaywallOpen(true);
        }}
      />
      <PaywallSheet visible={paywallOpen} onClose={() => setPaywallOpen(false)} />

      {/* v434: Hierarchy popover — 2-layer tree (World → Country → City).
          Fetches panel data from /api/hierarchy/panel. */}
      {hierarchyOpen && (
        <HierarchyPanel
          titleId={hierarchyTitleId}
          currentCityId={hierarchyCurrentCityId}
          currentCountryId={hierarchyCurrentCountryId}
          onSelectItem={(itemId, itemType, bbox) => {
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
            const [minLng, minLat, maxLng, maxLat] = bbox;
            const bboxCenterLng = (minLng + maxLng) / 2;
            const bboxCenterLat = (minLat + maxLat) / 2;
            const inBbox = (lat: number, lng: number) =>
              lat >= minLat && lat <= maxLat && lng >= minLng && lng <= maxLng;
            const points = useMemoryStore.getState().points;
            const markers = useMarkerStore.getState().markers;
            let flyLng = bboxCenterLng;
            let flyLat = bboxCenterLat;
            let foundExplored = false;
            let bestDist = Infinity;
            for (const p of points) {
              if (!inBbox(p.lat, p.lng)) continue;
              const d = (p.lat - bboxCenterLat) ** 2 + (p.lng - bboxCenterLng) ** 2;
              if (d < bestDist) { bestDist = d; flyLat = p.lat; flyLng = p.lng; foundExplored = true; }
            }
            if (!foundExplored) {
              for (const m of markers) {
                if (!inBbox(m.lat, m.lng)) continue;
                const d = (m.lat - bboxCenterLat) ** 2 + (m.lng - bboxCenterLng) ** 2;
                if (d < bestDist) { bestDist = d; flyLat = m.lat; flyLng = m.lng; foundExplored = true; }
              }
            }
            const spanLng = maxLng - minLng;
            const spanLat = maxLat - minLat;
            const span = Math.max(spanLng, spanLat);
            let zoom = 12;
            if (span > 40) zoom = 3;
            else if (span > 8) zoom = 5;
            else if (span > 2) zoom = 8;
            else if (span > 0.3) zoom = 11;
            else zoom = 13;
            if (foundExplored) zoom = 14;

            flyTokenRef.current += 1;
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
            log('v441.hierarchy_fly', { itemId, flyLat, flyLng });
            // v436: city tap moves the map → update currentCityId AND
            // currentCountryId. In country-layer, title IS the country, so
            // any city tapped is a child of it. This makes ↑ back to World
            // correctly highlight the country the user just flew to.
            setHierarchyCurrentCityId(itemId);
            setHierarchyCurrentCountryId(hierarchyTitleId === 'world' ? null : hierarchyTitleId);
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
  root: { flex: 1, backgroundColor: MemoryColors.cream },
  topBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 12,
    zIndex: 10,
    flexDirection: 'row',
    alignItems: 'flex-start',
    // Sprint 70 STORY-00539: BackButton on left, MemoryScopeToggle pushed
    // to right via space-between. Both pill-shaped so they balance visually.
    justifyContent: 'space-between',
  },
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
    right: 16, bottom: 24,
    width: 48, height: 48, borderRadius: 24,
    backgroundColor: '#fff',
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 }, elevation: 4,
    borderWidth: 1, borderColor: '#e8dfc8',
  },
  // v424: Hierarchy button (left-bottom, mirrors Recenter). Always visible
  // once GPS coords known. Layers icon → tap opens the region popover.
  hierarchyBtn: {
    position: 'absolute',
    left: 16, bottom: 24,
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
  // map+fog hydrate window. Cream background matches the screen root
  // so the cream→overlay transition is invisible; only the overlay→map
  // fade-out is perceived.
  loadingOverlay: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: MemoryColors.cream,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 5,
  },
  loadingInner: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 40,
  },
  loadingLogoCircle: {
    width: 84, height: 84, borderRadius: 42,
    backgroundColor: '#fffaf0',
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1.5, borderColor: '#e8dfc8',
    shadowColor: '#5b4628',
    shadowOpacity: 0.10,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
    marginBottom: 18,
  },
  loadingTitle: {
    fontSize: 22,
    fontWeight: '600',
    color: Colors.textPrimary,
    letterSpacing: -0.25,
    marginBottom: 6,
  },
  loadingEyebrow: {
    fontSize: 9,
    lineHeight: 12,
    fontWeight: '700',
    letterSpacing: 1.45,
    marginBottom: 6,
  },
  loadingSub: {
    fontSize: 13,
    color: Colors.textSecondary,
    textAlign: 'center',
    marginBottom: 18,
  },
  loadingSpinner: {
    marginTop: 4,
  },
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
  slowBannerClose: {
    width: 20, height: 20, borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 4,
  },
  slowBannerCloseText: {
    color: Colors.primary,
    fontSize: 11,
    fontWeight: '700',
    opacity: 0.7,
  },
});
