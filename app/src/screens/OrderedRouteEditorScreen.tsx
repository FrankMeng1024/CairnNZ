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
import { BackButton } from '../components/BackButton';
import { Icon } from '../components/Icon';
import { MapLoadOverlay, type MapLoadState } from '../components/MapLoadOverlay';
import { ModalCard, ModalCardHeader } from '../components/ModalCard';
import { PrimaryButton } from '../components/PrimaryButton';
import { RouteDrawOverlay } from '../components/map/RouteDrawOverlay';
import { FogLayer } from '../features/memory/components/FogLayer';
import { useFriendMemoryStore } from '../features/memory/store/useFriendMemoryStore';
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
  nearestOrderedPositions,
  type DrawTransactionIntent,
  type RouteAnchorCandidate,
  type RouteIntervalCandidate,
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
  keepOnlyOrderedPart,
  compareOrderedPositions,
  normalizeOrderedPoints,
  orderedDraftCanUseOrShare,
  orderedDraftDistanceM,
  orderedDraftPoints,
  orderedIntervalPoints,
  orderedIntervalCrossesGap,
  orderedPositionAtDistanceFraction,
  orderedPositionPoint,
  replaceOrderedInterval,
  routeOperationIsCurrent,
  routePointDistanceM,
  setOrderedDraftStart,
  trimOrderedDraft,
  undoRouteHistory,
  type EditableRouteResolution,
  type OrderedPosition,
  type OrderedRouteDraft,
  type RouteDraftHistory,
} from '../features/route/orderedRouteDraft';
import {
  loadRoutePlannerDraft,
  plannerDraftMatchesRequest,
  removeRoutePlannerDraft,
  saveRoutePlannerDraft,
} from '../features/route/routePlannerDraftPersistence';
import { searchRoutePlaces, type RoutePlaceSearchResult } from '../features/route/routePlaceSearch';
import {
  resolveDrawPlan,
  resolvePointPlan,
  type RouteProviderReason,
} from '../features/route/routePlanningProvider';
import { routeMatchesIdentity } from '../features/route/routeContracts';
import { useMapTheme } from '../hooks/useMapTheme';
import { useVisualTheme } from '../hooks/useVisualTheme';
import { uuidv4 } from '../services/offlineQueue';
import { useAppStore } from '../store/useAppStore';
import { useRouteStore, type RoutePoint } from '../store/useRouteStore';
import { loadActivityTrackPoints, useSessionStore } from '../store/useSessionStore';
import { useDistance } from '../utils/distanceFormat';

