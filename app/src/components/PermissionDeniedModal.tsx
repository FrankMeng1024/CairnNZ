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
import { View, Text, StyleSheet, Linking } from 'react-native';
import { Spacing, Radius, FontSize } from './tokens';
import { Icon } from './Icon';
import { useVisualTheme } from '../hooks/useVisualTheme';
import { ModalCard } from './ModalCard';
import { AppButton } from './AppButton';

interface Props {
  visible: boolean;
  featureName: string; // e.g. "Hiking", "Plant a cairn", "Memory"
  onDismiss: () => void;
}

export function PermissionDeniedModal({ visible, featureName, onDismiss }: Props) {
  const theme = useVisualTheme();
  const openSettings = () => {
    Linking.openSettings().catch(() => { /* best-effort */ });
    onDismiss();
  };

  return (
    <ModalCard visible={visible} onDismiss={onDismiss} testID="permission-denied-modal">
        <View style={styles.content}>
          <View style={[styles.iconWrap, { backgroundColor: theme.surface }]}>
            <Icon name="MapPin" size={28} color={theme.iconActive} strokeWidth={1.8} />
          </View>
          <Text style={[styles.title, { color: theme.foreground }]}>{featureName} needs your location</Text>
          <Text style={[styles.body, { color: theme.foregroundSecondary }]}>
            Turn on location for Cairn in Settings to use this feature.
          </Text>
          <AppButton label="Open Settings" onPress={openSettings} style={styles.action} />
          <AppButton label="Not now" onPress={onDismiss} variant="tertiary" style={styles.action} />
        </View>
    </ModalCard>
  );
}

const styles = StyleSheet.create({
  content: { alignItems: 'center' },
  iconWrap: {
    width: 48,
    height: 48,
    borderRadius: Radius.card,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.md,
  },
  title: {
    fontSize: FontSize.h3,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: Spacing.sm,
  },
  body: {
    fontSize: FontSize.body,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: Spacing.lg,
  },
  action: { alignSelf: 'stretch', marginTop: Spacing.sm },
});
