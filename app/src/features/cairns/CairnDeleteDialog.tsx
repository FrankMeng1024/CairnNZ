import React from 'react';
import { StyleSheet, View } from 'react-native';
import { ModalCard, ModalCardHeader } from '../../components/ModalCard';
import { PrimaryButton } from '../../components/PrimaryButton';
import { Spacing } from '../../components/tokens';

export function CairnDeleteDialog({
  visible,
  semantic = 'own',
  busy = false,
  onDismiss,
  onConfirm,
}: {
  visible: boolean;
  semantic?: 'own' | 'hide';
  busy?: boolean;
  onDismiss: () => void;
  onConfirm: () => void;
}) {
  const hiding = semantic === 'hide';
  return (
    <ModalCard
      visible={visible}
      onDismiss={busy ? undefined : onDismiss}
      dismissible={!busy}
      testID="cairn-delete-confirmation"
    >
      <ModalCardHeader
        title={hiding ? 'Hide this Cairn?' : 'Delete this Cairn?'}
        body={hiding
          ? 'It will leave your Memory map. This does not remove the creator’s Cairn or your Friend Content access.'
          : 'This removes the Cairn. Its source Activity, independent Routes, and ordinary personal Memory remain.'}
      />
      <View style={styles.actions}>
        <PrimaryButton
          label={hiding ? 'Keep visible' : 'Keep Cairn'}
          variant="secondary"
          onPress={onDismiss}
          disabled={busy}
          style={styles.action}
        />
        <PrimaryButton
          label={hiding ? 'Hide Cairn' : 'Delete Cairn'}
          variant="destructive"
          onPress={onConfirm}
          loading={busy}
          style={styles.action}
          testID="cairn-delete-confirm"
        />
      </View>
    </ModalCard>
  );
}

const styles = StyleSheet.create({
  actions: { flexDirection: 'row', gap: Spacing.md },
  action: { flex: 1 },
});
