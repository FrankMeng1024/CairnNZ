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
  View, Text, StyleSheet, TouchableOpacity, TextInput, Alert, Platform,
  KeyboardAvoidingView, ActivityIndicator, BackHandler,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useRouteStore } from '../store/useRouteStore';
import { useRouteEditStore } from '../store/useRouteEditStore';
import { useSessionStore, loadTrackPoints } from '../store/useSessionStore';
import { useTrackingStore } from '../store/useTrackingStore';
import { snapToRoadAndTrim } from '../services/routeMatcher';
import { formatDistance } from '../utils/geo';
import { getCurrentRegion } from '../config/regions';
import { Colors, Spacing, Radius, FontSize, Shadow } from '../components/tokens';
import { Icon } from '../components/Icon';
import { BackButton } from '../components/BackButton';
import { DualLineLayer } from '../components/map/DualLineLayer';
import { ViaPointLayer } from '../components/map/ViaPointLayer';
import { EditOverlayV236 } from '../components/map/EditOverlayV236';
import { getFlagsSync } from '../config/featureFlags';
import { polylineLengthM } from '../services/routing/corridor/PolylineSampler';
import { debugLogger } from '../services/debugLogger';
import { telemetryUploader } from '../services/telemetryUploader';

// Conditional Mapbox import — same pattern as RoutesScreen.
let MapView: any = null;
let CameraComponent: any = null;
let LineLayer: any = null;
let ShapeSource: any = null;
if (Platform.OS !== 'web') {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Mapbox = require('@rnmapbox/maps');
    MapView = Mapbox.MapView;
    CameraComponent = Mapbox.Camera;
    LineLayer = Mapbox.LineLayer;
    ShapeSource = Mapbox.ShapeSource;
  } catch {
    // Not available — fallback panel renders.
  }
}

const SAVE_FRACTION_FLAG = 'editModeEnabled';

