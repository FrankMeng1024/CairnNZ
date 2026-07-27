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
  Alert, Animated, Easing,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Location from 'expo-location';
import { useKeepAwake } from 'expo-keep-awake';
import { useNavigation, CommonActions } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/RootNavigator';
import { useAppStore } from '../store/useAppStore';
import { useTrackingStore } from '../store/useTrackingStore';
import { useMarkerStore } from '../store/useMarkerStore';
import { useRouteStore } from '../store/useRouteStore';
import { getCurrentRegion } from '../config/regions';
import { formatDistance, formatDuration, haversineM } from '../utils/geo';
import { Colors, Spacing, Radius, FontSize, Shadow, IconSize } from '../components/tokens';
import { Icon } from '../components/Icon';
import { StopSummarySheet } from './StopSummarySheet';
import { MarkerDetailSheet } from './MarkerDetailSheet';
import { CompassNeedle } from './CompassNeedle';
import { BackButton } from '../components/BackButton';
import { PulseDot } from '../components/PulseDot';
import { PressBtn } from '../components/PressBtn';
import { FLAG_TYPES } from '../data/flagTypes';
import { HikingMap } from './HikingMap';
import { TooShortSheet } from '../components/TooShortSheet';
import { UnfinishedRecoveryModal } from '../components/UnfinishedRecoveryModal';
// v429 hotfix: SimWalkerOverlay static import removed to prevent gpsInjector
// top-level side-effects from running on every HikingScreen mount (bundling
// still includes the module but only runs when the gate is fully open).
// useSimWalkerStore import stays because it's just a Zustand store, no side effect.
import { useSimWalkerStore } from '../dev/simWalker/useSimWalkerStore';
import { useSettingsStore } from '../store/useSettingsStore';


// ── Main HikingScreen ──────────────────────────────────────────────────────
type Nav = NativeStackNavigationProp<RootStackParamList>;

type UIState = 'map' | 'detail';

