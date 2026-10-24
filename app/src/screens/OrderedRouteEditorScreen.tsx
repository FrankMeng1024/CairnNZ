import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  useWindowDimensions,
  View,
  type LayoutChangeEvent,
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import * as Location from 'expo-location';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BackButton } from '../components/BackButton';
import { Icon } from '../components/Icon';
import { MapLoadOverlay, type MapLoadState } from '../components/MapLoadOverlay';
import { ModalCard, ModalCardHeader } from '../components/ModalCard';
import { PrimaryButton } from '../components/PrimaryButton';
import { RouteDrawOverlay, type RouteDrawStrokeCapture } from '../components/map/RouteDrawOverlay';
import { CanonicalRouteLayer } from '../components/map/CanonicalRouteLayer';
import { FogLayer } from '../features/memory/components/FogLayer';
import { MemoryFriendPickModal } from '../features/memory/components/MemoryFriendPickModal';
import { useFriendMemoryStore } from '../features/memory/store/useFriendMemoryStore';
import { memoryScopeForNewRoute, type MemoryScope } from '../features/memory/store/useMemoryScopeStore';
import { useMemorySubscriptionsStore } from '../features/memory/store/useMemorySubscriptionsStore';
import { getMapbox } from '../features/memory/services/mapboxAdapter';
import { memoryCoverageViewport, type MemoryCoverageViewport } from '../features/memory/services/memoryCoverageViewport';
import { memoryFogPaintEvidenceReady } from '../features/memory/services/memoryFogReadiness';
import { TrimSlider } from '../components/map/TrimSlider';
import { FontSize, RadiusRole, Spacing } from '../components/tokens';
import { getCurrentRegion } from '../config/regions';
import { buildStandardConfig, getMapStyleForTheme, themeToStandardPreset } from '../config/mapbox';
import { groupedMapOrnamentsAbove } from '../config/mapOrnaments';
import { qualifiedLocationPoint } from '../services/locationFixPolicy';
import { segmentTrace } from '../features/activity/activityContracts';
import { loadActivityFinalArtifact } from '../features/activity/activityFinalArtifact';
import {
  applyDrawTransactionParts,
  classifyDrawTransactionWithDiagnostics,
  routeAttachmentToleranceM,
  type DrawTransactionIntent,
} from '../features/route/routeEditTransactions';
import {
  beginRouteDrawingTrace,
  endRouteDrawingTrace,
  isRouteDrawingDiagnosticsEnabled,
  recordRouteDrawingTrace,
  selectRouteDrawingOperation,
  selectRouteDrawingSessionOperation,
} from '../features/routeDrawing/routeDrawingTrace';
import {
  appendOrderedSegment,
  beginRouteOperation,
  bridgeOrderedGap,
  cloneOrderedDraft,
  commitRouteHistory,
  createEmptyOrderedDraft,
  createImportedOrderedDraft,
  createLegacyOrderedDraft,
  orderedDraftCanUseOrShare,
  orderedDraftDistanceM,
  orderedDraftPoints,
  orderedPositionAtDistanceFraction,
  routeOperationIsCurrent,
  routePointDistanceM,
  setOrderedDraftStart,
  trimOrderedDraft,
  undoRouteHistory,
  type OrderedRouteDraft,
  type RouteDraftHistory,
} from '../features/route/orderedRouteDraft';
import {
  abandonRoutePlannerDraft,
  removeRoutePlannerDraft,
} from '../features/route/routePlannerDraftPersistence';
import {
  activityCreationDraftId,
} from '../features/route/routeCreationSession';
import {
  resolveDrawPlan,
  resolvePointPlan,
  ROUTE_DRAW_TOTAL_DEADLINE_MS,
  type DrawPlanPart,
  type RouteProviderReason,
} from '../features/route/routePlanningProvider';
import { selectPointRouteCandidate } from '../features/route/pointRouteIntent';
import {
  pointCameraStops,
  pointCameraToleranceM,
  pointGrowthDurationMs,
  pointGrowthFrame,
  pointGrowthSample,
  preparePointGrowthTimeline,
} from '../features/route/pointGrowthTimeline';
import { routeMatchesIdentity } from '../features/route/routeContracts';
import { selectActivityRouteImportPoints } from '../features/route/activityRouteImport';
import { canonicalRouteGeometry, type CanonicalRouteGeometry } from '../features/route/canonicalRouteGeometry';
import { buildRouteDisplayGeometry } from '../features/route/routeDisplayGeometry';
import { useMapTheme } from '../hooks/useMapTheme';
import { useVisualTheme } from '../hooks/useVisualTheme';
import { uuidv4 } from '../services/offlineQueue';
import { WALKING_PLAN_TIMEOUT_MS } from '../services/routing/planWalkingRoute';
import { useAppStore } from '../store/useAppStore';
import { useRouteStore, type RoutePoint } from '../store/useRouteStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { loadActivityTrackPoints, useSessionStore } from '../store/useSessionStore';
import { useDistance } from '../utils/distanceFormat';
import {
  createRouteEditorSaveCoordinator,
  executeRouteEditorLeaveChoice,
  routeEditorLeaveDecision,
  type RouteEditorLeaveDecision,
} from '../features/route/routeEditorSaveCoordinator';

let MapView: any = null;
let Camera: any = null;
let ShapeSource: any = null;
let LineLayer: any = null;
let CircleLayer: any = null;
let SymbolLayer: any = null;
let StyleImport: any = null;
let UserLocation: any = null;
if (Platform.OS === 'web') {
  const Mapbox = getMapbox();
  MapView = Mapbox.MapView;
  Camera = Mapbox.Camera;
  ShapeSource = Mapbox.ShapeSource;
  LineLayer = Mapbox.LineLayer;
  CircleLayer = Mapbox.CircleLayer;
  SymbolLayer = Mapbox.SymbolLayer;
  StyleImport = Mapbox.StyleImport ?? null;
  UserLocation = Mapbox.UserLocation;
} else {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Mapbox = require('@rnmapbox/maps');
    MapView = Mapbox.MapView;
    Camera = Mapbox.Camera;
    ShapeSource = Mapbox.ShapeSource;
    LineLayer = Mapbox.LineLayer;
    CircleLayer = Mapbox.CircleLayer;
    SymbolLayer = Mapbox.SymbolLayer;
    StyleImport = Mapbox.StyleImport ?? null;
    UserLocation = Mapbox.UserLocation;
  } catch { /* explicit fallback below */ }
}

type PlannerTool = 'browse' | 'draw' | 'point' | 'trim';
type EditorMode = 'Browse' | 'DrawArmed' | 'Drawing' | 'MatchPending' | 'PointTargeting' | 'TrimPreview' | 'Saving';

type PointTransactionIntent =
  | { kind: 'append' }
  | { kind: 'bridge'; gapId: string };

interface RouteGrowthAnimation {
  key: string;
  hiddenPartId?: string;
  pathPoints: RoutePoint[];
  visiblePointCount: number;
  head: RoutePoint;
  progress: number;
  canonicalOverlap: boolean;
  expectedScreenCenter: { x: number; y: number };
}

interface RouteGrowthFrameHistory {
  count: number;
  atMs: Float64Array;
  progress: Float64Array;
}

const ROUTE_GROWTH_FRAME_HISTORY_CAPACITY = 1_000;
// `setNativeProps` keeps this update outside React reconciliation. Present the
// trim on the display cadence so the visible head and Mapbox camera consume
// the same progress sample; the former 34 ms cap let the camera interpolate
// between two already-stale painted heads.
const ROUTE_GROWTH_PAINT_INTERVAL_MS = 16;
const ROUTE_GROWTH_DENSE_PAINT_INTERVAL_MS = 16;

function createRouteGrowthFrameHistory(): RouteGrowthFrameHistory {
  return {
    count: 0,
    atMs: new Float64Array(ROUTE_GROWTH_FRAME_HISTORY_CAPACITY),
    progress: new Float64Array(ROUTE_GROWTH_FRAME_HISTORY_CAPACITY),
  };
}

function providerReason(reason: RouteProviderReason, providerCode?: string): string {
  if (reason === 'provider-unavailable') {
    if (providerCode === 'NO_TOKEN') return 'Walking routing is not configured. Your Route is unchanged.';
    if (providerCode === 'UNAUTHORIZED') return 'Walking routing authorization failed. Your Route is unchanged.';
    if (providerCode === 'RATE_LIMIT') return 'Walking routing is busy. Try another Point in a moment.';
    if (providerCode === 'NETWORK') return 'Walking routing needs a connection. Your Route is unchanged.';
  }
  switch (reason) {
    case 'no-route': return 'No walkable map segment near this Point or Route end. Move the Point, or Draw this section.';
    case 'no-match': return 'No mapped path fits this drawing. Redraw with clearer attachments.';
    case 'split-match': return 'No mapped path fits this drawing. Your Route is unchanged.';
    case 'endpoint-shift': return 'The mapped result moved an endpoint. Review it before applying.';
    case 'shape-deviation': return 'The mapped result may shortcut the path you drew. Review it first.';
    case 'chunk-seam': return 'No mapped path fits this drawing. Your Route is unchanged.';
    case 'provider-unavailable': return 'Routing is unavailable. Your Route and selection are unchanged.';
    default: return 'This edit could not be used. Your Route is unchanged.';
  }
}

function editFailure(code: string): string {
  switch (code) {
    case 'ZERO_LENGTH': return 'Move farther before confirming this edit.';
    case 'DISCONNECTED': return 'Start at a Route end, or reconnect your stroke to the Route.';
    case 'AMBIGUOUS_INTERVAL': return 'Redraw from clearer positions so Cairn can preserve the right path.';
    case 'DESTRUCTIVE_ACTIVITY_REPLACEMENT': return 'That edit would remove the recorded Activity. Use Point or Draw from the Route end instead.';
    case 'STALE_TRANSACTION': return 'This Route changed. The unfinished stroke was cancelled without changing your Route.';
    case 'INVALID_COORDINATE': return 'The map could not read that position. Your Route is unchanged.';
    default: return 'Your Route is unchanged. Try again while connected.';
  }
}

function elevationGain(draft: OrderedRouteDraft): number {
  return draft.parts.reduce((total, part) => total + part.points.reduce((gain, point, index) => {
    if (index === 0) return gain;
    const previous = part.points[index - 1];
    return typeof point.alt === 'number' && typeof previous.alt === 'number' && point.alt > previous.alt
      ? gain + point.alt - previous.alt
      : gain;
  }, 0), 0);
}

function initialBounds(draft: OrderedRouteDraft): { ne: [number, number]; sw: [number, number] } | null {
  const points = draft.parts.flatMap(part => part.points);
  if (points.length < 2) return null;
  return {
    ne: [Math.max(...points.map(point => point.lng)), Math.max(...points.map(point => point.lat))],
    sw: [Math.min(...points.map(point => point.lng)), Math.min(...points.map(point => point.lat))],
  };
}

type InitialLocationState =
  | { status: 'idle' | 'locating' | 'unavailable' }
  | { status: 'ready'; point: RoutePoint };

const COMPACT_ACTION_HIT_SLOP = { top: 6, bottom: 6, left: 2, right: 2 };

