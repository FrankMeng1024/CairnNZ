/**
 * EditOverlayV236 — the entire route-edit interaction surface.
 *
 * v240 layout overhaul: top stays minimal (just the back button is rendered
 * by the parent screen — we don't paint the top bar). All edit controls
 * (Cancel / status pill / Save / TrimSlider / Reset) live in a rounded
 * white card at the bottom, matching Activity detail + save-as-route
 * visual standard.
 *
 * Sprint 67 v240.
 */

import React from 'react';
import { View, Text, StyleSheet, ActivityIndicator, TouchableOpacity, Alert, KeyboardAvoidingView, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { TrimSlider } from './TrimSlider';
import { useRouteEditStore } from '../../store/useRouteEditStore';
import { polylineLengthM } from '../../services/routing/corridor/PolylineSampler';
import { Colors, Spacing, Radius, FontSize, Shadow } from '../tokens';
import { Icon } from '../Icon';

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
  const editedLengthM = totalLengthM * (trimEndFrac - trimStartFrac);

  return (
    <View pointerEvents="box-none" style={styles.container}>
      {/* Banner zone — hovers above the bottom card so it doesn't push it. */}
      {(lastError || lastWarning) && (
        <View
          style={[styles.bannerContainer, { top: insets.top + 64 }]}
          pointerEvents="auto"
        >
          {lastError && (
            <TouchableOpacity
              style={[styles.banner, styles.errorBanner]}
              onPress={() => setLastError(null)}
              activeOpacity={0.85}
            >
              <Icon name="TriangleAlert" size={14} color={Colors.danger} strokeWidth={2} />
              <Text style={styles.bannerText} numberOfLines={2}>{lastError}</Text>
              <Text style={styles.bannerDismiss}>×</Text>
            </TouchableOpacity>
          )}
          {lastWarning && !lastError && (
            <View style={[styles.banner, styles.warningBanner]}>
              <Icon name="TriangleAlert" size={14} color={Colors.severityCaution} strokeWidth={2} />
              <Text style={styles.bannerText} numberOfLines={2}>{lastWarning}</Text>
            </View>
          )}
        </View>
      )}

      {/* Bottom card — rounded white panel, matches view-mode bottomPanel */}
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.bottomWrap}
        pointerEvents="box-none"
      >
        <View
          style={[styles.bottomPanel, { paddingBottom: insets.bottom + Spacing.md }]}
          pointerEvents="auto"
        >
          {/* Status pill — N/5 detour points + computing indicator */}
          <View style={styles.statusRow}>
            {isComputing ? (
              <View style={styles.statusPill}>
                <ActivityIndicator size="small" color={Colors.primary} />
                <Text style={styles.statusText}>Computing…</Text>
              </View>
            ) : (
              <View style={styles.statusPill}>
                <Icon name="MapPin" size={14} color={Colors.flag} strokeWidth={2} />
                <Text style={styles.statusText}>
                  {viaCount}/5 detour points
                </Text>
              </View>
            )}
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
              activeOpacity={0.85}
            >
              <Icon name="RotateCcw" size={14} color={Colors.textSecondary} strokeWidth={2} />
              <Text style={styles.resetBtnText}>Reset</Text>
            </TouchableOpacity>
          </View>

          {/* Hint text — only when no detour yet */}
          {viaCount === 0 && !isComputing && (
            <Text style={styles.hintText}>
              Long-press the map to add a detour point, or drag the slider to trim.
            </Text>
          )}

          {/* Trim slider */}
          <TrimSlider
            trimStartFrac={trimStartFrac}
            trimEndFrac={trimEndFrac}
            onTrimStartChange={setTrimStart}
            onTrimEndChange={setTrimEnd}
            totalLengthM={totalLengthM}
          />

          {/* Length readout — only when user has actually trimmed */}
          {totalLengthM > 0 && (trimStartFrac > 0 || trimEndFrac < 1) && (
            <Text style={styles.lengthReadout}>
              Trimmed: {(editedLengthM / 1000).toFixed(2)} km / {(totalLengthM / 1000).toFixed(2)} km
            </Text>
          )}

          {/* Action row — Cancel + Save (Activity-detail-style) */}
          <View style={styles.actionRow}>
            <TouchableOpacity
              onPress={onCancel}
              style={[styles.actionBtn, styles.cancelBtn]}
              activeOpacity={0.85}
            >
              <Icon name="X" size={16} color={Colors.textPrimary} strokeWidth={2.5} />
              <Text style={styles.cancelBtnText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => {
                if (isComputing) return;
                onSave();
              }}
              disabled={isComputing}
              style={[styles.actionBtn, styles.saveBtn, isComputing && styles.saveBtnDisabled]}
              activeOpacity={0.85}
            >
              <Icon name="Check" size={16} color={Colors.surface} strokeWidth={2.5} />
              <Text style={styles.saveBtnText}>Save</Text>
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
  },
  bannerContainer: {
    position: 'absolute',
    left: Spacing.md,
    right: Spacing.md,
  },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    padding: Spacing.md,
    borderRadius: Radius.button,
    marginBottom: Spacing.xs + 2,
    ...Shadow.card,
  },
  errorBanner: {
    backgroundColor: Colors.dangerBg,
    borderWidth: 1,
    borderColor: Colors.danger,
  },
  warningBanner: {
    backgroundColor: Colors.severityCautionBg,
    borderWidth: 1,
    borderColor: Colors.severityCaution,
  },
  bannerText: {
    flex: 1,
    fontSize: FontSize.small,
    color: Colors.textPrimary,
    fontWeight: '600',
  },
  bannerDismiss: {
    fontSize: FontSize.h3,
    color: Colors.textSecondary,
    paddingLeft: Spacing.sm,
  },

  bottomWrap: {
    position: 'absolute',
    left: 0, right: 0, bottom: 0,
  },
  bottomPanel: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: Radius.sheet,
    borderTopRightRadius: Radius.sheet,
    paddingHorizontal: Spacing.base,
    paddingTop: Spacing.md,
    ...Shadow.elevated,
  },

  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: Spacing.sm,
  },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: Spacing.md,
    paddingVertical: 6,
    borderRadius: Radius.pill,
    backgroundColor: Colors.primaryBg,
  },
  statusText: {
    fontSize: FontSize.small,
    fontWeight: '600',
    color: Colors.textPrimary,
  },
  resetBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: Spacing.md,
    paddingVertical: 6,
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  resetBtnText: {
    fontSize: FontSize.small,
    color: Colors.textSecondary,
    fontWeight: '600',
  },
  hintText: {
    fontSize: FontSize.caption,
    color: Colors.textSecondary,
    marginBottom: Spacing.sm,
    paddingHorizontal: Spacing.xs,
  },
  lengthReadout: {
    fontSize: FontSize.small,
    color: Colors.textSecondary,
    fontWeight: '600',
    textAlign: 'center',
    marginTop: Spacing.xs,
    marginBottom: Spacing.sm,
  },

  actionRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
    marginTop: Spacing.sm,
  },
  actionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: Spacing.md,
    borderRadius: Radius.button,
  },
  // Cancel — same shape as view-mode Delete (white surface + border + colored text)
  cancelBtn: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  cancelBtnText: {
    color: Colors.textPrimary,
    fontSize: FontSize.body,
    fontWeight: '700',
  },
  // Save — same shape as view-mode Edit (sage primary + white text)
  saveBtn: {
    backgroundColor: Colors.primary,
  },
  saveBtnDisabled: {
    opacity: 0.5,
  },
  saveBtnText: {
    color: Colors.surface,
    fontSize: FontSize.body,
    fontWeight: '700',
  },
});
