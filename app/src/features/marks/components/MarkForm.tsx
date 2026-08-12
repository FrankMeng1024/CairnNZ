/**
 * MarkForm — shared form for create + edit mark flows.
 *
 * R114 (2026-08-07): centerpiece of the Mark redesign. Every place a
 * user types a mark's content (ContentStep at plant time, MarkerDetail
 * edit mode) mounts THIS component with the same tokens, same field
 * labels, same layout. Solves Bug #1 (single-tone wash / no field
 * labels) and Bug #5 (Plant vs Detail visual mismatch) simultaneously.
 *
 * Design ref: docs/design/r114-mark-redesign.md §2
 */

import React from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, ScrollView } from 'react-native';
import { Colors, Spacing, Radius, FontSize } from '../../../components/tokens';
import { Icon, IconName } from '../../../components/Icon';
import { MARKER_TYPE_ORDER, MARKER_TYPES, MarkerType } from '../../../config/markerTypes';
import { MarkerPermission } from '../../../store/useMarkerStore';
import { haptic } from '../../../services/hapticService';
import { log } from '../../../services/appLog';

export interface MarkFormProps {
  // Values
  type: MarkerType;
  title: string;
  note: string;
  visibility: MarkerPermission;

  // Change handlers (controlled — parent owns state)
  onTypeChange: (t: MarkerType) => void;
  onTitleChange: (s: string) => void;
  onNoteChange: (s: string) => void;
  onVisibilityChange: (v: MarkerPermission) => void;

  // Mode & config
  mode: 'create' | 'edit';
  /** When true the Anyone chip is rendered but disabled (v1: public hidden). */
  disableVisibilityPublic?: boolean;
  /** Edit mode = true; create mode = false. */
  showLocationLockedNotice?: boolean;
  /** create mode: 'title'; edit mode: null. */
  autoFocus?: 'title' | 'note' | null;

  // Limits
  titleMaxChars?: number;
  noteMaxChars?: number;
}

const DEFAULT_TITLE_MAX = 30;
const DEFAULT_NOTE_MAX = 500;

