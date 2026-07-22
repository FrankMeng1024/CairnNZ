/**
 * HierarchyPanel — v428 (three-state model + drill-into-current)
 *
 * v428 fixes vs v427:
 *   1. Three states restored: marked (sepia solid) / walked (sepia hollow) / locked (grey)
 *   2. Tap green (current) row = drill into it → siblings become its children
 *   3. All siblings shown (including locked) — no forced collapse. User scrolls.
 *   4. Regionid change keeps old data visible until new arrives (no flicker)
 *   5. Bottom legend explains dot colours (marked / walked / locked)
 *
 * Product intent:
 *   User taps the Layers icon → sees current region + its siblings.
 *   Colours tell whether they've been there / marked anything / never been.
 *   Tap ↑ = go up. Tap green = drill down. Tap other row = fly to it.
 */
import React, { useState, useEffect, useCallback, useRef } from 'react';
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
  /** id of current region; may include :drill suffix when the caller is
   *  requesting the children view of that region. */
  regionId: string;
  /** True when the caller wants a "drill into children" view rather than
   *  the standard siblings view. Used when user taps the green (current)
   *  row to drill in. */
  drill?: boolean;
  /**
   * Called when user taps a sibling row.
   *   - If sibling is `is_here` (green): user wants to drill INTO current →
   *     panel should re-fetch with drill=true
   *   - Otherwise: fly to that sibling
   */
  onSelectSibling: (
    siblingId: string,
    siblingName: string,
    bbox: [number, number, number, number],
    isHere: boolean,
  ) => void;
  /** Called when user taps the ↑ chip → go to parent level */
  onGoUp: (parentId: string) => void;
  /** Called on backdrop tap or icon tap → close */
  onClose: () => void;
}

const LIST_MAX_HEIGHT = 260;
const SCROLL_HINT_THRESHOLD = 6;
const PANEL_WIDTH = 236;

