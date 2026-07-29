/**
 * MarkerDetailSheet — bottom sheet shown when user taps a planted flag.
 *
 * Extracted from HikingScreen.tsx (O1 batch 21 refactor).
 * Shows flag type, note, voice memo controls, metadata, and delete action.
 */
import React, { useState, useRef, useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Alert, Animated, Easing,
} from 'react-native';
import { Colors, Spacing, Radius, FontSize, Shadow, IconSize } from '../components/tokens';
import { Icon, type IconName } from '../components/Icon';
import { MARKER_META } from '../data/mockData';
import { haversineM } from '../utils/geo';
import { useDistance } from '../utils/distanceFormat';
import type { Marker } from '../store/useMarkerStore';
import type { MarkerType } from '../data/mockData';

type FlagTypeEntry = {
  id: MarkerType;
  icon: IconName;
  label: string;
  color: string;
  bg: string;
};

type Props = {
  marker: Marker;
  onClose: () => void;
  onDelete: () => void;
  /** O18 MARK-02: optional handler to jump into the full MarkerDetailScreen
   *  for editing. Sheet stays as the quick-view surface; the Screen owns
   *  edit/permission/snapshot. Providing this prop reveals a "See details"
   *  affordance so users know they can go deeper. */
  onOpenDetail?: () => void;
  lastCoordinate: { lat: number; lng: number } | null;
  flagTypes: FlagTypeEntry[];
};

export function MarkerDetailSheet({ marker, onClose, onDelete, onOpenDetail, lastCoordinate, flagTypes }: Props) {
  const meta = MARKER_META[marker.type] || MARKER_META.free;
  const flagType = flagTypes.find(f => f.id === marker.type);
  // O12: settings-aware short-distance format (m/ft near, km/mi far).
  const dist = useDistance();
  const timeAgo = (() => {
    const diffMs = Date.now() - marker.createdAt;
    const mins = Math.floor(diffMs / 60000);
    if (mins < 1) return 'Just now';
    if (mins < 60) return `${mins}m ago`;
    return `${Math.floor(mins / 60)}h ago`;
  })();

  const coordStr = `${marker.lat.toFixed(5)}, ${marker.lng.toFixed(5)}`;
  const distToMarker = lastCoordinate
    ? haversineM(lastCoordinate, { lat: marker.lat, lng: marker.lng })
    : null;
  const distStr = distToMarker != null
    ? `${dist.formatShort(distToMarker)} away`
    : '--';

  // Slide-in animation — O18 CROSS-04: unified translateY=300 across all sheets.
  const slideY = useRef(new Animated.Value(300)).current;
  const opacity = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.parallel([
      Animated.timing(slideY, { toValue: 0, duration: 280, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.timing(opacity, { toValue: 1, duration: 220, easing: Easing.out(Easing.ease), useNativeDriver: true }),
    ]).start();
  }, []);

  const [deleteConfirm, setDeleteConfirm] = useState(false);

  const handleClose = () => {
    setDeleteConfirm(false);
    Animated.parallel([
      Animated.timing(slideY, { toValue: 300, duration: 220, easing: Easing.in(Easing.quad), useNativeDriver: true }),
      Animated.timing(opacity, { toValue: 0, duration: 200, easing: Easing.in(Easing.ease), useNativeDriver: true }),
    ]).start(() => onClose());
  };

  const handleDelete = () => {
    if (!deleteConfirm) { setDeleteConfirm(true); return; }
    Animated.parallel([
      Animated.timing(slideY, { toValue: 300, duration: 220, easing: Easing.in(Easing.quad), useNativeDriver: true }),
      Animated.timing(opacity, { toValue: 0, duration: 200, easing: Easing.in(Easing.ease), useNativeDriver: true }),
    ]).start(() => onDelete());
  };

  return (
    <Animated.View style={[detailStyles.container, { opacity }]}>
      <TouchableOpacity style={StyleSheet.absoluteFillObject} onPress={handleClose} activeOpacity={1} />
      <Animated.View style={[detailStyles.sheet, { transform: [{ translateY: slideY }] }]}>
        <View style={detailStyles.handle} />
        <View style={detailStyles.headerRow}>
          <View style={detailStyles.headerLeft}>
            <View style={[detailStyles.typeBadge, { backgroundColor: meta.bg, borderColor: meta.color }]}>
              {flagType && <Icon name={flagType.icon} size={14} color={meta.color} strokeWidth={2.5} />}
              <Text style={[detailStyles.typeLabel, { color: meta.color }]}>{meta.label}</Text>
            </View>
            {/* O18 MARK-02: permission chip parity with MarkerDetailScreen. */}
            <View style={detailStyles.permChip}>
              <Icon
                name={marker.permission === 'personal' ? 'Lock' : marker.permission === 'group' ? 'Users' : 'Globe'}
                size={11}
                color={Colors.textSecondary}
                strokeWidth={2}
              />
              <Text style={detailStyles.permText}>
                {marker.permission === 'personal' ? 'Just me' : marker.permission === 'group' ? 'Friends' : 'Public'}
              </Text>
            </View>
          </View>
          <TouchableOpacity style={detailStyles.closeChip} onPress={handleClose} hitSlop={10} accessibilityLabel="Close">
            <Icon name="X" size={IconSize.sm} color={Colors.textSecondary} strokeWidth={2.5} />
          </TouchableOpacity>
        </View>
        {marker.note ? (
          <Text style={detailStyles.note} numberOfLines={3}>{marker.note}</Text>
        ) : (
          <Text style={[detailStyles.note, { color: Colors.textMuted, fontStyle: 'italic' }]}>No note yet</Text>
        )}
        <View style={detailStyles.metaRow}>
          <Icon name="Timer" size={IconSize.sm} color={Colors.textMuted} strokeWidth={1.8} />
          <Text style={detailStyles.meta}>{timeAgo}</Text>
        </View>
        <View style={detailStyles.metaRow}>
          <Icon name="MapPin" size={IconSize.sm} color={Colors.textMuted} strokeWidth={1.8} />
          <Text style={detailStyles.meta}>{coordStr}</Text>
        </View>
        <View style={detailStyles.metaRow}>
          <Icon name="Route" size={IconSize.sm} color={Colors.textMuted} strokeWidth={1.8} />
          <Text style={detailStyles.meta}>{distStr}</Text>
        </View>
        {marker.approximate && (
          <View style={[detailStyles.metaRow, { backgroundColor: Colors.severityCautionBg, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4 }]}>
            <Icon name="Info" size={IconSize.sm} color={Colors.severityCaution} strokeWidth={1.8} />
            <Text style={[detailStyles.meta, { color: Colors.severityCaution }]}>
              Approximate position{marker.gpsAgeS != null && marker.gpsAgeS > 0
                ? ` (GPS was ${marker.gpsAgeS < 60 ? `${marker.gpsAgeS}s` : `${Math.round(marker.gpsAgeS / 60)}min`} old)`
                : ''}
            </Text>
          </View>
        )}
        <TouchableOpacity
          style={[detailStyles.deleteBtn, deleteConfirm && { backgroundColor: Colors.danger }]}
          onPress={handleDelete}
        >
          <Icon name="Trash2" size={IconSize.sm} color={deleteConfirm ? '#fff' : Colors.danger} strokeWidth={2} />
          <Text style={[detailStyles.deleteBtnText, deleteConfirm && { color: '#fff' }]}>{deleteConfirm ? 'Confirm Delete' : 'Delete Cairn'}</Text>
        </TouchableOpacity>
        {/* O18 MARK-02: See details → jumps to MarkerDetailScreen for edit /
            snapshot management. Sheet stays as the quick-view surface. */}
        {onOpenDetail && (
          <TouchableOpacity
            style={detailStyles.detailsBtn}
            onPress={onOpenDetail}
            accessibilityRole="button"
            accessibilityLabel="See full details"
          >
            <Text style={detailStyles.detailsBtnText}>See details</Text>
            <Icon name="ChevronRight" size={16} color={Colors.primary} strokeWidth={2} />
          </TouchableOpacity>
        )}
      </Animated.View>
    </Animated.View>
  );
}

