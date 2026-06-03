/**
 * MapMarkerPin — the canonical multi-layer marker visual.
 *
 * PRD3 E-015. Replaces the inline 28px circle previously rendered ad-hoc
 * in MapScreen / HikingScreen. Layers (back to front):
 *
 *   1. soft halo (type-color, blur via opacity stops)
 *   2. base disc (type-color tint + border)
 *   3. icon (lucide or CairnStoneIcon)
 *   4. shadow (RN elevation, not a layer per se)
 *   5. friend avatar overlay (small bottom-right disc, optional)
 *   6. community dashed ring (optional)
 *
 * Selected pins scale 28→40 with a spring; the halo brightens.
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
  withRepeat,
  withSequence,
} from 'react-native-reanimated';
import { Colors, Shadow, SpringConfig } from './tokens';
import { Icon } from './Icon';
import { CairnStoneIcon } from './CairnStoneIcon';
import { MARKER_TYPES, type MarkerType } from '../config/markerTypes';

interface Props {
  type: MarkerType;
  selected?: boolean;
  /** Render a small avatar / initial in the bottom-right — friend marker. */
  friendInitial?: string;
  /** Outer dashed ring — community / shared marker. */
  community?: boolean;
  /** Cluster count — replaces icon with number; gradient bg. */
  clusterCount?: number;
  /** Trigger a one-shot halo pulse — 'first discovery' celebration. */
  firstDiscovery?: boolean;
  /** Tap target — defaults to 56px square so finger-size still works at 28px disc. */
  hitSlop?: number;
}

export function MapMarkerPin({
  type,
  selected = false,
  friendInitial,
  community = false,
  clusterCount,
  firstDiscovery = false,
}: Props) {
  const meta = MARKER_TYPES[type];
  const baseSize = 28;
  const selectedSize = 40;

  // ── Selection animation ────────────────────────────────────────────────
  const scale = useSharedValue(selected ? selectedSize / baseSize : 1);
  React.useEffect(() => {
    scale.value = withSpring(selected ? selectedSize / baseSize : 1, SpringConfig.snappy);
  }, [selected]);

  // ── First-discovery halo pulse (one-shot, 2s) ─────────────────────────
  const firstHalo = useSharedValue(0);
  React.useEffect(() => {
    if (firstDiscovery) {
      firstHalo.value = withSequence(
        withTiming(0.6, { duration: 600 }),
        withTiming(0, { duration: 1400 }),
      );
    }
  }, [firstDiscovery]);

  const containerStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const firstHaloStyle = useAnimatedStyle(() => ({
    opacity: firstHalo.value,
    transform: [{ scale: 1 + firstHalo.value * 0.6 }],
  }));

  const isCluster = typeof clusterCount === 'number' && clusterCount > 1;

  return (
    <Animated.View style={[styles.container, containerStyle]}>
      {/* Layer 1 — soft halo (always-on, type-tinted) */}
      <View
        style={[
          styles.halo,
          { backgroundColor: meta.color, opacity: selected ? 0.30 : 0.18 },
        ]}
      />

      {/* Layer 1b — first-discovery one-shot pulse */}
      <Animated.View
        style={[
          styles.firstHalo,
          { backgroundColor: meta.color },
          firstHaloStyle,
        ]}
      />

      {/* Layer 2 — base disc */}
      <View
        style={[
          styles.disc,
          {
            backgroundColor: isCluster ? Colors.primary : meta.bg,
            borderColor: meta.color,
            borderWidth: isCluster ? 0 : 1.5,
          },
          Shadow.card,
        ]}
      >
        {/* Layer 3 — icon or cluster count */}
        {isCluster ? (
          <Text style={styles.clusterText}>{clusterCount}</Text>
        ) : type === 'cairn' ? (
          <CairnStoneIcon size={18} color={meta.color} />
        ) : (
          <Icon name={meta.icon} size={16} color={meta.color} strokeWidth={2.4} />
        )}
      </View>

      {/* Layer 5 — friend avatar (bottom-right, only if provided) */}
      {friendInitial ? (
        <View style={styles.friendBadge}>
          <Text style={styles.friendInitial}>{friendInitial}</Text>
        </View>
      ) : null}

      {/* Layer 6 — community dashed ring */}
      {community ? <View style={[styles.communityRing, { borderColor: meta.color }]} /> : null}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  halo: {
    position: 'absolute',
    width: 44,
    height: 44,
    borderRadius: 22,
  },
  firstHalo: {
    position: 'absolute',
    width: 44,
    height: 44,
    borderRadius: 22,
  },
  disc: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  clusterText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#fff',
    fontVariant: ['tabular-nums'],
  },
  friendBadge: {
    position: 'absolute',
    right: -3,
    bottom: -3,
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: '#fff',
  },
  friendInitial: {
    fontSize: 8,
    fontWeight: '800',
    color: '#fff',
  },
  communityRing: {
    position: 'absolute',
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1.4,
    borderStyle: 'dashed',
    opacity: 0.6,
  },
});
