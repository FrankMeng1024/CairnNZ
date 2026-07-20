/**
 * RoutesScreen — Three-tab layout: Routes | Activities | Flags
 */
import React, { useState, useRef, useEffect, useMemo } from 'react';
import {
  View, Text, StyleSheet, FlatList, ScrollView, TouchableOpacity, Alert, TextInput,
  KeyboardAvoidingView, Platform, Animated, Easing,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/RootNavigator';
import { useRouteStore } from '../store/useRouteStore';
import { useSessionStore } from '../store/useSessionStore';
import { useMarkerStore, type Marker, type MarkerPermission } from '../store/useMarkerStore';
import { useTrackingStore } from '../store/useTrackingStore';
import { Colors, Spacing, Radius, FontSize, Shadow, IconSize } from '../components/tokens';
import { getPrimaryMapStyle } from '../config/mapbox';
import { Icon, type IconName } from '../components/Icon';
import { HikingIcon, RunningIcon } from '../components/ActivityIcons';
import { BackButton } from '../components/BackButton';
import { PressBtn } from '../components/PressBtn';
import { formatDistance, formatDuration, haversineM } from '../utils/geo';
import { MARKER_META, type MarkerType } from '../data/mockData';
import { shareGPX, sharePDF } from '../services/exportService'; // kept for future Export action
import { EmptyRoutes, EmptyMarkers, IllustrationHalo } from '../components/Illustrations';

// ── Mapbox conditional import (for RouteSheet preview) ────────────────────
// Native-only — on web fallback to a static placeholder.
let MapView: any = null;
let CameraComponent: any = null;
let LineLayer: any = null;
let ShapeSource: any = null;
if (Platform.OS !== 'web') {
  try {
    const Mapbox = require('@rnmapbox/maps');
    MapView = Mapbox.MapView;
    CameraComponent = Mapbox.Camera;
    LineLayer = Mapbox.LineLayer;
    ShapeSource = Mapbox.ShapeSource;
  } catch {
    // @rnmapbox/maps not installed in this build (Expo Go) — fallback used.
  }
}

type Nav = NativeStackNavigationProp<RootStackParamList>;
type Tab = 'routes' | 'activities' | 'flags';

const FLAG_FILTERS: { id: MarkerType | 'all'; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'danger', label: 'Danger' },
  { id: 'cairn', label: 'Cairn' },
  { id: 'water', label: 'Water' },
  { id: 'junction', label: 'Junction' },
];

const FLAG_TYPES: { id: MarkerType; icon: IconName; label: string; color: string; bg: string }[] = [
  { id: 'danger',   icon: 'TriangleAlert', label: 'Danger',   color: Colors.danger,    bg: Colors.dangerBg  },
  { id: 'cairn',    icon: 'Mountain',      label: 'Cairn',    color: Colors.trail,     bg: 'rgba(181,130,61,0.10)' },
  { id: 'water',    icon: 'Droplets',      label: 'Water',    color: Colors.success,   bg: Colors.successBg },
  { id: 'junction', icon: 'Navigation2',   label: 'Junction', color: Colors.docOrange, bg: Colors.severityWarningBg },
];

