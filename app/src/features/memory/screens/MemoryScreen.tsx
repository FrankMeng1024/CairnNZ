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
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Location from 'expo-location';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { useMemoryStore } from '../store/useMemoryStore';
import { useMemorySettingsStore } from '../store/useMemorySettingsStore';
import { performInitialRevealIfNeeded } from '../services/unlockEngine';
import { MemoryColors } from '../config/memoryConfig';
import { MemoryMap } from '../components/MemoryMap';
import { MemorySummaryCard } from '../components/MemorySummaryCard';
import { BackButton } from '../../../components/BackButton';
import { Icon } from '../../../components/Icon';
import { Colors } from '../../../components/tokens';
import { log } from '../../../services/appLog';

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

export function MemoryScreen() {
  const nav = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const watcherFix = useMemoryStore((s) => s.lastWatcherFix);
  const initialDone = useMemoryStore((s) => s.initialRevealDone);
  const firstVisitDone = useMemorySettingsStore((s) => s.firstVisitDone);
  const fogMode = useMemorySettingsStore((s) => s.fogMode);
  const settingsHydrated = useMemorySettingsStore((s) => s.hydrated);
  const setSetting = useMemorySettingsStore((s) => s.set);

  const [oneShot, setOneShot] = useState<FixState | null>(null);
  const [failReason, setFailReason] = useState<FailReason | null>(null);
  const [refetchToken, setRefetchToken] = useState(0);
  const [recenterToken, setRecenterToken] = useState(0);
  const [mountKey, setMountKey] = useState(0);
  const [showHint, setShowHint] = useState(false);
  const lastRefetchAtRef = useRef(0);
  // S3 fix: separate debounce for the EXPENSIVE map remount.
  const lastMountAtRef = useRef(0);

  useEffect(() => {
    if (!settingsHydrated) return;
    if (!firstVisitDone) setShowHint(true);
  }, [settingsHydrated, firstVisitDone]);

  useFocusEffect(
    React.useCallback(() => {
      // v303 OTA 三修:扩充 tab_focus log,包含进入时的 state 快照,server
      // 可看用户进 memory 时 fog / points / hydrate 状态。
      log('memory.tab_focus', {
        points: useMemoryStore.getState().points.length,
        initialDone: useMemoryStore.getState().initialRevealDone,
        settingsHydrated,
        fogMode,
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

  useEffect(() => {
    if (initialDone) return;
    if (!coord) return;
    log('memory.initial_reveal', { lat: coord.lat, lng: coord.lng });
    performInitialRevealIfNeeded(coord.lat, coord.lng);
  }, [initialDone, coord]);

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
    <SafeAreaView style={styles.root}>
      {/* V9: Back button matches Hiking — pill variant + safe-area top inset
          so it doesn't intrude into the Dynamic Island area. */}
      <View style={[styles.topBar, { paddingTop: insets.top + 8 }]} pointerEvents="box-none">
        <BackButton variant="pill" onPress={() => nav.goBack()} />
      </View>

      {/* v303 OTA 四修 P2: SDF (Soft/Sharp/Off) 在没装 native module 的
          OTA 期间禁用。我们用 Fog.isPipelineReady ping 检测,native 不
          可用就 disabled + 显示 "Build 7/1" 提示。仅 Legacy 可点。 */}
      <View style={[styles.fogModeRow, { top: insets.top + 8 }]} pointerEvents="box-none">
        {(['legacy', 'sdf-soft', 'sdf-sharp', 'off'] as const).map((m) => {
          const active = fogMode === m;
          const isSdfMode = m !== 'legacy';
          // 当前 OTA-only 期间(native 没 build):SDF 三个 mode 灰掉
          const sdfDisabled = isSdfMode;
          const label = m === 'legacy' ? 'Legacy'
                     : m === 'sdf-soft' ? 'Soft 🔒'
                     : m === 'sdf-sharp' ? 'Sharp 🔒'
                     : 'Off 🔒';
          return (
            <TouchableOpacity
              key={m}
              style={[
                styles.fogModeChip,
                active && styles.fogModeChipActive,
                sdfDisabled && { opacity: 0.4 },
              ]}
              onPress={() => {
                if (sdfDisabled) {
                  log('memory.fog_mode_locked_tap', { to: m });
                  return;
                }
                log('memory.fog_mode_change', { from: fogMode, to: m });
                setSetting('fogMode', m);
              }}
              activeOpacity={sdfDisabled ? 1 : 0.8}
            >
              <Text style={[styles.fogModeChipText, active && styles.fogModeChipTextActive]}>{label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {coord ? (
        <MemoryMap
          centerLat={coord.lat}
          centerLng={coord.lng}
          recenterToken={recenterToken}
          // v303 四轮 subagent #2 fix (verify V4): settings 还没 hydrate
          // 时 fogMode 是 DEFAULTS('sdf-soft'),会让 MemoryMap 第一帧就
          // attach native fog,而老用户实际 persist 是 'legacy'。hydrate
          // 完成后立刻 detach 浪费一次完整 attach+ping。在 hydrate 前
          // 用 'legacy'(JS fog,无 native 风险),hydrate 完才用真值。
          fogMode={settingsHydrated ? fogMode : 'legacy'}
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

      {coord && (
        <TouchableOpacity style={styles.recenterBtn} onPress={onRecenter} activeOpacity={0.8}>
          <Icon name="Navigation" size={20} color={MemoryColors.sepiaDeep} strokeWidth={2.2} />
        </TouchableOpacity>
      )}

      <MemorySummaryCard />

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
    </SafeAreaView>
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
  fogModeRow: {
    position: 'absolute',
    right: 12,
    zIndex: 10,
    flexDirection: 'row',
    gap: 4,
  },
  fogModeChip: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.85)',
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.1)',
  },
  fogModeChipActive: {
    backgroundColor: MemoryColors.sepia,
    borderColor: MemoryColors.sepia,
  },
  fogModeChipText: {
    fontSize: 10,
    fontWeight: '600',
    color: MemoryColors.sepiaDeep,
  },
  fogModeChipTextActive: {
    color: '#fff',
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
