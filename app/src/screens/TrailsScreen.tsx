/**
 * TrailsScreen — the "Trails" bottom tab.
 *
 * v0.2.6 layout (Variant D — "Two Big Cards"):
 *   ┌─ TrailsHeader (logo + greeting + chips) ─┐
 *   │                                          │
 *   │ RecentActivityRow (last hike)            │
 *   │                                          │
 *   │ ┌──────────┐ ┌──────────┐                │
 *   │ │ Hiking   │ │ Running  │                │
 *   │ └──────────┘ └──────────┘                │
 *   │                                          │
 *   │ ┌──────────────────────────┐             │
 *   │ │ 🪨 Leave a Cairn here  › │             │
 *   │ └──────────────────────────┘             │
 *   │                                          │
 *   └──────────────────────────────────────────┘
 *
 * This file is intentionally thin — every visual block is its own
 * component in app/src/components/trails/. To re-skin the layout,
 * compose different blocks here; do NOT inline new visual code.
 *
 * Plant entry: nav.navigate('Plant') opens the new GPS-based plant
 * flow (no AR). Hiking / Running keep their existing screens.
 */

import React from 'react';
import { ScrollView, View, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Colors } from '../components/tokens';
import { TrailsHeader } from '../components/trails/TrailsHeader';
import { RecentActivityRow } from '../components/trails/RecentActivityRow';
import { ActivityBigCard } from '../components/trails/ActivityBigCard';
import { LeaveCairnCard } from '../components/trails/LeaveCairnCard';

export function TrailsScreen() {
  const nav = useNavigation<any>();
  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <TrailsHeader />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <RecentActivityRow />
        <View style={styles.cardRow}>
          <ActivityBigCard kind="hiking"  onPress={() => nav.navigate('Hiking')} />
          <ActivityBigCard kind="running" onPress={() => nav.navigate('Running')} />
        </View>
        <LeaveCairnCard onPress={() => nav.navigate('Plant')} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root:    { flex: 1, backgroundColor: Colors.bg },
  content: { paddingHorizontal: 20, paddingTop: 4, paddingBottom: 20, gap: 12 },
  cardRow: { flexDirection: 'row', gap: 10 },
});
