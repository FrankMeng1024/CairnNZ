import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
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
import { LibraryFilterRow, LibraryRecordSurface, LibrarySearchField } from '../components/LibraryControls';
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
import { useAppStore } from '../store/useAppStore';
import { cairnPublicationTruth } from '../features/cairns/cairnExperience';
import { cairnText, formatCairnDate } from '../i18n/runtime';

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
  source_audience: 'friends' | 'public';
  availability: 'available' | 'under_review' | 'unavailable' | 'removed';
  acquired_at: string;
  opened_at: string | null;
  revision_count: number;
  lat: number;
  lng: number;
  has_unread: number | boolean;
};

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
  const publicationTruth = cairnPublicationTruth(marker);
  return (
    <LibraryRecordSurface
      onPress={() => nav.navigate('MarkerDetail', { markerId: id })}
      testID={`all-cairns-row-${id}`}
      accessibilityLabel={cairnText('all-cairns-screen.cairn-value', { title: title })}
    >
      <View style={styles.row}>
        <View style={styles.rowIcon}>
          <CairnPinV10 tier="self" type={marker.type} size="detail" />
        </View>
        <View style={styles.rowCopy}>
          <Text style={[styles.rowTitle, { color: theme.foreground }]} numberOfLines={1}>{title}</Text>
          <CairnIdentityLine isOwner permission={marker.permission} compact qa={marker.qaProvenance === 'simulator_test'} />
          {publicationTruth ? (
            <Text style={[styles.rowMeta, { color: theme.foregroundSecondary }]} numberOfLines={1}>{publicationTruth.label}</Text>
          ) : null}
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
    </LibraryRecordSurface>
  );
}