export function MarkForm(props: MarkFormProps) {
  const {
    type, title, note, visibility,
    onTypeChange, onTitleChange, onNoteChange, onVisibilityChange,
    mode,
    disableVisibilityPublic = false,
    showLocationLockedNotice = false,
    autoFocus = null,
    titleMaxChars = DEFAULT_TITLE_MAX,
    noteMaxChars = DEFAULT_NOTE_MAX,
  } = props;

  // R114: char counter warning thresholds — 90% = warn tone, 100% = danger.
  const titleWarn = title.length >= Math.floor(titleMaxChars * 0.9);
  const titleDanger = title.length >= titleMaxChars;
  const noteWarn = note.length >= Math.floor(noteMaxChars * 0.9);
  const noteDanger = note.length >= noteMaxChars;

  return (
    <View>
      {/* TYPE row — R114/O24 (2026-08-12): horizontal scroll instead of
          wrap so chips stay on one line. Prior flexWrap caused the last
          chip to break to a second row on narrower phones.
          4-eyes review add-on: paddingRight=40 leaves the last visible
          chip peeking under the edge of the viewport so users see there
          is more to scroll — otherwise the row looked like a fixed set. */}
      <Text style={styles.fieldLabel}>Type</Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.typeRow}
      >
        {MARKER_TYPE_ORDER.map((t) => {
          const meta = MARKER_TYPES[t];
          const active = type === t;
          return (
            <TouchableOpacity
              key={t}
              style={[
                styles.typeChip,
                active && { backgroundColor: meta.bg, borderColor: meta.color },
              ]}
              onPress={() => {
                haptic.selection();
                log('mark.type_select', { type: t, mode });
                onTypeChange(t);
              }}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              accessibilityLabel={`Type ${meta.label}`}
            >
              <Icon
                name={meta.icon as IconName}
                size={16}
                color={active ? meta.color : Colors.textSecondary}
                strokeWidth={active ? 2.4 : 2}
              />
              <Text
                style={[
                  styles.typeChipLabel,
                  active && { color: meta.color, fontWeight: '600' },
                ]}
              >
                {meta.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {/* TITLE */}
      <Text style={styles.fieldLabel}>Title</Text>
      <TextInput
        style={styles.input}
        placeholder="What kind of mark is this?"
        placeholderTextColor={Colors.textMuted}
        maxLength={titleMaxChars}
        value={title}
        onChangeText={onTitleChange}
        returnKeyType="next"
        blurOnSubmit={false}
        autoFocus={autoFocus === 'title'}
        accessibilityLabel="Title"
      />
      {title.length > 0 ? (
        <Text
          style={[
            styles.charCounter,
            titleWarn && { color: Colors.warning },
            titleDanger && { color: Colors.danger },
          ]}
          accessibilityLiveRegion={titleWarn ? 'polite' : 'none'}
        >
          {title.length} / {titleMaxChars}
        </Text>
      ) : null}

      {/* NOTE */}
      <Text style={styles.fieldLabel}>Note</Text>
      <TextInput
        style={[styles.input, styles.textArea]}
        placeholder="Tell whoever finds this…"
        placeholderTextColor={Colors.textMuted}
        maxLength={noteMaxChars}
        value={note}
        onChangeText={onNoteChange}
        multiline
        textAlignVertical="top"
        returnKeyType="default"
        blurOnSubmit={false}
        autoFocus={autoFocus === 'note'}
        accessibilityLabel="Note"
      />
      {note.length > 0 ? (
        <Text
          style={[
            styles.charCounter,
            noteWarn && { color: Colors.warning },
            noteDanger && { color: Colors.danger },
          ]}
          accessibilityLiveRegion={noteWarn ? 'polite' : 'none'}
        >
          {note.length} / {noteMaxChars}
        </Text>
      ) : null}

      {/* WHO CAN SEE THIS */}
      <Text style={styles.fieldLabel}>Who can see this</Text>
      <View style={styles.visRow}>
        <VisChip
          label="Just me"
          iconName="Lock"
          active={visibility === 'personal'}
          activeTone="neutral"
          onPress={() => { haptic.selection(); onVisibilityChange('personal'); }}
        />
        <VisChip
          label="Friends"
          iconName="Users"
          active={visibility === 'group'}
          activeTone="primary"
          onPress={() => { haptic.selection(); onVisibilityChange('group'); }}
        />
        <VisChip
          label="Anyone"
          iconName="Globe"
          active={visibility === 'public'}
          activeTone="info"
          disabled={disableVisibilityPublic}
          onPress={() => { haptic.selection(); onVisibilityChange('public'); }}
        />
      </View>

      {/* LOCATION LOCKED — edit mode only. */}
      {showLocationLockedNotice ? (
        <View style={styles.lockedField}>
          <Icon name="Lock" size={12} color={Colors.textMuted} strokeWidth={2} />
          <Text style={styles.lockedFieldText}>
            Location is fixed where you planted it.
          </Text>
        </View>
      ) : null}
    </View>
  );
}

interface VisChipProps {
  label: string;
  iconName: IconName;
  active: boolean;
  activeTone: 'neutral' | 'primary' | 'info';
  disabled?: boolean;
  onPress: () => void;
}

function VisChip({ label, iconName, active, activeTone, disabled, onPress }: VisChipProps) {
  // R114: three tones so each visibility tier has a distinct active look.
  // Neutral = personal (grey), primary = friends (forest green), info = anyone (blue).
  const toneStyle =
    activeTone === 'neutral'
      ? { border: Colors.textSecondary, bg: 'rgba(140,126,114,0.10)', fg: Colors.textPrimary }
      : activeTone === 'primary'
      ? { border: Colors.primary, bg: Colors.primaryBg, fg: Colors.primary }
      : { border: Colors.info, bg: Colors.infoBg, fg: Colors.info };

  return (
    <TouchableOpacity
      style={[
        styles.visChip,
        active && { borderColor: toneStyle.border, backgroundColor: toneStyle.bg },
        disabled && styles.visChipDisabled,
      ]}
      onPress={disabled ? undefined : onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ selected: active, disabled: !!disabled }}
      accessibilityLabel={`Visibility ${label}${disabled ? ' (unavailable)' : ''}`}
    >
      <Icon
        name={iconName}
        size={14}
        color={active ? toneStyle.fg : Colors.textSecondary}
        strokeWidth={2}
      />
      <Text
        style={[
          styles.visChipLabel,
          active && { color: toneStyle.fg, fontWeight: '600' },
        ]}
      >
        {label}
      </Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  // R114/O24 (2026-08-12): field labels changed from ALL CAPS to sentence
  // case per user request — the aggressive uppercase felt out of place in
  // the app's warm typographic voice. Kept small + secondary color so
  // labels still recede visually below the input.
  fieldLabel: {
    fontSize: FontSize.small,           // 11
    fontWeight: '600',
    color: Colors.textSecondary,
    letterSpacing: 0.2,
    marginBottom: Spacing.xs,
    marginTop: Spacing.md,
  },
  // R114/O24 (2026-08-12): Type row — was flexWrap causing the 6th chip
  // to break to a new line. Switched to a horizontal ScrollView (see
  // MarkForm render) so chips stay on one row and the user can scroll.
  // 4-eyes review add-on: paddingRight=40 so the last-visible chip is
  // partially clipped, telling users "there's more →" visually.
  typeRow: {
    flexDirection: 'row',
    gap: 6,
    marginBottom: Spacing.xs,
    paddingRight: 40,
  },
  typeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 18,
  },
  typeChipLabel: {
    fontSize: FontSize.caption,        // 13
    color: Colors.textSecondary,
  },
  input: {
    minHeight: 44,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.button,
    paddingHorizontal: Spacing.md,
    paddingVertical: 10,
    fontSize: FontSize.body,           // 15
    color: Colors.textPrimary,
  },
  textArea: {
    minHeight: 120,
    paddingTop: 10,
  },
  charCounter: {
    fontSize: FontSize.small,          // 11
    color: Colors.textMuted,
    textAlign: 'right',
    marginTop: -2,
  },
  visRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  visChip: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.sm,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.button,
  },
  visChipDisabled: {
    opacity: 0.4,
  },
  visChipLabel: {
    fontSize: FontSize.caption,
    color: Colors.textSecondary,
  },
  lockedField: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.sm + Spacing.xs,
    backgroundColor: 'rgba(0,0,0,0.03)',
    borderRadius: Radius.sm,
    marginTop: Spacing.md,
  },
  lockedFieldText: {
    fontSize: FontSize.small,
    fontStyle: 'italic',
    color: Colors.textMuted,
  },
});
