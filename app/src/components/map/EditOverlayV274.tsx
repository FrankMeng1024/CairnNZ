/**
 * EditOverlayV274 — v276 layout: top-right 2x2 wheel + bottom status.
 *
 * v276 (PO direction):
 *   - Remove Eraser entirely. Use Undo instead — one action = one undo.
 *   - Wheel goes back to top-right (anchored at the FAB) in a 2x2
 *     game-style grid: Draw, Move, Undo, Reset. No center, no close ×.
 *   - Status pill (e.g. "Drawing — start on the route") sits ABOVE the
 *     bottom action button so the top of the screen stays clean and
 *     the back arrow is never occluded.
 *   - Errors render in the same status slot, in red. Stroke-self-red
 *     in the canvas is unchanged.
 *
 * Smart bottom logic (unchanged):
 *     state A (has unpreviewed strokes): ONE button = Preview;
 *       disabled on validation error.
 *     state B (clean / previewed):       Beautify route + Save.
 */

import React, { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ActivityIndicator, TouchableOpacity, Alert,
  KeyboardAvoidingView, Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouteEditStore } from '../../store/useRouteEditStore';
import { Colors, Spacing, Radius, FontSize, Shadow } from '../tokens';
import { Icon } from '../Icon';

interface EditOverlayV274Props {
  onCancel: () => void;
  onSave: () => Promise<void> | void;
  onPreview: () => Promise<void> | void;
  onBeautify: () => Promise<void> | void;
}

type ToolKey = 'pan' | 'brush';

