import React, { type ReactNode } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Radius, Shadow, Spacing } from './tokens';
import { useVisualTheme } from '../hooks/useVisualTheme';

interface Props { visible: boolean; onDismiss?: () => void; children: ReactNode; dismissible?: boolean; maxHeight?: `${number}%` | number; testID?: string; }

/** Shared bottom-sheet material, safe-area, keyboard and dismissal contract. */
export function BottomSheetFrame({ visible, onDismiss, children, dismissible = true, maxHeight = '88%', testID }: Props) {
  const theme = useVisualTheme();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={dismissible ? onDismiss : undefined}>
      <KeyboardAvoidingView style={[styles.backdrop, { backgroundColor: theme.readabilityScrim }]} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Pressable style={StyleSheet.absoluteFillObject} onPress={dismissible ? onDismiss : undefined} accessibilityRole="button" accessibilityLabel={dismissible ? 'Dismiss sheet' : undefined} />
        <View testID={testID} style={[styles.sheet, { maxHeight, paddingBottom: Math.max(insets.bottom, Spacing.lg), backgroundColor: theme.surfaceElevated, borderColor: theme.border, shadowColor: theme.shadow }]}>
          <View style={[styles.handle, { backgroundColor: theme.border }]} />
          {children}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end' },
  sheet: { width: '100%', borderTopLeftRadius: Radius.sheet, borderTopRightRadius: Radius.sheet, borderWidth: 1, paddingHorizontal: Spacing.xl, paddingTop: Spacing.md, ...Shadow.sheet },
  handle: { width: 40, height: 4, borderRadius: 2, alignSelf: 'center', marginBottom: Spacing.lg },
});
