/**
 * Trails — Cairn's personal journey library.
 *
 * Activities are past movement. Routes are independent paths the user may
 * want to use again. Cairns remain owned by Memory / Activity / Cairn Detail,
 * and unresolved friend discovery is intentionally not surfaced here.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  InteractionManager,
  Platform,
  SectionList,
  StyleSheet,
  Text,
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
import { LibraryFilterRow, LibraryRecordSurface, LibrarySearchField } from '../components/LibraryControls';
import { FontSize, IconSize, RadiusRole, Spacing } from '../components/tokens';
import { useVisualTheme } from '../hooks/useVisualTheme';
import { useDistance } from '../utils/distanceFormat';
import { formatDuration } from '../utils/geo';
import { createRouteCreationSessionId } from '../features/route/routeCreationSession';
import {
  activityDateLabel,
  activityDisplayName,
  filterActivities,
  filterRoutes,
  groupActivitiesByMonth,
  groupRoutesByMonth,
  hasActivitySyncIssue,
  hasRouteSyncIssue,
  routeSourceLabel,
  routeStatusLabel,
  type ActivityModeFilter,
  type TrailsTab,
} from '../features/trails/trailsLibrary';
import { cairnText } from '../i18n/runtime';

type Nav = NativeStackNavigationProp<RootStackParamList>;

const TABS = [
  { key: 'activities', get label() { return cairnText('routes-screen.activities'); } },
  { key: 'routes', get label() { return cairnText('routes-screen.routes'); } },
] as const;

function LibraryIntro({ tab, count }: { tab: TrailsTab; count: number }) {
  const theme = useVisualTheme();
  const noun = tab === 'activities' ? (count === 1 ? cairnText('routes-screen.activity') : cairnText('routes-screen.activities-57c58a1')) : (count === 1 ? cairnText('routes-screen.route') : cairnText('routes-screen.routes-baf847a'));
  return (
    <View style={styles.libraryIntro}>
      <Text style={[styles.libraryEyebrow, { color: theme.textMuted }]}>
        {tab === 'activities' ? cairnText('routes-screen.what-you-have-done') : cairnText('routes-screen.what-you-may-want-to-repeat')}
      </Text>
      <Text style={[styles.libraryCount, { color: theme.textSecondary }]}>{cairnText('routes-screen.value-value-97cc998', { count: count, noun: noun })}</Text>
    </View>
  );
}

function DateSectionHeader({ title }: { title: string }) {
  const theme = useVisualTheme();
  return <Text style={[styles.monthLabel, { color: theme.textSecondary }]}>{title}</Text>;
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
        {isActivities ? cairnText('routes-screen.your-first-journey-starts-outside') : cairnText('routes-screen.no-routes-saved-yet')}
      </Text>
      <Text style={[styles.emptyBody, { color: theme.textSecondary }]}>
        {isActivities
          ? cairnText('routes-screen.record-a-hike-or-run-when-you')
          : cairnText('routes-screen.create-a-plan-from-an-empty-map')}
      </Text>
      <View style={styles.emptyActions}>
        <PrimaryButton
          label={isActivities ? cairnText('routes-screen.start-a-hike') : cairnText('routes-screen.create-route')}
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
            <Text style={[styles.emptySecondaryText, { color: theme.primary }]}>{cairnText('routes-screen.start-a-run')}</Text>
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
      <Text style={[styles.noResultsTitle, { color: theme.textPrimary }]}>{cairnText('routes-screen.no-matching-value', { kind: kind })}</Text>
      <Text style={[styles.noResultsBody, { color: theme.textSecondary }]}>{cairnText('routes-screen.try-another-name-or-clear-the-filter')}</Text>
      <TouchableOpacity onPress={onClear} accessibilityRole="button">
        <Text style={[styles.clearText, { color: theme.primary }]}>{cairnText('routes-screen.clear-search-and-filters')}</Text>
      </TouchableOpacity>
    </View>
  );
}

function ActivityRecord({ session, onOpen, onRetry }: { session: TrackingSession; onOpen: () => void; onRetry: () => void }) {
  const theme = useVisualTheme();
  const dist = useDistance();
  const isRun = session.activityMode === 'running';
  return (
    <LibraryRecordSurface>
      <PressBtn
        style={styles.recordTap}
        onPress={onOpen}
        accessibilityLabel={cairnText('routes-screen.value-value', { value1: isRun ? cairnText('common.activity.run') : cairnText('common.activity.hike'), value2: activityDisplayName(session) })}
        accessibilityHint={cairnText('routes-screen.opens-activity-detail')}
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
            <Text style={[styles.objectKind, { color: theme.textMuted }]}>{isRun ? cairnText('routes-screen.run') : cairnText('routes-screen.hike')}</Text>
          </View>
          <Text style={[styles.recordMeta, { color: theme.textSecondary }]} numberOfLines={1}>{cairnText('routes-screen.value-value-value-value-value', { value1: activityDateLabel(session.startedAt), value2: dist.format(session.distanceM, 1), unit: dist.unit, value4: formatDuration(session.durationS), value5: session.elevationGainM > 0 ? cairnText('routes-screen.value-value-4487757', { value1: dist.formatElevation(session.elevationGainM), elevUnit: dist.elevUnit }) : '' })}</Text>
        </View>
        <Icon name="ChevronRight" size={16} color={theme.iconInactive} strokeWidth={2} />
      </PressBtn>
      {hasActivitySyncIssue(session) ? (
        <View style={styles.exceptionRow}>
          <SyncBadge state="failed" onPress={onRetry} />
        </View>
      ) : null}
    </LibraryRecordSurface>
  );
}

function RouteRecord({ route, onOpen, onRetry }: { route: Route; onOpen: () => void; onRetry: () => void }) {
  const theme = useVisualTheme();
  const dist = useDistance();
  return (
    <LibraryRecordSurface>
      <PressBtn
        style={styles.recordTap}
        onPress={onOpen}
        accessibilityLabel={cairnText('routes-screen.route-value', { name: route.name })}
        accessibilityHint={cairnText('routes-screen.opens-route-detail')}
        testID={`route-record-${route.id}`}
      >
        <View style={[styles.routeIcon, { backgroundColor: theme.surfaceSecondary, borderColor: theme.borderSubtle }]}>
          <Icon name="Route" size={19} color={theme.iconActive} strokeWidth={2} />
        </View>
        <View style={styles.recordContent}>
          <View style={styles.recordTitleRow}>
            <Text style={[styles.recordTitle, { color: theme.textPrimary }]} numberOfLines={1}>{route.name || cairnText('routes-screen.saved-route')}</Text>
            <Text style={[styles.routeSource, { color: theme.textMuted }]} numberOfLines={1}>{routeSourceLabel(route)}</Text>
          </View>
          <Text style={[styles.recordMeta, { color: theme.textSecondary }]} numberOfLines={1}>{cairnText('routes-screen.value-value-value-value', { value1: dist.format(route.distanceM, 1), unit: dist.unit, value3: route.elevationGainM > 0 ? cairnText('routes-screen.value-value-4487757', { value1: dist.formatElevation(route.elevationGainM), elevUnit: dist.elevUnit }) : '', value4: cairnText('routes-screen.value', { value1: routeStatusLabel(route) }) })}</Text>
        </View>
        <View style={styles.routeOpenCue}>
          <Icon name="ChevronRight" size={16} color={theme.iconInactive} strokeWidth={2} />
        </View>
      </PressBtn>
      {hasRouteSyncIssue(route) ? (
        <View style={styles.exceptionRow}>
          <SyncBadge state="failed" onPress={onRetry} />
        </View>
      ) : null}
    </LibraryRecordSurface>
  );
}

function ActivitiesLibrary() {
  const nav = useNavigation<Nav>();
  const sessions = useSessionStore(state => state.sessions);
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState<ActivityModeFilter>('all');
  const filtered = useMemo(() => filterActivities(sessions, query, mode), [sessions, query, mode]);
  const sections = useMemo(() => groupActivitiesByMonth(filtered), [filtered]);
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
          <View style={styles.discoveryTools} testID="activity-discovery-tools">
            <LibrarySearchField
              value={query}
              onChange={setQuery}
              placeholder={cairnText('routes-screen.find-an-activity')}
              label={cairnText('routes-screen.search-activities')}
              testID="activity-search"
            />
            <LibraryFilterRow
              value={mode}
              options={[{ key: 'all', label: cairnText('routes-screen.all') }, { key: 'hiking', label: cairnText('routes-screen.hikes') }, { key: 'running', label: cairnText('routes-screen.runs') }]}
              onChange={setMode}
              testID="activity-mode-filter"
            />
          </View>
        </View>
      )}
      renderSectionHeader={({ section }) => <DateSectionHeader title={section.title} />}
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
      <Text style={[styles.loadNoticeText, { color: theme.textSecondary }]}>{cairnText('routes-screen.couldn-t-check-the-server-routes-on')}</Text>
      <TouchableOpacity onPress={onRetry} accessibilityRole="button">
        <Text style={[styles.retryText, { color: theme.primary }]}>{cairnText('routes-screen.try-again')}</Text>
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
  const [ownership, setOwnership] = useState<'all' | 'mine' | 'received'>('all');
  const sourceRoutes = useMemo(() => ownership === 'mine'
    ? routes
    : ownership === 'received'
      ? sharedRoutes
      : [...routes, ...sharedRoutes], [ownership, routes, sharedRoutes]);
  const visible = useMemo(() => filterRoutes(sourceRoutes, query), [sourceRoutes, query]);
  const sections = useMemo(() => groupRoutesByMonth(visible), [visible]);
  const retryLoad = () => { void loadRoutes(); };

  useEffect(() => { void loadSharedRoutes(); }, [loadSharedRoutes]);

  if (loading && routes.length === 0 && sharedRoutes.length === 0) {
    return (
      <View style={styles.loadingState} testID="trails-routes-loading">
        <ActivityIndicator color={theme.primary} />
        <Text style={[styles.loadingText, { color: theme.textSecondary }]}>{cairnText('routes-screen.looking-for-your-saved-routes')}</Text>
      </View>
    );
  }

  if (loadError && routes.length === 0 && sharedRoutes.length === 0) {
    return (
      <View style={styles.emptyState} testID="trails-routes-unavailable">
        <View style={[styles.emptyTrace, { backgroundColor: theme.recordSurface, borderColor: theme.borderSubtle }]}>
          <Icon name="CloudOff" size={IconSize.lg} color={theme.iconInactive} strokeWidth={1.8} />
        </View>
        <Text style={[styles.emptyTitle, { color: theme.textPrimary }]}>{cairnText('routes-screen.routes-couldn-t-be-checked')}</Text>
        <Text style={[styles.emptyBody, { color: theme.textSecondary }]}>{cairnText('routes-screen.nothing-saved-on-this-device-yet-check')}</Text>
        <PrimaryButton label={cairnText('routes-screen.try-again')} onPress={retryLoad} variant="secondary" style={styles.emptyPrimary} />
      </View>
    );
  }

  if (routes.length === 0 && sharedRoutes.length === 0) return <EmptyLibraryState kind="routes" onPrimary={onCreate} />;

  return (
    <SectionList
      sections={sections}
      keyExtractor={item => `${item.isSharedDelivery ? 'received' : 'mine'}:${item.id}`}
      stickySectionHeadersEnabled={false}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={styles.listContent}
      initialNumToRender={14}
      maxToRenderPerBatch={16}
      windowSize={9}
      ListHeaderComponent={(
        <View>
          <LibraryIntro tab="routes" count={sourceRoutes.length} />
          {loadError ? <RouteLoadNotice onRetry={retryLoad} /> : null}
          <View style={styles.discoveryTools}>
            <LibrarySearchField
              value={query}
              onChange={setQuery}
              placeholder={cairnText('routes-screen.find-a-route')}
              label={cairnText('routes-screen.search-routes')}
              testID="route-search"
            />
            <LibraryFilterRow
              value={ownership}
              options={[{ key: 'all', label: cairnText('routes-screen.all') }, { key: 'mine', label: cairnText('routes-screen.mine') }, { key: 'received', label: cairnText('routes-screen.received') }]}
              onChange={setOwnership}
              testID="route-ownership-filter"
              trailing={(
                <TouchableOpacity
                  style={[styles.inlineCreateButton, { backgroundColor: theme.primaryAction }]}
                  onPress={onCreate}
                  accessibilityRole="button"
                  accessibilityLabel={cairnText('routes-screen.create-route')}
                  testID="routes-create"
                  hitSlop={{ top: 5, bottom: 5, left: 5, right: 5 }}
                >
                  <Text style={[styles.inlineCreateLabel, { color: theme.onPrimary }]}>{cairnText('routes-screen.create')}</Text>
                </TouchableOpacity>
              )}
            />
          </View>
        </View>
      )}
      renderSectionHeader={({ section }) => <DateSectionHeader title={section.title} />}
      renderItem={({ item }) => (
        <RouteRecord
          route={item}
          onOpen={() => item.isSharedDelivery && item.sharedDeliveryId
            ? nav.navigate('MapHistory', { sharedDeliveryId: item.sharedDeliveryId })
            : nav.navigate('MapHistory', { routeId: item.id })}
          onRetry={() => { if (!item.isSharedDelivery) void retryRouteSync(item.id); }}
        />
      )}
      ListEmptyComponent={<NoResults kind="routes" onClear={() => { setQuery(''); setOwnership('all'); }} />}
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
  const [createStep, setCreateStep] = useState<'source' | 'activity'>('source');
  const createTransitionRef = useRef<RootStackParamList['RouteEditor'] | null>(null);
  const sessions = useSessionStore(state => state.sessions);
  const loadRoutes = useRouteStore(state => state.loadRoutes);

  useEffect(() => { void loadRoutes(); }, [loadRoutes]);

  useEffect(() => {
    const requested = route.params?.initialTab === 'routes' ? 'routes' : 'activities';
    setTab(requested);
  }, [route.params?.initialTab]);

  const finishCreateTransition = useCallback(() => {
    const destination = createTransitionRef.current;
    if (!destination) return;
    createTransitionRef.current = null;
    setCreateStep('source');
    nav.navigate('RouteEditor', destination);
  }, [nav]);

  useEffect(() => {
    if (createOpen || !createTransitionRef.current || Platform.OS === 'ios') return undefined;
    const task = InteractionManager.runAfterInteractions(finishCreateTransition);
    return () => task.cancel();
  }, [createOpen, finishCreateTransition]);

  const leaveCreateFlow = useCallback((destination: NonNullable<RootStackParamList['RouteEditor']>) => {
    if (createTransitionRef.current) return;
    createTransitionRef.current = destination;
    setCreateOpen(false);
  }, []);

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
          <Text style={[styles.title, { color: theme.textPrimary }]}>{cairnText('routes-screen.trails')}</Text>
          <Text style={[styles.subtitle, { color: theme.textSecondary }]}>{cairnText('routes-screen.your-journeys-ready-to-revisit')}</Text>
        </View>
        <View style={styles.headerBalance} />
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
          : <RoutesLibrary onCreate={() => { setCreateStep('source'); setCreateOpen(true); }} />}
      </View>
    </SafeAreaView>
    <ModalCard
      visible={createOpen}
      onDismiss={() => {
        if (createTransitionRef.current) return;
        setCreateOpen(false);
        setCreateStep('source');
      }}
      onClosed={finishCreateTransition}
      testID={createStep === 'source' ? 'route-create-source' : 'route-activity-picker'}
    >
      {createStep === 'source' ? (
        <>
          <ModalCardHeader
            title={cairnText('routes-screen.create-route')}
            body={cairnText('routes-screen.choose-one-starting-source-both-open-the')}
          />
          <PrimaryButton
            label={cairnText('routes-screen.plan-a-route')}
            onPress={() => leaveCreateFlow({ creationSource: 'plan' })}
            renderIcon={color => <Icon name="Map" size={18} color={color} strokeWidth={2} />}
            testID="route-create-plan"
          />
          <PrimaryButton
            label={cairnText('routes-screen.use-an-activity')}
            variant="secondary"
            onPress={() => setCreateStep('activity')}
            renderIcon={color => <Icon name="Footprints" size={18} color={color} strokeWidth={2} />}
            style={styles.modalAction}
            testID="route-create-activity"
          />
        </>
      ) : (
        <>
          <ModalCardHeader
            title={cairnText('routes-screen.use-an-activity')}
            body={cairnText('routes-screen.the-factual-activity-stays-read-only-cairn')}
          />
          <TouchableOpacity
            style={styles.pickerBack}
            onPress={() => setCreateStep('source')}
            accessibilityRole="button"
            accessibilityLabel={cairnText('routes-screen.back-to-route-sources')}
          >
            <Icon name="ChevronLeft" size={16} color={theme.iconActive} strokeWidth={2} />
            <Text style={[styles.pickerBackLabel, { color: theme.primary }]}>{cairnText('routes-screen.sources')}</Text>
          </TouchableOpacity>
          {sessions.length === 0 ? (
            <Text style={[styles.pickerEmpty, { color: theme.textSecondary }]}>{cairnText('routes-screen.no-saved-activities-are-available-yet')}</Text>
          ) : (
            <FlatList
              data={sessions}
              keyExtractor={session => session.id}
              style={styles.pickerList}
              contentContainerStyle={styles.pickerListContent}
              scrollIndicatorInsets={{ right: -2 }}
              initialNumToRender={10}
              keyboardShouldPersistTaps="handled"
              renderItem={({ item: session }) => (
                <TouchableOpacity
                  style={[styles.pickerRow, { borderColor: theme.borderSubtle }]}
                  onPress={() => leaveCreateFlow({
                    creationSource: 'activity',
                    fromSessionId: session.id,
                    creationSessionId: createRouteCreationSessionId(),
                  })}
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
              )}
            />
          )}
        </>
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
  title: { fontSize: FontSize.h2, fontWeight: '700', letterSpacing: -0.2 },
  subtitle: { marginTop: 2, fontSize: FontSize.small, fontWeight: '500', textAlign: 'center' },
  tabs: { marginHorizontal: Spacing.base, marginTop: Spacing.xs },
  libraryBody: { flex: 1 },
  modalAction: { marginTop: Spacing.sm },
  pickerList: { maxHeight: 420 },
  pickerListContent: { paddingRight: Spacing.sm },
  pickerBack: { minHeight: 40, alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: Spacing.xs, marginBottom: Spacing.xs },
  pickerBackLabel: { fontSize: FontSize.caption, fontWeight: '700' },
  pickerEmpty: { paddingVertical: Spacing.xl, textAlign: 'center', fontSize: FontSize.body },
  pickerRow: { minHeight: 62, flexDirection: 'row', alignItems: 'center', gap: Spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, paddingVertical: Spacing.sm, paddingRight: Spacing.md },
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
  inlineCreateButton: { minHeight: 34, minWidth: 82, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingHorizontal: Spacing.sm, borderRadius: RadiusRole.button },
  inlineCreateLabel: { fontSize: FontSize.caption, fontWeight: '800' },
  monthLabel: {
    paddingTop: Spacing.md,
    paddingBottom: Spacing.sm,
    fontSize: FontSize.caption,
    fontWeight: '700',
    letterSpacing: 0.15,
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
  routeSource: { maxWidth: '42%', fontSize: FontSize.tiny, fontWeight: '700' },
  recordMeta: { marginTop: 3, fontSize: FontSize.small, fontWeight: '500' },
  exceptionRow: { paddingHorizontal: 58, paddingBottom: Spacing.sm },
  routeOpenCue: { flexDirection: 'row', alignItems: 'center', gap: 2 },
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
