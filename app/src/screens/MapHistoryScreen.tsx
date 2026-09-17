/**
 * MapHistoryScreen — Sprint 19 track visualization + flag detail sheet
 *
 * - STORY-00043: session track polyline on map when session selected
 * - STORY-00046: flag detail bottom sheet, richer flag list items, improved empty states
 */
import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  ActivityIndicator, View, Text, StyleSheet, TouchableOpacity, ScrollView, Alert,
  Dimensions, Animated, Easing, Platform, TextInput,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CommonActions, useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp, NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/RootNavigator';
import { useSessionStore, loadTrackPoints } from '../store/useSessionStore';
import { useTrackingStore } from '../store/useTrackingStore';
import { fetchSessionDetail } from '../services/sessionService';
import { useRouteStore } from '../store/useRouteStore';
import { useMarkerStore } from '../store/useMarkerStore';
import { crashLogger } from '../services/crashLogger';
import { getCurrentRegion } from '../config/regions';
import { getMapStyleForLayer, getMapStyleForTheme, getPrimaryMapStyle, themeToStandardPreset, buildStandardConfig } from '../config/mapbox';
import { useSettingsStore } from '../store/useSettingsStore';
import { formatDuration, formatDate, getRelativeTime, haversineM } from '../utils/geo';
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
import { ContentSurface } from '../components/ContentSurface';
import { PrimaryButton } from '../components/PrimaryButton';
import { SyncBadge } from '../components/SyncBadge';
import { ModalCard, ModalCardHeader } from '../components/ModalCard';
import {
  deriveActivityRouteState,
} from '../features/activity/activityRouteState';
import {
  activityDetailNotices,
  activityMatchesTarget,
  activityMetricLabels,
  formatAverageActivityPace,
  linkedCairnsForActivity,
} from '../features/activity/activityDetailPresentation';
import { routeMatchesIdentity, routeOriginLines } from '../features/route/routeContracts';
import { cairnDisplayTitle, splitTitleBody } from '../features/plant/services/noteEncoding';
import {
  ALMOST_DONE_CLONE_V1_ID,
  loadOrBuildAlmostDoneCloneV1,
  type AlmostDoneCloneV1,
} from '../features/activity/almostDoneCloneV1';

