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
  KeyboardAvoidingView, Platform, Keyboard, TouchableWithoutFeedback,
  ScrollView,
} from 'react-native';
import { MarkerPermission } from '../../../store/useMarkerStore';
import { ContentConfig, VisibilityConfig } from '../config/plantConfig';
import { Colors, Spacing, Radius, FontSize } from '../../../components/tokens';
import { MarkerType } from '../../../config/markerTypes';
import { BackButton } from '../../../components/BackButton';
import { MarkForm } from '../../marks/components/MarkForm';
import { Icon } from '../../../components/Icon';
import { useVisualTheme } from '../../../hooks/useVisualTheme';

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
  activityLocation?: boolean;
}

export function ContentStep({
  initialTitle,
  initialText,
  initialVisibility,
  initialType = 'cairn',
  submitting = false,
  onSubmit,
  onBack,
  activityLocation = false,
}: Props) {
  const theme = useVisualTheme();
  const [type, setType] = useState<MarkerType>(initialType);
  const [title, setTitle] = useState(initialTitle);
  const [text, setText] = useState(initialText);
  const [visibility, setVisibility] = useState<MarkerPermission>(initialVisibility);

  const hasContent = title.length > 0 || text.length > 0;
  const canSubmit = !submitting && (!ContentConfig.requireAtLeastOneContent || hasContent);

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 24 : 0}
    >
      <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
        <View style={styles.container}>
          {/* R114/O24 (2026-08-12): back button moved inline with title
              (was in a separate row above). User feedback: back on its
              own row felt disconnected from the page header. */}
          <View style={styles.headerRow}>
            {/* R21 v3 (2026-08-17): unified to Auth back style —
                ContentStep is a full-screen form, not a map overlay, so
                the frosted pill diverged from the Auth reference. */}
            <BackButton variant="inline" onPress={() => { Keyboard.dismiss(); onBack(); }} />
            <Text style={[styles.title, { color: theme.foreground }]}>Leave a Cairn</Text>
          </View>
          <ScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ paddingBottom: 16 }}
            showsVerticalScrollIndicator={false}
          >
            <Text style={[styles.sub, { color: theme.foregroundSecondary }]}>A trace for this place. Add a note now or come back later.</Text>

            {activityLocation ? (
              <TouchableOpacity
                style={[styles.locationTrust, { backgroundColor: theme.surface, borderColor: theme.border }]}
                onPress={onBack}
                accessibilityRole="button"
                accessibilityLabel="Using Activity location. Adjust location"
              >
                <Icon name="MapPin" size={16} color={theme.primary} strokeWidth={2.2} />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.locationTrustTitle, { color: theme.foreground }]}>Using your Activity location</Text>
                  <Text style={[styles.locationTrustBody, { color: theme.foregroundSecondary }]}>Trusted recorded position · Tap to adjust</Text>
                </View>
                <Icon name="ChevronRight" size={16} color={theme.iconInactive} />
              </TouchableOpacity>
            ) : null}

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
              disableVisibilityPublic={!VisibilityConfig.enablePublicOption}
              showLocationLockedNotice={false}
              autoFocus={null}
              titleMaxChars={ContentConfig.titleMaxChars}
              noteMaxChars={ContentConfig.textMaxChars}
              showTypePicker={false}
              showVisibilityPicker={false}
            />

            {__DEV__ && (
              <View style={[styles.voiceBox, { backgroundColor: theme.surface, borderColor: theme.border }] }>
                <Text style={[styles.voiceTodo, { color: theme.foregroundSecondary }]}>Voice memo (dev-only preview — coming in a later release)</Text>
              </View>
            )}
          </ScrollView>

          <View style={styles.bottomBar}>
            {/* Sprint 68 STORY-00530 (Friend System v1):
                Public option is hidden in v1 UI (VisibilityConfig.enablePublicOption=false).
                The "frozen forever" hint only matters if Public is offered, so suppress
                it when the public option is disabled. Kept conditional so v1.1+ revert is
                a one-line config flip without re-touching this component. */}
            {VisibilityConfig.enablePublicOption && (
              <Text style={styles.permanentHint}>
                Once shared publicly, what others see is frozen forever.
              </Text>
            )}
            <TouchableOpacity
              style={[styles.primary, { backgroundColor: theme.primary }, !canSubmit && styles.primaryDisabled]}
              disabled={!canSubmit}
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
              accessibilityRole="button"
              accessibilityLabel={submitting ? 'Planting' : 'Plant Cairn'}
              accessibilityState={{ disabled: !canSubmit }}
            >
              <Text style={[styles.primaryText, { color: theme.onPrimary }]}>{submitting ? 'Planting…' : 'Plant Cairn'}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </TouchableWithoutFeedback>
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
    gap: Spacing.sm,
    paddingBottom: 8,
  },
  // Concept alignment (2026-08-16): title bumped to 700 to read as the
  // page anchor next to the pill back button, matching Plant-2 concept.
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: Colors.textPrimary,
    marginBottom: 0,
    flexShrink: 1,
  },
  sub: {
    fontSize: FontSize.caption,
    color: Colors.textSecondary,
    marginBottom: Spacing.md,
  },
  locationTrust: {
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    borderWidth: 1,
    borderRadius: Radius.button,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    marginBottom: Spacing.xs,
  },
  locationTrustTitle: { fontSize: FontSize.caption, fontWeight: '700' },
  locationTrustBody: { fontSize: FontSize.small, marginTop: 2 },
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
  primary: {
    backgroundColor: Colors.primary,
    paddingVertical: 14,
    borderRadius: Radius.button,
    alignItems: 'center',
  },
  primaryDisabled: { opacity: 0.4 },
  primaryText: {
    color: '#ffffff',
    fontSize: FontSize.body,
    fontWeight: '600',
  },
  permanentHint: {
    fontSize: FontSize.small,
    color: Colors.textSecondary,
    textAlign: 'center',
    marginBottom: 8,
    fontStyle: 'italic',
  },
  backRow: {
    // Retained for reference only; back moved to headerRow (R114/O24).
    flexDirection: 'row',
    paddingBottom: 8,
  },
});
