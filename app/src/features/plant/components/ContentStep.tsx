/**
 * ContentStep — Step 3 of plant flow.
 *
 * R114 (2026-08-07): body swapped to shared <MarkForm> component.
 * Previously had inline TextInputs + typeRow + chipRow with
 * MemoryColors.sepia tokens that clashed with MarkerDetailScreen edit
 * mode. Now uses the same MarkForm mount as edit mode = pixel-identical
 * form UX everywhere content is authored (design §5).
 *
 * ContentStep now owns only:
 *   - Screen orchestration (back row, title, subtitle, ScrollView)
 *   - Keyboard-avoidance shell
 *   - Sticky bottom bar with Plant Cairn primary button
 *   - Draft state (type/title/text/visibility) — passed as controlled
 *     props to MarkForm
 */

import React, { useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  KeyboardAvoidingView, Platform, Keyboard,
  ScrollView,
} from 'react-native';
import { MarkerPermission } from '../../../store/useMarkerStore';
import { ContentConfig } from '../config/plantConfig';
import { Colors, Spacing, Radius, FontSize } from '../../../components/tokens';
import { MarkerType } from '../../../config/markerTypes';
import { BackButton } from '../../../components/BackButton';
import { MarkForm } from '../../marks/components/MarkForm';
import { Icon } from '../../../components/Icon';
import { useVisualTheme } from '../../../hooks/useVisualTheme';
import { PrimaryButton } from '../../../components/PrimaryButton';
import { CairnPlaceAnchor } from '../../cairns/components/CairnPaper';
import { CAIRN_TERMS, cairnAudienceCopy, publicCreationBlockReason } from '../../cairns/cairnExperience';

interface Props {
  initialTitle: string;
  initialText: string;
  initialVisibility: MarkerPermission;
  initialType?: MarkerType;
  submitting?: boolean;
  onSubmit: (payload: {
    type: MarkerType;
    title: string;
    text: string;
    visibility: MarkerPermission;
    voiceUri: string | null;
    voiceMs: number | null;
  }) => void;
  onBack: () => void;
  onAdjustLocation?: () => void;
  activityLocation?: boolean;
  publicEnabled?: boolean;
  accuracyM?: number | null;
  capturedAtMs?: number | null;
  locationProvenance?: 'real' | 'simulator_test' | null;
}

