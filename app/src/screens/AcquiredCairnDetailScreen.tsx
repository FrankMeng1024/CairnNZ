import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Animated, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/RootNavigator';
import { authenticatedFetch } from '../services/apiService';
import { BackButton } from '../components/BackButton';
import { PrimaryButton } from '../components/PrimaryButton';
import { Icon } from '../components/Icon';
import { BottomSheetContent, BottomSheetFrame, BottomSheetHeader } from '../components/BottomSheetFrame';
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
import { splitTitleBody } from '../features/plant/services/noteEncoding';
import {
  CairnPaper,
  CairnStatusPill,
  CairnStoneMark,
  useCairnPaperExit,
} from '../features/cairns/components/CairnPaper';
import { cairnText, formatCairnDate } from '../i18n/runtime';

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
  const [actionError, setActionError] = useState('');
  const [collectionAction, setCollectionAction] = useState<'archive' | 'remove' | null>(null);
  const [manageOpen, setManageOpen] = useState(false);
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const [showingOfflineCopy, setShowingOfflineCopy] = useState(false);
  const actionFlights = useRef(new Set<string>());
  const collectionFlight = useRef<object | null>(null);
  const loadGeneration = useRef(0);
  const closing = useRef(false);
  const { style: paperExitStyle, run: runPaperExit } = useCairnPaperExit();

  const closeWithPaper = useCallback(() => {
    if (closing.current) return;
    closing.current = true;
    if (!revisions[pageIndex]) {
      nav.goBack();
      return;
    }
    runPaperExit(() => nav.goBack());
  }, [nav, pageIndex, revisions, runPaperExit]);

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
        setError(cairnText('acquired-cairn-detail-screen.this-acquired-cairn-is-unavailable-right-now'));
        return;
      }
      const exactIndex = route.params.revisionId
        ? next.findIndex(revision => String(revision.revision_id) === route.params.revisionId)
        : 0;
      if (route.params.revisionId && exactIndex < 0) {
        setRevisions([]);
        setError(cairnText('acquired-cairn-detail-screen.this-exact-encountered-version-is-no-longer'));
        return;
      }
      setRevisions(next);
      setPageIndex(Math.max(0, exactIndex));
    } catch (cause) {
      if (!isCurrentOwner()) return;
      const reason = cause instanceof Error ? cause.message : '';
      if (reason === 'KNOWN_UNAVAILABLE' || reason === 'AUTHORIZATION_UNCONFIRMED') {
        setRevisions([]);
        setError(cairnText('acquired-cairn-detail-screen.this-acquired-cairn-is-unavailable-right-now'));
      } else {
        const cached = await loadCachedAcquiredCairnHistory(ownerId, route.params.markerId).catch(() => null);
        if (!isCurrentOwner()) return;
        const cachedExactIndex = route.params.revisionId
          ? cached?.findIndex(revision => String(revision.revision_id) === route.params.revisionId) ?? -1
          : 0;
        if (cached?.length && cachedExactIndex >= 0) {
          setRevisions(cached);
          setPageIndex(cachedExactIndex);
          setShowingOfflineCopy(true);
        } else if (route.params.revisionId) {
          setError(cairnText('acquired-cairn-detail-screen.this-exact-encountered-version-is-unavailable-right'));
        } else setError(cairnText('acquired-cairn-detail-screen.this-acquired-cairn-is-unavailable-right-now'));
      }
    } finally {
      if (isCurrentOwner()) setLoading(false);
    }
  }, [ownerId, route.params.markerId, route.params.revisionId]);

  useEffect(() => {
    void load();
    return () => { loadGeneration.current += 1; };
  }, [load]);

  useEffect(() => {
    // An action belongs to the account that opened the sheet. A replacement
    // session must start with fresh controls, while a late response from the
    // prior account remains unable to close or mutate the new account's view.
    collectionFlight.current = null;
    setCollectionAction(null);
    setManageOpen(false);
    setConfirmingRemove(false);
    setActionError('');
  }, [ownerId]);

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
        setReviewMessage(cairnText('acquired-cairn-detail-screen.could-not-mark-this-page-as-read'));
        return;
      }
      const openedAt = new Date().toISOString();
      setRevisions(current => current.map(item => item.revision_id === revision.revision_id
        ? { ...item, opened_at: item.opened_at || openedAt }
        : item));
      void updateCachedAcquiredRevision(ownerId, route.params.markerId, revision.revision_id, { opened_at: openedAt });
      void useCairnPresentationStore.getState().refreshAcquiredMap();
    }).catch(() => {
      if (active) setReviewMessage(cairnText('acquired-cairn-detail-screen.could-not-mark-this-page-as-read'));
    }).finally(() => actionFlights.current.delete(flightKey));
    return () => { active = false; };
  }, [ownerId, pageIndex, revisions, route.params.markerId]);

  const updateCollection = async (action: 'archive' | 'remove') => {
    if (collectionFlight.current) return;
    const flight = {};
    collectionFlight.current = flight;
    setCollectionAction(action);
    setActionError('');
    let accepted = false;
    try {
      const response = await authenticatedFetch(`/api/cairn-memory/cairns/${encodeURIComponent(route.params.markerId)}/collection`, {
        method: 'PUT', body: JSON.stringify({ action }), expectedUserId: ownerId, skipLogoutOn401: true,
      });
      if (String(useAppStore.getState().user?.id ?? '') !== ownerId) return;
      if (response.ok) {
        if (action === 'remove') await markAcquiredCairnKnownUnavailable(ownerId, route.params.markerId);
        void useCairnPresentationStore.getState().refreshAcquiredMap();
        accepted = true;
        setManageOpen(false);
        setConfirmingRemove(false);
        closeWithPaper();
      } else if ([403, 404, 410].includes(response.status)) {
        await markAcquiredCairnKnownUnavailable(ownerId, route.params.markerId);
        setManageOpen(false);
        setConfirmingRemove(false);
        setRevisions([]);
        setError(cairnText('acquired-cairn-detail-screen.this-acquired-cairn-is-no-longer-available'));
      } else {
        setActionError(cairnText('acquired-cairn-detail-screen.value-did-not-complete-the-cairn-is', { value1: action === 'archive' ? cairnText('common.action.archive') : cairnText('common.action.remove') }));
      }
    } catch {
      setActionError(cairnText('acquired-cairn-detail-screen.value-did-not-complete-the-cairn-is', { value1: action === 'archive' ? cairnText('common.action.archive') : cairnText('common.action.remove') }));
    } finally {
      if (collectionFlight.current === flight) collectionFlight.current = null;
      if (!accepted && String(useAppStore.getState().user?.id ?? '') === ownerId) setCollectionAction(null);
    }
  };

  const dismissManage = () => {
    if (collectionAction !== null) return;
    setManageOpen(false);
    setConfirmingRemove(false);
    setActionError('');
  };

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
      } else setReviewMessage(cairnText('acquired-cairn-detail-screen.could-not-send-thanks-try-again-later'));
    } catch { setReviewMessage(cairnText('acquired-cairn-detail-screen.could-not-send-thanks-try-again-later')); }
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
      setReviewMessage(response.ok ? cairnText('acquired-cairn-detail-screen.report-sent-for-review') : cairnText('acquired-cairn-detail-screen.could-not-send-the-report-try-again'));
    } catch { setReviewMessage(cairnText('acquired-cairn-detail-screen.could-not-send-the-report-try-again')); }
    finally { actionFlights.current.delete(flightKey); }
  };

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: theme.background }]} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <BackButton variant="inline" onPress={closeWithPaper} testID="acquired-cairn-close" />
        <Text style={[styles.title, { color: theme.foreground }]}>{cairnText('acquired-cairn-detail-screen.found-cairn')}</Text>
        <Text style={[styles.subtitle, { color: theme.foregroundSecondary }]}>{cairnText('acquired-cairn-detail-screen.versions-you-acquired-during-genuine-visits-remain')}</Text>
      </View>
      {loading ? <ActivityIndicator style={styles.loading} color={theme.primary} /> : error ? (
        <View style={styles.state}>
          <Text style={[styles.body, { color: theme.foregroundSecondary }]}>{error}</Text>
          <PrimaryButton label={cairnText('acquired-cairn-detail-screen.try-again')} onPress={() => void load()} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.content}>
          {showingOfflineCopy ? (
            <View style={[styles.offlineNotice, { backgroundColor: theme.surface, borderColor: theme.border }]}>
              <Icon name="CloudOff" size={16} color={theme.iconInactive} />
              <Text style={[styles.meta, { color: theme.foregroundSecondary }]}>{cairnText('acquired-cairn-detail-screen.offline-copy-from-this-account-this-device')}</Text>
            </View>
          ) : null}
          {revisions[pageIndex] ? (() => {
            const revision = revisions[pageIndex];
            const words = splitTitleBody(revision.text ?? '');
            return (
            <Animated.View key={revision.revision_id} style={paperExitStyle}>
            <CairnPaper style={styles.card} testID="acquired-cairn-paper">
              <View style={styles.revisionHeader}>
                <View style={styles.revisionIdentity}>
                  <CairnStoneMark size={34} tone={revision.source_audience === 'friends' ? 'friends' : 'public'} />
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.revisionTitle, { color: theme.foreground }]}>{cairnText('acquired-cairn-detail-screen.found-value', { value1: formatCairnDate(new Date(revision.acquired_at)) })}</Text>
                    <Text style={[styles.meta, { color: theme.foregroundSecondary }]}>{revision.source_audience === 'friends' ? cairnText('acquired-cairn-detail-screen.left-by-a-friend') : cairnText('acquired-cairn-detail-screen.left-anonymously')}</Text>
                  </View>
                </View>
                <CairnStatusPill label={pageIndex === 0 ? cairnText('acquired-cairn-detail-screen.latest-found') : cairnText('acquired-cairn-detail-screen.version-value', { content_revision: revision.content_revision })} tone="muted" />
              </View>
              {revision.availability === 'available' ? (
                <View style={styles.noteCopy}>
                  {words.title.trim() ? <Text style={[styles.noteTitle, { color: theme.foreground }]}>{words.title}</Text> : null}
                  <Text style={[styles.body, { color: words.body.trim() ? theme.foreground : theme.muted }]}>
                    {words.body.trim() || (words.title.trim() ? '' : cairnText('acquired-cairn-detail-screen.a-quiet-marker-of-this-place'))}
                  </Text>
                </View>
              ) : (
                <View style={styles.unavailable}>
                  <Icon name="Shield" size={16} color={theme.iconInactive} />
                  <Text style={[styles.body, { color: theme.foregroundSecondary }]}>{cairnText('acquired-cairn-detail-screen.content-value', { value1: revision.availability === 'under_review' ? cairnText('acquired-cairn-detail-screen.is-under-review') : cairnText('acquired-cairn-detail-screen.is-unavailable') })}</Text>
                </View>
              )}
              <Text style={[styles.meta, { color: theme.muted }]}>{cairnText('acquired-cairn-detail-screen.found-value-value', { value1: formatCairnDate(new Date(revision.acquired_at)), value2: revision.source_audience === 'friends' ? cairnText('acquired-cairn-detail-screen.friend') : cairnText('acquired-cairn-detail-screen.public') })}</Text>
              {revision.availability === 'available' ? (
                <View style={styles.actions}>
                  <TouchableOpacity
                    onPress={() => void thank(revision.revision_id)}
                    disabled={Boolean(revision.thanked_at) || !revision.opened_at}
                    accessibilityRole="button"
                    style={styles.thanks}
                  >
                    <Icon name="Heart" size={16} color={revision.thanked_at ? theme.iconInactive : theme.iconActive} />
                    <Text style={[styles.thanksText, { color: revision.thanked_at ? theme.muted : theme.primary }]}>{revision.thanked_at ? cairnText('acquired-cairn-detail-screen.thanked') : cairnText('acquired-cairn-detail-screen.thanks')}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => void report(revision.revision_id)} style={styles.thanks} accessibilityRole="button">
                    <Icon name="Flag" size={16} color={theme.iconInactive} />
                    <Text style={[styles.thanksText, { color: theme.foregroundSecondary }]}>{cairnText('acquired-cairn-detail-screen.report')}</Text>
                  </TouchableOpacity>
                </View>
              ) : null}
            </CairnPaper>
            </Animated.View>
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
                <Text style={[styles.pageButtonText, { color: theme.foregroundSecondary }]}>{cairnText('acquired-cairn-detail-screen.earlier')}</Text>
              </TouchableOpacity>
              <Text style={[styles.meta, { color: theme.muted }]}>{cairnText('acquired-cairn-detail-screen.value-of-value', { value1: pageIndex + 1, length: revisions.length })}</Text>
              <TouchableOpacity
                disabled={pageIndex === 0}
                onPress={() => setPageIndex(current => Math.max(0, current - 1))}
                accessibilityRole="button"
                style={[styles.pageButton, pageIndex === 0 && styles.disabled]}
              >
                <Text style={[styles.pageButtonText, { color: theme.foregroundSecondary }]}>{cairnText('acquired-cairn-detail-screen.newer')}</Text>
              </TouchableOpacity>
            </View>
          ) : null}
          <TouchableOpacity
            onPress={() => {
              setActionError('');
              setConfirmingRemove(false);
              setManageOpen(true);
            }}
            accessibilityRole="button"
            accessibilityLabel={cairnText('acquired-cairn-detail-screen.manage-found-cairn')}
            accessibilityHint={cairnText('acquired-cairn-detail-screen.opens-archive-and-remove-controls')}
            style={[styles.manageTrigger, { borderColor: theme.borderSubtle }]}
          >
            <Icon name="MoreHorizontal" size={18} color={theme.iconInactive} />
            <Text style={[styles.manageTriggerText, { color: theme.foregroundSecondary }]}>{cairnText('acquired-cairn-detail-screen.manage')}</Text>
          </TouchableOpacity>
          {reviewMessage ? <Text style={[styles.meta, { color: theme.foregroundSecondary }]}>{reviewMessage}</Text> : null}
        </ScrollView>
      )}
      <BottomSheetFrame
        visible={manageOpen}
        onDismiss={dismissManage}
        dismissible={collectionAction === null}
        maxHeight="82%"
        testID="acquired-cairn-manage-sheet"
      >
        <BottomSheetHeader
          title={confirmingRemove ? cairnText('acquired-cairn-detail-screen.remove-from-my-memory') : cairnText('acquired-cairn-detail-screen.manage-found-cairn')}
          subtitle={confirmingRemove
            ? cairnText('acquired-cairn-detail-screen.this-affects-only-your-acquired-collection')
            : cairnText('acquired-cairn-detail-screen.choose-how-this-cairn-appears-in-your')}
          onClose={collectionAction === null ? dismissManage : undefined}
        />
        <BottomSheetContent scrollable contentContainerStyle={styles.manageContent}>
          {confirmingRemove ? (
            <>
              <View style={[styles.consequenceCard, { backgroundColor: theme.destructiveSurface, borderColor: theme.destructive }]}>
                <Icon name="Trash2" size={20} color={theme.destructive} />
                <Text style={[styles.collectionHelp, { color: theme.foreground }]}>{cairnText('acquired-cairn-detail-screen.remove-hides-every-acquired-page-and-blocks')}</Text>
              </View>
              {actionError ? (
                <View style={[styles.actionError, { borderColor: theme.destructive }]}>
                  <Text accessibilityLiveRegion="polite" style={[styles.collectionHelp, { color: theme.destructive }]}>{actionError}</Text>
                </View>
              ) : null}
              <View style={styles.confirmationRow}>
                <TouchableOpacity
                  onPress={() => {
                    setConfirmingRemove(false);
                    setActionError('');
                  }}
                  disabled={collectionAction !== null}
                  accessibilityRole="button"
                  style={[styles.confirmationButton, { borderColor: theme.borderStrong }, collectionAction !== null && styles.disabled]}
                >
                  <Text style={[styles.collectionActionText, { color: theme.foreground }]}>{cairnText('common.cancel')}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => void updateCollection('remove')}
                  disabled={collectionAction !== null}
                  accessibilityRole="button"
                  accessibilityLabel={cairnText('acquired-cairn-detail-screen.confirm-remove-from-my-memory')}
                  accessibilityState={{ disabled: collectionAction !== null, busy: collectionAction === 'remove' }}
                  style={[styles.confirmationButton, { backgroundColor: theme.destructive, borderColor: theme.destructive }, collectionAction !== null && styles.disabled]}
                >
                  {collectionAction === 'remove' ? <ActivityIndicator size="small" color={theme.onPrimary} /> : <Icon name="Trash2" size={16} color={theme.onPrimary} />}
                  <Text style={[styles.collectionActionText, { color: theme.onPrimary }]}>{collectionAction === 'remove' ? cairnText('acquired-cairn-detail-screen.removing') : cairnText('acquired-cairn-detail-screen.remove')}</Text>
                </TouchableOpacity>
              </View>
            </>
          ) : (
            <>
              <TouchableOpacity
                onPress={() => void updateCollection('archive')}
                disabled={collectionAction !== null}
                accessibilityRole="button"
                accessibilityLabel={cairnText('acquired-cairn-detail-screen.archive-from-current')}
                accessibilityHint={cairnText('acquired-cairn-detail-screen.keeps-all-acquired-pages-in-archived-where')}
                accessibilityState={{ disabled: collectionAction !== null, busy: collectionAction === 'archive' }}
                style={[styles.managementOption, { backgroundColor: theme.secondaryAction, borderColor: theme.borderSubtle }, collectionAction !== null && styles.disabled]}
              >
                <View style={[styles.managementIcon, { backgroundColor: theme.surfaceElevated }]}>
                  {collectionAction === 'archive' ? <ActivityIndicator size="small" color={theme.primary} /> : <Icon name="Layers" size={20} color={theme.icon} />}
                </View>
                <View style={styles.managementCopy}>
                  <Text style={[styles.managementTitle, { color: theme.foreground }]}>{collectionAction === 'archive' ? cairnText('acquired-cairn-detail-screen.archiving') : cairnText('acquired-cairn-detail-screen.archive')}</Text>
                  <Text style={[styles.collectionHelp, { color: theme.foregroundSecondary }]}>{cairnText('acquired-cairn-detail-screen.hide-from-current-every-acquired-page-stays')}</Text>
                </View>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => {
                  setActionError('');
                  setConfirmingRemove(true);
                }}
                disabled={collectionAction !== null}
                accessibilityRole="button"
                accessibilityLabel={cairnText('acquired-cairn-detail-screen.remove-from-my-memory-0cc3927')}
                accessibilityHint={cairnText('acquired-cairn-detail-screen.opens-a-confirmation-before-removing-acquired-pages')}
                style={[styles.managementOption, { backgroundColor: theme.destructiveSurface, borderColor: theme.borderSubtle }, collectionAction !== null && styles.disabled]}
              >
                <View style={[styles.managementIcon, { backgroundColor: theme.surfaceElevated }]}>
                  <Icon name="Trash2" size={20} color={theme.destructive} />
                </View>
                <View style={styles.managementCopy}>
                  <Text style={[styles.managementTitle, { color: theme.destructive }]}>{cairnText('acquired-cairn-detail-screen.remove')}</Text>
                  <Text style={[styles.collectionHelp, { color: theme.foregroundSecondary }]}>{cairnText('acquired-cairn-detail-screen.hide-all-acquired-pages-and-stop-future')}</Text>
                </View>
              </TouchableOpacity>
              {actionError ? (
                <View style={[styles.actionError, { borderColor: theme.destructive }]}>
                  <Text accessibilityLiveRegion="polite" style={[styles.collectionHelp, { color: theme.destructive }]}>{actionError}</Text>
                </View>
              ) : null}
              <Text style={[styles.collectionFootnote, { color: theme.muted }]}>{cairnText('acquired-cairn-detail-screen.neither-action-changes-the-author-s-cairn')}</Text>
            </>
          )}
        </BottomSheetContent>
      </BottomSheetFrame>
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
  revisionIdentity: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingRight: Spacing.sm },
  revisionTitle: { fontSize: FontSize.body, fontWeight: '700' },
  noteCopy: { paddingTop: Spacing.sm, gap: Spacing.sm },
  noteTitle: { fontSize: FontSize.h2, lineHeight: 28, fontWeight: '700' },
  body: { fontSize: FontSize.body, lineHeight: 21 },
  meta: { fontSize: FontSize.small },
  unavailable: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  offlineNotice: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, borderWidth: 1, borderRadius: 12, padding: Spacing.md },
  thanks: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs, alignSelf: 'flex-start', minHeight: 44 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xl },
  thanksText: { fontSize: FontSize.small, fontWeight: '700' },
  pager: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  pageButton: { minHeight: 44, minWidth: 72, alignItems: 'center', justifyContent: 'center' },
  pageButtonText: { fontSize: FontSize.small, fontWeight: '700' },
  disabled: { opacity: 0.35 },
  manageTrigger: { minHeight: 44, flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-end', gap: Spacing.xs, paddingHorizontal: Spacing.sm, borderWidth: StyleSheet.hairlineWidth, borderRadius: 12 },
  manageTriggerText: { fontSize: FontSize.small, fontWeight: '700' },
  manageContent: { gap: Spacing.md, paddingBottom: Spacing.sm },
  collectionHelp: { fontSize: FontSize.small, lineHeight: 17 },
  managementOption: { minHeight: 76, flexDirection: 'row', alignItems: 'center', gap: Spacing.md, padding: Spacing.md, borderWidth: 1, borderRadius: 14 },
  managementIcon: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  managementCopy: { flex: 1, gap: 3 },
  managementTitle: { fontSize: FontSize.body, lineHeight: 21, fontWeight: '700' },
  collectionActionText: { fontSize: FontSize.small, fontWeight: '700' },
  collectionFootnote: { fontSize: FontSize.small, lineHeight: 17, paddingHorizontal: Spacing.xs },
  consequenceCard: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm, padding: Spacing.md, borderWidth: 1, borderRadius: 14 },
  confirmationRow: { flexDirection: 'row', gap: Spacing.sm, marginTop: Spacing.xs },
  confirmationButton: { flex: 1, minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.xs, borderWidth: 1, borderRadius: 12 },
  actionError: { borderLeftWidth: 3, paddingLeft: Spacing.sm, paddingVertical: Spacing.xs },
});
