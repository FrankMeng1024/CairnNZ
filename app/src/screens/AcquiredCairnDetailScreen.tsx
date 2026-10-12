import React, { useCallback, useEffect, useState } from 'react';
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

type DetailRoute = RouteProp<RootStackParamList, 'AcquiredCairnDetail'>;
type Nav = NativeStackNavigationProp<RootStackParamList>;
type Revision = {
  revision_id: number;
  content_revision: number;
  type: string;
  text: string | null;
  source_audience: 'friends' | 'public';
  availability: 'available' | 'under_review' | 'unavailable' | 'removed';
  acquired_at: string;
  opened_at: string | null;
  thanked_at: string | null;
};

export function AcquiredCairnDetailScreen() {
  const theme = useVisualTheme();
  const route = useRoute<DetailRoute>();
  const nav = useNavigation<Nav>();
  const [revisions, setRevisions] = useState<Revision[]>([]);
  const [pageIndex, setPageIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reviewMessage, setReviewMessage] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await authenticatedFetch(`/api/cairn-memory/cairns/${encodeURIComponent(route.params.markerId)}/history`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const body = await response.json();
      const next = Array.isArray(body.revisions) ? body.revisions : [];
      setRevisions(next);
      setPageIndex(0);
    } catch {
      setError('This acquired Cairn is unavailable right now.');
    } finally {
      setLoading(false);
    }
  }, [route.params.markerId]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    const revision = revisions[pageIndex];
    if (!revision || revision.availability !== 'available' || revision.opened_at) return;
    let active = true;
    void authenticatedFetch(`/api/cairn-memory/revisions/${revision.revision_id}/read`, {
      method: 'POST', body: '{}',
    }).then(response => {
      if (!active || !response.ok) return;
      setRevisions(current => current.map(item => item.revision_id === revision.revision_id
        ? { ...item, opened_at: item.opened_at || new Date().toISOString() }
        : item));
    });
    return () => { active = false; };
  }, [pageIndex, revisions]);

  const updateCollection = async (action: 'archive' | 'remove') => {
    const response = await authenticatedFetch(`/api/cairn-memory/cairns/${encodeURIComponent(route.params.markerId)}/collection`, {
      method: 'PUT', body: JSON.stringify({ action }),
    });
    if (response.ok) nav.goBack();
    else setError('Could not update this Memory collection.');
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
    const response = await authenticatedFetch(`/api/cairn-memory/revisions/${revisionId}/thanks`, { method: 'POST', body: '{}' });
    if (response.ok) setRevisions(current => current.map(revision => revision.revision_id === revisionId
      ? { ...revision, thanked_at: revision.thanked_at || new Date().toISOString() }
      : revision));
  };

  const report = async (revisionId: number) => {
    const response = await authenticatedFetch(`/api/cairn-memory/revisions/${revisionId}/cases`, {
      method: 'POST',
      body: JSON.stringify({
        client_submission_id: Crypto.randomUUID(),
        case_type: 'report',
        category: 'other',
      }),
    });
    setReviewMessage(response.ok ? 'Report sent for review.' : 'Could not send the report. Try again later.');
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
