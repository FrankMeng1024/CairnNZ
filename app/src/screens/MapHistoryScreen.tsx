/**
 * MapHistoryScreen — Sprint 19 track visualization + flag detail sheet
 *
 * - STORY-00043: session track polyline on map when session selected
 * - STORY-00046: flag detail bottom sheet, richer flag list items, improved empty states
 */
import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import {
  ActivityIndicator, View, Text, StyleSheet, TouchableOpacity, ScrollView, Alert,
  Dimensions, Animated, Easing, Platform, TextInput, Keyboard, AppState,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { CommonActions, useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp, NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/RootNavigator';
import { useSessionStore, loadActivityTrackPoints } from '../store/useSessionStore';
import { useTrackingStore } from '../store/useTrackingStore';
import { fetchSessionDetail } from '../services/sessionService';
import { useRouteStore } from '../store/useRouteStore';
import { useFriendStore } from '../store/useFriendStore';
import { useMarkerStore } from '../store/useMarkerStore';
import { markersForVisibleWorkspace } from '../features/cairns/cairnWorkspace';
import { crashLogger } from '../services/crashLogger';
import { getCurrentRegion } from '../config/regions';
import { getMapStyleForLayer, getMapStyleForTheme, getPrimaryMapStyle, themeToStandardPreset, buildStandardConfig } from '../config/mapbox';
import { mapOrnamentsAbove } from '../config/mapOrnaments';
import { useSettingsStore } from '../store/useSettingsStore';
import { formatDuration, formatDate, getRelativeTime, haversineM } from '../utils/geo';
import { formatProductTime } from '../utils/dateFormat';
import { useDistance } from '../utils/distanceFormat';
import { Colors, Spacing, Radius, FontSize, Shadow, IconSize } from '../components/tokens';
import { Icon } from '../components/Icon';
import type { IconName } from '../components/Icon';
import { HikingIcon, RunningIcon } from '../components/ActivityIcons';
import { BackButton } from '../components/BackButton';
import { PressBtn } from '../components/PressBtn';
import { MARKER_META } from '../data/mockData';
import type { TrackingSession } from '../store/useSessionStore';
import type { Marker } from '../store/useMarkerStore';
import { useVisualTheme } from '../hooks/useVisualTheme';
import { useMapTheme } from '../hooks/useMapTheme';
import { segmentTrace } from '../features/activity/activityContracts';
import {
  activityFinalArtifactMatchesExpected,
  activityFinalPointsMatchExpected,
  activityGeometryFingerprint,
  commitActivityFinalArtifact,
  loadActivityFinalArtifact,
} from '../features/activity/activityFinalArtifact';
import {
  exportActivityStageLedger,
  recordActivityStageEvent,
} from '../features/activity/activityStageLedger';
import { exportActivityDiagnosticReplayIfPresent } from '../features/activity/activityDiagnosticReplay';
import {
  buildActivityNativeCrossLedgerReport,
  exportNativeGpsEvidence,
} from '../features/activity/nativeGpsEvidence';
import { ContentSurface } from '../components/ContentSurface';
import { PrimaryButton } from '../components/PrimaryButton';
import { SyncBadge } from '../components/SyncBadge';
import { ModalCard, ModalCardHeader } from '../components/ModalCard';
import { MapLoadOverlay, type MapLoadState } from '../components/MapLoadOverlay';
import { CanonicalRouteLayer } from '../components/map/CanonicalRouteLayer';
import {
  deriveActivityRouteState,
} from '../features/activity/activityRouteState';
import { activityDetailMapBindingIdentity } from '../features/activity/activityDetailMapLifecycle';
import {
  activityDetailNotices,
  activityMatchesTarget,
  activityMetricLabels,
  formatAverageActivityPace,
  linkedCairnsForActivity,
} from '../features/activity/activityDetailPresentation';
import { routeCanBeUsed, routeMatchesIdentity } from '../features/route/routeContracts';
import { routeHasReadyStatus, routeSourceLabel, routeStatusLabel } from '../features/trails/trailsLibrary';
import {
  canonicalRouteBounds,
  canonicalRouteGeometry,
  canonicalRouteGeometryFingerprint,
  type CanonicalRouteGeometry,
} from '../features/route/canonicalRouteGeometry';
import { shareRouteSnapshot } from '../services/routeService';
import { uuidv4 } from '../services/offlineQueue';
import { cairnDisplayTitle, splitTitleBody } from '../features/plant/services/noteEncoding';
import { CairnDeleteDialog } from '../features/cairns/CairnDeleteDialog';
import { resolveActivityDetailBackAction } from '../features/activity/activityDetailNavigation';
import { createRouteCreationSessionId } from '../features/route/routeCreationSession';
import {
  ALMOST_DONE_CLONE_V1_ID,
  loadOrBuildAlmostDoneCloneV1,
  type AlmostDoneCloneV1,
} from '../features/activity/almostDoneCloneV1';
import {
  loadSnapLabActivity,
  recordSnapLabDetailLoaded,
  saveSnapLabRouteSnapshot,
  type SnapLabActivityRecord,
} from '../features/activitySimulator/snapLabActivityStore';
import { cairnText } from '../i18n/runtime';

// Route Detail measures its live panel and immediately replaces this value.
// Keep the first Mapbox frame conservative: the compact action/title layout
// can be taller than the former 248px panel on a 320px viewport, and legal
// controls must never spend that first layout frame underneath the sheet.
const HISTORY_ROUTE_ORNAMENT_FALLBACK_CLEARANCE = 340;

// ── Conditional Mapbox import ─────────────────────────────────────────────
// Native uses @rnmapbox/maps; Web uses Cairn's real Mapbox GL adapter so the
// same Activity/Route sources and layers can be visually reviewed in browser
// QA. Expo Go or a missing renderer still gets the explicit SVG fallback.
let MapView: any = null;
let CameraComponent: any = null;
let LineLayer: any = null;
let CircleLayer: any = null;
let ShapeSource: any = null;
let SymbolLayer: any = null;
let PointAnnotation: any = null;
let StyleImport: any = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const Mapbox = Platform.OS === 'web'
    ? require('../features/memory/services/mapboxAdapter.web').makeWebMapboxAdapter()
    : require('@rnmapbox/maps');
  if (Mapbox?.available !== false) {
    MapView = Mapbox.MapView;
    CameraComponent = Mapbox.Camera;
    LineLayer = Mapbox.LineLayer;
    CircleLayer = Mapbox.CircleLayer;
    ShapeSource = Mapbox.ShapeSource;
    SymbolLayer = Mapbox.SymbolLayer;
    PointAnnotation = Mapbox.PointAnnotation;
    StyleImport = Mapbox.StyleImport;
  }
} catch {
  // Map renderer not in this build — fallback panel will render.
}

type Nav = NativeStackNavigationProp<RootStackParamList>;
const { width: W, height: H } = Dimensions.get('window');

// Map display area height (approx — the area above the list panel)
const MAP_H = H - 380;
// Map bounds for coordinate mapping
const MAP_PADDING = 40;

// ── Spring press wrapper ────────────────────────────────────────────────────
function PressRow({
  onPress, style, children, scale = 0.98,
}: {
  onPress: () => void;
  style?: object | object[];
  children: React.ReactNode;
  scale?: number;
}) {
  const anim = useRef(new Animated.Value(1)).current;
  const onIn = () => Animated.spring(anim, { toValue: scale, useNativeDriver: true, tension: 300, friction: 10 }).start();
  const onOut = () => Animated.spring(anim, { toValue: 1, useNativeDriver: true, tension: 300, friction: 8 }).start();
  return (
    <Animated.View style={[{ transform: [{ scale: anim }] }, style]}>
      <TouchableOpacity onPress={onPress} onPressIn={onIn} onPressOut={onOut} activeOpacity={1}>
        {children}
      </TouchableOpacity>
    </Animated.View>
  );
}

// ── Native track map (Mapbox) ─────────────────────────────────────────────
// Renders the session track as a polyline on top of a real Mapbox map.
// Used in place of the SVG-on-coloured-panel TrackPolyline when a real
// platform renderer is available (native RNMapbox or the Web GL adapter).
function detailRouteBounds(points: TrackingSession['trackPoints']): {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
} | null {
  if (points.length < 2) return null;
  const lats = points.map(point => point.lat);
  const lngs = points.map(point => point.lng);
  let minLat = Math.min(...lats);
  let maxLat = Math.max(...lats);
  let minLng = Math.min(...lngs);
  let maxLng = Math.max(...lngs);
  const minimumSpanDegrees = 0.005;
  if (maxLat - minLat < minimumSpanDegrees) {
    const centre = (minLat + maxLat) / 2;
    minLat = centre - minimumSpanDegrees / 2;
    maxLat = centre + minimumSpanDegrees / 2;
  }
  if (maxLng - minLng < minimumSpanDegrees) {
    const centre = (minLng + maxLng) / 2;
    minLng = centre - minimumSpanDegrees / 2;
    maxLng = centre + minimumSpanDegrees / 2;
  }
  return { minLat, maxLat, minLng, maxLng };
}

function NativeTrackMap({
  session,
  markers,
  plannedRouteGeometry,
  ornamentBottomClearance,
}: {
  session: TrackingSession;
  markers: Marker[];
  plannedRouteGeometry?: CanonicalRouteGeometry;
  ornamentBottomClearance: number;
}) {
  const ownerUserId = useSessionStore(state => state.currentUserId);
  const clientActivityId = session.clientActivityId ?? session.id;
  const pts = useMemo(() => plannedRouteGeometry
    ? plannedRouteGeometry.parts.flatMap(part => part.points.map((point, index) => ({
        ...point,
        t: index,
        segmentId: part.id,
      })))
    : session.trackPoints, [plannedRouteGeometry, session.trackPoints]);
  const visualTheme = useVisualTheme();
  const color = session.activityMode === 'running' ? Colors.running : Colors.primary;
  // O18 MAP-01: react to user's saved map layer preference.
  const mapLayer = useSettingsStore((s) => s.mapLayer);
  // R21-v3: three-state theme applied to every mapbox surface.
  const mapTheme = useMapTheme();
  const resolvedMapStyle = getMapStyleForTheme(mapLayer, mapTheme);
  const historyLightPreset = themeToStandardPreset(mapTheme);
  // v198 Bug 5: track whether the user has panned the camera away from
  // the initial fit. When true, render a small recenter button that
  // re-fits to the route bbox. Pattern matches HikingScreen's recenter.
  const [hasPanned, setHasPanned] = useState(false);
  const [mapReady, setMapReady] = useState(false);
  const [mapLoadState, setMapLoadState] = useState<MapLoadState>('loading');
  const [mapEpoch, setMapEpoch] = useState(0);
  const [detailStyleGeneration, setDetailStyleGeneration] = useState(0);
  const cameraRef = useRef<any>(null);
  const lastCameraFitRef = useRef<string | null>(null);
  const bounds = useMemo(
    () => plannedRouteGeometry ? canonicalRouteBounds(plannedRouteGeometry) : detailRouteBounds(pts),
    [plannedRouteGeometry, pts],
  );
  const geometryIdentity = useMemo(
    () => plannedRouteGeometry
      ? canonicalRouteGeometryFingerprint(plannedRouteGeometry)
      : activityGeometryFingerprint(pts),
    [plannedRouteGeometry, pts],
  );
  const mapBindingIdentity = activityDetailMapBindingIdentity(geometryIdentity, detailStyleGeneration);
  const historyMapOrnaments = mapOrnamentsAbove(ornamentBottomClearance);
  const presentationEvidenceRef = useRef(new Set<string>());
  const recordMapMilestone = useCallback((
    eventCode: string,
    details: Record<string, unknown> = {},
  ) => {
    if (!ownerUserId || !clientActivityId) return;
    const key = `${mapEpoch}:${mapBindingIdentity}:${eventCode}`;
    if (presentationEvidenceRef.current.has(key)) return;
    presentationEvidenceRef.current.add(key);
    void recordActivityStageEvent({
      ownerUserId,
      clientActivityId,
      stage: 'presentation',
      details: {
        eventCode,
        consumer: 'activity-detail-map',
        mapEpoch,
        geometryFingerprint: geometryIdentity,
        pointCount: pts.length,
        measurement: 'JS_OR_MAPBOX_CALLBACK_PROXY',
        visiblePixelsProven: false,
        ...details,
      },
    });
  }, [clientActivityId, geometryIdentity, mapBindingIdentity, mapEpoch, ownerUserId, pts.length]);

  useEffect(() => {
    if (pts.length < 2) return;
    recordMapMilestone('ACTIVITY_DETAIL_GEOMETRY_COMMITTED', {
      milestone: 'T3-react-source-props-committed',
      plannedRouteSelected: Boolean(plannedRouteGeometry),
    });
  }, [plannedRouteGeometry, pts.length, recordMapMilestone]);

  useEffect(() => {
    if (mapReady || !MapView || pts.length < 2) return undefined;
    const timeout = setTimeout(() => setMapLoadState('slow'), 8000);
    return () => clearTimeout(timeout);
  }, [mapEpoch, mapReady, pts.length]);
  useEffect(() => {
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') setDetailStyleGeneration(generation => generation + 1);
    });
    return () => subscription.remove();
  }, []);
  useEffect(() => {
    if (!mapReady || !bounds || !cameraRef.current) return;
    const fitIdentity = `${mapEpoch}:${mapBindingIdentity}:${Math.round(ornamentBottomClearance)}`;
    if (lastCameraFitRef.current === fitIdentity) return;
    lastCameraFitRef.current = fitIdentity;
    cameraRef.current?.fitBounds(
      [bounds.maxLng, bounds.maxLat],
      [bounds.minLng, bounds.minLat],
      [104, 40, ornamentBottomClearance + 28, 40],
      0,
    );
  }, [bounds, mapBindingIdentity, mapEpoch, mapReady, ornamentBottomClearance]);
  if (!MapView || !bounds || pts.length < 2) return null;
  const { minLat, maxLat, minLng, maxLng } = bounds;

  const start = pts[0];
  const end = pts[pts.length - 1];

  // Filter markers to only those that fall inside the track bounding
  // box (with a small buffer). Showing every marker on every activity
  // map is misleading — they only matter if they're geographically
  // near the track. Buffer = ~200m so cairns just off the trail still
  // render. (1° lat ≈ 111km, so 0.002° ≈ 220m).
  const BUFFER = 0.002;
  const trackMarkers = markers.filter(m =>
    m.lat >= minLat - BUFFER && m.lat <= maxLat + BUFFER &&
    m.lng >= minLng - BUFFER && m.lng <= maxLng + BUFFER
  );

  return (
    <View style={StyleSheet.absoluteFillObject}>
    <MapView
      key={`history-map-${session.id}-${mapEpoch}`}
      style={StyleSheet.absoluteFillObject}
      {...(resolvedMapStyle.kind === 'url'
        ? { styleURL: resolvedMapStyle.url }
        : { styleJSON: resolvedMapStyle.json })}
      logoEnabled
      attributionEnabled
      logoPosition={historyMapOrnaments.logoPosition}
      attributionPosition={historyMapOrnaments.attributionPosition}
      scaleBarEnabled={false}
      compassEnabled={false}
      onWillStartLoadingMap={() => {
        setMapReady(false);
        setMapLoadState('loading');
        recordMapMilestone('ACTIVITY_DETAIL_MAP_LOAD_STARTED');
      }}
      onDidFinishLoadingStyle={() => {
        recordMapMilestone('ACTIVITY_DETAIL_MAP_STYLE_LOADED');
        setDetailStyleGeneration(generation => generation + 1);
      }}
      onDidFinishLoadingMap={() => {
        setMapReady(true);
        setMapLoadState('loading');
        recordMapMilestone('ACTIVITY_DETAIL_MAP_LOADED');
      }}
      onDidFinishRenderingMapFully={() => {
        setMapReady(true);
        setMapLoadState('loading');
        recordMapMilestone('ACTIVITY_DETAIL_MAP_RENDER_FULL');
      }}
      onMapLoadingError={() => {
        setMapLoadState('error');
        recordMapMilestone('ACTIVITY_DETAIL_MAP_LOAD_ERROR', { status: 'error-callback' });
      }}
      onRegionDidChange={(e: any) => {
        // v198 Bug 5: any user-initiated pan/zoom flips hasPanned=true
        // so the recenter button surfaces. isUserInteraction is true
        // only for gesture-driven changes — programmatic flyTo does not
        // trigger it, so the imperative recenter below won't loop.
        if (e?.properties?.isUserInteraction) {
          setHasPanned(true);
        }
      }}
    >
      {/* R21-v3 v2 (2026-08-30): Standard style lightPreset. */}
      {mapLayer !== 'satellite' && StyleImport ? (
        <StyleImport
          key={historyLightPreset}
          id="basemap"
          existing
          config={buildStandardConfig(mapTheme) as any}
        />
      ) : null}
      {CameraComponent && (
        <CameraComponent
          ref={cameraRef}
          defaultSettings={{
            bounds: {
              ne: [maxLng, maxLat],
              sw: [minLng, minLat],
              paddingTop: 104,
              paddingBottom: ornamentBottomClearance + 28,
              paddingLeft: 40,
              paddingRight: 40,
            },
            pitch: 0,
            animationDuration: 0,
          }}
        />
      )}
      {plannedRouteGeometry ? (
        <CanonicalRouteLayer
          geometry={plannedRouteGeometry}
          theme={visualTheme}
          ShapeSource={ShapeSource}
          LineLayer={LineLayer}
          CircleLayer={CircleLayer}
          SymbolLayer={SymbolLayer}
          idPrefix={`route-detail-${geometryIdentity}`}
        />
      ) : ShapeSource && LineLayer && (() => {
        const trace = segmentTrace(pts);
        const solidFeatures = trace.segments.filter(segment => segment.length >= 2).map((segment, i) => ({
          type: 'Feature' as const,
          id: `solid-${i}`,
          geometry: { type: 'LineString' as const, coordinates: segment.map(point => [point.lng, point.lat]) },
          properties: {},
        }));
        const gapFeatures = trace.gaps.map((gap, i) => ({
          type: 'Feature' as const,
          id: `activity-gap-${i}`,
          geometry: {
            type: 'LineString' as const,
            coordinates: [[gap.from.lng, gap.from.lat], [gap.to.lng, gap.to.lat]],
          },
          properties: { displayOnly: true, evidence: 'missing-location' },
        }));
        return (
          <>
            {solidFeatures.length > 0 && (
              <ShapeSource
                key={`track-line-${mapBindingIdentity}`}
                id={`track-line-${mapBindingIdentity}`}
                shape={{ type: 'FeatureCollection', features: solidFeatures }}
              >
                <LineLayer
                  id={`track-line-layer-${mapBindingIdentity}`}
                  slot="top"
                  style={{
                    lineColor: color,
                    // Chosen Final points are rendered exactly as persisted.
                    // Seven pixels keeps out-and-back display geometry legible
                    // without applying another Detail-only simplification.
                    lineWidth: 7,
                    lineOpacity: 0.9,
                    lineCap: 'round',
                    lineJoin: 'round',
                  }}
                />
              </ShapeSource>
            )}
            {gapFeatures.length > 0 && (
              <ShapeSource
                key={`track-gaps-${mapBindingIdentity}`}
                id={`track-gaps-${mapBindingIdentity}`}
                shape={{ type: 'FeatureCollection', features: gapFeatures }}
              >
                <LineLayer
                  id={`track-gaps-layer-${mapBindingIdentity}`}
                  slot="top"
                  style={{
                    lineColor: visualTheme.mapRouteGap,
                    lineWidth: 3,
                    lineOpacity: 0.9,
                    lineDasharray: [2, 2],
                    lineCap: 'round',
                  }}
                />
              </ShapeSource>
            )}
          </>
        );
      })()}
      {PointAnnotation && (
        <>
          <PointAnnotation id="track-start" coordinate={[start.lng, start.lat]}>
            <View style={[trackStyles.nativeStartDot, { backgroundColor: plannedRouteGeometry ? visualTheme.mapRouteLine : color }]} />
          </PointAnnotation>
          <PointAnnotation id="track-end" coordinate={[end.lng, end.lat]}>
            <View style={[trackStyles.nativeEndDot, { borderColor: plannedRouteGeometry ? visualTheme.mapRouteLine : color }]} />
          </PointAnnotation>
          {/* Real marker pins anchored to GPS coords. Each pin is
              positioned by the map at its true lat/lng so it pans/
              zooms with the basemap — replaces the previous bug where
              markers were rendered as absolute-positioned Views in a
              hardcoded grid (60+i*75, 120+i*70) that ignored geography. */}
          {trackMarkers.map(m => {
            const meta = MARKER_META[m.type as keyof typeof MARKER_META] || MARKER_META.free;
            return (
              <PointAnnotation
                key={`marker-${m.id}`}
                id={`marker-${m.id}`}
                coordinate={[m.lng, m.lat]}
              >
                <View style={[trackStyles.nativeMarkerPin, { borderColor: meta.color, backgroundColor: meta.bg }]}>
                  <Icon name={meta.iconName as IconName} size={12} color={meta.color} strokeWidth={2} />
                </View>
              </PointAnnotation>
            );
          })}
        </>
      )}
    </MapView>
    {!mapReady ? (
      <MapLoadOverlay
        state={mapLoadState}
        onRetry={() => {
          setMapReady(false);
          setMapLoadState('loading');
          setMapEpoch((epoch) => epoch + 1);
        }}
        testID="history-map-load-overlay"
      />
    ) : null}
    {hasPanned && (
      <TouchableOpacity
        onPress={() => {
          // v198 Bug 5: recenter back to route bbox via imperative
          // Camera.fitBounds. flyTo doesn't trip onRegionDidChange's
          // isUserInteraction so hasPanned stays consistent until the
          // next user gesture.
          cameraRef.current?.fitBounds(
            [maxLng, maxLat],
            [minLng, minLat],
            [104, 40, ornamentBottomClearance + 28, 40], // [top, right, bottom, left]
            500,
          );
          setHasPanned(false);
        }}
        activeOpacity={0.85}
        style={trackStyles.recenterBtn}
      >
        <Icon name="Target" size={20} color={Colors.primary} strokeWidth={2} />
      </TouchableOpacity>
    )}
    </View>
  );
}

