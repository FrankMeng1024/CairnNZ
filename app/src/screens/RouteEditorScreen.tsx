/**
 * RouteEditorScreen — view + edit a saved route, or create a new one from
 * an Activity (save-as-route flow).
 *
 * Sprint 67 v236 rewrite. Replaces the v229–v235 1900-line stack:
 *   - DELETED: EditableNodeLayer, DraggableHandle, EditCoachmark,
 *     EditableJunction anchor selection, midpoint-drag/straight-confirm
 *     modal logic, buildEditContext, computeRouteNodeAnchors,
 *     candidateNodes, waitForTilesOrTimeout, mapTilesReadyRef,
 *     dualEditCameraFit memo (kept simpler version), trailGraph/walkedIndex
 *     setState injection.
 *   - NEW: EditOverlayV236 (top-bar + trim slider + reset),
 *     ViaPointLayer (blue dots, draggable), long-press map → addVia,
 *     useRouteEditStore via-point + trim model.
 *
 * Three entry modes:
 *   1. existing route (route.params.routeId)
 *   2. new from activity (route.params.fromSessionId)
 *   3. blank create (no params; legacy waypoint mode — kept minimal)
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput, Platform,
  KeyboardAvoidingView, ActivityIndicator, BackHandler,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute, CommonActions } from '@react-navigation/native';
import { useRouteStore } from '../store/useRouteStore';
import { useRouteEditStore } from '../store/useRouteEditStore';
import { useSessionStore, loadTrackPoints } from '../store/useSessionStore';
import { useTrackingStore } from '../store/useTrackingStore';
import { snapToRoadAndTrim } from '../services/routeMatcher';
import { useDistance } from '../utils/distanceFormat';
import { getCurrentRegion } from '../config/regions';
import { Colors, Spacing, Radius, FontSize, Shadow } from '../components/tokens';
import { Icon } from '../components/Icon';
import { BackButton } from '../components/BackButton';
import { DualLineLayer } from '../components/map/DualLineLayer';
import { BrushOverlay, reportBrushOverlayCamera } from '../components/map/BrushOverlay';
import { BrushStrokeLayer } from '../components/map/BrushStrokeLayer';
import { EditOverlayV274 } from '../components/map/EditOverlayV274';
import { getFlagsSync } from '../config/featureFlags';
import { polylineLengthM } from '../services/routing/corridor/PolylineSampler';
import { debugLogger } from '../services/debugLogger';
import { telemetryUploader } from '../services/telemetryUploader';
import { useSettingsStore } from '../store/useSettingsStore';
import { activitySimulatorBuildCapable } from '../features/activitySimulator/capability';
import { useVisualTheme } from '../hooks/useVisualTheme';
import { routeMatchesIdentity } from '../features/route/routeContracts';
import {
  createRouteEditorSaveCoordinator,
  executeRouteEditorLeaveChoice,
  routeEditorLeaveDecision,
} from '../features/route/routeEditorSaveCoordinator';
import { useMapTheme } from '../hooks/useMapTheme';
import { getMapStyleForTheme, themeToStandardPreset, buildStandardConfig } from '../config/mapbox';
import { MapLoadOverlay, type MapLoadState } from '../components/MapLoadOverlay';
import { ModalCard, ModalCardHeader } from '../components/ModalCard';
import { PrimaryButton } from '../components/PrimaryButton';
import { planWalkingRoute, WalkingPlanError } from '../services/routing/planWalkingRoute';

// Conditional Mapbox import — same pattern as RoutesScreen.
let MapView: any = null;
let CameraComponent: any = null;
let LineLayer: any = null;
let ShapeSource: any = null;
let CircleLayer: any = null;
// v6.3 plan §2.3: optional Terrain DEM components. Older @rnmapbox/maps
// builds may not export them — guarded `?? null` keeps the screen working.
let RasterDemSource: any = null;
let TerrainComponent: any = null;
let StyleImport: any = null;
if (Platform.OS !== 'web') {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Mapbox = require('@rnmapbox/maps');
    MapView = Mapbox.MapView;
    CameraComponent = Mapbox.Camera;
    LineLayer = Mapbox.LineLayer;
    ShapeSource = Mapbox.ShapeSource;
    CircleLayer = Mapbox.CircleLayer;
    RasterDemSource = Mapbox.RasterDemSource ?? null;
    TerrainComponent = Mapbox.Terrain ?? null;
    StyleImport = Mapbox.StyleImport ?? null;
  } catch {
    // Not available — fallback panel renders.
  }
}

const SAVE_FRACTION_FLAG = 'editModeEnabled';

export function RouteEditorScreen() {
  const visualTheme = useVisualTheme();
  const editorMapTheme = useMapTheme();
  const editorResolvedMapStyle = getMapStyleForTheme('outdoors', editorMapTheme);
  const editorLightPreset = themeToStandardPreset(editorMapTheme);
  const nav = useNavigation();
  const insets = useSafeAreaInsets();
  const route = useRoute<any>();
  const routeId = route.params?.routeId as string | undefined;
  const fromSessionId = route.params?.fromSessionId as string | undefined;
  const reconnectsActivityGap = route.params?.reconnectsActivityGap === true;
  const fromSessionTrackPoints = route.params?.fromSessionTrackPoints as
    | Array<{ lat: number; lng: number; alt?: number | null; t?: number; accuracy?: number | null }> | undefined;
  // O12: settings-aware distance format.
  const dist = useDistance();
  const debugMode = useSettingsStore(s => s.debugMode);
  const qaToolsAvailable = activitySimulatorBuildCapable
    || (typeof __DEV__ !== 'undefined' && __DEV__);

  const addRoute = useRouteStore(s => s.addRoute);
  const updateRoute = useRouteStore(s => s.updateRoute);
  const deleteRoute = useRouteStore(s => s.deleteRoute);
  const loadRouteDetail = useRouteStore(s => s.loadRouteDetail);
  const routeDetailState = useRouteStore(s => routeId ? (s.routeDetailState[routeId] ?? 'idle') : 'idle');
  const existingRoute = useRouteStore(s => routeId
    ? s.routes.find(item => routeMatchesIdentity(item, routeId))
    : undefined);
  const session = useSessionStore(s => fromSessionId ? s.sessions.find(x => x.id === fromSessionId) : null);

  const [name, setName] = useState('');
  const [snapWarning, setSnapWarning] = useState(false);
  const [sessionTrackPoints, setSessionTrackPoints] = useState<
    Array<{ lat: number; lng: number; alt?: number | null }>
  >([]);
  const [editMode, setEditMode] = useState(false);
  const [enterEditLoading, setEnterEditLoading] = useState(false);
  const [enterEditError, setEnterEditError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [mapReady, setMapReady] = useState(false);
  const [mapLoadState, setMapLoadState] = useState<MapLoadState>('loading');
  const [mapEpoch, setMapEpoch] = useState(0);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [discardEditOpen, setDiscardEditOpen] = useState(false);
  const [leavePrompt, setLeavePrompt] = useState<{
    decision: 'confirm-saving' | 'confirm-discard';
    action: any;
  } | null>(null);
  const [destinationPickActive, setDestinationPickActive] = useState(false);
  const [destinationPlanning, setDestinationPlanning] = useState(false);
  const [destinationPoint, setDestinationPoint] = useState<{ lat: number; lng: number } | null>(null);
  const destinationAbortRef = useRef<AbortController | null>(null);
  const saveInFlightRef = useRef(false);
  const saveCoordinatorRef = useRef(createRouteEditorSaveCoordinator());
  const mountedRef = useRef(true);
  const saveObjectKeyRef = useRef('route-editor-unresolved');
  const deleteInFlightRef = useRef(false);
  const allowLeaveRef = useRef(false);
  const initialNameRef = useRef('');
  const initialPermissionRef = useRef<'personal' | 'friend'>('personal');
  const didHydrateBaselineRef = useRef(false);
  // Sprint 69 STORY-00535: route visibility toggle. Original default 'friend'.
  // 2026-08-16 concept: default changed to 'personal' ('Just me') per
  // RouteEditor-1.png — safer/more private default per Playwright QA finding.
  const [permission, setPermission] = useState<'personal' | 'friend'>('personal');

  const editIsOpen = useRouteEditStore(s => s.isOpen);
  const editRouteId = useRouteEditStore(s => s.routeId);
  const editWorkingPoints = useRouteEditStore(s => s.workingPoints);
  const editMatchedPoints = useRouteEditStore(s => s.matchedPoints);
  const editOriginalPoints = useRouteEditStore(s => s.originalPoints);
  const editBrushStrokes = useRouteEditStore(s => s.brushStrokes);
  const editTrimStartFrac = useRouteEditStore(s => s.trimStartFrac);
  const editTrimEndFrac = useRouteEditStore(s => s.trimEndFrac);
  const editActiveTool = useRouteEditStore(s => s.activeTool);
  const editWalkedIndex = useRouteEditStore(s => s.walkedIndex);
  const editPreviewIsCurrent = useRouteEditStore(s => s.previewIsCurrent);
  // v251: hasCommittedEdit stays true once user has Previewed at least
  // once. Used so the dashed original-GPS backdrop remains visible after
  // Preview empties brushStrokes (Preview = commit).
  const editHasCommittedEdit = useRouteEditStore(s => s.hasCommittedEdit);
  // v249: committedDraft drives the post-edit view-mode preview. When
  // present, view-mode renders this geometry; entering Edit again resumes
  // from this draft; the outer Save button persists it.
  const committedDraft = useRouteEditStore(s => s.committedDraft);
  // Effective id this screen is editing. Prefer the explicit routeId param,
  // else the transient draft id derived from fromSessionId. We do NOT
  // fall back to committedDraft.routeId here — a stale draft from a
  // previous session must not preempt the current screen's id, which
  // would cause editRouteId !== expectedId and break edit mode entry.
  const effectiveEditId = routeId ?? (fromSessionId ? `draft_${fromSessionId}` : null);
  const saveObjectKey = effectiveEditId ?? 'route-editor-new';
  saveObjectKeyRef.current = saveObjectKey;
  const dualEditActive = editIsOpen && editRouteId === effectiveEditId;
  // Show committedDraft in view-mode ONLY when it belongs to this screen.
  const draftForThisScreen = committedDraft && effectiveEditId && committedDraft.routeId === effectiveEditId
    ? committedDraft
    : null;

  // Subscribe to user GPS — used as the camera fallback when route data
  // hasn't hydrated yet, so MapView never falls back to Mapbox's global
  // default view (the "Ajaccio / Corsica" bug for Asian/NZ users).
  const userCoord = useTrackingStore(s => s.lastCoordinate);

  const cameraRef = useRef<any>(null);
  const mapViewRef = useRef<any>(null);

  useEffect(() => {
    if (mapReady || !MapView) return undefined;
    const timeout = setTimeout(() => setMapLoadState('slow'), 8000);
    return () => clearTimeout(timeout);
  }, [mapEpoch, mapReady]);

  useEffect(() => () => destinationAbortRef.current?.abort(), []);

  // Distance helper for BrushStrokeLayer color classification.
  // v249: bound kdbush.within search to 600m (corridor was 500m, v253
  // tightened to 200m, so 600m is now corridor + 400m buffer — generous
  // enough that any in-range point hits a candidate, while skipping
  // 10km-default scans that crushed perf during gesture).
  // instead of default 10km — every appendStrokePoint frame called this
  // for both endpoints of every segment, scanning a 10km candidate set
  // each time = main culprit of the "second stroke janky" bug.
  const distanceFromOriginal = useCallback((coord: { lng: number; lat: number }) => {
    if (!editWalkedIndex) return Infinity;
    const nearest = editWalkedIndex.nearest(coord.lng, coord.lat, 1, 600);
    if (nearest.length === 0) return Infinity;
    const np = editWalkedIndex.get(nearest[0]);
    if (!np) return Infinity;
    const R = 6_371_000;
    const toRad = (x: number) => (x * Math.PI) / 180;
    const dLat = toRad(np.lat - coord.lat);
    const dLng = toRad(np.lng - coord.lng);
    const lat1 = toRad(coord.lat);
    const lat2 = toRad(np.lat);
    const x =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(x));
  }, [editWalkedIndex]);

  // ── Init: fill name ONLY for an existing route. v249: save-as-route
  // flow no longer pre-fills with "Hike Jun 9" / "Run Jun 9" — PO wants
  // the user to think about the name and confirm before Save unlocks.
  useEffect(() => {
    if (existingRoute && !didHydrateBaselineRef.current) {
      setName(existingRoute.name);
      // Sprint 69 STORY-00535: hydrate visibility for edit. Default 'friend'
      // when the existing row has no permission field (legacy rows).
      if (existingRoute.permission === 'personal' || existingRoute.permission === 'friend') {
        setPermission(existingRoute.permission);
      }
      initialNameRef.current = existingRoute.name;
      initialPermissionRef.current = existingRoute.permission === 'friend' ? 'friend' : 'personal';
      didHydrateBaselineRef.current = true;
    }
  }, [existingRoute]);

  // ── Load route detail on mount
  useEffect(() => {
    if (routeId && (!existingRoute?.points || existingRoute.points.length === 0)) {
      loadRouteDetail(routeId).catch(() => {});
    }
  }, [routeId]);

  // ── Load session track points (save-as-route flow).
  // Snapshot the selected Final artifact revision exactly. Route editing may
  // subsequently change the new Route, but import never re-smooths or mutates
  // the source Activity representation.
  useEffect(() => {
    if (!fromSessionId) return;
    const sourcePromise: Promise<
      Array<{ lat: number; lng: number; alt?: number | null; accuracy?: number; t?: number }>
    > =
      fromSessionTrackPoints && fromSessionTrackPoints.length >= 2
        ? Promise.resolve(fromSessionTrackPoints.map((p: any) => ({
            lat: p.lat, lng: p.lng,
            alt: p.alt ?? null,
            accuracy: p.accuracy, t: p.t,
          })))
        : loadTrackPoints(fromSessionId).then(pts =>
            (pts ?? []).filter(p => Number.isFinite(p.lat) && Number.isFinite(p.lng))
              .map(p => ({
                lat: p.lat, lng: p.lng,
                alt: (p as any).alt ?? null,
                accuracy: (p as any).accuracy, t: (p as any).t,
              })),
          );
    sourcePromise
      .then((tp) => {
        if (tp.length < 2) {
          setSessionTrackPoints([]);
          setSnapWarning(true);
          return;
        }
        setSessionTrackPoints(tp.map(p => ({ lat: p.lat, lng: p.lng, alt: p.alt ?? null })));
      })
      .catch(() => {
        setSessionTrackPoints([]);
        setSnapWarning(true);
      });
  }, [fromSessionId, fromSessionTrackPoints]);

  // ── Detach edit UI on unmount while preserving the route-scoped draft.
  // committedDraft carries its own routeId and cannot pre-empt another Route;
  // clearing it here used to lose a failed or unresolved save when leaving.
  const dualEditActiveRef = useRef(dualEditActive);
  useEffect(() => { dualEditActiveRef.current = dualEditActive; }, [dualEditActive]);
  useEffect(() => {
    return () => {
      mountedRef.current = false;
      saveCoordinatorRef.current.suppressLateNavigation();
      if (dualEditActiveRef.current) {
        try { useRouteEditStore.getState().detachUI(); } catch {}
      }
    };
  }, []);

  // ── Debug logger session for the editor (v240).
  // Capture all edit operations to a debugLogger session so logs can be
  // uploaded to the server when the user exits the editor — same pattern
  // as tracking sessions, but with activity_mode=null (free / non-tracking).
  // Skips if a tracking session is already active (don't disturb it).
  useEffect(() => {
    if (!qaToolsAvailable || !debugMode) return;
    if (debugLogger.getCurrentSessionId()) {
      // A tracking session is active — leave it alone, our logs will
      // co-mingle into that session and upload with it.
      return;
    }
    try {
      debugLogger.startSession({ activity_mode: 'free' });
      debugLogger.log({ ts: Date.now(), event: 'breadcrumb', tag: 'route_editor_open' });
    } catch { /* swallow */ }
    return () => {
      try {
        debugLogger.log({ ts: Date.now(), event: 'breadcrumb', tag: 'route_editor_close' });
        debugLogger.endSession().then((endedId) => {
          if (endedId) {
            telemetryUploader.upload(endedId).catch(() => {});
          }
        }).catch(() => {});
      } catch { /* swallow */ }
    };
  }, [debugMode, qaToolsAvailable]);

  // ── Hardware back during edit → the same in-product discard card.
  useEffect(() => {
    if (!dualEditActive) return;
    if (Platform.OS !== 'android') return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      setDiscardEditOpen(true);
      return true;
    });
    return () => sub.remove();
  }, [dualEditActive]);

  // ── Camera fit
  const cameraBounds = useMemo(() => {
    const pts: Array<{ lat: number; lng: number }> = dualEditActive && editWorkingPoints.length >= 2
      ? editWorkingPoints
      : (draftForThisScreen?.workingPoints ?? existingRoute?.points ?? sessionTrackPoints);
    if (!pts || pts.length < 2) return null;
    let minLng = Infinity, maxLng = -Infinity, minLat = Infinity, maxLat = -Infinity;
    for (const p of pts) {
      if (p.lng < minLng) minLng = p.lng;
      if (p.lng > maxLng) maxLng = p.lng;
      if (p.lat < minLat) minLat = p.lat;
      if (p.lat > maxLat) maxLat = p.lat;
    }
    return {
      ne: [maxLng, maxLat] as [number, number],
      sw: [minLng, minLat] as [number, number],
    };
  }, [draftForThisScreen?.workingPoints, dualEditActive, editWorkingPoints, existingRoute?.points, sessionTrackPoints]);

  // v6.3 plan §2.3: backfill DEM altitudes onto matchedPoints whose `alt`
  // is null/undefined (Mapbox snap segments, partial-knowledge stitches).
  // Original GPS-sourced alt values are kept (the action protects them).
  // Retry policy: 200ms × 3 — DEM tiles may not be loaded immediately
  // after the camera moves. graceful: still-null → leave as null.
  useEffect(() => {
    if (!editIsOpen) return;
    if (!RasterDemSource || !TerrainComponent) return; // SDK lacks Terrain
    if (!editMatchedPoints || editMatchedPoints.length < 2) return;
    const targetIdxs: number[] = [];
    for (let i = 0; i < editMatchedPoints.length; i++) {
      if (editMatchedPoints[i].alt == null) targetIdxs.push(i);
    }
    if (targetIdxs.length === 0) return;
    let cancelled = false;
    (async () => {
      const view = mapViewRef.current;
      if (!view || typeof view.queryTerrainElevation !== 'function') return;
      const altitudes: Array<number | null> = editMatchedPoints.map(p =>
        typeof p.alt === 'number' ? p.alt : null,
      );
      // Up to 3 attempts, 200ms apart, only re-querying still-null indices.
      for (let attempt = 0; attempt < 3 && !cancelled; attempt++) {
        let stillNull = 0;
        for (const i of targetIdxs) {
          if (altitudes[i] != null) continue;
          try {
            const r = await view.queryTerrainElevation([
              editMatchedPoints[i].lng,
              editMatchedPoints[i].lat,
            ]);
            if (typeof r === 'number' && Number.isFinite(r)) {
              altitudes[i] = r;
            } else {
              stillNull += 1;
            }
          } catch {
            stillNull += 1;
          }
          if (cancelled) return;
        }
        if (stillNull === 0) break;
        if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 200));
      }
      if (cancelled) return;
      try {
        useRouteEditStore.getState().applyMatchedAltitudes(altitudes);
      } catch {
        /* applyMatchedAltitudes is best-effort; never throw to UI */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [editIsOpen, editMatchedPoints]);

  // ── Enter edit mode
  const enterEdit = useCallback(async () => {
    if (enterEditLoading) return;
    const flags = getFlagsSync();
    if (!flags[SAVE_FRACTION_FLAG]) {
      setEnterEditError('Edit mode is currently disabled.');
      return;
    }
    setEnterEditError(null);
    setEnterEditLoading(true);
    try {
      let effectiveRouteId: string | undefined = routeId;
      let basePoints: Array<{ lat: number; lng: number }> = [];

      // v249: Save-as-route flow — use a TRANSIENT id (no backend write).
      // The backend route is created lazily by view-mode Save once the
      // user has confirmed name + reviewed edit result. This removes the
      // v248 hack where Cancel had to deleteRoute the freshly-created
      // empty record.
      if (!effectiveRouteId) {
        if (!fromSessionId || sessionTrackPoints.length < 2) {
          setEnterEditError('Loading route data — please try again in a moment.');
          return;
        }
        effectiveRouteId = `draft_${fromSessionId}`;
        basePoints = sessionTrackPoints;
      } else {
        if (!existingRoute) {
          await loadRouteDetail(effectiveRouteId).catch(() => {});
        }
        const live = useRouteStore.getState().routes.find(r => r.id === effectiveRouteId);
        if (!live || !Array.isArray(live.points) || live.points.length < 2) {
          setEnterEditError('Route data unavailable — cannot edit.');
          return;
        }
        basePoints = live.points;
      }

      // v249: if committedDraft exists for this route, resume from it so
      // the user re-enters Edit and sees their previous strokes/trim.
      // We re-read from the store here (instead of using draftForThisScreen
      // closure) because the store could have changed since the screen rendered.
      const draft = useRouteEditStore.getState().committedDraft;
      const resumeFrom = (draft && draft.routeId === effectiveRouteId)
        ? {
            workingPoints: draft.workingPoints,
            brushStrokes: draft.brushStrokes,
            trimStartFrac: draft.trimStartFrac,
            trimEndFrac: draft.trimEndFrac,
            enteredAt: Date.now(),
          }
        : undefined;

      await useRouteEditStore.getState().beginEdit({
        routeId: effectiveRouteId,
        routePoints: basePoints,
        routeUpdatedAt: existingRoute?.updatedAt,
        resumeFrom,
      });

      const post = useRouteEditStore.getState();
      if (!post.isOpen) {
        setEnterEditError(post.lastError ?? 'Could not enter edit mode.');
      } else {
        setEditMode(true);
      }
    } catch (e: any) {
      setEnterEditError(e?.message ?? 'Failed to start edit.');
    } finally {
      setEnterEditLoading(false);
    }
  }, [routeId, fromSessionId, sessionTrackPoints, existingRoute, name, addRoute, loadRouteDetail, enterEditLoading, session]);

  // v274: flatten the flow — when arriving from Save-as-Route
  // (fromSessionId present, no routeId), auto-enter edit mode so the
  // user lands directly on the editing canvas instead of a view
  // screen with an "Edit" button.
  const autoEnterTriedRef = useRef(false);
  useEffect(() => {
    if (autoEnterTriedRef.current) return;
    if (routeId) return;                          // not Save-as-Route flow
    if (!fromSessionId) return;                    // no session backing
    if (editMode || enterEditLoading) return;     // already entering
    if (sessionTrackPoints.length < 2) return;     // session not loaded yet
    autoEnterTriedRef.current = true;
    enterEdit();
  }, [routeId, fromSessionId, sessionTrackPoints, editMode, enterEditLoading, enterEdit]);

  // ── Save / cancel handlers
  // v249: handlePostCancel removed — Cancel now stays in view-mode rather
  // than navigating back; the user can re-edit, change name, then Save.

  const handlePreview = useCallback(async () => {
    const r = await useRouteEditStore.getState().runPreview();
    if (!r.ok && r.error) {
      // Validation error already in store.lastError; nothing more to do.
    }
  }, []);

  // v274: "Beautify whole route" — runPreview when there are no
  // strokes is the same shape as Preview, just no detours: it returns
  // the original baseline through map-matching to clean up GPS noise.
  // Single source of truth so Preview / Beautify stay coherent.
  const handleBeautify = useCallback(async () => {
    const r = await useRouteEditStore.getState().runPreview();
    if (!r.ok && r.error) {
      // store.lastError already has the message
    }
  }, []);

  const handleCancelEdit = useCallback(() => {
    setDiscardEditOpen(true);
  }, []);

  // v249: Edit-mode "Save" — commits to in-memory draft, returns to
  // view-mode. Does NOT touch backend; the user must press the outer
  // Save button (with a non-empty name) to actually persist.
  const handleSave = useCallback(async () => {
    if (saving) return;
    const result = useRouteEditStore.getState().commitEditDraft();
    if (!result.ok) {
      // The edit overlay owns the route-store validation message. Do not
      // layer a system alert over the product editor.
      return;
    }
    setEditMode(false);
  }, [saving]);

  // v249: View-mode "Save" — persists the route to backend. Required
  // pre-condition: name.trim() !== ''. Uses committedDraft.workingPoints
  // if user has edited; otherwise falls back to sessionTrackPoints
  // (save-as-route untouched) or existingRoute.points (existing route).
  const handleViewSave = useCallback(async () => {
    if (saving || saveInFlightRef.current) return;
    setEnterEditError(null);
    const trimmed = name.trim();
    if (trimmed.length === 0) {
      setEnterEditError('Name this Route before saving.');
      return;
    }
    const saveToken = saveCoordinatorRef.current.begin(saveObjectKey);
    if (!saveToken) return;
    saveInFlightRef.current = true;
    setSaving(true);
    try {
      const liveSourceSession = fromSessionId
        ? useSessionStore.getState().sessions.find(item => item.id === fromSessionId)
        : null;
      if (fromSessionId && !liveSourceSession) {
        setEnterEditError('This Activity was deleted, so it cannot create a new Route.');
        return;
      }
      const draft = useRouteEditStore.getState().committedDraft;
      const targetId = routeId; // existing route id; null for save-as-route
      // Decide which polyline to persist.
      // v6.3 plan §2.2: alt is preserved end-to-end. draft.workingPoints carry
      // alt from the original GPS / DEM-backfilled Mapbox snap; falling back
      // to existingRoute or sessionTrackPoints, both of which now also carry alt.
      const finalPoints: Array<{ lat: number; lng: number; alt?: number | null }> =
        draft && draft.workingPoints.length >= 2
          ? draft.workingPoints
          : (existingRoute?.points ?? sessionTrackPoints);
      if (finalPoints.length < 2) {
        setEnterEditError('This Route does not have a path to save yet.');
        return;
      }
      const { haversineM } = await import('../utils/geo');
      let dist = 0;
      for (let i = 1; i < finalPoints.length; i++) {
        dist += haversineM(
          { lat: finalPoints[i - 1].lat, lng: finalPoints[i - 1].lng },
          { lat: finalPoints[i].lat, lng: finalPoints[i].lng },
        );
      }
      // v6.3 plan §2.5: recompute elevationGain from the final alt sequence.
      // Each consecutive positive delta contributes to gain; null/undefined
      // alt segments are skipped (cannot infer elevation across unknown gaps).
      let elevationGainM = 0;
      for (let i = 1; i < finalPoints.length; i++) {
        const a = finalPoints[i - 1].alt;
        const b = finalPoints[i].alt;
        if (typeof a === 'number' && typeof b === 'number' && Number.isFinite(a) && Number.isFinite(b)) {
          const d = b - a;
          if (d > 0) elevationGainM += d;
        }
      }

      let savedRouteId: string | undefined = targetId;
      if (targetId) {
        await updateRoute(targetId, {
          name: trimmed,
          points: finalPoints,
          distanceM: dist,
          // v6.3 plan §2.5: also persist recomputed elevation gain.
          elevationGainM,
          // Sprint 69 STORY-00535: persist updated visibility on edit.
          permission,
        }).catch((e: any) => {
          throw e;
        });
      } else {
        const createdId = await addRoute({
          name: trimmed,
          description: undefined,
          points: finalPoints,
          waypoints: [],
          distanceM: dist,
          // v6.3 plan §2.5: prefer the recomputed gain (reflects post-edit
          // geometry) over the raw session aggregate.
          elevationGainM: elevationGainM > 0 ? elevationGainM : (session?.elevationGainM ?? 0),
          // Sprint 69 STORY-00535: persist visibility tier picked in the UI.
          permission,
          activityMode: liveSourceSession?.activityMode,
        }, {
          clientActivityId: liveSourceSession?.clientActivityId
            ?? (liveSourceSession && !/^\d+$/.test(liveSourceSession.id) ? liveSourceSession.id : undefined),
          serverActivityId: liveSourceSession?.remoteId
            ?? liveSourceSession?.serverActivityId
            ?? (liveSourceSession && /^\d+$/.test(liveSourceSession.id) ? Number(liveSourceSession.id) : undefined),
          reconnectsActivityGap,
        });
        if (!createdId) {
          setEnterEditError('Cairn could not safely save this Route on this device. Your draft is still here.');
          return;
        }
        savedRouteId = createdId;
      }

      // Clear the in-memory draft and any open edit session.
      try { useRouteEditStore.getState().clearCommittedDraft(); } catch {}
      try { useRouteEditStore.getState().cancelEdit(); } catch {}
      if (saveCoordinatorRef.current.claimNavigation(saveToken, saveObjectKeyRef.current)) {
        allowLeaveRef.current = true;
        // A newly created future-intent object lands on the one canonical Route
        // Detail surface. RouteEditor remains the confirmation/draft step, not
        // an alternate post-create Detail product.
        if (!targetId && savedRouteId) {
          nav.dispatch(
            CommonActions.reset({
              index: 1,
              routes: [
                { name: 'Home' },
                { name: 'MapHistory', params: { routeId: savedRouteId } },
              ],
            }),
          );
        } else {
          // Editing an existing route — go back is already correct.
          nav.goBack();
        }
      }
    } catch (e: any) {
      // O18 VER-05: map known backend errors to human copy — do not lose
      // signal when the failure is permanent (rate limited, name conflict).
      const raw = String(e?.message ?? '').toLowerCase();
      let body: string;
      if (e?.code === 'SOURCE_ACTIVITY_NOT_FOUND') {
        body = 'This Activity was deleted or has not finished syncing, so it cannot create a Route.';
      } else if (raw.includes('rate') && raw.includes('limit')) {
        body = 'You are saving very quickly. Wait a moment and try again.';
      } else if (raw.includes('name') && (raw.includes('taken') || raw.includes('duplicate'))) {
        body = 'A route with this name already exists. Try a different name.';
      } else if (raw.includes('unauthor') || raw.includes('401')) {
        body = 'Your session expired. Sign in again and try saving.';
      } else if (e?.code === 'ROUTE_REQUEST_TIMEOUT' || e?.outcomeUnknown) {
        body = 'The save outcome is not confirmed. Your draft is still here; retry to reconcile it.';
      } else if (raw.includes('network') || raw.includes('fetch')) {
        body = 'Check your connection and try again.';
      } else {
        body = 'Something got lost between here and our server. Try again in a moment.';
      }
      if (mountedRef.current) {
        setEnterEditError(body);
      }
    } finally {
      saveCoordinatorRef.current.finish(saveToken);
      saveInFlightRef.current = false;
      if (mountedRef.current) setSaving(false);
    }
  }, [saving, name, routeId, fromSessionId, reconnectsActivityGap, existingRoute, sessionTrackPoints, session, addRoute, updateRoute, nav, saveObjectKey]);

  const handleDelete = useCallback(() => {
    if (!routeId) return;
    setDeleteError(null);
    setDeleteConfirmOpen(true);
  }, [routeId]);

  const confirmDelete = useCallback(async () => {
    if (!routeId || deleteInFlightRef.current) return;
    deleteInFlightRef.current = true;
    setDeleteError(null);
    try {
      await deleteRoute(routeId);
      setDeleteConfirmOpen(false);
      allowLeaveRef.current = true;
      nav.goBack();
    } catch {
      setDeleteError('The Route is still here. Check your connection and try again.');
    } finally {
      deleteInFlightRef.current = false;
    }
  }, [deleteRoute, nav, routeId]);

  const chooseDestination = useCallback(async (destination: { lat: number; lng: number }) => {
    if (routeId || fromSessionId || !userCoord || destinationPlanning) return;
    destinationAbortRef.current?.abort();
    const controller = new AbortController();
    destinationAbortRef.current = controller;
    setDestinationPlanning(true);
    setDestinationPoint(destination);
    setDestinationPickActive(false);
    setEnterEditError(null);
    try {
      const points = await planWalkingRoute(
        { lat: userCoord.lat, lng: userCoord.lng },
        destination,
        controller.signal,
      );
      if (controller.signal.aborted) return;
      setSessionTrackPoints(points);
      if (!name.trim()) setName('Walking Route');
    } catch (error) {
      if (controller.signal.aborted) return;
      const code = error instanceof WalkingPlanError ? error.code : 'NETWORK';
      setEnterEditError(code === 'NO_ROUTE'
        ? 'No walkable Route was found for that destination. Choose another place.'
        : code === 'NO_TOKEN'
          ? 'Route planning is unavailable in this build.'
          : 'Cairn could not plan that walk. Check your connection and try again.');
    } finally {
      if (destinationAbortRef.current === controller) destinationAbortRef.current = null;
      if (!controller.signal.aborted) setDestinationPlanning(false);
    }
  }, [destinationPlanning, fromSessionId, name, routeId, userCoord]);

  // v245: detour-point system removed. All edit gestures go through the
  // BrushOverlay (gesture-handler PanGesture) when activeTool ∈ {brush,
  // eraser}. Long-press on the map is a no-op.

  // ── Render
  const isEditing = editMode && dualEditActive;
  // v249: when user has committed an edit draft (edit-mode Save) FOR THIS
  // SCREEN, view-mode shows that geometry. draftForThisScreen is null for
  // a different route's draft, so unrelated routes render their own data.
  const draftPoints = draftForThisScreen?.workingPoints;
  const renderPoints: Array<{ lat: number; lng: number }> = isEditing
    ? editWorkingPoints
    : (draftPoints ?? existingRoute?.points ?? sessionTrackPoints);
  // v241 fix: original (faded) line shows the user's REAL recorded GPS
  // trace, not the matched polyline. Prior code passed matchedPoints
  // here, which made the original line "disappear" when a via was added
  // (matchedPoints became the new edited route, leaving nothing dim
  // behind it).
  const renderOriginal: Array<{ lat: number; lng: number }> = isEditing
    ? editOriginalPoints
    : [];
  const nameValid = name.trim().length > 0;
  const hasGeometryToSave = renderPoints.length >= 2;
  // v255: PO direction "进入 routes detail 没改不要让 save 灰掉".
  // Save is enabled whenever name is non-empty (PO option a — renaming
  // alone is a valid save reason). We do NOT gate on hasGeometryToSave
  // here because existingRoute.points may be lazy-loaded at mount time
  // (RouteStore lists return points=[], loadRouteDetail fills it
  // async). If the user taps Save before geometry arrives, handleViewSave
  // surfaces an alert. Disabled state only reflects "name empty" or
  // "save in flight", matching PO's expectation that Save should not
  // appear locked when nothing seems wrong.
  const canSaveView = nameValid && !saving;
  const hasUnsavedChanges = isEditing
    || Boolean(draftForThisScreen)
    || name.trim() !== initialNameRef.current.trim()
    || permission !== initialPermissionRef.current;

  useEffect(() => {
    const unsubscribe = (nav as any).addListener('beforeRemove', (event: any) => {
      const decision = routeEditorLeaveDecision({
        allowLeave: allowLeaveRef.current,
        hasUnsavedChanges,
        saving,
      });
      if (decision === 'allow') return;
      event.preventDefault();
      setLeavePrompt({ decision, action: event.data.action });
    });
    return unsubscribe;
  }, [hasUnsavedChanges, nav, saving]);

  // v251: stable segments + showOriginal so DualLineLayer (now memoed)
  // doesn't re-render on every appendStrokePoint frame. Deps avoid the
  // brushStrokes array reference itself — only the COUNT matters for
  // the source/isEdited/showOriginal flags below.
  // editHasCommittedEdit is included so the dashed-original backdrop
  // stays visible after Preview empties brushStrokes (PO request).
  const editIsModified = editHasCommittedEdit
    || editBrushStrokes.length > 0
    || editTrimStartFrac > 0 || editTrimEndFrac < 1;
  const editSegments = useMemo(() => [{
    startIdx: 0,
    endIdx: Math.max(0, renderPoints.length - 1),
    source: (editBrushStrokes.length > 0 || editHasCommittedEdit) ? ('mapbox' as const) : ('original' as const),
    isEdited: editIsModified,
    confidence: 'confident' as const,
  }], [renderPoints.length, editBrushStrokes.length, editHasCommittedEdit, editIsModified]);

  if (routeId && !existingRoute && (routeDetailState === 'not-found' || routeDetailState === 'error')) {
    return (
      <View style={[styles.container, styles.unavailable, { backgroundColor: visualTheme.background }]} testID="route-editor-unavailable">
        <View style={[styles.unavailableTop, { paddingTop: insets.top + 8 }]}>
          <BackButton variant="inline" onPress={() => nav.goBack()} />
        </View>
        <Icon name="Route" size={36} color={visualTheme.iconInactive} strokeWidth={1.6} />
        <Text style={[styles.unavailableTitle, { color: visualTheme.foreground }]}>Route unavailable</Text>
        <Text style={[styles.unavailableBody, { color: visualTheme.foregroundSecondary }]}>
          {routeDetailState === 'not-found'
            ? 'This Route may have been deleted or is not available to this account.'
            : 'The saved Route could not be loaded. Check your connection and try again.'}
        </Text>
        {routeDetailState === 'error' ? (
          <TouchableOpacity
            style={[styles.unavailableRetry, { backgroundColor: visualTheme.primary }]}
            onPress={() => { void loadRouteDetail(routeId); }}
          >
            <Text style={[styles.viewSaveBtnText, { color: visualTheme.onPrimary }]}>Try Again</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: visualTheme.background }]}>
      <View style={styles.mapArea}>
        {MapView ? (
          <MapView
            key={`route-editor-map-${mapEpoch}`}
            ref={mapViewRef}
            style={StyleSheet.absoluteFillObject}
            {...(editorResolvedMapStyle.kind === 'url'
              ? { styleURL: editorResolvedMapStyle.url }
              : { styleJSON: editorResolvedMapStyle.json })}
            logoEnabled
            attributionEnabled
            logoPosition={{ top: insets.top + 58, right: 8 }}
            attributionPosition={{ top: insets.top + 92, right: 8 }}
            scaleBarEnabled={false}
            compassEnabled={false}
            onDidFinishLoadingMap={() => { setMapReady(true); setMapLoadState('loading'); }}
            onDidFinishRenderingMapFully={() => { setMapReady(true); setMapLoadState('loading'); }}
            onMapLoadingError={() => setMapLoadState('error')}
            scrollEnabled={!isEditing || editActiveTool === 'pan'}
            zoomEnabled={!isEditing || editActiveTool === 'pan'}
            pitchEnabled={!isEditing || editActiveTool === 'pan'}
            rotateEnabled={!isEditing || editActiveTool === 'pan'}
            onPress={(event: any) => {
              if (!destinationPickActive || destinationPlanning || isEditing) return;
              const coordinate = event?.geometry?.coordinates ?? event?.features?.[0]?.geometry?.coordinates;
              if (!Array.isArray(coordinate) || coordinate.length < 2) return;
              void chooseDestination({ lng: Number(coordinate[0]), lat: Number(coordinate[1]) });
            }}
            onCameraChanged={(state: any) => {
              // v272: forward camera state (center+zoom+bearing+pitch) to
              // BrushOverlay's self-mercator unprojector. Without bearing
              // & pitch, rotated/tilted maps produced strokes that landed
              // far from the user's finger.
              try {
                const p = state?.properties;
                if (!p) return;
                const c = p.center;
                if (!c || c.length < 2) return;
                reportBrushOverlayCamera({
                  centerLng: c[0],
                  centerLat: c[1],
                  zoom: p.zoom ?? 0,
                  bearing: p.heading ?? 0,
                  pitch: p.pitch ?? 0,
                });
              } catch { /* swallow */ }
            }}
          >
            {/* R21-v3 v2 (2026-08-30): Standard style lightPreset. */}
            {StyleImport ? (
              <StyleImport
                key={editorLightPreset}
                id="basemap"
                existing
                config={buildStandardConfig(editorMapTheme) as any}
              />
            ) : null}
            {/* v6.3 plan §2.3: enable Terrain DEM so queryTerrainElevation()
                returns real altitudes for Mapbox-snap polylines. Optional —
                falls through if the SDK build doesn't export RasterDemSource. */}
            {RasterDemSource && TerrainComponent && (
              <>
                {/* R21-v3 v2 (2026-08-30): Standard basemap already ships
                    with its own internal `mapbox-dem` source and terrain.
                    Adding a second source with the SAME id collides on
                    native and can silently override Standard's terrain.
                    Use a distinct id so queryTerrainElevation still has
                    a source to query without stomping Standard's setup. */}
                <RasterDemSource
                  id="cairn-editor-dem"
                  url="mapbox://mapbox.mapbox-terrain-dem-v1"
                  tileSize={514}
                  maxZoomLevel={14}
                />
                <TerrainComponent sourceID="cairn-editor-dem" exaggeration={0} />
              </>
            )}
            {CameraComponent && (() => {
              // Camera mount priority — never fall back to Mapbox global default.
              //  1. Route bounds → fitBounds (best framing of edited geometry)
              //  2. User GPS at zoom 14 (we know where they are)
              //  3. Region centre at default zoom (cold start, no GPS)
              if (cameraBounds) {
                return (
                  <CameraComponent
                    ref={cameraRef}
                    bounds={{
                      ne: cameraBounds.ne,
                      sw: cameraBounds.sw,
                      paddingTop: insets.top + 96,
                      paddingBottom: dualEditActive ? Math.max(390, insets.bottom + 350) : Math.max(310, insets.bottom + 270),
                      paddingLeft: 40,
                      paddingRight: 40,
                    }}
                    pitch={0}
                    animationDuration={isEditing ? 300 : 0}
                  />
                );
              }
              const region = getCurrentRegion();
              const fallbackCenter: [number, number] = userCoord
                ? [userCoord.lng, userCoord.lat]
                : [region.centerLng, region.centerLat];
              const fallbackZoom = userCoord ? 14 : region.defaultZoom;
              return (
                <CameraComponent
                  ref={cameraRef}
                  centerCoordinate={fallbackCenter}
                  zoomLevel={fallbackZoom}
                  pitch={0}
                  animationDuration={0}
                />
              );
            })()}

            {/* Non-edit mode: simple line */}
            {!isEditing && renderPoints.length >= 2 && ShapeSource && LineLayer && (
              <ShapeSource
                id="route-line"
                shape={{
                  type: 'Feature',
                  properties: {},
                  geometry: {
                    type: 'LineString',
                    coordinates: renderPoints.map(p => [p.lng, p.lat]),
                  },
                }}
              >
                <LineLayer
                  id="route-line-stroke"
                  style={{
                    lineColor: Colors.primary,
                    lineWidth: 5,
                    lineCap: 'round',
                    lineJoin: 'round',
                  }}
                />
              </ShapeSource>
            )}

            {destinationPoint && ShapeSource && CircleLayer ? (
              <ShapeSource
                id="route-destination"
                shape={{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [destinationPoint.lng, destinationPoint.lat] } } as any}
              >
                <CircleLayer
                  id="route-destination-ring"
                  style={{ circleRadius: 10, circleColor: visualTheme.surface, circleStrokeColor: visualTheme.primary, circleStrokeWidth: 3 }}
                />
                <CircleLayer
                  id="route-destination-core"
                  style={{ circleRadius: 4, circleColor: visualTheme.primary }}
                />
              </ShapeSource>
            ) : null}

            {/* Edit mode: dual line + brush strokes */}
            {isEditing && (
              <>
                <DualLineLayer
                  originalPoints={renderOriginal}
                  workingPoints={renderPoints}
                  segments={editSegments}
                  showOriginal={editIsModified}
                />
                {/* v251: brushStrokes are commited to matched on Preview, so
                    BrushStrokeLayer naturally renders nothing afterward.
                    No need for the v247 opacity-hide trick. */}
                <BrushStrokeLayer
                  strokes={editBrushStrokes}
                  distanceFromOriginalM={distanceFromOriginal}
                />
              </>
            )}
          </MapView>
        ) : (
          <View style={[styles.fallback, { backgroundColor: visualTheme.background }]}>
            <Text style={[styles.fallbackText, { color: visualTheme.foregroundSecondary }]}>Map unavailable</Text>
          </View>
        )}

        {MapView && !mapReady ? (
          <MapLoadOverlay
            state={mapLoadState}
            onRetry={() => {
              setMapReady(false);
              setMapLoadState('loading');
              setMapEpoch((epoch) => epoch + 1);
            }}
            testID="route-editor-map-load-overlay"
          />
        ) : null}

        {snapWarning && !isEditing && (
          <View style={[styles.warningBanner, { top: insets.top + 8 }]}>
            <Text style={styles.warningText}>Showing raw GPS trace</Text>
          </View>
        )}
      </View>

      {/* Top floating BackButton — same in view-mode and edit-mode for
          consistency with the rest of the app. */}
      <View style={[styles.topOverlay, { paddingTop: insets.top + 8 }]} pointerEvents="box-none">
        <View style={styles.topRow} pointerEvents="box-none">
          <BackButton variant="inline" onPress={() => nav.goBack()} />
          {isEditing ? (
            <>
              <Text style={[styles.topTitle, { color: visualTheme.foreground }]}>Edit Route</Text>
              <View style={{ width: 40 }} />
            </>
          ) : (
            <View style={{ flex: 1 }} />
          )}
        </View>
      </View>

      {/* Edit overlay (above map, captures bottom only) */}
      {isEditing ? (
        <>
          {/* Brush gesture capture — only intercepts when brush/eraser tool active */}
          <BrushOverlay mapViewRef={mapViewRef} />
          {/* Bottom card — tool strip is now inside this card */}
          <EditOverlayV274
            onCancel={handleCancelEdit}
            onSave={handleSave}
            onPreview={handlePreview}
            onBeautify={handleBeautify}
            saveLabel="Apply to draft"
          />
        </>
      ) : (
        <>
          {/* Bottom panel — rounded white card overlay (matches Activity detail) */}
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            style={styles.bottomPanelWrap}
            keyboardVerticalOffset={0}
            pointerEvents="box-none"
          >
            <View style={[styles.bottomPanel, { paddingBottom: insets.bottom + Spacing.md, backgroundColor: visualTheme.surfaceElevated, borderColor: visualTheme.border, shadowColor: visualTheme.shadow }]} pointerEvents="auto">
              {enterEditError && (
                <TouchableOpacity
                  style={styles.errorBanner}
                  onPress={() => setEnterEditError(null)}
                  activeOpacity={0.85}
                >
                  <Icon name="TriangleAlert" size={14} color={Colors.danger} strokeWidth={2} />
                  <Text style={styles.errorBannerText} numberOfLines={2}>{enterEditError}</Text>
                </TouchableOpacity>
              )}

              {!routeId && !fromSessionId ? (
                <TouchableOpacity
                  style={[
                    styles.destinationCard,
                    { backgroundColor: visualTheme.surface, borderColor: destinationPickActive ? visualTheme.primary : visualTheme.border },
                  ]}
                  onPress={() => {
                    if (!userCoord || destinationPlanning) return;
                    setDestinationPickActive((active) => !active);
                  }}
                  disabled={!userCoord || destinationPlanning}
                  accessibilityRole="button"
                  accessibilityLabel="Choose a walking destination"
                  accessibilityState={{ disabled: !userCoord || destinationPlanning, selected: destinationPickActive, busy: destinationPlanning }}
                  testID="route-choose-destination"
                >
                  {destinationPlanning ? <ActivityIndicator size="small" color={visualTheme.primary} /> : <Icon name="MapPin" size={18} color={visualTheme.iconActive} strokeWidth={2.2} />}
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.destinationTitle, { color: visualTheme.foreground }]}>
                      {destinationPlanning ? 'Planning a walk…' : destinationPickActive ? 'Tap your destination on the map' : destinationPoint ? 'Choose another destination' : 'Plan to a destination'}
                    </Text>
                    <Text style={[styles.destinationBody, { color: visualTheme.foregroundSecondary }]}>
                      {!userCoord
                        ? 'A current location is needed to plan a walking Route.'
                        : 'Cairn asks Mapbox for a walkable draft. It is a plan, not recorded exploration.'}
                    </Text>
                  </View>
                  <Icon name="ChevronRight" size={16} color={visualTheme.iconInactive} strokeWidth={2} />
                </TouchableOpacity>
              ) : null}

              {/* Read-only summary card with name + stats — sage primaryBg tint */}
              <View style={[styles.viewSummary, { backgroundColor: visualTheme.surface, borderColor: visualTheme.border, borderWidth: 1 }]}>
                <TextInput
                  style={[styles.viewSummaryName, { color: visualTheme.foreground }]}
                  value={name}
                  onChangeText={setName}
                  placeholder="Route name (required)"
                  placeholderTextColor={visualTheme.muted}
                />
                {renderPoints.length >= 2 && (
                  <View style={styles.viewStatsInline}>
                    <Text style={[styles.viewStatText, { color: visualTheme.foregroundSecondary }]}>{renderPoints.length} points</Text>
                    <Text style={[styles.viewStatDot, { color: visualTheme.muted }]}>·</Text>
                    <Text style={[styles.viewStatText, { color: visualTheme.foregroundSecondary }]}>{dist.format(polylineLengthM(renderPoints), 1)} {dist.unit}</Text>
                  </View>
                )}
                {/* Sprint 69 STORY-00535: visibility toggle. Personal | Friend,
                    default Friend. Public hidden in v1 UI (v4 §11). Visual
                    parity with Mark create chip pattern (Sprint 68 STORY-00530). */}
                <View style={styles.permissionRow} testID="route-permission-row">
                  <TouchableOpacity
                    style={[styles.permissionChip, { backgroundColor: visualTheme.surfaceElevated, borderColor: visualTheme.border }, permission === 'personal' && { borderColor: visualTheme.primary, backgroundColor: visualTheme.surface }]}
                    onPress={() => setPermission('personal')}
                    testID="route-permission-personal"
                  >
                    <Icon name="Lock" size={12} color={permission === 'personal' ? visualTheme.iconActive : visualTheme.iconInactive} strokeWidth={2.2} />
                    <Text style={[styles.permissionText, { color: permission === 'personal' ? visualTheme.primary : visualTheme.foregroundSecondary }, permission === 'personal' && styles.permissionTextActive]}>Just me</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.permissionChip, { backgroundColor: visualTheme.surfaceElevated, borderColor: visualTheme.border }, permission === 'friend' && { borderColor: visualTheme.primary, backgroundColor: visualTheme.surface }]}
                    onPress={() => setPermission('friend')}
                    testID="route-permission-friend"
                  >
                    <Icon name="Users" size={12} color={permission === 'friend' ? visualTheme.iconActive : visualTheme.iconInactive} strokeWidth={2.2} />
                    <Text style={[styles.permissionText, { color: permission === 'friend' ? visualTheme.primary : visualTheme.foregroundSecondary }, permission === 'friend' && styles.permissionTextActive]}>Friends</Text>
                  </TouchableOpacity>
                </View>
              </View>

              {/* Action row: Delete (existing only) + Edit + Save.
                  v249: PO requires both Edit and Save in the same view.
                  Save is disabled until the user types a name. */}
              <View style={styles.viewActions}>
                {routeId && (
                  <TouchableOpacity
                    onPress={handleDelete}
                    style={[styles.viewBtn, styles.viewDeleteBtn, { backgroundColor: visualTheme.surface, borderColor: visualTheme.border }]}
                    activeOpacity={0.85}
                  >
                    <Icon name="Trash2" size={16} color={visualTheme.iconInactive} strokeWidth={2.3} />
                    <Text style={[styles.viewDeleteBtnText, { color: visualTheme.foregroundSecondary }]}>Delete</Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity
                  onPress={enterEdit}
                  disabled={enterEditLoading}
                  style={[styles.viewBtn, styles.viewEditBtn, { backgroundColor: visualTheme.surface, borderColor: visualTheme.primary }]}
                  activeOpacity={0.85}
                >
                  {enterEditLoading ? (
                    <ActivityIndicator size="small" color={visualTheme.primary} />
                  ) : (
                    <>
                      <Icon name="Edit3" size={16} color={visualTheme.iconActive} strokeWidth={2.5} />
                      <Text style={[styles.viewEditBtnText, { color: visualTheme.primary }]}>Edit</Text>
                    </>
                  )}
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={handleViewSave}
                  disabled={!canSaveView}
                  style={[styles.viewBtn, styles.viewSaveBtn, { backgroundColor: visualTheme.primary }, !canSaveView && styles.viewSaveBtnDisabled]}
                  activeOpacity={0.85}
                >
                  {saving ? (
                    <ActivityIndicator size="small" color={visualTheme.onPrimary} />
                  ) : (
                    <>
                      <Icon name="Check" size={16} color={visualTheme.onPrimary} strokeWidth={2.5} />
                      <Text style={[styles.viewSaveBtnText, { color: visualTheme.onPrimary }]}>Save Route</Text>
                    </>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          </KeyboardAvoidingView>
        </>
      )}
      <ModalCard
        visible={discardEditOpen}
        onDismiss={() => setDiscardEditOpen(false)}
        testID="route-discard-edit-confirmation"
      >
        <ModalCardHeader title="Discard Route edits?" body="Your saved Route and any previously applied draft stay unchanged." />
        <View style={styles.modalActions}>
          <PrimaryButton label="Keep editing" variant="secondary" onPress={() => setDiscardEditOpen(false)} />
          <PrimaryButton
            label="Discard edits"
            variant="destructive"
            onPress={() => {
              useRouteEditStore.getState().cancelEdit({ keepDraft: true });
              setEditMode(false);
              setDiscardEditOpen(false);
            }}
            testID="route-discard-edit-confirm"
          />
        </View>
      </ModalCard>
      <ModalCard
        visible={leavePrompt !== null}
        onDismiss={() => setLeavePrompt(null)}
        testID="route-leave-confirmation"
      >
        <ModalCardHeader
          title={leavePrompt?.decision === 'confirm-saving' ? 'Route is still saving' : 'Discard Route changes?'}
          body={leavePrompt?.decision === 'confirm-saving'
            ? 'Keep waiting, or leave this editor. If the save outcome is uncertain, your draft stays available for retry.'
            : 'Your saved Route will stay unchanged.'}
        />
        <View style={styles.modalActions}>
          <PrimaryButton
            label={leavePrompt?.decision === 'confirm-saving' ? 'Keep waiting' : 'Keep editing'}
            variant="secondary"
            onPress={() => setLeavePrompt(null)}
          />
          <PrimaryButton
            label={leavePrompt?.decision === 'confirm-saving' ? 'Leave editor' : 'Discard changes'}
            variant="destructive"
            onPress={() => {
              const prompt = leavePrompt;
              if (!prompt) return;
              setLeavePrompt(null);
              executeRouteEditorLeaveChoice(
                prompt.decision,
                prompt.decision === 'confirm-saving' ? 'leave-saving' : 'discard',
                {
                  discardDraft: () => {
                    useRouteEditStore.getState().cancelEdit();
                    useRouteEditStore.getState().clearCommittedDraft();
                  },
                  suppressLateNavigation: () => saveCoordinatorRef.current.suppressLateNavigation(),
                  allowAndDispatch: () => {
                    allowLeaveRef.current = true;
                    (nav as any).dispatch(prompt.action);
                  },
                },
              );
            }}
            testID="route-leave-confirm"
          />
        </View>
      </ModalCard>
      <ModalCard
        visible={deleteConfirmOpen}
        onDismiss={() => !deleteInFlightRef.current && setDeleteConfirmOpen(false)}
        dismissible={!deleteInFlightRef.current}
        testID="route-editor-delete-confirmation"
      >
        <ModalCardHeader
          title="Delete this Route?"
          body="Its source Activity, Cairns, and Memory stay unchanged."
        />
        {deleteError ? <Text style={[styles.modalError, { color: visualTheme.destructive }]}>{deleteError}</Text> : null}
        <View style={styles.modalActions}>
          <PrimaryButton label="Keep Route" variant="secondary" onPress={() => setDeleteConfirmOpen(false)} />
          <PrimaryButton label="Delete Route" variant="destructive" onPress={() => { void confirmDelete(); }} testID="route-editor-delete-confirm" />
        </View>
      </ModalCard>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.primaryBg },
  unavailable: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: Spacing.xl, gap: Spacing.sm },
  unavailableTop: { position: 'absolute', top: 0, left: Spacing.md },
  unavailableTitle: { fontSize: FontSize.h2, fontWeight: '700', marginTop: Spacing.sm },
  unavailableBody: { fontSize: FontSize.body, lineHeight: 22, textAlign: 'center' },
  unavailableRetry: { minHeight: 46, paddingHorizontal: Spacing.xl, borderRadius: Radius.button, alignItems: 'center', justifyContent: 'center', marginTop: Spacing.md },
  mapArea: { flex: 1 },
  fallback: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: Colors.surface },
  fallbackText: { color: Colors.textSecondary, fontSize: FontSize.body },
  warningBanner: {
    position: 'absolute',
    alignSelf: 'center',
    backgroundColor: Colors.warning,
    paddingHorizontal: Spacing.base,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.pill,
    ...Shadow.card,
  },
  warningText: { color: Colors.surface, fontSize: FontSize.caption, fontWeight: '600' },

  // Top: floating BackButton over the map (no full-width bar)
  topOverlay: {
    position: 'absolute',
    top: 0, left: 0, right: 0,
  },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Spacing.base,
  },
  topTitle: {
    flex: 1,
    textAlign: 'center',
    fontSize: 17,
    fontWeight: '700',
    color: '#1E2A24',
  },
  // Bottom: rounded white card panel
  bottomPanelWrap: {
    position: 'absolute',
    bottom: 0, left: 0, right: 0,
  },
  bottomPanel: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: Radius.sheet,
    borderTopRightRadius: Radius.sheet,
    padding: Spacing.base,
    paddingTop: Spacing.md,
    ...Shadow.elevated,
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    backgroundColor: Colors.dangerBg,
    borderRadius: Radius.button,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    marginBottom: Spacing.sm,
    borderWidth: 1,
    borderColor: Colors.danger,
  },
  errorBannerText: {
    flex: 1,
    fontSize: FontSize.small,
    color: Colors.danger,
    fontWeight: '600',
  },

  // Summary card (sage tint) — name + stats
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
    paddingVertical: 2,
  },
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
  // Sprint 69 STORY-00535: route permission chip row + chip styles.
  permissionRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
    marginTop: Spacing.sm,
  },
  permissionChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 6,
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  permissionChipActive: {
    borderColor: Colors.primary,
    backgroundColor: Colors.primaryBg,
  },
  permissionText: {
    fontSize: FontSize.caption,
    color: Colors.textSecondary,
    fontWeight: '500',
  },
  permissionTextActive: {
    color: Colors.primary,
    fontWeight: '700',
  },

  // Two equal-width action buttons (Delete + Edit)
  viewActions: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  viewBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: Spacing.md,
    borderRadius: Radius.button,
  },
  viewEditBtn: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.primary,
  },
  viewEditBtnText: {
    color: Colors.primary,
    fontSize: FontSize.body,
    fontWeight: '700',
  },
  viewSaveBtn: {
    backgroundColor: Colors.primary,
  },
  viewSaveBtnDisabled: {
    opacity: 0.4,
  },
  viewSaveBtnText: {
    color: Colors.surface,
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
  destinationCard: {
    minHeight: 68,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    borderWidth: 1,
    borderRadius: Radius.button,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    marginBottom: Spacing.sm,
  },
  destinationTitle: { fontSize: FontSize.caption, fontWeight: '700' },
  destinationBody: { marginTop: 2, fontSize: FontSize.small, lineHeight: 16 },
  modalActions: { gap: Spacing.sm },
  modalError: { fontSize: FontSize.small, lineHeight: 18, marginBottom: Spacing.md, fontWeight: '600' },
});
