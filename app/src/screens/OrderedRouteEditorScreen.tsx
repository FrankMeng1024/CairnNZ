import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
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
import { useFriendMemoryStore } from '../features/memory/store/useFriendMemoryStore';
import { useMemorySubscriptionsStore } from '../features/memory/store/useMemorySubscriptionsStore';
import { getMapbox } from '../features/memory/services/mapboxAdapter';
import { TrimSlider } from '../components/map/TrimSlider';
import { FontSize, RadiusRole, Spacing } from '../components/tokens';
import { getCurrentRegion } from '../config/regions';
import { buildStandardConfig, getMapStyleForTheme, themeToStandardPreset } from '../config/mapbox';
import { groupedMapOrnamentsAbove } from '../config/mapOrnaments';
import { qualifiedLocationPoint } from '../services/locationFixPolicy';
import { segmentTrace } from '../features/activity/activityContracts';
import { loadActivityFinalArtifact } from '../features/activity/activityFinalArtifact';
import {
  applyDrawTransaction,
  classifyDrawTransactionWithDiagnostics,
  routeAttachmentToleranceM,
  selectIntentAwareDrawCandidate,
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
  orderedIntervalPoints,
  orderedPositionAtDistanceFraction,
  routeOperationIsCurrent,
  routePointDistanceM,
  setOrderedDraftStart,
  trimOrderedDraft,
  undoRouteHistory,
  type EditableRouteResolution,
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
import { RoutePlaceSearchError, searchRoutePlaces, type RoutePlaceSearchResult } from '../features/route/routePlaceSearch';
import {
  resolveDrawPlan,
  resolvePointPlan,
  type RouteProviderReason,
} from '../features/route/routePlanningProvider';
import { selectPointRouteCandidate } from '../features/route/pointRouteIntent';
import {
  pointGrowthDurationMs,
  pointGrowthFrame,
  pointInsideUsableMap,
} from '../features/route/pointGrowthTimeline';
import { routeMatchesIdentity } from '../features/route/routeContracts';
import { selectActivityRouteImportPoints } from '../features/route/activityRouteImport';
import { canonicalRouteGeometry, type CanonicalRouteGeometry } from '../features/route/canonicalRouteGeometry';
import { useMapTheme } from '../hooks/useMapTheme';
import { useVisualTheme } from '../hooks/useVisualTheme';
import { uuidv4 } from '../services/offlineQueue';
import { useAppStore } from '../store/useAppStore';
import { useRouteStore, type RoutePoint } from '../store/useRouteStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { loadActivityTrackPoints, useSessionStore } from '../store/useSessionStore';
import { useDistance } from '../utils/distanceFormat';
import { useOnlineOnly } from '../hooks/useOnlineOnly';

let MapView: any = null;
let Camera: any = null;
let ShapeSource: any = null;
let LineLayer: any = null;
let CircleLayer: any = null;
let SymbolLayer: any = null;
let StyleImport: any = null;
if (Platform.OS === 'web') {
  const Mapbox = getMapbox();
  MapView = Mapbox.MapView;
  Camera = Mapbox.Camera;
  ShapeSource = Mapbox.ShapeSource;
  LineLayer = Mapbox.LineLayer;
  CircleLayer = Mapbox.CircleLayer;
  SymbolLayer = Mapbox.SymbolLayer;
  StyleImport = Mapbox.StyleImport ?? null;
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
  } catch { /* explicit fallback below */ }
}

type PlannerTool = 'browse' | 'draw' | 'point' | 'trim';
type EditorMode = 'Browse' | 'DrawArmed' | 'Drawing' | 'MatchPending' | 'AwaitFreehandChoice' | 'PointTargeting' | 'TrimPreview' | 'Saving';

interface PendingCandidateReview {
  kind: 'draw';
  points: RoutePoint[];
  resolution: EditableRouteResolution;
  intent: DrawTransactionIntent;
  reason: RouteProviderReason;
  baseRevision: number;
}

type PointTransactionIntent =
  | { kind: 'append' }
  | { kind: 'bridge'; gapId: string };

interface PendingPointReview {
  kind: 'point';
  points: RoutePoint[];
  resolution: 'point';
  intent: PointTransactionIntent;
  reason: string | null;
  baseRevision: number;
}

type PendingProviderRetry =
  | {
      kind: 'draw';
      raw: RoutePoint[];
      capture?: RouteDrawStrokeCapture;
      intent: DrawTransactionIntent;
      baseRevision: number;
      reason: RouteProviderReason;
    }
  | {
      kind: 'point';
      start: RoutePoint;
      target: RoutePoint;
      intent: PointTransactionIntent;
      baseRevision: number;
      reason: RouteProviderReason;
    };

interface PendingAttachmentChoice {
  raw: RoutePoint[];
  capture?: RouteDrawStrokeCapture;
  intent: Extract<DrawTransactionIntent, { kind: 'replace' }>;
  alternativeCount: number;
  baseRevision: number;
}

interface RouteGrowthAnimation {
  key: string;
  hiddenPartId?: string;
  visiblePoints: RoutePoint[];
  head: RoutePoint;
  progress: number;
}