const detailStyles = StyleSheet.create({
  container: { ...StyleSheet.absoluteFillObject, justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: Radius.sheet, borderTopRightRadius: Radius.sheet,
    padding: Spacing.xl, paddingBottom: Spacing.xxl, gap: Spacing.sm,
    ...Shadow.overlay,
  },
  handle: {
    width: 40, height: 4, borderRadius: 2,
    backgroundColor: Colors.border, alignSelf: 'center', marginBottom: Spacing.sm,
  },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  // O18 MARK-02: left side of header now holds type + permission chips.
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1 },
  typeBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    alignSelf: 'flex-start', borderRadius: Radius.pill,
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.xs, borderWidth: 1.5,
  },
  typeLabel: { fontSize: FontSize.caption, fontWeight: '700' },
  // O18 MARK-02: permission chip parity with MarkerDetailScreen.
  permChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 8, paddingVertical: 3,
    borderRadius: Radius.pill,
    backgroundColor: Colors.surfaceMuted,
    borderWidth: 1, borderColor: Colors.border,
  },
  permText: { fontSize: FontSize.tiny, fontWeight: '600', color: Colors.textSecondary },
  closeChip: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: Colors.bg, alignItems: 'center', justifyContent: 'center',
  },
  note: { fontSize: FontSize.body, color: Colors.textSecondary, lineHeight: 22 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
  meta: { fontSize: FontSize.small, color: Colors.textMuted },
  deleteBtn: {
    marginTop: Spacing.xs, borderRadius: Radius.button, paddingVertical: Spacing.md,
    alignItems: 'center', borderWidth: 1.5, borderColor: Colors.danger + '50',
    backgroundColor: Colors.dangerBg,
    flexDirection: 'row', gap: Spacing.xs, justifyContent: 'center',
  },
  deleteBtnText: { color: Colors.danger, fontWeight: '600', fontSize: FontSize.body },
  // O18 MARK-02: See details link at the bottom of the sheet.
  detailsBtn: {
    marginTop: Spacing.xs,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 2,
    paddingVertical: Spacing.sm,
  },
  detailsBtnText: {
    color: Colors.primary,
    fontWeight: '600',
    fontSize: FontSize.body,
  },
});
