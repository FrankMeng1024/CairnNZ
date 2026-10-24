import React from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Radius, Shadow, Spacing } from '../../../components/tokens';
import { useVisualTheme } from '../../../hooks/useVisualTheme';
import { CairnStoneMark } from './CairnPaper';
import { cairnText } from '../../../i18n/runtime';

export function CairnNotificationRetryBanner({
  busy,
  onRetry,
  onLater,
}: {
  busy: boolean;
  onRetry: () => void;
  onLater: () => void;
}) {
  const theme = useVisualTheme();
  const insets = useSafeAreaInsets();
  return (
    <View
      testID="cairn-notification-retry"
      accessibilityRole="alert"
      style={[
        styles.card,
        {
          bottom: Math.max(insets.bottom, Spacing.md) + Spacing.md,
          backgroundColor: theme.sheetSurface,
          borderColor: theme.borderStrong,
          shadowColor: theme.shadow,
        },
      ]}
    >
      <CairnStoneMark size={30} tone="neutral" />
      <View style={styles.copy}>
        <Text style={[styles.title, { color: theme.foreground }]}>{cairnText('cairns.cairn-notification-retry-banner.couldn-t-open-this-encounter')}</Text>
        <Text style={[styles.detail, { color: theme.foregroundSecondary }]}>{cairnText('cairns.cairn-notification-retry-banner.it-is-still-safely-in-memory-try')}</Text>
        <View style={styles.actions}>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityState={{ busy, disabled: busy }}
            disabled={busy}
            onPress={onRetry}
            style={[styles.retry, { backgroundColor: theme.primary }]}
          >
            {busy ? <ActivityIndicator size="small" color={theme.onPrimary} /> : <Text style={[styles.retryText, { color: theme.onPrimary }]}>{cairnText('cairns.cairn-notification-retry-banner.try-again')}</Text>}
          </TouchableOpacity>
          <TouchableOpacity accessibilityRole="button" onPress={onLater} style={styles.later}>
            <Text style={[styles.laterText, { color: theme.foregroundSecondary }]}>{cairnText('cairns.cairn-notification-retry-banner.later')}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    position: 'absolute', left: Spacing.md, right: Spacing.md, zIndex: 80,
    minHeight: 112, borderWidth: 1, borderRadius: Radius.card,
    padding: Spacing.md, flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm,
    ...Shadow.card,
  },
  copy: { flex: 1 },
  title: { fontSize: 15, lineHeight: 20, fontWeight: '700' },
  detail: { marginTop: 2, fontSize: 12, lineHeight: 17 },
  actions: { marginTop: Spacing.sm, flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  retry: { minWidth: 92, minHeight: 40, paddingHorizontal: Spacing.md, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  retryText: { fontSize: 13, fontWeight: '700' },
  later: { minWidth: 64, minHeight: 40, alignItems: 'center', justifyContent: 'center' },
  laterText: { fontSize: 13, fontWeight: '700' },
});
