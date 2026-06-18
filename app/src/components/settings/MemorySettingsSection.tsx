/**
 * MemorySettingsSection — drop-in section for SettingsScreen exposing
 * the user-tunable memory preferences:
 *   - Foreground auto-unlock (default on)
 *   - Show friend memory overlay on map (default on)
 *
 * Self-contained: brings its own SectionHeader, two ToggleRows wired
 * to useMemorySettingsStore. Can be imported directly into the
 * existing SettingsScreen ScrollView.
 *
 * Visual matches the rest of SettingsScreen — uses the same Colors
 * tokens and Switch/Toggle pattern. We re-implement (not import) the
 * row primitives because SettingsScreen's ToggleRow is file-local;
 * extracting it is out of scope.
 */

import React from 'react';
import { View, Text, Switch, StyleSheet } from 'react-native';
import { Colors } from '../tokens';
import { useMemorySettingsStore } from '../../features/memory/store/useMemorySettingsStore';

export function MemorySettingsSection() {
  const fg = useMemorySettingsStore((s) => s.foregroundAutoUnlockEnabled);
  const fri = useMemorySettingsStore((s) => s.showFriendOverlay);
  const setSetting = useMemorySettingsStore((s) => s.set);

  return (
    <View>
      <Text style={styles.sectionHeader}>Memory</Text>
      <View style={styles.card}>
        <ToggleRow
          icon="🌫️"
          iconBg={Colors.primaryLight}
          label="Clear fog while the app is open"
          hint="When on, walking with the app open clears your map. We never track in the background."
          value={fg}
          onToggle={() => setSetting('foregroundAutoUnlockEnabled', !fg)}
        />
        <View style={styles.divider} />
        <ToggleRow
          icon="👥"
          iconBg={Colors.runningLight}
          label="Show friends' memory"
          hint="Overlay friends' explored areas on your map (where they share with you)."
          value={fri}
          onToggle={() => setSetting('showFriendOverlay', !fri)}
        />
      </View>
    </View>
  );
}

interface RowProps {
  icon: string;
  iconBg: string;
  label: string;
  hint?: string;
  value: boolean;
  onToggle: () => void;
}

function ToggleRow({ icon, iconBg, label, hint, value, onToggle }: RowProps) {
  return (
    <View style={styles.row}>
      <View style={[styles.iconWrap, { backgroundColor: iconBg }]}>
        <Text style={styles.iconText}>{icon}</Text>
      </View>
      <View style={styles.content}>
        <Text style={styles.label}>{label}</Text>
        {hint ? <Text style={styles.hint} numberOfLines={2}>{hint}</Text> : null}
      </View>
      <Switch
        value={value}
        onValueChange={onToggle}
        trackColor={{ false: Colors.border, true: Colors.primary }}
        thumbColor={Colors.surface}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  sectionHeader: {
    fontSize: 11,
    fontWeight: '600',
    color: Colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 1.2,
    marginTop: 24,
    marginBottom: 8,
    marginLeft: 16,
  },
  card: {
    backgroundColor: Colors.surface,
    marginHorizontal: 12,
    borderRadius: 12,
    paddingVertical: 4,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 12,
  },
  iconWrap: {
    width: 32, height: 32, borderRadius: 16,
    alignItems: 'center', justifyContent: 'center',
    marginRight: 12,
  },
  iconText: { fontSize: 16 },
  content: { flex: 1, marginRight: 8 },
  label:   { fontSize: 14, color: Colors.textPrimary, fontWeight: '500' },
  hint:    { fontSize: 11, color: Colors.textSecondary, marginTop: 2, lineHeight: 14 },
  divider: { height: 1, backgroundColor: Colors.border, marginLeft: 56 },
});
