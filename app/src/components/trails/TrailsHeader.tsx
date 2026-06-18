/**
 * TrailsHeader — top section of the Trails tab.
 *
 * Logo + greeting + stats chips. Pulls stats from session/marker/memory
 * stores so the chip values are real, not mock.
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useSessionStore } from '../../store/useSessionStore';
import { useMarkerStore } from '../../store/useMarkerStore';
import { useMemoryStore } from '../../features/memory/store/useMemoryStore';
import { Colors } from '../tokens';

const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;

function formatGreeting(now: Date): string {
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const hour = now.getHours();
  const phase = hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening';
  return `${days[now.getDay()]} ${phase}`;
}

export function TrailsHeader() {
  const sessions  = useSessionStore((s) => s.sessions);
  const markers   = useMarkerStore((s) => s.markers);
  const tileCount = useMemoryStore((s) => s.tiles.size);

  const weekKm = React.useMemo(() => {
    const cutoff = Date.now() - ONE_WEEK_MS;
    let m = 0;
    for (const sess of sessions) {
      if ((sess.startedAt ?? 0) >= cutoff) m += sess.distanceM ?? 0;
    }
    return Math.round(m / 100) / 10;
  }, [sessions]);

  const greeting = React.useMemo(() => formatGreeting(new Date()), []);

  return (
    <View style={styles.root}>
      <View style={styles.logoRow}>
        <Text style={styles.logoIcon}>▲</Text>
        <Text style={styles.logoText}>Cairn</Text>
      </View>
      <Text style={styles.greeting}>{greeting}</Text>
      <View style={styles.chips}>
        <Chip label="this week" value={`${weekKm} km`} />
        <Chip label="cairns"    value={String(markers.length)} />
        <Chip label="explored"  value={String(tileCount)} />
      </View>
    </View>
  );
}

function Chip({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.chip}>
      <Text style={styles.chipValue}>{value}</Text>
      <Text style={styles.chipLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root:     { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 12 },
  logoRow:  { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  logoIcon: { fontSize: 22, color: Colors.primary, fontWeight: '700' },
  logoText: { fontSize: 20, fontWeight: '600', color: Colors.textPrimary },
  greeting: { fontSize: 12, color: Colors.textSecondary },
  chips:    { flexDirection: 'row', gap: 6, marginTop: 8, flexWrap: 'wrap' },
  chip: {
    backgroundColor: Colors.surface,
    borderWidth: 1, borderColor: Colors.border,
    paddingHorizontal: 9, paddingVertical: 5,
    borderRadius: 12,
    flexDirection: 'row', alignItems: 'baseline', gap: 4,
  },
  chipValue: { fontSize: 11, fontWeight: '700', color: Colors.primary },
  chipLabel: { fontSize: 10, color: Colors.textSecondary },
});
