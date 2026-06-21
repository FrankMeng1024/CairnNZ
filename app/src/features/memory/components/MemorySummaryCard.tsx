/**
 * MemorySummaryCard — bottom info card on the Memory map.
 *
 * v0.2.6.3 (K6 fix): replaced setInterval polling with Zustand selectors.
 * inFlight state lives in the store (memorySync mutates via bumpInFlight).
 * Adds a 600ms minimum-display window so very fast pushes still show
 * "Syncing…" briefly (otherwise the chip would flash imperceptibly).
 *
 * Shows:
 *   - "Your Memory Map" title
 *   - Sync chip (☁️ Syncing… / N pending / All saved)
 *   - Places visited + cairns left counters
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useMemoryStore } from '../store/useMemoryStore';
import { useMarkerStore } from '../../../store/useMarkerStore';
import { useAppStore } from '../../../store/useAppStore';
import { MemoryColors } from '../config/memoryConfig';

const MIN_SYNCING_DISPLAY_MS = 600;

export function MemorySummaryCard() {
  const pointCount = useMemoryStore((s) => s.points.length);
  // M9 fix: read incrementally-maintained count instead of filtering.
  const pendingCount = useMemoryStore((s) => s._unsyncedCount);
  const inFlightCount = useMemoryStore((s) => s.syncState.inFlightCount);
  const userId = useAppStore((s) => s.user?.id ?? null);
  const allMarkers = useMarkerStore((s) => s.markers);

  // Min display window: when inFlight goes true, hold "Syncing…" for at
  // least MIN_SYNCING_DISPLAY_MS so users see the indicator even when
  // the push completes in <100ms (typical good network).
  const [displaySyncing, setDisplaySyncing] = useState(false);
  const lastInFlightStartRef = useRef<number>(0);
  useEffect(() => {
    if (inFlightCount > 0) {
      lastInFlightStartRef.current = Date.now();
      setDisplaySyncing(true);
      return;
    }
    // inFlightCount went to 0 — hold the chip until min window elapses.
    const elapsed = Date.now() - lastInFlightStartRef.current;
    const remaining = Math.max(0, MIN_SYNCING_DISPLAY_MS - elapsed);
    if (remaining === 0) {
      setDisplaySyncing(false);
      return;
    }
    const t = setTimeout(() => setDisplaySyncing(false), remaining);
    return () => clearTimeout(t);
  }, [inFlightCount]);

  const myCairnCount = useMemo(() => {
    if (!userId) return 0;
    return allMarkers.filter((m) => m.authorId === userId).length;
  }, [allMarkers, userId]);

  // L9 fix (v0.2.6.3): "N pending" reads as broken to non-technical
  // users. After a long offline hike showing "400 pending" was
  // anxiety-inducing. New copy: "Saved on this device" while points
  // are local-only — communicates safety. The exact count surfaces
  // only on press/long-press in a future iteration.
  const syncChip = displaySyncing
    ? '☁️↑ Syncing…'
    : pendingCount > 0
    ? '☁️ Saved on this device'
    : '☁️ All synced';

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
  statsRow: { flexDirection: 'row', gap: 18, flexWrap: 'wrap' },
  // flex: 0 on RN-web compiled to flex-shrink:1 which let the Text node
  // collapse to width 0 → "571" rendered as one digit per row. minWidth
  // guarantees each stat block reserves enough room for its content.
  stat: { flex: 0, minWidth: 80 },
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
