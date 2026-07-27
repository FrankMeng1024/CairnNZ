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
import { polylineLengthM } from '../../services/routing/corridor/PolylineSampler';
import { TrimSlider } from './TrimSlider';
import { Colors, Spacing, Radius, FontSize, Shadow } from '../tokens';
import { Icon } from '../Icon';
import { useDistance } from '../../utils/distanceFormat';

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
  // O12 Round-3 R3-C1: settings-aware distance format for trim readout.
  const dist = useDistance();

  const isComputing = useRouteEditStore(s => s.isComputing);
  const lastError = useRouteEditStore(s => s.lastError);
  const brushStrokes = useRouteEditStore(s => s.brushStrokes);
  const activeTool = useRouteEditStore(s => s.activeTool);
  const setActiveTool = useRouteEditStore(s => s.setActiveTool);
  const previewIsCurrent = useRouteEditStore(s => s.previewIsCurrent);
  const resetEdits = useRouteEditStore(s => s.resetEdits);
  const undo = useRouteEditStore(s => s.undo);
  const undoStackLen = useRouteEditStore(s => s.undoStack.length);
  // v284: trim re-introduced. Bottom action bar becomes 3 equal-width
  // buttons (Beautify | Trim | Save). Tapping Trim toggles a slider
  // panel that lifts above the action row; tapping anywhere else
  // dismisses it. PO direction: "T4 但是大小平分 点击 trim 上方展示
  // 拉条 点其他地方就隐藏".
  const matchedPoints = useRouteEditStore(s => s.matchedPoints);
  const trimStartFrac = useRouteEditStore(s => s.trimStartFrac);
  const trimEndFrac = useRouteEditStore(s => s.trimEndFrac);
  const setTrimStart = useRouteEditStore(s => s.setTrimStart);
  const setTrimEnd = useRouteEditStore(s => s.setTrimEnd);
  const beginTrimDrag = useRouteEditStore(s => s.beginTrimDrag);

  const [wheelOpen, setWheelOpen] = useState(false);
  const [trimOpen, setTrimOpen] = useState(false);

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

  // v284: trim length math for the readout shown above the slider.
  const totalLengthM = polylineLengthM(matchedPoints);
  const editedLengthM = totalLengthM * (trimEndFrac - trimStartFrac);

  // v284: switching back to brush state hides the trim panel (no point
  // showing it while the user is mid-stroke).
  useEffect(() => {
    if (hasUnpreviewedStrokes && trimOpen) setTrimOpen(false);
  }, [hasUnpreviewedStrokes, trimOpen]);

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

      {/* v277b wheel: Move sits where the FAB was (slightly bigger);
          Draw / Undo / Reset stack to its bottom-left in a vertical
          column so they don't run off-screen on the right edge.
          PO: "move 变大一点点 另外3个都在左下". */}
      {wheelOpen && (
        <>
          <TouchableOpacity
            activeOpacity={1}
            style={styles.wheelBackdrop}
            onPress={() => setWheelOpen(false)}
          />
          <View
            pointerEvents="box-none"
            style={[styles.wheelCenterAnchor, {
              // v283 (I1 selected): Move sits at the FAB position
              // (top-right). Pre-v283 wheel pushed Move down by
              // ORBIT_R*0.85 to give the 120° upper-arc Draw orbiter
              // headroom — but with the new 180°/225°/270° layout,
              // no orbiter is above Move, so no shift needed.
              top: insets.top + 8 + FAB_SIZE / 2,
              right: Spacing.md + FAB_SIZE / 2,
            }]}
          >
            {/* Visible orbit arc — a 1.5px sage stroke from 120° to
                240° on the circle of radius R around Move. Three
                small icons sit on this arc, equilateral triangle
                with Move at the centroid. PO: "他的弧线 要出来" +
                "黄金比例". */}
            <View
              pointerEvents="none"
              style={[
                styles.wheelArc,
                {
                  width: ORBIT_R * 2 + 4,
                  height: ORBIT_R * 2 + 4,
                  left: -(ORBIT_R + 2),
                  top: -(ORBIT_R + 2),
                  borderRadius: ORBIT_R + 2,
                },
              ]}
            />

            {/* Move = the visible "boss" disc, sits in place of the FAB. */}
            <TouchableOpacity
              style={[
                styles.bigCenter,
                {
                  backgroundColor: safeTool === 'pan' ? Colors.primary : Colors.surface,
                  borderColor: safeTool === 'pan' ? 'rgba(255,255,255,0.9)' : Colors.primary,
                },
              ]}
              activeOpacity={0.85}
              onPress={() => pickTool('pan')}
            >
              <Icon name="Navigation2" size={26} color={safeTool === 'pan' ? Colors.surface : Colors.primary} strokeWidth={2.6} />
              <Text style={[styles.bigCenterLabel, { color: safeTool === 'pan' ? Colors.surface : Colors.primary }]} numberOfLines={1}>
                Move
              </Text>
            </TouchableOpacity>

            {/* v283 wheel (I1): 1/4 circle arc, R=90.
                  Reset : 180° (directly left of Move)
                  Undo  : 225° (lower-left, on the symmetry diagonal)
                  Draw  : 270° (directly below Move)
                All three same distance from Move. Reset/Draw are
                mirror-symmetric across the Move→Undo diagonal —
                Reset upper-edge to screen-top equals Draw right-edge
                to screen-right (geometric proof: both small icons
                are 50px wide, sit at distance R from Move-center,
                which is itself padded equally from top & right). */}
            <SmallOrbit
              dx={-ORBIT_R}
              dy={0}
              icon="RotateCcw" label="Reset"
              danger
              onPress={handleResetTap}
            />
            <SmallOrbit
              dx={-ORBIT_R * Math.SQRT1_2}
              dy={ORBIT_R * Math.SQRT1_2}
              icon="Undo2" label="Undo"
              disabled={!canUndo}
              onPress={handleUndoTap}
            />
            <SmallOrbit
              dx={0}
              dy={ORBIT_R}
              icon="Pencil" label="Draw"
              active={safeTool === 'brush'}
              activeBg="#c87941"
              onPress={() => pickTool('brush')}
            />
          </View>
        </>
      )}

      {/* v284 trim backdrop — full-screen tap-catcher to dismiss
          the trim panel when the user taps the map / anywhere outside.
          Sits BELOW the bottom bar in z-order so the 3 action
          buttons remain interactive (KeyboardAvoidingView renders
          after this). */}
      {trimOpen && (
        <TouchableOpacity
          activeOpacity={1}
          style={styles.trimBackdrop}
          onPress={() => setTrimOpen(false)}
        />
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
                <ActivityIndicator size="small" color={Colors.primary} />
              ) : (
                <>
                  <Icon name="Eye" size={16} color={Colors.primary} strokeWidth={2.5} />
                  <Text style={styles.previewBtnText} numberOfLines={1}>
                    {inErrorState ? 'Fix the stroke first' : 'Preview'}
                  </Text>
                </>
              )}
            </TouchableOpacity>
          ) : (
            <>
              {/* v284 trim panel — lifted above the action row when
                  trimOpen. Tap-outside backdrop dismisses it (rendered
                  separately, see below). */}
              {trimOpen && (
                <View style={styles.trimPanel} pointerEvents="auto">
                  <View style={styles.trimHeaderRow}>
                    <Icon name="Scissors" size={14} color={Colors.primary} strokeWidth={2.5} />
                    <Text style={styles.trimHeaderText} numberOfLines={1}>Trim · drag handles</Text>
                    {totalLengthM > 0 && (trimStartFrac > 0 || trimEndFrac < 1) && (
                      <Text style={styles.trimReadout} numberOfLines={1}>
                        {dist.format(editedLengthM, 2)} / {dist.format(totalLengthM, 2)} {dist.unit}
                      </Text>
                    )}
                  </View>
                  <TrimSlider
                    trimStartFrac={trimStartFrac}
                    trimEndFrac={trimEndFrac}
                    onTrimStartChange={setTrimStart}
                    onTrimEndChange={setTrimEnd}
                    onTrimDragBegin={beginTrimDrag}
                    totalLengthM={totalLengthM}
                  />
                </View>
              )}
              <View style={styles.bottomRow}>
                <TouchableOpacity
                  activeOpacity={0.85}
                  style={[styles.thirdBtn, !canBeautify && styles.btnDisabled]}
                  disabled={!canBeautify}
                  onPress={() => { setTrimOpen(false); if (canBeautify) onBeautify(); }}
                >
                  {isComputing ? (
                    <ActivityIndicator size="small" color={Colors.primary} />
                  ) : (
                    <>
                      <Icon name="Star" size={16} color={Colors.primary} strokeWidth={2.5} />
                      <Text style={styles.thirdBtnText} numberOfLines={1}>Beautify</Text>
                    </>
                  )}
                </TouchableOpacity>
                <TouchableOpacity
                  activeOpacity={0.85}
                  style={[styles.thirdBtn, trimOpen && styles.thirdBtnActive]}
                  onPress={() => setTrimOpen(v => !v)}
                >
                  <Icon name="Scissors" size={16} color={trimOpen ? Colors.surface : Colors.primary} strokeWidth={2.5} />
                  <Text
                    style={[styles.thirdBtnText, trimOpen && styles.thirdBtnTextActive]}
                    numberOfLines={1}
                  >Trim</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  activeOpacity={0.85}
                  style={[styles.thirdBtn, !canSave && styles.btnDisabled]}
                  disabled={!canSave}
                  onPress={() => { setTrimOpen(false); if (canSave) onSave(); }}
                >
                  <Icon name="Check" size={16} color={Colors.primary} strokeWidth={2.5} />
                  <Text style={styles.thirdBtnText} numberOfLines={1}>Save</Text>
                </TouchableOpacity>
              </View>
            </>
          )}
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

