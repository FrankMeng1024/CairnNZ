import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { MarkerPermission } from '../../store/useMarkerStore';
import { Icon, type IconName } from '../../components/Icon';
import { FontSize, Radius, Spacing } from '../../components/tokens';
import { useVisualTheme } from '../../hooks/useVisualTheme';
import { cairnText } from '../../i18n/runtime';

const AUDIENCE: Record<MarkerPermission, { label: string; icon: IconName }> = {
  personal: { get label() { return cairnText('cairns.cairn-identity-line.only-me'); }, icon: 'Lock' },
  group: { get label() { return cairnText('cairns.cairn-identity-line.friends'); }, icon: 'Users' },
  public: { get label() { return cairnText('cairns.cairn-identity-line.public'); }, icon: 'Globe' },
};

/** Authorship and audience are separate product facts; never encode either by colour alone. */
export function CairnIdentityLine({
  isOwner,
  permission,
  authorName,
  compact = false,
  qa = false,
}: {
  isOwner: boolean;
  permission: MarkerPermission;
  authorName?: string | null;
  compact?: boolean;
  qa?: boolean;
}) {
  const theme = useVisualTheme();
  const audience = AUDIENCE[permission] ?? AUDIENCE.personal;
  const authorLabel = isOwner
    ? cairnText('cairns.cairn-identity-line.your-cairn')
    : permission === 'public'
      ? cairnText('cairns.cairn-identity-line.community-cairn')
      : authorName ? cairnText('cairns.cairn-identity-line.from-value', { authorName: authorName }) : cairnText('cairns.cairn-identity-line.friend-s-cairn');
  return (
    <View style={[styles.row, compact && styles.compact]} testID="cairn-identity-line">
      <View style={styles.fact}>
        <Icon name={isOwner ? 'User' : permission === 'public' ? 'Compass' : 'Users'} size={13} color={theme.iconInactive} strokeWidth={2} />
        <Text style={[styles.author, { color: theme.foregroundSecondary }]} numberOfLines={1}>{authorLabel}</Text>
      </View>
      <View style={[styles.audience, { backgroundColor: theme.controlSelected, borderColor: theme.borderStrong }]}>
        <Icon name={qa ? 'Wrench' : audience.icon} size={12} color={theme.iconActive} strokeWidth={2} />
        <Text style={[styles.audienceText, { color: theme.foreground }]}>{qa ? cairnText('cairns.cairn-identity-line.simulator-only') : audience.label}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: Spacing.sm },
  compact: { gap: Spacing.xs },
  fact: { minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 5 },
  author: { maxWidth: 170, fontSize: FontSize.small, fontWeight: '600' },
  audience: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderWidth: 1,
    borderRadius: Radius.pill,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 3,
  },
  audienceText: { fontSize: FontSize.small, fontWeight: '700' },
});
