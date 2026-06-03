/**
 * PressBtn — universal pressable wrapper with consistent scale-spring feedback.
 *
 * Use everywhere a TouchableOpacity is currently bare (no scale animation).
 * This is the single source of truth for press feedback in the app.
 *
 * Spring config matches BackButton, ActivityCard, ToolBtn — tension 300, friction 10/8.
 *
 * Usage:
 *   <PressBtn style={styles.cta} onPress={...}>...</PressBtn>      // default scale 0.97
 *   <PressBtn style={...} onPress={...} scaleTo={0.93}>...</PressBtn>  // smaller buttons
 *   <PressBtn style={...} onPress={...} scaleTo={0.88}>...</PressBtn>  // markers / icon buttons
 *
 * Recommended scaleTo values:
 *   - Cards / large CTA           → 0.97
 *   - Small CTA / pill buttons    → 0.95
 *   - Icon buttons / chips        → 0.92
 *   - Map markers / tight icons   → 0.88
 */
import React, { useRef } from 'react';
import { Animated, TouchableOpacity, StyleProp, ViewStyle, GestureResponderEvent } from 'react-native';

// One animated Touchable — style + transform live on the SAME node so:
//   • flex / width / margin / padding / border propagate to the parent
//     correctly (a parent <View flexDirection:'row' gap:8> with two
//     Touchables that have flex:1 each will split the row width).
//   • The entire visual area (including padding) is a press target.
//   • The scale animation transforms the styled box, so border/shadow/bg
//     all scale together — feels like one unit being pressed.
//
// Earlier we wrapped TouchableOpacity in a separate Animated.View that only
// carried `transform`. That broke flex layout (the outer wrapper had no
// flex, so the inner Touchable's flex:1 was ignored by row parents and
// buttons collapsed to content width). This single-node design avoids it.
const AnimatedTouchableOpacity = Animated.createAnimatedComponent(TouchableOpacity);

interface PressBtnProps {
  onPress?: (event: GestureResponderEvent) => void;
  onLongPress?: (event: GestureResponderEvent) => void;
  style?: StyleProp<ViewStyle>;
  children?: React.ReactNode;
  scaleTo?: number;
  disabled?: boolean;
  hitSlop?: { top?: number; bottom?: number; left?: number; right?: number };
}

export function PressBtn({
  onPress, onLongPress, style, children, scaleTo = 0.97, disabled, hitSlop,
}: PressBtnProps) {
  const scale = useRef(new Animated.Value(1)).current;
  const handlePressIn = () => {
    if (disabled) return;
    Animated.spring(scale, { toValue: scaleTo, useNativeDriver: true, tension: 300, friction: 10 }).start();
  };
  const handlePressOut = () => {
    if (disabled) return;
    Animated.spring(scale, { toValue: 1, useNativeDriver: true, tension: 300, friction: 8 }).start();
  };

  return (
    <AnimatedTouchableOpacity
      activeOpacity={1}
      onPress={onPress}
      onLongPress={onLongPress}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      disabled={disabled}
      hitSlop={hitSlop}
      style={[style, { transform: [{ scale }] }]}
    >
      {children}
    </AnimatedTouchableOpacity>
  );
}
