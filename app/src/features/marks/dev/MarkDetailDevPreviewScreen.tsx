/**
 * MarkDetailDevPreviewScreen — Friend System v1 / Sprint 68 / STORY-00532+533
 *
 * Dev-only route for visually verifying the 4 forms of MarkDetailSheet
 * (v4 §4.11) without needing a populated map. Mounted at /dev/mark-detail
 * via a feature-flag check; navigation entry lives in Settings → Dev tools.
 *
 * Each button renders the sheet with a hand-crafted Marker payload that
 * forces a specific form via the iron-law inputs. UX/QA subagents review
 * the rendered screenshots side-by-side with the v4 §4.11 ASCII mockups.
 *
 * Not shipped to production: route is gated on __DEV__ in RootNavigator.
 */

import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { Marker } from '../../../store/useMarkerStore';
import { useMarkerStore } from '../../../store/useMarkerStore';
import { Colors, Spacing, Radius, FontSize } from '../../../components/tokens';
import { MarkDetailSheet } from '../components/MarkDetailSheet';
import { useMarkLikeStore } from '../store/useMarkLikeStore';

type ScenarioId = 'A-personal' | 'A-public' | 'B-friend' | 'B-public' | 'C' | 'D-personal' | 'D-far-public';

const VIEWER_ID = '19'; // Alice in seed data
const FRIEND_ID = '20'; // Bob
const STRANGER_ID = '99';

const SCENARIOS: ReadonlyArray<{
  id: ScenarioId;
  label: string;
  description: string;
  marker: Marker;
  inMyFog: () => boolean;
  friendIds: ReadonlyArray<string>;
  subscribedFriendIds: ReadonlyArray<string>;
  /** Expected form for documentation in dev report. */
  expectedForm: 'A' | 'B' | 'C' | 'D';
}> = [
  {
    id: 'A-personal',
    label: 'A. My Personal mark',
    description: 'Edit + Delete only (no Like/Report — not Public)',
    marker: {
      id: 'dev-A-personal', type: 'cairn', regionCode: 'nz',
      lat: 31.23, lng: 121.43, note: 'Hidden viewpoint\nBehind the rocks, quiet…',
      authorId: VIEWER_ID, createdAt: Date.now() - 3 * 86400_000, permission: 'personal',
    },
    inMyFog: () => true,
    friendIds: [FRIEND_ID],
    subscribedFriendIds: [FRIEND_ID],
    expectedForm: 'A',
  },
  {
    id: 'A-public',
    label: 'A. My Public mark',
    description: 'Edit + Delete + Like/Report (because Public)',
    marker: {
      id: 'dev-A-public', type: 'cairn', regionCode: 'nz',
      lat: 31.23, lng: 121.43, note: 'Summit cairn\nBig rock at the top',
      authorId: VIEWER_ID, createdAt: Date.now() - 7 * 86400_000, permission: 'public',
    },
    inMyFog: () => true,
    friendIds: [FRIEND_ID],
    subscribedFriendIds: [FRIEND_ID],
    expectedForm: 'A',
  },
  {
    id: 'B-friend',
    label: 'B. Friend\'s mark + I visited',
    description: 'Author name (LDY) + visited ✓ + Like + Report + Delete-from-view',
    marker: {
      id: 'dev-B-friend', type: 'cairn', regionCode: 'nz',
      lat: 31.23, lng: 121.43, note: 'Coastal viewpoint\nBest sunset spot on island',
      authorId: FRIEND_ID, createdAt: Date.now() - 3 * 86400_000, permission: 'group',
      authorName: 'LDY',
    },
    inMyFog: () => true,
    friendIds: [FRIEND_ID],
    subscribedFriendIds: [FRIEND_ID],
    expectedForm: 'B',
  },
  {
    id: 'B-public',
    label: 'B. Stranger Public + I visited',
    description: 'ANONYMOUS (no author name) + Like + Report + Delete-from-view',
    marker: {
      id: 'dev-B-public', type: 'cairn', regionCode: 'nz',
      lat: 31.23, lng: 121.43, note: 'Hidden mural\nBy the old wall',
      authorId: STRANGER_ID, createdAt: Date.now() - 1 * 86400_000, permission: 'public',
      authorName: 'Should NOT show (anonymized)',
    },
    inMyFog: () => true,
    friendIds: [FRIEND_ID],
    subscribedFriendIds: [FRIEND_ID],
    expectedForm: 'B',
  },
  {
    id: 'C',
    label: 'C. Friend\'s mark via fog + NOT visited',
    description: 'Author name (LDY) + "(Walk here to like/report)" + Delete-from-view ONLY',
    marker: {
      id: 'dev-C', type: 'cairn', regionCode: 'nz',
      lat: 31.23, lng: 121.43, note: 'Stream crossing\nCold but worth it',
      authorId: FRIEND_ID, createdAt: Date.now() - 5 * 86400_000, permission: 'group',
      authorName: 'LDY',
    },
    inMyFog: () => false,
    friendIds: [FRIEND_ID],
    subscribedFriendIds: [FRIEND_ID],
    expectedForm: 'C',
  },
  {
    id: 'D-personal',
    label: 'D. Friend\'s Personal mark (blocked)',
    description: 'Sheet must NOT open — iron law 1 visibility deny',
    marker: {
      id: 'dev-D-personal', type: 'cairn', regionCode: 'nz',
      lat: 31.23, lng: 121.43, note: 'Friend\'s private note',
      authorId: FRIEND_ID, createdAt: Date.now(), permission: 'personal',
    },
    inMyFog: () => false,
    friendIds: [FRIEND_ID],
    subscribedFriendIds: [FRIEND_ID],
    expectedForm: 'D',
  },
  {
    id: 'D-far-public',
    label: 'D. Stranger Public + not visited',
    description: 'Sheet must NOT open — outside fog + no subscription',
    marker: {
      id: 'dev-D-far', type: 'cairn', regionCode: 'nz',
      lat: 31.23, lng: 121.43, note: 'Distant public mark',
      authorId: STRANGER_ID, createdAt: Date.now(), permission: 'public',
    },
    inMyFog: () => false,
    friendIds: [FRIEND_ID],
    subscribedFriendIds: [FRIEND_ID],
    expectedForm: 'D',
  },
];

