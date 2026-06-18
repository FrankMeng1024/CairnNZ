/**
 * MemoryScreen — the main Memory tab screen.
 *
 * Composition:
 *   <MemoryScreen>
 *     <MemoryMap>            ← renders mapbox + fog + cairns
 *     <MemorySummaryCard>    ← bottom sheet stats
 *   </MemoryScreen>
 *
 * This screen owns NO business logic — it just composes components and
 * wires user-position to the map. All unlock/render logic lives in the
 * sub-components and services.
 */

import React, { useEffect } from 'react';
import { View, StyleSheet, SafeAreaView, Text } from 'react-native';
import { useTrackingStore } from '../../../store/useTrackingStore';
import { useMemoryStore } from '../store/useMemoryStore';
import { performInitialRevealIfNeeded } from '../services/unlockEngine';
import { MemoryColors } from '../config/memoryConfig';
import { MemoryMap } from '../components/MemoryMap';
import { MemorySummaryCard } from '../components/MemorySummaryCard';

export function MemoryScreen() {
  const lastCoord = useTrackingStore((s) => s.lastCoordinate);
  const initialDone = useMemoryStore((s) => s.initialRevealDone);

  // Trigger initial reveal once we have any GPS fix.
  useEffect(() => {
    if (initialDone) return;
    if (!lastCoord) return;
    performInitialRevealIfNeeded(lastCoord.lat, lastCoord.lng);
  }, [initialDone, lastCoord]);

  return (
    <SafeAreaView style={styles.root}>
      {lastCoord ? (
        <MemoryMap centerLat={lastCoord.lat} centerLng={lastCoord.lng} />
      ) : (
        <View style={styles.waitingForGps}>
          <Text style={styles.waitingTitle}>Looking for your position…</Text>
          <Text style={styles.waitingSub}>
            We need a GPS fix to draw your memory map.
          </Text>
        </View>
      )}
      <MemorySummaryCard />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: MemoryColors.cream,
  },
  waitingForGps: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  waitingTitle: {
    fontSize: 16,
    fontWeight: '500',
    color: MemoryColors.sepiaDeep,
  },
  waitingSub: {
    fontSize: 13,
    color: MemoryColors.cairnPublic,
    marginTop: 8,
    textAlign: 'center',
  },
});
