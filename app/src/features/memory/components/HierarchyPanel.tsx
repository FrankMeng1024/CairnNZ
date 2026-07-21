/**
 * HierarchyPanel — v425
 *
 * Memory tab 左下 icon 点开的 popover, 展示当前 region 的 siblings + 上一层入口.
 *
 * UX 决策 (v425 更新):
 *   - 236pt 宽 (黄金比例, 屏中央偏下)
 *   - 顶部: current-level 名 (最多 2 行 wrap) + ↑ 圆按钮 (28×28, 无文字)
 *   - 中间: siblings 全部渲染 (删除 v424 的 MAX_EXPLORED 硬 cap), 超出内 scroll
 *          · list 最多 240pt 高度, 超出可垂直滚动
 *          · scroll 未到底部时右下角显示 "▼ scroll for more" 提示, 到底自动隐藏
 *          · sibling 名字最多 2 行 wrap, 无空格极长仍尾切
 *   - locked: 独立 summary row 放最后 ("N more locked"), 保持折叠
 *   - 底部: 图例 (marked / walked)
 *   - 点 sibling → fly to bbox, panel 保留
 *   - 点上级 ↑ → 切换到上一层
 *   - 点 icon 或点面板外 → 关闭
 *
 * 修的 bug:
 *   - v424 BUG-01 (Critical): parent chip text 被 truncate ("New Zeala..."). Fix: chip 只留 icon 无文字.
 *   - v424 BUG-02 (Critical): 长 region 名 title/sibling 被单行 truncate. Fix: 2 行 wrap.
 *   - v424 BUG-03 (Critical, 语义错误): >4 explored 被折成 "6 more locked" 但实际是已打卡.
 *     Fix: 删掉 MAX_EXPLORED cap, 所有 explored 都渲染; locked 独立 summary row.
 *
 * 视觉:
 *   - font: 系统默认
 *   - Colors: MemoryColors.sepia (#b5823d) marked · #d5cdba locked · sage (#5d7c46) here
 */
import React, { useMemo, useState, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Animated,
  Pressable,
  ScrollView,
  NativeSyntheticEvent,
  NativeScrollEvent,
} from 'react-native';
import { Colors, Radius, FontSize } from '../../../components/tokens';
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
 * 面板内容排序. v425: 不再 cap explored, 全部返回.
 * Locked 单独统计, 折叠成一行 summary.
 */
function computeVisibleRows(current: Region, siblings: Region[]): {
  visible: Region[];
  lockedCount: number;
} {
  const locked = siblings.filter((s) => s.state === 'locked');

  // Ensure current shows first, then marked, then walked. Explored 全渲染.
  const sorted = [
    ...siblings.filter((s) => s.state === 'here'),
    ...siblings.filter((s) => s.state === 'marked' && s.id !== current.id),
    ...siblings.filter((s) => s.state === 'walked' && s.id !== current.id),
  ];

  return { visible: sorted, lockedCount: locked.length };
}

const LIST_MAX_HEIGHT = 240;
const SCROLL_HINT_THRESHOLD = 4;

export function HierarchyPanel(props: Props) {
  const { current, siblings, parent, onSelectSibling, onGoUp, onClose } = props;

  const { visible, lockedCount } = useMemo(
    () => computeVisibleRows(current, siblings),
    [current, siblings]
  );

  // scroll hint: 当 list 内容可 scroll 且未到底部时显示. 初始默认显示 (list 可能超过 maxHeight).
  const [showScrollHint, setShowScrollHint] = useState(false);
  const [isScrollable, setIsScrollable] = useState(false);

  const onScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
    const nearBottom =
      contentOffset.y + layoutMeasurement.height >= contentSize.height - SCROLL_HINT_THRESHOLD;
    setShowScrollHint(!nearBottom);
  }, []);

  const onContentSizeChange = useCallback((_w: number, h: number) => {
    // 若 content 超过 maxHeight, 说明可 scroll → 初始显示 hint
    const scrollable = h > LIST_MAX_HEIGHT - 1;
    setIsScrollable(scrollable);
    setShowScrollHint(scrollable);
  }, []);

  return (
    <>
      {/* 全屏透明 backdrop, 点即关闭 */}
      <Pressable style={styles.backdrop} onPress={onClose} />
      <Animated.View style={styles.panel} pointerEvents="box-none">
        {/* Header: current-level name + ↑ 圆按钮 (无文字) */}
        <View style={styles.header}>
          <Text style={styles.title} numberOfLines={2}>
            {current.name}
          </Text>
          {parent ? (
            <TouchableOpacity
              style={styles.upChip}
              onPress={() => onGoUp(parent)}
              activeOpacity={0.7}
              accessibilityLabel={`Go up to ${parent.name}`}
            >
              <Icon name="ArrowUp" size={16} color={Colors.primary} strokeWidth={2.5} />
            </TouchableOpacity>
          ) : null}
        </View>

        {/* Sibling list — 内 scroll */}
        <View style={styles.listContainer}>
          <ScrollView
            style={styles.list}
            contentContainerStyle={styles.listContent}
            onScroll={onScroll}
            scrollEventThrottle={16}
            onContentSizeChange={onContentSizeChange}
            showsVerticalScrollIndicator={true}
            nestedScrollEnabled={true}
          >
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
                    numberOfLines={2}
                  >
                    {sib.name}
                  </Text>
                </TouchableOpacity>
              );
            })}
            {lockedCount > 0 ? (
              <View style={[styles.row, styles.rowLocked]}>
                <View style={[styles.dot, styles.dotLocked]} />
                <Text style={styles.rowNameLocked}>{lockedCount} more locked</Text>
              </View>
            ) : null}
          </ScrollView>
          {/* Dynamic scroll hint: 未到底且可滚动时显示 */}
          {isScrollable && showScrollHint ? (
            <View style={styles.scrollHint} pointerEvents="none">
              <Text style={styles.scrollHintText}>▼ scroll for more</Text>
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
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
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
    alignItems: 'flex-start', // v425: title 可能 2 行, top-align
    gap: 8,
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#f2ede2',
  },
  title: {
    fontSize: FontSize.h3,
    fontWeight: '700',
    color: Colors.textPrimary,
    letterSpacing: -0.2,
    lineHeight: 20, // v425: 允许 2 行
    flex: 1, // v425: 抢剩余空间
  },
  upChip: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f5efe4',
    flexShrink: 0,
  },

  listContainer: {
    position: 'relative',
  },
  list: {
    maxHeight: LIST_MAX_HEIGHT,
  },
  listContent: {
    paddingVertical: 4,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start', // v425: name 可能 2 行, top-align dot
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
    lineHeight: 18, // v425: 2 行 wrap 需要 lineHeight
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
    marginTop: 5, // v425: 与 rowName 顶行对齐 (baseline 视觉)
  },
  dotHere: {
    backgroundColor: Colors.primary,
  },
  dotMarked: {
    backgroundColor: MemoryColors.sepia,
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

  scrollHint: {
    position: 'absolute',
    bottom: 4,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  scrollHintText: {
    fontSize: FontSize.tiny, // 9
    color: '#a89a82',
    letterSpacing: 0.5,
    backgroundColor: 'rgba(255,255,255,0.9)',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
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
    marginTop: 0, // legend dot 不需要 top offset
  },
  legendText: {
    fontSize: FontSize.tiny + 1.5, // 10.5
    color: '#7a6f5f',
    letterSpacing: 0.1,
  },
});

export default HierarchyPanel;
