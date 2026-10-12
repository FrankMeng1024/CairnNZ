/**
 * Trails — Cairn's personal journey library.
 *
 * Activities are past movement. Routes are independent paths the user may
 * want to use again. Cairns remain owned by Memory / Activity / Cairn Detail,
 * and unresolved friend discovery is intentionally not surfaced here.
 */
import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  ScrollView,
  SectionList,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { RootStackParamList } from '../navigation/RootNavigator';
import { useSessionStore, type TrackingSession } from '../store/useSessionStore';
import { useRouteStore, type Route } from '../store/useRouteStore';
import { BackButton } from '../components/BackButton';
import { HikingIcon, RunningIcon } from '../components/ActivityIcons';
import { Icon } from '../components/Icon';
import { PressBtn } from '../components/PressBtn';
import { PrimaryButton } from '../components/PrimaryButton';
import { SegmentedControl } from '../components/SegmentedControl';
import { SyncBadge } from '../components/SyncBadge';
import { ModalCard, ModalCardHeader } from '../components/ModalCard';
import { FontSize, IconSize, RadiusRole, Spacing } from '../components/tokens';
import { useVisualTheme } from '../hooks/useVisualTheme';
import { useDistance } from '../utils/distanceFormat';
import { formatDuration } from '../utils/geo';
import {
  ACTIVITY_DISCOVERY_THRESHOLD,
  activityDateLabel,
  activityDisplayName,
  filterActivities,
  filterRoutes,
  groupActivitiesByMonth,
  hasActivitySyncIssue,
  hasRouteSyncIssue,
  routeModeLabel,
  type ActivityModeFilter,
  type TrailsTab,
} from '../features/trails/trailsLibrary';

type Nav = NativeStackNavigationProp<RootStackParamList>;

const TABS = [
  { key: 'activities', label: 'Activities' },
  { key: 'routes', label: 'Routes' },
] as const;