// ── Segment Control ──────────────────────────────────────────────────────────
function SegmentControl({ active, onChange }: { active: Tab; onChange: (t: Tab) => void }) {
  // v119: tab order: Activities first (the source of truth — every walked
  // session lives here), then Routes (curated, derived from Activities),
  // then Flags (place markers). This matches user mental model: "I want
  // to see what I did" → Activities; "I want to plan/redo a route" → Routes.
  const tabs: { id: Tab; label: string }[] = [
    { id: 'activities', label: 'Activities' },
    { id: 'routes', label: 'Routes' },
    { id: 'flags', label: 'Flags' },
  ];
  return (
    <View style={segStyles.container}>
      {tabs.map(t => (
        <TouchableOpacity key={t.id} style={[segStyles.tab, active === t.id && segStyles.tabActive]} onPress={() => onChange(t.id)} activeOpacity={0.8}>
          <Text style={[segStyles.tabText, active === t.id && segStyles.tabTextActive]}>{t.label}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

// Sprint 69 STORY-00537 + STORY-00538: scope sub-tab used inside Flags
// and Routes tabs (NOT Activities — v4 §10 binding). Small inline component
// since the styling is bespoke (lighter than the main SegmentControl).
function ScopeTabBar({
  scope,
  onChange,
}: {
  scope: 'mine' | 'friends';
  onChange: (s: 'mine' | 'friends') => void;
}) {
  const SCOPES: { id: 'mine' | 'friends'; label: string }[] = [
    { id: 'mine', label: 'Mine' },
    { id: 'friends', label: 'Friends' },
  ];
  return (
    <View style={scopeStyles.row} testID="scope-tab-bar">
      {SCOPES.map(s => (
        <TouchableOpacity
          key={s.id}
          style={[scopeStyles.btn, scope === s.id && scopeStyles.btnActive]}
          onPress={() => onChange(s.id)}
          activeOpacity={0.7}
          testID={`scope-${s.id}`}
        >
          <Text style={[scopeStyles.text, scope === s.id && scopeStyles.textActive]}>{s.label}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

const scopeStyles = StyleSheet.create({
  // UX-Med-5 fix (post-review UX round 2): scope sub-tab visual weight
  // was too low — pills were small + left-aligned, floating in empty
  // space. Now: centered row, bigger padding, body-size text, contained
  // in a soft pill-shaped container ("segmented control" pattern users
  // recognize from iOS). Sits clearly under the top tab bar as a scope
  // switch rather than an orphaned filter chip.
  row: {
    flexDirection: 'row',
    justifyContent: 'center',
    paddingHorizontal: Spacing.base,
    paddingTop: Spacing.sm,
    paddingBottom: Spacing.xs,
  },
  btn: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: 8,
    backgroundColor: 'transparent',
    borderRadius: 0,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
    minWidth: 88,
    alignItems: 'center',
  },
  btnActive: {
    borderBottomColor: Colors.primary,
  },
  text: {
    fontSize: FontSize.body,
    color: Colors.textSecondary,
    fontWeight: '500',
  },
  textActive: {
    color: Colors.primary,
    fontWeight: '700',
  },
});

// ── Empty State ──────────────────────────────────────────────────────────────
function EmptyState({ icon, title, hint, illustration }: { icon: IconName; title: string; hint: string; illustration?: React.ReactNode }) {
  return (
    <View style={styles.empty}>
      {illustration ? (
        <View style={{ marginBottom: Spacing.md }}>{illustration}</View>
      ) : (
        <View style={styles.emptyIconWrap}>
          <Icon name={icon} size={36} color={Colors.textMuted} strokeWidth={1.5} />
        </View>
      )}
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyHint}>{hint}</Text>
    </View>
  );
}

// ── FilterSortBar ─────────────────────────────────────────────────────────
// Shared header for the three tabs: a single-axis filter chip row +
// a sort-direction chip on the right. Each tab passes its own filters
// and sort options. Pure UI — no data shaping happens here, just
// state callbacks.
function FilterSortBar<F extends string, S extends string>({
  filters,
  filterValue,
  onFilterChange,
  sorts,
  sortValue,
  onSortChange,
}: {
  filters: { id: F; label: string }[];
  filterValue: F;
  onFilterChange: (id: F) => void;
  sorts: { id: S; label: string }[];
  sortValue: S;
  onSortChange: (id: S) => void;
}) {
  return (
    <View style={filterBarStyles.row}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={filterBarStyles.filtersScroll}
      >
        {filters.map(f => (
          <TouchableOpacity
            key={f.id}
            style={[filterBarStyles.chip, filterValue === f.id && filterBarStyles.chipActive]}
            onPress={() => onFilterChange(f.id)}
            activeOpacity={0.7}
          >
            <Text style={[filterBarStyles.chipText, filterValue === f.id && filterBarStyles.chipTextActive]}>
              {f.label}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
      <TouchableOpacity
        style={filterBarStyles.sortChip}
        onPress={() => {
          // cycle to next sort option
          const idx = sorts.findIndex(s => s.id === sortValue);
          const next = sorts[(idx + 1) % sorts.length];
          onSortChange(next.id);
        }}
        activeOpacity={0.7}
      >
        <Icon name="ArrowUpDown" size={12} color={Colors.primary} strokeWidth={2} />
        <Text style={filterBarStyles.sortText}>{sorts.find(s => s.id === sortValue)?.label}</Text>
      </TouchableOpacity>
    </View>
  );
}

// ── RouteSheet ────────────────────────────────────────────────────────────────
// ── Route map preview (renders polyline of route.points) ───────────────────
function RouteMapPreview({ points }: { points: { lat: number; lng: number }[] }) {
  // Compute bounds for camera fit
  const bounds = useMemo(() => {
    if (!points || points.length < 2) return null;
    let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
    for (const p of points) {
      if (p.lat < minLat) minLat = p.lat;
      if (p.lat > maxLat) maxLat = p.lat;
      if (p.lng < minLng) minLng = p.lng;
      if (p.lng > maxLng) maxLng = p.lng;
    }
    return { ne: [maxLng, maxLat] as [number, number], sw: [minLng, minLat] as [number, number] };
  }, [points]);

  const lineGeoJson = useMemo(() => ({
    type: 'Feature' as const,
    geometry: {
      type: 'LineString' as const,
      coordinates: points.map((p) => [p.lng, p.lat]),
    },
    properties: {},
  }), [points]);

  if (!MapView || !points || points.length < 2 || !bounds) {
    // Fallback when Mapbox unavailable or route has too few points
    return (
      <View style={routePreviewStyles.fallback}>
        <Icon name="Map" size={28} color={Colors.primaryMuted} />
        <Text style={routePreviewStyles.fallbackText}>Route preview</Text>
      </View>
    );
  }

  return (
    <View style={routePreviewStyles.mapWrap}>
      <MapView
        style={StyleSheet.absoluteFillObject}
        styleURL={getPrimaryMapStyle()}
        logoEnabled={false}
        attributionEnabled={false}
        compassEnabled={false}
        scaleBarEnabled={false}
        scrollEnabled={false}
        zoomEnabled={false}
        rotateEnabled={false}
        pitchEnabled={false}
      >
        {CameraComponent && (
          <CameraComponent
            bounds={{ ne: bounds.ne, sw: bounds.sw, paddingTop: 24, paddingBottom: 24, paddingLeft: 24, paddingRight: 24 }}
            animationDuration={0}
          />
        )}
        {ShapeSource && LineLayer && (
          <ShapeSource id="route-preview-line" shape={lineGeoJson}>
            <LineLayer
              id="route-preview-line-layer"
              style={{
                lineColor: Colors.primary,
                lineWidth: 3,
                lineCap: 'round',
                lineJoin: 'round',
              }}
            />
          </ShapeSource>
        )}
      </MapView>
    </View>
  );
}

function RouteSheet({
  route, onClose, onEdit, onDelete, readOnly = false,
}: {
  route: import('../store/useRouteStore').Route | null;
  onClose: () => void;
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
  /** Sprint 69 STORY-00538: hide Edit + Delete when viewing a friend's
   *  route (Friends sub-tab). The sheet still renders the metadata + map
   *  preview; only the owner actions are suppressed. */
  readOnly?: boolean;
}) {
  const insets = useSafeAreaInsets();
  const slideAnim = useRef(new Animated.Value(400)).current;
  const opacityAnim = useRef(new Animated.Value(0)).current;
  // Keep snapshot so content doesn't vanish during close animation
  const snapshot = useRef(route);
  if (route !== null) snapshot.current = route;
  const data = snapshot.current;
  const isVisible = useRef(false);

  const [deleteConfirm, setDeleteConfirm] = useState(false);

  const dismiss = (then?: () => void) => {
    setDeleteConfirm(false);
    Animated.parallel([
      Animated.timing(slideAnim, { toValue: 400, duration: 220, easing: Easing.in(Easing.quad), useNativeDriver: true }),
      Animated.timing(opacityAnim, { toValue: 0, duration: 200, easing: Easing.in(Easing.ease), useNativeDriver: true }),
    ]).start(() => { isVisible.current = false; onClose(); then?.(); });
  };

  useEffect(() => {
    if (route !== null) {
      setDeleteConfirm(false);
      isVisible.current = true;
      slideAnim.setValue(400);
      opacityAnim.setValue(0);
      Animated.parallel([
        Animated.timing(slideAnim, { toValue: 0, duration: 280, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
        Animated.timing(opacityAnim, { toValue: 1, duration: 220, easing: Easing.out(Easing.ease), useNativeDriver: true }),
      ]).start();
    }
  }, [route?.id]);

  if (route === null && !isVisible.current) return null;
  if (!data) return null;

  const handleDelete = () => {
    if (!deleteConfirm) { setDeleteConfirm(true); return; }
    dismiss(() => onDelete(data.id));
  };

  const lastRun = data.lastRunAt ? new Date(data.lastRunAt).toLocaleDateString() : null;

  return (
    <Animated.View style={[sheetStyles.container, { opacity: opacityAnim }]}>
      <TouchableOpacity style={StyleSheet.absoluteFillObject} activeOpacity={1} onPress={() => dismiss()} />
      <Animated.View style={[sheetStyles.sheet, { transform: [{ translateY: slideAnim }], paddingBottom: Math.max(insets.bottom, Spacing.xl) }]}>
        <View style={sheetStyles.handle} />

        {/* Header */}
        <View style={sheetStyles.headerRow}>
          <Text style={sheetStyles.title} numberOfLines={1}>{data.name}</Text>
          <PressBtn style={sheetStyles.closeBtn} onPress={() => dismiss()} scaleTo={0.9}>
            <Icon name="X" size={IconSize.sm} color={Colors.textSecondary} strokeWidth={2.5} />
          </PressBtn>
        </View>

        {/* v122 fix #8: preview map removed. Activities don't show a
            preview either; route detail mirrors that. The View button
            below opens the route's full-screen detail (clone of the
            originating activity) where editing actually happens. */}

        {/* Stats row */}
        <View style={routeSheetStyles.statsRow}>
          <View style={routeSheetStyles.statItem}>
            <Icon name="Milestone" size={14} color={Colors.primary} strokeWidth={2} />
            <Text style={routeSheetStyles.statValue}>{(data.distanceM / 1000).toFixed(1)} km</Text>
          </View>
          <View style={routeSheetStyles.statDivider} />
          <View style={routeSheetStyles.statItem}>
            <Icon name="TrendingUp" size={14} color={Colors.primary} strokeWidth={2} />
            <Text style={routeSheetStyles.statValue}>{Math.round(data.elevationGainM)} m</Text>
          </View>
          <View style={routeSheetStyles.statDivider} />
          <View style={routeSheetStyles.statItem}>
            <Icon name="Flag" size={14} color={Colors.primary} strokeWidth={2} />
            <Text style={routeSheetStyles.statValue}>{data.waypoints.length} waypoints</Text>
          </View>
          <View style={routeSheetStyles.statDivider} />
          <View style={routeSheetStyles.statItem}>
            <Icon name="RotateCcw" size={14} color={Colors.primary} strokeWidth={2} />
            <Text style={routeSheetStyles.statValue}>{data.runCount}× used</Text>
          </View>
        </View>

        {lastRun && (
          <Text style={routeSheetStyles.lastRun}>Last used {lastRun}</Text>
        )}

        {/* Actions — v122 fix #8: a single View button (full-width
            primary). Edit + Delete moved to inside the View screen.
            Matches the Activity flow: list → tap → detail → edit/delete.

            Sprint 69 STORY-00538: when readOnly (friend route via Friends
            sub-tab), the View button stays but onEdit is suppressed —
            the friend's route is not editable in v1. Future v1.1 may add
            a "Save as my route" affordance (out of scope here). */}
        <View style={sheetStyles.actions}>
          <PressBtn
            style={[sheetStyles.saveBtn, { flex: 1, opacity: readOnly ? 0.5 : 1 }]}
            onPress={() => { if (!readOnly) dismiss(() => onEdit(data.id)); }}
            scaleTo={readOnly ? 1 : 0.96}
            disabled={readOnly}
          >
            <Icon name="Map" size={14} color="#fff" strokeWidth={2} />
            <Text style={sheetStyles.saveBtnText}>{readOnly ? 'Friend route (view only)' : 'View'}</Text>
          </PressBtn>
        </View>
      </Animated.View>
    </Animated.View>
  );
}

// ── ActivitySheet ─────────────────────────────────────────────────────────────
function ActivitySheet({
  session, onClose,
}: {
  session: import('../store/useSessionStore').TrackingSession | null;
  onClose: () => void;
}) {
  const nav = useNavigation<Nav>();
  const insets = useSafeAreaInsets();
  const deleteSession = useSessionStore(s => s.deleteSession);
  const slideAnim = useRef(new Animated.Value(400)).current;
  const opacityAnim = useRef(new Animated.Value(0)).current;
  const snapshot = useRef(session);
  if (session !== null) snapshot.current = session;
  const data = snapshot.current;
  const isVisible = useRef(false);

  const [deleteConfirm, setDeleteConfirm] = useState(false);

  const dismiss = (then?: () => void) => {
    setDeleteConfirm(false);
    Animated.parallel([
      Animated.timing(slideAnim, { toValue: 400, duration: 220, easing: Easing.in(Easing.quad), useNativeDriver: true }),
      Animated.timing(opacityAnim, { toValue: 0, duration: 200, easing: Easing.in(Easing.ease), useNativeDriver: true }),
    ]).start(() => { isVisible.current = false; onClose(); then?.(); });
  };

  useEffect(() => {
    if (session !== null) {
      setDeleteConfirm(false);
      isVisible.current = true;
      slideAnim.setValue(400);
      opacityAnim.setValue(0);
      Animated.parallel([
        Animated.timing(slideAnim, { toValue: 0, duration: 280, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
        Animated.timing(opacityAnim, { toValue: 1, duration: 220, easing: Easing.out(Easing.ease), useNativeDriver: true }),
      ]).start();
    }
  }, [session?.id]);

  if (session === null && !isVisible.current) return null;
  if (!data) return null;

  const isRun = data.activityMode === 'running';
  const accent = isRun ? Colors.running : Colors.primary;
  const date = new Date(data.startedAt);
  const dateStr = `${date.getDate()}/${date.getMonth() + 1}/${date.getFullYear()}`;

  const handleDelete = () => {
    if (!deleteConfirm) { setDeleteConfirm(true); return; }
    dismiss(() => deleteSession(data.id));
  };

  return (
    <Animated.View style={[sheetStyles.container, { opacity: opacityAnim }]}>
      <TouchableOpacity style={StyleSheet.absoluteFillObject} activeOpacity={1} onPress={() => dismiss()} />
      <Animated.View style={[sheetStyles.sheet, { transform: [{ translateY: slideAnim }], paddingBottom: Math.max(insets.bottom, Spacing.xl) }]}>
        <View style={sheetStyles.handle} />

        {/* Header */}
        <View style={sheetStyles.headerRow}>
          <Text style={sheetStyles.title}>{data.name || (isRun ? 'Run' : 'Hike')}</Text>
          <PressBtn style={sheetStyles.closeBtn} onPress={() => dismiss()} scaleTo={0.9}>
            <Icon name="X" size={IconSize.sm} color={Colors.textSecondary} strokeWidth={2.5} />
          </PressBtn>
        </View>

        {/* Stats row */}
        <View style={routeSheetStyles.statsRow}>
          <View style={routeSheetStyles.statItem}>
            <Icon name="Calendar" size={14} color={accent} strokeWidth={2} />
            <Text style={[routeSheetStyles.statValue, { color: accent }]}>{dateStr}</Text>
          </View>
          <View style={routeSheetStyles.statDivider} />
          <View style={routeSheetStyles.statItem}>
            <Icon name="Milestone" size={14} color={accent} strokeWidth={2} />
            <Text style={[routeSheetStyles.statValue, { color: accent }]}>{formatDistance(data.distanceM, 'km', 1)} km</Text>
          </View>
          <View style={routeSheetStyles.statDivider} />
          <View style={routeSheetStyles.statItem}>
            <Icon name="Timer" size={14} color={accent} strokeWidth={2} />
            <Text style={[routeSheetStyles.statValue, { color: accent }]}>{formatDuration(data.durationS)}</Text>
          </View>
        </View>

        {/* Actions — v120: only View. Delete was removed — the destination
            (MapHistory detail) already has a Delete button, having two
            entry points was redundant and made the row feel cramped. */}
        <View style={sheetStyles.actions}>
          <PressBtn
            style={[sheetStyles.saveBtn, { flex: 1 }]}
            onPress={() => dismiss(() => nav.navigate('MapHistory', { sessionId: data.id }))}
            scaleTo={0.96}
          >
            <Icon name="Map" size={14} color="#fff" strokeWidth={2} />
            <Text style={sheetStyles.saveBtnText}>View</Text>
          </PressBtn>
        </View>
      </Animated.View>
    </Animated.View>
  );
}

// ── Routes Tab ───────────────────────────────────────────────────────────────
function RoutesTab({ onGoToActivities }: { onGoToActivities?: () => void }) {
  const nav = useNavigation<Nav>();
  const routes = useRouteStore(s => s.routes);
  const deleteRoute = useRouteStore(s => s.deleteRoute);
  // Sprint 69 STORY-00538: circle routes slice + loader.
  const circleRoutes = useRouteStore(s => s.circleRoutes);
  const loadingCircleRoutes = useRouteStore(s => s.loadingCircleRoutes);
  const loadCircleRoutes = useRouteStore(s => s.loadCircleRoutes);
  const [selectedRoute, setSelectedRoute] = useState<import('../store/useRouteStore').Route | null>(null);
  // Filter + sort state — local-only, resets if user leaves the tab.
  const [filter, setFilter] = useState<'all' | 'hiking' | 'running'>('all');
  const [sort, setSort] = useState<'recent' | 'distance-desc' | 'distance-asc'>('recent');
  // Sprint 69 STORY-00538: Mine|Friends scope sub-tab.
  const [scope, setScope] = useState<'mine' | 'friends'>('mine');
  // v375: track whether we've completed at least one Friends fetch.
  // Without this, the brief gap between "user clicks Friends" and "fetch
  // resolves" renders the empty hero, then re-renders the list — a
  // visible flash. The user reported this as flicker in v374.
  const [hasFetchedFriends, setHasFetchedFriends] = useState(false);

  React.useEffect(() => {
    if (scope === 'friends' && circleRoutes.length === 0 && !loadingCircleRoutes && !hasFetchedFriends) {
      // v375 review fix: use .finally() not .then() — without it, a network
      // reject leaves hasFetchedFriends=false forever and the empty hero
      // never renders (user stuck looking at a blank tab).
      void loadCircleRoutes().finally(() => setHasFetchedFriends(true));
    } else if (scope === 'friends' && !hasFetchedFriends && !loadingCircleRoutes) {
      // Already have cached routes from a prior fetch — skip ahead.
      setHasFetchedFriends(true);
    }
  }, [scope]);

  const visible = useMemo(() => {
    let list = scope === 'mine' ? routes : circleRoutes;
    if (filter !== 'all') list = list.filter(r => r.activityMode === filter);
    if (sort === 'recent') {
      list = [...list].sort((a, b) => b.updatedAt - a.updatedAt);
    } else if (sort === 'distance-desc') {
      list = [...list].sort((a, b) => b.distanceM - a.distanceM);
    } else {
      list = [...list].sort((a, b) => a.distanceM - b.distanceM);
    }
    return list;
  }, [routes, circleRoutes, scope, filter, sort]);

  return (
    <View style={{ flex: 1 }}>
      {/* Sprint 69 STORY-00538: Mine|Friends scope sub-tab. */}
      <ScopeTabBar scope={scope} onChange={setScope} />
      {/* v376 fix: empty hero takes the place of the list when there is
          no data — FilterSortBar must NOT render when there's nothing to
          filter (用户 v375 反馈: filter 不应该在没有数据时出现)。 */}
      {scope === 'mine' && routes.length === 0 ? (
        <View style={styles.emptyHero}>
          <View style={styles.emptyHeroIcon}>
            <Icon name="Route" size={40} color={Colors.primary} strokeWidth={1.5} />
          </View>
          <Text style={styles.emptyHeroTitle}>No saved routes yet</Text>
          <Text style={styles.emptyHeroBody}>
            Routes are paths you've already walked.{'\n'}
            Open an Activity, tap{' '}
            <Text style={{ fontWeight: '700', color: Colors.primary }}>Save as Route</Text>
            , and it'll show up here.
          </Text>
          <TouchableOpacity
            style={styles.emptyHeroCta}
            activeOpacity={0.85}
            onPress={() => onGoToActivities?.()}
          >
            <Icon name="Map" size={16} color="#fff" strokeWidth={2} />
            <Text style={styles.emptyHeroCtaText}>View Activities</Text>
          </TouchableOpacity>
        </View>
      ) : null}
      {scope === 'friends' && !hasFetchedFriends && circleRoutes.length === 0 ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={styles.emptyHint}>Loading friends' routes…</Text>
        </View>
      ) : null}
      {scope === 'friends' && hasFetchedFriends && circleRoutes.length === 0 ? (
        <View style={styles.emptyHero}>
          <View style={styles.emptyHeroIcon}>
            <Icon name="Route" size={40} color={Colors.primary} strokeWidth={1.5} />
          </View>
          <Text style={styles.emptyHeroTitle}>No routes from your friends yet</Text>
          <Text style={styles.emptyHeroBody}>
            Routes your friends share at Friend tier{'\n'}
            will show up here.
          </Text>
        </View>
      ) : null}
      {((scope === 'mine' && routes.length > 0) || (scope === 'friends' && circleRoutes.length > 0)) && (
        <>
      <FilterSortBar
        filters={[
          { id: 'all', label: 'All' },
          { id: 'hiking', label: 'Hiking' },
          { id: 'running', label: 'Running' },
        ]}
        filterValue={filter}
        onFilterChange={setFilter}
        sorts={[
          { id: 'recent', label: 'Recent' },
          { id: 'distance-desc', label: 'Longest' },
          { id: 'distance-asc', label: 'Shortest' },
        ]}
        sortValue={sort}
        onSortChange={setSort}
      />
      <FlatList
        data={visible}
        keyExtractor={r => r.id}
        contentContainerStyle={styles.listContent}
        /* v124 fix #8: search field removed — typical route counts are
           low enough that filter chips + sort are sufficient. New Route
           button is also gone (per route-rules.md §2.3 manual drawing
           is forbidden). The list now starts straight at the cards. */
        ListEmptyComponent={
          /* v376: routes.length===0 已在外层提前 return,这里只剩
             "filter 把所有数据筛掉"的场景。 */
          <View style={{ alignItems: 'center', paddingTop: 40 }}>
            <Text style={styles.emptyHint}>
              {'No routes match this filter.'}
            </Text>
          </View>
        }
        renderItem={({ item }) => (
          <PressBtn
            style={styles.card}
            onPress={() => nav.navigate('RouteEditor', { routeId: item.id })}
            onLongPress={() => setSelectedRoute(item)}
            scaleTo={0.97}
          >
            <LinearGradient colors={[Colors.primaryLight, Colors.primaryDeep]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.cardBadge}>
              <Icon name="Route" size={18} color={Colors.primary} strokeWidth={1.8} />
            </LinearGradient>
            <View style={{ flex: 1 }}>
              <Text style={styles.cardTitle}>{item.name}</Text>
              <Text style={styles.cardMeta}>{(item.distanceM / 1000).toFixed(1)} km · {item.waypoints.length} waypoints</Text>
            </View>
            <Icon name="ChevronRight" size={16} color={Colors.textMuted} strokeWidth={2} />
          </PressBtn>
        )}
      />
      <RouteSheet
        route={selectedRoute}
        onClose={() => setSelectedRoute(null)}
        onEdit={(id) => nav.navigate('RouteEditor', { routeId: id })}
        onDelete={(id) => deleteRoute(id)}
        readOnly={scope === 'friends'}
      />
        </>
      )}
    </View>
  );
}

// ── Activities Tab ───────────────────────────────────────────────────────────
function ActivitiesTab() {
  const sessions = useSessionStore(s => s.sessions);
  const [selectedSession, setSelectedSession] = useState<import('../store/useSessionStore').TrackingSession | null>(null);
  const [filter, setFilter] = useState<'all' | 'hiking' | 'running'>('all');
  const [sort, setSort] = useState<'recent' | 'distance-desc' | 'duration-desc'>('recent');
  // v261 PO direction: tap → direct to MapHistory detail (long-press still
  // opens the action sheet for power users). The pre-v261 behavior had been
  // changed once before but the fix never made it into a commit, so it
  // regressed. This time it's persisted via git.
  const nav = useNavigation<Nav>();

  const visible = useMemo(() => {
    let list = sessions;
    if (filter !== 'all') list = list.filter(s => s.activityMode === filter);
    if (sort === 'recent') {
      list = [...list].sort((a, b) => b.startedAt - a.startedAt);
    } else if (sort === 'distance-desc') {
      list = [...list].sort((a, b) => b.distanceM - a.distanceM);
    } else {
      list = [...list].sort((a, b) => b.durationS - a.durationS);
    }
    return list;
  }, [sessions, filter, sort]);

  if (sessions.length === 0) {
    return <EmptyState icon="Map" title="No tracks walked yet" hint="Start hiking or running. Your tracks will live here." illustration={<IllustrationHalo><EmptyRoutes size={192} /></IllustrationHalo>} />;
  }

  return (
    <View style={{ flex: 1 }}>
      <FilterSortBar
        filters={[
          { id: 'all', label: 'All' },
          { id: 'hiking', label: 'Hiking' },
          { id: 'running', label: 'Running' },
        ]}
        filterValue={filter}
        onFilterChange={setFilter}
        sorts={[
          { id: 'recent', label: 'Recent' },
          { id: 'distance-desc', label: 'Longest' },
          { id: 'duration-desc', label: 'Most time' },
        ]}
        sortValue={sort}
        onSortChange={setSort}
      />
      <FlatList
        data={visible}
        keyExtractor={s => s.id}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={
          <View style={{ alignItems: 'center', paddingTop: 40 }}>
            <Text style={styles.emptyHint}>No activities match this filter.</Text>
          </View>
        }
        renderItem={({ item }) => {
          const isRun = item.activityMode === 'running';
          const accent = isRun ? Colors.running : Colors.primary;
          const bg = isRun ? Colors.runningLight : Colors.primaryLight;
          const date = new Date(item.startedAt);
          const dateStr = `${date.getDate()}/${date.getMonth() + 1}/${date.getFullYear()}`;
          return (
            <PressBtn
              style={[styles.card, { borderLeftColor: accent }]}
              onPress={() => nav.navigate('MapHistory', { sessionId: item.id })}
              onLongPress={() => setSelectedSession(item)}
              scaleTo={0.97}
            >
              <View style={[styles.cardBadge, { backgroundColor: bg }]}>
                {isRun
                  ? <RunningIcon size={18} color={accent} />
                  : <HikingIcon size={18} color={accent} />
                }
              </View>
              <View style={{ flex: 1 }}>
                {/* Show the user-assigned name when present, falling
                    back to the activity type. Previously this was
                    hardcoded to 'Run' / 'Hike' which silently dropped
                    whatever the user typed in the stop-summary sheet. */}
                <Text style={styles.cardTitle}>{item.name || (isRun ? 'Run' : 'Hike')}</Text>
                <Text style={styles.cardMeta}>{dateStr} · {formatDistance(item.distanceM, 'km', 1)} km · {formatDuration(item.durationS)}</Text>
              </View>
              <Icon name="ChevronRight" size={16} color={Colors.textMuted} strokeWidth={2} />
            </PressBtn>
          );
        }}
      />
      <ActivitySheet
        session={selectedSession}
        onClose={() => setSelectedSession(null)}
      />
    </View>
  );
}

// ── FlagEditSheet — mirrors MapScreen's EditMarkerSheet exactly ───────────────
function FlagEditSheet({
  marker, onClose, onSave, onDelete,
}: {
  marker: Marker | null;
  onClose: () => void;
  onSave: (id: string, type: MarkerType, note: string, permission: MarkerPermission) => void;
  onDelete: (id: string) => void;
}) {
  const nav = useNavigation<Nav>();
  const insets = useSafeAreaInsets();
  const [selectedType, setSelectedType] = useState<MarkerType | null>(null);
  const [text, setText] = useState('');
  const [permission, setPermission] = useState<MarkerPermission>('personal');
  const [textFocused, setTextFocused] = useState(false);
  const slideAnim = useRef(new Animated.Value(400)).current;
  const opacityAnim = useRef(new Animated.Value(0)).current;
  const snapshot = useRef(marker);
  if (marker !== null) snapshot.current = marker;
  const data = snapshot.current;
  const isVisible = useRef(false);

  const dismiss = (then?: () => void) => {
    Animated.parallel([
      Animated.timing(slideAnim, { toValue: 400, duration: 220, easing: Easing.in(Easing.quad), useNativeDriver: true }),
      Animated.timing(opacityAnim, { toValue: 0, duration: 200, easing: Easing.in(Easing.ease), useNativeDriver: true }),
    ]).start(() => { isVisible.current = false; onClose(); then?.(); });
  };

  useEffect(() => {
    if (marker) {
      setSelectedType(marker.type as MarkerType);
      setText(marker.note ?? '');
      setPermission((marker.permission as MarkerPermission) ?? 'personal');
    }
  }, [marker?.id]);

  useEffect(() => {
    if (marker !== null) {
      isVisible.current = true;
      slideAnim.setValue(400);
      opacityAnim.setValue(0);
      Animated.parallel([
        Animated.timing(slideAnim, { toValue: 0, duration: 280, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
        Animated.timing(opacityAnim, { toValue: 1, duration: 220, easing: Easing.out(Easing.ease), useNativeDriver: true }),
      ]).start();
    }
  }, [marker?.id]);

  if (marker === null && !isVisible.current) return null;
  if (!data) return null;

  const permIconNames: Record<MarkerPermission, IconName> = { personal: 'Lock', group: 'Users', public: 'Globe' };
  const permLabels: Record<MarkerPermission, string> = { personal: 'Only me', group: 'Friends', public: 'Public' };

  const confirmDelete = () => {
    Alert.alert(
      'Delete Flag',
      `Delete "${data.note || 'this flag'}"? This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: () => dismiss(() => onDelete(data.id)) },
      ]
    );
  };

  return (
    // No dark overlay — sheet slides up over transparent background
    <Animated.View style={[sheetStyles.container, { opacity: opacityAnim }]}>
      <TouchableOpacity style={StyleSheet.absoluteFillObject} activeOpacity={1} onPress={() => dismiss()} />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <Animated.View style={[sheetStyles.sheet, { transform: [{ translateY: slideAnim }], paddingBottom: Math.max(insets.bottom, Spacing.xl) }]}>
          <View style={sheetStyles.handle} />

          {/* Header: title + map pin + close */}
          <View style={sheetStyles.headerRow}>
            <Text style={sheetStyles.title}>Edit Flag</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.sm }}>
              {/* View on map — icon button in header, away from Delete */}
              <PressBtn
                style={sheetStyles.mapBtn}
                onPress={() => dismiss(() => nav.navigate('Map' as any, { focusLat: data.lat, focusLng: data.lng, focusMarkerId: data.id }))}
                scaleTo={0.92}
              >
                <Icon name="MapPin" size={14} color={Colors.primary} strokeWidth={2} />
              </PressBtn>
              <PressBtn style={sheetStyles.closeBtn} onPress={() => dismiss()} scaleTo={0.9}>
                <Icon name="X" size={IconSize.sm} color={Colors.textSecondary} strokeWidth={2.5} />
              </PressBtn>
            </View>
          </View>

          {/* Type grid — identical to MapScreen: gradient badge + check mark */}
          <View style={sheetStyles.typeGrid}>
            {FLAG_TYPES.map((flag) => {
              const isSelected = selectedType === flag.id;
              return (
                <TouchableOpacity
                  key={flag.id}
                  style={[sheetStyles.typeCard, isSelected && sheetStyles.typeCardSelected]}
                  onPress={() => { setSelectedType(flag.id); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
                  activeOpacity={0.8}
                >
                  <LinearGradient
                    colors={[flag.bg, flag.bg]}
                    start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
                    style={[sheetStyles.typeIconBadge, { borderColor: flag.color + '40' }]}
                  >
                    <Icon name={flag.icon} size={IconSize.md} color={flag.color} strokeWidth={2} />
                  </LinearGradient>
                  <Text style={[sheetStyles.typeCardLabel, { color: isSelected ? Colors.primary : Colors.textSecondary }]}>
                    {flag.label}
                  </Text>
                  {isSelected && (
                    <View style={sheetStyles.typeCardCheck}>
                      <Icon name="CircleCheck" size={14} color={Colors.primary} strokeWidth={2.5} />
                    </View>
                  )}
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Note input — identical to MapScreen */}
          <View style={sheetStyles.noteWrap}>
            <TextInput
              style={[sheetStyles.noteInput, textFocused && sheetStyles.noteInputFocused, text.length >= 50 && sheetStyles.noteInputError]}
              placeholder="Describe this spot… (optional)"
              placeholderTextColor={Colors.textMuted}
              value={text}
              onChangeText={(t) => setText(t.slice(0, 50))}
              multiline
              numberOfLines={2}
              onFocus={() => setTextFocused(true)}
              onBlur={() => setTextFocused(false)}
            />
            <View style={sheetStyles.noteFooterRow}>
              <Text style={sheetStyles.noteMaxLabel}>Max 50 characters</Text>
              {(textFocused || text.length > 0) && (
                <Text style={[sheetStyles.charCount, text.length >= 50 ? { color: Colors.danger } : text.length >= 40 ? { color: Colors.severityCaution } : null]}>
                  {text.length}/50
                </Text>
              )}
            </View>
          </View>

          {/* Permission pills — identical to MapScreen */}
          <View style={sheetStyles.permRow}>
            {(['personal', 'group', 'public'] as const).map((p) => {
              const active = permission === p;
              return (
                <TouchableOpacity key={p} style={[sheetStyles.permPill, active && sheetStyles.permPillActive]} onPress={() => setPermission(p)}>
                  <Icon name={permIconNames[p]} size={14} color={active ? Colors.primary : Colors.textSecondary} strokeWidth={1.8} />
                  <Text style={[sheetStyles.permPillLabel, active && sheetStyles.permPillLabelActive]}>{permLabels[p]}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Actions: Delete (ghost left) + Save Changes (solid right) */}
          <View style={sheetStyles.actions}>
            <PressBtn style={sheetStyles.deleteBtn} onPress={confirmDelete} scaleTo={0.96}>
              <Icon name="Trash2" size={14} color={Colors.danger} strokeWidth={2} />
              <Text style={sheetStyles.deleteBtnText}>Delete</Text>
            </PressBtn>
            <PressBtn
              style={sheetStyles.saveBtn}
              onPress={() => {
                if (!selectedType) return;
                onSave(data.id, selectedType, text, permission);
                dismiss();
              }}
              scaleTo={0.96}
            >
              <Icon name="Check" size={IconSize.sm} color="#fff" strokeWidth={2} />
              <Text style={sheetStyles.saveBtnText}>Save Changes</Text>
            </PressBtn>
          </View>
        </Animated.View>
      </KeyboardAvoidingView>
    </Animated.View>
  );
}

// ── Flags Tab ────────────────────────────────────────────────────────────────
const PERM_FILTERS: { id: MarkerPermission | 'all'; icon: IconName }[] = [
  { id: 'personal', icon: 'Lock' },
  { id: 'group',    icon: 'Users' },
  { id: 'public',   icon: 'Globe' },
];

function FlagsTab() {
  const markers = useMarkerStore(s => s.markers);
  // Sprint 69 STORY-00537: circle markers slice + loader.
  const circleMarkers = useMarkerStore(s => s.circleMarkers);
  const loadingCircle = useMarkerStore(s => s.loadingCircle);
  const loadCircleMarkers = useMarkerStore(s => s.loadCircleMarkers);
  const lastCoord = useTrackingStore(s => s.lastCoordinate);
  const [typeFilter, setTypeFilter] = useState<MarkerType | 'all'>('all');
  const [permFilter, setPermFilter] = useState<MarkerPermission | 'all'>('all');
  const [sort, setSort] = useState<'recent' | 'nearest'>('recent');
  // Sprint 69 STORY-00537: Mine|Friends scope sub-tab. Mine = own marks,
  // Friends = subscribed-friend marks via /api/circle/markers.
  const [scope, setScope] = useState<'mine' | 'friends'>('mine');
  // v375 STORY-00537: track whether the first Friends fetch has settled
  // — same flicker-prevention pattern as RoutesTab.
  const [hasFetchedFriends, setHasFetchedFriends] = useState(false);
  // v299 N8: flags now open the read-only MarkerDetailScreen instead
  // of the in-place FlagEditSheet. Editing/deleting is no longer
  // exposed from this tab — per user spec, planted cairns are
  // immutable.
  const nav = useNavigation<Nav>();

  // Lazy-load friend markers when the user first switches to Friends.
  // Subsequent visits use the cached slice; pull-to-refresh would re-fetch
  // (not in v1 scope).
  React.useEffect(() => {
    if (scope === 'friends' && circleMarkers.length === 0 && !loadingCircle && !hasFetchedFriends) {
      // v375 review fix: .finally() — same as RoutesTab, never strand
      // the user on a never-fetched state if /api/circle/markers rejects.
      void loadCircleMarkers().finally(() => setHasFetchedFriends(true));
    } else if (scope === 'friends' && !hasFetchedFriends && !loadingCircle) {
      setHasFetchedFriends(true);
    }
  }, [scope]);

  const baseList = scope === 'mine' ? markers : circleMarkers;
  const filtered = baseList.filter(m => {
    if (typeFilter !== 'all' && m.type !== typeFilter) return false;
    if (permFilter !== 'all' && (m.permission ?? 'personal') !== permFilter) return false;
    return true;
  });
  const sorted = useMemo(() => {
    if (sort === 'recent') {
      return [...filtered].sort((a, b) => b.createdAt - a.createdAt);
    }
    // 'nearest' — needs lastCoord; fall back to recent if no GPS yet
    if (!lastCoord) return [...filtered].sort((a, b) => b.createdAt - a.createdAt);
    const dist = (m: Marker) => {
      const dx = (m.lng - lastCoord.lng) * Math.cos((m.lat * Math.PI) / 180);
      const dy = m.lat - lastCoord.lat;
      return dx * dx + dy * dy; // squared euclidean is enough for ordering
    };
    return [...filtered].sort((a, b) => dist(a) - dist(b));
  }, [filtered, sort, lastCoord]);

  if (scope === 'mine' && markers.length === 0) {
    return (
      <View style={{ flex: 1 }}>
        <ScopeTabBar scope={scope} onChange={setScope} />
        {/* UX-G fix (v372→v373): match the RoutesTab empty state — illustration
            + hero copy + 'Plant a new mark' CTA navigating to the Plant flow.
            Pre-fix the Flags-Mine empty state was a passive copy block with
            no actionable affordance. */}
        <View style={styles.emptyHero}>
          <View style={{ marginBottom: Spacing.md }}>
            <IllustrationHalo>
              <EmptyMarkers size={192} />
            </IllustrationHalo>
          </View>
          <Text style={styles.emptyHeroTitle}>No flags planted yet</Text>
          <Text style={styles.emptyHeroBody}>
            Leave a mark when you find something worth noting —{'\n'}
            a viewpoint, a junction, a hut.
          </Text>
          <TouchableOpacity
            style={styles.emptyHeroCta}
            activeOpacity={0.85}
            onPress={() => nav.navigate('Plant')}
            testID="flags-mine-empty-plant-cta"
          >
            <Icon name="Plus" size={16} color="#fff" strokeWidth={2} />
            <Text style={styles.emptyHeroCtaText}>Plant a new mark</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      {/* Sprint 69 STORY-00537: Mine|Friends scope sub-tab — Activities
          stays Mine-only (Story-536); Flags + Routes get this control. */}
      <ScopeTabBar scope={scope} onChange={setScope} />

      {scope === 'friends' && !hasFetchedFriends && circleMarkers.length === 0 ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={styles.emptyHint}>Loading friends' marks…</Text>
        </View>
      ) : null}
      {scope === 'friends' && hasFetchedFriends && circleMarkers.length === 0 ? (
        <View style={styles.emptyHero}>
          <View style={{ marginBottom: Spacing.md }}>
            <IllustrationHalo>
              <EmptyMarkers size={192} />
            </IllustrationHalo>
          </View>
          <Text style={styles.emptyHeroTitle}>No marks from your friends yet</Text>
          <Text style={styles.emptyHeroBody}>
            Marks your friends share at Friend tier{'\n'}
            will show up here.
          </Text>
        </View>
      ) : null}

      {(scope === 'mine' || (scope === 'friends' && circleMarkers.length > 0)) && (
        <>
      {/* Two-row filter bar — type chips on row 1, permission toggles
          on row 2. The original single-row layout pushed perm toggles
          off-screen on narrower devices ("一行放不下"). Splitting
          horizontally lets each row breathe. */}
      <View style={styles.filterColumn}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filterChipsScroll}
        >
          {FLAG_FILTERS.map(f => (
            <TouchableOpacity key={f.id} style={[styles.filterChip, typeFilter === f.id && styles.filterChipActive]} onPress={() => setTypeFilter(f.id)}>
              <Text style={[styles.filterChipText, typeFilter === f.id && styles.filterChipTextActive]}>{f.label}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
        <View style={styles.permRow}>
          <View style={styles.permToggleGroup}>
            {PERM_FILTERS.map(p => {
              const active = permFilter === p.id;
              return (
                <TouchableOpacity
                  key={p.id}
                  style={[styles.permToggle, active && styles.permToggleActive]}
                  onPress={() => setPermFilter(active ? 'all' : p.id)}
                >
                  <Icon name={p.icon} size={13} color={active ? Colors.primary : Colors.textMuted} strokeWidth={active ? 2.5 : 1.8} />
                </TouchableOpacity>
              );
            })}
          </View>
          {/* Sort chip moved into the same row as perm toggles to keep
              vertical compactness — was on its own third row before. */}
          <TouchableOpacity
            style={filterBarStyles.sortChip}
            onPress={() => setSort(sort === 'recent' ? 'nearest' : 'recent')}
            activeOpacity={0.7}
          >
            <Icon name="ArrowUpDown" size={12} color={Colors.primary} strokeWidth={2} />
            <Text style={filterBarStyles.sortText}>{sort === 'recent' ? 'Recent' : 'Nearest'}</Text>
          </TouchableOpacity>
        </View>
      </View>

      <FlatList
        data={sorted}
        keyExtractor={m => m.id}
        contentContainerStyle={styles.listContent}
        renderItem={({ item }) => {
          const meta = MARKER_META[item.type] || MARKER_META.free;
          const perm = (item.permission ?? 'personal') as MarkerPermission;
          const permIcon: IconName = perm === 'public' ? 'Globe' : perm === 'group' ? 'Users' : 'Lock';
          const permColor = perm === 'personal' ? Colors.textMuted : perm === 'group' ? Colors.info : Colors.success;
          let distanceStr = '';
          if (lastCoord) {
            const distM = haversineM({ lat: lastCoord.lat, lng: lastCoord.lng }, { lat: item.lat, lng: item.lng });
            distanceStr = distM < 1000 ? `${Math.round(distM)}m` : `${(distM / 1000).toFixed(1)}km`;
          }
          return (
            <PressBtn style={[styles.card, { borderLeftColor: meta.color }]} onPress={() => nav.navigate('MarkerDetail', { markerId: item.id })} scaleTo={0.97}>
              <View style={[styles.cardBadge, { backgroundColor: meta.bg }]}>
                <Icon name={(FLAG_TYPES.find(f => f.id === item.type)?.icon ?? 'Flag') as IconName} size={16} color={meta.color} strokeWidth={2} />
              </View>
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Text style={styles.flagName} numberOfLines={1} ellipsizeMode="tail">{item.note || '(No note)'}</Text>
                  {item.approximate && <View style={styles.approxChip}><Text style={styles.approxChipText}>~</Text></View>}
                </View>
                <Text style={[styles.cardMeta, { color: meta.color }]}>{meta.label}</Text>
              </View>
              {distanceStr ? <Text style={styles.distanceText}>{distanceStr}</Text> : null}
              <Icon name={permIcon} size={12} color={permColor} strokeWidth={1.8} />
              <Icon name="ChevronRight" size={14} color={Colors.textMuted} strokeWidth={2} />
            </PressBtn>
          );
        }}
        ListEmptyComponent={<View style={{ padding: Spacing.xl, alignItems: 'center' }}><Text style={styles.emptyHint}>No flags matching filter</Text></View>}
      />
      {/* v299 N8: FlagEditSheet removed — Flags now navigate to
          read-only MarkerDetailScreen. */}
        </>
      )}
    </View>
  );
}

// ── Main ─────────────────────────────────────────────────────────────────────
export function RoutesScreen() {
  // v122 fix #7: honour an `initialTab` route param so callers can land
  // on a specific tab. e.g. MapHistoryScreen's "Save as Route" success
  // navigates here with initialTab='routes' so the user immediately
  // sees the new entry instead of the default Activities list.
  const route = useRoute<RouteProp<RootStackParamList, 'Routes'>>();
  const initialTab = route.params?.initialTab ?? 'activities';
  const [tab, setTab] = useState<Tab>(initialTab);
  const loadRoutes = useRouteStore(s => s.loadRoutes);
  const nav = useNavigation<Nav>();

  useEffect(() => {
    loadRoutes();
  }, []);

  return (
    <View style={{ flex: 1 }}>
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <BackButton variant="pill" onPress={() => nav.goBack()} />
        <Text style={styles.title}>Routes</Text>
        <View style={{ minWidth: 60 }} />
      </View>
      <SegmentControl active={tab} onChange={setTab} />
      <View style={{ flex: 1 }}>
        {tab === 'activities' && <ActivitiesTab />}
        {tab === 'routes' && <RoutesTab onGoToActivities={() => setTab('activities')} />}
        {tab === 'flags' && <FlagsTab />}
      </View>
    </SafeAreaView>
    </View>
  );
}

// ── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },
  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: Spacing.base, paddingTop: Spacing.lg, paddingBottom: Spacing.sm,
    backgroundColor: Colors.bg,
  },
  title: { flex: 1, textAlign: 'center', fontSize: FontSize.h3, fontWeight: '700', color: Colors.textPrimary },
  listContent: { padding: Spacing.base, gap: Spacing.sm },
  card: {
    backgroundColor: 'rgba(255,255,255,0.90)', borderRadius: Radius.card,
    flexDirection: 'row', alignItems: 'center', padding: Spacing.base, gap: Spacing.md,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.4)',
    borderLeftWidth: 3, borderLeftColor: 'transparent',
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.08, shadowRadius: 12, elevation: 4,
  },
  cardBadge: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  cardTitle: { fontSize: FontSize.body, fontWeight: '600', color: Colors.textPrimary },
  cardMeta: { fontSize: FontSize.small, color: Colors.textSecondary, marginTop: 2 },
  flagName: { fontSize: FontSize.body, fontWeight: '600', color: Colors.textPrimary },
  distanceText: { fontSize: FontSize.small, fontWeight: '600', color: Colors.textSecondary, marginRight: 2 },
  filterRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingHorizontal: Spacing.base, paddingVertical: Spacing.sm },
  // Two-row filter container — replaces filterRow on FlagsTab where
  // the type chip count + perm toggles + sort can't fit on a single row.
  filterColumn: {
    paddingHorizontal: Spacing.base,
    paddingTop: Spacing.sm,
    paddingBottom: Spacing.xs,
    gap: Spacing.xs,
  },
  filterChipsScroll: { gap: Spacing.xs, paddingRight: Spacing.sm },
  // Row 2: perm toggle group (left) + sort chip (right).
  permRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    gap: Spacing.sm,
  },
  filterChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: Radius.pill, backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border },
  filterChipActive: { backgroundColor: Colors.primaryBg, borderColor: Colors.primary },
  filterChipText: { fontSize: FontSize.small, fontWeight: '600', color: Colors.textSecondary },
  filterChipTextActive: { color: Colors.primary },
  permToggleGroup: { flexDirection: 'row', gap: 2, backgroundColor: Colors.surface, borderRadius: Radius.pill, borderWidth: 1, borderColor: Colors.border, padding: 2 },
  permToggle: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  permToggleActive: { backgroundColor: Colors.primaryBg },
  approxChip: { width: 16, height: 16, borderRadius: 8, backgroundColor: Colors.severityCaution, alignItems: 'center', justifyContent: 'center' },
  approxChipText: { fontSize: 10, fontWeight: '800', color: '#fff' },
  empty: { flex: 1, alignItems: 'center', paddingTop: 80 },
  emptyIconWrap: { width: 72, height: 72, borderRadius: 36, backgroundColor: Colors.surface, alignItems: 'center', justifyContent: 'center', marginBottom: Spacing.md, ...Shadow.card },
  emptyTitle: { fontSize: FontSize.h3, fontWeight: '600', color: Colors.textSecondary },
  emptyHint: { fontSize: FontSize.caption, color: Colors.textMuted, marginTop: 8, textAlign: 'center', paddingHorizontal: Spacing.xl },
  newRouteBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm, paddingVertical: Spacing.md, borderRadius: Radius.card, borderWidth: 2, borderColor: Colors.primary, borderStyle: 'dashed', marginBottom: Spacing.sm },
  newRouteBtnText: { fontSize: FontSize.body, fontWeight: '600', color: Colors.primary },

  // v118: search input row at the top of the Routes list.
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    backgroundColor: Colors.surface,
    borderRadius: Radius.card,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: Spacing.md,
    paddingVertical: 10,
    marginBottom: Spacing.sm,
  },
  searchInput: {
    flex: 1,
    fontSize: FontSize.body,
    color: Colors.textPrimary,
    padding: 0,
  },

  // v118: hero empty-state when there are no routes at all (vs the
  // narrower "no match" message when filter/search hides everything).
  emptyHero: {
    alignItems: 'center',
    paddingTop: 64,
    paddingHorizontal: Spacing.xl,
    gap: Spacing.md,
  },
  emptyHeroIcon: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: Colors.primaryBg,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.sm,
  },
  emptyHeroTitle: {
    fontSize: FontSize.h2,
    fontWeight: '700',
    color: Colors.textPrimary,
    textAlign: 'center',
  },
  emptyHeroBody: {
    fontSize: FontSize.body,
    color: Colors.textSecondary,
    textAlign: 'center',
    lineHeight: 22,
  },
  emptyHeroCta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    backgroundColor: Colors.primary,
    paddingVertical: 12,
    paddingHorizontal: Spacing.xl,
    borderRadius: Radius.button,
    marginTop: Spacing.sm,
  },
  emptyHeroCtaText: {
    color: '#fff',
    fontSize: FontSize.body,
    fontWeight: '700',
  },
});

// ── Sheet Styles (mirrors MapScreen sheet styles exactly) ────────────────────
const sheetStyles = StyleSheet.create({
  // Transparent container — no dark overlay
  container: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'flex-end',
    zIndex: 100,
  },
  sheet: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: Radius.sheet, borderTopRightRadius: Radius.sheet,
    padding: Spacing.xl, paddingBottom: 48, gap: Spacing.md, ...Shadow.overlay,
    borderTopWidth: 1, borderColor: Colors.border,
  },
  handle: { width: 40, height: 4, borderRadius: 2, backgroundColor: Colors.border, alignSelf: 'center', marginBottom: Spacing.xs },

  // Header
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title: { fontSize: FontSize.h3, fontWeight: '700', color: Colors.textPrimary },
  mapBtn: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: Colors.primaryBg, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1.5, borderColor: Colors.primary + '40',
  },
  closeBtn: { width: 32, height: 32, borderRadius: 16, backgroundColor: Colors.bg, alignItems: 'center', justifyContent: 'center' },

  // Type grid — identical to MapScreen
  typeGrid: { flexDirection: 'row', gap: Spacing.sm },
  typeCard: {
    flex: 1, alignItems: 'center', gap: Spacing.xs, paddingVertical: Spacing.sm,
    borderRadius: Radius.card, borderWidth: 1.5, borderColor: Colors.border,
    backgroundColor: Colors.surface, ...Shadow.card,
  },
  typeCardSelected: { borderColor: Colors.primary, backgroundColor: Colors.primaryBg },
  typeIconBadge: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  typeCardLabel: { fontSize: FontSize.small, fontWeight: '700' },
  typeCardCheck: { position: 'absolute', top: 6, right: 6 },

  // Note input — identical to MapScreen
  noteWrap: { position: 'relative' },
  noteInput: {
    backgroundColor: Colors.bg, borderRadius: Radius.button,
    padding: Spacing.md, fontSize: FontSize.body, color: Colors.textPrimary,
    borderWidth: 1.5, borderColor: Colors.border, minHeight: 70, textAlignVertical: 'top',
  },
  noteInputFocused: { borderColor: Colors.primary },
  noteInputError: { borderColor: Colors.danger },
  noteFooterRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 4, paddingHorizontal: 2 },
  noteMaxLabel: { fontSize: FontSize.tiny, color: Colors.textMuted },
  charCount: { fontSize: FontSize.tiny, color: Colors.textMuted },

  // Permission pills — identical to MapScreen
  permRow: { flexDirection: 'row', gap: Spacing.sm },
  permPill: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5,
    borderWidth: 1.5, borderColor: Colors.border, borderRadius: Radius.pill,
    paddingVertical: Spacing.xs, paddingHorizontal: Spacing.sm, backgroundColor: Colors.surface,
  },
  permPillActive: { borderColor: Colors.primary, backgroundColor: Colors.primaryBg },
  permPillLabel: { fontSize: FontSize.small, fontWeight: '600', color: Colors.textSecondary },
  permPillLabelActive: { color: Colors.primary },

  // Actions
  actions: { flexDirection: 'row', gap: Spacing.sm },
  deleteBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: Spacing.md, paddingHorizontal: Spacing.lg,
    borderRadius: Radius.button, borderWidth: 1.5,
    borderColor: Colors.danger + '50', backgroundColor: Colors.dangerBg,
  },
  deleteBtnText: { fontSize: FontSize.body, fontWeight: '600', color: Colors.danger },
  saveBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: Spacing.md, borderRadius: Radius.button, backgroundColor: Colors.primary,
  },
  saveBtnText: { color: '#fff', fontWeight: '700', fontSize: FontSize.body },
});

const routeSheetStyles = StyleSheet.create({
  statsRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: Colors.bg, borderRadius: Radius.card,
    paddingVertical: Spacing.md, paddingHorizontal: Spacing.sm,
    borderWidth: 1, borderColor: Colors.border,
  },
  statItem: { flex: 1, alignItems: 'center', gap: 4 },
  statDivider: { width: 1, height: 28, backgroundColor: Colors.border },
  statValue: { fontSize: FontSize.small, fontWeight: '600', color: Colors.textPrimary, fontVariant: ['tabular-nums'] },
  lastRun: { fontSize: FontSize.caption, color: Colors.textMuted, textAlign: 'center', marginTop: -Spacing.xs },
});

const filterBarStyles = StyleSheet.create({
  row: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.xs,
    paddingHorizontal: Spacing.base, paddingTop: Spacing.xs, paddingBottom: Spacing.sm,
  },
  filtersScroll: {
    gap: Spacing.xs, paddingRight: Spacing.sm,
  },
  chip: {
    paddingHorizontal: 14, paddingVertical: 7,
    borderRadius: Radius.pill,
    backgroundColor: Colors.surface,
    borderWidth: 1, borderColor: Colors.border,
  },
  chipActive: {
    backgroundColor: Colors.primaryBg,
    borderColor: Colors.primary,
  },
  chipText: { fontSize: FontSize.small, fontWeight: '600', color: Colors.textSecondary },
  chipTextActive: { color: Colors.primary, fontWeight: '700' },
  sortChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 10, paddingVertical: 7,
    borderRadius: Radius.pill,
    backgroundColor: Colors.primaryBg,
    borderWidth: 1, borderColor: Colors.primaryMuted,
  },
  sortText: { fontSize: FontSize.small, fontWeight: '700', color: Colors.primary },
  flagSortRow: {
    flexDirection: 'row', justifyContent: 'flex-end',
    paddingHorizontal: Spacing.base, paddingBottom: Spacing.sm,
  },
});

const segStyles = StyleSheet.create({
  container: { flexDirection: 'row', marginHorizontal: Spacing.base, backgroundColor: Colors.surface, borderRadius: Radius.card, padding: 4, borderWidth: 1, borderColor: Colors.border },
  tab: { flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: Radius.card - 2 },
  tabActive: { backgroundColor: Colors.primaryBg, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 6, elevation: 2 },
  tabText: { fontSize: FontSize.small, fontWeight: '600', color: Colors.textMuted },
  tabTextActive: { color: Colors.primary, fontWeight: '700' },
});

const routePreviewStyles = StyleSheet.create({
  mapWrap: {
    height: 180,
    borderRadius: Radius.card,
    overflow: 'hidden',
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  fallback: {
    height: 180,
    borderRadius: Radius.card,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.xs,
  },
  fallbackText: {
    fontSize: FontSize.small,
    color: Colors.textMuted,
  },
});