// ── Track polyline ────────────────────────────────────────────────────────────
// Converts trackPoints lat/lng to pixel positions within the map area.
// If no trackPoints, renders a dashed "No GPS" placeholder line.
function TrackPolyline({ session, planned = false }: { session: TrackingSession; planned?: boolean }) {
  const theme = useVisualTheme();
  const pts = session.trackPoints;
  const color = planned
    ? theme.mapRouteLine
    : session.activityMode === 'running' ? Colors.running : Colors.primary;

  if (pts.length < 2) {
    // v450 + O6: TrackPolyline is only rendered when isLoadingTrackPoints
    // (loadedTrackPoints===null) is FALSE — the parent gates with `null`
    // during load (see line ~979). So by the time we reach TrackPolyline,
    // the fetch has completed (or hit our 15s timeout). If the session has
    // distanceM>0 but we still have <2 points, the server has no route_points
    // AND local cache is empty. Say "Route data unavailable" rather than
    // "Loading route…" which would be misleading (nothing is loading).
    // This is Bug 5's real user-visible fix: no more infinite spinner text.
    const hasRecordedDistance = (session as any).distanceM > 0
      || (session as any).distance_m > 0;
    const label = hasRecordedDistance
      ? cairnText('map-history-screen.route-data-unavailable')
      : pts.length === 0
        ? cairnText('map-history-screen.activity-too-short-to-record-path')
        : cairnText('map-history-screen.only-one-gps-sample-keep-moving-longer');
    return (
      <View style={trackStyles.noGpsWrap}>
        <View style={[trackStyles.noGpsLine, { borderColor: color }]} />
        <Text style={[trackStyles.noGpsLabel, { color: theme.foregroundSecondary }]}>{label}</Text>
      </View>
    );
  }

  // Find bounding box of the track
  const lats = pts.map(p => p.lat);
  const lngs = pts.map(p => p.lng);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  const latRange = maxLat - minLat || 0.001;
  const lngRange = maxLng - minLng || 0.001;

  const mapW = W - MAP_PADDING * 2;
  const mapH = MAP_H - 80;

  // Map lat/lng to pixel coords
  const toPixel = (lat: number, lng: number) => ({
    x: MAP_PADDING + ((lng - minLng) / lngRange) * mapW,
    y: 60 + ((maxLat - lat) / latRange) * mapH,
  });

  // Draw as connected line segments using thin Views positioned absolutely
  const segments: { x1: number; y1: number; x2: number; y2: number }[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const isGap = (pts[i].segmentId || 'legacy-0') !== (pts[i + 1].segmentId || 'legacy-0');
    if (isGap) continue;
    const a = toPixel(pts[i].lat, pts[i].lng);
    const b = toPixel(pts[i + 1].lat, pts[i + 1].lng);
    segments.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y });
  }

  return (
    <>
      {segments.map((seg, i) => {
        const dx = seg.x2 - seg.x1;
        const dy = seg.y2 - seg.y1;
        const length = Math.sqrt(dx * dx + dy * dy);
        const angle = Math.atan2(dy, dx) * (180 / Math.PI);
        return (
          <View
            key={i}
            style={{
              position: 'absolute',
              left: seg.x1,
              top: seg.y1,
              width: length,
              height: 3,
              backgroundColor: color + 'cc',
              borderRadius: 2,
              transform: [{ rotate: `${angle}deg` }],
              transformOrigin: 'left center',
            }}
          />
        );
      })}
      {/* Start dot */}
      {pts.length > 0 && (() => {
        const start = toPixel(pts[0].lat, pts[0].lng);
        return (
          <View style={[trackStyles.trackDot, trackStyles.startDot, { left: start.x - 6, top: start.y - 6, backgroundColor: color }]} />
        );
      })()}
      {/* End dot */}
      {pts.length > 1 && (() => {
        const end = toPixel(pts[pts.length - 1].lat, pts[pts.length - 1].lng);
        return (
          <View style={[trackStyles.trackDot, trackStyles.endDot, { left: end.x - 8, top: end.y - 8, borderColor: color }]} />
        );
      })()}
    </>
  );
}

// ── Session card ─────────────────────────────────────────────────────────────
function SessionCard({ session, isSelected, isExpanded, onPress, onViewOnMap }: {
  session: TrackingSession;
  isSelected: boolean;
  isExpanded: boolean;
  onPress: () => void;
  onViewOnMap: () => void;
}) {
  const [discardOpen, setDiscardOpen] = useState(false);
  const [discardPending, setDiscardPending] = useState(false);
  const theme = useVisualTheme();
  const isRun = session.activityMode === 'running';
  const dateStr = formatDate(session.startedAt);
  // O12: settings-aware distance format.
  const dist = useDistance();
  // Display label prefers the user-assigned name; falls back to type
  // when no name was set. Earlier versions hardcoded 'Run' / 'Hike'
  // here, dropping whatever the user typed in the stop-summary sheet.
  const actLabel = session.name || (isRun ? cairnText('map-history-screen.run-cf91a63') : cairnText('map-history-screen.hike-2103d15'));
  const actColor = isRun ? Colors.running : theme.iconActive;
  const actLightBg = isRun ? Colors.runningLight : Colors.primaryLight;
  const actDeepBg = isRun
    ? Colors.runningLight.replace('0.12', '0.24')
    : Colors.primaryLight.replace('0.15', '0.28');
  const rawDistStr = dist.format(session.distanceM, 1);
  // O12 Round-3 R3-M3 + Round-5 R5-M2: rawDistStr never returns '--' (utils/geo.ts
  // formatDistance changed to '0.00' fallback). "No GPS" threshold uses meters
  // directly instead of parseFloat(rawDistStr) so it doesn't flip between units
  // (a 50m session was 'No GPS' in imperial [0.0 mi] but '0.1 km' in metric).
  // 20m is the practical GPS-noise floor.
  const distStr = session.distanceM < 20 ? 'No GPS' : rawDistStr;
  const durationStr = formatDuration(session.durationS);

  const expandAnim = useRef(new Animated.Value(isExpanded ? 1 : 0)).current;
  // STORY-00108: stagger animations for the 3 content rows
  const statsOpacity = useRef(new Animated.Value(0)).current;
  const statsTransY = useRef(new Animated.Value(10)).current;
  const previewOpacity = useRef(new Animated.Value(0)).current;
  const previewTransY = useRef(new Animated.Value(10)).current;
  const ctaOpacity = useRef(new Animated.Value(0)).current;
  const ctaTransY = useRef(new Animated.Value(10)).current;

  useEffect(() => {
    Animated.timing(expandAnim, {
      toValue: isExpanded ? 1 : 0,
      duration: isExpanded ? 280 : 220,
      easing: isExpanded ? Easing.out(Easing.cubic) : Easing.in(Easing.quad),
      // height interpolation can't use native driver on RN; JS-driven is acceptable
      // because the layout box is small (<= 210px) and runs <300ms.
      useNativeDriver: false,
    }).start();

    if (isExpanded) {
      // Reset to 0 then stagger in
      statsOpacity.setValue(0); statsTransY.setValue(10);
      previewOpacity.setValue(0); previewTransY.setValue(10);
      ctaOpacity.setValue(0); ctaTransY.setValue(10);
      Animated.stagger(40, [
        Animated.parallel([
          Animated.timing(statsOpacity, { toValue: 1, duration: 200, useNativeDriver: true }),
          Animated.timing(statsTransY, { toValue: 0, duration: 200, useNativeDriver: true }),
        ]),
        Animated.parallel([
          Animated.timing(previewOpacity, { toValue: 1, duration: 200, useNativeDriver: true }),
          Animated.timing(previewTransY, { toValue: 0, duration: 200, useNativeDriver: true }),
        ]),
        Animated.parallel([
          Animated.timing(ctaOpacity, { toValue: 1, duration: 200, useNativeDriver: true }),
          Animated.timing(ctaTransY, { toValue: 0, duration: 200, useNativeDriver: true }),
        ]),
      ]).start();
    } else {
      // Collapse — reset immediately
      statsOpacity.setValue(0); previewOpacity.setValue(0); ctaOpacity.setValue(0);
    }
  }, [isExpanded]);

  const expandedHeight = expandAnim.interpolate({ inputRange: [0, 1], outputRange: [0, 210] });

  // v412: 离线未同步 hike = 纯 placeholder 灰卡, 主体不可点, 只能长按放弃
  const isPendingSync = session.syncState === 'pending' || session.syncState === 'syncing' || session.syncState === 'sync_error';

  const handleLongPressAbandon = () => {
    if (!isPendingSync) return;
    setDiscardOpen(true);
  };

  const discardPendingActivity = async () => {
    if (discardPending) return;
    setDiscardPending(true);
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { abandonPending } = require('../services/syncDaemon');
      await abandonPending(session.id);
      setDiscardOpen(false);
    } finally {
      setDiscardPending(false);
    }
  };

  return (
    <>
    <View style={{ marginBottom: Spacing.sm }}>
      {isPendingSync ? (
        // O18 HIST-08: pending grey card is now tappable — triggers a manual
        // syncDaemon.drainPending() so users can retry without waiting for
        // the automatic cycle. Long-press still opens the abandon menu.
        <TouchableOpacity
          activeOpacity={0.7}
          onPress={onViewOnMap}
          onLongPress={handleLongPressAbandon}
          delayLongPress={800}
          accessibilityLabel={cairnText('map-history-screen.open-saved-activity-long-press-to-discard')}
        >
          <View style={[cardStyles.routeCard, { opacity: 0.62, backgroundColor: theme.surface, borderColor: theme.border }]}>
            <LinearGradient
              colors={[actLightBg, actDeepBg]}
              start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
              style={cardStyles.routeCardGradient}
            >
              <View style={cardStyles.routeCardHeader}>
                <View style={[cardStyles.iconCircle, { backgroundColor: theme.surfaceElevated, borderColor: theme.border }]}>
                  <Icon name={isRun ? 'Footprints' : 'Mountain'} size={20} color={actColor} strokeWidth={2} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[cardStyles.routeCardTitle, { color: theme.foreground }]} numberOfLines={1}>{actLabel}</Text>
                  <Text style={[cardStyles.routeCardSubtitle, { color: theme.muted }]}>{cairnText('map-history-screen.value-value-58ec54d', { distStr: distStr, durationStr: durationStr })}</Text>
                </View>
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6 }}>
                <Icon name="CloudOff" size={12} color={theme.iconInactive} strokeWidth={2} />
                <Text style={{ color: theme.foregroundSecondary, fontSize: FontSize.caption }}>
                  {session.syncState === 'syncing'
                    ? cairnText('map-history-screen.syncing')
                    : session.syncState === 'sync_error'
                      ? session.syncFailureKind === 'auth_required'
                        ? cairnText('map-history-screen.saved-here-sign-in-to-sync')
                        : session.syncFailureKind === 'action_required'
                          ? cairnText('map-history-screen.saved-here-sync-needs-review')
                          : session.syncFailureKind === 'dependency'
                            ? cairnText('map-history-screen.saved-here-resolve-other-activity')
                            : cairnText('map-history-screen.saved-here-tap-to-retry-sync')
                      : cairnText('map-history-screen.waiting-to-sync')}
                </Text>
              </View>
            </LinearGradient>
          </View>
        </TouchableOpacity>
      ) : (
      <PressRow onPress={onPress}>
        <View style={[cardStyles.routeCard, { backgroundColor: theme.surface, borderColor: theme.border }, (isSelected || isExpanded) && { backgroundColor: theme.surfaceElevated, borderColor: theme.primary }]}>
          <LinearGradient
            colors={[actLightBg, actDeepBg]}
            start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
            style={cardStyles.activityBadge}
          >
            {isRun
              ? <RunningIcon size={20} color={actColor} />
              : <HikingIcon size={20} color={actColor} />
            }
          </LinearGradient>
          <View style={cardStyles.routeInfo}>
            {/* Activity type pill badge */}
            <View style={[cardStyles.actTypePill, { backgroundColor: theme.surfaceElevated, borderColor: theme.border }]}>
              <Text style={[cardStyles.actTypePillText, { color: actColor }]}>{actLabel}</Text>
            </View>
            {/* Primary stat: duration */}
            <Text style={[cardStyles.routePrimary, { color: theme.foreground }]}>{durationStr}</Text>
            {/* Secondary line: date · distance */}
            <Text style={[cardStyles.routeMeta, { color: theme.muted }]}>{cairnText('map-history-screen.value-value-9186cbb', { dateStr: dateStr, distStr: distStr })}</Text>
          </View>
          <View style={cardStyles.routeChevron}>
            <Icon
              name={isExpanded ? 'ChevronDown' : 'ChevronRight'}
              size={IconSize.sm}
              color={isExpanded ? actColor : theme.iconInactive}
              strokeWidth={2.5}
            />
          </View>
        </View>
      </PressRow>
      )}
      {/* Inline expanded stats + route preview card — 只在非 pending 时渲染 */}
      {!isPendingSync && (
      <Animated.View style={[cardStyles.expandedArea, { height: expandedHeight, opacity: expandAnim, backgroundColor: theme.surface, borderColor: theme.border }]}>
        <Animated.View style={{ opacity: statsOpacity, transform: [{ translateY: statsTransY }] }}>
        <View style={cardStyles.expandedStats}>
          <View style={[cardStyles.expandedCapsule, { borderLeftColor: theme.iconActive, backgroundColor: theme.surfaceElevated }]}>
            <Text style={[cardStyles.expandedStatVal, { color: theme.foreground }]}>{distStr}</Text>
            {distStr !== 'No GPS' && <Text style={[cardStyles.expandedStatLbl, { color: theme.muted }]}>{dist.unit}</Text>}
          </View>
          <View style={[cardStyles.expandedCapsule, { borderLeftColor: Colors.running, backgroundColor: theme.surfaceElevated }]}>
            <Text style={[cardStyles.expandedStatVal, { color: theme.foreground }]}>{durationStr}</Text>
            <Text style={[cardStyles.expandedStatLbl, { color: theme.muted }]}>{cairnText('map-history-screen.time')}</Text>
          </View>
          <View style={[cardStyles.expandedCapsule, { borderLeftColor: Colors.severityCaution, backgroundColor: theme.surfaceElevated }]}>
            <Text style={[cardStyles.expandedStatVal, { color: theme.foreground }]}>{cairnText('map-history-screen.value-value-bd4ab4e', { value1: dist.formatElevation(session.elevationGainM ?? 0), elevUnit: dist.elevUnit })}</Text>
            <Text style={[cardStyles.expandedStatLbl, { color: theme.muted }]}>{cairnText('map-history-screen.elev')}</Text>
          </View>
          <View style={[cardStyles.expandedCapsule, { borderLeftColor: Colors.flag, backgroundColor: theme.surfaceElevated }]}>
            <Text style={[cardStyles.expandedStatVal, { color: theme.foreground }]}>{session.markerIds?.length ?? 0}</Text>
            <Text style={[cardStyles.expandedStatLbl, { color: theme.muted }]}>{cairnText('map-history-screen.flags')}</Text>
          </View>
        </View>
        </Animated.View>

        {/* Route preview card (STORY-00103 + STORY-00108) */}
        <Animated.View style={{ opacity: previewOpacity, transform: [{ translateY: previewTransY }] }}>
        <View style={[cardStyles.routePreviewCard, { backgroundColor: theme.surfaceElevated, borderColor: theme.border }]}>
          {/* Topo background — contour rings */}
          <View style={cardStyles.topoRingOuter} />
          <View style={cardStyles.topoRingMid} />
          <View style={cardStyles.topoRingInner} />
          {/* Stat chips overlaid */}
          <View style={cardStyles.previewChipsRow}>
            <View style={[cardStyles.previewChip, { backgroundColor: theme.surface, borderColor: theme.border }]}>
              <Icon name="MapPin" size={10} color={actColor} strokeWidth={2.5} />
              <Text style={[cardStyles.previewChipText, { color: actColor }]}>{distStr}</Text>
            </View>
            <View style={[cardStyles.previewChip, { backgroundColor: theme.surface, borderColor: theme.border }]}>
              <Icon name="Timer" size={10} color={actColor} strokeWidth={2.5} />
              <Text style={[cardStyles.previewChipText, { color: actColor }]}>{durationStr}</Text>
            </View>
          </View>
          {/* Route label — STORY-00108: renamed from "Route Preview" */}
          <Text style={[cardStyles.previewLabel, { color: theme.foregroundSecondary }]}>{cairnText('map-history-screen.preview')}</Text>
        </View>
        </Animated.View>

        <Animated.View style={{ opacity: ctaOpacity, transform: [{ translateY: ctaTransY }] }}>
        <TouchableOpacity style={[cardStyles.viewOnMapBtn, { backgroundColor: theme.primary }]} onPress={onViewOnMap}>
          <Icon name="Map" size={14} color={theme.onPrimary} strokeWidth={2} />
          <Text style={[cardStyles.viewOnMapText, { color: theme.onPrimary }]}>{cairnText('map-history-screen.view-on-map')}</Text>
        </TouchableOpacity>
        </Animated.View>
      </Animated.View>
      )}
    </View>
    <ModalCard
      visible={discardOpen}
      onDismiss={() => !discardPending && setDiscardOpen(false)}
      dismissible={!discardPending}
      testID="pending-activity-discard-confirmation"
    >
      <ModalCardHeader
        title={cairnText('map-history-screen.discard-saved-value', { value1: isRun ? cairnText('common.activity.run') : cairnText('common.activity.hike') })}
        body={cairnText('map-history-screen.this-activity-is-stored-on-this-device')}
      />
      <View style={styles.deleteModalActions}>
        <PrimaryButton
          label={cairnText('map-history-screen.discard-activity')}
          variant="destructive"
          onPress={() => { void discardPendingActivity(); }}
          loading={discardPending}
          testID="pending-activity-discard-confirm"
        />
        <PrimaryButton
          label={cairnText('map-history-screen.keep-activity')}
          variant="secondary"
          onPress={() => setDiscardOpen(false)}
          disabled={discardPending}
        />
      </View>
    </ModalCard>
    </>
  );
}

