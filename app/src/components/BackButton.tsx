/**
 * BackButton — shared back navigation chip used by all screens.
 *
 * variant="pill"        — frosted-glass pill chip (BlurView + soft shadow), for
 *                         screens that overlay a map (HikingScreen, MapHistoryScreen).
 *                         Falls back to a translucent white pill on platforms
 *                         where BlurView is unavailable.
 * variant="inline"      — plain text+icon, for screens with a dedicated top bar
 *                         (SettingsScreen, FriendsScreen, RunningScreen)
 * variant="ghostRound"  — R114 (2026-08-07): 36px round quiet back button
 *                         (iOS-style). Used on PinAdjustStep so the "Where's
 *                         your cairn?" title reads as the page anchor and
 *                         back reads as subordinate but has a proper hit
 *                         target. Design §8.
 */
import React, { useRef } from 'react';
import { TouchableOpacity, Text, StyleSheet, Animated, View, Platform } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Colors, Spacing, Radius, FontSize, IconSize, Shadow } from './tokens';
import { Icon } from './Icon';
import { useVisualTheme } from '../hooks/useVisualTheme';

// Lazy require expo-blur — graceful fallback on web / unsupported targets.
let BlurView: any = null;
if (Platform.OS !== 'web') {
  try {
    BlurView = require('expo-blur').BlurView;
  } catch {
    // expo-blur not present — fallback used.
  }
}

interface BackButtonProps {
  variant?: 'pill' | 'inline' | 'ghostRound';
  label?: string;
  onPress?: () => void;
}

export function BackButton({ variant = 'inline', label = 'Back', onPress }: BackButtonProps) {
  const nav = useNavigation();
  const scale = useRef(new Animated.Value(1)).current;
  // R21 (2026-08-18): dark-aware colour. Ink becomes cream on night bg
  // so the inline back stays readable on Hike / MapScreen dark overlays.
  const theme = useVisualTheme();
  const inkColor = theme.iconActive;

  const handlePressIn = () =>
    Animated.spring(scale, { toValue: 0.95, useNativeDriver: true, tension: 300, friction: 10 }).start();
  const handlePressOut = () =>
    Animated.spring(scale, { toValue: 1, useNativeDriver: true, tension: 300, friction: 8 }).start();

  const handlePress = () => {
    if (onPress) onPress();
    else nav.goBack();
  };

  // Inline: no frosted treatment, just an inline back action.
  if (variant === 'inline') {
    return (
      <Animated.View style={{ transform: [{ scale }] }}>
        <TouchableOpacity
          style={styles.inline}
          onPress={handlePress}
          onPressIn={handlePressIn}
          onPressOut={handlePressOut}
          activeOpacity={1}
        >
          <Icon name="ChevronLeft" size={IconSize.sm} color={inkColor} strokeWidth={2.5} />
          <Text style={[styles.inlineText, { color: inkColor }]}>{label}</Text>
        </TouchableOpacity>
      </Animated.View>
    );
  }

  // R114 (2026-08-07): ghostRound — 36px round quiet variant.
  // Used on PinAdjustStep. Sits above the page title so the title reads
  // as the anchor. Icon-only (no label) so it takes minimal visual
  // weight but still meets the 44pt-effective hit target with hitSlop.
  if (variant === 'ghostRound') {
    return (
      <Animated.View style={[{ transform: [{ scale }] }, styles.ghostRoundShadow]}>
        <TouchableOpacity
          style={[styles.ghostRound, { backgroundColor: theme.surfaceElevated, borderColor: theme.border }]}
          onPress={handlePress}
          onPressIn={handlePressIn}
          onPressOut={handlePressOut}
          activeOpacity={1}
          accessibilityRole="button"
          accessibilityLabel={label}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Icon name="ChevronLeft" size={22} color={theme.icon} strokeWidth={2.4} />
        </TouchableOpacity>
      </Animated.View>
    );
  }

  // Pill: frosted-glass effect when BlurView available, soft shadow always.
  return (
    <Animated.View style={[{ transform: [{ scale }] }, styles.pillShadow]}>
      <TouchableOpacity
        onPress={handlePress}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        activeOpacity={1}
      >
        {BlurView ? (
          <BlurView intensity={30} tint={theme.mode === 'night' ? 'dark' : 'light'} style={[styles.pillBlur, { backgroundColor: theme.surface, borderColor: theme.border }]}>
            <View style={styles.pillContent}>
              <Icon name="ChevronLeft" size={IconSize.sm} color={theme.iconActive} strokeWidth={2.5} />
              <Text style={[styles.pillText, { color: theme.foreground }]}>{label}</Text>
            </View>
          </BlurView>
        ) : (
          <View style={[styles.pillBlur, styles.pillFallback, { backgroundColor: theme.surface, borderColor: theme.border }]}>
            <View style={styles.pillContent}>
              <Icon name="ChevronLeft" size={IconSize.sm} color={theme.iconActive} strokeWidth={2.5} />
              <Text style={[styles.pillText, { color: theme.foreground }]}>{label}</Text>
            </View>
          </View>
        )}
      </TouchableOpacity>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  pillShadow: {
    borderRadius: Radius.pill,
    ...Shadow.card,
  },
  pillBlur: {
    borderRadius: Radius.pill,
    overflow: 'hidden',
    backgroundColor: 'rgba(255,255,255,0.45)', // slight tint so blur reads even with low intensity
  },
  pillFallback: {
    backgroundColor: 'rgba(255,255,255,0.65)', // when BlurView absent, semi-translucent
  },
  pillContent: {
    flexDirection: 'row', alignItems: 'center', gap: 2,
    paddingHorizontal: Spacing.md, paddingVertical: 7,
  },
  pillText: { fontSize: FontSize.small, fontWeight: '600', color: Colors.primary },
  // R21 v6 (2026-08-18 user "back的风格参考auth 不应该有白色框"): match Auth
  // exactly — no background, no shadow, just ChevronLeft + "Back" text
  // deep-green on 8pt vertical padding.
  inline: {
    flexDirection: 'row', alignItems: 'center', gap: 2,
    alignSelf: 'flex-start',
    paddingVertical: 8,
  },
  inlineText: {
    fontSize: FontSize.caption, fontWeight: '600', color: Colors.primary,
  },
  // R114 (2026-08-07): ghostRound variant styles.
  ghostRoundShadow: {
    borderRadius: 18,
    ...Shadow.card,
  },
  ghostRound: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