// ── Conditional Mapbox import ─────────────────────────────────────────────
// Native: render the track on top of a real Mapbox map. Web / Expo Go:
// fall back to the existing SVG-on-coloured-panel rendering.
let MapView: any = null;
let CameraComponent: any = null;
let LineLayer: any = null;
let ShapeSource: any = null;
let PointAnnotation: any = null;
let StyleImport: any = null;
if (Platform.OS !== 'web') {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Mapbox = require('@rnmapbox/maps');
    MapView = Mapbox.MapView;
    CameraComponent = Mapbox.Camera;
    LineLayer = Mapbox.LineLayer;
    ShapeSource = Mapbox.ShapeSource;
    PointAnnotation = Mapbox.PointAnnotation;
    StyleImport = Mapbox.StyleImport;
  } catch {
    // @rnmapbox/maps not in this build — fallback panel will render.
  }
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
// Used in place of the SVG-on-coloured-panel TrackPolyline when
// @rnmapbox/maps is available (i.e. on a real device, not web).
function NativeTrackMap({ session, markers }: { session: TrackingSession; markers: Marker[] }) {
  const pts = session.trackPoints;
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
  const cameraRef = useRef<any>(null);
  if (!MapView || pts.length < 2) return null;

  // Bounding box of the track for camera fit.
  const lats = pts.map(p => p.lat);
  const lngs = pts.map(p => p.lng);
  let minLat = Math.min(...lats);
  let maxLat = Math.max(...lats);
  let minLng = Math.min(...lngs);
  let maxLng = Math.max(...lngs);

  // Guard against degenerate bounding boxes — if the track is very
  // short or stationary (user paused/idle GPS), the bbox can be only
  // a few metres across, which makes Mapbox fit at maximum zoom and
  // shows just a single dot with no surrounding context. Expand the
  // bbox to a minimum ~600m visual span so users always see the
  // surrounding road network.
  const MIN_SPAN_DEG = 0.005; // ~555m at NZ latitudes
  const latSpan = maxLat - minLat;
  const lngSpan = maxLng - minLng;
  if (latSpan < MIN_SPAN_DEG) {
    const cLat = (minLat + maxLat) / 2;
    minLat = cLat - MIN_SPAN_DEG / 2;
    maxLat = cLat + MIN_SPAN_DEG / 2;
  }
  if (lngSpan < MIN_SPAN_DEG) {
    const cLng = (minLng + maxLng) / 2;
    minLng = cLng - MIN_SPAN_DEG / 2;
    maxLng = cLng + MIN_SPAN_DEG / 2;
  }

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
      style={StyleSheet.absoluteFillObject}
      {...(resolvedMapStyle.kind === 'url'
        ? { styleURL: resolvedMapStyle.url }
        : { styleJSON: resolvedMapStyle.json })}
      logoEnabled
      attributionEnabled
      logoPosition={{ top: 76, right: 8 }}
      attributionPosition={{ top: 112, right: 8 }}
      scaleBarEnabled={false}
      compassEnabled={false}
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
          bounds={{
            ne: [maxLng, maxLat],
            sw: [minLng, minLat],
            paddingTop: 60,
            paddingBottom: 60,
            paddingLeft: 40,
            paddingRight: 40,
          }}
          pitch={0}
          animationDuration={0}
        />
      )}
      {ShapeSource && LineLayer && (() => {
        const trace = segmentTrace(pts);
        const solidFeatures = trace.segments.filter(segment => segment.length >= 2).map((segment, i) => ({
          type: 'Feature' as const,
          id: `solid-${i}`,
          geometry: { type: 'LineString' as const, coordinates: segment.map(point => [point.lng, point.lat]) },
          properties: {},
        }));
        return (
          <>
            {solidFeatures.length > 0 && (
              <ShapeSource
                id="track-line"
                shape={{ type: 'FeatureCollection', features: solidFeatures }}
              >
                <LineLayer
                  id="track-line-layer"
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
          </>
        );
      })()}
      {PointAnnotation && (
        <>
          <PointAnnotation id="track-start" coordinate={[start.lng, start.lat]}>
            <View style={[trackStyles.nativeStartDot, { backgroundColor: color }]} />
          </PointAnnotation>
          <PointAnnotation id="track-end" coordinate={[end.lng, end.lat]}>
            <View style={[trackStyles.nativeEndDot, { borderColor: color }]} />
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
            [60, 40, 60, 40], // [top, right, bottom, left]
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
function TrackPolyline({ session }: { session: TrackingSession }) {
  const theme = useVisualTheme();
  const pts = session.trackPoints;
  const color = session.activityMode === 'running' ? Colors.running : Colors.primary;

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
      ? 'Route data unavailable'
      : pts.length === 0
        ? 'Activity too short to record path'
        : 'Only one GPS sample — keep moving longer to record a path';
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
  const theme = useVisualTheme();
  const isRun = session.activityMode === 'running';
  const dateStr = formatDate(session.startedAt);
  // O12: settings-aware distance format.
  const dist = useDistance();
  // Display label prefers the user-assigned name; falls back to type
  // when no name was set. Earlier versions hardcoded 'Run' / 'Hike'
  // here, dropping whatever the user typed in the stop-summary sheet.
  const actLabel = session.name || (isRun ? 'Run' : 'Hike');
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
    Alert.alert(
      'Discard this hike?',
      '',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Discard',
          style: 'destructive',
          onPress: () => {
            // Second confirmation
            Alert.alert(
              'Confirm discard?',
              'This hike will be permanently deleted and cannot be recovered.',
              [
                { text: 'Cancel', style: 'cancel' },
                {
                  text: 'Confirm',
                  style: 'destructive',
                  onPress: async () => {
                    try {
                      // eslint-disable-next-line @typescript-eslint/no-require-imports
                      const { abandonPending } = require('../services/syncDaemon');
                      await abandonPending(session.id);
                    } catch { /* silent */ }
                  },
                },
              ],
              { cancelable: true }
            );
          },
        },
      ],
      { cancelable: true }
    );
  };

  return (
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
          accessibilityLabel="Open saved Activity. Long-press to discard."
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
                  <Text style={[cardStyles.routeCardSubtitle, { color: theme.muted }]}>
                    {distStr} · {durationStr}
                  </Text>
                </View>
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6 }}>
                <Icon name="CloudOff" size={12} color={theme.iconInactive} strokeWidth={2} />
                <Text style={{ color: theme.foregroundSecondary, fontSize: FontSize.caption }}>
                  {session.syncState === 'syncing'
                    ? 'Syncing…'
                    : session.syncState === 'sync_error'
                      ? 'Sync issue · Retrying'
                      : 'Waiting to sync'}
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
            <Text style={[cardStyles.routeMeta, { color: theme.muted }]}>{dateStr} · {distStr}</Text>
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
            <Text style={[cardStyles.expandedStatLbl, { color: theme.muted }]}>time</Text>
          </View>
          <View style={[cardStyles.expandedCapsule, { borderLeftColor: Colors.severityCaution, backgroundColor: theme.surfaceElevated }]}>
            <Text style={[cardStyles.expandedStatVal, { color: theme.foreground }]}>+{dist.formatElevation(session.elevationGainM ?? 0)}{dist.elevUnit}</Text>
            <Text style={[cardStyles.expandedStatLbl, { color: theme.muted }]}>elev</Text>
          </View>
          <View style={[cardStyles.expandedCapsule, { borderLeftColor: Colors.flag, backgroundColor: theme.surfaceElevated }]}>
            <Text style={[cardStyles.expandedStatVal, { color: theme.foreground }]}>{session.markerIds?.length ?? 0}</Text>
            <Text style={[cardStyles.expandedStatLbl, { color: theme.muted }]}>flags</Text>
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
          <Text style={[cardStyles.previewLabel, { color: theme.foregroundSecondary }]}>Preview</Text>
        </View>
        </Animated.View>

        <Animated.View style={{ opacity: ctaOpacity, transform: [{ translateY: ctaTransY }] }}>
        <TouchableOpacity style={[cardStyles.viewOnMapBtn, { backgroundColor: theme.primary }]} onPress={onViewOnMap}>
          <Icon name="Map" size={14} color={theme.onPrimary} strokeWidth={2} />
          <Text style={[cardStyles.viewOnMapText, { color: theme.onPrimary }]}>View on Map</Text>
        </TouchableOpacity>
        </Animated.View>
      </Animated.View>
      )}
    </View>
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
    if (!deleteConfirm) { setDeleteConfirm(true); return; }
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
        <Text style={[sheetStyles.noteLabel, { color: theme.foregroundSecondary }]}>Note</Text>
        <Text style={[sheetStyles.noteText, { color: theme.foreground }]} numberOfLines={4}>{marker.note || 'No note yet'}</Text>
        {/* Date */}
        <Text style={[sheetStyles.dateLine, { color: theme.muted }]}>Planted: {dateStr}</Text>
        {/* Delete */}
        <TouchableOpacity
          style={[sheetStyles.deleteBtn, { backgroundColor: theme.surface, borderColor: theme.destructive }, deleteConfirm && { backgroundColor: theme.destructive }]}
          onPress={handleDelete}
        >
          <Icon name="Trash2" size={IconSize.sm} color={deleteConfirm ? theme.onPrimary : theme.destructive} strokeWidth={2} />
          <Text style={[sheetStyles.deleteBtnText, { color: deleteConfirm ? theme.onPrimary : theme.destructive }]}>{deleteConfirm ? 'Confirm Delete' : 'Delete Cairn'}</Text>
        </TouchableOpacity>
      </Animated.View>
    </>
  );
}

