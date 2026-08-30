/**
 * RoutesScreen — Three-tab layout: Routes | Activities | Flags
 */
import React, { useState, useRef, useEffect, useMemo } from 'react';
import {
  View, Text, StyleSheet, FlatList, ScrollView, TouchableOpacity, Alert, TextInput,
  KeyboardAvoidingView, Platform, Animated, Easing, Image,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { haptic } from '../services/hapticService';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/RootNavigator';
import { useRouteStore } from '../store/useRouteStore';
import { useSessionStore } from '../store/useSessionStore';
import { useMarkerStore, type Marker, type MarkerPermission } from '../store/useMarkerStore';
// R114 (2026-08-07): splitTitleBody import removed — RoutesScreen no
// longer decodes marker.note directly; MarkCard owns that.
import { useTrackingStore } from '../store/useTrackingStore';
import { Colors, Spacing, Radius, FontSize, Shadow, IconSize } from '../components/tokens';
import { getPrimaryMapStyle, getMapStyleForTheme, themeToStandardPreset, buildStandardConfig } from '../config/mapbox';
import { Icon, type IconName } from '../components/Icon';
import { HikingIcon, RunningIcon } from '../components/ActivityIcons';
import { BackButton } from '../components/BackButton';
import { PressBtn } from '../components/PressBtn';
import { formatDuration, haversineM } from '../utils/geo';
import { useDistance } from '../utils/distanceFormat';
import { type MarkerType } from '../data/mockData';
// R114 (2026-08-07): canonical MarkCard import (post-Metro-restart).
import { MarkCard } from '../features/marks/components/MarkCard';
import { EmptyRoutes, EmptyMarkers, IllustrationHalo } from '../components/Illustrations';
import { useVisualTheme } from '../hooks/useVisualTheme';
import { useMapTheme } from '../hooks/useMapTheme';

// ── Mapbox conditional import (for RouteSheet preview) ────────────────────
// Native-only — on web fallback to a static placeholder.
let MapView: any = null;
let CameraComponent: any = null;
let LineLayer: any = null;
let ShapeSource: any = null;
let StyleImport: any = null;
if (Platform.OS !== 'web') {
  try {
    const Mapbox = require('@rnmapbox/maps');
    MapView = Mapbox.MapView;
    CameraComponent = Mapbox.Camera;
    LineLayer = Mapbox.LineLayer;
    ShapeSource = Mapbox.ShapeSource;
    StyleImport = Mapbox.StyleImport;
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

// ── Segment Control ──────────────────────────────────────────────────────────
function SegmentControl({ active, onChange }: { active: Tab; onChange: (t: Tab) => void }) {
  const theme = useVisualTheme();
  // v119: tab order: Activities first (the source of truth — every walked
  // session lives here), then Routes (curated, derived from Activities),
  // then Flags (place markers). This matches user mental model: "I want
  // to see what I did" → Activities; "I want to plan/redo a route" → Routes.
  const tabs: { id: Tab; label: string }[] = [
    { id: 'activities', label: 'Activities' },
    { id: 'routes', label: 'Routes' },
    { id: 'flags', label: 'Cairns' },
  ];
  return (
    <View style={[segStyles.container, { backgroundColor: theme.surfaceElevated, borderColor: theme.border }]}>
      {tabs.map(t => (
        <TouchableOpacity key={t.id} style={[segStyles.tab, active === t.id && segStyles.tabActive, active === t.id ? { backgroundColor: theme.primary } : null]} onPress={() => onChange(t.id)} activeOpacity={0.8}>
          <Text style={[segStyles.tabText, active === t.id && segStyles.tabTextActive, { color: active === t.id ? theme.onPrimary : theme.foregroundSecondary }]}>{t.label}</Text>
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
  const theme = useVisualTheme();
  const SCOPES: { id: 'mine' | 'friends'; label: string }[] = [
    { id: 'mine', label: 'Mine' },
    { id: 'friends', label: 'Friends' },
  ];
  return (
    <View style={scopeStyles.row} testID="scope-tab-bar">
      {SCOPES.map(s => (
        <TouchableOpacity
          key={s.id}
          style={[scopeStyles.btn, scope === s.id && scopeStyles.btnActive, scope === s.id ? { borderBottomColor: theme.primary } : null]}
          onPress={() => onChange(s.id)}
          activeOpacity={0.7}
          testID={`scope-${s.id}`}
        >
          <Text style={[scopeStyles.text, scope === s.id && scopeStyles.textActive, { color: scope === s.id ? theme.primary : theme.foregroundSecondary }]}>{s.label}</Text>
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
// Concept-aligned (sleep-run-2026-08-15 Routes-1-activities-empty.png):
// a large hero illustration sits above bold title + muted sub-text. When an
// image asset is provided, the halo/svg fallback is skipped.
function EmptyState({
  icon,
  title,
  hint,
  illustration,
  heroImage,
}: {
  icon: IconName;
  title: string;
  hint: string;
  illustration?: React.ReactNode;
  heroImage?: any;
}) {
  const theme = useVisualTheme();
  return (
    <View style={styles.empty}>
      {heroImage && theme.mode === 'day' ? (
        <Image
          source={heroImage}
          style={styles.emptyHeroImage}
          resizeMode="contain"
          accessible={false}
        />
      ) : illustration ? (
        <View style={{ marginBottom: Spacing.md }}>{illustration}</View>
      ) : (
        <View style={styles.emptyIconWrap}>
          <Icon name={icon} size={36} color={theme.iconInactive} strokeWidth={1.5} />
        </View>
      )}
      <Text style={[styles.emptyTitle, { color: theme.foreground }]}>{title}</Text>
      <Text style={[styles.emptyHint, { color: theme.foregroundSecondary }]}>{hint}</Text>
    </View>
  );
}

// ── FilterSortBar ─────────────────────────────────────────────────────────
// Shared header for the three tabs: a single-axis filter chip row +
// a sort-direction chip on the right. Each tab passes its own filters
// and sort options. Pure UI — no data shaping happens here, just
// state callbacks.
//
// Concept-aligned (sleep-run-2026-08-15 trails-scan row-01/row-02):
//   Chips appear as: [All (green filled)] [🚶 Hiking] [🏃 Running] [Recent ▼]
//   - "All" chip when active: solid primary-green fill, white label.
//   - Hiking / Running chips: neutral outline pill, optional inline icon.
//   - Sort chip: neutral outline pill on the right, chevron-down glyph.
function FilterSortBar<F extends string, S extends string>({
  filters,
  filterValue,
  onFilterChange,
  sorts,
  sortValue,
  onSortChange,
}: {
  filters: { id: F; label: string; renderIcon?: (color: string) => React.ReactNode }[];
  filterValue: F;
  onFilterChange: (id: F) => void;
  sorts: { id: S; label: string }[];
  sortValue: S;
  onSortChange: (id: S) => void;
}) {
  const theme = useVisualTheme();
  return (
    <View style={filterBarStyles.row}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={filterBarStyles.filtersScroll}
      >
        {filters.map(f => {
          const isActive = filterValue === f.id;
          // The "All" chip uses a solid primary fill when active to match
          // the concept (row-01 first chip). Other chips use the softer
          // primaryBg tint when active.
          const isAllChip = f.id === ('all' as F);
          const chipStyle = [
            filterBarStyles.chip,
            isActive && (isAllChip ? filterBarStyles.chipActiveSolid : filterBarStyles.chipActive),
          ];
          const textColor = isActive
            ? isAllChip
              ? theme.onPrimary
              : theme.primary
            : theme.foregroundSecondary;
          const iconColor = isActive
            ? isAllChip
              ? theme.onPrimary
              : theme.primary
            : theme.foregroundSecondary;
          return (
            <TouchableOpacity
              key={f.id}
              style={[chipStyle, { backgroundColor: isActive ? (isAllChip ? theme.primary : theme.surfaceElevated) : theme.surface, borderColor: theme.border }]}
              onPress={() => onFilterChange(f.id)}
              activeOpacity={0.7}
            >
              {f.renderIcon ? (
                <View style={filterBarStyles.chipIconWrap}>{f.renderIcon(iconColor)}</View>
              ) : null}
              <Text
                style={[
                  filterBarStyles.chipText,
                  isActive && filterBarStyles.chipTextActive,
                  { color: textColor },
                ]}
              >
                {f.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
      <TouchableOpacity
        style={[filterBarStyles.sortChip, { backgroundColor: theme.surface, borderColor: theme.border }]}
        onPress={() => {
          // cycle to next sort option
          const idx = sorts.findIndex(s => s.id === sortValue);
          const next = sorts[(idx + 1) % sorts.length];
          onSortChange(next.id);
        }}
        activeOpacity={0.7}
      >
        <Text style={[filterBarStyles.sortText, { color: theme.foregroundSecondary }]}>{sorts.find(s => s.id === sortValue)?.label}</Text>
        <Icon name="ChevronDown" size={12} color={theme.iconInactive} strokeWidth={2} />
      </TouchableOpacity>
    </View>
  );
}

// ── RouteSheet ────────────────────────────────────────────────────────────────
// ── Route map preview (renders polyline of route.points) ───────────────────
function RouteMapPreview({ points }: { points: { lat: number; lng: number }[] }) {
  const routeMapTheme = useMapTheme();
  const routeResolvedMapStyle = getMapStyleForTheme('outdoors', routeMapTheme);
  const routeLightPreset = themeToStandardPreset(routeMapTheme);
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
        {...(routeResolvedMapStyle.kind === 'url'
          ? { styleURL: routeResolvedMapStyle.url }
          : { styleJSON: routeResolvedMapStyle.json })}
        logoEnabled={false}
        attributionEnabled={false}
        compassEnabled={false}
        scaleBarEnabled={false}
        scrollEnabled={false}
        zoomEnabled={false}
        rotateEnabled={false}
        pitchEnabled={false}
      >
        {/* R21-v3 v2 (2026-08-30): Standard style lightPreset. */}
        {StyleImport ? (
          <StyleImport
            key={routeLightPreset}
            id="basemap"
            existing
            config={buildStandardConfig(routeMapTheme) as any}
          />
        ) : null}
        {CameraComponent && (
          <CameraComponent
            bounds={{ ne: bounds.ne, sw: bounds.sw, paddingTop: 24, paddingBottom: 24, paddingLeft: 24, paddingRight: 24 }}
            pitch={0}
            maxZoomLevel={16}
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
  // O12: settings-aware distance format.
  const dist = useDistance();
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
            <Text style={routeSheetStyles.statValue}>{dist.format(data.distanceM, 1)} {dist.unit}</Text>
          </View>
          <View style={routeSheetStyles.statDivider} />
          <View style={routeSheetStyles.statItem}>
            <Icon name="TrendingUp" size={14} color={Colors.primary} strokeWidth={2} />
            <Text style={routeSheetStyles.statValue}>{dist.formatElevation(data.elevationGainM)} {dist.elevUnit}</Text>
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
  // O12: settings-aware distance format.
  const dist = useDistance();
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
            <Text style={[routeSheetStyles.statValue, { color: accent }]}>{dist.format(data.distanceM, 1)} {dist.unit}</Text>
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
  const theme = useVisualTheme();
  const routes = useRouteStore(s => s.routes);
  const deleteRoute = useRouteStore(s => s.deleteRoute);
  // O12 Round-3 R3-C1: settings-aware distance format for route list.
  const dist = useDistance();
  // Sprint 69 STORY-00538: circle routes slice + loader.
  const circleRoutes = useRouteStore(s => s.circleRoutes);
  const loadingCircleRoutes = useRouteStore(s => s.loadingCircleRoutes);
  const loadCircleRoutes = useRouteStore(s => s.loadCircleRoutes);
  const [selectedRoute, setSelectedRoute] = useState<import('../store/useRouteStore').Route | null>(null);
  // Filter + sort state — local-only, resets if user leaves the tab.
  const [filter, setFilter] = useState<'all' | 'hiking' | 'running'>('all');
  const [sort, setSort] = useState<'recent' | 'distance-desc' | 'distance-asc'>('recent');
  // O18 ROUTE-07: text search over route name.
  const [routeSearch, setRouteSearch] = useState('');
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
    // O18 ROUTE-07: apply free-text search on route name.
    const q = routeSearch.trim().toLowerCase();
    if (q) list = list.filter(r => (r.name ?? '').toLowerCase().includes(q));
    if (sort === 'recent') {
      list = [...list].sort((a, b) => b.updatedAt - a.updatedAt);
    } else if (sort === 'distance-desc') {
      list = [...list].sort((a, b) => b.distanceM - a.distanceM);
    } else {
      list = [...list].sort((a, b) => a.distanceM - b.distanceM);
    }
    return list;
  }, [routes, circleRoutes, scope, filter, sort, routeSearch]);

  return (
    <View style={{ flex: 1 }}>
      {/* Sprint 69 STORY-00538: Mine|Friends scope sub-tab. */}
      <ScopeTabBar scope={scope} onChange={setScope} />
      {/* v376 fix: empty hero takes the place of the list when there is
          no data — FilterSortBar must NOT render when there's nothing to
          filter (用户 v375 反馈: filter 不应该在没有数据时出现)。 */}
      {scope === 'mine' && routes.length === 0 ? (
        <View style={styles.emptyHero}>
          {/* Concept-aligned circle icon: soft neutral fill, thin route glyph */}
          <View style={[styles.emptyHeroIcon, { backgroundColor: theme.surfaceElevated, borderColor: theme.border }]}>
            <Icon name="Route" size={32} color={theme.iconActive} strokeWidth={1.8} />
          </View>
          <Text style={[styles.emptyHeroTitle, { color: theme.foreground }]}>No saved routes yet</Text>
          <Text style={[styles.emptyHeroBody, { color: theme.foregroundSecondary }]}>
            Routes are paths you've already walked.{'\n'}
            Open an Activity, tap{' '}
            <Text style={[styles.emptyHeroBodyStrong, { color: theme.primary }]}>Save as Route</Text>
            , and it'll show up here.
          </Text>
          <TouchableOpacity
            style={[styles.emptyHeroCta, { backgroundColor: theme.primary }]}
            activeOpacity={0.85}
            onPress={() => onGoToActivities?.()}
          >
            <Icon name="Map" size={16} color={theme.onPrimary} strokeWidth={2} />
            <Text style={[styles.emptyHeroCtaText, { color: theme.onPrimary }]}>View Activities</Text>
          </TouchableOpacity>
        </View>
      ) : null}
      {scope === 'friends' && !hasFetchedFriends && circleRoutes.length === 0 ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={[styles.emptyHint, { color: theme.foregroundSecondary }]}>Loading friends' routes…</Text>
        </View>
      ) : null}
      {scope === 'friends' && hasFetchedFriends && circleRoutes.length === 0 ? (
        <View style={styles.emptyHero}>
          {/* 2026-08-16 T-C01: mountain-hero watercolor per concept row-03 col 4 */}
          <Image
            source={require('../../assets/routes/mountain-hero.png')}
            style={styles.emptyHeroImage}
            resizeMode="contain"
          />
          <Text style={[styles.emptyHeroTitle, { color: theme.foreground }]}>No routes from friends yet</Text>
          <Text style={[styles.emptyHeroBody, { color: theme.foregroundSecondary }]}>
            When your friends share routes,{'\n'}
            they'll appear here.
          </Text>
        </View>
      ) : null}
      {((scope === 'mine' && routes.length > 0) || (scope === 'friends' && circleRoutes.length > 0)) && (
        <>
      {/* O18 ROUTE-07: text search over route name. */}
      <View style={[styles.searchWrap, { backgroundColor: theme.surface, borderColor: theme.border }]}>
        <Icon name="Search" size={16} color={theme.iconInactive} strokeWidth={2} />
        <TextInput
          style={[styles.searchInput, { color: theme.foreground }]}
          value={routeSearch}
          onChangeText={setRouteSearch}
          placeholder="Search routes by name…"
          placeholderTextColor={theme.muted}
          autoCorrect={false}
          autoCapitalize="none"
          clearButtonMode="while-editing"
          accessibilityLabel="Search routes"
        />
      </View>
      <FilterSortBar
        filters={[
          { id: 'all', label: 'All' },
          {
            id: 'hiking',
            label: 'Hiking',
            renderIcon: (color) => <HikingIcon size={14} color={color} />,
          },
          {
            id: 'running',
            label: 'Running',
            renderIcon: (color) => <RunningIcon size={14} color={color} />,
          },
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
        contentContainerStyle={styles.routeListContent}
        /* v124 fix #8: search field removed — typical route counts are
           low enough that filter chips + sort are sufficient. New Route
           button is also gone (per route-rules.md §2.3 manual drawing
           is forbidden). The list now starts straight at the cards. */
        ListEmptyComponent={
          /* v376: routes.length===0 已在外层提前 return,这里只剩
             "filter 把所有数据筛掉"的场景。 */
          <View style={{ alignItems: 'center', paddingTop: 40 }}>
            <Text style={[styles.emptyHint, { color: theme.foregroundSecondary }]}>
              {'No routes match this filter.'}
            </Text>
          </View>
        }
        renderItem={({ item }) => (
          <PressBtn
            style={[styles.routeRow, { borderBottomColor: theme.border }]}
            onPress={() => nav.navigate('MapHistory', { routeId: item.id })}
            onLongPress={() => setSelectedRoute(item)}
            scaleTo={0.97}
          >
            {/* Concept crops/03-routes-mine.png: soft-fill circle with deep-green
                route glyph — replaced the cairn-stack raster which mismatched
                the reference. */}
            <View style={[styles.routeIconWrap, { backgroundColor: theme.surfaceElevated }]}>
              <Icon name="Route" size={18} color={theme.iconActive} strokeWidth={2} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.routeTitle, { color: theme.foreground }]} numberOfLines={1}>{item.name}</Text>
              <Text style={[styles.routeMeta, { color: theme.foregroundSecondary }]} numberOfLines={1}>
                {dist.format(item.distanceM, 1)} {dist.unit}
                {item.elevationGainM ? ` · +${dist.formatElevation(item.elevationGainM)}${dist.elevUnit}` : ''}
              </Text>
            </View>
            <Icon name="ChevronRight" size={16} color={theme.iconInactive} strokeWidth={2} />
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
  const theme = useVisualTheme();
  const sessions = useSessionStore(s => s.sessions);
  const [selectedSession, setSelectedSession] = useState<import('../store/useSessionStore').TrackingSession | null>(null);
  const [filter, setFilter] = useState<'all' | 'hiking' | 'running'>('all');
  const [sort, setSort] = useState<'recent' | 'distance-desc' | 'duration-desc'>('recent');
  // v261 PO direction: tap → direct to MapHistory detail (long-press still
  // opens the action sheet for power users). The pre-v261 behavior had been
  // changed once before but the fix never made it into a commit, so it
  // regressed. This time it's persisted via git.
  const nav = useNavigation<Nav>();
  // O12: settings-aware distance format.
  const dist = useDistance();

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
    return (
      <EmptyState
        icon="Map"
        title="No tracks walked yet"
        hint="Start hiking or running. Your tracks will live here."
        heroImage={require('../../assets/routes/mountain-hero.png')}
      />
    );
  }

  return (
    <View style={{ flex: 1 }}>
      <FilterSortBar
        filters={[
          { id: 'all', label: 'All' },
          {
            id: 'hiking',
            label: 'Hiking',
            renderIcon: (color) => <HikingIcon size={14} color={color} />,
          },
          {
            id: 'running',
            label: 'Running',
            renderIcon: (color) => <RunningIcon size={14} color={color} />,
          },
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
        contentContainerStyle={styles.activityListContent}
        ListEmptyComponent={
          <View style={{ alignItems: 'center', paddingTop: 40 }}>
            <Text style={[styles.emptyHint, { color: theme.foregroundSecondary }]}>No activities match this filter.</Text>
          </View>
        }
        renderItem={({ item }) => {
          const isRun = item.activityMode === 'running';
          const accent = isRun ? theme.accent : theme.iconActive;
          const bg = isRun ? Colors.runningLight : Colors.primaryLight;
          const date = new Date(item.startedAt);
          const dateStr = `${date.getDate()}/${date.getMonth() + 1}/${date.getFullYear()}`;
          return (
            <PressBtn
              style={[styles.activityRow, { borderBottomColor: theme.border }]}
              onPress={() => nav.navigate('MapHistory', { sessionId: item.id })}
              onLongPress={() => setSelectedSession(item)}
              scaleTo={0.97}
            >
              {/* Concept crops/01-activities-list.png: bare walker/runner glyph
                  in deep green, no tinted bg, no badge — single-line dense row. */}
              <View style={styles.activityIconWrap}>
                {isRun
                  ? <RunningIcon size={20} color={accent} />
                  : <HikingIcon size={20} color={accent} />
                }
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.activityTitle, { color: theme.foreground }]} numberOfLines={1}>{item.name || (isRun ? 'Run' : 'Hike')}</Text>
                <Text style={[styles.activityMeta, { color: theme.foregroundSecondary }]} numberOfLines={1}>
                  {dateStr} · {dist.format(item.distanceM, 1)} {dist.unit} · {formatDuration(item.durationS)}
                </Text>
              </View>
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


// ── Flags Tab ────────────────────────────────────────────────────────────────
const PERM_FILTERS: { id: MarkerPermission | 'all'; icon: IconName }[] = [
  { id: 'personal', icon: 'Lock' },
  { id: 'group',    icon: 'Users' },
  { id: 'public',   icon: 'Globe' },
];

// R114 (2026-08-07): MarkCard is imported from features/marks/components/MarkCard
// — the canonical single-source-of-truth. Inline duplicate removed after
// Metro restart. Design ref: docs/design/r114-mark-redesign.md §9.

function FlagsTab() {
  const theme = useVisualTheme();
  const markers = useMarkerStore(s => s.markers);
  // Sprint 69 STORY-00537: circle markers slice + loader.
  const circleMarkers = useMarkerStore(s => s.circleMarkers);
  const loadingCircle = useMarkerStore(s => s.loadingCircle);
  const loadCircleMarkers = useMarkerStore(s => s.loadCircleMarkers);
  const lastCoord = useTrackingStore(s => s.lastCoordinate);
  // O12 Round-3 R3-C1: settings-aware short distance for marker list. Note:
  // renamed from local `dist` shadow — the `const dist = (m) => ...` on
  // line ~1032 has been renamed to `distComparator` to avoid clashing.
  const userUnit = useDistance();
  const [typeFilter, setTypeFilter] = useState<MarkerType | 'all'>('all');
  const [permFilter, setPermFilter] = useState<MarkerPermission | 'all'>('all');
  const [sort, setSort] = useState<'recent' | 'nearest'>('recent');
  // Sprint 69 STORY-00537: Mine|Friends scope sub-tab. Mine = own marks,
  // Friends = subscribed-friend marks via /api/circle/markers.
  const [scope, setScope] = useState<'mine' | 'friends'>('mine');
  // v375 STORY-00537: track whether the first Friends fetch has settled
  // — same flicker-prevention pattern as RoutesTab.
  const [hasFetchedFriends, setHasFetchedFriends] = useState(false);
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
    // O12 Round-3 R3-C1: renamed from `dist` to avoid shadow with the
    // useDistance() hook at FlagsTab scope.
    const distComparator = (m: Marker) => {
      const dx = (m.lng - lastCoord.lng) * Math.cos((m.lat * Math.PI) / 180);
      const dy = m.lat - lastCoord.lat;
      return dx * dx + dy * dy; // squared euclidean is enough for ordering
    };
    return [...filtered].sort((a, b) => distComparator(a) - distComparator(b));
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
          <Text style={[styles.emptyHeroTitle, { color: theme.foreground }]}>No cairns planted yet</Text>
          <Text style={[styles.emptyHeroBody, { color: theme.foregroundSecondary }]}>
            Leave a mark when you find something worth noting —{'\n'}
            a viewpoint, a junction, a hut.
          </Text>
          <TouchableOpacity
            style={[styles.emptyHeroCta, { backgroundColor: theme.primary }]}
            activeOpacity={0.85}
            onPress={() => nav.navigate('Plant')}
            testID="flags-mine-empty-plant-cta"
          >
            <Icon name="Plus" size={16} color={theme.onPrimary} strokeWidth={2} />
            <Text style={[styles.emptyHeroCtaText, { color: theme.onPrimary }]}>Plant a new mark</Text>
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
          <Text style={[styles.emptyHint, { color: theme.foregroundSecondary }]}>Loading friends' marks…</Text>
        </View>
      ) : null}
      {scope === 'friends' && hasFetchedFriends && circleMarkers.length === 0 ? (
        <View style={styles.emptyHero}>
          <View style={{ marginBottom: Spacing.md }}>
            <IllustrationHalo>
              <EmptyMarkers size={192} />
            </IllustrationHalo>
          </View>
          <Text style={[styles.emptyHeroTitle, { color: theme.foreground }]}>No marks from your friends yet</Text>
          <Text style={[styles.emptyHeroBody, { color: theme.foregroundSecondary }]}>
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
            <TouchableOpacity
              key={f.id}
              style={[
                styles.filterChip,
                { backgroundColor: theme.surface, borderColor: theme.border },
                typeFilter === f.id && { backgroundColor: theme.surfaceElevated, borderColor: theme.primary },
              ]}
              onPress={() => setTypeFilter(f.id)}
            >
              <Text style={[styles.filterChipText, { color: typeFilter === f.id ? theme.primary : theme.foregroundSecondary }, typeFilter === f.id && styles.filterChipTextActive]}>{f.label}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
        <View style={styles.permRow}>
          <View style={[styles.permToggleGroup, { backgroundColor: theme.surface, borderColor: theme.border }]}>
            {PERM_FILTERS.map(p => {
              const active = permFilter === p.id;
              return (
                <TouchableOpacity
                  key={p.id}
                  style={[styles.permToggle, active && { backgroundColor: theme.surfaceElevated }]}
                  onPress={() => setPermFilter(active ? 'all' : p.id)}
                >
                  <Icon name={p.icon} size={13} color={active ? theme.primary : theme.iconInactive} strokeWidth={active ? 2.5 : 1.8} />
                </TouchableOpacity>
              );
            })}
          </View>
          {/* Sort chip moved into the same row as perm toggles to keep
              vertical compactness — was on its own third row before. */}
          <TouchableOpacity
            style={[filterBarStyles.sortChip, { backgroundColor: theme.surface, borderColor: theme.border }]}
            onPress={() => setSort(sort === 'recent' ? 'nearest' : 'recent')}
            activeOpacity={0.7}
          >
            <Icon name="ArrowUpDown" size={12} color={theme.primary} strokeWidth={2} />
            <Text style={[filterBarStyles.sortText, { color: theme.foregroundSecondary }]}>{sort === 'recent' ? 'Recent' : 'Nearest'}</Text>
          </TouchableOpacity>
        </View>
      </View>

      <FlatList
        data={sorted}
        keyExtractor={m => m.id}
        contentContainerStyle={styles.listContent}
        renderItem={({ item }) => {
          // R114 (2026-08-07): renderItem delegates to MarkCard so the
          // list card has one canonical implementation. splitTitleBody
          // + type badge + note preview + perm icon all live in MarkCard.
          let distanceStr = '';
          if (lastCoord) {
            const distM = haversineM({ lat: lastCoord.lat, lng: lastCoord.lng }, { lat: item.lat, lng: item.lng });
            distanceStr = userUnit.formatShort(distM);
          }
          return (
            <MarkCard
              marker={item}
              distance={distanceStr}
              onPress={() => nav.navigate('MarkerDetail', { markerId: item.id })}
            />
          );
        }}
        ListEmptyComponent={<View style={{ padding: Spacing.xl, alignItems: 'center' }}><Text style={[styles.emptyHint, { color: theme.foregroundSecondary }]}>No matching cairns. Try a different filter.</Text></View>}
      />
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
  const loadCircleRoutes = useRouteStore(s => s.loadCircleRoutes);
  const loadCircleMarkers = useMarkerStore(s => s.loadCircleMarkers);
  const nav = useNavigation<Nav>();
  // R21 (2026-08-17): dark mode support — swap paper cream bg + deep-green
  // text for slate bg + cream text when isDark. Uses inline overrides on the
  // main container + title; list items already use tokens that read okay on
  // both variants (deep glyphs on light-neutral row backgrounds).
  const theme = useVisualTheme();
  // O18 HOME-03: manual refresh state — spins the icon during network work,
  // avoids duplicate concurrent calls, and gives users a way to re-check
  // when they know they should have new data (friend just shared).
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    loadRoutes();
  }, []);

  const handleRefresh = async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      if (tab === 'routes') {
        await Promise.all([loadRoutes(), loadCircleRoutes().catch(() => {})]);
      } else if (tab === 'flags') {
        await loadCircleMarkers().catch(() => {});
      }
      // Activities tab has no server refresh — sessions are local + auto-sync.
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
    <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]} edges={['top']}>
      <View style={[styles.header, { backgroundColor: theme.background }]}>
        <BackButton variant="inline" onPress={() => nav.goBack()} />
        <Text style={[styles.title, { color: theme.foreground }]}>Trails</Text>
        {/* O18 HOME-03: manual refresh — visible on Routes / Cairns tabs
            (Activities uses local sessions, no server refresh). */}
        {tab !== 'activities' ? (
          <TouchableOpacity
            onPress={handleRefresh}
            disabled={refreshing}
            style={{ minWidth: 60, alignItems: 'flex-end', paddingRight: Spacing.base }}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            accessibilityRole="button"
            accessibilityLabel="Refresh"
          >
            <Icon
              name="RotateCcw"
              size={IconSize.sm}
              color={refreshing ? theme.iconInactive : theme.iconActive}
              strokeWidth={2}
            />
          </TouchableOpacity>
        ) : (
          <View style={{ minWidth: 60 }} />
        )}
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
  // O18 ROUTE-07: routes search box (same pattern as MapHistory search).
  searchWrap: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.xs,
    marginHorizontal: Spacing.base,
    marginTop: Spacing.xs,
    marginBottom: Spacing.sm,
    backgroundColor: 'rgba(0,0,0,0.04)',
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 6,
  },
  searchInput: {
    flex: 1,
    fontSize: FontSize.body,
    color: Colors.textPrimary,
    paddingVertical: 4,
  },
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
  // Concept crops/01-activities-list.png — dense single-line row with
  // hairline divider between items (no card, no left color-bar, no badge bg).
  activityListContent: {
    paddingHorizontal: Spacing.base,
    paddingTop: Spacing.xs,
    paddingBottom: Spacing.xl,
  },
  activityRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 12, gap: Spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.border,
  },
  activityIconWrap: {
    width: 28, alignItems: 'center', justifyContent: 'center',
  },
  activityTitle: {
    fontSize: FontSize.body, fontWeight: '700', color: Colors.textPrimary,
  },
  activityMeta: {
    fontSize: FontSize.small, color: Colors.textSecondary, marginTop: 2,
  },
  // Concept crops/03-routes-mine.png — soft-fill circle + deep-green route
  // glyph, roomier padding than activities so the row breathes.
  routeListContent: {
    paddingHorizontal: Spacing.base,
    paddingTop: Spacing.xs,
    paddingBottom: Spacing.xl,
    gap: Spacing.xs,
  },
  routeRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 14, paddingHorizontal: Spacing.sm,
    gap: Spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.border,
  },
  routeIconWrap: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: 'rgba(93,124,70,0.10)',
    alignItems: 'center', justifyContent: 'center',
    flexShrink: 0,
  },
  routeTitle: {
    fontSize: FontSize.body, fontWeight: '700', color: Colors.textPrimary,
  },
  routeMeta: {
    fontSize: FontSize.small, color: Colors.textSecondary, marginTop: 2,
  },
  distanceText: { fontSize: FontSize.small, fontWeight: '600', color: Colors.textSecondary, marginRight: 2 },
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
  empty: { flex: 1, alignItems: 'center', paddingTop: 96, paddingHorizontal: Spacing.xl },
  emptyIconWrap: { width: 72, height: 72, borderRadius: 36, backgroundColor: Colors.surface, alignItems: 'center', justifyContent: 'center', marginBottom: Spacing.md, ...Shadow.card },
  // Concept hero illustration (mountain scene). Width matches the empty state
  // frame; height is intrinsic-locked via aspect ratio so the artwork keeps
  // its balance across viewports.
  emptyHeroImage: {
    width: 260,
    height: 150,
    marginBottom: Spacing.xl,
  },
  emptyTitle: {
    fontSize: FontSize.h3,
    fontWeight: '700',
    color: Colors.textPrimary,
    textAlign: 'center',
  },
  emptyHint: {
    fontSize: FontSize.caption,
    color: Colors.textSecondary,
    marginTop: 8,
    textAlign: 'center',
    paddingHorizontal: Spacing.xl,
    lineHeight: 20,
  },
  // v118: hero empty-state when there are no routes at all (vs the
  // narrower "no match" message when filter/search hides everything).
  // Concept-aligned (Routes-2-routes-empty.png): tighter vertical rhythm
  // and a soft neutral circle instead of primary-tinted disc.
  emptyHero: {
    alignItems: 'center',
    paddingTop: 96,
    paddingHorizontal: Spacing.xl,
    gap: Spacing.sm,
  },
  emptyHeroIcon: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: 'rgba(93,124,70,0.10)',
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.md,
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
    marginTop: 4,
  },
  emptyHeroBodyStrong: {
    fontWeight: '700',
    color: Colors.primary,
  },
  emptyHeroCta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    backgroundColor: Colors.primary,
    paddingVertical: 12,
    paddingHorizontal: Spacing.xl,
    borderRadius: Radius.pill,
    marginTop: Spacing.lg,
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
    alignItems: 'center',
  },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 14, paddingVertical: 7,
    borderRadius: Radius.pill,
    backgroundColor: Colors.surface,
    borderWidth: 1, borderColor: Colors.border,
  },
  chipIconWrap: {
    alignItems: 'center', justifyContent: 'center',
  },
  chipActive: {
    backgroundColor: Colors.primaryBg,
    borderColor: Colors.primary,
  },
  // Concept row-01: the "All" chip when active is a solid primary-green
  // pill with white label (higher visual weight than Hiking/Running).
  chipActiveSolid: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  chipText: { fontSize: FontSize.small, fontWeight: '600', color: Colors.textSecondary },
  chipTextActive: { fontWeight: '700' },
  // Concept row-01: "Recent ▼" sits as a neutral outline pill (matches the
  // Hiking/Running chip visual weight) rather than the previous primary-
  // tinted look. Chevron-down on the right hints at the dropdown affordance.
  sortChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 12, paddingVertical: 7,
    borderRadius: Radius.pill,
    backgroundColor: Colors.surface,
    borderWidth: 1, borderColor: Colors.border,
  },
  sortText: { fontSize: FontSize.small, fontWeight: '600', color: Colors.textSecondary },
  flagSortRow: {
    flexDirection: 'row', justifyContent: 'flex-end',
    paddingHorizontal: Spacing.base, paddingBottom: Spacing.sm,
  },
});

// Concept-aligned pill-shaped segmented control (sleep-run-2026-08-15 Routes).
// Container is a rounded 20-radius pill with a subtle border; the active tab
// gets a soft primary-tinted fill and forest-green bold label.
const segStyles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    marginHorizontal: Spacing.base,
    marginTop: Spacing.xs,
    // 2026-08-16 concept: deeper paper #E6E2D6 container (was translucent white)
    backgroundColor: '#E6E2D6',
    borderRadius: 20,
    padding: 4,
    borderWidth: 0,
    height: 40,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 6,
    borderRadius: 16,
  },
  tabActive: {
    // 2026-08-16 concept: solid deep green (#3E5F3A) fill + white label
    backgroundColor: '#3E5F3A',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.10,
    shadowRadius: 4,
    elevation: 2,
  },
  tabText: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.textSecondary,
    letterSpacing: 0.1,
  },
  tabTextActive: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
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
