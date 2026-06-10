/**
 * RouteEditorScreen — Create/edit routes by placing waypoints on a map.
 *
 * Features:
 * - Full-screen Mapbox map (native) or fallback (web)
 * - Tap map to add waypoint
 * - Search destination (Mapbox Geocoding API)
 * - Name input + Save button
 * - Clear / Undo actions
 * - Calculates total distance from waypoints
 */
import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput, Alert, Platform, FlatList, KeyboardAvoidingView, ActivityIndicator, BackHandler,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Location from 'expo-location';
import * as Haptics from 'expo-haptics';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useRouteStore } from '../store/useRouteStore';
import { useRouteEditStore } from '../store/useRouteEditStore';
import { useSessionStore, loadTrackPoints } from '../store/useSessionStore';
import { useTrackingStore } from '../store/useTrackingStore';
import { snapToRoadAndTrim } from '../services/routeMatcher';
import { haversineM, formatDistance } from '../utils/geo';
import { getCurrentRegion } from '../config/regions';
import { Colors, Spacing, Radius, FontSize, Shadow, IconSize } from '../components/tokens';
import { Icon } from '../components/Icon';
import { BackButton } from '../components/BackButton';
import { DualLineLayer } from '../components/map/DualLineLayer';
import { DraggableHandle } from '../components/map/DraggableHandle';
import { EditableNodeLayer } from '../components/map/EditableNodeLayer';
import { EditCoachmark, ApproximateWarningBar } from '../components/map/EditCoachmark';
import { getFlagsSync } from '../config/featureFlags';
import { buildEditContext } from '../services/routing/editContext';
import { computeRouteNodeAnchors, type RouteNodeAnchor } from '../services/routing/routeNodeAnchors';
import { computeCandidates, findNearestCandidate } from '../services/routing/candidateNodes';
import type { LngLat as RoutingLngLat } from '../services/routing/corridor/PolylineSampler';

const MAPBOX_TOKEN = process.env.EXPO_PUBLIC_MAPBOX_TOKEN || '';

// Conditional Mapbox import — same pattern as RoutesScreen so the editor
// works on Expo Go (no native @rnmapbox) and degrades to the existing
// fallback panel.
let MapView: any = null;
let CameraComponent: any = null;
let LineLayer: any = null;
let ShapeSource: any = null;
let PointAnnotation: any = null;
if (Platform.OS !== 'web') {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Mapbox = require('@rnmapbox/maps');
    MapView = Mapbox.MapView;
    CameraComponent = Mapbox.Camera;
    LineLayer = Mapbox.LineLayer;
    ShapeSource = Mapbox.ShapeSource;
    PointAnnotation = Mapbox.PointAnnotation;
  } catch {
    // @rnmapbox/maps not in this build — fallback panel will render.
  }
}

interface WaypointDraft {
  id: string;
  lat: number;
  lng: number;
  label: string;
}

