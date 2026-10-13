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
  View,
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import * as Location from 'expo-location';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { BackButton } from '../components/BackButton';
import { Icon } from '../components/Icon';
import { MapLoadOverlay, type MapLoadState } from '../components/MapLoadOverlay';
import { ModalCard, ModalCardHeader } from '../components/ModalCard';
import { PrimaryButton } from '../components/PrimaryButton';
import { RouteDrawOverlay } from '../components/map/RouteDrawOverlay';
import { CanonicalRouteLayer } from '../components/map/CanonicalRouteLayer';
import { FogLayer } from '../features/memory/components/FogLayer';
import { useFriendMemoryStore } from '../features/memory/store/useFriendMemoryStore';
import { useMemorySubscriptionsStore } from '../features/memory/store/useMemorySubscriptionsStore';
import { getMapbox } from '../features/memory/services/mapboxAdapter';
import { TrimSlider } from '../components/map/TrimSlider';
import { FontSize, RadiusRole, Spacing } from '../components/tokens';
import { getCurrentRegion } from '../config/regions';
import { buildStandardConfig, getMapStyleForTheme, themeToStandardPreset } from '../config/mapbox';
import { segmentTrace } from '../features/activity/activityContracts';
import { loadActivityFinalArtifact } from '../features/activity/activityFinalArtifact';
import {
  applyDrawTransaction,
  classifyDrawTransaction,
  continueDrawTransaction,
  type DrawTransactionIntent,
} from '../features/route/routeEditTransactions';
import {
  appendOrderedSegment,
  beginRouteOperation,
  bridgeOrderedGap,
  cloneOrderedDraft,
  commitRouteHistory,
  createEmptyOrderedDraft,
  createImportedOrderedDraft,
  createLegacyOrderedDraft,
  normalizeOrderedPoints,
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
  loadRoutePlannerDraft,
  plannerDraftMatchesRequest,
  removeRoutePlannerDraft,
  saveRoutePlannerDraft,
} from '../features/route/routePlannerDraftPersistence';
import { RoutePlaceSearchError, searchRoutePlaces, type RoutePlaceSearchResult } from '../features/route/routePlaceSearch';
import {
  resolveDrawPlan,
  resolvePointPlan,
  type RouteProviderReason,
} from '../features/route/routePlanningProvider';
import { routeMatchesIdentity } from '../features/route/routeContracts';
import { selectActivityRouteImportPoints } from '../features/route/activityRouteImport';
import { canonicalRouteGeometry } from '../features/route/canonicalRouteGeometry';
import { useMapTheme } from '../hooks/useMapTheme';
import { useVisualTheme } from '../hooks/useVisualTheme';
import { uuidv4 } from '../services/offlineQueue';
import { useAppStore } from '../store/useAppStore';
import { useRouteStore, type RoutePoint } from '../store/useRouteStore';
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
  intent: PointTransactionIntent;
  reason: RouteProviderReason | null;
  baseRevision: number;
}

interface RouteGrowthAnimation {
  key: string;
  hiddenPartId?: string;
  points: RoutePoint[];
  visibleCount: number;
}

