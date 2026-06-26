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
import { View, StyleSheet, SafeAreaView, Text, ActivityIndicator, TouchableOpacity, Linking, Modal } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Location from 'expo-location';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { useMemoryStore } from '../store/useMemoryStore';
import { useMemorySettingsStore } from '../store/useMemorySettingsStore';
import { readLastFix } from '../services/lastFixCache';
import { MemoryColors } from '../config/memoryConfig';
import { MemoryMap } from '../components/MemoryMap';
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

export function MemoryScreen() {
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
  const firstVisitDone = useMemorySettingsStore((s) => s.firstVisitDone);
  const settingsHydrated = useMemorySettingsStore((s) => s.hydrated);
  const setSetting = useMemorySettingsStore((s) => s.set);

  const [oneShot, setOneShot] = useState<FixState | null>(null);
  const [failReason, setFailReason] = useState<FailReason | null>(null);
  const [refetchToken, setRefetchToken] = useState(0);
  const [recenterToken, setRecenterToken] = useState(0);
  const [mountKey, setMountKey] = useState(0);
  const [showHint, setShowHint] = useState(false);
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
      </View>

      {stableCoord ? (
        <MemoryMap
          centerLat={stableCoord.lat}
          centerLng={stableCoord.lng}
          recenterToken={recenterToken}
          onMapMoved={() => setMapMoved(true)}
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

      {stableCoord && mapMoved && (
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
});
