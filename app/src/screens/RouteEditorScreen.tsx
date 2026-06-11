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
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useRouteStore } from '../store/useRouteStore';
import { useRouteEditStore } from '../store/useRouteEditStore';
import { useSessionStore, loadTrackPoints } from '../store/useSessionStore';
import { snapToRoadAndTrim } from '../services/routeMatcher';
import { formatDistance } from '../utils/geo';
import { Colors, Spacing, Radius, FontSize, Shadow } from '../components/tokens';
import { Icon } from '../components/Icon';
import { BackButton } from '../components/BackButton';
import { DualLineLayer } from '../components/map/DualLineLayer';
import { ViaPointLayer } from '../components/map/ViaPointLayer';
import { EditOverlayV236 } from '../components/map/EditOverlayV236';
import { getFlagsSync } from '../config/featureFlags';
import { polylineLengthM } from '../services/routing/corridor/PolylineSampler';

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

  const cameraRef = useRef<any>(null);
  const mapViewRef = useRef<any>(null);

  // ── Init: fill name from existing route or session
  useEffect(() => {
    if (existingRoute) {
      setName(existingRoute.name);
    } else if (session && !name) {
      setName(`Activity ${new Date(session.startedAt).toLocaleDateString()}`);
    }
  }, [existingRoute, session]);

  // ── Load route detail on mount
  useEffect(() => {
    if (routeId && (!existingRoute?.points || existingRoute.points.length === 0)) {
      loadRouteDetail(routeId).catch(() => {});
    }
  }, [routeId]);

  // ── Load session track points (save-as-route flow)
  useEffect(() => {
    if (!fromSessionId) return;
    if (fromSessionTrackPoints && fromSessionTrackPoints.length > 0) {
      setSessionTrackPoints(fromSessionTrackPoints);
      return;
    }
    loadTrackPoints(fromSessionId).then(pts => {
      const filtered = (pts ?? []).filter(p => Number.isFinite(p.lat) && Number.isFinite(p.lng));
      // Snap to road; if it fails, fall back to raw GPS with a banner.
      snapToRoadAndTrim(filtered).then(matched => {
        if (matched && matched.points && matched.points.length >= 2) {
          setSessionTrackPoints(matched.points);
          if (!matched.isSnapped) setSnapWarning(true);
        } else {
          setSessionTrackPoints(filtered);
          setSnapWarning(true);
        }
      }).catch(() => {
        setSessionTrackPoints(filtered);
        setSnapWarning(true);
      });
    }).catch(() => {});
  }, [fromSessionId]);

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

  // ── Hardware back during edit → discard alert
  const discardAlertActiveRef = useRef(false);
  useEffect(() => {
    if (!dualEditActive) return;
    if (Platform.OS !== 'android') return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (discardAlertActiveRef.current) return true;
      discardAlertActiveRef.current = true;
      Alert.alert(
        '丢弃编辑?',
        '所有修改将丢失。',
        [
          { text: '继续编辑', style: 'cancel', onPress: () => { discardAlertActiveRef.current = false; } },
          { text: '丢弃', style: 'destructive', onPress: () => {
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
      setEnterEditError('编辑模式当前未启用');
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
          setEnterEditError('无法编辑:数据不足');
          return;
        }
        const createdId = await addRoute({
          name: name.trim() || 'Untitled',
          description: null,
          points: sessionTrackPoints,
          waypoints: [],
        } as any);
        if (!createdId) {
          setEnterEditError('创建路线失败');
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
          setEnterEditError('路线数据不足,无法编辑');
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
        setEnterEditError(post.lastError ?? '无法进入编辑');
      } else {
        setEditMode(true);
      }
    } catch (e: any) {
      setEnterEditError(e?.message ?? '进入编辑失败');
    } finally {
      setEnterEditLoading(false);
    }
  }, [routeId, fromSessionId, sessionTrackPoints, existingRoute, name, addRoute, loadRouteDetail, enterEditLoading]);

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
      '丢弃编辑?',
      '所有修改将丢失。',
      [
        { text: '继续编辑', style: 'cancel' },
        { text: '丢弃', style: 'destructive', onPress: () => {
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
        Alert.alert('保存失败', result.error ?? '未知错误');
        return;
      }
      // Push the new geometry into useRouteStore (route.points).
      const editedWorking = useRouteEditStore.getState().workingPoints;
      const targetId = routeId ?? freshlyCreatedRouteId;
      if (targetId && editedWorking.length >= 2) {
        await updateRoute(targetId, { points: editedWorking } as any).catch(() => {});
      }
      setSelectedViaId(null);
      setEditMode(false);
      nav.goBack();
    } catch (e: any) {
      Alert.alert('保存失败', e?.message ?? '未知错误');
    } finally {
      setSaving(false);
    }
  }, [routeId, freshlyCreatedRouteId, updateRoute, nav, saving]);

  const handleDelete = useCallback(() => {
    if (!routeId) return;
    Alert.alert(
      '删除路线?',
      '此操作不可撤销。',
      [
        { text: '取消', style: 'cancel' },
        { text: '删除', style: 'destructive', onPress: async () => {
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
          '删除微调点?',
          '路线会重新计算。',
          [
            { text: '取消', style: 'cancel' },
            { text: '删除', style: 'destructive', onPress: () => {
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
            {CameraComponent && cameraBounds && (
              <CameraComponent
                ref={cameraRef}
                bounds={{
                  ne: cameraBounds.ne,
                  sw: cameraBounds.sw,
                  paddingTop: 80,
                  paddingBottom: 200,
                  paddingLeft: 40,
                  paddingRight: 40,
                }}
                animationDuration={300}
              />
            )}

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
                    lineColor: '#3B82F6',
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
            <Text style={styles.fallbackText}>地图不可用</Text>
          </View>
        )}

        {snapWarning && !isEditing && (
          <View style={[styles.warningBanner, { top: insets.top + 8 }]}>
            <Text style={styles.warningText}>显示原始 GPS 轨迹</Text>
          </View>
        )}
      </View>

      {/* Edit overlay (above map, captures top + bottom) */}
      {isEditing ? (
        <EditOverlayV236 onCancel={handleCancelEdit} onSave={handleSave} />
      ) : (
        <SafeAreaView edges={['top', 'bottom']} style={styles.viewModeOverlay} pointerEvents="box-none">
          <View style={styles.viewTopBar} pointerEvents="auto">
            <BackButton onPress={() => nav.goBack()} />
            <View style={styles.viewTopCenter}>
              <TextInput
                style={styles.nameInput}
                value={name}
                onChangeText={setName}
                placeholder="路线名称"
                placeholderTextColor="#9CA3AF"
                editable={!fromSessionId ? !!routeId : true}
              />
              {renderPoints.length >= 2 && (
                <Text style={styles.distanceText}>
                  {formatDistance(polylineLengthM(renderPoints))}
                </Text>
              )}
            </View>
            <View style={{ width: 36 }} />
          </View>

          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            style={styles.viewBottomBar}
            pointerEvents="auto"
          >
            {enterEditError && (
              <TouchableOpacity
                style={styles.errorBanner}
                onPress={() => setEnterEditError(null)}
                activeOpacity={0.85}
              >
                <Text style={styles.errorBannerText}>{enterEditError}</Text>
              </TouchableOpacity>
            )}
            <View style={styles.viewActions}>
              {routeId && (
                <TouchableOpacity onPress={handleDelete} style={[styles.actionBtn, styles.deleteBtn]}>
                  <Icon name="Trash2" size={18} />
                  <Text style={styles.deleteBtnText}>删除</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity
                onPress={enterEdit}
                disabled={enterEditLoading}
                style={[styles.actionBtn, styles.editBtn]}
              >
                {enterEditLoading ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <>
                    <Icon name="Edit3" size={18} color="#FFFFFF" />
                    <Text style={styles.editBtnText}>编辑</Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
          </KeyboardAvoidingView>
        </SafeAreaView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  mapArea: { flex: 1 },
  fallback: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#1F2937' },
  fallbackText: { color: '#FFFFFF' },
  warningBanner: {
    position: 'absolute',
    alignSelf: 'center',
    backgroundColor: 'rgba(245,158,11,0.95)',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 16,
  },
  warningText: { color: '#FFFFFF', fontSize: 13 },
  viewModeOverlay: { ...StyleSheet.absoluteFillObject, justifyContent: 'space-between' },
  viewTopBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: 'rgba(255,255,255,0.92)',
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  viewTopCenter: { flex: 1, paddingHorizontal: 12 },
  nameInput: {
    fontSize: 17,
    fontWeight: '600',
    color: '#1F2937',
    paddingVertical: 4,
  },
  distanceText: { fontSize: 12, color: '#6B7280' },
  viewBottomBar: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: 'rgba(255,255,255,0.92)',
    borderTopWidth: 1,
    borderTopColor: '#E5E7EB',
  },
  errorBanner: {
    backgroundColor: '#FEE2E2',
    padding: 10,
    borderRadius: 8,
    marginBottom: 8,
  },
  errorBannerText: { color: '#1F2937', fontSize: 13 },
  viewActions: {
    flexDirection: 'row',
    gap: 12,
  },
  actionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderRadius: 10,
    gap: 8,
  },
  deleteBtn: {
    backgroundColor: '#FEE2E2',
    borderWidth: 1,
    borderColor: '#FCA5A5',
  },
  deleteBtnText: { color: '#B91C1C', fontWeight: '600' },
  editBtn: {
    backgroundColor: '#3B82F6',
  },
  editBtnText: { color: '#FFFFFF', fontWeight: '600' },
});
