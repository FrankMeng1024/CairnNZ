/**
 * EditOverlayV236 — the entire route-edit interaction surface.
 *
 * Mounted by RouteEditorScreen when `dualEditActive` is true. Replaces the
 * v229–v235 EditableNodeLayer + DraggableHandle stack with the via-point +
 * trim-slider model.
 *
 * Sprint 67 v237 — UI tokens + EN-only copy pass.
 */

import React from 'react';
import { View, Text, StyleSheet, ActivityIndicator, TouchableOpacity, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { TrimSlider } from './TrimSlider';
import { useRouteEditStore } from '../../store/useRouteEditStore';
import { polylineLengthM } from '../../services/routing/corridor/PolylineSampler';
import { Colors, Spacing, Radius, FontSize } from '../tokens';

interface EditOverlayV236Props {
  onCancel: () => void;
  onSave: () => Promise<void> | void;
}

export function EditOverlayV236({ onCancel, onSave }: EditOverlayV236Props): React.JSX.Element {
  const insets = useSafeAreaInsets();
  const isComputing = useRouteEditStore(s => s.isComputing);
  const lastError = useRouteEditStore(s => s.lastError);
  const lastWarning = useRouteEditStore(s => s.lastWarning);
  const matchedPoints = useRouteEditStore(s => s.matchedPoints);
  const trimStartFrac = useRouteEditStore(s => s.trimStartFrac);
  const trimEndFrac = useRouteEditStore(s => s.trimEndFrac);
  const viaCount = useRouteEditStore(s => s.viaPoints.length);
  const setLastError = useRouteEditStore(s => s.setLastError);
  const setTrimStart = useRouteEditStore(s => s.setTrimStart);
  const setTrimEnd = useRouteEditStore(s => s.setTrimEnd);
  const resetEdits = useRouteEditStore(s => s.resetEdits);

  const totalLengthM = polylineLengthM(matchedPoints);

  return (
    <View pointerEvents="box-none" style={styles.container}>
      <View style={[styles.topBar, { paddingTop: insets.top + Spacing.sm + 2 }]} pointerEvents="auto">
        <TouchableOpacity onPress={onCancel} style={styles.topBtn}>
          <Text style={styles.topBtnText}>Cancel</Text>
        </TouchableOpacity>
        <View style={styles.topCenter}>
          {isComputing ? (
            <View style={styles.computingRow}>
              <ActivityIndicator size="small" color={Colors.primary} />
              <Text style={styles.computingText}>Computing…</Text>
            </View>
          ) : (
            <Text style={styles.statusText}>
              {viaCount}/5 detour points · long-press map to add
            </Text>
          )}
        </View>
        <TouchableOpacity
          onPress={() => {
            if (isComputing) return;
            onSave();
          }}
          disabled={isComputing}
          style={[styles.topBtn, styles.saveBtn, isComputing && styles.saveBtnDisabled]}
        >
          <Text style={[styles.topBtnText, styles.saveBtnText]}>Save</Text>
        </TouchableOpacity>
      </View>

      {(lastError || lastWarning) && (
        <View style={styles.bannerContainer} pointerEvents="auto">
          {lastError && (
            <TouchableOpacity
              style={[styles.banner, styles.errorBanner]}
              onPress={() => setLastError(null)}
              activeOpacity={0.85}
            >
              <Text style={styles.bannerText}>{lastError}</Text>
              <Text style={styles.bannerDismiss}>×</Text>
            </TouchableOpacity>
          )}
          {lastWarning && !lastError && (
            <View style={[styles.banner, styles.warningBanner]}>
              <Text style={styles.bannerText}>{lastWarning}</Text>
            </View>
          )}
        </View>
      )}

      <View style={styles.bottomZone} pointerEvents="auto">
        <View style={styles.bottomActions}>
          <TouchableOpacity
            onPress={() => {
              Alert.alert(
                'Reset edits?',
                'All detour points and trim adjustments will be cleared.',
                [
                  { text: 'Cancel', style: 'cancel' },
                  { text: 'Reset', style: 'destructive', onPress: () => resetEdits() },
                ],
              );
            }}
            style={styles.resetBtn}
          >
            <Text style={styles.resetBtnText}>Reset</Text>
          </TouchableOpacity>
        </View>
        <TrimSlider
          trimStartFrac={trimStartFrac}
          trimEndFrac={trimEndFrac}
          onTrimStartChange={setTrimStart}
          onTrimEndChange={setTrimEnd}
          totalLengthM={totalLengthM}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'space-between',
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.md,
    paddingBottom: Spacing.sm + 2,
    backgroundColor: Colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  topBtn: {
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.base,
    borderRadius: Radius.button,
    backgroundColor: Colors.bg,
  },
  topBtnText: {
    fontSize: FontSize.body,
    color: Colors.textPrimary,
    fontWeight: '500',
  },
  saveBtn: {
    backgroundColor: Colors.primary,
  },
  saveBtnDisabled: {
    opacity: 0.5,
  },
  saveBtnText: {
    color: Colors.surface,
    fontWeight: '600',
  },
  topCenter: {
    flex: 1,
    alignItems: 'center',
  },
  computingRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  computingText: {
    marginLeft: Spacing.sm,
    fontSize: FontSize.caption,
    color: Colors.textSecondary,
  },
  statusText: {
    fontSize: FontSize.caption,
    color: Colors.textSecondary,
  },
  bannerContainer: {
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.sm,
  },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: Spacing.md,
    borderRadius: Radius.button,
    marginBottom: Spacing.xs + 2,
  },
  errorBanner: {
    backgroundColor: Colors.dangerBg,
    borderWidth: 1,
    borderColor: Colors.danger,
  },
  warningBanner: {
    backgroundColor: Colors.warningBg,
    borderWidth: 1,
    borderColor: Colors.warning,
  },
  bannerText: {
    flex: 1,
    fontSize: FontSize.caption,
    color: Colors.textPrimary,
  },
  bannerDismiss: {
    fontSize: FontSize.h3,
    color: Colors.textSecondary,
    paddingLeft: Spacing.sm,
  },
  bottomZone: {
    backgroundColor: 'transparent',
  },
  bottomActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingHorizontal: Spacing.md,
    paddingBottom: Spacing.xs + 2,
  },
  resetBtn: {
    paddingVertical: Spacing.xs + 2,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.button - 4,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  resetBtnText: {
    fontSize: FontSize.caption,
    color: Colors.textSecondary,
  },
});
