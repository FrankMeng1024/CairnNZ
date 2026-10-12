import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/RootNavigator';
import { BackButton } from '../components/BackButton';
import { ContentSurface } from '../components/ContentSurface';
import { Icon } from '../components/Icon';
import { SyncBadge } from '../components/SyncBadge';
import { FontSize, RadiusRole, Spacing } from '../components/tokens';
import { useVisualTheme } from '../hooks/useVisualTheme';
import { useMarkerStore, type Marker } from '../store/useMarkerStore';
import { cairnStableId, mergeOwnedCairns } from '../features/cairns/cairnIdentity';
import { cairnDisplayTitle, splitTitleBody } from '../features/plant/services/noteEncoding';
import { formatDate } from '../utils/geo';
import { CairnPinV10 } from '../features/memory/components/CairnPinV10';
import { CairnIdentityLine } from '../features/cairns/CairnIdentityLine';
import { markersForVisibleWorkspace } from '../features/cairns/cairnWorkspace';
import { useSettingsStore } from '../store/useSettingsStore';
import { authenticatedFetch } from '../services/apiService';
import { useCairnPresentationStore } from '../features/cairns/cairnPresentationStore';

type Nav = NativeStackNavigationProp<RootStackParamList>;
type ScreenRoute = RouteProp<RootStackParamList, 'AllCairns'>;
type AudienceFilter = 'all' | Marker['permission'];
type CairnSort = 'recent' | 'oldest';
type LibrarySection = 'left' | 'found';
type FoundCollectionState = 'active' | 'archived';
type FoundCairn = {
  marker_id: number;
  revision_id: number;
  content_revision: number;
  type: Marker['type'];
  text: string | null;
  author_name: string | null;
  availability: 'available' | 'under_review' | 'unavailable' | 'removed';
  acquired_at: string;
  opened_at: string | null;
  revision_count: number;
  lat: number;
  lng: number;
  has_unread: number | boolean;
};

const AUDIENCE_FILTERS: ReadonlyArray<{ key: AudienceFilter; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'personal', label: 'Only me' },
  { key: 'group', label: 'Friends' },
  { key: 'public', label: 'Public' },
];

function searchableText(marker: Marker): string {
  const decoded = splitTitleBody(marker.note ?? '');
  return `${decoded.title}\n${decoded.body}`.toLocaleLowerCase();
}

function CairnRow({ marker }: { marker: Marker }) {
  const theme = useVisualTheme();
  const nav = useNavigation<Nav>();
  const retryMarkerSync = useMarkerStore(state => state.retryMarkerSync);
  const decoded = splitTitleBody(marker.note ?? '');
  const title = cairnDisplayTitle(decoded.title, decoded.body, marker.createdAt);
  const preview = decoded.body.trim();
  const id = cairnStableId(marker);
  return (
    <ContentSurface
      level="record"
      onPress={() => nav.navigate('MarkerDetail', { markerId: id })}
      style={styles.rowSurface}
      testID={`all-cairns-row-${id}`}
    >
      <View style={styles.row}>
        <View style={[styles.rowIcon, { backgroundColor: theme.controlSelected, borderColor: theme.borderStrong }]}>
          <CairnPinV10 tier="self" type={marker.type} size="detail" />
        </View>
        <View style={styles.rowCopy}>
          <Text style={[styles.rowTitle, { color: theme.foreground }]} numberOfLines={1}>{title}</Text>
          <CairnIdentityLine isOwner permission={marker.permission} compact qa={marker.qaProvenance === 'simulator_test'} />
          <Text style={[styles.rowMeta, { color: theme.foregroundSecondary }]} numberOfLines={1}>{formatDate(marker.createdAt)}</Text>
          {preview ? (
            <Text style={[styles.rowPreview, { color: theme.muted }]} numberOfLines={2}>{preview}</Text>
          ) : null}
        </View>
        <View style={styles.rowTrailing}>
          {marker.syncState && marker.syncState !== 'synced' ? (
            <SyncBadge
              state={marker.syncState}
              onPress={marker.syncState === 'failed'
                ? () => { void retryMarkerSync(id).catch(() => {}); }
                : undefined}
            />
          ) : null}
          <Icon name="ChevronRight" size={17} color={theme.iconInactive} strokeWidth={2} />
        </View>
      </View>
    </ContentSurface>
  );
}

