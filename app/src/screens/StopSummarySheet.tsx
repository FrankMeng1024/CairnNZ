/**
 * StopSummarySheet — bottom sheet shown when user taps Stop while tracking.
 *
 * Extracted from HikingScreen.tsx (O1 batch 21 refactor).
 * Shows memory gain preview, name input, and Discard/Save actions.
 */
import React, { useState, useRef, useEffect, useMemo } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  TextInput, Animated, Easing, KeyboardAvoidingView, Platform, Keyboard,
  ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors, Spacing, Radius, FontSize, Shadow } from '../components/tokens';
import { Icon } from '../components/Icon';
import { previewMemoryGain } from '../features/memory/services/flushHikingToMemory';
import { useDistance } from '../utils/distanceFormat';

type StopSummary = {
  distanceM: number;
  durationS: number;
  elevationGainM: number;
  activityMode: 'hiking' | 'running';
  trackPoints: Array<{ lat: number; lng: number }>;
  startedAt: number;
};

type Props = {
  summary: StopSummary;
  onCancel: () => void;
  onConfirm: (name: string) => void;
  onDiscard: () => void;
  /** O14 Bug 4: when true, disable buttons + swap Save-button label to
   *  a spinner so the user sees "Saving…" while stopTracking runs its
   *  async flush → rename chain (up to 15s). */
  saving?: boolean;
};

export function StopSummarySheet({ summary, onCancel, onConfirm, onDiscard, saving = false }: Props) {
  const [name, setName] = useState('');
  const insets = useSafeAreaInsets();
  const slideY = useRef(new Animated.Value(500)).current;
  const opacity = useRef(new Animated.Value(0)).current;
  // O12 Round-3 R3-C1 + R3-M8: settings-aware units. Memory area is in
  // km² (H3 res 11 = 0.00215 km²/cell) or mi² (× 0.386102 ≈ 0.000830 mi²/cell)
  // when imperial. Users deserve consistent units across memory + distance.
  const dist = useDistance();

  useEffect(() => {
    Animated.parallel([
      Animated.timing(slideY, { toValue: 0, duration: 280, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.timing(opacity, { toValue: 1, duration: 220, easing: Easing.out(Easing.ease), useNativeDriver: true }),
    ]).start();
  }, []);

  // v407 fix #6: dismiss guard — 防止用户在 dismiss 220ms 动画期间再点
  // 背景 scrim 触发第二次 dismiss(onCancel)。第一次 dismiss 触发 onConfirm
  // (await stopTracking 开始),第二次 dismiss 触发 resumeTracking → 竞态:
  // stopTracking 已清 timers + set initialState 后 resumeTracking 恢复
  // status='tracking' 但只 restart durationInterval,其它 flush/drain/
  // sampling/tokenRefresh 全死 → 用户以为在 hike,实际服务器没备份、
  // token 8h 后过期。
  const dismissedRef = useRef(false);
  const dismiss = (then?: () => void) => {
    if (dismissedRef.current) return;
    dismissedRef.current = true;
    Animated.parallel([
      Animated.timing(slideY, { toValue: 500, duration: 220, easing: Easing.in(Easing.quad), useNativeDriver: true }),
      Animated.timing(opacity, { toValue: 0, duration: 200, easing: Easing.in(Easing.ease), useNativeDriver: true }),
    ]).start(() => then?.());
  };

  const isRun = summary.activityMode === 'running';
  const accent = isRun ? Colors.running : Colors.primary;
  const label = isRun ? 'Run' : 'Hike';
  const date = new Date(summary.startedAt);
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const yyyy = date.getFullYear();
  const defaultName = `${label} — ${dd}/${mm}/${yyyy}`;

  // v333: dry-run preview of how many new H3 cells this hike unlocks.
  // The actual flush happens in useTrackingStore.stopTracking on confirm;
  // here we only read store state for the banner display, no writes.
  const memoryNewCells = useMemo(
    () => previewMemoryGain(summary.trackPoints),
    [summary.trackPoints],
  );

  return (
    <Animated.View style={[stopSheetStyles.scrim, { opacity }]} pointerEvents="auto">
      <TouchableOpacity style={StyleSheet.absoluteFillObject} activeOpacity={1} onPress={() => dismiss(onCancel)} />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ width: '100%' }}>
        <Animated.View style={[stopSheetStyles.sheet, { transform: [{ translateY: slideY }], paddingBottom: Math.max(insets.bottom, Spacing.xl) }]}>
          <View style={stopSheetStyles.handle} />

          <View style={stopSheetStyles.header}>
            <Text style={[stopSheetStyles.title, { color: accent }]}>{label} complete</Text>
          </View>

          {/* v120: stats row + GPS sample count removed — user already saw
              all of those in the live tracking bar above. The sheet should
              only do what the bar can't: name + confirm. */}

          {/* v333: Memory banner — shows how much new ground this hike
              will reveal on the Memory map. Uses dry-run preview so the
              number is consistent with what the user will see after Save.
              UX #11 fix: always show the chip (no silent absence). For
              too-short sessions show "Too short to record". km² is H3
              res 11 avg cell area = 0.00215 km² (~2150 m²) per cell.
              O12 R3-M8: mi² conversion for imperial users (× 0.386102). */}
          <View style={stopSheetStyles.memoryBanner}>
            <Icon name="Map" size={18} color={accent} strokeWidth={2.2} />
            <Text style={[stopSheetStyles.memoryBannerText, { color: accent }]}>
              {summary.trackPoints.length < 2
                ? 'Memory: Too short to record'
                : memoryNewCells > 0
                  ? (dist.imperial
                      ? `Memory: +${(memoryNewCells * 0.000830).toFixed(3)} mi²`
                      : `Memory: +${(memoryNewCells * 0.00215).toFixed(2)} km²`)
                  : 'Memory: Familiar ground'}
            </Text>
          </View>

          {/* Name input — placeholder shows the default name so users
              don't need a separate caption explaining "leave blank to
              use the default". */}
          <View style={stopSheetStyles.inputWrap}>
            <TextInput
              style={stopSheetStyles.input}
              placeholder={defaultName}
              placeholderTextColor={Colors.textMuted}
              value={name}
              onChangeText={(t) => setName(t.slice(0, 60))}
              autoFocus={false}
              returnKeyType="done"
            />
          </View>

          {/* O1 batch 28.4: Actions 改成 放弃 (Discard) + 保存 (Save & End)
              两个按钮。点 scrim 外部 = 继续 (dismiss(onCancel) 走
              resumeTracking)。用户明确不需要 "继续" button (无学习成本)。
              放弃 = 用户主动丢弃本次 hike (清 disk + remote + store)。 */}
          <View style={stopSheetStyles.actions}>
            <TouchableOpacity
              style={[stopSheetStyles.cancelBtn, saving && { opacity: 0.4 }]}
              onPress={() => {
                if (saving) return;
                Keyboard.dismiss();
                dismiss(onDiscard);
              }}
              activeOpacity={0.7}
              disabled={saving}
            >
              <Text style={stopSheetStyles.cancelText}>Discard</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[stopSheetStyles.saveBtn, { backgroundColor: accent }, saving && { opacity: 0.7 }]}
              onPress={() => {
                if (saving) return;
                // O11 (2026-07-27): 收起键盘再 dismiss.用户报 "点 save
                // 键盘不自动消失" — 老代码只 dismiss sheet 但 TextInput
                // 焦点还在,iOS 键盘不隐藏遮挡下面 UI 直到点别处。
                Keyboard.dismiss();
                // O14 Bug 4: do NOT dismiss the sheet here. HikingScreen
                // will keep it mounted, flip its `saving` prop true, wait
                // for stopTracking to finish (flush + rename, up to 15s),
                // then unmount the sheet. Pre-fix, we dismissed
                // immediately → user saw a normal Hiking screen with
                // Start Hiking button while stopTracking was still
                // writing to disk → clicked around and confused state.
                onConfirm(name);
              }}
              activeOpacity={0.85}
              disabled={saving}
            >
              {saving ? (
                <>
                  <ActivityIndicator size="small" color="#fff" />
                  <Text style={stopSheetStyles.saveText}>Saving…</Text>
                </>
              ) : (
                <>
                  <Icon name="Save" size={14} color="#fff" strokeWidth={2.5} />
                  <Text style={stopSheetStyles.saveText}>Save</Text>
                </>
              )}
            </TouchableOpacity>
          </View>

          {/* O1: Save-as-Route flow 完全移除 (v450 隐藏,O1 删除代码)。
              Hike 是 activity 记录不是 route 模板。想创建 route 走
              RouteEditor,从 activity detail 打开。 */}
        </Animated.View>
      </KeyboardAvoidingView>
    </Animated.View>
  );
}

