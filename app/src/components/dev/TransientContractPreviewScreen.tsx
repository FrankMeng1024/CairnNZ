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
import { cairnText } from '../../i18n/runtime';

/** Dev-only real-app harness for Batch 2 material and transient-state QA. */
export function TransientContractPreviewScreen() {
  const theme = useVisualTheme();
  const [sheetVisible, setSheetVisible] = useState(false);
  const [permissionVisible, setPermissionVisible] = useState(false);

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: theme.background }]} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={[styles.eyebrow, { color: theme.textMuted }]}>{cairnText('dev.transient-contract-preview-screen.batch-2-dev-review')}</Text>
        <Text style={[styles.title, { color: theme.textPrimary }]}>{cairnText('dev.transient-contract-preview-screen.transient-surface-contract')}</Text>
        <Text style={[styles.subtitle, { color: theme.textSecondary }]}>{cairnText('dev.transient-contract-preview-screen.compact-proof-states-using-the-active-day')}</Text>

        <StateSurface
          variant="empty"
          title={cairnText('dev.transient-contract-preview-screen.no-saved-routes-yet')}
          body={cairnText('dev.transient-contract-preview-screen.saved-routes-will-appear-here-when-they')}
          testID="preview-empty-state"
        />
        <StateSurface
          variant="offline"
          title={cairnText('dev.transient-contract-preview-screen.you-are-offline')}
          body={cairnText('dev.transient-contract-preview-screen.tracking-can-continue-changes-will-sync-after')}
          testID="preview-offline-state"
        />
      </ScrollView>

      <BottomActionArea layout="row" testID="preview-bottom-action-area">
        <PrimaryButton label={cairnText('dev.transient-contract-preview-screen.open-sheet')} onPress={() => setSheetVisible(true)} variant="secondary" />
        <PrimaryButton label={cairnText('dev.transient-contract-preview-screen.permission')} onPress={() => setPermissionVisible(true)} />
      </BottomActionArea>

      <BottomSheetFrame visible={sheetVisible} onDismiss={() => setSheetVisible(false)} testID="preview-bottom-sheet">
        <BottomSheetHeader
          title={cairnText('dev.transient-contract-preview-screen.preparing-your-route')}
          subtitle={cairnText('dev.transient-contract-preview-screen.sheet-height-and-content-remain-specific-to')}
          onClose={() => setSheetVisible(false)}
        />
        <BottomSheetContent>
          <StateSurface
            variant="loading"
            material="embedded"
            title={cairnText('dev.transient-contract-preview-screen.loading-route-details')}
            body={cairnText('dev.transient-contract-preview-screen.this-should-only-take-a-moment')}
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