function FoundCairnRow({ cairn, archived, onRestore }: { cairn: FoundCairn; archived: boolean; onRestore: () => void }) {
  const theme = useVisualTheme();
  const nav = useNavigation<Nav>();
  const decoded = splitTitleBody(cairn.text ?? '');
  return (
    <ContentSurface
      level="record"
      onPress={() => nav.navigate('AcquiredCairnDetail', { markerId: String(cairn.marker_id) })}
      style={styles.rowSurface}
      testID={`found-cairn-row-${cairn.marker_id}`}
    >
      <View style={styles.row}>
        <View style={[styles.rowIcon, { backgroundColor: theme.controlSelected }]}>
          <CairnPinV10 tier="friend" type={cairn.type} size="detail" />
        </View>
        <View style={styles.rowCopy}>
          <Text style={[styles.rowTitle, { color: theme.foreground }]} numberOfLines={1}>
            {cairn.availability === 'available'
              ? decoded.title || decoded.body || 'A moment here'
              : cairn.availability === 'under_review' ? 'Content under review' : 'Content unavailable'}
          </Text>
          <Text style={[styles.rowMeta, { color: theme.foregroundSecondary }]} numberOfLines={1}>
            {cairn.author_name ? `Left by ${cairn.author_name}` : 'Acquired Cairn'} · {cairn.revision_count} {Number(cairn.revision_count) === 1 ? 'version' : 'versions'}
          </Text>
          <Text style={[styles.rowMeta, { color: theme.muted }]}>{new Date(cairn.acquired_at).toLocaleDateString()}</Text>
        </View>
        {archived ? (
          <TouchableOpacity onPress={onRestore} accessibilityRole="button" testID={`found-cairn-restore-${cairn.marker_id}`}>
            <Text style={[styles.restoreText, { color: theme.primary }]}>Restore</Text>
          </TouchableOpacity>
        ) : null}
        {!archived && cairn.availability === 'available' && !cairn.opened_at ? <View style={[styles.unreadDot, { backgroundColor: theme.primary }]} /> : null}
        <Icon name="ChevronRight" size={17} color={theme.iconInactive} strokeWidth={2} />
      </View>
    </ContentSurface>
  );
}

