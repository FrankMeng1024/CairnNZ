/**
 * UnfinishedRecoveryModal — v412 未完成 hike/run 恢复弹窗
 *
 * 用户点 Hiking/Running 卡进入界面时, 如果磁盘上有 < 72h 的 unfinished backup,
 * 界面上叠一个 Modal 让用户选:
 *   [继续这条]  — 内存加载磁盘 GPS, 继续 recording
 *   [丢弃]      — 删磁盘, 界面回到 Start 按钮
 *
 * v3.3 强制选择: iOS 左边缘 swipe / Android Back / tap outside 全部无效,
 *                用户必须点两个按钮之一才能关。
 *
 * 视觉与 TooShortSheet 一致 (Colors.surface card, primary CTA).
 */
import React, { useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Animated, Easing, BackHandler,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from './Icon';
import { Colors, Spacing, Radius, FontSize, Shadow } from './tokens';

interface UnfinishedData {
  sessionId: string;
  remoteId?: number | null;
  activityMode: 'hiking' | 'running';
  startedAt: number;    // Unix ms
  distanceM: number;
  durationS: number;
  lastPointAt: number;  // Unix ms of last GPS point (for "X hours ago")
}

interface Props {
  visible: boolean;
  data: UnfinishedData | null;
  onContinue: () => void;
  onDiscard: () => void;
}

function formatRelative(pastMs: number): string {
  const diffMs = Date.now() - pastMs;
  if (diffMs < 60_000) return 'just now';
  if (diffMs < 3600_000) return `${Math.floor(diffMs / 60_000)} min ago`;
  if (diffMs < 86400_000) return `${Math.floor(diffMs / 3600_000)} hr ago`;
  return `${Math.floor(diffMs / 86400_000)} days ago`;
}

function formatDuration(s: number): string {
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return h > 0 ? `${h} hr ${mm} min` : `${m} min`;
}

export function UnfinishedRecoveryModal({ visible, data, onContinue, onDiscard }: Props) {
  const insets = useSafeAreaInsets();
  const slideY = useRef(new Animated.Value(500)).current;
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      Animated.parallel([
        Animated.timing(slideY, { toValue: 0, duration: 280, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 1, duration: 220, easing: Easing.out(Easing.ease), useNativeDriver: true }),
      ]).start();
    } else {
      slideY.setValue(500);
      opacity.setValue(0);
    }
  }, [visible]);

  // v3.3 强制选择: 拦截 Android 硬件 Back 键 (noop)
  // v412 blocker 4 修 (subagent 视角B): 防御性 cleanup, RN 老版本 sub 可能是回调函数不是对象
  useEffect(() => {
    if (!visible) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => true);
    return () => {
      try {
        if (sub && typeof (sub as any).remove === 'function') {
          (sub as any).remove();
        } else if (typeof (sub as any) === 'function') {
          // RN <0.65: addEventListener 返回 unsubscribe 函数本身
          (sub as any)();
        } else {
          // fallback: removeEventListener API
          if (typeof (BackHandler as any).removeEventListener === 'function') {
            (BackHandler as any).removeEventListener('hardwareBackPress', () => true);
          }
        }
      } catch { /* silent — cleanup 失败不阻断 unmount */ }
    };
  }, [visible]);

  if (!visible || !data) return null;

  const label = data.activityMode === 'running' ? 'Run' : 'Hike';
  const kmText = (data.distanceM / 1000).toFixed(2);

  const dismiss = (then?: () => void) => {
    Animated.parallel([
      Animated.timing(slideY, { toValue: 500, duration: 220, easing: Easing.in(Easing.quad), useNativeDriver: true }),
      Animated.timing(opacity, { toValue: 0, duration: 200, easing: Easing.in(Easing.ease), useNativeDriver: true }),
    ]).start(() => then?.());
  };

  return (
    <Animated.View style={[styles.scrim, { opacity }]} pointerEvents="auto">
      {/* v3.3 强制选择: scrim tap outside 拦截但 noop, 弹窗不消失 */}
      <TouchableOpacity
        style={StyleSheet.absoluteFillObject}
        activeOpacity={1}
        onPress={() => { /* noop — 强制用户点两个按钮之一 */ }}
      />
      <Animated.View
        style={[styles.sheet, { transform: [{ translateY: slideY }], paddingBottom: Math.max(insets.bottom, Spacing.xl) }]}
      >
        <View style={styles.handle} />
        <View style={styles.iconWrap}>
          <Icon name="MapPin" size={28} color={Colors.primary} strokeWidth={2} />
        </View>
        <Text style={styles.title}>上次 {label.toLowerCase()} 未完成</Text>
        <View style={styles.statsRow}>
          <View style={styles.stat}>
            <Text style={styles.statValue}>{kmText}</Text>
            <Text style={styles.statLabel}>km</Text>
          </View>
          <View style={styles.stat}>
            <Text style={styles.statValue}>{formatDuration(data.durationS)}</Text>
            <Text style={styles.statLabel}>时长</Text>
          </View>
          <View style={styles.stat}>
            <Text style={styles.statValue}>{formatRelative(data.lastPointAt)}</Text>
            <Text style={styles.statLabel}>最后记录</Text>
          </View>
        </View>
        <TouchableOpacity
          style={styles.btnPrimary}
          activeOpacity={0.85}
          onPress={() => dismiss(onContinue)}
          testID="unfinished-continue"
        >
          <Text style={styles.btnPrimaryText}>继续这条</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.btnSecondary}
          activeOpacity={0.7}
          onPress={() => dismiss(onDiscard)}
          testID="unfinished-discard"
        >
          <Text style={styles.btnSecondaryText}>丢弃</Text>
        </TouchableOpacity>
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  scrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'flex-end',
    zIndex: 260,   // 高于 TooShortSheet (250), 确保 hike 恢复优先
  },
  sheet: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: Radius.sheet,
    borderTopRightRadius: Radius.sheet,
    padding: Spacing.xl,
    gap: Spacing.md,
    ...Shadow.overlay,
  },
  handle: {
    width: 40, height: 4, borderRadius: 2,
    backgroundColor: Colors.border, alignSelf: 'center',
    marginBottom: Spacing.xs,
  },
  iconWrap: {
    alignSelf: 'center',
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: Colors.primaryBg,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: Spacing.xs,
  },
  title: {
    fontSize: FontSize.h2, fontWeight: '800',
    color: Colors.textPrimary, textAlign: 'center',
  },
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingVertical: Spacing.md,
  },
  stat: {
    alignItems: 'center',
    flex: 1,
  },
  statValue: {
    fontSize: FontSize.h3, fontWeight: '700',
    color: Colors.textPrimary,
  },
  statLabel: {
    fontSize: FontSize.caption, color: Colors.textSecondary, marginTop: 2,
  },
  btnPrimary: {
    marginTop: Spacing.md,
    backgroundColor: Colors.primary,
    paddingVertical: 14, borderRadius: Radius.button,
    alignItems: 'center', justifyContent: 'center',
  },
  btnPrimaryText: {
    color: '#FFFFFF',
    fontSize: FontSize.body, fontWeight: '700',
  },
  btnSecondary: {
    paddingVertical: 12, borderRadius: Radius.button,
    alignItems: 'center', justifyContent: 'center',
  },
  btnSecondaryText: {
    color: Colors.textSecondary,
    fontSize: FontSize.body, fontWeight: '600',
  },
});
