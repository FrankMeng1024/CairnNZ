/**
 * ARScene — Augmented Reality marker viewing/placing scene.
 *
 * Uses device camera + GPS to render 3D markers at real-world positions.
 * GPS coordinates → relative position (bearing + distance from user).
 *
 * Architecture:
 * - AR framework: @viro-community/react-viro (if available) or expo-camera fallback
 * - GPS anchoring: converts lat/lng to XYZ offset relative to user position
 * - Mode exclusion: when AR active, map rendering is paused (battery saving)
 *
 * Sprint 51 — STORY-00173 (E-003: AR插旗)
 */
import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert, Platform, Animated, Dimensions, PanResponder, ActivityIndicator, Pressable, Modal, Image, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import * as Haptics from 'expo-haptics';
import { Colors, Spacing, FontSize, Radius } from '../components/tokens';
import { Icon } from '../components/Icon';
import { PressBtn } from '../components/PressBtn';
import { BackButton } from '../components/BackButton';
// v186: Viro / r3f / Ritual / debug-pillar paths fully removed. Unity is
// the only AR path. The previous USE_VIRO / USE_UNITY_AR / RITUAL_ENABLED
// feature flags + dead branch components (ViroAROverlay, ViroARRitualOverlay,
// AR3DCairnOverlay) and @reactvision/react-viro package are gone. If you
// need historical context for why a particular pattern is here, see the
// pre-v186 commit history (HEAD~2 and earlier).
import { UnityAROverlay, type UnityAROverlayHandle } from '../components/UnityAROverlay';
// v0.2.4 Phase 3 — debugLogger session 必须在 ARScreen mount 时启动,
// 否则 unityCairnSpawn.ts 里 v22-PHASE3-TIER-DECISION 等 breadcrumb 全部 silent drop
// (debugLogger.log 第 238 行 if !this.currentSessionId return)
// subagent B Critical #1 fix
import { debugLogger } from '../services/debugLogger';
// v0.2.4 Phase 3 Round 5 — ARScreen own session 必须 upload 才能进 aliyun telemetry
// (Round 4 review BLOCKER: 原 cleanup 只 endSession 不 upload,数据黑洞)
import { telemetryUploader } from '../services/telemetryUploader';
import { CairnEdgeArrows } from '../components/CairnEdgeArrows';
import { DistantMarkerArrow } from '../components/DistantMarkerArrow';
import { AcquireGuidance } from '../components/AcquireGuidance';
import { AimShutter } from '../components/AimShutter';
import { PlantSheet, AimReticle, type PlantType } from '../components/PlantSheet';
import { LikeReportSheet } from '../components/LikeReportSheet';
import { useAimedMarker } from '../hooks/useAimedMarker';
import Constants from 'expo-constants';
import * as Application from 'expo-application';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { ARDebugOverlay } from '../components/ARDebugOverlay';
import { OTA_VERSION } from '../components/OtaBadge';
import { GlassPanel, Elevation } from '../components/GlassPanel';
// v194 OTA: photo upload from Photos library (no native build needed —
// expo-image-picker + expo-file-system are already in package.json).
import * as ImagePicker from 'expo-image-picker';
// expo-file-system/legacy still ships readAsStringAsync in SDK 54; the
// new namespace removed it. Pin to /legacy to avoid breakage.
import * as FileSystem from 'expo-file-system/legacy';

import { useMarkerStore, type Marker } from '../store/useMarkerStore';
import { useTrackingStore } from '../store/useTrackingStore';
import { useArOriginStore } from '../store/useArOriginStore';
import { haversineM, type Coordinate } from '../utils/geo';
import { crashLogger } from '../services/crashLogger';
import { markerTypeToColor, markerTypeToShaderParams } from '../services/unityCairnSpawn';
import { initialTrackDebounceState, onTrackEvent, onDowngradeTimerFire } from '../services/trackStateDebounce';
import { decideGpsLock, isOriginStale, distanceMeters, ORIGIN_STALE_DISTANCE_M, GPS_MAX_ACC_M } from '../services/originPropagation';
import { API_BASE_URL } from '../config/api';
import { filterContent, type ContentLevel } from '../services/contentFilter';
import { checkMarkerSpacing } from '../utils/geo';

// ── Conditional camera import ────────────────────────────────────────────
// expo-camera is in package.json (added in v15 dep bump). Lazy-loaded
// so a build that lacks it (e.g. Expo Go) still renders the AR screen
// — it just falls back to the dark backdrop without a live camera
// feed. The placement / projection logic works identically in both
// modes; only the background changes.
let CameraView: any = null;
let useCameraPermissions: any = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const Mod = require('expo-camera');
  CameraView = Mod.CameraView;
  useCameraPermissions = Mod.useCameraPermissions;
} catch {
  // Camera module unavailable — fall through to backdrop-only AR.
}

// Screen dimensions (snapshotted at module load — fine for portrait
// AR; would need re-measure on rotation but Cairn is portrait-only).
const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');

// v69 cleanup: removed gpsToRelativeXYZ() and bearingTo() — both were
// magnetic-heading-based projections used by the now-deleted ARCairnOverlay
// and CompassDial components. ARKit (ViroAROverlay) handles all
// world-coordinate conversion natively via worldAlignment="GravityAndHeading"
// + onCameraTransformUpdate. CAMERA_FOV_DEG also removed (only ARCairnOverlay
// referenced it).

// ── AR Marker Type → 3D Config ──────────────────────────────────────────────

export interface AR3DConfig {
  color: string;
  glowColor: string;
  shape: 'cone' | 'box' | 'sphere' | 'cylinder';
  scale: number;
  label: string;
}

export function getAR3DConfig(type: string): AR3DConfig {
  switch (type) {
    case 'danger':
      return { color: '#c53d2e', glowColor: '#ff6b5a', shape: 'cone', scale: 1.2, label: 'Danger' };
    case 'scenic':
      return { color: '#2e6cc5', glowColor: '#6ba3ff', shape: 'sphere', scale: 1.0, label: 'Scenic' };
    case 'supply':
      return { color: '#2e8c3a', glowColor: '#5cd46a', shape: 'box', scale: 1.0, label: 'Supply' };
    case 'junction':
      return { color: '#b36b00', glowColor: '#ffa940', shape: 'cylinder', scale: 0.8, label: 'Junction' };
    default:
      return { color: '#8c7e72', glowColor: '#b5a99d', shape: 'sphere', scale: 0.8, label: 'Marker' };
  }
}

// ── AR Visibility Ranges ────────────────────────────────────────────────────

/** Maximum distance to render AR markers (meters).
 *  v64: raised from 500 to 5000m so a hike's worth of cairns are all
 *  reachable via edge arrows ("山顶看山腰" use case). The 3D sphere is
 *  invisible at long range anyway (sub-pixel size) so this only affects
 *  the off-screen arrow indicators, which still benefit from longer range. */
export const AR_MAX_RANGE_M = 5000;

// ── AR Permission Visibility ────────────────────────────────────────────────

export interface ARMarkerVisual {
  opacity: number;
  hasAvatarRing: boolean;
  hasDashedRing: boolean;
}

/** Visual distinction for personal/friend/community markers in AR */
export function getPermissionVisual(permission: string): ARMarkerVisual {
  switch (permission) {
    case 'personal':
      return { opacity: 1.0, hasAvatarRing: false, hasDashedRing: false };
    case 'group':
      return { opacity: 0.75, hasAvatarRing: true, hasDashedRing: false };
    case 'public':
      return { opacity: 0.6, hasAvatarRing: false, hasDashedRing: true };
    default:
      return { opacity: 1.0, hasAvatarRing: false, hasDashedRing: false };
  }
}

// ── AR Screen Component (Fallback — no ViroReact available) ─────────────────

export interface ARScreenProps {
  onClose?: () => void;
  onPlaceMarker?: (lat: number, lng: number) => void;
}

// Flag type config
// v94: 加 'cairn' (Sphere) test type — 在 AR 渲染为纯彩色玻璃球, 没内部 icon,
// 用来测试球壳本身的可见性 (排除 icon 干扰).
const FLAG_TYPES: { id: 'danger' | 'scenic' | 'supply' | 'junction' | 'cairn'; icon: string; label: string; color: string; bg: string }[] = [
  { id: 'danger',   icon: 'TriangleAlert', label: 'Danger',   color: '#c53d2e',  bg: '#fde8ea' },
  { id: 'scenic',   icon: 'Star',          label: 'Scenic',   color: '#3b82f6',  bg: '#e8f1fb' },
  { id: 'supply',   icon: 'Droplets',      label: 'Water',    color: '#22c55e',  bg: '#e8f8ef' },
  { id: 'junction', icon: 'Navigation2',   label: 'Junction', color: '#f59e0b',  bg: '#fef3e2' },
  { id: 'cairn',    icon: 'Mountain',      label: 'Sphere',   color: '#b5823d',  bg: '#f5e6d0' },
];

/**
 * AR Screen — compass-based directional view + Place Flag flow.
 *
 * GPS degradation logic:
 * - Has fresh GPS (< 30s) → normal placement
 * - Has stale GPS (> 30s) or lost signal → degraded placement with toast
 * - Never had GPS → blocked
 */

// v69 cleanup: removed the legacy 2D-projection ARCairnOverlay component
// + arOverlayStyles. This was the pre-USE_VIRO 2D-on-camera-feed renderer
// that projected each marker onto screen-space using
// `bearing - userHeading` (magnetic compass). Replaced by ViroAROverlay
// (true ARKit world tracking via worldAlignment="GravityAndHeading"),
// which is hardcoded as the only path (USE_VIRO=true). The legacy
// component was unreachable in production and its magnetic-heading math
// was incompatible with ARKit-rendered cairn positions, so it could only
// have been a confusing fallback at best. Edge-arrow indication for
// off-screen cairns is now in `CairnEdgeArrows.tsx`, computed from the
// ARKit camera transform — no magnetic heading involved.

// v69 cleanup: removed CompassDial component + dialStyles. The dial
// rendered an N/E/S/W ring rotated by `userHeading` (magnetic compass)
// with chevrons at each marker's GPS bearing. ARKit's true-north fusion
// drifted from expo-location's magnetic heading, so the dial pointed
// in a different direction than where ViroAROverlay actually rendered
// the cairn — confusing for the user. The dial render had been
// commented out earlier; this commit removes the source. Direction-to-
// cairn UX is now `CairnEdgeArrows.tsx` (off-screen indicator using
// ARKit camera transform — guaranteed to match the rendered position).

// (Removed: DragCairnPicker + dragStyles — replaced by PlantSheet in v22, never reactivated.)


