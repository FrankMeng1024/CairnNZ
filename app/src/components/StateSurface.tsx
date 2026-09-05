import React, { type ReactNode } from 'react';
import { ActivityIndicator, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { FontSize, RadiusRole, Spacing } from './tokens';
import { Icon, type IconName } from './Icon';
import { useVisualTheme } from '../hooks/useVisualTheme';

export type StateSurfaceVariant = 'loading' | 'empty' | 'error' | 'offline' | 'permission' | 'recovery' | 'unavailable';

export const STATE_SURFACE_SYMBOL: Record<StateSurfaceVariant, IconName | null> = {
  loading: null,
  empty: 'Compass',
  error: 'TriangleAlert',
  offline: 'CloudOff',
  permission: 'MapPin',
  recovery: 'RotateCcw',
  unavailable: 'Info',
};

interface Props {
  variant: StateSurfaceVariant;
  title: string;
  body?: string;
  symbol?: ReactNode;
  actions?: ReactNode;
  secondaryGuidance?: ReactNode;
  material?: 'embedded' | 'surface';
  alignment?: 'start' | 'center';
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/** Compact, composable frame for authored loading, empty and recovery states. */
export function StateSurface({
  variant,
  title,
  body,
  symbol,
  actions,
  secondaryGuidance,
  material = 'surface',
  alignment = 'start',
  style,
  testID,
}: Props) {
  const theme = useVisualTheme();
  const centered = alignment === 'center';
  const defaultSymbol = STATE_SURFACE_SYMBOL[variant];
  const symbolColor = variant === 'error' ? theme.destructive : theme.iconActive;

  return (
    <View
      testID={testID ?? `state-surface-${variant}`}
      accessibilityRole={variant === 'error' ? 'alert' : undefined}
      accessibilityLiveRegion={variant === 'loading' ? 'polite' : undefined}
      style={[
        styles.frame,
        centered && styles.centered,
        material === 'surface' && {
          backgroundColor: theme.surfaceSecondary,
          borderColor: theme.borderSubtle,
        },
        material === 'embedded' && styles.embedded,
        style,
      ]}
    >
      <View style={[styles.symbol, centered && styles.symbolCentered]}>
        {symbol ?? (variant === 'loading'
          ? <ActivityIndicator size="small" color={theme.primaryAction} testID="state-surface-spinner" />
          : defaultSymbol
            ? <Icon name={defaultSymbol} size={24} color={symbolColor} strokeWidth={1.9} />
            : null)}
      </View>
      <View style={[styles.copy, centered && styles.copyCentered]}>
        <Text style={[styles.title, { color: theme.textPrimary }, centered && styles.textCentered]}>{title}</Text>
        {body ? <Text style={[styles.body, { color: theme.textSecondary }, centered && styles.textCentered]}>{body}</Text> : null}
        {secondaryGuidance ? <View style={styles.guidance}>{secondaryGuidance}</View> : null}
      </View>
      {actions ? <View style={styles.actions}>{actions}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    borderWidth: 1,
    borderRadius: RadiusRole.card,
    padding: Spacing.lg,
    alignItems: 'flex-start',
  },
  embedded: { backgroundColor: 'transparent', borderColor: 'transparent', padding: 0 },
  centered: { alignItems: 'center' },
  symbol: { minHeight: 28, justifyContent: 'center', marginBottom: Spacing.md },
  symbolCentered: { alignItems: 'center' },
  copy: { alignSelf: 'stretch' },
  copyCentered: { alignItems: 'center' },
  title: { fontSize: FontSize.h3, fontWeight: '700', lineHeight: 23 },
  body: { fontSize: FontSize.body, lineHeight: 22, marginTop: Spacing.xs },
  textCentered: { textAlign: 'center' },
  guidance: { marginTop: Spacing.sm },
  actions: { alignSelf: 'stretch', marginTop: Spacing.lg, gap: Spacing.sm },
});
