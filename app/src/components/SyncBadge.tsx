/**
 * SyncBadge — v422 通用同步状态 badge。
 *
 * 用途:
 *   MarkerDetail / Activity list card / Hike detail 顶部展示"是否已同步"。
 *   与 offlineEntity 联动: entity.subscribe 回调 → 找到对应 localId → 传 state。
 *
 * 状态:
 *   - 'pending'  ⏳ Waiting to sync
 *   - 'syncing'  ↑ Syncing…
 *   - 'synced'   ✓ Synced      (通常无需渲染, 或短暂 fade out)
 *   - 'failed'   ⚠ Retry
 *
 * 视觉: 沿用 OtaBadge 的 pill 样式家族, 保持 handbook 风格。
 */
import React from 'react';
import { View, Text, StyleSheet, ActivityIndicator, TouchableOpacity } from 'react-native';
import type { SyncState } from '../services/offlineEntity';

const COLORS = {
  bg: 'rgba(255,255,255,0.96)',
  border: 'rgba(0,0,0,0.06)',
  text: '#2b241b',
  textMuted: '#7a6f5f',
  dotPending: '#c88a2a',
  dotSyncing: '#3B82F6',
  dotSynced: '#5d7c46',
  dotFailed: '#c44545',
};

interface Props {
  state: SyncState;
  /** 隐藏 synced 状态 (常见默认: 同步好后就不显示了) */
  hideWhenSynced?: boolean;
  /** 用户点击 (通常用于 failed 时手动重试, 或 pending 时长按放弃) */
  onPress?: () => void;
  /** compact 模式 (卡片角标) vs full 模式 (详情页 pill) */
  compact?: boolean;
}

export function SyncBadge({ state, hideWhenSynced = true, onPress, compact = false }: Props) {
  if (state === 'synced' && hideWhenSynced) return null;

  let dotColor = COLORS.dotPending;
  let label = '';
  let showSpinner = false;

  switch (state) {
    case 'pending':
      dotColor = COLORS.dotPending;
      label = compact ? '' : 'Waiting to sync';
      break;
    case 'syncing':
      dotColor = COLORS.dotSyncing;
      label = compact ? '' : 'Syncing…';
      showSpinner = true;
      break;
    case 'synced':
      dotColor = COLORS.dotSynced;
      label = compact ? '' : 'Synced';
      break;
    case 'failed':
      dotColor = COLORS.dotFailed;
      label = compact ? '' : 'Retry';
      break;
  }

  const Content = (
    <View style={[styles.badge, compact && styles.badgeCompact]}>
      {showSpinner ? (
        <ActivityIndicator size="small" color={dotColor} style={styles.spinner} />
      ) : (
        <View style={[styles.dot, { backgroundColor: dotColor }, compact && styles.dotCompact]} />
      )}
      {label ? <Text style={styles.label}>{label}</Text> : null}
    </View>
  );

  if (onPress) {
    return (
      <TouchableOpacity activeOpacity={0.7} onPress={onPress}>
        {Content}
      </TouchableOpacity>
    );
  }
  return Content;
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.bg,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: COLORS.border,
    alignSelf: 'flex-start',
  },
  badgeCompact: {
    paddingHorizontal: 0,
    paddingVertical: 0,
    backgroundColor: 'transparent',
    borderWidth: 0,
  },
  dot: { width: 8, height: 8, borderRadius: 4, marginRight: 6 },
  dotCompact: { width: 7, height: 7, borderRadius: 4, marginRight: 0 },
  spinner: { marginRight: 5, transform: [{ scale: 0.6 }] },
  label: { fontSize: 11.5, fontWeight: '600', color: COLORS.text, letterSpacing: 0.1 },
});

export default SyncBadge;
