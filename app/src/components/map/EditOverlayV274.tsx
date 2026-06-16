/**
 * EditOverlayV274 — radial tool wheel + smart bottom bar.
 *
 * v274 redesign per PO direction:
 *   - Top-right floating tool icon (FAB). Tap → radial wheel emerges
 *     with 4 tools (brush / pan / eraser / reset). Game-feel.
 *   - Bottom bar collapses to a single row, no Cancel (system back
 *     replaces it).
 *   - Smart primary button logic:
 *       state A: has brush strokes AND not previewed
 *         → ONE button only: "Preview"
 *         → if validation error → Preview disabled
 *       state B: no strokes / already previewed (stable)
 *         → TWO buttons: "Beautify whole route" + "Save"
 *   - Errors: stroke renders red (handled in BrushStrokeLayer); top
 *     pill shows reason; bottom Preview goes disabled. No banner.
 *
 * Replaces EditOverlayV236. Uses the same store actions so logic is
 * untouched.
 */

import React, { useState } from 'react';
import {
  View, Text, StyleSheet, ActivityIndicator, TouchableOpacity, Alert,
  KeyboardAvoidingView, Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouteEditStore } from '../../store/useRouteEditStore';
import { Colors, Spacing, Radius, FontSize, Shadow } from '../tokens';
import { Icon } from '../Icon';

interface EditOverlayV274Props {
  onCancel: () => void;          // wired to back-arrow
  onSave: () => Promise<void> | void;
  onPreview: () => Promise<void> | void;
  /** v274: also handle "Beautify whole route" — same action under the
   *  hood as Preview but with no in-progress strokes (snaps the
   *  baseline through map-matching). The screen owner decides which
   *  store call this maps to; we just delegate. */
  onBeautify: () => Promise<void> | void;
}

type ToolKey = 'pan' | 'brush' | 'eraser';
const TOOL_META: Record<ToolKey, { icon: string; label: string }> = {
  pan:    { icon: 'Navigation2', label: 'Move' },
  brush:  { icon: 'Pencil',      label: 'Draw' },
  eraser: { icon: 'Trash2',      label: 'Erase' },
};