// ── Flag detail bottom sheet ─────────────────────────────────────────────────
function FlagDetailSheet({ marker, onClose, onDelete }: {
  marker: Marker;
  onClose: () => void;
  onDelete: () => void;
}) {
  const theme = useVisualTheme();
  const slideY = useRef(new Animated.Value(H)).current;
  const scrimOpacity = useRef(new Animated.Value(0)).current;

  React.useEffect(() => {
    Animated.parallel([
      Animated.timing(slideY, {
        toValue: 0, duration: 280, easing: Easing.out(Easing.cubic), useNativeDriver: true,
      }),
      Animated.timing(scrimOpacity, {
        toValue: 1, duration: 220, easing: Easing.out(Easing.ease), useNativeDriver: true,
      }),
    ]).start();
  }, []);

  const meta = MARKER_META[marker.type as keyof typeof MARKER_META] || MARKER_META.free;
  const date = new Date(marker.createdAt);
  const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

  const [deleteConfirm, setDeleteConfirm] = useState(false);

  const close = () => {
    setDeleteConfirm(false);
    Animated.parallel([
      Animated.timing(slideY, { toValue: H, duration: 220, easing: Easing.in(Easing.quad), useNativeDriver: true }),
      Animated.timing(scrimOpacity, { toValue: 0, duration: 200, easing: Easing.in(Easing.ease), useNativeDriver: true }),
    ]).start(() => onClose());
  };

  const handleDelete = () => {
    Animated.parallel([
      Animated.timing(slideY, { toValue: H, duration: 220, easing: Easing.in(Easing.quad), useNativeDriver: true }),
      Animated.timing(scrimOpacity, { toValue: 0, duration: 200, easing: Easing.in(Easing.ease), useNativeDriver: true }),
    ]).start(() => onDelete());
  };

  return (
    <>
      {/* Scrim — fades in/out in sync with sheet */}
      <Animated.View style={[sheetStyles.scrim, { opacity: scrimOpacity, backgroundColor: theme.readabilityScrim }]}>
        <TouchableOpacity style={StyleSheet.absoluteFillObject} activeOpacity={1} onPress={close} />
      </Animated.View>
      <Animated.View style={[sheetStyles.sheet, { transform: [{ translateY: slideY }], backgroundColor: theme.surfaceElevated, borderColor: theme.border, shadowColor: theme.shadow }]}>
        {/* Drag handle */}
        <View style={[sheetStyles.handle, { backgroundColor: theme.border }]} />
        {/* Type badge */}
        <View style={[sheetStyles.typeBadge, { backgroundColor: meta.bg, borderColor: meta.color }]}>
          <Icon name={meta.iconName as IconName} size={20} color={meta.color} strokeWidth={2} />
          <Text style={[sheetStyles.typeBadgeText, { color: meta.color }]}>{meta.label}</Text>
        </View>
        {/* Note */}
        <Text style={[sheetStyles.noteLabel, { color: theme.foregroundSecondary }]}>{cairnText('map-history-screen.note')}</Text>
        <Text style={[sheetStyles.noteText, { color: theme.foreground }]} numberOfLines={4}>{marker.note || cairnText('map-history-screen.no-note-yet')}</Text>
        {/* Date */}
        <Text style={[sheetStyles.dateLine, { color: theme.muted }]}>{cairnText('map-history-screen.planted-value', { dateStr: dateStr })}</Text>
        {/* Delete */}
        <TouchableOpacity
          style={[sheetStyles.deleteBtn, { backgroundColor: theme.surface, borderColor: theme.destructive }]}
          onPress={() => setDeleteConfirm(true)}
        >
          <Icon name="Trash2" size={IconSize.sm} color={theme.destructive} strokeWidth={2} />
          <Text style={[sheetStyles.deleteBtnText, { color: theme.destructive }]}>{cairnText('map-history-screen.delete-cairn')}</Text>
        </TouchableOpacity>
      </Animated.View>
      <CairnDeleteDialog
        visible={deleteConfirm}
        onDismiss={() => setDeleteConfirm(false)}
        onConfirm={handleDelete}
      />
    </>
  );
}

