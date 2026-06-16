/**
 * EditOverlayV274 — radial tool wheel + smart bottom bar.
 *
 * v275 fixes (PO direction):
 *   - Top-right FAB pixel quality fixed (icon size up + larger FAB).
 *   - Wheel layout: Reset at CENTER, 4 tools (Draw/Move/Erase/Undo)
 *     at 4 cardinal directions. No close ×, tap backdrop to dismiss.
 *   - Removed "Drew N strokes" status text per PO ("没意义").
 *   - Status pill no longer at top (was occluding the back button);
 *     errors now appear ABOVE the bottom bar so the back button stays
 *     fully visible. Stroke-self-red still handles the in-canvas hint.
 *
 * Smart bottom bar logic (unchanged from v274):
 *     state A (has unpreviewed strokes): ONE button = Preview;
 *       disabled on validation error.
 *     state B (clean / previewed):       Beautify route + Save.
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
  onCancel: () => void;
  onSave: () => Promise<void> | void;
  onPreview: () => Promise<void> | void;
  onBeautify: () => Promise<void> | void;
}

type ToolKey = 'pan' | 'brush' | 'eraser';

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
  const fabBg = activeTool === 'brush' ? '#c87941'
              : activeTool === 'eraser' ? '#8c7e72'
              : Colors.primary;

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
      {/* Top-right tool FAB (closed). v275: bigger size + bigger icon
          for crisp render at all DPRs. */}
      {!wheelOpen && (
        <TouchableOpacity
          style={[styles.fab, { top: insets.top + 8, backgroundColor: fabBg }]}
          activeOpacity={0.85}
          onPress={() => setWheelOpen(true)}
        >
          <Icon name={fabIcon as any} size={26} color={Colors.surface} strokeWidth={2.6} />
        </TouchableOpacity>
      )}

      {/* Wheel — Reset at CENTER, 4 tools at N/E/S/W. Tap backdrop to dismiss. */}
      {wheelOpen && (
        <>
          <TouchableOpacity
            activeOpacity={1}
            style={styles.wheelBackdrop}
            onPress={() => setWheelOpen(false)}
          />
          <View pointerEvents="box-none" style={styles.wheelWrapCenter}>
            {/* Center = Reset (destructive) */}
            <TouchableOpacity
              style={styles.radialCenter}
              activeOpacity={0.85}
              onPress={handleResetTap}
            >
              <Icon name="RotateCcw" size={22} color={Colors.surface} strokeWidth={2.6} />
              <Text style={styles.radialCenterLabel} numberOfLines={1}>Reset</Text>
            </TouchableOpacity>

            {/* North = Draw */}
            <RadialItem
              pos="north"
              icon="Pencil" label="Draw"
              active={activeTool === 'brush'}
              activeBg="#c87941"
              onPress={() => pickTool('brush')}
            />
            {/* East = Erase */}
            <RadialItem
              pos="east"
              icon="Trash2" label="Erase"
              active={activeTool === 'eraser'}
              activeBg="#8c7e72"
              onPress={() => pickTool('eraser')}
            />
            {/* South = Undo */}
            <RadialItem
              pos="south"
              icon="Undo2" label="Undo"
              disabled={!canUndo}
              onPress={handleUndoTap}
            />
            {/* West = Move */}
            <RadialItem
              pos="west"
              icon="Navigation2" label="Move"
              active={activeTool === 'pan'}
              activeBg={Colors.primary}
              onPress={() => pickTool('pan')}
            />
          </View>
        </>
      )}

      {/* Bottom bar.
          Order: optional error pill above the row → action row.
          Action row layout depends on state (Preview vs Beautify+Save). */}
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.bottomWrap}
        pointerEvents="box-none"
      >
        <View
          style={[styles.bottomBar, { paddingBottom: insets.bottom + Spacing.sm }]}
          pointerEvents="auto"
        >
          {/* v275: errors live above the action row (not at the top).
              Top of the screen stays clear for the back arrow. */}
          {inErrorState && (
            <View style={styles.errorPill}>
              <Icon name="TriangleAlert" size={14} color={Colors.surface} strokeWidth={2.5} />
              <Text style={styles.errorPillText} numberOfLines={2}>{lastError}</Text>
            </View>
          )}

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
  pos: 'north' | 'east' | 'south' | 'west';
  icon: string;
  label: string;
  active?: boolean;
  activeBg?: string;
  disabled?: boolean;
  onPress: () => void;
}
function RadialItem({ pos, icon, label, active, activeBg, disabled, onPress }: RadialItemProps): React.JSX.Element {
  const bg = active ? (activeBg ?? Colors.primary) : Colors.surface;
  const fg = active ? Colors.surface : Colors.textPrimary;
  // Distance from center to outer item (centre-to-centre)
  const R = 86;
  const positionStyle = pos === 'north' ? { top: -R, left: 0 - RADIAL_ITEM_SIZE / 2 + RADIAL_CENTER_SIZE / 2 }
                      : pos === 'south' ? { top: R, left: 0 - RADIAL_ITEM_SIZE / 2 + RADIAL_CENTER_SIZE / 2 }
                      : pos === 'east'  ? { left: R, top: 0 - RADIAL_ITEM_SIZE / 2 + RADIAL_CENTER_SIZE / 2 }
                      :                   { left: -R, top: 0 - RADIAL_ITEM_SIZE / 2 + RADIAL_CENTER_SIZE / 2 };
  return (
    <TouchableOpacity
      activeOpacity={0.85}
      disabled={disabled}
      onPress={onPress}
      style={[
        styles.radialItem,
        positionStyle as any,
        { backgroundColor: bg },
        disabled && styles.btnDisabled,
        active && styles.radialItemActive,
      ]}
    >
      <Icon name={icon as any} size={22} color={fg} strokeWidth={2.6} />
      <Text style={[styles.radialItemLabel, { color: fg }]} numberOfLines={1}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}

const FAB_SIZE = 56;
const RADIAL_ITEM_SIZE = 64;
const RADIAL_CENTER_SIZE = 76;

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
  wheelWrapCenter: {
    position: 'absolute',
    top: '40%',
    left: '50%',
    width: 0, height: 0,
  },
  radialCenter: {
    position: 'absolute',
    left: -RADIAL_CENTER_SIZE / 2,
    top: -RADIAL_CENTER_SIZE / 2,
    width: RADIAL_CENTER_SIZE, height: RADIAL_CENTER_SIZE,
    borderRadius: RADIAL_CENTER_SIZE / 2,
    backgroundColor: Colors.danger,
    alignItems: 'center', justifyContent: 'center',
    ...Shadow.elevated,
    borderWidth: 3,
    borderColor: 'rgba(255,255,255,0.7)',
  },
  radialCenterLabel: {
    fontSize: 11,
    fontWeight: '800',
    color: Colors.surface,
    marginTop: 2,
  },
  radialItem: {
    position: 'absolute',
    width: RADIAL_ITEM_SIZE, height: RADIAL_ITEM_SIZE,
    borderRadius: RADIAL_ITEM_SIZE / 2,
    alignItems: 'center', justifyContent: 'center',
    ...Shadow.elevated,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.7)',
  },
  radialItemActive: {
    borderColor: 'rgba(255,255,255,0.9)',
    transform: [{ scale: 1.08 }],
  },
  radialItemLabel: {
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
