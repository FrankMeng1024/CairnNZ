/**
 * RouteDrawingSheet — UI for creating routes by tapping points on the map.
 *
 * User taps on map → adds point to route → sees polyline preview.
 * Can add waypoints (with label), undo last point, save route.
 *
 * Sprint 46 — STORY-00153
 */
import React, { useState, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, TextInput, Alert } from 'react-native';
import * as Haptics from 'expo-haptics';
import { Colors, Spacing, Radius, FontSize } from './tokens';
import { Icon } from './Icon';
import { GlassPanel, Elevation } from './GlassPanel';
import { useRouteStore, type RoutePoint, type Waypoint } from '../store/useRouteStore';
import { haversineM, calculateElevationGain } from '../utils/geo';

interface Props {
  visible: boolean;
  onClose: () => void;
  /** Points added by user tapping map — parent passes these in */
  points: RoutePoint[];
  /** Callback when user taps "add point" mode toggle */
  onToggleDrawing: (active: boolean) => void;
  /** Remove last point */
  onUndoPoint: () => void;
  /** Clear all points */
  onClearPoints: () => void;
}

export function RouteDrawingSheet({
  visible, onClose, points, onToggleDrawing, onUndoPoint, onClearPoints,
}: Props) {
  const [name, setName] = useState('');
  const [isDrawing, setIsDrawing] = useState(false);
  const [waypoints, setWaypoints] = useState<Omit<Waypoint, 'id'>[]>([]);
  const addRoute = useRouteStore(s => s.addRoute);

  const totalDistanceM = calculateRouteDistance(points);
  const elevationGain = calculateElevationGain(points.map(p => p.alt ?? null));

  const handleToggleDrawing = useCallback(() => {
    const next = !isDrawing;
    setIsDrawing(next);
    onToggleDrawing(next);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, [isDrawing, onToggleDrawing]);

  const handleSave = useCallback(() => {
    if (points.length < 2) {
      Alert.alert('Too Few Points', 'A route needs at least 2 points.');
      return;
    }
    if (!name.trim()) {
      Alert.alert('Name Required', 'Give your route a name.');
      return;
    }

    addRoute({
      name: name.trim(),
      points,
      waypoints: waypoints.map(w => ({ ...w, id: '' })), // store generates IDs
      distanceM: totalDistanceM,
      elevationGainM: elevationGain,
    });

    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setName('');
    setWaypoints([]);
    onClearPoints();
    setIsDrawing(false);
    onToggleDrawing(false);
    onClose();
  }, [points, name, waypoints, totalDistanceM, elevationGain]);

  const handleAddWaypoint = useCallback(() => {
    if (points.length === 0) return;
    const lastPoint = points[points.length - 1];
    Alert.prompt?.(
      'Waypoint Label',
      'What should be announced when you reach this point?',
      (label) => {
        if (label) {
          setWaypoints(prev => [...prev, {
            lat: lastPoint.lat,
            lng: lastPoint.lng,
            label,
            announceOnArrival: true,
            radiusM: 30,
          }]);
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        }
      },
    );
  }, [points]);

  if (!visible) return null;

  return (
    <GlassPanel intensity={16} tint="light" style={styles.container} borderRadius={20}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>Create Route</Text>
        <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
          <Icon name="X" size={18} color={Colors.textSecondary} />
        </TouchableOpacity>
      </View>

      {/* Route name */}
      <TextInput
        style={styles.nameInput}
        placeholder="Route name..."
        placeholderTextColor={Colors.textMuted}
        value={name}
        onChangeText={setName}
        maxLength={50}
      />

      {/* Stats */}
      <View style={styles.statsRow}>
        <View style={styles.statItem}>
          <Text style={styles.statValue}>{points.length}</Text>
          <Text style={styles.statLabel}>points</Text>
        </View>
        <View style={styles.statItem}>
          <Text style={styles.statValue}>
            {totalDistanceM > 1000
              ? `${(totalDistanceM / 1000).toFixed(1)}km`
              : `${Math.round(totalDistanceM)}m`}
          </Text>
          <Text style={styles.statLabel}>distance</Text>
        </View>
        <View style={styles.statItem}>
          <Text style={styles.statValue}>{waypoints.length}</Text>
          <Text style={styles.statLabel}>waypoints</Text>
        </View>
      </View>

      {/* Actions */}
      <View style={styles.actionsRow}>
        <TouchableOpacity
          style={[styles.actionBtn, isDrawing && styles.actionBtnActive]}
          onPress={handleToggleDrawing}
        >
          <Icon name="Pencil" size={16} color={isDrawing ? '#fff' : Colors.primary} />
          <Text style={[styles.actionBtnText, isDrawing && styles.actionBtnTextActive]}>
            {isDrawing ? 'Drawing...' : 'Draw'}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.actionBtn} onPress={onUndoPoint} disabled={points.length === 0}>
          <Icon name="Undo2" size={16} color={points.length > 0 ? Colors.primary : Colors.textMuted} />
          <Text style={styles.actionBtnText}>Undo</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.actionBtn} onPress={handleAddWaypoint} disabled={points.length === 0}>
          <Icon name="MapPin" size={16} color={points.length > 0 ? Colors.docOrange : Colors.textMuted} />
          <Text style={styles.actionBtnText}>Waypoint</Text>
        </TouchableOpacity>
      </View>

      {/* Save */}
      <TouchableOpacity
        style={[styles.saveBtn, (points.length < 2 || !name.trim()) && styles.saveBtnDisabled]}
        onPress={handleSave}
        disabled={points.length < 2 || !name.trim()}
      >
        <Icon name="Check" size={18} color="#fff" />
        <Text style={styles.saveBtnText}>Save Route</Text>
      </TouchableOpacity>
    </GlassPanel>
  );
}

