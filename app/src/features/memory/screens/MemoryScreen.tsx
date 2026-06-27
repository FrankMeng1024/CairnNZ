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

import React, { useEffect, useRef, useState } from 'react';
import { View, StyleSheet, SafeAreaView, Text, ActivityIndicator, TouchableOpacity, Linking, Modal, Animated } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Location from 'expo-location';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { useMemoryStore } from '../store/useMemoryStore';
import { useMemorySettingsStore } from '../store/useMemorySettingsStore';
import { useMemoryScopeStore } from '../store/useMemoryScopeStore';
import { readLastFix } from '../services/lastFixCache';
import { MemoryColors } from '../config/memoryConfig';
import { MemoryMap } from '../components/MemoryMap';
import { MemoryScopeToggle } from '../components/MemoryScopeToggle';
import { MemoryFriendPickModal } from '../components/MemoryFriendPickModal';
import { PaywallSheet } from '../components/PaywallSheet';
import { BackButton } from '../../../components/BackButton';
import { Icon } from '../../../components/Icon';
import { Colors } from '../../../components/tokens';
import { log, flushNow as flushLogsNow } from '../../../services/appLog';
// v322: ForegroundUnlockManager moved here from App root. Mounts only
// when MemoryScreen mounts, unmounts when user leaves. This means H3 +
// memory hydrate + pullMemoryFromServer only run when fog is actually
// being viewed — fixes login-time crash where eager-loading these on
// Home (which has no fog UI) crashed the app.
import { ForegroundUnlockManager } from '../components/ForegroundUnlockManager';

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
// BUG-011 fix (Sprint 71 post-review round 3): stable module-level empty
// list used for the strangerMarks prop until F5 loader populates real
// data. Avoids creating a new array literal on every MemoryScreen render,
// which would churn MemoryMap props identity + force CairnPinsLayer
// re-renders even when nothing relevant changed.
const EMPTY_STRANGER_MARKS: import('../../../store/useMarkerStore').Marker[] = [];

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

// v357 diagnostic: module-scope counter for MemoryScreen render invocations.
// Counts across mount/unmount within the same JS session so we can tell
// apart "1st cold render" vs "Nth re-render after tab switch".
let _memoryScreenRenderCount = 0;

