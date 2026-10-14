import React, { type ReactNode } from 'react';
import {
  Pressable,
  StyleProp,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  type ViewStyle,
} from 'react-native';
import { useVisualTheme } from '../hooks/useVisualTheme';
import { Icon } from './Icon';
import { FontSize, RadiusRole, Spacing } from './tokens';

export function LibrarySearchField({
  value,
  onChange,
  placeholder,
  label,
  testID,
  style,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  label: string;
  testID: string;
  style?: StyleProp<ViewStyle>;
}) {
  const theme = useVisualTheme();
  return (
    <View style={[styles.search, { backgroundColor: theme.inputSurface, borderColor: theme.borderSubtle }, style]}>
      <Icon name="Search" size={16} color={theme.iconInactive} strokeWidth={2} />
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={theme.textMuted}
        style={[styles.searchInput, { color: theme.textPrimary }]}
        accessibilityLabel={label}
        autoCorrect={false}
        returnKeyType="search"
        clearButtonMode="while-editing"
        testID={testID}
      />
      {value.length > 0 ? (
        <TouchableOpacity
          onPress={() => onChange('')}
          accessibilityRole="button"
          accessibilityLabel={`Clear ${label.toLocaleLowerCase()}`}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Icon name="X" size={15} color={theme.iconInactive} strokeWidth={2} />
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

export function LibraryFilterRow<T extends string>({
  value,
  options,
  onChange,
  testID,
  trailing,
  style,
}: {
  value: T;
  options: readonly { key: T; label: string }[];
  onChange: (value: T) => void;
  testID: string;
  trailing?: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const theme = useVisualTheme();
  return (
    <View style={[styles.filterRow, style]} accessibilityRole="tablist" testID={testID}>
      <View style={styles.filterOptions}>
        {options.map(option => {
          const selected = option.key === value;
          return (
            <TouchableOpacity
              key={option.key}
              style={[
                styles.filterOption,
                { borderColor: selected ? theme.borderStrong : theme.borderSubtle },
                selected && { backgroundColor: theme.controlSelected },
              ]}
              onPress={() => onChange(option.key)}
              accessibilityRole="tab"
              accessibilityState={{ selected }}
              testID={`${testID}-${option.key}`}
            >
              <Text style={[styles.filterText, { color: selected ? theme.tabActive : theme.tabInactive }]} numberOfLines={1}>
                {option.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
      {trailing}
    </View>
  );
}

export function LibraryRecordSurface({
  children,
  onPress,
  testID,
  accessibilityLabel,
}: {
  children: ReactNode;
  onPress?: () => void;
  testID?: string;
  accessibilityLabel?: string;
}) {
  const theme = useVisualTheme();
  const style = [styles.record, { backgroundColor: theme.recordSurface, borderColor: theme.borderSubtle }];
  if (onPress) {
    return (
      <Pressable
        style={({ pressed }) => [style, pressed && { backgroundColor: theme.recordPressed }]}
        onPress={onPress}
        testID={testID}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
      >
        {children}
      </Pressable>
    );
  }
  return <View style={style}>{children}</View>;
}

const styles = StyleSheet.create({
  search: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.md,
    borderWidth: 1,
    borderRadius: RadiusRole.input,
  },
  searchInput: { flex: 1, minHeight: 40, paddingVertical: 0, fontSize: FontSize.body },
  filterRow: { minHeight: 36, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.sm },
  filterOptions: { flexDirection: 'row', alignItems: 'center', gap: 5, flexShrink: 1 },
  filterOption: {
    minHeight: 34,
    paddingHorizontal: 10,
    borderRadius: RadiusRole.button,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterText: { fontSize: FontSize.caption, fontWeight: '700' },
  record: { minHeight: 70, borderBottomWidth: StyleSheet.hairlineWidth },
});
