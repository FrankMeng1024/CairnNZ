/**
 * MapHistoryScreen — Sprint 19 track visualization + flag detail sheet
 *
 * - STORY-00043: session track polyline on map when session selected
 * - STORY-00046: flag detail bottom sheet, richer flag list items, improved empty states
 */
import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView, Alert,
  Dimensions, Animated, Easing, Platform, TextInput,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp, NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/RootNavigator';
import { useSessionStore, loadTrackPoints } from '../store/useSessionStore';
import { useTrackingStore } from '../store/useTrackingStore';
import { fetchSessionDetail } from '../services/sessionService';
import { useRouteStore } from '../store/useRouteStore';
import { useMarkerStore } from '../store/useMarkerStore';
import { crashLogger } from '../services/crashLogger';
import { getCurrentRegion } from '../config/regions';
import { getMapStyleForLayer, getPrimaryMapStyle } from '../config/mapbox';
import { useSettingsStore } from '../store/useSettingsStore';
import { formatDuration, formatDate, getRelativeTime, haversineM, kalmanInit, kalmanUpdate, simplifyPolyline } from '../utils/geo';
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

// ── Conditional Mapbox import ─────────────────────────────────────────────
// Native: render the track on top of a real Mapbox map. Web / Expo Go:
// fall back to the existing SVG-on-coloured-panel rendering.
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
      styleURL={getMapStyleForLayer(mapLayer)}
      logoEnabled={false}
      attributionEnabled={false}
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
          animationDuration={0}
        />
      )}
      {ShapeSource && LineLayer && (() => {
        // v79 fix: split by time AND distance double-check. v78 used
        // dt>30s alone which false-triggered on red lights / slow walks
        // / dynamic-sampling stationary ticks (verified on real data:
        // session 31 had 8 false-positive dashed segments, all at
        // dt=33-87s with dist 1-8m). New rule: dt > 120s AND dist > 200m
        // → only fires for genuine signal-loss like metro segments.
        // Same threshold as live HikingScreen so the user sees the same
        // shape across hike/history.
        const GAP_THRESHOLD_MS = 120_000;
        const GAP_DIST_THRESHOLD_M = 200;
        type Seg = { coords: [number, number][]; gap: boolean };
        const segs: Seg[] = [];
        if (pts.length >= 2) {
          let cur: Seg = { coords: [[pts[0].lng, pts[0].lat]], gap: false };
          for (let i = 1; i < pts.length; i++) {
            const prev = pts[i - 1];
            const p = pts[i];
            const dt = (prev.t != null && p.t != null) ? (p.t - prev.t) : 0;
            const distM = haversineM({ lat: prev.lat, lng: prev.lng }, { lat: p.lat, lng: p.lng });
            if (dt > GAP_THRESHOLD_MS && distM > GAP_DIST_THRESHOLD_M) {
              if (cur.coords.length >= 2) segs.push(cur);
              segs.push({ coords: [[prev.lng, prev.lat], [p.lng, p.lat]], gap: true });
              cur = { coords: [[p.lng, p.lat]], gap: false };
            } else {
              cur.coords.push([p.lng, p.lat]);
            }
          }
          if (cur.coords.length >= 2) segs.push(cur);
        }
        const solidFeatures = segs.filter(s => !s.gap).map((s, i) => ({
          type: 'Feature' as const,
          id: `solid-${i}`,
          geometry: { type: 'LineString' as const, coordinates: s.coords },
          properties: {},
        }));
        const gapFeatures = segs.filter(s => s.gap).map((s, i) => ({
          type: 'Feature' as const,
          id: `gap-${i}`,
          geometry: { type: 'LineString' as const, coordinates: s.coords },
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
                    lineWidth: 4,
                    lineOpacity: 0.9,
                    lineCap: 'round',
                    lineJoin: 'round',
                  }}
                />
              </ShapeSource>
            )}
            {gapFeatures.length > 0 && (
              <ShapeSource
                id="track-gap-line"
                shape={{ type: 'FeatureCollection', features: gapFeatures }}
              >
                <LineLayer
                  id="track-gap-line-layer"
                  style={{
                    lineColor: Colors.textMuted,
                    lineWidth: 3,
                    lineDasharray: [2, 1.5],
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
        <Text style={trackStyles.noGpsLabel}>{label}</Text>
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
  const isRun = session.activityMode === 'running';
  const dateStr = formatDate(session.startedAt);
  // O12: settings-aware distance format.
  const dist = useDistance();
  // Display label prefers the user-assigned name; falls back to type
  // when no name was set. Earlier versions hardcoded 'Run' / 'Hike'
  // here, dropping whatever the user typed in the stop-summary sheet.
  const actLabel = session.name || (isRun ? 'Run' : 'Hike');
  const actColor = isRun ? Colors.running : Colors.primary;
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
  const isPendingSync = session.syncState === 'pending' || session.syncState === 'syncing';

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
          onPress={async () => {
            try {
              const { drainPending } = require('../services/syncDaemon');
              await drainPending();
            } catch (e) {
              // eslint-disable-next-line no-console
              console.warn('[HIST-08] manual sync trigger failed:', e);
            }
          }}
          onLongPress={handleLongPressAbandon}
          delayLongPress={800}
          accessibilityLabel="Tap to retry sync, long-press to discard"
        >
          <View style={[cardStyles.routeCard, { opacity: 0.55 }]}>
            <LinearGradient
              colors={[actLightBg, actDeepBg]}
              start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
              style={cardStyles.routeCardGradient}
            >
              <View style={cardStyles.routeCardHeader}>
                <View style={[cardStyles.iconCircle, { backgroundColor: 'rgba(255,255,255,0.7)' }]}>
                  <Icon name={isRun ? 'Footprints' : 'Mountain'} size={20} color={actColor} strokeWidth={2} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={cardStyles.routeCardTitle} numberOfLines={1}>{actLabel}</Text>
                  <Text style={cardStyles.routeCardSubtitle}>
                    {distStr} · {durationStr}
                  </Text>
                </View>
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6 }}>
                <Icon name="CloudOff" size={12} color={Colors.textSecondary} strokeWidth={2} />
                <Text style={{ color: Colors.textSecondary, fontSize: FontSize.caption }}>
                  {session.syncState === 'syncing' ? 'Syncing…' : 'Saved offline — tap to retry sync'}
                </Text>
              </View>
            </LinearGradient>
          </View>
        </TouchableOpacity>
      ) : (
      <PressRow onPress={onPress}>
        <View style={[cardStyles.routeCard, (isSelected || isExpanded) && cardStyles.routeCardSelected]}>
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
            <View style={[cardStyles.actTypePill, { backgroundColor: actLightBg }]}>
              <Text style={[cardStyles.actTypePillText, { color: actColor }]}>{actLabel}</Text>
            </View>
            {/* Primary stat: duration */}
            <Text style={cardStyles.routePrimary}>{durationStr}</Text>
            {/* Secondary line: date · distance */}
            <Text style={cardStyles.routeMeta}>{dateStr} · {distStr}</Text>
          </View>
          <View style={cardStyles.routeChevron}>
            <Icon
              name={isExpanded ? 'ChevronDown' : 'ChevronRight'}
              size={IconSize.sm}
              color={isExpanded ? actColor : Colors.textMuted}
              strokeWidth={2.5}
            />
          </View>
        </View>
      </PressRow>
      )}
      {/* Inline expanded stats + route preview card — 只在非 pending 时渲染 */}
      {!isPendingSync && (
      <Animated.View style={[cardStyles.expandedArea, { height: expandedHeight, opacity: expandAnim }]}>
        <Animated.View style={{ opacity: statsOpacity, transform: [{ translateY: statsTransY }] }}>
        <View style={cardStyles.expandedStats}>
          <View style={[cardStyles.expandedCapsule, { borderLeftColor: Colors.primary }]}>
            <Text style={cardStyles.expandedStatVal}>{distStr}</Text>
            {distStr !== 'No GPS' && <Text style={cardStyles.expandedStatLbl}>{dist.unit}</Text>}
          </View>
          <View style={[cardStyles.expandedCapsule, { borderLeftColor: Colors.running }]}>
            <Text style={cardStyles.expandedStatVal}>{durationStr}</Text>
            <Text style={cardStyles.expandedStatLbl}>time</Text>
          </View>
          <View style={[cardStyles.expandedCapsule, { borderLeftColor: Colors.severityCaution }]}>
            <Text style={cardStyles.expandedStatVal}>+{dist.formatElevation(session.elevationGainM ?? 0)}{dist.elevUnit}</Text>
            <Text style={cardStyles.expandedStatLbl}>elev</Text>
          </View>
          <View style={[cardStyles.expandedCapsule, { borderLeftColor: Colors.flag }]}>
            <Text style={cardStyles.expandedStatVal}>{session.markerIds?.length ?? 0}</Text>
            <Text style={cardStyles.expandedStatLbl}>flags</Text>
          </View>
        </View>
        </Animated.View>

        {/* Route preview card (STORY-00103 + STORY-00108) */}
        <Animated.View style={{ opacity: previewOpacity, transform: [{ translateY: previewTransY }] }}>
        <View style={cardStyles.routePreviewCard}>
          {/* Topo background — contour rings */}
          <View style={cardStyles.topoRingOuter} />
          <View style={cardStyles.topoRingMid} />
          <View style={cardStyles.topoRingInner} />
          {/* Stat chips overlaid */}
          <View style={cardStyles.previewChipsRow}>
            <View style={cardStyles.previewChip}>
              <Icon name="MapPin" size={10} color={actColor} strokeWidth={2.5} />
              <Text style={[cardStyles.previewChipText, { color: actColor }]}>{distStr}</Text>
            </View>
            <View style={cardStyles.previewChip}>
              <Icon name="Timer" size={10} color={actColor} strokeWidth={2.5} />
              <Text style={[cardStyles.previewChipText, { color: actColor }]}>{durationStr}</Text>
            </View>
          </View>
          {/* Route label — STORY-00108: renamed from "Route Preview" */}
          <Text style={cardStyles.previewLabel}>Preview</Text>
        </View>
        </Animated.View>

        <Animated.View style={{ opacity: ctaOpacity, transform: [{ translateY: ctaTransY }] }}>
        <TouchableOpacity style={cardStyles.viewOnMapBtn} onPress={onViewOnMap}>
          <Icon name="Map" size={14} color="#fff" strokeWidth={2} />
          <Text style={cardStyles.viewOnMapText}>View on Map</Text>
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
      <Animated.View style={[sheetStyles.scrim, { opacity: scrimOpacity }]}>
        <TouchableOpacity style={StyleSheet.absoluteFillObject} activeOpacity={1} onPress={close} />
      </Animated.View>
      <Animated.View style={[sheetStyles.sheet, { transform: [{ translateY: slideY }] }]}>
        {/* Drag handle */}
        <View style={sheetStyles.handle} />
        {/* Type badge */}
        <View style={[sheetStyles.typeBadge, { backgroundColor: meta.bg, borderColor: meta.color }]}>
          <Icon name={meta.iconName as IconName} size={20} color={meta.color} strokeWidth={2} />
          <Text style={[sheetStyles.typeBadgeText, { color: meta.color }]}>{meta.label}</Text>
        </View>
        {/* Note */}
        <Text style={sheetStyles.noteLabel}>Note</Text>
        <Text style={sheetStyles.noteText} numberOfLines={4}>{marker.note || 'No note yet'}</Text>
        {/* Date */}
        <Text style={sheetStyles.dateLine}>Planted: {dateStr}</Text>
        {/* Delete */}
        <TouchableOpacity
          style={[sheetStyles.deleteBtn, deleteConfirm && { backgroundColor: Colors.danger }]}
          onPress={handleDelete}
        >
          <Icon name="Trash2" size={IconSize.sm} color={deleteConfirm ? '#fff' : Colors.danger} strokeWidth={2} />
          <Text style={[sheetStyles.deleteBtnText, deleteConfirm && { color: '#fff' }]}>{deleteConfirm ? 'Confirm Delete' : 'Delete Cairn'}</Text>
        </TouchableOpacity>
      </Animated.View>
    </>
  );
}

// ── Main ────────────────────────────────────────────────────────────────────
export function MapHistoryScreen() {
  const nav = useNavigation<Nav>();
  const route = useRoute<any>();
  const targetSessionId = route.params?.sessionId as string | undefined;
  // O12: settings-aware distance format for detail modal + stat displays.
  const dist = useDistance();
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
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

  const region = getCurrentRegion();
  const allSessions = useSessionStore(s => s.sessions);
  // If a specific sessionId was passed, only show that one
  const sessions = targetSessionId
    ? allSessions.filter(s => s.id === targetSessionId)
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

  // Auto-select the target session or first session on mount
  useEffect(() => {
    if (targetSessionId) {
      setSelectedSessionId(targetSessionId);
      setExpandedSessionId(targetSessionId);
    } else if (sessions.length > 0) {
      setSelectedSessionId(sessions[0].id);
      setExpandedSessionId(sessions[0].id);
    } else {
      setSelectedSessionId(null);
      setExpandedSessionId(null);
    }
  }, []);
  const deleteSession = useSessionStore(s => s.deleteSession);
  // O18 HIST-03: rename hike from the detail panel.
  const renameSession = useSessionStore(s => s.renameSession);
  const [renameEditing, setRenameEditing] = useState(false);
  const [renameText, setRenameText] = useState('');
  const allMarkers = useMarkerStore(s => s.markers);
  const markers = allMarkers.filter(m => m.regionCode === region.code);
  const deleteMarker = useMarkerStore(s => s.deleteMarker);
  // v74a: live GPS for "distance from current position" in flag list rows.
  // Updates reactively as the user moves (Zustand subscription).
  const lastCoord = useTrackingStore(s => s.lastCoordinate);
  const [deleteConfirm, setDeleteConfirm] = useState(false);

  const selectedSession = sessions.find(s => s.id === selectedSessionId) ?? null;
  const selectedMarker = markers.find(m => m.id === selectedMarkerId) ?? null;

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
    if (!selectedSessionId) { setLoadedTrackPoints(null); return; }
    let cancelled = false;
    // O6 (2026-07-26): 添加 15s 超时。之前 fetchSessionDetail 无超时,
    // 若网络卡住 (server slow / 用户切飞行模式 mid-fetch) 就永远
    // stuck 在 loadedTrackPoints=null 状态,TrackPolyline 显示
    // "Loading route…" 转圈永远不停。这是 Bug 5 根因。超时后 fall
    // through 到 local cache;如果 local 也空则显示 "Route data unavailable"。
    const timeoutMs = 15000;
    let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
    (async () => {
      const session = sessions.find(s => s.id === selectedSessionId);
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
          }));
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
      if (!cancelled) setLoadedTrackPoints(local ?? []);
    })().catch(() => { if (!cancelled) setLoadedTrackPoints([]); });
    return () => {
      cancelled = true;
      if (timeoutHandle) { clearTimeout(timeoutHandle); timeoutHandle = null; }
    };
  }, [selectedSessionId, sessions]);

  // Merge loaded track points into the selected session for display.
  // v261: when loadedTrackPoints === null we are still loading; pass [] so
  // existing length-checks stay safe, but track the loading flag separately.
  const isLoadingTrackPoints = loadedTrackPoints === null;
  const sessionForDisplay = selectedSession
    ? { ...selectedSession, trackPoints: loadedTrackPoints ?? [] }
    : null;

  // v75: full GPS quality pipeline applied at render time so historical
  // hikes (recorded before v74a's live filters existed) get the same
  // treatment as live tracking. The pipeline is identical to live but
  // re-implemented here because:
  //   - server only stores raw points (never filters)
  //   - client live filters only run during recording, not render
  //
  // Pipeline:
  //   1. Drop accuracy > 25m fixes (urban canyon / indoor noise)
  //   2. Drop teleports (>15 m/s & >30m vs last accepted = GPS glitch)
  //   3. Stationary collapse (recent avg <0.5 m/s and within max(acc, 8m)
  //      of last accepted → suppress, no new vertex)
  //   4. Kalman 1D smoothing per channel, Q=1e-9 (low → trust prior →
  //      visibly smooth output)
  //
  // Distance shown to user is the SERVER-STORED `distance_m` (computed
  // on raw GPS during recording — accurate). Polyline RENDER uses
  // smoothed. Same split as Strava.
  const smoothedTrackPoints = React.useMemo(() => {
    if (!sessionForDisplay || sessionForDisplay.trackPoints.length === 0) return [];
    const KALMAN_PROCESS_NOISE = 1e-9;
    const ACCURACY_REJECT_M = 25;
    const TELEPORT_SPEED_MPS = 15;
    const TELEPORT_DIST_MIN_M = 30;
    const STATIONARY_SPEED_MPS = 0.5;
    const STATIONARY_RADIUS_MIN_M = 8;
    type P = typeof sessionForDisplay.trackPoints[number];
    const pts = sessionForDisplay.trackPoints;
    const kept: P[] = [];

    // Filters 1, 2, 3 in one pass
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      // Filter 1: accuracy reject
      if (p.accuracy != null && p.accuracy > ACCURACY_REJECT_M) continue;

      if (kept.length > 0) {
        const last = kept[kept.length - 1];
        const distM = haversineM({ lat: last.lat, lng: last.lng }, { lat: p.lat, lng: p.lng });
        const dtS = (p.t - last.t) / 1000;

        // Filter 2: teleport reject
        if (dtS > 0) {
          const speed = distM / dtS;
          if (speed > TELEPORT_SPEED_MPS && distM > TELEPORT_DIST_MIN_M) continue;
        }

        // Filter 3: stationary collapse — rolling 5-point speed.
        // v75 BUGFIX: only apply when we have ≥3 accepted points so
        // the speed calc has enough data. Otherwise the very first
        // fixes get suppressed (avgSpeed=0 on empty window matches
        // the stationary condition).
        if (kept.length >= 3) {
          const window = kept.slice(-5);
          if (window.length >= 2) {
            const winDt = (window[window.length - 1].t - window[0].t) / 1000;
            let winDist = 0;
            for (let j = 1; j < window.length; j++) {
              winDist += haversineM(
                { lat: window[j - 1].lat, lng: window[j - 1].lng },
                { lat: window[j].lat, lng: window[j].lng },
              );
            }
            const winSpeed = winDt > 0 ? winDist / winDt : 0;
            const suppressRadius = Math.max(STATIONARY_RADIUS_MIN_M, p.accuracy ?? 0);
            if (winSpeed < STATIONARY_SPEED_MPS && distM <= suppressRadius) continue;
          }
        }
      }
      kept.push(p);
    }

    // Filter 4: Kalman smoothing pass over the survivors. Q hard-coded
    // to 1e-9 here because kalmanInit uses 1e-5 by default (geo.ts:159)
    // — see plan. Override per call.
    const out: P[] = [];
    let kLat: ReturnType<typeof kalmanInit> | null = null;
    let kLng: ReturnType<typeof kalmanInit> | null = null;
    for (const p of kept) {
      const acc = p.accuracy ?? 10;
      if (kLat === null || kLng === null) {
        kLat = kalmanInit(p.lat, acc, KALMAN_PROCESS_NOISE);
        kLng = kalmanInit(p.lng, acc, KALMAN_PROCESS_NOISE);
        out.push(p);
      } else {
        const sLat = kalmanUpdate(kLat, p.lat, acc);
        const sLng = kalmanUpdate(kLng, p.lng, acc);
        out.push({ ...p, lat: sLat, lng: sLng });
      }
    }
    // v118: Douglas-Peucker simplify removed (was reducing vertices ~30%).
    // User reported the live hike polyline looked smoother than the activity
    // view of the same hike. Both should be visually identical. HikingScreen
    // renders trackPointsSmoothed live (Kalman only); we now do the same here
    // (Kalman + filters above, but no DP simplify). Slightly more vertices
    // on long hikes but typical NZ trail is < 2000 points — Mapbox handles
    // it without effort.
    return out;
  }, [sessionForDisplay?.trackPoints]);

  // Replace raw with smoothed in sessionForDisplay so all downstream
  // renderers (NativeTrackMap, TrackPolyline, marker bbox) read smoothed.
  const sessionRender = sessionForDisplay
    ? { ...sessionForDisplay, trackPoints: smoothedTrackPoints }
    : null;

  // v73: nearby-flag filter — only show personal markers within ~80m
  // of any point on the route polyline. v74a: widened from 50m to 80m
  // because v72 hit-test plants 5-15m from user + GPS noise + offset
  // from actual trail can push markers outside a 50m envelope.
  const NEARBY_FLAG_RADIUS_M = 80;
  const routeFlags: Marker[] = (() => {
    if (!sessionForDisplay || sessionForDisplay.trackPoints.length === 0) return [];
    return markers.filter(m => {
      // Cheap bounding-box reject before haversine to keep this fast on
      // long hikes with many flags. ~0.001° lat/lng ≈ 100m at NZ
      // latitudes, well above the 50m threshold.
      return sessionForDisplay.trackPoints.some(p => {
        if (Math.abs(p.lat - m.lat) > 0.001) return false;
        if (Math.abs(p.lng - m.lng) > 0.001) return false;
        return haversineM({ lat: p.lat, lng: p.lng }, { lat: m.lat, lng: m.lng }) <= NEARBY_FLAG_RADIUS_M;
      });
    });
  })();

  // Show real markers on map. v73: when a session is selected, restrict
  // to flags planted along that route (within 50m of any track point);
  // when nothing is selected, show up to 8 generic recent markers.
  const mapMarkers: Marker[] = sessionForDisplay
    ? routeFlags
    : markers.slice(0, 8);

  return (
    <View style={styles.container}>
      {/* Map area */}
      <View style={styles.mapArea}>
        {/* Track polyline when session selected. Native (iOS/Android with
            @rnmapbox/maps available) renders the track on a real Mapbox
            map; web/Expo Go falls back to the SVG-on-panel rendering. */}
        {sessionRender ? (
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
          // Decorative lines when no session selected
          <>
            <View style={styles.routeLine1} />
            <View style={styles.routeLine2} />
            <View style={styles.routeLine3} />
          </>
        )}

        {/* Map placeholder label */}
        {!selectedSession && (
          <View style={styles.mapLabelWrap}>
            <Icon name="Map" size={32} color={Colors.primary} strokeWidth={1.3} />
            <Text style={styles.mapLabel}>History</Text>
            <Text style={styles.mapSubLabel}>Select a route below to view</Text>
          </View>
        )}

        {/* Selected session stat bar on map */}
        {selectedSession && (
          <View style={styles.trackStatBar}>
            <View style={[styles.trackStat, { borderLeftWidth: 2, borderLeftColor: Colors.running }]}>
              <Text style={styles.trackStatValue}>
                {selectedSession.distanceM < 10 ? '0' : dist.format(selectedSession.distanceM, 2)}
              </Text>
              <Text style={styles.trackStatUnit}>{dist.unit}</Text>
            </View>
            <View style={styles.trackStatDivider} />
            <View style={[styles.trackStat, { borderLeftWidth: 2, borderLeftColor: Colors.primary }]}>
              <Text style={styles.trackStatValue}>{formatDuration(selectedSession.durationS)}</Text>
              <Text style={styles.trackStatUnit}>time</Text>
            </View>
            <View style={styles.trackStatDivider} />
            <View style={[styles.trackStat, { borderLeftWidth: 2, borderLeftColor: Colors.flag }]}>
              <Text style={styles.trackStatValue}>{selectedSession.markerIds.length}</Text>
              <Text style={styles.trackStatUnit}>flags</Text>
            </View>
            <View style={styles.trackStatDivider} />
            <View style={[styles.trackStat, { borderLeftWidth: 2, borderLeftColor: Colors.textMuted }]}>
              <Text style={styles.trackStatValue}>+{dist.formatElevation(selectedSession.elevationGainM ?? 0)}{dist.elevUnit}</Text>
              <Text style={styles.trackStatUnit}>elev</Text>
            </View>
          </View>
        )}

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
          <BackButton variant="pill" />
          <Text style={styles.topTitle}>{targetSessionId ? 'Activity Detail' : 'History'}</Text>
          {/* O17 COPY:C-70: Plan Route button was a stub — hidden in prod, dev-only preview */}
          {/* O18 VER-07: always render a right-side spacer matching the
              BackButton pill width so the centered title stays visually
              centered whether Plan is shown or not. */}
          {!targetSessionId && __DEV__ ? (
            <TouchableOpacity
              style={styles.planBtn}
              onPress={() => Alert.alert('Plan Route', 'Route planning coming soon')}
              accessibilityLabel="Plan a new route (dev preview)"
            >
              <Icon name="Route" size={14} color="#fff" strokeWidth={2} />
              <Text style={styles.planBtnText}>Plan</Text>
            </TouchableOpacity>
          ) : (
            <View style={{ width: 68 }} />
          )}
        </View>

        {/* Tab bar — only show when viewing all sessions */}
        {!targetSessionId && (
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
      {targetSessionId && selectedSession ? (
        <View style={styles.singleSessionPanel}>
          {/* O18 HIST-03: hike name + rename affordance. Tap the title to edit. */}
          <View style={{ marginBottom: Spacing.sm }}>
            {renameEditing ? (
              <View style={{ flexDirection: 'row', gap: Spacing.sm, alignItems: 'center' }}>
                <TextInput
                  style={styles.renameInput}
                  value={renameText}
                  onChangeText={setRenameText}
                  autoFocus
                  maxLength={60}
                  onSubmitEditing={() => {
                    const t = renameText.trim();
                    if (t) renameSession(selectedSession.id, t);
                    setRenameEditing(false);
                  }}
                  returnKeyType="done"
                  placeholder="Hike name"
                  placeholderTextColor={Colors.textMuted}
                />
                <TouchableOpacity
                  onPress={() => {
                    const t = renameText.trim();
                    if (t) renameSession(selectedSession.id, t);
                    setRenameEditing(false);
                  }}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  accessibilityLabel="Save new name"
                >
                  <Icon name="Check" size={20} color={Colors.primary} strokeWidth={2.5} />
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => setRenameEditing(false)}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  accessibilityLabel="Cancel rename"
                >
                  <Icon name="X" size={20} color={Colors.textMuted} strokeWidth={2.5} />
                </TouchableOpacity>
              </View>
            ) : (
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <TouchableOpacity
                  style={{ flex: 1 }}
                  onPress={() => {
                    setRenameText(selectedSession.name || (selectedSession.activityMode === 'running' ? 'Run' : 'Hike'));
                    setRenameEditing(true);
                  }}
                  accessibilityRole="button"
                  accessibilityLabel="Rename hike"
                  accessibilityHint="Double tap to edit the hike name"
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Text style={styles.sessionTitle} numberOfLines={1}>
                      {selectedSession.name || (selectedSession.activityMode === 'running' ? 'Run' : 'Hike')}
                    </Text>
                    <Icon name="Pencil" size={14} color={Colors.textMuted} strokeWidth={2} />
                  </View>
                </TouchableOpacity>
                {/* O18 SHR-01: text-based share for a hike. Bundles the name +
                    core stats + a cairnapp.nz link into the system share sheet.
                    Image capture (react-native-view-shot) is installed and
                    will be wired in a follow-up sprint after the EAS build
                    picks up the native module. */}
                <TouchableOpacity
                  onPress={async () => {
                    try {
                      const { default: Sharing } = await import('expo-sharing');
                      const isAvailable = await Sharing.isAvailableAsync();
                      const dateStr = new Date(selectedSession.startedAt).toLocaleDateString();
                      const kmOrMi = dist.imperial ? 'mi' : 'km';
                      const distValue = dist.imperial
                        ? (selectedSession.distanceM / 1609.344).toFixed(2)
                        : (selectedSession.distanceM / 1000).toFixed(2);
                      const durationH = Math.floor(selectedSession.durationS / 3600);
                      const durationM = Math.floor((selectedSession.durationS % 3600) / 60);
                      const durationStr = durationH > 0 ? `${durationH}h ${durationM}m` : `${durationM}m`;
                      const activityLabel = selectedSession.activityMode === 'running' ? 'run' : 'hike';
                      const message = `I went for a ${activityLabel} on ${dateStr}: ${distValue} ${kmOrMi} in ${durationStr}. Tracked with Cairn — cairnapp.nz`;
                      if (isAvailable) {
                        // expo-sharing is meant for files. For text-only share
                        // fall back to Share.share (react-native built-in).
                        // eslint-disable-next-line @typescript-eslint/no-require-imports
                        const { Share } = require('react-native');
                        await Share.share({ message, title: 'Cairn hike' });
                      } else {
                        // eslint-disable-next-line @typescript-eslint/no-require-imports
                        const { Share } = require('react-native');
                        await Share.share({ message, title: 'Cairn hike' });
                      }
                    } catch (e) {
                      // eslint-disable-next-line no-console
                      console.warn('[SHR-01] share failed:', e);
                    }
                  }}
                  accessibilityRole="button"
                  accessibilityLabel="Share this hike"
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  style={{ marginLeft: Spacing.sm }}
                >
                  <Icon name="Send" size={18} color={Colors.primary} strokeWidth={2} />
                </TouchableOpacity>
              </View>
            )}
          </View>
          <View style={styles.singleSessionStats}>
            <View style={styles.singleStat}>
              <Text style={styles.singleStatValue}>{dist.format(selectedSession.distanceM, 1)}</Text>
              <Text style={styles.singleStatLabel}>{dist.unit}</Text>
            </View>
            <View style={styles.singleStat}>
              <Text style={styles.singleStatValue}>{formatDuration(selectedSession.durationS)}</Text>
              <Text style={styles.singleStatLabel}>time</Text>
            </View>
            <View style={styles.singleStat}>
              <Text style={styles.singleStatValue}>+{dist.formatElevation(selectedSession.elevationGainM ?? 0)}{dist.elevUnit}</Text>
              <Text style={styles.singleStatLabel}>elev</Text>
            </View>
          </View>
          <View style={{ flexDirection: 'row', gap: Spacing.sm }}>
            {/* v119: Save as Route on the LEFT, Delete on the RIGHT.
                Equal sizes (flex: 1 each).
                v120: disable check uses loadedTrackPoints (the array
                hydrated from the server in the effect at line ~650),
                NOT selectedSession.trackPoints which is always [] for
                sessions hydrated from the backend (the local
                sessionStore summary doesn't carry track points). This
                was the "Save as Route always grey" bug. */}
            <TouchableOpacity
              style={[
                cardStyles.deleteBtn,
                { flex: 1, borderColor: Colors.primary, backgroundColor: Colors.primaryBg },
                loadedTrackPoints == null || loadedTrackPoints.length < 2 ? { opacity: 0.4 } : undefined,
              ]}
              disabled={loadedTrackPoints == null || loadedTrackPoints.length < 2}
              onPress={() => {
                // v198 Bug 1+2 fix: open RouteEditorScreen in save-as-route
                // draft mode (fromSessionId) instead of persisting directly.
                // The user wants to edit the name + see the route polyline
                // BEFORE saving — previous direct-addRoute path lost the
                // name (forced to activity.name) and dropped them into a
                // view-mode showing stats=0 because waypoints array is
                // empty (geometry lives in route.points which view-mode
                // doesn't read for the waypoint counter).
                //
                // RouteEditorScreen with fromSessionId:
                //   - opens in editMode=true (drafting mode, not view-mode)
                //   - hydrates sessionTrackPoints from snapToRoadAndTrim
                //   - pre-fills name with `Hike Jun 9` / `Run Jun 9` style
                //   - camera now fits to the session polyline (v198 bug 3+4)
                //   - main button is Save (handleSave); user can edit name
                const ts = selectedSession;
                crashLogger.breadcrumb(`saveroute:nav-to-editor session=${ts.id}`);
                (nav as any).navigate('RouteEditor', {
                  fromSessionId: ts.id,
                  // v198 fix-2: pass already-server-hydrated trackPoints
                  // so RouteEditor doesn't fall back to the unreliable
                  // local-AsyncStorage loadTrackPoints (which returns []
                  // for any server-synced session — fresh OTA installs
                  // and multi-device users would be unable to save).
                  // MapHistoryScreen has the authoritative server-fetched
                  // trace already loaded for the polyline render.
                  fromSessionTrackPoints: (loadedTrackPoints ?? []).map(p => ({
                    lat: p.lat,
                    lng: p.lng,
                    alt: p.alt ?? null,
                    t: p.t,
                    accuracy: (p as any).accuracy ?? null,
                  })),
                });
              }}
            >
              <Icon name="Route" size={IconSize.sm} color={Colors.primary} strokeWidth={2} />
              <Text style={[cardStyles.deleteBtnText, { color: Colors.primary }]}>Save as Route</Text>
            </TouchableOpacity>
            {/* v118: Edit button removed entirely. Per route-rules.md §4 the
                edit engine (1km node corridor + dual-line UI) lives on Route
                Detail, not Activity. Activity is the immutable raw GPS record.
                Editing here had no meaningful semantics so it's gone. */}
            <TouchableOpacity
              style={[cardStyles.deleteBtn, { flex: 1 }, deleteConfirm && { backgroundColor: Colors.danger }]}
              onPress={() => {
                if (!deleteConfirm) { setDeleteConfirm(true); return; }
                deleteSession(selectedSession.id);
                nav.goBack();
              }}
            >
              <Icon name="Trash2" size={IconSize.sm} color={deleteConfirm ? '#fff' : Colors.danger} strokeWidth={2} />
              <Text style={[cardStyles.deleteBtnText, deleteConfirm && { color: '#fff' }]}>{deleteConfirm ? 'Confirm Delete' : 'Delete'}</Text>
            </TouchableOpacity>
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

        {tab === 'routes' ? (
          <ScrollView showsVerticalScrollIndicator={false}>
            {filteredSessions.length === 0 ? (
              sessions.length === 0 ? (
                <View style={styles.emptyState}>
                  <Icon name="Route" size={40} color={Colors.textMuted} strokeWidth={1.2} />
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
                  <Text style={styles.emptyTitle}>No matches</Text>
                  <Text style={styles.emptySubtitle}>Try a different search term.</Text>
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
              <TouchableOpacity
                style={[cardStyles.deleteBtn, deleteConfirm && { backgroundColor: Colors.danger }]}
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

// ── Styles ──────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.mapBg },

  mapArea: { flex: 1, backgroundColor: Colors.mapBg, position: 'relative', overflow: 'hidden' },
  routeLine1: {
    position: 'absolute', top: 160, left: 40, width: W - 80,
    height: 3, backgroundColor: Colors.primary + '70', borderRadius: 2,
  },
  routeLine2: {
    position: 'absolute', top: 200, left: 40, width: W * 0.6,
    height: 3, backgroundColor: Colors.running + '70', borderRadius: 2,
  },
  routeLine3: {
    position: 'absolute', top: 180, right: 40, width: W * 0.4,
    height: 3, backgroundColor: Colors.trail + '70', borderRadius: 2,
  },
  mapLabelWrap: {
    position: 'absolute', alignItems: 'center',
    top: '38%', left: 0, right: 0, gap: 6,
  },
  mapLabel: { fontSize: FontSize.h3, fontWeight: '600', color: Colors.primary, opacity: 0.7 },
  mapSubLabel: { fontSize: FontSize.small, color: Colors.textMuted, opacity: 0.8 },
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
  singleSessionStats: {
    flexDirection: 'row', justifyContent: 'space-around', marginBottom: Spacing.lg,
  },
  singleStat: { alignItems: 'center', gap: 4 },
  singleStatValue: { fontSize: FontSize.h2, fontWeight: '700', color: Colors.textPrimary },
  singleStatLabel: { fontSize: FontSize.small, color: Colors.textSecondary },

  listPanel: {
    backgroundColor: 'rgba(255,255,255,0.90)',
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
  emptyTitle: { fontSize: FontSize.body, fontWeight: '700', color: Colors.textSecondary },
  emptySubtitle: { fontSize: FontSize.small, color: Colors.textMuted, textAlign: 'center', maxWidth: 260 },
  emptyCta: {
    flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: Spacing.sm,
    backgroundColor: Colors.primary, borderRadius: Radius.button ?? 12,
    paddingHorizontal: Spacing.lg, paddingVertical: 10,
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
  noteLabel: { fontSize: FontSize.small, fontWeight: '700', color: Colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.8 },
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
