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
import { EditCoachmark, ApproximateWarningBar } from '../components/map/EditCoachmark';
import { getFlagsSync } from '../config/featureFlags';
import { buildEditContext } from '../services/routing/editContext';
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
  // v123 fix #8: when entering with an existing routeId we open in
  // VIEW mode by default — a read-only display of the cloned trace
  // with Edit + Delete CTAs. User must tap Edit to enter the editing
  // surface (waypoint drag, snap-to-road, save). New routes (no
  // routeId) jump straight into edit mode.
  const [editMode, setEditMode] = useState<boolean>(!routeId);
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
  const dualEditCameraFit = useMemo(() => {
    if (!dualEditActive) return null;
    const wp = editStore.workingPoints;
    if (wp.length < 2) return null;
    let minLng = Infinity, maxLng = -Infinity;
    let minLat = Infinity, maxLat = -Infinity;
    for (const p of wp) {
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
    // Use the larger of the two real-world spans. Add a 1.4x padding
    // factor so handles + UI chrome are not flush against the viewport
    // edge.
    const spanM = Math.max(lngSpanM, latSpanM) * 1.4;
    // Zoom heuristic mapped to meters of horizontal extent visible at
    // typical phone viewport (~360px wide, ~720px tall).
    let zoom = 14;
    if (spanM > 50000) zoom = 9;        // > 50km
    else if (spanM > 10000) zoom = 11;  // > 10km
    else if (spanM > 5000) zoom = 12;   // > 5km
    else if (spanM > 1500) zoom = 13;   // > 1.5km
    else if (spanM > 700) zoom = 14;    // > 700m
    else if (spanM > 300) zoom = 15;    // > 300m
    else zoom = 16;                      // <= 300m
    return { center, zoom };
    // Deps: only recompute when entering/leaving dual-edit OR routeId
    // changes. workingPoints is intentionally NOT a dep — see comment.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dualEditActive, routeId]);

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
    if (!routeId || !existingRoute) return;
    if (!getFlagsSync().editModeEnabled) {
      setDualEditError('Edit mode is currently disabled.');
      return;
    }
    // v30-fix (functional Blocker — Scenario 25) + v31-fix (Medium
    // Scenario 16): if existingRoute.points hasn't hydrated yet, kick
    // off hydration AND wait inline (with a 5s timeout) so the user
    // sees the spinner on the Edit button instead of a confusing
    // bounce-back-with-error UX. Without inline await, beginEdit would
    // get routePoints:[] and migration would fail on empty input.
    // v31-fix (Critical X1): set dualEditLoading=true BEFORE the await
    // so the Edit button shows the spinner during hydration.
    if (dualEditLoading) return;
    if (!existingRoute.points || existingRoute.points.length < 2) {
      setDualEditLoading(true);
      setDualEditError(null);
      try {
        await loadRouteDetail(routeId);
        // Wait up to 5s for the store to reflect the hydrated points.
        const deadline = Date.now() + 5000;
        while (Date.now() < deadline) {
          const live = useRouteStore.getState().routes.find(r => r.id === routeId);
          if (live && live.points && live.points.length >= 2) break;
          await new Promise(r => setTimeout(r, 100));
        }
        const live = useRouteStore.getState().routes.find(r => r.id === routeId);
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
    const liveRoute = useRouteStore.getState().routes.find(r => r.id === routeId);
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
      const preExtras = await loadExtrasFn(routeId);
      let ctx;
      if (preExtras && preExtras.originalPoints && preExtras.originalPoints.length >= 2) {
        // Non-legacy path: build context first.
        ctx = await buildEditContext(routeId);
        if (!ctx) {
          setDualEditError(
            'Cannot edit this route — original GPS data is missing. Try recording it again.',
          );
          return;
        }
        await useRouteEditStore.getState().beginEdit({
          routeId,
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
          routeId,
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
        // Migration succeeded — extras now exists. Build context and
        // inject walkedIndex/trailGraph so corridor enforcement is live.
        ctx = await buildEditContext(routeId);
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
  }, [routeId, existingRoute, dualEditLoading, loadRouteDetail]);

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
        // Don't navigate — return to the view-mode editor screen so the
        // user can re-enter or discard the route.
      }
    },
    [dualEditActive, routeId, nav, updateRoute],
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
      loadTrackPoints(session.id).then(async tp => {
        if (tp.length < 2) return;
        const profile = session.activityMode === 'running' ? 'walking' : 'walking';
        const matched = await snapToRoadAndTrim(
          tp.map(p => ({ lat: p.lat, lng: p.lng })),
          profile,
        );
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

  const handleSave = () => {
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
        updateRoute(routeId, routeData);
      } else {
        addRoute(routeData);
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      // Pop back to whatever pushed us here (Routes or MapHistory).
      // Using goBack() instead of navigate('Routes') prevents stack leak —
      // navigate() would push a new Routes instance, leaving RouteEditor on the stack.
      nav.goBack();
    } catch (e: any) {
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
            style={StyleSheet.absoluteFillObject}
            styleURL="mapbox://styles/mapbox/outdoors-v12"
            logoEnabled={false}
            attributionEnabled={false}
            scaleBarEnabled={false}
            compassEnabled={false}
            onPress={(e: any) => {
              // Sprint 66: when dual-edit is active, map taps belong to
              // the edit overlay (drag handles + line), not to the
              // create-route waypoint flow. Suppress the tap-to-add.
              if (dualEditActive) return;
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
                    centerCoordinate={dualEditCameraFit.center}
                    zoomLevel={dualEditCameraFit.zoom}
                    animationDuration={300}
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
            {dualEditActive && editHandles && (
              <>
                <DraggableHandle
                  id="edit-handle-trim-start"
                  coordinate={editHandles.first}
                  kind="trim-start"
                  onDragEnd={newCoord => {
                    // Map drag-end coord back to the closest point index
                    // on workingPoints; trim everything before that index.
                    // We use haversine distance to find nearest.
                    const wp = useRouteEditStore.getState().workingPoints;
                    let bestIdx = 0;
                    let bestD = Infinity;
                    for (let i = 0; i < wp.length; i++) {
                      const d = haversineM(
                        { lat: newCoord.lat, lng: newCoord.lng },
                        { lat: wp[i].lat, lng: wp[i].lng },
                      );
                      if (d < bestD) {
                        bestD = d;
                        bestIdx = i;
                      }
                    }
                    // v30-fix (Critical Scenario 5 + Medium Scenario 4):
                    // surface user feedback for out-of-range drags.
                    // v32-fix (B2/M4): route through setLastError so the
                    // editOpSeq invariant is preserved.
                    if (bestIdx <= 0 || bestIdx >= wp.length - 1) {
                      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
                      useRouteEditStore
                        .getState()
                        .setLastError('Cannot trim past the route endpoints.');
                      return;
                    }
                    const r = useRouteEditStore.getState().trimStart(bestIdx);
                    if (!r.ok) {
                      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
                    } else {
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    }
                  }}
                />
                <DraggableHandle
                  id="edit-handle-trim-end"
                  coordinate={editHandles.last}
                  kind="trim-end"
                  onDragEnd={newCoord => {
                    const wp = useRouteEditStore.getState().workingPoints;
                    let bestIdx = wp.length - 1;
                    let bestD = Infinity;
                    for (let i = 0; i < wp.length; i++) {
                      const d = haversineM(
                        { lat: newCoord.lat, lng: newCoord.lng },
                        { lat: wp[i].lat, lng: wp[i].lng },
                      );
                      if (d < bestD) {
                        bestD = d;
                        bestIdx = i;
                      }
                    }
                    if (bestIdx <= 0 || bestIdx >= wp.length - 1) {
                      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
                      useRouteEditStore
                        .getState()
                        .setLastError('Cannot trim past the route endpoints.');
                      return;
                    }
                    const r = useRouteEditStore.getState().trimEnd(bestIdx);
                    if (!r.ok) {
                      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
                    } else {
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    }
                  }}
                />
                {editStore.workingPoints.length >= 3 && (
                  <DraggableHandle
                    id="edit-handle-midpoint"
                    coordinate={editHandles.mid}
                    kind="midpoint"
                    onDragEnd={async newCoord => {
                      const idx = editHandles.midIdx;
                      useRouteEditStore.getState().proposeMidpointDrag(idx, {
                        lng: newCoord.lng,
                        lat: newCoord.lat,
                      });
                      const r = await useRouteEditStore
                        .getState()
                        .commitMidpointDrag();
                      if (!r.ok) {
                        Haptics.notificationAsync(
                          Haptics.NotificationFeedbackType.Warning,
                        );
                      } else {
                        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                      }
                    }}
                  />
                )}
              </>
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
          {dualEditActive && (
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <TouchableOpacity
                style={[styles.saveTopBtn, { backgroundColor: '#6B7280' }]}
                onPress={() => {
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
                }}
              >
                <Icon name="X" size={16} color="#fff" strokeWidth={2.5} />
                <Text style={styles.saveTopBtnText}>Cancel</Text>
              </TouchableOpacity>
              {/* v31-fix (Medium Scenario 12): Reset button gives the
                  user a recovery path when extreme trim collapses the
                  route to <2 points or zero length. Without this, save
                  is refused and there's no way out except Cancel→Discard
                  (which loses ALL edits, not just the bad trim). */}
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
              <TouchableOpacity
                style={styles.saveTopBtn}
                onPress={() => exitDualEdit('save')}
                disabled={editStore.isSaving}
              >
                {editStore.isSaving ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Icon name="Check" size={16} color="#fff" strokeWidth={2.5} />
                )}
                <Text style={styles.saveTopBtnText}>
                  {editStore.isSaving ? 'Saving…' : 'Save'}
                </Text>
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
                <Text style={styles.viewStatText}>{waypoints.length} waypoints</Text>
                <Text style={styles.viewStatDot}>·</Text>
                <Text style={styles.viewStatText}>{formatDistance(totalDistanceM, 'km', 1)} km</Text>
              </View>
            </View>
            {/* v124 fix #8: Edit + Delete moved into the bottom panel.
                Matches Activity detail's [Save as Route, Delete] row
                (Edit-on-left, Delete-on-right consistency rule). */}
            <View style={styles.viewActions}>
              <TouchableOpacity
                style={[styles.viewBtn, styles.viewEditBtn]}
                onPress={() => {
                  // Sprint 66: when editModeEnabled flag is on AND we have
                  // an existing route, the "Edit" CTA enters the dual-source
                  // edit surface (DualLineLayer + handles). When off, fall
                  // back to the legacy waypoint editor (setEditMode(true)).
                  if (
                    routeId &&
                    existingRoute &&
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
              <TouchableOpacity
                style={[styles.viewBtn, styles.viewDeleteBtn]}
                onPress={() => {
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
                <Icon name="Trash2" size={16} color={Colors.danger} strokeWidth={2.5} />
                <Text style={styles.viewDeleteBtnText}>Delete</Text>
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
          <Text style={styles.statText}>{waypoints.length} waypoints</Text>
          <Text style={styles.statText}>{formatDistance(totalDistanceM, 'km', 1)} km</Text>
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

        {/* Tool buttons */}
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