function SearchField({
  value,
  onChange,
  placeholder,
  label,
  testID,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  label: string;
  testID: string;
}) {
  const theme = useVisualTheme();
  return (
    <View style={[styles.searchField, { backgroundColor: theme.inputSurface, borderColor: theme.borderSubtle }]}>
      <Icon name="Search" size={16} color={theme.iconInactive} strokeWidth={2} />
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={theme.textMuted}
        style={[styles.searchInput, { color: theme.textPrimary }]}
        accessibilityLabel={label}
        autoCorrect={false}
        returnKeyType="search"
        clearButtonMode="while-editing"
        testID={testID}
      />
      {value.length > 0 ? (
        <TouchableOpacity
          onPress={() => onChange('')}
          accessibilityRole="button"
          accessibilityLabel={`Clear ${label.toLocaleLowerCase()}`}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Icon name="X" size={15} color={theme.iconInactive} strokeWidth={2} />
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

function ActivityModeControl({ value, onChange }: { value: ActivityModeFilter; onChange: (value: ActivityModeFilter) => void }) {
  const theme = useVisualTheme();
  const items: Array<{ key: ActivityModeFilter; label: string }> = [
    { key: 'all', label: 'All' },
    { key: 'hiking', label: 'Hikes' },
    { key: 'running', label: 'Runs' },
  ];
  return (
    <View style={styles.modeControl} accessibilityRole="tablist" testID="activity-mode-filter">
      {items.map(item => {
        const selected = item.key === value;
        return (
          <TouchableOpacity
            key={item.key}
            style={[
              styles.modeOption,
              { borderColor: selected ? theme.borderStrong : theme.borderSubtle },
              selected && { backgroundColor: theme.controlSelected },
            ]}
            onPress={() => onChange(item.key)}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
          >
            <Text style={[styles.modeOptionText, { color: selected ? theme.tabActive : theme.tabInactive }]}>{item.label}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

function LibraryIntro({ tab, count }: { tab: TrailsTab; count: number }) {
  const theme = useVisualTheme();
  const noun = tab === 'activities' ? (count === 1 ? 'activity' : 'activities') : (count === 1 ? 'route' : 'routes');
  return (
    <View style={styles.libraryIntro}>
      <Text style={[styles.libraryEyebrow, { color: theme.textMuted }]}>
        {tab === 'activities' ? 'WHAT YOU HAVE DONE' : 'WHAT YOU MAY WANT TO REPEAT'}
      </Text>
      <Text style={[styles.libraryCount, { color: theme.textSecondary }]}>{count} {noun}</Text>
    </View>
  );
}

function EmptyLibraryState({
  kind,
  onPrimary,
  onSecondary,
}: {
  kind: TrailsTab;
  onPrimary: () => void;
  onSecondary?: () => void;
}) {
  const theme = useVisualTheme();
  const isActivities = kind === 'activities';
  return (
    <View style={styles.emptyState} testID={`trails-${kind}-empty`}>
      <View style={[styles.emptyTrace, { backgroundColor: theme.recordSurface, borderColor: theme.borderSubtle }]}>
        <Icon name={isActivities ? 'Map' : 'Route'} size={IconSize.lg} color={theme.iconActive} strokeWidth={1.8} />
      </View>
      <Text style={[styles.emptyTitle, { color: theme.textPrimary }]}>
        {isActivities ? 'Your first journey starts outside' : 'No routes saved yet'}
      </Text>
      <Text style={[styles.emptyBody, { color: theme.textSecondary }]}>
        {isActivities
          ? 'Record a Hike or Run. When you finish, the journey will be waiting here.'
          : 'Create a plan from an empty map, or import an Activity as an independent editable Route.'}
      </Text>
      <View style={styles.emptyActions}>
        <PrimaryButton
          label={isActivities ? 'Start a Hike' : 'Create Route'}
          onPress={onPrimary}
          renderIcon={color => <Icon name={isActivities ? 'Navigation' : 'Map'} size={17} color={color} strokeWidth={2} />}
          style={styles.emptyPrimary}
          testID={`trails-${kind}-primary-action`}
        />
        {isActivities && onSecondary ? (
          <TouchableOpacity
            style={styles.emptySecondary}
            onPress={onSecondary}
            accessibilityRole="button"
          >
            <RunningIcon size={16} color={theme.iconActive} />
            <Text style={[styles.emptySecondaryText, { color: theme.primary }]}>Start a Run</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    </View>
  );
}

function NoResults({ kind, onClear }: { kind: TrailsTab; onClear: () => void }) {
  const theme = useVisualTheme();
  return (
    <View style={styles.noResults} testID={`trails-${kind}-no-results`}>
      <Icon name="Search" size={22} color={theme.iconInactive} strokeWidth={1.8} />
      <Text style={[styles.noResultsTitle, { color: theme.textPrimary }]}>No matching {kind}</Text>
      <Text style={[styles.noResultsBody, { color: theme.textSecondary }]}>Try another name or clear the filter.</Text>
      <TouchableOpacity onPress={onClear} accessibilityRole="button">
        <Text style={[styles.clearText, { color: theme.primary }]}>Clear search and filters</Text>
      </TouchableOpacity>
    </View>
  );
}

function ActivityRecord({ session, onOpen, onRetry }: { session: TrackingSession; onOpen: () => void; onRetry: () => void }) {
  const theme = useVisualTheme();
  const dist = useDistance();
  const isRun = session.activityMode === 'running';
  return (
    <View style={[styles.recordRow, { backgroundColor: theme.recordSurface, borderColor: theme.borderSubtle }]}>
      <PressBtn
        style={styles.recordTap}
        onPress={onOpen}
        accessibilityLabel={`${isRun ? 'Run' : 'Hike'}: ${activityDisplayName(session)}`}
        accessibilityHint="Opens Activity Detail"
        testID={`activity-record-${session.id}`}
      >
        <View style={styles.recordIcon}>
          {isRun
            ? <RunningIcon size={21} color={theme.iconActive} />
            : <HikingIcon size={21} color={theme.iconActive} />}
        </View>
        <View style={styles.recordContent}>
          <View style={styles.recordTitleRow}>
            <Text style={[styles.recordTitle, { color: theme.textPrimary }]} numberOfLines={1}>{activityDisplayName(session)}</Text>
            <Text style={[styles.objectKind, { color: theme.textMuted }]}>{isRun ? 'RUN' : 'HIKE'}</Text>
          </View>
          <Text style={[styles.recordMeta, { color: theme.textSecondary }]} numberOfLines={1}>
            {activityDateLabel(session.startedAt)} · {dist.format(session.distanceM, 1)} {dist.unit} · {formatDuration(session.durationS)}
            {session.elevationGainM > 0 ? ` · +${dist.formatElevation(session.elevationGainM)}${dist.elevUnit}` : ''}
          </Text>
        </View>
        <Icon name="ChevronRight" size={16} color={theme.iconInactive} strokeWidth={2} />
      </PressBtn>
      {hasActivitySyncIssue(session) ? (
        <View style={styles.exceptionRow}>
          <SyncBadge state="failed" onPress={onRetry} />
        </View>
      ) : null}
    </View>
  );
}

function RouteRecord({ route, onOpen, onRetry }: { route: Route; onOpen: () => void; onRetry: () => void }) {
  const theme = useVisualTheme();
  const dist = useDistance();
  return (
    <View style={[styles.recordRow, { backgroundColor: theme.recordSurface, borderColor: theme.borderSubtle }]}>
      <PressBtn
        style={styles.recordTap}
        onPress={onOpen}
        accessibilityLabel={`Route: ${route.name}`}
        accessibilityHint="Opens Route Detail"
        testID={`route-record-${route.id}`}
      >
        <View style={[styles.routeIcon, { backgroundColor: theme.surfaceSecondary, borderColor: theme.borderSubtle }]}>
          <Icon name="Route" size={19} color={theme.iconActive} strokeWidth={2} />
        </View>
        <View style={styles.recordContent}>
          <View style={styles.recordTitleRow}>
            <Text style={[styles.recordTitle, { color: theme.textPrimary }]} numberOfLines={1}>{route.name || 'Saved route'}</Text>
            <Text style={[styles.objectKind, { color: theme.textMuted }]}>ROUTE</Text>
          </View>
          <Text style={[styles.recordMeta, { color: theme.textSecondary }]} numberOfLines={1}>
            {routeModeLabel(route)} · {dist.format(route.distanceM, 1)} {dist.unit}
            {route.elevationGainM > 0 ? ` · +${dist.formatElevation(route.elevationGainM)}${dist.elevUnit}` : ''}
          </Text>
        </View>
        <View style={styles.routeOpenCue}>
          <Text style={[styles.useCue, { color: theme.primary }]}>Use</Text>
          <Icon name="ChevronRight" size={16} color={theme.iconInactive} strokeWidth={2} />
        </View>
      </PressBtn>
      {hasRouteSyncIssue(route) ? (
        <View style={styles.exceptionRow}>
          <SyncBadge state="failed" onPress={onRetry} />
        </View>
      ) : null}
    </View>
  );
}

function ActivitiesLibrary() {
  const nav = useNavigation<Nav>();
  const theme = useVisualTheme();
  const sessions = useSessionStore(state => state.sessions);
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState<ActivityModeFilter>('all');
  const filtered = useMemo(() => filterActivities(sessions, query, mode), [sessions, query, mode]);
  const sections = useMemo(() => groupActivitiesByMonth(filtered), [filtered]);
  const showDiscovery = sessions.length >= ACTIVITY_DISCOVERY_THRESHOLD || query.length > 0 || mode !== 'all';
  const retry = () => { void import('../services/syncDaemon').then(({ drainPending }) => drainPending({ wakeReason: 'manual', force: true })); };

  if (sessions.length === 0) {
    return <EmptyLibraryState kind="activities" onPrimary={() => nav.navigate('Hiking')} onSecondary={() => nav.navigate('Running')} />;
  }

  return (
    <SectionList
      sections={sections}
      keyExtractor={item => item.id}
      stickySectionHeadersEnabled={false}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={styles.listContent}
      initialNumToRender={16}
      maxToRenderPerBatch={18}
      windowSize={9}
      ListHeaderComponent={(
        <View>
          <LibraryIntro tab="activities" count={sessions.length} />
          {showDiscovery ? (
            <View style={styles.discoveryTools} testID="activity-discovery-tools">
              <SearchField
                value={query}
                onChange={setQuery}
                placeholder="Find an Activity"
                label="Search Activities"
                testID="activity-search"
              />
              <ActivityModeControl value={mode} onChange={setMode} />
            </View>
          ) : null}
        </View>
      )}
      renderSectionHeader={({ section }) => (
        <Text style={[styles.monthLabel, { color: theme.textSecondary }]}>{section.title}</Text>
      )}
      renderItem={({ item }) => (
        <ActivityRecord
          session={item}
          onOpen={() => nav.navigate('MapHistory', {
            sessionId: item.id,
            activityBackContext: 'activities',
          })}
          onRetry={retry}
        />
      )}
      ListEmptyComponent={<NoResults kind="activities" onClear={() => { setQuery(''); setMode('all'); }} />}
      testID="trails-activities-list"
    />
  );
}

function RouteLoadNotice({ onRetry }: { onRetry: () => void }) {
  const theme = useVisualTheme();
  return (
    <View style={[styles.loadNotice, { backgroundColor: theme.recordSurface, borderColor: theme.borderSubtle }]} testID="routes-load-error">
      <Icon name="CloudOff" size={17} color={theme.iconInactive} strokeWidth={2} />
      <Text style={[styles.loadNoticeText, { color: theme.textSecondary }]}>Couldn’t check the server. Routes on this device are still available.</Text>
      <TouchableOpacity onPress={onRetry} accessibilityRole="button">
        <Text style={[styles.retryText, { color: theme.primary }]}>Try again</Text>
      </TouchableOpacity>
    </View>
  );
}

function RoutesLibrary({ onCreate }: { onCreate: () => void }) {
  const nav = useNavigation<Nav>();
  const theme = useVisualTheme();
  const routes = useRouteStore(state => state.routes);
  const sharedRoutes = useRouteStore(state => state.sharedRoutes);
  const loadSharedRoutes = useRouteStore(state => state.loadSharedRoutes);
  const loadRoutes = useRouteStore(state => state.loadRoutes);
  const retryRouteSync = useRouteStore(state => state.retryRouteSync);
  const loading = useRouteStore(state => state.routesLoading);
  const loadError = useRouteStore(state => state.routesLoadError);
  const [query, setQuery] = useState('');
  const [library, setLibrary] = useState<'mine' | 'shared'>('mine');
  const sourceRoutes = library === 'mine' ? routes : sharedRoutes;
  const visible = useMemo(() => filterRoutes(sourceRoutes, query), [sourceRoutes, query]);
  const retryLoad = () => { void loadRoutes(); };

  useEffect(() => { void loadSharedRoutes(); }, [loadSharedRoutes]);

  if (loading && routes.length === 0) {
    return (
      <View style={styles.loadingState} testID="trails-routes-loading">
        <ActivityIndicator color={theme.primary} />
        <Text style={[styles.loadingText, { color: theme.textSecondary }]}>Looking for your saved routes…</Text>
      </View>
    );
  }

  if (loadError && routes.length === 0) {
    return (
      <View style={styles.emptyState} testID="trails-routes-unavailable">
        <View style={[styles.emptyTrace, { backgroundColor: theme.recordSurface, borderColor: theme.borderSubtle }]}>
          <Icon name="CloudOff" size={IconSize.lg} color={theme.iconInactive} strokeWidth={1.8} />
        </View>
        <Text style={[styles.emptyTitle, { color: theme.textPrimary }]}>Routes couldn’t be checked</Text>
        <Text style={[styles.emptyBody, { color: theme.textSecondary }]}>Nothing saved on this device yet. Check your connection and try again.</Text>
        <PrimaryButton label="Try again" onPress={retryLoad} variant="secondary" style={styles.emptyPrimary} />
      </View>
    );
  }

  if (routes.length === 0 && sharedRoutes.length === 0) return <EmptyLibraryState kind="routes" onPrimary={onCreate} />;

  return (
    <FlatList
      data={visible}
      keyExtractor={item => item.id}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={styles.listContent}
      initialNumToRender={14}
      maxToRenderPerBatch={16}
      windowSize={9}
      ListHeaderComponent={(
        <View>
          <LibraryIntro tab="routes" count={sourceRoutes.length} />
          {loadError ? <RouteLoadNotice onRetry={retryLoad} /> : null}
          <SegmentedControl
            value={library}
            segments={[{ key: 'mine', label: 'My Routes' }, { key: 'shared', label: 'Shared Routes' }]}
            onChange={setLibrary}
            testID="route-library-tabs"
          />
          <View style={styles.discoveryTools}>
            <SearchField
              value={query}
              onChange={setQuery}
              placeholder="Find a Route"
              label="Search Routes"
              testID="route-search"
            />
          </View>
        </View>
      )}
      renderItem={({ item }) => (
        <RouteRecord
          route={item}
          onOpen={() => item.isSharedDelivery && item.sharedDeliveryId
            ? nav.navigate('RouteEditor', { sharedDeliveryId: item.sharedDeliveryId })
            : nav.navigate('MapHistory', { routeId: item.id })}
          onRetry={() => { if (!item.isSharedDelivery) void retryRouteSync(item.id); }}
        />
      )}
      ListEmptyComponent={<NoResults kind="routes" onClear={() => setQuery('')} />}
      testID="trails-routes-list"
    />
  );
}

export function RoutesScreen() {
  const nav = useNavigation<Nav>();
  const route = useRoute<RouteProp<RootStackParamList, 'Routes'>>();
  const theme = useVisualTheme();
  const initialTab: TrailsTab = route.params?.initialTab === 'routes' ? 'routes' : 'activities';
  const [tab, setTab] = useState<TrailsTab>(initialTab);
  const [createOpen, setCreateOpen] = useState(false);
  const [activityPickerOpen, setActivityPickerOpen] = useState(false);
  const sessions = useSessionStore(state => state.sessions);
  const loadRoutes = useRouteStore(state => state.loadRoutes);

  useEffect(() => { void loadRoutes(); }, [loadRoutes]);

  useEffect(() => {
    const requested = route.params?.initialTab === 'routes' ? 'routes' : 'activities';
    setTab(requested);
  }, [route.params?.initialTab]);

  return (
    <>
    <SafeAreaView style={[styles.screen, { backgroundColor: theme.background }]} edges={['top']} testID="trails-personal-library">
      <LinearGradient
        pointerEvents="none"
        colors={[theme.surfaceElevated, theme.background, theme.backgroundElevated]}
        locations={[0, 0.38, 1]}
        style={StyleSheet.absoluteFill}
      />
      <View style={styles.header}>
        <BackButton variant="inline" onPress={() => nav.goBack()} />
        <View style={styles.headerCopy}>
          <Text style={[styles.title, { color: theme.textPrimary }]}>Trails</Text>
          <Text style={[styles.subtitle, { color: theme.textSecondary }]}>Your journeys, ready to revisit</Text>
        </View>
        {tab === 'routes' ? (
          <TouchableOpacity
            style={[styles.createButton, { backgroundColor: theme.primaryAction }]}
            onPress={() => setCreateOpen(true)}
            accessibilityRole="button"
            accessibilityLabel="Create Route"
            testID="routes-create"
          >
            <Icon name="Plus" size={18} color={theme.onPrimary} strokeWidth={2.4} />
          </TouchableOpacity>
        ) : <View style={styles.headerBalance} />}
      </View>
      <SegmentedControl
        value={tab}
        segments={TABS}
        onChange={setTab}
        containerStyle={styles.tabs}
        testID="trails-tabs"
      />
      <View style={styles.libraryBody}>
        {tab === 'activities'
          ? <ActivitiesLibrary />
          : <RoutesLibrary onCreate={() => setCreateOpen(true)} />}
      </View>
    </SafeAreaView>
    <ModalCard visible={createOpen} onDismiss={() => setCreateOpen(false)} testID="route-create-source">
      <ModalCardHeader
        title="Create Route"
        body="Choose one starting source. Both open the same editor with Draw and Point."
      />
      <PrimaryButton
        label="Plan a route"
        onPress={() => {
          setCreateOpen(false);
          nav.navigate('RouteEditor', { creationSource: 'plan' });
        }}
        renderIcon={color => <Icon name="Map" size={18} color={color} strokeWidth={2} />}
        testID="route-create-plan"
      />
      <PrimaryButton
        label="Use an Activity"
        variant="secondary"
        onPress={() => { setCreateOpen(false); setActivityPickerOpen(true); }}
        renderIcon={color => <Icon name="Footprints" size={18} color={color} strokeWidth={2} />}
        style={styles.modalAction}
        testID="route-create-activity"
      />
    </ModalCard>
    <ModalCard visible={activityPickerOpen} onDismiss={() => setActivityPickerOpen(false)} testID="route-activity-picker">
      <ModalCardHeader
        title="Use an Activity"
        body="The factual Activity stays read-only. Cairn creates a separate editable Route draft with its recorded section order."
      />
      {sessions.length === 0 ? (
        <Text style={[styles.pickerEmpty, { color: theme.textSecondary }]}>No saved Activities are available yet.</Text>
      ) : (
        <ScrollView style={styles.pickerList}>
          {sessions.map(session => (
            <TouchableOpacity
              key={session.id}
              style={[styles.pickerRow, { borderColor: theme.borderSubtle }]}
              onPress={() => {
                setActivityPickerOpen(false);
                nav.navigate('RouteEditor', { creationSource: 'activity', fromSessionId: session.id });
              }}
              accessibilityRole="button"
              testID={`route-activity-${session.id}`}
            >
              {session.activityMode === 'running'
                ? <RunningIcon size={19} color={theme.iconActive} />
                : <HikingIcon size={19} color={theme.iconActive} />}
              <View style={styles.pickerCopy}>
                <Text style={[styles.recordTitle, { color: theme.textPrimary }]} numberOfLines={1}>{activityDisplayName(session)}</Text>
                <Text style={[styles.recordMeta, { color: theme.textSecondary }]} numberOfLines={1}>{activityDateLabel(session.startedAt)}</Text>
              </View>
              <Icon name="ChevronRight" size={16} color={theme.iconInactive} strokeWidth={2} />
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}
    </ModalCard>
    </>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: {
    minHeight: 60,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.base,
    paddingTop: Spacing.xs,
  },
  headerCopy: { flex: 1, alignItems: 'center', paddingHorizontal: Spacing.sm },
  headerBalance: { width: 60 },
  createButton: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: FontSize.h2, fontWeight: '700', letterSpacing: -0.2 },
  subtitle: { marginTop: 2, fontSize: FontSize.small, fontWeight: '500', textAlign: 'center' },
  tabs: { marginHorizontal: Spacing.base, marginTop: Spacing.xs },
  libraryBody: { flex: 1 },
  modalAction: { marginTop: Spacing.sm },
  pickerList: { maxHeight: 420 },
  pickerEmpty: { paddingVertical: Spacing.xl, textAlign: 'center', fontSize: FontSize.body },
  pickerRow: { minHeight: 62, flexDirection: 'row', alignItems: 'center', gap: Spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, paddingVertical: Spacing.sm },
  pickerCopy: { flex: 1, minWidth: 0 },
  listContent: { paddingHorizontal: Spacing.base, paddingBottom: Spacing.xxl },
  libraryIntro: {
    minHeight: 54,
    paddingTop: Spacing.lg,
    paddingBottom: Spacing.sm,
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: Spacing.md,
  },
  libraryEyebrow: { flex: 1, fontSize: FontSize.tiny, fontWeight: '800', letterSpacing: 1.05 },
  libraryCount: { fontSize: FontSize.small, fontWeight: '600' },
  discoveryTools: { gap: Spacing.sm, paddingBottom: Spacing.md },
  searchField: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.md,
    borderWidth: 1,
    borderRadius: RadiusRole.input,
  },
  searchInput: { flex: 1, minHeight: 40, paddingVertical: 0, fontSize: FontSize.body },
  modeControl: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  modeOption: {
    minHeight: 32,
    minWidth: 58,
    paddingHorizontal: Spacing.md,
    borderRadius: RadiusRole.button,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modeOptionText: { fontSize: FontSize.caption, fontWeight: '600' },
  monthLabel: {
    paddingTop: Spacing.md,
    paddingBottom: Spacing.sm,
    fontSize: FontSize.caption,
    fontWeight: '700',
    letterSpacing: 0.15,
  },
  recordRow: {
    minHeight: 70,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  recordTap: {
    minHeight: 70,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.md,
  },
  recordIcon: { width: 32, alignItems: 'center', justifyContent: 'center' },
  routeIcon: {
    width: 34,
    height: 34,
    borderRadius: RadiusRole.button,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  recordContent: { flex: 1, minWidth: 0 },
  recordTitleRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  recordTitle: { flex: 1, fontSize: FontSize.body, fontWeight: '700', letterSpacing: -0.1 },
  objectKind: { fontSize: FontSize.tiny, fontWeight: '800', letterSpacing: 0.8 },
  recordMeta: { marginTop: 3, fontSize: FontSize.small, fontWeight: '500' },
  exceptionRow: { paddingHorizontal: 58, paddingBottom: Spacing.sm },
  routeOpenCue: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  useCue: { fontSize: FontSize.small, fontWeight: '700' },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.xxl,
    paddingBottom: 70,
  },
  emptyTrace: {
    width: 64,
    height: 64,
    borderRadius: RadiusRole.panel,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.lg,
  },
  emptyTitle: { fontSize: FontSize.h2, fontWeight: '700', textAlign: 'center' },
  emptyBody: { maxWidth: 300, marginTop: Spacing.sm, fontSize: FontSize.body, lineHeight: 22, textAlign: 'center' },
  emptyActions: { width: '100%', maxWidth: 290, marginTop: Spacing.xl, gap: Spacing.md },
  emptyPrimary: { width: '100%' },
  emptySecondary: {
    minHeight: 40,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
  },
  emptySecondaryText: { fontSize: FontSize.body, fontWeight: '700' },
  noResults: { alignItems: 'center', paddingTop: 76, paddingHorizontal: Spacing.xl },
  noResultsTitle: { marginTop: Spacing.md, fontSize: FontSize.h3, fontWeight: '700' },
  noResultsBody: { marginTop: Spacing.xs, fontSize: FontSize.caption, textAlign: 'center' },
  clearText: { marginTop: Spacing.lg, fontSize: FontSize.caption, fontWeight: '700' },
  loadingState: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.md, paddingBottom: 70 },
  loadingText: { fontSize: FontSize.caption, fontWeight: '600' },
  loadNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderWidth: 1,
    borderRadius: RadiusRole.card,
    marginBottom: Spacing.md,
  },
  loadNoticeText: { flex: 1, fontSize: FontSize.small, lineHeight: 16 },
  retryText: { fontSize: FontSize.small, fontWeight: '800' },
});
