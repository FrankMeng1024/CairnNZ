import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, type StyleProp, type ViewStyle } from 'react-native';
import { FontSize, Radius, Spacing } from './tokens';
import { useVisualTheme } from '../hooks/useVisualTheme';

type Variant = 'primary' | 'surface' | 'tertiary' | 'destructive';

interface Props {
  label: string;
  onPress: () => void;
  variant?: Variant;
  disabled?: boolean;
  loading?: boolean;
  accessibilityLabel?: string;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

/** Shared CairnNZ action hierarchy. Geometry follows semantic role, not page. */
export function AppButton({ label, onPress, variant = 'primary', disabled, loading, accessibilityLabel, testID, style }: Props) {
  const theme = useVisualTheme();
  const palette = variant === 'primary'
    ? { background: theme.primary, border: theme.primary, text: theme.onPrimary }
    : variant === 'destructive'
      ? { background: 'transparent', border: theme.destructive, text: theme.destructive }
      : variant === 'surface'
        ? { background: theme.surface, border: theme.border, text: theme.foreground }
        : { background: 'transparent', border: 'transparent', text: theme.foregroundSecondary };
  const inactive = Boolean(disabled || loading);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      disabled={inactive}
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: palette.background, borderColor: palette.border, opacity: inactive ? 0.48 : pressed ? 0.82 : 1 },
        style,
      ]}
    >
      {loading ? <ActivityIndicator size="small" color={palette.text} /> : <Text style={[styles.label, { color: palette.text }]}>{label}</Text>}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: 48,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    borderRadius: Radius.button,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: { fontSize: FontSize.body, fontWeight: '700' },
});