// ── Helper ──────────────────────────────────────────────────────────────────

function calculateRouteDistance(points: RoutePoint[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += haversineM(
      { lat: points[i - 1].lat, lng: points[i - 1].lng },
      { lat: points[i].lat, lng: points[i].lng },
    );
  }
  return total;
}

// ── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    bottom: 100,
    left: Spacing.md,
    right: Spacing.md,
    padding: Spacing.lg,
  },
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    marginBottom: Spacing.md,
  },
  title: { fontSize: FontSize.h3, fontWeight: '700', color: Colors.textPrimary },
  closeBtn: { padding: Spacing.xs },
  nameInput: {
    backgroundColor: Colors.bg, borderRadius: Radius.button,
    padding: Spacing.md, fontSize: FontSize.body, color: Colors.textPrimary,
    borderWidth: 1, borderColor: Colors.border, marginBottom: Spacing.md,
  },
  statsRow: {
    flexDirection: 'row', justifyContent: 'space-around', marginBottom: Spacing.md,
    paddingVertical: Spacing.sm, backgroundColor: Colors.bg, borderRadius: Radius.card,
  },
  statItem: { alignItems: 'center' },
  statValue: { fontSize: FontSize.h3, fontWeight: '700', color: Colors.textPrimary },
  statLabel: { fontSize: FontSize.tiny, color: Colors.textMuted, marginTop: 2 },
  actionsRow: {
    flexDirection: 'row', gap: Spacing.sm, marginBottom: Spacing.md,
  },
  actionBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 4, paddingVertical: Spacing.sm,
    borderRadius: Radius.button, borderWidth: 1.5, borderColor: Colors.primaryBg,
    backgroundColor: Colors.surface,
  },
  actionBtnActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  actionBtnText: { fontSize: FontSize.small, fontWeight: '600', color: Colors.primary },
  actionBtnTextActive: { color: '#fff' },
  saveBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.xs,
    paddingVertical: Spacing.md, borderRadius: Radius.button, backgroundColor: Colors.primary,
  },
  saveBtnDisabled: { backgroundColor: Colors.border },
  saveBtnText: { fontSize: FontSize.body, fontWeight: '700', color: '#fff' },
});
