/**
 * MemorySummaryCard — bottom info card on the Memory map.
 *
 * Shows:
 *   - "Your Memory Map" title
 *   - Tile count (rough scale: # of unique zoom-17 tiles touched)
 *   - Cairn count (markers planted by you)
 *   - Friend memory share indicator
 *
 * No percentages of country/global — by product policy these would
 * be too small to be meaningful and demoralizing. We may add region-
 * level percentages in a later release.
 */

import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useMemoryStore } from '../store/useMemoryStore';
import { useMarkerStore } from '../../../store/useMarkerStore';
import { useAppStore } from '../../../store/useAppStore';
import { MemoryColors } from '../config/memoryConfig';

export function MemorySummaryCard() {
  const tileCount = useMemoryStore((s) => s.tiles.size);
  const userId = useAppStore((s) => s.user?.id ?? null);
  const allMarkers = useMarkerStore((s) => s.markers);

  const myCairnCount = useMemo(() => {
    if (!userId) return 0;
    return allMarkers.filter((m) => m.authorId === userId).length;
  }, [allMarkers, userId]);

  return (
    <View style={styles.card}>
      <Text style={styles.title}>Your Memory Map</Text>
      <View style={styles.statsRow}>
        <Stat label="explored areas" value={String(tileCount)} />
        <Stat label="cairns left" value={String(myCairnCount)} />
      </View>
    </View>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    position: 'absolute',
    left: 12,
    right: 12,
    bottom: 12,
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: '#e8dfc8',
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  title: {
    fontSize: 14,
    fontWeight: '500',
    color: MemoryColors.sepiaDeep,
    marginBottom: 8,
  },
  statsRow: { flexDirection: 'row', gap: 18 },
  stat: { flex: 0 },
  statValue: {
    fontSize: 18,
    fontWeight: '500',
    color: MemoryColors.sepia,
  },
  statLabel: {
    fontSize: 11,
    color: MemoryColors.cairnPublic,
    marginTop: 2,
  },
});
