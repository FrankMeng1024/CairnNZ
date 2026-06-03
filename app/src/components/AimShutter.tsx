/**
 * AimShutter — viewport-overlay lock-on animation that fires when the user
 * taps "Aim & Plant" on the PlantSheet.
 *
 * Sequence (~1.2s, matches PlantSheet's reticle squeeze):
 *   0.0s — collapsing ring: large dashed ring at viewport centre shrinks
 *          from 240px → 8px (locks onto the reticle dot)
 *   0.7s — flash: a bright white disc pops behind the reticle
 *   0.7s — shockwave: a thin ring expands from 8px → 360px
 *
 * Visual language: scan-ring shockwave (option C from the lock-effect demo).
 * No sound, just visual + haptic (haptic is fired by PlantSheet itself).
 *
 * The component renders nothing while idle. Trigger by toggling `firing`
 * to true; it auto-resets after the shockwave completes.
 */
import React, { useEffect, useRef } from 'react';
import { View, StyleSheet, Animated, Easing, Dimensions } from 'react-native';

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');
const CENTRE_X = SCREEN_W / 2;
const CENTRE_Y = SCREEN_H / 2;

interface Props {
  /** Toggle this true to fire the lock-on animation. Auto-resets after ~1.3s. */
  firing: boolean;
  /** Called when the lock-on flash peaks — parent can use this to time the
   *  cairn-rise animation. */
  onLocked?: () => void;
}

export function AimShutter({ firing, onLocked }: Props) {
  // Collapse ring: 240 → 8 over 0.7s
  const collapseSize = useRef(new Animated.Value(240)).current;
  const collapseOpacity = useRef(new Animated.Value(0)).current;
  // Flash disc: 0 → 1 → 0 quickly around the lock moment
  const flashOpacity = useRef(new Animated.Value(0)).current;
  // Shockwave: 8 → 360 over 0.6s, opacity fades 1 → 0
  const shockSize = useRef(new Animated.Value(8)).current;
  const shockOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!firing) return;

    // Reset
    collapseSize.setValue(240);
    collapseOpacity.setValue(0.7);
    flashOpacity.setValue(0);
    shockSize.setValue(8);
    shockOpacity.setValue(0);

    Animated.sequence([
      // Phase 1: collapse ring 240 → 8
      Animated.parallel([
        Animated.timing(collapseSize, {
          toValue: 8,
          duration: 700,
          easing: Easing.bezier(0.5, 0, 0.5, 1),
          useNativeDriver: false,
        }),
        Animated.timing(collapseOpacity, {
          toValue: 1,
          duration: 700,
          easing: Easing.in(Easing.cubic),
          useNativeDriver: false,
        }),
      ]),
      // Phase 2: flash + shockwave (parallel, after collapse hits centre)
      Animated.parallel([
        Animated.sequence([
          Animated.timing(flashOpacity, {
            toValue: 1,
            duration: 80,
            useNativeDriver: false,
          }),
          Animated.timing(flashOpacity, {
            toValue: 0,
            duration: 220,
            useNativeDriver: false,
          }),
        ]),
        Animated.timing(collapseOpacity, {
          toValue: 0,
          duration: 200,
          useNativeDriver: false,
        }),
        Animated.parallel([
          Animated.timing(shockOpacity, {
            toValue: 1,
            duration: 80,
            useNativeDriver: false,
          }),
          Animated.timing(shockSize, {
            toValue: 360,
            duration: 600,
            easing: Easing.bezier(0.2, 0.8, 0.4, 1),
            useNativeDriver: false,
          }),
          Animated.timing(shockOpacity, {
            toValue: 0,
            duration: 600,
            easing: Easing.in(Easing.cubic),
            useNativeDriver: false,
          }),
        ]),
      ]),
    ]).start();

    // Notify parent at the lock moment (700ms in)
    const t = setTimeout(() => onLocked?.(), 700);
    return () => clearTimeout(t);
  }, [firing]);

  if (!firing) return null;

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFillObject}>
      {/* Collapsing ring */}
      <Animated.View
        style={[
          styles.ring,
          {
            width: collapseSize,
            height: collapseSize,
            borderRadius: collapseSize.interpolate({
              inputRange: [0, 500],
              outputRange: [0, 250],
            }),
            opacity: collapseOpacity,
            transform: [
              {
                translateX: collapseSize.interpolate({
                  inputRange: [0, 500],
                  outputRange: [CENTRE_X, CENTRE_X - 250],
                }),
              },
              {
                translateY: collapseSize.interpolate({
                  inputRange: [0, 500],
                  outputRange: [CENTRE_Y, CENTRE_Y - 250],
                }),
              },
            ],
          },
        ]}
      />
      {/* Flash disc */}
      <Animated.View
        style={[
          styles.flash,
          {
            opacity: flashOpacity,
            left: CENTRE_X - 24,
            top: CENTRE_Y - 24,
          },
        ]}
      />
      {/* Shockwave */}
      <Animated.View
        style={[
          styles.shock,
          {
            width: shockSize,
            height: shockSize,
            borderRadius: shockSize.interpolate({
              inputRange: [0, 500],
              outputRange: [0, 250],
            }),
            opacity: shockOpacity,
            transform: [
              {
                translateX: shockSize.interpolate({
                  inputRange: [0, 500],
                  outputRange: [CENTRE_X, CENTRE_X - 250],
                }),
              },
              {
                translateY: shockSize.interpolate({
                  inputRange: [0, 500],
                  outputRange: [CENTRE_Y, CENTRE_Y - 250],
                }),
              },
            ],
          },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  ring: {
    position: 'absolute',
    borderWidth: 2,
    borderColor: 'rgba(180, 220, 255, 0.95)',
    borderStyle: 'solid',
  },
  flash: {
    position: 'absolute',
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#ffffff',
    shadowColor: '#ffffff',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 1.0,
    shadowRadius: 24,
  },
  shock: {
    position: 'absolute',
    borderWidth: 2,
    borderColor: 'rgba(180, 220, 255, 0.95)',
  },
});
