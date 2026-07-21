/**
 * HierarchyPanel — v424
 *
 * Memory tab 左下 icon 点开的 popover, 展示当前 region 的 siblings + 上一层入口.
 *
 * UX 决策 (2026-07-20 敲定):
 *   - 236pt 宽 (黄金比例, 屏中央偏下)
 *   - 顶部: current-level 名 + `↑ ParentName` chip
 *   - 中间: siblings (最多 4 explored + 1 locked-collapsed = 5 行)
 *   - 底部: 图例 (marked / walked, locked 每行自解释)
 *   - 点 sibling → fly to bbox, panel 保留
 *   - 点上级 chip → 切换到上一层
 *   - 点 icon 或点面板外 → 关闭
 *   - 无 "you're here" / "explored" 等副文本 (靠图例)
 *
 * 视觉:
 *   - font: 系统默认 (与全 app 一致, 无 fontFamily 声明)
 *   - Colors: MemoryColors.sepia (#b5823d) marked · #d5cdba locked · sage (#5d7c46) here
 */
import React, { useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Animated, Pressable } from 'react-native';
import { Colors, Radius, FontSize, Shadow } from '../../../components/tokens';
import { MemoryColors } from '../config/memoryConfig';
import { Icon } from '../../../components/Icon';
import type { Region } from '../store/useHierarchyRegions';

interface Props {
  current: Region;
  siblings: Region[];
  parent: Region | null;
  /** 点某个 sibling (fly to that bbox) */
  onSelectSibling: (region: Region) => void;
  /** 点上一层 (切换 current) */
  onGoUp: (parent: Region) => void;
  /** 点外部 or 关闭 */
  onClose: () => void;
}

/**
 * 面板内容排序 + 折叠 locked (超过 4 个 explored 就 locked 折成一行).
 * 硬约束 5 行.
 */
function computeVisibleRows(current: Region, siblings: Region[]): {
  visible: Region[];
  lockedCount: number;
} {
  // Sort: here first, then marked, then walked, then locked
  const explored = siblings.filter(s => s.state === 'here' || s.state === 'marked' || s.state === 'walked');
  const locked = siblings.filter(s => s.state === 'locked');

  // Ensure current shows first
  const sorted = [
    ...explored.filter(s => s.state === 'here'),
    ...explored.filter(s => s.state === 'marked' && s.id !== current.id),
    ...explored.filter(s => s.state === 'walked' && s.id !== current.id),
  ];

  // Max 4 explored rows + 1 locked-summary = 5 total
  const MAX_EXPLORED = locked.length > 0 ? 4 : 5;
  const visible = sorted.slice(0, MAX_EXPLORED);
  return { visible, lockedCount: locked.length + Math.max(0, sorted.length - MAX_EXPLORED) };
}

