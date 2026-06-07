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
import { View, Text, StyleSheet, TouchableOpacity, Alert, Platform, Animated, Dimensions, PanResponder, ActivityIndicator } from 'react-native';
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
import { CairnEdgeArrows } from '../components/CairnEdgeArrows';
import { AimShutter } from '../components/AimShutter';
import { PlantSheet, AimReticle, type PlantType } from '../components/PlantSheet';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { ARDebugOverlay } from '../components/ARDebugOverlay';
import { GlassPanel, Elevation } from '../components/GlassPanel';

import { useMarkerStore, type Marker } from '../store/useMarkerStore';
import { useTrackingStore } from '../store/useTrackingStore';
import { haversineM, type Coordinate } from '../utils/geo';
import { crashLogger } from '../services/crashLogger';
import { markerTypeToColor, markerTypeToShaderParams } from '../services/unityCairnSpawn';
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

interface ARScreenProps {
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


export function ARScreen({ onClose, onPlaceMarker }: ARScreenProps) {
  const nav = useNavigation();
  const insets = useSafeAreaInsets();
  const markers = useMarkerStore(s => s.markers);
  const addMarker = useMarkerStore(s => s.addMarker);
  const lastCoord = useTrackingStore(s => s.lastCoordinate);
  const lastCoordTime = useTrackingStore(s => s.lastCoordinateTime);
  const trackPoints = useTrackingStore(s => s.trackPoints);
  const sessionId = useTrackingStore(s => s.sessionId);
  const linkMarker = useTrackingStore(s => s.linkMarker);

  const [degradedToast, setDegradedToast] = useState<string | null>(null);
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
  // Snapshot UI state machine:
  //   idle  - normal bug emoji
  //   busy  - spinner while takeScreenshot + base64 + telemetry flush
  //   done  - green check for 4s, then auto-revert to idle
  //   err   - red X with error code for 4s, then auto-revert
  const [snapState, setSnapState] = useState<'idle' | 'busy' | 'done' | 'err'>('idle');
  const [snapMsg, setSnapMsg] = useState<string>('');
  // v78 #3: AR init UX. Tracks one of:
  //   'init'       — first 4 seconds, glReady === false. Show spinner.
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
  }>({ camera: null, cairns: [], origin: null, groundY: null });

