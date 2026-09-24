import React from 'react';
import { SafeAreaView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import type { ActivityMode } from '../../store/useSessionStore';
import { useVisualTheme } from '../../hooks/useVisualTheme';
import { Icon } from '../Icon';
import { FontSize, RadiusRole, Spacing } from '../tokens';

export function ActivityOwnershipGuard({
  ownerMode,
  onReturnToActivity,
  onHome,
}: {
  ownerMode: ActivityMode;
  onReturnToActivity: () => void;
  onHome: () => void;
}) {
  const theme = useVisualTheme();
  const ownerLabel = ownerMode === 'running' ? 'run' : 'hike';

  return (
    <SafeAreaView style={[styles.page, { backgroundColor: theme.background }]} testID="activity-ownership-guard">
      <View style={[styles.card, { backgroundColor: theme.surfaceElevated, borderColor: theme.border }]}>
        <View style={[styles.iconWell, { backgroundColor: theme.surface }]}>
          <Icon name={ownerMode === 'running' ? 'Footprints' : 'Mountain'} size={28} color={theme.primary} strokeWidth={1.8} />
        </View>
        <Text style={[styles.eyebrow, { color: theme.textMuted }]}>ACTIVITY IN PROGRESS</Text>
        <Text style={[styles.title, { color: theme.textPrimary }]}>Your {ownerLabel} is still recording</Text>
        <Text style={[styles.body, { color: theme.textSecondary }]}>Cairn keeps one recording owner at a time so its route, timer and Cairns cannot be mistaken for another Activity.</Text>
        <TouchableOpacity
          accessibilityRole="button"
          testID="activity-return-to-owner"
          style={[styles.primary, { backgroundColor: theme.primary }]}
          onPress={onReturnToActivity}
        >
          <Text style={styles.primaryText}>Return to {ownerLabel}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          accessibilityRole="button"
          testID="activity-return-home"
          style={[styles.secondary, { borderColor: theme.border }]}
          onPress={onHome}
        >
          <Text style={[styles.secondaryText, { color: theme.textPrimary }]}>Back to Home</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
    justifyContent: 'center',
    padding: Spacing.xl,
  },
  card: {
    borderWidth: 1,
    borderRadius: RadiusRole.card,
    padding: Spacing.xl,
  },
  iconWell: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.lg,
  },
  eyebrow: {
    fontSize: FontSize.caption,
    fontWeight: '700',
    letterSpacing: 1.1,
    marginBottom: Spacing.sm,
  },
  title: {
    fontSize: 27,
    lineHeight: 33,
    fontWeight: '700',
  },
  body: {
    marginTop: Spacing.md,
    fontSize: FontSize.body,
    lineHeight: 23,
  },
  primary: {
    minHeight: 52,
    borderRadius: RadiusRole.button,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: Spacing.xl,
  },
  primaryText: {
    color: '#FFFFFF',
    fontSize: FontSize.body,
    fontWeight: '700',
  },
  secondary: {
    minHeight: 48,
    borderWidth: 1,
    borderRadius: RadiusRole.button,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: Spacing.sm,
  },
  secondaryText: {
    fontSize: FontSize.body,
    fontWeight: '600',
  },
});