// ── Main ────────────────────────────────────────────────────────────────────
function MapHistoryObjectScreen() {
  const visualTheme = useVisualTheme();
  const insets = useSafeAreaInsets();
  const nav = useNavigation<Nav>();
  const route = useRoute<any>();
  const targetQaReviewClone = route.params?.qaReviewClone as 'almost-done-v1' | undefined;
  const targetSessionId = targetQaReviewClone
    ? ALMOST_DONE_CLONE_V1_ID
    : route.params?.sessionId as string | undefined;
  const activityBackContext = route.params?.activityBackContext as 'previous' | 'activities' | undefined;
  const targetRouteId = (route.params as { routeId?: string } | undefined)?.routeId;
  const targetSharedDeliveryId = (route.params as { sharedDeliveryId?: string } | undefined)?.sharedDeliveryId;
  const isRouteDetail = Boolean(targetRouteId || targetSharedDeliveryId);
  // 2026-08-16 Round 13: Route Detail (concept T5) — look up route object
  // by targetRouteId. Renders a full-screen route detail view with Edit Route
  // + Preview + Delete stacked buttons per row-03 col 5.
  const allRoutes = useRouteStore(s => s.routes);
  const sharedRoutes = useRouteStore(s => s.sharedRoutes);
  const selectedRoute = targetSharedDeliveryId
    ? sharedRoutes.find(item => item.sharedDeliveryId === targetSharedDeliveryId) ?? null
    : targetRouteId
      ? allRoutes.find(item => routeMatchesIdentity(item, targetRouteId)) ?? null
      : null;
  const loadRouteDetail = useRouteStore(s => s.loadRouteDetail);
  const loadSharedRouteDetail = useRouteStore(s => s.loadSharedRouteDetail);
  const removeSharedRoute = useRouteStore(s => s.removeSharedRoute);
  const captureActivityRouteReference = useRouteStore(s => s.captureActivityRouteReference);
  const ownRouteDetailState = useRouteStore(s => targetRouteId
    ? (s.routeDetailState[selectedRoute?.id ?? targetRouteId] ?? 'idle')
    : 'idle');
  const [sharedRouteDetailState, setSharedRouteDetailState] = useState<import('../store/useRouteStore').RouteDetailState>('idle');
  const routeDetailState = targetSharedDeliveryId ? sharedRouteDetailState : ownRouteDetailState;
  const [routeUseLoading, setRouteUseLoading] = useState(false);
  const [routeUseLoadingMode, setRouteUseLoadingMode] = useState<'hiking' | 'running' | null>(null);
  const [routeDeleteConfirm, setRouteDeleteConfirm] = useState(false);
  const [routeDetailPanelHeight, setRouteDetailPanelHeight] = useState(0);
  const routeFriends = useFriendStore(s => s.friends);
  const loadFriendsFromBackend = useFriendStore(s => s.loadFriendsFromBackend);
  const [routeShareOpen, setRouteShareOpen] = useState(false);
  const [routeShareRecipients, setRouteShareRecipients] = useState<string[]>([]);
  const [routeShareLoading, setRouteShareLoading] = useState(false);
  const [routeShareMessage, setRouteShareMessage] = useState<string | null>(null);
  const routeShareAttemptRef = useRef<{ signature: string; key: string } | null>(null);
  const routeUseInFlightRef = useRef(false);
  // O12: settings-aware distance format for detail modal + stat displays.
  const dist = useDistance();
  const debugMode = useSettingsStore(s => s.debugMode);
  const [activityDiagnosticsCopying, setActivityDiagnosticsCopying] = useState(false);
  const [qaReviewClone, setQaReviewClone] = useState<AlmostDoneCloneV1 | null>(null);
  const [qaReviewError, setQaReviewError] = useState<string | null>(null);
  const [snapLabRecord, setSnapLabRecord] = useState<SnapLabActivityRecord | null>(null);
  const [snapLabLoading, setSnapLabLoading] = useState(false);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  // A Detail screen owns its projection for the lifetime of this mount. Sync
  // may delete handed-off local files while the screen is open; retaining the
  // summary and trace here prevents a subsequent failed server fetch from
  // replacing a visible Activity with an empty state.
  const detailSessionSnapshots = useRef(new Map<string, TrackingSession>());
  const detailTrackSnapshots = useRef(new Map<string, import('../store/useSessionStore').TrackPoint[]>());
  const detailTrackRevisions = useRef(new Map<string, number>());
  const [expandedSessionId, setExpandedSessionId] = useState<string | null>(null);
  const [selectedMarkerId, setSelectedMarkerId] = useState<string | null>(null);
  const [tab, setTab] = useState<'routes' | 'flags'>('routes');
  // O18 HIST-01: search filter for the history list.
  const [searchQuery, setSearchQuery] = useState('');
  // O18 HIST-02: type filter (all / hiking / running), sort order, and time
  // period (all / week / month / year). All client-side over local sessions.
  const [typeFilter, setTypeFilter] = useState<'all' | 'hiking' | 'running'>('all');
  const [sortOrder, setSortOrder] = useState<'recent' | 'oldest' | 'longest'>('recent');
  const [periodFilter, setPeriodFilter] = useState<'all' | 'week' | 'month' | 'year'>('all');
  const [showFilters, setShowFilters] = useState(false);

  useEffect(() => {
    if (targetSharedDeliveryId) {
      if (selectedRoute && selectedRoute.points.length >= 2) {
        setSharedRouteDetailState('ready');
        return;
      }
      setSharedRouteDetailState('loading');
      void loadSharedRouteDetail(targetSharedDeliveryId).then(setSharedRouteDetailState);
      return;
    }
    if (!targetRouteId || (selectedRoute && selectedRoute.points.length >= 2)) return;
    void loadRouteDetail(selectedRoute?.id ?? targetRouteId).catch(() => {});
  }, [loadRouteDetail, loadSharedRouteDetail, selectedRoute?.id, selectedRoute?.points.length, targetRouteId, targetSharedDeliveryId]);

  const useSelectedRoute = useCallback(async (mode: 'hiking' | 'running' = 'hiking') => {
    if (!selectedRoute || routeUseLoading || routeUseInFlightRef.current) return;
    routeUseInFlightRef.current = true;
    setRouteUseLoading(true);
    setRouteUseLoadingMode(mode);
    try {
      if (selectedRoute.points.length < 2) {
        if (targetSharedDeliveryId) await loadSharedRouteDetail(targetSharedDeliveryId);
        else await loadRouteDetail(selectedRoute.id);
      }
      const routeState = useRouteStore.getState();
      const ready = targetSharedDeliveryId
        ? routeState.sharedRoutes.find(item => item.sharedDeliveryId === targetSharedDeliveryId)
        : routeState.routes.find(item => routeMatchesIdentity(item, selectedRoute.id));
      if (!ready || ready.points.length < 2) {
        Alert.alert(
          cairnText('map-history-screen.route-unavailable'),
          cairnText('map-history-screen.this-route-s-path-is-not-available'),
        );
        return;
      }
      if (!routeCanBeUsed(ready)) {
        Alert.alert(cairnText('map-history-screen.route-needs-repair'), cairnText('map-history-screen.connect-every-unknown-gap-before-using-this'));
        return;
      }
      const tracking = useTrackingStore.getState();
      if (tracking.status !== 'idle') {
        Alert.alert(
          cairnText('map-history-screen.activity-already-in-progress'),
          cairnText('map-history-screen.finish-or-discard-the-current-activity-before'),
          [
            {
              text: cairnText('map-history-screen.return-to-activity'),
              onPress: () => {
                routeUseInFlightRef.current = false;
                nav.navigate(tracking.activityMode === 'running' ? 'Running' : 'Hiking');
              },
            },
            { text: cairnText('map-history-screen.stay-here'), style: 'cancel', onPress: () => { routeUseInFlightRef.current = false; } },
          ],
        );
        return;
      }
      captureActivityRouteReference(ready.id);
      nav.navigate(mode === 'running' ? 'Running' : 'Hiking', { routeId: ready.id });
    } catch {
      Alert.alert(cairnText('map-history-screen.route-unavailable'), cairnText('map-history-screen.the-route-could-not-be-prepared-check'));
    } finally {
      routeUseInFlightRef.current = false;
      setRouteUseLoading(false);
      setRouteUseLoadingMode(null);
    }
  }, [captureActivityRouteReference, loadRouteDetail, loadSharedRouteDetail, nav, routeUseLoading, selectedRoute, targetSharedDeliveryId]);

  const region = getCurrentRegion();
  const allSessions = useSessionStore(s => s.sessions);
  const currentUserId = useSessionStore(s => s.currentUserId);
  const isSnapLabTarget = !!targetSessionId?.startsWith('qa-snap-');
  useEffect(() => {
    if (!isSnapLabTarget || !targetSessionId || !currentUserId) {
      setSnapLabRecord(null);
      setSnapLabLoading(false);
      return undefined;
    }
    let cancelled = false;
    setSnapLabLoading(true);
    void loadSnapLabActivity(currentUserId, targetSessionId).then(record => {
      if (cancelled) return;
      setSnapLabRecord(record);
      setSnapLabLoading(false);
      if (record) {
        detailSessionSnapshots.current.set(record.session.id, record.session);
        detailTrackSnapshots.current.set(record.session.id, record.selectedFinal);
        detailTrackRevisions.current.set(record.session.id, record.session.finalGeometryRevision ?? 1);
        void recordSnapLabDetailLoaded(currentUserId, record.activityId).catch(error => {
          crashLogger.breadcrumb(`snap_lab:detail_ledger_failed ${String(error).slice(0, 80)}`);
        });
      }
    }).catch(() => {
      if (!cancelled) {
        setSnapLabRecord(null);
        setSnapLabLoading(false);
      }
    });
    return () => { cancelled = true; };
  }, [currentUserId, isSnapLabTarget, targetSessionId]);
  const resolvedTargetSession = targetSessionId
    ? isSnapLabTarget
      ? snapLabRecord?.session ?? null
      : allSessions.find(session => activityMatchesTarget(session, targetSessionId)) ?? null
    : null;
  // A Finish/local identity and a Trails/server identity resolve to the same
  // stable Activity object. The route param never creates a second projection.
  const sessions = targetQaReviewClone
    ? (qaReviewClone ? [qaReviewClone.session] : [])
    : targetSessionId
      ? (resolvedTargetSession ? [resolvedTargetSession] : [])
      : allSessions;

  // O18 HIST-01/02: apply search + type + period filters, then sort.
  const filteredSessions = React.useMemo(() => {
    let list = sessions;
    // Type filter
    if (typeFilter !== 'all') {
      list = list.filter(s => s.activityMode === typeFilter);
    }
    // Period filter (based on startedAt)
    if (periodFilter !== 'all') {
      const cutoff = Date.now() - (periodFilter === 'week' ? 7 : periodFilter === 'month' ? 30 : 365) * 86400000;
      list = list.filter(s => (s.startedAt ?? 0) >= cutoff);
    }
    // Search filter (name match)
    const q = searchQuery.trim().toLowerCase();
    if (q) list = list.filter(s => (s.name || '').toLowerCase().includes(q));
    // Sort
    const sorted = [...list];
    if (sortOrder === 'recent') sorted.sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0));
    else if (sortOrder === 'oldest') sorted.sort((a, b) => (a.startedAt ?? 0) - (b.startedAt ?? 0));
    else if (sortOrder === 'longest') sorted.sort((a, b) => (b.distanceM ?? 0) - (a.distanceM ?? 0));
    return sorted;
  }, [sessions, searchQuery, typeFilter, periodFilter, sortOrder]);

  // Resolve again after asynchronous store hydration. A direct Detail entry
  // must not become a false missing Activity just because the local cache
  // arrived after this component mounted.
  useEffect(() => {
    const resolvedId = targetQaReviewClone
      ? qaReviewClone?.session.id ?? null
      : targetSessionId
        ? resolvedTargetSession?.id ?? null
        : sessions[0]?.id ?? null;
    if (resolvedId) {
      setSelectedSessionId(resolvedId);
      setExpandedSessionId(resolvedId);
    } else if (sessions.length > 0) {
      setSelectedSessionId(sessions[0].id);
      setExpandedSessionId(sessions[0].id);
    } else {
      setSelectedSessionId(null);
      setExpandedSessionId(null);
    }
  }, [qaReviewClone?.session.id, resolvedTargetSession?.id, sessions.length, targetQaReviewClone, targetSessionId]);
  const deleteSession = useSessionStore(s => s.deleteSession);
  // O18 HIST-03: rename hike from the detail panel.
  const renameSession = useSessionStore(s => s.renameSession);
  const [renameEditing, setRenameEditing] = useState(false);
  const [renameText, setRenameText] = useState('');
  const [renameSaving, setRenameSaving] = useState(false);
  const renameInputRef = useRef<TextInput>(null);
  const [invalidatedSessionId, setInvalidatedSessionId] = useState<string | null>(null);
  const [deleteSaving, setDeleteSaving] = useState(false);
  const [routeDraftOpening, setRouteDraftOpening] = useState(false);
  const storedMarkers = useMarkerStore(s => s.markers);
  const allMarkers = useMemo(() => markersForVisibleWorkspace(storedMarkers, debugMode), [debugMode, storedMarkers]);
  const markers = allMarkers.filter(m => m.regionCode === region.code);
  const deleteMarker = useMarkerStore(s => s.deleteMarker);
  // v74a: live GPS for "distance from current position" in flag list rows.
  // Updates reactively as the user moves (Zustand subscription).
  const lastCoord = useTrackingStore(s => s.lastCoordinate);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [routeActionError, setRouteActionError] = useState<string | null>(null);
  const routeRenameInFlightRef = useRef(false);
  const routeDeleteInFlightRef = useRef(false);

  const commitRouteRename = useCallback(async () => {
    if (!selectedRoute || renameSaving || routeRenameInFlightRef.current) return;
    const nextName = renameText.trim();
    if (!nextName) return;
    routeRenameInFlightRef.current = true;
    setRenameSaving(true);
    setRouteActionError(null);
    try {
      await useRouteStore.getState().updateRoute(selectedRoute.id, { name: nextName });
      renameInputRef.current?.blur();
      Keyboard.dismiss();
      setRenameEditing(false);
    } catch {
      setRouteActionError(cairnText('map-history-screen.the-route-name-was-not-saved-your'));
    } finally {
      routeRenameInFlightRef.current = false;
      setRenameSaving(false);
    }
  }, [renameSaving, renameText, selectedRoute]);

  const deleteSelectedRoute = useCallback(async () => {
    if (!selectedRoute || deleteSaving || routeDeleteInFlightRef.current) return;
    routeDeleteInFlightRef.current = true;
    setDeleteSaving(true);
    setRouteActionError(null);
    try {
      await useRouteStore.getState().deleteRoute(selectedRoute.id);
      setRouteDeleteConfirm(false);
      nav.goBack();
    } catch {
      setRouteActionError(cairnText('map-history-screen.the-route-was-not-deleted-try-again'));
      setRouteDeleteConfirm(false);
    } finally {
      routeDeleteInFlightRef.current = false;
      setDeleteSaving(false);
    }
  }, [deleteSaving, nav, selectedRoute]);

  const removeSelectedReceivedRoute = useCallback(async () => {
    if (!targetSharedDeliveryId || deleteSaving || routeDeleteInFlightRef.current) return;
    routeDeleteInFlightRef.current = true;
    setDeleteSaving(true);
    setRouteActionError(null);
    try {
      await removeSharedRoute(targetSharedDeliveryId);
      setRouteDeleteConfirm(false);
      nav.goBack();
    } catch {
      setRouteActionError(cairnText('map-history-screen.the-received-route-was-not-removed-try'));
      setRouteDeleteConfirm(false);
    } finally {
      routeDeleteInFlightRef.current = false;
      setDeleteSaving(false);
    }
  }, [deleteSaving, nav, removeSharedRoute, targetSharedDeliveryId]);

  const openRouteShare = useCallback(() => {
    if (!selectedRoute) return;
    if (!routeCanBeUsed(selectedRoute)) {
      setRouteActionError(cairnText('map-history-screen.connect-every-unknown-gap-before-sharing-this'));
      return;
    }
    setRouteActionError(null);
    setRouteShareMessage(null);
    setRouteShareRecipients([]);
    setRouteShareOpen(true);
    void loadFriendsFromBackend();
  }, [loadFriendsFromBackend, selectedRoute]);

  const deliverRouteSnapshot = useCallback(async () => {
    if (!selectedRoute || routeShareLoading || routeShareRecipients.length === 0) return;
    const serverRouteId = selectedRoute.remoteId
      ?? (/^\d+$/.test(selectedRoute.id) ? selectedRoute.id : null);
    if (!serverRouteId) {
      setRouteShareMessage(cairnText('map-history-screen.this-route-must-finish-syncing-before-it'));
      return;
    }
    const recipients = [...new Set(routeShareRecipients)].sort();
    const signature = `${serverRouteId}|${recipients.join(',')}`;
    if (routeShareAttemptRef.current?.signature !== signature) {
      routeShareAttemptRef.current = { signature, key: uuidv4() };
    }
    const attempt = routeShareAttemptRef.current;
    setRouteShareLoading(true);
    setRouteShareMessage(null);
    try {
      const result = await shareRouteSnapshot(serverRouteId, recipients, attempt.key);
      const delivered = result.delivered.length;
      const failed = result.failed.length;
      setRouteShareMessage(failed
        ? cairnText('map-history-screen.value-delivered-value-could-not-be-delivered', { delivered: delivered, failed: failed })
        : cairnText('routes.snapshot-delivered', { count: delivered }));
      if (failed) {
        // Retain the same operation identity and retry only recipients that
        // did not receive this snapshot. Already delivered friends are not
        // needlessly resubmitted.
        const failedRecipients = result.failed.map(item => String(item.recipient_id)).sort();
        routeShareAttemptRef.current = {
          signature: `${serverRouteId}|${failedRecipients.join(',')}`,
          key: attempt.key,
        };
        setRouteShareRecipients(failedRecipients);
      } else {
        routeShareAttemptRef.current = null;
      }
    } catch (cause: any) {
      setRouteShareMessage(cause?.code === 'ROUTE_UNRESOLVED_GAPS'
        ? cairnText('map-history-screen.connect-every-unknown-gap-before-sharing-this')
        : cairnText('map-history-screen.delivery-was-not-confirmed-retry-uses-the'));
    } finally {
      setRouteShareLoading(false);
    }
  }, [routeShareLoading, routeShareRecipients, selectedRoute]);

  useFocusEffect(useCallback(() => {
    setRouteDraftOpening(false);
    return undefined;
  }, []));

  const liveSelectedSession = sessions.find(s => s.id === selectedSessionId) ?? null;
  const retainedSelectedSession = selectedSessionId
    ? detailSessionSnapshots.current.get(selectedSessionId) ?? null
    : null;
  const selectedSession = selectedSessionId === invalidatedSessionId ? null : retainedSelectedSession
    ? {
        ...retainedSelectedSession,
        remoteId: liveSelectedSession?.remoteId ?? retainedSelectedSession.remoteId,
        syncState: liveSelectedSession?.syncState ?? retainedSelectedSession.syncState,
        finalGeometryState: liveSelectedSession?.finalGeometryState ?? retainedSelectedSession.finalGeometryState,
        finalGeometryVersion: liveSelectedSession?.finalGeometryVersion ?? retainedSelectedSession.finalGeometryVersion,
        finalGeometryRevision: liveSelectedSession?.finalGeometryRevision ?? retainedSelectedSession.finalGeometryRevision,
        finalGeometryFingerprint: liveSelectedSession?.finalGeometryFingerprint ?? retainedSelectedSession.finalGeometryFingerprint,
        roadRefinementPending: liveSelectedSession?.roadRefinementPending ?? retainedSelectedSession.roadRefinementPending,
      }
    : liveSelectedSession;
  const selectedMarker = markers.find(m => m.id === selectedMarkerId) ?? null;

  const returnToActivities = useCallback(() => {
    // Activity Detail is a post-save leaf, not a historical stack owner.
    // Always replace it with the canonical Trails/Activities stack. A plain
    // goBack could return to Hike/Home, while a later Trails Back could expose
    // the retained Detail again (the O37 navigation loop).
    nav.dispatch(CommonActions.reset({
      index: 1,
      routes: [{ name: 'Home' }, { name: 'Routes', params: { initialTab: 'activities' } }],
    }));
  }, [nav]);

  const handleActivityBack = useCallback(() => {
    const action = resolveActivityDetailBackAction(activityBackContext, nav.canGoBack());
    if (action === 'go-back') {
      nav.goBack();
      return;
    }
    returnToActivities();
  }, [activityBackContext, nav, returnToActivities]);

  const commitActivityRename = useCallback(async () => {
    const id = selectedSessionId;
    const trimmed = renameText.trim();
    if (!id || id === invalidatedSessionId || !trimmed || renameSaving) return;
    if (id.startsWith('qa-snap-')) return;
    setRenameSaving(true);
    const result = await renameSession(id, trimmed);
    setRenameSaving(false);
    if (result.ok) {
      renameInputRef.current?.blur();
      Keyboard.dismiss();
      setRenameEditing(false);
      return;
    }
    const message = result.reason === 'syncing'
      ? cairnText('map-history-screen.this-activity-is-syncing-try-renaming-again')
      : result.reason === 'pending-missing'
        ? cairnText('map-history-screen.the-pending-activity-save-could-not-be')
        : result.reason === 'identity-conflict'
          ? cairnText('map-history-screen.this-activity-has-a-server-identity-conflict')
        : result.reason === 'not-found'
          ? cairnText('map-history-screen.this-activity-no-longer-exists-rename-was')
          : cairnText('map-history-screen.rename-could-not-be-saved-check-your');
    Alert.alert(cairnText('map-history-screen.rename-failed'), message);
  }, [invalidatedSessionId, renameSaving, renameSession, renameText, selectedSessionId]);

  const deleteSelectedActivity = useCallback(async () => {
    const id = selectedSessionId;
    if (!id || id === invalidatedSessionId || deleteSaving) return;
    if (id.startsWith('qa-snap-')) return;
    // Invalidate this mounted projection before the first await. It can no
    // longer rename, create a Route, or re-delete while persistence runs.
    setInvalidatedSessionId(id);
    setDeleteSaving(true);
    setRenameEditing(false);
    detailSessionSnapshots.current.delete(id);
    detailTrackSnapshots.current.delete(id);
    detailTrackRevisions.current.delete(id);
    try {
      const result = await deleteSession(id);
      setSelectedSessionId(null);
      setDeleteConfirm(false);
      nav.dispatch(CommonActions.reset({
        index: 1,
        routes: [{ name: 'Home' }, { name: 'Routes', params: { initialTab: 'activities' } }],
      }));
      if (result.remoteState === 'queued') {
        Alert.alert(
          cairnText('map-history-screen.delete-queued'),
          cairnText('map-history-screen.the-activity-is-removed-from-this-iphone'),
        );
      }
    } catch {
      setInvalidatedSessionId(null);
      Alert.alert(cairnText('map-history-screen.delete-failed'), cairnText('map-history-screen.the-activity-could-not-be-deleted-try'));
    } finally {
      setDeleteSaving(false);
    }
  }, [deleteSaving, deleteSession, invalidatedSessionId, nav, selectedSessionId]);

  // Load track points on demand when session is selected.
  //
  // v73: source of truth for activity-detail trackPoints is the SERVER
  // (GET /api/sessions/:remoteId). Local AsyncStorage was unreliable —
  // (a) cross-device installs wouldn't have the local cache; (b) the
  // local id used as the storage key didn't always match the server-id
  // that hydrate() rebuilt the session list with, so the lookup
  // silently returned [] even when local data existed. Network failure
  // falls back to local storage as a best-effort.
  // v261: trackPoints state is now nullable to distinguish "still loading"
  // from "really empty". Previously useState<TrackPoint[]>([]) caused the
  // first frame to render "Activity too short to record path" before
  // fetchSessionDetail / loadTrackPoints resolved (typically 50-800ms).
  // Symptom: every Activity Detail open flashed the too-short message
  // for ~half a second before the real polyline appeared. With null,
  // first frame renders nothing while loading; only when the load
  // completes (with [] for genuinely empty or [pts] for loaded) do we
  // decide whether to show too-short or the polyline.
  const [loadedTrackPoints, setLoadedTrackPoints] = useState<import('../store/useSessionStore').TrackPoint[] | null>(null);
  useEffect(() => {
    if (!targetQaReviewClone) return undefined;
    let cancelled = false;
    const ownerUserId = useSessionStore.getState().currentUserId;
    setQaReviewError(null);
    void loadOrBuildAlmostDoneCloneV1(ownerUserId, debugMode).then(clone => {
      if (cancelled) return;
      setQaReviewClone(clone);
      detailSessionSnapshots.current.set(clone.session.id, clone.session);
      detailTrackSnapshots.current.set(clone.session.id, clone.session.trackPoints);
      setLoadedTrackPoints(clone.session.trackPoints);
    }).catch(error => {
      if (cancelled) return;
      setQaReviewError(String(error?.message ?? error));
      setLoadedTrackPoints([]);
    });
    return () => { cancelled = true; };
  }, [debugMode, targetQaReviewClone]);
  useEffect(() => {
    if (targetQaReviewClone) return undefined;
    if (!selectedSessionId) { setLoadedTrackPoints(null); return; }
    if (selectedSessionId.startsWith('qa-snap-')) {
      if (!snapLabRecord || snapLabRecord.activityId !== selectedSessionId) {
        setLoadedTrackPoints(null);
        return undefined;
      }
      const snapshot = snapLabRecord.selectedFinal.map(point => ({ ...point }));
      detailSessionSnapshots.current.set(selectedSessionId, snapLabRecord.session);
      detailTrackSnapshots.current.set(selectedSessionId, snapshot);
      detailTrackRevisions.current.set(
        selectedSessionId,
        snapLabRecord.session.finalGeometryRevision ?? 1,
      );
      setLoadedTrackPoints(snapshot);
      return undefined;
    }
    const session = useSessionStore.getState().sessions.find(s => s.id === selectedSessionId) ?? null;
    if (session && !detailSessionSnapshots.current.has(selectedSessionId)) {
      detailSessionSnapshots.current.set(selectedSessionId, {
        ...session,
        trackPoints: [...(session.trackPoints ?? [])],
        markerIds: [...(session.markerIds ?? [])],
      });
    }
    const retainedTrack = detailTrackSnapshots.current.get(selectedSessionId);
    const requestedRevision = session?.finalGeometryRevision ?? 0;
    const retainedRevision = detailTrackRevisions.current.get(selectedSessionId) ?? 0;
    const expectedFinalFingerprint = session?.finalGeometryFingerprint ?? null;
    const retainedFingerprintMatches = !expectedFinalFingerprint
      || (retainedTrack && activityGeometryFingerprint(retainedTrack) === expectedFinalFingerprint);
    if (retainedTrack && retainedRevision >= requestedRevision && retainedFingerprintMatches) {
      setLoadedTrackPoints(retainedTrack);
      return;
    }
    const hasVisibleLocalFallback = !!(session
      && Array.isArray(session.trackPoints)
      && session.trackPoints.length >= 2
      && (
        requestedRevision === 0
        || !expectedFinalFingerprint
        || activityGeometryFingerprint(session.trackPoints) === expectedFinalFingerprint
      ));
    if (hasVisibleLocalFallback && session) {
      const snapshot = session.trackPoints.map(point => ({ ...point }));
      detailTrackSnapshots.current.set(selectedSessionId, snapshot);
      detailTrackRevisions.current.set(selectedSessionId, requestedRevision);
      setLoadedTrackPoints(snapshot);
      if (requestedRevision > 0) return;
    }
    // Keep the already-rendered local Final visible while artifact/server
    // restoration runs. Clearing it here caused a route → spinner → route
    // flash whenever a revision-0 local snapshot was the initial authority.
    if (!hasVisibleLocalFallback) setLoadedTrackPoints(null);
    let cancelled = false;
    // O6 (2026-07-26): 添加 15s 超时。之前 fetchSessionDetail 无超时,
    // 若网络卡住 (server slow / 用户切飞行模式 mid-fetch) 就永远
    // stuck 在 loadedTrackPoints=null 状态,TrackPolyline 显示
    // "Loading route…" 转圈永远不停。这是 Bug 5 根因。超时后 fall
    // through 到 local cache;如果 local 也空则显示 "Route data unavailable"。
    const timeoutMs = 15000;
    let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
    (async () => {
      const ownerUserId = useSessionStore.getState().currentUserId;
      const clientActivityId = session?.clientActivityId ?? session?.id ?? selectedSessionId;
      const artifact = await loadActivityFinalArtifact(ownerUserId, clientActivityId);
      if (!cancelled && artifact && activityFinalArtifactMatchesExpected(
        artifact,
        requestedRevision,
        expectedFinalFingerprint,
      )) {
        const snapshot = artifact.points.map(point => ({ ...point }));
        detailTrackSnapshots.current.set(selectedSessionId, snapshot);
        detailTrackRevisions.current.set(selectedSessionId, artifact.revision);
        setLoadedTrackPoints(snapshot);
        void recordActivityStageEvent({
          ownerUserId,
          clientActivityId,
          stage: 'detail-selected',
          details: {
            consumer: 'activity-detail',
            artifactSource: artifact.source,
            artifactRevision: artifact.revision,
            artifactFingerprint: artifact.displayFingerprint,
          },
        });
        return;
      }
      const remoteId = session?.remoteId;
      if (remoteId != null && !session?.identityConflict) {
        const detailPromise = fetchSessionDetail(remoteId);
        const timeoutPromise = new Promise<null>((resolve) => {
          timeoutHandle = setTimeout(() => resolve(null), timeoutMs);
        });
        const detail = await Promise.race([detailPromise, timeoutPromise]);
        if (timeoutHandle) { clearTimeout(timeoutHandle); timeoutHandle = null; }
        // O11 (2026-07-27): 检查 route_points **长度** >= 2, 不是简单 truthy。
        // 空数组 [] 是 truthy → 老代码把空 route_points 也当成成功 fetch,
        // setLoadedTrackPoints([]) → skip fall-back → "Route data unavailable"。
        // 用户场景: syncState='pending' session 有 remoteId 但 server 的
        // route_points=[] (saveHikeAtomic 失败, 只有 startSession 空 row)。
        // 本地 trackPoints 完整,应该回 local cache 拿。
        const remotePts = (detail as any)?.route_points;
        if (!cancelled && detail && Array.isArray(remotePts) && remotePts.length >= 2) {
          // Server points may use a different field shape (lat/lng/timestamp)
          // than the local TrackPoint (lat/lng/alt/t). Normalise.
          const normalised = remotePts.map((p: any) => ({
            lat: p.lat,
            lng: p.lng,
            alt: p.alt ?? null,
            t: typeof p.t === 'number' ? p.t : (p.timestamp ? Date.parse(p.timestamp) : Date.now()),
            segmentId: p.segment_id ?? p.segmentId ?? 'legacy-0',
            segmentStartReason: p.segment_start_reason ?? p.segmentStartReason,
          }));
          // A delayed server response is not permission to downgrade a known
          // local Final revision. Cross-device/legacy rows without an expected
          // fingerprint retain the existing server-restoration behavior.
          if (!activityFinalPointsMatchExpected(normalised, expectedFinalFingerprint)) {
            // Continue to the durable local cache below.
          } else {
            const restored = await commitActivityFinalArtifact({
              ownerUserId,
              clientActivityId,
              canonicalPoints: normalised,
              displayPoints: normalised,
              source: 'server-restored',
            }).catch(() => null);
            const restoredPoints = restored?.artifact.points ?? normalised;
            detailTrackSnapshots.current.set(selectedSessionId, restoredPoints);
            if (restored) detailTrackRevisions.current.set(selectedSessionId, restored.artifact.revision);
            setLoadedTrackPoints(restoredPoints);
            return;
          }
        }
        // O6: server 请求 timeout 或 route_points 为空/太短 → 落 local。
      }
      // No remoteId yet (offline-only session) or fetch failed/timed out — fall
      // back to local cache. If local also empty, set [] so UI can stop the
      // spinner and show the correct message ("too short" for distanceM===0
      // sessions, or a clean "no route data" state for others).
      const local = session
        ? await loadActivityTrackPoints(session)
        : [];
      if (!cancelled) {
        const candidate = local ?? [];
        const snapshot = activityFinalPointsMatchExpected(candidate, expectedFinalFingerprint)
          ? candidate
          : [];
        detailTrackSnapshots.current.set(selectedSessionId, snapshot);
        detailTrackRevisions.current.set(selectedSessionId, requestedRevision);
        setLoadedTrackPoints(snapshot);
      }
    })().catch(() => {
      if (!cancelled) {
        const retained = detailTrackSnapshots.current.get(selectedSessionId) ?? [];
        setLoadedTrackPoints(retained);
      }
    });
    return () => {
      cancelled = true;
      if (timeoutHandle) { clearTimeout(timeoutHandle); timeoutHandle = null; }
    };
  }, [
    selectedSessionId,
    liveSelectedSession?.clientActivityId,
    liveSelectedSession?.remoteId,
    liveSelectedSession?.serverActivityId,
    liveSelectedSession?.finalGeometryRevision,
    liveSelectedSession?.finalGeometryFingerprint,
    snapLabRecord,
  ]);

  // Merge loaded track points into the selected session for display.
  // v261: when loadedTrackPoints === null we are still loading; pass [] so
  // existing length-checks stay safe, but track the loading flag separately.
  const isLoadingTrackPoints = loadedTrackPoints === null;
  const sessionForDisplay = selectedSession
    ? { ...selectedSession, trackPoints: loadedTrackPoints ?? [] }
    : null;
  const isQaReviewClone = selectedSession?.id === ALMOST_DONE_CLONE_V1_ID;
  const isSnapLabActivity = selectedSession?.qaProvenance === 'snap_lab';
  const selectedActivityRouteState = selectedSession
    ? deriveActivityRouteState({ session: selectedSession, trackPoints: loadedTrackPoints })
    : null;
  const selectedActivityNotices = selectedActivityRouteState
    ? activityDetailNotices(selectedActivityRouteState)
    : [];

  // `trackPoints` is the chosen, durably persisted Final display geometry.
  // Detail renders it exactly; Activity metrics and Memory remain independent
  // canonical truth and are never recomputed here.
  const sessionRender = sessionForDisplay;
  const routeFlags: Marker[] = isQaReviewClone || !selectedSession
    ? []
    : linkedCairnsForActivity(markers, selectedSession);
  const selectedMetricLabels = selectedSession
    ? activityMetricLabels(selectedSession.activityMode)
    : activityMetricLabels('hiking');

  const saveSnapLabRouteDraft = useCallback(() => {
    if (!selectedSession || routeDraftOpening) return;
    if (selectedSession.qaProvenance !== 'snap_lab') return;
    const ownerUserId = useSessionStore.getState().currentUserId;
    setRouteDraftOpening(true);
    void saveSnapLabRouteSnapshot(
      ownerUserId,
      selectedSession.id,
      `${selectedSession.name || 'QA Activity'} route`,
    ).then(() => {
      Alert.alert(cairnText('map-history-screen.qa-route-snapshot-saved'), cairnText('map-history-screen.the-selected-final-was-copied-inside-snap'));
    }).catch(() => {
      Alert.alert(cairnText('map-history-screen.qa-route-snapshot-failed'), cairnText('map-history-screen.the-snap-lab-activity-remains-saved-try'));
    }).finally(() => setRouteDraftOpening(false));
  }, [routeDraftOpening, selectedSession]);

  const createRouteFromActivity = useCallback(() => {
    if (!selectedSession || routeDraftOpening) return;
    setRouteDraftOpening(true);
    nav.navigate('RouteEditor', {
      creationSource: 'activity',
      fromSessionId: selectedSession.id,
      creationSessionId: createRouteCreationSessionId(),
    });
    // The editor owns an immutable imported draft after navigation. Release
    // the local double-tap guard on the next turn so returning to Detail keeps
    // the action usable without coupling either record's lifecycle.
    setTimeout(() => setRouteDraftOpening(false), 0);
  }, [nav, routeDraftOpening, selectedSession]);

  const copySelectedActivityDiagnostics = useCallback(async () => {
    if (!debugMode || !selectedSession || activityDiagnosticsCopying) return;
    const ownerUserId = useSessionStore.getState().currentUserId;
    if (!ownerUserId) return;
    const clientActivityId = selectedSession.clientActivityId ?? selectedSession.id;
    const selectedSnapshotId = selectedSession.id;
    setActivityDiagnosticsCopying(true);
    try {
      const realm = selectedSession.qaProvenance === 'snap_lab' ? 'snap-lab' : 'production';
      const ledger = await exportActivityStageLedger(ownerUserId, clientActivityId, realm);
      const nativeGpsEvidence = await exportNativeGpsEvidence(ownerUserId, clientActivityId);
      const nativeCrossLedgerReport = buildActivityNativeCrossLedgerReport(ledger, nativeGpsEvidence);
      const diagnosticReplay = await exportActivityDiagnosticReplayIfPresent({
        ownerUserId,
        clientActivityId,
        stageLedger: ledger,
      });
      if (useSessionStore.getState().currentUserId !== ownerUserId
        || selectedSessionId !== selectedSnapshotId) return;
      const Clipboard = await import('expo-clipboard');
      await Clipboard.setStringAsync(JSON.stringify({
        schema: 'cairn-selected-activity-forensic-export',
        version: 1,
        selectedSessionId: selectedSnapshotId,
        selectedClientActivityId: clientActivityId,
        stageLedger: ledger,
        nativeGpsEvidence,
        nativeCrossLedgerReport,
        diagnosticReplay,
      }, null, 2));
      Alert.alert(
        cairnText('map-history-screen.activity-diagnostics-copied'),
        diagnosticReplay
          ? cairnText('map-history-screen.this-selected-activity-s-opted-in-replay')
          : cairnText('map-history-screen.this-selected-activity-s-exact-id-timing'),
      );
    } catch {
      if (useSessionStore.getState().currentUserId === ownerUserId) {
        Alert.alert(cairnText('map-history-screen.could-not-copy-diagnostics'), cairnText('map-history-screen.try-again-after-reopening-this-activity'));
      }
    } finally {
      if (useSessionStore.getState().currentUserId === ownerUserId) {
        setActivityDiagnosticsCopying(false);
      }
    }
  }, [activityDiagnosticsCopying, debugMode, selectedSession, selectedSessionId]);

  // Show real markers on map. Activity Detail requires explicit Activity
  // provenance or recorded marker membership; spatial proximity alone never
  // claims that an arbitrary Cairn came from this Activity.
  const mapMarkers: Marker[] = sessionForDisplay
    ? routeFlags
    : markers.slice(0, 8);
  const routePreviewGeometry = useMemo(
    () => selectedRoute ? canonicalRouteGeometry(selectedRoute) : null,
    [selectedRoute],
  );
  const routePreviewPoints = routePreviewGeometry?.parts.flatMap((part, partIndex) => part.points.map((point, pointIndex) => ({
    ...point,
    t: (selectedRoute?.createdAt ?? 0) + partIndex * 1_000_000 + pointIndex,
    segmentId: part.id,
  }))) ?? [];
  const routePreviewSession = selectedRoute && routePreviewPoints.length >= 2
    ? ({
        id: `route-preview-${selectedRoute.id}`,
        activityMode: selectedRoute.activityMode ?? 'hiking',
        trackPoints: routePreviewPoints,
      } as unknown as TrackingSession)
    : null;

  return (
    <View style={[styles.container, { backgroundColor: visualTheme.background }]}>
      {/* Map area */}
      <View style={[styles.mapArea, { backgroundColor: visualTheme.background }]}>
        {/* Track polyline when session selected. Native RNMapbox and the Web
            GL adapter render the same source/layer contract; only a missing
            renderer falls back to the SVG-on-panel presentation. */}
        {routePreviewSession ? (
          MapView
            ? <NativeTrackMap
                session={routePreviewSession}
                markers={[]}
                plannedRouteGeometry={routePreviewGeometry ?? undefined}
                ornamentBottomClearance={(routeDetailPanelHeight || HISTORY_ROUTE_ORNAMENT_FALLBACK_CLEARANCE) + Spacing.sm}
              />
            : <TrackPolyline session={routePreviewSession} planned />
        ) : isRouteDetail ? (
          <View style={trackStyles.noGpsWrap} testID="route-map-unavailable">
            {routeDetailState === 'loading' ? <ActivityIndicator color={visualTheme.primary} /> : null}
            <Text style={[trackStyles.noGpsLabel, { color: visualTheme.foregroundSecondary }]}>
              {routeDetailState === 'not-found'
                ? cairnText('map-history-screen.route-unavailable')
                : routeDetailState === 'error'
                  ? cairnText('map-history-screen.route-map-unavailable-details-remain-accessible-offline')
                  : cairnText('map-history-screen.preparing-route-map')}
            </Text>
          </View>
        ) : sessionRender ? (
          isLoadingTrackPoints
            // v261: still fetching trackPoints — render nothing in the
            // map area instead of flashing "Activity too short to record
            // path" for ~half a second. The summary card at the bottom
            // (km/time/elev) renders unaffected from server summary.
            ? null
            : MapView && sessionRender.trackPoints.length >= 2
              ? <NativeTrackMap
                  session={sessionRender}
                  markers={routeFlags}
                  ornamentBottomClearance={Math.min(H * 0.68, 580) + Spacing.sm}
                />
              : <TrackPolyline session={sessionRender} />
        ) : (
          // 2026-08-16: 3 decorative lines only render when there are sessions
          // available (they hint at abstracted route swatches). Empty state
          // (sessions.length === 0) hides them — subagent QA feedback said the
          // 3 lines read as broken UI without context on true empty state.
          sessions.length > 0 ? (
            <>
              <View style={styles.routeLine1} />
              <View style={styles.routeLine2} />
              <View style={styles.routeLine3} />
            </>
          ) : null
        )}

        {/* User decision 2026-08-16: Trails index view has NO map placeholder
            label (previously showed "History" + "Select a route below to view").
            The tab bar (Activities/Routes/Cairns) below already anchors context.
            Only the decorative offset lines render in the empty map area. */}

        {/* Real marker pins.
            ⚠️ When NativeTrackMap is rendering, markers are drawn INSIDE
            the map (anchored to true GPS coords via PointAnnotation).
            This outer hardcoded-grid layer is only meaningful as a
            decorative pin band on the SVG fallback path; on the real
            map it would float on top in random positions. So we skip
            it whenever a session is selected and the native map is up. */}
        {!((sessionRender && MapView && sessionRender.trackPoints.length >= 2) || (routePreviewSession && MapView)) && mapMarkers.map((m, i) => {
          const meta = MARKER_META[m.type as keyof typeof MARKER_META] || MARKER_META.free;
          return (
            <View
              key={m.id}
              style={[
                styles.markerPin,
                {
                  left: 60 + (i % 4) * 75,
                  top: 120 + (i % 3) * 70,
                  borderColor: meta.color,
                  backgroundColor: meta.bg,
                },
              ]}
            >
              <Icon name={meta.iconName as IconName} size={13} color={meta.color} strokeWidth={2} />
            </View>
          );
        })}
      </View>

      {/* Top bar — overlays map */}
      <SafeAreaView style={styles.topBar} edges={['top']}>
        <View style={styles.topRow} testID={isRouteDetail ? 'route-detail-header' : undefined}>
          <BackButton
            variant={isRouteDetail ? 'mapInline' : 'inline'}
            onPress={targetSessionId
              ? handleActivityBack
              : undefined}
          />
          {/* User decision 2026-08-16: Trails index view (no targetSessionId)
              has NO top title — the tab bar (Activities/Routes/Cairns) below
              already anchors the context. Only detail views show a title.
              Type-specific label based on which detail is open. */}
          {isRouteDetail ? (
            <View pointerEvents="none" style={styles.routeHeaderTitleWrap}>
              <View style={[styles.routeHeaderTitleChip, { backgroundColor: visualTheme.mapOverlay, borderColor: visualTheme.border }]}>
                <Text style={[styles.routeHeaderTitleText, { color: visualTheme.foreground }]}>{cairnText('map-history-screen.route')}</Text>
              </View>
            </View>
          ) : (
            <Text style={[styles.topTitle, { color: visualTheme.foreground }]}>{targetSessionId ? cairnText('map-history-screen.activity-detail') : (tab === 'flags' ? cairnText('map-history-screen.cairns') : cairnText('map-history-screen.routes'))}</Text>
          )}
          {/* User decision 2026-08-16: Plan button removed from Trails top row.
              Also drop the right-side spacer — nothing to balance now. */}
          {!isRouteDetail ? <View style={{ width: 44 }} /> : null}
        </View>

        {/* Tab bar — only show when viewing all sessions (Trails index). Hide
            for both Activity Detail (targetSessionId) and Route Detail (targetRouteId). */}
        {!targetSessionId && !isRouteDetail && (
          <View style={styles.tabBar}>
            <TouchableOpacity
              style={[styles.tabItem, tab === 'routes' && styles.tabItemActive]}
              onPress={() => setTab('routes')}
            >
              <Icon name="Route" size={14} color={tab === 'routes' ? Colors.primary : Colors.textSecondary} strokeWidth={2} />
              <Text style={[styles.tabText, tab === 'routes' && styles.tabTextActive]}>{cairnText('map-history-screen.routes-value', { value1: sessions.length > 0 ? cairnText('map-history-screen.value', { length: sessions.length }) : '' })}</Text>
            </TouchableOpacity>
          </View>
        )}
      </SafeAreaView>

      {/* Bottom panel — simplified for single session, full list for all sessions */}
      {/* 2026-08-17 Route Detail (concept crops/05): panel handle + title with
          pencil (rename via updateRoute) + 3-col stats (km / points / elev) +
          Edit Route (deep green pill, full width) stacked above Delete
          (red outline pill, full width). Pill radius 14, minHeight 54 — Auth
          submit style. */}
      {isRouteDetail && selectedRoute ? (
        <>
        <View
          style={[styles.singleSessionPanel, styles.routeDetailPanel, { paddingBottom: Math.max(insets.bottom, Spacing.base) + Spacing.sm, backgroundColor: visualTheme.surfaceElevated, borderColor: visualTheme.border, shadowColor: visualTheme.shadow }]}
          testID="route-detail-panel"
          onLayout={event => {
            const height = Math.ceil(event.nativeEvent.layout.height);
            setRouteDetailPanelHeight(current => current === height ? current : height);
          }}
        >
          <View style={styles.routeTitleRow}>
            {renameEditing ? (
              <View style={styles.routeRenameRow}>
                <TextInput
                  ref={renameInputRef}
                  style={[styles.renameInput, { color: visualTheme.foreground, borderBottomColor: visualTheme.primary }]}
                  value={renameText}
                  onChangeText={setRenameText}
                  autoFocus
                  maxLength={60}
                  editable={!renameSaving}
                  onSubmitEditing={() => { void commitRouteRename(); }}
                  returnKeyType="done"
                  placeholder={cairnText('map-history-screen.route-name')}
                  placeholderTextColor={visualTheme.muted}
                />
                <TouchableOpacity
                  onPress={() => { void commitRouteRename(); }}
                  disabled={renameSaving || !renameText.trim()}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  accessibilityLabel={cairnText('map-history-screen.save-new-route-name')}
                >
                  {renameSaving
                    ? <ActivityIndicator size="small" color={visualTheme.primary} />
                    : <Icon name="Check" size={20} color={visualTheme.iconActive} strokeWidth={2.5} />}
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => { renameInputRef.current?.blur(); Keyboard.dismiss(); setRenameEditing(false); }}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  accessibilityLabel={cairnText('map-history-screen.cancel-rename')}
                >
                  <Icon name="X" size={20} color={visualTheme.iconInactive} strokeWidth={2.5} />
                </TouchableOpacity>
              </View>
            ) : (
              <View style={styles.routeTitleDisplayRow}>
                <TouchableOpacity
                  style={styles.routeTitleAction}
                  disabled={isQaReviewClone || Boolean(targetSharedDeliveryId)}
                  onPress={() => {
                    setRenameText(selectedRoute.name || cairnText('map-history-screen.route'));
                    setRenameEditing(true);
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={cairnText('map-history-screen.rename-route')}
                  hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
                >
                  <View style={styles.routeTitleCopy}>
                    <Text style={[styles.routeDetailTitle, { color: visualTheme.foreground }]} numberOfLines={2}>{selectedRoute.name || cairnText('map-history-screen.route')}</Text>
                    {!targetSharedDeliveryId ? <Icon name="Pencil" size={14} color={visualTheme.iconInactive} strokeWidth={2} /> : null}
                  </View>
                </TouchableOpacity>
                {!targetSharedDeliveryId ? (
                  <TouchableOpacity
                    style={styles.routeShareIconAction}
                    onPress={openRouteShare}
                    disabled={!routeCanBeUsed(selectedRoute)}
                    accessibilityRole="button"
                    accessibilityLabel={cairnText('map-history-screen.share-route-with-friends')}
                    accessibilityState={{ disabled: !routeCanBeUsed(selectedRoute) }}
                    testID="route-share-action"
                  >
                    <Icon name="Share2" size={IconSize.sm} color={routeCanBeUsed(selectedRoute) ? visualTheme.iconActive : visualTheme.iconInactive} strokeWidth={2} />
                  </TouchableOpacity>
                ) : null}
              </View>
            )}
          </View>
          {!targetSharedDeliveryId && selectedRoute.syncState && selectedRoute.syncState !== 'synced' ? (
            <View style={styles.routeSyncBlock}>
              <SyncBadge
                state={selectedRoute.syncState}
                onPress={selectedRoute.syncState === 'failed'
                  && selectedRoute.syncErrorCode !== 'SOURCE_ACTIVITY_DELETED'
                  && selectedRoute.syncErrorCode !== 'SOURCE_ACTIVITY_UNAUTHORIZED'
                  ? () => useRouteStore.getState().retryRouteSync(selectedRoute.id)
                  : undefined}
              />
              {selectedRoute.syncState === 'failed' ? (
                <Text style={[styles.routeStateText, { color: visualTheme.foregroundSecondary }]} testID="route-sync-failure-detail">
                  {selectedRoute.syncErrorCode === 'SOURCE_ACTIVITY_DELETED'
                    ? cairnText('map-history-screen.the-source-activity-was-deleted-before-this')
                    : selectedRoute.syncErrorCode === 'SOURCE_ACTIVITY_UNAUTHORIZED'
                      ? cairnText('map-history-screen.the-source-activity-is-not-available-to')
                      : cairnText('map-history-screen.this-route-is-saved-on-this-device')}
                </Text>
              ) : null}
            </View>
          ) : null}
          {routeActionError ? (
            <Text style={[styles.routeStateText, { color: visualTheme.destructive }]} testID="route-action-error">
              {routeActionError}
            </Text>
          ) : null}
          <View style={styles.routeOriginBlock} testID="route-origin-context">
            <Text style={[styles.routeOriginText, { color: visualTheme.foregroundSecondary }]}>{cairnText('map-history-screen.value-value-7e51f13', { value1: targetSharedDeliveryId
                ? cairnText('map-history-screen.value-received-value', { value1: routeSourceLabel(selectedRoute), value2: formatDate(selectedRoute.createdAt) })
                : cairnText('map-history-screen.value-saved-value', { value1: selectedRoute.creationOrigin === 'activity' ? cairnText('map-history-screen.from-activity') : cairnText('map-history-screen.planned-route'), value2: formatDate(selectedRoute.createdAt) }), value2: routeHasReadyStatus(selectedRoute) ? '' : cairnText('map-history-screen.value-7455c9a', { value1: routeStatusLabel(selectedRoute) }) })}</Text>
            {selectedRoute.originPersistence === 'legacy-local' ? (
              <Text style={[styles.routeStateText, { color: Colors.warning }]}>{cairnText('map-history-screen.origin-is-saved-on-this-device-server')}</Text>
            ) : null}
          </View>
          {!routeCanBeUsed(selectedRoute) ? (
            <Text style={[styles.routeStateText, { color: Colors.warning }]} testID="route-unresolved-gap-notice">{cairnText('map-history-screen.this-draft-contains-unknown-gaps-repair-them')}</Text>
          ) : null}
          <View style={styles.singleSessionStats}>
            <View style={styles.singleStat}>
              <Text style={[styles.singleStatValue, { color: visualTheme.foreground }]}>{dist.format(selectedRoute.distanceM ?? 0, 2)}</Text>
              <Text style={[styles.singleStatLabel, { color: visualTheme.foregroundSecondary }]}>{dist.unit}</Text>
            </View>
            {selectedRoute.elevationGainM > 0 ? (
              <View style={styles.singleStat}>
                <Text style={[styles.singleStatValue, { color: visualTheme.foreground }]}>{cairnText('map-history-screen.value-value-bd4ab4e', { value1: dist.formatElevation(selectedRoute.elevationGainM), elevUnit: dist.elevUnit })}</Text>
                <Text style={[styles.singleStatLabel, { color: visualTheme.foregroundSecondary }]}>{cairnText('map-history-screen.elevation')}</Text>
              </View>
            ) : null}
          </View>
          <View style={styles.routeActions}>
            <View style={styles.routeMaintenanceRow}>
              <TouchableOpacity
                style={[styles.routeMaintenanceAction, { backgroundColor: visualTheme.secondaryAction, borderColor: visualTheme.borderStrong }, !routeCanBeUsed(selectedRoute) && styles.routeActionDisabled]}
                onPress={() => { void useSelectedRoute('hiking'); }}
                disabled={routeUseLoading || !routeCanBeUsed(selectedRoute)}
                accessibilityRole="button"
                accessibilityLabel={cairnText('map-history-screen.use-route-for-hike')}
                accessibilityState={{ disabled: routeUseLoading || !routeCanBeUsed(selectedRoute) }}
                testID="route-use-action"
              >
                {routeUseLoadingMode === 'hiking' ? <ActivityIndicator size="small" color={visualTheme.primary} /> : <Icon name="Navigation" size={IconSize.sm} color={visualTheme.iconActive} strokeWidth={2} />}
                <Text style={[styles.routeMaintenanceText, { color: visualTheme.foreground }]}>{cairnText('activity.activity-recording-chrome.hike')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.routeMaintenanceAction, { backgroundColor: visualTheme.secondaryAction, borderColor: visualTheme.borderStrong }]}
                onPress={() => { void useSelectedRoute('running'); }}
                disabled={routeUseLoading || !routeCanBeUsed(selectedRoute)}
                accessibilityRole="button"
                accessibilityLabel={cairnText('map-history-screen.use-route-for-run')}
                accessibilityState={{ disabled: routeUseLoading || !routeCanBeUsed(selectedRoute) }}
                testID="route-use-run-action"
              >
                {routeUseLoadingMode === 'running' ? <ActivityIndicator size="small" color={visualTheme.primary} /> : <Icon name="Footprints" size={IconSize.sm} color={visualTheme.iconActive} strokeWidth={2} />}
                <Text style={[styles.routeMaintenanceText, { color: visualTheme.foreground }]}>{cairnText('activity.activity-recording-chrome.run')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.routeMaintenanceAction, { backgroundColor: visualTheme.secondaryAction, borderColor: visualTheme.borderStrong }]}
                onPress={() => {
                  (nav as any).navigate('RouteEditor', targetSharedDeliveryId
                    ? { sharedDeliveryId: targetSharedDeliveryId, creationSource: 'shared-copy' }
                    : { routeId: selectedRoute.id });
                }}
                accessibilityRole="button"
                accessibilityLabel={cairnText('map-history-screen.edit-route')}
                testID="route-edit-action"
              >
                <Icon name="Edit3" size={IconSize.sm} color={visualTheme.iconActive} strokeWidth={2} />
                <Text style={[styles.routeMaintenanceText, { color: visualTheme.foreground }]}>{cairnText('map-history-screen.edit')}</Text>
              </TouchableOpacity>
            </View>
            <TouchableOpacity
              style={styles.routeDeleteAction}
              onPress={() => setRouteDeleteConfirm(true)}
              disabled={deleteSaving}
              accessibilityRole="button"
              accessibilityLabel={targetSharedDeliveryId ? cairnText('map-history-screen.remove-received-route') : cairnText('map-history-screen.delete-route')}
              accessibilityState={{ disabled: deleteSaving }}
              testID="route-delete-action"
            >
              <Icon name="Trash2" size={14} color={visualTheme.destructive} />
              <Text style={[styles.routeDeleteText, { color: visualTheme.destructive }]}>{targetSharedDeliveryId ? cairnText('common.action.remove') : cairnText('map-history-screen.delete-route')}</Text>
            </TouchableOpacity>
          </View>
        </View>
        <ModalCard
          visible={routeShareOpen}
          onDismiss={() => !routeShareLoading && setRouteShareOpen(false)}
          dismissible={!routeShareLoading}
          testID="route-share-friend-picker"
        >
          <ModalCardHeader
            title={cairnText('map-history-screen.send-an-independent-route')}
            body={cairnText('map-history-screen.each-selected-friend-receives-a-complete-snapshot')}
            onClose={() => !routeShareLoading && setRouteShareOpen(false)}
          />
          <ScrollView style={{ maxHeight: 280 }}>
            {routeFriends.length === 0 ? (
              <Text style={[styles.routeOriginText, { color: visualTheme.foregroundSecondary }]}>{cairnText('map-history-screen.no-accepted-friends-are-available')}</Text>
            ) : routeFriends.map(friend => {
              const selected = routeShareRecipients.includes(friend.userId);
              return (
                <TouchableOpacity
                  key={friend.userId}
                  style={[styles.routeShareFriend, { borderColor: selected ? visualTheme.primary : visualTheme.borderSubtle, backgroundColor: selected ? visualTheme.controlSelected : visualTheme.surface }]}
                  onPress={() => setRouteShareRecipients(current => selected
                    ? current.filter(id => id !== friend.userId)
                    : [...current, friend.userId])}
                  disabled={routeShareLoading}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: selected }}
                >
                  <Text style={[styles.routeMaintenanceText, { color: visualTheme.foreground }]} numberOfLines={1}>{friend.name}</Text>
                  <Icon name={selected ? 'Check' : 'UserPlus'} size={18} color={selected ? visualTheme.primary : visualTheme.iconInactive} />
                </TouchableOpacity>
              );
            })}
          </ScrollView>
          {routeShareMessage ? <Text style={[styles.routeStateText, { color: visualTheme.foregroundSecondary }]}>{routeShareMessage}</Text> : null}
          <View style={styles.deleteModalActions}>
            <PrimaryButton
              label={routeShareRecipients.length ? cairnText('map-history-screen.deliver-to-value', { length: routeShareRecipients.length }) : cairnText('map-history-screen.choose-friends')}
              onPress={() => { void deliverRouteSnapshot(); }}
              loading={routeShareLoading}
              disabled={routeShareRecipients.length === 0}
              testID="route-share-deliver"
            />
            <PrimaryButton label={cairnText('common.done')} variant="secondary" onPress={() => setRouteShareOpen(false)} disabled={routeShareLoading} />
          </View>
        </ModalCard>
        <ModalCard
          visible={routeDeleteConfirm}
          onDismiss={() => !deleteSaving && setRouteDeleteConfirm(false)}
          dismissible={!deleteSaving}
          testID="route-delete-confirmation"
        >
          <ModalCardHeader
            title={targetSharedDeliveryId ? cairnText('map-history-screen.remove-received-route-3fa4170') : cairnText('map-history-screen.delete-route-7f0f252')}
            body={targetSharedDeliveryId ? cairnText('map-history-screen.this-removes-only-your-independent-received-snapshot') : cairnText('map-history-screen.this-removes-the-route-its-source-activity')}
          />
          <View style={styles.deleteModalActions}>
            <PrimaryButton
              label={targetSharedDeliveryId ? cairnText('map-history-screen.remove-route') : cairnText('map-history-screen.delete-route')}
              variant="destructive"
              onPress={() => { void (targetSharedDeliveryId ? removeSelectedReceivedRoute() : deleteSelectedRoute()); }}
              loading={deleteSaving}
              testID="route-delete-confirm"
            />
            <PrimaryButton
              label={cairnText('map-history-screen.keep-route')}
              variant="secondary"
              onPress={() => setRouteDeleteConfirm(false)}
              disabled={deleteSaving}
            />
          </View>
        </ModalCard>
        </>
      ) : isRouteDetail ? (
        <View style={[styles.singleSessionPanel, { backgroundColor: visualTheme.surfaceElevated, borderColor: visualTheme.border, shadowColor: visualTheme.shadow }]} testID="route-detail-state">
          <Text style={[styles.detailTitle, { color: visualTheme.foreground }]}>
            {routeDetailState === 'not-found' ? cairnText('map-history-screen.route-unavailable') : cairnText('map-history-screen.loading-route')}
          </Text>
          <Text style={[styles.routeOriginText, { color: visualTheme.foregroundSecondary, marginTop: Spacing.sm }]}>
            {routeDetailState === 'not-found'
              ? cairnText('map-history-screen.this-route-may-have-been-deleted-or')
              : routeDetailState === 'error'
                ? cairnText('map-history-screen.the-route-could-not-be-loaded-check')
                : cairnText('map-history-screen.preparing-the-saved-route')}
          </Text>
          {routeDetailState === 'error' ? (
            <View style={{ marginTop: Spacing.lg }}>
              <PrimaryButton label={cairnText('map-history-screen.try-again')} onPress={() => {
                if (targetSharedDeliveryId) void loadSharedRouteDetail(targetSharedDeliveryId).then(setSharedRouteDetailState);
                else if (targetRouteId) void loadRouteDetail(targetRouteId);
              }} />
            </View>
          ) : null}
        </View>
      ) : targetSessionId && selectedSession ? (
        <>
          <View
            style={[styles.singleSessionPanel, styles.activityDetailPanel, { backgroundColor: visualTheme.surfaceElevated, borderColor: visualTheme.border, shadowColor: visualTheme.shadow }]}
            testID="activity-detail-panel"
          >
            <ScrollView
              style={styles.activityDetailScroll}
              contentContainerStyle={styles.activityDetailContent}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
            >
              <View style={{ marginBottom: Spacing.xs }}>
                {renameEditing ? (
                  <View style={{ flexDirection: 'row', gap: Spacing.sm, alignItems: 'center' }}>
                    <TextInput
                      ref={renameInputRef}
                      style={[styles.renameInput, { color: visualTheme.foreground, borderBottomColor: visualTheme.primary }]}
                      value={renameText}
                      onChangeText={setRenameText}
                      autoFocus
                      maxLength={60}
                      onSubmitEditing={() => { void commitActivityRename(); }}
                      editable={!renameSaving}
                      returnKeyType="done"
                      placeholder={selectedSession.activityMode === 'running' ? cairnText('map-history-screen.run-name') : cairnText('map-history-screen.hike-name')}
                      placeholderTextColor={visualTheme.muted}
                    />
                    {renameSaving ? <ActivityIndicator size="small" color={visualTheme.primary} /> : (
                      <TouchableOpacity
                        onPress={() => { void commitActivityRename(); }}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                        accessibilityLabel={cairnText('map-history-screen.save-new-activity-name')}
                      >
                        <Icon name="Check" size={20} color={visualTheme.iconActive} strokeWidth={2.5} />
                      </TouchableOpacity>
                    )}
                    <TouchableOpacity
                      onPress={() => { renameInputRef.current?.blur(); Keyboard.dismiss(); setRenameEditing(false); }}
                      disabled={renameSaving}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      accessibilityLabel={cairnText('map-history-screen.cancel-rename')}
                    >
                      <Icon name="X" size={20} color={visualTheme.iconInactive} strokeWidth={2.5} />
                    </TouchableOpacity>
                  </View>
                ) : (
                  <TouchableOpacity
                    disabled={isQaReviewClone || isSnapLabActivity}
                    onPress={() => {
                      setRenameText(selectedSession.name || (selectedSession.activityMode === 'running'
                        ? cairnText('common.activity.run')
                        : cairnText('common.activity.hike')));
                      setRenameEditing(true);
                    }}
                    accessibilityRole="button"
                    accessibilityLabel={cairnText('map-history-screen.rename-value-activity', { value1: selectedSession.activityMode === 'running' ? cairnText('common.activity.run') : cairnText('common.activity.hike') })}
                    accessibilityHint={cairnText('map-history-screen.double-tap-to-edit-the-activity-name')}
                    hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
                  >
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <Text style={[styles.detailTitle, { color: visualTheme.foreground }]} numberOfLines={2}>
                        {selectedSession.name || (selectedSession.activityMode === 'running' ? cairnText('map-history-screen.run') : cairnText('map-history-screen.hike'))}
                      </Text>
                      {!isQaReviewClone && !isSnapLabActivity ? <Icon name="Pencil" size={14} color={visualTheme.iconInactive} strokeWidth={2} /> : null}
                    </View>
                  </TouchableOpacity>
                )}
              </View>

              <View style={styles.detailMetaRow}>
                {selectedSession.activityMode === 'running' ? (
                  <RunningIcon size={14} color={visualTheme.iconInactive} />
                ) : (
                  <HikingIcon size={14} color={visualTheme.iconInactive} />
                )}
                <Text style={[styles.detailMetaText, { color: visualTheme.foregroundSecondary }]}>{cairnText('map-history-screen.value-value-value-value-value', { value1: selectedSession.activityMode === 'running' ? cairnText('map-history-screen.run') : cairnText('map-history-screen.hike'), value2: '  ·  ', value3: formatDate(selectedSession.startedAt), value4: '  ·  ', value5: formatProductTime(selectedSession.startedAt) })}</Text>
              </View>

              {isQaReviewClone ? (
                <View style={styles.detailMetaRow} testID="qa-snap-review-clone-label">
                  <Icon name="Eye" size={13} color={visualTheme.iconActive} strokeWidth={2} />
                  <Text style={[styles.detailMetaText, { color: visualTheme.primary, fontWeight: '700' }]}>{cairnText('map-history-screen.qa-snap-review-clone-no-product-effects')}</Text>
                </View>
              ) : null}

              {isSnapLabActivity ? (
                <View style={styles.detailMetaRow} testID="qa-snap-lab-activity-label">
                  <Icon name="Wrench" size={13} color={visualTheme.iconActive} strokeWidth={2} />
                  <Text style={[styles.detailMetaText, { color: visualTheme.primary, fontWeight: '700' }]}>{cairnText('map-history-screen.snap-lab-local-qa-realm-zero-production')}</Text>
                </View>
              ) : null}

              <View style={[styles.singleSessionStats, styles.activityMetrics, { borderColor: visualTheme.borderSubtle }]}>
                <View style={[styles.singleStat, styles.activityMetricStat]}>
                  <Text style={[styles.singleStatValue, { color: visualTheme.foreground }]}>{dist.format(selectedSession.distanceM, 1)}</Text>
                  <Text style={[styles.singleStatLabel, { color: visualTheme.foregroundSecondary }]}>{cairnText('map-history-screen.value-value-83ca8f8', { value1: selectedMetricLabels[0], unit: dist.unit })}</Text>
                </View>
                <View style={[styles.singleStatDivider, { backgroundColor: visualTheme.borderSubtle }]} />
                <View style={[styles.singleStat, styles.activityMetricStat]}>
                  <Text style={[styles.singleStatValue, { color: visualTheme.foreground }]}>{formatDuration(selectedSession.durationS)}</Text>
                  <Text style={[styles.singleStatLabel, { color: visualTheme.foregroundSecondary }]}>{selectedMetricLabels[1]}</Text>
                </View>
                <View style={[styles.singleStatDivider, { backgroundColor: visualTheme.borderSubtle }]} />
                <View style={[styles.singleStat, styles.activityMetricStat]}>
                  <Text style={[styles.singleStatValue, { color: visualTheme.foreground }]}>
                    {selectedSession.activityMode === 'running'
                      ? formatAverageActivityPace(selectedSession.durationS, selectedSession.distanceM, dist.imperial)
                      : cairnText('map-history-screen.value-value', { value1: dist.formatElevation(selectedSession.elevationGainM ?? 0), elevUnit: dist.elevUnit })}
                  </Text>
                  <Text style={[styles.singleStatLabel, { color: visualTheme.foregroundSecondary }]}>{cairnText('map-history-screen.value-value-7e51f13', { value1: selectedMetricLabels[2], value2: selectedSession.activityMode === 'running' ? cairnText('map-history-screen.value-6b705d4', { unit: dist.unit }) : '' })}</Text>
                </View>
              </View>

              {selectedActivityNotices.length > 0 ? (
                <ContentSurface level="record" style={styles.activityStateSurface} testID="activity-route-state-surface">
                  {selectedActivityNotices.map(notice => {
                    const iconName: IconName = notice.kind === 'sync'
                      ? 'CloudOff'
                      : notice.kind === 'gap'
                        ? 'Route'
                        : notice.kind === 'route-review'
                          ? 'TriangleAlert'
                          : 'Map';
                    const content = (
                      <>
                        <Icon
                          name={iconName}
                          size={15}
                          color={notice.action ? visualTheme.destructive : visualTheme.iconActive}
                          strokeWidth={2.2}
                        />
                        <View style={{ flex: 1 }}>
                          <Text style={[styles.activityStateLabel, { color: visualTheme.foreground }]}>{notice.title}</Text>
                          <Text style={[styles.activityStateDetail, { color: visualTheme.foregroundSecondary }]}>{notice.detail}</Text>
                        </View>
                        {notice.action ? <Icon name="RotateCcw" size={14} color={visualTheme.destructive} strokeWidth={2.2} /> : null}
                      </>
                    );
                    return notice.action ? (
                      <TouchableOpacity
                        key={`${notice.kind}-${notice.title}`}
                        style={styles.activityStateRow}
                        onPress={() => { void import('../services/syncDaemon').then(({ drainPending }) => drainPending({ wakeReason: 'manual', force: true })); }}
                        accessibilityRole="button"
                        accessibilityLabel={cairnText('map-history-screen.retry-activity-sync')}
                      >
                        {content}
                      </TouchableOpacity>
                    ) : (
                      <View key={`${notice.kind}-${notice.title}`} style={styles.activityStateRow}>{content}</View>
                    );
                  })}
                </ContentSurface>
              ) : null}

              {routeFlags.length > 0 ? (
                <View style={styles.linkedCairnSection} testID="activity-linked-cairns">
                  <View style={styles.sectionHeadingRow}>
                    <Text style={[styles.sectionHeading, { color: visualTheme.foreground }]}>{cairnText('map-history-screen.cairns-from-this-activity')}</Text>
                    <Text style={[styles.sectionCount, { color: visualTheme.foregroundSecondary }]}>{routeFlags.length}</Text>
                  </View>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.linkedCairnList}>
                    {routeFlags.map(marker => {
                      const meta = MARKER_META[marker.type] || MARKER_META.free;
                      const decoded = splitTitleBody(marker.note ?? '');
                      const title = cairnDisplayTitle(decoded.title, decoded.body, marker.createdAt);
                      return (
                        <ContentSurface
                          key={marker.id}
                          level="record"
                          onPress={() => nav.navigate('MarkerDetail', { markerId: marker.id })}
                          style={styles.linkedCairnCard}
                          testID={`activity-linked-cairn-${marker.id}`}
                        >
                          <View style={styles.linkedCairnRow}>
                            <View style={[styles.linkedCairnIcon, { backgroundColor: visualTheme.surface, borderColor: visualTheme.borderStrong }]}>
                              <Icon name={meta.iconName as IconName} size={17} color={meta.color} strokeWidth={2} />
                            </View>
                            <View style={{ flex: 1 }}>
                              <Text style={[styles.linkedCairnTitle, { color: visualTheme.foreground }]} numberOfLines={1}>{title}</Text>
                              <Text style={[styles.linkedCairnMeta, { color: visualTheme.foregroundSecondary }]} numberOfLines={1}>
                                {marker.syncState === 'failed' ? cairnText('map-history-screen.sync-needs-attention') : meta.label}
                              </Text>
                            </View>
                            <Icon name="ChevronRight" size={15} color={visualTheme.iconInactive} strokeWidth={2} />
                          </View>
                        </ContentSurface>
                      );
                    })}
                  </ScrollView>
                </View>
              ) : null}

              {isQaReviewClone ? (
                <View style={[styles.detailMetaRow, { marginTop: Spacing.sm }]}>
                  <Icon name="Lock" size={13} color={visualTheme.iconInactive} strokeWidth={2} />
                  <Text style={[styles.detailMetaText, { color: visualTheme.foregroundSecondary }]}>{cairnText('map-history-screen.read-only-rename-delete-sync-memory-and')}</Text>
                </View>
              ) : isSnapLabActivity ? (
                <View style={styles.activityActions}>
                  <PrimaryButton
                    label={cairnText('map-history-screen.save-qa-route-snapshot')}
                    onPress={saveSnapLabRouteDraft}
                    disabled={loadedTrackPoints == null || loadedTrackPoints.length < 2}
                    loading={routeDraftOpening}
                    renderIcon={color => <Icon name="Route" size={IconSize.sm} color={color} strokeWidth={2} />}
                    testID="snap-lab-save-route-snapshot"
                  />
                  <Text style={[styles.detailMetaText, { color: visualTheme.foregroundSecondary }]}>{cairnText('map-history-screen.rename-delete-product-sync-personal-memory-and')}</Text>
                </View>
              ) : (
                <View style={styles.activityActions}>
                  <PrimaryButton
                    label={cairnText('map-history-screen.create-route')}
                    onPress={createRouteFromActivity}
                    disabled={loadedTrackPoints == null || loadedTrackPoints.length < 2}
                    loading={routeDraftOpening}
                    renderIcon={color => <Icon name="Route" size={IconSize.sm} color={color} strokeWidth={2} />}
                    testID="activity-create-route"
                  />
                  <Text style={[styles.detailMetaText, { color: visualTheme.foregroundSecondary }]}>{cairnText('map-history-screen.creates-a-separate-editable-copy-this-activity')}</Text>
                  {debugMode ? (
                    <PrimaryButton
                      label={cairnText('map-history-screen.copy-diagnostics')}
                      variant="secondary"
                      onPress={() => { void copySelectedActivityDiagnostics(); }}
                      loading={activityDiagnosticsCopying}
                      renderIcon={color => <Icon name="FileText" size={IconSize.sm} color={color} strokeWidth={2} />}
                      testID="activity-copy-diagnostics"
                    />
                  ) : null}
                  <TouchableOpacity
                    style={styles.activityDeleteAction}
                    onPress={() => setDeleteConfirm(true)}
                    accessibilityRole="button"
                    accessibilityLabel={cairnText('map-history-screen.delete-activity')}
                    testID="activity-delete-action"
                  >
                    <Icon name="Trash2" size={15} color={visualTheme.iconInactive} strokeWidth={2} />
                    <Text style={[styles.activityDeleteText, { color: visualTheme.foregroundSecondary }]}>{cairnText('map-history-screen.delete-activity')}</Text>
                  </TouchableOpacity>
                </View>
              )}
            </ScrollView>
          </View>

          <ModalCard
            visible={deleteConfirm}
            onDismiss={() => !deleteSaving && setDeleteConfirm(false)}
            dismissible={!deleteSaving}
            testID="activity-delete-confirmation"
          >
            <ModalCardHeader
              title={cairnText('map-history-screen.delete-activity-069cc59')}
              body={cairnText('map-history-screen.this-removes-the-activity-record-cairns-independent')}
            />
            <View style={styles.deleteModalActions}>
              <PrimaryButton
                label={cairnText('map-history-screen.delete-activity')}
                variant="destructive"
                onPress={() => { void deleteSelectedActivity(); }}
                loading={deleteSaving}
                testID="activity-delete-confirm"
              />
              <PrimaryButton
                label={cairnText('map-history-screen.keep-activity')}
                variant="secondary"
                onPress={() => setDeleteConfirm(false)}
                disabled={deleteSaving}
              />
            </View>
          </ModalCard>
        </>
      ) : targetSessionId ? (
        <View
          style={[
            styles.singleSessionPanel,
            { backgroundColor: visualTheme.surfaceElevated, borderColor: visualTheme.border, shadowColor: visualTheme.shadow },
          ]}
          testID="activity-detail-unavailable"
        >
          <View style={[styles.panelHandle, { backgroundColor: visualTheme.border }]} />
          <View style={styles.emptyState}>
            <Icon name="Map" size={34} color={visualTheme.iconInactive} strokeWidth={1.7} />
            <Text style={[styles.emptyTitle, { color: visualTheme.foreground }]}>{snapLabLoading ? cairnText('map-history-screen.loading-qa-activity') : cairnText('map-history-screen.activity-unavailable')}</Text>
            <Text style={[styles.emptySubtitle, { color: visualTheme.foregroundSecondary }]}>{snapLabLoading ? cairnText('map-history-screen.restoring-the-isolated-snap-lab-record') : cairnText('map-history-screen.this-activity-could-not-be-found-in')}</Text>
            <PrimaryButton
              label={activityBackContext === 'previous' && nav.canGoBack()
                ? cairnText('navigation.back')
                : cairnText('map-history-screen.back-to-activities')}
              variant="secondary"
              onPress={handleActivityBack}
            />
          </View>
        </View>
      ) : (
      <View style={styles.listPanel}>
        <View style={styles.panelHandle} />

        {/* O18 HIST-01: search box, above the tabs. Only shown when not
            drilled into a single session detail. */}
        {!targetSessionId && sessions.length > 0 && (
          <View style={{ paddingHorizontal: Spacing.base, paddingBottom: Spacing.sm }}>
            <View style={styles.searchWrap}>
              <Icon name="Search" size={16} color={Colors.textMuted} strokeWidth={2} />
              <TextInput
                style={styles.searchInput}
                value={searchQuery}
                onChangeText={setSearchQuery}
                placeholder={cairnText('map-history-screen.search-hikes-by-name')}
                placeholderTextColor={Colors.textMuted}
                autoCorrect={false}
                autoCapitalize="none"
                clearButtonMode="while-editing"
                accessibilityLabel={cairnText('map-history-screen.search-hikes')}
              />
              {searchQuery.length > 0 && Platform.OS !== 'ios' && (
                <TouchableOpacity
                  onPress={() => setSearchQuery('')}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  accessibilityLabel={cairnText('map-history-screen.clear-search')}
                >
                  <Icon name="X" size={14} color={Colors.textMuted} strokeWidth={2.2} />
                </TouchableOpacity>
              )}
              {/* O18 HIST-02: filter toggle. Tap opens a chip bar below. */}
              <TouchableOpacity
                onPress={() => setShowFilters(v => !v)}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                accessibilityRole="button"
                accessibilityLabel={cairnText('map-history-screen.show-filters')}
              >
                <Icon
                  name="ArrowUpDown"
                  size={16}
                  color={(typeFilter !== 'all' || periodFilter !== 'all' || sortOrder !== 'recent' || showFilters) ? Colors.primary : Colors.textMuted}
                  strokeWidth={2.2}
                />
              </TouchableOpacity>
            </View>
            {showFilters && (
              <View style={styles.filterBar}>
                {/* Type row */}
                <View style={styles.filterRow}>
                  <Text style={styles.filterLabel}>{cairnText('map-history-screen.type')}</Text>
                  {(['all', 'hiking', 'running'] as const).map(t => (
                    <TouchableOpacity
                      key={t}
                      onPress={() => setTypeFilter(t)}
                      style={[styles.filterChip, typeFilter === t && styles.filterChipActive]}
                    >
                      <Text style={[styles.filterChipText, typeFilter === t && styles.filterChipTextActive]}>
                        {t === 'all' ? cairnText('map-history-screen.all') : t === 'hiking' ? cairnText('map-history-screen.hikes') : cairnText('map-history-screen.runs')}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
                {/* Period row */}
                <View style={styles.filterRow}>
                  <Text style={styles.filterLabel}>{cairnText('map-history-screen.when')}</Text>
                  {(['all', 'week', 'month', 'year'] as const).map(p => (
                    <TouchableOpacity
                      key={p}
                      onPress={() => setPeriodFilter(p)}
                      style={[styles.filterChip, periodFilter === p && styles.filterChipActive]}
                    >
                      <Text style={[styles.filterChipText, periodFilter === p && styles.filterChipTextActive]}>
                        {p === 'all' ? cairnText('map-history-screen.all') : p === 'week' ? cairnText('map-history-screen.7-days') : p === 'month' ? cairnText('map-history-screen.30-days') : cairnText('map-history-screen.1-year')}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
                {/* Sort row */}
                <View style={styles.filterRow}>
                  <Text style={styles.filterLabel}>{cairnText('map-history-screen.sort')}</Text>
                  {(['recent', 'oldest', 'longest'] as const).map(o => (
                    <TouchableOpacity
                      key={o}
                      onPress={() => setSortOrder(o)}
                      style={[styles.filterChip, sortOrder === o && styles.filterChipActive]}
                    >
                      <Text style={[styles.filterChipText, sortOrder === o && styles.filterChipTextActive]}>
                        {o === 'recent' ? cairnText('map-history-screen.newest') : o === 'oldest' ? cairnText('map-history-screen.oldest') : cairnText('map-history-screen.longest')}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            )}
          </View>
        )}

        {qaReviewError ? (
          <View style={styles.emptyState} testID="qa-snap-review-error">
            <Icon name="TriangleAlert" size={40} color={Colors.danger} strokeWidth={1.5} />
            <Text style={styles.emptyTitle}>{cairnText('map-history-screen.review-clone-unavailable')}</Text>
            <Text style={styles.emptySubtitle}>{qaReviewError}</Text>
          </View>
        ) : tab === 'routes' ? (
          <ScrollView showsVerticalScrollIndicator={false}>
            {filteredSessions.length === 0 ? (
              sessions.length === 0 ? (
                <View style={styles.emptyState}>
                  {/* Concept MapHistory-1.png: hand-drawn route icon (waypoints
                      linked by a line) rendered in a muted primary tint so it
                      reads as an illustrative anchor rather than a UI control. */}
                  <Icon name="Route" size={44} color={Colors.primary + '99'} strokeWidth={1.4} />
                  <Text style={styles.emptyTitle}>{cairnText('map-history-screen.no-hikes-yet')}</Text>
                  <Text style={styles.emptySubtitle}>{cairnText('map-history-screen.start-hiking-or-running-to-see-your')}</Text>
                  <PressBtn
                    style={styles.emptyCta}
                    onPress={() => nav.replace('Hiking')}
                    scaleTo={0.96}
                  >
                    <Icon name="Play" size={14} color="#fff" strokeWidth={2.5} />
                    <Text style={styles.emptyCtaText}>{cairnText('map-history-screen.start-a-hike')}</Text>
                  </PressBtn>
                </View>
              ) : (
                <View style={styles.emptyState}>
                  <Icon name="Search" size={40} color={Colors.textMuted} strokeWidth={1.2} />
                  {/* Sprint 6 round-5 review R5B5: distinguish "empty
                      search box + narrow filters" from "typed query
                      returned nothing" so users know which knob to
                      loosen. */}
                  {(() => {
                    const hasSearch = searchQuery.trim().length > 0;
                    const hasFilter = typeFilter !== 'all' || periodFilter !== 'all';
                    if (hasSearch && hasFilter) {
                      return (
                        <>
                          <Text style={styles.emptyTitle}>{cairnText('map-history-screen.no-matches')}</Text>
                          <Text style={styles.emptySubtitle}>{cairnText('map-history-screen.try-clearing-the-filters-or-search-term')}</Text>
                        </>
                      );
                    }
                    if (hasFilter) {
                      return (
                        <>
                          <Text style={styles.emptyTitle}>{cairnText('map-history-screen.no-hikes-match-your-filters')}</Text>
                          <Text style={styles.emptySubtitle}>{cairnText('map-history-screen.try-all-all-to-see-everything')}</Text>
                        </>
                      );
                    }
                    return (
                      <>
                        <Text style={styles.emptyTitle}>{cairnText('map-history-screen.no-matches')}</Text>
                        <Text style={styles.emptySubtitle}>{cairnText('map-history-screen.try-a-different-search-term')}</Text>
                      </>
                    );
                  })()}
                </View>
              )
            ) : (
              filteredSessions.map(s => (
                <SessionCard
                  key={s.id}
                  session={s}
                  isSelected={selectedSessionId === s.id}
                  isExpanded={expandedSessionId === s.id}
                  onPress={() => setExpandedSessionId(expandedSessionId === s.id ? null : s.id)}
                  onViewOnMap={() => {
                    setSelectedSessionId(s.id);
                    setExpandedSessionId(null);
                  }}
                />
              ))
            )}
            {selectedSession && (
              <View style={{ flexDirection: 'row', gap: Spacing.sm }}>
                {/* 2026-08-16 CONCEPT_TRUTH alignment (Route Detail):
                    Delete on LEFT (red outline), Edit Route on RIGHT
                    (filled deep green). Concept row-02 shows this pair. */}
                <TouchableOpacity
                  style={[cardStyles.deleteBtn, { flex: 1 }, deleteConfirm && { backgroundColor: Colors.danger }]}
                  onPress={() => {
                    if (!deleteConfirm) { setDeleteConfirm(true); return; }
                    deleteSession(selectedSession.id);
                    setSelectedSessionId(null);
                    setDeleteConfirm(false);
                  }}
                >
                  <Icon name="Trash2" size={IconSize.sm} color={deleteConfirm ? '#fff' : Colors.danger} strokeWidth={2} />
                  <Text style={[cardStyles.deleteBtnText, deleteConfirm && { color: '#fff' }]}>{deleteConfirm ? cairnText('map-history-screen.confirm-delete') : cairnText('map-history-screen.delete-route')}</Text>
                </TouchableOpacity>
              </View>
            )}
          </ScrollView>
        ) : (
          <ScrollView showsVerticalScrollIndicator={false}>
            {markers.length === 0 ? (
              <View style={styles.emptyState}>
                <Icon name="Flag" size={40} color={Colors.textMuted} strokeWidth={1.2} />
                <Text style={styles.emptyTitle}>{cairnText('map-history-screen.no-cairns-planted')}</Text>
                <Text style={styles.emptySubtitle}>{cairnText('map-history-screen.open-the-map-to-place-your-first')}</Text>
              </View>
            ) : (
              markers.map(m => {
                const meta = MARKER_META[m.type as keyof typeof MARKER_META] || MARKER_META.free;
                const timeAgo = getRelativeTime(m.createdAt);
                // v74a: show distance from current GPS as the primary
                // secondary line. Falls back to note/timeAgo only when
                // user has no GPS lock yet.
                const distM = lastCoord
                  ? haversineM({ lat: lastCoord.lat, lng: lastCoord.lng }, { lat: m.lat, lng: m.lng })
                  : null;
                const distLabel = distM === null
                  ? null
                  : cairnText('map-history-screen.value-away', { value1: dist.formatShort(distM) });
                const subtitle = distLabel ?? (m.note ? m.note.substring(0, 40) : timeAgo);
                return (
                  <PressRow key={m.id} onPress={() => setSelectedMarkerId(m.id)} style={{ marginBottom: 0 }}>
                    <View style={flagStyles.row}>
                      <View style={[flagStyles.iconBadge, { backgroundColor: meta.bg, borderColor: meta.color }]}>
                        <Icon name={meta.iconName as IconName} size={18} color={meta.color} strokeWidth={2} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <View style={flagStyles.titleRow}>
                          <Text style={flagStyles.title}>{meta.label}</Text>
                          <View style={[flagStyles.typePill, { backgroundColor: meta.bg, borderColor: meta.color + '80' }]}>
                            <Text style={[flagStyles.typePillText, { color: meta.color }]}>{m.type}</Text>
                          </View>
                        </View>
                        <Text style={flagStyles.note} numberOfLines={1}>
                          {subtitle}
                        </Text>
                      </View>
                      <Icon name="ChevronRight" size={IconSize.sm} color={Colors.textMuted} strokeWidth={2} />
                    </View>
                  </PressRow>
                );
              })
            )}
          </ScrollView>
        )}
      </View>
      )}

      {/* Flag detail bottom sheet */}
      {selectedMarker && (
        <FlagDetailSheet
          marker={selectedMarker}
          onClose={() => setSelectedMarkerId(null)}
          onDelete={() => {
            deleteMarker(selectedMarker.id);
            setSelectedMarkerId(null);
          }}
        />
      )}
    </View>
  );
}

/**
 * Parameterless MapHistory was a second, divergent personal-history library.
 * Keep old deep links safe by redirecting them to Trails while object-specific
 * Activity/Route Detail remains here.
 */
function TrailsIndexRedirect() {
  const nav = useNavigation<Nav>();
  const theme = useVisualTheme();
  useEffect(() => {
    nav.replace('Routes', { initialTab: 'activities' });
  }, [nav]);
  return (
    <View style={[styles.legacyRedirect, { backgroundColor: theme.background }]} testID="map-history-index-redirect">
      <ActivityIndicator color={theme.primary} />
      <Text style={[styles.legacyRedirectText, { color: theme.textSecondary }]}>{cairnText('map-history-screen.opening-trails')}</Text>
    </View>
  );
}

export function MapHistoryScreen() {
  const route = useRoute<any>();
  const hasObjectTarget = Boolean(
    route.params?.sessionId
    || route.params?.routeId
    || route.params?.sharedDeliveryId
    || route.params?.qaReviewClone,
  );
  return hasObjectTarget ? <MapHistoryObjectScreen /> : <TrailsIndexRedirect />;
}

// ── Styles ──────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  // 2026-08-16 Round 6: concept uses paper bg (#F4EFE6), not Colors.mapBg (sage green).
  // sage green mapBg was designed for the topo map layer but leaks through
  // in empty state / web fallback where no mapbox tiles are rendered.
  container: { flex: 1, backgroundColor: '#F4EFE6' },

  mapArea: { flex: 1, backgroundColor: '#F4EFE6', position: 'relative', overflow: 'hidden' },
  // Concept: MapHistory-1.png (2026-08-15 UI overhaul).
  // Three staggered decorative offset lines act as an abstract topo/trail
  // stack behind the History empty state:
  //   line1 — sage GREEN (Colors.primary), long, LEFT-anchored at top
  //   line2 — warm BROWN (Colors.trail), shorter, RIGHT-anchored, offset
  //           down + right so it overlaps line1's tail
  //   line3 — cool  BLUE  (Colors.running), medium, LEFT-anchored, sits
  //           below the other two so the stack reads left→right→left.
  // Vertical rhythm: 28px between lines; y-anchor at ~19% of viewport so
  // the composition breathes above the centered Map icon + label.
  routeLine1: {
    position: 'absolute', top: 158, left: 40, width: W - 100,
    height: 3, backgroundColor: Colors.primary + '80', borderRadius: 2,
  },
  routeLine2: {
    position: 'absolute', top: 190, right: 40, width: W * 0.42,
    height: 3, backgroundColor: Colors.trail + '80', borderRadius: 2,
  },
  routeLine3: {
    position: 'absolute', top: 222, left: 40, width: W * 0.58,
    height: 3, backgroundColor: Colors.running + '80', borderRadius: 2,
  },
  mapLabelWrap: {
    position: 'absolute', alignItems: 'center',
    top: '32%', left: 0, right: 0, gap: 8,
  },
  mapLabel: { fontSize: FontSize.h3, fontWeight: '700', color: Colors.primary, opacity: 0.72 },
  mapSubLabel: { fontSize: FontSize.small, color: Colors.textMuted, opacity: 0.85 },
  markerPin: {
    position: 'absolute', width: 30, height: 30, borderRadius: 15,
    borderWidth: 2.5, alignItems: 'center', justifyContent: 'center',
    ...Shadow.card,
  },

  trackStatBar: {
    position: 'absolute', bottom: 16, left: Spacing.base, right: Spacing.base,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around',
    backgroundColor: 'rgba(255,255,255,0.92)',
    borderRadius: Radius.card, paddingVertical: Spacing.sm,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.40)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.09,
    shadowRadius: 16,
    elevation: 10, // sit above the topo backdrop layers
    zIndex: 10,
  },
  trackStat: { flex: 1, alignItems: 'center', paddingLeft: Spacing.xs },
  trackStatValue: { fontSize: FontSize.caption, fontWeight: '800', color: Colors.textPrimary },
  trackStatUnit: { fontSize: FontSize.tiny, color: Colors.textSecondary, marginTop: 1 },
  trackStatDivider: { width: 1, height: 24, backgroundColor: Colors.border },

  topBar: { position: 'absolute', top: 0, left: 0, right: 0 },
  topRow: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.base,
    paddingTop: Spacing.lg, paddingBottom: Spacing.xs,
    gap: Spacing.sm,
  },
  routeHeaderTitleWrap: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
  routeHeaderTitleChip: {
    minHeight: 38,
    justifyContent: 'center',
    borderWidth: 1,
    borderRadius: Radius.button,
    paddingHorizontal: Spacing.md,
  },
  routeHeaderTitleText: { textAlign: 'center', fontSize: FontSize.h3, fontWeight: '700' },
  backBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 2,
    backgroundColor: 'rgba(255,255,255,0.95)',
    borderRadius: Radius.pill, paddingHorizontal: Spacing.md, paddingVertical: 7,
    ...Shadow.card,
  },
  backText: { fontSize: FontSize.small, fontWeight: '700', color: Colors.primary },
  topTitle: {
    flex: 1, textAlign: 'center',
    fontSize: FontSize.h3, fontWeight: '700', color: Colors.textPrimary,
  },
  planBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: Colors.primary, borderRadius: Radius.pill,
    paddingHorizontal: Spacing.md, paddingVertical: 7,
  },
  planBtnText: { fontSize: FontSize.small, fontWeight: '700', color: '#fff' },

  tabBar: {
    flexDirection: 'row', marginHorizontal: Spacing.base,
    backgroundColor: 'rgba(255,255,255,0.95)',
    borderRadius: Radius.pill, padding: 3,
    ...Shadow.card,
  },
  tabItem: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    borderRadius: Radius.pill, paddingVertical: 7, gap: 5,
  },
  tabItemActive: { backgroundColor: Colors.primaryBg },
  tabText: { fontSize: FontSize.small, fontWeight: '600', color: Colors.textSecondary },
  tabTextActive: { color: Colors.primary, fontWeight: '700' },

  singleSessionPanel: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    // Was 0.95 alpha — 5% transparency was leaking the previous screen's
    // content through, which the user reported as a "ghost" of the
    // Routes hike sheet showing under Activity Detail.
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 20, borderTopRightRadius: 20,
    padding: Spacing.xl, paddingBottom: Spacing.xxl,
    shadowColor: '#000', shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.08, shadowRadius: 16, elevation: 6,
  },
  routeDetailPanel: {
    paddingHorizontal: Spacing.base,
    paddingTop: Spacing.md,
  },
  activityDetailPanel: {
    maxHeight: Math.min(H * 0.68, 580),
    paddingBottom: Spacing.md,
  },
  activityDetailScroll: { flexShrink: 1 },
  activityDetailContent: { paddingBottom: Spacing.md },
  singleSessionStats: {
    flexDirection: 'row', justifyContent: 'space-around', marginBottom: Spacing.lg,
  },
  singleStat: { alignItems: 'center', gap: 4 },
  singleStatValue: { fontSize: FontSize.h2, fontWeight: '700', color: Colors.textPrimary },
  singleStatLabel: { fontSize: FontSize.small, color: Colors.textSecondary },
  activityMetrics: {
    alignItems: 'stretch',
    borderTopWidth: 1,
    borderBottomWidth: 1,
    paddingVertical: Spacing.md,
    marginBottom: Spacing.md,
  },
  activityMetricStat: { flex: 1, justifyContent: 'center', paddingHorizontal: 3 },
  singleStatDivider: { width: 1, height: 40, alignSelf: 'center' },

  listPanel: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    maxHeight: 380,
    paddingTop: Spacing.sm, paddingHorizontal: Spacing.base, paddingBottom: Spacing.xxl,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.08,
    shadowRadius: 20,
    elevation: 8,
    borderTopWidth: 1, borderColor: 'rgba(255,255,255,0.40)',
  },
  panelHandle: {
    width: 44, height: 5, borderRadius: 3,
    backgroundColor: Colors.border, alignSelf: 'center', marginBottom: Spacing.md,
  },

  emptyState: {
    alignItems: 'center', justifyContent: 'center',
    paddingVertical: Spacing.xxl, gap: Spacing.sm,
  },
  // Concept MapHistory-1.png: empty-state title reads as a soft forest
  // green (matching the Hike identity) rather than plain textSecondary
  // so the "No hikes yet" line ties into the rest of the History surface.
  emptyTitle: { fontSize: FontSize.body, fontWeight: '700', color: Colors.primary },
  emptySubtitle: { fontSize: FontSize.small, color: Colors.textMuted, textAlign: 'center', maxWidth: 260 },
  emptyCta: {
    flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: Spacing.sm,
    backgroundColor: Colors.primary, borderRadius: Radius.pill ?? 28,
    paddingHorizontal: Spacing.lg, paddingVertical: 12,
  },
  emptyCtaText: { fontSize: FontSize.caption, fontWeight: '700', color: '#fff' },
  // O18 HIST-01: search input above the history list.
  searchWrap: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.xs,
    backgroundColor: 'rgba(0,0,0,0.04)',
    borderRadius: 10,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Platform.OS === 'ios' ? 9 : 4,
    marginTop: Spacing.xs,
  },
  searchInput: {
    flex: 1,
    fontSize: FontSize.body,
    color: Colors.textPrimary,
    paddingVertical: 4,
  },
  // O18 HIST-02: filter chip bar (type / period / sort).
  filterBar: {
    marginTop: Spacing.sm,
    gap: Spacing.xs,
  },
  filterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexWrap: 'wrap',
  },
  filterLabel: {
    fontSize: FontSize.tiny,
    fontWeight: '700',
    color: Colors.textSecondary,
    minWidth: 40,
  },
  filterChip: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: Radius.pill,
    backgroundColor: 'rgba(255,255,255,0.6)',
    borderWidth: 1,
    borderColor: Colors.border,
  },
  filterChipActive: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  filterChipText: {
    fontSize: FontSize.tiny,
    fontWeight: '600',
    color: Colors.textSecondary,
  },
  filterChipTextActive: {
    color: '#fff',
  },
  // O18 HIST-03: rename hike UI.
  sessionTitle: {
    fontSize: FontSize.body, fontWeight: '700', color: Colors.textPrimary,
  },
  // 2026-08-17 Route/Activity Detail — concept crops/02 + crops/05.
  // Title is 26pt/700 per project font rule (Title 26pt/700 / Body 15pt/400 /
  // Label 13pt/600). Not FontSize.h1 (28) or h2 (20) — the concept crop
  // reads at ~26pt with a slightly tighter line height.
  detailTitle: {
    fontSize: 26, fontWeight: '700', color: Colors.textPrimary,
  },
  routeDetailTitle: {
    flexShrink: 1,
    fontSize: FontSize.h2,
    lineHeight: 26,
    fontWeight: '700',
  },
  routeTitleRow: { marginBottom: Spacing.xs },
  routeRenameRow: { flexDirection: 'row', gap: Spacing.sm, alignItems: 'center' },
  routeTitleDisplayRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm },
  routeTitleAction: { flex: 1, minWidth: 0 },
  routeTitleCopy: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 44 },
  routeShareIconAction: {
    width: 44,
    height: 44,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Meta row under the stats: activity icon + "Hiking · 7/8/2036 · 08:21".
  // 13pt/600 Label style per project font rule.
  detailMetaRow: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    marginTop: Spacing.xs, marginBottom: Spacing.lg,
  },
  detailMetaText: {
    fontSize: FontSize.caption, fontWeight: '600', color: Colors.textSecondary,
  },
  activityStateSurface: {
    marginBottom: Spacing.md,
    gap: Spacing.md,
  },
  activityStateRow: {
    minHeight: 34,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.sm,
  },
  activityStateLabel: { fontSize: FontSize.caption, fontWeight: '600' },
  activityStateDetail: { fontSize: FontSize.small, lineHeight: 17, marginTop: 2 },
  linkedCairnSection: { marginBottom: Spacing.md },
  sectionHeadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: Spacing.sm,
  },
  sectionHeading: { fontSize: FontSize.caption, fontWeight: '700' },
  sectionCount: { fontSize: FontSize.small, fontWeight: '600' },
  linkedCairnList: { gap: Spacing.sm, paddingRight: Spacing.sm },
  linkedCairnCard: { width: 244, paddingVertical: Spacing.sm },
  linkedCairnRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  linkedCairnIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  linkedCairnTitle: { fontSize: FontSize.caption, fontWeight: '700' },
  linkedCairnMeta: { fontSize: FontSize.small, marginTop: 2 },
  activityActions: { gap: Spacing.sm, marginTop: Spacing.xs },
  activityDeleteAction: {
    minHeight: 42,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
  },
  activityDeleteText: { fontSize: FontSize.caption, fontWeight: '600' },
  deleteModalActions: { gap: Spacing.sm },
  routeActions: { gap: Spacing.xs, marginTop: Spacing.sm },
  routeOriginBlock: { gap: 3, marginBottom: Spacing.sm },
  routeSyncBlock: { gap: Spacing.xs, marginBottom: Spacing.sm, alignItems: 'flex-start' },
  routeOriginText: { fontSize: FontSize.caption, lineHeight: 19, fontWeight: '600' },
  routeUpdatedText: { fontSize: FontSize.small, lineHeight: 17, marginTop: 2 },
  routeStateText: { fontSize: FontSize.small, lineHeight: 18, marginBottom: Spacing.xs },
  routeMaintenanceRow: { flexDirection: 'row', gap: Spacing.sm },
  routeMaintenanceAction: {
    flexGrow: 1,
    flexBasis: 84,
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.xs,
    borderWidth: 1,
    borderRadius: Radius.button,
  },
  routeActionDisabled: { opacity: 0.42 },
  routeMaintenanceText: { fontSize: FontSize.caption, fontWeight: '700' },
  routeDeleteAction: {
    alignSelf: 'center',
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.xs,
    paddingHorizontal: Spacing.md,
  },
  routeDeleteText: { fontSize: FontSize.small, fontWeight: '600' },
  routeShareFriend: {
    minHeight: 48,
    marginBottom: Spacing.sm,
    paddingHorizontal: Spacing.md,
    borderWidth: 1,
    borderRadius: Radius.button,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.sm,
  },
  legacyRedirect: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.md },
  legacyRedirectText: { fontSize: FontSize.caption, fontWeight: '600' },
  // Concept action row: bounded Activity management actions, side-by-side.
  // Route Detail uses the same
  // pill styles stacked (gap wraps them). Auth submit pill spec:
  // radius 14, minHeight 54, no shadow, 13pt/600 label per project rule.
  actionRow: {
    flexDirection: 'row', gap: Spacing.sm, marginTop: Spacing.xs,
  },
  actionPillPrimary: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: Spacing.sm,
    backgroundColor: Colors.primary,
    borderRadius: 14,
    minHeight: 54,
    paddingHorizontal: Spacing.base,
  },
  actionPillPrimaryText: {
    color: '#fff', fontWeight: '600', fontSize: FontSize.caption,
  },
  actionPillDanger: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: Spacing.sm,
    backgroundColor: Colors.surface,
    borderWidth: 1.5, borderColor: Colors.danger,
    borderRadius: 14,
    minHeight: 54,
    paddingHorizontal: Spacing.base,
  },
  actionPillDangerActive: {
    backgroundColor: Colors.danger, borderColor: Colors.danger,
  },
  actionPillDangerText: {
    color: Colors.danger, fontWeight: '600', fontSize: FontSize.caption,
  },
  renameInput: {
    flex: 1,
    fontSize: FontSize.body,
    fontWeight: '600',
    color: Colors.textPrimary,
    borderBottomWidth: 1,
    borderBottomColor: Colors.primary,
    paddingVertical: 4,
  },
});

