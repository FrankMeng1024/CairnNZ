/**
 * GPSStatusBar — inline indicator showing GPS signal quality.
 * Shows amber bar when accuracy degrades (> 20m).
 *
 * Sprint 43 — STORY-00143
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Colors, Spacing, FontSize, Radius } from './tokens';
import { Icon } from './Icon';
import { GlassPanel } from './GlassPanel';

interface Props {
  accuracy: number | null; // meters, null = no GPS
  visible?: boolean;
}

export function GPSStatusBar({ accuracy, visible = true }: Props) {
  if (!visible) return null;

  // Thresholds: <10m = good (hidden), 10-20m = okay (hidden), >20m = weak (show)
  if (accuracy !== null && accuracy <= 20) return null;

  const isNoGPS = accuracy === null;
  const color = isNoGPS ? Colors.danger : Colors.severityWarning;
  const bgColor = isNoGPS ? Colors.dangerBg : Colors.severityWarningBg;
  const message = isNoGPS ? 'GPS unavailable' : 'GPS signal weak';
  const icon = isNoGPS ? 'MapPin' as const : 'Signal' as const;

  return (
    <View style={[styles.container, { backgroundColor: bgColor, borderColor: color }]}>
      <Icon name={icon} size={14} color={color} strokeWidth={2.5} />
      <Text style={[styles.text, { color }]}>{message}</Text>
      {!isNoGPS && (
        <Text style={styles.accuracy}>±{Math.round(accuracy!)}m</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    borderRadius: Radius.pill,
    borderWidth: 1,
    alignSelf: 'center',
    marginTop: Spacing.xs,
  },
  text: {
    fontSize: FontSize.small,
    fontWeight: '600',
  },
  accuracy: {
    fontSize: FontSize.tiny,
    color: Colors.textMuted,
  },
});
