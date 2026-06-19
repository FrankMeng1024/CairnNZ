/**
 * MemoryScreen — the main Memory tab screen.
 *
 * v0.2.6.1: previously this screen relied on `useTrackingStore.lastCoordinate`,
 * which only gets populated when a Hiking session is active. Per user
 * feedback, Memory should work without first tapping Hiking — opening
 * the app + Memory tab is enough. We now:
 *   - request foreground location permission on first mount
 *   - read a one-shot GPS fix to render the map
 *   - keep listening to ForegroundUnlockManager's GPS stream for fog
 *     unlocks
 *
 * Composition:
 *   <MemoryScreen>
 *     <MemoryMap>            ← renders mapbox + fog + cairns
 *     <MemorySummaryCard>    ← bottom sheet stats
 *   </MemoryScreen>
 */

import React, { useEffect, useState } from 'react';
import { View, StyleSheet, SafeAreaView, Text, ActivityIndicator } from 'react-native';
import * as Location from 'expo-location';
import { useTrackingStore } from '../../../store/useTrackingStore';
import { useMemoryStore } from '../store/useMemoryStore';
import { performInitialRevealIfNeeded } from '../services/unlockEngine';
import { MemoryColors } from '../config/memoryConfig';
import { MemoryMap } from '../components/MemoryMap';
import { MemorySummaryCard } from '../components/MemorySummaryCard';

interface FixState {
  lat: number;
  lng: number;
}

export function MemoryScreen() {
  // Either source of the user's position works:
  //   1. Active Hiking session pushes into useTrackingStore.lastCoordinate
  //   2. This screen pulls a one-shot fix on mount
  // Whichever arrives first wins. After that the ForegroundUnlockManager
  // keeps the fog up to date as the user moves.
  const trackedCoord = useTrackingStore((s) => s.lastCoordinate);
  const initialDone = useMemoryStore((s) => s.initialRevealDone);
  const [oneShot, setOneShot] = useState<FixState | null>(null);
  const [permissionDenied, setPermissionDenied] = useState(false);

  // One-shot location request on first mount.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        let perm = await Location.getForegroundPermissionsAsync();
        if (perm.status !== 'granted') {
          perm = await Location.requestForegroundPermissionsAsync();
        }
        if (cancelled) return;
        if (perm.status !== 'granted') {
          setPermissionDenied(true);
          return;
        }
        const loc = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        if (cancelled) return;
        setOneShot({
          lat: loc.coords.latitude,
          lng: loc.coords.longitude,
        });
      } catch {
        // Silent fail — UI shows "Looking for your position…" indefinitely.
        // The user can tap Hiking to retry from a different code path.
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Use whichever fix we have.
  const coord = trackedCoord ?? oneShot;

  // Trigger initial reveal once we have any GPS fix.
  useEffect(() => {
    if (initialDone) return;
    if (!coord) return;
    performInitialRevealIfNeeded(coord.lat, coord.lng);
  }, [initialDone, coord]);

  return (
    <SafeAreaView style={styles.root}>
      {coord ? (
        <MemoryMap centerLat={coord.lat} centerLng={coord.lng} />
      ) : permissionDenied ? (
        <View style={styles.waitingForGps}>
          <Text style={styles.waitingTitle}>Location permission needed</Text>
          <Text style={styles.waitingSub}>
            Memory needs your location to draw the map. Open Settings to grant access.
          </Text>
        </View>
      ) : (
        <View style={styles.waitingForGps}>
          <ActivityIndicator color={MemoryColors.sepia} size="large" />
          <Text style={[styles.waitingTitle, { marginTop: 16 }]}>Looking for your position…</Text>
          <Text style={styles.waitingSub}>
            We need a GPS fix to draw your memory map. This usually takes a few seconds outdoors.
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
