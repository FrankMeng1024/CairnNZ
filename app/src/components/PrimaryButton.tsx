/**
 * PrimaryButton — app-wide primary call-to-action button.
 *
 * The authoritative shared action foundation. Geometry stays compact while
 * semantic tokens provide primary, secondary, destructive and disabled roles.
 *
 * Legacy `solid` / `surface` names remain aliases for `primary` /
 * `secondary` so existing callers can migrate without a visual fork.
 *
 * Color can be tinted via `tint` prop when the caller wants the button to
 * pick up weather-adaptive tokens (e.g. Home / Settings action buttons that
 * follow the current bg variant).
 */
import React, { useRef } from 'react';
import { TouchableOpacity, Text, StyleSheet, Animated, ActivityIndicator, View, StyleProp, ViewStyle } from 'react-native';
import { Spacing, FontSize, RadiusRole } from './tokens';
import { useVisualTheme } from '../hooks/useVisualTheme';

interface PrimaryButtonProps {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  variant?: 'solid' | 'surface' | 'primary' | 'secondary' | 'destructive';
  /** Optional icon rendered before the label (left-aligned). */
  leftIcon?: React.ReactNode;
  /** Preferred icon API: receives the resolved semantic foreground color. */
  renderIcon?: (color: string) => React.ReactNode;
  /** Optional background color override (weather-adaptive tokens). */
  tint?: string;
  /** Optional text color override (weather-adaptive tokens). */
  textColor?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export function PrimaryButton({
  label, onPress, disabled, loading,
  variant = 'solid', leftIcon, renderIcon, tint, textColor, style, testID,
}: PrimaryButtonProps) {
  const theme = useVisualTheme();
  const scale = useRef(new Animated.Value(1)).current;
  const pressIn = () => Animated.spring(scale, { toValue: 0.97, useNativeDriver: true, tension: 300, friction: 10 }).start();
  const pressOut = () => Animated.spring(scale, { toValue: 1, useNativeDriver: true, tension: 300, friction: 8 }).start();

  const semanticVariant = variant === 'solid'
    ? 'primary'
    : variant === 'surface'
      ? 'secondary'
      : variant;
  const inactive = Boolean(disabled || loading);
  const palette = semanticVariant === 'destructive'
    ? { background: theme.destructiveSurface, border: theme.destructive, text: theme.destructive }
    : semanticVariant === 'secondary'
      ? { background: theme.secondaryAction, border: theme.borderStrong, text: theme.textPrimary }
      : { background: theme.primaryAction, border: theme.primaryAction, text: theme.onPrimary };
  const bg = inactive ? theme.disabledSurface : tint ?? palette.background;
  const border = inactive ? theme.disabledBorder : palette.border;
  const fg = inactive ? theme.disabledText : textColor ?? palette.text;
  const resolvedIcon = renderIcon
    ? renderIcon(fg)
    : React.isValidElement(leftIcon)
      ? React.cloneElement(leftIcon as React.ReactElement<{ color?: string }>, { color: fg })
      : leftIcon;

  return (
    <Animated.View style={[{ transform: [{ scale }] }, style]}>
      <TouchableOpacity
        testID={testID}
        onPress={onPress}
        onPressIn={pressIn}
        onPressOut={pressOut}
        disabled={disabled || loading}
        accessibilityRole="button"
        accessibilityState={{ disabled: inactive, busy: Boolean(loading) }}
        activeOpacity={1}
        style={[
          styles.btn,
          { backgroundColor: bg, borderColor: border },
        ]}
      >
        {loading ? (
          <ActivityIndicator color={fg} />
        ) : (
          <View style={styles.row}>
            {resolvedIcon ? <View style={styles.iconWrap}>{resolvedIcon}</View> : null}
            <Text style={[styles.label, { color: fg }]}>{label}</Text>
          </View>
        )}
      </TouchableOpacity>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  btn: {
    borderRadius: RadiusRole.button,
    borderWidth: 1,
    paddingVertical: Spacing.lg,
    minHeight: 56,
    alignItems: 'center',
    justifyContent: 'center',
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  iconWrap: { alignItems: 'center', justifyContent: 'center' },
  label: { fontWeight: '700', fontSize: FontSize.body },
});
