import React, { type ReactNode } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { RadiusRole, Shadow, Spacing } from './tokens';
import { useVisualTheme } from '../hooks/useVisualTheme';

interface Props { visible: boolean; onDismiss?: () => void; children: ReactNode; dismissible?: boolean; testID?: string; }

/** Calm centered-dialog frame. Content owns hierarchy; frame owns material. */
export function ModalCard({ visible, onDismiss, children, dismissible = true, testID }: Props) {
  const theme = useVisualTheme();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={dismissible ? onDismiss : undefined}>
      <View style={[styles.backdrop, { backgroundColor: theme.scrim }]}>
        <Pressable style={StyleSheet.absoluteFillObject} onPress={dismissible ? onDismiss : undefined} accessibilityRole="button" accessibilityLabel={dismissible ? 'Dismiss dialog' : undefined} />
        <View testID={testID} style={[styles.card, { backgroundColor: theme.modalSurface, borderColor: theme.borderSubtle, shadowColor: theme.shadow }]}>{children}</View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.xl },
  card: { width: '100%', maxWidth: 344, borderRadius: RadiusRole.modal, borderWidth: 1, padding: Spacing.xl, ...Shadow.modal },
});