export function AllCairnsScreen() {
  const theme = useVisualTheme();
  const route = useRoute<ScreenRoute>();
  const storedMarkers = useMarkerStore(state => state.markers);
  const debugMode = useSettingsStore(state => state.debugMode);
  const markers = useMemo(() => markersForVisibleWorkspace(storedMarkers, debugMode), [debugMode, storedMarkers]);
  const remoteMarkers = useMarkerStore(state => state.libraryRemoteMarkers);
  const coverage = useMarkerStore(state => state.libraryCoverage);
  const loading = useMarkerStore(state => state.libraryLoading);
  const error = useMarkerStore(state => state.libraryError);
  const hasMore = useMarkerStore(state => state.libraryHasMore);
  const serverQuery = useMarkerStore(state => state.libraryQuery);
  const loadLibrary = useMarkerStore(state => state.loadCairnLibrary);
  const [query, setQuery] = useState(serverQuery);
  const [audience, setAudience] = useState<AudienceFilter>('all');
  const [sort, setSort] = useState<CairnSort>('recent');
  const [section, setSection] = useState<LibrarySection>(route.params?.initialSection ?? 'left');
  const [foundCairns, setFoundCairns] = useState<FoundCairn[]>([]);
  const [foundLoading, setFoundLoading] = useState(false);
  const [foundError, setFoundError] = useState('');
  const [foundCollectionState, setFoundCollectionState] = useState<FoundCollectionState>('active');

  const loadFound = useCallback(async () => {
    setFoundLoading(true);
    setFoundError('');
    try {
      const response = await authenticatedFetch(`/api/cairn-memory/library?section=found&state=${foundCollectionState}`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const body = await response.json();
      setFoundCairns(Array.isArray(body.cairns) ? body.cairns : []);
      void useCairnPresentationStore.getState().refreshAcquiredMap();
    } catch {
      setFoundError('Connect to refresh acquired Cairns.');
    } finally {
      setFoundLoading(false);
    }
  }, [foundCollectionState]);

  const restoreFound = useCallback(async (markerId: number) => {
    const response = await authenticatedFetch(`/api/cairn-memory/cairns/${markerId}/collection`, {
      method: 'PUT', body: JSON.stringify({ action: 'restore' }),
    });
    if (response.ok) {
      setFoundCairns(current => current.filter(cairn => cairn.marker_id !== markerId));
      void useCairnPresentationStore.getState().refreshAcquiredMap();
    }
  }, []);

  useEffect(() => {
    if (section === 'found') void loadFound();
  }, [loadFound, section]);

  useEffect(() => {
    if (coverage === 'not-loaded' && !loading) {
      void loadLibrary({ query: '', reset: true }).catch(() => {});
    }
  }, [coverage, loadLibrary, loading]);

  useEffect(() => {
    const timer = setTimeout(() => {
      const normalized = query.trim();
      if (normalized !== serverQuery && !loading) {
        void loadLibrary({ query: normalized, reset: true }).catch(() => {});
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [loadLibrary, loading, query, serverQuery]);

  const merged = useMemo(
    () => mergeOwnedCairns(markers, remoteMarkers),
    [markers, remoteMarkers],
  );
  const visible = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    return merged
      .filter(marker => audience === 'all' || marker.permission === audience)
      .filter(marker => !normalized || searchableText(marker).includes(normalized))
      .sort((a, b) => sort === 'recent'
        ? (b.createdAt ?? 0) - (a.createdAt ?? 0)
        : (a.createdAt ?? 0) - (b.createdAt ?? 0));
  }, [audience, merged, query, sort]);
  const visibleFound = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    const requested = route.params?.markerIds?.length ? new Set(route.params.markerIds.map(String)) : null;
    return foundCairns
      .filter(cairn => !requested || requested.has(String(cairn.marker_id)))
      .filter(cairn => !normalized
        || `${cairn.text ?? ''}\n${cairn.author_name ?? ''}`.toLocaleLowerCase().includes(normalized));
  }, [foundCairns, query, route.params?.markerIds]);

  const refresh = useCallback(() => {
    void loadLibrary({ query: query.trim(), reset: true }).catch(() => {});
  }, [loadLibrary, query]);

  const incompleteCopy = error === 'unavailable'
    ? 'Showing Cairns available on this iPhone. Full history could not be checked.'
    : error === 'server-upgrade-required'
      ? 'Showing downloaded Cairns. Some older Cairns may not appear yet.'
      : coverage === 'partial' && hasMore
        ? 'Recent Cairns are ready. Load older Cairns when you need them.'
        : null;

  const showInitialLoading = loading && coverage === 'not-loaded' && visible.length === 0;
  const emptyTitle = query.trim()
    ? (coverage === 'complete' ? 'No matching Cairns' : 'No matches in available Cairns')
    : 'No Cairns yet';
  const emptyBody = query.trim()
    ? (coverage === 'complete'
      ? 'Try a different name or note.'
      : 'Try another search, or reconnect to check more history.')
    : 'Quick Cairns and full Plants will appear here after you leave them.';

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: theme.background }]} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <BackButton variant="inline" testID="all-cairns-back" />
        <Text style={[styles.title, { color: theme.foreground }]}>Cairn Library</Text>
        <Text style={[styles.subtitle, { color: theme.foregroundSecondary }]}>
          Cairns you left and versions you found.
        </Text>
      </View>

      <View style={[styles.sectionTabs, { backgroundColor: theme.surface, borderColor: theme.border }]}>
        {(['left', 'found'] as const).map(value => {
          const selected = section === value;
          return (
            <TouchableOpacity
              key={value}
              style={[styles.sectionTab, selected && { backgroundColor: theme.controlSelected }]}
              onPress={() => { setSection(value); setQuery(''); }}
              accessibilityState={{ selected }}
              testID={`cairn-library-${value}`}
            >
              <Text style={[styles.sectionTabText, { color: selected ? theme.foreground : theme.foregroundSecondary }]}>{value === 'left' ? 'I left' : 'I found'}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <View style={[styles.searchWrap, { backgroundColor: theme.inputSurface, borderColor: theme.border }]}>
        <Icon name="Search" size={17} color={theme.iconInactive} strokeWidth={2} />
        <TextInput
          testID="all-cairns-search"
          value={query}
          onChangeText={setQuery}
          placeholder={section === 'left' ? 'Search names and notes' : 'Search found Cairns'}
          placeholderTextColor={theme.muted}
          style={[styles.searchInput, { color: theme.foreground }]}
          returnKeyType="search"
          autoCorrect={false}
          accessibilityLabel="Search your Cairns"
        />
        {query ? (
          <TouchableOpacity onPress={() => setQuery('')} accessibilityLabel="Clear search" hitSlop={8}>
            <Icon name="X" size={17} color={theme.iconInactive} strokeWidth={2} />
          </TouchableOpacity>
        ) : null}
      </View>

      {section === 'left' ? <View style={styles.controls} testID="all-cairns-controls">
        <Text style={[styles.controlLabel, { color: theme.foregroundSecondary }]}>AUDIENCE</Text>
        <View style={styles.filterRow}>
          {AUDIENCE_FILTERS.map(filter => {
            const selected = audience === filter.key;
            return (
              <TouchableOpacity
                key={filter.key}
                testID={`all-cairns-filter-${filter.key}`}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                onPress={() => setAudience(filter.key)}
                style={[
                  styles.filterChip,
                  { borderColor: selected ? theme.borderStrong : theme.border, backgroundColor: selected ? theme.controlSelected : theme.surface },
                ]}
              >
                <Text style={[styles.filterText, { color: selected ? theme.foreground : theme.foregroundSecondary }]}>{filter.label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
        <TouchableOpacity
          testID="all-cairns-sort"
          accessibilityRole="button"
          accessibilityLabel={`Sorted ${sort === 'recent' ? 'recent first' : 'oldest first'}. Change order`}
          onPress={() => setSort(current => current === 'recent' ? 'oldest' : 'recent')}
          style={styles.sortControl}
        >
          <Icon name="ArrowUpDown" size={15} color={theme.iconInactive} strokeWidth={2} />
          <Text style={[styles.sortText, { color: theme.foregroundSecondary }]}>
            {sort === 'recent' ? 'Planted: newest first' : 'Planted: oldest first'}
          </Text>
        </TouchableOpacity>
      </View> : null}

      {section === 'found' ? (
        <View style={styles.foundFilterRow}>
          {(['active', 'archived'] as const).map(value => {
            const selected = foundCollectionState === value;
            return (
              <TouchableOpacity
                key={value}
                onPress={() => setFoundCollectionState(value)}
                style={[styles.filterChip, { borderColor: selected ? theme.borderStrong : theme.border, backgroundColor: selected ? theme.controlSelected : theme.surface }]}
                accessibilityState={{ selected }}
              >
                <Text style={[styles.filterText, { color: selected ? theme.foreground : theme.foregroundSecondary }]}>{value === 'active' ? 'Current' : 'Archived'}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      ) : null}

      {section === 'left' && incompleteCopy ? (
        <ContentSurface level="record" style={styles.coverage} testID="all-cairns-coverage">
          <View style={styles.coverageRow}>
            <Icon name="CloudOff" size={16} color={theme.iconInactive} strokeWidth={2} />
            <Text style={[styles.coverageText, { color: theme.foregroundSecondary }]}>{incompleteCopy}</Text>
            <TouchableOpacity onPress={refresh} disabled={loading} accessibilityRole="button">
              <Text style={[styles.retryText, { color: theme.primary }]}>{loading ? 'Checking…' : 'Retry'}</Text>
            </TouchableOpacity>
          </View>
        </ContentSurface>
      ) : null}

      {section === 'found' ? (
        foundLoading && visibleFound.length === 0 ? (
          <View style={styles.centerState}><ActivityIndicator color={theme.primary} /></View>
        ) : (
          <FlatList
            testID="found-cairns-list"
            data={visibleFound}
            keyExtractor={item => String(item.marker_id)}
            renderItem={({ item }) => (
              <FoundCairnRow
                cairn={item}
                archived={foundCollectionState === 'archived'}
                onRestore={() => void restoreFound(item.marker_id)}
              />
            )}
            contentContainerStyle={[styles.list, visibleFound.length === 0 && styles.listEmpty]}
            refreshControl={<RefreshControl refreshing={foundLoading} onRefresh={() => void loadFound()} tintColor={theme.primary} />}
            ListHeaderComponent={foundError ? <Text style={[styles.coverageText, { color: theme.foregroundSecondary }]}>{foundError}</Text> : null}
            ListEmptyComponent={(
              <View style={styles.centerState} testID="found-cairns-empty">
                <View style={[styles.emptyIcon, { backgroundColor: theme.controlSelected, borderColor: theme.borderStrong }]}>
                  <Icon name="MapPin" size={24} color={theme.iconActive} strokeWidth={2} />
                </View>
                <Text style={[styles.stateTitle, { color: theme.foreground }]}>{foundCollectionState === 'archived' ? 'No archived Cairns' : 'No acquired Cairns yet'}</Text>
                <Text style={[styles.stateBody, { color: theme.foregroundSecondary }]}>{foundCollectionState === 'archived' ? 'Archived Cairns can be restored here.' : 'Cairns discovered during eligible visits will appear here.'}</Text>
              </View>
            )}
          />
        )
      ) : showInitialLoading ? (
        <View style={styles.centerState} testID="all-cairns-loading">
          <ActivityIndicator color={theme.primary} />
          <Text style={[styles.stateTitle, { color: theme.foreground }]}>Opening your Cairns…</Text>
        </View>
      ) : (
        <FlatList
          testID="all-cairns-list"
          data={visible}
          keyExtractor={cairnStableId}
          renderItem={({ item }) => <CairnRow marker={item} />}
          contentContainerStyle={[styles.list, visible.length === 0 && styles.listEmpty]}
          keyboardShouldPersistTaps="handled"
          refreshControl={<RefreshControl refreshing={loading && coverage !== 'not-loaded'} onRefresh={refresh} tintColor={theme.primary} />}
          ListEmptyComponent={(
            <View style={styles.centerState} testID={query.trim() ? 'all-cairns-search-empty' : 'all-cairns-empty'}>
              <View style={[styles.emptyIcon, { backgroundColor: theme.controlSelected, borderColor: theme.borderStrong }]}>
                <Icon name="MapPin" size={24} color={theme.iconActive} strokeWidth={2} />
              </View>
              <Text style={[styles.stateTitle, { color: theme.foreground }]}>{emptyTitle}</Text>
              <Text style={[styles.stateBody, { color: theme.foregroundSecondary }]}>{emptyBody}</Text>
            </View>
          )}
          ListFooterComponent={hasMore ? (
            <TouchableOpacity
              style={[styles.loadMore, { borderColor: theme.borderStrong, backgroundColor: theme.secondaryAction }]}
              onPress={() => { void loadLibrary({ query: query.trim(), reset: false }).catch(() => {}); }}
              disabled={loading}
              testID="all-cairns-load-more"
            >
              {loading ? <ActivityIndicator color={theme.primary} /> : (
                <Text style={[styles.loadMoreText, { color: theme.foreground }]}>Load older Cairns</Text>
              )}
            </TouchableOpacity>
          ) : null}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { paddingHorizontal: Spacing.xl, paddingTop: Spacing.sm, paddingBottom: Spacing.md },
  title: { fontSize: FontSize.h1, lineHeight: 34, fontWeight: '700', marginTop: Spacing.lg },
  subtitle: { fontSize: FontSize.body, lineHeight: 20, marginTop: Spacing.xs },
  searchWrap: {
    marginHorizontal: Spacing.xl,
    minHeight: 48,
    borderWidth: 1,
    borderRadius: RadiusRole.input,
    paddingHorizontal: Spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  sectionTabs: { marginHorizontal: Spacing.xl, marginBottom: Spacing.md, padding: 3, borderWidth: 1, borderRadius: RadiusRole.button, flexDirection: 'row' },
  sectionTab: { flex: 1, minHeight: 38, borderRadius: RadiusRole.button, alignItems: 'center', justifyContent: 'center' },
  sectionTabText: { fontSize: FontSize.small, fontWeight: '700' },
  searchInput: { flex: 1, fontSize: FontSize.body, paddingVertical: Spacing.sm },
  controls: { paddingHorizontal: Spacing.xl, paddingTop: Spacing.md, gap: Spacing.sm },
  controlLabel: { fontSize: FontSize.caption, fontWeight: '700', letterSpacing: 0.8 },
  filterRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.xs },
  filterChip: {
    minHeight: 36,
    paddingHorizontal: Spacing.md,
    borderRadius: RadiusRole.button,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterText: { fontSize: FontSize.small, fontWeight: '700' },
  foundFilterRow: { flexDirection: 'row', gap: Spacing.xs, paddingHorizontal: Spacing.xl, paddingTop: Spacing.md },
  sortControl: { minHeight: 32, alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
  sortText: { fontSize: FontSize.small, fontWeight: '600' },
  coverage: { marginHorizontal: Spacing.xl, marginTop: Spacing.md },
  coverageRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  coverageText: { flex: 1, fontSize: FontSize.small, lineHeight: 18 },
  retryText: { fontSize: FontSize.small, fontWeight: '700' },
  list: { paddingHorizontal: Spacing.xl, paddingTop: Spacing.lg, paddingBottom: Spacing.xxl, gap: Spacing.sm },
  listEmpty: { flexGrow: 1 },
  rowSurface: { paddingVertical: Spacing.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  rowIcon: {
    width: 46,
    height: 46,
    borderRadius: 23,
    borderWidth: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowCopy: { flex: 1, minWidth: 0 },
  rowTitle: { fontSize: FontSize.body, fontWeight: '700' },
  rowMeta: { fontSize: FontSize.small, marginTop: 3 },
  rowPreview: { fontSize: FontSize.small, lineHeight: 17, marginTop: Spacing.xs },
  rowTrailing: { alignItems: 'flex-end', gap: Spacing.sm },
  unreadDot: { width: 8, height: 8, borderRadius: 4 },
  restoreText: { fontSize: FontSize.small, fontWeight: '700' },
  centerState: {
    flex: 1,
    minHeight: 300,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.xxl,
  },
  emptyIcon: {
    width: 56,
    height: 56,
    borderRadius: 20,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.md,
  },
  stateTitle: { fontSize: FontSize.h3, fontWeight: '700', textAlign: 'center', marginTop: Spacing.md },
  stateBody: { fontSize: FontSize.body, lineHeight: 21, textAlign: 'center', marginTop: Spacing.sm },
  loadMore: {
    minHeight: 48,
    borderWidth: 1,
    borderRadius: RadiusRole.button,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: Spacing.sm,
  },
  loadMoreText: { fontSize: FontSize.body, fontWeight: '700' },
});
