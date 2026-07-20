/**
 * PulseDot — small circle indicator with an optional breathing pulse.
 *
 * Used for GPS live indicators on Hiking / Running screens. When `pulsing`
 * is true, an outer glow ring softly grows + fades at 1.2s intervals to
 * signal "this is alive" without being distracting.
 *
 * Falls back to a plain colored dot when pulsing=false (e.g. GPS offline).
 */
import React, { useEffect, useRef } from 'react';
import { Animated, Easing, View, StyleSheet, ViewStyle } from 'react-native';

interface Props {
  size?: number;              // dot diameter, default 8
  color: string;              // dot fill color
  pulsing?: boolean;          // enable outer breathing ring
  style?: ViewStyle;          // outer wrapper style
}

export function PulseDot({ size = 8, color, pulsing = false, style }: Props) {
  const scale = useRef(new Animated.Value(1)).current;
  const opacity = useRef(new Animated.Value(0.5)).current;

  useEffect(() => {
    if (!pulsing) {
      scale.setValue(1);
      opacity.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.parallel([
        Animated.sequence([
          Animated.timing(scale, {
            toValue: 2.2,
            duration: 1200,
            easing: Easing.out(Easing.quad),
            useNativeDriver: true,
          }),
          Animated.timing(scale, {
            toValue: 1,
            duration: 0,
            useNativeDriver: true,
          }),
        ]),
        Animated.sequence([
          Animated.timing(opacity, {
            toValue: 0,
            duration: 1200,
            easing: Easing.out(Easing.quad),
            useNativeDriver: true,
          }),
          Animated.timing(opacity, {
            toValue: 0.5,
            duration: 0,
            useNativeDriver: true,
          }),
        ]),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [pulsing]);

  const wrapperSize = size * 2.5; // room for the halo to expand
  return (
    <View style={[styles.wrap, { width: wrapperSize, height: wrapperSize }, style]}>
      {pulsing && (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.halo,
            {
              width: size,
              height: size,
              borderRadius: size / 2,
              backgroundColor: color,
              transform: [{ scale }],
              opacity,
            },
          ]}
        />
      )}
      <View
        style={{
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: color,
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  halo: {
    position: 'absolute',
  },
});
