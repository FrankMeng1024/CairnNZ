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
 * The canonical CairnNZ page-tab grammar: one containing track with related
 * active and inactive states. Screens own placement, not material decisions.
 */
export function SegmentedControl<T extends string>({ value, segments, onChange, containerStyle, testID }: Props<T>) {
  const theme = useVisualTheme();
  return (
    <View
      style={[styles.track, { backgroundColor: theme.segmentedTrack, borderColor: theme.borderSubtle }, containerStyle]}
      accessibilityRole="tablist"
      testID={testID}
    >
      {segments.map((segment, index) => {
        const selected = segment.key === value;
        return (
          <Pressable
            key={segment.key}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            onPress={() => onChange(segment.key)}
            style={[
              styles.segment,
              index === 0 && styles.firstSegment,
              index === segments.length - 1 && styles.lastSegment,
              {
                backgroundColor: selected ? theme.controlSelected : theme.controlInactive,
                borderColor: selected ? theme.borderStrong : 'transparent',
              },
            ]}
          >
            <Text
              testID={testID ? `${testID}-${selected ? 'active' : 'inactive'}` : undefined}
              style={[styles.label, { color: selected ? theme.tabActive : theme.tabInactive }, selected && styles.selected]}
            >
              {segment.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    flexDirection: 'row',
    borderRadius: RadiusRole.segmentedControl,
    borderWidth: 1,
    padding: 1,
    overflow: 'hidden',
  },
  segment: {
    flex: 1,
    minHeight: 40,
    borderRadius: 0,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.md,
  },
  firstSegment: {
    borderTopLeftRadius: RadiusRole.segmentedItem,
    borderBottomLeftRadius: RadiusRole.segmentedItem,
  },
  lastSegment: {
    borderTopRightRadius: RadiusRole.segmentedItem,
    borderBottomRightRadius: RadiusRole.segmentedItem,
  },
  label: { fontSize: FontSize.caption, fontWeight: '600' },
  selected: { fontWeight: '700' },
});
