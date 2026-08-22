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
import { Modal, View, Text, StyleSheet, TouchableOpacity, Linking } from 'react-native';
import { Colors, Spacing, Radius, FontSize, Shadow } from './tokens';
import { Icon } from './Icon';
import { useVisualTheme } from '../hooks/useVisualTheme';

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
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onDismiss}>
      <View style={styles.backdrop}>
        <View style={[styles.sheet, { backgroundColor: theme.surfaceElevated, borderColor: theme.border, borderWidth: 1 }]}>
          <View style={[styles.iconWrap, { backgroundColor: theme.surface }]}>
            <Icon name="MapPin" size={32} color={theme.iconActive} strokeWidth={1.8} />
          </View>
          <Text style={[styles.title, { color: theme.foreground }]}>{featureName} needs your location</Text>
          <Text style={[styles.body, { color: theme.foregroundSecondary }]}>
            Turn on location for Cairn in Settings to use this feature.
          </Text>
          <TouchableOpacity
            style={[styles.primaryBtn, { backgroundColor: theme.primary }]}
            onPress={openSettings}
            accessibilityRole="button"
            accessibilityLabel="Open Settings"
          >
            <Text style={[styles.primaryText, { color: theme.onPrimary }]}>Open Settings</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.secondaryBtn}
            onPress={onDismiss}
            accessibilityRole="button"
            accessibilityLabel="Not now"
          >
            <Text style={[styles.secondaryText, { color: theme.foregroundSecondary }]}>Not now</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.xl,
  },
  sheet: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.card,
    padding: Spacing.xl,
    alignItems: 'center',
    maxWidth: 340,
    width: '100%',
    ...Shadow.card,
  },
  iconWrap: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: Colors.primaryBg,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.md,
  },
  title: {
    fontSize: FontSize.h3,
    fontWeight: '700',
    color: Colors.textPrimary,
    textAlign: 'center',
    marginBottom: Spacing.sm,
  },
  body: {
    fontSize: FontSize.body,
    color: Colors.textSecondary,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: Spacing.lg,
  },
  primaryBtn: {
    backgroundColor: Colors.primary,
    borderRadius: Radius.button,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.xl,
    alignItems: 'center',
    minWidth: 220,
  },
  primaryText: {
    color: '#fff',
    fontSize: FontSize.body,
    fontWeight: '700',
  },
  secondaryBtn: {
    marginTop: Spacing.sm,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
  },
  secondaryText: {
    color: Colors.textSecondary,
    fontSize: FontSize.body,
    fontWeight: '600',
  },
});
