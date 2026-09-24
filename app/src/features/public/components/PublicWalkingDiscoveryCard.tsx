import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Icon } from '../../../components/Icon';
import { Radius, Shadow, Spacing } from '../../../components/tokens';
import { useVisualTheme } from '../../../hooks/useVisualTheme';
import { usePublicCairnStore } from '../services/publicCairns';

export function PublicWalkingDiscoveryCard({
  safeTop,
  onOpen,
}: {
  safeTop: number;
  onOpen: (cairnId: string) => void;
}) {
  const theme = useVisualTheme();
  const enabled = usePublicCairnStore(state => state.enabled);
  const newlySurfacedId = usePublicCairnStore(state => state.newlySurfacedId);
  const entry = usePublicCairnStore(state => state.entries.find(item => item.id === state.newlySurfacedId));
  const present = usePublicCairnStore(state => state.present);
  if (!enabled || !newlySurfacedId || !entry) return null;
  return (
    <TouchableOpacity
      testID={`public-walking-discovery-${entry.id}`}
      style={[
        styles.card,
        {
          top: safeTop + 154,
          backgroundColor: theme.sheetSurface,
          borderColor: theme.borderStrong,
          shadowColor: theme.shadow,
        },
      ]}
      activeOpacity={0.9}
      onPress={() => {
        void present(entry.id);
        onOpen(entry.id);
      }}
      accessibilityRole="button"
      accessibilityLabel={`Open Public Cairn found while moving, left by ${entry.author.name}`}
    >
      <View style={[styles.icon, { backgroundColor: theme.controlSelected }]}>
        <Icon name="Globe" size={17} color={theme.primary} strokeWidth={2.2} />
      </View>
      <View style={styles.copy}>
        <Text style={[styles.eyebrow, { color: theme.foregroundSecondary }]}>FOUND WHILE MOVING</Text>
        <Text style={[styles.title, { color: theme.foreground }]}>A Public Cairn is nearby</Text>
        <Text style={[styles.author, { color: theme.foregroundSecondary }]} numberOfLines={1}>
          Left by {entry.author.name} · Recording continues
        </Text>
      </View>
      <Icon name="ChevronRight" size={17} color={theme.iconInactive} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    position: 'absolute',
    left: Spacing.md,
    right: Spacing.md,
    zIndex: 24,
    minHeight: 72,
    borderRadius: Radius.card,
    borderWidth: 1,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    ...Shadow.card,
  },
  icon: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  copy: { flex: 1 },
  eyebrow: { fontSize: 10, fontWeight: '700', letterSpacing: 0.8 },
  title: { fontSize: 15, lineHeight: 20, fontWeight: '700', marginTop: 1 },
  author: { fontSize: 12, lineHeight: 17, marginTop: 1 },
});
