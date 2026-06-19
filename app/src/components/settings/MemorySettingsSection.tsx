/**
 * MemorySettingsSection — Settings tab section for Memory preferences:
 *   - Foreground auto-unlock toggle
 *   - Show friend memory overlay toggle
 *   - Stats row (places visited, cairns left)
 *   - Destructive: Clear my memory (server + local)
 *
 * v0.2.6.2 (J2 review fix C3): added stats + clear-all destructive
 * action so users can manage / delete their cloud-bound memory data
 * (privacy + GDPR / NZ Privacy Act).
 */

import React, { useState } from 'react';
import { View, Text, Switch, StyleSheet, TouchableOpacity, Alert, ActivityIndicator } from 'react-native';
import { Colors } from '../tokens';
import { Icon } from '../Icon';
import { useMemorySettingsStore } from '../../features/memory/store/useMemorySettingsStore';
import { useMemoryStore } from '../../features/memory/store/useMemoryStore';
import { useMarkerStore } from '../../store/useMarkerStore';
import { useAppStore } from '../../store/useAppStore';
import { deleteAllMemoryFromServer } from '../../services/memorySync';

export function MemorySettingsSection() {
  const fg = useMemorySettingsStore((s) => s.foregroundAutoUnlockEnabled);
  const fri = useMemorySettingsStore((s) => s.showFriendOverlay);
  const setSetting = useMemorySettingsStore((s) => s.set);
  const pointCount = useMemoryStore((s) => s.points.length);
  const userId = useAppStore((s) => s.user?.id ?? null);
  const allMarkers = useMarkerStore((s) => s.markers);
  const myCairnCount = userId ? allMarkers.filter((m) => m.authorId === userId).length : 0;
  const [clearing, setClearing] = useState(false);

  const onClearAll = () => {
    Alert.alert(
      'Clear all memory?',
      'This deletes every place you have walked from this device AND from the cloud. This cannot be undone. Cairns you planted are kept.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            setClearing(true);
            const ok = await deleteAllMemoryFromServer();
            setClearing(false);
            if (!ok) {
              Alert.alert('Could not clear memory', 'Check your connection and try again.');
            }
          },
        },
      ]
    );
  };

  return (
    <View>
      <Text style={styles.sectionHeader}>Memory</Text>
      <View style={styles.card}>
        <ToggleRow
          iconName="Mountain"
          iconBg={Colors.primaryLight}
          label="Clear fog while the app is open"
          hint="When on, walking with the app open clears your map. We never track in the background."
          value={fg}
          onToggle={() => setSetting('foregroundAutoUnlockEnabled', !fg)}
        />
        <View style={styles.divider} />
        <ToggleRow
          iconName="Users"
          iconBg={Colors.runningLight}
          label="Show friends' memory"
          hint="Overlay friends' explored areas on your map (where they share with you)."
          value={fri}
          onToggle={() => setSetting('showFriendOverlay', !fri)}
        />
        <View style={styles.divider} />
        <View style={styles.statsRow}>
          <Text style={styles.statText}>{pointCount} places visited · {myCairnCount} cairns left</Text>
        </View>
        <View style={styles.divider} />
        <TouchableOpacity style={styles.dangerRow} onPress={onClearAll} disabled={clearing}>
          {clearing ? <ActivityIndicator color="#c44545" size="small" /> : null}
          <Text style={styles.dangerText}>{clearing ? 'Clearing…' : 'Clear all my memory'}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

interface RowProps {
  iconName: 'Mountain' | 'Users';
  iconBg: string;
  label: string;
  hint?: string;
  value: boolean;
  onToggle: () => void;
}

function ToggleRow({ iconName, iconBg, label, hint, value, onToggle }: RowProps) {
  return (
    <View style={styles.row}>
      <View style={[styles.iconWrap, { backgroundColor: iconBg }]}>
        <Icon name={iconName} size={16} color={Colors.primary} strokeWidth={2} />
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
  content: { flex: 1, marginRight: 8 },
  label:   { fontSize: 14, color: Colors.textPrimary, fontWeight: '500' },
  hint:    { fontSize: 11, color: Colors.textSecondary, marginTop: 2, lineHeight: 14 },
  divider: { height: 1, backgroundColor: Colors.border, marginLeft: 56 },
  statsRow: { paddingVertical: 12, paddingHorizontal: 16 },
  statText: { fontSize: 12, color: Colors.textSecondary },
  dangerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    gap: 8,
  },
  dangerText: { fontSize: 14, color: '#c44545', fontWeight: '500' },
});
