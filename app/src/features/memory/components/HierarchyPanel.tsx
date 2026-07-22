/**
 * HierarchyPanel — v427 (redesigned for zero-learning UX)
 *
 * Product intent:
 *   User taps the Layers icon → sees siblings of their current region,
 *   with how many memory points in each. Locked (unvisited) siblings
 *   are collapsed into a single "+ N more" summary row.
 *
 * Zero learning UX:
 *   - Only 2 states: EXPLORED (sepia dot + count) or LOCKED (grouped as summary)
 *   - Current region highlighted in sage
 *   - Tap ↑ button → go to parent level
 *   - Tap any explored sibling → drill into that region (also serves as fly-to)
 *   - Panel auto-loads from /api/hierarchy/panel
 *
 * All 5 v425/v426 bugs addressed:
 *   1. Fixed zoom (14 for point-focused, no bbox span variance)
 *   2/3. Current region persisted via parent (MemoryScreen owns it, this
 *        component is pure display)
 *   4. Full world data (240 countries, 294 provinces, etc.)
 *   5. World layer handled as continents-as-siblings in backend
 */
import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Animated,
  Pressable,
  ScrollView,
  ActivityIndicator,
  NativeSyntheticEvent,
  NativeScrollEvent,
} from 'react-native';
import { Colors, Radius, FontSize } from '../../../components/tokens';
import { MemoryColors } from '../config/memoryConfig';
import { Icon } from '../../../components/Icon';
import { fetchPanelData, type PanelData, type SiblingRow } from '../services/hierarchyService';

interface Props {
  regionId: string;
  /** Called when user taps a sibling → drill into it (also flies map) */
  onSelectSibling: (siblingId: string, siblingName: string, bbox: [number, number, number, number]) => void;
  /** Called when user taps the ↑ chip → go to parent level */
  onGoUp: (parentId: string) => void;
  /** Called on backdrop tap or icon tap → close */
  onClose: () => void;
}

const LIST_MAX_HEIGHT = 260;
const SCROLL_HINT_THRESHOLD = 6;
const PANEL_WIDTH = 236;

