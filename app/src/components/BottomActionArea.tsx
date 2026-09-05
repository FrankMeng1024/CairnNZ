import React, { Children, type ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Spacing } from './tokens';
import { useVisualTheme } from '../hooks/useVisualTheme';

type Material = 'page' | 'sheet' | 'modal';

interface Props {
  children: ReactNode;
  layout?: 'stacked' | 'row';
  material?: Material;
  separated?: boolean;
  safeArea?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/** Shared footer frame; action components own their semantic button role. */
export function BottomActionArea({
  children,
  layout = 'stacked',
  material = 'page',
  separated = true,
  safeArea = true,
  style,
  testID,
}: Props) {
  const theme = useVisualTheme();
  const insets = useSafeAreaInsets();
  const backgroundColor = material === 'sheet'
    ? theme.sheetSurface
    : material === 'modal'
      ? theme.modalSurface
      : theme.backgroundElevated;
  const content = layout === 'row'
    ? Children.toArray(children).map((child, index) => <View key={index} style={styles.rowSlot}>{child}</View>)
    : children;

  return (
    <View
      testID={testID}
      style={[
        styles.base,
        layout === 'row' ? styles.row : styles.stacked,
        {
          backgroundColor,
          borderTopColor: separated ? theme.borderSubtle : 'transparent',
          paddingBottom: safeArea ? Math.max(insets.bottom, Spacing.lg) : Spacing.lg,
        },
        style,
      ]}
    >
      {content}
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    borderTopWidth: 1,
    paddingTop: Spacing.md,
    paddingHorizontal: Spacing.xl,
    gap: Spacing.sm,
  },
  stacked: { flexDirection: 'column' },
  row: { flexDirection: 'row', alignItems: 'stretch' },
  rowSlot: { flex: 1 },
});