export function HierarchyPanel(props: Props) {
  const { current, siblings, parent, onSelectSibling, onGoUp, onClose } = props;

  const { visible, lockedCount } = useMemo(
    () => computeVisibleRows(current, siblings),
    [current, siblings]
  );

  return (
    <>
      {/* 全屏透明 backdrop, 点即关闭 */}
      <Pressable style={styles.backdrop} onPress={onClose} />
      <Animated.View style={styles.panel} pointerEvents="box-none">
        {/* Header: current-level name + ↑ parent chip */}
        <View style={styles.header}>
          <Text style={styles.title} numberOfLines={1}>{current.name}</Text>
          {parent ? (
            <TouchableOpacity
              style={styles.upChip}
              onPress={() => onGoUp(parent)}
              activeOpacity={0.7}
            >
              <Icon name="ArrowUp" size={12} color={Colors.primary} strokeWidth={2.5} />
              <Text style={styles.upChipText} numberOfLines={1}>{parent.name}</Text>
            </TouchableOpacity>
          ) : null}
        </View>

        {/* Sibling list */}
        <View style={styles.list}>
          {visible.map((sib) => {
            const isHere = sib.state === 'here';
            return (
              <TouchableOpacity
                key={sib.id}
                style={[styles.row, isHere && styles.rowHere]}
                onPress={() => !isHere && onSelectSibling(sib)}
                activeOpacity={isHere ? 1 : 0.6}
                disabled={isHere}
              >
                <View
                  style={[
                    styles.dot,
                    sib.state === 'here' && styles.dotHere,
                    sib.state === 'marked' && styles.dotMarked,
                    sib.state === 'walked' && styles.dotWalked,
                  ]}
                />
                <Text
                  style={[styles.rowName, isHere && styles.rowNameHere]}
                  numberOfLines={1}
                >
                  {sib.name}
                </Text>
              </TouchableOpacity>
            );
          })}
          {lockedCount > 0 ? (
            <View style={[styles.row, styles.rowLocked]}>
              <View style={[styles.dot, styles.dotLocked]} />
              <Text style={styles.rowNameLocked}>
                {lockedCount} more locked
              </Text>
            </View>
          ) : null}
        </View>

        {/* Legend at bottom */}
        <View style={styles.legend}>
          <View style={styles.legendItem}>
            <View style={[styles.legendDot, styles.dotMarked]} />
            <Text style={styles.legendText}>marked</Text>
          </View>
          <View style={styles.legendItem}>
            <View style={[styles.legendDot, styles.dotWalked]} />
            <Text style={styles.legendText}>walked</Text>
          </View>
        </View>
      </Animated.View>
    </>
  );
}

const PANEL_WIDTH = 236;

const styles = StyleSheet.create({
  backdrop: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    zIndex: 15,
  },
  panel: {
    position: 'absolute',
    left: '50%',
    bottom: 168, // icon top (110 + 44 icon) + 14 gap
    marginLeft: -(PANEL_WIDTH / 2),
    width: PANEL_WIDTH,
    backgroundColor: '#fff',
    borderRadius: Radius.card,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.22,
    shadowRadius: 24,
    elevation: 12,
    zIndex: 20,
    overflow: 'hidden',
  },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#f2ede2',
    gap: 8,
  },
  title: {
    fontSize: FontSize.h3,
    fontWeight: '700',
    color: Colors.textPrimary,
    letterSpacing: -0.2,
    flexShrink: 1,
  },
  upChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 10,
    paddingVertical: 4,
    backgroundColor: '#f5efe4',
    borderRadius: 10,
    flexShrink: 0,
    maxWidth: 110,
  },
  upChipText: {
    fontSize: FontSize.small + 1, // 12
    fontWeight: '600',
    color: Colors.primary,
  },

  list: {
    paddingVertical: 4,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: '#faf7f0',
  },
  rowHere: {
    backgroundColor: 'rgba(93,124,70,0.06)',
  },
  rowLocked: {
    // no cursor / press feedback needed
  },
  rowName: {
    flex: 1,
    fontSize: FontSize.body - 0.5, // 14.5
    color: Colors.textPrimary,
    fontWeight: '500',
  },
  rowNameHere: {
    color: Colors.primary,
    fontWeight: '700',
  },
  rowNameLocked: {
    flex: 1,
    fontSize: FontSize.caption, // 13
    color: '#a89a82',
    fontStyle: 'italic',
  },

  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  dotHere: {
    backgroundColor: Colors.primary,
  },
  dotMarked: {
    backgroundColor: MemoryColors.sepia, // #b5823d
  },
  dotWalked: {
    backgroundColor: 'transparent',
    borderWidth: 2,
    borderColor: MemoryColors.sepia,
    width: 8,
    height: 8,
  },
  dotLocked: {
    backgroundColor: '#d5cdba',
  },

  legend: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingTop: 8,
    paddingBottom: 10,
    borderTopWidth: 1,
    borderTopColor: '#f2ede2',
    backgroundColor: '#fbf8f1',
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  legendDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  legendText: {
    fontSize: FontSize.tiny + 1.5, // 10.5
    color: '#7a6f5f',
    letterSpacing: 0.1,
  },
});

export default HierarchyPanel;
