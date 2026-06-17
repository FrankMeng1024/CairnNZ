/**
 * AcquireGuidance.tsx — v0.2.4 Branch B (RN UI)
 *
 * 引导用户在 ≤10m 时扫地,直到 cairn 实化。
 * 5 级文案(Reviewer B R-B6 情感化重写):
 *   T0  "抬起手机,让 cairn 找到地面醒来"
 *   T3  "再慢一点,让镜头看到地面"
 *   T5  "低头看一下地面"(箭头变金色脉动)
 *   T10 "蹲下来一点点"
 *   T15 (silent) — 系统强制兜底显示,不弹文案
 *
 * 数据来源:
 *   - Unity 通过 CairnBridge 发送 'guidance' 事件:{ markerId, level, elapsed }
 *   - 注册全局 listener,根据 level 切换文案
 *
 * 显示规则:
 *   - 只在 ACQUIRE state 显示
 *   - cairn 实化(IMMORTAL)即关闭
 *   - 用户走出 ACQUIRE → 关闭并重置
 *
 * Reviewer B 修订:
 *   - 文案情感化(GuidanceCopy 常量)
 *   - 单一明确动作(去掉"或前后走动几步"的犹豫)
 *   - T15 silent(不暗示系统介入)
 */

import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Animated, Easing } from 'react-native';

// ---- Copy (Reviewer R-B6 情感化重写) ----
const GUIDANCE_COPY: Record<number, string> = {
  0: 'Lift your phone — let the cairn find the ground',
  1: 'Slow down so the camera can see the floor',
  2: 'Look down at the ground',
  3: 'Crouch a little lower',
  4: '', // silent at T15 — do not hint at system intervention
};

interface Props {
  /** Active marker id we're acquiring; null when not in ACQUIRE state. */
  acquiringMarkerId?: string | null;
}

export function AcquireGuidance({ acquiringMarkerId }: Props) {
  const [level, setLevel] = useState<number | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [fadeAnim] = useState(new Animated.Value(0));

  // BLOCKER 1 修复 — 用 globalThis.__cairnGuidance 替代不存在的
  // NativeEventEmitter('CairnBridge')。UnityAROverlay 的 case 'AcquireGuidance'
  // 路由 → globalThis.__cairnGuidance(payload) → 此 handler。
  //
  // 第三轮 review HIGH #3 修复:回退第二次 polish 的 useRef + deps=[] 反模式
  // 原因:ESLint exhaustive-deps 警告;closure 风险大于"避免 cleanup/restore"的收益
  // 当前用 deps=[acquiringMarkerId]:每次 marker 切换 cleanup→重新 setup handler,
  // 在 React 18 dev mode 下逻辑稳定,且符合标准模式。性能开销微乎其微(O(N) 全局赋值)
  useEffect(() => {
    const prev = (globalThis as any).__cairnGuidance;
    (globalThis as any).__cairnGuidance = (data: { markerId: string; level: number; elapsed: number }) => {
      if (acquiringMarkerId && data.markerId !== acquiringMarkerId) return;
      setActiveId(data.markerId);
      setLevel(data.level);
    };
    return () => { (globalThis as any).__cairnGuidance = prev; };
  }, [acquiringMarkerId]);

  // Hide when no active marker
  useEffect(() => {
    if (!acquiringMarkerId) {
      setLevel(null);
      setActiveId(null);
      fadeAnim.setValue(0);
    }
  }, [acquiringMarkerId, fadeAnim]);

  // Fade in/out on level change
  useEffect(() => {
    if (level === null || level === 4) {
      Animated.timing(fadeAnim, {
        toValue: 0,
        duration: 200,
        easing: Easing.in(Easing.ease),
        useNativeDriver: true,
      }).start();
    } else {
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 250,
        easing: Easing.out(Easing.ease),
        useNativeDriver: true,
      }).start();
    }
  }, [level, fadeAnim]);

  if (!acquiringMarkerId || level === null || level === 4) return null;
  const copy = GUIDANCE_COPY[level] || '';
  if (!copy) return null;

  return (
    <Animated.View pointerEvents="none" style={[styles.container, { opacity: fadeAnim }]}>
      <View style={styles.bubble}>
        <Text style={styles.text}>{copy}</Text>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    bottom: '18%',
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  bubble: {
    backgroundColor: 'rgba(0,0,0,0.78)',
    paddingHorizontal: 22,
    paddingVertical: 14,
    borderRadius: 22,
    maxWidth: '88%',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.5,
    shadowRadius: 10,
  },
  text: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '500',
    textAlign: 'center',
    lineHeight: 22,
  },
});

export default AcquireGuidance;
