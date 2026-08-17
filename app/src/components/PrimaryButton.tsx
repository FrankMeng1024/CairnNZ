/**
 * PrimaryButton — app-wide primary call-to-action button.
 *
 * Single visual: rounded pill (radius 28), Colors.primary deep-green fill,
 * white 700 body text, 56pt min height, Spacing.lg vertical padding — matches
 * AuthScreen.primaryBtn exactly (the reference).
 *
 * Optional variant="surface" prop for secondary-context uses (e.g. Google/
 * Apple SSO buttons on Auth): white fill + border, otherwise identical.
 *
 * Color can be tinted via `tint` prop when the caller wants the button to
 * pick up weather-adaptive tokens (e.g. Home / Settings action buttons that
 * follow the current bg variant).
 */
import React, { useRef } from 'react';
import { TouchableOpacity, Text, StyleSheet, Animated, ActivityIndicator, View, StyleProp, ViewStyle } from 'react-native';
import { Colors, Spacing, FontSize } from './tokens';

interface PrimaryButtonProps {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  variant?: 'solid' | 'surface';
  /** Optional icon rendered before the label (left-aligned). */
  leftIcon?: React.ReactNode;
  /** Optional background color override (weather-adaptive tokens). */
  tint?: string;
  /** Optional text color override (weather-adaptive tokens). */
  textColor?: string;
  style?: StyleProp<ViewStyle>;
}

export function PrimaryButton({
  label, onPress, disabled, loading,
  variant = 'solid', leftIcon, tint, textColor, style,
}: PrimaryButtonProps) {
  const scale = useRef(new Animated.Value(1)).current;
  const pressIn = () => Animated.spring(scale, { toValue: 0.97, useNativeDriver: true, tension: 300, friction: 10 }).start();
  const pressOut = () => Animated.spring(scale, { toValue: 1, useNativeDriver: true, tension: 300, friction: 8 }).start();

  const isSurface = variant === 'surface';
  const bg = tint ?? (isSurface ? Colors.surface : Colors.primary);
  const fg = textColor ?? (isSurface ? Colors.textPrimary : '#ffffff');

  return (
    <Animated.View style={[{ transform: [{ scale }] }, style]}>
      <TouchableOpacity
        onPress={onPress}
        onPressIn={pressIn}
        onPressOut={pressOut}
        disabled={disabled || loading}
        activeOpacity={1}
        style={[
          styles.btn,
          { backgroundColor: bg },
          isSurface && { borderWidth: 1, borderColor: Colors.border },
          (disabled || loading) && styles.disabled,
        ]}
      >
        {loading ? (
          <ActivityIndicator color={fg} />
        ) : (
          <View style={styles.row}>
            {leftIcon ? <View style={styles.iconWrap}>{leftIcon}</View> : null}
            <Text style={[styles.label, { color: fg }]}>{label}</Text>
          </View>
        )}
      </TouchableOpacity>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  btn: {
    borderRadius: 28,
    paddingVertical: Spacing.lg,
    minHeight: 56,
    alignItems: 'center',
    justifyContent: 'center',
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  iconWrap: { marginRight: 4 },
  label: { fontWeight: '700', fontSize: FontSize.body },
  disabled: { opacity: 0.5 },
});
