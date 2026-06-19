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

import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useMemoryStore } from '../store/useMemoryStore';
import { useMarkerStore } from '../../../store/useMarkerStore';
import { useAppStore } from '../../../store/useAppStore';
import { MemoryColors } from '../config/memoryConfig';
import { getSyncStatus } from '../../../services/memorySync';

export function MemorySummaryCard() {
  const pointCount = useMemoryStore((s) => s.points.length);
  const userId = useAppStore((s) => s.user?.id ?? null);
  const allMarkers = useMarkerStore((s) => s.markers);
  // Poll every 2s for sync status — cheap, getSyncStatus is local read.
  const [syncStatus, setSyncStatus] = useState(() => getSyncStatus());
  useEffect(() => {
    const id = setInterval(() => setSyncStatus(getSyncStatus()), 2_000);
    return () => clearInterval(id);
  }, []);

  const myCairnCount = useMemo(() => {
    if (!userId) return 0;
    return allMarkers.filter((m) => m.authorId === userId).length;
  }, [allMarkers, userId]);

  const syncChip = syncStatus.inFlight
    ? '☁️↑ Syncing…'
    : syncStatus.pendingCount > 0
    ? `☁️ ${syncStatus.pendingCount} pending`
    : '☁️ All saved';

  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <Text style={styles.title}>Your Memory Map</Text>
        <Text style={styles.syncChip}>{syncChip}</Text>
      </View>
      <View style={styles.statsRow}>
        <Stat label="places visited" value={String(pointCount)} />
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
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  syncChip: {
    fontSize: 11,
    color: MemoryColors.cairnPublic,
    backgroundColor: '#fbf6e8',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
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
