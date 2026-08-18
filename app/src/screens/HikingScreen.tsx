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
  Alert, Animated, Easing, Image,
} from 'react-native';
import { haptic } from '../services/hapticService';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Location from 'expo-location';
import { useKeepAwake } from 'expo-keep-awake';
import { useNavigation, CommonActions, useIsFocused } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/RootNavigator';
import { useAppStore } from '../store/useAppStore';
import { useTrackingStore } from '../store/useTrackingStore';
import { useMarkerStore } from '../store/useMarkerStore';
import { useRouteStore } from '../store/useRouteStore';
import { getCurrentRegion } from '../config/regions';
import { formatDuration, haversineM } from '../utils/geo';
import { useDistance } from '../utils/distanceFormat';
import { Colors, Spacing, Radius, FontSize, Shadow, IconSize } from '../components/tokens';
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
import { CompassNeedle } from './CompassNeedle';
import { BackButton } from '../components/BackButton';
import { PulseDot } from '../components/PulseDot';
import { PressBtn } from '../components/PressBtn';
import { HikingMap } from './HikingMap';
import { TooShortSheet } from '../components/TooShortSheet';
import { useAppearance } from '../hooks/useAppearance';
import { PermissionDeniedModal } from '../components/PermissionDeniedModal';
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
  const isFocused = useIsFocused();
  // O12: uiMode/isExpert removed — was dead double-switch (only 'brg' placeholder used it)
  const insets = useSafeAreaInsets();
  // R21 (2026-08-17 user "确保hike界面根据系统主题色 切换 白天和黑夜"):
  // read Appearance. When isDark, gpsChip/actions/stats surface swap to
  // deep slate. Mapbox styleURL also switches via HikingMap → dark-v11.
  const { isDark: hikeIsDark } = useAppearance();
  const hikeChipBg = hikeIsDark ? 'rgba(15,22,38,0.72)' : 'rgba(255,255,255,0.65)';
  const hikeChipBorder = hikeIsDark ? 'rgba(220,230,240,0.15)' : 'rgba(255,255,255,0.4)';
  const hikeChipText = hikeIsDark ? '#E5EAF0' : Colors.textPrimary;

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
  // O14 Bug 4: keep the sheet mounted with a "Saving…" spinner during
  // stopTracking's async flush+rename chain. Pre-fix, the sheet dismissed
  // immediately on tap-Save and the user saw the Hiking screen with the
  // Start-Hiking button visible while tracking was still finalising
  // (up to 30s) — very confusing.
  const [savingHike, setSavingHike] = useState(false);
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

  // H2 concept: middle-of-screen tap during tracking expands a bottom
  // action tray with 3 large circular buttons — Pause / Cairn / Done.
  // 2026-08-16 UI overhaul: this is now the SOLE entry point for
  // pause/stop actions (legacy inline trackingBar controls removed).
  // Lock state was dropped in the same overhaul — the tray collapses
  // to a chevron by default, which already prevents pocket-taps.
  const [actionsExpanded, setActionsExpanded] = useState(false);
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
    // O14 Bug 5 fix: wait 800ms before scanning disk. When the user
    // just tapped Save, stopTracking's flush → rename chain may still
    // be finalising active/{sid}.jsonl → completed. Racing straight
    // into listActiveHikes would see the not-yet-renamed file and
    // surface the just-Saved hike as "unfinished". 800ms is enough
    // to cover 99% of finalise wall-times and is invisible to a user
    // who arrived here by manual nav (not from Save).
    const delayTimer = setTimeout(() => { runDetect(); }, 800);
    const runDetect = async () => {
      if (cancelled) return;
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
                    // O16 A1 fix: cross-check the local session store BEFORE
                    // surfacing an "unfinished hike" modal for the remote row.
                    //
                    // Root cause of user's report ("sim-walker save hike
                    // 成功也弹 unfinished"): sim-walker never writes to disk
                    // via appendHikePoint (__simwalkerAddTrackPoint only
                    // mutates the store), so listActiveHikes returns []
                    // → we fall into this remote branch. If the just-Saved
                    // hike is `saved_pending` (server 5xx / wall timeout /
                    // syncDaemon not drained yet), server row still has
                    // finalized_at=NULL, distance_m=0, duration_s=0 →
                    // /sessions/unfinished returns it → we prompt recovery
                    // for a hike the user already Saved.
                    //
                    // Fix: look up useSessionStore.sessions by remoteId.
                    // If found (ANY syncState: pending / synced / etc.),
                    // the user already committed this locally — don't
                    // pop the modal. Poke drainPending so the server
                    // catches up.
                    try {
                      // eslint-disable-next-line @typescript-eslint/no-require-imports
                      const { useSessionStore } = require('../store/useSessionStore');
                      const localSessions = useSessionStore.getState().sessions;
                      const remoteStartedAt = Date.parse(s.start_time);
                      // O16 A1 + B1: broaden the match. Server may return
                      // this row when saveHikeAtomic partially failed
                      // (remoteId=null on local) OR before syncDaemon
                      // caught up. Match by:
                      //   (a) remoteId (fast path when save succeeded),
                      //   (b) startedAt within a ±60s window (offline
                      //       sim-walker save where remoteId is still
                      //       null but the user clearly clicked Save).
                      const localMatch = localSessions.find((ss: any) => {
                        if (ss.remoteId != null && ss.remoteId === s.id) return true;
                        if (Number.isFinite(remoteStartedAt) && Number.isFinite(ss.startedAt)) {
                          if (Math.abs(ss.startedAt - remoteStartedAt) < 60_000) return true;
                        }
                        return false;
                      });
                      if (localMatch) {
                        try {
                          // eslint-disable-next-line @typescript-eslint/no-require-imports
                          const cl = require('../services/crashLogger');
                          (cl.crashLogger ?? cl.default)?.breadcrumb?.(
                            `o16:unfinished_skip_local_match sid=${s.id} match_by=${localMatch.remoteId === s.id ? 'remoteId' : 'startedAt'}`,
                          );
                        } catch { /* swallow */ }
                        // Nudge sync so the server row gets updated.
                        try {
                          // eslint-disable-next-line @typescript-eslint/no-require-imports
                          const { drainPending } = require('../services/syncDaemon');
                          void drainPending().catch(() => {});
                        } catch { /* swallow */ }
                        return;
                      }
                    } catch { /* swallow — if useSessionStore unavailable, fall through */ }
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
        // O16 C3: local-session cross-check ALSO on the disk-based
        // branch. Mixed sim-walker + real GPS sessions can leave an
        // active JSONL that was renamed (unlikely) OR a stale one from
        // a prior background TaskManager write. If the same startedAt
        // (or remoteId) already exists in useSessionStore, the user
        // clearly Saved this hike; don't re-surface it as unfinished.
        try {
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const { useSessionStore } = require('../store/useSessionStore');
          const localSessions = useSessionStore.getState().sessions;
          const latchedStarted = latest.startedAt || lastPointAt;
          const localMatch = localSessions.find((ss: any) => {
            if (latest.remoteId != null && ss.remoteId === latest.remoteId) return true;
            if (Number.isFinite(latchedStarted) && Number.isFinite(ss.startedAt)) {
              if (Math.abs(ss.startedAt - latchedStarted) < 60_000) return true;
            }
            return false;
          });
          if (localMatch) {
            try {
              const cl = require('../services/crashLogger');
              (cl.crashLogger ?? cl.default)?.breadcrumb?.(
                `o16:unfinished_skip_local_disk sid=${latest.sessionId.slice(0, 8)}`,
              );
            } catch { /* silent */ }
            // Also clean the orphan disk file so it doesn't keep triggering.
            try {
              const { discardActiveHike } = require('../services/hikeTrackWriter');
              if (typeof discardActiveHike === 'function') {
                await discardActiveHike(latest.sessionId);
              }
            } catch { /* silent */ }
            return;
          }
        } catch { /* swallow — fall through and surface modal */ }
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
    };
    return () => { cancelled = true; clearTimeout(delayTimer); };
  }, [hydrationTs, isTrackingOrPaused]);

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
      "We couldn't save this hike",
      "Your device may be low on storage. Your hike is still recorded in the app. Tap Retry to try saving again, or Discard to remove it.",
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
        "We couldn't save this hike",
        "Your device may be low on storage. Your hike is still recorded in the app. Tap Retry to try saving again, or Discard to remove it.",
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
        // O14 Bug 3/6 fix: skip GPS prime when sim-walker is active.
        // Pre-fix, entering Hiking screen while joystick is on would
        // fetch a real GPS fix (usually the user's home) and clobber
        // gpsInjector.currentPos in lastCoordinate — the next Start
        // Hike then seeded from home, drew a long line to the joystick,
        // and the "continues from where I stopped" complaint appeared.
        try {
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const { useSimWalkerStore } = require('../dev/simWalker/useSimWalkerStore');
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const { useSettingsStore: uss } = require('../store/useSettingsStore');
          if (uss.getState().debugMode && useSimWalkerStore.getState().active) {
            return;
          }
        } catch { /* swallow — sim-walker not loaded, proceed with real GPS prime */ }
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

  // R21 (2026-08-17 user "进入前 3 秒展开, 之后自动收起"): when the tracking
  // phase first mounts, open the action tray so the user sees what buttons
  // exist (Pause / Cairn / Done). Auto-collapse after 3 seconds so it doesn't
  // hog map real-estate. Runs only on the phase transition into tracking, not
  // every render.
  useEffect(() => {
    if (phase !== 'tracking') return;
    setActionsExpanded(true);
    const t = setTimeout(() => setActionsExpanded(false), 3000);
    return () => clearTimeout(t);
  }, [phase]);

  // v118: too-short modal replaced the v116 system Alert. The session is
  // now preserved by stopTracking's pre-check (see useTrackingStore), so
  // tapping "Got it" leaves the user back on the still-running tracking
  // view with all stats intact. Tapping "End anyway" calls
  // discardCurrentSession() which does the full teardown.

  // Spring press scales
  const trackBtnScale = useRef(new Animated.Value(1)).current;
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

  // 2026-08-16 (H4 redesign): unified save-then-navigate helper. Both
  // sheet CTAs ("View Activity" and "Done") save via stopTracking; only
  // the post-save destination differs. Extracted from the two former
  // inline callbacks to avoid duplicating the wall-clock timeout + nav
  // guard logic (v405/v407 fixes) in two places.
  async function saveHikeAndNav(name: string, dest: 'activity' | 'home') {
    // O14 Bug 4 fix: flip saving state BEFORE dismissing the sheet so
    // the sheet shows "Saving…" spinner + disabled buttons while
    // stopTracking runs its flush+rename chain (up to 15s wall).
    setSavingHike(true);
    // v405: Snapshot sessionId + trackPoints BEFORE stopTracking clears
    // the store. Needed for auto-nav below and for "too-short" defensive
    // check (skip nav if session was discarded).
    const preState = useTrackingStore.getState();
    const capturedSessionId = preState.sessionId;
    const wasTooShort = preState.trackPoints.length < 2 || preState.distanceM < 20;

    // v407 fix #5 / O7 (2026-07-26): 30s wall-clock around stopTracking.
    // Under weak network, pushMemoryNow + finalize can each stall 30s;
    // the wall lets the UI unstick while the store's own memorySync
    // backoff loop continues in the background.
    const STOP_WALL_TIMEOUT_MS = 30000;
    try {
      await Promise.race([
        stopTracking(name),
        new Promise<void>((_, reject) => setTimeout(() => reject(new Error('stopTracking_timeout_30s')), STOP_WALL_TIMEOUT_MS)),
      ]);
    } catch (err) {
      // stopTracking's local addSession is synchronous — data is safe on
      // disk. Server sync retries via memorySync backoff.
      // eslint-disable-next-line no-console
      console.warn('[v407] stopTracking wall-timeout / error:', String(err));
    }
    // O14 Bug 4: clear saving state + dismiss sheet in one go once
    // stopTracking has finished (or wall-timed out).
    setSavingHike(false);
    setStopSummary(null);

    // v407 fix #3: snapshot isLoggedIn before nav — auto-logout during
    // stopTracking would leave only Auth in the stack and reset would
    // throw.
    const stillLoggedIn = useAppStore.getState().isLoggedIn;
    if (wasTooShort || !stillLoggedIn) {
      // Too-short: TooShortSheet will render via lastStopReason observer.
      // Not-logged-in: auto-logout handler owns the redirect to Auth.
      return;
    }

    try {
      if (dest === 'activity' && capturedSessionId) {
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
      } else {
        // Secondary "Done" — save is complete, just go Home. Clean stack.
        nav.dispatch(
          CommonActions.reset({
            index: 0,
            routes: [{ name: 'Home' }],
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
  const lapToastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [lapToast, setLapToast] = useState<string | null>(null);
  useEffect(() => {
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
  }, [distanceM, isTracking, lapStepM, dist.imperial]);
  const distDisplay = dist.format(distanceM, 1);
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

  const selectedRouteName = routes.find(r => r.id === selectedRoute)?.name ?? 'Free Hike';

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
  }, [isFocused]);

  // ── Phase 1: Route Selection ─────────────────────────────────────────────
  if (phase === 'select') {
    return (
      <>
      <View style={[styles.container, { backgroundColor: hikeIsDark ? "#0F1620" : "#F4EFE6" }]}>
        <HikingMap markers={[]} trackPoints={[]} onMarkerPress={() => {}} />

        {/* Top overlay: concept-locked stats strip (4 items in one row).
            Values are live even before tracking starts (all zero) so the
            layout stays stable when the user taps Start. Back button is
            preserved as a floating chip anchored to the safe-area inset. */}
        <View style={[styles.topOverlay, { paddingTop: insets.top + Spacing.lg }]} pointerEvents="box-none">
          <View style={styles.topRow}>
            <BackButton variant="inline" onPress={() => nav.goBack()} />
          </View>
          <View style={[styles.statsStrip, hikeIsDark ? { backgroundColor: "rgba(15,22,38,0.60)", borderColor: "rgba(220,230,240,0.14)" } : null]} pointerEvents="none">
            <Text style={[styles.statsStripKm, hikeIsDark ? { color: hikeChipText } : null]}>{distDisplay} {dist.unit}</Text>
            <Text style={[styles.statsStripTime, hikeIsDark ? { color: hikeChipText } : null]}>{durationDisplay}</Text>
            <Text style={[styles.statsStripElev, hikeIsDark ? { color: hikeChipText } : null]}>{`\u2191 ${dist.formatElevation(elevationGainM)}${dist.elevUnit}`}</Text>
            <View style={styles.statsStripGpsWrap}>
              <View style={[styles.statsStripGpsDot, { backgroundColor: hasLocationPermission === false ? Colors.severityWarning : Colors.primary }]} />
              <Text style={[styles.statsStripGpsText, hikeIsDark ? { color: hikeChipText } : null]}>GPS</Text>
            </View>
          </View>
        </View>

        {/* R114/O22 STORY-73009 (H3): inline permission banner removed.
            2026-08-17 R21: chip at top-right already signals GPS state.
            Matches Running R0 which relies on chip alone. */}

        {/* Bottom: FREE HIKE pill card + Route row + solid green Start button.
            Concept-locked from H0-start.png. Card + row background is
            Paper 94% opacity so the map still peeks through. */}
        <View style={[styles.bottomOverlay, { paddingBottom: insets.bottom + Spacing.base }]} pointerEvents="box-none">
          <View style={styles.bottomPanel}>
            {/* FREE HIKE pill card — 2026-08-17 concept H0: adds a
                small fern-leaf glyph on the left. The leaf reinforces
                the "Explore freely" story before the user commits to
                a saved route, and mirrors the fern used on the
                complete screen. */}
            <TouchableOpacity style={[styles.freeHikePill, hikeIsDark ? { backgroundColor: 'rgba(15,22,38,0.72)', borderColor: 'rgba(220,230,240,0.14)' } : null]} onPress={openRoutePicker} activeOpacity={0.9}>
              <Image
                source={require('../../assets/hiking/fern-leaf.png')}
                style={styles.freeHikeGlyph}
                resizeMode="contain"
              />
              <View style={{ flex: 1 }}>
                <Text style={[styles.freeHikeEyebrow, hikeIsDark ? { color: '#F0EEE6' } : null]}>
                  {selectedRoute ? 'ROUTE' : 'FREE HIKE'}
                </Text>
                <Text style={[styles.freeHikeSub, hikeIsDark ? { color: 'rgba(240,238,230,0.68)' } : null]} numberOfLines={1}>
                  {selectedRoute ? selectedRouteName : 'Explore freely'}
                </Text>
              </View>
              <Icon name="ChevronUp" size={18} color={hikeIsDark ? 'rgba(240,238,230,0.68)' : Colors.textSecondary} strokeWidth={2.5} />
            </TouchableOpacity>

            {/* Start Hiking — solid pill button. R21 (2026-08-18) dark: use
                deep-slate fill + cream text so it stops looking like a
                bright button pasted on a dark map. */}
            <Animated.View style={[{ height: 52 }, { transform: [{ scale: trackBtnScale }] }]}>
              <TouchableOpacity
                style={[styles.startHikeBtn, hikeIsDark ? { backgroundColor: 'rgba(15,22,38,0.85)', borderColor: 'rgba(220,230,240,0.24)', borderWidth: 1 } : null]}
                onPress={() => { haptic.impact('medium'); startTracking(); setPhase('tracking'); }}
                activeOpacity={1}
                onPressIn={() => springIn(trackBtnScale)}
                onPressOut={() => springOut(trackBtnScale)}
              >
                <Text style={[styles.startHikeBtnText, hikeIsDark ? { color: '#F0EEE6' } : null]}>Start Hiking</Text>
              </TouchableOpacity>
            </Animated.View>
          </View>
        </View>

        {/* Route picker sheet — non-fullscreen, slides up from bottom */}
        {showRoutePicker && (
          <Animated.View style={[styles.routePickerBackdrop, { opacity: routePickerOpacity }]}>
            <TouchableOpacity style={StyleSheet.absoluteFillObject} onPress={closeRoutePicker} activeOpacity={1} />
            <Animated.View style={[styles.routePickerSheet, hikeIsDark ? { backgroundColor: "rgba(15,22,38,0.96)", borderTopColor: "rgba(220,230,240,0.14)" } : null, { transform: [{ translateY: routePickerSlide }] }]}>
              <View style={[styles.routePickerHandle, hikeIsDark ? { backgroundColor: "rgba(220,230,240,0.30)" } : null]} />
              <Text style={[styles.routePickerTitle, hikeIsDark ? { color: "#F0EEE6" } : null]}>Choose a route</Text>
              <ScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: 280 }} contentContainerStyle={{ gap: Spacing.sm }}>
                {/* Free Hiking */}
                <TouchableOpacity
                  style={[styles.routePickerRow, hikeIsDark ? { backgroundColor: "rgba(240,238,230,0.08)", borderColor: "rgba(220,230,240,0.14)" } : null, selectedRoute === null && (hikeIsDark ? { backgroundColor: "rgba(240,238,230,0.20)", borderColor: "rgba(220,230,240,0.35)" } : styles.routePickerRowSelected)]}
                  onPress={() => pickRoute(null)}
                  activeOpacity={0.8}
                >
                  <View style={[styles.routePickerBadge, { backgroundColor: Colors.primaryLight }]}>
                    <Icon name="Target" size={16} color={Colors.primary} strokeWidth={2} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.routePickerName, hikeIsDark ? { color: "#F0EEE6" } : null]}>Free Hike</Text>
                    <Text style={[styles.routePickerMeta, hikeIsDark ? { color: "rgba(240,238,230,0.68)" } : null]}>No route · explore freely</Text>
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
                      : `· ${dist.formatShort(distFromUser)} away`;
                  return (
                    <TouchableOpacity
                      key={r.id}
                      style={[
                        styles.routePickerRow,
                        hikeIsDark ? { backgroundColor: 'rgba(240,238,230,0.08)', borderColor: 'rgba(220,230,240,0.14)' } : null,
                        selectedRoute === r.id && (hikeIsDark ? { backgroundColor: 'rgba(240,238,230,0.20)', borderColor: 'rgba(220,230,240,0.35)' } : styles.routePickerRowSelected),
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
                        <Text style={[styles.routePickerName, hikeIsDark ? { color: "#F0EEE6" } : null]}>{r.name}</Text>
                        <Text style={[styles.routePickerMeta, hikeIsDark ? { color: "rgba(240,238,230,0.68)" } : null]}>
                          {dist.format(r.distanceM, 1)} {dist.unit}
                          {r.elevationGainM > 0 ? ` · ↑${dist.formatElevation(r.elevationGainM)}${dist.elevUnit}` : ''}
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
    <View style={[styles.container, { backgroundColor: hikeIsDark ? "#0F1620" : "#F4EFE6" }]}>
      <HikingMap
        markers={markers}
        trackPoints={(trackPointsSmoothed.length >= 2 ? trackPointsSmoothed : trackPoints).map(tp => ({ lat: tp.lat, lng: tp.lng, t: tp.t, segmentBreak: (tp as any).segmentBreak }))}
        onMarkerPress={(id) => { setSelectedMarkerId(id); setUi('detail'); }}
        routeStart={routePolyline.length > 0
          ? { lat: routePolyline[0].lat, lng: routePolyline[0].lng }
          : null}
        userPos={lastCoordinate ? { lat: lastCoordinate.lat, lng: lastCoordinate.lng } : null}
        debugMode={debugMode}
        // 2026-08-17 concept H1: blue dot at track start once we
        // have at least one recorded GPS point. The blue variant
        // matches the hiking screen's palette in the concept sheet.
        trackStartVariant={isTrackingOrPaused ? 'hike' : null}
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

      {/* Top overlay: back + GPS chip + concept stats strip. Concept H1/H2
          places 4 stats (km / time / elev / GPS) as a single row on the
          Paper surface just below the safe-area top. Existing stats bar
          (tracking) is kept below so pause/stop buttons still have their
          host row, but its visual weight is reduced. */}
      <View style={[styles.topOverlay, { paddingTop: insets.top + Spacing.lg }]} pointerEvents="box-none">
        <View style={styles.topRow}>
          <BackButton variant="inline" onPress={() => nav.goBack()} />
          {/* R21 v6 (2026-08-18 user "GPS因为下面已经有了 新的一行 不需要上面的"):
              top GPS chip removed — the stats card's GPS dot is the
              canonical status affordance. Keeping only Back at the top. */}
          {/* R21 (2026-08-18 user "signal lost 放右上角 也就是和back一行的右边"):
              signal-lost pill moved into the top-row so it never overlaps
              with the stats card. Kept invisible during normal operation. */}
          <View style={{ flex: 1 }} />
          {isTracking && signalLost && (
            <View style={styles.signalLostPill}>
              <View style={styles.signalLostDot} />
              <Text style={styles.signalLostText}>
                {signalLostMin >= 1 ? `Signal lost · ${signalLostMin} min` : 'Signal lost'}
              </Text>
            </View>
          )}
        </View>

        {/* Concept stats strip — always visible while on Hiking. */}
        <View style={[styles.statsStrip, hikeIsDark ? { backgroundColor: "rgba(15,22,38,0.60)", borderColor: "rgba(220,230,240,0.14)" } : null]} pointerEvents="none">
          <Text style={[styles.statsStripKm, hikeIsDark ? { color: hikeChipText } : null]}>{distDisplay} {dist.unit}</Text>
          <Text style={[styles.statsStripTime, hikeIsDark ? { color: hikeChipText } : null]}>{durationDisplay}</Text>
          <Text style={[styles.statsStripElev, hikeIsDark ? { color: hikeChipText } : null]}>{`\u2191 ${dist.formatElevation(elevationGainM)}${dist.elevUnit}`}</Text>
          <View style={styles.statsStripGpsWrap}>
            <View style={[styles.statsStripGpsDot, { backgroundColor: locationAvailable ? Colors.primary : Colors.severityWarning }]} />
            <Text style={[styles.statsStripGpsText, hikeIsDark ? { color: hikeChipText } : null]}>GPS</Text>
          </View>
        </View>

        {/* R114/O22 STORY-73012 (K2): overspeed banner. Second row below
            the top chips (per user spec: "顶部第二行 banner, numberOfLines=1").
            Shown when active hike detects sustained speed > 15 km/h — user
            is likely in a vehicle. The offending points are already dropped
            from the clean track by the store's OVERSPEED gate; this banner
            makes the drop visible. Auto-clears when a real hiking-speed
            fix arrives. */}
        {isTracking && overSpeedActive && (
          <View style={styles.overSpeedBanner}>
            <Icon name="AlertTriangle" size={12} color={Colors.severityWarning} strokeWidth={2.5} />
            <Text style={styles.overSpeedBannerText} numberOfLines={1}>
              Moving too fast for a hike — pausing recording
            </Text>
          </View>
        )}

        {/* v78 #1: Signal-lost pill was moved to top-row (2026-08-18 R21).
            It now lives in the same row as the Back button, right-aligned. */}
        {/* O18 HIKE-07: transient lap toast — appears for 2s each time
            the user crosses a 1 km / 1 mi boundary during tracking. */}
        {isTracking && lapToast && (
          <View style={styles.lapToast}>
            <Icon name="Milestone" size={12} color="#fff" strokeWidth={2.5} />
            <Text style={styles.lapToastText}>{lapToast}</Text>
          </View>
        )}
        {/* O18 HIKE-02: GPS accuracy chip — visible while tracking whenever
            accuracy is worse than 15m so users know the fix quality without
            waiting for signal-loss threshold. */}
        {isTracking && !signalLost && lastCoordinate?.accuracy != null && lastCoordinate.accuracy > 15 && (
          <View style={styles.accuracyPill}>
            <Icon name="Navigation" size={11} color={Colors.textSecondary} strokeWidth={2.2} />
            <Text style={styles.accuracyText}>
              GPS ±{Math.round(lastCoordinate.accuracy)}m
            </Text>
          </View>
        )}

        {/* 2026-08-16 UI overhaul: legacy trackingBar removed. Its
            distance/time/elev readouts duplicated the top statsStrip,
            and its inline Pause/Resume/Stop buttons are now surfaced
            via the H2 chevron tray (Pause / Cairn / Done). Route-switch
            control moved into H2 flow as well (accessible via long-press
            or dedicated tray future entry — for now, route switching
            happens pre-Start via the picker). */}
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
                onPress={() => { haptic.impact('medium'); startTracking(); }}
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
          // R21 (2026-08-18 user "把指南针去掉"): compass FAB removed.
          // Only Recenter remains, and only when the user has drifted off
          // the follow position — otherwise the bottom row is empty so
          // the map breathes. Actions (Pause/Cairn/Finish) moved to a
          // vertical tray anchored to the right edge (see below).
          !followUser ? (
            <View style={styles.controlRow}>
              <View style={{ flex: 1 }} />
              <View style={styles.controlSlot}>
                <TouchableOpacity
                  style={[styles.fabPale, hikeIsDark ? { backgroundColor: 'rgba(15,22,38,0.85)', borderColor: 'rgba(220,230,240,0.24)' } : null]}
                  activeOpacity={0.85}
                  accessibilityRole="button"
                  accessibilityLabel="Recenter map on current location"
                  onPress={() => {
                    haptic.selection();
                    recenterImperativeRef.current?.();
                    setTimeout(() => setFollowUser(true), 700);
                  }}
                >
                  <Icon name="Target" size={20} color={hikeIsDark ? '#F0EEE6' : Colors.primary} strokeWidth={2} />
                </TouchableOpacity>
              </View>
            </View>
          ) : null
        )}
      </View>

      {/* H2 concept: expandable action tray during tracking.
          Chevron handle sits just above the bottom FAB row; tapping it
          expands 3 large circular buttons — Pause / Cairn / Done.
          This is now the SOLE entry point for pause/stop (2026-08-16 UI
          overhaul removed the legacy inline trackingBar controls).
          Renders while tracking or paused (not gated by lock — Lock
          state was removed as part of the same overhaul). */}
      {/* R21 (2026-08-18 user "在左下角 原指南针位置 向右侧横向弹出
          即 箭头> Pause Cairn Finish"): anchor sits at bottom-left where
          the old compass FAB was, tap → row expands to the right:
          [Nav ▶] [Pause] [Cairn] [Finish]. Recenter (bottom-right) is
          handled separately and only appears when the user has drifted. */}
      {isTrackingOrPaused && (
        <View
          style={[styles.trayAnchorLayer, { paddingBottom: insets.bottom + 8 }]}
          pointerEvents="box-none"
        >
          <View style={styles.trayAnchorRow} pointerEvents="auto">
            <TouchableOpacity
              style={[styles.trayAnchor, hikeIsDark ? { backgroundColor: 'rgba(15,22,38,0.85)', borderColor: 'rgba(220,230,240,0.24)' } : null]}
              activeOpacity={0.85}
              accessibilityRole="button"
              accessibilityLabel={actionsExpanded ? 'Hide quick actions' : 'Show quick actions'}
              onPress={() => {
                haptic.selection();
                setActionsExpanded(v => !v);
              }}
            >
              <Icon
                name={actionsExpanded ? 'ChevronLeft' : 'Navigation'}
                size={22}
                color={hikeIsDark ? '#F0EEE6' : Colors.primary}
                strokeWidth={2.2}
              />
            </TouchableOpacity>
            {actionsExpanded && (
              <View style={styles.trayRow}>
                <View style={styles.trayItem}>
                  <TouchableOpacity
                    style={[styles.trayFab, hikeIsDark ? { backgroundColor: 'rgba(15,22,38,0.72)', borderColor: 'rgba(220,230,240,0.20)' } : null]}
                    activeOpacity={0.85}
                    accessibilityRole="button"
                    accessibilityLabel={status === 'paused' ? 'Resume hike' : 'Pause hike'}
                    onPress={() => {
                      haptic.impact('light');
                      if (status === 'paused') resumeTracking();
                      else pauseTracking();
                      setActionsExpanded(false);
                    }}
                  >
                    <Icon
                      name={status === 'paused' ? 'Play' : 'Pause'}
                      size={22}
                      color={hikeIsDark ? '#F0EEE6' : Colors.primary}
                      strokeWidth={2.2}
                    />
                  </TouchableOpacity>
                  <Text style={[styles.trayFabLabel, hikeIsDark ? { color: '#F0EEE6' } : null]}>
                    {status === 'paused' ? 'Resume' : 'Pause'}
                  </Text>
                </View>
                <View style={styles.trayItem}>
                  <TouchableOpacity
                    style={[styles.trayFab, hikeIsDark ? { backgroundColor: 'rgba(15,22,38,0.72)', borderColor: 'rgba(220,230,240,0.20)' } : null]}
                    activeOpacity={0.85}
                    accessibilityRole="button"
                    accessibilityLabel="Leave a Cairn"
                    onPress={() => {
                      haptic.selection();
                      setActionsExpanded(false);
                      nav.navigate('Plant');
                    }}
                  >
                    <Image
                      source={hikeIsDark
                        ? require('../../assets/home/action-leave-cairn-night.png')
                        : require('../../assets/home/action-leave-cairn-day.png')}
                      style={{ width: 28, height: 28 }}
                      resizeMode="contain"
                    />
                  </TouchableOpacity>
                  <Text style={[styles.trayFabLabel, hikeIsDark ? { color: '#F0EEE6' } : null]}>Cairn</Text>
                </View>
                <View style={styles.trayItem}>
                  <TouchableOpacity
                    style={[styles.trayFab, hikeIsDark ? { backgroundColor: 'rgba(15,22,38,0.72)', borderColor: 'rgba(220,230,240,0.20)' } : null]}
                    activeOpacity={0.85}
                    accessibilityRole="button"
                    accessibilityLabel="Finish hike"
                    onPress={() => {
                      haptic.impact('medium');
                      const ts = useTrackingStore.getState();
                      setActionsExpanded(false);
                      if (!ts.startedAt) {
                        stopTracking();
                        return;
                      }
                      // R21 (2026-08-18 user "没任何移动直接点finish 应该 too short"):
                      // pre-check distance before opening StopSummarySheet.
                      // If < 20m or fewer than 2 points, route straight to
                      // stopTracking so TooShortSheet observes the reason
                      // via lastStopReason — same path save-hike-atomic
                      // uses (matches wasTooShort at line 843).
                      const isTooShort = ts.trackPoints.length < 2 || ts.distanceM < 20;
                      if (isTooShort) {
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
                  >
                    <Icon name="Flag" size={22} color={hikeIsDark ? '#F0EEE6' : Colors.primary} strokeWidth={2.2} />
                  </TouchableOpacity>
                  <Text style={[styles.trayFabLabel, hikeIsDark ? { color: '#F0EEE6' } : null]}>Finish</Text>
                </View>
              </View>
            )}
          </View>
        </View>
      )}

      {/* 2026-08-16 UI overhaul: H2 lock overlay removed.
          Rationale: Lock added a UI gate that solved a pocket-tap edge
          case but confused first-time users (no visible affordance to
          unlock, 800ms long-press was undiscoverable). The new H2 tray
          is collapsed by default (chevron only), which already prevents
          accidental Pause/Cairn/Done taps during a hike. */}

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
            // 2026-08-16 (H4 redesign): primary "View Activity" CTA —
            // save then nav.reset into MapHistory detail (existing v405
            // behavior).
            await saveHikeAndNav(name, 'activity');
          }}
          onConfirmAndHome={async (name) => {
            // 2026-08-16 (H4 redesign): secondary "Done" CTA — save,
            // then land on Home instead of MapHistory. Same save path
            // as onConfirm; only the post-save nav differs.
            await saveHikeAndNav(name, 'home');
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
      {/* O18 ONB-04: permission-denied modal — shown when GPS was rejected
          during the initial hiking prime. Replaces prior silent return. */}
      <PermissionDeniedModal
        visible={permissionDeniedVisible && isFocused}
        featureName="Hiking"
        onDismiss={() => setPermissionDeniedVisible(false)}
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
    alignItems: 'center',
    gap: Spacing.md,
    paddingLeft: Spacing.base,
  },
  trayRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  trayItem: {
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
    width: 52, height: 52, borderRadius: 26,
    backgroundColor: CONCEPT.paper94,
    borderWidth: 1, borderColor: CONCEPT.hairline,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12, shadowRadius: 10, elevation: 4,
  },
  trayFabLabel: {
    marginTop: 2,
    fontSize: 11,
    color: Colors.textSecondary,
    fontWeight: '600',
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
    shadowColor: '#000', shadowOffset: { width: 0, height: -4 }, shadowOpacity: 0.12, shadowRadius: 20, elevation: 12,
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
