import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/RootNavigator';
import { authenticatedFetch } from '../services/apiService';
import { BackButton } from '../components/BackButton';
import { ContentSurface } from '../components/ContentSurface';
import { PrimaryButton } from '../components/PrimaryButton';
import { Icon } from '../components/Icon';
import { FontSize, Spacing } from '../components/tokens';
import { useVisualTheme } from '../hooks/useVisualTheme';
import * as Crypto from 'expo-crypto';
import { useCairnPresentationStore } from '../features/cairns/cairnPresentationStore';
import {
  beginAcquiredCairnHistoryRequest,
  acquiredCairnHistoryRequestIsCurrent,
  cacheAcquiredCairnHistory,
  loadCachedAcquiredCairnHistory,
  markAcquiredCairnKnownUnavailable,
  updateCachedAcquiredRevision,
  type CachedAcquiredCairnRevision,
} from '../features/cairns/acquiredCairnHistoryCache';
import { useAppStore } from '../store/useAppStore';

type DetailRoute = RouteProp<RootStackParamList, 'AcquiredCairnDetail'>;
type Nav = NativeStackNavigationProp<RootStackParamList>;
export function AcquiredCairnDetailScreen() {
  const theme = useVisualTheme();
  const route = useRoute<DetailRoute>();
  const nav = useNavigation<Nav>();
  const ownerId = useAppStore(state => String(state.user?.id ?? ''));
  const [revisions, setRevisions] = useState<CachedAcquiredCairnRevision[]>([]);
  const [pageIndex, setPageIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reviewMessage, setReviewMessage] = useState('');
  const [showingOfflineCopy, setShowingOfflineCopy] = useState(false);
  const actionFlights = useRef(new Set<string>());
  const loadGeneration = useRef(0);

  const load = useCallback(async () => {
    const generation = ++loadGeneration.current;
    const isCurrentOwner = () => loadGeneration.current === generation
      && String(useAppStore.getState().user?.id ?? '') === ownerId;
    setLoading(true);
    setError('');
    setShowingOfflineCopy(false);
    try {
      const requestEpoch = beginAcquiredCairnHistoryRequest(ownerId, route.params.markerId);
      const response = await authenticatedFetch(`/api/cairn-memory/cairns/${encodeURIComponent(route.params.markerId)}/history`, {
        expectedUserId: ownerId,
        skipLogoutOn401: true,
      });
      if (!isCurrentOwner()) return;
      if (!response.ok) {
        if ([403, 404, 410].includes(response.status)) {
          await markAcquiredCairnKnownUnavailable(ownerId, route.params.markerId);
          throw new Error('KNOWN_UNAVAILABLE');
        }
        if (response.status === 401) throw new Error('AUTHORIZATION_UNCONFIRMED');
        throw new Error(`HTTP_${response.status}`);
      }
      const body = await response.json();
      if (!isCurrentOwner()) return;
      const networkRevisions = Array.isArray(body.revisions) ? body.revisions : [];
      if (networkRevisions.length === 0) {
        await markAcquiredCairnKnownUnavailable(ownerId, route.params.markerId);
        throw new Error('KNOWN_UNAVAILABLE');
      }
      let next: CachedAcquiredCairnRevision[];
      try {
        next = await cacheAcquiredCairnHistory(ownerId, route.params.markerId, networkRevisions, requestEpoch);
      } catch {
        throw new Error('AUTHORIZATION_UNCONFIRMED');
      }
      if (!isCurrentOwner()) return;
      if (!acquiredCairnHistoryRequestIsCurrent(ownerId, route.params.markerId, requestEpoch)) {
        setRevisions([]);
        setError('This acquired Cairn is unavailable right now.');
        return;
      }
      setRevisions(next);
      setPageIndex(0);
    } catch (cause) {
      if (!isCurrentOwner()) return;
      const reason = cause instanceof Error ? cause.message : '';
      if (reason === 'KNOWN_UNAVAILABLE' || reason === 'AUTHORIZATION_UNCONFIRMED') {
        setRevisions([]);
        setError('This acquired Cairn is unavailable right now.');
      } else {
        const cached = await loadCachedAcquiredCairnHistory(ownerId, route.params.markerId).catch(() => null);
        if (!isCurrentOwner()) return;
        if (cached?.length) {
          setRevisions(cached);
          setPageIndex(0);
          setShowingOfflineCopy(true);
        } else setError('This acquired Cairn is unavailable right now.');
      }
    } finally {
      if (isCurrentOwner()) setLoading(false);
    }
  }, [ownerId, route.params.markerId]);

  useEffect(() => {
    void load();
    return () => { loadGeneration.current += 1; };
  }, [load]);

  useEffect(() => {
    const revision = revisions[pageIndex];
    if (!revision || revision.availability !== 'available' || revision.opened_at) return;
    const flightKey = `read:${revision.revision_id}`;
    if (actionFlights.current.has(flightKey)) return;
    actionFlights.current.add(flightKey);
    let active = true;
    void authenticatedFetch(`/api/cairn-memory/revisions/${revision.revision_id}/read`, {
      method: 'POST', body: '{}', expectedUserId: ownerId, skipLogoutOn401: true,
    }).then(response => {
      if (!active) return;
      if (!response.ok) {
        setReviewMessage('Could not mark this page as read. It remains unread.');
        return;
      }
      const openedAt = new Date().toISOString();
      setRevisions(current => current.map(item => item.revision_id === revision.revision_id
        ? { ...item, opened_at: item.opened_at || openedAt }
        : item));
      void updateCachedAcquiredRevision(ownerId, route.params.markerId, revision.revision_id, { opened_at: openedAt });
      void useCairnPresentationStore.getState().refreshAcquiredMap();
    }).catch(() => {
      if (active) setReviewMessage('Could not mark this page as read. It remains unread.');
    }).finally(() => actionFlights.current.delete(flightKey));
    return () => { active = false; };
  }, [ownerId, pageIndex, revisions, route.params.markerId]);

  const updateCollection = async (action: 'archive' | 'remove') => {
    const flightKey = `collection:${action}`;
    if (actionFlights.current.has(flightKey)) return;
    actionFlights.current.add(flightKey);
    try {
      const response = await authenticatedFetch(`/api/cairn-memory/cairns/${encodeURIComponent(route.params.markerId)}/collection`, {
        method: 'PUT', body: JSON.stringify({ action }), expectedUserId: ownerId, skipLogoutOn401: true,
      });
      if (String(useAppStore.getState().user?.id ?? '') !== ownerId) return;
      if (response.ok) {
        if (action === 'remove') await markAcquiredCairnKnownUnavailable(ownerId, route.params.markerId);
        void useCairnPresentationStore.getState().refreshAcquiredMap();
        nav.goBack();
      } else setError('Could not update this Memory collection.');
    } catch {
      setError('Could not update this Memory collection.');
    } finally { actionFlights.current.delete(flightKey); }
  };

  const confirmRemove = () => Alert.alert(
    'Remove from my Memory?',
    'This removes your acquired pages from this collection. It does not affect the author or your Fog.',
    [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => void updateCollection('remove') },
    ],
  );

  const thank = async (revisionId: number) => {
    const flightKey = `thanks:${revisionId}`;
    if (actionFlights.current.has(flightKey)) return;
    actionFlights.current.add(flightKey);
    try {
      const response = await authenticatedFetch(`/api/cairn-memory/revisions/${revisionId}/thanks`, {
        method: 'POST', body: '{}', expectedUserId: ownerId, skipLogoutOn401: true,
      });
      if (String(useAppStore.getState().user?.id ?? '') !== ownerId) return;
      if (response.ok) {
        const thankedAt = new Date().toISOString();
        setRevisions(current => current.map(revision => revision.revision_id === revisionId
          ? { ...revision, thanked_at: revision.thanked_at || thankedAt }
          : revision));
        await updateCachedAcquiredRevision(ownerId, route.params.markerId, revisionId, { thanked_at: thankedAt });
      } else setReviewMessage('Could not send Thanks. Try again later.');
    } catch { setReviewMessage('Could not send Thanks. Try again later.'); }
    finally { actionFlights.current.delete(flightKey); }
  };

  const report = async (revisionId: number) => {
    const flightKey = `report:${revisionId}`;
    if (actionFlights.current.has(flightKey)) return;
    actionFlights.current.add(flightKey);
    try {
      const response = await authenticatedFetch(`/api/cairn-memory/revisions/${revisionId}/cases`, {
        method: 'POST', expectedUserId: ownerId, skipLogoutOn401: true,
        body: JSON.stringify({
          client_submission_id: Crypto.randomUUID(),
          case_type: 'report',
          category: 'other',
        }),
      });
      if (String(useAppStore.getState().user?.id ?? '') !== ownerId) return;
      setReviewMessage(response.ok ? 'Report sent for review.' : 'Could not send the report. Try again later.');
    } catch { setReviewMessage('Could not send the report. Try again later.'); }
    finally { actionFlights.current.delete(flightKey); }
  };

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: theme.background }]} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <BackButton variant="inline" />
        <Text style={[styles.title, { color: theme.foreground }]}>Found Cairn</Text>
        <Text style={[styles.subtitle, { color: theme.foregroundSecondary }]}>Versions you acquired during genuine visits remain in your Memory.</Text>
      </View>
      {loading ? <ActivityIndicator style={styles.loading} color={theme.primary} /> : error ? (
        <View style={styles.state}>
          <Text style={[styles.body, { color: theme.foregroundSecondary }]}>{error}</Text>
          <PrimaryButton label="Try again" onPress={() => void load()} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.content}>
          {showingOfflineCopy ? (
            <View style={[styles.offlineNotice, { backgroundColor: theme.surface, borderColor: theme.border }]}>
              <Icon name="CloudOff" size={16} color={theme.iconInactive} />
              <Text style={[styles.meta, { color: theme.foregroundSecondary }]}>Offline copy from this account. This device keeps up to the latest 100 acquired versions; reconnect for older history and new actions.</Text>
            </View>
          ) : null}
          {revisions[pageIndex] ? (() => {
            const revision = revisions[pageIndex];
            return (
            <ContentSurface key={revision.revision_id} level="record" style={styles.card}>
              <View style={styles.revisionHeader}>
                <Text style={[styles.revisionTitle, { color: theme.foreground }]}>Found {new Date(revision.acquired_at).toLocaleDateString()}</Text>
                <Text style={[styles.meta, { color: theme.foregroundSecondary }]}>{pageIndex === 0 ? 'Latest acquired' : 'Earlier acquired'}</Text>
              </View>
              {revision.availability === 'available' ? (
                <Text style={[styles.body, { color: theme.foreground }]}>{revision.text?.trim() || 'A moment here'}</Text>
              ) : (
                <View style={styles.unavailable}>
                  <Icon name="Shield" size={16} color={theme.iconInactive} />
                  <Text style={[styles.body, { color: theme.foregroundSecondary }]}>Content {revision.availability === 'under_review' ? 'is under review' : 'is unavailable'}.</Text>
                </View>
              )}
              <Text style={[styles.meta, { color: theme.muted }]}>Found {new Date(revision.acquired_at).toLocaleDateString()} · {revision.source_audience === 'friends' ? 'Friend' : 'Public'}</Text>
              {revision.availability === 'available' ? (
                <View style={styles.actions}>
                  <TouchableOpacity
                    onPress={() => void thank(revision.revision_id)}
                    disabled={Boolean(revision.thanked_at) || !revision.opened_at}
                    accessibilityRole="button"
                    style={styles.thanks}
                  >
                    <Icon name="Heart" size={16} color={revision.thanked_at ? theme.iconInactive : theme.iconActive} />
                    <Text style={[styles.thanksText, { color: revision.thanked_at ? theme.muted : theme.primary }]}>{revision.thanked_at ? 'Thanked' : 'Thanks'}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => void report(revision.revision_id)} style={styles.thanks} accessibilityRole="button">
                    <Icon name="Flag" size={16} color={theme.iconInactive} />
                    <Text style={[styles.thanksText, { color: theme.foregroundSecondary }]}>Report</Text>
                  </TouchableOpacity>
                </View>
              ) : null}
            </ContentSurface>
            );
          })() : null}
          {revisions.length > 1 ? (
            <View style={styles.pager}>
              <TouchableOpacity
                disabled={pageIndex >= revisions.length - 1}
                onPress={() => setPageIndex(current => Math.min(revisions.length - 1, current + 1))}
                accessibilityRole="button"
                style={[styles.pageButton, pageIndex >= revisions.length - 1 && styles.disabled]}
              >
                <Text style={[styles.pageButtonText, { color: theme.foregroundSecondary }]}>Earlier</Text>
              </TouchableOpacity>
              <Text style={[styles.meta, { color: theme.muted }]}>{pageIndex + 1} of {revisions.length}</Text>
              <TouchableOpacity
                disabled={pageIndex === 0}
                onPress={() => setPageIndex(current => Math.max(0, current - 1))}
                accessibilityRole="button"
                style={[styles.pageButton, pageIndex === 0 && styles.disabled]}
              >
                <Text style={[styles.pageButtonText, { color: theme.foregroundSecondary }]}>Newer</Text>
              </TouchableOpacity>
            </View>
          ) : null}
          <View style={styles.collectionActions}>
            <PrimaryButton label="Archive from default view" variant="secondary" onPress={() => void updateCollection('archive')} />
            <TouchableOpacity onPress={confirmRemove} accessibilityRole="button" style={styles.removeAction}>
              <Text style={[styles.removeText, { color: theme.destructive }]}>Remove from my Memory</Text>
            </TouchableOpacity>
          </View>
          {reviewMessage ? <Text style={[styles.meta, { color: theme.foregroundSecondary }]}>{reviewMessage}</Text> : null}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { paddingHorizontal: Spacing.xl, paddingTop: Spacing.sm, paddingBottom: Spacing.md },
  title: { fontSize: FontSize.h1, lineHeight: 34, fontWeight: '700', marginTop: Spacing.lg },
  subtitle: { fontSize: FontSize.body, lineHeight: 20, marginTop: Spacing.xs },
  loading: { marginTop: 80 },
  state: { flex: 1, padding: Spacing.xl, gap: Spacing.lg, justifyContent: 'center' },
  content: { padding: Spacing.xl, gap: Spacing.md, paddingBottom: Spacing.xxl },
  card: { padding: Spacing.lg, gap: Spacing.md },
  revisionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  revisionTitle: { fontSize: FontSize.body, fontWeight: '700' },
  body: { fontSize: FontSize.body, lineHeight: 21 },
  meta: { fontSize: FontSize.small },
  unavailable: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  offlineNotice: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, borderWidth: 1, borderRadius: 12, padding: Spacing.md },
  thanks: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs, alignSelf: 'flex-start', minHeight: 36 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xl },
  thanksText: { fontSize: FontSize.small, fontWeight: '700' },
  pager: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  pageButton: { minHeight: 40, minWidth: 72, alignItems: 'center', justifyContent: 'center' },
  pageButtonText: { fontSize: FontSize.small, fontWeight: '700' },
  disabled: { opacity: 0.35 },
  collectionActions: { gap: Spacing.md, marginTop: Spacing.md },
  removeAction: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  removeText: { fontSize: FontSize.small, fontWeight: '700' },
});
