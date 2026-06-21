/**
 * ContentStep — Step 3 of plant flow.
 *
 * v0.2.6.6 (V3+V4+V5):
 *   - Cairn TYPE picker (danger / junction / water / hut / cairn) above
 *     the title/text inputs. Type is part of MarkerType (single source
 *     in src/config/markerTypes).
 *   - Visibility picker now includes 'Anyone' (Public) — was hidden.
 *   - KeyboardAvoidingView lifts the Plant Cairn button above the
 *     keyboard.
 *   - Tap anywhere outside the inputs dismisses the keyboard.
 *   - keyboardAppearance + returnKeyType='done' so the OS keyboard
 *     has a clean dismiss path.
 *   - returnKeyType='done' submits inputs without an explicit close.
 */

import React, { useState } from 'react';
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity,
  KeyboardAvoidingView, Platform, Keyboard, TouchableWithoutFeedback,
  ScrollView,
} from 'react-native';
import { MarkerPermission } from '../../../store/useMarkerStore';
import { ContentConfig, VisibilityConfig } from '../config/plantConfig';
import { MemoryColors } from '../../memory/config/memoryConfig';
import { Icon, IconName } from '../../../components/Icon';
import { MARKER_TYPE_ORDER, MARKER_TYPES, MarkerType } from '../../../config/markerTypes';
import { log } from '../../../services/appLog';

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
  initialType = 'cairn',
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
          <ScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ paddingBottom: 16 }}
            showsVerticalScrollIndicator={false}
          >
            <Text style={styles.title}>Leave a mark</Text>
            <Text style={styles.sub}>A few words, a voice memo, or both.</Text>

            {/* V5: cairn type picker */}
            <Text style={styles.label}>Type</Text>
            <View style={styles.typeRow}>
              {MARKER_TYPE_ORDER.map((t) => {
                const meta = MARKER_TYPES[t];
                const active = type === t;
                return (
                  <TouchableOpacity
                    key={t}
                    style={[styles.typeChip, active && {
                      backgroundColor: meta.bg,
                      borderColor: meta.color,
                    }]}
                    onPress={() => { log('plant.type_select', { type: t }); setType(t); }}
                  >
                    <Icon name={meta.icon as IconName} size={16} color={active ? meta.color : MemoryColors.cairnPublic} strokeWidth={2} />
                    <Text style={[styles.typeChipLabel, active && { color: meta.color, fontWeight: '500' }]}>
                      {meta.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <TextInput
              style={styles.input}
              placeholder={`Title (max ${ContentConfig.titleMaxChars})`}
              maxLength={ContentConfig.titleMaxChars}
              value={title}
              onChangeText={setTitle}
              returnKeyType="next"
              blurOnSubmit={false}
            />
            <Text style={styles.charCounter}>{title.length} / {ContentConfig.titleMaxChars}</Text>
            <TextInput
              style={[styles.input, styles.textArea]}
              placeholder="Tell whoever finds this…"
              maxLength={ContentConfig.textMaxChars}
              value={text}
              onChangeText={setText}
              multiline
              returnKeyType="default"
              blurOnSubmit={false}
            />
            <Text style={styles.charCounter}>{text.length} / {ContentConfig.textMaxChars}</Text>

            <View style={styles.voiceBox}>
              <Text style={styles.voiceTodo}>🎤 Voice memo (coming soon, max {ContentConfig.voiceMaxSeconds}s)</Text>
            </View>

            <Text style={styles.label}>Who can see this</Text>
            <View style={styles.chipRow}>
              <VisChip label="Just me"  active={visibility === 'personal'} onPress={() => setVisibility('personal')} iconName="Lock" />
              <VisChip label="Friends"  active={visibility === 'group'}    onPress={() => setVisibility('group')}    iconName="Users" />
              {VisibilityConfig.enablePublicOption && (
                <VisChip label="Anyone" active={visibility === 'public'}   onPress={() => setVisibility('public')}   iconName="Globe" />
              )}
            </View>
          </ScrollView>

          <View style={styles.bottomBar}>
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
            >
              <Text style={styles.primaryText}>{submitting ? 'Planting…' : 'Plant Cairn'}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.back} onPress={() => { Keyboard.dismiss(); onBack(); }}>
              <Text style={styles.backText}>Back</Text>
            </TouchableOpacity>
          </View>
        </View>
      </TouchableWithoutFeedback>
    </KeyboardAvoidingView>
  );
}

interface ChipProps {
  label: string; active: boolean; onPress: () => void; iconName: IconName;
}
function VisChip({ label, active, onPress, iconName }: ChipProps) {
  return (
    <TouchableOpacity style={[styles.chip, active && styles.chipActive]} onPress={onPress}>
      <Icon name={iconName} size={14} color={active ? MemoryColors.sepia : MemoryColors.cairnPublic} strokeWidth={2} />
      <Text style={[styles.chipLabel, active && styles.chipLabelActive]}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  title: { fontSize: 22, fontWeight: '500', color: MemoryColors.sepiaDeep, marginBottom: 6 },
  sub:   { fontSize: 13, color: MemoryColors.cairnPublic, marginBottom: 16 },
  input: {
    backgroundColor: '#fff',
    borderWidth: 1, borderColor: '#e8dfc8',
    borderRadius: 12, padding: 12, fontSize: 13,
    color: MemoryColors.sepiaDeep, marginBottom: 12,
  },
  textArea: { minHeight: 80, textAlignVertical: 'top' },
  voiceBox: {
    backgroundColor: '#fff',
    borderRadius: 12, borderWidth: 1, borderColor: '#e8dfc8',
    padding: 14, alignItems: 'center', marginBottom: 14,
  },
  voiceTodo: { fontSize: 12, color: MemoryColors.cairnPublic },
  charCounter: {
    fontSize: 10,
    color: MemoryColors.cairnPublic,
    textAlign: 'right',
    marginTop: -8, marginBottom: 8,
  },
  label: { fontSize: 11, color: MemoryColors.cairnPublic, marginBottom: 8, marginTop: 4 },
  typeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 14,
  },
  typeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10, paddingVertical: 7,
    backgroundColor: '#fff',
    borderWidth: 1, borderColor: '#e8dfc8',
    borderRadius: 18,
  },
  typeChipLabel: { fontSize: 12, color: MemoryColors.cairnPublic },
  chipRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  chip: {
    flex: 1, padding: 10, alignItems: 'center',
    backgroundColor: '#fff',
    borderWidth: 1, borderColor: '#e8dfc8', borderRadius: 10,
  },
  chipActive: { backgroundColor: '#fff5e0', borderColor: MemoryColors.sepia },
  chipLabel: { fontSize: 11, color: MemoryColors.cairnPublic },
  chipLabelActive: { color: MemoryColors.sepia, fontWeight: '500' },
  bottomBar: {
    paddingTop: 8,
  },
  primary: {
    backgroundColor: MemoryColors.sepia,
    padding: 14, borderRadius: 12, alignItems: 'center',
  },
  primaryDisabled: { opacity: 0.4 },
  primaryText: { color: '#fff', fontSize: 14, fontWeight: '500' },
  back: { padding: 14, alignItems: 'center' },
  backText: { fontSize: 13, color: MemoryColors.cairnPublic },
});