export function MarkDetailDevPreviewScreen() {
  const [active, setActive] = useState<ScenarioId | null>(null);
  const likeToggle = useMarkLikeStore(s => s.toggle);
  // Subscribe to `liked` so the sheet re-renders when toggle fires.
  // Passing isLiked as a closure over the subscribed array forces React to
  // re-run the closure with the fresh array on every store change.
  const likedSet = useMarkLikeStore(s => s.liked);
  const isMarkLiked = React.useCallback(
    (id: string) => likedSet.includes(id),
    [likedSet]
  );
  // Sprint 68 STORY-00534: hideMark exposes the dev preview to the real
  // network/cache-wipe pipeline (useful for verifying the Alert flow even
  // though no real circle markers are loaded in dev preview).
  const hideMark = useMarkerStore(s => s.hideMark);

  const activeScenario = SCENARIOS.find(s => s.id === active);

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.title}>MarkDetailSheet — Dev Preview</Text>
        <Text style={styles.subtitle}>
          Sprint 68 STORY-00532 + STORY-00533 — verify all 4 forms per v4 §4.11.
        </Text>
        {SCENARIOS.map((s) => (
          <TouchableOpacity
            key={s.id}
            style={styles.card}
            onPress={() => setActive(s.id)}
            testID={`scenario-${s.id}`}
          >
            <View style={styles.cardHeader}>
              <Text style={styles.cardLabel}>{s.label}</Text>
              <View style={[styles.formBadge, s.expectedForm === 'D' && styles.formBadgeD]}>
                <Text style={styles.formBadgeText}>Form {s.expectedForm}</Text>
              </View>
            </View>
            <Text style={styles.cardDesc}>{s.description}</Text>
          </TouchableOpacity>
        ))}
        <Text style={styles.foot}>
          Tap a scenario to render the sheet. Form D scenarios should produce NO sheet (the
          component renders null).
        </Text>
      </ScrollView>

      <MarkDetailSheet
        marker={activeScenario ? activeScenario.marker : null}
        viewerId={VIEWER_ID}
        subscribedFriendIds={activeScenario ? activeScenario.subscribedFriendIds : []}
        friendIds={activeScenario ? activeScenario.friendIds : []}
        inMyFog={activeScenario ? activeScenario.inMyFog : (() => false)}
        isLiked={isMarkLiked}
        onClose={() => setActive(null)}
        onEdit={(m) => Alert.alert('Edit', `Edit triggered for ${m.id}`)}
        onLike={(m) => { likeToggle(m.id); }}
        onReport={(_m) => Alert.alert('Thank you', 'Thank you for reporting.')}
        onDelete={(m, semantic) =>
          Alert.alert(
            semantic === 'own' ? 'Delete this mark?' : 'Hide this mark permanently?',
            semantic === 'own'
              ? 'This cannot be undone.'
              : "You won't see it again on your map. (Other users still see it.)",
            [
              { text: 'Cancel', style: 'cancel' },
              { text: semantic === 'own' ? 'Delete' : 'Hide', style: 'destructive', onPress: () => {
                if (semantic === 'hide') {
                  // Sprint 68 STORY-00534: dev preview now exercises the real
                  // hideMark action so the flow can be tested end-to-end.
                  hideMark(m.id);
                }
                setActive(null);
              }},
            ],
          )
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.bg },
  container: { padding: Spacing.lg, paddingBottom: Spacing.xxl },
  title: {
    fontSize: FontSize.h1,
    fontWeight: '700',
    color: Colors.textPrimary,
    marginBottom: Spacing.xs,
  },
  subtitle: {
    fontSize: FontSize.body,
    color: Colors.textSecondary,
    marginBottom: Spacing.lg,
  },
  card: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.card,
    padding: Spacing.base,
    marginBottom: Spacing.sm,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  cardLabel: {
    fontSize: FontSize.body,
    fontWeight: '700',
    color: Colors.textPrimary,
    flex: 1,
  },
  formBadge: {
    backgroundColor: Colors.primaryBg,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 4,
    borderRadius: Radius.pill,
  },
  formBadgeD: { backgroundColor: 'rgba(140,126,114,0.18)' },
  formBadgeText: {
    fontSize: FontSize.caption,
    fontWeight: '700',
    color: Colors.primary,
  },
  cardDesc: {
    fontSize: FontSize.caption,
    color: Colors.textSecondary,
  },
  foot: {
    marginTop: Spacing.lg,
    fontSize: FontSize.caption,
    color: Colors.textMuted,
    fontStyle: 'italic',
  },
});
