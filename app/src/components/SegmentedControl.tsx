import React from 'react';
import { Pressable, StyleProp, StyleSheet, Text, View, ViewStyle } from 'react-native';
import { FontSize, RadiusRole, Spacing } from './tokens';
import { useVisualTheme } from '../hooks/useVisualTheme';

export interface Segment<T extends string> { key: T; label: string; }
interface Props<T extends string> {
  value: T;
  segments: readonly Segment<T>[];
  onChange: (value: T) => void;
  containerStyle?: StyleProp<ViewStyle>;
  testID?: string;
}

/**
 * The canonical CairnNZ page-tab grammar: independent floating pills.
 * The row owns spacing only; every segment resolves its own Day / Sunset /
 * Night material from semantic visual tokens.
 */
export function SegmentedControl<T extends string>({ value, segments, onChange, containerStyle, testID }: Props<T>) {
  const theme = useVisualTheme();
  return (
    <View style={[styles.track, containerStyle]} accessibilityRole="tablist" testID={testID}>
      {segments.map(segment => {
        const selected = segment.key === value;
        return (
          <Pressable
            key={segment.key}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            onPress={() => onChange(segment.key)}
            style={[
              styles.segment,
              {
                backgroundColor: selected ? theme.controlSelected : theme.controlInactive,
                borderColor: selected ? theme.controlSelected : theme.borderSubtle,
                shadowColor: theme.shadow,
              },
            ]}
          >
            <Text style={[styles.label, { color: selected ? theme.onPrimary : theme.textPrimary }, selected && styles.selected]}>{segment.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  track: { flexDirection: 'row', gap: Spacing.md },
  segment: {
    flex: 1,
    minHeight: 42,
    borderRadius: RadiusRole.segmentedControl,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.md,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.08,
    shadowRadius: 10,
    elevation: 2,
  },
  label: { fontSize: FontSize.caption, fontWeight: '600' },
  selected: { fontWeight: '700' },
});
