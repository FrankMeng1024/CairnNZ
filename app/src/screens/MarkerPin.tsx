/**
 * MarkerPin — pressable flag pin rendered on the web-fallback map.
 *
 * Extracted from HikingScreen.tsx (O1 batch 27 refactor).
 * Used by HikingMap's web fallback path (when Mapbox native is unavailable).
 * The Mapbox native path renders its own inline PointAnnotation child views.
 */
import React, { useRef } from 'react';
import {
  Animated, TouchableOpacity, View, Text, StyleSheet,
} from 'react-native';
import { Colors, Shadow } from '../components/tokens';
import { Icon, type IconName } from '../components/Icon';
import { MARKER_META, type MarkerType } from '../data/mockData';
import { FLAG_TYPES } from '../data/flagTypes';

type Props = {
  type: MarkerType;
  x: number;
  y: number;
  onPress: () => void;
  approximate?: boolean;
};

export function MarkerPin({ type, x, y, onPress, approximate }: Props) {
  const meta = MARKER_META[type] || MARKER_META.free;
  const iconName = FLAG_TYPES.find(f => f.id === type)?.icon || 'Flag';
  const scale = useRef(new Animated.Value(1)).current;
  return (
    <Animated.View style={[pinStyles.markerPin, { left: x, top: y, borderColor: meta.color, backgroundColor: meta.bg, transform: [{ scale }] }]}>
      <TouchableOpacity
        activeOpacity={1}
        onPress={onPress}
        onPressIn={() => Animated.spring(scale, { toValue: 0.88, useNativeDriver: true, tension: 300, friction: 10 }).start()}
        onPressOut={() => Animated.spring(scale, { toValue: 1, useNativeDriver: true, tension: 300, friction: 8 }).start()}
        style={{ width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center' }}
      >
        <Icon name={iconName as IconName} size={11} color={meta.color} strokeWidth={2.5} />
        {approximate && (
          <View style={pinStyles.approxBadge}>
            <Text style={pinStyles.approxBadgeText}>~</Text>
          </View>
        )}
      </TouchableOpacity>
    </Animated.View>
  );
}

const pinStyles = StyleSheet.create({
  markerPin: {
    position: 'absolute', width: 24, height: 24, borderRadius: 12,
    borderWidth: 2, alignItems: 'center', justifyContent: 'center',
    backgroundColor: Colors.surface, ...Shadow.card,
  },
  approxBadge: {
    position: 'absolute', top: -4, right: -4,
    width: 14, height: 14, borderRadius: 7,
    backgroundColor: Colors.severityCaution, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1.5, borderColor: '#fff',
  },
  approxBadgeText: { fontSize: 9, fontWeight: '800', color: '#fff' },
});
