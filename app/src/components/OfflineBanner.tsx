/**
 * OfflineBanner — thin banner shown when the device is offline.
 *
 * Batch 6.1a (HOME-06): rendered at the RootNavigator level so every
 * screen benefits without having to opt in. Uses the existing
 * `useOnlineOnly` hook backed by `networkMonitor`.
 *
 * Behavior:
 *   - Hidden when online (returns null).
 *   - When offline, renders a compact bar just below the status bar with
 *     an icon + short "You're offline" message.
 *   - Fade-in + slide-in animation on transition.
 *   - Does not block any interaction — just informational.
 *
 * Rationale: many Cairn features degrade meaningfully offline (sync
 * paused, friend feed stale, marker uploads queued). Prior to this
 * banner the only offline hint was the per-feature "Needs internet"
 * disabled state.
 */
import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Animated, Easing, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors, Spacing, FontSize } from './tokens';
import { Icon } from './Icon';
import { useOnlineOnly } from '../hooks/useOnlineOnly';
import { useVisualTheme } from '../hooks/useVisualTheme';

export function OfflineBanner() {
  const theme = useVisualTheme();
  const { online } = useOnlineOnly();
  const insets = useSafeAreaInsets();
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(-20)).current;

  useEffect(() => {
    if (!online) {
      Animated.parallel([
        Animated.timing(opacity, { toValue: 1, duration: 220, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
        Animated.timing(translateY, { toValue: 0, duration: 220, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(opacity, { toValue: 0, duration: 200, easing: Easing.in(Easing.cubic), useNativeDriver: true }),
        Animated.timing(translateY, { toValue: -20, duration: 200, easing: Easing.in(Easing.cubic), useNativeDriver: true }),
      ]).start();
    }
  }, [online]);

  if (online) return null;

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.container,
        {
          top: insets.top,
          opacity,
          transform: [{ translateY }],
        },
      ]}
    >
      <View style={[styles.bar, { backgroundColor: theme.surfaceElevated, borderColor: theme.border }]}>
        <Icon name="CloudOff" size={14} color={theme.icon} strokeWidth={2} />
        <Text style={[styles.text, { color: theme.foregroundSecondary }]}>You&apos;re offline. Some actions will sync when you&apos;re back.</Text>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    left: 0, right: 0,
    zIndex: 9999,
    alignItems: 'center',
    paddingHorizontal: Spacing.md,
  },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: Colors.surfaceMuted,
    borderColor: Colors.border,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: Spacing.md,
    paddingVertical: 6,
    marginTop: Platform.OS === 'ios' ? 4 : Spacing.sm,
    maxWidth: '92%',
  },
  text: {
    fontSize: FontSize.tiny,
    color: Colors.textSecondary,
    fontWeight: '600',
    flexShrink: 1,
  },
});
