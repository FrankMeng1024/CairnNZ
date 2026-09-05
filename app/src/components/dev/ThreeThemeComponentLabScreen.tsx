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
        <Text style={[styles.eyebrow, { color: theme.textMuted }]}>DEV · THREE-THEME AUTHORITY</Text>
        <Text style={[styles.title, { color: theme.textPrimary }]}>Shared visual primitives</Text>

        <SegmentedControl<'records' | 'saved'>
          value={tab}
          segments={[{ key: 'records', label: 'Records' }, { key: 'saved', label: 'Saved' }]}
          onChange={setTab}
          testID="lab-tabs"
        />

        <ContentSurface testID="lab-record" onPress={() => {}}>
          <View style={styles.rowCopy}>
            <Icon name="Footprints" size={IconSize.md} color={theme.icon} strokeWidth={2} />
            <View style={styles.copy}>
              <Text testID="lab-record-text" style={[styles.recordTitle, { color: theme.textPrimary }]}>Milford Track</Text>
              <Text style={[styles.recordMeta, { color: theme.textSecondary }]}>Yesterday · 14.2 km</Text>
            </View>
            <Icon name="ChevronRight" size={IconSize.sm} color={theme.iconInactive} strokeWidth={2} />
          </View>
        </ContentSurface>

        <ContentSurface level="elevated" testID="lab-elevated-card">
          <Text style={[styles.cardTitle, { color: theme.textPrimary }]}>Elevated card</Text>
          <Text style={[styles.cardBody, { color: theme.textSecondary }]}>A stronger material step for grouped information.</Text>
        </ContentSurface>

        <View style={styles.buttonStack}>
          <PrimaryButton
            label="Start exploring"
            onPress={() => {}}
            testID="lab-primary-button"
            renderIcon={color => <Icon name="Compass" size={IconSize.sm} color={color} strokeWidth={2.1} />}
          />
          <PrimaryButton
            label="Save for later"
            onPress={() => {}}
            variant="secondary"
            testID="lab-secondary-button"
            renderIcon={color => <Icon name="Heart" size={IconSize.sm} color={color} strokeWidth={2.1} />}
          />
          <PrimaryButton label="Unavailable" onPress={() => {}} disabled testID="lab-disabled-button" />
          <ContentSurface testID="lab-destructive-normal">
            <Text style={[styles.utility, { color: theme.textPrimary }]}>Remove downloaded route</Text>
          </ContentSurface>
          <PrimaryButton label="Confirm removal" onPress={() => {}} variant="destructive" testID="lab-destructive-final" />
        </View>

        <View style={styles.iconPair} testID="lab-icon-pair">
          <View testID="lab-icon-neutral">
            <Icon name="Map" size={IconSize.md} color={theme.icon} strokeWidth={2} />
          </View>
          <View testID="lab-icon-active">
            <Icon name="MapPin" size={IconSize.md} color={theme.iconActive} strokeWidth={2} />
          </View>
          <Text style={[styles.iconLabel, { color: theme.textSecondary }]}>Neutral / active icons</Text>
        </View>

        <TextField label="Route name" placeholder="Name this route" testID="lab-field-default" />
        <TextField label="Email address" defaultValue="not-an-email" error="Enter a valid email address." testID="lab-field-error" />
        <TextField label="Invite code" value="Unavailable" disabled testID="lab-field-disabled" />

        <View testID="lab-scrim-sample" style={[styles.scrimContext, { backgroundColor: theme.scenicSurface, borderColor: theme.borderSubtle }]}>
          <Text style={[styles.scrimLabel, { color: theme.textPrimary }]}>Environmental context</Text>
          <View style={[StyleSheet.absoluteFillObject, { backgroundColor: theme.scrim }]} />
          <Text style={[styles.scrimForeground, { color: theme.scenicText }]}>Scrim reduces competition</Text>
        </View>

        <PrimaryButton label="Open sheet sample" onPress={() => setSheetVisible(true)} variant="secondary" />
        <PrimaryButton label="Open modal sample" onPress={() => setModalVisible(true)} variant="secondary" />
      </ScrollView>

      <BottomSheetFrame visible={sheetVisible} onDismiss={() => setSheetVisible(false)} testID="lab-sheet">
        <BottomSheetHeader
          title="Route options"
          subtitle="The sheet is elevated without losing environmental continuity."
          onClose={() => setSheetVisible(false)}
        />
        <BottomSheetContent>
          <ContentSurface>
            <Text style={[styles.recordTitle, { color: theme.textPrimary }]}>Download for offline use</Text>
            <Text style={[styles.recordMeta, { color: theme.textSecondary }]}>Keep this route available beyond coverage.</Text>
          </ContentSurface>
          <View style={styles.sheetAction}>
            <PrimaryButton label="Download route" onPress={() => {}} />
          </View>
        </BottomSheetContent>
      </BottomSheetFrame>

      <ModalCard visible={modalVisible} onDismiss={() => setModalVisible(false)} testID="lab-modal">
        <ModalCardHeader
          title="Save this route?"
          body="It will remain available from Trails."
          onClose={() => setModalVisible(false)}
        />
        <View style={styles.buttonStack}>
          <PrimaryButton label="Save route" onPress={() => {}} />
          <PrimaryButton label="Not now" onPress={() => setModalVisible(false)} variant="secondary" />
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