function FoundCairnRow({ cairn, archived, onRestore, restoring, revisionId }: {
  cairn: FoundCairn;
  archived: boolean;
  onRestore: () => void;
  restoring: boolean;
  revisionId?: string;
}) {
  const theme = useVisualTheme();
  const nav = useNavigation<Nav>();
  const decoded = splitTitleBody(cairn.text ?? '');
  return (
    <LibraryRecordSurface
      onPress={() => nav.navigate('AcquiredCairnDetail', {
        markerId: String(cairn.marker_id),
        revisionId,
      })}
      testID={`found-cairn-row-${cairn.marker_id}`}
      accessibilityLabel={cairnText('all-cairns-screen.acquired-cairn')}
    >
      <View style={styles.row}>
        <View style={styles.rowIcon}>
          <CairnPinV10 tier={cairn.source_audience === 'public' ? 'public' : 'friend'} type={cairn.type} size="detail" />
        </View>
        <View style={styles.rowCopy}>
          <Text style={[styles.rowTitle, { color: theme.foreground }]} numberOfLines={1}>
            {cairn.availability === 'available'
              ? decoded.title || decoded.body || cairnText('all-cairns-screen.a-moment-here')
              : cairn.availability === 'under_review' ? cairnText('all-cairns-screen.content-under-review') : cairnText('all-cairns-screen.content-unavailable')}
          </Text>
          <Text style={[styles.rowMeta, { color: theme.foregroundSecondary }]} numberOfLines={1}>{cairnText('all-cairns-screen.value-value-value', { value1: cairn.author_name
              ? cairnText('all-cairns-screen.left-by-value', { author_name: cairn.author_name })
              : cairn.source_audience === 'public' ? cairnText('all-cairns-screen.left-anonymously') : cairnText('all-cairns-screen.left-by-a-friend'), revision_count: cairn.revision_count, value3: Number(cairn.revision_count) === 1 ? cairnText('all-cairns-screen.version') : cairnText('all-cairns-screen.versions') })}</Text>
          <Text style={[styles.rowMeta, { color: theme.muted }]}>{formatCairnDate(new Date(cairn.acquired_at))}</Text>
        </View>
        {archived ? (
          <TouchableOpacity disabled={restoring} onPress={onRestore} accessibilityRole="button" testID={`found-cairn-restore-${cairn.marker_id}`}>
            <Text style={[styles.restoreText, { color: restoring ? theme.muted : theme.primary }]}>{restoring ? cairnText('all-cairns-screen.restoring') : cairnText('all-cairns-screen.restore')}</Text>
          </TouchableOpacity>
        ) : null}
        {!archived && cairn.availability === 'available' && !cairn.opened_at ? <View style={[styles.unreadDot, { backgroundColor: theme.primary }]} /> : null}
        <Icon name="ChevronRight" size={17} color={theme.iconInactive} strokeWidth={2} />
      </View>
    </LibraryRecordSurface>
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
  const [leftQuery, setLeftQuery] = useState(serverQuery);
  const [foundQuery, setFoundQuery] = useState('');
  const [audience, setAudience] = useState<AudienceFilter>('all');
  const [sort, setSort] = useState<CairnSort>('recent');
  const [section, setSection] = useState<LibrarySection>(route.params?.initialSection ?? 'left');
  const [foundCairns, setFoundCairns] = useState<FoundCairn[]>([]);
  const [foundLoading, setFoundLoading] = useState(false);
  const [foundError, setFoundError] = useState('');
  const [foundHasMore, setFoundHasMore] = useState(false);
  const [foundCollectionState, setFoundCollectionState] = useState<FoundCollectionState>('active');
  const [restoringIds, setRestoringIds] = useState<number[]>([]);
  const restoringRef = useRef(new Set<number>());
  const foundRequestRef = useRef(0);
  const foundCursorRef = useRef<string | null>(null);
  const foundTargetKeyRef = useRef('');
  const ownerId = useAppStore(state => String(state.user?.id ?? ''));
  const query = section === 'left' ? leftQuery : foundQuery;
  const setQuery = section === 'left' ? setLeftQuery : setFoundQuery;
  const audienceFilters: ReadonlyArray<{ key: AudienceFilter; label: string }> = [
    { key: 'all', label: cairnText('all-cairns-screen.all') },
    { key: 'personal', label: cairnText('all-cairns-screen.only-me') },
    { key: 'group', label: cairnText('all-cairns-screen.friends') },
    { key: 'public', label: cairnText('all-cairns-screen.public') },
  ];

  useEffect(() => {
    foundRequestRef.current += 1;
    restoringRef.current.clear();
    foundCursorRef.current = null;
    foundTargetKeyRef.current = '';
    setFoundHasMore(false);
    setFoundCairns([]);
    setFoundError('');
    setRestoringIds([]);
  }, [ownerId]);

  const loadFound = useCallback(async (reset = true) => {
    const request = ++foundRequestRef.current;
    const requestedState = foundCollectionState;
    const requestedOwner = ownerId;
    if (!requestedOwner) return;
    if (reset) foundTargetKeyRef.current = `${requestedOwner}|${requestedState}`;
    setFoundLoading(true);
    setFoundError('');
    try {
      const requestedIds = route.params?.markerIds?.length
        ? new Set(route.params.markerIds.map(String)) : null;
      let cursor = reset ? null : foundCursorRef.current;
      let rows: FoundCairn[] = [];
      let hasMore = false;
      const seenCursors = new Set<string>();
      do {
        const suffix = cursor ? `&cursor=${encodeURIComponent(cursor)}` : '';
        const response = await authenticatedFetch(`/api/cairn-memory/library?section=found&state=${requestedState}&limit=100${suffix}`, {
          expectedUserId: requestedOwner,
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const body = await response.json();
        if (request !== foundRequestRef.current
          || requestedState !== foundCollectionState
          || String(useAppStore.getState().user?.id ?? '') !== requestedOwner) return;
        rows = [...rows, ...(Array.isArray(body.cairns) ? body.cairns : [])];
        hasMore = body.has_more === true;
        const next = typeof body.next_cursor === 'string' && body.next_cursor ? body.next_cursor : null;
        if (!hasMore) cursor = null;
        else {
          if (!next || seenCursors.has(next)) throw new Error('INVALID_LIBRARY_CURSOR_CHAIN');
          seenCursors.add(next);
          cursor = next;
        }
        if (!requestedIds || [...requestedIds].every(id => rows.some(row => String(row.marker_id) === id))) break;
      } while (hasMore);
      foundCursorRef.current = cursor;
      setFoundHasMore(hasMore);
      setFoundCairns(current => {
        const mergedRows = reset ? rows : [...current, ...rows];
        const byId = new Map(mergedRows.map(row => [String(row.marker_id), row]));
        return [...byId.values()];
      });
      void useCairnPresentationStore.getState().refreshAcquiredMap();
    } catch {
      if (request !== foundRequestRef.current) return;
      setFoundError(cairnText('all-cairns-screen.connect-to-refresh-acquired-cairns'));
    } finally {
      if (request === foundRequestRef.current) setFoundLoading(false);
    }
  }, [foundCollectionState, ownerId, route.params?.markerIds]);

  const restoreFound = useCallback(async (markerId: number) => {
    if (restoringRef.current.has(markerId) || !ownerId) return;
    restoringRef.current.add(markerId);
    setRestoringIds(ids => [...ids, markerId]);
    setFoundError('');
    try {
      const response = await authenticatedFetch(`/api/cairn-memory/cairns/${markerId}/collection`, {
        method: 'PUT', body: JSON.stringify({ action: 'restore' }), expectedUserId: ownerId,
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      if (String(useAppStore.getState().user?.id ?? '') !== ownerId) return;
      setFoundCairns(current => current.filter(cairn => cairn.marker_id !== markerId));
      void useCairnPresentationStore.getState().refreshAcquiredMap();
    } catch {
      if (String(useAppStore.getState().user?.id ?? '') === ownerId) setFoundError(cairnText('all-cairns-screen.could-not-restore-this-cairn-try-again'));
    } finally {
      restoringRef.current.delete(markerId);
      if (String(useAppStore.getState().user?.id ?? '') === ownerId) {
        setRestoringIds(ids => ids.filter(id => id !== markerId));
      }
    }
  }, [ownerId]);

  useEffect(() => {
    const key = `${ownerId}|${foundCollectionState}`;
    if (section === 'found' && ownerId && foundTargetKeyRef.current !== key) {
      // The tab highlight is immediate UI intent. Begin target acquisition at
      // the next paint boundary so list/network setup cannot delay that ACK.
      const frame = requestAnimationFrame(() => { void loadFound(true); });
      return () => cancelAnimationFrame(frame);
    }
    return undefined;
  }, [foundCollectionState, loadFound, ownerId, section]);

  useEffect(() => {
    if (coverage === 'not-loaded' && !loading) {
      void loadLibrary({ query: '', reset: true }).catch(() => {});
    }
  }, [coverage, loadLibrary, loading]);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (section !== 'left') return;
      const normalized = leftQuery.trim();
      if (normalized !== serverQuery && !loading) {
        void loadLibrary({ query: normalized, reset: true }).catch(() => {});
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [leftQuery, loadLibrary, loading, section, serverQuery]);

  const merged = useMemo(
    () => mergeOwnedCairns(markers, remoteMarkers),
    [markers, remoteMarkers],
  );
  const visible = useMemo(() => {
    const normalized = leftQuery.trim().toLocaleLowerCase();
    return merged
      .filter(marker => audience === 'all' || marker.permission === audience)
      .filter(marker => !normalized || searchableText(marker).includes(normalized))
      .sort((a, b) => sort === 'recent'
        ? (b.createdAt ?? 0) - (a.createdAt ?? 0)
        : (a.createdAt ?? 0) - (b.createdAt ?? 0));
  }, [audience, leftQuery, merged, sort]);
  const visibleFound = useMemo(() => {
    const normalized = foundQuery.trim().toLocaleLowerCase();
    const requested = route.params?.markerIds?.length ? new Set(route.params.markerIds.map(String)) : null;
    return foundCairns
      .filter(cairn => !requested || requested.has(String(cairn.marker_id)))
      .filter(cairn => !normalized
        || `${cairn.text ?? ''}\n${cairn.author_name ?? ''}`.toLocaleLowerCase().includes(normalized));
  }, [foundCairns, foundQuery, route.params?.markerIds]);

  const refresh = useCallback(() => {
    void loadLibrary({ query: leftQuery.trim(), reset: true }).catch(() => {});
  }, [leftQuery, loadLibrary]);

  const incompleteCopy = error === 'unavailable'
    ? cairnText('all-cairns-screen.showing-cairns-available-on-this-iphone-full')
    : error === 'server-upgrade-required'
      ? cairnText('all-cairns-screen.showing-downloaded-cairns-some-older-cairns-may')
      : coverage === 'partial' && hasMore
        ? cairnText('all-cairns-screen.recent-cairns-are-ready-load-older-cairns')
        : null;

  const showInitialLoading = loading && coverage === 'not-loaded' && visible.length === 0;
  const emptyTitle = leftQuery.trim()
    ? (coverage === 'complete' ? cairnText('all-cairns-screen.no-matching-cairns') : cairnText('all-cairns-screen.no-matches-in-available-cairns'))
    : cairnText('all-cairns-screen.no-cairns-yet');
  const emptyBody = leftQuery.trim()
    ? (coverage === 'complete'
      ? cairnText('all-cairns-screen.try-a-different-name-or-note')
      : cairnText('all-cairns-screen.try-another-search-or-reconnect-to-check'))
    : cairnText('all-cairns-screen.quick-cairns-and-full-plants-will-appear');

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: theme.background }]} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <BackButton variant="inline" testID="all-cairns-back" />
        <Text style={[styles.title, { color: theme.foreground }]}>{cairnText('all-cairns-screen.cairn-library')}</Text>
        <Text style={[styles.subtitle, { color: theme.foregroundSecondary }]}>{cairnText('all-cairns-screen.cairns-you-left-and-versions-you-found')}</Text>
      </View>

      <View style={[styles.sectionTabs, { backgroundColor: theme.surface, borderColor: theme.border }]}>
        {(['left', 'found'] as const).map(value => {
          const selected = section === value;
          return (
            <TouchableOpacity
              key={value}
              style={[styles.sectionTab, selected && { backgroundColor: theme.controlSelected }]}
              onPress={() => setSection(value)}
              accessibilityState={{ selected }}
              testID={`cairn-library-${value}`}
            >
              <Text style={[styles.sectionTabText, { color: selected ? theme.foreground : theme.foregroundSecondary }]}>{value === 'left' ? cairnText('all-cairns-screen.i-left') : cairnText('all-cairns-screen.i-found')}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <LibrarySearchField
          testID="all-cairns-search"
          value={query}
          onChange={setQuery}
          placeholder={section === 'left' ? cairnText('all-cairns-screen.search-names-and-notes') : cairnText('all-cairns-screen.search-found-cairns')}
          label={cairnText('all-cairns-screen.search-your-cairns')}
          style={styles.searchWrap}
      />

      <View style={styles.libraryPanels}>
        <View
          style={[styles.libraryPanel, section !== 'left' && styles.libraryPanelHidden]}
          pointerEvents={section === 'left' ? 'auto' : 'none'}
          accessibilityElementsHidden={section !== 'left'}
          importantForAccessibility={section === 'left' ? 'auto' : 'no-hide-descendants'}
        >
          <View style={styles.controls} testID="all-cairns-controls">
            <Text style={[styles.controlLabel, { color: theme.foregroundSecondary }]}>{cairnText('all-cairns-screen.audience')}</Text>
            <LibraryFilterRow value={audience} options={audienceFilters} onChange={setAudience} testID="all-cairns-filter" />
            <TouchableOpacity
              testID="all-cairns-sort"
              accessibilityRole="button"
              accessibilityLabel={cairnText('all-cairns-screen.sorted-value-change-order', { value1: sort === 'recent' ? cairnText('library.sort.recent-first') : cairnText('library.sort.oldest-first') })}
              onPress={() => setSort(current => current === 'recent' ? 'oldest' : 'recent')}
              style={styles.sortControl}
            >
              <Icon name="ArrowUpDown" size={15} color={theme.iconInactive} strokeWidth={2} />
              <Text style={[styles.sortText, { color: theme.foregroundSecondary }]}>
                {sort === 'recent' ? cairnText('all-cairns-screen.planted-newest-first') : cairnText('all-cairns-screen.planted-oldest-first')}
              </Text>
            </TouchableOpacity>
          </View>
          {incompleteCopy ? (
            <ContentSurface level="record" style={styles.coverage} testID="all-cairns-coverage">
              <View style={styles.coverageRow}>
                <Icon name="CloudOff" size={16} color={theme.iconInactive} strokeWidth={2} />
                <Text style={[styles.coverageText, { color: theme.foregroundSecondary }]}>{incompleteCopy}</Text>
                <TouchableOpacity onPress={refresh} disabled={loading} accessibilityRole="button">
                  <Text style={[styles.retryText, { color: theme.primary }]}>{loading ? cairnText('all-cairns-screen.checking') : cairnText('common.retry')}</Text>
                </TouchableOpacity>
              </View>
            </ContentSurface>
          ) : null}
          {showInitialLoading ? (
            <View style={styles.centerState} testID="all-cairns-loading">
              <ActivityIndicator color={theme.primary} />
              <Text style={[styles.stateTitle, { color: theme.foreground }]}>{cairnText('all-cairns-screen.opening-your-cairns')}</Text>
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
                <View style={styles.centerState} testID={leftQuery.trim() ? 'all-cairns-search-empty' : 'all-cairns-empty'}>
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
                  onPress={() => { void loadLibrary({ query: leftQuery.trim(), reset: false }).catch(() => {}); }}
                  disabled={loading}
                  testID="all-cairns-load-more"
                >
                  {loading ? <ActivityIndicator color={theme.primary} /> : (
                    <Text style={[styles.loadMoreText, { color: theme.foreground }]}>{cairnText('all-cairns-screen.load-older-cairns')}</Text>
                  )}
                </TouchableOpacity>
              ) : null}
            />
          )}
        </View>

        <View
          style={[styles.libraryPanel, section !== 'found' && styles.libraryPanelHidden]}
          pointerEvents={section === 'found' ? 'auto' : 'none'}
          accessibilityElementsHidden={section !== 'found'}
          importantForAccessibility={section === 'found' ? 'auto' : 'no-hide-descendants'}
        >
          <LibraryFilterRow
            value={foundCollectionState}
            options={[{ key: 'active', label: cairnText('all-cairns-screen.current') }, { key: 'archived', label: cairnText('all-cairns-screen.archived') }]}
            onChange={setFoundCollectionState}
            testID="found-cairns-filter"
            style={styles.foundFilterRow}
          />
          {foundLoading && visibleFound.length === 0 ? (
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
                  restoring={restoringIds.includes(item.marker_id)}
                  revisionId={route.params?.revisionIdsByMarker?.[String(item.marker_id)]}
                />
              )}
              contentContainerStyle={[styles.list, visibleFound.length === 0 && styles.listEmpty]}
              refreshControl={<RefreshControl refreshing={foundLoading} onRefresh={() => void loadFound(true)} tintColor={theme.primary} />}
              ListHeaderComponent={foundError ? <Text style={[styles.coverageText, { color: theme.foregroundSecondary }]}>{foundError}</Text> : null}
              ListEmptyComponent={(
                <View style={styles.centerState} testID="found-cairns-empty">
                  <View style={[styles.emptyIcon, { backgroundColor: theme.controlSelected, borderColor: theme.borderStrong }]}>
                    <Icon name="MapPin" size={24} color={theme.iconActive} strokeWidth={2} />
                  </View>
                  <Text style={[styles.stateTitle, { color: theme.foreground }]}>{foundCollectionState === 'archived' ? cairnText('all-cairns-screen.no-archived-cairns') : cairnText('all-cairns-screen.no-acquired-cairns-yet')}</Text>
                  <Text style={[styles.stateBody, { color: theme.foregroundSecondary }]}>{foundCollectionState === 'archived' ? cairnText('all-cairns-screen.archived-cairns-can-be-restored-here') : cairnText('all-cairns-screen.cairns-discovered-during-eligible-visits-will-appear')}</Text>
                </View>
              )}
              ListFooterComponent={foundHasMore ? (
                <TouchableOpacity
                  style={[styles.loadMore, { borderColor: theme.borderStrong, backgroundColor: theme.secondaryAction }]}
                  onPress={() => { void loadFound(false); }}
                  disabled={foundLoading}
                  testID="found-cairns-load-more"
                >
                  {foundLoading ? <ActivityIndicator color={theme.primary} /> : (
                    <Text style={[styles.loadMoreText, { color: theme.foreground }]}>{cairnText('all-cairns-screen.load-older-found-cairns')}</Text>
                  )}
                </TouchableOpacity>
              ) : null}
            />
          )}
        </View>
      </View>
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
  },
  sectionTabs: { marginHorizontal: Spacing.xl, marginBottom: Spacing.md, padding: 3, borderWidth: 1, borderRadius: RadiusRole.button, flexDirection: 'row' },
  sectionTab: { flex: 1, minHeight: 38, borderRadius: RadiusRole.button, alignItems: 'center', justifyContent: 'center' },
  sectionTabText: { fontSize: FontSize.small, fontWeight: '700' },
  libraryPanels: { flex: 1 },
  libraryPanel: { flex: 1 },
  libraryPanelHidden: { display: 'none' },
  controls: { paddingHorizontal: Spacing.xl, paddingTop: Spacing.md, gap: Spacing.sm },
  controlLabel: { fontSize: FontSize.caption, fontWeight: '700', letterSpacing: 0.8 },
  foundFilterRow: { marginHorizontal: Spacing.xl, marginTop: Spacing.md },
  sortControl: { minHeight: 32, alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
  sortText: { fontSize: FontSize.small, fontWeight: '600' },
  coverage: { marginHorizontal: Spacing.xl, marginTop: Spacing.md },
  coverageRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  coverageText: { flex: 1, fontSize: FontSize.small, lineHeight: 18 },
  retryText: { fontSize: FontSize.small, fontWeight: '700' },
  list: { paddingHorizontal: Spacing.xl, paddingTop: Spacing.lg, paddingBottom: Spacing.xxl },
  listEmpty: { flexGrow: 1 },
  row: { minHeight: 70, flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingHorizontal: Spacing.md, paddingVertical: Spacing.md },
  rowIcon: {
    width: 34,
    height: 34,
    alignSelf: 'flex-start',
    alignItems: 'center',
    justifyContent: 'flex-start',
    marginTop: -2,
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