const cardStyles = StyleSheet.create({
  routeCard: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.88)', borderRadius: Radius.card,
    overflow: 'hidden',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.40)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.09,
    shadowRadius: 20,
    elevation: 3,
    padding: Spacing.md, gap: Spacing.md,
  },
  routeCardSelected: {
    backgroundColor: Colors.primaryBg,
    borderColor: Colors.primary + '50',
  },
  // O1 — pending-sync grey card layout (LinearGradient fills the card,
  // with a header row: circular icon + title + subtitle underneath).
  routeCardGradient: {
    flex: 1,
    padding: Spacing.md,
    borderRadius: Radius.card,
  },
  routeCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  iconCircle: {
    width: 40, height: 40, borderRadius: 20,
    alignItems: 'center', justifyContent: 'center',
    flexShrink: 0,
  },
  routeCardTitle: {
    fontSize: FontSize.body,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  routeCardSubtitle: {
    fontSize: FontSize.small,
    color: Colors.textMuted,
    marginTop: 2,
  },
  activityBadge: {
    width: 40, height: 40, borderRadius: 12,
    alignItems: 'center', justifyContent: 'center',
    flexShrink: 0,
  },
  routeInfo: { flex: 1, gap: 2 },
  actTypePill: {
    alignSelf: 'flex-start',
    borderRadius: Radius.pill, paddingHorizontal: 8, paddingVertical: 2,
    marginBottom: 1,
  },
  actTypePillText: { fontSize: FontSize.tiny, fontWeight: '700', letterSpacing: 0.3 },
  routePrimary: { fontSize: FontSize.body, fontWeight: '700', color: Colors.textPrimary },
  routeName: { fontSize: FontSize.body, fontWeight: '600', color: Colors.textPrimary },
  routeMeta: { fontSize: FontSize.small, color: Colors.textMuted },
  routeChevron: {},
  deleteBtn: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    borderRadius: Radius.button, paddingVertical: Spacing.md,
    justifyContent: 'center', marginTop: Spacing.sm, marginBottom: Spacing.md,
    borderWidth: 1.5, borderColor: Colors.danger + '50',
    backgroundColor: Colors.dangerBg,
  },
  deleteBtnText: { color: Colors.danger, fontWeight: '600', fontSize: FontSize.body },
  expandedArea: {
    overflow: 'hidden',
    backgroundColor: Colors.surface,
    borderRadius: Radius.card,
    marginTop: -4,
    borderWidth: 1, borderTopWidth: 0, borderColor: Colors.border,
    paddingHorizontal: Spacing.md,
  },
  expandedStats: {
    flexDirection: 'row', justifyContent: 'space-between',
    paddingTop: Spacing.md, paddingBottom: Spacing.sm,
    gap: Spacing.xs,
  },
  expandedCapsule: {
    flex: 1, alignItems: 'center',
    backgroundColor: Colors.bg,
    borderRadius: Radius.card,
    borderLeftWidth: 3,
    paddingVertical: Spacing.xs,
    paddingHorizontal: Spacing.xs,
    ...Shadow.card,
  },
  expandedStat: { alignItems: 'center' },
  expandedStatVal: { fontSize: FontSize.caption, fontWeight: '800', color: Colors.textPrimary },
  expandedStatLbl: { fontSize: FontSize.tiny, color: Colors.textMuted, fontWeight: '600', marginTop: 1 },
  viewOnMapBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: Colors.primary,
    borderRadius: Radius.pill,
    paddingHorizontal: Spacing.lg, paddingVertical: 10,
    marginBottom: Spacing.sm,
    marginHorizontal: Spacing.md,
    justifyContent: 'center',
    ...Shadow.card,
  },
  viewOnMapText: { fontSize: FontSize.small, fontWeight: '700', color: '#fff' },

  // Route preview card styles (STORY-00103)
  routePreviewCard: {
    marginHorizontal: Spacing.md,
    marginBottom: Spacing.sm,
    height: 120,
    backgroundColor: Colors.primaryBg,
    borderRadius: Radius.card,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: Colors.primary + '20',
    ...Shadow.card,
    position: 'relative',
  },
  topoRingOuter: {
    position: 'absolute',
    width: 200, height: 200, borderRadius: 100,
    borderWidth: 1.5, borderColor: Colors.primary + '18',
    top: -40, left: -20,
    zIndex: 1,
  },
  topoRingMid: {
    position: 'absolute',
    width: 140, height: 140, borderRadius: 70,
    borderWidth: 1.5, borderColor: Colors.primary + '22',
    top: -10, left: 10,
    zIndex: 1,
  },
  topoRingInner: {
    position: 'absolute',
    width: 80, height: 80, borderRadius: 40,
    borderWidth: 1.5, borderColor: Colors.primary + '28',
    top: 20, left: 40,
    zIndex: 1,
  },
  previewChipsRow: {
    flexDirection: 'row', gap: Spacing.sm,
    position: 'absolute', top: Spacing.sm, right: Spacing.sm,
  },
  previewChip: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: 'rgba(255,255,255,0.90)',
    borderRadius: Radius.pill,
    paddingHorizontal: 8, paddingVertical: 3,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.45)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 2,
  },
  previewChipText: {
    fontSize: FontSize.tiny, fontWeight: '700',
  },
  previewLabel: {
    fontSize: FontSize.caption, fontWeight: '600',
    color: Colors.primary, opacity: 0.6,
    marginTop: Spacing.xxl,
  },
});

