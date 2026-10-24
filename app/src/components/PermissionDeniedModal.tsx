/**
 * PermissionDeniedModal — shared modal shown when a GPS-gated feature is
 * accessed without location permission.
 *
 * Batch 6.0 (ONB-04): the pre-existing code paths in Hiking / Running /
 * Home silently `return` when `requestForegroundPermissionsAsync` came
 * back denied. Users tapped Start Hiking and nothing visible happened.
 *
 * This modal replaces the silent return: whenever a feature entry point
 * checks permission and finds it denied, it renders this modal with:
 *   - Feature-specific title (e.g. "Hiking needs your location")
 *   - Plain-language body explaining why
 *   - Primary CTA: Open Settings (uses Linking.openSettings)
 *   - Secondary CTA: Not now (dismisses modal, user stays on the screen)
 *
 * Per user note "GPS 不允许功能也没法用", we surface this every time the
 * user tries a GPS-gated feature — no nagging cap. Users understand that
 * denying location means the feature won't work.
 */
import React from 'react';
import { Linking } from 'react-native';
import { ModalCard } from './ModalCard';
import { PrimaryButton } from './PrimaryButton';
import { StateSurface } from './StateSurface';
import { cairnText } from '../i18n/runtime';

interface Props {
  visible: boolean;
  featureName: string; // e.g. "Hiking", "Plant a cairn", "Memory"
  onDismiss: () => void;
}

export function PermissionDeniedModal({ visible, featureName, onDismiss }: Props) {
  const openSettings = () => {
    Linking.openSettings().catch(() => { /* best-effort */ });
    onDismiss();
  };

  return (
    <ModalCard visible={visible} onDismiss={onDismiss} testID="permission-denied-modal">
      <StateSurface
        variant="permission"
        material="embedded"
        alignment="center"
        title={cairnText('permission-denied-modal.value-needs-your-location', { featureName: featureName })}
        body={cairnText('permission-denied-modal.turn-on-location-for-cairn-in-settings')}
        actions={(
          <>
            <PrimaryButton label={cairnText('permission-denied-modal.open-settings')} onPress={openSettings} />
            <PrimaryButton label={cairnText('permission-denied-modal.not-now')} onPress={onDismiss} variant="secondary" />
          </>
        )}
      />
    </ModalCard>
  );
}
