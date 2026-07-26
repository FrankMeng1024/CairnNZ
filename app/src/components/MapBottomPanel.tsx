/**
 * MapBottomPanel — Three-state bottom panel (peek/half/full) with glass effect.
 * Uses @gorhom/bottom-sheet for robust gesture handling.
 *
 * Sprint 43 — STORY-00144
 */
import React, { useCallback, useMemo, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, FlatList } from 'react-native';
import { Colors, Spacing, FontSize, Radius } from './tokens';
import { Icon } from './Icon';
import type { IconName } from './Icon';
import { GlassPanel } from './GlassPanel';

// @gorhom/bottom-sheet — conditional import for graceful fallback
let BottomSheet: any = null;
let BottomSheetFlatList: any = null;
try {
  const BS = require('@gorhom/bottom-sheet');
  BottomSheet = BS.default;
  BottomSheetFlatList = BS.BottomSheetFlatList;
} catch {
  // Not available — use fallback
}

import { MarkerType } from '../config/markerTypes';

export interface PanelMarkerItem {
  id: string;
  type: MarkerType;
  title: string;
  distance: string; // e.g. "120m"
  timeAgo: string;  // e.g. "2h ago"
}

interface Props {
  markers: PanelMarkerItem[];
  onMarkerPress?: (id: string) => void;
  onOfflinePress?: () => void;
}

const MARKER_ICONS: Record<string, { icon: IconName; color: string; bg: string }> = {
  danger:   { icon: 'TriangleAlert', color: Colors.danger,  bg: Colors.dangerBg },
  scenic:   { icon: 'Star',          color: Colors.info,    bg: Colors.infoBg },
  supply:   { icon: 'Droplets',      color: Colors.success, bg: Colors.successBg },
  junction: { icon: 'Navigation2',   color: Colors.docOrange, bg: Colors.severityWarningBg },
  free:     { icon: 'MessageCircle', color: Colors.textSecondary, bg: Colors.surface },
};

export function MapBottomPanel({ markers, onMarkerPress, onOfflinePress }: Props) {
  const bottomSheetRef = useRef<any>(null);

  // Snap points: peek (80px), half (45%), full (85%)
  const snapPoints = useMemo(() => [80, '45%', '85%'], []);

  const renderMarkerItem = useCallback(({ item }: { item: PanelMarkerItem }) => {
    const meta = MARKER_ICONS[item.type] || MARKER_ICONS.free;
    return (
      <TouchableOpacity
        style={styles.markerRow}
        onPress={() => onMarkerPress?.(item.id)}
        activeOpacity={0.7}
      >
        <View style={[styles.markerIcon, { backgroundColor: meta.bg }]}>
          <Icon name={meta.icon} size={16} color={meta.color} strokeWidth={2} />
        </View>
        <View style={styles.markerInfo}>
          <Text style={styles.markerTitle} numberOfLines={1}>{item.title}</Text>
          <Text style={styles.markerMeta}>{item.distance} · {item.timeAgo}</Text>
        </View>
        <Icon name="ChevronRight" size={16} color={Colors.textMuted} />
      </TouchableOpacity>
    );
  }, [onMarkerPress]);

  // Fallback when @gorhom/bottom-sheet not available
  if (!BottomSheet) {
    return (
      <View style={styles.fallbackPanel}>
        <GlassPanel intensity={16} tint="light" style={styles.fallbackInner} borderRadius={20}>
          <View style={styles.dragHandle} />
          <Text style={styles.peekText}>
            {markers.length} markers nearby
          </Text>
        </GlassPanel>
      </View>
    );
  }

  return (
    <BottomSheet
      ref={bottomSheetRef}
      index={0}
      snapPoints={snapPoints}
      backgroundStyle={styles.sheetBackground}
      handleIndicatorStyle={styles.handleIndicator}
      enablePanDownToClose={false}
    >
      {/* Peek content */}
      <View style={styles.peekRow}>
        <Text style={styles.peekText}>
          {markers.length} marker{markers.length !== 1 ? 's' : ''} nearby
        </Text>
        {onOfflinePress && (
          <TouchableOpacity style={styles.offlineBtn} onPress={onOfflinePress}>
            <Icon name="Download" size={14} color={Colors.primary} />
            <Text style={styles.offlineBtnText}>Offline</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Half/Full content — marker list */}
      {BottomSheetFlatList ? (
        <BottomSheetFlatList
          data={markers}
          keyExtractor={(item: PanelMarkerItem) => item.id}
          renderItem={renderMarkerItem}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
        />
      ) : (
        <FlatList
          data={markers}
          keyExtractor={item => item.id}
          renderItem={renderMarkerItem}
          contentContainerStyle={styles.listContent}
        />
      )}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  sheetBackground: {
    backgroundColor: 'rgba(250, 247, 242, 0.85)',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
  },
  handleIndicator: {
    backgroundColor: Colors.border,
    width: 36,
    height: 4,
  },
  peekRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
  },
  peekText: {
    fontSize: FontSize.caption,
    fontWeight: '600',
    color: Colors.textSecondary,
  },
  offlineBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
    borderRadius: Radius.pill,
    backgroundColor: Colors.primaryBg,
  },
  offlineBtnText: {
    fontSize: FontSize.small,
    fontWeight: '600',
    color: Colors.primary,
  },
  listContent: {
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.xl,
    gap: Spacing.xs,
  },
  markerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.sm,
    borderRadius: Radius.card,
  },
  markerIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  markerInfo: { flex: 1 },
  markerTitle: {
    fontSize: FontSize.body,
    fontWeight: '500',
    color: Colors.textPrimary,
  },
  markerMeta: {
    fontSize: FontSize.small,
    color: Colors.textMuted,
    marginTop: 2,
  },
  // Fallback
  fallbackPanel: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
  },
  fallbackInner: {
    padding: Spacing.md,
    paddingBottom: Spacing.xl,
  },
  dragHandle: {
    width: 36,
    height: 4,
    backgroundColor: Colors.border,
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: Spacing.sm,
  },
});
