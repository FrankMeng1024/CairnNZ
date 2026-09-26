import React, { useRef, useState } from 'react';
import {
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  type NativeSyntheticEvent,
  type TextInputProps,
  type TextInputSelectionChangeEventData,
} from 'react-native';
import { useVisualTheme } from '../hooks/useVisualTheme';
import { Icon } from './Icon';
import { Colors, FontSize, IconSize, RadiusRole, Spacing } from './tokens';

export interface PasswordFieldProps extends Omit<TextInputProps, 'secureTextEntry' | 'style'> {
  value: string;
  onChangeText: (value: string) => void;
  label?: string;
  error?: string;
  disabled?: boolean;
  /** Auth keeps its paper treatment; Settings uses the app form surface. */
  variant?: 'auth' | 'default';
  isNew?: boolean;
}

/**
 * The single password-entry implementation used by Auth and Settings.
 * Visibility changes preserve both the controlled value and the active
 * selection; the eye action therefore cannot replace a partially selected
 * password or dismiss the keyboard on iOS.
 */
export function PasswordField({
  value,
  onChangeText,
  label,
  error,
  variant = 'default',
  editable = true,
  disabled,
  onFocus,
  onBlur,
  onSelectionChange,
  placeholderTextColor,
  testID,
  isNew: _isNew,
  ...inputProps
}: PasswordFieldProps) {
  const theme = useVisualTheme();
  const inputRef = useRef<TextInput>(null);
  const selectionRef = useRef({ start: value.length, end: value.length });
  const [visible, setVisible] = useState(false);
  const [focused, setFocused] = useState(false);
  const inactive = disabled || editable === false;
  const auth = variant === 'auth';

  const restoreSelectionAfterVisibilityChange = () => {
    const selection = { ...selectionRef.current };
    const wasFocused = focused;
    setVisible(current => !current);
    if (!wasFocused) return;
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.setNativeProps({ selection });
    });
  };

  const handleSelectionChange = (event: NativeSyntheticEvent<TextInputSelectionChangeEventData>) => {
    selectionRef.current = event.nativeEvent.selection;
    onSelectionChange?.(event);
  };

  const borderColor = error
    ? (auth ? Colors.danger : theme.destructive)
    : inactive
      ? theme.disabledBorder
      : focused
        ? (auth ? Colors.primary : theme.inputFocusBorder)
        : (auth ? '#EAE3D5' : theme.borderSubtle);

  return (
    <View>
      {label ? (
        <Text style={[styles.label, { color: inactive ? theme.disabledText : theme.textSecondary }]}>
          {label}
        </Text>
      ) : null}
      <View
        testID={testID ? `${testID}-shell` : undefined}
        style={[
          styles.shell,
          auth ? styles.authShell : styles.defaultShell,
          {
            backgroundColor: inactive
              ? theme.disabledSurface
              : auth && focused
                ? Colors.primaryBg
                : auth
                  ? '#FDFAF3'
                  : theme.inputSurface,
            borderColor,
            borderWidth: focused || Boolean(error) ? 1.5 : 1,
          },
        ]}
      >
        {auth ? (
          <View style={styles.authLeading} pointerEvents="none">
            <Icon name="KeyRound" size={IconSize.sm} color={focused ? Colors.primary : Colors.textMuted} strokeWidth={1.8} />
          </View>
        ) : null}
        <TextInput
          {...inputProps}
          ref={inputRef}
          testID={testID}
          value={value}
          onChangeText={onChangeText}
          editable={!inactive}
          accessibilityState={{ disabled: inactive }}
          secureTextEntry={!visible}
          textContentType="none"
          autoComplete="off"
          autoCorrect={false}
          autoCapitalize="none"
          spellCheck={false}
          clearTextOnFocus={false}
          selectTextOnFocus={false}
          placeholderTextColor={placeholderTextColor ?? (auth ? Colors.textMuted : theme.textMuted)}
          onSelectionChange={handleSelectionChange}
          onFocus={(event) => {
            setFocused(true);
            onFocus?.(event);
          }}
          onBlur={(event) => {
            setFocused(false);
            onBlur?.(event);
          }}
          style={[
            styles.input,
            auth ? styles.authInput : styles.defaultInput,
            { color: inactive ? theme.disabledText : auth ? Colors.textPrimary : theme.textPrimary },
          ]}
        />
        {auth && value.length > 0 && !focused ? (
          <TouchableOpacity
            testID={testID ? `${testID}-clear` : 'btn-password-clear'}
            style={styles.iconButton}
            onPress={() => {
              selectionRef.current = { start: 0, end: 0 };
              onChangeText('');
              inputRef.current?.focus();
            }}
            accessibilityRole="button"
            accessibilityLabel="Clear password"
            hitSlop={{ top: 8, bottom: 8, left: 0, right: 4 }}
          >
            <Icon name="X" size={IconSize.sm} color={Colors.textMuted} strokeWidth={2} />
          </TouchableOpacity>
        ) : null}
        <TouchableOpacity
          testID={testID ? `${testID}-visibility` : undefined}
          style={styles.iconButton}
          onPress={restoreSelectionAfterVisibilityChange}
          accessibilityRole="button"
          accessibilityLabel={visible ? 'Hide password' : 'Show password'}
          accessibilityState={{ disabled: inactive }}
          disabled={inactive}
          hitSlop={{ top: 8, bottom: 8, left: 4, right: 8 }}
        >
          <Icon
            name={visible ? 'EyeOff' : 'Eye'}
            size={IconSize.sm}
            color={inactive ? theme.disabledText : auth ? Colors.textMuted : theme.icon}
            strokeWidth={1.8}
          />
        </TouchableOpacity>
      </View>
      {error ? (
        <Text accessibilityLiveRegion="polite" style={[styles.error, { color: auth ? Colors.danger : theme.destructive }]}>
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
  shell: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  authShell: {
    borderRadius: 14,
    paddingHorizontal: Spacing.md,
  },
  defaultShell: {
    minHeight: 48,
    borderRadius: RadiusRole.input,
    paddingLeft: Spacing.md,
    paddingRight: Spacing.sm,
  },
  authLeading: { marginRight: Spacing.xs },
  input: { flex: 1, backgroundColor: 'transparent' },
  authInput: {
    paddingVertical: Spacing.md,
    paddingLeft: Spacing.xs,
    fontSize: FontSize.body,
  },
  defaultInput: {
    minHeight: 48,
    paddingVertical: Spacing.md,
    fontSize: FontSize.body,
  },
  iconButton: { padding: Spacing.xs },
  error: {
    marginTop: 3,
    marginLeft: 2,
    fontSize: FontSize.small,
    fontWeight: '600',
  },
});