function providerReason(reason: RouteProviderReason): string {
  switch (reason) {
    case 'no-route': return 'No walking path was found. Move the target or draw this part yourself.';
    case 'no-match': return 'We could not match this path. Zoom in and draw a shorter stroke.';
    case 'split-match': return 'The provider returned disconnected pieces. Your Route is unchanged.';
    case 'endpoint-shift': return 'The mapped result moved an endpoint. Review it before applying.';
    case 'shape-deviation': return 'The mapped result may shortcut the path you drew. Review it first.';
    case 'chunk-seam': return 'The matched paths did not join safely. Your Route is unchanged.';
    case 'provider-unavailable': return 'Routing is unavailable. Your Route is unchanged; try again when connected.';
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

export function OrderedRouteEditorScreen() {
  const nav = useNavigation<any>();
  const screenRoute = useRoute<any>();
  const insets = useSafeAreaInsets();
  const theme = useVisualTheme();
  const mapTheme = useMapTheme();
  const dist = useDistance();
  const { online } = useOnlineOnly();
  const params = screenRoute.params ?? {};
  const routeId = params.routeId as string | undefined;
  const fromSessionId = params.fromSessionId as string | undefined;
  const sharedDeliveryId = params.sharedDeliveryId as string | undefined;
  const creationSource = params.creationSource as 'plan' | 'activity' | 'shared-copy' | undefined;
  const readOnlyShared = Boolean(sharedDeliveryId && creationSource !== 'shared-copy');
  const ownerId = useAppStore(state => String(state.user?.id ?? ''));
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
  const [tool, setTool] = useState<PlannerTool>('browse');
  const [selectedGapId, setSelectedGapId] = useState<string | undefined>();
  const [pendingReview, setPendingReview] = useState<PendingCandidateReview | null>(null);
  const [pendingPointReview, setPendingPointReview] = useState<PendingPointReview | null>(null);
  const [manualRecovery, setManualRecovery] = useState<PendingCandidateReview | null>(null);
  const [pendingMultiStroke, setPendingMultiStroke] = useState<Extract<DrawTransactionIntent, { kind: 'pending-bridge' | 'pending-replace' }> | null>(null);
  const [pausedDrawPoints, setPausedDrawPoints] = useState<RoutePoint[]>([]);
  const [moreOpen, setMoreOpen] = useState(false);
  const [trimOpen, setTrimOpen] = useState(false);
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
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<RoutePlaceSearchResult[]>([]);
  const [searchState, setSearchState] = useState<SearchState>('idle');
  const [searchMessage, setSearchMessage] = useState<string | null>(null);
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
  const routeAnimationTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const initializedKeyRef = useRef('');
  const initializingKeyRef = useRef('');
  const initialLocationAttemptedRef = useRef(false);
  const userMovedCameraRef = useRef(false);
  const cameraZoomRef = useRef(14);
  const nativeMapGesture = useMemo(() => Gesture.Native(), []);

  useEffect(() => {
    let mounted = true;
    void AccessibilityInfo.isReduceMotionEnabled().then(value => mounted && setReduceMotion(value));
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => { mounted = false; subscription.remove(); };
  }, []);

  const finishRouteAnimation = useCallback(() => {
    if (routeAnimationTimerRef.current) clearInterval(routeAnimationTimerRef.current);
    routeAnimationTimerRef.current = null;
    setRouteGrowthAnimation(null);
  }, []);

  const invalidatePendingOperation = useCallback(() => {
    operationAbortRef.current?.abort();
    operationAbortRef.current = null;
    activeOperationIdRef.current = null;
    providerTransactionRef.current = false;
    finishRouteAnimation();
    setProviderBusy(false);
    setResolvingDrawPoints([]);
    setPendingReview(null);
    setPendingPointReview(null);
    setManualRecovery(null);
    setPendingMultiStroke(null);
    setPausedDrawPoints([]);
    setSelectedGapId(undefined);
  }, [finishRouteAnimation]);

  const animateAcceptedPoint = useCallback((points: RoutePoint[], hiddenPartId?: string) => {
    finishRouteAnimation();
    if (reduceMotion || points.length < 3) return;
    const durationMs = 1150;
    const tickMs = 32;
    const startedAt = Date.now();
    const key = uuidv4();
    setRouteGrowthAnimation({ key, hiddenPartId, points, visibleCount: 2 });
    routeAnimationTimerRef.current = setInterval(() => {
      const elapsed = Date.now() - startedAt;
      const progress = Math.min(1, elapsed / durationMs);
      const visibleCount = Math.max(2, Math.ceil(progress * points.length));
      setRouteGrowthAnimation(current => current?.key === key ? { ...current, visibleCount } : current);
      if (progress >= 1) finishRouteAnimation();
    }, tickMs);
  }, [finishRouteAnimation, reduceMotion]);

  useEffect(() => () => finishRouteAnimation(), [finishRouteAnimation]);

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
    return true;
  }, []);

  useEffect(() => {
    const initKey = `${ownerId}|${routeId ?? ''}|${fromSessionId ?? ''}|${sharedDeliveryId ?? ''}|${creationSource ?? ''}`;
    if (!ownerId || initializedKeyRef.current === initKey || initializingKeyRef.current === initKey) return;
    initializingKeyRef.current = initKey;
    let cancelled = false;
    setInitializing(true);
    setError(null);
    void (async () => {
      let draft: OrderedRouteDraft;
      let initialName = '';
      let initialPermission: 'personal' | 'friend' = 'personal';
      const requestedDraftId = routeId
        ? `route:${routeId}`
        : fromSessionId
          ? `activity:${fromSessionId}`
          : sharedDeliveryId && creationSource === 'shared-copy'
            ? `received:${sharedDeliveryId}`
            : undefined;
      if (!readOnlyShared) {
        const recovered = await loadRoutePlannerDraft(ownerId, requestedDraftId);
        if (recovered && plannerDraftMatchesRequest(recovered, requestedDraftId)) {
          if (cancelled) return;
          historyRef.current = recovered.history;
          initialDraftRef.current = cloneOrderedDraft(recovered.history.present);
          setHistory(recovered.history);
          setName(recovered.name);
          setPermission(recovered.permission);
          setPendingMultiStroke(recovered.pendingDraw ?? null);
          initialBoundsRef.current = initialBounds(recovered.history.present);
          initializedKeyRef.current = initKey;
          initializingKeyRef.current = '';
          setInitializing(false);
          return;
        }
      }
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
        draft = createImportedOrderedDraft({ draftId: `activity:${fromSessionId}`, ownerId, segments });
        initialName = `${session.name || (session.activityMode === 'running' ? 'Run' : 'Hike')} Route`;
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
      } else {
        const recovered = await loadRoutePlannerDraft(ownerId);
        if (recovered && recovered.history.present.origin === 'plan' && !recovered.sourceRouteId && !recovered.sourceActivityId) {
          draft = recovered.history.present;
          initialName = recovered.name;
          initialPermission = recovered.permission;
          const recoveredHistory = recovered.history;
          if (cancelled) return;
          historyRef.current = recoveredHistory;
          initialDraftRef.current = cloneOrderedDraft(recoveredHistory.present);
          setHistory(recoveredHistory);
          setName(initialName);
          setPermission(initialPermission);
          setPendingMultiStroke(recovered.pendingDraw ?? null);
          initialBoundsRef.current = initialBounds(recoveredHistory.present);
          initializedKeyRef.current = initKey;
          initializingKeyRef.current = '';
          setInitializing(false);
          return;
        }
        draft = createEmptyOrderedDraft({ draftId: `plan:${uuidv4()}`, ownerId });
      }
      const nextHistory = { present: draft, past: [] };
      if (cancelled) return;
      historyRef.current = nextHistory;
      initialDraftRef.current = cloneOrderedDraft(draft);
      initialBoundsRef.current = initialBounds(draft);
      setHistory(nextHistory);
      setName(initialName);
      setPermission(initialPermission);
      setPendingMultiStroke(null);
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
  }, [creationSource, fromSessionId, loadRouteDetail, loadSharedRouteDetail, ownerId, readOnlyShared, routeId, sharedDeliveryId]);

  useEffect(() => {
    if (!history || initializing || readOnlyShared) return;
    const timeout = setTimeout(() => {
      void saveRoutePlannerDraft({
        ownerId,
        draftId: history.present.draftId,
        history,
        name,
        permission,
        sourceActivityId: fromSessionId,
        sourceRouteId: routeId,
        reconnectsActivityGap: history.present.gaps.length === 0 && initialDraftRef.current?.gaps.length !== 0,
        pendingDraw: pendingMultiStroke ?? undefined,
      }).catch(() => setError('This draft could not be saved on this device. Keep this screen open.'));
    }, 120);
    return () => clearTimeout(timeout);
  }, [fromSessionId, history, initializing, name, ownerId, pendingMultiStroke, permission, readOnlyShared, routeId]);

  const draft = history?.present ?? null;
  const selectedGap = draft?.gaps.find(gap => gap.id === selectedGapId);
  const mapStyle = getMapStyleForTheme('outdoors', mapTheme);
  const lightPreset = themeToStandardPreset(mapTheme);
  const region = getCurrentRegion();
  const fallbackCenter: [number, number] = [region.centerLng, region.centerLat];

  const moveCamera = useCallback((point: RoutePoint, zoomLevel = 13.5) => {
    cameraRef.current?.setCamera?.({
      centerCoordinate: [point.lng, point.lat],
      zoomLevel,
      animationDuration: reduceMotion ? 0 : 550,
    });
  }, [reduceMotion]);

  useEffect(() => {
    if (initializing || !draft || initialBoundsRef.current || initialLocationAttemptedRef.current) return;
    initialLocationAttemptedRef.current = true;
    let cancelled = false;
    void (async () => {
      try {
        const permissionState = await Location.getForegroundPermissionsAsync();
        if (permissionState.status !== 'granted') {
          if (!cancelled) setError('Location is unavailable. Search for a place or browse the map to start planning.');
          return;
        }
        const lastKnown = await Location.getLastKnownPositionAsync({ maxAge: 2 * 60_000, requiredAccuracy: 200 });
        const fix = lastKnown ?? await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        if (cancelled || userMovedCameraRef.current) return;
        moveCamera({ lat: fix.coords.latitude, lng: fix.coords.longitude }, 14);
        setError(null);
      } catch {
        if (!cancelled && !userMovedCameraRef.current) {
          setError('Current location is unavailable. Search for a place or browse the map instead.');
        }
      }
    })();
    return () => { cancelled = true; };
  }, [draft, initializing, moveCamera]);

  const showRouteOverview = useCallback(() => {
    const points = historyRef.current?.present.parts.flatMap(part => part.points) ?? [];
    if (points.length < 2) { setError('Add a path before showing its overview.'); return; }
    const ne: [number, number] = [Math.max(...points.map(point => point.lng)), Math.max(...points.map(point => point.lat))];
    const sw: [number, number] = [Math.min(...points.map(point => point.lng)), Math.min(...points.map(point => point.lat))];
    cameraRef.current?.fitBounds?.(ne, sw, [insets.top + 110, 36, insets.bottom + 330, 36], reduceMotion ? 0 : 550);
  }, [insets.bottom, insets.top, reduceMotion]);

  const fitReviewPoints = useCallback((points: RoutePoint[]) => {
    if (points.length < 2) return;
    const ne: [number, number] = [Math.max(...points.map(point => point.lng)), Math.max(...points.map(point => point.lat))];
    const sw: [number, number] = [Math.min(...points.map(point => point.lng)), Math.min(...points.map(point => point.lat))];
    cameraRef.current?.fitBounds?.(ne, sw, [insets.top + 110, 36, insets.bottom + 330, 36], reduceMotion ? 0 : 450);
  }, [insets.bottom, insets.top, reduceMotion]);

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
      moveCamera({ lat: fix.coords.latitude, lng: fix.coords.longitude }, 14);
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
        setPendingMultiStroke({
          kind: 'pending-replace', points, draftId: current.present.draftId,
          baseRevision: current.present.revision, ambiguity: 'overlap',
        });
        setError('Redraw from clearer positions so Cairn can preserve the right path.');
        return;
      }
      const option = intent.options[0];
      if (!option) { setError('Redraw from clearer positions. Your Route is unchanged.'); return; }
      if (commitResult(applyDrawTransaction(current.present, { kind: 'replace', option }, points, resolution), 'replace-draw')) {
        setPendingMultiStroke(null);
      }
      return;
    }
    if (intent.kind === 'reject') {
      if (intent.code === 'STALE_TRANSACTION') setPendingMultiStroke(null);
      setError(editFailure(intent.code));
      return;
    }
    if (intent.kind === 'pending-bridge' || intent.kind === 'pending-replace') return;
    if (commitResult(
      applyDrawTransaction(current.present, intent, points, resolution),
      intent.kind === 'bridge' ? 'bridge-draw' : intent.kind === 'prepend' ? 'prepend-draw' : 'append-draw',
    )) {
      setPendingMultiStroke(null);
    }
    if (intent.kind === 'bridge') setSelectedGapId(undefined);
  }, [commitResult]);

  const handleDrawStroke = useCallback(async (raw: RoutePoint[]) => {
    const current = historyRef.current;
    if (!current) return;
    if (providerTransactionRef.current) {
      setError('Finish or cancel the current Route edit first.');
      return;
    }
    const priorPaused = pausedDrawPoints;
    if (priorPaused.length && routePointDistanceM(priorPaused.at(-1)!, raw[0]) > 20) {
      setError('Continue from the visible ink endpoint after moving the map.');
      return;
    }
    const resumedRaw = priorPaused.length
      ? normalizeOrderedPoints([...priorPaused, ...raw])
      : raw;
    setPausedDrawPoints([]);
    const transactionPoints = pendingMultiStroke
      ? normalizeOrderedPoints([...pendingMultiStroke.points, ...resumedRaw])
      : resumedRaw;
    const latitude = raw[0]?.lat ?? cameraCenterRef.current?.lat ?? 0;
    const metresPerPixel = 156543.03392 * Math.cos(latitude * Math.PI / 180) / (2 ** cameraZoomRef.current);
    const attachmentToleranceM = Math.max(4, Math.min(20, metresPerPixel * 24));
    const intent = pendingMultiStroke
      ? continueDrawTransaction(current.present, pendingMultiStroke, resumedRaw)
      : classifyDrawTransaction(current.present, resumedRaw, selectedGapId, attachmentToleranceM);
    if (intent.kind === 'reject') {
      if (intent.code === 'STALE_TRANSACTION') setPendingMultiStroke(null);
      setError(editFailure(intent.code));
      return;
    }
    if (intent.kind === 'pending-bridge' || intent.kind === 'pending-replace') {
      setPendingMultiStroke(intent);
      setError(intent.kind === 'pending-replace' && intent.ambiguity === 'overlap'
        ? 'Redraw from clearer positions so Cairn can preserve the right path.'
        : 'Reconnect this stroke to the Route, or Trim an end first.');
      return;
    }
    const operationId = uuidv4();
    const token = beginRouteOperation(current.present, ownerId, intent.kind === 'bridge' ? 'bridge' : intent.kind === 'replace' ? 'replace' : 'draw', operationId);
    operationAbortRef.current?.abort();
    const controller = new AbortController();
    providerTransactionRef.current = true;
    operationAbortRef.current = controller;
    activeOperationIdRef.current = operationId;
    setProviderBusy(true);
    setResolvingDrawPoints(transactionPoints);
    setError(null);
    try {
      const resolved = await resolveDrawPlan(transactionPoints, { signal: controller.signal });
      const live = historyRef.current;
      if (!live || controller.signal.aborted
        || !routeOperationIsCurrent(live.present, ownerId, token, activeOperationIdRef.current)) return;
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
      } else if (resolved.outcome === 'manual-available') {
        setManualRecovery({
          kind: 'draw',
          points: resolved.rawPoints,
          resolution: 'draw-manual',
          intent,
          reason: resolved.reason,
          baseRevision: live.present.revision,
        });
      } else {
        setError(providerReason(resolved.reason));
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
  }, [applyResolvedDraw, ownerId, pausedDrawPoints, pendingMultiStroke, selectedGapId]);

  const applyResolvedPoint = useCallback((points: RoutePoint[], intent: PointTransactionIntent, baseRevision: number) => {
    const current = historyRef.current;
    if (!current) return;
    if (current.present.revision !== baseRevision) {
      setError('This Route changed while the edit was being reviewed. The older result was not applied.');
      return;
    }
    if (intent.kind === 'append') {
      const result = appendOrderedSegment(current.present, points, 'point');
      if (commitResult(result, 'append-point')) {
        animateAcceptedPoint(points, result.ok ? result.draft.parts.at(-1)?.id : undefined);
        setTool('browse');
      }
      return;
    }
    if (intent.kind === 'bridge') {
      const previousPartIds = new Set(current.present.parts.map(part => part.id));
      const result = bridgeOrderedGap(current.present, intent.gapId, points, 'point');
      if (commitResult(result, 'bridge-point')) {
        const addedPart = result.ok ? result.draft.parts.find(part => !previousPartIds.has(part.id)) : undefined;
        animateAcceptedPoint(points, addedPart?.id);
        setSelectedGapId(undefined);
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
    const token = beginRouteOperation(current.present, ownerId, 'point', operationId);
    operationAbortRef.current?.abort();
    const controller = new AbortController();
    providerTransactionRef.current = true;
    operationAbortRef.current = controller;
    activeOperationIdRef.current = operationId;
    setProviderBusy(true);
    setError(null);
    try {
      const result = await resolvePointPlan(start, target, { signal: controller.signal });
      const live = historyRef.current;
      if (!live || controller.signal.aborted
        || !routeOperationIsCurrent(live.present, ownerId, token, activeOperationIdRef.current)) return;
      if (result.outcome === 'accepted') {
        applyResolvedPoint(result.points, intent, baseRevision);
      }
      else if (result.outcome === 'review') {
        setPendingPointReview({ kind: 'point', points: result.points, intent, reason: result.reason, baseRevision });
      } else setError(providerReason(result.reason));
    } finally {
      if (operationAbortRef.current === controller) {
        operationAbortRef.current = null;
        if (activeOperationIdRef.current === operationId) activeOperationIdRef.current = null;
        providerTransactionRef.current = false;
      }
      if (!controller.signal.aborted) setProviderBusy(false);
    }
  }, [applyResolvedPoint, finishRouteAnimation, ownerId]);

  const confirmPointTarget = useCallback(() => {
    const current = historyRef.current;
    const target = cameraCenterRef.current;
    if (!current || !target || providerBusy) return;
    if (pendingMultiStroke) {
      setError('Finish or cancel the current Draw before using Point.');
      return;
    }
    if (selectedGap) {
      const leftIndex = current.present.parts.findIndex(part => part.id === selectedGap.afterPartId);
      const left = current.present.parts[leftIndex]?.points.at(-1);
      const right = current.present.parts[leftIndex + 1]?.points[0];
      if (!left || !right) return;
      void runPointRequest(left, right, { kind: 'bridge', gapId: selectedGap.id });
      return;
    }
    if (current.present.parts.length === 0 && !current.present.startPoint) {
      if (commitResult(setOrderedDraftStart(current.present, target), 'set-start')) {
        setError('Start set. Pan to a destination and add it.');
      }
      return;
    }
    const start = current.present.parts.at(-1)?.points.at(-1) ?? current.present.startPoint;
    if (!start) return;
    void runPointRequest(start, target, { kind: 'append' });
  }, [commitResult, pendingMultiStroke, providerBusy, runPointRequest, selectedGap]);

  const hasUncommittedRouteEdit = providerBusy
    || providerTransactionRef.current
    || Boolean(pausedDrawPoints.length || pendingMultiStroke || pendingReview || pendingPointReview || manualRecovery);

  const handleUndo = useCallback(() => {
    // The provider guard is set synchronously before React can render the
    // corresponding busy state. Read it at invocation time so an immediate
    // Undo cancels that transaction instead of consuming committed history.
    if (providerTransactionRef.current || hasUncommittedRouteEdit) {
      invalidatePendingOperation();
      setTool('browse');
      setError('In-progress Route edit cancelled. Your Route is unchanged.');
      return;
    }
    invalidatePendingOperation();
    const current = historyRef.current;
    if (!current) return;
    const next = undoRouteHistory(current);
    historyRef.current = next;
    setHistory(next);
    setError(null);
  }, [hasUncommittedRouteEdit, invalidatePendingOperation]);

  const applyTrim = useCallback(() => {
    const current = historyRef.current;
    if (!current || current.present.parts.length === 0) return;
    if (trimStart <= 0.001 && trimEnd >= 0.999) return;
    if (pendingMultiStroke) {
      setError('Finish or cancel the in-progress stroke before trimming.');
      return;
    }
    const start = orderedPositionAtDistanceFraction(current.present, trimStart);
    const end = orderedPositionAtDistanceFraction(current.present, trimEnd);
    if (!start || !end) return;
    if (commitResult(trimOrderedDraft(current.present, start, end), 'trim')) {
      setTrimOpen(false);
      setTool('browse');
      setTrimStart(0);
      setTrimEnd(1);
    }
  }, [commitResult, pendingMultiStroke, trimEnd, trimStart]);

  const saveRoute = useCallback(async () => {
    const current = historyRef.current;
    if (!current || saving || readOnlyShared) return;
    if (pendingMultiStroke) { setError('Finish or cancel the in-progress stroke before saving.'); return; }
    const title = name.trim();
    if (!title) { setError('Name this Route before saving.'); return; }
    if (current.present.parts.length === 0) { setError('Add a path before saving this Route.'); return; }
    setSaving(true);
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
      await removeRoutePlannerDraft(ownerId, current.present.draftId).catch(() => undefined);
      // Replace only the editor so Back returns to the originating Trails /
      // Routes context (tab, query and scroll state remain owned there).
      nav.replace('MapHistory', { routeId: savedId });
    } catch (cause: any) {
      setError(cause?.outcomeUnknown
        ? 'The save outcome is not confirmed. This draft remains available for recovery.'
        : 'This Route could not be saved. The draft remains on this device.');
    } finally {
      setSaving(false);
    }
  }, [addRoute, fromSessionId, name, nav, ownerId, pendingMultiStroke, permission, readOnlyShared, routeId, saving, sessions, updateRoute]);

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

  const pointActionLabel = selectedGap
    ? 'Connect gap with Point'
    : draft.parts.length === 0 && !draft.startPoint
      ? 'Set start'
      : 'Add here';
  const trimPreviewResult = (() => {
    if (!trimOpen || draft.parts.length === 0) return null;
    const start = orderedPositionAtDistanceFraction(draft, trimStart);
    const end = orderedPositionAtDistanceFraction(draft, trimEnd);
    if (!start || !end) return null;
    const result = trimOrderedDraft(draft, start, end);
    return result.ok ? result.draft : null;
  })();
  const displayDraft = trimPreviewResult ?? draft;
  const routeGeometry = canonicalRouteGeometry({ orderedDraft: displayDraft });
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
      coordinates: routeGrowthAnimation.points
        .slice(0, routeGrowthAnimation.visibleCount)
        .map(point => [point.lng, point.lat]),
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
  const reviewPoints = pendingReview?.points ?? pendingPointReview?.points ?? [];
  const reviewIntervals = (() => {
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
  const visiblePendingPoints = resolvingDrawPoints.length >= 2
    ? resolvingDrawPoints
    : pendingMultiStroke?.points ?? pausedDrawPoints;
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

  return (
    <View style={[styles.screen, { backgroundColor: theme.background }]} testID="ordered-route-editor">
      {MapView ? (
        <GestureDetector gesture={nativeMapGesture}>
        <MapView
          key={`ordered-route-map-${mapEpoch}`}
          ref={mapViewRef}
          style={StyleSheet.absoluteFill}
          {...(mapStyle.kind === 'url' ? { styleURL: mapStyle.url } : { styleJSON: mapStyle.json })}
          logoEnabled
          attributionEnabled
          logoPosition={{ top: insets.top + 56, right: 8 }}
          attributionPosition={{ top: insets.top + 88, right: 8 }}
          scaleBarEnabled={false}
          compassEnabled={false}
          scrollEnabled
          zoomEnabled
          rotateEnabled
          pitchEnabled
          onDidFinishLoadingMap={() => setMapReady(true)}
          onDidFinishRenderingMapFully={() => setMapReady(true)}
          onMapLoadingError={() => setMapLoadState('error')}
          onCameraChanged={(event: any) => {
            const center = event?.properties?.center;
            if (Array.isArray(center) && center.length >= 2) cameraCenterRef.current = { lng: Number(center[0]), lat: Number(center[1]) };
            const zoom = Number(event?.properties?.zoom);
            if (Number.isFinite(zoom)) cameraZoomRef.current = zoom;
            if (event?.properties?.isUserInteraction) userMovedCameraRef.current = true;
          }}
        >
          {StyleImport ? <StyleImport key={lightPreset} id="basemap" existing config={buildStandardConfig(mapTheme) as any} /> : null}
          {Camera ? initialBoundsRef.current ? (
            <Camera
              ref={cameraRef}
              bounds={{
                ...initialBoundsRef.current,
                paddingTop: insets.top + 100,
                paddingBottom: insets.bottom + 300,
                paddingLeft: 40,
                paddingRight: 40,
              }}
              animationDuration={0}
            />
          ) : <Camera ref={cameraRef} centerCoordinate={fallbackCenter} zoomLevel={Math.max(region.defaultZoom, 10)} animationDuration={0} /> : null}
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
            idPrefix="ordered-route"
            hiddenPartId={routeGrowthAnimation?.hiddenPartId}
          />
          {ShapeSource && LineLayer && animationFeature ? (
            <ShapeSource id="ordered-route-growth" shape={animationFeature}>
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
        </GestureDetector>
      ) : (
        <View style={[StyleSheet.absoluteFill, styles.centered, { backgroundColor: theme.background }]}>
          <Text style={[styles.helper, { color: theme.foregroundSecondary }]}>Map unavailable</Text>
        </View>
      )}
      {MapView && !mapReady ? (
        <MapLoadOverlay
          state={mapLoadState}
          onRetry={() => { setMapReady(false); setMapLoadState('loading'); setMapEpoch(value => value + 1); }}
          testID="ordered-route-map-load-overlay"
        />
      ) : null}

      <View style={[styles.mapTools, { top: insets.top + 128 }]}>
        <TouchableOpacity
          style={[styles.mapToolButton, { backgroundColor: theme.mapOverlay, borderColor: theme.border }]}
          onPress={() => setSearchOpen(true)}
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
            style={[styles.mapToolButton, { backgroundColor: theme.mapOverlay, borderColor: theme.border }]}
            onPress={() => {
              setMoreOpen(value => !value);
              void loadMemorySubscriptions();
            }}
            accessibilityRole="button"
            accessibilityLabel="More Route actions"
            testID="route-more"
          ><Icon name="Settings2" size={19} color={theme.iconActive} /></TouchableOpacity>
        ) : null}
        {tool === 'point' && !readOnlyShared ? (
          <TouchableOpacity
            style={[styles.compactMapAction, { backgroundColor: theme.primaryAction, borderColor: theme.primaryAction }]}
            onPress={confirmPointTarget}
            disabled={providerBusy}
            accessibilityRole="button"
            accessibilityLabel={pointActionLabel}
            testID="route-point-add-here"
          >
            {providerBusy ? <ActivityIndicator size="small" color={theme.onPrimary} /> : <Icon name="Plus" size={15} color={theme.onPrimary} />}
            <Text style={[styles.compactMapActionText, { color: theme.onPrimary }]}>{draft.parts.length === 0 && !draft.startPoint ? 'Set start' : selectedGap ? 'Connect' : 'Add here'}</Text>
          </TouchableOpacity>
        ) : null}
      </View>

      {moreOpen && !readOnlyShared ? (
        <View style={[styles.morePopover, { top: insets.top + 128, backgroundColor: theme.surfaceElevated, borderColor: theme.border, shadowColor: theme.shadow }]} testID="route-more-menu">
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
          <TouchableOpacity
            style={[styles.popoverAction, { borderTopColor: theme.borderSubtle }]}
            onPress={() => {
              invalidatePendingOperation();
              const initial = initialDraftRef.current;
              if (initial) {
                const next = { present: cloneOrderedDraft(initial), past: [] };
                historyRef.current = next;
                setHistory(next);
              }
              setMoreOpen(false);
            }}
          ><Icon name="RotateCcw" size={15} color={theme.destructive} /><Text style={[styles.popoverActionText, { color: theme.destructive }]}>Reset draft</Text></TouchableOpacity>
        </View>
      ) : null}

      <View style={[styles.topBar, { paddingTop: insets.top + Spacing.sm }]} pointerEvents="box-none">
        <BackButton variant="inline" onPress={() => nav.goBack()} />
        <View style={styles.topTitleWrap}>
          <Text style={[styles.topTitle, { color: theme.foreground }]}>{readOnlyShared ? 'Shared Route' : routeId ? 'Edit Route' : 'Create Route'}</Text>
          <Text style={[styles.topSubtitle, { color: theme.foregroundSecondary }]}>Plan only · not walking evidence</Text>
        </View>
        {!readOnlyShared ? (
          <TouchableOpacity
            style={[styles.topUtility, { backgroundColor: theme.secondaryAction, borderColor: theme.borderSubtle }, (!history || (history.past.length === 0 && !hasUncommittedRouteEdit)) && styles.disabled]}
            onPress={handleUndo}
            disabled={!history || (history.past.length === 0 && !hasUncommittedRouteEdit)}
            accessibilityRole="button"
            accessibilityState={{ disabled: !history || (history.past.length === 0 && !hasUncommittedRouteEdit) }}
            accessibilityLabel="Undo last Route edit"
          >
            <Icon name="Undo2" size={17} color={!history || (history.past.length === 0 && !hasUncommittedRouteEdit) ? theme.iconInactive : theme.iconActive} strokeWidth={2.2} />
          </TouchableOpacity>
        ) : <View style={styles.topUtilityPlaceholder} />}
      </View>

      {tool === 'point' && !readOnlyShared && !pendingMultiStroke ? (
        <View pointerEvents="none" style={styles.centerTarget}>
          <View style={[styles.targetRing, { borderColor: theme.primary }]} />
          <View style={[styles.targetDot, { backgroundColor: theme.primary }]} />
        </View>
      ) : null}

      <RouteDrawOverlay
        active={tool === 'draw' && !readOnlyShared}
        mapViewRef={mapViewRef}
        onStroke={points => { void handleDrawStroke(points); }}
        onPause={points => {
          setPausedDrawPoints(points);
          setError('Map moved. Continue Draw from the visible ink endpoint.');
        }}
        nativeMapGesture={nativeMapGesture}
        onCancel={reason => {
          setError(reason === 'gesture-interrupted'
            ? 'Use two fingers to move the map while Draw stays active.'
            : 'The map could not read that stroke. Your Route is unchanged.');
        }}
        bottomInset={(trimOpen ? 370 : 270) + insets.bottom}
        strokeColor={theme.primary}
      />

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.bottomWrap} pointerEvents="box-none">
        <View style={[styles.bottomCard, { paddingBottom: insets.bottom + Spacing.md, backgroundColor: theme.surfaceElevated, borderColor: theme.border, shadowColor: theme.shadow }]}>
          {error ? (
            <TouchableOpacity style={[styles.notice, { backgroundColor: theme.destructiveSurface }]} onPress={() => setError(null)}>
              <Icon name="TriangleAlert" size={15} color={theme.destructive} strokeWidth={2.2} />
              <Text style={[styles.noticeText, { color: theme.destructive }]}>{error}</Text>
            </TouchableOpacity>
          ) : null}
          {providerBusy ? (
            <View style={styles.busyRow}><ActivityIndicator size="small" color={theme.primary} /><Text style={[styles.helper, { color: theme.foregroundSecondary }]}>Preparing one Route edit…</Text></View>
          ) : null}
          {pendingMultiStroke ? (
            <View style={[styles.gapNotice, { backgroundColor: theme.controlSelected, borderColor: theme.borderSubtle }]} testID="route-pending-multistroke">
              <Text style={[styles.gapTitle, { color: theme.foreground }]}>Draw is still active</Text>
              <Text style={[styles.helper, { color: theme.foregroundSecondary }]}>{pendingMultiStroke.kind === 'pending-replace' && pendingMultiStroke.ambiguity === 'overlap' ? 'Redraw from clearer positions; the approved Route is unchanged.' : 'Move the map with two fingers, then continue from the visible endpoint.'}</Text>
              <TouchableOpacity onPress={() => { setPendingMultiStroke(null); setPausedDrawPoints([]); setError('Unfinished draw cancelled. Your Route is unchanged.'); }} accessibilityRole="button">
                <Text style={[styles.linkText, { color: theme.primary }]}>Cancel unfinished draw</Text>
              </TouchableOpacity>
            </View>
          ) : null}
          {draft.gaps.length > 0 ? (
            <View style={[styles.gapNotice, { backgroundColor: theme.destructiveSurface, borderColor: theme.borderSubtle }]}>
              <View style={styles.gapHeading}><Icon name="TriangleAlert" size={16} color={theme.destructive} /><Text style={[styles.gapTitle, { color: theme.foreground }]}>{draft.gaps.length} unknown {draft.gaps.length === 1 ? 'gap' : 'gaps'}</Text></View>
              <Text style={[styles.helper, { color: theme.foregroundSecondary }]}>This imported Activity has a real recording gap. Connect the next dashed break before Use or Share.</Text>
              <TouchableOpacity
                disabled={Boolean(pendingMultiStroke)}
                style={[styles.chip, { borderColor: selectedGapId ? theme.primary : theme.borderSubtle, backgroundColor: selectedGapId ? theme.controlSelected : theme.surface }, pendingMultiStroke && styles.disabled]}
                onPress={() => { setSelectedGapId(selectedGapId ? undefined : draft.gaps[0]?.id); setTool('draw'); }}
              ><Text style={[styles.chipText, { color: theme.foreground }]}>{selectedGapId ? 'Gap ready — draw or use Point' : 'Connect next gap'}</Text></TouchableOpacity>
            </View>
          ) : null}

          {readOnlyShared ? (
            <>
              <View style={[styles.summary, { backgroundColor: theme.surface, borderColor: theme.borderSubtle }]}>
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
              <View style={[styles.summary, { backgroundColor: theme.surface, borderColor: theme.borderSubtle }]}>
                <TextInput
                  value={name}
                  onChangeText={setName}
                  placeholder="Route name"
                  placeholderTextColor={theme.muted}
                  style={[styles.nameInput, { color: theme.foreground }]}
                  accessibilityLabel="Route name"
                />
                <Text style={[styles.helper, { color: theme.foregroundSecondary }]}>
                  {dist.format(orderedDraftDistanceM(displayDraft), 1)} {dist.unit}{draft.origin === 'activity' ? ' · From Activity' : ' · Planned'}{reduceMotion ? ' · Reduce Motion' : ''}
                </Text>
              </View>
              <View style={styles.toolRow}>
                <TouchableOpacity style={[styles.toolButton, { borderColor: tool === 'draw' ? theme.primary : theme.borderSubtle, backgroundColor: tool === 'draw' ? theme.controlSelected : theme.surface }]} onPress={() => { setTool(tool === 'draw' ? 'browse' : 'draw'); setTrimOpen(false); setError(tool === 'draw' ? null : pendingMultiStroke ? 'Continue from the visible endpoint.' : selectedGap ? 'Draw across the dashed gap.' : 'One finger draws. Two fingers move the map.'); }} accessibilityRole="button" accessibilityState={{ selected: tool === 'draw' }}>
                  <Icon name="Pencil" size={20} color={theme.iconActive} /><Text style={[styles.toolLabel, { color: theme.foreground }]}>Draw</Text>
                </TouchableOpacity>
                <TouchableOpacity disabled={Boolean(pendingMultiStroke)} style={[styles.toolButton, { borderColor: tool === 'point' ? theme.primary : theme.borderSubtle, backgroundColor: tool === 'point' ? theme.controlSelected : theme.surface }, pendingMultiStroke && styles.disabled]} onPress={() => setTool('point')} accessibilityRole="button" accessibilityState={{ selected: tool === 'point', disabled: Boolean(pendingMultiStroke) }}>
                  <Icon name="MapPin" size={20} color={theme.iconActive} /><Text style={[styles.toolLabel, { color: theme.foreground }]}>Point</Text>
                </TouchableOpacity>
                <TouchableOpacity disabled={Boolean(pendingMultiStroke) || draft.parts.length === 0} style={[styles.toolButton, { borderColor: tool === 'trim' ? theme.primary : theme.borderSubtle, backgroundColor: tool === 'trim' ? theme.controlSelected : theme.surface }, (pendingMultiStroke || draft.parts.length === 0) && styles.disabled]} onPress={() => { setTool('trim'); setTrimOpen(true); setTrimStart(0); setTrimEnd(1); setError(null); }} accessibilityRole="button" accessibilityState={{ selected: tool === 'trim', disabled: Boolean(pendingMultiStroke) || draft.parts.length === 0 }}>
                  <Icon name="Move" size={20} color={theme.iconActive} /><Text style={[styles.toolLabel, { color: theme.foreground }]}>Trim</Text>
                </TouchableOpacity>
              </View>
              {trimOpen ? (
                <View style={[styles.trimStrip, { backgroundColor: theme.surface, borderColor: theme.borderSubtle }]} testID="route-trim-strip">
                  <View style={styles.trimHeading}><Text style={[styles.gapTitle, { color: theme.foreground }]}>Keep {dist.format(orderedDraftDistanceM(displayDraft), 1)} {dist.unit}</Text><Text style={[styles.helper, { color: theme.foregroundSecondary }]}>Drag either end</Text></View>
                  <TrimSlider trimStartFrac={trimStart} trimEndFrac={trimEnd} onTrimStartChange={setTrimStart} onTrimEndChange={setTrimEnd} totalLengthM={orderedDraftDistanceM(draft)} />
                  <View style={styles.compactActionRow}>
                    <TouchableOpacity style={[styles.compactSecondaryAction, { borderColor: theme.borderSubtle }]} onPress={() => { setTrimOpen(false); setTool('browse'); setTrimStart(0); setTrimEnd(1); }}><Text style={[styles.compactActionText, { color: theme.foreground }]}>Cancel</Text></TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.compactPrimaryAction, { backgroundColor: theme.primaryAction }, trimStart <= 0.001 && trimEnd >= 0.999 && styles.disabled]}
                      onPress={applyTrim}
                      disabled={trimStart <= 0.001 && trimEnd >= 0.999}
                      accessibilityRole="button"
                      accessibilityState={{ disabled: trimStart <= 0.001 && trimEnd >= 0.999 }}
                      testID="route-trim-apply"
                    ><Text style={[styles.compactActionText, { color: theme.onPrimary }]}>Apply Trim</Text></TouchableOpacity>
                  </View>
                </View>
              ) : null}
              {pendingReview || pendingPointReview || manualRecovery ? (
                <View style={[styles.inlineReview, { backgroundColor: theme.controlSelected, borderColor: theme.borderSubtle }]} testID="route-inline-review">
                  <Text style={[styles.helper, { color: theme.foreground }]}>{pendingReview ? providerReason(pendingReview.reason) : pendingPointReview ? providerReason(pendingPointReview.reason ?? 'shape-deviation') : manualRecovery ? providerReason(manualRecovery.reason) : ''}</Text>
                  <View style={styles.compactActionRow}>
                    <TouchableOpacity style={[styles.compactPrimaryAction, { backgroundColor: theme.primaryAction }]} onPress={() => {
                      if (pendingReview) { const pending = pendingReview; setPendingReview(null); applyResolvedDraw(pending.points, pending.resolution, pending.intent); }
                      else if (pendingPointReview) { const pending = pendingPointReview; setPendingPointReview(null); applyResolvedPoint(pending.points, pending.intent, pending.baseRevision); }
                      else if (manualRecovery) { const pending = manualRecovery; setManualRecovery(null); applyResolvedDraw(pending.points, 'draw-manual', pending.intent); }
                    }}><Text style={[styles.compactActionText, { color: theme.onPrimary }]}>{manualRecovery ? 'Keep as drawn' : 'Use this path'}</Text></TouchableOpacity>
                    <TouchableOpacity style={[styles.compactSecondaryAction, { borderColor: theme.borderSubtle }]} onPress={() => { setPendingReview(null); setPendingPointReview(null); setManualRecovery(null); setTool('draw'); }}><Text style={[styles.compactActionText, { color: theme.foreground }]}>Redraw</Text></TouchableOpacity>
                  </View>
                </View>
              ) : null}
              <View style={styles.editorFooterRow}>
                <Text style={[styles.helper, styles.editorFooterMeta, { color: theme.foregroundSecondary }]}>{draft.gaps.length ? 'Draft needs gap repair' : 'Ready to save'}</Text>
                <TouchableOpacity
                  style={[styles.compactSaveAction, { backgroundColor: theme.primaryAction }, (draft.parts.length === 0 || !name.trim() || Boolean(pendingMultiStroke)) && styles.disabled]}
                  onPress={() => { void saveRoute(); }}
                  disabled={saving || draft.parts.length === 0 || !name.trim() || Boolean(pendingMultiStroke)}
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
  topBar: { position: 'absolute', top: 0, left: 0, right: 0, flexDirection: 'row', alignItems: 'center', paddingHorizontal: Spacing.md, zIndex: 10 },
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
  summary: { borderWidth: 1, borderRadius: RadiusRole.card, paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm },
  nameInput: { fontSize: FontSize.h3, fontWeight: '700', paddingVertical: Spacing.xs },
  nameReadOnly: { fontSize: FontSize.h3, fontWeight: '700', marginBottom: Spacing.xs },
  helper: { fontSize: FontSize.small, lineHeight: 18 },
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
  toolRow: { flexDirection: 'row', gap: Spacing.sm },
  toolButton: { flex: 1, minHeight: 44, borderWidth: 1, borderRadius: RadiusRole.button, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5 },
  toolLabel: { fontSize: FontSize.small, fontWeight: '700' },
  disabled: { opacity: 0.42 },
  pointActions: { gap: Spacing.sm, alignItems: 'center' },
  linkText: { fontSize: FontSize.small, fontWeight: '700', padding: Spacing.xs },
  trimStrip: { borderWidth: 1, borderRadius: RadiusRole.card, paddingHorizontal: Spacing.sm, paddingTop: Spacing.sm, paddingBottom: Spacing.xs },
  trimHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.sm },
  compactActionRow: { flexDirection: 'row', justifyContent: 'flex-end', gap: Spacing.sm },
  compactSecondaryAction: { minHeight: 36, borderWidth: 1, borderRadius: RadiusRole.button, paddingHorizontal: Spacing.md, alignItems: 'center', justifyContent: 'center' },
  compactPrimaryAction: { minHeight: 36, borderRadius: RadiusRole.button, paddingHorizontal: Spacing.md, alignItems: 'center', justifyContent: 'center' },
  compactActionText: { fontSize: FontSize.caption, fontWeight: '800' },
  inlineReview: { borderWidth: 1, borderRadius: RadiusRole.card, padding: Spacing.sm, gap: Spacing.sm },
  editorFooterRow: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.md },
  editorFooterMeta: { flex: 1 },
  compactSaveAction: { minHeight: 40, minWidth: 86, borderRadius: RadiusRole.button, paddingHorizontal: Spacing.md, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5 },
  row: { flexDirection: 'row', gap: Spacing.sm },
  flexButton: { flex: 1 },
  modalButton: { marginTop: Spacing.sm },
  modalScroll: { maxHeight: 320 },
  searchInput: { minHeight: 48, borderWidth: 1, borderRadius: RadiusRole.input, paddingHorizontal: Spacing.md, fontSize: FontSize.body },
  searchMessage: { marginTop: Spacing.sm, fontSize: FontSize.small, lineHeight: 18 },
});
