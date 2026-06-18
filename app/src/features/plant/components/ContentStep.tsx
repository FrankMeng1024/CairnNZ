/**
 * ContentStep — Step 3 of plant flow.
 *
 * User fills in title (≤30) + text (≤200) + voice (≤30s) + visibility.
 * At least one of (title/text/voice) must be present (enforced).
 *
 * v0.2.6 MVP scaffold — voice recording is a stub button. Title and
 * text inputs are functional. Visibility chips are functional.
 */

import React, { useState } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity } from 'react-native';
import { MarkerPermission } from '../../../store/useMarkerStore';
import { ContentConfig, VisibilityConfig } from '../config/plantConfig';
import { MemoryColors } from '../../memory/config/memoryConfig';

interface Props {
  initialTitle: string;
  initialText: string;
  initialVisibility: MarkerPermission;
  /**
   * True while the parent is awaiting addMarker. Disables the Plant
   * Cairn button so a fast double-tap cannot create two markers.
   */
  submitting?: boolean;
  onSubmit: (payload: {
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
  submitting = false,
  onSubmit,
  onBack,
}: Props) {
  const [title, setTitle] = useState(initialTitle);
  const [text, setText] = useState(initialText);
  const [visibility, setVisibility] = useState<MarkerPermission>(initialVisibility);

  const hasContent = title.length > 0 || text.length > 0;
  const canSubmit = !submitting && (!ContentConfig.requireAtLeastOneContent || hasContent);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Leave a mark</Text>
      <Text style={styles.sub}>A few words, a voice memo, or both.</Text>

      <TextInput
        style={styles.input}
        placeholder={`Title (max ${ContentConfig.titleMaxChars})`}
        maxLength={ContentConfig.titleMaxChars}
        value={title}
        onChangeText={setTitle}
      />
      <TextInput
        style={[styles.input, styles.textArea]}
        placeholder="Tell whoever finds this…"
        maxLength={ContentConfig.textMaxChars}
        value={text}
        onChangeText={setText}
        multiline
      />

      <View style={styles.voiceBox}>
        {/* TODO(v0.2.6 §plant-voice): hold-to-record button + waveform */}
        <Text style={styles.voiceTodo}>🎤 Voice memo (coming soon, max {ContentConfig.voiceMaxSeconds}s)</Text>
      </View>

      <Text style={styles.label}>Who can see this</Text>
      <View style={styles.chipRow}>
        <VisChip label="Just me"  active={visibility === 'personal'} onPress={() => setVisibility('personal')} icon="🔒" />
        <VisChip label="Friends"  active={visibility === 'group'}    onPress={() => setVisibility('group')}    icon="👥" />
        {VisibilityConfig.enablePublicOption && (
          <VisChip label="Anyone" active={visibility === 'public'}   onPress={() => setVisibility('public')}   icon="🌍" />
        )}
      </View>

      <View style={{ flex: 1 }} />

      <TouchableOpacity
        style={[styles.primary, !canSubmit && styles.primaryDisabled]}
        disabled={!canSubmit}
        onPress={() =>
          onSubmit({
            title,
            text,
            visibility,
            voiceUri: null,   // wire after voice recorder is implemented
            voiceMs: null,
          })
        }
      >
        <Text style={styles.primaryText}>{submitting ? 'Planting…' : 'Plant Cairn'}</Text>
      </TouchableOpacity>
      <TouchableOpacity style={styles.back} onPress={onBack}>
        <Text style={styles.backText}>Back</Text>
      </TouchableOpacity>
    </View>
  );
}

interface ChipProps {
  label: string; active: boolean; onPress: () => void; icon: string;
}
function VisChip({ label, active, onPress, icon }: ChipProps) {
  return (
    <TouchableOpacity style={[styles.chip, active && styles.chipActive]} onPress={onPress}>
      <Text style={styles.chipIcon}>{icon}</Text>
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
    borderWidth: 1,
    borderColor: '#e8dfc8',
    borderRadius: 12,
    padding: 12,
    fontSize: 13,
    color: MemoryColors.sepiaDeep,
    marginBottom: 12,
  },
  textArea: { minHeight: 80, textAlignVertical: 'top' },
  voiceBox: {
    backgroundColor: '#fff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e8dfc8',
    padding: 14,
    alignItems: 'center',
    marginBottom: 14,
  },
  voiceTodo: { fontSize: 12, color: MemoryColors.cairnPublic },
  label: { fontSize: 11, color: MemoryColors.cairnPublic, marginBottom: 8, marginTop: 4 },
  chipRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  chip: {
    flex: 1, padding: 10, alignItems: 'center',
    backgroundColor: '#fff',
    borderWidth: 1, borderColor: '#e8dfc8', borderRadius: 10,
  },
  chipActive: { backgroundColor: '#fff5e0', borderColor: MemoryColors.sepia },
  chipIcon: { fontSize: 16, marginBottom: 3 },
  chipLabel: { fontSize: 11, color: MemoryColors.cairnPublic },
  chipLabelActive: { color: MemoryColors.sepia, fontWeight: '500' },
  primary: {
    backgroundColor: MemoryColors.sepia,
    padding: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  primaryDisabled: { opacity: 0.4 },
  primaryText: { color: '#fff', fontSize: 14, fontWeight: '500' },
  back: { padding: 14, alignItems: 'center' },
  backText: { fontSize: 13, color: MemoryColors.cairnPublic },
});
