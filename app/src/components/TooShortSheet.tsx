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
  View, Text, StyleSheet, TouchableOpacity, Animated, Easing, Image,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors, Spacing, Radius, FontSize, Shadow } from './tokens';
import { useVisualTheme } from '../hooks/useVisualTheme';

// Concept H3/R3 (sleep-run-2026-08-15): two botanical icons at the top of the
// modal — footprints + fern-leaf — replace the previous MapPin circle. Same
// PNGs are shipped under both assets/hiking and assets/running; we always
// pull from the hiking set so Hike + Run render identically (concept-lock:
// same green, same botanical vocabulary, no per-mode divergence).
const FOOTPRINTS_ICON = require('../../assets/hiking/footprints.png');
const FERN_ICON = require('../../assets/hiking/fern-leaf.png');

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
  // R21 (2026-08-18 user "hike complete和confirm page也要follow 白天夜间"):
  // dark tokens for the too-short sheet so it stays coherent with the
  // rest of the Hike/Run night surfaces.
  const theme = useVisualTheme();
  const sheetBg = theme.surfaceElevated;
  const titleColor = theme.foreground;
  const bodyColor = theme.foregroundSecondary;
  const handleColor = theme.border;

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
  // 2026-08-17 concept H3/R3: body copy matches the concept sheet word
  // for word. The verb ("Walk"/"Run") swaps with the activity so the
  // sentence still reads naturally, and the trailing clause drops the
  // previous "when you stop" hedge to match the concept exactly.
  const verb = activityMode === 'running' ? 'Run' : 'Walk';
  const bodyCopy = `We haven't captured enough GPS points to draw your path yet. ${verb} a few more seconds and your ${label.toLowerCase()} will save automatically.`;

  return (
    <Animated.View style={[styles.scrim, { opacity }]} pointerEvents="auto">
      {/* Tapping the scrim acts like "Got it" — preserves session. */}
      <TouchableOpacity style={StyleSheet.absoluteFillObject} activeOpacity={1} onPress={() => dismiss(onContinue)} />
      <Animated.View style={[styles.sheet, { backgroundColor: sheetBg, transform: [{ translateY: slideY }], paddingBottom: Math.max(insets.bottom, Spacing.xl) }]}>
        <View style={[styles.handle, { backgroundColor: handleColor }]} />
        <View style={styles.botanicalRow}>
          <Image source={FOOTPRINTS_ICON} style={styles.botanicalFootprints} resizeMode="contain" />
          <Image source={FERN_ICON} style={styles.botanicalFern} resizeMode="contain" />
        </View>
        <Text style={[styles.title, { color: titleColor }]}>Keep going{'\n'}a little longer</Text>
        <Text style={[styles.body, { color: bodyColor }]}>{bodyCopy}</Text>
        <TouchableOpacity
          style={[styles.btnPrimary, { backgroundColor: theme.primary }]}
          activeOpacity={0.85}
          onPress={() => dismiss(onContinue)}
        >
          <Text style={[styles.btnPrimaryText, { color: theme.onPrimary }]}>Got it — keep going</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.btnSecondary}
          activeOpacity={0.7}
          onPress={() => dismiss(onDiscard)}
        >
          <Text style={[styles.btnSecondaryText, { color: theme.foregroundSecondary }]}>End {label.toLowerCase()} anyway</Text>
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
  // Concept H3/R3: two small botanical images centered, side-by-side with a
  // gentle overlap that echoes the frame illustration. Footprints leads
  // (activity metaphor), fern-leaf trails (rest / nature). Sized ~44px so
  // the pair reads as a single motif rather than two competing icons.
  botanicalRow: {
    flexDirection: 'row',
    alignSelf: 'center',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.xs,
    height: 56,
  },
  botanicalFootprints: {
    width: 44,
    height: 44,
    marginRight: -6,
  },
  botanicalFern: {
    width: 48,
    height: 48,
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
    // 2026-08-17 R21 concept H3/R3: primary CTA uses the same dark forest
    // green (#455D3C) as the HikingScreen "Start Hiking" button so all
    // Hike-flow primary CTAs read as one family. Colors.primary (#5d7c46)
    // is a lighter sage used elsewhere (chips, links) but reads too light
    // on this sheet where the fern illustration already carries green.
    // Concept uses pill radius to match the H0 "Start Hiking" button.
    backgroundColor: '#455D3C',
    height: 52,
    borderRadius: 26,
    alignItems: 'center', justifyContent: 'center',
  },
  btnPrimaryText: {
    color: '#FFFFFF',
    fontSize: 16, fontWeight: '700', letterSpacing: 0.2,
  },
  btnSecondary: {
    paddingVertical: 12, alignItems: 'center', justifyContent: 'center',
  },
  btnSecondaryText: {
    // 2026-08-17 R21 concept H3/R3: "End hike anyway" is rendered in the
    // same dark forest green as the primary CTA (concept color #455D3C),
    // not muted gray. This gives the link visual weight while its
    // hierarchy stays secondary via lack of button background.
    color: '#455D3C',
    fontSize: FontSize.body, fontWeight: '600',
  },
});
