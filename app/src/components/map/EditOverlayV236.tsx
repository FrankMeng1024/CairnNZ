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
  onPreview: () => Promise<void> | void;
}

export function EditOverlayV236({ onCancel, onSave, onPreview }: EditOverlayV236Props): React.JSX.Element {
  const insets = useSafeAreaInsets();
  const isComputing = useRouteEditStore(s => s.isComputing);
  const lastError = useRouteEditStore(s => s.lastError);
  const lastWarning = useRouteEditStore(s => s.lastWarning);
  const matchedPoints = useRouteEditStore(s => s.matchedPoints);
  const trimStartFrac = useRouteEditStore(s => s.trimStartFrac);
  const trimEndFrac = useRouteEditStore(s => s.trimEndFrac);
  const brushStrokes = useRouteEditStore(s => s.brushStrokes);
  const activeTool = useRouteEditStore(s => s.activeTool);
  const setActiveTool = useRouteEditStore(s => s.setActiveTool);
  const previewIsCurrent = useRouteEditStore(s => s.previewIsCurrent);
  const setLastError = useRouteEditStore(s => s.setLastError);
  const setTrimStart = useRouteEditStore(s => s.setTrimStart);
  const setTrimEnd = useRouteEditStore(s => s.setTrimEnd);
  const beginTrimDrag = useRouteEditStore(s => s.beginTrimDrag);
  const resetEdits = useRouteEditStore(s => s.resetEdits);
  const undo = useRouteEditStore(s => s.undo);
  const undoStackLen = useRouteEditStore(s => s.undoStack.length);
  const canUndo = undoStackLen > 0;

  const totalLengthM = polylineLengthM(matchedPoints);
  const editedLengthM = totalLengthM * (trimEndFrac - trimStartFrac);
  const strokeCount = brushStrokes.length;
  const needsPreview = strokeCount > 0 && !previewIsCurrent;
  const canSave = !isComputing && !needsPreview;
  const canPreview = !isComputing && strokeCount > 0 && !previewIsCurrent;

  return (
    <View pointerEvents="box-none" style={styles.container}>
      {/* v248: lastError no longer shown here. BrushOverlay renders the
          live "Brush must start on the route" / "Outside corridor" hints
          near the top of the map (pointerEvents=none, can't block draw).
          Showing the same error twice was confusing + the dismissible
          X let users get rid of context they should keep seeing. */}
      {/* v255: top warning banner removed. All error/warning text now
          appears in the bottom statusRow as a single coloured pill,
          per PO request "下面有提示的地方 那么所有报错在下方". */}

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
          {/* v248: tool strip moved from floating right toolbar into the
              bottom card (PO request — toolbar should not be on the right). */}
          <View style={styles.toolStrip}>
            <TouchableOpacity
              onPress={() => setActiveTool('pan')}
              style={[styles.toolBtn, activeTool === 'pan' && styles.toolBtnActive]}
              activeOpacity={0.85}
            >
              <Icon
                name="Navigation2"
                size={18}
                color={activeTool === 'pan' ? Colors.surface : Colors.textPrimary}
                strokeWidth={2.5}
              />
              <Text style={[styles.toolBtnText, activeTool === 'pan' && styles.toolBtnTextActive]}>Pan</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => setActiveTool('brush')}
              style={[styles.toolBtn, activeTool === 'brush' && styles.toolBtnActive]}
              activeOpacity={0.85}
            >
              <Icon
                name="Pencil"
                size={18}
                color={activeTool === 'brush' ? Colors.surface : Colors.textPrimary}
                strokeWidth={2.5}
              />
              <Text style={[styles.toolBtnText, activeTool === 'brush' && styles.toolBtnTextActive]}>Brush</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => setActiveTool('eraser')}
              style={[styles.toolBtn, activeTool === 'eraser' && styles.toolBtnActive]}
              activeOpacity={0.85}
            >
              <Icon
                name="Trash2"
                size={18}
                color={activeTool === 'eraser' ? Colors.surface : Colors.textPrimary}
                strokeWidth={2.5}
              />
              <Text style={[styles.toolBtnText, activeTool === 'eraser' && styles.toolBtnTextActive]}>Erase</Text>
            </TouchableOpacity>
          </View>

          {/* v255: status pill is now a 4-state slot:
              - isComputing → spinner + "Computing…"
              - lastError → red bg, white text (validation errors here,
                NOT in a top banner)
              - lastWarning → yellow bg, dark text (Mapbox snap kept raw)
              - default → sage bg + "N/8 brush strokes"
              All routed to one place per PO: "所有报错在下方 用红字即可". */}
          <View style={styles.statusRow}>
            {isComputing ? (
              <View style={styles.statusPill}>
                <ActivityIndicator size="small" color={Colors.primary} />
                <Text style={styles.statusText}>Computing…</Text>
              </View>
            ) : lastError ? (
              <View style={[styles.statusPill, styles.statusPillError]}>
                <Icon name="TriangleAlert" size={14} color={Colors.surface} strokeWidth={2} />
                <Text style={[styles.statusText, styles.statusTextError]} numberOfLines={2}>
                  {lastError}
                </Text>
              </View>
            ) : lastWarning ? (
              <View style={[styles.statusPill, styles.statusPillWarning]}>
                <Icon name="TriangleAlert" size={14} color={Colors.textPrimary} strokeWidth={2} />
                <Text style={[styles.statusText, styles.statusTextWarning]} numberOfLines={2}>
                  {lastWarning}
                </Text>
              </View>
            ) : (
              <View style={styles.statusPill}>
                <Icon name="Pencil" size={14} color={Colors.primary} strokeWidth={2} />
                <Text style={styles.statusText} numberOfLines={1}>
                  {`${strokeCount}/8 brush strokes`}
                </Text>
              </View>
            )}
            <View style={styles.statusActions}>
              <TouchableOpacity
                onPress={() => undo()}
                disabled={!canUndo}
                style={[styles.iconBtn, !canUndo && styles.iconBtnDisabled]}
                activeOpacity={0.85}
              >
                <Icon name="Undo2" size={14} color={canUndo ? Colors.textSecondary : Colors.textMuted} strokeWidth={2} />
                <Text style={[styles.iconBtnText, !canUndo && styles.iconBtnTextDisabled]}>Undo</Text>
              </TouchableOpacity>
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
                style={styles.iconBtn}
                activeOpacity={0.85}
              >
                <Icon name="RotateCcw" size={14} color={Colors.textSecondary} strokeWidth={2} />
                <Text style={styles.iconBtnText}>Reset</Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Hint text — only when no detour yet */}
          {strokeCount === 0 && !isComputing && (
            <Text style={styles.hintText}>
              Tap the pencil and draw a detour. Start and end on the route. Drag the slider to trim.
            </Text>
          )}

          {/* Trim slider */}
          <TrimSlider
            trimStartFrac={trimStartFrac}
            trimEndFrac={trimEndFrac}
            onTrimStartChange={setTrimStart}
            onTrimEndChange={setTrimEnd}
            onTrimDragBegin={beginTrimDrag}
            totalLengthM={totalLengthM}
          />

          {/* Length readout — only when user has actually trimmed */}
          {totalLengthM > 0 && (trimStartFrac > 0 || trimEndFrac < 1) && (
            <Text style={styles.lengthReadout}>
              Trimmed: {(editedLengthM / 1000).toFixed(2)} km / {(totalLengthM / 1000).toFixed(2)} km
            </Text>
          )}

          {/* Preview row — shown when there are brush strokes. Lets user
              see Mapbox snap result before committing. Save is disabled
              until preview reflects the latest strokes. */}
          {strokeCount > 0 && (
            <TouchableOpacity
              onPress={() => {
                if (!canPreview) return;
                onPreview();
              }}
              disabled={!canPreview}
              style={[
                styles.previewBtn,
                !canPreview && styles.previewBtnDisabled,
                previewIsCurrent && styles.previewBtnCurrent,
              ]}
              activeOpacity={0.85}
            >
              {isComputing ? (
                <ActivityIndicator size="small" color={Colors.primary} />
              ) : (
                <>
                  <Icon
                    name={previewIsCurrent ? 'Check' : 'Eye'}
                    size={16}
                    color={previewIsCurrent ? Colors.primary : Colors.primary}
                    strokeWidth={2.5}
                  />
                  <Text style={styles.previewBtnText}>
                    {previewIsCurrent ? 'Preview ready — tap Save to keep' : 'Preview snap'}
                  </Text>
                </>
              )}
            </TouchableOpacity>
          )}

          {/* Action row — v255 PO global rule: Cancel (left, destructive)
              + Save (right, positive). Prevents tap mistakes after a
              navigation transition. */}
          <View style={styles.actionRow}>
            <TouchableOpacity
              onPress={onCancel}
              style={[styles.actionBtn, styles.cancelBtn]}
              activeOpacity={0.85}
            >
              <Text style={styles.cancelBtnText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => {
                if (!canSave) return;
                onSave();
              }}
              disabled={!canSave}
              style={[styles.actionBtn, styles.saveBtn, !canSave && styles.saveBtnDisabled]}
              activeOpacity={0.85}
            >
              <Text style={styles.saveBtnText}>
                {needsPreview ? 'Preview first' : 'Done'}
              </Text>
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
    gap: Spacing.sm,
  },
  statusPill: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: Spacing.md,
    paddingVertical: 6,
    borderRadius: Radius.pill,
    backgroundColor: Colors.primaryBg,
  },
  // v255: error pill (red, white text) for validation errors.
  statusPillError: {
    backgroundColor: Colors.danger,
  },
  statusTextError: {
    color: Colors.surface,
  },
  // v255: warning pill (caution yellow, dark text) for low-confidence
  // Mapbox snaps. User's drawing is kept; the warning advises review.
  statusPillWarning: {
    backgroundColor: Colors.severityCautionBg,
    borderWidth: 1,
    borderColor: Colors.severityCaution,
  },
  statusTextWarning: {
    color: Colors.textPrimary,
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
  statusActions: {
    flexDirection: 'row',
    gap: Spacing.xs,
  },
  iconBtn: {
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
  iconBtnDisabled: {
    opacity: 0.4,
  },
  iconBtnText: {
    fontSize: FontSize.small,
    color: Colors.textSecondary,
    fontWeight: '600',
  },
  iconBtnTextDisabled: {
    color: Colors.textMuted,
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
  previewBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: Spacing.sm + 2,
    borderRadius: Radius.button,
    borderWidth: 1.5,
    borderColor: Colors.primary,
    backgroundColor: Colors.primaryBg,
    marginTop: Spacing.sm,
  },
  previewBtnCurrent: {
    backgroundColor: Colors.successBg,
    borderColor: Colors.success,
  },
  previewBtnDisabled: {
    opacity: 0.5,
  },
  previewBtnText: {
    color: Colors.primary,
    fontSize: FontSize.body,
    fontWeight: '700',
  },
  toolStrip: {
    flexDirection: 'row',
    gap: Spacing.xs,
    marginBottom: Spacing.sm,
  },
  toolBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderRadius: Radius.button,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  toolBtnActive: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  toolBtnText: {
    fontSize: FontSize.small,
    fontWeight: '600',
    color: Colors.textPrimary,
  },
  toolBtnTextActive: {
    color: Colors.surface,
  },
});