export function RouteEditorScreen() {
  const nav = useNavigation();
  const insets = useSafeAreaInsets();
  // Subscribe to lastCoordinate (don't just read it once via .getState())
  // so the camera + search both re-evaluate when the GPS prime resolves
  // a few seconds after mount.
  const userCoord = useTrackingStore(s => s.lastCoordinate);
  const route = useRoute<any>();
  const routeId = route.params?.routeId as string | undefined;
  const fromSessionId = route.params?.fromSessionId as string | undefined;
  // v198 fix-2: caller (MapHistoryScreen) passes server-hydrated track
  // points to avoid the unreliable local-AsyncStorage loadTrackPoints
  // path. When set, this overrides the legacy session-load useEffect.
  const fromSessionTrackPoints = route.params?.fromSessionTrackPoints as
    | Array<{ lat: number; lng: number; alt?: number | null; t?: number }>
    | undefined;
  const addRoute = useRouteStore(s => s.addRoute);
  const updateRoute = useRouteStore(s => s.updateRoute);
  const deleteRoute = useRouteStore(s => s.deleteRoute);
  const loadRouteDetail = useRouteStore(s => s.loadRouteDetail);
  const existingRoute = useRouteStore(s => s.routes.find(r => r.id === routeId));
  const session = useSessionStore(s => fromSessionId ? s.sessions.find(x => x.id === fromSessionId) : null);
  const [name, setName] = useState('');
  const [waypoints, setWaypoints] = useState<WaypointDraft[]>([]);
  // Sprint 66 Card 1 fix: store the session's loaded trackPoints (after
  // snap-to-road) so we can render the actual polyline curve, not a sampled
  // approximation. For new-route-from-session flow only; existingRoute uses
  // existingRoute.points directly.
  const [sessionTrackPoints, setSessionTrackPoints] = useState<Array<{ lat: number; lng: number }>>([]);
  // v200: ALL entries land in view-mode now — user must tap Edit to
  // enter the editing surface. Save-as-route used to skip view-mode
  // (jumped straight to edit) but the v200 spec unifies the two
  // entries: save-as-route view-mode shows Edit + Cancel, existing-
  // route view-mode shows Edit + Delete. Tapping Edit in either case
  // promotes Edit → Save while leaving the other button in place.
  const [editMode, setEditMode] = useState<boolean>(false);
  // True when snapToRoadAndTrim couldn't align the trace to road data
  // — typical indoors / sparse-OSM areas. We honestly tell the user
  // we're showing raw GPS, which prevents the "why are 7 waypoints
  // stacked on top of each other?" confusion seen in v16.
  const [snapWarning, setSnapWarning] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Array<{ name: string; subtitle?: string | null; lat: number; lng: number }>>([]);
  const [showSearch, setShowSearch] = useState(false);
  // Tracks the in-flight geocoding request so debounced typing can
  // cancel a stale request before its results overwrite a newer one
  // (race condition: "shang" results landing after "shanghai" results).
  const searchAbortRef = useRef<AbortController | null>(null);

  // ── Sprint 66 dual-source edit mode wiring ─────────────────────────────
  // When the editModeEnabled feature flag is on AND we're editing an
  // existing route AND the user taps "Edit on map", we enter the
  // dual-source edit surface: DualLineLayer renders original (faded) +
  // working (colored), DraggableHandles allow trim + midpoint drag, and
  // useRouteEditStore manages the session.
  const editStore = useRouteEditStore();
  const [dualEditLoading, setDualEditLoading] = useState(false);
  const [dualEditError, setDualEditError] = useState<string | null>(null);
  // v200 fix B1: when save-as-route → Edit creates a backend route to
  // get a routeId, we record the new id here. If the user then cancels
  // (without ever saving real edits), we delete the freshly-created
  // backend route so it doesn't persist as an unintended save.
  const [freshlyCreatedRouteId, setFreshlyCreatedRouteId] = useState<string | null>(null);
  const dualEditActive = editStore.isOpen && editStore.routeId === routeId;
  // Track which midpoint anchor index is being shown (defaults to middle).
  const [midpointAnchorIdx, setMidpointAnchorIdx] = useState<number>(0);
  // Recompute anchor idx whenever workingPoints length changes.
  useEffect(() => {
    if (!dualEditActive) return;
    const n = editStore.workingPoints.length;
    if (n < 3) {
      setMidpointAnchorIdx(0);
      return;
    }
    setMidpointAnchorIdx(Math.floor(n / 2));
  }, [dualEditActive, editStore.workingPoints.length]);

  // v31-architectural-fix (Critical C3) + v33-fix (Critical C-NEW-1):
  // on unmount during dualEdit, call detachUI (NOT cancelEdit). detachUI
  // flips isOpen=false so EditResumePrompt can offer Resume/Discard on
  // next AppState 'active', WITHOUT clearing the session record. The
  // user's edits stay safe in AsyncStorage; only the in-memory UI hook
  // is released.
  //
  // v22-25's design preserved sessions across unmount but relied on
  // app-kill to clear in-memory state. v32 review C-NEW-1 found that
  // soft-unmounts (tab switch, navigation.replace, deep link, OOM
  // without kill) leave isOpen=true forever, suppressing
  // EditResumePrompt's `if (isOpen) return` guard. detachUI fixes that
  // gap — explicit user discard still goes through Cancel/back +
  // Discard alert + cancelEdit.
  const dualEditActiveRef = useRef(dualEditActive);
  // v200 fix: imperative cameraRef + effect to forcibly fitBounds when
  // routeCameraFit changes after mount. The prop-driven Camera (bounds
  // prop) is mostly fine on first mount, but when sessionTrackPoints
  // arrives async after Camera has already mounted with a fallback
  // center, Mapbox iOS sometimes does not respect the prop update.
  // Calling cameraRef.current.fitBounds imperatively guarantees the
  // view moves.
  const cameraRef = useRef<any>(null);
  // Mapbox-Migration: MapView ref is needed by buildEditContext so the
  // junction extractor can call querySourceFeatures on the loaded vector
  // tiles. Sibling to cameraRef — the Camera and MapView refs serve
  // distinct APIs.
  const mapViewRef = useRef<any>(null);
  // v208 fix C1: replace fixed 600ms setTimeout with an event-driven
  // wait on Mapbox's onDidFinishRenderingMapFully (with onMapIdle as a
  // fallback signal — both indicate "rendering settled"). The flag is
  // reset on enter/exit of edit mode so each edit session waits for a
  // fresh tile-load cycle. Kept as a ref (not state) to avoid extra
  // re-renders during map interaction.
  const mapTilesReadyRef = useRef<boolean>(false);
  // Helper: wait until the map signals it has finished rendering, with
  // a hard timeout (default 3s — covers CN weak-network tile loads,
  // ~5x the original 600ms budget). If the timeout fires before the
  // event, extractJunctions runs anyway — the worst case is the same
  // failure mode the previous fixed-wait code already had.
  const waitForTilesOrTimeout = useCallback(
    async (timeoutMs: number = 3000, pollMs: number = 100) => {
      const start = Date.now();
      while (
        !mapTilesReadyRef.current &&
        Date.now() - start < timeoutMs
      ) {
        // eslint-disable-next-line no-await-in-loop
        await new Promise(r => setTimeout(r, pollMs));
      }
    },
    [],
  );
  useEffect(() => {
    dualEditActiveRef.current = dualEditActive;
  }, [dualEditActive]);
  useEffect(() => {
    return () => {
      if (dualEditActiveRef.current) {
        try {
          useRouteEditStore.getState().detachUI();
        } catch {
          // best-effort
        }
      }
    };
  }, []);

  // v30-fix (functional Blocker — Scenario 27): hardware back on Android
  // bypasses the in-app Cancel/Discard confirmation. Register a
  // BackHandler while dualEditActive that fires the same Discard alert
  // as the top-bar Cancel button. Returning true prevents the default
  // back navigation; the user must explicitly discard.
  // v31-fix (Medium Scenario 8): guard with discardAlertActiveRef so
  // a second back press while the alert is open doesn't stack a
  // duplicate Alert.
  const discardAlertActiveRef = useRef(false);
  // v204+ fix C3: timestamp of the last anchor onSelected callback.
  // MapView onPress (background tap = deselect) consults this and
  // skips deselect if onSelected fired within the last 200ms — closes
  // the Android dispatch-order race where onPress can land after
  // onSelected, instantly clearing the selection.
  const anchorSelectAtRef = useRef<number>(0);
  useEffect(() => {
    if (!dualEditActive) return;
    if (Platform.OS !== 'android') return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (discardAlertActiveRef.current) {
        // Alert already showing — swallow the back press without
        // stacking a duplicate dialog.
        return true;
      }
      discardAlertActiveRef.current = true;
      Alert.alert(
        'Discard edits?',
        'Your changes will be lost.',
        [
          {
            text: 'Keep editing',
            style: 'cancel',
            onPress: () => {
              discardAlertActiveRef.current = false;
            },
          },
          {
            text: 'Discard',
            style: 'destructive',
            onPress: () => {
              discardAlertActiveRef.current = false;
              useRouteEditStore.getState().cancelEdit();
            },
          },
        ],
        {
          cancelable: false,
          onDismiss: () => {
            discardAlertActiveRef.current = false;
          },
        },
      );
      return true; // swallow the back press
    });
    return () => {
      sub.remove();
      // Reset on dual-edit exit so a future re-entry starts clean.
      discardAlertActiveRef.current = false;
    };
  }, [dualEditActive]);

  // v31-fix (Medium Scenario 17): memoize the dual-edit camera fit so
  // the camera doesn't re-animate on every workingPoints mutation
  // (midpoint commit, trim, reset). Once the user enters dual-edit
  // mode the camera fits to the route bbox ONCE; thereafter the user
  // pans freely. We re-fit only when the routeId changes (entering
  // a different route) or when dual-edit is re-entered.
  // v32-fix (architectural Critical C2): correct the bbox math to
  // account for cosine(lat) longitude scaling. Raw degree max(lng,lat)
  // span at 45°S (typical NZ) treats 0.01° lng (~0.79km) the same as
  // 0.01° lat (~1.11km), causing tall north-south routes to be
  // over-zoomed. Convert both spans to meters before picking zoom so
  // the heuristic reflects actual geographic extent.
  // v198-fix (bug 3+4): extract bbox->center+zoom into a helper so
  // view-mode and save-as-route can reuse the same math.
  // v200 fix: routeCameraFit now exposes the bbox bounds directly so
  // Camera can use the `bounds` prop instead of centerCoordinate+zoom.
  // bounds is what Mapbox uses for fitBounds internally and is more
  // reliable when sessionTrackPoints arrives async — the v199 approach
  // returned a null Camera while waiting then mounted with center+zoom,
  // but on iOS the "no Camera" gap let MapView fall back to the global
  // default view (showed Corsica for users in Asia) and the late-mounting
  // Camera with prop center+zoom did not always pull the view back.
  // Using bounds + a stable Camera mount avoids that race.
  const computeBboxFit = (pts: Array<{ lng: number; lat: number }>) => {
    if (pts.length < 2) return null;
    let minLng = Infinity, maxLng = -Infinity;
    let minLat = Infinity, maxLat = -Infinity;
    for (const p of pts) {
      if (p.lng < minLng) minLng = p.lng;
      if (p.lng > maxLng) maxLng = p.lng;
      if (p.lat < minLat) minLat = p.lat;
      if (p.lat > maxLat) maxLat = p.lat;
    }
    const center: [number, number] = [
      (minLng + maxLng) / 2,
      (minLat + maxLat) / 2,
    ];
    const midLat = (minLat + maxLat) / 2;
    const lngSpanM =
      Math.max(0.0001, maxLng - minLng) *
      111000 *
      Math.max(0.01, Math.cos((midLat * Math.PI) / 180));
    const latSpanM = Math.max(0.0001, maxLat - minLat) * 111000;
    const spanM = Math.max(lngSpanM, latSpanM) * 1.4;
    let zoom = 14;
    if (spanM > 50000) zoom = 9;
    else if (spanM > 10000) zoom = 11;
    else if (spanM > 5000) zoom = 12;
    else if (spanM > 1500) zoom = 13;
    else if (spanM > 700) zoom = 14;
    else if (spanM > 300) zoom = 15;
    else zoom = 16;
    // v200: also expose padded bounds so callers can use Camera's bounds
    // prop (more reliable on iOS for late-arriving data).
    const lngSpan = Math.max(maxLng - minLng, 0.0005);
    const latSpan = Math.max(maxLat - minLat, 0.0005);
    const lngPad = Math.max(lngSpan * 0.1, 0.0005);
    const latPad = Math.max(latSpan * 0.1, 0.0005);
    return {
      center,
      zoom,
      ne: [maxLng + lngPad, maxLat + latPad] as [number, number],
      sw: [minLng - lngPad, minLat - latPad] as [number, number],
    };
  };

  const dualEditCameraFit = useMemo(() => {
    if (!dualEditActive) return null;
    const fit = computeBboxFit(editStore.workingPoints);
    if (!fit) return null;
    // v208 fix B1: clamp zoom to >= 14 so the Mapbox vector-tile junction
    // extractor has the geometry detail it needs. This replaces the
    // imperative cameraRef.fitBounds + setCamera({zoom:14}) double-jump
    // that lived in enterDualEdit — now the natural Camera mount fits
    // the route AND guarantees zoom>=14 in a single animation.
    return { ...fit, zoom: Math.max(14, fit.zoom) };
    // Deps: only recompute when entering/leaving dual-edit OR routeId
    // changes. workingPoints is intentionally NOT a dep — see comment.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dualEditActive, routeId]);

  // v198-fix (bug 3+4): camera fit for view-mode (existing route) and
  // save-as-route (session draft). Memoize on routeId/sessionId so we
  // don't re-animate on every points hydrate. When points are not yet
  // loaded the fit is null and the camera falls back to user GPS.
  const routeCameraFit = useMemo(() => {
    // View mode: existing route with hydrated points
    if (routeId && existingRoute && existingRoute.points && existingRoute.points.length >= 2) {
      return computeBboxFit(existingRoute.points);
    }
    // Save-as-route: session trace after snap-to-road
    if (fromSessionId && sessionTrackPoints.length >= 2) {
      return computeBboxFit(sessionTrackPoints);
    }
    return null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeId, fromSessionId, existingRoute?.points?.length, sessionTrackPoints.length]);

  // v200 fix: force imperative fitBounds when routeCameraFit becomes
  // available or changes. The prop-driven bounds is normally sufficient
  // on first mount, but when sessionTrackPoints fills in async (after
  // snap-to-road completes), the bounds prop update was not always
  // respected by Mapbox iOS — leaving the camera stuck on the initial
  // wait-state center. Calling cameraRef.fitBounds explicitly guarantees
  // the view moves to the route. Safe under dual-edit (separate camera
  // path) and view-mode (existingRoute hydration).
  useEffect(() => {
    if (!routeCameraFit) return;
    if (!cameraRef.current) return;
    try {
      cameraRef.current.fitBounds(
        routeCameraFit.ne,
        routeCameraFit.sw,
        [60, 40, 60, 40], // [top, right, bottom, left]
        300,
      );
    } catch {
      // best-effort; ref may be stale during unmount
    }
  }, [routeCameraFit]);

  // React to pendingStraightConfirm via Alert. The orchestrator returns
  // a straight-line fallback when neither DOC nor Mapbox can route — the
  // user must explicitly accept (no creative routing without consent).
  useEffect(() => {
    if (!dualEditActive) return;
    if (!editStore.pendingStraightConfirm) return;
    const detail = editStore.pendingStraightConfirm.detail;
    Alert.alert(
      'No trail data here',
      detail || 'Save anyway?',
      [
        {
          text: 'Cancel',
          style: 'cancel',
          onPress: () => useRouteEditStore.getState().dismissStraightConfirm(),
        },
        {
          text: 'Save anyway',
          onPress: () => useRouteEditStore.getState().confirmStraight(),
        },
      ],
      { cancelable: false },
    );
  }, [dualEditActive, editStore.pendingStraightConfirm?.fromPointIdx]);

  const enterDualEdit = useCallback(async () => {
    // v200: support BOTH entries (existing route + save-as-route draft).
    // Existing route: routeId set, edit operates on it directly.
    // Save-as-route: no routeId yet but fromSessionId + sessionTrackPoints
    // populated. We persist the draft as a new route first (so editStore
    // has a routeId to anchor extras + persistence chain), then enter
    // edit-mode. v200 fix B1+B2: addRoute is awaited, freshlyCreatedRouteId
    // is recorded for cleanup-on-cancel, and execution continues
    // straight into the existing-route branch — single Edit tap, no
    // double-tap UX needed.
    if (!routeId && !fromSessionId) return;
    if (!getFlagsSync().editModeEnabled) {
      setDualEditError('Edit mode is currently disabled.');
      return;
    }
    if (dualEditLoading) return;

    // v208 fix C1: reset the tile-ready flag so waitForTilesOrTimeout
    // waits for the current camera fit's tile load — not a stale
    // signal from a previous edit session or the initial map mount.
    mapTilesReadyRef.current = false;
    // Save-as-route path: addRoute first to mint a routeId. Once
    // addRoute resolves, the local store has the route, but
    // existingRoute (derived from useRouteStore selector) won't reflect
    // it until the next React render. So we proceed using the new id
    // directly and patch params for downstream renders.
    let effectiveRouteId = routeId;
    let effectiveExistingRoute = existingRoute;
    if (!routeId && fromSessionId) {
      if (sessionTrackPoints.length < 2) {
        setDualEditError('Loading route data — please try again in a moment.');
        return;
      }
      setDualEditLoading(true);
      setDualEditError(null);
      let newId: string | null = null;
      try {
        const safeName = name.trim() ||
          (session
            ? `${session.activityMode === 'running' ? 'Run' : 'Hike'} ${new Date(session.startedAt).toLocaleDateString('en-NZ', { day: 'numeric', month: 'short' })}`
            : 'Untitled route');
        let computedDistance = 0;
        for (let i = 1; i < sessionTrackPoints.length; i++) {
          computedDistance += haversineM(
            { lat: sessionTrackPoints[i - 1].lat, lng: sessionTrackPoints[i - 1].lng },
            { lat: sessionTrackPoints[i].lat, lng: sessionTrackPoints[i].lng },
          );
        }
        newId = await addRoute({
          name: safeName,
          points: sessionTrackPoints,
          waypoints: [],
          distanceM: computedDistance,
          elevationGainM: session?.elevationGainM ?? 0,
        });
        if (!newId) {
          setDualEditError('Could not save route — please check your connection.');
          setDualEditLoading(false);
          return;
        }
        // Record for cleanup-on-cancel + replace nav params so re-renders
        // see the new route as existing.
        setFreshlyCreatedRouteId(newId);
        (nav as any).setParams({ routeId: newId });
      } catch (e: any) {
        setDualEditError(e?.message || 'Failed to start edit.');
        setDualEditLoading(false);
        return;
      }
      // Continue into the existing-route flow below using effectiveRouteId.
      effectiveRouteId = newId;
      // existingRoute selector won't include the new route until next
      // render. Read directly from the store.
      effectiveExistingRoute = useRouteStore.getState().routes.find(r => r.id === newId);
      // Fall through — DO NOT return.
    }

    if (!effectiveRouteId || !effectiveExistingRoute) {
      setDualEditLoading(false);
      return;
    }
    if (!effectiveExistingRoute.points || effectiveExistingRoute.points.length < 2) {
      setDualEditLoading(true);
      setDualEditError(null);
      try {
        await loadRouteDetail(effectiveRouteId);
        // Wait up to 5s for the store to reflect the hydrated points.
        const deadline = Date.now() + 5000;
        while (Date.now() < deadline) {
          const live = useRouteStore.getState().routes.find(r => r.id === effectiveRouteId);
          if (live && live.points && live.points.length >= 2) break;
          await new Promise(r => setTimeout(r, 100));
        }
        const live = useRouteStore.getState().routes.find(r => r.id === effectiveRouteId);
        if (!live || !live.points || live.points.length < 2) {
          setDualEditError(
            'Could not load route data — please check your connection and try again.',
          );
          return;
        }
        // Hydration complete — fall through to enter dual-edit using
        // the freshly-hydrated points (read directly from useRouteStore
        // since the closure's existingRoute reference is stale).
        // This is a deliberate continuation: we don't bail, we just
        // continue with the re-read points below.
      } catch (e: any) {
        setDualEditError(e?.message || 'Failed to load route data.');
        return;
      } finally {
        setDualEditLoading(false);
      }
    }
    // Re-read existingRoute from the store in case it was hydrated
    // above; the closure's reference is stale after the await.
    const liveRoute = useRouteStore.getState().routes.find(r => r.id === effectiveRouteId);
    if (!liveRoute || !liveRoute.points || liveRoute.points.length < 2) {
      setDualEditError('Route data unavailable.');
      return;
    }
    setDualEditLoading(true);
    setDualEditError(null);
    try {
      const legacyPoints: RoutingLngLat[] = liveRoute.points.map(p => ({
        lng: p.lng,
        lat: p.lat,
      }));
      // v31-fix (functional Blocker regression): delegate migration to
      // beginEdit. beginEdit owns the pendingBeginArgs / migratorRetry
      // capture that drives MigratorRetryPrompt's Retry/Skip/Report UI.
      // We call it twice in the legacy-route path:
      //   1. First call (no walkedIndex): triggers migration. If it
      //      fails with retry:true, beginEdit writes migratorRetry +
      //      pendingBeginArgs and the prompt fires. If it succeeds,
      //      a session is open BUT walkedIndex is null (no corridor
      //      enforcement yet).
      //   2. Build editContext now that extras exists, then inject
      //      walkedIndex/trailGraph via setState.
      // For non-legacy routes (extras already exists), we build context
      // first then call beginEdit once.
      const { loadExtras: loadExtrasFn } = await import(
        '../services/LocalRouteExtras'
      );
      const preExtras = await loadExtrasFn(effectiveRouteId);
      let ctx;
      // v208 fix B1+C2: previously this block imperatively called
      // cameraRef.fitBounds + setCamera({zoomLevel:14}) here, then later
      // dualEditActive flipped and dualEditCameraFit re-fit the camera —
      // a visible double-jump. Now dualEditCameraFit clamps zoom>=14
      // itself (see useMemo above), so the natural Camera mount handles
      // both fit + zoom in a single animation. We still wait for tiles
      // to settle before extractJunctions runs (see waitForTilesOrTimeout
      // below). Legacy path inserts the same wait AFTER beginEdit
      // completes (post-migration) but BEFORE buildEditContext.
      if (preExtras && preExtras.originalPoints && preExtras.originalPoints.length >= 2) {
        // Non-legacy path: wait for tiles, then build context.
        await waitForTilesOrTimeout();
        ctx = await buildEditContext(effectiveRouteId, mapViewRef);
        if (!ctx) {
          setDualEditError(
            'Cannot edit this route — original GPS data is missing. Try recording it again.',
          );
          return;
        }
        await useRouteEditStore.getState().beginEdit({
          routeId: effectiveRouteId,
          routePoints: legacyPoints,
          // v33-fix (Critical C-NEW-3): pass route.updatedAt so the
          // store can compare freshness against extras.updatedAt and
          // avoid silently discarding a fresher dual-edit save.
          routeUpdatedAt: liveRoute.updatedAt,
          trailGraph: ctx.trailGraph,
          walkedIndex: ctx.walkedIndex,
        });
      } else {
        // Legacy path: beginEdit migrates first (and writes pendingBeginArgs
        // on retry-failure for the MigratorRetryPrompt UX).
        await useRouteEditStore.getState().beginEdit({
          routeId: effectiveRouteId,
          routePoints: legacyPoints,
          routeUpdatedAt: liveRoute.updatedAt,
          trailGraph: null,
          walkedIndex: null,
        });
        const postBegin = useRouteEditStore.getState();
        if (!postBegin.isOpen) {
          // Migration failed. If retry:true, MigratorRetryPrompt will
          // show the Retry/Skip/Report alert. Otherwise we surface the
          // error here.
          if (!postBegin.migratorRetry) {
            setDualEditError(postBegin.lastError || 'Could not start edit.');
          }
          return;
        }
        // Migration succeeded — extras now exists. Wait for tiles to
        // settle (v208 fix C2: same wait the non-legacy branch performs;
        // legacy must wait AFTER migration completes so the camera has
        // already animated to the dualEditCameraFit viewport), then
        // build context and inject walkedIndex/trailGraph so corridor
        // enforcement is live.
        await waitForTilesOrTimeout();
        ctx = await buildEditContext(effectiveRouteId, mapViewRef);
        if (ctx) {
          useRouteEditStore.setState({
            walkedIndex: ctx.walkedIndex,
            trailGraph: ctx.trailGraph,
          });
        }
      }
      // beginEdit may have set lastError if migration failed or
      // editModeEnabled flipped off — surface that to the user.
      const post = useRouteEditStore.getState();
      if (!post.isOpen && !post.migratorRetry) {
        setDualEditError(post.lastError || 'Could not start edit.');
      }
    } catch (e: any) {
      setDualEditError(e?.message || 'Failed to start edit.');
    } finally {
      setDualEditLoading(false);
    }
  }, [routeId, existingRoute, dualEditLoading, loadRouteDetail, fromSessionId, sessionTrackPoints, name, session, addRoute, nav]);

  const exitDualEdit = useCallback(
    (mode: 'save' | 'cancel') => {
      if (!dualEditActive) return;
      if (mode === 'save') {
        // v30-fix (Medium M2 — fragile coupling): capture workingPoints
        // BEFORE saveAndExit teardown so we don't depend on the store
        // implementation detail that workingPoints isn't cleared in the
        // success branch.
        const pointsForRouteStore = useRouteEditStore
          .getState()
          .workingPoints.map(p => ({ lat: p.lat, lng: p.lng }));
        useRouteEditStore
          .getState()
          .saveAndExit()
          .then(result => {
            if (!result.ok) {
              setDualEditError(result.error || 'Save failed.');
              return;
            }
            // v200 fix B1: once Save resolves OK, the route is committed —
            // clear the cleanup-on-cancel marker so accidental future
            // cancellations don't delete the user's saved work.
            // v204 fix C-NEW-1: ALSO clear the ref synchronously here.
            // setFreshlyCreatedRouteId(null) only schedules a state
            // update; the ref-sync useEffect commits AFTER React's
            // commit phase, but nav.goBack() below runs synchronously
            // and may unmount the screen before that effect runs. The
            // unmount cleanup reads the ref — if still stale, it would
            // delete the just-saved route. Imperative ref clear closes
            // the race.
            setFreshlyCreatedRouteId(null);
            freshlyCreatedRouteIdRef.current = null;
            if (result.sessionReplaced) {
              // v30-fix (Medium — Scenario 23): the save persisted but a
              // new session is now active — give the user explicit
              // feedback so they don't think nothing happened.
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              setDualEditError('Saved — a new edit session is now active.');
              return;
            }
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            // Successful save — also refresh useRouteStore so the route
            // list shows the latest geometry.
            // v31-fix (Critical Scenario 6): updateRoute may be sync (void)
            // or async. If it's async and rejects, we MUST hold navigation
            // until the user has acknowledged the error — otherwise
            // nav.goBack unmounts the screen before the error renders.
            const updateResult = updateRoute(routeId!, { points: pointsForRouteStore });
            if (updateResult && typeof (updateResult as any).then === 'function') {
              (updateResult as Promise<any>)
                .then(() => {
                  nav.goBack();
                })
                .catch((e: any) => {
                  // Hold navigation; surface error via Alert so it can't
                  // be missed. User taps OK, then we navigate.
                  Alert.alert(
                    'Saved with warning',
                    `Edits were saved locally, but the route list could not be refreshed: ${e?.message ?? 'unknown error'}. Pull to refresh on the routes screen.`,
                    [{ text: 'OK', onPress: () => nav.goBack() }],
                    { cancelable: false },
                  );
                });
            } else {
              // Sync updateRoute (no Promise) — navigate immediately.
              nav.goBack();
            }
          })
          .catch(e => setDualEditError(e?.message || 'Save failed.'));
      } else {
        useRouteEditStore.getState().cancelEdit();
        // v200 fix B1: if we created a backend route via the save-as-route
        // → Edit flow and the user is now cancelling, delete that route
        // so it doesn't persist as an unintended save. The route was a
        // means-to-an-end (we needed a routeId to anchor edit state),
        // not a user-confirmed save. Once deleted, also pop back to the
        // Activity since the screen no longer has a valid routeId to
        // render against.
        if (freshlyCreatedRouteId) {
          deleteRoute(freshlyCreatedRouteId).catch(() => {});
          // v204 fix C-NEW-1: imperative ref clear before nav.goBack so
          // unmount cleanup doesn't fire a second deleteRoute.
          setFreshlyCreatedRouteId(null);
          freshlyCreatedRouteIdRef.current = null;
          nav.goBack();
        }
        // For non-save-as-route cancel: just return to view-mode (no nav).
      }
    },
    [dualEditActive, routeId, nav, updateRoute, freshlyCreatedRouteId, deleteRoute],
  );

  // Memoise edit handles' coordinates so PointAnnotation re-renders only
  // when the underlying workingPoints actually change.
  const editHandles = useMemo(() => {
    if (!dualEditActive) return null;
    const wp = editStore.workingPoints;
    if (wp.length < 2) return null;
    const first = wp[0];
    const last = wp[wp.length - 1];
    const midIdx = Math.min(Math.max(midpointAnchorIdx, 1), wp.length - 2);
    const mid = wp[midIdx] ?? first;
    return { first, last, mid, midIdx };
  }, [dualEditActive, editStore.workingPoints, midpointAnchorIdx]);

  // v200: routeNodeAnchors are the dots the user can tap. Endpoints
  // always present + intersection junctions on the route + trim-restore
  // points outside the current workingPoints slice. Recomputes whenever
  // workingPoints or trailGraph changes (which happens after every
  // commit).
  const routeNodeAnchors = useMemo(() => {
    if (!dualEditActive) return [];
    return computeRouteNodeAnchors({
      workingPoints: editStore.workingPoints,
      originalPoints: editStore.originalPoints,
      trailGraph: editStore.trailGraph,
    });
  }, [
    dualEditActive,
    editStore.workingPoints,
    editStore.originalPoints,
    editStore.trailGraph,
  ]);

  // v200: selection state is component-local — never persists. Tapping
  // an anchor selects it; tapping it again or tapping background clears.
  const [selectedAnchorId, setSelectedAnchorId] = useState<string | null>(null);

  // v200 Phase 6: track current map zoom so EditableNodeLayer can
  // hide all anchor circles below MIN_NODE_DISPLAY_ZOOM. Initialised
  // to a high value so first paint after entering edit-mode (before
  // any onCameraChanged fires) does NOT spuriously suppress the dots
  // when the camera fit zoom is already big enough.
  const [currentZoom, setCurrentZoom] = useState<number>(14);

  // v200 fix B1: when save-as-route → Edit creates a backend route to
  // get a routeId, we record the new id here. If the user then cancels
  // (without ever saving real edits), we delete the freshly-created
  // backend route so it doesn't persist as an unintended save.
  // Cleared on the first successful save — by that point the user has
  // accepted the route as real.

  // v200 fix B1 cleanup: if the user exits the screen via hardware back
  // or BackButton WITHOUT going through Cancel/Save, the freshly-created
  // backend route would persist as an unintended save. This unmount-time
  // cleanup deletes it. Read state via ref so the closure isn't stale.
  const freshlyCreatedRouteIdRef = useRef<string | null>(null);
  useEffect(() => {
    freshlyCreatedRouteIdRef.current = freshlyCreatedRouteId;
  }, [freshlyCreatedRouteId]);
  useEffect(() => {
    return () => {
      const id = freshlyCreatedRouteIdRef.current;
      if (id) {
        // Best-effort delete — fire-and-forget; the screen is unmounting.
        deleteRoute(id).catch(() => {});
      }
    };
  }, [deleteRoute]);

  // v200: candidate set for the selected anchor. Computed via Dijkstra
  // (intersection nodes) or simple list filter (endpoints).
  const candidateAnchors = useMemo(() => {
    if (!selectedAnchorId) return [];
    const selected = routeNodeAnchors.find(a => a.id === selectedAnchorId);
    if (!selected) return [];
    return computeCandidates({
      selected,
      allAnchors: routeNodeAnchors,
      workingPoints: editStore.workingPoints,
      trailGraph: editStore.trailGraph,
      walkedIndex: editStore.walkedIndex,
      corridorRadiusM:
        editStore.flagsSnapshot?.editCorridorRadiusMeters ?? 1000,
    });
  }, [
    selectedAnchorId,
    routeNodeAnchors,
    editStore.workingPoints,
    editStore.trailGraph,
    editStore.walkedIndex,
    editStore.flagsSnapshot?.editCorridorRadiusMeters,
  ]);

  const candidateAnchorIds = useMemo(
    () => new Set(candidateAnchors.map(a => a.id)),
    [candidateAnchors],
  );

  // Clear selection when leaving dual-edit (so re-entry starts fresh).
  useEffect(() => {
    if (!dualEditActive) {
      setSelectedAnchorId(null);
    }
  }, [dualEditActive]);

  // v200: tap handler for an anchor.
  // - Tap the same anchor again: deselect.
  // - Tap a different anchor that's a CANDIDATE for the current source:
  //     commit the replacement (fast path so user doesn't need to drag).
  // - Tap a different anchor that's NOT a candidate: switch source.
  const handleAnchorTap = useCallback(
    async (anchor: RouteNodeAnchor) => {
      // v204+ fix C3: bump on EVERY tap so the MapView onPress race
      // guard correctly suppresses the post-select deselect on Android.
      anchorSelectAtRef.current = Date.now();
      if (anchor.id === selectedAnchorId) {
        setSelectedAnchorId(null);
        return;
      }
      // If we have a current source and the tap is on one of its
      // candidates, commit immediately (tap-to-replace shortcut).
      if (selectedAnchorId && candidateAnchorIds.has(anchor.id)) {
        await commitAnchorReplacement(selectedAnchorId, anchor);
        return;
      }
      // Otherwise: select the new anchor.
      Haptics.selectionAsync().catch(() => {});
      setSelectedAnchorId(anchor.id);
    },
    [selectedAnchorId, candidateAnchorIds, candidateAnchors, routeNodeAnchors],
  );

  // v200: commit a node replacement. Source is identified by id (must be
  // the currently selected anchor), target is the candidate anchor.
  const commitAnchorReplacement = useCallback(
    async (sourceId: string, target: RouteNodeAnchor) => {
      const source = routeNodeAnchors.find(a => a.id === sourceId);
      if (!source) return;
      const store = useRouteEditStore.getState();

      // Endpoint trim cases.
      // v204+ fix C2: trim that removes >50% of the route fires a
      // confirm dialog so a single mis-tap doesn't silently shred 95%
      // of the polyline. trimStart slices [newEndpointIdx .. last];
      // trimEnd slices [0 .. newEndpointIdx]. Lost fraction is
      // newEndpointIdx/total or (total-1-newEndpointIdx)/total
      // respectively.
      const trimAfterConfirm = (
        message: string,
        op: () => void,
      ) => {
        Alert.alert(
          'Trim route?',
          message,
          [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Trim',
              style: 'destructive',
              onPress: op,
            },
          ],
        );
      };
      if (source.kind === 'endpoint-start') {
        if (target.kind === 'intersection' && target.workingPointIdx !== undefined) {
          const totalLen = store.workingPoints.length;
          const lostFraction = target.workingPointIdx / Math.max(1, totalLen - 1);
          const doTrim = () => {
            const r = store.trimStart(target.workingPointIdx!);
            if (!r.ok) {
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
            } else {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            }
            setSelectedAnchorId(null);
          };
          if (lostFraction > 0.5) {
            trimAfterConfirm(
              `This will remove the first ${Math.round(lostFraction * 100)}% of the route. Continue?`,
              doTrim,
            );
            return;
          }
          doTrim();
          return;
        }
        if (target.kind === 'trim-restore-start' && target.originalPointIdx !== undefined) {
          // v200: restore — extend back toward originalPoints[0].
          const r = store.restoreStart(target.originalPointIdx);
          if (!r.ok) {
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
          } else {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          }
          setSelectedAnchorId(null);
          return;
        }
      }
      if (source.kind === 'endpoint-end') {
        if (target.kind === 'intersection' && target.workingPointIdx !== undefined) {
          const totalLen = store.workingPoints.length;
          const lostFraction =
            (totalLen - 1 - target.workingPointIdx) / Math.max(1, totalLen - 1);
          const doTrim = () => {
            const r = store.trimEnd(target.workingPointIdx!);
            if (!r.ok) {
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
            } else {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            }
            setSelectedAnchorId(null);
          };
          if (lostFraction > 0.5) {
            trimAfterConfirm(
              `This will remove the last ${Math.round(lostFraction * 100)}% of the route. Continue?`,
              doTrim,
            );
            return;
          }
          doTrim();
          return;
        }
        if (target.kind === 'trim-restore-end' && target.originalPointIdx !== undefined) {
          const r = store.restoreEnd(target.originalPointIdx);
          if (!r.ok) {
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
          } else {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          }
          setSelectedAnchorId(null);
          return;
        }
      }

      // Midpoint replacement.
      if (
        source.kind === 'intersection' &&
        source.workingPointIdx !== undefined &&
        target.kind === 'intersection'
      ) {
        store.proposeMidpointDrag(source.workingPointIdx, {
          lng: target.lng,
          lat: target.lat,
        });
        const r = await store.commitMidpointDrag();
        if (!r.ok) {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        } else {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        }
        setSelectedAnchorId(null);
        return;
      }
    },
    [routeNodeAnchors],
  );

  // v200 Phase 5: drag-with-magnet. User long-presses (Mapbox default
  // for draggable PointAnnotation) the SELECTED source anchor and
  // drags. On release, find the nearest candidate within 100m of the
  // release point. If found, commit the replacement. Otherwise no-op
  // (snap back). The selection-only filter on draggable=true means
  // idle dots are not draggable — accidental drags suppressed.
  const handleAnchorDragEnd = useCallback(
    async (
      sourceAnchor: RouteNodeAnchor,
      releaseLng: number,
      releaseLat: number,
    ) => {
      if (sourceAnchor.id !== selectedAnchorId) return;
      // v200 fix C2: scale snap radius by current zoom so the magnet
      // window is roughly constant in screen pixels (~50px). At zoom 14
      // 1 screen pixel ≈ 9.5m at the equator; at zoom 16 ≈ 2.4m. Formula:
      // baseM_at_z14 / 2^(zoom - 14). Cap at 200m to handle very low
      // zoom without making the world the magnet target.
      const baseM = 50 * 9.5; // ~475m visible-pixels at zoom 14
      const scaledRadius = baseM / Math.pow(2, Math.max(0, currentZoom - 14));
      const SNAP_RADIUS_M = Math.min(200, Math.max(20, scaledRadius));
      const nearest = findNearestCandidate(
        candidateAnchors,
        releaseLng,
        releaseLat,
        SNAP_RADIUS_M,
      );
      if (!nearest) {
        // Drag-release on empty space: no-op, but provide a small
        // haptic so user knows the drag was registered.
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
        return;
      }
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
      await commitAnchorReplacement(sourceAnchor.id, nearest);
    },
    [selectedAnchorId, candidateAnchors, commitAnchorReplacement, currentZoom],
  );

  // Pre-fetch a one-shot GPS fix on enter so the editor opens centred
  // on the user's actual location and the geocoding bias / country
  // detection have a real coordinate to work from. Without this the
  // editor falls back to the configured region centre (NZ) — wrong
  // for a user testing in another country.
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
        // GPS unavailable — fall back to region centre.
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Debounced live-search: as the user types, fire handleSearch 400ms
  // after the last keystroke. Means they don't have to tap the search
  // button — typing "shang" surfaces matches automatically. 400ms is
  // long enough that a fast typist doesn't trigger an in-flight
  // request per keystroke.
  useEffect(() => {
    if (!showSearch) return;
    if (!searchQuery.trim()) {
      setSearchResults([]);
      return;
    }
    const timer = setTimeout(() => {
      handleSearch();
    }, 400);
    return () => clearTimeout(timer);
  }, [searchQuery, showSearch]);

  // v123 fix #8: when opened with a routeId but the in-store record
  // doesn't yet have points (the list endpoint omits them for perf),
  // hydrate the full detail so the polyline + waypoints can render.
  useEffect(() => {
    if (routeId && existingRoute && existingRoute.points.length === 0) {
      loadRouteDetail(routeId);
    }
  }, [routeId, existingRoute?.points.length]);

  // Load existing route OR session data on mount
  useEffect(() => {
    if (existingRoute) {
      setName(existingRoute.name);
      if (existingRoute.waypoints.length > 0) {
        setWaypoints(existingRoute.waypoints.map(wp => ({
          id: wp.id, lat: wp.lat, lng: wp.lng, label: wp.label,
        })));
      } else {
        // Sprint 66 Card 1 fix: leave waypoints empty by default. The
        // polyline now renders from existingRoute.points directly via the
        // LineLayer above. Waypoints are reserved for user-added markers
        // (TTS/announce points), not geometry handles. This kills the
        // "20 ugly dots" bug from feature-map.
        setWaypoints([]);
      }
    } else if (session) {
      // Pre-fill name from activity, then snap track to road network +
      // trim home/off-grid head & tail before exposing waypoints to
      // the editor. The product rule: "saved routes start from the
      // nearest public road, not from the user's house." See
      // routeMatcher service for the algorithm.
      const date = new Date(session.startedAt).toLocaleDateString('en-NZ', { day: 'numeric', month: 'short' });
      setName(`${session.activityMode === 'running' ? 'Run' : 'Hike'} ${date}`);
      // v198 fix-2: prefer caller-provided trackPoints (server-hydrated
      // by MapHistoryScreen). Fall back to local AsyncStorage only if
      // the caller didn't pass them. This closes the silent-fail path
      // where loadTrackPoints returns [] for any server-synced session.
      const sourceTrackPointsP: Promise<Array<{ lat: number; lng: number }>> =
        fromSessionTrackPoints && fromSessionTrackPoints.length >= 2
          ? Promise.resolve(fromSessionTrackPoints.map(p => ({ lat: p.lat, lng: p.lng })))
          : loadTrackPoints(session.id).then(tp => tp.map(p => ({ lat: p.lat, lng: p.lng })));
      sourceTrackPointsP.then(async tp => {
        if (tp.length < 2) return;
        const profile = session.activityMode === 'running' ? 'walking' : 'walking';
        const matched = await snapToRoadAndTrim(tp, profile);
        setSnapWarning(!matched.isSnapped);
        // Sprint 66 Card 1 fix: store the matched (or raw) polyline so the
        // map LineLayer renders the actual recorded curve. Waypoints stays
        // empty (reserved for user-added markers).
        setSessionTrackPoints(matched.points);
        setWaypoints([]);
      });
    }
  }, [existingRoute?.id, session?.id]);

  // Calculate total distance from waypoints chain
  const totalDistanceM = waypoints.reduce((sum, wp, i) => {
    if (i === 0) return 0;
    return sum + haversineM(
      { lat: waypoints[i - 1].lat, lng: waypoints[i - 1].lng },
      { lat: wp.lat, lng: wp.lng },
    );
  }, 0);

  // v198 fix-4: stats row must reflect the actual route geometry, not
  // the waypoints array (which Sprint 66 Card 1 reserved for user-placed
  // markers, leaving it [] for activity-derived saves and read-only
  // routes). Read the geometry source priority chain: existingRoute.points
  // (view-mode) → sessionTrackPoints (save-as-route draft) → waypoints
  // (legacy hand-drawn). Distance prefers persisted distanceM when in
  // view-mode (server is the truth) and falls back to a haversine sum
  // otherwise.
  const displayedStats = useMemo(() => {
    const haversineSum = (pts: Array<{ lat: number; lng: number }>) => {
      let d = 0;
      for (let i = 1; i < pts.length; i++) {
        d += haversineM(
          { lat: pts[i - 1].lat, lng: pts[i - 1].lng },
          { lat: pts[i].lat, lng: pts[i].lng },
        );
      }
      return d;
    };
    if (existingRoute && existingRoute.points && existingRoute.points.length >= 2) {
      const distM =
        typeof existingRoute.distanceM === 'number' && existingRoute.distanceM > 0
          ? existingRoute.distanceM
          : haversineSum(existingRoute.points);
      return { pointCount: existingRoute.points.length, distanceM: distM };
    }
    if (sessionTrackPoints.length >= 2) {
      return {
        pointCount: sessionTrackPoints.length,
        distanceM: haversineSum(sessionTrackPoints),
      };
    }
    return { pointCount: waypoints.length, distanceM: totalDistanceM };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [existingRoute?.points?.length, existingRoute?.distanceM, sessionTrackPoints.length, waypoints.length, totalDistanceM]);

  const handleAddWaypoint = (lat: number, lng: number) => {
    const id = `wp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    setWaypoints(prev => [...prev, { id, lat, lng, label: `Point ${prev.length + 1}` }]);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const handleUndo = () => {
    setWaypoints(prev => prev.slice(0, -1));
  };

  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const showError = (msg: string) => {
    setErrorMsg(msg);
    setTimeout(() => setErrorMsg(null), 3000);
  };

  const handleClear = () => {
    setWaypoints([]);
  };

  // v198 fix-1: handleSave is now async. addRoute / updateRoute return
  // Promises (server round-trip) and the OLD code fired nav.goBack()
  // before persistence completed — failure was silent (Promise rejected
  // after goBack unmounted the catch). Now we await, capture the id,
  // and nav.reset (save-as-route → Routes tab) or goBack (existing-route
  // edit save). Errors surface as inline showError + haptic.
  const handleSave = async () => {
    if (!name.trim()) {
      showError('Please enter a route name');
      return;
    }
    // Sprint 66 Fix-13 (B-NEW-1): determine the geometry source for the
    // saved route. After Card 1 fix, waypoints stays empty for activity→route
    // and view-mode flows (waypoints is now reserved for user-added markers).
    // The actual route geometry lives in:
    //   - existingRoute.points (view/edit existing route)
    //   - sessionTrackPoints (activity → save as route)
    //   - waypoints (legacy: user manually placed pins)
    // Validation + persistence must read from whichever has data.
    const geometryPoints: Array<{ lat: number; lng: number }> =
      existingRoute && existingRoute.points && existingRoute.points.length >= 2
        ? existingRoute.points.map(p => ({ lat: p.lat, lng: p.lng }))
        : sessionTrackPoints.length >= 2
          ? sessionTrackPoints
          : waypoints.map(wp => ({ lat: wp.lat, lng: wp.lng }));

    if (geometryPoints.length < 2) {
      showError('Need at least 2 points to create a route');
      return;
    }

    // Compute distance from the actual geometry, not from waypoints.
    const computedDistanceM = (() => {
      let d = 0;
      for (let i = 1; i < geometryPoints.length; i++) {
        d += haversineM(
          { lat: geometryPoints[i - 1].lat, lng: geometryPoints[i - 1].lng },
          { lat: geometryPoints[i].lat, lng: geometryPoints[i].lng },
        );
      }
      return d;
    })();

    const routeData = {
      name: name.trim(),
      points: geometryPoints,
      waypoints: waypoints.map(wp => ({
        id: wp.id,
        lat: wp.lat,
        lng: wp.lng,
        label: wp.label,
        announceOnArrival: true,
        radiusM: 30,
      })),
      distanceM: computedDistanceM,
      elevationGainM: existingRoute?.elevationGainM ?? session?.elevationGainM ?? 0,
    };

    try {
      if (routeId && existingRoute) {
        await updateRoute(routeId, routeData);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        // Existing-route edit: pop back to Routes / wherever we came from.
        nav.goBack();
      } else {
        const newId = await addRoute(routeData);
        // v199 fix (CRIT-1): addRoute returns null on server failure
        // (createRoute swallows network errors and returns null without
        // throwing — see routeService.ts:75-87). Without this null
        // check, handleSave would fire success haptic + nav.goBack and
        // the user would believe the route saved. Treat null as failure
        // and route into the same catch block as a thrown error.
        if (!newId) {
          throw new Error('Failed to save route — please check your connection and try again.');
        }
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        // v198 fix-3: save-as-route from Activity → land on Routes list +
        // the new route's detail. nav.goBack would dump the user back on
        // the Activity detail, hiding the just-saved route. This matches
        // HikingScreen.tsx:1764 stop-then-save flow for cross-screen
        // consistency.
        if (fromSessionId) {
          (nav as any).reset({
            index: 2,
            routes: [
              { name: 'Home' },
              { name: 'Routes', params: { initialTab: 'routes' } },
              { name: 'RouteEditor', params: { routeId: newId } },
            ],
          });
        } else {
          nav.goBack();
        }
      }
    } catch (e: any) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      showError(e?.message || 'Failed to save route');
    }
  };

  const handleSearch = async () => {
    if (!searchQuery.trim() || !MAPBOX_TOKEN) return;
    // Cancel any prior in-flight search before starting a new one.
    // Without this, rapid typing can result in stale results
    // overwriting fresh ones (typed "shang" → "shanghai" → both
    // requests in flight; "shang" returns last and overwrites the
    // narrower "shanghai" results).
    searchAbortRef.current?.abort();
    const controller = new AbortController();
    searchAbortRef.current = controller;
    try {
      // ── Geocoding strategy (modeled after Google Places best practices) ──
      // 1. Bias by the user's live GPS (proximity). Falls back to the
      //    configured region centre (NZ) when no GPS fix is available.
      // 2. Auto-detect the user's country via a reverse-geocode of their
      //    current GPS, then pass `country=<iso2>` so we hard-filter to
      //    that country. This is what stops "公园" from matching parks
      //    in Argentina when the user is standing in Shanghai.
      // 3. Pick the local language from the country code (zh for CN,
      //    ja for JP, ko for KR, en everywhere else by default), but
      //    keep English as the primary display language — Mapbox returns
      //    `place_name` in the requested language and `place_name_en`
      //    alongside it, so we show English as the main title with the
      //    local-language name as a secondary line.
      // 4. autocomplete=true — Mapbox defaults to false, which is why
      //    short queries used to feel broken. With autocomplete on,
      //    prefix matching kicks in for free.
      // 5. types=place,locality,neighborhood,address,poi — drop region
      //    /country/postcode noise that's irrelevant to a route editor.
      const userCoord = useTrackingStore.getState().lastCoordinate;
      const region = getCurrentRegion();
      const proxLng = userCoord?.lng ?? region.centerLng;
      const proxLat = userCoord?.lat ?? region.centerLat;

      // Reverse-geocode the proximity point to find which country we're
      // in. Cheap (one extra request, or 0 if the user already searched
      // and we cached). Best-effort — if it fails we just don't pass
      // country and fall back to region-only filtering.
      let countryCode: string | null = null;
      let langCode = 'en';
      try {
        const revRes = await fetch(
          `https://api.mapbox.com/geocoding/v5/mapbox.places/${proxLng},${proxLat}.json?` +
          new URLSearchParams({
            access_token: MAPBOX_TOKEN,
            types: 'country',
            limit: '1',
          }).toString(),
          { signal: controller.signal },
        );
        const revData = await revRes.json();
        const cc = revData?.features?.[0]?.properties?.short_code as string | undefined;
        if (cc) {
          countryCode = cc.toUpperCase();
          // Map a handful of common countries to their primary local
          // language. Default 'en' is reasonable everywhere else —
          // Mapbox falls back gracefully.
          const langMap: Record<string, string> = {
            CN: 'zh-Hans', TW: 'zh-Hant', HK: 'zh-Hant',
            JP: 'ja', KR: 'ko',
            DE: 'de', FR: 'fr', ES: 'es', IT: 'it', PT: 'pt',
            RU: 'ru', NL: 'nl', PL: 'pl', TR: 'tr',
          };
          langCode = langMap[countryCode] ?? 'en';
        }
      } catch {
        // Network glitch on reverse geocode — proceed without country.
      }

      const params = new URLSearchParams({
        access_token: MAPBOX_TOKEN,
        limit: '8',
        autocomplete: 'true',
        proximity: `${proxLng},${proxLat}`,
        types: 'place,locality,neighborhood,address,poi',
        // Request the local language — the response includes BOTH the
        // localized name AND an English fallback under text_en /
        // place_name_en, so we can render English first + local second.
        language: langCode,
      });
      if (countryCode) params.append('country', countryCode.toLowerCase());

      const res = await fetch(
        `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(searchQuery)}.json?${params.toString()}`,
        { signal: controller.signal },
      );
      // If a newer query has fired since we started this request, drop
      // these results on the floor — abort() above already prevented
      // the next-query handler from being affected by us, but we may
      // still have parsed a stale response before the abort landed.
      if (controller.signal.aborted) return;
      const data = await res.json();
      const results = (data.features || []).map((f: any) => {
        // English-first display: prefer place_name_en when Mapbox
        // returns it (which it does whenever language ≠ en). Fall back
        // to place_name. The local-language version goes on the second
        // line so users see both — "Shanghai Zoo" / "上海动物园".
        const enName: string = f.place_name_en || f.place_name;
        const localName: string = f.place_name;
        const localDiffersFromEn = localName && localName !== enName;
        return {
          name: enName,
          subtitle: localDiffersFromEn ? localName : null,
          lat: f.center[1],
          lng: f.center[0],
        };
      });
      setSearchResults(results);
    } catch (err: any) {
      // AbortError when a newer query took over — leave the existing
      // results alone; the new query will populate setSearchResults.
      if (err?.name === 'AbortError') return;
      setSearchResults([]);
    }
  };

  const handleSelectSearchResult = (result: { name: string; lat: number; lng: number }) => {
    handleAddWaypoint(result.lat, result.lng);
    setShowSearch(false);
    setSearchQuery('');
    setSearchResults([]);
  };

  return (
    <View style={styles.container}>
      {/* Map area */}
      <View style={styles.mapArea}>
        {MapView ? (
          <MapView
            ref={mapViewRef}
            style={StyleSheet.absoluteFillObject}
            styleURL="mapbox://styles/mapbox/outdoors-v12"
            logoEnabled={false}
            attributionEnabled={false}
            scaleBarEnabled={false}
            compassEnabled={false}
            onDidFinishRenderingMapFully={() => {
              // v208 fix C1: this event fires when Mapbox has finished
              // rendering all visible tiles for the current camera —
              // the canonical signal that querySourceFeatures will
              // return the full set of road features. Replaces the
              // fixed 600ms setTimeout in enterDualEdit.
              mapTilesReadyRef.current = true;
            }}
            onMapIdle={() => {
              // Fallback signal — fires when the camera and rendering
              // have both settled. Some platforms emit this more
              // reliably than onDidFinishRenderingMapFully on first
              // mount, so we treat either as ready.
              mapTilesReadyRef.current = true;
            }}
            onCameraChanged={(state: any) => {
              // v200 Phase 6: track current zoom so EditableNodeLayer
              // can hide all node circles below MIN_NODE_DISPLAY_ZOOM
              // (otherwise dense junctions become unreadable dots).
              const z = state?.properties?.zoom;
              if (typeof z === 'number') {
                setCurrentZoom(z);
              }
            }}
            onPress={(e: any) => {
              // v200: when dual-edit is active, map background tap
              // deselects any selected node anchor (returns the editor
              // to "no source selected" state). Anchor taps are handled
              // by EditableNodeLayer's PointAnnotation.onSelected which
              // does not bubble to the MapView onPress.
              // v204+ fix C3: on Android, onPress can fire AFTER onSelected
              // when the tap lands near the edge of the PointAnnotation
              // hit-target. Without this guard, the post-select onPress
              // would clear the just-set selection. anchorSelectAtRef
              // is bumped on every successful onSelected; we ignore
              // background-tap deselect within 200ms.
              if (dualEditActive) {
                if (Date.now() - anchorSelectAtRef.current < 200) {
                  return;
                }
                if (selectedAnchorId) {
                  setSelectedAnchorId(null);
                }
                return;
              }
              // v198 fix-6: in save-as-route draft mode the map shows a
              // pre-recorded activity polyline. Map taps must NOT add
              // user pins on top — those would persist into the route's
              // waypoints array on Save and corrupt the saved record.
              if (fromSessionId) return;
              const coords = e?.geometry?.coordinates;
              if (Array.isArray(coords) && coords.length >= 2) {
                handleAddWaypoint(coords[1], coords[0]);
              }
            }}
          >
            {CameraComponent && (() => {
              const region = getCurrentRegion();
              // v30-fix (architectural Critical C1): when dualEditActive,
              // centre the camera on the route being edited, not on the
              // user's current GPS. Otherwise editing a route recorded
              // far from the user lands the user looking at empty map.
              // v31-fix (Medium Scenario 17): use memoized fit so the
              // camera doesn't re-animate on every commit/trim.
              if (dualEditActive && dualEditCameraFit) {
                return (
                  <CameraComponent
                    ref={cameraRef}
                    centerCoordinate={dualEditCameraFit.center}
                    zoomLevel={dualEditCameraFit.zoom}
                    animationDuration={300}
                  />
                );
              }
              // v198-fix (bug 3+4) + v200-fix (camera-stuck-on-default):
              // view-mode (existing route) and save-as-route (session
              // draft) both center on the route bbox. Use Camera's
              // `bounds` prop (not center+zoom) because bounds is more
              // reliable on iOS when the data arrives async — the
              // late-mount center+zoom path occasionally left the
              // camera stuck on Mapbox's default view (Corsica for
              // Asian users). Padding 60/40/60/40 matches the existing
              // NativeTrackMap pattern.
              if (routeCameraFit) {
                return (
                  <CameraComponent
                    ref={cameraRef}
                    bounds={{
                      ne: routeCameraFit.ne,
                      sw: routeCameraFit.sw,
                      paddingTop: 60,
                      paddingBottom: 60,
                      paddingLeft: 40,
                      paddingRight: 40,
                    }}
                    animationDuration={0}
                  />
                );
              }
              // v200-fix: while waiting for hydration, mount a Camera
              // anyway — pointed at the user's GPS / region centre —
              // so MapView never falls back to the global default
              // (that was the Corsica bug). Once routeCameraFit is
              // ready, the branch above takes over and bounds-fits
              // to the route. Brief flash of user location is the
              // lesser evil vs. seeing a foreign continent.
              const isWaitingForRouteHydration =
                routeId && existingRoute &&
                (!existingRoute.points || existingRoute.points.length < 2);
              const isWaitingForSessionSnap =
                fromSessionId && sessionTrackPoints.length < 2;
              if (isWaitingForRouteHydration || isWaitingForSessionSnap) {
                const waitCenter: [number, number] = userCoord
                  ? [userCoord.lng, userCoord.lat]
                  : [region.centerLng, region.centerLat];
                const waitZoom = userCoord ? 13 : region.defaultZoom;
                return (
                  <CameraComponent
                    centerCoordinate={waitCenter}
                    zoomLevel={waitZoom}
                    animationDuration={0}
                  />
                );
              }
              const last = waypoints[waypoints.length - 1];
              // Camera centring priority:
              //  1. Last waypoint placed (zoom 13) — keeps the editor
              //     camera following what the user is editing.
              //  2. User's current GPS (zoom 14) — opens the editor
              //     centred on the user's actual location, the right
              //     starting point for "I want to plan a route from
              //     where I am right now". userCoord is reactive so
              //     when the GPS prime resolves a few seconds after
              //     mount the camera updates without a manual refresh.
              //  3. Region centre at default zoom — only when GPS is
              //     unavailable (cold start, permission denied).
              const center: [number, number] = last
                ? [last.lng, last.lat]
                : userCoord
                  ? [userCoord.lng, userCoord.lat]
                  : [region.centerLng, region.centerLat];
              const zoom = waypoints.length > 0
                ? 13
                : userCoord
                  ? 14
                  : region.defaultZoom;
              // Snap instantly when there are no waypoints yet — the
              // user expects the editor to "open at" their location,
              // not animate there. Animate during waypoint placement
              // so the camera follow feels natural.
              const dur = waypoints.length > 0 ? 300 : 0;
              return (
                <CameraComponent
                  centerCoordinate={center}
                  zoomLevel={zoom}
                  animationDuration={dur}
                />
              );
            })()}
            {/* Sprint 66 Card 1 fix: render polyline from route.points (or
                session trackPoints), NOT from sampled waypoints. This shows
                the actual recorded curve instead of straight lines between
                fake sample points. Waypoints array is now reserved for
                user-added markers (TTS/announce points), default empty. */}
            {ShapeSource && LineLayer && (() => {
              // v123 Sprint 66 wiring: when dual-source edit is active,
              // hide the simple LineLayer — DualLineLayer below renders
              // original (faded) + working (colored by source/confidence).
              if (dualEditActive) return null;
              // Priority: existingRoute.points (full geometry from backend hydrate)
              //  → sessionTrackPoints (loaded async after snap-to-road)
              //  → waypoints (legacy fallback for purely-drawn routes)
              const polylineCoords: Array<[number, number]> =
                existingRoute && existingRoute.points && existingRoute.points.length >= 2
                  ? existingRoute.points.map(p => [p.lng, p.lat] as [number, number])
                  : sessionTrackPoints.length >= 2
                    ? sessionTrackPoints.map(p => [p.lng, p.lat] as [number, number])
                    : waypoints.length >= 2
                      ? waypoints.map(wp => [wp.lng, wp.lat] as [number, number])
                      : [];
              if (polylineCoords.length < 2) return null;
              return (
                <ShapeSource
                  id="route-line"
                  shape={{
                    type: 'Feature',
                    geometry: {
                      type: 'LineString',
                      coordinates: polylineCoords,
                    },
                    properties: {},
                  }}
                >
                  <LineLayer
                    id="route-line-layer"
                    style={{
                      lineColor: Colors.primary,
                      lineWidth: 4,
                      lineOpacity: 0.85,
                      lineCap: 'round',
                      lineJoin: 'round',
                    }}
                  />
                </ShapeSource>
              );
            })()}
            {/* Sprint 66 dual-source edit overlay: original (faded) +
                working (colored by source/confidence) + draggable
                trim/midpoint handles. Mounts only when the user has
                explicitly entered dual-edit mode for this route. */}
            {dualEditActive && (
              <DualLineLayer
                originalPoints={editStore.originalPoints}
                workingPoints={editStore.workingPoints}
                segments={editStore.segments}
                showOriginal
              />
            )}
            {dualEditActive && (
              <EditableNodeLayer
                anchors={routeNodeAnchors}
                selectedAnchorId={selectedAnchorId}
                candidateAnchorIds={candidateAnchorIds}
                onAnchorTap={handleAnchorTap}
                onAnchorDragEnd={handleAnchorDragEnd}
                currentZoom={currentZoom}
              />
            )}
            {/* Current user location — blue dot with white ring + soft
                glow. Visually distinct from waypoint pins so the user
                always knows "this is where I am right now" while
                planning. Position comes from useTrackingStore which
                we already prime with getCurrentPositionAsync on
                mount. */}
            {PointAnnotation && userCoord && (
              <PointAnnotation
                id="user-location"
                coordinate={[userCoord.lng, userCoord.lat]}
              >
                <View style={styles.userPinOuter}>
                  <View style={styles.userPinInner} />
                </View>
              </PointAnnotation>
            )}
            {/* Numbered waypoint pins */}
            {PointAnnotation && waypoints.map((wp, i) => (
              <PointAnnotation
                key={wp.id}
                id={wp.id}
                coordinate={[wp.lng, wp.lat]}
              >
                <View style={styles.waypointDot}>
                  <Text style={styles.waypointDotText}>{i + 1}</Text>
                </View>
              </PointAnnotation>
            ))}
          </MapView>
        ) : (
          <>
            <View style={styles.mapFallback}>
              <Icon name="Map" size={48} color={Colors.primaryMuted} />
              <Text style={styles.mapFallbackText}>Route Editor</Text>
              <Text style={styles.mapFallbackSub}>
                {Platform.OS === 'web'
                  ? 'Use search below to add waypoints'
                  : 'Tap map to add waypoints'}
              </Text>
            </View>
            {/* Waypoint markers on fallback panel */}
            {waypoints.map((wp, i) => (
              <View
                key={wp.id}
                style={[styles.waypointDot, {
                  position: 'absolute',
                  left: 100 + (i % 6) * 80,
                  top: 120 + Math.floor(i / 6) * 60,
                }]}
              >
                <Text style={styles.waypointDotText}>{i + 1}</Text>
              </View>
            ))}
          </>
        )}
      </View>

      {/* Top bar — explicit safe-area inset so the back/save chips
          never overlap the Dynamic Island.
          v124 fix #8: in VIEW mode the top bar is JUST the back button.
          Edit + Delete moved to the bottom panel for parity with the
          Activity detail layout. EDIT mode keeps Save + (Delete) on top. */}
      <View style={[styles.topOverlay, { paddingTop: insets.top + 8 }]}>
        <View style={styles.topRow}>
          <BackButton variant="pill" />
          {editMode && (
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {routeId && existingRoute && (
                <TouchableOpacity
                  style={styles.deleteTopBtn}
                  onPress={() => {
                    Alert.alert(
                      'Delete route?',
                      `"${existingRoute.name}" will be removed. Source activity stays.`,
                      [
                        { text: 'Cancel', style: 'cancel' },
                        {
                          text: 'Delete',
                          style: 'destructive',
                          onPress: () => {
                            deleteRoute(routeId);
                            nav.goBack();
                          },
                        },
                      ],
                    );
                  }}
                >
                  <Icon name="Trash2" size={16} color={Colors.danger} strokeWidth={2.5} />
                </TouchableOpacity>
              )}
              <TouchableOpacity style={styles.saveTopBtn} onPress={handleSave}>
                <Icon name="Check" size={16} color="#fff" strokeWidth={2.5} />
                <Text style={styles.saveTopBtnText}>Save</Text>
              </TouchableOpacity>
            </View>
          )}
          {/* Sprint 66 dual-source edit toolbar: shown when the user is
              in dual-edit mode. Cancel discards the pending session;
              Save commits via useRouteEditStore.saveAndExit. */}
          {/* v200 fix C3: top-bar in dual-edit mode keeps ONLY Reset.
              Save + Cancel moved to the bottom row (matches view-mode
              layout per spec point 2). Two parallel Save+Cancel pairs
              would compete with double-confirm flows.
              Reset stays at top so the user always has a one-tap "undo
              everything in this session" without scrolling to bottom. */}
          {dualEditActive && (
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <TouchableOpacity
                style={[styles.saveTopBtn, { backgroundColor: '#9CA3AF' }]}
                onPress={() => {
                  Alert.alert(
                    'Reset to original?',
                    'All your edits in this session will be undone, but the session stays open. You can keep editing or save.',
                    [
                      { text: 'Cancel', style: 'cancel' },
                      {
                        text: 'Reset',
                        style: 'destructive',
                        onPress: () => {
                          useRouteEditStore.getState().resetToOriginal();
                        },
                      },
                    ],
                  );
                }}
                disabled={editStore.isSaving}
              >
                <Icon name="RotateCcw" size={16} color="#fff" strokeWidth={2.5} />
                <Text style={styles.saveTopBtnText}>Reset</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      </View>

      {/* Sprint 66 dual-edit overlays: first-run coachmark + transient
          confidence/warning banner. EditCoachmark gates itself via
          AsyncStorage so it shows once per device. ApproximateWarningBar
          surfaces lastWarning when the orchestrator returned an
          approximate-confidence segment OR when persistence is failing.
          v30-fix (functional Blocker — Scenario 21): show editStore.lastError
          alongside dualEditError so messages set by the store actions
          (trim refused, drag rejected, save in progress, etc.) reach the
          user instead of being silently lost. */}
      {dualEditActive && (
        <>
          <EditCoachmark />
          {/* v200 Phase 6: zoom hint when too far out to see node dots.
              Surfaces only in edit-mode and only when currentZoom < 14
              and no anchor is currently selected (selection state would
              be the user's primary focus, the hint shouldn't fight it). */}
          {currentZoom < 14 && !selectedAnchorId && (
            <View style={styles.zoomHint}>
              <Text style={styles.zoomHintText}>
                Zoom in to see editable points
              </Text>
            </View>
          )}
          <ApproximateWarningBar
            visible={!!editStore.lastWarning}
            message={editStore.lastWarning ?? undefined}
          />
          {(dualEditError || editStore.lastError) && (
            <View style={styles.dualEditErrorBar}>
              <Text style={styles.dualEditErrorText}>
                {dualEditError || editStore.lastError}
              </Text>
              <TouchableOpacity
                onPress={() => {
                  setDualEditError(null);
                  // Clear the store's lastError too so the bar fully dismisses.
                  // v32-fix (B2): use setLastError so the editOpSeq
                  // invariant is preserved (in-flight async ops detect
                  // this dismiss as a state change).
                  if (editStore.lastError) {
                    useRouteEditStore.getState().setLastError(null);
                  }
                }}
                style={styles.dualEditErrorDismiss}
              >
                <Icon name="X" size={14} color="#fff" strokeWidth={2.5} />
              </TouchableOpacity>
            </View>
          )}
        </>
      )}
      {!dualEditActive && dualEditError && (
        <View style={styles.dualEditErrorBar}>
          <Text style={styles.dualEditErrorText}>{dualEditError}</Text>
          <TouchableOpacity
            onPress={() => setDualEditError(null)}
            style={styles.dualEditErrorDismiss}
          >
            <Icon name="X" size={14} color="#fff" strokeWidth={2.5} />
          </TouchableOpacity>
        </View>
      )}

      {/* Bottom panel — wrapped in KeyboardAvoidingView so the route
          name input + tool buttons rise above the keyboard instead of
          being hidden under it. */}
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.bottomPanelWrap}
        keyboardVerticalOffset={0}
      >
      <View style={[styles.bottomPanel, { paddingBottom: insets.bottom + Spacing.md }]}>
        {/* Error banner */}
        {errorMsg && (
          <View style={styles.errorBanner}>
            <Icon name="TriangleAlert" size={14} color={Colors.danger} strokeWidth={2} />
            <Text style={styles.errorText}>{errorMsg}</Text>
          </View>
        )}
        {/* Snap-to-road fallback banner — appears when Mapbox couldn't
            align the trace to a road (indoors, no nearby OSM road, or
            track points cluster too tightly to match). Tells the user
            we're showing raw GPS so they don't think the editor is
            broken when waypoints overlap. */}
        {snapWarning && (
          <View style={styles.snapWarnBanner}>
            <Icon name="Info" size={14} color={Colors.severityCaution} strokeWidth={2} />
            <Text style={styles.snapWarnText}>
              Snap-to-road unavailable — track points cluster too tightly to match a road. Showing raw GPS.
            </Text>
          </View>
        )}
        {/* v123 fix #8: in VIEW mode the bottom panel is a read-only
            summary card. Search / Undo / Clear / name-edit are all
            edit-only. We always show the stats row (always useful). */}
        {!editMode ? (
          <>
            <View style={styles.viewSummary}>
              <Text style={styles.viewSummaryName} numberOfLines={1}>
                {existingRoute?.name ?? name ?? 'Route'}
              </Text>
              <View style={styles.viewStatsInline}>
                <Text style={styles.viewStatText}>{displayedStats.pointCount} points</Text>
                <Text style={styles.viewStatDot}>·</Text>
                <Text style={styles.viewStatText}>{formatDistance(displayedStats.distanceM, 'km', 1)} km</Text>
              </View>
            </View>
            {/* v200: bottom action row.
                - View-mode (dualEditActive=false):
                    save-as-route (fromSessionId, no routeId) → Edit + Cancel
                    existing route (routeId) → Edit + Delete
                - Edit-mode (dualEditActive=true):
                    → Save + Cancel(discard edits, double-confirm)
            */}
            <View style={styles.viewActions}>
              {dualEditActive ? (
                <TouchableOpacity
                  style={[styles.viewBtn, styles.viewEditBtn]}
                  onPress={() => exitDualEdit('save')}
                  activeOpacity={0.85}
                  disabled={editStore.isSaving}
                >
                  {editStore.isSaving ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <Icon name="Check" size={16} color="#fff" strokeWidth={2.5} />
                  )}
                  <Text style={styles.viewEditBtnText}>
                    {editStore.isSaving ? 'Saving…' : 'Save'}
                  </Text>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity
                  style={[styles.viewBtn, styles.viewEditBtn]}
                  onPress={() => {
                    if (
                      (routeId || fromSessionId) &&
                      getFlagsSync().editModeEnabled
                    ) {
                      enterDualEdit();
                    } else {
                      setEditMode(true);
                    }
                  }}
                  activeOpacity={0.85}
                  disabled={dualEditLoading}
                >
                  {dualEditLoading ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <Icon name="Pencil" size={16} color="#fff" strokeWidth={2.5} />
                  )}
                  <Text style={styles.viewEditBtnText}>
                    {dualEditLoading ? 'Loading…' : 'Edit'}
                  </Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity
                style={[styles.viewBtn, styles.viewDeleteBtn]}
                onPress={() => {
                  // v200 edit-mode: Cancel = discard edits with
                  // double-confirm, return to view-mode (route still
                  // there). Mirrors the in-edit Cancel button that
                  // existed on the dual-edit top toolbar.
                  if (dualEditActive) {
                    Alert.alert(
                      'Discard edits?',
                      'Your changes will be lost.',
                      [
                        { text: 'Keep editing', style: 'cancel' },
                        {
                          text: 'Discard',
                          style: 'destructive',
                          onPress: () => exitDualEdit('cancel'),
                        },
                      ],
                    );
                    return;
                  }
                  // v200 view-mode save-as-route: Cancel = discard the
                  // unsaved draft, pop back to Activity. Two sub-cases:
                  //   (a) routeId not yet minted (user never tapped Edit)
                  //   (b) routeId is the just-created backend route from
                  //       enterDualEdit (Edit→Save was never confirmed)
                  // Both = unconfirmed save, both = delete + goBack.
                  const isFreshlyCreated =
                    !!freshlyCreatedRouteId && routeId === freshlyCreatedRouteId;
                  if ((fromSessionId && !routeId) || isFreshlyCreated) {
                    Alert.alert(
                      'Discard route?',
                      'This route was not saved. Are you sure you want to discard it?',
                      [
                        { text: 'Keep', style: 'cancel' },
                        {
                          text: 'Discard',
                          style: 'destructive',
                          onPress: () => {
                            // Cleanup: if we created a backend route as
                            // part of the Edit flow, delete it now.
                            // v204 fix C-NEW-1: clear ref synchronously
                            // so unmount cleanup doesn't double-delete.
                            if (isFreshlyCreated && freshlyCreatedRouteId) {
                              deleteRoute(freshlyCreatedRouteId).catch(() => {});
                              setFreshlyCreatedRouteId(null);
                              freshlyCreatedRouteIdRef.current = null;
                            }
                            nav.goBack();
                          },
                        },
                      ],
                    );
                    return;
                  }
                  if (!routeId) return;
                  Alert.alert(
                    'Delete route?',
                    `"${existingRoute?.name ?? 'This route'}" will be removed. Source activity stays.`,
                    [
                      { text: 'Cancel', style: 'cancel' },
                      {
                        text: 'Delete',
                        style: 'destructive',
                        onPress: () => {
                          deleteRoute(routeId);
                          nav.goBack();
                        },
                      },
                    ],
                  );
                }}
                activeOpacity={0.85}
              >
                <Icon
                  name={
                    dualEditActive
                      ? 'X'
                      : (fromSessionId && !routeId) ||
                        (!!freshlyCreatedRouteId && routeId === freshlyCreatedRouteId)
                        ? 'X'
                        : 'Trash2'
                  }
                  size={16}
                  color={Colors.danger}
                  strokeWidth={2.5}
                />
                <Text style={styles.viewDeleteBtnText}>
                  {dualEditActive
                    ? 'Cancel'
                    : (fromSessionId && !routeId) ||
                      (!!freshlyCreatedRouteId && routeId === freshlyCreatedRouteId)
                      ? 'Cancel'
                      : 'Delete'}
                </Text>
              </TouchableOpacity>
            </View>
          </>
        ) : (
        <>
        {/* Route name */}
        <TextInput
          style={styles.nameInput}
          placeholder="Route name (required)"
          placeholderTextColor={Colors.textMuted}
          value={name}
          onChangeText={setName}
        />

        {/* Stats row */}
        <View style={styles.statsRow}>
          <Text style={styles.statText}>{displayedStats.pointCount} points</Text>
          <Text style={styles.statText}>{formatDistance(displayedStats.distanceM, 'km', 1)} km</Text>
        </View>

        {/* Search toggle */}
        {showSearch ? (
          <View style={styles.searchBox}>
            <TextInput
              style={styles.searchInput}
              placeholder="Search destination..."
              placeholderTextColor={Colors.textMuted}
              value={searchQuery}
              onChangeText={setSearchQuery}
              onSubmitEditing={handleSearch}
              autoFocus
            />
            <TouchableOpacity style={styles.searchBtn} onPress={handleSearch}>
              <Icon name="Search" size={16} color="#fff" strokeWidth={2} />
            </TouchableOpacity>
          </View>
        ) : null}

        {/* Search results */}
        {searchResults.length > 0 && (
          <FlatList
            data={searchResults}
            keyExtractor={(_, i) => String(i)}
            style={styles.searchResults}
            renderItem={({ item }) => (
              <TouchableOpacity style={styles.searchResultItem} onPress={() => handleSelectSearchResult(item)}>
                <Icon name="MapPin" size={14} color={Colors.primary} strokeWidth={2} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.searchResultText} numberOfLines={1}>{item.name}</Text>
                  {item.subtitle && (
                    <Text style={styles.searchResultSubtitle} numberOfLines={1}>{item.subtitle}</Text>
                  )}
                </View>
              </TouchableOpacity>
            )}
          />
        )}

        {/* Tool buttons — hidden in save-as-route draft mode (v198 fix-6).
            Search/Undo/Clear apply to user-placed waypoints; for an
            activity-derived draft the polyline is fixed (no edits to
            undo/clear) and search would let the user accidentally
            navigate away from the recorded route. */}
        {!fromSessionId && (
          <View style={styles.toolRow}>
            <TouchableOpacity style={styles.toolBtn} onPress={() => setShowSearch(!showSearch)}>
              <Icon name="Search" size={18} color={Colors.primary} strokeWidth={2} />
              <Text style={styles.toolBtnText}>Search</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.toolBtn} onPress={handleUndo} disabled={waypoints.length === 0}>
              <Icon name="Undo2" size={18} color={waypoints.length > 0 ? Colors.primary : Colors.textMuted} strokeWidth={2} />
              <Text style={[styles.toolBtnText, waypoints.length === 0 && { color: Colors.textMuted }]}>Undo</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.toolBtn} onPress={handleClear} disabled={waypoints.length === 0}>
              <Icon name="Trash2" size={18} color={waypoints.length > 0 ? Colors.danger : Colors.textMuted} strokeWidth={2} />
              <Text style={[styles.toolBtnText, { color: waypoints.length > 0 ? Colors.danger : Colors.textMuted }]}>Clear</Text>
            </TouchableOpacity>
          </View>
        )}
        </>
        )}
      </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.primaryBg },
  mapArea: { flex: 1 },
  mapFallback: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.sm },
  mapFallbackText: { fontSize: FontSize.h3, fontWeight: '600', color: Colors.textPrimary },
  mapFallbackSub: { fontSize: FontSize.body, color: Colors.textSecondary, textAlign: 'center' },
  waypointDot: {
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: '#fff', ...Shadow.card,
  },
  waypointDotText: { fontSize: 11, fontWeight: '800', color: '#fff' },
  // User location pin — outer translucent ring + inner solid blue dot,
  // matches the iOS "Find My" / Mapbox UserLocationComponent visual
  // language. White center ring separates the dot from the map at any
  // basemap colour.
  userPinOuter: {
    width: 22, height: 22, borderRadius: 11,
    backgroundColor: 'rgba(58,134,237,0.25)',
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: '#fff',
  },
  userPinInner: {
    width: 12, height: 12, borderRadius: 6,
    backgroundColor: '#3a86ed',
  },

  topOverlay: { position: 'absolute', top: 0, left: 0, right: 0 },
  topRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: Spacing.base, paddingTop: Spacing.lg,
  },
  saveTopBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: Colors.primary, borderRadius: Radius.pill,
    paddingHorizontal: Spacing.md, paddingVertical: 8,
  },
  saveTopBtnText: { fontSize: FontSize.small, fontWeight: '700', color: '#fff' },
  // v200 Phase 6: zoom hint pill — small dark chip in the top-center
  // of the map, only visible while the user is too zoomed out to see
  // editable node dots. Non-interactive; auto-hides on zoom-in.
  zoomHint: {
    position: 'absolute',
    top: 100,
    alignSelf: 'center',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    borderRadius: Radius.pill,
    backgroundColor: 'rgba(0,0,0,0.72)',
  },
  zoomHintText: {
    color: '#FFFFFF',
    fontSize: FontSize.small,
    fontWeight: '600',
  },
  dualEditErrorBar: {
    position: 'absolute',
    top: 100,
    left: 16,
    right: 16,
    backgroundColor: Colors.danger,
    borderRadius: Radius.card,
    paddingVertical: 10,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    ...Shadow.elevated,
  },
  dualEditErrorText: {
    flex: 1,
    color: '#fff',
    fontSize: FontSize.small,
    fontWeight: '600',
  },
  dualEditErrorDismiss: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.15)',
  },
  // v122 fix #8: delete button on the route editor top bar (only
  // shown when editing an existing route).
  deleteTopBtn: {
    width: 36, height: 36, borderRadius: 18,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: Colors.surface,
    borderWidth: 1, borderColor: Colors.border,
  },
  // v123 fix #8: read-only summary card shown when in VIEW mode (route
  // detail). User taps Edit in the top bar to switch to the editing UI.
  viewSummary: {
    backgroundColor: Colors.primaryBg,
    padding: Spacing.md,
    borderRadius: Radius.card,
    gap: 4,
    marginBottom: Spacing.sm,
  },
  viewSummaryName: {
    fontSize: FontSize.h3,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  viewSummaryHint: {
    fontSize: FontSize.small,
    color: Colors.textSecondary,
  },
  // v124 fix #8: stats row inline with the route name (single block).
  viewStatsInline: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 2,
  },
  viewStatText: {
    fontSize: FontSize.small,
    color: Colors.textSecondary,
  },
  viewStatDot: {
    fontSize: FontSize.small,
    color: Colors.textMuted,
  },
  // v124 fix #8: Edit + Delete buttons in the VIEW-mode bottom panel.
  // Equal-width siblings, matches Activity detail's two-button row.
  viewActions: {
    flexDirection: 'row',
    gap: Spacing.sm,
    marginTop: Spacing.sm,
  },
  viewBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
    borderRadius: Radius.button,
  },
  viewEditBtn: {
    backgroundColor: Colors.primary,
  },
  viewEditBtnText: {
    color: '#fff',
    fontSize: FontSize.body,
    fontWeight: '700',
  },
  viewDeleteBtn: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.danger,
  },
  viewDeleteBtnText: {
    color: Colors.danger,
    fontSize: FontSize.body,
    fontWeight: '700',
  },

  // KeyboardAvoidingView wrapper sits at the bottom of the screen and
  // pushes its child up when the keyboard appears.
  bottomPanelWrap: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
  },
  bottomPanel: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 20, borderTopRightRadius: 20,
    padding: Spacing.base, paddingTop: Spacing.md,
    ...Shadow.overlay,
  },
  errorBanner: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    backgroundColor: Colors.dangerBg ?? '#fde8ea', borderRadius: Radius.button,
    paddingHorizontal: Spacing.md, paddingVertical: 8,
    marginBottom: Spacing.sm,
    borderWidth: 1, borderColor: Colors.danger ?? '#c53d2e',
  },
  errorText: { fontSize: FontSize.small, color: Colors.danger ?? '#c53d2e', fontWeight: '600', flex: 1 },
  // Yellow caution banner used when snap-to-road fell back to raw GPS.
  // Same shape as errorBanner but caution palette so users read it as
  // "heads up" not "error".
  snapWarnBanner: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    backgroundColor: Colors.severityWarningBg ?? '#fef3e2', borderRadius: Radius.button,
    paddingHorizontal: Spacing.md, paddingVertical: 8,
    marginBottom: Spacing.sm,
    borderWidth: 1, borderColor: Colors.severityCaution ?? '#f59e0b',
  },
  snapWarnText: { fontSize: FontSize.small, color: Colors.severityCaution ?? '#b36b00', fontWeight: '600', flex: 1 },
  nameInput: {
    backgroundColor: Colors.bg, borderRadius: Radius.button,
    padding: Spacing.md, fontSize: FontSize.body, color: Colors.textPrimary,
    borderWidth: 1, borderColor: Colors.border, marginBottom: Spacing.sm,
  },
  statsRow: {
    flexDirection: 'row', justifyContent: 'space-between',
    marginBottom: Spacing.sm,
  },
  statText: { fontSize: FontSize.small, fontWeight: '600', color: Colors.textSecondary },

  searchBox: { flexDirection: 'row', gap: Spacing.sm, marginBottom: Spacing.sm },
  searchInput: {
    flex: 1, backgroundColor: Colors.bg, borderRadius: Radius.button,
    padding: Spacing.sm, fontSize: FontSize.body, color: Colors.textPrimary,
    borderWidth: 1, borderColor: Colors.border,
  },
  searchBtn: {
    width: 40, height: 40, borderRadius: 10,
    backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center',
  },
  searchResults: { maxHeight: 150, marginBottom: Spacing.sm },
  searchResultItem: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    paddingVertical: 8, paddingHorizontal: Spacing.sm,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  searchResultText: { fontSize: FontSize.small, color: Colors.textPrimary, fontWeight: '500' },
  searchResultSubtitle: { fontSize: FontSize.caption, color: Colors.textSecondary, marginTop: 1 },

  toolRow: { flexDirection: 'row', gap: Spacing.sm },
  toolBtn: {
    flex: 1, alignItems: 'center', gap: 4, paddingVertical: Spacing.sm,
    borderRadius: Radius.card, backgroundColor: Colors.surface,
    borderWidth: 1, borderColor: Colors.border,
  },
  toolBtnText: { fontSize: FontSize.small, fontWeight: '600', color: Colors.primary },
});
