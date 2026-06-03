/**
 * GlassPanel — Glassmorphism container with backdrop blur.
 * Uses expo-blur on native, CSS backdrop-filter on web.
 *
 * Sprint 42 — STORY-00140: Visual Quality Foundation
 */
import React from 'react';
import { View, StyleSheet, Platform, ViewStyle } from 'react-native';

// expo-blur may not be available in web/Expo Go — graceful fallback
let BlurView: any = null;
try {
  BlurView = require('expo-blur').BlurView;
} catch {
  BlurView = null;
}

interface GlassPanelProps {
  intensity?: number;       // blur intensity (1-100, default 20)
  tint?: 'light' | 'dark'; // glass tint
  children: React.ReactNode;
  style?: ViewStyle;
  borderRadius?: number;
}

export function GlassPanel({
  intensity = 20,
  tint = 'light',
  children,
  style,
  borderRadius = 20,
}: GlassPanelProps) {
  const bgColor = tint === 'light'
    ? 'rgba(250, 247, 242, 0.72)'
    : 'rgba(26, 24, 22, 0.75)';

  const borderColor = tint === 'light'
    ? 'rgba(255, 255, 255, 0.3)'
    : 'rgba(255, 255, 255, 0.08)';

  // Native with expo-blur available
  if (BlurView && Platform.OS !== 'web') {
    return (
      <BlurView
        intensity={intensity}
        tint={tint === 'light' ? 'systemChromeMaterialLight' : 'systemChromeMaterialDark'}
        style={[
          styles.container,
          { borderRadius, borderColor },
          style,
        ]}
      >
        <View style={[styles.innerGlow, { borderRadius }]} />
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
      <View style={[styles.innerGlow, { borderRadius }]} />
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
    backgroundColor: 'rgba(255, 255, 255, 0.5)',
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
