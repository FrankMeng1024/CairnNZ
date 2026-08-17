/**
 * HikingPreviewScreen — dev-only preview of the auto-generated Hiking UI
 * from Hiking.spec.json (5 states H0..H4).
 */
import React from 'react';
import { View, TouchableOpacity, Text, StyleSheet, SafeAreaView } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { RouteProp } from '@react-navigation/native';
import type { RootStackParamList } from '../navigation/RootNavigator';
import { HikingScreen as GeneratedHiking } from './hiking_generated/HikingScreen.generated';

type Nav = ReturnType<typeof useNavigation>;

const STATES = ['H0', 'H1', 'H2', 'H3', 'H4'] as const;
type S = (typeof STATES)[number];

export function HikingPreviewScreen() {
  const nav = useNavigation<Nav>();
  const route = useRoute<RouteProp<RootStackParamList, 'HikingPreview'>>();
  const raw = (route.params as { state?: string } | undefined)?.state ?? 'H0';
  const state: S = (STATES.includes(raw as S) ? (raw as S) : 'H0');

  return (
    <View style={styles.root}>
      <View style={styles.phoneFrame}>
        <GeneratedHiking state={state} initial={'F'} />
      </View>
      <SafeAreaView pointerEvents="box-none" style={styles.overlayWrap}>
        <View style={styles.pill}>
          {STATES.map((s) => (
            <TouchableOpacity
              key={s}
              style={[styles.pillBtn, s === state && styles.pillBtnActive]}
              onPress={() => nav.setParams({ state: s } as never)}
            >
              <Text style={[styles.pillText, s === state && styles.pillTextActive]}>{s}</Text>
            </TouchableOpacity>
          ))}
          <TouchableOpacity style={styles.closeBtn} onPress={() => nav.goBack()}>
            <Text style={styles.closeText}>×</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center' },
  phoneFrame: {
    width: 375,
    height: 812,
    overflow: 'hidden',
    backgroundColor: '#F9F6F3',
  },
  overlayWrap: { position: 'absolute', top: 0, left: 0, right: 0, alignItems: 'center', paddingTop: 8 },
  pill: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.75)', borderRadius: 20,
    paddingHorizontal: 6, paddingVertical: 4, gap: 2,
  },
  pillBtn: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 14 },
  pillBtnActive: { backgroundColor: '#455D3C' },
  pillText: { color: '#fff', fontSize: 12, fontWeight: '600', opacity: 0.6 },
  pillTextActive: { opacity: 1 },
  closeBtn: {
    marginLeft: 4, width: 22, height: 22, borderRadius: 11,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.15)',
  },
  closeText: { color: '#fff', fontSize: 16, lineHeight: 18 },
});