  // Phone-flat detection: arFrame.camera.forward is the camera's look
  // vector in ARKit world space. y > 0.85 ≈ user holding device roughly
  // horizontal looking up at ceiling (rare). y < -0.85 ≈ device flat on
  // table or facing down (common — "I just put my phone down"). Either
  // extreme means hit-tests will pick wrong planes (ceiling/table) and
  // tracking quality degrades to IMU-only. Threshold 0.85 ≈ 32° from
  // vertical; calibrated by inspecting plant logs where ground=1.01
  // (table top) was hit-tested with fy=-0.52 — already significantly
  // tilted down. 0.85 leaves comfortable headroom for normal "looking
  // at the trail in front of me" usage (typical fy ~ -0.3 to -0.5).
  const isPhoneFlat = (() => {
    const fy = arFrame.camera?.forward?.[1];
    if (fy == null) return false;
    return fy > 0.85 || fy < -0.85;
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
    const t = setTimeout(() => {
      setArInitState(prev => prev === 'ready' ? 'ready' : 'low-light');
    }, 4000);
    return () => clearTimeout(t);
  }, [arStatus.glReady, isPhoneFlat]);

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
    };
  }, []);

  // Filter markers within AR range
  const nearbyMarkers = markers.filter(m => {
    if (!lastCoord) return false;
    const dist = haversineM({ lat: lastCoord.lat, lng: lastCoord.lng }, { lat: m.lat, lng: m.lng });
    return dist <= AR_MAX_RANGE_M;
  });

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

    // Branch 1: Never had GPS
    if (!lastCoord && trackPoints.length === 0) {
      Alert.alert(
        'No GPS Available',
        'GPS has not yet acquired a position. Move to an open area and wait for a GPS fix.',
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
      const arOrigin = arFrame.origin;
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
        if (!usedHitTest) {
          // Fallback: 1m forward at the user's feet ("plant where I stand").
          const horizMag = Math.hypot(fx, fz);
          const FALLBACK_M = 1.0;
          if (horizMag > 0.001) {
            targetX = cx + (fx / horizMag) * FALLBACK_M;
            targetZ = cz + (fz / horizMag) * FALLBACK_M;
          }
          hitDistM = FALLBACK_M;
        }
        // ARKit world (X,Z) → GPS delta (using arkitOrigin's GPS)
        // GravityAndHeading: +X=East, -Z=North
        const dE = targetX;
        const dN = -targetZ;
        cairnLat = arOrigin.lat + dN / 111000;
        cairnLng = arOrigin.lng + dE / (111000 * Math.cos(arOrigin.lat * Math.PI / 180));
        // Phase 2: stash the ARKit world position so we can spawn the cairn
        // in Unity right after addMarker resolves. y = ground if known, else
        // camera y (so the strand stands roughly upright at user height).
        unitySpawnPos = { x: targetX, y: ground ?? cy, z: targetZ };
        crashLogger.breadcrumb(`ar:plant:src=hit-test fy=${fy.toFixed(2)} ground=${ground === null ? 'null' : ground.toFixed(2)} hit=${usedHitTest} dist=${hitDistM.toFixed(2)}m`);
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
        userHeading={userHeading}
        onStatus={setArStatus}
        onArFrame={setArFrame}
        beamingId={beamingId}
        onCairnPress={(id) => {
          crashLogger.breadcrumb(`unity:cairn:press id=${id.slice(-6)}`);
        }}
      />


      {/* v24 on-screen diagnostic — GL ready, cairn count, recent breadcrumbs */}
      <ARDebugOverlay
        cairnCount={arStatus.cairnCount}
        glReady={arStatus.glReady}
        userPos={lastCoord ? { lat: lastCoord.lat, lng: lastCoord.lng } : null}
        userHeading={userHeading}
      />

      {/* v78 #3: AR init / low-light overlay. Lives above the AR scene
          but below other UI chrome. 'init' = transient spinner;
          'low-light' = persistent hint with retry button. Hidden when
          AR has reached glReady. */}
      {arInitState !== 'ready' && (
        arInitState === 'phone-flat' ? (
          // Phone-flat coaching pill — non-blocking, sits at top so the
          // camera view stays visible. The cairns are still rendering
          // (Unity is fine), we just want to nudge the user to lift the
          // phone before they tap plant. Auto-dismisses the moment fy
          // returns inside the threshold (next ArFrame).
          <View style={styles.phoneFlatPill} pointerEvents="none">
            <Text style={styles.phoneFlatPillText}>
              Hold your phone upright to plant cairns
            </Text>
          </View>
        ) : (
          <View style={styles.arInitOverlay} pointerEvents={arInitState === 'low-light' ? 'auto' : 'none'}>
            <View style={styles.arInitCard}>
              {arInitState === 'init' ? (
                <>
                  <ActivityIndicator size="small" color={Colors.primary} />
                  <Text style={styles.arInitTitle}>Initializing AR…</Text>
                  <Text style={styles.arInitBody}>
                    Move your phone slowly to scan the surroundings.
                  </Text>
                </>
              ) : (
                <>
                  <Text style={styles.arInitTitle}>Low light or featureless area</Text>
                  <Text style={styles.arInitBody}>
                    AR needs visible texture and light to anchor flags. Try a
                    brighter spot or point at the ground / a wall with detail.
                  </Text>
                  <TouchableOpacity style={styles.arInitRetry} onPress={retryAr} activeOpacity={0.7}>
                    <Text style={styles.arInitRetryText}>Retry</Text>
                  </TouchableOpacity>
                </>
              )}
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
        {/* v153.1: Manual AR-origin reset.
            arOrigin is persisted in MMKV across sessions (v118 design — keeps
            markers from drifting between app launches at the same location).
            But when user changes location (home → office), the persisted home
            origin is still used to convert ARKit world → GPS, putting all
            new plants ~15km away from the user.
            We deliberately don't auto-detect this (user wanted no hardcode /
            no auto-judgement). Instead: user taps the 📍 button to explicitly
            clear AR origin, then plant the next marker — that re-locks the
            origin at the current GPS. One-tap fix, user-controlled. */}
        <TouchableOpacity
          style={styles.arResetBtn}
          onPress={() => {
            useMarkerStore.getState().clearArOrigin();
            Alert.alert(
              'AR origin reset',
              'Your AR world is now anchored to your current location. Plant a marker to lock it.',
            );
          }}
          activeOpacity={0.7}
        >
          <Text style={styles.arResetBtnText}>📍</Text>
        </TouchableOpacity>
        {/* v186: ritual mode toggle removed — Unity is the single AR
            path so there's no longer an A/B between sphere/ritual. */}

        {/* Debug snapshot button — Unity AR diagnostic upload. */}
        <TouchableOpacity
          style={[
            styles.debugSnapBtn,
            snapState === 'busy' && styles.debugSnapBtnBusy,
            snapState === 'done' && styles.debugSnapBtnDone,
            snapState === 'err'  && styles.debugSnapBtnErr,
          ]}
          disabled={snapState !== 'idle'}
          onPress={async () => {
            setSnapState('busy');
            setSnapMsg('');
            try {
              crashLogger.breadcrumb(`unity-debug:manual-snap glReady=${arStatus.glReady}`);
              const sessionId = await crashLogger.uploadDiagnostic(API_BASE_URL, 'unity-manual-snap');
              setSnapState('done');
              setSnapMsg(sessionId.slice(-12));
            } catch (e: any) {
              setSnapState('err');
              setSnapMsg(e?.message ?? 'crash');
            }
            setTimeout(() => { setSnapState('idle'); setSnapMsg(''); }, 4000);
          }}
          activeOpacity={0.7}
        >
          {snapState === 'busy' ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Text style={styles.debugSnapBtnText}>
              {snapState === 'done' ? '✓' : snapState === 'err' ? '✗' : '🐛'}
            </Text>
          )}
        </TouchableOpacity>
        {/* Persistent message strip below the buttons so user can read
            success/error without losing focus on AR view */}
        {snapState !== 'idle' && (
          <View style={styles.debugSnapMsg}>
            <Text style={styles.debugSnapMsgText}>
              {snapState === 'busy' ? 'capturing...' :
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
        //   3. Phone is flat (would hit-test against table/ceiling
        //      instead of floor — known visual-shift bug pre-fix)
        disabled={
          (!lastCoord && trackPoints.length === 0)
          || arInitState === 'init'
          || arInitState === 'low-light'
          || arInitState === 'phone-flat'
        }
        reticleScale={reticleScale}
      />
      <AimReticle scale={reticleScale} />
      {/* v68: viewport-level lock-on shutter. Plays scan-ring shockwave
          + flash when the user taps Aim & Plant — synced with PlantSheet's
          reticle squeeze. */}
      <AimShutter firing={shutterFiring} />

      {/* Degraded GPS toast */}
      {degradedToast && (
        <View style={styles.degradedBanner}>
          <Icon name="Info" size={14} color="#f59e0b" />
          <Text style={styles.degradedText}>{degradedToast}</Text>
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
});