// ── Main ────────────────────────────────────────────────────────────────────
function MapHistoryObjectScreen() {
  const visualTheme = useVisualTheme();
  const nav = useNavigation<Nav>();
  const route = useRoute<any>();
  const targetQaReviewClone = route.params?.qaReviewClone as 'almost-done-v1' | undefined;
  const targetSessionId = targetQaReviewClone
    ? ALMOST_DONE_CLONE_V1_ID
    : route.params?.sessionId as string | undefined;
  const targetRouteId = (route.params as { routeId?: string } | undefined)?.routeId;
  // 2026-08-16 Round 13: Route Detail (concept T5) — look up route object
  // by targetRouteId. Renders a full-screen route detail view with Edit Route
  // + Preview + Delete stacked buttons per row-03 col 5.
  const allRoutes = useRouteStore(s => s.routes);
  const selectedRoute = targetRouteId
    ? allRoutes.find(item => routeMatchesIdentity(item, targetRouteId)) ?? null
    : null;
  const loadRouteDetail = useRouteStore(s => s.loadRouteDetail);
  const routeDetailState = useRouteStore(s => targetRouteId
    ? (s.routeDetailState[selectedRoute?.id ?? targetRouteId] ?? 'idle')
    : 'idle');
  const [routeUseLoading, setRouteUseLoading] = useState(false);
  const [routeUseTargetId, setRouteUseTargetId] = useState<string | null>(null);
  const [routeDeleteConfirm, setRouteDeleteConfirm] = useState(false);
  const routeUseInFlightRef = useRef(false);
  // O12: settings-aware distance format for detail modal + stat displays.
  const dist = useDistance();
  const debugMode = useSettingsStore(s => s.debugMode);
  const [qaReviewClone, setQaReviewClone] = useState<AlmostDoneCloneV1 | null>(null);
  const [qaReviewError, setQaReviewError] = useState<string | null>(null);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  // A Detail screen owns its projection for the lifetime of this mount. Sync
  // may delete handed-off local files while the screen is open; retaining the
  // summary and trace here prevents a subsequent failed server fetch from
  // replacing a visible Activity with an empty state.
  const detailSessionSnapshots = useRef(new Map<string, TrackingSession>());
  const detailTrackSnapshots = useRef(new Map<string, import('../store/useSessionStore').TrackPoint[]>());
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
    if (!targetRouteId || (selectedRoute && selectedRoute.points.length >= 2)) return;
    void loadRouteDetail(selectedRoute?.id ?? targetRouteId).catch(() => {});
  }, [loadRouteDetail, selectedRoute?.id, selectedRoute?.points.length, targetRouteId]);

  const useSelectedRoute = useCallback(async () => {
    if (!selectedRoute || routeUseLoading || routeUseInFlightRef.current) return;
    routeUseInFlightRef.current = true;
    setRouteUseLoading(true);
    try {
      if (selectedRoute.points.length < 2) {
        await loadRouteDetail(selectedRoute.id);
      }
      const ready = useRouteStore.getState().routes.find(item => routeMatchesIdentity(item, selectedRoute.id));
      if (!ready || ready.points.length < 2) {
        Alert.alert(
          'Route unavailable',
          'This route’s path is not available on this device yet. Check your connection and try again.',
        );
        return;
      }
      const tracking = useTrackingStore.getState();
      if (tracking.status !== 'idle') {
        Alert.alert(
          'Activity already in progress',
          'Finish or discard the current Activity before choosing another Route.',
          [
            {
              text: 'Return to Activity',
              onPress: () => {
                routeUseInFlightRef.current = false;
                nav.navigate(tracking.activityMode === 'running' ? 'Running' : 'Hiking');
              },
            },
            { text: 'Stay here', style: 'cancel', onPress: () => { routeUseInFlightRef.current = false; } },
          ],
        );
        return;
      }
      setRouteUseTargetId(ready.id);
    } catch {
      Alert.alert('Route unavailable', 'The route could not be prepared. Check your connection and try again.');
    } finally {
      routeUseInFlightRef.current = false;
      setRouteUseLoading(false);
    }
  }, [loadRouteDetail, nav, routeUseLoading, selectedRoute]);

  const openRouteForActivity = useCallback((mode: 'hiking' | 'running') => {
    if (!routeUseTargetId || routeUseInFlightRef.current) return;
    const ready = useRouteStore.getState().routes.find(item => routeMatchesIdentity(item, routeUseTargetId));
    if (!ready || ready.points.length < 2) {
      setRouteUseTargetId(null);
      Alert.alert('Route unavailable', 'The route could not be prepared. Check your connection and try again.');
      return;
    }
    routeUseInFlightRef.current = true;
    setRouteUseTargetId(null);
    if (mode === 'running') nav.navigate('Running', { routeId: ready.id });
    else nav.navigate('Hiking', { routeId: ready.id });
    routeUseInFlightRef.current = false;
  }, [nav, routeUseTargetId]);

  const region = getCurrentRegion();
  const allSessions = useSessionStore(s => s.sessions);
  const resolvedTargetSession = targetSessionId
    ? allSessions.find(session => activityMatchesTarget(session, targetSessionId)) ?? null
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
  const [invalidatedSessionId, setInvalidatedSessionId] = useState<string | null>(null);
  const [deleteSaving, setDeleteSaving] = useState(false);
  const [routeDraftOpening, setRouteDraftOpening] = useState(false);
  const allMarkers = useMarkerStore(s => s.markers);
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
      setRenameEditing(false);
    } catch {
      setRouteActionError('The Route name was not saved. Your draft is still here.');
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
      setRouteActionError('The Route was not deleted. Try again when you are ready.');
      setRouteDeleteConfirm(false);
    } finally {
      routeDeleteInFlightRef.current = false;
      setDeleteSaving(false);
    }
  }, [deleteSaving, nav, selectedRoute]);

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

  const commitActivityRename = useCallback(async () => {
    const id = selectedSessionId;
    const trimmed = renameText.trim();
    if (!id || id === invalidatedSessionId || !trimmed || renameSaving) return;
    setRenameSaving(true);
    const result = await renameSession(id, trimmed);
    setRenameSaving(false);
    if (result.ok) {
      setRenameEditing(false);
      return;
    }
    const message = result.reason === 'syncing'
      ? 'This Activity is syncing. Try renaming again when sync completes.'
      : result.reason === 'pending-missing'
        ? 'The pending Activity save could not be found. Rename was not applied.'
        : result.reason === 'not-found'
          ? 'This Activity no longer exists. Rename was not applied.'
          : 'Rename could not be saved. Check your connection and try again.';
    Alert.alert('Rename failed', message);
  }, [invalidatedSessionId, renameSaving, renameSession, renameText, selectedSessionId]);

  const deleteSelectedActivity = useCallback(async () => {
    const id = selectedSessionId;
    if (!id || id === invalidatedSessionId || deleteSaving) return;
    // Invalidate this mounted projection before the first await. It can no
    // longer rename, create a Route, or re-delete while persistence runs.
    setInvalidatedSessionId(id);
    setDeleteSaving(true);
    setRenameEditing(false);
    detailSessionSnapshots.current.delete(id);
    detailTrackSnapshots.current.delete(id);
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
          'Delete queued',
          'The Activity is removed from this iPhone. Cairn will finish deleting the server copy when you are online.',
        );
      }
    } catch {
      setInvalidatedSessionId(null);
      Alert.alert('Delete failed', 'The Activity could not be deleted. Try again.');
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
    const session = useSessionStore.getState().sessions.find(s => s.id === selectedSessionId) ?? null;
    if (session && !detailSessionSnapshots.current.has(selectedSessionId)) {
      detailSessionSnapshots.current.set(selectedSessionId, {
        ...session,
        trackPoints: [...(session.trackPoints ?? [])],
        markerIds: [...(session.markerIds ?? [])],
      });
    }
    const retainedTrack = detailTrackSnapshots.current.get(selectedSessionId);
    if (retainedTrack) {
      setLoadedTrackPoints(retainedTrack);
      return;
    }
    if (session && Array.isArray(session.trackPoints) && session.trackPoints.length >= 2) {
      const snapshot = session.trackPoints.map(point => ({ ...point }));
      detailTrackSnapshots.current.set(selectedSessionId, snapshot);
      setLoadedTrackPoints(snapshot);
      return;
    }
    setLoadedTrackPoints(null);
    let cancelled = false;
    // O6 (2026-07-26): 添加 15s 超时。之前 fetchSessionDetail 无超时,
    // 若网络卡住 (server slow / 用户切飞行模式 mid-fetch) 就永远
    // stuck 在 loadedTrackPoints=null 状态,TrackPolyline 显示
    // "Loading route…" 转圈永远不停。这是 Bug 5 根因。超时后 fall
    // through 到 local cache;如果 local 也空则显示 "Route data unavailable"。
    const timeoutMs = 15000;
    let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
    (async () => {
      const remoteId = session?.remoteId;
      if (remoteId != null) {
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
          detailTrackSnapshots.current.set(selectedSessionId, normalised);
          setLoadedTrackPoints(normalised);
          return;
        }
        // O6: server 请求 timeout 或 route_points 为空/太短 → 落 local。
      }
      // No remoteId yet (offline-only session) or fetch failed/timed out — fall
      // back to local cache. If local also empty, set [] so UI can stop the
      // spinner and show the correct message ("too short" for distanceM===0
      // sessions, or a clean "no route data" state for others).
      const local = await loadTrackPoints(selectedSessionId);
      if (!cancelled) {
        const snapshot = local ?? [];
        detailTrackSnapshots.current.set(selectedSessionId, snapshot);
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
  // Route params are mount-lifetime authority for this Detail. Retain the
  // established selectedSessionId-only loader contract so a SessionStore
  // refresh cannot restart or replace a mounted trace snapshot.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSessionId]);

  // Merge loaded track points into the selected session for display.
  // v261: when loadedTrackPoints === null we are still loading; pass [] so
  // existing length-checks stay safe, but track the loading flag separately.
  const isLoadingTrackPoints = loadedTrackPoints === null;
  const sessionForDisplay = selectedSession
    ? { ...selectedSession, trackPoints: loadedTrackPoints ?? [] }
    : null;
  const isQaReviewClone = selectedSession?.id === ALMOST_DONE_CLONE_V1_ID;
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

  const openActivityRouteDraft = useCallback(() => {
    if (!selectedSession || routeDraftOpening) return;
    const realSegments = segmentTrace(loadedTrackPoints ?? []).segments
      .filter(segment => segment.length >= 2);
    const openSegment = (segment: typeof realSegments[number], reconnectsGap = false) => {
      if (routeDraftOpening) return;
      setRouteDraftOpening(true);
      crashLogger.breadcrumb(`saveroute:nav-to-editor session=${selectedSession.id} segment=${segment[0]?.segmentId ?? 'legacy'}`);
      (nav as any).navigate('RouteEditor', {
        fromSessionId: selectedSession.id,
        reconnectsActivityGap: reconnectsGap,
        fromSessionTrackPoints: segment.map(point => ({
          lat: point.lat,
          lng: point.lng,
          alt: point.alt ?? null,
          t: point.t,
          accuracy: point.accuracy ?? null,
        })),
      });
    };
    if (realSegments.length <= 1) {
      if (realSegments[0]) openSegment(realSegments[0]);
      return;
    }
    Alert.alert(
      'Choose a recorded section',
      'The missing section is not Activity geometry. Choose one recorded section, or explicitly reconnect only in the new Route.',
      [
        {
          text: 'Reconnect in Route',
          onPress: () => openSegment(realSegments.flat(), true),
        },
        ...realSegments.map((segment, index) => ({
          text: `Section ${index + 1}`,
          onPress: () => openSegment(segment),
        })),
        { text: 'Cancel', style: 'cancel' as const },
      ],
    );
  }, [loadedTrackPoints, nav, routeDraftOpening, selectedSession]);

  // Show real markers on map. Activity Detail requires explicit Activity
  // provenance or recorded marker membership; spatial proximity alone never
  // claims that an arbitrary Cairn came from this Activity.
  const mapMarkers: Marker[] = sessionForDisplay
    ? routeFlags
    : markers.slice(0, 8);
  const routePreviewSession = selectedRoute && selectedRoute.points.length >= 2
    ? ({
        id: `route-preview-${selectedRoute.id}`,
        activityMode: selectedRoute.activityMode ?? 'hiking',
        trackPoints: selectedRoute.points.map((point, index) => ({
          ...point,
          t: selectedRoute.createdAt + index,
          segmentId: 'route-reference',
        })),
      } as unknown as TrackingSession)
    : null;

  return (
    <View style={[styles.container, { backgroundColor: visualTheme.background }]}>
      {/* Map area */}
      <View style={[styles.mapArea, { backgroundColor: visualTheme.background }]}>
        {/* Track polyline when session selected. Native (iOS/Android with
            @rnmapbox/maps available) renders the track on a real Mapbox
            map; web/Expo Go falls back to the SVG-on-panel rendering. */}
        {routePreviewSession ? (
          MapView
            ? <NativeTrackMap session={routePreviewSession} markers={[]} />
            : <TrackPolyline session={routePreviewSession} />
        ) : targetRouteId ? (
          <View style={trackStyles.noGpsWrap} testID="route-map-unavailable">
            {routeDetailState === 'loading' ? <ActivityIndicator color={visualTheme.primary} /> : null}
            <Text style={[trackStyles.noGpsLabel, { color: visualTheme.foregroundSecondary }]}>
              {routeDetailState === 'not-found'
                ? 'Route unavailable'
                : routeDetailState === 'error'
                  ? 'Route map unavailable — details remain accessible offline'
                  : 'Preparing Route map…'}
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
              ? <NativeTrackMap session={sessionRender} markers={routeFlags} />
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
        {!(sessionRender && MapView && sessionRender.trackPoints.length >= 2) && mapMarkers.map((m, i) => {
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
        <View style={styles.topRow}>
          <BackButton
            variant="inline"
            onPress={targetSessionId
              ? returnToActivities
              : undefined}
          />
          {/* User decision 2026-08-16: Trails index view (no targetSessionId)
              has NO top title — the tab bar (Activities/Routes/Cairns) below
              already anchors the context. Only detail views show a title.
              Type-specific label based on which detail is open. */}
          <Text style={[styles.topTitle, { color: visualTheme.foreground }]}>{targetRouteId ? 'Route Detail' : targetSessionId ? 'Activity Detail' : (tab === 'flags' ? 'Cairns' : 'Routes')}</Text>
          {/* User decision 2026-08-16: Plan button removed from Trails top row.
              Also drop the right-side spacer — nothing to balance now. */}
          {!targetSessionId && !targetRouteId ? (
            <View style={{ width: 40 }} />
          ) : (
            <View style={{ width: 40 }} />
          )}
        </View>

        {/* Tab bar — only show when viewing all sessions (Trails index). Hide
            for both Activity Detail (targetSessionId) and Route Detail (targetRouteId). */}
        {!targetSessionId && !targetRouteId && (
          <View style={styles.tabBar}>
            <TouchableOpacity
              style={[styles.tabItem, tab === 'routes' && styles.tabItemActive]}
              onPress={() => setTab('routes')}
            >
              <Icon name="Route" size={14} color={tab === 'routes' ? Colors.primary : Colors.textSecondary} strokeWidth={2} />
              <Text style={[styles.tabText, tab === 'routes' && styles.tabTextActive]}>
                Routes{sessions.length > 0 ? ` (${sessions.length})` : ''}
              </Text>
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
      {targetRouteId && selectedRoute ? (
        <>
        <View style={[styles.singleSessionPanel, { backgroundColor: visualTheme.surfaceElevated, borderColor: visualTheme.border, shadowColor: visualTheme.shadow }]}>
          <View style={[styles.panelHandle, { backgroundColor: visualTheme.border }]} />
          <View style={{ marginBottom: Spacing.md }}>
            {renameEditing ? (
              <View style={{ flexDirection: 'row', gap: Spacing.sm, alignItems: 'center' }}>
                <TextInput
                  style={[styles.renameInput, { color: visualTheme.foreground, borderBottomColor: visualTheme.primary }]}
                  value={renameText}
                  onChangeText={setRenameText}
                  autoFocus
                  maxLength={60}
                  editable={!renameSaving}
                  onSubmitEditing={() => { void commitRouteRename(); }}
                  returnKeyType="done"
                  placeholder="Route name"
                  placeholderTextColor={visualTheme.muted}
                />
                <TouchableOpacity
                  onPress={() => { void commitRouteRename(); }}
                  disabled={renameSaving || !renameText.trim()}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  accessibilityLabel="Save new route name"
                >
                  {renameSaving
                    ? <ActivityIndicator size="small" color={visualTheme.primary} />
                    : <Icon name="Check" size={20} color={visualTheme.iconActive} strokeWidth={2.5} />}
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => setRenameEditing(false)}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  accessibilityLabel="Cancel rename"
                >
                  <Icon name="X" size={20} color={visualTheme.iconInactive} strokeWidth={2.5} />
                </TouchableOpacity>
              </View>
            ) : (
              <TouchableOpacity
                disabled={isQaReviewClone}
                onPress={() => {
                  setRenameText(selectedRoute.name || 'Route');
                  setRenameEditing(true);
                }}
                accessibilityRole="button"
                accessibilityLabel="Rename route"
                hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Text style={[styles.detailTitle, { color: visualTheme.foreground }]} numberOfLines={1}>{selectedRoute.name || 'Route'}</Text>
                  <Icon name="Pencil" size={14} color={visualTheme.iconInactive} strokeWidth={2} />
                </View>
              </TouchableOpacity>
            )}
          </View>
          {selectedRoute.syncState && selectedRoute.syncState !== 'synced' ? (
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
                    ? 'The source Activity was deleted before this Route could sync. This Route remains saved on this device.'
                    : selectedRoute.syncErrorCode === 'SOURCE_ACTIVITY_UNAUTHORIZED'
                      ? 'The source Activity is not available to this account. This Route remains saved on this device.'
                      : 'This Route is saved on this device. Retry when your connection is available.'}
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
            {routeOriginLines(selectedRoute).map(line => (
              <Text key={line} style={[styles.routeOriginText, { color: visualTheme.foregroundSecondary }]}>{line}</Text>
            ))}
            {selectedRoute.originPersistence === 'legacy-local' ? (
              <Text style={[styles.routeStateText, { color: Colors.warning }]}>Origin is saved on this device; server support is pending.</Text>
            ) : null}
            <Text style={[styles.routeUpdatedText, { color: visualTheme.muted }]}>Updated {formatDate(selectedRoute.updatedAt)}</Text>
          </View>
          <View style={styles.singleSessionStats}>
            <View style={styles.singleStat}>
              <Text style={[styles.singleStatValue, { color: visualTheme.foreground }]}>{dist.format(selectedRoute.distanceM ?? 0, 2)}</Text>
              <Text style={[styles.singleStatLabel, { color: visualTheme.foregroundSecondary }]}>{dist.unit}</Text>
            </View>
            {selectedRoute.elevationGainM > 0 ? (
              <View style={styles.singleStat}>
                <Text style={[styles.singleStatValue, { color: visualTheme.foreground }]}>+{dist.formatElevation(selectedRoute.elevationGainM)}{dist.elevUnit}</Text>
                <Text style={[styles.singleStatLabel, { color: visualTheme.foregroundSecondary }]}>elevation</Text>
              </View>
            ) : null}
          </View>
          <View style={styles.routeActions}>
            <PrimaryButton
              label="Use Route"
              onPress={() => { void useSelectedRoute(); }}
              loading={routeUseLoading}
              renderIcon={color => <Icon name="Navigation" size={IconSize.sm} color={color} strokeWidth={2} />}
              testID="route-use-action"
            />
            <View style={styles.routeMaintenanceRow}>
              <TouchableOpacity
                style={[styles.routeMaintenanceAction, { backgroundColor: visualTheme.secondaryAction, borderColor: visualTheme.borderStrong }]}
                onPress={() => {
                  (nav as any).navigate('RouteEditor', { routeId: selectedRoute.id });
                }}
                accessibilityRole="button"
                accessibilityLabel="Edit route"
              >
                <Icon name="Edit3" size={IconSize.sm} color={visualTheme.iconActive} strokeWidth={2} />
                <Text style={[styles.routeMaintenanceText, { color: visualTheme.foreground }]}>Edit</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.routeMaintenanceAction, { backgroundColor: visualTheme.destructiveSurface, borderColor: visualTheme.destructive }]}
                onPress={() => setRouteDeleteConfirm(true)}
                disabled={deleteSaving}
                accessibilityRole="button"
                accessibilityLabel="Delete route"
              >
                {deleteSaving
                  ? <ActivityIndicator size="small" color={visualTheme.destructive} />
                  : <Icon name="Trash2" size={IconSize.sm} color={visualTheme.destructive} strokeWidth={2} />}
                <Text style={[styles.routeMaintenanceText, { color: visualTheme.destructive }]}>Delete</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
        <ModalCard
          visible={routeUseTargetId != null}
          onDismiss={() => setRouteUseTargetId(null)}
          testID="route-use-mode-picker"
        >
          <ModalCardHeader
            title="Use this Route"
            body="Choose an Activity. This Route is shown on the map for reference, and you will review it before starting."
            onClose={() => setRouteUseTargetId(null)}
          />
          <View style={styles.deleteModalActions}>
            <PrimaryButton
              label="Hike"
              onPress={() => openRouteForActivity('hiking')}
              testID="route-use-hike"
            />
            <PrimaryButton
              label="Run"
              variant="secondary"
              onPress={() => openRouteForActivity('running')}
              testID="route-use-run"
            />
            <PrimaryButton
              label="Cancel"
              variant="secondary"
              onPress={() => setRouteUseTargetId(null)}
            />
          </View>
        </ModalCard>
        <ModalCard
          visible={routeDeleteConfirm}
          onDismiss={() => !deleteSaving && setRouteDeleteConfirm(false)}
          dismissible={!deleteSaving}
          testID="route-delete-confirmation"
        >
          <ModalCardHeader
            title="Delete Route?"
            body="This removes the Route. Its source Activity, Cairns, and Memory stay unchanged."
            onClose={deleteSaving ? undefined : () => setRouteDeleteConfirm(false)}
          />
          <View style={styles.deleteModalActions}>
            <PrimaryButton
              label="Delete Route"
              variant="destructive"
              onPress={() => { void deleteSelectedRoute(); }}
              loading={deleteSaving}
              testID="route-delete-confirm"
            />
            <PrimaryButton
              label="Keep Route"
              variant="secondary"
              onPress={() => setRouteDeleteConfirm(false)}
              disabled={deleteSaving}
            />
          </View>
        </ModalCard>
        </>
      ) : targetRouteId ? (
        <View style={[styles.singleSessionPanel, { backgroundColor: visualTheme.surfaceElevated, borderColor: visualTheme.border, shadowColor: visualTheme.shadow }]} testID="route-detail-state">
          <View style={[styles.panelHandle, { backgroundColor: visualTheme.border }]} />
          <Text style={[styles.detailTitle, { color: visualTheme.foreground }]}>
            {routeDetailState === 'not-found' ? 'Route unavailable' : 'Loading Route'}
          </Text>
          <Text style={[styles.routeOriginText, { color: visualTheme.foregroundSecondary, marginTop: Spacing.sm }]}>
            {routeDetailState === 'not-found'
              ? 'This Route may have been deleted or is not available to this account.'
              : routeDetailState === 'error'
                ? 'The Route could not be loaded. Check your connection and try again.'
                : 'Preparing the saved Route…'}
          </Text>
          {routeDetailState === 'error' ? (
            <View style={{ marginTop: Spacing.lg }}>
              <PrimaryButton label="Try Again" onPress={() => { void loadRouteDetail(targetRouteId); }} />
            </View>
          ) : null}
        </View>
      ) : targetSessionId && selectedSession ? (
        <>
          <View style={[styles.singleSessionPanel, styles.activityDetailPanel, { backgroundColor: visualTheme.surfaceElevated, borderColor: visualTheme.border, shadowColor: visualTheme.shadow }]}>
            <View style={[styles.panelHandle, { backgroundColor: visualTheme.border }]} />
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
                      style={[styles.renameInput, { color: visualTheme.foreground, borderBottomColor: visualTheme.primary }]}
                      value={renameText}
                      onChangeText={setRenameText}
                      autoFocus
                      maxLength={60}
                      onSubmitEditing={() => { void commitActivityRename(); }}
                      editable={!renameSaving}
                      returnKeyType="done"
                      placeholder={selectedSession.activityMode === 'running' ? 'Run name' : 'Hike name'}
                      placeholderTextColor={visualTheme.muted}
                    />
                    {renameSaving ? <ActivityIndicator size="small" color={visualTheme.primary} /> : (
                      <TouchableOpacity
                        onPress={() => { void commitActivityRename(); }}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                        accessibilityLabel="Save new Activity name"
                      >
                        <Icon name="Check" size={20} color={visualTheme.iconActive} strokeWidth={2.5} />
                      </TouchableOpacity>
                    )}
                    <TouchableOpacity
                      onPress={() => setRenameEditing(false)}
                      disabled={renameSaving}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      accessibilityLabel="Cancel rename"
                    >
                      <Icon name="X" size={20} color={visualTheme.iconInactive} strokeWidth={2.5} />
                    </TouchableOpacity>
                  </View>
                ) : (
                  <TouchableOpacity
                    disabled={isQaReviewClone}
                    onPress={() => {
                      setRenameText(selectedSession.name || (selectedSession.activityMode === 'running' ? 'Run' : 'Hike'));
                      setRenameEditing(true);
                    }}
                    accessibilityRole="button"
                    accessibilityLabel={`Rename ${selectedSession.activityMode === 'running' ? 'Run' : 'Hike'} Activity`}
                    accessibilityHint="Double tap to edit the Activity name"
                    hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
                  >
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <Text style={[styles.detailTitle, { color: visualTheme.foreground }]} numberOfLines={2}>
                        {selectedSession.name || (selectedSession.activityMode === 'running' ? 'Run' : 'Hike')}
                      </Text>
                      {!isQaReviewClone ? <Icon name="Pencil" size={14} color={visualTheme.iconInactive} strokeWidth={2} /> : null}
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
                <Text style={[styles.detailMetaText, { color: visualTheme.foregroundSecondary }]}>
                  {selectedSession.activityMode === 'running' ? 'Run' : 'Hike'}
                  {'  ·  '}
                  {formatDate(selectedSession.startedAt)}
                  {'  ·  '}
                  {new Date(selectedSession.startedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </Text>
              </View>

              {isQaReviewClone ? (
                <View style={styles.detailMetaRow} testID="qa-snap-review-clone-label">
                  <Icon name="Eye" size={13} color={visualTheme.iconActive} strokeWidth={2} />
                  <Text style={[styles.detailMetaText, { color: visualTheme.primary, fontWeight: '700' }]}>QA / SNAP REVIEW CLONE · NO PRODUCT EFFECTS</Text>
                </View>
              ) : null}

              <View style={[styles.singleSessionStats, styles.activityMetrics, { borderColor: visualTheme.borderSubtle }]}>
                <View style={[styles.singleStat, styles.activityMetricStat]}>
                  <Text style={[styles.singleStatValue, { color: visualTheme.foreground }]}>{dist.format(selectedSession.distanceM, 1)}</Text>
                  <Text style={[styles.singleStatLabel, { color: visualTheme.foregroundSecondary }]}>{selectedMetricLabels[0]} · {dist.unit}</Text>
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
                      : `+${dist.formatElevation(selectedSession.elevationGainM ?? 0)}${dist.elevUnit}`}
                  </Text>
                  <Text style={[styles.singleStatLabel, { color: visualTheme.foregroundSecondary }]}>
                    {selectedMetricLabels[2]}{selectedSession.activityMode === 'running' ? ` · /${dist.unit}` : ''}
                  </Text>
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
                        onPress={() => { void import('../services/syncDaemon').then(({ drainPending }) => drainPending()); }}
                        accessibilityRole="button"
                        accessibilityLabel="Retry Activity sync"
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
                    <Text style={[styles.sectionHeading, { color: visualTheme.foreground }]}>Cairns from this Activity</Text>
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
                                {marker.syncState === 'failed' ? 'Sync needs attention' : meta.label}
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
                  <Text style={[styles.detailMetaText, { color: visualTheme.foregroundSecondary }]}>Read-only · rename, delete, Save as Route, sync, Memory and stats are disabled</Text>
                </View>
              ) : (
                <View style={styles.activityActions}>
                  <PrimaryButton
                    label={selectedActivityRouteState?.routeReadiness === 'ready' ? 'Save as Route' : 'Review Route'}
                    onPress={openActivityRouteDraft}
                    disabled={loadedTrackPoints == null || loadedTrackPoints.length < 2}
                    loading={routeDraftOpening}
                    renderIcon={color => <Icon name="Route" size={IconSize.sm} color={color} strokeWidth={2} />}
                    testID="activity-save-as-route"
                  />
                  <TouchableOpacity
                    style={styles.activityDeleteAction}
                    onPress={() => setDeleteConfirm(true)}
                    accessibilityRole="button"
                    accessibilityLabel="Delete Activity"
                    testID="activity-delete-action"
                  >
                    <Icon name="Trash2" size={15} color={visualTheme.destructive} strokeWidth={2} />
                    <Text style={[styles.activityDeleteText, { color: visualTheme.destructive }]}>Delete Activity</Text>
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
              title="Delete Activity?"
              body="This removes the Activity record. Cairns, independent Routes, and Memory already earned stay in place."
              onClose={deleteSaving ? undefined : () => setDeleteConfirm(false)}
            />
            <View style={styles.deleteModalActions}>
              <PrimaryButton
                label="Delete Activity"
                variant="destructive"
                onPress={() => { void deleteSelectedActivity(); }}
                loading={deleteSaving}
                testID="activity-delete-confirm"
              />
              <PrimaryButton
                label="Keep Activity"
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
            <Text style={[styles.emptyTitle, { color: visualTheme.foreground }]}>Activity unavailable</Text>
            <Text style={[styles.emptySubtitle, { color: visualTheme.foregroundSecondary }]}>This Activity could not be found in local Activity history.</Text>
            <PrimaryButton
              label="Back to Activities"
              variant="secondary"
              onPress={returnToActivities}
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
                placeholder="Search hikes by name…"
                placeholderTextColor={Colors.textMuted}
                autoCorrect={false}
                autoCapitalize="none"
                clearButtonMode="while-editing"
                accessibilityLabel="Search hikes"
              />
              {searchQuery.length > 0 && Platform.OS !== 'ios' && (
                <TouchableOpacity
                  onPress={() => setSearchQuery('')}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  accessibilityLabel="Clear search"
                >
                  <Icon name="X" size={14} color={Colors.textMuted} strokeWidth={2.2} />
                </TouchableOpacity>
              )}
              {/* O18 HIST-02: filter toggle. Tap opens a chip bar below. */}
              <TouchableOpacity
                onPress={() => setShowFilters(v => !v)}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                accessibilityRole="button"
                accessibilityLabel="Show filters"
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
                  <Text style={styles.filterLabel}>Type</Text>
                  {(['all', 'hiking', 'running'] as const).map(t => (
                    <TouchableOpacity
                      key={t}
                      onPress={() => setTypeFilter(t)}
                      style={[styles.filterChip, typeFilter === t && styles.filterChipActive]}
                    >
                      <Text style={[styles.filterChipText, typeFilter === t && styles.filterChipTextActive]}>
                        {t === 'all' ? 'All' : t === 'hiking' ? 'Hikes' : 'Runs'}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
                {/* Period row */}
                <View style={styles.filterRow}>
                  <Text style={styles.filterLabel}>When</Text>
                  {(['all', 'week', 'month', 'year'] as const).map(p => (
                    <TouchableOpacity
                      key={p}
                      onPress={() => setPeriodFilter(p)}
                      style={[styles.filterChip, periodFilter === p && styles.filterChipActive]}
                    >
                      <Text style={[styles.filterChipText, periodFilter === p && styles.filterChipTextActive]}>
                        {p === 'all' ? 'All' : p === 'week' ? '7 days' : p === 'month' ? '30 days' : '1 year'}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
                {/* Sort row */}
                <View style={styles.filterRow}>
                  <Text style={styles.filterLabel}>Sort</Text>
                  {(['recent', 'oldest', 'longest'] as const).map(o => (
                    <TouchableOpacity
                      key={o}
                      onPress={() => setSortOrder(o)}
                      style={[styles.filterChip, sortOrder === o && styles.filterChipActive]}
                    >
                      <Text style={[styles.filterChipText, sortOrder === o && styles.filterChipTextActive]}>
                        {o === 'recent' ? 'Newest' : o === 'oldest' ? 'Oldest' : 'Longest'}
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
            <Text style={styles.emptyTitle}>Review clone unavailable</Text>
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
                  <Text style={styles.emptyTitle}>No hikes yet</Text>
                  <Text style={styles.emptySubtitle}>Start hiking or running to see your routes here</Text>
                  <PressBtn
                    style={styles.emptyCta}
                    onPress={() => nav.replace('Hiking')}
                    scaleTo={0.96}
                  >
                    <Icon name="Play" size={14} color="#fff" strokeWidth={2.5} />
                    <Text style={styles.emptyCtaText}>Start a Hike</Text>
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
                          <Text style={styles.emptyTitle}>No matches</Text>
                          <Text style={styles.emptySubtitle}>Try clearing the filters or search term.</Text>
                        </>
                      );
                    }
                    if (hasFilter) {
                      return (
                        <>
                          <Text style={styles.emptyTitle}>No hikes match your filters</Text>
                          <Text style={styles.emptySubtitle}>Try All / All to see everything.</Text>
                        </>
                      );
                    }
                    return (
                      <>
                        <Text style={styles.emptyTitle}>No matches</Text>
                        <Text style={styles.emptySubtitle}>Try a different search term.</Text>
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
                  <Text style={[cardStyles.deleteBtnText, deleteConfirm && { color: '#fff' }]}>{deleteConfirm ? 'Confirm Delete' : 'Delete Route'}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[cardStyles.deleteBtn, { flex: 1, borderColor: Colors.primary, backgroundColor: Colors.primary }]}
                  onPress={() => {
                    // Route edit lives in RouteEditorScreen (per route-rules.md §4).
                    // Concept row-02 shows an Edit Route CTA on Route Detail.
                    (nav as any).navigate('RouteEditor', { fromSessionId: selectedSession.id });
                  }}
                >
                  <Icon name="Edit3" size={IconSize.sm} color="#fff" strokeWidth={2} />
                  <Text style={[cardStyles.deleteBtnText, { color: '#fff' }]}>Edit Route</Text>
                </TouchableOpacity>
              </View>
            )}
          </ScrollView>
        ) : (
          <ScrollView showsVerticalScrollIndicator={false}>
            {markers.length === 0 ? (
              <View style={styles.emptyState}>
                <Icon name="Flag" size={40} color={Colors.textMuted} strokeWidth={1.2} />
                <Text style={styles.emptyTitle}>No cairns planted</Text>
                <Text style={styles.emptySubtitle}>Open the map to place your first flag</Text>
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
                  : `${dist.formatShort(distM)} away`;
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
      <Text style={[styles.legacyRedirectText, { color: theme.textSecondary }]}>Opening Trails…</Text>
    </View>
  );
}

export function MapHistoryScreen() {
  const route = useRoute<any>();
  const hasObjectTarget = Boolean(route.params?.sessionId || route.params?.routeId || route.params?.qaReviewClone);
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
    paddingHorizontal: Spacing.base,
    paddingTop: Spacing.lg, paddingBottom: Spacing.xs,
    gap: Spacing.sm,
  },
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
  routeActions: { gap: Spacing.sm, marginTop: Spacing.lg },
  routeOriginBlock: { gap: 3, marginBottom: Spacing.md },
  routeSyncBlock: { gap: Spacing.xs, marginBottom: Spacing.sm, alignItems: 'flex-start' },
  routeOriginText: { fontSize: FontSize.caption, lineHeight: 19, fontWeight: '600' },
  routeUpdatedText: { fontSize: FontSize.small, lineHeight: 17, marginTop: 2 },
  routeStateText: { fontSize: FontSize.small, lineHeight: 18, marginBottom: Spacing.xs },
  routeMaintenanceRow: { flexDirection: 'row', gap: Spacing.sm },
  routeMaintenanceAction: {
    flex: 1,
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    borderWidth: 1,
    borderRadius: Radius.button,
  },
  routeMaintenanceText: { fontSize: FontSize.caption, fontWeight: '700' },
  legacyRedirect: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.md },
  legacyRedirectText: { fontSize: FontSize.caption, fontWeight: '600' },
  // Concept action row: Delete (red outline pill) + Save as Route (deep
  // green pill), side-by-side, equal flex. Route Detail uses the same
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