const flagStyles = StyleSheet.create({
  row: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    paddingVertical: Spacing.md,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  iconBadge: {
    width: 44, height: 44, borderRadius: 12,
    borderWidth: 2, alignItems: 'center', justifyContent: 'center',
  },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginBottom: 3 },
  title: { fontSize: FontSize.body, fontWeight: '600', color: Colors.textPrimary },
  typePill: {
    paddingHorizontal: 6, paddingVertical: 2, borderRadius: Radius.pill,
    borderWidth: 1,
  },
  typePillText: { fontSize: FontSize.tiny, fontWeight: '700', textTransform: 'capitalize' },
  note: { fontSize: FontSize.caption, color: Colors.textSecondary },
});

const trackStyles = StyleSheet.create({
  // v198 Bug 5: recenter button shown when user has panned away from
  // the initial route bbox fit. Bottom-right placement, ~44pt circle,
  // matches HikingScreen's recenter visual language.
  recenterBtn: {
    position: 'absolute',
    bottom: 16,
    right: 16,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: Colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    ...Shadow.elevated,
  },
  // 2026-08-16 T-C03: layers FAB stacked above recenter
  layersBtn: {
    position: 'absolute',
    bottom: 68,
    right: 16,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: Colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    ...Shadow.elevated,
  },
  noGpsWrap: {
    position: 'absolute', top: '35%', left: MAP_PADDING, right: MAP_PADDING,
    alignItems: 'center', gap: Spacing.sm,
  },
  noGpsLine: {
    width: '100%', height: 2,
    borderStyle: 'dashed', borderWidth: 2, borderRadius: 1,
    opacity: 0.5,
  },
  noGpsLabel: {
    fontSize: FontSize.small, color: Colors.textMuted,
    fontStyle: 'italic',
  },
  trackDot: {
    position: 'absolute', borderRadius: 6,
  },
  startDot: { width: 12, height: 12 },
  endDot: { width: 16, height: 16, backgroundColor: '#fff', borderWidth: 3 },
  // Native Mapbox PointAnnotation children — same visual language as the
  // SVG-mode dots so users see consistent start / end markers.
  nativeStartDot: {
    width: 14, height: 14, borderRadius: 7,
    borderWidth: 2, borderColor: '#fff',
  },
  nativeEndDot: {
    width: 18, height: 18, borderRadius: 9,
    backgroundColor: '#fff', borderWidth: 3,
  },
  // Marker pin used inside NativeTrackMap PointAnnotation. White inner
  // surface with type-coloured 2px ring + small icon — mirrors the
  // styles.markerPin look used in the SVG fallback so the visual
  // language is the same regardless of map renderer.
  nativeMarkerPin: {
    width: 28, height: 28, borderRadius: 14,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 2,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15, shadowRadius: 4, elevation: 3,
  },
});