export function MemoryScreen() {
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
  const firstVisitDone = useMemorySettingsStore((s) => s.firstVisitDone);
  const settingsHydrated = useMemorySettingsStore((s) => s.hydrated);
  const setSetting = useMemorySettingsStore((s) => s.set);

  const [oneShot, setOneShot] = useState<FixState | null>(null);
  const [failReason, setFailReason] = useState<FailReason | null>(null);
  const [refetchToken, setRefetchToken] = useState(0);
  const [recenterToken, setRecenterToken] = useState(0);
  const [mountKey, setMountKey] = useState(0);
  const [showHint, setShowHint] = useState(false);

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
  const [fogReady, setFogReady] = useState(false);
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
      // v357 diagnostic: tab focus entry — fires BEFORE mountKey bump.
      // The pair (v357.tab_focus_entry → v357.mountKey_bumped) lets us
      // see whether mountKey actually bumped this focus (debounce-gated)
      // or was skipped (FOCUS_REMOUNT_DEBOUNCE_MS window still active).
      log('v357.tab_focus_entry', {
        points_n: useMemoryStore.getState().points.length,
        mountKey_pre: mountKey,
        ms_since_last_mount: lastMountAtRef.current === 0 ? -1 : Date.now() - lastMountAtRef.current,
      });
      // v303 OTA 三修:扩充 tab_focus log,包含进入时的 state 快照,server
      // 可看用户进 memory 时 fog / points / hydrate 状态。
      log('memory.tab_focus', {
        points: useMemoryStore.getState().points.length,
        initialDone: useMemoryStore.getState().initialRevealDone,
        settingsHydrated,
        mountKey,
      });
      const now = Date.now();
      // S3 fix: debounce map remount separately. Cheap to keep the
      // map mounted across rapid back-and-forth; expensive to tear
      // it down and reload Mapbox tiles.
      if (now - lastMountAtRef.current >= FOCUS_REMOUNT_DEBOUNCE_MS) {
        lastMountAtRef.current = now;
        setMountKey((n) => n + 1);
        // v357 diagnostic: mountKey was actually bumped this focus.
        // Next MemoryScreen render will use a new key for MemoryMap →
        // MapView remount → mapbox style reload → fog_layer_mount.
        log('v357.mountKey_bumped', { from: mountKey, to: mountKey + 1 });
      }
      if (now - lastRefetchAtRef.current >= FOCUS_REFETCH_DEBOUNCE_MS) {
        lastRefetchAtRef.current = now;
        setRefetchToken((n) => n + 1);
      }
      // v303 OTA 三修:JS heartbeat — 500ms 一次的 log,证明 JS thread alive
      // (用户报"卡 15s 期间 log 也没上传" → heartbeat 帮我们看到 freeze 区间)。
      // 用 setInterval,失败时 GC 自动停。tab_blur cleanup 时 clearInterval。
      const heartbeatStart = Date.now();
      const heartbeat = setInterval(() => {
        const elapsed = Date.now() - heartbeatStart;
        log('memory.js_heartbeat', { elapsed_ms: elapsed });
      }, 500);
      return () => {
        clearInterval(heartbeat);
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
    // R7 fix: only refetch GPS if we have nothing OR our cached fix is
    // older than the freshness window. Otherwise just camera-flyTo.
    const stale = !watcherFix || Date.now() - watcherFix.ts >= WATCHER_FIX_FRESH_MS;
    if (stale && Date.now() - lastRefetchAtRef.current >= FOCUS_REFETCH_DEBOUNCE_MS) {
      lastRefetchAtRef.current = Date.now();
      setRefetchToken((n) => n + 1);
    }
  };

  return (
    <View style={styles.root}>
      {/* v322: fgum mounts here. Unmounts when MemoryScreen unmounts
          (user navigates back to Home), releasing GPS watcher + h3
          + memory-store subscriptions. */}
      <ForegroundUnlockManager />
      {/* V9: Back button matches Hiking — pill variant + safe-area top inset
          so it doesn't intrude into the Dynamic Island area. */}
      <View style={[styles.topBar, { paddingTop: insets.top + 8 }]} pointerEvents="box-none">
        <BackButton variant="pill" onPress={() => nav.goBack()} />
        {/* BUG-D fix (v371 post-OTA UX): scope toggle stays right-side;
            Pick friends entry moved from a bottom-right FAB (occluded the
            map) to a top-right icon button next to the toggle. Only
            visible in Friends scope. */}
        <View style={styles.topRightCluster}>
          {memoryScope === 'friends' ? (
            <TouchableOpacity
              style={styles.topPickBtn}
              onPress={() => setPickModalOpen(true)}
              activeOpacity={0.7}
              testID="memory-pick-friends-top"
            >
              <Icon name="Users" size={16} color={Colors.primary} strokeWidth={2.2} />
            </TouchableOpacity>
          ) : null}
          <MemoryScopeToggle />
        </View>
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
          centerLat={persistentCoord.lat}
          centerLng={persistentCoord.lng}
          recenterToken={recenterToken}
          onMapMoved={() => setMapMoved(true)}
          onMapFullyReady={() => {
            log('v359.map_fully_ready_cb', {});
            setMapReady(true);
          }}
          onFogReady={() => {
            log('v359.fog_ready_cb', {});
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
          strangerMarks={EMPTY_STRANGER_MARKS}
          key={`map-${mountKey}`}
        />
      ) : failReason === 'permission' ? (
        <View style={styles.waitingForGps}>
          <Text style={styles.waitingTitle}>Location permission needed</Text>
          <Text style={styles.waitingSub}>
            Memory needs your location to draw the map.
          </Text>
          <TouchableOpacity style={styles.primaryBtn} onPress={() => Linking.openSettings()}>
            <Text style={styles.primaryBtnText}>Open Settings</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.secondaryBtn} onPress={() => setRefetchToken((n) => n + 1)}>
            <Text style={styles.secondaryBtnText}>Try again</Text>
          </TouchableOpacity>
        </View>
      ) : failReason === 'timeout' || failReason === 'error' ? (
        <View style={styles.waitingForGps}>
          <Text style={styles.waitingTitle}>
            {failReason === 'timeout' ? 'Could not get a GPS fix' : 'Location unavailable'}
          </Text>
          <Text style={styles.waitingSub}>
            {failReason === 'timeout'
              ? 'GPS signal is weak. Move outside or near a window and try again.'
              : 'We could not read your location. Check that location services are on.'}
          </Text>
          <TouchableOpacity style={styles.primaryBtn} onPress={() => setRefetchToken((n) => n + 1)}>
            <Text style={styles.primaryBtnText}>Try again</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <View style={styles.waitingForGps}>
          <ActivityIndicator color={MemoryColors.sepia} size="large" />
          <Text style={[styles.waitingTitle, { marginTop: 16 }]}>Looking for your position…</Text>
          <Text style={styles.waitingSub}>
            We need a GPS fix to draw your memory map.
          </Text>
        </View>
      )}

      {persistentCoord && mapMoved && (
        <TouchableOpacity
          style={styles.recenterBtn}
          onPress={() => {
            onRecenter();
            setMapMoved(false);
          }}
          activeOpacity={0.85}
        >
          {/* v334: Target icon to match HikingScreen.tsx recenter pill
              (decision E: "and an icon like Hiking, ..."). */}
          <Icon name="Target" size={22} color={Colors.primary} strokeWidth={2} />
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
          style={[styles.loadingOverlay, { opacity: overlayOpacity }]}
        >
          <View style={styles.loadingInner}>
            <View style={styles.loadingLogoCircle}>
              <Icon name="Mountain" size={44} color={MemoryColors.sepia} strokeWidth={1.5} />
            </View>
            <Text style={styles.loadingTitle}>Cairn</Text>
            <Text style={styles.loadingSub}>
              {loadingStage === 0
                ? 'Loading map…'
                : loadingStage === 1
                  ? 'Loading your trails…'
                  : 'Network is slow, please wait…'}
            </Text>
            <ActivityIndicator
              color={MemoryColors.sepia}
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

      <Modal visible={showHint} transparent animationType="fade" onRequestClose={dismissHint}>
        <View style={styles.hintBackdrop}>
          <View style={styles.hintCard}>
            <Text style={styles.hintTitle}>Walk to unlock your memory</Text>
            <Text style={styles.hintBody}>
              The map starts covered in fog. As you walk around, the fog clears
              and the places you have been become part of your memory.
              {'\n\n'}
              Cairns left by you and others appear as you discover them.
            </Text>
            <TouchableOpacity style={styles.hintBtn} onPress={dismissHint} activeOpacity={0.85}>
              <Text style={styles.hintBtnText}>Got it</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* BUG-D fix (v371 post-OTA): old bottom-right "Pick friends" FAB
          was replaced by the top-right Users icon in the top bar above.
          The bottom-right area was occluding map content too aggressively.
          The pick modal itself is unchanged — only its entry point moved. */}
      <MemoryFriendPickModal
        visible={pickModalOpen}
        onClose={() => setPickModalOpen(false)}
        onCapHit={() => {
          setPickModalOpen(false);
          setPaywallOpen(true);
        }}
      />
      <PaywallSheet visible={paywallOpen} onClose={() => setPaywallOpen(false)} />
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
  waitingForGps: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  waitingTitle: { fontSize: 16, fontWeight: '500', color: MemoryColors.sepiaDeep },
  waitingSub:   { fontSize: 13, color: MemoryColors.cairnPublic, marginTop: 8, textAlign: 'center' },
  primaryBtn: {
    marginTop: 20,
    backgroundColor: MemoryColors.sepia,
    paddingVertical: 12, paddingHorizontal: 24, borderRadius: 12,
  },
  primaryBtnText: { color: '#fff', fontSize: 14, fontWeight: '500' },
  secondaryBtn: { marginTop: 10, paddingVertical: 10, paddingHorizontal: 18 },
  secondaryBtnText: { color: MemoryColors.cairnPublic, fontSize: 13 },
  recenterBtn: {
    position: 'absolute',
    right: 16, bottom: 110,
    width: 48, height: 48, borderRadius: 24,
    backgroundColor: '#fff',
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 }, elevation: 4,
    borderWidth: 1, borderColor: '#e8dfc8',
  },
  // BUG-D fix (v371 post-OTA): Pick friends top-right cluster — sits
  // inline with the scope toggle in the top bar. Replaces the bottom-
  // right FAB pattern which was occluding map content.
  topRightCluster: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  topPickBtn: {
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: Colors.surface,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: Colors.border,
    shadowColor: '#000', shadowOpacity: 0.14, shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 }, elevation: 3,
  },
  hintBackdrop: {
    flex: 1, backgroundColor: 'rgba(20,20,20,0.55)',
    alignItems: 'center', justifyContent: 'center', padding: 28,
  },
  hintCard: {
    backgroundColor: '#fff', borderRadius: 18, padding: 22,
    width: '100%', maxWidth: 360,
  },
  hintTitle: { fontSize: 17, fontWeight: '600', color: MemoryColors.sepiaDeep, marginBottom: 10 },
  hintBody:  { fontSize: 13, lineHeight: 19, color: Colors.textSecondary, marginBottom: 18 },
  hintBtn:   { backgroundColor: MemoryColors.sepia, paddingVertical: 12, alignItems: 'center', borderRadius: 12 },
  hintBtnText: { color: '#fff', fontWeight: '600', fontSize: 14 },
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
    color: MemoryColors.sepiaDeep,
    letterSpacing: 1.2,
    marginBottom: 6,
  },
  loadingSub: {
    fontSize: 13,
    color: MemoryColors.sepia,
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