export function OrderedRouteEditorScreen() {
  const nav = useNavigation<any>();
  const screenRoute = useRoute<any>();
  const insets = useSafeAreaInsets();
  const { height: viewportHeight, width: viewportWidth, fontScale } = useWindowDimensions();
  const compactViewport = viewportHeight <= 640;
  const largeType = fontScale >= 1.25;
  const theme = useVisualTheme();
  const mapTheme = useMapTheme();
  const dist = useDistance();
  const params = screenRoute.params ?? {};
  const routeId = params.routeId as string | undefined;
  const fromSessionId = params.fromSessionId as string | undefined;
  const sharedDeliveryId = params.sharedDeliveryId as string | undefined;
  const creationSource = params.creationSource as 'plan' | 'activity' | 'shared-copy' | undefined;
  const creationSessionId = params.creationSessionId as string | undefined;
  const readOnlyShared = Boolean(sharedDeliveryId && creationSource !== 'shared-copy');
  const ownerId = useAppStore(state => String(state.user?.id ?? ''));
  const debugMode = useSettingsStore(state => state.debugMode);
  const sessions = useSessionStore(state => state.sessions);
  const routes = useRouteStore(state => state.routes);
  const sharedRoutes = useRouteStore(state => state.sharedRoutes);
  const addRoute = useRouteStore(state => state.addRoute);
  const updateRoute = useRouteStore(state => state.updateRoute);
  const loadRouteDetail = useRouteStore(state => state.loadRouteDetail);
  const loadSharedRouteDetail = useRouteStore(state => state.loadSharedRouteDetail);
  const removeSharedRoute = useRouteStore(state => state.removeSharedRoute);
  const captureActivityRouteReference = useRouteStore(state => state.captureActivityRouteReference);
  const memorySubscriptions = useMemorySubscriptionsStore(state => state.subscriptions);
  const loadMemorySubscriptions = useMemorySubscriptionsStore(state => state.load);
  const friendMemoryError = useFriendMemoryStore(state => state.error);
  const friendMemorySourceStates = useFriendMemoryStore(state => state.sourceStates);

  const [history, setHistory] = useState<RouteDraftHistory | null>(null);
  const historyRef = useRef<RouteDraftHistory | null>(null);
  const initialDraftRef = useRef<OrderedRouteDraft | null>(null);
  const initialNameRef = useRef('');
  const initialPermissionRef = useRef<'personal' | 'friend'>('personal');
  const saveCoordinatorRef = useRef(createRouteEditorSaveCoordinator());
  const allowLeaveRef = useRef(false);
  const [pendingLeave, setPendingLeave] = useState<{ action: any; decision: RouteEditorLeaveDecision } | null>(null);
  const [name, setName] = useState('');
  const [permission, setPermission] = useState<'personal' | 'friend'>('personal');
  const [mode, setMode] = useState<EditorMode>('Browse');
  const modeRef = useRef<EditorMode>('Browse');
  modeRef.current = mode;
  const [moreOpen, setMoreOpen] = useState(false);
  const [routeFriendPickerOpen, setRouteFriendPickerOpen] = useState(false);
  const [trimStart, setTrimStart] = useState(0);
  const [trimEnd, setTrimEnd] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [initializing, setInitializing] = useState(true);
  const [saving, setSaving] = useState(false);
  const [providerBusy, setProviderBusy] = useState(false);
  const [resolvingDrawPoints, setResolvingDrawPoints] = useState<RoutePoint[]>([]);
  const [pendingPointTarget, setPendingPointTarget] = useState<RoutePoint | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [mapLoadState, setMapLoadState] = useState<MapLoadState>('loading');
  const [mapEpoch, setMapEpoch] = useState(0);
  const [reduceMotion, setReduceMotion] = useState(false);
  // A new editor inherits Memory's current owner-scoped choice exactly once.
  // This is deliberately local state after mount: an active Route session and
  // Memory may then change their displayed scopes independently.
  const [planningMemoryScope, setPlanningMemoryScope] = useState<MemoryScope>(() => (
    !routeId && !readOnlyShared
      ? memoryScopeForNewRoute(useAppStore.getState().user?.id)
      : 'self'
  ));
  const [routeFogPending, setRouteFogPending] = useState(false);
  const [showRouteFogPending, setShowRouteFogPending] = useState(false);
  const [routeFogTargetKey, setRouteFogTargetKey] = useState('');
  const [routeFogReadyKey, setRouteFogReadyKey] = useState('');
  const [routeFogUnavailableKey, setRouteFogUnavailableKey] = useState('');
  const [routeSceneEverReady, setRouteSceneEverReady] = useState(false);
  const routeSceneEverReadyRef = useRef(false);
  const routeSceneIdentityRef = useRef('');
  const routeSceneReadyIdentityRef = useRef('');
  const [memoryCoverageView, setMemoryCoverageView] = useState<MemoryCoverageViewport | null>(null);
  const [routeGrowthAnimation, setRouteGrowthAnimation] = useState<RouteGrowthAnimation | null>(null);
  const routeGrowthAnimationRef = useRef<RouteGrowthAnimation | null>(null);
  const routeGrowthSampleRef = useRef<ReturnType<typeof pointGrowthSample> | null>(null);
  const routeGrowthPaintedSampleRef = useRef<ReturnType<typeof pointGrowthSample> | null>(null);
  const routeGrowthPendingPaintSampleRef = useRef<ReturnType<typeof pointGrowthSample> | null>(null);
  const routeGrowthSourceRef = useRef<any>(null);
  const routeGrowthLineRef = useRef<any>(null);
  const [initialLocation, setInitialLocation] = useState<InitialLocationState>({ status: 'idle' });
  const [locationPermissionGranted, setLocationPermissionGranted] = useState(false);
  const [briefStatus, setBriefStatus] = useState<string | null>(null);
  const [bottomWorkspaceHeight, setBottomWorkspaceHeight] = useState(0);
  const mapViewRef = useRef<any>(null);
  const cameraRef = useRef<any>(null);
  const routeFogTargetKeyRef = useRef('');
  const routeFogGeometryReadyKeyRef = useRef('');
  const routeFogPaintReadyKeyRef = useRef('');
  const routeFogUnavailableCandidateKeyRef = useRef('');
  const routeFogRequiredSourceIdsRef = useRef<string[]>(['memory-fog-src']);
  const cameraCenterRef = useRef<RoutePoint | null>(null);
  const initialBoundsRef = useRef<ReturnType<typeof initialBounds>>(null);
  const operationAbortRef = useRef<AbortController | null>(null);
  const activeOperationIdRef = useRef<string | null>(null);
  // React state alone cannot fence two taps delivered before the next render.
  // This ref is the synchronous owner for the one allowed provider transaction.
  const providerTransactionRef = useRef(false);
  const routeAnimationFrameRef = useRef<number | null>(null);
  const routeAnimationGenerationRef = useRef(0);
  const routePointEntryReadyRef = useRef<(() => void) | null>(null);
  const routePointEntryTargetRef = useRef<RoutePoint | null>(null);
  const routePointEntryArrivedRef = useRef(false);
  const routePointEntryFallbackRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const routeCameraStartTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const routeHandoffTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const routeHandoffRenderReadyRef = useRef(false);
  const routeGrowthLastPaintAtRef = useRef(0);
  // The lightweight Point-motion basemap begins before the provider returns,
  // so its lifetime is wider than the accepted-route reveal animation. Keep
  // independent ownership: cancelling while the request is still pending
  // must restore the normal map even though no animation frame ever started.
  const pointMotionBasemapActiveRef = useRef(false);
  const routeGrowthFrameHistoryRef = useRef<RouteGrowthFrameHistory | null>(null);
  if (!routeGrowthFrameHistoryRef.current) {
    routeGrowthFrameHistoryRef.current = createRouteGrowthFrameHistory();
  }
  const animationTraceBucketRef = useRef(-1);
  const lastAnimationCameraTraceAtRef = useRef(0);
  const initializedKeyRef = useRef('');
  const initializingKeyRef = useRef('');
  const initialLocationAttemptedRef = useRef(false);
  const userMovedCameraRef = useRef(false);
  const cameraZoomRef = useRef(14);
  const cameraBearingRef = useRef(0);
  const cameraPitchRef = useRef(0);
  const cameraGenerationRef = useRef(0);
  const userCameraInteractionGenerationRef = useRef(0);
  const approvedPointTargetRef = useRef<RoutePoint | null>(null);
  const traceDraftIdRef = useRef<string | null>(null);
  const initializationProvenanceRef = useRef('unknown');
  const abandonedDraftIdsRef = useRef(new Set<string>());
  const savedDraftIdsRef = useRef(new Set<string>());
  const editorGenerationRef = useRef(0);
  const canonicalGeometryCacheRef = useRef<{
    key: string;
    geometry: CanonicalRouteGeometry;
  } | null>(null);
  const routeTurnbackCacheRef = useRef<{
    key: string;
    turnbacks: ReturnType<typeof buildRouteDisplayGeometry>['turnConnectors'];
  } | null>(null);
  const tool: PlannerTool = mode === 'DrawArmed' || mode === 'Drawing'
    ? 'draw'
    : mode === 'PointTargeting'
      ? 'point'
      : mode === 'TrimPreview'
        ? 'trim'
        : 'browse';
  const trimOpen = mode === 'TrimPreview';
  const routeFriendProjectionFailure = planningMemoryScope === 'combined' && Boolean(
    friendMemoryError
    || memorySubscriptions.some(subscription => {
      const status = friendMemorySourceStates[String(subscription.friend_id)]?.status;
      return status === 'error';
    }),
  );
  const routeFriendAuthorizationLost = planningMemoryScope === 'combined' && memorySubscriptions.some(
    subscription => friendMemorySourceStates[String(subscription.friend_id)]?.status === 'unauthorized',
  );
  const routeFogExactTerminal = Boolean(routeFogTargetKey) && (
    routeFogReadyKey === routeFogTargetKey
    || routeFogUnavailableKey === routeFogTargetKey
  );
  const routeSceneReady = mapReady && routeFogExactTerminal;
  const setTool = useCallback((next: PlannerTool) => {
    setMode(next === 'draw' ? 'DrawArmed' : next === 'point' ? 'PointTargeting' : next === 'trim' ? 'TrimPreview' : 'Browse');
  }, []);
  const setTrimOpen = useCallback((open: boolean) => {
    setMode(current => open ? 'TrimPreview' : current === 'TrimPreview' ? 'Browse' : current);
  }, []);

  useEffect(() => {
    let mounted = true;
    void AccessibilityInfo.isReduceMotionEnabled().then(value => mounted && setReduceMotion(value));
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => { mounted = false; subscription.remove(); };
  }, []);

  useEffect(() => {
    if (!routeSceneEverReady || !routeFogPending) {
      setShowRouteFogPending(false);
      return undefined;
    }
    const timer = setTimeout(() => setShowRouteFogPending(true), 180);
    return () => clearTimeout(timer);
  }, [routeFogPending, routeSceneEverReady]);

  useEffect(() => {
    let cancelled = false;
    void Location.getForegroundPermissionsAsync()
      .then(result => { if (!cancelled) setLocationPermissionGranted(result.status === 'granted'); })
      .catch(() => { if (!cancelled) setLocationPermissionGranted(false); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!ownerId || readOnlyShared) return undefined;
    let cancelled = false;
    void (async () => {
      const friendMemory = useFriendMemoryStore.getState();
      if (friendMemory.userId !== ownerId && friendMemory.hydrate) {
        await friendMemory.hydrate(ownerId);
      }
      const authorityLoaded = await loadMemorySubscriptions();
      if (cancelled || authorityLoaded === false) return;
    })();
    return () => { cancelled = true; };
  }, [loadMemorySubscriptions, ownerId, readOnlyShared]);

  const setPointMotionBasemapActive = useCallback(async (active: boolean) => {
    pointMotionBasemapActiveRef.current = active;
    try {
      await mapViewRef.current?.setPointMotionBasemapActive?.(active);
    } catch (cause) {
      if (pointMotionBasemapActiveRef.current === active) {
        pointMotionBasemapActiveRef.current = false;
      }
      recordRouteDrawingTrace('route_point_motion_basemap_failed', {
        active,
        error: String(cause).slice(0, 120),
      }, 'state');
    }
  }, []);

  const finishRouteAnimation = useCallback((
    reason: 'complete' | 'superseded' | 'user-camera' | 'tool-switch' | 'undo' | 'camera-action' = 'superseded',
    preserveMotionBasemap = false,
  ) => {
    const hadActiveAnimation = routeGrowthAnimationRef.current !== null;
    routeAnimationGenerationRef.current += 1;
    if (routeAnimationFrameRef.current != null) cancelAnimationFrame(routeAnimationFrameRef.current);
    routeAnimationFrameRef.current = null;
    routePointEntryReadyRef.current = null;
    routePointEntryTargetRef.current = null;
    routePointEntryArrivedRef.current = false;
    if (routePointEntryFallbackRef.current) clearTimeout(routePointEntryFallbackRef.current);
    routePointEntryFallbackRef.current = null;
    if (routeCameraStartTimeoutRef.current) clearTimeout(routeCameraStartTimeoutRef.current);
    routeCameraStartTimeoutRef.current = null;
    if (routeHandoffTimeoutRef.current) clearTimeout(routeHandoffTimeoutRef.current);
    routeHandoffTimeoutRef.current = null;
    // A native map gesture interrupts Mapbox's active transition. Do not send
    // a compensating camera command here: even one duration-0 write can race
    // the gesture and feel like the map pulled back after the user's pan.
    // Non-gesture cancellation does need to stop the active segment easing.
    if (hadActiveAnimation && reason === 'user-camera') {
      // The Web adapter owns a queued multi-stop transition and exposes an
      // explicit cancellation hook. Native Mapbox cancels camera stops when
      // its gesture recognizer takes ownership.
      cameraRef.current?.cancelAnimation?.();
    } else if (hadActiveAnimation && reason !== 'complete') {
      const center = cameraCenterRef.current;
      if (center) {
        cameraRef.current?.setCamera?.({
          centerCoordinate: [center.lng, center.lat],
          zoomLevel: cameraZoomRef.current,
          heading: cameraBearingRef.current,
          pitch: cameraPitchRef.current,
          animationDuration: 0,
        });
      }
    }
    recordRouteDrawingTrace('route_point_animation_ended', { reason }, 'state');
    routeGrowthAnimationRef.current = null;
    routeGrowthSampleRef.current = null;
    routeGrowthPaintedSampleRef.current = null;
    routeGrowthPendingPaintSampleRef.current = null;
    routeHandoffRenderReadyRef.current = false;
    setRouteGrowthAnimation(null);
    if (!preserveMotionBasemap && pointMotionBasemapActiveRef.current) {
      void setPointMotionBasemapActive(false);
    }
  }, [setPointMotionBasemapActive]);

  const invalidatePendingOperation = useCallback(() => {
    if (activeOperationIdRef.current) {
      recordRouteDrawingTrace('route_operation_terminal', {
        operationId: activeOperationIdRef.current,
        outcome: 'cancelled',
        reason: 'tool-switch-or-navigation',
        previousMode: modeRef.current,
        finalMode: 'Browse',
        busyReleased: true,
      }, 'state');
    }
    operationAbortRef.current?.abort();
    operationAbortRef.current = null;
    activeOperationIdRef.current = null;
    providerTransactionRef.current = false;
    finishRouteAnimation('tool-switch');
    setProviderBusy(false);
    setResolvingDrawPoints([]);
    setPendingPointTarget(null);
  }, [finishRouteAnimation]);

  const selectEditorTool = useCallback((next: PlannerTool) => {
    if (saving) return;
    const preservedCamera = {
      center: cameraCenterRef.current,
      zoom: cameraZoomRef.current,
      bearing: cameraBearingRef.current,
      pitch: cameraPitchRef.current,
      generation: cameraGenerationRef.current,
    };
    invalidatePendingOperation();
    setTrimStart(0);
    setTrimEnd(1);
    setError(null);
    setTool(next);
    recordRouteDrawingTrace('route_tool_selected', {
      previousMode: mode,
      tool: next,
      trimFractions: { start: trimStart, end: trimEnd },
      cameraIntent: 'preserve',
      preservedCamera,
    }, 'state');
  }, [invalidatePendingOperation, mode, saving, setTool, trimEnd, trimStart]);

  const animateAcceptedPoint = useCallback((
    points: RoutePoint[],
    hiddenPartId?: string,
    ownsCamera = true,
  ) => {
    finishRouteAnimation('superseded', true);
    const timeline = preparePointGrowthTimeline(points);
    if (!timeline) return;
    const animationTopClearance = insets.top + 60;
    const animationPadding = {
      paddingTop: animationTopClearance,
      paddingRight: 0,
      paddingBottom: bottomWorkspaceHeight || insets.bottom + (compactViewport ? 126 : 138),
      paddingLeft: 0,
    };
    if (reduceMotion) {
      const target = points.at(-1)!;
      if (ownsCamera) {
        cameraRef.current?.setCamera?.({
          centerCoordinate: [target.lng, target.lat],
          padding: animationPadding,
          zoomLevel: cameraZoomRef.current,
          heading: cameraBearingRef.current,
          pitch: cameraPitchRef.current,
          animationDuration: 160,
        });
      }
      recordRouteDrawingTrace('route_point_reduced_motion_transition', {
        target,
        durationMs: ownsCamera ? 160 : 0,
        ownsCamera,
      }, 'state');
      return;
    }
    const durationMs = pointGrowthDurationMs(points);
    const cameraToleranceM = pointCameraToleranceM(points, cameraZoomRef.current);
    const cameraStops = pointCameraStops(timeline, cameraToleranceM);
    // Dense provider geometry costs more for Mapbox to trim even though the
    // paint update is imperative. Give those lines a slightly larger slice;
    // ordinary paths stay closer to the display cadence for head/camera sync.
    const growthPaintIntervalMs = timeline.points.length > 30
      ? ROUTE_GROWTH_DENSE_PAINT_INTERVAL_MS
      : ROUTE_GROWTH_PAINT_INTERVAL_MS;
    const entryDurationMs = ownsCamera
      && routePointDistanceM(points[0], cameraCenterRef.current ?? points[0]) > 4 ? 180 : 0;
    const cameraFollowLagMs = 0;
    const key = uuidv4();
    const animationGeneration = routeAnimationGenerationRef.current;
    const initialFrame = pointGrowthFrame(timeline, 0);
    if (!initialFrame) return;
    animationTraceBucketRef.current = -1;
    const initialAnimation = {
      key,
      hiddenPartId,
      pathPoints: timeline.points,
      visiblePointCount: initialFrame.visiblePoints.length,
      head: initialFrame.head,
      progress: 0,
      canonicalOverlap: false,
      expectedScreenCenter: {
        x: viewportWidth / 2,
        y: animationTopClearance + (viewportHeight - animationTopClearance - animationPadding.paddingBottom) / 2,
      },
    };
    routeGrowthLastPaintAtRef.current = 0;
    const frameHistory = routeGrowthFrameHistoryRef.current!;
    frameHistory.count = 1;
    frameHistory.atMs[0] = performance.now();
    frameHistory.progress[0] = 0;
    routeGrowthAnimationRef.current = initialAnimation;
    routeGrowthSampleRef.current = {
      progress: 0,
      head: initialAnimation.head,
      visiblePointCount: initialAnimation.visiblePointCount,
      travelledM: 0,
      totalM: timeline.totalM,
    };
    routeGrowthPaintedSampleRef.current = {
      progress: 0,
      head: { ...initialAnimation.head },
      visiblePointCount: initialAnimation.visiblePointCount,
      travelledM: 0,
      totalM: timeline.totalM,
    };
    routeGrowthPendingPaintSampleRef.current = null;
    setRouteGrowthAnimation(initialAnimation);
    recordRouteDrawingTrace('route_point_animation_started', {
      animationId: key,
      durationMs,
      pointCount: points.length,
      totalM: initialFrame.totalM,
      providerPointCount: points.length,
      cameraStopCount: cameraStops.length,
      cameraToleranceM,
      zoom: cameraZoomRef.current,
      bearing: cameraBearingRef.current,
      pitch: cameraPitchRef.current,
      entryDurationMs,
      cameraFollowLagMs,
      ownsCamera,
      unobscuredCenter: {
        x: viewportWidth / 2,
        y: animationTopClearance + (viewportHeight - animationTopClearance - animationPadding.paddingBottom) / 2,
      },
    }, 'state');
    const cameraFollowDurationMs = durationMs;
    const cameraSequence = cameraStops.slice(1).map((stop, index) => ({
        centerCoordinate: [stop.point.lng, stop.point.lat],
        padding: animationPadding,
        zoomLevel: cameraZoomRef.current,
        heading: cameraBearingRef.current,
        pitch: cameraPitchRef.current,
        animationMode: 'linearTo' as const,
        animationDuration: cameraFollowDurationMs * (
          stop.progress - (cameraStops[index]?.progress ?? 0)
        ),
      }));
    let startedAt = 0;
    const publishCanonicalOverlap = () => {
      routeHandoffTimeoutRef.current = null;
      if (routeAnimationGenerationRef.current !== animationGeneration) return;
      if (routeAnimationFrameRef.current != null) cancelAnimationFrame(routeAnimationFrameRef.current);
      routeAnimationFrameRef.current = null;
      const finalFrame = pointGrowthSample(timeline, 1, routeGrowthSampleRef.current ?? undefined);
      routeGrowthSampleRef.current = finalFrame;
      routeGrowthPendingPaintSampleRef.current = {
        progress: 1,
        head: { ...finalFrame.head },
        visiblePointCount: finalFrame.visiblePointCount,
        travelledM: finalFrame.travelledM,
        totalM: finalFrame.totalM,
      };
      if (routeGrowthLineRef.current?.setNativeProps) {
        routeGrowthLineRef.current.setNativeProps({ style: { lineTrimOffset: [1, 1] } });
      } else if (routeGrowthSourceRef.current?.setNativeProps) {
        routeGrowthSourceRef.current.setNativeProps({
          shape: JSON.stringify({
            type: 'Feature',
            properties: {},
            geometry: {
              type: 'LineString',
              coordinates: timeline.points.map(point => [point.lng, point.lat]),
            },
          }),
        });
      }
      const activeAnimation = routeGrowthAnimationRef.current ?? initialAnimation;
      const overlapAnimation = {
        ...activeAnimation,
        visiblePointCount: finalFrame.visiblePointCount,
        head: finalFrame.head,
        progress: 1,
        canonicalOverlap: true,
      };
      routeGrowthAnimationRef.current = overlapAnimation;
      setRouteGrowthAnimation(overlapAnimation);
      routeHandoffRenderReadyRef.current = false;
      routeAnimationFrameRef.current = requestAnimationFrame(() => {
        if (routeAnimationGenerationRef.current !== animationGeneration) return;
        routeAnimationFrameRef.current = null;
        routeHandoffRenderReadyRef.current = true;
        mapViewRef.current?.requestRender?.();
      });
      // Native/Web normally acknowledge the very next fully rendered Mapbox
      // frame. Keep a bounded fallback for SDKs that omit the callback; the
      // transient and canonical lines are identical during this interval.
      routeHandoffTimeoutRef.current = setTimeout(() => {
        routeHandoffTimeoutRef.current = null;
        if (routeAnimationGenerationRef.current === animationGeneration
          && routeGrowthAnimationRef.current?.key === key
          && routeGrowthAnimationRef.current.canonicalOverlap) {
          finishRouteAnimation('complete');
        }
      }, 180);
    };
    const tick = () => {
      if (routeAnimationGenerationRef.current !== animationGeneration) return;
      const now = performance.now();
      if (now < startedAt) {
        routeAnimationFrameRef.current = requestAnimationFrame(tick);
        return;
      }
      const elapsed = now - startedAt;
      const progress = Math.min(1, elapsed / durationMs);
      const activeFrameHistory = routeGrowthFrameHistoryRef.current!;
      if (debugMode && Platform.OS === 'web' && activeFrameHistory.count < ROUTE_GROWTH_FRAME_HISTORY_CAPACITY) {
        const index = activeFrameHistory.count;
        activeFrameHistory.atMs[index] = now;
        activeFrameHistory.progress[index] = progress;
        activeFrameHistory.count = index + 1;
      }
      const activeAnimation = routeGrowthAnimationRef.current;
      const frame = pointGrowthSample(timeline, progress, routeGrowthSampleRef.current ?? undefined);
      routeGrowthSampleRef.current = frame;
      if (!frame) { finishRouteAnimation('complete'); return; }
      const nextAnimation = activeAnimation ?? initialAnimation;
      nextAnimation.visiblePointCount = frame.visiblePointCount;
      nextAnimation.head = frame.head;
      nextAnimation.progress = progress;
      routeGrowthAnimationRef.current = nextAnimation;
      // `setNativeProps` avoids a React render and updates only on the display
      // cadence. Keeping this sample aligned with the camera clock prevents a
      // stale 30 fps trim from making the camera visibly outrun the route head.
      const shouldPaintGrowth = (progress >= 1 && (routeGrowthPaintedSampleRef.current?.progress ?? 0) < 1)
        || elapsed - routeGrowthLastPaintAtRef.current >= growthPaintIntervalMs;
      if (shouldPaintGrowth && routeGrowthLineRef.current?.setNativeProps) {
        routeGrowthLineRef.current.setNativeProps({ style: { lineTrimOffset: [progress, 1] } });
        routeGrowthLastPaintAtRef.current = elapsed;
      } else if (shouldPaintGrowth && routeGrowthSourceRef.current?.setNativeProps) {
        // Compatibility fallback for a runtime whose line layer does not
        // expose native paint updates. This keeps the feature functional,
        // while current iOS/Mapbox and Web use the cheaper trim property.
        const visiblePoints = [
          ...timeline.points.slice(0, Math.max(1, frame.visiblePointCount - 1)),
          frame.head,
        ];
        const nextGrowthFeature = {
          type: 'Feature' as const,
          properties: {},
          geometry: {
            type: 'LineString' as const,
            coordinates: visiblePoints.map(point => [point.lng, point.lat]),
          },
        };
        routeGrowthSourceRef.current.setNativeProps({ shape: JSON.stringify(nextGrowthFeature) });
        routeGrowthLastPaintAtRef.current = elapsed;
      } else if (!routeGrowthSourceRef.current?.setNativeProps) {
        setRouteGrowthAnimation(current => current?.key === key ? nextAnimation : current);
      }
      if (shouldPaintGrowth) {
        routeGrowthPendingPaintSampleRef.current = {
          progress: frame.progress,
          head: { ...frame.head },
          visiblePointCount: frame.visiblePointCount,
          travelledM: frame.travelledM,
          totalM: frame.totalM,
        };
      }
      const bucket = Math.min(4, Math.floor(progress * 4));
      if (bucket !== animationTraceBucketRef.current) {
        animationTraceBucketRef.current = bucket;
        recordRouteDrawingTrace('route_point_animation_frame', {
          animationId: key,
          progress,
          travelledM: frame.travelledM,
          totalM: frame.totalM,
          head: { ...frame.head },
          cameraCommand: {
            reason: 'arc-length-simplified-keyframes',
            stopIndex: null,
            stopCount: cameraStops.length,
          },
        }, 'state');
      }
      if (progress >= 1) {
        routeAnimationFrameRef.current = null;
        return;
      }
      routeAnimationFrameRef.current = requestAnimationFrame(tick);
    };
    const beginFollowing = () => {
      if (routeAnimationGenerationRef.current !== animationGeneration
        || routePointEntryReadyRef.current === null && startedAt > 0) return;
      routePointEntryReadyRef.current = null;
      routePointEntryTargetRef.current = null;
      routePointEntryArrivedRef.current = false;
      if (routePointEntryFallbackRef.current) clearTimeout(routePointEntryFallbackRef.current);
      routePointEntryFallbackRef.current = null;
      startedAt = performance.now();
      routeAnimationFrameRef.current = requestAnimationFrame(tick);
      routeHandoffTimeoutRef.current = setTimeout(
        publishCanonicalOverlap,
        durationMs + cameraFollowLagMs,
      );
      if (ownsCamera) {
        routeCameraStartTimeoutRef.current = setTimeout(() => {
          routeCameraStartTimeoutRef.current = null;
          if (routeAnimationGenerationRef.current !== animationGeneration) return;
          cameraRef.current?.setCamera?.({ stops: cameraSequence });
        }, cameraFollowLagMs);
      }
      recordRouteDrawingTrace('route_point_animation_camera_sequence', {
        animationId: key,
        stopCount: cameraSequence.length,
        entryDurationMs,
        cameraFollowLagMs,
        ownsCamera,
        entryAuthority: entryDurationMs > 0 ? 'map-idle-or-bounded-fallback' : 'already-centered',
        followDurationMs: durationMs,
      }, 'state');
    };
    if (entryDurationMs > 0 && ownsCamera) {
      routePointEntryReadyRef.current = beginFollowing;
      routePointEntryTargetRef.current = points[0];
      routePointEntryArrivedRef.current = false;
      cameraRef.current?.setCamera?.({
        centerCoordinate: [points[0].lng, points[0].lat],
        padding: animationPadding,
        zoomLevel: cameraZoomRef.current,
        heading: cameraBearingRef.current,
        pitch: cameraPitchRef.current,
        animationMode: 'easeTo',
        animationDuration: entryDurationMs,
      });
      routePointEntryFallbackRef.current = setTimeout(beginFollowing, entryDurationMs + 80);
    } else {
      // Mark this generation as startable so the shared idempotence guard
      // accepts the immediate path exactly once.
      routePointEntryReadyRef.current = beginFollowing;
      beginFollowing();
    }
  }, [bottomWorkspaceHeight, compactViewport, debugMode, finishRouteAnimation, insets.bottom, insets.top, reduceMotion, viewportHeight, viewportWidth]);

  useEffect(() => () => finishRouteAnimation('superseded'), [finishRouteAnimation]);

  useEffect(() => {
    if (!briefStatus) return undefined;
    const timeout = setTimeout(() => setBriefStatus(null), 2_400);
    return () => clearTimeout(timeout);
  }, [briefStatus]);

  const commitResult = useCallback((result: ReturnType<typeof appendOrderedSegment>, operation: string) => {
    const current = historyRef.current;
    if (!current) return false;
    if (!result.ok) {
      setError(editFailure(result.code));
      return false;
    }
    const next = commitRouteHistory(current, result, operation);
    historyRef.current = next;
    setHistory(next);
    setError(null);
    recordRouteDrawingTrace('route_draw_commit', {
      operation,
      priorRevision: current.present.revision,
      committedRevision: next.present.revision,
      undoDepthBefore: current.past.length,
      undoDepthAfter: next.past.length,
      finalGeometry: orderedDraftPoints(next.present),
      finalDraft: next.present,
    }, 'commit');
    return true;
  }, []);

  useEffect(() => {
    const initKey = `${ownerId}|${routeId ?? ''}|${fromSessionId ?? ''}|${sharedDeliveryId ?? ''}|${creationSource ?? ''}|${creationSessionId ?? ''}`;
    if (!ownerId || initializedKeyRef.current === initKey || initializingKeyRef.current === initKey) return;
    const editorGeneration = editorGenerationRef.current + 1;
    editorGenerationRef.current = editorGeneration;
    initializingKeyRef.current = initKey;
    initialLocationAttemptedRef.current = false;
    userMovedCameraRef.current = false;
    initializationProvenanceRef.current = 'unknown';
    setInitialLocation({ status: 'idle' });
    let cancelled = false;
    setInitializing(true);
    setError(null);
    historyRef.current = null;
    initialDraftRef.current = null;
    setHistory(null);
    setName('');
    setMode('Browse');
    setTrimStart(0);
    setTrimEnd(1);
    void (async () => {
      let draft: OrderedRouteDraft;
      let initialName = '';
      let initialPermission: 'personal' | 'friend' = 'personal';
      const activityDraftId = activityCreationDraftId({ creationSource, fromSessionId, creationSessionId });
      if (routeId) {
        let source = useRouteStore.getState().routes.find(item => routeMatchesIdentity(item, routeId));
        if (!source || source.points.length < 2) {
          await loadRouteDetail(routeId);
          source = useRouteStore.getState().routes.find(item => routeMatchesIdentity(item, routeId));
        }
        if (!source || source.points.length < 2) throw new Error('This Route is not available on this device.');
        draft = source.orderedDraft
          ? { ...cloneOrderedDraft(source.orderedDraft), ownerId, draftId: `route:${source.id}` }
          : createLegacyOrderedDraft({
              draftId: `route:${source.id}`,
              ownerId,
              points: source.points,
              origin: source.creationOrigin === 'activity' ? 'activity' : 'plan',
              recorded: source.creationOrigin === 'activity',
            });
        initialName = source.name;
        initialPermission = source.permission === 'friend' ? 'friend' : 'personal';
        initializationProvenanceRef.current = 'saved-route';
      } else if (fromSessionId) {
        const session = useSessionStore.getState().sessions.find(item => item.id === fromSessionId);
        if (!session) throw new Error('This Activity is no longer available.');
        const clientActivityId = session.clientActivityId ?? session.id;
        // Canonical accepted observations preserve the Activity's complete
        // turns and physical segment boundaries. The selected Final remains a
        // cross-device fallback only; it must not collapse a locally available
        // track to a start/end preview.
        const [artifact, canonicalPoints] = await Promise.all([
          loadActivityFinalArtifact(ownerId, clientActivityId),
          loadActivityTrackPoints(session),
        ]);
        const points = selectActivityRouteImportPoints(canonicalPoints, artifact?.points ?? []);
        const segments = segmentTrace(points).segments
          .filter(segment => segment.length >= 2)
          .map(segment => segment.map(point => ({ lat: point.lat, lng: point.lng, alt: point.alt ?? null })));
        if (segments.length === 0) throw new Error('This Activity has no usable path.');
        draft = createImportedOrderedDraft({
          draftId: activityDraftId ?? `activity:${fromSessionId}:legacy-${editorGeneration}`,
          ownerId,
          segments,
        });
        initialName = `${session.name || (session.activityMode === 'running' ? 'Run' : 'Hike')} Route`;
        initializationProvenanceRef.current = 'immutable-activity-template';
      } else if (sharedDeliveryId) {
        let shared = useRouteStore.getState().sharedRoutes.find(item => item.sharedDeliveryId === sharedDeliveryId);
        if (!shared || shared.points.length < 2) {
          await loadSharedRouteDetail(sharedDeliveryId);
          shared = useRouteStore.getState().sharedRoutes.find(item => item.sharedDeliveryId === sharedDeliveryId);
        }
        if (!shared || shared.points.length < 2) throw new Error('This shared Route is unavailable.');
        draft = shared.orderedDraft
          ? {
              ...cloneOrderedDraft(shared.orderedDraft),
              ownerId,
              draftId: creationSource === 'shared-copy' ? `received:${sharedDeliveryId}` : `shared-view:${sharedDeliveryId}`,
              origin: creationSource === 'shared-copy' ? 'received-copy' : shared.orderedDraft.origin,
            }
          : createLegacyOrderedDraft({
              draftId: creationSource === 'shared-copy' ? `received:${sharedDeliveryId}` : `shared-view:${sharedDeliveryId}`,
              ownerId,
              points: shared.points,
              origin: creationSource === 'shared-copy' ? 'received-copy' : 'plan',
            });
        initialName = creationSource === 'shared-copy' ? `${shared.name} copy` : shared.name;
        initializationProvenanceRef.current = creationSource === 'shared-copy' ? 'received-route-copy' : 'received-route-view';
      } else {
        draft = createEmptyOrderedDraft({ draftId: `plan:${uuidv4()}`, ownerId });
        initializationProvenanceRef.current = 'new-empty-plan';
      }
      const nextHistory = { present: draft, past: [] };
      if (cancelled || editorGenerationRef.current !== editorGeneration) return;
      historyRef.current = nextHistory;
      initialDraftRef.current = cloneOrderedDraft(draft);
      initialNameRef.current = initialName;
      initialPermissionRef.current = initialPermission;
      initialBoundsRef.current = initialBounds(draft);
      setHistory(nextHistory);
      setName(initialName);
      setPermission(initialPermission);
      initializedKeyRef.current = initKey;
      initializingKeyRef.current = '';
      setInitializing(false);
    })().catch(cause => {
      if (!cancelled) {
        if (initializingKeyRef.current === initKey) initializingKeyRef.current = '';
        setError(String(cause?.message ?? cause));
        setInitializing(false);
      }
    });
    return () => {
      cancelled = true;
      if (initializingKeyRef.current === initKey) initializingKeyRef.current = '';
      operationAbortRef.current?.abort();
    };
  }, [creationSessionId, creationSource, fromSessionId, loadRouteDetail, loadSharedRouteDetail, ownerId, readOnlyShared, routeId, sharedDeliveryId]);

  const draft = history?.present ?? null;
  const traceDraftId = draft?.draftId ?? null;
  useEffect(() => {
    const current = historyRef.current;
    if (!traceDraftId || !current) return undefined;
    const sessionId = `route-edit:${traceDraftId}:${Date.now()}`;
    traceDraftIdRef.current = traceDraftId;
    beginRouteDrawingTrace({
      sessionId,
      routeId: routeId ?? traceDraftId,
      accountId: ownerId,
      source: fromSessionId
        ? { kind: 'activity', id: fromSessionId }
        : routeId
          ? { kind: 'route', id: routeId }
          : { kind: 'draft', id: traceDraftId },
      initialGeometryRevision: current.present.revision,
      originalRoute: orderedDraftPoints(current.present),
      initialUndoDepth: current.past.length,
    });
    recordRouteDrawingTrace('route_session_hydrated', {
      draftId: current.present.draftId,
      revision: current.present.revision,
      undoDepth: current.past.length,
      provenance: initializationProvenanceRef.current,
      parts: current.present.parts,
      gaps: current.present.gaps,
    }, 'session');
    return () => {
      if (traceDraftIdRef.current === traceDraftId) {
        endRouteDrawingTrace('cancelled');
        traceDraftIdRef.current = null;
      }
    };
  }, [fromSessionId, ownerId, routeId, traceDraftId]);

  const abandonUnsavedCreation = useCallback(() => {
    const current = historyRef.current;
    if (!current || routeId || readOnlyShared
      || savedDraftIdsRef.current.has(current.present.draftId)
      || abandonedDraftIdsRef.current.has(current.present.draftId)) return;
    const draftId = current.present.draftId;
    abandonedDraftIdsRef.current.add(draftId);
    editorGenerationRef.current += 1;
    invalidatePendingOperation();
    selectRouteDrawingSessionOperation();
    recordRouteDrawingTrace('route_creation_abandoned', {
      draftId,
      sourceActivityId: fromSessionId ?? null,
      creationSessionId: creationSessionId ?? null,
      revision: current.present.revision,
      undoDepth: current.past.length,
      finalGeometry: orderedDraftPoints(current.present),
    }, 'session');
    endRouteDrawingTrace('cancelled');
    void abandonRoutePlannerDraft(ownerId, draftId).catch(cause => {
      recordRouteDrawingTrace('route_creation_abandon_failed', {
        draftId,
        error: String(cause),
      }, 'persistence');
    });
  }, [creationSessionId, fromSessionId, invalidatePendingOperation, ownerId, readOnlyShared, routeId]);

  useEffect(() => {
    const removeListener = nav.addListener?.('beforeRemove', (event: any) => {
      if (allowLeaveRef.current) {
        allowLeaveRef.current = false;
        return;
      }
      const current = historyRef.current;
      const hasUnsavedChanges = Boolean(!readOnlyShared && current && (
        current.past.length > 0
        || name !== initialNameRef.current
        || permission !== initialPermissionRef.current
        || (!routeId && (current.present.parts.length > 0 || name.trim().length > 0))
      ));
      const decision = routeEditorLeaveDecision({
        allowLeave: false,
        hasUnsavedChanges,
        saving: saveCoordinatorRef.current.isSaving(),
      });
      if (decision === 'allow') {
        abandonUnsavedCreation();
        return;
      }
      event?.preventDefault?.();
      setPendingLeave({ action: event?.data?.action ?? null, decision });
    });
    return typeof removeListener === 'function' ? removeListener : undefined;
  }, [abandonUnsavedCreation, name, nav, permission, readOnlyShared, routeId]);
  const mapStyle = getMapStyleForTheme('outdoors', mapTheme);
  const lightPreset = themeToStandardPreset(mapTheme);
  const routeSceneIdentity = `${ownerId ?? 'anonymous'}:${routeId ?? draft?.draftId ?? 'new'}:${mapEpoch}:${mapTheme}:${mapStyle.kind === 'url' ? mapStyle.url : JSON.stringify(mapStyle.json)}`;

  useEffect(() => {
    const previousIdentity = routeSceneIdentityRef.current;
    if (previousIdentity !== routeSceneIdentity) {
      routeSceneIdentityRef.current = routeSceneIdentity;
      routeSceneReadyIdentityRef.current = '';
      routeSceneEverReadyRef.current = false;
      if (previousIdentity) {
        setRouteSceneEverReady(false);
        setMapReady(false);
        setMapLoadState('loading');
      }
      return;
    }
    if (routeSceneReady) {
      routeSceneReadyIdentityRef.current = routeSceneIdentity;
      routeSceneEverReadyRef.current = true;
      setRouteSceneEverReady(true);
    }
  }, [routeSceneIdentity, routeSceneReady]);

  const region = getCurrentRegion();
  const fallbackCenter: [number, number] = [region.centerLng, region.centerLat];
  const initialLocationCenter: [number, number] = initialLocation.status === 'ready'
    ? [initialLocation.point.lng, initialLocation.point.lat]
    : fallbackCenter;
  const showPlannerMap = Boolean(initialBoundsRef.current)
    || initialLocation.status === 'ready'
    || initialLocation.status === 'unavailable';
  const bottomClearance = bottomWorkspaceHeight || insets.bottom + (compactViewport ? 126 : 138);
  const routeOrnaments = groupedMapOrnamentsAbove(bottomClearance + Spacing.sm);
  const handleBottomWorkspaceLayout = useCallback((event: LayoutChangeEvent) => {
    const measured = Math.ceil(event.nativeEvent.layout.height);
    setBottomWorkspaceHeight(current => current === measured ? current : measured);
  }, []);

  useEffect(() => {
    if (mapReady || !showPlannerMap) return undefined;
    const timer = setTimeout(() => setMapLoadState('slow'), 8_000);
    return () => clearTimeout(timer);
  }, [mapEpoch, mapReady, showPlannerMap]);

  const confirmRouteFogPaint = useCallback((fullyRenderedFrame = false) => {
    const readinessKey = routeFogTargetKeyRef.current;
    if (!readinessKey
      || routeFogGeometryReadyKeyRef.current !== readinessKey
      || routeFogPaintReadyKeyRef.current === readinessKey) return false;
    const requiredSourceIds = routeFogRequiredSourceIdsRef.current;
    const sourceProbe = mapViewRef.current?.isSourceLoaded;
    const sourcesLoaded = typeof sourceProbe !== 'function'
      || requiredSourceIds.every(sourceId => sourceProbe(sourceId));
    const unavailable = routeFogUnavailableCandidateKeyRef.current === readinessKey;
    const layerIds = requiredSourceIds.flatMap(sourceId => {
      if (sourceId === 'memory-fog-src') return [
        'memory-fog',
        'memory-mine',
        'memory-friend-union',
        'memory-overlap',
      ];
      if (sourceId === 'memory-friend-union-src') return 'memory-friend-union';
      if (sourceId === 'memory-overlap-src') return 'memory-overlap';
      return sourceId;
    });
    const atomicSceneProbe = mapViewRef.current?.hasRenderedScene;
    const renderedProbe = mapViewRef.current?.areLayersRendered;
    const hasRenderedLayerProbe = !unavailable && (
      typeof atomicSceneProbe === 'function'
      || typeof renderedProbe === 'function'
    );
    const exactLayersRendered = typeof atomicSceneProbe === 'function'
      ? atomicSceneProbe(layerIds, readinessKey)
      : typeof renderedProbe === 'function' && renderedProbe(layerIds, readinessKey);
    if (!memoryFogPaintEvidenceReady({
      hasRenderedLayerProbe,
      exactLayersRendered,
      fullyRenderedFrame,
      sourcesLoaded,
    })) {
      mapViewRef.current?.requestRender?.();
      return false;
    }
    routeFogPaintReadyKeyRef.current = readinessKey;
    setRouteFogPending(false);
    setShowRouteFogPending(false);
    if (unavailable) {
      setRouteFogUnavailableKey(readinessKey);
      setRouteFogReadyKey('');
    } else {
      setRouteFogReadyKey(readinessKey);
      setRouteFogUnavailableKey('');
    }
    return true;
  }, []);

  const retryRouteScene = useCallback(() => {
    if (mapLoadState === 'error' || !mapReady) {
      setMapReady(false);
      setMapLoadState('loading');
      setRouteSceneEverReady(false);
      routeSceneEverReadyRef.current = false;
      routeSceneReadyIdentityRef.current = '';
      routeFogPaintReadyKeyRef.current = '';
      setMapEpoch(value => value + 1);
      return;
    }
    setRouteFogPending(true);
    setShowRouteFogPending(false);
    void useFriendMemoryStore.getState().loadSelectedProjections(
      undefined,
      memoryCoverageView ?? undefined,
    );
  }, [mapLoadState, mapReady, memoryCoverageView]);

  const moveCamera = useCallback((point: RoutePoint, zoomLevel = 13.5) => {
    finishRouteAnimation('camera-action');
    cameraRef.current?.setCamera?.({
      centerCoordinate: [point.lng, point.lat],
      zoomLevel,
      animationDuration: reduceMotion ? 0 : 420,
    });
  }, [finishRouteAnimation, reduceMotion]);

  useEffect(() => {
    if (initializing || !draft || initialBoundsRef.current || initialLocationAttemptedRef.current) return;
    initialLocationAttemptedRef.current = true;
    setInitialLocation({ status: 'locating' });
    let cancelled = false;
    void (async () => {
      try {
        const permissionState = await Location.getForegroundPermissionsAsync();
        if (!cancelled) setLocationPermissionGranted(permissionState.status === 'granted');
        if (permissionState.status !== 'granted') {
          if (!cancelled) {
            setInitialLocation({ status: 'unavailable' });
            setError('Location is unavailable. Browse the map to start planning.');
          }
          return;
        }
        const lastKnown = await Location.getLastKnownPositionAsync({ maxAge: 2 * 60_000, requiredAccuracy: 200 });
        let point = qualifiedLocationPoint(lastKnown, { maxAgeMs: 2 * 60_000, maxAccuracyM: 200 });
        if (!point) {
          const fix = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
          point = qualifiedLocationPoint(fix, { maxAgeMs: 60_000, maxAccuracyM: 120 });
        }
        if (!point) throw new Error('unqualified-location');
        if (cancelled || userMovedCameraRef.current) return;
        setInitialLocation({ status: 'ready', point });
        setError(null);
      } catch {
        if (!cancelled && !userMovedCameraRef.current) {
          setInitialLocation({ status: 'unavailable' });
          setError('Current location is unavailable. Browse the map instead.');
        }
      }
    })();
    return () => { cancelled = true; };
  }, [draft, initializing]);

  const showRouteOverview = useCallback(() => {
    finishRouteAnimation('camera-action');
    const points = historyRef.current?.present.parts.flatMap(part => part.points) ?? [];
    if (points.length < 2) { setError('Add a path before showing its overview.'); return; }
    const ne: [number, number] = [Math.max(...points.map(point => point.lng)), Math.max(...points.map(point => point.lat))];
    const sw: [number, number] = [Math.min(...points.map(point => point.lng)), Math.min(...points.map(point => point.lat))];
    cameraRef.current?.fitBounds?.(ne, sw, [insets.top + 110, 88, bottomClearance + 30, 36], reduceMotion ? 0 : 420);
  }, [bottomClearance, finishRouteAnimation, insets.top, reduceMotion]);

  const showCurrentLocation = useCallback(async () => {
    try {
      const permissionState = await Location.getForegroundPermissionsAsync();
      setLocationPermissionGranted(permissionState.status === 'granted');
      if (permissionState.status !== 'granted') {
        setError('Location permission is needed to center the planning map. You can still browse another city.');
        return;
      }
      const fix = await Location.getLastKnownPositionAsync({ maxAge: 5 * 60_000, requiredAccuracy: 500 })
        ?? await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const point = qualifiedLocationPoint(fix, { maxAgeMs: 5 * 60_000, maxAccuracyM: 500 });
      if (!point) throw new Error('unqualified-location');
      setInitialLocation({ status: 'ready', point });
      moveCamera(point, 14);
      setError(null);
    } catch {
      setError('Current location is unavailable. Browse the map instead.');
    }
  }, [moveCamera]);

  const applyResolvedDraw = useCallback((
    parts: Array<Pick<DrawPlanPart, 'points' | 'resolution'>>,
    intent: DrawTransactionIntent,
  ): boolean => {
    const completionMessage = parts.some(part => part.resolution === 'draw-manual')
      ? parts.some(part => part.resolution === 'draw-matched')
        ? 'Part of your drawing was kept. Undo if needed.'
        : 'Drawing kept. Undo if needed.'
      : 'Line added. Move the map, or tap Draw to continue.';
    const current = historyRef.current;
    if (!current) {
      setMode('Browse');
      return false;
    }
    if (intent.kind === 'replace' || intent.kind === 'replace-across-gap') {
      if (intent.options.length > 1) {
        setError('Redraw from clearer positions so Cairn can preserve the right path.');
        setMode('Browse');
        return false;
      }
      const option = intent.options[0];
      if (!option) { setError('Redraw from clearer positions. Your Route is unchanged.'); setMode('Browse'); return false; }
      const operation = intent.kind === 'replace-across-gap'
        ? { kind: 'replace-across-gap' as const, option, gapId: intent.gapId }
        : { kind: 'replace' as const, option };
      const committed = commitResult(applyDrawTransactionParts(current.present, operation, parts), 'replace-draw');
      setMode('Browse');
      if (committed) {
        setBriefStatus(completionMessage);
      }
      return committed;
    }
    if (intent.kind === 'reject') {
      setError(editFailure(intent.code));
      setMode('Browse');
      return false;
    }
    if (intent.kind === 'pending-bridge' || intent.kind === 'pending-replace') {
      setError('Redraw with both ends clearly attached. Your Route is unchanged.');
      setMode('Browse');
      return false;
    }
    const committed = commitResult(
      applyDrawTransactionParts(current.present, intent, parts),
      intent.kind === 'bridge' ? 'bridge-draw' : intent.kind === 'prepend' ? 'prepend-draw' : 'append-draw',
    );
    setMode('Browse');
    if (committed) {
      setBriefStatus(completionMessage);
    }
    return committed;
  }, [commitResult]);

  const handleDrawStroke = useCallback(async (
    raw: RoutePoint[],
    nativeCapture?: RouteDrawStrokeCapture,
  ) => {
    const current = historyRef.current;
    if (!current) return;
    const strokeId = nativeCapture?.strokeId ?? uuidv4();
    selectRouteDrawingOperation(strokeId);
    const camera = {
      centerLng: cameraCenterRef.current?.lng ?? raw[0]?.lng ?? 0,
      centerLat: cameraCenterRef.current?.lat ?? raw[0]?.lat ?? 0,
      zoom: cameraZoomRef.current,
      bearing: cameraBearingRef.current,
      pitch: cameraPitchRef.current,
      generation: cameraGenerationRef.current,
    };
    recordRouteDrawingTrace('route_draw_raw_samples', {
      strokeId,
      inputBoundary: nativeCapture ? 'native-rngh' : 'development-coordinate-injection',
      startedAtMs: nativeCapture?.startedAtMs ?? null,
      endedAtMs: nativeCapture?.endedAtMs ?? null,
      sampleCapacity: nativeCapture?.sampleCapacity ?? null,
      droppedSampleCount: nativeCapture?.droppedSampleCount ?? null,
      viewportWidth,
      viewportHeight,
      viewportPadding: {
        top: insets.top,
        bottom: bottomWorkspaceHeight || insets.bottom + (compactViewport ? 126 : 138),
        left: 0,
        right: 0,
      },
      projectionCoordinateSpace: 'absolute-window-minus-measured-map-origin',
      pixelRatio: nativeCapture?.samples.find(sample => sample.pixelRatio)?.pixelRatio ?? null,
      mapOrigin: nativeCapture?.samples[0]
        ? {
            x: nativeCapture.samples[0].mapOriginX ?? null,
            y: nativeCapture.samples[0].mapOriginY ?? null,
            measured: nativeCapture.samples[0].mapOriginMeasured ?? false,
          }
        : null,
      camera,
      samples: nativeCapture?.samples ?? [],
    }, 'raw-input');
    recordRouteDrawingTrace('route_draw_geographic_stroke', {
      strokeId,
      rawPoints: raw,
      pointCount: raw.length,
      projectionFailures: nativeCapture?.samples.filter(sample => !sample.geographic).length ?? null,
    }, 'geographic-stroke');
    if (providerTransactionRef.current) {
      recordRouteDrawingTrace('route_draw_cancelled_busy', { strokeId }, 'state');
      recordRouteDrawingTrace('route_operation_terminal', {
        strokeId,
        outcome: 'rejected',
        reason: 'operation-busy',
        finalMode: modeRef.current,
        busyReleased: false,
      }, 'state');
      setError('Finish or cancel the current Route edit first.');
      return;
    }
    const transactionPoints = raw;
    const latitude = raw[0]?.lat ?? cameraCenterRef.current?.lat ?? 0;
    const attachmentToleranceM = routeAttachmentToleranceM(latitude, cameraZoomRef.current);
    const classification = classifyDrawTransactionWithDiagnostics(current.present, raw, undefined, attachmentToleranceM);
    const intent = classification.intent;
    recordRouteDrawingTrace('route_draw_transaction_intent', {
      strokeId,
      intent,
      attachmentToleranceM,
      initialRevision: current.present.revision,
      undoDepth: current.past.length,
      preStateGeometry: orderedDraftPoints(current.present),
      diagnostics: classification.diagnostics,
    }, 'intent');
    if (intent.kind === 'reject') {
      recordRouteDrawingTrace('route_draw_rejected', {
        strokeId,
        code: intent.code,
        diagnostics: classification.diagnostics,
        initialRevision: current.present.revision,
        finalRevision: current.present.revision,
        unchangedFinalGeometry: orderedDraftPoints(current.present),
      }, 'selection');
      setError(editFailure(intent.code));
      setMode('Browse');
      recordRouteDrawingTrace('route_operation_terminal', {
        strokeId,
        outcome: 'rejected',
        reason: intent.code,
        finalMode: 'Browse',
        busyReleased: true,
      }, 'state');
      return;
    }
    if (intent.kind === 'pending-bridge' || intent.kind === 'pending-replace') {
      recordRouteDrawingTrace('route_draw_ambiguous', {
        strokeId,
        intent,
        diagnostics: classification.diagnostics,
        initialRevision: current.present.revision,
        finalRevision: current.present.revision,
        unchangedFinalGeometry: orderedDraftPoints(current.present),
      }, 'attachment');
      setError(intent.kind === 'pending-replace' && intent.ambiguity === 'overlap'
        ? 'That section is ambiguous. Redraw from clearer points; your Route is unchanged.'
        : 'Draw with both ends clearly attached. Your Route is unchanged.');
      setMode('DrawArmed');
      recordRouteDrawingTrace('route_operation_terminal', {
        strokeId,
        outcome: 'rejected',
        reason: intent.kind === 'pending-replace' ? intent.ambiguity ?? 'ambiguous-replacement' : 'ambiguous-bridge',
        finalMode: 'DrawArmed',
        busyReleased: true,
      }, 'state');
      return;
    }
    const operationId = strokeId;
    const token = beginRouteOperation(
      current.present,
      ownerId,
      intent.kind === 'bridge' ? 'bridge' : intent.kind === 'replace' || intent.kind === 'replace-across-gap' ? 'replace' : 'draw',
      operationId,
    );
    operationAbortRef.current?.abort();
    const controller = new AbortController();
    providerTransactionRef.current = true;
    operationAbortRef.current = controller;
    activeOperationIdRef.current = operationId;
    setProviderBusy(true);
    setMode('MatchPending');
    setResolvingDrawPoints(transactionPoints);
    setError(null);
    const providerStartedAtMs = Date.now();
    try {
      recordRouteDrawingTrace('route_draw_provider_request', {
        strokeId,
        rawPoints: transactionPoints,
        pointCount: transactionPoints.length,
        deadlineMs: ROUTE_DRAW_TOTAL_DEADLINE_MS,
      }, 'provider-request');
      const resolved = await resolveDrawPlan(transactionPoints, { signal: controller.signal });
      recordRouteDrawingTrace('route_draw_provider_response', {
        strokeId,
        outcome: resolved.outcome,
        reason: 'reason' in resolved ? resolved.reason : null,
        callCount: 'callCount' in resolved ? resolved.callCount : null,
        fallbackReason: resolved.outcome === 'accepted' ? resolved.fallbackReason ?? null : null,
        durationMs: Date.now() - providerStartedAtMs,
        deadlineMs: ROUTE_DRAW_TOTAL_DEADLINE_MS,
        sections: resolved.outcome === 'accepted'
          ? (resolved.parts ?? []).map(part => ({
              resolution: part.resolution,
              inputStartIndex: part.inputStartIndex,
              inputEndIndex: part.inputEndIndex,
              pointCount: part.points.length,
            }))
          : [],
        providerGeometry: resolved.outcome === 'accepted' ? resolved.points : null,
      }, 'provider-response');
      const live = historyRef.current;
      if (!live || controller.signal.aborted
        || !routeOperationIsCurrent(live.present, ownerId, token, activeOperationIdRef.current)) {
        if (!controller.signal.aborted) {
          recordRouteDrawingTrace('route_operation_terminal', {
            strokeId,
            outcome: 'cancelled',
            reason: 'stale-operation',
            finalMode: 'Browse',
            busyReleased: true,
          }, 'state');
          setMode('Browse');
        }
        return;
      }
      if (resolved.outcome === 'accepted') {
        const committed = applyResolvedDraw(resolved.parts?.length
          ? resolved.parts
          : [{ points: resolved.points, resolution: 'draw-matched' }], intent);
        recordRouteDrawingTrace('route_operation_terminal', {
          strokeId,
          outcome: committed ? 'committed' : 'failed',
          reason: committed ? null : 'commit-rejected',
          finalMode: 'Browse',
          busyReleased: true,
          finalRevision: historyRef.current?.present.revision ?? null,
        }, 'state');
      } else if (resolved.outcome === 'manual-available') {
        const committed = applyResolvedDraw([{ points: resolved.rawPoints, resolution: 'draw-manual' }], intent);
        recordRouteDrawingTrace('route_operation_terminal', {
          strokeId,
          outcome: committed ? 'committed' : 'failed',
          reason: committed ? 'manual-section' : 'commit-rejected',
          finalMode: 'Browse',
          busyReleased: true,
          finalRevision: historyRef.current?.present.revision ?? null,
        }, 'state');
      } else {
        recordRouteDrawingTrace('route_draw_rejected', {
          strokeId,
          reason: resolved.reason,
        }, 'selection');
        setError(providerReason(resolved.reason));
        setMode('Browse');
        recordRouteDrawingTrace('route_operation_terminal', {
          strokeId,
          outcome: 'rejected',
          reason: resolved.reason,
          finalMode: 'Browse',
          busyReleased: true,
        }, 'state');
      }
    } catch (cause) {
      if (!controller.signal.aborted) {
        recordRouteDrawingTrace('route_draw_failed', {
          strokeId,
          message: cause instanceof Error ? cause.message : String(cause),
          stack: cause instanceof Error ? cause.stack ?? null : null,
          durationMs: Date.now() - providerStartedAtMs,
        }, 'state');
        setError('That drawing could not be applied. Your Route is unchanged.');
        setMode('Browse');
        recordRouteDrawingTrace('route_operation_terminal', {
          strokeId,
          outcome: 'failed',
          reason: 'exception',
          finalMode: 'Browse',
          busyReleased: true,
        }, 'state');
      }
    } finally {
      if (operationAbortRef.current === controller) {
        operationAbortRef.current = null;
        if (activeOperationIdRef.current === operationId) activeOperationIdRef.current = null;
        providerTransactionRef.current = false;
        setResolvingDrawPoints([]);
        setProviderBusy(false);
      }
    }
  }, [applyResolvedDraw, bottomWorkspaceHeight, compactViewport, insets.bottom, insets.top, ownerId, viewportHeight, viewportWidth]);

  useEffect(() => {
    if (!debugMode || Platform.OS !== 'web') return undefined;
    // Explicit-debug visual-QA bridge. It submits geographic ink through
    // the real transaction classifier, provider fencing and editor state
    // machine because the native RNGH drawing surface is intentionally not
    // mounted on Web. The hook is absent from production/native runtimes.
    const qaRoot = globalThis as unknown as {
      __cairnRouteEditorQa?: {
        submitStroke: (points: RoutePoint[]) => Promise<void>;
        getPointAnimationSnapshot: () => RouteGrowthAnimation | null;
        getCurrentDraft: () => OrderedRouteDraft | null;
        getApprovedPointTarget: () => RoutePoint | null;
        getCameraSnapshot: () => Record<string, unknown>;
        getPointAnimationFrameHistory: () => Array<{ atMs: number; progress: number }>;
        classifyStroke: (points: RoutePoint[]) => Record<string, unknown>;
      };
    };
    const bridge = {
      submitStroke: handleDrawStroke,
      getPointAnimationSnapshot: () => {
        const animation = routeGrowthAnimationRef.current;
        const painted = routeGrowthPaintedSampleRef.current;
        return animation && painted ? {
          ...animation,
          progress: painted.progress,
          head: { ...painted.head },
          visiblePointCount: painted.visiblePointCount,
        } : animation;
      },
      getCurrentDraft: () => historyRef.current?.present ?? null,
      getApprovedPointTarget: () => approvedPointTargetRef.current,
      getCameraSnapshot: () => ({
        center: cameraCenterRef.current,
        zoom: cameraZoomRef.current,
        bearing: cameraBearingRef.current,
        pitch: cameraPitchRef.current,
        generation: cameraGenerationRef.current,
      }),
      classifyStroke: (points: RoutePoint[]) => {
        const draft = historyRef.current?.present;
        const latitude = points[0]?.lat ?? cameraCenterRef.current?.lat ?? 0;
        const attachmentToleranceM = routeAttachmentToleranceM(latitude, cameraZoomRef.current);
        return {
          cameraZoom: cameraZoomRef.current,
          attachmentToleranceM,
          ...(draft
            ? classifyDrawTransactionWithDiagnostics(draft, points, undefined, attachmentToleranceM)
            : { intent: { kind: 'reject', code: 'DISCONNECTED' }, diagnostics: null }),
        };
      },
      getPointAnimationFrameHistory: () => {
        const history = routeGrowthFrameHistoryRef.current!;
        return Array.from({ length: history.count }, (_, index) => ({
          atMs: history.atMs[index],
          progress: history.progress[index],
        }));
      },
    };
    qaRoot.__cairnRouteEditorQa = bridge;
    return () => {
      if (qaRoot.__cairnRouteEditorQa === bridge) delete qaRoot.__cairnRouteEditorQa;
    };
  }, [debugMode, handleDrawStroke]);

  const applyResolvedPoint = useCallback((
    points: RoutePoint[],
    intent: PointTransactionIntent,
    baseRevision: number,
    resolution: 'point' = 'point',
    ownsCamera = true,
  ): boolean => {
    const current = historyRef.current;
    if (!current) {
      setPendingPointTarget(null);
      setMode('PointTargeting');
      return false;
    }
    if (current.present.revision !== baseRevision) {
      setError('This Route changed while the edit was being reviewed. The older result was not applied.');
      setPendingPointTarget(null);
      setMode('PointTargeting');
      return false;
    }
    if (intent.kind === 'append') {
      const result = appendOrderedSegment(current.present, points, resolution);
      const committed = commitResult(result, 'append-point');
      if (committed) {
        setPendingPointTarget(null);
        const committedPart = result.ok ? result.draft.parts.at(-1) : undefined;
        animateAcceptedPoint(committedPart?.points ?? points, committedPart?.id, ownsCamera);
        setTool('browse');
      } else {
        setPendingPointTarget(null);
        setMode('PointTargeting');
      }
      return committed;
    }
    if (intent.kind === 'bridge') {
      const previousPartIds = new Set(current.present.parts.map(part => part.id));
      const result = bridgeOrderedGap(current.present, intent.gapId, points, resolution);
      const committed = commitResult(result, 'bridge-point');
      if (committed) {
        setPendingPointTarget(null);
        const addedPart = result.ok ? result.draft.parts.find(part => !previousPartIds.has(part.id)) : undefined;
        animateAcceptedPoint(addedPart?.points ?? points, addedPart?.id, ownsCamera);
        setTool('browse');
      } else {
        setPendingPointTarget(null);
        setMode('PointTargeting');
      }
      return committed;
    }
    setPendingPointTarget(null);
    setMode('PointTargeting');
    return false;
  }, [animateAcceptedPoint, commitResult]);

  const runPointRequest = useCallback(async (
    start: RoutePoint,
    target: RoutePoint,
    intent: PointTransactionIntent,
  ) => {
    const current = historyRef.current;
    if (!current) return;
    if (providerTransactionRef.current) return;
    finishRouteAnimation();
    const baseRevision = current.present.revision;
    const userCameraGenerationAtRequest = userCameraInteractionGenerationRef.current;
    const operationId = uuidv4();
    selectRouteDrawingOperation(operationId, 'point');
    recordRouteDrawingTrace('route_point_provider_request', {
      strokeId: operationId,
      start,
      target,
      intent,
      baseRevision,
      preStateDraft: current.present,
      preStateGeometry: orderedDraftPoints(current.present),
      currentEndpointOccurrence: {
        partId: current.present.parts.at(-1)?.id ?? null,
        pointIndex: current.present.parts.at(-1)?.points.length
          ? current.present.parts.at(-1)!.points.length - 1
          : null,
      },
      providerContract: {
        profile: 'mapbox/walking',
        waypointOrder: ['start', 'target'],
        bearings: null,
        radiusesM: [25, 25],
        continueStraight: 'walking-default-false',
        overview: 'full',
        geometry: 'geojson',
      },
    }, 'provider-request');
    const token = beginRouteOperation(current.present, ownerId, 'point', operationId);
    operationAbortRef.current?.abort();
    const controller = new AbortController();
    providerTransactionRef.current = true;
    operationAbortRef.current = controller;
    activeOperationIdRef.current = operationId;
    // Web Mapbox GL v2 performs expensive symbol collision placement while a
    // continuously-following camera moves. Freeze basemap symbols before the
    // Point provider turn begins (while keeping roads, paths, water and
    // Cairn's own endpoint layer visible), then restore on every terminal path.
    setProviderBusy(true);
    setMode('MatchPending');
    setError(null);
    const providerStartedAtMs = Date.now();
    try {
      await setPointMotionBasemapActive(true);
      if (controller.signal.aborted
        || operationAbortRef.current !== controller
        || activeOperationIdRef.current !== operationId) return;
      const result = await resolvePointPlan(start, target, { signal: controller.signal });
      recordRouteDrawingTrace('route_point_provider_response', {
        strokeId: operationId,
        outcome: result.outcome,
        reason: 'reason' in result ? result.reason : null,
        providerCode: 'providerCode' in result ? result.providerCode : null,
        providerGeometry: 'points' in result ? result.points : null,
        providerStartShiftM: 'providerStartShiftM' in result ? result.providerStartShiftM : null,
        providerTargetShiftM: 'providerTargetShiftM' in result ? result.providerTargetShiftM : null,
        durationMs: Date.now() - providerStartedAtMs,
        deadlineMs: WALKING_PLAN_TIMEOUT_MS,
      }, 'provider-response');
      const live = historyRef.current;
      if (!live || controller.signal.aborted
        || !routeOperationIsCurrent(live.present, ownerId, token, activeOperationIdRef.current)) {
        if (!controller.signal.aborted) {
          setPendingPointTarget(null);
          setMode('PointTargeting');
          recordRouteDrawingTrace('route_operation_terminal', {
            strokeId: operationId,
            outcome: 'cancelled',
            reason: 'stale-operation',
            finalMode: 'PointTargeting',
            busyReleased: true,
          }, 'state');
        }
        return;
      }
      if (result.outcome === 'accepted' || result.outcome === 'review') {
        const selection = selectPointRouteCandidate({
          draft: live.present,
          target,
          provider: result.points,
          zoom: cameraZoomRef.current,
        });
        recordRouteDrawingTrace('route_point_candidate_selected', {
          strokeId: operationId,
          source: selection.source,
          reason: selection.reason,
          knownRetrace: selection.knownRetrace,
          occurrence: selection.occurrence,
          providerDeviationM: selection.providerDeviationM,
          lengthInflation: selection.lengthInflation,
          providerTargetShiftM: selection.providerTargetShiftM,
          providerStartShiftM: selection.providerStartShiftM,
          networkDistanceM: selection.networkDistanceM,
          directDistanceM: selection.directDistanceM,
          knownRetraceLengthM: selection.knownRetraceLengthM,
          rawTarget: selection.rawTarget,
          providerTarget: selection.providerTarget,
          effectiveTarget: selection.effectiveTarget,
          snapToleranceM: selection.snapToleranceM,
          terminalSpurLengthM: selection.terminalSpurLengthM,
          requiresChoice: selection.requiresChoice,
          accepted: selection.accepted,
          selectedGeometry: selection.points,
        }, 'selection');
        if (!selection.accepted) {
          setPendingPointTarget(null);
          setError(selection.reason === 'provider-absurd-detour'
            ? 'Long detour. Move the Point or Draw this connection.'
            : 'No nearby path found. Move the Point or draw this section.');
          setMode('PointTargeting');
          recordRouteDrawingTrace('route_operation_terminal', {
            strokeId: operationId,
            outcome: 'rejected',
            reason: selection.reason,
            finalMode: 'PointTargeting',
            busyReleased: true,
          }, 'state');
        } else {
          setPendingPointTarget({ ...(selection.effectiveTarget ?? selection.points.at(-1)!) });
          const ownsCamera = userCameraInteractionGenerationRef.current === userCameraGenerationAtRequest;
          const committed = applyResolvedPoint(selection.points, intent, baseRevision, 'point', ownsCamera);
          recordRouteDrawingTrace('route_operation_terminal', {
            strokeId: operationId,
            outcome: committed ? 'committed' : 'failed',
            reason: committed ? null : 'commit-rejected',
            finalMode: committed ? 'Browse' : 'PointTargeting',
            busyReleased: true,
            finalRevision: historyRef.current?.present.revision ?? null,
            cameraOwnership: ownsCamera ? 'point-animation' : 'user-gesture',
          }, 'state');
        }
      } else {
        recordRouteDrawingTrace('route_point_rejected', {
          strokeId: operationId,
          reason: result.reason,
          providerCode: result.providerCode ?? null,
          rawTarget: target,
          baseRevision,
          unchangedFinalGeometry: orderedDraftPoints(live.present),
        }, 'selection');
        setPendingPointTarget(null);
        setError(providerReason(result.reason, result.providerCode));
        setMode('PointTargeting');
        recordRouteDrawingTrace('route_operation_terminal', {
          strokeId: operationId,
          outcome: 'rejected',
          reason: result.reason,
          providerCode: result.providerCode ?? null,
          finalMode: 'PointTargeting',
          busyReleased: true,
        }, 'state');
      }
    } catch (cause) {
      setPendingPointTarget(null);
      if (!controller.signal.aborted) {
        recordRouteDrawingTrace('route_point_failed', {
          strokeId: operationId,
          message: cause instanceof Error ? cause.message : String(cause),
          stack: cause instanceof Error ? cause.stack ?? null : null,
          durationMs: Date.now() - providerStartedAtMs,
        }, 'state');
        setError('Routing is unavailable. Move the map and add another Point.');
        setMode('PointTargeting');
        recordRouteDrawingTrace('route_operation_terminal', {
          strokeId: operationId,
          outcome: 'failed',
          reason: 'exception',
          finalMode: 'PointTargeting',
          busyReleased: true,
        }, 'state');
      }
    } finally {
      if (operationAbortRef.current === controller) {
        operationAbortRef.current = null;
        if (activeOperationIdRef.current === operationId) activeOperationIdRef.current = null;
        providerTransactionRef.current = false;
        setProviderBusy(false);
        if (routeGrowthAnimationRef.current === null) {
          void setPointMotionBasemapActive(false);
        }
      }
    }
  }, [applyResolvedPoint, finishRouteAnimation, ownerId, setPointMotionBasemapActive]);

  const confirmPointTarget = useCallback(() => {
    const current = historyRef.current;
    const target = cameraCenterRef.current;
    if (!current || !target || providerBusy) return;
    approvedPointTargetRef.current = { ...target };
    recordRouteDrawingTrace('route_point_target_confirmed', {
      target,
      camera: {
        center: cameraCenterRef.current,
        zoom: cameraZoomRef.current,
        bearing: cameraBearingRef.current,
        pitch: cameraPitchRef.current,
        generation: cameraGenerationRef.current,
      },
    }, 'attachment');
    if (current.present.parts.length === 0 && !current.present.startPoint) {
      if (commitResult(setOrderedDraftStart(current.present, target), 'set-start')) {
        setError(null);
        setMode('PointTargeting');
      }
      return;
    }
    const start = current.present.parts.at(-1)?.points.at(-1) ?? current.present.startPoint;
    if (!start) return;
    setPendingPointTarget({ ...target });
    void runPointRequest(start, target, { kind: 'append' });
  }, [commitResult, providerBusy, runPointRequest]);

  const hasUncommittedRouteEdit = providerBusy
    || providerTransactionRef.current;

  const handleUndo = useCallback(() => {
    if (providerTransactionRef.current || hasUncommittedRouteEdit) return;
    finishRouteAnimation('undo');
    const current = historyRef.current;
    if (!current) return;
    setTrimStart(0);
    setTrimEnd(1);
    setMode('Browse');
    if (current.past.length === 0) {
      setError(null);
      return;
    }
    const next = undoRouteHistory(current);
    historyRef.current = next;
    setHistory(next);
    setError(null);
    recordRouteDrawingTrace('route_edit_undo', {
      priorRevision: current.present.revision,
      restoredRevision: next.present.revision,
      undoDepthBefore: current.past.length,
      undoDepthAfter: next.past.length,
      finalGeometry: orderedDraftPoints(next.present),
    }, 'state');
  }, [finishRouteAnimation, hasUncommittedRouteEdit]);

  const applyTrim = useCallback(() => {
    const current = historyRef.current;
    if (!current || current.present.parts.length === 0) return;
    if (trimStart <= 0.001 && trimEnd >= 0.999) return;
    const start = orderedPositionAtDistanceFraction(current.present, trimStart);
    const end = orderedPositionAtDistanceFraction(current.present, trimEnd);
    if (!start || !end) return;
    const operationId = uuidv4();
    selectRouteDrawingOperation(operationId, 'trim');
    recordRouteDrawingTrace('route_trim_started', {
      strokeId: operationId,
      trimFractions: { start: trimStart, end: trimEnd },
      start,
      end,
      preStateGeometry: orderedDraftPoints(current.present),
      preStateDraft: current.present,
      baseRevision: current.present.revision,
      previousMode: modeRef.current,
    }, 'intent');
    const committed = commitResult(trimOrderedDraft(current.present, start, end), 'trim');
    if (committed) {
      setTrimOpen(false);
      setTool('browse');
      setTrimStart(0);
      setTrimEnd(1);
    }
    recordRouteDrawingTrace('route_operation_terminal', {
      strokeId: operationId,
      outcome: committed ? 'committed' : 'failed',
      reason: committed ? null : 'commit-rejected',
      finalMode: committed ? 'Browse' : 'TrimPreview',
      busyReleased: true,
      finalRevision: historyRef.current?.present.revision ?? null,
      finalGeometry: historyRef.current ? orderedDraftPoints(historyRef.current.present) : [],
    }, 'state');
  }, [commitResult, trimEnd, trimStart]);

  const saveRoute = useCallback(async () => {
    const current = historyRef.current;
    if (!current || readOnlyShared) return;
    if (providerBusy || providerTransactionRef.current) { setError('Wait for the current Route edit before saving.'); return; }
    const title = name.trim();
    if (!title) { setError('Name this Route before saving.'); return; }
    if (current.present.parts.length === 0) { setError('Add a path before saving this Route.'); return; }
    const objectKey = `${ownerId}:${routeId ?? current.present.draftId}`;
    const saveToken = saveCoordinatorRef.current.begin(objectKey);
    if (!saveToken) return;
    setSaving(true);
    setMode('Saving');
    setError(null);
    try {
      const points = orderedDraftPoints(current.present);
      const resolutionState = current.present.gaps.length ? 'unresolved_gaps' as const : 'continuous' as const;
      const distanceM = orderedDraftDistanceM(current.present);
      let savedId = routeId;
      if (routeId) {
        await updateRoute(routeId, {
          name: title,
          points,
          orderedDraft: current.present,
          resolutionState,
          distanceM,
          elevationGainM: elevationGain(current.present),
          permission,
        });
      } else {
        const source = fromSessionId ? sessions.find(item => item.id === fromSessionId) : undefined;
        savedId = await addRoute({
          name: title,
          points,
          orderedDraft: current.present,
          resolutionState,
          waypoints: [],
          distanceM,
          elevationGainM: elevationGain(current.present),
          permission: 'personal',
          activityMode: source?.activityMode,
        }, source ? {
          clientActivityId: source.clientActivityId ?? (!/^\d+$/.test(source.id) ? source.id : undefined),
          serverActivityId: source.remoteId ?? source.serverActivityId ?? (/^\d+$/.test(source.id) ? Number(source.id) : undefined),
          reconnectsActivityGap: initialDraftRef.current?.gaps.length !== 0 && current.present.gaps.length === 0,
        } : undefined) ?? undefined;
      }
      if (!savedId) throw new Error('Route save did not complete.');
      savedDraftIdsRef.current.add(current.present.draftId);
      recordRouteDrawingTrace('route_save_succeeded', {
        savedRouteId: savedId,
        draftId: current.present.draftId,
        revision: current.present.revision,
        finalGeometry: points,
        persistedOrderedDraft: current.present,
        undoDepth: current.past.length,
      }, 'persistence');
      endRouteDrawingTrace('saved');
      await removeRoutePlannerDraft(ownerId, current.present.draftId).catch(() => undefined);
      // Replace only the editor so Back returns to the originating Trails /
      // Routes context (tab, query and scroll state remain owned there).
      const live = historyRef.current;
      const currentObjectKey = `${ownerId}:${routeId ?? live?.present.draftId ?? ''}`;
      if (saveCoordinatorRef.current.claimNavigation(saveToken, currentObjectKey)) {
        allowLeaveRef.current = true;
        nav.replace('MapHistory', { routeId: savedId });
      }
    } catch (cause: any) {
      recordRouteDrawingTrace('route_save_failed', {
        draftId: current.present.draftId,
        revision: current.present.revision,
        error: String(cause),
        outcomeUnknown: Boolean(cause?.outcomeUnknown),
      }, 'persistence');
      setError(cause?.outcomeUnknown
        ? 'The save outcome is not confirmed. Stay on this screen and retry Save.'
        : 'This Route could not be saved. Stay on this screen and retry Save.');
    } finally {
      saveCoordinatorRef.current.finish(saveToken);
      setSaving(false);
      setMode('Browse');
    }
  }, [addRoute, fromSessionId, name, nav, ownerId, permission, providerBusy, readOnlyShared, routeId, sessions, updateRoute]);

  const useSharedRoute = useCallback((mode: 'hiking' | 'running') => {
    const shared = sharedRoutes.find(item => item.sharedDeliveryId === sharedDeliveryId);
    if (!shared || !orderedDraftCanUseOrShare(historyRef.current?.present ?? createEmptyOrderedDraft({ draftId: 'invalid', ownerId }))) {
      setError('Repair every unknown gap before using this Route.');
      return;
    }
    captureActivityRouteReference(shared.id);
    nav.navigate(mode === 'running' ? 'Running' : 'Hiking', { routeId: shared.id });
  }, [captureActivityRouteReference, nav, ownerId, sharedDeliveryId, sharedRoutes]);

  if (initializing || !draft) {
    return (
      <View style={[styles.centered, { backgroundColor: theme.background }]}>
        <ActivityIndicator color={theme.primary} />
        <Text style={[styles.helper, { color: theme.foregroundSecondary }]}>Preparing Route…</Text>
        {error ? <Text style={[styles.errorText, { color: theme.destructive }]}>{error}</Text> : null}
      </View>
    );
  }

  const pointActionLabel = draft.parts.length === 0 && !draft.startPoint
    ? 'Set start'
    : 'Add point';
  const trimPreviewResult = (() => {
    if (!trimOpen || draft.parts.length === 0) return null;
    const start = orderedPositionAtDistanceFraction(draft, trimStart);
    const end = orderedPositionAtDistanceFraction(draft, trimEnd);
    if (!start || !end) return null;
    const result = trimOrderedDraft(draft, start, end);
    return result.ok ? result.draft : null;
  })();
  const displayDraft = trimPreviewResult ?? draft;
  // Point reveal ticks update only the transient new-leg overlay. Reuse the
  // immutable canonical Route geometry so a 32 ms clock never rebuilds and
  // reserializes the whole saved path.
  const routeGeometryKey = `${displayDraft.draftId}:${displayDraft.revision}:${trimOpen ? `${trimStart}:${trimEnd}` : 'canonical'}`;
  if (canonicalGeometryCacheRef.current?.key !== routeGeometryKey) {
    canonicalGeometryCacheRef.current = {
      key: routeGeometryKey,
      geometry: canonicalRouteGeometry({ orderedDraft: displayDraft }),
    };
  }
  const routeGeometry = canonicalGeometryCacheRef.current.geometry;
  if (routeTurnbackCacheRef.current?.key !== routeGeometryKey) {
    routeTurnbackCacheRef.current = {
      key: routeGeometryKey,
      turnbacks: buildRouteDisplayGeometry(routeGeometry).turnConnectors,
    };
  }
  const routeTurnbacks = routeTurnbackCacheRef.current.turnbacks;
  const trimOriginalFeature = trimOpen ? {
    type: 'FeatureCollection' as const,
    features: draft.parts.filter(part => part.points.length >= 2).map(part => ({
      type: 'Feature' as const,
      properties: {},
      geometry: { type: 'LineString' as const, coordinates: part.points.map(point => [point.lng, point.lat]) },
    })),
  } : null;
  const animationFeature = routeGrowthAnimation ? {
    type: 'Feature' as const,
    properties: {},
    geometry: {
      type: 'LineString' as const,
      coordinates: routeGrowthAnimation.pathPoints.map(point => [point.lng, point.lat]),
    },
  } : null;
  const routeEndpoints = (() => {
    const start = displayDraft.parts[0]?.points[0] ?? displayDraft.startPoint;
    const end = displayDraft.parts.at(-1)?.points.at(-1);
    if (!start) return [];
    const same = end && routePointDistanceM(start, end) <= 0.35;
    const isTurnback = (point: RoutePoint) => routeTurnbacks.some(turn => (
      routePointDistanceM(point, turn.coordinate) <= 0.5
    ));
    return [{
      type: 'Feature' as const,
      properties: { role: same ? 'Start / End' : 'Start', turnback: isTurnback(start) },
      geometry: { type: 'Point' as const, coordinates: [start.lng, start.lat] },
    }, ...(end && !same ? [{
      type: 'Feature' as const,
      properties: { role: 'End', turnback: isTurnback(end) },
      geometry: { type: 'Point' as const, coordinates: [end.lng, end.lat] },
    }] : [])];
  })();
  const visiblePendingPoints = resolvingDrawPoints;
  const pendingFeature = visiblePendingPoints.length >= 2 ? {
    type: 'Feature' as const,
    properties: {},
    geometry: { type: 'LineString' as const, coordinates: visiblePendingPoints.map(point => [point.lng, point.lat]) },
  } : null;
  const pendingEndpoint = pendingPointTarget ?? visiblePendingPoints.at(-1);
  const pendingEndpointFeature = pendingEndpoint ? {
    type: 'Feature' as const,
    properties: {},
    geometry: {
      type: 'Point' as const,
      coordinates: [pendingEndpoint.lng, pendingEndpoint.lat],
    },
  } : null;
  const contextSurface = theme.mode === 'night' ? '#AAB8A7' : theme.mode === 'sunset' ? '#D8D4B9' : '#DCE5D4';
  const contextInk = '#17372D';
  const routeContextContent = readOnlyShared ? null : trimOpen ? (
    <View style={styles.trimInlineRow} testID="route-trim-strip">
      <View style={styles.trimSliderFrame}>
        <TrimSlider trimStartFrac={trimStart} trimEndFrac={trimEnd} onTrimStartChange={setTrimStart} onTrimEndChange={setTrimEnd} totalLengthM={orderedDraftDistanceM(draft)} />
      </View>
        <TouchableOpacity
          style={[styles.compactPrimaryAction, { backgroundColor: theme.primaryAction }, trimStart <= 0.001 && trimEnd >= 0.999 && styles.disabled]}
          hitSlop={COMPACT_ACTION_HIT_SLOP}
          onPress={applyTrim}
          disabled={trimStart <= 0.001 && trimEnd >= 0.999}
          accessibilityRole="button"
          accessibilityState={{ disabled: trimStart <= 0.001 && trimEnd >= 0.999 }}
          testID="route-trim-apply"
        ><Text style={[styles.compactActionText, { color: theme.onPrimary }]}>Apply</Text></TouchableOpacity>
    </View>
  ) : mode === 'MatchPending' || providerBusy ? (
    <View style={[styles.contextContent, styles.contextProgress]} testID="route-provider-progress">
      <View style={styles.busyRow}><ActivityIndicator size="small" color={contextInk} /><Text style={[styles.contextText, { color: contextInk }]}>Finding a path…</Text></View>
    </View>
  ) : tool === 'point' ? (
    <View style={styles.pointInlineRow} testID="route-point-context">
      <Text style={[styles.contextText, { color: error ? theme.destructive : contextInk }]} numberOfLines={2}>{error ?? 'Move map to choose.'}</Text>
      <TouchableOpacity style={[styles.compactPrimaryAction, { backgroundColor: theme.primaryAction }]} hitSlop={COMPACT_ACTION_HIT_SLOP} onPress={confirmPointTarget} disabled={providerBusy} accessibilityRole="button" accessibilityLabel={pointActionLabel} testID="route-point-confirm"><Text style={[styles.compactActionText, { color: theme.onPrimary }]}>{pointActionLabel}</Text></TouchableOpacity>
    </View>
  ) : error ? (
    <TouchableOpacity style={styles.contextContent} onPress={() => setError(null)} accessibilityRole="button" testID="route-context-message"><Text style={[styles.contextText, { color: contextInk }]}>{error}</Text></TouchableOpacity>
  ) : tool === 'draw' ? (
    <View style={styles.contextContent} testID="route-draw-instruction"><Text style={[styles.contextText, { color: contextInk }]}>{draft.gaps.length > 0 ? 'Draw across the dotted gap to join your route.' : 'Draw to reshape your route.'}</Text></View>
  ) : briefStatus ? (
    <View style={styles.contextContent} testID="route-brief-status"><Text style={[styles.contextText, { color: contextInk }]}>{briefStatus}</Text></View>
  ) : null;

  return (
    <View style={[styles.screen, { backgroundColor: theme.background }]} testID="ordered-route-editor">
      {!MapView ? (
        <View style={[StyleSheet.absoluteFill, styles.centered, { backgroundColor: theme.background }]}>
          <Text style={[styles.helper, { color: theme.foregroundSecondary }]}>Map unavailable</Text>
        </View>
      ) : showPlannerMap ? (
        <MapView
          key={`ordered-route-map-${mapEpoch}`}
          ref={mapViewRef}
          style={StyleSheet.absoluteFill}
          {...(mapStyle.kind === 'url' ? { styleURL: mapStyle.url } : { styleJSON: mapStyle.json })}
          logoEnabled
          attributionEnabled
          logoPosition={routeOrnaments.logoPosition}
          attributionPosition={routeOrnaments.attributionPosition}
          scaleBarEnabled={false}
          compassEnabled={false}
          // Draw owns the one-finger surface while armed. Disabling Mapbox's
          // recognizers removes the native arbitration race that swallowed
          // RNGH strokes on iPhone; Browse restores all map gestures.
          scrollEnabled={tool !== 'draw'}
          zoomEnabled={tool !== 'draw'}
          rotateEnabled={tool !== 'draw'}
          pitchEnabled={tool !== 'draw'}
          onDidFinishLoadingMap={() => setMapLoadState('loading')}
          onDidFinishRenderingMapFully={() => {
            setMapReady(true);
            setMapLoadState('loading');
            confirmRouteFogPaint(true);
          }}
          onDidFinishRenderingFrameFully={() => {
            confirmRouteFogPaint(true);
            const pendingPaint = routeGrowthPendingPaintSampleRef.current;
            if (pendingPaint) {
              routeGrowthPaintedSampleRef.current = {
                progress: pendingPaint.progress,
                head: { ...pendingPaint.head },
                visiblePointCount: pendingPaint.visiblePointCount,
                travelledM: pendingPaint.travelledM,
                totalM: pendingPaint.totalM,
              };
              routeGrowthPendingPaintSampleRef.current = null;
            }
            const overlap = routeGrowthAnimationRef.current;
            if (routeHandoffRenderReadyRef.current && overlap?.canonicalOverlap) {
              routeHandoffRenderReadyRef.current = false;
              finishRouteAnimation('complete');
            }
          }}
          onMapLoadingError={() => {
            // A tile/glyph/resource callback can arrive after a complete scene
            // is already usable. Preserve that safe rendered scene; only an
            // initial style/map failure owns the cold-start error state.
            if (routeSceneEverReadyRef.current
              && routeSceneReadyIdentityRef.current === routeSceneIdentityRef.current) {
              mapViewRef.current?.requestRender?.();
              return;
            }
            setMapReady(false);
            setMapLoadState('error');
          }}
          onCameraChanged={(event: any) => {
            const center = event?.properties?.center;
            if (Array.isArray(center) && center.length >= 2) cameraCenterRef.current = { lng: Number(center[0]), lat: Number(center[1]) };
            const zoom = Number(event?.properties?.zoom);
            if (Number.isFinite(zoom)) cameraZoomRef.current = zoom;
            const bearing = Number(event?.properties?.heading ?? event?.properties?.bearing);
            if (Number.isFinite(bearing)) cameraBearingRef.current = bearing;
            const pitch = Number(event?.properties?.pitch);
            if (Number.isFinite(pitch)) cameraPitchRef.current = pitch;
            cameraGenerationRef.current += 1;
            const activeAnimation = routeGrowthAnimationRef.current;
            const entryTarget = routePointEntryTargetRef.current;
            if (activeAnimation && entryTarget && routePointEntryReadyRef.current
              && Array.isArray(center) && center.length >= 2
              && routePointDistanceM(entryTarget, { lng: Number(center[0]), lat: Number(center[1]) }) <= 2) {
              // Do not re-enter Mapbox easeTo from inside its move callback.
              // The following idle confirms the entry transaction has fully
              // settled before the route-follow sequence starts.
              routePointEntryArrivedRef.current = true;
            }
            const now = Date.now();
            const webPerformanceProbeActive = Platform.OS === 'web'
              && Boolean((globalThis as typeof globalThis & { __o86PointAnimationMeasuring?: boolean }).__o86PointAnimationMeasuring);
            if (activeAnimation && isRouteDrawingDiagnosticsEnabled()
              && !webPerformanceProbeActive
              && now - lastAnimationCameraTraceAtRef.current >= 100) {
              lastAnimationCameraTraceAtRef.current = now;
              const paintedSample = routeGrowthPaintedSampleRef.current;
              const visibleHead = paintedSample?.head ?? activeAnimation.head;
              const expectedCenter = {
                x: activeAnimation.expectedScreenCenter.x,
                y: activeAnimation.expectedScreenCenter.y,
              };
              const cameraCenter = Array.isArray(center) && center.length >= 2
                ? { lng: Number(center[0]), lat: Number(center[1]) }
                : null;
              const snapshot = {
                animationId: activeAnimation.key,
                progress: paintedSample?.progress ?? activeAnimation.progress,
                logicalProgress: activeAnimation.progress,
                head: visibleHead,
                cameraCenter,
                geographicHeadCenterErrorM: cameraCenter
                  ? routePointDistanceM(visibleHead, cameraCenter)
                  : null,
                expectedUnobscuredScreenCenter: expectedCenter,
                isUserInteraction: Boolean(event?.properties?.isUserInteraction
                  || event?.properties?.gestures?.isGestureActive),
              };
              const project = mapViewRef.current?.getPointInView;
              if (typeof project === 'function') {
                void Promise.resolve(project.call(mapViewRef.current, [visibleHead.lng, visibleHead.lat]))
                  .then((screenPoint: unknown) => {
                    const values = Array.isArray(screenPoint) ? screenPoint.map(Number) : [];
                    recordRouteDrawingTrace('route_point_camera_observed', {
                      ...snapshot,
                      headScreenPoint: values.length >= 2 ? { x: values[0], y: values[1] } : null,
                      headScreenCenterErrorPx: values.length >= 2
                        ? Math.hypot(values[0] - expectedCenter.x, values[1] - expectedCenter.y)
                        : null,
                    }, 'state');
                  })
                  .catch(cause => recordRouteDrawingTrace('route_point_camera_observed', {
                    ...snapshot,
                    projectionError: String(cause).slice(0, 120),
                  }, 'state'));
              } else {
                recordRouteDrawingTrace('route_point_camera_observed', snapshot, 'state');
              }
            }
            if (event?.properties?.isUserInteraction || event?.properties?.gestures?.isGestureActive) {
              userMovedCameraRef.current = true;
              userCameraInteractionGenerationRef.current += 1;
              finishRouteAnimation('user-camera');
            }
          }}
          onMapIdle={(event: any) => {
            // Point owns the camera continuously while its accepted path is
            // revealed. Intermediate Mapbox idle notifications are animation
            // frames, not user viewport decisions; treating each as a new
            // Memory viewport causes redundant React/network/geometry work
            // and steals frame budget from the visible head. The final jump
            // emits idle after finishRouteAnimation clears this ref, so the
            // settled viewport is still loaded exactly once.
            if (routeGrowthAnimationRef.current && routePointEntryReadyRef.current) {
              const center = event?.properties?.center;
              const target = routePointEntryTargetRef.current;
              if (routePointEntryArrivedRef.current && target && Array.isArray(center) && center.length >= 2
                && routePointDistanceM(target, { lng: Number(center[0]), lat: Number(center[1]) }) <= 2) {
                routePointEntryReadyRef.current();
              }
              return;
            }
            if (routeGrowthAnimationRef.current) return;
            const center = event?.properties?.center;
            const zoom = Number(event?.properties?.zoom);
            if (!Array.isArray(center) || center.length < 2 || !Number.isFinite(zoom)) return;
            const next = memoryCoverageViewport(
              { lng: Number(center[0]), lat: Number(center[1]) },
              zoom,
              viewportWidth,
              Math.max(1, viewportHeight - bottomClearance),
            );
            setMemoryCoverageView(current => current?.key === next.key ? current : next);
          }}
        >
          {StyleImport ? <StyleImport
            key={lightPreset}
            id="basemap"
            existing
            config={{
              ...buildStandardConfig(mapTheme),
              ...((Platform.OS !== 'web' && (routeGrowthAnimation || (providerBusy && tool === 'point'))) ? {
                showTransitLabels: false,
                showPlaceLabels: false,
                showPointOfInterestLabels: false,
                showRoadLabels: false,
              } : {}),
            } as any}
          /> : null}
          {Camera ? initialBoundsRef.current ? (
            <Camera
              ref={cameraRef}
              defaultSettings={{
                bounds: {
                  ...initialBoundsRef.current,
                  paddingTop: insets.top + 100,
                  paddingBottom: bottomClearance + 30,
                  paddingLeft: 40,
                  // Keep Route endpoints and labels clear of the four 44pt map
                  // controls anchored 16pt from the right edge.
                  paddingRight: 88,
                },
                animationDuration: 0,
              }}
            />
          ) : <Camera ref={cameraRef} defaultSettings={{ centerCoordinate: initialLocationCenter, zoomLevel: initialLocation.status === 'ready' ? 14 : Math.max(region.defaultZoom, 10), animationDuration: 0 }} /> : null}
          {UserLocation && locationPermissionGranted ? (
            <UserLocation visible={mapReady} animated>
              <CircleLayer
                id="ordered-route-user-location-ring"
                slot="top"
                style={{
                  circleRadius: ['interpolate', ['linear'], ['zoom'], 4, 2.5, 10, 4.5, 14, 7, 18, 9],
                  circleColor: '#FFFFFF',
                  circlePitchAlignment: 'map',
                }}
              />
              <CircleLayer
                id="ordered-route-user-location-dot"
                slot="top"
                style={{
                  circleRadius: ['interpolate', ['linear'], ['zoom'], 4, 1.6, 10, 3, 14, 5, 18, 6.5],
                  circleColor: 'rgba(51, 181, 229, 1)',
                  circlePitchAlignment: 'map',
                }}
              />
            </UserLocation>
          ) : null}
          <FogLayer
            scopeOverride={planningMemoryScope} opacityScale={0.42}
            viewport={memoryCoverageView}
            onFogPreparing={(readinessKey, retainsDisplayedScene) => {
              routeFogTargetKeyRef.current = readinessKey;
              routeFogGeometryReadyKeyRef.current = '';
              routeFogPaintReadyKeyRef.current = '';
              routeFogUnavailableCandidateKeyRef.current = '';
              routeFogRequiredSourceIdsRef.current = ['memory-fog-src'];
              setRouteFogTargetKey(readinessKey);
              setRouteFogUnavailableKey('');
              if (!retainsDisplayedScene) setRouteFogReadyKey('');
              setRouteFogPending(true);
            }}
            onFogReady={(readinessKey, requiredSourceIds) => {
              if (routeFogTargetKeyRef.current !== readinessKey) return;
              routeFogGeometryReadyKeyRef.current = readinessKey;
              routeFogUnavailableCandidateKeyRef.current = '';
              routeFogRequiredSourceIdsRef.current = requiredSourceIds;
              mapViewRef.current?.requestRender?.();
            }}
            onFogUnavailable={(readinessKey) => {
              if (routeFogTargetKeyRef.current !== readinessKey) return;
              // FogLayer has already synchronously committed a fail-closed
              // Mine-only/solid fallback. Retire the cold veil only after a
              // subsequent Mapbox frame proves that replacement is painted.
              routeFogGeometryReadyKeyRef.current = readinessKey;
              routeFogUnavailableCandidateKeyRef.current = readinessKey;
              routeFogRequiredSourceIdsRef.current = ['memory-fog-src'];
              mapViewRef.current?.requestRender?.();
            }}
          />
          {ShapeSource && LineLayer && trimOriginalFeature ? (
            <ShapeSource id="ordered-route-trim-original" shape={trimOriginalFeature}>
              <LineLayer id="ordered-route-trim-original-line" slot="top" style={{ lineColor: theme.foregroundSecondary, lineWidth: 7, lineOpacity: 0.34, lineDasharray: [1.5, 1.2], lineCap: 'round', lineJoin: 'round' }} />
            </ShapeSource>
          ) : null}
          <CanonicalRouteLayer
            geometry={routeGeometry}
            theme={theme}
            ShapeSource={ShapeSource}
            LineLayer={LineLayer}
            SymbolLayer={SymbolLayer}
            idPrefix="ordered-route"
            hiddenPartId={routeGrowthAnimation?.canonicalOverlap ? undefined : routeGrowthAnimation?.hiddenPartId}
          />
          {ShapeSource && LineLayer && animationFeature ? (
            <ShapeSource ref={routeGrowthSourceRef} id="ordered-route-growth" shape={animationFeature} lineMetrics>
              <LineLayer ref={routeGrowthLineRef} id="ordered-route-growth-line" slot="top" style={{ lineColor: theme.mapRouteLine, lineWidth: 6, lineCap: 'round', lineJoin: 'round', lineTrimOffset: [0, 1] }} />
            </ShapeSource>
          ) : null}
          {ShapeSource && LineLayer && pendingFeature ? (
            <ShapeSource id="ordered-route-pending" shape={pendingFeature}>
              <LineLayer id="ordered-route-pending-line" slot="top" style={{ lineColor: theme.mapRoutePending, lineWidth: 5, lineDasharray: [1.5, 1.2], lineOpacity: 0.9, lineCap: 'round', lineJoin: 'round' }} />
            </ShapeSource>
          ) : null}
          {ShapeSource && CircleLayer && pendingEndpointFeature ? (
            <ShapeSource id="ordered-route-pending-endpoint" shape={pendingEndpointFeature}>
              <CircleLayer id="ordered-route-pending-endpoint-circle" slot="top" style={{ circleRadius: 8, circleColor: theme.surfaceElevated, circleStrokeColor: theme.mapRoutePending, circleStrokeWidth: 3 }} />
            </ShapeSource>
          ) : null}
          {ShapeSource && CircleLayer && routeEndpoints.length ? (
            <ShapeSource id="ordered-route-endpoints" shape={{ type: 'FeatureCollection', features: routeEndpoints }}>
              <CircleLayer id="ordered-route-endpoint-circles" slot="top" style={{
                // At an endpoint that was also an earlier real turnback, keep
                // Start/End legible without covering the display-only U.
                circleRadius: ['case', ['boolean', ['get', 'turnback'], false], 3, 7],
                circleColor: theme.surfaceElevated,
                circleStrokeColor: theme.mapRouteLine,
                circleStrokeWidth: ['case', ['boolean', ['get', 'turnback'], false], 1.5, 3],
              }} />
              {SymbolLayer ? <SymbolLayer id="ordered-route-endpoint-labels" slot="top" style={{ textField: ['get', 'role'], textSize: 11, textOffset: [0, 1.55], textColor: theme.foreground, textHaloColor: theme.surfaceElevated, textHaloWidth: 1.5, textAllowOverlap: true }} /> : null}
            </ShapeSource>
          ) : null}
          {ShapeSource && CircleLayer && draft.startPoint && draft.parts.length === 0 ? (
            <ShapeSource id="ordered-route-start" shape={{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [draft.startPoint.lng, draft.startPoint.lat] } }}>
              <CircleLayer id="ordered-route-start-ring" slot="top" style={{ circleRadius: 8, circleColor: theme.surfaceElevated, circleStrokeColor: theme.mapRouteLine, circleStrokeWidth: 3 }} />
            </ShapeSource>
          ) : null}
        </MapView>
      ) : null}
      {MapView && showPlannerMap && !routeSceneReady && !routeSceneEverReady ? (
        <MapLoadOverlay
          state={mapLoadState}
          onRetry={retryRouteScene}
          testID="ordered-route-map-load-overlay"
        />
      ) : null}
      {MapView && !showPlannerMap ? (
        <View style={[StyleSheet.absoluteFill, styles.centered, { backgroundColor: theme.background }]} testID="route-initial-location-state">
          <ActivityIndicator color={theme.primary} />
          <Text style={[styles.helper, { color: theme.foregroundSecondary }]}>Finding your current location…</Text>
          <Text style={[styles.initialLocationHint, { color: theme.muted }]}>Your map will open as soon as location is ready.</Text>
        </View>
      ) : null}

      {routeSceneEverReady && (showRouteFogPending || (
        (routeFriendProjectionFailure || routeFriendAuthorizationLost)
        && routeFogReadyKey !== routeFogTargetKey
      )) ? (
        <View
          testID="route-scene-status"
          accessibilityRole="summary"
          style={[styles.routeSceneStatus, { backgroundColor: theme.mapOverlay, borderColor: theme.borderStrong }]}
        >
          {showRouteFogPending ? <ActivityIndicator size="small" color={theme.primary} /> : null}
          <Text style={[styles.routeSceneStatusText, { color: theme.foreground }]} numberOfLines={2}>
            {showRouteFogPending
              ? 'Updating exploration…'
              : routeFriendAuthorizationLost
                ? 'Friend exploration is no longer authorized. Mine remains visible.'
                : 'Shared exploration could not refresh. Mine remains visible.'}
          </Text>
          {!showRouteFogPending && routeFriendProjectionFailure ? (
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Retry shared exploration"
              onPress={retryRouteScene}
              style={[styles.routeSceneRetry, { borderColor: theme.borderStrong }]}
              testID="route-scene-retry"
            >
              <Text style={[styles.routeSceneRetryText, { color: theme.primary }]}>Retry</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      ) : null}

      <View style={[styles.mapTools, { top: insets.top + (compactViewport ? 72 : 128) }]}>
        <TouchableOpacity
          style={[styles.mapToolButton, { backgroundColor: theme.mapOverlay, borderColor: theme.border }]}
          onPress={() => { void showCurrentLocation(); }}
          accessibilityRole="button"
          accessibilityLabel="Center map on current location"
          testID="route-current-location"
        ><Icon name="Target" size={19} color={theme.iconActive} /></TouchableOpacity>
        <TouchableOpacity
          style={[styles.mapToolButton, { backgroundColor: theme.mapOverlay, borderColor: theme.border }]}
          onPress={showRouteOverview}
          accessibilityRole="button"
          accessibilityLabel="Show Route overview"
          testID="route-overview"
        ><Icon name="Route" size={19} color={theme.iconActive} /></TouchableOpacity>
        {!readOnlyShared ? (
          <TouchableOpacity
            style={[styles.mapToolButton, {
              backgroundColor: moreOpen ? theme.controlSelected : theme.mapOverlay,
              borderColor: moreOpen ? theme.primary : theme.border,
            }]}
            onPress={() => {
              setMoreOpen(value => !value);
              void loadMemorySubscriptions();
            }}
            accessibilityRole="button"
            accessibilityLabel="Exploration layers"
            accessibilityState={{ selected: moreOpen, expanded: moreOpen }}
            testID="route-more"
          ><Icon name="Layers" size={19} color={moreOpen ? theme.primary : theme.iconActive} /></TouchableOpacity>
        ) : null}
      </View>

      {moreOpen && !readOnlyShared ? (
        <View style={[styles.morePopover, { top: insets.top + (compactViewport ? 72 : 128), backgroundColor: theme.surfaceElevated, borderColor: theme.border, shadowColor: theme.shadow }]} testID="route-more-menu">
          <Text style={[styles.popoverTitle, { color: theme.foreground }]}>Map & Route</Text>
          <Text style={[styles.popoverLabel, { color: theme.foregroundSecondary }]}>Exploration Fog</Text>
          <View style={styles.popoverRow}>
            <TouchableOpacity
              style={[styles.popoverChoice, { borderColor: planningMemoryScope === 'self' ? theme.primary : theme.borderSubtle, backgroundColor: planningMemoryScope === 'self' ? theme.controlSelected : theme.surface }]}
              onPress={() => setPlanningMemoryScope('self')}
              accessibilityRole="radio"
              accessibilityState={{ selected: planningMemoryScope === 'self' }}
            ><Text style={[styles.popoverChoiceText, { color: theme.foreground }]}>Mine</Text></TouchableOpacity>
            <TouchableOpacity
              style={[styles.popoverChoice, { borderColor: planningMemoryScope === 'combined' ? theme.primary : theme.borderSubtle, backgroundColor: planningMemoryScope === 'combined' ? theme.controlSelected : theme.surface }, memorySubscriptions.length === 0 && styles.disabled]}
              disabled={memorySubscriptions.length === 0}
              onPress={() => setPlanningMemoryScope('combined')}
              accessibilityRole="radio"
              accessibilityLabel="Mine and Friends exploration"
              accessibilityState={{
                selected: planningMemoryScope === 'combined',
                disabled: memorySubscriptions.length === 0,
              }}
            >
              <Text style={[styles.popoverChoiceText, { color: theme.foreground }]}>Mine &amp; Friends</Text>
            </TouchableOpacity>
          </View>
          <TouchableOpacity
            style={[styles.friendPickerAction, { borderColor: theme.borderSubtle, backgroundColor: theme.surface }]}
            onPress={() => setRouteFriendPickerOpen(true)}
            accessibilityRole="button"
            accessibilityLabel={`Choose Friends contributors, ${memorySubscriptions.length} selected`}
            testID="route-friend-picker-open"
          >
            <Text style={[styles.popoverChoiceText, { color: theme.foreground }]}>Friends</Text>
            <Text style={[styles.friendPickerCount, { color: theme.primary }]}>{memorySubscriptions.length} selected</Text>
          </TouchableOpacity>
          {memorySubscriptions.length === 0 ? (
            <Text style={[styles.popoverHint, { color: theme.foregroundSecondary }]}>No shared Friend Fog is available. Mine stays visible.</Text>
          ) : null}
        </View>
      ) : null}

      <View style={[
        styles.topBar,
        { paddingTop: insets.top + Spacing.lg, paddingBottom: Spacing.xs },
      ]} pointerEvents="box-none" testID="route-editor-header">
        <BackButton variant="inline" onPress={() => nav.goBack()} />
        <Text testID="route-editor-title" pointerEvents="none" style={[styles.topTitle, { color: theme.foreground }]}>{readOnlyShared ? 'Shared Route' : routeId ? 'Edit Route' : 'Create Route'}</Text>
        <View style={styles.topUtilityPlaceholder} />
      </View>

      {tool === 'point' && !readOnlyShared ? (
        <View pointerEvents="none" style={styles.centerTarget}>
          <View style={[styles.targetRing, { borderColor: theme.primary }]} />
          <View style={[styles.targetDot, { backgroundColor: theme.primary }]} />
        </View>
      ) : null}

      <RouteDrawOverlay
        active={tool === 'draw' && !readOnlyShared}
        mapViewRef={mapViewRef}
        onDrawingStart={() => setMode('Drawing')}
        onStroke={(points, capture) => { void handleDrawStroke(points, capture); }}
        onCancel={(reason, capture) => {
          const strokeId = capture?.strokeId ?? uuidv4();
          selectRouteDrawingOperation(strokeId, 'draw');
          recordRouteDrawingTrace('route_draw_raw_samples', {
            strokeId,
            inputBoundary: 'native-rngh-cancelled',
            startedAtMs: capture?.startedAtMs ?? null,
            endedAtMs: capture?.endedAtMs ?? null,
            sampleCapacity: capture?.sampleCapacity ?? null,
            droppedSampleCount: capture?.droppedSampleCount ?? null,
            viewportWidth,
            viewportHeight,
            projectionCoordinateSpace: 'absolute-window-minus-measured-map-origin',
            pixelRatio: capture?.samples.find(sample => sample.pixelRatio)?.pixelRatio ?? null,
            mapOrigin: capture?.samples[0]
              ? {
                  x: capture.samples[0].mapOriginX ?? null,
                  y: capture.samples[0].mapOriginY ?? null,
                  measured: capture.samples[0].mapOriginMeasured ?? false,
                }
              : null,
            projectionFailures: capture?.samples.filter(sample => !sample.geographic).length ?? null,
            samples: capture?.samples ?? [],
          }, 'raw-input');
          recordRouteDrawingTrace('route_draw_native_cancelled', { strokeId, reason }, 'state');
          recordRouteDrawingTrace('route_operation_terminal', {
            strokeId,
            outcome: 'cancelled',
            reason,
            finalMode: 'Browse',
            busyReleased: true,
          }, 'state');
          setMode('Browse');
          setError(reason === 'gesture-interrupted'
            ? 'Stroke cancelled. Move the map, then tap Draw to try again.'
            : 'The map could not read that stroke. Your Route is unchanged.');
        }}
        bottomInset={bottomClearance}
        strokeColor={theme.primary}
      />

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.bottomWrap} pointerEvents="box-none">
        <View style={[
          styles.bottomCard,
          compactViewport && styles.bottomCardCompact,
          { paddingBottom: insets.bottom + (compactViewport ? Spacing.sm : Spacing.md), backgroundColor: theme.surfaceElevated, borderColor: theme.border, shadowColor: theme.shadow },
        ]} onLayout={handleBottomWorkspaceLayout}>
          {readOnlyShared ? (
            <>
              {error ? <Text style={[styles.helper, { color: theme.destructive }]}>{error}</Text> : null}
              <View style={[styles.summary, compactViewport && styles.summaryCompact, { backgroundColor: theme.surface, borderColor: theme.borderSubtle }]}>
                <Text style={[styles.nameReadOnly, { color: theme.foreground }]}>{name}</Text>
                <Text style={[styles.helper, { color: theme.foregroundSecondary }]}>Independent snapshot · {dist.format(orderedDraftDistanceM(draft), 1)} {dist.unit}</Text>
              </View>
              <View style={styles.row}>
                <PrimaryButton label="Use for Hike" onPress={() => useSharedRoute('hiking')} style={styles.flexButton} disabled={!orderedDraftCanUseOrShare(draft)} />
                <PrimaryButton label="Use for Run" variant="secondary" onPress={() => useSharedRoute('running')} style={styles.flexButton} disabled={!orderedDraftCanUseOrShare(draft)} />
              </View>
              <View style={styles.row}>
                <PrimaryButton label="Edit a copy" variant="secondary" onPress={() => nav.replace('RouteEditor', { sharedDeliveryId, creationSource: 'shared-copy' })} style={styles.flexButton} />
                <PrimaryButton label="Remove" variant="destructive" onPress={() => { void removeSharedRoute(sharedDeliveryId!).then(() => nav.goBack()); }} style={styles.flexButton} />
              </View>
            </>
          ) : (
            <>
              {routeContextContent ? (
                <View style={[styles.contextPanel, largeType && styles.contextPanelLargeType, { backgroundColor: contextSurface, borderColor: 'rgba(23,55,45,0.22)' }]} testID="route-context-slot">
                  {routeContextContent}
                </View>
              ) : null}
              <View style={styles.toolRow}>
                <TouchableOpacity style={[styles.toolButton, { borderColor: tool === 'draw' ? theme.primary : theme.borderSubtle, backgroundColor: tool === 'draw' ? theme.controlSelected : theme.surface }]} onPress={() => selectEditorTool(tool === 'draw' ? 'browse' : 'draw')} accessibilityRole="button" accessibilityState={{ selected: tool === 'draw' }} testID="route-tool-draw">
                  <Icon name="Pencil" size={20} color={theme.iconActive} /><Text style={[styles.toolLabel, { color: theme.foreground }]}>Draw</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.toolButton, { borderColor: tool === 'point' ? theme.primary : theme.borderSubtle, backgroundColor: tool === 'point' ? theme.controlSelected : theme.surface }]} onPress={() => selectEditorTool(tool === 'point' ? 'browse' : 'point')} accessibilityRole="button" accessibilityState={{ selected: tool === 'point' }} testID="route-tool-point">
                  <Icon name="MapPin" size={20} color={theme.iconActive} /><Text style={[styles.toolLabel, { color: theme.foreground }]}>Point</Text>
                </TouchableOpacity>
                <TouchableOpacity disabled={draft.parts.length === 0} style={[styles.toolButton, { borderColor: tool === 'trim' ? theme.primary : theme.borderSubtle, backgroundColor: tool === 'trim' ? theme.controlSelected : theme.surface }, draft.parts.length === 0 && styles.disabled]} onPress={() => selectEditorTool(tool === 'trim' ? 'browse' : 'trim')} accessibilityRole="button" accessibilityState={{ selected: tool === 'trim', disabled: draft.parts.length === 0 }} testID="route-tool-trim">
                  <Icon name="Move" size={20} color={theme.iconActive} /><Text style={[styles.toolLabel, { color: theme.foreground }]}>Trim</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.undoButton, { borderColor: theme.borderSubtle, backgroundColor: theme.surface }, (!history || (history.past.length === 0 && !trimOpen) || hasUncommittedRouteEdit) && styles.disabled]}
                  onPress={handleUndo}
                  disabled={!history || (history.past.length === 0 && !trimOpen) || hasUncommittedRouteEdit}
                  accessibilityRole="button"
                  accessibilityLabel="Undo last Route edit"
                  accessibilityState={{ disabled: !history || (history.past.length === 0 && !trimOpen) || hasUncommittedRouteEdit }}
                  testID="route-undo"
                >
                  <Icon name="Undo2" size={18} color={!history || (history.past.length === 0 && !trimOpen) || hasUncommittedRouteEdit ? theme.iconInactive : theme.iconActive} strokeWidth={2.2} />
                </TouchableOpacity>
              </View>
              <View style={styles.nameSaveRow} testID="route-name-save-row">
                <View style={[styles.nameInputFrame, { backgroundColor: theme.inputSurface, borderColor: theme.borderSubtle }]}>
                  <TextInput
                    value={name}
                    onChangeText={setName}
                    placeholder="Route name"
                    placeholderTextColor={theme.muted}
                    style={[styles.nameInput, compactViewport && styles.nameInputCompact, { color: theme.foreground }]}
                    accessibilityLabel="Route name"
                  />
                  <View pointerEvents="none" style={styles.nameEditAffordance}><Icon name="Edit3" size={15} color={theme.iconActive} strokeWidth={2} /></View>
                </View>
                <TouchableOpacity
                  style={[styles.compactSaveAction, { backgroundColor: theme.primaryAction }, (draft.parts.length === 0 || !name.trim() || hasUncommittedRouteEdit) && styles.disabled]}
                  onPress={() => { void saveRoute(); }}
                  disabled={saving || draft.parts.length === 0 || !name.trim() || hasUncommittedRouteEdit}
                  testID="ordered-route-save"
                >{saving ? <ActivityIndicator size="small" color={theme.onPrimary} /> : <Icon name="Check" size={16} color={theme.onPrimary} />}<Text style={[styles.compactActionText, { color: theme.onPrimary }]}>Save</Text></TouchableOpacity>
              </View>
            </>
          )}
        </View>
      </KeyboardAvoidingView>

      <ModalCard
        visible={pendingLeave !== null}
        onDismiss={() => setPendingLeave(null)}
        presentation="confirmation"
        testID="route-editor-leave-confirm"
      >
        <ModalCardHeader
          title={pendingLeave?.decision === 'confirm-saving' ? 'Leave while saving?' : 'Discard Route changes?'}
          body={pendingLeave?.decision === 'confirm-saving'
            ? 'The save may still finish, but this screen will not move you after you leave.'
            : 'Your unsaved Route changes will be discarded.'}
          onClose={() => setPendingLeave(null)}
        />
        <View style={styles.confirmBody}>
          <PrimaryButton label="Keep editing" variant="secondary" onPress={() => setPendingLeave(null)} />
          <PrimaryButton
            label={pendingLeave?.decision === 'confirm-saving' ? 'Leave' : 'Discard changes'}
            variant="destructive"
            onPress={() => {
              if (!pendingLeave) return;
              const { decision, action } = pendingLeave;
              setPendingLeave(null);
              executeRouteEditorLeaveChoice(
                decision,
                decision === 'confirm-saving' ? 'leave-saving' : 'discard',
                {
                  discardDraft: abandonUnsavedCreation,
                  suppressLateNavigation: () => saveCoordinatorRef.current.suppressLateNavigation(),
                  allowAndDispatch: () => {
                    allowLeaveRef.current = true;
                    if (action && nav.dispatch) nav.dispatch(action);
                    else nav.goBack();
                  },
                },
              );
            }}
            testID="route-editor-confirm-leave"
          />
        </View>
      </ModalCard>
      <MemoryFriendPickModal
        visible={routeFriendPickerOpen}
        onClose={() => setRouteFriendPickerOpen(false)}
        activateCombinedOnSelect={false}
      />

    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.md, padding: Spacing.xl },
  topBar: { position: 'absolute', top: 0, left: 0, right: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.sm, paddingHorizontal: Spacing.base, zIndex: 40, borderBottomWidth: 0 },
  topTitle: { flex: 1, fontSize: FontSize.h3, fontWeight: '700', textAlign: 'center' },
  topSubtitle: { marginTop: 2, fontSize: FontSize.tiny, fontWeight: '600' },
  topUtility: { width: 44, height: 44, borderRadius: 22, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  topUtilityPlaceholder: { width: 44, height: 44 },
  mapTools: { position: 'absolute', right: Spacing.md, zIndex: 9, gap: Spacing.sm },
  mapToolButton: { width: 44, height: 44, borderRadius: 22, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  compactMapAction: { minHeight: 36, minWidth: 96, borderRadius: RadiusRole.button, borderWidth: 1, paddingHorizontal: Spacing.sm, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', alignSelf: 'flex-end', gap: 4 },
  compactMapActionText: { fontSize: FontSize.caption, fontWeight: '800' },
  morePopover: { position: 'absolute', right: 68, width: 224, zIndex: 12, borderWidth: 1, borderRadius: RadiusRole.card, padding: Spacing.md, gap: Spacing.sm, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.16, shadowRadius: 12, elevation: 8 },
  popoverTitle: { fontSize: FontSize.body, fontWeight: '800' },
  popoverLabel: { fontSize: FontSize.small, fontWeight: '600' },
  popoverRow: { flexDirection: 'row', gap: Spacing.xs, flexWrap: 'wrap' },
  friendPickerAction: { minHeight: 44, borderWidth: 1, borderRadius: RadiusRole.button, paddingHorizontal: Spacing.sm, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  friendPickerCount: { fontSize: FontSize.caption, fontWeight: '700' },
  popoverChoice: { minHeight: 44, borderWidth: 1, borderRadius: RadiusRole.button, paddingHorizontal: Spacing.sm, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5 },
  popoverChoiceText: { fontSize: FontSize.small, fontWeight: '700' },
  popoverHint: { fontSize: FontSize.small, lineHeight: 17 },
  popoverAction: { minHeight: 38, borderTopWidth: StyleSheet.hairlineWidth, paddingTop: Spacing.sm, marginTop: Spacing.xs, flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  popoverActionText: { fontSize: FontSize.caption, fontWeight: '700' },
  // This target deliberately matches Mapbox's camera center. The bottom card
  // does not change the camera coordinate; camera padding is only used for the
  // one-time initial fit, so the visual target and confirmed coordinate agree.
  centerTarget: { position: 'absolute', left: '50%', top: '50%', width: 34, height: 34, marginLeft: -17, marginTop: -17, alignItems: 'center', justifyContent: 'center', zIndex: 8 },
  routeSceneStatus: { position: 'absolute', left: '50%', top: '50%', width: 244, minHeight: 40, marginLeft: -122, marginTop: -20, borderWidth: StyleSheet.hairlineWidth, borderRadius: RadiusRole.button, paddingHorizontal: Spacing.sm, paddingVertical: 7, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm, zIndex: 20 },
  routeSceneStatusText: { flexShrink: 1, fontSize: FontSize.small, lineHeight: 17, fontWeight: '600', textAlign: 'center' },
  routeSceneRetry: { minHeight: 32, borderWidth: 1, borderRadius: RadiusRole.button, paddingHorizontal: Spacing.sm, alignItems: 'center', justifyContent: 'center' },
  routeSceneRetryText: { fontSize: FontSize.caption, fontWeight: '800' },
  targetRing: { width: 30, height: 30, borderRadius: 15, borderWidth: 2, backgroundColor: 'rgba(255,255,255,0.35)' },
  targetDot: { position: 'absolute', width: 6, height: 6, borderRadius: 3 },
  bottomWrap: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  bottomCard: { borderTopLeftRadius: 20, borderTopRightRadius: 20, borderWidth: 1, paddingHorizontal: Spacing.base, paddingTop: Spacing.sm, gap: Spacing.sm, elevation: 10 },
  bottomCardCompact: { paddingHorizontal: Spacing.sm, paddingTop: 6, gap: 6 },
  summary: { borderWidth: 1, borderRadius: RadiusRole.card, paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm },
  summaryCompact: { paddingHorizontal: Spacing.sm, paddingVertical: 2 },
  nameInput: { flex: 1, minHeight: 40, fontSize: FontSize.body, fontWeight: '700', paddingLeft: Spacing.md, paddingRight: 38, paddingVertical: 0 },
  nameInputCompact: { fontSize: FontSize.body, lineHeight: 20 },
  nameInputFrame: { flex: 1, minWidth: 0, minHeight: 44, borderWidth: 1, borderRadius: RadiusRole.input, justifyContent: 'center' },
  nameEditAffordance: { position: 'absolute', right: 12, width: 20, height: 20, alignItems: 'center', justifyContent: 'center' },
  nameSaveRow: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  nameReadOnly: { fontSize: FontSize.h3, fontWeight: '700', marginBottom: Spacing.xs },
  helper: { fontSize: FontSize.small, lineHeight: 18 },
  initialLocationHint: { maxWidth: 280, fontSize: FontSize.small, lineHeight: 18, textAlign: 'center' },
  errorText: { fontSize: FontSize.small, textAlign: 'center' },
  notice: { minHeight: 42, borderRadius: RadiusRole.input, padding: Spacing.sm, flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  noticeText: { flex: 1, fontSize: FontSize.small, fontWeight: '600' },
  busyRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  gapNotice: { borderWidth: 1, borderRadius: RadiusRole.input, padding: Spacing.sm, gap: Spacing.xs },
  gapHeading: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
  gapTitle: { fontSize: FontSize.body, fontWeight: '700' },
  chipRow: { gap: Spacing.sm, paddingTop: Spacing.xs },
  chip: { minHeight: 36, borderRadius: 18, borderWidth: 1, justifyContent: 'center', paddingHorizontal: Spacing.md },
  chipText: { fontSize: FontSize.small, fontWeight: '700' },
  toolRow: { minHeight: 44, flexDirection: 'row', gap: 6 },
  toolButton: { flex: 1, minHeight: 44, borderWidth: 1, borderRadius: RadiusRole.button, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5 },
  undoButton: { width: 44, height: 44, borderWidth: 1, borderRadius: RadiusRole.button, alignItems: 'center', justifyContent: 'center' },
  toolLabel: { fontSize: FontSize.small, fontWeight: '700' },
  disabled: { opacity: 0.42 },
  pointActions: { gap: Spacing.sm, alignItems: 'center' },
  linkText: { fontSize: FontSize.small, fontWeight: '700', padding: Spacing.xs },
  trimStrip: { borderWidth: 1, borderRadius: RadiusRole.card, paddingHorizontal: Spacing.sm, paddingTop: Spacing.sm, paddingBottom: Spacing.xs },
  trimHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.sm },
  // One fixed slot prevents the map/dock boundary from stepping when Draw,
  // Point, provider progress and the taller 44pt Trim hit target alternate.
  contextPanel: { height: 62, borderWidth: 1, borderRadius: RadiusRole.card, paddingHorizontal: Spacing.sm, paddingVertical: 4, justifyContent: 'center' },
  contextPanelLargeType: { height: 'auto', minHeight: 72 },
  contextContent: { justifyContent: 'center', gap: 8 },
  pointInlineRow: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.sm },
  trimInlineRow: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  trimSliderFrame: { flex: 1, minWidth: 0, paddingHorizontal: 2 },
  contextProgress: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  contextText: { flexShrink: 1, fontSize: FontSize.small, lineHeight: 18, fontWeight: '600' },
  compactActionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: Spacing.sm },
  decisionInlineRow: { minHeight: 36, flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  compactSecondaryAction: { minHeight: 32, alignSelf: 'center', borderWidth: 1, borderRadius: RadiusRole.button, paddingHorizontal: Spacing.md, paddingVertical: 5, alignItems: 'center', justifyContent: 'center' },
  compactPrimaryAction: { minHeight: 32, alignSelf: 'center', borderRadius: RadiusRole.button, paddingHorizontal: Spacing.md, paddingVertical: 5, alignItems: 'center', justifyContent: 'center' },
  compactActionText: { fontSize: FontSize.caption, fontWeight: '800' },
  inlineReview: { borderWidth: 1, borderRadius: RadiusRole.card, padding: Spacing.sm, gap: Spacing.sm },
  editorFooterRow: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.md },
  editorFooterRowCompact: { minHeight: 40 },
  editorFooterMeta: { flex: 1 },
  compactSaveAction: { minHeight: 44, minWidth: 86, borderRadius: RadiusRole.button, paddingHorizontal: Spacing.md, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5 },
  row: { flexDirection: 'row', gap: Spacing.sm },
  flexButton: { flex: 1 },
  modalButton: { marginTop: Spacing.sm },
  modalScroll: { maxHeight: 320 },
  searchInput: { minHeight: 48, borderWidth: 1, borderRadius: RadiusRole.input, paddingHorizontal: Spacing.md, fontSize: FontSize.body },
  searchMessage: { marginTop: Spacing.sm, fontSize: FontSize.small, lineHeight: 18 },
  confirmBody: { gap: Spacing.sm },
});
