/**
 * MemoryScreen — the main Memory tab screen.
 *
 * v0.2.6.2 (J2 review fixes):
 *   - 12s timeout on getCurrentPositionAsync. Catch path now sets an
 *     error state instead of leaving the spinner forever.
 *   - "Try again" button on the waiting state.
 *   - Permission-denied shows a real "Open Settings" button via
 *     Linking.openSettings().
 *
 * Source-of-position fallback chain:
 *   1. useTrackingStore.lastCoordinate (active Hiking session)
 *   2. one-shot Location.getCurrentPositionAsync on mount
 *   Whichever arrives first wins.
 */

import React, { useEffect, useState } from 'react';
import { View, StyleSheet, SafeAreaView, Text, ActivityIndicator, TouchableOpacity, Linking } from 'react-native';
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

const ONE_SHOT_TIMEOUT_MS = 12_000;

type FailReason = 'permission' | 'timeout' | 'error';

export function MemoryScreen() {
  const trackedCoord = useTrackingStore((s) => s.lastCoordinate);
  const initialDone = useMemoryStore((s) => s.initialRevealDone);
  const [oneShot, setOneShot] = useState<FixState | null>(null);
  const [failReason, setFailReason] = useState<FailReason | null>(null);
  const [retryToken, setRetryToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setFailReason(null);

    const fetchOnce = async () => {
      try {
        let perm = await Location.getForegroundPermissionsAsync();
        if (perm.status !== 'granted') {
          perm = await Location.requestForegroundPermissionsAsync();
        }
        if (cancelled) return;
        if (perm.status !== 'granted') {
          setFailReason('permission');
          return;
        }
        // Race the GPS request against a hard timeout — Apple's
        // getCurrentPositionAsync can hang indefinitely on bad signal.
        const locPromise = Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.High,
        });
        const timeoutPromise = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('timeout')), ONE_SHOT_TIMEOUT_MS)
        );
        const loc = (await Promise.race([locPromise, timeoutPromise])) as Awaited<typeof locPromise>;
        if (cancelled) return;
        setOneShot({
          lat: loc.coords.latitude,
          lng: loc.coords.longitude,
        });
      } catch (e: any) {
        if (cancelled) return;
        setFailReason(e?.message === 'timeout' ? 'timeout' : 'error');
      }
    };
    void fetchOnce();
    return () => { cancelled = true; };
  }, [retryToken]);

  const coord = trackedCoord ?? oneShot;

  useEffect(() => {
    if (initialDone) return;
    if (!coord) return;
    performInitialRevealIfNeeded(coord.lat, coord.lng);
  }, [initialDone, coord]);

  return (
    <SafeAreaView style={styles.root}>
      {coord ? (
        <MemoryMap centerLat={coord.lat} centerLng={coord.lng} />
      ) : failReason === 'permission' ? (
        <View style={styles.waitingForGps}>
          <Text style={styles.waitingTitle}>Location permission needed</Text>
          <Text style={styles.waitingSub}>
            Memory needs your location to draw the map.
          </Text>
          <TouchableOpacity style={styles.primaryBtn} onPress={() => Linking.openSettings()}>
            <Text style={styles.primaryBtnText}>Open Settings</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.secondaryBtn} onPress={() => setRetryToken((n) => n + 1)}>
            <Text style={styles.secondaryBtnText}>Try again</Text>
          </TouchableOpacity>
        </View>
      ) : failReason === 'timeout' || failReason === 'error' ? (
        <View style={styles.waitingForGps}>
          <Text style={styles.waitingTitle}>
            {failReason === 'timeout' ? 'Could not get a GPS fix' : 'Location unavailable'}
          </Text>
          <Text style={styles.waitingSub}>
            {failReason === 'timeout'
              ? 'GPS signal is weak. Move outside or near a window and try again.'
              : 'We could not read your location. Check that location services are on.'}
          </Text>
          <TouchableOpacity style={styles.primaryBtn} onPress={() => setRetryToken((n) => n + 1)}>
            <Text style={styles.primaryBtnText}>Try again</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <View style={styles.waitingForGps}>
          <ActivityIndicator color={MemoryColors.sepia} size="large" />
          <Text style={[styles.waitingTitle, { marginTop: 16 }]}>Looking for your position…</Text>
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
  primaryBtn: {
    marginTop: 20,
    backgroundColor: MemoryColors.sepia,
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 12,
  },
  primaryBtnText: { color: '#fff', fontSize: 14, fontWeight: '500' },
  secondaryBtn: {
    marginTop: 10,
    paddingVertical: 10,
    paddingHorizontal: 18,
  },
  secondaryBtnText: { color: MemoryColors.cairnPublic, fontSize: 13 },
});
