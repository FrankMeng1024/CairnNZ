/**
 * FlagSavedToast — brief success toast shown after planting a flag.
 *
 * Extracted from HikingScreen.tsx (O1 batch 26 refactor).
 * Self-dismisses after ~1.2s via onHide callback.
 */
import React, { useRef, useEffect } from 'react';
import { Animated, Text } from 'react-native';
import { Colors, Spacing, Radius, FontSize, Shadow } from '../components/tokens';
import { Icon } from '../components/Icon';
import { StyleSheet } from 'react-native';

type Props = {
  onHide: () => void;
};

export function FlagSavedToast({ onHide }: Props) {
  const opacity = useRef(new Animated.Value(0)).current;
  const slideY = useRef(new Animated.Value(20)).current;
  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: 250, useNativeDriver: true }),
      Animated.spring(slideY, { toValue: 0, useNativeDriver: true, tension: 200, friction: 14 }),
    ]).start(() => {
      setTimeout(() => {
        Animated.timing(opacity, { toValue: 0, duration: 300, useNativeDriver: true }).start(onHide);
      }, 1200);
    });
  }, []);
  return (
    <Animated.View style={[toastStyles.toast, { opacity, transform: [{ translateY: slideY }] }]}>
      <Icon name="CircleCheck" size={16} color={Colors.success} strokeWidth={2} />
      <Text style={toastStyles.text}>Flag saved</Text>
    </Animated.View>
  );
}

const toastStyles = StyleSheet.create({
  toast: {
    position: 'absolute', bottom: 140, alignSelf: 'center',
    flexDirection: 'row', alignItems: 'center', gap: Spacing.xs,
    backgroundColor: Colors.surface, borderRadius: Radius.pill,
    paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm,
    ...Shadow.elevated,
  },
  text: { fontSize: FontSize.caption, fontWeight: '700', color: Colors.textPrimary },
});
