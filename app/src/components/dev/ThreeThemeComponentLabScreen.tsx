import React, { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { BackButton } from '../BackButton';
import { BottomSheetContent, BottomSheetFrame, BottomSheetHeader } from '../BottomSheetFrame';
import { ContentSurface } from '../ContentSurface';
import { DismissButton } from '../DismissButton';
import { Icon } from '../Icon';
import { ModalCard, ModalCardHeader } from '../ModalCard';
import { PrimaryButton } from '../PrimaryButton';
import { SegmentedControl } from '../SegmentedControl';
import { TextField } from '../TextField';
import { FontSize, IconSize, RadiusRole, Spacing } from '../tokens';
import { useVisualTheme } from '../../hooks/useVisualTheme';
import { cairnText } from '../../i18n/runtime';

/** Strictly development-only proof of production shared primitives. */
export function ThreeThemeComponentLabScreen() {
  const theme = useVisualTheme();
  const [tab, setTab] = useState<'records' | 'saved'>('records');
  const [sheetVisible, setSheetVisible] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);

  if (!__DEV__) return null;

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: theme.background }]} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.topRow}>
          <BackButton onPress={() => {}} testID="lab-back" />
          <DismissButton onPress={() => {}} testID="lab-close" />
        </View>
        <Text style={[styles.eyebrow, { color: theme.textMuted }]}>{cairnText('dev.three-theme-component-lab-screen.dev-three-theme-authority')}</Text>
        <Text style={[styles.title, { color: theme.textPrimary }]}>{cairnText('dev.three-theme-component-lab-screen.shared-visual-primitives')}</Text>

        <SegmentedControl<'records' | 'saved'>
          value={tab}
          segments={[{ key: 'records', label: cairnText('dev.three-theme-component-lab-screen.records') }, { key: 'saved', label: cairnText('dev.three-theme-component-lab-screen.saved') }]}
          onChange={setTab}
          testID="lab-tabs"
        />

        <ContentSurface testID="lab-record" onPress={() => {}}>
          <View style={styles.rowCopy}>
            <Icon name="Footprints" size={IconSize.md} color={theme.icon} strokeWidth={2} />
            <View style={styles.copy}>
              <Text testID="lab-record-text" style={[styles.recordTitle, { color: theme.textPrimary }]}>{cairnText('dev.three-theme-component-lab-screen.milford-track')}</Text>
              <Text style={[styles.recordMeta, { color: theme.textSecondary }]}>{cairnText('dev.three-theme-component-lab-screen.yesterday-14-2-km')}</Text>
            </View>
            <Icon name="ChevronRight" size={IconSize.sm} color={theme.iconInactive} strokeWidth={2} />
          </View>
        </ContentSurface>

        <ContentSurface level="elevated" testID="lab-elevated-card">
          <Text style={[styles.cardTitle, { color: theme.textPrimary }]}>{cairnText('dev.three-theme-component-lab-screen.elevated-card')}</Text>
          <Text style={[styles.cardBody, { color: theme.textSecondary }]}>{cairnText('dev.three-theme-component-lab-screen.a-stronger-material-step-for-grouped-information')}</Text>
        </ContentSurface>

        <View style={styles.buttonStack}>
          <PrimaryButton
            label={cairnText('dev.three-theme-component-lab-screen.start-exploring')}
            onPress={() => {}}
            testID="lab-primary-button"
            renderIcon={color => <Icon name="Compass" size={IconSize.sm} color={color} strokeWidth={2.1} />}
          />
          <PrimaryButton
            label={cairnText('dev.three-theme-component-lab-screen.save-for-later')}
            onPress={() => {}}
            variant="secondary"
            testID="lab-secondary-button"
            renderIcon={color => <Icon name="Heart" size={IconSize.sm} color={color} strokeWidth={2.1} />}
          />
          <PrimaryButton label={cairnText('dev.three-theme-component-lab-screen.unavailable')} onPress={() => {}} disabled testID="lab-disabled-button" />
          <ContentSurface testID="lab-destructive-normal">
            <Text style={[styles.utility, { color: theme.textPrimary }]}>{cairnText('dev.three-theme-component-lab-screen.remove-downloaded-route')}</Text>
          </ContentSurface>
          <PrimaryButton label={cairnText('dev.three-theme-component-lab-screen.confirm-removal')} onPress={() => {}} variant="destructive" testID="lab-destructive-final" />
        </View>

        <View style={styles.iconPair} testID="lab-icon-pair">
          <View testID="lab-icon-neutral">
            <Icon name="Map" size={IconSize.md} color={theme.icon} strokeWidth={2} />
          </View>
          <View testID="lab-icon-active">
            <Icon name="MapPin" size={IconSize.md} color={theme.iconActive} strokeWidth={2} />
          </View>
          <Text style={[styles.iconLabel, { color: theme.textSecondary }]}>{cairnText('dev.three-theme-component-lab-screen.neutral-active-icons')}</Text>
        </View>

        <TextField label={cairnText('dev.three-theme-component-lab-screen.route-name')} placeholder={cairnText('dev.three-theme-component-lab-screen.name-this-route')} testID="lab-field-default" />
        <TextField label={cairnText('dev.three-theme-component-lab-screen.email-address')} defaultValue="not-an-email" error={cairnText('dev.three-theme-component-lab-screen.enter-a-valid-email-address')} testID="lab-field-error" />
        <TextField label={cairnText('dev.three-theme-component-lab-screen.invite-code')} value={cairnText('dev.three-theme-component-lab-screen.unavailable-6c68f19')} disabled testID="lab-field-disabled" />

        <View testID="lab-scrim-sample" style={[styles.scrimContext, { backgroundColor: theme.scenicSurface, borderColor: theme.borderSubtle }]}>
          <Text style={[styles.scrimLabel, { color: theme.textPrimary }]}>{cairnText('dev.three-theme-component-lab-screen.environmental-context')}</Text>
          <View style={[StyleSheet.absoluteFillObject, { backgroundColor: theme.scrim }]} />
          <Text style={[styles.scrimForeground, { color: theme.scenicText }]}>{cairnText('dev.three-theme-component-lab-screen.scrim-reduces-competition')}</Text>
        </View>

        <PrimaryButton label={cairnText('dev.three-theme-component-lab-screen.open-sheet-sample')} onPress={() => setSheetVisible(true)} variant="secondary" />
        <PrimaryButton label={cairnText('dev.three-theme-component-lab-screen.open-modal-sample')} onPress={() => setModalVisible(true)} variant="secondary" />
      </ScrollView>

      <BottomSheetFrame visible={sheetVisible} onDismiss={() => setSheetVisible(false)} testID="lab-sheet">
        <BottomSheetHeader
          title={cairnText('dev.three-theme-component-lab-screen.route-options')}
          subtitle={cairnText('dev.three-theme-component-lab-screen.the-sheet-is-elevated-without-losing-environmental')}
          onClose={() => setSheetVisible(false)}
        />
        <BottomSheetContent>
          <ContentSurface>
            <Text style={[styles.recordTitle, { color: theme.textPrimary }]}>{cairnText('dev.three-theme-component-lab-screen.download-for-offline-use')}</Text>
            <Text style={[styles.recordMeta, { color: theme.textSecondary }]}>{cairnText('dev.three-theme-component-lab-screen.keep-this-route-available-beyond-coverage')}</Text>
          </ContentSurface>
          <View style={styles.sheetAction}>
            <PrimaryButton label={cairnText('dev.three-theme-component-lab-screen.download-route')} onPress={() => {}} />
          </View>
        </BottomSheetContent>
      </BottomSheetFrame>

      <ModalCard visible={modalVisible} onDismiss={() => setModalVisible(false)} testID="lab-modal">
        <ModalCardHeader
          title={cairnText('dev.three-theme-component-lab-screen.save-this-route')}
          body={cairnText('dev.three-theme-component-lab-screen.it-will-remain-available-from-trails')}
          onClose={() => setModalVisible(false)}
        />
        <View style={styles.buttonStack}>
          <PrimaryButton label={cairnText('dev.three-theme-component-lab-screen.save-route')} onPress={() => {}} />
          <PrimaryButton label={cairnText('dev.three-theme-component-lab-screen.not-now')} onPress={() => setModalVisible(false)} variant="secondary" />
        </View>
      </ModalCard>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { padding: Spacing.xl, paddingBottom: Spacing.xxl, gap: Spacing.md },
  topRow: { minHeight: 44, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  eyebrow: { fontSize: FontSize.small, fontWeight: '700', letterSpacing: 1.1 },
  title: { fontSize: FontSize.h1, lineHeight: 34, fontWeight: '700', marginBottom: Spacing.xs },
  rowCopy: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  copy: { flex: 1 },
  recordTitle: { fontSize: FontSize.body, fontWeight: '700', lineHeight: 21 },
  recordMeta: { fontSize: FontSize.caption, lineHeight: 18, marginTop: 2 },
  cardTitle: { fontSize: FontSize.h3, fontWeight: '700', lineHeight: 23 },
  cardBody: { fontSize: FontSize.body, lineHeight: 21, marginTop: Spacing.xs },
  buttonStack: { gap: Spacing.sm },
  utility: { fontSize: FontSize.body, fontWeight: '600' },
  iconPair: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingHorizontal: Spacing.xs },
  iconLabel: { fontSize: FontSize.caption, marginLeft: Spacing.xs },
  scrimContext: { minHeight: 88, borderRadius: RadiusRole.card, borderWidth: 1, overflow: 'hidden', padding: Spacing.md, justifyContent: 'space-between' },
  scrimLabel: { fontSize: FontSize.caption },
  scrimForeground: { fontSize: FontSize.body, fontWeight: '700', zIndex: 1 },
  sheetAction: { marginTop: Spacing.md },
});