export function RouteEditorScreen() {
  const nav = useNavigation();
  const insets = useSafeAreaInsets();
  const route = useRoute<any>();
  const routeId = route.params?.routeId as string | undefined;
  const fromSessionId = route.params?.fromSessionId as string | undefined;
  const fromSessionTrackPoints = route.params?.fromSessionTrackPoints as
    | Array<{ lat: number; lng: number }> | undefined;

  const addRoute = useRouteStore(s => s.addRoute);
  const updateRoute = useRouteStore(s => s.updateRoute);
  const deleteRoute = useRouteStore(s => s.deleteRoute);
  const loadRouteDetail = useRouteStore(s => s.loadRouteDetail);
  const existingRoute = useRouteStore(s => s.routes.find(r => r.id === routeId));
  const session = useSessionStore(s => fromSessionId ? s.sessions.find(x => x.id === fromSessionId) : null);

  const [name, setName] = useState('');
  const [snapWarning, setSnapWarning] = useState(false);
  const [sessionTrackPoints, setSessionTrackPoints] = useState<Array<{ lat: number; lng: number }>>([]);
  const [editMode, setEditMode] = useState(false);
  const [enterEditLoading, setEnterEditLoading] = useState(false);
  const [enterEditError, setEnterEditError] = useState<string | null>(null);
  const [freshlyCreatedRouteId, setFreshlyCreatedRouteId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const editIsOpen = useRouteEditStore(s => s.isOpen);
  const editRouteId = useRouteEditStore(s => s.routeId);
  const editWorkingPoints = useRouteEditStore(s => s.workingPoints);
  const editMatchedPoints = useRouteEditStore(s => s.matchedPoints);
  const editViaPoints = useRouteEditStore(s => s.viaPoints);
  const editTrimStartFrac = useRouteEditStore(s => s.trimStartFrac);
  const editTrimEndFrac = useRouteEditStore(s => s.trimEndFrac);
  const dualEditActive = editIsOpen && editRouteId === (routeId ?? freshlyCreatedRouteId);
  const [selectedViaId, setSelectedViaId] = useState<string | null>(null);

  // Subscribe to user GPS — used as the camera fallback when route data
  // hasn't hydrated yet, so MapView never falls back to Mapbox's global
  // default view (the "Ajaccio / Corsica" bug for Asian/NZ users).
  const userCoord = useTrackingStore(s => s.lastCoordinate);

  const cameraRef = useRef<any>(null);
  const mapViewRef = useRef<any>(null);

  // ── Init: fill name from existing route or session
  useEffect(() => {
    if (existingRoute) {
      setName(existingRoute.name);
    } else if (session && !name) {
      const date = new Date(session.startedAt).toLocaleDateString('en-NZ', { day: 'numeric', month: 'short' });
      setName(`${session.activityMode === 'running' ? 'Run' : 'Hike'} ${date}`);
    }
  }, [existingRoute, session]);

  // ── Load route detail on mount
  useEffect(() => {
    if (routeId && (!existingRoute?.points || existingRoute.points.length === 0)) {
      loadRouteDetail(routeId).catch(() => {});
    }
  }, [routeId]);

  // ── Load session track points (save-as-route flow). Always snap to road
  // — even if caller passed pre-loaded raw track points, the user expects
  // to see the cleaned version that will actually be saved as the route.
  useEffect(() => {
    if (!fromSessionId) return;
    const profile: 'walking' = 'walking';
    const sourcePromise: Promise<Array<{ lat: number; lng: number }>> =
      fromSessionTrackPoints && fromSessionTrackPoints.length >= 2
        ? Promise.resolve(fromSessionTrackPoints.map(p => ({ lat: p.lat, lng: p.lng })))
        : loadTrackPoints(fromSessionId).then(pts =>
            (pts ?? []).filter(p => Number.isFinite(p.lat) && Number.isFinite(p.lng))
              .map(p => ({ lat: p.lat, lng: p.lng })),
          );
    sourcePromise
      .then(async tp => {
        if (tp.length < 2) {
          setSessionTrackPoints([]);
          setSnapWarning(true);
          return;
        }
        try {
          const matched = await snapToRoadAndTrim(tp, profile);
          if (matched && matched.points && matched.points.length >= 2) {
            setSessionTrackPoints(matched.points);
            setSnapWarning(!matched.isSnapped);
          } else {
            setSessionTrackPoints(tp);
            setSnapWarning(true);
          }
        } catch {
          setSessionTrackPoints(tp);
          setSnapWarning(true);
        }
      })
      .catch(() => {
        setSessionTrackPoints([]);
        setSnapWarning(true);
      });
  }, [fromSessionId, fromSessionTrackPoints]);

  // ── Detach edit on unmount (preserve session for resume)
  const dualEditActiveRef = useRef(dualEditActive);
  useEffect(() => { dualEditActiveRef.current = dualEditActive; }, [dualEditActive]);
  useEffect(() => {
    return () => {
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
    if (debugLogger.getCurrentSessionId()) {
      // A tracking session is active — leave it alone, our logs will
      // co-mingle into that session and upload with it.
      return;
    }
    try {
      debugLogger.setEnabled(true);
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
  }, []);

  // ── Hardware back during edit → discard alert
  const discardAlertActiveRef = useRef(false);
  useEffect(() => {
    if (!dualEditActive) return;
    if (Platform.OS !== 'android') return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (discardAlertActiveRef.current) return true;
      discardAlertActiveRef.current = true;
      Alert.alert(
        'Discard edits?',
        'Your changes will be lost.',
        [
          { text: 'Keep editing', style: 'cancel', onPress: () => { discardAlertActiveRef.current = false; } },
          { text: 'Discard', style: 'destructive', onPress: () => {
            discardAlertActiveRef.current = false;
            useRouteEditStore.getState().cancelEdit();
            handlePostCancel();
          } },
        ],
        { cancelable: false, onDismiss: () => { discardAlertActiveRef.current = false; } },
      );
      return true;
    });
    return () => {
      sub.remove();
      discardAlertActiveRef.current = false;
    };
  }, [dualEditActive]);

  // ── Camera fit
  const cameraBounds = useMemo(() => {
    const pts: Array<{ lat: number; lng: number }> = existingRoute?.points
      ?? sessionTrackPoints;
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
  }, [existingRoute, sessionTrackPoints]);

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

      // Save-as-route: must persist a backend route first to get an id.
      if (!effectiveRouteId) {
        if (!fromSessionId || sessionTrackPoints.length < 2) {
          setEnterEditError('Loading route data — please try again in a moment.');
          return;
        }
        // Compute distance for the new route record.
        const { haversineM } = await import('../utils/geo');
        let computedDistance = 0;
        for (let i = 1; i < sessionTrackPoints.length; i++) {
          computedDistance += haversineM(
            { lat: sessionTrackPoints[i - 1].lat, lng: sessionTrackPoints[i - 1].lng },
            { lat: sessionTrackPoints[i].lat, lng: sessionTrackPoints[i].lng },
          );
        }
        const safeName = name.trim() ||
          (session
            ? `${session.activityMode === 'running' ? 'Run' : 'Hike'} ${new Date(session.startedAt).toLocaleDateString('en-NZ', { day: 'numeric', month: 'short' })}`
            : 'Untitled route');
        const createdId = await addRoute({
          name: safeName,
          description: undefined,
          points: sessionTrackPoints,
          waypoints: [],
          distanceM: computedDistance,
          elevationGainM: session?.elevationGainM ?? 0,
        });
        if (!createdId) {
          setEnterEditError('Could not save route — please check your connection.');
          return;
        }
        effectiveRouteId = createdId;
        setFreshlyCreatedRouteId(createdId);
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

      await useRouteEditStore.getState().beginEdit({
        routeId: effectiveRouteId,
        routePoints: basePoints,
        routeUpdatedAt: existingRoute?.updatedAt,
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

  // ── Save / cancel handlers
  const handlePostCancel = useCallback(() => {
    // If we created a route just to enable edit and user cancelled without saving,
    // clean up the freshly-created backend route.
    if (freshlyCreatedRouteId && !routeId) {
      deleteRoute(freshlyCreatedRouteId).catch(() => {});
      setFreshlyCreatedRouteId(null);
    }
    setEditMode(false);
    nav.goBack();
  }, [freshlyCreatedRouteId, routeId, deleteRoute, nav]);

  const handleCancelEdit = useCallback(() => {
    Alert.alert(
      'Discard edits?',
      'Your changes will be lost.',
      [
        { text: 'Keep editing', style: 'cancel' },
        { text: 'Discard', style: 'destructive', onPress: () => {
          useRouteEditStore.getState().cancelEdit();
          handlePostCancel();
        } },
      ],
    );
  }, [handlePostCancel]);

  const handleSave = useCallback(async () => {
    if (saving) return;
    setSaving(true);
    try {
      const result = await useRouteEditStore.getState().saveAndExit();
      if (!result.ok) {
        Alert.alert('Save failed', result.error ?? 'Unknown error');
        return;
      }
      // Push the new geometry into useRouteStore (route.points). Also
      // refresh distanceM so the route card reflects the trimmed/edited
      // length — without this, the list shows the original distance even
      // after the user trimmed half the route off.
      const editedWorking = useRouteEditStore.getState().workingPoints;
      const targetId = routeId ?? freshlyCreatedRouteId;
      if (targetId && editedWorking.length >= 2) {
        const { haversineM } = await import('../utils/geo');
        let dist = 0;
        for (let i = 1; i < editedWorking.length; i++) {
          dist += haversineM(
            { lat: editedWorking[i - 1].lat, lng: editedWorking[i - 1].lng },
            { lat: editedWorking[i].lat, lng: editedWorking[i].lng },
          );
        }
        await updateRoute(targetId, { points: editedWorking, distanceM: dist }).catch(() => {});
      }
      setSelectedViaId(null);
      setEditMode(false);
      nav.goBack();
    } catch (e: any) {
      Alert.alert('Save failed', e?.message ?? 'Unknown error');
    } finally {
      setSaving(false);
    }
  }, [routeId, freshlyCreatedRouteId, updateRoute, nav, saving]);

  const handleDelete = useCallback(() => {
    if (!routeId) return;
    Alert.alert(
      'Delete route?',
      'This action cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: async () => {
          await deleteRoute(routeId);
          nav.goBack();
        } },
      ],
    );
  }, [routeId, deleteRoute, nav]);

  // ── Map handlers
  const onMapLongPress = useCallback(async (e: any) => {
    if (!dualEditActive) return;
    const c = e?.geometry?.coordinates;
    if (!Array.isArray(c) || c.length < 2) return;
    const lng = c[0];
    const lat = c[1];
    setSelectedViaId(null);
    await useRouteEditStore.getState().addVia({ lng, lat });
  }, [dualEditActive]);

  // Debounced via drag re-fit. Cleanup on unmount to avoid timer leak.
  const dragDebounceRef = useRef<{ [viaId: string]: any }>({});
  useEffect(() => {
    return () => {
      for (const k of Object.keys(dragDebounceRef.current)) {
        clearTimeout(dragDebounceRef.current[k]);
      }
      dragDebounceRef.current = {};
    };
  }, []);
  const onViaDragEnd = useCallback((viaId: string, lng: number, lat: number) => {
    if (dragDebounceRef.current[viaId]) clearTimeout(dragDebounceRef.current[viaId]);
    dragDebounceRef.current[viaId] = setTimeout(() => {
      useRouteEditStore.getState().moveVia(viaId, { lng, lat });
      delete dragDebounceRef.current[viaId];
    }, 400);
  }, []);

  const onTapVia = useCallback((viaId: string) => {
    setSelectedViaId(prev => {
      if (prev === viaId) {
        // Second tap on already-selected → confirm delete
        Alert.alert(
          'Remove detour point?',
          'The route will be recomputed.',
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Remove', style: 'destructive', onPress: () => {
              useRouteEditStore.getState().removeVia(viaId);
              setSelectedViaId(null);
            } },
          ],
        );
        return prev;
      }
      return viaId;
    });
  }, []);

  // ── Render
  const isEditing = editMode && dualEditActive;
  const renderPoints: Array<{ lat: number; lng: number }> = isEditing
    ? editWorkingPoints
    : (existingRoute?.points ?? sessionTrackPoints);
  const renderOriginal: Array<{ lat: number; lng: number }> = isEditing
    ? editMatchedPoints
    : [];

  return (
    <View style={styles.container}>
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
            onLongPress={onMapLongPress}
          >
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
                      paddingTop: 80,
                      paddingBottom: 220,
                      paddingLeft: 40,
                      paddingRight: 40,
                    }}
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

            {/* Edit mode: dual line + via dots */}
            {isEditing && (
              <>
                <DualLineLayer
                  originalPoints={renderOriginal}
                  workingPoints={renderPoints}
                  segments={[
                    {
                      startIdx: 0,
                      endIdx: Math.max(0, renderPoints.length - 1),
                      source: editViaPoints.length > 0 ? 'mapbox' : 'original',
                      isEdited: editViaPoints.length > 0
                        || editTrimStartFrac > 0 || editTrimEndFrac < 1,
                      confidence: 'confident',
                    },
                  ]}
                  showOriginal={true}
                />
                <ViaPointLayer
                  vias={editViaPoints}
                  selectedViaId={selectedViaId}
                  onTapVia={onTapVia}
                  onDragEnd={onViaDragEnd}
                />
              </>
            )}
          </MapView>
        ) : (
          <View style={styles.fallback}>
            <Text style={styles.fallbackText}>Map unavailable</Text>
          </View>
        )}

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
          <BackButton variant="pill" />
          <View style={{ flex: 1 }} />
        </View>
      </View>

      {/* Edit overlay (above map, captures bottom only) */}
      {isEditing ? (
        <EditOverlayV236 onCancel={handleCancelEdit} onSave={handleSave} />
      ) : (
        <>
          {/* Bottom panel — rounded white card overlay (matches Activity detail) */}
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            style={styles.bottomPanelWrap}
            keyboardVerticalOffset={0}
            pointerEvents="box-none"
          >
            <View style={[styles.bottomPanel, { paddingBottom: insets.bottom + Spacing.md }]} pointerEvents="auto">
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

              {/* Read-only summary card with name + stats — sage primaryBg tint */}
              <View style={styles.viewSummary}>
                <TextInput
                  style={styles.viewSummaryName}
                  value={name}
                  onChangeText={setName}
                  placeholder="Route name (required)"
                  placeholderTextColor={Colors.textMuted}
                />
                {renderPoints.length >= 2 && (
                  <View style={styles.viewStatsInline}>
                    <Text style={styles.viewStatText}>{renderPoints.length} points</Text>
                    <Text style={styles.viewStatDot}>·</Text>
                    <Text style={styles.viewStatText}>{formatDistance(polylineLengthM(renderPoints), 'km', 1)} km</Text>
                  </View>
                )}
              </View>

              {/* Action row: Delete (existing) / Cancel (save-as-route draft) + Edit */}
              <View style={styles.viewActions}>
                {(routeId || freshlyCreatedRouteId) && (
                  <TouchableOpacity
                    onPress={handleDelete}
                    style={[styles.viewBtn, styles.viewDeleteBtn]}
                    activeOpacity={0.85}
                  >
                    <Icon name="Trash2" size={16} color={Colors.danger} strokeWidth={2.5} />
                    <Text style={styles.viewDeleteBtnText}>Delete</Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity
                  onPress={enterEdit}
                  disabled={enterEditLoading}
                  style={[styles.viewBtn, styles.viewEditBtn]}
                  activeOpacity={0.85}
                >
                  {enterEditLoading ? (
                    <ActivityIndicator size="small" color={Colors.surface} />
                  ) : (
                    <>
                      <Icon name="Edit3" size={16} color={Colors.surface} strokeWidth={2.5} />
                      <Text style={styles.viewEditBtnText}>Edit</Text>
                    </>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          </KeyboardAvoidingView>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.primaryBg },
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
    backgroundColor: Colors.primary,
  },
  viewEditBtnText: {
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
});