function providerReason(reason: RouteProviderReason): string {
  switch (reason) {
    case 'no-route': return 'No nearby path found. You can draw this section.';
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

type SearchState = 'idle' | 'requesting' | 'results' | 'no-results' | 'error' | 'offline';
type InitialLocationState =
  | { status: 'idle' | 'locating' | 'unavailable' }
  | { status: 'ready'; point: RoutePoint };

export function OrderedRouteEditorScreen() {
  const nav = useNavigation<any>();
  const screenRoute = useRoute<any>();
  const insets = useSafeAreaInsets();
  const { height: viewportHeight, width: viewportWidth } = useWindowDimensions();
  const compactViewport = viewportHeight <= 640;
  const theme = useVisualTheme();
  const mapTheme = useMapTheme();
  const dist = useDistance();
  const { online } = useOnlineOnly();
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

  const [history, setHistory] = useState<RouteDraftHistory | null>(null);
  const historyRef = useRef<RouteDraftHistory | null>(null);
  const initialDraftRef = useRef<OrderedRouteDraft | null>(null);
  const [name, setName] = useState('');
  const [permission, setPermission] = useState<'personal' | 'friend'>('personal');
  const [mode, setMode] = useState<EditorMode>('Browse');
  const [pendingReview, setPendingReview] = useState<PendingCandidateReview | null>(null);
  const [pendingPointReview, setPendingPointReview] = useState<PendingPointReview | null>(null);
  const [manualRecovery, setManualRecovery] = useState<PendingCandidateReview | null>(null);
  const [pendingAttachmentChoice, setPendingAttachmentChoice] = useState<PendingAttachmentChoice | null>(null);
  const [pendingProviderRetry, setPendingProviderRetry] = useState<PendingProviderRetry | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const [trimStart, setTrimStart] = useState(0);
  const [trimEnd, setTrimEnd] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [initializing, setInitializing] = useState(true);
  const [saving, setSaving] = useState(false);
  const [providerBusy, setProviderBusy] = useState(false);
  const [resolvingDrawPoints, setResolvingDrawPoints] = useState<RoutePoint[]>([]);
  const [mapReady, setMapReady] = useState(false);
  const [mapLoadState, setMapLoadState] = useState<MapLoadState>('loading');
  const [mapEpoch, setMapEpoch] = useState(0);
  const [reduceMotion, setReduceMotion] = useState(false);
  const [planningMemoryScope, setPlanningMemoryScope] = useState<'self' | 'combined'>('self');
  const [routeGrowthAnimation, setRouteGrowthAnimation] = useState<RouteGrowthAnimation | null>(null);
  const routeGrowthAnimationRef = useRef<RouteGrowthAnimation | null>(null);
  const routeGrowthSourceRef = useRef<any>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<RoutePlaceSearchResult[]>([]);
  const [searchState, setSearchState] = useState<SearchState>('idle');
  const [searchMessage, setSearchMessage] = useState<string | null>(null);
  const [initialLocation, setInitialLocation] = useState<InitialLocationState>({ status: 'idle' });
  const [briefStatus, setBriefStatus] = useState<string | null>(null);
  const [bottomWorkspaceHeight, setBottomWorkspaceHeight] = useState(0);
  const mapViewRef = useRef<any>(null);
  const cameraRef = useRef<any>(null);
  const cameraCenterRef = useRef<RoutePoint | null>(null);
  const initialBoundsRef = useRef<ReturnType<typeof initialBounds>>(null);
  const operationAbortRef = useRef<AbortController | null>(null);
  const searchAbortRef = useRef<AbortController | null>(null);
  const searchRequestRef = useRef(0);
  const activeOperationIdRef = useRef<string | null>(null);
  // React state alone cannot fence two taps delivered before the next render.
  // This ref is the synchronous owner for the one allowed provider transaction.
  const providerTransactionRef = useRef(false);
  const routeAnimationFrameRef = useRef<number | null>(null);
  const routeAnimationGenerationRef = useRef(0);
  const cameraFollowBusyRef = useRef(false);
  const cameraFollowLastCommandAtRef = useRef(0);
  const routeGrowthLastPaintAtRef = useRef(0);
  const animationTraceBucketRef = useRef(-1);
  const initializedKeyRef = useRef('');
  const initializingKeyRef = useRef('');
  const initialLocationAttemptedRef = useRef(false);
  const userMovedCameraRef = useRef(false);
  const cameraZoomRef = useRef(14);
  const cameraBearingRef = useRef(0);
  const cameraPitchRef = useRef(0);
  const cameraGenerationRef = useRef(0);
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
  const tool: PlannerTool = mode === 'DrawArmed' || mode === 'Drawing'
    ? 'draw'
    : mode === 'PointTargeting'
      ? 'point'
      : mode === 'TrimPreview'
        ? 'trim'
        : 'browse';
  const trimOpen = mode === 'TrimPreview';
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

  const finishRouteAnimation = useCallback((reason: 'complete' | 'superseded' | 'user-camera' | 'tool-switch' | 'undo' | 'camera-action' = 'superseded') => {
    routeAnimationGenerationRef.current += 1;
    if (routeAnimationFrameRef.current != null) cancelAnimationFrame(routeAnimationFrameRef.current);
    routeAnimationFrameRef.current = null;
    cameraFollowBusyRef.current = false;
    // A native map gesture interrupts Mapbox's active transition. Do not send
    // a compensating camera command here: even one duration-0 write can race
    // the gesture and feel like the map pulled back after the user's pan.
    recordRouteDrawingTrace('route_point_animation_ended', { reason }, 'state');
    routeGrowthAnimationRef.current = null;
    setRouteGrowthAnimation(null);
  }, []);

  const invalidatePendingOperation = useCallback(() => {
    operationAbortRef.current?.abort();
    operationAbortRef.current = null;
    activeOperationIdRef.current = null;
    providerTransactionRef.current = false;
    finishRouteAnimation('tool-switch');
    setProviderBusy(false);
    setResolvingDrawPoints([]);
    setPendingReview(null);
    setPendingPointReview(null);
    setManualRecovery(null);
    setPendingAttachmentChoice(null);
    setPendingProviderRetry(null);
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
    recordRouteDrawingTrace('route_tool_selected', { tool: next, cameraIntent: 'preserve', preservedCamera }, 'state');
  }, [invalidatePendingOperation, saving, setTool]);

  const animateAcceptedPoint = useCallback((points: RoutePoint[], hiddenPartId?: string) => {
    finishRouteAnimation('superseded');
    if (points.length < 2) return;
    if (reduceMotion) {
      const target = points.at(-1)!;
      cameraRef.current?.setCamera?.({
        centerCoordinate: [target.lng, target.lat],
        zoomLevel: cameraZoomRef.current,
        heading: cameraBearingRef.current,
        pitch: cameraPitchRef.current,
        animationDuration: 160,
      });
      recordRouteDrawingTrace('route_point_reduced_motion_transition', { target, durationMs: 160 }, 'state');
      return;
    }
    const durationMs = pointGrowthDurationMs(points);
    const startedAt = performance.now();
    const key = uuidv4();
    const animationGeneration = routeAnimationGenerationRef.current;
    const initialFrame = pointGrowthFrame(points, 0);
    if (!initialFrame) return;
    animationTraceBucketRef.current = -1;
    const initialAnimation = { key, hiddenPartId, visiblePoints: initialFrame.visiblePoints, head: initialFrame.head, progress: 0 };
    cameraFollowLastCommandAtRef.current = 0;
    routeGrowthLastPaintAtRef.current = 0;
    routeGrowthAnimationRef.current = initialAnimation;
    setRouteGrowthAnimation(initialAnimation);
    recordRouteDrawingTrace('route_point_animation_started', {
      animationId: key,
      durationMs,
      pointCount: points.length,
      totalM: initialFrame.totalM,
      zoom: cameraZoomRef.current,
      bearing: cameraBearingRef.current,
      pitch: cameraPitchRef.current,
    }, 'state');
    const tick = () => {
      if (routeAnimationGenerationRef.current !== animationGeneration) return;
      const elapsed = performance.now() - startedAt;
      const progress = Math.min(1, elapsed / durationMs);
      const frame = pointGrowthFrame(points, progress);
      if (!frame) { finishRouteAnimation('complete'); return; }
      const nextAnimation = {
        key,
        hiddenPartId,
        visiblePoints: frame.visiblePoints,
        head: frame.head,
        progress,
      };
      routeGrowthAnimationRef.current = nextAnimation;
      const nextGrowthFeature = {
        type: 'Feature' as const,
        properties: {},
        geometry: {
          type: 'LineString' as const,
          coordinates: nextAnimation.visiblePoints.map(point => [point.lng, point.lat]),
        },
      };
      const shouldPaintGrowth = progress >= 1 || elapsed - routeGrowthLastPaintAtRef.current >= 32;
      if (shouldPaintGrowth && routeGrowthSourceRef.current?.setNativeProps) {
        // ShapeSource's native bridge accepts serialized GeoJSON. Updating the
        // one transient source at a bounded ~30fps avoids both full React
        // reconciliation and Mapbox worker churn. Canonical geometry,
        // persistence and the animation clock remain static/independent.
        routeGrowthSourceRef.current.setNativeProps({ shape: JSON.stringify(nextGrowthFeature) });
        routeGrowthLastPaintAtRef.current = elapsed;
      } else if (!routeGrowthSourceRef.current?.setNativeProps) {
        setRouteGrowthAnimation(current => current?.key === key ? nextAnimation : current);
      }
      const bucket = Math.min(4, Math.floor(progress * 4));
      if (bucket !== animationTraceBucketRef.current) {
        animationTraceBucketRef.current = bucket;
        recordRouteDrawingTrace('route_point_animation_frame', {
          animationId: key,
          progress,
          travelledM: frame.travelledM,
          totalM: frame.totalM,
          head: frame.head,
        }, 'state');
      }
      if (!cameraFollowBusyRef.current
        && elapsed - cameraFollowLastCommandAtRef.current >= 180
        && mapViewRef.current?.getPointInView) {
        cameraFollowBusyRef.current = true;
        void Promise.resolve(mapViewRef.current.getPointInView([frame.head.lng, frame.head.lat]))
          .then((screenPoint: unknown) => {
            if (routeAnimationGenerationRef.current !== animationGeneration) return;
            if (!Array.isArray(screenPoint) || screenPoint.length < 2) return;
            const inside = pointInsideUsableMap(
              { x: Number(screenPoint[0]), y: Number(screenPoint[1]) },
              {
                width: viewportWidth,
                height: viewportHeight,
                topInset: insets.top,
                bottomInset: bottomWorkspaceHeight || insets.bottom + (compactViewport ? 126 : 138),
              },
            );
            if (inside) return;
            cameraFollowLastCommandAtRef.current = elapsed;
            cameraRef.current?.setCamera?.({
              centerCoordinate: [frame.head.lng, frame.head.lat],
              zoomLevel: cameraZoomRef.current,
              heading: cameraBearingRef.current,
              pitch: cameraPitchRef.current,
              animationMode: 'linearTo',
              animationDuration: 180,
            });
            recordRouteDrawingTrace('route_point_camera_follow', {
              animationId: key,
              progress,
              head: frame.head,
              reason: 'drawing-head-left-usable-map',
              timelineElapsedMs: elapsed,
              commandDurationMs: 180,
              zoom: cameraZoomRef.current,
              bearing: cameraBearingRef.current,
              pitch: cameraPitchRef.current,
            }, 'state');
          })
          .finally(() => {
            if (routeAnimationGenerationRef.current === animationGeneration) cameraFollowBusyRef.current = false;
          });
      }
      if (progress >= 1) {
        finishRouteAnimation('complete');
        return;
      }
      routeAnimationFrameRef.current = requestAnimationFrame(tick);
    };
    routeAnimationFrameRef.current = requestAnimationFrame(tick);
  }, [bottomWorkspaceHeight, compactViewport, finishRouteAnimation, insets.bottom, insets.top, reduceMotion, viewportHeight, viewportWidth]);

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
    if (!traceDraftId || !current || !isRouteDrawingDiagnosticsEnabled()) return undefined;
    const sessionId = `route-edit:${traceDraftId}:${Date.now()}`;
    traceDraftIdRef.current = traceDraftId;
    beginRouteDrawingTrace({
      sessionId,
      routeId: routeId ?? traceDraftId,
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
  }, [fromSessionId, routeId, traceDraftId]);

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
    const removeListener = nav.addListener?.('beforeRemove', abandonUnsavedCreation);
    return typeof removeListener === 'function' ? removeListener : undefined;
  }, [abandonUnsavedCreation, nav]);
  const mapStyle = getMapStyleForTheme('outdoors', mapTheme);
  const lightPreset = themeToStandardPreset(mapTheme);
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
        if (permissionState.status !== 'granted') {
          if (!cancelled) {
            setInitialLocation({ status: 'unavailable' });
            setError('Location is unavailable. Search for a place or browse the map to start planning.');
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
          setError('Current location is unavailable. Search for a place or browse the map instead.');
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

  const fitReviewPoints = useCallback((points: RoutePoint[]) => {
    if (points.length < 2) return;
    const ne: [number, number] = [Math.max(...points.map(point => point.lng)), Math.max(...points.map(point => point.lat))];
    const sw: [number, number] = [Math.min(...points.map(point => point.lng)), Math.min(...points.map(point => point.lat))];
    cameraRef.current?.fitBounds?.(ne, sw, [insets.top + 110, 88, bottomClearance + 30, 36], reduceMotion ? 0 : 420);
  }, [bottomClearance, insets.top, reduceMotion]);

  useEffect(() => {
    const current = historyRef.current?.present;
    if (!current) return;
    const candidate = pendingReview?.points ?? pendingPointReview?.points ?? [];
    const intervals = pendingReview?.intent.kind === 'replace'
      ? pendingReview.intent.options.map(option => orderedIntervalPoints(current, option.start, option.end))
      : [];
    fitReviewPoints([...candidate, ...intervals.flat()]);
  }, [fitReviewPoints, pendingPointReview, pendingReview]);

  const showCurrentLocation = useCallback(async () => {
    try {
      const permissionState = await Location.getForegroundPermissionsAsync();
      if (permissionState.status !== 'granted') {
        setError('Location permission is needed to center the planning map. You can still search or browse another city.');
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
      setError('Current location is unavailable. Search for a place or browse the map instead.');
    }
  }, [moveCamera]);

  const runPlaceSearch = useCallback(async () => {
    const query = searchQuery.trim();
    if (query.length < 2) {
      searchAbortRef.current?.abort();
      setSearchState('idle');
      setSearchMessage(null);
      setSearchResults([]);
      return;
    }
    // Results belong to one submitted query. Keeping an older city's rows
    // under a new timeout/failure makes those stale rows look selectable.
    setSearchResults([]);
    if (!online) {
      setSearchState('offline');
      setSearchMessage('Search needs a connection. You can still browse the map.');
      return;
    }
    searchAbortRef.current?.abort();
    const controller = new AbortController();
    const requestId = searchRequestRef.current + 1;
    searchRequestRef.current = requestId;
    searchAbortRef.current = controller;
    setSearchState('requesting');
    setSearchMessage(null);
    try {
      const results = await searchRoutePlaces(query, {
        signal: controller.signal,
        proximity: cameraCenterRef.current,
      });
      if (controller.signal.aborted || requestId !== searchRequestRef.current) return;
      setSearchResults(results);
      setSearchState(results.length ? 'results' : 'no-results');
      setSearchMessage(results.length ? null : 'No city or address matched. Try a broader place name.');
    } catch (cause) {
      if (requestId !== searchRequestRef.current) return;
      const code = cause instanceof RoutePlaceSearchError ? cause.code : 'request-failed';
      if (code === 'cancelled') {
        setSearchState('idle');
        setSearchMessage(null);
      } else {
        setSearchState('error');
        setSearchMessage(code === 'timeout'
          ? 'Search took too long. Check the connection and try again.'
          : code === 'unauthorized' || code === 'unavailable'
            ? 'Place search is unavailable. Browse the map to continue planning.'
            : 'Search failed. Your Route is unchanged; retry when connected.');
      }
    } finally {
      if (searchAbortRef.current === controller) searchAbortRef.current = null;
    }
  }, [online, searchQuery]);

  useEffect(() => () => searchAbortRef.current?.abort(), []);

  const applyResolvedDraw = useCallback((
    points: RoutePoint[],
    resolution: EditableRouteResolution,
    intent: DrawTransactionIntent,
  ) => {
    const current = historyRef.current;
    if (!current) return;
    if (intent.kind === 'replace') {
      if (intent.options.length > 1) {
        setError('Redraw from clearer positions so Cairn can preserve the right path.');
        setMode('Browse');
        return;
      }
      const option = intent.options[0];
      if (!option) { setError('Redraw from clearer positions. Your Route is unchanged.'); setMode('Browse'); return; }
      if (commitResult(applyDrawTransaction(current.present, { kind: 'replace', option }, points, resolution), 'replace-draw')) {
        setMode('Browse');
        setBriefStatus('Line added. Move the map, or tap Draw to continue.');
      }
      return;
    }
    if (intent.kind === 'reject') {
      setError(editFailure(intent.code));
      setMode('Browse');
      return;
    }
    if (intent.kind === 'pending-bridge' || intent.kind === 'pending-replace') {
      setError('Redraw with both ends clearly attached. Your Route is unchanged.');
      setMode('Browse');
      return;
    }
    if (commitResult(
      applyDrawTransaction(current.present, intent, points, resolution),
      intent.kind === 'bridge' ? 'bridge-draw' : intent.kind === 'prepend' ? 'prepend-draw' : 'append-draw',
    )) {
      setMode('Browse');
      setBriefStatus('Line added. Move the map, or tap Draw to continue.');
    }
  }, [commitResult]);

  const handleDrawStroke = useCallback(async (
    raw: RoutePoint[],
    nativeCapture?: RouteDrawStrokeCapture,
    forcedIntent?: Extract<DrawTransactionIntent, { kind: 'replace' }>,
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
      setError('Finish or cancel the current Route edit first.');
      return;
    }
    const transactionPoints = raw;
    const latitude = raw[0]?.lat ?? cameraCenterRef.current?.lat ?? 0;
    const attachmentToleranceM = routeAttachmentToleranceM(latitude, cameraZoomRef.current);
    const classification = classifyDrawTransactionWithDiagnostics(current.present, raw, undefined, attachmentToleranceM);
    const intent = forcedIntent ?? classification.intent;
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
      const rankedOptions = classification.diagnostics.intervalCandidates
        .slice()
        .sort((a, b) => a.shapeScore - b.shapeScore);
      if (intent.kind === 'pending-replace' && intent.ambiguity === 'overlap' && rankedOptions[0]) {
        setPendingAttachmentChoice({
          raw: raw.map(point => ({ ...point })),
          capture: nativeCapture,
          intent: { kind: 'replace', options: [rankedOptions[0]] },
          alternativeCount: rankedOptions.length,
          baseRevision: current.present.revision,
        });
        setMode('AwaitFreehandChoice');
      } else {
        setError('Continue the stroke until its other end reaches the Route. Your Route is unchanged.');
        setMode('DrawArmed');
      }
      return;
    }
    const operationId = strokeId;
    const token = beginRouteOperation(current.present, ownerId, intent.kind === 'bridge' ? 'bridge' : intent.kind === 'replace' ? 'replace' : 'draw', operationId);
    operationAbortRef.current?.abort();
    const controller = new AbortController();
    providerTransactionRef.current = true;
    operationAbortRef.current = controller;
    activeOperationIdRef.current = operationId;
    setProviderBusy(true);
    setMode('MatchPending');
    setResolvingDrawPoints(transactionPoints);
    setError(null);
    try {
      recordRouteDrawingTrace('route_draw_provider_request', {
        strokeId,
        rawPoints: transactionPoints,
        pointCount: transactionPoints.length,
      }, 'provider-request');
      const resolved = await resolveDrawPlan(transactionPoints, { signal: controller.signal });
      const providerGeometry = resolved.outcome === 'accepted' || resolved.outcome === 'review'
        ? resolved.points
        : null;
      recordRouteDrawingTrace('route_draw_provider_response', {
        strokeId,
        outcome: resolved.outcome,
        reason: 'reason' in resolved ? resolved.reason : null,
        callCount: 'callCount' in resolved ? resolved.callCount : null,
        providerGeometry,
      }, 'provider-response');
      const live = historyRef.current;
      if (!live || controller.signal.aborted
        || !routeOperationIsCurrent(live.present, ownerId, token, activeOperationIdRef.current)) return;
      const intentAware = selectIntentAwareDrawCandidate({
        draft: live.present,
        raw: transactionPoints,
        provider: providerGeometry,
        intent,
        viewport: {
          width: viewportWidth,
          height: viewportHeight,
          center: { lng: camera.centerLng, lat: camera.centerLat },
          zoom: camera.zoom,
          bearing: camera.bearing,
          pitch: camera.pitch,
        },
      });
      if (intentAware) {
        recordRouteDrawingTrace('route_draw_intent_decision', {
          strokeId,
          intent: intentAware.decision.intent,
          status: intentAware.decision.status,
          selectionSource: intentAware.decision.selectionSource,
          reasons: intentAware.decision.reasons,
          attachments: intentAware.decision.attachments,
          stabilizedStroke: intentAware.decision.stabilizedStroke,
          providerGeometry: intentAware.decision.providerGeometry,
          selectedReplacement: intentAware.decision.selectedReplacement,
          finalGeometry: intentAware.decision.finalGeometry,
          metrics: intentAware.decision.metrics,
          divergenceStage: intentAware.decision.divergenceStage,
        }, 'selection');
        if (!intentAware.points || !intentAware.resolution) {
          setError('Cairn could not identify one safe replacement interval. Your Route is unchanged.');
          setMode('Browse');
          return;
        }
        applyResolvedDraw(intentAware.points, intentAware.resolution, intent);
        return;
      }
      if (resolved.outcome === 'accepted') {
        applyResolvedDraw(resolved.points, 'draw-matched', intent);
      } else if (resolved.outcome === 'review') {
        setPendingReview({
          kind: 'draw',
          points: resolved.points,
          resolution: 'draw-matched',
          intent,
          reason: resolved.reason,
          baseRevision: live.present.revision,
        });
        setMode('AwaitFreehandChoice');
      } else if (resolved.outcome === 'manual-available') {
        if (resolved.reason === 'provider-unavailable') {
          setPendingProviderRetry({
            kind: 'draw',
            raw: resolved.rawPoints.map(point => ({ ...point })),
            capture: nativeCapture,
            intent,
            reason: resolved.reason,
            baseRevision: live.present.revision,
          });
          setError(providerReason(resolved.reason));
          setMode('DrawArmed');
          recordRouteDrawingTrace('route_draw_retry_available', {
            strokeId,
            reason: resolved.reason,
            baseRevision: live.present.revision,
            preservedRawPoints: resolved.rawPoints,
          }, 'state');
        } else {
          setManualRecovery({
            kind: 'draw',
            points: resolved.rawPoints,
            resolution: 'draw-manual',
            intent,
            reason: resolved.reason,
            baseRevision: live.present.revision,
          });
          setMode('AwaitFreehandChoice');
        }
      } else {
        recordRouteDrawingTrace('route_draw_rejected', {
          strokeId,
          reason: resolved.reason,
        }, 'selection');
        setError(providerReason(resolved.reason));
        setMode('Browse');
      }
    } finally {
      if (operationAbortRef.current === controller) {
        operationAbortRef.current = null;
        if (activeOperationIdRef.current === operationId) activeOperationIdRef.current = null;
        providerTransactionRef.current = false;
      }
      setResolvingDrawPoints([]);
      if (!controller.signal.aborted) setProviderBusy(false);
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
      };
    };
    const bridge = {
      submitStroke: handleDrawStroke,
      getPointAnimationSnapshot: () => routeGrowthAnimationRef.current,
      getCurrentDraft: () => historyRef.current?.present ?? null,
      getApprovedPointTarget: () => approvedPointTargetRef.current,
      getCameraSnapshot: () => ({
        center: cameraCenterRef.current,
        zoom: cameraZoomRef.current,
        bearing: cameraBearingRef.current,
        pitch: cameraPitchRef.current,
        generation: cameraGenerationRef.current,
      }),
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
  ) => {
    const current = historyRef.current;
    if (!current) return;
    if (current.present.revision !== baseRevision) {
      setError('This Route changed while the edit was being reviewed. The older result was not applied.');
      return;
    }
    if (intent.kind === 'append') {
      const result = appendOrderedSegment(current.present, points, resolution);
      if (commitResult(result, 'append-point')) {
        animateAcceptedPoint(points, result.ok ? result.draft.parts.at(-1)?.id : undefined);
        setTool('browse');
      }
      return;
    }
    if (intent.kind === 'bridge') {
      const previousPartIds = new Set(current.present.parts.map(part => part.id));
      const result = bridgeOrderedGap(current.present, intent.gapId, points, resolution);
      if (commitResult(result, 'bridge-point')) {
        const addedPart = result.ok ? result.draft.parts.find(part => !previousPartIds.has(part.id)) : undefined;
        animateAcceptedPoint(points, addedPart?.id);
        setTool('browse');
      }
      return;
    }
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
    setProviderBusy(true);
    setMode('MatchPending');
    setError(null);
    try {
      const result = await resolvePointPlan(start, target, { signal: controller.signal });
      recordRouteDrawingTrace('route_point_provider_response', {
        strokeId: operationId,
        outcome: result.outcome,
        reason: 'reason' in result ? result.reason : null,
        providerGeometry: 'points' in result ? result.points : null,
        providerStartShiftM: 'providerStartShiftM' in result ? result.providerStartShiftM : null,
        providerTargetShiftM: 'providerTargetShiftM' in result ? result.providerTargetShiftM : null,
      }, 'provider-response');
      const live = historyRef.current;
      if (!live || controller.signal.aborted
        || !routeOperationIsCurrent(live.present, ownerId, token, activeOperationIdRef.current)) return;
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
          setError('No nearby path found. You can draw this section.');
          setMode('PointTargeting');
        } else {
          applyResolvedPoint(selection.points, intent, baseRevision);
        }
      } else {
        recordRouteDrawingTrace('route_point_rejected', {
          strokeId: operationId,
          reason: result.reason,
          rawTarget: target,
          baseRevision,
          unchangedFinalGeometry: orderedDraftPoints(live.present),
        }, 'selection');
        if (result.reason === 'provider-unavailable') {
          setPendingProviderRetry({
            kind: 'point', start: { ...start }, target: { ...target }, intent,
            reason: result.reason, baseRevision,
          });
          setError(providerReason(result.reason));
          setMode('PointTargeting');
        } else {
          setError(providerReason(result.reason));
          setMode('PointTargeting');
        }
      }
    } finally {
      if (operationAbortRef.current === controller) {
        operationAbortRef.current = null;
        if (activeOperationIdRef.current === operationId) activeOperationIdRef.current = null;
        providerTransactionRef.current = false;
      }
      if (!controller.signal.aborted) setProviderBusy(false);
    }
  }, [applyResolvedPoint, finishRouteAnimation, ownerId]);

  const retryPendingProviderOperation = useCallback(() => {
    const pending = pendingProviderRetry;
    const current = historyRef.current;
    if (!pending || !current) return;
    if (current.present.revision !== pending.baseRevision) {
      setPendingProviderRetry(null);
      setError('This Route changed. The older request was not retried.');
      return;
    }
    setPendingProviderRetry(null);
    setError(null);
    recordRouteDrawingTrace('route_provider_manual_retry', {
      kind: pending.kind,
      baseRevision: pending.baseRevision,
    }, 'state');
    if (pending.kind === 'draw') {
      void handleDrawStroke(
        pending.raw,
        pending.capture,
        pending.intent.kind === 'replace' ? pending.intent : undefined,
      );
    } else {
      void runPointRequest(pending.start, pending.target, pending.intent);
    }
  }, [handleDrawStroke, pendingProviderRetry, runPointRequest]);

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
    void runPointRequest(start, target, { kind: 'append' });
  }, [commitResult, providerBusy, runPointRequest]);

  const hasUncommittedRouteEdit = providerBusy
    || providerTransactionRef.current
    || Boolean(pendingReview || pendingPointReview || manualRecovery || pendingAttachmentChoice || pendingProviderRetry);

  const handleUndo = useCallback(() => {
    if (providerTransactionRef.current || hasUncommittedRouteEdit) return;
    finishRouteAnimation('undo');
    const current = historyRef.current;
    if (!current) return;
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
    if (commitResult(trimOrderedDraft(current.present, start, end), 'trim')) {
      setTrimOpen(false);
      setTool('browse');
      setTrimStart(0);
      setTrimEnd(1);
    }
  }, [commitResult, trimEnd, trimStart]);

  const saveRoute = useCallback(async () => {
    const current = historyRef.current;
    if (!current || saving || readOnlyShared) return;
    if (providerBusy || pendingReview || pendingPointReview || manualRecovery || pendingAttachmentChoice || pendingProviderRetry) { setError('Finish or cancel the current Route edit before saving.'); return; }
    const title = name.trim();
    if (!title) { setError('Name this Route before saving.'); return; }
    if (current.present.parts.length === 0) { setError('Add a path before saving this Route.'); return; }
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
      nav.replace('MapHistory', { routeId: savedId });
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
      setSaving(false);
      setMode('Browse');
    }
  }, [addRoute, fromSessionId, manualRecovery, name, nav, ownerId, pendingAttachmentChoice, pendingPointReview, pendingProviderRetry, pendingReview, permission, providerBusy, readOnlyShared, routeId, saving, sessions, updateRoute]);

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
      coordinates: routeGrowthAnimation.visiblePoints.map(point => [point.lng, point.lat]),
    },
  } : null;
  const routeEndpoints = (() => {
    const start = displayDraft.parts[0]?.points[0] ?? displayDraft.startPoint;
    const end = displayDraft.parts.at(-1)?.points.at(-1);
    if (!start) return [];
    const same = end && routePointDistanceM(start, end) <= 0.35;
    return [{
      type: 'Feature' as const,
      properties: { role: same ? 'Start / End' : 'Start' },
      geometry: { type: 'Point' as const, coordinates: [start.lng, start.lat] },
    }, ...(end && !same ? [{
      type: 'Feature' as const,
      properties: { role: 'End' },
      geometry: { type: 'Point' as const, coordinates: [end.lng, end.lat] },
    }] : [])];
  })();
  const reviewPoints = pendingReview?.points ?? pendingPointReview?.points ?? pendingAttachmentChoice?.raw ?? [];
  const reviewIntervals = (() => {
    if (pendingAttachmentChoice) {
      return pendingAttachmentChoice.intent.options.map(option => orderedIntervalPoints(draft, option.start, option.end));
    }
    if (pendingReview?.intent.kind === 'replace') {
      return pendingReview.intent.options.map(option => orderedIntervalPoints(draft, option.start, option.end));
    }
    return [];
  })();
  const originalIntervalFeatures = reviewIntervals.flatMap((points, index) => points.length >= 2 ? [{
    type: 'Feature' as const,
    id: `review-interval-${index}`,
    properties: {},
    geometry: { type: 'LineString' as const, coordinates: points.map(point => [point.lng, point.lat]) },
  }] : []);
  const visiblePendingPoints = resolvingDrawPoints;
  const pendingFeature = visiblePendingPoints.length >= 2 ? {
    type: 'Feature' as const,
    properties: {},
    geometry: { type: 'LineString' as const, coordinates: visiblePendingPoints.map(point => [point.lng, point.lat]) },
  } : null;
  const pendingEndpoint = visiblePendingPoints.at(-1);
  const pendingEndpointFeature = pendingEndpoint ? {
    type: 'Feature' as const,
    properties: {},
    geometry: {
      type: 'Point' as const,
      coordinates: [pendingEndpoint.lng, pendingEndpoint.lat],
    },
  } : null;
  const previewFeature = reviewPoints.length >= 2 ? {
    type: 'Feature' as const,
    properties: {},
    geometry: { type: 'LineString' as const, coordinates: reviewPoints.map(point => [point.lng, point.lat]) },
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
          onPress={applyTrim}
          disabled={trimStart <= 0.001 && trimEnd >= 0.999}
          accessibilityRole="button"
          accessibilityState={{ disabled: trimStart <= 0.001 && trimEnd >= 0.999 }}
          testID="route-trim-apply"
        ><Text style={[styles.compactActionText, { color: theme.onPrimary }]}>Apply</Text></TouchableOpacity>
    </View>
  ) : pendingProviderRetry ? (
    <View style={styles.decisionInlineRow} testID="route-provider-retry">
      <Text style={[styles.contextText, { color: contextInk }]} numberOfLines={2}>
        {pendingProviderRetry.kind === 'point'
          ? 'Routing unavailable. Your target is kept.'
          : 'Matching unavailable. Your line is kept.'}
      </Text>
      <TouchableOpacity
        style={[styles.compactPrimaryAction, { backgroundColor: theme.primaryAction }]}
        onPress={retryPendingProviderOperation}
        accessibilityRole="button"
        accessibilityLabel="Retry Route request"
        testID="route-provider-retry-action"
      ><Text style={[styles.compactActionText, { color: theme.onPrimary }]}>Retry</Text></TouchableOpacity>
    </View>
  ) : pendingAttachmentChoice ? (
    <View style={styles.decisionInlineRow} testID="route-attachment-choice">
      <Text style={[styles.contextText, { color: contextInk }]}>Use the highlighted section?</Text>
      <TouchableOpacity style={[styles.compactSecondaryAction, { borderColor: theme.borderSubtle }]} onPress={() => { setPendingAttachmentChoice(null); setMode('DrawArmed'); }}><Text style={[styles.compactActionText, { color: theme.foreground }]}>Redraw</Text></TouchableOpacity>
      <TouchableOpacity style={[styles.compactPrimaryAction, { backgroundColor: theme.primaryAction }]} onPress={() => {
        const pending = pendingAttachmentChoice;
        setPendingAttachmentChoice(null);
        if (historyRef.current?.present.revision !== pending.baseRevision) {
          setError('This Route changed. The highlighted choice was not applied.');
          setMode('Browse');
          return;
        }
        void handleDrawStroke(pending.raw, pending.capture, pending.intent);
      }} testID="route-use-highlighted-interval"><Text style={[styles.compactActionText, { color: theme.onPrimary }]}>Use highlight</Text></TouchableOpacity>
    </View>
  ) : manualRecovery ? (
    <View style={styles.decisionInlineRow} testID="route-freehand-choice">
      <Text style={[styles.contextText, { color: contextInk }]}>Keep the line you drew?</Text>
      <TouchableOpacity style={[styles.compactSecondaryAction, { borderColor: theme.borderSubtle }]} onPress={() => { setManualRecovery(null); setMode('DrawArmed'); }}><Text style={[styles.compactActionText, { color: theme.foreground }]}>Redraw</Text></TouchableOpacity>
      <TouchableOpacity style={[styles.compactPrimaryAction, { backgroundColor: theme.primaryAction }]} onPress={() => { const pending = manualRecovery; setManualRecovery(null); applyResolvedDraw(pending.points, 'draw-manual', pending.intent); }} testID="route-use-drawing"><Text style={[styles.compactActionText, { color: theme.onPrimary }]}>Use line</Text></TouchableOpacity>
    </View>
  ) : pendingReview || pendingPointReview ? (
    <View style={styles.decisionInlineRow} testID="route-inline-review">
      <Text style={[styles.contextText, { color: contextInk }]}>{pendingPointReview ? 'Keep this road path?' : 'Keep this path?'}</Text>
      <TouchableOpacity style={[styles.compactSecondaryAction, { borderColor: theme.borderSubtle }]} onPress={() => {
        setPendingReview(null); setPendingPointReview(null); setMode(pendingPointReview ? 'PointTargeting' : 'DrawArmed');
      }}><Text style={[styles.compactActionText, { color: theme.foreground }]}>{pendingPointReview ? 'Cancel' : 'Redraw'}</Text></TouchableOpacity>
      <TouchableOpacity style={[styles.compactPrimaryAction, { backgroundColor: theme.primaryAction }]} onPress={() => {
        if (pendingReview) { const pending = pendingReview; setPendingReview(null); applyResolvedDraw(pending.points, pending.resolution, pending.intent); }
        else if (pendingPointReview) { const pending = pendingPointReview; setPendingPointReview(null); applyResolvedPoint(pending.points, pending.intent, pending.baseRevision, pending.resolution); }
      }}><Text style={[styles.compactActionText, { color: theme.onPrimary }]}>Use path</Text></TouchableOpacity>
    </View>
  ) : mode === 'MatchPending' || providerBusy ? (
    <View style={[styles.contextContent, styles.contextProgress]}>
      <View style={styles.busyRow}><ActivityIndicator size="small" color={contextInk} /><Text style={[styles.contextText, { color: contextInk }]}>Finding a path…</Text></View>
      <TouchableOpacity onPress={() => { invalidatePendingOperation(); setMode('Browse'); }} accessibilityRole="button"><Text style={[styles.linkText, { color: theme.primary }]}>Cancel</Text></TouchableOpacity>
    </View>
  ) : error ? (
    <TouchableOpacity style={styles.contextContent} onPress={() => setError(null)} accessibilityRole="button" testID="route-context-message"><Text style={[styles.contextText, { color: contextInk }]}>{error}</Text></TouchableOpacity>
  ) : tool === 'point' ? (
    <View style={styles.pointInlineRow} testID="route-point-context">
      <Text style={[styles.contextText, { color: contextInk }]}>Move map to choose.</Text>
      <TouchableOpacity style={[styles.compactPrimaryAction, { backgroundColor: theme.primaryAction }]} onPress={confirmPointTarget} disabled={providerBusy} accessibilityRole="button" accessibilityLabel={pointActionLabel} testID="route-point-confirm"><Text style={[styles.compactActionText, { color: theme.onPrimary }]}>{pointActionLabel}</Text></TouchableOpacity>
    </View>
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
          onDidFinishLoadingMap={() => setMapReady(true)}
          onDidFinishRenderingMapFully={() => setMapReady(true)}
          onMapLoadingError={() => setMapLoadState('error')}
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
            if (event?.properties?.isUserInteraction || event?.properties?.gestures?.isGestureActive) {
              userMovedCameraRef.current = true;
              finishRouteAnimation('user-camera');
            }
          }}
        >
          {StyleImport ? <StyleImport key={lightPreset} id="basemap" existing config={buildStandardConfig(mapTheme) as any} /> : null}
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
          <FogLayer scopeOverride={planningMemoryScope} opacityScale={0.42} />
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
            hiddenPartId={routeGrowthAnimation?.hiddenPartId}
          />
          {ShapeSource && LineLayer && animationFeature ? (
            <ShapeSource ref={routeGrowthSourceRef} id="ordered-route-growth" shape={animationFeature}>
              <LineLayer id="ordered-route-growth-line" slot="top" style={{ lineColor: theme.mapRouteLine, lineWidth: 6, lineCap: 'round', lineJoin: 'round' }} />
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
          {ShapeSource && LineLayer && originalIntervalFeatures.length ? (
            <ShapeSource id="ordered-route-review-original" shape={{ type: 'FeatureCollection', features: originalIntervalFeatures }}>
              <LineLayer id="ordered-route-review-original-line" slot="top" style={{ lineColor: theme.foregroundSecondary, lineWidth: 8, lineOpacity: 0.48, lineDasharray: [2, 1.5] }} />
            </ShapeSource>
          ) : null}
          {ShapeSource && LineLayer && previewFeature ? (
            <ShapeSource id="ordered-route-review-candidate" shape={previewFeature}>
              <LineLayer id="ordered-route-review-candidate-line" slot="top" style={{ lineColor: theme.mapRoutePending, lineWidth: 7, lineOpacity: 0.95, lineCap: 'round', lineJoin: 'round' }} />
            </ShapeSource>
          ) : null}
          {ShapeSource && CircleLayer && routeEndpoints.length ? (
            <ShapeSource id="ordered-route-endpoints" shape={{ type: 'FeatureCollection', features: routeEndpoints }}>
              <CircleLayer id="ordered-route-endpoint-circles" slot="top" style={{ circleRadius: 7, circleColor: theme.surfaceElevated, circleStrokeColor: theme.mapRouteLine, circleStrokeWidth: 3 }} />
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
      {MapView && showPlannerMap && !mapReady ? (
        <MapLoadOverlay
          state={mapLoadState}
          onRetry={() => { setMapReady(false); setMapLoadState('loading'); setMapEpoch(value => value + 1); }}
          testID="ordered-route-map-load-overlay"
        />
      ) : null}
      {MapView && !showPlannerMap ? (
        <View style={[StyleSheet.absoluteFill, styles.centered, { backgroundColor: theme.background }]} testID="route-initial-location-state">
          <ActivityIndicator color={theme.primary} />
          <Text style={[styles.helper, { color: theme.foregroundSecondary }]}>Finding your current location…</Text>
          <Text style={[styles.initialLocationHint, { color: theme.muted }]}>You can search for another place while this finishes.</Text>
        </View>
      ) : null}

      <View style={[styles.mapTools, { top: insets.top + (compactViewport ? 72 : 128) }]}>
        <TouchableOpacity
          style={[styles.mapToolButton, { backgroundColor: theme.mapOverlay, borderColor: theme.border }]}
          onPress={() => {
            setMoreOpen(false);
            setSearchOpen(true);
          }}
          accessibilityRole="button"
          accessibilityLabel="Search for a place or city"
          testID="route-place-search"
        ><Icon name="Search" size={19} color={theme.iconActive} /></TouchableOpacity>
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
              searchAbortRef.current?.abort();
              setSearchOpen(false);
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
            ><Text style={[styles.popoverChoiceText, { color: theme.foreground }]}>Mine</Text></TouchableOpacity>
            <TouchableOpacity
              style={[styles.popoverChoice, { borderColor: planningMemoryScope === 'combined' ? theme.primary : theme.borderSubtle, backgroundColor: planningMemoryScope === 'combined' ? theme.controlSelected : theme.surface }, memorySubscriptions.length === 0 && styles.disabled]}
              disabled={memorySubscriptions.length === 0}
              onPress={() => { setPlanningMemoryScope('combined'); void useFriendMemoryStore.getState().loadSelectedProjections(); }}
            ><Text style={[styles.popoverChoiceText, { color: theme.foreground }]}>Mine + Friends</Text></TouchableOpacity>
          </View>
          {memorySubscriptions.length === 0 ? <Text style={[styles.popoverHint, { color: theme.foregroundSecondary }]}>No shared Friend Fog is available. Mine stays visible.</Text> : null}
        </View>
      ) : null}

      <View style={[
        styles.topBar,
        { paddingTop: insets.top + Spacing.sm, paddingBottom: Spacing.sm, backgroundColor: theme.mapOverlay, borderBottomColor: theme.borderSubtle, borderBottomWidth: StyleSheet.hairlineWidth },
      ]} pointerEvents="box-none">
        <BackButton variant="inline" onPress={() => { abandonUnsavedCreation(); nav.goBack(); }} />
        <View style={styles.topTitleWrap}>
          <Text testID="route-editor-title" style={[styles.topTitle, { color: theme.foreground }]}>{readOnlyShared ? 'Shared Route' : routeId ? 'Edit Route' : 'Create Route'}</Text>
        </View>
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
        onCancel={reason => {
          recordRouteDrawingTrace('route_draw_native_cancelled', { reason }, 'state');
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
                <View style={[styles.contextPanel, { backgroundColor: contextSurface, borderColor: 'rgba(23,55,45,0.22)' }]} testID="route-context-slot">
                  {routeContextContent}
                </View>
              ) : null}
              <View style={styles.toolRow}>
                <TouchableOpacity style={[styles.toolButton, { borderColor: tool === 'draw' ? theme.primary : theme.borderSubtle, backgroundColor: tool === 'draw' ? theme.controlSelected : theme.surface }]} onPress={() => selectEditorTool(tool === 'draw' ? 'browse' : 'draw')} accessibilityRole="button" accessibilityState={{ selected: tool === 'draw' }} testID="route-tool-draw">
                  <Icon name="Pencil" size={20} color={theme.iconActive} /><Text style={[styles.toolLabel, { color: theme.foreground }]}>Draw</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.toolButton, { borderColor: tool === 'point' ? theme.primary : theme.borderSubtle, backgroundColor: tool === 'point' ? theme.controlSelected : theme.surface }]} onPress={() => selectEditorTool('point')} accessibilityRole="button" accessibilityState={{ selected: tool === 'point' }} testID="route-tool-point">
                  <Icon name="MapPin" size={20} color={theme.iconActive} /><Text style={[styles.toolLabel, { color: theme.foreground }]}>Point</Text>
                </TouchableOpacity>
                <TouchableOpacity disabled={draft.parts.length === 0} style={[styles.toolButton, { borderColor: tool === 'trim' ? theme.primary : theme.borderSubtle, backgroundColor: tool === 'trim' ? theme.controlSelected : theme.surface }, draft.parts.length === 0 && styles.disabled]} onPress={() => selectEditorTool(tool === 'trim' ? 'browse' : 'trim')} accessibilityRole="button" accessibilityState={{ selected: tool === 'trim', disabled: draft.parts.length === 0 }} testID="route-tool-trim">
                  <Icon name="Move" size={20} color={theme.iconActive} /><Text style={[styles.toolLabel, { color: theme.foreground }]}>Trim</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.undoButton, { borderColor: theme.borderSubtle, backgroundColor: theme.surface }, (!history || history.past.length === 0 || hasUncommittedRouteEdit) && styles.disabled]}
                  onPress={handleUndo}
                  disabled={!history || history.past.length === 0 || hasUncommittedRouteEdit}
                  accessibilityRole="button"
                  accessibilityLabel="Undo last Route edit"
                  accessibilityState={{ disabled: !history || history.past.length === 0 || hasUncommittedRouteEdit }}
                  testID="route-undo"
                >
                  <Icon name="Undo2" size={18} color={!history || history.past.length === 0 || hasUncommittedRouteEdit ? theme.iconInactive : theme.iconActive} strokeWidth={2.2} />
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

      <ModalCard visible={searchOpen} onDismiss={() => { searchAbortRef.current?.abort(); setSearchOpen(false); }} testID="route-place-search-modal">
        <ModalCardHeader title="Find a place" body="Search moves only the planning camera. It never adds or relocates Route points." onClose={() => { searchAbortRef.current?.abort(); setSearchOpen(false); }} />
        <TextInput
          value={searchQuery}
          onChangeText={value => {
            setSearchQuery(value);
            if (value.trim().length < 2) {
              searchAbortRef.current?.abort();
              setSearchState('idle');
              setSearchMessage(null);
              setSearchResults([]);
            }
          }}
          onSubmitEditing={() => { void runPlaceSearch(); }}
          returnKeyType="search"
          autoCapitalize="words"
          placeholder="City, park, trail or address"
          placeholderTextColor={theme.muted}
          accessibilityLabel="Place or city search"
          style={[styles.searchInput, { color: theme.foreground, backgroundColor: theme.surface, borderColor: theme.border }]}
        />
        <PrimaryButton label={searchState === 'error' || searchState === 'offline' ? 'Retry search' : 'Search'} onPress={() => { void runPlaceSearch(); }} loading={searchState === 'requesting'} disabled={searchQuery.trim().length < 2} style={styles.modalButton} />
        {searchMessage ? <Text style={[styles.searchMessage, { color: searchState === 'error' || searchState === 'offline' ? theme.destructive : theme.foregroundSecondary }]}>{searchMessage}</Text> : null}
        <ScrollView style={styles.modalScroll} keyboardShouldPersistTaps="handled">
          {searchResults.map(result => (
            <PrimaryButton
              key={result.id}
              label={result.label}
              variant="secondary"
              onPress={() => {
                userMovedCameraRef.current = true;
                setInitialLocation({ status: 'ready', point: result.center });
                moveCamera(result.center);
                setSearchOpen(false);
                setSearchState('results');
              }}
              style={styles.modalButton}
            />
          ))}
        </ScrollView>
      </ModalCard>

    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.md, padding: Spacing.xl },
  topBar: { position: 'absolute', top: 0, left: 0, right: 0, flexDirection: 'row', alignItems: 'center', paddingHorizontal: Spacing.md, zIndex: 10, borderBottomWidth: 0 },
  topTitleWrap: { flex: 1, alignItems: 'center' },
  topTitle: { fontSize: FontSize.h3, fontWeight: '800' },
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
  popoverChoice: { minHeight: 34, borderWidth: 1, borderRadius: RadiusRole.button, paddingHorizontal: Spacing.sm, alignItems: 'center', justifyContent: 'center' },
  popoverChoiceText: { fontSize: FontSize.small, fontWeight: '700' },
  popoverHint: { fontSize: FontSize.small, lineHeight: 17 },
  popoverAction: { minHeight: 38, borderTopWidth: StyleSheet.hairlineWidth, paddingTop: Spacing.sm, marginTop: Spacing.xs, flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  popoverActionText: { fontSize: FontSize.caption, fontWeight: '700' },
  // This target deliberately matches Mapbox's camera center. The bottom card
  // does not change the camera coordinate; camera padding is only used for the
  // one-time initial fit, so the visual target and confirmed coordinate agree.
  centerTarget: { position: 'absolute', left: '50%', top: '50%', width: 34, height: 34, marginLeft: -17, marginTop: -17, alignItems: 'center', justifyContent: 'center', zIndex: 8 },
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
  contextPanel: { minHeight: 52, borderWidth: 1, borderRadius: RadiusRole.card, paddingHorizontal: Spacing.sm, paddingVertical: 8, justifyContent: 'center' },
  contextContent: { justifyContent: 'center', gap: 8 },
  pointInlineRow: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.sm },
  trimInlineRow: { minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  trimSliderFrame: { flex: 1, minWidth: 0, paddingHorizontal: 2 },
  contextProgress: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  contextText: { flexShrink: 1, fontSize: FontSize.small, lineHeight: 18, fontWeight: '600' },
  compactActionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: Spacing.sm },
  decisionInlineRow: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 6 },
  compactSecondaryAction: { minHeight: 44, alignSelf: 'flex-end', borderWidth: 1, borderRadius: RadiusRole.button, paddingHorizontal: Spacing.md, alignItems: 'center', justifyContent: 'center' },
  compactPrimaryAction: { minHeight: 44, alignSelf: 'flex-end', borderRadius: RadiusRole.button, paddingHorizontal: Spacing.md, alignItems: 'center', justifyContent: 'center' },
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
});
