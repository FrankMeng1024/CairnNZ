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
}

export function ContentStep({
  initialTitle,
  initialText,
  initialVisibility,
  initialType = 'danger',
  submitting = false,
  onSubmit,
  onBack,
}: Props) {
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
          {/* R114 (2026-08-07): back row keeps existing pill variant so
              plant flow feels continuous with PinAdjustStep. */}
          <View style={styles.backRow}>
            <BackButton variant="pill" onPress={() => { Keyboard.dismiss(); onBack(); }} />
          </View>
          <ScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ paddingBottom: 16 }}
            showsVerticalScrollIndicator={false}
          >
            <Text style={styles.title}>Leave a mark</Text>
            <Text style={styles.sub}>A few words, and a photo if you'd like.</Text>

            {/* R114 (2026-08-07): all field authoring routed through the
                shared MarkForm component. Autofocus title on entry so
                keyboard is up as soon as the step mounts. */}
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
              autoFocus="title"
              titleMaxChars={ContentConfig.titleMaxChars}
              noteMaxChars={ContentConfig.textMaxChars}
            />

            {__DEV__ && (
              <View style={styles.voiceBox}>
                <Text style={styles.voiceTodo}>Voice memo (dev-only preview — coming in a later release)</Text>
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
              style={[styles.primary, !canSubmit && styles.primaryDisabled]}
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
              <Text style={styles.primaryText}>{submitting ? 'Planting…' : 'Plant Cairn'}</Text>
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
  title: {
    fontSize: 22,
    fontWeight: '600',
    color: Colors.textPrimary,
    marginBottom: 6,
  },
  sub: {
    fontSize: FontSize.caption,
    color: Colors.textSecondary,
    marginBottom: Spacing.md,
  },
  voiceBox: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.button,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 14,
    alignItems: 'center',
    marginTop: 14,
  },
  voiceTodo: {
    fontSize: FontSize.small,
    color: Colors.textSecondary,
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
    flexDirection: 'row',
    paddingBottom: 8,
  },
});
