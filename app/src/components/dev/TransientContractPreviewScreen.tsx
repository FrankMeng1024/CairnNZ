import React, { useState } from 'react';
import { ScrollView, StyleSheet, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { BottomActionArea } from '../BottomActionArea';
import { BottomSheetContent, BottomSheetFrame, BottomSheetHeader } from '../BottomSheetFrame';
import { PermissionDeniedModal } from '../PermissionDeniedModal';
import { PrimaryButton } from '../PrimaryButton';
import { StateSurface } from '../StateSurface';
import { FontSize, Spacing } from '../tokens';
import { useVisualTheme } from '../../hooks/useVisualTheme';

/** Dev-only real-app harness for Batch 2 material and transient-state QA. */
export function TransientContractPreviewScreen() {
  const theme = useVisualTheme();
  const [sheetVisible, setSheetVisible] = useState(false);
  const [permissionVisible, setPermissionVisible] = useState(false);

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: theme.background }]} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={[styles.eyebrow, { color: theme.textMuted }]}>BATCH 2 · DEV REVIEW</Text>
        <Text style={[styles.title, { color: theme.textPrimary }]}>Transient surface contract</Text>
        <Text style={[styles.subtitle, { color: theme.textSecondary }]}>Compact proof states using the active Day, Sunset, or Night material system.</Text>

        <StateSurface
          variant="empty"
          title="No saved routes yet"
          body="Saved routes will appear here when they are ready to use offline."
          testID="preview-empty-state"
        />
        <StateSurface
          variant="offline"
          title="You are offline"
          body="Tracking can continue. Changes will sync after the connection returns."
          testID="preview-offline-state"
        />
      </ScrollView>

      <BottomActionArea layout="row" testID="preview-bottom-action-area">
        <PrimaryButton label="Open sheet" onPress={() => setSheetVisible(true)} variant="secondary" />
        <PrimaryButton label="Permission" onPress={() => setPermissionVisible(true)} />
      </BottomActionArea>

      <BottomSheetFrame visible={sheetVisible} onDismiss={() => setSheetVisible(false)} testID="preview-bottom-sheet">
        <BottomSheetHeader
          title="Preparing your route"
          subtitle="Sheet height and content remain specific to the task."
          onClose={() => setSheetVisible(false)}
        />
        <BottomSheetContent>
          <StateSurface
            variant="loading"
            material="embedded"
            title="Loading route details"
            body="This should only take a moment."
            testID="preview-loading-state"
          />
        </BottomSheetContent>
      </BottomSheetFrame>

      <PermissionDeniedModal
        visible={permissionVisible}
        featureName="Hiking"
        onDismiss={() => setPermissionVisible(false)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { padding: Spacing.xl, paddingBottom: Spacing.xxl, gap: Spacing.md },
  eyebrow: { fontSize: FontSize.small, fontWeight: '700', letterSpacing: 1.2 },
  title: { fontSize: FontSize.h1, fontWeight: '700', lineHeight: 34 },
  subtitle: { fontSize: FontSize.body, lineHeight: 22, marginBottom: Spacing.sm },
});
