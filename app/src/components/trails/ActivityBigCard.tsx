/**
 * ActivityBigCard — large gradient card for Hiking or Running.
 *
 * Used in the Trails tab in a left-right pair. Pure presentational —
 * caller controls the navigation target via `onPress`.
 *
 * Variant configuration (gradient, color tokens, icon, copy) lives in
 * a single config map so adding a third activity in future is a one-
 * line change here, not a JSX rewrite.
 */

import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Colors } from '../tokens';

export type ActivityKind = 'hiking' | 'running';

interface VariantStyle {
  gradient: { from: string; mid: string; to: string };
  shadow: string;
  icon: string;
  title: string;
  sub: string;
}

const ACTIVITY_VARIANTS: Record<ActivityKind, VariantStyle> = {
  hiking: {
    gradient: { from: '#6a8a52', mid: Colors.primary, to: Colors.primaryDark },
    shadow: 'rgba(74, 107, 56, 0.25)',
    icon: '🥾',
    title: 'Hiking',
    sub: 'Track route\nplant cairns',
  },
  running: {
    gradient: { from: '#4a8bc4', mid: Colors.running, to: '#2d5e8e' },
    shadow: 'rgba(45, 94, 142, 0.25)',
    icon: '🏃',
    title: 'Running',
    sub: 'Lock screen\nvoice cues',
  },
};

interface Props {
  kind: ActivityKind;
  onPress: () => void;
}

export function ActivityBigCard({ kind, onPress }: Props) {
  const v = ACTIVITY_VARIANTS[kind];
  // RN doesn't support multi-stop CSS gradients out-of-the-box without
  // expo-linear-gradient. To keep this card dependency-free in the
  // skeleton, fall back to a flat solid using the mid color. When you
  // wire in expo-linear-gradient you can swap this for a real gradient
  // — the variant config already provides the stops.
  return (
    <TouchableOpacity
      activeOpacity={0.85}
      onPress={onPress}
      style={[
        styles.card,
        { backgroundColor: v.gradient.mid, shadowColor: v.shadow },
      ]}
    >
      <Text style={styles.icon}>{v.icon}</Text>
      <View>
        <Text style={styles.title}>{v.title}</Text>
        <Text style={styles.sub}>{v.sub}</Text>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    borderRadius: 18,
    padding: 18,
    minHeight: 150,
    justifyContent: 'space-between',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 1,
    shadowRadius: 18,
    elevation: 6,
  },
  icon:  { fontSize: 28 },
  title: { fontSize: 18, color: '#fff', fontWeight: '700', marginTop: 4 },
  sub:   { fontSize: 11, color: 'rgba(255,255,255,0.85)', marginTop: 4, lineHeight: 14 },
});
