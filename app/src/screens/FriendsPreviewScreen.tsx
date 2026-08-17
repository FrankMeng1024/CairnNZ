/**
 * FriendsPreviewScreen — dev-only preview of the auto-generated Friends UI.
 *
 * Reads `state` from route params (defaults to F0) and mounts the generated
 * FriendsScreen component. Also renders a tiny state switcher pill at the
 * top so you can flip through F0..F6 without leaving the preview.
 *
 * NOT wired to real data. NOT used in production. Delete once real
 * FriendsScreen has been migrated.
 */
import React from 'react';
import { View, TouchableOpacity, Text, StyleSheet, SafeAreaView } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { RouteProp } from '@react-navigation/native';
import type { RootStackParamList } from '../navigation/RootNavigator';
import { FriendsScreen as GeneratedFriends } from './friends_generated/FriendsScreen.generated';

type Nav = ReturnType<typeof useNavigation>;

const STATES = ['F0', 'F1', 'F2', 'F3', 'F4', 'F5', 'F6'] as const;
type S = (typeof STATES)[number];

export function FriendsPreviewScreen() {
  const nav = useNavigation<Nav>();
  const route = useRoute<RouteProp<RootStackParamList, 'FriendsPreview'>>();
  const initial = 'F' as const;
  const raw = (route.params as { state?: string } | undefined)?.state ?? 'F0';
  const state: S = (STATES.includes(raw as S) ? (raw as S) : 'F0');

  return (
    <View style={styles.root}>
      {/* Fixed phone-viewport frame so the absolute-positioned generated
          layout renders 1:1 at design coordinates regardless of window size */}
      <View style={styles.phoneFrame}>
        <GeneratedFriends state={state} initial={initial} />
      </View>

      {/* Dev overlay: state switcher */}
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
    backgroundColor: '#F9F7EF',
  },
  overlayWrap: {
    position: 'absolute',
    top: 0, left: 0, right: 0,
    alignItems: 'center',
    paddingTop: 8,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.75)',
    borderRadius: 20,
    paddingHorizontal: 6,
    paddingVertical: 4,
    gap: 2,
  },
  pillBtn: {
    paddingHorizontal: 8, paddingVertical: 4, borderRadius: 14,
  },
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