export function HierarchyPanel({ regionId, onSelectSibling, onGoUp, onClose }: Props) {
  const [data, setData] = useState<PanelData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showScrollHint, setShowScrollHint] = useState(false);
  const [isScrollable, setIsScrollable] = useState(false);

  // Fetch panel data whenever regionId changes
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchPanelData(regionId)
      .then((d) => {
        if (cancelled) return;
        if (!d) setError('Could not load region info');
        else setData(d);
        setLoading(false);
      })
      .catch(() => {
        if (!cancelled) {
          setError('Network error');
          setLoading(false);
        }
      });
    return () => { cancelled = true; };
  }, [regionId]);

  const onScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
    const nearBottom =
      contentOffset.y + layoutMeasurement.height >= contentSize.height - SCROLL_HINT_THRESHOLD;
    setShowScrollHint(!nearBottom);
  }, []);

  const onContentSizeChange = useCallback((_w: number, h: number) => {
    const scrollable = h > LIST_MAX_HEIGHT - 1;
    setIsScrollable(scrollable);
    setShowScrollHint(scrollable);
  }, []);

  // Sort siblings: current (here) first, then explored by point count desc, then...
  // wait: locked siblings are NOT shown individually. Only "+ N more" summary.
  // So the visible list is: [here] + [other explored, by count desc].
  const visible: SiblingRow[] = data
    ? [
        ...data.siblings.filter((s) => s.is_here),
        ...data.siblings
          .filter((s) => !s.is_here && s.state === 'explored')
          .sort((a, b) => b.point_count - a.point_count),
      ]
    : [];

  return (
    <>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <Animated.View style={styles.panel} pointerEvents="box-none">
        {/* Header: current name + ↑ round button (parent up) */}
        <View style={styles.header}>
          <Text style={styles.title} numberOfLines={2}>
            {data?.current.name_en ?? 'Loading…'}
          </Text>
          {data?.parent ? (
            <TouchableOpacity
              style={styles.upBtn}
              onPress={() => onGoUp(data.parent!.id)}
              activeOpacity={0.7}
              accessibilityLabel={`Go up to ${data.parent.name_en}`}
            >
              <Icon name="ArrowUp" size={16} color={Colors.primary} strokeWidth={2.5} />
            </TouchableOpacity>
          ) : null}
        </View>

        {/* Body */}
        {loading ? (
          <View style={styles.loading}>
            <ActivityIndicator size="small" color={Colors.primary} />
          </View>
        ) : error ? (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : data ? (
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
                const isHere = sib.is_here;
                const heCount = isHere ? data.here_point_count : sib.point_count;
                return (
                  <TouchableOpacity
                    key={sib.id}
                    style={[styles.row, isHere && styles.rowHere]}
                    onPress={() => !isHere && onSelectSibling(sib.id, sib.name_en, sib.bbox)}
                    activeOpacity={isHere ? 1 : 0.6}
                    disabled={isHere}
                  >
                    <View
                      style={[
                        styles.dot,
                        isHere ? styles.dotHere : styles.dotExplored,
                      ]}
                    />
                    <Text
                      style={[styles.rowName, isHere && styles.rowNameHere]}
                      numberOfLines={2}
                    >
                      {sib.name_en}
                    </Text>
                    {heCount > 0 ? (
                      <Text style={[styles.count, isHere && styles.countHere]}>
                        {heCount}
                      </Text>
                    ) : null}
                  </TouchableOpacity>
                );
              })}
              {data.locked_count > 0 ? (
                <View style={[styles.row, styles.rowLocked]}>
                  <View style={[styles.dot, styles.dotLocked]} />
                  <Text style={styles.rowNameLocked}>
                    + {data.locked_count} unvisited
                  </Text>
                </View>
              ) : null}
            </ScrollView>
            {isScrollable && showScrollHint ? (
              <View style={styles.scrollHint} pointerEvents="none">
                <Text style={styles.scrollHintText}>▼ more</Text>
              </View>
            ) : null}
          </View>
        ) : null}

        {/* Footer: simple hint */}
        {data && !loading && !error ? (
          <View style={styles.footer}>
            <Text style={styles.footerText}>
              {data.explored_count > 0
                ? `${data.explored_count} visited · ${data.locked_count} unvisited`
                : `${data.locked_count} unvisited`}
            </Text>
          </View>
        ) : null}
      </Animated.View>
    </>
  );
}

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
    bottom: 168,
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
    alignItems: 'flex-start',
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
    lineHeight: 20,
    flex: 1,
  },
  upBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f5efe4',
    flexShrink: 0,
  },

  loading: {
    padding: 24,
    alignItems: 'center',
  },
  errorBox: {
    padding: 16,
    alignItems: 'center',
  },
  errorText: {
    fontSize: FontSize.small,
    color: '#a89a82',
    textAlign: 'center',
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
    alignItems: 'flex-start',
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
    // no cursor / no press feedback
  },
  rowName: {
    flex: 1,
    fontSize: FontSize.body - 0.5,
    lineHeight: 18,
    color: Colors.textPrimary,
    fontWeight: '500',
  },
  rowNameHere: {
    color: Colors.primary,
    fontWeight: '700',
  },
  rowNameLocked: {
    flex: 1,
    fontSize: FontSize.caption,
    color: '#a89a82',
    fontStyle: 'italic',
  },
  count: {
    fontSize: FontSize.small,
    fontWeight: '600',
    color: MemoryColors.sepia,
    marginTop: 1,
  },
  countHere: {
    color: Colors.primary,
  },

  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginTop: 5,
  },
  dotHere: {
    backgroundColor: Colors.primary,
  },
  dotExplored: {
    backgroundColor: MemoryColors.sepia,
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
    fontSize: FontSize.tiny,
    color: '#a89a82',
    letterSpacing: 0.5,
    backgroundColor: 'rgba(255,255,255,0.9)',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
  },

  footer: {
    paddingHorizontal: 14,
    paddingTop: 8,
    paddingBottom: 10,
    borderTopWidth: 1,
    borderTopColor: '#f2ede2',
    backgroundColor: '#fbf8f1',
    alignItems: 'center',
  },
  footerText: {
    fontSize: FontSize.tiny + 1.5,
    color: '#7a6f5f',
    letterSpacing: 0.1,
  },
});

export default HierarchyPanel;