const stopSheetStyles = StyleSheet.create({
  scrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'flex-end',
    zIndex: 200,
  },
  sheet: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: Radius.sheet, borderTopRightRadius: Radius.sheet,
    padding: Spacing.xl, gap: Spacing.md,
    ...Shadow.overlay,
  },
  handle: { width: 40, height: 4, borderRadius: 2, backgroundColor: Colors.border, alignSelf: 'center' },
  header: { gap: 4 },
  title: { fontSize: FontSize.h2, fontWeight: '800' },
  inputWrap: { gap: 4 },
  memoryBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingVertical: Spacing.sm, paddingHorizontal: Spacing.md,
    backgroundColor: Colors.bg,
    borderRadius: Radius.button,
    borderWidth: 1, borderColor: Colors.border,
    alignSelf: 'flex-start',
  },
  memoryBannerText: {
    fontSize: FontSize.body,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  input: {
    backgroundColor: Colors.bg, borderRadius: Radius.button,
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm,
    fontSize: FontSize.body, color: Colors.textPrimary,
    borderWidth: 1.5, borderColor: Colors.border,
  },
  actions: { flexDirection: 'row', gap: Spacing.sm, marginTop: Spacing.xs },
  cancelBtn: {
    paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md,
    borderRadius: Radius.button, borderWidth: 1.5, borderColor: Colors.border,
    backgroundColor: Colors.surface, alignItems: 'center', justifyContent: 'center',
  },
  cancelText: { fontSize: FontSize.body, fontWeight: '600', color: Colors.textSecondary },
  saveBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: Spacing.md, borderRadius: Radius.button,
  },
  saveText: { fontSize: FontSize.body, fontWeight: '700', color: '#fff' },
});
