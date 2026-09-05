import React from 'react';
import { StyleSheet, TouchableOpacity, type StyleProp, type ViewStyle } from 'react-native';
import { Icon } from './Icon';
import { IconSize, Radius, Spacing } from './tokens';
import { useVisualTheme } from '../hooks/useVisualTheme';

interface Props {
  onPress: () => void;
  label?: string;
  contained?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/** Shared top-right modal/sheet dismiss affordance. Position remains caller-owned. */
export function DismissButton({ onPress, label = 'Close', contained = false, style, testID }: Props) {
  const theme = useVisualTheme();
  return (
    <TouchableOpacity
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      activeOpacity={0.72}
      hitSlop={{ top: Spacing.xs, bottom: Spacing.xs, left: Spacing.xs, right: Spacing.xs }}
      style={[
        styles.control,
        contained && { backgroundColor: theme.surfaceTranslucent, borderColor: theme.borderSubtle, borderWidth: 1 },
        style,
      ]}
    >
      <Icon name="X" size={IconSize.sm} color={theme.icon} strokeWidth={2.2} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  control: { width: 40, height: 40, borderRadius: Radius.circle, alignItems: 'center', justifyContent: 'center' },
});
