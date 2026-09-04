import React, { useState } from 'react';
import {
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { FontSize, RadiusRole, Spacing } from './tokens';
import { useVisualTheme } from '../hooks/useVisualTheme';

export interface TextFieldProps extends Omit<TextInputProps, 'style'> {
  label?: string;
  error?: string;
  disabled?: boolean;
  containerStyle?: StyleProp<ViewStyle>;
  inputStyle?: StyleProp<TextStyle>;
}

/** Small semantic field foundation for later form migrations. */
export function TextField({
  label,
  error,
  disabled = false,
  editable = true,
  containerStyle,
  inputStyle,
  onFocus,
  onBlur,
  placeholderTextColor,
  ...inputProps
}: TextFieldProps) {
  const theme = useVisualTheme();
  const [focused, setFocused] = useState(false);
  const inactive = disabled || editable === false;
  const borderColor = error
    ? theme.destructive
    : inactive
      ? theme.disabledBorder
      : focused
        ? theme.inputFocusBorder
        : theme.borderSubtle;

  return (
    <View style={containerStyle}>
      {label ? (
        <Text style={[styles.label, { color: inactive ? theme.disabledText : theme.textSecondary }]}>
          {label}
        </Text>
      ) : null}
      <View
        style={[
          styles.field,
          {
            backgroundColor: inactive ? theme.disabledSurface : theme.inputSurface,
            borderColor,
          },
        ]}
      >
        <TextInput
          {...inputProps}
          editable={!inactive}
          accessibilityState={{ disabled: inactive }}
          placeholderTextColor={placeholderTextColor ?? (inactive ? theme.disabledText : theme.textMuted)}
          onFocus={(event) => {
            setFocused(true);
            onFocus?.(event);
          }}
          onBlur={(event) => {
            setFocused(false);
            onBlur?.(event);
          }}
          style={[styles.input, { color: inactive ? theme.disabledText : theme.textPrimary }, inputStyle]}
        />
      </View>
      {error ? (
        <Text accessibilityLiveRegion="polite" style={[styles.error, { color: theme.destructive }]}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  label: {
    fontSize: FontSize.caption,
    fontWeight: '600',
    marginBottom: Spacing.xs,
  },
  field: {
    minHeight: 48,
    borderRadius: RadiusRole.input,
    borderWidth: 1,
    justifyContent: 'center',
  },
  input: {
    minHeight: 48,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.md,
    fontSize: FontSize.body,
    backgroundColor: 'transparent',
  },
  error: {
    marginTop: Spacing.xs,
    marginLeft: 2,
    fontSize: FontSize.small,
    fontWeight: '600',
  },
});