export function HierarchyPanel({ regionId, drill = false, onSelectSibling, onGoUp, onClose }: Props) {
  const [data, setData] = useState<PanelData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showScrollHint, setShowScrollHint] = useState(false);
  const [isScrollable, setIsScrollable] = useState(false);
  // v428 flicker fix: on regionId change, keep showing old data (dimmed)
  // until new arrives. Only show spinner on the very first fetch.
  const hasEverLoadedRef = useRef(false);

  // Fetch panel data whenever regionId or drill changes
  useEffect(() => {
    let cancelled = false;
    // v428: always flag loading true on regionId/drill change. UI branches:
    //   - loading && !data (first load): full spinner
    //   - loading && data (subsequent fetch): keep list visible, dim via
    //     stale style so user sees it's a fresh fetch
    //   - !loading: normal
    setLoading(true);
    setError(null);
    fetchPanelData(regionId, drill)
      .then((d) => {
        if (cancelled) return;
        if (!d) {
          setError('Could not load region info');
        } else {
          setData(d);
          hasEverLoadedRef.current = true;
        }
        setLoading(false);
      })
      .catch(() => {
        if (!cancelled) {
          setError('Network error');
          setLoading(false);
        }
      });
    return () => { cancelled = true; };
  }, [regionId, drill]);

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

  // v428 sort:
  //   1. current (here) first (green, always at top)
  //   2. marked (has ≥1 flag) by marker_count desc
  //   3. walked (has points but no marker) by point_count desc
  //   4. locked (never been) alphabetical
  const visible: SiblingRow[] = data
    ? [
        ...data.siblings.filter((s) => s.is_here),
        ...data.siblings
          .filter((s) => !s.is_here && s.state === 'marked')
          .sort((a, b) => b.marker_count - a.marker_count),
        ...data.siblings
          .filter((s) => !s.is_here && s.state === 'walked')
          .sort((a, b) => b.point_count - a.point_count),
        // v430: locked siblings NOT expanded — client renders a single
        // "+ N locked" summary row after all marked/walked. User only
        // needs total count, not names of every unvisited province.
      ]
    : [];

  return (
    <>
      <Pressable style={styles.backdrop} onPress={onClose} testID="hierarchy-backdrop" />
      <Animated.View style={styles.panel} pointerEvents="box-none" testID="hierarchy-panel">
        {/* Header: current name + ↑ round button (parent up) */}
        <View style={styles.header}>
          <Text
            style={styles.title}
            numberOfLines={3}
            adjustsFontSizeToFit={true}
            minimumFontScale={0.75}
            testID="hierarchy-title"
          >
            {data?.current.name_en ?? 'Loading…'}
          </Text>
          {data?.parent ? (
            <TouchableOpacity
              style={styles.upBtn}
              onPress={() => onGoUp(data.parent!.id)}
              activeOpacity={0.7}
              accessibilityLabel={`Go up to ${data.parent.name_en}`}
              testID="hierarchy-up-btn"
            >
              <Icon name="ArrowUp" size={16} color={Colors.primary} strokeWidth={2.5} />
            </TouchableOpacity>
          ) : null}
        </View>

        {/* Body */}
        {loading && !data ? (
          <View style={styles.loading}>
            <ActivityIndicator size="small" color={Colors.primary} />
          </View>
        ) : error && !data ? (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : data ? (
          <View style={[styles.listContainer, loading && styles.stale]}>
            {/* v428 stale-content clarity: when regionId changed and new
                fetch is in-flight, listContainer dims to 50% via `stale`
                style so old data is visible but user sees "loading".
                hasEverLoadedRef prevents this on the initial fetch. */}
            {/* v428 empty-state banner: fresh users with no memory anywhere
                yet. Shown when here + all siblings are locked. Encourages
                first action rather than staring at grey dots. */}
            {(data.explored_count === 0 &&
              data.here_state === 'locked' &&
              !data.parent) ? (
              <View style={styles.emptyBanner} testID="hierarchy-empty-banner">
                <Text style={styles.emptyBannerText}>
                  Head out and start walking to unlock places.
                </Text>
              </View>
            ) : null}
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
                // v430: count shown ONLY for marker rows (marked / here-with-markers).
                // Walked rows don't show a number (per user: "走过的也不需要数字").
                const shownCount = isHere
                  ? data.here_marker_count
                  : (sib.state === 'marked' ? sib.marker_count : 0);
                return (
                  <TouchableOpacity
                    key={sib.id}
                    testID={`hierarchy-row-${sib.id}`}
                    accessibilityState={{ selected: isHere }}
                    style={[styles.row, isHere && styles.rowHere]}
                    onPress={() => onSelectSibling(sib.id, sib.name_en, sib.bbox, isHere)}
                    activeOpacity={0.6}
                  >
                    <View
                      style={[
                        styles.dot,
                        isHere ? styles.dotHere
                          : sib.state === 'marked' ? styles.dotMarked
                          : sib.state === 'walked' ? styles.dotWalked
                          : styles.dotLocked,
                      ]}
                    />
                    <Text
                      style={[
                        styles.rowName,
                        isHere && styles.rowNameHere,
                      ]}
                      numberOfLines={3}
                      adjustsFontSizeToFit={true}
                      minimumFontScale={0.75}
                    >
                      {sib.name_en}
                    </Text>
                    {shownCount > 0 ? (
                      <Text style={[styles.count, isHere && styles.countHere]}>
                        {shownCount}
                      </Text>
                    ) : null}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
            {isScrollable && showScrollHint ? (
              <View style={styles.scrollHint} pointerEvents="none">
                <Text style={styles.scrollHintText}>▼ more</Text>
              </View>
            ) : null}
          </View>
        ) : null}

        {/* v430: locked summary row at bottom. Not expanded per user request
            — only show total count of unvisited siblings, not their names.
            Legend + Never/Marked/Walked labels removed (reserved for future
            'friends' feature). */}
        {data && !error && data.locked_count > 0 ? (
          <View style={styles.lockedSummary} testID="hierarchy-locked-summary">
            <View style={[styles.dot, styles.dotLocked]} />
            <Text style={styles.lockedSummaryText}>
              {data.locked_count} more locked
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
  rowNameLockedMuted: {
    color: '#a89a82',
    fontWeight: '400',
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

  // v428: three-state dot system.
  //   dotHere    = green (current region)
  //   dotMarked  = solid sepia (has ≥1 marker/flag)
  //   dotWalked  = hollow sepia (has memory_points but no marker)
  //   dotLocked  = solid grey (never been)
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginTop: 5,
  },
  dotHere: {
    backgroundColor: Colors.primary,
  },
  dotMarked: {
    backgroundColor: MemoryColors.sepia,
  },
  dotWalked: {
    backgroundColor: 'transparent',
    borderWidth: 1.5,
    borderColor: MemoryColors.sepia,
  },
  dotLocked: {
    backgroundColor: '#d5cdba',
  },
  // v430: locked summary row (single line, non-tappable) at bottom
  lockedSummary: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: '#f2ede2',
    backgroundColor: '#fbf8f1',
  },
  lockedSummaryText: {
    flex: 1,
    fontSize: FontSize.small,
    color: '#a89a82',
    fontStyle: 'italic',
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
  // v428: dot legend at bottom (replaces N-visited/M-unvisited copy).
  legend: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: '#f2ede2',
    backgroundColor: '#fbf8f1',
  },

  // v428: empty-state banner for fresh users
  emptyBanner: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: '#f5efe4',
    borderBottomWidth: 1,
    borderBottomColor: '#f2ede2',
  },
  emptyBannerText: {
    fontSize: FontSize.small,
    color: '#7a6f5f',
    textAlign: 'center',
    lineHeight: 18,
  },
  // v428 stale indicator (dim when new fetch in flight)
  stale: {
    opacity: 0.5,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  legendDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  legendText: {
    fontSize: FontSize.tiny + 0.5,
    color: '#7a6f5f',
    letterSpacing: 0.2,
  },
});

export default HierarchyPanel;
