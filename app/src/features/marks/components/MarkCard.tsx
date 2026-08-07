/**
 * MarkCard â€” shared list card for a mark.
 *
 * R114 (2026-08-07): extracted from RoutesScreen FlagsTab renderItem so
 * every mark-list surface (Routes FlagsTab, future search/friend-view)
 * renders with identical layout, splitTitleBody discipline, tokens.
 *
 * Design doc: docs/design/r114-mark-redesign.md Â§9.
 *
 * Layout:
 *   â”Œâ”€â”€â”  Title (bold, 1 line)                            [â†’]
 *   â”‚ðŸ“›â”‚  Body preview (2 lines, ellipsized)
 *   â””â”€â”€â”˜  ðŸ  Hut Â· 1.2 km Â· ðŸ”’
 *
 * Data source (single source of truth):
 *   - MARKER_META (data/mockData) â€” icon/color/label/bg per type
 *   - splitTitleBody (features/plant/services/noteEncoding) â€” decodes
 *     the U+001E wire format. No component that renders marker.note
 *     may skip this â€” R114 Â§11 invariant.
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Colors, Spacing, Radius, FontSize, Shadow } from '../../../components/tokens';
import { Icon, type IconName } from '../../../components/Icon';
import { PressBtn } from '../../../components/PressBtn';
import { MARKER_META } from '../../../data/mockData';
import type { Marker, MarkerPermission } from '../../../store/useMarkerStore';
import { splitTitleBody } from '../../plant/services/noteEncoding';

interface Props {
  marker: Marker;
  /** Pre-formatted distance string (e.g. "1.2 km"); empty string = no distance shown. */
  distance?: string;
  onPress: () => void;
}

export function MarkCard({ marker, distance, onPress }: Props) {
  const meta = MARKER_META[marker.type] || MARKER_META.free;
  const perm = (marker.permission ?? 'personal') as MarkerPermission;
  const permIcon: IconName = perm === 'public' ? 'Globe' : perm === 'group' ? 'Users' : 'Lock';
  const permColor =
    perm === 'personal' ? Colors.textMuted :
    perm === 'group'    ? Colors.info :
                          Colors.success;

  // R114 §11 invariant: splitTitleBody before display.
  const { title, body } = splitTitleBody(marker.note || '');
  // R114 §9.4: title fallback rules — never leak "No note yet" when body has content;
  // never leak U+001E; match MarkerDetailScreen.titleEmpty copy ("Untitled cairn").
  const titleFallback = !title && !body;
  const displayTitle = title
    ? title
    : (body ? body.slice(0, 30) : 'Untitled cairn');
  const typeIcon: IconName = ((meta as any).iconName as IconName) ?? 'Flag';

  return (
    <PressBtn
      style={[styles.card, { borderLeftColor: meta.color }]}
      onPress={onPress}
      scaleTo={0.97}
    >
      <View style={[styles.badge, { backgroundColor: meta.bg }]}>
        <Icon name={typeIcon} size={18} color={meta.color} strokeWidth={2} />
      </View>
      <View style={{ flex: 1 }}>
        <View style={styles.titleRow}>
          <Text
            style={[styles.title, titleFallback && styles.titleEmpty]}
            numberOfLines={1}
            ellipsizeMode="tail"
          >
            {displayTitle}
          </Text>
          {marker.approximate && (
            <View style={styles.approxChip}>
              <Text style={styles.approxChipText}>~</Text>
            </View>
          )}
        </View>
        {body ? (
          <Text style={styles.notePreview} numberOfLines={2} ellipsizeMode="tail">
            {body}
          </Text>
        ) : null}
        <Text style={[styles.metaLabel, { color: meta.color }]}>{meta.label}</Text>
      </View>
      {distance ? <Text style={styles.distance}>{distance}</Text> : null}
      <Icon name={permIcon} size={12} color={permColor} strokeWidth={1.8} />
      <Icon name="ChevronRight" size={14} color={Colors.textMuted} strokeWidth={2} />
    </PressBtn>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: 'rgba(255,255,255,0.90)',
    borderRadius: Radius.card,
    flexDirection: 'row',
    alignItems: 'center',
    padding: Spacing.base,
    gap: Spacing.md,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.4)',
    borderLeftWidth: 3,
    borderLeftColor: 'transparent',
    ...Shadow.card,
  },
  badge: {
    width: 40, height: 40, borderRadius: 20,
    alignItems: 'center', justifyContent: 'center',
    flexShrink: 0,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  title: {
    fontSize: FontSize.body,
    fontWeight: '600',
    color: Colors.textPrimary,
    flexShrink: 1,
  },
  titleEmpty: {
    fontStyle: 'italic',
    color: Colors.textMuted,
    fontWeight: '400',
  },
  notePreview: {
    fontSize: FontSize.small,
    color: Colors.textSecondary,
    marginTop: 2,
    lineHeight: 18,
  },
  metaLabel: {
    fontSize: FontSize.small,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  distance: {
    fontSize: FontSize.small,
    fontWeight: '600',
    color: Colors.textSecondary,
    marginRight: 2,
  },
  approxChip: {
    width: 16, height: 16, borderRadius: 8,
    backgroundColor: Colors.severityCaution,
    alignItems: 'center', justifyContent: 'center',
  },
  approxChipText: { fontSize: 10, fontWeight: '800', color: '#fff' },
});