export function EditOverlayV274(props: EditOverlayV274Props): React.JSX.Element {
  const { onSave, onPreview, onBeautify } = props;
  const insets = useSafeAreaInsets();

  // store
  const isComputing = useRouteEditStore(s => s.isComputing);
  const lastError = useRouteEditStore(s => s.lastError);
  const brushStrokes = useRouteEditStore(s => s.brushStrokes);
  const activeTool = useRouteEditStore(s => s.activeTool);
  const setActiveTool = useRouteEditStore(s => s.setActiveTool);
  const previewIsCurrent = useRouteEditStore(s => s.previewIsCurrent);
  const resetEdits = useRouteEditStore(s => s.resetEdits);
  const undo = useRouteEditStore(s => s.undo);
  const undoStackLen = useRouteEditStore(s => s.undoStack.length);

  // local
  const [wheelOpen, setWheelOpen] = useState(false);

  const strokeCount = brushStrokes.length;
  const hasUnpreviewedStrokes = strokeCount > 0 && !previewIsCurrent;
  const inErrorState = !!lastError;
  const canPreview = hasUnpreviewedStrokes && !isComputing && !inErrorState;
  const canBeautify = !isComputing;
  const canSave = !isComputing && !hasUnpreviewedStrokes;
  const canUndo = undoStackLen > 0;

  const fabIcon = activeTool === 'brush' ? 'Pencil'
                : activeTool === 'eraser' ? 'Trash2'
                : 'Navigation2';
  const fabBg = activeTool === 'brush' ? '#c87941'        // flag orange
              : activeTool === 'eraser' ? '#8c7e72'       // textSecondary
              : Colors.primary;                           // sage = pan/view

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

  return (
    <View pointerEvents="box-none" style={styles.container}>
      {/* Top-center status pill — short, single-line. Switches to red
          on lastError. */}
      <View
        pointerEvents="none"
        style={[styles.topStatusWrap, { top: insets.top + 8 }]}
      >
        <View
          style={[
            styles.topStatus,
            inErrorState && styles.topStatusError,
          ]}
        >
          {inErrorState ? (
            <>
              <Icon name="TriangleAlert" size={12} color={Colors.surface} strokeWidth={2.5} />
              <Text style={[styles.topStatusText, styles.topStatusTextError]} numberOfLines={1}>
                {lastError}
              </Text>
            </>
          ) : isComputing ? (
            <>
              <ActivityIndicator size="small" color={Colors.primary} />
              <Text style={styles.topStatusText} numberOfLines={1}>Computing…</Text>
            </>
          ) : strokeCount > 0 ? (
            <Text style={styles.topStatusText} numberOfLines={1}>
              {previewIsCurrent
                ? `Previewed · ${strokeCount} stroke${strokeCount > 1 ? 's' : ''}`
                : `Drew ${strokeCount} stroke${strokeCount > 1 ? 's' : ''}`}
            </Text>
          ) : (
            <Text style={styles.topStatusText} numberOfLines={1}>
              {TOOL_META[activeTool as ToolKey]?.label ?? 'View'} mode
            </Text>
          )}
        </View>
      </View>

      {/* Top-right tool FAB (closed state). Tap to open wheel. */}
      {!wheelOpen && (
        <TouchableOpacity
          style={[styles.fab, { top: insets.top + 8, backgroundColor: fabBg }]}
          activeOpacity={0.85}
          onPress={() => setWheelOpen(true)}
        >
          <Icon name={fabIcon as any} size={22} color={Colors.surface} strokeWidth={2.4} />
        </TouchableOpacity>
      )}

      {/* Radial wheel — appears around the FAB position. Tap any tool
          to select; tap × or backdrop to dismiss. */}
      {wheelOpen && (
        <>
          {/* Dim backdrop catches outside taps */}
          <TouchableOpacity
            activeOpacity={1}
            style={styles.wheelBackdrop}
            onPress={() => setWheelOpen(false)}
          />
          <View
            pointerEvents="box-none"
            style={[styles.wheelWrap, { top: insets.top + 8 }]}
          >
            {/* Center FAB stays visible, dimmed */}
            <View style={[styles.fabCenter, { backgroundColor: fabBg }]}>
              <Icon name={fabIcon as any} size={22} color={Colors.surface} strokeWidth={2.4} />
            </View>

            {/* Ring of tools — positioned around center.
                Layout: brush left, pan bottom-left, eraser bottom,
                undo bottom-right, reset right. Five items keeps the
                ring balanced and avoids cluttering corners. */}
            <RadialItem
              pos={{ left: -64, top: -8 }}
              icon="Pencil" label="Draw"
              active={activeTool === 'brush'}
              activeBg="#c87941"
              onPress={() => pickTool('brush')}
            />
            <RadialItem
              pos={{ left: -56, top: 56 }}
              icon="Navigation2" label="Move"
              active={activeTool === 'pan'}
              activeBg={Colors.primary}
              onPress={() => pickTool('pan')}
            />
            <RadialItem
              pos={{ left: -8, top: 80 }}
              icon="Trash2" label="Erase"
              active={activeTool === 'eraser'}
              activeBg="#8c7e72"
              onPress={() => pickTool('eraser')}
            />
            <RadialItem
              pos={{ left: 56, top: 56 }}
              icon="Undo2" label="Undo"
              disabled={!canUndo}
              onPress={handleUndoTap}
            />
            <RadialItem
              pos={{ left: 64, top: -8 }}
              icon="RotateCcw" label="Reset"
              danger
              onPress={handleResetTap}
            />

            {/* Close × at bottom of ring */}
            <TouchableOpacity
              activeOpacity={0.85}
              style={styles.wheelClose}
              onPress={() => setWheelOpen(false)}
            >
              <Icon name="X" size={16} color={Colors.surface} strokeWidth={2.5} />
            </TouchableOpacity>
          </View>
        </>
      )}

      {/* Bottom bar — single row. Layout depends on state:
          • State A (has unpreviewed strokes): ONE button = Preview
          • State B (clean / previewed):       Beautify + Save */}
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.bottomWrap}
        pointerEvents="box-none"
      >
        <View
          style={[styles.bottomBar, { paddingBottom: insets.bottom + Spacing.sm }]}
          pointerEvents="auto"
        >
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

interface RadialItemProps {
  pos: { left: number; top: number };
  icon: string;
  label: string;
  active?: boolean;
  activeBg?: string;
  disabled?: boolean;
  danger?: boolean;
  onPress: () => void;
}
function RadialItem({ pos, icon, label, active, activeBg, disabled, danger, onPress }: RadialItemProps): React.JSX.Element {
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
        styles.radialItem,
        { left: pos.left, top: pos.top, backgroundColor: bg },
        disabled && styles.btnDisabled,
        active && styles.radialItemActive,
      ]}
    >
      <Icon name={icon as any} size={18} color={fg} strokeWidth={2.4} />
      <Text style={[styles.radialItemLabel, { color: fg }]} numberOfLines={1}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}

