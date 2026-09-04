/**
 * GlassPanel — restrained semantic translucent material.
 * Uses expo-blur on native and CSS backdrop-filter on web without allowing
 * blur tint to become a second light/dark color system.
 *
 * Sprint 42 — STORY-00140: Visual Quality Foundation
 */
import React from 'react';
import { View, StyleSheet, Platform, ViewStyle, StyleProp } from 'react-native';
import { getVisualTheme, RadiusRole, type VisualThemeTokens } from './tokens';
import { useVisualTheme } from '../hooks/useVisualTheme';

// expo-blur may not be available in web/Expo Go — graceful fallback
let BlurView: any = null;
try {
  BlurView = require('expo-blur').BlurView;
} catch {
  BlurView = null;
}

interface GlassPanelProps {
  intensity?: number;       // blur intensity (1-100, default 20)
  /** Native blur rendering hint only; semantic colors come from `material`. */
  tint?: 'light' | 'dark';
  material?: 'scenic' | 'standard' | 'elevated';
  /** For non-adaptive authorities such as Auth. Supports all three states. */
  mode?: VisualThemeTokens['mode'];
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  borderRadius?: number;
}

export function GlassPanel({
  intensity = 20,
  tint,
  material = 'scenic',
  mode,
  children,
  style,
  borderRadius = RadiusRole.panel,
}: GlassPanelProps) {
  const activeTheme = useVisualTheme();
  const theme = mode ? getVisualTheme(mode) : activeTheme;
  const bgColor = material === 'elevated'
    ? theme.surfaceElevated
    : material === 'standard'
      ? theme.surfacePrimary
      : theme.scenicSurface;
  const borderColor = theme.borderSubtle;
  const edgeColor = theme.borderStrong;
  // expo-blur exposes a binary native tint API. It is only a rendering hint;
  // the three-state semantic material above remains authoritative.
  const blurTint = tint ?? (theme.mode === 'day' ? 'light' : 'dark');

  // Native with expo-blur available
  if (BlurView && Platform.OS !== 'web') {
    return (
      <BlurView
        intensity={intensity}
        tint={blurTint === 'light' ? 'systemChromeMaterialLight' : 'systemChromeMaterialDark'}
        style={[
          styles.container,
          { backgroundColor: bgColor, borderRadius, borderColor },
          style,
        ]}
      >
        <View style={[styles.innerGlow, { borderRadius, backgroundColor: edgeColor }]} />
        {children}
      </BlurView>
    );
  }

  // Web or fallback (no native blur)
  return (
    <View
      style={[
        styles.container,
        {
          backgroundColor: bgColor,
          borderRadius,
          borderColor,
          // @ts-ignore — web-only property
          backdropFilter: `blur(${intensity}px)`,
          WebkitBackdropFilter: `blur(${intensity}px)`,
        },
        style,
      ]}
    >
      <View style={[styles.innerGlow, { borderRadius, backgroundColor: edgeColor }]} />
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    overflow: 'hidden',
    borderWidth: 1,
  },
  innerGlow: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 1,
  },
});

// ── Elevation Shadows ───────────────────────────────────────────────────────

export const Elevation = {
  0: {},
  1: Platform.select({
    ios: { shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 3 },
    android: { elevation: 2 },
    default: {},
  }) as ViewStyle,
  2: Platform.select({
    ios: { shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.08, shadowRadius: 12 },
    android: { elevation: 4 },
    default: {},
  }) as ViewStyle,
  3: Platform.select({
    ios: { shadowColor: '#000', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.1, shadowRadius: 24 },
    android: { elevation: 8 },
    default: {},
  }) as ViewStyle,
  4: Platform.select({
    ios: { shadowColor: '#000', shadowOffset: { width: 0, height: 16 }, shadowOpacity: 0.14, shadowRadius: 48 },
    android: { elevation: 12 },
    default: {},
  }) as ViewStyle,
};