export function ContentStep({
  initialTitle,
  initialText,
  initialVisibility,
  initialType = 'cairn',
  submitting = false,
  onSubmit,
  onBack,
  onAdjustLocation,
  activityLocation = false,
  publicEnabled = false,
  accuracyM = null,
  capturedAtMs = null,
  locationProvenance = null,
}: Props) {
  const theme = useVisualTheme();
  const [type, setType] = useState<MarkerType>(initialType);
  const [title, setTitle] = useState(initialTitle);
  const [text, setText] = useState(initialText);
  const [visibility, setVisibility] = useState<MarkerPermission>(initialVisibility);

  const hasContent = title.trim().length > 0 || text.trim().length > 0;
  const publicBlock = publicCreationBlockReason({
    permission: visibility,
    publicEnabled,
    activityLocation,
    hasUsefulText: hasContent,
  });
  const canSubmit = !submitting
    && (!ContentConfig.requireAtLeastOneContent || hasContent)
    && !publicBlock;
  const audience = cairnAudienceCopy(visibility);
  const ageSeconds = capturedAtMs == null ? null : Math.max(0, Math.floor((Date.now() - capturedAtMs) / 1000));
  const accuracyLabel = accuracyM == null ? 'accuracy unavailable' : `±${Math.max(1, Math.round(accuracyM))} m`;
  const ageLabel = ageSeconds == null ? 'capture time unavailable' : ageSeconds < 10 ? 'just captured' : `${ageSeconds}s old`;

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={0}
    >
      <View style={styles.container}>
          {/* R114/O24 (2026-08-12): back button moved inline with title
              (was in a separate row above). User feedback: back on its
              own row felt disconnected from the page header. */}
          <View style={styles.headerRow}>
            {/* R21 v3 (2026-08-17): unified to Auth back style —
                ContentStep is a full-screen form, not a map overlay, so
                the frosted pill diverged from the Auth reference. */}
            <View style={styles.headerBack}>
              <BackButton variant="inline" onPress={() => { Keyboard.dismiss(); onBack(); }} />
            </View>
            <View style={styles.headerCopy}>
              <Text style={[styles.title, { color: theme.foreground }]}>{CAIRN_TERMS.leaveTitle}</Text>
              <Text style={[styles.headerEyebrow, { color: theme.foregroundSecondary }]}>MARK THIS PLACE</Text>
            </View>
            <View style={styles.headerBalance} accessibilityElementsHidden />
          </View>
          <ScrollView
            style={styles.scroll}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
            automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
          >
            <Text style={[styles.sub, { color: theme.foregroundSecondary }]}>A folded note held by this place. You can leave it empty when saving only for yourself or friends.</Text>

            <TouchableOpacity
              onPress={onAdjustLocation ?? onBack}
              accessibilityRole="button"
              accessibilityLabel={`${activityLocation ? 'Using Activity location' : 'Location confirmed'}. ${accuracyLabel}. Adjust location`}
            >
              <CairnPlaceAnchor
                title={activityLocation ? 'Using this Activity’s location' : 'Location confirmed'}
                detail={`${accuracyLabel} · ${ageLabel}${locationProvenance === 'simulator_test' ? ' · Simulator test' : ''}`}
                status="Adjust"
                compact
              />
            </TouchableOpacity>

            {/* R114/O24 (2026-08-12): autoFocus="title" removed — user
                requested no page ever pop the keyboard automatically on
                mount. User taps into the field to open it. */}
            <MarkForm
              type={type}
              title={title}
              note={text}
              visibility={visibility}
              onTypeChange={setType}
              onTitleChange={setTitle}
              onNoteChange={setText}
              onVisibilityChange={setVisibility}
              mode="create"
              disableVisibilityPublic={!publicEnabled}
              showLocationLockedNotice={false}
              autoFocus={null}
              titleMaxChars={ContentConfig.titleMaxChars}
              noteMaxChars={ContentConfig.textMaxChars}
              showTypePicker={false}
              showVisibilityPicker
            />

          </ScrollView>

          <View style={styles.bottomBar}>
            {/* Sprint 68 STORY-00530 (Friend System v1):
                Public option is hidden in v1 UI (VisibilityConfig.enablePublicOption=false).
                The "frozen forever" hint only matters if Public is offered, so suppress
                it when the public option is disabled. Kept conditional so v1.1+ revert is
                a one-line config flip without re-touching this component. */}
            {publicBlock ? (
              <Text
                style={[styles.actionTruth, { color: theme.destructive }]}
                accessibilityLiveRegion="polite"
              >
                {publicBlock}
              </Text>
            ) : null}
            <PrimaryButton
              label={submitting ? 'Leaving this Cairn…' : audience.action}
              loading={submitting}
              disabled={!canSubmit}
              renderIcon={(color) => <Icon name={visibility === 'personal' ? 'Lock' : visibility === 'group' ? 'Users' : 'Globe'} size={17} color={color} strokeWidth={2.2} />}
              onPress={() => {
                Keyboard.dismiss();
                onSubmit({
                  type,
                  title,
                  text,
                  visibility,
                  voiceUri: null,
                  voiceMs: null,
                });
              }}
              testID="plant-submit"
            />
          </View>
        </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  // R114 (2026-08-07): retokenized from MemoryColors.sepia* → Colors.*.
  // Consistent with MarkerDetailScreen / MarkDetailSheet after refactor.
  // R114/O24 (2026-08-12): headerRow — back button + title on same line.
  // Title marginBottom kept 0 so subtitle below still hugs it.
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 58,
    paddingBottom: Spacing.sm,
  },
  headerBack: { width: 52, alignItems: 'flex-start' },
  headerBalance: { width: 52 },
  headerCopy: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  // Concept alignment (2026-08-16): title bumped to 700 to read as the
  // page anchor next to the pill back button, matching Plant-2 concept.
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: Colors.textPrimary,
    marginBottom: 0,
    textAlign: 'center',
  },
  headerEyebrow: { marginTop: 2, fontSize: 10, lineHeight: 13, fontWeight: '700', letterSpacing: 1.2 },
  scroll: { flex: 1, minHeight: 0 },
  scrollContent: { paddingBottom: Spacing.lg },
  sub: {
    fontSize: FontSize.caption,
    color: Colors.textSecondary,
    marginBottom: Spacing.md,
  },
  // Concept alignment (2026-08-16): voice memo box gets an info-blue
  // tone (water blue) per Plant-2 concept — subtle blue-ink card that
  // reads as a preview/dev-callout distinct from primary form fields.
  voiceBox: {
    backgroundColor: Colors.infoBg,
    borderRadius: Radius.button,
    borderWidth: 1,
    borderColor: 'rgba(46,108,197,0.20)',
    padding: 14,
    alignItems: 'flex-start',
    marginTop: 14,
  },
  voiceTodo: {
    fontSize: FontSize.small,
    color: Colors.info,
    fontStyle: 'italic',
  },
  bottomBar: {
    paddingTop: 8,
  },
  // R114 (2026-08-07): primary CTA now Colors.primary (forest green) —
  // was MemoryColors.sepia. Unifies with all other Mark surfaces.
  actionTruth: {
    fontSize: FontSize.small,
    lineHeight: 16,
    textAlign: 'left',
    marginBottom: 8,
  },
  backRow: {
    // Retained for reference only; back moved to headerRow (R114/O24).
    flexDirection: 'row',
    paddingBottom: 8,
  },
});
