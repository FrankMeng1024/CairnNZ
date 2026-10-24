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
import { PaywallSheet } from '../../memory/components/PaywallSheet';
import { cairnText } from '../../../i18n/runtime';

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
    get label() { return cairnText('dev.mark-detail-dev-preview-screen.a-my-personal-mark'); },
    get description() { return cairnText('dev.mark-detail-dev-preview-screen.edit-delete-only-no-like-report-not'); },
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
    get label() { return cairnText('dev.mark-detail-dev-preview-screen.a-my-public-mark'); },
    get description() { return cairnText('dev.mark-detail-dev-preview-screen.edit-delete-like-report-because-public'); },
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
    get label() { return cairnText('dev.mark-detail-dev-preview-screen.b-friend-s-mark-i-visited'); },
    get description() { return cairnText('dev.mark-detail-dev-preview-screen.author-name-ldy-visited-like-report-delete'); },
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
    get label() { return cairnText('dev.mark-detail-dev-preview-screen.b-stranger-public-i-visited'); },
    get description() { return cairnText('dev.mark-detail-dev-preview-screen.anonymous-no-author-name-like-report-delete'); },
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
    get label() { return cairnText('dev.mark-detail-dev-preview-screen.c-friend-s-mark-via-fog-not'); },
    get description() { return cairnText('dev.mark-detail-dev-preview-screen.author-name-ldy-walk-here-to-like'); },
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
    get label() { return cairnText('dev.mark-detail-dev-preview-screen.d-friend-s-personal-mark-blocked'); },
    get description() { return cairnText('dev.mark-detail-dev-preview-screen.sheet-must-not-open-iron-law-1'); },
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
    get label() { return cairnText('dev.mark-detail-dev-preview-screen.d-stranger-public-not-visited'); },
    get description() { return cairnText('dev.mark-detail-dev-preview-screen.sheet-must-not-open-outside-fog-no'); },
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
  // Sprint 70 STORY-00542 + 543 UX evidence (post-review): allow dev
  // preview to imperatively open PaywallSheet for screenshot verification
  // (web env can't reach Paywall via the normal 5-cap user flow without
  // real subscriptions).
  const [paywallOpen, setPaywallOpen] = useState(false);

  const activeScenario = SCENARIOS.find(s => s.id === active);

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.title}>{cairnText('dev.mark-detail-dev-preview-screen.markdetailsheet-dev-preview')}</Text>
        <Text style={styles.subtitle}>{cairnText('dev.mark-detail-dev-preview-screen.sprint-68-story-00532-story-00533-verify')}</Text>
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
                <Text style={styles.formBadgeText}>{cairnText('dev.mark-detail-dev-preview-screen.form-value', { expectedForm: s.expectedForm })}</Text>
              </View>
            </View>
            <Text style={styles.cardDesc}>{s.description}</Text>
          </TouchableOpacity>
        ))}
        <Text style={styles.foot}>{cairnText('dev.mark-detail-dev-preview-screen.tap-a-scenario-to-render-the-sheet')}</Text>

        {/* Sprint 70 STORY-00542 UX evidence trigger (post-review):
            imperatively open the Paywall sheet for visual verification. */}
        <TouchableOpacity
          style={styles.paywallBtn}
          onPress={() => setPaywallOpen(true)}
          testID="dev-paywall-trigger"
        >
          <Text style={styles.paywallBtnText}>{cairnText('dev.mark-detail-dev-preview-screen.open-paywall-sheet-sprint-70')}</Text>
        </TouchableOpacity>
      </ScrollView>

      <PaywallSheet visible={paywallOpen} onClose={() => setPaywallOpen(false)} />

      <MarkDetailSheet
        marker={activeScenario ? activeScenario.marker : null}
        viewerId={VIEWER_ID}
        subscribedFriendIds={activeScenario ? activeScenario.subscribedFriendIds : []}
        friendIds={activeScenario ? activeScenario.friendIds : []}
        inMyFog={activeScenario ? activeScenario.inMyFog : (() => false)}
        isLiked={isMarkLiked}
        onClose={() => setActive(null)}
        onEdit={(m) => Alert.alert(cairnText('dev.mark-detail-dev-preview-screen.edit'), cairnText('dev.mark-detail-dev-preview-screen.edit-triggered-for-value', { id: m.id }), [{ text: cairnText('dev.mark-detail-dev-preview-screen.ok') }])}
        onLike={(m) => { likeToggle(m.id); }}
        onReport={(_m) => Alert.alert(cairnText('dev.mark-detail-dev-preview-screen.thank-you'), cairnText('dev.mark-detail-dev-preview-screen.thank-you-for-reporting'), [{ text: cairnText('dev.mark-detail-dev-preview-screen.ok') }])}
        onDelete={(m, semantic) =>
          Alert.alert(
            semantic === 'own' ? cairnText('dev.mark-detail-dev-preview-screen.delete-this-cairn') : cairnText('dev.mark-detail-dev-preview-screen.hide-this-cairn-permanently'),
            semantic === 'own'
              ? cairnText('dev.mark-detail-dev-preview-screen.this-cannot-be-undone')
              : cairnText('dev.mark-detail-dev-preview-screen.you-won-t-see-it-again-on'),
            [
              { text: cairnText('common.cancel'), style: 'cancel' },
              { text: semantic === 'own' ? cairnText('dev.mark-detail-dev-preview-screen.delete') : cairnText('dev.mark-detail-dev-preview-screen.hide'), style: 'destructive', onPress: () => {
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
  paywallBtn: {
    marginTop: Spacing.lg,
    padding: Spacing.md,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.card,
    alignItems: 'center',
  },
  paywallBtnText: {
    fontSize: FontSize.body,
    color: Colors.primary,
    fontWeight: '600',
  },
});
