/**
 * RoutesPreviewScreen — dev-only preview of the auto-generated Routes UI
 * from Routes.spec.json. Mirror of HomePreviewScreen / FriendsPreviewScreen.
 * Does NOT touch the real RoutesScreen.tsx.
 */
import React from 'react';
import { View, TouchableOpacity, Text, StyleSheet, SafeAreaView, ScrollView } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { RouteProp } from '@react-navigation/native';
import type { RootStackParamList } from '../navigation/RootNavigator';
import { RoutesScreen as GeneratedRoutes } from './routes_generated/RoutesScreen.generated';

type Nav = ReturnType<typeof useNavigation>;

const STATES = ['R0', 'R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'R7', 'R8', 'R9'] as const;
type S = (typeof STATES)[number];

export function RoutesPreviewScreen() {
  const nav = useNavigation<Nav>();
  const route = useRoute<RouteProp<RootStackParamList, 'RoutesPreview'>>();
  const raw = (route.params as { state?: string } | undefined)?.state ?? 'R0';
  const state: S = (STATES.includes(raw as S) ? (raw as S) : 'R0');

  return (
    <View style={styles.root}>
      <View style={styles.phoneFrame}>
        <GeneratedRoutes state={state} />
      </View>
      <SafeAreaView pointerEvents="box-none" style={styles.overlayWrap}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.pillWrap}
        >
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
        </ScrollView>
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
    backgroundColor: '#F7F3EA',
  },
  overlayWrap: { position: 'absolute', top: 0, left: 0, right: 0, alignItems: 'center', paddingTop: 8 },
  pillWrap: { paddingHorizontal: 12 },
  pill: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.75)', borderRadius: 20,
    paddingHorizontal: 6, paddingVertical: 4, gap: 2,
  },
  pillBtn: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 14 },
  pillBtnActive: { backgroundColor: '#0F5D45' },
  pillText: { color: '#fff', fontSize: 12, fontWeight: '600', opacity: 0.6 },
  pillTextActive: { opacity: 1 },
  closeBtn: {
    marginLeft: 4, width: 22, height: 22, borderRadius: 11,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.15)',
  },
  closeText: { color: '#fff', fontSize: 16, lineHeight: 18 },
});