const FAB_SIZE = 48;
const RADIAL_ITEM_SIZE = 56;

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
  },

  // Top-center status pill
  topStatusWrap: {
    position: 'absolute',
    left: 0, right: 0,
    alignItems: 'center',
    paddingHorizontal: 64, // leave room for back button + FAB
  },
  topStatus: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: Spacing.md,
    paddingVertical: 6,
    borderRadius: Radius.pill,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    maxWidth: '100%',
    ...Shadow.card,
  },
  topStatusError: {
    backgroundColor: Colors.danger,
    borderColor: Colors.danger,
  },
  topStatusText: {
    fontSize: FontSize.small,
    fontWeight: '600',
    color: Colors.textPrimary,
  },
  topStatusTextError: {
    color: Colors.surface,
  },

  // FAB (closed)
  fab: {
    position: 'absolute',
    right: Spacing.md,
    width: FAB_SIZE, height: FAB_SIZE,
    borderRadius: FAB_SIZE / 2,
    alignItems: 'center', justifyContent: 'center',
    ...Shadow.elevated,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.6)',
  },

  // Wheel
  wheelBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.18)',
  },
  wheelWrap: {
    position: 'absolute',
    right: Spacing.md + (FAB_SIZE / 2) - 8,  // anchor center to where FAB was
    width: 16, height: 16,                    // anchor sentinel
  },
  fabCenter: {
    position: 'absolute',
    left: -FAB_SIZE / 2 + 8, top: 0,
    width: FAB_SIZE, height: FAB_SIZE,
    borderRadius: FAB_SIZE / 2,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.6)',
    opacity: 0.7,
    ...Shadow.elevated,
  },
  radialItem: {
    position: 'absolute',
    width: RADIAL_ITEM_SIZE, height: RADIAL_ITEM_SIZE,
    borderRadius: RADIAL_ITEM_SIZE / 2,
    alignItems: 'center', justifyContent: 'center',
    ...Shadow.elevated,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.06)',
  },
  radialItemActive: {
    borderColor: 'rgba(255,255,255,0.8)',
    transform: [{ scale: 1.05 }],
  },
  radialItemLabel: {
    fontSize: 9,
    fontWeight: '700',
    marginTop: 1,
  },
  wheelClose: {
    position: 'absolute',
    left: -16, top: 132,
    width: 32, height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(0,0,0,0.65)',
    alignItems: 'center', justifyContent: 'center',
    ...Shadow.card,
  },

  // Bottom bar
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
