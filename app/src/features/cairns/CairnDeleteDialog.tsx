import React from 'react';
import { StyleSheet, View } from 'react-native';
import { ModalCard, ModalCardHeader } from '../../components/ModalCard';
import { PrimaryButton } from '../../components/PrimaryButton';
import { Spacing } from '../../components/tokens';
import { cairnText } from '../../i18n/runtime';

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
        title={hiding ? cairnText('cairns.cairn-delete-dialog.hide-this-cairn') : cairnText('cairns.cairn-delete-dialog.withdraw-and-delete-this-cairn')}
        body={hiding
          ? cairnText('cairns.cairn-delete-dialog.it-will-leave-your-memory-map-this')
          : cairnText('cairns.cairn-delete-dialog.it-disappears-from-your-collection-and-cannot')}
      />
      <View style={styles.actions}>
        <PrimaryButton
          label={hiding ? cairnText('cairns.cairn-delete-dialog.keep-visible') : cairnText('cairns.cairn-delete-dialog.keep-cairn')}
          variant="secondary"
          onPress={onDismiss}
          disabled={busy}
          style={styles.action}
        />
        <PrimaryButton
          label={hiding ? cairnText('cairns.cairn-delete-dialog.hide-cairn') : cairnText('cairns.cairn-delete-dialog.withdraw-delete')}
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
  actions: { gap: Spacing.md },
  action: { alignSelf: 'stretch', minHeight: 50 },
});
