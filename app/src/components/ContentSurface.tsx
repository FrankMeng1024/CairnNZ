import React, { type ReactNode } from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { RadiusRole, Spacing } from './tokens';
import { useVisualTheme } from '../hooks/useVisualTheme';

interface Props {
  children: ReactNode;
  level?: 'record' | 'elevated';
  selected?: boolean;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/** Material-only content frame. Domain rows keep ownership of content and actions. */
export function ContentSurface({ children, level = 'record', selected = false, onPress, style, testID }: Props) {
  const theme = useVisualTheme();
  const base = {
    backgroundColor: level === 'elevated' ? theme.elevatedCardSurface : selected ? theme.recordSelected : theme.recordSurface,
    borderColor: selected ? theme.borderStrong : theme.borderSubtle,
  };

  if (onPress) {
    return (
      <Pressable
        testID={testID}
        onPress={onPress}
        style={({ pressed }) => [styles.base, level === 'elevated' ? styles.elevated : styles.record, base, pressed && { backgroundColor: theme.recordPressed }, style]}
      >
        {children}
      </Pressable>
    );
  }

  return <View testID={testID} style={[styles.base, level === 'elevated' ? styles.elevated : styles.record, base, style]}>{children}</View>;
}

const styles = StyleSheet.create({
  base: { borderWidth: 1, borderRadius: RadiusRole.card },
  record: { paddingHorizontal: Spacing.base, paddingVertical: Spacing.md },
  elevated: { padding: Spacing.lg },
});