let MapView: any = null;
let Camera: any = null;
let ShapeSource: any = null;
let LineLayer: any = null;
let CircleLayer: any = null;
let SymbolLayer: any = null;
let StyleImport: any = null;
if (Platform.OS !== 'web') {
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

type PlannerTool = 'browse' | 'draw' | 'point';
type PointIntent = 'append' | 'replace-start' | 'replace-end';

interface PendingDrawChoice {
  points: RoutePoint[];
  resolution: EditableRouteResolution;
  options: RouteIntervalCandidate[];
}

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
  | { kind: 'bridge'; gapId: string }
  | { kind: 'replace'; start: OrderedPosition; end: OrderedPosition; reverse: boolean };

interface PendingPointReview {
  kind: 'point';
  points: RoutePoint[];
  intent: PointTransactionIntent;
  reason: RouteProviderReason | null;
  baseRevision: number;
}

interface PendingIntervalReview {
  points: RoutePoint[];
  resolution: EditableRouteResolution;
  option: RouteIntervalCandidate;
  allOptions: RouteIntervalCandidate[];
  baseRevision: number;
}

interface PendingAnchorChoice {
  role: 'start' | 'end';
  options: RouteAnchorCandidate[];
  target: RoutePoint;
}

interface RouteGrowthAnimation {
  key: string;
  hiddenPartId?: string;
  points: RoutePoint[];
  visibleCount: number;
}

function providerReason(reason: RouteProviderReason): string {
  switch (reason) {
    case 'no-route': return 'No walking route found. Move the target or draw this section yourself.';
    case 'no-match': return 'We could not match this part. Zoom in and draw a shorter section.';
    case 'split-match': return 'The provider returned disconnected pieces. Your Route is unchanged.';
    case 'endpoint-shift': return 'The mapped result moved an endpoint. Review it before applying.';
    case 'shape-deviation': return 'The mapped result may shortcut the path you drew. Review it first.';
    case 'chunk-seam': return 'The matched sections did not join safely. Your Route is unchanged.';
    case 'provider-unavailable': return 'Routing is unavailable. Your Route is unchanged; try again when connected.';
    default: return 'This edit could not be used. Your Route is unchanged.';
  }
}

function editFailure(code: string): string {
  switch (code) {
    case 'ZERO_LENGTH': return 'Move farther before confirming this edit.';
    case 'DISCONNECTED': return 'Start from the end of your Route, or choose a section to replace.';
    case 'AMBIGUOUS_INTERVAL': return 'Choose which section to replace.';
    case 'STALE_TRANSACTION': return 'This Route changed. The unfinished section was cancelled without changing your Route.';
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

function positionLabel(draft: OrderedRouteDraft, position: OrderedPosition): string {
  const part = draft.parts.findIndex(item => item.id === position.partId);
  return `Section ${part + 1}, ${position.fraction ? `between points ${position.pointIndex + 1}–${position.pointIndex + 2}` : `point ${position.pointIndex + 1}`}`;
}

export function OrderedRouteEditorScreen() {
  const nav = useNavigation<any>();
  const screenRoute = useRoute<any>();
  const insets = useSafeAreaInsets();
  const theme = useVisualTheme();
  const mapTheme = useMapTheme();
  const dist = useDistance();
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

  const [history, setHistory] = useState<RouteDraftHistory | null>(null);
  const historyRef = useRef<RouteDraftHistory | null>(null);
  const initialDraftRef = useRef<OrderedRouteDraft | null>(null);
  const [name, setName] = useState('');
  const [permission, setPermission] = useState<'personal' | 'friend'>('personal');
  const [tool, setTool] = useState<PlannerTool>('browse');
  const [pointIntent, setPointIntent] = useState<PointIntent>('append');
  const [replacementStart, setReplacementStart] = useState<OrderedPosition | null>(null);
  const [selectedGapId, setSelectedGapId] = useState<string | undefined>();
  const [pendingDrawChoice, setPendingDrawChoice] = useState<PendingDrawChoice | null>(null);
  const [pendingReview, setPendingReview] = useState<PendingCandidateReview | null>(null);
  const [pendingPointReview, setPendingPointReview] = useState<PendingPointReview | null>(null);
  const [pendingIntervalReview, setPendingIntervalReview] = useState<PendingIntervalReview | null>(null);
  const [manualRecovery, setManualRecovery] = useState<PendingCandidateReview | null>(null);
  const [pendingAnchor, setPendingAnchor] = useState<PendingAnchorChoice | null>(null);
  const [pendingMultiStroke, setPendingMultiStroke] = useState<Extract<DrawTransactionIntent, { kind: 'pending-bridge' | 'pending-replace' }> | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const [trimOpen, setTrimOpen] = useState(false);
  const [trimStart, setTrimStart] = useState(0);
  const [trimEnd, setTrimEnd] = useState(1);
  const [keepPartOpen, setKeepPartOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [initializing, setInitializing] = useState(true);
  const [saving, setSaving] = useState(false);
  const [providerBusy, setProviderBusy] = useState(false);
  const [mapReady, setMapReady] = useState(false);
  const [mapLoadState, setMapLoadState] = useState<MapLoadState>('loading');
  const [mapEpoch, setMapEpoch] = useState(0);
  const [reduceMotion, setReduceMotion] = useState(false);
  const [planningMemoryScope, setPlanningMemoryScope] = useState<'self' | 'combined'>('self');
  const [routeGrowthAnimation, setRouteGrowthAnimation] = useState<RouteGrowthAnimation | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<RoutePlaceSearchResult[]>([]);
  const [searchBusy, setSearchBusy] = useState(false);
  const mapViewRef = useRef<any>(null);
  const cameraRef = useRef<any>(null);
  const cameraCenterRef = useRef<RoutePoint | null>(null);
  const initialBoundsRef = useRef<ReturnType<typeof initialBounds>>(null);
  const operationAbortRef = useRef<AbortController | null>(null);
  const activeOperationIdRef = useRef<string | null>(null);
  const routeAnimationTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const initializedKeyRef = useRef('');
  const initializingKeyRef = useRef('');

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
    finishRouteAnimation();
    setProviderBusy(false);
    setPendingReview(null);
    setPendingPointReview(null);
    setPendingIntervalReview(null);
    setManualRecovery(null);
    setPendingDrawChoice(null);
    setPendingMultiStroke(null);
  }, [finishRouteAnimation]);

  const animateAcceptedPoint = useCallback((points: RoutePoint[], hiddenPartId?: string) => {
    finishRouteAnimation();
    if (reduceMotion || points.length < 3) return;
    const durationMs = 800;
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
        const artifact = await loadActivityFinalArtifact(ownerId, clientActivityId);
        const points = artifact?.points?.length ? artifact.points : await loadActivityTrackPoints(session);
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
  const routeParts = draft?.parts ?? [];
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

  const showRouteOverview = useCallback(() => {
    const points = historyRef.current?.present.parts.flatMap(part => part.points) ?? [];
    if (points.length < 2) { setError('Add a Route section before showing its overview.'); return; }
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
    const candidate = pendingIntervalReview?.points
      ?? pendingReview?.points
      ?? pendingPointReview?.points
      ?? pendingDrawChoice?.points
      ?? [];
    const intervals = pendingIntervalReview
      ? [orderedIntervalPoints(current, pendingIntervalReview.option.start, pendingIntervalReview.option.end)]
      : pendingPointReview?.intent.kind === 'replace'
        ? [orderedIntervalPoints(current, pendingPointReview.intent.start, pendingPointReview.intent.end)]
        : pendingReview?.intent.kind === 'replace'
          ? pendingReview.intent.options.map(option => orderedIntervalPoints(current, option.start, option.end))
          : pendingDrawChoice
            ? pendingDrawChoice.options.map(option => orderedIntervalPoints(current, option.start, option.end))
            : [];
    fitReviewPoints([...candidate, ...intervals.flat()]);
  }, [fitReviewPoints, pendingDrawChoice, pendingIntervalReview, pendingPointReview, pendingReview]);

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
    if (searchBusy) return;
    setSearchBusy(true);
    try {
      const results = await searchRoutePlaces(searchQuery);
      setSearchResults(results);
      if (results.length === 0) setError('No matching place was found. Try a city or a more specific name.');
      else setError(null);
    } catch {
      setSearchResults([]);
      setError('Place search is unavailable. Your Route is unchanged; browse the map or try again later.');
    } finally {
      setSearchBusy(false);
    }
  }, [searchBusy, searchQuery]);

  const applyResolvedDraw = useCallback((
    points: RoutePoint[],
    resolution: EditableRouteResolution,
    intent: DrawTransactionIntent,
  ) => {
    const current = historyRef.current;
    if (!current) return;
    if (intent.kind === 'replace') {
      if (intent.options.length > 1) {
        setPendingDrawChoice({ points, resolution, options: intent.options });
        return;
      }
      const option = intent.options[0];
      if (!option) { setError('Choose which section to replace.'); return; }
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
    if (commitResult(applyDrawTransaction(current.present, intent, points, resolution), intent.kind === 'bridge' ? 'bridge-draw' : 'append-draw')) {
      setPendingMultiStroke(null);
    }
    if (intent.kind === 'bridge') setSelectedGapId(undefined);
  }, [commitResult]);

  const handleDrawStroke = useCallback(async (raw: RoutePoint[]) => {
    setTool('browse');
    const current = historyRef.current;
    if (!current) return;
    const transactionPoints = pendingMultiStroke
      ? normalizeOrderedPoints([...pendingMultiStroke.points, ...raw])
      : raw;
    const intent = pendingMultiStroke
      ? continueDrawTransaction(current.present, pendingMultiStroke, raw)
      : classifyDrawTransaction(current.present, raw, selectedGapId);
    if (intent.kind === 'reject') {
      if (intent.code === 'STALE_TRANSACTION') setPendingMultiStroke(null);
      setError(editFailure(intent.code));
      return;
    }
    if (intent.kind === 'pending-bridge' || intent.kind === 'pending-replace') {
      setPendingMultiStroke(intent);
      setError('Section kept as a draft. Pan or zoom, then continue drawing from its open end.');
      return;
    }
    const operationId = uuidv4();
    const token = beginRouteOperation(current.present, ownerId, intent.kind === 'bridge' ? 'bridge' : intent.kind === 'replace' ? 'replace' : 'draw', operationId);
    operationAbortRef.current?.abort();
    const controller = new AbortController();
    operationAbortRef.current = controller;
    activeOperationIdRef.current = operationId;
    setProviderBusy(true);
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
      }
      if (!controller.signal.aborted) setProviderBusy(false);
    }
  }, [applyResolvedDraw, ownerId, pendingMultiStroke, selectedGapId]);

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
    if (commitResult(replaceOrderedInterval(
      current.present,
      intent.start,
      intent.end,
      intent.reverse ? [...points].reverse() : points,
      'point',
    ), 'replace-point')) {
      animateAcceptedPoint(points);
      setReplacementStart(null);
      setPointIntent('append');
      setTool('browse');
    }
  }, [animateAcceptedPoint, commitResult]);

  const runPointRequest = useCallback(async (
    start: RoutePoint,
    target: RoutePoint,
    intent: PointTransactionIntent,
  ) => {
    const current = historyRef.current;
    if (!current) return;
    finishRouteAnimation();
    const baseRevision = current.present.revision;
    const operationId = uuidv4();
    const token = beginRouteOperation(current.present, ownerId, 'point', operationId);
    operationAbortRef.current?.abort();
    const controller = new AbortController();
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
        setPendingPointReview({ kind: 'point', points: result.points, intent, reason: null, baseRevision });
      }
      else if (result.outcome === 'review') {
        setPendingPointReview({ kind: 'point', points: result.points, intent, reason: result.reason, baseRevision });
      } else setError(providerReason(result.reason));
    } finally {
      if (operationAbortRef.current === controller) {
        operationAbortRef.current = null;
        if (activeOperationIdRef.current === operationId) activeOperationIdRef.current = null;
      }
      if (!controller.signal.aborted) setProviderBusy(false);
    }
  }, [applyResolvedPoint, finishRouteAnimation, ownerId]);

  const chooseReplacementEnd = useCallback((end: RouteAnchorCandidate) => {
    const current = historyRef.current;
    const start = replacementStart;
    if (!current || !start) return;
    const comparison = compareOrderedPositions(current.present, start, end);
    if (comparison == null || comparison === 0 || orderedIntervalCrossesGap(
      current.present,
      comparison < 0 ? start : end,
      comparison < 0 ? end : start,
    )) {
      setError('Choose two ordered positions without an unknown gap between them.');
      return;
    }
    const startPoint = orderedPositionPoint(current.present, start);
    const endPoint = orderedPositionPoint(current.present, end);
    if (!startPoint || !endPoint) return;
    setPendingAnchor(null);
    const forward = comparison < 0;
    const lower = forward ? start : end;
    const upper = forward ? end : start;
    void runPointRequest(startPoint, endPoint, { kind: 'replace', start: lower, end: upper, reverse: !forward });
  }, [replacementStart, runPointRequest]);

  const chooseAnchor = useCallback((candidate: RouteAnchorCandidate) => {
    if (pendingAnchor?.role === 'start') {
      setReplacementStart({
        partId: candidate.partId,
        pointIndex: candidate.pointIndex,
        ...(candidate.fraction != null ? { fraction: candidate.fraction } : {}),
      });
      setPointIntent('replace-end');
      setPendingAnchor(null);
      setError('Pan to the end of the section, then confirm it.');
    } else if (pendingAnchor?.role === 'end') {
      chooseReplacementEnd(candidate);
    }
  }, [chooseReplacementEnd, pendingAnchor?.role]);

  const confirmPointTarget = useCallback(() => {
    const current = historyRef.current;
    const target = cameraCenterRef.current;
    if (!current || !target || providerBusy) return;
    if (pendingMultiStroke) {
      setError('Finish or cancel the in-progress Route section before using Point.');
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
    if (pointIntent === 'replace-start') {
      const options = nearestOrderedPositions(current.present, target);
      if (options.length === 0) { setError('Move the target onto the Route.'); return; }
      if (options.length > 1) setPendingAnchor({ role: 'start', options, target });
      else chooseAnchor(options[0]);
      return;
    }
    if (pointIntent === 'replace-end') {
      const options = nearestOrderedPositions(current.present, target)
        .filter(option => {
          if (!replacementStart) return false;
          const comparison = compareOrderedPositions(current.present, replacementStart, option);
          if (comparison == null || comparison === 0) return false;
          return !orderedIntervalCrossesGap(
            current.present,
            comparison < 0 ? replacementStart : option,
            comparison < 0 ? option : replacementStart,
          );
        });
      if (options.length === 0) { setError('Choose another ordered position without crossing an unknown gap.'); return; }
      if (options.length > 1) setPendingAnchor({ role: 'end', options, target });
      else chooseReplacementEnd(options[0]);
      return;
    }
    const start = current.present.parts.at(-1)?.points.at(-1) ?? current.present.startPoint;
    if (!start) return;
    void runPointRequest(start, target, { kind: 'append' });
  }, [chooseAnchor, chooseReplacementEnd, commitResult, pendingMultiStroke, pointIntent, providerBusy, replacementStart, runPointRequest, selectedGap]);

  const handleUndo = useCallback(() => {
    if (pendingMultiStroke) {
      invalidatePendingOperation();
      setTool('browse');
      setError('In-progress section cancelled. Your Route is unchanged.');
      return;
    }
    invalidatePendingOperation();
    const current = historyRef.current;
    if (!current) return;
    const next = undoRouteHistory(current);
    historyRef.current = next;
    setHistory(next);
    setError(null);
  }, [invalidatePendingOperation, pendingMultiStroke]);

  const applyTrim = useCallback(() => {
    const current = historyRef.current;
    if (!current || current.present.parts.length === 0) return;
    if (pendingMultiStroke) {
      setError('Finish or cancel the in-progress Route section before trimming.');
      return;
    }
    const start = orderedPositionAtDistanceFraction(current.present, trimStart);
    const end = orderedPositionAtDistanceFraction(current.present, trimEnd);
    if (!start || !end) return;
    if (commitResult(trimOrderedDraft(current.present, start, end), 'trim')) {
      setTrimOpen(false);
      setTrimStart(0);
      setTrimEnd(1);
    }
  }, [commitResult, pendingMultiStroke, trimEnd, trimStart]);

  const saveRoute = useCallback(async () => {
    const current = historyRef.current;
    if (!current || saving || readOnlyShared) return;
    if (pendingMultiStroke) { setError('Finish or cancel the in-progress Route section before saving.'); return; }
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
      : pointIntent === 'replace-start'
        ? 'Set replacement start'
        : pointIntent === 'replace-end'
          ? 'Set replacement end'
          : 'Add destination';
  const mapParts = routeParts.filter(part => part.id !== routeGrowthAnimation?.hiddenPartId).map(part => ({
    type: 'Feature' as const,
    id: part.id,
    properties: { resolution: part.resolution },
    geometry: { type: 'LineString' as const, coordinates: part.points.map(point => [point.lng, point.lat]) },
  }));
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
  const gapFeatures = draft.gaps.flatMap(gap => {
    const left = draft.parts.findIndex(part => part.id === gap.afterPartId);
    const a = draft.parts[left]?.points.at(-1);
    const b = draft.parts[left + 1]?.points[0];
    return a && b ? [{
      type: 'Feature' as const,
      id: gap.id,
      properties: {},
      geometry: { type: 'LineString' as const, coordinates: [[a.lng, a.lat], [b.lng, b.lat]] },
    }] : [];
  });
  const routeEndpoints = (() => {
    const start = draft.parts[0]?.points[0] ?? draft.startPoint;
    const end = draft.parts.at(-1)?.points.at(-1);
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
  const reviewPoints = pendingIntervalReview?.points ?? pendingReview?.points ?? pendingPointReview?.points ?? pendingDrawChoice?.points ?? [];
  const reviewIntervals = (() => {
    if (pendingIntervalReview) {
      return [orderedIntervalPoints(draft, pendingIntervalReview.option.start, pendingIntervalReview.option.end)];
    }
    if (pendingPointReview?.intent.kind === 'replace') {
      return [orderedIntervalPoints(draft, pendingPointReview.intent.start, pendingPointReview.intent.end)];
    }
    if (pendingReview?.intent.kind === 'replace') {
      return pendingReview.intent.options.map(option => orderedIntervalPoints(draft, option.start, option.end));
    }
    if (pendingDrawChoice) {
      return pendingDrawChoice.options.map(option => orderedIntervalPoints(draft, option.start, option.end));
    }
    return [];
  })();
  const originalIntervalFeatures = reviewIntervals.flatMap((points, index) => points.length >= 2 ? [{
    type: 'Feature' as const,
    id: `review-interval-${index}`,
    properties: {},
    geometry: { type: 'LineString' as const, coordinates: points.map(point => [point.lng, point.lat]) },
  }] : []);
  const pendingFeature = pendingMultiStroke && pendingMultiStroke.points.length >= 2 ? {
    type: 'Feature' as const,
    properties: {},
    geometry: { type: 'LineString' as const, coordinates: pendingMultiStroke.points.map(point => [point.lng, point.lat]) },
  } : null;
  const pendingEndpointFeature = pendingMultiStroke?.points.at(-1) ? {
    type: 'Feature' as const,
    properties: {},
    geometry: {
      type: 'Point' as const,
      coordinates: [pendingMultiStroke.points.at(-1)!.lng, pendingMultiStroke.points.at(-1)!.lat],
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
          ) : <Camera ref={cameraRef} centerCoordinate={fallbackCenter} zoomLevel={region.defaultZoom} animationDuration={0} /> : null}
          <FogLayer scopeOverride={planningMemoryScope} opacityScale={0.42} />
          {ShapeSource && LineLayer && mapParts.length ? (
            <ShapeSource id="ordered-route-parts" shape={{ type: 'FeatureCollection', features: mapParts }}>
              <LineLayer id="ordered-route-parts-line" style={{
                lineColor: ['match', ['get', 'resolution'], 'draw-manual', theme.accent, theme.primary] as any,
                lineWidth: 6,
                lineCap: 'round',
                lineJoin: 'round',
                lineDasharray: ['match', ['get', 'resolution'], 'draw-manual', ['literal', [2, 1.4]], ['literal', [1, 0]]] as any,
              }} />
            </ShapeSource>
          ) : null}
          {ShapeSource && LineLayer && animationFeature ? (
            <ShapeSource id="ordered-route-growth" shape={animationFeature}>
              <LineLayer id="ordered-route-growth-line" style={{ lineColor: theme.primary, lineWidth: 6, lineCap: 'round', lineJoin: 'round' }} />
            </ShapeSource>
          ) : null}
          {ShapeSource && LineLayer && gapFeatures.length ? (
            <ShapeSource id="ordered-route-gaps" shape={{ type: 'FeatureCollection', features: gapFeatures }}>
              <LineLayer id="ordered-route-gap-line" style={{ lineColor: theme.destructive, lineWidth: 3, lineDasharray: [2, 2], lineOpacity: 0.85 }} />
            </ShapeSource>
          ) : null}
          {ShapeSource && LineLayer && pendingFeature ? (
            <ShapeSource id="ordered-route-pending" shape={pendingFeature}>
              <LineLayer id="ordered-route-pending-line" style={{ lineColor: theme.accent, lineWidth: 5, lineDasharray: [1.5, 1.2], lineOpacity: 0.9, lineCap: 'round', lineJoin: 'round' }} />
            </ShapeSource>
          ) : null}
          {ShapeSource && CircleLayer && pendingEndpointFeature ? (
            <ShapeSource id="ordered-route-pending-endpoint" shape={pendingEndpointFeature}>
              <CircleLayer id="ordered-route-pending-endpoint-circle" style={{ circleRadius: 8, circleColor: theme.surfaceElevated, circleStrokeColor: theme.accent, circleStrokeWidth: 3 }} />
            </ShapeSource>
          ) : null}
          {ShapeSource && LineLayer && originalIntervalFeatures.length ? (
            <ShapeSource id="ordered-route-review-original" shape={{ type: 'FeatureCollection', features: originalIntervalFeatures }}>
              <LineLayer id="ordered-route-review-original-line" style={{ lineColor: theme.foregroundSecondary, lineWidth: 8, lineOpacity: 0.48, lineDasharray: [2, 1.5] }} />
            </ShapeSource>
          ) : null}
          {ShapeSource && LineLayer && previewFeature ? (
            <ShapeSource id="ordered-route-review-candidate" shape={previewFeature}>
              <LineLayer id="ordered-route-review-candidate-line" style={{ lineColor: theme.accent, lineWidth: 7, lineOpacity: 0.95, lineCap: 'round', lineJoin: 'round' }} />
            </ShapeSource>
          ) : null}
          {ShapeSource && CircleLayer && routeEndpoints.length ? (
            <ShapeSource id="ordered-route-endpoints" shape={{ type: 'FeatureCollection', features: routeEndpoints }}>
              <CircleLayer id="ordered-route-endpoint-circles" style={{ circleRadius: 7, circleColor: theme.surfaceElevated, circleStrokeColor: theme.primary, circleStrokeWidth: 3 }} />
              {SymbolLayer ? <SymbolLayer id="ordered-route-endpoint-labels" style={{ textField: ['get', 'role'], textSize: 11, textOffset: [0, 1.55], textColor: theme.foreground, textHaloColor: theme.surfaceElevated, textHaloWidth: 1.5, textAllowOverlap: true }} /> : null}
            </ShapeSource>
          ) : null}
          {ShapeSource && CircleLayer && draft.startPoint && draft.parts.length === 0 ? (
            <ShapeSource id="ordered-route-start" shape={{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [draft.startPoint.lng, draft.startPoint.lat] } }}>
              <CircleLayer id="ordered-route-start-ring" style={{ circleRadius: 8, circleColor: theme.surfaceElevated, circleStrokeColor: theme.primary, circleStrokeWidth: 3 }} />
            </ShapeSource>
          ) : null}
        </MapView>
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
      </View>

      <View style={[styles.topBar, { paddingTop: insets.top + Spacing.sm }]} pointerEvents="box-none">
        <BackButton variant="inline" onPress={() => nav.goBack()} />
        <View style={styles.topTitleWrap}>
          <Text style={[styles.topTitle, { color: theme.foreground }]}>{readOnlyShared ? 'Shared Route' : routeId ? 'Edit Route' : 'Create Route'}</Text>
          <Text style={[styles.topSubtitle, { color: theme.foregroundSecondary }]}>Plan only · not walking evidence</Text>
        </View>
        {!readOnlyShared ? (
          <TouchableOpacity
            style={[styles.topUtility, { backgroundColor: theme.secondaryAction, borderColor: theme.borderSubtle }]}
            onPress={handleUndo}
            disabled={!history || (history.past.length === 0 && !pendingMultiStroke)}
            accessibilityRole="button"
            accessibilityLabel="Undo last Route edit"
          >
            <Icon name="Undo2" size={17} color={theme.iconActive} strokeWidth={2.2} />
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
        onCancel={reason => {
          setTool('browse');
          setError(reason === 'gesture-interrupted'
            ? 'Drawing cancelled so the map gesture could continue. Your Route is unchanged.'
            : 'The map could not read that stroke. Your Route is unchanged.');
        }}
        bottomInset={300 + insets.bottom}
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
              <Text style={[styles.gapTitle, { color: theme.foreground }]}>Route section in progress</Text>
              <Text style={[styles.helper, { color: theme.foregroundSecondary }]}>Browse the map, then continue Draw from the open end. Nothing is added until the other boundary is reached.</Text>
              <View style={styles.row}>
                <PrimaryButton label="Continue Draw" variant="secondary" onPress={() => setTool('draw')} style={styles.flexButton} />
                <PrimaryButton label="Cancel section" variant="secondary" onPress={() => { setPendingMultiStroke(null); setError('In-progress section cancelled. Your Route is unchanged.'); }} style={styles.flexButton} />
              </View>
            </View>
          ) : null}
          {draft.gaps.length > 0 ? (
            <View style={[styles.gapNotice, { backgroundColor: theme.destructiveSurface, borderColor: theme.borderSubtle }]}>
              <View style={styles.gapHeading}><Icon name="TriangleAlert" size={16} color={theme.destructive} /><Text style={[styles.gapTitle, { color: theme.foreground }]}>{draft.gaps.length} unknown {draft.gaps.length === 1 ? 'gap' : 'gaps'}</Text></View>
              <Text style={[styles.helper, { color: theme.foregroundSecondary }]}>Dashed connectors are not counted or claimed as walked. Repair adjacent sections before Use or Share.</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
                {draft.gaps.map((gap, index) => (
                  <TouchableOpacity key={gap.id} disabled={Boolean(pendingMultiStroke)} style={[styles.chip, { borderColor: selectedGapId === gap.id ? theme.primary : theme.borderSubtle }, selectedGapId === gap.id && { backgroundColor: theme.controlSelected }, pendingMultiStroke && styles.disabled]} onPress={() => setSelectedGapId(selectedGapId === gap.id ? undefined : gap.id)}>
                    <Text style={[styles.chipText, { color: theme.foreground }]}>Gap {index + 1}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
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
                  {draft.parts.length} {draft.parts.length === 1 ? 'section' : 'sections'} · {dist.format(orderedDraftDistanceM(draft), 1)} {dist.unit}{reduceMotion ? ' · Reduce Motion' : ''}
                </Text>
              </View>
              <View style={styles.toolRow}>
                <TouchableOpacity style={[styles.toolButton, { borderColor: tool === 'draw' ? theme.primary : theme.borderSubtle, backgroundColor: tool === 'draw' ? theme.controlSelected : theme.surface }]} onPress={() => { setTool('draw'); setError(pendingMultiStroke ? 'Continue from the open end of the in-progress section.' : selectedGap ? 'Draw from one highlighted gap endpoint to the other.' : 'Draw one connected stroke, then browse the map to continue.'); }} accessibilityRole="button" accessibilityState={{ selected: tool === 'draw' }}>
                  <Icon name="Pencil" size={20} color={theme.iconActive} /><Text style={[styles.toolLabel, { color: theme.foreground }]}>Draw</Text>
                </TouchableOpacity>
                <TouchableOpacity disabled={Boolean(pendingMultiStroke)} style={[styles.toolButton, { borderColor: tool === 'point' ? theme.primary : theme.borderSubtle, backgroundColor: tool === 'point' ? theme.controlSelected : theme.surface }, pendingMultiStroke && styles.disabled]} onPress={() => setTool('point')} accessibilityRole="button" accessibilityState={{ selected: tool === 'point', disabled: Boolean(pendingMultiStroke) }}>
                  <Icon name="MapPin" size={20} color={theme.iconActive} /><Text style={[styles.toolLabel, { color: theme.foreground }]}>Point</Text>
                </TouchableOpacity>
                <TouchableOpacity disabled={Boolean(pendingMultiStroke)} style={[styles.toolButton, { borderColor: theme.borderSubtle, backgroundColor: theme.surface }, pendingMultiStroke && styles.disabled]} onPress={() => setMoreOpen(true)} accessibilityRole="button" accessibilityLabel="More Route actions" accessibilityState={{ disabled: Boolean(pendingMultiStroke) }}>
                  <Icon name="Settings2" size={20} color={theme.iconActive} /><Text style={[styles.toolLabel, { color: theme.foreground }]}>More</Text>
                </TouchableOpacity>
              </View>
              {tool === 'point' ? (
                <View style={styles.pointActions}>
                  <PrimaryButton label={pointActionLabel} onPress={confirmPointTarget} loading={providerBusy} />
                  {!selectedGap && draft.parts.length > 0 ? (
                    <TouchableOpacity onPress={() => { setPointIntent(pointIntent === 'append' ? 'replace-start' : 'append'); setReplacementStart(null); }} accessibilityRole="button">
                      <Text style={[styles.linkText, { color: theme.primary }]}>{pointIntent === 'append' ? 'Replace a section' : 'Return to append'}</Text>
                    </TouchableOpacity>
                  ) : null}
                </View>
              ) : null}
              <PrimaryButton
                label={draft.gaps.length ? 'Save repairable draft' : 'Save Route'}
                onPress={() => { void saveRoute(); }}
                loading={saving}
                disabled={draft.parts.length === 0 || !name.trim() || Boolean(pendingMultiStroke)}
                testID="ordered-route-save"
              />
            </>
          )}
        </View>
      </KeyboardAvoidingView>

      <ModalCard visible={searchOpen} onDismiss={() => setSearchOpen(false)} testID="route-place-search-modal">
        <ModalCardHeader title="Find a place" body="Search moves only the planning camera. It never adds or relocates Route points." />
        <TextInput
          value={searchQuery}
          onChangeText={setSearchQuery}
          onSubmitEditing={() => { void runPlaceSearch(); }}
          returnKeyType="search"
          autoCapitalize="words"
          placeholder="City, park, trail or address"
          placeholderTextColor={theme.muted}
          accessibilityLabel="Place or city search"
          style={[styles.searchInput, { color: theme.foreground, backgroundColor: theme.surface, borderColor: theme.border }]}
        />
        <PrimaryButton label="Search" onPress={() => { void runPlaceSearch(); }} loading={searchBusy} disabled={searchQuery.trim().length < 2} style={styles.modalButton} />
        <ScrollView style={styles.modalScroll} keyboardShouldPersistTaps="handled">
          {searchResults.map(result => (
            <PrimaryButton
              key={result.id}
              label={result.label}
              variant="secondary"
              onPress={() => {
                moveCamera(result.center);
                setSearchOpen(false);
                setSearchResults([]);
              }}
              style={styles.modalButton}
            />
          ))}
        </ScrollView>
      </ModalCard>

      <ModalCard visible={Boolean(pendingDrawChoice)} onDismiss={() => setPendingDrawChoice(null)} testID="route-interval-choice">
        <ModalCardHeader title="Choose which section to replace" body="Repeated or crossing coordinates can refer to different moments in the ordered Route." />
        <ScrollView style={styles.modalScroll}>
          {pendingDrawChoice?.options.map(option => (
            <PrimaryButton
              key={option.id}
              label={`${positionLabel(draft, option.start)} → ${positionLabel(draft, option.end)}`}
              variant="secondary"
              onPress={() => {
                const pending = pendingDrawChoice;
                setPendingDrawChoice(null);
                if (!pending) return;
                const current = historyRef.current;
                if (!current) return;
                setPendingIntervalReview({
                  points: pending.points,
                  resolution: pending.resolution,
                  option,
                  allOptions: pending.options,
                  baseRevision: current.present.revision,
                });
              }}
              style={styles.modalButton}
            />
          ))}
        </ScrollView>
      </ModalCard>

      <ModalCard visible={Boolean(pendingAnchor)} onDismiss={() => setPendingAnchor(null)}>
        <ModalCardHeader title="Choose the ordered position" body="This location occurs more than once. Cairn will not guess which visit you meant." />
        {pendingAnchor?.options.map(option => (
          <PrimaryButton key={`${option.partId}:${option.pointIndex}:${option.fraction ?? 0}`} label={positionLabel(draft, option)} variant="secondary" onPress={() => chooseAnchor(option)} style={styles.modalButton} />
        ))}
      </ModalCard>

      <ModalCard visible={Boolean(pendingReview)} onDismiss={() => setPendingReview(null)}>
        <ModalCardHeader title="Review this Route edit" body={pendingReview ? providerReason(pendingReview.reason) : ''} />
        <PrimaryButton label="Apply reviewed edit" onPress={() => {
          const pending = pendingReview;
          setPendingReview(null);
          if (!pending) return;
          if (historyRef.current?.present.revision !== pending.baseRevision) {
            setError('This Route changed while the edit was being reviewed. The older result was not applied.');
            return;
          }
          applyResolvedDraw(pending.points, pending.resolution, pending.intent);
        }} />
        <PrimaryButton label="Keep Route unchanged" variant="secondary" onPress={() => setPendingReview(null)} style={styles.modalButton} />
      </ModalCard>

      <ModalCard visible={Boolean(pendingPointReview)} onDismiss={() => setPendingPointReview(null)}>
        <ModalCardHeader title="Review this walking Route" body={pendingPointReview ? (pendingPointReview.reason ? providerReason(pendingPointReview.reason) : 'Review the highlighted walking path before adding it to your Route.') : ''} />
        <PrimaryButton label="Apply reviewed path" onPress={() => {
          const pending = pendingPointReview;
          setPendingPointReview(null);
          if (pending) applyResolvedPoint(pending.points, pending.intent, pending.baseRevision);
        }} />
        <PrimaryButton label="Keep Route unchanged" variant="secondary" onPress={() => setPendingPointReview(null)} style={styles.modalButton} />
      </ModalCard>

      <ModalCard visible={Boolean(pendingIntervalReview)} onDismiss={() => setPendingIntervalReview(null)}>
        <ModalCardHeader title="Review chosen replacement" body="The highlighted original interval stays unchanged until you apply this replacement." />
        <PrimaryButton label="Apply replacement" onPress={() => {
          const pending = pendingIntervalReview;
          setPendingIntervalReview(null);
          const current = historyRef.current;
          if (!pending || !current) return;
          if (current.present.revision !== pending.baseRevision) {
            setError('This Route changed while the edit was being reviewed. The older result was not applied.');
            return;
          }
          if (commitResult(applyDrawTransaction(current.present, { kind: 'replace', option: pending.option }, pending.points, pending.resolution), 'replace-draw')) {
            setPendingMultiStroke(null);
          }
        }} />
        <PrimaryButton label="Choose another interval" variant="secondary" onPress={() => {
          const pending = pendingIntervalReview;
          setPendingIntervalReview(null);
          if (pending) setPendingDrawChoice({
            points: pending.points,
            resolution: pending.resolution,
            options: pending.allOptions,
          });
        }} style={styles.modalButton} />
      </ModalCard>

      <ModalCard visible={Boolean(manualRecovery)} onDismiss={() => setManualRecovery(null)}>
        <ModalCardHeader title="Mapped path unavailable" body={manualRecovery ? `${providerReason(manualRecovery.reason)} You can explicitly keep the coherent stroke as a manual plan.` : ''} />
        <PrimaryButton label="Keep as drawn — not matched" onPress={() => {
          const pending = manualRecovery;
          setManualRecovery(null);
          if (!pending) return;
          if (historyRef.current?.present.revision !== pending.baseRevision) {
            setError('This Route changed while the edit was being reviewed. The older result was not applied.');
            return;
          }
          applyResolvedDraw(pending.points, 'draw-manual', pending.intent);
        }} />
        <PrimaryButton label="Redraw this section" variant="secondary" onPress={() => { setManualRecovery(null); setTool('draw'); }} style={styles.modalButton} />
      </ModalCard>

      <ModalCard visible={moreOpen} onDismiss={() => setMoreOpen(false)}>
        <ModalCardHeader title="Route actions" body="These actions affect only this planned Route, never its source Activity or Memory." />
        <PrimaryButton
          label={planningMemoryScope === 'self' ? 'Planning context: Mine' : 'Planning context: Mine + Friends'}
          variant="secondary"
          onPress={() => {
            const next = planningMemoryScope === 'self' ? 'combined' : 'self';
            setPlanningMemoryScope(next);
            if (next === 'combined') void useFriendMemoryStore.getState().loadSelectedProjections();
          }}
          style={styles.modalButton}
        />
        <PrimaryButton label="Trim beginning or end" variant="secondary" onPress={() => { setMoreOpen(false); setTrimOpen(true); }} style={styles.modalButton} />
        {draft.parts.length > 1 ? <PrimaryButton label="Keep one recorded section" variant="secondary" onPress={() => { setMoreOpen(false); setKeepPartOpen(true); }} style={styles.modalButton} /> : null}
        <PrimaryButton label="Reset draft" variant="destructive" onPress={() => {
          invalidatePendingOperation();
          const initial = initialDraftRef.current;
          if (initial) {
            const next = { present: cloneOrderedDraft(initial), past: [] };
            historyRef.current = next;
            setHistory(next);
          }
          setMoreOpen(false);
        }} style={styles.modalButton} />
      </ModalCard>

      <ModalCard visible={trimOpen} onDismiss={() => setTrimOpen(false)}>
        <ModalCardHeader title="Trim Route ends" body="Trim preserves the remaining order and any internal unknown gaps." />
        <TrimSlider trimStartFrac={trimStart} trimEndFrac={trimEnd} onTrimStartChange={setTrimStart} onTrimEndChange={setTrimEnd} onTrimDragBegin={() => undefined} totalLengthM={orderedDraftDistanceM(draft)} />
        <PrimaryButton label="Apply Trim" onPress={applyTrim} style={styles.modalButton} />
      </ModalCard>

      <ModalCard visible={keepPartOpen} onDismiss={() => setKeepPartOpen(false)}>
        <ModalCardHeader title="Keep one section" body="Other imported sections are removed only from this Route draft. The Activity stays unchanged." />
        {draft.parts.filter(part => part.resolution === 'recorded').map((part, index) => (
          <PrimaryButton key={part.id} label={`Keep section ${index + 1}`} variant="secondary" onPress={() => { const current = historyRef.current; if (current) commitResult(keepOnlyOrderedPart(current.present, part.id), 'keep-section'); setKeepPartOpen(false); }} style={styles.modalButton} />
        ))}
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
  // This target deliberately matches Mapbox's camera center. The bottom card
  // does not change the camera coordinate; camera padding is only used for the
  // one-time initial fit, so the visual target and confirmed coordinate agree.
  centerTarget: { position: 'absolute', left: '50%', top: '50%', width: 34, height: 34, marginLeft: -17, marginTop: -17, alignItems: 'center', justifyContent: 'center', zIndex: 8 },
  targetRing: { width: 30, height: 30, borderRadius: 15, borderWidth: 2, backgroundColor: 'rgba(255,255,255,0.35)' },
  targetDot: { position: 'absolute', width: 6, height: 6, borderRadius: 3 },
  bottomWrap: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  bottomCard: { borderTopLeftRadius: 24, borderTopRightRadius: 24, borderWidth: 1, paddingHorizontal: Spacing.base, paddingTop: Spacing.md, gap: Spacing.sm, elevation: 10 },
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
  toolButton: { flex: 1, minHeight: 56, borderWidth: 1, borderRadius: RadiusRole.button, alignItems: 'center', justifyContent: 'center', gap: 3 },
  toolLabel: { fontSize: FontSize.small, fontWeight: '700' },
  disabled: { opacity: 0.42 },
  pointActions: { gap: Spacing.sm, alignItems: 'center' },
  linkText: { fontSize: FontSize.small, fontWeight: '700', padding: Spacing.xs },
  row: { flexDirection: 'row', gap: Spacing.sm },
  flexButton: { flex: 1 },
  modalButton: { marginTop: Spacing.sm },
  modalScroll: { maxHeight: 320 },
  searchInput: { minHeight: 48, borderWidth: 1, borderRadius: RadiusRole.input, paddingHorizontal: Spacing.md, fontSize: FontSize.body },
});
