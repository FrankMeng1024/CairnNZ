import React, { type ReactNode } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FontSize, RadiusRole, Shadow, Spacing } from './tokens';
import { DismissButton } from './DismissButton';
import { useVisualTheme } from '../hooks/useVisualTheme';

interface Props {
  visible: boolean;
  onDismiss?: () => void;
  children: ReactNode;
  dismissible?: boolean;
  keyboardVerticalOffset?: number;
  testID?: string;
}

/** Calm centered-dialog frame. Content owns hierarchy; frame owns material. */
export function ModalCard({ visible, onDismiss, children, dismissible = true, keyboardVerticalOffset = 0, testID }: Props) {
  const theme = useVisualTheme();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent onRequestClose={dismissible ? onDismiss : undefined}>
      <KeyboardAvoidingView
        style={[
          styles.backdrop,
          {
            backgroundColor: theme.scrim,
            paddingTop: Math.max(insets.top, Spacing.xl),
            paddingBottom: Math.max(insets.bottom, Spacing.xl),
          },
        ]}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={keyboardVerticalOffset}
      >
        <Pressable
          style={StyleSheet.absoluteFillObject}
          onPress={dismissible ? onDismiss : undefined}
          accessible={dismissible}
          accessibilityRole={dismissible ? 'button' : undefined}
          accessibilityLabel={dismissible ? 'Dismiss dialog' : undefined}
        />
        <View
          testID={testID}
          accessibilityViewIsModal
          style={[styles.card, { backgroundColor: theme.modalSurface, borderColor: theme.borderSubtle, shadowColor: theme.shadow }]}
        >
          {children}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

interface ModalCardHeaderProps {
  title: string;
  body?: string;
  onClose?: () => void;
  testID?: string;
}

/** Optional compact dialog heading with a standard dismiss affordance. */
export function ModalCardHeader({ title, body, onClose, testID }: ModalCardHeaderProps) {
  const theme = useVisualTheme();
  return (
    <View style={styles.header} testID={testID}>
      <View style={styles.headerCopy}>
        <Text style={[styles.title, { color: theme.textPrimary }]}>{title}</Text>
        {body ? <Text style={[styles.body, { color: theme.textSecondary }]}>{body}</Text> : null}
      </View>
      {onClose ? (
        <DismissButton onPress={onClose} label="Close dialog" style={styles.close} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: Spacing.xl },
  card: { width: '100%', maxWidth: 344, borderRadius: RadiusRole.modal, borderWidth: 1, padding: Spacing.xl, ...Shadow.modal },
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.md, marginBottom: Spacing.lg },
  headerCopy: { flex: 1 },
  title: { fontSize: FontSize.h3, fontWeight: '700', lineHeight: 23 },
  body: { fontSize: FontSize.body, lineHeight: 22, marginTop: Spacing.xs },
  close: { marginTop: -Spacing.sm, marginRight: -Spacing.sm },
});