interface SmallOrbitProps {
  dx: number;
  dy: number;
  icon: string;
  label: string;
  active?: boolean;
  activeBg?: string;
  disabled?: boolean;
  danger?: boolean;
  onPress: () => void;
}
function SmallOrbit({ dx, dy, icon, label, active, activeBg, disabled, danger, onPress }: SmallOrbitProps): React.JSX.Element {
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
        styles.smallOrbit,
        { left: dx - SMALL_SIZE / 2, top: dy - SMALL_SIZE / 2, backgroundColor: bg },
        disabled && styles.btnDisabled,
        active && styles.smallOrbitActive,
      ]}
    >
      <Icon name={icon as any} size={18} color={fg} strokeWidth={2.6} />
      <Text style={[styles.smallOrbitLabel, { color: fg }]} numberOfLines={1}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}

const FAB_SIZE = 56;
const BIG_CENTER_SIZE = 68;
const SMALL_SIZE = 50;
const ORBIT_R = 90;

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
  wheelCenterAnchor: {
    position: 'absolute',
    width: 0, height: 0,
  },
  wheelArc: {
    // A faint sage ring around Move, on the same R as the orbit
    // small icons. Visual hint that all three siblings sit on the
    // same arc (PO: "他的弧线 要出来"). pointerEvents=none.
    position: 'absolute',
    borderWidth: 1.5,
    borderColor: Colors.primary,
    opacity: 0.35,
    borderStyle: 'dashed',
  },
  bigCenter: {
    position: 'absolute',
    left: -BIG_CENTER_SIZE / 2,
    top: -BIG_CENTER_SIZE / 2,
    width: BIG_CENTER_SIZE, height: BIG_CENTER_SIZE,
    borderRadius: BIG_CENTER_SIZE / 2,
    alignItems: 'center', justifyContent: 'center',
    ...Shadow.elevated,
    borderWidth: 3,
  },
  bigCenterLabel: {
    fontSize: 12,
    fontWeight: '800',
    marginTop: 3,
  },
  smallOrbit: {
    position: 'absolute',
    width: SMALL_SIZE, height: SMALL_SIZE,
    borderRadius: SMALL_SIZE / 2,
    alignItems: 'center', justifyContent: 'center',
    ...Shadow.elevated,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.7)',
  },
  smallOrbitActive: {
    borderColor: 'rgba(255,255,255,0.9)',
    transform: [{ scale: 1.06 }],
  },
  smallOrbitLabel: {
    fontSize: 10,
    fontWeight: '700',
    marginTop: 1,
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
    // v278b: align with HikingScreen's "Save as Route" style — sage
    // border + sage tinted background + sage text. Consistent across
    // the app for primary CTAs that act on a route.
    backgroundColor: Colors.primaryBg,
    borderWidth: 1.5,
    borderColor: Colors.primary,
  },
  previewBtnText: {
    color: Colors.primary,
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
    backgroundColor: Colors.primaryBg,
    borderWidth: 1.5,
    borderColor: Colors.primary,
  },
  beautifyBtnText: {
    color: Colors.primary,
    fontSize: FontSize.body,
    fontWeight: '700',
  },
  saveBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Spacing.md,
    borderRadius: Radius.button,
    backgroundColor: Colors.primaryBg,
    borderWidth: 1.5,
    borderColor: Colors.primary,
  },
  saveBtnText: {
    color: Colors.primary,
    fontSize: FontSize.body,
    fontWeight: '700',
  },
  // v284: 3-equal-width buttons (Beautify | Trim | Save). Same sage
  // CTA style as the other primary buttons.
  thirdBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: Spacing.md,
    borderRadius: Radius.button,
    backgroundColor: Colors.primaryBg,
    borderWidth: 1.5,
    borderColor: Colors.primary,
  },
  thirdBtnActive: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  thirdBtnText: {
    color: Colors.primary,
    fontSize: FontSize.small,
    fontWeight: '700',
  },
  thirdBtnTextActive: {
    color: Colors.surface,
  },
  // v284 trim panel
  trimPanel: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.button,
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.sm,
    paddingBottom: 4,
    marginBottom: Spacing.sm,
    borderWidth: 1,
    borderColor: Colors.border,
    ...Shadow.card,
  },
  trimHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 4,
  },
  trimHeaderText: {
    fontSize: FontSize.caption,
    color: Colors.primary,
    fontWeight: '700',
  },
  trimReadout: {
    marginLeft: 'auto',
    fontSize: FontSize.caption,
    color: Colors.textSecondary,
    fontWeight: '600',
  },
  trimBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'transparent',
  },
  btnDisabled: {
    opacity: 0.5,
  },
});