export function HikingScreen() {
  // v430 fix: __DEV__ gate removed. User wanted sim-walker visible in
  // production build when debugMode is toggled ON. Since debugMode requires
  // 5-tap on version + is only user-reachable via Settings, this is safe
  // — no accidental leak to normal users. Bundle still contains the
  // sim-walker module (~10KB gzipped), acceptable pending R2 dynamic import.
  const debugMode = useSettingsStore((s) => s.debugMode);
  const simWalkerActive = useSimWalkerStore((s) => s.active);
  const showSimWalker = debugMode && simWalkerActive;

  const nav = useNavigation<Nav>();
  const { uiMode } = useAppStore();
  const isExpert = uiMode === 'expert';
  const insets = useSafeAreaInsets();

  // Real tracking store
  const status = useTrackingStore(s => s.status);
  const durationS = useTrackingStore(s => s.durationS);
  const distanceM = useTrackingStore(s => s.distanceM);
  const elevationGainM = useTrackingStore(s => s.elevationGainM);
  const locationAvailable = useTrackingStore(s => s.locationAvailable);
  const lastCoordinate = useTrackingStore(s => s.lastCoordinate);
  const sessionId = useTrackingStore(s => s.sessionId);
  const trackPoints = useTrackingStore(s => s.trackPoints);
  // v78: prefer smoothed track for live polyline render. Same Kalman
  // pass that MapHistoryScreen uses post-hoc, but applied live here so
  // Hike screen shows the same clean line the user will see in
  // Activities — not a sawtooth raw GPS jitter. Falls back to raw if
  // smoothed is empty (very early in the session).
  const trackPointsSmoothed = useTrackingStore(s => s.trackPointsSmoothed);
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
  const discardCurrentSession = useTrackingStore(s => s.discardCurrentSession);
  const activityMode = useTrackingStore(s => s.activityMode);

  // Real marker store
  const deleteMarker = useMarkerStore(s => s.deleteMarker);
  const getMarkersForRegion = useMarkerStore(s => s.getMarkersForRegion);
  const allMarkers = useMarkerStore(s => s.markers);
  const region = getCurrentRegion();
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
  // Initialize phase from current tracking status — if user has an active hike
  // and re-enters this screen (Home → Hiking again), jump straight to the
  // tracking UI instead of forcing the route picker.
  const [phase, setPhase] = useState<'select' | 'tracking'>(() =>
    useTrackingStore.getState().status === 'tracking' ? 'tracking' : 'select',
  );
  const [selectedRoute, setSelectedRoute] = useState<string | null>(null);

  // Live compass: heading in degrees from north, updated by
  // watchHeadingAsync. compassEnabled toggles the sensor on/off so
  // the user can "close the lid" to save battery if they don't want
  // a live needle. Permission is shared with location, already
  // granted by the time the user is in tracking mode.
  // Default: closed (lid icon visible) — most users don't need
  // continuous orientation, and the sensor + low-pass filter cost
  // a small amount of battery. Tap to open.
  const [heading, setHeading] = useState<number | null>(null);
  const [compassEnabled, setCompassEnabled] = useState(false);
  useEffect(() => {
    if (!compassEnabled) {
      setHeading(null);
      return;
    }
    let sub: { remove: () => void } | null = null;
    let cancelled = false;
    (async () => {
      try {
        const perm = await Location.getForegroundPermissionsAsync();
        if (!perm.granted) return;
        sub = await Location.watchHeadingAsync(({ trueHeading, magHeading }) => {
          if (cancelled) return;
          // Prefer trueHeading (geographic north) when available;
          // fall back to magHeading (magnetic north) — close enough
          // for a hiker's mental model. -1 means unavailable.
          const h = trueHeading >= 0 ? trueHeading : magHeading;
          if (h < 0) return;
          // Low-pass filter: 70% old + 30% new, so the needle settles
          // smoothly instead of jittering ±5° every frame on devices
          // with imperfect magnetometer calibration.
          setHeading(prev => {
            if (prev == null) return h;
            // Handle the 360→0 wrap (shortest angular distance)
            let delta = h - prev;
            if (delta > 180) delta -= 360;
            if (delta < -180) delta += 360;
            return (prev + delta * 0.3 + 360) % 360;
          });
        });
      } catch {
        // Compass unavailable — leave heading null, UI shows static
        // compass icon as a fallback.
      }
    })();
    return () => {
      cancelled = true;
      sub?.remove();
    };
  }, [compassEnabled]);

  const routes = useRouteStore(s => s.routes);
  const loadRoutes = useRouteStore(s => s.loadRoutes);
  const isTracking = status === 'tracking';
  // v120: paused state behaves like tracking for layout purposes (the
  // user pauses via Stop, the summary sheet appears, but the live stats
  // bar stays visible so the user can still see distance/time/elev).
  const isTrackingOrPaused = status === 'tracking' || status === 'paused';

  // v412: unfinished 恢复弹窗 state
  // 进入 Hiking 界面时检测磁盘 backup, 依赖 hydrationTs 让 iOS jetsam 复活后能重跑
  // v412 4-eye fix (Critical #4): hydrationTs 现在是 useAppStore 真实字段, 冷启 hydrate 完成后会变
  const hydrationTs = useAppStore(s => s.hydrationTs ?? 0);
  const [unfinished, setUnfinished] = useState<{
    sessionId: string;
    remoteId?: number | null;
    activityMode: 'hiking' | 'running';
    startedAt: number;
    distanceM: number;
    durationS: number;
    lastPointAt: number;
  } | null>(null);
  useEffect(() => {
    // 只在非 tracking/paused 状态下检测: 用户已经在 recording 中不该弹恢复
    if (isTrackingOrPaused) return;
    let cancelled = false;
    (async () => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const hikeTrackWriter = require('../services/hikeTrackWriter');
        if (typeof hikeTrackWriter.listActiveHikes !== 'function') return;
        const active = await hikeTrackWriter.listActiveHikes();
        if (cancelled || !Array.isArray(active)) return;
        // O1 batch 28.2: log recovery 触发条件,便于诊断 Bug 5
        // "save&end 后错误弹上次未完成"。若 active.length > 0 说明磁盘
        // 还有 active/*.jsonl 未清 → save 路径 markUploaded 时机问题。
        try {
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const cl = require('../services/crashLogger');
          (cl.crashLogger ?? cl.default)?.breadcrumb?.(`recovery:list active_n=${active.length}${active.length > 0 ? ' sids=' + active.map((f: any) => (f.session_id ?? f.sessionId ?? '?').slice(0, 8)).join(',') : ''}`);
        } catch {/* silent */}

        // v430 dual-source detection: if disk has NO active file, ALSO
        // check server for a dangling POST /start row that never got saved.
        // Root cause: startHikeTrack fire-and-forget could lose the meta
        // write if user killed app immediately after tapping Start (fixed
        // separately by await, but backend-side detection catches historic
        // rows too).
        if (active.length === 0) {
          try {
            const { API_BASE_URL } = require('../config/api');
            const { getToken } = require('../services/tokenStore');
            const token = await getToken();
            if (token) {
              const controller = new AbortController();
              const timer = setTimeout(() => controller.abort(), 5_000);
              try {
                const res = await fetch(`${API_BASE_URL}/api/sessions/unfinished`, {
                  headers: { Authorization: `Bearer ${token}` },
                  signal: controller.signal,
                });
                clearTimeout(timer);
                if (res.ok) {
                  const j = await res.json();
                  if (j.session) {
                    const s = j.session;
                    setUnfinished({
                      sessionId: `remote-${s.id}`,
                      remoteId: s.id,
                      activityMode: s.type || 'hiking',
                      startedAt: Date.parse(s.start_time),
                      distanceM: 0,
                      durationS: 0,
                      lastPointAt: Date.parse(s.start_time),
                    });
                    return;
                  }
                }
              } catch { clearTimeout(timer); /* silent */ }
            }
          } catch { /* silent */ }
          return;
        }

        // v412 修 (real UI test): hikeTrackWriter.listActiveHikes 返回 snake_case
        // (session_id / last_ts), 老代码用 camelCase 匹配 filter 空. 兼容两种命名.
        const norm = (f: any) => ({
          sessionId: f.session_id ?? f.sessionId,
          lastTs: f.last_ts ?? f.lastTs,
          startedAt: f.started_at ?? f.startedAt,
          activityMode: f.activity_mode ?? f.activityMode ?? 'hiking',
          remoteId: f.remote_id ?? f.remoteId ?? null,
          distanceM: f.distance_m ?? f.distanceM ?? 0,
          durationS: f.duration_s ?? f.durationS ?? 0,
        });
        const normalized = active.map(norm);

        // 72h 内: 弹恢复; 72h 外: 静默删 (由 syncDaemon/hikeTracksCache 别处兜底)
        // v412 修 (real UI test): hikeTrackWriter.listActiveHikes 不返回 activityMode 字段
        // 因此不能按 activityMode 过滤. 假设 hikeTrackWriter 只跟 hike, run 走另一个 writer (未来).
        const cutoff = Date.now() - 72 * 3600_000;
        const recent = normalized
          .filter((f: any) => (f.lastTs ?? f.startedAt ?? 0) > cutoff)
          .sort((a: any, b: any) => (b.lastTs ?? 0) - (a.lastTs ?? 0));
        if (recent.length === 0) return;
        const latest = recent[0];
        // 读文件 tail 拿最后 GPS 点作 lastPointAt
        let lastPointAt = latest.lastTs || latest.startedAt || Date.now();
        let distanceM = latest.distanceM || 0;
        let durationS = latest.durationS || 0;
        // O11 (2026-07-27): 若磁盘 jsonl 是空 (sim-walker session 没 write
        // 到 disk / 老 bug 导致 meta 存在但 points 丢), 弹 recovery modal 是
        // 无意义的 — 用户 Continue 后 trackPoints=[], 看到空 hike. 跳过.
        let hasPointsOnDisk = false;
        try {
          if (typeof hikeTrackWriter.readActiveHikeTail === 'function') {
            const tail = await hikeTrackWriter.readActiveHikeTail(latest.sessionId, 1);
            if (Array.isArray(tail) && tail.length > 0) {
              lastPointAt = tail[tail.length - 1].t || lastPointAt;
              hasPointsOnDisk = true;
            }
          }
          const start = latest.startedAt || (lastPointAt - 40 * 60_000);
          durationS = Math.max(1, Math.floor((lastPointAt - start) / 1000));
        } catch { /* silent */ }
        if (!hasPointsOnDisk) {
          // 磁盘空 → 静默 discard 这个 meta+jsonl 避免下次再弹。
          try {
            const { discardActiveHike } = require('../services/hikeTrackWriter');
            if (typeof discardActiveHike === 'function') {
              await discardActiveHike(latest.sessionId);
            }
          } catch { /* silent */ }
          try {
            const cl = require('../services/crashLogger');
            (cl.crashLogger ?? cl.default)?.breadcrumb?.(`recovery:skipped_empty sid=${latest.sessionId.slice(0, 8)}`);
          } catch { /* silent */ }
          return; // 不 setUnfinished
        }
        setUnfinished({
          sessionId: latest.sessionId,
          remoteId: latest.remoteId ?? null,
          // v412 4-eye fix (Critical #2): 用真实 activityMode, 不硬编码 'hiking'
          // hikeTrackWriter.startHikeTrack 存 meta.activity_mode, norm() 里已带过来.
          // 兜底 'hiking' 只在字段缺失 (v411 前老数据) 时启用.
          activityMode: (latest.activityMode === 'running' ? 'running' : 'hiking'),
          startedAt: latest.startedAt || lastPointAt,
          distanceM,
          durationS,
          lastPointAt,
        });
      } catch { /* silent — v412 UI 恢复不影响主流程 */ }
    })();
    return () => { cancelled = true; };
  }, [hydrationTs, isTrackingOrPaused]);

  useEffect(() => { loadRoutes(); }, []);

  // Pre-fetch a one-shot GPS fix on enter so the route picker can show
  // accurate distance-from-start labels and apply the "too far" filter
  // even before tracking starts. Without this, lastCoordinate is null
  // until startTracking, which is why the > 25km dim/disable logic was
  // visibly inactive on V8.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const perm = await Location.getForegroundPermissionsAsync();
        if (!perm.granted) {
          const req = await Location.requestForegroundPermissionsAsync();
          if (!req.granted) return;
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
  }, []);

  // Sync phase with tracking status: if a hike is in progress (e.g. user
  // navigated away with the hike still running), show tracking UI; otherwise
  // show the route picker.
  useEffect(() => {
    if (status === 'tracking' && phase !== 'tracking') {
      setPhase('tracking');
    } else if (status === 'idle' && phase === 'tracking') {
      // Session ended (stopTracking); revert to selection screen for next hike.
      setPhase('select');
    }
  }, [status, phase]);

  // v118: too-short modal replaced the v116 system Alert. The session is
  // now preserved by stopTracking's pre-check (see useTrackingStore), so
  // tapping "Got it" leaves the user back on the still-running tracking
  // view with all stats intact. Tapping "End anyway" calls
  // discardCurrentSession() which does the full teardown.

  // Spring press scales
  const trackBtnScale = useRef(new Animated.Value(1)).current;
  const fabScale = useRef(new Animated.Value(1)).current;
  const springIn = (val: Animated.Value) =>
    Animated.spring(val, { toValue: 0.95, useNativeDriver: true, tension: 300, friction: 10 }).start();
  const springOut = (val: Animated.Value) =>
    Animated.spring(val, { toValue: 1, useNativeDriver: true, tension: 300, friction: 8 }).start();

  // Keep screen awake while on this screen (activity in progress)
  useKeepAwake();

  const selectedMarker = markers.find(m => m.id === selectedMarkerId) ?? null;

  function handleDeleteMarker() {
    if (selectedMarkerId) {
      deleteMarker(selectedMarkerId);
    }
    setSelectedMarkerId(null);
    setUi('map');
  }

  const distDisplay = formatDistance(distanceM, 'km', 1);
  const durationDisplay = formatDuration(durationS);

  // v79 #1 fix: Signal-lost detection. Bumped 30s → 120s to match the
  // tightened polyline gap threshold. At 30s the pill triggered for
  // every red light / dynamic-sampling stationary tick, which was
  // noise. 120s is "haven't seen GPS in 2+ minutes" — actually
  // actionable info.
  const SIGNAL_GAP_MS = 120_000;
  const lastTrackT = trackPoints.length > 0 ? trackPoints[trackPoints.length - 1].t : null;
  const signalLostFor = (lastTrackT != null) ? (Date.now() - lastTrackT) : 0;
  const signalLost = lastTrackT != null && signalLostFor > SIGNAL_GAP_MS;
  const signalLostMin = Math.floor(signalLostFor / 60_000);

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

  const selectedRouteName = routes.find(r => r.id === selectedRoute)?.name ?? 'Free Hiking';

  // v412: 两个 return 分支 (phase='select' early return + Phase 2 主 return) 都需要挂
  // UnfinishedRecoveryModal, 抽成一个 node 避免复制粘贴导致 onContinue/onDiscard 逻辑分叉。
  const recoveryModalNode = (
    <UnfinishedRecoveryModal
      visible={unfinished !== null && !isTrackingOrPaused}
      data={unfinished}
      onContinue={async () => {
        const u = unfinished;
        if (!u) return;
        try {
          // 先停 background location task 避免 iOS jetsam 复活后 task 已跑 → 重复
          // v412 blocker 3 修 (subagent 视角B): 用真实 task name 'cairn-background-location', 不硬编码字符串
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const Location = require('expo-location');
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const { BACKGROUND_LOCATION_TASK } = require('../services/backgroundLocationTask');
          if (Location && typeof Location.stopLocationUpdatesAsync === 'function') {
            await Location.stopLocationUpdatesAsync(BACKGROUND_LOCATION_TASK).catch(() => {});
          }
        } catch { /* silent */ }
        try {
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const hikeTrackWriter = require('../services/hikeTrackWriter');
          if (typeof hikeTrackWriter.readActiveHikeTail === 'function') {
            const hikePts: any[] = await hikeTrackWriter.readActiveHikeTail(u.sessionId, Infinity);
            // O1 R3: HikePoint 磁盘格式 {t, lat, lng, acc, alt, src, conf}
            // 与 TrackPoint {lat, lng, alt, accuracy, speed, t} 字段错位
            // (acc → accuracy)。之前直接 setState 用 hikePts 导致 accuracy 字段
            // 丢失,route_points_raw 全 null。加 mapper 修正 + 恢复 lastCoordinate
            // 避免 gate 3 stationary suppress 用 Infinity 分支不抑制。
            const pts = hikePts.map((p: any) => ({
              lat: p.lat,
              lng: p.lng,
              alt: p.alt ?? null,
              accuracy: p.acc ?? null,
              speed: null,
              t: p.t,
            }));
            const last = pts[pts.length - 1];
            // 恢复到 tracking store
            // v412 4-eye fix (Critical #2): 用 u.activityMode 不硬编码, 保 running 语义
            useTrackingStore.setState({
              sessionId: u.sessionId,
              remoteSessionId: u.remoteId ?? null,
              trackPoints: pts,
              trackPointsSmoothed: pts,
              trackPointsRaw: pts,
              startedAt: u.startedAt,
              status: 'paused', // v412 4-eye fix (Blocker #1): 先设 paused, 让 resumeTracking 走 activate*Source
              distanceM: u.distanceM,
              durationS: u.durationS,
              activityMode: u.activityMode,
              // O1 R3: 同步 seed lastCoordinate 到 tail 最后一点,不然
              // resume 后的第一次 addTrackPoint 走 gate 3 的 Infinity 分支,
              // stationary suppress 失效,jitter 全收进 track 虚增 distanceM
              lastCoordinate: last
                ? { lat: last.lat, lng: last.lng, alt: last.alt, accuracy: last.accuracy, speed: last.speed }
                : null,
              lastCoordinateTime: last?.t ?? null,
            } as any);
            if (typeof hikeTrackWriter.resumeHikeTrack === 'function') {
              await hikeTrackWriter.resumeHikeTrack(u.sessionId);
            }
          }
          // v412 4-eye fix (Blocker #1): activate*Source 是模块级私有函数, 从 store 外调不到.
          // 改用 store 里真实存在的 resumeTracking action, 它内部会按 AppState 调 activate*Source.
          const trackingStore = useTrackingStore.getState() as any;
          if (typeof trackingStore.resumeTracking === 'function') {
            await trackingStore.resumeTracking();
          }
        } catch (_recoverErr) {
          // v412 4-eye fix (Medium): 恢复失败必须留 breadcrumb, 之前 silent 让 blocker#1 静默死了
          try {
            const cl = require('../services/crashLogger');
            (cl.crashLogger ?? cl.default)?.breadcrumb?.(`v412:recovery_continue_failed ${String(_recoverErr).slice(0, 80)}`);
          } catch { /* silent */ }
          // 恢复失败: 简化处理 = 走 discard, 用户可以重新开
          try {
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const hikeTrackWriter = require('../services/hikeTrackWriter');
            await hikeTrackWriter.discardActiveHike(u.sessionId);
          } catch { /* silent */ }
        }
        setUnfinished(null);
      }}
      onDiscard={async () => {
        const u = unfinished;
        if (!u) return;
        try {
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const hikeTrackWriter = require('../services/hikeTrackWriter');
          await hikeTrackWriter.discardActiveHike(u.sessionId);
        } catch { /* silent */ }
        // v430 fix: also DELETE server-side row so it never appears as a
        // too-short/ghost activity. Previous discard only removed local
        // disk files, leaving the row created by POST /sessions/start
        // orphaned on aliyun (finalized_at NULL, dist=0, dur=0).
        if (u.remoteId) {
          try {
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const { deleteRemoteSession } = require('../services/sessionService');
            await deleteRemoteSession(u.remoteId);
          } catch (err) {
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const cl = require('../services/crashLogger');
            (cl.crashLogger ?? cl.default)?.breadcrumb?.(`v430:discard_remote_delete_failed ${String(err).slice(0, 80)}`);
          }
        }
        setUnfinished(null);
      }}
    />
  );

  // ── Phase 1: Route Selection ─────────────────────────────────────────────
  if (phase === 'select') {
    return (
      <>
      <View style={styles.container}>
        <HikingMap markers={[]} trackPoints={[]} onMarkerPress={() => {}} />

        {/* Top overlay — uses safe-area inset directly so the chips
            never sit under the Dynamic Island / status bar regardless
            of the device. SafeAreaView inside an absolute parent
            doesn't reliably report insets, so we add them ourselves. */}
        <View style={[styles.topOverlay, { paddingTop: insets.top + 8 }]} pointerEvents="box-none">
          <View style={styles.topRow}>
            <BackButton variant="pill" onPress={() => nav.goBack()} />
            <View style={[styles.gpsChip, styles.gpsChipAmber]}>
              <View style={[styles.gpsDot, { backgroundColor: Colors.severityWarning }]} />
              <Text style={[styles.gpsText, styles.gpsTextAmber]}>Enable GPS</Text>
            </View>
          </View>
        </View>

        {/* Bottom: route selector pill + start button */}
        <View style={[styles.bottomOverlay, { paddingBottom: insets.bottom + 8 }]} pointerEvents="box-none">
          <View style={styles.bottomPanel}>
            {/* Route selector pill — single row, card style */}
            <TouchableOpacity style={styles.routePill} onPress={openRoutePicker} activeOpacity={0.85}>
              <View style={styles.routePillIcon}>
                <Icon name={selectedRoute ? 'Route' : 'Target'} size={20} color={Colors.primary} strokeWidth={1.8} />
              </View>
              <View style={styles.routePillTextGroup}>
                <Text style={styles.routePillText} numberOfLines={1}>{selectedRouteName}</Text>
                <Text style={styles.routePillHint}>Tap to change route</Text>
              </View>
              <Icon name="ChevronUp" size={16} color={Colors.primary} strokeWidth={2.5} />
            </TouchableOpacity>

            {/* Start button — full-width before tracking begins. The
                Place Flag FAB only makes sense once a session is live
                (you can't drop a flag at "your current GPS" if the
                session hasn't started recording yet). */}
            <Animated.View style={[{ height: 56 }, { transform: [{ scale: trackBtnScale }] }]}>
              <TouchableOpacity
                style={styles.trackBtn}
                onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); startTracking(); setPhase('tracking'); }}
                activeOpacity={1}
                onPressIn={() => springIn(trackBtnScale)}
                onPressOut={() => springOut(trackBtnScale)}
              >
                <Icon name="Play" size={IconSize.sm} color={Colors.primary} strokeWidth={2.5} />
                <Text style={styles.trackBtnText}>Start Hiking</Text>
              </TouchableOpacity>
            </Animated.View>
          </View>
        </View>

        {/* Route picker sheet — non-fullscreen, slides up from bottom */}
        {showRoutePicker && (
          <Animated.View style={[styles.routePickerBackdrop, { opacity: routePickerOpacity }]}>
            <TouchableOpacity style={StyleSheet.absoluteFillObject} onPress={closeRoutePicker} activeOpacity={1} />
            <Animated.View style={[styles.routePickerSheet, { transform: [{ translateY: routePickerSlide }] }]}>
              <View style={styles.routePickerHandle} />
              <Text style={styles.routePickerTitle}>Choose a route</Text>
              <ScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: 280 }} contentContainerStyle={{ gap: Spacing.sm }}>
                {/* Free Hiking */}
                <TouchableOpacity
                  style={[styles.routePickerRow, selectedRoute === null && styles.routePickerRowSelected]}
                  onPress={() => pickRoute(null)}
                  activeOpacity={0.8}
                >
                  <View style={[styles.routePickerBadge, { backgroundColor: Colors.primaryLight }]}>
                    <Icon name="Target" size={16} color={Colors.primary} strokeWidth={2} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.routePickerName}>Free Hiking</Text>
                    <Text style={styles.routePickerMeta}>No route · explore freely</Text>
                  </View>
                  {selectedRoute === null && <Icon name="Check" size={16} color={Colors.primary} strokeWidth={2.5} />}
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
                      : distFromUser < 1000
                        ? `· ${Math.round(distFromUser)}m away`
                        : `· ${(distFromUser / 1000).toFixed(1)}km away`;
                  return (
                    <TouchableOpacity
                      key={r.id}
                      style={[
                        styles.routePickerRow,
                        selectedRoute === r.id && styles.routePickerRowSelected,
                        tooFar && { opacity: 0.45 },
                      ]}
                      onPress={tooFar ? undefined : () => pickRoute(r.id)}
                      disabled={tooFar}
                      activeOpacity={0.8}
                    >
                      <View style={[styles.routePickerBadge, { backgroundColor: Colors.primaryLight }]}>
                        <Icon name="Route" size={16} color={Colors.primary} strokeWidth={2} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.routePickerName}>{r.name}</Text>
                        <Text style={styles.routePickerMeta}>
                          {(r.distanceM / 1000).toFixed(1)} km
                          {r.elevationGainM > 0 ? ` · ↑${Math.round(r.elevationGainM)}m` : ''}
                          {r.runCount > 0 ? ` · ${r.runCount}× done` : ''}
                          {distLabel ? ` ${distLabel}` : ''}
                          {tooFar ? ' · too far' : ''}
                        </Text>
                      </View>
                      {selectedRoute === r.id && <Icon name="Check" size={16} color={Colors.primary} strokeWidth={2.5} />}
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            </Animated.View>
          </Animated.View>
        )}
        {/* v412 4-eye fix (Critical #3): recoveryModalNode 已提到最外层 Fragment, 见函数结尾. */}
      </View>
      {recoveryModalNode}
      </>
    );
  }

  // ── Phase 2: Tracking ────────────────────────────────────────────────────

  // Get selected route points for polyline display
  const activeRoute = selectedRoute ? routes.find(r => r.id === selectedRoute) : null;
  const routePolyline = activeRoute?.points ?? [];

  return (
    <>
    <View style={styles.container}>
      <HikingMap
        markers={markers}
        trackPoints={(trackPointsSmoothed.length >= 2 ? trackPointsSmoothed : trackPoints).map(tp => ({ lat: tp.lat, lng: tp.lng, t: tp.t, segmentBreak: (tp as any).segmentBreak }))}
        onMarkerPress={(id) => { setSelectedMarkerId(id); setUi('detail'); }}
        routeStart={routePolyline.length > 0
          ? { lat: routePolyline[0].lat, lng: routePolyline[0].lng }
          : null}
        userPos={lastCoordinate ? { lat: lastCoordinate.lat, lng: lastCoordinate.lng } : null}
        debugMode={debugMode}
        // Skip the globe → location fly-in whenever we already know
        // where the user is. This covers all the cases where the user
        // expects the map to "just be there":
        //   - Resume tracking (isTracking + trackPoints already exist)
        //   - Re-entering Hiking from Home Last-row after a recent
        //     hike (lastCoordinate seeded by GPS prime effect)
        //   - Returning from another screen mid-hike
        // Only first-launch with no GPS fix yet gets the fly-in.
        instantCamera={lastCoordinate != null}
        // v118: pass through followUser + gesture release callback.
        followUser={followUser}
        onUserGesture={() => setFollowUser(false)}
        recenterImperativeRef={recenterImperativeRef}
      />

      {/* Top overlay: back button (left) + GPS chip (right). Uses
          inset-aware paddingTop so chips never touch the Dynamic
          Island. */}
      <View style={[styles.topOverlay, { paddingTop: insets.top + 8 }]} pointerEvents="box-none">
        <View style={styles.topRow}>
          <BackButton variant="pill" onPress={() => nav.goBack()} />
          <View style={[
            styles.gpsChip,
            status === 'idle' ? styles.gpsChipAmber : (!locationAvailable && styles.gpsChipOffline),
          ]}>
            <PulseDot
              size={8}
              color={locationAvailable
                ? Colors.success
                : status === 'idle' ? Colors.severityCaution : Colors.danger}
              pulsing={locationAvailable}
            />
            <Text style={[
              styles.gpsText,
              status === 'idle' ? styles.gpsTextAmber : (!locationAvailable && styles.gpsTextOffline),
            ]}>
              {locationAvailable
                ? 'GPS'
                : status === 'idle' ? 'Enable GPS' : 'GPS Offline'}
            </Text>
          </View>
        </View>

        {/* v78 #1: Signal-lost pill — appears above the stats bar when
            the latest accepted GPS fix is older than 30s. Hidden during
            normal operation. */}
        {isTracking && signalLost && (
          <View style={styles.signalLostPill}>
            <View style={styles.signalLostDot} />
            <Text style={styles.signalLostText}>
              {signalLostMin >= 1 ? `Signal lost · ${signalLostMin} min` : 'Signal lost'}
            </Text>
          </View>
        )}

        {/* Tracking stats bar */}
        {isTrackingOrPaused && (
          <View style={styles.trackingBar}>
            <View style={styles.trackingStat}>
              <Text style={styles.trackingValueLg}>{distDisplay}</Text>
              <Text style={styles.trackingUnit}>km</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.trackingStat}>
              <Text style={styles.trackingValue}>{durationDisplay}</Text>
              <Text style={styles.trackingUnit}>elapsed</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.trackingStat}>
              <Text style={styles.trackingValue}>+{elevationGainM}m</Text>
              <Text style={styles.trackingUnit}>elev</Text>
            </View>
            {isExpert && (
              <>
                <View style={styles.statDivider} />
                <View style={styles.trackingStat}>
                  <Text style={styles.trackingValue}>--</Text>
                  <Text style={styles.trackingUnit}>brg</Text>
                </View>
              </>
            )}
            {selectedRoute && (
              <PressBtn
                style={styles.routeSwitchBtn}
                onPress={() => Alert.alert('Route', activeRoute?.name ?? 'Free Hiking', [
                  { text: 'Switch to Free', onPress: () => setSelectedRoute(null) },
                  { text: 'Cancel', style: 'cancel' },
                ])}
                scaleTo={0.9}
              >
                <Icon name="Route" size={12} color={Colors.primary} strokeWidth={2.5} />
              </PressBtn>
            )}
            <PressBtn
              style={styles.stopBtn}
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                // v120: tapping Stop = pause everything immediately.
                // Timer freezes, GPS stops accumulating distance. The
                // summary sheet opens; user picks Resume (un-pause) or
                // Save & End (real stop). Time/GPS during the sheet is
                // intentionally lost — treated as signal-loss gap.
                const ts = useTrackingStore.getState();
                if (!ts.startedAt) {
                  // Fallback: malformed state, just stop.
                  stopTracking();
                  return;
                }
                pauseTracking();
                setStopSummary({
                  distanceM: ts.distanceM,
                  durationS: ts.durationS,
                  elevationGainM: ts.elevationGainM,
                  activityMode: ts.activityMode,
                  trackPoints: ts.trackPoints.map(p => ({ lat: p.lat, lng: p.lng })),
                  startedAt: ts.startedAt,
                });
              }}
              scaleTo={0.95}
            >
              <Icon name="Square" size={12} color="#fff" strokeWidth={3} />
              <Text style={styles.stopBtnText}>Stop</Text>
            </PressBtn>
          </View>
        )}
      </View>

      {/* Bottom controls. Two-column layout when tracking:
          [Compass]  [Place Flag]
          When pre-tracking, only the route picker + Start button are
          visible (no compass, no flag). */}
      <View style={[styles.bottomOverlay, { paddingBottom: insets.bottom + 8 }]} pointerEvents="box-none">
        {!isTracking ? (
          // Pre-tracking: full-width Start button.
          <View style={styles.bottomRow}>
            <Animated.View style={[{ flex: 1, height: 60 }, { transform: [{ scale: trackBtnScale }] }]}>
              <TouchableOpacity
                style={styles.trackBtn}
                onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); startTracking(); }}
                activeOpacity={1}
                onPressIn={() => springIn(trackBtnScale)}
                onPressOut={() => springOut(trackBtnScale)}
              >
                <Icon name="Play" size={IconSize.sm} color={Colors.primary} strokeWidth={2.5} />
                <Text style={styles.trackBtnText}>Start Hiking</Text>
              </TouchableOpacity>
            </Animated.View>
          </View>
        ) : (
          // Tracking: two evenly-spaced controls — Compass (left) +
          // Place Flag (right). Both 56x56 frosted-glass circles. The
          // compass tap recentres the camera bearing to north; flag
          // opens the plant sheet.
          <View style={styles.controlRow}>
            <View style={styles.controlSlot}>
              <TouchableOpacity
                style={styles.circleBtn}
                activeOpacity={0.85}
                onPress={() => {
                  Haptics.selectionAsync().catch(() => {});
                  setCompassEnabled(v => !v);
                }}
              >
                {compassEnabled ? (
                  // Live compass needle — north stays red, south grey,
                  // and a static "N" letter on the bezel anchors the
                  // user's mental direction even when the needle is
                  // moving.
                  <CompassNeedle heading={heading} size={22} />
                ) : (
                  // "Closed lid" state — sensor off, but the icon
                  // still uses the primary colour so users can tell
                  // it's an interactive compass button (not a broken
                  // greyed-out element). Tap to open the lid.
                  <Icon name="Compass" size={22} color={Colors.primary} strokeWidth={2} />
                )}
              </TouchableOpacity>
            </View>
            {/* v118+v119: recenter button — only shown after the user has
                manually panned/zoomed (followUser=false). Tapping fires
                the imperative recenter (HikingMap → cameraRef.setCamera)
                AND flips followUser back to true so subsequent GPS fixes
                keep the camera locked. */}
            {!followUser && (
              <View style={styles.controlSlot}>
                <TouchableOpacity
                  style={styles.circleBtn}
                  activeOpacity={0.85}
                  onPress={() => {
                    Haptics.selectionAsync().catch(() => {});
                    recenterImperativeRef.current?.();
                    // Re-enable follow after the flyTo animation has
                    // settled — otherwise the in-flight gesture from
                    // setCamera trips onCameraChanged and immediately
                    // sets followUser=false again.
                    setTimeout(() => setFollowUser(true), 700);
                  }}
                >
                  <Icon name="Target" size={22} color={Colors.primary} strokeWidth={2} />
                </TouchableOpacity>
              </View>
            )}
            <View style={styles.controlSlot}>
              <Animated.View style={{ transform: [{ scale: fabScale }] }}>
                <TouchableOpacity
                  style={styles.circleBtnPrimary}
                  onPress={() => nav.navigate('Plant')}
                  activeOpacity={1}
                  onPressIn={() => springIn(fabScale)}
                  onPressOut={() => springOut(fabScale)}
                >
                  <Icon name="Flag" size={22} color="#fff" strokeWidth={2} />
                </TouchableOpacity>
              </Animated.View>
            </View>
          </View>
        )}
      </View>

      {/* Marker Detail Sheet */}
      {ui === 'detail' && selectedMarker && (
        <MarkerDetailSheet
          marker={selectedMarker}
          onClose={() => { setSelectedMarkerId(null); setUi('map'); }}
          onDelete={handleDeleteMarker}
          lastCoordinate={lastCoordinate}
          onUpdateMemo={(uri, durationMs) => {
            // v80 #45: persist voiceMemoUri locally on the marker.
            // Backend has columns ready (migration 010) but cloud upload is
            // deferred to a future iteration. Local store update is enough
            // for in-app playback to work.
            useMarkerStore.getState().updateMarker(selectedMarker.id, {
              voiceMemoUri: uri,
              voiceMemoDurationMs: durationMs,
            });
          }}
          flagTypes={FLAG_TYPES}
        />
      )}

      {/* Stop summary sheet — shown after user taps Stop, before
          the session is actually written to the store. Lets the user
          name the activity (or skip and accept the default Type+Date
          name). Cancelling here keeps tracking running. */}
      {stopSummary && (
        <StopSummarySheet
          summary={stopSummary}
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
            // O1 batch 28.4: Discard 走完整清理路径 (与 recoveryModal.onDiscard
            // 一致): 清 disk active/*.jsonl + 删 remote session + 清 store。
            // 不清 memory_points — sim-walker/hike 走路时不实时写 memory
            // (v450/O4 行为),memory 只在 Save Hike 时由 flushHikingToMemory
            // 一次合入。Discard 不需要清 memory 因为根本没 unlock 过。
            const preState = useTrackingStore.getState();
            const capturedSessionId = preState.sessionId;
            const capturedRemoteId = preState.remoteSessionId;
            try {
              // eslint-disable-next-line @typescript-eslint/no-require-imports
              const hikeTrackWriter = require('../services/hikeTrackWriter');
              if (capturedSessionId) {
                await hikeTrackWriter.discardActiveHike(capturedSessionId);
              }
            } catch { /* silent */ }
            if (capturedRemoteId) {
              try {
                // eslint-disable-next-line @typescript-eslint/no-require-imports
                const { deleteRemoteSession } = require('../services/sessionService');
                await deleteRemoteSession(capturedRemoteId);
              } catch (err) {
                // eslint-disable-next-line @typescript-eslint/no-require-imports
                const cl = require('../services/crashLogger');
                (cl.crashLogger ?? cl.default)?.breadcrumb?.(`o1:stop_discard_remote_failed ${String(err).slice(0, 80)}`);
              }
            }
            discardCurrentSession();
            setStopSummary(null);
          }}
          onConfirm={async (name) => {
            // v405: Snapshot sessionId + trackPoints BEFORE stopTracking
            // clears the store. Needed for auto-nav to MapHistory below,
            // and for "too-short" defensive check (skip nav if session
            // was discarded).
            const preState = useTrackingStore.getState();
            const capturedSessionId = preState.sessionId;
            const wasTooShort = preState.trackPoints.length < 2 || preState.distanceM < 20;

            // v407 fix #5: wrap the whole stopTracking → nav chain in try/catch
            // + 5s wall-clock timeout. Prior version: 弱网下 pushMemoryNow +
            // finalize 各挂 30s → sheet 卡 60 秒,onConfirm 抛错 UI 不 unmount。
            // 现在: 最多 5 秒 sheet 关闭,数据本地写入(addSession 已 sync),
            // 网络重推交给 memorySync 自然的 backoff+schedulePush 重试。
            // O7 (2026-07-26): 5s → 30s。用户 12:11 真实 hike Save 后 session
            // 消失,aliyun log 显示 too_short_check 后 zero save events。5s
            // wall-clock 比 stopTracking 内部的 snapTrack(8s) + saveHikeAtomic
            // (20s) 都短 → 5s 后 HikingScreen 认为失败,nav 到 activity detail,
            // 但 stopTracking 内部继续跑; 内部若在某个 await 抛错 (未 catch),
            // addSession 永远不跑 → session 永远丢。改 30s 让 stopTracking 内
            // 部预算充足,避免 UI 提前放弃。UI 期间 sheet 保持 open 用户看到
            // 保存中状态。若 30s 内还完成不了,用户可再手动继续。
            const STOP_WALL_TIMEOUT_MS = 30000;
            let stopFailed = false;
            try {
              await Promise.race([
                stopTracking(name),
                new Promise<void>((_, reject) => setTimeout(() => reject(new Error('stopTracking_timeout_30s')), STOP_WALL_TIMEOUT_MS)),
              ]);
            } catch (err) {
              stopFailed = true;
              // stopTracking 内部本地写入(addSession)已完成,只是 server sync
              // 挂了。memorySync 有自己的 backoff 重推循环。用户可见:
              // sheet 关闭+回 activity detail,细节由 memorySync 后台完成。
              // eslint-disable-next-line no-console
              console.warn('[v407] stopTracking wall-timeout / error:', String(err));
              // NB: stopTracking 内部的 promise 依然在后台跑(未 abort),
              // finalize + pushMemoryNow 该重试就重试。
            }
            setStopSummary(null);

            // v405 fix (Happy Path bug #7,#8): 自动跳 Activity Detail,
            // back stack 补 Routes(activities) 让 back 直接回列表页。
            // - 太短 session: 不 nav (TooShortSheet 会展示)
            // - 正常保存: nav.reset 到 [Home, Routes(activities), MapHistory{sessionId}]
            //
            // v407 fix #3: dispatch 前 snapshot isLoggedIn。若 stopTracking
            // 期间 401_invalid 触发 auto-logout → RootNavigator 只剩 Auth
            // 一个 stack → reset 到 Home/Routes/MapHistory 会 throw。
            // 未登录时依赖 auto-logout 已把用户送 Auth,不做 nav。
            const stillLoggedIn = useAppStore.getState().isLoggedIn;
            if (!wasTooShort && capturedSessionId && stillLoggedIn) {
              try {
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
              } catch (navErr) {
                // eslint-disable-next-line no-console
                console.warn('[v407] nav.reset failed:', String(navErr));
              }
            }
            // else: 依赖 status === idle observer 回 selection 屏 +
            // TooShortSheet 提示 (line 1826 useEffect)
          }}
          // O1: removed onSaveAsRoute prop — hike is activity not template
        />
      )}

      {/* v118: too-short modal — renders when stopTracking detected the
          session has < 2 GPS points. Got it = continue tracking (state
          was preserved). End anyway = full discard via store action. */}
      <TooShortSheet
        visible={lastStopReason === 'too-short'}
        activityMode={activityMode}
        onContinue={() => clearLastStopReason()}
        onDiscard={() => { clearLastStopReason(); discardCurrentSession(); }}
      />
      {/* v412: 未完成 hike 恢复弹窗 — 挂在 Fragment 顶层, 见下方 */}
    </View>
    {recoveryModalNode}
    {/* v428: sim-walker overlay. v430 removed __DEV__ gate so users
        can activate sim-walker in production builds via Settings
        (debugMode 5-tap → simWalkerActive toggle). Actual gate at
        line ~1174: debugMode && simWalkerActive.
        v429 hotfix: lazy-require inside gate so gpsInjector side-effects
        don't run at HikingScreen mount time on production builds. */}
    {showSimWalker && (() => {
      try {
        const { SimWalkerOverlay } = require('../dev/simWalker/SimWalkerOverlay');
        return <SimWalkerOverlay />;
      } catch (e: any) {
        // eslint-disable-next-line no-console
        console.warn('[sim-walker] failed to load:', e?.message);
        return null;
      }
    })()}
    </>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: { flex: 1 },

  // Route selection (phase 1)
  bottomPanel: { paddingHorizontal: Spacing.base, paddingBottom: Spacing.sm, gap: Spacing.sm },
  routePill: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    backgroundColor: 'rgba(255,255,255,0.97)', borderRadius: Radius.card,
    padding: Spacing.md,
    borderWidth: 1.5, borderColor: Colors.primary + '40',
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.10, shadowRadius: 14, elevation: 5,
  },
  routePillIcon: {
    width: 44, height: 44, borderRadius: 12,
    backgroundColor: Colors.primaryLight, alignItems: 'center', justifyContent: 'center',
  },
  routePillTextGroup: { flex: 1, gap: 1 },
  routePillText: { fontSize: FontSize.body, fontWeight: '600', color: Colors.textPrimary },
  routePillHint: { fontSize: FontSize.small, color: Colors.primary, fontWeight: '500' },

  // Route picker sheet
  routePickerBackdrop: {
    ...StyleSheet.absoluteFillObject,
    // Dim backdrop so the route picker reads as a modal layer instead
    // of a floating panel. Matches the rest of the app's bottom-sheet
    // language (MarkerDetailSheet, StopSummarySheet, etc).
    backgroundColor: 'rgba(0,0,0,0.35)',
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
  routePickerRowSelected: { borderLeftColor: Colors.primary, backgroundColor: Colors.primaryBg, borderColor: Colors.primaryMuted },
  routePickerBadge: {
    width: 44, height: 44, borderRadius: 12,
    backgroundColor: Colors.primaryLight,
    alignItems: 'center', justifyContent: 'center',
  },
  routePickerName: { fontSize: FontSize.body, fontWeight: '600', color: Colors.textPrimary },
  routePickerMeta: { fontSize: FontSize.small, color: Colors.textSecondary, marginTop: 2 },

  // Top overlay
  topOverlay: { position: 'absolute', top: 0, left: 0, right: 0, pointerEvents: 'box-none' },
  topRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    // paddingTop is supplied by the topOverlay container inline
    // (insets.top + 8). Don't double-pad here, otherwise Back/GPS
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
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.65)',
    marginHorizontal: Spacing.base, marginTop: Spacing.sm,
    borderRadius: Radius.card, padding: Spacing.md,
    gap: Spacing.sm,
    shadowColor: '#000', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.1, shadowRadius: 24, elevation: 6,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.4)',
    borderLeftWidth: 3, borderLeftColor: Colors.primary,
  },
  trackingStat: { alignItems: 'center', flex: 1 },
  // v78 #1: Signal-lost pill — amber chip above the stats bar.
  // Self-aligned start, only visible when GPS hasn't fixed in 30s+.
  signalLostPill: {
    flexDirection: 'row', alignItems: 'center',
    alignSelf: 'flex-start',
    marginHorizontal: Spacing.base, marginTop: Spacing.sm,
    paddingHorizontal: Spacing.md, paddingVertical: 6,
    backgroundColor: Colors.severityWarningBg,
    borderRadius: 999,
    borderWidth: 1, borderColor: Colors.severityWarning,
    gap: 6,
  },
  signalLostDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: Colors.severityWarning },
  signalLostText: { fontSize: 11, fontWeight: '700', color: Colors.severityWarning, letterSpacing: 0.2 },
  // Tracking stats panel — values intentionally compact (14pt) so the
  // panel doesn't dominate the map view. The numbers are reference
  // information; users glance at them, they don't read them like a
  // dashboard. Unit row stays small for the same reason.
  trackingValueLg: { fontSize: 14, fontWeight: '700', color: Colors.textPrimary, fontVariant: ['tabular-nums'], lineHeight: 18 },
  trackingValue: { fontSize: 14, fontWeight: '700', color: Colors.textPrimary, fontVariant: ['tabular-nums'], lineHeight: 18 },
  trackingUnit: { fontSize: 9, color: Colors.textSecondary, marginTop: 1, fontWeight: '500', letterSpacing: 0.2 },
  statDivider: { width: 1, height: 28, backgroundColor: Colors.border },
  routeSwitchBtn: {
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: Colors.primaryLight, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: Colors.primary,
  },
  stopBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: Colors.danger, borderRadius: Radius.button,
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.xs,
  },
  stopBtnText: { color: '#fff', fontWeight: '700', fontSize: FontSize.small },

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
  // Two control buttons share one consistent shape — 56x56 circles
  // with a frosted-glass effect (translucent white + soft border +
  // diffuse shadow) so they read as floating UI on top of the map
  // rather than solid buttons. Same dimensions for both so the layout
  // is perfectly balanced left/right.
  circleBtn: {
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: 'rgba(255,255,255,0.65)',
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.6)',
    shadowColor: '#000', shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.18, shadowRadius: 16, elevation: 6,
  },
  circleBtnPrimary: {
    width: 56, height: 56, borderRadius: 28,
    // Translucent green to match the compass button's frosted-glass
    // language. Was solid hex (#5d7c46) which read as a "stop sign"
    // glued to the map. Now: same alpha as compass (0.78), with a
    // subtle white inner border so the icon contrast still pops over
    // varied terrain.
    backgroundColor: 'rgba(93,124,70,0.78)',
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.4)',
    shadowColor: Colors.primary, shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.20, shadowRadius: 16, elevation: 8,
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