export function EditOverlayV274(props: EditOverlayV274Props): React.JSX.Element {
  const { onSave, onPreview, onBeautify } = props;
  const insets = useSafeAreaInsets();

  const isComputing = useRouteEditStore(s => s.isComputing);
  const lastError = useRouteEditStore(s => s.lastError);
  const brushStrokes = useRouteEditStore(s => s.brushStrokes);
  const activeTool = useRouteEditStore(s => s.activeTool);
  const setActiveTool = useRouteEditStore(s => s.setActiveTool);
  const previewIsCurrent = useRouteEditStore(s => s.previewIsCurrent);
  const resetEdits = useRouteEditStore(s => s.resetEdits);
  const undo = useRouteEditStore(s => s.undo);
  const undoStackLen = useRouteEditStore(s => s.undoStack.length);

  const [wheelOpen, setWheelOpen] = useState(false);

  // v276: eraser tool removed from UI. If a session resumed in
  // 'eraser' mode (legacy state), coerce to 'brush' so the user
  // doesn't get stuck in a tool that has no UI.
  useEffect(() => {
    if (activeTool === 'eraser') setActiveTool('brush');
  }, [activeTool, setActiveTool]);

  const strokeCount = brushStrokes.length;
  const hasUnpreviewedStrokes = strokeCount > 0 && !previewIsCurrent;
  const inErrorState = !!lastError;
  const canPreview = hasUnpreviewedStrokes && !isComputing && !inErrorState;
  const canBeautify = !isComputing;
  const canSave = !isComputing && !hasUnpreviewedStrokes;
  const canUndo = undoStackLen > 0;

  // v276: eraser removed. Active tool can only be pan or brush.
  const safeTool: ToolKey = activeTool === 'brush' ? 'brush' : 'pan';
  const fabIcon = safeTool === 'brush' ? 'Pencil' : 'Navigation2';
  const fabBg = safeTool === 'brush' ? '#c87941' : Colors.primary;

  function pickTool(t: ToolKey) {
    setActiveTool(t);
    setWheelOpen(false);
  }
  function handleResetTap() {
    setWheelOpen(false);
    Alert.alert(
      'Reset edits?',
      'All detour strokes and trim adjustments will be cleared.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Reset', style: 'destructive', onPress: () => resetEdits() },
      ],
    );
  }
  function handleUndoTap() {
    setWheelOpen(false);
    if (canUndo) undo();
  }

  // v276: status text shown above bottom buttons. One line, never blocks.
  const statusText: string | null = (() => {
    if (inErrorState) return null;          // error has its own red pill
    if (isComputing) return 'Computing…';
    if (hasUnpreviewedStrokes) {
      return safeTool === 'brush'
        ? 'Drawing — start and end on the route'
        : `Drew ${strokeCount} stroke${strokeCount > 1 ? 's' : ''} · tap Preview to snap`;
    }
    if (safeTool === 'brush') return 'Drawing — start and end on the route';
    if (previewIsCurrent && strokeCount === 0) return null;
    return null;
  })();

  return (
    <View pointerEvents="box-none" style={styles.container}>
      {/* Top-right tool FAB (closed). v275 sizes preserved. */}
      {!wheelOpen && (
        <TouchableOpacity
          style={[styles.fab, { top: insets.top + 8, backgroundColor: fabBg }]}
          activeOpacity={0.85}
          onPress={() => setWheelOpen(true)}
        >
          <Icon name={fabIcon as any} size={26} color={Colors.surface} strokeWidth={2.6} />
        </TouchableOpacity>
      )}

      {/* v276 wheel: anchored at FAB position (top-right), 2x2 grid.
          Tap backdrop to dismiss. No close ×. */}
      {wheelOpen && (
        <>
          <TouchableOpacity
            activeOpacity={1}
            style={styles.wheelBackdrop}
            onPress={() => setWheelOpen(false)}
          />
          <View
            pointerEvents="box-none"
            style={[
              styles.wheel2x2Wrap,
              { top: insets.top + 8, right: Spacing.md },
            ]}
          >
            <View style={styles.wheel2x2Row}>
              <ToolBtn
                icon="Pencil" label="Draw"
                active={safeTool === 'brush'}
                activeBg="#c87941"
                onPress={() => pickTool('brush')}
              />
              <ToolBtn
                icon="Navigation2" label="Move"
                active={safeTool === 'pan'}
                activeBg={Colors.primary}
                onPress={() => pickTool('pan')}
              />
            </View>
            <View style={styles.wheel2x2Row}>
              <ToolBtn
                icon="Undo2" label="Undo"
                disabled={!canUndo}
                onPress={handleUndoTap}
              />
              <ToolBtn
                icon="RotateCcw" label="Reset"
                danger
                onPress={handleResetTap}
              />
            </View>
          </View>
        </>
      )}

      {/* Bottom bar — status text + action row. */}
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.bottomWrap}
        pointerEvents="box-none"
      >
        <View
          style={[styles.bottomBar, { paddingBottom: insets.bottom + Spacing.sm }]}
          pointerEvents="auto"
        >
          {/* Error pill (red, overrides status) OR status pill (light) */}
          {inErrorState ? (
            <View style={styles.errorPill}>
              <Icon name="TriangleAlert" size={14} color={Colors.surface} strokeWidth={2.5} />
              <Text style={styles.errorPillText} numberOfLines={2}>{lastError}</Text>
            </View>
          ) : statusText ? (
            <View style={styles.statusPill}>
              <Text style={styles.statusPillText} numberOfLines={1}>{statusText}</Text>
            </View>
          ) : null}

          {hasUnpreviewedStrokes ? (
            <TouchableOpacity
              activeOpacity={0.85}
              style={[styles.previewBtn, !canPreview && styles.btnDisabled]}
              disabled={!canPreview}
              onPress={() => canPreview && onPreview()}
            >
              {isComputing ? (
                <ActivityIndicator size="small" color={Colors.surface} />
              ) : (
                <>
                  <Icon name="Eye" size={16} color={Colors.surface} strokeWidth={2.5} />
                  <Text style={styles.previewBtnText} numberOfLines={1}>
                    {inErrorState ? 'Fix the stroke first' : 'Preview'}
                  </Text>
                </>
              )}
            </TouchableOpacity>
          ) : (
            <View style={styles.bottomRow}>
              <TouchableOpacity
                activeOpacity={0.85}
                style={[styles.beautifyBtn, !canBeautify && styles.btnDisabled]}
                disabled={!canBeautify}
                onPress={() => canBeautify && onBeautify()}
              >
                {isComputing ? (
                  <ActivityIndicator size="small" color={Colors.surface} />
                ) : (
                  <>
                    <Icon name="Star" size={16} color={Colors.surface} strokeWidth={2.5} />
                    <Text style={styles.beautifyBtnText} numberOfLines={1}>
                      Beautify route
                    </Text>
                  </>
                )}
              </TouchableOpacity>
              <TouchableOpacity
                activeOpacity={0.85}
                style={[styles.saveBtn, !canSave && styles.btnDisabled]}
                disabled={!canSave}
                onPress={() => canSave && onSave()}
              >
                <Text style={styles.saveBtnText} numberOfLines={1}>Save</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

interface ToolBtnProps {
  icon: string;
  label: string;
  active?: boolean;
  activeBg?: string;
  disabled?: boolean;
  danger?: boolean;
  onPress: () => void;
}
function ToolBtn({ icon, label, active, activeBg, disabled, danger, onPress }: ToolBtnProps): React.JSX.Element {
  const bg = active ? (activeBg ?? Colors.primary)
           : danger ? Colors.dangerBg
           : Colors.surface;
  const fg = active ? Colors.surface
           : danger ? Colors.danger
           : Colors.textPrimary;
  return (
    <TouchableOpacity
      activeOpacity={0.85}
      disabled={disabled}
      onPress={onPress}
      style={[
        styles.toolBtn,
        { backgroundColor: bg },
        disabled && styles.btnDisabled,
        active && styles.toolBtnActive,
      ]}
    >
      <Icon name={icon as any} size={22} color={fg} strokeWidth={2.6} />
      <Text style={[styles.toolBtnLabel, { color: fg }]} numberOfLines={1}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}

const FAB_SIZE = 56;
const TOOL_BTN_SIZE = 64;
const TOOL_GAP = 8;

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
  },

  fab: {
    position: 'absolute',
    right: Spacing.md,
    width: FAB_SIZE, height: FAB_SIZE,
    borderRadius: FAB_SIZE / 2,
    alignItems: 'center', justifyContent: 'center',
    ...Shadow.elevated,
    borderWidth: 2.5,
    borderColor: 'rgba(255,255,255,0.7)',
  },

  wheelBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.30)',
  },
  wheel2x2Wrap: {
    position: 'absolute',
    width: TOOL_BTN_SIZE * 2 + TOOL_GAP,
  },
  wheel2x2Row: {
    flexDirection: 'row',
    gap: TOOL_GAP,
    marginBottom: TOOL_GAP,
  },
  toolBtn: {
    width: TOOL_BTN_SIZE, height: TOOL_BTN_SIZE,
    borderRadius: TOOL_BTN_SIZE / 2,
    alignItems: 'center', justifyContent: 'center',
    ...Shadow.elevated,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.7)',
  },
  toolBtnActive: {
    borderColor: 'rgba(255,255,255,0.9)',
    transform: [{ scale: 1.06 }],
  },
  toolBtnLabel: {
    fontSize: 11,
    fontWeight: '700',
    marginTop: 2,
  },

  bottomWrap: {
    position: 'absolute',
    left: 0, right: 0, bottom: 0,
  },
  bottomBar: {
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.sm,
  },
  bottomRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },

  statusPill: {
    paddingHorizontal: Spacing.md,
    paddingVertical: 8,
    borderRadius: Radius.pill,
    backgroundColor: Colors.primaryBg,
    marginBottom: Spacing.sm,
    alignSelf: 'center',
    maxWidth: '100%',
    ...Shadow.card,
  },
  statusPillText: {
    color: Colors.primary,
    fontSize: FontSize.small,
    fontWeight: '700',
  },

  errorPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: Spacing.md,
    paddingVertical: 8,
    borderRadius: Radius.pill,
    backgroundColor: Colors.danger,
    marginBottom: Spacing.sm,
    ...Shadow.card,
  },
  errorPillText: {
    flex: 1,
    color: Colors.surface,
    fontSize: FontSize.small,
    fontWeight: '600',
  },

  previewBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: Spacing.md,
    borderRadius: Radius.button,
    backgroundColor: Colors.primary,
    ...Shadow.card,
  },
  previewBtnText: {
    color: Colors.surface,
    fontSize: FontSize.body,
    fontWeight: '700',
  },
  beautifyBtn: {
    flex: 2,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: Spacing.md,
    borderRadius: Radius.button,
    backgroundColor: Colors.primary,
    ...Shadow.card,
  },
  beautifyBtnText: {
    color: Colors.surface,
    fontSize: FontSize.body,
    fontWeight: '700',
  },
  saveBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Spacing.md,
    borderRadius: Radius.button,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    ...Shadow.card,
  },
  saveBtnText: {
    color: Colors.textPrimary,
    fontSize: FontSize.body,
    fontWeight: '700',
  },
  btnDisabled: {
    opacity: 0.5,
  },
});
