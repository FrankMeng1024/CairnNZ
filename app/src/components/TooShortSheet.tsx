/**
 * TooShortSheet — v118 friendly modal that appears when the user tries
 * to stop a Hike or Run that has fewer than 2 GPS points (no drawable
 * path). System Alert.alert was abrupt and dismissing it lost the
 * session entirely.
 *
 * Behaviour:
 *   - Slide-in bottom sheet with scrim, matches StopSummarySheet's visual
 *     vocabulary (Colors.surface card, pounamu-green primary CTA).
 *   - "Got it" (primary): dismisses the sheet. The session was preserved
 *     by stopTracking's pre-check, so tracking continues seamlessly —
 *     no duration reset, no GPS gap, no UI re-mount.
 *   - "End anyway" (secondary): calls onDiscard (which fires
 *     useTrackingStore.discardCurrentSession) — full teardown.
 *
 * The sheet renders only while the parent passes `visible=true`; the
 * parent typically derives this from `lastStopReason === 'too-short'`.
 */
import React, { useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Animated, Easing,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from './Icon';
import { Colors, Spacing, Radius, FontSize, Shadow } from './tokens';

interface Props {
  visible: boolean;
  activityMode?: 'hiking' | 'running';
  onContinue: () => void;   // "Got it" — dismiss, keep tracking
  onDiscard: () => void;    // "End anyway" — full session teardown
}

export function TooShortSheet({ visible, activityMode = 'hiking', onContinue, onDiscard }: Props) {
  const insets = useSafeAreaInsets();
  const slideY = useRef(new Animated.Value(500)).current;
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      Animated.parallel([
        Animated.timing(slideY, { toValue: 0, duration: 280, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 1, duration: 220, easing: Easing.out(Easing.ease), useNativeDriver: true }),
      ]).start();
    } else {
      slideY.setValue(500);
      opacity.setValue(0);
    }
  }, [visible]);

  if (!visible) return null;

  const dismiss = (then?: () => void) => {
    Animated.parallel([
      Animated.timing(slideY, { toValue: 500, duration: 220, easing: Easing.in(Easing.quad), useNativeDriver: true }),
      Animated.timing(opacity, { toValue: 0, duration: 200, easing: Easing.in(Easing.ease), useNativeDriver: true }),
    ]).start(() => then?.());
  };

  const label = activityMode === 'running' ? 'Run' : 'Hike';

  return (
    <Animated.View style={[styles.scrim, { opacity }]} pointerEvents="auto">
      {/* Tapping the scrim acts like "Got it" — preserves session. */}
      <TouchableOpacity style={StyleSheet.absoluteFillObject} activeOpacity={1} onPress={() => dismiss(onContinue)} />
      <Animated.View style={[styles.sheet, { transform: [{ translateY: slideY }], paddingBottom: Math.max(insets.bottom, Spacing.xl) }]}>
        <View style={styles.handle} />
        <View style={styles.iconWrap}>
          <Icon name="MapPin" size={28} color={Colors.primary} strokeWidth={2} />
        </View>
        <Text style={styles.title}>Keep going a little longer</Text>
        <Text style={styles.body}>
          We haven't captured enough GPS points to draw your path yet.
          Walk a few more seconds and your {label.toLowerCase()} will save automatically when you stop.
        </Text>
        <TouchableOpacity
          style={styles.btnPrimary}
          activeOpacity={0.85}
          onPress={() => dismiss(onContinue)}
        >
          <Text style={styles.btnPrimaryText}>Got it — keep going</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.btnSecondary}
          activeOpacity={0.7}
          onPress={() => dismiss(onDiscard)}
        >
          <Text style={styles.btnSecondaryText}>End {label.toLowerCase()} anyway</Text>
        </TouchableOpacity>
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  scrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'flex-end',
    zIndex: 250,
  },
  sheet: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: Radius.sheet,
    borderTopRightRadius: Radius.sheet,
    padding: Spacing.xl,
    gap: Spacing.md,
    ...Shadow.overlay,
  },
  handle: {
    width: 40, height: 4, borderRadius: 2,
    backgroundColor: Colors.border, alignSelf: 'center',
    marginBottom: Spacing.xs,
  },
  iconWrap: {
    alignSelf: 'center',
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: Colors.primaryBg,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: Spacing.xs,
  },
  title: {
    fontSize: FontSize.h2, fontWeight: '800',
    color: Colors.textPrimary, textAlign: 'center',
  },
  body: {
    fontSize: FontSize.body, lineHeight: 22,
    color: Colors.textSecondary, textAlign: 'center',
    paddingHorizontal: Spacing.sm,
  },
  btnPrimary: {
    marginTop: Spacing.md,
    backgroundColor: Colors.primary,
    paddingVertical: 14, borderRadius: Radius.button,
    alignItems: 'center', justifyContent: 'center',
  },
  btnPrimaryText: {
    color: '#FFFFFF',
    fontSize: FontSize.body, fontWeight: '700',
  },
  btnSecondary: {
    paddingVertical: 12, alignItems: 'center', justifyContent: 'center',
  },
  btnSecondaryText: {
    color: Colors.textSecondary,
    fontSize: FontSize.body, fontWeight: '500',
  },
});