const sheetStyles = StyleSheet.create({
  scrim: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: Colors.overlayDark,
    zIndex: 10,
  },
  sheet: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(255,255,255,0.92)',
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    padding: Spacing.xl, paddingBottom: Spacing.xxl,
    gap: Spacing.md, zIndex: 11,
    borderTopWidth: 1, borderColor: 'rgba(255,255,255,0.45)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.10,
    shadowRadius: 24,
    elevation: 12,
  },
  handle: {
    width: 44, height: 5, borderRadius: 3,
    backgroundColor: Colors.border, alignSelf: 'center', marginBottom: Spacing.sm,
  },
  typeBadge: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, alignSelf: 'flex-start',
    borderRadius: Radius.pill, borderWidth: 1.5,
    paddingHorizontal: Spacing.md, paddingVertical: 8,
  },
  typeBadgeText: { fontSize: FontSize.body, fontWeight: '700' },
  noteLabel: { fontSize: FontSize.small, fontWeight: '700', color: Colors.textSecondary,  letterSpacing: 0.8 },
  noteText: { fontSize: FontSize.body, color: Colors.textPrimary, lineHeight: 22 },
  dateLine: { fontSize: FontSize.caption, color: Colors.textMuted },
  deleteBtn: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    borderRadius: Radius.button, paddingVertical: Spacing.md,
    justifyContent: 'center', marginTop: Spacing.sm,
    borderWidth: 1.5, borderColor: Colors.danger + '60',
    backgroundColor: Colors.dangerBg,
  },
  deleteBtnText: { color: Colors.danger, fontWeight: '600', fontSize: FontSize.body },
});