export function ARScreenLegacy({ onClose, onPlaceMarker }: ARScreenProps) {
  const nav = useNavigation();
  const insets = useSafeAreaInsets();
  const markers = useMarkerStore(s => s.markers);
  const addMarker = useMarkerStore(s => s.addMarker);
  // v206 A2 — subscribe reactively to arOrigin so the prop passed into
  // UnityAROverlay updates when MMKV hydrate or setArOriginIfMissing
  // mutates the store. Old code did `useMarkerStore.getState().arOrigin`
  // inline at the JSX site (non-reactive read at component-render time);
  // ARScreen would re-render only when OTHER state changed, so the
  // arOrigin prop could stay null until something else triggered re-render.
  // See baseline Run A: 5/5 OnSetSessionOffset events all sent ox=0/oz=0
  // mode=live — persisted arOrigin was never used.
  const arOriginReactive = useMarkerStore(s => s.arOrigin);
  // v0.2.3 Stage 4 — subscribe to A4 FSM raw fields. Plant button gate is
  // derived inline (re-computed on every render incl. timer tick below).
  const a4State = useArOriginStore(s => s.state);
  const a1State = useArOriginStore(s => s.a1State);
  const lastA1TransitionAt = useArOriginStore(s => s.lastA1TransitionAt);
  // Tick every 200ms so the 500ms anti-thrash window naturally clears
  // even if no other state changes. Cheap; only mounted when AR open.
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick(t => (t + 1) % 1000), 200);
    return () => clearInterval(id);
  }, []);
  // v0.2.4 Phase 3 — ARScreen mount 时启动 debugLogger session,unmount 时 end + upload。
  // Round 5 修 (Round 4 review 双 BLOCKER):
  //   1. arOwnSessionRef 必须只在真启动 own session 时赋值(不能无条件抓 currentSessionId,
  //      否则会把 RouteEditor/tracking 的 foreign session 当成自己的,cleanup 时错杀)
  //   2. cleanup 必须 telemetryUploader.upload(endedId) 才能进 aliyun
  //      (镜像 RouteEditorScreen.tsx:267-271 模式)
  //   3. tracking-session-active guard:已有 session 不动,我们的 log 合并进去
  const arOwnSessionRef = useRef<string | null>(null);
  useState(() => {
    // 已有 tracking session(或 RouteEditor session)→ 不启动 own,foreign session 不归我们
    if (debugLogger.getCurrentSessionId()) {
      // 显式 set null 表明这不是 own session
      arOwnSessionRef.current = null;
      return null;
    }
    try {
      debugLogger.setEnabled(true);
      const ownId = debugLogger.startSession({ activity_mode: 'free' });
      // 同步把 own session id 记到 ref(只有这条路径才记,foreign 走上面 null 分支)
      arOwnSessionRef.current = ownId;
    } catch { /* swallow */ }
    return null;
  });
  useEffect(() => {
    return () => {
      // 只有 own session 才 endSession + upload(Round 4 BLOCKER fix)
      if (arOwnSessionRef.current && debugLogger.getCurrentSessionId() === arOwnSessionRef.current) {
        try {
          debugLogger.endSession().then((endedId) => {
            if (endedId) {
              telemetryUploader.upload(endedId).catch(() => {});
            }
          }).catch(() => {});
        } catch { /* swallow */ }
      }
    };
  }, []);
  // v0.2.4 A: arFrame.track 在 useMemo 里使用,但 arFrame state 声明在下面.
  // 用 ref 镜像让 a4PlantEnabled 能读到不出 TDZ 错.
  const trackRef = useRef<'tracking' | 'limited' | 'none'>('limited');
  const a4PlantEnabled = useMemo(() => {
    void tick; // referenced to keep effect-free re-eval each tick
    const arOriginLocked = a4State === 'PERSISTED' || a4State === 'GPS_LOCKED';
    if (!arOriginLocked) return false;
    if (a1State !== 'LOCKED') return false;
    if (Date.now() - lastA1TransitionAt < 500) return false;
    // v0.2.4 A 修 (Apple ARCamera.trackingState 推荐):
    //   ARSession 不在 Tracking 状态时 (晃动/暗光/relocalize) 禁 plant.
    //   tracking → 安全; limited/none → 用户可能 plant 出"坏 cairn"飞天/穿墙.
    if (trackRef.current !== 'tracking') return false;
    return true;
  }, [a4State, a1State, lastA1TransitionAt, tick]);
  // v0.2.3 Stage 6 (A9) — user-visible reason when Plant is disabled
  // for an A4/A1 reason. Tells the user what to wait for instead of
  // staring at a grey button.
  const a4DisabledReason = useMemo<string | null>(() => {
    if (a4State === 'COLD_INIT') return 'Setting up — give it a second…';
    // INVALIDATED_BY_DISTANCE removed 2026-06-11 (no longer reachable;
    // cairns are absolute world coords).
    if (a1State !== 'LOCKED') return 'Scanning the ground — point at the floor';
    return null;
  }, [a4State, a1State]);
  const lastCoord = useTrackingStore(s => s.lastCoordinate);
  const lastCoordTime = useTrackingStore(s => s.lastCoordinateTime);
  const trackPoints = useTrackingStore(s => s.trackPoints);
  const sessionId = useTrackingStore(s => s.sessionId);
  const linkMarker = useTrackingStore(s => s.linkMarker);

  const [degradedToast, setDegradedToast] = useState<string | null>(null);
  // Branch B v3-review-fix: plant rejection toast. Wired to global
  // __cairnPlantRejected which is called from UnityAROverlay's
  // SpawnRejected handler AND from the ARScreen plant flow when ground
  // hit-test fails (Branch B floor-only invariant).
  const [plantRejectedToast, setPlantRejectedToast] = useState<string | null>(null);
  const plantRejectedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Shared reticle scale for the v22 PlantSheet aim animation. Owned here
  // so both the reticle (visible at all times) and the sheet (drives the
  // squeeze) reference the same Animated.Value.
  const reticleScale = useRef(new Animated.Value(1)).current;
  // v24 diagnostic: AR overlay reports its internal state up so the
  // ARDebugOverlay can show GL-ready + cairn count on screen.
  const [arStatus, setArStatus] = useState<{ glReady: boolean; cairnCount: number }>({ glReady: false, cairnCount: 0 });
  // Phase 2 Unity wire-up: ref to UnityAROverlay so we can imperatively push
  // OnSpawnStrand to Unity right after a successful plant. Going through
  // props would add a render frame of latency between haptic and visual.
  const unityOverlayRef = useRef<UnityAROverlayHandle | null>(null);

  // v195.1: OTA params panel removed — tuning is done by the dev based on
  // uploaded screenshots, not by the user. The 🐞-menu and FX trigger that
  // previously opened OTAControlPanel are gone. Snapshot pill state below.
  // Snapshot UI state machine:
  //   idle  - normal bug emoji
  //   busy  - spinner while takeScreenshot + base64 + telemetry flush
  //   done  - green check for 4s, then auto-revert to idle
  //   err   - red X with error code for 4s, then auto-revert
  const [snapState, setSnapState] = useState<'idle' | 'busy' | 'done' | 'err'>('idle');
  const [snapMsg, setSnapMsg] = useState<string>('');
  // v195.1: photos picked from library awaiting user confirmation. Picker
  // returns → we stage the assets here and show a confirm sheet (thumbnails
  // + "Upload N" / "Cancel"). Upload only begins on explicit confirm.
  const [pendingPhotos, setPendingPhotos] = useState<
    Array<{ uri: string; width: number; height: number }>
  >([]);
  // v78 #3: AR init UX. Tracks one of:
  //   'init'       — first 8 seconds (v196.1, was 4s), glReady === false.
  //                  Now a lightweight pill, NOT a full-screen overlay.
  //   'ready'      — glReady === true AND device held upright. Hide overlay.
  //   'low-light'  — 4s elapsed and still !glReady. Show "Low light or
  //                  featureless area — AR may not work here" + retry.
  //   'phone-flat' — glReady === true BUT user is holding phone roughly
  //                  horizontal (face down on table or flat in hand).
  //                  ARKit world tracking degrades to IMU-only in this
  //                  pose; new plant hit-tests fall onto the table top
  //                  (y≈1m) instead of the floor, producing visually
  //                  shifted cairns. Show coaching pill, disable plant.
  // ARKit needs textured features + light to fix world tracking; in
  // metro stations / dim rooms it sits at "limited" forever and the
  // user just sees a black screen. This overlay tells them why.
  // (`isPhoneFlat` derived value and the state-transition effect that
  //  depends on `arFrame` live below the `arFrame` declaration to keep
  //  init order valid; this state declaration stays here so other early
  //  refs like retryAr keep their existing line numbers.)
  const [arInitState, setArInitState] = useState<'init' | 'ready' | 'low-light' | 'phone-flat'>('init');
  // Retry handler: simply re-mount the AR overlay by toggling a key.
  // Using a counter so consecutive retries each force a fresh mount.
  const [arRetryKey, setArRetryKey] = useState(0);
  const retryAr = () => {
    setArInitState('init');
    setArRetryKey(k => k + 1);
  };
  // v64: live ARKit camera transform + cairn world positions, fed by
  // ViroAROverlay's onArFrame at ~10Hz. Powers CairnEdgeArrows so the
  // direction-to-cairn indicator uses ARKit's true-north fusion (accurate)
  // instead of expo-location's magnetic heading (jittery + biased).
  const [arFrame, setArFrame] = useState<{
    camera: { position: [number, number, number]; forward: [number, number, number] } | null;
    cairns: Array<{ id: string; type: string; x: number; y: number; z: number; dist: number }>;
    origin: { lat: number; lng: number; alt: number | null } | null;
    groundY: number | null;
    // v0.2.4 B-Apple+A: ARSession.state forward from Unity for plant gating.
    // 'tracking' = SessionTracking (Apple .normal) → plant 安全
    // 'limited'  = SessionInitializing | Ready | relocalize → plant 会出错 cairn
    // 'none'     = None | NotAvailable → 完全不能 plant
    track: 'tracking' | 'limited' | 'none';
  }>({ camera: null, cairns: [], origin: null, groundY: null, track: 'limited' });

  // v0.2.4 A: 同步 arFrame.track → trackRef (a4PlantEnabled useMemo 读 ref 避免 TDZ)
  // v0.2.4 R2.7 anti-self-licking: pure logic 抽到 trackStateDebounce module,jest 真测,
  // 这里只做 React side-effect 编排:订阅 arFrame.track,调用 module,管理 setTimeout 句柄。
  const trackDebounceStateRef = useRef(initialTrackDebounceState('limited'));
  const trackDowngradeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const next = arFrame.track;
    const now = Date.now();
    const result = onTrackEvent(trackDebounceStateRef.current, { track: next, t: now });
    trackDebounceStateRef.current = result.state;
    trackRef.current = result.state.applied;
    if (result.scheduleDowngradeAt != null) {
      // 安排 200ms 后真应用 'limited'。已有 timer 在跑时,onTrackEvent 会返 null,这里不会双重 schedule。
      const delay = result.scheduleDowngradeAt - now;
      trackDowngradeTimerRef.current = setTimeout(() => {
        trackDebounceStateRef.current = onDowngradeTimerFire(
          trackDebounceStateRef.current,
          Date.now(),
        );
        trackRef.current = trackDebounceStateRef.current.applied;
        trackDowngradeTimerRef.current = null;
      }, Math.max(0, delay));
    }
    return () => {
      // 仅 cleanup 在 unmount 时跑;effect 内 timer 由 onTrackEvent 的 downgradePending 控制不会泄漏
    };
  }, [arFrame.track]);

  // v199 §F.1 + V2.C1: 3D cone aim detection. Returns ARUiState
  // (idle | aim-pending | aim-locked) + lockedMarkerId after 600ms hold.
  // Version-gated per V2.C8: only enable on binary >= 0.2.1 so v0.2.0
  // (v198) binaries running OTA bundles don't show LikeReportSheet without
  // the corresponding Unity LikeBadge handler.
  // v224 — read NATIVE binary version (Application.nativeApplicationVersion)
  // not Constants.expoConfig.version. The latter is JS-bundle-time and would
  // make a v0.2.2 IPA running an old OTA bundle (built when app.json said
  // 0.2.0) report '0.2.0' → falsely DISABLE LikeReport on a v0.2.2 IPA that
  // actually has the Unity handler. We need IPA identity, not bundle identity.
  const _appVersion = (Application.nativeApplicationVersion ?? '0.0.0');
  const _likeReportSupported = (() => {
    const parts = _appVersion.split('.').map(n => parseInt(n, 10));
    if (parts.length < 3 || parts.some(isNaN)) return false;
    const [maj, min, patch] = parts;
    if (maj > 0) return true;
    if (maj === 0 && min > 2) return true;
    if (maj === 0 && min === 2 && patch >= 1) return true;
    return false;
  })();
  const aimHook = useAimedMarker(arFrame, {
    coneRad: 0.087,           // ~5° — OTA AimConeRad in v200+
    holdMs: 600,
    maxRangeM: 30,
    enabled: _likeReportSupported,
  });
  const [reportPickerOpen, setReportPickerOpen] = useState(false);

  // Phone-flat detection: arFrame.camera.forward is the camera's look
  // vector in ARKit world space. fy is the y-component (vertical, gravity
  // down = -1).
  //
  // v196.1: thresholds RELAXED. The original 0.85 was miscalibrated —
  // arccos(0.85) = 32° from gravity = 58° below horizontal. That triggers
  // when the user looks at the ground in front of their feet at normal
  // hand-held height (1.4-1.6m, target 0.7-1.5m away → fy ≈ -0.83 to -0.91).
  // Real-world plant logs (screenshot uploads from user) show fy=-0.81
  // hitting this gate while looking at carpet at chest distance — clearly
  // a normal-use pose, not "flat on table".
  //
  // New: asymmetric, far looser. fy < -0.97 (~76° below horizontal,
  // ≈14° from straight-down) is "phone genuinely flat / pointing at toes".
  // fy > 0.97 (looking nearly straight up at ceiling) still rare/bad.
  // Anything in between is fine — let hit-test fail naturally rather than
  // gate UI on pose. Plus 4-frame debounce so single-frame jitter doesn't
  // flap the banner.
  const isPhoneFlat = (() => {
    const fy = arFrame.camera?.forward?.[1];
    if (fy == null) return false;
    return fy > 0.97 || fy < -0.97;
  })();

  // Drive arInitState transitions. Two phases:
  //   1. Pre-glReady: 'init' for 4s, then 'low-light' if still not ready.
  //   2. Post-glReady: 'ready' OR 'phone-flat' depending on device pose.
  // Re-runs on glReady AND on isPhoneFlat changes so the user gets live
  // feedback as they tilt the phone — pick it up and the coaching pill
  // disappears within one ArFrame (~100ms).
  useEffect(() => {
    if (arStatus.glReady) {
      setArInitState(isPhoneFlat ? 'phone-flat' : 'ready');
      return;
    }
    setArInitState('init');
    // v196.1: low-light timeout 4s → 8s. v187.7.13 SessionTracking gate
    // means Unity now waits for true SessionTracking before emitting
    // ArReady — typically 2-5s in good light, up to 7s in dim/featureless
    // areas. 4s flagged "low-light" too early, scaring users on perfectly
    // valid AR scenes.
    const t = setTimeout(() => {
      setArInitState(prev => prev === 'ready' ? 'ready' : 'low-light');
    }, 8000);
    return () => clearTimeout(t);
  }, [arStatus.glReady, isPhoneFlat]);

  // v187.7.5 — OTA hotfix: production AR halo quad (4m diameter at default
  // PortalScale=1) covers the iPhone camera feed near the cairn, producing
  // a "ground-level yellow / red wash" effect. This is a Unity-side bug
  // (halo too big for AR), but rather than burn another EAS build, push
  // calmer values via OTA. After the bug is properly fixed in PortalSpawner
  // (smaller halo + fade with view angle), these defaults can be reset to 1.
  // This effect happens once per AR session at glReady.
  useEffect(() => {
    if (!arStatus.glReady || !unityOverlayRef.current) return;
    const ota = unityOverlayRef.current;
    // v196.1: distance-visibility tuning via OTA. Bug 5 reported "远处
    // 看不到效果". Bump the visibility-related globals so distant cairns
    // stay readable. These are safe defaults — Unity-side _coalesce()
    // gracefully handles values that don't exist as shader uniforms.
    //
    // - WispFadeFar: extend the wisp/strand fade-out distance multiplier
    //   from default 1.0 → 2.5 (≈2.5× further before fading).
    // - IconScale: bump 1.0 → 1.4 so the type icon is more readable from
    //   distance without making close-up cairns gigantic.
    // - HaloIntensity: 1.0 → 1.3 — slightly stronger ground halo so
    //   distant cairns retain a visible footprint.
    // - WispIntensity: 1.0 → 1.5 — wisp strands brighter against busy
    //   backgrounds (Bug 4: lines not visible while phone level).
    // - ScrollMul: 1.0 → 1.5 — speed up flow animation so motion is
    //   perceptible even when looking at the cairn from a distance and
    //   from above (Bug 4: "线条不动").
    try {
      ota.setGlobal('WispFadeFar', 2.5);
      ota.setGlobal('IconScale', 1.4);
      ota.setGlobal('HaloIntensity', 1.3);
      ota.setGlobal('WispIntensity', 1.5);
      ota.setGlobal('ScrollMul', 1.5);
      crashLogger.breadcrumb('ar:ota:v196.1 distance-visibility-bump');
    } catch (e: any) {
      crashLogger.breadcrumb(`ar:ota:setGlobal-failed ${e?.message}`);
    }
  }, [arStatus.glReady]);

  // v199 review B3 — lock the persistent AR origin on first reasonable
  // GPS sample. This is the v118 design that finally ships in v199 (was
  // stub/dead-code before). UnityAROverlay reads useMarkerStore.arOrigin
  // and computes per-session offset = (live - persisted) on first
  // ArFrame, then sends OnSetSessionOffset to Unity BEFORE bulk-spawn.
  //
  // Once-lock policy: never overwrites unless user explicitly resets via
  // long-press 📸 → clearArOrigin (defensive UI). Auto-clear if user has
  // travelled > 1km since lock (staleness gate per V2.B5 review).
  // v209 — staleness lowered 1000m → 100m. Old 1km gate caused user-reported
  // "标记跟你走" + "飞天到远端" symptom: if user plant cairn at site A then
  // walks 500m to site B (sub-1km), arOrigin stays at A, new cairns at B are
  // projected to (x,z)≈(0,0) relative to A but viewed from B's ARKit world =
  // appearing 500m away from camera = sky cairns. 100m gate forces re-lock
  // for any meaningful walk, keeping projections in sane range.
  // v0.2.4 B-Apple+B3 修 (用户铁律 'plant 在哪 cairn 永远在哪'):
  //   旧: 100m 阈值 → 用户走 50m 回来仍走 Tier-B GPS noise (cairn 飘 5-15m).
  //   新: 50m 阈值 + 同时要求 GPS accuracy <= 10m 才接受 lock
  //     (低精度 GPS 锁原点 → 后续所有 cairn 系统性偏移).
  //   配合 unityCairnSpawn.ts ARKIT_XYZ_TIER_A_MAX_DELTA_M=5m,
  //   走出 5m 触发 Tier-B 但 50m 内 origin 还在,Tier-B 用同一 origin GPS 反算 → 偏差 < 10m;
  //   超过 50m 重新 lock 原点 → 新 origin 误差贡献小.
  useEffect(() => {
    if (!arStatus.glReady) return;
    if (!lastCoord) return;
    // v0.2.4 R2.3 fix:
    //   原: accuracy > 10m -> return,永远不锁原点 -> 室内/urban canyon 用户卡死,
    //       不能 plant cairn 也不能展开新 cairn.
    //   修: 分两档,
    //     ≤10m: high-accuracy lock,正常路径
    //     10-25m: low-accuracy lock,标记 lowAccuracy=true,Tier-A only spawn
    //     >25m: 拒锁 (噪声太大,cairn 会飘)
    //   下游 unityCairnSpawn.ts 已有 Tier-A 路径,只需查 lowAccuracy flag 决定走哪条.
    //   v0.2.4 R2.3 anti-self-licking: gate + stale 检测抽到 services/originPropagation,
    //   jest 真测同函数。
    const decision = decideGpsLock(lastCoord.accuracy);
    if (decision.action === 'reject') {
      crashLogger.breadcrumb(`ar:origin:reject acc=${(lastCoord.accuracy ?? 999).toFixed(1)} (>${GPS_MAX_ACC_M}m)`);
      return;
    }
    const isLowAccuracy = decision.lowAccuracy;
    const cur = useMarkerStore.getState().arOrigin;
    if (cur) {
      if (isOriginStale(cur, lastCoord)) {
        const distM = distanceMeters(cur, lastCoord);
        useMarkerStore.getState().clearArOrigin();
        crashLogger.breadcrumb(`ar:origin:stale-clear distM=${distM.toFixed(0)} (>${ORIGIN_STALE_DISTANCE_M}m)`);
      } else {
        return;
      }
    }
    useMarkerStore.getState().setArOriginIfMissing({
      lat: lastCoord.lat,
      lng: lastCoord.lng,
      alt: lastCoord.alt ?? null,
      lowAccuracy: isLowAccuracy,
    });
    crashLogger.breadcrumb(
      `ar:origin:locked lat=${lastCoord.lat.toFixed(6)} lng=${lastCoord.lng.toFixed(6)} acc=${lastCoord.accuracy ?? 'null'} lowAcc=${isLowAccuracy}`
    );
  }, [arStatus.glReady, lastCoord]);

  // subagent review found that wiring up the dormant v118 persistent AR
  // origin would silently save plants at the WRONG city's GPS if the
  // user travelled between sessions, and would mis-project bulk-spawned
  // markers because ARKit's per-session world (0,0,0) is the device
  // anchor, not the persisted GPS. Both regressions are worse than the
  // 20m drift the change was meant to fix. Bug 8 needs a per-session
  // anchor-offset compensation pass + a manual reset UI before it can
  // ship — postponed to next Unity build cycle.

  // Ready haptic — fire ONCE when transitioning to 'ready' so the user
  // gets a subtle multimodal cue that AR is now interactive. Matches
  // industry pattern (Apple Measure / IKEA Place fade out coaching +
  // soft tactile cue). Won't fire on 'phone-flat' since that isn't
  // actually a "ready to plant" moment for the user.
  const readyHapticFiredRef = useRef(false);
  useEffect(() => {
    if (arInitState === 'ready' && !readyHapticFiredRef.current) {
      readyHapticFiredRef.current = true;
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
      crashLogger.breadcrumb('ar:ready-haptic-fired');
    }
  }, [arInitState]);
  // v68: viewport-level lock-on animation. Set true the instant user taps
  // Aim & Plant; AimShutter auto-resets after ~1.3s.
  const [shutterFiring, setShutterFiring] = useState(false);
  // v70: beam toggle — when user taps a row in the marker panel, that
  // cairn renders a tall vertical light beam for 30s. Helps locate a far
  // cairn the user is hunting for. Only one cairn beams at a time
  // (tapping a different one switches to that one). Auto-cleared by timer.
  const [beamingId, setBeamingId] = useState<string | null>(null);
  const beamTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    return () => { if (beamTimerRef.current) clearTimeout(beamTimerRef.current); };
  }, []);
  const handleBeamToggle = useCallback((markerId: string) => {
    if (beamTimerRef.current) clearTimeout(beamTimerRef.current);
    setBeamingId(prev => {
      const next = prev === markerId ? null : markerId;
      if (next) {
        beamTimerRef.current = setTimeout(() => setBeamingId(null), 30_000);
        crashLogger.breadcrumb(`ar:beam:on id=${markerId.slice(-6)}`);
      } else {
        crashLogger.breadcrumb(`ar:beam:off id=${markerId.slice(-6)}`);
      }
      return next;
    });
  }, []);

  // v194 OTA: upload user-picked screenshot(s) from the iOS Photos library
  // to /api/debug-snapshot. User flow:
  //   1. take iOS screenshot(s) of the AR view (Vol Up + Side button)
  //   2. tap 🐞 → "Upload screenshot"
  //   3. iOS multi-select picker opens → user picks 1-5 screenshots
  //   4. confirm sheet shows thumbnails → tap "Upload N"
  //   5. uploads run sequentially, pill shows progress + final ✓ count
  //
  // Two-step (pick + confirm) so user sees what they're about to send and
  // can back out — important because once uploaded, image is on the server.
  //
  // Using pick-from-library (NOT in-app capture via react-native-view-shot)
  // because that would force a native rebuild. The iOS system screenshot
  // captures the AR camera feed perfectly which is exactly what's needed
  // for remote debugging.
  //
  // Implementation note: uses FileSystem.uploadAsync (native binary upload,
  // off the JS thread) instead of fetch({ body: Uint8Array }). RN 0.81's
  // networking layer doesn't reliably forward TypedArrays as raw bytes —
  // they get coerced and fail the backend's PNG-magic check. uploadAsync
  // streams the file bytes directly from disk via the native HTTP stack,
  // which is the only way an OTA can reliably ship binary uploads on RN.

  // Step 1: open multi-select picker, stage results to pendingPhotos.
  const pickScreenshots = useCallback(async () => {
    setSnapState('busy');
    setSnapMsg('picking…');
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        setSnapState('err');
        setSnapMsg('photo perm denied');
        setTimeout(() => { setSnapState('idle'); setSnapMsg(''); }, 4000);
        return;
      }
      const pick = await ImagePicker.launchImageLibraryAsync({
        // SDK 54: 'images' string array literal is the forward-compat form.
        mediaTypes: ['images'],
        allowsEditing: false,
        allowsMultipleSelection: true,
        selectionLimit: 5,
        quality: 1,
      });
      if (pick.canceled || !pick.assets?.length) {
        setSnapState('idle');
        setSnapMsg('');
        return;
      }
      // Stage for confirmation. Don't upload yet.
      setPendingPhotos(pick.assets.map(a => ({
        uri: a.uri,
        width: a.width ?? 0,
        height: a.height ?? 0,
      })));
      setSnapState('idle');
      setSnapMsg('');
    } catch (e: any) {
      setSnapState('err');
      setSnapMsg(e?.message ?? 'pick failed');
      setTimeout(() => { setSnapState('idle'); setSnapMsg(''); }, 4000);
    }
  }, []);

  // Step 2: user confirmed — upload all staged photos sequentially.
  const confirmUploadScreenshots = useCallback(async () => {
    const photos = pendingPhotos;
    if (!photos.length) return;
    setPendingPhotos([]);
    setSnapState('busy');
    setSnapMsg(`0/${photos.length}…`);
    let okCount = 0;
    let lastErr: string | null = null;
    for (let i = 0; i < photos.length; i++) {
      const asset = photos[i];
      setSnapMsg(`${i + 1}/${photos.length}…`);
      try {
        const id = `manual-${Date.now()}-${i}`;
        const meta = btoa(JSON.stringify({
          ota_v: OTA_VERSION,
          screen_w: asset.width,
          screen_h: asset.height,
          ts: Date.now(),
          batch_idx: i,
          batch_total: photos.length,
        }));
        const url = `${API_BASE_URL}/api/debug-snapshot?id=${id}&meta=${encodeURIComponent(meta)}`;
        const uploadResult = await FileSystem.uploadAsync(url, asset.uri, {
          httpMethod: 'POST',
          uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
          headers: {
            'Content-Type': 'image/png',
            'X-Cairn-Device-Os': 'ios',
            'X-Cairn-App-Version': Application.nativeApplicationVersion ?? 'unknown',
            'X-Cairn-Ar-Mode': 'unity',
          },
        });
        if (uploadResult.status < 200 || uploadResult.status >= 300) {
          let errText = `HTTP ${uploadResult.status}`;
          try {
            const j = JSON.parse(uploadResult.body || '{}');
            if (j?.error) errText = j.error;
          } catch { /* keep code */ }
          throw new Error(errText);
        }
        okCount++;
        crashLogger.breadcrumb(`debug-snapshot uploaded ${i + 1}/${photos.length}: ${id}`);
      } catch (e: any) {
        lastErr = e?.message ?? 'upload failed';
        crashLogger.breadcrumb(`debug-snapshot upload failed ${i + 1}/${photos.length}: ${lastErr}`);
        // continue trying remaining photos rather than aborting batch
      }
    }
    if (okCount === photos.length) {
      setSnapState('done');
      setSnapMsg(`${okCount} uploaded`);
    } else if (okCount === 0) {
      setSnapState('err');
      setSnapMsg(lastErr ?? 'all failed');
    } else {
      setSnapState('err');
      setSnapMsg(`${okCount}/${photos.length} ok · ${lastErr ?? ''}`);
    }
    setTimeout(() => { setSnapState('idle'); setSnapMsg(''); }, 5000);
  }, [pendingPhotos]);

  const cancelPendingPhotos = useCallback(() => {
    setPendingPhotos([]);
    setSnapState('idle');
    setSnapMsg('');
  }, []);

  // v25: upload diagnostic breadcrumb when AR screen unmounts so we capture
  // the full session — buildCairn / populate / first-frame outcomes.
  useEffect(() => {
    crashLogger.breadcrumb(`ar:screen:mount`);
    // OTA #181: log the camera-gate decision so post-OTA telemetry can
    // confirm the gate fix is actually in the running bundle. Greppable
    // v186: camera-gate is permanently false — Unity is the only AR path
    // and Unity handles its own camera feed via ARCameraBackground inside
    // UnityFramework. No CameraView mounted from RN.
    crashLogger.breadcrumb('ar:camera-gate path=unity cameraWillMount=false');
    return () => {
      crashLogger.breadcrumb(`ar:screen:unmount`);
      crashLogger.uploadDiagnostic(API_BASE_URL, 'unmount').catch(() => undefined);
    };
  }, []);
  const [savedToast, setSavedToast] = useState(false);
  // Live compass heading from expo-location (0=N, 90=E, etc).
  // null until first heading update or if heading unavailable.
  const [userHeading, setUserHeading] = useState<number | null>(null);

  // v0.2.4 Block E2: 当前正在 ACQUIRE 的 marker id(从 Unity v22-ACQUIRE-STATE
  // 事件订阅)。用来:(1) DistantMarkerArrow 锁定显示当前目标;(2) AcquireGuidance
  // 知道是否要 render guidance 文案。null=不在 ACQUIRE 状态。
  //
  // 路由架构(BLOCKER 1 修复):
  //   Unity SendToRN("v22-ACQUIRE-STATE", json)
  //   → native bridge → onUnityMessage prop
  //   → parseUnityMessage → kind:'AcquireState'
  //   → UnityAROverlay switch case → globalThis.__cairnAcquireState(...)
  //   → 此处 useEffect 注册的 handler 设 state
  // 不用 NativeEventEmitter('CairnBridge') — Cairn 没暴露那个 native module。
  const [acquiringMarkerId, setAcquiringMarkerId] = useState<string | null>(null);

  useEffect(() => {
    const prev = (globalThis as any).__cairnAcquireState;
    (globalThis as any).__cairnAcquireState = (data: { markerId: string; from: string; to: string; dist: number; tInAcquire: number }) => {
      if (data.to === 'ACQUIRE') setAcquiringMarkerId(data.markerId);
      else if (data.to === 'IMMORTAL' || data.to === 'FAR') setAcquiringMarkerId(null);
    };
    return () => { (globalThis as any).__cairnAcquireState = prev; };
  }, []);

  // Subscribe to magnetic heading on mount; expo-location is already a dep.
  // Requests permission first — without it, watchHeadingAsync silently
  // returns no events on iOS. Falls back gracefully if denied or unavailable.
  useEffect(() => {
    let cancelled = false;
    let headingSub: { remove: () => void } | null = null;
    let posSub: { remove: () => void } | null = null;
    (async () => {
      try {
        const Location = await import('expo-location');
        // Ensure foreground location is granted; heading API depends on it.
        const perm = await Location.requestForegroundPermissionsAsync();
        if (cancelled) return;
        if (perm.status !== 'granted') {
          // Heading stays null → ARDebugOverlay shows "—" for heading;
          // ARKit's GravityAndHeading is unaffected (it has its own
          // compass+gyro fusion independent of expo-location).
          return;
        }
        headingSub = await Location.watchHeadingAsync((h) => {
          if (cancelled) return;
          // trueHeading is most accurate but may be -1 on simulator;
          // fall back to magHeading.
          const heading = h.trueHeading >= 0 ? h.trueHeading : h.magHeading;
          if (heading >= 0) setUserHeading(heading);
        });
        // v44: continuously watch position while AR screen is open.
        // Earlier we relied on a one-shot getCurrentPositionAsync, which
        // meant lastCoordinate never updated as the user walked. Telemetry
        // sample breadcrumbs in v42/v43 confirmed userLat was frozen for
        // 26+ seconds, making cairns appear glued to the camera (the
        // gpsToWorld delta stayed at the initial offset forever). Now we
        // get continuous updates whenever the AR screen is open, even
        // without an active tracking session.
        posSub = await Location.watchPositionAsync(
          {
            accuracy: Location.Accuracy.High,
            timeInterval: 1000, // ms
            distanceInterval: 0.5, // metres
          },
          (pos) => {
            if (cancelled) return;
            useTrackingStore.setState({
              lastCoordinate: {
                lat: pos.coords.latitude,
                lng: pos.coords.longitude,
                alt: pos.coords.altitude ?? null,
                // v199 §F.3 server-side gate uses accuracy ≤100m. Forward
                // it so /vote receives a non-null accuracy field.
                accuracy: pos.coords.accuracy ?? null,
              },
              lastCoordinateTime: pos.timestamp ?? Date.now(),
            } as any);
          },
        );
      } catch {
        // Heading unavailable — UI shows static dial
      }
    })();
    return () => {
      cancelled = true;
      try { headingSub?.remove(); } catch { /* no-op */ }
      try { posSub?.remove(); } catch { /* no-op */ }
    };
  }, []);

  // Refs for any pending timers — must be cleared on unmount to prevent
  // calling setState/nav.goBack on an already-unmounted component.
  const savedToastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const degradedToastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    return () => {
      if (savedToastTimerRef.current) clearTimeout(savedToastTimerRef.current);
      if (degradedToastTimerRef.current) clearTimeout(degradedToastTimerRef.current);
      if (plantRejectedTimerRef.current) clearTimeout(plantRejectedTimerRef.current);
    };
  }, []);

  // Branch B v3-review-fix: install global plant-rejection toast hook.
  // R2 fix: capture and restore the previous handler instead of overwriting
  // with a no-op on unmount, so cross-mount transitions don't silently
  // disable the toast for the next instance.
  useEffect(() => {
    const previousHandler = (globalThis as any).__cairnPlantRejected;
    (globalThis as any).__cairnPlantRejected = (message: string) => {
      setPlantRejectedToast(message);
      if (plantRejectedTimerRef.current) clearTimeout(plantRejectedTimerRef.current);
      plantRejectedTimerRef.current = setTimeout(() => {
        setPlantRejectedToast(null);
      }, 2200);
    };
    return () => {
      // Restore prior handler (or undefined). Avoids replacing live handlers
      // installed by a still-mounted ARScreen during navigation transitions.
      (globalThis as any).__cairnPlantRejected = previousHandler;
    };
  }, []);

  // Filter markers within AR range
  const nearbyMarkers = markers.filter(m => {
    if (!lastCoord) return false;
    const dist = haversineM({ lat: lastCoord.lat, lng: lastCoord.lng }, { lat: m.lat, lng: m.lng });
    return dist <= AR_MAX_RANGE_M;
  });

  // v0.2.4 Block E2: DistantMarkerArrow 用最近的一个 marker 当指引目标。
  // 如有 acquiringMarkerId 则锁定到它(用户已开始 acquire 那个 mark);
  // 否则取最近的 mark。
  const nearestMarker = (() => {
    if (!lastCoord || nearbyMarkers.length === 0) return null;
    if (acquiringMarkerId) {
      const locked = nearbyMarkers.find(m => m.id === acquiringMarkerId);
      if (locked) return locked;
    }
    let best = nearbyMarkers[0];
    let bestDist = haversineM({ lat: lastCoord.lat, lng: lastCoord.lng }, { lat: best.lat, lng: best.lng });
    for (let i = 1; i < nearbyMarkers.length; i++) {
      const m = nearbyMarkers[i];
      const d = haversineM({ lat: lastCoord.lat, lng: lastCoord.lng }, { lat: m.lat, lng: m.lng });
      if (d < bestDist) { best = m; bestDist = d; }
    }
    return best;
  })();

  // Plant a cairn at the user's GPS, projected forward by `distanceM`
  // along their current heading. Distance values: 5/10/20/30 — 30 is
  // the hard cap (route-rules.md §AR precision boundary). All planting
  // goes through this single function: the DragCairnPicker calls it
  // when the user releases over the centre target with a chosen type
  // and distance.
  //
  // GPS sampling: when the user has more than one second to commit
  // (i.e. they hovered to pick a distance), we average the last
  // ~3 seconds of GPS in the trackPoints buffer so a single noisy
  // reading doesn't determine the cairn's location. For instant
  // releases at default distance we use the live coord as-is.
  // v22: title captured by PlantSheet, consumed by handlePlantCairn when
  // it builds the addMarker payload. Ref so we don't churn handlePlantCairn's
  // useCallback deps every keystroke.
  const pendingTitleRef = useRef<string>('');
  const handlePlantCairn = useCallback(async (type: string, distanceM: number) => {
    crashLogger.breadcrumb(`ar:plant:start type=${type} distance=${distanceM}`);

    // v0.2.4 Branch B: plant 不再强制需要 GPS。如果有 GPS 用 GPS,没 GPS 用
    // ARKit 世界坐标(arFrame.camera.position + forward * distance)。
    // 用户原话:"AR 世界坐标永远不变 5 年后回来你的标记都还在"
    // → AR 是真实存储坐标系,GPS 是辅助让箭头找方向。
    //
    // 之前 v0.2.3 强制 require GPS 是错的:
    //   - 没 GPS = 用户进了林子/隧道/室内 → 完全无法 plant
    //   - 但 ARKit 世界坐标在这些环境下仍然有效
    //   - Alert 体验破坏沉浸感
    //
    // 新行为:
    //   - 有 GPS 且 fresh (<3s) → 走 GPS+ARKit 双源(高精度)
    //   - 有 GPS 但 stale (>30s) → degraded 模式但仍能 plant
    //   - 无 GPS → 纯 ARKit 世界坐标 plant,标记 lat/lng=null,只有 ARKit 同 session 有效
    //              下次冷启动这个 cairn 不会出现(没 GPS 找不到位置)— 用户接受
    if (!lastCoord && trackPoints.length === 0 && !arFrame.camera) {
      Alert.alert(
        'AR 还没准备好',
        '请等待相机校准完成,或移动到光线更好的环境。',
      );
      return;
    }

    // Anchor coord — averaged over recent samples when available
    let anchor: { lat: number; lng: number; alt?: number | null };
    let approximate = false;
    let age = 0;

    if (lastCoord) {
      // Average the last ≤3s of trackpoints + lastCoord for a steadier
      // GPS anchor. trackPoints carries time stamps so we filter by age.
      const cutoff = Date.now() - 3000;
      const recent = trackPoints.filter(p => p.t >= cutoff);
      const samples = recent.length > 0
        ? [...recent.map(p => ({ lat: p.lat, lng: p.lng, alt: p.alt })), { lat: lastCoord.lat, lng: lastCoord.lng, alt: lastCoord.alt }]
        : [{ lat: lastCoord.lat, lng: lastCoord.lng, alt: lastCoord.alt }];
      const sumLat = samples.reduce((s, p) => s + p.lat, 0);
      const sumLng = samples.reduce((s, p) => s + p.lng, 0);
      const altSamples = samples.filter(p => p.alt != null) as { alt: number }[];
      const avgAlt = altSamples.length > 0
        ? altSamples.reduce((s, p) => s + p.alt, 0) / altSamples.length
        : null;
      anchor = { lat: sumLat / samples.length, lng: sumLng / samples.length, alt: avgAlt };
      if (lastCoordTime) {
        age = Math.round((Date.now() - lastCoordTime) / 1000);
        if (age > 30) approximate = true;
      }
    } else {
      // Branch 2: Lost GPS — use last trackpoint, mark approximate
      const lastTP = trackPoints[trackPoints.length - 1];
      anchor = { lat: lastTP.lat, lng: lastTP.lng, alt: lastTP.alt };
      age = Math.round((Date.now() - lastTP.t) / 1000);
      approximate = true;
    }

    // v68: Plant via ARKit world space, NOT via GPS-anchor + heading projection.
    //
    // Why: previous flow was "anchor = GPS averaged over last 3s" + project that
    // anchor by distanceM along ARKit forward. This gave an "anchor in the past
    // (you were N seconds back) + 10m forward". After walking 25m, the cairn
    // saved at the average of those 25m + 10m forward, ≈ 25m from where you
    // actually stood. ARKit then rendered it relative to its own origin (set
    // when AR scene mounted), so the cairn appeared at ~35m, not 10m.
    //
    // New approach (when ARKit camera + origin available):
    //   1. ARKit world target = camera.position + forward * distanceM (ground plane)
    //   2. GPS = arkitOrigin (the GPS lat/lng the moment ARKit anchored) +
    //      decode(target.x, target.z) using ARKit's GravityAndHeading axes
    //      (+X = East, -Z = North)
    //   3. Cairn renders at exactly the world position we computed →
    //      "I aimed there, it's there"
    //
    // Fallback (no ARKit frame yet): the old GPS-anchor + heading flow,
    // accepting its known drift, just so the user can still plant in the
    // first second before the camera transform callback fires.
    let cairnLat = anchor.lat;
    let cairnLng = anchor.lng;
    // ARKit world-space target preserved for Unity OnSpawnStrand below.
    // null means "no AR origin / fell through to GPS-only path" — we'll
    // skip Unity spawn (cairn still saves to DB and shows on map; the next
    // re-entry to AR will pick it up via spawnMarkers on ArReady).
    let unitySpawnPos: { x: number; y: number; z: number } | null = null;
    if (distanceM > 0) {
      const cam = arFrame.camera;
      // v196.1 (revised): use per-session arFrame.origin (live GPS) for
      // the ARKit↔GPS conversion. This is the only correct projection —
      // ARKit's world (0,0,0) is wherever the device anchored THIS
      // session. Don't try to substitute a stale persistent origin
      // (subagent review: would silently save plants at the wrong city
      // if user travelled). The 20m drift fix lives elsewhere — not
      // here. Persistent origin is captured for diagnostic / future use
      // but not used in the conversion math (yet — needs proper
      // per-session offset compensation that's beyond OTA scope).
      //
      // v213 — plant must use the SAME projection origin that
      // UnityAROverlay bulk-spawn uses, otherwise plant's lat/lng won't
      // round-trip back to the same ARKit world position on reopen.
      // Old code used arFrame.origin (= props.userPos, the LIVE GPS at
      // the moment of plant), but UnityAROverlay spawn uses persisted
      // arOrigin from MMKV. GPS noise/drift between live and persisted
      // shifts cairn ~10-30m visible offset between plant time and
      // reopen. Fix: read persisted arOrigin from store directly,
      // fallback to arFrame.origin only if not yet locked.
      const persistedOrigin = useMarkerStore.getState().arOrigin;
      const arOrigin = persistedOrigin ?? arFrame.origin;
      const ground = arFrame.groundY;
      if (cam && arOrigin) {
        // v72: ARKit hit-test plant. Distance is no longer fixed at 10m —
        // it's wherever the user's camera ray intersects the ground plane.
        // Looking down at your feet → cairn lands ~1m away. Looking at a
        // spot 8m down the trail → cairn lands at that exact spot.
        // Looking flat / up at the horizon → no ground hit, fallback to
        // 1m in front (lands at user's feet).
        //
        // Math: ray from cam.position along cam.forward, intersect plane
        // y = groundY. t = (groundY - cam.y) / forward.y
        // Only valid when forward.y < ~ -0.05 (looking downward enough).
        // Cap at 30m so a glance toward the horizon doesn't fly the cairn
        // off into the distance.
        const fx = cam.forward[0];
        const fy = cam.forward[1];
        const fz = cam.forward[2];
        const cx = cam.position[0];
        const cy = cam.position[1];
        const cz = cam.position[2];
        let targetX = cx;
        let targetZ = cz;
        let usedHitTest = false;
        let hitDistM = 0;
        if (ground !== null && fy < -0.05) {
          const t = (ground - cy) / fy;
          if (t > 0 && t < 30) {
            // Successful hit on ground plane within range.
            targetX = cx + fx * t;
            targetZ = cz + fz * t;
            hitDistM = Math.hypot(targetX - cx, targetZ - cz);
            usedHitTest = true;
          }
        }
        // v0.2.3 Branch B (Floor-only invariant): if ground hit-test failed,
        // REJECT the plant. User invariant: "只要最终落在地面 我就接受".
        // Spawning at camera.y (the old fallback) caused the "cairn 浮空"
        // / "飞天" bug — cairn would render at chest height, then lerp down.
        //
        // Industry consensus: Apple Measure / Pokémon GO / IKEA Place / Snap
        // all gate placement on a real ground hit; if none, show reticle
        // prompt "point at ground". Cairn now matches.
        if (!usedHitTest) {
          crashLogger.breadcrumb(`ar:plant:rejected reason=no-ground fy=${fy.toFixed(2)} groundBufferKnown=${ground === null ? 'no' : 'yes-but-fy-too-flat'}`);
          // Surface a non-blocking toast so user knows what happened.
          // This keeps UX continuous: user just re-aims downward at trail.
          if (typeof (globalThis as any).__cairnPlantRejected === 'function') {
            (globalThis as any).__cairnPlantRejected('Point at the ground to plant');
          }
          return;
        }
        // v211 — REVERT v210 virtualOrigin in plant flow. Use arOrigin
        // (= user GPS at first ArFrame) as projection origin, matching
        // Viro's locked-origin pattern. ARKit world (X,Z) → GPS delta
        // is the inverse of buildSpawnRequest's geoToArkitWorld, so as
        // long as plant-time origin == spawn-time origin, the round-trip
        // is consistent.
        const cosLat = Math.cos((arOrigin.lat * Math.PI) / 180);
        const dE = targetX;
        const dN = -targetZ;
        cairnLat = arOrigin.lat + dN / 111000;
        cairnLng = arOrigin.lng + dE / (cosLat * 111000);
        // Branch B: ground is non-null because !usedHitTest above already
        // returned. Always pass the real ground Y to Unity.
        unitySpawnPos = { x: targetX, y: ground!, z: targetZ };
        crashLogger.breadcrumb(`ar:plant:src=hit-test fy=${fy.toFixed(2)} ground=${ground!.toFixed(2)} hit=${usedHitTest} dist=${hitDistM.toFixed(2)}m origin=${arOrigin.lat.toFixed(6)},${arOrigin.lng.toFixed(6)}`);
        anchor = arOrigin;
      } else {
        // FALLBACK — no ARKit frame yet. Use GPS anchor + ARKit/magnetic heading.
        let dN = 0, dE = 0;
        if (cam) {
          const fx = cam.forward[0];
          const fz = cam.forward[2];
          const horizMag = Math.hypot(fx, fz);
          if (horizMag > 0.001) {
            dE = (fx / horizMag) * distanceM;
            dN = (-fz / horizMag) * distanceM;
          }
          crashLogger.breadcrumb(`ar:plant:src=arkit-fallback dN=${dN.toFixed(2)} dE=${dE.toFixed(2)}`);
        } else if (userHeading != null) {
          const headingRad = (userHeading * Math.PI) / 180;
          dN = Math.cos(headingRad) * distanceM;
          dE = Math.sin(headingRad) * distanceM;
          crashLogger.breadcrumb(`ar:plant:src=mag hdg=${userHeading.toFixed(1)} dN=${dN.toFixed(2)} dE=${dE.toFixed(2)}`);
        }
        cairnLat = anchor.lat + dN / 111000;
        cairnLng = anchor.lng + dE / (111000 * Math.cos(anchor.lat * Math.PI / 180));
      }
    }

    // Spacing check restored in v18.2 with a 50m radius — preventing
    // multiple cairns from stacking at the same spot. Without it,
    // users planting consecutive cairns at the same location made all
    // 4 type-coloured spheres render at the exact same world position,
    // and only the last-drawn one was visible (z-fighting).
    //
    // 50m is generous (was 20m pre-v17) so users still feel free to
    // mark several distinct spots within a hike, but two cairns can
    // no longer occupy the same patch of trail. Future product work
    // may relax or tighten this.
    // v63 (route-rules.md update): user requested removing the 50m spacing
    // gate. Cairns are personal markers and the user wants free placement
    // even within tens of metres of an existing one. Set to 0 to disable
    // entirely (the function still returns allowed=true when nothing nearby).
    const spacing = checkMarkerSpacing(
      { lat: cairnLat, lng: cairnLng },
      markers.map(m => ({ id: m.id, lat: m.lat, lng: m.lng })),
      0,
    );
    if (!spacing.allowed) {
      Alert.alert(
        'Cairn nearby',
        `There's already a cairn ~${Math.round(spacing.nearestDistM)}m away.`,
      );
      crashLogger.breadcrumb(`ar:plant:rejected nearest=${Math.round(spacing.nearestDistM)}`);
      return;
    }

    if (approximate) {
      const ageText = age < 60 ? `${age}s` : age < 3600 ? `${Math.round(age / 60)}min` : `${Math.round(age / 3600)}h`;
      setDegradedToast(`Using last known location (${ageText} ago)`);
      if (degradedToastTimerRef.current) clearTimeout(degradedToastTimerRef.current);
      degradedToastTimerRef.current = setTimeout(() => setDegradedToast(null), 4000);
    }

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    crashLogger.breadcrumb(`ar:plant:before-addMarker lat=${cairnLat.toFixed(5)} lng=${cairnLng.toFixed(5)}`);
    // v0.2.4 Part 2 A2.2: 取持久化 arOrigin 给 marker 作 plant-time 快照
    // (line 942 的 arOrigin 定义在 if-block 内 scope 不可见,这里独立读 store)
    const plantArOrigin = useMarkerStore.getState().arOrigin;
    try {
      const marker = await addMarker({
        type: type as any,
        regionCode: 'nz',
        lat: cairnLat,
        lng: cairnLng,
        // v22: title from PlantSheet is captured into pendingTitleRef before
        // handlePlantCairn runs. Falls back to '' for legacy callers.
        note: pendingTitleRef.current || '',
        authorId: 'local',
        permission: 'personal',
        sessionId: sessionId ?? undefined,
        approximate: approximate || undefined,
        gpsAgeS: approximate ? age : undefined,
        alt: anchor.alt ?? undefined,
        // v0.2.4 Part 2 A2.2 — 双源持久化:同时存 ARKit world XYZ + arOrigin 快照
        // 用户原话:"AR plant 的 mark 没用 arkit 的世界坐标 用的是 GPS 所以每次打开都飘逸"
        // re-spawn 时(unityCairnSpawn.buildSpawnRequest)若同 arOrigin 偏差 < 5m → 直接用 arkitXYZ
        // 偏差 > 5m 则 fallback geoToArkitWorld GPS 路径(行为同旧)
        // unitySpawnPos 仅 same-session hit-test 才非 null,fallback path 时 undefined → 走旧 GPS 重算
        arkitX: unitySpawnPos?.x,
        arkitY: unitySpawnPos?.y,
        arkitZ: unitySpawnPos?.z,
        arOriginLat: unitySpawnPos ? plantArOrigin?.lat : undefined,
        arOriginLng: unitySpawnPos ? plantArOrigin?.lng : undefined,
      });
      crashLogger.breadcrumb(`ar:plant:after-addMarker id=${marker.id}`);
      if (sessionId) linkMarker(marker.id);
      crashLogger.breadcrumb(`ar:plant:saved id=${marker.id}`);
      // Phase 2 wire-up: tell Unity to spawn the strand at the exact ARKit
      // world position we hit-tested. We use the directly-computed (x, y, z)
      // instead of round-tripping through buildSpawnRequest's GPS converter
      // — same source-of-truth, zero extra error from float drift, and works
      // even if origin is in a slightly different ArFrame than this hit-test.
      if (unitySpawnPos && unityOverlayRef.current) {
        const colour = markerTypeToColor(type);
        const shader = markerTypeToShaderParams(type);
        unityOverlayRef.current.spawnCairn({
          id: marker.id,
          type: type,             // v186: forward type so Unity's preset can apply per-type personality
          x: unitySpawnPos.x,
          y: unitySpawnPos.y,
          z: unitySpawnPos.z,
          r: colour.r,
          g: colour.g,
          b: colour.b,
          scrollSpeed: shader.scrollSpeed,
          bloomBoost: shader.bloomBoost,
          // v187: forward the user-typed note so PortalSpawner renders the
          // 3D mark text above the cairn (≤30 codepoints, word-wrapped).
          // Codepoint-aware clip (handles emoji surrogate pairs).
          note: [...(marker.note || '')].slice(0, 30).join(''),
          // v0.2.4 B2: plant 时刻 raycast hit 直接是当前 ARKit world 真坐标
          //   → Unity 端 PortalSpawner 必须 bypass sessionOffset (用户铁律)
          tier: 'A',
        });
      } else {
        crashLogger.breadcrumb(
          `ar:plant:unity-spawn-skip pos=${!!unitySpawnPos} ref=${!!unityOverlayRef.current}`
        );
      }
      // v25 diagnostic: 1.5s after plant, push current breadcrumb buffer
      // to backend telemetry. This captures the buildCairn / populate /
      // first-frame events triggered by the new marker so we can debug
      // why the cairn isn't showing where expected.
      setTimeout(() => {
        crashLogger.uploadDiagnostic(API_BASE_URL, 'plant').catch(() => undefined);
      }, 1500);
      setSavedToast(true);
      if (savedToastTimerRef.current) clearTimeout(savedToastTimerRef.current);
      savedToastTimerRef.current = setTimeout(() => setSavedToast(false), 1200);
    } catch (err) {
      crashLogger.breadcrumb(`ar:plant:error ${String(err).slice(0, 80)}`);
      Alert.alert('Error', 'Failed to plant cairn. Please try again.');
    }
  }, [lastCoord, lastCoordTime, trackPoints, markers, sessionId, addMarker, linkMarker, arFrame.camera, arFrame.origin, arFrame.groundY]);
  // v69: removed `userHeading` from deps. The only branch that uses it is the
  // emergency fallback (no ARKit camera frame yet, line ~745) — re-rendering
  // this callback every time the magnetic compass jitters was wasted work
  // when the ARKit primary path was active anyway. The fallback still reads
  // the latest userHeading via closure capture if it ever fires.

  // v22 PlantSheet adapter: PlantSheet returns (type, distanceM, title);
  // handlePlantCairn currently doesn't accept a title, so we capture it
  // separately and feed it as the note via pendingTitleRef. Keeping
  // handlePlantCairn unchanged minimises the diff and keeps the legacy
  // flow callable from elsewhere if needed.
  const handlePlantFromSheet = useCallback(
    async (type: PlantType, distanceM: number, title: string) => {
      pendingTitleRef.current = title;
      await handlePlantCairn(type, distanceM);
    },
    [handlePlantCairn],
  );

  // Camera permission — request on mount when expo-camera is present.
  // Hook is called only if useCameraPermissions exists (conditional
  // import). When the module is missing, perm is undefined and we
  // fall through to the dark backdrop.
  const [cameraPerm, requestCameraPerm] = useCameraPermissions
    ? useCameraPermissions()
    : [null, async () => null];
  useEffect(() => {
    if (!useCameraPermissions) return;
    if (cameraPerm && !cameraPerm.granted && cameraPerm.canAskAgain) {
      requestCameraPerm();
    }
  }, [cameraPerm?.granted]);
  // OTA #183: log camera permission state once per change. Lets diag
  // distinguish "ARKit loader not registered" from "camera permission
  // denied" — both produce a black screen, but only the latter shows
  // status='denied' or granted=false here. Unity ARKit needs the same
  // iOS-level AVAuthorizationStatusForMediaType=Video grant that
  // expo-camera tracks.
  const lastPermLogRef = useRef<string | null>(null);
  useEffect(() => {
    const sig = `${cameraPerm?.status ?? 'null'}/${cameraPerm?.granted ?? 'null'}/${cameraPerm?.canAskAgain ?? 'null'}`;
    if (sig === lastPermLogRef.current) return;
    lastPermLogRef.current = sig;
    crashLogger.breadcrumb(
      `ar:camera-perm status=${cameraPerm?.status ?? 'null'} granted=${cameraPerm?.granted ?? 'null'} canAskAgain=${cameraPerm?.canAskAgain ?? 'null'} moduleLoaded=${!!useCameraPermissions}`
    );
  }, [cameraPerm?.status, cameraPerm?.granted, cameraPerm?.canAskAgain]);

  return (
    <View style={styles.container}>
      {/* v186: Unity owns the rear camera feed via ARCameraBackground
          inside UnityFramework. RN does not mount expo-camera here.
          (Pre-v186 had branches for Viro / r3f / no-AR that mounted
          CameraView from RN — all removed.) */}

      {/* AR overlay — Unity is the only path. No ErrorBoundary fallback
          intentionally: crashes surface raw so breadcrumb logs + debug
          snapshots can be analysed. */}
      <UnityAROverlay
        ref={unityOverlayRef}
        markers={nearbyMarkers}
        userPos={lastCoord ? { lat: lastCoord.lat, lng: lastCoord.lng, alt: lastCoord.alt ?? null } : null}
        arOrigin={arOriginReactive}
        userHeading={userHeading}
        onStatus={setArStatus}
        onArFrame={setArFrame}
        beamingId={beamingId}
        onCairnPress={(id) => {
          crashLogger.breadcrumb(`unity:cairn:press id=${id.slice(-6)}`);
        }}
      />

      {/* v0.2.4 Block E2: 远场箭头 + 5 级引导文案。
          DistantMarkerArrow > 15m 显示 GPS heading 指向最近 mark + 距离脉动。
          AcquireGuidance 只在 acquiringMarkerId 非 null 时 render(Unity v22-ACQUIRE-STATE 订阅)。 */}
      <DistantMarkerArrow
        marker={nearestMarker ? { id: nearestMarker.id, lat: nearestMarker.lat, lng: nearestMarker.lng, type: nearestMarker.type } : null}
        user={lastCoord ? { lat: lastCoord.lat, lng: lastCoord.lng, heading: userHeading ?? undefined } : null}
      />
      <AcquireGuidance acquiringMarkerId={acquiringMarkerId} />


      {/* v24 on-screen diagnostic — GL ready, cairn count, recent breadcrumbs */}
      <ARDebugOverlay
        cairnCount={arStatus.cairnCount}
        glReady={arStatus.glReady}
        userPos={lastCoord ? { lat: lastCoord.lat, lng: lastCoord.lng } : null}
        userHeading={userHeading}
      />

      {/* v195.1 — Photo confirm sheet. After multi-select picker returns,
          show thumbnails + "Upload N" before actually uploading. Lets the
          user back out if they accidentally picked the wrong photo. */}
      <Modal
        visible={pendingPhotos.length > 0}
        transparent
        animationType="fade"
        onRequestClose={cancelPendingPhotos}
      >
        <Pressable
          style={styles.debugMenuBackdrop}
          onPress={cancelPendingPhotos}
        >
          <Pressable
            style={styles.confirmCard}
            onPress={(e) => e.stopPropagation()}
          >
            <Text style={styles.confirmTitle}>
              {pendingPhotos.length === 1
                ? 'Upload 1 screenshot?'
                : `Upload ${pendingPhotos.length} screenshots?`}
            </Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.confirmThumbs}
            >
              {pendingPhotos.map((p, i) => (
                <Image
                  key={`${p.uri}-${i}`}
                  source={{ uri: p.uri }}
                  style={styles.confirmThumb}
                  resizeMode="cover"
                />
              ))}
            </ScrollView>
            <View style={styles.confirmActions}>
              <TouchableOpacity
                style={styles.confirmBtnSecondary}
                onPress={cancelPendingPhotos}
                activeOpacity={0.7}
              >
                <Text style={styles.confirmBtnSecondaryText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.confirmBtnPrimary}
                onPress={confirmUploadScreenshots}
                activeOpacity={0.8}
              >
                <Text style={styles.confirmBtnPrimaryText}>
                  Upload {pendingPhotos.length}
                </Text>
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {/* v78 #3 / v196.1: AR init / low-light overlay.
          - 'init' is now a light pill at top, NEVER blocks the camera
            feed — user sees the scene warming up rather than a dark card.
          - 'low-light' still uses full-screen backdrop because user
            action is required (Retry). */}
      {arInitState !== 'ready' && (
        arInitState === 'phone-flat' ? (
          <View style={styles.phoneFlatPill} pointerEvents="none">
            <Text style={styles.phoneFlatPillText}>
              Hold your phone upright to plant cairns
            </Text>
          </View>
        ) : arInitState === 'init' ? (
          // v196.1: lightweight init pill, transparent to touches, lives
          // under the topbar. The camera feed renders behind it so the
          // perceived "loading" feels like just a brief hint, not a
          // blocking modal.
          <View style={styles.phoneFlatPill} pointerEvents="none">
            <ActivityIndicator size="small" color={Colors.primary} style={{ marginRight: 8 }} />
            <Text style={styles.phoneFlatPillText}>Looking around…</Text>
          </View>
        ) : (
          // 'low-light' — blocking, requires user retry.
          <View style={styles.arInitOverlay} pointerEvents="auto">
            <View style={styles.arInitCard}>
              <Text style={styles.arInitTitle}>Low light or featureless area</Text>
              <Text style={styles.arInitBody}>
                AR needs visible texture and light to anchor flags. Try a
                brighter spot or point at the ground / a wall with detail.
              </Text>
              <TouchableOpacity style={styles.arInitRetry} onPress={retryAr} activeOpacity={0.7}>
                <Text style={styles.arInitRetryText}>Retry</Text>
              </TouchableOpacity>
            </View>
          </View>
        )
      )}

      {/* v64: ARKit-driven edge arrows + distance labels. Replaces the
          old magnetic-compass dial because the dial's heading source
          (expo-location magHeading) drifts vs ARKit's worldAlignment
          true-north fusion, leading to "球在前 指向在后" complaints.
          Edge arrows use the same camera transform that draws the 3D
          spheres, so direction is always consistent with what the user
          sees. */}
      <CairnEdgeArrows camera={arFrame.camera} cairns={arFrame.cairns} />

      {/* v70: marker panel — each row tappable to toggle a vertical light
          beam on that cairn (helps locate it from a distance). pointerEvents
          changed from "none" to "box-none" so the panel itself is
          transparent to gestures (lets the 3D view receive them) but
          individual rows can still be tapped. */}
      <View pointerEvents="box-none" style={StyleSheet.absoluteFillObject}>
        <GlassPanel intensity={16} tint="dark" style={styles.markerPanel} borderRadius={16}>
        <Text style={styles.panelTitle}>
          {nearbyMarkers.length} marker{nearbyMarkers.length !== 1 ? 's' : ''} nearby
        </Text>
        {nearbyMarkers.slice(0, 5).map(m => {
          const dist = lastCoord
            ? Math.round(haversineM({ lat: lastCoord.lat, lng: lastCoord.lng }, { lat: m.lat, lng: m.lng }))
            : 0;
          const config = getAR3DConfig(m.type);
          const isBeaming = beamingId === m.id;
          return (
            <TouchableOpacity
              key={m.id}
              activeOpacity={0.7}
              onPress={() => handleBeamToggle(m.id)}
              style={styles.markerRow}
            >
              <View style={[styles.markerDot, { backgroundColor: config.color }]} />
              <Text style={styles.markerLabel}>{config.label}</Text>
              <Text style={styles.markerDist}>{dist}m</Text>
              <Icon
                name={isBeaming ? 'Square' : 'Flag'}
                size={16}
                color={isBeaming ? config.color : 'rgba(255,255,255,0.55)'}
                strokeWidth={2}
              />
            </TouchableOpacity>
          );
        })}
        </GlassPanel>
      </View>

      {/* Top controls — pill BackButton matching Hiking / Settings /
          Routes screens for consistent navigation language. The X icon
          previously used here felt like a modal-close, but AR is a
          regular nav screen, not a modal. */}
      <View style={[styles.topBar, { top: insets.top + 2 }]}>
        <BackButton variant="pill" onPress={() => onClose ? onClose() : nav.goBack()} />
        {/* v195.1 — Photo upload trigger. Replaces the deprecated 📍 reset-
            location button (AR origin works correctly, manual reset no
            longer needed). Tapping opens the iOS multi-select photo picker
            directly. The OTA-params menu and text-diagnostic upload were
            removed in v195.1: tuning is done by the dev based on uploaded
            screenshots, not by the user. Single-action button keeps the
            UX trivial. Will be removed once visual issues are fully
            resolved. */}
        <TouchableOpacity
          style={styles.arResetBtn}
          onPress={pickScreenshots}
          activeOpacity={0.7}
        >
          <Text style={styles.arResetBtnText}>📸</Text>
        </TouchableOpacity>
        {/* v186: ritual mode toggle removed — Unity is the single AR
            path so there's no longer an A/B between sphere/ritual. */}

        {/* v195.1: simplified to a single status pill — no more menu, no
            more text-log upload. Pill shows "picking…" → "1/3…" →
            "3 uploaded" / "✗ <err>" lifecycle for the photo upload. */}
        {/* Persistent message strip below the buttons so user can read
            success/error without losing focus on AR view */}
        {snapState !== 'idle' && (
          <View style={styles.debugSnapMsg}>
            <Text style={styles.debugSnapMsgText}>
              {snapState === 'busy' ? (snapMsg || 'capturing...') :
               snapState === 'done' ? `✓ ${snapMsg}` :
               `✗ ${snapMsg}`}
            </Text>
          </View>
        )}
      </View>

      {/* Drag-to-plant cairn picker — replaces the previous Place Flag FAB
          + flag-type sheet. 4 corner anchors (Danger / Scenic / Water /
          Junction); user long-presses → drags one to centre to plant.
          Distance defaults to 5m and can be adjusted by continuing to
          hold + sliding vertically (5/10/20/30m, 30m hard cap). */}
      {/* v22: bottom plant sheet — replaces the v18-v21 DragCairnPicker.
          Two pages: pick type → enter title → tap "Aim & Plant".
          A small reticle stays at screen centre showing the aim point;
          when the user taps Aim & Plant, the reticle squeezes for 1.2s
          then planting fires with a distance computed from the device's
          pitch (looking down = close, looking forward = up to 30m).
          Sheet height is ~16% of screen so AR view stays visible. */}
      <PlantSheet
        onPlant={handlePlantFromSheet}
        onAimStart={() => {
          setShutterFiring(true);
          // Auto-reset slightly after the animation duration (1.3s)
          setTimeout(() => setShutterFiring(false), 1400);
        }}
        // Disable plant when:
        //   1. No GPS at all (existing rule — can't compute lat/lng)
        //   2. AR not yet ready (would plant before ARKit world tracking
        //      converged — cairn would land at fallback position)
        //   3. Phone-flat is NO LONGER blocked here (v196.1) — the
        //      threshold was miscalibrated and rejected normal use. The
        //      coaching pill still shows when truly flat; hit-test
        //      fallback handles bad poses naturally.
        disabled={
          (!lastCoord && trackPoints.length === 0)
          || arInitState === 'init'
          || arInitState === 'low-light'
          // v199 §F.2 + V2.C10: PlantSheet hidden / disabled when aim
          // hook is locked on an existing cairn (planting + reporting
          // are different intents — mutual exclusion).
          || aimHook.uiState === 'aim-locked'
          // v0.2.3 Stage 4 — A4 FSM gate: button only enabled when
          // arOriginLocked AND A1=LOCKED AND 0.5s anti-thrash. User
          // product decision 2026-06-11 (overrides V2-CONFLICT-3):
          // Pokemon-GO style — AR must be stable before plant.
          || !a4PlantEnabled
        }
        disabledReason={a4DisabledReason}
        reticleScale={reticleScale}
      />
      <AimReticle scale={reticleScale} />
      {/* v68: viewport-level lock-on shutter. Plays scan-ring shockwave
          + flash when the user taps Aim & Plant — synced with PlantSheet's
          reticle squeeze. */}
      <AimShutter firing={shutterFiring} />

      {/* v199 §F.2 + V2.C10: LikeReportSheet — mounts when aim hook
          locks on a marker (camera held steady on cairn for 600ms,
          within 30m). Replaces PlantSheet's bottom slot. Version-gated
          on app.version >= 0.2.1 per V2.C8 so v0.2.0 binaries running
          v203+ OTA bundles don't show this UI without the corresponding
          Unity LikeBadge handler. */}
      {_likeReportSupported && aimHook.uiState === 'aim-locked' && aimHook.lockedMarkerId && (() => {
        const m = markers.find(mk => mk.id === aimHook.lockedMarkerId);
        if (!m) return null;
        return (
          <LikeReportSheet
            markerId={String(m.id)}
            markerType={m.type ?? 'unknown'}
            markerNote={m.note ?? ''}
            distanceM={aimHook.candidateDistM}
            userPos={lastCoord ? {
              lat: lastCoord.lat,
              lng: lastCoord.lng,
              accuracy: lastCoord.accuracy ?? null,
            } : null}
            arInteractRangeM={30}
            getAuthToken={async () => {
              try {
                const m = await import('../services/tokenStore');
                return await m.getToken();
              } catch {
                return null;
              }
            }}
            onDismiss={() => {
              // No reset hook — useAimedMarker re-evaluates next frame
              // based on camera position. User points away → state goes
              // back to idle naturally.
            }}
          />
        );
      })()}

      {/* v199 aim-pending hint pill — only on aim-pending (between idle
          and aim-locked). Disappears the moment lock fires. */}
      {_likeReportSupported && aimHook.uiState === 'aim-pending' && (
        <View pointerEvents="none" style={[styles.phoneFlatPill, { top: 110 }]}>
          <Text style={styles.phoneFlatPillText}>
            Hold to lock target… {Math.round(aimHook.holdProgress * 100)}%
          </Text>
        </View>
      )}

      {/* Degraded GPS toast */}
      {degradedToast && (
        <View style={styles.degradedBanner}>
          <Icon name="Info" size={14} color="#f59e0b" />
          <Text style={styles.degradedText}>{degradedToast}</Text>
        </View>
      )}

      {/* Branch B v3-review-fix: plant-rejected toast (no floor / anchor failed) */}
      {plantRejectedToast && (
        <View style={styles.degradedBanner}>
          <Icon name="Info" size={14} color="#ff7866" />
          <Text style={styles.degradedText}>{plantRejectedToast}</Text>
        </View>
      )}

      {/* Saved toast */}
      {savedToast && (
        <View style={styles.savedToast}>
          <Icon name="CircleCheck" size={16} color="#22c55e" />
          <Text style={styles.savedToastText}>Cairn planted</Text>
        </View>
      )}
    </View>
  );
}

// ── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' /* fallback when no camera */ },
  // v78 #3: AR init + low-light overlay. Centered card on a dark
  // semi-transparent background so it reads against either the camera
  // feed (when permission granted) or the dark backdrop.
  arInitOverlay: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: Spacing.lg,
  },
  arInitCard: {
    backgroundColor: 'rgba(20,20,28,0.92)',
    borderRadius: Radius.card,
    paddingVertical: Spacing.lg, paddingHorizontal: Spacing.lg,
    alignItems: 'center', gap: Spacing.sm,
    maxWidth: 320,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)',
  },
  arInitTitle: { fontSize: FontSize.h3, fontWeight: '700', color: '#fff', textAlign: 'center' },
  arInitBody: { fontSize: FontSize.caption, color: 'rgba(255,255,255,0.75)', textAlign: 'center', lineHeight: 18 },
  arInitRetry: {
    marginTop: Spacing.sm,
    backgroundColor: Colors.primary,
    paddingHorizontal: Spacing.lg, paddingVertical: 10,
    borderRadius: Radius.pill ?? 999,
  },
  arInitRetryText: { color: '#fff', fontWeight: '700', fontSize: FontSize.body },
  // Phone-flat coaching pill — non-blocking banner near the top of the
  // screen. Translucent dark background so the camera feed stays visible
  // through it. Styled to match the OtaBadge floating pill aesthetic.
  // Top offset accounts for status bar; if you want safe-area precise
  // positioning, wrap in SafeAreaView upstream — kept absolute here so
  // it doesn't reflow when present/absent.
  phoneFlatPill: {
    position: 'absolute', top: 64, alignSelf: 'center',
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: 'rgba(20,20,28,0.92)',
    paddingHorizontal: 18, paddingVertical: 10,
    borderRadius: 999,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.10)',
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.20, shadowRadius: 10, elevation: 4,
    maxWidth: '85%',
  },
  phoneFlatPillText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'center',
    letterSpacing: 0.2,
  },
  cameraPlaceholder: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#1a1a2e',
  },
  placeholderText: {
    fontSize: FontSize.h2, fontWeight: '700', color: 'rgba(255,255,255,0.7)',
    marginTop: Spacing.md,
  },
  placeholderSubtext: {
    fontSize: FontSize.caption, color: 'rgba(255,255,255,0.4)',
    textAlign: 'center', marginTop: Spacing.xs,
  },
  markerPanel: {
    position: 'absolute', bottom: 100, left: Spacing.md, right: Spacing.md,
    padding: Spacing.md,
  },
  panelTitle: {
    fontSize: FontSize.caption, fontWeight: '600', color: 'rgba(255,255,255,0.8)',
    marginBottom: Spacing.sm,
  },
  markerRow: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    paddingVertical: 4,
  },
  markerDot: { width: 10, height: 10, borderRadius: 5 },
  markerLabel: { flex: 1, fontSize: FontSize.body, color: '#fff' },
  markerDist: { fontSize: FontSize.caption, color: 'rgba(255,255,255,0.6)' },
  topBar: {
    position: 'absolute', left: Spacing.md, right: Spacing.md,
    // Left-aligned to match HikingScreen / RoutesScreen / SettingsScreen
    // (consistent navigation pattern across the app — back button on
    // the left, like every native iOS/Android nav bar). Was flex-end
    // (right side) in v17 which felt foreign on AR.
    flexDirection: 'row', justifyContent: 'flex-start',
  },
  closeBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center',
  },
  // Ritual-mode toggle pill — right side of topBar.
  ritualToggle: {
    marginLeft: 'auto',
    paddingHorizontal: 12, paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)',
  },
  arResetBtn: {
    marginLeft: 'auto',
    width: 36, height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center', justifyContent: 'center',
  },
  arResetBtnText: {
    fontSize: 16,
  },
  ritualToggleActive: {
    backgroundColor: 'rgba(212,160,80,0.25)',
    borderColor: 'rgba(212,160,80,0.7)',
  },
  ritualToggleText: {
    color: '#fff', fontSize: 12, fontWeight: '600',
  },
  // Debug snapshot button (shown only in ritual mode for now).
  debugSnapBtn: {
    marginLeft: 8,
    width: 36, height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(220,40,40,0.7)',
    alignItems: 'center', justifyContent: 'center',
  },
  debugSnapBtnBusy: {
    backgroundColor: 'rgba(120,120,120,0.7)',
  },
  debugSnapBtnDone: {
    backgroundColor: 'rgba(50,170,80,0.85)',
  },
  debugSnapBtnErr: {
    backgroundColor: 'rgba(180,40,40,0.85)',
  },
  debugSnapBtnText: {
    fontSize: 18, color: '#fff',
  },
  // Floating status pill below the topBar buttons. Only visible while
  // snap state != idle. Auto-hides after 4s along with the icon revert.
  debugSnapMsg: {
    position: 'absolute',
    top: 48, right: 0,
    backgroundColor: 'rgba(0,0,0,0.7)',
    paddingHorizontal: 10, paddingVertical: 4,
    borderRadius: 12,
  },
  debugSnapMsgText: {
    color: '#fff', fontSize: 11, fontWeight: '500',
  },
  // v195.1 — confirm-sheet backdrop (full-screen translucent). Used only
  // by the photo confirm modal now (debug action sheet was removed).
  debugMenuBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  // v194.1 — confirm sheet for multi-select photo upload
  confirmCard: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: '#1a1c24',
    borderRadius: 16,
    paddingHorizontal: 18,
    paddingTop: 18,
    paddingBottom: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  confirmTitle: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 12,
  },
  confirmThumbs: {
    gap: 8,
    paddingBottom: 4,
    paddingRight: 4,
  },
  confirmThumb: {
    width: 70,
    height: 100,
    borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.05)',
  },
  confirmActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
    marginTop: 14,
  },
  confirmBtnSecondary: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 10,
  },
  confirmBtnSecondaryText: {
    color: 'rgba(255,255,255,0.65)',
    fontSize: 14,
    fontWeight: '600',
  },
  confirmBtnPrimary: {
    backgroundColor: Colors.primary,
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 10,
  },
  confirmBtnPrimaryText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
  },
  placeFab: {
    position: 'absolute', bottom: 30, alignSelf: 'center',
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    backgroundColor: Colors.primary, borderRadius: 30,
    paddingHorizontal: Spacing.xl, paddingVertical: Spacing.md,
    ...Elevation[4],
  },
  fabText: { fontSize: FontSize.body, fontWeight: '700', color: '#fff' },
  degradedBanner: {
    position: 'absolute', top: 110, left: Spacing.md, right: Spacing.md,
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    backgroundColor: 'rgba(245,158,11,0.15)', borderRadius: Radius.card,
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm,
    borderWidth: 1, borderColor: 'rgba(245,158,11,0.3)',
  },
  degradedText: { fontSize: FontSize.caption, color: '#f59e0b', flex: 1 },
  flagSheet: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    backgroundColor: '#1a1a2e', borderTopLeftRadius: 20, borderTopRightRadius: 20,
    padding: Spacing.xl, paddingBottom: 40,
  },
  flagSheetTitle: { fontSize: FontSize.h3, fontWeight: '700', color: '#fff', marginBottom: Spacing.md },
  flagTypeRow: { flexDirection: 'row', gap: Spacing.sm },
  flagTypeCard: {
    flex: 1, alignItems: 'center', gap: 6, paddingVertical: Spacing.md,
    borderRadius: Radius.card, borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.15)',
    backgroundColor: 'rgba(255,255,255,0.05)',
  },
  flagTypeLabel: { fontSize: FontSize.small, fontWeight: '600' },
  approxWarning: {
    flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: Spacing.md,
    paddingHorizontal: Spacing.sm, paddingVertical: 6,
    backgroundColor: 'rgba(245,158,11,0.1)', borderRadius: 8,
  },
  approxWarningText: { fontSize: FontSize.small, color: '#f59e0b' },
  flagSheetActions: { flexDirection: 'row', gap: Spacing.sm, marginTop: Spacing.lg },
  flagCancelBtn: {
    flex: 1, alignItems: 'center', paddingVertical: Spacing.md,
    borderRadius: Radius.button, borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)',
  },
  flagCancelText: { fontSize: FontSize.body, fontWeight: '600', color: 'rgba(255,255,255,0.7)' },
  flagSaveBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: Spacing.md, borderRadius: Radius.button,
    backgroundColor: Colors.primary,
  },
  flagSaveText: { fontSize: FontSize.body, fontWeight: '700', color: '#fff' },
  savedToast: {
    position: 'absolute', top: '45%' as any, alignSelf: 'center',
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    backgroundColor: 'rgba(0,0,0,0.8)', borderRadius: Radius.pill,
    paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md,
  },
  savedToastText: { fontSize: FontSize.body, fontWeight: '600', color: '#fff' },
  // v187 — OTA debug button (small + translucent, top-right corner).
  otaButton: {
    position: 'absolute',
    top: 56,
    right: 14,
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(0,0,0,0.45)',
    borderWidth: 1,
    borderColor: 'rgba(93,211,255,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 50,
  },
  otaButtonGlyph: {
    color: '#5dd3ff',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
});
